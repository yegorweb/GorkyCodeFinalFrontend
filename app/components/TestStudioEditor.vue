<script setup lang="ts">
import { mdiFileDocumentOutline, mdiDeleteOutline } from '@mdi/js'
const props = defineProps<{ workId?: string }>()
const studio = useTestStudio({ loadExamples: false, estimate: false })
const { exam, busy, error, jobs } = studio
const works = useWorks()
const file = ref<File | null>(null)
const uploading = ref(false)
const saving = ref(false)
const loading = ref(!!props.workId)
const submitted = ref(false)
const currentDraft = ref<Work>()
const draftId = props.workId ?? crypto.randomUUID()
const figures = ref<StudioReviewFigure[]>([])
const mathLoading = computed(() => jobs.value.some(job => ['queued', 'running'].includes(job.status)))
let savedSnapshot = ''
let saveAttempt: { fingerprint: string; id: string } | undefined
let publishAttempt: { revision: number; id: string } | undefined
if (!props.workId) { exam.value.title = ''; exam.value.subject = 'Другое' }

async function upload(value: File | File[] | null) {
  const selected = Array.isArray(value) ? value[0] : value
  if (!selected || uploading.value || saving.value) return
  uploading.value = true
  error.value = undefined
  try {
    studio.sourcePages.value = []; studio.sourceText.value = ''; studio.review.value = undefined
    await studio.importSources([selected])
    if (!studio.review.value) return
    const importedFigures = studio.review.value.figures.map(figure => ({ ...figure }))
    studio.applyReview()
    if (studio.review.value) return
    figures.value = importedFigures
    submitted.value = false
  } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) }
  finally { uploading.value = false }
}
function assignFigure(figure: StudioReviewFigure, taskId: string) {
  for (const task of exam.value.tasks) task.images = task.images?.filter(image => image.id !== figure.id)
  const task = exam.value.tasks.find(task => task.id === taskId)
  if (task) (task.images ??= []).push({ id: figure.id, data_base64: figure.data_base64, caption: figure.caption })
  figure.taskId = taskId
}
async function save() {
  if (saving.value || uploading.value || loading.value || mathLoading.value) return
  submitted.value = true; saving.value = true; error.value = undefined
  try {
    const snapshot: StudioExam = JSON.parse(JSON.stringify(exam.value))
    validateStudioExam(snapshot)
    if (snapshot.tasks.some(task => !task.answer?.trim())) throw new Error('Введите ответ к каждому заданию')
    for (const task of snapshot.tasks) { task.answer = task.answer!.trim(); task.answer_confirmed = true }
    const serialized = JSON.stringify(snapshot)
    if (!currentDraft.value || savedSnapshot !== serialized) {
      const fingerprint = `${currentDraft.value?.draftRevision ?? 0}:${serialized}`
      if (saveAttempt?.fingerprint !== fingerprint) saveAttempt = { fingerprint, id: crypto.randomUUID() }
      const result = await works.save(snapshot, { id: draftId, revision: currentDraft.value?.draftRevision ?? 0, familyId: currentDraft.value?.familyId, requestId: saveAttempt.id })
      if (!result.ok) { error.value = generateErrorMessage(result); return }
      currentDraft.value = result.data; savedSnapshot = serialized
    }
    const draft = currentDraft.value
    if (publishAttempt?.revision !== draft.draftRevision) publishAttempt = { revision: draft.draftRevision, id: crypto.randomUUID() }
    const result = await works.publish(draft, publishAttempt.id)
    if (!result.ok) { error.value = generateErrorMessage(result); return }
    await navigateTo({ path: '/works/view', query: { id: result.data.id, kind: 'version' } })
  } catch (cause) { error.value = generateErrorMessage(handleApiError(cause)) }
  finally { saving.value = false }
}
watch(jobs, () => { const failed = jobs.value.find(job => job.error); if (failed) error.value = failed.error }, { deep: true })
onMounted(async () => {
  if (!props.workId) return
  try {
    const result = await works.get(props.workId, 'draft')
    if (!result.ok) { error.value = generateErrorMessage(result); return }
    currentDraft.value = result.data; exam.value = result.data.spec; savedSnapshot = JSON.stringify(exam.value)
  } finally { loading.value = false }
})
</script>

