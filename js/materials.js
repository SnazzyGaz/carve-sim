// Species, finishes and fill presets. Colours are sRGB hex (converted to linear in the viewer).
// Wood params: early, late, pore, streak colours + spacing (mm/ring), contrast, ring sharpness,
// pore amount/length, ringPorous, rays, ribbon (interlock), warp, figure, streak, limed, roughness.
export const SPECIES = {
  // pale
  maple:    { group: 'Pale', name: 'Hard maple', early: '#e8d6b6', late: '#d4b88c', pore: '#c4a47a', streak: '#d9bf94', spacing: 3.2, contrast: 0.38, sharp: 3.0, pore_amt: 0.18, pore_len: 1.0, ring_porous: 0.0, rays: 0.35, ribbon: 0.0, warp: 0.7, figure: 0.10, streakAmt: 0.10, limed: 0.0, rough: 0.52, pore_d: 0.07, ray_h: 0.6 },
  sycamore: { group: 'Pale', name: 'Sycamore', early: '#eee3cc', late: '#e0cfb0', pore: '#d3c09c', streak: '#e6d8bb', spacing: 3.4, contrast: 0.22, sharp: 2.4, pore_amt: 0.08, pore_len: 0.8, ring_porous: 0.0, rays: 0.3, ribbon: 0.0, warp: 0.6, figure: 0.14, streakAmt: 0.06, limed: 0.0, rough: 0.5, pore_d: 0.05, ray_h: 0.8 },
  beech:    { group: 'Pale', name: 'Beech', early: '#e3c39b', late: '#d0aa7d', pore: '#bd9566', streak: '#d8b48a', spacing: 3.0, contrast: 0.25, sharp: 2.5, pore_amt: 0.12, pore_len: 0.8, ring_porous: 0.0, rays: 0.9, ribbon: 0.0, warp: 0.5, figure: 0.05, streakAmt: 0.1, limed: 0.0, rough: 0.5, pore_d: 0.06, ray_h: 2.5 },
  ash:      { group: 'Pale', name: 'Ash', early: '#e9d8b8', late: '#bfa173', pore: '#8f7452', streak: '#cdb48a', spacing: 4.6, contrast: 0.55, sharp: 4.0, pore_amt: 0.55, pore_len: 1.3, ring_porous: 1.0, rays: 0.25, ribbon: 0.0, warp: 0.8, figure: 0.08, streakAmt: 0.08, limed: 0.0, rough: 0.55, pore_d: 0.24, ray_h: 0.6 },
  pine:     { group: 'Pale', name: 'Pine', early: '#e9d09f', late: '#c48b4c', pore: '#b98447', streak: '#d9a867', spacing: 5.5, contrast: 0.75, sharp: 5.0, pore_amt: 0.0, pore_len: 1.0, ring_porous: 0.0, rays: 0.05, ribbon: 0.0, warp: 1.1, figure: 0.0, streakAmt: 0.12, limed: 0.0, rough: 0.6, pore_d: 0.02, ray_h: 0.5 },
  // birch plywood: rotary-cut birch face (soft, wide figure) over cross-banded plies 1.4 mm thick; ply = ply thickness mm
  birch_ply:{ group: 'Pale', name: 'Birch ply', early: '#ead9bb', late: '#dcc6a0', pore: '#cdb48c', streak: '#e2cfad', spacing: 3.0, contrast: 0.22, sharp: 2.2, pore_amt: 0.06, pore_len: 1.0, ring_porous: 0.0, rays: 0.15, ribbon: 0.0, warp: 1.6, figure: 0.12, streakAmt: 0.05, limed: 0.0, rough: 0.55, pore_d: 0.05, ray_h: 0.6, ply: 1.4 },
  limed_oak:{ group: 'Pale', name: 'Limed oak', early: '#d9c9ae', late: '#b29a7a', pore: '#f4f1ea', streak: '#cbb796', spacing: 3.6, contrast: 0.8, sharp: 3.5, pore_amt: 0.85, pore_len: 1.6, ring_porous: 1.0, rays: 0.6, ribbon: 0.0, warp: 0.75, figure: 0.08, streakAmt: 0.1, limed: 1.0, rough: 0.6, pore_d: 0.26, ray_h: 14 },
  // mid
  white_oak:{ group: 'Mid', name: 'White oak', early: '#cdae7f', late: '#9d7b51', pore: '#5f462b', streak: '#bf9d6c', spacing: 3.6, contrast: 0.62, sharp: 3.5, pore_amt: 0.65, pore_len: 1.6, ring_porous: 1.0, rays: 0.9, ribbon: 0.0, warp: 0.75, figure: 0.03, streakAmt: 0.05, limed: 0.0, rough: 0.56, pore_d: 0.26, ray_h: 14 },
  chestnut: { group: 'Mid', name: 'Chestnut', early: '#d2ad78', late: '#a47843', pore: '#6a4a28', streak: '#bf9562', spacing: 4.0, contrast: 0.6, sharp: 3.5, pore_amt: 0.6, pore_len: 1.5, ring_porous: 1.0, rays: 0.1, ribbon: 0.0, warp: 0.8, figure: 0.04, streakAmt: 0.06, limed: 0.0, rough: 0.56, pore_d: 0.24, ray_h: 0.6 },
  elm:      { group: 'Mid', name: 'Elm', early: '#b98b5d', late: '#8a5e36', pore: '#5a3a20', streak: '#a6784c', spacing: 4.4, contrast: 0.6, sharp: 3.0, pore_amt: 0.6, pore_len: 1.3, ring_porous: 1.0, rays: 0.2, ribbon: 0.0, warp: 1.4, figure: 0.2, streakAmt: 0.15, limed: 0.0, rough: 0.56, pore_d: 0.2, ray_h: 0.6 },
  iroko:    { group: 'Mid', name: 'Iroko', early: '#a9813f', late: '#8a6530', pore: '#5a3e18', streak: '#9a7238', spacing: 4.0, contrast: 0.3, sharp: 2.2, pore_amt: 0.45, pore_len: 1.4, ring_porous: 0.0, rays: 0.1, ribbon: 0.6, warp: 0.6, figure: 0.1, streakAmt: 0.25, limed: 0.0, rough: 0.5, pore_d: 0.2, ray_h: 0.5 },
  mdf:      { group: 'Mid', name: 'MDF', early: '#b39b7e', late: '#ad9578', pore: '#9a8268', streak: '#b09779', spacing: 3.0, contrast: 0.0, sharp: 1.0, pore_amt: 0.0, pore_len: 1.0, ring_porous: 0.0, rays: 0.0, ribbon: 0.0, warp: 0.0, figure: 0.0, streakAmt: 0.0, limed: 0.0, rough: 0.75, pore_d: 0.02, ray_h: 0.2 },
  // dark & red
  cherry:   { group: 'Dark & red', name: 'Cherry', early: '#94472b', late: '#6e301c', pore: '#4c2213', streak: '#7e3a23', spacing: 2.6, contrast: 0.42, sharp: 2.6, pore_amt: 0.14, pore_len: 0.9, ring_porous: 0.0, rays: 0.25, ribbon: 0.0, warp: 0.3, figure: 0.05, streakAmt: 0.12, limed: 0.0, rough: 0.46, straight: 1.0, pore_d: 0.06, ray_h: 0.6 },
  sapele:   { group: 'Dark & red', name: 'Sapele', early: '#83472a', late: '#64321b', pore: '#421d0e', streak: '#8f5233', spacing: 3.0, contrast: 0.3, sharp: 2.2, pore_amt: 0.35, pore_len: 1.3, ring_porous: 0.0, rays: 0.1, ribbon: 1.0, warp: 0.3, figure: 0.1, streakAmt: 0.15, limed: 0.0, rough: 0.46, straight: 1.0, pore_d: 0.16, ray_h: 0.5 },
  padauk:   { group: 'Dark & red', name: 'Padauk', early: '#a83c20', late: '#842c18', pore: '#561c10', streak: '#963620', spacing: 3.8, contrast: 0.3, sharp: 2.2, pore_amt: 0.38, pore_len: 1.4, ring_porous: 0.0, rays: 0.15, ribbon: 1.0, warp: 0.8, figure: 0.12, streakAmt: 0.2, limed: 0.0, rough: 0.46, pore_d: 0.2, ray_h: 0.5 },
  walnut:   { group: 'Dark & red', name: 'Black walnut', early: '#5a3d2a', late: '#3e291b', pore: '#22150d', streak: '#4a3a36', spacing: 4.2, contrast: 0.4, sharp: 2.6, pore_amt: 0.45, pore_len: 1.2, ring_porous: 0.35, rays: 0.2, ribbon: 0.0, warp: 1.3, figure: 0.22, streakAmt: 0.35, limed: 0.0, rough: 0.5, pore_d: 0.16, ray_h: 0.6 },
  wenge:    { group: 'Dark & red', name: 'Wenge', early: '#5d4837', late: '#2b1f17', pore: '#140f0b', streak: '#7a6450', spacing: 1.6, contrast: 0.95, sharp: 1.6, pore_amt: 0.6, pore_len: 2.2, ring_porous: 0.0, rays: 0.1, ribbon: 0.0, warp: 0.4, figure: 0.1, streakAmt: 0.75, limed: 0.0, rough: 0.58, pore_d: 0.24, ray_h: 0.5 },
  bog_oak:  { group: 'Dark & red', name: 'Bog oak', early: '#4b4641', late: '#2d2926', pore: '#171513', streak: '#3d3935', spacing: 3.4, contrast: 0.7, sharp: 3.5, pore_amt: 0.55, pore_len: 1.6, ring_porous: 1.0, rays: 0.8, ribbon: 0.0, warp: 0.75, figure: 0.14, streakAmt: 0.15, limed: 0.0, rough: 0.56, pore_d: 0.26, ray_h: 14 },
};

