// Species, finishes and fill presets. Colours are sRGB hex (converted to linear in the viewer).
// Wood params: early, late, pore, streak colours + spacing (mm/ring), contrast, ring sharpness,
// pore amount/length, ringPorous, rays, ribbon (interlock), warp, figure, streak, limed, roughness.
export const SPECIES = {
  maple:    { name: 'Hard maple', early: '#e8d6b6', late: '#d4b88c', pore: '#c4a47a', streak: '#d9bf94', spacing: 3.2, contrast: 0.38, sharp: 3.0, pore_amt: 0.18, pore_len: 1.0, ring_porous: 0.0, rays: 0.35, ribbon: 0.0, warp: 0.7, figure: 0.10, streakAmt: 0.10, limed: 0.0, rough: 0.52, pore_d: 0.07, ray_h: 0.6 },
  ash:      { name: 'Ash', early: '#e9d8b8', late: '#bfa173', pore: '#8f7452', streak: '#cdb48a', spacing: 4.6, contrast: 0.55, sharp: 4.0, pore_amt: 0.55, pore_len: 1.3, ring_porous: 1.0, rays: 0.25, ribbon: 0.0, warp: 0.8, figure: 0.08, streakAmt: 0.08, limed: 0.0, rough: 0.55, pore_d: 0.24, ray_h: 0.6 },
  white_oak:{ name: 'White oak', early: '#cdae7f', late: '#9d7b51', pore: '#5f462b', streak: '#bf9d6c', spacing: 3.6, contrast: 0.62, sharp: 3.5, pore_amt: 0.65, pore_len: 1.6, ring_porous: 1.0, rays: 0.9, ribbon: 0.0, warp: 0.75, figure: 0.03, streakAmt: 0.05, limed: 0.0, rough: 0.56, pore_d: 0.26, ray_h: 14 },
  walnut:   { name: 'Black walnut', early: '#5a3d2a', late: '#3e291b', pore: '#22150d', streak: '#4a3a36', spacing: 4.2, contrast: 0.4, sharp: 2.6, pore_amt: 0.45, pore_len: 1.2, ring_porous: 0.35, rays: 0.2, ribbon: 0.0, warp: 1.3, figure: 0.22, streakAmt: 0.35, limed: 0.0, rough: 0.5, pore_d: 0.16, ray_h: 0.6 },
  cherry:   { name: 'Cherry', early: '#8e4a2c', late: '#6c341d', pore: '#4c2414', streak: '#7a3d24', spacing: 2.6, contrast: 0.42, sharp: 2.6, pore_amt: 0.14, pore_len: 0.9, ring_porous: 0.0, rays: 0.25, ribbon: 0.0, warp: 0.3, figure: 0.05, streakAmt: 0.12, limed: 0.0, rough: 0.46, straight: 1.0, pore_d: 0.06, ray_h: 0.6 },
  padauk:   { name: 'Padauk', early: '#b9482a', late: '#93331e', pore: '#5e2012', streak: '#a23e25', spacing: 3.8, contrast: 0.3, sharp: 2.2, pore_amt: 0.38, pore_len: 1.4, ring_porous: 0.0, rays: 0.15, ribbon: 1.0, warp: 0.8, figure: 0.12, streakAmt: 0.2, limed: 0.0, rough: 0.46, pore_d: 0.2, ray_h: 0.5 },
  wenge:    { name: 'Wenge', early: '#5d4837', late: '#2b1f17', pore: '#140f0b', streak: '#7a6450', spacing: 1.6, contrast: 0.95, sharp: 1.6, pore_amt: 0.6, pore_len: 2.2, ring_porous: 0.0, rays: 0.1, ribbon: 0.0, warp: 0.4, figure: 0.1, streakAmt: 0.75, limed: 0.0, rough: 0.58, pore_d: 0.24, ray_h: 0.5 },
  bog_oak:  { name: 'Bog oak', early: '#4b4641', late: '#2d2926', pore: '#171513', streak: '#3d3935', spacing: 3.4, contrast: 0.7, sharp: 3.5, pore_amt: 0.55, pore_len: 1.6, ring_porous: 1.0, rays: 0.8, ribbon: 0.0, warp: 0.75, figure: 0.14, streakAmt: 0.15, limed: 0.0, rough: 0.56, pore_d: 0.26, ray_h: 14 },
  limed_oak:{ name: 'Limed oak', early: '#d9c9ae', late: '#b29a7a', pore: '#f4f1ea', streak: '#cbb796', spacing: 3.6, contrast: 0.8, sharp: 3.5, pore_amt: 0.85, pore_len: 1.6, ring_porous: 1.0, rays: 0.6, ribbon: 0.0, warp: 0.75, figure: 0.08, streakAmt: 0.1, limed: 1.0, rough: 0.6, pore_d: 0.26, ray_h: 14 },
};

