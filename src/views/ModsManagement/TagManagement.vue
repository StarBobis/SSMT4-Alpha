<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ModTagDefinition } from '../../store/ModTagStore';
import type { ModInfo } from './ModsManagement.types';

const { t } = useI18n();
import { ref, computed, watch } from 'vue';

const props = defineProps<{
  tagDefinitions: ModTagDefinition[];
  activeTagIds: string[];
  activeTags: ModTagDefinition[];
  hasActiveTagFilter: boolean;
  tagManagementDialog: {
    visible: boolean;
    editingId: string;
    name: string;
    color: string;
    iconSourcePath: string;
    removeIcon: boolean;
    saving: boolean;
  };
  modTagDialog: {
    visible: boolean;
    modId: string;
    modName: string;
    selectedTagIds: string[];
    saving: boolean;
  };
  getTagIconUrl: (tag: ModTagDefinition) => string | undefined;
  getTagChipStyle: (tag: ModTagDefinition) => Record<string, string>;
  getTagUsageCount: (tagId: string) => number;
  getDraftTagIconPreviewUrl: () => string | undefined;
  getEditingTag: () => any;
}>();

const emit = defineEmits<{
  toggleActiveTag: [tagId: string];
  clearActiveTags: [];
  saveTagDefinition: [];
  editTagDefinition: [tag: ModTagDefinition];
  deleteTagDefinition: [tag: ModTagDefinition];
  resetTagManagementForm: [];
  pickTagIconSource: [];
  openModTagDialog: [mod?: ModInfo];
  saveModTagAssignments: [];
  openTagManagementFromModTag: [];
  closeModTagDialog: [];
}>();

const searchQuery = ref('');

const filteredTags = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return props.tagDefinitions;
  return props.tagDefinitions.filter(t => t.name.toLowerCase().includes(q));
});

// Composer visibility: show when editing, creating, or form has data
const showComposer = ref(false);

function toggleComposer() {
  if (showComposer.value) {
    showComposer.value = false;
    emit('resetTagManagementForm');
  } else {
    emit('resetTagManagementForm');
    showComposer.value = true;
  }
}

function closeComposer() {
  showComposer.value = false;
  emit('resetTagManagementForm');
}

// Auto-show composer when editing a tag
watch(() => props.tagManagementDialog.editingId, (id) => {
  if (id) showComposer.value = true;
});

// Auto-hide composer when form is fully reset (after save)
watch([() => props.tagManagementDialog.editingId, () => props.tagManagementDialog.name], () => {
  if (!props.tagManagementDialog.editingId && !props.tagManagementDialog.name && !props.tagManagementDialog.iconSourcePath) {
    showComposer.value = false;
  }
});
</script>

