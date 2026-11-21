<script setup lang="ts">
definePageMeta({ auth: true })
useSeoMeta({ title: 'Создание работы' })
const route = useRoute()
const workId = computed(() => queryString(route.query.id) || undefined)
</script>
<template><main><v-container class="studio-container"><BackButton /><h1>{{ workId ? 'Редактирование работы' : 'Новая работа' }}</h1><TestStudioEditor :work-id="workId" /></v-container></main></template>
<style scoped>
.studio-container { max-width: 1360px; padding-block: 16px 64px; padding-inline: clamp(16px, 3vw, 32px); }
h1 { font-size: clamp(24px, 2.2vw, 32px); font-weight: 500; margin-block: 16px 24px; }
</style>
