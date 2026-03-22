/**
 * Main application — orchestrates PDF loading, page navigation, and instruction visualization.
 */

import { PdfManager, type PageInfo } from './pdf-manager';
import { getOpInfo, getCategoryColor, getCategoryLabel } from './operator-info';
import type { ContentStreamOp } from './content-stream';

const THUMB_HEIGHT = 140;

class App {
  private pdf = new PdfManager();
  private currentPage = 0;
  private currentOp = 0;
  private totalOps = 0;
  private pageInfo: PageInfo | null = null;
  private isPlaying = false;
  private playTimer: number | null = null;
  private playSpeed = 150; // ms per frame
  private renderPending = false;
  private isRendering = false;
  private wantedOp = -1;      // the op the user wants rendered
  private lastRenderedOp = -1; // the op currently shown

  // DOM Elements
  private dropZone!: HTMLElement;
  private appMain!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private thumbContainer!: HTMLElement;
  private seekerSlider!: HTMLInputElement;
  private seekerLabel!: HTMLElement;
  private opDisplay!: HTMLElement;
  private opList!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private speedSelect!: HTMLSelectElement;
  private stepBackBtn!: HTMLButtonElement;
  private stepFwdBtn!: HTMLButtonElement;
  private pageCounter!: HTMLElement;
  private pagePrevBtn!: HTMLButtonElement;
  private pageNextBtn!: HTMLButtonElement;
  private loadingOverlay!: HTMLElement;

  constructor() {
    this.initDOM();
    this.bindEvents();
  }

  private initDOM() {
    this.dropZone = document.getElementById('drop-zone')!;
    this.appMain = document.getElementById('app-main')!;
    this.fileInput = document.getElementById('file-input') as HTMLInputElement;
    this.canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.thumbContainer = document.getElementById('thumb-container')!;
    this.seekerSlider = document.getElementById('seeker-slider') as HTMLInputElement;
    this.seekerLabel = document.getElementById('seeker-label')!;
    this.opDisplay = document.getElementById('op-display')!;
    this.opList = document.getElementById('op-list')!;
    this.playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    this.speedSelect = document.getElementById('speed-select') as HTMLSelectElement;
    this.stepBackBtn = document.getElementById('step-back') as HTMLButtonElement;
    this.stepFwdBtn = document.getElementById('step-fwd') as HTMLButtonElement;
    this.pagePrevBtn = document.getElementById('page-prev') as HTMLButtonElement;
    this.pageNextBtn = document.getElementById('page-next') as HTMLButtonElement;
    this.pageCounter = document.getElementById('page-counter')!;
    this.loadingOverlay = document.getElementById('loading-overlay')!;
  }

