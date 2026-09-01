<script setup lang="ts">
/* 文本逻辑窗口:文本运行参数 / 随机分支 / 蓝图入口 / 蓝图变量表。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="text-logic-window" id="textLogicWindow" style="display:none;">
    <div class="tool-window-bar" @mousedown="uib.startToolWindowDrag?.($event, 'textLogicWindow')">
      <span>文本逻辑窗口</span>
      <button type="button" title="关闭文本逻辑窗口" @click="uib.closeToolWindow?.('textLogic')">×</button>
    </div>
    <div class="panel">
      <h4 id="textLogicSelectionTitle">文本运行参数</h4>
      <div class="input-row"><label>触发冷却:</label><input type="number" id="tl_cooldown" min="0" step="0.1" @change="uib.updateSelectedTextRuntimeProps?.()"><span>秒</span></div>
      <div class="input-row"><label>生命周期:</label><input type="number" id="tl_lifetime" min="0" step="0.1" @change="uib.updateSelectedTextRuntimeProps?.()"><span>秒</span></div>
      <div class="input-row"><label>显示变量:</label><input type="text" id="tl_vis_var" readonly></div>
      <div class="input-row"><label>所属步骤:</label><select id="tl_step_select" @change="uib.assignSelectedTextToStep?.(($event.target as HTMLSelectElement).value)"></select></div>
      <div class="bind-row">
        <div><input type="checkbox" id="tl_random_enabled" @change="uib.toggleSelectedTextRandom?.()"><span class="lbl">加权随机点击</span></div>
        <span class="var-tag">100%</span>
      </div>
      <div id="tl_random_editor"></div>
      <button type="button" class="primary" @click="uib.openBlueprintForSelectedText?.()">编辑文本蓝图</button>
      <details class="fold-block uib-fold-gap">
        <summary>蓝图变量表</summary>
        <div class="fold-body controls-body" id="tl_variable_table"></div>
      </details>
    </div>
  </div>
</template>
