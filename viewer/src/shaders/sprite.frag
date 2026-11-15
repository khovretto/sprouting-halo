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

uniform vec4 u_glowTint; // rgb, amount: the glow leans toward this colour
uniform highp sampler2DArray u_tex; // theme textures (shape ids 16..31)
uniform vec4 u_texInfo[16];         // half-width, flutter, own colours
layout(location = 0) out vec4 o_colour;
layout(location = 1) out vec4 o_glow;

const float PI = 3.14159265;

float outsideSpan(float y) { return max(-y, y - 1.0); }

void main() {
  float x = v_uv.x, y = v_uv.y;
  int shape = int(v_shape + 0.5);
  if (shape >= 16) {
    // A theme texture: drawn pointing up, base at the bottom, premultiplied alpha.
    vec4 info = u_texInfo[shape - 16];
    vec2 tuv = vec2(x / (2.0 * info.x) + 0.5, 1.0 - y);
    if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) discard;
    vec4 tx = texture(u_tex, vec3(tuv, float(shape - 16)));
    float gain = max(v_col.r, max(v_col.g, v_col.b));
    vec3 rgb = tx.rgb * mix(v_col.rgb, vec3(gain), info.z); // tinted by the role, or own colours
    float a = tx.a * v_col.a;
    if (a <= 0.003) discard;
    o_colour = vec4(rgb * v_col.a, a);
    vec3 gc = mix(rgb, u_glowTint.rgb * dot(rgb, vec3(0.2126, 0.7152, 0.0722)) * 2.0, u_glowTint.a);
    o_glow = vec4(gc * v_col.a * v_glow, a);
    return;
  }
  vec3 col = v_col.rgb;
  float d;

  if (shape == 0) {
    // Leaf: almond outline with a darker midrib.
    float w = 0.34 * pow(max(sin(PI * clamp(y, 0.0, 1.0)), 0.0), 0.7);
    d = max(abs(x) - w, outsideSpan(y));
    float rib = 1.0 - smoothstep(0.0, 0.035, abs(x));
    col *= 1.0 - 0.5 * rib * step(0.04, y) * step(y, 0.92);
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
    col *= 1.0 - 0.45 * rib;
  } else {
    // Five-petal blossom with a warm centre.
    vec2 q = vec2(x, y - 0.5);
    float r = length(q);
    float a = atan(q.y, q.x) + v_seed * 6.2831853;
    d = r - (0.26 + 0.16 * cos(5.0 * a));
    col = mix(col, vec3(1.0, 0.95, 0.7), 1.0 - smoothstep(0.05, 0.11, r));
  }

  // Leaves (and holly): a dark rim so overlapping leaves separate, darker at the stalk and lighter
  // at the tip (docs/fable-consult-2.md, R3). The glow uses the same colour, so rims do not glow.
  if (shape == 0 || shape == 4) {
    float inside = clamp(-d / v_uvPerPx, 0.0, 4.0); // pixels in from the edge
    col *= mix(0.45, 1.0, smoothstep(0.0, 2.5, inside));
    col *= mix(0.70, 1.12, smoothstep(0.0, 1.0, y));
  }
  float cov = clamp(0.5 - d / v_uvPerPx, 0.0, 1.0) * v_col.a;
  if (cov <= 0.0) discard;
  o_colour = vec4(col, 1.0) * cov;
  vec3 gsrc = col;
  vec3 gc = mix(gsrc, u_glowTint.rgb * dot(gsrc, vec3(0.2126, 0.7152, 0.0722)) * 2.0, u_glowTint.a);
  o_glow = vec4(gc * v_glow, 1.0) * cov;
}
