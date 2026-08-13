import type { AppSettings, ImageBlurMode } from '../../store/AppSettings'

export const setGameBananaBlurMode = (settings: AppSettings, mode: ImageBlurMode): void => {
  if (settings.gamebananaHideNsfw && mode === 'nsfw') return
  settings.gamebananaBlurMode = mode
  if (settings.gamebananaHideNsfw) settings.gamebananaRestoreNsfwAfterHide = false
}

export const setGameBananaHideNsfw = (settings: AppSettings, hidden: boolean): void => {
  if (hidden === settings.gamebananaHideNsfw) return

  settings.gamebananaHideNsfw = hidden
  if (hidden && settings.gamebananaBlurMode === 'nsfw') {
    settings.gamebananaBlurMode = 'none'
    settings.gamebananaRestoreNsfwAfterHide = true
    return
  }

  if (!hidden && settings.gamebananaRestoreNsfwAfterHide && settings.gamebananaBlurMode === 'none') {
    settings.gamebananaBlurMode = 'nsfw'
  }
  settings.gamebananaRestoreNsfwAfterHide = false
}
