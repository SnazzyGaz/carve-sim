"""Before/after performance probe for the 3D viewer and the engine (headless Chromium, SwiftShader).
usage: [ART=samples/x.svg] python3 tools/perf.py <base url> <label> [out.json]
SwiftShader renders on the CPU, so ms here are only comparable between builds on this box, not real-GPU FPS.
The structural numbers (draw calls, triangles, shader size, texture memory, main-thread blocking) are what carry over."""
import asyncio, json, sys, time
from playwright.async_api import async_playwright

BASE, LABEL = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else None
import os
ART = os.environ.get('ART', 'samples/old-fisherman.svg')   # ART=samples/old-fisherman.jpg for builds before the SVG showroom
if '?' not in BASE: BASE += '?nosample&nosw'   # tests start from an empty board and bypass the offline cache

INIT = r'''
(() => {
  const BPP = {0x8058:4, 0x8C43:4, 0x881A:8, 0x822F:4, 0x822D:2, 0x8814:16, 0x8230:8, 0x822E:4, 0x8229:1, 0x822B:2, 0x81A6:4, 0x8CAC:4, 0x88F0:4, 0x81A5:2, 0x8051:3, 0x8C41:3, 0x8D62:2, 0x8056:2, 0x8057:2, 0x8DAB:8};
  const TYPEB = {0x1401:1, 0x140B:2, 0x8D61:2, 0x1406:4, 0x1403:2, 0x1405:4};
  const CH = {0x1908:4, 0x1907:3, 0x8227:2, 0x1903:1, 0x1909:1, 0x190A:2, 0x1902:1};
  const mem = new Map(); window.__mem = mem; let rbBound = null;
  const P = WebGL2RenderingContext.prototype;
  const key = (gl, tgt) => gl.getParameter(tgt === 0x8513 || (tgt >= 0x8515 && tgt <= 0x851A) ? 0x8514 : tgt === 0x806F ? 0x806A : tgt === 0x8C1A ? 0x8C1D : 0x8069);
  const ids = new WeakMap(); let nid = 0; const id = (o) => { if (!o) return 'null'; if (!ids.has(o)) ids.set(o, ++nid); return ids.get(o); };
  const ti = P.texImage2D;
  P.texImage2D = function (...a) {
    try {
      const [tgt, lvl, ifmt] = a; let w, h, fmt, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; } else { fmt = a[3]; type = a[4]; const s = a[5]; w = s.width || s.videoWidth || s.displayWidth; h = s.height || s.videoHeight || s.displayHeight; }
      const bpp = BPP[ifmt] || (CH[fmt] || 4) * (TYPEB[type] || 1);
      mem.set(id(key(this, tgt)) + ':' + tgt + ':' + lvl, w * h * bpp);
    } catch (e) {}
    return ti.apply(this, a);
  };
  const ts = P.texStorage2D;
  P.texStorage2D = function (tgt, levels, ifmt, w, h) {
    let tot = 0, ww = w, hh = h; for (let l = 0; l < levels; l++) { tot += ww * hh * (BPP[ifmt] || 4); ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); }
    mem.set(id(key(this, tgt)) + ':s', tot * (tgt === 0x8513 ? 6 : 1)); return ts.apply(this, arguments);
  };
  const gm = P.generateMipmap;
  P.generateMipmap = function (tgt) { const k = id(key(this, tgt)); for (const [kk, v] of mem) if (kk.startsWith(k + ':') && kk.endsWith(':0')) mem.set(k + ':mips', Math.round(v / 3)); return gm.apply(this, arguments); };
  const dt = P.deleteTexture;
  P.deleteTexture = function (t) { const k = id(t) + ':'; for (const kk of [...mem.keys()]) if (kk.startsWith(k)) mem.delete(kk); return dt.apply(this, arguments); };
  const br = P.bindRenderbuffer; P.bindRenderbuffer = function (t, rb) { rbBound = rb; return br.apply(this, arguments); };
  const rs = P.renderbufferStorage; P.renderbufferStorage = function (t, f, w, h) { mem.set('rb' + id(rbBound), w * h * (BPP[f] || 4)); return rs.apply(this, arguments); };
  const rsm = P.renderbufferStorageMultisample; P.renderbufferStorageMultisample = function (t, s, f, w, h) { mem.set('rb' + id(rbBound), w * h * (BPP[f] || 4) * s); return rsm.apply(this, arguments); };
  const dr = P.deleteRenderbuffer; P.deleteRenderbuffer = function (rb) { mem.delete('rb' + id(rb)); return dr.apply(this, arguments); };
  const bufs = new Map(); window.__bufs = bufs; const bb = {};
  const bindB = P.bindBuffer; P.bindBuffer = function (t, b) { bb[t] = b; return bindB.apply(this, arguments); };
  const bd = P.bufferData; P.bufferData = function (t, d) { bufs.set(id(bb[t]), typeof d === 'number' ? d : d.byteLength); return bd.apply(this, arguments); };
  const db = P.deleteBuffer; P.deleteBuffer = function (b) { bufs.delete(id(b)); return db.apply(this, arguments); };
  window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
})();
'''

