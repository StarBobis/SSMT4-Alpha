<script setup lang="ts">
// UI 构造器常驻宿主：
// iframe 挂载在路由组件之外（App.vue 中），页面切换时仅用 display:none 隐藏，
// 不会被 KeepAlive 从文档中移除，因此切换页面再回来不会触发刷新，编辑器状态完整保留。
// 首次进入 /ui-builder 路由时才真正创建 iframe（懒加载），避免应用启动时就加载重量级编辑器页面。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import {
  resolveUIBuilderContext,
  saveUIBuilderAssets,
  saveUIBuilderINI,
  saveUIBuilderPreset,
} from './uiBuilderWorkspace'

const route = useRoute()
const { t } = useI18n()

const source = '/ui-builder-v79.html'
const iframe = ref<HTMLIFrameElement | null>(null)

const visible = computed(() => route.name === 'UIBuilder')
const activated = ref(false)

watch(
  visible,
  (value) => {
    if (value) activated.value = true
  },
  { immediate: true },
)

const pushContext = async () => {
  const context = await resolveUIBuilderContext().catch(() => ({
    workspaceName: '',
    firstHash: '',
  }))

  iframe.value?.contentWindow?.postMessage(
    { __ssmt_uib: true, type: 'context', ...context },
    '*',
  )
}

type SaveRequestMessage =
  | { type: 'ready' }
  | { type: 'save-ini'; content: string; hash: string; requestId?: string }
  | { type: 'save-assets'; buffer: ArrayBuffer; requestId?: string }
  | { type: 'save-preset'; json: string; hash: string; requestId?: string }

const sendResult = (
  requestId: string | undefined,
  result: { ok: boolean; path?: string; error?: string },
) => {
  iframe.value?.contentWindow?.postMessage(
    { __ssmt_uib: true, type: 'save-result', requestId, ...result },
    '*',
  )
}

const handleMessage = async (event: MessageEvent) => {
  const data = event.data as (SaveRequestMessage & { __ssmt_uib?: boolean }) | null
  if (!data || data.__ssmt_uib !== true) {
    return
  }

  if (iframe.value && event.source !== iframe.value.contentWindow) {
    return
  }

  switch (data.type) {
    case 'ready': {
      await pushContext()
      break
    }

    case 'save-ini': {
      try {
        const path = await saveUIBuilderINI(data.content, data.hash || '')
        sendResult(data.requestId, { ok: true, path })
      } catch (error) {
        sendResult(data.requestId, { ok: false, error: String(error) })
      }
      break
    }

    case 'save-assets': {
      try {
        const path = await saveUIBuilderAssets(data.buffer)
        sendResult(data.requestId, { ok: true, path })
      } catch (error) {
        sendResult(data.requestId, { ok: false, error: String(error) })
      }
      break
    }

    case 'save-preset': {
      try {
        const path = await saveUIBuilderPreset(data.json, data.hash || '')
        sendResult(data.requestId, { ok: true, path })
      } catch (error) {
        sendResult(data.requestId, { ok: false, error: String(error) })
      }
      break
    }
  }
}

// 手动刷新：确认后重载 iframe。重载完成后编辑器会重新发送 ready，上下文自动重新推送。
const refresh = async () => {
  if (!iframe.value) {
    return
  }

  try {
    await ElMessageBox.confirm(
      t('uiBuilder.refreshConfirmMessage'),
      t('uiBuilder.refreshConfirmTitle'),
      {
        confirmButtonText: t('uiBuilder.refreshConfirmOk'),
        cancelButtonText: t('uiBuilder.refreshConfirmCancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  iframe.value.contentWindow?.location.reload()
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>

<template>
  <section
    v-if="activated"
    class="ui-builder-host"
    :style="{ display: visible ? 'flex' : 'none' }"
    aria-label="UI 构造器"
  >
    <iframe
      ref="iframe"
      :src="source"
      title="3Dmigoto UI 构造器"
      class="ui-builder-frame"
    />
    <button
      type="button"
      class="ui-builder-refresh-btn"
      :title="t('uiBuilder.refreshTooltip')"
      @click="refresh"
    >
      <el-icon><Refresh /></el-icon>
      <span>{{ t('uiBuilder.refresh') }}</span>
    </button>
  </section>
</template>

<style scoped>
.ui-builder-host {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #050914;
  isolation: isolate;
  flex-direction: column;
}

.ui-builder-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: #050914;
  pointer-events: auto;
}

.ui-builder-refresh-btn {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-regular, #cfd8dc);
  background: rgba(10, 18, 32, 0.72);
  border: 1px solid rgba(120, 180, 255, 0.35);
  border-radius: 6px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ui-builder-refresh-btn:hover {
  background: rgba(30, 52, 84, 0.9);
  border-color: rgba(120, 180, 255, 0.7);
}
</style>
