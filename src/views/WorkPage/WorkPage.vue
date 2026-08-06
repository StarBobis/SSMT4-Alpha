<script setup lang="ts">
import { nextTick, onMounted, ref, watch, onActivated, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openPath as openExternal } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readDir, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { debugError, debugLog, debugWarn } from '../../utils/debugLog';
import { AppStateManager } from '../../store/AppStateManager';
import { PathHelper } from '../../helper/PathHelper';
import { ResourceManager } from '../../store/ResourceManager';
import { MigotoManager } from '../../store/MigotoManager';
import {
  type DrawIBConfigEntry,
  editableRowsToDrawIBConfigEntries,
  writeDrawIBConfigToWorkspace,
} from '../../common/DrawIBConfig';
import {
  open3DMigotoFolder,
  openModsFolder,
  openLatestFrameAnalysisFolder,
  openLatestFrameAnalysisLog,
  openLatestFrameAnalysisDeduped,
  openSSMT4GlobalConfigsFolder,
} from './WorkPage.OpenFolder';
import {
  runExtractModels,
  runFullExtract,
  handleTextureMenuCommand,
  type FullExtractDataTypeFilter,
} from './WorkPage.Extract';
import { generateIBSkipToMods } from './WorkPage.Generate';
import { moveFileToRecycleBin, moveDirectoryToRecycleBin } from '../../utils/RecycleBin';
import SidePanel from './SidePanel.vue';
import ExtractConfigSection from './ExtractConfigSection.vue';
import ConfigTables from './ConfigTables.vue';
import type { ModelRow, SkipRow, VSCheckRow } from './WorkPage.types';

const appSettings = AppStateManager.appSettings;
const { t } = useI18n();
const DEFAULT_WORKSPACE_NAME = 'Default';

type DrawIBSubmeshRange = {
  firstIndex: string;
  indexCount: string;
};

type WorkspaceTabMeta = {
  id: string;
  name: string;
};

type WorkPageTabsIndex = {
  activeTabId: string;
  tabs: WorkspaceTabMeta[];
};

type WorkPageTabConfig = {
  modelRows: ModelRow[];
  skipRows: SkipRow[];
  vsRows: VSCheckRow[];
  frameAnalysisFolderPath: string;
  selectedFrameAnalysis: string;
  extractPanelTab: string;
  fullExtractDataTypeFilter: FullExtractDataTypeFilter;
  convertRgbaChannelTextures: boolean;
  workPageDrawerCollapsed: {
    workspace: boolean;
    workspaceSelector: boolean;
    commonFolders: boolean;
    textureExtract: boolean;
    otherFunctions: boolean;
  };
};

type WorkspaceFrameAnalysisConfig = {
  frameAnalysisFolderPath: string;
  selectedFrameAnalysis: string;
};

type WorkspaceTabSaveSnapshot = {
  workspaceName: string;
  activeTabId: string;
  tabs: WorkspaceTabMeta[];
  tabConfig: WorkPageTabConfig;
};

// Removed unused appWindow
const workspaceName = ref('');
const workspaceDraftName = ref('');

const workspaceOptions = ref<string[]>([]);
const isScanningWorkspaces = ref(false);
const workspaceTabs = ref<WorkspaceTabMeta[]>([]);
const activeWorkspaceTabId = ref('');
const editingWorkspaceTabId = ref<string | null>(null);
const workspaceTabNameEditBackup = ref<Record<string, string>>({});
let workspaceTabSeed = 1;

const modelRows = ref<ModelRow[]>([{ drawIB: '', aliasName: '' }]);
const skipRows = ref<SkipRow[]>([{ skipIB: '', aliasName: '', indexCount: '', firstIndex: '' }]);
const vsRows = ref<VSCheckRow[]>([{ enabled: true, hash: '' }]);
const frameAnalysisOptions = ref<string[]>([]);
const selectedFrameAnalysis = ref('');
const frameAnalysisFolderPath = ref('');
const isRefreshing = ref(false);
const isExtracting = ref(false);
const isSpecificIbDumpToggling = ref(false);
const extractPanelTab = ref('drawib');
const fullExtractDataTypeFilter = ref<FullExtractDataTypeFilter>('all');
const convertRgbaChannelTextures = ref(appSettings.convertRgbaChannelTextures !== false);
const useSpecificIbDump = ref(false);
const specificIbDumpRestoreAnalyseOptions = ref('');
const workPageDrawerCollapsed = ref({
  workspace: false,
  workspaceSelector: false,
  commonFolders: false,
  textureExtract: false,
  otherFunctions: false,
});

const FULL_EXTRACT_DATA_TYPE_FILTER_OPTIONS: Array<{ value: FullExtractDataTypeFilter; labelKey: string }> = [
  { value: 'all', labelKey: 'workPage.actions.fullExtractAllDataTypes' },
  { value: 'gpu-preskinning-only', labelKey: 'workPage.actions.fullExtractGpuPreSkinningOnly' },
  { value: 'cpu-preskinning-only', labelKey: 'workPage.actions.fullExtractCpuPreSkinningOnly' },
];

const normalizeFullExtractDataTypeFilter = (
  parsed?: Partial<WorkPageTabConfig> & { onlyGpuPreSkinning?: boolean }
): FullExtractDataTypeFilter => {
  if (parsed?.fullExtractDataTypeFilter === 'gpu-preskinning-only' || parsed?.fullExtractDataTypeFilter === 'cpu-preskinning-only') {
    return parsed.fullExtractDataTypeFilter;
  }

  if (parsed?.fullExtractDataTypeFilter === 'all') {
    return 'all';
  }

  return parsed?.onlyGpuPreSkinning === true ? 'gpu-preskinning-only' : 'all';
};

const normalizeWorkPageDrawerCollapsed = (
  parsed?: Partial<WorkPageTabConfig>['workPageDrawerCollapsed']
): WorkPageTabConfig['workPageDrawerCollapsed'] => ({
  workspace: parsed?.workspace === true,
  workspaceSelector: parsed?.workspaceSelector === true,
  commonFolders: parsed?.commonFolders === true,
  textureExtract: parsed?.textureExtract === true,
  otherFunctions: parsed?.otherFunctions === true,
});


const normalizeWorkspaceNameInput = (name: string): string => name.trim();

const findExistingWorkspaceOption = (name: string): string | undefined => {
  const normalizedName = normalizeWorkspaceNameInput(name).toLowerCase();
  if (!normalizedName) {
    return undefined;
  }

  return workspaceOptions.value.find((option) => option.trim().toLowerCase() === normalizedName);
};

const waitForInitialAppState = async (): Promise<void> => {
  if (AppStateManager.hasLoadedInitialState()) {
    return;
  }

  await new Promise<void>((resolve) => {
    const poll = () => {
      if (AppStateManager.hasLoadedInitialState()) {
        resolve();
        return;
      }

      window.setTimeout(poll, 50);
    };

    poll();
  });
};

const getCurrentWorkspaceMemoryGameKey = (): string => {
  const currentGameName = (appSettings.CurrentGameName || '').trim();
  if (currentGameName && currentGameName !== 'Default') {
    return currentGameName;
  }

  return 'DefaultGame';
};

const getRememberedWorkspaceForCurrentGame = (): string => {
  const gameKey = getCurrentWorkspaceMemoryGameKey();
  const byGame = appSettings.CurrentWorkSpaceByGame?.[gameKey] || '';
  return normalizeWorkspaceNameInput(byGame || appSettings.CurrentWorkSpace || '');
};

const rememberWorkspaceForCurrentGame = (name: string): void => {
  const normalizedName = normalizeWorkspaceNameInput(name);
  const gameKey = getCurrentWorkspaceMemoryGameKey();

  appSettings.CurrentWorkSpace = normalizedName;
  appSettings.CurrentWorkSpaceByGame = {
    ...(appSettings.CurrentWorkSpaceByGame || {}),
    [gameKey]: normalizedName,
  };
};


const ensureTrailingEmptyRow = () => {
  debugLog('WorkPage', 'ensureTrailingEmptyRow - before', JSON.stringify(modelRows.value));
  if (modelRows.value.length === 0) {
    modelRows.value.push({ drawIB: '', aliasName: '' });
    debugLog('WorkPage', 'ensureTrailingEmptyRow - added initial empty row');
    return;
  }

  const last = modelRows.value[modelRows.value.length - 1];
  const lastHasContent = last.drawIB.trim() !== '' || last.aliasName.trim() !== '';

  if (lastHasContent) {
    modelRows.value.push({ drawIB: '', aliasName: '' });
    debugLog('WorkPage', 'ensureTrailingEmptyRow - appended trailing empty row');
  } else {
    while (modelRows.value.length > 1) {
      const prev = modelRows.value[modelRows.value.length - 2];
      const prevEmpty = prev.drawIB.trim() === '' && prev.aliasName.trim() === '';
      if (prevEmpty) {
        modelRows.value.splice(modelRows.value.length - 1, 1);
        debugLog('WorkPage', 'ensureTrailingEmptyRow - removed extra empty row');
      } else {
        break;
      }
    }
  }
  debugLog('WorkPage', 'ensureTrailingEmptyRow - after', JSON.stringify(modelRows.value));
};

const moveModelRow = (index: number, direction: 'up' | 'down') => {
  const rows = modelRows.value;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return;
  }

  const current = rows[index];
  const target = rows[targetIndex];
  rows[index] = target;
  rows[targetIndex] = current;
};

const removeModelRow = (index: number) => {
  if (index < 0 || index >= modelRows.value.length) {
    return;
  }

  modelRows.value.splice(index, 1);
  ensureTrailingEmptyRow();
};

const ensureTrailingSkipRow = () => {
  const rows = skipRows.value;
  if (rows.length === 0) {
    rows.push({ skipIB: '', aliasName: '', indexCount: '', firstIndex: '' });
    return;
  }

  const last = rows[rows.length - 1];
  const lastHasContent = last.skipIB.trim() !== ''
    || last.aliasName.trim() !== ''
    || last.indexCount.trim() !== ''
    || last.firstIndex.trim() !== '';

  if (lastHasContent) {
    rows.push({ skipIB: '', aliasName: '', indexCount: '', firstIndex: '' });
  } else {
    while (rows.length > 1) {
      const prev = rows[rows.length - 2];
      const prevEmpty = prev.skipIB.trim() === ''
        && prev.aliasName.trim() === ''
        && prev.indexCount.trim() === ''
        && prev.firstIndex.trim() === '';
      if (prevEmpty) {
        rows.splice(rows.length - 1, 1);
      } else {
        break;
      }
    }
  }
};

const removeSkipRow = (index: number) => {
  if (index < 0 || index >= skipRows.value.length) {
    return;
  }

  skipRows.value.splice(index, 1);
  ensureTrailingSkipRow();
};

const ensureTrailingVSRow = () => {
  const rows = vsRows.value;
  if (rows.length === 0) {
    rows.push({ enabled: true, hash: '' });
    return;
  }

  const last = rows[rows.length - 1];
  const lastHasContent = last.hash.trim() !== '';

  if (lastHasContent) {
    rows.push({ enabled: true, hash: '' });
  } else {
    while (rows.length > 1) {
      const prev = rows[rows.length - 2];
      const prevEmpty = prev.hash.trim() === '';
      if (prevEmpty) {
        rows.splice(rows.length - 1, 1);
      } else {
        break;
      }
    }
  }
};

const removeVSCheckRow = (index: number) => {
  if (index < 0 || index >= vsRows.value.length) {
    return;
  }

  vsRows.value.splice(index, 1);
  ensureTrailingVSRow();
};

const getWorkspaceBaseDir = async () => {
  let gameName = appSettings.CurrentGameName;
  // If no valid game selected, fallback to a global placeholder so workspaces still work
  if (!gameName || gameName === 'Default') {
    gameName = 'DefaultGame';
  }
  if (!appSettings.DBMTWorkFolder) {
    debugWarn('WorkPage', 'getWorkspaceBaseDir - cacheDir not configured');
    return undefined;
  }
  const p = await join(appSettings.DBMTWorkFolder, 'WorkSpace', gameName);
  debugLog('WorkPage', 'getWorkspaceBaseDir ->', p);
  return p;
};

const isWorkspaceLoading = ref(false);
const isSkipConfigLoading = ref(false);
const isVSConfigLoading = ref(false);
const isFrameAnalysisPathConfigLoading = ref(false);
const isWorkspaceTabConfigLoading = ref(false);
const isFrameAnalysisPathInvalid = ref(false);
const isWorkspaceTransitioning = ref(false);
let lastInvalidFrameAnalysisWarnPath = '';
let workspaceSaveQueue: Promise<void> = Promise.resolve();

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

const normalizeWorkspaceTabName = (name: string): string => name.trim();

