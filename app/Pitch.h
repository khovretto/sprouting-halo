// Pitch.h - live pitch + vibrato for one voice tap.
//
// Detector: McLeod Pitch Method (NSDF), chosen from bench/ (results/synth/summary.md): the best
// of the five candidates above C6 when streamed (91% usable to F6), no lookahead needed, plain
// DSP. Settings match bench/detectors.py MPM: ~43 ms window, 60-2100 Hz, k = 0.88, clarity 0.75.
// On top: Sprout's octave-jump guard (bench "L20+guard") and a vibrato estimator over the last
// ~0.8 s of the pitch track.
//
// Header-only so the app and tools/pitch_test share exactly the same code.
#pragma once

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <deque>
#include <vector>

namespace sprout
{
// ---------------------------------------------------------------------------------------------
// In-place iterative radix-2 FFT (size must be a power of two).
class Fft
{
public:
    void prepare (size_t n)
    {
        size = n;
        twiddle.resize (n / 2);
        for (size_t i = 0; i < n / 2; ++i)
            twiddle[i] = std::polar (1.0, -2.0 * 3.14159265358979323846 * (double) i / (double) n);
        rev.resize (n);
        int bits = 0;
        while ((size_t (1) << bits) < n)
            ++bits;
        for (size_t i = 0; i < n; ++i)
        {
            size_t r = 0;
            for (int b = 0; b < bits; ++b)
                r |= ((i >> b) & 1) << (bits - 1 - b);
            rev[i] = r;
        }
    }

    void forward (std::vector<std::complex<double>>& a) const { run (a, false); }
    void inverse (std::vector<std::complex<double>>& a) const { run (a, true); }

private:
    void run (std::vector<std::complex<double>>& a, bool inv) const
    {
        for (size_t i = 0; i < size; ++i)
            if (i < rev[i])
                std::swap (a[i], a[rev[i]]);
        for (size_t len = 2; len <= size; len <<= 1)
        {
            const size_t step = size / len;
            for (size_t i = 0; i < size; i += len)
                for (size_t j = 0; j < len / 2; ++j)
                {
                    const auto w = inv ? std::conj (twiddle[j * step]) : twiddle[j * step];
                    const auto u = a[i + j];
                    const auto v = a[i + j + len / 2] * w;
                    a[i + j] = u + v;
                    a[i + j + len / 2] = u - v;
                }
        }
        if (inv)
            for (auto& x : a)
                x /= (double) size;
    }

    size_t size = 0;
    std::vector<std::complex<double>> twiddle;
    std::vector<size_t> rev;
};

// ---------------------------------------------------------------------------------------------
struct PitchEstimate
{
    float hz = 0.0f;      // 0 when no candidate
    float clarity = 0.0f; // NSDF peak height 0..1
    float rmsDb = -120.0f;
};

class Mpm
{
public:
    float fmin = 60.0f, fmax = 2100.0f, k = 0.88f;

    void prepare (float sampleRate)
    {
        sr = sampleRate;
        W = sampleRate > 50000.0f ? 4096 : 2048; // ~43 ms at 48 kHz, as benchmarked
        fft.prepare (2 * W);
        buf.assign (2 * W, {});
        frame.assign (W, 0.0);
        nsdf.assign (W, 0.0);
    }

    int window() const { return W; }
    float sampleRate() const { return sr; }

