// Shared bake helpers for the workers (classic script; importScripts'd by svg-worker.js and carve-worker.js).
// viewerTexture / aoTexture are the 3D viewer's inputs; edt is an exact Euclidean distance transform (no OpenCV needed).
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


// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher), in place: f = 0 at seed pixels, BIG elsewhere.
// Afterwards f[i] = squared pixel distance to the nearest seed. Same answer as OpenCV DIST_L2 / DIST_MASK_PRECISE.
const EDT_BIG = 1e20;
function edtSq(f, w, h) {
  const n = Math.max(w, h), g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      const fq = g[q] + q * q; let p = v[k], s = (fq - (g[p] + p * p)) / (2 * (q - p));
      while (s <= z[k]) { k--; p = v[k]; s = (fq - (g[p] + p * p)) / (2 * (q - p)); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k], dq = q - p; d[q] = dq * dq + g[p]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) g[y] = f[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) g[x] = f[o + x];
    pass(w);
    for (let x = 0; x < w; x++) f[o + x] = d[x];
  }
  return f;
}
// distance (px) from each pixel inside the mask to the nearest pixel outside it (0 outside)
function edtInside(mask, w, h) {
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? EDT_BIG : 0;
  edtSq(f, w, h);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? Math.sqrt(f[i]) : 0;
  return f;
}
// distance (px) from every pixel to the nearest seed pixel
function edtTo(seed, w, h) {
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = seed[i] ? 0 : EDT_BIG;
  edtSq(f, w, h);
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i]);
  return f;
}
