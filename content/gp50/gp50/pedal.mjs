import * as Components from './components.mjs';
import * as Drums from './drums.mjs';
import * as CaptureStatus from './capture_status.mjs';
import {applyIdentityBlob as identityMessage} from './identity.mjs';
import * as Tap from './tap.mjs';
// GP-50 pedal API over a byte transport (Web MIDI in the browser, a fake pedal in tests). One operation at a time, as
// the pedal expects: a write waits for the ACK of each packet, a read waits for its reply. Notifications the pedal sends
// on its own (knob turned, effect changed, preset changed) are emitted as events.
//
// Hardware notes kept from the Python tools: the first message after the port opens is sometimes answered `14 08 01`
// (rejected) and succeeds when repeated (read_slot_retry in every recorded session), so a rejected operation is retried
// once; a preset change is a plain MIDI Program Change without a reply, so the API waits, then reads the slot back.
import { splitMessage, decodePacket, Reassembler, ackStatus } from './wire.mjs';
import * as M from './messages.mjs';
import { describeRecord } from './records.mjs';
import { predict, parameter } from './params.mjs';
import { parseStoredPreset, fromActive, writePresetMessage, PRST } from './presets.mjs';

export class PedalError extends Error {}

export class Pedal {
  /** transport: {send(Uint8Array), onReceive(cb(Uint8Array)), close?()}; options: catalog (params.Catalog), timeoutMs,
   *  gapMs (pause between operations), log(direction, bytes). */
  constructor(transport, { catalog = null, timeoutMs = 2500, gapMs = 200, log = null } = {}) {   // gap as upstream valeton-gp50 (shallow pedal input queue)
    this.t = transport; this.catalog = catalog; this.timeoutMs = timeoutMs; this.gapMs = gapMs; this.log = log;
    this.halted = false; this.rx = new Reassembler(); this.waiter = null; this.listeners = new Map(); this.queue = Promise.resolve();
    transport.onReceive((raw) => this._receive(raw));
  }

  /** Manifest-owned component GET; caller pins the expected schema and exact payload length. No retries. */
  readComponent(identity, selector, format) {
    let msg;
    try {
      Components.requireComponents(identity); msg=Components.readComponentMessage(selector);
      // Validate the expected format before any device traffic.
      Components.validateFormat(format);
    } catch(e) { return Promise.reject(e); }
    return this._op(async () => {
      const wait=this._wait(m => (m[0]===0x12 && m[1]===selector) || ackStatus(m)!==null,'component reply');
      try { this._send(splitMessage(msg)[0]); } catch(e) { this._cancelWait(e); }
      try { return Components.parseComponentReply(await wait,selector,format); }
      catch(e) { this.halted=true; throw e; }
    });
  }
  writeComponent(identity, selector, payload) {
    let msg;
    try { Components.requireComponents(identity); msg=Components.writeComponentMessage(selector,payload); }
    catch(e) { return Promise.reject(e); }
    return this._op(async () => {
      const wait=this._wait(m => ackStatus(m)!==null,'component ACK');
      try { this._send(splitMessage(msg)[0]); } catch(e) { this._cancelWait(e); }
      if(ackStatus(await wait)!==0) { this.halted=true; throw new PedalError('Component write refused'); }
    });
  }
  componentStatus(identity) {
    return this.readComponent(identity,0x76,{schema:1,length:5}).then(Components.parseStatus);
  }

  /** Experimental composed counter example only; volatile, no automatic retry. */
  componentCounter(identity) {
    return this.readComponent(identity,0x78,{schema:1,length:7}).then(Components.parseCounter);
  }
  setComponentCounter(identity, value) {
    let payload;
    try { payload=Components.counterValuePayload(value); } catch(e) { return Promise.reject(e); }
    return this.writeComponent(identity,0x78,payload);
  }

