<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ModKeyInfo } from './ModsManagement.types';
import { validateMigotoKeyBinding } from './MigotoIni';

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  loading: boolean;
  saving: boolean;
  modName: string;
  items: ModKeyInfo[];
  getModKeySectionTitle: (item: ModKeyInfo) => string;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
  addBindingInput: [values: string[]];
  removeBindingInput: [values: string[], index: number];
  addBackBindingInput: [values: string[]];
  removeBackBindingInput: [values: string[], index: number];
}>();

const keyBindingError = (value: string, optional = false) => {
  if (optional && !value.trim()) return null;
  return validateMigotoKeyBinding(value);
};

const hasInvalidBindings = computed(() => props.items.some(item =>
  item.keys.some(value => !!keyBindingError(value))
  || item.backs.some(value => !!keyBindingError(value, true)),
));
</script>

<template>
  <Teleport to="body">
    <Transition name="ek-fade">
      <div v-if="visible" class="ek-overlay">
        <div class="ek-dialog">
          <!-- Ambient glow -->
          <div class="ek-glow"></div>

          <!-- Header -->
          <div class="ek-header">
            <div class="ek-header-left">
              <span class="ek-title">
                {{ t('modsManagement.dialog.editModKeysTitle', { mod: modName || '-' }) }}
              </span>
              <span class="ek-badge">KEYS</span>
            </div>
            <div class="ek-header-actions">
              <button
                type="button"
                class="ek-header-btn ek-header-btn--save"
                :disabled="saving || loading || hasInvalidBindings"
                @click="emit('save')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                {{ saving ? t('modsManagement.actions.saveModKeys') + '…' : t('modsManagement.actions.saveModKeys') }}
              </button>
              <button
                type="button"
                class="ek-header-btn ek-header-btn--close"
                :disabled="saving"
                @click="emit('close')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                {{ t('modsManagement.common.cancel') }}
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="ek-body glass-scrollbar--thin">
            <!-- Loading -->
            <div v-if="loading" class="ek-state">
              <span class="ek-loader"></span>
              {{ t('modsManagement.ui.loadingModKeys') }}
            </div>

            <!-- Empty -->
            <div v-else-if="!items.length" class="ek-state">
              {{ t('modsManagement.ui.noModKeys') }}
            </div>

            <!-- Editor Cards -->
            <div v-else class="ek-list">
              <section
                v-for="item in items"
                :key="`editor-${item.id}`"
                class="ek-card"
              >
                <!-- Card header -->
                <div class="ek-card-section">
                  <div class="ek-card-top">
                    <div class="ek-card-info">
                      <div class="ek-card-title">{{ getModKeySectionTitle(item) }}</div>
                      <div class="ek-card-meta">{{ item.sourceIni }}</div>
                    </div>
                  </div>
                </div>

                <!-- Key & Back Bindings Grid -->
                <div class="ek-card-section">
                  <div class="ek-grid">
                    <!-- Key Bindings -->
                    <div class="ek-block">
                      <div class="ek-block-header">
                        <span class="ek-label">{{ t('modsManagement.fields.modKeyBindings') }}</span>
                        <button class="ek-add-btn" @click="emit('addBindingInput', item.keys)">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                          {{ t('modsManagement.actions.addKeyBinding') }}
                        </button>
                      </div>
                      <div class="ek-multi-list">
                        <div
                          v-for="(_, keyIndex) in item.keys"
                          :key="`${item.id}-key-${keyIndex}`"
                          class="ek-multi-row"
                        >
                          <div class="ek-input-wrap">
                            <input
                              v-model="item.keys[keyIndex]"
                              :placeholder="t('modsManagement.placeholders.modKeyBinding')"
                              class="ek-input"
                              :class="{ 'is-invalid': !!keyBindingError(item.keys[keyIndex]) }"
                              :aria-invalid="!!keyBindingError(item.keys[keyIndex])"
                            />
                            <span v-if="keyBindingError(item.keys[keyIndex])" class="ek-binding-error">
                              {{ t('modsManagement.actions.invalidModKeyBinding', { key: item.keys[keyIndex] || t('modsManagement.actions.emptyModKeyBinding') }) }}
                            </span>
                          </div>
                          <button
                            class="ek-remove-btn"
                            @click="emit('removeBindingInput', item.keys, keyIndex)"
                            :title="t('modsManagement.actions.removeBinding')"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    <!-- Back Bindings -->
                    <div class="ek-block">
                      <div class="ek-block-header">
                        <span class="ek-label">{{ t('modsManagement.fields.modKeyBackBindings') }}</span>
                        <button class="ek-add-btn" @click="emit('addBackBindingInput', item.backs)">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                          {{ t('modsManagement.actions.addBackBinding') }}
                        </button>
                      </div>
                      <div class="ek-multi-list">
                        <div
                          v-for="(_, backIndex) in item.backs"
                          :key="`${item.id}-back-${backIndex}`"
                          class="ek-multi-row"
                        >
                          <div class="ek-input-wrap">
                            <input
                              v-model="item.backs[backIndex]"
                              :placeholder="t('modsManagement.placeholders.modKeyBackBinding')"
                              class="ek-input"
                              :class="{ 'is-invalid': !!keyBindingError(item.backs[backIndex], true) }"
                              :aria-invalid="!!keyBindingError(item.backs[backIndex], true)"
                            />
                            <span v-if="keyBindingError(item.backs[backIndex], true)" class="ek-binding-error">
                              {{ t('modsManagement.actions.invalidModKeyBinding', { key: item.backs[backIndex] }) }}
                            </span>
                          </div>
                          <button
                            class="ek-remove-btn"
                            @click="emit('removeBackBindingInput', item.backs, backIndex)"
                            :title="t('modsManagement.actions.removeBinding')"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </section>
            </div>
          </div>

          <!-- Saving overlay -->
          <Transition name="ek-fade">
            <div v-if="saving" class="ek-saving-overlay">
              <div class="ek-saving-card">
                <span class="ek-loader ek-loader--large"></span>
                <span>{{ t('modsManagement.actions.saveModKeys') }}…</span>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============================================
   TRANSITION
   ============================================ */
