// Two-curve capture model (GPTC v2) for the browser trainer, Float64 CPU forward/backward. 2026-11-21.
// Same model and plain training parameters as tools/tone_trainer/two_curve.py PlainTwoCurve:
//   x*0.5 -> FIR32 -> 4x interp -> *e^in0 -> curve v1 -> *e^out0 -> FIR16 (4x) -> *e^in1 -> curve v2 -> *e^out1
//   -> fixed LPF40 (phase 3) -> fixed biquad IR -> *output_gain -> FIR256.
// Parameter vector order: pre32, inter16, post256, v1 33, v2 33, log_in 2, log_out 2 (374).
import {fft,lossAndGradient} from './mfcc.js';

const BITS=[0xc1800000,0xc14e0567,0xc125c07f,0xc1054b6a,0xc0d63d18,0xc0abfc30,0xc089d653,0xc05c5ef7,0xc02f741a,0xc00ace1d,
 0xbfd965ac,0xbfa76e0c,0xbf7ab4fe,0xbf325eb6,0xbee4e0fd,0xbe5f9c0c,0x0,0x3e5f9c0c,0x3ee4e0fd,0x3f325eb6,0x3f7ab4fe,0x3fa76e0c,
 0x3fd965ac,0x400ace1d,0x402f741a,0x405c5ef7,0x4089d653,0x40abfc30,0x40d63d18,0x41054b6a,0x4125c07f,0x414e0567,0x41800000];
export const KNOTS=Float64Array.from(BITS,b=>{const v=new DataView(new ArrayBuffer(4));v.setUint32(0,b);return v.getFloat32(0);});
export const SIZE=374;

function fir(x,h){const out=new Float64Array(x.length);for(let i=0;i<x.length;i++){let s=0;for(let k=0;k<h.length&&k<=i;k++)s+=h[k]*x[i-k];out[i]=s;}return out;}
function fftfir(x,h){
 let n=1;while(n<x.length+h.length-1)n*=2;
 const re=new Float64Array(n),im=new Float64Array(n),hr=new Float64Array(n),hi=new Float64Array(n);
 re.set(x);hr.set(h);fft(re,im);fft(hr,hi);
 for(let i=0;i<n;i++){const a=re[i]*hr[i]-im[i]*hi[i];im[i]=re[i]*hi[i]+im[i]*hr[i];re[i]=a;}
 fft(re,im,true);return Float64Array.from(re.subarray(0,x.length),v=>v/n);
}
function adjoint(g,h,large=false){const r=Float64Array.from(g).reverse();return (large||h.length>64?fftfir(r,h):fir(r,h)).reverse();}
function dh(x,g,n){const out=new Float64Array(n);for(let k=0;k<n;k++){let s=0;for(let i=k;i<x.length;i++)s+=g[i]*x[i-k];out[k]=s;}return out;}
function interp(x){const out=new Float64Array(x.length*4);for(let i=0;i<x.length;i++){const p=i?x[i-1]:0,d=x[i]-p;out.set([p,p+d/3,p+2*d/3,x[i]],4*i);}return out;}
function interpBack(g){const out=new Float64Array(g.length/4);for(let i=0;i<out.length;i++){out[i]+=g[4*i+1]/3+2*g[4*i+2]/3+g[4*i+3];if(i)out[i-1]+=g[4*i]+2*g[4*i+1]/3+g[4*i+2]/3;}return out;}
// Segment = first knot index >= z (torch.bucketize, right=False), clamped to 1..32, minus 1.
function segment(z){let lo=0,hi=33;while(lo<hi){const mid=(lo+hi)>>1;if(KNOTS[mid]<z)lo=mid+1;else hi=mid;}return Math.min(32,Math.max(1,lo))-1;}
function curve(z,v){
 const c=v[16],out=new Float64Array(z.length),slope=new Float64Array(z.length),seg=new Int32Array(z.length),frac=new Float64Array(z.length);
 for(let i=0;i<z.length;i++){const p=segment(z[i]),d=KNOTS[p+1]-KNOTS[p],f=(z[i]-KNOTS[p])/d,a=v[p]-c,b=v[p+1]-c;
  out[i]=a+f*(b-a);slope[i]=(b-a)/d;seg[i]=p;frac[i]=f;}
 return {out,slope,seg,frac};
}
function curveBack(g,cv){const gv=new Float64Array(33);for(let i=0;i<g.length;i++){const p=cv.seg[i],f=cv.frac[i];gv[p]+=g[i]*(1-f);gv[p+1]+=g[i]*f;gv[16]-=g[i];}return gv;}

