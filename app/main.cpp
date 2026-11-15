// Sprout app (MVP): reads Sprout Tap slots from shared memory, renders a transparent
// audio-reactive halo with Direct3D 11, and publishes it as the Spout sender "Sprout".
//
// Keys in the preview window:
//   Up / Down  sensitivity +/- 3 dB
//   I          show or hide the idle ring when no tap is connected
//   Esc        quit
//
// Command line:
//   --size N         output size in pixels (square), default 1080
//   --name NAME      Spout sender name, default "Sprout"
//   --stats          print per-tap levels to the parent console
//   --exit-after S   quit after S seconds (for tests)

#include "SproutBus.h"
#include "HaloShaders.h"
#include "FeatureServer.h"
#include "Pitch.h"

#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include "SpoutDX.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdlib>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "d3dcompiler.lib")
#pragma comment(lib, "dxgi.lib")

using Microsoft::WRL::ComPtr;

namespace
{
// ---------------------------------------------------------------------------------------------
// Settings
struct Settings
{
    int outputSize = 1080;
    std::string senderName = "Sprout";
    bool stats = false;
    double exitAfter = 0.0;
    float floorDb = -55.0f; // level 0
    float rangeDb = 45.0f;  // level 1 at floorDb + rangeDb
    bool showIdle = true;
    int webPort = 7777;      // feature WebSocket + viewer web page (0 = off)
    std::wstring webRoot;    // folder with the built viewer; empty = auto-detect
};

Settings parseArgs()
{
    Settings s;
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW (GetCommandLineW(), &argc);
    for (int i = 1; i < argc; ++i)
    {
        std::wstring a = argv[i];
        auto next = [&] { return i + 1 < argc ? std::wstring (argv[++i]) : std::wstring(); };
        if (a == L"--size")            s.outputSize = std::clamp (_wtoi (next().c_str()), 256, 4096);
        else if (a == L"--name")
        {
            const auto n = next();
            char utf8[256] {};
            WideCharToMultiByte (CP_UTF8, 0, n.c_str(), -1, utf8, (int) sizeof (utf8) - 1, nullptr, nullptr);
            if (utf8[0] != 0)
                s.senderName = utf8;
        }
        else if (a == L"--stats")      s.stats = true;
        else if (a == L"--exit-after") s.exitAfter = _wtof (next().c_str());
        else if (a == L"--port")       s.webPort = std::clamp (_wtoi (next().c_str()), 0, 65535);
        else if (a == L"--web")        s.webRoot = next();
    }
    LocalFree (argv);
    return s;
}

// ---------------------------------------------------------------------------------------------
// Per-tap analysis (MVP: level + onsets, computed from the shared audio ring).
struct TapState
{
    bool active = false;
    sprout::SlotInfo info {};
    uint64_t lastWritePos = 0;
    double lastAudioTime = 0.0;
    float level = 0.0f;      // smoothed 0..1
    float slowEnergy = 0.0f; // for onset detection
    float flash = 0.0f;      // onset flash 0..1
    double lastOnsetTime = -1.0;
    float seed = 0.0f;
    bool onsetNow = false;   // an onset was detected this frame (sent to the viewer)
    sprout::PitchTracker pitch; // voice taps only (live voice, take playback)
    float fade = 0.0f;       // 0..1 appear / disappear
};

constexpr uint32_t kAnalysisSamples = 4096;

float toDb (float energy) { return 10.0f * std::log10 (std::max (energy, 1e-12f)); }

void analyse (TapState& st, const sprout::Slot& slot, double now, float dt, const Settings& cfg,
              std::vector<float>& scratch)
{
    st.onsetNow = false;
    const float sr = st.info.sampleRate > 1000.0f ? st.info.sampleRate : 48000.0f;
    const uint64_t pos = sprout::readLatestAudio (slot, scratch.data(), kAnalysisSamples);
    if (pos != st.lastWritePos)
    {
        st.lastWritePos = pos;
        st.lastAudioTime = now;
    }
    const bool stale = now - st.lastAudioTime > 0.25; // host stopped sending audio

    // Pitch + vibrato (app/Pitch.h) on voice taps, gated at the sensitivity floor.
    if ((sprout::Role) st.info.role != sprout::Role::Instrument && ! stale)
    {
        if (st.pitch.sampleRate() != sr)
            st.pitch.prepare (sr);
        const int W = st.pitch.window();
        st.pitch.update (scratch.data() + kAnalysisSamples - W, dt, cfg.floorDb);
    }
    else if (st.pitch.voiced || st.pitch.vibratoDepth > 0.0f)
        st.pitch.reset();

    // Fast energy over the last ~10 ms.
    const uint32_t nFast = std::clamp ((uint32_t) (sr * 0.010f), 32u, kAnalysisSamples);
    double e = 0.0;
    for (uint32_t i = kAnalysisSamples - nFast; i < kAnalysisSamples; ++i)
        e += (double) scratch[i] * scratch[i];
    float fastEnergy = stale ? 0.0f : (float) (e / nFast);

    // Level: dB mapped to 0..1, fast attack, slower release.
    const float target = std::clamp ((toDb (fastEnergy) - cfg.floorDb) / cfg.rangeDb, 0.0f, 1.0f);
    const float tau = target > st.level ? 0.025f : 0.30f;
    st.level += (target - st.level) * (1.0f - std::exp (-dt / tau));

    // Onset: fast energy jumps well above its slow average.
    const bool loudEnough = toDb (fastEnergy) > cfg.floorDb + 6.0f;
    if (loudEnough && fastEnergy > st.slowEnergy * 3.0f && now - st.lastOnsetTime > 0.12)
    {
        st.flash = 1.0f;
        st.onsetNow = true;
        st.lastOnsetTime = now;
    }
    st.slowEnergy += (fastEnergy - st.slowEnergy) * (1.0f - std::exp (-dt / 0.30f));
    st.flash *= std::exp (-dt / 0.22f);
}

// ---------------------------------------------------------------------------------------------
std::array<float, 3> paletteColour (int index, sprout::Role role)
{
    if (role == sprout::Role::Instrument)
        return { 0.62f, 0.86f, 1.00f };
    static const std::array<std::array<float, 3>, 6> palette { {
        { 1.00f, 0.80f, 0.42f }, // warm gold
        { 1.00f, 0.55f, 0.70f }, // rose
        { 0.55f, 0.80f, 1.00f }, // sky
        { 0.60f, 1.00f, 0.75f }, // mint
        { 0.80f, 0.65f, 1.00f }, // lavender
        { 1.00f, 0.66f, 0.45f }, // coral
    } };
    return palette[(size_t) index % palette.size()];
}

std::array<float, 3> tapColour (const sprout::SlotInfo& info, int index)
{
    const uint32_t c = info.colourArgb;
    const uint32_t rgb = c & 0x00ffffffu;
    if ((c >> 24) != 0 && rgb != 0)
        return { ((rgb >> 16) & 0xff) / 255.0f, ((rgb >> 8) & 0xff) / 255.0f, (rgb & 0xff) / 255.0f };
    return paletteColour (index, (sprout::Role) info.role);
}

// ---------------------------------------------------------------------------------------------
struct HaloConstants
{
    float ringA[sprout::shaders::kMaxRings][4];
    float ringB[sprout::shaders::kMaxRings][4];
    float ringC[sprout::shaders::kMaxRings][4];
    float globals[4];
};
static_assert (sizeof (HaloConstants) % 16 == 0);

// ---------------------------------------------------------------------------------------------
// D3D11 state
struct Gfx
{
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> ctx;
    ComPtr<IDXGISwapChain1> swapChain;
    ComPtr<ID3D11RenderTargetView> backBufferRTV;

