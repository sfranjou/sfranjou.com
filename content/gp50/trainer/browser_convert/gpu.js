import {numpy as np, lax, jit, valueAndGrad, init, defaultDevice, getWebGPUDevice} from '../vendor/jax/index.js';
import {Trainer, pack, unpack} from '../browser_fit/trainer.js';

export const GPU_RECIPE = 'compact-webgpu-jax-1';

function causalFir(x, h) {
  const length = x.shape[1];
  const result = lax.conv(x.reshape([x.shape[0], 1, length]),
    np.flip(h).reshape([1, 1, h.shape[0]]), [1], [[h.shape[0] - 1, 0]]);
  return result.reshape([result.shape[0], length]);
}

function interpolate(x) {
  const batch = x.shape[0];
  const previous = np.pad(x.ref.slice([], [0, x.shape[1] - 1]), [[0, 0], [1, 0]]);
  const delta = x.ref.sub(previous.ref);
  return np.stack([previous.ref, previous.ref.add(delta.ref.div(3)),
    previous.add(delta.mul(2 / 3)), x], 2).reshape([batch, -1]);
}

function curve(x, logs) {
  const positive = x.ref.greaterEqual(0);
  const coefficients = np.exp(logs);
  const amplitude = np.where(positive.ref, coefficients.ref.slice(0), coefficients.ref.slice(1));
  const slope = np.where(positive.ref, coefficients.ref.slice(2), coefficients.slice(3));
  const signed = np.where(positive.ref, x.ref.neg(), x);
  let exponential = np.maximum(slope.mul(signed), -1024).div(1024).add(1);
  for (let i = 0; i < 10; i++) exponential = np.square(exponential);
  return amplitude.mul(np.where(positive, np.subtract(1, exponential.ref), exponential.sub(1)));
}

function fftFir(x, h) {
  const length = x.shape[1];
  let n = 1;
  while (n < length + h.shape[0] - 1) n *= 2;
  const a = np.fft.rfft(np.pad(x, [[0, 0], [0, n - length]]));
  const b = np.fft.rfft(np.pad(h, [[0, n - h.shape[0]]]));
  const real = a.real.ref.mul(b.real.ref).sub(a.imag.ref.mul(b.imag.ref));
  const imag = a.real.mul(b.imag).add(a.imag.mul(b.real));
  return np.fft.irfft({real, imag}).slice([], [0, length]);
}

export function createGraph(parameters, metric, biquad) {
  const mel = Array.from({length: 1025}, () => Array(128).fill(0));
  for (let m = 0; m < 128; m++) {
    for (let j = 0; j < metric.mel[m].indices.length; j++) {
      mel[metric.mel[m].indices[j]][m] = metric.mel[m].weights[j];
    }
  }
  const constants = {
    lpf: np.array(parameters.lpf, {dtype: np.float32}),
    biquad: np.array(Float32Array.from(biquad)),
    window: np.array(metric.window, {dtype: np.float32}),
    mel: np.array(mel, {dtype: np.float32}),
    dct: np.array(metric.dct, {dtype: np.float32}).transpose(),
  };
  function forward(values, input) {
    const raw = np.pad(input.mul(.5), [[0, 0], [0, 3]]);
    const a = curve(interpolate(causalFir(raw.ref, values.ref.slice([0, 32]))), values.ref.slice([304, 308]));
    const b = curve(interpolate(causalFir(raw, values.ref.slice([32, 48]))), values.ref.slice([308, 312]));
    const mixed = a.add(b.mul(values.ref.slice(312)));
    const filtered = causalFir(mixed, constants.lpf.ref);
    const down = filtered.reshape([filtered.shape[0], -1, 4]).slice([], [], 3);
    const shaped = fftFir(down, constants.biquad.ref).mul(parameters.output_gain);
    const post = causalFir(shaped, values.slice([48, 304]));
    return post.slice([], [3]);
  }
  function features(x) {
    const count = x.shape[1], frames = 1 + Math.floor(count / 512);
    const indices = np.arange(frames).reshape([frames, 1]).mul(512)
      .add(np.arange(2048).reshape([1, 2048]));
    const framed = np.take(np.pad(x, [[0, 0], [1024, 1024]]), indices, 1).mul(constants.window.ref);
    const spectrum = np.fft.rfft(framed);
    const power = np.square(spectrum.real).add(np.square(spectrum.imag));
    const db = np.log10(np.maximum(np.matmul(power, constants.mel.ref), 1e-10)).mul(10);
    const floor = db.ref.max([1, 2], {keepdims: true}).sub(80);
    return np.matmul(np.maximum(db, floor), constants.dct.ref);
  }
  const forwardCompiled = jit(forward);
  const featureCompiled = jit(features);
  const lossFunctions = new Map();
  function gradientFor(scoreLength) {
    if (!lossFunctions.has(scoreLength)) {
      lossFunctions.set(scoreLength, jit(valueAndGrad((values, input, targetFeatures) => {
        const output = forward(values, input).slice([], [parameters.context, parameters.context + scoreLength]);
        return np.abs(features(output).sub(targetFeatures)).mean().div(10);
      })));
    }
    return lossFunctions.get(scoreLength);
  }
  return {
    forward: forwardCompiled, features: featureCompiled, gradientFor, featureFn: features,
    dispose() {
      forwardCompiled.dispose(); featureCompiled.dispose();
      for (const f of lossFunctions.values()) f.dispose();
      for (const value of Object.values(constants)) value.dispose();
    },
  };
}

