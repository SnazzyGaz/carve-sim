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

## Materials v2 (branch `materials-v2`): lag pass

Gaz reported the 3D view still felt laggy. `tools/lag.py` probes each lag source on its own. Both builds ran **at the same time** on the same box, so they shared the same CPU load:

- before: worktree at 3986014 on :8770
- after: the materials-v2 working tree on :8771

The setup was headless Chromium on SwiftShader. perf.py used a 1600×1000 window and lag.py a 1200×760 one. The box was also running an unrelated process at 2–5 cores, so the absolute milliseconds are noisy (±30 % between runs). The triangle counts, shadow redraw counts and bake counts are exact.

Causes found and fixed:

1. **Full frames were triangle-bound.** The 1024 grid gave 2.6 M triangles per settled frame, about 0.1 px² each when the whole board is on screen. On a real GPU that means 2×2-quad overshading of a heavy fragment shader. → LOD grid: quads ≥ 1.5 screen px, coarsened by up to 4×, re-picked once the view settles. That's 0.66 M full / 0.16 M draft.
2. **Every light slider redrew the 4096² shadow map** (7 redraws per 6-step drag). → Only azimuth and elevation do now.
3. **A species, inlay or threshold change baked the 4096 wood in one frame** (25–49 s single frame on SwiftShader). → A 1024 preview bake, then 16 strips on idle frames.
4. **PMREM env rebuilds** happen only on az/el changes, and are deferred out of drags.

