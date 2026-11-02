import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COMMON, PARS, VERT_MAIN, BAKE_VERT, BAKE_FRAG } from './shader.js';
import { SPECIES, FINISHES, FILLS, LIGHTS } from './materials.js';

const lin = (hex) => new THREE.Color(hex); // ColorManagement: hex is sRGB -> stored linear
const SETTLE_MS = 160;
// studio environment panels: [width, height, sRGB colour, radiance multiplier]; upward irradiance per unit env
// intensity is about ENV.irr (key ~0.55, front ~0.35, the rest ~0.1); the resin floor model uses it
const ENV = { room: '#1b1917', key: [4.5, 3.5, '#fff0dc', 7], strip: [2.5, 22, '#dde6ff', 1.4], front: [60, 40, '#fff4e8', 0.26], band: ['#ffeedd', 0.2], irr: 0.75 };                     // full-quality frame this long after the last movement

// Tone mapping. Default ("studio"): Khronos PBR Neutral, which reproduces base colours up to ~0.8 nearly 1:1 (species-true
// wood, coloured metal F0) and only rolls off true highlights, followed by Relief Forge 2.0.7's gentle S-curve and a touch of
// saturation for contrast (so it is not flat). EXPOSURE_CAL calibrates the studio preset so a maple top under the key lands
// on its swatch. AgX (Forge's base) was tried: it greys and darkens pale woods and turns gold highlights white.
// Dev overrides for look calibration: ?tm=studio|punchy (AgX Punchy look) &cal=<exposure calibration>
// float -> IEEE half bits (positive values only; for comparing against the RG half-float depth texture)
function toHalf(v) { const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0], e = ((u >> 23) & 0xff) - 127 + 15;
  if (e <= 0) return 0; if (e >= 31) return 0x7c00; return (e << 10) | ((u >> 13) & 0x3ff); }
