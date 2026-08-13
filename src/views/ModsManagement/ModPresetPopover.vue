<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { ElMessageBox } from 'element-plus';
import { RefreshLeft } from '@element-plus/icons-vue';
import type { ModPreset, ModPresetsFile } from '../../store/ModPresetStore';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const PRESET_DIALOG_MODAL_CLASS = 'preset-dialog-overlay';

const props = defineProps<{
    visible: boolean;
    x: number;
    y: number;
    presets: ModPresetsFile;
    modName: string;
    gameName: string;
    modRelativePath: string;
    modPath: string;
}>();

const emit = defineEmits<{
    close: [];
    'apply-preset': [presetId: string];
    'save-current': [name: string];
    'delete-preset': [presetId: string];
    'rename-preset': [presetId: string, newName: string];
    'reset-current': [];
}>();

const internalX = ref(props.x);
const internalY = ref(props.y);
const popoverRef = ref<HTMLElement | null>(null);
const saveInputVisible = ref(false);
const saveInputValue = ref('');

const activePreset = ref<ModPreset | null>(
    props.presets.presets.find(p => p.active) || null
);

watch(() => props.presets, () => {
    activePreset.value = props.presets.presets.find(p => p.active) || null;
});

watch(() => props.visible, (newVal) => {
    if (newVal) {
        internalX.value = props.x;
        internalY.value = props.y;
        saveInputVisible.value = false;
        saveInputValue.value = '';
        nextTick(() => {
            const el = popoverRef.value;
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth - 8) internalX.value = Math.max(8, window.innerWidth - r.width - 8);
            if (r.bottom > window.innerHeight - 8) internalY.value = Math.max(8, window.innerHeight - r.height - 8);
        });
    }
});

const onApply = (presetId: string) => {
    emit('apply-preset', presetId);
};

const onSaveCurrent = () => {
    const name = saveInputValue.value.trim();
    if (!name) return;
    emit('save-current', name);
    saveInputVisible.value = false;
    saveInputValue.value = '';
};

const onDelete = async (preset: ModPreset) => {
    try {
        await ElMessageBox.confirm(
            t('modsManagement.messages.deletePresetConfirm', { name: preset.name }),
            t('modsManagement.dialog.deletePresetTitle'),
            {
                confirmButtonText: t('modsManagement.common.delete'),
                cancelButtonText: t('modsManagement.common.cancel'),
                type: 'warning',
                modalClass: PRESET_DIALOG_MODAL_CLASS,
            },
        );
        emit('delete-preset', preset.id);
    } catch { /* cancelled */ }
};

const onRename = async (preset: ModPreset) => {
    try {
        const result = await ElMessageBox.prompt(
            t('modsManagement.messages.enterPresetName'),
            t('modsManagement.dialog.renamePresetTitle'),
            {
                confirmButtonText: t('modsManagement.common.confirm'),
                cancelButtonText: t('modsManagement.common.cancel'),
                inputValue: preset.name,
                modalClass: PRESET_DIALOG_MODAL_CLASS,
            },
        );
        const newName = (result as { value?: string }).value?.trim();
        if (newName) {
            emit('rename-preset', preset.id, newName);
        }
    } catch { /* cancelled */ }
};

const onResetCurrent = async () => {
    try {
        await ElMessageBox.confirm(
            t('modsManagement.messages.resetPresetStateConfirm'),
            t('modsManagement.dialog.resetPresetStateTitle'),
            {
                confirmButtonText: t('modsManagement.actions.resetPresetState'),
                cancelButtonText: t('modsManagement.common.cancel'),
                type: 'warning',
                modalClass: PRESET_DIALOG_MODAL_CLASS,
            },
        );
        emit('reset-current');
    } catch { /* cancelled */ }
};

const onOverlayClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest('.preset-popover')) return;
    emit('close');
};
</script>

