<script setup lang="ts">
import { FolderOpened, Download, ArrowUp, ArrowDown, Delete } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import type { ModelRow } from './WorkPage.types';
import type { FullExtractDataTypeFilter } from './WorkPage.Extract';

const { t } = useI18n();

const selectedFrameAnalysis = defineModel<string>('selectedFrameAnalysis', { default: '' });
const frameAnalysisFolderPath = defineModel<string>('frameAnalysisFolderPath', { default: '' });
const extractPanelTab = defineModel<string>('extractPanelTab', { default: 'drawib' });
const modelRows = defineModel<ModelRow[]>('modelRows', { required: true });
const convertRgbaChannelTextures = defineModel<boolean>('convertRgbaChannelTextures', { default: true });
const fullExtractDataTypeFilter = defineModel<FullExtractDataTypeFilter>('fullExtractDataTypeFilter', { default: 'all' });

defineProps<{
  frameAnalysisOptions: string[];
  isRefreshing: boolean;
  isFrameAnalysisPathInvalid: boolean;
  isExtracting: boolean;
  fullExtractDataTypeFilterOptions: Array<{ value: FullExtractDataTypeFilter; labelKey: string }>;
}>();

const emit = defineEmits<{
  refresh: [];
  selectLatest: [];
  pickFolder: [];
  openFolder: [];
  dropFolder: [event: DragEvent];
  selectFrameAnalysisOption: [item: string];
  moveModelRow: [index: number, direction: 'up' | 'down'];
  removeModelRow: [index: number];
  extractModels: [];
  fullExtract: [];
}>();
</script>

<template>
  <section class="inner-panel extract-panel">
    <div class="controls-row">
      <el-select
        v-model="selectedFrameAnalysis"
        class="fa-select"
        :placeholder="t('workPage.ui.selectFrameAnalysisFolder')"
        filterable
        clearable
      >
        <el-option
          v-for="item in frameAnalysisOptions"
          :key="item"
          :label="item"
          :value="item"
          @click="emit('selectFrameAnalysisOption', item)"
        />
        <template #empty>
          <span class="empty-placeholder">{{ t('workPage.ui.clickRefreshToSync') }}</span>
        </template>
      </el-select>

      <el-button :loading="isRefreshing" plain @click="emit('refresh')">
        <el-icon><RefreshRight /></el-icon>
        {{ t('workPage.actions.refresh') }}
      </el-button>

      <el-button @click="emit('selectLatest')">
        {{ t('workPage.actions.useLatestFrameAnalysisFolder') }}
      </el-button>
    </div>

    <div class="controls-row fa-path-row">
      <div class="fa-path-drop-zone" @dragover.prevent @drop.prevent="emit('dropFolder', $event)">
        <el-input
          v-model="frameAnalysisFolderPath"
          :class="{ 'frame-path-invalid': isFrameAnalysisPathInvalid }"
          :placeholder="t('workPage.ui.fullFrameAnalysisPathPlaceholder')"
          clearable
        />
      </div>
      <el-button plain @click="emit('pickFolder')">
        <el-icon><FolderOpened /></el-icon>
        {{ t('workPage.actions.selectFolder') }}
      </el-button>
      <el-button plain @click="emit('openFolder')">
        <el-icon><FolderOpened /></el-icon>
        {{ t('workPage.actions.open') }}
      </el-button>
    </div>
  </section>

  <section class="inner-panel extract-tabs-panel">
    <el-tabs v-model="extractPanelTab" class="extract-tabs">
      <el-tab-pane :label="t('workPage.tabs.extractByDrawIB')" name="drawib">
        <div class="table-row">
          <el-table :data="modelRows" border size="small" class="model-table glass-table">
            <el-table-column :label="t('workPage.columns.drawIB')" width="220">
              <template #default="{ $index }">
                <el-input
                  v-model="modelRows[$index].drawIB"
                  :placeholder="t('workPage.placeholders.enterDrawIB')"
                />
              </template>
            </el-table-column>
            <el-table-column :label="t('workPage.columns.aliasName')">
              <template #default="{ $index }">
                <el-input
                  v-model="modelRows[$index].aliasName"
                  :placeholder="t('workPage.placeholders.enterAlias')"
                />
              </template>
            </el-table-column>
            <el-table-column :label="t('workPage.columns.order')" width="66" align="center">
              <template #default="{ $index }">
                <div class="row-move-actions">
                  <el-button
                    size="small"
                    class="row-move-btn"
                    :icon="ArrowUp"
                    :disabled="$index === 0"
                    @click="emit('moveModelRow', $index, 'up')"
                  />
                  <el-button
                    size="small"
                    class="row-move-btn"
                    :icon="ArrowDown"
                    :disabled="$index === modelRows.length - 1"
                    @click="emit('moveModelRow', $index, 'down')"
                  />
                </div>
              </template>
            </el-table-column>
            <el-table-column width="56" align="center">
              <template #default="{ $index }">
                <el-tooltip :content="t('workPage.common.delete')" placement="left">
                  <button
                    type="button"
                    class="config-row-delete-btn"
                    @click.stop="emit('removeModelRow', $index)"
                  >
                    <el-icon><Delete /></el-icon>
                  </button>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="extract-option-row">
          <el-checkbox v-model="convertRgbaChannelTextures">
            {{ t('workPage.actions.convertRgbaChannelTextures') }}
          </el-checkbox>
        </div>
        <div class="controls-row">
          <el-button type="primary" :loading="isExtracting" @click="emit('extractModels')">
            <el-icon><Download /></el-icon>
            <span>{{ t('workPage.actions.extractModels') }}</span>
          </el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('workPage.tabs.fullExtract')" name="full">
        <div class="full-extract-options">
          <span class="full-extract-filter-label">{{ t('workPage.actions.fullExtractDataTypeFilter') }}</span>
          <el-select v-model="fullExtractDataTypeFilter" style="width: 280px;">
            <el-option
              v-for="option in fullExtractDataTypeFilterOptions"
              :key="option.value"
              :label="t(option.labelKey)"
              :value="option.value"
            />
          </el-select>
        </div>
        <div class="extract-option-row">
          <el-checkbox v-model="convertRgbaChannelTextures">
            {{ t('workPage.actions.convertRgbaChannelTextures') }}
          </el-checkbox>
        </div>
        <div class="controls-row full-extract-row">
          <el-button type="primary" :loading="isExtracting" @click="emit('fullExtract')">
            <el-icon><Download /></el-icon>
            <span>{{ t('workPage.actions.fullExtract') }}</span>
          </el-button>
        </div>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.fa-path-drop-zone {
  flex: 1;
  min-width: 0;
}

