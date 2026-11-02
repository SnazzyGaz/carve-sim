// Carve Sim · SVG showroom. Import a finished SVG (from the CNC skill or any vector art) -> one bake in a worker ->
// the 3D board in your choice of wood, finish, fill and light. The old image tracer is a lazy side panel (trace-panel.js).
import { Viewer } from './viewer.js';
import { SPECIES, FINISHES, FILLS, LIGHTS } from './materials.js';
import { parseSvg, rasterFor, DEFAULT_WIDTH_MM } from './svg-import.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const settings = { carve: 'auto', vbit_angle: 60, depth: 3, pocket_depth: 6, engrave_depth: 1, width_mm: 300, margin: 18, thickness: 22 };
const TEX_MAX = 2048, SS = 2;
const app = { doc: null, job: null, traced: null, seq: 0, settings };
window.app = app;
const qs = new URLSearchParams(location.search);

const viewer = new Viewer($('#vp3d'));
app.viewer = viewer;

// ---------------------------------------------------------------- sliders
function fmt(v, step) { const d = String(step).includes('.') ? String(step).split('.')[1].length : 0; return Number(v).toFixed(Math.min(d, 3)); }
for (const el of $$('.slider')) {
  const k = el.dataset.k, u = el.dataset.u || '';
  el.innerHTML = `<div class="hd"><span>${el.dataset.label || k}</span><output></output></div><input type="range" min="${el.dataset.min}" max="${el.dataset.max}" step="${el.dataset.step}" value="${el.dataset.v}">`;
  const inp = el.querySelector('input'), out = el.querySelector('output');
  const paint = () => { const p = (inp.value - inp.min) / (inp.max - inp.min) * 100; inp.style.setProperty('--p', p + '%'); out.textContent = el.dataset.pct ? Math.round(inp.value * 100) + '%' : fmt(inp.value, el.dataset.step) + (u ? ' ' + u : ''); };
  paint();
  inp.addEventListener('input', () => {
    paint();
    const v = parseFloat(inp.value);
    if (el.dataset.scope === 'view') {
      viewer.interact();                 // draft frames while dragging, full quality when it stops
      if (k === 'glow') viewer.setMaterial({ glow: v });
      else if (k === 'fillLevel' || k === 'menisc') { const o = { [k]: v }; if (viewer.state.sanded) { o.sanded = false; $('#sanded').checked = false; } viewer.setMaterial(o); }
      else if (k === 'charScale') { viewer.uniforms.uCharScale.value = v; viewer.dirty = true; }
      else viewer.setLighting({ [k]: v });
    } else if (k === 'vbit_angle') { settings.vbit_angle = v; syncChips(); }
  });
  // carve settings bake once, on release (no re-bake per drag step)
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (el.dataset.scope === 'bake') { settings[k] = v; requestBake(); }
    else if (el.dataset.scope === 'board') { settings[k] = v; viewer.setBoard({ [k]: v }); }
  });
  el.set = (v) => { inp.value = v; paint(); };
}
const slider = (k) => $(`.slider[data-k="${k}"]`);
function syncChips() { for (const b of $$('#vbitChips button')) b.classList.toggle('on', +b.dataset.v === settings.vbit_angle); }
$$('#vbitChips button').forEach((b) => b.onclick = () => { settings.vbit_angle = +b.dataset.v; slider('vbit_angle').set(settings.vbit_angle); syncChips(); requestBake(); });
$('#carve').onchange = (e) => { settings.carve = e.target.value; carveUI(); requestBake(); };

