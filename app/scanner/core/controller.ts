import type { Analysis, Quad } from '../vision/types';
export type ScanState = 'stopped' | 'seeking' | 'tracking' | 'stabilizing' | 'capturing' | 'wait-clear' | 'paused' | 'error';
export type ScannerConfig = { stableMs:number; clearMs:number; maxCornerMotion:number; minSamples:number };
export const DEFAULT_SCANNER_CONFIG: ScannerConfig = { stableMs:900, clearMs:1200, maxCornerMotion:0.018, minSamples:4 };
type Input = Pick<Analysis, 'presence' | 'quality' | 'width' | 'height'> & { quad?:Quad|null; pageQuad?:Quad; frameId?:number }; 

export interface ScanDecision {
  state: ScanState;
  collect: boolean;
  capture: boolean;
  resetCandidate: boolean;
  message: string;
  cycleId: string;
}

const newCycle = () => globalThis.crypto?.randomUUID?.() ?? `cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Pure timing/state policy. Bitmap ownership and network activity belong to callers. */
export class ScanController {
  readonly config: ScannerConfig;
  state: ScanState = 'stopped';
  cycleId = newCycle();
  private locked = false;
  private stableSince: number | null = null;
  private clearSince: number | null = null;
  private samples = 0;
  private previous: Quad | null = null;
  private anchor: Quad | null = null;
  private lastNow = -Infinity;
  private lastFrame = -1;
  private message = 'Камера остановлена';

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_SCANNER_CONFIG, ...config };
    if (this.config.stableMs < 0 || this.config.clearMs < 0 || this.config.minSamples < 1 || this.config.maxCornerMotion <= 0) {
      throw new Error('Некорректная конфигурация сканера');
    }
  }

  snapshot(): ScanDecision {
    return { state: this.state, collect: false, capture: false, resetCandidate: false, message: this.message, cycleId: this.cycleId };
  }

  private resetCollection() {
    this.stableSince = null;
    this.samples = 0;
    this.previous = null;
    this.anchor = null;
  }

  start(requireClear = false) {
    this.locked ||= requireClear;
    this.resetCollection();
    this.clearSince = null;
    this.lastNow = -Infinity;
    this.lastFrame = -1;
    this.state = this.locked ? 'wait-clear' : 'seeking';
    this.message = this.locked ? 'Уберите предыдущий лист из кадра' : 'Поместите бланк под камеру';
    return this.snapshot();
  }

  pause() {
    if (this.state === 'stopped') return this.snapshot();
    this.state = 'paused';
    this.resetCollection();
    this.clearSince = null;
    this.message = 'Сканирование приостановлено';
    return this.snapshot();
  }

  resume() { return this.start(); }

  stop() {
    // Keep the physical-sheet latch: Stop/Start must not resend the same sheet.
    this.state = 'stopped';
    this.resetCollection();
    this.clearSince = null;
    this.message = 'Камера остановлена';
    return this.snapshot();
  }

  reset(requireClear = true) {
    this.locked = requireClear;
    this.cycleId = newCycle();
    return this.start(requireClear);
  }

  completeCapture() {
    this.locked = true;
    if (this.state !== 'paused' && this.state !== 'stopped') this.state = 'wait-clear';
    this.clearSince = null;
    this.resetCollection();
    this.message = 'Страница сохранена. Уберите лист из кадра';
    return this.snapshot();
  }

  failCapture(message = 'Не удалось сохранить страницу. Держите лист неподвижно') {
    this.locked = false;
    if (this.state !== 'paused' && this.state !== 'stopped') this.state = 'tracking';
    this.resetCollection();
    this.message = message;
    return this.snapshot();
  }

  update(d: Input, now: number, canCapture = true): ScanDecision {
    let collect = false, capture = false, resetCandidate = false;
    const result = (): ScanDecision => ({ ...this.snapshot(), collect, capture, resetCandidate });
    if (['stopped', 'paused', 'error', 'capturing'].includes(this.state)) return result();
    if (!Number.isFinite(now) || now < this.lastNow || (d.frameId !== undefined && d.frameId <= this.lastFrame)) return result();
    this.lastNow = now;
    if (d.frameId !== undefined) this.lastFrame = d.frameId;

    if (this.locked) {
      this.state = 'wait-clear';
      this.message = 'Уберите лист из кадра';
      if (d.presence === 'absent') {
        this.clearSince ??= now;
        if (now - this.clearSince >= this.config.clearMs) {
          this.locked = false;
          this.clearSince = null;
          this.resetCollection();
          this.cycleId = newCycle();
          this.state = 'seeking';
          this.message = 'Готов к следующему листу';
          resetCandidate = true;
        }
      } else {
        // A lost/covered marker is never proof that the sheet has left.
        this.clearSince = null;
      }
      return result();
    }

    if (!canCapture) {
      this.state = 'tracking';
      this.resetCollection();
      resetCandidate = true;
      this.message = 'Очередь заполнена. Дождитесь отправки или удалите сохранённые страницы';
      return result();
    }

    const quad = d.quad ?? d.pageQuad;
    if (d.presence !== 'full' || !quad || !d.quality.eligible) {
      this.resetCollection();
      resetCandidate = true;
      this.state = d.presence === 'absent' ? 'seeking' : 'tracking';
      this.message = d.presence === 'absent' ? 'Поместите бланк под камеру'
        : d.quality.reasons[0] ?? (d.presence === 'partial' ? 'Покажите все четыре маркера' : 'Не удалось уверенно найти бланк');
      return result();
    }

    const scale = Math.max(1, Math.hypot(d.width, d.height));
    const distance = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) / scale));
    const moved = this.previous && (distance(quad, this.previous) > this.config.maxCornerMotion
      || (this.anchor !== null && distance(quad, this.anchor) > this.config.maxCornerMotion * 1.5));
    if (this.stableSince === null || moved) {
      this.stableSince = now;
      this.samples = 0;
      this.anchor = quad.map(p => ({ ...p })) as Quad;
      resetCandidate = true;
    }
    this.previous = quad.map(p => ({ ...p })) as Quad;
    this.samples++;
    collect = true;
    this.state = 'stabilizing';
    this.message = 'Держите лист неподвижно';
    if (now - this.stableSince >= this.config.stableMs && this.samples >= this.config.minSamples) {
      this.state = 'capturing';
      // Latch immediately, including while encoding/persistence is in flight.
      this.locked = true;
      this.message = 'Выбираю и выравниваю лучший кадр';
      capture = true;
    }
    return result();
  }
}
