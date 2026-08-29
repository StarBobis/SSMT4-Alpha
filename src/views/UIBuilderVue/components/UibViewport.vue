<script setup lang="ts">
/* 中央视口:布局画布 #workArea(引擎渲染实体)、蓝图工作区(节点与连线
   由引擎渲染进 #blueprintStage / #blueprintEdges)、运行时检查器。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="viewport">
    <div id="workArea"></div>
    <div id="blueprintWorkspace" class="blueprint-workspace">
      <div class="blueprint-toolbar">
        <span id="blueprintBreadcrumb" class="blueprint-breadcrumb">主逻辑</span>
        <select id="blueprintNodeType">
          <option value="trigger">条件触发</option><option value="text">独立文本</option><option value="dialogue">对话编组</option>
          <option value="step">对话步骤</option><option value="condition">条件分支</option><option value="action">变量动作</option>
          <option value="random">随机分支</option><option value="exit">结束/出口</option>
        </select>
        <button type="button" @click="uib.addBlueprintNode?.()">添加节点</button>
        <button type="button" @click="uib.deleteSelectedBlueprintItems?.()">删除</button>
        <button type="button" @click="uib.openMainBlueprint?.()">返回主逻辑</button>
      </div>
      <svg id="blueprintEdges" class="bp-edges"></svg>
      <div id="blueprintStage" class="blueprint-stage"></div>
    </div>
    <div id="runtimeInspector" class="runtime-inspector"></div>
  </div>
</template>
