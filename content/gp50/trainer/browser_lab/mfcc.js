// Dependency-free CPU reference port of PaperMFCC050. Float64 arithmetic with
// the exact exported float32 Torch coefficients; no change to the objective.
// This module runs in a Worker, and also in Node for numerical qualification.
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i=1,j=0;i<n;i++) {
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let size=2;size<=n;size*=2){
    const angle=(inverse?2:-2)*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let start=0;start<n;start+=size){
      let ar=1,ai=0;
      for(let k=0;k<size/2;k++){
        const a=start+k,b=a+size/2;
        const br=re[b]*ar-im[b]*ai,bi=re[b]*ai+im[b]*ar;
        re[b]=re[a]-br;im[b]=im[a]-bi;re[a]+=br;im[a]+=bi;
        const nr=ar*wr-ai*wi;ai=ar*wi+ai*wr;ar=nr;
      }
    }
  }
  // Both directions are unnormalised. The inverse is the forward adjoint.
}

export function features(x,c,keep=false){
  const nfft=2048,bins=1025,frames=1+Math.floor(x.length/512);
  const db=new Float64Array(128*frames),raw=new Float64Array(db.length);
  const spectra=keep?[]:null;
  let maximum=-Infinity;
  for(let frame=0;frame<frames;frame++){
    const re=new Float64Array(nfft),im=new Float64Array(nfft);
    for(let j=0;j<nfft;j++){
      const at=frame*512+j-1024;
      if(at>=0&&at<x.length)re[j]=x[at]*c.window[j];
    }
    fft(re,im);
    if(keep)spectra.push({re,im});
    const power=new Float64Array(bins);
    for(let k=0;k<bins;k++)power[k]=re[k]*re[k]+im[k]*im[k];
    for(let m=0;m<128;m++){
      const filter=c.mel[m];let value=0;
      for(let j=0;j<filter.indices.length;j++)value+=filter.weights[j]*power[filter.indices[j]];
      const at=m*frames+frame;raw[at]=value;db[at]=10*Math.log10(Math.max(value,1e-10));
      maximum=Math.max(maximum,db[at]);
    }
  }
  const floor=maximum-80,out=new Float64Array(20*frames);
  for(let q=0;q<20;q++)for(let t=0;t<frames;t++){
    let v=0;for(let m=0;m<128;m++)v+=c.dct[q][m]*Math.max(db[m*frames+t],floor);
    out[q*frames+t]=v;
  }
  return {values:out,frames,...(keep?{db,raw,maximum,spectra}: {})};
}

export function lossAndGradient(y,target,c){
  if(y.length!==target.length)throw Error('Mismatched signals');
  const a=features(y,c,true),b=features(target,c),frames=a.frames,count=a.values.length;
  const dg=new Float64Array(a.db.length);let loss=0;
  for(let q=0;q<20;q++)for(let t=0;t<frames;t++){
    const at=q*frames+t,diff=a.values[at]-b.values[at];loss+=Math.abs(diff)/count;
    const g=Math.sign(diff)/count;
    for(let m=0;m<128;m++)dg[m*frames+t]+=c.dct[q][m]*g;
  }
  // Torch maximum splits equal arguments; amax divides gradients across ties.
  const floor=a.maximum-80;let maxGradient=0,ties=0;
  for(let i=0;i<dg.length;i++){
    if(a.db[i]===a.maximum)ties++;
    if(a.db[i]<floor){maxGradient+=dg[i];dg[i]=0;}
    else if(a.db[i]===floor){maxGradient+=dg[i]/2;dg[i]/=2;}
  }
  for(let i=0;i<dg.length;i++){
    if(a.db[i]===a.maximum)dg[i]+=maxGradient/ties;
    dg[i]=a.raw[i]>=1e-10?dg[i]*10/(Math.LN10*a.raw[i]):0;
  }
  const gradient=new Float64Array(y.length);
  for(let t=0;t<frames;t++){
    const powerGradient=new Float64Array(1025);
    for(let m=0;m<128;m++){
      const filter=c.mel[m],g=dg[m*frames+t];
      for(let j=0;j<filter.indices.length;j++)powerGradient[filter.indices[j]]+=g*filter.weights[j];
    }
    const re=new Float64Array(2048),im=new Float64Array(2048),s=a.spectra[t];
    for(let k=0;k<1025;k++){re[k]=2*s.re[k]*powerGradient[k];im[k]=2*s.im[k]*powerGradient[k];}
    fft(re,im,true);
    for(let j=0;j<2048;j++){
      const at=t*512+j-1024;
      if(at>=0&&at<y.length)gradient[at]+=re[j]*c.window[j];
    }
  }
  return {loss,gradient,features:a.values};
}