export function twoCurveForward(input,p,bq){
 const gi=p.log_in.map(Math.exp),go=p.log_out.map(Math.exp);
 const raw=new Float64Array(input.length+3);for(let i=0;i<input.length;i++)raw[i]=input[i]*.5;
 const pre=fir(raw,p.pre),up=interp(pre),z1=Float64Array.from(up,v=>v*gi[0]),c1=curve(z1,p.v1),u1=Float64Array.from(c1.out,v=>v*go[0]);
 const w=fir(u1,p.inter),z2=Float64Array.from(w,v=>v*gi[1]),c2=curve(z2,p.v2),u2=Float64Array.from(c2.out,v=>v*go[1]);
 const filtered=fir(u2,p.lpf),down=new Float64Array(raw.length);for(let i=0;i<down.length;i++)down[i]=filtered[4*i+3];
 const postInput=Float64Array.from(fftfir(down,bq),v=>v*p.output_gain),post=p.post.length>64?fftfir(postInput,p.post):fir(postInput,p.post);
 return {output:post.slice(3,3+input.length),cache:{raw,z1,c1,u1,z2,c2,u2,postInput,post,gi,go}};
}

export function twoCurveGradient(input,target,p,bq,metric){
 const {output,cache}=twoCurveForward(input,p,bq),{raw,z1,c1,u1,z2,c2,u2,postInput,post,gi,go}=cache;
 const scored=output.slice(p.context,p.context+target.length),loss=lossAndGradient(scored,target,metric);
 const gpost=new Float64Array(post.length);for(let i=0;i<target.length;i++)gpost[p.context+3+i]=loss.gradient[i]/10;
 const gPostH=dh(postInput,gpost,p.post.length),gpostInput=adjoint(gpost,p.post);
 const gdown=adjoint(Float64Array.from(gpostInput,v=>v*p.output_gain),bq,true);
 const gfiltered=new Float64Array(u2.length);for(let i=0;i<gdown.length;i++)gfiltered[4*i+3]=gdown[i];
 const gu2=adjoint(gfiltered,p.lpf);let gOut1=0,gIn1=0,gOut0=0,gIn0=0;
 const gc2=new Float64Array(gu2.length),gz2=new Float64Array(gu2.length);
 for(let i=0;i<gu2.length;i++){gOut1+=gu2[i]*u2[i];gc2[i]=gu2[i]*go[1];gz2[i]=gc2[i]*c2.slope[i];gIn1+=gz2[i]*z2[i];}
 const gv2=curveBack(gc2,c2),gw=Float64Array.from(gz2,v=>v*gi[1]),gInterH=dh(u1,gw,p.inter.length),gu1=adjoint(gw,p.inter);
 const gc1=new Float64Array(gu1.length),gz1=new Float64Array(gu1.length);
 for(let i=0;i<gu1.length;i++){gOut0+=gu1[i]*u1[i];gc1[i]=gu1[i]*go[0];gz1[i]=gc1[i]*c1.slope[i];gIn0+=gz1[i]*z1[i];}
 const gv1=curveBack(gc1,c1),gup=Float64Array.from(gz1,v=>v*gi[0]),gPreH=dh(raw,interpBack(gup),p.pre.length);
 const gradient=[...gPreH,...gInterH,...gPostH,...gv1,...gv2,gIn0,gIn1,gOut0,gOut1];
 return {loss:loss.loss/10,output:scored,gradient};
}
export function pack2(p){return [...p.pre,...p.inter,...p.post,...p.v1,...p.v2,...p.log_in,...p.log_out];}
export function unpack2(p,v){p.pre=v.slice(0,32);p.inter=v.slice(32,48);p.post=v.slice(48,304);p.v1=v.slice(304,337);p.v2=v.slice(337,370);p.log_in=v.slice(370,372);p.log_out=v.slice(372,374);}

