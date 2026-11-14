// Preview-only drawing on top of the halo: a placeholder avatar silhouette (what VTube Studio
// will cover in OBS) and optional guides for the layout envelopes and keep-out region.
// Hidden in OBS mode (?obs).

import type { Params } from './params';
import type { View } from './render/renderer';
import { envelopePoint, Placement, toWorld } from './layout';

export interface GuidePlant {
  pl: Placement;
  extraAngle: number;
  colour: string;
}

export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private sil = document.createElement('canvas');
  private silCtx = this.sil.getContext('2d')!;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(view: View, p: Params, plants: GuidePlant[]) {
    const { ctx, canvas } = this;
    if (canvas.width !== view.W || canvas.height !== view.H) {
      canvas.width = view.W;
      canvas.height = view.H;
    }
    ctx.clearRect(0, 0, view.W, view.H);
    const px = (x: number) => (x - view.cx) * view.s + view.W / 2;
    const py = (y: number) => view.H / 2 - (y - view.cy) * view.s;
    const a = p.avatar;

    if (p.scene.showAvatar) {
      // See-through placeholder: drawn solid on its own canvas, then blended once at the chosen
      // opacity (no darker seams where head, ears and body overlap).
      const full = ctx;
      if (this.sil.width !== view.W || this.sil.height !== view.H) {
        this.sil.width = view.W;
        this.sil.height = view.H;
      }
      const ctx2 = this.silCtx;
      ctx2.clearRect(0, 0, view.W, view.H);
      ctx2.fillStyle = '#9a9a9a';
      ctx2.beginPath();
      // Body: capsule from bodyTopY down past the bottom of the frame.
      ctx2.arc(px(0), py(a.bodyTopY), a.bodyR * view.s, Math.PI, 0);
      ctx2.lineTo(px(a.bodyR), py(a.bodyBottomY));
      ctx2.lineTo(px(-a.bodyR), py(a.bodyBottomY));
      ctx2.closePath();
      ctx2.fill();
      // Head and ears.
      ctx2.beginPath();
      ctx2.arc(px(a.headX), py(a.headY), a.headR * view.s, 0, Math.PI * 2);
      ctx2.fill();
      for (const side of [-1, 1]) {
        ctx2.beginPath();
        ctx2.ellipse(px(a.headX + side * a.headR * 0.95), py(a.headY - a.headR * 0.05),
          a.headR * 0.45 * view.s, a.headR * 0.17 * view.s, side * -0.25, 0, Math.PI * 2);
        ctx2.fill();
      }
      full.globalAlpha = a.opacity;
      full.drawImage(this.sil, 0, 0);
      full.globalAlpha = 1;
    }

    if (p.scene.showGuides) {
      ctx.lineWidth = Math.max(1, view.s * 0.004);
      // Keep-out region.
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#ff5c5c';
      ctx.beginPath();
      ctx.arc(px(a.headX), py(a.headY), a.headR * view.s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px(0), py(a.bodyTopY), a.bodyR * view.s, Math.PI, 0);
      ctx.moveTo(px(a.bodyR), py(a.bodyTopY));
      ctx.lineTo(px(a.bodyR), py(a.bodyBottomY));
      ctx.moveTo(px(-a.bodyR), py(a.bodyTopY));
      ctx.lineTo(px(-a.bodyR), py(a.bodyBottomY));
      ctx.stroke();
      ctx.setLineDash([]);

      // Envelopes and origins.
      for (const g0 of plants) {
        // The gesture generator has no envelope: show its fan (spine length and feather spread).
        const g = p.plants.generator === 'gesture'
          ? { ...g0, pl: { ...g0.pl, rMin: 0, taper: 0, bend: 0, length: g0.pl.length * (g0.pl.lengthMul ?? 1) } }
          : g0;
        const pts: [number, number][] = [];
        const N = 24;
        for (let i = 0; i <= N; i++) pts.push(envelopePoint(i / N, -1, g.pl));
        for (let i = 0; i <= N; i++) pts.push(envelopePoint(1, -1 + (2 * i) / N, g.pl));
        for (let i = N; i >= 0; i--) pts.push(envelopePoint(i / N, 1, g.pl));
        for (let i = N; i >= 0; i--) pts.push(envelopePoint(0, -1 + (2 * i) / N, g.pl));
        ctx.strokeStyle = g.colour;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        pts.forEach(([lx, ly], i) => {
          const [wx, wy] = toWorld(lx, ly, g.pl, g.extraAngle);
          if (i === 0) ctx.moveTo(px(wx), py(wy));
          else ctx.lineTo(px(wx), py(wy));
        });
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = g.colour;
        ctx.beginPath();
        ctx.arc(px(g.pl.ox), py(g.pl.oy), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
