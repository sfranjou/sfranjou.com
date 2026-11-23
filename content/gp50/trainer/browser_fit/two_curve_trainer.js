// Browser CPU trainer for the two-curve model (GPTC v2), same interface as browser_fit/trainer.js Trainer. 2026-11-21.
// Trains the plain parameters (as tools/tone_trainer/two_curve.py PlainTwoCurve), Adam with the same cosine schedule
// and gradient clipping as the GPTC v1 browser trainer; log gains clamped to +-4. Exports the exact redundancy-free
// form as GPTC v2 fields (encodeGPTCv2 in browser_lab/two_curve.js).
// 2026-11-22: a manifest with optimizer 'schedule_free' trains with schedule-free
// AdamW as tools/tone_trainer/engine.py ScheduleFreeAdam (gradient at y=(1-b1)z+b1x, Adam-style step on z with 10x the
// learning rates and a 50-step warmup, x = weighted average of z; this.p holds x, so validation/export see x). A
// manifest without the key (sessions created earlier) keeps Adam+cosine. Checkpoint version 2 = schedule-free state.
import {twoCurveGradient,twoCurveForward,pack2,unpack2,exportFields,SIZE} from '../browser_lab/two_curve.js';
import {features} from '../browser_lab/mfcc.js';

const SF={b1:.9,b2:.999,eps:1e-8,warmup:50,lr:10};
export class TwoCurveTrainer{
 constructor(manifest,metric,bq,checkpoint=null){
  this.architecture='two_curve';this.manifest=manifest;this.metric=metric;this.bq=bq;
  this.p=structuredClone(manifest.parameters);this.step=0;this.m=Array(SIZE).fill(0);this.v=Array(SIZE).fill(0);this.history=[];this.best=null;
  this.optimizer=manifest.optimizer||'adam';if(!['adam','schedule_free'].includes(this.optimizer))throw Error('Unknown optimizer');
  if(this.optimizer==='schedule_free'){this.z=pack2(this.p);this.wsum=0;this.m=null;}
  if(checkpoint)this.restore(checkpoint);
 }
 restore(c){
  const sf=this.optimizer==='schedule_free';
  if(c.version!==(sf?2:1)||sf&&c.optimizer!=='schedule_free'||c.protocol_sha256!==this.manifest.protocol_sha256||!Number.isInteger(c.step)||c.step<0||c.step>this.manifest.protocol.steps)throw Error('Checkpoint belongs to a different training protocol.');
  for(const key of ['parameters',sf?'z':'m','v'])if(!Array.isArray(c[key])||c[key].length!==SIZE||c[key].some(x=>!Number.isFinite(x)))throw Error('Invalid checkpoint '+key);
  if(sf&&!(Number.isFinite(c.wsum)&&c.wsum>=0&&(c.step===0)===(c.wsum===0)))throw Error('Invalid checkpoint wsum');
  this.step=c.step;if(sf){this.z=c.z.slice();this.wsum=c.wsum;}else this.m=c.m.slice();this.v=c.v.slice();this.history=structuredClone(c.history);this.best=structuredClone(c.best);unpack2(this.p,c.parameters);
 }
 checkpoint(){
  const common={architecture:'two_curve',protocol_sha256:this.manifest.protocol_sha256,step:this.step,parameters:pack2(this.p),v:this.v.slice(),history:structuredClone(this.history),best:structuredClone(this.best)};
  return this.optimizer==='schedule_free'?{version:2,optimizer:'schedule_free',...common,z:this.z.slice(),wsum:this.wsum}:{version:1,...common,m:this.m.slice()};
 }
 /** Parameter values the gradient is taken at: x for Adam, y=(1-b1)z+b1x for schedule-free. */
 gradientPoint(){const x=pack2(this.p);return this.optimizer==='schedule_free'?x.map((v,i)=>(1-SF.b1)*this.z[i]+SF.b1*v):x;}
 /** Schedule-free update from a gradient taken at gradientPoint() (clipped to norm 10, log gains clamped +-4 on x). */
 scheduleFreeUpdate(gradient){
  const norm=Math.sqrt(gradient.reduce((s,x)=>s+x*x,0)),clip=Math.min(1,10/(norm+1e-6)),x=pack2(this.p),k=this.step+1;
  const scale=Math.min(1,k/SF.warmup),w=scale*scale;this.wsum+=w;const c=w/this.wsum;
  for(let i=0;i<SIZE;i++){
   const g=gradient[i]*clip;this.v[i]=SF.b2*this.v[i]+(1-SF.b2)*g*g;
   this.z[i]-=SF.lr*this.p.learning_rates[i]*scale*g/(Math.sqrt(this.v[i]/(1-SF.b2**k))+SF.eps);
   x[i]+=c*(this.z[i]-x[i]);
  }
  for(let i=370;i<374;i++)x[i]=Math.min(4,Math.max(-4,x[i]));
  unpack2(this.p,x);this.step=k;
 }
 forward(x){return twoCurveForward(x,this.p,this.bq);}
 trainBatch(batch){
  const begin=performance.now(),gradient=Array(SIZE).fill(0);let loss=0,point=this.p;
  if(this.optimizer==="schedule_free"){point=structuredClone(this.p);unpack2(point,this.gradientPoint());}
  for(const b of batch){const r=twoCurveGradient(b.input,b.target,point,this.bq,this.metric);loss+=r.loss/batch.length;for(let i=0;i<SIZE;i++)gradient[i]+=r.gradient[i]/batch.length;}
  if(!Number.isFinite(loss)||gradient.some(x=>!Number.isFinite(x)))throw Error('Nonfinite training value; previous checkpoint is retained.');
  if(this.optimizer==='schedule_free'){this.scheduleFreeUpdate(gradient);return {step:this.step,loss,seconds:(performance.now()-begin)/1000};}
  const norm=Math.sqrt(gradient.reduce((s,x)=>s+x*x,0)),clip=Math.min(1,10/(norm+1e-6));
  const values=pack2(this.p),at=this.step,k=at+1,total=this.manifest.protocol.steps;
  for(let i=0;i<SIZE;i++){
   const g=gradient[i]*clip;this.m[i]+=(1-.9)*(g-this.m[i]);this.v[i]=.999*this.v[i]+(1-.999)*g*g;
   const lr=1e-6+(this.p.learning_rates[i]-1e-6)*(1+Math.cos(Math.PI*at/total))/2;
   values[i]-=lr*(this.m[i]/(1-.9**k))/(Math.sqrt(this.v[i]/(1-.999**k))+1e-8);
  }
  for(let i=370;i<374;i++)values[i]=Math.min(4,Math.max(-4,values[i]));
  unpack2(this.p,values);this.step=k;
  return {step:k,loss,seconds:(performance.now()-begin)/1000};
 }
 validate(windows){
  const values=[];
  for(const b of windows){const y=this.forward(b.input).output.slice(this.p.context,this.p.context+b.target.length),a=features(y,this.metric).values,t=features(b.target,this.metric).values;let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-t[i]);values.push(s/a.length);}
  const value=values.reduce((s,x)=>s+x,0)/values.length;if(!Number.isFinite(value))throw Error('Nonfinite validation.');
  if(!this.best||value<this.best.validation)this.best={step:this.step,validation:value,parameters:pack2(this.p)};return value;
 }
 record(row){const {parameters,...lean}=row;this.history.push(lean);}
 exportModel(){
  const p=structuredClone(this.p);if(this.best)unpack2(p,this.best.parameters);
  return {format:'two-curve-browser-v1',sample_rate:44100,input_gain:.5,output_gain:p.output_gain,fields:exportFields(p),
   selected_step:this.best?.step,validation:this.best?.validation,protocol_sha256:this.manifest.protocol_sha256,
   note:'Two-curve (GPTC v2) browser fit; plays on firmware with feature bit 9 (MOD153+). Not hardware-qualified weights.'};
 }
}
