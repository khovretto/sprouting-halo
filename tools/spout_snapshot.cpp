// spout_snapshot: receives one frame from a Spout sender (as OBS would) and saves it as a PNG
// with alpha. Prints simple alpha statistics so tests can check the halo is really transparent.
//
//   spout_snapshot [--sender Sprout] [--out frame.png] [--wait 5]

#include "SpoutDX.h"

#include <wincodec.h>
#include <wrl/client.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

static bool writePng (const std::wstring& path, const std::vector<unsigned char>& bgra, UINT w, UINT h)
{
    ComPtr<IWICImagingFactory> factory;
    if (FAILED (CoCreateInstance (CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS (&factory))))
        return false;
    ComPtr<IWICStream> stream;
    factory->CreateStream (&stream);
    if (FAILED (stream->InitializeFromFilename (path.c_str(), GENERIC_WRITE)))
        return false;
    ComPtr<IWICBitmapEncoder> encoder;
    factory->CreateEncoder (GUID_ContainerFormatPng, nullptr, &encoder);
    encoder->Initialize (stream.Get(), WICBitmapEncoderNoCache);
    ComPtr<IWICBitmapFrameEncode> frame;
    encoder->CreateNewFrame (&frame, nullptr);
    frame->Initialize (nullptr);
    frame->SetSize (w, h);
    WICPixelFormatGUID fmt = GUID_WICPixelFormat32bppBGRA;
    frame->SetPixelFormat (&fmt);
    if (fmt != GUID_WICPixelFormat32bppBGRA)
        return false;
    frame->WritePixels (h, w * 4, (UINT) bgra.size(), const_cast<BYTE*> (bgra.data()));
    frame->Commit();
    encoder->Commit();
    return true;
}

int main (int argc, char** argv)
{
    std::string senderName = "Sprout";
    std::string out = "frame.png";
    double wait = 5.0;
    for (int i = 1; i < argc; ++i)
    {
        if (! std::strcmp (argv[i], "--sender") && i + 1 < argc) senderName = argv[++i];
        else if (! std::strcmp (argv[i], "--out") && i + 1 < argc) out = argv[++i];
        else if (! std::strcmp (argv[i], "--wait") && i + 1 < argc) wait = std::atof (argv[++i]);
    }

    CoInitializeEx (nullptr, COINIT_MULTITHREADED);

    spoutDX receiver;
    if (! receiver.OpenDirectX11())
    {
        std::fprintf (stderr, "Could not open DirectX 11\n");
        return 1;
    }
    receiver.SetReceiverName (senderName.c_str());

    std::vector<unsigned char> rgba;
    unsigned int w = 0, h = 0;
    int framesSeen = 0;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds ((int) (wait * 1000));
    bool got = false;
    while (std::chrono::steady_clock::now() < deadline)
    {
        if (receiver.ReceiveImage (rgba.empty() ? nullptr : rgba.data(), w, h))
        {
            if (receiver.IsUpdated())
            {
                w = receiver.GetSenderWidth();
                h = receiver.GetSenderHeight();
                rgba.assign ((size_t) w * h * 4, 0);
                continue;
            }
            if (! rgba.empty() && ++framesSeen >= 10) // skip a few frames so the halo is animating
            {
                got = true;
                break;
            }
        }
        std::this_thread::sleep_for (std::chrono::milliseconds (16));
    }

    if (! got)
    {
        std::fprintf (stderr, "No frames received from sender \"%s\"\n", senderName.c_str());
        return 2;
    }

    // ReceiveImage copies the sender's pixels as they are: BGRA for a BGRA sender.
    const bool senderIsRgba = receiver.GetSenderFormat() == DXGI_FORMAT_R8G8B8A8_UNORM;
    std::vector<unsigned char> bgra (rgba.size());
    std::vector<unsigned char> preview (rgba.size());
    size_t transparent = 0, partial = 0, opaque = 0;
    unsigned maxA = 0;
    for (size_t i = 0; i < rgba.size(); i += 4)
    {
        bgra[i + 0] = rgba[i + (senderIsRgba ? 2 : 0)];
        bgra[i + 1] = rgba[i + 1];
        bgra[i + 2] = rgba[i + (senderIsRgba ? 0 : 2)];
        bgra[i + 3] = rgba[i + 3];
        const unsigned a = rgba[i + 3];

        // Composite over a dark checkerboard, the way the halo looks in the app preview.
        const size_t px = (i / 4) % w, py = (i / 4) / w;
        const unsigned bg = (((px / 24) + (py / 24)) & 1) ? 44 : 30;
        for (int c = 0; c < 3; ++c)
            preview[i + c] = (unsigned char) ((bgra[i + c] * a + bg * (255 - a)) / 255);
        preview[i + 3] = 255;
        maxA = a > maxA ? a : maxA;
        if (a == 0) ++transparent;
        else if (a == 255) ++opaque;
        else ++partial;
    }
    const size_t total = (size_t) w * h;
    std::printf ("sender=%s size=%ux%u transparent=%.1f%% partial=%.1f%% opaque=%.1f%% maxAlpha=%u\n",
                 senderName.c_str(), w, h, 100.0 * transparent / total, 100.0 * partial / total,
                 100.0 * opaque / total, maxA);

    const std::wstring outW (out.begin(), out.end());
    if (! writePng (outW, bgra, w, h))
    {
        std::fprintf (stderr, "Could not write %s\n", out.c_str());
        return 3;
    }
    std::printf ("saved %s\n", out.c_str());

    // Alpha along a ray from the centre to the right edge (radius in units of half the frame).
    std::printf ("alpha profile:");
    for (int k = 0; k <= 20; ++k)
    {
        const double r = k / 20.0;
        const size_t x = std::min<size_t> (w - 1, (size_t) (w / 2 + r * (w / 2 - 1)));
        std::printf (" %.2f:%u", r, (unsigned) rgba[((size_t) (h / 2) * w + x) * 4 + 3]);
    }
    std::printf ("\n");

    const std::string previewPath = out.substr (0, out.find_last_of ('.')) + "_preview.png";
    const std::wstring previewW (previewPath.begin(), previewPath.end());
    if (writePng (previewW, preview, w, h))
        std::printf ("saved %s\n", previewPath.c_str());
    receiver.ReleaseReceiver();
    receiver.CloseDirectX11();
    return 0;
}
