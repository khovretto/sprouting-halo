// pitch_test - runs the app's PitchTracker (app/Pitch.h) over the bench's synthetic clips the way
// Sprout.exe does live (newest window, one update per 60 Hz frame) and scores it against the
// exact ground truth, using the same definitions as bench/run_bench.py.
//
//   pitch_test [--data bench/data/synth] [--rate 60] [--gate -60]
//
// Each estimate is compared with the truth at the centre of its analysis window (latency is
// window/2 + one frame, reported separately).

#include "Pitch.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace
{
bool readWav (const fs::path& p, std::vector<float>& out, float& sr)
{
    std::ifstream f (p, std::ios::binary);
    if (! f)
        return false;
    char riff[12];
    f.read (riff, 12);
    if (std::memcmp (riff, "RIFF", 4) != 0 || std::memcmp (riff + 8, "WAVE", 4) != 0)
        return false;
    uint16_t format = 0, channels = 0, bits = 0;
    uint32_t rate = 0;
    for (;;)
    {
        char id[4];
        uint32_t size = 0;
        if (! f.read (id, 4) || ! f.read ((char*) &size, 4))
            return false;
        if (std::memcmp (id, "fmt ", 4) == 0)
        {
            std::vector<char> b (size);
            f.read (b.data(), size);
            std::memcpy (&format, b.data(), 2);
            std::memcpy (&channels, b.data() + 2, 2);
            std::memcpy (&rate, b.data() + 4, 4);
            std::memcpy (&bits, b.data() + 14, 2);
            if (format == 0xFFFE && size >= 26)
                std::memcpy (&format, b.data() + 24, 2); // WAVE_FORMAT_EXTENSIBLE subformat
        }
        else if (std::memcmp (id, "data", 4) == 0)
        {
            std::vector<char> b (size);
            f.read (b.data(), size);
            const size_t frames = size / (channels * (bits / 8));
            out.assign (frames, 0.0f);
            for (size_t i = 0; i < frames; ++i)
                for (int c = 0; c < channels; ++c)
                {
                    const char* s = b.data() + (i * channels + c) * (bits / 8);
                    float v = 0;
                    if (format == 3 && bits == 32) std::memcpy (&v, s, 4);
                    else if (format == 1 && bits == 16) { int16_t x; std::memcpy (&x, s, 2); v = x / 32768.0f; }
                    else if (format == 1 && bits == 24) { int32_t x = (uint8_t) s[0] | (uint8_t) s[1] << 8 | (int8_t) s[2] << 16; v = x / 8388608.0f; }
                    else return false;
                    out[i] += v / channels;
                }
            sr = (float) rate;
            return true;
        }
        else
            f.seekg (size + (size & 1), std::ios::cur);
    }
}

std::vector<std::pair<double, double>> readTruth (const fs::path& p)
{
    std::vector<std::pair<double, double>> rows;
    std::ifstream f (p);
    std::string line;
    while (std::getline (f, line))
    {
        double t, hz;
        if (std::sscanf (line.c_str(), "%lf,%lf", &t, &hz) == 2)
            rows.push_back ({ t, hz });
    }
    return rows;
}

double truthAt (const std::vector<std::pair<double, double>>& rows, double t)
{
    if (rows.empty())
        return 0;
    const double step = rows.size() > 1 ? rows[1].first - rows[0].first : 0.01;
    const long i = std::lround ((t - rows[0].first) / step);
    if (i < 0 || i >= (long) rows.size())
        return 0;
    return rows[(size_t) i].second;
}

struct Score
{
    long sung = 0, usable = 0, raw = 0, octave = 0, reportedVoiced = 0, silent = 0, falseVoiced = 0;
    long sungHigh = 0, usableHigh = 0;
    long vibTruth = 0, vibFound = 0, vibFalse = 0, vibNone = 0;
    std::vector<double> errCents, rateErr;
    double breathSum = 0, effortSum = 0;
    long qualityFrames = 0;

    void add (const Score& o)
    {
        sung += o.sung; usable += o.usable; raw += o.raw; octave += o.octave;
        reportedVoiced += o.reportedVoiced; silent += o.silent; falseVoiced += o.falseVoiced;
        sungHigh += o.sungHigh; usableHigh += o.usableHigh;
        vibTruth += o.vibTruth; vibFound += o.vibFound; vibFalse += o.vibFalse; vibNone += o.vibNone;
        errCents.insert (errCents.end(), o.errCents.begin(), o.errCents.end());
        rateErr.insert (rateErr.end(), o.rateErr.begin(), o.rateErr.end());
        breathSum += o.breathSum; effortSum += o.effortSum; qualityFrames += o.qualityFrames;
    }
};

double pct (long a, long b) { return b > 0 ? 100.0 * a / b : 0.0; }
double median (std::vector<double> v)
{
    if (v.empty()) return 0;
    std::nth_element (v.begin(), v.begin() + v.size() / 2, v.end());
    return v[v.size() / 2];
}
} // namespace

