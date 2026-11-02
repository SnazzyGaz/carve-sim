"""Compare the browser engine's output (from tools/verify.py) with the Python reference engine.
usage: python3 tools/parity.py [verify_outdir] [python_server_dir]
Runs the reference twice: as-is (OpenCV with its CPU SIMD paths) and with cv2.setUseOptimized(False),
which is the plain-C arithmetic OpenCV.js (WebAssembly, no SIMD) uses."""
import sys, json, re, subprocess, numpy as np, cv2
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/csweb-verify'
REF = sys.argv[2] if len(sys.argv) > 2 else '/workspace/carve-sim/server'
SAMPLES = {'old-fisherman': '../samples/old-fisherman.jpg', 'biomech-sculpture': '../samples/biomech-sculpture.jpg'}
APP = __file__.rsplit('/tools/', 1)[0] + '/app/'

CODE = r'''
import sys, json, cv2
if sys.argv[2] == 'plain': cv2.setUseOptimized(False)
sys.path.insert(0, '.'); import engine
src = engine.Source(sys.argv[1].rsplit('/', 1)[-1], open(sys.argv[1], 'rb').read())
res, blobs = engine.process(src, {}, True)
open('/tmp/_ref_' + sys.argv[2] + '.svg', 'wb').write(blobs['trace.svg']); open('/tmp/_ref_' + sys.argv[2] + '.png', 'wb').write(blobs['preview.png'])
print(json.dumps({'stats': res['stats'], 'flags': res['flags'], 'warnings': [w['text'] for w in res['warnings']], 'timing': res['timing_s']}))
'''
def ref(path, mode):
    r = subprocess.run([sys.executable, '-c', CODE, path, mode], cwd=REF, capture_output=True, text=True)
    if r.returncode: print(r.stderr); raise SystemExit(1)
    return json.loads(r.stdout.strip().splitlines()[-1])
paths = lambda f: re.findall(r'<path d="([^"]+)"', open(f).read())
def iou(a, b):
    A = cv2.imread(a, 0) < 128; B = cv2.imread(b, 0)
    B = cv2.resize(B, (A.shape[1], A.shape[0]), interpolation=cv2.INTER_AREA) < 128
    return (A & B).sum() / max(1, (A | B).sum())
def row(tag, s, f):
    e = s['estimate']
    return f"{tag:<22}{s['paths']:>6}{s['nodes']:>8}{s['rapid_travel_mm_est']:>9}{e['time_min']:>7}{e['cut_length_m']:>7}{e['plunges']:>6}  rem {f['removed_detail']['count']:>4} brg {f['bridged_gaps']['count']:>4} frag {f['fragile']['count']:>4} clr {f['clearance']['area_mm2']:>8} cut% {f['cut_area_pct']}"

for name, rel in SAMPLES.items():
    js = json.load(open(f'{OUT}/{name}_stats.json'))
    print(f'\n== {name}\n{"":<22}{"paths":>6}{"nodes":>8}{"travel":>9}{"min":>7}{"cut m":>7}{"plng":>6}')
    print(row('browser (JS/wasm)', js['stats'], js['flags']))
    for mode in ('plain', 'simd'):
        r = ref(APP + rel.replace('../', ''), mode)
        print(row(f'python {"no-SIMD" if mode == "plain" else "default"}', r['stats'], r['flags']))
        a, b = paths(f'{OUT}/{name}.svg'), paths(f'/tmp/_ref_{mode}.svg')
        print(f'{"":<22}svg paths byte-identical: {len(set(a) & set(b))}/{len(b)}, same order: {a == b}, '
              f'preview IoU {iou(f"/tmp/_ref_{mode}.png", f"{OUT}/{name}_preview.png"):.4f}, warnings equal: {r["warnings"] == [w["text"] for w in js["warnings"]]}')
