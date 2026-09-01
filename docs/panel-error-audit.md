# 面板错误审计清单 — ui-builder-v79.html 生成器 vs 希格莉德·空岛传奇 已生成 INI

- 审计员: analyzer (panel-error-fix)
- 日期: 2026-08-31
- 生成器: `E:\代码\SSMT4-Alpha-main\public\ui-builder-v79.html` 与 `E:\代码\SSMT4-Alpha-main\dist\ui-builder-v79.html` **双副本逐字节一致**（SHA256 前缀 B10CF70EE3D1，1055970 字节；上传副本 .dsh-filess 对应物亦一致），共 17054 行
- **修复须同步应用到 dist/public 双副本**（权威源码以 E:\代码\SSMT4-Alpha-main 下双副本为准）；行号以该文件为准
- 已生成配置: `K:\SSMT-Package-master\WorkSpace\ZZMI\希格莉德·空岛传奇\ui_config_19086112_20260831_215335.ini`（19522 行）
- 预设: `K:\SSMT-Package-master\WorkSpace\ZZMI\希格莉德·空岛传奇\presets\ui_preset_19086112_20260831_215328.json`（18 个组件）

## 关键实体映射（已从预设/INI 双向验证）

| 条目 | 预设索引 | INI 显示编号 | id | 说明 |
|---|---|---|---|---|
| 开关294 | 14 | Component 15（`$val_14`） | comp_1788036157642_294 | toggle, vars=`["$auto_9","$auto_4"]`, initialValue=0, 无 switchGroup |
| 联动目标A | 4 | Component 5（`$val_4_x/y`） | comp_1787927972343_17 | joystick, paramMode=4, autoAnimate=True, physics=True |
| 联动目标B | 9 | Component 10（`$val_9_x/y`） | comp_1787991384661_47 | joystick, paramMode=4, autoAnimate=True, physics=True |
| 联动源 | 10 | Component 11（$val_10_x/y） | comp_1787991385652_55 | joystick, paramMode=4, 两个 rect linkedSlaves（postEnabled=True）→ comp4 / comp9 |

预设立场：comp10 的两个联动均为 `regionMode=rect`、`postEnabled=True`（碰撞桩）、`overflow=reset`、进入/离开动作 `$AAsdefsdfdsf`（此变量为预设用户数据，非生成器错误）。

## 机制背景（生成器语义）

- `$auto_<idx>` 是 **`global persist`** 的自动动画主开关（生成器 15138/15177 行：`global persist $auto_${i} = ${autoDefault}`，autoEnabled 时默认 1）。
- 设计文档（生成器 6359-6364 行 `getPreviewAutoEnableValue`）明确：`$auto_<索引>` 可被其他组件（开关/滑块/摇杆）**绑定为自己的输出变量**来控制目标自动动画；"没有绑定者时返回 1"。
- Sync Bindings（生成器 16822-16833；INI 16588-16604）双向：面板值变 → 推送绑定变量；绑定变量被外部改写 → **follow 反向把面板值拉向第一个绑定变量**（INI 16593-16594：`if $auto_9 != $val_14 → $val_14 = $auto_9`）。
- 物理自动动画引擎只 **读** `$auto`（生成器 16455/16523/16574/…：`if $auto_${i} == 1`），不写。
- 联动生成区（15891-16333）位于物理之前；Sync Bindings（16822+）位于其后 → 联动块对 `$auto` 的写入每帧都会被 follow 放大进面板值。

## 已确认错误清单

### A1 [BLOCKER · 根因1] 碰撞桩"曾激活后离开"分支无条件写 `$auto_<tgt>=1`
- **生成器**: `ui-builder-v79.html` 行 16039-16045（具体 16042-16044）
  ```js
  if(tgtHasPhysics) {
      // 曾激活后离开四边形：归零回弹，避免 $rest 停留在最后映射值
      block += `$rest_${tgtIdx}_x = 0\n$rest_${tgtIdx}_y = 0\n`;
      if(componentExportUsage[tgtIdx] && componentExportUsage[tgtIdx].autoEnabled) {
          block += `$auto_${tgtIdx} = 1\n`;      // ← 无条件恢复自动动画
      }
  }
  ```
- **INI 证据**:
  - 13923 行 `$auto_4 = 1`（comp10→comp4 左区，曾激活后离开）
  - 14139 行 `$auto_9 = 1`（comp10→comp9 右区，曾激活后离开）
- **放大链路**: 离开写 `$auto_9=1` → Sync Bindings follow（16593-16594）→ `$val_14 = $auto_9 = 1` → 开关294 隔空打开 → 目标摇杆自动动画启动（`if $auto_9 == 1` 物理段生效）。
- **严重性细节**: 无条件恢复 = 无视开关当前状态。即使玩家从未碰过开关（$val_14=0、$auto=0），进入→离开联动区后仍会被强拉为 1。
- **修复方向**: 联动激活/离开**不得直接写 `$auto`**。推荐引入每目标"联动占用闩锁"（如 `$linked_active_<tgtIdx>`，在物理自动驱动条件处组合 `if $auto_i == 1 && $linked_active_i == 0`）或进入时把 `$auto` 旧值存入影子变量、离开时还原旧值（而非硬编码 1）。需同时消除 A2/A3 的同类写。

### A2 [HIGH] 联动激活路径全部直接写 `$auto_<tgt>=0`（开关显示谎言 + persist 污染）
- **生成器写点**: 16083（rect 内，摇杆目标）、16115（rect 内，非摇杆）、16274（range 内激活）、16301/16308（keep_max 保持分支）。
- **INI 证据**: 14117 `$auto_4 = 0`、14333 `$auto_9 = 0`。
- **后果**: (a) 区域激活中，follow 把开关拉到 0——面板显示与玩家操作矛盾（显示说谎）；(b) `$auto` 是 `global persist`，激活中存档会把 0 永久写入，重启后目标不再自动动画。
- **修复方向**: 同上，改用闩锁组合而非直接写 0；或至少全部改为"影子变量 + 精确还原"。

