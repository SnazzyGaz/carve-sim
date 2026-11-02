"""Run the static app headless and compare its numbers with the Python reference.
usage: python3 tools/verify.py [base_url] [outdir]
Loads each sample, waits for the full trace, saves the SVG / stats / preview it produced, and
prints them next to the reference stats (tests/ref/*.json, written by the Python version)."""
import json, sys, time, asyncio, base64, os
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/csweb-verify'
SAMPLES = ['samples/old-fisherman.jpg', 'samples/biomech-sculpture.jpg']

async def fetch_blob(pg, url):
    data = await pg.evaluate('''async (u) => { const b = await (await fetch(u)).blob(); const r = new FileReader();
        return await new Promise(res => { r.onload = () => res(r.result); r.readAsDataURL(b); }); }''', url)
    return base64.b64decode(data.split(',')[1])

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1400, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(BASE)
        await pg.wait_for_function('window.app && window.app.engine')
        t = time.time(); await pg.evaluate('app.engine.ready'); print('opencv ready in', round(time.time() - t, 2), 's')
        for s in SAMPLES:
            name = os.path.basename(s).rsplit('.', 1)[0]
            t = time.time()
            await pg.evaluate(f'app.loadPath({json.dumps(s)})')
            await pg.wait_for_function('app.traced !== null && !document.querySelector("#busy:not(.hidden)")', timeout=300000)
            r = await pg.evaluate('({stats: app.traced.stats, flags: app.traced.flags, warnings: app.traced.warnings, timing: app.traced.timing_s, wall: app.traced.wall_ms, urls: app.traced.urls, svg: app.traced.svg})')
            print(f'{name}: loaded + quick + traced in {time.time() - t:.1f}s (trace call {r["wall"]} ms, worker timing {r["timing"]})')
            open(f'{OUT}/{name}.svg', 'w').write(r['svg'])
            open(f'{OUT}/{name}_preview.png', 'wb').write(await fetch_blob(pg, r['urls']['preview']))
            json.dump({k: r[k] for k in ('stats', 'flags', 'warnings', 'timing')}, open(f'{OUT}/{name}_stats.json', 'w'), indent=1)
            await pg.evaluate('app.traced = null')
        for l in logs:
            if 'error' in l.lower() or 'warn' in l.lower(): print('  log', l[:300])
        await b.close()

asyncio.run(main())
