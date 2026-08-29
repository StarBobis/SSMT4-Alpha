<script setup lang="ts">
/* 工具窗口停靠栏:切换各悬浮工具窗 + 生成命令 + 主题切换。
   is-open 高亮由引擎根据窗口显隐自动切换。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="window-dock" id="windowDock" aria-label="工具窗口">
    <button type="button" data-window="settings" aria-pressed="true" @click="uib.toggleToolWindow?.('settings')">设置</button>
    <button type="button" data-window="animation" aria-pressed="false" @click="uib.toggleToolWindow?.('animation')">动画</button>
    <button type="button" data-window="properties" aria-pressed="false" @click="uib.toggleToolWindow?.('properties')">属性</button>
    <button type="button" data-window="hierarchy" aria-pressed="true" @click="uib.toggleToolWindow?.('hierarchy')">层级</button>
    <button type="button" data-window="resources" aria-pressed="false" @click="uib.toggleToolWindow?.('resources')">资源</button>
    <button type="button" data-window="textLogic" id="textLogicDockBtn" aria-pressed="false" style="display:none;" @click="uib.toggleToolWindow?.('textLogic')">文本</button>
    <button type="button" class="dock-command first" id="generateIniDockBtn" @click="uib.generateINI?.()">生成<br>INI</button>
    <button type="button" class="dock-command" id="generateAssetsDockBtn" @click="uib.generateAndDownloadAssets?.()">生成<br>资源</button>
    <button type="button" class="dock-theme" @click="uib.toggleTheme?.()">主题</button>
  </div>
</template>