### A3 [HIGH] 恢复不对称：除 A1 碰撞桩离开分支外，所有离开路径都不恢复 `$auto`
- **生成器**: 16126/16132（rect 非碰撞桩 out-of-quad reset）离开写 `$auto=0`；16282-16292（range overflow=reset 离开）只写 `$rest` 不写 `$auto`；keep_max（16301/16308）保持分支写 0 且无离开分支。
- **后果**: 非碰撞桩联动离开后目标自动动画**永久停摆**（直到手动翻转开关）；若绑定了开关，follow 会把开关拉成 0 并一直保持。
- **INI 现状**: 本预设两条联动都是碰撞桩 rect（不触发 A3 路径），但生成器缺陷在 v79 全局存在——任何非碰撞桩 linkedSlaves + 物理自动目标都会踩中。

### A4 [MEDIUM] `$auto` 为持久化用户开关，联动代码无权限双向改写
- 15138/15177 `global persist $auto_${i}`（注释明言"以覆盖 persist 存档残留"）。A1-A3 的所有直接写都会破坏用户开关语义（含 persist 写脏），属根因级设计缺陷——修复必须以"联动不写 $auto"为准绳。

### A5 [MEDIUM] Sync Bindings follow 未对"绑定 $auto 的开关 vs 联动写 $auto"做冲突隔离
- **生成器**: 16836 `noFollow = sharedBindingFlags[i] || linkedTargetComponentIds.has(m.id)`——只排除联动目标与镜像组件；**没有**排除"输出绑定到联动目标 $auto 的第三方组件"。
- **INI**: 16593-16594 follow 只跟 vars[0]（`$auto_9`），所以 comp4 区单独活动不翻转开关、comp9 区活动才翻转——行为取决于绑定顺序，纯属巧合。
- **修复方向**: 首选 A1-A4 的闩锁方案（联动绝不写 $auto），follow 冲突自然消失；若走"联动仍写 $auto"的中间路线，则必须把这类开关加入 noFollow（只推不拉），但这救不了 A2/A3/A4 的 persist 污染与永久停摆，不推荐。

### A6 [LOW] 开关点击推送绕过组绑定开关（bind mode）
- **生成器**: `buildClickActionCode` 14600-14615 点击时无条件 `$val_i = 1 - $val_i` + 逐个 push 绑定变量（`${v} = $val_i`），**不受** `bindingExpr`/`grp_bind_mode` 门控；只有 Sync Bindings 段（16837）被门控。
- **INI**: 13146-13148 无条件点击推送；16588 受 `if $grp_bind_mode_…== 1` 门控的同步。
- **后果**: 组绑定模式关掉后点击开关仍写 `$auto_9/$auto_4`——无法解耦。属次要一致性问题，修复时建议把点击推送也纳入 `bindingExpr` 门控（或明确该行为为设计意图并在文档说明）。

### A7 [LOW] 非 rect 联动块的 `$auto_goal/$auto_tgt` 每帧钉扎（16316-16323）
- 仅拖拽门控、无区间门控：联动不活动（区间外）也持续把 `$auto_goal_<tgt>=${tgtVar}`。自动重新开启时目标被钉在陈旧映射值。本预设 rect 块 16142 提前 return，未触发。低优先。

### A8 [INFO] 预览与导出行为不一致（$auto 联动写未建模）
- 预览 `getPreviewAutoEnableValue`（6365-6401）把 $auto 视为纯绑定驱动，未建模联动区的暂停/恢复写 → 预览无法复现"离开区开关自开"问题，因此修复必须同时按住预览与导出两套逻辑验证（评审/验证阶段事项）。

### A9 [INFO] INI 侧一致性
- 当前 INI 中所有非绑定方的 `$auto` 写共 6 处，全部可溯源于生成器 A1/A2 路径：13923/14139（A1 离开=1）、14117/14333（A2 进入=0）、1292-1293/1376-1377（ResetPosition/布局签名重置的绑定推送，属合法绑定行为，保留）。
- 开关的合法写保留：13146-13148（点击推送）、16590-16591（Sync Bindings 推送）。
- **修复后重新生成规则**: 用修复后的生成器重新导出即可让 INI 自动一致（$auto_9/$auto_4 的 6 处联动写消失，follow 冲突消失）；不建议手改 INI。

## 可验证修复验收点（供 engineer/verifier）
1. 生成器代码库中，linkedSlaves 生成路径不再出现 `$auto_${tgtIdx}` 直接赋值（A1-A3 共 8 个写点 16044/16083/16115/16126/16132/16274/16301/16308 全部消除或改为闩锁组合）。
2. 重新生成该预设后，INI 中非绑定方的 `$auto_4/$auto_9` 写为 0 处；`$linked_active_4/9`（若采用闩锁方案）在激活=1、离开=0。
3. 静态推演：开关 ON → 进入 comp9 区 → 开关仍显示 ON（不再被拉 0）；离开 → 开关仍 ON（不再被拉 1）；玩家从未碰开关 → 进出区域后开关保持 0。
4. 预览与导出使用同一 $auto 语义（A8）。
5. 回归：无联动/无物理/方向摇杆（paramMode=4）目标、keep_max/overflow=reset、碰撞桩开与关、多联动共享目标（后块覆盖）等路径语义不变。