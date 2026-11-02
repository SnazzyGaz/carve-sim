# 3D viewer performance notes

Gaz reported the 3D view as "very slow and laggy". These notes cover what Relief Forge does differently, where Carve Sim was losing time, what changed, and the measured before/after.

## How Relief Forge draws its 3D

The Relief Forge viewer (v207, three r160) keeps the GPU's per-frame work small and does the expensive work once:

- **One mesh, built once per height map.** CPU grid at 512–2048 (default 1024). Flat floor triangles get merged with an edge-aware split, so the triangle budget goes where the relief is.
- **Detail lives in textures, not geometry.** An object-space normal map (HalfFloat, up to 4096², mipmapped, anisotropic) carries the fine shape. A cavity texture carries the AO.
- **Material grain is pre-drawn.** It's painted once into a 1024² canvas texture (LRU cache of 12). There's no per-pixel noise in the shader.
- **Render on demand.** The rAF loop only draws when something is dirty.
  - The 4096² PCF shadow map has `autoUpdate = false` and is redrawn only when the light or mesh changes.
  - The environment (PMREM) rebuild is throttled to 90 ms.
- **No post-processing.** Antialias is on, pixel ratio is capped at 2, and shaders are warmed with `compileAsync`.

## Where Carve Sim was losing time (before, commit c86b277)

1. **Mesh rebuilt on the CPU for every depth change.** JS sampled the depth for every vertex, then ran `computeVertexNormals` over about 1.2 M verts at mesh 1024. This happened twice per slider change (preview, then trace), plus a separate CPU overpour mesh.
2. **Shadow map redrawn every frame.** 5.28 M triangles per frame, including the 4096² shadow pass.
3. **A very heavy fragment shader everywhere.** The solid-wood function costs about 13 simplex-noise calls and was inlined three times. The char cells ran 3×3 twice. All of it ran per pixel, per frame, for the top, the sides and the fill.
4. **Main-thread blur and half-float packing** of the depth texture.
5. **No draft mode while dragging.** Full DPR and full mesh all the time, plus `preserveDrawingBuffer`.
6. **13 MB `opencv.js` loaded and parsed eagerly** as a single 12 MB JS string before anything could trace.
7. Smaller items: a `backdrop-filter` on the busy pill, and fog/background reallocated on every lighting change.

## What changed

| Area | Now |
|---|---|
| Geometry | **GPU displacement, Forge-style but cheaper.** Static flat grids are cached per size, and the vertex shader displaces them from an RG half-float texture (r = depth, g = blurred mask). A depth change is a texture upload, not a mesh rebuild. The sides are a plain box, because the margin is never carved. The overpour is displaced in the same shader, with finite-difference normals in the fragment shader. Shadows use a matching `customDepthMaterial`. |
| Normals | The carve normal comes per pixel from the depth texture (relief mapping), so it's full-resolution even on the draft mesh. |
| Rendering | **On demand.** Frames are drawn only when dirty. Shadow `autoUpdate = false`, with a dirty flag for depth, light and grid changes. Bloom runs only for glow epoxy. `compileAsync` warm-up. |
| Interaction | **Draft while dragging.** DPR is capped at 1 and adapts down to 0.5 from the measured frame gaps, and the grid drops to half density (same vertex buffer, second index). A full-quality frame follows 160 ms after you stop. A shadow drawn in draft is redrawn at full detail. |
| Wood | **Baked.** The solid-wood shader runs once per texel into a mipmapped 4096-texel sRGB texture at the carved height (plus a second bake for the insert in inlay modes). It rebakes only when the carve, species or inlay mode changes. Finish, fill colour, glow, light and camera changes only touch uniforms. The finest fibre noise (about 9 cycles/mm) is still drawn live, so close-ups keep their tooth. Each part's program is compiled with only its own branch (`#define CARVE_PART`). |
| Sliders | View sliders call `interact()` (draft frames), and material changes are uniform-only. Trace sliders are already debounced through the worker queue. |
| Worker | The depth blur and half-float packing moved into the trace worker and are transferred as one buffer. |
| OpenCV | **Lazy, with a progress bar.** The wasm is split out of `opencv.js`: a 128 KB loader plus an 11.96 MB `opencv.wasm`, compiled with `WebAssembly.compileStreaming` while it downloads. The worker counts bytes through `body.tee()` for "Loading the tracer… N%". The page warms it at idle. It's the same binary, so the trace is unchanged. |
| GPU | `powerPreference: 'high-performance'`, so laptops with two GPUs use the dedicated one. `preserveDrawingBuffer` is gone; export renders and calls `toBlob` in the same task. |

