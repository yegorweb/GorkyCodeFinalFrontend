import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';

export function cameraError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError': return 'Разрешите доступ к камере в настройках браузера.';
    case 'NotFoundError': case 'DevicesNotFoundError': return 'Камера не найдена. Подключите документ-камеру или выберите другое устройство.';
    case 'NotReadableError': case 'TrackStartError': return 'Камера занята другим приложением или недоступна.';
    case 'OverconstrainedError': return 'Устройство не поддерживает выбранные параметры.';
    case 'SecurityError': return 'Для камеры нужен HTTPS или localhost.';
    default: return error instanceof Error ? error.message : 'Не удалось подключить камеру.';
  }
}
export function stopTracks(stream: MediaStream | null): void { stream?.getTracks().forEach(track => track.stop()); }
export function cameraConstraints(deviceId = ''): MediaStreamConstraints {
  return { audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } };
}
export function useCamera() {
  const videoRef = shallowRef<HTMLVideoElement | null>(null);
  const stream = shallowRef<MediaStream | null>(null);
  const devices = ref<MediaDeviceInfo[]>([]);
  const selectedDeviceId = ref('');
  const sessionId = ref('');
  const error = ref('');
  const loading = ref(false);
  const resolution = ref('');
  const permissionGranted = ref(false);
  let epoch = 0;
  let alive = true;

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const found = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (!alive) return;
      devices.value = found;
      const current = stream.value?.getVideoTracks()[0]?.getSettings().deviceId;
      if (current && !found.some(d => d.deviceId === current)) {
        stop(); error.value = 'Камера отключена. Подключите её снова или выберите другую.';
      }
    } catch { /* Explicit permission request gives a more useful error. */ }
  }
  function stop() {
    epoch++;
    stopTracks(stream.value); stream.value = null;
    if (videoRef.value) videoRef.value.srcObject = null;
    sessionId.value = ''; resolution.value = ''; loading.value = false;
  }
  async function requestAccess(requestedId?: string): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      error.value = 'Для доступа к камере откройте приложение через HTTPS или localhost.'; return false;
    }
    const token = ++epoch;
    const id = requestedId ?? selectedDeviceId.value;
    stopTracks(stream.value); stream.value = null;
    loading.value = true; error.value = '';
    let next: MediaStream | null = null;
    try {
      try { next = await navigator.mediaDevices.getUserMedia(cameraConstraints(id)); }
      catch (first) {
        if ((first as {name?: string}).name !== 'OverconstrainedError') throw first;
        next = await navigator.mediaDevices.getUserMedia({ audio: false, video: id ? { deviceId: { exact: id } } : true });
      }
      if (!alive || token !== epoch) { stopTracks(next); return false; }
      stream.value = next;
      const track = next.getVideoTracks()[0];
      const settings = track?.getSettings();
      if (settings?.deviceId) selectedDeviceId.value = settings.deviceId;
      resolution.value = settings?.width && settings.height ? `${settings.width} × ${settings.height}` : 'Авто';
      sessionId.value = crypto.randomUUID(); permissionGranted.value = true;
      const video = videoRef.value;
      if (video) { video.srcObject = next; await video.play(); }
      if (track) track.onended = () => {
        if (stream.value !== next) return;
        stop(); error.value = 'Видеопоток остановлен. Подключите камеру повторно.';
      };
      await refreshDevices();
      return true;
    } catch (err) {
      stopTracks(next);
      if (token === epoch && alive) { stream.value = null; error.value = cameraError(err); }
      return false;
    } finally { if (token === epoch && alive) loading.value = false; }
  }
  async function setDeviceId(id: string) {
    selectedDeviceId.value = id;
    if (stream.value) await requestAccess(id);
  }
  async function snapshot(): Promise<ImageBitmap | null> {
    const video = videoRef.value;
    const token = epoch;
    if (!video || !stream.value || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const bitmap = await createImageBitmap(video);
    if (token !== epoch) { bitmap.close(); return null; }
    return bitmap;
  }
  async function still(): Promise<ImageBitmap | null> {
    const track = stream.value?.getVideoTracks()[0];
    const Ctor = (window as Window & { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
    if (!track || !Ctor) return null;
    const token = epoch;
    try {
      const bitmap = await createImageBitmap(await new Ctor(track).takePhoto());
      if (token !== epoch) { bitmap.close(); return null; }
      return bitmap;
    } catch { return null; }
  }
  onMounted(() => {
    alive = true; void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
  });
  onBeforeUnmount(() => {
    alive = false;
    navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
    stop();
  });
  return { videoRef, stream, devices, selectedDeviceId, sessionId, error, loading, resolution, permissionGranted, requestAccess, refreshDevices, setDeviceId, snapshot, still, stop };
}
export type CameraHandle = ReturnType<typeof useCamera>;
