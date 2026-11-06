"""Headless renders of the app (Playwright + Chromium with GPU-less WebGL via SwiftShader/ANGLE).
usage: python3 tools/shoot.py <art path relative to the app, e.g. samples/old-fisherman.svg (an image goes through the tracer)> <out dir> '<json list of shots>' [base url]
(default base url http://127.0.0.1:8766/ = `python3 -m http.server 8766` in app/)
shot: {"name":..., "bake":{carve/vbit_angle/depth/width_mm...}, "material":{...}, "light":{...}, "view":"angle"|..., "close":[u,v], "ui":true}
"""
import json, sys, time, asyncio
BASE = sys.argv[4] if len(sys.argv) > 4 else 'http://127.0.0.1:8766/'
from playwright.async_api import async_playwright
if '?' not in BASE: BASE += '?nosample&nosw'

async def main(art, outdir, shots, w=1600, h=1000):
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(BASE)
        await pg.wait_for_function('window.app && window.app.viewer')
        t = time.time()
        await pg.evaluate(f'app.loadPath({json.dumps(art)})')
        await pg.wait_for_function('!!app.job', timeout=180000)
        await pg.evaluate('app.ready()')
        print('loaded+traced in', round(time.time() - t, 1), 's', flush=True)
        for s in shots:
            if s.get('bake'):
                await pg.evaluate(f'app.setBake({json.dumps(s["bake"])})')
            await pg.evaluate(f'app.set({json.dumps({k: s[k] for k in ("material", "light", "view", "close") if k in s})})')
            if s.get('tab'):
                await pg.click(f'.tabs>button[data-tab="{s["tab"]}"]')
            await pg.wait_for_timeout(s.get('wait', 2500))
            path = f'{outdir}/{s["name"]}.png'
            if s.get('ui', False):
                await pg.screenshot(path=path)
            else:
                data = await pg.evaluate('''async (sc) => { const b = await app.viewer.exportPNG(sc); const r = new FileReader();
                    return await new Promise(res => { r.onload = () => res(r.result); r.readAsDataURL(b); }); }''', s.get('scale', 1))
                import base64; open(path, 'wb').write(base64.b64decode(data.split(',')[1]))
            if s.get('tab'):
                await pg.click('.tabs>button[data-tab="3d"]')
            print('shot', path, flush=True)
        res = await pg.evaluate('app.job && app.job.stats')
        print(json.dumps(res))
        seen = set()
        for l in logs:
            k = l[:120]
            if ('error' in l.lower() or 'warn' in l.lower()) and k not in seen: seen.add(k); print(l[:3000])
        await b.close()

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2], json.loads(sys.argv[3])))
