// Fake singer: phrases of notes with gaps, a wandering melody up to F6, vibrato on long notes,
// soft and full notes (effort) and breathy phrase endings. It makes no sound: it invents the
// feature values Sprout.exe would send. commit()/deleteLast() simulate finishing a recording and
// deleting a take, to preview the transitions without a DAW.
//
// How the voices (the live tracks and the takes) relate is fake.voices:
//  - independent: every voice has its own phrases, pauses and notes (takes of different parts).
//    A voice that starts a note while the first voice sings joins it in harmony fake.harmony of
//    the time.
//  - duet: the voices trade phrases. One sings a phrase alone, then another; fake.together of the
//    phrases are sung by all, in harmony.
//  - together: every voice sings every phrase at a fixed interval (stacked takes of one part).

import type { FeatureFrame, LayerFeatures } from '../features';
import type { Params } from '../params';
import { clamp, hash1, lerp, noise1, rng, Rng } from '../math';

/** fake.voices "together": each voice's fixed interval above the melody. */
const INTERVALS = [0, 4, -5, 7, -12, 3, 9, -8, 12, 5, -3, 2, 10, -7, 16, -10, 0];
/** Thirds, fourths, fifths and sixths, up and down. */
const CONSONANT = [4, 3, -3, 7, -5, 9, -4, 8, 5, -8, -7, -9];
const DISSONANT = [1, 2, 6, -1, -2, 10, 11, -6];

/** One phrase clock with its own melody. */
interface Voice {
  r: Rng;
  index: number;
  phraseOn: boolean;
  phraseStart: number;
  segEnd: number;
  noteStart: number;
  noteEnd: number;
  /** The clock's own melody (MIDI) and the note sung now (the melody, or a harmony to the lead). */
  melody: number;
  pitch: number;
  intensity: number;
  phrases: number;
  /** A note started in this step. */
  newNote: boolean;
  /** A phrase started in this step. */
  newPhrase: boolean;
}

export class FakeSource {
  private seed = 1;
  private t = 0;
  /** The clock of "together" and "duet", and the first voice of "independent". */
  private lead!: Voice;
  private voices = new Map<string, Voice>();
  private made = 0;
  /** duet: who sings the current phrase, and each one's interval to the melody. */
  private cast = new Map<string, number>();
  private turn = 0;
  private duet!: Rng;
  private levels = new Map<string, number>();
  private liveIds: string[] = [];
  private liveCount = 0;
  private takeIds: string[] = [];
  private takeCount = 0;
  private stopNow = false;

  constructor(seed: number) {
    this.reset(seed);
  }

  reset(seed: number) {
    this.seed = seed;
    this.t = 0;
    this.made = 0;
    this.voices.clear();
    this.lead = this.newVoice(0.6);
    this.cast.clear();
    this.turn = 0;
    this.duet = rng(seed * 13 + 5);
    this.stopNow = false;
    this.levels.clear();
    this.liveIds = [];
    this.takeIds = [];
  }

  private newVoice(firstPhraseAt: number): Voice {
    const index = this.made++;
    return {
      r: rng(this.seed + index * 101), index, phraseOn: false, phraseStart: 0, segEnd: this.t + firstPhraseAt,
      noteStart: 0, noteEnd: 0, melody: 64 + (index ? ((index * 5) % 9) - 4 : 0), pitch: 64, intensity: 0.7, phrases: 0,
      newNote: false, newPhrase: false,
    };
  }

  /** The voice of a layer (independent): the first layer sings the lead. */
  private voiceOf(id: string, first: boolean): Voice {
    if (first) return this.lead;
    let v = this.voices.get(id);
    if (!v) {
      v = this.newVoice(0.4 + 2.4 * hash1(this.made * 7.31 + this.seed));
      this.voices.set(id, v);
    }
    return v;
  }

