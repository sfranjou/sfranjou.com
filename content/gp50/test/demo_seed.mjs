// Synthetic demo data; no factory preset bytes, firmware or recorded content.
import PRST from '../gp50/prst.mjs';
const cat = (...parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const word = (n) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; };
const tlv = (tag, b) => { const h = new Uint8Array(4), v = new DataView(h.buffer); v.setUint16(0, tag, true); v.setUint16(2, b.length, true); return cat(h, b); };
export function demoSeed(catalog) {
  const models = new Uint8Array(40), params = new Uint8Array(320), m = new DataView(models.buffer), p = new DataView(params.buffer);
  for (let g = 0; g < 10; g++) { const e = catalog.effectsOf(g)[0]; m.setUint32(g * 4, e.id, true); e.parameters.forEach((q) => p.setFloat32(g * 32 + q.storage * 4, q.default, true)); }
  const chain = tlv(2, cat(tlv(0x3001, word(0x5b)), tlv(0x3002, Uint8Array.from([0,1,2,9,3,4,5,6,7,8])), tlv(0x3003, models), tlv(0x3004, params)));
  const identity = tlv(255, new Uint8Array(16)), format = tlv(0, new Uint8Array(16));
  const settings = tlv(1, cat(tlv(0x2001, Uint8Array.of(50)), tlv(0x2002, word(120)), tlv(0x2003, Uint8Array.of(0)), tlv(0x2004, word(0)), tlv(0x2005, word(100)), tlv(0x2006, Uint8Array.of(0)), tlv(0x2007, Uint8Array.of(0)), tlv(0x2008, Uint8Array.of(100)), tlv(0x2009, Uint8Array.of(0)), tlv(0x200a, Uint8Array.of(0))));
  const body = cat(identity, format, settings, chain, tlv(3, new Uint8Array(10)));
  const preset = PRST.rebuild('DEMO CLEAN', body);
  const active = cat(Uint8Array.of(0x12, 0x41), body);
  const load = new Uint8Array(18); load.set([0x12, 0x50, 1, 0]); new DataView(load.buffer).setFloat32(10, .28, true); new DataView(load.buffer).setFloat32(14, .38, true);
  return { active, load, preset, snapTones: Array.from({length:80}, (_,slot) => ({slot, flag:1, name: slot < 50 ? `Factory ${slot+1}` : `Empty ${slot-49}`})) };
}
