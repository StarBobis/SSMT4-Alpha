<script setup lang="ts">
/* 资源窗口:材质/序列帧资源列表,内容由引擎渲染进 #res_container。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="resource-window" id="resourceWindow" style="display:none;">
    <div class="tool-window-bar" @mousedown="uib.startToolWindowDrag?.($event, 'resourceWindow')">
      <span id="resourceWindowTitle">资源窗口</span>
      <button type="button" title="关闭资源窗口" @click="uib.closeToolWindow?.('resources')">×</button>
    </div>
    <div id="resourceScopeLabel" class="resource-window-scope"></div>
    <div id="res_container"></div>
  </div>
</template>
