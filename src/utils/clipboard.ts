/* ═══════════════════════════════════════════════════════════════
   Clipboard write helper — layered fallbacks
   ═══════════════════════════════════════════════════════════════
   1. Native Win32 (clipboard_write_text): writes immediately via
      SetClipboardData(CF_UNICODETEXT), so the content shows up in
      Windows clipboard history (Win+V) and survives app exit.
   2. Tauri clipboard-manager plugin (arboard).
   3. Web Clipboard API.
   4. Legacy execCommand('copy') fallback.

   Used by CheeseCat (芝士猫) copy actions where reliability matters.
   ═══════════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core'
import { writeText as pluginWriteText } from '@tauri-apps/plugin-clipboard-manager'

const fallbackWrite = (text: string): boolean => {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  textarea.remove()
  return ok
}

/**
 * 把文本写入系统剪贴板,逐级回退,尽可能保证成功且内容可被
 * Win+V 剪贴板历史收录。
 */
export const copyTextToClipboard = async (text: string): Promise<void> => {
  // Native Win32 first — the most reliable path on Windows and the only
  // one that guarantees clipboard-history compatibility.
  try {
    await invoke('clipboard_write_text', { text })
    return
  } catch (error) {
    console.warn('[Clipboard] Native write failed, falling back:', error)
  }

  // Plugin (arboard) fallback.
  try {
    await pluginWriteText(text)
    return
  } catch (error) {
    console.warn('[Clipboard] Plugin write failed, falling back:', error)
  }

  // Web Clipboard API fallback.
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch (error) {
    console.warn('[Clipboard] Web API write failed, falling back:', error)
  }

  // Last resort: execCommand('copy').
  if (fallbackWrite(text)) return
  throw new Error('所有剪贴板方案均失败')
}