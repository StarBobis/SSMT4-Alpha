<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { AppStateManager } from '../../store/AppStateManager';

type GbImage = Record<string, unknown>;

interface GbSubmitter {
  _idRow?: number;
  _sName?: string;
  _sProfileUrl?: string;
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
}

interface GbIndexPayload {
  _aMetadata?: { _nRecordCount?: number; _bIsComplete?: boolean };
  _aRecords?: GbRecord[];
}

interface GbAuthorProfile {
  _idRow: number;
  _sName?: string;
  _sProfileUrl?: string;
  _sAvatarUrl?: string;
  _sUserTitle?: string;
  _sHonoraryTitle?: string;
  _sLocation?: string;
  _tsJoinDate?: number;
  _nSubscriberCount?: number;
  _nPostCount?: number;
}

interface AuthorModCard {
  id: number;
  title: string;
  profileUrl: string;
  description: string;
  thumbnailUrl: string;
  updatedAt: number;
  isNsfw: boolean;
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const appSettings = AppStateManager.appSettings;
const API_BASE = 'https://gamebanana.com/apiv11';

const profile = ref<GbAuthorProfile | null>(null);
const mods = ref<AuthorModCard[]>([]);
const page = ref(1);
const hasMore = ref(false);
const loadingProfile = ref(false);
const loadingMods = ref(false);
const errorMessage = ref('');
let profileRequestId = 0;
let modsRequestId = 0;

const authorId = computed(() => {
  const value = Number(route.params.authorId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
});
const visibleMods = computed(() => appSettings.gamebananaNsfwMode === 'hide'
  ? mods.value.filter((item) => !item.isNsfw)
  : mods.value);

const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const asNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const toPlainText = (value: unknown): string => asString(value)
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ')
  .trim();

const imageUrl = (image: GbImage): string => {
  for (const key of ['_sUrl530', '_sUrl220', '_sUrl100', '_sUrl']) {
    const url = asString(image[key]);
    if (url) return url;
  }
  const baseUrl = asString(image._sBaseUrl) || 'https://images.gamebanana.com/img/ss/mods';
  for (const key of ['_sFile530', '_sFile220', '_sFile100', '_sFile']) {
    const file = asString(image[key]);
    if (file) return `${baseUrl.replace(/\/$/, '')}/${file.replace(/^\//, '')}`;
  }
  return '';
};

const apiGet = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}?${new URLSearchParams(params).toString()}`, { method: 'GET' });
  if (!response.ok) throw new Error(`GameBanana HTTP ${response.status}`);
  return await response.json() as T;
};

const cardFromRecord = (record: GbRecord): AuthorModCard => ({
  id: record._idRow,
  title: asString(record._sName) || `Mod #${record._idRow}`,
  profileUrl: asString(record._sProfileUrl) || `https://gamebanana.com/mods/${record._idRow}`,
  description: toPlainText(record._sDescription),
  thumbnailUrl: (record._aPreviewMedia?._aImages || []).map(imageUrl).find(Boolean) || '',
  updatedAt: asNumber(record._tsDateUpdated || record._tsDateModified),
  isNsfw: record._bIsNsfw === true || record._bHasContentRatings === true,
});

const formatDate = (timestamp: number): string => timestamp ? new Date(timestamp * 1000).toLocaleDateString() : '—';
const formatNumber = (value: number): string => new Intl.NumberFormat().format(value || 0);

const openExternal = async (url: string) => {
  if (!url) return;
  try {
    await openUrl(url);
  } catch (error) {
    ElMessage.error(t('gameBanana.errors.openExternal', { error: String(error) }));
  }
};

