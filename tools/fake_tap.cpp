// fake_tap: stands in for Sprout Tap plugins so the app can be tested without a DAW.
// Writes synthetic singing (phrases with vibrato, up to F6) into shared-memory slots in real time.
//
//   fake_tap [--takes N] [--instrument] [--seconds S] [--custom THEME_ID]
//
// Take 1 is the "live voice"; further takes sing a third / fifth above as playback layers.

#include "SproutBus.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <string>
#include <thread>
#include <vector>

namespace
{
constexpr double kPi = 3.14159265358979323846;
constexpr double kSampleRate = 48000.0;
constexpr int kChunk = 480; // 10 ms

double midiToHz (double m) { return 440.0 * std::pow (2.0, (m - 69.0) / 12.0); }

// A short melody in MIDI notes (A4 .. F6), each 0.6 s, with a 0.8 s breath every 4 notes.
const double kMelody[] = { 69, 72, 76, 81, 79, 84, 88, 89, 86, 81, 77, 76 };
constexpr double kNoteLen = 0.6, kBreath = 0.8;

struct Voice
{
    double phase = 0.0;
    double interval = 0.0; // semitones above the melody
    double delay = 0.0;    // seconds
    float gain = 0.25f;
};

float singSample (Voice& v, double t)
{
    t -= v.delay;
    if (t < 0)
        return 0.0f;
    const double phraseLen = 4 * kNoteLen + kBreath;
    const int phrase = (int) (t / phraseLen);
    const double inPhrase = std::fmod (t, phraseLen);
    if (inPhrase >= 4 * kNoteLen)
        return 0.0f; // breath
    const int noteIdx = (phrase * 4 + (int) (inPhrase / kNoteLen)) % (int) (sizeof (kMelody) / sizeof (double));
    const double inNote = std::fmod (inPhrase, kNoteLen);

    const double vibrato = 0.45 * std::sin (2 * kPi * 5.6 * t) * std::min (1.0, inNote / 0.25);
    const double hz = midiToHz (kMelody[noteIdx] + v.interval + vibrato);
    v.phase += 2 * kPi * hz / kSampleRate;
    if (v.phase > 2 * kPi)
        v.phase -= 2 * kPi;

    // Swell inside each note, louder towards the top of the phrase.
    const double env = std::sin (kPi * std::min (1.0, inNote / kNoteLen)) * (0.5 + 0.5 * (inPhrase / (4 * kNoteLen)));
    const double s = std::sin (v.phase) + 0.35 * std::sin (2 * v.phase) + 0.15 * std::sin (3 * v.phase);
    return (float) (v.gain * env * s);
}

float pluckSample (double t, std::mt19937& rng)
{
    const double beat = 60.0 / 90.0;
    const double inBeat = std::fmod (t, beat);
    std::uniform_real_distribution<float> noise (-1.0f, 1.0f);
    const double env = std::exp (-inBeat * 9.0);
    const double tone = std::sin (2 * kPi * 392.0 * t) + 0.5 * std::sin (2 * kPi * 523.25 * t);
    return (float) (0.2 * env * (0.6 * tone + 0.4 * noise (rng) * std::exp (-inBeat * 60.0)));
}
} // namespace

