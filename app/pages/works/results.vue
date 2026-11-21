<script setup lang="ts">
import { mdiDownload, mdiRefresh, mdiCheck } from '@mdi/js'
import { gradingStatusLabels, resultTaskDetails } from '~/utils/results'
definePageMeta({ auth: true })
useSeoMeta({ title: 'Результаты проверки' })
const route = useRoute()
const session = useScanSession(queryString(route.query.scanId) || queryString(route.query.batchId) || undefined)
const { captures, batches, error, loading } = session
const polling = ref(false)
const acknowledging = ref(false)
const expanded = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const tasks = computed(() => batches.value.flatMap(batch => Object.values(batch.tasks).map(task => ({ ...task, workTitle: batch.workTitle ?? '' }))))
const complete = computed(() => batches.value.length > 0 && batches.value.every(batch => batch.status !== 'OPEN' && !batch.hasMore && Object.values(batch.tasks).length >= (batch.closeExpectedTaskCount ?? 1) && Object.values(batch.tasks).every(task => ['SUCCEEDED', 'FAILED', 'INCOMPLETE'].includes(task.status))))
const confirmed = computed(() => batches.value.length > 0 && batches.value.every(batch => batch.serverCleanupAcknowledged))
const failedCaptures = computed(() => captures.value.filter(record => record.submissionStatus !== 'ACCEPTED'))
async function poll() {
  if (polling.value || disposed) return
  clearTimeout(timer)
  polling.value = true
  try { await session.poll() }
  finally { polling.value = false; if (!disposed && !complete.value && batches.value.some(batch => batch.status !== 'OPEN')) timer = setTimeout(() => { void poll() }, 2500) }
}
async function acknowledge() {
  acknowledging.value = true
  try { await session.acknowledge() } finally { acknowledging.value = false }
}
function download() {
  const escape = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"` }
  const rows = [['Ученик', 'Работа', 'Статус', 'Задание', 'Ответ ученика', 'Правильный ответ', 'Результат'], ...tasks.value.flatMap(task => {
    const details = resultTaskDetails(task.result)
    return (details.length ? details : [{ number: '', answer: '', expected: '', status: '' }]).map(detail => [task.displayName, task.workTitle, gradingStatusLabels[task.status], detail.number, detail.answer, detail.expected, detail.status])
  })]
  downloadBlob(new Blob(['\uFEFF' + rows.map(row => row.map(escape).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'Результаты.csv')
}
onMounted(async () => { await session.ready; await poll() })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer) })
</script>
<template>
  <main><v-container class="results-container">
    <BackButton /><h1>Результаты проверки</h1>
    <ErrorMessage v-if="error" v-model="error" role="alert" class="mb-4" />
    <v-progress-linear v-if="loading || polling" indeterminate color="primary" />
    <p class="result-count">Работ: {{ tasks.length }} · Проверено: {{ tasks.filter(task => task.status === 'SUCCEEDED').length }}</p>
    <div class="result-actions">
      <v-btn :prepend-icon="mdiRefresh" variant="outlined" :loading="polling" @click="poll">Обновить</v-btn>
      <v-btn v-if="tasks.length" :prepend-icon="mdiDownload" variant="outlined" @click="download">Скачать результаты</v-btn>
      <v-btn v-if="complete && !confirmed" color="primary" :prepend-icon="mdiCheck" :loading="acknowledging" @click="acknowledge">Подтвердить получение</v-btn>
    </div>
    <v-table v-if="tasks.length" class="result-table">
      <thead><tr><th>Ученик</th><th>Работа</th><th>Статус</th></tr></thead>
      <tbody>
        <template v-for="task in tasks" :key="task.taskId">
          <tr><td><v-btn variant="text" class="student-button" @click="expanded = expanded === task.taskId ? '' : task.taskId">{{ task.displayName }}</v-btn></td><td>{{ task.workTitle }}</td><td>{{ gradingStatusLabels[task.status] }}</td></tr>
          <tr v-if="expanded === task.taskId"><td colspan="3" class="task-details">
            <p v-if="task.error" class="text-error">{{ task.error.message }}</p>
            <p v-if="task.missingPageNumbers?.length">Не получены листы: {{ task.missingPageNumbers.join(', ') }}</p>
            <section v-for="detail in resultTaskDetails(task.result)" :key="detail.number" class="task-detail">
              <h2>Задание {{ detail.number }} · {{ detail.status }}</h2><p>Ответ ученика: {{ detail.answer }}</p><p>Правильный ответ: {{ detail.expected }}</p><p v-if="detail.message">{{ detail.message }}</p>
            </section>
            <p v-if="!task.result && !task.error">{{ task.status === 'INCOMPLETE' ? 'Работа получена не полностью' : 'Проверка ещё не завершена' }}</p>
          </td></tr>
        </template>
      </tbody>
    </v-table>
    <p v-else-if="!loading" class="empty-results">Результатов пока нет</p>
    <template v-if="failedCaptures.length">
      <h2 class="failed-heading">Не загружено: {{ failedCaptures.length }}</h2>
      <div v-for="record in failedCaptures" :key="record.metadata.captureId" class="failed-capture"><span>{{ record.submissionError || 'Лист не отправлен' }}</span><v-btn variant="text" :prepend-icon="mdiDownload" @click="downloadBlob(record.blob, `Лист-${record.metadata.captureId.slice(0, 8)}.jpg`)">Скачать фото</v-btn></div>
    </template>
  </v-container></main>
</template>
<style scoped>
.results-container { max-width: 1136px; padding-block: 16px 48px; }
h1 { margin-block: 16px 24px; font-size: clamp(24px, 2.4vw, 32px); font-weight: 500; }
.result-count { margin-block: 20px; }
.result-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.student-button { padding: 0; letter-spacing: normal; text-transform: none; font-size: inherit !important; }
.task-details { padding-block: 20px !important; }
.task-detail { padding-block: 14px; }
.task-detail h2, .failed-heading { font-size: clamp(17px, 1.7vw, 20px); font-weight: 500; margin-bottom: 10px; }
.task-detail p + p { margin-top: 8px; }
.failed-heading { margin-top: 32px; }
.failed-capture { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding-block: 12px; border-bottom: 1px solid rgb(var(--v-theme-border)); }
.empty-results { padding-block: 32px; color: rgb(var(--v-theme-muted)); }
</style>
