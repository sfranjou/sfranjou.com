// "Send to pedal" panel: a self-contained piece of UI any page can mount (tone converter, uploader, editor) to put a
// 2,696-byte N->S record into a user slot. All pedal work goes through Pedal (pedal.mjs); this file only builds DOM.
//   mountSendPanel(element, { getRecord: () => Uint8Array | null, defaultName: 'MY TONE', pedal?: Pedal })
// getRecord is called when the user presses Send (so it can encode the newest model). Style hooks: .gp50-send and
// its children (.gp50-row, .gp50-status, .gp50-ok, .gp50-bad); the panel inherits the host page's fonts and colors.
import { Pedal, connectWebMidi } from './pedal.mjs';
import { Catalog } from './params.mjs';
import { describeRecord } from './records.mjs';

const CSS = `.gp50-send .gp50-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}
.gp50-send .gp50-status{opacity:.75}.gp50-send .gp50-ok{color:#15803d}.gp50-send .gp50-bad{color:#b91c1c}
.gp50-send progress{width:100%}.gp50-send input[type=text]{width:12em}`;

export function mountSendPanel(root, { getRecord, defaultName = 'MY TONE', pedal = null, access = null } = {}) {
  if (!document.getElementById('gp50-send-css')) { const s = document.createElement('style'); s.id = 'gp50-send-css'; s.textContent = CSS; document.head.append(s); }
  root.classList.add('gp50-send');
  root.insertAdjacentHTML('beforeend', `
    <div class="gp50-row"><button type="button" data-k="connect">Connect pedal</button><span class="gp50-status" data-k="pstatus">Connect the GP-50 by USB and close Valeton Suite. Your browser needs Web MIDI with SysEx enabled.</span></div>
    <div class="gp50-row"><label>Name <input type="text" maxlength="15" data-k="name"></label>
      <label>Slot <select data-k="slot" disabled></select></label>
      <label data-k="owbox" style="display:none"><input type="checkbox" data-k="overwrite"> replace</label></div>
    <div class="gp50-row"><button type="button" data-k="send" disabled>Send to pedal</button><button type="button" data-k="play" disabled>Play on pedal</button></div>
    <progress data-k="progress" max="146" value="0" style="display:none"></progress>
    <div class="gp50-row gp50-status" data-k="status"></div>`);
  const q = (k) => root.querySelector(`[data-k="${k}"]`);
  q('name').value = defaultName.slice(0, 15);
  let table = null;
  const say = (k, text, cls = 'gp50-status') => { q(k).textContent = text; q(k).className = (k === 'status' ? 'gp50-row ' : '') + cls; };
  const fill = () => {
    const sel = q('slot'), keep = sel.value; sel.innerHTML = '';
    for (const s of table.slice(50)) { const o = document.createElement('option'); o.value = s.slot; o.textContent = `${s.slot} — ${s.empty ? 'empty' : s.name}`; sel.append(o); }
    sel.value = keep && table[keep] ? keep : String((table.slice(50).find((s) => s.empty) || table[50]).slot); sel.disabled = false; refresh();
  };
  const refresh = () => {
    const s = table && table[Number(q('slot').value)], taken = s && !s.empty;
    q('owbox').style.display = taken ? '' : 'none';   // inline: host pages may style label display
    q('send').disabled = !(pedal && table && q('name').value.trim() && (!taken || q('overwrite').checked));
    q('play').disabled = !(pedal && s && s.user);
  };
  const connect = async () => {
    q('connect').disabled = true; say('pstatus', 'Connecting…');
    try {
      if (!pedal) { const { transport, input } = await connectWebMidi({ access }); pedal = new Pedal(transport, { catalog: await Catalog.load() }); say('pstatus', `Connected: ${input.name}`, 'gp50-ok'); }
      table = await pedal.snapTones(); fill();
    } catch (e) { say('pstatus', e.message, 'gp50-bad'); q('connect').disabled = false; }
  };
  q('connect').onclick = connect;
  q('name').oninput = refresh; q('slot').onchange = () => { q('overwrite').checked = false; refresh(); }; q('overwrite').onchange = refresh;
  q('send').onclick = async () => {
    const record = getRecord(), slot = Number(q('slot').value), name = q('name').value.trim();
    if (!record) return say('status', 'Nothing to send yet.', 'gp50-bad');
    const d = describeRecord(record);
    if (!d.ok) return say('status', `Not sent: ${d.problem}`, 'gp50-bad');
    q('send').disabled = true; q('progress').style.display = ''; say('status', `Sending to slot ${slot}…`);
    try { table = await pedal.uploadRecord(slot, name, record, { overwrite: q('overwrite').checked, onProgress: (i, n) => { q('progress').max = n; q('progress').value = i; } }); fill(); say('status', `Stored in slot ${slot} as "${name}".`, 'gp50-ok'); }
    catch (e) { say('status', e.message, 'gp50-bad'); }
    q('progress').style.display = 'none'; refresh();
  };
  q('play').onclick = async () => {
    const slot = Number(q('slot').value);
    try { await pedal.useNtoS(slot); say('status', `N→S is playing slot ${slot}. Start with the pedal volume low.`, 'gp50-ok'); } catch (e) { say('status', e.message, 'gp50-bad'); }
  };
  if (pedal) connect();
  return { connect, get pedal() { return pedal; } };
}
