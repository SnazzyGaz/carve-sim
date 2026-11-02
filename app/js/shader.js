// GLSL injected into MeshPhysicalMaterial: solid procedural wood, char, epoxy/inlay fills.
// Everything is in board millimetres: vBoard.x = across the art (u), vBoard.z = down the art (v),
// vBoard.y = height (0 = board top, negative = carved).
// Shared by the vertex shader (GPU displacement of a static grid), the shadow depth pass and the fragment shader.
export const COMMON = /* glsl */`
uniform sampler2D uDepth;     // r = depth / maxDepth, g = blurred carve mask
uniform vec2 uArt;            // art size mm
uniform float uMaxDepth;
uniform int uPart;            // 0 board top, 1 board sides, 2 fill overpour mesh
uniform int uMode;            // 0 none, 1 epoxy, 2 inlay, 3 reverse inlay, 4 char
uniform bool uFlat;           // top drawn flat (flush fills)
uniform float uOver;          // how proud the unsanded fill stands, mm
varying vec3 vBoard;
vec2 tex(vec2 uv){
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return vec2(0.0);
  return texture2D(uDepth, uv).rg;
}
// unsanded fill surface height (board mm, 0 = board top): epoxy overpour bulge with meniscus spill, or a proud inlay plug.
// Points well under the board top drop below it, where the board hides them.
varying float vHide;
float fillH(vec2 p){
  vec2 t = tex(p / uArt); float d = t.r * uMaxDepth, b = t.g;
  if (uMode == 1){
    float h = uOver * smoothstep(0.02, 0.55, b);
    return max(h, -d + 0.02) + ((h < 0.03 && d < 0.02) ? -0.5 : 0.0);
  }
  return d > 0.02 ? uOver : -0.6;
}
`;

