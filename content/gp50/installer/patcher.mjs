// Build a modified GP-50 firmware from the user's own stock V1.1.0 file and one installer patch.
// Runs entirely locally (browser or Node). Mirrors scripts/firmware_verify.py decode, scripts/htfw_pack.py build
// and scripts/make_web_patch.py apply; the result must match the patch's reviewed image hash or nothing is returned.
import {compress, decompress} from '../lzo/lzo.mjs';

const TOC = 0x38, TOC_END = 0x88, LZO_DATA = 0x8c;
const text = new TextDecoder();

export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function crc16(bytes) {
  let c = 0xffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  }
  return c;
}

function fail(message) { throw new Error(message); }

const fromBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// Decoded regions {id: Uint8Array} of an HTFW container, with the same checks as firmware_verify.decode.
export async function decodeImage(image) {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  if (image.length < LZO_DATA || text.decode(image.subarray(0, 4)) !== 'HTFW') fail('not a GP-50 firmware file');
  if (text.decode(image.subarray(0x0c, 0x1c)).split('\0')[0] !== 'GP-50') fail('firmware is not for the GP-50');
  if (image[0x22] !== 5 || view.getUint32(8, true) !== image.length) fail('unexpected firmware layout');
  if (crc16(image.subarray(6)) !== view.getUint16(4)) fail('firmware file is damaged (header CRC)');
  const size = view.getUint32(0x24, true);
  if (!(size > 0 && size <= 4 << 20)) fail('unexpected decoded size');
  let payload;
  if (size + TOC_END !== image.length) {
    if (view.getUint32(TOC_END, true) !== size) fail('LZO length prefix mismatch');
    payload = await decompress(image.subarray(LZO_DATA), size);
  } else payload = image.subarray(TOC_END);
  const regions = {};
  let cursor = 0;
  for (let at = TOC; at < TOC_END; at += 16) {
    const id = String.fromCharCode(image[at + 3]);
    const offset = view.getUint32(at + 8, true), length = view.getUint32(at + 12, true);
    if (image[at + 2] !== 0 || offset !== cursor || !(length > 0 && length <= size - cursor)) fail('bad region table');
    const data = payload.subarray(offset, offset + length);
    if (crc16(data) !== view.getUint16(at)) fail(`region ${id} is damaged (CRC)`);
    regions[id] = data;
    cursor += length;
  }
  if (cursor !== size) fail('region table does not cover the payload');
  return regions;
}

export async function applyRegion(stock, region) {
  const base = stock[region.id];
  const data = new Uint8Array(region.length).fill(0xff);
  data.set(base.subarray(0, Math.min(base.length, region.length)));
  for (const op of region.ops) {
    if (op[1] === 'copy') {
      const [at, , src, from, n] = op;
      const source = stock[src];
      if (!source || from + n > source.length || at + n > data.length) fail('patch copy out of bounds');
      data.set(source.subarray(from, from + n), at);
    } else {
      const part = fromBase64(op[1]);
      if (op[0] + part.length > data.length) fail('patch literal out of bounds');
      data.set(part, op[0]);
    }
  }
  if (await sha256(data) !== region.sha256) fail(`region ${region.id} does not match the patch`);
  return data;
}

export async function buildImage(regions, headerTemplate) {
  const total = regions.reduce((n, r) => n + r.data.length, 0);
  const payload = new Uint8Array(total);
  const toc = new Uint8Array(TOC_END - TOC), tv = new DataView(toc.buffer);
  let offset = 0;
  regions.forEach((r, k) => {
    payload.set(r.data, offset);
    tv.setUint16(16 * k, crc16(r.data));
    toc[16 * k + 3] = r.id.charCodeAt(0);
    tv.setUint32(16 * k + 4, r.destination, true);
    tv.setUint32(16 * k + 8, offset, true);
    tv.setUint32(16 * k + 12, r.data.length, true);
    offset += r.data.length;
  });
  const packed = await compress(payload);
  const image = new Uint8Array(TOC_END + 4 + packed.length), iv = new DataView(image.buffer);
  image.set(headerTemplate);
  image.set(toc, TOC);
  iv.setUint32(TOC_END, total, true);
  image.set(packed, LZO_DATA);
  iv.setUint32(0x24, total, true);
  iv.setUint32(0x08, image.length, true);
  iv.setUint16(4, crc16(image.subarray(6)));
  return image;
}

// stockFile: Uint8Array of the user's file; patch: parsed installer patch JSON. progress(text) is optional.
export async function patchFirmware(stockFile, patch, progress = () => {}) {
  if (patch.schema !== 1) fail('unsupported patch format');
  progress('Checking your firmware file');
  const stockSha = await sha256(stockFile);
  if (stockSha !== patch.stock_sha256) fail('This is not the stock Valeton GP-50 V1.1.0 firmware file. Download V1.1.0 from Valeton and try again.');
  progress('Unpacking');
  const stock = await decodeImage(stockFile);
  progress('Applying changes');
  const regions = [];
  for (const r of patch.regions) regions.push({id: r.id, destination: r.destination, data: await applyRegion(stock, r)});
  progress('Packing');
  const header = patch.header === undefined ? stockFile.subarray(0, TOC) : fromBase64(patch.header);
  const image = await buildImage(regions, header);
  progress('Verifying');
  if (await sha256(image) !== patch.image_sha256) fail('The result does not match the reviewed firmware; nothing was saved.');
  return image;
}
