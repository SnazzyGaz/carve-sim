# Materials v2 (branch `materials-v2`)

The Relief Forge 2.0.6/2.0.7 material work, ported to Carve Sim's GPU-displaced viewer, plus a pass on where the 3D view was lagging.

## Changelog

**Wood**
- Solid 3D board-space grain: the rings, rays and pores are evaluated at the carved height, so they run continuously through cut walls. End grain darkens on walls that cut across the fibre.
- Earlywood and latewood bands are crisper. Vessels sit on a jittered radial × arc lattice: ring-porous species (oak, ash) get earlywood pore rows, diffuse-porous species get scattered pores. Each vessel is a short dash along the fibre, and they fade to mean coverage when smaller than a pixel, so there's no shimmer.
- Medullary rays are radial ribbons with a lens profile. They're strong in white oak (fleck), weak in walnut, cherry and padauk. Each species has its own pore diameter (`pore_d`) and ray height (`ray_h`). White oak was retuned (early #cdae7f, late #9d7b51, pores #5f462b).

**Lighting and rendering**
- Studio PMREM environment: a warm key softbox, a cool strip and a front fill over a dark floor. It's rebuilt only when the light's azimuth or elevation changes, and never during a drag; the rebuild is deferred to the settled frame. RoomEnvironment is gone (vendor build is 7.9 KB smaller).
- Tone mapping with highlight roll-off (first AgX, now PBR Neutral + Forge's S-curve; see the look pass below).
- Soft PCF shadows (radius 3). The hemisphere light is removed; the environment does the ambient light.
- Baked ambient occlusion: the trace worker computes a multi-scale cavity term (0.4 / 1.2 / 3.6 mm) and sends it as an R8 texture. It darkens only indirect light and specular, with specular occlusion. There's a new **Ambient occlusion** slider (now default 25%, as in Forge).

**Fills**
- Clear and tinted epoxy: the resin top is a real clear coat (flat normal), with Beer–Lambert absorption along the refracted view path down to the wetted floor of the pocket. The floor is lit by the key light through the resin plus occluded ambient. An unsanded overpour is frosted (coat roughness 0.38).
- Opaque: roughness 0.45. New **marble** preset with veins.
- Metallic: metalness 0.9 with a proper F0 per metal (gunmetal, bronze, brass, gold, copper). Flakes at 16/mm with tilted normals fade into a rougher lobe at a distance instead of aliasing.
- Glow: no teal haze any more. Bloom reads only the emissive share of each pixel (stored in alpha), through a smooth threshold, with a tight radius. Glossy highlights on wood or resin never bloom.

**Inlay**
- The plug is its own species, with its grain rotated (1.35 rad) against the board's, and it's baked separately.
- There's a thin dark glue line at the pocket wall, box-filtered to stay stable at any zoom.
- An unsanded plug stands proud with a slight chamfer. Sanded, it sits flush.

**Performance (see the perf table in perf-notes.md)**
- **LOD grid:** the displaced grid coarsens in powers of two (up to 4×) so quads stay at least 1.5 screen pixels, and re-picks on the settled frame after a zoom. Every pixel's normal and colour already come from the depth texture, so only the silhouette resolution changes. Full-frame triangles go from 2.63 M to 0.66 M (draft 0.66 M to about 0.17 M).
- **Progressive wood bake:** a 1024-texel preview bakes immediately. The 4096 bake then fills in 16 scissored strips, one per idle frame, never during interaction. It's flushed for PNG export. There's no more multi-second single-frame stall on a species or inlay switch.
- **Shadows:** non-direction light sliders (exposure, ambient, key strength, AO) no longer redraw the 4096² shadow map. Only azimuth and elevation do.
- Draft mode now always engages while moving, so the adaptive draft pixel ratio works with the coarser grids.
- Shared materials, per-part `#define` programs and the `compileAsync` warm-up are unchanged.

**Tools**
- `tools/lag.py`: per-source lag probe (slider drags, orbit, species, finish and fill switches, bloom). It counts shadow redraws, in-frame bakes and bake strips.
- `tools/perf_table.py`: turns perf.py and lag.py JSON into the markdown table.

## Look pass, Forge lighting, pour controls, Forge camera (second commit)

**Colour and tone**
- The first cut looked washed out: AgX greys and darkens pale woods (maple read beige-grey, about 1.5 stops under its swatch) and turns gold highlights white. The tone map is now Khronos PBR Neutral, which reproduces base colours up to ~0.8 nearly 1:1, followed by Relief Forge 2.0.7's gentle S-curve (30%) and 1.08 saturation, so it isn't flat. The studio preset is calibrated (`EXPOSURE_CAL`) so a maple top under the key lands on its swatch. `?tm=punchy` still gives the AgX Punchy look for comparison, and `?cal=` overrides the calibration.
- Under a finish film, the wood's own specular is cut to 30% at full coat (the finish and cell walls have nearly the same index), so the gloss comes from the film's top. That removes the milky veil on walnut.
- The studio softbox is smaller and dimmer (4.5 × 3.5 at 44, radiance 7; it was 16 × 12 at 16), and the horizon band (0.2) lights the board's edges and sides in low views.
- Gloss highlights: the key's glint on a near-mirror coat used to become a big soft disc in close-ups, because GGX's long tail was pushed through exposure and the S-curve. The coat's direct specular now has its tail squashed (x²/(x+k), with k larger for satin so the sheen stays a sheen) and its core capped. Gloss coat roughness is 0.03 (was 0.05, min 0.02), so clear epoxy shows a small, crisp glint and marble a soft sheen instead of a wash.
- Metals: only the brightest channel's overshoot is compressed (hue kept) before the tone map, so a gold highlight stays gold instead of washing to white.
- Metals have coloured F0: gold #ffc356, bronze #d9a066, brass #efcf78, copper #f0a07a, gunmetal #7d8186.
- Opaque black is near black (#0c0c0d) with a subtle sheen. Amber absorbs 0.035 / 0.12 / 0.42 per mm with an #7a4a10 in-scatter, so it reads as honey, not orange-red.

**Lighting like Relief Forge 2.0.7**
- Light panel: Preset, Light direction, Light height, Key strength (0–8), Warmth (−1 cool daylight #bcd4ff … +1 tungsten #ffcf9a, as in Forge), Fill (Forge's cool #c8d8ff directional fill opposite the key, no shadow), Ambient (studio environment), Exposure, Ambient occlusion (**default 25%**), Cast shadows, Backdrop.
- Presets follow Forge's (since trimmed to Studio, Raking, Overhead and Daylight; glow fills were removed, see perf-notes.md). The raking preset has enough fill (0.35) that the hero shot's board edges show their end and side grain.
- PMREM studio environment follows the key. Soft PCF shadows. The shadow map is still redrawn only when the key's direction moves, shadows are toggled, or the geometry changes (pour shape); never for strength, warmth, fill, ambient, exposure or AO.

**As-poured epoxy (unsanded epoxy fills)**
- **Pour level** slider, −2 … +1.5 mm against the board top: under-filled, flush, or overpour. It's a uniform: the pour surface is displaced in the vertex shader from the baked depth, with no rebake.
  - **Pinned** (default): the level can't rise above the board top inside the carve outline (moving past 0 stays flush).
  - **Flood coat** toggle: above flush, the resin is one level coat over the whole board top, eased off at the board edge.
  - Under-filled clear and tinted resin shows the channel walls above it as wood. Below the level, the refracted view ray reaches the walls and floor through the resin with depth-based Beer–Lambert absorption.
- **Shrinkage & meniscus** slider (0–100%, default 30%), for all epoxy types:
  - Curing shrinkage dishes the middle of each pour (up to 4% of the resin's thickness), following a distance-to-edge field. That field is a two-pass chamfer distance transform of the carve mask at 512 px or less, computed once per depth map and only when an as-poured epoxy is shown (a few ms).
  - A flood coat telegraphs faint dips over the channels.
  - A meniscus (up to 0.2 mm) climbs the channel walls. It's measured from the contact line using the local wall slope, so it's exact below a texel.
  - Each pixel drops resin that isn't there, so the contact line stays crisp.
- Moving the level, flood or meniscus control switches **Sanded flush** off. A sanded fill is the levelled, flush surface as before.

**Camera like Relief Forge 2.0.7**
- OrbitControls about a fixed world up (y): no roll, and the horizon stays level. Damping is 0.12, panning is screen-space, the polar angle is clamped to 0–85° (the camera never dips under the floor), and zoom-to-cursor is off as in Forge. Double-click still re-centres on the board. Since the creative-director pass: pan keeps the orbit centre over the board, zoom-out stops at 2.5× the fit distance, presets ease over ~360 ms (instant from `app.set` and with reduced motion) and light up while active, and **Fit** / `F` / `Home` / double-clicking the backdrop frames the whole board.
- **Sway** (Forge's turntable) turns the board slowly to and fro, ±0.38 rad about the vertical axis with Forge's 2.6 s time constant. The camera, lights, environment and floor stay put. The shaders work in board millimetres, so the camera position, key direction and normal rotation are passed in the board frame each frame (three uniforms). The shadow is redrawn every frame while it sways.
- Draft quality during drags is unchanged.

## Toward the SVG showroom (now built on branch `showroom`; see [showroom.md](showroom.md))

Here's what would change if Carve Sim becomes an import-and-bake showroom, with all editing done outside:

- **Input:** replace the photo → OpenCV trace path (`engine.js`, `carve-worker.js` trace and the lazy OpenCV wasm) with an SVG import that rasterises the finished paths into the depth field once (V-carve or pocket depth from the SVG). OpenCV and the trace sliders can go, which takes ~3.5 MB off the download.
- **Bake once per import:** the depth texture, AO (`aoTexture`) and LOD grids are computed once. Then the progressive 4096 wood bake only reruns on species or inlay changes. The trace/edit re-bake paths (threshold slider → retrace → setDepth) stop being hot paths.
- **UI:** keep the woods, fills, finishes, lighting and views panel. Drop the trace/edit controls. Add a material-comparison mode (presets, A/B) and a high-res export.
- **Viewer:** `viewer.js` can mostly stay as it is. `setDepth` becomes import-only. Worth caching the baked wood per species for that one carve, so flipping between species is instant after the first visit.

Built as planned, with one change: the tracer was kept (lazy, collapsed, one-off bake) instead of deleted. The wood bake is cached per species (LRU, up to 3 boards at 4096², ~270 MB GPU), so switching back to a species you have already seen is a cache hit (~25–30 ms instead of a full 17-step re-bake).
