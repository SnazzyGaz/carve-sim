/* Carve Sim engine, in a Web Worker: B/W art -> tool-safe mask -> potrace SVG + bit-rule flags + depth map.
 * A line-for-line port of the Python reference (server/engine.py + cnc_vector.py) so SVGs and stats line up.
 * OpenCV.js (same OpenCV 5.0 as the reference) does the image ops; potrace-core does the tracing.
 * Classic worker; all paths relative to this file so the app works from any folder or site root. */
importScripts('../vendor/potrace-core.min.js');

// OpenCV (12 MB of WebAssembly) loads on demand: the first image or a warm-up ping starts it.
// The wasm is compiled while it streams in; download progress goes to the page for its progress bar.
const CV_WASM_BYTES = 11958198;
let cv = null, cvLoading = null;
function loadCV() {
  if (cvLoading) return cvLoading;
  cvLoading = (async () => {
    const url = new URL('../vendor/opencv.wasm', self.location.href).href;
    const progress = (loaded) => self.postMessage({ type: 'cvprogress', loaded, total: CV_WASM_BYTES });
    self.CV_WASM_MODULE = (async () => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error('could not fetch opencv.wasm (' + res.status + ')');
      const [a, b] = res.body.tee();
      (async () => {
        const rd = b.getReader(); let n = 0, last = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; const t = performance.now(); if (t - last > 100) { last = t; progress(n); } }
        progress(CV_WASM_BYTES);
      })();
      try { return await WebAssembly.compileStreaming(new Response(a, { headers: { 'Content-Type': 'application/wasm' } })); }
      catch (e) { return WebAssembly.compile(await (await fetch(url)).arrayBuffer()); }
    })();
    importScripts('../vendor/opencv.js');
    let c = self.cv;
    if (c && typeof c.then === 'function') c = await c;
    else if (typeof c === 'function') c = await c();
    else if (c && !c.Mat) await new Promise((r) => { c.onRuntimeInitialized = r; });
    cv = c;
    self.postMessage({ type: 'cvready' });
  })();
  return cvLoading;
}

// ------------------------------------------------------------------ python-compatible helpers
function pyRound(x) {                       // round-half-even, like Python's round()
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1; if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
function pyFixed(v, n) {                    // f"{v:.nf}" (half-even on exact binary ties)
  const s = v.toFixed(n);
  const sc = Math.abs(v) * Math.pow(10, n), fr = sc - Math.floor(sc);
  if (Math.abs(fr - 0.5) > 1e-6) return s;
  const e = Math.abs(v).toFixed(Math.min(100, n + 30)), dot = e.indexOf('.');
  const tail = e.slice(dot + 1 + n);
  if (/^50*$/.test(tail)) {
    const digits = s.replace('-', '').replace('.', '');
    if (+digits[digits.length - 1] % 2 === 1) {
      const t = e.slice(0, dot + 1 + n);
      return (v < 0 ? '-' : '') + (n === 0 ? t.replace('.', '') : t);
    }
  }
  return s;
}
const r2 = (v, n) => Number(pyFixed(v, n));            // round(v, n)
const pyStr = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));   // str(float)
const pyG = (v) => String(Number(v.toPrecision(6)));                     // f"{v:g}" (common cases)

const DEFAULTS = { mode: 'vcarve', width_mm: 300.0, threshold: '128', smooth: 0.8, min_feature: 0.5, invert: false,
  vbit_angle: 60.0, depth: 3.0, tool_dia: 3.175, feed: 1200.0, plunge: 300.0, rapid: 3000.0, safe_z: 5.0, stepover: 0.4,
  alphamax: 1.1, opttol: 0.4, pass_depth: null, fragile_mm: 1.0, svg_retrace: false, tex_max: 2048 };
function makeArgs(p) {
  const a = { ...DEFAULTS };
  for (const k in p) if (p[k] !== null && p[k] !== undefined && k in DEFAULTS) a[k] = p[k];
  for (const k of ['width_mm', 'smooth', 'min_feature', 'vbit_angle', 'depth', 'tool_dia', 'feed', 'plunge', 'rapid',
    'safe_z', 'stepover', 'alphamax', 'opttol', 'fragile_mm']) a[k] = parseFloat(a[k]);
  a.tex_max = Math.trunc(+a.tex_max); a.threshold = String(a.threshold); a.invert = !!a.invert; a.svg_retrace = !!a.svg_retrace;
  a.pass_depth = a.pass_depth ? parseFloat(a.pass_depth) : null;
  return a;
}

