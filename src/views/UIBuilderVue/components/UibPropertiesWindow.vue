<script setup lang="ts">
/* 属性窗口:编组属性 / 组件属性(初始值、序列帧、文本、物理、自动动画、
   积蓄条、嵌套联动、模式、几何、可视性)。
   各分组显隐由引擎按选中实体类型切换,元素 id 全部保持引擎约定。 */
import { uib } from '../useUib'

const openBatchSeqPicker = (): void => {
  document.getElementById('u_batch_seq')?.click()
}
</script>

<template>
  <div class="component-panel-wrap" id="componentPanelWrap">
    <div class="tool-window-bar" @mousedown="uib.startToolWindowDrag?.($event, 'componentPanelWrap')">
      <span>属性窗口</span>
      <button type="button" title="关闭属性窗口" @click="uib.closeToolWindow?.('properties')">×</button>
    </div>
    <div class="panel" id="propPanel" style="display:none; border-color:var(--accent-color);">
      <h4 style="color:var(--accent-color)">属性设置</h4>
      <button type="button" class="copy-btn" @click="uib.copyPropsToSelection?.()">应用属性到同类选中项</button>

      <div id="group_prop_panel" style="display:none;">
        <div class="input-group">
          <div class="input-row">
            <label>编组名称:</label>
            <input type="text" id="g_name" @input="uib.updateGroupProps?.()">
          </div>
          <div class="input-row">
            <label>显示变量:</label>
            <input type="text" id="g_vis_var" placeholder="$Show_Group" @input="uib.updateGroupProps?.()">
          </div>
          <div class="bind-row">
            <div>
              <input type="checkbox" id="g_vis_default" @change="uib.updateGroupProps?.()">
              <span class="lbl">显示变量默认开启</span>
            </div>
            <span id="g_vis_var_name" class="var-tag"></span>
          </div>
          <div class="pinned-row">
            <div>
              <input type="checkbox" id="g_pinned" @change="uib.updateGroupProps?.()">
              <span class="lbl">默认固定</span>
            </div>
            <span id="g_pin_var_name" class="var-tag"></span>
          </div>
          <div class="bind-row">
            <div>
              <input type="checkbox" id="g_binding_enabled" @change="uib.updateGroupProps?.()">
              <span class="lbl">启用参数绑定</span>
            </div>
            <span id="g_bind_var_name" class="var-tag"></span>
          </div>
        </div>
      </div>

      <div id="component_prop_panel" style="display:none;">
        <div id="component_group_notice" class="anim-note" style="display:none; margin-bottom:8px;"></div>

        <!-- Toggle Initial Value -->
        <div class="input-row uib-tint-row" id="row_initial_val" style="display:none;">
          <div class="checkbox-wrapper">
            <label class="uib-flex-label">初始状态（默认开启）:</label>
            <input type="checkbox" id="p_initial_val" @change="uib.updateData?.()">
          </div>
        </div>
        <div class="input-row uib-tint-row uib-tint-amber" id="row_toggle_invert" style="display:none;">
          <div class="checkbox-wrapper">
            <label class="uib-flex-label" title="开启后：默认开启时绑定变量=0，关闭时=1（与开关状态相反）">反转绑定变量:</label>
            <input type="checkbox" id="p_toggle_invert" @change="uib.updateData?.()">
          </div>
        </div>
        <div class="input-row uib-tint-row" id="row_initial_num" style="display:none;">
          <label>初始数值:</label>
          <input type="number" id="p_initial_num" step="1" min="0" value="0" @change="uib.updateData?.()">
        </div>

        <!-- Sequence Logic -->
        <div id="seq_editor_group" class="uib-block-violet" style="display:none;">
          <div class="input-row">
            <label class="uib-ok-text">控制变量:</label>
            <input type="text" id="p_seq_var" placeholder="$State" @input="uib.updateSeqVar?.()" class="uib-input-ok">
          </div>
          <div class="uib-flex-wrap">
            <button type="button" class="uib-btn-ok uib-flex-1" @click="openBatchSeqPicker">批量导入</button>
            <input type="file" id="u_batch_seq" :multiple="true" style="display:none" @change="uib.batchUploadSeq?.($event.target)" accept="image/*">
            <button type="button" class="uib-flex-half" @click="uib.addFrame?.()">+</button>
            <button type="button" class="uib-btn-danger uib-flex-half" @click="uib.clearFrames?.()">清空</button>
          </div>
          <div id="seq_list_container" class="seq-list"></div>
        </div>

        <div id="text_editor_group" class="uib-block-orange" style="display:none;">
          <div class="input-row"><label class="uib-orange-text uib-bold">文本内容:</label></div>
          <div class="input-row"><textarea id="p_text_content" @input="uib.updateTextContent?.()"></textarea></div>

          <div class="input-row">
            <label>字体:</label>
            <input type="text" id="p_font_family" list="font_list" value="Microsoft YaHei" @change="uib.updateTextProps?.()">
            <datalist id="font_list">
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="SimHei">黑体</option>
              <option value="SimSun">宋体</option>
              <option value="Arial">Arial</option>
              <option value="Impact">Impact</option>
            </datalist>
          </div>

          <div class="input-row">
            <label>样式:</label>
            <div class="checkbox-wrapper">
              <label class="uib-inline-check">加粗</label>
              <input type="checkbox" id="p_font_bold" @change="uib.updateTextProps?.()">
              <label class="uib-inline-check uib-inline-check-gap">斜体</label>
              <input type="checkbox" id="p_font_italic" @change="uib.updateTextProps?.()">
            </div>
          </div>

          <div class="input-row">
            <label>排布方向:</label>
            <select id="p_text_flow" @change="uib.updateTextProps?.()">
              <option value="horizontal">横向排列</option>
              <option value="vertical">竖向排列</option>
            </select>
          </div>

          <div class="input-group uib-group-accent">
            <h4 class="uib-subhead-accent">独立显示</h4>
            <div class="bind-row">
              <div>
                <input type="checkbox" id="p_text_visibility_enabled" @change="uib.updateTextProps?.()">
                <span class="lbl">启用显示变量</span>
              </div>
              <input type="text" id="p_text_vis_var" aria-label="显示变量" placeholder="$text_show_0" @input="uib.updateTextProps?.()" class="uib-input-mono-flex">
              <span id="p_text_vis_var_name" style="display:none;"></span>
            </div>
            <div class="bind-row">
              <div>
                <input type="checkbox" id="p_text_vis_default" @change="uib.updateTextProps?.()">
                <span class="lbl">默认显示</span>
              </div>
            </div>
          </div>

          <div class="bind-row" style="margin-bottom:8px;">
            <div>
              <input type="checkbox" id="p_text_hover_effect" @change="uib.updateTextProps?.()">
              <span class="lbl">悬停放大与边缘高光</span>
            </div>
          </div>

          <div class="input-group uib-group-amber">
            <h4 class="uib-subhead-amber">点击开关</h4>
            <div class="input-row">
              <label>绑定变量:</label>
              <input type="text" id="p_text_click_var" placeholder="$text_show_0" @input="uib.updateTextProps?.()" class="uib-input-amber">
            </div>
          </div>

          <div class="input-row uib-tint-row">
            <label>颜色设置:</label>
            <input type="color" id="p_font_color" value="#ffffff" class="uib-color-input" @input="uib.applyTextColor?.(($event.target as HTMLInputElement).value)">
            <div class="uib-color-hint">
              * 选中文字修改局部<br>* 未选中则修改默认
            </div>
          </div>

          <div class="input-row">
            <label class="uib-ok-text">数值变量:</label>
            <input type="text" id="p_val_var" placeholder="{val}，导出为 000~999" title="运行时取整并限制到 0~999，始终显示三位" @input="uib.updateTextProps?.()" class="uib-input-ok">
          </div>

          <div class="input-row"><label>字符大小:</label><input type="number" id="p_char_size" step="0.001" @change="uib.updateTextProps?.()"></div>
          <div class="input-row"><label>行间距:</label><input type="number" id="p_line_gap" step="0.001" @change="uib.updateTextProps?.()"></div>
          <div class="input-row"><label>导出像素:</label><input type="number" id="gen_tex_size" value="128" step="16" title="字体图片分辨率"></div>
        </div>

        <div id="logic_wrapper">
          <div class="phys-row" id="row_phys">
            <div>
              <input type="checkbox" id="p_phys" @change="uib.updateData?.()">
              <span id="phys_label" class="lbl">物理效果</span>
            </div>
            <span id="phys_var_name" class="var-tag"></span>
          </div>
          <div id="phys_config_panel" class="uib-block-mint" style="display:none;">
            <h4 class="uib-subhead-ok">物理与自动动画控制</h4>
            <details class="fold-block">
              <summary>物理模式说明</summary>
              <div class="fold-body controls-body">
                - <b>弹性 (K)</b> 越大，回弹越快，动作越紧致。<br>
                - <b>阻尼 (D)</b> 越大，晃动越少，接近 1 时更稳定。<br>
                - <b>自动动画</b> 组件空闲时也可按设定持续运动。<br>
                - <b>乳摇模式</b> 会保留更多惯性尾部和拖拽延迟。<br>
                - <b>重力</b> 用于制造额外下坠感。
              </div>
            </details>
            <details class="fold-block">
              <summary>自动动画 / 轨迹说明</summary>
              <div class="fold-body controls-body">
                - <b>自动动画</b> 开启后会生成对应的 <code>$auto_x</code> 等控制变量。<br>
                - <b>轨迹刷新</b> 用于控制混沌轨迹多久重算一次。<br>
                - <b>幅度 / 幅度范围</b> 用于控制自动运动范围。<br>
                - <b>随机 / 轨迹种子</b> 用于改变轨迹初始状态。<br>
                - <b>动画速度</b> 控制函数或轨迹在 0 到 1 内的推进速度。<br>
                - <b>响应 / 回弹 / 重力</b> 用于调整整体动态手感。
              </div>
            </details>
            <div class="uib-algo-note">
              <b class="uib-ok-text">算法说明:</b><br>
              - <b>弹性 (K)</b> 影响回弹速度，值越大越灵敏。<br>
              - <b>阻尼 (D)</b> 控制速度衰减，越接近 1 越稳定。<br>
              - <b>自动强度</b> 为 1 时完全跟随自动轨迹，0 时关闭。<br>
              - <b>自动范围</b> 控制自动运动时的最大偏移。<br>
              - <b>随机 / 轨迹种子</b> 影响轨迹的相位和形态。<br>
              - <b>幅度 / 幅度范围</b> 影响函数模式或混沌模式的振幅。<br>
              - <b>轨迹刷新</b> 控制混沌模式的采样频率。<br>
              - <b>乳摇模式</b> 会产生更多拖尾和延迟。<br>
              - <b>重力</b> 用于增加向下偏移。<br>
              - 适合摇杆、跟随滑条、双态控件等需要动态反馈的组件。
            </div>
            <div class="input-row">
              <label class="uib-ok-text">弹性强度 (K):</label>
              <input type="number" id="p_spring_k_val" value="0.05" step="0.01" min="0" max="1" @change="uib.updatePhysParamsDirect?.()" class="uib-input-ok">
            </div>
            <div class="input-row">
              <label class="uib-ok-text">阻尼系数 (D):</label>
              <input type="number" id="p_spring_d_val" value="0.95" step="0.01" min="0" max="1" @change="uib.updatePhysParamsDirect?.()" class="uib-input-ok">
            </div>
            <div class="input-row" id="row_phys_profile" style="display:none;">
              <label class="uib-accent-hi">物理模式:</label>
              <select id="p_phys_profile" @change="uib.updatePhysProfile?.()" class="uib-input-accent">
                <option value="normal">普通模式</option>
                <option value="breast">乳摇模式</option>
              </select>
            </div>
            <div id="phys_profile_hint" class="uib-accent-hi uib-phys-hint" style="display:none;">
              乳摇模式会保留更多边缘延迟、回弹和下坠感，适合柔性摆动部件。
            </div>
            <details id="auto_anim_section" class="fold-block">
              <summary>自动动画参数</summary>
              <div class="fold-body controls-body">
                <div class="input-row uib-space-between">
                  <label class="uib-amber-text">自动动画:</label>
                  <div class="uib-check-with-tag">
                    <input type="checkbox" id="p_auto_animate" @change="uib.updateAutoAnimate?.()">
                    <span id="auto_var_name" class="var-tag"></span>
                  </div>
                </div>
                <div class="input-row">
                  <label class="uib-amber-text">牵引强度:</label>
                  <input type="number" id="p_auto_str" value="0.10" step="0.01" min="0" max="1" @change="uib.updateAutoStr?.()" class="uib-input-amber">
                </div>
                <div class="input-row" id="row_auto_source">
                  <label class="uib-accent-hi">轨迹来源:</label>
                  <select id="p_auto_source" @change="uib.updateAutoSource?.()" class="uib-input-accent">
                    <option value="chaos">混沌轨迹</option>
                    <option value="function">自定义函数</option>
                  </select>
                </div>
                <div class="input-row" id="row_auto_amp_x">
                  <label id="lbl_auto_amp_x" class="uib-amber-text">幅度范围:</label>
                  <input type="number" id="p_auto_amp_x" value="1" step="0.01" min="0" max="3" @change="uib.updateAutoAmpX?.()" class="uib-input-amber">
                </div>
                <div class="input-row" id="row_auto_amp_y">
                  <label class="uib-amber-text">Y 轴范围:</label>
                  <input type="number" id="p_auto_amp_y" value="1" step="0.01" min="0" max="3" @change="uib.updateAutoAmpY?.()" class="uib-input-amber">
                </div>
                <div class="input-row" id="row_auto_seed_x">
                  <label id="lbl_auto_seed_x" class="uib-accent-hi">随机种子:</label>
                  <input type="number" id="p_auto_seed_x" value="0.3187" step="0.0001" min="0.001" max="0.999" @change="uib.updateAutoSeedX?.()" class="uib-input-accent">
                </div>
                <div class="input-row" id="row_auto_seed_y">
                  <label class="uib-accent-hi">Y 轴种子:</label>
                  <input type="number" id="p_auto_seed_y" value="0.6123" step="0.0001" min="0.001" max="0.999" @change="uib.updateAutoSeedY?.()" class="uib-input-accent">
                </div>
                <div class="input-row" id="row_auto_func_x" style="display:none;">
                  <label id="lbl_auto_func_x" class="uib-accent-hi">函数 f(t):</label>
                  <input type="text" id="p_auto_func_x" value="sin01(t)" @input="uib.previewAutoFunc?.('x')" @change="uib.updateAutoFuncX?.()" class="uib-input-accent" placeholder="sin01(t)">
                </div>
                <div class="input-row" id="row_auto_func_y" style="display:none;">
                  <label class="uib-accent-hi">函数 Y(t):</label>
                  <input type="text" id="p_auto_func_y" value="cos(TAU * t)" @input="uib.previewAutoFunc?.('y')" @change="uib.updateAutoFuncY?.()" class="uib-input-accent" placeholder="cos(TAU * t)">
                </div>
                <div class="input-row" id="row_auto_speed">
                  <label class="uib-accent-hi">动画速度:</label>
                  <input type="number" id="p_auto_speed" value="0.015" step="0.002" min="0" max="0.2" @change="uib.updateAutoSpeed?.()" class="uib-input-accent">
                </div>
                <div class="input-row">
                  <label class="uib-accent-hi">目标平滑:</label>
                  <input type="number" id="p_auto_response" value="0.22" step="0.01" min="0.01" max="1" @change="uib.updateAutoResponse?.()" class="uib-input-accent">
                </div>
                <div class="input-row">
                  <label class="uib-accent-hi">边界反弹:</label>
                  <input type="number" id="p_auto_bounce" value="0.25" step="0.01" min="0" max="1" @change="uib.updateAutoBounce?.()" class="uib-input-accent">
                </div>
                <div class="input-row">
                  <label class="uib-orange-text">伪重力:</label>
                  <input type="number" id="p_gravity" value="0" step="0.005" min="0" max="1" @change="uib.updateGravity?.()" class="uib-input-orange">
                </div>
                <div class="input-row">
                  <label id="lbl_auto_rate" class="uib-amber-text">轨迹刷新:</label>
                  <input type="number" id="p_chaos_rate" value="96" step="1" min="1" max="240" @change="uib.updateChaosRate?.()" class="uib-input-amber">
                </div>
                <details id="auto_func_hint" class="fold-block" style="display:none;">
                  <summary>自定义函数语法</summary>
                  <div class="fold-body">
                    支持变量 <code>t</code>，范围为 0~1。<br>
                    范围说明：摇杆函数通常返回 <code>-1 ~ 1</code>，普通滑条函数通常返回 <code>0 ~ 1</code>。<br>
                    摇杆圆周示例：<code>X(t)=sin(TAU*t)</code>，<code>Y(t)=cos(TAU*t)</code>。<br>
                    如果想让轨迹更大，可以直接写成 <code>1.6*sin(TAU*t)</code> / <code>1.6*cos(TAU*t)</code>，再配合范围、响应和回弹调整。<br>
                    支持运算符 <code>+ - * / %</code> <code>&lt; &lt;= &gt; &gt;= == !=</code> <code>&amp;&amp; || !</code> <code>?:</code><br>
                    支持常量：<code>PI</code> <code>TAU</code> <code>E</code><br>
                    支持函数：<code>sin</code> <code>cos</code> <code>tan</code> <code>asin</code> <code>acos</code> <code>atan</code> <code>atan2</code> <code>abs</code> <code>min</code> <code>max</code> <code>pow</code> <code>sqrt</code> <code>cbrt</code> <code>log</code> <code>log2</code> <code>exp</code> <code>floor</code> <code>ceil</code> <code>round</code> <code>sign</code> <code>clamp</code> <code>fract</code> <code>mix</code> <code>lerp</code> <code>step</code> <code>smoothstep</code> <code>saw</code> <code>tri</code> <code>pingpong</code> <code>sin01</code> <code>cos01</code> <code>mod</code> <code>repeat</code> <code>saturate</code> <code>invlerp</code> <code>pulse</code> <code>select</code> <code>bezier3</code> <code>bezier4</code>。<br>
                    表达式会在导出前校验，确保可以安全写入 3DM INI 自动计算段。
                  </div>
                </details>
                <div id="auto_func_preview_wrap" style="display:none; margin-top:8px;">
                  <div class="uib-preview-title">函数轨迹预览</div>
                  <canvas id="auto_func_preview" width="300" height="140" class="uib-func-canvas"></canvas>
                  <div id="auto_func_preview_caption" class="shader-status"></div>
                </div>
              </div>
            </details>
          </div>
          <div id="accum_panel" class="uib-block-coral" style="display:none;">
            <h4 class="uib-subhead-coral">积蓄条配置</h4>
            <div class="uib-note-coral">
              绑定滑条/摇杆/开关后，仅统计<b>手柄被鼠标拖拽</b>产生的位移（含模型区域拖拽）；自动动画、物理回弹不计入。<br>
              滑条按拖拽距离累计（来回一次记 2），摇杆记两轴位移之和，开关每次点击记 1。达到积蓄槽值时触发下方变量并自动归零重新统计。
            </div>
            <div class="input-row">
              <label class="uib-coral-text">方向:</label>
              <select id="p_accum_direction" @change="uib.updateAccumProps?.()">
                <option value="h">水平</option>
                <option value="v">垂直</option>
              </select>
            </div>
            <div class="input-row">
              <label class="uib-coral-text">积蓄槽值:</label>
              <input type="number" id="p_accum_threshold" step="0.1" min="0.1" value="5" @change="uib.updateAccumProps?.()">
            </div>
            <h4 class="uib-subhead-coral-sm">绑定组件（统计其拖拽位移/点击）</h4>
            <div id="accum_bindings_list" class="uib-stack-list"></div>
            <button type="button" class="uib-mini-btn uib-btn-danger" @click="uib.addAccumBinding?.()">+ 添加绑定</button>
            <h4 class="uib-subhead-amber-sm">达到阈值后触发变量</h4>
            <div class="uib-note-amber-sm">达到积蓄槽值时将以下变量设为指定值，然后积蓄槽归零重新统计。</div>
            <div id="accum_triggers_list" class="uib-stack-list"></div>
            <button type="button" class="uib-mini-btn uib-btn-warn" @click="uib.addAccumTrigger?.()">+ 添加触发变量</button>
          </div>
          <div id="linked_slaves_panel" class="uib-block-orange" style="display:none;">
            <h4 class="uib-subhead-orange">嵌套联动（区间映射）</h4>
            <div class="uib-note-amber">
              将本组件的值通过区间映射到其他滑块/遥杆组件。例如本组件 0~0.5 映射到目标 0~1。
            </div>
            <div id="linked_slaves_list" class="uib-stack-list-lg"></div>
            <button type="button" class="uib-mini-btn uib-btn-ok" @click="uib.addLinkedSlave?.()">+ 添加联动目标</button>

            <h4 class="uib-subhead-accent-split">独立区间触发</h4>
            <div class="uib-note-accent">
              无需绑定目标组件，自由设置区间及其进入/离开动作。仅当本组件值进入或离开区间时触发动作。
            </div>
            <div id="range_triggers_list" class="uib-stack-list-lg"></div>
            <button type="button" class="uib-mini-btn uib-btn-accent" @click="uib.addRangeTrigger?.()">+ 添加独立区间触发</button>
          </div>
          <div class="input-group">
            <div class="input-row" id="row_switch_group" style="display:none;">
              <label>切换分组 ID:</label>
              <input type="number" id="p_switch_group" step="1" min="0" value="0" @change="uib.updateSwitchGroup?.()" placeholder="0 为未分组">
            </div>
            <div class="input-row" id="row_mode"><label>模式:</label><select id="p_mode" @change="uib.changeMode?.()"></select></div>
            <div class="input-row" id="row_toggle_steps" style="display:none;">
              <label>档位数量:</label>
              <input type="number" id="p_toggle_steps" step="1" min="1" value="5" @change="uib.updateToggleSteps?.()" placeholder="5">
            </div>
            <div class="input-row" id="row_grid_steps" style="display:none;">
              <label>档位数量:</label>
              <input type="number" id="p_grid_steps" step="1" min="1" value="3" @input="uib.updateGridSteps?.()" placeholder="3">
            </div>
            <div class="input-row" id="row_grid_value_start" style="display:none;">
              <label>起始值:</label>
              <input type="number" id="p_grid_value_start" step="any" value="0" @input="uib.updateGridValueRange?.()" placeholder="0">
            </div>
            <div class="input-row" id="row_grid_value_step" style="display:none;">
              <label>每档增量:</label>
              <input type="number" id="p_grid_value_step" step="any" value="1" @input="uib.updateGridValueRange?.()" placeholder="1（不可为 0）">
            </div>
            <div class="input-row" id="row_slider_subdiv" style="display:none;">
              <label id="slider_subdiv_label">行程细分:</label>
              <input type="number" id="p_slider_subdiv" step="1" min="1" max="8" value="1" @change="uib.updateSliderSubdivisions?.()" placeholder="1">
            </div>
            <div class="input-row" id="row_joy_dir_count" style="display:none;">
              <label>方向数量:</label>
              <input type="number" id="p_joy_dir_count" step="1" min="3" max="32" value="4" @change="uib.updateJoystickDirectionCount?.()" placeholder="4">
            </div>
            <div class="input-row" id="row_joy_subdiv" style="display:none;">
              <label>每向细分:</label>
              <input type="number" id="p_joy_subdiv" step="1" min="1" max="8" value="1" @change="uib.updateJoystickSubdivisions?.()" placeholder="1">
            </div>
            <div class="input-row" id="row_joy_angle_offset" style="display:none;">
              <label>起始角度:</label>
              <input type="number" id="p_joy_angle_offset" step="1" min="0" max="359" value="0" @change="uib.updateJoystickAngleOffset?.()" placeholder="0">
            </div>
            <div class="input-row" id="row_joy_default_x" style="display:none;">
              <label>默认 X:</label>
              <input type="number" id="p_joy_default_x" step="0.01" min="-1" max="1" value="0" @change="uib.updateJoystickDefaultX?.()" placeholder="0">
            </div>
            <div class="input-row" id="row_joy_default_y" style="display:none;">
              <label>默认 Y:</label>
              <input type="number" id="p_joy_default_y" step="0.01" min="-1" max="1" value="0" @change="uib.updateJoystickDefaultY?.()" placeholder="0">
            </div>
            <div id="joy_algo_hint" class="uib-hint-box" style="display:none;">
              方向变量按相邻两个方向混合计算；第 0 个方向的角度 = 起始角度 + n × (360 / 方向数量)
            </div>
            <div id="slider_subdiv_hint" class="uib-hint-box" style="display:none;">
              前一段到达 1 后保持不变，当前段继续从 0 增长到 1。
            </div>

            <div class="input-row uib-tint-row uib-tint-mint" id="row_zone_drag" style="display:none;">
              <div class="checkbox-wrapper">
                <label class="uib-flex-label uib-mint-text">模型区域拖拽:</label>
                <input type="checkbox" id="p_zone_drag_enabled" @change="uib.updateZoneDragEnabled?.()">
              </div>
            </div>
            <div class="input-row" id="row_zone_drag_var" style="display:none;">
              <label>区域变量名:</label>
              <input type="text" id="p_zone_drag_var" @change="uib.updateZoneDragVar?.()" placeholder="$ssmtdrag_ui_zone_命名空间">
            </div>
            <div class="input-row" id="row_zone_drag_id" style="display:none;">
              <label>命中区域编号:</label>
              <input type="number" id="p_zone_drag_id" step="1" min="0" value="0" @change="uib.updateZoneDragZoneId?.()">
            </div>
            <div class="anim-note" id="zone_drag_hint" style="display:none;">
              启用后，模型侧拖拽交互处于<b>仅命中模式（模式 1）</b>时：按住 Alt 并点击左键（或按 X 键）命中模型指定区域，即绑定本组件手柄——手柄从当前值出发、按鼠标位移相对移动（不会瞬间跳到光标位置）；绑定后移出区域也不会中断，松开左键 / X 键 / Alt 后绑定结束并照常回弹/吸附。面板关闭（Home 收起）时同样生效，模式 0 / 2 不会触发绑定；光标在组件上的原有拖拽不受影响。<br>
              “区域变量名”必须与模型侧（TheHerta4 拖拽交互节点）导出的命中区域变量一致——节点保留默认名 ssmtdrag_ui_zone 时会自动追加命名空间后缀，请填写节点上显示的最终变量名（如 $ssmtdrag_ui_zone_xxx），命名空间会自动从该变量名推导并用于匹配模型侧按键状态变量；“命中区域编号”与节点的区域 ID 完全一致，未命中时该变量为 -1。<br>
              浏览器内的布局预览无法模拟，导出后在游戏内生效。
            </div>
            <div id="generic_var_block">
              <h4 class="uib-var-head">绑定变量列表</h4>
              <div class="var-list" id="var_container"></div>
              <button type="button" class="add-var-btn" id="btn_add_var" @click="uib.addVar?.()">+ 添加变量</button>
            </div>
          </div>
        </div>

        <div class="input-group">
          <div class="input-row"><label>X (Screen):</label><input type="number" id="p_x" step="0.01" @change="uib.updateGeom?.()"></div>
          <div class="input-row"><label>Y (Screen):</label><input type="number" id="p_y" step="0.01" @change="uib.updateGeom?.()"></div>
          <div class="input-row"><label>W (Screen):</label><input type="number" id="p_w" step="0.01" @change="uib.updateGeom?.()"></div>
          <div class="input-row"><label>H (Screen):</label><input type="number" id="p_h" step="0.01" @change="uib.updateGeom?.()"></div>
          <div class="input-row">
            <label>圆角 (px):</label>
            <input type="number" id="p_corner_radius" step="0.1" min="0" @change="uib.updateGeom?.()">
          </div>
          <div class="input-row uib-tint-row uib-tint-amber">
            <label class="uib-amber-text uib-bold">旋转 (度):</label>
            <input type="number" id="p_rot" step="1" @change="uib.updateGeom?.()" class="uib-amber-text uib-bold">
          </div>
          <div class="input-row uib-tint-row uib-tint-dark">
            <label>层级 (Z):</label>
            <input type="number" id="p_z" step="1" @change="uib.updateGeom?.()" class="uib-amber-text uib-bold">
          </div>
          <div class="input-row uib-tint-row uib-tint-accent" id="row_follow_cursor" style="display:none;">
            <div class="checkbox-wrapper">
              <label class="uib-flex-label uib-accent-hi">跟随鼠标指针:</label>
              <input type="checkbox" id="p_follow_cursor" @change="uib.updateFollowCursor?.()">
            </div>
          </div>
          <div class="input-row" id="row_follow_offset" style="display:none; padding:5px;">
            <label class="uib-accent-hi">跟随偏移 X/Y:</label>
            <input type="number" id="p_follow_offset_x" step="0.05" @change="uib.updateFollowOffset?.()" title="水平偏移（组件宽度比例）：0.5=水平居中，1=组件在指针左侧，0=在右侧，可填小数或超出 0~1 的值">
            <input type="number" id="p_follow_offset_y" step="0.05" @change="uib.updateFollowOffset?.()" title="垂直偏移（组件高度比例）：0.5=垂直居中，1=组件在指针上方，0=在下方，可填小数或超出 0~1 的值">
          </div>
          <div class="anim-note" id="follow_cursor_hint" style="display:none;">运行时组件始终跟随鼠标指针，并让出点击；编辑布局时不生效，可在“运行”模式预览。<br>跟随偏移以组件宽/高为单位：0.5=中心对准指针；X=1 靠左、X=0 靠右、Y=1 靠上、Y=0 靠下；可填小数实现斜对角，也可超出 0~1 与指针留出间距。</div>
        </div>

        <div class="input-group" id="vis_group">
          <div class="input-row" id="row_handle_size"><label>把手大小:</label><input type="number" id="p_hs" step="0.001" @change="uib.updateVis?.()"></div>
          <div class="input-row"><label>轨道/填充粗细:</label><input type="number" id="p_tt" step="0.001" @change="uib.updateVis?.()"></div>
        </div>

        <button type="button" class="danger uib-delete-btn" @click="uib.deleteItem?.()">删除项目 (DEL)</button>
      </div>
    </div>
  </div>
</template>
