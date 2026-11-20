<script setup lang="ts">
import { mdiAutoFix, mdiChevronDown, mdiChevronUp } from '@mdi/js'

useSeoMeta({
  title: 'Проверятор — проверяйте работы на лету',
  description: 'Создайте работу, распечатайте бланки и просканируйте ответы телефоном или веб-камерой. Проверятор поможет автоматизировать проверку.',
  ogTitle: 'Проверятор — проверяйте работы на лету',
  ogDescription: 'Уникальный формат бланков и система сканирования ускоряют проверку в десятки раз.',
})

const page = useTemplateRef('page')
const steps = [
  { title: 'Создать работу', description: 'Загрузите свои задания или темы. ИИ впишет ваши задания или поможет их придумать.' },
  { title: 'Распечатать бланки', description: 'Вы получите бланки в формате, удобном для сканирования.' },
  { title: 'Просканировать', description: 'Поставьте веб-камеру или смартфон и переберите все листы перед камерой.' },
]
const benefits = [
  { title: 'Невероятно быстро', description: 'Проверка занимает минуты.' },
  { title: 'Полная автоматизация', description: 'Всё, что требуется от вас, — задания и перебрать листы на камеру.' },
  { title: 'Преображение', description: 'ИИ возьмёт ваши задания и запишет их в шаблон в улучшенном формате.' },
]
const questions = [
  {
    question: 'Нужно ли устанавливать дополнительное программное обеспечение?',
    answer: 'Нет. Проверятор работает в браузере — устанавливать дополнительное программное обеспечение не нужно.',
  },
  {
    question: 'Можно ли использовать обычную веб-камеру?',
    answer: 'Да. Для сканирования подойдёт обычная веб-камера или камера смартфона.',
  },
  {
    question: 'Нужно ли ученикам создавать аккаунты?',
    answer: 'Нет. Ученики заполняют бумажные бланки, поэтому создавать аккаунты им не нужно.',
  },
  {
    question: 'Обязательно ли использовать специальные бланки?',
    answer: 'Да. Проверятор создаёт бланки в специальном формате, который позволяет автоматически распознавать ответы при сканировании.',
  },
  {
    question: 'Как создаются проверочные работы?',
    answer: 'На основе ваших заданий или тем. Загрузите готовые задания или укажите темы — ИИ поможет подготовить работу и разместить её на бланках.',
  },
  {
    question: 'Можно ли исправлять результаты автоматической проверки?',
    answer: 'Да. Результаты автоматической проверки можно просмотреть и исправить.',
  },
  {
    question: 'Где хранятся результаты?',
    answer: 'Результаты хранятся в Проверяторе и доступны в вашем личном кабинете.',
  },
]

let revealObserver: IntersectionObserver | undefined
let motionPreference: MediaQueryList | undefined

function showAllSections() {
  page.value?.classList.remove('reveal-ready')
  revealObserver?.disconnect()
}

function handleMotionPreference(event: MediaQueryListEvent) {
  if (event.matches) showAllSections()
}

onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', handleMotionPreference)
  if (!page.value || motionPreference.matches || !('IntersectionObserver' in window)) return

  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('is-visible')
      revealObserver?.unobserve(entry.target)
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' })

  page.value.classList.add('reveal-ready')
  page.value.querySelectorAll('[data-reveal]').forEach(element => revealObserver?.observe(element))
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  motionPreference?.removeEventListener('change', handleMotionPreference)
})
</script>

