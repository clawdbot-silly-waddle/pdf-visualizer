/**
 * Main application — orchestrates PDF loading, page navigation, and instruction visualization.
 */

import { PdfManager, type PageInfo } from './pdf-manager';
import { Renderer } from './renderer';
import { Playback } from './ui/playback';
import { OpListPanel } from './ui/op-list';
import { OpDisplay } from './ui/op-display';
import { ThumbnailSidebar } from './ui/thumbnails';
import { SettingsPanel } from './ui/settings';
import { INERT_OPS } from './inert-ops';

class App {
  private pdf = new PdfManager();
  private currentPage = 0;
  private currentOp = 0;
  private totalOps = 0;
  private pageInfo: PageInfo | null = null;
  private skipInertOps = false;

  // Modules
  private renderer!: Renderer;
  private playback = new Playback();
  private opList!: OpListPanel;
  private opDisplay!: OpDisplay;
  private thumbnails!: ThumbnailSidebar;
  private settingsPanel!: SettingsPanel;

  // DOM Elements (only those managed directly by App)
  private dropZone!: HTMLElement;
  private appMain!: HTMLElement;
  private fileInput!: HTMLInputElement;
  private seekerSlider!: HTMLInputElement;
  private seekerLabel!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private pageCounter!: HTMLElement;
  private pagePrevBtn!: HTMLButtonElement;
  private pageNextBtn!: HTMLButtonElement;
  private loadingOverlay!: HTMLElement;

  constructor() {
    this.initModules();
    this.bindEvents();
  }

  private initModules() {
    this.dropZone = document.getElementById('drop-zone')!;
    this.appMain = document.getElementById('app-main')!;
    this.fileInput = document.getElementById('file-input') as HTMLInputElement;
    this.seekerSlider = document.getElementById('seeker-slider') as HTMLInputElement;
    this.seekerLabel = document.getElementById('seeker-label')!;
    this.playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    this.pagePrevBtn = document.getElementById('page-prev') as HTMLButtonElement;
    this.pageNextBtn = document.getElementById('page-next') as HTMLButtonElement;
    this.pageCounter = document.getElementById('page-counter')!;
    this.loadingOverlay = document.getElementById('loading-overlay')!;

    const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas, this.pdf);

    this.opList = new OpListPanel(document.getElementById('op-list')!);
    this.opList.onSeek = (opIndex) => this.seekTo(opIndex);

    this.opDisplay = new OpDisplay(document.getElementById('op-display')!);

    this.thumbnails = new ThumbnailSidebar(document.getElementById('thumb-container')!);
    this.thumbnails.onPageSelect = (i) => this.selectPage(i);

    this.settingsPanel = new SettingsPanel(document.getElementById('controls')!);
    this.settingsPanel.onChange = (s) => {
      this.renderer.overlayEnabled = s.overlayEnabled;
      this.renderer.stateOverlayEnabled = s.stateOverlayEnabled;
      this.renderer.customDpr = s.renderScale;
      this.skipInertOps = s.skipInertOps;
      this.pdf.clearRenderCache();
      this.renderer.invalidate();
    };

    // Apply persisted settings
    const saved = this.settingsPanel.settings;
    this.renderer.overlayEnabled = saved.overlayEnabled;
    this.renderer.stateOverlayEnabled = saved.stateOverlayEnabled;
    this.renderer.customDpr = saved.renderScale;
    this.skipInertOps = saved.skipInertOps;

