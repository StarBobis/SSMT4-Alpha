<script setup lang="ts">
/* 动画窗口:全局动画 / 常驻动画 / 独立动画参数。
   显示状态与各折叠行显隐由引擎按选中组件动态控制。 */
import { uib } from '../useUib'
</script>

<template>
  <div class="anim-column" id="animColumn">
    <div class="tool-window-bar" @mousedown="uib.startToolWindowDrag?.($event, 'animColumn')">
      <span>动画窗口</span>
      <button type="button" title="关闭动画窗口" @click="uib.closeToolWindow?.('animation')">×</button>
    </div>
    <div class="panel" id="animPanel" style="display:none; border-color:var(--group-color);">
      <h4 style="color:var(--group-color)">动画面板</h4>
      <details class="fold-block" :open="true">
        <summary>全局动画（始终显示 / 编组共享）</summary>
        <div class="fold-body controls-body">
          <div class="input-row">
            <label>全局效果:</label>
            <select id="p_anim_global_mode" @change="uib.updateGlobalAnimMode?.()">
              <option value="none">无</option>
              <option value="edge_dock">靠边收纳</option>
              <option value="group_float_y">整体浮动</option>
              <option value="group_float_x">整体横移</option>
              <option value="group_pulse">整体呼吸</option>
            </select>
          </div>
          <div class="input-row" id="row_anim_global_edge" style="display:none;">
            <label>停靠边缘:</label>
            <select id="p_anim_global_edge" @change="uib.updateGlobalAnimEdge?.()">
              <option value="auto">自动判定</option>
              <option value="left">左侧</option>
              <option value="right">右侧</option>
              <option value="top">顶部</option>
              <option value="bottom">底部</option>
            </select>
          </div>
          <div class="input-row" id="row_anim_global_strength">
            <label id="lbl_anim_global_strength">幅度:</label>
            <input type="number" id="p_anim_global_strength" step="0.005" min="0" max="0.5" @change="uib.updateGlobalAnimStrength?.()">
          </div>
          <div class="input-row">
            <label>动画速度:</label>
            <input type="number" id="p_anim_global_speed" step="0.001" min="0.001" max="0.2" @change="uib.updateGlobalAnimSpeed?.()">
          </div>
          <div class="input-row" id="row_anim_global_reveal" style="display:none;">
            <label>露出宽度:</label>
            <input type="number" id="p_anim_global_reveal" step="0.005" min="0.005" max="0.3" @change="uib.updateGlobalAnimReveal?.()">
          </div>
          <div class="input-row" id="row_anim_global_trigger" style="display:none;">
            <label>触发区域(屏幕比例):</label>
            <input type="number" id="p_anim_global_trigger" step="0.005" min="0.01" max="0.4" @change="uib.updateGlobalAnimTrigger?.()">
          </div>
          <div class="input-row" id="row_anim_global_ease" style="display:none;">
            <label>展开缓动:</label>
            <input type="number" id="p_anim_global_ease" step="0.01" min="0.02" max="1" @change="uib.updateGlobalAnimEase?.()">
          </div>
          <div id="anim_global_hint" class="anim-note"></div>
        </div>
      </details>
      <details class="fold-block" :open="true">
        <summary>常驻动画（所有组件默认节奏）</summary>
        <div class="fold-body controls-body">
          <div class="input-row">
            <label>启用常驻流光与表面高光:</label>
            <input type="checkbox" id="p_anim_persistent_enabled" :checked="true" @change="uib.updatePersistentAnimEnabled?.()">
          </div>
          <div class="input-row" id="row_anim_persistent_speed">
            <label>常驻流光速度:</label>
            <input type="number" id="p_anim_persistent_speed" value="0.03" step="0.005" min="0" max="0.5" @change="uib.updatePersistentAnimSpeed?.()">
          </div>
          <div class="input-row">
            <label>局部流光倍率:</label>
            <input type="number" id="p_anim_persistent_flow_speed" value="0.1" step="0.01" min="0" max="2" @change="uib.updatePersistentAnimFlowSpeed?.()">
          </div>
          <div class="anim-note">
            关闭后会完整移除默认顶部高光、斜向流光、对角线/角落/边缘/径向增亮和边框提亮。<br>
            “常驻流光速度”控制每个组件默认都会有的那层常驻扫光。<br>
            “局部流光倍率”只额外作用于独立动画里的流光 / 扫光类效果。
          </div>
        </div>
      </details>
      <div class="anim-local-block" id="anim_local_block">
        <h4 style="margin-bottom:0.6em;">独立动画（随组件切换）</h4>
        <div id="anim_local_empty" class="anim-note" style="display:none; margin-bottom:8px;">
          当前未选中组件。全局动画仍可编辑，独立动画会在你选中具体组件后切换到对应类型。
        </div>
        <details class="fold-block" :open="true">
          <summary id="anim_local_title">独立动画</summary>
          <div class="fold-body controls-body">
            <div class="input-row">
              <label>独立效果:</label>
              <select id="p_anim_local_mode" @change="uib.updateLocalAnimMode?.()"></select>
            </div>
            <div class="input-row">
              <label id="lbl_anim_local_strength">强度:</label>
              <input type="number" id="p_anim_local_strength" step="0.01" min="0" max="1" @change="uib.updateLocalAnimStrength?.()">
            </div>
            <div class="input-row">
              <label>动画速度:</label>
              <input type="number" id="p_anim_local_speed" step="0.001" min="0.001" max="0.2" @change="uib.updateLocalAnimSpeed?.()">
            </div>
            <div id="anim_local_hint" class="anim-note"></div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
