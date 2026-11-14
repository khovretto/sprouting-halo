#version 300 es
precision highp float;
// Final output: strokes + three bloom levels (½, ¼, ⅛ resolution) for a heavy, wide glow.
// Premultiplied alpha on a transparent background; negligible glow is cut to exactly zero so OBS
// gets no colour fog over the avatar's surroundings.
in vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_g1;
uniform sampler2D u_g2;
uniform sampler2D u_g3;
uniform float u_strength;
uniform float u_wide;
out vec4 o;
void main() {
  vec4 b = texture(u_base, v_uv);
  vec3 g = (texture(u_g1, v_uv).rgb * 0.45 + texture(u_g2, v_uv).rgb * 0.7 + texture(u_g3, v_uv).rgb * 0.9 * u_wide) * u_strength;
  g = max(g - 0.004, 0.0);
  vec3 rgb = b.rgb + g;
  float a = clamp(b.a + max(g.r, max(g.g, g.b)), 0.0, 1.0);
  o = vec4(min(rgb, vec3(a)), a);
}
