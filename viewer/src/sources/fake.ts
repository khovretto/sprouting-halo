// Fake singer: phrases of notes with gaps, a wandering melody up to F6, vibrato on long notes,
// soft and full notes (effort) and breathy phrase endings. Every layer sings the same phrase
// timing (layered takes of one song) at a different interval. commit()/deleteLast() simulate
// finishing a recording and deleting a take, to preview the transitions without a DAW.

import type { FeatureFrame, LayerFeatures } from '../features';
import type { Params } from '../params';
import { clamp, hash1, lerp, noise1, rng, Rng } from '../math';

const INTERVALS = [0, 4, -5, 7, -12, 3, 9, -8, 12, 5, -3, 2, 10, -7, 16, -10, 0];

export class FakeSource {
  private r: Rng = rng(1);
  private t = 0;
  private phraseOn = false;
  private phraseStart = 0;
  private segEnd = 0;
  private noteStart = 0;
  private noteEnd = 0;
  private melody = 64;
  private intensity = 0.7;
  private levels: number[] = [];
  private liveIds: string[] = [];
  private liveCount = 0;
  private takeIds: string[] = [];
  private takeCount = 0;

  constructor(seed: number) {
    this.reset(seed);
  }

  reset(seed: number) {
    this.r = rng(seed);
    this.t = 0;
    this.phraseOn = false;
    this.segEnd = 0.6;
    this.noteStart = this.noteEnd = 0;
    this.melody = 64;
    this.levels = [];
    this.liveIds = [];
    this.takeIds = [];
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

  update(dt: number, p: Params): FeatureFrame {
    const fp = p.fake;
    this.syncTakes(p);
    this.syncLives(p);
    this.t += dt;
    let newNote = false;
    if (this.t >= this.segEnd) {
      this.phraseOn = !this.phraseOn;
      this.segEnd = this.t + (this.phraseOn ? lerp(fp.phraseMin, fp.phraseMax, this.r()) : lerp(fp.gapMin, fp.gapMax, this.r()));
      if (this.phraseOn) {
        this.phraseStart = this.t;
        newNote = this.startNote(p);
      }
    } else if (this.phraseOn && this.t >= this.noteEnd) newNote = this.startNote(p);

    const layers: LayerFeatures[] = [];
    const age = this.t - this.noteStart;
    const noteLen = this.noteEnd - this.noteStart;
    const phraseTail = this.phraseOn ? clamp((this.t - (this.segEnd - 0.8)) / 0.8) : 0;
    const ids = [...this.liveIds, ...this.takeIds];
    const lives = this.liveIds.length;
    for (let i = 0; i < ids.length; i++) {
      const env = this.phraseOn
        ? Math.min(1, age / 0.04) * (0.4 + 0.5 * this.intensity) * (0.85 + 0.15 * noise1(this.t * 1.7, i + 1)) * (i === 0 ? 1 : 0.85)
        : 0;
      const prev = this.levels[i] ?? 0;
      const tau = env > prev ? 0.03 : 0.25;
      const level = prev + (env - prev) * (1 - Math.exp(-dt / tau));
      this.levels[i] = level;
      layers.push({
        id: ids[i],
        role: i < lives ? 'live' : 'take',
        level,
        onset: newNote && (i === 0 || hash1(this.noteStart * 13 + i) < 0.8),
        pitch: this.phraseOn ? this.melody + INTERVALS[i % INTERVALS.length] : 0,
        vibrato: this.phraseOn && noteLen > 0.5 && age > 0.3 ? 0.7 : 0,
        vibratoRate: 5.5,
        effort: this.phraseOn ? clamp(0.15 + 0.8 * this.intensity - 0.3 * phraseTail) : 0.5,
        breath: this.phraseOn ? clamp(0.6 * (1 - this.intensity) + 0.6 * phraseTail) : 0,
        recording: i < lives ? p.fake.recording : undefined,
      });
    }
    return { time: this.t, layers };
  }

  private startNote(p: Params) {
    const r = this.r;
    this.noteStart = this.t;
    this.noteEnd = this.t + lerp(0.22, 1.1, r());
    this.intensity = clamp(0.5 + 0.5 * noise1(this.t * 0.35, 9) + (r() - 0.5) * 0.3);
    if (r() < p.fake.highNotes * 0.3) {
      this.melody = 84 + Math.floor(r() * 6); // up to F6
      this.intensity = Math.max(this.intensity, 0.8);
    } else this.melody = clamp(this.melody + Math.round((r() - 0.5) * 8), 55, 83);
    return true;
  }
}
