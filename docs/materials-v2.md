# Materials v2 (branch `materials-v2`)

The Relief Forge 2.0.6/2.0.7 material work, ported to Carve Sim's GPU-displaced viewer, plus a pass on where the 3D view was lagging.

## Changelog

**Wood**
- Solid 3D board-space grain: the rings, rays and pores are evaluated at the carved height, so they run continuously through cut walls. End grain darkens on walls that cut across the fibre.
- Earlywood and latewood bands are crisper. Vessels sit on a jittered radial × arc lattice: ring-porous species (oak, ash) get earlywood pore rows, diffuse-porous species get scattered pores. Each vessel is a short dash along the fibre, and they fade to mean coverage when smaller than a pixel, so there's no shimmer.
- Medullary rays are radial ribbons with a lens profile. They're strong in white oak (fleck), weak in walnut, cherry and padauk. Each species has its own pore diameter (`pore_d`) and ray height (`ray_h`). White oak was retuned (early #cdae7f, late #9d7b51, pores #5f462b).

**Lighting and rendering**
- Studio PMREM environment: a warm key softbox, a cool strip and a front fill over a dark floor. It's rebuilt only when the light's azimuth or elevation changes, and never during a drag; the rebuild is deferred to the settled frame. RoomEnvironment is gone (vendor build is 7.9 KB smaller).
- AgX tone mapping with a mild saturation and contrast curve. Highlights roll off instead of clipping.
- Soft PCF shadows (radius 3). The hemisphere light is removed; the environment does the ambient light.
- Baked ambient occlusion: the trace worker computes a multi-scale cavity term (0.4 / 1.2 / 3.6 mm) and sends it as an R8 texture. It darkens only indirect light and specular, with specular occlusion. There's a new **Ambient occlusion** slider (default 0.6).

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

## Toward the SVG showroom (not built)

Here's what would change if Carve Sim becomes an import-and-bake showroom, with all editing done outside:

- **Input:** replace the photo → OpenCV trace path (`engine.js`, `carve-worker.js` trace and the lazy OpenCV wasm) with an SVG import that rasterises the finished paths into the depth field once (V-carve or pocket depth from the SVG). OpenCV and the trace sliders can go, which takes ~3.5 MB off the download.
- **Bake once per import:** the depth texture, AO (`aoTexture`) and LOD grids are computed once. Then the progressive 4096 wood bake only reruns on species or inlay changes. The trace/edit re-bake paths (threshold slider → retrace → setDepth) stop being hot paths.
- **UI:** keep the woods, fills, finishes, lighting and views panel. Drop the trace/edit controls. Add a material-comparison mode (presets, A/B) and a high-res export.
- **Viewer:** `viewer.js` can mostly stay as it is. `setDepth` becomes import-only. Worth caching the baked wood per species for that one carve, so flipping between species is instant after the first visit.
