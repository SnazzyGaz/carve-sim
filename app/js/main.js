// Carve Sim · SVG showroom. Import a finished SVG (from the CNC skill or any vector art) -> one bake in a worker ->
// the 3D board in your choice of wood, finish, fill and light. The old image tracer is a lazy side panel (trace-panel.js).
import { Viewer } from './viewer.js';
import { SPECIES, FINISHES, FILLS, LIGHTS, customFill } from './materials.js';
import { parseSvg, rasterFor, DEFAULT_WIDTH_MM } from './svg-import.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// The carve comes from the SVG alone (it was made for its bit): layers, size and the skill's metadata (depth=, vbit_angle=,
// mode=). Where the file says nothing, these fixed defaults are used and shown as such under Job. Only the board blank
// (margin, thickness) is adjustable here, and that is cosmetic.
const CARVE_DEFAULTS = { vbit_angle: 60, depth: 3, pocket_depth: 6, engrave_depth: 1 };
const settings = { ...CARVE_DEFAULTS, width_mm: DEFAULT_WIDTH_MM, margin: 18, thickness: 22 };
const carveSrc = {};   // key -> 'file' | 'default'
const TEX_MAX = 2048, SS = 2;
const app = { doc: null, job: null, traced: null, seq: 0, settings, carveSrc };
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
  const paint = () => { const p = (inp.value - inp.min) / (inp.max - inp.min) * 100; inp.style.setProperty('--p', p + '%'); out.textContent = el.dataset.pct ? Math.round(inp.value * 100) + '%' : fmt(inp.value, el.dataset.step) + (u ? (u === '°' ? u : ' ' + u) : ''); };
  paint();
  inp.addEventListener('input', () => {
    paint();
    const v = parseFloat(inp.value);
    if (el.dataset.scope === 'view') {
      viewer.interact();                 // draft frames while dragging, full quality when it stops
      if (k === 'fillLevel' || k === 'menisc') { const o = { [k]: v }; if (viewer.state.sanded) { o.sanded = false; $('#sanded').checked = false; } viewer.setMaterial(o); }
      else viewer.setLighting({ [k]: v });   // az, bright
    }
    el.dispatchEvent(new CustomEvent('slide', { detail: v }));
  });
  // the board blank rebuilds on release (cosmetic: no re-bake)
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (el.dataset.scope === 'board') { settings[k] = v; viewer.setBoard({ [k]: v }); }
  });
  el.set = (v) => { inp.value = v; paint(); };
  el.get = () => parseFloat(inp.value);
}
const slider = (k) => $(`.slider[data-k="${k}"]`);

