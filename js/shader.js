// GLSL injected into MeshPhysicalMaterial: solid procedural wood, char, epoxy/inlay fills.
// Everything is in board millimetres: vBoard.x = across the art (u), vBoard.z = down the art (v),
// vBoard.y = height (0 = board top, negative = carved).
// Shared by the vertex shader (GPU displacement of a static grid), the shadow depth pass and the fragment shader.
export const COMMON = /* glsl */`
uniform sampler2D uDepth;     // exact SDF of the cut (from the SVG geometry): r = signed mm to the cut line (+ inside),
                              // g = blurred carve mask, b = floor depth mm, a = wall slope (mm of depth per mm)
uniform sampler2D uSteps;     // pocket terraces: signed mm to the outlines of levels 2..5, one per channel
uniform vec4 uStepD;          // depth each terrace adds, mm (0 = unused)
uniform float uStepK;         // terrace wall slope, 1/mm
uniform vec2 uFK;             // the file's one floor depth / wall slope when uDepth is RG (y = 0: per texel in .ba)
uniform float uGridStep;      // vertex grid step mm for the edge snap (0 on draft frames: no snap)
uniform vec2 uArt;            // art size mm
uniform float uMaxDepth;
uniform int uPart;            // 0 board top, 1 board sides, 2 fill overpour mesh
uniform int uMode;            // 0 none, 1 epoxy, 2 inlay, 3 reverse inlay, 4 char
uniform bool uFlat;           // top drawn flat (flush fills)
uniform float uOver;          // how proud the unsanded inlay plug stands, mm
uniform vec2 uTexel;          // 1/texture size
uniform float uFillLevel;     // as-poured epoxy level, mm against the board top (- under-filled, 0 flush, + overpour)
uniform bool uFlood;          // overpour spreads over the board as a level flood coat (else pinned at the channel: <= flush)
uniform float uMenisc;        // shrinkage dish + wall meniscus amount (0..1)
uniform sampler2D uDist;      // r = distance to the fill region's edge / DIST_MAX (low-res, baked once per depth map)
uniform vec4 uBoardRect;      // board top in board mm: x0, z0, width, height
varying vec3 vBoard;
const float DIST_MAX = 8.0;
bool outArt(vec2 uv){ return uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0; }
// Outside the art (the board margin) the cut distance carries on from the art's edge: the edge texel's value (never
// inside a cut) minus the mm out to that point. It used to jump to a fixed -1 mm, which the per-pixel coverage
// (sd / fwidth(sd)) read as an outline, so a thin line of "carve" or fill colour ran round the art rectangle.
vec4 sdfT(vec2 uv){
  vec2 c = clamp(uv, 0.0, 1.0);
  vec4 t = texture2D(uDepth, c);
  if (uFK.y > 0.0) t.ba = uFK;
  if (c != uv) { t.r = min(t.r, 0.0) - length((uv - c) * uArt); t.g = 0.0; }
  return t;
}
vec4 stepsT(vec2 uv){ return outArt(uv) ? vec4(-8.0) : texture2D(uSteps, uv); }
// depth from the SDF, per pixel / vertex: V walls at the bit's slope down to the floor (V-carve: depth = min(max, sdf /
// tan(a/2))), pockets a near-vertical wall onto a flat floor, engraves the V of a centreline; plus pocket terraces
float depthOf(vec4 t, vec2 uv){
  float d = clamp(t.r * t.a, 0.0, t.b);
  if (uStepD.x > 0.0) d += dot(uStepD, clamp(stepsT(uv) * uStepK, 0.0, 1.0));
  return d;
}
vec2 tex(vec2 uv){ vec4 t = sdfT(uv); return vec2(depthOf(t, uv), t.g); }   // x = depth mm, y = blurred carve mask
float depthAtC(vec2 uv){ return tex(uv).x; }
vec2 gradS(vec2 uv){   // gradient of the cut SDF (unit length away from the medial axis)
  vec2 e = uTexel;
  return vec2(sdfT(uv + vec2(e.x, 0.0)).r - sdfT(uv - vec2(e.x, 0.0)).r, sdfT(uv + vec2(0.0, e.y)).r - sdfT(uv - vec2(0.0, e.y)).r) / (2.0 * e * uArt);
}
vec2 gradStep(vec2 uv, vec4 sel){
  vec2 e = uTexel;
  return vec2(dot(stepsT(uv + vec2(e.x, 0.0)) - stepsT(uv - vec2(e.x, 0.0)), sel), dot(stepsT(uv + vec2(0.0, e.y)) - stepsT(uv - vec2(0.0, e.y)), sel)) / (2.0 * e * uArt);
}
// Grid vertices near a contour (the lip s = 0 or the foot of the wall s = w) slide along the SDF gradient onto it, so the
// displaced mesh has an edge exactly on the cut line instead of a stair-step at the grid spacing. Lip: from one grid step
// outside to half a step inside; foot: half a step either side (a full step outside it for thin pocket walls).
bool snapBand(float s, float w, float c, out float tgt){
  // top and floor are flat, so pulling a vertex from either onto its contour cannot dent them: the bands reach far
  // enough (1.5 grid steps) that every grid quad straddling a wall has both its rows on the wall's two contours
  if (s > -1.5 * c && s < min(0.5 * w, 0.5 * c)) { tgt = 0.0; return true; }
  if (s >= max(0.5 * w, w - 0.5 * c) && s < w + (w < 2.0 * c ? 1.5 * c : 0.5 * c)) { tgt = w; return true; }
  return false;
}
vec2 snapEdge(vec2 p){
  // the nearest contour wins (lip/foot of the main cut or of a terrace step), so stacked terrace walls do not fight
  float c = uGridStep, tgt, best = 1e9, bt = 0.0; int which = -1;
  if (c <= 0.0) return p;
  vec4 t = sdfT(p / uArt);
  if (snapBand(t.r, t.b / max(t.a, 1e-4), c, tgt)) { best = abs(t.r - tgt); bt = tgt; which = 4; }
  vec4 q = vec4(-8.0);
  if (uStepD.x > 0.0){
    q = stepsT(p / uArt);
    for (int i = 0; i < 4; i++){
      if (uStepD[i] <= 0.0) break;
      if (snapBand(q[i], 1.0 / uStepK, c, tgt) && abs(q[i] - tgt) < best) { best = abs(q[i] - tgt); bt = tgt; which = i; }
    }
  }
  if (which < 0) return p;
  vec4 sel = vec4(0.0); if (which < 4) sel[which] = 1.0;
  float s = which == 4 ? t.r : dot(q, sel);
  vec2 p0 = p;
  for (int it = 0; it < 3; it++){
    vec2 g = which == 4 ? gradS(p / uArt) : gradStep(p / uArt, sel);
    float g2 = dot(g, g); if (g2 < 0.09) break;
    p += g * ((bt - s) / g2);
    s = which == 4 ? sdfT(p / uArt).r : dot(stepsT(p / uArt), sel);
  }
  // a vertex that cannot reach its contour within a grid step (corners, medial axis) stays put rather than spike
  return (abs(s - bt) < 0.25 * c && length(p - p0) < 2.0 * c) ? p : p0;
}
// unsanded fill surface height (board mm, 0 = board top): epoxy overpour bulge with meniscus spill, or a proud inlay plug.
// Points well under the board top drop below it, where the board hides them.
varying float vHide;
float fHide;   // set by fillH: 1 where there is no resin at this point (vertex hide flag)
float fillH(vec2 p){
  vec2 uv = p / uArt;
  vec4 tt = sdfT(uv); float d = depthOf(tt, uv);
  fHide = 0.0;
  if (uMode == 1){
    // as-poured epoxy at a set level, all against the baked depth (no rebake when the level moves):
    //  - shrinkage: resin shrinks ~1-2% of its thickness as it cures, so wide/deep pours dish in the middle (the dish
    //    follows the low-res distance-to-edge field) and a flood coat telegraphs faint dips over the channels;
    //  - meniscus: at a free edge the resin wets the wall and climbs it a little (0.2 mm at full), measured from the
    //    contact line with the local wall slope (sub-texel exact, like the glue line);
    //  - pinned (default): the level can't rise above the board top inside the carve outline; flood: above flush the
    //    resin is one level coat over the whole board top, eased off at the board edge.
    float dist = texture2D(uDist, clamp(uv, 0.0, 1.0)).r * DIST_MAX;
    if (uFlood && uFillLevel > 0.0){
      vec2 q = p - uBoardRect.xy; float e = min(min(q.x, uBoardRect.z - q.x), min(q.y, uBoardRect.w - q.y));
      if (e < 0.0) { fHide = 1.0; return -1.0; }
      float tel = uMenisc * 0.03 * d * smoothstep(0.0, 3.0, dist);
      return uFillLevel * smoothstep(-0.6, 2.4, e) * (1.0 - 0.25 * smoothstep(1.0, 0.0, e)) - tel;
    }
    float L = min(uFillLevel, 0.0);
    float res = d + L;                                             // resin thickness here
    if (tt.r <= 0.0 || res < -0.6) { fHide = 1.0; return min(-d, 0.0) - 0.6; }
    // wall slope at the contact line: analytic from the SDF (slope K on the wall, flat on the floor); terraces fall back
    // to finite differences of the depth
    float sl = uStepD.x <= 0.0 ? (tt.r * tt.a < tt.b ? max(tt.a, 0.05) : 0.05) : max(length(vec2((depthAtC(uv + vec2(uTexel.x, 0.0)) - depthAtC(uv - vec2(uTexel.x, 0.0))) / (2.0 * uTexel.x * uArt.x),
                               (depthAtC(uv + vec2(0.0, uTexel.y)) - depthAtC(uv - vec2(0.0, uTexel.y))) / (2.0 * uTexel.y * uArt.y))), 0.05);
    float dc = max(res, 0.0) / sl;                                 // mm in from the contact line
    float men = uMenisc * 0.2 * exp(-dc / 0.4);
    float dish = uMenisc * 0.04 * max(res, 0.0) * smoothstep(0.2, 4.0, dist);
    return min(L + men - dish, 0.0);
  }
  // inlay plug standing proud before levelling, with a slight (~0.3 mm) eased edge instead of a vertical cliff
  if (d <= 0.02) fHide = 1.0;
  return d > 0.02 ? uOver * smoothstep(0.02, 0.5, d) : -0.6;
}
`;

