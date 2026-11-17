#version 300 es
precision highp float;
// Final output: strokes + three bloom levels (½, ¼, ⅛ resolution) for a heavy, wide glow.
// Premultiplied alpha on a transparent background; negligible glow is cut to exactly zero so OBS
// gets no colour fog over the avatar's surroundings.
//
// Crowd-aware (docs/fable-consult-2.md, R1): the glow buffer's alpha holds coverage, so after the
// blur chain the ¼ and ⅛ levels' alpha is the local ink density. A single strand in the open keeps
// its full glow; where ink is dense the glow drops (crowd), lies around the ink rather than on it
// (inkMask), and rolls off softly instead of clipping to a flat colour (knee).
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_g1;
uniform sampler2D u_g2;
uniform sampler2D u_g3;
uniform float u_strength;
uniform float u_wide;
uniform float u_crowd;
uniform float u_inkMask;
uniform float u_knee;
uniform vec4 u_shadow; // rgb, amount: a soft outline under everything (consult 7, 3.3)
out vec4 o;
void main() {
  vec4 b = texture(u_base, v_uv);
  vec4 g1 = texture(u_g1, v_uv), g2 = texture(u_g2, v_uv), g3 = texture(u_g3, v_uv);
  float dens = 0.4 * g2.a + 0.6 * g3.a;                    // local ink coverage, 0..1
  float crowd = 1.0 / (1.0 + 6.0 * u_crowd * dens * dens); // 0.15 -> 0.91, 0.5 -> 0.49, 1.0 -> 0.19
  vec3 g = (g1.rgb * 0.45 + g2.rgb * 0.7 + g3.rgb * 0.9 * u_wide) * u_strength * crowd;
  g = max(g - 0.004, 0.0);
  g *= 1.0 - u_inkMask * b.a;                              // glow around the ink, not on it
  g /= 1.0 + u_knee * max(g.r, max(g.g, g.b));             // soft knee: never clips flat, hue kept
  vec3 rgb = b.rgb + g;
  float a = clamp(b.a + max(g.r, max(g.g, g.b)), 0.0, 1.0);
  rgb = min(rgb, vec3(a));
  // Dark outline from the blurred coverage (no extra pass), under ink and glow, cut to zero where
  // coverage is negligible: pale and glowing parts stay readable over a bright scene.
  float s = clamp(u_shadow.a * (1.4 * g1.a + 0.8 * g2.a) - 0.02, 0.0, 1.0) * (1.0 - a);
  o = vec4(rgb + u_shadow.rgb * s, a + s);
}
