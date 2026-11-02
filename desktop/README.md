# desktop/

The desktop apps are built with Tauri v2. The project lives in `../src-tauri/` and loads `../app/` unchanged.
CI is in `../.github/workflows/desktop.yml`. See the "Desktop apps" section of the main README.

- `icon.svg` / `icon.png`: the app icon source. To regenerate the platform icons, run `npx tauri icon desktop/icon.png -o src-tauri/icons`.
- Desktop-only behaviour in the web app: the service worker is skipped, and downloads (Render PNG, Download SVG)
  go through the `save_file` command for a native Save dialog, because `<a download>` isn't honoured by every webview.
- `dragDropEnabled` is false so the page's own HTML5 file drop keeps working.
