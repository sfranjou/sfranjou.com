// Provided DIs (2026-11-22): 16-bit FLACs listed in manifest.provided_di_flac, served from the data host
// (manifest.provided_di_base, default this site's /browser-teacher/data/). The page fetches and decodes them (Web Audio;
// a worker cannot decode audio), scales them back to the recording level and hands Float32Arrays to the worker.
// Both the FLAC bytes and the decoded samples must match the manifest hashes, so every browser trains on the same data.
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const sha=async b=>hex(await crypto.subtle.digest('SHA-256',b));
/** Decoded sample -> exact 16-bit integer, for decoders that divide by 32768 or by 32767 (see below). */
export const sampleInt=v=>{const a=v*32768;return Math.abs(a-Math.round(a))<1e-3?Math.round(a):Math.round(v*32767);};
export async function loadProvidedDI(manifest,progress=()=>{}){
 const rows=manifest.provided_di_flac,base=new URL(manifest.provided_di_base||new URL('../browser_teacher/data/',import.meta.url).href,location.href);
 if(!Array.isArray(rows)||rows.length!==3)throw Error('Provided DI list missing from the manifest.');
 const out=[];
 for(const [i,r] of rows.entries()){
  progress(`Downloading provided DI ${i+1}/3`);
  const res=await fetch(new URL(r.file,base));if(!res.ok)throw Error(`Provided DI ${r.file} unavailable (HTTP ${res.status}).`);
  const raw=await res.arrayBuffer();if(await sha(raw)!==r.sha256)throw Error(`Provided DI ${r.file} does not match its hash.`);
  const audio=await new OfflineAudioContext(1,r.samples,44100).decodeAudioData(raw);
  if(audio.sampleRate!==44100||audio.length!==r.samples||audio.numberOfChannels!==1)throw Error(`Provided DI ${r.file} decoded with an unexpected format.`);
  // Decoders differ: some return q/32768, others q/32767 for positive samples. Recover the exact integer q either way
  // (|q| <= 32000, so a q/32767 value never lands within 0.001 of an integer when multiplied by 32768, except |q| < 33
  // where both give q), then rebuild the training samples exactly as the manifest's reference does.
  const x=Float32Array.from(audio.getChannelData(0),v=>sampleInt(v)/32768*r.scale);
  if(await sha(x.buffer)!==r.decoded_sha256)throw Error(`This browser decoded ${r.file} differently from the reference; training stopped.`);
  out.push(x);
 }
 return out;
}
