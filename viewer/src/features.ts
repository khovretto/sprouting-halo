// What the renderer consumes each frame: the live takes first (role 'live', one halo each,
// concentric), then the previous takes (role 'take', the plants), in a stable order. Produced by the fake singer or by the live
// WebSocket feed from Sprout.exe (sources/live.ts).

export type Role = 'live' | 'take' | 'instrument';
/** A built-in theme, or the id of a user theme (themes.ts). */
export type Theme = 'branches' | 'leaves' | 'thorns' | 'wreath' | (string & {});

export interface LayerFeatures {
  /** Stable identity: a take keeps its plant while this stays the same (e.g. "slot-3"). */
  id: string;
  role: Role;
  /** Smoothed loudness 0..1. */
  level: number;
  /** True on the frame a note/strum starts. */
  onset: boolean;
  /** MIDI pitch, 0 when unvoiced or unknown. */
  pitch: number;
  /** Vibrato depth 0..1. */
  vibrato: number;
  /** Vibrato rate in Hz. */
  vibratoRate: number;
  /** Vocal effort 0 (soft) .. 1 (full / pressed), independent of mic gain. 0.5 = neutral. */
  effort: number;
  /** Breathiness 0 (clear) .. 1 (breathy / whisper). */
  breath: number;
  /** DAW track name / colour (#rrggbb), when known. */
  name?: string;
  colour?: string;
  /** Per-track look from the tap plugin: a built-in or user theme id. Undefined = use the viewer's fallback. */
  theme?: Theme | string;
  density?: number;
  /** Use the DAW track colour (when the track has one) instead of the viewer palette. */
  trackColour?: boolean;
  /** Colour from the tap: track (DAW track colour), auto (the viewer picks), ink (own colour or gradient). */
  colourMode?: 'track' | 'auto' | 'ink';
  /** The track's own colour ("#rrggbb") or gradient string, with colourMode 'ink'. */
  ink?: string;
  /** The DAW is recording (live take only). Undefined = unknown (treated as recording). */
  recording?: boolean;
}

export interface FeatureFrame {
  time: number;
  layers: LayerFeatures[];
}
