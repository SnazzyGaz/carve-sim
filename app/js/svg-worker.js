/* Showroom bake worker: a parsed SVG (layers of path data, or a browser raster for generic art) -> exact signed distance
 * fields of the cut outlines -> the 3D viewer's RGBA half-float texture (signed mm to the cut line, blurred mask, floor
 * depth, wall slope) + baked AO. The shader turns that into depth per pixel (V-carve depth = min(max, sdf / tan(a/2))),
 * so the cut line and walls are exact at any zoom instead of following a raster.
 * The distance fields depend only on the file, so they are cached per document; the bit and depths only redo the cheap
 * packing. Classic worker; paths relative to this file. */
importScripts('bake-lib.js', 'sdf-lib.js');

let cache = null;   // { key, tw, th, regions: [{kind, level, levels, s}], engrave: dist | null }
const post = (rid, p, label) => self.postMessage({ rid, progress: p, label });
const MAX_STEPS = 4;   // pocket terraces above level 1 carried in the steps texture (levels 2..5)

// generic art (the browser's raster at ss x): signed distance from a supersampled exact EDT, box-downsampled
function rasterField(raster, tw, th, ss) {
  const hw = tw * ss, hh = th * ss, c = new OffscreenCanvas(hw, hh), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, hw, hh); g.drawImage(raster, 0, 0, hw, hh);
  const d = g.getImageData(0, 0, hw, hh).data, mask = new Uint8Array(hw * hh), inv = new Uint8Array(hw * hh);
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) { const m = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 128 ? 1 : 0; mask[j] = m; inv[j] = 1 - m; }
  const din = edtInside(mask, hw, hh), dout = edtInside(inv, hw, hh), s = new Float32Array(tw * th), k = 1 / (ss * ss * ss);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let a = 0;
    for (let j = 0; j < ss; j++) { const o = (y * ss + j) * hw + x * ss; for (let i = 0; i < ss; i++) a += mask[o + i] ? din[o + i] - 0.5 : 0.5 - dout[o + i]; }
    s[y * tw + x] = a * k;   // supersample px -> texels
  }
  return { s, nseg: 0 };
}

function prepare(m) {
  const { rid, doc } = m, tex_max = m.opts.tex_max || 2048, ss = m.opts.ss || 2;
  const W = doc.vb[2], H = doc.vb[3], sc = tex_max / Math.max(W, H);
  const tw = Math.max(8, Math.round(W * sc)), th = Math.max(8, Math.round(H * sc));
  const key = doc.id + '|' + tw + 'x' + th;
  if (cache && cache.key === key) return cache;
  cache = null;
  const C = { key, tw, th, regions: [], engrave: null, nseg: 0 };
  const L = doc.layers.filter((l) => l.kind !== 'profile' && l.items.length);
  let k = 0;
  for (const l of L) {
    post(rid, 0.05 + 0.6 * k / Math.max(1, L.length), 'Distance field ' + l.name); k++;
    if (l.kind === 'engrave') { const f = lineField(l.items, doc.vb, tw, th); if (f) { C.engrave = f.s; C.nseg += f.nseg; } }
    else { const f = signedField(l.items, doc.vb, tw, th, l.rule || 'evenodd'); if (f) { C.regions.push({ kind: l.kind, level: l.level || 0, levels: l.levels || 0, s: f.s }); C.nseg += f.nseg; } }
  }
  if (doc.raster) { post(rid, 0.3, 'Distance field'); C.regions.push({ kind: 'region', s: rasterField(doc.raster, tw, th, ss).s }); }
  cache = C; return C;
}

