/**
 * Thumbnail sidebar — builds, renders, and manages page thumbnails.
 */

import type { PdfManager } from '../pdf-manager';

const THUMB_HEIGHT = 140;

export class ThumbnailSidebar {
  private container: HTMLElement;
  onPageSelect: ((pageIndex: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async build(pdf: PdfManager, numPages: number): Promise<void> {
    this.container.innerHTML = '';

    for (let i = 0; i < numPages; i++) {
      const item = document.createElement('button');
      item.className = 'thumb-item';
      item.dataset.page = String(i);

      const thumbCanvas = document.createElement('canvas');
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = String(i + 1);

      item.appendChild(thumbCanvas);
      item.appendChild(label);
      this.container.appendChild(item);

      item.addEventListener('click', () => this.onPageSelect?.(i));

      this.renderThumbnail(pdf, i, thumbCanvas);
    }
  }

  setActive(pageIndex: number): void {
    this.container.querySelectorAll('.thumb-item').forEach((el, i) => {
      el.classList.toggle('active', i === pageIndex);
    });
  }

  private async renderThumbnail(pdf: PdfManager, pageIndex: number, canvas: HTMLCanvasElement): Promise<void> {
    try {
      const bitmap = await pdf.renderThumbnail(pageIndex, THUMB_HEIGHT);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
    } catch (e) {
      console.error(`Failed to render thumbnail for page ${pageIndex}:`, e);
    }
  }
}
