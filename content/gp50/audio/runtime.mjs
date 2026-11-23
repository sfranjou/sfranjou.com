// Source-owned audio algorithms compiled to WASM; no pedal/firmware emulation here.
export class DspRuntime {
  static async create(bytes, splineFilter) {
    const module = bytes instanceof WebAssembly.Module ? bytes : await WebAssembly.compile(bytes);
    const {exports:e}=await WebAssembly.instantiate(module,{});
    e._initialize?.();
    const runtime = new DspRuntime(e);
    if (splineFilter) runtime.setSplineFilter(splineFilter);
    return runtime;
  }
  constructor(exports) {this.e=exports;this.audio=new Float32Array(exports.memory.buffer,exports.buffer(),128);exports.reset();this.loaded=new Map();}
  setSplineFilter(filter) {
    if (filter.length !== 40 || !filter.every(Number.isFinite)) throw Error('Invalid LTTC filter.');
    const e = this.e;
    new Float32Array(e.memory.buffer, e.spline_filter_buffer(), 40).set(filter);
    e.enable_spline_filter();
  }
  configure(state,record=null,reset=false) {
    const e=this.e;
    if(reset){e.reset();this.loaded.clear();}
    new Float32Array(e.memory.buffer,e.parameter_buffer(),80).set(state.params.flat());
    for(let g=0;g<10;g++) if(e.configure(g,state.models[g],state.enabled[g]?1:0))throw Error(`Unsupported enabled block ${g}.`);
    for(let i=0;i<10;i++)e.set_order(i,state.order[i]);
    for (const group of [2,9]) {
      if (!state.enabled[group]) { this.loaded.delete(group); continue; }
      const bytes = record instanceof Uint8Array ? (group === 9 ? record : null) : record?.[group];
      if (bytes?.length !== 2696) throw Error('Load a supported capture into the selected demo slot first.');
      const old = this.loaded.get(group);
      if (old?.model === state.models[group] && bytes.every((x,i)=>x===old.bytes[i])) continue;
      new Uint8Array(e.memory.buffer,e.record_buffer(),2696).set(bytes);
      if(e.load_capture(group))throw Error('The audio engine rejected this capture.');
      this.loaded.set(group, {model:state.models[group],bytes:bytes.slice()});
    }
  }
  process(interleaved) {
    if(interleaved.length!==128)throw Error('DSP requires exactly 64 stereo frames.');
    const data=this.audio;data.set(interleaved);
    const code=this.e.process();if(code)throw Error(`DSP stopped (${code}).`);interleaved.set(data);return interleaved;
  }
}