const isValidWindowsFileName = (name: string): boolean => {
  if (!name) return false;
  if (name.length > 128) return false;
  if (/^[.\s]+$/.test(name)) return false;
  if (/[<>:"/\\|?*\x00-\x1F]/.test(name)) return false;
  if (name.endsWith(' ') || name.endsWith('.')) return false;
  const upper = name.toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(upper)) return false;
  return true;
};

const createWorkspaceTabId = (): string => {
  workspaceTabSeed += 1;
  return `ws-tab-${Date.now()}-${workspaceTabSeed}`;
};

const createDefaultWorkspaceTabName = (index: number): string =>
  `${t('workPage.ui.defaultTabNamePrefix')}${index}`;

const getNextWorkspaceTabIndex = (): number => {
  const prefix = t('workPage.ui.defaultTabNamePrefix').toLowerCase();
  let highestIndex = -1;

  for (const tab of workspaceTabs.value) {
    const normalizedName = normalizeWorkspaceTabName(tab.name).toLowerCase();
    if (!normalizedName.startsWith(prefix)) {
      continue;
    }

    const suffix = normalizedName.slice(prefix.length).trim();
    if (!/^\d+$/.test(suffix)) {
      continue;
    }

    highestIndex = Math.max(highestIndex, Number.parseInt(suffix, 10));
  }

  return highestIndex + 1;
};

const createDefaultWorkspaceTabMeta = (): WorkspaceTabMeta => {
  let nextIndex = getNextWorkspaceTabIndex();
  let nextName = createDefaultWorkspaceTabName(nextIndex);

  while (workspaceTabs.value.some((tab) => tab.name.toLowerCase() === nextName.toLowerCase())) {
    nextIndex += 1;
    nextName = createDefaultWorkspaceTabName(nextIndex);
  }

  return {
    id: createWorkspaceTabId(),
    name: nextName,
  };
};

const getWorkspaceDirPath = async (wsName: string): Promise<string | undefined> => {
  if (!wsName) return undefined;
  const baseDir = await getWorkspaceBaseDir();
  if (!baseDir) return undefined;
  return join(baseDir, wsName);
};

const getWorkspaceLodDirPath = async (
  wsName: string,
  lodName: string,
): Promise<string | undefined> => {
  const workspaceDir = await getWorkspaceDirPath(wsName);
  if (!workspaceDir) return undefined;
  const trimmedLodName = lodName.trim();
  if (!trimmedLodName) return undefined;
  return join(workspaceDir, trimmedLodName);
};

const getWorkspaceConfigDirPath = async (wsName: string): Promise<string | undefined> => {
  const workspaceDir = await getWorkspaceDirPath(wsName);
  if (!workspaceDir) return undefined;
  return join(workspaceDir, 'Config');
};

const getWorkspaceTabsConfigPath = async (wsName: string): Promise<string | undefined> => {
  const configDir = await getWorkspaceConfigDirPath(wsName);
  if (!configDir) return undefined;
  return join(configDir, 'WorkPageTabs.json');
};

const getWorkspaceTabConfigPath = async (wsName: string, tabId: string): Promise<string | undefined> => {
  const configDir = await getWorkspaceConfigDirPath(wsName);
  if (!configDir) return undefined;
  return join(configDir, 'Tabs', `${tabId}.json`);
};

const getWorkspaceFrameAnalysisConfigPath = async (wsName: string): Promise<string | undefined> => {
  const configDir = await getWorkspaceConfigDirPath(wsName);
  if (!configDir) return undefined;
  return join(configDir, 'FrameAnalysisPath.json');
};

const getLegacyWorkspaceFrameAnalysisConfigPath = async (wsName: string): Promise<string | undefined> => {
  const workspaceDir = await getWorkspaceDirPath(wsName);
  if (!workspaceDir) return undefined;
  return join(workspaceDir, 'FrameAnalysisPathConfig.json');
};

const setAllConfigLoading = (value: boolean) => {
  isWorkspaceLoading.value = value;
  isSkipConfigLoading.value = value;
  isVSConfigLoading.value = value;
  isFrameAnalysisPathConfigLoading.value = value;
  isWorkspaceTabConfigLoading.value = value;
};

const movePathToRecycleBin = async (targetPath: string): Promise<void> => {
  await moveDirectoryToRecycleBin(targetPath);
};

const createInMemoryDefaultWorkspaceState = () => {
  resetLeftThreeLists();
  const defaultTab = createDefaultWorkspaceTabMeta();
  workspaceTabs.value = [defaultTab];
  activeWorkspaceTabId.value = defaultTab.id;
  editingWorkspaceTabId.value = null;
  workspaceTabNameEditBackup.value = {};
};

const resetLeftThreeLists = () => {
  modelRows.value = [{ drawIB: '', aliasName: '' }];
  skipRows.value = [{ skipIB: '', aliasName: '', indexCount: '', firstIndex: '' }];
  vsRows.value = [{ enabled: true, hash: '' }];
  frameAnalysisFolderPath.value = '';
  selectedFrameAnalysis.value = '';
  extractPanelTab.value = 'drawib';
  fullExtractDataTypeFilter.value = 'all';
  convertRgbaChannelTextures.value = appSettings.convertRgbaChannelTextures !== false;
  workPageDrawerCollapsed.value = normalizeWorkPageDrawerCollapsed();
  isFrameAnalysisPathInvalid.value = false;
};

const buildCurrentWorkspaceTabConfig = (): WorkPageTabConfig => ({
  modelRows: modelRows.value
    .map((row) => ({
      drawIB: row.drawIB.trim(),
      aliasName: row.aliasName.trim(),
    }))
    .filter((row) => row.drawIB !== '' || row.aliasName !== ''),
  skipRows: skipRows.value
    .map((row) => ({
      skipIB: row.skipIB.trim(),
      aliasName: row.aliasName.trim(),
      indexCount: row.indexCount.trim(),
      firstIndex: row.firstIndex.trim(),
    }))
    .filter((row) => row.skipIB !== '' || row.aliasName !== '' || row.indexCount !== '' || row.firstIndex !== ''),
  vsRows: vsRows.value
    .map((row) => ({
      enabled: row.enabled !== false,
      hash: row.hash.trim(),
    }))
    .filter((row) => row.hash !== ''),
  frameAnalysisFolderPath: frameAnalysisFolderPath.value.trim(),
  selectedFrameAnalysis: selectedFrameAnalysis.value.trim(),
  extractPanelTab: extractPanelTab.value,
  fullExtractDataTypeFilter: fullExtractDataTypeFilter.value,
  convertRgbaChannelTextures: convertRgbaChannelTextures.value,
  workPageDrawerCollapsed: normalizeWorkPageDrawerCollapsed(workPageDrawerCollapsed.value),
});

const cloneWorkspaceTabConfig = (config: WorkPageTabConfig): WorkPageTabConfig =>
  normalizeWorkspaceTabConfig(JSON.parse(JSON.stringify(config)) as Partial<WorkPageTabConfig>);

const buildWorkspaceTabsSnapshot = (): WorkspaceTabMeta[] =>
  workspaceTabs.value.map((tab) => ({
    id: tab.id,
    name: normalizeWorkspaceTabName(tab.name),
  }));

const createWorkspaceTabSaveSnapshot = (options?: {
  workspaceName?: string;
  activeTabId?: string;
  tabs?: WorkspaceTabMeta[];
  tabConfig?: WorkPageTabConfig;
}): WorkspaceTabSaveSnapshot | undefined => {
  const workspaceNameSnapshot = (options?.workspaceName ?? workspaceName.value).trim();
  const activeTabIdSnapshot = (options?.activeTabId ?? activeWorkspaceTabId.value).trim();

  if (!workspaceNameSnapshot || !activeTabIdSnapshot) {
    return undefined;
  }

  const tabsSnapshot = (options?.tabs ?? buildWorkspaceTabsSnapshot()).map((tab) => ({
    id: tab.id,
    name: normalizeWorkspaceTabName(tab.name),
  }));

  return {
    workspaceName: workspaceNameSnapshot,
    activeTabId: activeTabIdSnapshot,
    tabs: tabsSnapshot,
    tabConfig: cloneWorkspaceTabConfig(options?.tabConfig ?? buildCurrentWorkspaceTabConfig()),
  };
};

const enqueueWorkspaceSave = async (task: () => Promise<void>): Promise<void> => {
  workspaceSaveQueue = workspaceSaveQueue
    .catch((error) => {
      console.error('Previous workspace save failed', error);
    })
    .then(task);

  await workspaceSaveQueue;
};

const normalizeWorkspaceTabConfig = (
  parsed?: Partial<WorkPageTabConfig> & { onlyGpuPreSkinning?: boolean }
): WorkPageTabConfig => ({
  modelRows: Array.isArray(parsed?.modelRows)
    ? parsed!.modelRows.map((row) => ({ drawIB: row.drawIB || '', aliasName: row.aliasName || '' }))
    : [],
  skipRows: Array.isArray(parsed?.skipRows)
    ? parsed!.skipRows.map((row) => ({
      skipIB: row.skipIB || '',
      aliasName: row.aliasName || '',
      indexCount: row.indexCount || '',
      firstIndex: row.firstIndex || '',
    }))
    : [],
  vsRows: Array.isArray(parsed?.vsRows)
    ? parsed!.vsRows.map((row) => ({ enabled: row.enabled !== false, hash: row.hash || '' }))
    : [],
  frameAnalysisFolderPath: (parsed?.frameAnalysisFolderPath || '').trim(),
  selectedFrameAnalysis: (parsed?.selectedFrameAnalysis || '').trim(),
  extractPanelTab: parsed?.extractPanelTab || 'drawib',
  fullExtractDataTypeFilter: normalizeFullExtractDataTypeFilter(parsed),
  convertRgbaChannelTextures: parsed?.convertRgbaChannelTextures ?? (appSettings.convertRgbaChannelTextures !== false),
  workPageDrawerCollapsed: normalizeWorkPageDrawerCollapsed(parsed?.workPageDrawerCollapsed),
});

const normalizeWorkspaceFrameAnalysisConfig = (
  parsed?: Partial<WorkspaceFrameAnalysisConfig>
): WorkspaceFrameAnalysisConfig => ({
  frameAnalysisFolderPath: (parsed?.frameAnalysisFolderPath || '').trim(),
  selectedFrameAnalysis: (parsed?.selectedFrameAnalysis || '').trim(),
});

const readWorkspaceTabsIndexBySnapshot = async (wsName: string): Promise<WorkPageTabsIndex | undefined> => {
  try {
    const indexPath = await getWorkspaceTabsConfigPath(wsName);
    if (!indexPath) return undefined;
    const raw = await readTextFile(indexPath);
    return JSON.parse(raw) as WorkPageTabsIndex;
  } catch {
    return undefined;
  }
};

const readWorkspaceTabConfigBySnapshot = async (
  wsName: string,
  tabId: string
): Promise<WorkPageTabConfig> => {
  try {
    const tabConfigPath = await getWorkspaceTabConfigPath(wsName, tabId);
    if (!tabConfigPath) {
      return normalizeWorkspaceTabConfig();
    }

    const raw = await readTextFile(tabConfigPath);
    const parsed = JSON.parse(raw) as Partial<WorkPageTabConfig>;
    return normalizeWorkspaceTabConfig(parsed);
  } catch {
    return normalizeWorkspaceTabConfig();
  }
};

const readWorkspaceFrameAnalysisConfigBySnapshot = async (
  wsName: string
): Promise<WorkspaceFrameAnalysisConfig | undefined> => {
  const configPaths = [
    await getWorkspaceFrameAnalysisConfigPath(wsName),
    await getLegacyWorkspaceFrameAnalysisConfigPath(wsName),
  ].filter((path): path is string => Boolean(path));

  for (const configPath of configPaths) {
    try {
      const raw = await readTextFile(configPath);
      const parsed = JSON.parse(raw) as Partial<WorkspaceFrameAnalysisConfig>;
      return normalizeWorkspaceFrameAnalysisConfig(parsed);
    } catch {
      continue;
    }
  }

  return undefined;
};

const withWorkspaceFrameAnalysisFallback = async (
  wsName: string,
  config: WorkPageTabConfig
): Promise<WorkPageTabConfig> => {
  if (config.frameAnalysisFolderPath || config.selectedFrameAnalysis) {
    return config;
  }

  const frameAnalysisConfig = await readWorkspaceFrameAnalysisConfigBySnapshot(wsName);
  if (!frameAnalysisConfig) {
    return config;
  }

  return {
    ...config,
    frameAnalysisFolderPath: frameAnalysisConfig.frameAnalysisFolderPath,
    selectedFrameAnalysis: frameAnalysisConfig.selectedFrameAnalysis,
  };
};

const mergeWorkspaceDrawIBEntries = (configs: WorkPageTabConfig[]): DrawIBConfigEntry[] => {
  const mergedEntries: DrawIBConfigEntry[] = [];
  const mergedEntryIndexMap = new Map<string, number>();

  for (const config of configs) {
    const entries = editableRowsToDrawIBConfigEntries(config.modelRows);
    for (const entry of entries) {
      const drawIB = entry.DrawIB.trim();
      if (!drawIB) continue;

      const dedupeKey = drawIB.toLowerCase();
      const existingIndex = mergedEntryIndexMap.get(dedupeKey);
      if (existingIndex !== undefined) {
        mergedEntries[existingIndex] = {
          DrawIB: drawIB,
          Alias: entry.Alias.trim(),
        };
        continue;
      }

      mergedEntryIndexMap.set(dedupeKey, mergedEntries.length);
      mergedEntries.push({
        DrawIB: drawIB,
        Alias: entry.Alias.trim(),
      });
    }
  }

  return mergedEntries;
};

const writeWorkspaceAggregatedDrawIBConfig = async (
  wsName: string,
  _targetTabConfig: WorkPageTabConfig,
  options?: {
    tabId?: string;
    tabConfig?: WorkPageTabConfig;
    tabs?: WorkspaceTabMeta[];
  }
): Promise<void> => {
  if (!wsName) return;

  const indexSnapshot = options?.tabs
    ? { activeTabId: options.tabId || '', tabs: options.tabs }
    : await readWorkspaceTabsIndexBySnapshot(wsName);

  const tabMetas = Array.isArray(indexSnapshot?.tabs) ? indexSnapshot!.tabs : [];
  const effectiveTabMetas = [...tabMetas];

  if (options?.tabId && !effectiveTabMetas.some((tab) => tab.id === options.tabId)) {
    effectiveTabMetas.push({ id: options.tabId, name: '' });
  }

  if (options?.tabId) {
    const currentTabIndex = effectiveTabMetas.findIndex((tab) => tab.id === options.tabId);
    if (currentTabIndex >= 0) {
      const [currentTabMeta] = effectiveTabMetas.splice(currentTabIndex, 1);
      effectiveTabMetas.push(currentTabMeta);
    }
  }

  // LOD 名称 = 目标标签页的名称
  const targetTabMeta = options?.tabId
    ? effectiveTabMetas.find((t) => t.id === options.tabId)
    : undefined;
  const targetLodName = normalizeWorkspaceTabName(targetTabMeta?.name || '');
  if (!targetLodName) return;

  const targetLodDir = await getWorkspaceLodDirPath(wsName, targetLodName);
  if (!targetLodDir) return;

  // 收集所有与目标 LOD 名称相同的标签页配置（按标签名分组）
  const configs: WorkPageTabConfig[] = [];
  for (const tab of effectiveTabMetas) {
    if (!tab.id) continue;
    const tabLodName = normalizeWorkspaceTabName(tab.name);
    if (tabLodName !== targetLodName) continue;

    if (options?.tabId && options.tabConfig && tab.id === options.tabId) {
      configs.push(options.tabConfig);
      continue;
    }

    const candidateConfig = await readWorkspaceTabConfigBySnapshot(wsName, tab.id);
    configs.push(candidateConfig);
  }

  const mergedEntries = mergeWorkspaceDrawIBEntries(configs);
  await writeDrawIBConfigToWorkspace(targetLodDir, mergedEntries);
};

const writeWorkspaceActiveTabDrawIBConfig = async (
  wsName: string,
  lodName: string,
  tabConfig: WorkPageTabConfig
): Promise<void> => {
  if (!wsName) return;

  const workspaceDir = await getWorkspaceLodDirPath(wsName, lodName);
  if (!workspaceDir) return;

  await writeDrawIBConfigToWorkspace(workspaceDir, editableRowsToDrawIBConfigEntries(tabConfig.modelRows));
};

const applyWorkspaceTabConfig = async (config: WorkPageTabConfig) => {
  setAllConfigLoading(true);

  try {
    modelRows.value = config.modelRows.length > 0
      ? config.modelRows.map((row) => ({ drawIB: row.drawIB || '', aliasName: row.aliasName || '' }))
      : [{ drawIB: '', aliasName: '' }];

    skipRows.value = config.skipRows.length > 0
      ? config.skipRows.map((row) => ({
        skipIB: row.skipIB || '',
        aliasName: row.aliasName || '',
        indexCount: row.indexCount || '',
        firstIndex: row.firstIndex || '',
      }))
      : [{ skipIB: '', aliasName: '', indexCount: '', firstIndex: '' }];

    vsRows.value = config.vsRows.length > 0
      ? config.vsRows.map((row) => ({ enabled: row.enabled !== false, hash: row.hash || '' }))
      : [{ enabled: true, hash: '' }];

    frameAnalysisFolderPath.value = (config.frameAnalysisFolderPath || '').trim();
    selectedFrameAnalysis.value = (config.selectedFrameAnalysis || '').trim();
    extractPanelTab.value = config.extractPanelTab || 'drawib';
    fullExtractDataTypeFilter.value = normalizeFullExtractDataTypeFilter(config);
    convertRgbaChannelTextures.value = config.convertRgbaChannelTextures !== false;
    workPageDrawerCollapsed.value = normalizeWorkPageDrawerCollapsed(config.workPageDrawerCollapsed);

    ensureTrailingEmptyRow();
    ensureTrailingSkipRow();
    ensureTrailingVSRow();
    await validateFrameAnalysisPath(false);
  } finally {
    setTimeout(() => {
      setAllConfigLoading(false);
    }, 120);
  }
};

const saveWorkspaceTabsIndex = async (): Promise<void> => {
  if (!workspaceName.value) return;

  const workspaceNameSnapshot = workspaceName.value;
  const activeTabIdSnapshot = activeWorkspaceTabId.value;
  const tabsSnapshot = buildWorkspaceTabsSnapshot();

  await saveWorkspaceTabsIndexBySnapshot(workspaceNameSnapshot, activeTabIdSnapshot, tabsSnapshot);
};

const saveWorkspaceTabsIndexBySnapshot = async (
  wsName: string,
  activeTabId: string,
  tabs: WorkspaceTabMeta[]
): Promise<void> => {
  if (!wsName) return;

  await enqueueWorkspaceSave(async () => {
    try {
      const configDir = await getWorkspaceConfigDirPath(wsName);
      const indexPath = await getWorkspaceTabsConfigPath(wsName);
      if (!configDir || !indexPath) return;

      await mkdir(configDir, { recursive: true });

      const payload: WorkPageTabsIndex = {
        activeTabId,
        tabs: tabs.map((tab) => ({ id: tab.id, name: normalizeWorkspaceTabName(tab.name) })),
      };

      await writeTextFile(indexPath, JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error('Failed to save workspace tabs index', err);
    }
  });
};

const saveWorkspaceTabConfigSnapshot = async (snapshot: WorkspaceTabSaveSnapshot): Promise<void> => {
  await saveWorkspaceTabConfigBySnapshot(
    snapshot.workspaceName,
    snapshot.activeTabId,
    snapshot.tabConfig,
    snapshot.tabs,
  );
};

const saveWorkspaceTabConfigBySnapshot = async (
  wsName: string,
  tabId: string,
  tabConfig: WorkPageTabConfig,
  tabs?: WorkspaceTabMeta[]
): Promise<void> => {
  if (!wsName || !tabId) return;

  const configSnapshot = cloneWorkspaceTabConfig(tabConfig);
  const tabsSnapshot = tabs?.map((tab) => ({ id: tab.id, name: normalizeWorkspaceTabName(tab.name) }));

  await enqueueWorkspaceSave(async () => {
    try {
      const configDir = await getWorkspaceConfigDirPath(wsName);
      const tabConfigPath = await getWorkspaceTabConfigPath(wsName, tabId);
      const frameAnalysisConfigPath = await getWorkspaceFrameAnalysisConfigPath(wsName);
      if (!configDir || !tabConfigPath) return;

      const tabConfigDir = await join(configDir, 'Tabs');
      await mkdir(tabConfigDir, { recursive: true });

      await writeTextFile(tabConfigPath, JSON.stringify(configSnapshot, null, 2));
      if (frameAnalysisConfigPath) {
        await writeTextFile(
          frameAnalysisConfigPath,
          JSON.stringify(
            {
              frameAnalysisFolderPath: configSnapshot.frameAnalysisFolderPath.trim(),
              selectedFrameAnalysis: configSnapshot.selectedFrameAnalysis.trim(),
            },
            null,
            2
          )
        );
      }
      // Keep a runtime copy in workspace root for existing backend commands.
      // If tabs were not provided, fall back to reading the saved index so that
      // writeLegacyWorkspaceRuntimeFiles can resolve the LOD name from the tab name.
      let resolvedTabs = tabsSnapshot;
      if (!resolvedTabs) {
        const indexSnapshot = await readWorkspaceTabsIndexBySnapshot(wsName);
        resolvedTabs = indexSnapshot?.tabs?.map((t) => ({ id: t.id, name: t.name }));
      }
      await writeLegacyWorkspaceRuntimeFiles(wsName, configSnapshot, { tabId, tabs: resolvedTabs });
    } catch (err) {
      console.error('Failed to save workspace tab config', err);
    }
  });
};

const saveCurrentWorkspaceTabConfig = async (): Promise<void> => {
  if (isWorkspaceTransitioning.value || isWorkspaceTabConfigLoading.value) return;

  const snapshot = createWorkspaceTabSaveSnapshot();
  if (!snapshot) return;

  await saveWorkspaceTabConfigSnapshot(snapshot);
};

const loadWorkspaceTabConfig = async (wsName: string, tabId: string): Promise<void> => {
  if (!wsName || !tabId) {
    await applyWorkspaceTabConfig({
      modelRows: [],
      skipRows: [],
      vsRows: [],
      frameAnalysisFolderPath: '',
      selectedFrameAnalysis: '',
      extractPanelTab: 'drawib',
      fullExtractDataTypeFilter: 'all',
      convertRgbaChannelTextures: appSettings.convertRgbaChannelTextures !== false,
      workPageDrawerCollapsed: normalizeWorkPageDrawerCollapsed(),
    });
    return;
  }

  try {
    const tabConfigPath = await getWorkspaceTabConfigPath(wsName, tabId);
    if (!tabConfigPath) return;

    const raw = await readTextFile(tabConfigPath);
    const parsed = JSON.parse(raw) as Partial<WorkPageTabConfig>;

    await applyWorkspaceTabConfig(
      await withWorkspaceFrameAnalysisFallback(wsName, normalizeWorkspaceTabConfig(parsed))
    );
  } catch {
    await applyWorkspaceTabConfig(
      await withWorkspaceFrameAnalysisFallback(wsName, normalizeWorkspaceTabConfig())
    );
  }
};

const ensureWorkspaceTabsInitialized = async (wsName: string): Promise<void> => {
  if (!wsName) return;

  const configDir = await getWorkspaceConfigDirPath(wsName);
  const indexPath = await getWorkspaceTabsConfigPath(wsName);
  if (!configDir || !indexPath) return;

  await mkdir(configDir, { recursive: true });
  await mkdir(await join(configDir, 'Tabs'), { recursive: true });

  try {
    const raw = await readTextFile(indexPath);
    const parsed = JSON.parse(raw) as Partial<WorkPageTabsIndex>;
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];

    const validTabs = tabs
      .map((tab) => ({
        id: String(tab.id || ''),
        name: normalizeWorkspaceTabName(String(tab.name || '')),
      }))
      .filter((tab) => tab.id && tab.name && isValidWindowsFileName(tab.name));

    const dedupedTabs: WorkspaceTabMeta[] = [];
    for (const tab of validTabs) {
      if (dedupedTabs.some((item) => item.name.toLowerCase() === tab.name.toLowerCase())) {
        continue;
      }
      dedupedTabs.push(tab);
    }

    workspaceTabs.value = dedupedTabs;
    if (workspaceTabs.value.length === 0) {
      const defaultTab = createDefaultWorkspaceTabMeta();
      workspaceTabs.value = [defaultTab];
      activeWorkspaceTabId.value = defaultTab.id;
      await saveWorkspaceTabsIndex();
      await saveWorkspaceTabConfigBySnapshot(wsName, defaultTab.id, normalizeWorkspaceTabConfig(), buildWorkspaceTabsSnapshot());
      return;
    }

    const preferredActiveId = String(parsed.activeTabId || '');
    activeWorkspaceTabId.value = workspaceTabs.value.some((tab) => tab.id === preferredActiveId)
      ? preferredActiveId
      : workspaceTabs.value[0].id;
  } catch {
    const defaultTab = createDefaultWorkspaceTabMeta();
    workspaceTabs.value = [defaultTab];
    activeWorkspaceTabId.value = defaultTab.id;
    await saveWorkspaceTabsIndex();
    await saveWorkspaceTabConfigBySnapshot(wsName, defaultTab.id, normalizeWorkspaceTabConfig(), buildWorkspaceTabsSnapshot());
  }
};

const validateFrameAnalysisPath = async (showWarning: boolean): Promise<void> => {
  const path = frameAnalysisFolderPath.value.trim();
  if (!path) {
    isFrameAnalysisPathInvalid.value = false;
    lastInvalidFrameAnalysisWarnPath = '';
    return;
  }

  try {
    await readDir(path);
    isFrameAnalysisPathInvalid.value = false;
    lastInvalidFrameAnalysisWarnPath = '';
  } catch {
    isFrameAnalysisPathInvalid.value = true;
    if (showWarning && lastInvalidFrameAnalysisWarnPath !== path) {
      lastInvalidFrameAnalysisWarnPath = path;
      ElMessage.warning(t('workPage.messages.frameAnalysisPathInvalid'));
    }
  }
};

// Auto-save logic
let saveTimer: ReturnType<typeof setTimeout>;
let skipSaveTimer: ReturnType<typeof setTimeout>;
let vsSaveTimer: ReturnType<typeof setTimeout>;
let frameAnalysisPathSaveTimer: ReturnType<typeof setTimeout>;
let frameAnalysisValidateTimer: ReturnType<typeof setTimeout>;
let unlistenNativeDrop: UnlistenFn | null = null;

const clearPendingSaveTimers = () => {
  clearTimeout(saveTimer);
  clearTimeout(skipSaveTimer);
  clearTimeout(vsSaveTimer);
  clearTimeout(frameAnalysisPathSaveTimer);
  clearTimeout(frameAnalysisValidateTimer);
};

const flushCurrentWorkspaceTabConfig = async (snapshot?: WorkspaceTabSaveSnapshot): Promise<void> => {
  clearPendingSaveTimers();

  if (!snapshot && isWorkspaceTabConfigLoading.value) return;

  const effectiveSnapshot = snapshot ?? createWorkspaceTabSaveSnapshot();
  if (!effectiveSnapshot) return;

  await saveWorkspaceTabConfigSnapshot(effectiveSnapshot);
};

const switchWorkspace = async (targetWorkspaceName: string): Promise<void> => {
  const resolvedWorkspaceName = findExistingWorkspaceOption(targetWorkspaceName)
    ?? normalizeWorkspaceNameInput(targetWorkspaceName);
  const currentWorkspaceName = normalizeWorkspaceNameInput(workspaceName.value);

  if (!resolvedWorkspaceName) {
    workspaceDraftName.value = '';
    if (!currentWorkspaceName) {
      return;
    }

    clearPendingSaveTimers();
    setAllConfigLoading(true);
    isWorkspaceTransitioning.value = true;

    try {
      workspaceName.value = '';
      rememberWorkspaceForCurrentGame('');
      resetLeftThreeLists();
      workspaceTabs.value = [];
      activeWorkspaceTabId.value = '';
      editingWorkspaceTabId.value = null;
      workspaceTabNameEditBackup.value = {};
    } finally {
      setAllConfigLoading(false);
      isWorkspaceTransitioning.value = false;
    }
    return;
  }

  workspaceDraftName.value = resolvedWorkspaceName;
  if (resolvedWorkspaceName === currentWorkspaceName) {
    return;
  }

  const previousSnapshot = currentWorkspaceName && activeWorkspaceTabId.value && !isWorkspaceTabConfigLoading.value
    ? createWorkspaceTabSaveSnapshot({
        workspaceName: currentWorkspaceName,
        activeTabId: activeWorkspaceTabId.value,
        tabs: buildWorkspaceTabsSnapshot(),
        tabConfig: buildCurrentWorkspaceTabConfig(),
      })
    : undefined;

  clearPendingSaveTimers();
  isWorkspaceTransitioning.value = true;
  setAllConfigLoading(true);

  let shouldReleaseLoadingState = true;

  try {
    if (previousSnapshot) {
      await saveWorkspaceTabConfigSnapshot(previousSnapshot);
    }

    resetLeftThreeLists();
    workspaceTabs.value = [];
    activeWorkspaceTabId.value = '';
    editingWorkspaceTabId.value = null;
    workspaceTabNameEditBackup.value = {};

    workspaceName.value = resolvedWorkspaceName;
    rememberWorkspaceForCurrentGame(resolvedWorkspaceName);
    await ensureWorkspaceTabsInitialized(resolvedWorkspaceName);
    await saveWorkspaceTabsIndex();
    await loadWorkspaceTabConfig(resolvedWorkspaceName, activeWorkspaceTabId.value);
    shouldReleaseLoadingState = false;
  } finally {
    if (shouldReleaseLoadingState) {
      setAllConfigLoading(false);
    }
    isWorkspaceTransitioning.value = false;
  }
};

const handleWorkspaceSelectionChange = async (value: string) => {
  const normalizedValue = normalizeWorkspaceNameInput(value);
  workspaceDraftName.value = normalizedValue;

  const existingWorkspaceName = findExistingWorkspaceOption(normalizedValue);
  if (!existingWorkspaceName) {
    return;
  }

  await switchWorkspace(existingWorkspaceName);
};

// Watch for changes and auto-save
watch(modelRows, () => {
  ensureTrailingEmptyRow();

  if (isWorkspaceLoading.value || isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveCurrentWorkspaceTabConfig();
  }, 800);
}, { deep: true });

