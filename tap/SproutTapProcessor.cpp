#include "SproutTapProcessor.h"

#include <random>

namespace
{
// Same order as sprout::ThemeChoice.
juce::StringArray themeNames()
{
    return { "Leaves", "Thorns", "Christmas wreath", "Branches only", "Viewer default" };
}

juce::AudioProcessorValueTreeState::ParameterLayout createLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { "role", 1 }, "Role",
        juce::StringArray { "Live voice", "Take playback", "Instrument", "Auto (follows record arm)" },
        SproutTapProcessor::kAutoRole));
    // Per-track look of this take's halo / plant in the viewer.
    layout.add (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { "theme", 1 }, "Theme", themeNames(), 0));
    layout.add (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "density", 1 }, "Leaf / thorn amount", juce::NormalisableRange<float> (0.0f, 1.0f), 0.55f));
    layout.add (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { "colour", 1 }, "Colour", juce::StringArray { "Track colour", "Viewer palette" }, 0));
    return layout;
}

uint32_t makeToken()
{
    std::random_device rd;
    uint32_t t = 0;
    while (t == 0)
        t = rd();
    return t;
}

// ---------------------------------------------------------------------------------------------
class SproutTapEditor final : public juce::AudioProcessorEditor,
                              private juce::Timer
{
public:
    explicit SproutTapEditor (SproutTapProcessor& p)
        : AudioProcessorEditor (p), proc (p)
    {
        title.setText ("Sprout Tap", juce::dontSendNotification);
        title.setFont (juce::FontOptions (20.0f, juce::Font::bold));
        addAndMakeVisible (title);

        roleLabel.setText ("Role", juce::dontSendNotification);
        addAndMakeVisible (roleLabel);

        roleBox.addItemList (juce::StringArray { "Live voice", "Take playback", "Instrument", "Auto (follows record arm)" }, 1);
        // Items must exist before the attachment syncs the selection.
        roleAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (
            p.params, "role", roleBox);
        addAndMakeVisible (roleBox);

        auto addRow = [this] (juce::Label& label, const char* text, juce::Component& control) {
            label.setText (text, juce::dontSendNotification);
            addAndMakeVisible (label);
            addAndMakeVisible (control);
        };
        themeBox.addItemList (themeNames(), 1);
        themeAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (p.params, "theme", themeBox);
        addRow (themeLabel, "Theme", themeBox);
        densitySlider.setSliderStyle (juce::Slider::LinearHorizontal);
        densitySlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 50, 20);
        densityAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (p.params, "density", densitySlider);
        addRow (densityLabel, "Amount", densitySlider);
        customBox.setTextWhenNothingSelected ("None");
        customBox.setTooltip ("A theme made on Sprout's /themes page. When set, it is used instead of Theme.");
        customBox.onChange = [this] {
            const int i = customBox.getSelectedItemIndex();
            if (! filling && i >= 0 && i < customIds.size())
                proc.setCustomTheme (customIds[i]);
        };
        addRow (customLabel, "Custom", customBox);
        colourBox.addItemList (juce::StringArray { "Track colour", "Viewer palette" }, 1);
        colourAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (p.params, "colour", colourBox);
        addRow (colourLabel, "Colour", colourBox);

        hint.setText ("Put this first on the track, before any effects.", juce::dontSendNotification);
        hint.setColour (juce::Label::textColourId, juce::Colours::grey);
        addAndMakeVisible (hint);

        addAndMakeVisible (status);

        setSize (380, 302);
        startTimerHz (4);
        timerCallback();
    }

    void paint (juce::Graphics& g) override { g.fillAll (juce::Colour (0xff1d1f24)); }

    void resized() override
    {
        auto r = getLocalBounds().reduced (14);
        title.setBounds (r.removeFromTop (28));
        r.removeFromTop (8);
        auto row = [&r] (juce::Label& label, juce::Component& control) {
            auto line = r.removeFromTop (26);
            label.setBounds (line.removeFromLeft (70));
            control.setBounds (line);
            r.removeFromTop (6);
        };
        row (roleLabel, roleBox);
        row (themeLabel, themeBox);
        row (customLabel, customBox);
        row (densityLabel, densitySlider);
        row (colourLabel, colourBox);
        r.removeFromTop (4);
        status.setBounds (r.removeFromTop (22));
        hint.setBounds (r.removeFromTop (22));
    }