.ek-fade-enter-active,
.ek-fade-leave-active { transition: opacity 0.25s ease; }
.ek-fade-enter-from,
.ek-fade-leave-to { opacity: 0; }

/* ============================================
   OVERLAY
   ============================================ */
.ek-overlay {
  position: fixed; inset: 0; z-index: 11500;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.40);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

/* ============================================
   DIALOG  — dark translucent
   ============================================ */
.ek-dialog {
  width: min(84vw, 1040px); height: min(82vh, 800px);
  display: flex; flex-direction: column;
  position: relative; overflow: hidden;
  border-radius: 24px;
  border: var(--t-material-border);
  background: var(--t-material-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--t-material-shadow);
}

/* Dot pattern */
.ek-dialog::after {
  content: ''; position: absolute; inset: 0;
  pointer-events: none; z-index: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 20px 20px;
}

/* Ambient white glow */
.ek-glow {
  position: absolute;
  top: -25%; right: -10%; width: 50%; height: 70%;
  background: radial-gradient(ellipse, rgba(var(--theme-surface-tint-rgb), 0.10), transparent 70%);
  pointer-events: none; z-index: 0;
}

/* ============================================
   HEADER
   ============================================ */
.ek-header {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 28px; flex-shrink: 0; gap: 16px;
}
.ek-header::after {
  content: '';
  position: absolute; bottom: 0; left: 28px; right: 28px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
}

.ek-header-left { display: flex; align-items: baseline; gap: 14px; min-width: 0; }

.ek-title {
  font-size: 16px; font-weight: 700; letter-spacing: 0.5px;
  color: rgba(255,255,255,0.90);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.ek-badge {
  font-size: 9px; font-weight: 700; letter-spacing: 1.8px;
  padding: 3px 12px; border-radius: 999px; flex-shrink: 0;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.55);
}

.ek-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.ek-header-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.2s ease;
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.70);
}
.ek-header-btn:hover:not(:disabled) { transform: translateY(-1px); }
.ek-header-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.ek-header-btn--save {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.80);
}
.ek-header-btn--save:hover:not(:disabled) {
  background: rgba(255,255,255,0.10);
  border-color: rgba(var(--theme-surface-tint-rgb),0.30);
  color: var(--theme-accent);
  box-shadow: 0 4px 20px rgba(0,0,0,0.08), 0 0 24px rgba(var(--theme-surface-tint-rgb),0.06);
}
.ek-header-btn--close:hover:not(:disabled) {
  background: rgba(255,70,70,0.12);
  border-color: rgba(255,70,70,0.25);
  color: rgba(255,140,140,0.90);
  box-shadow: 0 0 20px rgba(255,70,70,0.06);
}

