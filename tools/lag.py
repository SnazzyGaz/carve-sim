"""Where does the 3D viewer's lag come from? Per-source probe, run against two builds on the same box.
usage: [ART=samples/x.svg] python3 tools/lag.py <base url> <label> [out.json]
Headless Chromium + SwiftShader (CPU WebGL): absolute ms are much slower than a real GPU; compare builds, not FPS.
Probes: slider drags (brightness, light direction), orbit drag, species switch (wood bake), finish switch,
fill switches."""
import asyncio, json, sys, time
from playwright.async_api import async_playwright
BASE, LABEL = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else None
import os
ART = os.environ.get('ART', 'samples/old-fisherman.svg')   # ART=samples/old-fisherman.jpg for builds before the SVG showroom
if '?' not in BASE: BASE += '?nosample&nosw'   # tests start from an empty board and bypass the offline cache
HOOK = r'''() => {
  const v = app.viewer, r = v.renderer, gl = r.getContext(); window.__f = []; r.info.autoReset = false; const px = new Uint8Array(4);
  const orig = v.render.bind(v);
  const sm = r.shadowMap, sr = sm.render.bind(sm); let shN = 0;
  sm.render = function (...a) { if (sm.needsUpdate) shN++; return sr(...a); };   // counts real shadow-map redraws
  v.render = function (...a) { r.info.reset(); const s0 = shN, b0 = v.bakes || 0; const t = performance.now(); orig(...a);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    window.__f.push({ t, ms: performance.now() - t, sh: shN > s0, bk: (v.bakes || 0) - b0, q: v.quality || 'full', calls: r.info.render.calls }); };
  if (v.bakeStep) { const bs = v.bakeStep.bind(v); v.bakeStep = function (...a) { const t = performance.now(); const x = bs(...a); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); window.__f.push({ t, ms: performance.now() - t, bake: 1 }); return x; }; }
  window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask' });
}'''
R = {'label': LABEL}
def save(k):
    print(time.strftime('%H:%M:%S'), k, json.dumps(R.get(k))[:400], flush=True)
    if OUT: open(OUT, 'w').write(json.dumps(R, indent=1))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        pg = await b.new_page(viewport={'width': 1200, 'height': 760})
        logs = []; pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}')); pg.on('pageerror', lambda e: logs.append(f'PAGEERROR {e}'))
        await pg.goto(BASE); await pg.wait_for_function('window.app && window.app.viewer')
        await pg.evaluate(f'app.loadPath({json.dumps(ART)})')
        await pg.wait_for_function('app.job || (app.traced && app.traced.stats)', timeout=400000); await pg.evaluate('app.ready()')
        await pg.evaluate("app.set({view:'angle', light:{light:'studio'}, material:{species:'white_oak', finish:'oil', fill:'none', sanded:true}})")
        await pg.evaluate(HOOK)
        async def idle(ms=900):
            await pg.wait_for_function(f'''() => {{ const f = window.__f, v = app.viewer; if (v.bakePending && v.bakePending()) return false;
              return !f.length || performance.now() - (f[f.length-1].t + f[f.length-1].ms) > {ms}; }}''', timeout=400000, polling=100)
        async def measure(fn):
            await idle(); t = await pg.evaluate('performance.now()'); w = time.time()
            await fn()
            t_in = await pg.evaluate('performance.now()'); w_in = time.time() - w
            # wait for the change's first frame (or 3 s with none) before waiting for quiet, so no probe ends early
            await pg.wait_for_function('(t) => window.__f.some(f => f.t >= t) || performance.now() - t > 3000', arg=t, timeout=400000, polling=50)
            await idle(); t_end = await pg.evaluate('performance.now()')
            fr = await pg.evaluate('(t) => window.__f.filter(f => f.t >= t)', t)
            lt = await pg.evaluate('(t) => window.__long.filter(l => l[0] >= t)', t)
            during = [f for f in fr if f['t'] < t_in and not f.get('bake')]
            frames = [f for f in fr if not f.get('bake')]; bakes = [f for f in fr if f.get('bake')]
            ms = sorted(f['ms'] for f in during) or [0]
            last_full = max([f['t'] + f['ms'] for f in frames if f['q'] == 'full'] or [t])
            return {'input_wall_s': round(w_in, 2), 'frames_during': len(during), 'during_mean_ms': round(sum(ms) / len(ms)),
                    'during_max_ms': round(ms[-1]), 'shadow_redraws': sum(1 for f in frames if f['sh']),
                    'bakes_inside_frames': sum(f.get('bk', 0) for f in frames),
                    'first_frame_ms': round(frames[0]['t'] + frames[0]['ms'] - t) if frames else None,
                    'first_frame_cost_ms': round(frames[0]['ms']) if frames else None,
                    'to_settled_ms': round(last_full - t), 'bake_strips': len(bakes), 'bake_strip_max_ms': round(max([f['ms'] for f in bakes] or [0])),
                    'longtask_max_ms': round(max([l[1] for l in lt] or [0])), 'longtask_total_ms': round(sum(l[1] for l in lt))}
        async def drag_slider(k, vals):
            async def f():
                for v in vals:
                    await pg.evaluate(f"(() => {{ const i = document.querySelector('.slider[data-k={k}] input'); if (!i) return; i.value = {v}; i.dispatchEvent(new Event('input')); }})()")
                    await pg.wait_for_timeout(40)
            return f
        R['slider'] = {}
        for k, vals in [('bright', [1.05 + 0.03 * i for i in range(6)]), ('az', [210 - 4 * i for i in range(6)])]:
            R['slider'][k] = await measure(await drag_slider(k, vals)); save('slider')
        await pg.evaluate("app.set({light:{light:'studio'}})")
        box = await pg.evaluate("(() => { const r = app.viewer.renderer.domElement.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()")
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        async def orbit():
            await pg.evaluate('app.viewer.controls.enableDamping = false')
            await pg.mouse.move(cx, cy); await pg.mouse.down()
            for i in range(16): await pg.mouse.move(cx + i * 12, cy + i * 3); await pg.wait_for_timeout(16)
            await pg.mouse.up()
        R['orbit'] = await measure(orbit); save('orbit')
        await pg.evaluate('app.viewer.controls.enableDamping = true')
        R['switch'] = {}
        for name, js in [('species_walnut', "app.set({material:{species:'walnut'}})"), ('species_oak', "app.set({material:{species:'white_oak'}})"),
                         ('finish_raw', "app.set({material:{finish:'raw'}})"),
                         ('fill_epoxy_clear', "app.set({material:{fill:'epoxy', fillPreset:'clear'}})"),
                         ('fill_metal_gold', "app.set({material:{fillPreset:'gold'}})"),
                         ('fill_inlay', "app.set({material:{fill:'inlay', insert:'walnut'}})")]:
            async def f(js=js): await pg.evaluate(js)
            R['switch'][name] = await measure(f); save('switch')
        # as-poured epoxy (materials v2 look pass): level / meniscus are uniforms, flood swaps the pour grid; absent in old builds
        has = await pg.evaluate("!!document.querySelector('.slider[data-k=fillLevel]')")
        if has:
            R['pour'] = {}
            async def f(): await pg.evaluate("app.set({material:{fill:'epoxy', fillPreset:'clear', sanded:false, fillLevel:0, flood:false}})")
            R['pour']['pour_first'] = await measure(f); save('pour')
            R['pour']['level_slider'] = await measure(await drag_slider('fillLevel', [-0.2 - 0.12 * i for i in range(6)])); save('pour')
            R['pour']['menisc_slider'] = await measure(await drag_slider('menisc', [0.4 + 0.1 * i for i in range(6)])); save('pour')
            async def f(): await pg.evaluate("app.set({material:{flood:true, fillLevel:0.8}})")
            R['pour']['flood_on'] = await measure(f); save('pour')
            R['pour']['level_slider_flood'] = await measure(await drag_slider('fillLevel', [0.5 + 0.1 * i for i in range(6)])); save('pour')
        if await pg.evaluate("typeof app.viewer.setSway === 'function'"):
            # Sway turntable: board turns about y with a shadow redraw per frame; mean frame gap over 3 s at full quality
            R['sway_frame_ms'] = await pg.evaluate("""new Promise((res) => { const v = app.viewer, r0 = v.render.bind(v); let n = 0, t0 = 0;
              v.render = () => { r0(); n++; if (!t0) t0 = performance.now(); }; v.setSway(true);
              setTimeout(() => { v.setSway(false); v.render = r0; res(n > 1 ? (performance.now() - t0) / (n - 1) : null); }, 3000); })"""); save('sway_frame_ms')
        R['errors'] = [l for l in logs if 'error' in l.lower()][:8]
        await b.close()
    print(json.dumps(R, indent=1))
    if OUT: open(OUT, 'w').write(json.dumps(R, indent=1))
asyncio.run(main())
