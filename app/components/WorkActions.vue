<script setup lang="ts">
import { mdiDownload, mdiOpenInNew } from '@mdi/js'

defineProps<{ work: Work; busyKey?: string }>()
defineEmits<{ open: [work: Work]; download: [work: Work] }>()
</script>

<template>
  <div class="work-actions">
    <v-btn
      :prepend-icon="mdiOpenInNew"
      :loading="busyKey === `open:${work.id}`"
      :disabled="!!busyKey && busyKey !== `open:${work.id}`"
      :aria-label="`Открыть работу «${work.title}»`"
      variant="text" size="small" class="work-action"
      @click="$emit('open', work)"
    >Открыть</v-btn>
    <v-btn
      v-if="work.kind === 'version'"
      :prepend-icon="mdiDownload"
      :loading="busyKey === `download:${work.id}`"
      :disabled="!!busyKey && busyKey !== `download:${work.id}`"
      :aria-label="`Скачать бланки работы «${work.title}»`"
      variant="text" size="small" class="work-action"
      @click="$emit('download', work)"
    >Скачать бланки</v-btn>
  </div>
</template>

<style scoped>
.work-actions { display: flex; align-items: center; gap: 2px; }
.work-action {
  padding-inline: 7px;
  font-size: 14px !important;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
}
.work-action :deep(.v-btn__prepend) { margin-inline-end: 4px; }
.work-action :deep(.v-icon) { font-size: 20px; }
@media (max-width: 800px) {
  .work-actions { flex-wrap: wrap; gap: 4px; }
  .work-action { padding-inline: 6px; }
}
</style>
