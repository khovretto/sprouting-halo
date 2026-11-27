#version 300 es
precision highp float;
// One instance = one decoration (leaf, thorn, berry, needle, holly leaf, blossom) attached to a
// point of a branch. It moves with its node (same motion as the strokes) and then turns about its
// own stalk: trails downwind, flutters, shivers on vibrato (thorns stay rigid).

layout(location = 0) in vec4 a_pos;   // x, y (local), angle (local, radians), size (local units)
layout(location = 1) in vec4 a_shape; // shape id, flex, pivot along (0 base .. 1 tip), seed
layout(location = 2) in vec4 a_col;   // rgb, alpha
layout(location = 3) in vec4 a_misc;  // glow, layer index, branch order, pivot across (-0.5 .. 0.5 of the width)
layout(location = 4) in vec4 a_bend;  // pivot.xy (local), pivot flex, heading
layout(location = 5) in vec4 a_extra; // x: how much it moves about its own stalk (falling leaves: falling.flutter)

const int MAX_LAYERS = 32;
uniform vec4 u_org[MAX_LAYERS];
uniform vec4 u_mat[MAX_LAYERS];
uniform vec4 u_view;
uniform float u_px;

vec2 toWorld(vec2 l, int i) {
  vec4 m = u_mat[i];
  return u_org[i].xy + vec2(m.x * l.x + m.z * l.y, m.y * l.x + m.w * l.y);
}

//#motion

// Shape change (halo squish): moves the leaf and turns it with the curve; its size stays.
uniform vec4 u_shape[MAX_LAYERS];
uniform vec4 u_texInfo[16]; // theme textures: half-width, flutter, own colours
uniform float u_leaf3d;     // look.leaf3d: leaves turned and tilted in 3D (0 = flat)
uniform vec4 u_l3a;         // leaves3d: fold (rad), cup, arch, wind
uniform vec4 u_l3b;         // leaves3d: turn (rad), tilt (rad), shade, shine
uniform vec4 u_l3d;         // leaves3d: shiver (times the shiver angle)

out vec2 v_uv;            // x across (-0.5..0.5), y along (0 base .. 1 tip)
flat out float v_shape;
flat out vec4 v_col;
flat out float v_glow;
flat out float v_uvPerPx;
flat out float v_seed;
flat out vec4 v_leaf;  // look.leaf3d: cos, sin of the turn about the midrib; the leaf's world direction (x, y)
flat out vec4 v_leaf2; // look.leaf3d: tilt about the stalk (rad), fold (rad)

