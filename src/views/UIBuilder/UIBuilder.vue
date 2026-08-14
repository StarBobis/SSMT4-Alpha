<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  resolveUIBuilderContext,
  saveUIBuilderAssets,
  saveUIBuilderINI,
  saveUIBuilderPreset,
} from './uiBuilderWorkspace'

const source = ref('/ui-builder-v79.html')
const iframe = ref<HTMLIFrameElement | null>(null)

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

onMounted(() => {
  window.addEventListener('message', handleMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>

<template>
  <section class="ui-builder-page" aria-label="UI 构造器">
    <iframe
      ref="iframe"
      :src="source"
      title="3Dmigoto UI 构造器"
      class="ui-builder-frame"
    />
  </section>
</template>

<style scoped>
.ui-builder-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #050914;
  isolation: isolate;
}

.ui-builder-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #050914;
  pointer-events: auto;
}
</style>
