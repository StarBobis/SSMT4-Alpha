<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fetch } from '@tauri-apps/plugin-http';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { GroupInfo } from './ModsManagement.types';

type OpenMode = 'auto' | 'manual';
interface CategoryNode { id: number; name: string; iconUrl: string; categoryCount: number; children?: CategoryNode[] }

const props = defineProps<{ visible: boolean; group: GroupInfo | null; gameName: string; mode: OpenMode }>();
const emit = defineEmits<{ close: []; apply: [group: GroupInfo, iconPath: string] }>();
const { t } = useI18n();
const roots = ref<CategoryNode[]>([]);
const selected = ref<CategoryNode | null>(null);
const candidate = ref<CategoryNode | null>(null);
const loading = ref(false);
const applying = ref(false);
const treeVersion = ref(0);

const GAME_IDS: Record<string, number> = {
  GIMI: 8552, WWMI: 20357, SRMI: 18366, ZZMI: 19567, HIMI: 10349,
  EFMI: 21842, NTEMI: 23012, APMI: 21772, IDENTITYV: 19670,
  SNOWBREAK: 19719, NARAKA: 17843, GF2: 19494,
};
const gameId = computed(() => {
  const stored = Number(localStorage.getItem(`gamebanana:game-id:${props.gameName || 'default'}`));
  return Number.isInteger(stored) && stored > 0 ? stored : (GAME_IDS[props.gameName.trim().toUpperCase()] || 0);
});
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const number = (value: unknown) => Number(value) || 0;
const categoryId = (item: Record<string, unknown>) => number(item._idRow) || number(text(item._sUrl).match(/\/cats\/(\d+)/)?.[1]);
const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s_.\-()[\]{}]+/g, '');
const mapCategory = (value: unknown): CategoryNode => {
  const item = record(value);
  return { id: categoryId(item), name: text(item._sName), iconUrl: text(item._sIconUrl), categoryCount: item._nCategoryCount === undefined ? -1 : number(item._nCategoryCount) };
};
const request = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`GameBanana HTTP ${response.status}`);
  return response.json();
};
const fetchRoots = async () => {
  if (!gameId.value) throw new Error(t('modsManagement.messages.gameBananaGameIdMissing'));
  const data = await request(`https://gamebanana.com/apiv11/Mod/Categories?_idGameRow=${gameId.value}&_sSort=a_to_z&_bShowEmpty=true`);
  return (Array.isArray(data) ? data : []).map(mapCategory).filter((item) => item.id > 0 && item.name);
};
const fetchChildren = async (id: number) => {
  const data = await request(`https://gamebanana.com/apiv11/ModCategory/${id}/SubCategories`);
  return (Array.isArray(data) ? data : []).map(mapCategory).filter((item) => item.id > 0 && item.name);
};
const loadNode = async (node: any, resolve: (items: CategoryNode[]) => void) => {
  try {
    if (node.level === 0) return resolve(roots.value);
    const item = node.data;
    if (!item || item.categoryCount === 0) return resolve([]);
    const children = await fetchChildren(item.id);
    item.children = children;
    resolve(children);
  } catch (error) {
    ElMessage.error(String(error));
    resolve([]);
  }
};
const findAutomaticMatch = async () => {
  if (!props.group) return;
  loading.value = true;
  candidate.value = null;
  try {
    const target = normalize(props.group.name || props.group.id.split('/').pop() || '');
    let frontier = [...roots.value];
    let best: CategoryNode | null = null;
    let visited = 0;
    for (let depth = 0; depth < 6 && frontier.length && visited < 400; depth += 1) {
      visited += frontier.length;
      const exact = frontier.find((item) => normalize(item.name) === target);
      if (exact) { best = exact; break; }
      best ||= frontier.find((item) => normalize(item.name).includes(target) || target.includes(normalize(item.name))) || null;
      const expandable = frontier.filter((item) => item.categoryCount !== 0);
      const nested = await Promise.all(expandable.map(async (item) => {
        const children = item.children || await fetchChildren(item.id);
        item.children = children;
        return children;
      }));
      frontier = nested.flat();
    }
    candidate.value = best;
    selected.value = best;
    if (!best) ElMessage.warning(t('modsManagement.messages.noGameBananaCategoryMatch'));
  } catch (error) {
    ElMessage.error(String(error));
  } finally { loading.value = false; }
};
const cacheIcon = async (item: CategoryNode) => {
  if (!item.iconUrl) throw new Error(t('modsManagement.messages.gameBananaCategoryHasNoIcon'));
  const dir = await join(await appDataDir(), 'gamebanana-category-icons');
  const path = await join(dir, `category-${item.id}.png`);
  if (!(await exists(path))) {
    const response = await fetch(item.iconUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`GameBanana icon HTTP ${response.status}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
  return path;
};
const applySelected = async () => {
  if (!props.group || !selected.value) return;
  applying.value = true;
  try { emit('apply', props.group, await cacheIcon(selected.value)); }
  catch (error) { ElMessage.error(String(error)); }
  finally { applying.value = false; }
};
watch(() => [props.visible, props.gameName, props.mode] as const, async ([visible]) => {
  if (!visible) return;
  selected.value = null; candidate.value = null; loading.value = true;
  try {
    roots.value = await fetchRoots();
    treeVersion.value += 1;
    if (props.mode === 'auto') await findAutomaticMatch();
  } catch (error) { ElMessage.error(String(error)); }
  finally { loading.value = false; }
});
</script>

<template>
  <el-dialog :model-value="visible" :title="t('modsManagement.dialog.gameBananaCategoryIconTitle')" width="560px" @close="emit('close')">
    <p class="gb-icon-hint">{{ t(mode === 'auto' ? 'modsManagement.ui.gameBananaAutoMatchHint' : 'modsManagement.ui.gameBananaManualMatchHint') }}</p>
    <div v-if="mode === 'auto'" v-loading="loading" class="gb-icon-candidate">
      <template v-if="candidate">
        <img v-if="candidate.iconUrl" :src="candidate.iconUrl" />
        <div><strong>{{ candidate.name }}</strong><small>GameBanana #{{ candidate.id }}</small></div>
      </template>
      <el-empty v-else :description="t('modsManagement.messages.noGameBananaCategoryMatch')" :image-size="52" />
    </div>
    <el-tree
      :key="treeVersion"
      v-else
      v-loading="loading"
      class="gb-category-tree"
      node-key="id"
      lazy
      :load="loadNode"
      :props="{ label: 'name', children: 'children', isLeaf: (data: any) => data.categoryCount === 0 }"
      highlight-current
      @current-change="(item: CategoryNode) => selected = item"
    >
      <template #default="{ data }"><span class="gb-tree-row"><img v-if="data.iconUrl" :src="data.iconUrl" /><span>{{ data.name }}</span></span></template>
    </el-tree>
    <template #footer>
      <el-button @click="emit('close')">{{ t('modsManagement.common.cancel') }}</el-button>
      <el-button v-if="mode === 'auto'" :loading="loading" @click="findAutomaticMatch">{{ t('modsManagement.actions.retryAutoMatch') }}</el-button>
      <el-button type="primary" :disabled="!selected" :loading="applying" @click="applySelected">{{ t('modsManagement.actions.keepGameBananaIcon') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.gb-icon-hint{margin:0 0 12px;color:rgba(var(--theme-text-secondary-rgb),.72);font-size:12px;line-height:1.5}.gb-icon-candidate{display:flex;align-items:center;justify-content:center;min-height:120px;gap:14px;border:1px solid rgba(var(--theme-surface-tint-rgb),.15);border-radius:10px;background:rgba(var(--theme-surface-tint-rgb),.04)}.gb-icon-candidate img{width:64px;height:64px;object-fit:contain}.gb-icon-candidate div{display:grid;gap:5px}.gb-icon-candidate small{color:rgba(var(--theme-text-secondary-rgb),.65)}.gb-category-tree{height:360px;overflow:auto;border:1px solid rgba(var(--theme-surface-tint-rgb),.14);border-radius:9px;padding:6px;background:rgba(var(--theme-surface-tint-rgb),.03)}.gb-tree-row{display:flex;align-items:center;gap:8px}.gb-tree-row img{width:22px;height:22px;object-fit:contain}
</style>
