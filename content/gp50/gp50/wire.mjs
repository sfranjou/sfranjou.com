// GP-50 SysEx wire format (no device access here). Firmware basis: analysis/firmware/NDS_HOST_REPLY.md (receivers
// 0x438f0 USB / 0x43724 BLE, sender 0x40942), protocol/decoder.py and protocol/reassembly.py (Python originals).
//
// A message (`11 xx` set, `12 xx` read/reply) is split into chunks of at most 19 bytes; each chunk travels as one SysEx
// packet: F0, then the nibbles (high, low) of [crc8, total chunks, chunk index, chunk length, chunk bytes], then F7.
// crc8 = CRC-8 poly 0x07, init 0, over everything after the crc byte. The pedal ACKs each host packet with the
// one-chunk message `14 08 <status>` (0 = accepted, 1 = rejected chunk/sequence).

export const CHUNK = 19;
export const MAX_MESSAGE = 0x2000;   // firmware reassembly buffer

export function crc8(bytes, init = 0) {
  let c = init;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; }
  return c;
}

/** One packet: total = chunk count of the message, index = this chunk, payload = its bytes (<= 255). */
export function encodePacket(total, index, payload) {
  if (payload.length > 255) throw new Error('chunk too long');
  const buf = new Uint8Array(4 + payload.length);
  buf.set([0, total, index, payload.length]); buf.set(payload, 4);
  buf[0] = crc8(buf.subarray(1));
  const out = new Uint8Array(2 + 2 * buf.length); out[0] = 0xf0;
  buf.forEach((b, i) => { out[1 + 2 * i] = b >> 4; out[2 + 2 * i] = b & 15; });
  out[out.length - 1] = 0xf7;
  return out;
}

/** -> {crcOk, total, index, payload}; throws on anything that is not a GP-50 packet. */
export function decodePacket(raw) {
  if (raw.length < 10 || raw[0] !== 0xf0 || raw[raw.length - 1] !== 0xf7 || (raw.length - 2) % 2) throw new Error('not a GP-50 packet');
  const buf = new Uint8Array((raw.length - 2) / 2);
  for (let i = 0; i < buf.length; i++) {
    const hi = raw[1 + 2 * i], lo = raw[2 + 2 * i];
    if (hi > 15 || lo > 15) throw new Error('not a GP-50 packet (nibble > 15)');
    buf[i] = hi << 4 | lo;
  }
  if (buf[3] !== buf.length - 4) throw new Error('chunk length mismatch');
  return { crcOk: crc8(buf.subarray(1)) === buf[0], total: buf[1], index: buf[2], payload: buf.subarray(4) };
}

/** The packets of one message, in send order. */
export function splitMessage(msg, chunk = CHUNK) {
  if (!msg.length) throw new Error('empty message');
  const total = Math.ceil(msg.length / chunk);
  if (total > 255 || msg.length >= MAX_MESSAGE) throw new Error('message too long');
  return Array.from({ length: total }, (_, i) => encodePacket(total, i, msg.subarray(i * chunk, (i + 1) * chunk)));
}

/** ACK message -> status (0 accepted), else null. */
export function ackStatus(msg) {
  return msg.length === 3 && msg[0] === 0x14 && msg[1] === 0x08 ? msg[2] : null;
}

/** Incoming packets -> whole messages (as firmware 0x438a6: chunk 0 restarts, out-of-order chunks are dropped). */
export class Reassembler {
  constructor() { this.reset(); }
  reset() { this.total = 0; this.expected = 0; this.parts = []; }
  /** Feed one decoded packet; returns the message bytes after its last chunk, else null. Bad CRC packets are ignored. */
  feed(p) {
    if (!p.crcOk) return null;
    if (p.index === 0) { this.total = p.total; this.expected = 0; this.parts = []; }
    if (p.index === this.expected && p.total === this.total) { this.parts.push(p.payload); this.expected++; }
    if (p.index + 1 !== p.total) return null;
    const ok = this.expected === this.total, parts = this.parts; this.reset();
    if (!ok) return null;
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }
}
