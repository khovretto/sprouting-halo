// Growth over phrases for a take's plant, without ever "ungrowing".
//
// A take holds one or more *generations*: built trees, each with its own reveal (how much has
// grown) and brightness. The newest one grows while the take sings and never shrinks.
//
// - newTreeEachPhrase on: a new phrase starts a new tree on a new seed. Older trees are left alone
//   and only start fading growth.fadeAfter seconds after they stopped growing, so a tree outlives
//   the start of the next phrase.
// - off: one tree keeps growing phrase after phrase and rests at growth.restBrightness between.

import type { Drive } from '../drive';
import type { Params } from '../params';
import type { Skeleton } from './skeleton';

export interface Structure {
  sk: Skeleton;
  vis: Float32Array;
}

export interface Generation<T extends Structure> {
  tree: T;
  seed: number;
  /** 0..1 grown (monotonic). */
  reveal: number;
  /** 0..1 brightness / opacity. */
  alpha: number;
  /** Replaced by a newer tree (it keeps its shape and fades on its own timer). */
  retired: boolean;
  /** Seconds since this tree last grew. */
  idle: number;
  /** 0..1 how far the outer twigs have withered (pauses, pitch dips); they regrow as it falls. */
  wither: number;
  /** Planted by the commit animation: it does not fade while idle, and the take's first phrase
   *  keeps growing it instead of starting a new tree. */
  stamped?: boolean;
  /** growth.branchEachPhrase: this tree is one bough of the take's tree. */
  bough?: boolean;
  /** A retired bough: 0..1 dried out, then 0..1 fallen. */
  dry?: number;
  fall?: number;
  /** Ending (growth.ending): 0..1 how far it has withered back to the root. */
  die?: number;
  /** Ending now (a long silence ended the whole tree), without waiting for growth.fadeAfter. */
  ending?: boolean;
}

const MAX_GENERATIONS = 5;
/** Which slice of the territory phrase n grows into, for M slices: the middle first, then far jumps
 *  (neighbours are of different ages). One more slice than boughs kept, so the next is empty. */
