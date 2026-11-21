import { ref, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue';
import { ScanController, type ScanState } from '../scanner/core/controller';
import { UploadQueue, type CaptureRecord, type UploadSettings } from '../scanner/core/uploadQueue';
import { createVisionClient, REFERENCE_TEMPLATE, type VisionClient } from '../scanner/vision/client';
import type { Analysis, SheetTemplate, QrPayload } from '../scanner/vision/types';
import type { CameraHandle } from './useCamera';
import { readScannerLatch, writeScannerLatch } from '../scanner/core/latch';

interface ScannerOptions {
  settings: () => UploadSettings;
  captureContext?: () => { ownerId?: number; batchId?: string; scanSessionId?: string };
  latchKey?: () => string;
  onCapture?: (record: CaptureRecord) => void;
}
const LATCH_KEY = 'proveryator-scanner:page-latched';

export function useScanner(camera: CameraHandle, options: ScannerOptions) {
  const controller = new ScanController();
  const queue = new UploadQueue(options.settings(), { accepts: record => {
    const context = options.captureContext?.();
    return (!context?.ownerId || record.metadata.ownerId === context.ownerId) && (!context?.scanSessionId || record.metadata.scanSessionId === context.scanSessionId);
  } });
  const analysis = shallowRef<Analysis | null>(null);
  const state = ref<ScanState>('stopped');
  const message = ref('Подключите камеру');
  const error = ref('');
  const qr = shallowRef<QrPayload | null>(null);
  const qrIssue = ref('');
  const busy = ref(false);
  const running = ref(false);
  const records = shallowRef<CaptureRecord[]>([]);
  const template = shallowRef<SheetTemplate>(REFERENCE_TEMPLATE);
  let vision: VisionClient | null = null;
  let best: Analysis | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let frameNumber = 0;
  let requireClearNextStart = false;
  let mounted = true;
  let ready: Promise<void> = Promise.resolve();
  let unsubscribe: (() => void) | undefined;

  function sync() { const value = controller.snapshot(); state.value = value.state; message.value = value.message; }
  function releaseCandidate() { best?.bitmap.close(); best = null; }
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function ensureVision() { return vision ??= createVisionClient(template.value); }
  function schedule(token: number) {
    if (!running.value || generation !== token || !mounted) return;
    clearTimer(); timer = setTimeout(() => { void tick(token); }, 180);
  }
  async function tick(token: number) {
    if (!running.value || token !== generation || !mounted) return;
    if (inFlight) { schedule(token); return; }
    inFlight = true;
    let current: Analysis | null = null;
    try {
      const bitmap = await camera.snapshot();
      if (!bitmap) { if (camera.error.value) { error.value = camera.error.value; pause(); } return; }
      if (token !== generation) { bitmap.close(); return; }
      const session = camera.sessionId.value;
      current = await ensureVision().analyze(bitmap, session);
      if (token !== generation || !running.value || current.sessionId !== session) { current.bitmap.close(); current = null; return; }
      // UI stores geometry/metrics only. The live ImageBitmap belongs solely to the candidate buffer.
      analysis.value = { ...current, bitmap: undefined as unknown as ImageBitmap };
      const decision = controller.update({ ...current, frameId: ++frameNumber }, performance.now(), queue.hasCapacity());
      sync();
      if (decision.resetCandidate) releaseCandidate();
      if (decision.state === 'seeking' && decision.resetCandidate) { writeScannerLatch(options.latchKey?.() ?? LATCH_KEY, false); qr.value = null; qrIssue.value = ''; }
      if (decision.collect && (!best || current.quality.score > best.quality.score)) {
        releaseCandidate(); best = current; current = null;
      }
      current?.bitmap.close(); current = null;
      if (decision.capture) {
        const chosen = best; best = null;
        if (!chosen?.geometry) { chosen?.bitmap.close(); throw new Error('Не удалось сохранить геометрию выбранного кадра'); }
        busy.value = true;
        const capture = await ensureVision().rectify(chosen.bitmap, chosen.geometry);
        if (token !== generation || !running.value) return;
        qr.value = capture.qr; qrIssue.value = '';
        const metadata = { qr: capture.qr, captureId: crypto.randomUUID(), cycleId: decision.cycleId, templateId: template.value.id,
          templateVersion: template.value.version, capturedAt: new Date().toISOString(), quality: chosen.quality, ...options.captureContext?.() };
        const record = await queue.enqueue(capture.blob, metadata);
        options.onCapture?.(record);
        writeScannerLatch(options.latchKey?.() ?? LATCH_KEY, true);
        if (token === generation && mounted) { controller.completeCapture(); sync(); }
      }
    } catch (err) {
      current?.bitmap.close();
      if (token === generation && mounted) {
        const detail = err instanceof Error ? err.message : 'Ошибка сканирования';
        if (/^QR_/.test(detail)) { qr.value = null; qrIssue.value = detail.replace(/^QR_[A-Z]+: /, ''); releaseCandidate(); controller.failCapture(qrIssue.value); sync(); return; }
        error.value = detail;
        releaseCandidate(); controller.failCapture(error.value); sync();
        // A persistent worker/storage failure must not create an endless capture retry loop.
        running.value = false; controller.pause(); sync();
      }
    } finally { inFlight = false; busy.value = false; schedule(token); }
  }
  async function start() {
    error.value = '';
    try {
      await ready; await queue.updateSettings(options.settings()); await queue.refresh();
      if (!camera.stream.value && !await camera.requestAccess()) { error.value = camera.error.value; return; }
      running.value = true; releaseCandidate();
      const token = ++generation; controller.start(readScannerLatch(options.latchKey?.() ?? LATCH_KEY) || requireClearNextStart); requireClearNextStart = false; sync(); void tick(token);
    } catch (err) { error.value = err instanceof Error ? err.message : String(err); }
  }
  function pause() {
    generation++; running.value = false; clearTimer(); releaseCandidate(); controller.pause(); sync();
  }
  function resume() { void start(); }
  function stop() {
    generation++; running.value = false; clearTimer(); releaseCandidate(); controller.stop(); sync();
    analysis.value = null; camera.stop();
  }
  async function calibrate() {
    pause(); error.value = '';
    try {
      if (!camera.stream.value && !await camera.requestAccess()) throw new Error(camera.error.value);
      const deadline = performance.now() + 21_000;
      while (inFlight && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
      if (inFlight) throw new Error('Дождитесь завершения обработки кадра');
      const bitmap = await camera.snapshot();
      if (!bitmap) throw new Error('Камера ещё не готова');
      await ensureVision().calibrate(bitmap);
      message.value = 'Пустой фон запомнен. Нажмите «Начать сканирование»';
    } catch (err) { error.value = err instanceof Error ? err.message : String(err); }
  }
  function useTemplate(value: SheetTemplate) {
    stop(); vision?.dispose(); vision = null; template.value = value;
    message.value = 'Шаблон загружен. Можно начать сканирование';
  }
  async function retry(id: string) { try { await queue.updateSettings(options.settings()); await queue.retry(id); } catch (err) { error.value = String(err); } }
  async function remove(id: string) { try { await queue.remove(id); } catch (err) { error.value = String(err); } }
  function clearError() { error.value = ''; }
  function applyUploadSettings() {
    try { queue.updateSettings(options.settings()); error.value = ''; }
    catch (err) { error.value = err instanceof Error ? err.message : String(err); }
  }
  function visibilityChange() { if (document.hidden && running.value) pause(); }
  watch(camera.sessionId, (next, previous) => {
    if (previous && next !== previous) {
      requireClearNextStart = true;
      vision?.dispose(); vision = null;
    }
    if (previous && next !== previous && running.value) {
      generation++; releaseCandidate(); analysis.value = null; controller.reset(true); sync();
      const token = generation; schedule(token);
    }
  });
  onMounted(() => {
    mounted = true;
    unsubscribe = queue.subscribe(value => { records.value = [...value].sort((a, b) => a.metadata.capturedAt.localeCompare(b.metadata.capturedAt)); });
    ready = queue.init().then(() => { records.value = queue.list().sort((a, b) => a.metadata.capturedAt.localeCompare(b.metadata.capturedAt)); }).catch(err => { error.value = String(err); throw err; });
    // Handle initial storage errors even if the operator has not pressed Start yet.
    void ready.catch(() => undefined);
    document.addEventListener('visibilitychange', visibilityChange);
  });
  onBeforeUnmount(() => {
    mounted = false; generation++; running.value = false; clearTimer(); releaseCandidate();
    vision?.dispose(); queue.dispose(); unsubscribe?.(); document.removeEventListener('visibilitychange', visibilityChange);
  });
  return { analysis, qr, qrIssue, state, message, error, busy, running, records, template, start, pause, resume, stop, retry, remove, clearError, applyUploadSettings, useTemplate, calibrate, refreshRecords: () => queue.refresh() };
}