<template>
  <div class="tag-stage">
    <!-- Header -->
    <div class="tag-stage-header">
      <div class="tag-stage-heading">
        <svg class="tag-stage-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <path d="M7 7h.01" />
        </svg>
        <span class="tag-stage-title">{{ t('modsManagement.ui.tagFilterTitle') }}</span>
      </div>
    </div>

    <div class="tag-stage-body">
        <!-- Toolbar: search + actions -->
        <div class="tag-toolbar">
          <div class="tag-toolbar-search">
            <svg class="tag-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              v-model="searchQuery"
              class="tag-search-input"
              :placeholder="t('modsManagement.placeholders.tagName')"
            />
          </div>
          <div class="tag-toolbar-actions">
            <button
              type="button"
              class="tag-btn"
              :class="{ 'tag-btn--active': showComposer }"
              @click="toggleComposer()"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
                <path d="M7 7h.01" />
              </svg>
              {{ showComposer ? t('modsManagement.common.cancel') : t('modsManagement.actions.manageTags') }}
            </button>
            <button
              v-if="hasActiveTagFilter"
              type="button"
              class="tag-btn tag-btn--ghost"
              @click="emit('clearActiveTags')"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {{ t('modsManagement.actions.clearTagFilter') }}
            </button>
          </div>
        </div>

        <!-- Active filter chips -->
        <div v-if="activeTags.length" class="tag-active-bar">
          <span class="tag-active-bar-label">{{ t('modsManagement.ui.activeTags') }}</span>
          <div class="tag-active-bar-chips">
            <button
              v-for="tag in activeTags"
              :key="`active-${tag.id}`"
              type="button"
              class="tag-chip"
              :style="getTagChipStyle(tag)"
              @click="emit('toggleActiveTag', tag.id)"
            >
              <img v-if="getTagIconUrl(tag)" :src="getTagIconUrl(tag)" class="tag-chip-icon" />
              <span v-else class="tag-chip-dot"></span>
              <span class="tag-chip-label">{{ tag.name }}</span>
              <svg class="tag-chip-x" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Inline composer (create/edit) -->
        <div v-if="showComposer" class="tag-composer" :style="{ '--accent': tagManagementDialog.color || 'var(--theme-accent)' }">
          <div class="tag-composer-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span>{{ tagManagementDialog.editingId ? t('modsManagement.ui.editTag') : t('modsManagement.ui.createTag') }}</span>
          </div>
          <div class="tag-composer-body">
            <div class="tag-composer-preview" v-if="tagManagementDialog.name || getDraftTagIconPreviewUrl()">
              <div class="tag-composer-badge" :style="{ background: tagManagementDialog.color || 'var(--theme-accent)' }">
                <img v-if="getDraftTagIconPreviewUrl()" :src="getDraftTagIconPreviewUrl()" class="tag-composer-badge-img" />
                <span v-else class="tag-composer-badge-letter">{{ (tagManagementDialog.name || 'T')[0].toUpperCase() }}</span>
              </div>
              <span class="tag-composer-badge-label">{{ tagManagementDialog.name || t('modsManagement.ui.tagPreviewPlaceholder') }}</span>
            </div>
            <div class="tag-composer-fields">
              <div class="tag-composer-field">
                <label class="tag-composer-field-label">{{ t('modsManagement.fields.tagName') }}</label>
                <div class="tag-name-wrap">
                  <el-input
                    v-model="tagManagementDialog.name"
                    :placeholder="t('modsManagement.placeholders.tagName')"
                    maxlength="48"
                    size="small"
                  />
                  <span class="tag-name-count">{{ (tagManagementDialog.name || '').length }}/48</span>
                </div>
              </div>
              <div class="tag-composer-field tag-composer-field--compact">
                <label class="tag-composer-field-label">{{ t('modsManagement.fields.tagColor') }}</label>
                <el-color-picker v-model="tagManagementDialog.color" popper-class="tag-color-picker-popper" size="small" />
              </div>
              <div class="tag-composer-field tag-composer-field--grow">
                <label class="tag-composer-field-label">{{ t('modsManagement.fields.iconOptional') }}</label>
                <div class="tag-composer-icon-row">
                  <div class="tag-icon-preview-wrap" v-if="getDraftTagIconPreviewUrl()">
                    <img :src="getDraftTagIconPreviewUrl()" class="tag-icon-preview-img" />
                  </div>
                  <button type="button" class="tag-btn tag-btn--sm" @click="emit('pickTagIconSource')">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    {{ t('modsManagement.actions.chooseIcon') }}
                  </button>
                  <button
                    v-if="tagManagementDialog.iconSourcePath || getEditingTag()?.iconFile"
                    type="button"
                    class="tag-btn tag-btn--sm tag-btn--danger"
                    @click="tagManagementDialog.iconSourcePath = ''; tagManagementDialog.removeIcon = true"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    {{ t('modsManagement.actions.removeTagIcon') }}
                  </button>
                </div>
              </div>
            </div>
            <div class="tag-composer-footer">
              <button
                type="button"
                class="tag-btn tag-btn--primary"
                :disabled="tagManagementDialog.saving"
                @click="emit('saveTagDefinition')"
              >
                {{ tagManagementDialog.editingId ? t('modsManagement.actions.updateTag') : t('modsManagement.actions.createTag') }}
              </button>
              <button
                type="button"
                class="tag-btn tag-btn--ghost"
                :disabled="tagManagementDialog.saving"
                @click="closeComposer()"
              >
                {{ t('modsManagement.common.cancel') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Tag library -->
        <div class="tag-library">
          <div class="tag-library-header">
            <span>{{ t('modsManagement.ui.existingTags') }}</span>
            <span class="tag-library-count">{{ filteredTags.length }}</span>
          </div>

          <div v-if="filteredTags.length" class="tag-grid">
            <div
              v-for="tag in filteredTags"
              :key="tag.id"
              class="tag-card"
              :class="{ active: activeTagIds.includes(tag.id), editing: tagManagementDialog.editingId === tag.id }"
              :style="getTagChipStyle(tag)"
            >
              <button type="button" class="tag-card-inner" @click="emit('toggleActiveTag', tag.id)">
                <div class="tag-card-visual">
                  <img v-if="getTagIconUrl(tag)" :src="getTagIconUrl(tag)" class="tag-card-img" />
                  <span v-else class="tag-card-letter">{{ tag.name[0].toUpperCase() }}</span>
                </div>
                <div class="tag-card-info">
                  <span class="tag-card-name">{{ tag.name }}</span>
                  <span class="tag-card-usage">{{ t('modsManagement.ui.tagUsageCount', { count: getTagUsageCount(tag.id) }) }}</span>
                </div>
              </button>
              <div class="tag-card-actions">
                <button type="button" class="tag-card-action" @click.stop="emit('editTagDefinition', tag)" :title="t('modsManagement.actions.edit')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
                <button type="button" class="tag-card-action tag-card-action--danger" @click.stop="emit('deleteTagDefinition', tag)" :title="t('modsManagement.actions.deleteTag')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                </button>
              </div>
            </div>
          </div>
          <div v-else class="tag-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="tag-empty-icon">
              <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
              <path d="M7 7h.01" />
            </svg>
            <span class="tag-empty-title">{{ t('modsManagement.ui.noTagsYet') }}</span>
            <span class="tag-empty-hint">{{ t('modsManagement.ui.tagFilterIdleHint') }}</span>
          </div>
        </div>
      </div>
  </div>

  <Teleport to="body">
    <Transition name="tg-fade">
      <div v-if="modTagDialog.visible" class="tg-overlay" @click.self="emit('closeModTagDialog')">
        <div class="tg-dialog">
          <div class="tg-dialog-header">
            <div>
              <span class="tg-dialog-sublabel">{{ t('modsManagement.dialog.manageTagsTitle') }}</span>
              <h3 class="tg-dialog-title">{{ t('modsManagement.dialog.editModTagsTitle', { mod: modTagDialog.modName }) }}</h3>
            </div>
            <div class="tg-dialog-actions">
              <button
                type="button"
                class="tag-btn tag-btn--primary"
                :disabled="modTagDialog.saving"
                @click="emit('saveModTagAssignments')"
              >
                {{ modTagDialog.saving ? `${t('modsManagement.actions.saveModTags')}...` : t('modsManagement.actions.saveModTags') }}
              </button>
              <button
                type="button"
                class="tag-btn tag-btn--ghost"
                :disabled="modTagDialog.saving"
                @click="emit('closeModTagDialog')"
              >
                {{ t('modsManagement.common.cancel') }}
              </button>
            </div>
          </div>

          <div class="tg-dialog-body glass-scrollbar--thin">
            <p class="tg-dialog-hint">{{ t('modsManagement.ui.modTagDialogHint') }}</p>

            <div v-if="tagDefinitions.length" class="tg-dialog-grid">
              <label
                v-for="tag in tagDefinitions"
                :key="`select-${tag.id}`"
                class="tg-dialog-option"
                :style="getTagChipStyle(tag)"
              >
                <input v-model="modTagDialog.selectedTagIds" :value="tag.id" type="checkbox" class="tg-dialog-option-input" />
                <div class="tg-dialog-option-card">
                  <div class="tg-dialog-option-mark">
                    <img v-if="getTagIconUrl(tag)" :src="getTagIconUrl(tag)" class="tg-dialog-option-icon" />
                    <span v-else class="tg-dialog-option-dot"></span>
                  </div>
                  <span class="tg-dialog-option-name">{{ tag.name }}</span>
                </div>
              </label>
            </div>

            <div v-else class="tag-empty">
              <span class="tag-empty-title">{{ t('modsManagement.ui.noTagsYet') }}</span>
              <button type="button" class="tag-btn" @click="emit('openTagManagementFromModTag')">
                {{ t('modsManagement.actions.manageTags') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============================================================
   TAG STAGE — Root container
   Single unified surface, no nested glass panels
   ============================================================ */
.tag-stage {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.14);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
    rgba(10,14,20,0.65);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  box-shadow: 0 20px 56px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.04) inset;
}

/* ---- Header ---- */
.tag-stage-header {
  height: 46px;
  flex-shrink: 0;
  padding: 0 14px 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  user-select: none;
}

.tag-stage-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tag-stage-icon {
  flex-shrink: 0;
  color: rgba(255,255,255,0.40);
}

.tag-stage-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: rgba(255,255,255,0.88);
}

/* ---- Body — unified scrollable area ---- */
.tag-stage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

/* ============================================================
   TOOLBAR — Search + action buttons
   ============================================================ */
.tag-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tag-toolbar-search {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  align-items: center;
}

.tag-search-icon {
  position: absolute;
  left: 10px;
  color: rgba(255,255,255,0.30);
  pointer-events: none;
  flex-shrink: 0;
}

.tag-search-input {
  width: 100%;
  height: 34px;
  padding: 0 10px 0 32px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.85);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.tag-search-input::placeholder { color: rgba(255,255,255,0.28); }
.tag-search-input:focus {
  border-color: rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.07);
}

