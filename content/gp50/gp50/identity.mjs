// Existing 11 33 identity-blob application command. This changes device identity
// storage, not a preset. The caller supplies the vendor-format encoded blob.
// Safe C adapter rejects malformed decode/hex/allocation before storage writes.
export function applyIdentityBlob(encoded) {
  if (!(encoded instanceof Uint8Array)) throw new TypeError('encoded identity blob must be Uint8Array');
  if (encoded.length > 500 || encoded.length === 0) throw new RangeError('encoded identity blob length must be 1–500');
  const keyLength = encoded[0];
  if (keyLength === 0 || keyLength > 127 || encoded.length - keyLength - 1 < 18)
    throw new RangeError('identity blob requires a positive signed key length and at least 18 decoded bytes');
  const message = new Uint8Array(6 + encoded.length);
  message.set([0x11, 0x33]);
  new DataView(message.buffer).setUint32(2, encoded.length, true);
  message.set(encoded, 6);
  return message;
}
