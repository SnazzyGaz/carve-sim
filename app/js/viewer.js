import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COMMON, PARS, VERT_MAIN, BAKE_VERT, BAKE_FRAG } from './shader.js';
import { SPECIES, FINISHES, FILLS, LIGHTS } from './materials.js';

const lin = (hex) => new THREE.Color(hex); // ColorManagement: hex is sRGB -> stored linear
const SETTLE_MS = 160;                     // full-quality frame this long after the last movement

// How it renders (see docs/perf-notes.md):
//  * the board is a flat grid built once per size/detail; the GPU displaces it from the depth texture,
//    so a new trace or material only uploads a texture or changes uniforms (no mesh rebuilds)
//  * frames are drawn only when something changed; while orbiting or dragging a light slider it draws a
//    draft (pixel ratio <= 1, adaptive, half-density grid), then one full-quality frame once it settles
//  * the shadow map is redrawn only when the carve, fill or light changes, not every frame
//  * bloom runs only for the glow resins
export class Viewer {
  constructor(container) {
    this.el = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.fullPR = Math.min(window.devicePixelRatio || 1, 2);
    this.draftPR = Math.min(window.devicePixelRatio || 1, 1);
    r.setPixelRatio(this.fullPR);
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; this.shadowDirty = true;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 2, 6000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47; this.controls.minDistance = 25; this.controls.maxDistance = 2500;
    this.controls.zoomToCursor = true;
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    pm.dispose();
    this.scene.environment = this.envTex;
    this.key = new THREE.DirectionalLight(0xffffff, 2.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(4096, 4096);
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.3; this.key.shadow.radius = 2;
    this.scene.add(this.key, this.key.target);
    this.fillLight = new THREE.HemisphereLight(0xfff6ea, 0x2a2420, 0.15);
    this.scene.add(this.fillLight);
    this.state = { species: 'maple', insert: 'walnut', finish: 'oil', fill: 'none', fillPreset: 'black', sanded: true,
                   light: 'studio', az: 220, el: 42, exposure: 1.0, env: 0.5, key: 2.0, backdrop: 'dark', meshRes: 1024, margin: 18, thickness: 22 };
    this.uniforms = this.makeUniforms();
    this.makeBackdrop();
    this.mats = {}; this.depthMats = {}; this.grids = new Map();
    this.composer = null;
    this.quality = 'full';
    this.initBake();
    this.makeBoard();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setLighting({});
    this.setMaterial({});
    this.dirty = true;
    // interaction: draft frames while moving, one full frame after it settles
    this.interacting = false; this.lastMove = 0; this.frameGaps = [];
    this.controls.addEventListener('start', () => { this.interacting = true; this.interact(); });
    this.controls.addEventListener('end', () => { this.interacting = false; this.lastMove = performance.now(); });
    this.controls.addEventListener('change', () => { this.dirty = true; this.lastMove = performance.now(); });
    let prev = 0;
    const loop = (now) => {
      const moved = this.controls.update();
      if (moved) this.lastMove = now;
      if (this.quality === 'draft') {
        if (prev && (moved || this.dirty)) this.adapt(now - prev);
        if (!this.interacting && !moved && now - this.lastMove > SETTLE_MS) { this.setQuality('full'); this.dirty = true; }
      }
      if (moved || this.dirty) { this.dirty = false; this.render(); }
      prev = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    r.domElement.addEventListener('dblclick', (e) => this.focusAt(e));
    this.warmup();
  }

  makeUniforms() {
    const blank = new THREE.DataTexture(new Uint16Array(2), 1, 1, THREE.RGFormat, THREE.HalfFloatType); blank.needsUpdate = true;
    const u = {
      uDepth: { value: blank }, uArt: { value: new THREE.Vector2(300, 300) }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uMaxDepth: { value: 3 }, uEdge: { value: 0.02 }, uMode: { value: 0 }, uSanded: { value: true }, uFlat: { value: false },
      uOver: { value: 0.9 }, uStep: { value: 0.3 },
      uWood: { value: Array.from({ length: 14 }, () => new THREE.Vector4()) }, uFinish: { value: new THREE.Vector4(1, 1, 0, 0) },
      uFinishCoatRough: { value: 0.3 }, uFillType: { value: 0 }, uFillColor: { value: new THREE.Color() },
      uFillAbsorb: { value: new THREE.Vector3(1, 1, 1) }, uFillScatter: { value: new THREE.Color() }, uGlowColor: { value: new THREE.Color() },
      uBakeA: { value: null }, uBakeB: { value: null }, uBakeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uGlow: { value: 0 }, uFillRough: { value: 0.1 }, uCharScale: { value: 1.25 }, uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uOrigin: { value: new THREE.Vector3() },
    };
    return u;
  }

  // shared vertex injection: displacement before projection (so shadows and depth see the carve too)
  injectVertex(sh, part) {
    Object.assign(sh.uniforms, this.uniforms, { uPart: { value: part } });
    let v = COMMON + sh.vertexShader;
    if (part !== 1) v = v.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);'); // top/fill: normal comes from the depth map per pixel
    v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.vertexShader = v;
  }

  material(part) {
    if (this.mats[part]) return this.mats[part];
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.3, envMapIntensity: 1 });
    m.onBeforeCompile = (sh) => {
      this.injectVertex(sh, part);
      let f = sh.fragmentShader;
      f = f.replace('void main() {', `#define CARVE_PART ${part}\n` + COMMON + PARS + '\nvoid main() {');
      f = f.replace('#include <map_fragment>', 'surface(); diffuseColor.rgb = sAlb;');
      f = f.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(sRough, 0.04, 1.0);');
      f = f.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;');
      f = f.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n if (sOverrideN) { normal = normalize((viewMatrix * vec4(sN, 0.0)).xyz); }');
      f = f.replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\n if (sOverrideN) clearcoatNormal = normal;\n#endif');
      f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = sEmis;');
      f = f.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.clearcoat = clamp(sCoat,0.0,1.0); material.clearcoatRoughness = clamp(sCoatRough + geometryRoughness, 0.045, 1.0);');
      f = f.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= sAO; reflectedLight.indirectSpecular *= mix(1.0, sAO, 0.8) * sSpec; reflectedLight.directSpecular *= sSpec; reflectedLight.directDiffuse *= mix(1.0, sAO, 0.35);');
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'carve' + part;
    if (part === 2) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
    this.mats[part] = m;
    return m;
  }
  depthMaterial(part) {   // shadow pass with the same GPU displacement
    if (this.depthMats[part]) return this.depthMats[part];
    const m = new THREE.MeshDepthMaterial();
    m.onBeforeCompile = (sh) => this.injectVertex(sh, part);
    m.customProgramCacheKey = () => 'carveDepth' + part;
    return (this.depthMats[part] = m);
  }

