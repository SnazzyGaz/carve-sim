# Carve Sim (web)

Drop in black-and-white artwork (PNG/JPG) or an existing SVG, tune the trace live, check it against your bit, then see the carve in 3D in real wood, with epoxy, inlay or charred fills.

It all runs in your browser. There's no server, no install and no account, and nothing gets uploaded: the image-to-SVG trace (OpenCV + potrace) runs in a Web Worker on your own machine, and every library is bundled in `app/vendor/`, so it makes no CDN calls.

![Fisherman in ash, charred grooves](docs/fisherman-ash.jpg)

## Repo layout

```
app/                 the whole static site; this is what GitHub Pages publishes
  index.html         entry point (relative paths only, so it works from any sub-path)
  js/                UI, 3D viewer, shaders, engine.js (main thread) + carve-worker.js (trace engine)
  vendor/            opencv.js 5.0, potrace-core, three-lite (three.js r187 trimmed to what's used)
  samples/           sample artwork + index.json
desktop/             (future) Electron or Tauri wrapper for the Windows installer; loads app/ unchanged
tools/               build-vendor.mjs, parity and screenshot scripts (dev only, not deployed)
.github/workflows/   pages.yml: publishes app/ to GitHub Pages
```

Same pattern as Relief Forge: a static web app on GitHub Pages first, and later a Windows installer built from this repo by a thin desktop shell in `desktop/` that points at `app/index.html`. Nothing in `app/` assumes a site root, so it runs the same at `/`, at `/carve-sim/` on Pages, or inside a wrapper.

## Run it locally

Any static file server will do. The page uses a module Web Worker, so it won't run from a double-clicked `file://`.

```
cd app && python3 -m http.server 8766     # then open http://127.0.0.1:8766/
# or: npm run serve
```

## Deploy to GitHub Pages

1. Push the repo to GitHub.
2. In **Settings → Pages → Source**, choose **GitHub Actions**.
3. `.github/workflows/pages.yml` uploads `app/` as-is on every push to `main`. There's no build step, because the vendor files are committed.

## Rebuilding the vendor files

You only need this when upgrading a library:

```
npm install
npm run vendor      # node tools/build-vendor.mjs
```

This scans `app/js` for the `THREE.*` names in use and bundles only those, plus six addons (OrbitControls, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass, OutputPass), into `three-lite.min.js` (595 KB, 147 KB gzipped; the Python version vendors 17 MB of three.js). It also rebuilds `potrace-core.min.js` and copies `opencv.js`.

## How the trace matches the Python version

The engine (`app/js/carve-worker.js`) is a line-by-line port of the Python Carve Sim / `cnc_vector.py` pipeline:

- the same OpenCV version (5.0) and the same calls: resize, CLAHE, bilateral, threshold, morphology, connected components, distance transform
- potrace with a decomposition rewritten to follow potracer step for step
- the same path ordering
- the same estimate formulas
- the same warning texts
- Python's float formatting reproduced, so the SVGs come out byte for byte the same

It was checked against the Python engine on the samples (`tools/parity.py`):

| art | engine | paths | nodes | carve min | flags (removed/bridged/fragile) |
|---|---|---|---|---|---|
| fisherman | browser | 292 | 6452 | 39.0 | 104 / 50 / 915 |
| fisherman | Python, plain OpenCV | 292 | 6452 | 39.0 | 104 / 50 / 915 |
| fisherman | Python, default | 292 | 6452 | 39.0 | 104 / 54 / 916 |
| biomech | browser | 1007 | 21775 | 64.9 | 2168 / 2257 / 3364 |
| biomech | Python, plain OpenCV | 1007 | 21774 | 64.9 | 2168 / 2257 / 3364 |
| biomech | Python, default | 1013 | 21813 | 64.8 | 2155 / 2263 / 3346 |

The small gap against default Python comes from OpenCV itself. Desktop OpenCV uses AVX2 SIMD code in the cubic resize and the bilateral filter, and that rounds about ±1 grey level differently from plain C. The WebAssembly build uses plain C. With `cv2.setUseOptimized(False)`, Python gives the same mask as the browser to the pixel, and the fisherman SVG matches path for path. So the "reference" numbers also shift a little from one CPU to another. The single extra node on biomech is because Python traces each region in its own crop, while the browser traces the whole image at once.

## Licences

- **potrace** (the curve-fitting port in `vendor/potrace-core.min.js`) is GPL-2.0, so Carve Sim as distributed is GPL-2.0-or-later. See `app/vendor/POTRACE-LICENSE.txt`.
- **OpenCV.js** (`vendor/opencv.js`) is Apache-2.0.
- **three.js** (`vendor/three-lite.min.js`) is MIT.

## Known gaps

- `opencv.js` is the stock 13 MB build (3.7 MB gzipped, which is what Pages serves), not a custom minimal build. The first load takes a moment; after that it comes from the browser cache.
- SVGs that aren't already CNC output get rasterised on the main thread (3000 px longest side) before the trace, so their numbers can differ slightly from the Python version, which uses resvg.
- The canvas antialiasing in the 2D previews is a touch different from resvg's (IoU 0.99+).
- In the stats JSON export, whole numbers print as `300` instead of `300.0`.
- Pocket mode in 3D has flat floors and straight walls, with no end-mill corner radius. Bloom only shows for glow epoxy, and the pre-sand inlay plug is simplified.
- It needs a recent browser (Path2D and OffscreenCanvas in workers, CompressionStream): Chrome/Edge 80+, Firefox 105+, Safari 16.4+.
