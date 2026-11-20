<script setup lang="ts">
import { mdiCheck } from '@mdi/js'

const scene = useTemplateRef('scene')
const isVisible = ref(false)
const isPageVisible = ref(true)
const isRunning = computed(() => isVisible.value && isPageVisible.value)
const papers = Array.from({ length: 6 }, (_, index) => ({
  delay: `${-index}s`,
  x: `${-40 + index * 16}cqw`,
  y: `${[0, 6, 8, 8, 6, 0][index]}cqw`,
  angle: `${-25 + index * 10}deg`,
}))

let observer: IntersectionObserver | undefined

function updatePageVisibility() {
  isPageVisible.value = !document.hidden
}

onMounted(() => {
  updatePageVisibility()
  document.addEventListener('visibilitychange', updatePageVisibility)
  if (!scene.value || !('IntersectionObserver' in window)) {
    isVisible.value = true
    return
  }
  observer = new IntersectionObserver(([entry]) => {
    isVisible.value = entry?.isIntersecting ?? false
  })
  observer.observe(scene.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', updatePageVisibility)
})
</script>

<template>
  <div
    ref="scene"
    class="scanner-scene"
    :class="{ 'is-running': isRunning }"
    role="img"
    aria-label="Листы летят по дуге перед камерой телефона. При сканировании экран загорается зелёным."
  >
    <div class="scanner-art" aria-hidden="true">
      <div
        v-for="(paper, index) in papers"
        :key="index"
        class="scanner-paper"
        :style="{
          '--paper-delay': paper.delay,
          '--rest-x': paper.x,
          '--rest-y': paper.y,
          '--rest-angle': paper.angle,
        }"
      >
        <div class="paper-heading" />
        <div class="paper-line" />
        <div class="paper-line paper-line-short" />
        <div v-for="answer in 3" :key="answer" class="paper-answer">
          <span class="paper-answer-number">{{ answer }}</span>
          <span class="paper-answer-line" />
        </div>
        <div class="paper-registration-mark" />
      </div>
      <div class="scanner-beam" />
      <v-sheet class="scanner-phone" color="ink" rounded="lg">
        <div class="phone-camera" />
        <div class="phone-screen">
          <div class="screen-corners" />
          <div class="screen-paper"><span /><span /><span /></div>
          <v-icon :icon="mdiCheck" size="24" class="screen-check" />
        </div>
        <div class="phone-button" />
      </v-sheet>
    </div>
  </div>
</template>

