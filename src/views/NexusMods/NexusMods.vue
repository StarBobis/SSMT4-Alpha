<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { AppStateManager } from '../../store/AppStateManager';
import { ModManager } from '../../store/ModManager';
import { ResourceManager } from '../../store/ResourceManager';
import { setGameBananaBlurMode, setGameBananaHideNsfw } from '../GameBanana/gameBananaBlurSettings';

type NexusFeed = 'latest_added' | 'latest_updated' | 'trending';

interface NexusApiMod {
  mod_id?: number;
  name?: string;
  summary?: string;
  description?: string;
  author?: string;
  uploaded_by?: string;
  picture_url?: string;
  adult_content?: boolean;
  mod_downloads?: number;
  endorsement_count?: number;
  version?: string;
  uploaded_timestamp?: number;
  updated_timestamp?: number;
  category_id?: number;
  category_name?: string;
  available?: boolean;
}

interface NexusApiFile {
  file_id?: number;
  name?: string;
  file_name?: string;
  version?: string;
  category_id?: number;
  category_name?: string;
  size?: number;
  size_kb?: number;
  size_in_bytes?: number;
  size_bytes?: number;
  file_size?: number;
  file_size_bytes?: number;
  is_primary?: boolean;
  status?: string;
  uploaded_timestamp?: number;
}

interface NexusFilesResponse {
  files?: NexusApiFile[];
}

interface NexusDownloadLink {
  URI?: string;
  uri?: string;
}

interface NexusModCard {
  id: number;
  title: string;
  summary: string;
  author: string;
  thumbnailUrl: string;
  isNsfw: boolean;
  downloads: number;
  endorsements: number;
  version: string;
  updatedAt: number;
  category: string;
}

interface NexusModDetail extends NexusModCard {
  description: string;
  files: NexusFile[];
}

interface NexusFile {
  id: number;
  name: string;
  archiveName: string;
  version: string;
  category: string;
  size: number;
  uploadedAt: number;
  isPrimary: boolean;
}

interface InstallProgressEvent {
  gameName?: string;
  game_name?: string;
  modName?: string;
  mod_name?: string;
  stage?: string;
  current?: number;
  total?: number;
}

const NEXUS_API_BASE = 'https://api.nexusmods.com/v1';
const NEXUS_INSTALL_GROUP = 'NexusMods';
const NEXUS_DOMAIN_BY_PRESET: Record<string, string> = {
  SRMI: 'honkaistarrail',
  GIMI: 'genshinimpact',
  ZZMI: 'zenlesszonezero',
  ZZMIDX12: 'zenlesszonezero',
  WWMI: 'wutheringwaves',
};
const FEED_OPTIONS: Array<{ value: NexusFeed; label: string }> = [
  { value: 'latest_added', label: 'nexusMods.latestAdded' },
  { value: 'latest_updated', label: 'nexusMods.latestUpdated' },
  { value: 'trending', label: 'nexusMods.trending' },
];

const { t } = useI18n();
const appSettings = AppStateManager.appSettings;
const feed = ref<NexusFeed>('latest_added');
const searchQuery = ref('');
const mods = ref<NexusModCard[]>([]);
const detail = ref<NexusModDetail | null>(null);
const selectedModId = ref<number | null>(null);
const loadingMods = ref(false);
const loadingDetail = ref(false);
const errorMessage = ref('');
const downloadedFileIds = ref(new Set<number>());
const installingFileId = ref<number | null>(null);
const downloadProgress = ref(0);
const installProgress = ref(0);
const installStatus = ref('');
const installPhase = ref<'idle' | 'downloading' | 'installing'>('idle');
const gameDomain = ref('');
const gameTargetLabel = ref('');
const showGameDomainInput = ref(false);
const currentPage = ref(1);
const hasMorePages = ref(false);
let modsRequestId = 0;
let activeInstall: { gameName: string; targetName: string } | null = null;
let downloadedStateRequestId = 0;
let unlistenDownloadProgress: UnlistenFn | null = null;
let unlistenInstallProgress: UnlistenFn | null = null;

const currentGameName = computed(() => appSettings.CurrentGameName?.trim() || '');
const gamePageUrl = computed(() => gameDomain.value ? `https://www.nexusmods.com/${encodeURIComponent(gameDomain.value)}` : 'https://www.nexusmods.com/');
const isInstalling = computed(() => installingFileId.value !== null);
const visibleMods = computed(() => {
  const search = searchQuery.value.trim().toLowerCase();
  return mods.value.filter((mod) => {
    if (appSettings.gamebananaHideNsfw && mod.isNsfw) return false;
    return !search || [mod.title, mod.author, mod.category, mod.summary].join(' ').toLowerCase().includes(search);
  });
});
const gameBananaBlurMode = computed({ get: () => appSettings.gamebananaBlurMode, set: (mode) => setGameBananaBlurMode(appSettings, mode) });

const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const asNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const asBoolean = (value: unknown): boolean => value === true || value === 1 || value === 'true';

const toPlainText = (value: unknown): string => asString(value)
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ')
  .trim();