const loadAuthor = async () => {
  const id = authorId.value;
  if (!id) {
    errorMessage.value = t('gameBanana.authorInvalid');
    return;
  }
  const currentRequest = ++profileRequestId;
  loadingProfile.value = true;
  errorMessage.value = '';
  try {
    const result = await apiGet<GbAuthorProfile>(`/Member/${id}/ProfilePage`);
    if (currentRequest === profileRequestId) profile.value = result;
  } catch (error) {
    if (currentRequest === profileRequestId) errorMessage.value = t('gameBanana.errors.loadAuthor', { error: String(error) });
  } finally {
    if (currentRequest === profileRequestId) loadingProfile.value = false;
  }
};

const loadMods = async (requestedPage = 1) => {
  const id = authorId.value;
  if (!id) return;
  const currentRequest = ++modsRequestId;
  page.value = Math.max(1, requestedPage);
  loadingMods.value = true;
  try {
    const payload = await apiGet<GbIndexPayload>('/Mod/Index', {
      _nPage: String(page.value),
      _nPerpage: '24',
      _sOrderBy: '_tsDateUpdated,DESC',
      '_aFilters[Generic_Submitter]': String(id),
    });
    if (currentRequest !== modsRequestId) return;
    mods.value = (payload._aRecords || []).map(cardFromRecord);
    hasMore.value = !payload._aMetadata?._bIsComplete && mods.value.length >= 24;
  } catch (error) {
    if (currentRequest === modsRequestId) errorMessage.value = t('gameBanana.errors.loadAuthorMods', { error: String(error) });
  } finally {
    if (currentRequest === modsRequestId) loadingMods.value = false;
  }
};

const refresh = async () => {
  await Promise.all([loadAuthor(), loadMods(1)]);
};

watch(authorId, () => { void refresh(); });
onMounted(() => { void refresh(); });
</script>

<template>
  <div class="page-container gb-author-page">
    <section class="gb-author-toolbar glass-panel">
      <button type="button" class="gb-button" @click="router.push({ name: 'GameBanana' })">{{ t('gameBanana.backToCatalog') }}</button>
      <span class="gb-author-toolbar-title">{{ t('gameBanana.authorPage') }}</span>
      <el-radio-group v-model="appSettings.gamebananaNsfwMode" size="small">
        <el-radio-button value="show">{{ t('gameBanana.nsfwShow') }}</el-radio-button>
        <el-radio-button value="blur">{{ t('gameBanana.nsfwBlur') }}</el-radio-button>
        <el-radio-button value="hide">{{ t('gameBanana.nsfwHide') }}</el-radio-button>
      </el-radio-group>
      <button type="button" class="gb-button" :disabled="loadingProfile || loadingMods" @click="refresh">{{ t('gameBanana.refresh') }}</button>
    </section>

    <p v-if="errorMessage" class="gb-author-error">{{ errorMessage }}</p>
    <main class="gb-author-layout">
      <section class="gb-author-profile glass-panel">
        <div v-if="loadingProfile" class="gb-empty">{{ t('gameBanana.loading') }}</div>
        <template v-else-if="profile">
          <img v-if="profile._sAvatarUrl" class="gb-author-avatar" :src="profile._sAvatarUrl" :alt="profile._sName" />
          <div class="gb-author-profile-copy">
            <h1>{{ profile._sName || `#${profile._idRow}` }}</h1>
            <p v-if="profile._sUserTitle || profile._sHonoraryTitle">{{ profile._sUserTitle || profile._sHonoraryTitle }}</p>
            <p v-if="profile._sLocation">{{ toPlainText(profile._sLocation) }}</p>
            <div class="gb-author-stats">
              <span>{{ t('gameBanana.subscribers') }}<strong>{{ formatNumber(asNumber(profile._nSubscriberCount)) }}</strong></span>
              <span>{{ t('gameBanana.posts') }}<strong>{{ formatNumber(asNumber(profile._nPostCount)) }}</strong></span>
              <span>{{ t('gameBanana.joined') }}<strong>{{ formatDate(asNumber(profile._tsJoinDate)) }}</strong></span>
            </div>
            <button type="button" class="gb-button gb-button--primary" @click="openExternal(profile._sProfileUrl || '')">{{ t('gameBanana.openAuthorPage') }}</button>
          </div>
        </template>
      </section>

      <section class="gb-author-mods glass-panel">
        <header><strong>{{ t('gameBanana.authorMods') }}</strong><span>{{ visibleMods.length }}</span></header>
        <div v-if="loadingMods" class="gb-empty">{{ t('gameBanana.loading') }}</div>
        <div v-else-if="visibleMods.length" class="gb-author-mod-grid">
          <button v-for="mod in visibleMods" :key="mod.id" type="button" class="gb-author-card" @click="openExternal(mod.profileUrl)">
            <div class="gb-author-thumb" :class="{ 'is-nsfw-blurred': appSettings.gamebananaNsfwMode === 'blur' && mod.isNsfw }">
              <img v-if="mod.thumbnailUrl" :src="mod.thumbnailUrl" :alt="mod.title" loading="lazy" />
              <span v-else>{{ mod.title.slice(0, 1) }}</span>
              <b v-if="mod.isNsfw">NSFW</b>
            </div>
            <strong>{{ mod.title }}</strong>
            <p>{{ mod.description || t('gameBanana.noDescription') }}</p>
            <time>{{ formatDate(mod.updatedAt) }}</time>
          </button>
        </div>
        <div v-else class="gb-empty">{{ t('gameBanana.empty') }}</div>
        <footer>
          <button type="button" class="gb-button" :disabled="page <= 1 || loadingMods" @click="loadMods(page - 1)">{{ t('gameBanana.previous') }}</button>
          <span>{{ t('gameBanana.page', { current: page }) }}</span>
          <button type="button" class="gb-button" :disabled="!hasMore || loadingMods" @click="loadMods(page + 1)">{{ t('gameBanana.next') }}</button>
        </footer>
      </section>
    </main>
  </div>
