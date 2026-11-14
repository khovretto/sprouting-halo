#version 300 es
precision highp float;
// Separable 9-tap Gaussian using linear-filtered taps.
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_dir; // texel step * radius along one axis
out vec4 o;
void main() {
  vec4 c = texture(u_src, v_uv) * 0.2270270270;
  c += (texture(u_src, v_uv + u_dir * 1.3846153846) + texture(u_src, v_uv - u_dir * 1.3846153846)) * 0.3162162162;
  c += (texture(u_src, v_uv + u_dir * 3.2307692308) + texture(u_src, v_uv - u_dir * 3.2307692308)) * 0.0702702703;
  o = c;
}
