// "Trace an image instead": a one-off bake from a black & white image to a CNC SVG, which then opens in the showroom
// like any imported SVG. Loaded on demand (dynamic import) the first time the panel opens; the engine, its worker and
// OpenCV (self-hosted in vendor/, ~12 MB) only start then. No live retrace: a few fixed choices and one Trace button.
import { Engine, revoke } from './engine.js';

// image-type presets -> the tracer's parameters (same meaning as the CNC skill's cnc_vector.py flags)
const PRESETS = {
  line:  { threshold: '128',  smooth: 0.8, min_feature: 0.5 },   // clean black & white line art (the skill's default)
  bold:  { threshold: 'auto', smooth: 1.6, min_feature: 1.0 },   // chunky stencil shapes, small specks dropped
  photo: { threshold: 'auto', smooth: 2.0, min_feature: 0.8 },   // shaded / photographic sources: Otsu split, more denoise
  fine:  { threshold: '128',  smooth: 0.4, min_feature: 0.3 },   // keep hairlines (needs a fine V-bit)
};

// The bit and depths are one-off trace inputs: used when Trace is pressed and written into the SVG with the skill's
// conventions (physical width/height, and depth= / vbit_angle= on the "CNC vector" metadata line), so the showroom and
// the downloaded file both carry them. The engine's own output is left byte-identical to the skill (parity tests).
export function withCarveMeta(svg, { mode, depth, vbit_angle }) {
  const extra = ` depth=${+depth.toFixed(2)}mm` + (mode === 'vcarve' ? ` vbit_angle=${+vbit_angle.toFixed(1)}` : '');
  const re = /(<!--\s*CNC vector\s*\|[^|>]*?)(\s*\|\s*units:)/;
  if (re.test(svg)) return svg.replace(re, (m, a, b) => a.replace(/\s+(depth|vbit_angle)=\S+/g, '') + extra + b);
  return svg.replace(/(<svg\b[^>]*>)/, `$1\n<!-- CNC vector | mode=${mode}${extra} | units: mm -->`);
}

export function initTrace({ $, $$, seg, slider, setStatus, onSvg, dl }) {
  const engine = new Engine();
  let img = null, mode = 'vcarve', last = null;
  const bar = $('#tBar'), note = (t) => ($('#tStatus').textContent = t);
  engine.onprogress = (loaded, total) => {
    const p = Math.min(100, Math.round(loaded / total * 100));
    bar.classList.toggle('hidden', p >= 100); bar.firstElementChild.style.width = p + '%';
    note(p < 100 ? `Loading the tracer… ${p}%` : (img ? 'Tracer ready.' : 'Tracer ready: pick an image.'));
  };
  note('Loading the tracer…');
  engine.warm().catch((e) => { console.error(e); note('Could not load the tracer: ' + e.message); });

  const drop = $('#tDrop');
  const setImage = (blob, name) => {
    img = { blob, name };
    const t = $('#tThumb'); if (t.src) URL.revokeObjectURL(t.src); t.src = URL.createObjectURL(blob); drop.classList.add('has');
    $('#btnTrace').disabled = false; note(`${name} · press Trace`);
  };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) setImage(f, f.name); });
  $('#tFileIn').onchange = (e) => { const f = e.target.files[0]; if (f) setImage(f, f.name); e.target.value = ''; };
  $('#tSample').onclick = async (e) => { e.preventDefault(); e.stopPropagation(); const r = await fetch('samples/old-fisherman.jpg'); setImage(await r.blob(), 'old-fisherman.jpg'); };
  const modeUI = () => {
    for (const k of ['t_vbit', 't_depth']) slider(k).classList.toggle('hidden', mode !== 'vcarve');
    $('#tVbitChips').classList.toggle('hidden', mode !== 'vcarve');
    slider('t_pocket').classList.toggle('hidden', mode !== 'pocket');
  };
  seg('#tMode', (v) => { mode = v; modeUI(); }); modeUI();
  const chips = () => { const a = slider('t_vbit').get(); for (const b of $$('#tVbitChips button')) b.classList.toggle('on', +b.dataset.v === a); };
  $$('#tVbitChips button').forEach((b) => b.onclick = () => { slider('t_vbit').set(+b.dataset.v); chips(); });
  slider('t_vbit').addEventListener('slide', chips);

  async function trace() {
    if (!img) return;
    const btn = $('#btnTrace'); btn.disabled = true; $('#btnSvg').disabled = true;
    const t0 = performance.now(); setStatus('busy', 'Tracing…'); note(engine.cvReady ? 'Tracing…' : 'Loading the tracer, then tracing…');
    let srcId = null;
    try {
      const preset = PRESETS[$('#tPreset').value] || PRESETS.line;
      const params = { ...preset, mode, invert: $('#tInvert').checked, width_mm: slider('t_width').get(),
        vbit_angle: slider('t_vbit').get(), depth: mode === 'pocket' ? slider('t_pocket').get() : slider('t_depth').get() };
      const info = await engine.load(img.blob, img.name); srcId = info.id;
      const out = await engine.process(info.id, params, true);
      URL.revokeObjectURL(info.thumbUrl);
      if (!out || !out.svg) throw new Error('the tracer returned no SVG');
      if (last) { revoke(last.urls); URL.revokeObjectURL(last.svgUrl); }
      const name = `${img.name.replace(/\.[^.]+$/, '')}_${mode}_${Math.round(params.width_mm)}mm.svg`;
      const svg = withCarveMeta(out.svg, params);
      last = { urls: out.urls, svg, name, params, svgUrl: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) };
      const s = out.res.stats;
      note(`Traced in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${s.paths} paths, ${s.nodes ?? '?'} nodes. Opened below as ${name}.`);
      $('#btnSvg').disabled = false;
      await onSvg(svg, name);
    } catch (e) { console.error(e); note('Trace failed: ' + e.message); setStatus('err', 'Trace failed'); }
    finally { btn.disabled = !img; if (srcId) engine.unload(srcId); }
  }
  $('#btnTrace').onclick = trace;
  $('#btnSvg').onclick = () => {
    if (!last) return;
    if (dl) { dl(last.svgUrl, last.name); return; }
    const a = document.createElement('a'); a.href = last.svgUrl; a.download = last.name; document.body.appendChild(a); a.click(); a.remove();
  };
  return { setImage, trace, engine, get last() { return last; } };
}