export const PARS = /* glsl */`
uniform float uStep;          // grid step mm (fill normals)
uniform bool uSanded;
uniform vec4 uWood[14];       // 2 species x 7 vec4
uniform vec4 uFinish;         // darken, sat, rough add, coat
uniform float uFinishCoatRough;
uniform int uFillType;
uniform vec3 uFillColor;
uniform vec3 uFillAbsorb;
uniform vec3 uFillScatter;
uniform float uFillRough;
uniform float uCharScale;
uniform vec3 uKeyDir;         // dir to the key light, in the board frame (the board can sway about y)
uniform vec3 uCamBoard;       // camera position in board mm
uniform mat3 uBoardRot;       // board frame -> world rotation
uniform vec3 uOrigin;         // world position of the art's top-left corner on the board top
uniform sampler2D uBakeA;     // baked wood of the board top & carve (rgb = albedo * 0.75, a = roughness), mipmapped
uniform sampler2D uBakeB;     // baked insert wood for inlays (flat)
uniform vec4 uBakeRect;       // board mm covered by the bakes: x0, z0, width, height
uniform sampler2D uAO;        // r = baked occlusion of the carve (sky visibility lost), from the worker
uniform float uAOs;           // AO strength (1 = the physical estimate)
uniform float uPlugRot;       // grain angle of the inlay plug (radians): it is cut from its own board
uniform vec3 uFillF0;         // metal fills: reflectance at normal incidence (linear)
uniform float uFillVein;      // opaque fills: 3D marbled veins
uniform vec3 uFillVeinCol;
uniform float uKeyShare;      // share of the board-top irradiance that comes from the key light (rest: environment)
uniform vec3 uGlueCol;

float sSpec; vec3 sAlb; float sRough; float sMetal; float sCoat; float sCoatRough; vec3 sEmis; vec3 sN; vec3 sNc; float sAO; bool sOverrideN;

// ---- noise (Ashima / Gustavson simplex, MIT)
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
uint hashu(uvec2 q){ q=q*uvec2(1597334673u,3812015801u); uint n=(q.x^q.y)*1597334673u; n^=n>>16; n*=2246822519u; n^=n>>13; return n; }
vec2 hash2(vec2 p){ ivec2 i=ivec2(floor(p)); uvec2 u=uvec2(i+ivec2(32768)); uint a=hashu(u); uint b=hashu(u+uvec2(91u,17u)); return vec2(float(a&0xffffu),float(b&0xffffu))/65535.0; }
float hash1(vec2 p){ return hash2(p).x; }
// band-limit: fade a feature of frequency f (cycles/mm) to its mean once it gets near a pixel
float aaFade(float coordFw, float freq){ return 1.0-smoothstep(0.18,0.55,coordFw*freq); }
// cheap 3D value noise + fbm (marbled fills only)
float vH3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vN3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vH3(i), vH3(i + vec3(1, 0, 0)), f.x), mix(vH3(i + vec3(0, 1, 0)), vH3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vH3(i + vec3(0, 0, 1)), vH3(i + vec3(1, 0, 1)), f.x), mix(vH3(i + vec3(0, 1, 1)), vH3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float vFbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vN3(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
// 1D box filter of a line of width w centred on 0, seen through a pixel of width px at offset x: exact coverage at any zoom
float lineCover(float x, float w, float px){ px = max(px, 1e-4); return clamp((min(x + 0.5*px, 0.5*w) - max(x - 0.5*px, -0.5*w)) / px, 0.0, 1.0); }
// the inlay plug is cut from its own board: its grain runs at uPlugRot to the field's
vec3 plugP(vec3 p){ float c = cos(uPlugRot), s = sin(uPlugRot); return vec3(c*p.x - s*p.z, p.y, s*p.x + c*p.z); }

vec4 W(int k,int i){ return uWood[k*7+i]; }

#if CARVE_PART == 1 || defined(CARVE_BAKE)
// Solid wood, evaluated in board space so every cut face (top, V walls, pocket floors, board edges) shows the grain it
// really exposes. The board is flat-sawn from a log whose pith runs along x about 260 mm under it, slightly tilted, so
// the top shows cathedrals, the long edges are near quarter-sawn (ray fleck) and the ends are end grain.
// Pores are vessels: tubes along the fibre on a jittered (radial x arc) lattice, rows of big ones in the earlywood of
// ring-porous species (oak, ash). Rays are radial ribbons, thin across the arc and tall along the fibre. Both are real
// geometry cut by the surface, so a shallow cut through a tube reads as a dash and end grain reads as dots and lines.
vec3 wood(vec3 p, int k, out float rough){
  vec4 c0=W(k,0), c1=W(k,1), c2=W(k,2), c3=W(k,3), c4=W(k,4), c5=W(k,5), c6=W(k,6);
  p += vec3(float(k)*173.0, 0.0, float(k)*61.0);
  float spacing=c0.w, contrast=c1.w, poreAmt=c2.w, ringPorous=c3.x, rays=c3.y, ribbon=c3.z, warp=c3.w;
  float figure=c4.x, sharp=c4.z, limed=c4.w, streakAmt=c5.w, baseRough=c6.x;
  float straight=c6.y, poreD=max(c6.z, 0.02), rayH=max(c6.w, 0.2);
  float fwz = length(vec2(dFdx(p.z),dFdy(p.z))) + length(vec2(dFdx(p.y),dFdy(p.y)))*0.5 + 1e-5;
  float w1 = snoise(vec3(p.x*0.0035, p.z*0.010, p.y*0.010));
  float w2 = snoise(vec3(p.x*0.004+5.2, p.z*0.035, p.y*0.035));
  float w3 = snoise(vec3(p.x*0.012+1.7, p.z*0.12, p.y*0.12));
  // pith ~330 mm under the board and off to one side: one cathedral crown toward an edge, straighter stripes elsewhere (a
  // centred, shallow pith made the whole top a field of contour-map loops). The ring wobble is kept small: on a face almost
  // tangent to the rings, a fraction of a mm of wobble already swings the ring lines tens of mm sideways.
  float vc = 70.0 + straight*600.0 + p.x*0.05*(1.0-straight) + w1*warp*18.0;
  float yc = -330.0 + p.x*0.08 + w1*warp*8.0;
  vec2 q = vec2(p.z - vc, p.y - yc);
  float r = length(q) + w2*warp*0.55 + w3*0.07*warp;
  float ang = atan(q.x, q.y);                        // around the pith, 0 = straight up through the board
  // uneven ring widths (good and bad growth years) + a slow wobble along the length
  float wob = snoise(vec3(p.x*0.018, r*0.22, 3.3));
  float ringPos = r/spacing + 0.9*snoise(vec3(r*0.045, 7.7, float(k))) + 0.12*wob;
  float f = fract(ringPos), ri = floor(ringPos);
  float yr = hash1(vec2(ri, float(k)*3.1));
  // earlywood flat, latewood a defined band (so tangential cuts read as crisp cathedral bands, not soft shading)
  float lw0 = clamp(1.0 - 1.6/(sharp+1.0), 0.35, 0.8) - 0.12*yr;
  float fr = length(vec2(dFdx(ringPos),dFdy(ringPos)));
  float ew = clamp(fr*1.5, 0.015, 0.2);
  float late = 0.28*f + 0.72*smoothstep(lw0 - ew, lw0 + ew, f);
  late *= (1.0 - smoothstep(1.0 - 2.0*ew, 1.0, f));
  late = mix(late, 0.8/(sharp+1.0), 1.0-aaFade(fr,1.0));
  vec3 col = mix(c0.rgb, c1.rgb, clamp(late*contrast*mix(0.85,1.25,yr),0.0,1.0));
  // long tonal streaks (figure) and dark/light streak bands (walnut, wenge)
  float fig = snoise(vec3(p.x*0.005, p.z*0.06, p.y*0.06));
  col *= 1.0 + figure*fig*0.55;
  float st = snoise(vec3(p.x*0.012+9.1, p.z*0.55, p.y*0.55));
  st = mix(st, 0.0, 1.0-aaFade(fwz,0.55));
  col = mix(col, c5.rgb, clamp(smoothstep(0.15,0.85,st)*streakAmt,0.0,1.0));

  // ---- vessels (pores)
  float rr = f * spacing;                                          // mm into this growth ring (0 = start of earlywood)
  float s = ang * r + w3 * 2.0 + w2 * 0.6;                         // arc mm, tubes wander gently along the length
  float ewW = min(spacing * 0.42, poreD * 3.6);                    // earlywood pore zone of ring-porous wood
  bool early = ringPorous > 0.5 && rr < ewW;
  float cR = poreD * (early ? 1.25 : 2.3), cS = poreD * (early ? 1.55 : 2.5);
  vec2 cell = vec2(floor(rr / cR), floor(s / cS));
  vec2 h = hash2(cell + vec2(ri * 7.0 + float(k) * 31.0, 0.0));
  float hp = hash1(cell.yx + vec2(ri * 3.7, 11.0));
  float rad = 0.5 * poreD * (early ? mix(0.8, 1.15, h.x) : mix(0.5, 0.9, h.x));
  if (ringPorous > 0.5 && !early) rad *= 0.38;                     // latewood vessels of oak/ash are small
  float prob = ringPorous > 0.5 ? (early ? 0.85 : 0.3) : mix(0.55, 0.75, ringPorous);
  vec2 ctr = (cell + 0.5 + (h - 0.5) * vec2(max(0.0, 1.0 - 2.0*rad/cR), max(0.0, 1.0 - 2.0*rad/cS))) * vec2(cR, cS);
  float pxm = fwz + 1e-4;                                          // surface footprint, mm
  float pd = length(vec2(rr, s) - ctr);
  // vessels are chains of short elements: on a long-grain face they read as dashes, not endless scratches
  float lenP = poreD * 16.0;
  float xi = floor((p.x + h.y * lenP) / lenP);
  float on = hash1(cell + vec2(xi * 13.0, ri)) < 0.8 ? 1.0 : 0.0;
  float pSharp = (hp < prob ? on : 0.0) * (1.0 - smoothstep(rad - 0.5*pxm, rad + 0.5*pxm, pd));
  float pMean = 0.8 * prob * 3.14159 * rad * rad / (cR * cS);            // what a pixel sees once the pores are sub-pixel
  float pores = mix(pMean, pSharp, aaFade(pxm, 0.5 / max(rad, 0.01)));
  col = mix(col, c2.rgb, clamp(pores * poreAmt * 1.6, 0.0, 1.0));

  // ---- rays: radial ribbons (constant angle), staggered along the fibre, lens-shaped
  float ray = 0.0;
  if (rays > 0.0){
    float rayS = 0.5 + rayH * 0.12;                                // tangential spacing, mm (at the board)
    float rayW = clamp(0.035 + rayH * 0.018, 0.03, 0.36);          // ray width, mm
    float sa = ang * 260.0;
    float ia = floor(sa / rayS);
    vec2 ha = hash2(vec2(ia, float(k) * 5.0 + 3.0));
    float len = rayH * mix(0.6, 1.4, ha.y), cx = len * 1.7;
    float xs = p.x + ha.x * cx;
    float ix = floor(xs / cx), u = fract(xs / cx) * cx / len;     // u in 0..1 along this ray, > 1 is the gap to the next
    vec2 hb = hash2(vec2(ia, ix + floor(r / 40.0) * 57.0));
    float on = (hb.x < 0.75 && u < 1.0) ? 1.0 : 0.0;
    float half_ = 0.5 * rayW * mix(0.6, 1.3, hb.y) * sqrt(max(0.0, 1.0 - (2.0*u - 1.0)*(2.0*u - 1.0)));
    float dA = abs(ang - (ia + 0.5 + (ha.x - 0.5) * 0.5) * rayS / 260.0) * r;   // arc distance to the ray, mm
    float rSharp = on * (1.0 - smoothstep(half_ - 0.5*pxm, half_ + 0.5*pxm, dA));
    float rMean = 0.75 * 0.5 * 0.785 * rayW / rayS;
    ray = mix(rMean, rSharp, aaFade(pxm, 0.5 / rayW)) * rays;
    col = mix(col, c1.rgb * vec3(0.86, 0.80, 0.74), clamp(ray, 0.0, 1.0) * 0.75);
  }
  // interlocked ribbon (padauk): alternating light/dark bands that also change sheen
  float rib = sin(p.z*0.42 + w1*5.0 + w2*2.0 + 2.5*snoise(vec3(p.x*0.004, p.z*0.03, 6.0))) * (0.6 + 0.4*snoise(vec3(p.x*0.01, p.z*0.02, 8.0)));
  col *= 1.0 + ribbon*0.045*rib;
  // limed: white paste in the open grain (pore colour) + a whitewash over everything
  col = mix(col, vec3(0.86,0.84,0.80), limed*0.16);
#ifndef CARVE_BAKE
  float fib = snoise(vec3(p.x*0.35, p.z*9.0, p.y*9.0)) * aaFade(fwz, 9.0);
  col *= 1.0 + fib*0.022;
#endif
  // open pores scatter (rougher), ray tissue is dense and smooth (the silver-grain sheen)
  rough = baseRough + pores*0.18*(1.0 - limed) - ray*0.18 + ribbon*0.06*rib;
  return max(col, vec3(0.0));
}
#endif

// finest fibre noise (~9 cycles/mm) stays live so close-ups keep their tooth; everything coarser is baked
float fibre(vec3 p, int k){
  p += vec3(float(k)*173.0, 0.0, float(k)*61.0);
  float fwz = length(vec2(dFdx(p.z),dFdy(p.z))) + length(vec2(dFdx(p.y),dFdy(p.y)))*0.5 + 1e-5;
  return 1.0 + 0.022 * snoise(vec3(p.x*0.35, p.z*9.0, p.y*9.0)) * aaFade(fwz, 9.0);
}
const float BAKE_SCALE = 1.0/0.75;
vec4 bakeA(vec2 xz){ vec4 t = texture2D(uBakeA, (xz - uBakeRect.xy) / uBakeRect.zw); return vec4(t.rgb*BAKE_SCALE, t.a); }
vec4 bakeB(vec2 xz){ vec4 t = texture2D(uBakeB, (xz - uBakeRect.xy) / uBakeRect.zw); return vec4(t.rgb*BAKE_SCALE, t.a); }

vec3 applyFinish(vec3 c){
  float l = dot(c, vec3(0.2126,0.7152,0.0722));
  c = mix(vec3(l), c, uFinish.y) * uFinish.x;
  return max(c, vec3(0.0));
}

float depthAt(vec2 uv){ return tex(uv).x; }
// share of a pixel footprint fw (mm of SDF) that lies in [a, b]: box-filters the creases at the lip and the wall foot
float bandIn(float s, float a, float b, float fw){ return clamp((min(s + 0.5*fw, b) - max(s - 0.5*fw, a)) / fw, 0.0, 1.0); }
// surface normal of the carved top, analytic from the SDF: on a wall the depth gradient is slope * grad(sdf), elsewhere
// flat (top, floors); the creases are box-filtered against the pixel so they stay crisp without crawling
float sFw = 0.05;
vec3 carveNormalT(vec2 uv, vec4 t){
  float fw = max(sFw, 1e-4);
  float band = bandIn(t.r, 0.0, t.b / max(t.a, 1e-4), fw);
  vec2 g = vec2(0.0);
  // most of the board (top, floors) is flat: no gradient taps there. On a wall the SDF gradient has unit length, but the
  // finite difference shrinks within a texel of the medial axis, which rounded the bottom of every thin V into a trough;
  // normalising it keeps a V-bit's walls planar right down to a crisp ridge.
  if (band > 0.0) { vec2 gs = gradS(uv); float gl = length(gs); g = (gl > 1e-3 ? gs / gl : vec2(0.0)) * (t.a * band); }
  if (uStepD.x > 0.0){
    vec2 e = uTexel; vec4 c = stepsT(uv), w = vec4(1.0 / uStepK);
    vec4 on = uStepD * uStepK * vec4(bandIn(c.x, 0.0, w.x, fw), bandIn(c.y, 0.0, w.y, fw), bandIn(c.z, 0.0, w.z, fw), bandIn(c.w, 0.0, w.w, fw));
    if (dot(on, on) > 0.0){
      vec4 gx = (stepsT(uv + vec2(e.x, 0.0)) - stepsT(uv - vec2(e.x, 0.0))) / (2.0 * e.x * uArt.x);
      vec4 gz = (stepsT(uv + vec2(0.0, e.y)) - stepsT(uv - vec2(0.0, e.y))) / (2.0 * e.y * uArt.y);
      g += vec2(dot(gx, on), dot(gz, on));
    }
  }
  return normalize(vec3(g.x, 1.0, g.y));   // height = -depth
}
vec3 carveNormal(vec2 uv){ return carveNormalT(uv, sdfT(uv)); }
// A fragment on a steep triangle whose own SDF value falls just outside a wall band (the snapped mesh puts a near-vertical
// pocket wall within a sliver of the contour, not exactly on it): shade it as the nearest wall rather than as flat top/floor.
vec3 wallNormal(vec2 uv){
  vec4 t = sdfT(uv); float w = t.b / max(t.a, 1e-4);
  float best = abs(clamp(t.r, 0.0, w) - t.r); vec2 g = gradS(uv) * t.a;
  if (uStepD.x > 0.0){
    vec4 c = stepsT(uv); float ws = 1.0 / uStepK;
    for (int i = 0; i < 4; i++){
      if (uStepD[i] <= 0.0) break;
      float dd = abs(clamp(c[i], 0.0, ws) - c[i]);
      if (dd < best){ vec4 sel = vec4(0.0); sel[i] = 1.0; best = dd; g = gradStep(uv, sel) * (uStepD[i] * uStepK); }
    }
  }
  return normalize(vec3(g.x, 1.0, g.y));
}

// voronoi char (alligatoring): returns crack line strength, cell random and cell-edge distance
vec3 charCells(vec2 x){
  vec2 n=floor(x), f=fract(x); float F1=8.0, F2=8.0; float id=0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 o=hash2(n+g)*0.85+0.075;
    vec2 r=g+o-f; float d=dot(r,r);
    if(d<F1){F2=F1;F1=d;id=hash1(n+g+7.3);} else if(d<F2){F2=d;}
  }
  return vec3(sqrt(F2)-sqrt(F1), id, sqrt(F1));
}
vec3 charSurface(vec3 p, float thin, out float rough){
  vec2 q = vec2(p.x, p.z - p.y*0.6) / uCharScale;
  float fq = length(vec2(dFdx(q.x),dFdy(q.x))) + length(vec2(dFdx(q.y),dFdy(q.y)));
  vec3 c = charCells(q);
  vec3 c2 = charCells(q*2.7+13.0);
  float crack = (1.0 - smoothstep(0.02, 0.11, c.x)) * aaFade(fq, 1.0);
  float crack2 = (1.0 - smoothstep(0.02, 0.12, c2.x)) * aaFade(fq, 2.7) * 0.6;
  float dome = smoothstep(0.0, 0.6, c.z);
  vec3 col = vec3(0.020,0.017,0.015) * (0.75 + 0.6*c.y);
  col *= 1.0 - 0.65*max(crack, crack2);
  col += vec3(0.010,0.008,0.007) * (1.0-dome) * aaFade(fq,1.0);
  // thin scorch at the lip: brown instead of black
  col = mix(col, vec3(0.16,0.075,0.035), thin);
  rough = mix(0.78, 0.95, max(crack, crack2));
  return col;
}

#ifndef CARVE_BAKE
float aoAt(vec2 uv){
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return 1.0;
  return clamp(1.0 - texture2D(uAO, uv).r * uAOs, 0.1, 1.0);
}
float schlick(float c){ c = clamp(1.0 - c, 0.0, 1.0); float c2 = c*c; return 0.04 + 0.96*c2*c2*c; }
// Fill: flush (top at y=0) or overpour (top at vBoard.y); returns the base-layer albedo, sets the material globals.
// The resin's top is one dielectric interface: it is drawn as the clear coat (with its own flat normal), so the base layer
// below it carries no extra specular (sSpec = 0) except where the base itself is a reflector (metal flakes).
vec3 fillSurface(vec3 P, float thick, vec3 Vw){
  vec3 col = uFillColor;
  // the pour's surface: self-levelled gloss before sanding; after sanding it takes the finish (raw = frosted)
  float coat = uSanded ? (uFinish.w > 0.05 ? max(uFinish.w, 0.6) : 1.0) : 1.0;
  float coatR = uSanded ? (uFinish.w > 0.05 ? max(uFinishCoatRough*0.6, 0.025) : 0.38) : 0.02;
  sMetal = 0.0; sRough = uFillRough; sCoat = coat; sCoatRough = coatR; sSpec = 0.0;
  if (uFillType == 0){
    // pigmented resin: diffuse body under the gloss interface
    sRough = 0.45;
    if (uFillVein > 0.5){   // marbled pour: domain-warped 3D veins, continuous through the carve
      vec3 mq = vec3(P.x, P.y*3.0, P.z) * 0.024; float w = vFbm(mq * 1.6 + 5.0);
      float v1 = abs(sin((mq.x * 1.2 + mq.z * 0.8 + mq.y * 0.6 + 4.2 * w) * 3.14159));
      float v2 = abs(sin((mq.x * 0.5 - mq.z * 1.3 + 7.0 * vFbm(mq * 3.3 + 1.7)) * 6.28318));
      float aa = clamp(1.0 - length(fwidth(mq)) * 6.0, 0.0, 1.0);
      float vein = (1.0 - smoothstep(0.0, mix(0.4, 0.09, aa), v1)) * 0.7 + (1.0 - smoothstep(0.0, mix(0.3, 0.035, aa), v2)) * 0.3 * aa;
      col = mix(col * mix(0.94, 1.03, vFbm(mq * 5.0)), uFillVeinCol, vein * 0.8);
    }
  } else if (uFillType == 1){
    // metal powder in resin: coarse platelets (~0.3 mm) with their own tilt, so some catch the light as glints, under the
    // resin's flat gloss coat; once a flake is sub-pixel its tilt spread is folded into the roughness (no sparkle aliasing).
    // The powder is uneven (a few-mm mottle and the pour's flow lines) and the binder between flakes is dark, so it reads
    // as metal in resin, not as one flat sheet of yellow.
    vec2 fq = P.xz * 6.0; float fw = length(fwidth(fq));
    vec2 hc = hash2(fq + 3.0), ht = hash2(fq + 71.0) - 0.5;
    float fade = 1.0 - smoothstep(0.4, 1.3, fw);
    vec3 fN = normalize(vec3(ht.x * 0.5, 1.0, ht.y * 0.5));
    sN = normalize(mix(vec3(0.0,1.0,0.0), fN, fade));
    float r0 = uFillRough * 0.55;
    sRough = sqrt(r0*r0 + (1.0 - fade) * 0.12);
    sMetal = 0.9; sSpec = 1.0;
    vec2 fl = P.xz + 9.0 * vec2(snoise(vec3(P.xz * 0.02, 2.0)), snoise(vec3(P.xz * 0.02, 5.0)));   // swirled by the pour
    float flow = 0.55 * snoise(vec3(fl.x*0.035, fl.y*0.07, 1.0)) + 0.45 * snoise(vec3(fl * 0.16, 4.0));
    float dens = clamp(0.64 + 0.3*flow, 0.3, 1.0);                // powder density: flakes vs binder showing through
    vec3 metal = uFillF0 * mix(1.0, 0.8 + 0.4*hc.x, fade);
    col = mix(uFillColor * 0.35, metal, dens);
  } else {
    // clear / tinted / glow resin: look through it to the carved floor. Refract the view ray, march it to the floor,
    // light the floor with the key (refracted in, absorbed on the way down, Fresnel-weighted) and the environment
    // (occluded by the walls), then absorb on the way back up (Beer-Lambert) and add the dye's in-scatter.
    vec3 T = refract(Vw, vec3(0.0,1.0,0.0), 1.0/1.5);
    float ty = max(-T.y, 0.15);
    vec2 hit = P.xz + T.xz * (thick/ty);
    float d1 = depthAt(hit/uArt);
    float topY = P.y;
    float L = max(topY + d1, 0.0) / ty;
    hit = P.xz + T.xz * L;
    float d2 = depthAt(hit/uArt);
    float res = max(topY + d2, 0.0);                             // resin above the floor point
    L = res / ty;
    vec3 fa = bakeA(hit).rgb;
    float la = dot(fa, vec3(0.2126,0.7152,0.0722));
    vec3 floorA = max(mix(vec3(la), fa, 1.12) * 0.9, 0.0);       // wood under resin is wetted: darker, richer
    vec3 Lk = normalize(uKeyDir);
    vec3 Lr = refract(-Lk, vec3(0.0,1.0,0.0), 1.0/1.5);
    vec3 nF = carveNormal(hit/uArt);
    vec3 Tl = exp(-uFillAbsorb * (res / max(-Lr.y, 0.2)) * 0.36);
    vec3 Ta = exp(-uFillAbsorb * res * 1.3 * 0.36);
    float eKey = max(dot(nF, -Lr), 0.0) * (1.0 - schlick(max(Lk.y, 0.0)));
    float eTop = max(Lk.y, 0.0);
    vec3 E = (uKeyShare * eKey * Tl + (1.0 - uKeyShare) * aoAt(hit/uArt) * Ta) / max(uKeyShare * eTop + (1.0 - uKeyShare), 1e-3);
    vec3 tr = exp(-uFillAbsorb * L * 0.36);
    col = floorA * E * tr + uFillScatter * (1.0 - tr);
    sRough = 0.5;
  }
  return col;
}

// The board's edges are eased (a ~1.6 mm round-over), shaded rather than modelled: the top's normal tips outward over the
// last 1.6 mm and the sides' normal tips up over their top 1.6 mm, meeting at 45 degrees, so the edge catches a highlight
// line instead of being a razor corner.
const float ROUND = 1.6;
vec2 edgeOut(vec2 p, out float e){   // outward normal of the nearest board side, and the distance to it (mm)
  vec4 R = uBoardRect; float a = p.x - R.x, b = R.x + R.z - p.x, c = p.y - R.y, dd = R.y + R.w - p.y;
  e = min(min(a, b), min(c, dd));
  return e == a ? vec2(-1.0, 0.0) : e == b ? vec2(1.0, 0.0) : e == c ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
}
void surfaceBody();
void surface(){
  surfaceBody();
#if CARVE_PART == 0
  float e; vec2 o = edgeOut(vBoard.xz, e);
  if (e < ROUND){
    float th = (1.0 - e / ROUND) * 0.7854;
    vec3 tip = vec3(o.x * sin(th), cos(th), o.y * sin(th));
    sN = normalize(tip + (sN - vec3(0.0, 1.0, 0.0)));
    if (dot(sNc, sNc) > 0.5) sNc = tip;
  }
#elif CARVE_PART == 1
  vec3 gN = normalize(cross(dFdx(vBoard), dFdy(vBoard)));
  if (abs(gN.y) < 0.5){                                   // a side, not the underside
    float e; vec2 o = edgeOut(vBoard.xz, e);
    float th = 1.5708 - clamp(1.0 + vBoard.y / ROUND, 0.0, 1.0) * 0.7854;
    sN = vec3(o.x * sin(th), cos(th), o.y * sin(th)); sOverrideN = true;
    // the board's ends (fibres run along x) are end grain: it drinks finish, so it is darker and duller
    if (abs(o.x) > 0.5) { sAlb *= 0.78; sRough = min(sRough + 0.14, 1.0); sCoat *= 0.5; }
  }
#endif
}
void surfaceBody(){
  vec3 P = vBoard;
  vec2 uv = P.xz / uArt;
  vec4 tS = sdfT(uv);
  float d = depthOf(tS, uv);
  float g = tS.g;
  float sd = tS.r;                                         // signed mm to the cut line, exact
  sFw = max(fwidth(sd), 1e-4);
  vec3 Vw = normalize(P - uCamBoard);
  sMetal = 0.0; sCoat = uFinish.w; sCoatRough = uFinishCoatRough; sEmis = vec3(0.0); sAO = 1.0; sOverrideN = true; sSpec = 1.0;
  sN = vec3(0.0,1.0,0.0); sNc = vec3(0.0);
#if CARVE_PART == 1
  // board edges and underside: live solid wood (small on screen)
  float wr;
  sAlb = applyFinish(wood(P, uMode==3 ? 1 : 0, wr)); sRough = clamp(wr + uFinish.z + 0.04, 0.05, 1.0); sOverrideN = false;
  if (uMode == 4 && !uSanded) { sAlb = charSurface(P, 0.0, sRough); sCoat = 0.0; }
#elif CARVE_PART == 2
  if (vHide > 0.999) discard;   // triangles wholly under the board top are not part of the pour
  fillH(P.xz); if (fHide > 0.5) discard;   // per pixel: crisp contact line
  // proud fill before sanding (epoxy overpour / inlay plug); normal from the same height the GPU displaced to
  float e = uStep;
  float hx = fillH(P.xz + vec2(e, 0.0)) - fillH(P.xz - vec2(e, 0.0));
  float hz = fillH(P.xz + vec2(0.0, e)) - fillH(P.xz - vec2(0.0, e));
  sN = normalize(vec3(-hx / (2.0*e), 1.0, -hz / (2.0*e)));
  if (uMode == 2 || uMode == 3){
    // the plug before levelling: bandsawn face (rough, no finish yet), its own grain angle
    vec4 B = bakeB(P.xz);
    sAlb = B.rgb * fibre(plugP(P), uMode==2 ? 1 : 0) * 0.97; sRough = clamp(B.a + 0.2, 0.05, 1.0); sCoat = 0.0;
  } else {
    sAlb = fillSurface(P, P.y + d, Vw);
    sNc = sN;                                   // resin surface = the pour's meniscus
  }
#else
  float cov = clamp(sd / sFw + 0.5, 0.0, 1.0);             // 1 inside the carve: pixel coverage of the exact outline
  vec3 nC = uFlat ? vec3(0.0,1.0,0.0) : carveNormalT(uv, tS);
  if (!uFlat && nC.y > 0.9){
    vec3 gN = normalize(cross(dFdx(P), dFdy(P)));
    if (abs(gN.y) < 0.35) nC = wallNormal(uv);
  }
  sN = nC;
  float yy = uFlat ? 0.0 : -d;
  vec3 Pw = vec3(P.x, yy, P.z);

  // base wood (top face / carved faces): baked at the carved height, live fibre on top
  vec4 A = bakeA(P.xz);
  vec3 woodTop = applyFinish(A.rgb * fibre(vec3(P.x, -d, P.z), uMode==3 ? 1 : 0));
  float rTop = clamp(A.a + uFinish.z, 0.05, 1.0);

  if (uMode == 0 || (!uFlat && uMode != 4)){
    // raw carve: tool-cut faces slightly duller; walls that cut across the fibres expose end grain, which drinks finish
    // (darker, rougher). Occlusion from the baked sky-visibility map (indirect light only).
    float endg = abs(nC.x) * (1.0 - nC.y);
    vec3 cut = woodTop * mix(0.94, 0.80, clamp(endg*1.6,0.0,1.0));
    int kb = uMode==3 ? 1 : 0;
    if (W(kb,1).w < 0.001 && W(kb,3).w < 0.001){   // MDF: the fibre core under the pressed skin is darker and fuzzy
      float fz = 0.5 + 0.5 * snoise(vec3(P.x*2.2, d*2.2, P.z*2.2)) * aaFade(sFw, 2.2);
      cut = woodTop * (0.66 + 0.1*fz); endg = 0.6;
    }
    sAlb = mix(woodTop, cut, cov);
    sRough = mix(rTop, min(rTop + 0.10 + 0.15*clamp(endg*1.6,0.0,1.0), 1.0), cov);
    sCoat = mix(uFinish.w, uFinish.w*0.5, cov);
    sAO = aoAt(uv);
    return;
  }
  if (uMode == 4){
    // charred grooves: torched walls/floors; top sanded back to clean wood (or all char before sanding)
    float thin = smoothstep(0.35, 0.0, d) * (uSanded ? 1.0 : 0.0);
    float cr; vec3 ch = charSurface(Pw, thin, cr);
    float halo = uSanded ? smoothstep(0.32, 0.5, g) * (1.0-cov) * 0.20 : 0.0;
    vec3 top = woodTop * (1.0 - halo) ;
    top = mix(top, top*vec3(0.80,0.66,0.52), halo*2.0);
    float m = uSanded ? cov : 1.0;
    sAlb = mix(top, ch, m);
    sRough = mix(rTop, cr, m);
    sCoat = mix(uFinish.w, 0.0, m);
    sSpec = mix(1.0, 0.45, m);
    sAO = aoAt(uv);
    return;
  }
  // flush fills (the surface is flat: nothing occludes it)
  if (uMode == 1){
    vec3 fc = fillSurface(vec3(P.x,0.0,P.z), d, Vw);
    float fm = sMetal, fR = sRough, fC = sCoat, fCR = sCoatRough, fS = sSpec; vec3 fE = sEmis, fN = sN;
    // resin wicks into the end grain right at the line: a faint darker rim in the wood
    vec3 wd = woodTop * (1.0 - 0.07*smoothstep(0.38,0.5,g)*(1.0-cov));
    sAlb = mix(wd, fc, cov);
    sMetal = fm*cov; sRough = mix(rTop, fR, cov); sCoat = mix(uFinish.w, fC, cov); sCoatRough = mix(uFinishCoatRough, fCR, cov);
    sSpec = mix(1.0, fS, cov); sEmis = fE*cov;
    sN = normalize(mix(vec3(0.0,1.0,0.0), fN, cov)); sNc = vec3(0.0,1.0,0.0);
    return;
  }
  // wood inlay / reverse inlay (reverse: insert species is the field, base species shows the design). The plug is its
  // own board (own log, own grain angle), levelled flush; the joint shows as a thin glue line of real width (~0.1 mm),
  // box-filtered against the pixel so it stays a hairline at any zoom instead of a fat outline.
  vec4 B = bakeB(P.xz);
  vec3 ins = applyFinish(B.rgb * fibre(plugP(vec3(P.x, 0.0, P.z)), uMode==2 ? 1 : 0));
  float dist = sd;                                                // signed mm from the cut line (+ inside the plug)
  float px = length(vec2(length(dFdx(P.xz)), length(dFdy(P.xz)))) * 0.7071;
  float glue = lineCover(dist, 0.10, px) * 0.85;
  sAlb = mix(mix(woodTop, ins, cov), uGlueCol, glue);
  sRough = mix(mix(rTop, clamp(B.a+uFinish.z,0.05,1.0), cov), 0.6, glue);
#endif
}
#endif

// bake pass: one full-screen quad evaluates the solid-wood shader once per texel of the board top
#ifdef CARVE_BAKE
uniform int uBakeK;
uniform bool uBakeFlat;
varying vec2 vUv;
void bakeMain(){
  vec2 P = uBakeRect.xy + vUv * uBakeRect.zw;
  float d = uBakeFlat ? 0.0 : tex(P / uArt).x;
  vec3 wp = vec3(P.x, -d, P.y); if (uBakeFlat) wp = plugP(wp);
  float r; vec3 c = wood(wp, uBakeK, r);
  gl_FragColor = vec4(c * 0.75, clamp(r, 0.0, 1.0));
}
#endif
`;

export const BAKE_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vBoard;
void main(){ vUv = uv; vBoard = vec3(0.0); gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const BAKE_FRAG = () => '#define CARVE_BAKE\n#define CARVE_PART -1\n' + COMMON + PARS + '\nvoid main(){ bakeMain(); }\n';

// vertex: the grids are flat and built once; the carve is displaced here from the depth texture (GPU, no mesh rebuilds)
export const VERT_MAIN = /* glsl */`
if (uPart == 0 && !uFlat){ transformed.xz = snapEdge(transformed.xz); transformed.y = -tex(transformed.xz / uArt).x; }
vHide = 0.0;
if (uPart == 2){ transformed.y = fillH(transformed.xz); vHide = fHide; }
vBoard = transformed;
`;