watch(skipRows, () => {
  ensureTrailingSkipRow();
  if (isSkipConfigLoading.value || isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;

  clearTimeout(skipSaveTimer);
  skipSaveTimer = setTimeout(() => {
    void saveCurrentWorkspaceTabConfig();
  }, 800);
}, { deep: true });

watch(vsRows, () => {
  ensureTrailingVSRow();
  if (isVSConfigLoading.value || isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;

  clearTimeout(vsSaveTimer);
  vsSaveTimer = setTimeout(() => {
    void saveCurrentWorkspaceTabConfig();
  }, 800);
}, { deep: true });

watch(frameAnalysisFolderPath, () => {
  if (isFrameAnalysisPathConfigLoading.value || isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;

  clearTimeout(frameAnalysisPathSaveTimer);
  frameAnalysisPathSaveTimer = setTimeout(() => {
    void saveCurrentWorkspaceTabConfig();
  }, 500);

  clearTimeout(frameAnalysisValidateTimer);
  frameAnalysisValidateTimer = setTimeout(() => {
    void validateFrameAnalysisPath(true);
  }, 250);
});

watch([selectedFrameAnalysis, extractPanelTab, fullExtractDataTypeFilter, convertRgbaChannelTextures], () => {
  if (isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;
  void saveCurrentWorkspaceTabConfig();
});

watch(workPageDrawerCollapsed, () => {
  if (isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;
  void saveCurrentWorkspaceTabConfig();
}, { deep: true });

watch(convertRgbaChannelTextures, (value) => {
  if (isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;
  appSettings.convertRgbaChannelTextures = value;
});

watch(activeWorkspaceTabId, async (newTabId, oldTabId) => {
  if (!workspaceName.value) return;
  if (!newTabId || newTabId === oldTabId) return;
  if (isWorkspaceTabConfigLoading.value || isWorkspaceTransitioning.value) return;

  const workspaceNameSnapshot = workspaceName.value;
  const tabsSnapshot = buildWorkspaceTabsSnapshot();
  const previousSnapshot = oldTabId
    ? createWorkspaceTabSaveSnapshot({
        workspaceName: workspaceNameSnapshot,
        activeTabId: oldTabId,
        tabs: tabsSnapshot,
        tabConfig: buildCurrentWorkspaceTabConfig(),
      })
    : undefined;

  clearPendingSaveTimers();
  isWorkspaceTransitioning.value = true;
  setAllConfigLoading(true);

  let shouldReleaseLoadingState = true;

  try {
    if (previousSnapshot) {
      await saveWorkspaceTabConfigSnapshot(previousSnapshot);
    }

    await saveWorkspaceTabsIndexBySnapshot(workspaceNameSnapshot, newTabId, tabsSnapshot);
    await loadWorkspaceTabConfig(workspaceNameSnapshot, newTabId);
    shouldReleaseLoadingState = false;
  } finally {
    if (shouldReleaseLoadingState) {
      setAllConfigLoading(false);
    }
    isWorkspaceTransitioning.value = false;
  }
});

const syncFrameAnalysisFolderPathFromSelection = async () => {
  if (!selectedFrameAnalysis.value) {
    return;
  }

  const current3dmigotoFolderPath = await PathHelper.GetCurrentGame3DmigotoFolderPath();
  if (!current3dmigotoFolderPath) {
    frameAnalysisFolderPath.value = '';
    return;
  }

  const selected = selectedFrameAnalysis.value;

  // If the selected option is a LOD folder (e.g. LOD0, LOD1), find the latest
  // FrameAnalysis folder inside it and use that as the full path.
  if (/^lod\d+$/i.test(selected)) {
    const lodFolderPath = await join(current3dmigotoFolderPath, selected);
    try {
      const lodEntries = await readDir(lodFolderPath);
      const faFolders = lodEntries
        .filter((e) => e.isDirectory && e.name && e.name.startsWith('FrameAnalysis'))
        .map((e) => e.name as string)
        .sort((a, b) => b.localeCompare(a));
      if (faFolders.length > 0) {
        frameAnalysisFolderPath.value = await join(lodFolderPath, faFolders[0]);
        return;
      }
    } catch {
      // Fall through to set lodFolderPath itself
    }
    frameAnalysisFolderPath.value = lodFolderPath;
    return;
  }

  frameAnalysisFolderPath.value = await join(current3dmigotoFolderPath, selected);
};

watch(selectedFrameAnalysis, () => {
  if (isWorkspaceTabConfigLoading.value || isFrameAnalysisPathConfigLoading.value) {
    return;
  }
  void syncFrameAnalysisFolderPathFromSelection();
});

watch(() => appSettings.CurrentGameName, () => {
  void loadSpecificIbDumpState();
});

const handleFrameAnalysisOptionClick = async (item: string) => {
  selectedFrameAnalysis.value = item;
  await syncFrameAnalysisFolderPathFromSelection();
};



const refreshFrameAnalysisFolders = async () => {
  const gameName = appSettings.CurrentGameName;
  if (!gameName || gameName === 'Default') {
    ElMessage.info(t('workPage.messages.selectGameConfigFirst'));
    return;
  }

  isRefreshing.value = true;
  try {
    const currentSelectedFrameAnalysis = selectedFrameAnalysis.value.trim();
    const currentFrameAnalysisFolderPath = frameAnalysisFolderPath.value.trim();

    // Get current 3Dmigoto directory
    const basePath = await PathHelper.GetCurrentGame3DmigotoFolderPath();

    if (!basePath) {
      ElMessage.warning(t('workPage.messages.migotoFolderNotFound'));
      return;
    }


    const entries = await readDir(basePath);
    const lodFolders: string[] = [];
    const directFaFolders: string[] = [];

    for (const entry of entries) {
      if (!entry.name || !entry.isDirectory) continue;
      if (/^lod\d+$/i.test(entry.name)) {
        lodFolders.push(entry.name);
      } else if (entry.name.startsWith('FrameAnalysis')) {
        directFaFolders.push(entry.name);
      }
    }

    // Prefer LOD subfolders; fall back to direct FrameAnalysis folders
    lodFolders.sort((a, b) => a.localeCompare(b));
    directFaFolders.sort((a, b) => b.localeCompare(a));
    const folders = lodFolders.length > 0 ? lodFolders : directFaFolders;

    // Sort by name descending (newest timestamp first)
    frameAnalysisOptions.value = folders;

    if (folders.length === 0) {
      if (!currentFrameAnalysisFolderPath) {
        selectedFrameAnalysis.value = '';
      }
    } else {
      // For LOD mode: match selected by LOD name found in the current frame analysis path
      const normalizedCurrentPath = currentFrameAnalysisFolderPath
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();

      // Try to find a folder that matches the current frame analysis path or is
      // a LOD name found inside the path segments.
      let matchedFolderFromPath = '';
      if (normalizedCurrentPath) {
        const pathSegments = normalizedCurrentPath.split('/').filter(Boolean);
        for (const folder of folders) {
          const folderLower = folder.toLowerCase();
          // Direct match: the path ends with the folder name
          if (pathSegments.includes(folderLower)) {
            matchedFolderFromPath = folder;
            break;
          }
          // Full path match (direct FrameAnalysis folders)
          const candidatePath = (await join(basePath, folder))
            .replace(/\\/g, '/')
            .replace(/\/+$/, '')
            .toLowerCase();
          if (normalizedCurrentPath.startsWith(candidatePath)) {
            matchedFolderFromPath = folder;
            break;
          }
        }
      }

      if (currentSelectedFrameAnalysis && folders.includes(currentSelectedFrameAnalysis)) {
        return;
      }

      if (matchedFolderFromPath) {
        selectedFrameAnalysis.value = matchedFolderFromPath;
        return;
      }

      if (!currentSelectedFrameAnalysis && !currentFrameAnalysisFolderPath) {
        selectedFrameAnalysis.value = folders[0];
      }
    }

  } catch (err) {
    console.error('Failed to refresh FrameAnalysis folders', err);
    ElMessage.error(t('workPage.messages.refreshFailed'));
  } finally {
    isRefreshing.value = false;
  }
};

const handleExtractModels = async () => {
  if (workspaceName.value) {
    await writeLegacyWorkspaceRuntimeFiles(workspaceName.value, buildCurrentWorkspaceTabConfig(), {
      tabId: activeWorkspaceTabId.value,
      tabs: workspaceTabs.value,
      drawIBScope: 'active-tab',
    });
  }
  const activeTabName = normalizeWorkspaceTabName(
    workspaceTabs.value.find((t) => t.id === activeWorkspaceTabId.value)?.name || ''
  );
  await runExtractModels(
    isExtracting.value,
    modelRows.value,
    frameAnalysisFolderPath.value,
    activeTabName,
    getWorkspaceBaseDir,
    workspaceName.value,
    appSettings.CurrentGameName,
    activeWorkspaceTabId.value,
    convertRgbaChannelTextures.value,
    appSettings.textureMarkStylePreference,
    (value) => {
      isExtracting.value = value;
    },
    openPath
  );
};

const handleFullExtract = async () => {
  if (workspaceName.value) {
    await writeLegacyWorkspaceRuntimeFiles(workspaceName.value, buildCurrentWorkspaceTabConfig(), {
      tabId: activeWorkspaceTabId.value,
      tabs: workspaceTabs.value,
      drawIBScope: 'active-tab',
    });
  }
  const activeTabName = normalizeWorkspaceTabName(
    workspaceTabs.value.find((t) => t.id === activeWorkspaceTabId.value)?.name || ''
  );
  await runFullExtract(
    isExtracting.value,
    frameAnalysisFolderPath.value,
    activeTabName,
    fullExtractDataTypeFilter.value,
    getWorkspaceBaseDir,
    workspaceName.value,
    appSettings.CurrentGameName,
    activeWorkspaceTabId.value,
    convertRgbaChannelTextures.value,
    appSettings.textureMarkStylePreference,
    (value) => {
      isExtracting.value = value;
    },
    openPath
  );
};

const handleSelectLatestFrameAnalysis = async () => {
    // Force refresh first
    await refreshFrameAnalysisFolders();
    if (frameAnalysisOptions.value.length > 0) {
        // Since list is already sorted descending (newest first), pick index 0
        selectedFrameAnalysis.value = frameAnalysisOptions.value[0];
    await syncFrameAnalysisFolderPathFromSelection();
      ElMessage.success(t('workPage.messages.switchedTo', { folder: frameAnalysisOptions.value[0] }));
    } else {
      ElMessage.warning(t('workPage.messages.noFrameAnalysisFolders'));
    }
};

const handlePickFrameAnalysisFolder = async () => {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('workPage.dialog.selectFrameAnalysisFolderTitle'),
    });

    if (!selected || typeof selected !== 'string') {
      return;
    }

    selectedFrameAnalysis.value = '';
    frameAnalysisFolderPath.value = selected;
  } catch (err) {
    console.error('Failed to select FrameAnalysis folder', err);
    ElMessage.error(t('workPage.messages.selectFrameAnalysisFolderFailed'));
  }
};

const normalizeDroppedPath = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('file://')) {
    const decoded = decodeURIComponent(trimmed.replace('file://', ''));
    return decoded.replace(/^\/([a-zA-Z]:\/)/, '$1');
  }

  return trimmed;
};

const resolveDropPath = (event: DragEvent): string => {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return '';

  for (const file of Array.from(dataTransfer.files)) {
    const fileWithPath = file as File & { path?: string };
    if (fileWithPath.path && fileWithPath.path.trim()) {
      return normalizeDroppedPath(fileWithPath.path);
    }
  }

  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList.trim()) {
    const firstLine = uriList
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#'));

    if (firstLine) {
      return normalizeDroppedPath(firstLine);
    }
  }

  const plainText = dataTransfer.getData('text/plain');
  if (plainText.trim()) {
    return normalizeDroppedPath(plainText);
  }

  return '';
};

