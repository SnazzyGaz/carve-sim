// Main-thread side of the Carve Sim engine. Everything runs in carve-worker.js; this just
// queues requests (newest wins), turns results into blob: URLs and keeps the UI thread free.
export class Engine {
  constructor() {
    this.worker = new Worker(new URL('./carve-worker.js', import.meta.url));
    this.rid = 0; this.waiting = new Map();
    this.busy = false; this.queued = null;
    this.worker.onmessage = (e) => { const p = this.waiting.get(e.data.rid); if (p) { this.waiting.delete(e.data.rid); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); } };
    this.worker.onerror = (e) => console.error('worker error', e.message || e);
    this.ready = this._call({ type: 'ping' });   // resolves once OpenCV is up
  }
  _call(msg, transfer = []) {
    const rid = ++this.rid;
    return new Promise((res, rej) => { this.waiting.set(rid, { res, rej }); this.worker.postMessage({ ...msg, rid }, transfer); });
  }
  async load(blob, name) {
    const buffer = await blob.arrayBuffer();
    const msg = { type: 'load', id: 'src' + (++this.rid), name, buffer };
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(2000, buffer.byteLength)));
    const isSvg = /\.svg$/i.test(name) || head.includes('<svg');
    if (isSvg && !(head.includes('CNC vector') || /fill="none"/.test(new TextDecoder().decode(buffer)))) {
      msg.raster = await rasteriseSvg(blob);          // workers cannot decode SVG images; do it here once
    }
    const r = await this._call(msg, [buffer].concat(msg.raster ? [msg.raster] : []));
    const info = r.info;
    info.thumbUrl = URL.createObjectURL(info.thumb || blob);
    return info;
  }
  // newest request wins: a request queued behind a running one is replaced (and resolves null)
  process(id, params, trace) {
    return new Promise((res, rej) => {
      if (this.queued) this.queued.res(null);
      this.queued = { id, params, trace, res, rej };
      this._pump();
    });
  }
  async _pump() {
    if (this.busy || !this.queued) return;
    const q = this.queued; this.queued = null; this.busy = true;
    const t0 = performance.now();
    try {
      const r = await this._call({ type: 'process', id: q.id, params: q.params, trace: q.trace });
      const b = r.blobs, urls = { overlay: URL.createObjectURL(b.overlay), mask: URL.createObjectURL(b.mask) };
      if (b.preview) urls.preview = URL.createObjectURL(b.preview);
      if (b.svg) urls.svg = URL.createObjectURL(new Blob([b.svg], { type: 'image/svg+xml' }));
      urls.stats = URL.createObjectURL(new Blob([b.stats], { type: 'application/json' }));
      r.res.key = 'r' + r.rid; r.res.wall_ms = Math.round(performance.now() - t0);
      q.res({ res: r.res, depth: b.depth, svg: b.svg, urls });
    } catch (e) { q.rej(e); }
    finally { this.busy = false; this._pump(); }
  }
}
export function revoke(urls) { if (urls) for (const u of Object.values(urls)) URL.revokeObjectURL(u); }

async function rasteriseSvg(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000; const s = 3000 / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    return c.transferToImageBitmap();
  } finally { URL.revokeObjectURL(url); }
}
