// Harmony between tracks, found in the viewer from the pitches Sprout.exe (or the fake singer)
// sends: two voices singing at the same time, a third, fourth, fifth or sixth apart (in any
// octave), for at least harmony.minSeconds. Unison and octaves count only with harmony.unison:
// stacked takes of the same part are doubling, not harmony.
//
// Each voice gets an amount 0..1 (eased in and out) and the voice it harmonises with. The effects
// that read it are in main.ts (colours, weave and lean, glow) and deco.ts (blossoms, theme parts).

import type { LayerFeatures } from './features';
import type { Params } from './params';

/** Interval classes (semitones within the octave) that count as harmony. */
const CONSONANT = [3, 4, 5, 7, 8, 9];
/** How far off a pure interval still counts (semitones): vibrato and scoops stay inside. */
const TOLERANCE = 0.5;
/** A harmony survives gaps this short (note changes, consonants). */
const GRACE = 0.18;

interface Voice {
  /** Pitch smoothed over ~0.15 s, so vibrato does not swing the interval (0 = not singing). */
  pitch: number;
  /** Seconds in harmony, and seconds since it was last in harmony. */
  since: number;
  lost: number;
  amount: number;
  partner: string | null;
  seen: boolean;
}

/** How far `semitones` is from the nearest interval that counts (0 = pure). */
export function consonance(semitones: number, unison: boolean) {
  const c = ((Math.abs(semitones) % 12) + 12) % 12;
  let best = 99;
  for (const k of CONSONANT) best = Math.min(best, Math.abs(c - k));
  if (unison) best = Math.min(best, c, 12 - c);
  return best;
}

export class HarmonyTracker {
  private voices = new Map<string, Voice>();

  /** 0..1: how much this track is in harmony with another right now. */
  amount(id: string) {
    return this.voices.get(id)?.amount ?? 0;
  }

  /** The track it harmonises with (kept while the amount fades out). */
  partner(id: string) {
    return this.voices.get(id)?.partner ?? null;
  }

  update(layers: LayerFeatures[], dt: number, p: Params) {
    const h = p.harmony;
    for (const v of this.voices.values()) v.seen = false;
    const singing: { id: string; v: Voice }[] = [];
    for (const f of layers) {
      if (f.role === 'instrument') continue;
      let v = this.voices.get(f.id);
      if (!v) this.voices.set(f.id, (v = { pitch: 0, since: 0, lost: 9, amount: 0, partner: null, seen: true }));
      v.seen = true;
      if (f.level > 0.05 && f.pitch > 0) {
        // A new note (a jump) starts the smoothing over.
        if (v.pitch <= 0 || Math.abs(f.pitch - v.pitch) > 1.2) v.pitch = f.pitch;
        else v.pitch += (f.pitch - v.pitch) * (1 - Math.exp(-dt / 0.15));
        singing.push({ id: f.id, v });
      } else v.pitch = 0;
    }
    for (const [id, v] of this.voices) if (!v.seen) this.voices.delete(id);

    const found = new Map<Voice, string>();
    for (const a of singing) {
      // The purest interval wins; the partner it already has wins a near tie.
      let best = TOLERANCE, who: string | null = null;
      for (const b of singing) {
        if (b === a) continue;
        const off = consonance(a.v.pitch - b.v.pitch, h.unison) - (b.id === a.v.partner ? 0.15 : 0);
        if (off <= best) {
          best = off;
          who = b.id;
        }
      }
      if (who) found.set(a.v, who);
    }
    const attack = Math.max(0.02, h.attack);
    for (const v of this.voices.values()) {
      const who = found.get(v);
      if (who) {
        v.partner = who;
        v.since += dt;
        v.lost = 0;
      } else {
        v.lost += dt;
        if (v.lost > GRACE) v.since = 0;
      }
      const on = v.since >= Math.max(0, h.minSeconds) ? 1 : 0;
      v.amount += (on - v.amount) * (1 - Math.exp(-dt / (on > v.amount ? attack * 0.5 : attack)));
      if (v.amount < 0.002) {
        v.amount = 0;
        if (!who) v.partner = null;
      }
    }
  }

  clear() {
    this.voices.clear();
  }
}
