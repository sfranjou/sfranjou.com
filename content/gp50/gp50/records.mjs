// N->S records (2,696 bytes) a slot can hold, as NS Capture v6 (firmware MOD054+) reads them by magic:
// VTSI (stock SnapTone), GPTC (compact tone capture), GP5N (our WH formats), GP5P (user coprocessor programs).
// analysis/firmware/TONE_CAPTURE_INTEGRATION.md. Checking before upload matters: a record the pedal rejects plays dry.
import { RECORD_LEN } from './messages.mjs';
export { RECORD_LEN };

export const KINDS = {
  VTSI: 'SnapTone (Valeton tone capture)',
  GPTC: 'Old tone capture (format v1)',
  GPTS: 'LTTC tone capture',
  GP5N: 'NS Capture model (GP5N)',
  GP5P: 'User program (GP5P)',
};

const dv = (r) => new DataView(r.buffer, r.byteOffset, r.byteLength);

/** 'VTSI' | 'GPTC' | 'GPTS' | 'GP5N' | 'GP5P' | null. 'GPTS' = a GPTC-magic record with version 2 (two curves). */
export function recordKind(record) {
  if (record.length < 4) return null;
  const m = String.fromCharCode(...record.subarray(0, 4));
  if (m === 'GPTC' && record.length >= 8 && dv(record).getUint32(4, true) === 2) return 'GPTS';
  return m in KINDS ? m : null;
}

/** GPTC v1 rules of the pedal (sdk/effects/ns_capture_v6, compact_record.validate). null = valid, else the reason. */
export function gptcProblem(record) {
  if (record.length !== RECORD_LEN || recordKind(record) !== 'GPTC') return 'not a 2,696-byte GPTC record';
  const v = dv(record), u = (o) => v.getUint32(o, true), f = (o) => v.getFloat32(o, true);
  const parallel = u(12);
  if (u(4) !== 1 || u(8) !== RECORD_LEN || parallel > 1 || u(16) !== 32 || u(20) !== 16 * parallel || u(24) !== 256) return 'unsupported GPTC version or layout';
  let h = 2166136261;
  for (let i = 0; i < RECORD_LEN; i++) if (i < 44 || i >= 48) h = Math.imul(h ^ record[i], 16777619) >>> 0;
  if (h !== u(44)) return 'checksum mismatch (file damaged)';
  const [branch, floor, ig, og] = [f(28), f(32), f(36), f(40)];
  if (![branch, ig, og].every(Number.isFinite) || !(floor === -1024 || floor === -2047) || Math.abs(branch) > 100 || ig < 0 || ig > 4 || og < 0 || og > 8) return 'gain or nonlinearity settings out of range';
  for (let o = 48; o < 2532; o += 4) { const x = f(o); if (!Number.isFinite(x) || Math.abs(x) > 1e6) return 'coefficient out of range'; }
  for (let o = 240; o < 272; o += 4) if (!(f(o) > 0)) return 'nonlinearity parameter not positive';
  const a1 = f(444), a2 = f(448);
  if (!(a2 < 1 && a2 > -1 && 1 + a1 + a2 > 0 && 1 - a1 + a2 > 0)) return 'unstable filter';
  return null;
}

/** GPTC v2 two-curve ("GPTS") rules of the pedal (sdk/tone_core/spline_record.py validate, ns_capture_v7 ts_check; firmware with
 *  two-curve capture support). null = valid, else the reason. */
export function gptsProblem(record) {
  if (record.length !== RECORD_LEN || recordKind(record) !== 'GPTS') return 'not a 2,696-byte LTTC record';
  const v = dv(record), u = (o) => v.getUint32(o, true), f = (o) => v.getFloat32(o, true);
  if (u(4) !== 2 || u(8) !== RECORD_LEN || u(12) !== 33 || u(16) !== 32 || u(20) !== 16 || u(24) !== 256 || u(28) || u(32)) return 'unsupported GPTS version or layout';
  let h = 2166136261;
  for (let i = 0; i < RECORD_LEN; i++) if (i < 44 || i >= 48) h = Math.imul(h ^ record[i], 16777619) >>> 0;
  if (h !== u(44)) return 'checksum mismatch (file damaged)';
  const ig = f(36), og = f(40);
  if (![ig, og].every(Number.isFinite) || ig < 0 || ig > 4 || og < 0 || og > 8) return 'gain settings out of range';
  for (let o = 48; o < 2584; o += 4) { const x = f(o); if (!Number.isFinite(x) || Math.abs(x) > 1e6) return 'coefficient out of range'; }
  if (u(240 + 64) || u(372 + 64)) return 'curve centre point is not zero';
  for (let o = 2584; o < RECORD_LEN; o++) if (record[o]) return 'non-zero padding';
  return null;
}

/** Stock rule: a VTSI record whose words 6..25 sum to 0 is "Empty" (plays dry). */
export function vtsiEmpty(record) {
  const v = dv(record); let s = 0;
  for (let w = 6; w < 26; w++) s = (s + v.getUint32(4 * w, true)) >>> 0;
  return s === 0;
}

/** {kind, label, ok, problem, info} for a file the user picked; ok = the pedal will play it (as far as checked here). */
export function describeRecord(record) {
  const kind = recordKind(record);
  if (record.length !== RECORD_LEN) return { kind, label: kind ? KINDS[kind] : 'Unknown file', ok: false, problem: `size ${record.length} bytes, expected ${RECORD_LEN}` };
  if (!kind) return { kind, label: 'Unknown file', ok: false, problem: 'not a GP-50 N→S record (unknown format)' };
  const out = { kind, label: KINDS[kind], ok: true, problem: null, info: {} };
  if (kind === 'GPTC') {
    out.problem = gptcProblem(record); out.ok = !out.problem;
    if (out.ok) { const v = dv(record); out.info = { fronts: v.getUint32(12, true) ? 'parallel 32 + 16' : 'single 32', inputGain: v.getFloat32(36, true), outputGain: v.getFloat32(40, true) }; }
  } else if (kind === 'GPTS') {
    out.problem = gptsProblem(record); out.ok = !out.problem;
    if (out.ok) { const v = dv(record); out.info = { fronts: 'two curves + 16-tap filter', inputGain: v.getFloat32(36, true), outputGain: v.getFloat32(40, true) }; }
  } else if (kind === 'VTSI' && vtsiEmpty(record)) { out.ok = false; out.problem = 'empty SnapTone (plays dry)'; }
  return out;
}
