// Growth over phrases for a take's plant, without ever "ungrowing".
//
// A take holds one or more *generations*: built trees, each with its own reveal (how much has
// grown) and brightness. The newest one grows while the take sings and never shrinks.
//
// - newTreeEachPhrase on: a new phrase starts a new tree on a new seed. The older tree goes the
//   way growth.onPhraseEnd says, from growth.fadeAfter seconds after it stopped growing, so a tree
//   outlives the start of the next phrase.
// - off: one tree keeps growing phrase after phrase and rests at growth.restBrightness between.
//
// Three lengths of silence act on a tree, each with its own action (plant.ts, EndAction):
// a short pause on the outer twigs (growth.onPause, `wither`), the end of the phrase on the whole
// tree (growth.onPhraseEnd), and a full stop, growth.dieAfter seconds (growth.onStop). Each is a
// switch; how the branches go is one choice for all of them (growth.witherEffect, witherFromTips).
// A look change replaces the trees the same way (transition).

import type { Drive } from '../drive';
import type { Params } from '../params';
import { endActionOf, type EndAction } from './plant';
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
  /** Replaced by a newer tree (it keeps its shape and ends on its own timer). */
  retired: boolean;
  /** Seconds since this tree last grew. */
  idle: number;
  /** 0..1 how far a pause has acted on the outer twigs (pauses, pitch dips); it recedes when the
   *  take sings again. */
  wither: number;
  /** growth.branchEachPhrase: this tree is one bough of the take's tree, over [a, b] of its tips. */
  bough?: boolean;
  range?: [number, number];
  /** A retired bough: 0..1 dried out, then 0..1 fallen. */
  dry?: number;
  fall?: number;
  /** The ending acting on the whole tree now (growth.onPhraseEnd or growth.onStop) and how far
   *  it has come: 1 after growth.fadeSeconds. A tree that is not replaced takes it back when its
   *  take sings again. */
  endAction?: EndAction;
  end?: number;
  /** 0..1 opacity left by a "fade away" ending. */
  dim?: number;
  /** A full stop ended it (growth.dieAfter): growth.onStop acts on it, and the next phrase
   *  starts a new tree. */
  ending?: boolean;
  /** Replaced by a look change: it goes by growth.witherEffect at once, whatever the switches say. */
  switching?: boolean;
  /** After a look change: grow to this reveal without waiting for the voice. */
  autoReveal?: number;
  /** Replaced by a look change: the look it keeps until it is gone (main.ts TreeLook). */
  look?: unknown;
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

  constructor(private make: (seed: number, slice: [number, number, number] | null) => T, firstSeed: number) {
    this.nextSeed = firstSeed;
    // Where the first bough grows comes from the seed too (a restart starts somewhere else).
    this.phrase = Math.abs(Math.round(firstSeed)) % 97;
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
    let slice: [number, number, number] | null = null;
    if (each) {
      const j = ORDER[M][this.phrase++ % M];
      let a = j / M, b = (j + 1) / M;
      // growth.fillSpace: the bough also reaches into the empty space beside its slice (up to one
      // more slice on each side), as far as the nearest living bough; where a living bough has
      // already reached into its slice, it gives that part up (at least half a slice stays).
      const fill = clamp(g.fillSpace ?? 0, 0, 1);
      if (fill > 0) {
        const living = this.gens.filter((x) => x.bough && !x.retired && x.range).map((x) => x.range!);
        const a0 = a, b0 = b;
        for (const [oa, ob] of living) {
          if (oa <= a + 1e-9 && ob > a) a = Math.min(Math.max(a, ob), a0 + 0.5 / M); // covers its start
          if (ob >= b - 1e-9 && oa < b) b = Math.max(Math.min(b, oa), b0 - 0.5 / M); // covers its end
        }
        if (b - a < 0.5 / M) {
          a = a0;
          b = b0;
        }
        let left = a, right = 1 - b;
        for (const [oa, ob] of living) {
          if (ob <= a + 1e-9) left = Math.min(left, a - ob);
          else if (oa >= b - 1e-9) right = Math.min(right, oa - b);
          else {
            // still overlapping (a bough inside this slice): no widening on that side
            if (oa <= a + 1e-9) left = 0;
            if (ob >= b - 1e-9) right = 0;
          }
        }
        a -= fill * Math.min(Math.max(0, left), 1 / M);
        b += fill * Math.min(Math.max(0, right), 1 / M);
      }
      slice = [a, b, M];
    }
    const seed = this.nextSeed++;
    const tree = this.make(seed, slice);
    // look.woodStays: the tree is there in full at once.
    if (p.look.woodStays) (tree as unknown as { instant?: boolean }).instant = true;
    this.gens.push({ tree, seed, reveal: p.look.woodStays ? 1 : 0, alpha: 1, retired: false, idle: 0, wither: 0,
      bough: !!slice, range: slice ? [slice[0], slice[1]] : undefined, dry: 0, fall: 0 });
    const cap = Math.max(MAX_GENERATIONS, 2 * keep + 3);
    while (this.gens.length > cap) this.gens.shift();
  }

  /**
   * The trees' shape settings changed (a Look preset, a slider, the layout): the living trees are
   * not rebuilt in place. They go the way growth.witherEffect says, at once, and new ones grow back
   * to where they were without waiting for the voice (and keep their phrase's timing, so they end
   * when those would have). A tree already ending just ends.
   */
  transition(p: Params, look?: unknown) {
    // Every tree still on its way out keeps the look it had too (main.ts draws it so).
    if (look !== undefined) for (const x of this.gens) if (x.retired) x.look ??= look;
    const living = this.gens.filter((x) => !x.retired);
    if (!living.length) return;
    // What each tree was growing to: a tree still growing back from an earlier change counts at
    // its target, so quick changes in a row do not shrink the tree.
    const size = (x: Generation<T>) => Math.max(x.reveal, x.autoReveal ?? 0);
    const whole = living.filter((x) => (x.end ?? 0) <= 0 && size(x) > 0.03);
    const idle = whole.reduce((m, x) => Math.min(m, x.idle), Infinity);
    const wither = whole.reduce((m, x) => Math.max(m, x.wither), 0);
    for (const x of living) {
      x.retired = true;
      x.switching = true;
      x.look ??= look; // it keeps the look it had (main.ts draws it so)
    }
    if (!whole.length) return;
    // One new tree for each one replaced, oldest first, each growing back to the size its old one
    // had (boughs too: a take with two boughs gets two back, not branchesKept full ones).
    const each = p.growth.branchEachPhrase && !p.look.woodStays;
    const olds = each ? whole.filter((x) => x.bough).slice(-Math.max(1, Math.round(p.growth.branchesKept))) : [whole[whole.length - 1]];
    const list = olds.length ? olds : [whole[whole.length - 1]];
    for (const old of list) {
      this.regrow(p);
      const cur = this.current!;
      // It grows back, even where the wood stays (it would appear at once).
      (cur.tree as unknown as { instant?: boolean }).instant = false;
      cur.reveal = 0;
      cur.autoReveal = size(old);
      cur.idle = Number.isFinite(idle) ? idle : 0;
      cur.wither = wither; // in a pause, its outer twigs stay withered too
    }
  }

  update(d: Drive, dt: number, p: Params) {
    const g = p.growth;
    const stays = p.look.woodStays;
    if (d.voice) {
      if (!this.current) this.regrow(p);
      else if (stays) {
        // one tree for good: phrases do not replace it
      }
      // A new bough only when the current one is at least half grown (a short phrase keeps growing it).
      else if (d.newPhrase && (g.branchEachPhrase ? this.current.reveal > 0.5 : g.newTreeEachPhrase && this.current.reveal > 0.05)) this.regrow(p);
      // Its ending took all of it away: the phrase starts a new tree.
      else if (d.newPhrase && !this.current.bough && (this.current.end ?? 0) >= 1) this.regrow(p);
    }

    const cur = this.current;
    if (cur && d.voice) {
      // A bough is a fraction of a tree, so it grows faster.
      const M = clamp(Math.round(g.branchesKept) + 1, 3, 7);
      const k = cur.bough ? clamp(M / 2, 1.5, 3) : 1;
      cur.reveal = Math.min(1, cur.reveal + ((k * dt) / Math.max(0.05, g.secondsToFull)) * (0.4 + d.level));
      cur.idle = 0;
      // Singing again takes an ending back (the tree regrows, or brightens again).
      cur.end = 0;
      cur.endAction = 'keep';
    }
    // After a look change: grow back to where the replaced trees were, singing or not.
    for (const x of this.gens)
      if (!x.retired && x.autoReveal !== undefined && x.reveal < x.autoReveal)
        x.reveal = Math.min(x.autoReveal, x.reveal + dt / Math.max(0.3, g.secondsToFull * 0.5));
    // Pauses act on the outer twigs gradually (growth.onPause); a pitch dip at once. Singing lets
    // them grow back. The living boughs of "new branch each phrase" are one tree: all of them (an
    // older bough used to keep the twigs a pause had taken, and looked half dead).
    for (const x of this.gens) {
      if (x !== cur && !(x.bough && !x.retired)) continue;
      if (g.onPause && !d.voice && d.silentFor > 0.12) x.wither = Math.min(1, x.wither + dt / Math.max(0.05, g.witherSeconds));
      if (g.witherOnPitchDip && d.pitchDip) x.wither = Math.min(1, x.wither + 0.6);
      if (d.voice) x.wither = Math.max(0, x.wither - dt / 1.2);
    }

    // A full stop (a long silence) ends every tree by growth.onStop; the next phrase starts a new one.
    if (g.dieAfter > 0 && g.onStop && !stays && !d.voice && d.silentFor > g.dieAfter)
      for (const x of this.gens)
        if (!x.ending) {
          x.retired = true;
          x.ending = true;
        }

    const fade = Math.max(0.05, g.fadeSeconds);
    // The phrase end acts on a tree growth.fadeAfter seconds after it last grew (its take stopped
    // singing), and never before the phrase is over. Until then it stays whole, so with a new tree
    // per phrase the old one stands next to the new one for a while.
    const phraseOver = Math.max(0, p.response.phraseGap, g.fadeAfter);
    // Old boughs fade where they are only with "fade, all at once"; otherwise they dry, droop and fall.
    const boughsFade = g.witherEffect === 'fade' && !g.witherFromTips;
    const dropping = this.gens.filter((x) => x.bough && x.retired && !x.ending && !x.switching).length;
    for (const gen of this.gens) {
      const growing = gen === cur && d.voice;
      if (!growing) gen.idle += dt;
      if (gen.bough && gen.retired && !gen.switching) {
        if (boughsFade) {
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
      // Brightness: full while its take is in a phrase, resting between.
      const lit = gen.bough ? d.voice || !d.phraseOver(p) : growing || (gen === cur && !d.phraseOver(p));
      const target = lit ? 1 : g.restBrightness;
      gen.alpha += (target - gen.alpha) * (1 - Math.exp(-dt / (target > gen.alpha ? 0.08 : Math.max(0.05, p.response.release))));
      if (gen.bough && !gen.switching) continue; // living boughs are one tree: no ending of their own

      // Which ending acts on it: a look change's at once; the full stop's, or the phrase end's once
      // its phrase is over. A replaced tree has to go, whatever the switches say.
      let act: EndAction = 'keep';
      if (gen.switching) act = endActionOf(g, true);
      else if (!growing && !(stays && gen === cur)) {
        if (gen.ending) act = endActionOf(g, g.onStop);
        else if (gen.idle > phraseOver) act = endActionOf(g, g.onPhraseEnd);
        if (act === 'keep' && gen.retired && gen.idle > phraseOver) act = endActionOf(g, true);
      }
      if (act !== 'keep') {
        // Another ending takes over (the full stop after the phrase end): it starts from the beginning.
        if (gen.endAction !== act && gen.endAction !== undefined && gen.endAction !== 'keep') gen.end = 0;
        gen.endAction = act;
        gen.end = Math.min(4, (gen.end ?? 0) + dt / fade);
      }
      const e = gen.end ?? 0;
      const dimTo = gen.endAction === 'fade' ? Math.max(0, 1 - e) : 1;
      gen.dim = dimTo < (gen.dim ?? 1) ? dimTo : Math.min(dimTo, (gen.dim ?? 1) + dt / 0.3);
      if (gen.retired && e > 0) {
        // Gone: it withered back to nothing, faded out, or its last pieces fell.
        const a = gen.endAction;
        const gone = a === 'ungrow' ? !gen.tree.vis.length || gen.tree.vis[0] <= 0 || e >= 1.6
          : a === 'fade' ? e >= 1
          : a === 'fadeTips' ? e >= 1.02
          : a === 'fall' ? e * fade >= 2.2
          : e >= 1 + 2.2 / fade;
        if (gone) gen.alpha = 0;
      }
    }
    this.gens = this.gens.filter((gen) => gen.alpha > 0);
  }
}
