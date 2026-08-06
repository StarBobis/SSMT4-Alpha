<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { ArrowRight, Folder, FolderAdd, Edit, Plus, Delete, Picture, Download } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import { calculateContextMenuPosition } from '../../utils/ContextMenuPosition';
import type { GroupInfo, ModInfo } from './ModsManagement.types';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  target: ModInfo | null;
  groups: GroupInfo[];
}>();

const emit = defineEmits<{
  close: [];
  'open-mod-folder': [path: string];
  'move-mod-to-group': [mod: ModInfo, groupId: string];
  'create-new-group': [];
  'rename-mod': [mod: ModInfo];
  'export-mod-archive': [mod: ModInfo];
  'open-mod-tag-dialog': [mod: ModInfo];
  'add-preview-images': [mod: ModInfo];
  'paste-clipboard-preview-image': [mod: ModInfo];
  'delete-mod': [mod: ModInfo];
  'enable-mod-solo': [mod: ModInfo];
}>();

const { t } = useI18n();
const contextMenuRef = ref<HTMLElement | null>(null);
const moveSubmenuTriggerRef = ref<HTMLElement | null>(null);
const moveSubmenuRef = ref<HTMLElement | null>(null);

const internalX = ref(props.x);
const internalY = ref(props.y);
const submenuOpensLeft = ref(false);
const submenuTopOffset = ref(0);
const submenuMaxHeight = ref('');

const adjustSubmenuPosition = () => {
  const triggerEl = moveSubmenuTriggerRef.value;
  const submenuEl = moveSubmenuRef.value;
  if (!triggerEl || !submenuEl) return;

  const edgeGap = 8;
  const submenuGap = 4;
  const triggerRect = triggerEl.getBoundingClientRect();
  const submenuRect = submenuEl.getBoundingClientRect();
  const submenuWidth = submenuRect.width || 260;
  const submenuHeight = submenuRect.height || 0;
  const rightSpace = window.innerWidth - triggerRect.right - submenuGap;
  const leftSpace = triggerRect.left - submenuGap;

  submenuOpensLeft.value = rightSpace < submenuWidth + edgeGap && leftSpace > rightSpace;

  const desiredBottom = triggerRect.top + submenuHeight;
  const overflowBottom = desiredBottom - (window.innerHeight - edgeGap);
  const overflowTop = edgeGap - triggerRect.top;
  const nextTopOffset = overflowBottom > 0 ? -overflowBottom : 0;
  submenuTopOffset.value = Math.max(overflowTop, nextTopOffset);
  submenuMaxHeight.value = `${Math.max(160, window.innerHeight - edgeGap * 2)}px`;
};

const adjustPosition = () => {
  const menuEl = contextMenuRef.value;
  if (!menuEl) return;

  const menuRect = menuEl.getBoundingClientRect();
  const pos = calculateContextMenuPosition({
    clientX: props.x,
    clientY: props.y,
    menuWidth: menuRect.width,
    menuHeight: menuRect.height,
  });

  internalX.value = pos.x;
  internalY.value = pos.y;
  nextTick(() => adjustSubmenuPosition());
};

watch(() => props.visible, (newVal) => {
  if (newVal) {
    internalX.value = props.x;
    internalY.value = props.y;
    nextTick(() => adjustPosition());
  }
});
</script>

<template>
  <div
    v-if="visible"
    ref="contextMenuRef"
    class="custom-context-menu context-menu-root context-menu-surface"
    :style="{ top: internalY + 'px', left: internalX + 'px' }"
    @click.stop
  >
    <div v-if="target" class="menu-content">
      <div class="menu-item" @click="emit('close'); emit('open-mod-folder', (target as ModInfo).path)">
        <el-icon><Folder /></el-icon>
        <span>{{ t('modsManagement.ui.openFolder') }}</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="emit('close'); emit('enable-mod-solo', target as ModInfo)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span>{{ t('modsManagement.actions.enableModSolo') }}</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="emit('close'); emit('rename-mod', target as ModInfo)">
        <el-icon><Edit /></el-icon>
        <span>{{ t('modsManagement.actions.renameThisMod') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('export-mod-archive', target as ModInfo)">
        <el-icon><Download /></el-icon>
        <span>{{ t('modsManagement.actions.exportArchive') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('open-mod-tag-dialog', target as ModInfo)">
        <el-icon><Plus /></el-icon>
        <span>{{ t('modsManagement.actions.editModTags') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('add-preview-images', target as ModInfo)">
        <el-icon><Picture /></el-icon>
        <span>{{ t('modsManagement.actions.addPreviewImages') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('paste-clipboard-preview-image', target as ModInfo)">
        <el-icon><Picture /></el-icon>
        <span>{{ t('modsManagement.actions.pasteClipboardAsPreviewImage') }}</span>
      </div>
      <div class="menu-divider"></div>
      <div
        ref="moveSubmenuTriggerRef"
        class="menu-item has-submenu"
        :class="{ 'is-submenu-left': submenuOpensLeft }"
        @mouseenter="adjustSubmenuPosition"
      >
        <el-icon><FolderAdd /></el-icon>
        <span>{{ t('modsManagement.actions.moveTo') }}</span>
        <el-icon class="arrow-right"><ArrowRight /></el-icon>

        <div
          ref="moveSubmenuRef"
          class="submenu context-menu-surface"
          :class="{ 'is-left': submenuOpensLeft }"
          :style="{ top: `${submenuTopOffset}px`, maxHeight: submenuMaxHeight }"
        >
          <div class="menu-item" @click="emit('close'); emit('move-mod-to-group', target as ModInfo, 'Root')">
            <span>{{ t('modsManagement.actions.moveToModsRoot') }}</span>
          </div>
          <div
            v-for="group in groups.filter((g: GroupInfo) => g.id !== 'All' && g.id !== 'Root')"
            :key="group.id"
            class="menu-item"
            @click="emit('close'); emit('move-mod-to-group', target as ModInfo, group.id)"
          >
            <span>{{ group.id }}</span>
          </div>
          <div class="menu-divider"></div>
          <div class="menu-item" @click="emit('close'); emit('create-new-group')">
            <el-icon><Plus /></el-icon>
            <span>{{ t('modsManagement.actions.createCategory') }}</span>
          </div>
        </div>
      </div>
      <div class="menu-item menu-item--danger" @click="emit('close'); emit('delete-mod', target as ModInfo)">
        <el-icon><Delete /></el-icon>
        <span>{{ t('modsManagement.common.delete') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped src="./ContextMenu.shared.css"></style>

<style scoped>
.has-submenu .submenu {
  position: absolute;
  left: 100%;
  top: 0;
  margin-left: 4px;
  min-width: 260px;
  max-width: min(420px, calc(100vw - 40px));
  opacity: 0;
  visibility: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  transition:
    opacity 0.12s ease 0.18s,
    visibility 0s linear 0.18s;
}

.has-submenu .submenu.is-left {
  left: auto;
  right: 100%;
  margin-left: 0;
  margin-right: 4px;
}

.has-submenu::after {
  content: '';
  position: absolute;
  top: -8px;
  left: 100%;
  width: 14px;
  height: calc(100% + 16px);
}

.has-submenu.is-submenu-left::after {
  left: auto;
  right: 100%;
}

.has-submenu:hover .submenu,
.has-submenu .submenu:hover {
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}

.has-submenu .submenu .menu-item {
  white-space: nowrap;
}

.has-submenu .submenu .menu-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arrow-right {
  margin-left: auto;
  font-size: 0.8em;
  opacity: 0.7;
}
</style>
