import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import type { AppSettings } from '../store/AppSettings'
import { SSMTLocale } from '../store/AppSettings'
import en from './locales/en.json'
import zhs from './locales/zhs.json'
import zht from './locales/zht.json'

type SettingsWithLocale = Pick<AppSettings, 'locale'>

const normalizeLocale = (locale?: string): SSMTLocale => {
  if (locale === SSMTLocale.en || locale === SSMTLocale.zhs || locale === SSMTLocale.zht) {
    return locale
  }
  return SSMTLocale.en
}

export const i18n = createI18n({
  legacy: false,
  locale: SSMTLocale.en,
  fallbackLocale: SSMTLocale.en,
  messages: {
    [SSMTLocale.en]: en,
    [SSMTLocale.zhs]: zhs,
    [SSMTLocale.zht]: zht,
  },
})

export const setI18nLocale = (locale?: string): SSMTLocale => {
  const normalized = normalizeLocale(locale)
  i18n.global.locale.value = normalized
  return normalized
}

export const bindI18nLocaleToSettings = (settings: SettingsWithLocale): void => {
  watch(
    () => settings.locale,
    (nextLocale) => {
      const normalized = setI18nLocale(nextLocale)
      if (settings.locale !== normalized) {
        settings.locale = normalized
      }
    },
    { immediate: true }
  )
}