<style scoped>
.scanner-scene {
  width: min(960px, 100%);
  height: clamp(150px, 15.3vw, 208px);
  margin-inline: auto;
  container-type: inline-size;
}
.scanner-art {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  isolation: isolate;
  mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
}
.scanner-paper {
  position: absolute;
  top: 34%;
  left: 50%;
  width: clamp(44px, 8.8cqw, 85px);
  aspect-ratio: 0.72;
  padding: clamp(6px, 1.1cqw, 11px);
  border: 1px solid rgba(var(--v-theme-border), 0.45);
  border-radius: 3px;
  background: rgb(var(--v-theme-background));
  box-shadow: 0 7px 16px rgba(var(--v-theme-ink), 0.1);
  translate: calc(-50% + var(--rest-x)) calc(-50% + var(--rest-y));
  transform: rotate(var(--rest-angle));
  animation: paper-travel 6s linear var(--paper-delay) infinite, paper-arc 6s linear var(--paper-delay) infinite;
  animation-play-state: paused;
  will-change: translate, transform;
}
.paper-heading {
  width: 60%;
  height: 3px;
  margin-bottom: 9%;
  border-radius: 2px;
  background: rgba(var(--v-theme-ink), 0.75);
}
.paper-line,
.paper-answer-line {
  height: 2px;
  border-radius: 2px;
  background: rgba(var(--v-theme-ink), 0.2);
}
.paper-line { margin-top: 7%; }
.paper-line-short { width: 70%; margin-bottom: 18%; }
.paper-answer { display: flex; align-items: center; gap: 9%; margin-top: 10%; }
.paper-answer-number {
  font-size: clamp(5px, 0.8cqw, 8px);
  line-height: 1;
  color: rgba(var(--v-theme-ink), 0.55);
}
.paper-answer-line { flex: 1; }
.paper-registration-mark {
  position: absolute;
  bottom: 8%;
  right: 10%;
  width: 5px;
  height: 5px;
  border: 1px solid rgba(var(--v-theme-ink), 0.55);
}
.scanner-phone {
  position: absolute;
  z-index: 3;
  top: clamp(4px, 1cqw, 10px);
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: clamp(70px, 8.8cqw, 84px);
  height: clamp(132px, 17.1cqw, 164px);
  padding: 7px;
  border: 2px solid rgba(var(--v-theme-ink), 0.9);
  border-radius: 16px !important;
  box-shadow: 0 12px 22px rgba(var(--v-theme-ink), 0.2), inset 0 1px 0 rgba(var(--v-theme-background), 0.15);
  transform: translateX(-50%) rotate(-5deg);
}
.phone-camera {
  flex-shrink: 0;
  width: 20px;
  height: 3px;
  border-radius: 3px;
  background: rgba(var(--v-theme-secondary), 0.3);
}
.phone-button {
  flex-shrink: 0;
  width: 20px;
  height: 3px;
  border-radius: 3px;
  background: rgba(var(--v-theme-secondary), 0.25);
}
.phone-screen {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-secondary), 0.12);
  animation: screen-scan 1s linear infinite;
  animation-play-state: paused;
}
.screen-corners {
  position: absolute;
  inset: 12px 8px;
  border: 1px solid rgba(var(--v-theme-secondary), 0.65);
  border-radius: 4px;
}
.screen-paper {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 60%;
  aspect-ratio: 0.72;
  padding: 6px;
  transform: translate(-50%, -50%);
  border-radius: 2px;
  background: rgba(var(--v-theme-background), 0.85);
}
.screen-paper span {
  display: block;
  height: 2px;
  margin-bottom: 4px;
  background: rgba(var(--v-theme-ink), 0.25);
}
.screen-check {
  position: absolute;
  right: 6px;
  bottom: 5px;
  color: rgb(var(--v-theme-background));
  opacity: 0;
  animation: scan-confirmation 1s linear infinite;
  animation-play-state: paused;
}
.scanner-beam {
  position: absolute;
  z-index: 2;
  top: 55%;
  left: 50%;
  width: clamp(65px, 12cqw, 115px);
  height: 42%;
  background: linear-gradient(to bottom, rgba(var(--v-theme-primary), 0.02), rgba(var(--v-theme-primary), 0.12), transparent);
  clip-path: polygon(25% 0, 75% 0, 100% 100%, 0 100%);
  transform: translateX(-50%);
  opacity: 0;
  animation: scan-confirmation 1s linear infinite;
  animation-play-state: paused;
}
.is-running .scanner-paper,
.is-running .phone-screen,
.is-running .screen-check,
.is-running .scanner-beam { animation-play-state: running; }

/* Six sheets cross the centre once a second, matching the screen pulse. */
@keyframes paper-travel {
  0% {
    opacity: 0;
    translate: calc(-50% - 48cqw) -50%;
  }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% {
    opacity: 0;
    translate: calc(-50% + 48cqw) -50%;
  }
}
@keyframes paper-arc {
  0% {
    transform: translateY(-6cqw) rotate(-30deg);
    animation-timing-function: cubic-bezier(0.333333, 0.666667, 0.666667, 1);
  }
  50% {
    transform: translateY(8cqw) rotate(0deg);
    animation-timing-function: cubic-bezier(0.333333, 0, 0.666667, 0.333333);
  }
  100% { transform: translateY(-6cqw) rotate(30deg); }
}
@keyframes screen-scan {
  0%, 12% { background: rgb(var(--v-theme-primary)); }
  30%, 100% { background: rgba(var(--v-theme-secondary), 0.12); }
}
@keyframes scan-confirmation {
  0%, 12% { opacity: 1; }
  30%, 100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .scanner-paper,
  .phone-screen,
  .screen-check,
  .scanner-beam { animation: none; will-change: auto; }
  .phone-screen { background: rgb(var(--v-theme-primary)); }
  .screen-check { opacity: 1; }
}
</style>
