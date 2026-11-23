import createTeacher from './teacher.js';
let modulePromise;
export function fullModel(document){
 if(document.architecture!=='SlimmableContainer')throw Error('Select a NAM A2 SlimmableContainer file.');
 const variants=document.config?.submodels?.filter(s=>s.max_value===1);
 if(variants?.length!==1||variants[0].model?.architecture!=='WaveNet')throw Error('One exact A2 Full WaveNet (max_value=1) is required.');
 const rate=Number(document.sample_rate);if(![44100,48000].includes(rate))throw Error('Teacher must declare 44.1 or 48 kHz.');
 const model=structuredClone(variants[0].model);model.sample_rate=rate;
 if(!Array.isArray(model.weights)||!model.weights.length||model.weights.length>2000000||model.weights.some(x=>!Number.isFinite(x)))throw Error('Invalid or oversized teacher weights.');
 return model;
}
export async function moduleFor(bytes){
 if(!modulePromise)modulePromise=(async()=>{const raw=bytes||new Uint8Array(await (await fetch(new URL('../browser_teacher/teacher.wasm',import.meta.url).href)).arrayBuffer());return createTeacher({wasmBinary:raw,locateFile:path=>path});})();
 return modulePromise;
}
export class Teacher{
 constructor(module,model,maximum=4096){
  this.module=module;this.rate=model.sample_rate;this.maximum=maximum;this.id=module._tb_create(this.rate,maximum);
  if(!this.id)throw Error('Cannot create NAM instance');
  const text=JSON.stringify(model),size=module.lengthBytesUTF8(text)+1,ptr=module._malloc(size);
  try{module.stringToUTF8(text,ptr,size);if(!module._tb_load(this.id,ptr))throw Error(module.UTF8ToString(module._tb_error()));}catch(e){this.destroy();throw e;}finally{module._free(ptr);}
 }
 process(input,output=new Float32Array(input.length)){
  if(!this.id||input.length>this.maximum||output.length<input.length)throw Error('Invalid teacher buffer');
  const p=this.module._tb_buffer(this.id)>>>2;this.module.HEAPF32.set(input,p);
  if(!this.module._tb_process(this.id,input.length))throw Error('NAM processing failed');
  output.set(this.module.HEAPF32.subarray(p,p+input.length));return output;
 }
 destroy(){if(this.id){this.module._tb_destroy(this.id);this.id=0;}}
}