// From the GPTC v1 initialisation (browser_convert/initialize.js result): curve 1 = its main clipping curve at the knots,
// curve 2 = identity, FIR16 = delta, gains 0; learning rates as two_curve.PlainTwoCurve.lr_groups.
export function fromCompact(c){
 const a=c.logs.slice(0,4).map(Math.exp),v1=Array.from(KNOTS,x=>{const pos=x>=0,amp=a[pos?0:1],s=a[pos?2:3];let e=1+Math.max((pos?-1:1)*s*x,-1024)/1024;for(let j=0;j<10;j++)e*=e;return pos?amp*(1-e):amp*(e-1);});
 const inter=Array(16).fill(0);inter[0]=1;
 const p={pre:c.pre.slice(),inter,post:c.post.slice(),v1,v2:Array.from(KNOTS),log_in:[0,0],log_out:[0,0],lpf:c.lpf,output_gain:c.output_gain,context:c.context,clip_norm:c.clip_norm??10};
 const rms=h=>Math.max(Math.sqrt(h.reduce((s,x)=>s+x*x,0)/h.length),.001);
 p.learning_rates=[...p.pre.map(()=>.002*rms(p.pre)),...inter.map(()=>.002*rms(inter)),...p.post.map(()=>.002*rms(p.post)),...Array(66).fill(.003),...Array(4).fill(.0007)];
 return p;
}
// Exact redundancy-free form (two_curve.PlainTwoCurve.to_two_curve) -> record fields for encodeGPTCv2.
export function exportFields(p){
 const gi=p.log_in.map(Math.exp),go=p.log_out.map(Math.exp),c1=p.v1.map(x=>(x-p.v1[16])*go[0]),c2=p.v2.map(x=>(x-p.v2[16])*go[1]);
 const n1=Math.hypot(...c1),n2=Math.hypot(...c2);
 return {pre:p.pre.map(x=>x*gi[0]),inter:p.inter.map(x=>x*n1*gi[1]),post:p.post.map(x=>x*n2),v1:c1.map(x=>x/n1),v2:c2.map(x=>x/n2)};
}
// GPTC v2 record, same layout/checksum as sdk/tone_core/spline_record.py encode().
export function encodeGPTCv2(f,inputGain=.5,outputGain=1.25594995){
 const bytes=new Uint8Array(2696),view=new DataView(bytes.buffer);bytes.set([71,80,84,67]);
 [2,2696,33,32,16,256,0,0].forEach((v,i)=>view.setUint32(4+4*i,v,true));view.setFloat32(36,inputGain,true);view.setFloat32(40,outputGain,true);
 const put=(at,values)=>{for(const [i,x] of values.entries()){if(!Number.isFinite(x)||Math.abs(x)>1e6)throw Error('Invalid export coefficient');view.setFloat32(at+4*i,x,true);}};
 const v1=f.v1.slice(),v2=f.v2.slice();v1[16]=0;v2[16]=0;
 put(48,f.pre.slice().reverse());put(176,f.inter.slice().reverse());put(240,v1);put(372,v2);
 const spectra=[];for(let q=0;q<4;q++){const re=new Float64Array(128),im=new Float64Array(128);re.set(f.post.slice(64*q,64*q+64));fft(re,im);for(let k=0;k<=64;k++)spectra.push(re[k]/128,im[k]/128);}
 put(504,spectra);let h=2166136261;for(let i=0;i<bytes.length;i++)if(i<44||i>=48)h=Math.imul(h^bytes[i],16777619)>>>0;view.setUint32(44,h,true);return bytes;
}
