import { Viewer } from './viewer.js';
import { SPECIES, FINISHES, FILLS, LIGHTS } from './materials.js';
import { Engine, revoke } from './engine.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const params = { mode: 'vcarve', threshold: 128, smooth: 0.8, min_feature: 0.5, width_mm: 300, invert: false, svg_retrace: false,
  vbit_angle: 60, depth: 3, tool_dia: 3.175, feed: 1200, plunge: 300, rapid: 3000, fragile_mm: 1.0 };
let thrMode = 'value';
const app = { src: null, result: null, seq: 0, traced: null };
window.app = app;

const engine = new Engine();
app.engine = engine;
const viewer = new Viewer($('#vp3d'));
app.viewer = viewer;

// ---------------------------------------------------------------- sliders
function fmt(v, step) { const d = String(step).includes('.') ? String(step).split('.')[1].length : 0; return Number(v).toFixed(Math.min(d, 3)); }
for (const el of $$('.slider')) {
  const k = el.dataset.k, u = el.dataset.u || '';
  el.innerHTML = `<div class="hd"><span>${el.dataset.label || 'Threshold'}</span><output></output></div><input type="range" min="${el.dataset.min}" max="${el.dataset.max}" step="${el.dataset.step}" value="${el.dataset.v}">`;
  const inp = el.querySelector('input'), out = el.querySelector('output');
  const paint = () => { const p = (inp.value - inp.min) / (inp.max - inp.min) * 100; inp.style.setProperty('--p', p + '%'); out.textContent = fmt(inp.value, el.dataset.step) + (u ? ' ' + u : ''); };
  paint();
  inp.addEventListener('input', () => {
    paint();
    const v = parseFloat(inp.value);
    if (el.dataset.scope === 'view') {
      viewer.interact();                 // draft frames while dragging, full quality when it stops
      if (k === 'glow') viewer.setMaterial({ glow: v });
      else if (k === 'charScale') { viewer.uniforms.uCharScale.value = v; viewer.dirty = true; }
      else viewer.setLighting({ [k]: v });
    } else { params[k] = v; if (k === 'vbit_angle') syncChips(); schedule(); }
  });
  el.set = (v) => { inp.value = v; paint(); };
}
const slider = (k) => $(`.slider[data-k="${k}"]`);
function syncChips() { for (const b of $$('#vbitChips button')) b.classList.toggle('on', +b.dataset.v === params.vbit_angle); }
$$('#vbitChips button').forEach((b) => b.onclick = () => { params.vbit_angle = +b.dataset.v; slider('vbit_angle').set(params.vbit_angle); syncChips(); schedule(); });

