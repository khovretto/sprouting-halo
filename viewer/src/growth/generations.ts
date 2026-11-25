// Growth over phrases for a take's plant, without ever "ungrowing".
//
// A take holds one or more *generations*: built trees, each with its own reveal (how much has
// grown) and brightness. The newest one grows while the take sings and never shrinks.
//
// - newTreeEachPhrase on: a new phrase starts a new tree on a new seed. The older tree goes the
//   way growth.onPhraseEnd says, from growth.fadeAfter seconds after its phrase ended.
// - off: one tree keeps growing phrase after phrase and rests at growth.restBrightness between.
//
// Three lengths of silence act on a tree, each with its own action (plant.ts, EndAction):
// a short pause on the outer twigs (growth.onPause, `wither`), the end of the phrase on the whole
// tree (growth.onPhraseEnd), and a full stop, growth.dieAfter seconds (growth.onStop).

import type { Drive } from '../drive';
import type { Params } from '../params';
import type { EndAction } from './plant';
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
  /** Planted by the commit animation: it does not end while idle, and the take's first phrase
   *  keeps growing it instead of starting a new tree. */
  stamped?: boolean;
  /** growth.branchEachPhrase: this tree is one bough of the take's tree. */
  bough?: boolean;
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
    if (cur) {
      // Pauses act on the outer twigs gradually (growth.onPause); a pitch dip at once. Singing
      // lets them grow back.
      if (g.onPause !== 'keep' && !d.voice && d.silentFor > 0.12) cur.wither = Math.min(1, cur.wither + dt / Math.max(0.05, g.witherSeconds));
      if (g.witherOnPitchDip && d.pitchDip) cur.wither = Math.min(1, cur.wither + 0.6);
      if (d.voice) cur.wither = Math.max(0, cur.wither - dt / 1.2);
    }

    // A full stop (a long silence) ends every tree by growth.onStop; the next phrase starts a new
    // one. Trees planted by the commit animation wait for their first phrase instead.
    if (g.dieAfter > 0 && g.onStop !== 'keep' && !stays && !d.voice && d.silentFor > g.dieAfter)
      for (const x of this.gens)
        if (!x.stamped && !x.ending) {
          x.retired = true;
          x.ending = true;
        }

    const fade = Math.max(0.05, g.fadeSeconds);
    // The phrase is over for a tree once it has not grown for this long.
    const phraseOver = Math.max(0, p.response.phraseGap) + Math.max(0, g.fadeAfter);
    const boughsFade = g.onPhraseEnd === 'fade';
    const dropping = this.gens.filter((x) => x.bough && x.retired && !x.ending).length;
    for (const gen of this.gens) {
      const growing = gen === cur && d.voice;
      if (!growing) gen.idle += dt;
      if (gen.bough && gen.retired) {
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
      if (gen.stamped) gen.alpha = Math.max(gen.alpha, g.restBrightness);
      else gen.alpha += (target - gen.alpha) * (1 - Math.exp(-dt / (target > gen.alpha ? 0.08 : Math.max(0.05, p.response.release))));
      if (gen.bough) continue; // living boughs are one tree: no ending of their own

      // Which ending acts on it: the full stop's, or the phrase end's once its phrase is over. A
      // replaced tree has to go: it takes the other ending if this one keeps it, else it fades.
      let act: EndAction = 'keep';
      if (!gen.stamped && !growing && !(stays && gen === cur)) {
        if (gen.ending) act = g.onStop;
        else if (gen.idle > phraseOver) act = g.onPhraseEnd;
        if (act === 'keep' && gen.retired && gen.idle > phraseOver)
          act = g.onPhraseEnd !== 'keep' ? g.onPhraseEnd : g.onStop !== 'keep' ? g.onStop : 'fade';
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
