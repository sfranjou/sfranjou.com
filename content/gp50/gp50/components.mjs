// Registered components; capability bit 8. Selectors are manifest-owned.
export function requireComponents(identity) {
  if (!identity || !Number.isInteger(identity.features) || !(identity.features & 0x100)) throw new Error('Firmware does not advertise registered components');
}
export function selector(value) {
  if (!Number.isInteger(value) || value<0x76 || value>0x7e) throw new RangeError('Component selector must be 0x76..0x7e');
  return value;
}
export const readComponentMessage = value => Uint8Array.of(0x12,selector(value));
export function writeComponentMessage(value,payload) {
  selector(value);
  if (!(payload instanceof Uint8Array) || payload.length>40) throw new TypeError('Component payload must be Uint8Array of at most 40 bytes');
  return Uint8Array.of(0x11,value,...payload);
}
export function validateFormat({schema,length}={}) {
  if (!Number.isInteger(schema) || schema<1 || schema>255 || !Number.isInteger(length) || length<1 || length>40) throw new TypeError('Expected schema and exact payload length required');
}
export function parseComponentReply(message,value,format) {
  selector(value); validateFormat(format);
  const {schema,length}=format;
  if (!(message instanceof Uint8Array) || message.length!==length+2 || message[0]!==0x12 || message[1]!==value || message[2]!==schema) throw new Error('Invalid component reply');
  return message.slice(2);
}
export function parseStatus(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==5 || payload[0]!==1) throw new Error('Invalid status component payload');
  return {tick:new DataView(payload.buffer,payload.byteOffset,payload.byteLength).getUint32(1,true)};
}

// Experimental ABI2 counter example, only present when explicitly composed.
export function counterValuePayload(value) {
  if (!Number.isInteger(value) || value<0 || value>65535) throw new RangeError('Counter value must be an integer 0..65535');
  return Uint8Array.of(value & 255,value >>> 8);
}
export function parseCounter(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==7 || payload[0]!==1) throw new Error('Invalid counter component payload');
  const view=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
  return {value:view.getUint16(1,true),ticks:view.getUint32(3,true)};
}

// fs_block feature example (ABI 3, selector 0x79): right footswitch toggles a chosen block.
export const FS_BLOCK_SELECTOR=0x79, FS_BLOCK_OFF=0xff;
export function fsBlockPayload(block) {
  if (!Number.isInteger(block) || !((block>=0 && block<10) || block===FS_BLOCK_OFF)) throw new RangeError('fs_block block must be 0..9 or 0xff (off)');
  return Uint8Array.of(block);
}
export function parseFsBlock(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==3 || payload[0]!==1 || payload[2]>1 ||
      !(payload[1]<10 || payload[1]===FS_BLOCK_OFF)) throw new Error('Invalid fs_block payload');
  return {block:payload[1]===FS_BLOCK_OFF?null:payload[1], enabled:payload[2]===1};
}

// cpu_load feature (ABI 3, selector 0x7a): current CPU load estimate, also shown on the Global settings > CPU tile.
export const CPU_LOAD_SELECTOR=0x7a;
export function parseCpuLoad(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==3 || payload[0]!==1) throw new Error('Invalid cpu_load payload');
  const v=payload[1]|payload[2]<<8;
  return {percent:v===0xffff?null:v};
}

// Expression Auto Engage uses selector 0x7b.
export const AUTO_WAH_SELECTOR=0x7b;
export const EXPRESSION_AUTO_ENGAGE_FEATURE=1<<11;
export function expressionAutoEngagePayload(enabled) {
  if (typeof enabled!=='boolean') throw new TypeError('Expected true or false');
  return Uint8Array.of(enabled ? 2 : 1);
}
export function parseAutoWah(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==5 || payload[0]!==1 || [...payload.slice(1)].some(v=>v>1)) throw new Error('Invalid auto_wah payload');
  return {active:payload[1]===1, ownsBypass:payload[2]===1, heel:payload[3]===1, timing:payload[4]===1};
}

export const EXPRESSION_RELEASE_FEATURE=1<<12;
export function expressionReleasePayload(releaseMs) {
  if (!Number.isInteger(releaseMs) || releaseMs<0 || releaseMs>2000)
    throw new RangeError('Release must be an integer from 0 to 2000 ms');
  return Uint8Array.of(0,releaseMs & 255,releaseMs >>> 8);
}
export function parseExpressionAutoEngage(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==8 || payload[0]!==2 ||
      payload.slice(1,6).some(v=>v>1)) throw new Error('Invalid EXP Auto Engage payload');
  const releaseMs=payload[6] | payload[7]<<8;
  if (releaseMs>2000) throw new Error('Invalid EXP release time');
  return {...parseAutoWah(Uint8Array.of(1,...payload.slice(1,5))),enabled:payload[5]===1,releaseMs};
}

// gr_meter feature (ABI 3, selector 0x7c): gain-reduction reading the editor GR meter shows.
export const GR_METER_SELECTOR=0x7c;
export const METER_STATUS=['ok','no data','error','stale','none','bypassed'];
export function parseGrMeter(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==4 || payload[0]!==1 || payload[1]>5) throw new Error('Invalid gr_meter payload');
  const status=METER_STATUS[payload[1]], hundredths=payload[2]|payload[3]<<8;
  return {status, gainReductionDb:status==='ok'?hundredths/100:null};
}

export const STOCK_GR_METER_FEATURE=1<<10;
export const STOCK_GR_METER_SELECTOR=0x7d;
export function parseStockGrMeters(payload) {
  if (!(payload instanceof Uint8Array) || payload.length!==7 || payload[0]!==1)
    throw new Error('Invalid stock_gr_meter payload');
  function reading(offset) {
    const status=METER_STATUS[payload[offset]], hundredths=payload[offset+1]|payload[offset+2]<<8;
    if (!status || hundredths>6000 || (status!=='ok' && hundredths!==0))
      throw new Error('Invalid stock_gr_meter reading');
    return {status, gainReductionDb:status==='ok'?hundredths/100:null};
  }
  return {gate:reading(1), pre:reading(4)};
}