function bake(m) {
  const t0 = performance.now(), tm = {}, lap = (k) => (tm[k] = Math.round(performance.now() - t0));
  const { rid, doc, opts } = m, C = prepare(m); lap('sdf');
  const { tw, th } = C, n = tw * th, W = opts.width_mm, H = W * doc.vb[3] / doc.vb[2], mm = W / tw;
  const tan = Math.tan(opts.vbit_angle / 2 * Math.PI / 180), kV = 1 / tan;
  const Fp = opts.pocket_depth, wallW = 0.5 * mm;      // pocket walls: vertical to within half a texel
  const S = new Float32Array(n).fill(-1e9), F = new Float32Array(n), K = new Float32Array(n).fill(1);
  const put = (s, f, k) => { for (let i = 0; i < n; i++) { const v = s(i); if (v > S[i]) { S[i] = v; F[i] = f; K[i] = k; } } };
  const steps = [], stepD = [];
  for (const r of C.regions) {
    const e = r.kind === 'region' ? (doc.mode === 'pocket' ? 'pocket' : 'vcarve') : r.kind, s = r.s;
    if (e === 'level' && r.levels > 1 && r.level > 1) {          // nested terraces: level i adds Fp / levels inside its own outline
      const ci = Math.min(r.level - 2, MAX_STEPS - 1);
      if (!steps[ci]) { steps[ci] = new Float32Array(n).fill(-1e9); stepD[ci] = Fp / r.levels; }
      const a = steps[ci]; for (let i = 0; i < n; i++) { const v = s[i] * mm; if (v > a[i]) a[i] = v; }
      continue;
    }
    const f = e === 'vcarve' ? opts.depth : e === 'level' ? Fp * Math.max(1, r.level) / Math.max(1, r.levels) : Fp;
    put((i) => s[i] * mm, f, e === 'vcarve' ? kV : f / wallW);
  }
  if (C.engrave) { const d = C.engrave, De = opts.engrave_depth; put((i) => De * tan - d[i] * mm, De, kV); }
  const nst = steps.length; for (let c = 0; c < nst; c++) if (!steps[c]) { steps[c] = new Float32Array(n).fill(-1e9); stepD[c] = 0; }
  const stepK = 1 / wallW;
  lap('pack');
  post(rid, 0.75, 'Depth map');
  // depth per texel (CPU copy for AO, stats and the 2D view; the GPU evaluates the same formula per pixel)
  const Z = new Float32Array(n); let md = 1e-3, cut = 0;
  for (let i = 0; i < n; i++) {
    let z = Math.min(Math.max(S[i] * K[i], 0), F[i]);
    for (let c = 0; c < nst; c++) z += stepD[c] * Math.min(Math.max(steps[c][i] * stepK, 0), 1);
    Z[i] = z; if (z > md) md = z; if (S[i] > 0) cut++;
  }
  const u16 = new Uint16Array(n); for (let i = 0; i < n; i++) u16[i] = Math.trunc(Math.min(Z[i] / md, 1) * 65535);
  // blurred carve mask (~0.45 mm): lip scorch, resin wicking; from the exact coverage
  const mask = new Float32Array(n), tmp = new Float32Array(n), rad = Math.max(1, Math.round(0.45 / mm));
  for (let i = 0; i < n; i++) mask[i] = Math.min(Math.max(S[i] / mm + 0.5, 0), 1);
  for (let p = 0; p < 3; p++) { boxBlurH(mask, tmp, tw, th, rad); boxBlurV(tmp, mask, tw, th, rad); }
  const clampS = (v) => Math.min(Math.max(v, -8), 64);
  // one floor depth and wall slope for the whole file (the usual case): send RG (sdf, mask) and the two as uniforms,
  // half the texture memory and fetch bandwidth; mixed layers keep them per texel in an RGBA texture
  let fk = [F[0], K[0]];
  for (let i = 1; i < n; i++) if (F[i] !== fk[0] || K[i] !== fk[1]) { fk = null; break; }
  const nch = fk ? 2 : 4, tex = new Uint16Array(n * nch);
  for (let i = 0; i < n; i++) {
    tex[nch * i] = toHalfS(clampS(S[i])); tex[nch * i + 1] = toHalf(mask[i]);
    if (!fk) { tex[4 * i + 2] = toHalf(F[i]); tex[4 * i + 3] = toHalf(K[i]); }
  }
  let st = null;
  if (nst) {
    const nc = nst <= 2 ? 2 : 4, a = new Uint16Array(n * nc);
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) a[i * nc + c] = toHalfS(c < nst ? clampS(steps[c][i]) : -8);
    st = { data: a, nc, d: [0, 1, 2, 3].map((c) => stepD[c] || 0), k: stepK };
  }
  lap('viewer_tex');
  post(rid, 0.9, 'Ambient occlusion');
  const ao = aoTexture(u16, tw, th, W, md); lap('ao');
  const stats = { size_mm: [+W.toFixed(1), +H.toFixed(1)], tex: [tw, th], max_depth_mm: +md.toFixed(2), cut_pct: +(100 * cut / n).toFixed(1),
    cut_cm2: +(cut / n * W * H / 100).toFixed(1), segments: C.nseg, timing_ms: tm };
  return { u16, tex, fk, st, ao, tw, th, W, H, md, stats };
}

async function preview(u16, tw, th) {   // 2D view: depth as ink (white = uncut), up to 1600 px
  const s = Math.min(1, 1600 / Math.max(tw, th)), pw = Math.round(tw * s), ph = Math.round(th * s);
  const img = new ImageData(pw, ph), d = img.data;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const v = u16[Math.min(th - 1, Math.floor(y / s)) * tw + Math.min(tw - 1, Math.floor(x / s))] / 65535;
    const g = v > 0 ? Math.round(200 - 190 * Math.sqrt(v)) : 255, o = (y * pw + x) * 4;
    d[o] = g; d[o + 1] = g; d[o + 2] = g; d[o + 3] = 255;
  }
  const c = new OffscreenCanvas(pw, ph); c.getContext('2d').putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'bake') {
      const r = bake(m), tr = [r.tex.buffer, r.ao.buffer];
      const steps = r.st ? { data: r.st.data.buffer, nc: r.st.nc, d: r.st.d, k: r.st.k } : null; if (steps) tr.push(steps.data);
      self.postMessage({ rid: m.rid, ok: true, tw: r.tw, th: r.th, W: r.W, H: r.H, md: r.md, stats: r.stats, depthTex: r.tex.buffer, fk: r.fk, steps, ao: r.ao.buffer }, tr);
      self.postMessage({ rid: m.rid, preview: await preview(r.u16, r.tw, r.th) });
    } else if (m.type === 'ping') self.postMessage({ rid: m.rid, ok: true });
  } catch (err) {
    console.error(err);
    self.postMessage({ rid: m.rid, ok: false, error: String(err && err.message || err) });
  }
};
