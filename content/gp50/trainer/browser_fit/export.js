import {fft} from '../browser_lab/mfcc.js';
// GPTC v1, same public record layout/checksum as compact_record.py.
export function encodeGPTC(model){
 const bytes=new Uint8Array(2696),view=new DataView(bytes.buffer);
 bytes.set([71,80,84,67]);[1,2696,1,32,16,256].forEach((v,i)=>view.setUint32(4+4*i,v,true));
 [model.branch_gain,model.floor,model.input_gain,model.output_gain].forEach((v,i)=>view.setFloat32(28+4*i,v,true));
 function put(at,values){for(const [i,x] of values.entries()){if(!Number.isFinite(x)||Math.abs(x)>1e6)throw Error('Invalid export coefficient');view.setFloat32(at+4*i,x,true);}}
 put(48,model.pre.slice().reverse());put(176,model.second.slice().reverse());put(240,model.nl[0]);put(256,model.nl[1]);put(272,model.lpf.slice().reverse());put(432,model.biquad);
 const spectra=[];
 for(let p=0;p<4;p++){const re=new Float64Array(128),im=new Float64Array(128);re.set(model.post.slice(64*p,64*p+64));fft(re,im);for(let k=0;k<=64;k++)spectra.push(re[k]/128,im[k]/128);}
 put(452,spectra);let h=2166136261;for(let i=0;i<bytes.length;i++)if(i<44||i>=48)h=Math.imul(h^bytes[i],16777619)>>>0;view.setUint32(44,h,true);return bytes;
}