function seg(sel, cb) {
  $$(sel + ' button').forEach((b) => b.onclick = () => { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
function segSet(sel, v) { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); }

// ---------------------------------------------------------------- material UI
const woodSwatch = (s) => `linear-gradient(90deg, ${s.early} 0 18%, ${s.late} 22% 26%, ${s.early} 30% 52%, ${s.late} 56% 61%, ${s.early} 66% 84%, ${s.late} 88% 92%, ${s.early} 96%)`;
function woodChips(sel, key) {
  $(sel).innerHTML = Object.entries(SPECIES).map(([k, s]) => `<button data-v="${k}"><span class="sw" style="background:${woodSwatch(s)}"></span>${s.name}</button>`).join('');
  $$(sel + ' button').forEach((b) => b.onclick = () => { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x === b)); viewer.setMaterial({ [key]: b.dataset.v }); });
  segSet(sel, viewer.state[key]);
}
woodChips('#species', 'species'); woodChips('#inserts', 'insert');
$('#finish').innerHTML = Object.entries(FINISHES).map(([k, f]) => `<button data-v="${k}">${f.name}</button>`).join('');
seg('#finish', (v) => viewer.setMaterial({ finish: v })); segSet('#finish', viewer.state.finish);
{
  let html = '', grp = '';
  for (const [k, f] of Object.entries(FILLS)) {
    if (f.group !== grp) { grp = f.group; html += `<div class="grp">${grp}</div>`; }
    const bg = f.type === 1 ? `linear-gradient(135deg, ${f.color}, #fff8 45%, ${f.color} 60%, #0006)` : f.type === 2 ? `linear-gradient(135deg, ${f.color}cc, ${f.scatter})` : f.type === 3 ? `radial-gradient(${f.glow}, ${f.color})` : f.color;
    html += `<button data-v="${k}"><span class="sw" style="background:${bg}"></span>${f.name}</button>`;
  }
  $('#resins').innerHTML = html;
  $$('#resins button').forEach((b) => b.onclick = () => { $$('#resins button').forEach((x) => x.classList.toggle('on', x === b)); viewer.setMaterial({ fillPreset: b.dataset.v }); });
  segSet('#resins', viewer.state.fillPreset);
}
function fillUI(v) {
  $('#fillEpoxy').classList.toggle('hidden', v !== 'epoxy');
  $('#fillInlay').classList.toggle('hidden', !(v === 'inlay' || v === 'reverse'));
  $('#fillChar').classList.toggle('hidden', v !== 'char');
  $('#sandRow').classList.toggle('hidden', v === 'none');
  $('#inlayLabel').textContent = v === 'reverse' ? 'Field species (the board shows through as the design)' : 'Inlay species (fills the carve)';
}
seg('#fill', (v) => { fillUI(v); viewer.setMaterial({ fill: v }); });
$('#sanded').onchange = (e) => viewer.setMaterial({ sanded: e.target.checked });
$('#flood').onchange = (e) => { const o = { flood: e.target.checked }; if (viewer.state.sanded) { o.sanded = false; $('#sanded').checked = false; } viewer.setMaterial(o); };
$('#lightPreset').innerHTML = Object.entries(LIGHTS).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('');
$('#lightPreset').onchange = (e) => { viewer.setLighting({ light: e.target.value }); syncLightSliders(); };
function syncLightSliders() { for (const k of ['az', 'el', 'key', 'warm', 'fillLight', 'env', 'exposure', 'ao']) slider(k).set(viewer.state[k]); }
$('#shadows').onchange = (e) => viewer.setLighting({ shadows: e.target.checked });
$('#sway').onchange = (e) => viewer.setSway(e.target.checked);
seg('#backdrop', (v) => viewer.setLighting({ backdrop: v }));
$('#meshRes').onchange = (e) => viewer.setMeshRes(+e.target.value);
$$('#views button').forEach((b) => b.onclick = () => viewer.setView(b.dataset.view));

// tabs
$$('.tabs>button').forEach((b) => b.onclick = () => {
  $$('.tabs>button').forEach((x) => x.classList.toggle('on', x === b));
  $('#vp3d').classList.toggle('hidden', b.dataset.tab !== '3d'); $('#vp2d').classList.toggle('hidden', b.dataset.tab !== '2d');
  $('#views').style.visibility = b.dataset.tab === '3d' ? 'visible' : 'hidden';
  viewer.resize();
});

// ---------------------------------------------------------------- look A / B
// two complete looks (wood, finish, fill, light) to flip between; edits always go to the active letter
const LOOK_M = ['species', 'finish', 'fill', 'fillPreset', 'insert', 'sanded', 'glow', 'fillLevel', 'flood', 'menisc'];
const LOOK_L = ['az', 'el', 'key', 'warm', 'fillLight', 'env', 'exposure', 'ao', 'shadows', 'backdrop'];
const looks = { A: null, B: null }; let lookOn = 'A';
const grabLook = () => { const S = viewer.state, m = {}, l = { light: S.light }; for (const k of LOOK_M) m[k] = S[k]; for (const k of LOOK_L) l[k] = S[k]; return { m, l }; };
function applyLook(L) {
  const { light, ...rest } = L.l;
  app.set({ material: L.m, light: { light } }); app.set({ light: rest });
  $('#shadows').checked = !!viewer.state.shadows; segSet('#backdrop', viewer.state.backdrop);
}
seg('#ab', (v) => {
  if (v === lookOn) return;
  looks[lookOn] = grabLook(); lookOn = v;
  if (looks[v]) applyLook(looks[v]); else looks[v] = grabLook();
});

