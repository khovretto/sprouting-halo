// SproutBus.h - shared-memory protocol between Sprout Tap plugins and the Sprout app.
//
// One named file mapping ("Local\SproutBus_v4") holds a fixed array of slots.
// Each tap plugin instance claims one slot and is its ONLY writer:
//   - metadata + per-block features are published under a seqlock,
//   - dry mono audio goes into a per-slot ring buffer,
//   - a heartbeat says the instance is still alive.
// The app only reads, except for look requests (lookSeq / lookTheme / lookDensityBits: a viewer
// picked a preset), which the tap applies to its own parameters, and the list of user themes in
// the header (v4), which the tap shows in its window. Works across processes, so DAWs that sandbox plugins are fine.
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <atomic>
#include <cstdint>
#include <cstring>

namespace sprout
{
constexpr uint32_t kMagic         = 0x54525053; // 'SPRT'
constexpr uint32_t kVersion       = 4; // 2: per-track look; 3: app -> tap look requests; 4: user themes
constexpr uint32_t kMaxSlots      = 16;
constexpr uint32_t kAudioRingSize = 1u << 15; // 32768 samples, ~0.68 s at 48 kHz
constexpr uint32_t kNameLength    = 64;
constexpr wchar_t  kMappingName[] = L"Local\\SproutBus_v4";
constexpr uint32_t kThemeIdLength = 48; // user theme ids are at most 40 characters
constexpr uint32_t kThemeNameLength = 48;
constexpr uint32_t kMaxThemeList  = 64;

// A slot whose heartbeat is older than this is considered gone.
constexpr uint64_t kAliveTimeoutMs = 1000;
// A claimed slot whose heartbeat is older than this may be taken over (crashed host).
constexpr uint64_t kStaleTimeoutMs = 5000;

enum class Role : uint32_t
{
    LiveVoice    = 0, // the take being sung right now
    TakePlayback = 1, // a recorded layer playing back
    Instrument   = 2, // optional instrument track
};

static_assert (std::atomic<uint32_t>::is_always_lock_free);
static_assert (std::atomic<uint64_t>::is_always_lock_free);

// Fields copied out under the seqlock.
struct SlotInfo
{
    uint32_t role        = 0;
    uint32_t colourArgb  = 0; // 0 = unknown, use a palette colour
    char     name[kNameLength] {};
    float    sampleRate  = 0.0f;
    float    bpm         = 0.0f; // 0 = unknown
    double   ppqPosition = 0.0;
    uint32_t isPlaying   = 0;
    float    blockRms    = 0.0f;
    float    blockPeak   = 0.0f;

