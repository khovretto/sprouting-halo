// Preview-only drawing on top of the halo: a placeholder avatar silhouette (what VTube Studio
// will cover in OBS) and optional guides for the canopy outline, the plants' territories and keep-out region.
// Hidden in OBS mode (?obs).

import type { Params } from './params';
import type { View } from './render/renderer';
import { outlineOf, Placement, rOutAt } from './layout';

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

  /** Your own avatar picture (preview only), drawn instead of the grey shape. */
  image: HTMLImageElement | null = null;

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

    if (p.scene.showAvatar && p.avatar.useImage && this.image) {
      const img = this.image;
      const h = a.imageHeight * view.s, w = (h * img.naturalWidth) / Math.max(1, img.naturalHeight);
      ctx.globalAlpha = a.opacity;
      ctx.drawImage(img, px(a.imageX) - w / 2, py(a.imageY) - h / 2, w, h);
      ctx.globalAlpha = 1;
    } else if (p.scene.showAvatar) {
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

      // The shared canopy outline and each plant's territory (rays from the hub).
      const o = outlineOf(p);
      const hx = a.headX, hy = p.layout.midOriginY;
      for (const g of plants) {
        const lo = g.pl.sectorLo + g.extraAngle, hi = g.pl.sectorHi + g.extraAngle;
        const sc = g.pl.scale * (g.pl.lengthMul ?? 1);
        const N = 48;
        ctx.strokeStyle = g.colour;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(px(hx), py(hy));
        for (let i = 0; i <= N; i++) {
          const phi = lo + ((hi - lo) * i) / N;
          const r = rOutAt(phi - g.extraAngle, o) * sc;
          ctx.lineTo(px(hx + Math.cos(phi) * r), py(hy + Math.sin(phi) * r));
        }
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
