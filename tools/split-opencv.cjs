// Splits the WebAssembly that opencv.js carries inside itself (as a 12 MB JS string) out into
// opencv.wasm, and patches the loader to compile it with WebAssembly.compileStreaming.
// Why: the browser no longer has to parse a 13 MB script, the wasm compiles while it downloads,
// and the worker can show download progress. Same OpenCV build, same bytes, same results.
//   node tools/split-opencv.cjs <opencv.js in> <opencv.js out> <opencv.wasm out>
const fs = require('fs');
const [, , src, outJs, outWasm] = process.argv;
let s = fs.readFileSync(src, 'utf8');
const A = 'function findWasmBinary(){return binaryDecode(', B = ')}function getBinarySync';
const i = s.indexOf(A), j = s.indexOf(B);
if (i < 0 || j < 0) throw new Error('opencv.js layout changed: markers not found');
const str = (0, eval)(s.slice(i + A.length, j));          // the string literal itself
const o = new Uint8Array(str.length);
for (let k = 0; k < str.length; k++) { const c = str.charCodeAt(k); o[k] = ~c >> 8 & c; }   // emscripten binaryDecode
if (o[0] !== 0 || o[1] !== 0x61 || o[2] !== 0x73 || o[3] !== 0x6d) throw new Error('embedded payload is not wasm');
fs.writeFileSync(outWasm, o);
s = s.slice(0, i) + 'function findWasmBinary(){return null' + s.slice(j + 1);
const H = 'if(Module["instantiateWasm"])';
if (s.split(H).length !== 2) throw new Error('opencv.js layout changed: instantiateWasm hook');
// self.CV_WASM_MODULE: a Promise<WebAssembly.Module> the worker starts (with progress); else fetch next to the script
s = s.replace(H, 'if(!Module["instantiateWasm"])Module["instantiateWasm"]=(info,cb)=>{' +
  'Promise.resolve(self.CV_WASM_MODULE||WebAssembly.compileStreaming(fetch(self.CV_WASM_URL||"opencv.wasm")))' +
  '.then(m=>WebAssembly.instantiate(m,info).then(inst=>cb(inst,m)))};' + H);
fs.writeFileSync(outJs, s);
console.log('opencv.wasm', o.length, 'bytes; opencv.js', s.length, 'bytes');
