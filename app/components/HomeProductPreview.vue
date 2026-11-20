<script setup lang="ts">
import { mdiCheckDecagramOutline, mdiDownload, mdiOpenInNew, mdiPlus } from '@mdi/js'
</script>

<template>
  <figure class="product-preview">
    <v-sheet class="preview-backdrop" color="secondary" rounded="xl">
      <v-sheet class="preview-window" color="background" rounded="lg" aria-label="Пример списка работ">
        <div class="preview-toolbar">
          <span class="preview-brand">Проверятор</span>
          <span class="preview-toolbar-label">Личный кабинет</span>
        </div>
        <div class="preview-content">
          <div class="preview-heading">
            <h3>Мои работы</h3>
            <span class="preview-new-work"><v-icon :icon="mdiPlus" size="16" /> Новая работа</span>
          </div>
          <div class="preview-group-heading">
            <span>Готово</span>
            <v-chip color="primary" size="x-small" variant="tonal">2 работы</v-chip>
          </div>
          <v-table class="preview-table" density="compact">
            <thead>
              <tr><th scope="col">Название</th><th scope="col">Создана</th><th scope="col">Действия</th></tr>
            </thead>
            <tbody>
              <tr v-for="work in 2" :key="work">
                <td>Фотосинтез</td>
                <td>Вчера</td>
                <td>
                  <div class="preview-actions">
                    <span><v-icon :icon="mdiCheckDecagramOutline" size="16" /> Проверить</span>
                    <span><v-icon :icon="mdiOpenInNew" size="16" /> Открыть</span>
                    <span><v-icon :icon="mdiDownload" size="16" /> Скачать бланки</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
          <div class="preview-group-heading preview-checking-heading">
            <span>Проверяется</span>
            <span class="preview-status"><span /> Сканирование</span>
          </div>
          <div class="preview-checking-work">
            <span>Фотосинтез</span>
            <span class="preview-checking-description">Листы распознаются автоматически</span>
            <v-icon :icon="mdiOpenInNew" size="16" />
          </div>
        </div>
      </v-sheet>
    </v-sheet>
    <figcaption>Пример интерфейса: ваши работы и результаты в одном месте</figcaption>
  </figure>
</template>

<style scoped>
.product-preview { margin: 0; }
.preview-backdrop {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: clamp(300px, 33.75vw, 461px);
  padding: clamp(16px, 3.8vw, 52px);
}
.preview-window {
  width: 100%;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 18px 50px rgba(var(--v-theme-primary), 0.1);
}
.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px clamp(14px, 2.3vw, 32px);
  border-bottom: 1px solid rgba(var(--v-theme-border), 0.55);
}
.preview-brand {
  font-family: 'Unbounded', sans-serif !important;
  font-size: clamp(11px, 1.05vw, 14px);
}
.preview-toolbar-label,
.preview-checking-description { font-size: 12px; color: rgb(var(--v-theme-muted)); }
.preview-content { padding: clamp(16px, 2.3vw, 32px); }
.preview-heading,
.preview-group-heading,
.preview-checking-work { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.preview-heading h3 { margin: 0; font-size: clamp(18px, 1.75vw, 24px); font-weight: 500; }
.preview-new-work {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  white-space: nowrap;
  font-size: 12px;
}
.preview-group-heading { justify-content: flex-start; margin-block: 20px 10px; font-size: 15px; }
.preview-table,
.preview-checking-work {
  border: 1px solid rgb(var(--v-theme-border));
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.4);
}
.preview-table :deep(th),
.preview-table :deep(td) { padding-inline: 12px; white-space: nowrap; font-size: 12px; }
.preview-table :deep(th) { color: rgb(var(--v-theme-muted)); }
.preview-actions { display: flex; gap: 12px; }
.preview-actions span,
.preview-status { display: inline-flex; align-items: center; gap: 4px; }
.preview-status { color: rgb(var(--v-theme-primary)); font-size: 11px; }
.preview-status > span { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.preview-checking-work { padding: 12px; font-size: 12px; }
figcaption {
  margin-top: 16px;
  text-align: center;
  font-size: clamp(12px, 1.05vw, 14px);
  line-height: 1.5;
  color: rgb(var(--v-theme-muted));
}
@media (max-width: 600px) {
  .preview-toolbar-label,
  .preview-checking-description,
  .preview-table :deep(th:nth-child(2)),
  .preview-table :deep(td:nth-child(2)),
  .preview-actions span:first-child,
  .preview-actions span:last-child { display: none; }
  .preview-checking-heading { margin-top: 16px; }
  .preview-content { padding: 14px; }
  .preview-heading { flex-wrap: wrap; }
}
</style>
