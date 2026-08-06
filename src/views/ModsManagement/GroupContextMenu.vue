<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { Folder, Edit, Plus, Delete, View, Hide, Picture } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import { calculateContextMenuPosition } from '../../utils/ContextMenuPosition';
import type { GroupInfo } from './ModsManagement.types';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  target: GroupInfo | null;
}>();

const emit = defineEmits<{
  close: [];
  'toggle-group': [group: GroupInfo];
  'open-mod-group-folder': [group: GroupInfo];
  'open-sub-group-dialog': [group: GroupInfo];
  'set-group-icon': [group: GroupInfo];
  'rename-group': [group: GroupInfo];
  'delete-group': [group: GroupInfo];
  'edit-group-tags': [group: GroupInfo];
  'convert-group-to-mod': [group: GroupInfo];
}>();

const { t } = useI18n();
const menuRef = ref<HTMLElement | null>(null);

const internalX = ref(props.x);
const internalY = ref(props.y);

const adjustPosition = () => {
  const menuEl = menuRef.value;
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
    v-if="visible && target"
    ref="menuRef"
    class="group-context-menu context-menu-root context-menu-surface"
    :style="{ top: internalY + 'px', left: internalX + 'px' }"
    @click.stop
  >
    <div class="menu-content">
      <div class="menu-item" @click="emit('close'); emit('toggle-group', target)">
        <el-icon v-if="target.enabled"><Hide /></el-icon>
        <el-icon v-else><View /></el-icon>
        <span>{{ t(target.enabled ? 'modsManagement.actions.disableThisCategory' : 'modsManagement.actions.enableThisCategory') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('open-mod-group-folder', target)">
        <el-icon><Folder /></el-icon>
        <span>{{ t('modsManagement.ui.openFolder') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('open-sub-group-dialog', target)">
        <el-icon><Plus /></el-icon>
        <span>{{ t('modsManagement.actions.createSubcategory') }}</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="emit('close'); emit('set-group-icon', target)">
        <el-icon><Picture /></el-icon>
        <span>{{ t('modsManagement.actions.setIcon') }}</span>
      </div>
      <div class="menu-item" @click="emit('close'); emit('rename-group', target)">
        <el-icon><Edit /></el-icon>
        <span>{{ t('modsManagement.actions.rename') }}</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="emit('close'); emit('edit-group-tags', target)">
        <el-icon><Plus /></el-icon>
        <span>{{ t('modsManagement.actions.editModTags') }}</span>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="emit('close'); emit('convert-group-to-mod', target)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
        <span>{{ t('modsManagement.actions.convertCategoryToMod') }}</span>
      </div>
      <div class="menu-item menu-item--danger" @click="emit('close'); emit('delete-group', target)">
        <el-icon><Delete /></el-icon>
        <span>{{ t('modsManagement.common.delete') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped src="./ContextMenu.shared.css"></style>