export const FINISHES = {
  raw:   { name: 'Raw sanded', darken: 1.0,  sat: 1.0,  rough: 0.10, coat: 0.0,  coatRough: 0.5 },
  oil:   { name: 'Oiled',      darken: 0.86, sat: 1.12, rough: -0.06, coat: 0.18, coatRough: 0.38 },
  satin: { name: 'Satin',      darken: 0.88, sat: 1.08, rough: -0.04, coat: 0.55, coatRough: 0.26 },
  gloss: { name: 'Gloss',      darken: 0.86, sat: 1.1,  rough: -0.04, coat: 1.0,  coatRough: 0.03 },
};

// type: 0 opaque, 1 metallic (metal powder), 2 translucent (tinted, Beer-Lambert), 3 glow
// metallic: color = swatch / binder tint, f0 = measured metal reflectance at normal incidence (sRGB hex)
export const FILLS = {
  black:    { name: 'Black',      group: 'Opaque', type: 0, color: '#0c0c0d', rough: 0.12 },
  white:    { name: 'White',      group: 'Opaque', type: 0, color: '#ece9e2', rough: 0.14 },
  bone:     { name: 'Bone',       group: 'Opaque', type: 0, color: '#ddd2bb', rough: 0.16 },
  teal:     { name: 'Teal',       group: 'Opaque', type: 0, color: '#0f6b6e', rough: 0.12 },
  cobalt:   { name: 'Cobalt',     group: 'Opaque', type: 0, color: '#1b3f8f', rough: 0.12 },
  oxblood:  { name: 'Oxblood',    group: 'Opaque', type: 0, color: '#5c1016', rough: 0.12 },
  marble:   { name: 'Marble',     group: 'Opaque', type: 0, color: '#e9e6e0', vein: '#55575c', rough: 0.14 },
  gunmetal: { name: 'Gunmetal',   group: 'Metallic', type: 1, color: '#3d4145', rough: 0.36, f0: '#7d8186' },
  bronze:   { name: 'Bronze',     group: 'Metallic', type: 1, color: '#b98a52', rough: 0.3, f0: '#d9a066' },
  brass:    { name: 'Brass',      group: 'Metallic', type: 1, color: '#c9a24f', rough: 0.3, f0: '#efcf78' },
  gold:     { name: 'Gold',       group: 'Metallic', type: 1, color: '#e0b347', rough: 0.26, f0: '#ffc356' },
  copper:   { name: 'Copper',     group: 'Metallic', type: 1, color: '#c06a43', rough: 0.3, f0: '#f0a07a' },
  smoke:    { name: 'Smoky',      group: 'Translucent', type: 2, color: '#2a2622', absorb: [0.9, 0.95, 1.0], scatter: '#14110f', rough: 0.05 },
  amber:    { name: 'Amber',      group: 'Translucent', type: 2, color: '#d08a2a', absorb: [0.035, 0.12, 0.42], scatter: '#7a4a10', rough: 0.05 },
  ocean:    { name: 'Ocean',      group: 'Translucent', type: 2, color: '#1b8fa0', absorb: [1.3, 0.35, 0.28], scatter: '#053a46', rough: 0.05 },
  emerald:  { name: 'Emerald',    group: 'Translucent', type: 2, color: '#2f9d5a', absorb: [1.1, 0.25, 0.8], scatter: '#063d1c', rough: 0.05 },
  clear:    { name: 'Water clear',group: 'Translucent', type: 2, color: '#ffffff', absorb: [0.03, 0.03, 0.035], scatter: '#000000', rough: 0.04 },
  glow_aqua:{ name: 'Aqua glow',  group: 'Glow', type: 3, color: '#cfe9e4', glow: '#29ffd9', rough: 0.1 },
  glow_lime:{ name: 'Lime glow',  group: 'Glow', type: 3, color: '#dcecc4', glow: '#7dff3a', rough: 0.1 },
  glow_blue:{ name: 'Blue glow',  group: 'Glow', type: 3, color: '#d6e2f0', glow: '#3aa0ff', rough: 0.1 },
};

// light presets after Relief Forge 2.0.7 (key strength, warmth -1..1, cool fill opposite the key, exposure) plus the studio
// environment level (Ambient)
export const LIGHTS = {
  studio:   { name: 'Studio',        az: 220, el: 42, key: 2.0, env: 0.5,  warm: 0.2,  fill: 0.25, exp: 1.0 },
  raking:   { name: 'Raking light',  az: 250, el: 14, key: 3.4, env: 0.42, warm: 0.3,  fill: 0.35, exp: 1.2 },
  gallery:  { name: 'Gallery',       az: 200, el: 58, key: 2.6, env: 0.2,  warm: 0.3,  fill: 0.3,  exp: 1.0 },
  overhead: { name: 'Overhead flat', az: 180, el: 85, key: 2.0, env: 0.55, warm: 0.0,  fill: 0.5,  exp: 1.0 },
  dramatic: { name: 'Dramatic',      az: 245, el: 20, key: 3.8, env: 0.12, warm: 0.45, fill: 0.0,  exp: 0.95 },
  window:   { name: 'Cool daylight', az: 300, el: 40, key: 2.2, env: 0.45, warm: -0.4, fill: 0.4,  exp: 1.0 },
  dark:     { name: 'Lights down',   az: 220, el: 40, key: 0.7, env: 0.15, warm: -0.5, fill: 0.1, exp: 1.0 },
};
