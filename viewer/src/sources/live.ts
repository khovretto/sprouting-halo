// Connection to Sprout.exe: receives one JSON feature frame per app frame describing every
// connected Sprout Tap (see featureJson in app/main.cpp), and relays viewer-to-viewer messages
// (panel settings, actions) so every open viewer stays in sync. Reconnects automatically.

import type { FeatureFrame, LayerFeatures, Role, Theme } from '../features';

interface TapMessage {
  slot: number;
  role: Role;
  name: string;
  colour: string;
  level: number;
  onset: boolean;
  pitch: number;
  vibrato: number;
  vibratoRate: number;
  effort?: number;
  breath?: number;
  playing: boolean;
  bpm: number;
  theme?: Theme | 'default';
  /** A user theme picked in the tap window (wins over theme). */
  customTheme?: string;
  density?: number;
  trackColour?: boolean;
  recording?: boolean;
}

export type LiveStatus = 'off' | 'connecting' | 'connected';

/** Any message that isn't a feature frame (sent by another viewer). */
export type ViewerMessage = { type: string; [k: string]: unknown };

export class LiveSource {
  status: LiveStatus = 'off';
  /** Taps in the latest message (for the status display). */
  tapCount = 0;
  /** True once Sprout.exe has sent a feature frame. */
  hasFrames = false;
  onMessage?: (msg: ViewerMessage) => void;
  onOpen?: () => void;

  private ws?: WebSocket;
  private url = '';
  private retry = 0;
  private latest: TapMessage[] = [];
  private onsets = new Set<number>(); // latched until the next frame() so none are missed
  private seen = new Map<number, { lastSeen: number; order: number; tap: TapMessage }>();
  private order = 0;

  /** Start (or keep) a connection to `url`; pass '' to disconnect. */
  setUrl(url: string) {
    if (url === this.url) return;
    this.url = url;
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = undefined;
    this.status = 'off';
    if (url) this.connect();
  }

  send(msg: ViewerMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.status = 'connected';
      this.onOpen?.();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg: ViewerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'frame') {
        const taps = (msg.taps as TapMessage[]) ?? [];
        this.latest = taps;
        this.tapCount = taps.length;
        this.hasFrames = true;
        for (const tap of taps) if (tap.onset) this.onsets.add(tap.slot);
      } else this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.latest = [];
      this.tapCount = 0;
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    this.status = 'connecting';
    clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.url && this.connect(), 1000);
  }

  /**
   * Current features: every live-role tap (a halo each), then the takes. Takes are
   * ordered by when it first appeared. A tap keeps its place when its role changes (a recorded
   * take turning into playback). A take that vanishes is held (silent) for `holdSeconds` so a
   * brief dropout doesn't reshuffle the layout. Instrument taps are not visualised yet.
   */
  frame(now: number, holdSeconds: number): FeatureFrame {
    for (const tap of this.latest) {
      if (tap.role === 'instrument') continue;
      const s = this.seen.get(tap.slot);
      if (s) {
        s.lastSeen = now;
        s.tap = tap;
      } else this.seen.set(tap.slot, { lastSeen: now, order: this.order++, tap });
    }
    for (const [slot, s] of this.seen) if (now - s.lastSeen > holdSeconds) this.seen.delete(slot);

    const entries = [...this.seen.entries()].sort((a, b) => a[1].order - b[1].order);
    const toLayer = (slot: number, s: { lastSeen: number; tap: TapMessage }, role: Role): LayerFeatures => {
      const fresh = s.lastSeen === now;
      return {
        id: `slot-${slot}`,
        role,
        level: fresh ? s.tap.level : 0,
        onset: fresh && this.onsets.has(slot),
        pitch: fresh ? s.tap.pitch : 0,
        vibrato: fresh ? s.tap.vibrato : 0,
        vibratoRate: s.tap.vibratoRate,
        effort: s.tap.effort ?? 0.5,
        breath: s.tap.breath ?? 0,
        name: s.tap.name,
        colour: s.tap.colour || undefined,
        theme: s.tap.customTheme || (s.tap.theme && s.tap.theme !== 'default' ? s.tap.theme : undefined),
        density: s.tap.customTheme || (s.tap.theme && s.tap.theme !== 'default') ? s.tap.density : undefined,
        trackColour: s.tap.trackColour,
        recording: s.tap.recording,
      };
    };

    // Every live tap gets a halo (concentric, in slot order); everything else is a take.
    const lives = entries.filter(([, s]) => s.tap.role === 'live').sort((a, b) => a[0] - b[0])
      .map(([slot, s]) => toLayer(slot, s, 'live'));
    const takes = entries.filter(([, s]) => s.tap.role !== 'live').map(([slot, s]) => toLayer(slot, s, 'take'));
    this.onsets.clear();
    return { time: now, layers: [...lives, ...takes] };
  }
}