HOOK = r'''
() => {
  const v = app.viewer, r = v.renderer, gl = r.getContext();
  if (v.__hooked) return; v.__hooked = true;
  window.__frames = []; r.info.autoReset = false; const px = new Uint8Array(4);
  const orig = v.render.bind(v);
  v.render = function (...a) {
    r.info.reset(); const t = performance.now(); orig(...a); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t2 = performance.now();
    window.__frames.push({ t, ms: t2 - t, calls: r.info.render.calls, tris: r.info.render.triangles, dpr: r.getPixelRatio(), q: v.quality || 'full' });
  };
}
'''

STATS = r'''
() => {
  const v = app.viewer, r = v.renderer, gl = r.getContext(), dbg = gl.getExtension('WEBGL_debug_shaders');
  let tex = 0; for (const x of window.__mem.values()) tex += x;
  let buf = 0; for (const x of window.__bufs.values()) buf += x;
  const c = r.domElement, dpr = r.getPixelRatio();
  const progs = (r.info.programs || []).map((p) => {
    const sh = gl.getAttachedShaders(p.program) || [];
    const o = { name: p.name };
    for (const s of sh) { const t = gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER ? 'vs' : 'fs';
      const src = gl.getShaderSource(s); o[t + '_chars'] = src.length;
      if (dbg) o[t + '_translated_chars'] = dbg.getTranslatedShaderSource(s).length;
      o[t + '_snoise_calls'] = (src.match(/snoise\(/g) || []).length - (src.match(/float snoise\(/g) || []).length; }
    return o; });
  return { texture_MB: +(tex / 1048576).toFixed(1), buffers_MB: +(buf / 1048576).toFixed(1), canvas: [c.width, c.height], dpr,
           textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: progs };
}
'''

