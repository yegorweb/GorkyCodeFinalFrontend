<script setup lang="ts">
import { mdiEyeOutline, mdiClipboardCheckOutline } from '@mdi/js'
import type { WorkflowBatch } from '~/scanner/core/batchWorkflow'

const props = defineProps<{ batches: WorkflowBatch[]; loading: boolean; polling: boolean }>()
const rows = computed(() => props.batches.flatMap(batch => Object.values(batch.tasks)
  .filter(task => task.status === 'SUCCEEDED')
  .map(task => ({ ...task, batchId: batch.batchId, scanId: batch.scanSessionId ?? batch.batchId,
    workTitle: batch.workTitle || 'Фотография работы', checkedAt: task.updatedAt || batch.createdAt })))
  .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)))
const pendingCount = computed(() => props.batches.reduce((count, batch) => count + Object.values(batch.tasks)
  .filter(task => ['RECEIVING', 'QUEUED', 'PROCESSING'].includes(task.status)).length, 0))
const resultLink = (scanId: string, taskId: string) => ({ path: '/works/results', query: { scanId, taskId } })
</script>

<template>
  <section class="checked-section" aria-labelledby="checked-works-title">
    <div class="section-heading">
      <h2 id="checked-works-title">Проверенные работы</h2>
      <v-btn to="/works/results" variant="text" :prepend-icon="mdiClipboardCheckOutline" class="checked-button">Все результаты</v-btn>
    </div>
    <p v-if="pendingCount" class="pending-note" role="status">Ещё проверяются: {{ pendingCount }}. Результаты появятся автоматически.</p>
    <v-skeleton-loader v-if="loading" type="table" />
    <template v-else-if="rows.length">
      <v-table class="checked-table" density="compact">
        <thead><tr><th scope="col" class="name-column">Контрольная</th><th scope="col" class="date-column">Проверена</th><th scope="col" class="actions-column">Действия</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.taskId">
          <td><NuxtLink :to="resultLink(row.scanId, row.taskId)" class="checked-title">{{ row.workTitle }}</NuxtLink></td>
          <td class="checked-date">{{ formatWorkDate(row.checkedAt) }}</td>
          <td><v-btn :to="resultLink(row.scanId, row.taskId)" variant="text" size="small" :prepend-icon="mdiEyeOutline" class="checked-button">Фото и ошибки</v-btn></td>
        </tr></tbody>
      </v-table>
      <div class="checked-cards">
        <v-sheet v-for="row in rows" :key="row.taskId" color="surface" rounded="lg" class="checked-card">
          <h3>{{ row.workTitle }}</h3>
          <p class="checked-date">Проверена: {{ formatWorkDate(row.checkedAt) }}</p>
          <v-btn :to="resultLink(row.scanId, row.taskId)" variant="text" :prepend-icon="mdiEyeOutline" class="checked-button">Фото и ошибки</v-btn>
        </v-sheet>
      </div>
    </template>
    <p v-else class="empty-checked">{{ pendingCount ? 'Ждём завершения проверки.' : 'Проверенных работ пока нет. Отсканируйте работу и завершите сканирование.' }}</p>
  </section>
</template>

<style scoped>
.checked-section { margin-top: 24px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 10px; }
h2 { margin: 0; font-size: clamp(19px, 1.62vw, 22px); font-weight: 500; line-height: 1.3; }
.checked-button { letter-spacing: normal; text-transform: none; }
.checked-table { background: rgb(var(--v-theme-surface)); border: 1px solid rgb(var(--v-theme-border)); border-radius: 10px; }
.checked-table :deep(th), .checked-table :deep(td) { height: 36px; padding: 0 16px; font-size: 14px; }
.checked-table :deep(td) { font-weight: 400; }
.checked-table :deep(thead th) { font-weight: 700 !important; }
.checked-table :deep(th:not(:last-child)), .checked-table :deep(td:not(:last-child)) { border-right: 1px solid rgb(var(--v-theme-border)); }
.name-column { width: 100%; }
.date-column { min-width: 140px; }
.actions-column { min-width: 150px; }
.checked-table .checked-button { padding-inline: 7px; font-size: 14px; }
.checked-title { color: rgb(var(--v-theme-ink)); display: block; max-width: min(35vw, 420px); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.checked-title:hover { text-decoration: underline; }
.checked-date { white-space: nowrap; color: rgb(var(--v-theme-muted)); }
.pending-note, .empty-checked { color: rgb(var(--v-theme-muted)); font-size: 14px; line-height: 1.5; margin: 0; }
.pending-note { margin-bottom: 10px; }
.checked-cards { display: none; }
@media (max-width: 800px) {
  .checked-table { display: none; }
  .checked-cards { display: grid; gap: 10px; }
  .checked-card { padding: clamp(12px, 4vw, 18px); border: 1px solid rgb(var(--v-theme-border)); }
  .checked-card h3 { margin: 0; font-size: clamp(16px, 4.5vw, 18px); font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
  .checked-card p { margin: 6px 0 10px; font-size: 13px; white-space: normal; overflow-wrap: anywhere; }
  .checked-card .checked-button { padding-inline: 0; }
}
</style>