.tag-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ---- Unified button system ---- */
.tag-btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.72);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.tag-btn:hover {
  background: rgba(255,255,255,0.09);
  color: rgba(255,255,255,0.92);
}

.tag-btn--primary {
  background: rgba(var(--theme-accent-rgb, 88,166,255), 0.18);
  border-color: rgba(var(--theme-accent-rgb, 88,166,255), 0.30);
  color: rgba(255,255,255,0.92);
}
.tag-btn--primary:hover {
  background: rgba(var(--theme-accent-rgb, 88,166,255), 0.26);
}

.tag-btn--active {
  background: rgba(var(--theme-accent-rgb, 88,166,255), 0.12);
  border-color: rgba(var(--theme-accent-rgb, 88,166,255), 0.26);
  color: rgba(255,255,255,0.94);
}

.tag-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: rgba(255,255,255,0.50);
}
.tag-btn--ghost:hover {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.80);
}

.tag-btn--sm { height: 30px; padding: 0 10px; font-size: 11px; }
.tag-btn--xs { height: 28px; padding: 0 8px; font-size: 11px; }

.tag-btn--danger:hover {
  color: #ff8a8a;
  border-color: rgba(255,100,100,0.24);
}

/* ============================================================
   ACTIVE FILTER BAR — one tag per row
   ============================================================ */
