<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { AppStateManager } from '../../store/AppStateManager';
import { ResourceManager } from '../../store/ResourceManager';
import { ModManager } from '../../store/ModManager';

type GbImage = Record<string, unknown>;

interface GbSubmitter {
  _idRow?: number;
  _sName?: string;
  _sProfileUrl?: string;
  _sAvatarUrl?: string;
}

interface GbCategoryRef {
  _idRow?: number;
  _sName?: string;
  _sProfileUrl?: string;
  _sIconUrl?: string;
}

interface GbRecord {
  _idRow: number;
  _sName?: string;
  _sDescription?: string;
  _sProfileUrl?: string;
  _tsDateUpdated?: number;
  _tsDateModified?: number;
  _bIsNsfw?: boolean;
  _bHasContentRatings?: boolean;
  _aSubmitter?: GbSubmitter;
  _aPreviewMedia?: { _aImages?: GbImage[] };
  _aCategory?: GbCategoryRef;
  _aRootCategory?: GbCategoryRef;
  _aSubCategory?: GbCategoryRef;
}

interface GbIndexPayload {
  _aMetadata?: { _nRecordCount?: number; _bIsComplete?: boolean };
  _aRecords?: GbRecord[];
}

interface GbCategory {
  _idRow: number;
  _sName?: string;
  _sUrl?: string;
  _sIconUrl?: string;
  _nItemCount?: number;
  _nCategoryCount?: number;
}

interface GbCategoryNode extends GbCategory {
  children: GbCategoryNode[];
  childrenLoaded: boolean;
  hasChildren: boolean | undefined;
  loadingChildren: boolean;
}

interface GbCategoryRow {
  node: GbCategoryNode;
  depth: number;
}

interface GbFile {
  _idRow?: number;
  _sFile?: string;
  _nFilesize?: number;
  _tsDateAdded?: number;
  _sDownloadUrl?: string;
}

interface GbPostRecord {
  _idRow: number;
  _sText?: string;
  _tsDateAdded?: number;
  _tsDateModified?: number;
  _nReplyCount?: number;
  _nStampScore?: number;
  _aPoster?: GbSubmitter;
}

interface GbPostPayload {
  _aMetadata?: { _nRecordCount?: number; _bIsComplete?: boolean };
  _aRecords?: GbPostRecord[];
}

interface GbComment {
  id: number;
  author: string;
  authorId: number | null;
  authorUrl: string;
  avatarUrl: string;
  postedAt: number;
  updatedAt: number;
  replyCount: number;
  score: number;
  bodyHtml: string;
  depth: number;
  loadingReplies?: boolean;
  repliesLoaded?: boolean;
}

interface GbProfile extends GbRecord {
  _sText?: string;
  _tsDateAdded?: number;
  _nDownloadCount?: number;
  _nViewCount?: number;
  _nLikeCount?: number;
  _aContentRatings?: Record<string, string>;
  _aArchivedFiles?: GbFile[];
  _aFiles?: GbFile[];
}

interface GbModCard {
  id: number;
  title: string;
  author: string;
  authorId: number | null;
  authorUrl: string;
  profileUrl: string;
  thumbnailUrl: string;
  description: string;
  updatedAt: number;
  categoryId: number | null;
  categoryName: string;
  categoryTrail: GbCategoryNode[];
  isNsfw: boolean;
}

interface GbModDetail extends GbModCard {
  descriptionHtml: string;
  createdAt: number;
  downloads: number;
  views: number;
  likes: number;
  screenshots: string[];
  contentRatings: string[];
  files: GbFile[];
}

interface TranslationModelOption {
  value: string;
  label: string;
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

const { t } = useI18n();
const appSettings = AppStateManager.appSettings;
const router = useRouter();

const GAMEBANANA_ID_BY_PRESET: Record<string, number> = {
  GIMI: 8552,
  WWMI: 20357,
  SRMI: 18366,
  ZZMI: 19567,
  HIMI: 10349,
};
const DEFAULT_GAMEBANANA_ID = GAMEBANANA_ID_BY_PRESET.GIMI;
const API_BASE = 'https://gamebanana.com/apiv11';
const PAGE_SIZE_OPTIONS = [12, 24, 36, 48];
const GAMEBANANA_ICON_CACHE_FOLDER = 'gamebanana-category-icons';

const gameId = ref(DEFAULT_GAMEBANANA_ID);
const gameTargetLabel = ref('');
const searchQuery = ref('');
const pageSize = ref(24);
const currentPage = ref(1);
const hasMore = ref(false);
const totalRecords = ref(0);
const categoryTree = ref<GbCategoryNode[]>([]);
const expandedCategoryIds = ref(new Set<number>());
const selectedCategoryId = ref<number | null>(null);
const mods = ref<GbModCard[]>([]);
const selectedModId = ref<number | null>(null);
const detail = ref<GbModDetail | null>(null);
const comments = ref<GbComment[]>([]);
const commentsPage = ref(0);
const commentsHasMore = ref(false);
const loadingCategories = ref(false);
const loadingMods = ref(false);
const loadingDetail = ref(false);
const loadingComments = ref(false);
const loadingMoreComments = ref(false);
const installingFileId = ref<number | null>(null);
const installGroup = ref('');
const installStatus = ref('');
const installPhase = ref<'idle' | 'downloading' | 'installing'>('idle');
const downloadProgress = ref(0);
const installProgress = ref(0);
const downloadedFileIds = ref(new Set<number>());
const showTranslationSettings = ref(false);
const translationStatus = ref('');
const loadingTranslationModels = ref(false);
const translationModelsStatus = ref('');
const translationModelOptions = ref<TranslationModelOption[]>([]);
const errorMessage = ref('');

let modsRequestId = 0;
let detailRequestId = 0;
let commentsRequestId = 0;
let categoriesRequestId = 0;
let downloadedStateRequestId = 0;
let hoveredTranslateElement: HTMLElement | null = null;
let hoveredTranslateText = '';
let activeGamebananaInstall: { gameName: string; modName: string } | null = null;
let unlistenDownloadProgress: UnlistenFn | null = null;
let unlistenInstallProgress: UnlistenFn | null = null;
const translationNodes = new Set<HTMLElement>();
const translationBlocksByAnchor = new Map<HTMLElement, HTMLElement>();
const translationAnchorsByBlock = new Map<HTMLElement, HTMLElement>();
const translationCache = new Map<string, string>();
const translationRequestCount = ref(0);

const allCategories = computed(() => {
  const flattened: GbCategoryNode[] = [];
  const visit = (nodes: GbCategoryNode[]) => {
    for (const node of nodes) {
      flattened.push(node);
      visit(node.children);
    }
  };
  visit(categoryTree.value);
  return flattened;
});
const categoryRows = computed<GbCategoryRow[]>(() => {
  const rows: GbCategoryRow[] = [];
  const visit = (nodes: GbCategoryNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (expandedCategoryIds.value.has(node._idRow)) visit(node.children, depth + 1);
    }
  };
  visit(categoryTree.value, 0);
  return rows;
});
const selectedCategoryName = computed(() =>
  selectedCategoryId.value === null
    ? t('gameBanana.allCategories')
    : allCategories.value.find((item) => item._idRow === selectedCategoryId.value)?._sName || t('gameBanana.allCategories'),
);

const visibleMods = computed(() => appSettings.gamebananaNsfwMode === 'hide'
  ? mods.value.filter((item) => !item.isNsfw)
  : mods.value);
const visibleCountText = computed(() => `${visibleMods.value.length}${appSettings.gamebananaNsfwMode === 'hide' && mods.value.length !== visibleMods.value.length ? ` / ${mods.value.length}` : ''}`);
const currentGameName = computed(() => appSettings.CurrentGameName?.trim() || '');
const gameUrl = computed(() => `https://gamebanana.com/games/${gameId.value}`);
const isInstalling = computed(() => installingFileId.value !== null);

const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const asNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

const toPlainText = (value: unknown): string => {
  const html = asString(value);
  if (!html) return '';
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const isSafeHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const sanitizeRichText = (value: unknown): string => {
  const source = asString(value);
  if (!source || typeof DOMParser === 'undefined') return '';

  const allowedTags = new Set([
    'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SMALL', 'CODE', 'PRE', 'BLOCKQUOTE',
    'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'A', 'SPAN', 'IMG',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
  ]);
  const document = new DOMParser().parseFromString(`<article>${source}</article>`, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return '';

  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const attributes = Array.from(element.attributes);
    for (const attribute of attributes) element.removeAttribute(attribute.name);

    if (element instanceof HTMLAnchorElement) {
      const href = asString(attributes.find((attribute) => attribute.name.toLowerCase() === 'href')?.value);
      if (isSafeHttpUrl(href)) {
        element.href = href;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      continue;
    }

    if (element instanceof HTMLImageElement) {
      const src = asString(attributes.find((attribute) => attribute.name.toLowerCase() === 'src')?.value);
      const alt = asString(attributes.find((attribute) => attribute.name.toLowerCase() === 'alt')?.value);
      if (!isSafeHttpUrl(src)) {
        element.remove();
      } else {
        element.src = src;
        element.alt = alt;
        element.loading = 'lazy';
      }
    }
  }

  return root.innerHTML.trim();
};

const sanitizeTranslatedRichText = (value: string): string => sanitizeRichText(
  value
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, ''),
);

const restoreGamebananaScreenshotVariant = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '';

  // GameBanana's _sUrl530/_sUrl220 fields commonly point to files named
  // "530-90_original-file.jpg".  Those are thumbnail variants, whereas the
  // matching original lives at the same path without the numeric prefix.
  // Keep the old manager's two-part numeric guard so ordinary file names are
  // never altered accidentally.
  const restorePath = (path: string) => path.replace(
    /(^|\/)(?:\d+(?:-\d+)+)_([^/]+)$/,
    '$1$2',
  );
  try {
    const parsed = new URL(normalized);
    parsed.pathname = restorePath(parsed.pathname);
    return parsed.toString();
  } catch {
    return restorePath(normalized);
  }
};

