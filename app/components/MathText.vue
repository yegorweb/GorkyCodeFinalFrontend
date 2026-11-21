<script setup lang="ts">
import katex from 'katex'

const props = defineProps<{ text: string }>()

const MATH = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$/g

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const html = computed(() => {
  let out = ''
  let last = 0
  for (const match of props.text.matchAll(MATH)) {
    out += escapeHtml(props.text.slice(last, match.index))
    const raw = match[0]
    const display = raw.startsWith('$$') || raw.startsWith('\\[')
    const start = raw.startsWith('$$') || raw.startsWith('\\(') || raw.startsWith('\\[') ? 2 : 1
    const end = raw.endsWith('$$') || raw.endsWith('\\)') || raw.endsWith('\\]') ? -2 : -1
    out += katex.renderToString(raw.slice(start, end), { throwOnError: false, displayMode: display, strict: 'ignore' })
    last = (match.index ?? 0) + raw.length
  }
  out += escapeHtml(props.text.slice(last))
  return out.replace(/\n/g, '<br>')
})
</script>

<template>
  <span class="math-text" v-html="html" />
</template>

<style scoped>
.math-text { line-height: 1.7; overflow-wrap: anywhere; }
.math-text :deep(.katex-display) { margin: 8px 0; overflow-x: auto; overflow-y: hidden; }
</style>