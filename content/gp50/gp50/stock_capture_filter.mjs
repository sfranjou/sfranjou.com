import {decodeImage, sha256} from '../installer/patcher.mjs';

const stockHash = '0e14f2b0293be233db3da8dc3573bf9135dddc575992055570842433dadae836';
const sourceOffset = 50768;
const coefficientCount = 40;

// The stock DSP stores each four-tap cell in reverse order.
export async function readStockCaptureFilter(file) {
  if (!file || file.size > 4 * 1024 * 1024) throw Error('Choose the official GP-50 V1.1.0 firmware file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (await sha256(bytes) !== stockHash) throw Error('Choose the official GP-50 V1.1.0 firmware file.');
  const {g} = await decodeImage(bytes);
  const cells = new DataView(g.buffer, g.byteOffset + sourceOffset, coefficientCount * 4);
  return Float32Array.from({length: coefficientCount}, (_, i) => cells.getFloat32((i ^ 3) * 4, true));
}