const applyDroppedFrameAnalysisFolder = async (rawPath: string): Promise<boolean> => {
  const droppedPath = normalizeDroppedPath(rawPath);
  if (!droppedPath) {
    ElMessage.warning(t('workPage.messages.noValidPathDetected'));
    return false;
  }

  try {
    await readDir(droppedPath);
  } catch {
    ElMessage.warning(t('workPage.messages.droppedTargetNotAccessible'));
    return false;
  }

  selectedFrameAnalysis.value = '';
  frameAnalysisFolderPath.value = droppedPath;
  ElMessage.success(t('workPage.messages.folderLoadedFromDragDrop'));
  return true;
};

const handleDropFrameAnalysisFolder = async (event: DragEvent) => {
  event.preventDefault();

  try {
    const droppedPath = resolveDropPath(event);
    await applyDroppedFrameAnalysisFolder(droppedPath);
  } catch (err) {
    console.error('Failed to read dragged FrameAnalysis folder', err);
    ElMessage.error(t('workPage.messages.readDraggedFolderFailed'));
  }
};

const handleOpenFrameAnalysisFolderPath = async () => {
  const target = frameAnalysisFolderPath.value.trim();
  await openPath(target, t('workPage.messages.specifyFrameAnalysisPathFirst'));
};

const handleTextureMenu = async (cmd: unknown) => {
  debugLog('WorkPage', 'texture menu command(raw):', cmd);
  if (workspaceName.value) {
    await writeLegacyWorkspaceRuntimeFiles(workspaceName.value, buildCurrentWorkspaceTabConfig(), {
      tabId: activeWorkspaceTabId.value,
      tabs: workspaceTabs.value,
    });
  }
  const activeTabName = normalizeWorkspaceTabName(
    workspaceTabs.value.find((t) => t.id === activeWorkspaceTabId.value)?.name || ''
  );
  await handleTextureMenuCommand(cmd, {
    frameAnalysisFolderPath: frameAnalysisFolderPath.value,
    activeTabName,
    getWorkspaceBaseDir,
    workspaceName: workspaceName.value,
    currentGameName: appSettings.CurrentGameName,
    openPath,
  });
};

