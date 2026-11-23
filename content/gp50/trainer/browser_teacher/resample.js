import {Resampler} from '../live_compare/streaming.js';
export function convertRate(input,from,to,taps){
 if(from===to)return Float64Array.from(input);
 const up=from===44100?160:147,down=from===44100?147:160;
 if(![44100,48000].includes(from)||![44100,48000].includes(to))throw Error('Only44.1/48kHzconversion qualified.');
 const n=Math.ceil(input.length*up/down),out=new Float64Array(n),r=new Resampler(up,down,taps[`${up}_${down}`]);let count=0;
 const sink=v=>{if(count<n)out[count++]=v;};for(const x of input)r.push(x,sink);while(count<n)r.push(0,sink);return out;
}
