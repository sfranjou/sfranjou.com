import { Pedal, connectWebMidi, Catalog, describeRecord, isBinary, syncSwitchOf } from '../gp50/index.mjs';
import { FootswitchPedal, FOOTSWITCH_AB_FEATURE_BIT } from '../gp50/footswitch_ab.mjs';
import { BLOCKS } from '../gp50/messages.mjs';
import { PRST, stateOfPreset, validatePreset } from '../gp50/presets.mjs';
import { DST_CAPTURE_ID } from '../gp50/pedal.mjs';
import { EditorSession, chainUnits, moveUnit } from './session.mjs';
import { mountLiveAudio, playableState } from '../audio/live.mjs';

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const demo = query.has('demo');
const captureCatalog = new URL('../captures/captures.json', import.meta.url);
const collectionKey = 'peppercorn.capture-collection.v1';
let bundledCaptures = [], localCaptures = [];
const slotFormats = new Map();
$('demo-link').hidden = demo;
const stockCatalog = await Catalog.load();
const manifest = demo ? await fetch(new URL('../audio/effects.json', import.meta.url)).then(r => r.json()) : null;
const previewEffects = manifest ? (await Catalog.load(new URL('../audio/catalog.json', import.meta.url)))
  .effects.filter(effect => manifest.effects.some(e => e.group === effect.group && e.id === effect.id)) : [];
