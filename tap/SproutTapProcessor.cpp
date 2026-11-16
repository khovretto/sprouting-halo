#include "SproutTapProcessor.h"

#include <random>

namespace
{
// Same order as sprout::ThemeChoice (index 4 = ViewerDefault = Auto).
juce::StringArray themeNames()
{
    return { "Leaves", "Thorns", "Christmas wreath", "Branches only", "Auto (viewer's look)" };
}

// The viewer's built-in gradients (viewer/src/gradient.ts GRADIENT_PRESETS), for "My gradient".
const char* const kGradientNames[] = { "Rainbow", "Pastel rainbow", "Natural green", "Autumn", "Fire", "Ice", "Sakura", "Sunset", "Neon" };
const char* const kGradientStrings[] = {
    "rgb~;0:ff4d4d,0.167:ffff4d,0.333:4dff4d,0.5:4dffff,0.667:4d4dff,0.833:ff4dff",
    "rgb~;0:ffa6a6,0.167:ffffa6,0.333:a6ffa6,0.5:a6ffff,0.667:a6a6ff,0.833:ffa6ff",
    "ok;0:1f6b2e,0.5:52c757,1:b5e61d",
    "ok;0:7a1f0e,0.4:d9541e,0.7:f2a51e,1:f7dc6f",
    "ok;0:3a0a00,0.35:c21a00,0.65:ff7a00,0.9:ffd84a,1:fff6cf",
    "ok;0:0b2a6b,0.4:2f7fe0,0.75:8fe3ff,1:f2fdff",
    "ok;0:ff7ac8,0.6:ffd1e6,1:ffffff",
    "ok;0:2b1b6b,0.4:c2338f,0.7:ff7a59,1:ffd36b",
    "rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b",
};
constexpr int kGradientCount = (int) (sizeof (kGradientNames) / sizeof (kGradientNames[0]));

juce::AudioProcessorValueTreeState::ParameterLayout createLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { "role", 1 }, "Role",
        juce::StringArray { "Live voice", "Take playback", "Instrument", "Auto (follows record arm)" },
        SproutTapProcessor::kAutoRole));
    // Per-track look of this take's halo / plant in the viewer. Every one starts on Auto: the
    // viewer's look decides until this track should be different.
    layout.add (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { "theme", 1 }, "Theme", themeNames(), 4));
    layout.add (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "density", 1 }, "Leaf / thorn amount", juce::NormalisableRange<float> (0.0f, 1.0f), 0.55f));
    layout.add (std::make_unique<juce::AudioParameterBool> (
        juce::ParameterID { "densityAuto", 2 }, "Leaf amount: Auto", true));
    // Same order as sprout::ColourMode (old projects keep their meaning).
    layout.add (std::make_unique<juce::AudioParameterChoice> (
        juce::ParameterID { "colour", 1 }, "Colour",
        juce::StringArray { "Track colour", "Auto (viewer picks)", "My colour", "My gradient" }, 1));
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

// A gradient string ("ok;0:ff0000,0.5:00ff00,...", see viewer/src/gradient.ts) as a preview bar.
class GradientBar final : public juce::Component
{
public:
    void setGradient (const juce::String& g)
    {
        if (g != text)
        {
            text = g;
            repaint();
        }
    }

    void paint (juce::Graphics& g) override
    {
        auto r = getLocalBounds().toFloat();
        const auto semi = text.indexOfChar (';');
        const bool step = text.startsWith ("step");
        juce::Array<std::pair<float, juce::Colour>> stops;
        for (auto& part : juce::StringArray::fromTokens (text.substring (semi + 1), ",", ""))
        {
            const auto colon = part.indexOfChar (':');
            if (colon < 0)
                continue;
            const auto hex = part.substring (colon + 1).trim();
            const auto c = hex == "t" ? juce::Colours::grey : juce::Colour ((juce::uint32) (0xff000000u | (juce::uint32) hex.getHexValue32()));
            stops.add ({ juce::jlimit (0.0f, 1.0f, part.substring (0, colon).getFloatValue()), c });
        }
        if (stops.isEmpty())
        {
            g.setColour (juce::Colours::darkgrey);
            g.drawRect (r);
            return;
        }
        if (step)
        {
            for (int i = 0; i < stops.size(); ++i)
            {
                const float a = i == 0 ? 0.0f : stops[i].first, b = i + 1 < stops.size() ? stops[i + 1].first : 1.0f;
                g.setColour (stops[i].second);
                g.fillRect (r.getX() + a * r.getWidth(), r.getY(), (b - a) * r.getWidth() + 1.0f, r.getHeight());
            }
        }
        else
        {
            juce::ColourGradient cg (stops.getFirst().second, r.getX(), 0.0f, stops.getLast().second, r.getRight(), 0.0f, false);
            for (auto& s : stops)
                cg.addColour (s.first, s.second);
            g.setGradientFill (cg);
            g.fillRect (r);
        }
        g.setColour (juce::Colours::black.withAlpha (0.4f));
        g.drawRect (r);
    }

private:
    juce::String text;
};

