<script setup lang="ts">
/* ═══════════════════════════════════════════════════════════════
   UI 构造器 — 应用根组件(Vue 重写版)
   ═══════════════════════════════════════════════════════════════
   由路由组件 UIBuilder.vue 渲染,替代原 iframe(public/ui-builder-*.html):

   - bodyMarkup.html 为原静态面板标记的移植(与引擎共用同一批 id/class,
     引擎挂载后完全接管其中内容,布局与功能保持一致);
   - 引擎为原内嵌脚本的机械移植,挂载时注入;
   - 原生 alert/confirm/prompt 由 dialogs.ts 替换为自绘制弹窗;
   - 保存 INI/资源/预设经 hostBridge.ts 直连工作空间(Vue 无 iframe)。

   页面切换时组件由 KeepAlive 保活,不会被销毁,编辑器状态完整保留。
   ═══════════════════════════════════════════════════════════════ */
import { onActivated, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import JSZip from 'jszip'
import bodyMarkup from './bodyMarkup.html?raw'
import { createUIBuilderEngine } from './uiBuilderEngine'
import { installGlobalDialogs, uninstallGlobalDialogs } from './dialogs'
import UiDialogs from './UiDialogs.vue'
import type { UIBuilderEngineHandle } from './uiBuilderTypes'

// 引擎的资源打包模块通过全局 JSZip 工作(Vue 版由 npm 依赖提供)。
;(globalThis as Record<string, unknown>).JSZip = JSZip

const rootEl = ref<HTMLElement | null>(null)
const engine = shallowRef<UIBuilderEngineHandle | null>(null)

const boot = () => {
  if (engine.value) return
  if (!rootEl.value) return
  installGlobalDialogs()
  engine.value = createUIBuilderEngine(rootEl.value)
}

const teardown = () => {
  engine.value?.destroy()
  engine.value = null
  uninstallGlobalDialogs()
}

/** 手动刷新:销毁并重建引擎(等价于原 iframe 的重新加载)。 */
const refresh = () => {
  teardown()
  boot()
}

onMounted(boot)
onActivated(() => {
  // KeepAlive 恢复显示:引擎的窗口监听常驻,无需重建;
  // 若此前被手动销毁(刷新),这里补一次启动。
  if (!engine.value) boot()
})

onBeforeUnmount(teardown)
</script>

<template>
  <div ref="rootEl" class="ui-builder-app dark-mode">
    <!-- 引擎完全接管其中的 DOM(classList/display 等由引擎控制);
         display:contents 让布局骨架直接参与外层 flex。 -->
    <div class="uib-markup-host" v-html="bodyMarkup"></div>
  </div>
  <button type="button" class="uib-page-refresh" title="重新加载编辑器" @click="refresh">
    ⟳ 重新加载
  </button>
  <UiDialogs />
</template>

<style>
@import './styles.css';
</style>