# desktop/ (placeholder)

The Windows installer will live here later, built from this repo the same way as Relief Forge:
a thin Electron or Tauri shell that loads `../app/index.html` unchanged.

Nothing here yet. Notes for when it's built:

- Load the static app straight from disk or a bundled local server. Everything in `app/` uses
  relative paths, so `file://` works except for the Web Worker in some engines. Serving `app/`
  from a tiny localhost server (or Tauri's asset protocol) is the safest route.
- No backend, network access or Python needed: the engine is `app/js/carve-worker.js` with
  OpenCV.js + potrace bundled in `app/vendor/`.
- Electron: `mainWindow.loadFile(path.join(__dirname, '../app/index.html'))`, or `protocol.handle` to serve `app/`.
- Tauri: set `build.frontendDist` to `../app` in `tauri.conf.json`.