/* ============================================
   BODY
   ============================================ */
.ek-body {
  position: relative; z-index: 2;
  flex: 1; overflow-y: auto;
  padding: 16px 28px 20px;
}

/* ============================================
   STATES
   ============================================ */
.ek-state {
  display: flex; align-items: center; justify-content: center;
  gap: 12px; padding: 50px 18px;
  font-size: 14px; color: rgba(255,255,255,0.55); letter-spacing: 0.03em;
}

.ek-loader {
  width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,0.10);
  border-top-color: rgba(255,255,255,0.60);
  border-radius: 50%;
  animation: ekSpin 0.7s linear infinite;
  flex-shrink: 0;
}
.ek-loader--large { width: 26px; height: 26px; border-width: 3px; }
@keyframes ekSpin { to { transform: rotate(360deg); } }

/* ============================================
   EDITOR CARD LIST
   ============================================ */
.ek-list { display: flex; flex-direction: column; gap: 16px; }

/* ============================================
   EDITOR CARD  — opaque, polished surface
   ============================================ */
.ek-card {
  border-radius: 16px;
  background: var(--t-material-bg);
  border: 1px solid rgba(255,255,255,0.08);
  position: relative;
  transition: all 0.25s ease;
  box-shadow:
    0 2px 8px rgba(0,0,0,0.18),
    0 0 0 1px rgba(255,255,255,0.03) inset;
  overflow: hidden;
}

/* Top hairline */
.ek-card::before {
  content: ''; position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
  pointer-events: none; z-index: 1;
}

/* Left crystal accent stripe */
.ek-card::after {
  content: ''; position: absolute;
  top: 0; left: 0; bottom: 0; width: 3px;
  background: rgba(var(--theme-surface-tint-rgb), 0.30);
  border-radius: 3px 0 0 3px;
  pointer-events: none; z-index: 1;
  transition: all 0.3s ease;
}
.ek-card:hover {
  background: var(--t-material-bg);
  border-color: rgba(255,255,255,0.12);
  box-shadow:
    0 8px 24px rgba(0,0,0,0.22),
    0 0 0 1px rgba(255,255,255,0.05) inset,
    0 0 20px rgba(var(--theme-surface-tint-rgb), 0.06);
}
.ek-card:hover::after { background: rgba(var(--theme-surface-tint-rgb), 0.55); width: 3px; }

/* Section dividers inside card */
.ek-card-section {
  padding: 16px 28px 16px 32px;
  position: relative;
}

/* More spacious first section */
.ek-card-section:first-child {
  padding-top: 20px;
}

/* More spacious last section */
.ek-card-section:last-child {
  padding-bottom: 20px;
}
.ek-card-section + .ek-card-section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 32px;
  right: 28px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
  pointer-events: none;
}

/* ── Card Top Row ── */
.ek-card-top {
  display: flex; justify-content: space-between; gap: 24px; align-items: flex-start;
}
.ek-card-info { flex: 1; min-width: 0; }

.ek-card-title {
  font-size: 15px; font-weight: 700;
  color: rgba(255,255,255,0.88); letter-spacing: 0.02em;
}
.ek-card-meta {
  margin-top: 5px; font-size: 11px;
  color: rgba(255,255,255,0.40);
  font-family: 'Consolas','Courier New',monospace;
}

.ek-card-type {
  min-width: 170px; display: flex; flex-direction: column; gap: 6px;
}

/* ── Label ── */
.ek-label {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.8px; text-transform: uppercase;
  color: rgba(255,255,255,0.40);
}

/* ── Select ── */
.ek-select-wrap { position: relative; }

.ek-select {
  width: 100%; appearance: none; -webkit-appearance: none;
  padding: 10px 36px 10px 14px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%),
    rgba(14, 16, 22, 0.85);
  color: rgba(255,255,255,0.85); font-size: 13px; font-weight: 500;
  outline: none; cursor: pointer;
  transition: all 0.22s ease;
  letter-spacing: 0.02em;
}
.ek-select:hover {
  border-color: rgba(255,255,255,0.22);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%),
    rgba(16, 18, 26, 0.88);
  box-shadow: 0 0 12px rgba(var(--theme-surface-tint-rgb), 0.06);
}
.ek-select:focus {
  border-color: rgba(var(--theme-surface-tint-rgb), 0.50);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%),
    rgba(16, 18, 26, 0.90);
  box-shadow: 0 0 0 3px rgba(var(--theme-surface-tint-rgb), 0.08), 0 0 20px rgba(var(--theme-surface-tint-rgb), 0.06);
}
.ek-select option {
  background: var(--t-material-bg);
  color: rgba(255,255,255,0.88);
  padding: 10px 14px;
  font-size: 13px;
}

