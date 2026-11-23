import {fft,lossAndGradient} from './mfcc.js';

function fir(x,h){
  const out=new Float64Array(x.length);
  for(let i=0;i<x.length;i++){let s=0;for(let k=0;k<h.length&&k<=i;k++)s+=h[k]*x[i-k];out[i]=s;}
  return out;
}
function fftfir(x,h){
  let n=1;while(n<x.length+h.length-1)n*=2;
  const re=new Float64Array(n),im=new Float64Array(n),hr=new Float64Array(n),hi=new Float64Array(n);
  re.set(x);hr.set(h);fft(re,im);fft(hr,hi);
  for(let i=0;i<n;i++){const a=re[i]*hr[i]-im[i]*hi[i];im[i]=re[i]*hi[i]+im[i]*hr[i];re[i]=a;}
  fft(re,im,true);return Float64Array.from(re.subarray(0,x.length),v=>v/n);
}
function adjoint(g,h,large=false){const r=Float64Array.from(g).reverse();return (large?fftfir(r,h):fir(r,h)).reverse();}
function dh(x,g,n){const out=new Float64Array(n);for(let k=0;k<n;k++){let s=0;for(let i=k;i<x.length;i++)s+=g[i]*x[i-k];out[k]=s;}return out;}
function interp(x){const out=new Float64Array(x.length*4);for(let i=0;i<x.length;i++){const p=i?x[i-1]:0,d=x[i]-p;out.set([p,p+d/3,p+2*d/3,x[i]],4*i);}return out;}
function interpBack(g){const out=new Float64Array(g.length/4);for(let i=0;i<out.length;i++){out[i]+=g[4*i+1]/3+2*g[4*i+2]/3+g[4*i+3];if(i)out[i-1]+=g[4*i]+2*g[4*i+1]/3+g[4*i+2]/3;}return out;}
function curve(x,logs,g=null){
  const p=logs.map(Math.exp),out=new Float64Array(x.length),dx=g?new Float64Array(x.length):null,dl=new Float64Array(4);
  for(let i=0;i<x.length;i++){
    const positive=x[i]>=0,a=p[positive?0:1],slope=p[positive?2:3],raw=(positive?-1:1)*slope*x[i];
    let e=1+Math.max(raw,-1024)/1024,der=raw>=-1024?1/1024:0;
    for(let j=0;j<10;j++){der=2*e*der;e*=e;}
    const y=positive?a*(1-e):a*(e-1);out[i]=y;
    if(g){dx[i]=g[i]*a*der*slope;dl[positive?0:1]+=g[i]*y;dl[positive?2:3]+=g[i]*a*der*slope*x[i];}
  }
  return {out,dx,dl};
}

export function compactForward(input,p,bq){
  const raw=new Float64Array(input.length+3);for(let i=0;i<input.length;i++)raw[i]=input[i]*.5;
  const pre=fir(raw,p.pre),secondary=fir(raw,p.second),up0=interp(pre),up1=interp(secondary);
  const a=curve(up0,p.logs.slice(0,4)),b=curve(up1,p.logs.slice(4));
  const mixed=Float64Array.from(a.out,(v,i)=>v+p.branch*b.out[i]),filtered=fir(mixed,p.lpf);
  const down=new Float64Array(raw.length);for(let i=0;i<down.length;i++)down[i]=filtered[4*i+3];
  const postInput=Float64Array.from(fftfir(down,bq),v=>v*p.output_gain),post=fir(postInput,p.post);
  const output=post.slice(3,3+input.length);
  return {output,cache:{raw,up0,up1,b,postInput,post}};
}

export function compactStep(input,target,p,bq,metric){
  const {output,cache}=compactForward(input,p,bq),{raw,up0,up1,b,postInput,post}=cache;
  const scored=output.slice(p.context,p.context+target.length);
  const loss=lossAndGradient(scored,target,metric),gpost=new Float64Array(post.length);
  for(let i=0;i<target.length;i++)gpost[p.context+3+i]=loss.gradient[i]/10;
  const postGrad=dh(postInput,gpost,p.post.length),gpostInput=adjoint(gpost,p.post);
  const gbq=Float64Array.from(gpostInput,v=>v*p.output_gain),gdown=adjoint(gbq,bq,true);
  const gfiltered=new Float64Array(up0.length);for(let i=0;i<gdown.length;i++)gfiltered[4*i+3]=gdown[i];
  const gmixed=adjoint(gfiltered,p.lpf);let branchGrad=0;
  for(let i=0;i<gmixed.length;i++)branchGrad+=gmixed[i]*b.out[i];
  const ca=curve(up0,p.logs.slice(0,4),gmixed);
  const cb=curve(up1,p.logs.slice(4),Float64Array.from(gmixed,v=>v*p.branch));
  const grads=[...dh(raw,interpBack(ca.dx),p.pre.length),...dh(raw,interpBack(cb.dx),p.second.length),
    ...postGrad,...ca.dl,...cb.dl,branchGrad];
  const parameters=[...p.pre,...p.second,...p.post,...p.logs,p.branch];
  const norm=Math.sqrt(grads.reduce((s,g)=>s+g*g,0)),scale=Math.min(1,p.clip_norm/(norm+1e-6));
  const updated=parameters.map((v,i)=>{
    const g=grads[i]*scale,m=.1*g,vv=.001*g*g;
    return v-p.learning_rates[i]*(m/(1-.9))/(Math.sqrt(vv/(1-.999))+1e-8);
  });
  return {loss:loss.loss/10,output:scored,gradient:grads,updated};
}

export function qualifyCompact(fixture,arrays,metric){
  const start=performance.now(),got=compactStep(arrays.input,arrays.target,fixture.parameters,arrays.biquad_ir,metric);
  const error=(a,b)=>{let d=0,n=0,max=0;for(let i=0;i<a.length;i++){const x=a[i]-b[i];d+=x*x;n+=b[i]*b[i];max=Math.max(max,Math.abs(x));}return {relative_rms:Math.sqrt(d/Math.max(n,1e-100)),max_absolute:max};};
  const output=error(got.output,arrays.output),gradient=error(got.gradient,arrays.gradient),update=error(got.updated,arrays.updated);
  const lossError=Math.abs(got.loss-fixture.loss),g=fixture.gates;
  return {status:output.relative_rms<g.output_relative_rms&&gradient.relative_rms<g.gradient_relative_rms&&update.max_absolute<g.update_max_absolute&&lossError<g.loss_absolute?'passed':'failed',
    loss:got.loss,torch_loss:fixture.loss,loss_absolute_error:lossError,output,gradient,update,parameters:got.gradient.length,
    seconds:(performance.now()-start)/1000,gates:g,
    scope:'One full compact Peavey forward/backward and Adam step versus Float64Torch, fixed original IR. Not Float32training parity or convergence.'};
}