  private syncLives(p: Params) {
    const want = Math.max(1, Math.round(p.fake.liveTracks));
    while (this.liveIds.length < want) this.liveIds.push(`fake-live-${++this.liveCount}`);
    while (this.liveIds.length > want) this.liveIds.pop();
  }

  /** The live take becomes a playback take and a new live take starts. */
  commit(p: Params) {
    this.syncTakes(p);
    this.syncLives(p);
    this.takeIds.push(this.liveIds.shift()!);
    this.syncLives(p);
    p.scene.layers = this.takeIds.length + 1;
  }

  /** End the current phrase now with a full stop (a long pause): every voice. */
  endPhrase() {
    this.stopNow = true;
  }

  /** Delete the oldest playback take (the planting loop keeps at most `keep`). */
  dropOldest(p: Params, keep: number) {
    this.syncTakes(p);
    while (this.takeIds.length > keep) this.takeIds.shift();
    p.scene.layers = this.takeIds.length + 1;
  }

  /** Delete the most recent playback take. */
  deleteLast(p: Params) {
    this.syncTakes(p);
    this.takeIds.pop();
    p.scene.layers = this.takeIds.length + 1;
  }

  private syncTakes(p: Params) {
    const want = Math.max(0, p.scene.layers - 1);
    while (this.takeIds.length < want) this.takeIds.push(`fake-take-${++this.takeCount}`);
    while (this.takeIds.length > want) this.takeIds.pop();
  }

  /** Advance one phrase clock: phrases, pauses (every n-th a full stop) and notes. */
  private step(v: Voice, p: Params, stop: boolean, harmoniseWith?: Voice) {
    const fp = p.fake;
    v.newNote = v.newPhrase = false;
    if (stop && v.phraseOn) v.segEnd = this.t;
    // Already in a pause: it becomes the full stop.
    else if (stop) v.segEnd = Math.max(v.segEnd, this.t + fp.fullStopSeconds);
    if (this.t >= v.segEnd) {
      v.phraseOn = !v.phraseOn;
      let len = v.phraseOn ? lerp(fp.phraseMin, fp.phraseMax, v.r()) : lerp(fp.gapMin, fp.gapMax, v.r());
      if (!v.phraseOn) {
        // A full stop: every n-th phrase (or the End phrase button) pauses long.
        const every = Math.round(fp.fullStopEvery);
        if (stop || (every > 0 && ++v.phrases % every === 0)) len = Math.max(len, fp.fullStopSeconds);
        // A voice with its own part rests longer than the lead, and sits out a phrase now and then.
        else if (harmoniseWith) len = len * 1.5 + (v.r() < 0.3 ? lerp(fp.phraseMin, fp.phraseMax, v.r()) : 0);
      }
      v.segEnd = this.t + len;
      if (v.phraseOn) {
        v.phraseStart = this.t;
        v.newPhrase = true;
        this.startNote(v, p, harmoniseWith);
      }
    } else if (v.phraseOn && this.t >= v.noteEnd) this.startNote(v, p, harmoniseWith);
  }

  private startNote(v: Voice, p: Params, lead?: Voice) {
    const r = v.r;
    v.newNote = true;
    v.noteStart = this.t;
    v.noteEnd = this.t + (r() < p.fake.longNotes ? lerp(1.8, 3.5, r()) : lerp(0.22, Math.max(0.3, p.fake.noteMax), r()));
    v.intensity = clamp(0.5 + 0.5 * noise1(this.t * 0.35, 9 + v.index * 3) + (r() - 0.5) * 0.3);
    if (r() < p.fake.highNotes * 0.3) {
      v.melody = 84 + Math.floor(r() * 6); // up to F6
      v.intensity = Math.max(v.intensity, 0.8);
    } else v.melody = clamp(v.melody + Math.round((r() - 0.5) * 8), 55, 83);
    v.pitch = v.melody;
    // Another voice is singing: join it in harmony (or, the rest of the time, clash with it).
    if (lead && lead !== v && lead.phraseOn) {
      v.pitch = fit(lead.pitch + this.interval(r, p), v.melody);
      v.melody = clamp(v.pitch, 55, 83);
    }
  }

