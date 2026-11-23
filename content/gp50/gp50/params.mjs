// Effect catalog + parameter rules, ported from protocol/catalog.py and protocol/param_rules.py (rules observed on a
// GP-50, analysis/firmware/HOST_EFFECT_CONTROL.md): values are clamped to [min, max] and rounded
// (half up) to a multiple of the step in float32; a Sync switch change resets its Rate (on: note index 4, off: 0.5);
// while Sync is on the Rate is a note index 0..10.

export const f32 = Math.fround;
export const SYNC_ON_RATE = 4, SYNC_OFF_RATE = 0.5, NOTE_INDEX_MAX = 10;

export class Catalog {
  /** doc = web/gp50/catalog.json (scripts/export_web_catalog.py). */
  constructor(doc) { this.doc = doc; this.groups = doc.groups; this.effects = doc.effects; }
  static async load(url = new URL('./catalog.json', import.meta.url)) { return new Catalog(await (await fetch(url)).json()); }
  effectsOf(group) { return this.effects.filter((e) => e.group === group); }
  find(group, id) { return this.effects.find((e) => e.group === group && e.id === id) || null; }
  /** Whether 11 47 may select this id: a catalog effect, an N->S slot 0x0f0000ss (ss < 80) a factory cab 0x0a000000..3c, or user IR 0x0a100000..13. */
  valid(group, id) { return !!this.find(group, id) || (group === 9 && id >>> 8 === 0x0f0000 && (id & 0xff) < 80) || (group === 4 && ((id >= 0x0a000000 && id <= 0x0a00003c) || (id >= 0x0a100000 && id < 0x0a100014))); }
  /** The model the pedal reports for a block; CAB/N->S ids carry a slot in the low byte (one catalog entry each). */
  describe(group, id) { return this.find(group, id) || (group === 9 || group === 4 ? this.effectsOf(group)[0] || null : null); }
}

export const parameter = (effect, storage) => effect.parameters.find((p) => p.storage === storage) || null;
export const isSyncSwitch = (p) => p.flags >> 4 === 2;
export const syncSwitchOf = (effect, p) => (p.flags >> 4 === 1 ? parameter(effect, p.flags & 15) : null);
export const companionRate = (effect, p) => (isSyncSwitch(p) ? parameter(effect, p.flags & 15) : null);
/** A two-valued parameter (0/1 switch): what the footswitch assignment and on/off UI controls can drive. */
export const isBinary = (p) => p.min === 0 && p.max === 1 && p.step === 1;

/** Clamp and round as the firmware does (non-synced parameter). */
export function coerce(p, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('value must be finite');
  const v = Math.min(Math.max(f32(value), p.min), p.max);
  const r = f32(Math.floor(f32(v / p.step) + 0.5) * p.step);
  return Math.min(Math.max(r, p.min), p.max);
}

/** The block's eight stored floats after one write; throws for a storage index the effect does not have (the firmware
 *  would overwrite its first parameter instead). */
export function predict(effect, stored, storage, value) {
  const s = stored.map(f32), p = parameter(effect, storage);
  if (!p) throw new RangeError(`storage index ${storage} is not a parameter of ${effect.name}`);
  const sw = syncSwitchOf(effect, p);
  if (sw && s[sw.storage] === 1) { s[storage] = f32(Math.floor(Math.min(Math.max(value, 0), NOTE_INDEX_MAX) + 0.5)); return s; }
  const v = coerce(p, value);
  if (isSyncSwitch(p) && v !== s[storage]) { const rate = companionRate(effect, p); if (rate) s[rate.storage] = v === 1 ? SYNC_ON_RATE : SYNC_OFF_RATE; }
  s[storage] = v;
  return s;
}