function seg(sel, cb) {
  $$(sel + ' button').forEach((b) => b.onclick = () => { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
function segSet(sel, v) { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); }

// ---------------------------------------------------------------- material UI
const woodSwatch = (s) => `linear-gradient(90deg, ${s.early} 0 18%, ${s.late} 22% 26%, ${s.early} 30% 52%, ${s.late} 56% 61%, ${s.early} 66% 84%, ${s.late} 88% 92%, ${s.early} 96%)`;
// Compact picker: a tone switch (Pale · Mid · Dark & red) shows one group of swatches at a time, so the card stays short
function woodChips(sel, key) {
  const groups = [...new Set(Object.values(SPECIES).map((s) => s.group))];
  const sw = document.createElement('div'); sw.className = 'seg small wgrp'; sw.id = sel.slice(1) + 'Grp';
  sw.innerHTML = groups.map((g) => `<button data-g="${g}">${g}</button>`).join('');
  $(sel).before(sw);
  $(sel).innerHTML = Object.entries(SPECIES).map(([k, s]) => `<button data-v="${k}" data-g="${s.group}" title="${s.name}"><span class="sw" style="background:${woodSwatch(s)}"></span>${s.name.replace(/^Black walnut$/, 'Walnut')}</button>`).join('');
  $$(sel + ' button').forEach((b) => b.onclick = () => { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x === b)); viewer.setMaterial({ [key]: b.dataset.v }); inlayCheck(); });
  sw.querySelectorAll('button').forEach((b) => b.onclick = () => showGroup(sel, b.dataset.g));
  woodSet(sel, viewer.state[key]);
}
function showGroup(sel, g) {
  $$(`#${sel.slice(1)}Grp button`).forEach((b) => b.classList.toggle('on', b.dataset.g === g));
  $$(sel + ' button').forEach((b) => b.classList.toggle('hidden', b.dataset.g !== g));
}
function woodSet(sel, v) { segSet(sel, v); const s = SPECIES[v]; if (s) showGroup(sel, s.group); }
// an inlay of the board's own wood hides the carve: warn, and when Inlay is first picked, start from a contrasting wood
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
function contrastWood(k) { const L = lum(SPECIES[k].early); return Object.keys(SPECIES).filter((x) => x !== 'mdf').sort((a, b) => Math.abs(lum(SPECIES[b].early) - L) - Math.abs(lum(SPECIES[a].early) - L))[0]; }
function inlayCheck() { const S = viewer.state; $('#inlaySame').classList.toggle('hidden', !(S.fill === 'inlay' && S.insert === S.species)); }
woodChips('#species', 'species'); woodChips('#inserts', 'insert');
$('#finish').innerHTML = Object.entries(FINISHES).map(([k, f]) => `<button data-v="${k}">${f.name}</button>`).join('');
seg('#finish', (v) => viewer.setMaterial({ finish: v })); segSet('#finish', viewer.state.finish);
{
  let html = '', grp = '';
  for (const [k, f] of Object.entries(FILLS)) {
    if (f.group !== grp) { grp = f.group; html += `<div class="grp">${grp}</div>`; }
    const bg = f.type === 1 ? `linear-gradient(135deg, ${f.f0}, #fff8 45%, ${f.f0} 60%, #0006)` : f.type === 2 ? `linear-gradient(135deg, ${f.color}cc, ${f.scatter})` : f.color;
    html += `<button data-v="${k}"><span class="sw" style="background:${bg}"></span>${f.name}</button>`;
  }
  $('#resins').innerHTML = html;
  $$('#resins button').forEach((b) => b.onclick = () => { $$('#resins button').forEach((x) => x.classList.toggle('on', x === b)); viewer.setMaterial({ fillPreset: b.dataset.v }); customUI(); });
  segSet('#resins', viewer.state.fillPreset);
}
// your own colour: the picker or the type switch selects the custom resin; the presets above stay as suggestions
const resinSw = (f) => f.type === 1 ? `linear-gradient(135deg, ${f.f0}, #fff8 45%, ${f.f0} 60%, #0006)` : f.type === 2 ? `linear-gradient(135deg, ${f.color}cc, ${f.scatter})` : f.color;
function customUI() {
  const S = viewer.state; $('#customColor').value = S.customColor; segSet('#customType', String(S.customType));
  $('#customSw').style.background = resinSw(customFill(S.customColor, +S.customType));
  $('#custom').classList.toggle('on', S.fillPreset === 'custom');
}
function useCustom(o) { viewer.interact(); viewer.setMaterial({ ...o, fillPreset: 'custom' }); segSet('#resins', 'custom'); customUI(); }
$('#customColor').addEventListener('input', (e) => useCustom({ customColor: e.target.value }));
seg('#customType', (v) => useCustom({ customType: +v }));
customUI();
function fillUI(v) {
  $('#fillEpoxy').classList.toggle('hidden', v !== 'epoxy');
  $('#fillInlay').classList.toggle('hidden', v !== 'inlay');
  $('#sandRow').classList.toggle('hidden', v === 'none');
  pourUI(); inlayCheck();
}
// as-poured controls only mean something before the face is sanded, so they appear when Sanded flush is off
function pourUI() { $('#pourCtl').classList.toggle('hidden', !(viewer.state.fill === 'epoxy' && !viewer.state.sanded)); }
seg('#fill', (v) => {
  const o = { fill: v };
  if (v === 'inlay' && viewer.state.insert === viewer.state.species) o.insert = contrastWood(viewer.state.species);
  viewer.setMaterial(o); woodSet('#inserts', viewer.state.insert); fillUI(v);
});
$('#sanded').onchange = (e) => { viewer.setMaterial({ sanded: e.target.checked }); pourUI(); };
$('#flood').onchange = (e) => { const o = { flood: e.target.checked }; if (viewer.state.sanded) { o.sanded = false; $('#sanded').checked = false; } viewer.setMaterial(o); };
// light: a preset sets the whole rig (height, strength, warmth, fill, ambient); the panel adds direction and brightness
$('#lightPreset').innerHTML = Object.entries(LIGHTS).map(([k, l]) => `<button data-v="${k}">${l.name}</button>`).join('');
seg('#lightPreset', (v) => { viewer.setLighting({ light: v }); syncLightSliders(); }); segSet('#lightPreset', viewer.state.light);
function syncLightSliders() { for (const k of ['az', 'bright']) slider(k).set(viewer.state[k] ?? 1); segSet('#lightPreset', viewer.state.light); }
$('#shadows').onchange = (e) => viewer.setLighting({ shadows: e.target.checked });
$('#sway').onclick = () => { const on = !viewer.state.sway; viewer.setSway(on); $('#sway').classList.toggle('on', on); };
seg('#backdrop', (v) => viewer.setLighting({ backdrop: v }));
seg('#meshRes', (v) => viewer.setMeshRes(+v));
$$('#views button[data-view]').forEach((b) => b.onclick = () => viewer.setView(b.dataset.view));
// the current preset is lit until the user orbits away
viewer.onView = (name) => $$('#views button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
// F / Home: fit the whole board again
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]'))) return;
  if ((e.key === 'f' || e.key === 'F' || e.key === 'Home') && viewer.depth && !$('#vp3d').classList.contains('hidden')) { e.preventDefault(); viewer.setView('fit'); }
});
// one-time gesture hint: shown until the first orbit / zoom / pan, then never again
const GKEY = 'carveSim.gestureHintSeen';
const seenHint = () => { try { return localStorage.getItem(GKEY) === '1'; } catch { return false; } };
function hideHint() { $('#gesture').classList.add('hidden'); try { localStorage.setItem(GKEY, '1'); } catch {} }
viewer.onGesture = () => { if (!$('#gesture').classList.contains('hidden')) hideHint(); else if (!seenHint() && app.job) hideHint(); };
$('#gestureX').onclick = hideHint;
// cards fold like Relief Forge's: click the heading
$$('.card > h3').forEach((h) => h.onclick = () => h.parentElement.classList.toggle('folded'));

