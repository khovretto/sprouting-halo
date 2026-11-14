// FeatureServer.h - tiny localhost HTTP + WebSocket server for the web viewer.
//
// - WebSocket (any path, "Upgrade: websocket"): the app broadcasts one JSON feature frame per
//   rendered frame to every connected viewer (OBS Browser Source, preview browser).
// - Plain HTTP GET: serves the built viewer (viewer/dist) so OBS can load
//   http://localhost:<port>/?obs without a separate dev server.
//
// Single-threaded and non-blocking: call poll() and broadcast() from the app's main loop.
// Binds to 127.0.0.1 only.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace sprout
{
class FeatureServer
{
public:
    FeatureServer();
    ~FeatureServer();
    FeatureServer (const FeatureServer&) = delete;
    FeatureServer& operator= (const FeatureServer&) = delete;

    // Returns false if the port could not be opened (e.g. already in use).
    bool start (uint16_t port, const std::wstring& webRoot);
    void stop();

    // Accept connections, answer HTTP requests and handshakes, flush pending output.
    void poll();

    // Send a text message to every WebSocket client. Slow clients skip frames instead of lagging.
    void broadcast (const std::string& text);

    // Messages for the app itself ("tapLook": a viewer picked a preset), received since the last call.
    std::vector<std::string> takeAppMessages();

    int clientCount() const;
    uint16_t port() const;
    bool isRunning() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
} // namespace sprout