const DEV = new URLSearchParams(location.search);
const TM = DEV.get('tm') || 'studio';
const EXPOSURE_CAL = +(DEV.get('cal') || 1.6);
if (TM === 'punchy') {
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
    const mat3 AgXInsetMatrix = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
      vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
    const mat3 AgXOutsetMatrix = mat3( vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
      vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ), vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 ) );
    const float AgxMinEv = - 12.47393; const float AgxMaxEv = 4.026069;
    color *= toneMappingExposure;
    color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
    color = AgXInsetMatrix * color;
    color = max( color, 1e-10 ); color = log2( color );
    color = clamp( ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv ), 0.0, 1.0 );
    color = agxDefaultContrastApprox( color );
    color = pow( max( color, 0.0 ), vec3( AGX_POWER ) );
    float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = l + AGX_SAT * ( color - l );
    color = AgXOutsetMatrix * color;
    color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
    color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
    return clamp( color, 0.0, 1.0 ); }`).replace('vec3 AgXToneMapping', (TM === 'agx' ? '#define AGX_POWER 1.0\n#define AGX_SAT 1.0' : '#define AGX_POWER 1.35\n#define AGX_SAT 1.4') + '\nvec3 AgXToneMapping');
} else {
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }',
    `vec3 CustomToneMapping( vec3 color ) {
    vec3 c = NeutralToneMapping( color );                              // applies toneMappingExposure
    float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    c = clamp( mix( vec3( l ), c, STUDIO_SAT ), 0.0, 1.0 );
    c = c * c * ( 3.0 - 2.0 * c ) * STUDIO_S + c * ( 1.0 - STUDIO_S );   // Forge's S-curve (display space)
    return c; }`).replace('vec3 CustomToneMapping', '#define STUDIO_SAT 1.08\n#define STUDIO_S 0.3\nvec3 CustomToneMapping');
}

// Bloom high-pass that only lets emissive light through: the board shaders write the emissive share of each pixel
// into alpha as (1 - share), so glossy highlights on the wood or resin never bloom, only the glowing pigment does.
const EMISSIVE_HIGHPASS = /* glsl */`
uniform sampler2D tDiffuse; uniform vec3 defaultColor; uniform float defaultOpacity; uniform float luminosityThreshold; uniform float smoothWidth;
varying vec2 vUv;
void main() {
  vec4 t = texture2D( tDiffuse, vUv );
  vec3 e = t.rgb * clamp( 1.0 - t.a, 0.0, 1.0 );
  float v = dot( e, vec3( 0.299, 0.587, 0.114 ) );
  gl_FragColor = mix( vec4( defaultColor, defaultOpacity ), vec4( e, 1.0 ), smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v ) );
}`;

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
    r.toneMapping = THREE.CustomToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; this.shadowDirty = true;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 2, 6000);
    this.controls = new OrbitControls(this.camera, r.domElement);
    // camera like Relief Forge 2.0.7's viewer: OrbitControls about a fixed world up (y), so there is no roll and the horizon
    // stays level; damping 0.12, screen-space panning; the polar angle is clamped so the camera never dips under the floor.
    // The board itself never rotates under the mouse; the only board motion is the Sway turntable about the vertical axis.
    this.camera.up.set(0, 1, 0);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12; this.controls.screenSpacePanning = true;
    this.controls.minPolarAngle = 0; this.controls.maxPolarAngle = Math.PI * 0.47; this.controls.minDistance = 25; this.controls.maxDistance = 2500;
    this.pmrem = new THREE.PMREMGenerator(r); this.envRT = null; this.envAt = '';
    this.makeEnvScene();
    this.key = new THREE.DirectionalLight(0xffffff, 2.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(4096, 4096);
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.3; this.key.shadow.radius = 3;   // PCF disc: a soft-box key, not a point
    this.scene.add(this.key, this.key.target);
    // Forge's fill: a soft cool directional light opposite the key, no shadow (lifts the shadow side and the board edges)
    this.fill = new THREE.DirectionalLight(0xc8d8ff, 0.25); this.scene.add(this.fill);
    this.keyDirW = new THREE.Vector3(0, 1, 0);
    this.state = { species: 'maple', insert: 'walnut', finish: 'oil', fill: 'none', fillPreset: 'black', sanded: true, fillLevel: 0, flood: false, menisc: 0.3,
                   light: 'studio', az: 220, el: 42, exposure: 1.0, env: 0.5, key: 2.0, warm: 0.2, fillLight: 0.25, shadows: true, ao: 0.25, backdrop: 'dark', sway: false, meshRes: 1024, margin: 18, thickness: 22 };
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
    let prev = 0; const t0 = performance.now();
    const loop = (now) => {
      let moved = this.controls.update();
      if (this.state.sway && this.group.visible) {
        // Forge's Sway: the board turns slowly to and fro about the vertical axis; camera, lights and floor stay put
        this.spin.rotation.y = Math.sin((now - t0) / 2600) * 0.38; this.shadowDirty = true; moved = true;
      }
      if (moved) this.lastMove = now;
      if (this.quality === 'draft') {
        if (prev && (moved || this.dirty)) this.adapt(now - prev);
        if (!this.interacting && !moved && now - this.lastMove > SETTLE_MS) { this.setQuality('full'); this.dirty = true; }
      }
      if (moved || this.dirty) { this.dirty = false; this.render(); }
      else if (this.bakePending() && !this.interacting && now - this.lastMove > SETTLE_MS && this.bakeStep()) this.dirty = true;   // full-res wood, a strip per idle frame
      prev = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    r.domElement.addEventListener('dblclick', (e) => this.focusAt(e));
    this.warmup();
  }

  makeUniforms() {
    const blank = new THREE.DataTexture(new Uint16Array([0xBC00, 0, 0, 0x3C00]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); blank.needsUpdate = true;
    const blankAO = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType); blankAO.needsUpdate = true;
    const u = {
      uDepth: { value: blank }, uArt: { value: new THREE.Vector2(300, 300) }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uMaxDepth: { value: 3 }, uSteps: { value: this.blankSteps() }, uStepD: { value: new THREE.Vector4() }, uStepK: { value: 1 }, uFK: { value: new THREE.Vector2() }, uGridStep: { value: 0.3 }, uMode: { value: 0 }, uSanded: { value: true }, uFlat: { value: false },
      uOver: { value: 0.9 }, uStep: { value: 0.3 }, uFillLevel: { value: 0 }, uFlood: { value: false }, uMenisc: { value: 0.3 },
      uDist: { value: this.blankDist() }, uBoardRect: { value: new THREE.Vector4(0, 0, 300, 300) },
      uWood: { value: Array.from({ length: 14 }, () => new THREE.Vector4()) }, uFinish: { value: new THREE.Vector4(1, 1, 0, 0) },
      uFinishCoatRough: { value: 0.3 }, uFillType: { value: 0 }, uFillColor: { value: new THREE.Color() },
      uFillAbsorb: { value: new THREE.Vector3(1, 1, 1) }, uFillScatter: { value: new THREE.Color() }, uGlowColor: { value: new THREE.Color() },
      uBakeA: { value: null }, uBakeB: { value: null }, uBakeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uAO: { value: blankAO }, uAOs: { value: 0.6 }, uPlugRot: { value: 1.35 }, uFillF0: { value: new THREE.Color() },
      uFillVein: { value: 0 }, uFillVeinCol: { value: new THREE.Color() }, uKeyShare: { value: 0.6 }, uGlueCol: { value: new THREE.Color('#3a2a1c') },
      uGlow: { value: 0 }, uFillRough: { value: 0.1 }, uCharScale: { value: 1.25 }, uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uOrigin: { value: new THREE.Vector3() }, uCamBoard: { value: new THREE.Vector3() }, uBoardRot: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) },
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
      f = f.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n if (sOverrideN) { normal = normalize((viewMatrix * vec4(uBoardRot * sN, 0.0)).xyz); }');
      // the clear coat follows the surface it lies on, except over a fill, where it is the resin's own (flat) top
      f = f.replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\n if (sOverrideN) clearcoatNormal = dot(sNc, sNc) > 0.5 ? normalize((viewMatrix * vec4(uBoardRot * sNc, 0.0)).xyz) : normal;\n#endif');
      f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = sEmis;');
      f = f.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.clearcoat = clamp(sCoat,0.0,1.0); material.clearcoatRoughness = clamp(sCoatRough + geometryRoughness, 0.02, 1.0);');
      // baked occlusion darkens only the light that comes from the environment (the key's own shadowing is the shadow
      // map); specular occlusion uses three's roughness-aware estimate, also for the clear coat
      f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>
 { float dNV = saturate(dot(normal, -normalize(vViewPosition)));
   reflectedLight.indirectDiffuse *= sAO;
   // under a finish film the wood's own reflection mostly vanishes (finish and cell walls have nearly the same index): the
   // film's top (clear coat) carries the gloss, so the base layer keeps only a share of its specular (no milky veil)
   float sp = sSpec * (sMetal > 0.5 ? 1.0 : mix(1.0, 0.3, clamp(sCoat, 0.0, 1.0)));
   reflectedLight.indirectSpecular *= computeSpecularOcclusion(dNV, sAO, material.roughness) * sp;
   reflectedLight.directSpecular *= sp;
   #if defined( USE_CLEARCOAT )
   clearcoatSpecularIndirect *= computeSpecularOcclusion(dNV, sAO, material.clearcoatRoughness);
   // the key's glint on a near-mirror coat: GGX's long tail, pushed through exposure and the S-curve, turned a sharp
   // glint into a big soft blob in close-ups. Squash the tail (x^2/(x+k)) and cap the core: small, crisp, still bright
   { float cm = max(max(clearcoatSpecularDirect.r, clearcoatSpecularDirect.g), clearcoatSpecularDirect.b);
     float kq = 1.2 + 8.0 * material.clearcoatRoughness;   // broader (satin) lobes are squashed harder: a sheen, not a blob
     clearcoatSpecularDirect *= min(cm / (cm + kq), 1.6 / max(cm, 1e-4)); }
   // the soft box's mirror image on a gloss coat: soft knee, so it reads as a crisp panel rather than a clipped blob
   { float cm = max(max(clearcoatSpecularIndirect.r, clearcoatSpecularIndirect.g), clearcoatSpecularIndirect.b);
     if (cm > 0.35) clearcoatSpecularIndirect *= (0.35 + 0.4 * (1.0 - exp(-(cm - 0.35) / 0.4))) / cm; }
   #endif
 }`);
      // alpha = 1 - emissive share of the pixel: the bloom high-pass reads it (the canvas itself has no alpha)
      f = f.replace('#include <opaque_fragment>', `
 // metals: compress only the brightest channel's overshoot (hue kept), so a gold highlight stays gold through the tone
 // map instead of washing to white
 if (sMetal > 0.5) { float mx = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
   if (mx > 0.55) outgoingLight *= (0.55 + 0.45 * (1.0 - exp(-(mx - 0.55) / 0.45))) / mx; }
 #include <opaque_fragment>
 { float eL = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722)), oL = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
   gl_FragColor.a = 1.0 - clamp(eL / max(oL, 1e-4), 0.0, 1.0); }`);
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
    this.bakeLong = Math.min(4096, max); this.bakeLoLong = Math.min(1024, this.bakeLong);
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace });
      rt.texture.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
      rt.texture.colorSpace = THREE.SRGBColorSpace;   // 8-bit sRGB storage keeps dark woods free of banding
      return rt;
    };
    this.bakeRT = [mk(), mk()]; this.bakeLoRT = [mk(), mk()];
    this.uniforms.uBakeA.value = this.bakeRT[0].texture; this.uniforms.uBakeB.value = this.bakeRT[1].texture;
    this.bakeMat = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG(),
      uniforms: Object.assign({}, this.uniforms, { uBakeK: { value: 0 }, uBakeFlat: { value: false }, uPart: { value: -1 } }), depthTest: false, depthWrite: false });
    this.bakeScene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bakeMat); q.frustumCulled = false; this.bakeScene.add(q);
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bakeKeys = ['', '']; this.bakeJobs = [null, null];
    // finished full-res bakes are kept per key (species / insert / carve), newest last, so switching back is instant;
    // the count is capped by a GPU memory budget (~280 MB of 8-bit RGBA + mips)
    this.mkBakeRT = mk; this.woodCache = new Map(); this.bakeFree = []; this.bakeHits = 0;
  }
  woodBudget(w, h) { return Math.max(2, Math.floor(280e6 / (w * h * 4 * 1.34))); }
  releaseBakeRT(rt) {   // an RT no slot shows any more: keep it if it holds a finished bake, else recycle it
    if (!rt || this.bakeRT.includes(rt) || [...this.woodCache.values()].includes(rt)) return;
    if (this.bakeFree.length < 1) this.bakeFree.push(rt); else rt.dispose();
  }
  takeBakeRT(w, h) {
    const inUse = (rt) => this.bakeRT.includes(rt);
    let rt = this.bakeFree.pop();
    if (!rt) {
      const budget = this.woodBudget(w, h);
      const live = this.woodCache.size + this.bakeRT.filter((r) => r && r.width > 16 && !this.isCached(r)).length;
      if (live + 1 > budget) {
        for (const [k, v] of this.woodCache) if (!inUse(v)) { this.woodCache.delete(k); rt = v; break; }
      }
    }
    return rt || this.mkBakeRT();
  }
  isCached(rt) { for (const v of this.woodCache.values()) if (v === rt) return true; return false; }
  trimWoodCache() {
    const any = this.woodCache.values().next().value; if (!any) return;
    const budget = this.woodBudget(any.width, any.height);
    for (const [k, v] of this.woodCache) {
      if (this.woodCache.size + this.bakeRT.filter((r) => r && r.width > 16 && !this.isCached(r)).length <= budget) break;
      if (!this.bakeRT.includes(v)) { this.woodCache.delete(k); v.dispose(); }
    }
  }
  flushWoodCache() {   // new carve or board size: every cached bake is stale
    const old = [...this.woodCache.values()]; this.woodCache.clear();
    for (const rt of old) this.releaseBakeRT(rt);
  }
  // Wood bake, progressive: a new carve or species first bakes a 1024 px preview (1/16 of the work, one short frame),
  // shown at once; the full 4096 px bake then runs in 16 horizontal strips, one per idle animation frame, and swaps in
  // when done. No single frame carries the whole 4K bake any more (it used to stall a species or threshold change).
  bakeIfNeeded() {
    const S = this.state, U = this.uniforms;
    const rect = U.uBakeRect.value, mode = U.uMode.value;
    const base = [this.depthVer || 0, rect.x, rect.y, rect.z, rect.w].join(',');
    if (base !== this.cacheBase) { this.cacheBase = base; this.flushWoodCache(); }
    const jobs = [[0, mode === 3 ? 1 : 0, false]];
    if (mode === 2 || mode === 3) jobs.push([1, mode === 2 ? 1 : 0, true]);
    for (const [slot, k, flat] of jobs) {
      const key = base + '|' + (k ? S.insert : S.species) + '|' + k + '|' + flat;
      if (this.bakeKeys[slot] === key) continue;
      this.bakeKeys[slot] = key;
      const prev = this.bakeRT[slot]; this.bakeJobs[slot] = null;
      const hit = this.woodCache.get(key);
      if (hit) {   // baked before (e.g. switching back to a species): reuse it, no work at all
        this.woodCache.delete(key); this.woodCache.set(key, hit);
        this.bakeRT[slot] = hit; this.releaseBakeRT(prev);
        (slot ? U.uBakeB : U.uBakeA).value = hit.texture; this.bakeHits++;
        continue;
      }
      const lo = this.bakeLoRT[slot], sl = this.bakeLoLong / Math.max(rect.z, rect.w);
      this.bakeInto(lo, k, flat, Math.max(16, Math.round(rect.z * sl)), Math.max(16, Math.round(rect.w * sl)));
      (slot ? U.uBakeB : U.uBakeA).value = lo.texture;
      const s = this.bakeLong / Math.max(rect.z, rect.w);
      const w = Math.max(16, Math.round(rect.z * s)), h = Math.max(16, Math.round(rect.w * s));
      this.bakeRT[slot] = null; this.releaseBakeRT(prev);
      const rt = this.takeBakeRT(w, h); this.bakeRT[slot] = rt;
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      this.bakeJobs[slot] = { k, flat, row: 0, step: Math.ceil(h / 16) };
    }
  }
  bakeInto(rt, k, flat, w, h, y0 = 0, rows = 0) {
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    this.bakeMat.uniforms.uBakeK.value = k; this.bakeMat.uniforms.uBakeFlat.value = flat;
    const strip = rows > 0 && rows < h;
    rt.texture.generateMipmaps = !strip || y0 + rows >= h;     // mipmaps once, with the last strip
    rt.scissorTest = strip; if (strip) rt.scissor.set(0, y0, w, Math.min(rows, h - y0));
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.render(this.bakeScene, this.bakeCam); r.setRenderTarget(prev);
    rt.scissorTest = false; rt.texture.generateMipmaps = true;
    this.bakes = (this.bakes || 0) + 1;
  }
  bakeStep(all = false) {   // one strip of each pending full-res bake; true when something swapped in
    let done = false;
    for (let slot = 0; slot < 2; slot++) {
      const j = this.bakeJobs[slot]; if (!j) continue;
      const rt = this.bakeRT[slot];
      do {
        this.bakeInto(rt, j.k, j.flat, rt.width, rt.height, j.row, all ? rt.height : j.step);
        j.row = all ? rt.height : j.row + j.step;
      } while (all && j.row < rt.height);
      if (j.row >= rt.height) {
        (slot ? this.uniforms.uBakeB : this.uniforms.uBakeA).value = rt.texture; this.bakeJobs[slot] = null; done = true;
        this.woodCache.set(this.bakeKeys[slot], rt); this.trimWoodCache();
      }
      if (!all) break;
    }
    return done;
  }
  bakePending() { return !!(this.bakeJobs[0] || this.bakeJobs[1]); }

  makeBackdrop() {
    const g = new THREE.PlaneGeometry(6000, 6000);
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2927, roughness: 0.92, metalness: 0 });
    this.floor = new THREE.Mesh(g, this.floorMat);
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  makeBoard() {
    this.group = new THREE.Group(); this.group.visible = false;
    this.spin = new THREE.Group(); this.spin.add(this.group); this.scene.add(this.spin);   // turntable pivot at the board centre
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
  // tex: Uint16Array RGBA half floats from the worker: r = signed mm to the cut line (+ inside, exact from the SVG
  // geometry), g = blurred carve mask, b = floor depth mm, a = wall slope. steps: pocket terraces (levels 2..5), or null.
  setDepth(tex, tw, th, artW, artH, maxDepth, ao = null, steps = null, fk = null) {
    this.dirty = true; this.shadowDirty = true;
    const first = !this.depth;
    this.depth = { tw, th, artW, artH, maxDepth }; this.depthVer = (this.depthVer || 0) + 1; this.rg = tex; this.rgStride = fk ? 2 : 4;
    const U = this.uniforms;
    const upload = (key, data, w, h, fmt, type, tag) => {
      const old = U[key].value;
      if (old.image.width === w && old.image.height === h && old.userData.carve === tag) { old.image.data = data; old.needsUpdate = true; return; }
      const t = new THREE.DataTexture(data, w, h, fmt, type);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.unpackAlignment = 1;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; t.userData.carve = tag;
      U[key].value = t; old.dispose();
    };
    // RG (sdf, mask) + the file's one floor depth / wall slope as uniforms, or RGBA with them per texel (mixed layers)
    upload('uDepth', tex, tw, th, fk ? THREE.RGFormat : THREE.RGBAFormat, THREE.HalfFloatType, fk ? 'rg' : 'rgba');
    U.uFK.value.set(fk ? fk[0] : 0, fk ? fk[1] : 0);
    if (ao) upload('uAO', ao, tw, th, THREE.RedFormat, THREE.UnsignedByteType, 'ao');
    if (steps) {
      upload('uSteps', steps.data, tw, th, steps.nc === 2 ? THREE.RGFormat : THREE.RGBAFormat, THREE.HalfFloatType, 'steps' + steps.nc);
      U.uStepD.value.set(...steps.d); U.uStepK.value = steps.k;
    } else {
      if (U.uSteps.value.userData.carve) { U.uSteps.value.dispose(); U.uSteps.value = this.blankSteps(); }
      U.uStepD.value.set(0, 0, 0, 0);
    }
    U.uArt.value.set(artW, artH); U.uTexel.value.set(1 / tw, 1 / th); U.uMaxDepth.value = maxDepth;
    this.buildMeshes();
    this.group.visible = true;
    if (first) this.setView('angle');
    this.placeLight();
  }
  blankSteps() { const t = new THREE.DataTexture(new Uint16Array([0xC800, 0xC800]), 1, 1, THREE.RGFormat, THREE.HalfFloatType); t.needsUpdate = true; return t; }

  // flat grid (x0..x1, z0..z1) at nx*nz quads, plus a half-density index over the same vertices for draft frames (any grid over 160 quads a side)
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
    const full = index(1), draft = Math.max(nx, nz) > 160 ? index(2) : full;
    const out = { full, draft };
    if (this.grids.size > 6) { for (const [kk, gg] of this.grids) { if (gg === this.topGrid || gg === this.fillGrid) continue; gg.full.dispose(); if (gg.draft !== gg.full) gg.draft.dispose(); this.grids.delete(kk); break; } }
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
    const step = this.lodStep(D); this.lodSt = step;
    const x0 = -m, z0 = -m, x1 = D.artW + m, z1 = D.artH + m;
    this.uniforms.uBakeRect.value.set(x0, z0, x1 - x0, z1 - z0); this.uniforms.uBoardRect.value.set(x0, z0, x1 - x0, z1 - z0);
    this.topGrid = flushFill ? this.grid(x0, z0, x1, z1, 8, 8) : this.grid(x0, z0, x1, z1, Math.round((x1 - x0) / step), Math.round((z1 - z0) / step));
    this.sides.geometry = this.sideGeometry(x0, z0, x1, z1, -T);
    const over = !S.sanded && ['epoxy', 'inlay', 'reverse'].includes(S.fill);
    this.fillMesh.visible = over;
    // as-poured epoxy: a grid over the art (pinned) or over the whole board top (flood coat)
    const flood = over && S.fill === 'epoxy' && S.flood;
    this.fillGrid = !over ? null : flood ? this.grid(x0, z0, x1, z1, Math.round((x1 - x0) / step), Math.round((z1 - z0) / step))
      : this.grid(0, 0, D.artW, D.artH, Math.round(D.artW / step), Math.round(D.artH / step));
    if (over && S.fill === 'epoxy') this.ensureDist();
    this.uniforms.uOver.value = S.fill === 'epoxy' ? 0.9 : 1.6;
    this.uniforms.uStep.value = step;
    this.uniforms.uFlat.value = flushFill;
    this.applyGrids();
  }
  applyGrids() {
    const q = this.quality === 'draft' ? 'draft' : 'full';
    this.board.geometry = this.topGrid[q];
    // vertices snap to the cut contours within about one grid step (draft frames use every other vertex)
    this.uniforms.uGridStep.value = q === 'draft' && this.topGrid.draft !== this.topGrid.full ? 0 : this.uniforms.uStep.value;   // draft frames (while dragging) skip the edge snap
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
  setBoard({ margin, thickness } = {}) {   // board around the art (mm) and its thickness; no re-bake of the carve
    if (margin != null) this.state.margin = Math.max(0, +margin);
    if (thickness != null) this.state.thickness = Math.max(3, +thickness);
    this.buildMeshes(); this.placeLight(); this.dirty = true; this.shadowDirty = true;
    if (this.requestRender) this.requestRender(true);
  }
  // Level of detail: the grid only has to be fine enough to carry the carve's silhouette, since every pixel's normal and
  // colour come from the depth map anyway. Quads smaller than ~1.5 screen pixels cost vertex work and, worse, make the
  // GPU shade each pixel several times (2x2-quad overshading of sub-pixel triangles with a heavy fragment shader), so
  // the grid coarsens in powers of two (at most 4x) when the whole board is on screen, and is full detail in close-ups.
  lodStep(D) {
    const S = this.state, base = Math.max(D.artW, D.artH) / Math.min(S.meshRes, Math.max(D.tw, D.th));
    const cam = this.camera, dist = cam.position.distanceTo(this.controls.target);
    const R = Math.max(D.artW, D.artH) / 2 + S.margin;
    const near = Math.max(dist - R, dist * 0.35, 1);
    const hpx = (this.el.clientHeight || 600) * this.fullPR * (this.exportScale || 1);
    const pxPerMm = hpx / (2 * near * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    const want = 1.5 / pxPerMm;
    let st = base; while (st * 2 <= want && st < base * 4) st *= 2;
    return st;
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
      W[k * 7 + 6].set(s.rough, s.straight || 0, s.pore_d || 0.1, s.ray_h || 0.6);
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
    U.uFillF0.value.set(P.f0 || P.color);
    U.uFillVein.value = P.vein ? 1 : 0; U.uFillVeinCol.value.set(P.vein || '#000000');
    U.uGlowColor.value.set(P.glow || '#000000'); U.uGlow.value = P.type === 3 ? (S.glow ?? 2.2) : 0;
    const pour = [S.fillLevel, S.flood, S.menisc].join('|');
    U.uFillLevel.value = S.fillLevel; U.uFlood.value = !!S.flood; U.uMenisc.value = S.menisc;
    if (pour !== this._pour) { this._pour = pour; this.shadowDirty = true; }   // the pour's shape changed: one shadow redraw
    if (this.flushKey() !== prevFlush) this.buildMeshes();
    this.updateBloom();
  }
  flushKey() { const S = this.state; return [S.sanded, S.fill, S.meshRes, S.margin, !!S.flood].join('|'); }
  blankDist() { const t = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType); t.needsUpdate = true; return t; }
  // shrinkage dish needs the distance from each point of a fill region to its edge: a two-pass 3-4 chamfer distance transform
  // of the carve mask at <= 512 px, once per depth map (only when an epoxy pour is shown), ~5-15 ms; the level, flood and
  // meniscus controls are then uniforms only
  ensureDist() {
    const D = this.depth; if (!D || !this.rg || this.distVer === this.depthVer) return;
    this.distVer = this.depthVer;
    const t0 = performance.now(), { tw, th, artW, artH, maxDepth } = D, sc = Math.min(1, 512 / Math.max(tw, th));
    const w = Math.max(2, Math.round(tw * sc)), h = Math.max(2, Math.round(th * sc));
    const rg = this.rg;   // r = signed distance as a half float: inside = positive (sign bit clear, not zero)
    const mm = artW / w, big = 1e9, f = new Float32Array(w * h);
    for (let j = 0; j < h; j++) { const sj = Math.min(th - 1, Math.floor((j + 0.5) / sc)); for (let i = 0; i < w; i++) { const si = Math.min(tw - 1, Math.floor((i + 0.5) / sc)); const hv = rg[(sj * tw + si) * this.rgStride]; f[j * w + i] = hv > 0 && hv < 0x8000 ? big : 0; } }
    const a = 1, b = 1.4142;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; let v = f[k]; if (!v) continue;
      if (i > 0) v = Math.min(v, f[k - 1] + a); if (j > 0) { v = Math.min(v, f[k - w] + a); if (i > 0) v = Math.min(v, f[k - w - 1] + b); if (i < w - 1) v = Math.min(v, f[k - w + 1] + b); } else v = Math.min(v, a);
      if (i === 0 || i === w - 1 || j === h - 1) v = Math.min(v, a); f[k] = v; }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) { const k = j * w + i; let v = f[k]; if (!v) continue;
      if (i < w - 1) v = Math.min(v, f[k + 1] + a); if (j < h - 1) { v = Math.min(v, f[k + w] + a); if (i < w - 1) v = Math.min(v, f[k + w + 1] + b); if (i > 0) v = Math.min(v, f[k + w - 1] + b); } f[k] = v; }
    const out = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) out[k] = Math.min(255, Math.round(Math.max(0, f[k] - 0.5) * mm / 8 * 255));
    const tx = new THREE.DataTexture(out, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tx.magFilter = tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false; tx.unpackAlignment = 1; tx.needsUpdate = true;
    this.uniforms.uDist.value.dispose(); this.uniforms.uDist.value = tx;
    this.distMs = performance.now() - t0;
  }

  setLighting(o) {
    this.dirty = true;
    if (o.light && LIGHTS[o.light]) { const L = LIGHTS[o.light]; Object.assign(this.state, { az: L.az, el: L.el, key: L.key, env: L.env, warm: L.warm, fillLight: L.fill, exposure: L.exp }); }
    Object.assign(this.state, o);
    const S = this.state;
    this.renderer.toneMappingExposure = S.exposure * EXPOSURE_CAL;
    this.key.intensity = S.key;
    // Forge warmth: white toward a warm tungsten (#ffcf9a) or a cool daylight (#bcd4ff)
    const w = +S.warm || 0; this.key.color.set(0xffffff).lerp(new THREE.Color(w >= 0 ? '#ffcf9a' : '#bcd4ff'), Math.min(Math.abs(w), 1));
    this.fill.intensity = S.fillLight ?? 0.25;
    if (this.key.castShadow !== (S.shadows !== false)) { this.key.castShadow = S.shadows !== false; this.shadowDirty = true; }
    this.scene.environmentIntensity = S.env;
    this.uniforms.uAOs.value = S.ao ?? 0.25;
    const dark = S.backdrop === 'dark';
    const bg = dark ? 0x141312 : 0xd9d6d0;
    if (!this.scene.background) { this.scene.background = new THREE.Color(); this.scene.fog = new THREE.Fog(bg, 900, 2600); }
    this.scene.background.set(bg); this.scene.fog.color.set(bg);
    this.floorMat.color.set(dark ? 0x23211f : 0xbdb8b0);
    // only a light that moved needs a new shadow map / environment; brightness, ambient, AO and exposure are uniforms
    const at = S.az + ',' + S.el;
    if (at !== this._lightAt) { this._lightAt = at; this.placeLight(); }
    else this.updateKeyShare();
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
    this.keyDirW.copy(dir); this.syncBoardFrame();
    // Forge places the fill opposite the key, at half the key's distance in height
    this.fill.position.set(-dir.x * R * 3, R * 1.5 + S.thickness, -dir.z * R * 3);
    this.fill.target = this.key.target;
    // share of the board top's irradiance that the key provides (the resin floor model needs it); the studio
    // environment gives roughly 4 units of irradiance per unit of intensity to an upward face (soft box ~2.9, front fill ~1, room)
    this.updateKeyShare();
    this.buildEnv();
    this.shadowDirty = true; this.dirty = true;
  }

  updateKeyShare() {
    const S = this.state, kE = S.key * Math.max(this.uniforms.uKeyDir.value.y, 0), fd = this.fill.position.clone().sub(this.key.target.position).normalize();
    const eE = S.env * ENV.irr + (S.fillLight ?? 0.25) * Math.max(fd.y, 0);
    this.uniforms.uKeyShare.value = kE / Math.max(kE + eE, 1e-3);
  }

  // ------------------------------------------------------------ studio environment
  // A tiny scene (dark room, warm soft box on the key side, cool strip light opposite, big soft front fill) turned into
  // a PMREM, so reflections in gloss, resin and metal show studio panels that move with the light. Rebuilt only when
  // the key moves, and never during a draft frame: while a light slider is dragged the old map stays, one rebuild
  // happens when it settles.
  makeEnvScene() {
    const sc = this.envScene = new THREE.Scene();
    sc.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.room), side: THREE.BackSide })));
    const panel = (w, h, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); sc.add(m); return m; };
    // a compact bright soft box (crisp highlight on gloss, not a white wash), a thin cool strip, a dim front fill, and a
    // low warm band around the horizon that lights the board's edges so end and side grain read in low views
    this.envKey = panel(...ENV.key); this.envStrip = panel(...ENV.strip); this.envFront = panel(...ENV.front);
    for (let i = 0; i < 4; i++) { const m = panel(96, 14, ENV.band[0], ENV.band[1]); const a = i * Math.PI / 2; m.position.set(Math.sin(a) * 47, 3, Math.cos(a) * 47); m.lookAt(0, 3, 0); }
    this.envFloor = panel(100, 100, '#2a2622', 1.0); this.envFloor.rotation.x = -Math.PI / 2; this.envFloor.position.y = -12;
  }
  buildEnv(force = false) {
    const S = this.state, key = S.az.toFixed(1) + ',' + S.el.toFixed(1);
    if (key === this.envAt) return;
    if (this.envRT && !force && this.quality === 'draft') { this.envPending = true; return; }
    this.envAt = key; this.envPending = false;
    const az = THREE.MathUtils.degToRad(S.az), el = THREE.MathUtils.degToRad(S.el);
    const put = (m, a, e, d) => { m.position.set(Math.cos(e) * Math.sin(a) * d, Math.sin(e) * d, Math.cos(e) * Math.cos(a) * d); m.lookAt(0, 0, 0); };
    put(this.envKey, az, Math.max(el, 0.45), 44); put(this.envStrip, az + Math.PI * 0.85, 0.35, 44); put(this.envFront, az + Math.PI, 1.0, 44);
    const rt = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = rt.texture; if (this.envRT) this.envRT.dispose(); this.envRT = rt;
    this.dirty = true;
  }

  updateBloom() {
    const S = this.state, glow = FILLS[S.fillPreset]?.type === 3 && ['epoxy'].includes(S.fill);
    this.bloomOn = glow;
    if (glow && !this.composer) {
      const size = this.renderer.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(size, 0.3, 0.2, 0.3);
      const hp = this.bloom.materialHighPassFilter; hp.fragmentShader = EMISSIVE_HIGHPASS; hp.needsUpdate = true;
      this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
      this.resize();
    }
    // only the emissive share reaches the bloom (see EMISSIVE_HIGHPASS); a tight radius keeps it a glow on the
    // pigment, not a haze over the board
    // A glow pour photographed in a dim room: the halo hugs the lit resin (only the two finest mips, high threshold so
    // just the brightest emissive pixels bloom) and the board stays readable around it.
    if (this.bloom) {
      const B = this.bloom, dim = S.env < 0.2;
      B.strength = dim ? 0.5 : 0.28; B.radius = 0.0; B.threshold = 0.4; B.highPassUniforms.smoothWidth.value = 0.2;
      B.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.6, 0.22, 0.04, 0.0];
    }
  }

  // ------------------------------------------------------------ camera
  setView(name) {
    this.dirty = true;
    if (!this.state.sway && this.spin.rotation.y) { this.spin.rotation.y = 0; this.shadowDirty = true; }   // as Forge's fit()
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
  setSway(on) {
    this.state.sway = !!on;
    if (!on) { this.spin.rotation.y = 0; this.shadowDirty = true; this.lastMove = performance.now(); }
    this.dirty = true;
  }
  setCloseUp(u, v) { // art mm
    const D = this.depth, S = this.state; if (!D) return;
    this.spin.updateMatrixWorld(true); this.controls.target.copy(this.group.localToWorld(new THREE.Vector3(u, 0, v))); this.setView('close');
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
    // always enter draft while moving: even when the grid has no coarser index, the adaptive pixel ratio needs it
    this.quality = q;
    this.renderer.setPixelRatio(q === 'draft' ? this.draftPR : this.fullPR);
    this.applyGrids(); this.resize();
    if (q === 'full' && this.shadowDraft) this.shadowDirty = true;
    if (q === 'full' && this.envPending) this.buildEnv(true);   // shadow drawn from the draft grid: redo it at full detail
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
  // the shaders work in board millimetres; with the turntable the board frame turns about world y, so the camera position,
  // the key direction and the normal rotation are handed over in that frame (cheap: three uniforms per frame)
  syncBoardFrame() {
    const U = this.uniforms; this.spin.updateMatrixWorld(true);
    U.uCamBoard.value.copy(this.camera.position); this.group.worldToLocal(U.uCamBoard.value);
    const ry = this.spin.rotation.y, c = Math.cos(ry), sn = Math.sin(ry), m = U.uBoardRot.value; m[0] = c; m[2] = -sn; m[6] = sn; m[8] = c;   // column-major rotation about y
    U.uKeyDir.value.copy(this.keyDirW).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.spin.rotation.y);
  }
  render() {
    this.syncBoardFrame();
    if (this.group.visible) this.bakeIfNeeded();
    if (this.quality === 'full' && this.depth && this.lodStep(this.depth) !== this.lodSt) this.buildMeshes();   // zoom settled: re-pick the grid
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; this.shadowDraft = this.quality === 'draft'; }
    if (this.bloomOn && this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  async exportPNG(scale = 2) {
    if (this.warm) await this.warm;
    this.setQuality('full');
    if (this.group.visible) { this.bakeIfNeeded(); this.bakeStep(true); }
    if (this.envPending) this.buildEnv(true);
    const r = this.renderer, pr = r.getPixelRatio(), gl = r.getContext();
    const maxDim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS), 16384);
    const cw = r.domElement.clientWidth || 1, ch = r.domElement.clientHeight || 1;
    scale = Math.max(1, Math.min(scale, maxDim / (Math.max(cw, ch) * pr)));
    r.setPixelRatio(pr * scale); this.exportScale = scale; this.resize();
    this.render();
    this.exportScale = 1;
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));   // same task as the render: no preserveDrawingBuffer needed
    r.setPixelRatio(pr); this.resize(); this.render();
    return blob;
  }
}
