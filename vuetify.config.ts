import { defineVuetifyConfiguration } from 'vuetify-nuxt-module/custom-configuration'
import { ru } from 'vuetify/locale'

export default defineVuetifyConfiguration({
  locale: {
    locale: 'ru',
    fallback: 'en',
    messages: { ru }
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#2d8315',
          secondary: '#bef6d3',
          accent: '#a6ecb5',
          surface: '#e1ede4',
          background: '#ffffff',
          success: '#2d8315',
          lime: '#a6ff00',
          border: '#d6d6d6',
          ink: '#16231b',
          muted: '#56635a'
        },
      }
    }
  },
  defaults: {
    VBtn: {
      class: 'text-body-2',
      style: 'border-radius: 8px;'
    },
    VCheckboxBtn: {
      style: 'gap: 4px;'
    },
    global: {
      ripple: false,
      elevation: 0,
    },
  },
  icons: {
    defaultSet: 'mdi-svg',
  },
  labComponents: [],
})