.tag-active-bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
}

.tag-active-bar-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.32);
  flex-shrink: 0;
}

.tag-active-bar-chips {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
}

/* ---- Chip (active tag pill) ---- */
.tag-chip {
  --tag-accent: var(--theme-accent);
  height: 30px;
  padding: 0 6px 0 8px;
  border: 1px solid color-mix(in srgb, var(--tag-accent) 30%, rgba(255,255,255,0.10));
  border-radius: 8px;
  background: color-mix(in srgb, var(--tag-accent) 12%, rgba(255,255,255,0.04));
  color: rgba(255,255,255,0.84);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
}
.tag-chip:hover {
  background: color-mix(in srgb, var(--tag-accent) 20%, rgba(255,255,255,0.06));
  border-color: color-mix(in srgb, var(--tag-accent) 50%, rgba(255,255,255,0.14));
}
.tag-chip--sm { height: 26px; font-size: 11px; }

.tag-chip-icon {
  width: 18px; height: 18px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.10);
}

.tag-chip-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--tag-accent);
  flex-shrink: 0;
}

.tag-chip-label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag-chip-x {
  flex-shrink: 0;
  opacity: 0.45;
  transition: opacity 0.12s;
}
.tag-chip:hover .tag-chip-x { opacity: 0.80; }

/* Icon preview in composer */
.tag-icon-preview-wrap {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.10);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.04);
}
.tag-icon-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Custom word-limit counter */
.tag-name-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.tag-name-wrap .el-input { flex: 1; }
.tag-name-count {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 600;
  color: rgba(255,255,255,0.25);
  pointer-events: none;
  line-height: 1;
  z-index: 1;
}