export const FINISHES = {
  raw:   { name: 'Raw',        darken: 1.0,  sat: 1.0,  rough: 0.10, coat: 0.0,  coatRough: 0.5 },
  oil:   { name: 'Oiled',      darken: 0.86, sat: 1.12, rough: -0.06, coat: 0.18, coatRough: 0.38 },
};

// type: 0 opaque, 1 metallic (metal powder), 2 translucent (tinted, Beer-Lambert)
// metallic: color = swatch / binder tint, f0 = measured metal reflectance at normal incidence (sRGB hex)
export const FILLS = {
  black:    { name: 'Black',      group: 'Opaque', type: 0, color: '#0c0c0d', rough: 0.12 },
  white:    { name: 'White',      group: 'Opaque', type: 0, color: '#ece9e2', rough: 0.14 },
  bone:     { name: 'Bone',       group: 'Opaque', type: 0, color: '#ddd2bb', rough: 0.16 },
  teal:     { name: 'Teal',       group: 'Opaque', type: 0, color: '#0f6b6e', rough: 0.12 },
  cobalt:   { name: 'Cobalt',     group: 'Opaque', type: 0, color: '#1b3f8f', rough: 0.12 },
  oxblood:  { name: 'Oxblood',    group: 'Opaque', type: 0, color: '#5c1016', rough: 0.12 },
  marble:   { name: 'Marble',     group: 'Opaque', type: 0, color: '#e9e6e0', vein: '#55575c', rough: 0.14 },
  gunmetal: { name: 'Gunmetal',   group: 'Metallic', type: 1, color: '#2e3134', rough: 0.4, f0: '#80848a' },
  bronze:   { name: 'Bronze',     group: 'Metallic', type: 1, color: '#6e4b2c', rough: 0.36, f0: '#c99261' },
  brass:    { name: 'Brass',      group: 'Metallic', type: 1, color: '#7a6a3a', rough: 0.36, f0: '#cdb676' },
  gold:     { name: 'Gold',       group: 'Metallic', type: 1, color: '#8a6a24', rough: 0.3, f0: '#e8bd62' },
  copper:   { name: 'Copper',     group: 'Metallic', type: 1, color: '#7a3d24', rough: 0.36, f0: '#d48a63' },
  smoke:    { name: 'Smoky',      group: 'Tinted'     , type: 2, color: '#2a2622', absorb: [0.9, 0.95, 1.0], scatter: '#14110f', rough: 0.05 },
  amber:    { name: 'Amber',      group: 'Tinted'     , type: 2, color: '#d08a2a', absorb: [0.035, 0.12, 0.42], scatter: '#7a4a10', rough: 0.05 },
  ocean:    { name: 'Ocean',      group: 'Tinted'     , type: 2, color: '#1b8fa0', absorb: [1.3, 0.35, 0.28], scatter: '#053a46', rough: 0.05 },
  emerald:  { name: 'Emerald',    group: 'Tinted'     , type: 2, color: '#2f9d5a', absorb: [1.1, 0.25, 0.8], scatter: '#063d1c', rough: 0.05 },
  clear:    { name: 'Clear',      group: 'Tinted'     , type: 2, color: '#ffffff', absorb: [0.03, 0.03, 0.035], scatter: '#000000', rough: 0.04 },
};