// tabs
$$('.tabs>button').forEach((b) => b.onclick = () => {
  $$('.tabs>button').forEach((x) => x.classList.toggle('on', x === b));
  $('#vp3d').classList.toggle('hidden', b.dataset.tab !== '3d'); $('#vp2d').classList.toggle('hidden', b.dataset.tab !== '2d');
  $('#views').style.visibility = b.dataset.tab === '3d' ? 'visible' : 'hidden';
  viewer.resize();
});

// ---------------------------------------------------------------- look A / B
// two complete looks (wood, finish, fill, light) to flip between; edits always go to the active letter
const LOOK_M = ['species', 'finish', 'fill', 'fillPreset', 'customColor', 'customType', 'insert', 'sanded', 'fillLevel', 'flood', 'menisc'];
const LOOK_L = ['az', 'el', 'key', 'warm', 'fillLight', 'env', 'exposure', 'ao', 'bright', 'shadows', 'backdrop'];
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
  if (looks[v]) applyLook(looks[v]);
  else { looks[v] = grabLook(); toast(`${v} starts as a copy of ${v === 'B' ? 'A' : 'B'}. Change the wood, fill or light, then flip back to compare.`, 5000); }
});

// ---------------------------------------------------------------- SVG import
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
$('#openTrace').onclick = (e) => { e.preventDefault(); e.stopPropagation(); openTrace().then(() => $('#traceBox').scrollIntoView({ behavior: 'smooth', block: 'start' })); };
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
  catch (e) { console.warn(e); showError('Could not open that file', (e.message || 'It is not a readable SVG.') + ' The board you had is still loaded.'); return; }
  doc.t0 = t0; doc.parse_ms = Math.round(performance.now() - t0); doc.from = from;
  if (!doc.layers.some((l) => l.kind !== 'profile' && l.items.length) && !doc.generic) {
    if (doc.hasProfile) showError('Outline only: nothing to carve', OUTLINE_ONLY); else showError('No carvable shapes in that SVG', NO_SHAPES);
    return;
  }
  doc.prev = { doc: app.doc, job: app.job, file: $('#fileName').textContent, settings: { ...settings }, src: { ...carveSrc } };
  app.doc = doc; app.job = null;
  // everything about the carve comes from the file, else a fixed default (never a value left over from the last file)
  const M = doc.meta, take = (k, v) => { settings[k] = v != null ? v : CARVE_DEFAULTS[k]; carveSrc[k] = v != null ? 'file' : 'default'; };
  settings.width_mm = Math.round((doc.width_mm || DEFAULT_WIDTH_MM) * 10) / 10; carveSrc.width_mm = doc.width_mm ? 'file' : 'default';
  take('vbit_angle', M.vbit_angle);
  const dm = M.depth_mm;   // the skill's depth= is the cut depth of the file's mode
  take('depth', ['pocket', 'engrave'].includes(doc.mode) ? null : dm);
  take('pocket_depth', M.pocket_depth_mm ?? (doc.mode === 'pocket' ? dm : null));
  take('engrave_depth', M.engrave_depth_mm ?? (doc.mode === 'engrave' ? dm : null));
  settings.margin = doc.hasProfile ? 0 : (settings.margin || 18);
  slider('margin').set(settings.margin);
  viewer.state.margin = settings.margin; viewer.state.thickness = settings.thickness;   // applied by setDepth, no extra rebuild
  $('#fileName').textContent = `${name}  ·  ${settings.width_mm} × ${Math.round(settings.width_mm * doc.vb[3] / doc.vb[2] * 10) / 10} mm`;
  $('#empty3d').classList.add('hidden');
  if (doc.generic) {
    busy(true, 'Drawing the SVG…');
    try { doc.raster = await rasterFor(doc, TEX_MAX, SS); } catch (e) { console.warn(e); busy(false); restorePrev(doc); showError('The browser could not draw that SVG', 'It may be damaged or use features the browser cannot render. The board you had is still loaded.'); return; }
    doc.raster_ms = Math.round(performance.now() - t0) - doc.parse_ms;
  }
  return requestBake();
}
const NO_SHAPES = 'Nothing in it would be cut: paths need a fill or a stroke. The board you had is still loaded.';
const OUTLINE_ONLY = 'This is a profile (cut-out) file: it holds the line the board is cut free on, but nothing carved inside it, so there is no carving to show. Trace the art as a V-carve or pocket to preview it. The board you had is still loaded.';
// a failed or empty import puts the last good board back (file name, carve settings, Job) instead of a blank one
function restorePrev(doc) {
  const P = doc.prev; if (!P || app.doc !== doc) return;
  app.doc = P.doc; app.job = P.job; Object.assign(settings, P.settings); Object.assign(carveSrc, P.src);
  slider('margin').set(settings.margin); viewer.state.margin = settings.margin;
  $('#fileName').textContent = P.file;
  if (!P.doc) $('#empty3d').classList.remove('hidden');
  $('#thumb').src = app.previewUrl || ''; $('#img2d').src = app.previewUrl || ''; drop.classList.toggle('has', !!app.previewUrl);
}
function showError(title, text) {
  setStatus('err', title);
  $('#smTitle').textContent = title; $('#smText').textContent = text; $('#smHelpText').classList.add('hidden');
  $('#stageMsg').classList.remove('hidden');
}
function hideError() { $('#stageMsg').classList.add('hidden'); }
$('#smClose').onclick = hideError;
$('#smHelp').onclick = (e) => { e.preventDefault(); $('#smHelpText').classList.toggle('hidden'); };
$('#smSample').onclick = (e) => { e.preventDefault(); hideError(); const b = $('#samples button'); if (b) b.click(); };
let toastT = 0, toastUrl = null;
function toast(html, ms = 3500, url = null) {
  const t = $('#toast'); t.innerHTML = html; t.classList.remove('hidden'); clearTimeout(toastT);
  if (toastUrl) URL.revokeObjectURL(toastUrl); toastUrl = url;
  toastT = setTimeout(() => { t.classList.add('hidden'); if (toastUrl) { URL.revokeObjectURL(toastUrl); toastUrl = null; } }, ms);
}
function effKinds() {   // generic art is cut as the file's mode (V-carve unless it says pocket)
  const d = app.doc; if (!d) return [];
  return [...new Set(d.kinds.map((k) => k === 'region' ? (d.mode === 'pocket' ? 'pocket' : 'vcarve') : k))];
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
    if (!(r.stats.cut_pct > 0) || !(r.stats.max_depth_mm > 0)) {   // baked, but nothing is cut: say so, keep the old board
      restorePrev(doc); showError('No carvable shapes in that SVG', NO_SHAPES); return;
    }
    const tw0 = performance.now();
    const prevW = viewer.depth && viewer.depth.artW;
    viewer.setDepth(new Uint16Array(r.depthTex), r.tw, r.th, r.W, r.H, r.md, new Uint8Array(r.ao),
      r.steps ? { ...r.steps, data: new Uint16Array(r.steps.data) } : null, r.fk);
    if (prevW && Math.abs(prevW - r.W) > 0.01 * r.W) viewer.setView('angle');   // new size: frame the whole board again
    const job = { name: doc.name, stats: r.stats, bake_ms: Math.round(tw0 - tb), worker_ms: r.stats.timing_ms, parse_ms: doc.parse_ms, raster_ms: doc.raster_ms || 0,
      settings: { ...settings }, kinds: effKinds(), layers: doc.layers.map((l) => ({ name: l.name, kind: l.kind, shapes: l.items.length })) };
    app.job = job;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    job.first_frame_ms = Math.round(performance.now() - (doc.firstDone ? tb : doc.t0)); job.from_import = !doc.firstDone; doc.firstDone = true;
    showStats(job, doc);
    $('#btnPng').disabled = false; hideError();
    if (!seenHint() && $('#gesture').classList.contains('hidden')) $('#gesture').classList.remove('hidden');
    setStatus('ok', `Baked · ${job.first_frame_ms} ms`);
  } catch (e) { console.error(e); if (my === app.seq) { restorePrev(doc); showError('That SVG could not be baked', String(e.message).slice(0, 120)); } }
  finally {
    baking = false;
    if (again) bake();
    else { busy(false); idle.splice(0).forEach((f) => f(app.job)); }
  }
}
// the worker sends the preview after a good bake; a failed or empty import has already put the old doc back, so it is skipped
function showPreview(blob, doc) {
  if (doc !== app.doc) return;
  if (app.previewUrl) URL.revokeObjectURL(app.previewUrl);
  app.previewUrl = URL.createObjectURL(blob);
  $('#img2d').src = app.previewUrl; $('#thumb').src = app.previewUrl; drop.classList.add('has');
}
// the header pill's busy state is 'is-busy' (plain 'busy' is the stage overlay's class)
function setStatus(cls, text) { const s = $('#status'); s.className = 'status ' + (cls === 'busy' ? 'is-busy' : cls); s.querySelector('span').textContent = text; }
function busy(on, text) { $('#busy').classList.toggle('hidden', !on); if (text) $('#busyText').textContent = text; }
function progress(p) { const bar = $('#cvBar'); bar.classList.toggle('hidden', p == null); if (p != null) bar.firstElementChild.style.width = Math.round(p * 100) + '%'; }

