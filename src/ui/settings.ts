/**
 * Settings panel — gear icon that opens a popup with app settings.
 * Currently: path overlay toggle and render scale selector.
 */

export interface Settings {
  overlayEnabled: boolean;
  stateOverlayEnabled: boolean;
  skipInertOps: boolean;
  renderScale: number | 'auto';
}

const SCALE_OPTIONS: { label: string; value: number | 'auto' }[] = [
  { label: 'Auto (device)', value: 'auto' },
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2 },
  { label: '3×', value: 3 },
  { label: '10×', value: 10 },
];

export class SettingsPanel {
  private btn: HTMLButtonElement;
  private panel: HTMLDivElement;
  private open = false;

  onChange: ((settings: Settings) => void) | null = null;

  private _settings: Settings = {
    overlayEnabled: true,
    stateOverlayEnabled: false,
    skipInertOps: false,
    renderScale: 'auto',
  };

  get settings(): Settings {
    return { ...this._settings };
  }

  constructor(container: HTMLElement) {
    // Gear button
    this.btn = document.createElement('button');
    this.btn.className = 'settings-btn';
    this.btn.title = 'Settings';
    this.btn.innerHTML = '⚙';
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    container.appendChild(this.btn);

    // Settings popup panel
    this.panel = document.createElement('div');
    this.panel.className = 'settings-panel';
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    this.buildPanel();
    container.appendChild(this.panel);

    // Close on outside click
    document.addEventListener('click', () => {
      if (this.open) this.toggle();
    });
  }

  private toggle() {
    this.open = !this.open;
    this.panel.classList.toggle('open', this.open);
    this.btn.classList.toggle('active', this.open);
  }

  private buildPanel() {
    this.panel.innerHTML = '';

    // Path overlay toggle
    const overlayRow = document.createElement('label');
    overlayRow.className = 'settings-row';

    const overlayLabel = document.createElement('span');
    overlayLabel.textContent = 'Path overlay';
    overlayRow.appendChild(overlayLabel);

    const overlayToggle = document.createElement('input');
    overlayToggle.type = 'checkbox';
    overlayToggle.className = 'settings-toggle';
    overlayToggle.checked = this._settings.overlayEnabled;
    overlayToggle.addEventListener('change', () => {
      this._settings.overlayEnabled = overlayToggle.checked;
      this.emitChange();
    });
    overlayRow.appendChild(overlayToggle);
    this.panel.appendChild(overlayRow);

    // State debug overlay toggle
    const stateRow = document.createElement('label');
    stateRow.className = 'settings-row';

    const stateLabel = document.createElement('span');
    stateLabel.textContent = 'Show state';
    stateRow.appendChild(stateLabel);

    const stateToggle = document.createElement('input');
    stateToggle.type = 'checkbox';
    stateToggle.className = 'settings-toggle';
    stateToggle.checked = this._settings.stateOverlayEnabled;
    stateToggle.addEventListener('change', () => {
      this._settings.stateOverlayEnabled = stateToggle.checked;
      this.emitChange();
    });
    stateRow.appendChild(stateToggle);
    this.panel.appendChild(stateRow);

    // Skip inert ops toggle
    const skipRow = document.createElement('label');
    skipRow.className = 'settings-row';

    const skipLabel = document.createElement('span');
    skipLabel.textContent = 'Visual ops only';
    skipRow.appendChild(skipLabel);

    const skipToggle = document.createElement('input');
    skipToggle.type = 'checkbox';
    skipToggle.className = 'settings-toggle';
    skipToggle.checked = this._settings.skipInertOps;
    skipToggle.addEventListener('change', () => {
      this._settings.skipInertOps = skipToggle.checked;
      // Disable path overlay when skipping inert ops (path overlay needs path construction ops)
      overlayToggle.disabled = skipToggle.checked;
      overlayRow.classList.toggle('disabled', skipToggle.checked);
      if (skipToggle.checked) {
        this._settings.overlayEnabled = false;
        overlayToggle.checked = false;
      }
      this.emitChange();
    });
    skipRow.appendChild(skipToggle);
    this.panel.appendChild(skipRow);

    // Render scale dropdown
    const scaleRow = document.createElement('label');
    scaleRow.className = 'settings-row';

    const scaleLabel = document.createElement('span');
    scaleLabel.textContent = 'Render scale';
    scaleRow.appendChild(scaleLabel);

    const scaleSelect = document.createElement('select');
    scaleSelect.className = 'settings-select';
    for (const opt of SCALE_OPTIONS) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      if (opt.value === this._settings.renderScale) option.selected = true;
      scaleSelect.appendChild(option);
    }
    scaleSelect.addEventListener('change', () => {
      const val = scaleSelect.value;
      this._settings.renderScale = val === 'auto' ? 'auto' : parseFloat(val);
      this.emitChange();
    });
    scaleRow.appendChild(scaleSelect);
    this.panel.appendChild(scaleRow);
  }

  private emitChange() {
    this.onChange?.(this.settings);
  }
}
