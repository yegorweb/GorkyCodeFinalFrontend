<script setup lang="ts">
import { mdiArrowLeft } from '@mdi/js'

const router = useRouter()
const auth = useAuth()

const back = () => {
  if (auth.loggedIn.value && router.options.history.state.back) {
    router.back()
  } else {
    router.replace('/')
  }
}
</script>

<template>
  <div class="d-flex">
    <div
      @click="back"
      class="d-flex pt-1 pr-3 pb-1 cursor-pointer flex-row flex-nowrap align-center justify-start user-select-none"
    >
      <v-icon :icon="mdiArrowLeft" />
      <div style="font-weight: 500;" class="ml-1">назад</div>
    </div>
  </div>
</template>
