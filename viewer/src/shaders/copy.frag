#version 300 es
precision highp float;
// Downsample: drawing into a half-size target with linear filtering averages 2x2 texels.
in vec2 v_uv;
uniform sampler2D u_src;
out vec4 o;
void main() { o = texture(u_src, v_uv); }