<template>
  <main ref="page" class="home-page">
    <section id="home-hero" class="home-hero" aria-labelledby="hero-title">
      <v-container class="home-container hero-container">
        <h1 id="hero-title" class="home-title hero-enter">Проверяйте работы на лету</h1>
        <p class="hero-description hero-enter" style="--enter-delay: 100ms">
          Уникальный формат бланков и система сканирования ускоряют проверку в десятки раз
        </p>
        <div class="hero-illustration hero-enter" style="--enter-delay: 200ms">
          <HomeScannerAnimation />
        </div>
        <div class="hero-enter" style="--enter-delay: 300ms">
          <v-btn
            to="/works"
            color="primary"
            variant="flat"
            height="40"
            :append-icon="mdiAutoFix"
            class="hero-try-button"
          >Попробовать</v-btn>
        </div>
      </v-container>
    </section>

    <v-container class="home-container home-content">
      <section class="home-section how-section" aria-labelledby="how-title">
        <h2 id="how-title" class="section-title" data-reveal>Как это работает?</h2>
        <v-row class="information-row">
          <v-col
            v-for="(step, index) in steps"
            :key="step.title"
            cols="12"
            md="4"
            data-reveal
            :style="{ '--reveal-delay': `${index * 90}ms` }"
          >
            <h3 class="item-title">{{ index + 1 }}. {{ step.title }}</h3>
            <p class="item-description">{{ step.description }}</p>
          </v-col>
        </v-row>
      </section>

      <section class="home-section benefits-section" aria-labelledby="benefits-title">
        <h2 id="benefits-title" class="section-title" data-reveal>Зачем мне это?</h2>
        <v-row class="information-row">
          <v-col
            v-for="(benefit, index) in benefits"
            :key="benefit.title"
            cols="12"
            md="4"
            data-reveal
            :style="{ '--reveal-delay': `${index * 90}ms` }"
          >
            <h3 class="item-title">{{ benefit.title }}</h3>
            <p class="item-description">{{ benefit.description }}</p>
          </v-col>
        </v-row>
      </section>

      <section class="preview-section" aria-label="Пример интерфейса Проверятора" data-reveal>
        <HomeProductPreview />
      </section>

      <section class="home-section faq-section" aria-labelledby="faq-title">
        <h2 id="faq-title" class="section-title" data-reveal>FAQ</h2>
        <v-expansion-panels class="faq-panels" variant="accordion" data-reveal>
          <v-expansion-panel v-for="item in questions" :key="item.question" bg-color="background">
            <v-expansion-panel-title :expand-icon="mdiChevronDown" :collapse-icon="mdiChevronUp">
              {{ item.question }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>{{ item.answer }}</v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </section>
    </v-container>
  </main>
</template>

<style scoped>
.home-page {
  color: rgb(var(--v-theme-on-background));
  background: rgb(var(--v-theme-background));
}
.home-container { max-width: 1136px; }
.home-hero {
  background: linear-gradient(to bottom, rgb(var(--v-theme-accent)), rgba(var(--v-theme-accent), 0.75) 30%, rgba(var(--v-theme-accent), 0) 95%);
}
.hero-container {
  padding-block: calc(60px + clamp(52px, 6.3vw, 86px)) clamp(56px, 6.7vw, 92px);
  text-align: center;
}
.home-title,
.section-title,
.item-title {
  margin: 0;
  font-family: 'Unbounded', sans-serif !important;
  font-weight: 400;
  text-wrap: balance;
}
.home-title { font-size: clamp(28px, 3.52vw, 48px); line-height: 1.25; }
.hero-description {
  max-width: 740px;
  margin: 14px auto 0;
  font-size: clamp(15px, 1.18vw, 16px);
  line-height: 1.5;
  text-wrap: balance;
}
.hero-illustration { margin-top: clamp(16px, 1.6vw, 22px); }
.hero-try-button {
  min-width: 174px;
  margin-top: 12px;
  font-size: 16px !important;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
}
.home-content { padding-top: 0; }
.home-section { text-align: center; }
.section-title {
  margin-bottom: clamp(28px, 3.5vw, 48px);
  font-size: clamp(25px, 2.64vw, 36px);
  line-height: 1.3;
}
.information-row { row-gap: 20px; }
.item-title { font-size: clamp(18px, 1.61vw, 22px); line-height: 1.45; }
.item-description {
  max-width: 350px;
  margin: 14px auto 0;
  font-size: clamp(16px, 1.32vw, 18px);
  line-height: 1.5;
  text-wrap: pretty;
}
.benefits-section,
.preview-section,
.faq-section { margin-top: clamp(64px, 7.6vw, 104px); }
.preview-section { max-width: 920px; margin-inline: auto; }
.faq-section { padding-bottom: clamp(64px, 8vw, 110px); }
.faq-panels { text-align: left; }
.faq-panels :deep(.v-expansion-panel) { border-bottom: 1px solid rgb(var(--v-theme-border)); }
.faq-panels :deep(.v-expansion-panel:first-child) { border-top: 1px solid rgb(var(--v-theme-border)); }
.faq-panels :deep(.v-expansion-panel-title) {
  gap: 20px;
  min-height: 76px;
  padding: clamp(18px, 1.8vw, 24px) clamp(12px, 1.8vw, 24px);
  font-size: clamp(16px, 1.46vw, 20px);
  line-height: 1.45;
}
.faq-panels :deep(.v-expansion-panel-text__wrapper) {
  padding: 0 clamp(12px, 1.8vw, 24px) 24px;
  max-width: 860px;
  font-size: clamp(15px, 1.18vw, 16px);
  line-height: 1.6;
  color: rgb(var(--v-theme-muted));
}
.hero-enter { animation: hero-appear 700ms cubic-bezier(0.2, 0.65, 0.3, 1) var(--enter-delay, 0ms) both; }
.reveal-ready [data-reveal] {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 650ms ease var(--reveal-delay, 0ms), transform 650ms cubic-bezier(0.2, 0.65, 0.3, 1) var(--reveal-delay, 0ms);
}
.reveal-ready [data-reveal].is-visible { opacity: 1; transform: translateY(0); }
@keyframes hero-appear {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 959px) {
  .home-container { padding-inline: clamp(20px, 4vw, 36px); }
  .item-description { max-width: 440px; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-enter { animation: none; }
  .reveal-ready [data-reveal] { opacity: 1; transform: none; transition: none; }
}
</style>
