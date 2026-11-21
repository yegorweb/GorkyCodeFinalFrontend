<script setup lang="ts">
import { mdiPlus, mdiRefresh, mdiCameraOutline } from '@mdi/js'
definePageMeta({ auth: true })
useSeoMeta({ title: 'Мои работы' })
const works = useWorks()
const grading = useGradingResults()
const { batches: gradingBatches, loading: gradingLoading, polling: gradingPolling, error: gradingError } = grading
const loading = ref(true)
const error = ref<string>()
const busyKeys = ref<string[]>([])
const groups = computed(() => ([
  { status: 'ready' as const, title: 'Готово' }, { status: 'draft' as const, title: 'Черновики' },
]).map(group => ({ ...group, works: works.items.value.filter(work => work.status === group.status) })).filter(group => group.works.length))
async function load() { loading.value = true; error.value = undefined; try { const res = await works.list(); if (!res.ok) error.value = generateErrorMessage(res) } finally { loading.value = false } }
async function withLoading(key: string, action: () => Promise<void>) {
  if (busyKeys.value.includes(key)) return
  busyKeys.value.push(key)
  try { await action() }
  catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) }
  finally { busyKeys.value = busyKeys.value.filter(value => value !== key) }
}
function openWork(work: Work, control: 'open' | 'title' = 'open') {
  return withLoading(`${control}:${work.id}`, async () => { await navigateTo({ path: '/works/view', query: { id: work.id, kind: work.kind } }) })
}
function downloadWork(work: Work) {
  return withLoading(`download:${work.id}`, async () => {
    const res = await works.pdf(work)
    if (!res.ok) { error.value = generateErrorMessage(res); return }
    downloadBlob(res.data, `${work.title}.pdf`)
  })
}
onMounted(load)
</script>
<template>
  <main><v-container class="works-container">
    <BackButton />
    <h1 class="page-title">Мои работы</h1>
    <div class="page-actions">
      <v-btn to="/works/new" color="secondary" :prepend-icon="mdiPlus" class="new-work-button">Новая работа</v-btn>
      <v-btn to="/works/check" color="secondary" :prepend-icon="mdiCameraOutline" class="new-work-button">Проверить работы</v-btn>
    </div>
    <ErrorMessage v-if="error" v-model="error" class="mt-4" role="alert" />
    <div v-if="loading" class="mt-4"><v-progress-linear indeterminate color="primary" /><v-skeleton-loader type="table" /></div>
    <template v-else-if="works.items.value.length">
      <WorkStatusSection v-for="group in groups" :key="group.status" :title="group.title" :status="group.status" :works="group.works" :busy-keys="busyKeys" @open="openWork" @download="downloadWork" />
    </template>
    <div v-else-if="error" class="empty-works"><v-btn :prepend-icon="mdiRefresh" :loading="loading" variant="text" @click="load">Повторить</v-btn></div>
    <div v-else class="empty-works"><h2>Работ пока нет</h2></div>
      <ErrorMessage v-if="gradingError" v-model="gradingError" class="mt-4" role="alert" />
      <CheckedWorksSection :batches="gradingBatches" :loading="gradingLoading" :polling="gradingPolling" />
  </v-container></main>
</template>
<style scoped>
.works-container { max-width: 1136px; padding-block: 16px 64px; }
.page-title { margin: 12px 0; font-size: clamp(23px, 2vw, 28px); font-weight: 500; }
.page-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-block: 20px; }
.catalog-note { color: rgb(var(--v-theme-muted)); font-size: 14px; margin-bottom: 16px; }
.new-work-button { letter-spacing: normal; text-transform: none; }
.empty-works { padding: clamp(32px, 5vw, 80px) 0; text-align: center; }
.empty-works h2 { font-size: clamp(19px, 2vw, 24px); margin-bottom: 24px; font-weight: 500; }
</style>
