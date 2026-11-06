"""Smoke test: open the app headless, load every bundled sample and every fixture in tests/fixtures, and check each
one bakes (or is refused for the right reason) with the bit and depth read from the file. Fails on any page error.
usage: python3 tools/smoke.py [base url]   (default http://127.0.0.1:8766/ = `cd app && python3 -m http.server 8766`)
Needs: pip install playwright && playwright install chromium"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/'
BASE += ('&' if '?' in BASE else '?') + 'nosample&nosw'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures')

# fixture -> what the app must show. kinds: carve kinds read from the layers; set: carve settings (value, source)
EXPECT = {
    'vcarve-90deg-5mm.svg': {'kinds': ['vcarve'], 'set': {'vbit_angle': (90, 'file'), 'depth': (5, 'file')}, 'max_depth': 5},
    'engrave.svg': {'kinds': ['engrave'], 'set': {'engrave_depth': (1, 'file'), 'vbit_angle': (60, 'file')}},
    'pocket-3-levels.svg': {'kinds': ['level'], 'set': {'pocket_depth': (8, 'file')}, 'max_depth': 8},
    'vcarve-border.svg': {'kinds': ['vcarve'], 'set': {'depth': (3, 'file'), 'margin': (0, None)}},
    'profile-only.svg': {'error': 'Outline only'},
}

async def main():
    fails, logs = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800})
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        pg.on('console', lambda m: m.type == 'error' and logs.append(f'console.error: {m.text}'))
        await pg.goto(BASE)
        await pg.wait_for_function('window.app && app.viewer')
        samples = await pg.evaluate("fetch('samples/index.json').then(r => r.json())")
        for s in samples:
            await pg.evaluate('(p) => app.loadPath(p)', s['path'])
            r = await pg.evaluate("({name: app.job && app.job.name, stats: app.job && app.job.stats, src: {...app.carveSrc}})")
            ok = r['name'] == s['path'].split('/')[-1] and r['stats']['cut_pct'] > 0
            missing = [k for k in ('vbit_angle', 'depth') if r['src'].get(k) != 'file']
            if missing: ok = False
            print(('ok  ' if ok else 'FAIL'), s['path'], f"cut {r['stats']['cut_pct']}%", f"not in file: {missing}" if missing else '', flush=True)
            if not ok: fails.append(s['path'])
        for name, exp in EXPECT.items():
            text = open(os.path.join(FIX, name), encoding='utf-8').read()
            await pg.evaluate("() => { app.job = null; document.querySelector('#stageMsg').classList.add('hidden'); }")
            await pg.evaluate('([t, n]) => app.loadSvgText(t, n)', [text, name])
            r = await pg.evaluate("""() => ({ job: app.job && { name: app.job.name, kinds: app.job.kinds, stats: app.job.stats, set: app.job.settings },
                src: {...app.carveSrc}, err: document.querySelector('#stageMsg:not(.hidden) #smTitle')?.textContent || null })""")
            why = []
            if 'error' in exp:
                if not (r['err'] or '').startswith(exp['error']): why.append(f"expected error '{exp['error']}', got {r['err']!r}")
            elif not r['job'] or r['job']['name'] != name:
                why.append(f"did not bake (error: {r['err']!r})")
            else:
                if r['job']['kinds'] != exp['kinds']: why.append(f"kinds {r['job']['kinds']}")
                for k, (v, src) in exp['set'].items():
                    if r['job']['set'][k] != v: why.append(f'{k}={r["job"]["set"][k]} (want {v})')
                    if src and r['src'].get(k) != src: why.append(f'{k} source {r["src"].get(k)} (want {src})')
                if 'max_depth' in exp and abs(r['job']['stats']['max_depth_mm'] - exp['max_depth']) > 0.05:
                    why.append(f"max depth {r['job']['stats']['max_depth_mm']} (want {exp['max_depth']})")
            print(('ok  ' if not why else 'FAIL'), name, '; '.join(why), flush=True)
            if why: fails.append(name)
        await b.close()
    for l in logs: print(l[:400])
    if logs: fails.append('page errors')
    print('\nFAILED: ' + ', '.join(fails) if fails else '\nall ok')
    sys.exit(1 if fails else 0)

asyncio.run(main())
