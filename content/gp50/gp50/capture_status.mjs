// Offline component; not implemented/advertised by MOD087. Active record only.
export const CAPTURE_STATUS_FEATURE_BIT = 6;
export const CAPTURE_KINDS = Object.freeze(['unknown','empty','vtsi','gp5n','gp5p','gptc']);
export const CAPTURE_STATES = Object.freeze(['unavailable','loading','accepted','rejected','runtimeError','unsupported','retired']);
export const CAPTURE_FRESHNESS = Object.freeze(['unavailable','fresh','stale']);
export const readCaptureStatus = () => Uint8Array.of(0x12,0x72);
export function parseCaptureStatus(msg) {
  const bad = () => { throw new Error('Invalid capture-status schema 1 reply'); };
  if (!(msg instanceof Uint8Array) || msg.length !== 24 || msg[0] !== 0x12 || msg[1] !== 0x72 || msg[2] !== 1) bad();
  const [fresh,kind,state,slot,flags] = msg.subarray(3,8);
  const d = new DataView(msg.buffer,msg.byteOffset,msg.byteLength);
  const generation=d.getUint32(8,true), revision=d.getUint32(12,true), error=d.getUint32(16,true), ageMs=d.getUint32(20,true);
  if (fresh>2 || kind>5 || state>6 || (slot>=80 && slot!==255) || flags&~7 || !!(flags&2)!==(slot!==255) || (flags&1 && state!==2)) bad();
  if (state===0) { if (generation || revision || error || kind || flags || fresh || ageMs!==0xffffffff) bad(); }
  else {
    if (!generation || !revision || !fresh || ageMs===0xffffffff || (fresh===1)!==(ageMs<1000)) bad();
    if (state===1 || state===6) { if (error || kind || flags&4 || (state===6 && slot!==255)) bad(); }
    else if (state===2) { if (kind<2 || error) bad(); }
    else if (state===4) { if (kind<2 || !error) bad(); }
    else if (state===3) { if (kind===1 || !error) bad(); }
    else if (error) bad();
  }
  return {schema:1, freshness:CAPTURE_FRESHNESS[fresh],kind:CAPTURE_KINDS[kind],state:CAPTURE_STATES[state],
    slot:slot===255?null:slot,bypassed:!!(flags&1),fallback:!!(flags&4),generation,revision,error,
    ageMs:ageMs===0xffffffff?null:ageMs};
}
/** Text policy shared by a future pedal label/editor. Never show a stale record
 * as the currently accepted record. No strings are derived from record memory. */
export function captureStatusText(status) {
  if (status.freshness==='unavailable') return 'Capture status unavailable';
  if (status.freshness==='stale') return 'Capture status stale';
  const kind={vtsi:'SNAPTONE',gptc:'LTTC'}[status.kind]||status.kind.toUpperCase(), fallback=status.fallback?' (fallback)':'';
  switch(status.state) {
    case 'loading': return 'Loading capture';
    case 'retired': return 'No active capture';
    case 'accepted': return `${kind}${status.bypassed?' bypassed':' ready'}${fallback}`;
    case 'rejected': return `${kind} rejected: 0x${status.error.toString(16).padStart(8,'0')}${fallback}`;
    case 'runtimeError': return `${kind} runtime error: 0x${status.error.toString(16).padStart(8,'0')}${fallback}`;
    default: return status.kind==='empty'?'Empty capture':`${kind} unsupported${fallback}`;
  }
}