    // Per-track look, set in the tap plugin's window (v2).
    uint32_t theme       = 0;     // ThemeChoice
    float    density     = 0.55f; // decorations per branch, 0..1
    uint32_t colourMode  = 0;     // 0 track colour (palette if the track has none), 1 viewer palette
    uint32_t reserved[8] {};      // room for more without a protocol change; [0] = DAW is recording
    // A user theme id (v4); when not empty it wins over `theme`.
    char     customTheme[kThemeIdLength] {};
};

// Order of the tap's Theme choice; the app sends the names to the viewer.
enum class ThemeChoice : uint32_t
{
    Leaves = 0,
    Thorns = 1,
    Wreath = 2,
    Branches = 3,
    ViewerDefault = 4,
};

struct alignas (64) Slot
{
    std::atomic<uint32_t> owner;        // 0 = free, otherwise the owner's random token
    std::atomic<uint64_t> heartbeatMs;  // GetTickCount64() at the last update
    std::atomic<uint32_t> seq;          // seqlock: odd while the writer is updating `info`
    // App -> tap (v3): a look request (a viewer picked a preset). The app writes theme and
    // density, then bumps lookSeq; the tap applies each new lookSeq to its own parameters.
    std::atomic<uint32_t> lookSeq;
    std::atomic<uint32_t> lookTheme;       // ThemeChoice
    std::atomic<uint32_t> lookDensityBits; // float bits, 0..1
    char                  lookCustom[kThemeIdLength]; // user theme id, or empty for lookTheme (v4)
    SlotInfo              info;
    std::atomic<uint64_t> audioWritePos; // total mono samples ever written
    float                 audio[kAudioRingSize];
};

// The user themes in Sprout.exe's themes folder (v4). Written by the app under a seqlock.
struct ThemeList
{
    std::atomic<uint32_t> seq; // odd while the app is updating; 0 = never written
    uint32_t count;
    char     ids[kMaxThemeList][kThemeIdLength];
    char     names[kMaxThemeList][kThemeNameLength];
};

struct Bus
{
    uint32_t  magic;
    uint32_t  version;
    uint32_t  slotCount;
    uint32_t  reserved;
    ThemeList themes;
    Slot      slots[kMaxSlots];
};

struct ThemeEntry
{
    char id[kThemeIdLength];
    char name[kThemeNameLength];
};

// App side (the only writer): replace the theme list.
inline void publishThemes (Bus& bus, const ThemeEntry* entries, uint32_t count)
{
    ThemeList& t = bus.themes;
    if (count > kMaxThemeList)
        count = kMaxThemeList;
    const uint32_t s = t.seq.load (std::memory_order_relaxed) & ~1u;
    t.seq.store (s + 1, std::memory_order_relaxed);
    std::atomic_thread_fence (std::memory_order_release);
    t.count = count;
    for (uint32_t i = 0; i < count; ++i)
    {
        std::memcpy (t.ids[i], entries[i].id, kThemeIdLength);
        std::memcpy (t.names[i], entries[i].name, kThemeNameLength);
        t.ids[i][kThemeIdLength - 1] = 0;
        t.names[i][kThemeNameLength - 1] = 0;
    }
    t.seq.store (s + 2, std::memory_order_release);
}

// Tap side: copy the theme list (out holds kMaxThemeList). seqOut changes with every update.
inline bool readThemes (const Bus& bus, ThemeEntry* out, uint32_t& count, uint32_t& seqOut)
{
    const ThemeList& t = bus.themes;
    for (int attempt = 0; attempt < 8; ++attempt)
    {
        const uint32_t s1 = t.seq.load (std::memory_order_acquire);
        if (s1 & 1u)
            continue;
        const uint32_t n = t.count < kMaxThemeList ? t.count : kMaxThemeList;
        for (uint32_t i = 0; i < n; ++i)
        {
            std::memcpy (out[i].id, t.ids[i], kThemeIdLength);
            std::memcpy (out[i].name, t.names[i], kThemeNameLength);
            out[i].id[kThemeIdLength - 1] = 0;
            out[i].name[kThemeNameLength - 1] = 0;
        }
        std::atomic_thread_fence (std::memory_order_acquire);
        if (t.seq.load (std::memory_order_relaxed) == s1)
        {
            count = n;
            seqOut = s1;
            return true;
        }
    }
    return false;
}

inline uint64_t nowMs() { return GetTickCount64(); }

// ---------------------------------------------------------------------------------------------
// Opens (or creates) the mapping. Both sides call this; whoever comes first creates it zeroed.
class BusMapping
{
public:
    BusMapping() = default;
    ~BusMapping() { close(); }
    BusMapping (const BusMapping&) = delete;
    BusMapping& operator= (const BusMapping&) = delete;

    bool open()
    {
        if (bus != nullptr)
            return true;

        mapping = CreateFileMappingW (INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
                                      (DWORD) sizeof (Bus), kMappingName);
        if (mapping == nullptr)
            return false;

        const bool created = GetLastError() != ERROR_ALREADY_EXISTS;
        bus = static_cast<Bus*> (MapViewOfFile (mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof (Bus)));
        if (bus == nullptr)
        {
            close();
            return false;
        }

        if (created || bus->magic == 0)
        {
            bus->version   = kVersion;
            bus->slotCount = kMaxSlots;
            std::atomic_thread_fence (std::memory_order_release);
            bus->magic = kMagic;
        }

        if (bus->magic != kMagic || bus->version != kVersion)
        {
            close();
            return false;
        }
        return true;
    }

    void close()
    {
        if (bus != nullptr)
            UnmapViewOfFile (bus);
        if (mapping != nullptr)
            CloseHandle (mapping);
        bus     = nullptr;
        mapping = nullptr;
    }

    Bus* get() const { return bus; }

private:
    HANDLE mapping = nullptr;
    Bus*   bus     = nullptr;
};

// ---------------------------------------------------------------------------------------------
// Writer side (one per tap plugin instance).
class SlotWriter
{
public:
    // Claims a free (or stale) slot. Returns false if all slots are taken.
    bool claim (Bus& bus, uint32_t token)
    {
        const uint64_t now = nowMs();
        for (uint32_t i = 0; i < kMaxSlots; ++i)
        {
            Slot& s        = bus.slots[i];
            uint32_t prev  = s.owner.load (std::memory_order_acquire);
            const bool free  = prev == 0;
            const bool stale = ! free && now - s.heartbeatMs.load (std::memory_order_relaxed) > kStaleTimeoutMs;
            if ((free || stale) && s.owner.compare_exchange_strong (prev, token, std::memory_order_acq_rel))
            {
                slot = &s;
                lastLook = s.lookSeq.load (std::memory_order_acquire); // ignore requests made before we came
                slot->seq.store (0, std::memory_order_relaxed);
                slot->audioWritePos.store (0, std::memory_order_relaxed);
                slot->heartbeatMs.store (now, std::memory_order_release);
                ownerToken = token;
                return true;
            }
        }
        return false;
    }

