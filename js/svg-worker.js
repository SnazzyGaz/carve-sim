/* Showroom bake worker: a parsed SVG (layers of path data, or a browser raster for generic art) -> depth map -> the 3D
 * viewer's RG half-float texture + baked AO. No OpenCV: Path2D rasterises, an exact EDT gives the V-carve depth.
 * The rasterised masks and their distance fields are cached per document, so changing bit angle, depth or board size
 * only redoes the cheap depth mapping. Classic worker; paths relative to this file. */
importScripts('bake-lib.js');

let cache = null;   // { key, tw, th, hw, hh, vmask, vdist, pockets:[{mask, i, n, kind}], edist, area }
const post = (rid, p, label) => self.postMessage({ rid, progress: p, label });

function rasterLayer(g, hw, hh, vb, items, how) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff'; g.fillRect(0, 0, hw, hh);
  const sx = hw / vb[2], sy = hh / vb[3];
  g.setTransform(sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy);
  const p = new Path2D();
  for (const it of items) { try { p.addPath(new Path2D(it.d), it.m || undefined); } catch (e) {} }
  if (how === 'stroke') { g.strokeStyle = '#000'; g.lineWidth = 1.2 / Math.min(sx, sy); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(p); }
  else { g.fillStyle = '#000'; g.fill(p, how === 'nonzero' ? 'nonzero' : 'evenodd'); }
  const d = g.getImageData(0, 0, hw, hh).data, m = new Uint8Array(hw * hh);
  for (let i = 0, j = 0; j < m.length; i += 4, j++) m[j] = d[i] < 128 ? 1 : 0;
  return m;
}

function prepare(m) {
  const { rid, doc } = m, tex_max = m.opts.tex_max || 2048, ss = m.opts.ss || 2;
  const W = doc.vb[2], H = doc.vb[3], s = tex_max / Math.max(W, H);
  const tw = Math.max(8, Math.round(W * s)), th = Math.max(8, Math.round(H * s)), hw = tw * ss, hh = th * ss;
  const key = doc.id + '|' + tw + 'x' + th + '|' + ss;
  if (cache && cache.key === key) return cache;
  cache = null;
  const c = new OffscreenCanvas(hw, hh), g = c.getContext('2d', { willReadFrequently: true });
  const C = { key, tw, th, hw, hh, ss, regions: [], engrave: null, layers: [] };
  const L = doc.layers.filter((l) => l.kind !== 'profile' && l.items.length);
  let k = 0;
  for (const l of L) {
    post(rid, 0.05 + 0.5 * k / Math.max(1, L.length), 'Rasterising ' + l.name); k++;
    if (l.kind === 'engrave') {
      const seed = rasterLayer(g, hw, hh, doc.vb, l.items, 'stroke');
      post(rid, 0.05 + 0.5 * (k - 0.5) / L.length, 'Distance field ' + l.name);
      C.engrave = edtTo(seed, hw, hh);
    } else {
      const mask = rasterLayer(g, hw, hh, doc.vb, l.items, l.rule || 'evenodd');
      C.regions.push({ kind: l.kind, level: l.level || 0, levels: l.levels || 0, mask });
    }
  }
  if (doc.raster) {   // generic art: the page as the browser drew it; dark = cut
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, hw, hh); g.drawImage(doc.raster, 0, 0, hw, hh);
    const d = g.getImageData(0, 0, hw, hh).data, mask = new Uint8Array(hw * hh);
    for (let i = 0, j = 0; j < mask.length; i += 4, j++) mask[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < 128 ? 1 : 0;
    C.regions.push({ kind: 'region', mask });
  }
  cache = C; return C;
}

