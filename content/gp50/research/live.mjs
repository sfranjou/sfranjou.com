// Live input for the research page: guitar in, through the NAM, SnapTone or the selected model.
// Each source runs at its own sample rate (models at 44.1 kHz, NAM at the file's rate), so
// switching source restarts the audio graph; the browser resamples the input for us.
import {fullModel} from '../trainer/browser_teacher/api.js';

const root = document.getElementById('live');
const control = name => root.querySelector(`[name=${name}]`);
const status = root.querySelector('output');
let context = null, stream = null, wasm = null;
let available = {};  // source name -> url (for nam: the Tone3000 page), for the current step and amp

export function setLiveSources(sources) {
  available = sources;
  for (const input of root.querySelectorAll('[name=source]')) {
    input.disabled = !sources[input.value];
    input.closest('label').hidden = !sources[input.value];
  }
  const current = root.querySelector('[name=source]:checked');
  if (!current || current.disabled) {
    const first = root.querySelector('[name=source]:not(:disabled)');
    if (first) first.checked = true;
  }
  root.querySelector('[data-label=model]').textContent = sources.label ?? 'This step';
  // NAM files are not redistributed: the player loads the one you download from Tone3000.
  const link = root.querySelector('#nam-file a');
  if (link.href !== sources.nam) control('namfile').value = '';
  link.href = sources.nam ?? '';
  root.querySelector('#nam-file').hidden = !sources.nam;
  if (context) start();
}

async function stop(message = 'Stopped.') {
  stream?.getTracks().forEach(track => track.stop());
  const old = context;
  context = stream = null;
  if (old) await old.close();
  status.textContent = message;
}

async function start() {
  const source = root.querySelector('[name=source]:checked')?.value;
  if (!available[source]) { status.textContent = 'Nothing to play for this step.'; return; }
  await stop('Starting…');
  try {
    let node;
    if (source === 'nam') {
      const file = control('namfile').files[0];
      if (!file) throw Error('Choose the NAM file for this amp first.');
      const model = fullModel(JSON.parse(await file.text()));
      wasm ??= await (await fetch('../trainer/browser_teacher/teacher.wasm')).arrayBuffer();
      context = new AudioContext({sampleRate: model.sample_rate, latencyHint: 'interactive'});
      await context.audioWorklet.addModule('live-worklet.mjs');
      node = new AudioWorkletNode(context, 'nam', {outputChannelCount: [2]});
      const ready = new Promise((resolve, reject) => {
        node.port.onmessage = ({data}) => data.type === 'ready' ? resolve() : reject(Error(data.message));
      });
      node.port.postMessage({wasm: wasm.slice(0), model});
      await ready;
    } else {
      const spec = await (await fetch(available[source])).json();
      context = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'});
      await context.audioWorklet.addModule('live-worklet.mjs');
      node = new AudioWorkletNode(context, 'chain', {outputChannelCount: [2]});
      node.port.postMessage({spec});
    }
    stream = await navigator.mediaDevices.getUserMedia({audio: {
      deviceId: control('device').value ? {exact: control('device').value} : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
    const splitter = context.createChannelSplitter(2);
    context.createMediaStreamSource(stream).connect(splitter);
    splitter.connect(node, Number(control('channel').value));
    const volume = context.createGain();
    volume.gain.value = Number(control('volume').value) / 100;
    node.connect(volume).connect(context.destination);
    control('volume').oninput = () => { volume.gain.value = Number(control('volume').value) / 100; };
    status.textContent = `Playing: ${root.querySelector('[name=source]:checked').closest('label').textContent.trim()}`;
    listDevices();
  } catch (error) {
    await stop(error.name === 'NotAllowedError' ? 'Microphone access was denied.' : error.message);
  }
}

async function listDevices() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId);
  const select = control('device'), previous = select.value;
  select.replaceChildren(new Option('Default input', ''), ...devices.map((d, i) => new Option(d.label || `Input ${i + 1}`, d.deviceId)));
  select.value = previous;
}

root.querySelector('[data-action=start]').onclick = start;
root.querySelector('[data-action=stop]').onclick = () => stop();
for (const input of root.querySelectorAll('[name=source]')) input.onchange = () => { if (context) start(); };
if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) {
  status.textContent = 'Live input needs a browser with Web Audio and microphone access (HTTPS).';
  root.querySelector('[data-action=start]').disabled = true;
} else listDevices().catch(() => {});
addEventListener('pagehide', () => stop());
