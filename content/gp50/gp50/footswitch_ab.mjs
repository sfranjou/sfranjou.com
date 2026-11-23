// Selector 74 (A/B parameter footswitches): integrated from MOD089 / N1.1.0K, capability bit 3 (analysis/firmware/OWN_HOST_COMMANDS.md).
import {Pedal, PedalError, sleep} from './pedal.mjs';
import {splitMessage, ackStatus} from './wire.mjs';
export const FOOTSWITCH_AB_FEATURE_BIT = 3;
const fail = (s) => { throw new PedalError(s); };
const u32 = (x) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
const destOk = (x) => x === 3 || x === 4;
const fbits = (x) => {
  if (typeof x !== 'number' || !Number.isFinite(x) || !Object.is(Math.fround(x), x)) fail('Endpoint must be exactly representable as finite binary32');
  const v = new DataView(new ArrayBuffer(4)); v.setFloat32(0,x,true); return v.getUint32(0,true);
};
const fvalue = (x) => { const v = new DataView(new ArrayBuffer(4)); v.setUint32(0,x,true); return v.getFloat32(0,true); };
const same = (a,b) => a === b || ((a | b) & 0x7fffffff) === 0;
const validBits = (a,b) => Number.isFinite(fvalue(a)) && Number.isFinite(fvalue(b)) && !same(a,b);
export const readFootswitchAssignments = () => Uint8Array.of(0x12,0x74);
export function setFootswitchAssignmentMessage(dest, {group, parameter, model, a, b}, expectedPreset) {
  if (!Number.isInteger(expectedPreset) || expectedPreset < 0 || expectedPreset > 99 || !destOk(dest) || !Number.isInteger(group) || group < 0 || group > 9 || !Number.isInteger(parameter) || parameter < 0 || parameter > 7 || !u32(model)) fail('Invalid assignment');
  const ab = fbits(a), bb = fbits(b); if (!validBits(ab,bb)) fail('Endpoints must differ');
  const msg = new Uint8Array(20); msg.set([0x11,0x74,1,dest,group,parameter,0,expectedPreset]); const v = new DataView(msg.buffer); v.setUint32(8,model,true); v.setUint32(12,ab,true); v.setUint32(16,bb,true); return msg;
}
export function clearFootswitchAssignmentMessage(dest, expectedPreset) {
  if (!destOk(dest) || !Number.isInteger(expectedPreset) || expectedPreset < 0 || expectedPreset > 99) fail('Invalid destination or preset'); const msg = new Uint8Array(20); msg.set([0x11,0x74,1,dest,255,0,0,expectedPreset]); return msg;
}
export function recoverAssignmentMetadataMessage(expectedPreset) {
  if (!Number.isInteger(expectedPreset) || expectedPreset<0 || expectedPreset>99) fail('Expected preset required');
  const m=new Uint8Array(20);m.set([0x11,0x74,1,255,255,0,1,expectedPreset]);return m;
}
export function parseFootswitchAssignments(msg) {
  if (!(msg instanceof Uint8Array) || msg.length !== 40 || msg[0] !== 0x12 || msg[1] !== 0x74 || msg[2] !== 1 || (msg[3] > 99 && msg[3] !== 255) || msg[4] !== 2 || (msg[5]&0x7c)) fail('Malformed footswitch assignments');
  const v = new DataView(msg.buffer,msg.byteOffset,msg.byteLength), records=[];
  for (let i=0;i<2;i++) { const o=6+17*i, dest=msg[o], valid=msg[o+1], group=msg[o+2], parameter=msg[o+3], flags=msg[o+4], model=v.getUint32(o+5,true), aBits=v.getUint32(o+9,true), bBits=v.getUint32(o+13,true);
    if (dest !== i+3 || valid > 1 || flags || (!valid && (group || parameter || model || aBits || bBits)) || (valid && (msg[3]===255 || group>9 || parameter>7 || !validBits(aBits,bBits)))) fail('Malformed footswitch record');
    records.push({dest,valid:!!valid,group,parameter,flags,model,aBits,bBits,a:fvalue(aBits),b:fvalue(bBits)});
  } return {ownerPreset:msg[3], blockedMask:msg[5]&3, metadataFault:!!(msg[5]&0x80), records};
}
export class FootswitchPedal extends Pedal {
  _feature(identity) { if (!identity || !Number.isInteger(identity.features) || !(identity.features & (1 << FOOTSWITCH_AB_FEATURE_BIT))) fail('Firmware does not advertise parameter footswitches'); }
  async _singleRead() {
    const reply=this._wait(m => (m[0]===0x12 && m[1]===0x74) || ackStatus(m)!==null,'footswitch reply');
    try { this._send(splitMessage(readFootswitchAssignments())[0]); } catch(e) { this._cancelWait(e); }
    const m=await reply; if (ackStatus(m)!==null) { this.halted=true; fail('Footswitch read rejected'); }
    try { return parseFootswitchAssignments(m); } catch(e) { this.halted=true; throw e; }
  }
  async _singleWrite(msg) {
    for (const p of splitMessage(msg)) { const ack=this._wait(m => ackStatus(m)!==null,'footswitch ACK'); try { this._send(p); } catch(e) { this._cancelWait(e); } if (ackStatus(await ack)!==0) { this.halted=true; fail('Footswitch write rejected'); } }
  }
  footswitchAssignments(identity) { try { this._feature(identity); } catch(e) { return Promise.reject(e); } return this._op(() => this._singleRead()); }
  setFootswitchAssignment(identity,dest,assignment,{expectedPreset}={}) {
    let msg; try { this._feature(identity); if (!Number.isInteger(expectedPreset) || expectedPreset<0 || expectedPreset>99) fail('Expected preset required'); msg=setFootswitchAssignmentMessage(dest,assignment,expectedPreset); } catch(e) { return Promise.reject(e); }
    return this._change(msg,expectedPreset);
  }
  clearFootswitchAssignment(identity,dest,{expectedPreset}={}) {
    let msg; try { this._feature(identity); if (!Number.isInteger(expectedPreset) || expectedPreset<0 || expectedPreset>99) fail('Expected preset required'); msg=clearFootswitchAssignmentMessage(dest,expectedPreset); } catch(e) { return Promise.reject(e); }
    return this._change(msg,expectedPreset);
  }
  recoverAssignmentMetadata(identity,{expectedPreset,discardAllKnobAndFootswitchAssignments=false}={}) {
    let msg;try {this._feature(identity);if(discardAllKnobAndFootswitchAssignments!==true) fail('Explicit whole-record discard required');msg=recoverAssignmentMetadataMessage(expectedPreset);} catch(e) {return Promise.reject(e);}
    return this._op(async()=>{
      const before=await this._singleRead();
      if(before.ownerPreset!==expectedPreset || !before.metadataFault) {this.halted=true;fail('Damaged metadata/preset guard differs');}
      await sleep(this.gapMs);await this._singleWrite(msg);await sleep(this.gapMs);
      const after=await this._singleRead();
      if(after.ownerPreset!==expectedPreset || after.metadataFault || after.blockedMask || after.records.some(r=>r.valid)) {this.halted=true;fail('Metadata recovery readback differs');}
      return after;
    });
  }
  _change(msg,expectedPreset) { return this._op(async () => {
    const before=await this._singleRead(); if(before.metadataFault) {this.halted=true;fail('Assignment metadata damaged; explicit whole-record recovery required');} if (before.ownerPreset!==expectedPreset) { this.halted=true; fail('Preset identity differs'); }
    await sleep(this.gapMs);
    await this._singleWrite(msg);
    await sleep(this.gapMs);
    const after=await this._singleRead(), r=after.records[msg[3]-3], v=new DataView(msg.buffer,msg.byteOffset,msg.byteLength);
    if (after.ownerPreset!==expectedPreset || (after.blockedMask & (1 << (msg[3]-3))) || (msg[4]===255 ? r.valid : !r.valid || r.group!==msg[4] || r.parameter!==msg[5] || r.model!==v.getUint32(8,true) || r.aBits!==v.getUint32(12,true) || r.bBits!==v.getUint32(16,true))) { this.halted=true; fail('Footswitch readback differs'); }
    return after;
  }); }
}
