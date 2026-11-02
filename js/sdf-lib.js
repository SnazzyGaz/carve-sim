// Exact signed distance fields straight from SVG path geometry (classic script, importScripts'd by svg-worker.js).
// Path data is flattened finely (curves to within ~1/20 texel), the inside is found by scanline crossings at each texel
// centre (even-odd or nonzero, as the SVG fill rule says), and the distance is the true Euclidean distance to the nearest
// flattened segment: every texel near a segment measures it exactly, then two raster sweeps hand each texel its
// neighbours' nearest segments and re-measure (vector propagation with exact segment distances, ~0.01 texel error).
// Units are texels: texel i spans [i, i+1), its centre is i + 0.5, which is where the GPU's bilinear filter puts it.

const SDF_TOL = 0.05;     // curve flattening tolerance, texels
const NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y;

// d string + affine (a,b,c,d,e,f: x' = a x + c y + e, y' = b x + d y + f; user units -> texels) -> polylines
// out: array of { p: number[] (x0,y0,x1,y1,...), closed }
function flattenPath(d, A, out) {
  let i = 0; const n = d.length;
  const skip = () => { while (i < n) { const c = d.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) i++; else break; } };
  const num = () => { skip(); NUM_RE.lastIndex = i; const m = NUM_RE.exec(d); if (!m) throw new Error('bad path number at ' + i); i = NUM_RE.lastIndex; return +m[0]; };
  const flag = () => { skip(); const c = d[i]; if (c === '0' || c === '1') { i++; return c === '1'; } throw new Error('bad arc flag'); };
  const more = () => { skip(); if (i >= n) return false; const c = d[i]; return !/[A-Za-z]/.test(c); };
  const [a, b, c, dd, e, f] = A;
  const TX = (x, y) => a * x + c * y + e, TY = (x, y) => b * x + dd * y + f;
  const scale = Math.sqrt(Math.max(Math.abs(a * dd - b * c), 1e-12)), smax = Math.max(Math.hypot(a, b), Math.hypot(c, dd));
  let cur = null, x = 0, y = 0, x0 = 0, y0 = 0, qx = 0, qy = 0, cx2 = 0, cy2 = 0, prev = '';
  const start = (px, py) => { if (cur && cur.p.length > 2) out.push(cur); cur = { p: [TX(px, py), TY(px, py)], closed: false }; };
  const lineTo = (px, py) => { if (!cur) start(x, y); cur.p.push(TX(px, py), TY(px, py)); };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    if (!cur) start(x, y);
    const p0x = TX(x, y), p0y = TY(x, y), p1x = TX(x1, y1), p1y = TY(x1, y1), p2x = TX(x2, y2), p2y = TY(x2, y2), p3x = TX(x3, y3), p3y = TY(x3, y3);
    const m2 = Math.max(Math.hypot(p0x - 2 * p1x + p2x, p0y - 2 * p1y + p2y), Math.hypot(p1x - 2 * p2x + p3x, p1y - 2 * p2y + p3y));
    const k = Math.min(256, Math.max(1, Math.ceil(Math.sqrt(0.75 * m2 / SDF_TOL))));
    for (let s = 1; s <= k; s++) {
      const t = s / k, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      cur.p.push(w0 * p0x + w1 * p1x + w2 * p2x + w3 * p3x, w0 * p0y + w1 * p1y + w2 * p2y + w3 * p3y);
    }
  };
  const quad = (x1, y1, x2, y2) => cubic(x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), x2 + 2 / 3 * (x1 - x2), y2 + 2 / 3 * (y1 - y2), x2, y2);
  const arc = (rx, ry, phi, large, sweep, x2, y2) => {   // SVG 1.1 F.6.5 endpoint -> centre
    if (!cur) start(x, y);
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry || (x === x2 && y === y2)) { lineTo(x2, y2); return; }
    const cp = Math.cos(phi * Math.PI / 180), sp = Math.sin(phi * Math.PI / 180);
    const dx = (x - x2) / 2, dy = (y - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const num_ = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num_ / den)); if (large === sweep) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const ccx = cp * cxp - sp * cyp + (x + x2) / 2, ccy = sp * cxp + cp * cyp + (y + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const r = Math.max(rx, ry) * smax, st = r > SDF_TOL ? 2 * Math.acos(Math.max(-1, 1 - SDF_TOL / r)) : Math.PI / 2;
    const k = Math.min(1024, Math.max(2, Math.ceil(Math.abs(dt) / st)));
    for (let s = 1; s <= k; s++) {
      const t = t1 + dt * s / k, ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      const px = s === k ? x2 : cp * ex - sp * ey + ccx, py = s === k ? y2 : sp * ex + cp * ey + ccy;
      cur.p.push(TX(px, py), TY(px, py));
    }
  };
  while (true) {
    skip(); if (i >= n) break;
    let cmd = d[i];
    if (/[A-Za-z]/.test(cmd)) i++;
    else if (prev) cmd = prev === 'M' ? 'L' : prev === 'm' ? 'l' : prev;
    else throw new Error('path must start with a command');
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case 'M': { const px = num() + ox, py = num() + oy; start(px, py); x = x0 = px; y = y0 = py; break; }
      case 'L': { const px = num() + ox, py = num() + oy; lineTo(px, py); x = px; y = py; break; }
      case 'H': { const px = num() + ox; lineTo(px, y); x = px; break; }
      case 'V': { const py = num() + oy; lineTo(x, py); y = py; break; }
      case 'C': { const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy; cubic(x1, y1, x2, y2, x3, y3); cx2 = x2; cy2 = y2; x = x3; y = y3; break; }
      case 'S': { const r = /[CS]/i.test(prev); const x1 = r ? 2 * x - cx2 : x, y1 = r ? 2 * y - cy2 : y;
        const x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy; cubic(x1, y1, x2, y2, x3, y3); cx2 = x2; cy2 = y2; x = x3; y = y3; break; }
      case 'Q': { const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy; quad(x1, y1, x2, y2); qx = x1; qy = y1; x = x2; y = y2; break; }
      case 'T': { const r = /[QT]/i.test(prev); const x1 = r ? 2 * x - qx : x, y1 = r ? 2 * y - qy : y;
        const x2 = num() + ox, y2 = num() + oy; quad(x1, y1, x2, y2); qx = x1; qy = y1; x = x2; y = y2; break; }
      case 'A': { const rx = num(), ry = num(), phi = num(), la = flag(), sw = flag(), px = num() + ox, py = num() + oy; arc(rx, ry, phi, la, sw, px, py); x = px; y = py; break; }
      case 'Z': { if (cur) { cur.closed = true; out.push(cur); cur = null; } x = x0; y = y0; break; }
      default: throw new Error('unknown path command ' + cmd);
    }
    prev = cmd;
    if (C === 'Z') { prev = ''; }
  }
  if (cur && cur.p.length > 2) out.push(cur);
  return out;
}