  /** An interval to the lead: consonant fake.harmony of the time. */
  private interval(r: Rng, p: Params) {
    const list = r() < clamp(p.fake.harmony) ? CONSONANT : DISSONANT;
    return list[Math.floor(r() * list.length) % list.length];
  }

  update(dt: number, p: Params): FeatureFrame {
    const fp = p.fake;
    this.syncTakes(p);
    this.syncLives(p);
    this.t += dt;
    const ids = [...this.liveIds, ...this.takeIds];
    const lives = this.liveIds.length;
    const mode = fp.voices;
    const stop = this.stopNow;
    this.stopNow = false;

    this.step(this.lead, p, stop);
    if (mode === 'independent') {
      for (let i = 1; i < ids.length; i++) this.step(this.voiceOf(ids[i], false), p, stop, this.lead);
    } else if (mode === 'duet' && (this.lead.newPhrase || !ids.some((id) => this.cast.has(id)))) {
      // Who sings this phrase: everyone, or one voice in turn.
      const r = this.duet;
      this.cast.clear();
      if (ids.length < 2 || r() < clamp(fp.together)) ids.forEach((id, i) => this.cast.set(id, i ? this.interval(r, p) : 0));
      else this.cast.set(ids[this.turn++ % ids.length], 0);
    }
    for (const id of this.voices.keys()) if (!ids.includes(id)) this.voices.delete(id);
    for (const id of this.levels.keys()) if (!ids.includes(id)) this.levels.delete(id);

    const layers: LayerFeatures[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const v = mode === 'independent' ? this.voiceOf(id, i === 0) : this.lead;
      const sings = v.phraseOn && (mode !== 'duet' || this.cast.has(id));
      const interval = mode === 'together' ? INTERVALS[i % INTERVALS.length] : mode === 'duet' ? this.cast.get(id) ?? 0 : 0;
      const age = this.t - v.noteStart;
      const noteLen = v.noteEnd - v.noteStart;
      const phraseTail = sings ? clamp((this.t - (v.segEnd - 0.8)) / 0.8) : 0;
      const env = sings
        ? Math.min(1, age / 0.04) * (0.4 + 0.5 * v.intensity) * (0.85 + 0.15 * noise1(this.t * 1.7, i + 1)) * (i === 0 ? 1 : 0.85)
        : 0;
      const prev = this.levels.get(id) ?? 0;
      const tau = env > prev ? 0.03 : 0.25;
      const level = prev + (env - prev) * (1 - Math.exp(-dt / tau));
      this.levels.set(id, level);
      layers.push({
        id,
        role: i < lives ? 'live' : 'take',
        level,
        // Voices that share a clock skip a note start now and then.
        onset: sings && v.newNote && (i === 0 || mode === 'independent' || hash1(v.noteStart * 13 + i) < 0.8),
        pitch: sings ? fit(v.pitch + interval, v.pitch) : 0,
        vibrato: sings && noteLen > 0.5 && age > 0.3 ? 0.7 : 0,
        vibratoRate: 5.5,
        effort: sings ? clamp(0.15 + 0.8 * v.intensity - 0.3 * phraseTail) : 0.5,
        breath: sings ? clamp(0.6 * (1 - v.intensity) + 0.6 * phraseTail) : 0,
        recording: i < lives ? p.fake.recording : undefined,
      });
    }
    return { time: this.t, layers };
  }
}

/** Keep a harmony note in a singable range (C3..F6) by moving it an octave toward `near`. */
function fit(midi: number, near: number) {
  while (midi > 89 || midi - near > 14) midi -= 12;
  while (midi < 48 || near - midi > 14) midi += 12;
  return midi;
}