const KIND = { vcarve: 'V-carve', pocket: 'pocket', level: 'pocket level', engrave: 'engrave', profile: 'profile / cut-out', region: 'filled art' };
function showStats(job, doc) {
  const s = job.stats, cell = (k, v, u = '', wide = false) => `<div class="stat${wide ? ' wide' : ''}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`;
  const lay = doc.generic ? `drawn by the browser · cut as ${KIND[job.kinds[0]] || job.kinds[0]}` : doc.layers.map((l) => `${l.name} <small>(${KIND[l.kind] || l.kind}, ${l.items.length})</small>`).join('<br>');
  const notes = [], K = job.kinds, st = job.settings, src = (k) => carveSrc[k] === 'file' ? '<small>(from file)</small>' : '<small class="dflt">(default, not in file)</small>';
  const carve = [];
  carve.push(`${s.size_mm[0]} × ${s.size_mm[1]} mm ${carveSrc.width_mm === 'file' ? `<small>(from file: ${doc.sizeFrom})</small>` : `<small class="dflt">(default ${DEFAULT_WIDTH_MM} mm wide: no physical units in the file)</small>`}`);
  if (K.includes('vcarve') || K.includes('engrave')) carve.push(`${st.vbit_angle}° V-bit ${src('vbit_angle')}`);
  if (K.includes('vcarve')) carve.push(`V-carve max depth ${st.depth} mm ${src('depth')}`);
  if (K.includes('pocket') || K.includes('level')) carve.push(`Pocket depth ${st.pocket_depth} mm ${src('pocket_depth')}${K.includes('level') ? `, ${doc.layers.filter((l) => l.kind === 'level').length} levels` : ''}`);
  if (K.includes('engrave')) carve.push(`Engrave depth ${st.engrave_depth} mm ${src('engrave_depth')}`);
  if (doc.hasProfile) notes.push('profile_border layer: the board is cut out on that line, so the margin starts at 0.');
  if (doc.meta.comment) notes.push(`Skill metadata: ${doc.meta.comment.replace(/^CNC vector \|\s*/i, '')}`);
  $('#stats').innerHTML = [
    cell('Finished size', `${s.size_mm[0]} × ${s.size_mm[1]}`, 'mm', true),
    cell('Deepest cut', s.max_depth_mm, 'mm'), cell('Cut area', s.cut_pct, '%'),
    cell('Shapes', doc.nShapes), cell(job.from_import ? 'Import → 3D' : 'Re-bake', job.first_frame_ms, 'ms'),
    `<div class="stat wide"><div class="k">Carve, as read from the SVG</div><div class="v ro" style="font-size:12.5px;line-height:1.55">${carve.join('<br>')}</div></div>`,
    `<div class="stat wide"><div class="k">Layers</div><div class="v" style="font-size:12.5px;line-height:1.5">${lay}</div></div>`,
    `<div class="note">${notes.join('<br>')}</div>`,
  ].join('');
  $('#warns').innerHTML = '';
}

