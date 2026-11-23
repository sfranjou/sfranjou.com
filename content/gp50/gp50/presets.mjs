// Preset write layout adapted from drewmerc302/valeton-gp50 patch/device_write.py
// and app/static/webmidi_write.js at aadcf9b. Copyright (c) 2026 Andrew Mercurio.
// MIT; see ../THIRD_PARTY.md. Validation is stricter here; no device I/O.
import PRST from './prst.mjs';
import { parseActive, setOrder } from './messages.mjs';
import { splitMessage } from './wire.mjs';

export function presetName(name) {
  if (typeof name !== 'string' || !/^[\x20-\x7e]{1,10}$/.test(name) || !name.trim()) throw new Error('Preset name: 1–10 printable ASCII characters (pedal display limit).');
  return name;
}

/** Reject malformed files before using the upstream marker-based edit helpers.
 * Walk the actual TLVs, then insist that each helper resolves to the structural record. */
export function validatePreset(bytes, catalog = null) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 552) throw new Error('Expected a 552-byte GP-50 .prst file.');
  if (!PRST.GP50.header.every((b, i) => bytes[i] === b)) throw new Error('Expected a GP-50 file header.');
  if (![21, 22, 23, 24].every((i) => bytes[i] === 255)) throw new Error('Invalid preset sentinel.');
  if (PRST.crc8(bytes.subarray(21)) !== bytes[20]) throw new Error('Preset CRC does not match.');
  const fields = new Map(), roots = [];
  const walk = (start, end, nested = false) => {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = start; i < end;) {
      if (i + 4 > end) throw new Error('Truncated preset TLV.');
      const tag = v.getUint16(i, true), n = v.getUint16(i + 2, true), next = i + 4 + n;
      if (next > end) throw new Error('Preset TLV overflows.');
      if (!nested) roots.push([tag, n]);
      if (!nested && tag === 2) walk(i + 4, next, true);
      if (nested) { if (fields.has(tag)) throw new Error('Duplicate tone field.'); fields.set(tag, { offset: i + 4, n }); }
      i = next;
    }
  };
  walk(41, bytes.length);
  if (JSON.stringify(roots) !== JSON.stringify([[255,16],[0,16],[1,59],[2,390],[3,10]])) throw new Error("Unsupported GP-50 preset section layout.");
  for (const [tag, n, locate] of [[0x3001, 4, PRST.bypassOffset], [0x3002, 10, PRST.orderOffset], [0x3003, 40, PRST.modelsOffset], [0x3004, 320, PRST.paramsOffset]]) {
    const f = fields.get(tag);
    if (!f || f.n !== n || locate(bytes) !== f.offset) throw new Error(`Invalid or ambiguous tone field ${tag.toString(16)}.`);
  }
  setOrder(PRST.readOrder(bytes)); // also checks the pedal's atomic core constraint
  if (!PRST.paramFloats(bytes).every(Number.isFinite)) throw new Error('Preset has non-finite parameters.');
  const state = stateOfPreset(bytes);
  if (catalog) state.models.forEach((id, g) => { if (!catalog.valid(g, id)) throw new Error(`Unknown model 0x${id.toString(16)} in block ${g}.`); });
  return state;
}

export function stateOfPreset(bytes) {
  const msg = new Uint8Array(513); msg.set([0x12, 0x41]); msg.set(bytes.subarray(41), 2);
  return parseActive(msg);
}

export function fromActive(name, state) { return PRST.rebuild(name, state.raw.subarray(2)); }
export function parseStoredPreset(msg) {
  // Firmware 12 4f: selector + sentinel + 16-byte name + 511-byte body.
  if (msg.length !== 533 || msg[0] !== 0x12 || msg[1] !== 0x4f || ![2, 3, 4, 5].every((i) => msg[i] === 255)) throw new Error('Expected a 533-byte stored preset reply.');
  const name = new TextDecoder().decode(msg.subarray(6, 22)).replace(/\0.*$/s, '');
  const bytes = PRST.rebuild(name, msg.subarray(22)); validatePreset(bytes); return bytes;
}
export function writePresetMessage(slot, bytes, catalog = null) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) throw new Error('Preset slot must be 0–99.');
  validatePreset(bytes, catalog);
  presetName(PRST.readName(bytes));
  const msg = new Uint8Array(533); msg.set([0x11, 0x4f, slot, 0, 0, 0]); msg.set(bytes.subarray(25), 6);
  const packets = splitMessage(msg);
  if (packets.length !== 29) throw new Error('Preset stream failed validation.');
  return msg;
}
export { PRST };
