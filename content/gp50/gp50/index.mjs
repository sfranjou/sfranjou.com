// GP-50 pedal API for web pages (no dependencies; ES modules). Start here:
//   import { Pedal, connectWebMidi, Catalog } from './gp50/index.mjs';
//   const { transport } = await connectWebMidi();               // asks for MIDI + SysEx permission (Chrome/Edge)
//   const pedal = new Pedal(transport, { catalog: await Catalog.load() });
//   await pedal.state(); await pedal.setParameter(group, storage, value); await pedal.uploadRecord(78, 'NAME', bytes);
// Layers: wire.mjs (SysEx packets), messages.mjs (message builders/parsers), records.mjs (N->S record checks),
// params.mjs (catalog + parameter rules), pedal.mjs (Pedal class, Web MIDI transport). Tests: web/test/test_api.mjs.
export * from './wire.mjs';
export * as messages from './messages.mjs';
export * from './records.mjs';
export * from './params.mjs';
export * from './pedal.mjs';
export * from './send_panel.mjs';
export * from './presets.mjs';
export * as identity from './identity.mjs';

export * as captureStatus from './capture_status.mjs';

export * as drums from './drums.mjs';

export * as components from './components.mjs';
