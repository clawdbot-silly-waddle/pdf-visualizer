/**
 * Playback engine — manages play/pause/step timing and speed control.
 */

export class Playback {
  private _playing = false;
  private timer: number | null = null;
  private _speed = 150;

  onTick: (() => Promise<void>) | null = null;
  onStateChange: ((playing: boolean) => void) | null = null;

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  setSpeed(ms: number): void {
    this._speed = ms;
    // Takes effect on the next scheduled tick automatically.
  }

  toggle(): void {
    if (this._playing) {
      this.stop();
    } else {
      this.start();
    }
  }

  start(): void {
    this._playing = true;
    this.onStateChange?.(true);
    this.tick();
  }

  stop(): void {
    this._playing = false;
    this.cancelTimer();
    this.onStateChange?.(false);
  }

  private tick(): void {
    if (!this._playing || !this.onTick) return;
    this.onTick().then(() => {
      if (this._playing) this.scheduleNext();
    });
  }

  private scheduleNext(): void {
    this.timer = window.setTimeout(() => this.tick(), this._speed);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
