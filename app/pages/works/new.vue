<script setup lang="ts">
definePageMeta({ auth: true })
useSeoMeta({ title: 'Создание работы' })
const route = useRoute()
const workId = computed(() => queryString(route.query.id) || undefined)
</script>
<template><main><v-container class="studio-container"><BackButton /><h1 class="back-page-title">{{ workId ? 'Редактирование работы' : 'Новая работа' }}</h1><TestStudioEditor :work-id="workId" /></v-container></main></template>
<style scoped>
.studio-container { max-width: 1136px; padding-block: 16px 48px; }
h1 { margin-bottom: 24px; }
</style>