// ---------------------------------------------------------------------------------------------
class SproutTapEditor final : public juce::AudioProcessorEditor,
                              private juce::Timer,
                              private juce::ChangeListener
{
public:
    explicit SproutTapEditor (SproutTapProcessor& p)
        : AudioProcessorEditor (p), proc (p)
    {
        title.setText ("Sprout Tap", juce::dontSendNotification);
        title.setFont (juce::FontOptions (20.0f, juce::Font::bold));
        addAndMakeVisible (title);

        auto addRow = [this] (juce::Label& label, const char* text, juce::Component& control) {
            label.setText (text, juce::dontSendNotification);
            addAndMakeVisible (label);
            addAndMakeVisible (control);
        };

        roleBox.addItemList (juce::StringArray { "Live voice", "Take playback", "Instrument", "Auto (follows record arm)" }, 1);
        // Items must exist before the attachment syncs the selection.
        roleAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (p.params, "role", roleBox);
        addRow (roleLabel, "Role", roleBox);
        roleBox.setTooltip ("Auto follows record arm (REAPER): armed = live voice (the halo), not armed = a recorded take (a tree).");

        // One Theme box: Auto, the built-in themes, then your own (filled by hand, not attached).
        themeBox.onChange = [this] { themePicked(); };
        themeBox.setTooltip ("This track's decorations. Auto = the theme of the look picked in the viewer. "
                             "Your own themes (made at localhost:7777/themes) are listed while Sprout.exe runs.");
        addRow (themeLabel, "Theme", themeBox);

        densityAuto.setButtonText ("Auto");
        densityAuto.setTooltip ("Auto = the leaf amount of the look picked in the viewer. Moving the slider sets this track's own amount.");
        densityAutoAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment> (p.params, "densityAuto", densityAuto);
        addAndMakeVisible (densityAuto);
        densitySlider.setSliderStyle (juce::Slider::LinearHorizontal);
        densitySlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 50, 20);
        densityAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (p.params, "density", densitySlider);
        densitySlider.onDragStart = [this] {
            if (auto* a = proc.params.getParameter ("densityAuto"); a != nullptr && a->getValue() > 0.5f)
                a->setValueNotifyingHost (0.0f);
        };
        densitySlider.setTooltip ("How many leaves, thorns or other decorations this track's tree and halo get (0 = bare branches).");
        addRow (densityLabel, "Leaves", densitySlider);

        colourBox.addItemList (juce::StringArray { "Track colour", "Auto (viewer picks)", "My colour", "My gradient" }, 1);
        colourAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment> (p.params, "colour", colourBox);
        colourBox.setTooltip ("Auto: the viewer's colours (its palette or the look's). Track colour: this DAW track's colour. "
                              "My colour / My gradient: this track's own.");
        addRow (colourLabel, "Colour", colourBox);

        // My colour: a swatch that opens a colour picker.
        swatch.setTooltip ("Pick this track's colour.");
        swatch.onClick = [this] {
            auto sel = std::make_unique<juce::ColourSelector> (juce::ColourSelector::showColourAtTop | juce::ColourSelector::showSliders
                                                               | juce::ColourSelector::showColourspace);
            sel->setSize (300, 300);
            sel->setCurrentColour (colourOf (proc.getStateString ("inkColour")), juce::dontSendNotification);
            sel->addChangeListener (this);
            juce::CallOutBox::launchAsynchronously (std::move (sel), swatch.getScreenBounds(), nullptr);
        };
        addChildComponent (swatch);

        // My gradient: a preview, the viewer's built-in gradients, and copy / paste of any gradient
        // made in the viewer (Look -> Colours -> a gradient -> Copy).
        for (int i = 0; i < kGradientCount; ++i)
            gradientBox.addItem (kGradientNames[i], i + 1);
        gradientBox.addItem ("Pasted", 100);
        gradientBox.setTextWhenNothingSelected ("Pasted");
        gradientBox.onChange = [this] {
            const int id = gradientBox.getSelectedId();
            if (! filling && id >= 1 && id <= kGradientCount)
                proc.setStateString ("inkGradient", kGradientStrings[id - 1]);
        };
        gradientBox.setTooltip ("A built-in gradient for this track's branches and halo.");
        paste.setButtonText ("Paste");
        paste.setTooltip ("Paste a gradient copied in the viewer (Look -> Colours -> a gradient -> Copy).");
        paste.onClick = [this] {
            const auto text = juce::SystemClipboard::getTextFromClipboard().trim();
            if (text.startsWith ("rgb") || text.startsWith ("ok") || text.startsWith ("step"))
                if (text.containsChar (';') && text.length() < (int) sprout::kInkLength)
                    proc.setStateString ("inkGradient", text);
        };
        copy.setButtonText ("Copy");
        copy.setTooltip ("Copy this gradient, to paste it in the viewer or another track.");
        copy.onClick = [this] { juce::SystemClipboard::copyTextToClipboard (proc.getStateString ("inkGradient")); };
        for (juce::Component* c : { (juce::Component*) &gradientBar, (juce::Component*) &gradientBox, (juce::Component*) &paste, (juce::Component*) &copy })
            addChildComponent (c);

        resetAll.setButtonText ("All Auto");
        resetAll.setTooltip ("Theme, leaves and colour back to Auto: this track follows the viewer's look.");
        resetAll.onClick = [this] {
            proc.resetToAuto();
            refreshThemes (true);
        };
        addAndMakeVisible (resetAll);

        hint.setColour (juce::Label::textColourId, juce::Colours::grey);
        addAndMakeVisible (hint);
        addAndMakeVisible (status);

        setSize (400, 330);
        startTimerHz (4);
        timerCallback();
    }

    ~SproutTapEditor() override { stopTimer(); }

    void paint (juce::Graphics& g) override { g.fillAll (juce::Colour (0xff1d1f24)); }

    void resized() override
    {
        auto r = getLocalBounds().reduced (14);
        auto top = r.removeFromTop (28);
        resetAll.setBounds (top.removeFromRight (80).reduced (0, 3));
        title.setBounds (top);
        r.removeFromTop (8);
        auto row = [&r] (juce::Label& label) {
            auto line = r.removeFromTop (26);
            label.setBounds (line.removeFromLeft (70));
            r.removeFromTop (6);
            return line;
        };
        roleBox.setBounds (row (roleLabel));
        themeBox.setBounds (row (themeLabel));
        auto d = row (densityLabel);
        densityAuto.setBounds (d.removeFromLeft (64));
        densitySlider.setBounds (d);
        colourBox.setBounds (row (colourLabel));
        // The extra row for My colour / My gradient.
        auto extra = r.removeFromTop (26).withTrimmedLeft (70);
        r.removeFromTop (6);
        swatch.setBounds (extra.removeFromLeft (120));
        auto e2 = extra;
        e2 = getLocalBounds().reduced (14).withY (extra.getY()).withHeight (26).withTrimmedLeft (70);
        copy.setBounds (e2.removeFromRight (48));
        e2.removeFromRight (4);
        paste.setBounds (e2.removeFromRight (52));
        e2.removeFromRight (4);
        gradientBox.setBounds (e2.removeFromRight (110));
        e2.removeFromRight (6);
        gradientBar.setBounds (e2.reduced (0, 4));
        r.removeFromTop (4);
        status.setBounds (r.removeFromTop (22));
        hint.setBounds (r.removeFromTop (40));
    }

