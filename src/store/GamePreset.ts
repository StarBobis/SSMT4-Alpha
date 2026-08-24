export const GAME_PRESET_VALUES = [
  'GIMI',
  'HIMI',
  'SRMI',
  'ZZMI',
  'ZZMIDX12',
  'WWMI',
  'EFMI',
  'NTEMI',
  'GF2',
  'IdentityV',
  'AILIMIT',
  'DOAV',
  'SnowBreak',
  'YYSLS',
  'APMI',
  'Naraka',
  'NarakaM',
] as const

export type GamePreset = (typeof GAME_PRESET_VALUES)[number]

/** Player-facing names. Preset codes remain the only persisted/API values. */
export const GAME_PRESET_DISPLAY_NAME_EN: Readonly<Record<GamePreset, string>> = {
  GIMI: 'Genshin Impact', HIMI: 'Honkai Impact 3rd', SRMI: 'Honkai: Star Rail',
  ZZMI: 'Zenless Zone Zero', ZZMIDX12: 'Zenless Zone Zero (DirectX 12)',
  WWMI: 'Wuthering Waves', EFMI: 'Arknights: Endfield', NTEMI: 'Neverness to Everness',
  GF2: 'Girls\' Frontline 2: Exilium', IdentityV: 'Identity V', AILIMIT: 'AI LIMIT',
  DOAV: 'Dead or Alive Xtreme: Venus Vacation', SnowBreak: 'Snowbreak: Containment Zone',
  YYSLS: 'Where Winds Meet', APMI: 'Azur Promilia', Naraka: 'NARAKA: BLADEPOINT',
  NarakaM: 'NARAKA: BLADEPOINT Mobile',
}

export const GAME_PRESET_DISPLAY_NAME_ZHS: Readonly<Record<GamePreset, string>> = {
  GIMI: '原神', HIMI: '崩坏3', SRMI: '崩坏：星穹铁道', ZZMI: '绝区零',
  ZZMIDX12: '绝区零（DirectX 12）', WWMI: '鸣潮', EFMI: '明日方舟：终末地',
  NTEMI: '异环', GF2: '少女前线2：追放', IdentityV: '第五人格', AILIMIT: '无限机兵',
  DOAV: '死或生：沙滩排球 维纳斯假期', SnowBreak: '尘白禁区', YYSLS: '燕云十六声',
  APMI: '蓝色星原：旅谣', Naraka: '永劫无间', NarakaM: '永劫无间手游',
}

export const GAME_PRESET_DISPLAY_NAME_ZHT: Readonly<Record<GamePreset, string>> = {
  GIMI: '原神', HIMI: '崩壞3', SRMI: '崩壞：星穹鐵道', ZZMI: '絕區零',
  ZZMIDX12: '絕區零（DirectX 12）', WWMI: '鳴潮', EFMI: '明日方舟：終末地',
  NTEMI: '異環', GF2: '少女前線2：追放', IdentityV: '第五人格', AILIMIT: '無限機兵',
  DOAV: '生死格鬥：沙灘排球 維納斯假期', SnowBreak: '塵白禁區', YYSLS: '燕雲十六聲',
  APMI: '藍色星原：旅謠', Naraka: '永劫無間', NarakaM: '永劫無間手遊',
}

export function getGamePresetDisplayName(value: string | null | undefined, locale = 'en'): string {
  const normalized = (value || '').trim()
  if (!GAME_PRESET_SET.has(normalized)) return normalized
  const normalizedLocale = locale.toLowerCase()
  const names = normalizedLocale === 'zhs' || normalizedLocale.startsWith('zh-cn')
    ? GAME_PRESET_DISPLAY_NAME_ZHS
    : normalizedLocale === 'zht' || normalizedLocale.startsWith('zh-tw') || normalizedLocale.startsWith('zh-hk')
      ? GAME_PRESET_DISPLAY_NAME_ZHT
      : GAME_PRESET_DISPLAY_NAME_EN
  return names[normalized as GamePreset]
}

const GAME_PRESET_SET: ReadonlySet<string> = new Set(GAME_PRESET_VALUES)

export const MIHOYO_GAME_PRESET_VALUES = [
  'GIMI',
  'HIMI',
  'SRMI',
  'ZZMI',
  'ZZMIDX12',
] as const

const MIHOYO_GAME_PRESET_SET: ReadonlySet<string> = new Set(MIHOYO_GAME_PRESET_VALUES)

export const getGamePresetOptions = (locale = 'en'): ReadonlyArray<{ label: string; value: GamePreset }> =>
  GAME_PRESET_VALUES.map(preset => ({
    label: getGamePresetDisplayName(preset, locale),
    value: preset,
  }))

/** @deprecated Use getGamePresetOptions(locale) in player-facing UI. */
export const GAME_PRESET_OPTIONS = getGamePresetOptions('en')

export function isMihoyoGamePreset(gamePreset: unknown): boolean {
  const normalizedPreset = typeof gamePreset === 'string' ? gamePreset.trim().toUpperCase() : ''
  return MIHOYO_GAME_PRESET_SET.has(normalizedPreset)
}

export const AUTO_UPDATE_SUPPORTED_PRESETS = [
  'GIMI',
  'HIMI',
  'SRMI',
  'ZZMI',
  'ZZMIDX12',
  'NTEMI',
  'WWMI',
] as const

export const AUTO_UPDATE_SUPPORTED_PRESET_SET: ReadonlySet<string> =
  new Set(AUTO_UPDATE_SUPPORTED_PRESETS)

export const GAME_PRESET_GITHUB_REPO_MAP: Readonly<Record<GamePreset, string>> = {
  GIMI: 'SilentNightSound/GIMI-Package',
  HIMI: 'leotorrez/HIMI-Package',
  SRMI: 'SpectrumQT/SRMI-Package',
  ZZMI: 'leotorrez/ZZMI-Package',
  ZZMIDX12: 'StarBobis/MinBase-Package',
  WWMI: 'SpectrumQT/WWMI-Package',
  EFMI: 'SpectrumQT/EFMI-Package',
  
  //异环暂时用222221的包
  NTEMI: 'ssice-a/NTMI-PACKAGE',
  
  GF2: 'SilentNightSound/GIMI-Package',
  IdentityV: 'StarBobis/MinBase-Package',
  AILIMIT: 'StarBobis/MinBase-Package',
  DOAV: 'StarBobis/MinBase-Package',
  SnowBreak: 'StarBobis/MinBase-Package',
  YYSLS: 'StarBobis/MinBase-Package',
  APMI: 'StarBobis/MinBase-Package',
  Naraka: 'StarBobis/NBP-Package',
  NarakaM: 'StarBobis/NBPM-Package',
}

export function getGithubRepoByGamePreset(gamePreset: string): string | null {
  if (Object.prototype.hasOwnProperty.call(GAME_PRESET_GITHUB_REPO_MAP, gamePreset)) {
    return GAME_PRESET_GITHUB_REPO_MAP[gamePreset as GamePreset]
  }
  return null
}

export function resolveGamePresetByGameName(gameName: string): GamePreset | null {
  if (GAME_PRESET_SET.has(gameName)) {
    return gameName as GamePreset
  }
  return null
}

export function isValidGamePreset(gamePreset: string | null | undefined): boolean {
  const normalizedPreset = (gamePreset || '').trim()
  if (!normalizedPreset) {
    return false
  }
  return GAME_PRESET_SET.has(normalizedPreset)
}
