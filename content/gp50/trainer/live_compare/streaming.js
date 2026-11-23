// Causal reference runtime for compact32/16->256. No comparison advance here.
class FIR{
 constructor(h){this.h=Float64Array.from(h);this.x=new Float64Array(h.length);this.at=0;}
 sample(value){this.x[this.at]=value;let y=0,j=this.at;for(let k=0;k<this.h.length;k++){y+=this.h[k]*this.x[j];if(--j<0)j=this.x.length-1;}if(++this.at===this.x.length)this.at=0;return y;}
}
function curve(x,p,floor){const positive=x>=0;let e=1+Math.max((positive?-p[2]:p[3])*x,floor)/1024;for(let j=0;j<10;j++)e*=e;return positive?p[0]*(1-e):p[1]*(e-1);}
export class CompactStream{
 constructor(m){
  if(m.sample_rate!==44100||m.pre?.length!==32||m.second?.length!==16||m.post?.length!==256||m.lpf?.length!==40||m.biquad?.length!==5||m.parallel!==true||m.floor!==-1024)throw Error('This runtime requires qualified parallel compact32/16/256 geometry,44.1kHz,floor-1024.');
  if(!Array.isArray(m.nl)||m.nl.length!==2||m.nl.some(a=>!Array.isArray(a)||a.length!==4||a.some(x=>!(x>0)||x>1e6))||!Number.isFinite(m.branch_gain)||Math.abs(m.branch_gain)>100||!Number.isFinite(m.input_gain)||m.input_gain<0||m.input_gain>4||!Number.isFinite(m.output_gain)||m.output_gain<0||m.output_gain>8)throw Error('Invalid compact scalar/nonlinearity contract');
  const a1=m.biquad[3],a2=m.biquad[4];if(!(Math.abs(a2)<1&&1+a1+a2>0&&1-a1+a2>0))throw Error('Unstable compact biquad');
  for(const list of [m.pre,m.second,m.post,m.lpf,m.biquad,...m.nl])if(list.some(x=>!Number.isFinite(x)||Math.abs(x)>1e6))throw Error('Nonfinite compact coefficients');
  this.b0=m.biquad[0];this.b1=m.biquad[1];this.b2=m.biquad[2];this.a1=m.biquad[3];this.a2=m.biquad[4];this.m=m;this.pre=new FIR(m.pre);this.second=new FIR(m.second);this.lpf=new FIR(m.lpf);this.post=new FIR(m.post);this.prev0=0;this.prev1=0;this.x1=0;this.x2=0;this.y1=0;this.y2=0;
 }
 sample(input){
  const a=this.pre.sample(input*this.m.input_gain),b=this.second.sample(input*this.m.input_gain),da=a-this.prev0,db=b-this.prev1;let down=0;
  for(let j=0;j<4;j++){const u=j===3?a:this.prev0+da*j/3,v=j===3?b:this.prev1+db*j/3;down=this.lpf.sample(curve(u,this.m.nl[0],this.m.floor)+this.m.branch_gain*curve(v,this.m.nl[1],this.m.floor));}
  this.prev0=a;this.prev1=b;const y=this.b0*down+this.b1*this.x1+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;
  this.x2=this.x1;this.x1=down;this.y2=this.y1;this.y1=y;return this.post.sample(y*this.m.output_gain);
 }
 process(input){return Float64Array.from(input,x=>this.sample(x));}
}
// Zero-phase polyphase FIR with explicit lookahead; callers timestamp outputs
// and buffer them to a common causal delay. Never pretend rate conversion is free.
export class Resampler{
 constructor(up,down,h){this.up=up;this.down=down;this.h=h;this.delay=(h.length-1)/2;this.history=new Float64Array(Math.ceil(h.length/up)+4);this.input=-1;this.output=0;}
 push(value,sink){
  this.input++;this.history[this.input%this.history.length]=value;
  while(Math.floor((this.output*this.down+this.delay)/this.up)<=this.input){
   const position=this.output*this.down+this.delay,lo=Math.max(0,Math.ceil((position-(this.h.length-1))/this.up)),hi=Math.floor(position/this.up);let y=0;
   for(let i=lo;i<=hi;i++)y+=this.history[i%this.history.length]*this.h[position-i*this.up];
   sink(y,this.output++);
  }
 }
}