// polylines -> segment list [ax, ay, bx, by] * n (fill: every subpath is closed, as SVG fills them)
function segmentsOf(polys, fill) {
  let ns = 0; for (const q of polys) ns += q.p.length / 2 - 1 + ((fill || q.closed) ? 1 : 0);
  const S = new Float64Array(ns * 4); let k = 0;
  for (const q of polys) {
    const p = q.p, m = p.length / 2;
    for (let j = 0; j < m - 1; j++) { S[k++] = p[2 * j]; S[k++] = p[2 * j + 1]; S[k++] = p[2 * j + 2]; S[k++] = p[2 * j + 3]; }
    if (fill || q.closed) { S[k++] = p[2 * m - 2]; S[k++] = p[2 * m - 1]; S[k++] = p[0]; S[k++] = p[1]; }
  }
  return k === S.length ? S : S.subarray(0, k);
}

// inside test at every texel centre by scanline crossings (exact for the flattened outline)
function insideMask(S, w, h, rule) {
  const ns = S.length / 4, cnt = new Int32Array(h + 1);
  const rows = (y0, y1) => { const lo = Math.min(y0, y1), hi = Math.max(y0, y1); return [Math.max(0, Math.ceil(lo - 0.5)), Math.min(h - 1, Math.ceil(hi - 0.5) - 1)]; };
  for (let s = 0; s < ns; s++) { const y0 = S[4 * s + 1], y1 = S[4 * s + 3]; if (y0 === y1) continue; const [j0, j1] = rows(y0, y1); for (let j = j0; j <= j1; j++) cnt[j + 1]++; }
  for (let j = 0; j < h; j++) cnt[j + 1] += cnt[j];
  const tot = cnt[h], xs = new Float64Array(tot), dir = rule === 'nonzero' ? new Int8Array(tot) : null, fillp = cnt.slice(0, h);
  for (let s = 0; s < ns; s++) {
    const ax = S[4 * s], ay = S[4 * s + 1], bx = S[4 * s + 2], by = S[4 * s + 3]; if (ay === by) continue;
    const [j0, j1] = rows(ay, by), inv = (bx - ax) / (by - ay);
    for (let j = j0; j <= j1; j++) { const q = fillp[j]++; xs[q] = ax + (j + 0.5 - ay) * inv; if (dir) dir[q] = by > ay ? 1 : -1; }
  }
  const M = new Uint8Array(w * h);
  const span = (o, xa, xb) => { const i0 = Math.max(0, Math.ceil(xa - 0.5)), i1 = Math.min(w - 1, Math.ceil(xb - 0.5) - 1); for (let i = i0; i <= i1; i++) M[o + i] = 1; };
  for (let j = 0; j < h; j++) {
    const a0 = cnt[j], a1 = cnt[j + 1]; if (a1 - a0 < 2) continue;
    const o = j * w;
    if (!dir) { const r = xs.subarray(a0, a1).sort(); for (let q = 0; q + 1 < r.length; q += 2) span(o, r[q], r[q + 1]); }
    else {
      const idx = Array.from({ length: a1 - a0 }, (_, q) => a0 + q).sort((p, q) => xs[p] - xs[q]);
      let wn = 0; for (let q = 0; q < idx.length - 1; q++) { wn += dir[idx[q]]; if (wn) span(o, xs[idx[q]], xs[idx[q + 1]]); }
    }
  }
  return M;
}