    ComPtr<ID3D11Texture2D> haloTex;
    ComPtr<ID3D11RenderTargetView> haloRTV;
    ComPtr<ID3D11ShaderResourceView> haloSRV;

    ComPtr<ID3D11VertexShader> vs;
    ComPtr<ID3D11PixelShader> haloPS, previewPS;
    ComPtr<ID3D11Buffer> constants;
    ComPtr<ID3D11SamplerState> sampler;

    UINT width = 0, height = 0;
};

Gfx gfx;
Settings cfg;
bool running = true;

void fail (const char* what, HRESULT hr = S_OK)
{
    char msg[512];
    std::snprintf (msg, sizeof (msg), "%s (hr=0x%08lx)", what, (unsigned long) hr);
    MessageBoxA (nullptr, msg, "Sprout", MB_ICONERROR);
    ExitProcess (1);
}

ComPtr<ID3DBlob> compile (const char* src, const char* target)
{
    ComPtr<ID3DBlob> code, errors;
    HRESULT hr = D3DCompile (src, std::strlen (src), nullptr, nullptr, nullptr, "main", target,
                             D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, &code, &errors);
    if (FAILED (hr))
        fail (errors ? (const char*) errors->GetBufferPointer() : "Shader compile failed", hr);
    return code;
}

void createBackBufferView()
{
    ComPtr<ID3D11Texture2D> back;
    gfx.swapChain->GetBuffer (0, IID_PPV_ARGS (&back));
    gfx.device->CreateRenderTargetView (back.Get(), nullptr, &gfx.backBufferRTV);
}

void initGfx (HWND hwnd)
{
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    HRESULT hr = D3D11CreateDevice (nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels, 2,
                                    D3D11_SDK_VERSION, &gfx.device, nullptr, &gfx.ctx);
    if (FAILED (hr))
        hr = D3D11CreateDevice (nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels + 1, 1,
                                D3D11_SDK_VERSION, &gfx.device, nullptr, &gfx.ctx);
    if (FAILED (hr))
        fail ("Could not create a Direct3D 11 device", hr);

    ComPtr<IDXGIDevice> dxgiDevice;
    gfx.device.As (&dxgiDevice);
    ComPtr<IDXGIAdapter> adapter;
    dxgiDevice->GetAdapter (&adapter);
    ComPtr<IDXGIFactory2> factory;
    adapter->GetParent (IID_PPV_ARGS (&factory));

    DXGI_SWAP_CHAIN_DESC1 sd {};
    sd.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    sd.SampleDesc.Count = 1;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.BufferCount = 2;
    sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    hr = factory->CreateSwapChainForHwnd (gfx.device.Get(), hwnd, &sd, nullptr, nullptr, &gfx.swapChain);
    if (FAILED (hr))
        fail ("Could not create the swap chain", hr);
    factory->MakeWindowAssociation (hwnd, DXGI_MWA_NO_ALT_ENTER);
    createBackBufferView();

    // Offscreen halo texture: this is what Spout sends.
    D3D11_TEXTURE2D_DESC td {};
    td.Width = td.Height = (UINT) cfg.outputSize;
    td.MipLevels = td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    hr = gfx.device->CreateTexture2D (&td, nullptr, &gfx.haloTex);
    if (FAILED (hr))
        fail ("Could not create the halo texture", hr);
    gfx.device->CreateRenderTargetView (gfx.haloTex.Get(), nullptr, &gfx.haloRTV);
    gfx.device->CreateShaderResourceView (gfx.haloTex.Get(), nullptr, &gfx.haloSRV);

    auto vsCode = compile (sprout::shaders::fullscreenVS, "vs_5_0");
    auto haloCode = compile (sprout::shaders::haloPS, "ps_5_0");
    auto prevCode = compile (sprout::shaders::previewPS, "ps_5_0");
    gfx.device->CreateVertexShader (vsCode->GetBufferPointer(), vsCode->GetBufferSize(), nullptr, &gfx.vs);
    gfx.device->CreatePixelShader (haloCode->GetBufferPointer(), haloCode->GetBufferSize(), nullptr, &gfx.haloPS);
    gfx.device->CreatePixelShader (prevCode->GetBufferPointer(), prevCode->GetBufferSize(), nullptr, &gfx.previewPS);

    D3D11_BUFFER_DESC bd {};
    bd.ByteWidth = sizeof (HaloConstants);
    bd.Usage = D3D11_USAGE_DYNAMIC;
    bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    bd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    gfx.device->CreateBuffer (&bd, nullptr, &gfx.constants);

    D3D11_SAMPLER_DESC smp {};
    smp.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    smp.AddressU = smp.AddressV = smp.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    gfx.device->CreateSamplerState (&smp, &gfx.sampler);
}

void resizeSwapChain (UINT w, UINT h)
{
    if (! gfx.swapChain || w == 0 || h == 0)
        return;
    gfx.ctx->OMSetRenderTargets (0, nullptr, nullptr);
    gfx.backBufferRTV.Reset();
    gfx.swapChain->ResizeBuffers (0, w, h, DXGI_FORMAT_UNKNOWN, 0);
    createBackBufferView();
    gfx.width = w;
    gfx.height = h;
}

// ---------------------------------------------------------------------------------------------
// Web viewer feed

// The built viewer: --web, else <exe>\web, else the repo's viewer\dist next to build\Release.
std::wstring findWebRoot (const std::wstring& configured)
{
    auto hasIndex = [] (const std::wstring& dir) {
        return ! dir.empty() && GetFileAttributesW ((dir + L"\\index.html").c_str()) != INVALID_FILE_ATTRIBUTES;
    };
    if (! configured.empty())
        return configured;
    wchar_t exe[MAX_PATH] {};
    GetModuleFileNameW (nullptr, exe, MAX_PATH);
    std::wstring dir (exe);
    dir = dir.substr (0, dir.find_last_of (L"\\/"));
    for (const std::wstring& candidate : { dir + L"\\web", dir + L"\\..\\..\\viewer\\dist" })
        if (hasIndex (candidate))
            return candidate;
    return {};
}

void appendJsonString (std::string& out, const char* s)
{
    out += '"';
    for (; *s != 0; ++s)
    {
        const unsigned char c = (unsigned char) *s;
        if (c == '"' || c == '\\') { out += '\\'; out += (char) c; }
        else if (c < 0x20) { char esc[8]; std::snprintf (esc, sizeof (esc), "\\u%04x", c); out += esc; }
        else out += (char) c;
    }
    out += '"';
}

// One frame of features for the viewer (viewer/src/sources/live.ts parses this).
// pitch: MIDI note (0 = unvoiced), vibrato: depth 0..1, vibratoRate: Hz,
// effort: 0 soft .. 1 full/pressed (gain-independent), breath: 0 clear .. 1 breathy.
std::string featureJson (const std::array<TapState, sprout::kMaxSlots>& taps, double now)
{
    static const char* roles[] = { "live", "take", "instrument" };
    std::string j;
    j.reserve (2048);
    char num[160];
    std::snprintf (num, sizeof (num), "{\"type\":\"frame\",\"t\":%.4f,\"taps\":[", now);
    j += num;
    bool first = true;
    for (uint32_t i = 0; i < sprout::kMaxSlots; ++i)
    {
        const TapState& st = taps[i];
        if (! st.active)
            continue;
        if (! first)
            j += ',';
        first = false;
        const uint32_t c = st.info.colourArgb;
        char colour[16] = "";
        if ((c >> 24) != 0 && (c & 0xffffffu) != 0)
            std::snprintf (colour, sizeof (colour), "#%06x", c & 0xffffffu);
        std::snprintf (num, sizeof (num), "{\"slot\":%u,\"role\":\"%s\",\"name\":", i, roles[std::min<uint32_t> (st.info.role, 2)]);
        j += num;
        appendJsonString (j, st.info.name);
        std::snprintf (num, sizeof (num),
                       ",\"colour\":\"%s\",\"level\":%.4f,\"onset\":%s,\"pitch\":%.3f,\"vibrato\":%.3f,\"vibratoRate\":%.2f,"
                       "\"effort\":%.3f,\"breath\":%.3f,\"playing\":%s,\"bpm\":%.2f,",
                       colour, st.level, st.onsetNow ? "true" : "false", st.pitch.midi, st.pitch.vibratoDepth,
                       st.pitch.vibratoRate, st.pitch.quality.effort, st.pitch.quality.breath,
                       st.info.isPlaying ? "true" : "false", st.info.bpm);
        j += num;
        // Per-track look from the tap's window.
        static const char* themes[] = { "leaves", "thorns", "wreath", "branches", "default" };
        std::snprintf (num, sizeof (num), "\"theme\":\"%s\",\"density\":%.3f,\"trackColour\":%s,\"recording\":%s}",
                       themes[std::min<uint32_t> (st.info.theme, 4)], std::clamp (st.info.density, 0.0f, 1.0f),
                       st.info.colourMode == 0 ? "true" : "false", st.info.reserved[0] ? "true" : "false");
        j += num;
    }
    j += "]}";
    return j;
}

sprout::FeatureServer web;

// A number field from a flat JSON message ({"key":1.5,...}); false if missing.
bool jsonNumber (const std::string& msg, const char* key, float& out)
{
    const std::string k = std::string ("\"") + key + "\":";
    const size_t p = msg.find (k);
    if (p == std::string::npos)
        return false;
    out = (float) std::atof (msg.c_str() + p + k.size());
    return true;
}

// Voice detection settings (vibrato thresholds): set from the viewer, kept in a file next to Sprout.exe.
std::wstring detectFile()
{
    wchar_t exe[MAX_PATH] {};
    GetModuleFileNameW (nullptr, exe, MAX_PATH);
    std::wstring dir (exe);
    return dir.substr (0, dir.find_last_of (L"\\/")) + L"\\sprout-detect.json";
}

std::string detectJson()
{
    const auto& v = sprout::vibratoSettings;
    char buf[256];
    std::snprintf (buf, sizeof (buf),
                   "{\"type\":\"detect\",\"vibratoMinNote\":%.3f,\"vibratoMinSemitones\":%.3f,\"vibratoFullSemitones\":%.3f,"
                   "\"vibratoMinHz\":%.2f,\"vibratoMaxHz\":%.2f}",
                   v.minNote, v.minSemitones, v.fullSemitones, v.minHz, v.maxHz);
    return buf;
}

void applyDetect (const std::string& msg)
{
    auto& v = sprout::vibratoSettings;
    float x = 0.0f;
    if (jsonNumber (msg, "vibratoMinNote", x)) v.minNote = std::clamp (x, 0.15f, 2.0f);
    if (jsonNumber (msg, "vibratoMinSemitones", x)) v.minSemitones = std::clamp (x, 0.0f, 1.0f);
    if (jsonNumber (msg, "vibratoFullSemitones", x)) v.fullSemitones = std::clamp (x, v.minSemitones + 0.02f, 2.0f);
    if (jsonNumber (msg, "vibratoMinHz", x)) v.minHz = std::clamp (x, 1.0f, 15.0f);
    if (jsonNumber (msg, "vibratoMaxHz", x)) v.maxHz = std::clamp (x, v.minHz + 0.5f, 20.0f);
}

// The shared viewer settings (merged by FeatureServer), kept next to Sprout.exe so a viewer that
// connects after a restart still gets the latest value of every setting.
std::wstring settingsFile()
{
    std::wstring f = detectFile();
    return f.substr (0, f.find_last_of (L"\\/")) + L"\\sprout-settings.json";
}

std::string readFile (const std::wstring& path)
{
    FILE* f = _wfopen (path.c_str(), L"rb");
    if (f == nullptr)
        return {};
    std::string out;
    char buf[4096];
    size_t n = 0;
    while ((n = std::fread (buf, 1, sizeof (buf), f)) > 0)
        out.append (buf, n);
    std::fclose (f);
    return out;
}

void writeFile (const std::wstring& path, const std::string& text)
{
    const std::wstring tmp = path + L".tmp";
    FILE* f = _wfopen (tmp.c_str(), L"wb");
    if (f == nullptr)
        return;
    std::fwrite (text.data(), 1, text.size(), f);
    std::fclose (f);
    MoveFileExW (tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
}

void loadDetect()
{
    FILE* f = _wfopen (detectFile().c_str(), L"rb");
    if (f == nullptr)
        return;
    char buf[512] {};
    const size_t n = std::fread (buf, 1, sizeof (buf) - 1, f);
    std::fclose (f);
    applyDetect (std::string (buf, n));
}

void saveDetect()
{
    FILE* f = _wfopen (detectFile().c_str(), L"wb");
    if (f == nullptr)
        return;
    const std::string j = detectJson();
    std::fwrite (j.data(), 1, j.size(), f);
    std::fclose (f);
}

// ---- User themes: <folder of Sprout.exe>\themes\<id>.json ----------------------------------------
std::wstring themesDir()
{
    std::wstring f = detectFile();
    return f.substr (0, f.find_last_of (L"\\/")) + L"\\themes";
}

std::string stringField (const std::string& msg, const char* key)
{
    const std::string k = std::string ("\"") + key + "\":\"";
    const size_t p = msg.find (k);
    if (p == std::string::npos)
        return {};
    const size_t a = p + k.size(), b = msg.find ('"', a);
    return b == std::string::npos ? std::string() : msg.substr (a, b - a);
}

bool validThemeId (const std::string& id)
{
    if (id.empty() || id.size() > 40)
        return false;
    for (char ch : id)
        if (! (std::islower ((unsigned char) ch) || std::isdigit ((unsigned char) ch) || ch == '-'))
            return false;
    return id != "leaves" && id != "thorns" && id != "wreath" && id != "branches";
}

std::string base64Decode (const std::string& in)
{
    auto val = [] (char ch) -> int {
        if (ch >= 'A' && ch <= 'Z') return ch - 'A';
        if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
        if (ch >= '0' && ch <= '9') return ch - '0' + 52;
        if (ch == '+') return 62;
        if (ch == '/') return 63;
        return -1;
    };
    std::string out;
    int acc = 0, bits = 0;
    for (char ch : in)
    {
        const int v = val (ch);
        if (v < 0)
            continue;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8)
        {
            bits -= 8;
            out += (char) ((acc >> bits) & 0xFF);
        }
    }
    return out;
}

/** themeSave / themeDelete from a local page. Returns true when the folder changed. */
bool handleThemeMessage (const std::string& msg)
{
    const std::string id = stringField (msg, "id");
    if (! validThemeId (id))
        return false;
    const std::wstring dir = themesDir();
    CreateDirectoryW (dir.c_str(), nullptr);
    const std::wstring path = dir + L"\\" + std::wstring (id.begin(), id.end()) + L".json";
    if (msg.rfind ("{\"type\":\"themeDelete\"", 0) == 0)
        return DeleteFileW (path.c_str()) != 0;
    // At most 64 themes.
    int count = 0;
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW ((dir + L"\\*.json").c_str(), &fd);
    if (h != INVALID_HANDLE_VALUE)
    {
        do ++count; while (FindNextFileW (h, &fd));
        FindClose (h);
    }
    if (count >= 64 && GetFileAttributesW (path.c_str()) == INVALID_FILE_ATTRIBUTES)
        return false;
    const std::string data = base64Decode (stringField (msg, "data"));
    if (data.empty() || data[0] != '{')
        return false;
    writeFile (path, data);
    return true;
}

// {"type":"tapLook","theme":"wreath","density":0.8,...} -> a look request in every voice tap's slot.
void applyTapLook (const std::string& msg, sprout::Bus& bus, const std::array<TapState, sprout::kMaxSlots>& taps)
{
    auto field = [&] (const char* key) -> std::string {
        const std::string k = std::string ("\"") + key + "\":";
        const size_t p = msg.find (k);
        if (p == std::string::npos)
            return {};
        size_t a = p + k.size();
        if (a < msg.size() && msg[a] == '"')
        {
            const size_t b = msg.find ('"', a + 1);
            return b == std::string::npos ? std::string() : msg.substr (a + 1, b - a - 1);
        }
        size_t b = a;
        while (b < msg.size() && (std::isdigit ((unsigned char) msg[b]) || msg[b] == '.' || msg[b] == '-' || msg[b] == 'e'))
            ++b;
        return msg.substr (a, b - a);
    };
    const std::string name = field ("theme");
    sprout::ThemeChoice theme;
    if (name == "leaves") theme = sprout::ThemeChoice::Leaves;
    else if (name == "thorns") theme = sprout::ThemeChoice::Thorns;
    else if (name == "wreath") theme = sprout::ThemeChoice::Wreath;
    else if (name == "branches") theme = sprout::ThemeChoice::Branches;
    else return;
    const std::string d = field ("density");
    const float density = d.empty() ? 0.55f : std::clamp ((float) std::atof (d.c_str()), 0.0f, 1.0f);
    for (uint32_t i = 0; i < sprout::kMaxSlots; ++i)
        if (taps[i].active && (sprout::Role) taps[i].info.role != sprout::Role::Instrument)
            sprout::requestLook (bus.slots[i], theme, density);
}

void updateTitle (HWND hwnd, int taps)
{
    char title[256];
    char webInfo[96] = "web: off";
    if (web.isRunning())
        std::snprintf (webInfo, sizeof (webInfo), "web: http://localhost:%u (%d viewer%s)", web.port(),
                       web.clientCount(), web.clientCount() == 1 ? "" : "s");
    std::snprintf (title, sizeof (title), "Sprout  |  Spout: %s  |  %s  |  taps: %d  |  sensitivity floor %.0f dB (Up/Down)",
                   cfg.senderName.c_str(), webInfo, taps, cfg.floorDb);
    SetWindowTextA (hwnd, title);
}

LRESULT CALLBACK wndProc (HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg)
    {
        case WM_SIZE:
            resizeSwapChain (LOWORD (lp), HIWORD (lp));
            return 0;
        case WM_KEYDOWN:
            if (wp == VK_ESCAPE) running = false;
            if (wp == VK_UP)     cfg.floorDb = std::max (cfg.floorDb - 3.0f, -90.0f); // more sensitive
            if (wp == VK_DOWN)   cfg.floorDb = std::min (cfg.floorDb + 3.0f, -15.0f); // less sensitive
            if (wp == 'I')       cfg.showIdle = ! cfg.showIdle;
            return 0;
        case WM_DESTROY:
            running = false;
            PostQuitMessage (0);
            return 0;
    }
    return DefWindowProcW (hwnd, msg, wp, lp);
}
} // namespace

