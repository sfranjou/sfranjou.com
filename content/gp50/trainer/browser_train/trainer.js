import {compactStep,compactForward} from '../browser_lab/compact.js';
import {features} from '../browser_lab/mfcc.js';

export function pack(p){return [...p.pre,...p.second,...p.post,...p.logs,p.branch];}
export function unpack(p,v){p.pre=v.slice(0,32);p.second=v.slice(32,48);p.post=v.slice(48,304);p.logs=v.slice(304,312);p.branch=v[312];}
export function difference(a,b){let sum=0,den=0,max=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];sum+=d*d;den+=b[i]*b[i];max=Math.max(max,Math.abs(d));}return {relative_rms:Math.sqrt(sum/Math.max(den,1e-100)),max_absolute:max};}

export class Trainer{
 constructor(manifest,metric,bq,checkpoint=null){
  this.manifest=manifest;this.metric=metric;this.bq=bq;
  this.p=structuredClone(manifest.parameters);this.step=0;this.m=Array(313).fill(0);this.v=Array(313).fill(0);
  this.history=[];this.best=null;
  if(checkpoint)this.restore(checkpoint);
 }
 restore(c){
  if(c.version!==1||c.protocol_sha256!==this.manifest.protocol_sha256||!Number.isInteger(c.step)||c.step<0||c.step>this.manifest.protocol.steps)throw Error('Checkpoint belongs to a different training protocol.');
  for(const key of ['parameters','m','v'])if(!Array.isArray(c[key])||c[key].length!==313||c[key].some(x=>!Number.isFinite(x)))throw Error('Invalid checkpoint '+key);
  if(c.v.some(x=>x<0)||c.parameters.some(x=>Math.abs(x)>1e6)||!Array.isArray(c.history)||c.history.length>this.manifest.protocol.steps+1)throw Error('Invalid checkpoint state.');
  if(c.best&&(!Number.isFinite(c.best.validation)||!Array.isArray(c.best.parameters)||c.best.parameters.length!==313||c.best.parameters.some(x=>!Number.isFinite(x))))throw Error('Invalid selected model.');
  this.step=c.step;this.m=c.m.slice();this.v=c.v.slice();this.history=structuredClone(c.history);this.best=structuredClone(c.best);unpack(this.p,c.parameters);
 }
 checkpoint(){return {version:1,protocol_sha256:this.manifest.protocol_sha256,step:this.step,parameters:pack(this.p),m:this.m.slice(),v:this.v.slice(),history:structuredClone(this.history),best:structuredClone(this.best)};}
 trainBatch(batch){
  const begin=performance.now(),gradient=Array(313).fill(0);let loss=0;
  for(const b of batch){const r=compactStep(b.input,b.target,this.p,this.bq,this.metric);loss+=r.loss/batch.length;for(let i=0;i<313;i++)gradient[i]+=r.gradient[i]/batch.length;}
  if(!Number.isFinite(loss)||gradient.some(x=>!Number.isFinite(x)))throw Error('Nonfinite training value; previous checkpoint is retained.');
  const norm=Math.sqrt(gradient.reduce((s,x)=>s+x*x,0)),clip=Math.min(1,10/(norm+1e-6));
  const values=pack(this.p),at=this.step,k=at+1,total=this.manifest.protocol.steps;
  for(let i=0;i<313;i++){
   const g=gradient[i]*clip;this.m[i]+=(1-.9)*(g-this.m[i]);this.v[i]=.999*this.v[i]+(1-.999)*g*g;
   const lr=1e-6+(this.p.learning_rates[i]-1e-6)*(1+Math.cos(Math.PI*at/total))/2;
   values[i]-=lr*(this.m[i]/(1-.9**k))/(Math.sqrt(this.v[i]/(1-.999**k))+1e-8);
  }
  for(let i=304;i<312;i++)values[i]=Math.min(10,Math.max(-12,values[i]));
  unpack(this.p,values);this.step=k;
  return {step:k,loss,parameters:values,seconds:(performance.now()-begin)/1000};
 }
 validate(windows){
  const values=[];
  for(const b of windows){
   const y=compactForward(b.input,this.p,this.bq).output.slice(this.p.context,this.p.context+b.target.length);
   const a=features(y,this.metric).values,t=features(b.target,this.metric).values;
   let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-t[i]);values.push(s/a.length);
  }
  const value=values.reduce((s,x)=>s+x,0)/values.length;
  if(!Number.isFinite(value))throw Error('Nonfinite validation.');
  if(!this.best||value<this.best.validation)this.best={step:this.step,validation:value,parameters:pack(this.p)};
  return value;
 }
 record(row){this.history.push(row);}
 exportModel(){
  const p=structuredClone(this.p);if(this.best)unpack(p,this.best.parameters);
  return {format:'compact-browser067-v1',sample_rate:44100,input_gain:.5,output_gain:p.output_gain,
   pre:p.pre,second:p.second,post:p.post,nl:[p.logs.slice(0,4).map(Math.exp),p.logs.slice(4).map(Math.exp)],
   branch_gain:p.branch,lpf:p.lpf,parallel:true,floor:-1024,biquad:this.manifest.biquad_coefficients,
   runtime_advance:0,comparison_advance:3,selected_step:this.best?.step,
   validation:this.best?.validation,protocol_sha256:this.manifest.protocol_sha256,
   note:'Bounded Float64 browser training model. Not stock SnapTone, firmware or target-qualified weights.'};
 }
}