const collectSpecificIbDumpDrawIbs = (): string[] => Array.from(
  new Set(
    modelRows.value
      .map((row) => row.drawIB.trim())
      .filter((drawIB) => drawIB !== '')
  )
);

const loadSpecificIbDumpState = async () => {
  const gameName = appSettings.CurrentGameName;
  if (!gameName || gameName === 'Default') {
    useSpecificIbDump.value = false;
    specificIbDumpRestoreAnalyseOptions.value = '';
    return;
  }

  const currentConfig = await ResourceManager.loadGameConfig(gameName);
  useSpecificIbDump.value = !!currentConfig?.useSpecificIbDump;
  specificIbDumpRestoreAnalyseOptions.value = currentConfig?.specificIbDumpRestoreAnalyseOptions || '';
};

const persistSpecificIbDumpState = async (enabled: boolean, restoreAnalyseOptions: string) => {
  const gameName = appSettings.CurrentGameName;
  if (!gameName || gameName === 'Default') {
    return;
  }

  const currentConfig = await ResourceManager.loadGameConfig(gameName);
  await ResourceManager.saveGameConfig(gameName, {
    ...currentConfig,
    useSpecificIbDump: enabled,
    specificIbDumpRestoreAnalyseOptions: restoreAnalyseOptions,
  });
};

const handleSpecificIbDumpToggle = async (value: string | number | boolean) => {
  const enabled = value === true;
  if (isSpecificIbDumpToggling.value) {
    return;
  }

  const previousEnabled = !enabled;
  isSpecificIbDumpToggling.value = true;

  try {
    const gameName = appSettings.CurrentGameName;
    if (!gameName || gameName === 'Default') {
      throw new Error(t('workPage.messages.selectGameConfigFirst'));
    }

    if (workspaceName.value) {
      await writeLegacyWorkspaceRuntimeFiles(workspaceName.value, buildCurrentWorkspaceTabConfig(), {
        tabId: activeWorkspaceTabId.value,
        tabs: workspaceTabs.value,
      });
    }

    const currentConfig = await ResourceManager.loadGameConfig(gameName);

    if (enabled) {
      const legacyLogicName = (currentConfig as Record<string, unknown> | undefined)?.LogicName;
      const result = await MigotoManager.enableSpecificIbDumpMode({
        gameName,
        gamePreset: currentConfig?.gamePreset,
        logicName: currentConfig?.logicName || (typeof legacyLogicName === 'string' ? legacyLogicName : undefined),
        drawIbs: collectSpecificIbDumpDrawIbs(),
      });

      specificIbDumpRestoreAnalyseOptions.value = result.restoreAnalyseOptions;
      await persistSpecificIbDumpState(true, result.restoreAnalyseOptions);
      ElMessage.success(t('workPage.messages.specificIbDumpEnabled'));
      return;
    }

    await MigotoManager.disableSpecificIbDumpMode({
      gameName,
      restoreAnalyseOptions: specificIbDumpRestoreAnalyseOptions.value,
    });
    specificIbDumpRestoreAnalyseOptions.value = '';
    await persistSpecificIbDumpState(false, '');
    ElMessage.success(t('workPage.messages.specificIbDumpDisabled'));
  } catch (err) {
    console.error('Failed to toggle specific IB dump mode', err);
    useSpecificIbDump.value = previousEnabled;
    ElMessage.error(t('workPage.messages.specificIbDumpToggleFailed', { error: String(err) }));
  } finally {
    isSpecificIbDumpToggling.value = false;
  }
};

type CommonInvokeArgs = {
  frameAnalysisFolder: string;
  gamePreset: string;
  workspaceRootPath: string;
  lodName: string;
  lodWorkspacePath: string;
};

const resolveCommonInvokeArgs = async (): Promise<CommonInvokeArgs | undefined> => {
  const trimmedFrameAnalysisFolderPath = frameAnalysisFolderPath.value.trim();
  if (!trimmedFrameAnalysisFolderPath) {
    ElMessage.warning(t('workPage.messages.specifyFrameAnalysisPathFirst'));
    return undefined;
  }

  const workspaceBase = await getWorkspaceBaseDir();
  if (!workspaceBase) {
    ElMessage.warning(t('workPage.messages.selectGameAndCacheFirst'));
    return undefined;
  }

  if (!workspaceName.value) {
    ElMessage.warning(t('workPage.messages.selectOrCreateWorkspaceFirst'));
    return undefined;
  }

  // LOD 名称 = 当前激活标签页名称，与 FrameAnalysis 路径无关
  const lodName = normalizeWorkspaceTabName(
    workspaceTabs.value.find((t) => t.id === activeWorkspaceTabId.value)?.name || ''
  );
  if (!lodName) {
    ElMessage.warning(t('workPage.messages.selectOrCreateWorkspaceFirst'));
    return undefined;
  }

  const workspaceRootPath = await join(workspaceBase, workspaceName.value);
  const lodWorkspacePath = await join(workspaceRootPath, lodName);
  const frameAnalysisFolder = trimmedFrameAnalysisFolderPath;
  const currentConfig = await ResourceManager.loadGameConfig(appSettings.CurrentGameName);
  const gamePreset = currentConfig?.gamePreset || appSettings.CurrentGameName;

  return {
    frameAnalysisFolder,
    gamePreset,
    workspaceRootPath,
    lodName,
    lodWorkspacePath,
  };
};

