// Potrace core for Carve Sim. Curve fitting is the kilobtye/iwsfg JS port of potrace (GPL-2.0);
// the bitmap decomposition below is rewritten to follow potracer (the Python port Carve Sim's
// reference uses) step for step, including its scan order, path orientation and its
// majority()/edge-index quirks, so paths, start points and node counts line up with it.
var Potrace = require('potrace/lib/Potrace.js');
var Point = require('potrace/lib/types/Point.js');
var Path = require('potrace/lib/types/Path.js');

function decompose(bits, w, h, turdSize, policy) {
  // potracer pads one zero row at the bottom and one zero column at the right
  var W = w + 1, H = h + 1, bm = new Uint8Array(W * H), orig;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) bm[y * W + x] = bits[y * w + x] ? 1 : 0;
  orig = bm.slice();
  // numpy-style read: negative index wraps once, out of range -> undefined (caller decides)
  function get(yy, xx) {
    if (yy < -H || yy >= H || xx < -W || xx >= W) return undefined;
    if (yy < 0) yy += H; if (xx < 0) xx += W;
    return bm[yy * W + xx];
  }
  function majority(x, y) {
    for (var i = 2; i < 5; i++) {
      var ct = 0, v;
      for (var a = -i + 1; a < i - 2; a++) {      // potracer's range(-i+1, i-2)
        v = get(y + i - 1, x + a); if (v !== undefined) ct += v ? 1 : -1;
        v = get(y + a - 1, x + i - 1); if (v !== undefined) ct += v ? 1 : -1;
        v = get(y - i, x + a - 1); if (v !== undefined) ct += v ? 1 : -1;
        v = get(y + a, x - i); if (v !== undefined) ct += v ? 1 : -1;
      }
      if (ct > 0) return 1; else if (ct < 0) return 0;
    }
    return 0;
  }
  function findpath(x0, y0, sign) {
    var x = x0, y = y0, dirx = 0, diry = -1, tmp, p = new Path(), area = 0;
    while (true) {
      p.pt.push(new Point(x, y));
      if (x > p.maxX) p.maxX = x; if (x < p.minX) p.minX = x;
      if (y > p.maxY) p.maxY = y; if (y < p.minY) p.minY = y;
      x += dirx; y += diry; area += x * diry;
      if (x === x0 && y === y0) break;
      var c = get(y + Math.floor((diry - dirx - 1) / 2), x + Math.floor((dirx + diry - 1) / 2)) || 0;
      var d = get(y + Math.floor((diry + dirx - 1) / 2), x + Math.floor((dirx - diry - 1) / 2)) || 0;
      if (c && !d) {
        var right = policy === 'right' || (policy === 'black' && sign) || (policy === 'white' && !sign) ||
          (policy === 'majority' && majority(x, y)) || (policy === 'minority' && !majority(x, y));
        if (right) { tmp = dirx; dirx = diry; diry = -tmp; } else { tmp = dirx; dirx = -diry; diry = tmp; }
      } else if (c) { tmp = dirx; dirx = diry; diry = -tmp; }
      else if (!d) { tmp = dirx; dirx = -diry; diry = tmp; }
    }
    p.len = p.pt.length; p.area = area; p.sign = sign ? '+' : '-';
    return p;
  }
  function xorPath(p) {
    if (!p.len) return;
    var y1 = p.pt[p.len - 1].y, xa = p.pt[0].x;
    for (var k = 0; k < p.len; k++) {
      var x = p.pt[k].x, y = p.pt[k].y;
      if (y !== y1) {
        var row = Math.min(y, y1) * W, a = Math.min(x, xa), b = Math.max(x, xa);
        for (var j = a; j < b; j++) bm[row + j] ^= 1;
        y1 = y;
      }
    }
  }
  var list = [], row = H - 1;
  while (row >= 0) {
    var off = row * W, fx = -1;
    for (var xx = 0; xx < W; xx++) if (bm[off + xx]) { fx = xx; break; }
    if (fx < 0) { row--; continue; }
    var path = findpath(fx, row + 1, orig[off + fx]);
    xorPath(path);
    if (path.area > turdSize) list.push(path);
  }
  return list;
}

self.PotraceCore = {
  // bits: Uint8Array w*h, nonzero = region to trace. Returns paths with .curve {n, tag[], c[]}
  trace: function (bits, w, h, opts) {
    var p = new Potrace({ turnPolicy: opts.turnPolicy || 'minority', turdSize: opts.turdSize, alphaMax: opts.alphaMax,
      optCurve: opts.optCurve !== false, optTolerance: opts.optTolerance });
    p._pathlist = decompose(bits, w, h, opts.turdSize, opts.turnPolicy || 'minority');
    p._processPath();
    return p._pathlist;
  }
};
