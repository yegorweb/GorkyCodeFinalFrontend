<script setup lang="ts">
import { mdiDownload } from '@mdi/js'
import type { CaptureRecord } from '~/scanner/core/uploadQueue'
import { resultErrorBoxes, resultTaskDetails } from '~/utils/results'

const props = defineProps<{ captures: CaptureRecord[]; result?: Record<string, unknown> }>()
const photos = shallowRef<{ id: string; page: number; url: string; blob: Blob }[]>([])
const selectedId = ref('')
const selectedError = ref('')
const loaded = ref(false)
const photoError = ref(false)
const urls = new Map<string, string>()
const selected = computed(() => photos.value.find(photo => photo.id === selectedId.value))
const boxes = computed(() => selected.value ? resultErrorBoxes(props.result, selected.value.page) : [])
const detail = computed(() => resultTaskDetails(props.result).find(value => value.number === selectedError.value))

watch(() => props.captures, captures => {
  const keys = new Set<string>()
  photos.value = captures.map(capture => {
    const blob = capture.blob
    // Accepted page bytes are immutable; keep object URLs stable across IndexedDB refreshes.
    const key = [capture.metadata.captureId, capture.pageId, capture.preparationId, blob.size, blob.type].join(':')
    keys.add(key)
    let url = urls.get(key)
    if (!url) { url = URL.createObjectURL(blob); urls.set(key, url) }
    return { id: capture.metadata.captureId, page: capture.pageNumber ?? 1, url, blob }
  })
  for (const [key, url] of urls) if (!keys.has(key)) { URL.revokeObjectURL(url); urls.delete(key) }
  if (!photos.value.some(photo => photo.id === selectedId.value)) selectedId.value = photos.value[0]?.id ?? ''
}, { immediate: true })
watch(() => selected.value?.url, () => { loaded.value = false; photoError.value = false; selectedError.value = '' })
watch(boxes, value => { if (!value.some(box => box.number === selectedError.value)) selectedError.value = '' })
onBeforeUnmount(() => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear() })

function downloadPhoto() {
  if (!selected.value) return
  const extension = selected.value.blob.type === 'image/png' ? 'png' : 'jpg'
  downloadBlob(selected.value.blob, `Лист-${selected.value.page}.${extension}`)
}
</script>

<template>
  <section class="scan-preview" aria-label="Фотографии проверенной работы">
    <h2 class="preview-title">Фотографии работы</h2>
    <v-alert v-if="!photos.length" type="info" variant="tonal">
      Фото не найдено в этом браузере. Откройте результаты там, где сканировали работу.
    </v-alert>
    <template v-else-if="selected">
      <div class="photo-actions">
        <v-btn-toggle v-if="photos.length > 1" v-model="selectedId" mandatory variant="outlined" aria-label="Выбрать лист">
          <v-btn v-for="photo in photos" :key="photo.id" :value="photo.id">Лист {{ photo.page }}</v-btn>
        </v-btn-toggle>
        <span v-else>Лист {{ selected.page }}</span>
        <v-btn variant="text" :prepend-icon="mdiDownload" @click="downloadPhoto">Скачать фото</v-btn>
      </div>
      <v-progress-linear v-if="!loaded && !photoError" indeterminate color="primary" />
      <v-alert v-if="photoError" type="warning" variant="tonal">Не удалось открыть фотографию. Попробуйте скачать её.</v-alert>
      <div v-else class="photo-frame">
        <div class="photo-stage">
          <img :src="selected.url" :alt="`Скан работы, лист ${selected.page}`" @load="loaded = true" @error="photoError = true" />
          <template v-if="loaded">
            <button v-for="box in boxes" :key="box.number" type="button" class="error-region"
              :class="{ 'error-region-selected': selectedError === box.number }"
              :style="{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }"
              :aria-label="`Посмотреть ошибку в задании ${box.number}`" :aria-pressed="selectedError === box.number"
              @click="selectedError = box.number">
              <span class="error-label">{{ box.number }}</span>
            </button>
          </template>
        </div>
      </div>
      <div v-if="boxes.length" class="error-actions" aria-label="Отмеченные задания">
        <v-btn v-for="box in boxes" :key="box.number" size="small" :variant="selectedError === box.number ? 'flat' : 'outlined'"
          color="error" :aria-pressed="selectedError === box.number" @click="selectedError = box.number">Задание {{ box.number }}</v-btn>
      </div>
      <v-alert v-if="selectedError" type="error" variant="tonal" class="error-description" :title="`Задание ${selectedError}`" aria-live="polite">
        <p>{{ detail?.message || 'AI отметил эту область ответа для проверки учителем.' }}</p>
        <p v-if="detail?.evidence">{{ detail.evidence }}</p>
        <p v-if="detail?.location">Где искать: {{ detail.location }}</p>
      </v-alert>
      <p class="photo-note">{{ boxes.length ? 'Нажмите на рамку или номер задания, чтобы посмотреть пояснение. Отметки AI требуют проверки учителем.' : 'Области ошибок на этом листе не отмечены. Пояснения к заданиям приведены ниже.' }}</p>
    </template>
  </section>
</template>

<style scoped>
.scan-preview { margin-block: 12px 24px; }
.preview-title { margin-bottom: 12px; font-size: clamp(18px, 1.7vw, 22px); font-weight: 500; }
.photo-actions, .error-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-block: 12px; }
.photo-actions { justify-content: space-between; }
.photo-actions :deep(.v-btn-toggle) { max-width: 100%; height: auto; flex-wrap: wrap; }
.photo-frame { padding: clamp(4px, 1vw, 12px); background: rgb(var(--v-theme-surface)); border: 1px solid rgb(var(--v-theme-border)); border-radius: 10px; }
.photo-stage { position: relative; width: min(100%, 760px); margin-inline: auto; }
.photo-stage img { display: block; width: 100%; height: auto; }
.error-region { position: absolute; padding: 0; border: 2px solid rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), 0.07); cursor: pointer; }
.error-region-selected, .error-region:hover { border-width: 3px; background: rgba(var(--v-theme-error), 0.18); }
.error-region:focus-visible { outline: 3px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
.error-label { position: absolute; left: -2px; top: -2px; padding: 2px 6px; background: rgb(var(--v-theme-error)); color: rgb(var(--v-theme-on-error)); font-size: 12px; line-height: 1.4; }
.error-description p + p { margin-top: 8px; }
.photo-note { margin-top: 12px; font-size: clamp(15px, 1.3vw, 16px); color: rgb(var(--v-theme-muted)); }
</style>