int main (int argc, char** argv)
{
    int takes = 1;
    bool instrument = false;
    double seconds = 0.0; // 0 = forever
    std::string custom;   // a user theme for take 1
    for (int i = 1; i < argc; ++i)
    {
        if (! std::strcmp (argv[i], "--takes") && i + 1 < argc)        takes = std::atoi (argv[++i]);
        else if (! std::strcmp (argv[i], "--instrument"))             instrument = true;
        else if (! std::strcmp (argv[i], "--seconds") && i + 1 < argc) seconds = std::atof (argv[++i]);
        else if (! std::strcmp (argv[i], "--custom") && i + 1 < argc)  custom = argv[++i];
    }
    takes = std::max (1, std::min (takes, 6));

    sprout::BusMapping bus;
    if (! bus.open())
    {
        std::fprintf (stderr, "Could not open the Sprout bus\n");
        return 1;
    }

    const double intervals[] = { 0, 4, 7, 12, -5, 16 };
    std::vector<Voice> voices (takes);
    std::vector<sprout::SlotWriter> writers (takes + (instrument ? 1 : 0));
    std::random_device rd;
    for (size_t i = 0; i < writers.size(); ++i)
    {
        if (! writers[i].claim (*bus.get(), rd() | 1u))
        {
            std::fprintf (stderr, "No free slot\n");
            return 1;
        }
    }
    for (int i = 0; i < takes; ++i)
    {
        voices[i].interval = intervals[i];
        voices[i].delay = 0.0;
        voices[i].gain = i == 0 ? 0.3f : 0.18f;
    }

    std::printf ("fake_tap: %d take(s)%s, Ctrl+C to stop\n", takes, instrument ? " + instrument" : "");
    std::mt19937 rng (1234);
    std::vector<float> chunk (kChunk);
    uint64_t written = 0;
    const auto start = std::chrono::steady_clock::now();

    std::vector<uint32_t> lookTheme;
    std::vector<float> lookDensity;
    std::vector<std::string> lookCustom;
    while (seconds <= 0.0 || written / kSampleRate < seconds)
    {
        for (size_t w = 0; w < writers.size(); ++w)
        {
            const bool isInstrument = instrument && w == writers.size() - 1;
            double sumSq = 0.0;
            float peak = 0.0f;
            for (int i = 0; i < kChunk; ++i)
            {
                const double t = (written + i) / kSampleRate;
                const float s = isInstrument ? pluckSample (t, rng) : singSample (voices[w], t);
                chunk[i] = s;
                sumSq += (double) s * s;
                peak = std::max (peak, std::abs (s));
            }
            sprout::SlotInfo info;
            info.role = isInstrument ? (uint32_t) sprout::Role::Instrument
                                     : (w == 0 ? (uint32_t) sprout::Role::LiveVoice : (uint32_t) sprout::Role::TakePlayback);
            std::snprintf (info.name, sizeof (info.name), isInstrument ? "Fake instrument" : "Fake take %zu", w + 1);
            info.sampleRate = (float) kSampleRate;
            info.bpm = 90.0f;
            info.ppqPosition = (written / kSampleRate) * 1.5;
            info.isPlaying = 1;
            info.blockRms = (float) std::sqrt (sumSq / kChunk);
            info.blockPeak = peak;
            // Look: leaves, thorns, wreath per take, until the app asks for another (a viewer preset).
            if (lookTheme.size() <= w)
                lookTheme.push_back ((uint32_t) (w % 3)), lookDensity.push_back (0.55f), lookCustom.push_back (w == 0 ? custom : "");
            uint32_t reqTheme = 0;
            float reqDensity = 0.0f;
            char reqCustom[sprout::kThemeIdLength] {};
            if (writers[w].pollLookRequest (reqTheme, reqDensity, reqCustom))
            {
                lookTheme[w] = reqTheme;
                lookDensity[w] = reqDensity;
                lookCustom[w] = reqCustom;
                std::printf ("fake_tap: take %zu look request: theme %u, custom '%s', density %.2f\n", w + 1, reqTheme, reqCustom, reqDensity);
                std::fflush (stdout);
            }
            info.theme = lookTheme[w];
            info.density = lookDensity[w];
            std::snprintf (info.customTheme, sizeof (info.customTheme), "%s", lookCustom[w].c_str());
            info.colourMode = 1;
            info.reserved[0] = 1; // recording
            writers[w].writeAudio (chunk.data(), kChunk);
            writers[w].publishInfo (info);
            writers[w].heartbeat();
        }
        // The user themes the app lists (what the tap window offers).
        static uint32_t themesSeen = 0;
        static sprout::ThemeEntry themes[sprout::kMaxThemeList];
        uint32_t themeCount = 0, themeSeq = 0;
        if (sprout::readThemes (*bus.get(), themes, themeCount, themeSeq) && themeSeq != themesSeen)
        {
            themesSeen = themeSeq;
            std::printf ("fake_tap: %u user theme(s):", themeCount);
            for (uint32_t i = 0; i < themeCount; ++i)
                std::printf (" %s='%s'", themes[i].id, themes[i].name);
            std::printf ("\n");
            std::fflush (stdout);
        }
        written += kChunk;
        std::this_thread::sleep_until (start + std::chrono::microseconds ((long long) (written / kSampleRate * 1e6)));
    }

    for (auto& w : writers)
        w.release();
    return 0;
}
