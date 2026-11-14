#version 300 es
precision highp float;
// Decoration shapes as signed distances in the sprite's uv space (x across, y base to tip).
// 0 leaf, 1 thorn, 2 berry, 3 pine needle, 4 holly leaf, 5 blossom.

in vec2 v_uv;
flat in float v_shape;
flat in vec4 v_col;
flat in float v_glow;
flat in float v_uvPerPx;
flat in float v_seed;

layout(location = 0) out vec4 o_colour;
layout(location = 1) out vec4 o_glow;

const float PI = 3.14159265;

float outsideSpan(float y) { return max(-y, y - 1.0); }

void main() {
  float x = v_uv.x, y = v_uv.y;
  int shape = int(v_shape + 0.5);
  vec3 col = v_col.rgb;
  float d;

  if (shape == 0) {
    // Leaf: almond outline with a darker midrib.
    float w = 0.34 * pow(max(sin(PI * clamp(y, 0.0, 1.0)), 0.0), 0.7);
    d = max(abs(x) - w, outsideSpan(y));
    float rib = 1.0 - smoothstep(0.0, 0.035, abs(x));
    col *= 1.0 - 0.35 * rib * step(0.04, y) * step(y, 0.92);
  } else if (shape == 1) {
    // Thorn: curved, tapering hook.
    float xx = x - 0.16 * y * y;
    float w = 0.22 * pow(max(1.0 - y, 0.0), 1.25);
    d = max(abs(xx) - w, outsideSpan(y));
  } else if (shape == 2) {
    // Berry with a highlight.
    vec2 q = vec2(x, y - 0.5);
    d = length(q) - 0.42;
    float hl = 1.0 - smoothstep(0.0, 0.14, length(q - vec2(-0.13, 0.13)));
    col = mix(col, vec3(1.0), 0.6 * hl);
  } else if (shape == 3) {
    // Pine needle.
    float w = 0.05 * (1.0 - 0.55 * y);
    d = max(abs(x) - w, outsideSpan(y));
  } else if (shape == 4) {
    // Holly leaf: spiky scalloped edge and a midrib.
    float w = 0.4 * pow(max(sin(PI * clamp(y, 0.0, 1.0)), 0.0), 0.85) * (0.78 + 0.22 * cos(y * 2.0 * PI * 3.0));
    d = max(abs(x) - w, outsideSpan(y));
    float rib = 1.0 - smoothstep(0.0, 0.03, abs(x));
    col *= 1.0 - 0.3 * rib;
  } else {
    // Five-petal blossom with a warm centre.
    vec2 q = vec2(x, y - 0.5);
    float r = length(q);
    float a = atan(q.y, q.x) + v_seed * 6.2831853;
    d = r - (0.26 + 0.16 * cos(5.0 * a));
    col = mix(col, vec3(1.0, 0.95, 0.7), 1.0 - smoothstep(0.05, 0.11, r));
  }

  float cov = clamp(0.5 - d / v_uvPerPx, 0.0, 1.0) * v_col.a;
  if (cov <= 0.0) discard;
  o_colour = vec4(col, 1.0) * cov;
  o_glow = vec4(col * v_glow, 1.0) * cov;
}
