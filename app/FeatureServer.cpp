#include "FeatureServer.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <map>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>

#pragma comment(lib, "ws2_32.lib")

namespace sprout
{
namespace
{
// ---------------------------------------------------------------------------------------------
// SHA-1 + base64, only for the WebSocket handshake (RFC 6455 section 4.2.2).
std::array<uint8_t, 20> sha1 (const std::string& msg)
{
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };
    std::vector<uint8_t> data (msg.begin(), msg.end());
    const uint64_t bitLen = (uint64_t) data.size() * 8;
    data.push_back (0x80);
    while (data.size() % 64 != 56)
        data.push_back (0);
    for (int i = 7; i >= 0; --i)
        data.push_back ((uint8_t) (bitLen >> (i * 8)));

    auto rol = [] (uint32_t v, int n) { return (v << n) | (v >> (32 - n)); };
    for (size_t chunk = 0; chunk < data.size(); chunk += 64)
    {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = (uint32_t) data[chunk + i * 4] << 24 | (uint32_t) data[chunk + i * 4 + 1] << 16
                 | (uint32_t) data[chunk + i * 4 + 2] << 8 | (uint32_t) data[chunk + i * 4 + 3];
        for (int i = 16; i < 80; ++i)
            w[i] = rol (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i)
        {
            uint32_t f, k;
            if (i < 20)      { f = (b & c) | (~b & d);           k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8F1BBCDC; }
            else             { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
            const uint32_t t = rol (a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol (b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    std::array<uint8_t, 20> out {};
    for (int i = 0; i < 5; ++i)
        for (int j = 0; j < 4; ++j)
            out[i * 4 + j] = (uint8_t) (h[i] >> (24 - j * 8));
    return out;
}

std::string base64 (const uint8_t* p, size_t n)
{
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    for (size_t i = 0; i < n; i += 3)
    {
        const uint32_t v = (uint32_t) p[i] << 16 | (i + 1 < n ? (uint32_t) p[i + 1] << 8 : 0) | (i + 2 < n ? p[i + 2] : 0);
        out += tbl[(v >> 18) & 63];
        out += tbl[(v >> 12) & 63];
        out += i + 1 < n ? tbl[(v >> 6) & 63] : '=';
        out += i + 2 < n ? tbl[v & 63] : '=';
    }
    return out;
}

std::string lower (std::string s)
{
    std::transform (s.begin(), s.end(), s.begin(), [] (unsigned char c) { return (char) std::tolower (c); });
    return s;
}

// Value of an HTTP header (case-insensitive name), or "".
std::string header (const std::string& request, const std::string& name)
{
    const std::string lreq = lower (request);
    const std::string key = "\r\n" + lower (name) + ":";
    const size_t pos = lreq.find (key);
    if (pos == std::string::npos)
        return {};
    size_t start = pos + key.size();
    const size_t end = request.find ("\r\n", start);
    while (start < end && request[start] == ' ')
        ++start;
    return request.substr (start, end - start);
}

const char* mimeType (const std::wstring& path)
{
    const size_t dot = path.find_last_of (L'.');
    const std::wstring ext = dot == std::wstring::npos ? L"" : path.substr (dot);
    if (ext == L".html") return "text/html; charset=utf-8";
    if (ext == L".js")   return "text/javascript; charset=utf-8";
    if (ext == L".css")  return "text/css; charset=utf-8";
    if (ext == L".json") return "application/json";
    if (ext == L".svg")  return "image/svg+xml";
    if (ext == L".png")  return "image/png";
    if (ext == L".jpg")  return "image/jpeg";
    if (ext == L".webp") return "image/webp";
    if (ext == L".ico")  return "image/x-icon";
    if (ext == L".wasm") return "application/wasm";
    if (ext == L".woff2") return "font/woff2";
    return "application/octet-stream";
}

std::wstring utf8ToWide (const std::string& s)
{
    if (s.empty())
        return {};
    const int n = MultiByteToWideChar (CP_UTF8, 0, s.data(), (int) s.size(), nullptr, 0);
    std::wstring w ((size_t) n, L'\0');
    MultiByteToWideChar (CP_UTF8, 0, s.data(), (int) s.size(), w.data(), n);
    return w;
}

constexpr size_t kMaxPendingOutput = 256 * 1024; // a WebSocket client further behind than this skips frames
constexpr size_t kMaxRequestSize   = 256 * 1024; // also the largest viewer message (preset)
} // namespace

// ---------------------------------------------------------------------------------------------
struct FeatureServer::Impl
{
    struct Conn
    {
        SOCKET s = INVALID_SOCKET;
        bool ws = false;
        bool closing = false; // close once `out` is flushed
        std::string in, out;
    };

    SOCKET listener = INVALID_SOCKET;
    bool wsaStarted = false;
    uint16_t port = 0;
    std::wstring webRoot;
    std::vector<Conn> conns;

    // Viewer-to-viewer relay: text messages from one viewer (panel settings, actions) go to all
    // the others. The latest "params" message is kept and sent to viewers that connect later,
    // so an OBS Browser Source picks up the settings made in a normal browser tab.
    std::string lastParams;
    // Shared settings, merged key by key from every viewer's "params" patches ({"growth.reach":1.2,
    // ...}); a viewer that connects gets all of them at once, so it starts from the latest value of
    // every key no matter which viewer changed it.
    std::map<std::string, std::string> settings;
    uint64_t settingsVersion = 0;

    // Merge the flat "patch":{"key":value,...} object of a params message (values kept as raw JSON).
    void mergePatch (const std::string& msg)
    {
        size_t p = msg.find ("\"patch\":{");
        if (p == std::string::npos)
            return;
        p += 9;
        auto skipWs = [&] { while (p < msg.size() && (msg[p] == ' ' || msg[p] == ',' || msg[p] == '\n' || msg[p] == '\r' || msg[p] == '\t')) ++p; };
        auto readString = [&] () -> std::string { // at '"', returns the raw token including quotes
            const size_t a = p++;
            while (p < msg.size() && msg[p] != '"')
                p += msg[p] == '\\' ? 2 : 1;
            ++p;
            return msg.substr (a, p - a);
        };
        for (;;)
        {
            skipWs();
            if (p >= msg.size() || msg[p] == '}' || msg[p] != '"')
                break;
            const std::string key = readString();
            skipWs();
            if (p >= msg.size() || msg[p] != ':')
                break;
            ++p;
            skipWs();
            std::string value;
            if (p < msg.size() && msg[p] == '"')
                value = readString();
            else
            {
                const size_t a = p;
                while (p < msg.size() && msg[p] != ',' && msg[p] != '}')
                    ++p;
                value = msg.substr (a, p - a);
            }
            if (key.size() > 2 && ! value.empty() && settings.size() < 2000)
                settings[key] = value;
        }
        lastParams = "{\"type\":\"params\",\"from\":\"sprout\",\"replay\":true,\"patch\":{";
        bool first = true;
        for (const auto& [k, v] : settings)
        {
            if (! first)
                lastParams += ',';
            first = false;
            lastParams += k + ':' + v;
        }
        lastParams += "}}";
        ++settingsVersion;
    }
    std::vector<std::pair<SOCKET, std::string>> relay; // (sender, message)
    std::vector<std::string> appInbox;                  // messages for the app ("tapLook", "detect")
    std::string welcome;                                // sent to each viewer as it connects

    void handleHttp (Conn& c)
    {
        const size_t end = c.in.find ("\r\n\r\n");
        if (end == std::string::npos)
        {
            if (c.in.size() > kMaxRequestSize)
                c.closing = true;
            return;
        }
        const std::string req = c.in.substr (0, end + 2);
        c.in.erase (0, end + 4);

        const size_t sp1 = req.find (' ');
        const size_t sp2 = req.find (' ', sp1 + 1);
        const std::string method = req.substr (0, sp1);
        std::string target = sp1 == std::string::npos ? "/" : req.substr (sp1 + 1, sp2 - sp1 - 1);

        const std::string key = header (req, "Sec-WebSocket-Key");
        if (lower (header (req, "Upgrade")) == "websocket" && ! key.empty())
        {
            const auto digest = sha1 (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
            c.out += "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     "Sec-WebSocket-Accept: " + base64 (digest.data(), digest.size()) + "\r\n\r\n";
            c.ws = true;
            if (! lastParams.empty())
                c.out += frame (0x1, lastParams);
            if (! welcome.empty())
                c.out += frame (0x1, welcome);
            return;
        }

        auto respond = [&] (const char* status, const char* type, const std::string& body) {
            c.out += std::string ("HTTP/1.1 ") + status + "\r\nContent-Type: " + type
                   + "\r\nContent-Length: " + std::to_string (body.size())
                   + "\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
            if (method != "HEAD")
                c.out += body;
            c.closing = true;
        };

        if (method != "GET" && method != "HEAD")
            return respond ("405 Method Not Allowed", "text/plain", "Method not allowed");

        target = target.substr (0, target.find_first_of ("?#"));
        if (target.empty() || target.back() == '/')
            target += "index.html";
        // Page routes without a file extension (/controls) are the viewer itself.
        if (target.find ('.', target.find_last_of ('/')) == std::string::npos)
            target = "/index.html";
        if (target.find ("..") != std::string::npos || target.find ('\\') != std::string::npos || target[0] != '/')
            return respond ("400 Bad Request", "text/plain", "Bad request");

        std::wstring path = webRoot + utf8ToWide (target);
        std::replace (path.begin(), path.end(), L'/', L'\\');
        std::ifstream f (path, std::ios::binary);
        if (! f)
            return respond ("404 Not Found", "text/plain",
                            webRoot.empty() ? "Sprout: no web folder found. Build the viewer (npm --prefix viewer run build)."
                                            : "Not found");
        const std::string body ((std::istreambuf_iterator<char> (f)), std::istreambuf_iterator<char>());
        respond ("200 OK", mimeType (path), body);
    }

    // Client → server frames: answer ping and close, ignore everything else.
    void handleWsInput (Conn& c)
    {
        for (;;)
        {
            if (c.in.size() < 2)
                return;
            const auto* b = (const uint8_t*) c.in.data();
            const uint8_t opcode = b[0] & 0x0F;
            const bool masked = (b[1] & 0x80) != 0;
            uint64_t len = b[1] & 0x7F;
            size_t pos = 2;
            if (len == 126)
            {
                if (c.in.size() < 4) return;
                len = (uint64_t) b[2] << 8 | b[3];
                pos = 4;
            }
            else if (len == 127)
            {
                if (c.in.size() < 10) return;
                len = 0;
                for (int i = 0; i < 8; ++i)
                    len = len << 8 | b[2 + i];
                pos = 10;
            }
            if (len > kMaxRequestSize)
            {
                c.closing = true;
                return;
            }
            const size_t maskPos = pos;
            if (masked)
                pos += 4;
            if (c.in.size() < pos + len)
                return;
            std::string payload = c.in.substr (pos, (size_t) len);
            if (masked)
                for (size_t i = 0; i < payload.size(); ++i)
                    payload[i] ^= c.in[maskPos + (i & 3)];
            c.in.erase (0, pos + (size_t) len);

            if (opcode == 0x8) // close
            {
                c.out += frame (0x8, payload.substr (0, 2));
                c.closing = true;
                return;
            }
            if (opcode == 0x9) // ping
                c.out += frame (0xA, payload);
            if (opcode == 0x1) // text from a viewer: relay to the other viewers
            {
                if (payload.rfind ("{\"type\":\"tapLook\"", 0) == 0 || payload.rfind ("{\"type\":\"detect\"", 0) == 0)
                {
                    if (appInbox.size() < 64)
                        appInbox.push_back (std::move (payload));
                    continue;
                }
                if (payload.rfind ("{\"type\":\"params\"", 0) == 0)
                    mergePatch (payload);
                relay.push_back ({ c.s, std::move (payload) });
            }
        }
    }

    static std::string frame (uint8_t opcode, const std::string& payload)
    {
        std::string f;
        f += (char) (0x80 | opcode);
        const size_t n = payload.size();
        if (n < 126)
            f += (char) n;
        else if (n < 65536)
        {
            f += (char) 126;
            f += (char) (n >> 8);
            f += (char) (n & 0xFF);
        }
        else
        {
            f += (char) 127;
            for (int i = 7; i >= 0; --i)
                f += (char) ((uint64_t) n >> (i * 8));
        }
        return f + payload;
    }
};

FeatureServer::FeatureServer() : impl (std::make_unique<Impl>()) {}
FeatureServer::~FeatureServer() { stop(); }

bool FeatureServer::start (uint16_t port, const std::wstring& webRoot)
{
    stop();
    WSADATA wsa;
    if (WSAStartup (MAKEWORD (2, 2), &wsa) != 0)
        return false;
    impl->wsaStarted = true;
    impl->webRoot = webRoot;

    SOCKET s = socket (AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET)
        return false;
    BOOL exclusive = TRUE;
    setsockopt (s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char*) &exclusive, sizeof (exclusive));
    sockaddr_in addr {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons (port);
    addr.sin_addr.s_addr = htonl (INADDR_LOOPBACK);
    u_long nonBlocking = 1;
    if (bind (s, (sockaddr*) &addr, sizeof (addr)) != 0 || listen (s, SOMAXCONN) != 0
        || ioctlsocket (s, FIONBIO, &nonBlocking) != 0)
    {
        closesocket (s);
        return false;
    }
    impl->listener = s;
    impl->port = port;
    return true;
}

void FeatureServer::stop()
{
    for (auto& c : impl->conns)
        closesocket (c.s);
    impl->conns.clear();
    if (impl->listener != INVALID_SOCKET)
        closesocket (impl->listener);
    impl->listener = INVALID_SOCKET;
    if (impl->wsaStarted)
        WSACleanup();
    impl->wsaStarted = false;
}

void FeatureServer::poll()
{
    if (impl->listener == INVALID_SOCKET)
        return;

    for (;;)
    {
        SOCKET s = accept (impl->listener, nullptr, nullptr);
        if (s == INVALID_SOCKET)
            break;
        u_long nonBlocking = 1;
        ioctlsocket (s, FIONBIO, &nonBlocking);
        BOOL noDelay = TRUE;
        setsockopt (s, IPPROTO_TCP, TCP_NODELAY, (const char*) &noDelay, sizeof (noDelay));
        Impl::Conn c;
        c.s = s;
        impl->conns.push_back (std::move (c));
    }

    char buf[8192];
    for (auto& c : impl->conns)
    {
        bool dead = false;
        for (;;)
        {
            const int n = recv (c.s, buf, (int) sizeof (buf), 0);
            if (n > 0)
            {
                c.in.append (buf, (size_t) n);
                continue;
            }
            if (n == 0 || WSAGetLastError() != WSAEWOULDBLOCK)
                dead = true;
            break;
        }
        if (dead)
        {
            c.closing = true;
            c.out.clear();
        }
        else if (c.ws)
            impl->handleWsInput (c);
        else
            impl->handleHttp (c);
    }

    for (const auto& [sender, msg] : impl->relay)
    {
        const std::string f = Impl::frame (0x1, msg);
        for (auto& c : impl->conns)
            if (c.ws && ! c.closing && c.s != sender && c.out.size() <= kMaxPendingOutput)
                c.out += f;
    }
    impl->relay.clear();

    for (auto& c : impl->conns)
    {
        while (! c.out.empty())
        {
            const int n = send (c.s, c.out.data(), (int) std::min<size_t> (c.out.size(), 1 << 20), 0);
            if (n > 0)
                c.out.erase (0, (size_t) n);
            else
            {
                if (WSAGetLastError() != WSAEWOULDBLOCK)
                {
                    c.out.clear();
                    c.closing = true;
                }
                break;
            }
        }
    }

    auto& v = impl->conns;
    v.erase (std::remove_if (v.begin(), v.end(), [] (const Impl::Conn& c) {
                 if (c.closing && c.out.empty())
                 {
                     closesocket (c.s);
                     return true;
                 }
                 return false;
             }),
             v.end());
}

void FeatureServer::broadcast (const std::string& text)
{
    std::string f;
    for (auto& c : impl->conns)
    {
        if (! c.ws || c.closing || c.out.size() > kMaxPendingOutput)
            continue;
        if (f.empty())
            f = Impl::frame (0x1, text);
        c.out += f;
    }
}

const std::string& FeatureServer::settingsMessage() const
{
    return impl->lastParams;
}

uint64_t FeatureServer::settingsVersion() const
{
    return impl->settingsVersion;
}

void FeatureServer::restoreSettings (const std::string& message)
{
    impl->mergePatch (message);
}

void FeatureServer::setWelcome (const std::string& text)
{
    impl->welcome = text;
}

std::vector<std::string> FeatureServer::takeAppMessages()
{
    std::vector<std::string> out;
    out.swap (impl->appInbox);
    return out;
}

int FeatureServer::clientCount() const
{
    int n = 0;
    for (const auto& c : impl->conns)
        n += c.ws && ! c.closing ? 1 : 0;
    return n;
}

uint16_t FeatureServer::port() const { return impl->port; }
bool FeatureServer::isRunning() const { return impl->listener != INVALID_SOCKET; }
} // namespace sprout