const handleGenerateIBSkip = async () => {
  try {
    const normalizedSkipRows = skipRows.value.map((row) => ({
      skipIB: row.skipIB.trim(),
      aliasName: row.aliasName.trim(),
      indexCount: row.indexCount.trim(),
      firstIndex: row.firstIndex.trim(),
    }));

    const needsAutoExpand = normalizedSkipRows.some((row) =>
      row.skipIB !== '' && row.firstIndex === '' && row.indexCount === ''
    );

    let rowsToGenerate = normalizedSkipRows;
    if (needsAutoExpand) {
      const invokeArgs = await resolveCommonInvokeArgs();
      if (!invokeArgs) return;

      const drawIBSubmeshCache = new Map<string, DrawIBSubmeshRange[]>();
      const expandedRows: SkipRow[] = [];

      for (const row of normalizedSkipRows) {
        if (row.skipIB === '') {
          continue;
        }

        if (row.firstIndex !== '' || row.indexCount !== '') {
          expandedRows.push(row);
          continue;
        }

        const normalizedDrawIB = row.skipIB.toLowerCase();
        let submeshList = drawIBSubmeshCache.get(normalizedDrawIB);
        if (!submeshList) {
          submeshList = await invoke<DrawIBSubmeshRange[]>('analyze_draw_ib_submeshes', {
            frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
            drawIb: row.skipIB,
          });
          drawIBSubmeshCache.set(normalizedDrawIB, submeshList);
        }

        if (submeshList.length === 0) {
          expandedRows.push(row);
          continue;
        }

        for (const submesh of submeshList) {
          expandedRows.push({
            skipIB: row.skipIB,
            aliasName: row.aliasName,
            indexCount: (submesh.indexCount || '').trim(),
            firstIndex: (submesh.firstIndex || '').trim(),
          });
        }
      }

      rowsToGenerate = expandedRows;
    }

    await generateIBSkipToMods(rowsToGenerate, workspaceName.value);
    ElMessage.success(t('workPage.messages.ibskipGenerated'));
  } catch (err) {
    console.error('Failed to generate IBSkip', err);
    ElMessage.error(t('workPage.messages.generateIBSkipFailed', { error: String(err) }));
  }
};

const handleUpdateVSCheck = async () => {
  try {
    if (workspaceName.value) {
      await writeLegacyWorkspaceRuntimeFiles(workspaceName.value, buildCurrentWorkspaceTabConfig(), {
        tabId: activeWorkspaceTabId.value,
        tabs: workspaceTabs.value,
      });
    }
    const invokeArgs = await resolveCommonInvokeArgs();
    if (!invokeArgs) return;

    await invoke('update_vscheck', {
      frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
      gamePreset: invokeArgs.gamePreset,
      workspacePath: invokeArgs.lodWorkspacePath,
    });

    const vsConfigPath = await join(invokeArgs.lodWorkspacePath, 'VSCheckConfig.json');
    try {
      const raw = await readTextFile(vsConfigPath);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        vsRows.value = parsed.map((item: { Enabled?: boolean; Hash?: string }) => ({
          enabled: item.Enabled !== false,
          hash: item.Hash || '',
        }));
        ensureTrailingVSRow();
      }
    } catch {
      // ignore parse/read failures and keep existing rows
    }

    await saveCurrentWorkspaceTabConfig();
    ElMessage.success(t('workPage.messages.vscheckUpdated'));
  } catch (err) {
    console.error('Failed to update VSCheck list', err);
    ElMessage.error(t('workPage.messages.updateVSCheckFailed', { error: String(err) }));
  }
};

const handleGenerateVSCheck = async () => {
  try {
    if (workspaceName.value) {
      await writeLegacyWorkspaceRuntimeFiles(workspaceName.value, buildCurrentWorkspaceTabConfig(), {
        tabId: activeWorkspaceTabId.value,
        tabs: workspaceTabs.value,
      });
    }
    const invokeArgs = await resolveCommonInvokeArgs();
    if (!invokeArgs) return;

    const generatedModPath = await PathHelper.GetWorkspaceGeneratedModFolderPath(workspaceName.value);
    if (!generatedModPath) {
      ElMessage.warning(t('workPage.messages.generatedModFolderPathResolveFailed'));
      return;
    }

    await invoke('generate_vscheck', {
      frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
      gamePreset: invokeArgs.gamePreset,
      workspacePath: invokeArgs.lodWorkspacePath,
      generatedModFolderPath: generatedModPath,
    });

    await openPath(generatedModPath, t('workPage.messages.openGeneratedModFolderFailed'));
    ElMessage.success(t('workPage.messages.vscheckGenerationTriggered'));
  } catch (err) {
    console.error('Failed to generate VSCheck', err);
    ElMessage.error(t('workPage.messages.generateVSCheckFailed', { error: String(err) }));
  }
};

const openPath = async (path: string | undefined, emptyMsg: string) => {
  if (!path) {
    ElMessage.warning(emptyMsg);
    return;
  }

  try {
    await mkdir(path, { recursive: true });
    await openExternal(path);
  } catch (err) {
    console.error('Failed to open path', path, err);
    ElMessage.error(t('workPage.messages.openFolderFailed'));
  }
};

const handleFolderMenu = async (cmd: string) => {
  if (cmd === 'migoto') {
    await open3DMigotoFolder();
    return;
  }

  if (cmd === 'mods') {
    await openModsFolder();
    return;
  }

  if (cmd === 'ssmt4GlobalConfigs') {
    await openSSMT4GlobalConfigsFolder();
    return;
  }

  if (cmd === 'latestFA') {
    await openLatestFrameAnalysisFolder(refreshFrameAnalysisFolders);
    return;
  }

  if (cmd === 'latestFALog') {
    await openLatestFrameAnalysisLog(refreshFrameAnalysisFolders);
    return;
  }

  if (cmd === 'latestFADeduped') {
    await openLatestFrameAnalysisDeduped(refreshFrameAnalysisFolders);
  }
};

const writeLegacyWorkspaceRuntimeFiles = async (
  wsName: string,
  tabConfig: WorkPageTabConfig,
  options?: {
    tabId?: string;
    tabs?: WorkspaceTabMeta[];
    drawIBScope?: 'aggregated' | 'active-tab';
  }
): Promise<void> => {
  if (!wsName) return;

  // LOD 名称 = 当前激活标签页的名称，与 FrameAnalysis 路径无关
  const lodName = options?.tabId && options?.tabs
    ? normalizeWorkspaceTabName(options.tabs.find((t) => t.id === options.tabId)?.name || '')
    : '';
  if (!lodName) return;

  const workspaceDir = await getWorkspaceDirPath(wsName);
  const lodWorkspaceDir = await getWorkspaceLodDirPath(wsName, lodName);
  if (!workspaceDir || !lodWorkspaceDir) return;

  const configDir = await getWorkspaceConfigDirPath(wsName);
  const tabsIndexPath = await getWorkspaceTabsConfigPath(wsName);
  const activeTabConfigPath = options?.tabId
    ? await getWorkspaceTabConfigPath(wsName, options.tabId)
    : undefined;

  await mkdir(workspaceDir, { recursive: true });
  await mkdir(lodWorkspaceDir, { recursive: true });

  if (configDir) {
    await mkdir(configDir, { recursive: true });
  }

  if (options?.tabId && configDir) {
    await mkdir(await join(configDir, 'Tabs'), { recursive: true });
  }

  if (tabsIndexPath && options?.tabId && options?.tabs) {
    const normalizedTabs = (options?.tabs || []).map((tab) => ({
      id: tab.id,
      name: normalizeWorkspaceTabName(tab.name),
    }));

    await writeTextFile(
      tabsIndexPath,
      JSON.stringify(
        {
          activeTabId: options.tabId,
          tabs: normalizedTabs,
        },
        null,
        2
      )
    );
  }

  if (activeTabConfigPath) {
    await writeTextFile(activeTabConfigPath, JSON.stringify(tabConfig, null, 2));
  }

  if (options?.drawIBScope === 'active-tab') {
    await writeWorkspaceActiveTabDrawIBConfig(wsName, lodName, tabConfig);
  } else {
    await writeWorkspaceAggregatedDrawIBConfig(wsName, tabConfig, {
      tabId: options?.tabId,
      tabConfig,
      tabs: options?.tabs,
    });
  }

  const skipConfigPath = await join(lodWorkspaceDir, 'SkipIBConfig.json');
  const skipPayload = tabConfig.skipRows
    .map((row) => ({
      SkipIB: row.skipIB.trim(),
      Alias: row.aliasName.trim(),
      IndexCount: row.indexCount.trim(),
      FirstIndex: row.firstIndex.trim(),
    }))
    .filter((row) => row.SkipIB !== '' || row.Alias !== '' || row.IndexCount !== '' || row.FirstIndex !== '');
  await writeTextFile(skipConfigPath, JSON.stringify(skipPayload, null, 2));

  const vsConfigPath = await join(lodWorkspaceDir, 'VSCheckConfig.json');
  const vsPayload = tabConfig.vsRows
    .map((row) => ({ Enabled: row.enabled !== false, Hash: row.hash.trim() }))
    .filter((row) => row.Hash !== '');
  await writeTextFile(vsConfigPath, JSON.stringify(vsPayload, null, 2));

  const frameAnalysisConfigPath = await getWorkspaceFrameAnalysisConfigPath(wsName);
  if (frameAnalysisConfigPath) {
    await writeTextFile(
      frameAnalysisConfigPath,
      JSON.stringify(
        {
          frameAnalysisFolderPath: tabConfig.frameAnalysisFolderPath.trim(),
          selectedFrameAnalysis: tabConfig.selectedFrameAnalysis.trim(),
        },
        null,
        2
      )
    );
  }
};

const handleSelectWorkspaceTab = async (tabId: string) => {
  if (tabId === activeWorkspaceTabId.value) return;
  activeWorkspaceTabId.value = tabId;
};

const handleAddWorkspaceTab = async () => {
  const tab = createDefaultWorkspaceTabMeta();
  workspaceTabs.value.push(tab);
  activeWorkspaceTabId.value = tab.id;
  await saveWorkspaceTabsIndex();
};

const handleDeleteWorkspaceTab = async (tabId: string) => {
  if (workspaceTabs.value.length <= 1) {
    ElMessage.warning(t('workPage.messages.keepAtLeastOneTab'));
    return;
  }

  const tab = workspaceTabs.value.find((item) => item.id === tabId);
  if (!tab) return;

  try {
    await ElMessageBox.confirm(
      t('workPage.messages.confirmDeleteWorkspaceTab', { name: tab.name }),
      t('workPage.dialog.confirmDeleteWorkspaceTabTitle'),
      { confirmButtonText: t('workPage.common.delete'), cancelButtonText: t('workPage.common.cancel'), type: 'warning' }
    );
  } catch {
    return;
  }

  if (activeWorkspaceTabId.value === tabId) {
    await saveCurrentWorkspaceTabConfig();
  }

  const index = workspaceTabs.value.findIndex((item) => item.id === tabId);
  if (index < 0) return;
  workspaceTabs.value.splice(index, 1);

  const nextActive = workspaceTabs.value[index] || workspaceTabs.value[index - 1] || workspaceTabs.value[0];
  activeWorkspaceTabId.value = nextActive.id;

  if (workspaceName.value) {
    const tabConfigPath = await getWorkspaceTabConfigPath(workspaceName.value, tabId);
    if (tabConfigPath) {
      try {
        await moveFileToRecycleBin(tabConfigPath);
      } catch {
        // ignore if file not exists
      }
    }
  }

  editingWorkspaceTabId.value = null;
  await saveWorkspaceTabsIndex();
};

// quick menu actions removed — use explicit buttons in UI instead


const refreshWorkspaces = async () => {
    isScanningWorkspaces.value = true;
    try {
        const baseDir = await getWorkspaceBaseDir();
        if(!baseDir) return;
    debugLog('WorkPage', 'refreshWorkspaces - baseDir', baseDir);

        // Ensure base directory exists
        await mkdir(baseDir, { recursive: true });

        const entries = await readDir(baseDir);
        const folders = entries
            .filter(e => e.isDirectory)
            .map(e => e.name);
        
        folders.sort((a, b) => a.localeCompare(b));
        workspaceOptions.value = folders;
        debugLog('WorkPage', 'refreshWorkspaces - found folders', folders);

        // Auto create Default if empty
          if (folders.length === 0) {
            debugLog('WorkPage', 'refreshWorkspaces - no workspaces found, creating Default');
            await createDefaultWorkspace();
            return;
        }

        const currentWorkspaceName = findExistingWorkspaceOption(workspaceName.value);
        const savedWorkspaceName = findExistingWorkspaceOption(getRememberedWorkspaceForCurrentGame());
        const fallbackWorkspaceName = findExistingWorkspaceOption(DEFAULT_WORKSPACE_NAME) || folders[0];
        const targetWorkspaceName = currentWorkspaceName || savedWorkspaceName || fallbackWorkspaceName;

        if (!targetWorkspaceName) {
          workspaceDraftName.value = '';
          return;
        }

        if (currentWorkspaceName === targetWorkspaceName) {
          workspaceDraftName.value = targetWorkspaceName;
          return;
        }

        debugLog('WorkPage', 'refreshWorkspaces - switching to', targetWorkspaceName);
        await switchWorkspace(targetWorkspaceName);

    } catch (err) {
        console.error('Failed to refresh workspaces', err);
    } finally {
        isScanningWorkspaces.value = false;
    }
};