function bake(m) {
  const t0 = performance.now(), tm = {}, lap = (k) => (tm[k] = Math.round(performance.now() - t0));
  const { rid, doc, opts } = m, C = prepare(m); lap('raster');
  const { tw, th, hw, hh, ss } = C, W = opts.width_mm, H = W * doc.vb[3] / doc.vb[2], mmpp = W / hw;
  const tan = Math.tan(opts.vbit_angle / 2 * Math.PI / 180);
  const eff = (r) => opts.carve !== 'auto' && r.kind !== 'region' && r.kind !== 'engrave' ? opts.carve
    : r.kind === 'region' ? (opts.carve !== 'auto' ? opts.carve : doc.mode || 'vcarve') : r.kind;
  const Z = new Float32Array(hw * hh);
  // V-carve: every V region (union) shares one distance field, so touching shapes carve as one
  const vr = C.regions.filter((r) => eff(r) === 'vcarve');
  if (vr.length) {
    if (!C.vdist || C.vkey !== vr.length + opts.carve) {
      post(rid, 0.6, 'Distance field');
      const u = vr.length === 1 ? vr[0].mask : new Uint8Array(hw * hh);
      if (vr.length > 1) for (const r of vr) for (let i = 0; i < u.length; i++) u[i] |= r.mask[i];
      C.vdist = edtInside(u, hw, hh); C.vkey = vr.length + opts.carve;
    }
    const d = C.vdist, cap = opts.depth, h = 0.5 * mmpp;
    for (let i = 0; i < Z.length; i++) if (d[i] > 0) Z[i] = Math.min(Math.max(d[i] * mmpp - h, 0) / tan, cap);
  }
  lap('vcarve');
  for (const r of C.regions) {
    const e = eff(r); if (e === 'vcarve') continue;
    const z = e === 'level' ? opts.pocket_depth * r.level / r.levels : opts.pocket_depth;
    const mk = r.mask; for (let i = 0; i < Z.length; i++) if (mk[i] && Z[i] < z) Z[i] = z;
  }
  if (C.engrave) {
    const d = C.engrave, De = opts.engrave_depth, k = mmpp / tan;
    for (let i = 0; i < Z.length; i++) { const z = De - d[i] * k; if (z > Z[i]) Z[i] = z; }
  }
  lap('depth');
  post(rid, 0.75, 'Depth map');
  let md = 1e-3; for (let i = 0; i < Z.length; i++) if (Z[i] > md) md = Z[i];
  const u16 = new Uint16Array(tw * th), inv = 1 / (ss * ss); let cut = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let a = 0; for (let j = 0; j < ss; j++) { const o = (y * ss + j) * hw + x * ss; for (let i = 0; i < ss; i++) a += Z[o + i]; }
    const v = Math.trunc(Math.min(Math.max(a * inv / md, 0), 1) * 65535); u16[y * tw + x] = v; if (v > 0) cut++;
  }
  lap('downsample');
  post(rid, 0.82, 'Viewer texture');
  const rg = viewerTexture(u16, tw, th, W); lap('viewer_tex');
  post(rid, 0.92, 'Ambient occlusion');
  const ao = aoTexture(u16, tw, th, W, md); lap('ao');
  const stats = { size_mm: [+W.toFixed(1), +H.toFixed(1)], tex: [tw, th], max_depth_mm: +md.toFixed(2), cut_pct: +(100 * cut / (tw * th)).toFixed(1),
    cut_cm2: +(cut / (tw * th) * W * H / 100).toFixed(1), timing_ms: tm };
  return { u16, rg, ao, tw, th, W, H, md, stats };
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
      const r = bake(m);
      self.postMessage({ rid: m.rid, ok: true, tw: r.tw, th: r.th, W: r.W, H: r.H, md: r.md, stats: r.stats, depthRG: r.rg.buffer, ao: r.ao.buffer },
        [r.rg.buffer, r.ao.buffer]);
      self.postMessage({ rid: m.rid, preview: await preview(r.u16, r.tw, r.th) });
    } else if (m.type === 'ping') self.postMessage({ rid: m.rid, ok: true });
  } catch (err) {
    console.error(err);
    self.postMessage({ rid: m.rid, ok: false, error: String(err && err.message || err) });
  }
};
