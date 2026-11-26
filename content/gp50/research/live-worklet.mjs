// Audio thread for the research page's live input. Two processors:
//   'chain': plays a model exported as a JSON chain (see research_live_export_20261126.py)
//   'nam':   plays a NAM A2 Full model with the trainer's teacher.wasm
import createTeacher from '../trainer/browser_teacher/teacher.js';
import {Teacher} from '../trainer/browser_teacher/api.js';

class Fir {
  constructor(h) { this.h = Float64Array.from(h); this.x = new Float64Array(h.length); this.at = 0; }
  sample(value) {
    this.x[this.at] = value;
    let y = 0, j = this.at;
    for (let k = 0; k < this.h.length; k++) { y += this.h[k] * this.x[j]; if (--j < 0) j = this.x.length - 1; }
    if (++this.at === this.x.length) this.at = 0;
    return y;
  }
}

class Biquad {
  constructor([b0, b1, b2, a1, a2]) { Object.assign(this, {b0, b1, b2, a1, a2, x1: 0, x2: 0, y1: 0, y2: 0}); }
  sample(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// A clipping curve stored at points x_i = s * sinh(-A + i * step); linear in between and beyond the ends.
class Curve {
  constructor(y, {n, s, r}) {
    this.y = Float64Array.from(y); this.s = s; this.A = Math.asinh(r / s); this.step = 2 * this.A / (n - 1);
    this.x = Float64Array.from({length: n}, (_, i) => s * Math.sinh(-this.A + i * this.step));
  }
  sample(v) {
    const n = this.y.length;
    let i = Math.floor((Math.asinh(v / this.s) + this.A) / this.step);
    i = Math.min(Math.max(i, 0), n - 2);
    const t = (v - this.x[i]) / (this.x[i + 1] - this.x[i]);
    return this.y[i] + t * (this.y[i + 1] - this.y[i]);
  }
}

class Chain extends AudioWorkletProcessor {
  constructor() {
    super();
    this.spec = null;
    this.port.onmessage = ({data}) => {
      const s = data.spec;
      this.spec = s;
      this.pre = s.preBiquad ? new Biquad(s.preBiquad) : null;
      this.branches = s.branches.map(b => ({
        fir: new Fir(b.fir), weight: b.weight, previous: 0,
        stages: b.stages.map(st => st.type === 'fir' ? new Fir(st.h) : new Curve(st.y, s.grid)),
      }));
      this.lpf = new Fir(s.lpf); this.biquad = new Biquad(s.biquad); this.post = new Fir(s.post);
    };
  }
  sample(input) {
    let x = input * this.spec.gain;
    if (this.pre) x = this.pre.sample(x);
    const sum = [0, 0, 0, 0];
    for (const b of this.branches) {
      const y = b.fir.sample(x), d = y - b.previous;
      for (let j = 0; j < 4; j++) {
        let u = j === 3 ? y : b.previous + d * j / 3;  // 4x linear interpolation
        for (const stage of b.stages) u = stage.sample(u);
        sum[j] += b.weight * u;
      }
      b.previous = y;
    }
    let down = 0;
    for (let j = 0; j < 4; j++) down = this.lpf.sample(sum[j]);  // keep every 4th output
    return this.post.sample(this.biquad.sample(down) * this.spec.vol);
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0], out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      const y = this.spec && input ? this.sample(input[i]) : 0;
      for (const channel of out) channel[i] = Number.isFinite(y) ? y : 0;
    }
    return true;
  }
}

class Nam extends AudioWorkletProcessor {
  constructor() {
    super();
    this.teacher = null;
    this.port.onmessage = async ({data}) => {
      try {
        const module = await createTeacher({wasmBinary: data.wasm});
        this.teacher = new Teacher(module, data.model, 128);
        this.port.postMessage({type: 'ready'});
      } catch (error) {
        this.port.postMessage({type: 'error', message: error.message});
      }
    };
    this.buffer = new Float32Array(128);
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0], out = outputs[0];
    if (!this.teacher || !input) { for (const channel of out) channel.fill(0); return true; }
    this.teacher.process(input, this.buffer);
    for (const channel of out) channel.set(this.buffer.subarray(0, channel.length));
    return true;
  }
}

registerProcessor('chain', Chain);
registerProcessor('nam', Nam);