  // ------------------------------------------------------------ baked wood
  // The solid-wood shader (a dozen 3D noise lookups per pixel) runs once per texel into a mipmapped texture
  // whenever the carve or species changes, instead of every pixel of every frame. Finish, fill, light and view
  // changes only touch uniforms. The finest fibre noise is still drawn live so close-ups keep their tooth.
  initBake() {
    const r = this.renderer, max = r.capabilities.maxTextureSize;
    this.bakeLong = Math.min(4096, max);
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace });
      rt.texture.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
      rt.texture.colorSpace = THREE.SRGBColorSpace;   // 8-bit sRGB storage keeps dark woods free of banding
      return rt;
    };
    this.bakeRT = [mk(), mk()];
    this.uniforms.uBakeA.value = this.bakeRT[0].texture; this.uniforms.uBakeB.value = this.bakeRT[1].texture;
    this.bakeMat = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG(),
      uniforms: Object.assign({}, this.uniforms, { uBakeK: { value: 0 }, uBakeFlat: { value: false }, uPart: { value: -1 } }), depthTest: false, depthWrite: false });
    this.bakeScene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMat); q.frustumCulled = false; this.bakeScene.add(q);
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bakeKeys = ['', ''];
  }
  bakeIfNeeded() {
    const S = this.state, U = this.uniforms, D = this.depth;
    const rect = U.uBakeRect.value, mode = U.uMode.value;
    const base = [this.depthVer || 0, rect.x, rect.y, rect.z, rect.w].join(',');
    const jobs = [[0, mode === 3 ? 1 : 0, false]];
    if (mode === 2 || mode === 3) jobs.push([1, mode === 2 ? 1 : 0, true]);
    for (const [slot, k, flat] of jobs) {
      const key = base + '|' + (k ? S.insert : S.species) + '|' + k + '|' + flat;
      if (this.bakeKeys[slot] === key) continue;
      const rt = this.bakeRT[slot], s = this.bakeLong / Math.max(rect.z, rect.w);
      const w = Math.max(16, Math.round(rect.z * s)), h = Math.max(16, Math.round(rect.w * s));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      this.bakeMat.uniforms.uBakeK.value = k; this.bakeMat.uniforms.uBakeFlat.value = flat;
      const r = this.renderer, prev = r.getRenderTarget();
      r.setRenderTarget(rt); r.render(this.bakeScene, this.bakeCam); r.setRenderTarget(prev);
      this.bakeKeys[slot] = key; this.bakes = (this.bakes || 0) + 1;
    }
  }

  makeBackdrop() {
    const g = new THREE.PlaneGeometry(6000, 6000);
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2927, roughness: 0.92, metalness: 0 });
    this.floor = new THREE.Mesh(g, this.floorMat);
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  makeBoard() {
    this.group = new THREE.Group(); this.group.visible = false; this.scene.add(this.group);
    const mk = (part) => {
      const o = new THREE.Mesh(new THREE.BufferGeometry(), this.material(part));
      o.customDepthMaterial = this.depthMaterial(part);
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;   // displaced on the GPU: CPU bounds are flat
      this.group.add(o); return o;
    };
    this.board = mk(0); this.sides = mk(1); this.fillMesh = mk(2); this.fillMesh.visible = false;
    this.depth = null; this.buildMeshes(300, 300);
  }

  // compile every program in the background (parallel shader compile) so the first real frame does not stall
  warmup() {
    const r = this.renderer; if (!r.compileAsync) return;
    const g = this.group, fv = this.fillMesh.visible;
    g.visible = true; this.fillMesh.visible = true;
    const p = r.compileAsync(this.scene, this.camera);
    g.visible = !!this.depth; this.fillMesh.visible = fv;
    this.warm = p.catch(() => {}).then(() => { this.dirty = true; });
  }

  // ------------------------------------------------------------ depth -> texture (GPU displacement)
  // rg: Uint16Array RG half floats (depth / maxDepth, blurred carve mask) built in the worker
  setDepth(rg, tw, th, artW, artH, maxDepth) {
    this.dirty = true; this.shadowDirty = true;
    const first = !this.depth;
    this.depth = { tw, th, artW, artH, maxDepth }; this.depthVer = (this.depthVer || 0) + 1;
    const U = this.uniforms, old = U.uDepth.value;
    if (old.image.width === tw && old.image.height === th && old.userData.carve) { old.image.data = rg; old.needsUpdate = true; }
    else {
      const t = new THREE.DataTexture(rg, tw, th, THREE.RGFormat, THREE.HalfFloatType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; t.userData.carve = true;
      U.uDepth.value = t; old.dispose();
    }
    U.uArt.value.set(artW, artH); U.uTexel.value.set(1 / tw, 1 / th); U.uMaxDepth.value = maxDepth;
    // cut line sits where the area-averaged depth reaches ~1/4 texel of V slope
    U.uEdge.value = Math.min(0.25 * (artW / tw) * 1.7, maxDepth * 0.05);
    this.buildMeshes();
    this.group.visible = true;
    if (first) this.setView('angle');
    this.placeLight();
  }

  // flat grid (x0..x1, z0..z1) at nx*nz quads, plus a half-density index over the same vertices for draft frames
  grid(x0, z0, x1, z1, nx, nz) {
    const key = [x0, z0, x1, z1, nx, nz].join(',');
    if (this.grids.has(key)) return this.grids.get(key);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    let k = 0;
    for (let j = 0; j <= nz; j++) {
      const v = z0 + (z1 - z0) * j / nz;
      for (let i = 0; i <= nx; i++) { pos[k++] = x0 + (x1 - x0) * i / nx; pos[k++] = 0; pos[k++] = v; }
    }
    const attr = new THREE.BufferAttribute(pos, 3);
    const index = (stride) => {
      const cols = [], rows = [];
      for (let i = 0; i < nx; i += stride) cols.push(i); cols.push(nx);
      for (let j = 0; j < nz; j += stride) rows.push(j); rows.push(nz);
      const idx = new Uint32Array((cols.length - 1) * (rows.length - 1) * 6); let n = 0;
      for (let b = 0; b < rows.length - 1; b++) for (let a = 0; a < cols.length - 1; a++) {
        const p = rows[b] * (nx + 1) + cols[a], q = rows[b] * (nx + 1) + cols[a + 1], c = rows[b + 1] * (nx + 1) + cols[a], d = rows[b + 1] * (nx + 1) + cols[a + 1];
        idx[n++] = p; idx[n++] = c; idx[n++] = q; idx[n++] = q; idx[n++] = c; idx[n++] = d;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', attr); g.setIndex(new THREE.BufferAttribute(idx, 1)); return g;
    };
    const full = index(1), draft = Math.max(nx, nz) > 600 ? index(2) : full;
    const out = { full, draft };
    if (this.grids.size > 6) { for (const [kk, gg] of this.grids) { gg.full.dispose(); if (gg.draft !== gg.full) gg.draft.dispose(); this.grids.delete(kk); break; } }
    this.grids.set(key, out);
    return out;
  }

  // picks the (cached) grids for the current art size, margin, detail and fill state; no per-vertex work after the first time
  buildMeshes(artW, artH) {
    this.dirty = true; this.shadowDirty = true;
    const D = this.depth || { artW: artW || 300, artH: artH || 300, tw: 1024, th: 1024 };
    const S = this.state, m = S.margin, T = S.thickness;
    this.group.position.set(-D.artW / 2, T, -D.artH / 2); // board origin at art top-left; board sits on the floor
    this.uniforms.uOrigin.value.copy(this.group.position);
    this.floor.position.y = 0;
    const flushFill = S.sanded && ['epoxy', 'inlay', 'reverse'].includes(S.fill);
    const step = Math.max(D.artW, D.artH) / Math.min(S.meshRes, Math.max(D.tw, D.th));
    const x0 = -m, z0 = -m, x1 = D.artW + m, z1 = D.artH + m;
    this.uniforms.uBakeRect.value.set(x0, z0, x1 - x0, z1 - z0);
    this.topGrid = flushFill ? this.grid(x0, z0, x1, z1, 8, 8) : this.grid(x0, z0, x1, z1, Math.round((x1 - x0) / step), Math.round((z1 - z0) / step));
    this.sides.geometry = this.sideGeometry(x0, z0, x1, z1, -T);
    const over = !S.sanded && ['epoxy', 'inlay', 'reverse'].includes(S.fill);
    this.fillMesh.visible = over;
    this.fillGrid = over ? this.grid(0, 0, D.artW, D.artH, Math.round(D.artW / step), Math.round(D.artH / step)) : null;
    this.uniforms.uOver.value = S.fill === 'epoxy' ? 0.9 : 1.6;
    this.uniforms.uStep.value = step;
    this.uniforms.uFlat.value = flushFill;
    this.applyGrids();
  }
  applyGrids() {
    const q = this.quality === 'draft' ? 'draft' : 'full';
    this.board.geometry = this.topGrid[q];
    if (this.fillGrid) this.fillMesh.geometry = this.fillGrid[q];
  }

  sideGeometry(x0, z0, x1, z1, yb) {   // the margin is never carved, so the edges are a plain box
    const key = [x0, z0, x1, z1, yb].join(',');
    if (this._sideKey === key) return this._side;
    if (this._side) this._side.dispose();
    const P = [], N = [], I = [];
    const quad = (a, b, c, d, n) => { const o = P.length / 3; P.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) N.push(...n); I.push(o, o + 1, o + 2, o + 2, o + 1, o + 3); };
    quad([x0, 0, z1], [x0, yb, z1], [x1, 0, z1], [x1, yb, z1], [0, 0, 1]);     // front
    quad([x1, 0, z0], [x1, yb, z0], [x0, 0, z0], [x0, yb, z0], [0, 0, -1]);    // back
    quad([x1, 0, z1], [x1, yb, z1], [x1, 0, z0], [x1, yb, z0], [1, 0, 0]);     // right
    quad([x0, 0, z0], [x0, yb, z0], [x0, 0, z1], [x0, yb, z1], [-1, 0, 0]);    // left
    quad([x0, yb, z0], [x1, yb, z0], [x0, yb, z1], [x1, yb, z1], [0, -1, 0]);  // bottom
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
    this._sideKey = key; this._side = g;
    return g;
  }
  setMeshRes(res) { this.state.meshRes = res; this.buildMeshes(); }

  // ------------------------------------------------------------ materials & lighting
  setMaterial(o) {
    this.dirty = true;
    const prevFlush = this.flushKey();
    Object.assign(this.state, o);
    const S = this.state, U = this.uniforms;
    const pack = (sp, k) => {
      const s = SPECIES[sp]; const e = lin(s.early), l = lin(s.late), p = lin(s.pore), st = lin(s.streak);
      const W = U.uWood.value;
      W[k * 7 + 0].set(e.r, e.g, e.b, s.spacing); W[k * 7 + 1].set(l.r, l.g, l.b, s.contrast);
      W[k * 7 + 2].set(p.r, p.g, p.b, s.pore_amt); W[k * 7 + 3].set(s.ring_porous, s.rays, s.ribbon, s.warp);
      W[k * 7 + 4].set(s.figure, s.pore_len, s.sharp, s.limed); W[k * 7 + 5].set(st.r, st.g, st.b, s.streakAmt);
      W[k * 7 + 6].set(s.rough, s.straight || 0, 0, 0);
    };
    pack(S.species, 0); pack(S.insert, 1);
    const F = FINISHES[S.finish];
    U.uFinish.value.set(F.darken, F.sat, F.rough, F.coat); U.uFinishCoatRough.value = F.coatRough;
    U.uMode.value = { none: 0, epoxy: 1, inlay: 2, reverse: 3, char: 4 }[S.fill];
    U.uSanded.value = !!S.sanded;
    const P = FILLS[S.fillPreset];
    U.uFillType.value = P.type; U.uFillColor.value.set(P.color); U.uFillRough.value = P.rough;
    const ab = P.absorb || [1, 1, 1]; U.uFillAbsorb.value.set(ab[0], ab[1], ab[2]);
    U.uFillScatter.value.set(P.scatter || '#000000');
    U.uGlowColor.value.set(P.glow || '#000000'); U.uGlow.value = P.type === 3 ? (S.glow ?? 2.2) : 0;
    if (this.flushKey() !== prevFlush) this.buildMeshes();
    this.updateBloom();
  }
  flushKey() { const S = this.state; return [S.sanded, S.fill, S.meshRes, S.margin].join('|'); }

  setLighting(o) {
    this.dirty = true;
    if (o.light && LIGHTS[o.light]) { const L = LIGHTS[o.light]; Object.assign(this.state, { az: L.az, el: L.el, key: L.key, env: L.env, warm: L.warm }); }
    Object.assign(this.state, o);
    const S = this.state;
    this.renderer.toneMappingExposure = S.exposure;
    this.key.intensity = S.key; this.key.color.set(S.warm || '#fff4e6');
    this.scene.environmentIntensity = S.env;
    this.fillLight.intensity = S.env * 0.15;
    const dark = S.backdrop === 'dark';
    const bg = dark ? 0x141312 : 0xd9d6d0;
    if (!this.scene.background) { this.scene.background = new THREE.Color(); this.scene.fog = new THREE.Fog(bg, 900, 2600); }
    this.scene.background.set(bg); this.scene.fog.color.set(bg);
    this.floorMat.color.set(dark ? 0x23211f : 0xbdb8b0);
    this.placeLight();
    this.updateBloom();
    this.shadowDirty = true;
  }

  placeLight() {
    const S = this.state, D = this.depth;
    const az = THREE.MathUtils.degToRad(S.az), el = THREE.MathUtils.degToRad(S.el);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const R = D ? Math.hypot(D.artW, D.artH) / 2 + S.margin + 10 : 260;
    this.key.position.copy(dir.clone().multiplyScalar(R * 3)).add(new THREE.Vector3(0, S.thickness, 0));
    this.key.target.position.set(0, S.thickness, 0);
    const c = this.key.shadow.camera; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = R * 1.5; c.far = R * 4.5;
    c.updateProjectionMatrix();
    this.uniforms.uKeyDir.value.copy(dir);
    this.shadowDirty = true; this.dirty = true;
  }

  updateBloom() {
    const S = this.state, glow = FILLS[S.fillPreset]?.type === 3 && ['epoxy'].includes(S.fill);
    this.bloomOn = glow;
    if (glow && !this.composer) {
      const size = this.renderer.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(size, 0.3, 0.25, 0.7);
      this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
      this.resize();
    }
    if (this.bloom) { this.bloom.strength = S.env < 0.2 ? 0.6 : 0.3; this.bloom.radius = S.env < 0.2 ? 0.35 : 0.3; this.bloom.threshold = 0.3; }
  }

  // ------------------------------------------------------------ camera
  setView(name) {
    this.dirty = true;
    const D = this.depth || { artW: 300, artH: 300 }, S = this.state;
    const R = Math.max(D.artW, D.artH) + 2 * S.margin, t = this.controls.target, cam = this.camera;
    const fit = R / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.12;
    if (name !== 'close') t.set(0, S.thickness, 0);
    const put = (pol, az, dist) => {
      pol = THREE.MathUtils.degToRad(pol); az = THREE.MathUtils.degToRad(az);
      cam.position.set(t.x + dist * Math.sin(pol) * Math.sin(az), t.y + dist * Math.cos(pol), t.z + dist * Math.sin(pol) * Math.cos(az));
    };
    if (name === 'top') put(0.01, 0, fit * 1.02);
    else if (name === 'angle') put(38, 18, fit * 1.18);
    else if (name === 'low') put(66, 30, fit * 1.25);
    else if (name === 'close') put(42, 22, fit * 0.28);
    else if (name === 'corner') { t.set(D.artW * 0.32, S.thickness, D.artH * 0.38); put(62, 40, fit * 0.6); }
    cam.lookAt(t); this.controls.update();
  }
  setCloseUp(u, v) { // art mm
    const D = this.depth, S = this.state; if (!D) return;
    this.controls.target.set(u - D.artW / 2, S.thickness, v - D.artH / 2); this.setView('close');
  }
  focusAt(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(p, this.camera);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.state.thickness), hit)) {
      const off = hit.clone().sub(this.controls.target);
      this.controls.target.add(off); this.camera.position.add(off);
    }
  }

  resize() {
    this.dirty = true;
    const w = this.el.clientWidth || 800, h = this.el.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }

  // ------------------------------------------------------------ on-demand rendering
  // draft while something is moving (orbit, zoom, a light slider), full quality once it settles
  interact() { this.lastMove = performance.now(); this.setQuality('draft'); this.dirty = true; }
  setQuality(q) {
    if (q === this.quality) return;
    const lighter = this.draftPR < this.fullPR || (this.topGrid && this.topGrid.draft !== this.topGrid.full);
    if (q === 'draft' && !lighter) return;
    this.quality = q;
    this.renderer.setPixelRatio(q === 'draft' ? this.draftPR : this.fullPR);
    this.applyGrids(); this.resize();
    if (q === 'full' && this.shadowDraft) this.shadowDirty = true;   // shadow drawn from the draft grid: redo it at full detail
  }
  // keep draft frames near 60 fps: drop the draft pixel ratio when frames run long, raise it back when there is headroom
  adapt(gap) {
    const g = this.frameGaps; g.push(gap); if (g.length < 8) return;
    const avg = g.reduce((a, b) => a + b, 0) / g.length; g.length = 0;
    const cap = Math.min(window.devicePixelRatio || 1, 1);
    let pr = this.draftPR;
    if (avg > 30 && pr > 0.5) pr = Math.max(0.5, pr * 0.8);
    else if (avg < 18 && pr < cap) pr = Math.min(cap, pr * 1.15);
    if (pr !== this.draftPR) { this.draftPR = pr; this.renderer.setPixelRatio(pr); this.resize(); }
  }
  requestRender(full = false) { if (full) this.setQuality('full'); this.dirty = true; }
  render() {
    if (this.group.visible) this.bakeIfNeeded();
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; this.shadowDraft = this.quality === 'draft'; }
    if (this.bloomOn && this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  async exportPNG(scale = 2) {
    if (this.warm) await this.warm;
    this.setQuality('full');
    const r = this.renderer, pr = r.getPixelRatio();
    r.setPixelRatio(pr * scale); this.resize();
    this.render();
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));   // same task as the render: no preserveDrawingBuffer needed
    r.setPixelRatio(pr); this.resize(); this.render();
    return blob;
  }
}
