import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import type { AppSettings } from '../store/AppSettings'
import { SSMTLocale } from '../store/AppSettings'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import it from './locales/it.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhs from './locales/zhs.json'
import zht from './locales/zht.json'

type SettingsWithLocale = Pick<AppSettings, 'locale'>

const normalizeLocale = (locale?: string): SSMTLocale => {
  const supportedLocale = Object.values(SSMTLocale).find(item => item === locale)
  if (supportedLocale) return supportedLocale
  return SSMTLocale.en
}

export const i18n = createI18n({
  legacy: false,
  locale: SSMTLocale.en,
  fallbackLocale: SSMTLocale.en,
  messages: {
    [SSMTLocale.de]: de,
    [SSMTLocale.en]: en,
    [SSMTLocale.es]: es,
    [SSMTLocale.fr]: fr,
    [SSMTLocale.it]: it,
    [SSMTLocale.ja]: ja,
    [SSMTLocale.ko]: ko,
    [SSMTLocale.ru]: ru,
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