// ------------------------------------------------------------------ mat helpers
const T = [];                                          // mats to free at the end of a step
const keep = (m) => (T.push(m), m);
function freeAll() { while (T.length) { const m = T.pop(); try { if (!m.isDeleted()) m.delete(); } catch (e) {} } }
function u8Mat(u8, w, h) { const m = keep(new cv.Mat(h, w, cv.CV_8UC1)); m.data.set(u8); return m; }
const matU8 = (m) => new Uint8Array(m.data);           // copy out
function disk(r) {
  const k = Math.max(1, pyRound(r));
  return keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * k + 1, 2 * k + 1)));
}
function morph(u8, w, h, op, kernel) {
  const src = u8Mat(u8, w, h), dst = keep(new cv.Mat());
  cv.morphologyEx(src, dst, op, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
  return matU8(dst);
}
function cc(u8, w, h) {
  const src = u8Mat(u8, w, h), lab = keep(new cv.Mat()), st = keep(new cv.Mat()), cen = keep(new cv.Mat());
  const n = cv.connectedComponentsWithStats(src, lab, st, cen, 8, cv.CV_32S);
  return { n, lab: new Int32Array(lab.data32S), st: new Int32Array(st.data32S) };   // st rows: x,y,w,h,area
}
function removeSmall(mask, w, h, minArea) {
  const out = mask.slice();
  for (const target of [1, 0]) {
    const m = new Uint8Array(out.length);
    for (let i = 0; i < m.length; i++) m[i] = out[i] === target ? 1 : 0;
    const { n, lab, st } = cc(m, w, h);
    if (n <= 1) continue;
    const small = new Uint8Array(n);
    for (let i = 1; i < n; i++) small[i] = st[i * 5 + 4] < minArea ? 1 : 0;
    for (let i = 0; i < out.length; i++) if (small[lab[i]]) out[i] = 1 - target;
  }
  return out;
}

// ------------------------------------------------------------------ sources
const sources = new Map();
async function loadSource(msg) {
  const { id, name, buffer } = msg;
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder().decode(bytes.subarray(0, 2000));
  const isSvg = name.toLowerCase().endsWith('.svg') || (/^\s*(<\?xml|<svg)/.test(head.slice(0, 200)) && head.includes('<svg'));
  const src = { id, name, kind: isSvg ? 'svg' : 'raster' };
  if (isSvg) {
    const txt = new TextDecoder().decode(bytes);
    src.svg_text = txt;
    const vb = txt.match(/viewBox="([^"]+)"/);
    let x = 0, y = 0, w, h;
    if (vb) [x, y, w, h] = vb[1].trim().split(/[ ,]+/).map(parseFloat);
    else { w = parseFloat(txt.match(/width="([\d.]+)/)[1]); h = parseFloat(txt.match(/height="([\d.]+)/)[1]); }
    src.svg_vb = [x, y, w, h]; src.w = w; src.h = h;
    const wm = txt.match(/<svg[^>]*width="([\d.]+)mm"/);
    src.svg_width_mm = wm ? parseFloat(wm[1]) : null;
    src.is_cnc = txt.includes('CNC vector') || txt.includes('fill="none"');
    src.ds = [...txt.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    const tr = txt.match(/<g[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)"/);
    src.translate = tr ? [parseFloat(tr[1]), parseFloat(tr[2])] : [0, 0];
    if (!src.is_cnc && msg.raster) src.raster = msg.raster;   // main thread pre-rendered a general SVG
  } else {
    const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    src.img = g.getImageData(0, 0, bmp.width, bmp.height);
    src.w = bmp.width; src.h = bmp.height; bmp.close();
    let alpha = false; const d = src.img.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
    src.hasAlpha = alpha;
  }
  sources.set(id, src);
  const info = { id, name, kind: src.kind, w: src.w, h: src.h, svg_width_mm: src.svg_width_mm || null, is_cnc: !!src.is_cnc };
  info.thumb = src.kind === 'svg' ? await toPngBlob(renderSvgFilled(src, ...thumbSize(src)), 'gray') : null;
  return info;
}
function thumbSize(src) { const s = 900 / Math.max(src.w, src.h); return [Math.trunc(src.w * s), Math.trunc(src.h * s)]; }

/* Rasterise SVG input with all shapes as solid even-odd cut regions (black on white) -> gray Uint8Array */
function renderSvgFilled(src, ow, oh) {
  const c = new OffscreenCanvas(ow, oh), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, ow, oh);
  if (src.is_cnc) {
    const [x, y, w, h] = src.svg_vb;
    g.setTransform(ow / w, 0, 0, oh / h, -x * ow / w, -y * oh / h);
    g.translate(src.translate[0], src.translate[1]);
    g.fillStyle = '#000'; g.fill(new Path2D(src.ds.join(' ')), 'evenodd');
  } else if (src.raster) {
    g.imageSmoothingQuality = 'high';
    g.drawImage(src.raster, 0, 0, ow, oh);
  }
  const d = g.getImageData(0, 0, ow, oh).data, out = new Uint8Array(ow * oh);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000 | 0;
  return { gray: out, w: ow, h: oh };
}

// ------------------------------------------------------------------ core (mirrors cnc_vector / engine)
function workingScale(a, h, w) {
  const aspect = w / h, W = a.width_mm, H = W / aspect;
  const ppm = Math.min(Math.max(6.0 / a.min_feature, 8.0), 3000.0 / Math.max(W, H));
  return [W, H, ppm];
}
function toneMask(gray, w, h, a) {
  let g = u8Mat(gray, w, h);
  if (a.smooth > 0) {
    const d = Math.trunc(a.smooth * 4) | 1, b = keep(new cv.Mat()), gb = keep(new cv.Mat());
    cv.bilateralFilter(g, b, d, 40 + a.smooth * 15, d, cv.BORDER_DEFAULT);
    cv.GaussianBlur(b, gb, new cv.Size(0, 0), a.smooth * 0.6, 0, cv.BORDER_DEFAULT);
    g = gb;
  }
  const m = keep(new cv.Mat());
  if (a.threshold === 'auto') cv.threshold(g, m, 0, 1, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  else if (a.threshold === 'adaptive') {
    const bs = Math.trunc(Math.max(w, h) / 12) | 1;
    cv.adaptiveThreshold(g, m, 1, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, bs, 6);
  } else cv.threshold(g, m, parseInt(a.threshold, 10), 1, cv.THRESH_BINARY_INV);
  const out = matU8(m);
  if (a.invert) for (let i = 0; i < out.length; i++) out[i] = 1 - out[i];
  return out;
}
function makeToolSafe(m, w, h, a, ppm, mode) {
  const toolR = a.tool_dia / 2 * ppm, featR = a.min_feature / 2 * ppm, minArea = (a.min_feature * ppm) ** 2 * 4;
  m = morph(m, w, h, cv.MORPH_CLOSE, disk(featR * 0.5));
  m = morph(m, w, h, cv.MORPH_OPEN, disk(featR * 0.5));
  if (mode === 'pocket') {
    m = morph(m, w, h, cv.MORPH_OPEN, disk(toolR));
    m = morph(m, w, h, cv.MORPH_CLOSE, disk(featR));
  }
  return removeSmall(m, w, h, minArea);
}
function buildMask(src, a) {
  let raw, W, H, ppm, w, h;
  if (src.kind === 'svg') {
    W = a.width_mm; H = W * src.h / src.w;
    ppm = Math.min(Math.max(6.0 / a.min_feature, 8.0), 3000.0 / Math.max(W, H));
    w = pyRound(W * ppm); h = pyRound(H * ppm);
    const g = renderSvgFilled(src, w, h).gray;
    raw = new Uint8Array(w * h);
    for (let i = 0; i < raw.length; i++) raw[i] = (g[i] < 128) !== a.invert ? 1 : 0;
  } else {
    [W, H, ppm] = workingScale(a, src.h, src.w);
    w = pyRound(W * ppm); h = pyRound(H * ppm);
    const rgba = keep(cv.matFromImageData(src.img)), rs = keep(new cv.Mat()), gray = keep(new cv.Mat()), eq = keep(new cv.Mat());
    cv.resize(rgba, rs, new cv.Size(w, h), 0, 0, w < src.w ? cv.INTER_AREA : cv.INTER_CUBIC);
    cv.cvtColor(rs, gray, cv.COLOR_RGBA2GRAY);
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8)); clahe.apply(gray, eq); clahe.delete();
    raw = toneMask(matU8(eq), w, h, a);
    if (src.hasAlpha) {
      const al = new Uint8Array(src.w * src.h), d = src.img.data;
      for (let i = 0; i < al.length; i++) al[i] = d[i * 4 + 3] > 127 ? 1 : 0;
      const am = u8Mat(al, src.w, src.h), ar = keep(new cv.Mat());
      cv.resize(am, ar, new cv.Size(w, h), 0, 0, cv.INTER_NEAREST);
      const iso = ar.data; for (let i = 0; i < raw.length; i++) raw[i] *= iso[i];
    }
  }
  const safe = (src.kind === 'svg' && !a.svg_retrace) ? raw.slice() : makeToolSafe(raw, w, h, a, ppm, a.mode);
  return { raw, safe, W, H, ppm, w, h };
}