| Probe | Before (3986014) | After (materials-v2) | |
|---|---:|---:|---|
| Triangles, settled full frame (incl. shadow pass) | 2,631,230 | 656,670 | |
| Triangles, drag frame | 658,964 | 164,750 | |
| Settled full-quality frame | 18.2 s | 6.2 s | 2.9× faster |
| Orbit drag frame (p50) | 4.0 s | 1.8 s | 2.3× faster |
| Orbit drag frame (mean) | 4.5 s | 1.8 s | 2.5× faster |
| Full frame after releasing orbit | 8.1 s | 3.3 s | 2.5× faster |
| Slider drag "exposure": frame while dragging (mean) | 6.8 s | 1.8 s | 3.7× faster · shadow redraws 7 → 0 |
| Slider drag "exposure": longest blocking task | 10.0 s | 6.8 s | 1.5× faster |
| Slider drag "env": frame while dragging (mean) | 1.0 s | 2.2 s | 2.2× slower · shadow redraws 7 → 0 |
| Slider drag "env": longest blocking task | 4.7 s | 8.5 s | 1.8× slower |
| Slider drag "key": frame while dragging (mean) | 1.4 s | 1.5 s | 1.1× slower · shadow redraws 7 → 0 |
| Slider drag "key": longest blocking task | 9.2 s | 5.4 s | 1.7× faster |
| Slider drag "az": frame while dragging (mean) | 2.7 s | 1.4 s | 2.0× faster · shadow redraws 7 → 7 |
| Slider drag "az": longest blocking task | 18.5 s | 2.3 s | 8.1× faster |
| Orbit drag (lag probe): frame mean | 8.2 s | 409 ms | 20.1× faster |
| Switch species_walnut: to first frame | 45.7 s | 1.6 s | 28.9× faster · bake: 1 in-frame; after: preview + 16 idle strips (max 734 ms) |
| Switch species_walnut: longest blocking task | 45.7 s | 1.7 s | 27.6× faster |
| Switch species_oak: to first frame | 49.1 s | 1.9 s | 25.7× faster · bake: 1 in-frame; after: preview + 16 idle strips (max 763 ms) |
| Switch species_oak: longest blocking task | 49.1 s | 5.4 s | 9.1× faster |
| Switch finish_gloss: to first frame | 33.8 s | 2.3 s | 14.8× faster |
| Switch finish_gloss: longest blocking task | 33.8 s | 2.3 s | 14.8× faster |
| Switch fill_epoxy_clear: to first frame | 269 ms | 313 ms | 1.2× slower |
| Switch fill_epoxy_clear: longest blocking task | 269 ms | 309 ms | 1.1× slower |
| Switch fill_metal_gold: to first frame | 189 ms | 237 ms | 1.3× slower |
| Switch fill_metal_gold: longest blocking task | 172 ms | 235 ms | 1.4× slower |
| Switch fill_inlay: to first frame | 4.3 s | 458 ms | 9.3× faster · bake: 1 in-frame; after: preview + 16 idle strips (max 800 ms) |
| Switch fill_inlay: longest blocking task | 4.3 s | 800 ms | 5.3× faster |
| Switch fill_glow_first: to first frame | 1.2 s | 1.3 s | 1.1× slower |
| Switch fill_glow_first: longest blocking task | 1.2 s | 1.3 s | 1.1× slower |
| Switch glow_settled_frame: to first frame | 358 ms | 366 ms | same |
| Switch glow_settled_frame: longest blocking task | 357 ms | 343 ms | same |
| Switch glow_off: to first frame | 25.0 s | 1.9 s | 13.5× faster |
| Switch glow_off: longest blocking task | 25.0 s | 1.9 s | 13.5× faster |
| Switch nobloom_settled_frame: to first frame | 41.3 s | 2.5 s | 16.3× faster |
| Switch nobloom_settled_frame: longest blocking task | 41.3 s | 2.5 s | 16.3× faster |
| perf.py change species_walnut | 19.8 s | 4.1 s | 4.9× faster |
| perf.py change finish_gloss | 22.9 s | 7.3 s | 3.1× faster |
| perf.py change fill_epoxy_ocean | 422 ms | 426 ms | same |
| perf.py change unsanded_overpour | 14.5 s | 12.8 s | 1.1× faster |
| perf.py change sanded_again | 222 ms | 704 ms | 3.2× slower |
| perf.py change fill_char | 2.8 s | 5.2 s | 1.8× slower |
| perf.py change light_dir_slider | 822 ms | 2.0 s | 2.4× slower |
| perf.py change fill_glow_bloom | 1.4 s | 3.2 s | 2.3× slower |
| Threshold slider → traced frame | 77.5 s | 24.0 s | 3.2× faster · longest task 38.8 s → 8.8 s |
| Cold open → first 3D | 29.9 s | 19.4 s | 1.5× faster |
| Cold open → traced 3D | 57.5 s | 33.3 s | 1.7× faster |
| Load: longest main-thread task | 27.5 s | 11.5 s | 2.4× faster |
| GPU textures / buffers | 287.4 / 88.8 MB | 301.4 / 22.2 MB | |
| Console errors | 0 | 0 | |


Notes:
- An earlier lag JSON pair suggested the new build was "6× slower" (exposure 34 s vs 5.3 s). That came from mislabelled servers. Port 8766 served the *new* working tree, and 8767 served an older copy in /tmp/cs-before. The numbers above come from servers I started and checked myself.
- A few small items are within noise or slightly slower:
  - fill switches: +40–60 ms
  - first glow switch: +0.1 s, a one-off for compiling the bloom programs
  - the perf.py tail items (char, glow, light direction, sanded): in that run the before process ran its tail alone after the after process had finished, so it had less load
- GPU texture memory went up by 14 MB (the AO texture and the 1024 preview bake). Vertex buffers went down from 89 MB to 22 MB.


## Second commit: look pass, Forge lighting, pour controls, Forge camera — quick re-check

The box was quiet this time (only the unrelated process, at about 2 cores). perf.py ran on the before build (3986014, :8770) and then on the after build (:8771) back to back, so these two columns are directly comparable, and they're far less loaded than the table above. The new pour and sway probes come from lag.py on the after build only.

