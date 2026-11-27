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
flat in vec4 v_leaf;  // cos, sin of the turn about the midrib; the leaf's world direction
flat in vec4 v_leaf2; // tilt about the stalk (rad), fold (rad)

uniform float u_glowFlat; // glow.tintFlat: dark ink glows in the tint colour too
uniform vec4 u_glowTint; // rgb, amount: the glow leans toward this colour
uniform highp sampler2DArray u_tex; // theme textures (shape ids 16..31)
uniform vec4 u_texInfo[16];         // half-width, flutter, own colours
uniform vec4 u_sheen;               // look.leafSheen: rgb, amount (a hairline vein and edge on leaves)
uniform float u_leaf3d;             // look.leaf3d: folded, turned, tilted, lit leaves (0 = flat)
uniform vec4 u_l3a;                 // leaves3d: fold (rad), cup, arch, wind
uniform vec4 u_l3b;                 // leaves3d: turn (rad), tilt (rad), shade, shine
uniform vec4 u_l3c;                 // leaves3d: light (world: x right, y up, z out), pale underside
layout(location = 0) out vec4 o_colour;
layout(location = 1) out vec4 o_glow;

const float PI = 3.14159265;

float outsideSpan(float y) { return max(-y, y - 1.0); }

/** The flat outline of a leaf (0) or holly leaf (4) at (x across, y along). */
float leafD(int shape, float x, float y) {
  float w = shape == 0 ? 0.34 * pow(max(sin(PI * clamp(y, 0.0, 1.0)), 0.0), 0.7)
    : 0.4 * pow(max(sin(PI * clamp(y, 0.0, 1.0)), 0.0), 0.85) * (0.78 + 0.22 * cos(y * 2.0 * PI * 3.0));
  return max(abs(x) - w, outsideSpan(y));
}

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
    vec3 gc = mix(rgb, u_glowTint.rgb * mix(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 0.5, u_glowFlat) * 2.0, u_glowTint.a);
    o_glow = vec4(gc * v_col.a * v_glow, a);
    return;
  }
  vec3 col = v_col.rgb;
  float d;
  // Pixel size in the leaf's own (flat) units; a turned or tilted leaf has smaller ones.
  float upx = v_uvPerPx;

  // look.leaf3d: the leaf is two flat halves sloping down from the midrib like a roof (angle f; a
  // ridge reads as lit from the light's side whichever way the leaf points, a valley would not), turned about the
  // midrib (roll) and tilted about the stalk (tilt), then seen straight on. For each half, solve
  // which point of it lands on this pixel; the nearer half that is inside the outline wins. Then
  // the usual shapes below read the flat point (x, y).
  bool leaf3 = (shape == 0 || shape == 4) && u_leaf3d > 0.0;
  float half3 = 1.0;
  if (leaf3) {
    float cr = v_leaf.x, sr = v_leaf.y, cp = cos(v_leaf2.x), sp = sin(v_leaf2.x), cf = cos(v_leaf2.y), sf = sin(v_leaf2.y);
    float best = 1e9, bestD = 1e9, bx = 0.0, by = -1.0, bs = 1.0, bdet = 1.0;
    bool hit = false;
    for (int i = 0; i < 2; i++) {
      float s = i == 0 ? 1.0 : -1.0;
      // The half's across direction (s cf, 0, -sf), turned (about y) then tilted (about x):
      float ax = s * cf * cr - sf * sr, az = -s * cf * sr - sf * cr;
      // On screen: across -> (ax, -sp az), along -> (0, cp).
      float det = ax * cp;
      if (abs(det) < 1e-3) continue;
      float t = x / ax;
      if (t < 0.0) continue;
      float yy = (y + t * sp * az) / cp;
      float dd = leafD(shape, s * t, yy);
      float depth = t * cp * az + yy * sp;
      bool inside = dd <= 0.0;
      if ((inside && (!hit || depth > best)) || (!hit && !inside && dd < bestD)) {
        if (inside) {
          hit = true;
          best = depth;
        }
        bestD = dd;
        bx = s * t;
        by = yy;
        bs = s;
        bdet = det;
      }
    }
    if (by < -0.5 && bestD > 1e8) discard;
    x = bx;
    y = by;
    half3 = bs;
    upx = v_uvPerPx / sqrt(max(abs(bdet), 0.05));
  }

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
  if ((shape == 0 || shape == 4) && u_leaf3d > 0.0) {
    // look.leaf3d. The leaf as a surface: folded along the midrib (a V across) and a little cupped
    // and arched; its normal turned by the leaf's roll about the midrib, then by its direction in
    // the picture; lit from the upper left. Seen from below (rolled past edge-on), the underside
    // shows: paler and duller.
    float w = shape == 0 ? 0.34 : 0.4;
    float u = clamp(x / w, -1.0, 1.0);
    float k = u_leaf3d;
    float sf = sin(v_leaf2.y), cf = cos(v_leaf2.y);
    // This half's normal (sloping down from the midrib), domed a little across and arched along.
    vec3 n = normalize(vec3(half3 * sf + u_l3a.y * k * 0.6 * u, -u_l3a.z * k * 0.35 * cos(PI * clamp(y, 0.0, 1.0)), cf));
    float c = v_leaf.x, s = v_leaf.y, cp = cos(v_leaf2.x), sp = sin(v_leaf2.x);
    n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);      // turned about the midrib (y)
    n = vec3(n.x, cp * n.y - sp * n.z, sp * n.y + cp * n.z);   // tilted about the stalk (x)
    vec2 dir = v_leaf.zw, side = vec2(-dir.y, dir.x);          // the leaf's along / across (+x side, as sprite.vert lays it)
    vec3 nw = vec3(side * n.x + dir * n.y, n.z);
    bool under = nw.z < 0.0;
    if (under) nw = -nw;
    vec3 L = normalize(u_l3c.xyz);
    float diff = max(dot(nw, L), 0.0);
    float spec = pow(max(dot(reflect(-L, nw), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
    float shade = u_l3b.z;
    float lit = mix(1.0, (1.0 - shade) + shade * 1.6 * diff, k);
    vec3 base = under ? mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))) * 1.25, u_l3c.w) : col;
    col = base * lit + vec3(u_l3b.w) * spec * k * (under ? 0.3 : 1.0) * max(max(col.r, col.g), col.b);
  }
  if (shape == 0 || shape == 4) {
    float inside = clamp(-d / upx, 0.0, 4.0); // pixels in from the edge
    col *= mix(0.45, 1.0, smoothstep(0.0, 2.5, inside));
    col *= mix(0.70, 1.12, smoothstep(0.0, 1.0, y));
    if (u_sheen.a > 0.0) {
      // At least 0.75 px wide, so it survives on small leaves; the edge line on one side only.
      float vein = (1.0 - smoothstep(0.0, max(0.03, 0.75 * upx), abs(x))) * step(0.06, y) * step(y, 0.9);
      float edge = smoothstep(0.5, 1.5, inside) * (1.0 - smoothstep(1.5, 3.0, inside)) * smoothstep(-0.05, 0.2, x);
      col = mix(col, u_sheen.rgb, u_sheen.a * max(0.8 * vein, 0.6 * edge));
    }
  }
  float cov = clamp(0.5 - d / upx, 0.0, 1.0) * v_col.a;
  if (cov <= 0.0) discard;
  o_colour = vec4(col, 1.0) * cov;
  vec3 gsrc = col;
  vec3 gc = mix(gsrc, u_glowTint.rgb * mix(dot(gsrc, vec3(0.2126, 0.7152, 0.0722)), 0.5, u_glowFlat) * 2.0, u_glowTint.a);
  o_glow = vec4(gc * v_glow, 1.0) * cov;
}
