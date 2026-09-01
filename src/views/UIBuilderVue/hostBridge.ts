/* ═══════════════════════════════════════════════════════════════
   UI 构造器 — 宿主桥(替换原 iframe 的 postMessage 协议)
   ═══════════════════════════════════════════════════════════════
   原版编辑器以 iframe 加载,通过 window.parent.postMessage 请求宿主
   保存 INI / 资源包 / 预设,并接收 context(工作空间名 + 首 Hash)。
   移植为 Vue 组件后不再跨文档,这里以直接函数调用实现同一协议:
   - request('save-ini' | 'save-assets' | 'save-preset') → 写工作空间
   - post({ type: 'ready' }) → 推送 context 到编辑器 DOM
   ═══════════════════════════════════════════════════════════════ */
import {
  resolveUIBuilderContext,
  saveUIBuilderAssets,
  saveUIBuilderINI,
  saveUIBuilderPreset,
  type UIBuilderContext,
} from './uiBuilderWorkspace'

export interface SsmHostRequestPayload {
  content?: string
  hash?: string
  json?: string
  buffer?: ArrayBuffer
}

export interface SsmHostRequestResult {
  ok: boolean
  path?: string
  error?: string
}

export interface SsmHostBridge {
  available(): boolean
  post(payload: { type?: string } & Record<string, unknown>): void
  request(type: string, payload?: SsmHostRequestPayload): Promise<SsmHostRequestResult>
}

const readHash = (payload?: SsmHostRequestPayload): string => String(payload?.hash ?? '').trim()

/** 把宿主上下文写入编辑器 DOM(工作空间名 + 首 Hash)。 */
const pushContextToDom = (root: HTMLElement, context: UIBuilderContext): void => {
  const nameEl = root.querySelector<HTMLElement>('#ui_builder_workspace_name')
  if (nameEl) nameEl.textContent = context.workspaceName || '未连接'
  const hashEl = root.querySelector<HTMLInputElement>('#char_hash')
  if (hashEl && context.firstHash) hashEl.value = context.firstHash
}

export const createDirectSsmHostBridge = (root: HTMLElement): SsmHostBridge => {
  const pushContext = async (): Promise<void> => {
    try {
      pushContextToDom(root, await resolveUIBuilderContext())
    } catch (error) {
      console.warn('[UIBuilder] Failed to resolve host context:', error)
    }
  }

  return {
    available: () => true,
    post: (payload) => {
      if (payload?.type === 'ready') void pushContext()
    },
    request: async (type, payload) => {
      switch (type) {
        case 'save-ini': {
          const path = await saveUIBuilderINI(String(payload?.content ?? ''), readHash(payload))
          return { ok: true, path }
        }
        case 'save-assets': {
          const buffer = payload?.buffer
          if (!buffer) return { ok: false, error: '缺少资源包数据' }
          const path = await saveUIBuilderAssets(buffer)
          return { ok: true, path }
        }
        case 'save-preset': {
          const path = await saveUIBuilderPreset(String(payload?.json ?? ''), readHash(payload))
          return { ok: true, path }
        }
        default:
          throw new Error(`未知的宿主请求:${type}`)
      }
    },
  }
}