/* ═══════════════════════════════════════════════════════════════
   UI 构造器 — 自绘制弹窗(替换原生 alert / confirm / prompt)
   ═══════════════════════════════════════════════════════════════
   引擎移植自 iframe 页面,内部大量调用原生 alert/confirm/prompt。
   这里用自绘制的水晶风格弹窗接管这三个全局函数:

   - alert   → 提示弹窗,点击「确定」关闭(不会阻塞调用方)
   - confirm → 确认弹窗,返回 Promise<boolean>;引擎内同步调用点
               (清空序列帧)已改为 await
   - prompt  → 输入弹窗,返回 Promise<string | null>;蓝图连线等
               调用点已改为 await

   弹窗本体由 UiDialogs.vue 渲染,通过 dialogState 与这里通信。
   ═══════════════════════════════════════════════════════════════ */
import { ref } from 'vue'

export interface UiDialogState {
  id: number
  kind: 'alert' | 'confirm' | 'prompt'
  message: string
  fallback: string
}

export const dialogState = ref<UiDialogState | null>(null)

let dialogSeq = 0
let currentResolve: ((value: boolean | string | null) => void) | null = null

const openDialog = (
  kind: UiDialogState['kind'],
  message: string,
  fallback = '',
): Promise<boolean | string | null> =>
  new Promise((resolve) => {
    currentResolve = resolve
    dialogSeq += 1
    dialogState.value = { id: dialogSeq, kind, message, fallback }
  })

/** 由 UiDialogs.vue 调用:关闭当前弹窗并回传结果。 */
export const settleDialog = (value: boolean | string | null): void => {
  dialogState.value = null
  const resolve = currentResolve
  currentResolve = null
  resolve?.(value)
}

const uiAlert = (message: string): Promise<void> =>
  openDialog('alert', String(message ?? '')).then(() => undefined)

const uiConfirm = (message: string): Promise<boolean> =>
  openDialog('confirm', String(message ?? '')) as Promise<boolean>

const uiPrompt = (message: string, fallback = ''): Promise<string | null> =>
  openDialog('prompt', String(message ?? ''), String(fallback ?? '')) as Promise<string | null>

type NativeAlertFn = typeof window.alert
type NativeConfirmFn = typeof window.confirm
type NativePromptFn = typeof window.prompt
const originalAlert: NativeAlertFn = window.alert.bind(window)
const originalConfirm: NativeConfirmFn = window.confirm.bind(window)
const originalPrompt: NativePromptFn = window.prompt.bind(window)

let dialogsInstalled = false

/** 安装全局自绘制弹窗(编辑器挂载时调用)。 */
export const installGlobalDialogs = (): void => {
  if (dialogsInstalled) return
  dialogsInstalled = true
  window.alert = uiAlert as unknown as NativeAlertFn
  window.confirm = uiConfirm as unknown as NativeConfirmFn
  window.prompt = uiPrompt as unknown as NativePromptFn
}

/** 还原原生弹窗(编辑器卸载时调用)。 */
export const uninstallGlobalDialogs = (): void => {
  if (!dialogsInstalled) return
  dialogsInstalled = false
  settleDialog(null)
  window.alert = originalAlert
  window.confirm = originalConfirm
  window.prompt = originalPrompt
}