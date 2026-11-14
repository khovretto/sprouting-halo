#include "ReaperHost.h"

#include <pluginterfaces/base/funknown.h>

namespace reaper
{
using namespace Steinberg;

// From REAPER's SDK (reaper_vst3_interfaces.h, also shipped in JUCE's examples). Declared here
// with an inline UID so no FUID definitions have to be linked into the shared plugin code.
class IReaperHostApplication : public FUnknown
{
public:
    virtual void* PLUGIN_API getReaperApi (CStringA funcname) = 0;
    virtual void* PLUGIN_API getReaperParent (uint32 w) = 0; // 1 = parent track
    virtual void* PLUGIN_API reaperExtended (uint32 call, void* parm1, void* parm2, void* parm3) = 0;
};

const TUID kIReaperHostApplicationIid = INLINE_UID (0x79655E36, 0x77EE4267, 0xA573FEF7, 0x4912C27C);
} // namespace reaper

ReaperHost::~ReaperHost()
{
    if (reaperHost != nullptr)
        static_cast<reaper::IReaperHostApplication*> (reaperHost)->release();
}

void ReaperHost::setIHostApplication (Steinberg::FUnknown* host)
{
    if (host == nullptr || reaperHost != nullptr)
        return;
    void* obj = nullptr;
    if (host->queryInterface (reaper::kIReaperHostApplicationIid, &obj) != Steinberg::kResultOk || obj == nullptr)
        return;
    reaperHost = obj;
    auto* r = static_cast<reaper::IReaperHostApplication*> (obj);
    getTrackValue = reinterpret_cast<double (*) (void*, const char*)> (r->getReaperApi ("GetMediaTrackInfo_Value"));
}

int ReaperHost::trackRecordArmed() const
{
    if (reaperHost == nullptr || getTrackValue == nullptr)
        return -1;
    void* track = static_cast<reaper::IReaperHostApplication*> (reaperHost)->getReaperParent (1);
    if (track == nullptr)
        return -1;
    return getTrackValue (track, "I_RECARM") > 0.5 ? 1 : 0;
}
