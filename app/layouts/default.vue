<script lang="ts" setup>
import { mdiArrowRightBottom, mdiLogout } from '@mdi/js'

const auth = useAuth()
const route = useRoute()
const nuxtApp = useNuxtApp()
const header = useTemplateRef('header')
const isHome = computed(() => route.path === '/')
const headerOpacity = ref(0)
const { user, loggedIn } = auth
const logoutLoading = ref(false)
const logoutError = ref<Extract<StoreResponse<null>, { ok: false }>>()

let scrollFrame: number | undefined
let removePageFinishHook: (() => void) | undefined

function updateHeaderOpacity() {
  scrollFrame = undefined
  if (!isHome.value) return

  const hero = document.getElementById('home-hero')
  if (!hero) {
    headerOpacity.value = 0
    return
  }

  const fadeDistance = Math.min(160, hero.offsetHeight / 4)
  const remaining = hero.getBoundingClientRect().bottom - (header.value?.offsetHeight ?? 60)
  headerOpacity.value = Math.max(0, Math.min(1, 1 - remaining / fadeDistance))
}

function scheduleHeaderUpdate() {
  if (scrollFrame === undefined) scrollFrame = window.requestAnimationFrame(updateHeaderOpacity)
}

watch(isHome, () => {
  headerOpacity.value = 0
  if (import.meta.client) nextTick(scheduleHeaderUpdate)
})

onMounted(() => {
  window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true })
  window.addEventListener('resize', scheduleHeaderUpdate)
  removePageFinishHook = nuxtApp.hook('page:finish', scheduleHeaderUpdate)
  scheduleHeaderUpdate()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleHeaderUpdate)
  window.removeEventListener('resize', scheduleHeaderUpdate)
  if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
  removePageFinishHook?.()
})

async function logout() {
  if (logoutLoading.value) return

  logoutError.value = undefined
  logoutLoading.value = true

  try {
    const res = await auth.logout()
    if (!res.ok) logoutError.value = res
  } finally {
    logoutLoading.value = false
  }
}
</script>

<template>
  <header
    ref="header"
    class="header"
    :class="{ 'header--home': isHome }"
    :style="{ '--header-opacity': isHome ? headerOpacity : 1 }"
  >
    <v-container class="header-container d-flex align-center justify-space-between py-0">
      <NuxtLink to="/" class="header-brand">Проверятор</NuxtLink>

      <div v-if="loggedIn" class="header-account d-flex align-center">
        <span class="header-name" :title="user?.email">{{ user?.email }}</span>
        <v-btn
          :icon="mdiLogout"
          :loading="logoutLoading"
          variant="text"
          size="24"
          class="header-logout"
          aria-label="Выйти из аккаунта"
          title="Выйти"
          @click="logout"
        />
      </div>

      <v-btn
        v-else-if="isHome"
        to="/works"
        color="primary"
        variant="flat"
        height="37"
        :append-icon="mdiArrowRightBottom"
        class="header-cta"
      >
        Перейти к работе
      </v-btn>
    </v-container>

    <v-container v-if="logoutError" class="header-error py-2" role="alert">
      <ErrorMessage v-model="logoutError" />
    </v-container>
  </header>

  <NuxtPage :page-key="pageRoute => pageRoute.fullPath" />

  <v-spacer />
</template>

<style lang="postcss" scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 999;
  background: rgba(var(--v-theme-background), var(--header-opacity, 1));
  color: rgb(var(--v-theme-on-background));
  transition: background-color 200ms ease;
}

.header--home {
  margin-bottom: -60px;
}

.header-container,
.header-error {
  max-width: 1136px;
}

.header-container {
  height: 60px;
  gap: 24px;
}

.header-brand {
  flex-shrink: 0;
  color: inherit;
  font-family: 'Unbounded', sans-serif !important;
  font-size: 24px;
  font-weight: 400;
  line-height: 30px;
}

.header-account {
  min-width: 0;
  gap: 14px;
}

.header-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  line-height: 20px;
}

.header-logout {
  flex-shrink: 0;
  color: inherit;
}

.header-logout :deep(.v-icon) {
  font-size: 24px;
}

.header-cta {
  flex-shrink: 0;
  width: 274px;
  padding: 0 13px;
  font-size: 16px !important;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
}

.header-cta :deep(.v-btn__append) {
  margin-inline-start: 7px;
}

.header-cta :deep(.v-icon) {
  font-size: 24px;
}

@media (max-width: 600px) {
  .header-container {
    gap: 12px;
  }

  .header-brand {
    font-size: 18px;
  }

  .header-account {
    gap: 8px;
  }

  .header-name {
    font-size: 14px;
  }

  .header-cta {
    flex-shrink: 1;
    min-width: 0;
    width: auto;
    max-width: 274px;
    height: auto !important;
    min-height: 37px;
    padding: 6px 10px;
    font-size: 13px !important;
  }

  .header-cta :deep(.v-btn__content) {
    white-space: normal;
    line-height: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .header { transition: none; }
}
</style>
