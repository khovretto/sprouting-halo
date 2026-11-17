// Motion shared by stroke.vert and sprite.vert (docs/fable-consult-3-motion.md).
// Spliced in by renderer.ts at the `//#motion` marker, after MAX_LAYERS, u_org, u_mat and toWorld.
//
// Wind is a vector in the world; a branch bends by the part of it that hits the branch sideways,
// so the canopy shears instead of spinning. Two levels: the carrier (trunk and limbs, stiff near
// the root) and an own bend for every shoot about its attach point. Sources: three springs per
// layer (CPU, in u_mA / u_mB), gust noise drifting across the scene, per-shoot noise, and the
// vibrato shiver with a CPU-integrated phase.

uniform vec4 u_mA[MAX_LAYERS]; // limb.xy, shoot.xy (spring leans, world, radians)
uniform vec4 u_mB[MAX_LAYERS]; // twig.xy, turb, shiver phase
uniform vec4 u_mC[MAX_LAYERS]; // shiver amp, flutter amp, twigs, mode (0 plant, 1 ring)
uniform vec4 u_mD[MAX_LAYERS]; // writhe: amplitude (local units), phase, 2*pi / wavelength, 0
uniform float u_windT;         // wind clock (s), wrapped at 4096

uint hashU(uint x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
float hash01(uint x) { return float(hashU(x) >> 8) * (1.0 / 16777216.0); }

// Value noise in -1..1 with period 64, one independent stream per seed (seed < 2^24). Rates that
// multiply u_windT are multiples of 1/64, so the wrap at 4096 is invisible.
float vn(float x, uint seed) {
  float i = floor(x), f = x - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  uint k = uint(int(i));
  return mix(hash01(seed * 64u + (k & 63u)), hash01(seed * 64u + ((k + 1u) & 63u)), f) * 2.0 - 1.0;
}
float q64(float r) { return floor(r * 64.0 + 0.5) / 64.0; }

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

// World direction -> layer-local direction (u_mat is rotation * uniform scale).
vec2 toLocalDir(vec2 w, int layer) {
  vec4 m = u_mat[layer];
  return vec2(m.x * w.x + m.y * w.y, m.z * w.x + m.w * w.y) / max(1e-6, sqrt(abs(m.x * m.w - m.y * m.z)));
}

// Gusts: a world-space vector field that drifts across the scene.
vec2 gustField(vec2 wp) {
  float a = vn(u_windT * (20.0 / 64.0) - wp.x * 0.45 + wp.y * 0.17, 11u);
  float b = vn(u_windT * (43.0 / 64.0) - wp.x * 0.80 - wp.y * 0.31, 12u);
  float c = vn(u_windT * (27.0 / 64.0) + wp.x * 0.25 - wp.y * 0.55, 13u);
  return vec2(0.7 * a + 0.3 * b, 0.55 * c);
}

// Limb level. Plant: rotate about the layer origin, stiff near the root. Ring: oval / trefoil.
vec2 carry(vec2 q, float flex, int layer, out float ang) {
  vec4 A = u_mA[layer], B = u_mB[layer];
  ang = 0.0;
  if (u_mC[layer].w > 0.5) {
    float phi = atan(q.y, q.x);
    uint s = 200u + uint(layer) * 2u;
    float rho = 0.35 * (A.x * cos(2.0 * phi) + A.y * sin(2.0 * phi))
              + 0.25 * B.z * (vn(u_windT * (14.0 / 64.0), s) * cos(3.0 * phi)
                            + vn(u_windT * (19.0 / 64.0) + 0.5, s + 1u) * sin(3.0 * phi));
    return q * (1.0 + rho);
  }
  float s = clamp(flex / 1.6, 0.0, 1.25);
  vec2 W = mix(A.xy, A.zw, 0.3 * min(s, 1.0)) + B.z * gustField(toWorld(q, layer));
  float r = length(q);
  vec2 dir = r > 1e-4 ? q / r : vec2(0.0, 1.0);
  ang = clamp(s * sqrt(s) * cross2(dir, toLocalDir(W, layer)), -0.5, 0.5);
  return rot(q, ang);
}

// Writhe (motion.writhe, consult 7, 1.6) on limbs: sideways to the radial direction, stiff near the
// root. A function of the rest point only, so the two segments at a joint move together.
vec2 limbWave(vec2 P, float flex, int layer) {
  vec4 D = u_mD[layer];
  float r = length(P);
  vec2 dir = r > 1e-4 ? P / r : vec2(0.0, 1.0);
  return vec2(-dir.y, dir.x) * 0.6 * D.x * smoothstep(0.25, 0.7, flex) * sin(0.6 * D.z * flex - D.y + float(layer));
}

// The shoot this instance belongs to: carried pivot, its own-bend angle at full lever, and (writhe)
// the limb wave at its pivot, its heading and its own phase.
struct Branch { vec2 pb; float k; vec2 wp; vec2 hd; float ph; float shoot; };

float shiverOf(float h, uint seed, float phase) {
  float off = h * 64.0;
  float env = 0.35 + 0.65 * (0.5 + 0.5 * vn(u_windT * (70.0 / 64.0) + off, seed));
  return env * sin(phase + 6.2831853 * h + 1.2 * vn(u_windT * (45.0 / 64.0) + off, seed + 1u));
}

Branch branchOf(vec4 bend, float order, int layer) {
  Branch br;
  br.pb = vec2(0.0);
  br.k = 0.0;
  br.wp = vec2(0.0);
  br.hd = vec2(0.0, 1.0);
  br.ph = 0.0;
  br.shoot = 0.0;
  if (order < 1.5) return br;
  vec4 A = u_mA[layer], B = u_mB[layer], C = u_mC[layer];
  float aB;
  br.pb = carry(bend.xy, bend.z, layer, aB);
  uint id = hashU(floatBitsToUint(bend.x) + 0x9e3779b9U * hashU(floatBitsToUint(bend.y)
          ^ hashU(floatBitsToUint(bend.w) + uint(layer))));
  float h1 = float(id & 1023u) / 1023.0, h2 = float((id >> 10) & 1023u) / 1023.0;
  uint seed = 4096u + (id >> 20) * 4u;
  float off = h1 * 64.0;
  float thin = clamp(0.3 + 0.5 * (order - 2.0) + 0.4 * (h1 - 0.5), 0.0, 1.0);
  float r1 = q64(mix(0.9, 1.7, h2) * (1.0 + 0.5 * thin)), r2 = q64(mix(0.9, 1.7, h2) * 0.77);
  vec2 W = mix(A.zw, B.xy, thin) * (0.7 + 0.6 * h2)
         + 1.6 * B.z * vec2(vn(u_windT * r1 + off, seed), 0.6 * vn(u_windT * r2 + off, seed + 1u));
  vec2 hd = vec2(cos(bend.w), sin(bend.w));
  float sh = C.x * (0.5 + 0.5 * thin) * shiverOf(h1, seed + 2u, B.w);
  br.k = clamp(C.z * 0.5 * order * (cross2(hd, toLocalDir(W, layer)) + sh), -0.7, 0.7);
  if (u_mD[layer].x > 0.0) {
    br.wp = limbWave(br.pb, bend.z, layer);
    br.hd = hd;
    br.ph = 6.2831853 * h1;
    br.shoot = 1.0;
  }
  return br;
}

// Rest point p (arc length flex) -> bent point (local). ang = total rotation there.
vec2 bendPoint(vec2 p, float flex, vec4 bend, Branch br, int layer, out float ang) {
  float a;
  vec2 P = carry(p, flex, layer, a);
  float u = max(flex - bend.z, 0.0);
  float own = br.k * u / (u + 0.10);
  ang = a + own;
  vec2 Q = br.pb + rot(P - br.pb, own); // k = 0 on limbs: returns P
  vec4 D = u_mD[layer];
  if (D.x > 0.0) {
    if (br.shoot > 0.5) {
      // A shoot rides its limb's wave at its pivot (u = 0 there: joined), plus its own wave.
      vec2 d = rot(br.hd, ang);
      Q += br.wp + vec2(-d.y, d.x) * D.x * (u / (u + 0.08)) * sin(D.z * u - D.y + br.ph);
    } else Q += limbWave(P, flex, layer);
  }
  return Q;
}