private:
    // The custom theme box: "None", then Sprout.exe's user themes (and the saved one if missing).
    void refreshCustom()
    {
        juce::StringArray ids, names;
        const bool listChanged = proc.getThemeList (ids, names, themeSeq);
        const juce::String current = proc.getCustomTheme();
        if (! listChanged && current == shownCustom && customIds.size() > 0)
            return;
        if (listChanged)
        {
            listIds = ids;
            listNames = names;
        }
        juce::StringArray allIds { "" }, allNames { "None" };
        allIds.addArray (listIds);
        allNames.addArray (listNames);
        if (current.isNotEmpty() && ! allIds.contains (current))
        {
            allIds.add (current);
            allNames.add (current + (themeSeq == 0 ? "" : " (not in Sprout)"));
        }
        filling = true;
        customBox.clear (juce::dontSendNotification);
        customBox.addItemList (allNames, 1);
        customBox.setSelectedItemIndex (juce::jmax (0, allIds.indexOf (current)), juce::dontSendNotification);
        filling = false;
        customIds = allIds;
        shownCustom = current;
        // The built-in Theme is unused while a custom theme is set.
        themeBox.setAlpha (current.isEmpty() ? 1.0f : 0.45f);
    }

    void timerCallback() override
    {
        refreshCustom();
        const auto name = proc.getTrackName();
        juce::String text = proc.isConnected() ? "Connected" : "Not connected (no free slot)";
        if (name.isNotEmpty())
            text << "  |  Track: " << name;
        status.setText (text, juce::dontSendNotification);
        status.setColour (juce::Label::textColourId,
                          proc.isConnected() ? juce::Colour (0xff7fd88f) : juce::Colour (0xffe07a6a));

        juce::String autoText;
        if (auto* role = dynamic_cast<juce::AudioParameterChoice*> (proc.params.getParameter ("role"));
            role != nullptr && role->getIndex() == SproutTapProcessor::kAutoRole)
        {
            const int arm = proc.getAutoArmState();
            autoText = arm < 0 ? "Auto: this host doesn't report record arm, so this is the live voice. Pick a role."
                     : arm > 0 ? "Auto: record-armed, so this is the live voice."
                               : "Auto: not armed, so this is a take playing back.";
        }
        hint.setText (autoText.isNotEmpty() ? autoText : "Put this first on the track, before any effects.",
                      juce::dontSendNotification);
    }

    SproutTapProcessor& proc;
    juce::Label title, roleLabel, themeLabel, customLabel, densityLabel, colourLabel, status, hint;
    juce::ComboBox roleBox, themeBox, customBox, colourBox;
    juce::StringArray customIds, listIds, listNames;
    juce::String shownCustom;
    uint32_t themeSeq = 0xffffffffu; // forces the first read
    bool filling = false;
    juce::Slider densitySlider;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> roleAttachment, themeAttachment, colourAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> densityAttachment;
};
} // namespace

// ---------------------------------------------------------------------------------------------
SproutTapProcessor::SproutTapProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      params (*this, nullptr, "SproutTap", createLayout())
{
    roleParam = dynamic_cast<juce::AudioParameterChoice*> (params.getParameter ("role"));
    themeParam = params.getRawParameterValue ("theme");
    densityParam = params.getRawParameterValue ("density");
    colourParam = params.getRawParameterValue ("colour");
    token = makeToken();
    tryClaimSlot();
    startTimer (100);
}

