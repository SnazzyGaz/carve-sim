import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PARS, VERT_PARS, VERT_MAIN } from './shader.js';
import { SPECIES, FINISHES, FILLS, LIGHTS } from './materials.js';

const lin = (hex) => new THREE.Color(hex); // ColorManagement: hex is sRGB -> stored linear

export class Viewer {
  constructor(container) {
    this.el = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 2, 6000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47; this.controls.minDistance = 25; this.controls.maxDistance = 2500;
    this.controls.zoomToCursor = true;
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.03).texture;
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
    this.mats = {};
    this.composer = null;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setLighting({});
    this.setMaterial({});
    this.dirty = true;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    const loop = () => { const moved = this.controls.update(); if (moved || this.dirty) { this.dirty = false; this.render(); } this.raf = requestAnimationFrame(loop); };
    loop();
    r.domElement.addEventListener('dblclick', (e) => this.focusAt(e));
  }

  makeUniforms() {
    const u = {
      uDepth: { value: null }, uArt: { value: new THREE.Vector2(300, 300) }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uMaxDepth: { value: 3 }, uEdge: { value: 0.02 }, uMode: { value: 0 }, uSanded: { value: true }, uFlat: { value: false },
      uWood: { value: Array.from({ length: 14 }, () => new THREE.Vector4()) }, uFinish: { value: new THREE.Vector4(1, 1, 0, 0) },
      uFinishCoatRough: { value: 0.3 }, uFillType: { value: 0 }, uFillColor: { value: new THREE.Color() },
      uFillAbsorb: { value: new THREE.Vector3(1, 1, 1) }, uFillScatter: { value: new THREE.Color() }, uGlowColor: { value: new THREE.Color() },
      uGlow: { value: 0 }, uFillRough: { value: 0.1 }, uCharScale: { value: 1.25 }, uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uOrigin: { value: new THREE.Vector3() },
    };
    return u;
  }

  material(part) {
    if (this.mats[part]) return this.mats[part];
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.3, envMapIntensity: 1 });
    const shared = this.uniforms;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, { uPart: { value: part } });
      sh.vertexShader = VERT_PARS + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN);
      let f = sh.fragmentShader;
      f = f.replace('void main() {', PARS + '\nvoid main() {');
      f = f.replace('#include <map_fragment>', 'surface(); diffuseColor.rgb = sAlb;');
      f = f.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(sRough, 0.04, 1.0);');
      f = f.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;');
      f = f.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n if (sOverrideN) { normal = normalize((viewMatrix * vec4(sN, 0.0)).xyz); }');
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

  makeBackdrop() {
    const g = new THREE.PlaneGeometry(6000, 6000);
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2927, roughness: 0.92, metalness: 0 });
    this.floor = new THREE.Mesh(g, this.floorMat);
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  // ------------------------------------------------------------ depth -> textures & meshes
  setDepth(depth, tw, th, artW, artH, maxDepth) {
    this.dirty = true;
    this.depth = { data: depth, tw, th, artW, artH, maxDepth };
    // blurred carve mask (~0.7 mm) for AO, lip scorch and resin wicking
    const mask = new Float32Array(tw * th);
    for (let i = 0; i < mask.length; i++) mask[i] = depth[i] > 1e-3 ? 1 : 0;
    const rad = Math.max(1, Math.round(0.45 * tw / artW));
    let a = mask, b = new Float32Array(mask.length);
    for (let pass = 0; pass < 3; pass++) { boxBlurH(a, b, tw, th, rad); boxBlurV(b, a, tw, th, rad); }
    const half = new Uint16Array(tw * th * 2);
    const toH = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < tw * th; i++) { half[2 * i] = toH(depth[i] / maxDepth); half[2 * i + 1] = toH(a[i]); }
    this.blur = a;
    if (this.uniforms.uDepth.value) this.uniforms.uDepth.value.dispose();
    const t = new THREE.DataTexture(half, tw, th, THREE.RGFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    const U = this.uniforms;
    U.uDepth.value = t; U.uArt.value.set(artW, artH); U.uTexel.value.set(1 / tw, 1 / th); U.uMaxDepth.value = maxDepth;
    // cut line sits where the area-averaged depth reaches ~1/4 texel of V slope
    U.uEdge.value = Math.min(0.25 * (artW / tw) * 1.7, maxDepth * 0.05);
    const first = !this.board;
    this.buildMeshes();
    if (first) this.setView('angle');
    this.placeLight();
  }

  sampleDepth(u, v) { // u,v in mm on the art; bilinear
    const D = this.depth; if (u < 0 || v < 0 || u > D.artW || v > D.artH) return 0;
    const x = Math.min(u / D.artW * D.tw - 0.5, D.tw - 1.001), y = Math.min(v / D.artH * D.th - 0.5, D.th - 1.001);
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y)), fx = Math.max(0, x - x0), fy = Math.max(0, y - y0);
    const i = y0 * D.tw + x0, d = D.data;
    return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + D.tw] * (1 - fx) + d[i + D.tw + 1] * fx) * fy;
  }
  sampleBlur(u, v) {
    const D = this.depth; if (u < 0 || v < 0 || u > D.artW || v > D.artH) return 0;
    const x = Math.min(Math.round(u / D.artW * D.tw), D.tw - 1), y = Math.min(Math.round(v / D.artH * D.th), D.th - 1);
    return this.blur[y * D.tw + x];
  }

  gridGeometry(x0, z0, x1, z1, nx, nz, heightFn) {
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    let k = 0;
    for (let j = 0; j <= nz; j++) {
      const v = z0 + (z1 - z0) * j / nz;
      for (let i = 0; i <= nx; i++) {
        const u = x0 + (x1 - x0) * i / nx;
        pos[k++] = u; pos[k++] = heightFn ? heightFn(u, v) : 0; pos[k++] = v;
      }
    }
    const idx = new Uint32Array(nx * nz * 6); k = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  buildMeshes() {
    this.dirty = true;
    const D = this.depth; if (!D) return;
    const S = this.state, m = S.margin, T = S.thickness;
    for (const o of [this.board, this.sides, this.fillMesh]) if (o) { this.group.remove(o); o.geometry.dispose(); }
    if (!this.group) { this.group = new THREE.Group(); this.scene.add(this.group); }
    this.group.position.set(-D.artW / 2, T, -D.artH / 2); // board origin at art top-left; board sits on the floor
    this.uniforms.uOrigin.value.copy(this.group.position);
    this.floor.position.y = 0;
    const flushFill = S.sanded && ['epoxy', 'inlay', 'reverse'].includes(S.fill);
    const res = S.meshRes;
    const step = Math.max(D.artW, D.artH) / Math.min(res, Math.max(D.tw, D.th));
    const x0 = -m, z0 = -m, x1 = D.artW + m, z1 = D.artH + m;
    const nx = flushFill ? 8 : Math.round((x1 - x0) / step), nz = flushFill ? 8 : Math.round((z1 - z0) / step);
    const hf = flushFill ? null : (u, v) => -this.sampleDepth(u, v);
    this.board = new THREE.Mesh(this.gridGeometry(x0, z0, x1, z1, nx, nz, hf), this.material(0));
    this.board.castShadow = true; this.board.receiveShadow = true;
    this.group.add(this.board);
    // sides + bottom following the edge profile
    const sideG = this.sideGeometry(x0, z0, x1, z1, flushFill ? 8 : nx, flushFill ? 8 : nz, hf, -T);
    this.sides = new THREE.Mesh(sideG, this.material(1));
    this.sides.castShadow = true; this.sides.receiveShadow = true;
    this.group.add(this.sides);
    this.fillMesh = null;
    if (!S.sanded && ['epoxy', 'inlay', 'reverse'].includes(S.fill)) {
      const over = S.fill === 'epoxy' ? 0.9 : 1.6;
      const fx = Math.round(D.artW / step), fz = Math.round(D.artH / step);
      const g = this.gridGeometry(0, 0, D.artW, D.artH, fx, fz, (u, v) => {
        const d = this.sampleDepth(u, v), b = this.sampleBlur(u, v);
        if (S.fill === 'epoxy') {
          const h = over * smoothstep(0.02, 0.55, b);       // overpour bulge with meniscus spill
          return Math.max(h, -d + 0.02) + (h < 0.03 && d < 0.02 ? -0.5 : 0);
        }
        return d > 0.02 ? over : -0.6;                          // plug standing proud of the pocket
      });
      // drop triangles that sit fully below the board top (not part of the pour)
      const pos = g.attributes.position.array, idx = g.index.array, keep = [];
      for (let i = 0; i < idx.length; i += 3) {
        const ya = pos[idx[i] * 3 + 1], yb = pos[idx[i + 1] * 3 + 1], yc = pos[idx[i + 2] * 3 + 1];
        if (Math.max(ya, yb, yc) > 0.015) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep); g.computeVertexNormals();
      this.fillMesh = new THREE.Mesh(g, this.material(2));
      this.fillMesh.castShadow = true; this.fillMesh.receiveShadow = true;
      this.group.add(this.fillMesh);
    }
    this.uniforms.uFlat.value = flushFill;
  }

  sideGeometry(x0, z0, x1, z1, nx, nz, hf, yb) {
    const P = [], I = [];
    const edge = (pts) => {
      const base = P.length / 3;
      for (const [u, v] of pts) { P.push(u, hf ? hf(u, v) : 0, v, u, yb, v); }
      for (let i = 0; i < pts.length - 1; i++) { const a = base + 2 * i; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    };
    const L = (a, b, n, f) => Array.from({ length: n + 1 }, (_, i) => f(a + (b - a) * i / n));
    edge(L(x0, x1, nx, (u) => [u, z1]));        // front
    edge(L(x1, x0, nx, (u) => [u, z0]));        // back
    edge(L(z1, z0, nz, (v) => [x1, v]));        // right
    edge(L(z0, z1, nz, (v) => [x0, v]));        // left
    const b = P.length / 3; P.push(x0, yb, z0, x1, yb, z0, x0, yb, z1, x1, yb, z1); I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
    // flat normals per face direction (avoid smoothing round the corners)
    g.computeVertexNormals();
    const n = g.attributes.normal.array, p = g.attributes.position.array;
    for (let i = 0; i < n.length; i += 3) {
      const u = p[i], y = p[i + 1], v = p[i + 2];
      if (Math.abs(y - yb) < 1e-6 && i / 3 >= b) { n[i] = 0; n[i + 1] = -1; n[i + 2] = 0; continue; }
      if (Math.abs(v - z1) < 1e-6 && i / 3 < (nx + 1) * 2) { n[i] = 0; n[i + 1] = 0; n[i + 2] = 1; }
      else if (Math.abs(v - z0) < 1e-6 && i / 3 < (nx + 1) * 4) { n[i] = 0; n[i + 1] = 0; n[i + 2] = -1; }
      else if (Math.abs(u - x1) < 1e-6) { n[i] = 1; n[i + 1] = 0; n[i + 2] = 0; }
      else if (Math.abs(u - x0) < 1e-6) { n[i] = -1; n[i + 1] = 0; n[i + 2] = 0; }
    }
    g.attributes.normal.needsUpdate = true;
    return g;
  }

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
    if (this.flushKey() !== prevFlush && this.depth) this.buildMeshes();
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
    this.scene.background = new THREE.Color(bg).multiplyScalar(dark ? 1 : 1);
    this.floorMat.color.set(dark ? 0x23211f : 0xbdb8b0);
    this.scene.fog = new THREE.Fog(bg, 900, 2600);
    this.placeLight();
    this.updateBloom();
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
  render() { if (this.bloomOn && this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

  async exportPNG(scale = 2) {
    const r = this.renderer, pr = r.getPixelRatio();
    r.setPixelRatio(pr * scale); this.resize();
    this.render();
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));
    r.setPixelRatio(pr); this.resize(); this.render();
    return blob;
  }
}

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function boxBlurH(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * k;
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * k;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}