const createWorkspaceDirectory = async (name: string, options?: { showMessage?: boolean; switchAfterCreate?: boolean }) => {
    const normalizedName = normalizeWorkspaceNameInput(name);
    if (!normalizedName) return;
    try {
        const baseDir = await getWorkspaceBaseDir();
        if (!baseDir) {
            ElMessage.warning(t('workPage.messages.cacheDirNotConfigured')); 
           return;
        }
        const targetPath = await join(baseDir, normalizedName);
        await mkdir(targetPath, { recursive: true });
        
        // Refresh list
        const entries = await readDir(baseDir);
         const folders = entries
            .filter(e => e.isDirectory)
            .map(e => e.name);
         folders.sort((a, b) => a.localeCompare(b));
         workspaceOptions.value = folders;
         workspaceDraftName.value = normalizedName;

         if (options?.switchAfterCreate) {
           await switchWorkspace(normalizedName);
         }
         
         if (options?.showMessage !== false) {
           ElMessage.success(t('workPage.messages.workspaceReady', { name: normalizedName }));
         }
    } catch (err) {
        console.error('Failed to create workspace', err);
        ElMessage.error(t('workPage.messages.createWorkspaceFailed', { name: normalizedName }));
    }
};

const createDefaultWorkspace = async (): Promise<void> => {
  await createWorkspaceDirectory(DEFAULT_WORKSPACE_NAME, { showMessage: false, switchAfterCreate: true });
};


const handleCreateWorkspace = async () => {
  const targetWorkspaceName = normalizeWorkspaceNameInput(workspaceDraftName.value);
  if (!targetWorkspaceName) {
    ElMessage.warning(t('workPage.messages.enterWorkspaceName'));
    return;
  }

  // Confirm creation to avoid mis-clicks
  try {
    await ElMessageBox.confirm(
      t('workPage.messages.confirmCreateWorkspace', { name: targetWorkspaceName }),
      t('workPage.dialog.confirmCreationTitle'),
      { confirmButtonText: t('workPage.common.create'), cancelButtonText: t('workPage.common.cancel'), type: 'warning' }
    );
  } catch (err: unknown) {
    if (err && (err === 'cancel' || (err instanceof Error && /cancel|取消/.test(err.message)))) return;
    // otherwise continue (but it's safe to return)
    return;
  }

  // Check if duplicate
  if (findExistingWorkspaceOption(targetWorkspaceName)) {
    ElMessage.info(t('workPage.messages.workspaceAlreadyExists'));
     return;
  }

  await createWorkspaceDirectory(targetWorkspaceName, { switchAfterCreate: true });
};

onMounted(() => {
  void (async () => {
    try {
      unlistenNativeDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
        const payload = event?.payload as { paths?: string[] };
        const firstPath = (payload?.paths?.[0] || '').trim();
        if (!firstPath) {
          return;
        }

        await applyDroppedFrameAnalysisFolder(firstPath);
      });
    } catch (error) {
      debugError('WorkPage.DnD', 'Failed to attach native drop listener', error);
    }
  })();

  ensureTrailingEmptyRow();
  ensureTrailingSkipRow();
  ensureTrailingVSRow();
  void (async () => {
    await waitForInitialAppState();
    await loadSpecificIbDumpState();
    await refreshWorkspaces();
  })();
  
  // If options are empty, try auto-refresh.
  if (frameAnalysisOptions.value.length === 0) {
      refreshFrameAnalysisFolders();
  }
  debugLog('WorkPage', 'onMounted - initialized');
});

onBeforeUnmount(() => {
  const snapshot = createWorkspaceTabSaveSnapshot();
  if (snapshot) {
    void flushCurrentWorkspaceTabConfig(snapshot);
  }

  if (unlistenNativeDrop) {
    unlistenNativeDrop();
    unlistenNativeDrop = null;
  }
});

// If KeepAlive is enabled, onActivated will also fire.
onActivated(() => {
    if (frameAnalysisOptions.value.length === 0) {
      refreshFrameAnalysisFolders();
    }
    void loadSpecificIbDumpState();
    // Also refresh workspace list on activation to ensure current selection and configs are re-read
    refreshWorkspaces();
    debugLog('WorkPage', 'onActivated - refreshed frame analysis and workspaces');
});


const handleCreateFromConfig = async () => {
  // Workflow: remember current DrawIB list -> create/switch to target workspace ->
  // restore remembered DrawIB list and save.
  const targetWorkspaceName = normalizeWorkspaceNameInput(workspaceDraftName.value);
  if (!targetWorkspaceName) {
    ElMessage.warning(t('workPage.messages.enterWorkspaceNameToCreate'));
    return;
  }

  const rememberedConfig = cloneWorkspaceTabConfig(buildCurrentWorkspaceTabConfig());
  const sourceSnapshot = createWorkspaceTabSaveSnapshot();

  try {
    // Confirm creation to avoid mis-clicks
    try {
      await ElMessageBox.confirm(
        t('workPage.messages.confirmCreateAndApply', { name: targetWorkspaceName }),
        t('workPage.dialog.confirmCreateAndApplyTitle'),
        { confirmButtonText: t('workPage.common.create'), cancelButtonText: t('workPage.common.cancel'), type: 'warning' }
      );
    } catch (err: unknown) {
      if (err && (err === 'cancel' || (err instanceof Error && /cancel|取消/.test(err.message)))) return;
      return;
    }

    if (findExistingWorkspaceOption(targetWorkspaceName)) {
      ElMessage.info(t('workPage.messages.workspaceAlreadyExists'));
      return;
    }

    if (sourceSnapshot) {
      await flushCurrentWorkspaceTabConfig(sourceSnapshot);
    }

    await createWorkspaceDirectory(targetWorkspaceName, { switchAfterCreate: true });

    await applyWorkspaceTabConfig(rememberedConfig);
    await saveWorkspaceTabsIndex();
    await saveCurrentWorkspaceTabConfig();
    ElMessage.success(t('workPage.messages.workspaceCreatedAndApplied', { name: targetWorkspaceName }));
  } catch (err) {
    console.error('handleCreateFromConfig failed', err);
    ElMessage.error(t('workPage.messages.createAndSwitchWorkspaceFailed'));
  }
};

const handleOpenWorkspace = async () => {
    const baseDir = await getWorkspaceBaseDir();

    // Normally no need to check workspace dir existence here because this page ensures it.
    // Kept as a defensive guard for rare manual deletions.
    if (!baseDir || !workspaceName.value) {
          ElMessage.warning(t('workPage.messages.selectValidWorkspaceFirst'));
         return;
    }
    const path = await join(baseDir, workspaceName.value);
    await mkdir(path, { recursive: true });
        openPath(path, t('workPage.messages.openFailed'));
};

const handleOpenWorkspaceGeneratedModFolder = async () => {
  if (!workspaceName.value) {
    ElMessage.warning(t('workPage.messages.selectValidWorkspaceFirst'));
    return;
  }

  const generatedModPath = await PathHelper.GetWorkspaceGeneratedModFolderPath(workspaceName.value);
  await openPath(generatedModPath, t('workPage.messages.openGeneratedModFolderFailed'));
};



const handleClearWorkspace = async () => {
  if (!workspaceName.value) return;
  const currentWorkspaceName = workspaceName.value;
  try {
    await ElMessageBox.confirm(
      t('workPage.messages.confirmClearWorkspace', { name: currentWorkspaceName }),
      t('workPage.dialog.confirmClearTitle'),
      { confirmButtonText: t('workPage.common.confirm'), cancelButtonText: t('workPage.common.cancel'), type: 'warning' }
    );

    const baseDir = await getWorkspaceBaseDir();
    if (!baseDir) return;

    const workspaceDir = await join(baseDir, currentWorkspaceName);
    await mkdir(workspaceDir, { recursive: true });

  clearPendingSaveTimers();
  setAllConfigLoading(true);

    // Remove all contents in workspace directory, keep the directory itself.
    const entries = await readDir(workspaceDir);
    for (const entry of entries) {
      if (!entry.name) {
        continue;
      }

      const targetPath = await join(workspaceDir, entry.name);
      try {
        if (entry.isDirectory) {
          await moveDirectoryToRecycleBin(targetPath);
        } else {
          await moveFileToRecycleBin(targetPath);
        }
      } catch {
        // Ignore single-entry failure and continue cleanup.
      }
    }

    createInMemoryDefaultWorkspaceState();
    workspaceDraftName.value = currentWorkspaceName;
    await saveWorkspaceTabsIndexBySnapshot(currentWorkspaceName, activeWorkspaceTabId.value, buildWorkspaceTabsSnapshot());
    await saveWorkspaceTabConfigBySnapshot(
      currentWorkspaceName,
      activeWorkspaceTabId.value,
      normalizeWorkspaceTabConfig(),
      buildWorkspaceTabsSnapshot()
    );
    setAllConfigLoading(false);

    ElMessage.success(t('workPage.messages.workspaceCleared'));
  } catch (err: unknown) {
    setAllConfigLoading(false);
    // If user canceled, ignore.
    if (err && err === 'cancel') return;
    // Element Plus confirm throws an object on cancel, safe to ignore.
    if (err && err instanceof Error && /cancel|取消/.test(err.message)) return;
    ElMessage.error(t('workPage.messages.clearWorkspaceFailed'));
    console.error(err);
  }
};

const handleDeleteWorkspace = async (targetWorkspaceName = workspaceName.value) => {
   const currentWorkspaceName = findExistingWorkspaceOption(targetWorkspaceName);
   if (!currentWorkspaceName) return;
   try {
    await ElMessageBox.confirm(
      t('workPage.messages.confirmDeleteWorkspace', { name: currentWorkspaceName }),
      t('workPage.dialog.confirmDeleteTitle'),
      { confirmButtonText: t('workPage.common.delete'), cancelButtonText: t('workPage.common.cancel'), type: 'warning' }
    );

    const baseDir = await getWorkspaceBaseDir();
    if (!baseDir) return;
    const path = await join(baseDir, currentWorkspaceName);

    clearPendingSaveTimers();
    setAllConfigLoading(true);

    await movePathToRecycleBin(path);
    ElMessage.success(t('workPage.messages.workspaceDeleted', { name: currentWorkspaceName }));

    if (currentWorkspaceName === workspaceName.value) {
      workspaceName.value = '';
      workspaceDraftName.value = '';
      rememberWorkspaceForCurrentGame('');
      resetLeftThreeLists();
      workspaceTabs.value = [];
      activeWorkspaceTabId.value = '';
      editingWorkspaceTabId.value = null;
      workspaceTabNameEditBackup.value = {};
    } else if (currentWorkspaceName === workspaceDraftName.value) {
      workspaceDraftName.value = workspaceName.value;
    }

    await nextTick();

    setAllConfigLoading(false);
    await refreshWorkspaces();
   } catch (err: unknown) {
     setAllConfigLoading(false);
     if (err && err === 'cancel') return;
     if (err && err instanceof Error && /cancel|取消/.test(err.message)) return;
    ElMessage.error(t('workPage.messages.deleteFailed'));
     console.error(err);
   }
};
</script>

