// Own selector 75, schema 1; MOD096 draft, capability bit 7.
export const DRUM_FEATURE_BIT = 7;
export const readDrumState = () => Uint8Array.of(0x12,0x75);
export function setDrumStateMessage({playing, settingsOpen=null}={}) {
  if (typeof playing!=='boolean' || (settingsOpen!==null && typeof settingsOpen!=='boolean')) throw new TypeError('playing must be boolean; settingsOpen must be boolean or null');
  return Uint8Array.of(0x11,0x75,1,Number(playing),settingsOpen===null?255:Number(settingsOpen));
}
export function parseDrumState(m) {
  if (!(m instanceof Uint8Array) || m.length!==5 || m[0]!==0x12 || m[1]!==0x75 || m[2]!==1 || m[3]>1 || m[4]>1) throw new Error('Invalid drum-state schema 1 reply');
  return {playing:!!m[3],settingsOpen:!!m[4]};
}
export function requireDrumFeature(identity) {
  if (!identity || !Number.isInteger(identity.features) || !(identity.features & (1<<DRUM_FEATURE_BIT))) throw new Error('Firmware does not advertise drum host control');
}