  private bindEvents() {
    // File inputs (both the initial drop zone one and the in-app one)
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) this.loadFile(file);
    });

    const fileInput2 = document.getElementById('file-input-2') as HTMLInputElement;
    fileInput2?.addEventListener('change', () => {
      const file = fileInput2.files?.[0];
      if (file) this.loadFile(file);
    });

    // Drag and drop
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file && file.type === 'application/pdf') {
        this.loadFile(file);
      }
    });

    // Also support drop on the whole app when a PDF is loaded
    document.addEventListener('dragover', (e) => {
      if (this.appMain.style.display !== 'none') {
        e.preventDefault();
      }
    });
    document.addEventListener('drop', (e) => {
      if (this.appMain.style.display !== 'none') {
        e.preventDefault();
        const file = e.dataTransfer?.files[0];
        if (file && file.type === 'application/pdf') {
          this.loadFile(file);
        }
      }
    });

    // Page navigation (mobile)
    this.pagePrevBtn.addEventListener('click', () => {
      if (this.currentPage > 0) this.selectPage(this.currentPage - 1);
    });
    this.pageNextBtn.addEventListener('click', () => {
      if (this.currentPage < this.pdf.numPages - 1) this.selectPage(this.currentPage + 1);
    });

    // Seeker
    this.seekerSlider.addEventListener('input', () => {
      this.currentOp = parseInt(this.seekerSlider.value, 10);
      this.updateOpDisplay();
      this.scheduleRender();
    });

    // Controls
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.stepBackBtn.addEventListener('click', () => this.step(-1));
    this.stepFwdBtn.addEventListener('click', () => this.step(1));
    this.speedSelect.addEventListener('change', () => {
      this.playSpeed = parseInt(this.speedSelect.value, 10);
      if (this.isPlaying) {
        this.stopPlay();
        this.startPlay();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.pageInfo) return;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          this.step(e.shiftKey ? 10 : 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.step(e.shiftKey ? -10 : -1);
          break;
        case ' ':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'Home':
          e.preventDefault();
          this.seekTo(0);
          break;
        case 'End':
          e.preventDefault();
          this.seekTo(this.totalOps);
          break;
      }
    });
  }

  private showLoading(show: boolean) {
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
  }

  private async loadFile(file: File) {
    this.showLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const numPages = await this.pdf.load(buffer);

      // Switch to main UI
      this.dropZone.style.display = 'none';
      this.appMain.style.display = 'grid';

      // Build thumbnails
      await this.buildThumbnails(numPages);

      // Select first page
      await this.selectPage(0);
    } catch (e) {
      console.error('Failed to load PDF:', e);
      alert('Failed to load PDF. Make sure it\'s a valid PDF file.');
    } finally {
      this.showLoading(false);
    }
  }

  private async buildThumbnails(numPages: number) {
    this.thumbContainer.innerHTML = '';

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
      this.thumbContainer.appendChild(item);

      item.addEventListener('click', () => this.selectPage(i));

      // Render thumbnail (async, don't await to speed up load)
      this.renderThumbnail(i, thumbCanvas);
    }
  }

  private async renderThumbnail(pageIndex: number, canvas: HTMLCanvasElement) {
    try {
      const bitmap = await this.pdf.renderThumbnail(pageIndex, THUMB_HEIGHT);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
    } catch (e) {
      console.error(`Failed to render thumbnail for page ${pageIndex}:`, e);
    }
  }

  private async selectPage(pageIndex: number) {
    this.stopPlay();
    this.currentPage = pageIndex;
    this.showLoading(true);

    // Highlight selected thumbnail
    this.thumbContainer.querySelectorAll('.thumb-item').forEach((el, i) => {
      el.classList.toggle('active', i === pageIndex);
    });

    try {
      this.pageInfo = await this.pdf.getPageInfo(pageIndex);
      this.totalOps = this.pageInfo.ops.length;
      this.currentOp = this.totalOps; // Start showing full page

      // Update slider
      this.seekerSlider.max = String(this.totalOps);
      this.seekerSlider.value = String(this.currentOp);

      this.pageCounter.textContent = `Page ${pageIndex + 1} / ${this.pdf.numPages}`;
      this.pagePrevBtn.disabled = pageIndex === 0;
      this.pageNextBtn.disabled = pageIndex >= this.pdf.numPages - 1;

      // Build operator list
      this.buildOpList();
      this.updateOpDisplay();

      // Render
      this.wantedOp = this.currentOp;
      this.lastRenderedOp = -1;
      await this.doRender();
    } catch (e) {
      console.error('Failed to select page:', e);
    } finally {
      this.showLoading(false);
    }
  }

  private buildOpList() {
    this.opList.innerHTML = '';
    if (!this.pageInfo) return;

    for (let i = 0; i < this.pageInfo.ops.length; i++) {
      const op = this.pageInfo.ops[i];
      const info = getOpInfo(op.operator);
      const el = document.createElement('div');
      el.className = 'op-list-item';
      el.dataset.index = String(i + 1);

      const badge = document.createElement('span');
      badge.className = 'op-badge';
      badge.style.backgroundColor = getCategoryColor(info.category);
      badge.textContent = getCategoryLabel(info.category);

      const opText = document.createElement('span');
      opText.className = 'op-text';
      opText.textContent = this.formatOpShort(op);

      const num = document.createElement('span');
      num.className = 'op-num';
      num.textContent = String(i + 1);

      el.appendChild(num);
      el.appendChild(badge);
      el.appendChild(opText);
      this.opList.appendChild(el);

      el.addEventListener('click', () => this.seekTo(i + 1));
    }
  }

  private formatOpShort(op: ContentStreamOp): string {
    const parts = op.operands.slice(0, 4);
    const operandStr = parts.join(' ');
    const truncated = operandStr.length > 30
      ? operandStr.substring(0, 27) + '...'
      : operandStr;
    return truncated ? `${truncated} ${op.operator}` : op.operator;
  }

  private updateOpDisplay() {
    if (!this.pageInfo) return;

    this.seekerLabel.textContent = `${this.currentOp} / ${this.totalOps}`;
    this.seekerSlider.value = String(this.currentOp);

    // Update current operator info
    if (this.currentOp === 0) {
      this.opDisplay.innerHTML = `
        <div class="op-current">
          <span class="op-current-label">Ready</span>
          <span class="op-current-desc">No operators executed</span>
        </div>
      `;
    } else {
      const op = this.pageInfo.ops[this.currentOp - 1];
      const info = getOpInfo(op.operator);
      this.opDisplay.innerHTML = `
        <div class="op-current">
          <span class="op-badge" style="background-color: ${getCategoryColor(info.category)}">${getCategoryLabel(info.category)}</span>
          <code class="op-current-code">${this.escapeHtml(op.raw)}</code>
          <span class="op-current-desc">${info.description}</span>
        </div>
      `;
    }

    // Highlight in op list
    this.opList.querySelectorAll('.op-list-item').forEach((el) => {
      const idx = parseInt((el as HTMLElement).dataset.index!, 10);
      el.classList.toggle('active', idx === this.currentOp);
      el.classList.toggle('past', idx < this.currentOp);
    });

    // Scroll active item into view
    const activeItem = this.opList.querySelector('.op-list-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private scheduleRender() {
    this.wantedOp = this.currentOp;
    if (this.isRendering) return; // will pick up wantedOp when current render finishes
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.doRender();
    });
  }

  private async doRender() {
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
        this.currentPage,
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

      this.lastRenderedOp = opToRender;
    } catch (e) {
      console.error('Render error:', e);
    } finally {
      this.isRendering = false;
    }

    // If the user moved while we were rendering, render the latest wanted position
    if (this.wantedOp !== this.lastRenderedOp) {
      this.doRender();
    }
  }

  private seekTo(op: number) {
    this.currentOp = Math.max(0, Math.min(op, this.totalOps));
    this.updateOpDisplay();
    this.scheduleRender();
  }

  private step(delta: number) {
    this.seekTo(this.currentOp + delta);
  }

  private togglePlay() {
    if (this.isPlaying) {
      this.stopPlay();
    } else {
      this.startPlay();
    }
  }

  private startPlay() {
    if (this.currentOp >= this.totalOps) {
      this.currentOp = 0; // Reset to beginning
    }
    this.isPlaying = true;
    this.playBtn.textContent = '⏸';
    this.playBtn.title = 'Pause (Space)';
    this.playTick();
  }

  private stopPlay() {
    this.isPlaying = false;
    this.playBtn.textContent = '▶';
    this.playBtn.title = 'Play (Space)';
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  private playTick() {
    if (!this.isPlaying) return;

    this.currentOp++;
    if (this.currentOp > this.totalOps) {
      this.stopPlay();
      this.currentOp = this.totalOps;
      this.updateOpDisplay();
      return;
    }

    this.updateOpDisplay();
    this.wantedOp = this.currentOp;
    this.doRender().then(() => {
      if (this.isPlaying) {
        this.playTimer = window.setTimeout(() => this.playTick(), this.playSpeed);
      }
    });
  }
}

// Initialize
new App();
