// Rebuilds app/vendor/ from npm packages. Only needed when upgrading a library;
// the built files are committed so the site needs no build step.
//   npm install && npm run vendor
import { build } from 'esbuild';
import { readFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app'), vendor = path.join(app, 'vendor'), src = path.join(root, 'tools', 'vendor-src');
mkdirSync(vendor, { recursive: true });

// 1. three.js trimmed to exactly what app/js uses (THREE.Xxx names + the six addons)
const used = new Set();
for (const f of readdirSync(path.join(app, 'js')).filter((f) => f.endsWith('.js')))
  for (const m of readFileSync(path.join(app, 'js', f), 'utf8').matchAll(/THREE\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
const addons = { OrbitControls: 'controls/OrbitControls.js', RoomEnvironment: 'environments/RoomEnvironment.js',
  EffectComposer: 'postprocessing/EffectComposer.js', RenderPass: 'postprocessing/RenderPass.js',
  UnrealBloomPass: 'postprocessing/UnrealBloomPass.js', OutputPass: 'postprocessing/OutputPass.js' };
const entry = `export { ${[...used].sort().join(', ')} } from 'three';\n` +
  Object.entries(addons).map(([k, p]) => `export { ${k} } from 'three/examples/jsm/${p}';`).join('\n');
await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, format: 'esm', minify: true, legalComments: 'eof',
  outfile: path.join(vendor, 'three-lite.min.js') });
console.log('three-lite.min.js:', used.size, 'core names +', Object.keys(addons).length, 'addons');

// 2. potrace core (potracer-compatible decomposition + JS curve fitting), classic script for the worker
await build({ entryPoints: [path.join(src, 'potrace-entry.js')], bundle: true, format: 'iife', minify: true, legalComments: 'eof',
  alias: { jimp: path.join(src, 'jimp-stub.js') }, outfile: path.join(vendor, 'potrace-core.min.js') });
console.log('potrace-core.min.js');

// 3. OpenCV.js 5.0: the npm file embeds its WebAssembly as a 12 MB string; split it into opencv.wasm
//    (compiled while it streams in, with a progress bar) + a 128 kB loader. Same build, same bytes.
execFileSync(process.execPath, [path.join(root, 'tools/split-opencv.cjs'), path.join(root, 'node_modules/@techstark/opencv-js/dist/opencv.js'),
  path.join(vendor, 'opencv.js'), path.join(vendor, 'opencv.wasm')], { stdio: 'inherit' });
copyFileSync(path.join(root, 'node_modules/potrace/LICENSE'), path.join(vendor, 'POTRACE-LICENSE.txt'));
console.log('opencv.js + opencv.wasm written');
