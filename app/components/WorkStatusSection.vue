<script setup lang="ts">
const props = defineProps<{ title: string; status: WorkStatus; works: Work[]; busyKey?: string; highlightId?: string }>()
const emit = defineEmits<{ open: [work: Work]; check: [work: Work]; download: [work: Work]; results: [work: Work] }>()

function openWork(work: Work) {
  if (!props.busyKey) emit('open', work)
}
</script>

<template>
  <section :id="`works-${status}`" class="work-section" :aria-labelledby="`works-${status}-title`">
    <h2 :id="`works-${status}-title`" class="work-section-title">{{ title }}</h2>
    <v-table class="works-table" density="compact">
      <thead><tr>
        <th scope="col" class="name-column">Название</th>
        <th scope="col" class="date-column">Создана</th>
        <th scope="col" class="actions-column">Действия</th>
      </tr></thead>
      <tbody>
        <tr v-for="work in works" :key="work.id" :class="{ 'work-highlight': work.id === highlightId }">
          <td class="work-title-cell" :title="work.title" :aria-label="`Открыть «${work.title}»`"
            :tabindex="busyKey ? -1 : 0" :aria-disabled="!!busyKey" :aria-busy="busyKey === `open:${work.id}`"
            @click="openWork(work)" @keydown.enter.prevent="openWork(work)" @keydown.space.prevent="openWork(work)"
          >
            <div class="work-title-content">
              <v-progress-circular v-if="busyKey === `open:${work.id}`" indeterminate color="primary" size="16" width="2" />
              <span class="work-title">{{ work.title }}</span>
            </div>
          </td>
          <td class="work-date">{{ formatWorkDate(work.createdAt) }}</td>
          <td>
            <WorkActions :work="work" :busy-key="busyKey"
              @open="emit('open', $event)" @check="emit('check', $event)"
              @download="emit('download', $event)" @results="emit('results', $event)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
    <div class="work-cards">
      <v-sheet v-for="work in works" :key="work.id" color="surface" rounded="lg"
        class="work-card" :class="{ 'work-highlight': work.id === highlightId }"
      >
        <h3>
          <v-btn variant="text" class="work-card-title" :aria-label="`Открыть «${work.title}»`"
            :loading="busyKey === `open:${work.id}`" :disabled="!!busyKey && busyKey !== `open:${work.id}`"
            @click="emit('open', work)"
          >{{ work.title }}</v-btn>
        </h3>
        <p class="work-card-date">Создана: {{ formatWorkDate(work.createdAt) }}</p>
        <WorkActions :work="work" :busy-key="busyKey"
          @open="emit('open', $event)" @check="emit('check', $event)"
          @download="emit('download', $event)" @results="emit('results', $event)"
        />
      </v-sheet>
    </div>
  </section>
</template>

<style scoped>
.work-section { margin-top: 18px; scroll-margin-top: 90px; }
.work-section + .work-section { margin-top: 24px; }
.work-section-title { margin: 0 0 10px; font-size: clamp(19px, 1.62vw, 22px); font-weight: 500; line-height: 1.3; }
.works-table { background: rgb(var(--v-theme-surface)); border: 1px solid rgb(var(--v-theme-border)); border-radius: 10px; }
.works-table :deep(th), .works-table :deep(td) { height: 36px; padding: 0 16px; font-size: 14px; font-weight: 400; }
.works-table :deep(th:not(:last-child)), .works-table :deep(td:not(:last-child)) { border-right: 1px solid rgb(var(--v-theme-border)); }
.name-column { width: 100%; }
.date-column { min-width: 140px; }
.actions-column { min-width: 150px; }
.work-title-cell { cursor: pointer; }
.work-title-cell:hover { background: rgba(var(--v-theme-ink), 0.04); }
.work-title-cell:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.work-title-cell[aria-disabled="true"] { cursor: wait; }
.work-title-content { display: flex; align-items: center; gap: 8px; }
.work-title { display: block; max-width: min(40vw, 520px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-version { font-size: 12px; color: rgb(var(--v-theme-muted)); white-space: nowrap; }
.work-date { white-space: nowrap; }
.work-cards { display: none; }
.work-highlight { background: rgba(var(--v-theme-primary), 0.09); }
@media (max-width: 800px) {
  .works-table { display: none; }
  .work-cards { display: grid; gap: 10px; }
  .work-card { padding: clamp(12px, 4vw, 18px); border: 1px solid rgb(var(--v-theme-border)); }
  .work-card h3 { margin: 0; font-size: clamp(16px, 4.5vw, 18px); font-weight: 500; overflow-wrap: anywhere; }
  .work-card-title { width: 100%; height: auto; min-height: 24px; padding: 0; font-size: inherit !important; font-weight: inherit; letter-spacing: normal; text-transform: none; }
  .work-card-title :deep(.v-btn__content) { width: 100%; min-width: 0; white-space: normal; text-align: left; display: block; }
  .work-card-date { margin: 6px 0 10px; font-size: 13px; color: rgb(var(--v-theme-muted)); }
  .work-card.work-highlight { border-color: rgb(var(--v-theme-primary)); }
}
</style>