void main() {
  int layer = int(a_misc.y);
  vec4 M = u_mat[layer];
  vec4 B = u_mB[layer], C = u_mC[layer];
  Branch br = branchOf(a_bend, a_misc.z, layer);
  float ang;
  vec2 p = bendPoint(a_pos.xy, a_shape.y, a_bend, br, layer, ang);

  // The decoration's own motion about its base. Thorns are rigid.
  float sid = a_shape.x;
  float leafy = sid < 0.5 ? 1.0 : sid < 1.5 ? 0.0 : sid < 2.5 ? 0.3 : sid < 3.5 ? 0.5 : sid < 4.5 ? 0.8 : 0.4;
  if (sid > 15.5) leafy = u_texInfo[int(sid + 0.5) - 16].y;
  uint ls = hashU(floatBitsToUint(a_shape.w) ^ hashU(floatBitsToUint(a_bend.x) ^ hashU(floatBitsToUint(a_bend.y) + uint(layer))));
  float lh = float(ls & 1023u) / 1023.0, off = lh * 64.0;
  uint seed = 70000u + (ls >> 12) * 4u;
  vec2 Wl = toLocalDir(B.xy + B.z * gustField(toWorld(a_pos.xy, layer)), layer);
  vec2 d0 = vec2(cos(a_pos.z), sin(a_pos.z));
  float vane = clamp(1.5 * cross2(d0, Wl), -0.6, 0.6);
  float fl = 0.65 * vn(u_windT * (150.0 / 64.0) + off, seed) + 0.35 * vn(u_windT * (330.0 / 64.0) + off, seed + 1u);
  float sh = C.x * shiverOf(lh, seed + 2u, B.w); // motion.shiverDeg as it is: degrees about the stalk
  leafy *= a_extra.x;
  float la = a_pos.z + ang + leafy * (vane + C.y * fl + sh);
  vec2 dirL = vec2(cos(la), sin(la));
  float twist = 1.0 - 0.3 * leafy * clamp(C.y * 4.0, 0.0, 1.0)
              * max(0.0, vn(u_windT * (210.0 / 64.0) + off + 7.0, seed + 3u));
  // look.leaf3d: each leaf (and holly leaf) is turned about its midrib and tilted about its stalk
  // in 3D, by its own amounts and a little more with the wind, so the light glides over it.
  // sprite.frag draws the projection; the quad is not squashed.
  float roll = 0.0, pitch = 0.0;
  bool leafShape = sid < 0.5 || (sid > 3.5 && sid < 4.5);
  if (u_leaf3d > 0.0 && leafShape) {
    float wob = u_l3a.w * (0.3 + C.y * 3.0);
    float lh2 = float((ls >> 10) & 1023u) / 1023.0;
    roll = u_leaf3d * u_l3b.x * clamp(2.0 * (lh - 0.5) + 0.5 * wob * vn(u_windT * (95.0 / 64.0) + off + 3.0, seed + 5u), -1.0, 1.0);
    pitch = u_leaf3d * u_l3b.y * clamp(2.0 * (lh2 - 0.5) + 0.4 * wob * vn(u_windT * (80.0 / 64.0) + off + 9.0, seed + 6u), -1.0, 1.0);
    // Vibrato: they tremble in 3D too, at the vibrato's rate (the same shimmer as `sh`, a quarter
    // turn apart between the turn and the tilt), so the light flickers over them.
    float sh3 = u_l3d.x * a_extra.x * C.x;
    roll += u_leaf3d * sh3 * shiverOf(lh, seed + 7u, B.w);
    pitch += u_leaf3d * 0.6 * sh3 * shiverOf(lh2, seed + 8u, B.w + 1.5708);
    twist = 1.0;
  }

  float sq = u_shape[layer].x;
  p.y *= sq;
  dirL = normalize(vec2(dirL.x, dirL.y * sq) + vec2(1e-6, 0.0));
  vec2 base = u_org[layer].xy + vec2(M.x * p.x + M.z * p.y, M.y * p.x + M.w * p.y);
  vec2 dirW = vec2(M.x * dirL.x + M.z * dirL.y, M.y * dirL.x + M.w * dirL.y);
  float scale = sqrt(abs(M.x * M.w - M.y * M.z));
  float len = length(dirW);
  dirW = len > 1e-7 ? dirW / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirW.y, dirW.x);
  float size = max(a_pos.w * scale, 1e-6);

  // Quad as wide as the shape (sprite.frag: leaf 0.34, thorn 0.24, berry 0.42, needle 0.05,
  // holly 0.40, blossom 0.42 half-width) plus one pixel. Widen hw here if a shape is widened.
  float pad = u_px / size;
  float hw = sid < 0.5 ? 0.34 : sid < 1.5 ? 0.24 : sid < 2.5 ? 0.42 : sid < 3.5 ? 0.05 : sid < 4.5 ? 0.40 : 0.42;
  if (sid > 15.5) hw = u_texInfo[int(sid + 0.5) - 16].x;
  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float sy = (gl_VertexID & 2) == 0 ? 0.0 : 1.0;
  // A tilted, folded leaf reaches a little below its stalk and past its tip (by up to hw sin tilt).
  float ey = hw * abs(sin(pitch));
  vec2 uv = vec2(sx * (hw + pad), mix(-pad - ey, 1.0 + pad + ey, sy));
  // The pivot (origin) sits on the branch point: the shape grows, flutters and turns about it.
  vec2 pv = vec2(a_misc.w * 2.0 * hw, a_shape.z);
  vec2 P = base + dirW * ((uv.y - pv.y) * size) + perp * ((uv.x - pv.x) * size * twist);

  v_uv = uv;
  v_shape = a_shape.x;
  v_col = a_col;
  v_glow = a_misc.x;
  v_uvPerPx = u_px / size;
  v_seed = a_shape.w;
  v_leaf = vec4(cos(roll), sin(roll), dirW);
  v_leaf2 = vec4(pitch, u_leaf3d * u_l3a.x, 0.0, 0.0);
  gl_Position = vec4((P - u_view.zw) * u_view.xy, 0.0, 1.0);
}