function flags(raw, safe, w, h, a, ppm) {
  const tan = Math.tan(a.vbit_angle / 2 * Math.PI / 180), px2 = 1.0 / ppm ** 2, N = w * h;
  const lost = new Uint8Array(N), bridged = new Uint8Array(N);
  let nl = 0, nb = 0, ns = 0;
  for (let i = 0; i < N; i++) {
    lost[i] = raw[i] === 1 && safe[i] === 0 ? 1 : 0; bridged[i] = raw[i] === 0 && safe[i] === 1 ? 1 : 0;
    nl += lost[i]; nb += bridged[i]; ns += safe[i];
  }
  const count = (m, tot) => {
    if (!tot) return 0;
    const { n, st } = cc(m, w, h); let c = 0;
    for (let i = 1; i < n; i++) if (st[i * 5 + 4] >= 4) c++;
    return c;
  };
  const out = {};
  out.removed_detail = { area_mm2: r2(nl * px2, 1), count: count(lost, nl) };
  out.bridged_gaps = { area_mm2: r2(nb * px2, 1), count: count(bridged, nb) };
  const dtm = keep(new cv.Mat());
  cv.distanceTransform(u8Mat(safe, w, h), dtm, cv.DIST_L2, 5, cv.CV_32F);
  const dt = dtm.data32F;
  const flat = new Uint8Array(N);
  if (a.mode === 'vcarve') {
    let nf = 0, mx = 0;
    for (let i = 0; i < N; i++) {
      const d = dt[i] / ppm; if (d > mx) mx = d;
      if (safe[i] === 1 && d / tan >= a.depth) { flat[i] = 1; nf++; }
    }
    out.clearance = { area_mm2: r2(nf * px2, 1), vbit_max_width_mm: r2(2 * a.depth * tan, 2), widest_region_mm: r2(mx * 2, 2), tool_dia_mm: a.tool_dia };
  } else out.clearance = { area_mm2: 0.0 };
  const uncut = new Uint8Array(N); for (let i = 0; i < N; i++) uncut[i] = 1 - safe[i];
  const r = a.fragile_mm / 2 * ppm;
  const opened = morph(uncut, w, h, cv.MORPH_OPEN, disk(r));
  const fragile = new Uint8Array(N); let nfr = 0;
  const b = Math.max(2, Math.trunc(r * 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (uncut[i] === 1 && opened[i] === 0 && y >= b && y < h - b && x >= b && x < w - b) { fragile[i] = 1; nfr++; }
  }
  out.fragile = { area_mm2: r2(nfr * px2, 1), count: count(fragile, nfr), under_mm: a.fragile_mm };
  out.cut_area_pct = r2(ns / N * 100, 1);
  return { fl: out, layers: { lost, bridged, flat, fragile } };
}

function trace(safe, w, h, ppm, a) {
  const turd = Math.trunc((a.min_feature * ppm) ** 2), s = 1.0 / ppm;
  const pl = self.PotraceCore.trace(safe, w, h, { turdSize: turd, turnPolicy: 'minority', alphaMax: a.alphamax, optCurve: true, optTolerance: a.opttol });
  const X = (p) => pyFixed(p.x * s, 3), Y = (p) => pyFixed(p.y * s, 3);
  const items = []; let nodes = 0;
  for (const path of pl) {
    const c = path.curve, n = c.n, st = c.c[(n - 1) * 3 + 2];
    let d = `M${X(st)},${Y(st)}`;
    for (let i = 0; i < n; i++) {
      nodes++;
      const p0 = c.c[i * 3], p1 = c.c[i * 3 + 1], p2 = c.c[i * 3 + 2];
      d += c.tag[i] === 'CORNER' ? `L${X(p1)},${Y(p1)}L${X(p2)},${Y(p2)}` : `C${X(p0)},${Y(p0)} ${X(p1)},${Y(p1)} ${X(p2)},${Y(p2)}`;
    }
    items.push({ sy: st.y, sx: st.x, start: [st.x * s, st.y * s], d: d + 'Z' });
  }
  // the reference traces region by region and sorts by start point (row-major from the top)
  items.sort((p, q) => p.sy - q.sy || p.sx - q.sx);
  return { items, nodes };
}
function orderPaths(items) {             // greedy nearest neighbour from (0,0); closed paths: end = start
  if (!items.length) return { ds: [], travel: 0 };
  const n = items.length, used = new Uint8Array(n), ds = [];
  let cx = 0, cy = 0, travel = 0;
  for (let k = 0; k < n; k++) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (!used[i]) {
      const dx = items[i].start[0] - cx, dy = items[i].start[1] - cy, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = i; }
    }
    used[best] = 1; const it = items[best];
    travel += Math.hypot(it.start[0] - cx, it.start[1] - cy); ds.push(it.d);
    [cx, cy] = it.start;
  }
  return { ds, travel };
}
function regionStats(m, w, h, ppm) {
  const { n, lab, st } = cc(m, w, h);
  if (n <= 1) return [];
  // one findContours over the padded mask; each contour's pixels belong to exactly one 8-connected region
  const W2 = w + 2, pad = new Uint8Array(W2 * (h + 2));
  for (let y = 0; y < h; y++) pad.set(m.subarray(y * w, y * w + w), (y + 1) * W2 + 1);
  const src = u8Mat(pad, W2, h + 2), cs = keep(new cv.MatVector()), hier = keep(new cv.Mat());
  cv.findContours(src, cs, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  const per = new Float64Array(n);
  for (let i = 0; i < cs.size(); i++) {
    const c = cs.get(i), p = c.data32S, li = lab[(p[1] - 1) * w + (p[0] - 1)];
    per[li] += cv.arcLength(c, true); c.delete();
  }
  const out = [];
  for (let i = 1; i < n; i++) out.push([st[i * 5 + 4] / ppm ** 2, per[i] / ppm * 0.92]);
  return out;
}
function estimate(a, safe, w, h, ppm, travelIn) {
  const D = a.tool_dia, tan = Math.tan(a.vbit_angle / 2 * Math.PI / 180);
  const pd = a.pass_depth || (a.mode === 'vcarve' ? a.depth : D / 2);
  let cut = 0, plunges = 0, travel = 0; const notes = [];
  if (a.mode === 'pocket') {
    const passes = Math.ceil(a.depth / pd);
    for (const [A, P] of regionStats(safe, w, h, ppm)) { cut += (A / (a.stepover * D) + P) * passes; plunges += passes; }
    travel += travelIn * passes;
  } else {
    for (const [A, P] of regionStats(safe, w, h, ppm)) {
      const wd = 2 * A / Math.max(P, 1e-6), z = Math.min(wd / 2 / tan, a.depth), wv = 2 * z * tan;
      const passes = a.pass_depth ? Math.ceil(z / pd) : 1;
      const path = wd <= wv * 1.05 ? P / 2 : A / Math.max(wv * a.stepover, 0.2) + P;
      cut += path * passes; plunges += passes;
    }
    travel += travelIn;
    notes.push(`flat areas wider than ${pyFixed(2 * a.depth * tan, 1)} mm hit max depth: CAM will want a clearance end mill there`);
  }
  const plungeT = plunges * (pd / a.plunge + 2 * a.safe_z / a.rapid);
  const mins = (cut / a.feed + travel / a.rapid + plungeT) * 1.15;
  return { plunges: Math.trunc(plunges), cut_length_m: r2(cut / 1000, 2), rapid_travel_m: r2(travel / 1000, 2), pass_depth_mm: r2(pd, 2),
    time_min: r2(mins, 1), time_range_min: [r2(mins * 0.7, 1), r2(mins * 1.3, 1)],
    assumes: `feed ${pyStr(a.feed)} plunge ${pyStr(a.plunge)} rapid ${pyStr(a.rapid)} mm/min, safe Z ${pyStr(a.safe_z)} mm, stepover ${pyStr(a.stepover)}`, notes };
}
function svgDocument(W, H, a, ds, transform) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pyFixed(W, 3)}mm" height="${pyFixed(H, 3)}mm" viewBox="0 0 ${pyFixed(W, 3)} ${pyFixed(H, 3)}">`,
    `<!-- CNC vector | mode=${a.mode} tool=${pyStr(a.tool_dia)}mm min_feature=${pyStr(a.min_feature)}mm | units: mm -->`,
    `<g id="${a.mode}" fill="none" stroke="#000000" stroke-width="0.1" transform="${transform || 'translate(0.000,0.000)'}">`];
  for (const d of ds) out.push(`<path d="${d}"/>`);
  out.push('</g>', '</svg>');
  return out.join('\n');
}
function warningsFor(fl, est, a) {
  const w = [];
  if (fl.removed_detail.count) w.push({ level: 'warn', code: 'removed', text: `${fl.removed_detail.count} cut details under ${pyStr(a.min_feature)} mm were dropped by the bit rules (${pyStr(fl.removed_detail.area_mm2)} mm²). Shown red.` });
  if (fl.bridged_gaps.count) w.push({ level: 'info', code: 'bridged', text: `${fl.bridged_gaps.count} hairline gaps / pin holes were closed (${pyStr(fl.bridged_gaps.area_mm2)} mm²). Shown purple.` });
  const c = fl.clearance;
  if (a.mode === 'vcarve' && c.area_mm2 > 0) w.push({ level: 'warn', code: 'clearance', text: `${pyFixed(c.area_mm2 / 100, 1)} cm² is wider than the ${pyG(a.vbit_angle)}° V-bit clears at ${pyG(a.depth)} mm (${pyStr(c.vbit_max_width_mm)} mm). Flat floor: use a Ø${pyG(a.tool_dia)} mm clearance end mill there. Shown blue.` });
  const f = fl.fragile;
  if (f.count) w.push({ level: 'warn', code: 'fragile', text: `${f.count} standing strips narrower than ${pyStr(f.under_mm)} mm between cuts may chip or tear out (${pyStr(f.area_mm2)} mm²). Shown orange.` });
  if (est && est.time_min > 90) w.push({ level: 'info', code: 'time', text: `Long job: about ${pyFixed(est.time_min, 0)} min (${pyFixed(est.time_range_min[0], 0)}–${pyFixed(est.time_range_min[1], 0)}).` });
  if (!w.length) w.push({ level: 'ok', code: 'ok', text: 'Everything is within the bit rules.' });
  return w;
}