// ---------------------------------------------------------------- SVG import
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
$('#fileIn').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
document.addEventListener('paste', (e) => {
  if (e.target.closest && e.target.closest('input,textarea,select')) return;
  const f = [...(e.clipboardData?.files || [])].find((x) => /svg/.test(x.type) || /\.svg$/i.test(x.name));
  if (f) { e.preventDefault(); loadFile(f); return; }
  const t = e.clipboardData?.getData('text/plain') || '';
  if (/<svg[\s>]/i.test(t)) { e.preventDefault(); loadSvgText(t, 'pasted.svg'); }
});

async function loadFile(f, name = f.name) {
  if (/^image\/(png|jpe?g)$/.test(f.type) || /\.(png|jpe?g)$/i.test(name)) {   // an image: offer it to the tracer
    const tp = await openTrace(); tp.setImage(f, name); setStatus('ok', 'Image ready: press Trace'); return;
  }
  return loadSvgText(await f.text(), name);
}
async function loadSvgText(text, name = 'artwork.svg', from = null) {
  const t0 = performance.now();
  setStatus('busy', 'Reading SVG…');
  let doc;
  try { doc = await parseSvg(text, name); }
  catch (e) { console.error(e); setStatus('err', e.message || 'Could not read that SVG'); return; }
  doc.t0 = t0; doc.parse_ms = Math.round(performance.now() - t0); doc.from = from;
  if (!doc.layers.some((l) => l.kind !== 'profile' && l.items.length) && !doc.generic) { setStatus('err', 'No carvable shapes in that SVG'); return; }
  app.doc = doc; app.job = null;
  // the file decides the size; bit and depths carry over unless the file names them
  const M = doc.meta;
  settings.width_mm = Math.round((doc.width_mm || DEFAULT_WIDTH_MM) * 10) / 10;
  if (M.vbit_angle) settings.vbit_angle = M.vbit_angle;
  if (M.depth_mm) { if (doc.mode === 'pocket') settings.pocket_depth = M.depth_mm; else settings.depth = M.depth_mm; }
  if (M.pocket_depth_mm) settings.pocket_depth = M.pocket_depth_mm;
  if (M.engrave_depth_mm) settings.engrave_depth = M.engrave_depth_mm;
  settings.carve = 'auto'; $('#carve').value = 'auto';
  settings.margin = doc.hasProfile ? 0 : (settings.margin || 18);
  for (const k of ['vbit_angle', 'depth', 'pocket_depth', 'engrave_depth', 'width_mm', 'margin']) slider(k).set(settings[k]);
  syncChips(); carveUI();
  viewer.state.margin = settings.margin; viewer.state.thickness = settings.thickness;   // applied by setDepth, no extra rebuild
  $('#fileName').textContent = `${name}  ·  ${settings.width_mm} × ${Math.round(settings.width_mm * doc.vb[3] / doc.vb[2] * 10) / 10} mm`;
  $('#empty3d').classList.add('hidden');
  if (doc.generic) {
    busy(true, 'Drawing the SVG…');
    try { doc.raster = await rasterFor(doc, TEX_MAX, SS); } catch (e) { console.error(e); setStatus('err', 'The browser could not draw that SVG'); busy(false); return; }
    doc.raster_ms = Math.round(performance.now() - t0) - doc.parse_ms;
  }
  return requestBake();
}
function effKinds() {
  const d = app.doc; if (!d) return [];
  return d.kinds.map((k) => k === 'region' || (settings.carve !== 'auto' && k !== 'engrave') ? (settings.carve !== 'auto' ? settings.carve : d.mode) : k);
}
function carveUI() {
  const K = effKinds(), has = (...k) => !app.doc || k.some((x) => K.includes(x));
  slider('vbit_angle').classList.toggle('hidden', !has('vcarve', 'engrave')); $('#vbitChips').classList.toggle('hidden', !has('vcarve', 'engrave'));
  slider('depth').classList.toggle('hidden', !has('vcarve'));
  slider('pocket_depth').classList.toggle('hidden', !has('pocket', 'level'));
  slider('engrave_depth').classList.toggle('hidden', !(app.doc && K.includes('engrave')));
}