int main (int argc, char** argv)
{
    fs::path data = "bench/data/synth";
    double rate = 60.0;
    float gate = -60.0f;
    for (int i = 1; i < argc; ++i)
    {
        if (! std::strcmp (argv[i], "--data") && i + 1 < argc) data = argv[++i];
        else if (! std::strcmp (argv[i], "--rate") && i + 1 < argc) rate = std::atof (argv[++i]);
        else if (! std::strcmp (argv[i], "--gate") && i + 1 < argc) gate = (float) std::atof (argv[++i]);
    }

    std::map<std::string, Score> byCondition;
    Score total;
    double windowMs = 0;
    int clips = 0;
    for (const auto& entry : fs::directory_iterator (data))
    {
        if (entry.path().extension() != ".wav")
            continue;
        const fs::path csv = entry.path().parent_path() / (entry.path().stem().string() + ".f0.csv");
        if (! fs::exists (csv))
            continue;
        std::vector<float> x;
        float sr = 0;
        if (! readWav (entry.path(), x, sr))
        {
            std::printf ("skip %s (unsupported wav)\n", entry.path().filename().string().c_str());
            continue;
        }
        const auto truth = readTruth (csv);
        const std::string stem = entry.path().stem().string();
        const std::string cond = stem.substr (stem.find ("__") + 2);

        sprout::PitchTracker tr;      // detected pitch
        sprout::PitchTracker vibRef;  // same vibrato estimator, fed the true pitch
        tr.prepare (sr);
        const int W = tr.window();
        windowMs = 1000.0 * W / sr;
        const double hop = sr / rate;
        Score s;
        for (double end = W; end <= x.size(); end += hop)
        {
            const size_t e = (size_t) end;
            tr.update (x.data() + e - W, (float) (1.0 / rate), gate);
            const double tc = (e - W / 2.0) / sr;
            const double hz = truthAt (truth, tc);

            if (hz > 0)
            {
                ++s.sung;
                ++s.qualityFrames;
                s.breathSum += tr.quality.breath;
                s.effortSum += tr.quality.effort;
                const bool high = hz >= 1046.5;
                s.sungHigh += high;
                if (tr.rawHz > 0 && std::abs (1200 * std::log2 (tr.rawHz / hz)) < 50) ++s.raw;
                if (tr.voiced)
                {
                    ++s.reportedVoiced;
                    const double est = 440.0 * std::pow (2.0, (tr.midi - 69.0) / 12.0);
                    const double c = 1200 * std::log2 (est / hz);
                    const double octs = std::round (c / 1200);
                    if (octs != 0 && std::abs (c - 1200 * octs) < 100) ++s.octave;
                    if (std::abs (c) < 50)
                    {
                        ++s.usable;
                        s.usableHigh += high;
                        s.errCents.push_back (std::abs (c));
                    }
                }
            }
            else
            {
                ++s.silent;
                s.falseVoiced += tr.voiced;
            }

            // Vibrato agreement: run the estimator on the true pitch track at the same times.
            vibRef.updateFromMidiForTest (hz > 0 ? (float) (69.0 + 12.0 * std::log2 (hz / 440.0)) : 0.0f, (float) (1.0 / rate));
            const bool refVib = vibRef.vibratoDepth > 0.25f;
            const bool gotVib = tr.vibratoDepth > 0.25f;
            if (refVib)
            {
                ++s.vibTruth;
                if (gotVib)
                {
                    ++s.vibFound;
                    s.rateErr.push_back (std::abs (tr.vibratoRate - vibRef.vibratoRate));
                }
            }
            else
            {
                ++s.vibNone;
                s.vibFalse += gotVib;
            }
        }
        byCondition[cond].add (s);
        total.add (s);
        ++clips;
    }

    std::printf ("Sprout PitchTracker on %s: %d clips, %.0f Hz updates, window %.1f ms, gate %.0f dB\n\n",
                 data.string().c_str(), clips, rate, windowMs, gate);
    std::printf ("| Condition | Usable | Usable above C6 | Raw pitch | Octave err | False voicing | Median err (cents) | Vibrato found | Vibrato false | Rate err (Hz) | Mean breath | Mean effort |\n");
    std::printf ("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n");
    auto row = [] (const std::string& name, const Score& s) {
        std::printf ("| %s | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %.0f | %.1f%% | %.1f%% | %.2f | %.2f | %.2f |\n", name.c_str(),
                     pct (s.usable, s.sung), pct (s.usableHigh, s.sungHigh), pct (s.raw, s.sung),
                     pct (s.octave, s.reportedVoiced), pct (s.falseVoiced, s.silent), median (s.errCents),
                     pct (s.vibFound, s.vibTruth), pct (s.vibFalse, s.vibNone), median (s.rateErr),
                     s.qualityFrames ? s.breathSum / s.qualityFrames : 0.0, s.qualityFrames ? s.effortSum / s.qualityFrames : 0.0);
    };
    for (const auto& [cond, s] : byCondition)
        row (cond, s);
    row ("**all**", total);

    // Effort self-test: a sung A4 alternating every 2 s between soft (steep spectral tilt) and
    // pressed (flat tilt) phonation at the SAME loudness. A gain-only measure can't tell them apart.
    {
        const float sr = 48000.0f;
        sprout::PitchTracker tr;
        tr.prepare (sr);
        const int W = tr.window();
        std::vector<float> x ((size_t) (sr * 16), 0.0f);
        double phase = 0.0;
        for (size_t i = 0; i < x.size(); ++i)
        {
            const double t = i / sr;
            const bool pressed = ((int) (t / 2.0)) % 2 == 1;
            const double tilt = pressed ? -3.0 : -15.0; // dB per octave
            phase += 2 * 3.14159265358979 * 220.0 * (1 + 0.004 * std::sin (2 * 3.14159 * 5.5 * t)) / sr;
            double v = 0, norm = 0;
            for (int k = 1; k * 220 < 8000; ++k)
            {
                const double a = std::pow (10.0, tilt * std::log2 ((double) k) / 20.0);
                v += a * std::sin (k * phase);
                norm += a * a;
            }
            x[i] = (float) (0.1 * v / std::sqrt (norm / 2)); // same RMS in both states
        }
        double soft = 0, hard = 0;
        int ns = 0, nh = 0;
        for (size_t end = W; end <= x.size(); end += 800)
        {
            tr.update (x.data() + end - W, 800 / sr, -60.0f);
            const double t = end / sr;
            if (t < 4.0 || std::fmod (t, 2.0) < 0.5)
                continue; // skip warm-up and transitions
            if (((int) (t / 2.0)) % 2 == 1) { hard += tr.quality.effort; ++nh; }
            else { soft += tr.quality.effort; ++ns; }
        }
        std::printf ("\nEffort self-test (same loudness): soft phonation %.2f, pressed phonation %.2f\n",
                     ns ? soft / ns : 0.0, nh ? hard / nh : 0.0);
    }
    return 0;
}