| Probe | Before (3986014) | After (materials-v2) | |
|---|---:|---:|---|
| Triangles, settled full frame (incl. shadow pass) | 2,631,230 | 656,670 | |
| Triangles, drag frame | 658,964 | 164,750 | |
| Settled full-quality frame | 3.2 s | 1.1 s | 2.9× faster |
| Orbit drag frame (p50) | 689 ms | 330 ms | 2.1× faster |
| Orbit drag frame (mean) | 834 ms | 362 ms | 2.3× faster |
| Full frame after releasing orbit | 1.5 s | 554 ms | 2.6× faster |
| perf.py change species_walnut | 5.6 s | 1.3 s | 4.3× faster |
| perf.py change finish_gloss | 2.9 s | 1.3 s | 2.3× faster |
| perf.py change fill_epoxy_ocean | 226 ms | 239 ms | 1.1× slower |
| perf.py change unsanded_overpour | 5.5 s | 2.8 s | 1.9× faster |
| perf.py change sanded_again | 238 ms | 241 ms | same |
| perf.py change fill_char | 3.2 s | 1.4 s | 2.3× faster |
| perf.py change light_dir_slider | 895 ms | 398 ms | 2.2× faster |
| perf.py change fill_glow_bloom | 1.2 s | 1.8 s | 1.4× slower |
| Threshold slider → traced frame | 13.6 s | 13.5 s | same · longest task 5.8 s → 3.6 s |
| Pour (new) pour_first: to first frame | — | 2.5 s | new · shadow redraws 1, longest task 2.4 s |
| Pour (new) level_slider: frame while dragging (mean) | — | 572 ms | new · shadow redraws 7, longest task 2.4 s |
| Pour (new) menisc_slider: frame while dragging (mean) | — | 590 ms | new · shadow redraws 7, longest task 2.1 s |
| Pour (new) flood_on: to first frame | — | 1.9 s | new · shadow redraws 1, longest task 1.9 s |
| Pour (new) level_slider_flood: frame while dragging (mean) | — | 528 ms | new · shadow redraws 7, longest task 2.0 s |
| Sway turntable (new): frame, full quality + shadow redraw | — | 2.2 s | new |
| Cold open → first 3D | 13.0 s | 8.2 s | 1.6× faster |
| Cold open → traced 3D | 18.7 s | 15.3 s | 1.2× faster |
| Load: longest main-thread task | 7.0 s | 3.0 s | 2.4× faster |
| GPU textures / buffers | 287.4 / 88.8 MB | 301.6 / 22.2 MB | |
| Console errors | 0 | 0 | |

- The look fixes are shader math (a tone-map curve, specular squash and cap terms) and cost nothing measurable. Every frame probe is the same as or faster than the first commit's after numbers.
- **Pour level / meniscus / flood drags** are about 0.5–0.6 s per frame on SwiftShader. They're uniforms against the baked depth with no rebake. But the pour surface casts shadows, so each step redraws the shadow map (7 redraws per 6-step drag, the same as the light-direction slider). The first switch to an as-poured epoxy (2.5 s) includes the one-off distance-field bake on the main thread and a shader compile.
- **Sway** renders full-quality frames with a shadow redraw on every frame (2.2 s/frame on SwiftShader; it's smooth on a real GPU, but it's the heaviest steady state in the app).
- Threshold → traced is unchanged, which is expected: the trace path wasn't optimised further (SVG-showroom direction).

## SVG showroom (branch `showroom`): import → 3D, vs. the trace build

Same box, headless Chromium + SwiftShader, `tools/perf.py` / `tools/lag.py`, run one after the other: old = 21477b1 tracing `old-fisherman.jpg`, new = showroom importing `old-fisherman.svg` (the same artwork after `cnc_vector.py`). Absolute ms are CPU-WebGL ms; compare the builds, not the FPS.