def summ(fr):
    if not fr: return {}
    ms = sorted(f['ms'] for f in fr)
    return {'frames': len(fr), 'mean_ms': round(sum(ms) / len(ms), 1), 'p50_ms': round(ms[len(ms) // 2], 1), 'max_ms': round(ms[-1], 1),
            'calls': max(f['calls'] for f in fr), 'tris': max(f['tris'] for f in fr), 'dpr': sorted({f['dpr'] for f in fr})}

async def frames_after(pg, t0):
    return await pg.evaluate('(t0) => window.__frames.filter(f => f.t >= t0)', t0)

async def wait_frame(pg, t):
    await pg.wait_for_function('(t) => window.__frames.some(f => f.t >= t)', arg=t, timeout=300000, polling=20)

async def wait_idle(pg, ms=600):
    await pg.wait_for_function(f'() => {{ const f = window.__frames; return !f.length || performance.now() - (f[f.length-1].t + f[f.length-1].ms) > {ms}; }}', timeout=180000, polling=100)

R = {'label': LABEL}
def save(step):
    print(time.strftime('%H:%M:%S'), step, json.dumps(R.get(step, ''))[:300], flush=True)
    if OUT: open(OUT, 'w').write(json.dumps(R, indent=1))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        ctx = await b.new_context(viewport={'width': 1600, 'height': 1000})
        pg = await ctx.new_page()
        await pg.add_init_script(INIT)
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
        await cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 20, 'downloadThroughput': 50e6 / 8, 'uploadThroughput': 10e6 / 8})
        bytes_in = {'n': 0}
        cdp.on('Network.loadingFinished', lambda e: bytes_in.__setitem__('n', bytes_in['n'] + e.get('encodedDataLength', 0)))
        logs = []; pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}')); pg.on('pageerror', lambda e: logs.append(f'PAGEERROR {e}'))

        t_nav = time.time()
        await pg.goto(BASE, wait_until='load')
        R['page_load_s'] = round(time.time() - t_nav, 2)
        await pg.wait_for_function('window.app && window.app.viewer')
        await pg.evaluate(HOOK)
        R['bytes_at_load_MB'] = round(bytes_in['n'] / 1e6, 2)
        t0 = await pg.evaluate('performance.now()')
        await pg.evaluate(f'app.loadPath({json.dumps(ART)})')
        await pg.wait_for_function('(t0) => app.viewer.depth && window.__frames.some(f => f.t >= t0 && f.calls > 1)', arg=t0, timeout=300000, polling=50)
        first = await pg.evaluate('(t0) => { const f = window.__frames.find(f => f.t >= t0 && f.calls > 1); return f.t + f.ms - t0; }', t0)
        await pg.wait_for_function('app.traced !== null && !!app.traced.stats', timeout=300000)
        await pg.evaluate('app.ready()')
        await wait_idle(pg)
        t_tr = await pg.evaluate('(t0) => { const f = window.__frames; return f[f.length-1].t + f[f.length-1].ms - t0; }', t0)
        R['cold_open_to_first_3d_s'] = round(first / 1000, 2)
        R['cold_open_to_traced_3d_s'] = round(t_tr / 1000, 2)
        save('cold_open_to_traced_3d_s')
        R['bytes_total_MB'] = round(bytes_in['n'] / 1e6, 2)
        R['trace'] = await pg.evaluate('({paths: app.traced.stats.paths, nodes: app.traced.stats.nodes, min: app.traced.stats.estimate.time_min})')
        lt = await pg.evaluate('(t0) => window.__long.filter(l => l[0] >= t0)', t0)
        R['load_longtasks'] = {'count': len(lt), 'total_ms': round(sum(l[1] for l in lt)), 'max_ms': round(max([l[1] for l in lt] or [0]))}
        save('load_longtasks')
        await cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})

        await pg.evaluate("app.set({view:'angle'})"); await wait_idle(pg)
        t = await pg.evaluate('performance.now()')
        await pg.evaluate('app.viewer.requestRender ? app.viewer.requestRender(true) : (app.viewer.dirty = true)'); await wait_frame(pg, t); await wait_idle(pg)
        R['settled_frame'] = summ(await frames_after(pg, t))
        save('settled_frame')

        box = await pg.evaluate("(() => { const r = app.viewer.renderer.domElement.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()")
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        t = await pg.evaluate('performance.now()')
        await pg.mouse.move(cx, cy); await pg.mouse.down()
        t_drag = time.time()
        for i in range(24):
            await pg.mouse.move(cx + i * 10, cy + i * 2.5); await pg.wait_for_timeout(16)
        await pg.mouse.up(); drag_s = time.time() - t_drag
        t_up = await pg.evaluate('performance.now()')
        # stop the damping glide (SwiftShader frames of the old build take tens of seconds; 100 glide frames would never end)
        await pg.evaluate('app.viewer.controls.enableDamping = false')
        await wait_frame(pg, t); await wait_idle(pg, 1200)
        await pg.evaluate('app.viewer.controls.enableDamping = true')
        fr = await frames_after(pg, t)
        R['orbit'] = summ([f for f in fr if f['t'] < t_up]); R['orbit']['drag_wall_s'] = round(drag_s, 2)
        R['orbit_after_release'] = summ([f for f in fr if f['t'] >= t_up])
        save('orbit_after_release')

        async def change(js):
          try:
            return await change_(js)
          except Exception as e:
            return {'error': str(e).split('\n')[0][:160], 'console': logs[-4:]}
        async def change_(js):
            await wait_idle(pg)
            t = await pg.evaluate('performance.now()')
            await pg.evaluate(js)
            await pg.wait_for_function('(t) => window.__frames.some(f => f.t >= t)', arg=t, timeout=90000, polling=10)
            d = await pg.evaluate('(t) => { const f = window.__frames.find(f => f.t >= t); return [f.t + f.ms - t, f.ms]; }', t)
            await wait_idle(pg)
            lt = await pg.evaluate('(t0) => window.__long.filter(l => l[0] >= t0)', t)
            return {'to_frame_ms': round(d[0]), 'frame_ms': round(d[1]), 'longtask_max_ms': round(max([l[1] for l in lt] or [0]))}
        R['change'] = {}
        steps = [
            ('species_walnut', "app.set({material:{species:'walnut'}})"),
            ('finish_raw', "app.set({material:{finish:'raw'}})"),
            ('fill_epoxy_ocean', "app.set({material:{fill:'epoxy', fillPreset:'ocean'}})"),
            ('unsanded_overpour', "app.set({material:{sanded:false}})"),
            ('sanded_again', "app.set({material:{sanded:true}})"),
            ('fill_char', "app.set({material:{fill:'char'}})"),
            ('light_dir_slider', "(() => { const i = document.querySelector('.slider[data-k=az] input'); i.value = 140; i.dispatchEvent(new Event('input')); })()"),
        ]
        for name, js in steps:
            R['change'][name] = await change(js); print(time.strftime('%H:%M:%S'), name, R['change'][name], flush=True)
        save('change')
        await pg.evaluate("app.set({material:{fill:'none'}, light:{light:'studio'}})"); await wait_idle(pg)
        if await pg.evaluate("!!document.querySelector('.slider[data-k=\"threshold\"] input')"):   # trace builds: live retrace
            t = await pg.evaluate('performance.now()')
            await pg.evaluate("(() => { const i = document.querySelector('.slider[data-k=\"threshold\"] input'); i.value = 140; i.dispatchEvent(new Event('input')); })()")
            await pg.wait_for_timeout(300)
            await pg.wait_for_function("(t) => !document.querySelector('#busy:not(.hidden)') && app.traced && app.traced.params && String(app.traced.params.threshold) === '140'", arg=t, timeout=180000)
            key = 'threshold_slider'
        else:   # SVG showroom: a bake setting (bit angle) re-bakes the depth in the worker
            t = await pg.evaluate('performance.now()')
            await pg.evaluate("app.setBake({vbit_angle: 90})")
            key = 'rebake_vbit_angle'
        await wait_idle(pg)
        d = await pg.evaluate('(t) => { const f = window.__frames; return f[f.length-1].t + f[f.length-1].ms - t; }', t)
        lt = await pg.evaluate('(t0) => window.__long.filter(l => l[0] >= t0)', t)
        R[key] = {'to_frame_ms': round(d), 'longtasks': len(lt), 'longtask_total_ms': round(sum(l[1] for l in lt)), 'longtask_max_ms': round(max([l[1] for l in lt] or [0]))}
        if key == 'rebake_vbit_angle': R[key]['job'] = await pg.evaluate('({bake_ms: app.job.bake_ms, first_frame_ms: app.job.first_frame_ms, worker_ms: app.job.worker_ms})')
        save(key)
        R['gpu'] = await pg.evaluate(STATS)
        save('gpu')
        R['errors'] = [l for l in logs if 'error' in l.lower()][:8]
        await b.close()
    s = json.dumps(R, indent=1)
    print(s)
    if OUT: open(OUT, 'w').write(s)

asyncio.run(main())