// Light presets, after Relief Forge 2.0.7. Each is a complete set-up (key height and strength, warmth, cool fill, studio
// ambient, exposure, occlusion); the panel only exposes direction and brightness on top. Picked for reading a carve:
// Studio for the overall look, Raking to judge depth and wall quality, Overhead for true colour and pattern with
// little shadow, Daylight for a cooler, window-lit check of how the wood will read in a room.
export const LIGHTS = {
  studio:   { name: 'Studio',   az: 220, el: 42, key: 2.0, env: 0.5,  warm: 0.2,  fill: 0.25, exp: 1.0, ao: 0.25 },
  raking:   { name: 'Raking',   az: 250, el: 14, key: 3.4, env: 0.32, warm: 0.3,  fill: 0.35, exp: 1.2, ao: 0.3 },
  overhead: { name: 'Overhead', az: 180, el: 70, key: 1.45, env: 0.55, warm: 0.0,  fill: 0.5,  exp: 1.0, ao: 0.2 },
  daylight: { name: 'Daylight', az: 300, el: 40, key: 2.2, env: 0.45, warm: -0.4, fill: 0.4,  exp: 1.0, ao: 0.25 },
};

// Paint sprayed into the carve with the face masked (or sanded back after), so only the walls and floor are coloured.
// type 0 flat (satin), 1 metallic; f0 for metallic as in FILLS.
export const PAINTS = {
  black:  { name: 'Black',  type: 0, color: '#141414', rough: 0.55 },
  white:  { name: 'White',  type: 0, color: '#ecebe6', rough: 0.55 },
  navy:   { name: 'Navy',   type: 0, color: '#1c2a48', rough: 0.55 },
  red:    { name: 'Red',    type: 0, color: '#8c1c1a', rough: 0.55 },
  green:  { name: 'Green',  type: 0, color: '#22412d', rough: 0.55 },
  gold:   { name: 'Gold',   type: 1, color: '#6e531f', rough: 0.42, f0: '#e0b964' },
  silver: { name: 'Silver', type: 1, color: '#55585c', rough: 0.4, f0: '#c9ccd0' },
};

// A resin in any colour, shown as one of the three resin types. Derived the way the presets above are set:
// metallic F0 is the colour lifted toward white; tinted (translucent) resin absorbs per channel as -ln(linear colour),
// scaled so a mid colour reads like the Ocean or Amber presets, with a dark scatter of the same hue.
export function customFill(hex, type) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const h = (v) => '#' + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  if (type === 1) return { name: 'Custom', type: 1, color: h(c.map((x) => x * 0.5)), rough: 0.36, f0: h(c.map((x) => 255 - (255 - x) * 0.6)) };
  if (type === 2) {
    const lin = c.map((x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return { name: 'Custom', type: 2, color: hex, rough: 0.05, absorb: lin.map((x) => -Math.log(Math.max(x, 0.02)) * 0.28), scatter: h(c.map((x) => x * 0.3)) };
  }
  return { name: 'Custom', type: 0, color: hex, rough: 0.12 };
}
