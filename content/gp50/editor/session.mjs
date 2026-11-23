// UI-independent editor operations; exercised against FakePedal by test_editor.mjs.
import { PRST, fromActive, presetName, validatePreset } from '../gp50/presets.mjs';
import { CORE_ORDER } from '../gp50/messages.mjs';
import { DST_CAPTURE_ID } from '../gp50/pedal.mjs';
export const validSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot <= 99;
export function chainUnits(order) { const a = []; for (let i = 0; i < order.length; i++) { if (order[i] === 2) { a.push([...CORE_ORDER]); i += 4; } else a.push([order[i]]); } return a; }
export function moveUnit(order, at, delta) { const units = chainUnits(order); const to = at + delta; if (to < 0 || to >= units.length) return order.slice(); [units[at], units[to]] = [units[to], units[at]]; return units.flat(); }
export class EditorSession {
  constructor(pedal, catalog, { demo = false } = {}) { this.pedal = pedal; this.catalog = catalog; this.demo = demo; this.dirty = false; this.stale = false; this.imported = null; }
  async refresh() { this.slot = await this.pedal.slot(); this.state = await this.pedal.state(); this.names = await this.pedal.presetNames(); this.stale = false; return this; }
  async select(slot) { await this.pedal.selectPreset(slot); this.slot = await this.pedal.slot(); this.state = await this.pedal.state(); this.imported = null; this.dirty = false; this.stale = false; }
  writable() { if (this.stale) throw new Error('Pedal changed. Refresh before editing.'); if (this.imported) throw new Error('This file is staged. Save it to a preset before live editing.'); }
  async enabled(g, on) { this.writable(); await this.pedal.setEnabled(g, on); this.state = await this.pedal.state(); this.dirty = true; }
  async model(g, id) { this.writable(); await this.pedal.selectEffect(g, id); this.state = await this.pedal.state(); this.dirty = true; }
  async capture(group, slot) {
    this.writable();
    if (!Number.isInteger(slot) || slot < 0 || slot > 79 || (group === 2 && slot < 50))
      throw new Error('Choose a capture slot that works with this block.');
    if (group === 9) {
      await this.pedal.useNtoS(slot);
    } else if (group === 2) {
      if (this.state.models[2] === DST_CAPTURE_ID) {
        await this.pedal.setParameter(2, 0, slot - 49);
        await this.pedal.setEnabled(2, true);
      } else {
        await this.pedal.useDstCapture(slot);
      }
    } else {
      throw new Error('Choose N→S or DST.');
    }
    this.state = await this.pedal.state();
    this.dirty = true;
    const selected = group === 9
      ? this.state.models[9] === (0x0f000000 | slot)
      : this.state.models[2] === DST_CAPTURE_ID && this.state.params[2][0] === slot - 49;
    if (!selected || !this.state.enabled[group])
      throw new Error('The pedal did not activate this capture. Check the current blocks and CPU load.');
  }
  async parameter(g, storage, value) { this.writable(); const e = this.catalog.describe(g, this.state.models[g]); await this.pedal.setParameter(g, storage, value, {effect:e,stored:this.state.params[g]}); this.state = await this.pedal.state(); this.dirty = true; }
  async assignBlock(fs, group, enabled) { this.writable(); await this.pedal.setFootswitchBlock(fs, group, enabled, {expectedSlot:this.slot}); this.state = await this.pedal.state(); this.dirty = true; }
  // A/B parameter footswitches (firmware capability bit 3, MOD089+): fs 0/1 = FS1/FS2 (wire destinations 3/4); parameter = index in
  // the effect's parameter list (descriptor order, as the pedal's edit page). Live on the current preset, like other edits.
  async footswitchParameters(identity) { return this.pedal.footswitchAssignments(identity); }
  async assignFootswitchParameter(identity, fs, group, parameter, a, b) {
    this.writable();
    await this.pedal.setFootswitchAssignment(identity, fs + 3, { group, parameter, model: this.state.models[group], a: Math.fround(a), b: Math.fround(b) }, { expectedPreset: this.slot });
    this.dirty = true;
  }
  async clearFootswitchParameter(identity, fs) { this.writable(); await this.pedal.clearFootswitchAssignment(identity, fs + 3, { expectedPreset: this.slot }); this.dirty = true; }
  async order(order) { this.writable(); await this.pedal.setOrder(order); this.state = await this.pedal.state(); this.dirty = true; }
  stage(bytes) { const state = validatePreset(bytes, this.catalog); this.validateStage?.(state); this.state = state; this.imported = bytes.slice(); this.dirty = true; }
  name() { return this.imported ? PRST.readName(this.imported) : this.names?.find(n => n.slot === this.slot)?.name || 'MY PRESET'; }
  bytes(name = this.name()) { if(this.stale) throw new Error('Pedal changed. Refresh before exporting or saving.'); return this.imported ? PRST.applyEdits(this.imported, {name}) : fromActive(name, this.state); }
  async save(slot, name, confirm = false) {
    if (!validSlot(slot)) throw new Error('Preset must be 00–99.');
    presetName(name); const bytes = this.bytes(name);
    const result = await this.pedal.writePreset(slot, bytes, {confirm});
    await this.select(slot); this.names = await this.pedal.presetNames(); this.dirty = false; return result;
  }
}
