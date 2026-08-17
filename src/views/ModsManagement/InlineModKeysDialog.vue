<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { InlineKeyChoice } from './InlineModKeys'

const props = defineProps<{
  visible: boolean
  loading: boolean
  applying: boolean
  modName: string
  choices: InlineKeyChoice[]
  hasBackup: boolean
}>()

const emit = defineEmits<{
  close: []
  apply: [selected: Record<string, string>]
  restore: []
}>()

const { t } = useI18n()
const selected = reactive<Record<string, string>>({})
const enabled = reactive<Record<string, boolean>>({})
const choiceKey = (choice: InlineKeyChoice) => `${choice.itemId}:${choice.variable}`
const hasEnabledChoice = computed(() => Object.values(enabled).some(Boolean))

const emitSelectedChoices = () => {
  emit('apply', Object.fromEntries(
    Object.entries(selected).filter(([key]) => enabled[key]),
  ))
}

watch(() => [props.visible, props.choices] as const, () => {
  Object.keys(selected).forEach(key => delete selected[key])
  Object.keys(enabled).forEach(key => delete enabled[key])
  props.choices.forEach(choice => {
    selected[choiceKey(choice)] = choice.currentValue
    enabled[choiceKey(choice)] = true
  })
}, { deep: true })
</script>

<template>
  <el-dialog
    :model-value="visible"
    width="min(720px, 88vw)"
    class="inline-keys-dialog"
    :title="t('modsManagement.dialog.inlineModKeysTitle', { mod: modName })"
    :close-on-click-modal="!applying"
    @close="emit('close')"
  >
    <div v-if="loading" class="inline-state">{{ t('modsManagement.ui.loadingModKeys') }}</div>
    <template v-else>
      <div class="inline-warning">
        {{ t('modsManagement.messages.inlineModKeysWarning') }}
      </div>
      <div v-if="hasBackup" class="inline-backup">
        <span>{{ t('modsManagement.messages.inlineModKeysBackupAvailable') }}</span>
        <button type="button" class="inline-btn inline-btn--restore" :disabled="applying" @click="emit('restore')">
          {{ t('modsManagement.actions.restoreInlineModKeys') }}
        </button>
      </div>
      <div v-if="!choices.length" class="inline-state">
        {{ t('modsManagement.messages.noInlineModKeys') }}
      </div>
      <div v-else class="inline-list">
        <div v-for="choice in choices" :key="choiceKey(choice)" class="inline-row" :class="{ 'is-animation-risk': choice.animationRisk }">
          <label class="inline-check" :title="t('modsManagement.actions.toggleInlineModKey')">
            <input v-model="enabled[choiceKey(choice)]" type="checkbox" />
          </label>
          <div class="inline-info">
            <strong>
              {{ choice.sectionName }}
              <span v-if="choice.animationRisk" class="inline-risk-badge">{{ t('modsManagement.ui.inlineAnimationRisk') }}</span>
            </strong>
            <span>{{ choice.sourceIni }} · {{ choice.variable }}</span>
          </div>
          <select v-model="selected[choiceKey(choice)]" class="inline-select" :disabled="!enabled[choiceKey(choice)]">
            <option v-for="value in choice.options" :key="value" :value="value">{{ value }}</option>
          </select>
        </div>
      </div>
    </template>
    <template #footer>
      <button type="button" class="inline-btn" :disabled="applying" @click="emit('close')">
        {{ t('modsManagement.common.cancel') }}
      </button>
      <button
        type="button"
        class="inline-btn inline-btn--danger"
        :disabled="loading || applying || hasBackup || !choices.length || !hasEnabledChoice"
        @click="emitSelectedChoices"
      >
        {{ applying ? `${t('modsManagement.actions.inlineModKeys')}…` : t('modsManagement.actions.inlineModKeys') }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.inline-state { padding: 34px 12px; text-align: center; color: var(--el-text-color-secondary); }
.inline-warning { padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--theme-danger) 38%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--theme-danger) 9%, transparent); color: var(--theme-danger); line-height: 1.55; }
.inline-backup { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,.05); }
.inline-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; max-height: 52vh; overflow: auto; }
.inline-row { display: flex; align-items: center; gap: 18px; padding: 12px 14px; border: 1px solid rgba(255,255,255,.09); border-radius: 11px; background: rgba(255,255,255,.035); }
.inline-row.is-animation-risk { border-color: rgba(245, 190, 55, .55); background: rgba(245, 190, 55, .16); box-shadow: inset 3px 0 0 rgba(245, 190, 55, .85); }
.inline-check { display: grid; place-items: center; flex: 0 0 auto; cursor: pointer; }
.inline-check input { width: 16px; height: 16px; accent-color: var(--theme-danger); cursor: pointer; }
.inline-info { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }
.inline-info strong { overflow: hidden; text-overflow: ellipsis; color: var(--el-text-color-primary); }
.inline-risk-badge { display: inline-flex; margin-left: 8px; padding: 2px 7px; border-radius: 999px; background: rgba(255, 196, 52, .22); color: #ffd66b; font-size: 10px; font-weight: 700; vertical-align: middle; }
.inline-info span { overflow: hidden; text-overflow: ellipsis; color: var(--el-text-color-secondary); font-size: 12px; }
.inline-select { min-width: 150px; padding: 8px 30px 8px 11px; border: 1px solid rgba(255,255,255,.14); border-radius: 9px; background: var(--t-material-bg); color: var(--el-text-color-primary); outline: none; }
.inline-select:disabled { opacity: .4; cursor: not-allowed; }
.inline-btn { padding: 8px 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 9px; background: rgba(255,255,255,.06); color: var(--el-text-color-primary); cursor: pointer; }
.inline-btn:disabled { opacity: .4; cursor: not-allowed; }
.inline-btn--danger { border-color: color-mix(in srgb, var(--theme-danger) 45%, transparent); color: var(--theme-danger); }
.inline-btn--restore { color: var(--theme-accent); }
</style>