private:
    static juce::Colour colourOf (const juce::String& hex)
    {
        return hex.startsWith ("#") ? juce::Colour ((juce::uint32) (0xff000000u | (juce::uint32) hex.substring (1).getHexValue32()))
                                    : juce::Colour (0xff52c757);
    }

    void changeListenerCallback (juce::ChangeBroadcaster* source) override
    {
        if (auto* sel = dynamic_cast<juce::ColourSelector*> (source))
            proc.setStateString ("inkColour", "#" + sel->getCurrentColour().toDisplayString (false).toLowerCase());
    }

    // ---- Theme box -------------------------------------------------------------------------------
    // Item ids: 1 Auto, 2..5 Leaves..Branches only, 100 + i your theme i.
    void themePicked()
    {
        if (filling)
            return;
        const int id = themeBox.getSelectedId();
        auto* theme = proc.params.getParameter ("theme");
        auto setTheme = [theme] (int index) {
            if (theme == nullptr)
                return;
            theme->beginChangeGesture();
            theme->setValueNotifyingHost (theme->convertTo0to1 ((float) index));
            theme->endChangeGesture();
        };
        if (id == 1)
        {
            setTheme ((int) sprout::ThemeChoice::ViewerDefault);
            proc.setCustomTheme ({});
        }
        else if (id >= 2 && id <= 5)
        {
            setTheme (id - 2);
            proc.setCustomTheme ({});
        }
        else if (id >= 100 && id - 100 < customIds.size())
            proc.setCustomTheme (customIds[id - 100]);
        refreshThemes (true);
    }

    void refreshThemes (bool force)
    {
        juce::StringArray ids, names;
        const bool listChanged = proc.getThemeList (ids, names, themeSeq);
        if (listChanged)
        {
            listIds = ids;
            listNames = names;
        }
        const juce::String current = proc.getCustomTheme();
        const int themeIndex = (int) proc.params.getRawParameterValue ("theme")->load();
        if (! force && ! listChanged && current == shownCustom && themeIndex == shownTheme)
            return;
        shownCustom = current;
        shownTheme = themeIndex;
        filling = true;
        themeBox.clear (juce::dontSendNotification);
        themeBox.addItem ("Auto (viewer's look)", 1);
        themeBox.addItem ("Leaves", 2);
        themeBox.addItem ("Thorns", 3);
        themeBox.addItem ("Christmas wreath", 4);
        themeBox.addItem ("Branches only", 5);
        customIds = listIds;
        juce::StringArray shownNames = listNames;
        if (current.isNotEmpty() && ! customIds.contains (current))
        {
            customIds.add (current);
            shownNames.add (current + (themeSeq == 0 || themeSeq == 0xffffffffu ? "" : " (not in Sprout)"));
        }
        if (! customIds.isEmpty())
        {
            themeBox.addSeparator();
            for (int i = 0; i < customIds.size(); ++i)
                themeBox.addItem (shownNames[i], 100 + i);
        }
        else
            themeBox.addSectionHeading (themeSeq == 0 || themeSeq == 0xffffffffu ? "Start Sprout.exe to list your themes"
                                                                                  : "Make your own at localhost:7777/themes");
        const int sel = current.isNotEmpty() ? 100 + customIds.indexOf (current)
                      : themeIndex >= (int) sprout::ThemeChoice::ViewerDefault ? 1 : themeIndex + 2;
        themeBox.setSelectedId (sel, juce::dontSendNotification);
        filling = false;
    }

    void timerCallback() override
    {
        refreshThemes (false);

        // Rows on Auto are drawn dim, so overrides show at a glance.
        const bool themeAuto = shownCustom.isEmpty() && shownTheme >= (int) sprout::ThemeChoice::ViewerDefault;
        themeBox.setAlpha (themeAuto ? 0.6f : 1.0f);
        const bool amountAuto = proc.params.getRawParameterValue ("densityAuto")->load() > 0.5f;
        densitySlider.setAlpha (amountAuto ? 0.4f : 1.0f);
        const int mode = (int) proc.params.getRawParameterValue ("colour")->load();
        colourBox.setAlpha (mode == (int) sprout::ColourMode::Auto ? 0.6f : 1.0f);
        swatch.setVisible (mode == (int) sprout::ColourMode::OwnColour);
        for (juce::Component* c : { (juce::Component*) &gradientBar, (juce::Component*) &gradientBox, (juce::Component*) &paste, (juce::Component*) &copy })
            c->setVisible (mode == (int) sprout::ColourMode::OwnGradient);
        const auto inkColour = proc.getStateString ("inkColour");
        swatch.setColour (juce::TextButton::buttonColourId, colourOf (inkColour));
        swatch.setButtonText (inkColour.isNotEmpty() ? inkColour : "Pick colour...");
        const auto grad = proc.getStateString ("inkGradient");
        gradientBar.setGradient (grad);
        int gid = 100;
        for (int i = 0; i < kGradientCount; ++i)
            if (grad == kGradientStrings[i])
                gid = i + 1;
        filling = true;
        gradientBox.setSelectedId (gid, juce::dontSendNotification);
        filling = false;

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
        hint.setText ((autoText.isNotEmpty() ? autoText + "\n" : juce::String())
                          + "Put this first on the track, before any effects.",
                      juce::dontSendNotification);
    }

    SproutTapProcessor& proc;
    juce::TooltipWindow tooltips { this, 500 };
    juce::Label title, roleLabel, themeLabel, densityLabel, colourLabel, status, hint;
    juce::ComboBox roleBox, themeBox, colourBox, gradientBox;
    juce::ToggleButton densityAuto;
    juce::Slider densitySlider;
    juce::TextButton swatch, paste, copy, resetAll;
    GradientBar gradientBar;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> roleAttachment, colourAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> densityAttachment;
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> densityAutoAttachment;
    juce::StringArray customIds, listIds, listNames;
    juce::String shownCustom;
    int shownTheme = -1;
    uint32_t themeSeq = 0xffffffffu; // forces the first read
    bool filling = false;
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
    densityAutoParam = params.getRawParameterValue ("densityAuto");
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

    if (lost.load (std::memory_order_acquire))
    {
        // Another tap took our slot over after a long stall (no heartbeat for kStaleTimeoutMs).
        // The audio thread set `lost` as the last thing it did before it stopped writing, so the
        // writer is ours to reset here: drop the old slot without touching it (release() only
        // frees a slot that still carries our token) and claim a fresh one with a new token.
        writer.release();
        token = makeToken();
        lost.store (false, std::memory_order_release);
    }

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
        if (theme == sprout::kLookResetAll)
        {
            // "Set every tap to Auto" in the viewer.
            resetToAuto();
            return;
        }
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
        if (density >= 0.0f)
        {
            set (params.getParameter ("densityAuto"), 0.0f);
            set (params.getParameter ("density"), juce::jlimit (0.0f, 1.0f, density));
        }
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
        // Our slot was taken over after a long stall. Stop writing; don't fight for it. The
        // message thread sees `lost` and claims a fresh slot; this thread never waits for that.
        connected.store (false, std::memory_order_release);
        lost.store (true, std::memory_order_release);
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
    info.density     = densityAutoParam->load() > 0.5f ? -1.0f : densityParam->load();
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
            std::memcpy (cachedInkColour, inkColour, sizeof (inkColour));
            std::memcpy (cachedInkGradient, inkGradient, sizeof (inkGradient));
        }
    }
    std::memcpy (info.customTheme, cachedCustom, sprout::kThemeIdLength);
    if (info.colourMode == (uint32_t) sprout::ColourMode::OwnColour)
        std::memcpy (info.ink, cachedInkColour, sizeof (cachedInkColour));
    else if (info.colourMode == (uint32_t) sprout::ColourMode::OwnGradient)
        std::memcpy (info.ink, cachedInkGradient, sprout::kInkLength);
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
    return getStateString ("customTheme");
}