.fa-select {
  min-width: 260px;
  max-width: 360px;
}

.fa-path-row :deep(.el-input) {
  flex: 1;
}

:deep(.frame-path-invalid .el-input__wrapper) {
  box-shadow: 0 0 0 1px rgba(245, 108, 108, 0.95) inset;
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.table-row {
  margin-top: 16px;
}

.extract-option-row {
  display: flex;
  align-items: center;
  margin-top: 12px;
}

.full-extract-options {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.full-extract-row {
  margin-top: 8px;
}

.full-extract-filter-label {
  color: rgba(var(--theme-text-secondary-rgb), 0.76);
  font-size: 0.92rem;
}

.empty-placeholder {
  color: #8b93a7;
  font-size: 0.9rem;
}

.extract-tabs :deep(.el-tabs__item) {
  --el-color-primary: var(--theme-accent);
  color: rgba(var(--theme-text-secondary-rgb), 0.62);
}

.extract-tabs :deep(.el-tabs__item.is-active),
.extract-tabs :deep(.el-tabs__item:hover) {
  color: var(--theme-accent);
}

.extract-tabs :deep(.el-tabs__active-bar) {
  background-color: var(--theme-accent) !important;
}

.extract-tabs :deep(.el-tabs__nav-wrap::after) {
  background-color: rgba(var(--theme-surface-tint-rgb), 0.12);
}

.row-move-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
  width: 100%;
}

.row-move-btn {
  width: 22px;
  height: 22px;
  min-height: 22px;
  padding: 0;
  border-radius: 0;
  background: rgba(var(--theme-surface-tint-rgb), 0.045) !important;
  border-color: rgba(var(--theme-surface-tint-rgb), 0.14) !important;
  color: rgba(var(--theme-text-secondary-rgb), 0.72) !important;
}

.row-move-btn:hover {
  background: rgba(var(--theme-surface-tint-rgb), 0.10) !important;
  border-color: rgba(var(--theme-surface-tint-rgb), 0.28) !important;
  color: var(--theme-accent) !important;
}

.row-move-actions .row-move-btn:first-child {
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
}

.row-move-actions .row-move-btn:last-child {
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
  margin-left: -1px;
}

.config-row-delete-btn {
  width: 26px;
  height: 26px;
  border: 1px solid rgba(255, 90, 90, 0.18);
  border-radius: 6px;
  background: rgba(255, 70, 70, 0.055);
  color: rgba(255, 145, 145, 0.78);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s ease;
}

.config-row-delete-btn:hover {
  border-color: rgba(255, 105, 105, 0.42);
  background: rgba(255, 75, 75, 0.14);
  color: rgba(255, 215, 215, 0.96);
  box-shadow: 0 0 14px rgba(255, 70, 70, 0.16);
}

.config-row-delete-btn:active {
  transform: scale(0.94);
}

.inner-panel {
  background: rgba(var(--theme-surface-tint-rgb), 0.022);
  border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
  border-radius: 8px;
  padding: 14px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  transition: all 0.25s ease;
  position: relative;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.inner-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--theme-surface-tint-rgb), 0.16), transparent);
  pointer-events: none;
  border-radius: 8px 8px 0 0;
}
</style>