const formatNumber = (value: number): string => new Intl.NumberFormat().format(Math.max(0, value || 0));
const formatDate = (timestamp: number): string => timestamp > 0 ? new Date(timestamp * 1000).toLocaleDateString() : '—';
const formatFileSize = (value: number): string => {
  const bytes = Math.max(0, value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const isAvailableMod = (source: NexusApiMod): boolean => source.available === undefined || asBoolean(source.available);
const normalizeMod = (source: NexusApiMod): NexusModCard => ({
  id: asNumber(source.mod_id),
  title: asString(source.name) || `Mod #${asNumber(source.mod_id)}`,
  summary: toPlainText(source.summary || source.description),
  author: asString(source.author || source.uploaded_by) || t('nexusMods.unknownAuthor'),
  thumbnailUrl: asString(source.picture_url),
  isNsfw: asBoolean(source.adult_content),
  downloads: asNumber(source.mod_downloads),
  endorsements: asNumber(source.endorsement_count),
  version: asString(source.version),
  updatedAt: asNumber(source.updated_timestamp || source.uploaded_timestamp),
  category: asString(source.category_name),
});

const normalizeFileSize = (source: NexusApiFile): number => {
  const preciseBytes = asNumber(source.size_in_bytes ?? source.size_bytes ?? source.file_size_bytes ?? source.file_size);
  if (preciseBytes > 0) return Math.round(preciseBytes);
  // Nexus's legacy file endpoint exposes both `size` and `size_kb` in KiB.
  return Math.round(Math.max(0, asNumber(source.size_kb ?? source.size)) * 1024);
};

const isDownloadableFile = (source: NexusApiFile): boolean => {
  const categoryId = asNumber(source.category_id);
  const category = asString(source.category_name).toLowerCase();
  const status = asString(source.status).toLowerCase();
  return asNumber(source.file_id) > 0
    && Boolean(asString(source.name || source.file_name))
    && ![4, 6, 7].includes(categoryId)
    && !/(old|deleted|archived)/.test(category)
    && !/(old|deleted|archived|removed)/.test(status);
};

const normalizeFile = (source: NexusApiFile): NexusFile => ({
  id: asNumber(source.file_id),
  name: asString(source.name || source.file_name) || `File #${asNumber(source.file_id)}`,
  // `name` is only a display label on Nexus (for example, "Main files").
  // Preserve `file_name` so the streamed installer can identify .zip/.7z/.rar.
  archiveName: asString(source.file_name || source.name) || `nexus-file-${asNumber(source.file_id)}.download`,
  version: asString(source.version),
  category: asString(source.category_name),
  size: normalizeFileSize(source),
  uploadedAt: asNumber(source.uploaded_timestamp),
  isPrimary: asBoolean(source.is_primary) || asNumber(source.category_id) === 1 || asString(source.category_name).toLowerCase() === 'main files',
});

const apiGet = async <T>(path: string): Promise<T> => {
  const key = appSettings.nexusModsApiKey.trim();
  if (!key) throw new Error(t('nexusMods.apiKeyRequired'));
  const response = await fetch(`${NEXUS_API_BASE}${path}`, {
    method: 'GET',
    headers: { apikey: key, accept: 'application/json' },
  });
  if (!response.ok) {
    let message = '';
    try {
      const data = await response.json() as { message?: unknown; detail?: unknown; error?: unknown };
      message = asString(data.message || data.detail || data.error);
    } catch {
      // The status still makes the failure actionable when Nexus returns HTML.
    }
    throw new Error(message || `Nexus Mods HTTP ${response.status}`);
  }
  return await response.json() as T;
};

const openExternal = async (url: string) => {
  try {
    await openUrl(url);
  } catch (error) {
    ElMessage.error(t('nexusMods.errors.openExternal', { error: String(error) }));
  }
};

const clearModResults = () => {
  mods.value = [];
  detail.value = null;
  selectedModId.value = null;
  downloadedFileIds.value = new Set();
  currentPage.value = 1;
  hasMorePages.value = false;
};

const loadMods = async (requestedPage = 1) => {
  if (!appSettings.nexusModsApiKey.trim()) {
    errorMessage.value = t('nexusMods.apiKeyRequired');
    return;
  }
  if (!gameDomain.value) {
    errorMessage.value = t('nexusMods.errors.loadMods', { error: t('nexusMods.gameDomain') });
    return;
  }

  loadingMods.value = true;
  errorMessage.value = '';
  const requestId = ++modsRequestId;
  try {
    // The API exposes these feeds in batches.  Page is intentionally sent as a
    // query parameter; older API deployments that do not support it are
    // detected below instead of showing a duplicate first page.
    const separator = '?';
    const data = await apiGet<NexusApiMod[]>(`/games/${encodeURIComponent(gameDomain.value)}/mods/${feed.value}.json${separator}page=${Math.max(1, requestedPage)}`);
    if (requestId !== modsRequestId) return;
    const pageMods = (Array.isArray(data) ? data : [])
      .filter(isAvailableMod)
      .map(normalizeMod)
      .filter((mod) => mod.id > 0 && !/^mod\s*#\d+$/i.test(mod.title));
    const previousIds = new Set(mods.value.map((mod) => mod.id));
    const hasNewItems = requestedPage <= 1 || pageMods.some((mod) => !previousIds.has(mod.id));
    if (requestedPage > 1 && !hasNewItems) {
      hasMorePages.value = false;
      return;
    }
    mods.value = pageMods;
    currentPage.value = Math.max(1, requestedPage);
    hasMorePages.value = pageMods.length >= 10;
    detail.value = null;
    selectedModId.value = null;
    downloadedFileIds.value = new Set();
    if (visibleMods.value[0]) await selectMod(visibleMods.value[0]);
  } catch (error) {
      clearModResults();
    errorMessage.value = t('nexusMods.errors.loadMods', { error: String(error) });
  } finally {
    loadingMods.value = false;
  }
};

const selectMod = async (mod: NexusModCard) => {
  if (!gameDomain.value || !mod.id) return;
  const requestId = mod.id;
  selectedModId.value = mod.id;
  loadingDetail.value = true;
  try {
    const [rawDetail, rawFiles] = await Promise.all([
      apiGet<NexusApiMod>(`/games/${encodeURIComponent(gameDomain.value)}/mods/${mod.id}.json`),
      apiGet<NexusFilesResponse>(`/games/${encodeURIComponent(gameDomain.value)}/mods/${mod.id}/files.json`),
    ]);
    if (selectedModId.value !== requestId) return;
    detail.value = {
      ...normalizeMod(rawDetail),
      description: toPlainText(rawDetail.description || rawDetail.summary),
      files: (rawFiles.files || []).filter(isDownloadableFile).map(normalizeFile),
    };
    await refreshDownloadedFileState(detail.value);
  } catch (error) {
    if (selectedModId.value === requestId) {
      detail.value = null;
      downloadedFileIds.value = new Set();
      errorMessage.value = t('nexusMods.errors.loadDetail', { error: String(error) });
    }
  } finally {
    if (selectedModId.value === requestId) loadingDetail.value = false;
  }
};

const sanitizeInstallName = (value: string): string => {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim();
  return safe || 'NexusMods Mod';
};

const installTargetName = (mod: NexusModCard): string => sanitizeInstallName(`${mod.title} [${mod.id}]`);
const isFileDownloaded = (file: NexusFile) => downloadedFileIds.value.has(file.id);

const refreshDownloadedFileState = async (mod: NexusModCard | null = detail.value) => {
  const requestId = ++downloadedStateRequestId;
  if (!mod || !currentGameName.value || currentGameName.value === 'Default') {
    downloadedFileIds.value = new Set();
    return;
  }
  try {
    const installDir = await ModManager.getInstallDir(currentGameName.value);
    const installed = await invoke<boolean>('mod_install_target_exists', {
      installDir,
      targetName: installTargetName(mod),
      targetGroup: NEXUS_INSTALL_GROUP,
    });
    if (requestId !== downloadedStateRequestId || detail.value?.id !== mod.id) return;
    downloadedFileIds.value = installed && detail.value
      ? new Set(detail.value.files.map((file) => file.id))
      : new Set();
  } catch (error) {
    if (requestId === downloadedStateRequestId) {
      console.warn('Unable to check the Nexus Mods install target:', error);
      downloadedFileIds.value = new Set();
    }
  }
};

const progressRatio = (current: number | undefined, total: number | undefined, unknownTotalBytes = 220 * 1024 * 1024): number => {
  const normalizedCurrent = Math.max(0, Number(current) || 0);
  const normalizedTotal = Math.max(0, Number(total) || 0);
  if (normalizedTotal > 0) return Math.min(100, normalizedCurrent / normalizedTotal * 100);
  return Math.min(95, normalizedCurrent / unknownTotalBytes * 100);
};

const isActiveInstallEvent = (payload: InstallProgressEvent) => {
  if (!activeInstall) return false;
  const eventGame = payload.gameName || payload.game_name || '';
  const eventMod = payload.modName || payload.mod_name || '';
  return eventGame === activeInstall.gameName && eventMod === activeInstall.targetName;
};

const updateDownloadProgress = (payload: InstallProgressEvent) => {
  if (!isActiveInstallEvent(payload)) return;
  installPhase.value = 'downloading';
  installStatus.value = t('nexusMods.installDownloading');
  downloadProgress.value = progressRatio(payload.current, payload.total);
};

const updateInstallProgress = (payload: InstallProgressEvent) => {
  if (!isActiveInstallEvent(payload)) return;
  const stage = String(payload.stage || '').toLowerCase();
  installPhase.value = 'installing';
  if (stage === 'done') {
    installProgress.value = 100;
    return;
  }
  installStatus.value = t('nexusMods.installInstalling');
  const stageBase = stage === 'analyzing' ? 2 : 6;
  installProgress.value = stage === 'analyzing'
    ? stageBase
    : Math.min(98, stageBase + progressRatio(payload.current, payload.total) * (100 - stageBase) / 100);
};

const installButtonStyle = (file: NexusFile) => ({
  '--nexus-download-progress': `${installingFileId.value === file.id ? downloadProgress.value : 0}%`,
  '--nexus-install-progress': `${installingFileId.value === file.id ? Math.min(downloadProgress.value, installProgress.value) : 0}%`,
});

const isCancellableDownload = (file: NexusFile) => installingFileId.value === file.id && installPhase.value === 'downloading';
const isFileActionDisabled = (file: NexusFile) => isInstalling.value && !isCancellableDownload(file);
const installButtonLabel = (file: NexusFile) => isCancellableDownload(file)
  ? installStatus.value === t('nexusMods.cancellingDownload') ? installStatus.value : t('nexusMods.cancelDownload')
  : installingFileId.value === file.id ? installStatus.value || t('nexusMods.installInstalling')
    : isFileDownloaded(file) ? t('nexusMods.downloaded') : t('nexusMods.downloadInstall');

const requestDownloadLink = async (modId: number, fileId: number): Promise<string> => {
  const links = await apiGet<NexusDownloadLink[] | NexusDownloadLink>(
    `/games/${encodeURIComponent(gameDomain.value)}/mods/${modId}/files/${fileId}/download_link.json`,
  );
  const entries = Array.isArray(links) ? links : [links];
  const url = entries.map((entry) => asString(entry.URI || entry.uri)).find(Boolean) || '';
  if (!url) throw new Error(t('nexusMods.errors.installNoDownload'));
  return url;
};

const cancelDownloadAndInstall = async (file: NexusFile) => {
  if (!isCancellableDownload(file) || !activeInstall) return;
  installStatus.value = t('nexusMods.cancellingDownload');
  try {
    await invoke('cancel_nexusmods_download_and_install_mod', {
      gameName: activeInstall.gameName,
      targetName: activeInstall.targetName,
    });
  } catch (error) {
    installStatus.value = t('nexusMods.cancelDownload');
    ElMessage.error(t('nexusMods.errors.installFailed', { error: String(error) }));
  }
};

const downloadAndInstall = async (file: NexusFile) => {
  if (!detail.value || isInstalling.value) return;
  const gameName = currentGameName.value;
  if (!gameName || gameName === 'Default') {
    ElMessage.warning(t('nexusMods.errors.installNeedsGame'));
    return;
  }
  if (!appSettings.nexusModsApiKey.trim()) {
    ElMessage.warning(t('nexusMods.apiKeyRequired'));
    return;
  }
  if (isFileDownloaded(file)) {
    try {
      await ElMessageBox.confirm(
        t('nexusMods.downloadAgainConfirm', { name: detail.value.title }),
        t('nexusMods.downloaded'),
        {
          confirmButtonText: t('nexusMods.downloadAgain'),
          cancelButtonText: t('nexusMods.cancel'),
          type: 'warning',
        },
      );
    } catch {
      return;
    }
  }

  const targetName = installTargetName(detail.value);
  installingFileId.value = file.id;
  installStatus.value = t('nexusMods.installDownloading');
  installPhase.value = 'downloading';
  downloadProgress.value = 0;
  installProgress.value = 0;
  try {
    const [installDir, downloadUrl] = await Promise.all([
      ModManager.getInstallDir(gameName),
      requestDownloadLink(detail.value.id, file.id),
    ]);
    activeInstall = { gameName, targetName };
    await invoke('nexusmods_download_and_install_mod', {
      gameName,
      installDir,
      downloadUrl,
      archiveName: file.archiveName,
      targetName,
      targetGroup: NEXUS_INSTALL_GROUP,
      password: null,
      expectedSizeBytes: file.size || null,
      previewUrls: [detail.value.thumbnailUrl].filter(Boolean),
    });
    downloadedFileIds.value = new Set(detail.value.files.map((item) => item.id));
    installStatus.value = t('nexusMods.installComplete');
    ElMessage.success(t('nexusMods.installComplete'));
  } catch (error) {
    if (String(error).includes('Nexus Mods download cancelled')) {
      installStatus.value = t('nexusMods.downloadCancelled');
      ElMessage.info(installStatus.value);
      return;
    }
    installStatus.value = t('nexusMods.errors.installFailed', { error: String(error) });
    ElMessage.error(installStatus.value);
  } finally {
    activeInstall = null;
    installingFileId.value = null;
    installPhase.value = 'idle';
    downloadProgress.value = 0;
    installProgress.value = 0;
  }
};

const handleInstallAction = async (file: NexusFile) => {
  if (isCancellableDownload(file)) {
    await cancelDownloadAndInstall(file);
    return;
  }
  await downloadAndInstall(file);
};

const listenForInstallProgress = async () => {
  const [downloadUnlisten, installUnlisten] = await Promise.all([
    // The backend shares the proven streamed archive transfer with the
    // GameBanana installer; the active target name keeps its events isolated.
    listen<InstallProgressEvent>('gamebanana-install-progress', (event) => updateDownloadProgress(event.payload)),
    listen<InstallProgressEvent>('mod-install-progress', (event) => updateInstallProgress(event.payload)),
  ]);
  unlistenDownloadProgress = downloadUnlisten;
  unlistenInstallProgress = installUnlisten;
};

const syncGameTarget = async () => {
  const gameName = currentGameName.value;
  gameTargetLabel.value = gameName || t('gameBanana.noGameSelected');
  showGameDomainInput.value = true;
  gameDomain.value = appSettings.nexusModsGameDomain.trim().toLowerCase();

  if (gameName && gameName !== 'Default') {
    try {
      const config = await ResourceManager.loadGameConfig(gameName);
      const preset = asString(config?.gamePreset).toUpperCase();
      const resolvedDomain = NEXUS_DOMAIN_BY_PRESET[preset];
      if (resolvedDomain) {
        gameDomain.value = resolvedDomain;
        gameTargetLabel.value = `${gameName} · ${preset}`;
        showGameDomainInput.value = false;
      }
    } catch (error) {
      console.warn('Unable to load the current game configuration for Nexus Mods:', error);
    }
  }
  clearModResults();
};

watch([gameDomain, feed], () => {
  clearModResults();
});

watch(() => appSettings.nexusModsGameDomain, (domain) => {
  if (showGameDomainInput.value) gameDomain.value = domain.trim().toLowerCase();
});

watch(() => appSettings.CurrentGameName, () => {
  void syncGameTarget();
  void refreshDownloadedFileState();
});

onMounted(() => {
  void listenForInstallProgress();
  void syncGameTarget();
});
onBeforeUnmount(() => {
  unlistenDownloadProgress?.();
  unlistenInstallProgress?.();
});
</script>

<template>
  <div class="page-container nexusmods-page">
    <section class="nexus-controls glass-panel">
      <label v-if="showGameDomainInput" class="nexus-field nexus-domain-field">
        <span>{{ t('nexusMods.gameDomain') }}</span>
        <input v-model.trim="appSettings.nexusModsGameDomain" :placeholder="t('nexusMods.gameDomainPlaceholder')" @keyup.enter="() => loadMods(1)" />
      </label>
      <label class="nexus-field nexus-key-field">
        <span>{{ t('nexusMods.apiKey') }}</span>
        <input v-model.trim="appSettings.nexusModsApiKey" type="password" autocomplete="off" :placeholder="t('nexusMods.apiKeyPlaceholder')" @keyup.enter="() => loadMods(1)" />
      </label>
      <label class="nexus-field nexus-feed-field">
        <span>{{ t('nexusMods.feed') }}</span>
        <select v-model="feed">
          <option v-for="option in FEED_OPTIONS" :key="option.value" :value="option.value">{{ t(option.label) }}</option>
        </select>
      </label>
      <label class="nexus-field nexus-adult-field">
        <span>{{ t('nexusMods.adultState') }}</span>
        <el-radio-group v-model="gameBananaBlurMode" class="nexus-adult-mode">
          <el-radio-button value="all">{{ t('gameBanana.blurAllImages') }}</el-radio-button>
          <el-radio-button value="nsfw" :disabled="appSettings.gamebananaHideNsfw">{{ t('gameBanana.blurNsfwImages') }}</el-radio-button>
          <el-radio-button value="none">{{ t('gameBanana.blurNoImages') }}</el-radio-button>
        </el-radio-group>
      </label>
      <label class="nexus-field nexus-hide-field"><span>{{ t('nexusMods.adultState') }}</span><div><el-switch :model-value="appSettings.gamebananaHideNsfw" @change="(value: string | number | boolean) => setGameBananaHideNsfw(appSettings, value === true)" /><span>{{ appSettings.gamebananaHideNsfw ? t('gameBanana.hideNsfw') : t('gameBanana.showNsfw') }}</span></div></label>
      <button type="button" class="nexus-button nexus-button--primary" :disabled="loadingMods" @click="() => loadMods(1)">
        {{ loadingMods ? t('nexusMods.loading') : t('nexusMods.searchAction') }}
      </button>
      <button type="button" class="nexus-button" :disabled="loadingMods" @click="() => loadMods(1)">{{ t('nexusMods.refresh') }}</button>
      <button type="button" class="nexus-button" @click="openExternal(gamePageUrl)">{{ t('nexusMods.openGamePage') }}</button>
    </section>

    <p v-if="errorMessage" class="nexus-error">{{ errorMessage }}</p>

    <main class="nexus-layout">
      <section class="nexus-panel nexus-results glass-panel">
        <header class="nexus-panel-title">
          <span>{{ t('nexusMods.results') }}</span>
          <small>{{ t('nexusMods.resultCount', { count: visibleMods.length }) }}</small>
        </header>
        <label class="nexus-filter">
          <span>{{ t('nexusMods.search') }}</span>
          <input v-model="searchQuery" type="search" :placeholder="t('nexusMods.searchPlaceholder')" />
        </label>
        <div v-if="loadingMods" class="nexus-empty">{{ t('nexusMods.loading') }}</div>
        <div v-else-if="visibleMods.length" class="nexus-mod-list">
          <article
            v-for="mod in visibleMods"
            :key="mod.id"
            class="nexus-mod-card"
            :class="{ active: selectedModId === mod.id }"
            role="button"
            tabindex="0"
            @click="selectMod(mod)"
            @keydown.enter.prevent="selectMod(mod)"
            @keydown.space.prevent="selectMod(mod)"
          >
            <div class="nexus-mod-thumb" :class="{ 'is-nsfw-blurred': appSettings.gamebananaBlurMode === 'all' || (appSettings.gamebananaBlurMode === 'nsfw' && mod.isNsfw), 'can-hover-reveal': appSettings.revealBlurredImagesOnHover }">
              <img v-if="mod.thumbnailUrl" :src="mod.thumbnailUrl" :alt="mod.title" loading="lazy" />
              <span v-else>{{ mod.title.slice(0, 1) }}</span>
              <b v-if="mod.isNsfw">ADULT</b>
            </div>
            <span class="nexus-mod-copy">
              <strong :title="mod.title">{{ mod.title }}</strong>
              <small>{{ mod.author }}</small>
              <em v-if="mod.category">{{ mod.category }}</em>
              <p>{{ mod.summary }}</p>
              <time>{{ t('nexusMods.updated') }} · {{ formatDate(mod.updatedAt) }}</time>
            </span>
          </article>
        </div>
        <div v-else class="nexus-empty">{{ t('nexusMods.empty') }}</div>
        <footer class="nexus-pagination">
          <button type="button" class="nexus-button" :disabled="loadingMods || currentPage <= 1" @click="loadMods(currentPage - 1)">{{ t('nexusMods.previousPage') }}</button>
          <small>{{ t('nexusMods.page', { page: currentPage }) }}</small>
          <button type="button" class="nexus-button" :disabled="loadingMods || !hasMorePages" @click="loadMods(currentPage + 1)">{{ t('nexusMods.nextPage') }}</button>
        </footer>
      </section>

      <aside class="nexus-panel nexus-detail glass-panel">
        <div v-if="loadingDetail" class="nexus-empty">{{ t('nexusMods.loading') }}</div>
        <template v-else-if="detail">
          <div class="nexus-detail-head">
            <div>
              <h2>{{ detail.title }}</h2>
              <button type="button" class="nexus-author" @click="openExternal(`https://www.nexusmods.com/${encodeURIComponent(gameDomain)}/mods/${detail.id}`)">{{ detail.author }}</button>
            </div>
            <span v-if="detail.isNsfw" class="nexus-adult-badge">ADULT</span>
          </div>
          <button v-if="detail.thumbnailUrl" type="button" class="nexus-hero" :class="{ 'is-nsfw-blurred': appSettings.gamebananaBlurMode === 'all' || (appSettings.gamebananaBlurMode === 'nsfw' && detail.isNsfw), 'can-hover-reveal': appSettings.revealBlurredImagesOnHover }" @click="openExternal(detail.thumbnailUrl)">
            <img :src="detail.thumbnailUrl" :alt="detail.title" />
          </button>
          <div class="nexus-stats">
            <span>{{ t('nexusMods.downloads') }}<strong>{{ formatNumber(detail.downloads) }}</strong></span>
            <span>{{ t('nexusMods.endorsements') }}<strong>{{ formatNumber(detail.endorsements) }}</strong></span>
            <span>{{ t('nexusMods.version') }}<strong>{{ detail.version || '—' }}</strong></span>
          </div>
          <p v-if="detail.description" class="nexus-description">{{ detail.description }}</p>
          <section class="nexus-files">
            <h3>{{ t('nexusMods.files') }}</h3>
            <div v-if="detail.files.length" class="nexus-file-list">
              <div v-for="file in detail.files" :key="file.id" class="nexus-file">
                <span>
                  <strong>{{ file.name }}</strong>
                  <small>{{ file.category || (file.isPrimary ? t('nexusMods.primary') : t('nexusMods.optional')) }} · {{ file.version || '—' }} · {{ formatFileSize(file.size) }}</small>
                </span>
                <button
                  type="button"
                  class="nexus-file-action nexus-file-install-action"
                  :class="{ 'is-progress': installingFileId === file.id, 'is-downloaded': installingFileId !== file.id && isFileDownloaded(file) }"
                  :style="installButtonStyle(file)"
                  :disabled="isFileActionDisabled(file)"
                  @click="handleInstallAction(file)"
                ><span>{{ installButtonLabel(file) }}</span></button>
              </div>
            </div>
            <p v-else class="nexus-files-empty">{{ t('nexusMods.empty') }}</p>
          </section>
        </template>
        <div v-else class="nexus-empty">{{ t('nexusMods.selectMod') }}</div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.nexusmods-page { height:100%; min-height:0; box-sizing:border-box; display:flex; flex-direction:column; gap:12px; overflow:hidden; padding:46px 18px 18px; color:rgba(var(--theme-text-primary-rgb),.9); }
.glass-panel { background:linear-gradient(145deg,rgba(var(--theme-surface-tint-rgb),.07),rgba(var(--theme-surface-tint-rgb),.025)),rgba(255,255,255,.035); border:1px solid rgba(var(--theme-surface-tint-rgb),.12); box-shadow:0 14px 36px rgba(0,0,0,.18); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); }
.nexus-controls { display:flex; align-items:end; gap:10px; padding:10px 12px; border-radius:12px; }.nexus-title-block { display:grid; flex:0 0 auto; min-width:112px; gap:2px; }.nexus-title-block strong { color:rgba(var(--theme-text-primary-rgb),.94); font-size:16px; }.nexus-title-block span { color:rgba(var(--theme-text-secondary-rgb),.6); font-size:10px; }
.nexus-field { display:grid; min-width:90px; gap:4px; }.nexus-field>span { color:rgba(var(--theme-text-secondary-rgb),.64); font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }.nexus-domain-field { width:155px; }.nexus-key-field { flex:1 1 230px; min-width:180px; }.nexus-feed-field { width:112px; }.nexus-adult-field { min-width:188px; }
.nexus-hide-field { min-width:92px; }.nexus-hide-field>div { display:flex; align-items:center; gap:7px; min-height:30px; padding:0 8px; border:1px solid rgba(255,255,255,.13); border-radius:7px; background:rgba(255,255,255,.055); box-sizing:border-box; }.nexus-hide-field>div>span { color:rgba(var(--theme-text-primary-rgb),.82); font-size:11px; font-weight:600; letter-spacing:0; text-transform:none; white-space:nowrap; }
.nexus-field input,.nexus-field select,.nexus-filter input { width:100%; min-height:30px; box-sizing:border-box; padding:0 9px; border:1px solid rgba(var(--theme-surface-tint-rgb),.14); border-radius:7px; outline:none; background:rgba(var(--theme-surface-tint-rgb),.055); color:rgba(var(--theme-text-primary-rgb),.92); font:inherit; font-size:12px; }.nexus-field input:focus,.nexus-field select:focus,.nexus-filter input:focus { border-color:rgba(var(--theme-surface-tint-rgb),.62); box-shadow:0 0 0 2px rgba(var(--theme-surface-tint-rgb),.11); }
.nexus-adult-mode { display:flex; min-height:30px; overflow:hidden; border-radius:7px; }.nexus-adult-mode :deep(.el-radio-button) { flex:1 1 0; min-width:0; }.nexus-adult-mode :deep(.el-radio-button__inner) { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:100%; min-height:30px; padding:0 10px; border-color:rgba(255,255,255,.13); background:rgba(255,255,255,.055); color:rgba(var(--theme-text-primary-rgb),.86); font:inherit; font-size:12px; line-height:1; box-shadow:none; transition:background .16s ease,border-color .16s ease,color .16s ease; }.nexus-adult-mode :deep(.el-radio-button:first-child .el-radio-button__inner) { border-radius:7px 0 0 7px; }.nexus-adult-mode :deep(.el-radio-button:last-child .el-radio-button__inner) { border-radius:0 7px 7px 0; }.nexus-adult-mode :deep(.el-radio-button__inner:hover) { background:rgba(var(--theme-surface-tint-rgb),.16); border-color:rgba(var(--theme-surface-tint-rgb),.38); }.nexus-adult-mode :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) { background:rgba(var(--theme-surface-tint-rgb),.2); border-color:rgba(var(--theme-surface-tint-rgb),.42); color:rgba(var(--theme-text-primary-rgb),.98); box-shadow:-1px 0 0 0 rgba(var(--theme-surface-tint-rgb),.42); }
.nexus-adult-mode :deep(.el-radio-button.is-disabled .el-radio-button__inner) { opacity:.35; background:rgba(255,255,255,.025); color:rgba(var(--theme-text-secondary-rgb),.45); cursor:not-allowed; }
.nexus-button { display:inline-flex; align-items:center; justify-content:center; height:30px; min-height:30px; padding:0 11px; border:1px solid rgba(255,255,255,.13); border-radius:7px; background:rgba(255,255,255,.055); color:rgba(var(--theme-text-primary-rgb),.86); font:inherit; font-size:12px; cursor:pointer; transition:background .16s ease,border-color .16s ease,transform .16s ease; }.nexus-button:hover:not(:disabled) { background:rgba(var(--theme-surface-tint-rgb),.16); border-color:rgba(var(--theme-surface-tint-rgb),.38); transform:translateY(-1px); }.nexus-button--primary { background:rgba(var(--theme-surface-tint-rgb),.2); border-color:rgba(var(--theme-surface-tint-rgb),.42); }.nexus-button:disabled { opacity:.45; cursor:default; }
.nexus-error { margin:-3px 2px 0; color:#ffabab; font-size:12px; }.nexus-layout { flex:1; min-height:0; display:grid; grid-template-columns:minmax(340px,1.16fr) minmax(320px,.94fr); gap:12px; overflow:hidden; }.nexus-panel { min-width:0; min-height:0; border-radius:12px; overflow:hidden; }.nexus-results,.nexus-detail { display:flex; flex-direction:column; }.nexus-panel-title { display:flex; align-items:center; justify-content:space-between; gap:10px; flex:0 0 auto; padding:12px 13px 9px; border-bottom:1px solid rgba(255,255,255,.07); color:rgba(var(--theme-text-primary-rgb),.88); font-size:13px; font-weight:700; }.nexus-panel-title small { color:rgba(var(--theme-text-secondary-rgb),.58); font-size:11px; font-weight:500; }
.nexus-filter { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:8px; flex:0 0 auto; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,.06); }.nexus-filter>span { color:rgba(var(--theme-text-secondary-rgb),.62); font-size:10px; font-weight:700; text-transform:uppercase; }.nexus-mod-list { flex:1; overflow:auto; padding:7px; scrollbar-color:rgba(255,255,255,.2) transparent; }
.nexus-pagination { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex:0 0 auto; padding:8px 10px; border-top:1px solid rgba(255,255,255,.07); }.nexus-pagination small { min-width:58px; color:rgba(var(--theme-text-secondary-rgb),.62); font-size:11px; text-align:center; }.nexus-pagination .nexus-button { min-width:62px; }
.nexus-mod-card { display:grid; grid-template-columns:112px minmax(0,1fr); width:100%; gap:10px; padding:8px; border:1px solid transparent; border-radius:9px; background:transparent; color:inherit; text-align:left; cursor:pointer; }.nexus-mod-card+.nexus-mod-card { margin-top:3px; }.nexus-mod-card:hover { background:rgba(255,255,255,.055); }.nexus-mod-card.active { background:rgba(var(--theme-surface-tint-rgb),.12); border-color:rgba(var(--theme-surface-tint-rgb),.32); }.nexus-mod-card:focus-visible { outline:2px solid rgba(var(--theme-surface-tint-rgb),.7); outline-offset:2px; }
.nexus-mod-thumb,.nexus-hero { position:relative; overflow:hidden; border-radius:6px; background:rgba(0,0,0,.22); display:grid; place-items:center; color:rgba(var(--theme-surface-tint-rgb),.7); }.nexus-mod-thumb { aspect-ratio:16/9; font-size:24px; font-weight:800; }.nexus-mod-thumb img,.nexus-hero img { width:100%; height:100%; object-fit:cover; }.nexus-mod-thumb b,.nexus-adult-badge { padding:2px 5px; border-radius:4px; background:rgba(138,27,58,.84); color:#fff; font-size:9px; font-weight:800; letter-spacing:.06em; }.nexus-mod-thumb b { position:absolute; top:5px; right:5px; }.nexus-mod-thumb.is-nsfw-blurred img,.nexus-hero.is-nsfw-blurred img { filter:blur(18px) saturate(.75); transform:scale(1.16); }.nexus-mod-thumb.is-nsfw-blurred::after,.nexus-hero.is-nsfw-blurred::after { content:'ADULT'; position:absolute; inset:0; display:grid; place-items:center; background:rgba(8,9,14,.26); color:rgba(255,255,255,.9); font-size:10px; font-weight:800; letter-spacing:.14em; text-shadow:0 1px 6px rgba(0,0,0,.9); }.nexus-mod-thumb.is-nsfw-blurred:hover img,.nexus-hero.is-nsfw-blurred:hover img { filter:none; transform:scale(1.04); }.nexus-mod-thumb.is-nsfw-blurred:hover::after,.nexus-hero.is-nsfw-blurred:hover::after { opacity:0; }
.nexus-mod-copy { min-width:0; display:grid; align-content:start; gap:2px; }.nexus-mod-copy strong { overflow:hidden; color:rgba(var(--theme-text-primary-rgb),.9); font-size:13px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }.nexus-mod-copy small,.nexus-mod-copy time { color:rgba(var(--theme-text-secondary-rgb),.62); font-size:10px; }.nexus-mod-copy em { overflow:hidden; color:rgba(var(--theme-surface-tint-rgb),.76); font-size:10px; font-style:normal; text-overflow:ellipsis; white-space:nowrap; }.nexus-mod-copy p { display:-webkit-box; margin:3px 0 0; overflow:hidden; color:rgba(var(--theme-text-secondary-rgb),.65); font-size:11px; line-height:1.35; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.nexus-detail { overflow:auto; padding:14px; gap:13px; scrollbar-color:rgba(255,255,255,.2) transparent; }.nexus-detail-head { display:flex; align-items:start; justify-content:space-between; gap:10px; }.nexus-detail h2 { margin:0; color:rgba(var(--theme-text-primary-rgb),.94); font-size:17px; line-height:1.25; }.nexus-author { margin-top:4px; padding:0; border:0; background:transparent; color:rgba(var(--theme-surface-tint-rgb),.9); font:inherit; font-size:12px; cursor:pointer; }.nexus-hero { width:100%; aspect-ratio:16/9; padding:0; border:1px solid rgba(255,255,255,.08); cursor:zoom-in; }.nexus-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }.nexus-stats span { display:grid; gap:3px; padding:7px; border-radius:6px; background:rgba(255,255,255,.045); color:rgba(var(--theme-text-secondary-rgb),.6); font-size:10px; }.nexus-stats strong { overflow:hidden; color:rgba(var(--theme-text-primary-rgb),.9); font-size:13px; text-overflow:ellipsis; white-space:nowrap; }.nexus-description { margin:0; color:rgba(var(--theme-text-primary-rgb),.74); font-size:12px; line-height:1.56; white-space:pre-wrap; }.nexus-files { display:grid; gap:6px; }.nexus-files h3 { margin:0; color:rgba(var(--theme-text-primary-rgb),.84); font-size:13px; }.nexus-file-list { display:grid; gap:6px; }.nexus-file { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 8px; border:1px solid rgba(255,255,255,.08); border-radius:6px; background:rgba(255,255,255,.035); }.nexus-file>span { display:grid; min-width:0; gap:2px; }.nexus-file strong { overflow:hidden; color:rgba(var(--theme-text-primary-rgb),.82); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }.nexus-file small,.nexus-files-empty { color:rgba(var(--theme-text-secondary-rgb),.56); font-size:10px; }.nexus-files-empty { margin:0; }
.nexus-file-action { min-height:24px; padding:0 6px; border:1px solid rgba(var(--theme-surface-tint-rgb),.25); border-radius:5px; background:rgba(var(--theme-surface-tint-rgb),.09); color:rgba(var(--theme-surface-tint-rgb),.95); font:inherit; font-size:10px; cursor:pointer; }.nexus-file-action:disabled { opacity:.72; cursor:default; }.nexus-file-install-action { position:relative; isolation:isolate; min-width:100px; overflow:hidden; }.nexus-file-install-action::before,.nexus-file-install-action::after { position:absolute; inset:0 auto 0 0; width:0; content:''; opacity:0; transition:width .16s linear; }.nexus-file-install-action::before { z-index:0; background:rgba(var(--theme-surface-tint-rgb),.045); }.nexus-file-install-action::after { z-index:1; background:rgba(var(--theme-surface-tint-rgb),.09); }.nexus-file-install-action.is-progress { background:rgba(var(--theme-surface-tint-rgb),.009); }.nexus-file-install-action.is-progress::before { width:var(--nexus-download-progress); opacity:1; }.nexus-file-install-action.is-progress::after { width:var(--nexus-install-progress); opacity:1; }.nexus-file-install-action.is-downloaded { border-color:rgba(255,255,255,.16); background:rgba(255,255,255,.09); color:rgba(var(--theme-text-secondary-rgb),.68); }.nexus-file-install-action>span { position:relative; z-index:2; }
.nexus-empty { display:grid; flex:1; place-items:center; padding:24px; color:rgba(var(--theme-text-secondary-rgb),.58); font-size:12px; text-align:center; }
@media (max-width:1060px) { .nexus-controls { flex-wrap:wrap; }.nexus-key-field { flex:1 1 280px; }.nexus-layout { grid-template-columns:minmax(300px,1fr) minmax(300px,1fr); } }
@media (max-width:720px) { .nexusmods-page { padding:42px 10px 10px; }.nexus-title-block { width:100%; }.nexus-layout { display:flex; flex-direction:column; overflow:auto; }.nexus-results { min-height:430px; }.nexus-detail { min-height:430px; }.nexus-key-field,.nexus-domain-field,.nexus-feed-field { flex:1 1 42%; width:auto; }.nexus-adult-field { flex:1 1 100%; } }
.nexus-mod-thumb img,.nexus-hero img { transition: filter .22s ease, transform .22s ease; }
.nexus-mod-thumb.is-nsfw-blurred:not(.can-hover-reveal):hover img,.nexus-hero.is-nsfw-blurred:not(.can-hover-reveal):hover img { filter:blur(18px) saturate(.75); transform:scale(1.16); }
.nexus-mod-thumb.is-nsfw-blurred:not(.can-hover-reveal):hover::after,.nexus-hero.is-nsfw-blurred:not(.can-hover-reveal):hover::after { opacity:1; }
.nexus-mod-thumb.is-nsfw-blurred::after,.nexus-hero.is-nsfw-blurred::after { transition:opacity .22s ease; }
.nexus-mod-thumb.is-nsfw-blurred::after,.nexus-hero.is-nsfw-blurred::after { content:''; }
</style>