export const PARS = /* glsl */`
uniform vec2 uTexel;          // 1/texture size
uniform float uStep;          // grid step mm (fill normals)
uniform float uEdge;          // depth iso-level of the cut line
uniform bool uSanded;
uniform vec4 uWood[14];       // 2 species x 7 vec4
uniform vec4 uFinish;         // darken, sat, rough add, coat
uniform float uFinishCoatRough;
uniform int uFillType;
uniform vec3 uFillColor;
uniform vec3 uFillAbsorb;
uniform vec3 uFillScatter;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uFillRough;
uniform float uCharScale;
uniform vec3 uKeyDir;         // world dir to key light
uniform vec3 uOrigin;         // world position of the art's top-left corner on the board top
uniform sampler2D uBakeA;     // baked wood of the board top & carve (rgb = albedo * 0.75, a = roughness), mipmapped
uniform sampler2D uBakeB;     // baked insert wood for inlays (flat)
uniform vec4 uBakeRect;       // board mm covered by the bakes: x0, z0, width, height

float sSpec; vec3 sAlb; float sRough; float sMetal; float sCoat; float sCoatRough; vec3 sEmis; vec3 sN; float sAO; bool sOverrideN;

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

vec4 W(int k,int i){ return uWood[k*7+i]; }

#if CARVE_PART == 1 || defined(CARVE_BAKE)
// solid wood: tree axis along x, pith ~260 mm under the board, slightly tilted for cathedrals
vec3 wood(vec3 p, int k, out float rough){
  vec4 c0=W(k,0), c1=W(k,1), c2=W(k,2), c3=W(k,3), c4=W(k,4), c5=W(k,5), c6=W(k,6);
  p += vec3(float(k)*173.0, 0.0, float(k)*61.0);
  float spacing=c0.w, contrast=c1.w, poreAmt=c2.w, ringPorous=c3.x, rays=c3.y, ribbon=c3.z, warp=c3.w;
  float figure=c4.x, poreLen=c4.y, sharp=c4.z, limed=c4.w, streakAmt=c5.w, baseRough=c6.x;
  float straight=c6.y;
  float fwz = length(vec2(dFdx(p.z),dFdy(p.z))) + length(vec2(dFdx(p.y),dFdy(p.y)))*0.5 + 1e-5;
  float fwx = length(vec2(dFdx(p.x),dFdy(p.x))) + 1e-5;
  float w1 = snoise(vec3(p.x*0.0035, p.z*0.010, p.y*0.010));
  float w2 = snoise(vec3(p.x*0.004+5.2, p.z*0.035, p.y*0.035));
  float w3 = snoise(vec3(p.x*0.012+1.7, p.z*0.12, p.y*0.12));
  float vc = 150.0 + straight*520.0 + p.x*0.06*(1.0-straight) + w1*warp*22.0;
  float yc = -260.0 + p.x*0.10 + w1*warp*10.0;
  float r = length(vec2(p.z - vc, p.y - yc)) + w2*warp*1.3 + w3*0.18*warp;
  // uneven ring widths (good and bad growth years) + a slow wobble along the length
  float wob = snoise(vec3(p.x*0.018, r*0.22, 3.3));
  float ringPos = r/spacing + 0.9*snoise(vec3(r*0.045, 7.7, float(k))) + 0.12*wob;
  float f = fract(ringPos);
  float yr = hash1(vec2(floor(ringPos), float(k)*3.1));
  // earlywood flat, latewood a defined band (so tangential cuts read as crisp cathedral bands, not soft shading)
  float lw0 = clamp(1.0 - 1.6/(sharp+1.0), 0.35, 0.8) - 0.12*yr;
  // edge widths in screen terms: crisp ~1.5 px boundaries even where the face cuts a ring tangentially
  float fr = length(vec2(dFdx(ringPos),dFdy(ringPos)));
  float ew = clamp(fr*1.5, 0.015, 0.2);
  float late = 0.28*f + 0.72*smoothstep(lw0 - ew, lw0 + ew, f);
  late *= (1.0 - smoothstep(1.0 - 2.0*ew, 1.0, f));
  late = mix(late, 0.8/(sharp+1.0), 1.0-aaFade(fr,1.0));
  vec3 col = mix(c0.rgb, c1.rgb, clamp(late*contrast*mix(0.8,1.5,yr),0.0,1.0));
  // long tonal streaks (figure) and dark/light streak bands (walnut, wenge)
  float fig = snoise(vec3(p.x*0.005, p.z*0.06, p.y*0.06));
  col *= 1.0 + figure*fig*0.55;
  float st = snoise(vec3(p.x*0.012+9.1, p.z*0.55, p.y*0.55));
  st = mix(st, 0.0, 1.0-aaFade(fwz,0.55));
  col = mix(col, c5.rgb, clamp(smoothstep(0.15,0.85,st)*streakAmt,0.0,1.0));
  // pores: fine dashes along the grain, concentrated in earlywood for ring-porous species
  float pn = snoise(vec3(p.x*0.06/poreLen, p.z*1.7, p.y*1.7));
  float pn2 = snoise(vec3(p.x*0.11/poreLen+4.0, p.z*3.4, p.y*3.4));
  float pores = max(smoothstep(0.50, 0.88, pn), smoothstep(0.55, 0.9, pn2)*aaFade(fwz,3.4));
  float poreFade = aaFade(fwz, 1.7) * aaFade(fwx, 0.06/poreLen);
  float poreZone = mix(1.0, smoothstep(0.55,0.05,f)*1.4, ringPorous);
  pores = mix(0.10, pores, poreFade) * poreZone;
  vec3 poreCol = limed > 0.5 ? c2.rgb : c2.rgb;
  col = mix(col, poreCol, clamp(pores*poreAmt,0.0,1.0));
  // ray flecks (oak family)
  if (rays > 0.0){
    float rn = snoise(vec3(p.x*0.22, p.z*2.6, p.y*2.6+3.0));
    float fl = smoothstep(0.70, 0.92, rn) * aaFade(fwz, 2.6);
    col = mix(col, c1.rgb*0.78, fl*rays*0.55);
  }
  // interlocked ribbon (padauk): alternating light/dark bands that also change sheen
  float rib = sin(p.z*0.42 + w1*5.0 + w2*2.0);
  col *= 1.0 + ribbon*0.075*rib;
  // limed: white paste in the open grain + a whitewash over everything
  col = mix(col, vec3(0.86,0.84,0.80), limed*0.16);
  // fine fibre noise so flats never look like plastic
#ifndef CARVE_BAKE
  float fib = snoise(vec3(p.x*0.35, p.z*9.0, p.y*9.0)) * aaFade(fwz, 9.0);
  col *= 1.0 + fib*0.035;
#endif
  rough = baseRough + pores*0.12 + ribbon*0.06*rib;
  return max(col, vec3(0.0));
}
#endif

// finest fibre noise (~9 cycles/mm) stays live so close-ups keep their tooth; everything coarser is baked
float fibre(vec3 p, int k){
  p += vec3(float(k)*173.0, 0.0, float(k)*61.0);
  float fwz = length(vec2(dFdx(p.z),dFdy(p.z))) + length(vec2(dFdx(p.y),dFdy(p.y)))*0.5 + 1e-5;
  return 1.0 + 0.035 * snoise(vec3(p.x*0.35, p.z*9.0, p.y*9.0)) * aaFade(fwz, 9.0);
}
const float BAKE_SCALE = 1.0/0.75;
vec4 bakeA(vec2 xz){ vec4 t = texture2D(uBakeA, (xz - uBakeRect.xy) / uBakeRect.zw); return vec4(t.rgb*BAKE_SCALE, t.a); }
vec4 bakeB(vec2 xz){ vec4 t = texture2D(uBakeB, (xz - uBakeRect.xy) / uBakeRect.zw); return vec4(t.rgb*BAKE_SCALE, t.a); }

vec3 applyFinish(vec3 c){
  float l = dot(c, vec3(0.2126,0.7152,0.0722));
  c = mix(vec3(l), c, uFinish.y) * uFinish.x;
  return max(c, vec3(0.0));
}

float depthAt(vec2 uv){
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return 0.0;
  return texture2D(uDepth, uv).r * uMaxDepth;
}
// surface normal of the carved top from the depth map (world frame, y up)
vec3 carveNormal(vec2 uv){
  vec2 e = uTexel;
  float hx = depthAt(uv+vec2(e.x,0.0)) - depthAt(uv-vec2(e.x,0.0));
  float hz = depthAt(uv+vec2(0.0,e.y)) - depthAt(uv-vec2(0.0,e.y));
  float dx = 2.0*e.x*uArt.x, dz = 2.0*e.y*uArt.y;
  // height = -depth
  return normalize(vec3(hx/dx, 1.0, hz/dz));
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
// fill: flush (top at y=0) or overpour (top at vBoard.y); returns albedo, sets material globals
vec3 fillSurface(vec3 P, float thick, vec3 Vw){
  vec3 col = uFillColor;
  sMetal = 0.0; sRough = uFillRough; sCoat = 1.0; sCoatRough = 0.04;
  if (!uSanded) { sCoatRough = 0.02; sRough = 0.05; }
  else { sCoat = max(uFinish.w, 0.55); sCoatRough = max(uFinishCoatRough*0.6, 0.06); sRough = max(uFillRough, 0.18); }
  if (uFillType == 1){
    // mica powder: metal flakes with a little sparkle, band-limited
    vec2 fq = P.xz*14.0; float fw = length(fwidth(fq));
    vec2 h = hash2(fq + 3.0); float fade = 1.0-smoothstep(0.4,1.2,fw);
    sMetal = 1.0; sRough = uFillRough + (h.x-0.5)*0.22*fade;
    col *= 0.8 + 0.4*mix(0.5, h.y, fade);
    float sw = snoise(vec3(P.x*0.08, P.z*0.08, 1.0));
    col *= 1.0 + 0.06*sw;     // swirls in the pour
    sCoat = uSanded ? 0.25 : 1.0; sCoatRough = 0.12;
  } else if (uFillType == 2 || uFillType == 3){
    // look through the resin to the carved floor: refract, march once, Beer-Lambert
    vec3 T = refract(Vw, vec3(0.0,1.0,0.0), 1.0/1.5);
    float ty = max(-T.y, 0.15);
    float d0 = thick;
    vec2 hit = P.xz + T.xz * (d0/ty);
    float d1 = depthAt(hit/uArt);
    float topY = P.y;
    float L = max(topY + d1, 0.0) / ty;
    hit = P.xz + T.xz * L;
    float d2 = depthAt(hit/uArt);
    L = max(topY + d2, 0.0) / ty;
    vec3 floorW = applyFinish(bakeA(hit).rgb) * 0.82;          // the baked carve floor seen through the resin
    vec3 nF = carveNormal(hit/uArt);
    float lam = 0.35 + 0.65*max(dot(nF, normalize(uKeyDir)), 0.0);
    floorW *= lam * (1.0 - 0.35*smoothstep(0.0,uMaxDepth,d2));
    vec3 tr = exp(-uFillAbsorb * L * 0.55);
    col = floorW*tr + uFillScatter*(1.0-tr);
    sRough = 0.04; sCoat = 1.0; sCoatRough = uSanded ? max(uFinishCoatRough*0.5,0.04) : 0.02;
    if (uFillType == 3){
      col = mix(uFillColor, col, 0.25);
      float k = 1.0 - exp(-L*0.8);
      sEmis = uGlowColor * uGlow * 0.35 * (0.2 + 0.8*k);
    }
  }
  return col;
}

void surface(){
  vec3 P = vBoard;
  vec2 uv = P.xz / uArt;
  vec2 tg = tex(uv);
  float d = tg.r * uMaxDepth;
  float g = tg.g;
  vec3 Vw = normalize(P + uOrigin - cameraPosition);
  sMetal = 0.0; sCoat = uFinish.w; sCoatRough = uFinishCoatRough; sEmis = vec3(0.0); sAO = 1.0; sOverrideN = true; sSpec = 1.0;
  sN = vec3(0.0,1.0,0.0);
#if CARVE_PART == 1
  // board edges and underside: live solid wood (small on screen)
  float wr;
  sAlb = applyFinish(wood(P, uMode==3 ? 1 : 0, wr)); sRough = clamp(wr + uFinish.z + 0.04, 0.05, 1.0); sOverrideN = false;
  if (uMode == 4 && !uSanded) { sAlb = charSurface(P, 0.0, sRough); sCoat = 0.0; }
#elif CARVE_PART == 2
  if (vHide > 0.999) discard;   // triangles wholly under the board top are not part of the pour
  // proud fill before sanding (epoxy overpour / inlay plug); normal from the same height the GPU displaced to
  float e = uStep;
  float hx = fillH(P.xz + vec2(e, 0.0)) - fillH(P.xz - vec2(e, 0.0));
  float hz = fillH(P.xz + vec2(0.0, e)) - fillH(P.xz - vec2(0.0, e));
  sN = normalize(vec3(-hx / (2.0*e), 1.0, -hz / (2.0*e)));
  if (uMode == 2 || uMode == 3){
    vec4 B = bakeB(P.xz);
    sAlb = B.rgb * fibre(P, uMode==2 ? 1 : 0) * 0.97; sRough = B.a + 0.18; sCoat = 0.0;
  } else {
    sAlb = fillSurface(P, P.y + d, Vw);
  }
#else
  float fwd = max(fwidth(d), 1e-4);
  float cov = smoothstep(-fwd, fwd, d - uEdge);          // 1 inside the carve
  float lineW = smoothstep(fwd*2.5, 0.0, abs(d - uEdge)); // the cut line itself
  vec3 nC = uFlat ? vec3(0.0,1.0,0.0) : carveNormal(uv);
  sN = nC;
  float yy = uFlat ? 0.0 : -d;
  vec3 Pw = vec3(P.x, yy, P.z);

  // base wood (top face / carved faces): baked at the carved height, live fibre on top
  vec4 A = bakeA(P.xz);
  vec3 woodTop = applyFinish(A.rgb * fibre(vec3(P.x, -d, P.z), uMode==3 ? 1 : 0));
  float rTop = clamp(A.a + uFinish.z, 0.05, 1.0);

  if (uMode == 0 || (!uFlat && uMode != 4)){
    // raw carve: cut faces slightly duller, end grain (walls across the fibres) darker, cavity AO
    float endg = abs(nC.x) * (1.0 - nC.y);
    vec3 cut = woodTop * mix(0.92, 0.78, clamp(endg*1.6,0.0,1.0));
    sAlb = mix(woodTop, cut, cov);
    sRough = mix(rTop, min(rTop+0.12,1.0), cov);
    sCoat = mix(uFinish.w, uFinish.w*0.5, cov);
    float narrow = 1.0 - g;
    sAO = 1.0 - cov*(0.25*smoothstep(0.0,uMaxDepth,d) + 0.35*narrow*smoothstep(0.0,1.2,d));
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
    sAO = 1.0 - m*0.35*smoothstep(0.0,uMaxDepth,d);
    return;
  }
  // flush fills
  if (uMode == 1){
    vec3 fc = fillSurface(vec3(P.x,0.0,P.z), d, Vw);
    float fm = sMetal, fR = sRough, fC = sCoat, fCR = sCoatRough; vec3 fE = sEmis;
    // resin wicks into the end grain right at the line: a faint darker rim in the wood
    vec3 wd = woodTop * (1.0 - 0.07*smoothstep(0.38,0.5,g)*(1.0-cov));
    sAlb = mix(wd, fc, cov);
    sMetal = fm*cov; sRough = mix(rTop, fR, cov); sCoat = mix(uFinish.w, fC, cov); sCoatRough = mix(uFinishCoatRough, fCR, cov);
    sEmis = fE*cov;
    return;
  }
  // wood inlay / reverse inlay (reverse: insert species is the field, base species shows the design)
  vec4 B = bakeB(P.xz);
  vec3 ins = applyFinish(B.rgb * fibre(vec3(P.x, 0.0, P.z), uMode==2 ? 1 : 0));
  vec3 fieldW = woodTop;
  float glue = lineW * 0.38;
  sAlb = mix(fieldW, ins, cov) * (1.0 - glue);
  sRough = mix(rTop, clamp(B.a+uFinish.z,0.05,1.0), cov);
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
  float d = uBakeFlat ? 0.0 : tex(P / uArt).r * uMaxDepth;
  float r; vec3 c = wood(vec3(P.x, -d, P.y), uBakeK, r);
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
if (uPart == 0 && !uFlat) transformed.y = -tex(transformed.xz / uArt).r * uMaxDepth;
vHide = 0.0;
if (uPart == 2){ transformed.y = fillH(transformed.xz); vHide = transformed.y > 0.015 ? 0.0 : 1.0; }
vBoard = transformed;
`;
