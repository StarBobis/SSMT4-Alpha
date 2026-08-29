import { copyFile, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { dirname, join, localDataDir, resourceDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { SSMTFileUtils } from '../utils/SSMTFileUtils'
import { AppSettings } from './AppSettings'
import { AppStateManager } from './AppStateManager'

export class GlobalConfig {
  private static saveQueue: Promise<void> = Promise.resolve()
  private static installDirPromise: Promise<string> | null = null

  public static async AppDataLocalFolder(): Promise<string> {
    return await localDataDir()
  }

  /// 安装目录（可执行文件所在目录）。默认缓存位置从 AppData 迁移到安装目录，
  /// 用户清理/卸载时能直观看到缓存在哪里。
  public static async SSMTInstallDir(): Promise<string> {
    if (!this.installDirPromise) {
      this.installDirPromise = (async () => {
        try {
          const dir = await invoke<string>('ssmt_install_directory')
          if (dir && dir.trim()) return dir.trim()
        } catch (error) {
          console.warn('Failed to resolve SSMT install directory:', error)
        }
        try {
          const res = await resourceDir()
          if (res && res.trim()) return res.trim()
        } catch (error) {
          console.warn('Failed to resolve SSMT resource directory:', error)
        }
        return ''
      })()
    }
    return this.installDirPromise
  }

  public static async SSMT4GlobalConfigsFolder(): Promise<string> {
    return join(await this.AppDataLocalFolder(), 'SSMT4GlobalConfigs')
  }

  public static async AppSettingsFilePath(): Promise<string> {
    return join(await this.SSMT4GlobalConfigsFolder(), 'settings.json')
  }

  public static async EnsureFirstRunMarker(): Promise<boolean> {
    const folder = await this.SSMT4GlobalConfigsFolder()
    const lockedMarker = await join(folder, '.lockedfirst')
    const marker = await join(folder, '.notfirst')
    // Development/testing override: keep onboarding enabled without mutating .notfirst.
    if (await exists(lockedMarker)) return true
    if (await exists(marker)) return false
    await mkdir(folder, { recursive: true })
    await writeTextFile(marker, '')
    return true
  }

  public static async MarkTextureConfigFilePath(): Promise<string> {
    return join(await this.SSMT4GlobalConfigsFolder(), 'MarkTextureConfig.json')
  }

  public static async SSMT4DefaultCacheFolder(): Promise<string> {
    return join(await this.SSMTInstallDir(), 'SSMT4CachedFolder')
  }

  public static async MarkTextureResultFolder(): Promise<string> {
    return join(await this.SSMT4CustomCacheFolder(), 'MarkTexture')
  }

  private static async TryGetCacheDirFromStateManager(): Promise<string> {
    try {
      const cacheDir = (AppStateManager.appSettings.DBMTWorkFolder || '').trim()
      return cacheDir
    } catch (e) {
      return ''
    }
  }


  //获取缓存文件夹位置统一使用这个接口，优先级：AppStateManager > settings.json配置 > 默认位置（安装目录）
  //注意：未设置（DBMTWorkFolder 为空）时这里仍回退到默认位置，避免内部代码写入相对路径；
  //“必须设置缓存目录才能使用程序”的强制拦截由 App.vue 的引导/强制弹窗负责。
  public static async SSMT4CustomCacheFolder(): Promise<string> {
    const cacheDirFromStateManager = await this.TryGetCacheDirFromStateManager()
    if (cacheDirFromStateManager) {
      return cacheDirFromStateManager
    }

    try {
      const settingsPath = await this.AppSettingsFilePath()
      if (await exists(settingsPath)) {
        const raw = await readTextFile(settingsPath)
        const parsed = JSON.parse(raw) as { DBMTWorkFolder?: unknown }
        const cacheDir = typeof parsed.DBMTWorkFolder === 'string' ? parsed.DBMTWorkFolder.trim() : ''
        if (cacheDir) {
          return cacheDir
        }
      }
    } catch (e) {
      // ignore and fallback
    }

    return await this.SSMT4DefaultCacheFolder()
  }

  public static async GlobalGamesFolder(): Promise<string> {
    return join(await this.SSMT4GlobalConfigsFolder(), 'Games')
  }

  public static async GlobalGameIconConfigFilePath(): Promise<string> {
    return join(await this.GlobalGamesFolder(), 'GameIconConfig.json')
  }

  public static async TextureConfigsFolder(): Promise<string> {
    return join(await this.SSMT4GlobalConfigsFolder(), 'TextureConfigs')
  }

  public static async TextureConfigsGameFolder(gameName: string): Promise<string> {
    return join(await this.TextureConfigsFolder(), gameName)
  }

  public static async SSMTResourcesFolder(): Promise<string> {
    try {
      const res = await resourceDir()
      if (res) {
        const nested = await join(res, 'resources')
        if (await exists(nested)) return nested
        if (await exists(res)) return res
      }
    } catch (e) {}

    try {
      if (await exists('src-tauri/resources')) return 'src-tauri/resources'
      if (await exists('resources')) return 'resources'
    } catch (e) {}

    try {
      const r = await resourceDir()
      return r || '.'
    } catch (e) {
      return '.'
    }
  }

  public static async SSMTResourcesGamesFolder(): Promise<string> {
    return join(await this.SSMTResourcesFolder(), 'Games')
  }

  private static async ensureSettingsDirectory(settingsPath: string): Promise<void> {
    const dir = await dirname(settingsPath)
    await SSMTFileUtils.CreateFolderIfNotExists(dir)
  }

  private static async ensureCacheDir(existing?: string): Promise<string> {
    if (existing && existing.trim()) {
      await SSMTFileUtils.CreateFolderIfNotExists(existing)
      return existing
    }

    // 不再静默回退到默认位置：缓存目录必须由用户显式选择
    // （首次启动引导页或“未设置缓存目录”强制弹窗）。
    // 未设置时保持空值，由前端拦截并阻止使用程序。
    return ''
  }

  private static async buildCorruptedBackupFilePath(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return join(await this.SSMT4GlobalConfigsFolder(), `settings.corrupted.${stamp}.json`)
  }

  private static async backupCorruptedSettingsFile(settingsPath: string): Promise<string | null> {
    try {
      if (!(await exists(settingsPath))) {
        return null
      }

      const backupPath = await this.buildCorruptedBackupFilePath()
      await copyFile(settingsPath, backupPath)
      return backupPath
    } catch (error) {
      console.error('Failed to create corrupted settings backup:', error)
      return null
    }
  }

  private static async writeSettingsFile(settings: AppSettings): Promise<void> {
    const resolvedPath = await this.AppSettingsFilePath()
    await this.ensureSettingsDirectory(resolvedPath)

    settings.DBMTWorkFolder = await this.ensureCacheDir(settings.DBMTWorkFolder)

    await writeTextFile(resolvedPath, JSON.stringify(settings.toJSON(), null, 2))
  }

  static async ReadConfig(): Promise<AppSettings> {
    const resolvedPath = await this.AppSettingsFilePath()
    await this.ensureSettingsDirectory(resolvedPath)

    let parsed: Partial<AppSettings> | null = null
    let fileExists = false
    try {
      fileExists = await exists(resolvedPath)
      if (fileExists) {
        const content = await readTextFile(resolvedPath)
        parsed = JSON.parse(content) as Partial<AppSettings>
      }
    } catch (err) {
      const backupPath = fileExists
        ? await this.backupCorruptedSettingsFile(resolvedPath)
        : null
      console.error('Failed to parse settings file, using in-memory defaults without overwriting the source file:', err)
      if (backupPath) {
        console.warn('Corrupted settings backup created at:', backupPath)
      }
    }

    const settings = AppSettings.fromJSON(parsed ?? {})
    settings.DBMTWorkFolder = await this.ensureCacheDir(settings.DBMTWorkFolder)

    if (!fileExists) {
      await this.SaveConfig(settings)
    }

    return settings
  }

  static async SaveConfig(settings: AppSettings): Promise<void> {
    const model = new AppSettings({ ...settings })
    this.saveQueue = this.saveQueue
      .catch((error) => {
        console.error('Previous settings save failed:', error)
      })
      .then(async () => {
        await this.writeSettingsFile(model)
      })

    await this.saveQueue
  }
}
