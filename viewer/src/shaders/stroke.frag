#version 300 es
precision highp float;

in vec2 v_p;
flat in vec2 v_a;
flat in vec2 v_b;
flat in vec2 v_r;
flat in vec4 v_col;
flat in float v_glow;
flat in float v_join; // 1 = a link in a chain: flat start, flat end
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
  // Links of a chain tile instead of overlapping: with round caps on both ends every joint is
  // drawn twice, which shows as a bead wherever the branch is see-through. A link keeps only the
  // part between its ends; the previous link's end meets it there. Tips keep their round end.
  vec2 ab0 = v_b - v_a;
  float s0 = dot(v_p - v_a, ab0) / max(dot(ab0, ab0), 1e-12);
  if (v_join > 0.0 && (s0 < 0.0 || (v_join > 1.5 && s0 > 1.0))) discard;
  float cov = clamp(0.5 - d / u_px, 0.0, 1.0) * v_col.a;
  if (cov <= 0.0) discard;
  // Shaded edge (docs/fable-consult-2.md, R7): a stroke wider than a few pixels is darker at its
  // sides, so crossing branches stay separate instead of merging into one flat shape.
  // Measured across the stroke (distance to the segment's axis), not from the round caps: the
  // caps overlap the next segment and would otherwise show as beads.
  vec2 ab = v_b - v_a;
  float L2 = max(dot(ab, ab), 1e-12);
  float s = clamp(dot(v_p - v_a, ab) / L2, 0.0, 1.0);
  float perp = abs(ab.x * (v_p.y - v_a.y) - ab.y * (v_p.x - v_a.x)) / sqrt(L2);
  float inside = clamp((mix(v_r.x, v_r.y, s) - perp) / u_px, 0.0, 3.0); // pixels in from the edge
  // Only clearly wide strokes: on thin ones every joint between short segments would show.
  float wide = smoothstep(2.5, 4.0, max(v_r.x, v_r.y) / u_px);
  vec3 col = v_col.rgb * mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 2.0, inside)), wide);
  o_colour = vec4(col, 1.0) * cov;
  o_glow = vec4(v_col.rgb * v_glow, 1.0) * cov;
}
