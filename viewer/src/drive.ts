// Per-layer "drive": turns raw features into the values the visuals respond to.
// Phrase detection (voice, silence, new phrase), a phrase envelope `open` (rises while singing,
// settles after the phrase; opens the halo), and fast values: energy, flash, effort, pitch.
// Growth itself (how much of a tree is revealed) lives in growth/generations.ts and only ever
// moves forward.

import type { LayerFeatures } from './features';
import type { Params } from './params';
import { clamp, damp, pitchNorm } from './math';

export class Drive {
  /** 0..1 phrase envelope: rises while singing, settles after the phrase. */
  open = 0;
  /** Fast loudness 0..1. */
  energy = 0;
  /** Slow loudness 0..1 (sway). */
  slow = 0;
  /** Onset flash 0..1. */
  flash = 0;
  /** Smoothed effort 0..1 and breathiness 0..1. */
  effort = 0.5;
  breath = 0;
  /** Last voiced pitch, 0..1 over C3..F6 (held through gaps). */
  pitch = 0;
  vibrato = 0;
  vibratoRate = 5.5;
  /** Seconds the current note has been held (same pitch within a semitone, no pause). */
  held = 0;
  /** 0..1 blossoms open: rises once a note is held longer than look.blossomHold, closes after it. */
  bloom = 0;
  /** 0..1 in harmony with another track (set by the app from harmony.ts). */
  harmony = 0;
  private noteRef = 0;
  /** A note started this frame. */
  onset = false;
  /** Singing right now. */
  voice = false;
  level = 0;
  /** True on the frame a new phrase starts (after a gap). */
  newPhrase = false;
  /** Seconds since the voice stopped. */
  silentFor = 10;
  /** True on the frame the pitch drops by growth.witherDipSemitones or more. */
  pitchDip = false;
  private lastMidi = 0; // recent peak pitch
  private dipLatched = false;

  reset() {
    this.open = this.energy = this.slow = this.flash = this.breath = this.vibrato = this.level = 0;
    this.effort = 0.5;
    this.silentFor = 10;
    this.voice = false;
  }

  /** The current phrase has ended (silence longer than the phrase gap). */
  phraseOver(p: Params) {
    return this.silentFor > p.response.phraseGap;
  }

  update(f: LayerFeatures | undefined, dt: number, p: Params) {
    const r = p.response;
    const level = f?.level ?? 0;
    this.level = level;
    this.voice = level > 0.05;
    this.newPhrase = false;
    this.pitchDip = false;
    // Pitch dip: the pitch falls well below its recent peak (a note step or a slide down).
    if (f && f.pitch > 0) {
      if (this.lastMidi <= 0 || f.pitch > this.lastMidi) this.lastMidi = f.pitch;
      else this.lastMidi += (f.pitch - this.lastMidi) * (1 - Math.exp(-dt / 0.35));
      const drop = this.lastMidi - f.pitch;
      if (!this.dipLatched && drop >= p.growth.witherDipSemitones) {
        this.pitchDip = true;
        this.dipLatched = true;
      } else if (drop < p.growth.witherDipSemitones * 0.4) this.dipLatched = false;
    } else if (this.silentFor > 1) this.lastMidi = 0;

    if (this.voice) {
      if (this.silentFor > r.phraseGap) this.newPhrase = true;
      this.silentFor = 0;
      this.open = Math.min(1, this.open + (dt / Math.max(0.05, p.growth.secondsToFull * 0.5)) * (0.4 + level));
    } else {
      this.silentFor += dt;
      if (this.silentFor > r.phraseGap) this.open *= Math.exp(-dt / Math.max(0.05, r.release));
    }

    this.energy = damp(this.energy, level, level > this.energy ? 30 : 6, dt);
    this.slow = damp(this.slow, level, 1.0, dt);
    this.onset = !!f?.onset;
    // Held note: keeps counting while singing within a semitone of where the note settled
    // (vibrato swings less); a pitch jump, a new note start or a pause starts over.
    const midi = f?.pitch ?? 0;
    if (!this.voice) {
      this.held = 0;
      this.noteRef = 0;
    } else if (midi > 0) {
      if (this.noteRef <= 0 || Math.abs(midi - this.noteRef) > 1 || (f?.onset && this.held > 0.25)) {
        this.held = 0;
        this.noteRef = midi;
      } else this.noteRef += (midi - this.noteRef) * (1 - Math.exp(-dt / 0.3)); // follow slow drift
      this.held += dt;
    } else this.held += dt; // a moment without pitch inside a note
    const hold = Math.max(0, p.look.blossomHold);
    const open = this.held >= hold ? 1 : 0;
    this.bloom += (open - this.bloom) * (1 - Math.exp(-dt / (open > this.bloom ? 0.25 : 0.7)));
    this.flash = f?.onset ? 1 : this.flash * Math.exp(-dt / 0.25);
    this.effort = damp(this.effort, f?.effort ?? 0.5, 6, dt);
    this.breath = damp(this.breath, f?.breath ?? 0, 6, dt);
    if (f && f.pitch > 0) this.pitch = damp(this.pitch, pitchNorm(f.pitch), 10, dt);
    this.vibrato = damp(this.vibrato, f?.vibrato ?? 0, 8, dt);
    if (f?.vibratoRate) this.vibratoRate = f.vibratoRate;
  }

  /** Soft singing 0..1 (quiet effort, breathy). */
  get softness() {
    return clamp(0.7 * (1 - this.effort) + 0.3 * this.breath);
  }
}
