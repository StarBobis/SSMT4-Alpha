import { reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { convertFileSrc } from '@tauri-apps/api/core'
import { currentMonitor, getCurrentWindow, LogicalSize, primaryMonitor } from '@tauri-apps/api/window'
import { getVersion } from '@tauri-apps/api/app'
import { AppSettings, BGType, SSMTLocale } from './AppSettings'
import { applyAppThemeColors } from './AppTheme'
import { GlobalConfig } from './GlobalConfig'
import { AUTO_UPDATE_SUPPORTED_PRESET_SET } from './GamePreset'
import { ResourceManager } from './ResourceManager'
import { i18n } from '../i18n'

const t = i18n.global.t

const DEFAULT_BG_IMAGE = '/Background.png'
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 720
const MIN_WINDOW_WIDTH = 1043
const MIN_WINDOW_HEIGHT = 603
const WINDOW_SCREEN_MARGIN = 48

export interface GameInfo {
  name: string
  iconPath: string
  bgPath: string
  bgVideoPath?: string
  bgType: BGType
  showSidebar: boolean
}

// Reactive state at module level — NOT returned from store to avoid Pinia ref-unwrapping.
// External code accesses these directly via AppStateManager.isDrawerOpen / .value etc.
const isDrawerOpen = ref(false)
const appSettings = reactive(new AppSettings())
const gamesList = reactive<GameInfo[]>([])
const gamesDir = ref<string>('')

export const useAppStateStore = defineStore('appState', () => {
  const autoUpdateInFlight = new Set<string>()

  let initialStateLoaded = false
  let isInitialized = false
  let sizeListenerRegistered = false
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSettingsSave(settings: AppSettings) {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer)
    }

    const snapshot = new AppSettings({ ...settings })
    saveDebounceTimer = setTimeout(() => {
      saveDebounceTimer = null
      void GlobalConfig.SaveConfig(snapshot).catch((error) => {
        console.error('Failed to save settings:', error)
      })
    }, 250)
  }

  async function resolveSafeWindowBounds(width: number, height: number) {
    const monitor = (await currentMonitor()) ?? (await primaryMonitor())

    if (!monitor) {
      return {
        width: Math.max(Math.round(width), MIN_WINDOW_WIDTH),
        height: Math.max(Math.round(height), MIN_WINDOW_HEIGHT),
      }
    }

    const scaleFactor = monitor.scaleFactor || 1
    const workAreaWidth = monitor.workArea.size.width / scaleFactor
    const workAreaHeight = monitor.workArea.size.height / scaleFactor
    const maxWidth = Math.max(320, Math.floor(workAreaWidth - WINDOW_SCREEN_MARGIN))
    const maxHeight = Math.max(240, Math.floor(workAreaHeight - WINDOW_SCREEN_MARGIN))

    const normalizedWidth = Math.max(Math.round(width), MIN_WINDOW_WIDTH)
    const normalizedHeight = Math.max(Math.round(height), MIN_WINDOW_HEIGHT)

    return {
      width: maxWidth >= MIN_WINDOW_WIDTH ? Math.min(normalizedWidth, maxWidth) : maxWidth,
      height: maxHeight >= MIN_WINDOW_HEIGHT ? Math.min(normalizedHeight, maxHeight) : maxHeight,
    }
  }

  async function syncVersionNumberFromTauri() {
    try {
      const versionText = await getVersion()
      const versionNumber = AppSettings.parseVersionStringToNumber(versionText)
      if (versionNumber > 0) {
        AppSettings.setCurrentVersionNumber(versionNumber)
        appSettings.VersionNumber = versionNumber
      }
    } catch (err) {
      console.warn('Failed to read app version from Tauri API', err)
    }
  }

  async function registerWindowSizeListener() {
    if (sizeListenerRegistered) return
    try {
      const win = getCurrentWindow()
      await win.onResized(async ({ payload }) => {
        try {
          const factor = await win.scaleFactor()
          appSettings.windowWidth = payload.width / factor
          appSettings.windowHeight = payload.height / factor
        } catch (err) {
          console.warn('Failed to capture window size change', err)
        }
      })
      sizeListenerRegistered = true
    } catch (err) {
      console.warn('Failed to register window size listener', err)
    }
  }

  async function restoreWindowBounds(width: number, height: number) {
    try {
      const win = getCurrentWindow()
      const safeBounds = await resolveSafeWindowBounds(width, height)
      await win.setSize(new LogicalSize(safeBounds.width, safeBounds.height))
      await win.center()
    } catch (err) {
      console.warn('Failed to restore window bounds from settings', err)
    }
  }

  function reconcileSidebarGameOrder(
    games: readonly GameInfo[],
    preferredOrder: readonly string[] = appSettings.sidebarGameOrder,
  ): string[] {
    const availableNames = new Set(games.map(game => game.name))
    const seen = new Set<string>()
    const normalizedOrder: string[] = []

    for (const name of preferredOrder) {
      if (!availableNames.has(name) || seen.has(name)) {
        continue
      }

      seen.add(name)
      normalizedOrder.push(name)
    }

    for (const game of games) {
      if (seen.has(game.name)) {
        continue
      }

      seen.add(game.name)
      normalizedOrder.push(game.name)
    }

    return normalizedOrder
  }

  function setSidebarGameOrder(preferredOrder: readonly string[]) {
    appSettings.sidebarGameOrder = reconcileSidebarGameOrder(gamesList, preferredOrder)
  }

  async function prepareWindowForDisplay() {
    const savedWidth = appSettings.windowWidth
    const savedHeight = appSettings.windowHeight
    const width = savedWidth ?? DEFAULT_WINDOW_WIDTH
    const height = savedHeight ?? DEFAULT_WINDOW_HEIGHT

    await restoreWindowBounds(width, height)
  }

  async function restoreWindowBoundsFromSettings() {
    const savedWidth = appSettings.windowWidth
    const savedHeight = appSettings.windowHeight
    if (!savedWidth || !savedHeight) {
      return
    }

    const width = Math.max(savedWidth, MIN_WINDOW_WIDTH)
    const height = Math.max(savedHeight, MIN_WINDOW_HEIGHT)
    await restoreWindowBounds(width, height)
  }

  async function loadSettings() {
    try {
      await syncVersionNumberFromTauri()
      const loaded = await GlobalConfig.ReadConfig()
      console.log('Loaded settings from disk:', loaded)
      Object.assign(appSettings, loaded)
      appSettings.VersionNumber = AppSettings.getCurrentVersionNumber()
      applyAppThemeColors()
      
      void registerWindowSizeListener()
      setTimeout(() => {
        isInitialized = true
      }, 100)
    } catch (e) {
      console.error('Failed to load settings:', e)
      await ElMessageBox.alert(t('appState.messages.loadSettingsFailed', { error: String(e) }), t('appState.common.errorTitle'), {
        confirmButtonText: t('appState.common.confirm'),
        type: 'error'
      })
    }
  }

  async function loadGames() {
    try {
      const games = await ResourceManager.scanGames()

      const visibleGames = games

      console.log('Available games:', visibleGames)

      const processed = visibleGames.map(g => {
        const timestamp = Date.now()
        const icon = g.icon_path ? convertFileSrc(g.icon_path) + `?t=${timestamp}` : ''
        const bg = g.bg_path ? convertFileSrc(g.bg_path) + `?t=${timestamp}` : undefined
        const bgVideo = g.bg_video_path ? convertFileSrc(g.bg_video_path) + `?t=${timestamp}` : undefined

        return {
          name: g.name,
          iconPath: icon,
          bgPath: bg,
          bgVideoPath: bgVideo,
          bgType: g.bg_type || BGType.Image,
          showSidebar: g.show_sidebar,
        } as GameInfo
      })

      appSettings.sidebarGameOrder = reconcileSidebarGameOrder(processed)

      gamesList.splice(0, gamesList.length, ...processed)

      if (appSettings.CurrentGameName) {
        const current = gamesList.find(g => g.name === appSettings.CurrentGameName)
        if (current) {
          await selectGame(current)
        } else {
          appSettings.CurrentGameName = 'Default'
          appSettings.bgType = BGType.Image
          appSettings.bgImage = DEFAULT_BG_IMAGE
          appSettings.bgVideo = ''
        }
      } else {
        appSettings.bgType = BGType.Image
        appSettings.bgImage = DEFAULT_BG_IMAGE
        appSettings.bgVideo = ''
      }
    } catch (e) {
      console.error('Failed to scan games:', e)
    }
  }

  async function selectGame(game: GameInfo) {
    await ResourceManager.ensureGameConfigExists(game.name)
    switchToGame(game)
  }

  function switchToGame(game: GameInfo) {
    appSettings.CurrentGameName = game.name
    const useVideo = game.bgType === BGType.Video

    if (useVideo && game.bgVideoPath) {
      const newVideo = game.bgVideoPath || ''
      if (appSettings.bgType !== BGType.Video) {
        appSettings.bgType = BGType.Video
        if (appSettings.bgVideo !== newVideo) appSettings.bgVideo = newVideo
        if (appSettings.bgImage !== '') appSettings.bgImage = ''
      } else if (appSettings.bgVideo !== newVideo) {
        appSettings.bgVideo = newVideo
      }
    } else {
      const newImage = game.bgPath || ''
      const resolvedImage = newImage || DEFAULT_BG_IMAGE
      if (appSettings.bgType !== BGType.Image) {
        appSettings.bgType = BGType.Image
        if (appSettings.bgImage !== resolvedImage) appSettings.bgImage = resolvedImage
        if (appSettings.bgVideo !== '') appSettings.bgVideo = ''
      } else if (appSettings.bgImage !== resolvedImage) {
        appSettings.bgImage = resolvedImage
      }
    }

    void autoUpdateBackgroundIfNeeded(game)
  }

  function hasSelectedGame(): boolean {
    const currentGameName = appSettings.CurrentGameName.trim()
    if (!currentGameName || currentGameName === 'Default') {
      return false
    }

    if (gamesList.length === 0) {
      return true
    }

    return gamesList.some(game => game.name === currentGameName)
  }

  function hasLoadedInitialState(): boolean {
    return initialStateLoaded
  }

  async function autoUpdateBackgroundIfNeeded(game: GameInfo) {
    if (!game) return
    if (autoUpdateInFlight.has(game.name)) return

    autoUpdateInFlight.add(game.name)
    try {
      const config = await ResourceManager.loadGameConfig(game.name)
      const preset: string | undefined = config?.gamePreset

      // Only auto-update if mode is 'auto' and the preset supports it
      if (config?.backgroundUpdateMode !== 'auto') return
      if (!preset || !AUTO_UPDATE_SUPPORTED_PRESET_SET.has(preset)) return

      const targetTypes: BGType[] = [BGType.Video, BGType.Image]
      for (const target of targetTypes) {
        try {
          const result = await ResourceManager.updateGameBackground(
            game.name, preset, target,
            config.lastBackgroundUrl,
          )
          await loadGames()

          if (result.changed) {
            // Persist the new URL for future change detection
            const updatedConfig = await ResourceManager.loadGameConfig(game.name)
            updatedConfig.lastBackgroundUrl = result.url
            await ResourceManager.saveGameConfig(game.name, updatedConfig)

            ElMessage({
              message: target === BGType.Video
                ? t('appState.messages.autoUpdatedVideoBackground', { game: game.name })
                : t('appState.messages.autoUpdatedImageBackground', { game: game.name }),
              type: 'success',
              duration: 3000,
              showClose: true,
            })
          }
          break
        } catch (err) {
          if (target === BGType.Image) {
            console.warn('Auto background update failed:', err)
          }
        }
      }
    } finally {
      autoUpdateInFlight.delete(game.name)
    }
  }

  async function initAppState() {
    await loadSettings()
    // 所有游戏配置均复制到全局配置，全部功能开放。
    gamesDir.value = await ResourceManager.CopyGamesToGlobalConfig(true)
    await loadGames()
    initialStateLoaded = true
  }

  // Static init — run once on store creation
  watch(appSettings, async (newVal) => {
    if (!isInitialized) {
      console.log('Skipping save because store is not yet initialized')
      return
    }
    console.log('Saving settings:', newVal)
    scheduleSettingsSave(new AppSettings({ ...newVal }))
  }, { deep: true })

  return {
    setSidebarGameOrder,
    prepareWindowForDisplay,
    restoreWindowBoundsFromSettings,
    loadGames,
    selectGame,
    switchToGame,
    hasSelectedGame,
    hasLoadedInitialState,
    initAppState,
  }
})

// Backward-compatible wrapper
export const AppStateManager = {
  isDrawerOpen,
  appSettings,
  gamesList,
  gamesDir,
  get setSidebarGameOrder() { return useAppStateStore().setSidebarGameOrder },
  get prepareWindowForDisplay() { return useAppStateStore().prepareWindowForDisplay },
  get restoreWindowBoundsFromSettings() { return useAppStateStore().restoreWindowBoundsFromSettings },
  get loadGames() { return useAppStateStore().loadGames },
  get selectGame() { return useAppStateStore().selectGame },
  get switchToGame() { return useAppStateStore().switchToGame },
  get hasSelectedGame() { return useAppStateStore().hasSelectedGame },
  get hasLoadedInitialState() { return useAppStateStore().hasLoadedInitialState },
  get initAppState() { return useAppStateStore().initAppState },
}

export { BGType }
export { SSMTLocale }
