<script setup lang="ts">
import { mdiDownload, mdiPencilOutline, mdiCameraOutline } from '@mdi/js'
definePageMeta({ auth: true })
useSeoMeta({ title: 'Работа' })
const route = useRoute()
const works = useWorks()
const work = ref<Work>()
const error = ref<string>()
const loading = ref(true)
const downloading = ref(false)
async function download() {
  if (!work.value) return
  downloading.value = true; error.value = undefined
  try { const result = await works.pdf(work.value); if (!result.ok) error.value = generateErrorMessage(result); else downloadBlob(result.data, `${work.value.title}.pdf`) }
  finally { downloading.value = false }
}
onMounted(async () => {
  try {
    const id = queryString(route.query.id)
    if (!id) { error.value = 'Работа не найдена'; return }
    const result = await works.get(id, queryString(route.query.kind) === 'draft' ? 'draft' : 'version')
    if (!result.ok) { error.value = generateErrorMessage(result); return }
    work.value = result.data
  } finally { loading.value = false }
})
</script>
<template>
  <main><v-container class="work-container">
    <BackButton /><h1>{{ work?.title || 'Работа' }}</h1>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
    <ErrorMessage v-if="error" v-model="error" role="alert" class="mb-4" />
    <template v-if="work">
      <div class="actions">
        <v-btn :to="{ path: '/works/new', query: { id: work.draftId } }" :prepend-icon="mdiPencilOutline" color="secondary" class="new-work-button">Редактировать</v-btn>
        <v-btn v-if="work.kind === 'version'" :prepend-icon="mdiDownload" color="secondary" class="new-work-button" :loading="downloading" @click="download">Скачать бланк</v-btn>
        <v-btn v-if="work.status === 'ready'" to="/works/check" :prepend-icon="mdiCameraOutline" color="secondary" class="new-work-button">Проверить работы</v-btn>
      </div>
      <p v-if="work.spec.instructions" class="instructions">{{ work.spec.instructions }}</p>
      <section v-for="(task, index) in work.spec.tasks" :key="task.id" class="task-row">
        <h2>Задание {{ index + 1 }}</h2><p class="condition">{{ task.prompt }}</p>
        <ol v-if="task.options.length"><li v-for="(option, optionIndex) in task.options" :key="optionIndex">{{ option }}</li></ol>
        <v-img v-for="image in task.images" :key="image.id" :src="`data:image/png;base64,${image.data_base64}`" :alt="image.caption" max-height="180" contain class="my-3" />
        <p class="answer">Ответ: {{ task.answer || 'Не указан' }}</p>
      </section>
    </template>
  </v-container></main>
</template>
<style scoped>
.work-container { max-width: 1136px; padding-block: 16px 48px; }
h1 { font-size: clamp(24px, 2.5vw, 32px); font-weight: 500; margin-block: 16px 24px; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.new-work-button { letter-spacing: normal; text-transform: none; }
.task-row { max-width: 820px; padding-block: 20px; border-bottom: 1px solid rgb(var(--v-theme-border)); }
h2 { font-size: clamp(18px, 2vw, 22px); font-weight: 500; margin-bottom: 12px; }
.instructions, .condition { white-space: pre-wrap; line-height: 1.6; }
ol { padding-left: 24px; margin-top: 12px; }
.answer { margin-top: 16px; font-weight: 500; }
</style>
