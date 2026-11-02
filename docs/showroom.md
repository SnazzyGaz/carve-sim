# SVG showroom

![The showroom: old-fisherman.svg as a 300 mm V-carve in hard maple](showroom-fisherman.jpg)

Carve Sim is now a showroom for finished SVGs, such as the ones the CNC vector skill (`cnc_vector.py`) produces. You import an SVG and it shows you how the carve will look in real wood, finishes and fills. The image-to-SVG tracer is still there, as a collapsed side panel ("Trace an image instead").

## Flow

1. **Import.** Use the drop zone, the file picker, or paste (Ctrl+V with SVG text or an .svg file). Bundled samples are in the list below the drop zone. The first visit opens the old fisherman sample (add `?nosample` to skip it).
2. **Parse** (main thread, `js/svg-import.js`). This reads the physical size, the layers and the metadata, and turns every shape into path data plus its transform.
3. **Bake** (worker, `js/svg-worker.js`). The paths are rasterised once with Path2D at 2× the texture size (4096 px on the long side), then turned into a depth map:
   - **V-carve**: an exact Euclidean distance field (Felzenszwalb) inside the shape gives `depth = min(dist / tan(angle/2), max depth)`. Narrow parts run shallow and wide parts flat-bottom at the max depth, just like a V-bit with a depth limit.
   - **Pocket**: a flat floor at the pocket depth, with straight walls.
   - **Pocket levels** (`pocket_level_1..N`): level *i* sits at `pocket depth × i / N`.
   - **Engrave**: a V-groove along the stroke centreline (`engrave depth − dist / tan(angle/2)`).
   - The result is then 2×2 area-averaged down to the 2048 texture, which gives the viewer's RG half-float depth and AO textures.
   - The masks and distance fields are cached per file, so a change to the bit angle, depth or carve type only redoes the cheap remap (about 0.1 s of math). A change to the board size re-bakes from those caches.
4. **3D.** This is the materials-v2 viewer, unchanged: species, finishes, fills, lighting, the Forge orbit and sway, and the A/B look compare.

The import settings (carve type, bit angle, depths, board width, margin and thickness) apply when you release a slider, not while you drag it. Each change triggers one bake in the worker, with a progress bar. Margin and thickness only rebuild the board, with no re-bake.

## How SVGs are interpreted

| What | Rule |
|---|---|
| Size | `width`/`height` in mm, cm, in, pt or pc set the board's art width. A px or unitless size has no physical meaning, so it falls back to **300 mm** wide (aspect taken from the viewBox). The Job panel shows where the size came from, and the **Board width** slider overrides it. |
| CNC file? | A file counts as CNC output if it has a known layer id, or a `CNC vector` comment, or if every shape has `fill="none"` (outline-style output). |
| Layer ids (on `<g>`; `inkscape:label` or `data-layer` also work, case-insensitive) | `vcarve*` → V-carve · `pocket*` → pocket · `pocket_level_N` → stepped pocket level N of the highest N · `engrave*` / `centerline` → engrave groove along the stroke · `profile*` / `cutout` / `border` → the board's cut-out line (it is not carved, and the margin goes to 0) |
| Shapes | path, rect, circle, ellipse, polygon, polyline and line, including nested transforms. Anything inside defs, clipPath, mask, symbol, pattern or marker is ignored. |
| Fill vs stroke | In CNC layers, each closed path is a region filled with the even-odd rule, so the skill's outer and inner contours make holes. Engrave layers use the stroke centreline, rasterised at 1.2 px. |
| Unlabelled outline groups | These take the file's `mode=` (pocket, engrave or vcarve). With no mode, they are V-carved. |
| Metadata | Read from the `CNC vector` comment or `<metadata>`: `mode=`, `tool=…mm`, `min_feature=`, `depth=`, `vbit=`/`angle=`. Root attributes also work: `data-mode`, `data-depth`, `data-pocket-depth`, `data-engrave-depth`, `data-vbit-angle`. When the file names a value, that value wins. Otherwise the current settings carry over (defaults: 60° bit, 3 mm V-carve limit, 6 mm pocket, 1 mm engrave). |
| Generic artwork (filled shapes, no CNC layers, e.g. a logo from Illustrator) | The browser draws it once at the bake size, and anything darker than mid-grey is cut. That way CSS, text, gradients and knock-outs all come out as drawn. The cut type defaults to V-carve, and the **Carve type** menu can switch it to pocket. |
| Carve type | **From the file** keeps each layer's own type. Choosing V-carve or pocket forces every region layer to that type, while engrave layers stay grooves. |

## Trace an image instead

This is the old OpenCV + potrace engine (`engine.js` / `carve-worker.js`), unchanged, in a collapsed `<details>` panel. Its code (`trace-panel.js`, the engine, the worker and the 12 MB OpenCV wasm) loads only the first time you open the panel. It is now a one-off bake rather than live sliders:

- Choose an image type (Clean line art / Bold stencil / Photo / Fine detail), V-carve or pocket, and Invert.
- Press **Trace**. It runs once in the worker, and the resulting SVG goes into the normal showroom import.
- **Download SVG** saves that SVG.

## Offline

Every dependency is self-hosted in `app/vendor` (three-lite, opencv.js and opencv.wasm, potrace), there are no web fonts, and nothing is fetched from a CDN. A small service worker (`sw.js`) works like this:

- On install, it precaches the app shell and the sample SVGs (about 0.5 MB gzipped, plus three-lite).
- It caches everything else the first time it is fetched, including the tracer and OpenCV once the panel has been opened.
- Code is network-first, so updates show up straight away when you are online. vendor/ and samples/ are cache-first.
- Add `?nosw` to bypass the service worker.

To test it, load the page, open the tracer once, set the context offline and reload. The page, all four samples and a full trace still work (tested with Playwright and `context.set_offline(true)`).

## Exports

- **PNG** (header): renders the current view at 1–4× the canvas size. It is clamped to the GPU's max renderbuffer size and 16384 px.
- **Download SVG** (trace panel): the traced SVG.