## Numbers

Measured with `tools/perf.py` in headless Chromium on SwiftShader (a CPU software GPU, 1600×1000 window, canvas 968×869, DPR 1), with the old-fisherman sample, mesh 1024, and cold cache on emulated 50 Mbit/s with 20 ms latency.

**SwiftShader milliseconds are much slower than a real GPU.** Compare them build-to-build; don't read them as FPS. The triangle, draw-call and blocking-task counts carry over to real hardware.

| | Before (c86b277) | After | |
|---|---:|---:|---|
| Triangles per settled frame (incl. shadow pass) | 5,280,794 | 2,631,230 | −50 % |
| Triangles per frame while dragging | 5,280,794 | 658,964 | −88 % |
| Draw calls per frame | 5 | 3 | |
| Settled full-quality frame | 7.0 s | 2.1 s | 3.3× faster |
| Orbit drag frames (median / mean) | 7.29 s / 8.32 s | 0.58 s / 0.67 s | 12.5× faster |
| 24-step orbit drag, wall time | 565.8 s | 46.3 s | 12.2× faster |
| Change species | 7.9 s | 4.8 s (includes the rebake) | |
| Change finish | 7.4 s | 2.7 s | uniform-only |
| Move the light slider | 7.7 s | 0.76 s | draft frame |
| Unsanded overpour | 12.6 s | 4.6 s | |
| Char fill | 8.0 s | 3.0 s | |
| Glow epoxy (bloom) | 2.6 s | 0.97 s | |
| Threshold slider → traced frame | 14.4 s | 12.8 s | longest block 7.6 s → 4.3 s |
| Cold open → first 3D | 14.3 s | 11.1 s | |
| Cold open → traced 3D | 21.8 s | 15.4 s | |
| Main-thread long tasks during load | 4, 17.2 s total, max 9.2 s | 2, 10.1 s total, max 5.8 s | |
| OpenCV download (gzip) | 3.75 MB JS, parsed as script | 33 KB JS + 3.50 MB wasm, streamed | |

Notes:

- On SwiftShader the draft frame is still about half a second, because every pixel is shaded on the CPU. On a real dedicated GPU the same 0.66 M-triangle draft frame and 2.6 M-triangle full frame are well inside a 60 Hz budget. The old 5.3 M triangles every frame, plus three inlined wood shaders per pixel, were what made it feel laggy.
- GPU texture memory went from about 207 MB to about 287 MB, mainly the baked wood (4096 texels on the long side, sRGB8, mipmapped) plus a second bake for inlays. Vertex buffers went from 61 MB to 89 MB (cached grids). Both are fine on a dedicated card; it's the trade for not running the wood noise every frame.

## Parity

The trace output is unchanged: the same OpenCV binary and the same worker code path.

- **old-fisherman:** 292 paths, 6452 nodes, 39.0 min. 292/292 SVG paths are byte-identical to the Python reference (no-SIMD).
- **biomech-sculpture:** 1007 paths, 21775 nodes, 64.9 min (Python 1007 / 21774), the same as before.

## Visual check

All screenshots in `screens/` and `docs/` were re-shot with the new renderer. Side by side with the old ones (white-oak ocean close-up, overpour, inlay, char, glow), they match. The close-up keeps its fibre detail, because the finest fibre noise is still live.
