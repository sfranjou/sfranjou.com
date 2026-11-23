// GP-50 host messages: builders return message bytes (split into packets by wire.splitMessage); parsers take a reassembled
// reply. Python originals and evidence: protocol/effect_control.py, protocol/preset_state.py, scripts/gp50_session.py,
// analysis/firmware/NDS_HOST_REPLY.md, NDS_PARAMETER_SET.md section 9 (notifications), UPLOAD_PATH_017.md (uploads).
// Hardware status: every builder except presetNames()/readStored() and every parser except parsePresetNames/notifications
// has been used against a GP-50 through the Python tools; those exceptions are from firmware reading only.

export const BLOCKS = ['NR', 'PRE', 'DST', 'AMP', 'CAB', 'EQ', 'MOD', 'DLY', 'RVB', 'N→S'];
export const CORE_ORDER = [2, 9, 3, 4, 5];   // DST, N→S, AMP, CAB, EQ stay contiguous in this order
export const RECORD_LEN = 2696, SNAPTONE_HEADER = 72;

const u8 = (...a) => Uint8Array.from(a);
function le(n, bytes) { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, n >>> 0, true); return o.subarray(0, bytes); }
function cat(...parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function int(v, max, what) { if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${what} must be an integer 0..${max}`); return v; }
const f32bytes = (v) => { const o = new Uint8Array(4); new DataView(o.buffer).setFloat32(0, v, true); return o; };
const view = (m) => new DataView(m.buffer, m.byteOffset, m.byteLength);

// ---- reads ----
export const readActive = () => u8(0x12, 0x41);               // current working state incl. unsaved edits -> parseActive
export const readSlot = () => u8(0x12, 0x43);                 // current preset number -> parseSlot
export const readSnapTones = () => u8(0x12, 0x24);            // N->S slot table: 80 flags + 80 names -> parseSnapTones
export const readLoad = () => u8(0x12, 0x50);                 // MOD-image load telemetry (not stock) -> parseLoad
export const presetNames = () => u8(0x12, 0x40);              // 100 preset names -> parsePresetNames (firmware reading only)
export const readStored = (slot) => cat(u8(0x12, 0x4f), le(int(slot, 99, 'slot'), 2));   // a stored preset without selecting it

// ---- writes (the pedal ACKs each packet) ----
export function setEnabled(group, enabled) { return cat(u8(0x11, 0x49), le(int(group, 9, 'group'), 4), le(enabled ? 1 : 0, 4)); }
/** 11 48: storage index (not the visible slot); validate with params.mjs first (the firmware writes parameter 0 for an
 *  index the effect does not have). */
export function setParameter(group, storage, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('value must be finite');
  return cat(u8(0x11, 0x48), le(int(group, 9, 'group'), 4), le(int(storage, 7, 'storage index'), 4), f32bytes(value));
}
/** 11 47: select a model by public ID (resets that block's parameters to defaults; AMP may change CAB). Check the catalog
 *  first: unknown IDs fall back to the first model. */
export function selectEffect(group, id) { int(group, 9, 'group'); return cat(u8(0x11, 0x47), le(group, 4), le(group, 4), le(int(id, 0xffffffff, 'id'), 4)); }
export function setOrder(order) {
  if (order.length !== 10 || new Set(order).size !== 10 || order.some((v) => !Number.isInteger(v) || v < 0 || v > 9)) throw new RangeError('order must be a permutation of 0..9');
  const s = order.indexOf(2);
  if (CORE_ORDER.some((g, i) => order[s + i] !== g)) throw new RangeError('DST, N→S, AMP, CAB, EQ must stay together in that order');
  return cat(u8(0x11, 0x44), Uint8Array.from(order));
}
export const setGainPlacement = (p) => cat(u8(0x11, 0x42), u8(0x06, 0x20, 0x01, 0x00), u8(int(p, 1, 'placement')));
/** Store a 2,696-byte record (VTSI / GPTC / GP5N / GP5P) in N->S user slot 50..79 under a 1..15 character name. */
export function uploadSnapTone(slot, name, record) {
  int(slot, 79, 'slot'); if (slot < 50) throw new RangeError('use a user slot 50..79');
  if (record.length !== RECORD_LEN) throw new RangeError(`record must be ${RECORD_LEN} bytes`);
  const raw = new TextEncoder().encode(name);
  if (raw.length < 1 || raw.length > 15 || [...raw].some((b) => b < 0x20 || b > 0x7e)) throw new RangeError('name: 1..15 printable ASCII characters');
  const h = new Uint8Array(SNAPTONE_HEADER), v = view(h);
  v.setUint16(0, slot, true); v.setUint32(4, (0x0f000000 | slot) >>> 0, true); h.set(raw, 8);
  return cat(u8(0x11, 0x25), h, record);
}
export function deleteSnapTone(slot) { int(slot, 79, 'slot'); if (slot < 50) throw new RangeError('use a user slot 50..79'); return cat(u8(0x11, 0x27), le((0x0f000000 | slot) >>> 0, 4)); }
/** Preset change is a plain MIDI Program Change on channel 1 (no SysEx, no reply). */
export const programChange = (slot) => u8(0xc0, int(slot, 99, 'preset'));

// ---- parsers ----
function tlv(data, offset, containers) {
  const out = new Map(); let c = 0;
  while (c < data.length) {
    if (data.length - c < 4) throw new Error('truncated TLV');
    const v = view(data.subarray(c)), tag = v.getUint16(0, true), len = v.getUint16(2, true);
    if (c + 4 + len > data.length) throw new Error('TLV overflows its container');
    const value = data.subarray(c + 4, c + 4 + len);
    out.set(tag, { value, children: containers.has(tag) ? tlv(value, 0, new Set()) : null });
    c += 4 + len;
  }
  return out;
}
/** 12 41 reply (513 bytes) -> {enabled: bool[10], order, models: id[10], params: float[10][8], gainPlacement, raw}. */
export function parseActive(msg) {
  if (msg.length !== 513 || msg[0] !== 0x12 || msg[1] !== 0x41) throw new Error('expected a 513-byte 12 41 reply');
  const roots = tlv(msg.subarray(2), 2, new Set([0xff, 0, 1, 2])), tone = roots.get(2)?.children;
  const f = (tag, len) => { const r = tone?.get(tag); if (!r || r.value.length !== len) throw new Error(`missing tone field ${tag.toString(16)}`); return r.value; };
  const mask = view(f(0x3001, 4)).getUint32(0, true), order = [...f(0x3002, 10)];
  const mv = view(f(0x3003, 40)), pv = view(f(0x3004, 320));
  const models = Array.from({ length: 10 }, (_, g) => mv.getUint32(4 * g, true));
  const params = Array.from({ length: 10 }, (_, g) => Array.from({ length: 8 }, (_, i) => pv.getFloat32(4 * (8 * g + i), true)));
  const gp = roots.get(1)?.children?.get(0x2006)?.value;
  return { enabled: Array.from({ length: 10 }, (_, g) => !!(mask >> g & 1)), mask, order, models, params, gainPlacement: gp ? gp[0] : null, raw: msg };
}
export function parseSlot(msg) {
  if (msg.length !== 4 || msg[0] !== 0x12 || msg[1] !== 0x43) throw new Error('expected a 12 43 reply');
  return view(msg).getUint16(2, true);
}
/** 12 24 reply -> [{slot, user (stored in the user area), empty, name}] for the 80 N->S slots (flag 0 = user record). */
export function parseSnapTones(msg) {
  const body = msg[0] === 0x12 && msg[1] === 0x24 ? msg.subarray(2) : msg;
  if (body.length < 80 + 80 * 16) throw new Error('short 12 24 reply');
  const dec = new TextDecoder('latin1');
  return Array.from({ length: 80 }, (_, k) => {
    const raw = body.subarray(80 + 16 * k, 96 + 16 * k), end = raw.indexOf(0), name = dec.decode(end < 0 ? raw : raw.subarray(0, end));
    return { slot: k, flag: body[k], user: body[k] === 0, name, empty: k >= 50 && body[k] !== 0 && /^Empty( \d+)?$/.test(name) };
  });
}
export function parsePresetNames(msg) {
  if (msg.length !== 0x7d2 || msg[0] !== 0x12 || msg[1] !== 0x40) throw new Error('expected a 12 40 reply');
  const dec = new TextDecoder('latin1'), v = view(msg);
  return Array.from({ length: 100 }, (_, i) => { const raw = msg.subarray(6 + 20 * i, 6 + 20 * i + 11), end = raw.indexOf(0); return { slot: i, word: v.getUint32(2 + 20 * i, true), name: dec.decode(end < 0 ? raw : raw.subarray(0, end)) }; });
}
/** 12 50 (our firmware only): {status, sequence, arm, dsp} (ratios of the block deadline). */
export function parseLoad(msg) {
  if (msg.length !== 18 || msg[0] !== 0x12 || msg[1] !== 0x50) throw new Error('expected an 18-byte 12 50 reply');
  const v = view(msg); return { status: msg[3], sequence: v.getUint16(4, true), arm: v.getFloat32(10, true), dsp: v.getFloat32(14, true) };
}
/** Pedal -> host notifications (sent while a host is "connected"; firmware reading, NDS_PARAMETER_SET.md section 9).
 *  Returns {type, ...} or null for messages that are not notifications. */
export function parseNotification(msg) {
  if (msg[0] !== 0x12) return null;
  const v = view(msg), w = (o) => v.getUint32(o, true);
  switch (msg[1]) {
    case 0x47: return msg.length >= 10 ? { type: 'effect', group: w(2), id: w(6) } : null;
    case 0x48: return msg.length >= 14 ? { type: 'parameter', group: w(2), storage: w(6), value: v.getFloat32(10, true) } : null;
    case 0x49: return msg.length >= 10 ? { type: 'enable', group: w(2), enabled: !!w(6) } : null;   // kind 0 [a][b]; enable (I, mirrors 11 49)
    case 0x43: return msg.length === 6 ? { type: 'preset', slot: w(2) } : msg.length === 4 ? { type: 'preset', slot: v.getUint16(2, true) } : null;
    case 0x45: return msg.length >= 3 ? { type: 'dirty', dirty: !!msg[2] } : null;
    case 0x44: return msg.length >= 12 ? { type: 'chain', bytes: [...msg.subarray(2, 12)] } : null;   // 10 bytes at preset +0x81 (meaning I: order)
    case 0x71: try { return { type: 'assignments', assignments: parseAssignments(msg) }; } catch { return null; }   // our firmware (MOD056+)
    default: return null;
  }
}

// ---- our firmware's own commands (MOD056 N1.1.0d+; analysis/firmware/OWN_HOST_COMMANDS.md). Stock firmware and our
// images before MOD056 do not answer the reads (use Pedal.identity(), which tolerates silence) and ACK the set with 0
// without doing anything. Firmware side model-tested (scripts/test_nds_own_commands.py); hardware qualification pending.
export const FEATURES = { load: 0, gptc: 1, knobAssign: 2, footswitchAssign: 3, userPrograms: 4, gpts: 9, twoCurveOnly: 13 };   // `12 70` feature bits
export const readIdentity = () => u8(0x12, 0x70);
export const readAssignments = () => u8(0x12, 0x71);
/** 11 71: assign Stomp knob dest 0..2 (3..4 = footswitches, reserved) to block group 0..9, parameter (slot) 0..7;
 *  group 0xff clears. The pedal refuses (ACK 1) a parameter the block's model does not have; it marks the preset modified
 *  (save it as usual to keep the assignment). */
export function setAssignment(dest, group, parameter, flags = 0) {
  int(dest, 4, 'destination'); int(flags, 255, 'flags');
  if (group !== 0xff) { int(group, 9, 'group'); int(parameter, 7, 'parameter'); } else parameter = 0;
  return u8(0x11, 0x71, dest, group, parameter, flags);
}
export const clearAssignment = (dest) => setAssignment(dest, 0xff, 0);
/** 12 70 -> {protocol, version, features (bits), has: {load, gptc, knobAssign, footswitchAssign, userPrograms}}. */
export function parseIdentity(msg) {
  if (msg.length !== 23 || msg[0] !== 0x12 || msg[1] !== 0x70) throw new Error('expected a 23-byte 12 70 reply');
  const raw = msg.subarray(3, 19), end = raw.indexOf(0), features = view(msg).getUint32(19, true);
  return { protocol: msg[2], version: new TextDecoder('latin1').decode(end < 0 ? raw : raw.subarray(0, end)), features,
           has: Object.fromEntries(Object.entries(FEATURES).map(([k, b]) => [k, !!(features >> b & 1)])) };
}
/** 12 71 reply or notification -> [{dest, group, parameter, flags, id}] (only live assignments of the current preset). */
export function parseAssignments(msg) {
  if (msg.length < 3 || msg[0] !== 0x12 || msg[1] !== 0x71 || msg.length !== 3 + 8 * msg[2]) throw new Error('expected a 12 71 reply');
  const v = view(msg);
  return Array.from({ length: msg[2] }, (_, i) => ({ dest: msg[3 + 8 * i], group: msg[4 + 8 * i], parameter: msg[5 + 8 * i], flags: msg[6 + 8 * i], id: v.getUint32(7 + 8 * i, true) }));
}

// User IR bank layout from upstream app/static/static_api.js parseIrBank, aadcf9b,
// Copyright (c) 2026 Andrew Mercurio, MIT (../THIRD_PARTY.md).
export const readIRs = () => u8(0x12, 0x20);
export function parseIRs(msg) {
  if (msg.length !== 342 || msg[0] !== 0x12 || msg[1] !== 0x20) throw new Error('Expected 20 user IR names (12 20).');
  return Array.from({ length: 20 }, (_, slot) => ({ slot, name: new TextDecoder().decode(msg.subarray(22 + 16 * slot, 38 + 16 * slot)).replace(/\0.*$/s, '').trim() }));
}

/** 11 4d: two u32 block-enable masks, footswitch A then B. Stock host_set_4d
 * calls 0x47422(fs,mask); 0x457ba stores the mask; footswitch_toggle XORs it.
 * Retain the stock UI's maximum of two blocks per switch. */
export function setFootswitchMasks(masks) {
  if (!Array.isArray(masks) || masks.length !== 2) throw new RangeError('Expected A and B footswitch masks.');
  for (const mask of masks) {
    int(mask, 0x3ff, 'footswitch mask');
    if (mask.toString(2).replace(/0/g, '').length > 2) throw new RangeError('A footswitch can control at most two blocks. Remove an existing assignment first.');
  }
  return cat(u8(0x11, 0x4d), le(masks[0], 4), le(masks[1], 4));
}

// Pending firmware integration; require identity feature bit 5 before sending.
export { readTapTempo, setTapInterval, parseTapTempo } from "./tap.mjs";
