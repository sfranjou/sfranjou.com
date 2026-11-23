import { describeRecord } from '../gp50/records.mjs';
import { DST_CAPTURE_ID } from '../gp50/pedal.mjs';
import { readStockCaptureFilter } from '../gp50/stock_capture_filter.mjs';

export function playableState(state, records, manifest) {
  const captures = {};
  const enabled = state.enabled.map((on, group) => {
    if (!on) return false;
    if ((group === 2 && state.models[group] === DST_CAPTURE_ID) || group === 9) {
      const slot = group === 2 ? 49 + state.params[2][0] : state.models[9] & 255;
      const bytes = records.get(slot);
      const info = bytes && describeRecord(bytes);
      if (info?.ok && (info.kind === 'GPTS' || (group === 9 && info.kind === 'GPTC'))) {
        captures[group] = bytes;
        return true;
      }
      return false;
    }
    return manifest.effects.some(effect => effect.group === group && effect.id === state.models[group]);
  });
  return { state: { ...state, enabled }, record: captures };
}

export function mountLiveAudio(root) {
  const control = name => root.querySelector('#live-' + name);
  const input = control('device'), channel = control('channel'), volume = control('volume');
  const start = control('start'), stop = control('stop'), status = control('status');
  const stock = control('stock');
  let context, stream, node, monitor, latest, module, splineFilter, starting = false, readingStock = false;
  const media = navigator.mediaDevices;
  const Audio = globalThis.AudioContext;
  const supported = !!(media?.getUserMedia && Audio && globalThis.AudioWorkletNode);
  const playable = () => {
    if (splineFilter) return latest;
    const record = {...latest.record};
    const enabled = [...latest.state.enabled];
    for (const group of [2, 9]) {
      if (record[group] && describeRecord(record[group]).kind === 'GPTS') {
        delete record[group];
        enabled[group] = false;
      }
    }
    return {state: {...latest.state, enabled}, record};
  };
  stock.onchange = async () => {
    if (!stock.files[0]) return;
    readingStock = true;
    controls();
    try {
      splineFilter = await readStockCaptureFilter(stock.files[0]);
      status.textContent = 'Stock file verified. LTTC playback is ready.';
      node?.port.postMessage({type:'spline-filter', splineFilter});
      if (latest) node?.port.postMessage({type:'configure', ...playable()});
    } catch (error) {
      status.textContent = error.message;
    } finally {
      stock.value = '';
      readingStock = false;
      controls();
    }
  };
  const controls = () => {
    start.disabled = !supported || starting || readingStock || !!context || !latest;
    stock.disabled = starting || readingStock;
    input.disabled = channel.disabled = starting || !!context;
    stop.disabled = starting || !context;
  };
  async function devices() {
    if (!media?.enumerateDevices) return;
    const devices = await media.enumerateDevices();
    const previous = input.value;
    input.replaceChildren(new Option('Default audio input', ''));
    for (const device of devices.filter(item => item.kind === 'audioinput' && item.deviceId && item.deviceId !== 'default')) {
      input.add(new Option(device.label || 'Audio input ' + input.length, device.deviceId));
    }
    if ([...input.options].some(option => option.value === previous)) input.value = previous;
  }
  async function close(message = 'Live input stopped.') {
    stream?.getTracks().forEach(track => track.stop());
    node?.disconnect();
    const previous = context;
    context = stream = node = monitor = null;
    if (previous && previous.state !== 'closed') await previous.close();
    status.textContent = message;
    controls();
  }
  start.onclick = async () => {
    starting = true;
    controls();
    status.textContent = 'Opening audio input…';
    try {
      const audio = context = new Audio({sampleRate:44100, latencyHint:'interactive'});
      if (audio.sampleRate !== 44100) throw Error('This demo requires a 44.1 kHz audio context.');
      await audio.resume();
      stream = await media.getUserMedia({audio:{
        deviceId: input.value ? {exact:input.value} : undefined,
        channelCount:{ideal:2}, echoCancellation:false, noiseSuppression:false, autoGainControl:false
      }});
      if (context !== audio) throw Error('Audio input closed.');
      const track = stream.getAudioTracks()[0];
      const selectedChannel = Number(channel.value);
      const channels = track.getSettings().channelCount;
      if (channels && selectedChannel >= channels) throw Error('This input has one channel. Choose 1 / Left.');
      track.addEventListener('ended', () => close('The audio input was disconnected.'), {once:true});
      if (!module) {
        const response = await fetch(new URL('./dsp.wasm', import.meta.url));
        if (!response.ok) throw Error('Could not load the audio engine.');
        module = await WebAssembly.compile(await response.arrayBuffer());
      }
      await audio.audioWorklet.addModule(new URL('./worklet.mjs', import.meta.url));
      const processor = node = new AudioWorkletNode(audio, 'gp50-source-audio', {outputChannelCount:[2]});
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Audio engine initialization timed out.')), 10000);
        processor.port.onmessage = ({data}) => {
          if (data.type !== 'ready' && data.type !== 'error') return;
          clearTimeout(timeout);
          if (data.type === 'ready') resolve();
          else reject(Error(data.message));
        };
        processor.port.postMessage({type:'init', module, splineFilter, ...playable(), reset:true});
      });
      if (context !== audio) throw Error('Audio input closed.');
      processor.port.onmessage = ({data}) => {
        if (data.type === 'error' && node === processor) close(data.message);
      };
      processor.onprocessorerror = () => {
        if (node === processor) close('The audio processor stopped. Start live input to reconnect.');
      };
      processor.port.postMessage({type:'configure', ...playable()});
      const splitter = audio.createChannelSplitter(2);
      audio.createMediaStreamSource(stream).connect(splitter);
      splitter.connect(processor, selectedChannel);
      monitor = audio.createGain();
      monitor.gain.value = Number(volume.value) / 100;
      processor.connect(monitor).connect(audio.destination);
      status.textContent = 'Live input · ' + (track.label || 'Audio interface') + ' · Channel ' + (selectedChannel + 1)
        + (splineFilter ? '' : '. Choose the stock firmware file to hear LTTC captures.');
      devices().catch(() => {});
    } catch (error) {
      await close(error.name === 'NotAllowedError' ? 'Audio input permission was denied. Allow microphone access and try again.' : error.message);
    } finally {
      starting = false;
      controls();
    }
  };
  stop.onclick = () => close();
  volume.oninput = () => {
    if (monitor) monitor.gain.setTargetAtTime(Number(volume.value) / 100, context.currentTime, .015);
  };
  addEventListener('pagehide', () => close());
  if (!supported) status.textContent = 'Live input requires a browser with Web Audio and audio-input permission over HTTPS.';
  else devices().catch(() => {});
  controls();
  return {
    update(configuration, reset) {
      latest = configuration;
      if (!starting) node?.port.postMessage({type:'configure', ...playable(), reset});
      controls();
    }
  };
}
