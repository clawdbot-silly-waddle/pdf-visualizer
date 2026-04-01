/**
 * Renderer — manages canvas sizing, DPR-aware rendering, and render scheduling.
 * Draws the pdfjs-rendered bitmap, then overlays in-progress paths as wireframes.
 */

import type { PdfManager, PageInfo } from './pdf-manager';
import { computeOverlayAt, drawOverlay } from './path-overlay';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pdf: PdfManager;
  private isRendering = false;
  private renderPending = false;
  private wantedOp = -1;
  private lastRenderedOp = -1;

  private currentPageIndex = -1;
  private pageInfo: PageInfo | null = null;

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

  private async doRender(): Promise<void> {
    if (!this.pageInfo) return;
    if (this.isRendering) return;

    const opToRender = this.wantedOp;
    if (opToRender === this.lastRenderedOp) return;

    this.isRendering = true;

    try {
      const dpr = window.devicePixelRatio || 1;
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

      const bitmap = await this.pdf.renderPartial(
        this.currentPageIndex,
        opToRender,
        Math.max(renderScale, 1),
      );

      this.canvas.width = Math.ceil(cssWidth * dpr);
      this.canvas.height = Math.ceil(cssHeight * dpr);
      this.canvas.style.width = `${Math.ceil(cssWidth)}px`;
      this.canvas.style.height = `${Math.ceil(cssHeight)}px`;

      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);

      // Draw path overlay if there's an in-progress path
      const overlay = computeOverlayAt(this.pageInfo.ops, opToRender);
      if (overlay) {
        drawOverlay(
          this.ctx,
          overlay,
          this.pageInfo.width,
          this.pageInfo.height,
          this.canvas.width,
          this.canvas.height,
        );
      }

      this.lastRenderedOp = opToRender;
    } catch (e) {
      console.error('Render error:', e);
    } finally {
      this.isRendering = false;
    }

    if (this.wantedOp !== this.lastRenderedOp) {
      this.doRender();
    }
  }
}
