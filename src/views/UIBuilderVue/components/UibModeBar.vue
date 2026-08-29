<script setup lang="ts">
/* 工作区模式切换栏:布局 / 蓝图 / 运行。active 态由引擎切换。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="workspace-mode-bar" id="workspaceModeBar">
    <button type="button" id="modeLayoutBtn" class="active" @click="uib.setWorkspaceMode?.('layout')">布局</button>
    <button type="button" id="modeBlueprintBtn" @click="uib.setWorkspaceMode?.('blueprint')">蓝图</button>
    <button type="button" id="modeRunBtn" @click="uib.setWorkspaceMode?.('run')">运行</button>
  </div>
</template>
