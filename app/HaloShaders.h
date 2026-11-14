#pragma once

// HLSL sources, compiled at startup with D3DCompile.
namespace sprout::shaders
{
constexpr int kMaxRings = 8;

// Full-screen triangle, no vertex buffer.
inline const char* fullscreenVS = R"(
struct VSOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
VSOut main (uint id : SV_VertexID)
{
    VSOut o;
    float2 uv = float2 ((id << 1) & 2, id & 2);
    o.pos = float4 (uv * float2 (2, -2) + float2 (-1, 1), 0, 1);
    o.uv = uv;
    return o;
}
)";

// The halo. Output is straight (non-premultiplied) alpha on a transparent background.
// ringA: x radius, y thickness, z level 0..1, w onset flash 0..1
// ringB: rgb colour, a opacity
// ringC: x random seed, y kind (0 voice, 1 instrument)
inline const char* haloPS = R"(
cbuffer Halo : register (b0)
{
    float4 ringA[8];
    float4 ringB[8];
    float4 ringC[8];
    float4 globals; // x time (s), y ring count, z texel size in p-units
};

float4 main (float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    float2 p = uv * 2.0 - 1.0;
    p.y = -p.y;
    float r = length (p);
    float a = atan2 (p.y, p.x);
    float t = globals.x;
    float aa = globals.z * 1.5;

    float3 col = 0;
    float alpha = 0;

    int count = (int) globals.y;
    [loop]
    for (int i = 0; i < count; ++i)
    {
        float lvl  = ringA[i].z;
        float fl   = ringA[i].w;
        float seed = ringC[i].x;
        bool instrument = ringC[i].y > 0.5;

        // Breathe slowly, expand a little with level.
        float R = ringA[i].x * (1.0 + 0.03 * lvl + 0.006 * sin (t * 0.7 + seed));

        // Organic wobble that grows with level.
        float wob = (0.002 + 0.0055 * lvl) * (sin (a * 5.0 + t * 0.9 + seed) + 0.5 * sin (a * 9.0 - t * 1.3 + seed * 2.0));
        float d = abs (r - (R + wob));

        float th = ringA[i].y * (1.0 + 1.1 * lvl + 0.6 * fl);
        float core = 1.0 - smoothstep (th * 0.5, th * 0.5 + aa, d);

        // Glow falls off fast and is cut to exactly zero a few widths out, so the rest of the
        // frame stays fully transparent (no colour fog over the avatar's surroundings in OBS).
        float glowW = 0.014 + 0.04 * lvl + 0.03 * fl;
        float glow = exp (-d / glowW) * (1.0 - smoothstep (3.0 * glowW, 5.0 * glowW, d));

        float shimmer = 0.78 + 0.22 * sin (a * 18.0 + t * 1.7 + seed * 3.0) * sin (a * 7.0 - t * 0.6 + seed);
        if (instrument)
            shimmer = 0.6 + 0.4 * pow (saturate (sin (a * 24.0 + seed * 5.0)), 6.0) * fl; // sparkle on strums

        float ci = core * (0.55 + 0.45 * lvl);
        float gi = glow * (0.16 + 0.7 * lvl + 0.6 * fl) * shimmer;
        float inten = (ci + gi) * ringB[i].a;

        // Shine: the core runs hot toward white on loud parts and onsets.
        float3 c = lerp (ringB[i].rgb, float3 (1, 1, 1), saturate (0.5 * lvl * core + 0.45 * fl * core));
        col += c * inten;
        alpha += inten;
    }

    // Fade out before the frame edge so a big glow is never clipped into a hard line in OBS.
    alpha *= 1.0 - smoothstep (0.93, 1.0, r);
    float A = saturate (alpha);
    if (A < 1.0 / 512.0)
        return float4 (0, 0, 0, 0); // below one 8-bit step: exactly transparent
    float3 rgb = col / alpha;
    return float4 (saturate (rgb), A);
}
)";

// Preview: the halo over a dark checkerboard so transparency is visible.
inline const char* previewPS = R"(
Texture2D halo : register (t0);
SamplerState samp : register (s0);
float4 main (float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target
{
    int2 cell = int2 (pos.xy / 16.0);
    float bg = ((cell.x + cell.y) & 1) ? 0.17 : 0.12;
    float4 h = halo.Sample (samp, uv);
    return float4 (lerp (float3 (bg, bg, bg), h.rgb, h.a), 1);
}
)";
} // namespace sprout::shaders
