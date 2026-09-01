<script setup lang="ts">
// UI 构造器自绘制弹窗:渲染 dialogs.ts 的 dialogState,水晶风格。
import { computed, nextTick, ref, watch } from 'vue'
import { dialogState, settleDialog } from './dialogs'

const promptValue = ref('')

const title = computed(() => {
  const kind = dialogState.value?.kind
  if (kind === 'alert') return '提示'
  if (kind === 'confirm') return '确认'
  return '输入'
})

watch(
  dialogState,
  (state) => {
    if (state?.kind === 'prompt') {
      promptValue.value = state.fallback ?? ''
      void nextTick(() => {
        const input = document.querySelector<HTMLInputElement>('.uib-dialog-input')
        input?.focus()
        input?.select()
      })
    }
  },
  { immediate: true },
)

const onConfirm = (): void => {
  const state = dialogState.value
  if (!state) return
  if (state.kind === 'prompt') {
    settleDialog(promptValue.value || null)
  } else {
    settleDialog(true)
  }
}

const onCancel = (): void => {
  const state = dialogState.value
  if (!state) return
  settleDialog(state.kind === 'prompt' ? null : false)
}
</script>

<template>
  <Teleport to="body">
    <transition name="uib-dialog-fade">
      <div v-if="dialogState" class="uib-dialog-overlay" @click.self="onCancel">
        <div class="uib-dialog" role="dialog" :aria-label="title">
          <div class="uib-dialog-sheen" aria-hidden="true"></div>
          <div class="uib-dialog-title">{{ title }}</div>
          <div class="uib-dialog-message">{{ dialogState.message }}</div>
          <input
            v-if="dialogState.kind === 'prompt'"
            v-model="promptValue"
            class="uib-dialog-input"
            type="text"
            @keydown.enter.prevent="onConfirm"
            @keydown.esc.prevent="onCancel"
          />
          <div class="uib-dialog-actions">
            <button
              v-if="dialogState.kind !== 'alert'"
              type="button"
              class="uib-btn"
              @click="onCancel"
            >
              取消
            </button>
            <button type="button" class="uib-btn primary" @click="onConfirm">确定</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>