const imageUrl = (image: GbImage, preferLarge = false): string => {
  const preferredUrlKeys = preferLarge
    ? ['_sUrl', '_sUrl800', '_sUrl530', '_sUrl220', '_sUrl100']
    : ['_sUrl530', '_sUrl220', '_sUrl100', '_sUrl'];
  for (const key of preferredUrlKeys) {
    const direct = asString(image[key]);
    if (direct) return preferLarge ? restoreGamebananaScreenshotVariant(direct) : direct;
  }

  const preferredFileKeys = preferLarge
    ? ['_sFile', '_sFile800', '_sFile530', '_sFile220', '_sFile100']
    : ['_sFile530', '_sFile220', '_sFile100', '_sFile'];
  const baseUrl = asString(image._sBaseUrl) || 'https://images.gamebanana.com/img/ss/mods';
  for (const key of preferredFileKeys) {
    const file = asString(image[key]);
    if (file) {
      const url = `${baseUrl.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
      return preferLarge ? restoreGamebananaScreenshotVariant(url) : url;
    }
  }
  return '';
};

const mediaUrls = (record: GbRecord, preferLarge = false): string[] => {
  const seen = new Set<string>();
  return (record._aPreviewMedia?._aImages || [])
    .map((item) => imageUrl(item, preferLarge))
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
};

const categoryNodeFromReference = (reference: GbCategoryRef | undefined): GbCategoryNode | null => {
  if (!reference) return null;
  const id = asNumber(reference._idRow) || categoryIdFromUrl(asString(reference._sProfileUrl)) || 0;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    _idRow: id,
    _sName: asString(reference._sName),
    _sUrl: asString(reference._sProfileUrl),
    _sIconUrl: asString(reference._sIconUrl),
    children: [],
    childrenLoaded: true,
    hasChildren: false,
    loadingChildren: false,
  };
};

const categoryTrailFromRecord = (record: GbRecord): GbCategoryNode[] => {
  const seen = new Set<number>();
  return [record._aRootCategory, record._aCategory, record._aSubCategory]
    .map(categoryNodeFromReference)
    .filter((item): item is GbCategoryNode => item !== null && !seen.has(item._idRow) && Boolean(seen.add(item._idRow)));
};

const recordToCard = (record: GbRecord): GbModCard => {
  const categoryTrail = categoryTrailFromRecord(record);
  const category = categoryTrail.at(-1);
  const isNsfw = record._bIsNsfw === true || record._bHasContentRatings === true;
  return {
    id: record._idRow,
    title: asString(record._sName) || `Mod #${record._idRow}`,
    author: asString(record._aSubmitter?._sName) || t('gameBanana.unknownAuthor'),
    authorId: record._aSubmitter?._idRow ?? null,
    authorUrl: asString(record._aSubmitter?._sProfileUrl),
    profileUrl: asString(record._sProfileUrl) || `https://gamebanana.com/mods/${record._idRow}`,
    thumbnailUrl: mediaUrls(record)[0] || '',
    description: toPlainText(record._sDescription),
    updatedAt: asNumber(record._tsDateUpdated || record._tsDateModified),
    categoryId: category?._idRow ?? null,
    categoryName: asString(category?._sName),
    categoryTrail,
    isNsfw,
  };
};

const mergedCategoryTrail = (profileTrail: GbCategoryNode[], sourceTrail: GbCategoryNode[]): GbCategoryNode[] => {
  if (!profileTrail.length) return sourceTrail;
  if (!sourceTrail.length) return profileTrail;
  const profileLeaf = profileTrail.at(-1)?._idRow;
  const sourceLeaf = sourceTrail.at(-1)?._idRow;
  return profileLeaf === sourceLeaf && sourceTrail.length > profileTrail.length ? sourceTrail : profileTrail;
};

const profileToDetail = (profile: GbProfile, sourceCard?: GbModCard): GbModDetail => {
  const base = recordToCard(profile);
  const categoryTrail = mergedCategoryTrail(base.categoryTrail, sourceCard?.categoryTrail || []);
  const category = categoryTrail.at(-1);
  const files = profile._aArchivedFiles || profile._aFiles || [];
  return {
    ...base,
    categoryTrail,
    categoryId: category?._idRow ?? base.categoryId,
    categoryName: asString(category?._sName) || base.categoryName,
    description: toPlainText(profile._sText || profile._sDescription),
    descriptionHtml: sanitizeRichText(profile._sText || profile._sDescription),
    createdAt: asNumber(profile._tsDateAdded),
    downloads: asNumber(profile._nDownloadCount),
    views: asNumber(profile._nViewCount),
    likes: asNumber(profile._nLikeCount),
    screenshots: mediaUrls(profile, true),
    contentRatings: Object.values(profile._aContentRatings || {}).map(asString).filter(Boolean),
    files,
  };
};

const postToComment = (post: GbPostRecord, depth = 0): GbComment => ({
  id: post._idRow,
  author: asString(post._aPoster?._sName) || t('gameBanana.unknownAuthor'),
  authorId: post._aPoster?._idRow ?? null,
  authorUrl: asString(post._aPoster?._sProfileUrl),
  avatarUrl: asString(post._aPoster?._sAvatarUrl),
  postedAt: asNumber(post._tsDateAdded),
  updatedAt: asNumber(post._tsDateModified),
  replyCount: asNumber(post._nReplyCount),
  score: asNumber(post._nStampScore),
  bodyHtml: sanitizeRichText(post._sText),
  depth,
});

const formatDate = (timestamp: number): string => {
  if (!timestamp) return '—';
  return new Date(timestamp * 1000).toLocaleDateString();
};

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value || 0);

const formatFileSize = (bytes: number | undefined): string => {
  const size = Number(bytes || 0);
  if (!size) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const apiGet = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
  const search = new URLSearchParams(params);
  const response = await fetch(`${API_BASE}${path}?${search.toString()}`, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`GameBanana HTTP ${response.status}`);
  }
  const data = await response.json() as T & { _sErrorMessage?: string; error?: string };
  const apiError = asString(data._sErrorMessage) || asString(data.error);
  if (apiError) throw new Error(apiError);
  return data;
};