SproutTapProcessor::~SproutTapProcessor()
{
    stopTimer();
    connected.store (false);
    writer.release();
    mapping.close();
}

void SproutTapProcessor::tryClaimSlot()
{
    if (connected.load (std::memory_order_acquire) || lost.load())
        return;
    if (! mapping.open())
        return;
    if (writer.claim (*mapping.get(), token))
        connected.store (true, std::memory_order_release);
}

void SproutTapProcessor::timerCallback()
{
    autoArm.store (reaperHost.trackRecordArmed());

    if (! connected.load (std::memory_order_acquire))
    {
        tryClaimSlot();
        return;
    }
    // Keeps the slot alive while the host isn't calling processBlock (e.g. transport stopped).
    writer.heartbeat();

    // A viewer picked a preset: take its theme and amount, as if set in this window (the host is
    // notified, so the change is saved with the project and can be undone).
    uint32_t theme = 0;
    float density = 0.55f;
    char custom[sprout::kThemeIdLength] {};
    if (writer.pollLookRequest (theme, density, custom))
    {
        // A user theme, or a built-in one (which clears the custom theme).
        setCustomTheme (juce::String::fromUTF8 (custom));
        auto set = [] (juce::RangedAudioParameter* p, float value) {
            if (p == nullptr)
                return;
            p->beginChangeGesture();
            p->setValueNotifyingHost (p->convertTo0to1 (value));
            p->endChangeGesture();
        };
        if (custom[0] == 0 && theme <= (uint32_t) sprout::ThemeChoice::Branches)
            set (params.getParameter ("theme"), (float) theme);
        set (params.getParameter ("density"), juce::jlimit (0.0f, 1.0f, density));
    }
}

uint32_t SproutTapProcessor::getEffectiveRole() const
{
    auto* role = roleParam.load();
    const int index = role != nullptr ? role->getIndex() : kAutoRole;
    if (index != kAutoRole)
        return (uint32_t) index;
    return autoArm.load() == 0 ? (uint32_t) sprout::Role::TakePlayback : (uint32_t) sprout::Role::LiveVoice;
}

bool SproutTapProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto in  = layouts.getMainInputChannelSet();
    const auto out = layouts.getMainOutputChannelSet();
    if (in != out)
        return false;
    return in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo();
}

void SproutTapProcessor::prepareToPlay (double, int samplesPerBlock)
{
    monoBuffer.setSize (1, juce::jmax (1, samplesPerBlock), false, true, true);
}

void SproutTapProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples  = buffer.getNumSamples();
    const int numChannels = juce::jmin (getTotalNumInputChannels(), buffer.getNumChannels());
    if (numSamples <= 0 || ! connected.load (std::memory_order_acquire))
        return;

    if (! writer.stillOwner())
    {
        // Our slot was taken over after a long stall. Stop writing; don't fight for it.
        connected.store (false, std::memory_order_release);
        lost.store (true);
        return;
    }

    if (monoBuffer.getNumSamples() < numSamples)
        return; // host broke its block-size promise; skip rather than allocate here

    // Dry mono mix.
    float* mono = monoBuffer.getWritePointer (0);
    if (numChannels <= 0)
    {
        juce::FloatVectorOperations::clear (mono, numSamples);
    }
    else
    {
        juce::FloatVectorOperations::copy (mono, buffer.getReadPointer (0), numSamples);
        for (int ch = 1; ch < numChannels; ++ch)
            juce::FloatVectorOperations::add (mono, buffer.getReadPointer (ch), numSamples);
        if (numChannels > 1)
            juce::FloatVectorOperations::multiply (mono, 1.0f / (float) numChannels, numSamples);
    }

    double sumSq = 0.0;
    float peak = 0.0f;
    for (int i = 0; i < numSamples; ++i)
    {
        const float s = mono[i];
        sumSq += (double) s * s;
        peak = juce::jmax (peak, std::abs (s));
    }

    sprout::SlotInfo info;
    info.role        = getEffectiveRole();
    info.theme       = (uint32_t) themeParam->load();
    info.density     = densityParam->load();
    info.colourMode  = (uint32_t) colourParam->load();
    info.sampleRate  = (float) getSampleRate();
    info.blockRms    = (float) std::sqrt (sumSq / numSamples);
    info.blockPeak   = peak;

    if (auto* hostPlayHead = getPlayHead())
    {
        if (const auto pos = hostPlayHead->getPosition())
        {
            if (const auto bpm = pos->getBpm())
                info.bpm = (float) *bpm;
            if (const auto ppq = pos->getPpqPosition())
                info.ppqPosition = *ppq;
            info.isPlaying = pos->getIsPlaying() ? 1u : 0u;
            info.reserved[0] = pos->getIsRecording() ? 1u : 0u; // DAW is recording (kRecordingField)
        }
    }

    {
        const juce::SpinLock::ScopedTryLockType lock (trackLock);
        if (lock.isLocked())
        {
            cachedColour = trackColour;
            // copyToUTF8 never allocates and always null-terminates.
            trackName.copyToUTF8 (cachedName, sprout::kNameLength);
            std::memcpy (cachedCustom, customTheme, sprout::kThemeIdLength);
        }
    }
    std::memcpy (info.customTheme, cachedCustom, sprout::kThemeIdLength);
    info.colourArgb = cachedColour;
    std::memcpy (info.name, cachedName, sprout::kNameLength);

    writer.writeAudio (mono, (uint32_t) numSamples);
    writer.publishInfo (info);
    writer.heartbeat();
}

void SproutTapProcessor::updateTrackProperties (const TrackProperties& properties)
{
    const juce::SpinLock::ScopedLockType lock (trackLock);
    trackName   = properties.name.value_or (juce::String());
    trackColour = properties.colour.has_value() ? properties.colour->getARGB() : 0u;
}

juce::String SproutTapProcessor::getCustomTheme() const
{
    return params.state.getProperty ("customTheme").toString();
}

void SproutTapProcessor::setCustomTheme (const juce::String& id)
{
    if (id == getCustomTheme())
        return;
    params.state.setProperty ("customTheme", id, nullptr);
    cacheCustomTheme();
    updateHostDisplay (ChangeDetails().withNonParameterStateChanged (true)); // the project has changed
}

void SproutTapProcessor::cacheCustomTheme()
{
    char id[sprout::kThemeIdLength] {};
    getCustomTheme().copyToUTF8 (id, sprout::kThemeIdLength);
    const juce::SpinLock::ScopedLockType lock (trackLock);
    std::memcpy (customTheme, id, sprout::kThemeIdLength);
}

bool SproutTapProcessor::getThemeList (juce::StringArray& ids, juce::StringArray& names, uint32_t& seq)
{
    if (! mapping.open())
        return false;
    static thread_local sprout::ThemeEntry entries[sprout::kMaxThemeList];
    uint32_t count = 0, now = 0;
    if (! sprout::readThemes (*mapping.get(), entries, count, now) || now == seq)
        return false;
    seq = now;
    ids.clear();
    names.clear();
    for (uint32_t i = 0; i < count; ++i)
    {
        ids.add (juce::String::fromUTF8 (entries[i].id));
        names.add (juce::String::fromUTF8 (entries[i].name));
    }
    return true;
}

juce::String SproutTapProcessor::getTrackName() const
{
    const juce::SpinLock::ScopedLockType lock (trackLock);
    return trackName;
}

juce::AudioProcessorEditor* SproutTapProcessor::createEditor()
{
    return new SproutTapEditor (*this);
}

void SproutTapProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    if (auto xml = params.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void SproutTapProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        if (xml->hasTagName (params.state.getType()))
        {
            params.replaceState (juce::ValueTree::fromXml (*xml));
            cacheCustomTheme();
        }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SproutTapProcessor();
}
