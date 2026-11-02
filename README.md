# Carve Sim · SVG showroom

A browser showroom for CNC carvings. Drop in a finished SVG (ideally one made by the CNC vector skill) and see it carved in 3D, so you can pick the wood, fill and finish before you cut anything.

**[Open Carve Sim →](https://snazzygaz.github.io/carve-sim/)**

![Fisherman in ash, charred grooves](docs/fisherman-ash.jpg)

## What it does

- **Reads the carve from the SVG.** V-carve, pockets, stepped pocket levels and engrave lines, at the file's real size, bit angle and depths.
- **Shows it in real materials.** Sixteen woods (pale, mid, dark and red, grouped by tone) plus MDF, raw or oiled. Fills: epoxy in suggested colours or any colour you pick (opaque, metallic or tinted), or a wood inlay. Fills can be shown sanded flush or as poured.
- **Lights it for judging the carve.** Studio, Raking (shows depth and wall quality), Overhead and Daylight presets, with direction and brightness controls.
- **Lets you compare.** Preset camera views, a slow turntable, and A/B looks to flip between two material choices.
- **Exports a PNG** of the view, up to 4× resolution.
- **Traces an image if you have no SVG.** A clean black-and-white PNG or JPG can be traced into a CNC SVG in a side panel. It loads only when opened.

Everything runs in your browser and nothing is uploaded. It works offline once it has loaded.

## Run it

Serve the `app/` folder with any static server, then open the page:

```
cd app && python3 -m http.server 8766    # http://127.0.0.1:8766/
```

It won't work from a double-clicked `file://`. GitHub Pages publishes `app/` as is, with no build step.

## Licence

GPL-2.0-or-later, because the tracer uses potrace. three.js is MIT and OpenCV.js is Apache-2.0. More detail is in `docs/`.
