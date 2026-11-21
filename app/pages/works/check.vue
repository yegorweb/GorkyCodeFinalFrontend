<script setup lang="ts">
import { mdiPlay, mdiStop } from '@mdi/js'

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
const cameraChosen = ref(false)
const hasStarted = ref(false)
const defaultCamera = '__default_camera__'
const cameraOptions = computed(() => devices.value.length
  ? devices.value.map((device, index) => ({ title: device.label || `Камера ${index + 1}`, value: device.deviceId || defaultCamera }))
  : [{ title: 'Камера по умолчанию', value: defaultCamera }])
const cameraSelection = computed(() => cameraChosen.value ? selectedDeviceId.value || defaultCamera : null)
const scanner = useScanner(camera, {
  settings: () => ({ mode: 'local', endpoint: '', maxItems: 10, maxBytes: 40 * 1024 * 1024 }),
  captureContext: () => ({ ownerId: auth.user.value?.id, scanSessionId: session.id.value }),
  latchKey: () => `proveryator-scanner:page-latched:${session.id.value}`,
  onCapture: record => { sound.play(); void session.enqueue(record).catch(cause => { session.error.value = generateErrorMessage(handleApiError(cause)) }) },
})
const { running, busy } = scanner
const canStart = computed(() => cameraChosen.value && !running.value && !busy.value && !starting.value && !finishing.value && !cameraLoading.value && !loading.value)
const canFinish = computed(() => cameraChosen.value && hasStarted.value && !busy.value && !starting.value && !finishing.value && !cameraLoading.value && !loading.value)
const uploaded = computed(() => captures.value.filter(record => record.submissionStatus === 'ACCEPTED').length)
const failed = computed(() => captures.value.filter(record => record.submissionStatus === 'FAILED').length)
const shownError = computed(() => session.error.value || scanner.error.value || camera.error.value)
const error = computed({ get: () => shownError.value, set: () => { session.error.value = undefined; scanner.clearError(); camera.error.value = '' } })
async function start() {
  if (!canStart.value) return
  starting.value = true
  void sound.arm()
  try { await session.ready; await session.resume(); await scanner.start(); if (running.value) hasStarted.value = true }
  finally { starting.value = false }
}
async function finish() {
  if (!canFinish.value) return
  scanner.pause(); finishing.value = true
  try { if (await session.finish()) { scanner.stop(); await navigateTo({ path: '/works/results', query: { scanId: session.id.value } }) } }
  finally { finishing.value = false }
}
async function changeCamera(value: string | null) {
  if (!value) { cameraChosen.value = false; scanner.pause(); return }
  const id = value === defaultCamera ? '' : value
  cameraChosen.value = true
  const resume = running.value
  scanner.pause()
  await camera.setDeviceId(id)
  if (resume && camera.stream.value) await scanner.start()
}
watch(devices, found => {
  if (selectedDeviceId.value && !found.some(device => device.deviceId === selectedDeviceId.value)) cameraChosen.value = false
})
watch(captures, () => { void scanner.refreshRecords().catch(() => {}) })
</script>

<template>
  <main><v-container class="check-container">
    <BackButton /><h1 class="back-page-title">Проверка работ</h1>
    <ErrorMessage v-if="shownError" v-model="error" role="alert" class="mb-4" />
    <v-select placeholder="Камера" :model-value="cameraSelection" :items="cameraOptions" label="Камера" variant="outlined" density="compact" hide-details class="camera-select" :disabled="cameraLoading || starting || finishing" @update:model-value="changeCamera" />
    <div class="scan-actions">
      <v-btn color="primary" :prepend-icon="mdiPlay" :loading="starting || cameraLoading" :disabled="!canStart" @click="start">{{ scanner.state.value === 'paused' ? 'Продолжить' : 'Старт' }}</v-btn>
      <v-btn variant="outlined" :prepend-icon="mdiStop" :loading="finishing" :disabled="!canFinish" @click="finish">Завершить</v-btn>
    </div>
    <p class="upload-status" aria-live="polite">Листов: {{ captures.length }} · Загружено: {{ uploaded }} · Отправляется: {{ pending }}<span v-if="failed"> · Не загружено: {{ failed }}</span></p>
    <ScannerCameraView :camera="camera" :scanner="scanner" :mirror="false" />
    <v-progress-linear v-if="pending || loading" indeterminate color="primary" />
  </v-container></main>
</template>
<style scoped>
.check-container { max-width: 1136px; padding-block: 16px 48px; }
h1 { margin-bottom: 24px; }
.camera-select { max-width: 400px; margin-bottom: 16px; }
.scan-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-block: 20px; }
.upload-status { font-size: 14px; line-height: 1.7; margin-bottom: 16px; }
</style>
