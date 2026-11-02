"""Dump the decoded source pixels and masks the browser engine produces (for diffing against Python)."""
import sys, asyncio, base64, json, numpy as np
from playwright.async_api import async_playwright
BASE = 'http://127.0.0.1:8766/'
async def main(sample, out):
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto(BASE); await pg.wait_for_function('window.app && window.app.engine'); await pg.evaluate('app.engine.ready')
        r = await pg.evaluate('''async (s) => { const e = app.engine; const blob = await (await fetch(s)).blob();
            const info = await e.load(blob, s.split('/').pop()); const d = await e._call({type:'debugMask', id: info.id, params: {}});
            const enc = (u8) => { let s=''; for (let i=0;i<u8.length;i+=8192) s += String.fromCharCode.apply(null, u8.subarray(i,i+8192)); return btoa(s); };
            return {w:d.w,h:d.h,sw:d.sw,sh:d.sh,raw:enc(d.raw),safe:enc(d.safe),rgba:enc(new Uint8Array(d.rgba.buffer||d.rgba))}; }''', sample)
        np.savez(out, raw=np.frombuffer(base64.b64decode(r['raw']), np.uint8).reshape(r['h'], r['w']),
                 safe=np.frombuffer(base64.b64decode(r['safe']), np.uint8).reshape(r['h'], r['w']),
                 rgba=np.frombuffer(base64.b64decode(r['rgba']), np.uint8).reshape(r['sh'], r['sw'], 4))
        await b.close()
asyncio.run(main(sys.argv[1], sys.argv[2]))
