#version 300 es
precision highp float;
// One instance = one tapered segment (A to B) of a vine or branch, expanded to a quad around it.
// Positions are in the layer's local frame; u_org/u_mat place the layer in halo space.

layout(location = 0) in vec4 a_ab;    // A.xy, B.xy (local)
layout(location = 1) in vec4 a_rf;    // rA, rB, flexA, flexB (flex = distance along the branch)
layout(location = 2) in vec4 a_col;   // rgb, alpha
layout(location = 3) in vec4 a_misc;  // glow, layer index, joins (1 = flat start, 2 = both flat), branch order
layout(location = 4) in vec4 a_bend;  // pivot.xy (local), pivot flex, heading (shoot's own bend; limbs: own point)

const int MAX_LAYERS = 32;
uniform vec4 u_org[MAX_LAYERS];     // origin.xy
uniform vec4 u_mat[MAX_LAYERS];     // 2x2 matrix (columns: xy, zw), rotation * scale * squash
uniform vec4 u_view;                // clip scale.xy, centre.xy
uniform float u_px;                 // world units per pixel

out vec2 v_p;
flat out vec2 v_a;
flat out vec2 v_b;
flat out vec2 v_r;
flat out vec4 v_col;
flat out float v_glow;
flat out float v_join;

vec2 toWorld(vec2 l, int i) {
  vec4 m = u_mat[i];
  return u_org[i].xy + vec2(m.x * l.x + m.z * l.y, m.y * l.x + m.w * l.y);
}

//#motion

void main() {
  int layer = int(a_misc.y);
  vec4 m = u_mat[layer];
  float scale = sqrt(abs(m.x * m.w - m.y * m.z));

  Branch br = branchOf(a_bend, a_misc.w, layer);
  float aa;
  vec2 A = toWorld(bendPoint(a_ab.xy, a_rf.z, a_bend, br, layer, aa), layer);
  vec2 B = toWorld(bendPoint(a_ab.zw, a_rf.w, a_bend, br, layer, aa), layer);
  float rA = a_rf.x * scale;
  float rB = a_rf.y * scale;

  vec2 d = B - A;
  float L = length(d);
  vec2 t = L > 1e-7 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float pad = max(rA, rB) + 2.0 * u_px;

  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float sy = (gl_VertexID & 2) == 0 ? -1.0 : 1.0;
  vec2 P = (sx < 0.0 ? A - t * pad : B + t * pad) + n * sy * pad;

  v_p = P;
  v_a = A;
  v_b = B;
  v_r = vec2(rA, rB);
  v_col = a_col;
  v_glow = a_misc.x;
  v_join = a_misc.z;
  gl_Position = vec4((P - u_view.zw) * u_view.xy, 0.0, 1.0);
}
