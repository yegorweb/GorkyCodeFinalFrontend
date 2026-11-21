<script setup lang="ts">
import { mdiPlay, mdiStop, mdiArrowRight } from '@mdi/js'

definePageMeta({ auth: true })
useSeoMeta({ title: 'Проверить работы' })
const route = useRoute()
const auth = useAuth({ required: true })
const session = useScanSession(queryString(route.query.scanId) || undefined)
const { captures, pending, loading } = session
const camera = useCamera()
const { devices, selectedDeviceId, loading: cameraLoading } = camera
const sound = useCaptureSound()
const starting = ref(false)
const finishing = ref(false)
const scanner = useScanner(camera, {
  settings: () => ({ mode: 'local', endpoint: '', maxItems: 10, maxBytes: 40 * 1024 * 1024 }),
  captureContext: () => ({ ownerId: auth.user.value?.id, scanSessionId: session.id.value }),
  latchKey: () => `proveryator-scanner:page-latched:${session.id.value}`,
  onCapture: record => { sound.play(); void session.enqueue(record).catch(cause => { session.error.value = generateErrorMessage(handleApiError(cause)) }) },
})
const { running, busy } = scanner
const uploaded = computed(() => captures.value.filter(record => record.submissionStatus === 'ACCEPTED').length)
const failed = computed(() => captures.value.filter(record => record.submissionStatus === 'FAILED').length)
const shownError = computed(() => session.error.value || scanner.error.value || camera.error.value)
const error = computed({ get: () => shownError.value, set: () => { session.error.value = undefined; scanner.clearError(); camera.error.value = '' } })
async function start() {
  starting.value = true
  void sound.arm()
  try { await session.ready; await scanner.start() }
  finally { starting.value = false }
}
async function finish() {
  if (finishing.value) return
  scanner.pause(); finishing.value = true
  try { if (await session.finish()) { scanner.stop(); await navigateTo({ path: '/works/results', query: { scanId: session.id.value } }) } }
  finally { finishing.value = false }
}
async function changeCamera(id: string) {
  const resume = running.value
  scanner.pause()
  await camera.setDeviceId(id)
  if (resume && camera.stream.value) await scanner.start()
}
watch(captures, () => { void scanner.refreshRecords().catch(() => {}) })
</script>

<template>
  <main><v-container class="check-container">
    <BackButton /><h1>Проверить работы</h1>
    <ErrorMessage v-if="shownError" v-model="error" role="alert" class="mb-4" />
    <v-select v-if="devices.length > 1" :model-value="selectedDeviceId" :items="devices.map((device, index) => ({ title: device.label || `Камера ${index + 1}`, value: device.deviceId }))" label="Камера" variant="outlined" density="compact" hide-details class="camera-select" :disabled="cameraLoading || finishing" @update:model-value="changeCamera" />
    <ScannerCameraView :camera="camera" :scanner="scanner" :mirror="false" />
    <div class="scan-actions">
      <v-btn color="primary" :prepend-icon="mdiPlay" :loading="starting || cameraLoading" :disabled="running || busy || finishing || loading" @click="start">{{ scanner.state.value === 'paused' ? 'Продолжить' : 'Старт' }}</v-btn>
      <v-btn variant="outlined" :prepend-icon="mdiStop" :loading="finishing" :disabled="busy || starting || loading" @click="finish">Завершить</v-btn>
      <v-btn variant="tonal" :prepend-icon="mdiArrowRight" :disabled="finishing" @click="navigateTo({ path: '/works/results', query: { scanId: session.id.value } })">Результаты</v-btn>
    </div>
    <p class="upload-status" aria-live="polite">Фотографий: {{ captures.length }} · Отправлено: {{ uploaded }} · В очереди: {{ pending }}<span v-if="failed"> · Не загружено: {{ failed }}</span></p>
    <p class="scan-hint">Каждая фотография отправляется сразу и проверяется отдельно.</p>
    <v-progress-linear v-if="pending || loading" indeterminate color="primary" />
  </v-container></main>
</template>
<style scoped>
.check-container { max-width: 1136px; padding-block: 16px 48px; }
h1 { margin: 16px 0 24px; font-size: clamp(24px, 2.4vw, 32px); font-weight: 500; }
.camera-select { max-width: 400px; margin-bottom: 16px; }
.scan-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-block: 20px; }
.upload-status { font-size: 14px; line-height: 1.7; margin-bottom: 16px; }
.scan-hint { margin-bottom: 16px; color: rgb(var(--v-theme-muted)); font-size: 14px; }
</style>