    // `x` holds the newest `window()` samples, oldest first.
    PitchEstimate analyse (const float* x)
    {
        PitchEstimate out;
        double mean = 0.0;
        for (int i = 0; i < W; ++i)
            mean += x[i];
        mean /= W;
        double energy = 0.0;
        for (int i = 0; i < W; ++i)
        {
            frame[i] = x[i] - mean;
            energy += frame[i] * frame[i];
        }
        out.rmsDb = (float) (10.0 * std::log10 (std::max (energy / W, 1e-12)));
        if (energy < 1e-12)
            return out;

        // Autocorrelation via FFT (zero-padded to 2W).
        for (int i = 0; i < 2 * W; ++i)
            buf[i] = { i < W ? frame[i] : 0.0, 0.0 };
        fft.forward (buf);
        for (auto& c : buf)
            c = { std::norm (c), 0.0 };
        fft.inverse (buf);

        // NSDF: 2 r(tau) / m(tau), m(tau) = sum_{0..W-1-tau} x^2 + sum_{tau..W-1} x^2.
        const int tauMin = std::max (2, (int) (sr / fmax));
        const int tauMax = std::min ((int) (sr / fmin), W - 2);
        double head = energy, tail = energy; // head: sum x_0..x_{W-1-tau}; tail: sum x_tau..x_{W-1}
        for (int tau = 0; tau <= tauMax + 1; ++tau)
        {
            if (tau > 0)
            {
                head -= frame[W - tau] * frame[W - tau];
                tail -= frame[tau - 1] * frame[tau - 1];
            }
            const double m = head + tail;
            nsdf[tau] = m > 1e-12 ? 2.0 * buf[tau].real() / m : 0.0;
        }

        // Key maxima: the top of each positive lobe after the first negative-going zero crossing.
        const int last = tauMax + 1;
        int start = -1;
        for (int i = 0; i < last; ++i)
            if (nsdf[i] > 0 && nsdf[i + 1] <= 0)
            {
                start = i + 1;
                break;
            }
        if (start < 0)
            return out;

        peaks.clear();
        double best = 0.0;
        for (int a = start + 1; a <= last; ++a)
        {
            if (! (nsdf[a - 1] <= 0 && nsdf[a] > 0))
                continue;
            int b = a + 1;
            while (b <= last && ! (nsdf[b - 1] > 0 && nsdf[b] <= 0))
                ++b;
            b = std::min (b, last);
            if (b - a < 1)
                continue;
            int j = a;
            for (int i = a; i < b; ++i)
                if (nsdf[i] > nsdf[j])
                    j = i;
            if (j >= tauMin && j <= tauMax)
            {
                peaks.push_back (j);
                best = std::max (best, nsdf[j]);
            }
            a = b;
        }
        if (peaks.empty())
            return out;

        int j = peaks.front();
        for (int p : peaks)
            if (nsdf[p] >= k * best)
            {
                j = p;
                break;
            }
        const double y0 = nsdf[j - 1], y1 = nsdf[j], y2 = nsdf[j + 1];
        const double den = y0 - 2 * y1 + y2;
        const double delta = std::abs (den) > 1e-12 ? 0.5 * (y0 - y2) / den : 0.0;
        out.clarity = (float) (y1 - 0.25 * (y0 - y2) * delta);
        out.hz = (float) (sr / (j + delta));
        return out;
    }

private:
    float sr = 0.0f; // 0 until prepare()
    int W = 2048;
    Fft fft;
    std::vector<std::complex<double>> buf;
    std::vector<double> frame, nsdf;
    std::vector<int> peaks;
};

// ---------------------------------------------------------------------------------------------
// Vocal effort and breathiness, independent of mic gain.
//
// - Harmonic richness: energy of harmonics 2..N (up to 5 kHz) relative to the fundamental, in dB.
//   Soft / breathy phonation is dominated by the fundamental (steep spectral tilt, high H1-H2);
//   loud / pressed singing pushes energy into the upper harmonics. This is the main effort cue
//   and doesn't change when the singer moves off the mic.
// - Loudness relative to this singer's recent level adds the rest.
// - Both are normalised against a running mean/deviation for this tap, so effort is "relative
//   to how this person has been singing" (bass to coloratura, quiet or loud setups).
// - Breathiness: noise between the harmonics (harmonic share of band energy) plus NSDF clarity.
//   Unvoiced sound above the gate (whisper, breath) counts as fully breathy.
class VoiceQuality
{
public:
    float effort = 0.5f;      // 0 soft .. 1 full / pressed, relative to recent singing
    float breath = 0.0f;      // 0 clear .. 1 breathy
    float richnessDb = 0.0f;  // raw harmonic richness (for testing)

    void prepare (float sampleRate, int windowSize)
    {
        sr = sampleRate;
        N = windowSize;
        fft.prepare ((size_t) N);
        buf.assign ((size_t) N, {});
        power.assign ((size_t) N / 2 + 1, 0.0);
        hann.resize ((size_t) N);
        for (int i = 0; i < N; ++i)
            hann[(size_t) i] = 0.5 - 0.5 * std::cos (2.0 * 3.14159265358979323846 * i / (N - 1));
        reset();
    }

    void reset()
    {
        effort = 0.5f;
        breath = 0.0f;
        richMean = 0.0f; richDev = 4.0f;
        loudMean = -30.0f; loudDev = 6.0f;
        voicedFrames = 0;
    }

