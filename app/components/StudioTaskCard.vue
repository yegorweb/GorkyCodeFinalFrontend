<script setup lang="ts">
import { mdiArrowUp, mdiArrowDown, mdiDeleteOutline, mdiContentCut, mdiImagePlus } from '@mdi/js'
const task = defineModel<StudioTask>({ required: true })
defineProps<{ index: number; count: number; reviewMode?: boolean; estimate?: StudioEstimate; keyMode?: boolean }>()
const emit = defineEmits<{ remove: []; move: [direction: number]; split: [position: number]; merge: []; instructions: [] }>()
const prompt = useTemplateRef('prompt')
const error = ref<string>()
const optionsText = computed({ get: () => task.value.options.join('\n'), set: value => { task.value.options = value.split('\n') } })
async function addImage(files: File | File[]) {
  const file = Array.isArray(files) ? files[0] : files
  if (!file) return
  error.value = undefined
  try {
    if (file.type !== 'image/png' || file.size > 2 * 1024 * 1024 || (task.value.images?.length ?? 0) >= 4) throw new Error('Можно прикрепить до 4 PNG, каждый не больше 2 МБ.')
    const buffer = await file.arrayBuffer()
    const view = new DataView(buffer)
    if (buffer.byteLength < 24 || view.getUint32(16) * view.getUint32(20) > 4000000) throw new Error('Изображение должно быть не больше 4 млн пикселей.')
    ;(task.value.images ??= []).push({ id: crypto.randomUUID(), data_base64: encodeBase64(buffer), caption: '' })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось добавить рисунок.' }
}
function split() {
  const field = prompt.value?.$el.querySelector('textarea') as HTMLTextAreaElement | null
  emit('split', field?.selectionStart ?? 0)
}
function subparts() {
  task.value.prompt = [task.value.prompt, ...task.value.options.map((option, i) => `${'абвгдежз'[i] ?? i + 1}) ${option}`)].join('\n')
  task.value.options = []
  if (task.value.kind === 'choice') task.value.kind = 'long'
}
</script>

<template>
  <v-card variant="outlined" class="studio-task" rounded="lg">
    <div class="task-heading">
      <h3>Задание {{ index + 1 }}</h3>
      <div class="d-flex">
        <v-btn :icon="mdiArrowUp" variant="text" size="small" :disabled="index === 0" aria-label="Поднять задание" @click="emit('move', -1)" />
        <v-btn :icon="mdiArrowDown" variant="text" size="small" :disabled="index === count - 1" aria-label="Опустить задание" @click="emit('move', 1)" />
        <v-btn :icon="mdiDeleteOutline" variant="text" size="small" aria-label="Удалить задание" @click="emit('remove')" />
      </div>
    </div>
    <p v-if="reviewMode && task.sourceLabel" class="task-notes">{{ task.sourceLabel }}</p>
    <ul v-if="task.review_notes?.length" class="task-notes"><li v-for="note in task.review_notes" :key="note">{{ note }}</li></ul>
    <v-expansion-panels v-if="task.source_text" variant="accordion" class="mb-3"><v-expansion-panel title="Исходный текст"><v-expansion-panel-text><pre class="source-text">{{ task.source_text }}</pre></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
    <v-textarea ref="prompt" v-model="task.prompt" label="Условие" variant="outlined" rows="3" auto-grow maxlength="20000" hide-details="auto" @update:model-value="task.answer_confirmed = false" />
    <v-textarea v-if="task.kind === 'choice' || task.options.length" v-model="optionsText" class="mt-3" label="Варианты ответа — по одному на строке" variant="outlined" rows="3" auto-grow hide-details="auto" @update:model-value="task.answer_confirmed = false" />
    <v-row class="mt-2">
      <v-col cols="12" sm="6"><v-select v-model="task.kind" :items="studioKinds" label="Тип ответа" variant="outlined" density="compact" hide-details="auto" /></v-col>
      <v-col cols="12" sm="6"><v-select v-model="task.paper" :items="studioPapers" label="Поле решения" variant="outlined" density="compact" hide-details="auto" /></v-col>
      <v-col cols="12" sm="6"><v-text-field :model-value="task.lines" type="number" min="1" max="60" label="Строки ответа" placeholder="Авто" variant="outlined" density="compact" hide-details="auto" @update:model-value="task.lines = $event === '' || $event === null ? null : Number($event)" /></v-col>
    </v-row>
    <p v-if="estimate" class="estimate">{{ estimate.source === 'manual' ? 'Вручную' : 'Оценка места' }}: {{ estimate.lines }} строк · {{ Math.round(estimate.height_mm) }} мм. {{ estimate.reasons.join('; ') }}</p>
    <v-expansion-panels variant="accordion" class="mt-3">
      <v-expansion-panel v-if="keyMode" title="Ответ и тема задания — не печатаются"><v-expansion-panel-text>
        <v-text-field v-model="task.topic" label="Тема задания" maxlength="300" placeholder="Укажите при необходимости" variant="outlined" />
        <v-select v-model="task.answer_type" :items="[{ title: 'Текст', value: 'text' }, { title: 'Число', value: 'number' }, { title: 'Последовательность', value: 'sequence' }, { title: 'Набор вариантов', value: 'choice_set' }, { title: 'Соответствие', value: 'matching' }, { title: 'Верно / неверно', value: 'true_false' }]" label="Тип ответа" placeholder="Текст" variant="outlined" @update:model-value="task.answer_confirmed = false" />
        <v-textarea :model-value="task.answer ?? ''" label="Правильный ответ" maxlength="1500" variant="outlined" rows="2" auto-grow hide-details @update:model-value="task.answer = $event; task.answer_confirmed = false" />
        <v-checkbox v-model="task.answer_confirmed" :disabled="!task.answer?.trim()" label="Ответ проверен мной" hide-details />
      </v-expansion-panel-text></v-expansion-panel>
      <v-expansion-panel title="Ход решения учителя — не печатается"><v-expansion-panel-text><v-textarea v-model="task.solution_guide" label="Шаги решения" variant="outlined" rows="3" auto-grow hide-details="auto" /></v-expansion-panel-text></v-expansion-panel>
      <v-expansion-panel title="Рисунки к заданию"><v-expansion-panel-text>
        <div v-for="(image, imageIndex) in task.images" :key="image.id" class="task-image">
          <v-img :src="`data:image/png;base64,${image.data_base64}`" height="120" contain />
          <v-text-field v-model="image.caption" label="Подпись" maxlength="300" variant="outlined" density="compact" hide-details />
          <v-btn :icon="mdiDeleteOutline" variant="text" aria-label="Убрать рисунок" @click="task.images?.splice(imageIndex, 1)" />
        </div>
        <v-file-input label="Добавить PNG до 2 МБ" accept=".png,image/png" :prepend-icon="mdiImagePlus" variant="outlined" density="compact" hide-details class="mt-3" @update:model-value="addImage" />
        <ErrorMessage v-if="error" v-model="error" class="mt-2" />
      </v-expansion-panel-text></v-expansion-panel>
    </v-expansion-panels>
    <div v-if="reviewMode" class="review-actions">
      <v-btn variant="text" :prepend-icon="mdiContentCut" @click="split">Разделить у курсора</v-btn>
      <v-btn v-if="index" variant="text" @click="emit('merge')">Объединить с предыдущим</v-btn>
      <v-btn v-if="task.options.length" variant="text" @click="subparts">Это подпункты</v-btn>
      <v-btn variant="text" @click="emit('instructions')">В общую инструкцию</v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.studio-task { padding: clamp(14px, 2vw, 22px); border-color: rgb(var(--v-theme-border)); background: rgb(var(--v-theme-background)); }
.task-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
.task-heading h3 { margin: 0; font-size: 18px; font-weight: 500; }
.estimate, .task-notes { margin-top: 12px; font-size: 13px; line-height: 1.6; color: rgb(var(--v-theme-muted)); }
.task-image { display: grid; grid-template-columns: 110px 1fr 40px; align-items: center; gap: 12px; margin-block: 12px; }
.source-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.review-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
</style>