const catalog = manifest ? new Catalog({...stockCatalog.doc, effects:[
  ...stockCatalog.effects, ...previewEffects.filter(effect => !stockCatalog.find(effect.group,effect.id))
]}) : stockCatalog;
const demoRecords = new Map();
const liveAudio = demo ? mountLiveAudio($('live-audio')) : null;
let audioSlot;
if (demo) {
  $('live-audio').hidden = false;
  $('bank-heading').textContent = 'Demo slots';
  $('ir-bank').hidden = true;
}
let session = null, group = demo ? 6 : 3, busy = false, tones = [];
const logs = []; // bounded raw MIDI evidence; downloadable from Guide
const log = (direction, bytes) => { logs.push({time:new Date().toISOString(),direction,hex:[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')}); if (logs.length > 20000) logs.shift(); };
const status = (message, error = false) => { $('status').textContent = message; $('status').dataset.error = error; };
function option(value, title) { const o = document.createElement('option'); o.value = value; o.textContent = title; return o; }
function button(title, fn, attrs = {}) { const b = document.createElement('button'); b.type = 'button'; b.textContent = title; Object.entries(attrs).forEach(([k,v])=>b.setAttribute(k,v)); b.onclick = fn; return b; }
const connected = () => !!session && !session.pedal.halted;
const editable = () => connected() && !session.imported && !session.stale;
const pause = (v) => { busy = v; updateControls(); };
async function run(fn, message, report = status) {
  if (busy) return;
  pause(true);
  try { await fn(); if(message) report(message); }
  catch(e) { report(e.message, true); if (session?.pedal.halted) { $('connection-state').textContent = 'Stopped'; $('mode-note').textContent = 'A request failed. Check the pedal before reconnecting. No further requests will be sent.'; } }
  finally { pause(false); render(); }
}
function updateControls() {
  const c = connected(), e = editable();
  for (const id of ['refresh','refresh-tones','read-irs','read-load','export-preset','open-save']) $(id).disabled = busy || !c;
  for (const id of ['export-preset','open-save']) $(id).disabled ||= !!session?.stale;
  $('connect').disabled = busy || c || (!demo && !navigator.requestMIDIAccess); $('disconnect').hidden = !session; $('disconnect').disabled = busy;
  $('assign-block').disabled = busy || !e; $('block-enabled').disabled = busy || !e; $('model').disabled = busy || !e;
  $('chain').querySelectorAll('button').forEach(b=>b.disabled=busy||!c);
  $('order-controls').querySelectorAll('button').forEach(b=>b.disabled=busy||!e||b.dataset.edge==='true');
  $('preset-list').querySelectorAll('button').forEach(b=>b.disabled=busy||!c);
  $('parameters').querySelectorAll('input,select,button').forEach(b=>b.disabled=busy||!e);
  updateCaptureControls(c, e);
  $('use-ir').disabled = busy || !e || !$('ir-slot').options.length;
  $('assignment-actions').querySelectorAll('button').forEach(b=>b.disabled=busy||!e||b.dataset.unavailable==='true');
  $('open-import').disabled = busy || !c; $('commit-save').disabled = busy;
}
// Native dialog is shared by mouse context-menu, keyboard ContextMenu/Shift+F10,
// and a visible touch-friendly button. Suppress browser context only on our targets.
function bindContext(node, action) {
  node.oncontextmenu=(event)=>{event.preventDefault();if(!busy)action();};
  node.onkeydown=(event)=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();if(!busy)action();}};
}
function openAssignment(g) {
  if(!session?.state)return;
  if(session.stale){status('Pedal changed. Refresh before assigning.',true);return;}
  $('assignment-title').textContent=`Assign ${BLOCKS[g]} on/off`;
  const masks=PRST.readFootswitches(session.bytes());
  const describe=(mask)=>BLOCKS.filter((_,i)=>mask&(1<<i)).join(' + ')||'unassigned';
  $('assignment-info').textContent=`A: ${describe(masks[0])}. B: ${describe(masks[1])}.`;
  $('assignment-note').textContent='In Stomp/block-toggle mode, each switch toggles up to two blocks together. The switch mode and other block assignments are preserved. This changes the working preset; use the pedal’s normal save to keep it.';
  $('assignment-actions').replaceChildren();
  for(const fs of [0,1]) {
    const assigned=!!(masks[fs]&(1<<g));
    const b=button(`${assigned?'Remove from':'Assign to'} footswitch ${fs===0?'A':'B'}`,()=>run(async()=>{await session.assignBlock(fs,g,!assigned);$('assignment-dialog').close();},'Footswitch assignment updated and readback verified.'));
    b.disabled=busy||!editable();$('assignment-actions').append(b);
  }
  $('assignment-dialog').showModal();
}
let identity=null;   // our firmware's identity (12 70); null on stock firmware or in the demo
const abCapable=()=>!demo && !!identity && !!(identity.features & (1<<FOOTSWITCH_AB_FEATURE_BIT));
function describeAB(r) {
  if(!r.valid) return 'unassigned';
  const e=catalog.describe(r.group,r.model), p=e?.parameters?.[r.parameter];
  return `${BLOCKS[r.group]} · ${p?.name ?? 'parameter '+(r.parameter+1)}: ${r.a} ↔ ${r.b}`;
}
function openParameterAssignment(g,p) {
  $('assignment-title').textContent=`Assign ${BLOCKS[g]} · ${p.name}`;
  $('assignment-actions').replaceChildren();
  if (!editable() || busy || !session.state) return;
  const knobCapable = !!identity?.has.knobAssign;
  const ab = abCapable();
  const {slot} = session;
  const model = session.state.models[g];
  const e=catalog.describe(g,model), index=e.parameters.indexOf(p), now=session.state.params[g][p.storage];
  const checkTarget = async () => {
    session.writable();
    if (session.slot !== slot || await session.pedal.slot() !== slot ||
        (await session.pedal.state()).models[g] !== model)
      throw new Error('The pedal changed presets or effects. Refresh and reopen assignments.');
  };
  const actions = $('assignment-actions');
  $('assignment-info').textContent = knobCapable || ab
    ? 'Choose a home-screen knob or an A/B footswitch. Save the preset to keep the assignment.'
    : 'Parameter assignments require compatible Peppercorn firmware.';
  $('assignment-note').textContent = knobCapable || ab ? 'Reading current assignments…' : '';
  if (knobCapable) {
    for (const dest of [0, 1, 2]) {
      const control = button('Knob ' + (dest + 1), () => run(async () => {
        await checkTarget();
        if (control.dataset.assigned === 'true') await session.pedal.clearAssignment(dest);
        else await session.pedal.setAssignment(dest, g, index);
        session.dirty = true;
        $('assignment-dialog').close();
      }, 'Knob assignment updated and verified.'));
      control.dataset.knob = dest;
      actions.append(control);
    }
  }
  const field=(label,value)=>{const l=document.createElement('label');l.textContent=label+' ';const i=document.createElement('input');i.type=isBinary(p)?'number':'number';i.min=p.min;i.max=p.max;i.step=p.step;i.value=value;l.append(i);return [l,i];};
  if (ab) {
  const [la,ia]=field('A',now), [lb,ib]=field('B',isBinary(p)?(now===1?0:1):(now===p.max?p.min:p.max));
  actions.append(la,lb);
  for(const fs of [0,1]) actions.append(button(`Assign to FS${fs+1}`,()=>run(async()=>{
    if(!ia.checkValidity()||!ib.checkValidity()){ia.reportValidity();ib.reportValidity();return;}
    await checkTarget();
    await session.assignFootswitchParameter(identity,fs,g,index,Number(ia.value),Number(ib.value));
    $('assignment-dialog').close();render();
  },`FS${fs+1} toggles ${p.name}. Save the preset to keep it.`)));
  for(const fs of [0,1]) actions.append(button(`Clear FS${fs+1}`,()=>run(async()=>{await checkTarget();await session.clearFootswitchParameter(identity,fs);$('assignment-dialog').close();render();},`FS${fs+1} parameter assignment cleared.`)));
  }
  $('assignment-dialog').showModal();
  if (!knobCapable && !ab) return;
  run(async () => {
    const info = [];
    if (knobCapable) {
      const current = await session.pedal.assignments();
      for (const btn of actions.querySelectorAll('[data-knob]')) {
        const dest = Number(btn.dataset.knob);
        const binding = current.find(record => record.dest === dest);
        const matches = binding && binding.group === g && binding.id === model && binding.parameter === index;
        btn.dataset.assigned = String(!!matches);
        const target = binding && catalog.describe(binding.group, binding.id)?.parameters?.[binding.parameter]?.name;
        btn.textContent = matches ? `Clear knob ${dest + 1}` : `${binding ? 'Replace' : 'Assign to'} knob ${dest + 1}`;
        info.push(`Knob ${dest + 1}: ${binding ? BLOCKS[binding.group] + ' · ' + (target ?? 'parameter ' + (binding.parameter + 1)) : 'unassigned'}`);
      }
    }
    if (ab) {
      const r = await session.footswitchParameters(identity);
      if (r.metadataFault) info.push('Footswitch assignment data is damaged. Clear it on the pedal.');
      else info.push(...r.records.map((x,i)=>`FS${i+1}: ${describeAB(x)}${r.blockedMask&(1<<i)?' (blocked)':''}`));
    }
    $('assignment-note').textContent = info.join(' · ');
  }, undefined, (message, error) => {
    if (error) {
      for (const button of actions.querySelectorAll('button')) button.dataset.unavailable = 'true';
      $('assignment-note').textContent = message;
    }
    status(message, error);
  });
}

function renderPresets() {
  const term = $('preset-search').value.toLowerCase();
  $('preset-list').replaceChildren();
  let count = 0;
  for (const p of session?.names || []) {
    if (!`${p.slot} ${p.name}`.toLowerCase().includes(term)) continue;
    const li = document.createElement('li'); const b = button('',()=>run(()=>session.select(p.slot),`Selected preset ${p.slot}.`));
    const n = document.createElement('span'); n.textContent=String(p.slot).padStart(2,'0'); const title = document.createElement('span'); title.textContent=p.name;
    b.append(n,title); b.setAttribute('aria-current',String(p.slot===session.slot)); b.setAttribute('aria-label',`Preset ${p.slot}: ${p.name}`); li.append(b); $('preset-list').append(li); count++;
  }
  $('preset-count').textContent = count;
}
function modelName(g,id) { if(g===9) return tones.find(s=>s.slot===(id&255))?.name || 'N→S'; if(g===4 && id>=0x0a100000) return `User IR ${(id&255)+1}`; return catalog.describe(g,id)?.name || `0x${id.toString(16)}`; }
async function setBlockEnabled(g, on) {
  session.writable();
  const explain = (reason) => [
    '', 'CPU FULL: turn another block off first.', 'Turn CAB off first.',
    'Turn N→S on first.', 'Select a user capture for N→S first.',
  ][reason];
  const constraints = on && identity?.has.enableConstraints;
  if (constraints) {
    const reason = (await session.pedal.enableConstraints())[g];
    if (reason) throw new Error(explain(reason));
  }
  try {
    await session.enabled(g, on);
    if (Boolean(session.state.enabled[g]) === on) return;
  } catch (error) {
    if (error.message !== 'the pedal rejected the message' || !on) throw error;
  }
  if (!on) throw new Error('The pedal did not turn this block off.');
  if (constraints) {
    const reason = (await session.pedal.enableConstraints())[g];
    throw new Error(explain(reason) || 'The pedal refused to enable this block.');
  }
  throw new Error('The pedal refused to enable this block. The current effect combination may exceed its CPU limit.');
}

function renderChain() {
  $('chain').replaceChildren(); $('order-controls').replaceChildren(); if(!session?.state) return;
  for (const g of session.state.order) {
    // Keep the clicked node alive: replacing it on the first click prevents native dblclick.
    const b = button(BLOCKS[g],()=>{group=g;for(const node of $('chain').children)node.setAttribute('aria-pressed',String(Number(node.dataset.group)===g));renderBlock();updateControls();},{'aria-pressed':String(group===g),'aria-label':`Edit ${BLOCKS[g]}, ${session.state.enabled[g]?'on':'off'}`,title:'Click to edit · Double-click to turn on/off'});
    b.className='patch-key';
    b.dataset.group=g;
    b.ondblclick=()=>{
      if(busy||!editable())return;
      const on=!session.state.enabled[g];
      run(()=>setBlockEnabled(g,on),`${BLOCKS[g]} turned ${on?'on':'off'}.`);
    };
    bindContext(b,()=>openAssignment(g)); b.dataset.on=session.state.enabled[g]; const s=document.createElement('small'); s.textContent=modelName(g,session.state.models[g]); b.append(s); $('chain').append(b);
  }
  const units=chainUnits(session.state.order);
  units.forEach((u,i)=>{
    const row=document.createElement('div'), label=document.createElement('span'); label.textContent=u.map(g=>BLOCKS[g]).join(' · '); row.append(label);
    for(const [delta,title] of [[-1,'←'],[1,'→']]) { const b=button(title,()=>run(()=>session.order(moveUnit(session.state.order,i,delta)),'Chain order updated.'),{'aria-label':`Move ${u.map(g=>BLOCKS[g]).join(' ')} ${delta<0?'earlier':'later'}`}); b.dataset.edge=(i+delta<0||i+delta>=units.length); row.append(b); }
    $('order-controls').append(row);
  });
}
function renderBlock() {
  const s=session?.state; if(!s) return;
  const e=catalog.describe(group,s.models[group]);
  $('effect-name').textContent=modelName(group,s.models[group]); $('block-category').textContent=`BLOCK / ${BLOCKS[group]}`;
  $('block-enabled').checked=s.enabled[group];
  $('choose-capture').hidden = group !== 2 && group !== 9;
  $('choose-capture').onclick = () => { $('capture-target').value = String(group); updateControls(); };
  $('model').replaceChildren();
  let choices = group===9 && tones.length ? tones.filter(t=>!t.empty).map(t=>({id:(0x0f000000|t.slot)>>>0,name:`${t.slot} · ${t.name}`})) : catalog.effectsOf(group);
  if (demo && group !== 9) choices = choices.filter(effect =>
    previewEffects.some(e => e.group === group && e.id === effect.id) || (group === 2 && effect.id === DST_CAPTURE_ID));
  if (group === 2 && !identity?.has.twoCurveOnly) choices = choices.filter(effect => effect.id !== DST_CAPTURE_ID);
  for(const x of choices) $('model').append(option(x.id,x.name));
  if(![...$('model').options].some(o=>Number(o.value)===s.models[group])) $('model').append(option(s.models[group],modelName(group,s.models[group])));
  $('model').value=s.models[group]; $('parameters').replaceChildren();
  for(const p of e?.parameters || []) {
    if (group === 2 && e.id === DST_CAPTURE_ID && p.storage === 0) {
      const slot = 49 + s.params[group][0];
      const tone = tones.find(t => t.slot === slot);
      const readout = document.createElement('div');
      readout.className = 'parameter';
      readout.textContent = `Capture slot ${slot}${tone ? ' · ' + tone.name : ''}`;
      $('parameters').append(readout);
      continue;
    }
    const row=document.createElement('div'); row.className='parameter'; const label=document.createElement('label'); const id=`param-${group}-${p.storage}`; label.htmlFor=id; label.textContent=p.name; row.append(label);
    const binary=isBinary(p), sw=syncSwitchOf(e,p), synced=sw && s.params[group][sw.storage]===1;
    const min=synced?0:p.min,max=synced?10:p.max,step=synced?1:p.step;
    if(binary) {
      const input=document.createElement('input'); input.type='checkbox'; input.id=id; input.checked=s.params[group][p.storage]===1; input.onchange=()=>run(()=>session.parameter(group,p.storage,input.checked?1:0),`${p.name} updated.`);
      label.className='switch-key';
      label.prepend(input);
    } else {
      const num=document.createElement('input'); num.type='number'; num.id=id; num.min=min;num.max=max;num.step=step;num.value=Number(s.params[group][p.storage].toFixed(5));
      const fader=document.createElement('div');
      fader.className='fader';
      const range=document.createElement('input');
      range.type='range';range.id=`${id}-fader`;range.min=min;range.max=max;range.step=step;range.value=num.value;
      range.setAttribute('aria-label',p.name);
      const scale=document.createElement('div');
      scale.className='fader-scale';
      scale.setAttribute('aria-hidden','true');
      for (const value of [min,max]) {
        const mark=document.createElement('span');
        mark.textContent=Number(value.toPrecision(6));
        scale.append(mark);
      }
      fader.append(range,scale);
      range.oninput=()=>{num.value=range.value;};
      // Commit on native change (release/keyboard step): no unbounded event queue while dragging.
      range.onchange=async()=>{
        const refocus=document.activeElement===range;
        await run(()=>session.parameter(group,p.storage,Number(range.value)),`${p.name} updated.`);
        if (refocus && document.activeElement===document.body) $(range.id)?.focus({preventScroll:true});
      };
      num.onchange=()=>{if(!num.checkValidity()) {num.reportValidity();return;} run(()=>session.parameter(group,p.storage,Number(num.value)),`${p.name} updated.`);};
      row.append(num,fader);
    }
    const block = group;
    bindContext(row,()=>openParameterAssignment(block,p));
    row.append(button('Assign', () => openParameterAssignment(block,p), {
      'aria-label': `Assign ${p.name}`
    }));
    $('parameters').append(row);
  }
  $('write-note').textContent = session.imported ? 'File staged for Save as. Live controls unlock after saving.' : editable() ? demo?'Demo presets and slots reset on reload.':'Changes go live on the pedal. Some pedal edits persist automatically; export a backup to keep a copy.' : 'Connect the pedal to edit.';
}
function render() {
  renderPresets();
  if (!session?.imported) $('import-info').textContent = '';
  if(session?.state) { $('slot-number').textContent=session.imported?'FILE':String(session.slot).padStart(2,'0'); $('patch-name').textContent=session.name(); $('dirty').textContent=session.dirty?'· EDITED':'· SYNCED'; renderChain();renderBlock(); }
  if (demo && session?.state && !session.imported) {
    const config = playableState(session.state, demoRecords, manifest);
    const skipped = BLOCKS.filter((_,g) => session.state.enabled[g] && !config.state.enabled[g]);
    $('live-chain-status').textContent = skipped.length
      ? 'Bypassed in live audio: ' + skipped.join(', ') + '. Only supported effects and loaded captures are heard.'
      : 'Live audio follows the enabled blocks in this preset.';
    liveAudio.update(config, audioSlot !== session.slot);
    audioSlot = session.slot;
  }
  updateControls();
}
async function connect() {
  if(session) session.pedal.close();
  let transport;
  if(demo) {
    const [{FakePedal},{demoSeed}]=await Promise.all([import('../test/fake_pedal.mjs'),import('../test/demo_seed.mjs')]);
    const seed = demoSeed(catalog);
    const trem = previewEffects.find(effect => effect.id === 0x04000030);
    const preset = PRST.applyEdits(seed.preset, {
      models:{6:trem.id},
      params:{6:Object.fromEntries(trem.parameters.map(p => [p.storage, p.default]))},
      bypass:Object.fromEntries(BLOCKS.map((_,g) => [g,g === 6]))
    });
    seed.active = stateOfPreset(preset).raw;
    const simulated = new FakePedal(seed, catalog);
    simulated.records = demoRecords;
    simulated.identity.features |= (1 << 9) | (1 << 13);
    transport = simulated.transport();
  }
  else ({transport}=await connectWebMidi());
  session=new EditorSession(demo?new Pedal(transport,{catalog,gapMs:0,log}):new FootswitchPedal(transport,{catalog,gapMs:200,log}),catalog,{demo});
  await session.refresh();
  identity=await session.pedal.identity();
  if(demo)document.querySelector('.load-panel').hidden=true;   // no pedal to measure
  session.pedal.on('notification', (n) => {
    if (demo) return; // Demo has no external controls; local edits already read back.
    if (busy || session.imported) return;
    if (['parameter','effect','enable','preset','chain','dirty'].includes(n.type)) { session.stale = true; status('Pedal changed. Press Refresh to read its latest state before editing.'); updateControls(); }
  });
  $('connection-state').textContent=demo?'Demo connected':'USB connected'; $('mode-label').textContent=demo?'Demo':'Connected to your GP-50';
  $('mode-note').textContent=demo?'Play through Peppercorn effects and LTTC captures with an audio interface. Demo presets and slots reset on reload.':'The pedal is ready. Export a backup before editing.';
  slotFormats.clear();
  await readTones();
}
$('connect').onclick=()=>run(connect,demo?'Demo ready.':'Connected. Read-only state and names loaded.');
$('disconnect').onclick=()=>{session?.pedal.close();session=null;tones=[];$('connection-state').textContent='Offline';location.reload();};
$('refresh').onclick=()=>run(async()=>{await session.refresh();session.imported=null;session.dirty=false;},'Refreshed from the pedal.');
$('preset-search').oninput=()=>{renderPresets();updateControls();};
bindContext($('block-enabled').parentElement,()=>openAssignment(group));
$('assign-block').onclick=()=>openAssignment(group);
$('block-enabled').onchange=()=>run(()=>setBlockEnabled(group,$('block-enabled').checked),'Block updated.');
$('model').onchange=()=>run(()=>session.model(group,Number($('model').value)),'Model selected; pedal defaults loaded.');
$('read-load').onclick=()=>run(async()=>{const load=await session.pedal.load();for(const key of ['arm','dsp']) {$(key+'-load').value=load[key];$(key+'-value').value=(100*load[key]).toFixed(0)+'%';}},'Load read from custom firmware.');
function download(name,bytes,type='application/octet-stream') { const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
$('export-preset').onclick=()=>{try{download(`${session.name().replace(/[^a-z0-9_-]/gi,'_')}.prst`,session.bytes());status('Preset exported from current working state.');}catch(e){status(e.message,true);}};
$('open-import').onclick = () => $('import-preset').click();
$('import-preset').onchange = () => {
  const file = $('import-preset').files[0];
  $('import-preset').value = '';
  if (!file) return;
  run(async () => {
    if (file.size !== 552) throw new Error('Expected a 552-byte GP-50 .prst.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    validatePreset(bytes, catalog);
    session.stage(bytes);
    $('import-info').textContent = `${file.name} · staged for Save as`;
  }, 'Preset file staged. Use Save as to store it on the pedal.');
};
$('save-slot').append(...Array.from({length:100},(_,i)=>i).map(s=>option(s,String(s).padStart(2,'0'))));
$('open-save').onclick=()=>{ $('save-name').value=session.name().slice(0,10);$('save-slot').value=session.slot;$('save-confirm').checked=false;$('save-source').textContent=`From ${session.imported?'imported file':`current preset ${session.slot}`}. Includes your current edits.`;$('save-dialog').showModal();};
$('cancel-save').onclick=()=>$('save-dialog').close();
$('save-form').onsubmit=(event)=>{event.preventDefault();if(!$('save-form').reportValidity())return;run(async()=>{await session.save(Number($('save-slot').value),$('save-name').value,true);$('save-dialog').close();},'Preset saved and readback verified.');};
const captureStatus = (message, error = false) => {
  $('capture-status').textContent = message;
  $('capture-status').dataset.error = error;
};
const runCapture = (fn, message) => run(fn, message, captureStatus);
const selectedTone = () => tones.find(t => String(t.slot) === $('tone-slot').value);
const copyTone = () => tones.find(t => String(t.slot) === $('copy-slot').value);
const selectedCapture = () => [...bundledCaptures, ...localCaptures].find(c => c.id === $('collection-item').value);
const pedalName = title => title.replace(/[^ -~]/g, '').trim().slice(0, 15) || 'MY CAPTURE';

function renderCollection(preferred) {
  $('collection-item').replaceChildren();
  for (const [label, captures] of [['Bundled LTTC captures', bundledCaptures], ['Added on this browser', localCaptures]]) {
    if (!captures.length) continue;
    const section = document.createElement('optgroup');
    section.label = label;
    section.append(...captures.map(c => option(c.id, c.title)));
    $('collection-item').append(section);
  }
  if ([...$('collection-item').options].some(o => o.value === preferred)) $('collection-item').value = preferred;
  showCapture();
}
function showCapture() {
  const capture = selectedCapture();
  $('record-info').textContent = capture?.file
    ? `From a capture by ${capture.author} · loads as ${capture.name}`
    : capture ? `Saved in this browser · loads as ${capture.name}` : 'Add an LTTC file to get started.';
  $('remove-capture').hidden = !capture?.data;
  $('replace-tone').checked = false;
  updateControls();
}
function saveCollection(next) {
  localStorage.setItem(collectionKey, JSON.stringify(next));
  localCaptures = next;
}
async function loadCollection() {
  try {
    const saved = JSON.parse(localStorage.getItem(collectionKey) ?? '[]');
    if (!Array.isArray(saved)) throw new Error();
    localCaptures = saved.filter(c => c?.kind === 'GPTS' && typeof c.data === 'string' && c.data.length === 3596);
  } catch {
    captureStatus('Could not read captures saved in this browser.', true);
  }
  try {
    const response = await fetch(captureCatalog);
    if (!response.ok) throw new Error();
    bundledCaptures = (await response.json()).captures.map(c => ({...c, kind: 'GPTS'}));
  } catch {
    captureStatus('Could not load the bundled captures. You can still add files.', true);
  }
  renderCollection(query.get('capture') ?? $('collection-item').value);
}
function updateCaptureControls(connected, editable) {
  const tone = selectedTone(), destination = copyTone(), capture = selectedCapture();
  const occupied = tone && !tone.empty;
  const format = slotFormats.get(tone?.slot);
  const dstSupported = !!identity?.has.twoCurveOnly;
  const target = $('capture-target');
  target.options[1].disabled = !dstSupported;
  if (!dstSupported && target.value === '2' && connected) target.value = '9';
  $('copy-slot').disabled = busy || !connected || !destination;
  target.disabled = busy || !connected;
  $('tone-slot').disabled = busy || !connected || !tones.length;
  $('tone-info').textContent = tone
    ? tone.empty ? 'Empty user slot' : tone.user ? 'Stored in a user slot' : 'Factory slot'
    : connected ? 'Read the slots to continue.' : 'Connect your pedal to see its slots.';
  $('copy-info').textContent = !connected ? 'Connect your pedal to load a capture.'
    : !identity?.has.gpts ? 'Loading LTTC requires Peppercorn firmware.'
      : target.value && !editable ? 'Finish editing or saving the staged preset, or choose Store only.'
        : destination?.empty ? 'Empty slot.' : 'This slot already contains a capture.';
  $('collection-item').disabled = busy || !capture;
  $('add-capture').disabled = busy;
  $('remove-capture').disabled = busy;
  $('replace-label').hidden = !destination || destination.empty;
  $('replace-tone').disabled = busy;
  $('upload-tone').textContent = target.value ? `Load and use in ${BLOCKS[Number(target.value)]}` : 'Load to slot';
  $('upload-tone').disabled = busy || !connected || !capture || !destination || !identity?.has.gpts ||
    (!!target.value && !editable) || (!destination.empty && !$('replace-tone').checked);
  $('use-tone').disabled = busy || !editable || !occupied;
  $('use-dst').disabled = busy || !editable || !occupied || !tone?.user || !dstSupported || (format && format !== 'GPTS');
  $('delete-tone').disabled = busy || !connected || !tone?.user || !occupied;
}

async function readTones(updated = null, selectedSlot = null) {
  const stored = $('tone-slot').value, destination = $('copy-slot').value;
  updated ??= await session.pedal.snapTones();
  for (const [slot] of slotFormats) {
    if (updated[slot].empty || updated[slot].name !== tones[slot]?.name) slotFormats.delete(slot);
  }
  tones = updated;
  const firstEmpty = String(tones.find(t => t.empty)?.slot ?? 50);
  for (const [id, slots, value] of [
    ['tone-slot', [...tones.slice(50), ...tones.slice(0, 50).filter(t => !t.empty)], selectedSlot ?? (stored || firstEmpty)],
    ['copy-slot', tones.slice(50), selectedSlot === null ? destination || firstEmpty : firstEmpty]
  ]) {
    const picker = $(id);
    picker.replaceChildren(...slots.map(t => option(t.slot, `${String(t.slot).padStart(2, '0')} · ${t.empty ? 'Empty' : t.name}`)));
    picker.value = String(value);
    if (picker.selectedIndex < 0) picker.value = firstEmpty;
  }
  $('replace-tone').checked = false;
}
$('refresh-tones').onclick = () => runCapture(() => readTones(), 'Slots refreshed.');
$('tone-slot').onchange = () => { captureStatus(''); updateControls(); };
$('copy-slot').onchange = () => {
  $('replace-tone').checked = false;
  captureStatus('');
  updateControls();
};
$('capture-target').onchange = updateControls;
$('replace-tone').onchange = updateControls;
$('collection-item').onchange = () => { captureStatus(''); showCapture(); };
$('add-capture').onclick = () => $('record-file').click();
$('record-file').onchange = () => {
  const files = [...$('record-file').files];
  $('record-file').value = '';
  if (!files.length) return;
  runCapture(async () => {
    const added = [];
    for (const file of files) {
      if (file.size !== 2696) throw new Error(`${file.name}: expected a 2,696-byte capture record.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = describeRecord(bytes);
      if (!info.ok) throw new Error(`${file.name}: ${info.problem}`);
      if (info.kind !== 'GPTS') throw new Error(`${file.name} is not LTTC. Use the uploader for other capture formats.`);
      const title = file.name.replace(/\.[^.]*$/, '');
      added.push({id: `local-${crypto.randomUUID()}`, title, name: pedalName(title),
        label: info.label, kind: info.kind, data: btoa(String.fromCharCode(...bytes))});
    }
    saveCollection([...localCaptures, ...added]);
    renderCollection(added[0].id);
  }, files.length === 1 ? 'Capture added to your collection.' : 'Captures added to your collection.');
};
$('remove-capture').onclick = () => runCapture(() => {
  const selected = selectedCapture();
  saveCollection(localCaptures.filter(c => c.id !== selected.id));
  renderCollection();
}, 'Capture removed from this browser.');
$('upload-form').onsubmit = event => {
  event.preventDefault();
  if ($('upload-tone').disabled) return;
  const capture = selectedCapture(), tone = copyTone();
  const name = capture.name, overwrite = $('replace-tone').checked;
  const target = $('capture-target').value;
  runCapture(async () => {
    let bytes;
    if (capture.file) {
      const response = await fetch(new URL(capture.file, captureCatalog));
      if (!response.ok) throw new Error('Could not download the selected capture.');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      bytes = Uint8Array.from(atob(capture.data), ch => ch.charCodeAt(0));
    }
    const info = describeRecord(bytes);
    if (!info.ok || info.kind !== 'GPTS') throw new Error('The selected file is not a valid LTTC capture.');
    const progress = $('upload-progress');
    progress.value = 0;
    progress.hidden = false;
    try {
      const updated = await session.pedal.uploadRecord(tone.slot, name, bytes, {overwrite, onProgress: (i,n) => {
        progress.max = n;
        progress.value = i;
      }});
      await readTones(updated, tone.slot);
      slotFormats.set(tone.slot, info.kind);
    } finally {
      progress.hidden = true;
    }
    const loaded = `Loaded ${name} into slot ${tone.slot}.`;
    if (!target) { captureStatus(loaded); return; }
    try {
      await session.capture(Number(target), tone.slot);
      group = Number(target);
    } catch (error) {
      throw new Error(`${loaded} Could not assign to ${BLOCKS[Number(target)]}. ${error.message}`);
    }
    captureStatus(`${loaded} Now in ${BLOCKS[group]}. Save the preset to keep the assignment.`);
  });
};
function applyCapture(target) {
  const tone = selectedTone();
  runCapture(async () => {
    await session.capture(target, tone.slot);
    group = target;
  }, `Using ${tone.name} in ${BLOCKS[target]}. Save the preset to keep the assignment.`);
}
$('use-tone').onclick = () => applyCapture(9);
$('use-dst').onclick = () => applyCapture(2);
$('delete-tone').onclick=()=>{const t=tones.find(t=>t.slot===Number($('tone-slot').value));$('delete-description').textContent=`Slot ${t.slot} · ${t.name}`;$('delete-dialog').returnValue = '';$('delete-dialog').showModal();};
$('delete-dialog').addEventListener('close',()=>{if($('delete-dialog').returnValue==='delete')runCapture(async()=>{await session.pedal.deleteRecord(selectedTone().slot);await readTones();},'User record deleted.');});
$('read-irs').onclick=()=>run(async()=>{const irs=await session.pedal.irs();$('ir-slot').replaceChildren(...irs.map(i=>option(i.slot,`${i.slot+1} · ${i.name}`)));},'User IR names loaded.');
$('use-ir').onclick=()=>run(async()=>{session.writable();await session.pedal.useIR(Number($('ir-slot').value));session.state=await session.pedal.state();session.dirty=true;group=4;},'User IR selected in CAB.');
const logButton=button('Download MIDI session log',()=>download('gp50-midi-log.json',JSON.stringify({truncatedAt20000Frames:logs.length===20000,frames:logs},null,2),'application/json'));$('help').append(logButton);
// Notifications are advisory; refresh explicitly to avoid traffic during unsolicited events.
// No polling and no probing unknown selectors during connection.
status(demo?'Starting simulated pedal…':'Ready. Connect a pedal, or open the demo.');render();
const collectionReady = loadCollection();
if(demo) await run(connect,'Demo ready.');
else if(!navigator.requestMIDIAccess) { $('connect').disabled=true;$('mode-note').textContent='You can try the demo or open preset files here. For USB, use Chrome, Edge or desktop Firefox.'; }
await collectionReady;
