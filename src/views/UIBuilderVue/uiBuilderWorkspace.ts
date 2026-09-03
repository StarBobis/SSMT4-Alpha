import { join } from '@tauri-apps/api/path'
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { AppStateManager } from '../../store/AppStateManager'

const DEFAULT_WORKSPACE_NAME = 'Default'

export interface UIBuilderContext {
  workspaceName: string
  firstHash: string
}

const normalizeWorkspaceName = (name: string): string =>
  (name || '').trim() || DEFAULT_WORKSPACE_NAME

const currentGameKey = (): string => {
  const gameName = (AppStateManager.appSettings.CurrentGameName || '').trim()
  return gameName && gameName !== 'Default' ? gameName : 'DefaultGame'
}

export const getCurrentWorkspaceName = (): string => {
  const byGame = AppStateManager.appSettings.CurrentWorkSpaceByGame || {}
  // Do NOT fall back to the global CurrentWorkSpace mirror here: for a game
  // with no remembered workspace it still holds the previously selected game's
  // workspace name, and callers (resolveWorkspaceDir) would mkdir that folder
  // under the current game — making another game's workspace appear in this
  // game's workspace list.
  const remembered = byGame[currentGameKey()] || ''
  return normalizeWorkspaceName(remembered)
}

const getWorkspaceBaseDir = async (): Promise<string | undefined> => {
  let gameName = (AppStateManager.appSettings.CurrentGameName || '').trim()
  if (!gameName || gameName === 'Default') {
    gameName = 'DefaultGame'
  }

  const root = AppStateManager.appSettings.DBMTWorkFolder
  if (!root) {
    return undefined
  }

  return join(root, 'WorkSpace', gameName)
}

const getWorkspaceDir = async (workspaceName: string): Promise<string | undefined> => {
  const baseDir = await getWorkspaceBaseDir()
  if (!baseDir) {
    return undefined
  }

  return join(baseDir, workspaceName)
}

const formatTimestamp = (): string => {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

const sanitizeHash = (hash: string): string => {
  const value = (hash || '').trim()
  return value ? value.replace(/[^A-Za-z0-9_-]+/g, '_') : 'c209c22b'
}

const tryReadText = async (path: string): Promise<string | undefined> => {
  try {
    if (!(await exists(path))) {
      return undefined
    }
    return await readTextFile(path)
  } catch {
    return undefined
  }
}

const readFirstDrawIBFromTabConfig = async (workspaceDir: string): Promise<string> => {
  const indexPath = await join(workspaceDir, 'Config', 'WorkPageTabs.json')
  const indexRaw = await tryReadText(indexPath)
  if (!indexRaw) {
    return ''
  }

  try {
    const index = JSON.parse(indexRaw) as { activeTabId?: string }
    const activeTabId = index.activeTabId
    if (!activeTabId) {
      return ''
    }

    const tabPath = await join(workspaceDir, 'Config', 'Tabs', `${activeTabId}.json`)
    const tabRaw = await tryReadText(tabPath)
    if (!tabRaw) {
      return ''
    }

    const tab = JSON.parse(tabRaw) as { modelRows?: Array<{ drawIB?: string }> }
    const first = (tab.modelRows || []).find((row) => Boolean(row.drawIB?.trim()))
    return first ? first.drawIB!.trim() : ''
  } catch {
    return ''
  }
}

const readFirstDrawIBFromLodConfigs = async (workspaceDir: string): Promise<string> => {
  try {
    const entries = await readDir(workspaceDir)
    for (const entry of entries) {
      if (!entry.isDirectory || entry.name === 'Config') {
        continue
      }

      const configPath = await join(workspaceDir, entry.name, 'Config.json')
      const raw = await tryReadText(configPath)
      if (!raw) {
        continue
      }

      const list = JSON.parse(raw)
      if (!Array.isArray(list)) {
        continue
      }

      const first = list.find(
        (item) => item && typeof item.DrawIB === 'string' && item.DrawIB.trim(),
      )
      if (first) {
        return first.DrawIB.trim()
      }
    }
  } catch {
    // Ignore and fall through.
  }

  return ''
}

const readFirstHashFromWorkspace = async (workspaceName: string): Promise<string> => {
  const workspaceDir = await getWorkspaceDir(workspaceName)
  if (!workspaceDir) {
    return ''
  }

  const fromTabConfig = await readFirstDrawIBFromTabConfig(workspaceDir)
  if (fromTabConfig) {
    return fromTabConfig
  }

  return readFirstDrawIBFromLodConfigs(workspaceDir)
}

export const resolveUIBuilderContext = async (): Promise<UIBuilderContext> => {
  const workspaceName = getCurrentWorkspaceName()
  const firstHash = await readFirstHashFromWorkspace(workspaceName)

  return {
    workspaceName,
    firstHash,
  }
}

const removeFilesMatching = async (
  dirPath: string,
  predicate: (name: string) => boolean,
): Promise<void> => {
  try {
    const entries = await readDir(dirPath)
    for (const entry of entries) {
      if (entry.isDirectory || !predicate(entry.name)) {
        continue
      }

      try {
        await remove(await join(dirPath, entry.name))
      } catch {
        // Best-effort cleanup; keep going.
      }
    }
  } catch {
    // Directory may not exist yet.
  }
}

const resolveWorkspaceDir = async (): Promise<string> => {
  const workspaceName = getCurrentWorkspaceName()
  const workspaceDir = await getWorkspaceDir(workspaceName)
  if (!workspaceDir) {
    throw new Error('无法解析当前工作空间目录')
  }

  await mkdir(workspaceDir, { recursive: true })
  return workspaceDir
}

export const saveUIBuilderINI = async (content: string, hash: string): Promise<string> => {
  const workspaceDir = await resolveWorkspaceDir()
  await removeFilesMatching(workspaceDir, (name) => /^ui_config_.*\.ini$/i.test(name))

  const filePath = await join(
    workspaceDir,
    `ui_config_${sanitizeHash(hash)}_${formatTimestamp()}.ini`,
  )
  await writeTextFile(filePath, content)
  return filePath
}

export const saveUIBuilderAssets = async (buffer: ArrayBuffer): Promise<string> => {
  const workspaceDir = await resolveWorkspaceDir()
  await removeFilesMatching(workspaceDir, (name) => /^ui_assets_.*\.zip$/i.test(name))

  const filePath = await join(workspaceDir, `ui_assets_${formatTimestamp()}.zip`)
  await writeFile(filePath, new Uint8Array(buffer))
  return filePath
}

export const saveUIBuilderPreset = async (json: string, hash: string): Promise<string> => {
  // 预设属于工作空间的设计资产，保存到当前工作空间目录下的 presets 子目录，
  // 而不是生成 Mod 目录（生成目录会在重新生成/清理时被覆盖，且与发布内容混在一起）。
  const workspaceDir = await resolveWorkspaceDir()
  const presetsFolder = await join(workspaceDir, 'presets')
  await mkdir(presetsFolder, { recursive: true })

  const filePath = await join(
    presetsFolder,
    `ui_preset_${sanitizeHash(hash)}_${formatTimestamp()}.json`,
  )
  await writeTextFile(filePath, json)
  return filePath
}

