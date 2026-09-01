<script setup lang="ts">
/* 层级侧栏:编组/解组操作 + 层级树(引擎渲染进 #hierarchy_panel)。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="hierarchy-sidebar">
    <div class="hierarchy-resizer" id="hierarchyResizer" title="拖拽调整宽度"></div>
    <div class="panel">
      <h4>层级面板</h4>
      <div class="hierarchy-actions">
        <button type="button" class="group-btn" @click="uib.groupSelected?.()">编组</button>
        <button type="button" @click="uib.ungroupSelected?.()">解组</button>
      </div>
      <div id="hierarchy_panel" class="hierarchy-panel"></div>
      <div class="hierarchy-help">
        左侧负责属性和参数。
        中间是工作区预览。
        右侧单独管理编组和组件层级。
      </div>
    </div>
  </div>
</template>