| | 21477b1 (trace) | showroom (SVG) |
|---|---|---|
| cold open (no cache, 50 Mbit/20 ms) → first 3D frame | 7.88 s | 3.63 s |
| → fully settled (4096 wood bake done) | 13.8 s | 8.79 s |
| warm import → first 3D frame (in-page, `app.job.first_frame_ms`) | ~15 s | 1.2–2.0 s (fisherman 1.96, eagle 1.40, wolf 1.23, stag 1.41, logo 0.40) |
| bytes fetched by the default path | 0.52 MB, then OpenCV wasm warm-up (3.5 MB gz) | 0.32 MB (three-lite 145 KB gz + sample SVG 126 KB + ~45 KB JS); no OpenCV / engine / carve-worker |
| edit → frame | threshold retrace 12.7 s | bit angle re-bake: first frame ~2.0 s (worker remap 0.65 s), settled 5.2 s |
| GPU texture memory (end of run) | 301.6 MB | 301.4 MB |
| main-thread JS heap after each of 5 imports | — | 97 MB, flat |

Interaction (lag.py and perf.py `change`/`orbit`): every probe is within run-to-run noise (±15 %) of 21477b1, e.g. orbit drag mean 412 → 355 ms, exposure slider 355 → 352 ms, first glow pour 2122 → 2169 ms, sway 2003 → 1927 ms. One real gain: switching back to a species already seen is a wood-cache hit (lag `species_oak`: 3.9 s settled → 0.93 s, no bake strips).

Worker bake for a 300 mm SVG at 4096² (super-sampled): raster 0.04–0.8 s (engrave strokes are the slowest), distance field ~0.65 s, remap + 2×2 downsample + RG half-float + AO ~0.7 s. Angle/depth/carve-type changes reuse the cached masks and distance fields and only redo the remap.

Caveat: under SwiftShader, a re-bake after a board-size change sometimes takes 3–7 s to settle, almost all of it inside the GPU wood-bake draws (same programs, no shader compile); the worker part stays at ~0.7 s. It varies a lot from run to run (the same vbit change measured 0.76 s and 6.3 s) and the trace build has the same bake path, so it reads as CPU-WebGL contention rather than a regression; worth re-checking on a real GPU.

## Vector-exact edges (exact SDF, per-fragment edges) vs. 72f3f09

Same box and tools, run one after the other (base = 72f3f09, two runs; after = this change). SwiftShader numbers: compare the builds, not the FPS.

| | 72f3f09 (2 runs) | exact SDF |
|---|---|---|
| cold open → first 3D / traced 3D | 5.68 / 5.30 s · 10.34 / 9.65 s | 5.59 s · 10.70 s |
| settled frame | 1075 / 1090 ms | 1253 ms (+16 %) |
| orbit (draft frames, snap skipped) / after release | 351 / 315 · 658 / 532 ms | 394 · 660 ms |
| unsanded overpour | 2862 / 2922 ms | 4237 ms (+46 %) |
| fill char / glow bloom | 1390 / 1441 · 1790 / 1927 ms | 1689 · 2108 ms |
| bit-angle re-bake settled | 6881 / 7393 ms | 7669 ms |
| lag: orbit / exposure / first pour / sway | 227 · 376 · 2401 · 2095 ms | 300 · 474 · 3704 · 2499 ms |
| GPU texture memory | 301.4 MB | 301.4 MB (single-layer files use RG + uniform floor/slope; multi-level pockets add ~17 MB of step textures) |
| warm import → first frame | fisherman 1.96, eagle 1.40, wolf 1.23, stag 1.41, logo 0.40 s | 2.13, 1.20, 2.04, 1.20, 0.76 s |

The exact segment-distance SDF costs ~0.35–0.45 s per layer in the worker at 2048² (fisherman: 59,672 segments); the wolf pays it per pocket level. Fragment cost rises from the analytic normals plus the 3-step Newton edge snap; draft frames skip the snap. The overpour/pour path is the biggest gap. A bisect ruled out the snap, the wall fallback, texture bandwidth and the fill-hide threshold, so the cause is still open. Re-check on a real GPU before tuning.