/* ============================================================
   INLINE COMPOSER — Create / Edit tag form
   ============================================================ */
.tag-composer {
  flex-shrink: 0;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent, var(--theme-accent)) 20%, rgba(255,255,255,0.08));
  background:
    color-mix(in srgb, var(--accent, var(--theme-accent)) 6%, rgba(255,255,255,0.02));
  overflow: hidden;
  animation: tag-composer-in 0.2s ease both;
}

@keyframes tag-composer-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scaleY(0.96);
    max-height: 0;
  }
  to {
    opacity: 1;
    transform: translateY(0) scaleY(1);
    max-height: 400px;
  }
}

.tag-composer-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,0.60);
  border-bottom: 1px solid color-mix(in srgb, var(--accent, var(--theme-accent)) 12%, rgba(255,255,255,0.06));
}

.tag-composer-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tag-composer-preview {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tag-composer-badge {
  width: 36px; height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 800;
  color: #fff;
}
.tag-composer-badge-img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; }
.tag-composer-badge-letter { text-shadow: 0 1px 2px rgba(0,0,0,0.30); }

.tag-composer-badge-label {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255,255,255,0.90);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-composer-fields {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}

.tag-composer-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  flex: 1;
}

.tag-composer-field--compact {
  min-width: 80px;
  flex: 0 0 auto;
}

.tag-composer-field--grow {
  flex: 2;
  min-width: 200px;
}

.tag-composer-field-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.35);
  padding-left: 2px;
  padding-bottom: 2px;
}

.tag-composer-icon-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tag-composer-icon-row .el-input { flex: 1; min-width: 0; }

.tag-composer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  margin-top: 2px;
  border-top: 1px solid color-mix(in srgb, var(--accent, var(--theme-accent)) 10%, rgba(255,255,255,0.06));
}

/* Element Plus overrides inside composer */
.tag-composer :deep(.el-input__wrapper) {
  min-height: 34px;
  border-radius: 10px !important;
  background: rgba(255,255,255,0.04) !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08) !important;
  transition: box-shadow 0.15s ease, background 0.15s ease !important;
  padding-right: 44px !important;
}
.tag-composer :deep(.el-input__wrapper.is-focus) {
  background: rgba(255,255,255,0.06) !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, var(--theme-accent)) 36%, rgba(255,255,255,0.16)) !important;
}
.tag-composer :deep(.el-input__inner) { color: rgba(255,255,255,0.88); font-size: 12px; }
.tag-composer :deep(.el-color-picker) { width: 32px; height: 32px; }
.tag-composer :deep(.el-color-picker__trigger) {
  width: 32px; height: 32px; padding: 4px;
  border-radius: 10px !important;
  border-color: rgba(255,255,255,0.12) !important;
  background: rgba(255,255,255,0.05) !important;
}

/* ============================================================
   TAG LIBRARY — one tag per row
   ============================================================ */
.tag-library {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tag-library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255,255,255,0.45);
  letter-spacing: 0.04em;
  padding: 0 2px;
}

.tag-library-count {
  min-width: 26px; height: 26px;
  padding: 0 8px;
  border-radius: 8px;
  background: rgba(255,255,255,0.06);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255,255,255,0.55);
}

/* ---- Tag list ---- */
.tag-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

/* ---- Tag card ---- */
.tag-card {
  --tag-accent: var(--theme-accent);
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.07);
  background:
    color-mix(in srgb, var(--tag-accent) 6%, rgba(255,255,255,0.03));
  transition: all 0.15s ease;
  overflow: hidden;
}
.tag-card::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--tag-accent);
  border-radius: 0 2px 2px 0;
  opacity: 0.5;
  transition: opacity 0.15s;
}
.tag-card:hover {
  background: color-mix(in srgb, var(--tag-accent) 10%, rgba(255,255,255,0.05));
  border-color: color-mix(in srgb, var(--tag-accent) 24%, rgba(255,255,255,0.10));
}
.tag-card:hover::before { opacity: 1; }

.tag-card.active {
  border-color: color-mix(in srgb, var(--tag-accent) 40%, rgba(255,255,255,0.14));
  background: color-mix(in srgb, var(--tag-accent) 10%, rgba(255,255,255,0.04));
}
.tag-card.active::before { opacity: 1; width: 3px; }