export async function gpuAvailable() {
  const available = await init('webgpu');
  if (!available.includes('webgpu')) throw Error('WebGPU is unavailable in this browser worker. Choose CPU training.');
  defaultDevice('webgpu');
  return getWebGPUDevice();
}

export class GPUTrainer extends Trainer {
  static async create(manifest, metric, biquad, checkpoint) {
    const device = await gpuAvailable();
    const trainer = new GPUTrainer(manifest, metric, biquad, checkpoint);
    trainer.graph = createGraph(trainer.p, metric, biquad);
    trainer.device = device;
    trainer.deviceError = null;
    device.lost.then(info => { trainer.deviceError = Error('GPU device lost: ' + info.message); });
    trainer.backend = 'WebGPU · jax-js 0.1.27 · Float32';
    return trainer;
  }

  async trainBatch(batch) {
    if (this.deviceError) throw this.deviceError;
    const begin = performance.now();
    const x = np.array(batch.flatMap(b => Array.from(b.input)), {shape: [batch.length, batch[0].input.length], dtype: np.float32});
    const target = np.array(batch.flatMap(b => Array.from(b.target)), {shape: [batch.length, batch[0].target.length], dtype: np.float32});
    const targetFeatures = this.graph.features(target);
    const [lossTensor, gradientTensor] = this.graph.gradientFor(batch[0].target.length)(np.array(pack(this.p), {dtype: np.float32}), x, targetFeatures);
    let loss, gradient;
    try {
      [loss, gradient] = await Promise.all([lossTensor.ref.data(), gradientTensor.ref.data()]);
    } finally {
      lossTensor.dispose(); gradientTensor.dispose();
    }
    if (this.deviceError) throw this.deviceError;
    if (!Number.isFinite(loss[0]) || gradient.some(g => !Number.isFinite(g))) throw Error('Nonfinite GPU training value. Last persisted checkpoint retained.');
    // Only the 313 gradients cross to the CPU. Audio, FFTs and backpropagation stay on GPU.
    const norm = Math.hypot(...gradient), clip = Math.min(1, 10 / (norm + 1e-6));
    const values = pack(this.p), at = this.step, k = at + 1;
    for (let i = 0; i < values.length; i++) {
      const g = gradient[i] * clip;
      this.m[i] = .9 * this.m[i] + .1 * g;
      this.v[i] = .999 * this.v[i] + .001 * g * g;
      const rate = 1e-6 + (this.p.learning_rates[i] - 1e-6) * (1 + Math.cos(Math.PI * at / this.manifest.protocol.steps)) / 2;
      values[i] -= rate * (this.m[i] / (1 - .9 ** k)) / (Math.sqrt(this.v[i] / (1 - .999 ** k)) + 1e-8);
    }
    for (let i = 304; i < 312; i++) values[i] = Math.max(-12, Math.min(10, values[i]));
    unpack(this.p, values); this.step = k;
    return {step: k, loss: loss[0], seconds: (performance.now() - begin) / 1000};
  }

  dispose() { this.graph.dispose(); }
}

// ---------------- Two-curve (GPTC v2), 2026-11-21 ----------------
// Same model as browser_lab/two_curve.js (plain 374 parameters). The piecewise-linear curve is written as a sum of
// ramps, exact for linear interpolation with linear tails: y = vc0 + s0 (z - K0) + sum_j (s_j - s_{j-1}) relu(z - K_j).
import {TwoCurveTrainer} from '../browser_fit/two_curve_trainer.js';
import {KNOTS, pack2, unpack2} from '../browser_lab/two_curve.js';
export const GPU_TWO_CURVE_RECIPE = 'two-curve-webgpu-jax-1';