// ------------------------------------------------------------------ images out
// PNG encoder (filter 0 + native CompressionStream). OffscreenCanvas.convertToBlob can stall for seconds
// in a worker while the page is busy rendering, so images are encoded here instead.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function toPngBlob(img, kind) {
  const { w, h } = img, ch = kind === 'gray' ? 1 : 4, px = kind === 'gray' ? img.gray : img.rgba;
  const raw = new Uint8Array((w * ch + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * ch, (y + 1) * w * ch), y * (w * ch + 1) + 1);
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = ch === 1 ? 0 : 6;
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
function canvasGray(g, w, h) {
  const d = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = d[i];
  return { w, h, gray: out };
}
function overlayImage(w, h, L, maxw = 1600) {
  let o = new Uint8Array(w * h * 4);
  const put = (m, r, g, b, al) => { for (let i = 0; i < m.length; i++) if (m[i]) { const k = i * 4; o[k] = r; o[k + 1] = g; o[k + 2] = b; o[k + 3] = al; } };
  put(L.flat, 60, 140, 255, 150); put(L.fragile, 255, 150, 40, 235); put(L.bridged, 200, 90, 255, 235); put(L.lost, 255, 50, 70, 255);
  const s = Math.min(1.0, maxw / Math.max(w, h));
  if (s >= 1) return { w, h, rgba: o };
  const k = Math.max(1, pyRound(1 / s));
  let hot = false; for (let i = 3; i < o.length; i += 4) if (o[i] > 200) { hot = true; break; }
  const om = keep(new cv.Mat(h, w, cv.CV_8UC4)); om.data.set(o);
  if (hot) {
    const dil = keep(new cv.Mat()), kern = keep(cv.Mat.ones(k, k, cv.CV_8U));
    cv.dilate(om, dil, kern, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    const a = om.data, b = dil.data;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] > 200 || (b[i + 3] > 200 && a[i + 3] < 200)) { a[i] = b[i]; a[i + 1] = b[i + 1]; a[i + 2] = b[i + 2]; a[i + 3] = b[i + 3]; }
    }
  }
  const tw = Math.trunc(w * s), th = Math.trunc(h * s), rs = keep(new cv.Mat());
  cv.resize(om, rs, new cv.Size(tw, th), 0, 0, cv.INTER_AREA);
  return { w: tw, h: th, rgba: new Uint8Array(rs.data) };
}
function maskImage(m, w, h, width = 1600) {
  const s = Math.min(1.0, width / w), g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (1 - m[i]) * 255;
  if (s >= 1) return { w, h, gray: g };
  const tw = Math.trunc(w * s), th = Math.trunc(h * s), rs = keep(new cv.Mat());
  cv.resize(u8Mat(g, w, h), rs, new cv.Size(tw, th), 0, 0, cv.INTER_AREA);
  return { w: tw, h: th, gray: new Uint8Array(rs.data) };
}
function fillPaths(ds, W, H, ow, oh) {    // even-odd black fill on white, like the resvg renders in the reference
  const c = new OffscreenCanvas(ow, oh), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, ow, oh);
  g.setTransform(ow / W, 0, 0, oh / H, 0, 0);
  g.fillStyle = '#000'; g.fill(new Path2D(ds.join(' ')), 'evenodd');
  return { c, g };
}
function depthTexture(safe, w, h, W, H, a, ds) {
  const s = a.tex_max / Math.max(W, H), tw = pyRound(W * s), th = pyRound(H * s), hw = tw * 2, hh = th * 2;
  let hi = new Uint8Array(hw * hh);
  if (ds) {
    const { g } = fillPaths(ds, W, H, hw, hh), d = g.getImageData(0, 0, hw, hh).data;
    for (let i = 0, j = 0; j < hi.length; i += 4, j++) hi[j] = d[i] < 128 ? 1 : 0;
  } else {
    const f = keep(new cv.Mat(h, w, cv.CV_32FC1)), fd = f.data32F;
    for (let i = 0; i < safe.length; i++) fd[i] = safe[i];
    const rs = keep(new cv.Mat()); cv.resize(f, rs, new cv.Size(hw, hh), 0, 0, cv.INTER_LINEAR);
    const rd = rs.data32F; for (let i = 0; i < hi.length; i++) hi[i] = rd[i] > 0.5 ? 1 : 0;
  }
  const z = keep(new cv.Mat(hh, hw, cv.CV_32FC1)), mmpp = W / hw;
  if (a.mode === 'vcarve') {
    cv.distanceTransform(u8Mat(hi, hw, hh), z, cv.DIST_L2, cv.DIST_MASK_PRECISE, cv.CV_32F);
    const tan = Math.tan(a.vbit_angle / 2 * Math.PI / 180), zd = z.data32F;
    for (let i = 0; i < zd.length; i++) zd[i] = Math.min(Math.max(zd[i] * mmpp - 0.5 * mmpp, 0) / tan, a.depth);
  } else { const zd = z.data32F; for (let i = 0; i < zd.length; i++) zd[i] = hi[i] * a.depth; }
  const zs = keep(new cv.Mat()); cv.resize(z, zs, new cv.Size(tw, th), 0, 0, cv.INTER_AREA);
  const zz = zs.data32F, u16 = new Uint16Array(tw * th), md = Math.max(a.depth, 1e-6);
  for (let i = 0; i < u16.length; i++) u16[i] = Math.trunc(Math.min(Math.max(zz[i] / md, 0), 1) * 65535);
  return { u16, tw, th };
}

