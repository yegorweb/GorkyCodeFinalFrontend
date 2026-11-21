// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  typescript: { strict: true, tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } } },
  devtools: { enabled: true },
  modules: ['vuetify-nuxt-module', 'nuxt-svgo', '@nuxt/fonts'],

  css: ['~/assets/styles/main.scss'],

  runtimeConfig: {
    public: {
      apiBase: '', // can be overridden by NUXT_PUBLIC_API_BASE environment variable
      siteUrl: '', // can be overridden by NUXT_PUBLIC_SITE_URL environment variable
      preparationBase: '',
    },
  },

  app: {
    head: {
      htmlAttrs: {
        lang: 'ru'
      },
      link: [
        { rel: 'icon', href: '/favicon.ico' },
      ]
    }
  },

  nitro: { preset: 'static', prerender: { crawlLinks: false, routes: ['/', '/auth/login', '/works', '/works/new', '/works/view', '/works/check', '/works/results'] } },

  features: {
    inlineStyles: false
  },

  vuetify: {
    vuetifyOptions: './vuetify.config.ts',
    moduleOptions: {
      prefixComposables: true,
    },
  },

  svgo: {
    defaultImport: 'skipsvgo',
  },

  fonts: {
    defaults: {
      preload: true,
    },
    families: [
      {
        name: 'Google Sans',
        provider: 'google',
        global: true,
      },
      {
        name: 'Unbounded',
        provider: 'google',
      },
    ],
  },

  devServer: {
    port: Number(import.meta.env.NUXT_DEV_PORT || 3000)
  },

  vite: {
    optimizeDeps: {
      include: [
        '@mdi/js',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'vee-validate',
      ]
    },
  },

  imports: {
    imports: [
      {
        from: 'ofetch',
        name: 'FetchError',
        declarationType: 'class',
        type: true
      },
      {
        from: 'ofetch',
        name: 'FetchError',
        declarationType: 'class',
      },
    ],
    presets: [
      {
        from: 'vee-validate',
        imports: ['useForm', 'useField'],
      },
    ],
  }
})
