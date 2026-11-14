#version 300 es
precision highp float;
// One instance = one decoration (leaf, thorn, berry, needle, holly leaf, blossom) attached to a
// point of a branch. It bends with the branch (same sway/tremble as the strokes).

layout(location = 0) in vec4 a_pos;   // x, y (local), angle (local, radians), size (local units)
layout(location = 1) in vec4 a_shape; // shape id, flex, unused, seed
layout(location = 2) in vec4 a_col;   // rgb, alpha
layout(location = 3) in vec4 a_misc;  // glow, layer index, unused, unused

const int MAX_LAYERS = 32;
uniform vec4 u_org[MAX_LAYERS];
uniform vec4 u_mat[MAX_LAYERS];
uniform vec4 u_motion[MAX_LAYERS];
uniform vec4 u_view;
uniform float u_time;
uniform float u_px;

out vec2 v_uv;            // x across (-0.5..0.5), y along (0 base .. 1 tip)
flat out float v_shape;
flat out vec4 v_col;
flat out float v_glow;
flat out float v_uvPerPx;
flat out float v_seed;

void main() {
  int layer = int(a_misc.y);
  vec4 M = u_mat[layer];
  vec4 mo = u_motion[layer];
  float flex = a_shape.y;
  float ang = mo.x * flex * sin(u_time * mo.y + flex * 2.0)
            + mo.z * flex * sin(u_time * mo.w * 6.2831853 + flex * 23.0);
  float c = cos(ang), s = sin(ang);
  vec2 p = vec2(c * a_pos.x - s * a_pos.y, s * a_pos.x + c * a_pos.y);
  vec2 dirL = vec2(cos(a_pos.z + ang), sin(a_pos.z + ang));

  vec2 base = u_org[layer].xy + vec2(M.x * p.x + M.z * p.y, M.y * p.x + M.w * p.y);
  vec2 dirW = vec2(M.x * dirL.x + M.z * dirL.y, M.y * dirL.x + M.w * dirL.y);
  float scale = sqrt(abs(M.x * M.w - M.y * M.z));
  float len = length(dirW);
  dirW = len > 1e-7 ? dirW / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirW.y, dirW.x);
  float size = max(a_pos.w * scale, 1e-6);

  float pad = 2.0 * u_px / size;
  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float sy = (gl_VertexID & 2) == 0 ? 0.0 : 1.0;
  vec2 uv = vec2(sx * (0.5 + pad), mix(-pad, 1.0 + pad, sy));
  vec2 P = base + dirW * (uv.y * size) + perp * (uv.x * size);

  v_uv = uv;
  v_shape = a_shape.x;
  v_col = a_col;
  v_glow = a_misc.x;
  v_uvPerPx = u_px / size;
  v_seed = a_shape.w;
  gl_Position = vec4((P - u_view.zw) * u_view.xy, 0.0, 1.0);
}
