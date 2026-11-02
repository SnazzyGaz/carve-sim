// Showroom SVG import (main thread): reads an SVG's physical size, the CNC skill's layer conventions and metadata, and
// turns its shapes into path data + transforms for the bake worker. Generic artwork (no CNC layers, painted fills) is
// handed over as a browser raster instead, so CSS, text, gradients and knock-outs all come out as drawn: dark = cut.

const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
export const DEFAULT_WIDTH_MM = 300;

function len(s) {
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(s || '');
  return m ? { v: parseFloat(m[1]), u: m[2].toLowerCase() } : null;
}
const num = (el, a) => parseFloat(el.getAttribute(a)) || 0;

function layerOf(el) {
  for (let n = el; n && n.localName !== 'svg'; n = n.parentNode) {
    if (n.localName !== 'g') continue;
    const id = (n.getAttribute('id') || n.getAttribute('inkscape:label') || n.getAttribute('data-layer') || '').trim().toLowerCase();
    let m;
    if ((m = /^pocket[_-]?level[_-]?(\d+)$/.exec(id))) return { key: id, kind: 'level', level: +m[1] };
    if (/^(v[-_]?carve|vcarve.*)$/.test(id)) return { key: 'vcarve', kind: 'vcarve' };
    if (/^pocket/.test(id)) return { key: id, kind: 'pocket' };
    if (/^(engrave|centerline|centreline)/.test(id)) return { key: id, kind: 'engrave' };
    if (/^(profile|cutout|cut[-_]?out|border)/.test(id)) return { key: id, kind: 'profile' };
  }
  return null;
}
function inherited(el, prop) {
  for (let n = el; n && n.getAttribute; n = n.parentNode) {
    const st = n.getAttribute('style'); let m;
    if (st && (m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(st))) return m[1].trim();
    const a = n.getAttribute(prop); if (a != null) return a.trim();
  }
  return null;
}
function matrixOf(el, root) {
  let M = new DOMMatrix();
  const chain = []; for (let n = el; n && n !== root; n = n.parentNode) chain.unshift(n);
  for (const n of chain) {
    const t = n.transform && n.transform.baseVal; if (!t || !t.numberOfItems) continue;
    const c = t.consolidate(); if (c) M = M.multiply(DOMMatrix.fromMatrix(c.matrix));
  }
  return M.isIdentity ? null : { a: M.a, b: M.b, c: M.c, d: M.d, e: M.e, f: M.f };
}
function pathData(el) {
  const t = el.localName;
  if (t === 'path') return el.getAttribute('d');
  if (t === 'rect') { const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height'); return w > 0 && h > 0 ? `M${x},${y}h${w}v${h}h${-w}Z` : null; }
  if (t === 'circle' || t === 'ellipse') {
    const cx = num(el, 'cx'), cy = num(el, 'cy'), rx = t === 'circle' ? num(el, 'r') : num(el, 'rx'), ry = t === 'circle' ? rx : num(el, 'ry');
    return rx > 0 && ry > 0 ? `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0Z` : null;
  }
  if (t === 'polygon' || t === 'polyline') { const p = (el.getAttribute('points') || '').trim(); return p ? 'M' + p + (t === 'polygon' ? 'Z' : '') : null; }
  if (t === 'line') return `M${num(el, 'x1')},${num(el, 'y1')}L${num(el, 'x2')},${num(el, 'y2')}`;
  return null;
}
function readMeta(doc, svg) {
  const meta = {};
  const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 8) { const t = c.nodeValue; if (/CNC vector/i.test(t)) meta.comment = t.trim(); } } };
  walk(doc); walk(svg);
  const t = meta.comment || '', md = (svg.querySelector('metadata') || {}).textContent || '';
  const pick = (re) => { const m = re.exec(t) || re.exec(md); return m ? m[1] : null; };
  const mode = pick(/mode\s*=\s*([a-z_]+)/i); if (mode) meta.mode = mode.toLowerCase();
  const tool = pick(/tool\s*=\s*([\d.]+)\s*mm/i); if (tool) meta.tool_mm = +tool;
  const mf = pick(/min_feature\s*=\s*([\d.]+)/i); if (mf) meta.min_feature_mm = +mf;
  const dep = pick(/(?:^|\s)depth\s*=\s*([\d.]+)/i); if (dep) meta.depth_mm = +dep;
  const ang = pick(/(?:vbit|vbit_angle|angle)\s*=\s*([\d.]+)/i); if (ang) meta.vbit_angle = +ang;
  for (const [a, k] of [['data-depth', 'depth_mm'], ['data-pocket-depth', 'pocket_depth_mm'], ['data-engrave-depth', 'engrave_depth_mm'], ['data-vbit-angle', 'vbit_angle']]) {
    const v = parseFloat(svg.getAttribute(a)); if (v > 0) meta[k] = v;
  }
  const dm = svg.getAttribute('data-mode'); if (dm) meta.mode = dm.toLowerCase();
  return meta;
}