  /** gr_meter feature (ABI 3, selector 0x7c): {status, gainReductionDb}. Read-only; reading asks for fresh values. */
  grMeter(identity) {
    return this.readComponent(identity,Components.GR_METER_SELECTOR,{schema:1,length:4}).then(Components.parseGrMeter);
  }
  /** Stock Gate and PRE compressor gain reduction, sampled at the end of each audio block. */
  stockGrMeters(identity) {
    if (!(identity?.features & Components.STOCK_GR_METER_FEATURE))
      return Promise.reject(new PedalError('Firmware does not advertise stock gain-reduction meters'));
    return this.readComponent(identity,Components.STOCK_GR_METER_SELECTOR,{schema:1,length:7}).then(Components.parseStockGrMeters);
  }
  /** auto_wah feature (ABI 3, selector 0x7b): {active, ownsBypass, heel, timing}. Read-only. */
  autoWahState(identity) {
    if (identity?.features & Components.EXPRESSION_RELEASE_FEATURE)
      return this.expressionAutoEngage(identity).then(({active,ownsBypass,heel,timing})=>({active,ownsBypass,heel,timing}));
    return this.readComponent(identity,Components.AUTO_WAH_SELECTOR,{schema:1,length:5}).then(Components.parseAutoWah);
  }
  /** Enable or disable heel auto engage for EXP's assigned block. */
  setExpressionAutoEngage(identity, enabled) {
    if (!(identity?.features & Components.EXPRESSION_AUTO_ENGAGE_FEATURE))
      return Promise.reject(new PedalError('Firmware does not advertise EXP auto engage'));
    let payload;
    try { payload=Components.expressionAutoEngagePayload(enabled); } catch(e) { return Promise.reject(e); }
    if (identity.features & Components.EXPRESSION_RELEASE_FEATURE)
      payload=Uint8Array.of(payload[0],255,255);
    return this.writeComponent(identity,Components.AUTO_WAH_SELECTOR,payload);
  }
  /** Read the current preset's Auto Engage settings and runtime state. */
  expressionAutoEngage(identity) {
    if (!(identity?.features & Components.EXPRESSION_RELEASE_FEATURE))
      return Promise.reject(new PedalError('Firmware does not advertise EXP release time'));
    return this.readComponent(identity,Components.AUTO_WAH_SELECTOR,{schema:2,length:8}).then(Components.parseExpressionAutoEngage);
  }
  /** Set the heel-to-bypass delay in milliseconds. Save the preset to keep it. */
  setExpressionRelease(identity, releaseMs) {
    if (!(identity?.features & Components.EXPRESSION_RELEASE_FEATURE))
      return Promise.reject(new PedalError('Firmware does not advertise EXP release time'));
    let payload;
    try { payload=Components.expressionReleasePayload(releaseMs); } catch(e) { return Promise.reject(e); }
    return this.writeComponent(identity,Components.AUTO_WAH_SELECTOR,payload);
  }
  /** cpu_load feature (ABI 3, selector 0x7a): {percent} = CPU load estimate (null when unknown). Read-only. */
  cpuLoad(identity) {
    return this.readComponent(identity,Components.CPU_LOAD_SELECTOR,{schema:1,length:3}).then(Components.parseCpuLoad);
  }
  /** fs_block feature example (ABI 3, selector 0x79): {block: 0..9 or null when off, enabled}. No automatic retry. */
  fsBlock(identity) {
    return this.readComponent(identity,Components.FS_BLOCK_SELECTOR,{schema:1,length:3}).then(Components.parseFsBlock);
  }
  /** block 0..9 (NR..NS) or null to give the right footswitch back its normal job. Marks the preset modified. */
  setFsBlock(identity, block) {
    let payload;
    try { payload=Components.fsBlockPayload(block===null?Components.FS_BLOCK_OFF:block); } catch(e) { return Promise.reject(e); }
    return this.writeComponent(identity,Components.FS_BLOCK_SELECTOR,payload);
  }