    void update (const float* x, float hz, float clarity, float rmsDb, bool voiced, float gateDb, float dt)
    {
        float effortTarget = effort, breathTarget = 0.0f, tau = 0.15f;
        if (voiced && hz > 0.0f && N > 0)
        {
            for (int i = 0; i < N; ++i)
                buf[(size_t) i] = { x[i] * hann[(size_t) i], 0.0 };
            fft.forward (buf);
            for (size_t i = 0; i < power.size(); ++i)
                power[i] = std::norm (buf[i]);

            const double binHz = sr / N;
            auto harmonic = [&] (int k) {
                const long c = std::lround (k * hz / binHz);
                double best = 0.0;
                for (long b = std::max (1L, c - 1); b <= std::min ((long) power.size() - 1, c + 1); ++b)
                    best = std::max (best, power[(size_t) b]);
                double sum = 0.0; // the window's main lobe: peak and neighbours
                for (long b = std::max (1L, c - 1); b <= std::min ((long) power.size() - 1, c + 1); ++b)
                    sum += power[(size_t) b];
                return std::pair<double, double> (best, sum);
            };
            const double h1 = harmonic (1).first;
            double upper = 0.0, harmonicEnergy = harmonic (1).second;
            int count = 0;
            for (int k = 2; k <= 30 && k * hz < 5000.0f; ++k, ++count)
            {
                const auto [peak, lobe] = harmonic (k);
                upper += peak;
                harmonicEnergy += lobe;
            }
            double band = 0.0;
            const size_t hi = std::min (power.size() - 1, (size_t) (5000.0 / binHz));
            for (size_t b = (size_t) std::max (1.0, 70.0 / binHz); b <= hi; ++b)
                band += power[b];

            ++voicedFrames;
            const float learn = 1.0f - std::exp (-dt / (voicedFrames < 120 ? 1.5f : 15.0f));
            if (count > 0 && h1 > 1e-12)
            {
                richnessDb = (float) (10.0 * std::log10 (std::max (upper, 1e-12) / h1));
                richMean += (richnessDb - richMean) * learn;
                richDev += (std::abs (richnessDb - richMean) - richDev) * learn;
            }
            loudMean += (rmsDb - loudMean) * learn;
            loudDev += (std::abs (rmsDb - loudMean) - loudDev) * learn;

            const float zRich = count > 0 ? (richnessDb - richMean) / std::max (richDev, 2.0f) : 0.0f;
            const float zLoud = (rmsDb - loudMean) / std::max (loudDev, 3.0f);
            effortTarget = 0.5f + 0.5f * std::tanh (0.8f * (0.6f * zRich + 0.4f * zLoud));

            const float harmonicShare = band > 0.0 ? (float) std::min (1.0, harmonicEnergy / band) : 1.0f;
            const float noise = std::clamp ((0.92f - harmonicShare) / 0.6f, 0.0f, 1.0f);
            const float unclear = std::clamp ((0.95f - clarity) / 0.4f, 0.0f, 1.0f);
            breathTarget = 0.5f * noise + 0.5f * unclear;
        }
        else if (rmsDb > gateDb)
        {
            breathTarget = 1.0f; // sound without pitch: breath, whisper, consonants
            effortTarget = 0.25f;
        }
        else
        {
            effortTarget = 0.5f; // silence: drift back to neutral
            tau = 1.0f;
        }
        const float a = 1.0f - std::exp (-dt / tau);
        effort += (effortTarget - effort) * a;
        breath += (breathTarget - breath) * a;
    }

private:
    float sr = 0.0f;
    int N = 0;
    Fft fft;
    std::vector<std::complex<double>> buf;
    std::vector<double> power, hann;
    float richMean = 0.0f, richDev = 4.0f, loudMean = -30.0f, loudDev = 6.0f;
    long voicedFrames = 0;
};

// ---------------------------------------------------------------------------------------------
// Per-tap tracker: MPM + voicing gate + octave guard + vibrato + effort / breathiness.
class PitchTracker
{
public:
    float clarityThreshold = 0.75f;
    float sustainClarity = 0.5f;
    float guardPersist = 0.06f; // a near-octave jump must last this long to be accepted (s)
    float guardReset = 0.30f;   // silence that forgets the held pitch (s)

    // Outputs (valid after update()).
    float midi = 0.0f;         // guarded pitch as MIDI note number, 0 when unvoiced
    float rawHz = 0.0f;        // detector output before voicing/guard (for testing)
    bool voiced = false;
    float vibratoDepth = 0.0f; // 0..1 (≈ 0.1 to 0.6 semitone amplitude)
    float vibratoRate = 0.0f;  // Hz, 0 when none

    VoiceQuality quality; // effort / breathiness, updated with the pitch

    void prepare (float sampleRate)
    {
        mpm.prepare (sampleRate);
        quality.prepare (sampleRate, mpm.window());
        reset();
    }

    void reset()
    {
        quality.reset();
        midi = rawHz = vibratoDepth = vibratoRate = 0.0f;
        voiced = false;
        lastHz = 0.0f;
        pendingTime = silentTime = 0.0f;
        clock = 0.0;
        history.clear();
    }

    int window() const { return mpm.window(); }
    float sampleRate() const { return mpm.sampleRate(); }