// the material look the app starts with (before any sample or user change), restored when a sample is picked
const START_LOOK = Object.fromEntries(LOOK_M.map((k) => [k, viewer.state[k]]));
// samples: the first load shows the bundled sample so the board is never empty (?nosample skips it, for tests)
fetch('samples/index.json').then((r) => r.json()).then((list) => {
  $('#samples').innerHTML = list.map((s) => `<button data-p="${s.path}" title="${s.path}">${s.label}</button>`).join('');
  // a sample may carry a "look" (board, fill, sanded...) it was designed for, e.g. an inverted design meant for a pale
  // fill in a dark board. Picking a sample starts from the app's startup look plus its own, so nothing carries over.
  const loadSample = (s) => app.loadPath(s.path).then(() => app.set({ material: { ...START_LOOK, ...s.look } }));
  $$('#samples button').forEach((b, i) => b.onclick = () => loadSample(list[i]));
  const d = list.find((s) => s.default) || list[0];
  if (d && !qs.has('nosample') && !app.doc) loadSample(d);
}).catch(() => {});
// load a file shipped with the app (relative URL): SVGs import, images go through the tracer
app.loadPath = async (path) => {
  const r = await fetch(path);
  if (!r.ok) { showError('Could not load ' + path.split('/').pop(), 'The file was not found (HTTP ' + r.status + ').'); return; }
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
  return tracePanel ??= import('./trace-panel.js').then((m) => m.initTrace({ $, $$, seg, slider, setStatus, dl,
    onSvg: (svg, name) => loadSvgText(svg, name, 'trace') }));
}
$('#traceBox').addEventListener('toggle', () => { if ($('#traceBox').open) openTrace(); });
app.openTrace = openTrace;

