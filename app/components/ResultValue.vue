<script setup lang="ts">
const props = withDefaults(defineProps<{ value: unknown; depth?: number }>(), { depth: 0 })
const labels: Record<string, string> = { score: 'Баллы', max_score: 'Максимальный балл', total_score: 'Итоговый балл', grade: 'Оценка', comment: 'Комментарий', feedback: 'Обратная связь', errors: 'Ошибки', solution: 'Решение', answer: 'Ответ', expected_answer: 'Ожидаемый ответ', correct: 'Верность', tasks: 'Задания', results: 'Результаты', summary: 'Итог', explanation: 'Объяснение', student_answer: 'Ответ ученика', question: 'Задание', page_number: 'Номер листа' }
const entries = computed(() => props.value && typeof props.value === 'object' && !Array.isArray(props.value) ? Object.entries(props.value as Record<string, unknown>).filter(([key]) => !['schema_version', 'model', 'request_id', 'provider', 'tokens'].includes(key)) : [])
</script>
<template>
  <span v-if="value === null || value === undefined" class="empty-value">Нет данных</span>
  <span v-else-if="typeof value === 'boolean'">{{ value ? 'Да' : 'Нет' }}</span>
  <span v-else-if="typeof value !== 'object'" class="text-value">{{ value }}</span>
  <pre v-else-if="depth > 8" class="text-value">{{ JSON.stringify(value, null, 2) }}</pre>
  <ol v-else-if="Array.isArray(value)" class="result-array"><li v-for="(item, index) in value" :key="index"><ResultValue :value="item" :depth="depth + 1" /></li></ol>
  <dl v-else class="result-object"><div v-for="[key, item] in entries" :key="key"><dt>{{ labels[key] ?? key.replaceAll('_', ' ') }}</dt><dd><ResultValue :value="item" :depth="depth + 1" /></dd></div></dl>
</template>
<style scoped>
.result-object { display: grid; gap: 14px; }
.result-object dt { font-weight: 500; margin-bottom: 6px; }
.result-object dd { margin: 0; padding-left: 12px; border-left: 2px solid rgb(var(--v-theme-border)); }
.result-array { padding-left: 24px; }
.result-array li + li { margin-top: 16px; }
.text-value { white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; line-height: 1.6; }
.empty-value { color: rgb(var(--v-theme-muted)); }
</style>