const categoryIdFromUrl = (url: string): number | null => {
  const match = url.match(/\/cats\/(\d+)(?:[/?#]|$)/i);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const categoryNodeFromApi = (record: Record<string, unknown>): GbCategoryNode | null => {
  const id = asNumber(record._idRow) || categoryIdFromUrl(asString(record._sUrl)) || 0;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    _idRow: id,
    _sName: asString(record._sName),
    _sUrl: asString(record._sUrl),
    _sIconUrl: asString(record._sIconUrl),
    _nItemCount: record._nItemCount === undefined ? undefined : asNumber(record._nItemCount),
    _nCategoryCount: record._nCategoryCount === undefined ? undefined : asNumber(record._nCategoryCount),
    children: [],
    childrenLoaded: record._nCategoryCount === 0,
    hasChildren: record._nCategoryCount === undefined ? undefined : asNumber(record._nCategoryCount) > 0,
    loadingChildren: false,
  };
};

const fetchCategoryChildren = async (node: GbCategoryNode): Promise<GbCategoryNode[]> => {
  if (node._nCategoryCount === 0) return [];
  const records = await apiGet<Array<Record<string, unknown>>>(`/ModCategory/${node._idRow}/SubCategories`);
  return (Array.isArray(records) ? records : [])
    .map(categoryNodeFromApi)
    .filter((item): item is GbCategoryNode => item !== null);
};

const loadCategoryChildren = async (node: GbCategoryNode) => {
  if (node.childrenLoaded || node.loadingChildren) return;
  node.loadingChildren = true;
  try {
    const children = await fetchCategoryChildren(node);
    node.children = children.filter((child) => child._idRow !== node._idRow);
    node.childrenLoaded = true;
    node.hasChildren = node.children.length > 0;
  } catch (error) {
    errorMessage.value = t('gameBanana.errors.loadCategories', { error: String(error) });
  } finally {
    node.loadingChildren = false;
  }
};

const loadCategories = async () => {
  const requestId = ++categoriesRequestId;
  loadingCategories.value = true;
  try {
    const items = await apiGet<Array<Record<string, unknown>>>('/Mod/Categories', {
      _idGameRow: String(gameId.value),
      _sSort: 'a_to_z',
      _bShowEmpty: 'true',
    });
    if (requestId !== categoriesRequestId) return;
    const roots = (Array.isArray(items) ? items : [])
      .map(categoryNodeFromApi)
      .filter((item): item is GbCategoryNode => item !== null);
    if (requestId !== categoriesRequestId) return;
    categoryTree.value = roots;
    expandedCategoryIds.value = new Set();
    if (selectedCategoryId.value !== null && !allCategories.value.some((item) => item._idRow === selectedCategoryId.value)) {
      selectedCategoryId.value = null;
    }
  } catch (error) {
    if (requestId === categoriesRequestId) errorMessage.value = t('gameBanana.errors.loadCategories', { error: String(error) });
  } finally {
    if (requestId === categoriesRequestId) loadingCategories.value = false;
  }
};

const loadMods = async (requestedPage = 1) => {
  const requestId = ++modsRequestId;
  loadingMods.value = true;
  errorMessage.value = '';
  currentPage.value = Math.max(1, requestedPage);
  try {
    const params: Record<string, string> = {
      _nPage: String(currentPage.value),
      _nPerpage: String(pageSize.value),
      _sOrderBy: '_tsDateUpdated,DESC',
      '_aFilters[Generic_Game]': String(gameId.value),
    };
    if (selectedCategoryId.value !== null) params['_aFilters[Generic_Category]'] = String(selectedCategoryId.value);
    if (searchQuery.value.trim()) params['_aFilters[Generic_Name]'] = `contains,${searchQuery.value.trim()}`;

    const payload = await apiGet<GbIndexPayload>('/Mod/Index', params);
    if (requestId !== modsRequestId) return;

    mods.value = (payload._aRecords || []).map(recordToCard);
    totalRecords.value = asNumber(payload._aMetadata?._nRecordCount);
    hasMore.value = !payload._aMetadata?._bIsComplete && mods.value.length >= pageSize.value;
    selectedModId.value = null;
    detail.value = null;
    const initialMod = visibleMods.value[0] || mods.value[0];
    if (initialMod) void selectMod(initialMod);
  } catch (error) {
    if (requestId === modsRequestId) {
      mods.value = [];
      detail.value = null;
      errorMessage.value = t('gameBanana.errors.loadMods', { error: String(error) });
    }
  } finally {
    if (requestId === modsRequestId) loadingMods.value = false;
  }
};

const loadComments = async (modId: number, requestedPage = 1, append = false) => {
  const requestId = ++commentsRequestId;
  if (append) loadingMoreComments.value = true;
  else {
    loadingComments.value = true;
    comments.value = [];
    commentsPage.value = 0;
  }

  try {
    const payload = await apiGet<GbPostPayload>(`/Mod/${modId}/Posts`, {
      _nPage: String(requestedPage),
      _nPerpage: '15',
    });
    if (requestId !== commentsRequestId || selectedModId.value !== modId) return;
    const next = (payload._aRecords || []).map((post) => postToComment(post));
    comments.value = append ? [...comments.value, ...next] : next;
    commentsPage.value = requestedPage;
    const total = asNumber(payload._aMetadata?._nRecordCount);
    commentsHasMore.value = total > 0
      ? requestedPage * 15 < total
      : !payload._aMetadata?._bIsComplete;
  } catch (error) {
    if (requestId === commentsRequestId && selectedModId.value === modId) {
      errorMessage.value = t('gameBanana.errors.loadComments', { error: String(error) });
    }
  } finally {
    if (requestId === commentsRequestId) {
      loadingComments.value = false;
      loadingMoreComments.value = false;
    }
  }
};

const loadReplies = async (comment: GbComment) => {
  if (comment.loadingReplies || comment.repliesLoaded || comment.replyCount <= 0) return;
  comment.loadingReplies = true;
  try {
    const payload = await apiGet<GbPostPayload>(`/Post/${comment.id}/Posts`, {
      _nPage: '1',
      _nPerpage: '50',
    });
    if (selectedModId.value === null) return;
    const replies = (payload._aRecords || []).map((post) => postToComment(post, comment.depth + 1));
    const index = comments.value.findIndex((item) => item.id === comment.id);
    if (index >= 0) comments.value.splice(index + 1, 0, ...replies);
    comment.repliesLoaded = true;
  } catch (error) {
    errorMessage.value = t('gameBanana.errors.loadReplies', { error: String(error) });
  } finally {
    comment.loadingReplies = false;
  }
};

const selectMod = async (mod: GbModCard) => {
  clearTranslations();
  clearHoveredText();
  downloadedFileIds.value = new Set();
  selectedModId.value = mod.id;
  detail.value = null;
  comments.value = [];
  commentsPage.value = 0;
  commentsHasMore.value = false;
  const requestId = ++detailRequestId;
  loadingDetail.value = true;
  try {
    const profile = await apiGet<GbProfile>(`/Mod/${mod.id}/ProfilePage`);
    if (requestId !== detailRequestId) return;
    detail.value = profileToDetail(profile, mod);
    void loadComments(mod.id);
    void refreshDownloadedFileState(detail.value);
  } catch (error) {
    if (requestId === detailRequestId) {
      detail.value = { ...mod, descriptionHtml: '', createdAt: 0, downloads: 0, views: 0, likes: 0, screenshots: [], contentRatings: [], files: [] };
      errorMessage.value = t('gameBanana.errors.loadDetail', { error: String(error) });
      void refreshDownloadedFileState(detail.value);
    }
  } finally {
    if (requestId === detailRequestId) loadingDetail.value = false;
  }
};

const applyTarget = async () => {
  currentPage.value = 1;
  selectedCategoryId.value = null;
  await Promise.all([loadCategories(), loadMods(1)]);
};

const selectCategory = (categoryId: number | null) => {
  if (selectedCategoryId.value === categoryId) return;
  selectedCategoryId.value = categoryId;
  void loadMods(1);
};

const categoryCanExpand = (node: GbCategoryNode): boolean => node.hasChildren !== false;

const toggleCategory = async (node: GbCategoryNode) => {
  const categoryId = node._idRow;
  const next = new Set(expandedCategoryIds.value);
  if (next.has(categoryId)) {
    next.delete(categoryId);
    expandedCategoryIds.value = next;
    return;
  }
  await loadCategoryChildren(node);
  if (node.hasChildren === false) return;
  next.add(categoryId);
  expandedCategoryIds.value = next;
};

const openExternal = async (url: string) => {
  if (!url) return;
  try {
    await openUrl(url);
  } catch (error) {
    ElMessage.error(t('gameBanana.errors.openExternal', { error: String(error) }));
  }
};

const memberIdFromProfileUrl = (profileUrl: string): number | null => {
  const match = profileUrl.match(/\/members\/(\d+)(?:\/|$)/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

const openAuthorPage = (authorId: number | null, authorUrl: string) => {
  const memberId = authorId || memberIdFromProfileUrl(authorUrl);
  if (!memberId) {
    void openExternal(authorUrl);
    return;
  }
  void router.push({ name: 'GameBananaAuthor', params: { authorId: String(memberId) } });
};

const richTextClick = (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
  if (!anchor?.href) return;
  event.preventDefault();
  void openExternal(anchor.href);
};

const sanitizeInstallName = (value: string): string => {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  return safe || 'GameBanana Mod';
};

const sanitizeCategoryPathSegment = (value: string): string => {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim();
  return safe || 'Uncategorized';
};

const categoryTrailFromTree = (categoryId: number | null): GbCategoryNode[] => {
  if (!categoryId) return [];
  const visit = (nodes: GbCategoryNode[], ancestors: GbCategoryNode[]): GbCategoryNode[] => {
    for (const node of nodes) {
      const path = [...ancestors, node];
      if (node._idRow === categoryId) return path;
      const nested = visit(node.children, path);
      if (nested.length) return nested;
    }
    return [];
  };
  return visit(categoryTree.value, []);
};

const gamebananaCategoryTrail = (mod: GbModCard): GbCategoryNode[] => {
  const treeTrail = categoryTrailFromTree(mod.categoryId);
  return treeTrail.length ? treeTrail : mod.categoryTrail;
};

const resolveGamebananaCategoryTrail = async (mod: GbModCard): Promise<GbCategoryNode[]> => {
  const existingTrail = categoryTrailFromTree(mod.categoryId);
  if (existingTrail.length || !mod.categoryId) return existingTrail.length ? existingTrail : mod.categoryTrail;

  const rootId = mod.categoryTrail[0]?._idRow;
  const roots = rootId
    ? categoryTree.value.filter((node) => node._idRow === rootId)
    : categoryTree.value;
  const visit = async (nodes: GbCategoryNode[], ancestors: GbCategoryNode[]): Promise<GbCategoryNode[]> => {
    for (const node of nodes) {
      const path = [...ancestors, node];
      if (node._idRow === mod.categoryId) return path;
      if (!node.childrenLoaded) await loadCategoryChildren(node);
      const nested = await visit(node.children, path);
      if (nested.length) return nested;
    }
    return [];
  };
  const loadedTrail = await visit(roots, []);
  return loadedTrail.length ? loadedTrail : mod.categoryTrail;
};

const gamebananaInstallGroupFromTrail = (trail: GbCategoryNode[]): string => {
  return ['GameBanana', ...trail.map((category) => sanitizeCategoryPathSegment(category._sName || `Category ${category._idRow}`))].join('/');
};

const gamebananaInstallGroup = (mod: GbModCard): string => gamebananaInstallGroupFromTrail(gamebananaCategoryTrail(mod));

const resolveGamebananaInstallTarget = async (mod: GbModCard) => {
  const categoryTrail = await resolveGamebananaCategoryTrail(mod);
  const automaticGroup = gamebananaInstallGroupFromTrail(categoryTrail);
  return {
    categoryTrail,
    automaticGroup,
    targetGroup: installGroup.value.trim() || automaticGroup,
    targetName: sanitizeInstallName(mod.title),
  };
};

const isFileDownloaded = (file: GbFile): boolean => downloadedFileIds.value.has(file._idRow ?? -1);

const refreshDownloadedFileState = async (mod: GbModDetail | null = detail.value) => {
  const requestId = ++downloadedStateRequestId;
  if (!mod?.files.length || !currentGameName.value || currentGameName.value === 'Default') {
    downloadedFileIds.value = new Set();
    return;
  }

  try {
    const [installDir, target] = await Promise.all([
      ModManager.getInstallDir(currentGameName.value),
      resolveGamebananaInstallTarget(mod),
    ]);
    const installed = await invoke<boolean>('mod_install_target_exists', {
      installDir,
      targetName: target.targetName,
      targetGroup: target.targetGroup,
    });
    if (requestId !== downloadedStateRequestId || detail.value?.id !== mod.id) return;
    downloadedFileIds.value = installed
      ? new Set(mod.files.map((file) => file._idRow ?? -1))
      : new Set();
  } catch (error) {
    if (requestId === downloadedStateRequestId) {
      console.warn('Unable to check the GameBanana install target:', error);
      downloadedFileIds.value = new Set();
    }
  }
};

const cacheGamebananaCategoryIcon = async (category: GbCategoryNode): Promise<string> => {
  const iconUrl = asString(category._sIconUrl);
  if (!isSafeHttpUrl(iconUrl)) return '';
  const cacheDir = await join(await appDataDir(), GAMEBANANA_ICON_CACHE_FOLDER);
  const cachedIcon = await join(cacheDir, `category-${category._idRow}.png`);
  if (await exists(cachedIcon)) return cachedIcon;

  const response = await fetch(iconUrl, { method: 'GET' });
  if (!response.ok) throw new Error(`GameBanana HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachedIcon, data);
  return cachedIcon;
};

const applyGamebananaCategoryIcons = async (gameName: string, trail: GbCategoryNode[]) => {
  for (let index = 0; index < trail.length; index += 1) {
    const category = trail[index];
    try {
      const cachedIcon = await cacheGamebananaCategoryIcon(category);
      if (!cachedIcon) continue;
      const categoryGroupPath = ['GameBanana', ...trail.slice(0, index + 1).map((node) => sanitizeCategoryPathSegment(node._sName || `Category ${node._idRow}`))].join('/');
      await ModManager.setModGroupIcon(gameName, categoryGroupPath, cachedIcon);
    } catch (error) {
      console.warn(`Unable to assign GameBanana category icon for ${category._idRow}:`, error);
    }
  }
};

const progressRatio = (current: number | undefined, total: number | undefined, unknownTotalBytes = 220 * 1024 * 1024): number => {
  const normalizedCurrent = Math.max(0, Number(current) || 0);
  const normalizedTotal = Math.max(0, Number(total) || 0);
  if (normalizedTotal > 0) return Math.min(100, (normalizedCurrent / normalizedTotal) * 100);
  return Math.min(95, (normalizedCurrent / unknownTotalBytes) * 100);
};

const isActiveInstallEvent = (payload: InstallProgressEvent) => {
  if (!activeGamebananaInstall) return false;
  const eventGame = payload.gameName || payload.game_name || '';
  const eventMod = payload.modName || payload.mod_name || '';
  return eventGame === activeGamebananaInstall.gameName && eventMod === activeGamebananaInstall.modName;
};

const updateDownloadProgress = (payload: InstallProgressEvent) => {
  if (!isActiveInstallEvent(payload)) return;
  installPhase.value = 'downloading';
  installStatus.value = t('gameBanana.installDownloading');
  downloadProgress.value = progressRatio(payload.current, payload.total);
};

const updateInstallProgress = (payload: InstallProgressEvent) => {
  if (!isActiveInstallEvent(payload)) return;
  const stage = String(payload.stage || '').toLowerCase();
  if (stage === 'done') {
    installPhase.value = 'installing';
    installProgress.value = 100;
    return;
  }
  installPhase.value = 'installing';
  installStatus.value = t('gameBanana.installInstalling');
  const stageBase = stage === 'analyzing' ? 2 : 6;
  installProgress.value = stage === 'analyzing'
    ? stageBase
    : Math.min(98, stageBase + progressRatio(payload.current, payload.total) * (100 - stageBase) / 100);
};

const installButtonStyle = (file: GbFile) => {
  const active = installingFileId.value === (file._idRow ?? -1);
  return {
    '--gb-download-progress': `${active ? downloadProgress.value : 0}%`,
    '--gb-install-progress': `${active ? Math.min(downloadProgress.value, installProgress.value) : 0}%`,
  };
};

const installButtonClass = (file: GbFile) => ({
  'is-progress': installingFileId.value === (file._idRow ?? -1),
  'is-downloaded': installingFileId.value !== (file._idRow ?? -1) && isFileDownloaded(file),
});

const isCancellableDownload = (file: GbFile) => installingFileId.value === (file._idRow ?? -1)
  && installPhase.value === 'downloading';

const isFileActionDisabled = (file: GbFile) => isInstalling.value && !isCancellableDownload(file);

const installButtonLabel = (file: GbFile) => isCancellableDownload(file)
  ? installStatus.value === t('gameBanana.cancellingDownload')
    ? installStatus.value
    : t('gameBanana.cancelDownload')
  : installingFileId.value === (file._idRow ?? -1)
    ? installStatus.value || t('gameBanana.installing')
  : isFileDownloaded(file) ? t('gameBanana.downloaded') : t('gameBanana.install');

const listenForInstallProgress = async () => {
  const [downloadUnlisten, installUnlisten] = await Promise.all([
    listen<InstallProgressEvent>('gamebanana-install-progress', (event) => updateDownloadProgress(event.payload)),
    listen<InstallProgressEvent>('mod-install-progress', (event) => updateInstallProgress(event.payload)),
  ]);
  unlistenDownloadProgress = downloadUnlisten;
  unlistenInstallProgress = installUnlisten;
};

const cancelDownloadAndInstall = async (file: GbFile) => {
  if (!isCancellableDownload(file) || !activeGamebananaInstall) return;
  installStatus.value = t('gameBanana.cancellingDownload');
  try {
    await invoke('cancel_gamebanana_download_and_install_mod', {
      gameName: activeGamebananaInstall.gameName,
      targetName: activeGamebananaInstall.modName,
    });
  } catch (error) {
    // The transfer itself remains active if the cancellation signal could not
    // reach the backend, so leave the same button available for another try.
    installStatus.value = t('gameBanana.cancelDownload');
    ElMessage.error(t('gameBanana.errors.installFailed', { error: String(error) }));
  }
};

const handleInstallAction = async (file: GbFile) => {
  if (isCancellableDownload(file)) {
    await cancelDownloadAndInstall(file);
    return;
  }
  await downloadAndInstall(file);
};

const downloadAndInstall = async (file: GbFile) => {
  if (!detail.value || isInstalling.value) return;
  const gameName = currentGameName.value;
  if (!gameName || gameName === 'Default') {
    ElMessage.warning(t('gameBanana.errors.installNeedsGame'));
    return;
  }
  const downloadUrl = asString(file._sDownloadUrl);
  if (!downloadUrl) {
    ElMessage.error(t('gameBanana.errors.installNoDownload'));
    return;
  }

  if (isFileDownloaded(file)) {
    try {
      await ElMessageBox.confirm(
        t('gameBanana.downloadAgainConfirm', { name: detail.value.title }),
        t('gameBanana.downloaded'),
        {
          confirmButtonText: t('gameBanana.downloadAgain'),
          cancelButtonText: t('gameBanana.cancel'),
          type: 'warning',
        },
      );
    } catch {
      return;
    }
  }

  const fileId = file._idRow ?? -1;
  installingFileId.value = fileId;
  installStatus.value = t('gameBanana.installDownloading');
  installPhase.value = 'downloading';
  downloadProgress.value = 0;
  installProgress.value = 0;
  try {
    const installDir = await ModManager.getInstallDir(gameName);
    const target = await resolveGamebananaInstallTarget(detail.value);
    const previewUrls = Array.from(new Set([
      ...detail.value.screenshots,
      detail.value.thumbnailUrl,
    ].map((url) => url.trim()).filter(Boolean)));
    activeGamebananaInstall = { gameName, modName: target.targetName };
    await invoke('gamebanana_download_and_install_mod', {
      gameName,
      installDir,
      downloadUrl,
      archiveName: file._sFile || '',
      targetName: target.targetName,
      targetGroup: target.targetGroup,
      password: null,
      backupExisting: true,
      previewUrls,
    });
    if (target.targetGroup === target.automaticGroup) await applyGamebananaCategoryIcons(gameName, target.categoryTrail);
    downloadedFileIds.value = new Set(detail.value.files.map((item) => item._idRow ?? -1));
    installStatus.value = t('gameBanana.installComplete');
    ElMessage.success(t('gameBanana.installComplete'));
  } catch (error) {
    if (String(error).includes('GameBanana download cancelled')) {
      installStatus.value = t('gameBanana.downloadCancelled');
      ElMessage.info(installStatus.value);
      return;
    }
    installStatus.value = t('gameBanana.errors.installFailed', { error: String(error) });
    ElMessage.error(installStatus.value);
  } finally {
    activeGamebananaInstall = null;
    installingFileId.value = null;
    installPhase.value = 'idle';
    downloadProgress.value = 0;
    installProgress.value = 0;
  }
};

const clearTranslations = () => {
  for (const node of translationNodes) node.remove();
  translationNodes.clear();
  translationBlocksByAnchor.clear();
  translationAnchorsByBlock.clear();
};

const clearHoveredText = () => {
  hoveredTranslateElement = null;
  hoveredTranslateText = '';
};

const richTextBlockSelector = 'p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, td, th';

const translationAnchorFromElement = (target: Element): HTMLElement | null => {
  if (target.closest('.gb-inline-translation')) return null;

  const richTextContainer = target.closest('.gb-rich-text, .gb-comment-body') as HTMLElement | null;
  if (richTextContainer) {
    const block = target.closest(richTextBlockSelector) as HTMLElement | null;
    return block && richTextContainer.contains(block) ? block : richTextContainer;
  }

  return target.closest('[data-gb-translate]') as HTMLElement | null;
};

const rememberHoveredText = (event: MouseEvent) => {
  const eventTarget = event.target;
  const target = eventTarget instanceof Element
    ? eventTarget
    : eventTarget instanceof Node
      ? eventTarget.parentElement
      : null;
  const element = target ? translationAnchorFromElement(target) : null;
  if (!element) {
    clearHoveredText();
    return;
  }
  const text = element?.innerText?.trim() || '';
  if (!element || !text) {
    clearHoveredText();
    return;
  }
  hoveredTranslateElement = element;
  hoveredTranslateText = text;
};

const matchesTranslationShortcut = (event: KeyboardEvent): boolean => {
  const shortcut = appSettings.gamebananaTranslationShortcut.trim().toLowerCase() || 'ctrl';
  const tokens = shortcut.split('+').map((item) => item.trim()).filter(Boolean);
  const key = tokens.find((item) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'command'].includes(item));
  const expectsCtrl = tokens.includes('ctrl') || tokens.includes('control');
  const expectsMeta = tokens.includes('meta') || tokens.includes('cmd') || tokens.includes('command');
  if (!key) {
    return expectsCtrl
      && event.key.toLowerCase() === 'control'
      && event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !event.altKey;
  }
  if (event.key.toLowerCase() !== key) return false;
  return (expectsCtrl ? event.ctrlKey : !event.ctrlKey)
    && (expectsMeta ? event.metaKey : !event.metaKey)
    && event.shiftKey === tokens.includes('shift')
    && event.altKey === tokens.includes('alt');
};

const removeTranslationBlock = (block: HTMLElement) => {
  const anchor = translationAnchorsByBlock.get(block);
  block.remove();
  translationNodes.delete(block);
  translationAnchorsByBlock.delete(block);
  if (anchor) translationBlocksByAnchor.delete(anchor);
};

const removeTranslationForAnchor = (anchor: HTMLElement) => {
  const block = translationBlocksByAnchor.get(anchor);
  if (block) removeTranslationBlock(block);
};

const registerTranslationBlock = (anchor: HTMLElement, block: HTMLElement) => {
  translationNodes.add(block);
  translationBlocksByAnchor.set(anchor, block);
  translationAnchorsByBlock.set(block, anchor);
};

const appendTranslation = (anchor: HTMLElement, translation: string, richText: boolean) => {
  const block = document.createElement('aside');
  block.className = 'gb-inline-translation';
  const header = document.createElement('div');
  header.className = 'gb-inline-translation-head';
  const title = document.createElement('strong');
  title.textContent = t('gameBanana.translationResult');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => removeTranslationBlock(block));
  const content = document.createElement('div');
  content.className = 'gb-inline-translation-content';
  if (richText) {
    content.innerHTML = sanitizeTranslatedRichText(translation);
  } else {
    content.textContent = translation;
  }
  header.append(title, close);
  block.append(header, content);
  anchor.insertAdjacentElement('afterend', block);
  registerTranslationBlock(anchor, block);
  return block;
};

const appendTranslationLoading = (anchor: HTMLElement) => {
  const block = document.createElement('aside');
  block.className = 'gb-inline-translation';
  const header = document.createElement('div');
  header.className = 'gb-inline-translation-head';
  const title = document.createElement('strong');
  title.textContent = t('gameBanana.translationResult');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => removeTranslationBlock(block));
  const content = document.createElement('div');
  content.className = 'gb-inline-translation-content is-loading';
  const spinner = document.createElement('i');
  spinner.className = 'gb-translation-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = t('gameBanana.translationWorking');
  content.append(spinner, label);
  header.append(title, close);
  block.append(header, content);
  anchor.insertAdjacentElement('afterend', block);
  registerTranslationBlock(anchor, block);
  return block;
};

const resolveTranslationLoading = (block: HTMLElement, translation: string, richText: boolean) => {
  const content = block.querySelector('.gb-inline-translation-content');
  if (!(content instanceof HTMLElement) || !block.isConnected) return;
  content.classList.remove('is-loading');
  if (richText) {
    content.innerHTML = sanitizeTranslatedRichText(translation);
  } else {
    content.textContent = translation;
  }
};

const TRANSLATION_PROVIDER_PRESETS: Record<string, { url: string; model: string }> = {
  openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  compatible: { url: '', model: '' },
  claude: { url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  google: { url: 'https://translation.googleapis.com/language/translate/v2', model: '' },
};

const applyTranslationProviderPreset = () => {
  const preset = TRANSLATION_PROVIDER_PRESETS[appSettings.gamebananaTranslationProvider];
  if (!preset) return;
  appSettings.gamebananaTranslationApiUrl = preset.url;
  appSettings.gamebananaTranslationModel = preset.model;
  translationModelOptions.value = preset.model
    ? [{ value: preset.model, label: preset.model }]
    : [{ value: 'nmt', label: 'Google NMT' }];
};

const providerEndpoint = (baseUrl: string, suffix: string): string => {
  const normalized = baseUrl.replace(/\/$/, '');
  if (normalized.toLowerCase().endsWith(suffix.toLowerCase())) return normalized;
  return normalized.replace(/\/(?:chat\/completions|messages|generateContent)$/i, '') + suffix;
};

const readApiError = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') return fallback;
  const data = payload as { error?: { message?: unknown } | unknown; message?: unknown };
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error === 'object' && typeof (data.error as { message?: unknown }).message === 'string') {
    return (data.error as { message: string }).message;
  }
  return typeof data.message === 'string' ? data.message : fallback;
};

const uniqueModelOptions = (options: TranslationModelOption[]): TranslationModelOption[] => {
  const seen = new Set<string>();
  return options
    .filter((option) => option.value && !seen.has(option.value) && Boolean(seen.add(option.value)))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const fetchTranslationModels = async () => {
  const provider = appSettings.gamebananaTranslationProvider;
  const apiKey = appSettings.gamebananaTranslationApiKey.trim();
  const baseUrl = appSettings.gamebananaTranslationApiUrl.trim().replace(/\/$/, '');
  if (!apiKey || !baseUrl) {
    translationModelsStatus.value = t('gameBanana.translationModelsMissingConfig');
    return;
  }

  loadingTranslationModels.value = true;
  translationModelsStatus.value = t('gameBanana.translationModelsLoading');
  try {
    let options: TranslationModelOption[] = [];
    if (provider === 'google') {
      const endpoint = providerEndpoint(baseUrl, '/languages');
      const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, { method: 'GET' });
      const payload = await response.json() as { data?: { languages?: unknown[] } };
      if (!response.ok) throw new Error(readApiError(payload, `HTTP ${response.status}`));
      options = [{ value: 'nmt', label: 'Google NMT (default)' }];
    } else if (provider === 'gemini') {
      const endpoint = providerEndpoint(baseUrl, '/models');
      const response = await fetch(`${endpoint}?pageSize=1000&key=${encodeURIComponent(apiKey)}`, { method: 'GET' });
      const payload = await response.json() as {
        models?: Array<{ name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(readApiError(payload, `HTTP ${response.status}`));
      options = (payload.models || [])
        .filter((model) => !Array.isArray(model.supportedGenerationMethods) || model.supportedGenerationMethods.includes('generateContent'))
        .map((model) => {
          const name = asString(model.name).replace(/^models\//i, '');
          const displayName = asString(model.displayName);
          return { value: name, label: displayName ? `${displayName} (${name})` : name };
        });
    } else {
      const endpoint = providerEndpoint(baseUrl, '/models');
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: provider === 'claude'
          ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${apiKey}` },
      });
      const payload = await response.json() as {
        data?: Array<{ id?: unknown; display_name?: unknown; displayName?: unknown }>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(readApiError(payload, `HTTP ${response.status}`));
      options = (payload.data || []).map((model) => {
        const id = asString(model.id);
        const label = asString(model.display_name) || asString(model.displayName);
        return { value: id, label: label && label !== id ? `${label} (${id})` : id };
      });
    }

    const currentModel = appSettings.gamebananaTranslationModel.trim();
    if (currentModel && !options.some((option) => option.value === currentModel)) {
      options.push({ value: currentModel, label: `${currentModel} (${t('gameBanana.translationModelCustom')})` });
    }
    translationModelOptions.value = uniqueModelOptions(options);
    if (!appSettings.gamebananaTranslationModel && translationModelOptions.value.length) {
      appSettings.gamebananaTranslationModel = translationModelOptions.value[0].value;
    }
    translationModelsStatus.value = t('gameBanana.translationModelsLoaded', { count: translationModelOptions.value.length });
  } catch (error) {
    translationModelsStatus.value = t('gameBanana.errors.translationModelsFailed', { error: String(error) });
  } finally {
    loadingTranslationModels.value = false;
  }
};

const onTranslationProviderChange = () => {
  applyTranslationProviderPreset();
  void fetchTranslationModels();
};

const translateWithConfiguredProvider = async (source: string, targetLanguage: string, richText: boolean): Promise<string> => {
  const provider = appSettings.gamebananaTranslationProvider;
  const apiKey = appSettings.gamebananaTranslationApiKey.trim();
  const baseUrl = appSettings.gamebananaTranslationApiUrl.trim().replace(/\/$/, '');
  const model = appSettings.gamebananaTranslationModel.trim() || 'gpt-4o-mini';
  const translationInstruction = richText
    ? `Translate the following GameBanana HTML fragment into ${targetLanguage}. Preserve its meaningful HTML structure, links, and inline formatting. Return only valid translated HTML with no Markdown code fences or explanation.`
    : `Translate the following GameBanana text into ${targetLanguage}. Return only the translation and preserve meaning.`;

  if (provider === 'claude') {
    const endpoint = /\/messages$/i.test(baseUrl) ? baseUrl : `${baseUrl}/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: translationInstruction,
        messages: [{ role: 'user', content: source }],
      }),
    });
    const payload = await response.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    return asString(payload.content?.[0]?.text);
  }

  if (provider === 'gemini') {
    const endpointBase = /\/models$/i.test(baseUrl) ? baseUrl : `${baseUrl}/models`;
    const response = await fetch(`${endpointBase}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${translationInstruction}\n\n${source}` }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    return asString(payload.candidates?.[0]?.content?.parts?.[0]?.text);
  }

  if (provider === 'google') {
    const endpoint = /\/language\/translate\/v2$/i.test(baseUrl) ? baseUrl : `${baseUrl}/language/translate/v2`;
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: source, target: targetLanguage, format: richText ? 'html' : 'text', model: model || 'nmt' }),
    });
    const payload = await response.json() as { data?: { translations?: Array<{ translatedText?: string }> }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    const translated = asString(payload.data?.translations?.[0]?.translatedText);
    return richText ? translated : toPlainText(translated);
  }

  const endpoint = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: translationInstruction },
        { role: 'user', content: source },
      ],
    }),
  });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
  return asString(payload.choices?.[0]?.message?.content);
};

const isRichTextContainer = (element: HTMLElement) => element.matches('.gb-rich-text, .gb-comment-body');

const translationTargetsForAnchor = (anchor: HTMLElement): HTMLElement[] => {
  if (!appSettings.gamebananaTranslationRichText || !isRichTextContainer(anchor)) return [anchor];
  const candidates = Array.from(anchor.querySelectorAll(richTextBlockSelector))
    .filter((block): block is HTMLElement => block instanceof HTMLElement && Boolean(block.innerText.trim()));
  // Prefer leaf blocks: list items and table cells may themselves contain a
  // paragraph, and translating both would duplicate the same source text.
  const blocks = candidates.filter((block) => !candidates.some((other) => other !== block && block.contains(other)));
  return blocks.length ? blocks : [anchor];
};

const translateAnchor = async (anchor: HTMLElement) => {
  const richText = appSettings.gamebananaTranslationRichText
    && Boolean(anchor.closest('.gb-rich-text, .gb-comment-body'));
  const source = richText
    ? anchor.innerHTML.trim()
    : anchor.innerText.trim();
  if (!source || !anchor.isConnected) {
    return;
  }
  if (translationBlocksByAnchor.has(anchor)) {
    removeTranslationForAnchor(anchor);
    return;
  }
  const apiKey = appSettings.gamebananaTranslationApiKey.trim();
  const baseUrl = appSettings.gamebananaTranslationApiUrl.trim().replace(/\/$/, '');
  if (!apiKey || !baseUrl) {
    ElMessage.warning(t('gameBanana.translationMissingConfig'));
    showTranslationSettings.value = true;
    return;
  }

  const targetLanguage = appSettings.gamebananaTranslationTargetLanguage.trim() || '简体中文';
  const model = appSettings.gamebananaTranslationModel.trim() || 'gpt-4o-mini';
  const cacheKey = `${appSettings.gamebananaTranslationProvider}|${baseUrl}|${model}|${targetLanguage}|${richText ? 'html' : 'text'}|${source}`;
  const cached = translationCache.get(cacheKey);
  if (cached) {
    appendTranslation(anchor, cached, richText);
    return;
  }

  translationRequestCount.value += 1;
  translationStatus.value = t('gameBanana.translationWorking');
  const loadingBlock = appendTranslationLoading(anchor);
  try {
    const translated = await translateWithConfiguredProvider(source.slice(0, 12000), targetLanguage, richText);
    if (!translated) throw new Error(t('gameBanana.errors.translationEmpty'));
    translationCache.set(cacheKey, translated);
    resolveTranslationLoading(loadingBlock, translated, richText);
  } catch (error) {
    removeTranslationBlock(loadingBlock);
    translationStatus.value = t('gameBanana.errors.translationFailed', { error: String(error) });
    ElMessage.error(translationStatus.value);
  } finally {
    translationRequestCount.value = Math.max(0, translationRequestCount.value - 1);
    if (translationRequestCount.value === 0 && !translationStatus.value.startsWith(t('gameBanana.errors.translationFailed', { error: '' }))) {
      translationStatus.value = '';
    }
  }
};

const translateHoveredParagraph = async () => {
  if (!appSettings.gamebananaTranslationEnabled) return;
  const anchor = hoveredTranslateElement;
  if (!anchor?.isConnected || !hoveredTranslateText.trim()) {
    ElMessage.info(t('gameBanana.translationNoParagraph'));
    return;
  }

  const targets = translationTargetsForAnchor(anchor);
  // When the pointer lands directly on a rich-text container, retain the
  // paragraph boundary in both directions: one hotkey creates one result per
  // source block; pressing again removes that same set instead of appending a
  // combined translation after the entire article.
  if (targets.length > 1 && targets.some((target) => translationBlocksByAnchor.has(target))) {
    targets.forEach(removeTranslationForAnchor);
    return;
  }
  await Promise.all(targets.map((target) => translateAnchor(target)));
};

const onGlobalKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (!matchesTranslationShortcut(event)) return;
  event.preventDefault();
  void translateHoveredParagraph();
};

const syncGameTarget = async () => {
  const gameName = currentGameName.value;
  const storedKey = `gamebanana:game-id:${gameName || 'default'}`;
  const storedId = Number(localStorage.getItem(storedKey));
  gameTargetLabel.value = gameName || t('gameBanana.noGameSelected');

  if (gameName && gameName !== 'Default') {
    try {
      const config = await ResourceManager.loadGameConfig(gameName);
      const preset = asString(config?.gamePreset).toUpperCase();
      const presetGameId = GAMEBANANA_ID_BY_PRESET[preset];
      if (presetGameId) {
        gameId.value = presetGameId;
        gameTargetLabel.value = `${gameName} · ${preset}`;
      } else if (Number.isInteger(storedId) && storedId > 0) {
        gameId.value = storedId;
      }
    } catch (error) {
      console.warn('Unable to load the current game configuration for GameBanana:', error);
    }
  } else if (Number.isInteger(storedId) && storedId > 0) {
    gameId.value = storedId;
  }

  await applyTarget();
};

watch(gameId, (value) => {
  const normalized = Math.max(1, Math.floor(Number(value) || DEFAULT_GAMEBANANA_ID));
  if (value !== normalized) {
    gameId.value = normalized;
    return;
  }
  localStorage.setItem(`gamebanana:game-id:${currentGameName.value || 'default'}`, String(normalized));
});

watch(() => appSettings.gamebananaNsfwMode, (mode) => {
  const selected = mods.value.find((item) => item.id === selectedModId.value);
  if (selected && mode === 'hide' && selected.isNsfw) {
    const fallback = visibleMods.value[0];
    selectedModId.value = null;
    detail.value = null;
    if (fallback) void selectMod(fallback);
  }
});

watch(() => appSettings.CurrentGameName, () => {
  void syncGameTarget();
});

watch([() => detail.value?.id, installGroup, currentGameName], () => {
  void refreshDownloadedFileState();
});

watch(showTranslationSettings, (visible) => {
  if (visible) void fetchTranslationModels();
});

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown);
  void listenForInstallProgress();
  void syncGameTarget();
  if (appSettings.gamebananaTranslationApiKey.trim() && appSettings.gamebananaTranslationApiUrl.trim()) {
    void fetchTranslationModels();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  unlistenDownloadProgress?.();
  unlistenInstallProgress?.();
  clearTranslations();
});
</script>

<template>
  <div class="page-container gamebanana-page" @pointerover="rememberHoveredText" @pointermove="rememberHoveredText" @mouseleave="clearHoveredText">
    <section class="gb-controls glass-panel">
      <div class="gb-title-block">
        <strong>GameBanana</strong>
        <span>{{ gameTargetLabel }}</span>
      </div>
      <label class="gb-field gb-search-field">
        <span>{{ t('gameBanana.search') }}</span>
        <input v-model="searchQuery" type="search" :placeholder="t('gameBanana.searchPlaceholder')" @keyup.enter="loadMods(1)" />
      </label>
      <label class="gb-field gb-id-field">
        <span>{{ t('gameBanana.gameId') }}</span>
        <input v-model.number="gameId" type="number" min="1" @keyup.enter="applyTarget" />
      </label>
      <label class="gb-field gb-size-field">
        <span>{{ t('gameBanana.perPage') }}</span>
        <el-select v-model="pageSize" class="gb-select" popper-class="gamebanana-select-popper" @change="loadMods(1)">
          <el-option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :label="String(size)" :value="size" />
        </el-select>
      </label>
      <el-radio-group v-model="appSettings.gamebananaNsfwMode" class="gb-nsfw-mode" size="small">
        <el-radio-button value="show">{{ t('gameBanana.nsfwShow') }}</el-radio-button>
        <el-radio-button value="blur">{{ t('gameBanana.nsfwBlur') }}</el-radio-button>
        <el-radio-button value="hide">{{ t('gameBanana.nsfwHide') }}</el-radio-button>
      </el-radio-group>
      <button type="button" class="gb-button gb-button--primary" :disabled="loadingMods" @click="loadMods(1)">
        {{ loadingMods ? t('gameBanana.loading') : t('gameBanana.searchAction') }}
      </button>
      <button type="button" class="gb-button" :disabled="loadingCategories || loadingMods" @click="applyTarget">
        {{ t('gameBanana.refresh') }}
      </button>
      <button type="button" class="gb-button" @click="openExternal(gameUrl)">{{ t('gameBanana.openGamePage') }}</button>
      <button type="button" class="gb-button" :class="{ active: showTranslationSettings }" @click="showTranslationSettings = !showTranslationSettings">
        {{ t('gameBanana.translationSettings') }}
      </button>
    </section>

    <section v-if="showTranslationSettings" class="gb-translation-settings glass-panel">
      <div class="gb-translation-settings-head">
        <strong>{{ t('gameBanana.translationSettings') }}</strong>
        <span>{{ t('gameBanana.translationHint', { shortcut: appSettings.gamebananaTranslationShortcut || 'Ctrl' }) }}</span>
      </div>
      <label class="gb-field gb-translation-enabled">
        <span>{{ t('gameBanana.translationEnabled') }}</span>
        <el-switch v-model="appSettings.gamebananaTranslationEnabled" />
      </label>
      <label class="gb-field gb-translation-enabled" :title="t('gameBanana.translationRichTextHint')">
        <span>{{ t('gameBanana.translationRichText') }}</span>
        <el-switch v-model="appSettings.gamebananaTranslationRichText" />
      </label>
      <label class="gb-field">
        <span>{{ t('gameBanana.translationProvider') }}</span>
        <el-select v-model="appSettings.gamebananaTranslationProvider" class="gb-select" popper-class="gamebanana-select-popper" @change="onTranslationProviderChange">
          <el-option label="OpenAI" value="openai" />
          <el-option :label="t('gameBanana.translationProviderCompatible')" value="compatible" />
          <el-option label="Claude" value="claude" />
          <el-option label="DeepSeek" value="deepseek" />
          <el-option label="Gemini" value="gemini" />
          <el-option label="Google Cloud Translate" value="google" />
        </el-select>
      </label>
      <label class="gb-field gb-translation-url">
        <span>{{ t('gameBanana.translationApiUrl') }}</span>
        <input v-model="appSettings.gamebananaTranslationApiUrl" type="url" placeholder="https://api.openai.com/v1" @change="fetchTranslationModels" />
      </label>
      <label class="gb-field">
        <span>{{ t('gameBanana.translationApiKey') }}</span>
        <input v-model="appSettings.gamebananaTranslationApiKey" type="password" autocomplete="off" @change="fetchTranslationModels" />
      </label>
      <label class="gb-field gb-translation-model">
        <span>{{ t('gameBanana.translationModel') }}</span>
        <span class="gb-model-control">
          <el-select
            v-model="appSettings.gamebananaTranslationModel"
            class="gb-select"
            popper-class="gamebanana-select-popper"
            filterable
            allow-create
            default-first-option
            :loading="loadingTranslationModels"
            :placeholder="t('gameBanana.translationModel')"
          >
            <el-option
              v-if="appSettings.gamebananaTranslationModel && !translationModelOptions.some((option) => option.value === appSettings.gamebananaTranslationModel)"
              :label="appSettings.gamebananaTranslationModel"
              :value="appSettings.gamebananaTranslationModel"
            />
            <el-option v-for="option in translationModelOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
          <button type="button" class="gb-model-refresh" :disabled="loadingTranslationModels" :title="t('gameBanana.translationModelsRefresh')" @click="fetchTranslationModels">↻</button>
        </span>
      </label>
      <label class="gb-field">
        <span>{{ t('gameBanana.translationTarget') }}</span>
        <input v-model="appSettings.gamebananaTranslationTargetLanguage" type="text" />
      </label>
      <label class="gb-field">
        <span>{{ t('gameBanana.translationShortcut') }}</span>
        <input v-model="appSettings.gamebananaTranslationShortcut" type="text" placeholder="Ctrl" />
      </label>
      <span v-if="translationStatus || translationModelsStatus" class="gb-translation-status">{{ translationStatus || translationModelsStatus }}</span>
    </section>

    <p v-if="errorMessage" class="gb-error">{{ errorMessage }}</p>

    <main class="gb-layout">
      <aside class="gb-panel gb-categories glass-panel">
        <div class="gb-panel-title">
          <span>{{ t('gameBanana.categories') }}</span>
          <small>{{ loadingCategories ? t('gameBanana.loading') : allCategories.length }}</small>
        </div>
        <div class="gb-category-list">
          <button type="button" class="gb-category" :class="{ active: selectedCategoryId === null }" @click="selectCategory(null)">
            {{ t('gameBanana.allCategories') }}
          </button>
          <div v-for="row in categoryRows" :key="row.node._idRow" class="gb-category-row" :style="{ '--category-depth': String(row.depth) }">
            <button
              v-if="categoryCanExpand(row.node)"
              type="button"
              class="gb-category-toggle"
              :class="{ expanded: expandedCategoryIds.has(row.node._idRow), loading: row.node.loadingChildren }"
              :aria-label="expandedCategoryIds.has(row.node._idRow) ? t('gameBanana.collapseCategory') : t('gameBanana.expandCategory')"
              @click="toggleCategory(row.node)"
            >›</button>
            <span v-else class="gb-category-toggle-spacer" aria-hidden="true" />
            <button
              type="button"
              class="gb-category"
              :class="{ active: selectedCategoryId === row.node._idRow }"
              data-gb-translate
              @click="selectCategory(row.node._idRow)"
            >
              <img v-if="row.node._sIconUrl" class="gb-category-icon" :src="row.node._sIconUrl" alt="" loading="lazy" />
              <span>{{ row.node._sName || `#${row.node._idRow}` }}</span>
            </button>
          </div>
        </div>
      </aside>

      <section class="gb-panel gb-results glass-panel">
        <div class="gb-panel-title gb-results-title">
          <div>
            <span data-gb-translate>{{ selectedCategoryName }}</span>
            <small>{{ t('gameBanana.resultCount', { count: visibleCountText, total: formatNumber(totalRecords) }) }}</small>
          </div>
          <span>{{ t('gameBanana.page', { current: currentPage }) }}</span>
        </div>

        <div v-if="loadingMods" class="gb-empty">{{ t('gameBanana.loading') }}</div>
        <div v-else-if="visibleMods.length" class="gb-mod-list">
          <article
            v-for="mod in visibleMods"
            :key="mod.id"
            class="gb-mod-card"
            :class="{ active: selectedModId === mod.id }"
            role="button"
            tabindex="0"
            @click="selectMod(mod)"
            @keydown.enter.prevent="selectMod(mod)"
            @keydown.space.prevent="selectMod(mod)"
          >
            <div class="gb-mod-thumb" :class="{ 'is-nsfw-blurred': appSettings.gamebananaNsfwMode === 'blur' && mod.isNsfw }">
              <img v-if="mod.thumbnailUrl" :src="mod.thumbnailUrl" :alt="mod.title" loading="lazy" />
              <span v-else>{{ mod.title.slice(0, 1) }}</span>
              <span v-if="mod.isNsfw" class="gb-nsfw-badge">NSFW</span>
            </div>
            <span class="gb-mod-copy">
              <strong :title="mod.title" data-gb-translate>{{ mod.title }}</strong>
              <small>
                <button type="button" class="gb-author-link" :disabled="!mod.authorId && !mod.authorUrl" data-gb-translate @click.stop="openAuthorPage(mod.authorId, mod.authorUrl)">{{ mod.author }}</button>
              </small>
              <em v-if="mod.categoryName" data-gb-translate>{{ mod.categoryName }}</em>
              <p data-gb-translate>{{ mod.description || t('gameBanana.noDescription') }}</p>
              <time>{{ t('gameBanana.updated') }} · {{ formatDate(mod.updatedAt) }}</time>
            </span>
          </article>
        </div>
        <div v-else class="gb-empty">{{ t('gameBanana.empty') }}</div>

        <div class="gb-pagination">
          <button type="button" class="gb-button" :disabled="loadingMods || currentPage <= 1" @click="loadMods(currentPage - 1)">
            {{ t('gameBanana.previous') }}
          </button>
          <button type="button" class="gb-button" :disabled="loadingMods || !hasMore" @click="loadMods(currentPage + 1)">
            {{ t('gameBanana.next') }}
          </button>
        </div>
      </section>

      <aside class="gb-panel gb-detail glass-panel">
        <div v-if="loadingDetail" class="gb-empty">{{ t('gameBanana.loading') }}</div>
        <template v-else-if="detail">
          <div class="gb-detail-head">
            <div>
              <h2 data-gb-translate>{{ detail.title }}</h2>
              <button type="button" class="gb-author-link" :disabled="!detail.authorId && !detail.authorUrl" data-gb-translate @click="openAuthorPage(detail.authorId, detail.authorUrl)">
                {{ detail.author }}
              </button>
            </div>
            <span v-if="detail.isNsfw" class="gb-nsfw-badge">NSFW</span>
          </div>

          <div v-if="detail.screenshots.length" class="gb-screenshots">
            <button v-for="(image, index) in detail.screenshots.slice(0, 4)" :key="image" type="button" :class="{ 'is-nsfw-blurred': appSettings.gamebananaNsfwMode === 'blur' && detail.isNsfw }" @click="openExternal(image)">
              <img :src="image" :alt="`${detail.title} ${index + 1}`" loading="lazy" />
            </button>
          </div>

          <div class="gb-stats">
            <span>{{ t('gameBanana.downloads') }}<strong>{{ formatNumber(detail.downloads) }}</strong></span>
            <span>{{ t('gameBanana.views') }}<strong>{{ formatNumber(detail.views) }}</strong></span>
            <span>{{ t('gameBanana.likes') }}<strong>{{ formatNumber(detail.likes) }}</strong></span>
          </div>

          <p v-if="detail.contentRatings.length" class="gb-ratings" data-gb-translate>{{ detail.contentRatings.join(' · ') }}</p>
          <div
            v-if="detail.descriptionHtml"
            class="gb-rich-text gb-description"
            @click="richTextClick"
            v-html="detail.descriptionHtml"
          />
          <p v-else class="gb-description" data-gb-translate>{{ detail.description || t('gameBanana.noDescription') }}</p>

          <div v-if="detail.files.length" class="gb-files">
            <h3>{{ t('gameBanana.files') }}</h3>
            <label class="gb-install-group">
              <span>{{ t('gameBanana.installGroup') }}</span>
              <input v-model="installGroup" type="text" :placeholder="gamebananaInstallGroup(detail)" />
            </label>
            <div v-for="file in detail.files" :key="file._idRow || file._sFile" class="gb-file">
              <span>
                <strong data-gb-translate>{{ file._sFile || t('gameBanana.download') }}</strong>
                <small>{{ formatFileSize(file._nFilesize) }} · {{ formatDate(asNumber(file._tsDateAdded)) }}</small>
              </span>
              <span class="gb-file-actions">
                <button
                  type="button"
                  class="gb-file-action gb-file-install-action"
                  :class="installButtonClass(file)"
                  :style="installButtonStyle(file)"
                  :disabled="isFileActionDisabled(file)"
                  @click="handleInstallAction(file)"
                >
                  <span>{{ installButtonLabel(file) }}</span>
                </button>
                <button type="button" class="gb-file-action" @click="openExternal(file._sDownloadUrl || detail.profileUrl)">{{ t('gameBanana.openDownload') }}</button>
              </span>
            </div>
          </div>

          <section class="gb-comments">
            <div class="gb-comments-head">
              <h3>{{ t('gameBanana.comments') }}</h3>
              <button type="button" class="gb-link-button" :disabled="loadingComments" @click="loadComments(detail.id)">{{ t('gameBanana.refresh') }}</button>
            </div>
            <p v-if="loadingComments" class="gb-comments-empty">{{ t('gameBanana.loading') }}</p>
            <div v-else-if="comments.length" class="gb-comment-list">
              <article v-for="comment in comments" :key="comment.id" class="gb-comment" :class="{ reply: comment.depth > 0 }" :style="{ '--comment-depth': String(Math.min(comment.depth, 3)) }">
                <header>
                  <img v-if="comment.avatarUrl" :src="comment.avatarUrl" :alt="comment.author" />
                  <button type="button" class="gb-author-link" data-gb-translate @click="openAuthorPage(comment.authorId, comment.authorUrl)">{{ comment.author }}</button>
                  <time>{{ formatDate(comment.postedAt) }}</time>
                  <span v-if="comment.score" class="gb-comment-score">+{{ comment.score }}</span>
                </header>
                <div class="gb-rich-text gb-comment-body" @click="richTextClick" v-html="comment.bodyHtml" />
                <button v-if="comment.replyCount > 0 && !comment.repliesLoaded" type="button" class="gb-comment-replies" :disabled="comment.loadingReplies" @click="loadReplies(comment)">
                  {{ comment.loadingReplies ? t('gameBanana.loading') : t('gameBanana.loadReplies', { count: comment.replyCount }) }}
                </button>
              </article>
            </div>
            <p v-else class="gb-comments-empty">{{ t('gameBanana.noComments') }}</p>
            <button v-if="commentsHasMore" type="button" class="gb-button gb-comments-more" :disabled="loadingMoreComments" @click="loadComments(detail.id, commentsPage + 1, true)">
              {{ loadingMoreComments ? t('gameBanana.loading') : t('gameBanana.loadMoreComments') }}
            </button>
          </section>

          <div class="gb-detail-actions">
            <button type="button" class="gb-button gb-button--primary" @click="openExternal(detail.profileUrl)">
              {{ t('gameBanana.openModPage') }}
            </button>
          </div>
        </template>
        <div v-else class="gb-empty">{{ t('gameBanana.selectMod') }}</div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.gamebanana-page {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  padding: 46px 18px 18px;
  color: rgba(var(--theme-text-primary-rgb), 0.9);
}

.glass-panel {
  background: linear-gradient(145deg, rgba(18, 21, 31, 0.76), rgba(9, 11, 17, 0.64));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16), inset 0 1px rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.gb-controls,
.gb-layout,
.gb-panel,
.gb-results,
.gb-detail {
  min-height: 0;
}

.gb-detail h2,
.gb-files h3 {
  margin: 0;
}

.gb-link-button,
.gb-author-link {
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent;
  color: rgba(var(--theme-surface-tint-rgb), 0.9);
  font: inherit;
  cursor: pointer;
}

.gb-link-button:hover,
.gb-author-link:hover { color: rgba(255,255,255,0.96); text-decoration: underline; }
.gb-author-link:disabled { color: rgba(var(--theme-text-secondary-rgb), 0.68); cursor: default; text-decoration: none; }

.gb-controls {
  display: flex;
  align-items: end;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
}
.gb-title-block { display: grid; flex: 0 0 auto; gap: 2px; min-width: 124px; }
.gb-title-block strong { color: rgba(var(--theme-text-primary-rgb), 0.94); font-size: 16px; letter-spacing: .02em; }
.gb-title-block span { max-width: 150px; overflow: hidden; color: rgba(var(--theme-text-secondary-rgb), .6); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }

.gb-field { display: grid; gap: 4px; min-width: 90px; }
.gb-field span { color: rgba(var(--theme-text-secondary-rgb), 0.64); font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.gb-search-field { flex: 1 1 260px; }
.gb-id-field { width: 104px; }
.gb-size-field { width: 78px; }
.gb-field input,
.gb-field select,
.gb-field :deep(.el-select__wrapper) {
  width: 100%;
  box-sizing: border-box;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 7px;
  outline: none;
  background: rgba(0,0,0,0.2);
  color: rgba(var(--theme-text-primary-rgb), 0.92);
  font: inherit;
  font-size: 12px;
}
.gb-field input:focus,
.gb-field select:focus,
.gb-field :deep(.el-select__wrapper.is-focused) { border-color: rgba(var(--theme-surface-tint-rgb), 0.62); box-shadow: 0 0 0 2px rgba(var(--theme-surface-tint-rgb), 0.11); }
.gb-field :deep(.el-select) { width: 100%; }
.gb-field :deep(.el-select__selected-item),
.gb-field :deep(.el-select__placeholder) { color: rgba(var(--theme-text-primary-rgb), .92); font-size: 12px; }
.gb-nsfw-mode { flex: 0 0 auto; margin-bottom: 1px; }
.gb-nsfw-mode :deep(.el-radio-button__inner) { padding: 7px 8px; border-color: rgba(255,255,255,.14); background: rgba(0,0,0,.16); color: rgba(var(--theme-text-primary-rgb),.7); font-size: 11px; box-shadow: none; }
.gb-nsfw-mode :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) { background: rgba(var(--theme-surface-tint-rgb),.19); border-color: rgba(var(--theme-surface-tint-rgb),.48); color: rgba(var(--theme-text-primary-rgb),.95); box-shadow: -1px 0 0 0 rgba(var(--theme-surface-tint-rgb),.45); }

.gb-translation-settings { display: grid; grid-template-columns: 1.15fr 1fr 1fr .8fr .8fr .8fr; align-items: end; gap: 9px; padding: 10px 12px 12px; border-radius: 12px; }
.gb-translation-settings-head { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 10px; color: rgba(var(--theme-text-primary-rgb),.88); font-size: 12px; }
.gb-translation-settings-head span, .gb-translation-status { color: rgba(var(--theme-text-secondary-rgb),.62); font-size: 10px; }
.gb-translation-enabled { width: 86px; }
.gb-translation-url { min-width: 190px; }
.gb-translation-model { min-width: 145px; }
.gb-model-control { display: flex; align-items: stretch; gap: 5px; min-width: 0; text-transform: none; }
.gb-model-refresh { width: 30px; flex: 0 0 auto; border: 1px solid rgba(255,255,255,.13); border-radius: 7px; background: rgba(255,255,255,.055); color: rgba(var(--theme-text-primary-rgb),.82); font: inherit; font-size: 16px; line-height: 1; cursor: pointer; }.gb-model-refresh:hover:not(:disabled) { background: rgba(var(--theme-surface-tint-rgb),.16); border-color: rgba(var(--theme-surface-tint-rgb),.38); }.gb-model-refresh:disabled { opacity:.45; cursor: default; }

.gb-button {
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 7px;
  background: rgba(255,255,255,0.055);
  color: rgba(var(--theme-text-primary-rgb), 0.86);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background .16s ease, border-color .16s ease, transform .16s ease;
}
.gb-button:hover:not(:disabled) { background: rgba(var(--theme-surface-tint-rgb), 0.16); border-color: rgba(var(--theme-surface-tint-rgb), 0.38); transform: translateY(-1px); }
.gb-button:disabled { opacity: 0.45; cursor: default; }
.gb-button--primary { background: rgba(var(--theme-surface-tint-rgb), 0.2); border-color: rgba(var(--theme-surface-tint-rgb), 0.42); }

.gb-error { margin: -3px 2px 0; color: #ffabab; font-size: 12px; }

.gb-layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(160px, 0.72fr) minmax(310px, 1.45fr) minmax(270px, 1fr);
  gap: 12px;
  overflow: hidden;
}

.gb-panel { border-radius: 12px; overflow: hidden; }
.gb-categories,
.gb-results,
.gb-detail { display: flex; flex-direction: column; }

.gb-panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex: 0 0 auto;
  padding: 12px 13px 9px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  color: rgba(var(--theme-text-primary-rgb), 0.88);
  font-size: 13px;
  font-weight: 700;
}
.gb-panel-title small,
.gb-results-title span:last-child { color: rgba(var(--theme-text-secondary-rgb), 0.58); font-size: 11px; font-weight: 500; }
.gb-results-title > div { display: grid; gap: 2px; }

.gb-category-list,
.gb-mod-list,
.gb-detail { overflow: auto; scrollbar-color: rgba(255,255,255,0.2) transparent; }
.gb-category-list { padding: 6px; }
.gb-category-row { display: flex; flex-wrap: wrap; align-items: stretch; min-width: 0; padding-left: calc(var(--category-depth) * 14px); }
.gb-category-toggle,
.gb-category-toggle-spacer { width: 18px; flex: 0 0 18px; align-self: stretch; }
.gb-category-toggle { border: 0; background: transparent; color: rgba(var(--theme-text-secondary-rgb), .65); font: inherit; font-size: 18px; line-height: 1; cursor: pointer; transition: color .15s ease, transform .15s ease; }
.gb-category-toggle:hover { color: rgba(var(--theme-text-primary-rgb), .96); }.gb-category-toggle.expanded { transform: rotate(90deg); }.gb-category-toggle.loading { opacity: .55; animation: gb-category-toggle-spin .8s linear infinite; pointer-events: none; }
@keyframes gb-category-toggle-spin { to { transform: rotate(360deg); } }
.gb-category {
  display: flex;
  align-items: center;
  width: calc(100% - 18px);
  min-width: 0;
  gap: 7px;
  padding: 8px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--theme-text-primary-rgb), 0.72);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.gb-category span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gb-category-icon { width: 17px; height: 17px; flex: 0 0 auto; object-fit: contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
.gb-category-row :global(.gb-inline-translation) { flex: 0 0 calc(100% - 18px); margin-left: 18px; }
.gb-category:hover { background: rgba(255,255,255,0.06); color: rgba(var(--theme-text-primary-rgb), 0.94); }
.gb-category.active { background: rgba(var(--theme-surface-tint-rgb), 0.16); color: rgba(var(--theme-surface-tint-rgb), 0.98); font-weight: 700; }

.gb-mod-list { flex: 1; padding: 7px; }
.gb-mod-card {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  width: 100%;
  gap: 10px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.gb-mod-card:focus-visible { outline: 2px solid rgba(var(--theme-surface-tint-rgb), .7); outline-offset: 2px; }
.gb-mod-card + .gb-mod-card { margin-top: 3px; }
.gb-mod-card:hover { background: rgba(255,255,255,0.055); }
.gb-mod-card.active { background: rgba(var(--theme-surface-tint-rgb), 0.12); border-color: rgba(var(--theme-surface-tint-rgb), 0.32); }
.gb-mod-thumb { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 6px; background: rgba(0,0,0,0.22); display: grid; place-items: center; color: rgba(var(--theme-surface-tint-rgb), 0.7); font-size: 24px; font-weight: 800; }
.gb-mod-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform .22s ease; }
.gb-mod-card:hover .gb-mod-thumb img { transform: scale(1.04); }
.gb-mod-thumb.is-nsfw-blurred img { filter: blur(18px) saturate(.75); transform: scale(1.16); }
.gb-mod-thumb.is-nsfw-blurred::after { content: 'NSFW'; position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; background: rgba(8, 9, 14, .24); color: rgba(255,255,255,.9); font-size: 11px; letter-spacing: .16em; text-shadow: 0 1px 7px rgba(0,0,0,.95); }
.gb-nsfw-badge { position: absolute; top: 5px; right: 5px; padding: 2px 5px; border-radius: 4px; background: rgba(138, 27, 58, 0.84); color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .06em; }
.gb-mod-copy { min-width: 0; display: grid; align-content: start; gap: 2px; }
.gb-mod-copy strong { overflow: hidden; color: rgba(var(--theme-text-primary-rgb), 0.9); font-size: 13px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.gb-mod-copy small,
.gb-mod-copy em,
.gb-mod-copy time { color: rgba(var(--theme-text-secondary-rgb), 0.62); font-size: 10px; font-style: normal; }
.gb-mod-copy em { color: rgba(var(--theme-surface-tint-rgb), 0.72); }
.gb-mod-copy p { display: -webkit-box; margin: 3px 0 0; overflow: hidden; color: rgba(var(--theme-text-secondary-rgb), 0.65); font-size: 11px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.gb-pagination { display: flex; justify-content: flex-end; gap: 7px; flex: 0 0 auto; padding: 9px 12px; border-top: 1px solid rgba(255,255,255,0.07); }

.gb-detail { padding: 14px; gap: 13px; }
.gb-detail-head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.gb-detail h2 { color: rgba(var(--theme-text-primary-rgb), 0.94); font-size: 17px; line-height: 1.25; }
.gb-detail-head .gb-author-link { margin-top: 4px; font-size: 12px; }
.gb-detail-head .gb-nsfw-badge { position: static; flex: 0 0 auto; }
.gb-screenshots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.gb-screenshots button { position: relative; aspect-ratio: 16 / 9; overflow: hidden; padding: 0; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; background: rgba(0,0,0,0.2); cursor: zoom-in; }
.gb-screenshots img { width: 100%; height: 100%; object-fit: cover; transition: transform .2s ease; }
.gb-screenshots button:hover img { transform: scale(1.05); }
.gb-screenshots button.is-nsfw-blurred img { filter: blur(18px) saturate(.75); transform: scale(1.16); }
.gb-screenshots button.is-nsfw-blurred::after { content: 'NSFW'; position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; background: rgba(8,9,14,.26); color: rgba(255,255,255,.9); font-size: 10px; font-weight: 800; letter-spacing: .14em; text-shadow: 0 1px 6px rgba(0,0,0,.9); }
.gb-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.gb-stats span { display: grid; gap: 3px; padding: 7px; border-radius: 6px; background: rgba(255,255,255,0.045); color: rgba(var(--theme-text-secondary-rgb), 0.6); font-size: 10px; }
.gb-stats strong { color: rgba(var(--theme-text-primary-rgb), 0.9); font-size: 13px; }
.gb-ratings { margin: -6px 0 0; color: #f1bc9b; font-size: 11px; }
.gb-description { margin: 0; color: rgba(var(--theme-text-primary-rgb), 0.74); font-size: 12px; line-height: 1.56; }
.gb-rich-text { overflow-wrap: anywhere; }
.gb-rich-text :deep(p), .gb-rich-text :deep(li), .gb-rich-text :deep(blockquote), .gb-rich-text :deep(pre) { margin: 0 0 9px; }
.gb-rich-text :deep(h1), .gb-rich-text :deep(h2), .gb-rich-text :deep(h3), .gb-rich-text :deep(h4) { margin: 11px 0 6px; color: rgba(var(--theme-text-primary-rgb),.9); line-height: 1.28; }
.gb-rich-text :deep(h1) { font-size: 18px; }.gb-rich-text :deep(h2) { font-size: 16px; }.gb-rich-text :deep(h3), .gb-rich-text :deep(h4) { font-size: 14px; }
.gb-rich-text :deep(ul), .gb-rich-text :deep(ol) { margin: 0 0 9px; padding-left: 20px; }
.gb-rich-text :deep(blockquote) { padding: 7px 10px; border-left: 2px solid rgba(var(--theme-surface-tint-rgb),.56); background: rgba(255,255,255,.035); }
.gb-rich-text :deep(pre), .gb-rich-text :deep(code) { font-family: Consolas, 'Cascadia Code', monospace; }.gb-rich-text :deep(pre) { padding: 8px; overflow: auto; border-radius: 6px; background: rgba(0,0,0,.22); white-space: pre-wrap; }
.gb-rich-text :deep(a) { color: rgba(var(--theme-surface-tint-rgb),.95); text-decoration: underline; cursor: pointer; }.gb-rich-text :deep(img) { max-width: 100%; height: auto; border-radius: 6px; }
.gb-rich-text :deep(table) { width: 100%; margin: 0 0 9px; border-collapse: collapse; font-size: 11px; }.gb-rich-text :deep(th), .gb-rich-text :deep(td) { padding: 5px 6px; border: 1px solid rgba(255,255,255,.12); text-align: left; }.gb-rich-text :deep(th) { background: rgba(255,255,255,.06); }
.gb-rich-text :deep(p:hover), .gb-rich-text :deep(li:hover), .gb-rich-text :deep(blockquote:hover), .gb-rich-text :deep(pre:hover), .gb-rich-text :deep(td:hover), .gb-rich-text :deep(th:hover) { outline: 1px dashed rgba(var(--theme-surface-tint-rgb),.36); outline-offset: 3px; }
.gb-files { display: grid; gap: 6px; }
.gb-files h3 { color: rgba(var(--theme-text-primary-rgb), 0.8); font-size: 12px; }
.gb-install-group { display: flex; align-items: center; gap: 8px; color: rgba(var(--theme-text-secondary-rgb),.66); font-size: 10px; }.gb-install-group input { min-width: 0; flex: 1; height: 25px; padding: 0 8px; border: 1px solid rgba(255,255,255,.12); border-radius: 5px; background: rgba(0,0,0,.18); color: rgba(var(--theme-text-primary-rgb),.86); font: inherit; }
.gb-file { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; background: rgba(255,255,255,0.035); color: inherit; text-align: left; }
.gb-file:hover { background: rgba(var(--theme-surface-tint-rgb), 0.1); border-color: rgba(var(--theme-surface-tint-rgb), 0.25); }
.gb-file > span:first-child { display: grid; min-width: 0; gap: 2px; }
.gb-file strong { overflow: hidden; color: rgba(var(--theme-text-primary-rgb), 0.82); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.gb-file small { color: rgba(var(--theme-text-secondary-rgb), 0.56); font-size: 10px; }
.gb-file-actions { display: flex; flex: 0 0 auto; gap: 5px; }
.gb-file-action { min-height: 24px; padding: 0 6px; border: 1px solid rgba(var(--theme-surface-tint-rgb),.25); border-radius: 5px; background: rgba(var(--theme-surface-tint-rgb),.09); color: rgba(var(--theme-surface-tint-rgb), .95); font: inherit; font-size: 10px; cursor: pointer; }
.gb-file-action:disabled { opacity: .72; cursor: default; }
.gb-file-install-action { position: relative; isolation: isolate; min-width: 78px; overflow: hidden; }
.gb-file-install-action::before, .gb-file-install-action::after { position: absolute; inset: 0 auto 0 0; width: 0; content: ''; opacity: 0; transition: width .16s linear; }
.gb-file-install-action::before { z-index: 0; background: rgba(var(--theme-surface-tint-rgb),.045); }
.gb-file-install-action::after { z-index: 1; background: rgba(var(--theme-surface-tint-rgb),.09); }
.gb-file-install-action.is-progress { background: rgba(var(--theme-surface-tint-rgb),.009); }
.gb-file-install-action.is-progress::before { width: var(--gb-download-progress); opacity: 1; }
.gb-file-install-action.is-progress::after { width: var(--gb-install-progress); opacity: 1; }
.gb-file-install-action.is-downloaded { border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.09); color: rgba(var(--theme-text-secondary-rgb),.68); }
.gb-file-install-action > span { position: relative; z-index: 2; }
.gb-comments { display: grid; gap: 8px; padding-top: 3px; }.gb-comments-head { display: flex; align-items: center; justify-content: space-between; }.gb-comments h3 { margin: 0; color: rgba(var(--theme-text-primary-rgb),.84); font-size: 13px; }.gb-comments-empty { margin: 0; color: rgba(var(--theme-text-secondary-rgb),.56); font-size: 11px; }
.gb-comment-list { display: grid; gap: 7px; }.gb-comment { margin-left: calc(var(--comment-depth) * 11px); padding: 8px; border: 1px solid rgba(255,255,255,.07); border-radius: 7px; background: rgba(255,255,255,.025); }.gb-comment header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }.gb-comment header img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }.gb-comment time { margin-left: auto; color: rgba(var(--theme-text-secondary-rgb),.5); font-size: 10px; }.gb-comment-score { color: #a5eabf; font-size: 10px; }.gb-comment-body { color: rgba(var(--theme-text-primary-rgb),.72); font-size: 11px; line-height: 1.5; }.gb-comment-body :deep(p:last-child) { margin-bottom: 0; }.gb-comment-replies { margin-top: 5px; padding: 0; border: 0; background: none; color: rgba(var(--theme-surface-tint-rgb),.9); font: inherit; font-size: 10px; cursor: pointer; }.gb-comments-more { justify-self: start; }
:global(.gb-inline-translation) { display: grid; gap: 5px; margin: 7px 0 10px; padding: 8px 9px; border: 1px solid rgba(var(--theme-surface-tint-rgb),.36); border-radius: 7px; background: rgba(var(--theme-surface-tint-rgb),.1); color: rgba(var(--theme-text-primary-rgb),.83); }
:global(.gb-inline-translation-head) { display: flex; align-items: center; justify-content: space-between; color: rgba(var(--theme-surface-tint-rgb),.95); font-size: 10px; }
:global(.gb-inline-translation-head button) { width: 18px; height: 18px; border: 0; border-radius: 4px; background: rgba(0,0,0,.16); color: inherit; cursor: pointer; }
:global(.gb-inline-translation-content) { white-space: pre-wrap; font-size: 11px; line-height: 1.5; }
:global(.gb-inline-translation-content p) { margin: 0 0 7px; }
:global(.gb-inline-translation-content p:last-child) { margin-bottom: 0; }
:global(.gb-inline-translation-content ul), :global(.gb-inline-translation-content ol) { margin: 4px 0; padding-left: 18px; }
:global(.gb-inline-translation-content a) { color: inherit; text-decoration: underline; }
:global(.gb-inline-translation-content.is-loading) { display: flex; align-items: center; gap: 7px; color: rgba(var(--theme-text-secondary-rgb), .75); }
:global(.gb-translation-spinner) { width: 12px; height: 12px; flex: 0 0 auto; border: 2px solid rgba(var(--theme-surface-tint-rgb), .2); border-top-color: rgba(var(--theme-surface-tint-rgb), .95); border-radius: 50%; animation: gb-translation-spin .7s linear infinite; }
@keyframes gb-translation-spin { to { transform: rotate(360deg); } }
.gb-detail-actions { padding-top: 2px; }
.gb-empty { display: grid; flex: 1; place-items: center; padding: 24px; color: rgba(var(--theme-text-secondary-rgb), 0.58); font-size: 12px; text-align: center; }

:global(.gamebanana-select-popper.el-select__popper.el-popper) { overflow: hidden; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: #151923; box-shadow: 0 14px 32px rgba(0,0,0,.42); }
:global(.gamebanana-select-popper .el-select-dropdown__item) { color: rgba(255,255,255,.82); }
:global(.gamebanana-select-popper .el-select-dropdown__item:hover),
:global(.gamebanana-select-popper .el-select-dropdown__item.is-hovering) { background: rgba(var(--theme-surface-tint-rgb),.16); color: rgba(255,255,255,.96); }
:global(.gamebanana-select-popper .el-select-dropdown__item.is-selected) { background: rgba(var(--theme-surface-tint-rgb),.24); color: rgba(255,255,255,.98); }
:global(.gamebanana-select-popper .el-select-dropdown__empty) { color: rgba(255,255,255,.52); }

@media (max-width: 1040px) {
  .gb-layout { grid-template-columns: minmax(145px, .7fr) minmax(330px, 1.45fr); overflow: auto; }
  .gb-detail { min-height: 390px; grid-column: 1 / -1; }
}

@media (max-width: 720px) {
  .gamebanana-page { overflow: hidden; padding: 42px 10px 10px; }
  .gb-controls { align-items: end; flex-wrap: wrap; }
  .gb-search-field { flex-basis: 100%; }
  .gb-translation-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); }.gb-translation-settings-head { grid-column: 1 / -1; flex-direction: column; gap: 3px; }.gb-translation-url { min-width: 0; }
  .gb-layout { display: flex; flex-direction: column; overflow: auto; }
  .gb-categories { max-height: 190px; }
  .gb-results { min-height: 470px; }
  .gb-detail { min-height: 360px; }
}
</style>