// ---------------------------------------------------------------- export
const base = () => (app.doc?.name || 'art').replace(/\.[^.]+$/, '');
// Desktop app: webviews don't all honour <a download>, so the file goes to the Rust side, which shows a native Save dialog.
async function nativeSave(url, name) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return window.__TAURI_INTERNALS__.invoke('save_file', bytes, { headers: { 'x-file-name': encodeURIComponent(name) } });
}
function dl(url, name) {
  if (window.__TAURI_INTERNALS__) {
    return nativeSave(url, name).then((saved) => { if (saved) setStatus('ok', 'Saved ' + name); return saved ?? null; },
      (e) => { console.error(e); showError('Save failed', String(e?.message || e).slice(0, 120)); return false; });
  }
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
app.dl = dl;
$('#btnPng').onclick = async () => {
  const b = $('#btnPng'), sc = +$('#pngScale').value; b.disabled = true;
  const msg = `Rendering ${sc}× PNG…`; setStatus('busy', msg); busy(true, msg); progress(null);
  // let the busy state paint before the render takes the main thread
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  try {
    const blob = await viewer.exportPNG(sc);
    const S = viewer.state; const url = URL.createObjectURL(blob);
    const name = `${base()}_${S.species}_${S.fill}${S.fill === 'epoxy' ? '-' + S.fillPreset : ''}.png`;
    const saved = await dl(url, name);                 // desktop: path, null if the Save dialog was cancelled, false on error
    if (saved === false) return;
    if (saved === null) { setStatus('ok', 'Save cancelled'); return; }
    const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    toast(`<img src="${url}" alt=""><span>Saved <b>${esc(name)}</b></span>`, 5000, url);
    setStatus('ok', 'PNG saved');
  } catch (e) { console.error(e); showError('Render failed', String(e.message || e).slice(0, 120)); }
  finally { b.disabled = false; if (!baking) busy(false); }
};

// helpers for scripted renders (tests, batch beauty shots)
app.set = (o) => {
  if (o.material) { viewer.setMaterial(o.material); segSet('#fill', viewer.state.fill); fillUI(viewer.state.fill); woodSet('#species', viewer.state.species); woodSet('#inserts', viewer.state.insert); segSet('#finish', viewer.state.finish); segSet('#resins', viewer.state.fillPreset); customUI(); $('#sanded').checked = viewer.state.sanded; $('#flood').checked = !!viewer.state.flood; for (const k of ['fillLevel', 'menisc']) slider(k).set(viewer.state[k]); pourUI(); }
  if (o.light) { viewer.setLighting(o.light); syncLightSliders(); }
  if (o.view) viewer.setView(o.view, true);
  if (o.close) viewer.setCloseUp(o.close[0], o.close[1]);
};
// test hook only (perf probes): re-bake the current file with other carve values; there is no UI for this on purpose
app.setBake = (o) => { Object.assign(settings, o); for (const k in o) if (k in carveSrc) carveSrc[k] = 'test'; if ('margin' in o || 'thickness' in o) viewer.setBoard(o); return requestBake(); };
fillUI('none');

// offline: a small service worker caches the app shell (and the tracer once it has been used); ?nosw skips it
// The desktop app (Tauri) ships every file locally, so it skips the offline cache (Windows serves it from http://tauri.localhost).
const inTauri = !!window.__TAURI_INTERNALS__ || /(^|\.)tauri\.localhost$/.test(location.hostname) || location.protocol === 'tauri:';
if (inTauri) document.documentElement.classList.add('desktop');
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !qs.has('nosw') && !inTauri) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e)));
}
