/**
 * Renderer — manages canvas sizing, DPR-aware rendering, and render scheduling.
 * Draws the pdfjs-rendered bitmap, then overlays in-progress paths as wireframes.
 */

import type { PdfManager, PageInfo } from './pdf-manager';
import type { ContentStreamOp } from './content-stream';
import { computeOverlayAt, drawOverlay } from './path-overlay';
import { computeStateAt, drawStateOverlay } from './state-overlay';
import { INERT_OPS } from './inert-ops';
import { opAtLinear } from './op-path';

/**
 * Find the op index that produces the same pdfjs bitmap as opIndex.
 * Walks backward through the tree to find the last visual (non-inert) op.
 */
function findEffectiveBitmapOp(ops: ContentStreamOp[], opIndex: number, totalOps: number): number {
  for (let i = Math.min(opIndex, totalOps); i >= 1; i--) {
    const op = opAtLinear(ops, i);
    if (op && !INERT_OPS.has(op.operator)) return i;
  }
  return 0;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pdf: PdfManager;
  private isRendering = false;
  private renderPending = false;
  private wantedOp = -1;
  private lastRenderedOp = -1;
  private settingsGen = 0;
  private lastRenderedGen = 0;

  private currentPageIndex = -1;
  private pageInfo: PageInfo | null = null;
  private cachedBitmap: ImageBitmap | null = null;
  private cachedBitmapEffOp = -1;
  private cachedBitmapScale = -1;

  overlayEnabled = true;
  stateOverlayEnabled = false;
  customDpr: number | 'auto' = 'auto';

  constructor(canvas: HTMLCanvasElement, pdf: PdfManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.pdf = pdf;
  }

  setPage(pageIndex: number, pageInfo: PageInfo): void {
    this.currentPageIndex = pageIndex;
    this.pageInfo = pageInfo;
    this.wantedOp = -1;
    this.lastRenderedOp = -1;
    this.cachedBitmap = null;
    this.cachedBitmapEffOp = -1;
    this.cachedBitmapScale = -1;
  }

  /** Force a re-render even if the op index hasn't changed (e.g. after settings change). */
  invalidate(): void {
    this.settingsGen++;
    this.cachedBitmap = null;
    this.cachedBitmapEffOp = -1;
    this.cachedBitmapScale = -1;
    this.scheduleRender(this.wantedOp);
  }

  scheduleRender(opIndex: number): void {
    this.wantedOp = opIndex;
    if (this.isRendering || this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.doRender();
    });
  }

  async renderImmediate(opIndex: number): Promise<void> {
    this.wantedOp = opIndex;
    this.lastRenderedOp = -1;
    await this.doRender();
  }

  private getDpr(): number {
    if (this.customDpr === 'auto') return window.devicePixelRatio || 1;
    return this.customDpr;
  }

  private async doRender(): Promise<void> {
    if (!this.pageInfo) return;
    if (this.isRendering) return;

    const opToRender = this.wantedOp;
    const gen = this.settingsGen;
    if (opToRender === this.lastRenderedOp && gen === this.lastRenderedGen) return;

    this.isRendering = true;

    try {
      const dpr = this.getDpr();
      const container = this.canvas.parentElement!;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      const pageAspect = this.pageInfo.width / this.pageInfo.height;
      const containerAspect = containerWidth / containerHeight;
      let cssWidth: number, cssHeight: number;
      if (pageAspect > containerAspect) {
        cssWidth = containerWidth;
        cssHeight = containerWidth / pageAspect;
      } else {
        cssHeight = containerHeight;
        cssWidth = containerHeight * pageAspect;
      }

      const renderScale = (cssWidth * dpr) / this.pageInfo.width;
      const scale = Math.max(renderScale, 1);

      // Skip pdfjs re-render if only inert ops changed since last bitmap
      const effOp = findEffectiveBitmapOp(this.pageInfo.ops, opToRender, this.pageInfo.totalOps);
      let bitmap: ImageBitmap;
      if (this.cachedBitmap && effOp === this.cachedBitmapEffOp && scale === this.cachedBitmapScale) {
        bitmap = this.cachedBitmap;
      } else {
        bitmap = await this.pdf.renderPartial(this.currentPageIndex, effOp, scale);
        this.cachedBitmap = bitmap;
        this.cachedBitmapEffOp = effOp;
        this.cachedBitmapScale = scale;
      }

      this.canvas.width = Math.ceil(cssWidth * dpr);
      this.canvas.height = Math.ceil(cssHeight * dpr);
      this.canvas.style.width = `${Math.ceil(cssWidth)}px`;
      this.canvas.style.height = `${Math.ceil(cssHeight)}px`;

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);

      // Draw path overlay if enabled and there's an in-progress path
      if (this.overlayEnabled) {
        const overlay = computeOverlayAt(this.pageInfo.ops, opToRender);
        if (overlay) {
          drawOverlay(
            this.ctx,
            overlay,
            this.pageInfo.width,
            this.pageInfo.height,
            this.canvas.width,
            this.canvas.height,
            dpr,
          );
        }
      }

      // Draw state visualization overlay (CTM axes, current point, clip areas)
      if (this.stateOverlayEnabled) {
        const state = computeStateAt(this.pageInfo.ops, opToRender);
        drawStateOverlay(
          this.ctx,
          state,
          this.pageInfo.width,
          this.pageInfo.height,
          this.canvas.width,
          this.canvas.height,
          dpr,
        );
      }

      this.lastRenderedOp = opToRender;
      this.lastRenderedGen = gen;
    } catch (e) {
      console.error('Render error:', e);
    } finally {
      this.isRendering = false;
    }

    if (this.wantedOp !== this.lastRenderedOp || this.settingsGen !== this.lastRenderedGen) {
      this.doRender();
    }
  }
}