const ORDER: Record<number, number[]> = {
  3: [1, 0, 2], 4: [1, 3, 0, 2], 5: [2, 0, 4, 1, 3], 6: [2, 5, 0, 3, 1, 4], 7: [3, 0, 5, 2, 6, 1, 4],
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class Generations<T extends Structure> {
  gens: Generation<T>[] = [];
  private nextSeed: number;
  private phrase = 0;

  constructor(private make: (seed: number, slice: [number, number] | null) => T, firstSeed: number) {
    this.nextSeed = firstSeed;
  }

  get current(): Generation<T> | undefined {
    for (let i = this.gens.length - 1; i >= 0; i--) if (!this.gens[i].retired) return this.gens[i];
    return undefined;
  }

  /** Start a new tree now (new seed); older ones are retired but not cut short. */
  regrow(p: Params) {
    const g = p.growth, keep = Math.max(1, Math.round(g.branchesKept));
    const each = g.branchEachPhrase && !p.look.woodStays;
    if (!each) for (const x of this.gens) x.retired = true;
    else {
      // The oldest living boughs start to wither, so at most `keep` stay with the new one.
      const alive = this.gens.filter((x) => !x.retired);
      while (alive.length >= keep) alive.shift()!.retired = true;
    }
    const M = clamp(keep + 1, 3, 7);
    const slice = each ? ([ORDER[M][this.phrase++ % M], M] as [number, number]) : null;
    const seed = this.nextSeed++;
    const tree = this.make(seed, slice);
    // look.woodStays: the tree is there in full at once.
    if (p.look.woodStays) (tree as unknown as { instant?: boolean }).instant = true;
    this.gens.push({ tree, seed, reveal: p.look.woodStays ? 1 : 0, alpha: 1, retired: false, idle: 0, wither: 0,
      bough: !!slice, dry: 0, fall: 0 });
    const cap = Math.max(MAX_GENERATIONS, keep + 3);
    while (this.gens.length > cap) this.gens.shift();
  }

  update(d: Drive, dt: number, p: Params) {
    const g = p.growth;
    const stays = p.look.woodStays;
    if (d.voice) {
      if (!this.current) this.regrow(p);
      else if (stays) this.current.stamped = false; // one tree for good: phrases do not replace it
      else if (this.current.stamped) this.current.stamped = false; // the first phrase grows the planted tree
      // A new bough only when the current one is at least half grown (a short phrase keeps growing it).
      else if (d.newPhrase && (g.branchEachPhrase ? this.current.reveal > 0.5 : g.newTreeEachPhrase && this.current.reveal > 0.05)) this.regrow(p);
    }

    const cur = this.current;
    if (cur && d.voice) {
      // A bough is a fraction of a tree, so it grows faster.
      const M = clamp(Math.round(g.branchesKept) + 1, 3, 7);
      const k = cur.bough ? clamp(M / 2, 1.5, 3) : 1;
      cur.reveal = Math.min(1, cur.reveal + ((k * dt) / Math.max(0.05, g.secondsToFull)) * (0.4 + d.level));
      cur.idle = 0;
    }
    if (cur) {
      // Pauses wither the outer twigs gradually; a pitch dip withers some at once. Singing lets
      // them grow back.
      if (g.witherOnPause && !d.voice && d.silentFor > 0.12) cur.wither = Math.min(1, cur.wither + dt / Math.max(0.05, g.witherSeconds));
      if (g.witherOnPitchDip && d.pitchDip) cur.wither = Math.min(1, cur.wither + 0.6);
      if (d.voice) cur.wither = Math.max(0, cur.wither - dt / 1.2);
    }

    // A long silence ends the whole tree (trunk, limbs and all); the next phrase starts a new one.
    // Trees planted by the commit animation wait for their first phrase instead.
    if (g.dieAfter > 0 && !stays && !d.voice && d.silentFor > g.dieAfter)
      for (const x of this.gens)
        if (!x.stamped && !x.ending) {
          x.retired = true;
          x.ending = true;
        }

    const fadeAfter = Math.max(0, g.fadeAfter);
    const fade = Math.max(0.05, g.fadeSeconds);
    const ending = g.ending ?? 'wither';
    const dropping = this.gens.filter((x) => x.bough && x.retired && !x.ending).length;
    for (const gen of this.gens) {
      const growing = gen === cur && d.voice;
      if (!growing) gen.idle += dt;
      if (gen.bough && gen.retired) {
        if (ending === 'fade') {
          gen.alpha -= dt / fade; // fades where it is
          continue;
        }
        // A retired bough dries, then falls (faster when phrases come faster than boughs fall).
        const hurry = dropping > 2 && !gen.ending ? 3 : 1;
        if ((gen.dry ?? 0) < 1) gen.dry = Math.min(1, (gen.dry ?? 0) + (hurry * dt) / Math.max(0.05, g.branchWitherSeconds));
        else gen.fall = Math.min(1, (gen.fall ?? 0) + (hurry * dt) / Math.max(0.05, g.branchFallSeconds));
        if ((gen.fall ?? 0) >= 1) gen.alpha = 0; // removed by the filter below
        continue;
      }
      if (gen.bough) {
        // Living boughs are one tree: bright while the take is in a phrase, never fading.
        const target = d.voice || !d.phraseOver(p) ? 1 : g.restBrightness;
        gen.alpha += (target - gen.alpha) * (1 - Math.exp(-dt / (target > gen.alpha ? 0.08 : Math.max(0.05, p.response.release))));
        continue;
      }
      const canFade = (g.newTreeEachPhrase || gen.retired) && !gen.stamped && !(stays && gen === cur);
      if (gen.stamped) gen.alpha = Math.max(gen.alpha, g.restBrightness);
      else if (gen.ending || (canFade && gen.idle > fadeAfter)) {
        // Ending: wither back to the root (computeReveal), fade, or both.
        if (ending !== 'fade') {
          gen.die = (gen.die ?? 0) + dt / fade; // > 1: a safety margin past the planned time
          const gone = !gen.tree.vis.length || gen.tree.vis[0] <= 0;
          if (gone || gen.die >= 1.6) gen.alpha = 0;
          // Withering alone keeps it lit, dimming toward rest, until the last of it is gone.
          if (ending === 'wither') gen.alpha = gone ? 0 : Math.max(0.01, gen.alpha - (dt / fade) * Math.max(0, gen.alpha - g.restBrightness));
        }
        if (ending !== 'wither') gen.alpha -= dt / fade;
      } else {
        const target = growing || (gen === cur && !d.phraseOver(p)) ? 1 : g.restBrightness;
        gen.alpha += (target - gen.alpha) * (1 - Math.exp(-dt / (target > gen.alpha ? 0.08 : Math.max(0.05, p.response.release))));
      }
    }
    this.gens = this.gens.filter((gen) => gen.alpha > 0);
  }
}