    this.playback.onTick = () => this.playTick();
    this.playback.onStateChange = (playing) => {
      this.playBtn.innerHTML = playing
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
      this.playBtn.title = playing ? 'Pause (Space)' : 'Play (Space)';
    };
  }

  private bindEvents() {
    // File inputs
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
      if (file && file.type === 'application/pdf') this.loadFile(file);
    });

    document.addEventListener('dragover', (e) => {
      if (this.appMain.style.display !== 'none') e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (this.appMain.style.display !== 'none') {
        e.preventDefault();
        const file = e.dataTransfer?.files[0];
        if (file && file.type === 'application/pdf') this.loadFile(file);
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

      // Snap to nearest visual op when skip is enabled
      if (this.skipInertOps && this.pageInfo && this.currentOp > 0 && this.currentOp < this.totalOps) {
        const ops = this.pageInfo.ops;
        while (this.currentOp < this.totalOps && INERT_OPS.has(ops[this.currentOp - 1]?.operator)) {
          this.currentOp++;
        }
      }

      this.updateDisplay();
      this.renderer.scheduleRender(this.currentOp);
    });

    // Controls
    this.playBtn.addEventListener('click', () => this.togglePlay());

    document.getElementById('step-back')!.addEventListener('click', () => this.step(-1));
    document.getElementById('step-fwd')!.addEventListener('click', () => this.step(1));

    const speedSelect = document.getElementById('speed-select') as HTMLSelectElement;
    speedSelect.addEventListener('change', () => {
      this.playback.setSpeed(parseInt(speedSelect.value, 10));
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

      this.dropZone.style.display = 'none';
      this.appMain.style.display = 'grid';

      await this.thumbnails.build(this.pdf, numPages);
      await this.selectPage(0);
    } catch (e) {
      console.error('Failed to load PDF:', e);
      alert('Failed to load PDF. Make sure it\'s a valid PDF file.');
    } finally {
      this.showLoading(false);
    }
  }

  private async selectPage(pageIndex: number) {
    this.playback.stop();
    this.currentPage = pageIndex;
    this.showLoading(true);

    this.thumbnails.setActive(pageIndex);

    try {
      this.pageInfo = await this.pdf.getPageInfo(pageIndex);
      this.totalOps = this.pageInfo.ops.length;
      this.currentOp = this.totalOps;

      this.seekerSlider.max = String(this.totalOps);
      this.seekerSlider.value = String(this.currentOp);

      this.pageCounter.textContent = `Page ${pageIndex + 1} / ${this.pdf.numPages}`;
      this.pagePrevBtn.disabled = pageIndex === 0;
      this.pageNextBtn.disabled = pageIndex >= this.pdf.numPages - 1;

      this.opList.build(this.pageInfo.ops);
      this.updateDisplay();

      this.renderer.setPage(pageIndex, this.pageInfo);
      await this.renderer.renderImmediate(this.currentOp);
    } catch (e) {
      console.error('Failed to select page:', e);
    } finally {
      this.showLoading(false);
    }
  }

  private updateDisplay() {
    if (!this.pageInfo) return;
    this.seekerLabel.textContent = `${this.currentOp} / ${this.totalOps}`;
    this.seekerSlider.value = String(this.currentOp);
    this.opDisplay.update(this.pageInfo.ops, this.currentOp);
    this.opList.highlight(this.currentOp);
  }

  private seekTo(op: number) {
    this.currentOp = Math.max(0, Math.min(op, this.totalOps));
    this.updateDisplay();
    this.renderer.scheduleRender(this.currentOp);
  }

  private step(delta: number) {
    if (!this.skipInertOps || !this.pageInfo) {
      this.seekTo(this.currentOp + delta);
      return;
    }

    // Skip over inert ops to the next visual op
    const ops = this.pageInfo.ops;
    let target = this.currentOp + delta;
    if (delta > 0) {
      while (target <= this.totalOps && target > 0 && INERT_OPS.has(ops[target - 1]?.operator)) {
        target++;
      }
    } else {
      while (target > 0 && INERT_OPS.has(ops[target - 1]?.operator)) {
        target--;
      }
    }
    this.seekTo(target);
  }

  private togglePlay() {
    if (!this.playback.playing && this.currentOp >= this.totalOps) {
      this.currentOp = 0;
    }
    this.playback.toggle();
  }

  private async playTick(): Promise<void> {
    this.currentOp++;

    // Skip inert ops during playback
    if (this.skipInertOps && this.pageInfo) {
      const ops = this.pageInfo.ops;
      while (this.currentOp <= this.totalOps && this.currentOp > 0 && INERT_OPS.has(ops[this.currentOp - 1]?.operator)) {
        this.currentOp++;
      }
    }

    if (this.currentOp > this.totalOps) {
      this.playback.stop();
      this.currentOp = this.totalOps;
      this.updateDisplay();
      return;
    }
    this.updateDisplay();
    this.renderer.scheduleRender(this.currentOp);
  }
}

new App();