// exact unsigned distance (texels) from every texel centre to the nearest segment
function segDistance(S, w, h) {
  const ns = S.length / 4, n = w * h, D = new Float32Array(n).fill(Infinity), I = new Int32Array(n).fill(-1);
  const d2 = (s, px, py) => {
    const ax = S[4 * s], ay = S[4 * s + 1], dx = S[4 * s + 2] - ax, dy = S[4 * s + 3] - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - px, ey = ay + t * dy - py; return ex * ex + ey * ey;
  };
  const R = 1.5;
  for (let s = 0; s < ns; s++) {   // seed: exact distances within 1.5 texels of each segment
    const ax = S[4 * s], ay = S[4 * s + 1], bx = S[4 * s + 2], by = S[4 * s + 3];
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - R - 0.5)), i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + R - 0.5));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - R - 0.5)), j1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + R - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const o = j * w + i, v = d2(s, i + 0.5, j + 0.5); if (v < D[o]) { D[o] = v; I[o] = s; } }
  }
  const tryN = (o, q, px, py) => { const s = I[q]; if (s < 0 || s === I[o]) return; const v = d2(s, px, py); if (v < D[o]) { D[o] = v; I[o] = s; } };
  for (let j = 0; j < h; j++) {
    const py = j + 0.5;
    for (let i = 0; i < w; i++) { const o = j * w + i, px = i + 0.5;
      if (i > 0) tryN(o, o - 1, px, py);
      if (j > 0) { tryN(o, o - w, px, py); if (i > 0) tryN(o, o - w - 1, px, py); if (i < w - 1) tryN(o, o - w + 1, px, py); } }
    for (let i = w - 2; i >= 0; i--) tryN(j * w + i, j * w + i + 1, i + 0.5, py);
  }
  for (let j = h - 1; j >= 0; j--) {
    const py = j + 0.5;
    for (let i = w - 1; i >= 0; i--) { const o = j * w + i, px = i + 0.5;
      if (i < w - 1) tryN(o, o + 1, px, py);
      if (j < h - 1) { tryN(o, o + w, px, py); if (i < w - 1) tryN(o, o + w + 1, px, py); if (i > 0) tryN(o, o + w - 1, px, py); } }
    for (let i = 1; i < w; i++) tryN(j * w + i, j * w + i - 1, i + 0.5, py);
  }
  for (let o = 0; o < n; o++) D[o] = Math.sqrt(D[o]);
  return D;
}

// layer items ({d, m}) -> segments in texel space; vb = viewBox, (tw, th) = texture size
function layerSegments(items, vb, tw, th, fill) {
  const sx = tw / vb[2], sy = th / vb[3], polys = [];
  for (const it of items) {
    const m = it.m || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const A = [sx * m.a, sy * m.b, sx * m.c, sy * m.d, sx * (m.e - vb[0]), sy * (m.f - vb[1])];
    try { flattenPath(it.d, A, polys); } catch (e) { /* skip unreadable path data, as a browser would draw up to the error */ }
  }
  return segmentsOf(polys, fill);
}
// filled layer -> signed distance (texels, + inside)
function signedField(items, vb, tw, th, rule) {
  const S = layerSegments(items, vb, tw, th, true);
  if (!S.length) return null;
  const M = insideMask(S, tw, th, rule), D = segDistance(S, tw, th);
  for (let o = 0; o < D.length; o++) if (!M[o]) D[o] = -D[o];
  return { s: D, nseg: S.length / 4 };
}
// stroked layer (engrave centrelines) -> unsigned distance (texels)
function lineField(items, vb, tw, th) {
  const S = layerSegments(items, vb, tw, th, false);
  if (!S.length) return null;
  return { s: segDistance(S, tw, th), nseg: S.length / 4 };
}
function toHalfS(v) { return v < 0 ? 0x8000 | toHalf(-v) : toHalf(v); }
