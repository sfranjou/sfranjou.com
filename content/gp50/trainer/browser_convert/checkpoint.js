import {fullModel} from '../browser_teacher/api.js';
import {Trainer} from '../browser_fit/trainer.js';
import {CompactStream} from '../live_compare/streaming.js';
import {sha} from './store.js';
export async function validatePackage(bundle,provided,generic){
 if(bundle.format!=='tone-conversion070-checkpoint'||!bundle.input||!bundle.session)throw Error('Unsupported conversion checkpoint');
 const {input,session,id}=bundle;if(session.manifest?.architecture==='two_curve'||input.architecture==='two_curve')throw Error('Two-curve checkpoint files cannot be restored from a file yet; resume it in the browser that trained it.');if(!Number.isInteger(input.steps)||input.steps<1||input.steps>10000||typeof input.namText!=='string'||input.namText.length>20e6)throw Error('Invalid NAM or budget');fullModel(JSON.parse(input.namText));
 if(input.backend&&!['cpu','webgpu'].includes(input.backend))throw Error('Invalid training backend');
 const teacherHash=await sha(input.namText),targetID=await sha(JSON.stringify({profile:'raw069-v2',teacherHash,source:provided.provided_di})),profile=input.backend==='webgpu'?'compact-webgpu-jax-1':'compact070-v1',expected=await sha(JSON.stringify({profile,targetID,steps:input.steps})),flacTarget=provided.provided_di_flac?await sha(JSON.stringify({profile:'raw069-v2',teacherHash,source:provided.provided_di_flac})):null,expectedFlac=flacTarget?await sha(JSON.stringify({profile,targetID:flacTarget,steps:input.steps})):null;   // 2026-11-22: FLAC-provided sessions too
 if(id!==expected&&id!==expectedFlac||session.manifest.protocol_sha256!==id||session.teacher_sha256!==teacherHash)throw Error('Checkpoint inputs/protocol mismatch');
 const m=session.manifest,p=m.parameters;if(m.protocol.steps!==input.steps||m.protocol.batch!==4||m.protocol.seed!==64||m.protocol.batches?.length!==input.steps)throw Error('Invalid training protocol');
 for(const [key,n] of [['pre',32],['second',16],['post',256],['logs',8],['lpf',40],['learning_rates',313]])if(!Array.isArray(p[key])||p[key].length!==n||p[key].some(x=>!Number.isFinite(x)||Math.abs(x)>1e6))throw Error('Invalid '+key);
 if(p.learning_rates.some(x=>x<=0||x>1000)||JSON.stringify(p.lpf)!==JSON.stringify(generic.parameters.lpf)||p.output_gain!==generic.parameters.output_gain||p.context!==16384||JSON.stringify(m.biquad_coefficients)!==JSON.stringify(generic.biquad_coefficients))throw Error('Fixed model contract changed');
 for(const batch of m.protocol.batches){if(batch.length!==4||batch.some(r=>!Number.isInteger(r.block)||r.block<0||r.block>8||!Number.isInteger(r.start)||r.start%64||r.start<44100||r.start+22053>882000))throw Error('Invalid training crop');}
 const t=new Trainer(m,null,null,session.checkpoint),c=t.checkpoint();if(c.history.length!==c.step+1||c.history.some((r,i)=>r.step!==i||r.loss!==undefined&&!Number.isFinite(r.loss)||r.validation!==undefined&&!Number.isFinite(r.validation)))throw Error('Invalid checkpoint history');
 if(!c.best||!Number.isInteger(c.best.step)||c.best.step<0||c.best.step>c.step||c.best.parameters.some(x=>Math.abs(x)>1e6))throw Error('Invalid selected model');
 session.model={...t.exportModel(),format:'compact-browser070-v1',training_backend:input.backend||'cpu',training_recipe:input.backend==='webgpu'?'compact-webgpu-jax-1':'compact070-v1',teacher_sha256:teacherHash,note:'Restored generic browser fit; listening/runtime qualification required'};new CompactStream(session.model);return bundle;
}