export function createTwoCurveGraph(parameters, metric, biquad) {
  const base = createGraph({...parameters, lpf: parameters.lpf}, metric, biquad);
  const dk = np.array(Float32Array.from({length: 32}, (_, j) => KNOTS[j + 1] - KNOTS[j]));
  const lpf = np.array(parameters.lpf, {dtype: np.float32}), bq = np.array(Float32Array.from(biquad));
  function pwl(z, v) {
    const vc = v.ref.sub(v.slice([16, 17]));
    const s = vc.ref.slice([1, 33]).sub(vc.ref.slice([0, 32])).div(dk.ref);
    let y = vc.slice([0, 1]).add(s.ref.slice([0, 1]).mul(z.ref.sub(KNOTS[0])));
    for (let j = 1; j < 32; j++) {
      const last = j === 31;
      const ds = s.ref.slice([j, j + 1]).sub(s.ref.slice([j - 1, j]));
      y = y.add(ds.mul(np.maximum((last ? z : z.ref).sub(KNOTS[j]), 0)));
    }
    s.dispose();
    return y;
  }
  function forward(values, input) {
    const raw = np.pad(input.mul(.5), [[0, 0], [0, 3]]);
    const gi = np.exp(values.ref.slice([370, 372])), go = np.exp(values.ref.slice([372, 374]));
    const z1 = interpolate(causalFir(raw, values.ref.slice([0, 32]))).mul(gi.ref.slice([0, 1]));
    const u1 = pwl(z1, values.ref.slice([304, 337])).mul(go.ref.slice([0, 1]));
    const z2 = causalFir(u1, values.ref.slice([32, 48])).mul(gi.slice([1, 2]));
    const u2 = pwl(z2, values.ref.slice([337, 370])).mul(go.slice([1, 2]));
    const filtered = causalFir(u2, lpf.ref);
    const down = filtered.reshape([filtered.shape[0], -1, 4]).slice([], [], 3);
    const shaped = fftFir(down, bq.ref).mul(parameters.output_gain);
    return causalFir(shaped, values.slice([48, 304])).slice([], [3]);
  }
  const forwardCompiled = jit(forward), lossFunctions = new Map();
  function gradientFor(scoreLength) {
    if (!lossFunctions.has(scoreLength)) {
      lossFunctions.set(scoreLength, jit(valueAndGrad((values, input, targetFeatures) => {
        const output = forward(values, input).slice([], [parameters.context, parameters.context + scoreLength]);
        return np.abs(base.featureFn(output).sub(targetFeatures)).mean().div(10);
      })));
    }
    return lossFunctions.get(scoreLength);
  }
  return {forward: forwardCompiled, features: base.features, gradientFor,
    dispose() { forwardCompiled.dispose(); for (const f of lossFunctions.values()) f.dispose(); dk.dispose(); lpf.dispose(); bq.dispose(); base.dispose(); }};
}

export class GPUTwoCurveTrainer extends TwoCurveTrainer {
  static async create(manifest, metric, biquad, checkpoint) {
    const device = await gpuAvailable();
    const trainer = new GPUTwoCurveTrainer(manifest, metric, biquad, checkpoint);
    trainer.graph = createTwoCurveGraph(trainer.p, metric, biquad); trainer.device = device; trainer.deviceError = null;
    device.lost.then(info => { trainer.deviceError = Error('GPU device lost: ' + info.message); });
    trainer.backend = 'WebGPU · jax-js 0.1.27 · Float32 · two-curve';
    return trainer;
  }
  async gradient(batch) {
    const x = np.array(batch.flatMap(b => Array.from(b.input)), {shape: [batch.length, batch[0].input.length], dtype: np.float32});
    const target = np.array(batch.flatMap(b => Array.from(b.target)), {shape: [batch.length, batch[0].target.length], dtype: np.float32});
    const targetFeatures = this.graph.features(target);
    const [lossTensor, gradientTensor] = this.graph.gradientFor(batch[0].target.length)(np.array(this.gradientPoint(), {dtype: np.float32}), x, targetFeatures);   // x (Adam) or y (schedule-free)
    try { const [loss, gradient] = await Promise.all([lossTensor.ref.data(), gradientTensor.ref.data()]); return {loss: loss[0], gradient}; }
    finally { lossTensor.dispose(); gradientTensor.dispose(); }
  }
  async trainBatch(batch) {
    if (this.deviceError) throw this.deviceError;
    const begin = performance.now(), {loss, gradient} = await this.gradient(batch);
    if (this.deviceError) throw this.deviceError;
    if (!Number.isFinite(loss) || gradient.some(g => !Number.isFinite(g))) throw Error('Nonfinite GPU training value. Last persisted checkpoint retained.');
    if (this.optimizer === 'schedule_free') { this.scheduleFreeUpdate(Array.from(gradient)); return {step: this.step, loss, seconds: (performance.now() - begin) / 1000}; }
    const norm = Math.hypot(...gradient), clip = Math.min(1, 10 / (norm + 1e-6)), values = pack2(this.p), at = this.step, k = at + 1;
    for (let i = 0; i < values.length; i++) {
      const g = gradient[i] * clip; this.m[i] = .9 * this.m[i] + .1 * g; this.v[i] = .999 * this.v[i] + .001 * g * g;
      const rate = 1e-6 + (this.p.learning_rates[i] - 1e-6) * (1 + Math.cos(Math.PI * at / this.manifest.protocol.steps)) / 2;
      values[i] -= rate * (this.m[i] / (1 - .9 ** k)) / (Math.sqrt(this.v[i] / (1 - .999 ** k)) + 1e-8);
    }
    for (let i = 370; i < 374; i++) values[i] = Math.max(-4, Math.min(4, values[i]));
    unpack2(this.p, values); this.step = k;
    return {step: k, loss, seconds: (performance.now() - begin) / 1000};
  }
  dispose() { this.graph.dispose(); }
}
