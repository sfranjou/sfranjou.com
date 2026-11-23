// Pending firmware integration: check identity feature bit 5 before using these commands.
export const TAP_FEATURE_BIT = 5;
export const readTapTempo = () => Uint8Array.of(0x12, 0x73);
export function setTapInterval(milliseconds) {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffff) throw new RangeError('interval must be a uint32 in milliseconds');
  const msg = new Uint8Array(6); msg.set([0x11, 0x73]); new DataView(msg.buffer).setUint32(2, milliseconds, true); return msg;
}
export function parseTapTempo(msg) {
  if (msg.length !== 5 || msg[0] !== 0x12 || msg[1] !== 0x73 || msg[2] !== 7) throw new Error('expected a 5-byte 12 73 policy-7 reply');
  const bpm = msg[3] | msg[4] << 8;
  if (bpm < 40 || bpm > 260) throw new Error('invalid tempo in tap reply');
  return { bpm, ignoresZero: true, minimumBpm: 40, maximumBpm: 260, ignoresBelowBpm: 30 };
}