    // `x`: newest window() samples. `dt`: seconds since the previous call. `gateDb`: frames
    // quieter than this are unvoiced (the app passes its sensitivity floor).
    void update (const float* x, float dt, float gateDb)
    {
        clock += dt;
        const PitchEstimate e = mpm.analyse (x);
        rawHz = e.hz;
        // Voicing hysteresis: a note starts at clarityThreshold, but once voiced it continues down
        // to sustainClarity while the pitch stays within ~1.5 semitones (breathy / soft tails).
        bool v = e.hz > 0.0f && e.rmsDb > gateDb && e.clarity >= clarityThreshold;
        if (! v && voiced && e.hz > 0.0f && e.rmsDb > gateDb && e.clarity >= sustainClarity && lastHz > 0.0f)
            v = std::abs (1200.0f * std::log2 (e.hz / lastHz)) < 150.0f;

        if (! v)
        {
            silentTime += dt;
            if (silentTime >= guardReset)
            {
                lastHz = 0.0f;
                pendingTime = 0.0f;
            }
            voiced = false;
            midi = 0.0f;
        }
        else
        {
            silentTime = 0.0f;
            bool hold = false;
            if (lastHz > 0.0f)
            {
                const float cents = 1200.0f * std::log2 (e.hz / lastHz);
                const float octs = std::round (cents / 1200.0f);
                if (octs != 0.0f && std::abs (cents - 1200.0f * octs) < 250.0f)
                {
                    pendingTime += dt;
                    hold = pendingTime < guardPersist; // keep the previous pitch until the jump persists
                }
            }
            if (! hold)
            {
                pendingTime = 0.0f;
                lastHz = e.hz;
            }
            voiced = true;
            midi = 69.0f + 12.0f * std::log2 (lastHz / 440.0f);
        }
        updateVibrato();
        quality.update (x, voiced ? lastHz : 0.0f, e.clarity, e.rmsDb, voiced, gateDb, dt);
    }

    // Feed a known pitch track instead of audio (tools/pitch_test uses this as the vibrato reference).
    void updateFromMidiForTest (float knownMidi, float dt)
    {
        clock += dt;
        voiced = knownMidi > 0.0f;
        midi = knownMidi;
        updateVibrato();
    }

private:
    // Vibrato from the last ~0.6 s of one note: remove the linear trend (held note or slow slide),
    // then rate from zero crossings and amplitude from RMS. Needs continuous voicing.
    void updateVibrato()
    {
        constexpr double span = 0.6; // ~3 cycles at 5 Hz
        // Analyse within one note: a jump bigger than vibrato can move in this step starts over.
        if (voiced && ! history.empty())
        {
            const double dt = clock - history.back().t;
            if (std::abs (midi - history.back().m) > 0.8 + 70.0 * dt)
                history.clear();
        }
        if (voiced)
            history.push_back ({ clock, midi });
        else
            history.clear();
        while (! history.empty() && clock - history.front().t > span)
            history.pop_front();

        float targetDepth = 0.0f, rate = 0.0f;
        const size_t n = history.size();
        if (n >= 12 && clock - history.front().t > span * 0.75)
        {
            double st = 0, sm = 0, stt = 0, stm = 0;
            for (const auto& h : history)
            {
                st += h.t; sm += h.m; stt += h.t * h.t; stm += h.t * h.m;
            }
            const double den = n * stt - st * st;
            const double slope = std::abs (den) > 1e-12 ? (n * stm - st * sm) / den : 0.0;
            const double icpt = (sm - slope * st) / n;
            double ss = 0;
            int crossings = 0;
            double prev = 0;
            for (size_t i = 0; i < n; ++i)
            {
                const double r = history[i].m - (icpt + slope * history[i].t);
                ss += r * r;
                if (i > 0 && ((prev < 0) != (r < 0)))
                    ++crossings;
                prev = r;
            }
            const double dur = history.back().t - history.front().t;
            const double amp = std::sqrt (2.0 * ss / n); // sine amplitude, semitones
            rate = (float) (crossings / (2.0 * dur));
            if (rate >= 3.5f && rate <= 9.0f && amp >= 0.08)
                targetDepth = (float) std::clamp ((amp - 0.08) / 0.5, 0.0, 1.0);
            else
                rate = 0.0f;
        }
        // Smooth so the visual doesn't flicker as notes come and go.
        vibratoDepth += (targetDepth - vibratoDepth) * 0.15f;
        if (rate > 0.0f)
            vibratoRate = vibratoRate > 0.0f ? vibratoRate + (rate - vibratoRate) * 0.2f : rate;
        else if (vibratoDepth < 0.02f)
            vibratoRate = 0.0f;
    }

    struct Sample
    {
        double t;
        float m;
    };

    Mpm mpm;
    float lastHz = 0.0f, pendingTime = 0.0f, silentTime = 0.0f;
    double clock = 0.0;
    std::deque<Sample> history;
};
} // namespace sprout
