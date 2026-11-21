# Описание
Это приложение на Nuxt. В `<template>` по возможности используй компоненты Vuetify.

# Перед запуском

## Установка зависимостей
```shell
npm i
```

# Разработка

```shell
npm run dev
```

# Сборка

```shell
npm run build
```

# Важные моменты

### Auth store
Auth store доступен с composable `useAuth`
```vue
<script setup lang="ts">
const auth = useAuth()

// На страницах с защитой
// При { required: true } user будет иметь NonNullable тип User, acccessToken будет иметь NonNullable тип string
const auth = useAuth({ required: true })
</script>
```

### Страница только для авторизированных
```vue
<script setup lang="ts">
definePageMeta({
  auth: true
})

const auth = useAuth({ required: true })
</script>
```

### API fetch

#### `useApiFetch` (from composables/useApiFetch.ts)
`useApiFetch` — это кастомный `useFetch`, который используется точно так же как `useFetch`
```ts
const { data, resfresh } = await useApiFetch('/user/get-all')
```

#### `$apiFetch` (from plugins/1.api.ts)
`$apiFetch` — это кастомный `$fetch`, находящийся в nuxtApp
```ts
const { $apiFetch } = useNuxtApp()
const res = await $apiFetch.raw('/user/get-all')
```

### Safety API fetch

Для обработки исключений рекомендую возвращать с функций значение типа `MaybePromise<StoreResponse<T>>`. <br>
`StoreResponse<T>` — это тип ответа который либо `{ ok: true, data: T }` либо `{ ok: false, message?: string, status?: number }`

#### `$apiFetchSafe` (from plugins/1.api.ts)
`$apiFetchSafe` — это асинхронная функция, вызывающая `$apiFetch` и находящийся в nuxtApp, которая возвращает `Promise<StoreResponse<T>>`
```ts
const { $apiFetchSafe } = useNuxtApp()
const res = await $apiFetchSafe('/user/get-all')
// { ok: true, data: [...] } или { ok: false, ... }
```

#### `$fetchSafe` (from plugins/1.api.ts)
`$fetchSafe` — это асинхронная функция, вызывающая `$fetch` и находящийся в nuxtApp, которая возвращает `Promise<StoreResponse<T>>`
```ts
const { $fetchSafe } = useNuxtApp()
const res = await $fetchSafe('/user/get-all')
// { ok: true, data: [...] } или { ok: false, ... }
```

#### `$apiFetchSafeWithCookies` (from plugins/1.api.ts)
`$apiFetchSafeWithCookies` — это асинхронная функция, вызывающая `$apiFetch` и находящийся в nuxtApp, которая возвращает `Promise<StoreResponse<T>>` и прокидывает cookies на клиент если вызывается с сервера. Используйте его там, где `useRequestEvent` точно вернёт `H3Event` на сервере. Если его нет, функция ничего не прокинет. 
```ts
const { $apiFetchSafeWithCookies } = useNuxtApp()
const event = useRequestEvent()
const { data, refresh } = await useAsyncData(
  () => $apiFetchSafeWithCookies(event, '/cookie-route')
)
// { ok: true, data: [...] } или { ok: false, ... }
```

#### `$fetchSafeWithCookies` (from plugins/1.api.ts)
`$fetchSafeWithCookies` — это асинхронная функция, вызывающая `$fetch` и находящийся в nuxtApp, которая возвращает `Promise<StoreResponse<T>>` и прокидывает cookies на клиент если вызывается с сервера. Используйте его там, где `useRequestEvent` точно вернёт `H3Event` на сервере. Если его нет, функция ничего не прокинет.
```ts
const { $fetchSafeWithCookies } = useNuxtApp()
const event = useRequestEvent()
const { data, refresh } = await useAsyncData(
  () => $fetchSafeWithCookies(event, '/cookie-route')
)
// { ok: true, data: [...] } или { ok: false, ... }
```

### Рекомендуемый вид store
```ts
// path: ~/composables/useUser.ts
export const useUser = () => {
  const { $apiFetchSafe } = useNuxtApp()

  async function getMyName() {
    return await $apiFetchSafe<string>('/user/my-name', { 
      method: 'GET',
    })
  }

  return {
    getMyName,
  }
}
```

## Иконки
Иконки для компонентов импортируй из `@mdi/js`, не указывай имена иконок строками.

## Поведение при действии пользователя
Если пользователь инициировал действие, требующего обращения к API или много времени, нужно сразу показать реакцию на него - загрузку на кнопку. Если действие закончилось ошибкой, то вывести эту ошибку используя `ErrorMessage`. Пример реализации:
```vue
<script setup lang="ts">
const createSubmited = ref(false)
const createError = ref()
const createLoading = ref(false)

async function submit() {
  createLoading.value = true
  const res = await useApiKey().create(values)
  if (res.ok) {
    // some actions
  } else {
    createError.value = res
  }
  createLoading.value = false
}

</script>

<template>
  <v-form @submit.prevent="(e) => { createSubmited = true; submit(e) }">
    <!-- .... -->

    <Error v-model="createError" />

    <v-btn
      type="submit"
      :loading="createLoading"
      class="bg-primary"
    >
      Создать
    </v-btn>
  </v-form>
</template>
```

## Типы
Описывать типы в app/types/, используя паттерн ниже и отдельные декларации в app/types/.
```ts
declare global {
  interface User {
    _id: string
    fullname: string
    email: string
    password: string
    roles: string[]
  }
}

export { User }
``` 

## Цвета
Если то что требуется окрасить не супер редкая вещь, то брать из vuetify.config.ts, добавлять новые туда же.

## Adaptivity
Заголовкам и прочиему тексу, который потенциально может ужасно выглядеть на малых ширинах экрана при постоянном font-size, задавать font-size: clamp(...). Применять так же к padding и прочим сайзингам.
