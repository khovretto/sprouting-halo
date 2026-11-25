#version 300 es
precision highp float;
// One instance = one tapered segment (A to B) of a vine or branch, expanded to a quad around it.
// Positions are in the layer's local frame; u_org/u_mat place the layer in halo space.

layout(location = 0) in vec4 a_ab;    // A.xy, B.xy (local)
layout(location = 1) in vec4 a_rf;    // rA, rB, flexA, flexB (flex = distance along the branch)
layout(location = 2) in vec4 a_col;   // rgb, alpha
layout(location = 3) in vec4 a_misc;  // glow, layer index, joins (1 = flat start, 2 = both flat), branch order
layout(location = 4) in vec4 a_bend;  // pivot.xy (local), pivot flex, heading (shoot's own bend; limbs: own point)
layout(location = 5) in vec4 a_prev;  // the chain's point before A: xy (local), flex, 1 = given

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
flat out vec2 v_u; // direction of the previous link where it ends at A (this link starts on that plane)

vec2 toWorld(vec2 l, int i) {
  vec4 m = u_mat[i];
  return u_org[i].xy + vec2(m.x * l.x + m.z * l.y, m.y * l.x + m.w * l.y);
}

//#motion

// Shape change (halo squish): moves the points only, so line widths stay as they are.
uniform vec4 u_shape[MAX_LAYERS];
vec2 shapeOf(vec2 p, int L) { return vec2(p.x, p.y * u_shape[L].x); }

void main() {
  int layer = int(a_misc.y);
  vec4 m = u_mat[layer];
  float scale = sqrt(abs(m.x * m.w - m.y * m.z));

  Branch br = branchOf(a_bend, a_misc.w, layer);
  float aa;
  vec2 A = toWorld(shapeOf(bendPoint(a_ab.xy, a_rf.z, a_bend, br, layer, aa), layer), layer);
  vec2 B = toWorld(shapeOf(bendPoint(a_ab.zw, a_rf.w, a_bend, br, layer, aa), layer), layer);
  float rA = a_rf.x * scale;
  float rB = a_rf.y * scale;

  vec2 d = B - A;
  float L = length(d);
  vec2 t = L > 1e-7 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  // The quad covers only what the fragment shader keeps: a flat (joined) end is cut exactly at
  // the end point, so it needs no cap there; elsewhere the radius plus one pixel for the edge.
  float pad = max(rA, rB) + u_px;
  // A link that knows the point before it starts on the previous link's end plane, with its round
  // start beyond that plane: at a bend the wedge on the outside is filled, and nothing is drawn
  // twice. The previous point moves with this segment (same limb system, or same shoot group).
  vec2 u = t;
  bool chained = a_misc.z > 0.5 && a_prev.w > 0.5;
  if (chained) {
    float ab;
    vec2 Q = toWorld(shapeOf(bendPoint(a_prev.xy, a_prev.z, a_bend, br, layer, ab), layer), layer);
    float lq = length(A - Q);
    if (lq > 1e-7) u = (A - Q) / lq;
  }
  float padA = a_misc.z > 0.5 && !chained ? 0.5 * u_px : pad; // join 1 or 2, not chained: flat start
  float padB = a_misc.z > 1.5 ? 0.5 * u_px : pad; // join 2: flat end too

  float sx = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float sy = (gl_VertexID & 2) == 0 ? -1.0 : 1.0;
  vec2 P = (sx < 0.0 ? A - t * padA : B + t * padB) + n * sy * pad;

  v_p = P;
  v_a = A;
  v_b = B;
  v_r = vec2(rA, rB);
  v_col = a_col;
  v_glow = a_misc.x;
  v_join = a_misc.z;
  v_u = u;
  gl_Position = vec4((P - u_view.zw) * u_view.xy, 0.0, 1.0);
}