// ------------------------------------------------------------------ 3D viewer texture
// RG half floats for the GPU: r = depth / max depth, g = carve mask blurred ~0.45 mm (AO, lip scorch, resin wicking).
// Done here so the page never blocks on it; the trace outputs above are untouched.
function viewerTexture(u16, tw, th, artW) {
  const n = tw * th, mask = new Float32Array(n), tmp = new Float32Array(n), md = 65535;
  for (let i = 0; i < n; i++) mask[i] = u16[i] > 0 ? 1 : 0;
  const rad = Math.max(1, Math.round(0.45 * tw / artW));
  for (let pass = 0; pass < 3; pass++) { boxBlurH(mask, tmp, tw, th, rad); boxBlurV(tmp, mask, tw, th, rad); }
  const out = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) { out[2 * i] = toHalf(u16[i] / md); out[2 * i + 1] = toHalf(mask[i]); }
  return out;
}
// Baked ambient occlusion of the carve (Relief Forge style multi-scale cavity): how far each point sits below the mean
// height around it, per mm of radius, at 0.4 / 1.2 / 3.6 mm. Scaled so the bottom of a deep 60 degree V groove loses half
// its sky (a V groove of half-angle 30 deg sees sin 30 = 0.5 of the cosine-weighted sky), so 100 % is about physical.
// The top face (never below its neighbourhood) stays at 0. One byte per texel, sampled only for indirect light.
function aoTexture(u16, tw, th, artW, maxDepth) {
  const n = tw * th, d = new Float32Array(n), b = new Float32Array(n), t = new Float32Array(n), occ = new Float32Array(n);
  const k = maxDepth / 65535;
  for (let i = 0; i < n; i++) d[i] = u16[i] * k;
  const px = tw / artW;
  for (const [rmm, w] of [[0.4, 0.3], [1.2, 0.35], [3.6, 0.35]]) {
    const r = Math.max(1, Math.round(rmm * px)), rr = r / px;
    boxBlurH(d, t, tw, th, r); boxBlurV(t, b, tw, th, r);
    const s = w * 0.58 / rr;
    for (let i = 0; i < n; i++) { const v = d[i] - b[i]; if (v > 0) occ[i] += v * s; }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.min(occ[i], 0.9) * 255);
  return out;
}
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function toHalf(v) {                       // float -> IEEE half; values here are 0..1
  if (!(v > 0)) return 0;
  if (v < 6.103515625e-5) return Math.round(v / 5.960464477539063e-8);   // subnormal half
  _f32[0] = v; const x = _u32[0], e = (x >>> 23) & 0xff, m = x & 0x7fffff;
  return (((e - 112) << 10) | (m >>> 13)) + ((m >>> 12) & 1);
}
function boxBlurH(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { dst[o + x] = acc * k; acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { dst[y * w + x] = acc * k; acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x]; }
  }
}