void SproutTapProcessor::setCustomTheme (const juce::String& id)
{
    setStateString ("customTheme", id);
}

juce::String SproutTapProcessor::getStateString (const char* name) const
{
    return params.state.getProperty (name).toString();
}

void SproutTapProcessor::setStateString (const char* name, const juce::String& value)
{
    if (value == getStateString (name))
        return;
    params.state.setProperty (name, value, nullptr);
    cacheLook();
    updateHostDisplay (ChangeDetails().withNonParameterStateChanged (true)); // the project has changed
}

void SproutTapProcessor::resetToAuto()
{
    auto set = [] (juce::RangedAudioParameter* p, float value) {
        if (p == nullptr)
            return;
        p->beginChangeGesture();
        p->setValueNotifyingHost (p->convertTo0to1 (value));
        p->endChangeGesture();
    };
    set (params.getParameter ("theme"), (float) sprout::ThemeChoice::ViewerDefault);
    set (params.getParameter ("densityAuto"), 1.0f);
    set (params.getParameter ("colour"), (float) sprout::ColourMode::Auto);
    setCustomTheme ({});
}

void SproutTapProcessor::cacheLook()
{
    char id[sprout::kThemeIdLength] {};
    char colour[sizeof (inkColour)] {};
    char grad[sprout::kInkLength] {};
    getCustomTheme().copyToUTF8 (id, sprout::kThemeIdLength);
    getStateString ("inkColour").copyToUTF8 (colour, sizeof (colour));
    getStateString ("inkGradient").copyToUTF8 (grad, sprout::kInkLength);
    const juce::SpinLock::ScopedLockType lock (trackLock);
    std::memcpy (customTheme, id, sprout::kThemeIdLength);
    std::memcpy (inkColour, colour, sizeof (inkColour));
    std::memcpy (inkGradient, grad, sprout::kInkLength);
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
            // Projects from before "Auto": a saved amount stays this track's own amount.
            bool hasDensityAuto = false;
            for (auto* child : xml->getChildIterator())
                if (child->getStringAttribute ("id") == "densityAuto")
                    hasDensityAuto = true;
            params.replaceState (juce::ValueTree::fromXml (*xml));
            if (! hasDensityAuto)
                if (auto* a = params.getParameter ("densityAuto"))
                    a->setValueNotifyingHost (0.0f);
            cacheLook();
        }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SproutTapProcessor();
}
