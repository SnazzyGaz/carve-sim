# Carve Sim (web) · SVG showroom

Drop in a finished CNC SVG, such as one from the CNC vector skill (`cnc_vector.py`), and see it carved in 3D: V-carve, pockets, stepped pocket levels and engrave lines, in real wood, with epoxy, inlay or charred fills.

Import an SVG and the board appears within about 2 s. The SVG's physical size (mm or in) sets the board size, and its layer ids and metadata set the carve. Bit angle, depths and board size are import settings, and each change re-bakes once in a worker. The old image-to-SVG tracer (OpenCV + potrace) is still available as a collapsed side panel, "Trace an image instead". It loads only when you open it and outputs an SVG that goes straight into the showroom. See [docs/showroom.md](docs/showroom.md) for exactly how SVGs are interpreted.

It all runs in your browser. There's no server, no install and no account, and nothing gets uploaded. Every library is bundled in `app/vendor/`, so it makes no CDN calls, and a small service worker keeps the app, the samples and (once opened) the tracer working offline.

![Fisherman in ash, charred grooves](docs/fisherman-ash.jpg)

## Repo layout

```
app/                 the whole static site; this is what GitHub Pages publishes
  index.html         entry point (relative paths only, so it works from any sub-path)
  sw.js              offline cache (service worker; ?nosw bypasses it)
  js/                main.js (UI), viewer.js + shader.js + materials.js (3D), svg-import.js (SVG parsing),
                     svg-worker.js (SVG -> depth bake), bake-lib.js (shared EDT / texture helpers),
                     trace-panel.js + engine.js + carve-worker.js (the lazy image tracer)
  vendor/            three-lite (three.js r187 trimmed to what's used); opencv.js 5.0 + potrace-core (tracer only)
  samples/           sample SVGs (fisherman, eagle, 3-level wolf pocket, stag engrave) + the tracer's sample photo
desktop/             (future) Electron or Tauri wrapper for the Windows installer; loads app/ unchanged
tools/               build-vendor.mjs, parity and screenshot scripts (dev only, not deployed)
docs/pages-workflow.yml  optional Actions workflow to publish app/ (copy to .github/workflows/pages.yml)
```

Same pattern as Relief Forge: a static web app on GitHub Pages first, and later a Windows installer built from this repo by a thin desktop shell in `desktop/` that points at `app/index.html`. Nothing in `app/` assumes a site root, so it runs the same at `/`, at `/carve-sim/` on Pages, or inside a wrapper.

## Run it locally

Any static file server will do (`python3 tools/serve_gz.py app 8766` also serves gzip). The page uses Web Workers and a service worker, so it won't run from a double-clicked `file://`.

```
cd app && python3 -m http.server 8766     # then open http://127.0.0.1:8766/
# or: npm run serve
```

## Deploy to GitHub Pages

The live site is served from the `gh-pages` branch, which is just `app/` split out:

```
git subtree split --prefix app -b gh-pages && git push -f origin gh-pages
```

Or copy `docs/pages-workflow.yml` to `.github/workflows/pages.yml` and choose **GitHub Actions** in **Settings → Pages → Source**. There's no build step, because the vendor files are committed.

## Rebuilding the vendor files

You only need this when upgrading a library:

```
npm install
npm run vendor      # node tools/build-vendor.mjs
```

This scans `app/js` for the `THREE.*` names in use and bundles only those, plus six addons (OrbitControls, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass, OutputPass), into `three-lite.min.js` (595 KB, 147 KB gzipped; the Python version vendors 17 MB of three.js). It also rebuilds `potrace-core.min.js` and copies `opencv.js`.

## How the tracer matches the Python version

The tracer engine (`app/js/carve-worker.js`) is a line-by-line port of the Python Carve Sim / `cnc_vector.py` pipeline:

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

## Performance

The 3D view displaces a static grid on the GPU from the depth texture, bakes the wood into a texture, only redraws when something changes, and drops to a draft mesh and lower resolution while you drag. See [docs/perf-notes.md](docs/perf-notes.md) for how this compares with Relief Forge and for the before/after numbers.

## Licences

- **potrace** (the curve-fitting port in `vendor/potrace-core.min.js`) is GPL-2.0, so Carve Sim as distributed is GPL-2.0-or-later. See `app/vendor/POTRACE-LICENSE.txt`.
- **OpenCV.js** (`vendor/opencv.js`) is Apache-2.0.
- **three.js** (`vendor/three-lite.min.js`) is MIT.

## Known gaps

- Showroom depth is a model of the carve, not a toolpath simulation: the V-carve uses the exact distance to the nearest path edge, computed from the SVG geometry (an ideal V-bit with a depth limit), so sharp inside corners come out perfectly sharp; pockets have no end-mill corner radius; no clearing tool or step-over is modelled. The texture is 2048 texels on the long side (≈0.15 mm/texel at 300 mm), so detail finer than that (and strokes under ~0.3 mm) is averaged away. Outlines and walls themselves are exact to the path (signed distance field, see docs/showroom.md), not stepped at the texel or mesh grid.
- Generic (non-CNC) SVGs are drawn by the browser on the main thread and thresholded at mid-grey: colours carve by brightness, and anti-aliased or semi-transparent art can carve a little differently from what the CAM software would make of the paths.
- A px/unitless SVG has no physical size, so it is shown 300 mm wide (the Job panel says so); give the file a mm/in `width` to set the real size. The showroom has no carve controls: bit, depths and size come from the file, with fixed defaults where it is silent.
- OpenCV (tracer only) is the stock build (kept whole so the trace stays byte-identical), split into a 128 KB loader and an 11.96 MB `opencv.wasm` (3.5 MB gzipped). It is not loaded until the trace panel is opened.
- The baked wood texture is 4096 texels on the board's long side, about 12 texels/mm on a 300 mm piece. On very large boards it gets softer in extreme close-ups (the live fibre noise hides most of it). The board's edges still use the live wood shader.
- The tracer's canvas antialiasing in its 2D previews is a touch different from resvg's (IoU 0.99+).
- Bloom only shows for glow epoxy (kept tight to the lit resin: high threshold, the two finest blur levels only), and the pre-sand inlay plug is simplified.
- It needs a recent browser (Path2D and OffscreenCanvas in workers, CompressionStream): Chrome/Edge 80+, Firefox 105+, Safari 16.4+.
