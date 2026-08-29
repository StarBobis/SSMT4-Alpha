<script setup lang="ts">
/* 设置窗口:全局设置 / 预设 / 撤销重做 / 快捷键 / 添加组件。
   元素 id 与原引擎绑定保持一致,引擎挂载后直接读写这些节点。 */
import { uib } from '../useUib'

const openPresetPicker = (): void => {
  document.getElementById('file_import')?.click()
}
</script>

<template>
  <div class="menu-column" id="settingsWindow">
    <div class="tool-window-bar" @mousedown="uib.startToolWindowDrag?.($event, 'settingsWindow')">
      <span>设置窗口</span>
      <button type="button" title="关闭设置窗口" @click="uib.closeToolWindow?.('settings')">×</button>
    </div>
    <div class="header-row">
      <h2>UI 构造器 v79</h2>
      <div class="scale-control">
        <label>UI 缩放:</label>
        <input type="range" id="ui_scale_input" min="0.8" max="1.5" step="0.05" value="1.0" @input="uib.updateUIScale?.(($event.target as HTMLInputElement).value)">
        <span id="ui_scale_val">100%</span>
      </div>
    </div>

    <div class="uib-btn-grid">
      <button type="button" class="file-btn" @click="uib.savePreset?.()">保存预设</button>
      <button type="button" class="file-btn" @click="openPresetPicker">导入预设</button>
      <input type="file" id="file_import" style="display:none" @change="uib.loadPreset?.($event.target)" accept=".json">
    </div>
    <div class="uib-btn-grid">
      <button type="button" class="file-btn" id="undo_btn" :disabled="true" @click="uib.undoHistory?.()">撤销 (Ctrl+Z)</button>
      <button type="button" class="file-btn" id="redo_btn" :disabled="true" @click="uib.redoHistory?.()">重做 (Ctrl+Y)</button>
    </div>

    <div class="panel">
      <h4>全局设置</h4>
      <div class="input-row"><label>工作空间:</label><span id="ui_builder_workspace_name" class="uib-flex-1 uib-ok-text uib-bold">未连接</span></div>
      <div class="input-row"><label>Hash:</label><input type="text" id="char_hash" value="c209c22b" class="uib-ok-text uib-bold"></div>
      <div class="input-row"><label>Match Index:</label><input type="text" id="match_index" placeholder="59679" class="uib-ok-text"></div>
      <div class="input-row"><label>First Index:</label><input type="text" id="match_first_index" placeholder="0" class="uib-ok-text"></div>
      <div class="input-row">
        <label>屏幕宽高比:</label>
        <input type="number" id="global_aspect" value="1.777" step="0.001" @change="uib.updateAspectRatio?.()">
      </div>
      <div class="input-row">
        <label>网格宽比例:</label>
        <input type="number" id="grid_snap_x" value="0.02" step="0.005" min="0" @input="uib.updateGridSnapX?.()">
      </div>
      <div class="input-row">
        <label>网格高比例:</label>
        <input type="number" id="grid_snap_y" value="0.03554" step="0.005" min="0" @input="uib.updateGridSnapY?.()">
      </div>
      <div class="bind-row uib-row-gap">
        <div>
          <input type="checkbox" id="grid_snap_auto_y" :checked="true" @change="uib.toggleGridSnapAutoY?.()">
          <span class="lbl">高按宽高比自动同步</span>
        </div>
        <span class="var-tag">Grid XY</span>
      </div>
      <details class="fold-block shortcut-settings" :open="true">
        <summary>导出快捷键</summary>
        <div class="fold-body controls-body">
          <div class="input-row"><label for="shortcut_help">面板开关:</label><input type="text" id="shortcut_help" value="no_ctrl no_alt home" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_layout">布局模式:</label><input type="text" id="shortcut_layout" value="ctrl e" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_reset">重置位置:</label><input type="text" id="shortcut_reset" value="ctrl home" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_zoom_in">放大:</label><input type="text" id="shortcut_zoom_in" value="up" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_zoom_out">缩小:</label><input type="text" id="shortcut_zoom_out" value="down" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_dock">停靠修饰键:</label><input type="text" id="shortcut_dock" value="alt" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_drag">备用拖拽:</label><input type="text" id="shortcut_drag" value="no_ctrl alt Q" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div class="input-row"><label for="shortcut_mouse">鼠标拖拽:</label><input type="text" id="shortcut_mouse" value="VK_LBUTTON" @input="uib.validateShortcutSettings?.()" @change="uib.normalizeShortcutInput?.($event.target)"></div>
          <div id="shortcut_status" class="shortcut-status" aria-live="polite"></div>
          <button type="button" @click="uib.resetShortcutSettings?.()">恢复默认快捷键</button>
        </div>
      </details>
      <div class="bind-row uib-row-gap">
        <div>
          <input type="checkbox" id="show_anim_panel" @change="uib.toggleAnimationPanel?.()">
          <span class="lbl">显示动画面板</span>
        </div>
        <span class="var-tag">Anim UI</span>
      </div>
    </div>

    <div class="panel">
      <h4>添加组件</h4>
      <div class="uib-btn-grid">
        <button type="button" @click="uib.addComponent?.('slider_h')">水平滑条</button>
        <button type="button" @click="uib.addComponent?.('slider_v')">垂直滑条</button>
        <button type="button" @click="uib.addComponent?.('joystick')">摇杆</button>
        <button type="button" @click="uib.addComponent?.('toggle')">开关</button>
        <button type="button" class="uib-btn-danger" @click="uib.addComponent?.('accum')">积蓄条</button>
        <button type="button" @click="uib.addComponent?.('static')">静态图片</button>
        <button type="button" class="uib-btn-violet" @click="uib.addComponent?.('sequence')">序列动画</button>
        <button type="button" class="uib-btn-orange uib-span-2" @click="uib.addComponent?.('text')">文本框（增强版）</button>
      </div>
    </div>
  </div>
</template>
