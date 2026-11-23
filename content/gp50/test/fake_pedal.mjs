// A simulated GP-50 for tests and for building pages without the pedal: answers the API's messages like the firmware
// (ACK per packet, multi-chunk replies, first message after opening rejected once, uploads/deletes change the N->S
// slot table, a parameter write comes back as a 12 48 notification). Seed it with recorded replies (web/test/fixtures.json).
import * as W from '../gp50/wire.mjs';
import PRST from '../gp50/prst.mjs';
import { stateOfPreset } from '../gp50/presets.mjs';
import { predict } from '../gp50/params.mjs';

export class FakePedal {
  /** seed: {active: Uint8Array (12 41 reply), snapTones: [{slot, flag, name}], load: Uint8Array (12 50 reply)} */
  constructor(seed, catalog = null) {
    this.catalog = catalog; this.tapEnabled = false; this.tapBpm = 120;
    this.presets = Array.from({length:100}, (_,slot) => PRST.rebuild(slot === 13 ? 'DEMO CLEAN' : `PRESET ${String(slot).padStart(2, '0')}`, seed.active.subarray(2)));
    this.rx = new W.Reassembler(); this.first = true; this.slot = 13; this.sent = []; this.out = () => {};
    this.state = seed.active.slice(); this.load = seed.load; this.names = seed.snapTones.map((s) => ({ slot: s.slot, flag: s.flag, name: s.name }));
    // Our firmware's own commands (MOD056+): identity, per-preset knob assignments; seed.identity = false acts like stock.
    this.identity = seed.identity === false ? null : { version: 'N1.1.0d', features: 0b111 }; this.assign = new Map();
  }
  assignmentsReply() {
    const live = [...(this.assign.get(this.slot) || new Map()).entries()].sort((x, y) => x[0] - y[0]), out = new Uint8Array(3 + 8 * live.length), v = new DataView(out.buffer);
    out.set([0x12, 0x71, live.length]); const models = stateOfPreset(PRST.rebuild('LIVE', this.state.subarray(2))).models;
    live.forEach(([dest, a], i) => { out.set([dest, a.group, a.parameter, 0], 3 + 8 * i); v.setUint32(7 + 8 * i, models[a.group], true); });
    return out;
  }
  transport() { return { send: (b) => this.receive(b), onReceive: (f) => { this.out = f; } }; }
  reply(msg, delay = 1) { for (const p of W.splitMessage(msg)) setTimeout(() => this.out(p), delay); }
  ack(status = 0) { this.reply(Uint8Array.from([0x14, 0x08, status])); }
  receive(b) {
    if (b[0] === 0xc0) { this.slot = b[1]; this.state = stateOfPreset(this.presets[this.slot]).raw; return; }
    const msg = this.rx.feed(W.decodePacket(b));
    if (this.first) { this.first = false; this.rx.reset(); return this.ack(1); }
    if (msg === null) return this.ack(0);
    this.sent.push(msg);
    if (msg[0] === 0x11) {
      const v = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      if (msg[1] === 0x73 && this.tapEnabled) {
        if (msg.length !== 6) return this.ack(1);
        const ms = v.getUint32(2, true), bpm = ms ? Math.floor(60000 / ms) : 0;
        if (bpm >= 30) this.tapBpm = Math.max(40, Math.min(260, bpm));
        return this.ack(0);
      }
      if (msg[1] === 0x25) { const slot = v.getUint16(2, true); this.records?.set(slot, msg.slice(74)); this.names[slot] = { slot, flag: 0, name: new TextDecoder().decode(msg.subarray(10, 26)).replace(/\0.*$/s, '') }; }
      if (msg[1] === 0x27) { const slot = v.getUint32(2, true) & 0xff; this.records?.delete(slot); this.names[slot] = { slot, flag: 1, name: `Empty ${slot - 49}` }; }
      const state = stateOfPreset(PRST.rebuild('LIVE', this.state.subarray(2)));
      let edits = null;
      if (msg[1] === 0x71 && this.identity) {   // own 11 71: same checks as the firmware (own_commands.c)
        const [dest, group, parameter, flags] = msg.subarray(2, 6), models = stateOfPreset(PRST.rebuild('LIVE', this.state.subarray(2))).models;
        const count = this.catalog?.describe(group, models[group])?.parameters?.length ?? 8;
        if (msg.length < 6 || dest >= 3 || flags || (group !== 0xff && (group >= 10 || parameter >= 8 || parameter >= count))) return this.ack(1);
        if (!this.assign.has(this.slot)) this.assign.set(this.slot, new Map());
        if (group === 0xff) this.assign.get(this.slot).delete(dest); else this.assign.get(this.slot).set(dest, { group, parameter });
        return this.ack(0);
      }
      if (msg[1] === 0x4d) {
        const b = PRST.rebuild('LIVE', this.state.subarray(2)), off = PRST.fsOffset(b), dv = new DataView(b.buffer);
        dv.setUint32(off, v.getUint32(2,true),true);dv.setUint32(off+4,v.getUint32(6,true),true);PRST.refixCrc(b);this.state = stateOfPreset(b).raw;
      }
      if (msg[1] === 0x49) edits = { bypass: { [v.getUint32(2, true)]: !!v.getUint32(6, true) } };
      if (msg[1] === 0x44) edits = { order: [...msg.subarray(2)] };
      if (msg[1] === 0x47) {
        const g = v.getUint32(2, true), id = v.getUint32(10, true), e = this.catalog?.describe(g, id);
        edits = { models: { [g]: id }, params: { [g]: Object.fromEntries((e?.parameters || []).map(p => [p.storage, p.default])) } };
      }
      if (msg[1] === 0x48) {
        const g = v.getUint32(2, true), i = v.getUint32(6, true), value = v.getFloat32(10, true), e = this.catalog?.describe(g, state.models[g]);
        const after = e ? predict(e, state.params[g], i, value) : state.params[g].map((x,k) => k === i ? value : x);
        edits = { params: { [g]: Object.fromEntries(after.map((x,k) => [k,x])) } };
        setTimeout(() => this.reply(Uint8Array.from([0x12, 0x48, ...msg.subarray(2, 14)])), 3);
      }
      if (edits) this.state = stateOfPreset(PRST.applyEdits(PRST.rebuild('LIVE', this.state.subarray(2)), edits)).raw;
      if (msg[1] === 0x4f) {
        const slot = v.getUint32(2, true), name = new TextDecoder().decode(msg.subarray(6,22)).replace(/\0.*$/s,'');
        this.presets[slot] = PRST.rebuild(name, msg.subarray(22));
        this.slot = slot; this.state = stateOfPreset(this.presets[slot]).raw;
      }
      return this.ack(0);
    }
    if (msg[1] === 0x40) {
      const out = new Uint8Array(2002); out.set([0x12, 0x40]); const v = new DataView(out.buffer);
      this.presets.forEach((p,i) => { v.setUint32(2+20*i,i,true); out.set(new TextEncoder().encode(PRST.readName(p)).subarray(0,10),6+20*i); }); return this.reply(out);
    }
    if (msg[1] === 0x4f) {
      const slot = new DataView(msg.buffer, msg.byteOffset).getUint16(2,true), p = this.presets[slot], out = new Uint8Array(533);
      out.set([0x12,0x4f,255,255,255,255]); out.set(p.subarray(25),6); return this.reply(out);
    }
    if (msg[1] === 0x20) {
      const out = new Uint8Array(342); out.set([0x12,0x20]); for(let i=0;i<20;i++) out.set(new TextEncoder().encode(`User IR ${i+1}`),22+i*16); return this.reply(out);
    }
    if (msg[1] === 0x43) return this.reply(Uint8Array.from([0x12, 0x43, this.slot, 0]));
    if (msg[1] === 0x41) return this.reply(this.state);
    if (msg[1] === 0x24) {
      const out = new Uint8Array(2 + 80 + 80 * 16); out.set([0x12, 0x24]);
      this.names.forEach((s, k) => { out[2 + k] = s.flag; out.set(new TextEncoder().encode(s.name).subarray(0, 15), 82 + 16 * k); });
      return this.reply(out);
    }
    if (msg[1] === 0x50) return this.reply(this.load);
    if (msg[1] === 0x70 && this.identity) {
      const out = new Uint8Array(23); out.set([0x12, 0x70, 1]); out.set(new TextEncoder().encode(this.identity.version), 3); new DataView(out.buffer).setUint32(19, this.identity.features, true);
      return this.reply(out);
    }
    if (msg[1] === 0x73 && this.tapEnabled && msg.length === 2) return this.reply(Uint8Array.of(0x12, 0x73, 7, this.tapBpm & 255, this.tapBpm >> 8));
    if (msg[1] === 0x71 && this.identity) return this.reply(this.assignmentsReply());
  }
  /** A MIDIAccess look-alike for connectWebMidi({access}). */
  midiAccess() {
    const input = { name: 'GP-50 (simulated)', manufacturer: 'Valeton', onmidimessage: null };
    const output = { name: 'GP-50 (simulated)', manufacturer: 'Valeton', send: (b) => this.receive(Uint8Array.from(b)) };
    this.out = (p) => input.onmidimessage?.({ data: p });
    return { inputs: new Map([['in', input]]), outputs: new Map([['out', output]]) };
  }
}

/** Seed from web/test/fixtures.json (recorded MOD054 replies). */
export function seedFromFixtures(fx) {
  const msg = (frames) => { const r = new W.Reassembler(); let m = null; for (const f of frames) m = r.feed(W.decodePacket(Uint8Array.from(f.match(/../g).map((h) => parseInt(h, 16))))) || m; return m; };
  return { active: msg(fx.replies.active.frames), load: msg(fx.replies.load.frames),
           snapTones: fx.replies.snaptones.names.map((name, slot) => ({ slot, flag: fx.replies.snaptones.flags[slot], name })) };
}
