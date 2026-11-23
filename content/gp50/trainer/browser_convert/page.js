import {database,get,put} from './store.js';
import {encodeGPTC} from '../browser_fit/export.js';
import {encodeGPTCv2} from '../browser_lab/two_curve.js';
// 2026-11-21: two-curve (GPTC v2) models carry their record fields; GPTC v1 models are encoded as before.
const recordOf=m=>m?.format?.startsWith('two-curve')?encodeGPTCv2(m.fields,m.input_gain,m.output_gain):encodeGPTC(m);
const ext=m=>m?.format?.startsWith('two-curve')?'two-curve-browser.lttc':'compact-browser070.gptc';
import {mountSendPanel} from '../../gp50/send_panel.mjs';
import {loadProvidedDI} from './provided_di.js';

const $=s=>document.querySelector(s);let worker=null,id=null,model=null,checkpoint=null,liveCompare=false;
async function localFilter() {
 const stock = $('#stock');
 if (!stock) return undefined;
 const {readStockCaptureFilter} = await import('../../gp50/stock_capture_filter.mjs');
 return Array.from(await readStockCaptureFilter(stock.files[0]));
}
function update(){for(const n of ['start','provided','resume','nam','steps','backend','architecture'])$('#'+n).disabled=!!worker||(n==='resume'&&(!id||checkpoint?.step===Number($('#progress').max)));$('#pause').disabled=!worker;$('#compare-reference').disabled=!!worker||!model;$('#restore').disabled=!!worker;$('#restore-paste').disabled=!!worker;$('#model').disabled=!model;$('#record').disabled=!model;$('#checkpoint').disabled=!checkpoint;}
function show(c,m){checkpoint=c;model=m;$('#checkpoint-json').textContent=JSON.stringify(c);$('#model-json').textContent=JSON.stringify(m);$('#record-json').textContent=JSON.stringify(Array.from(recordOf(m)));$('#progress').value=c.step;$('#saved').textContent=`Saved update${c.step}; selected${c.best?.step}, MFCC${c.best?.validation?.toFixed(5)}.`;showComparison();update();}
function showComparison(){
 const link=$('#compare');
 link.hidden=!liveCompare||!model||model.format?.startsWith('two-curve');
 if(!link.hidden)link.href=new URL('../live_compare/?job=',import.meta.url).href+id;
}
function download(raw,name,type){const u=URL.createObjectURL(new Blob([raw],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function run(config,job){
 if(config){config.backend=$('#backend').value;config.architecture=$('#architecture').value;}
 navigator.locks.request('tone-convert070',{ifAvailable:true},async lock=>{if(!lock){$('#status').textContent='A conversion is already running in another tab.';return;}
 let dry,lpf;try{lpf=await localFilter();dry=await loadProvidedDI(await(await fetch(new URL('../browser_teacher/data/manifest.json',import.meta.url).href)).json(),s=>$('#status').textContent=s);}catch(e){$('#status').textContent=e.message;return;}
 await new Promise(resolve=>{
 worker=new Worker(new URL('../browser_convert/worker.js',import.meta.url).href,{type:'module'});update();$('#progress').max=config?.steps||10000;
 const finish=()=>{worker?.terminate();worker=null;update();resolve();};worker.onerror=e=>{$('#status').textContent=e.message;finish();};
 worker.onmessage=({data})=>{if(data.type==='progress'){$('#status').textContent=data.status;return;}if(data.type==='backend'){$('#backend').value=data.backend;return;}if(data.type==='job'){id=data.id;$('#progress').max=data.total;return;}if(data.type==='checkpoint'){show(data.checkpoint,data.model);return;}if(data.type==='finished'){show(data.checkpoint,data.model);$('#report').textContent=JSON.stringify(data.report,null,2);$('#status').textContent=data.paused?'Paused. Saved conversion can resume.':'Fit complete. Listen and compare before promoting this capture.';finish();return;}if(data.type==='paused'){$('#status').textContent=data.message;finish();return;}if(data.type==='error'){$('#status').textContent=data.message;finish();}};
 worker.postMessage({command:'start',config,job,dry,lpf},dry.map(x=>x.buffer));});});
}
async function start(provided){try{const steps=Number($('#steps').value);if(!Number.isInteger(steps)||steps<1||steps>10000)throw Error('Choose1–10000updates');let namText,name;if(provided){namText=await(await fetch(new URL('../browser_teacher/data/high_gain.nam',import.meta.url).href)).text();name='Provided Peavey generic';}else{const file=$('#nam').files[0];if(!file)throw Error('Choose a NAM first');if(file.size>20e6)throw Error('NAM exceeds20MB');namText=await file.text();name=file.name;}run({namText,steps,name});}catch(e){$('#status').textContent=e.message;}}
$('#start').onclick=()=>start(false);$('#provided').onclick=()=>start(true);$('#resume').onclick=()=>run(null,id);$('#pause').onclick=()=>{worker?.postMessage({command:'pause'});$('#pause').disabled=true;$('#status').textContent='Pause requested; finishing and saving the current target group or optimizer update.';};
$('#model').onclick=()=>download(JSON.stringify(model,null,2),'compact-browser070.json','application/json');$('#record').onclick=()=>download(recordOf(model),ext(model),'application/octet-stream');$('#checkpoint').onclick=async()=>{const db=await database(),input=await get(db,'inputs',id),session=await get(db,'sessions',id);db.close();download(JSON.stringify({format:'tone-conversion070-checkpoint',id,input,session}),'compact-browser070-checkpoint.json','application/json');};
try{const db=await database();id=await get(db,'meta','latest');if(id){const s=await get(db,'sessions',id),input=await get(db,'inputs',id);if(input)$('#progress').max=input.steps;if(s?.checkpoint){show(s.checkpoint,s.model);$('#report').textContent=JSON.stringify(s.report||{status:'Recovered optimizer history; original run timing unavailable in this browser record',selected:s.checkpoint.best,history:s.checkpoint.history,initialization:s.initialization},null,2);$('#status').textContent=s.checkpoint.step===input.steps?'Recovered completed conversion.':'Recovered saved conversion.';}}db.close();update();}catch(e){$('#status').textContent=e.message;}

async function restoreRaw(text){try{if(text.length>25e6)throw Error('Checkpoint exceeds25MB');const {validatePackage}=await import('./checkpoint.js'),provided=await(await fetch(new URL('../browser_teacher/data/manifest.json',import.meta.url).href)).json(),generic=await(await fetch(new URL('../browser_teacher/data/generic.json',import.meta.url).href)).json(),lpf=await localFilter();if(lpf)generic.parameters.lpf=lpf;const bundle=await validatePackage(JSON.parse(text),provided,generic);await navigator.locks.request('tone-convert070',{ifAvailable:true},async lock=>{if(!lock)throw Error('Stop the conversion in the other tab before restoring');const db=await database();await put(db,'inputs',bundle.id,bundle.input);await put(db,'sessions',bundle.id,bundle.session);await put(db,'meta','latest',bundle.id);db.close();id=bundle.id;$('#restore-text').value='';$('#progress').max=bundle.input.steps;show(bundle.session.checkpoint,bundle.session.model);$('#status').textContent=bundle.session.checkpoint.step===bundle.input.steps?'Completed conversion restored. Model and live comparison are ready.':'Checkpoint restored. Resume will reuse or regenerate targets locally.';});}catch(e){$('#status').textContent='Restore refused: '+e.message;}}
$('#restore').onchange=async()=>{const file=$('#restore').files[0];if(file)restoreRaw(await file.text());};
$('#restore-paste').onclick=()=>restoreRaw($('#restore-text').value);
$('#storage').onclick=async()=>{const db=await database(),counts={};for(const name of ['inputs','sessions','targets','meta'])counts[name]=await new Promise((res,rej)=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});const latest=await get(db,'meta','latest');db.close();$('#storage-json').textContent=JSON.stringify({origin:location.origin,counts,latest:latest||null,estimate:await navigator.storage.estimate(),persistent:await navigator.storage.persisted()},null,2);};


$('#backup').onclick=async()=>{if(!id)return;const db=await database(),input=await get(db,'inputs',id),session=await get(db,'sessions',id);db.close();$('#package-json').textContent=JSON.stringify({format:'tone-conversion070-checkpoint',id,input,session});};

try{
 const caps=await(await fetch(new URL('../browser_teacher/data/capabilities.json',import.meta.url).href)).json();
 liveCompare=caps.live_compare??true;
 showComparison();
 if(!caps.reference_pair){$('#provided').hidden=true;$('#compare-reference').hidden=true;}
}catch{}

$('#compare-reference').onclick=()=>{const w=new Worker(new URL('../browser_teacher/qualify.js',import.meta.url).href,{type:'module'});$('#compare-reference').disabled=true;$('#status').textContent='Scoring saved warm reference on the same validation passages…';w.onmessage=({data})=>{$('#reference-report').textContent=JSON.stringify(data,null,2);$('#status').textContent=data.error?'Reference comparison: '+data.error:'Matched validation comparison complete.';w.terminate();update();};w.onerror=e=>{$('#status').textContent=e.message;w.terminate();update();};w.postMessage({command:'conversion_reference',job:id});};

$('#persist').onclick=async()=>{try{const granted=await navigator.storage.persist();$('#status').textContent=granted?'Persistent browser storage granted. Keep a portable checkpoint as a backup.':'Persistent storage was not granted. Download portable checkpoints to keep your fits.';}catch(e){$('#status').textContent='Persistent storage unavailable: '+e.message;}};
mountSendPanel($('#send-pedal'),{getRecord:()=>model?recordOf(model):null,defaultName:'TC CAPTURE'});