<template>
  <div class="work-page-container">
    <div class="work-layout">
      <div class="main-column">
        <div class="panel-stack glass-scrollbar">
          <section class="panel workspace-tabs-shell">
            <div class="workspace-tabs-head">
              <div class="workspace-tabs-list">
                <div
                  v-for="tab in workspaceTabs"
                  :key="tab.id"
                  class="workspace-tab-chip"
                  :class="{ 'is-active': tab.id === activeWorkspaceTabId }"
                  @click="handleSelectWorkspaceTab(tab.id)"
                >
                  <span class="workspace-tab-name">
                    {{ tab.name }}
                  </span>

                  <el-button
                    text
                    class="workspace-tab-delete"
                    @click.stop="handleDeleteWorkspaceTab(tab.id)"
                  >
                    ×
                  </el-button>
                </div>
              </div>

              <el-button plain @click="handleAddWorkspaceTab">
                {{ t('workPage.actions.addWorkspaceTab') }}
              </el-button>
            </div>

            <div class="workspace-tabs-content">
              <ExtractConfigSection
                v-model:selectedFrameAnalysis="selectedFrameAnalysis"
                v-model:frameAnalysisFolderPath="frameAnalysisFolderPath"
                v-model:extractPanelTab="extractPanelTab"
                v-model:modelRows="modelRows"
                v-model:convertRgbaChannelTextures="convertRgbaChannelTextures"
                v-model:fullExtractDataTypeFilter="fullExtractDataTypeFilter"
                :frameAnalysisOptions="frameAnalysisOptions"
                :isRefreshing="isRefreshing"
                :isFrameAnalysisPathInvalid="isFrameAnalysisPathInvalid"
                :isExtracting="isExtracting"
                :fullExtractDataTypeFilterOptions="FULL_EXTRACT_DATA_TYPE_FILTER_OPTIONS"
                @refresh="refreshFrameAnalysisFolders"
                @selectLatest="handleSelectLatestFrameAnalysis"
                @pickFolder="handlePickFrameAnalysisFolder"
                @openFolder="handleOpenFrameAnalysisFolderPath"
                @dropFolder="handleDropFrameAnalysisFolder"
                @selectFrameAnalysisOption="handleFrameAnalysisOptionClick"
                @moveModelRow="moveModelRow"
                @removeModelRow="removeModelRow"
                @extractModels="handleExtractModels"
                @fullExtract="handleFullExtract"
              />

              <ConfigTables
                v-model:skip-rows="skipRows"
                v-model:vs-rows="vsRows"
                @removeSkipRow="removeSkipRow"
                @generateIBSkip="handleGenerateIBSkip"
                @removeVSCheckRow="removeVSCheckRow"
                @updateVSCheck="handleUpdateVSCheck"
                @generateVSCheck="handleGenerateVSCheck"
              />
            </div>
          </section>
        </div>
      </div>

      <SidePanel
        v-model:workspaceDraftName="workspaceDraftName"
        v-model:drawerCollapsed="workPageDrawerCollapsed"
        v-model:useSpecificIbDump="useSpecificIbDump"
        :workspaceName="workspaceName"
        :workspaceOptions="workspaceOptions"
        :isSpecificIbDumpToggling="isSpecificIbDumpToggling"
        @createWorkspace="handleCreateWorkspace"
        @createFromConfig="handleCreateFromConfig"
        @openWorkspace="handleOpenWorkspace"
        @openGeneratedMod="handleOpenWorkspaceGeneratedModFolder"
        @clearWorkspace="handleClearWorkspace"
        @deleteWorkspace="handleDeleteWorkspace"
        @selectWorkspace="handleWorkspaceSelectionChange"
        @folderMenu="handleFolderMenu"
        @textureMenu="handleTextureMenu"
        @specificIbDumpToggle="handleSpecificIbDumpToggle"
      />

    </div>
  </div>
</template>

<style scoped>
.work-page-container {
  --work-crystal: var(--theme-accent);
  --work-crystal-rgb: var(--theme-accent-rgb);
  --work-crystal-soft: rgba(var(--theme-surface-tint-rgb), 0.08);
  --work-crystal-border: rgba(var(--theme-surface-tint-rgb), 0.18);
  --work-crystal-text: rgba(var(--theme-text-secondary-rgb), 0.78);
  --work-danger-bg: rgba(245, 108, 108, 0.18);
  --work-danger-border: rgba(245, 108, 108, 0.42);
  --work-danger-text: rgba(255, 178, 178, 1);
  --el-color-primary: var(--theme-accent);
  --el-color-primary-light-3: rgba(var(--theme-surface-tint-rgb), 0.72);
  --el-color-primary-light-5: rgba(var(--theme-surface-tint-rgb), 0.52);
  --el-color-primary-light-7: rgba(var(--theme-surface-tint-rgb), 0.30);
  --el-color-primary-light-8: rgba(var(--theme-surface-tint-rgb), 0.20);
  --el-color-primary-light-9: rgba(var(--theme-surface-tint-rgb), 0.10);
  --el-color-primary-dark-2: #42BFF2;
  padding: 28px;
  /* padding-top: 60px; Safe Area Removed */
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #e8ecf5;
  overflow: hidden;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}



.work-layout {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 4fr) minmax(260px, 1.15fr);
  gap: 24px;
}

.main-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

.workspace-tabs-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.workspace-tabs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.workspace-tabs-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.workspace-tab-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 2px 6px 2px 8px;
  border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.12);
  border-radius: 8px;
  background: rgba(var(--theme-surface-tint-rgb), 0.035);
  color: rgba(var(--theme-text-secondary-rgb), 0.78);
  cursor: pointer;
  transition: all 0.25s ease;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.workspace-tab-chip.is-active {
  border-color: rgba(var(--theme-surface-tint-rgb), 0.42);
  background: rgba(var(--theme-surface-tint-rgb), 0.12);
  color: rgba(var(--theme-text-primary-rgb), 0.98);
  box-shadow: 0 6px 18px rgba(var(--theme-surface-tint-rgb), 0.08);
}

.workspace-tab-name {
  font-size: 0.82rem;
  line-height: 1;
}

.workspace-tab-delete {
  min-width: 18px;
  height: 18px;
  padding: 0;
  color: rgba(255, 178, 178, 0.86);
}

.workspace-tab-input {
  width: 140px;
}

.workspace-tabs-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}


.workspace-tabs-shell :deep(.controls-row .el-button),
.workspace-tabs-shell :deep(.inner-panel .el-button:not(.workspace-tab-delete)),
.workspace-tabs-head .el-button {
  --el-button-bg-color: rgba(var(--work-crystal-rgb), 0.045);
  --el-button-border-color: rgba(var(--work-crystal-rgb), 0.14);
  --el-button-text-color: var(--work-crystal-text);
  --el-button-hover-bg-color: rgba(var(--work-crystal-rgb), 0.10);
  --el-button-hover-border-color: rgba(var(--work-crystal-rgb), 0.30);
  --el-button-hover-text-color: var(--work-crystal);
  --el-button-active-bg-color: rgba(var(--work-crystal-rgb), 0.08);
  --el-button-active-border-color: rgba(var(--work-crystal-rgb), 0.34);
  --el-button-active-text-color: var(--work-crystal);
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--el-button-border-color) !important;
  background: var(--el-button-bg-color) !important;
  color: var(--el-button-text-color) !important;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}
.workspace-tabs-shell :deep(.controls-row .el-button)::before,
.workspace-tabs-shell :deep(.inner-panel .el-button:not(.workspace-tab-delete))::before,
.workspace-tabs-head .el-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--work-crystal-rgb), 0.16), transparent);
  pointer-events: none;
}
.workspace-tabs-shell :deep(.controls-row .el-button):hover,
.workspace-tabs-shell :deep(.inner-panel .el-button:not(.workspace-tab-delete)):hover,
.workspace-tabs-head .el-button:hover {
  background: var(--el-button-hover-bg-color) !important;
  border-color: var(--el-button-hover-border-color) !important;
  color: var(--el-button-hover-text-color) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.workspace-tabs-shell :deep(.controls-row .el-button):active,
.workspace-tabs-shell :deep(.inner-panel .el-button:not(.workspace-tab-delete)):active,
.workspace-tabs-head .el-button:active {
  transform: translateY(0) scale(0.98);
}
.workspace-tabs-shell :deep(.controls-row .el-button).is-disabled,
.workspace-tabs-shell :deep(.controls-row .el-button).is-disabled:hover,
.workspace-tabs-shell :deep(.inner-panel .el-button.is-disabled:not(.workspace-tab-delete)),
.workspace-tabs-shell :deep(.inner-panel .el-button.is-disabled:not(.workspace-tab-delete)):hover,
.workspace-tabs-head .el-button.is-disabled,
.workspace-tabs-head .el-button.is-disabled:hover {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none !important;
  background: var(--el-button-bg-color) !important;
  border-color: var(--el-button-border-color) !important;
}

.workspace-tabs-shell :deep(.controls-row .el-button.el-button--primary),
.workspace-tabs-shell :deep(.inner-panel .el-button.el-button--primary:not(.workspace-tab-delete)) {
  --el-button-bg-color: rgba(var(--work-crystal-rgb), 0.07);
  --el-button-border-color: rgba(var(--work-crystal-rgb), 0.20);
  --el-button-text-color: rgba(var(--work-crystal-rgb), 0.88);
  --el-button-hover-bg-color: rgba(var(--work-crystal-rgb), 0.13);
  --el-button-hover-border-color: rgba(var(--work-crystal-rgb), 0.34);
  --el-button-hover-text-color: var(--work-crystal);
}

.workspace-tabs-shell :deep(.controls-row .el-button .el-icon),
.workspace-tabs-shell :deep(.inner-panel .el-button .el-icon) {
  margin-right: 6px;
}

.workspace-tabs-shell :deep(.el-button .circular path) {
  stroke: var(--theme-accent) !important;
}

.workspace-tabs-shell :deep(.el-button.is-loading::before) {
  background-color: rgba(8, 22, 32, 0.24) !important;
}

.workspace-tabs-shell :deep(.el-loading-spinner .path),
.workspace-tabs-shell :deep(.el-loading-spinner .circular path) {
  stroke: var(--theme-accent) !important;
}

.workspace-tabs-shell :deep(.el-button--primary) {
  --el-button-bg-color: rgba(var(--theme-surface-tint-rgb), 0.07) !important;
  --el-button-border-color: rgba(var(--theme-surface-tint-rgb), 0.20) !important;
  --el-button-text-color: rgba(var(--theme-surface-tint-rgb), 0.88) !important;
  --el-button-hover-bg-color: rgba(var(--theme-surface-tint-rgb), 0.13) !important;
  --el-button-hover-border-color: rgba(var(--theme-surface-tint-rgb), 0.34) !important;
  --el-button-hover-text-color: var(--theme-accent) !important;
  --el-button-active-bg-color: rgba(var(--theme-surface-tint-rgb), 0.10) !important;
  --el-button-active-border-color: rgba(var(--theme-surface-tint-rgb), 0.40) !important;
  --el-button-active-text-color: var(--theme-accent) !important;
}

.workspace-tabs-shell :deep(.el-input__wrapper),
.workspace-tabs-shell :deep(.el-select__wrapper) {
  background: rgba(255, 255, 255, 0.045) !important;
  box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.10) inset !important;
}

.workspace-tabs-shell :deep(.el-input__wrapper:hover),
.workspace-tabs-shell :deep(.el-input__wrapper.is-focus),
.workspace-tabs-shell :deep(.el-select__wrapper:hover),
.workspace-tabs-shell :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.28) inset !important;
}

.workspace-tabs-shell :deep(.glass-table.el-table) {
  border-color: rgba(var(--theme-surface-tint-rgb), 0.10) !important;
  border-radius: 8px !important;
  overflow: hidden !important;
  background: rgba(var(--theme-surface-tint-rgb), 0.022) !important;
  box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.10) inset;
}

.workspace-tabs-shell :deep(.glass-table .el-table__inner-wrapper),
.workspace-tabs-shell :deep(.glass-table .el-table__header-wrapper),
.workspace-tabs-shell :deep(.glass-table .el-table__body-wrapper),
.workspace-tabs-shell :deep(.glass-table .el-scrollbar),
.workspace-tabs-shell :deep(.glass-table .el-scrollbar__wrap),
.workspace-tabs-shell :deep(.glass-table .el-scrollbar__view) {
  border-radius: 8px !important;
  overflow: hidden !important;
}

.workspace-tabs-shell :deep(.glass-table.el-table th.el-table__cell) {
  background: rgba(var(--theme-surface-tint-rgb), 0.055) !important;
  color: rgba(var(--theme-text-secondary-rgb), 0.80) !important;
}

.workspace-tabs-shell :deep(.glass-table.el-table::before),
.workspace-tabs-shell :deep(.glass-table.el-table::after),
.workspace-tabs-shell :deep(.glass-table .el-table__inner-wrapper::before),
.workspace-tabs-shell :deep(.glass-table .el-table__inner-wrapper::after) {
  background-color: rgba(var(--theme-surface-tint-rgb), 0.10) !important;
}

.workspace-tabs-shell :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: rgba(var(--theme-surface-tint-rgb), 0.80) !important;
  border-color: rgba(var(--theme-surface-tint-rgb), 0.95) !important;
}

.workspace-tabs-shell :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
  color: rgba(var(--theme-text-secondary-rgb), 0.90) !important;
}

.panel {
  background: rgba(var(--theme-surface-tint-rgb), 0.018);
  border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.09);
  border-radius: 8px;
  padding: 18px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  transition: all 0.25s ease;
  position: relative;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--theme-surface-tint-rgb), 0.14), transparent);
  pointer-events: none;
  border-radius: 8px 8px 0 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-head h2 {
  margin: 6px 0 4px;
  font-size: 1.35rem;
  font-weight: 600;
}

.hint {
  margin: 0;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.92rem;
}

.muted {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.10);
  /* 更透明的 muted 背景以减少灰蓝感 */
  background: rgba(15, 18, 28, 0.45);
}

@media (max-width: 960px) {
  .work-page-container {
    overflow: auto;
  }

  .work-layout {
    grid-template-columns: 1fr;
  }

  .main-column {
    min-height: auto;
  }

  .panel-stack {
    overflow: visible;
    padding-right: 0;
  }
}
</style>