function seg(sel, cb) {
  $$(sel + ' button').forEach((b) => b.onclick = () => { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
function segSet(sel, v) { $$(sel + ' button').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); }
seg('#mode', (v) => { params.mode = v; $('.slider[data-k="vbit_angle"]').style.opacity = v === 'vcarve' ? 1 : .4; schedule(); });
$('#thrMode').onchange = (e) => { thrMode = e.target.value; slider('threshold').style.opacity = thrMode === 'value' ? 1 : .4; schedule(); };
for (const id of ['invert', 'svg_retrace']) $('#' + id).onchange = (e) => { params[id] = e.target.checked; schedule(); };
for (const id of ['feed', 'plunge', 'rapid']) $('#' + id).onchange = (e) => { params[id] = parseFloat(e.target.value) || params[id]; schedule(); };
$('#autoTrace').onchange = () => schedule();
$('#btnTrace').onclick = () => run(true);

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
$('#lightPreset').innerHTML = Object.entries(LIGHTS).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('');
$('#lightPreset').onchange = (e) => { viewer.setLighting({ light: e.target.value }); for (const k of ['az', 'el', 'key', 'env']) slider(k).set(viewer.state[k]); };
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
let layer2d = 'trace';
seg('#layer2d', (v) => { layer2d = v; show2d(); });
$('#showFlags').onchange = show2d;

// ---------------------------------------------------------------- load
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
$('#fileIn').onchange = (e) => e.target.files[0] && loadFile(e.target.files[0]);

async function loadFile(f, name = f.name) {
  setStatus('busy', 'Loading…');
  if (!engine.cvReady) { busy(true, 'Loading the tracer…'); warm(); }
  try { onLoaded(await engine.load(f, name)); }
  catch (e) { console.error(e); setStatus('err', 'Could not read that file'); }
}
// load a file shipped with the app (relative URL, e.g. samples/old-fisherman.jpg)
app.loadPath = async (path) => {
  const r = await fetch(path);
  if (!r.ok) { setStatus('err', 'Could not fetch ' + path); return; }
  await loadFile(await r.blob(), path.split('/').pop());
  return app.ready();
};
function onLoaded(info) {
  if (app.src?.thumbUrl) URL.revokeObjectURL(app.src.thumbUrl);
  app.src = info; app.result = null; app.traced = null;
  $('#fileName').textContent = `${info.name}  ·  ${info.kind === 'svg' ? 'SVG' : `${info.w}×${info.h}px`}`;
  $('#thumb').src = info.thumbUrl; drop.classList.add('has');
  $('.svgonly').classList.toggle('hidden', info.kind !== 'svg');
  if (info.kind === 'svg' && info.svg_width_mm) { params.width_mm = Math.round(info.svg_width_mm); slider('width_mm').set(params.width_mm); }
  $('#btnTrace').disabled = false;
  $('#empty3d').classList.add('hidden');
  run(false).then(() => { if ($('#autoTrace').checked) run(true); });
}
fetch('samples/index.json').then((r) => r.json()).then((list) => {
  $('#samples').innerHTML = list.map((s) => `<button data-p="${s.path}" title="${s.path}">${s.label}</button>`).join('');
  $$('#samples button').forEach((b) => b.onclick = () => app.loadPath(b.dataset.p));
}).catch(() => {});

// ---------------------------------------------------------------- process
let tQuick = null, tFull = null;
function schedule() {
  if (!app.src) return;
  clearTimeout(tQuick); clearTimeout(tFull);
  tQuick = setTimeout(() => run(false), 220);
  if ($('#autoTrace').checked) tFull = setTimeout(() => run(true), 1100);
}
function reqParams() {
  const p = { ...params }; p.threshold = thrMode === 'value' ? String(Math.round(params.threshold)) : thrMode;
  return p;
}
let pending = 0, idleResolvers = [];
app.ready = () => new Promise((res) => { if (!pending) res(app.result); else idleResolvers.push(res); });
async function run(trace) {
  if (!app.src) return;
  const my = ++app.seq; pending++;
  setStatus('busy', trace ? 'Tracing to SVG…' : 'Applying bit rules…'); busy(true, trace ? 'Tracing to SVG…' : 'Updating carve…');
  try {
    const out = await engine.process(app.src.id, reqParams(), trace);
    if (!out) return;                      // replaced in the queue by a newer request
    const res = out.res; res.urls = out.urls; res.svg = out.svg;
    if (my !== app.seq) { if (!trace) revoke(out.urls); else keepTraced(res); return; }   // a newer request superseded this one
    if (app.result && app.result !== app.traced && app.result !== res) revoke(app.result.urls);
    app.result = res; if (trace) keepTraced(res);
    // the worker already packed the GPU texture; the viewer just uploads it (no mesh rebuild)
    viewer.setDepth(new Uint16Array(out.depthRG), res.tex.w, res.tex.h, res.size_mm[0], res.size_mm[1], res.tex.max_depth);
    showStats(res); show2d();
    for (const id of ['#btnSvg', '#btnStats']) $(id).disabled = !trace;
    $('#btnPng').disabled = false;
    setStatus('ok', trace ? `Traced · ${res.stats.paths} paths` : 'Preview (tracing…)');
  } catch (e) { console.error(e); if (my === app.seq) setStatus('err', 'Error: ' + String(e.message).slice(0, 80)); }
  finally {
    pending--; if (!pending) { busy(false); idleResolvers.splice(0).forEach((f) => f(app.result)); }
  }
}
function keepTraced(res) { if (app.traced && app.traced !== res && app.traced !== app.result) revoke(app.traced.urls); app.traced = res; }
function setStatus(cls, text) { const s = $('#status'); s.className = 'status ' + cls; s.querySelector('span').textContent = text; }
function busy(on, text) { $('#busy').classList.toggle('hidden', !on); if (text) $('#busyText').textContent = text; }

// OpenCV (the tracer, ~3.5 MB compressed) is not part of the page load: it starts streaming once the page is idle,
// or straight away when an image is picked, with a progress bar in the busy pill.
let cvPct = -1;
engine.onprogress = (loaded, total) => {
  const pct = Math.min(100, Math.round(loaded / total * 100)); if (pct === cvPct) return; cvPct = pct;
  const bar = $('#cvBar'); bar.classList.toggle('hidden', pct >= 100); bar.firstElementChild.style.width = pct + '%';
  if (pct < 100 && !$('#busy').classList.contains('hidden')) $('#busyText').textContent = `Loading the tracer… ${pct}%`;
};
const warm = () => engine.warm().catch((e) => { console.error(e); setStatus('err', 'Could not load the tracer'); });
(window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(warm, { timeout: 2500 });

function showStats(res) {
  const s = res.stats, e = s.estimate, f = res.flags, ap = res.traced ? '' : '≈';
  const cell = (k, v, u = '', wide = false) => `<div class="stat${wide ? ' wide' : ''}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`;
  $('#stats').innerHTML = [
    cell('Finished size', `${s.size_mm[0]} × ${s.size_mm[1]}`, 'mm', true),
    cell('Carve time', `${ap}${e.time_min}`, `min (${e.time_range_min[0]}–${e.time_range_min[1]})`, true),
    cell('Paths', ap + s.paths), cell('Nodes', s.nodes ?? '—'),
    cell('Cut length', e.cut_length_m, 'm'), cell('Plunges', e.plunges),
    cell('Rapids', `${ap}${(s.rapid_travel_mm_est / 1000).toFixed(2)}`, 'm'), cell('Cut area', f.cut_area_pct, '%'),
  ].join('') + (res.traced ? '' : '<div class="approx muted">≈ preview from the mask; tracing for exact numbers</div>');
  $('#warns').innerHTML = res.warnings.map((w) => `<div class="warn ${w.level}">${w.text}</div>`).join('');
}
function show2d() {
  const r = app.result; if (!r) return;
  const tr = app.traced && app.traced.key === r.key ? r : null;
  let src;
  if (layer2d === 'source') src = app.src.thumbUrl;
  else if (layer2d === 'mask' || !tr) src = r.urls.mask;
  else src = r.urls.preview;
  $('#img2d').src = src;
  const o = $('#ovl2d'); o.src = r.urls.overlay; o.classList.toggle('hidden', !$('#showFlags').checked || layer2d === 'source');
  const fit = () => { const i = $('#img2d'); o.style.width = i.clientWidth + 'px'; o.style.height = i.clientHeight + 'px'; o.style.left = i.offsetLeft + 'px'; o.style.top = i.offsetTop + 'px'; };
  $('#img2d').onload = fit; new ResizeObserver(fit).observe($('#imgwrap'));
}

// ---------------------------------------------------------------- exports
const base = () => (app.src?.name || 'art').replace(/\.[^.]+$/, '');
const tag = () => `${params.mode}_${Math.round(params.width_mm)}mm`;
function dl(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
$('#btnSvg').onclick = () => app.traced?.urls.svg && dl(app.traced.urls.svg, `${base()}_${tag()}.svg`);
$('#btnStats').onclick = () => app.traced && dl(app.traced.urls.stats, `${base()}_${tag()}_stats.json`);
$('#btnPng').onclick = async () => {
  const blob = await viewer.exportPNG(+$('#pngScale').value);
  const S = viewer.state; const url = URL.createObjectURL(blob);
  dl(url, `${base()}_${S.species}_${S.fill}${S.fill === 'epoxy' ? '-' + S.fillPreset : ''}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

// helpers for scripted renders (tests, batch beauty shots)
app.set = (o) => {
  if (o.material) { viewer.setMaterial(o.material); segSet('#fill', viewer.state.fill); fillUI(viewer.state.fill); segSet('#species', viewer.state.species); segSet('#inserts', viewer.state.insert); segSet('#finish', viewer.state.finish); segSet('#resins', viewer.state.fillPreset); $('#sanded').checked = viewer.state.sanded; }
  if (o.light) { viewer.setLighting(o.light); for (const k of ['az', 'el', 'key', 'env', 'exposure']) slider(k).set(viewer.state[k]); if (o.light.light) $('#lightPreset').value = o.light.light; }
  if (o.view) viewer.setView(o.view);
  if (o.close) viewer.setCloseUp(o.close[0], o.close[1]);
};
app.params = params;
app.retrace = (o) => { Object.assign(params, o); return run(true).then(() => app.ready()); };
fillUI('none');
