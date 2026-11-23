import {Teacher,moduleFor,fullModel} from '../browser_teacher/api.js';
import {convertRate} from '../browser_teacher/resample.js';
import {features} from '../browser_lab/mfcc.js';
import {compactForward} from '../browser_lab/compact.js';
import {Trainer,pack} from '../browser_fit/trainer.js';
import {initialize} from './initialize.js';
import {TwoCurveTrainer} from '../browser_fit/two_curve_trainer.js';
import {fromCompact} from '../browser_lab/two_curve.js';
import {database,get,put,sha} from './store.js';
let paused=false,running=false,activeTrainer=null;const progress=status=>self.postMessage({type:'progress',status}),tick=()=>new Promise(r=>setTimeout(r,0));
const json=async name=>{const r=await fetch(new URL('../browser_teacher/data/',import.meta.url).href+name);if(!r.ok)throw Error('Missing '+name);return r.json();};
async function array(name,expected){const raw=await(await fetch(new URL('../browser_teacher/data/',import.meta.url).href+name)).arrayBuffer();if(expected){const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),v=>v.toString(16).padStart(2,'0')).join('');if(actual!==expected)throw Error('Provided DI hash mismatch');}return new Float32Array(raw);}
function rng(seed){return()=>{let a=seed+=0x6D2B79F5;a=Math.imul(a^a>>>15,a|1);a^=a+Math.imul(a^a>>>7,a|61);return ((a^a>>>14)>>>0)/4294967296;};}
async function validation(trainer,blocks){const values=[];for(let i=0;i<blocks.length;i++){progress(`Validation ${i+1}/${blocks.length} · update${trainer.step}`);await tick();const b=blocks[i],x=b.x.slice(22*44100),t=b.t.slice(23*44100,-64),y=(trainer.forward?trainer.forward(x):compactForward(x,trainer.p,trainer.bq)).output.slice(44100,-64),a=features(y,trainer.metric).values,target=features(t,trainer.metric).values;let sum=0;for(let j=0;j<a.length;j++)sum+=Math.abs(a[j]-target[j]);values.push(sum/a.length);}const v=values.reduce((s,x)=>s+x,0)/values.length;if(!trainer.best||v<trainer.best.validation)trainer.best={step:trainer.step,validation:v,parameters:trainer.architecture==='two_curve'?trainer.checkpoint().parameters:pack(trainer.p)};return v;}
self.onmessage=async({data})=>{
 if(data.command==='pause'){paused=true;return;}if(data.command!=='start'||running)return;running=true;paused=false;
 try{
  const db=await database(),input=data.job?await get(db,'inputs',data.job):data.config;if(!input)throw Error('Saved NAM input unavailable');
  if(!Number.isInteger(input.steps)||input.steps<1||input.steps>10000)throw Error('Invalid training budget');
  const generic=await json('generic.json');
  if (data.lpf) generic.parameters.lpf=data.lpf;
  if (generic.parameters.lpf?.length!==40||!generic.parameters.lpf.every(Number.isFinite)) throw Error('Choose the official GP-50 V1.1.0 firmware file.');
  const two=input.architecture==='two_curve';   // 2026-11-21: GPTC v2 two-curve (CPU Float64 or WebGPU Float32)
  let backend=input.backend||'cpu',GPUTrainer;
  if(backend==='auto'||backend==='webgpu'){
   try{const gpu=await import('./gpu.js');await gpu.gpuAvailable();GPUTrainer=two?gpu.GPUTwoCurveTrainer:gpu.GPUTrainer;backend='webgpu';}
   catch(error){if(backend==='webgpu')throw error;backend='cpu';progress('WebGPU unavailable. Using CPU training.');}
  }
  if(!['cpu','webgpu'].includes(backend))throw Error('Unknown training backend');
  input.backend=backend;self.postMessage({type:'backend',backend});
  const teacherModel=fullModel(JSON.parse(input.namText)),sourceManifest=await json('manifest.json'),teacherHash=await sha(input.namText),flac=Array.isArray(data.dry),targetID=await sha(JSON.stringify({profile:'raw069-v2',teacherHash,source:flac?sourceManifest.provided_di_flac:sourceManifest.provided_di})),id=await sha(JSON.stringify({profile:two?(backend==='webgpu'?'two-curve-webgpu-jax-1':'two-curve-cpu-1'):backend==='webgpu'?'compact-webgpu-jax-1':'compact070-v1',targetID,steps:input.steps}));
  if(data.job&&data.job!==id)throw Error('Recipe or provided data changed; create a new job.');
  await put(db,'inputs',id,input);await put(db,'meta','latest',id);self.postMessage({type:'job',id,total:input.steps});
  const module=await moduleFor(),taps=await json('resampling.json'),blocks=[];
  for(let source=0;source<3;source++){
   progress(`Loading provided DI${source+1}/3`);const dry=flac?data.dry[source]:await array(sourceManifest.provided_di[source].file,sourceManifest.file_hashes[sourceManifest.provided_di[source].file]);   // 2026-11-22: decoded FLAC from the page
   if(flac&&(!(dry instanceof Float32Array)||dry.length!==sourceManifest.provided_di_flac[source].samples))throw Error('Provided DI missing or wrong length');
   for(const drive of [-6,0,6]){
    const key=targetID+':'+source+':'+drive;let b=await get(db,'targets',key);
    if(!b){progress(`Rendering Full teacher · DI${source+1}/3 · ${drive}dB`);const x=Float32Array.from(dry,v=>v*10**(drive/20)),native=Float32Array.from(convertRate(x,44100,teacherModel.sample_rate,taps)),wet=new Float32Array(native.length),teacher=new Teacher(module,teacherModel,4096);
     for(let at=0;at<native.length;at+=4096){teacher.process(native.subarray(at,at+4096),wet.subarray(at,at+4096));if(at%65536===0){await tick();progress(`Rendering Full teacher · DI${source+1}/3 · ${drive}dB · ${Math.round(at/native.length*100)}%`);}}
     teacher.destroy();if(wet.some(v=>!Number.isFinite(v)))throw Error('Nonfinite NAM output; target group not saved.');const t=Float32Array.from(convertRate(wet,teacherModel.sample_rate,44100,taps)).slice(0,x.length);b={x,t,group:`di${source}_${drive}`,drive_db:drive};await put(db,'targets',key,b);
    }
    blocks.push(b);if(paused){self.postMessage({type:'paused',id,stage:'targets',message:'Target-generation checkpoint saved. Resume to reuse completed source/drive groups.'});return;}
   }
  }
  const metric=await(await fetch(new URL('../browser_lab/data/coefficients.json',import.meta.url).href)).json(),bq=new Float64Array(await(await fetch(new URL('../browser_teacher/data/biquad_ir.f64',import.meta.url).href)).arrayBuffer());
  let session=await get(db,'sessions',id);
  if(!session){const initialized=await initialize(generic.parameters,blocks,metric,bq,progress),random=rng(64),batches=[];
   for(let step=0;step<input.steps;step++){const batch=[];for(let j=0;j<4;j++){const block=(step*4+j)%blocks.length,low=Math.ceil(44100/64),high=Math.floor((20*44100-22050-3)/64);batch.push({block,start:(low+Math.floor(random()*(high-low+1)))*64});}batches.push(batch);}
   session={manifest:{protocol_sha256:id,...(two?{optimizer:'schedule_free'}:{}),protocol:{steps:input.steps,batch:4,batches,selection:'9full9s validation regions, first20sTRAIN,2sgap,last10svalidation, MFCCmacro; step0eligible',seed:64},architecture:two?'two_curve':'compact',parameters:two?fromCompact(initialized.parameters):initialized.parameters,biquad_coefficients:generic.biquad_coefficients},initialization:initialized.rows,teacher_sha256:teacherHash};await put(db,'sessions',id,session);
  }
  const t=two&&backend!=='webgpu'?new TwoCurveTrainer(session.manifest,metric,bq,session.checkpoint||null):backend==='webgpu'?await GPUTrainer.create(session.manifest,metric,bq,session.checkpoint||null):new Trainer(session.manifest,metric,bq,session.checkpoint||null),begin=performance.now();activeTrainer=t;
  async function save(row){session.checkpoint=t.checkpoint();session.model={...t.exportModel(),format:two?'two-curve-browser-v1':'compact-browser070-v1',training_backend:backend,training_recipe:two?(backend==='webgpu'?'two-curve-webgpu-jax-1':'two-curve-cpu-1'):backend==='webgpu'?'compact-webgpu-jax-1':'compact070-v1',teacher_sha256:teacherHash,note:'Generic cold-start browser fit. Conversion quality and new weights need listening/runtime qualification.'};await put(db,'sessions',id,session);self.postMessage({type:'checkpoint',id,checkpoint:session.checkpoint,model:session.model,row});}
  if(!t.history.length){const row={step:0,validation:await validation(t,blocks)};t.record(row);await save(row);}
  while(t.step<input.steps){await tick();if(paused)break;const batch=session.manifest.protocol.batches[t.step].map(r=>({input:blocks[r.block].x.slice(r.start-16384,r.start+22050+3),target:blocks[r.block].t.slice(r.start,r.start+21986)}));progress(`${backend==='webgpu'?'WebGPU':'CPU'} training ${t.step+1}/${input.steps}`);const row=await t.trainBatch(batch);if(t.step%90===0||t.step===input.steps)row.validation=await validation(t,blocks);t.record(row);await save(row);}
  const report={backend,precision:backend==='webgpu'?'Float32':'Float64',training_recipe:two?(backend==='webgpu'?'two-curve-webgpu-jax-1':'two-curve-cpu-1'):backend==='webgpu'?'compact-webgpu-jax-1':'compact070-v1',optimizer:two?(t.optimizer==='schedule_free'?'CPU schedule-free AdamW (374 parameters, two-curve)':'CPU Adam (374 parameters, two-curve)'):'CPU Adam (313 parameters)',validation_backend:'CPU reference MFCC',execution:'Actual browser Worker; uploaded A2 Full teacher WASM and generic student initialization',step:t.step,selected:t.best,initialization:session.initialization,seconds_this_run:(performance.now()-begin)/1000,teacher_sha256:teacherHash,history:t.history,limits:'Generic recipe not proven equal to warm-start050; development validation only; no target/hardware qualification'};session.report=report;await put(db,'sessions',id,session);self.postMessage({type:'finished',id,paused:t.step<input.steps,checkpoint:t.checkpoint(),model:session.model,report});
 }catch(e){self.postMessage({type:'error',message:e.stack||e.message});}finally{activeTrainer?.dispose?.();activeTrainer=null;running=false;}
};
