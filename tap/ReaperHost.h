// SPDX-License-Identifier: AGPL-3.0-only
// Sprout Tap plugin (JUCE). Licensed under the GNU AGPL v3: see tap/LICENSE.

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

// Access to REAPER's extension API when the tap runs as a VST3 inside REAPER (5.02+).
// Used for the "Auto" role: a record-armed track is the live voice, anything else is playback.
// Other hosts never call setIHostApplication with a REAPER interface, so available() stays false.
class ReaperHost final : public juce::VST3ClientExtensions
{
public:
    ReaperHost() = default;
    ~ReaperHost() override;

    void setIHostApplication (Steinberg::FUnknown* host) override;

    bool available() const { return getTrackValue != nullptr; }

    // Record-arm state of the track this plugin sits on: 1 armed, 0 not armed, -1 unknown.
    // Call from the message thread.
    int trackRecordArmed() const;

private:
    void* reaperHost = nullptr; // reaper::IReaperHostApplication*, AddRef'd
    double (*getTrackValue) (void* track, const char* name) = nullptr;

    JUCE_DECLARE_NON_COPYABLE (ReaperHost)
};
