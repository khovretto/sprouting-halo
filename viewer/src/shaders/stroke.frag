#version 300 es
precision highp float;

in vec2 v_p;
flat in vec2 v_a;
flat in vec2 v_b;
flat in vec2 v_r;
flat in vec4 v_col;
flat in float v_glow;
uniform float u_px;

layout(location = 0) out vec4 o_colour; // premultiplied
layout(location = 1) out vec4 o_glow;   // emission fed to the bloom chain

float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

// Tapered capsule distance (Inigo Quilez, "uneven capsule"), generalised to any A to B.
float sdTaper(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
  p -= pa;
  pb -= pa;
  float h = dot(pb, pb);
  if (h < 1e-12) return length(p) - max(ra, rb);
  vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
  q.x = abs(q.x);
  float b = ra - rb;
  vec2 c = vec2(sqrt(max(h - b * b, 0.0)), b);
  float k = cross2(c, q);
  float m = dot(c, q);
  float n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - ra;
  if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
  return m - ra;
}

void main() {
  float d = sdTaper(v_p, v_a, v_b, v_r.x, v_r.y);
  float cov = clamp(0.5 - d / u_px, 0.0, 1.0) * v_col.a;
  if (cov <= 0.0) discard;
  o_colour = vec4(v_col.rgb, 1.0) * cov;
  o_glow = vec4(v_col.rgb * v_glow, 1.0) * cov;
}
