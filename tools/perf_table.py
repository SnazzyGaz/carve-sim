"""Markdown before/after table from tools/perf.py and tools/lag.py JSON.
usage: python3 tools/perf_table.py perf_before.json perf_after.json lag_before.json lag_after.json"""
import json, sys
pb, pa, lb, la = [json.load(open(p)) for p in sys.argv[1:5]]
def s(ms): return '—' if ms is None else (f'{ms/1000:.1f} s' if ms >= 1000 else f'{ms:.0f} ms')
def x(b, a):
    if not b or not a: return 'new' if a and not b else ''
    r = b / a
    return f'{r:.1f}× faster' if r >= 1.05 else (f'{1/r:.1f}× slower' if r <= 0.95 else 'same')
rows = []
def row(name, b, a, note=''): rows.append(f'| {name} | {s(b)} | {s(a)} | {x(b, a)}{" · " + note if note else ""} |')
print('| Probe | Before (3986014) | After (materials-v2) | |\n|---|---:|---:|---|')
rows.append(f"| Triangles, settled full frame (incl. shadow pass) | {pb['settled_frame']['tris']:,} | {pa['settled_frame']['tris']:,} | |")
rows.append(f"| Triangles, drag frame | {pb['orbit']['tris']:,} | {pa['orbit']['tris']:,} | |")
row('Settled full-quality frame', pb['settled_frame']['mean_ms'], pa['settled_frame']['mean_ms'])
row('Orbit drag frame (p50)', pb['orbit']['p50_ms'], pa['orbit']['p50_ms'])
row('Orbit drag frame (mean)', pb['orbit']['mean_ms'], pa['orbit']['mean_ms'])
row('Full frame after releasing orbit', pb['orbit_after_release']['mean_ms'], pa['orbit_after_release']['mean_ms'])
for k in ('bright', 'az'):
    B, A = lb['slider'].get(k), la['slider'].get(k)
    if B and A:
        row(f'Slider drag "{k}": frame while dragging (mean)', B['during_mean_ms'], A['during_mean_ms'], f"shadow redraws {B['shadow_redraws']} → {A['shadow_redraws']}")
        row(f'Slider drag "{k}": longest blocking task', B['longtask_max_ms'], A['longtask_max_ms'])
B, A = lb['orbit'], la['orbit']
row('Orbit drag (lag probe): frame mean', B['during_mean_ms'], A['during_mean_ms'])
for k, B in lb['switch'].items():
    A = la['switch'].get(k)
    if not A: continue
    note = f"bake: {B['bakes_inside_frames']} in-frame" + (f"; after: preview + {A['bake_strips']} idle strips (max {s(A['bake_strip_max_ms'])})" if A.get('bake_strips') else '')
    row(f'Switch {k}: to first frame', B['first_frame_ms'], A['first_frame_ms'], note if 'species' in k or 'inlay' in k else '')
    row(f'Switch {k}: longest blocking task', B['longtask_max_ms'], A['longtask_max_ms'])
for k in pb['change']:
    row(f'perf.py change {k}', pb['change'][k]['to_frame_ms'], pa['change'][k]['to_frame_ms'])
row('Threshold slider → traced frame', pb['threshold_slider']['to_traced_frame_ms'], pa['threshold_slider']['to_traced_frame_ms'], f"longest task {s(pb['threshold_slider']['longtask_max_ms'])} → {s(pa['threshold_slider']['longtask_max_ms'])}")
for k, A in (la.get('pour') or {}).items():
    row(f'Pour (new) {k}: ' + ('frame while dragging (mean)' if 'slider' in k else 'to first frame'), None, A['during_mean_ms'] if 'slider' in k else A['first_frame_ms'],
        f"shadow redraws {A.get('shadow_redraws', '?')}, longest task {s(A['longtask_max_ms'])}")
if la.get('sway_frame_ms'): row('Sway turntable (new): frame, full quality + shadow redraw', None, la['sway_frame_ms'])
row('Cold open → first 3D', pb['cold_open_to_first_3d_s']*1000, pa['cold_open_to_first_3d_s']*1000)
row('Cold open → traced 3D', pb['cold_open_to_traced_3d_s']*1000, pa['cold_open_to_traced_3d_s']*1000)
row('Load: longest main-thread task', pb['load_longtasks']['max_ms'], pa['load_longtasks']['max_ms'])
rows.append(f"| GPU textures / buffers | {pb['gpu']['texture_MB']} / {pb['gpu']['buffers_MB']} MB | {pa['gpu']['texture_MB']} / {pa['gpu']['buffers_MB']} MB | |")
rows.append(f"| Console errors | {len(pb['errors'])+len(lb.get('errors',[]))} | {len(pa['errors'])+len(la.get('errors',[]))} | |")
print('\n'.join(rows))