// ---------------------------------------------------------------- bake (svg-worker.js)
const worker = new Worker(new URL('./svg-worker.js', import.meta.url));
const waits = new Map(); let rid = 0;
worker.onmessage = (e) => {
  const d = e.data, w = waits.get(d.rid); if (!w) return;
  if (d.progress != null) w.onp(d.progress, d.label);
  else if (d.preview) { waits.delete(d.rid); w.onprev(d.preview); }
  else if (d.ok) w.res(d); else { waits.delete(d.rid); w.rej(new Error(d.error)); }
};
worker.onerror = (e) => console.error('bake worker', e.message || e);
let baking = false, again = false, idle = [];
app.ready = () => new Promise((res) => { if (!baking && !again) res(app.job); else idle.push(res); });
function requestBake() {
  if (!app.doc) return Promise.resolve(null);
  if (baking) { again = true; return app.ready(); }
  return bake();
}
async function bake() {
  const doc = app.doc, my = ++app.seq; baking = true; again = false;
  const tb = performance.now();
  busy(true, 'Baking…'); progress(0); setStatus('busy', 'Baking the carve…');
  const msg = { type: 'bake', doc: { id: doc.id, vb: doc.vb, mode: doc.mode, layers: doc.layers, raster: doc.raster || null },
    opts: { ...settings, tex_max: TEX_MAX, ss: SS } };
  try {
    const r = await new Promise((res, rej) => {
      const id = ++rid; waits.set(id, { res, rej, onp: (p, l) => { progress(p); if (l) $('#busyText').textContent = l + '…'; }, onprev: (b) => showPreview(b, doc) });
      worker.postMessage({ ...msg, rid: id });
    });
    if (my !== app.seq || doc !== app.doc) return;
    const tw0 = performance.now();
    const prevW = viewer.depth && viewer.depth.artW;
    viewer.setDepth(new Uint16Array(r.depthRG), r.tw, r.th, r.W, r.H, r.md, new Uint8Array(r.ao));
    if (prevW && Math.abs(prevW - r.W) > 0.01 * r.W) viewer.setView('angle');   // new size: frame the whole board again
    const job = { name: doc.name, stats: r.stats, bake_ms: Math.round(tw0 - tb), worker_ms: r.stats.timing_ms, parse_ms: doc.parse_ms, raster_ms: doc.raster_ms || 0,
      settings: { ...settings }, kinds: effKinds(), layers: doc.layers.map((l) => ({ name: l.name, kind: l.kind, shapes: l.items.length })) };
    app.job = job;
    app.traced = { stats: { paths: doc.nShapes, nodes: null, estimate: { time_min: null } }, params: { ...settings } };   // older test tools wait on this
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    job.first_frame_ms = Math.round(performance.now() - (doc.firstDone ? tb : doc.t0)); job.from_import = !doc.firstDone; doc.firstDone = true;
    showStats(job, doc);
    $('#btnPng').disabled = false;
    setStatus('ok', `Baked · ${job.first_frame_ms} ms`);
  } catch (e) { console.error(e); if (my === app.seq) setStatus('err', 'Bake failed: ' + String(e.message).slice(0, 80)); }
  finally {
    baking = false;
    if (again) bake();
    else { busy(false); idle.splice(0).forEach((f) => f(app.job)); }
  }
}
function showPreview(blob, doc) {
  if (doc !== app.doc) return;
  if (app.previewUrl) URL.revokeObjectURL(app.previewUrl);
  app.previewUrl = URL.createObjectURL(blob);
  $('#img2d').src = app.previewUrl; $('#thumb').src = app.previewUrl; drop.classList.add('has');
}
function setStatus(cls, text) { const s = $('#status'); s.className = 'status ' + cls; s.querySelector('span').textContent = text; }
function busy(on, text) { $('#busy').classList.toggle('hidden', !on); if (text) $('#busyText').textContent = text; }
function progress(p) { const bar = $('#cvBar'); bar.classList.toggle('hidden', p == null); if (p != null) bar.firstElementChild.style.width = Math.round(p * 100) + '%'; }

const KIND = { vcarve: 'V-carve', pocket: 'pocket', level: 'pocket level', engrave: 'engrave', profile: 'profile / cut-out', region: 'filled art' };
function showStats(job, doc) {
  const s = job.stats, cell = (k, v, u = '', wide = false) => `<div class="stat${wide ? ' wide' : ''}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`;
  const lay = doc.generic ? `drawn by the browser · cut as ${KIND[job.kinds[0]] || job.kinds[0]}` : doc.layers.map((l) => `${l.name} <small>(${KIND[l.kind] || l.kind}, ${l.items.length})</small>`).join('<br>');
  const notes = [];
  if (!doc.width_mm) notes.push(`No physical units in the file (width="${doc.vb[2]}"), so it is sized to ${DEFAULT_WIDTH_MM} mm wide. Change it under Finished width.`);
  else notes.push(`Size from the file: ${doc.sizeFrom}.`);
  if (doc.hasProfile) notes.push('profile_border layer: the board is cut out on that line, so the margin starts at 0.');
  if (doc.meta.comment) notes.push(`Skill metadata: ${doc.meta.comment.replace(/^CNC vector \|\s*/i, '')}`);
  $('#stats').innerHTML = [
    cell('Finished size', `${s.size_mm[0]} × ${s.size_mm[1]}`, 'mm', true),
    cell('Deepest cut', s.max_depth_mm, 'mm'), cell('Cut area', s.cut_pct, '%'),
    cell('Shapes', doc.nShapes), cell(job.from_import ? 'Import → 3D' : 'Re-bake', job.first_frame_ms, 'ms'),
    `<div class="stat wide"><div class="k">Layers</div><div class="v" style="font-size:12.5px;line-height:1.5">${lay}</div></div>`,
    `<div class="note">${notes.join('<br>')}</div>`,
  ].join('');
  $('#warns').innerHTML = '';
}

