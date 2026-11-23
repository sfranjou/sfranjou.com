import {fft,features} from '../browser_lab/mfcc.js';
import {compactForward} from '../browser_lab/compact.js';
export function toeplitz(r,b){
 const n=b.length,a=new Float64Array(n),x=new Float64Array(n);a[0]=1;let variance=r[0];x[0]=b[0]/variance;
 for(let k=1;k<n;k++){
  let reflection=r[k];for(let j=1;j<k;j++)reflection+=a[j]*r[k-j];reflection=-reflection/variance;
  const previous=a.slice();for(let j=1;j<k;j++)a[j]=previous[j]+reflection*previous[k-j];a[k]=reflection;variance*=1-reflection*reflection;
  if(!(variance>0)||!Number.isFinite(variance))throw Error('TRAIN initialization matrix is not positive definite.');
  let residual=b[k];for(let j=0;j<k;j++)residual-=r[k-j]*x[j];const alpha=residual/variance;for(let j=0;j<k;j++)x[j]+=a[k-j]*alpha;x[k]=alpha;
 }
 return x;
}
function correlations(u,t){let n=1;while(n<2*u.length-1)n*=2;const ur=new Float64Array(n),ui=new Float64Array(n),tr=new Float64Array(n),ti=new Float64Array(n);ur.set(u);tr.set(t);fft(ur,ui);fft(tr,ti);for(let i=0;i<n;i++){const a=tr[i]*ur[i]+ti[i]*ui[i],b=ti[i]*ur[i]-tr[i]*ui[i];tr[i]=a;ti[i]=b;ur[i]=ur[i]*ur[i]+ui[i]*ui[i];ui[i]=0;}fft(ur,ui,true);fft(tr,ti,true);return {r:Float64Array.from(ur.slice(0,256),x=>x/n),c:Float64Array.from(tr.slice(0,256),x=>x/n)};}
export async function initialize(template,blocks,metric,bq,notify){
 const probes=blocks.filter(b=>b.drive_db===0).map(b=>({x:b.x.slice(0,132300),t:b.t.slice(0,132300)})),rows=[];let best=null;
 for(const drive of [1,8,64,512,2048])for(const emphasis of [0,.8,.97]){
  await new Promise(r=>setTimeout(r,0));notify(`Generic initialization ${rows.length+1}/15 · TRAIN only`);
  const p=structuredClone(template);p.pre=Array(32).fill(0);p.pre[0]=drive;p.pre[1]=Math.fround(-drive*emphasis);p.post=[1];const r=new Float64Array(256),c=new Float64Array(256);
  for(const probe of probes){const u=compactForward(probe.x,p,bq).cache.postInput,shifted=new Float64Array(probe.t.length);shifted.set(probe.t.subarray(0,probe.t.length-3),3);let sum=0;for(let i=44100;i<shifted.length;i++)sum+=shifted[i]**2;const scale=Math.max(Math.sqrt(sum/(shifted.length-44100)),1e-6);const v=correlations(Float64Array.from(u.slice(44100,probe.x.length),x=>x/scale),Float64Array.from(shifted.slice(44100),x=>x/scale));for(let i=0;i<256;i++){r[i]+=v.r[i];c[i]+=v.c[i];}}
  r[0]+=Math.max(r[0]*1e-4,1e-8);p.post=Array.from(toeplitz(r,c),Math.fround);let score=0;
  for(const probe of probes){const y=compactForward(probe.x,p,bq).output.slice(44100,-64),a=features(y,metric).values,t=features(probe.t.slice(44100,-64),metric).values;let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-t[i]);score+=sum/a.length/probes.length;}
  rows.push({drive,emphasis,train_mfcc:score});if(!best||score<best.score)best={p,score};
 }
 const p=best.p;p.learning_rates=[];for(const h of [p.pre,p.second,p.post]){const rms=Math.sqrt(h.reduce((s,x)=>s+x*x,0)/h.length),lr=.002*Math.max(rms,.001);p.learning_rates.push(...h.map(()=>lr));}p.learning_rates.push(...Array(8).fill(.0007),.003);
 return {parameters:p,rows,method:'Generic15starts, TRAIN-only ridge256postLS, TRAIN MFCCselection; no amp checkpoint'};
}