<template>
    <Teleport to="body">
        <div v-if="visible" class="preset-overlay" @click="onOverlayClick" @contextmenu.prevent="onOverlayClick">
            <div
                ref="popoverRef"
                class="preset-popover glass-panel"
                :style="{ top: internalY + 'px', left: internalX + 'px' }"
                @click.stop
            >
                <div class="preset-popover-header">
                    <span class="preset-popover-title">{{ t('modsManagement.ui.presets') }}</span>
                    <span class="preset-popover-subtitle">{{ modName }}</span>
                </div>

                <div class="preset-list" v-if="presets.presets.length > 0">
                    <div
                        v-for="preset in presets.presets"
                        :key="preset.id"
                        class="preset-item"
                        :class="{ active: preset.active }"
                    >
                        <button
                            type="button"
                            class="preset-item-name"
                            :title="preset.name"
                            @click="onApply(preset.id)"
                        >
                            <svg v-if="preset.active" class="preset-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span v-else class="preset-dot"></span>
                            <span class="preset-item-label">{{ preset.name }}</span>
                        </button>
                        <div class="preset-item-actions">
                            <button type="button" class="preset-action-btn" :title="t('modsManagement.actions.rename')" @click.stop="onRename(preset)">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button type="button" class="preset-action-btn preset-action-btn--danger" :title="t('modsManagement.common.delete')" @click.stop="onDelete(preset)">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                </div>
                <div v-else class="preset-empty">
                    {{ t('modsManagement.ui.noPresetsYet') }}
                </div>

                <!-- Save current state as preset -->
                <div class="preset-save-section">
                    <button type="button" class="preset-reset-trigger" @click="onResetCurrent">
                        <RefreshLeft />
                        {{ t('modsManagement.actions.resetPresetState') }}
                    </button>
                    <div v-if="saveInputVisible" class="preset-save-form">
                        <input
                            ref="saveInputRef"
                            v-model="saveInputValue"
                            class="preset-save-input"
                            :placeholder="t('modsManagement.placeholders.presetName')"
                            @keyup.enter="onSaveCurrent"
                            @keyup.escape="saveInputVisible = false; saveInputValue = ''"
                        />
                        <button type="button" class="preset-save-confirm" @click="onSaveCurrent" :disabled="!saveInputValue.trim()">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                    </div>
                    <button v-else type="button" class="preset-save-trigger" @click="saveInputVisible = true">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        {{ t('modsManagement.actions.saveCurrentAsPreset') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.preset-overlay {
    position: fixed; inset: 0; z-index: 10000;
}
:global(.preset-dialog-overlay) {
    z-index: 10002 !important;
}
.preset-popover {
    position: fixed;
    z-index: 10001;
    min-width: 220px;
    max-width: 300px;
    border-radius: 12px;
    background:
        linear-gradient(145deg, rgba(var(--theme-surface-tint-rgb), 0.13), rgba(255, 255, 255, 0.035)),
        rgba(38, 46, 60, 0.34);
    backdrop-filter: blur(22px) saturate(1.35);
    -webkit-backdrop-filter: blur(22px) saturate(1.35);
    border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.24);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.32);
    padding: 8px 0;
    overflow: hidden;
}
.preset-popover-header {
    padding: 8px 14px 6px;
    display: flex; flex-direction: column; gap: 2px;
}
.preset-popover-title {
    font-size: 12px; font-weight: 700;
    color: rgba(255,255,255,0.55);
    text-transform: uppercase; letter-spacing: 0.6px;
}
.preset-popover-subtitle {
    font-size: 12px; color: rgba(255,255,255,0.80);
    font-weight: 500; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
}

.preset-list {
    max-height: 200px; overflow-y: auto;
    padding: 2px 0;
}
.preset-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 6px;
}
.preset-item:hover { background: rgba(255,255,255,0.05); }
.preset-item.active { background: rgba(255,255,255,0.04); }

.preset-item-name {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 8px;
    padding: 8px 6px;
    border: none; background: none;
    color: rgba(255,255,255,0.75); font-size: 13px; cursor: pointer;
    text-align: left;
}
.preset-item-name:hover { color: rgba(255,255,255,0.92); }
.preset-item-label {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.preset-check { flex-shrink: 0; color: rgba(100, 230, 150, 0.85); }
.preset-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: rgba(255,255,255,0.20); flex-shrink: 0;
}

.preset-item-actions {
    display: flex; gap: 2px; flex-shrink: 0;
    opacity: 0; transition: opacity 0.15s;
}
.preset-item:hover .preset-item-actions { opacity: 1; }
.preset-action-btn {
    width: 26px; height: 26px; border-radius: 6px;
    border: none; background: transparent;
    color: rgba(255,255,255,0.35); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
}
.preset-action-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75); }
.preset-action-btn--danger:hover { color: rgba(255, 100, 100, 0.85); }

.preset-empty {
    padding: 16px 14px; text-align: center;
    font-size: 12px; color: rgba(255,255,255,0.30);
}

.preset-save-section {
    border-top: 1px solid rgba(255,255,255,0.06);
    margin-top: 4px; padding: 6px 8px;
}
.preset-reset-trigger {
    width: 100%; padding: 7px 10px; margin-bottom: 6px;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
    background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.46);
    font-size: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    transition: all 0.15s;
}
.preset-reset-trigger svg { width: 12px; height: 12px; flex-shrink: 0; }
.preset-reset-trigger:hover {
    border-color: rgba(255, 190, 110, 0.30);
    color: rgba(255, 210, 135, 0.86);
    background: rgba(255, 190, 110, 0.07);
}
.preset-save-trigger {
    width: 100%; padding: 7px 10px;
    border: 1px dashed rgba(255,255,255,0.15); border-radius: 8px;
    background: transparent; color: rgba(255,255,255,0.45);
    font-size: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    transition: all 0.15s;
}
.preset-save-trigger:hover {
    border-color: rgba(255,255,255,0.30); color: rgba(255,255,255,0.75);
    background: rgba(255,255,255,0.04);
}
.preset-save-form {
    display: flex; gap: 4px;
}
.preset-save-input {
    flex: 1; min-width: 0; height: 30px;
    padding: 0 8px; border-radius: 7px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.85); font-size: 12px;
    outline: none;
}
.preset-save-input:focus { border-color: rgba(100, 200, 255, 0.35); }
.preset-save-confirm {
    width: 30px; height: 30px; border-radius: 7px;
    border: none; background: rgba(100, 200, 150, 0.12);
    color: rgba(100, 230, 150, 0.80); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
}
.preset-save-confirm:hover:not(:disabled) { background: rgba(100, 200, 150, 0.22); }
.preset-save-confirm:disabled { opacity: 0.3; cursor: default; }
</style>