// ------------------------------------------------------------------ process
async function process(src, params, doTrace) {
  const t0 = performance.now(), tm = {}, lap = (k) => { tm[k] = r2((performance.now() - t0) / 1000, 2); };
  const a = makeArgs(params);
  const { raw, safe, W, H, ppm, w, h } = buildMask(src, a); lap('mask');
  const { fl, layers } = flags(raw, safe, w, h, a, ppm); lap('flags');
  const res = { size_mm: [r2(W, 2), r2(H, 2)], px_per_mm: r2(ppm, 2), flags: fl };
  let svgText = null, npaths, nodes, tr, depthDs = null;
  if (doTrace) {
    if (src.kind === 'svg' && !a.svg_retrace) {
      const [x, y, sw] = src.svg_vb, k = W / sw;
      svgText = svgDocument(W, H, a, src.ds, `scale(${pyFixed(k, 6)}) translate(${pyFixed(-x, 3)},${pyFixed(-y, 3)})`);
      npaths = src.ds.length; nodes = src.ds.reduce((t, d) => t + (d.match(/[CLQA]/g) || []).length, 0); tr = 0.0;
    } else {
      const t = trace(safe, w, h, ppm, a); lap('potrace');
      const o = orderPaths(t.items); tr = o.travel; npaths = o.ds.length; nodes = t.nodes;
      svgText = svgDocument(W, H, a, o.ds); depthDs = o.ds;
    }
    lap('trace');
  } else {
    // quick pass: path count / travel approximated from contours
    const cs = keep(new cv.MatVector()), hier = keep(new cv.Mat());
    cv.findContours(u8Mat(safe, w, h), cs, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
    const turd = (a.min_feature * ppm) ** 2, starts = [];
    for (let i = 0; i < cs.size(); i++) {
      const c = cs.get(i);
      if (cv.contourArea(c) >= turd) {
        const p = c.data32S; let bi = 0;
        for (let j = 1; j < p.length / 2; j++) if (p[j * 2 + 1] < p[bi * 2 + 1]) bi = j;
        starts.push({ start: [p[bi * 2] / ppm, p[bi * 2 + 1] / ppm], d: null });
      }
      c.delete();
    }
    npaths = starts.length; nodes = null; tr = orderPaths(starts).travel;
  }
  const est = estimate(a, safe, w, h, ppm, tr); lap('estimate');
  res.stats = { mode: a.mode, size_mm: [r2(W, 2), r2(H, 2)], px_per_mm: r2(ppm, 2), min_feature_mm: a.min_feature, tool_dia_mm: a.tool_dia,
    paths: npaths, nodes, rapid_travel_mm_est: r2(tr, 1), layers: [a.mode], estimate: est };
  res.traced = !!doTrace;
  res.warnings = warningsFor(fl, est, a);
  const useSvgDepth = doTrace && (src.kind !== 'svg' || a.svg_retrace);
  const tex = depthTexture(safe, w, h, W, H, a, useSvgDepth ? depthDs : null); lap('depth');
  res.tex = { w: tex.tw, h: tex.th, max_depth: a.depth };
  const rg = viewerTexture(tex.u16, tex.tw, tex.th, W); lap('viewer_tex');
  const ao = aoTexture(tex.u16, tex.tw, tex.th, W, a.depth); lap('viewer_ao');
  const ovl = overlayImage(w, h, layers); lap('overlay');
  const blobs = { depth: tex.u16.buffer, depthRG: rg.buffer, ao: ao.buffer, overlay: await toPngBlob(ovl, 'rgba') }; lap('overlay_png');
  blobs.mask = await toPngBlob(maskImage(safe, w, h), 'gray'); lap('mask_png');
  if (svgText) {
    blobs.svg = svgText;
    const pw = 1600, ph = pyRound(1600 * H / W), ds = src.kind === 'svg' && !a.svg_retrace ? null : depthDs;
    blobs.preview = await toPngBlob(ds ? canvasGray(fillPaths(ds, W, H, pw, ph).g, pw, ph) : renderSvgFilled(src, pw, ph), 'gray');
    lap('preview');
  }
  res.params = {}; for (const k in DEFAULTS) res.params[k] = a[k];
  lap('total'); res.timing_s = tm;
  const stats = { ...res.stats, flags: res.flags, warnings: res.warnings.map((x) => x.text), params: res.params };
  blobs.stats = JSON.stringify(stats, null, 1);
  return { res, blobs };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    await loadCV();
    if (m.type === 'load') {
      const info = await loadSource(m);
      self.postMessage({ rid: m.rid, ok: true, info });
    } else if (m.type === 'process') {
      const src = sources.get(m.id);
      if (!src) throw new Error('source not loaded');
      const out = await process(src, m.params || {}, !!m.trace);
      self.postMessage({ rid: m.rid, ok: true, ...out }, [out.blobs.depth, out.blobs.depthRG, out.blobs.ao]);
    } else if (m.type === 'debugMask') {       // test hook: the masks the reference compares against
      const src = sources.get(m.id), a = makeArgs(m.params || {}), r = buildMask(src, a);
      self.postMessage({ rid: m.rid, ok: true, w: r.w, h: r.h, raw: r.raw, safe: r.safe, rgba: src.img ? src.img.data : null, sw: src.w, sh: src.h });
    } else if (m.type === 'ping') self.postMessage({ rid: m.rid, ok: true });
  } catch (err) {
    console.error(err);
    self.postMessage({ rid: m.rid, ok: false, error: String(err && err.message || err) });
  } finally { freeAll(); }
};