// samples: the first load shows the bundled sample so the board is never empty (?nosample skips it, for tests)
fetch('samples/index.json').then((r) => r.json()).then((list) => {
  $('#samples').innerHTML = list.map((s) => `<button data-p="${s.path}" title="${s.path}">${s.label}</button>`).join('');
  $$('#samples button').forEach((b) => b.onclick = () => app.loadPath(b.dataset.p));
  const d = list.find((s) => s.default) || list[0];
  if (d && !qs.has('nosample') && !app.doc) app.loadPath(d.path);
}).catch(() => {});
// load a file shipped with the app (relative URL): SVGs import, images go through the tracer
app.loadPath = async (path) => {
  const r = await fetch(path);
  if (!r.ok) { setStatus('err', 'Could not fetch ' + path); return; }
  const name = path.split('/').pop();
  if (/\.svg$/i.test(path)) { await loadSvgText(await r.text(), name); return app.ready(); }
  const tp = await openTrace(); tp.setImage(await r.blob(), name); await tp.trace(); return app.ready();
};
app.loadSvgText = (t, n) => loadSvgText(t, n).then(() => app.ready());

// ---------------------------------------------------------------- trace (lazy)
// Nothing of the tracer (engine, carve worker, OpenCV wasm) loads until this panel is opened.
let tracePanel = null;
function openTrace() {
  const box = $('#traceBox'); if (!box.open) box.open = true;
  return tracePanel ??= import('./trace-panel.js').then((m) => m.initTrace({ $, $$, seg, settings, setStatus,
    onSvg: (svg, name) => loadSvgText(svg, name, 'trace') }));
}
$('#traceBox').addEventListener('toggle', () => { if ($('#traceBox').open) openTrace(); });
app.openTrace = openTrace;

// ---------------------------------------------------------------- export
const base = () => (app.doc?.name || 'art').replace(/\.[^.]+$/, '');
function dl(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
app.dl = dl;
$('#btnPng').onclick = async () => {
  const b = $('#btnPng'); b.disabled = true; setStatus('busy', 'Rendering PNG…');
  try {
    const blob = await viewer.exportPNG(+$('#pngScale').value);
    const S = viewer.state; const url = URL.createObjectURL(blob);
    dl(url, `${base()}_${S.species}_${S.fill}${S.fill === 'epoxy' ? '-' + S.fillPreset : ''}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 4000); setStatus('ok', 'PNG saved');
  } finally { b.disabled = false; }
};

// helpers for scripted renders (tests, batch beauty shots)
app.set = (o) => {
  if (o.material) { viewer.setMaterial(o.material); segSet('#fill', viewer.state.fill); fillUI(viewer.state.fill); segSet('#species', viewer.state.species); segSet('#inserts', viewer.state.insert); segSet('#finish', viewer.state.finish); segSet('#resins', viewer.state.fillPreset); $('#sanded').checked = viewer.state.sanded; $('#flood').checked = !!viewer.state.flood; for (const k of ['fillLevel', 'menisc']) slider(k).set(viewer.state[k]); }
  if (o.light) { viewer.setLighting(o.light); syncLightSliders(); if (o.light.light) $('#lightPreset').value = o.light.light; }
  if (o.view) viewer.setView(o.view);
  if (o.close) viewer.setCloseUp(o.close[0], o.close[1]);
};
app.setBake = (o) => { Object.assign(settings, o); for (const k in o) { const s = slider(k); if (s) s.set(o[k]); } if (o.carve) $('#carve').value = o.carve; carveUI(); if ('margin' in o || 'thickness' in o) viewer.setBoard(o); return requestBake(); };
fillUI('none');

// offline: a small service worker caches the app shell (and the tracer once it has been used); ?nosw skips it
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !qs.has('nosw')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e)));
}