let nextId = 1;
export async function parseSvg(text, name = 'artwork.svg') {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), svg = doc.documentElement;
  if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('That file is not a readable SVG.');
  const wl = len(svg.getAttribute('width')), hl = len(svg.getAttribute('height'));
  let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) {
    vb = [0, 0, wl && wl.u !== '%' ? wl.v : 300, hl && hl.u !== '%' ? hl.v : (wl ? wl.v : 300)];
  }
  // physical size: width/height in real units win; px / unitless fall back to a 300 mm wide board
  let W = null, sizeFrom = 'default';
  if (wl && wl.u in UNIT_MM && wl.u !== 'px' && wl.u !== '') { W = wl.v * UNIT_MM[wl.u]; sizeFrom = `width="${svg.getAttribute('width')}"`; }
  else if (hl && hl.u in UNIT_MM && hl.u !== 'px' && hl.u !== '') { W = hl.v * UNIT_MM[hl.u] * vb[2] / vb[3]; sizeFrom = `height="${svg.getAttribute('height')}"`; }
  const meta = readMeta(doc, svg);

  // shapes by layer
  const groups = new Map(); let hasFill = false, hasLayers = false, nShapes = 0;
  for (const el of svg.querySelectorAll('*')) {
    if (!SHAPES.has(el.localName) || el.closest('defs,clipPath,mask,symbol,pattern,marker')) continue;
    const d = pathData(el); if (!d) continue; nShapes++;
    const L = layerOf(el); if (L) hasLayers = true;
    const fill = inherited(el, 'fill'); if (fill == null || !/^(none|transparent)$/i.test(fill)) hasFill = true;
    const key = L ? L.key : 'art';
    if (!groups.has(key)) groups.set(key, { name: key, kind: L ? L.kind : 'region', level: L && L.level, items: [] });
    groups.get(key).items.push({ d, m: matrixOf(el, svg) });
  }
  const cnc = hasLayers || !!meta.comment || (nShapes > 0 && !hasFill);   // outline-style (fill="none") = cut regions
  const out = { id: 'svg' + nextId++, name, vb, width_mm: W, sizeFrom, meta, cnc, text, nShapes };
  if (cnc) {
    const layers = [...groups.values()];
    const lv = layers.filter((l) => l.kind === 'level'); for (const l of lv) l.levels = Math.max(...lv.map((x) => x.level));
    // a lone outline group with no recognised id takes the file's mode (pocket/engrave/vcarve)
    for (const l of layers) if (l.kind === 'region' && meta.mode && ['pocket', 'engrave', 'vcarve'].includes(meta.mode)) l.kind = meta.mode;
    out.layers = layers;
    out.mode = meta.mode && meta.mode !== 'profile' ? meta.mode : 'vcarve';
    out.hasProfile = layers.some((l) => l.kind === 'profile');
  } else {
    out.layers = []; out.mode = meta.mode || 'vcarve'; out.generic = true;
  }
  out.kinds = [...new Set(out.layers.filter((l) => l.kind !== 'profile').map((l) => l.kind))];
  if (out.generic) out.kinds = ['region'];
  return out;
}

// generic art: draw the SVG once with the browser at the bake size (alpha over white)
export async function rasterFor(info, tex_max = 2048, ss = 2) {
  const s = tex_max / Math.max(info.vb[2], info.vb[3]);
  const hw = Math.max(8, Math.round(info.vb[2] * s)) * ss, hh = Math.max(8, Math.round(info.vb[3] * s)) * ss;
  let txt = info.text;
  // force the drawn size to the bake size so the browser rasterises sharply (keep the viewBox)
  const d = new DOMParser().parseFromString(txt, 'image/svg+xml'), r = d.documentElement;
  if (!r.getAttribute('viewBox')) r.setAttribute('viewBox', info.vb.join(' '));
  r.setAttribute('width', hw); r.setAttribute('height', hh); r.setAttribute('preserveAspectRatio', 'none');
  txt = new XMLSerializer().serializeToString(d);
  const url = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url; await img.decode();
    return await createImageBitmap(img, { resizeWidth: hw, resizeHeight: hh });
  } finally { URL.revokeObjectURL(url); }
}