.ek-select-arrow {
  position: absolute; right: 14px; top: 50%;
  transform: translateY(-50%);
  color: rgba(255,255,255,0.35); pointer-events: none;
  transition: color 0.2s ease;
}
.ek-select-wrap:hover .ek-select-arrow { color: rgba(255,255,255,0.55); }

/* ── Grid (Key / Back sides) ── */
.ek-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}
@media (max-width: 860px) { .ek-grid { grid-template-columns: 1fr; gap: 20px; } }

/* ── Block ── */
.ek-block { display: flex; flex-direction: column; gap: 12px; }
.ek-block--full { grid-column: 1 / -1; }
.ek-block-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}

/* ── Add Btn ── */
.ek-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.40);
  font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all 0.2s ease;
}
.ek-add-btn:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.70);
}

/* ── Multi Row List ── */
.ek-multi-list { display: flex; flex-direction: column; gap: 10px; }
.ek-multi-row { display: flex; gap: 10px; align-items: flex-start; }
.ek-multi-row .ek-input-wrap { flex: 1; }

/* ── Input ── */
.ek-input-wrap { width: 100%; }

.ek-input {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(10, 12, 18, 0.65);
  color: rgba(255,255,255,0.85); font-size: 13px; outline: none;
  transition: all 0.22s ease; box-sizing: border-box;
  letter-spacing: 0.01em;
}
.ek-input:hover {
  border-color: rgba(255,255,255,0.16);
  background: rgba(10, 12, 18, 0.75);
}
.ek-input:focus {
  border-color: rgba(var(--theme-surface-tint-rgb), 0.45);
  background: rgba(10, 12, 18, 0.80);
  box-shadow: 0 0 0 3px rgba(var(--theme-surface-tint-rgb), 0.06);
}
.ek-input::placeholder { color: rgba(255,255,255,0.25); }
.ek-input.is-invalid {
  border-color: rgba(255, 88, 88, 0.72);
  box-shadow: 0 0 0 2px rgba(255, 70, 70, 0.08);
}
.ek-binding-error {
  display: block;
  margin: 5px 4px 0;
  color: rgba(255, 125, 125, 0.92);
  font-size: 11px;
  line-height: 1.35;
}

/* ── Remove Btn ── */
.ek-remove-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.30);
  cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
}
.ek-remove-btn:hover {
  background: rgba(255,70,70,0.15);
  color: rgba(255,140,140,0.85);
}

/* ── Property Grid ── */
.ek-prop-grid { display: flex; flex-direction: column; gap: 14px; }

.ek-prop-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 20px; align-items: center;
}
@media (max-width: 720px) { .ek-prop-row { grid-template-columns: 1fr; gap: 10px; } }

.ek-prop-name {
  font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,0.60);
  word-break: break-word;
  letter-spacing: 0.02em;
}

.ek-prop-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 720px) { .ek-prop-inputs { grid-template-columns: 1fr; } }

.ek-prop-input-group { display: flex; flex-direction: column; gap: 6px; }

.ek-prop-meta {
  font-size: 10px; color: rgba(255,255,255,0.30);
  letter-spacing: 0.04em; text-transform: uppercase;
}

/* ============================================
   SAVING OVERLAY
   ============================================ */
.ek-saving-overlay {
  position: absolute; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  background: rgba(6, 8, 14, 0.65);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: 24px;
}

.ek-saving-card {
  display: flex; flex-direction: column; align-items: center;
  gap: 14px; padding: 28px 40px; border-radius: 16px;
  background: var(--t-material-bg);
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 8px 32px rgba(0,0,0,0.30);
  color: rgba(255,255,255,0.65);
  font-size: 14px; font-weight: 600; letter-spacing: 0.3px;
}

/* ============================================
   RESPONSIVE
   ============================================ */
@media (max-width: 720px) {
  .ek-header { flex-direction: column; align-items: stretch; gap: 10px; }
  .ek-header-actions { justify-content: flex-end; }
  .ek-card-type { min-width: 120px; }
}
</style>
