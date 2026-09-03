export type AppThemeMode = 'dark' | 'light'

export const APP_THEME_MODES: readonly AppThemeMode[] = ['dark', 'light']

export const normalizeAppThemeMode = (value: unknown): AppThemeMode =>
  value === 'light' ? 'light' : 'dark'

/**
 * Applies the shell (navigation chrome) theme mode. Sub-pages keep their own
 * glass styling; this only drives the WinUI3-style sidebar + caption bar via
 * the `[data-app-theme]` CSS custom properties in styles/shell.css.
 */
export const applyAppThemeMode = (mode: AppThemeMode) => {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.appTheme = mode
}

const APP_THEME_COLORS = {
  accent: '#FFFFFF',
  accentHover: '#FFFFFF',
  surfaceTint: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: '#FFFFFF',
  success: '#018B8D',
  warning: '#F9D46C',
  danger: '#C8161D',
  tooltipBg: '#000000',
} as const

type AppThemeColorName = keyof typeof APP_THEME_COLORS

const hexToRgb = (hex: string): string => {
  const normalized = hex.slice(1)
  const value = Number.parseInt(normalized, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `${r}, ${g}, ${b}`
}

const setColorVar = (
  style: CSSStyleDeclaration,
  name: string,
  value: string,
) => {
  style.setProperty(`--${name}`, value)
  style.setProperty(`--${name}-rgb`, hexToRgb(value))
}

export const applyAppThemeColors = () => {
  if (typeof document === 'undefined') {
    return
  }

  const style = document.documentElement.style
  const colors: Record<AppThemeColorName, string> = APP_THEME_COLORS

  setColorVar(style, 'theme-accent', colors.accent)
  setColorVar(style, 'theme-accent-hover', colors.accentHover)
  setColorVar(style, 'theme-surface-tint', colors.surfaceTint)
  setColorVar(style, 'theme-text-primary', colors.textPrimary)
  setColorVar(style, 'theme-text-secondary', colors.textSecondary)
  setColorVar(style, 'theme-success', colors.success)
  setColorVar(style, 'theme-warning', colors.warning)
  setColorVar(style, 'theme-danger', colors.danger)
  setColorVar(style, 'theme-tooltip-bg', colors.tooltipBg)

  style.setProperty('--el-color-primary', colors.accent)
  style.setProperty('--el-color-primary-dark-2', colors.accentHover)
  style.setProperty('--el-color-primary-light-3', `rgba(${hexToRgb(colors.accent)}, 0.72)`)
  style.setProperty('--el-color-primary-light-5', `rgba(${hexToRgb(colors.accent)}, 0.52)`)
  style.setProperty('--el-color-primary-light-7', `rgba(${hexToRgb(colors.accent)}, 0.30)`)
  style.setProperty('--el-color-primary-light-8', `rgba(${hexToRgb(colors.accent)}, 0.20)`)
  style.setProperty('--el-color-primary-light-9', `rgba(${hexToRgb(colors.accent)}, 0.10)`)
}
