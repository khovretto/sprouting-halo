#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "SproutBus.h"
#include "ReaperHost.h"

// Sprout Tap: put it FIRST on a take track (before reverb / pitch correction).
// It passes audio through untouched and streams the dry mono signal + basic
// features to the Sprout app over shared memory.
class SproutTapProcessor final : public juce::AudioProcessor,
                                 private juce::Timer
{
public:
    SproutTapProcessor();
    ~SproutTapProcessor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Sprout Tap"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    void updateTrackProperties (const TrackProperties& properties) override;
    juce::VST3ClientExtensions* getVST3ClientExtensions() override { return &reaperHost; }

    // Role choice index of "Auto": follow the track's record arm (REAPER).
    static constexpr int kAutoRole = 3;
    // The role actually published (0 live, 1 take, 2 instrument) and, for Auto, why.
    uint32_t getEffectiveRole() const;
    int getAutoArmState() const { return autoArm.load(); } // 1 armed, 0 not, -1 unknown

    // For the editor.
    bool isConnected() const { return writer.isClaimed(); }
    juce::String getTrackName() const;

    juce::AudioProcessorValueTreeState params;

private:
    void timerCallback() override;
    void tryClaimSlot();

    sprout::BusMapping mapping;
    sprout::SlotWriter writer;
    uint32_t token = 0;

    // Set by the message thread once a slot is claimed; the audio thread only writes while true.
    std::atomic<bool> connected { false };
    std::atomic<bool> lost { false };

    juce::AudioBuffer<float> monoBuffer;
    char cachedName[sprout::kNameLength] {};
    uint32_t cachedColour = 0;

    // Track properties arrive on the message thread; the audio thread is the only bus writer.
    mutable juce::SpinLock trackLock;
    juce::String trackName;
    uint32_t trackColour = 0;

    std::atomic<juce::AudioParameterChoice*> roleParam { nullptr };
    std::atomic<float>* themeParam = nullptr;   // per-track look, read on the audio thread
    std::atomic<float>* densityParam = nullptr;
    std::atomic<float>* colourParam = nullptr;

    ReaperHost reaperHost;
    std::atomic<int> autoArm { -1 }; // polled on the message thread

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SproutTapProcessor)
};