<template>
  <v-form @submit.prevent="save" class="key-editor">
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-5" />
    <template v-else>
      <v-text-field v-model="exam.title" label="Тема" variant="outlined" maxlength="180" :disabled="saving || uploading" :error-messages="submitted && !exam.title.trim() ? 'Введите тему' : ''" />
      <v-file-input v-model="file" label="Файл с заданиями" accept=".pdf,.png,.jpg,.jpeg,.heic,.heif,.webp,.tif,.tiff,.txt,.docx" :prepend-icon="mdiFileDocumentOutline" variant="outlined" :loading="uploading" :disabled="saving || uploading || !exam.title.trim()" @update:model-value="upload" />
      <p v-if="uploading || mathLoading" class="progress-text" role="status">Распознаём задания…</p>
      <v-progress-linear v-if="uploading || mathLoading" indeterminate color="primary" class="mb-5" />
      <ErrorMessage v-if="error" v-model="error" role="alert" class="mb-5" />
      <template v-if="exam.tasks.length">
        <p v-if="exam.instructions" class="instructions">{{ exam.instructions }}</p>
        <div v-for="(task, index) in exam.tasks" :key="task.id" class="task-row">
          <div class="task-heading"><h2>Задание {{ index + 1 }}</h2><v-btn :icon="mdiDeleteOutline" variant="text" size="small" :disabled="saving" aria-label="Удалить задание" @click="studio.removeTask(index)" /></div>
          <v-textarea v-model="task.prompt" label="Условие" variant="outlined" rows="3" auto-grow :disabled="saving || uploading" maxlength="20000" hide-details="auto" />
          <ol v-if="task.options.length" class="task-options"><li v-for="(option, optionIndex) in task.options" :key="optionIndex">{{ option }}</li></ol>
          <v-img v-for="image in task.images" :key="image.id" :src="`data:image/png;base64,${image.data_base64}`" :alt="image.caption" max-height="160" contain class="mt-3" />
          <v-text-field v-model="task.answer" label="Ответ" variant="outlined" maxlength="1500" class="mt-3" :disabled="saving || uploading" :error-messages="submitted && !task.answer?.trim() ? 'Введите ответ' : ''" hide-details="auto" />
        </div>
        <div v-for="figure in figures.filter(figure => !figure.taskId)" :key="figure.id" class="imported-figure">
          <v-img :src="`data:image/png;base64,${figure.data_base64}`" height="100" width="160" contain />
          <v-select :model-value="figure.taskId" :items="exam.tasks.map((task, index) => ({ title: `Задание ${index + 1}`, value: task.id }))" label="К какому заданию относится рисунок" variant="outlined" hide-details @update:model-value="assignFigure(figure, $event)" />
        </div>
        <v-btn type="submit" color="primary" :loading="saving" :disabled="uploading || mathLoading" class="mt-4">Сохранить</v-btn>
      </template>
    </template>
  </v-form>
</template>

<style scoped>
.key-editor { max-width: 820px; }
.task-row { padding-block: clamp(16px, 3vw, 24px); border-bottom: 1px solid rgb(var(--v-theme-border)); }
.task-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.task-heading h2 { font-size: clamp(18px, 2vw, 22px); font-weight: 500; }
.instructions { white-space: pre-wrap; line-height: 1.6; margin-block: 16px; }
.task-options { padding-left: 24px; margin-top: 12px; }
.progress-text { color: rgb(var(--v-theme-muted)); font-size: 14px; margin-bottom: 12px; }
.imported-figure { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 20px; }
.imported-figure > :last-child { flex: 1; min-width: 220px; }
</style>