  /** Own drum controls. settingsOpen=null preserves navigation. No automatic retry. */
  drumState(identity) {
    try { Drums.requireDrumFeature(identity); } catch(e) { return Promise.reject(e); }
    return this._op(() => this._drumRead());
  }
  setDrumState(identity, options) {
    let msg;
    try { Drums.requireDrumFeature(identity); msg=Drums.setDrumStateMessage(options); } catch(e) { return Promise.reject(e); }
    return this._op(async () => {
      const wait=this._wait(m => ackStatus(m)!==null,'drum ACK');
      try { this._send(splitMessage(msg)[0]); } catch(e) { this._cancelWait(e); }
      if (ackStatus(await wait)!==0) { this.halted=true; throw new PedalError('Drum write rejected'); }
      await sleep(this.gapMs);
      const state=await this._drumRead();
      if (state.playing!==!!msg[3] || (msg[4]!==255 && state.settingsOpen!==!!msg[4])) {
        this.halted=true; throw new PedalError('Drum readback mismatch');
      }
      return state;
    });
  }
  async _drumRead() {
    const wait=this._wait(m => (m[0]===0x12 && m[1]===0x75) || ackStatus(m)!==null,'drum state');
    try { this._send(splitMessage(Drums.readDrumState())[0]); } catch(e) { this._cancelWait(e); }
    const msg=await wait;
    try { return Drums.parseDrumState(msg); } catch(e) { this.halted=true; throw e; }
  }

  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); return () => this.listeners.get(type).delete(fn); }
  _emit(type, value) { for (const fn of this.listeners.get(type) || []) fn(value); }
  close() { this.halted = true; if (this.waiter) { clearTimeout(this.waiter.timer); this.waiter.reject(new PedalError("Connection closed.")); this.waiter = null; } this.t.close?.(); }

  _receive(raw) {
    this.log?.('in', raw);
    let p; try { p = decodePacket(raw); } catch { return; }   // not ours (other MIDI traffic)
    const msg = this.rx.feed(p);
    if (!msg) return;
    if (this.waiter && this.waiter.accept(msg)) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.resolve(msg); return; }
    const n = M.parseNotification(msg);
    if (n) this._emit('notification', n);
    this._emit('message', msg);
  }

  _wait(accept, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.halted = true; this.waiter = null; reject(new PedalError(`no reply from the pedal (${what})`)); }, this.timeoutMs);
      this.waiter = { accept, resolve, reject, timer };
    });
  }

  _cancelWait(e) { this.halted = true; if (this.waiter) { clearTimeout(this.waiter.timer); this.waiter.reject(e); this.waiter = null; } }

  _send(bytes) {
    if (this.halted) throw new PedalError('Connection stopped. Reconnect after checking the pedal.');
    this.log?.('out', bytes);
    try { this.t.send(bytes); } catch (e) { this.halted = true; throw e; }
  }

  /** Serialize operations; fn runs alone on the wire. */
  _op(fn) {
    const guarded = () => { if (this.halted) throw new PedalError("Connection stopped. Reconnect after checking the pedal; no further requests were sent."); return fn(); };
    const run = this.queue.then(guarded, guarded);
    this.queue = run.then(() => sleep(this.gapMs), () => sleep(this.gapMs));
    return run;
  }

  async _write(msg, onProgress) {
    const packets = splitMessage(msg);
    for (let attempt = 0; ; attempt++) {
      let rejected = false;
      for (let i = 0; i < packets.length; i++) {
        const ack = this._wait((m) => ackStatus(m) !== null, `ACK ${i + 1}/${packets.length}`);
        try { this._send(packets[i]); } catch (e) { this._cancelWait(e); }
        const status = ackStatus(await ack);
        if (status !== 0) { rejected = true; break; }
        onProgress?.(i + 1, packets.length);
      }
      if (!rejected) return;
      if (attempt >= 1 || packets.length > 1) throw new PedalError('the pedal rejected the message');
    }
  }

  async _read(msg, selector, accept = () => true) {
    const [packet] = splitMessage(msg);
    for (let attempt = 0; ; attempt++) {
      const reply = this._wait((m) => (m[0] === 0x12 && m[1] === selector && accept(m)) || ackStatus(m) === 1, `reply 12 ${selector.toString(16)}`);
      try { this._send(packet); } catch (e) { this._cancelWait(e); }
      const m = await reply;
      if (ackStatus(m) !== 1) return m;
      if (attempt >= 1) throw new PedalError('the pedal rejected the request');
    }
  }

  // ---------------- reads ----------------
  /** Current preset number 0..99. */
  slot() { return this._op(async () => M.parseSlot(await this._read(M.readSlot(), 0x43, (m) => m.length === 4))); }
  /** Working state of the current preset (incl. unsaved edits): {enabled, order, models, params, ...}; with a catalog,
   *  also blocks: [{group, name, effect, enabled, values}] for display. */
  state() {
    return this._op(async () => {
      const s = M.parseActive(await this._read(M.readActive(), 0x41));
      if (this.catalog) s.blocks = s.models.map((id, g) => ({ group: g, block: M.BLOCKS[g], id, enabled: s.enabled[g], effect: this.catalog.describe(g, id), values: s.params[g] }));
      return s;
    });
  }
  /** The 80 N->S slots: [{slot, user, empty, name}]. */
  snapTones() { return this._op(async () => M.parseSnapTones(await this._read(M.readSnapTones(), 0x24))); }
  /** Load (our firmware): {arm, dsp} as fractions of the audio block time. */
  load() { return this._op(async () => M.parseLoad(await this._read(M.readLoad(), 0x50))); }
  presetNames() { return this._op(async () => M.parsePresetNames(await this._read(M.presetNames(), 0x40))); }

  /** Stored preset without switching; firmware-derived format, hardware qualification pending. */
  readPreset(slot) { return this._op(async () => parseStoredPreset(await this._read(M.readStored(slot), 0x4f))); }
  /** Export current working state, including live edits. */
  async activePreset(name) { return fromActive(name, await this.state()); }
  /** Whole-slot commit. Caller must explicitly confirm; always validates bytes and models first.
   * Readback stays inside the same operation, so no other request can intervene. */
  writePreset(slot, bytes, { confirm = false, onProgress = null } = {}) {
    if (!confirm) return Promise.reject(new PedalError('Preset write requires {confirm: true}.'));
    let msg; try { bytes = bytes.slice(); msg = writePresetMessage(slot, bytes, this.catalog); } catch (e) { return Promise.reject(e); }
    return this._op(async () => {
      await this._write(msg, onProgress);
      await sleep(500);
      let actual;
      try { actual = parseStoredPreset(await this._read(M.readStored(slot), 0x4f)); } catch (e) { this.halted = true; throw e; }
      // The firmware limits names to ten visible chars. Compare the full body and displayed name.
      if (PRST.readName(actual) !== PRST.readName(bytes) || !actual.subarray(41).every((v, i) => v === bytes[41 + i])) { this.halted = true; throw new PedalError('Preset sent but readback differs. Stop and inspect the pedal.'); }
      return actual;
    });
  }
  /** Assign/remove one block on a stock footswitch. Preserve other bindings from a fresh
   * read; optional expectedSlot refuses a physical preset change before writing. */
  setFootswitchBlock(fs, group, enabled, { expectedSlot = null } = {}) {
    if (![0, 1].includes(fs) || !Number.isInteger(group) || group < 0 || group > 9) return Promise.reject(new PedalError('Invalid footswitch or block.'));
    return this._op(async () => {
      const slot = M.parseSlot(await this._read(M.readSlot(), 0x43));
      if (expectedSlot !== null && slot !== expectedSlot) throw new PedalError('Preset changed on the pedal. Refresh before assigning.');
      await sleep(this.gapMs);
      const before = M.parseActive(await this._read(M.readActive(), 0x41));
      const masks = PRST.readFootswitches(fromActive('LIVE', before));
      masks[fs] = enabled ? masks[fs] | (1 << group) : masks[fs] & ~(1 << group);
      const msg = M.setFootswitchMasks(masks);
      await sleep(this.gapMs);
      await this._write(msg);
      await sleep(this.gapMs);
      const after = M.parseActive(await this._read(M.readActive(), 0x41));
      if (!PRST.readFootswitches(fromActive('LIVE', after)).every((v, i) => v === masks[i])) {
        this.halted = true; throw new PedalError('Footswitch assignment readback differs. Stop and inspect the pedal.');
      }
      return masks;
    });
  }
  /** Our firmware's identity (MOD056+): {protocol, version, features, has}; null when the pedal does not answer within
   *  timeoutMs (stock firmware, older images): silence here is expected and does not stop the connection. */
  identity({ timeoutMs = 800 } = {}) {
    return this._op(async () => {
      const [packet] = splitMessage(M.readIdentity());
      const reply = new Promise((resolve) => {
        const timer = setTimeout(() => { if (this.waiter?.timer === timer) this.waiter = null; resolve(null); }, timeoutMs);
        this.waiter = { accept: (m) => m[0] === 0x12 && m[1] === 0x70, resolve, reject: () => resolve(null), timer };
      });
      try { this._send(packet); } catch (e) { this._cancelWait(e); }
      const m = await reply;
      return m ? M.parseIdentity(m) : null;
    });
  }
  /** Pending firmware integration; requires identity feature bit 5. */
  /** Apply an already encoded identity blob using stock 11 33. Writes identity storage. */
  applyIdentityBlob(encoded) {
    const message = identityMessage(encoded); // Validate and copy before queueing.
    return this._op(() => this._write(message));
  }

  /** Future capture-status firmware only. Pass an already-read identity so an
   * unsupported installed image receives no speculative selector-72 request. */
  captureStatus(identity) {
    if (!identity || !Number.isInteger(identity.features) || !(identity.features & (1 << CaptureStatus.CAPTURE_STATUS_FEATURE_BIT)))
      return Promise.reject(new PedalError('Firmware does not advertise capture status'));
    return this._op(async () => CaptureStatus.parseCaptureStatus(await this._read(CaptureStatus.readCaptureStatus(), 0x72)));
  }
  tapTempo() { return this._op(async () => Tap.parseTapTempo(await this._read(Tap.readTapTempo(), 0x73))); }
  /** Submit a measured interval in ms. Zero is ignored; returns actual BPM readback. */
  tapInterval(milliseconds) {
    let msg; try { msg = Tap.setTapInterval(milliseconds); } catch (e) { return Promise.reject(e); }
    return this._op(async () => {
      await this._write(msg);
      return Tap.parseTapTempo(await this._read(Tap.readTapTempo(), 0x73));
    });
  }
  /** Knob assignments of the current preset (our firmware, check identity().has.knobAssign): [{dest, group, parameter, flags, id}]. */
  assignments() { return this._op(async () => M.parseAssignments(await this._read(M.readAssignments(), 0x71))); }
  /** Assign Stomp knob dest 0..2 to (group, parameter) — the pedal's own checks apply (refused: PedalError) — and read the
   *  assignments back. The preset is marked modified; save it to keep the assignment. */
  setAssignment(dest, group, parameter) {
    let msg; try { msg = M.setAssignment(dest, group, parameter); } catch (e) { return Promise.reject(e); }
    return this._op(async () => {
      await this._write(msg);
      await sleep(this.gapMs);
      const after = M.parseAssignments(await this._read(M.readAssignments(), 0x71));
      const got = after.find((a) => a.dest === dest);
      if (group === 0xff ? got : !got || got.group !== group || got.parameter !== parameter) { this.halted = true; throw new PedalError('Assignment readback differs. Stop and inspect the pedal.'); }
      return after;
    });
  }
  clearAssignment(dest) { return this.setAssignment(dest, 0xff, 0); }
  irs() { return this._op(async () => M.parseIRs(await this._read(M.readIRs(), 0x20))); }
  async useIR(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 19) throw new PedalError('User IR slot must be 0–19.');
    await this.selectEffect(4, (0x0a100000 | slot) >>> 0); await this.setEnabled(4, true);
  }

  // ---------------- control ----------------
  /** Switch to preset 0..99 (unsaved edits of the current preset may be lost, as on the pedal). Returns the slot read back. */
  selectPreset(slot) {
    return this._op(async () => { this._send(M.programChange(slot)); await sleep(500); /* upstream settles 300 ms; 500 as our Python session */ return M.parseSlot(await this._read(M.readSlot(), 0x43, (m) => m.length === 4)); });
  }
  setEnabled(group, enabled) { return this._op(() => this._write(M.setEnabled(group, enabled))); }
  /** Select a model by public ID; with a catalog, unknown IDs are refused (the pedal would pick the first model). */
  selectEffect(group, id) {
    if (this.catalog && !this.catalog.valid(group, id)) return Promise.reject(new PedalError(`no effect ${id.toString(16)} in block ${M.BLOCKS[group]}`));
    return this._op(() => this._write(M.selectEffect(group, id)));
  }
  /** Set a parameter by storage index. With a catalog and the block's current values (`stored`, 8 floats from state()),
   *  the write is checked and the eight values the pedal will hold afterwards are returned (Sync coupling included). */
  setParameter(group, storage, value, { effect = null, stored = null } = {}) {
    let after = null;
    if (effect) { if (!parameter(effect, storage)) return Promise.reject(new PedalError(`${effect.name} has no parameter at storage ${storage}`)); if (stored) after = predict(effect, stored, storage, value); }
    return this._op(async () => { await this._write(M.setParameter(group, storage, value)); return after; });
  }
  setOrder(order) { return this._op(() => this._write(M.setOrder(order))); }

  // ---------------- N->S records (tone captures) ----------------
  /** Upload a 2,696-byte record to user slot 50..79. Checks the file (the pedal would play a bad one dry) and, unless
   *  overwrite is set, that the slot is empty. Returns the slot table afterwards. onProgress(sent, total). */
  async uploadRecord(slot, name, record, { overwrite = false, onProgress = null } = {}) {
    const d = describeRecord(record);
    if (!d.ok) throw new PedalError(`not uploaded: ${d.problem}`);
    if (d.kind === 'GPTS' || d.kind === 'GPTC') {
      const has = (await this.identity())?.has ?? {};
      if (d.kind === 'GPTS' && !has.gpts)   // feature bit 9 (MOD153+); older firmware plays it dry
        throw new PedalError('not uploaded: this firmware cannot play LTTC captures; install a newer firmware first');
      if (d.kind === 'GPTC' && has.twoCurveOnly)   // feature bit 13 (MOD160+): GPTC v1 is superseded and not played
        throw new PedalError('not uploaded: this firmware plays LTTC captures only; the old format (v1) is no longer supported');
    }
    M.uploadSnapTone(slot, name, record); // validate slot/name before a read or table indexing
    const before = await this.snapTones();
    if (!overwrite && !before[slot].empty) throw new PedalError(`slot ${slot} holds "${before[slot].name}" (set overwrite to replace it)`);
    await this._op(() => this._write(M.uploadSnapTone(slot, name, record), onProgress));
    for (let i = 0; i < 6; i++) {   // the pedal stores and reloads; the table may answer busy for a moment
      try { const t = await this.snapTones(); if (t[slot].user && t[slot].name === name) return t; } catch (e) { if (this.halted) throw e; /* bounded busy retry */ }
      await sleep(300);
    }
    throw new PedalError('upload sent but the slot table does not show it yet');
  }
  /** Delete the user record in slot 50..79 (the slot becomes "Empty"). */
  deleteRecord(slot) { return this._op(() => this._write(M.deleteSnapTone(slot))); }
  /** Put the N->S block on slot 0..79 (model 0x0f000000 | slot) and switch the block on. */
  async useNtoS(slot) { await this.selectEffect(9, (0x0f000000 | slot) >>> 0); await this.setEnabled(9, true); }
  /** DST capture (our firmware, analysis/tone_capture/TWO_CAPTURES_20261108.md): put the DST block on the "Capture" effect
   *  (DST_CAPTURE_ID) playing user capture slot 50..79 before the N->S capture, and switch it on. It plays only with a
   *  GPTC capture (or no capture) in N->S and the N->S block on; it disables the cab IR while active. Uses the existing
   *  select / parameter / enable messages. */
  async useDstCapture(slot) {
    if (!Number.isInteger(slot) || slot < 50 || slot > 79) throw new PedalError('DST capture slot must be a user slot 50–79.');
    await this.selectEffect(2, DST_CAPTURE_ID); await this.setParameter(2, 0, slot - 49); await this.setEnabled(2, true);
  }
  /** DST Capture tone (MOD162+, 2026-11-21): any of {gain, vol, bass, mid, treble}, each 0..100 (50 = the capture's
   *  own gain / flat EQ). Parameters 1..5 of the DST Capture effect, sent with the existing parameter message; DST must
   *  hold the Capture effect. Values are range-checked before anything is sent. */
  async setDstCaptureTone(tone) {
    const keys = ['gain', 'vol', 'bass', 'mid', 'treble'], given = Object.keys(tone ?? {});
    if (!given.length || given.some((k) => !keys.includes(k))) throw new PedalError('DST capture tone takes gain, vol, bass, mid, treble.');
    for (const k of given) if (!Number.isFinite(tone[k]) || tone[k] < 0 || tone[k] > 100) throw new PedalError(`DST capture ${k} must be 0–100.`);
    for (const k of given) await this.setParameter(2, keys.indexOf(k) + 1, tone[k]);
  }
}

