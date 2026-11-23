// Uploader page: UI only. Every pedal operation goes through the API in ../gp50 (Pedal, describeRecord), so a different
// page can reuse the same calls.
import { Pedal, connectWebMidi, Catalog, describeRecord, RECORD_LEN } from '../gp50/index.mjs';

const $ = (id) => document.getElementById(id);
let pedal = null, table = null, record = null;

function log(text) { const el = $('log'); el.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`; el.scrollTop = el.scrollHeight; }
function status(id, text, cls = 'status') { const el = $(id); el.textContent = text; el.className = `row ${cls}`; }

function cleanName(s) { return s.replace(/\.[^.]*$/, '').replace(/[^\x20-\x7e]/g, '').replace(/[_-]+/g, ' ').trim().slice(0, 15).toUpperCase(); }

function renderSlots() {
  const users = table.slice(50);
  $('slots').innerHTML = '';
  for (const half of [users.slice(0, 15), users.slice(15)]) {
    const t = document.createElement('table');
    t.innerHTML = '<tr><th>Slot</th><th>Name</th><th></th></tr>';
    for (const s of half) {
      const tr = document.createElement('tr'); tr.className = s.empty ? 'empty' : '';
      tr.innerHTML = `<td class="num">${s.slot}</td><td class="name"></td><td></td>`;
      tr.querySelector('.name').textContent = s.empty ? 'empty' : s.name;
      if (s.user) {
        const del = document.createElement('button'); del.textContent = 'Delete';
        del.onclick = () => removeSlot(s.slot, s.name); tr.lastChild.append(del);
      }
      t.append(tr);
    }
    $('slots').append(t);
  }
  const sel = $('slot'), keep = sel.value; sel.innerHTML = '';
  for (const s of users) { const o = document.createElement('option'); o.value = s.slot; o.textContent = `${s.slot} — ${s.empty ? 'empty' : s.name}`; sel.append(o); }
  sel.value = keep && table[keep] ? keep : String((users.find((s) => s.empty) || users[0]).slot);
  sel.disabled = false; updateControls();
}

function updateControls() {
  const slot = table && table[Number($('slot').value)];
  const occupied = slot && !slot.empty;
  $('overwriteBox').hidden = !occupied;
  $('upload').disabled = !(pedal && record?.ok && $('name').value.trim() && (!occupied || $('overwrite').checked));
  $('play').disabled = !(pedal && slot && (slot.user || slot.slot < 50));
}

async function refresh() { table = await pedal.snapTones(); renderSlots(); }

$('connect').onclick = async () => {
  try {
    $('connect').disabled = true; status('pedalStatus', 'Connecting…');
    let access = null;
    let catalog;
    if (new URLSearchParams(location.search).has('demo')) {
      const [{ FakePedal }, { demoSeed }] = await Promise.all([
        import('../test/fake_pedal.mjs'), import('../test/demo_seed.mjs'),
      ]);
      catalog = await Catalog.load();
      access = new FakePedal(demoSeed(catalog)).midiAccess();
    }
    const { transport, input } = await connectWebMidi({ access });
    pedal = new Pedal(transport, { catalog: catalog ?? await Catalog.load() });
    pedal.on('notification', (n) => log(`pedal: ${JSON.stringify(n)}`));
    const preset = await pedal.slot();
    status('pedalStatus', `Connected to ${input.name} — preset ${preset}`, 'ok');
    log(`connected (${input.name}), preset ${preset}`);
    await refresh();
  } catch (e) { status('pedalStatus', e.message, 'bad'); log(`connect failed: ${e.message}`); $('connect').disabled = false; }
};

async function takeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  record = describeRecord(bytes); record.bytes = bytes;
  const extra = record.info && Object.keys(record.info).length ? ` — ${record.info.fronts} front, input ×${record.info.inputGain.toFixed(3)}, output ×${record.info.outputGain.toFixed(3)}` : '';
  status('fileInfo', record.ok ? `${file.name}: ${record.label}${extra}` : `${file.name}: ${record.problem}`, record.ok ? 'ok' : 'bad');
  if (!$('name').value || $('name').dataset.auto) { $('name').value = cleanName(file.name); $('name').dataset.auto = '1'; }
  updateControls();
}

const drop = $('drop');
drop.onclick = () => $('file').click();
$('file').onchange = (e) => e.target.files[0] && takeFile(e.target.files[0]);
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]); };
$('name').oninput = () => { delete $('name').dataset.auto; updateControls(); };
$('slot').onchange = () => { $('overwrite').checked = false; updateControls(); };
$('overwrite').onchange = updateControls;

$('upload').onclick = async () => {
  const slot = Number($('slot').value), name = $('name').value.trim();
  $('upload').disabled = true; $('progress').hidden = false; $('progress').value = 0;
  status('uploadStatus', `Uploading to slot ${slot}…`);
  try {
    table = await pedal.uploadRecord(slot, name, record.bytes, { overwrite: $('overwrite').checked, onProgress: (i, n) => { $('progress').max = n; $('progress').value = i; } });
    status('uploadStatus', `Stored in slot ${slot} as "${name}".`, 'ok'); log(`uploaded ${name} -> slot ${slot}`);
    renderSlots();
  } catch (e) { status('uploadStatus', e.message, 'bad'); log(`upload failed: ${e.message}`); }
  $('progress').hidden = true; updateControls();
};

$('play').onclick = async () => {
  const slot = Number($('slot').value);
  try { await pedal.useNtoS(slot); status('uploadStatus', `N→S is on, playing slot ${slot}. Start with the volume low.`, 'ok'); log(`N->S on slot ${slot}`); }
  catch (e) { status('uploadStatus', e.message, 'bad'); }
};

async function removeSlot(slot, name) {
  if (!confirm(`Delete "${name}" from slot ${slot}?`)) return;
  try { await pedal.deleteRecord(slot); log(`deleted slot ${slot} (${name})`); await refresh(); }
  catch (e) { log(`delete failed: ${e.message}`); }
}

if (!navigator.requestMIDIAccess && !new URLSearchParams(location.search).has('demo')) status('pedalStatus', 'Uploading requires Web MIDI with SysEx. Try Chrome, Edge or desktop Firefox.', 'bad');
if (RECORD_LEN !== 2696) throw new Error('API mismatch');
