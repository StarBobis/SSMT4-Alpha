import type { AppSettings, ImageBlurMode } from '../../store/AppSettings'

export const setGameBananaBlurMode = (settings: AppSettings, mode: ImageBlurMode): void => {
  if (!settings.gamebananaShowNsfw && mode === 'nsfw') return
  settings.gamebananaBlurMode = mode
  if (!settings.gamebananaShowNsfw) settings.gamebananaRestoreNsfwAfterHide = false
}

export const setGameBananaShowNsfw = (settings: AppSettings, shown: boolean): void => {
  if (shown === settings.gamebananaShowNsfw) return

  settings.gamebananaShowNsfw = shown
  if (!shown && settings.gamebananaBlurMode === 'nsfw') {
    settings.gamebananaBlurMode = 'none'
    settings.gamebananaRestoreNsfwAfterHide = true
    return
  }

  if (shown && settings.gamebananaRestoreNsfwAfterHide && settings.gamebananaBlurMode === 'none') {
    settings.gamebananaBlurMode = 'nsfw'
  }
  settings.gamebananaRestoreNsfwAfterHide = false
}