/** Public ID of our DST "Capture" effect (sdk/effects/dst_capture). */
export const DST_CAPTURE_ID = 0x0300007c;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Web MIDI transport ----------------
/** Ask the browser for MIDI with SysEx and open the GP-50. Returns {transport, input, output}. Throws if not found.
 *  pick(ports) may choose among several candidates (default: names matching /GP-?50|Valeton/i). */
export async function connectWebMidi({ access = null, pick = null } = {}) {
  if (!access) {
    if (!globalThis.navigator?.requestMIDIAccess) throw new PedalError('This browser has no native Web MIDI. Use the demo/file tools here, or connect with a browser that supports MIDI + SysEx (Chrome, Edge or desktop Firefox).');
    access = await navigator.requestMIDIAccess({ sysex: true });
  }
  const ins = [...access.inputs.values()], outs = [...access.outputs.values()];
  const match = (p) => /GP-?50|Valeton/i.test(`${p.name} ${p.manufacturer}`);
  const input = pick ? pick(ins, 'input') : ins.find(match), output = pick ? pick(outs, 'output') : outs.find(match);
  if (!input || !output) throw new PedalError('GP-50 not found: connect it by USB and close Valeton Suite');
  let cb = () => {};
  input.onmidimessage = (e) => cb(e.data);
  await Promise.all([input.open?.(), output.open?.()]);
  return { input, output, transport: { send: (b) => output.send(b), onReceive: (f) => { cb = f; }, close: () => { input.onmidimessage = null; input.close?.(); output.close?.(); } } };
}