.tag-card.editing {
  outline: 1px solid color-mix(in srgb, var(--tag-accent) 30%, rgba(255,255,255,0.14));
}

.tag-card-inner {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.tag-card-visual {
  width: 36px; height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--tag-accent) 16%, rgba(255,255,255,0.06));
  border: 1px solid color-mix(in srgb, var(--tag-accent) 18%, rgba(255,255,255,0.08));
  overflow: hidden;
}

.tag-card-img {
  width: 100%; height: 100%;
  object-fit: cover;
}

.tag-card-letter {
  font-size: 15px;
  font-weight: 800;
  color: var(--tag-accent);
}

.tag-card-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tag-card-name {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255,255,255,0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-card-usage {
  font-size: 11px;
  color: rgba(255,255,255,0.38);
}

.tag-card-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}
.tag-card:hover .tag-card-actions { opacity: 1; }

.tag-card-action {
  width: 28px; height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255,255,255,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
}
.tag-card-action:hover {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.70);
}
.tag-card-action svg { width: 13px; height: 13px; }
.tag-card-action--danger:hover {
  color: #ff8a8a;
  background: rgba(255,80,80,0.12);
}

/* ---- Empty state ---- */
.tag-empty {
  flex: 1;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 12px;
  border: 1px dashed rgba(255,255,255,0.10);
  padding: 24px;
  text-align: center;
}

.tag-empty-icon {
  color: rgba(255,255,255,0.18);
  margin-bottom: 4px;
}

.tag-empty-title {
  font-size: 15px;
  font-weight: 700;
  color: rgba(255,255,255,0.70);
}

.tag-empty-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.35);
}

/* ============================================================ */

.tg-fade-enter-active,
.tg-fade-leave-active { transition: opacity 0.22s ease; }
.tg-fade-enter-from,
.tg-fade-leave-to { opacity: 0; }

/* ============================================================
   MODAL DIALOG — unchanged structure, refined styling
   ============================================================ */
.tg-overlay {
  position: fixed;
  inset: 0;
  z-index: 11000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.30);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.tg-dialog {
  width: min(54vw, 720px);
  max-height: min(72vh, 680px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  border: var(--t-material-border);
  background: var(--t-material-bg);
  box-shadow: var(--t-material-shadow);
}

.tg-dialog-header,
.tg-dialog-body { padding: 16px 20px; }

.tg-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.tg-dialog-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: rgba(255,255,255,0.92);
  line-height: 1.2;
}

.tg-dialog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tg-dialog-body {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tg-dialog-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255,255,255,0.50);
}

.tg-dialog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.tg-dialog-option {
  position: relative;
  cursor: pointer;
}

.tg-dialog-option-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.tg-dialog-option-card {
  min-height: 46px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.08);
  background:
    linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255,255,255,0.78);
}

.tg-dialog-option-input:checked + .tg-dialog-option-card {
  border-color: color-mix(in srgb, var(--tag-accent, var(--theme-accent)) 40%, rgba(255,255,255,0.14));
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--tag-accent, var(--theme-accent)) 10%, rgba(255,255,255,0.06)), rgba(255,255,255,0.03));
}

.tg-dialog-option-mark { display: flex; align-items: center; }
.tg-dialog-option-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tg-dialog-sublabel {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.32);
}

.tg-dialog-option-icon {
  width: 22px; height: 22px;
  border-radius: 7px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.10);
}

.tg-dialog-option-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--tag-accent, var(--theme-accent));
  flex-shrink: 0;
}

/* ============================================================
   RESPONSIVE
   ============================================================ */
@media (max-width: 960px) {
  .tg-dialog { width: 90vw; max-height: 80vh; }
  .tag-toolbar { flex-wrap: wrap; }
  .tag-toolbar-actions { width: 100%; }
}

@media (max-width: 720px) {
  .tag-stage-body { padding: 10px; gap: 8px; }
  .tag-grid { grid-template-columns: 1fr; }
  .tag-composer-fields { flex-direction: column; }
  .tag-composer-field,
  .tag-composer-field--grow { min-width: 0; width: 100%; }
}
</style>