    void release()
    {
        if (slot != nullptr)
        {
            uint32_t expected = ownerToken;
            slot->owner.compare_exchange_strong (expected, 0, std::memory_order_acq_rel);
        }
        slot = nullptr;
    }

    bool isClaimed() const { return slot != nullptr; }

    // Lets a crash-recovering app take the slot over; we then stop writing.
    bool stillOwner() const
    {
        return slot != nullptr && slot->owner.load (std::memory_order_relaxed) == ownerToken;
    }

    void heartbeat()
    {
        if (slot != nullptr)
            slot->heartbeatMs.store (nowMs(), std::memory_order_release);
    }

    // A new look request from the app since the last call? (message thread)
    // custom gets the user theme id (empty for a built-in theme).
    bool pollLookRequest (uint32_t& theme, float& density, char (&custom)[kThemeIdLength])
    {
        if (slot == nullptr)
            return false;
        const uint32_t seqNow = slot->lookSeq.load (std::memory_order_acquire);
        if (seqNow == lastLook)
            return false;
        lastLook = seqNow;
        theme = slot->lookTheme.load (std::memory_order_relaxed);
        const uint32_t bits = slot->lookDensityBits.load (std::memory_order_relaxed);
        std::memcpy (&density, &bits, sizeof (float));
        std::memcpy (custom, slot->lookCustom, kThemeIdLength);
        custom[kThemeIdLength - 1] = 0;
        return true;
    }

    // Must only be called from ONE thread (the audio thread).
    void publishInfo (const SlotInfo& info)
    {
        if (slot == nullptr)
            return;
        const uint32_t s = slot->seq.load (std::memory_order_relaxed);
        slot->seq.store (s + 1, std::memory_order_relaxed);
        std::atomic_thread_fence (std::memory_order_release);
        std::memcpy (&slot->info, &info, sizeof (SlotInfo));
        slot->seq.store (s + 2, std::memory_order_release);
    }

    // Must only be called from the same thread as publishInfo.
    void writeAudio (const float* samples, uint32_t count)
    {
        if (slot == nullptr)
            return;
        uint64_t pos = slot->audioWritePos.load (std::memory_order_relaxed);
        for (uint32_t i = 0; i < count; ++i)
            slot->audio[(pos + i) & (kAudioRingSize - 1)] = samples[i];
        slot->audioWritePos.store (pos + count, std::memory_order_release);
    }

private:
    Slot*    slot       = nullptr;
    uint32_t ownerToken = 0;
    uint32_t lastLook   = 0;
};

// ---------------------------------------------------------------------------------------------
// Reader side helpers (app).
inline bool slotIsAlive (const Slot& s, uint64_t now)
{
    return s.owner.load (std::memory_order_acquire) != 0
        && now - s.heartbeatMs.load (std::memory_order_acquire) <= kAliveTimeoutMs;
}

inline bool readInfo (const Slot& s, SlotInfo& out)
{
    for (int attempt = 0; attempt < 8; ++attempt)
    {
        const uint32_t s1 = s.seq.load (std::memory_order_acquire);
        if (s1 & 1u)
            continue;
        std::memcpy (&out, &s.info, sizeof (SlotInfo));
        std::atomic_thread_fence (std::memory_order_acquire);
        if (s.seq.load (std::memory_order_relaxed) == s1)
        {
            out.name[kNameLength - 1] = 0;
            out.customTheme[kThemeIdLength - 1] = 0;
            return true;
        }
    }
    return false;
}

// Ask the tap in this slot to switch its look (app side). custom: a user theme id, or nullptr.
inline void requestLook (Slot& s, ThemeChoice theme, float density, const char* custom = nullptr)
{
    uint32_t bits = 0;
    std::memcpy (&bits, &density, sizeof (float));
    std::memset (s.lookCustom, 0, kThemeIdLength);
    if (custom != nullptr)
        for (uint32_t i = 0; i + 1 < kThemeIdLength && custom[i] != 0; ++i)
            s.lookCustom[i] = custom[i];
    s.lookTheme.store ((uint32_t) theme, std::memory_order_relaxed);
    s.lookDensityBits.store (bits, std::memory_order_relaxed);
    s.lookSeq.fetch_add (1, std::memory_order_release);
}

// Copies the most recent `count` samples (count <= kAudioRingSize / 2). Returns the write position.
inline uint64_t readLatestAudio (const Slot& s, float* dest, uint32_t count)
{
    const uint64_t end = s.audioWritePos.load (std::memory_order_acquire);
    const uint64_t available = end < count ? end : count;
    const uint32_t missing = (uint32_t) (count - available);
    for (uint32_t i = 0; i < missing; ++i)
        dest[i] = 0.0f;
    const uint64_t start = end - available;
    for (uint64_t i = 0; i < available; ++i)
        dest[missing + i] = s.audio[(start + i) & (kAudioRingSize - 1)];
    return end;
}
} // namespace sprout