int WINAPI wWinMain (HINSTANCE inst, HINSTANCE, PWSTR, int)
{
    cfg = parseArgs();
    if (cfg.stats && AttachConsole (ATTACH_PARENT_PROCESS))
    {
        FILE* f = nullptr;
        freopen_s (&f, "CONOUT$", "w", stdout);
    }

    SetProcessDpiAwarenessContext (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    WNDCLASSEXW wc { sizeof (wc) };
    wc.lpfnWndProc = wndProc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursor (nullptr, IDC_ARROW);
    wc.lpszClassName = L"SproutApp";
    RegisterClassExW (&wc);

    RECT rc { 0, 0, 540, 540 };
    AdjustWindowRect (&rc, WS_OVERLAPPEDWINDOW, FALSE);
    HWND hwnd = CreateWindowExW (0, wc.lpszClassName, L"Sprout", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                                 rc.right - rc.left, rc.bottom - rc.top, nullptr, nullptr, inst, nullptr);
    initGfx (hwnd);
    ShowWindow (hwnd, SW_SHOW);
    RECT client;
    GetClientRect (hwnd, &client);
    gfx.width = (UINT) client.right;
    gfx.height = (UINT) client.bottom;

    loadDetect();
    web.setWelcome (detectJson());
    web.restoreSettings (readFile (settingsFile()));
    CreateDirectoryW (themesDir().c_str(), nullptr);
    web.setThemesDir (themesDir());
    uint64_t savedSettings = web.settingsVersion();
    double settingsDirtySince = -1.0;
    if (cfg.webPort > 0 && ! web.start ((uint16_t) cfg.webPort, findWebRoot (cfg.webRoot)))
    {
        char msg[160];
        std::snprintf (msg, sizeof (msg), "Port %d is in use, so the web viewer feed is off. Start Sprout with --port <number> to use another.", cfg.webPort);
        MessageBoxA (hwnd, msg, "Sprout", MB_ICONWARNING);
    }

    spoutDX sender;
    if (! sender.OpenDirectX11 (gfx.device.Get()))
        fail ("Spout could not use the Direct3D 11 device");
    sender.SetSenderName (cfg.senderName.c_str());

    sprout::BusMapping bus;
    std::array<TapState, sprout::kMaxSlots> taps {};
    for (size_t i = 0; i < taps.size(); ++i)
        taps[i].seed = 1.7f * (float) i + 0.37f;
    std::vector<float> scratch (kAnalysisSamples);

    LARGE_INTEGER freq, t0, prev;
    QueryPerformanceFrequency (&freq);
    QueryPerformanceCounter (&t0);
    prev = t0;
    double lastStats = 0.0;
    float idleFade = 1.0f;

    while (running)
    {
        MSG msg;
        while (PeekMessageW (&msg, nullptr, 0, 0, PM_REMOVE))
        {
            if (msg.message == WM_QUIT)
                running = false;
            TranslateMessage (&msg);
            DispatchMessageW (&msg);
        }
        if (! running)
            break;

        LARGE_INTEGER nowCounter;
        QueryPerformanceCounter (&nowCounter);
        const double now = (double) (nowCounter.QuadPart - t0.QuadPart) / (double) freq.QuadPart;
        const float dt = std::clamp ((float) ((nowCounter.QuadPart - prev.QuadPart) / (double) freq.QuadPart), 0.0f, 0.1f);
        prev = nowCounter;
        if (cfg.exitAfter > 0.0 && now > cfg.exitAfter)
            break;

        // ---- Read taps -------------------------------------------------------------------
        const bool busOk = bus.open(); // retried every frame until the first tap or app creates it
        const uint64_t ms = sprout::nowMs();
        int activeCount = 0;
        for (uint32_t i = 0; i < sprout::kMaxSlots; ++i)
        {
            TapState& st = taps[i];
            bool alive = false;
            if (busOk)
            {
                const sprout::Slot& slot = bus.get()->slots[i];
                alive = sprout::slotIsAlive (slot, ms) && sprout::readInfo (slot, st.info);
                if (alive)
                {
                    if (! st.active)
                    {
                        st.level = st.slowEnergy = st.flash = 0.0f;
                        st.pitch.reset();
                        st.lastWritePos = 0;
                        st.lastAudioTime = now;
                    }
                    analyse (st, slot, now, dt, cfg, scratch);
                }
            }
            st.active = alive;
            st.fade += ((alive ? 1.0f : 0.0f) - st.fade) * (1.0f - std::exp (-dt / 0.4f));
            if (! alive)
                st.level *= std::exp (-dt / 0.3f);
            if (alive)
                ++activeCount;
        }

        // ---- Feed the web viewer ---------------------------------------------------------
        if (web.clientCount() > 0)
            web.broadcast (featureJson (taps, now));
        web.poll();

        // Shared settings changed: save them (at most once a second while someone drags a slider).
        if (web.settingsVersion() != savedSettings)
        {
            if (settingsDirtySince < 0.0)
                settingsDirtySince = now;
            if (now - settingsDirtySince > 1.0)
            {
                writeFile (settingsFile(), web.settingsMessage());
                savedSettings = web.settingsVersion();
                settingsDirtySince = -1.0;
            }
        }

        // A viewer picked a preset: every voice tap switches to its theme and amount (the tap
        // sets its own parameters, so the DAW saves the change with the project).
        for (const std::string& msg : web.takeAppMessages())
        {
            if (msg.rfind ("{\"type\":\"themeSave\"", 0) == 0 || msg.rfind ("{\"type\":\"themeDelete\"", 0) == 0)
            {
                // A theme was saved or deleted: every viewer re-reads the list.
                static int themesRev = 0;
                if (handleThemeMessage (msg))
                    web.broadcast ("{\"type\":\"themes\",\"rev\":" + std::to_string (++themesRev) + "}");
            }
            else if (msg.rfind ("{\"type\":\"detect\"", 0) == 0)
            {
                // Voice detection changed in a viewer: apply, keep, and tell every viewer.
                applyDetect (msg);
                saveDetect();
                web.setWelcome (detectJson());
                web.broadcast (detectJson());
            }
            else if (busOk)
                applyTapLook (msg, *bus.get(), taps);
        }

        // ---- Build rings --------------------------------------------------------------------
        // Voices first (live voice, then takes), each further one a little further in.
        // A single live track gets the full main ring on its own.
        HaloConstants hc {};
        int ring = 0, voiceIndex = 0, instrumentIndex = 0;
        auto addRing = [&] (float radius, float thickness, float level, float flash,
                            std::array<float, 3> colour, float opacity, float seed, float kind) {
            if (ring >= sprout::shaders::kMaxRings)
                return;
            hc.ringA[ring][0] = radius;  hc.ringA[ring][1] = thickness;
            hc.ringA[ring][2] = level;   hc.ringA[ring][3] = flash;
            hc.ringB[ring][0] = colour[0]; hc.ringB[ring][1] = colour[1]; hc.ringB[ring][2] = colour[2];
            hc.ringB[ring][3] = opacity;
            hc.ringC[ring][0] = seed;    hc.ringC[ring][1] = kind;
            ++ring;
        };

        for (int pass = 0; pass < 3; ++pass) // 0 live voice, 1 takes, 2 instruments
        {
            for (uint32_t i = 0; i < sprout::kMaxSlots; ++i)
            {
                const TapState& st = taps[i];
                if (st.fade < 0.01f || (int) st.info.role != pass)
                    continue;
                if (pass == 2)
                {
                    const float r = 0.90f + 0.035f * instrumentIndex;
                    addRing (r, 0.004f, st.level * 0.35f, st.flash, tapColour (st.info, instrumentIndex),
                             0.75f * st.fade, st.seed, 1.0f);
                    ++instrumentIndex;
                }
                else
                {
                    const float r = 0.78f - 0.06f * voiceIndex;
                    const float thick = voiceIndex == 0 ? 0.012f : 0.007f;
                    const float opacity = (pass == 0 ? 1.0f : 0.75f) * st.fade;
                    addRing (r, thick, st.level, st.flash * 0.8f, tapColour (st.info, voiceIndex),
                             opacity, st.seed, 0.0f);
                    ++voiceIndex;
                }
            }
        }

        // Idle ring so the halo can be positioned in OBS before any tap connects.
        idleFade += (((voiceIndex == 0 && cfg.showIdle) ? 1.0f : 0.0f) - idleFade) * (1.0f - std::exp (-dt / 0.5f));
        if (idleFade > 0.01f)
            addRing (0.78f, 0.010f, 0.0f, 0.0f, paletteColour (0, sprout::Role::LiveVoice), 0.45f * idleFade, 0.37f, 0.0f);

        hc.globals[0] = (float) now;
        hc.globals[1] = (float) ring;
        hc.globals[2] = 2.0f / (float) cfg.outputSize;

        D3D11_MAPPED_SUBRESOURCE mapped;
        if (SUCCEEDED (gfx.ctx->Map (gfx.constants.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped)))
        {
            std::memcpy (mapped.pData, &hc, sizeof (hc));
            gfx.ctx->Unmap (gfx.constants.Get(), 0);
        }

        // ---- Render halo (offscreen, transparent) ------------------------------------------
        const float clear[4] = { 0, 0, 0, 0 };
        gfx.ctx->ClearRenderTargetView (gfx.haloRTV.Get(), clear);
        D3D11_VIEWPORT vp { 0, 0, (float) cfg.outputSize, (float) cfg.outputSize, 0, 1 };
        gfx.ctx->RSSetViewports (1, &vp);
        gfx.ctx->OMSetRenderTargets (1, gfx.haloRTV.GetAddressOf(), nullptr);
        gfx.ctx->IASetPrimitiveTopology (D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        gfx.ctx->IASetInputLayout (nullptr);
        gfx.ctx->VSSetShader (gfx.vs.Get(), nullptr, 0);
        gfx.ctx->PSSetShader (gfx.haloPS.Get(), nullptr, 0);
        gfx.ctx->PSSetConstantBuffers (0, 1, gfx.constants.GetAddressOf());
        gfx.ctx->Draw (3, 0);

        // ---- Send to OBS via Spout ------------------------------------------------------------
        gfx.ctx->OMSetRenderTargets (0, nullptr, nullptr);
        sender.SendTexture (gfx.haloTex.Get());

        // ---- Preview window -------------------------------------------------------------------
        const float bg[4] = { 0.08f, 0.08f, 0.09f, 1 };
        gfx.ctx->ClearRenderTargetView (gfx.backBufferRTV.Get(), bg);
        const float side = (float) std::min (gfx.width, gfx.height);
        D3D11_VIEWPORT pv { (gfx.width - side) * 0.5f, (gfx.height - side) * 0.5f, side, side, 0, 1 };
        gfx.ctx->RSSetViewports (1, &pv);
        gfx.ctx->OMSetRenderTargets (1, gfx.backBufferRTV.GetAddressOf(), nullptr);
        gfx.ctx->PSSetShader (gfx.previewPS.Get(), nullptr, 0);
        gfx.ctx->PSSetShaderResources (0, 1, gfx.haloSRV.GetAddressOf());
        gfx.ctx->PSSetSamplers (0, 1, gfx.sampler.GetAddressOf());
        gfx.ctx->Draw (3, 0);
        ID3D11ShaderResourceView* nullSrv = nullptr;
        gfx.ctx->PSSetShaderResources (0, 1, &nullSrv);

        gfx.swapChain->Present (1, 0);

        if (now - lastStats > 0.5)
        {
            lastStats = now;
            updateTitle (hwnd, activeCount);
            if (cfg.stats)
            {
                std::printf ("[%7.2fs] taps=%d", now, activeCount);
                for (uint32_t i = 0; i < sprout::kMaxSlots; ++i)
                    if (taps[i].active)
                        std::printf ("  | %s (role %u) level %.2f flash %.2f", taps[i].info.name,
                                     taps[i].info.role, taps[i].level, taps[i].flash);
                std::printf ("\n");
                std::fflush (stdout);
            }
        }
    }

    sender.ReleaseSender();
    sender.CloseDirectX11();
    return 0;
}
