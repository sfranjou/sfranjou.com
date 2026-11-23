import {DspRuntime} from './runtime.mjs';
// Fixed 64-frame adaptation FIFO; no buffer-size assumption about browser callbacks.
class SourcePedal extends AudioWorkletProcessor {
  constructor(){super();this.input=new Float32Array(128);this.output=new Float32Array(128);this.at=0;this.ready=false;this.frames=0;this.peak=0;this.time=0;this.max=0;
    this.port.onmessage=async({data})=>{
      try{
        if(data.type==='init'){this.dsp=await DspRuntime.create(data.module,data.splineFilter);this.apply(data);this.port.postMessage({type:'ready'});}
        if(data.type==='spline-filter'&&this.dsp)this.dsp.setSplineFilter(data.splineFilter);
        if(data.type==='configure'&&this.dsp)this.apply(data);
      }catch(e){this.ready=false;this.output.fill(0);this.port.postMessage({type:'error',message:e.message});}
    };
  }
  apply(data){this.ready=false;this.dsp.configure(data.state,data.record,data.reset);if(data.reset){this.at=0;this.input.fill(0);this.output.fill(0);}this.ready=true;}
  process(inputs,outputs){
    const start=globalThis.performance?.now?.();const out=outputs[0];if(!out?.length)return true;
    if(!this.ready){for(const c of out)c.fill(0);return true;}
    const source=inputs[0]?.[0];
    for(let i=0;i<out[0].length;i++){
      // Consume the previous block before producing a replacement: exactly 64 frames of adapter delay.
      for(let c=0;c<out.length;c++)out[c][i]=this.output[2*this.at+Math.min(c,1)];
      const x=source?.[i]||0;this.input[2*this.at]=this.input[2*this.at+1]=Number.isFinite(x)?x:0;
      this.peak=Math.max(this.peak,Math.abs(out[0][i]));
      if(++this.at===64){this.at=0;try{this.dsp.process(this.input);this.output.set(this.input);}catch(e){this.ready=false;this.output.fill(0);for(const c of out)c.fill(0);this.port.postMessage({type:'error',message:e.message});break;}}
    }
    const elapsed=start===undefined?null:performance.now()-start;if(elapsed!==null){this.time+=elapsed;this.max=Math.max(this.max,elapsed);}
    this.frames+=out[0].length;
    if(this.frames>=sampleRate){this.port.postMessage({type:'stats',frames:this.frames,peak:this.peak,computeRatio:elapsed===null?null:this.time/(this.frames/sampleRate*1000),maxCallbackMs:elapsed===null?null:this.max,leases:[this.dsp.e.lease_state(1),this.dsp.e.lease_state(7)]});this.frames=0;this.peak=this.time=this.max=0;}
    return true;
  }
}
registerProcessor('gp50-source-audio',SourcePedal);