</template>

<style scoped>
.gb-author-page { height: 100%; min-height: 0; box-sizing:border-box; display: flex; flex-direction: column; gap: 12px; overflow:hidden; padding: 46px 18px 18px; color: rgba(var(--theme-text-primary-rgb),.9); }
.glass-panel { background: linear-gradient(145deg,rgba(18,21,31,.76),rgba(9,11,17,.64)); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 14px 36px rgba(0,0,0,.16),inset 0 1px rgba(255,255,255,.05); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.gb-author-toolbar { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: 12px; }.gb-author-toolbar-title { flex: 1; color: rgba(var(--theme-text-primary-rgb),.9); font-size: 14px; font-weight: 700; }.gb-author-toolbar :deep(.el-radio-button__inner) { padding: 7px 8px; border-color: rgba(255,255,255,.14); background: rgba(0,0,0,.16); color: rgba(var(--theme-text-primary-rgb),.7); font-size: 11px; box-shadow: none; }.gb-author-toolbar :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) { background: rgba(var(--theme-surface-tint-rgb),.19); border-color: rgba(var(--theme-surface-tint-rgb),.48); color: rgba(var(--theme-text-primary-rgb),.95); }
.gb-button { min-height: 30px; padding: 0 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 7px; background: rgba(255,255,255,.055); color: rgba(var(--theme-text-primary-rgb),.86); font: inherit; font-size: 12px; cursor: pointer; }.gb-button:hover:not(:disabled) { background: rgba(var(--theme-surface-tint-rgb),.16); border-color: rgba(var(--theme-surface-tint-rgb),.38); }.gb-button:disabled { opacity: .45; cursor: default; }.gb-button--primary { background: rgba(var(--theme-surface-tint-rgb),.2); border-color: rgba(var(--theme-surface-tint-rgb),.42); }
.gb-author-error { margin: -4px 1px 0; color:#ffabab; font-size:12px; }.gb-author-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(245px,.85fr) minmax(0,2fr); gap:12px; overflow:hidden; }.gb-author-profile,.gb-author-mods { min-height:0; border-radius:12px; overflow:auto; }.gb-author-profile { display:flex; align-items:flex-start; gap:14px; padding:18px; }.gb-author-avatar { width:76px; height:76px; flex:0 0 auto; border-radius:50%; object-fit:cover; border:1px solid rgba(var(--theme-surface-tint-rgb),.35); }.gb-author-profile-copy { display:grid; gap:7px; min-width:0; }.gb-author-profile-copy h1,.gb-author-profile-copy p { margin:0; }.gb-author-profile-copy h1 { font-size:19px; }.gb-author-profile-copy p { color:rgba(var(--theme-text-secondary-rgb),.65); font-size:12px; line-height:1.4; }.gb-author-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }.gb-author-stats span { display:grid; gap:2px; padding:6px; border-radius:6px; background:rgba(255,255,255,.045); color:rgba(var(--theme-text-secondary-rgb),.58); font-size:10px; }.gb-author-stats strong { color:rgba(var(--theme-text-primary-rgb),.88); font-size:12px; }
.gb-author-mods { display:flex; flex-direction:column; }.gb-author-mods>header,.gb-author-mods>footer { display:flex; align-items:center; justify-content:space-between; gap:8px; flex:0 0 auto; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.07); font-size:12px; }.gb-author-mods>header span,.gb-author-mods>footer span { color:rgba(var(--theme-text-secondary-rgb),.58); font-size:11px; }.gb-author-mods>footer { border-top:1px solid rgba(255,255,255,.07); border-bottom:0; justify-content:flex-end; }.gb-author-mod-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(175px,1fr)); gap:9px; padding:10px; overflow:auto; }.gb-author-card { min-width:0; padding:7px; border:1px solid rgba(255,255,255,.07); border-radius:8px; background:rgba(255,255,255,.025); color:inherit; text-align:left; cursor:pointer; }.gb-author-card:hover { border-color:rgba(var(--theme-surface-tint-rgb),.35); background:rgba(var(--theme-surface-tint-rgb),.08); }.gb-author-thumb { position:relative; display:grid; place-items:center; aspect-ratio:16/9; overflow:hidden; margin-bottom:7px; border-radius:5px; background:rgba(0,0,0,.22); color:rgba(var(--theme-surface-tint-rgb),.7); font-size:22px; font-weight:800; }.gb-author-thumb img { width:100%; height:100%; object-fit:cover; }.gb-author-thumb b { position:absolute; top:4px; right:4px; padding:2px 4px; border-radius:4px; background:rgba(138,27,58,.84); color:#fff; font-size:9px; }.gb-author-thumb.is-nsfw-blurred img { filter:blur(18px) saturate(.75); transform:scale(1.16); }.gb-author-thumb.is-nsfw-blurred::after { content:'NSFW'; position:absolute; inset:0; display:grid; place-items:center; background:rgba(8,9,14,.26); color:#fff; font-size:10px; font-weight:800; letter-spacing:.14em; text-shadow:0 1px 6px rgba(0,0,0,.9); }.gb-author-card>strong { display:block; overflow:hidden; color:rgba(var(--theme-text-primary-rgb),.88); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }.gb-author-card p { display:-webkit-box; min-height:30px; margin:4px 0; overflow:hidden; color:rgba(var(--theme-text-secondary-rgb),.62); font-size:10px; line-height:1.45; -webkit-box-orient:vertical; -webkit-line-clamp:2; }.gb-author-card time { color:rgba(var(--theme-text-secondary-rgb),.5); font-size:10px; }.gb-empty { display:grid; flex:1; place-items:center; padding:24px; color:rgba(var(--theme-text-secondary-rgb),.58); font-size:12px; text-align:center; }
@media (max-width:720px) { .gb-author-page { overflow:hidden; padding:42px 10px 10px; }.gb-author-toolbar { flex-wrap:wrap; }.gb-author-toolbar-title { min-width:100%; order:-1; }.gb-author-layout { display:flex; flex-direction:column; overflow:auto; }.gb-author-profile { min-height:170px; }.gb-author-mods { min-height:450px; } }
</style>
