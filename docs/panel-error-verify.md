# 面板错误修复验证报告 — ui-builder-v79.html 生成器 / 希格莉德·空岛传奇 INI

- 验证员: verifier (panel-error-fix)
- 日期: 2026-09-01
- 验证对象:
  - 生成器: `E:\代码\SSMT4-Alpha-main\public\ui-builder-v79.html` + `dist\ui-builder-v79.html`（t2 修复后）
  - INI: `K:\SSMT-Package-master\WorkSpace\ZZMI\希格莉德·空岛传奇\ui_config_19086112_20260831_215335.ini`（t3 修正后）
  - 备份: `ui_config_19086112_20260831_215335.ini.bak-pre-latch`（MD5 2CA5F8F0775BF349482724F0826D646D，与原始一致）
- 输入: `docs/panel-error-audit.md`（analyzer，t1）
- 方法: 静态语义验证（生成器源码全量检索 + INI 全量检索 + 备份→修正版 git diff + 内嵌 JS 语法自检 + 预览/导出双端语义对照 + 场景静态推演）

## 结论总览

| 验收项 | 结果 | 证据摘要 |
|---|---|---|
| 1. 离开联动区域不再覆盖 $auto_9/$auto_4 | **PASS** | 生成器 8 个写点全消除；INI 四边离开分支改为 $linked_active 清零 |
| 2. INI 内 $auto_ 写入路径语义正确 | **PASS** | $auto_4/$auto_9 写仅剩合法绑定路径（persist 声明/布局重置/已门控点击/Sync 推送） |
| 3. 预览端与导出端行为一致 | **PASS** | getPreviewAutoEnableValue 联动闩锁建模；导出物理条件同语义 |
| 4. 无语法/结构回归，生成器可加载 | **PASS** | node --check 通过；双副本逐字节一致；物理读/闩锁声明/联动写三处配对 |

四项全 PASS，无 FAIL。

---

## 1. 离开联动区域不再覆盖开关294绑定的 $auto_9/$auto_4 — PASS

### 1.1 生成器侧：linkedSlaves 路径零 $auto 写

穷举检索 `E:\代码\SSMT4-Alpha-main\public\ui-builder-v79.html`（18025 行）：

- 模式 `\$auto_\w* =`、`\$auto_[\$\w]+ = \$`、`\$auto_\$\{tgtIdx\}`：**全部零匹配**。
- `\$auto_\$\{` 全量 13 处出现分类：
  - 15185/15227：`global persist $auto_${i} = ${autoDefault}`（合法声明，autoEnabled 时默认 1）
  - 6393：预览读取（getPreviewAutoEnableValue）
  - 10831/10899/13092：UI 显示文案
  - 16515/16583/16634/16649/16666/16673/16721：物理自动驱动**只读条件** `if $auto_${i} == 1 && $linked_active_${i} == 0`（7 处）
- 审计 A1-A3 的 8 个写点（原始 16044/16083/16115/16126/16132/16274/16301/16308）在修复后对应位置全部变为闩锁操作：
  - rect 碰撞桩离开（16098-16109）：`$rest=0` + `$linked_active_${tgtIdx} = 0`，注释明示"由 $auto 真实值决定是否恢复自动动画——不直接写 $auto，避免覆盖绑定开关并触发 Sync Bindings follow 反向拉值（A1 修复）"
  - rect 激活（16142/16174）：`$rest/val` + `$linked_active = 1`
  - rect 非碰撞桩 out-of-quad reset（16185/16191）：`$rest` + `$linked_active = 0`
  - range 激活（16332）：`$linked_active = 1`
  - range overflow=reset 离开（16347）：`$linked_active = 0`
  - range keep_max 保持（16360/16367）：`$linked_active = 1`

### 1.2 INI 侧：离开分支语义修正实证

备份→修正版 git diff（7 hunk / 18+/12-，与 t3 声明逐条一致）确认原四边写死撤销：

```
@@ -13920,7 +13926,7 @@  （comp10→comp4 左区，曾激活后离开）
-            $auto_4 = 1
+            $linked_active_4 = 0
@@ -14136,7 +14142,7 @@  （comp10→comp9 右区，曾激活后离开）
-            $auto_9 = 1
+            $linked_active_9 = 0
```

修正版 INI 中 `$auto_4/$auto_9` 的**全部 20 处**出现（grep 穷举），无一为联动路径写：

| 行 | 内容 | 分类 |
|---|---|---|
| 207/208 | `global persist $auto_9/$auto_4`（无值声明） | 合法声明 |
| 564/827 | `global persist $auto_4/$auto_9 = 1`（带初值声明） | 合法声明（autoDefault=1） |
| 1294-1295/1378-1379 | `$auto_9 = 0 / $auto_4 = 0` | 布局签名重置的绑定推送（开关默认 OFF 推送，A9 保留合法） |
| 13152-13153 | `$auto_9/$auto_4 = $val_14` | 开关点击推送（已包 `if $grp_bind_mode_1788036223682_297 == 1` 门） |
| 16596-16597 | `$auto_9/$auto_4 = $val_14` | Sync Bindings 推送（已包同门控 16594） |
| 16599-16600 | `if $auto_9 != $val_14 → $val_14 = $auto_9` | Sync follow（读，见第 2 节） |
| 14406/14960/14970/15019/15573/15583 | `if $auto_4/9 == 1 && $linked_active_4/9 == 0` | 物理引擎只读条件（6 处） |

**静态推演（开关 OFF 场景）**：玩家从未碰开关（$val_14=0、$auto_9=0）→ 进入 comp9 区（$linked_active_9=1）→ 离开（$linked_active_9=0）。全程无任何 $auto_9 写 → follow 条件 `$auto_9 != $val_14` 恒假 → 开关保持 0。**不再隔空打开开关+目标动画**。✓

## 2. Sync Bindings toggle 294 push/follow 逻辑不再与联动恢复冲突 — PASS

### 2.1 冲突源已根除（A5 根治）

A5 的 follow 冲突本质上由 A1-A3 的"联动直接写 $auto"引起。修复后联动零写 $auto（见 1.1/1.2），$auto_9 只可能被四类合法路径改写（persist 声明、布局重置、已门控点击推送、已门控 Sync 推送）——均为"开关→绑定变量"方向的合法行为，follow 仅在 $auto_9 被这些合法路径驱动时发生，不再存在联动恢复路径。

### 2.2 同步段结构核对

- 生成器 16894-16929：toggle 分支 `if $val_${i} != $vprev_${i}` 推送 / else follow，`noFollow = sharedBindingFlags[i] || linkedTargetComponentIds.has(m.id)`（16896），外层 `if ${componentExportMeta[i].bindingExpr}`（16897）门控。
- INI 16594-16610 实证：整段包在 `if $grp_bind_mode_1788036223682_297 == 1` 内；推送 16596-16597、follow 16599-16600（只跟 vars[0]=$auto_9）、$vprev_14 更新一致。
- 开关 294 点击推送（INI 13150-13154）同样包 `$grp_bind_mode_1788036223682_297 == 1` 门 —— A6 修复实证（生成器 14636-14651：clickBindingExpr 门控 + 兄弟开关同级门控 14666）。

**静态推演（开关 ON 场景）**：$val_14=1、$auto_9=1 → 进入 comp9（$linked_active_9=1，物理自动暂停但 $auto 不动）→ 离开（$linked_active_9=0）。$auto_9 全程未被改写 → follow 不触发 → **开关显示保持 ON，动画按 ON 恢复**。✓

## 3. 预览端与导出端行为一致（A8）— PASS

### 3.1 预览端闩锁建模实证

- `isPreviewLinkActiveOnTarget`（6364-6379）：遍历全部 linkedSlaves，若任一启用映射当前作用于此组件（computePreviewRangeActive 判定）→ true。注释明示"与导出端 $linked_active_<idx> 语义一致"。
- `getPreviewAutoEnableValue`（6387-6425）：联动激活 → **立即返回 0**（6391-6392）；无联动时按绑定链计算：toggle → val>0?val:0（switchGroup）/invert 语义；无绑定者 → 1（与原设计一致）。
- 调用点：stepPreviewSliderState 6431 / stepPreviewJoystickState 6519 均取 `=== 1` 判定自动动画。

### 3.2 语义对照表（开关 294 场景）

| 状态 | 导出端（INI 物理段） | 预览端（getPreviewAutoEnableValue） | 一致 |
|---|---|---|---|
| 开关 OFF、无联动 | `$auto==1` 假 → 无自动动画 | bound=0 → 无自动动画 | ✓ |
| 开关 ON、无联动 | `$auto==1 && $linked_active==0` 真 → 动画 | bound=1 → 动画 | ✓ |
| 联动激活中（开关任意） | `$linked_active==1` 假 → 暂停（else 走 rest 弹簧） | isPreviewLinkActiveOnTarget → 0 → 暂停 | ✓ |
| 联动离开 | `$linked_active==0`，按 $auto 恢复 | 按绑定者值恢复（OFF→0 / ON→1） | ✓ |

**开关关→目标动画关**在预览与导出两端成立。✓

## 4. 无语法/结构回归，生成器可正常加载 — PASS

### 4.1 语法自检

提取内嵌 JS 脚本块（2 个 script，其中主块 939,411 字符）写入临时文件，`node --check` → **SYNTAX OK**。

### 4.2 双副本一致性

`public\ui-builder-v79.html` 与 `dist\ui-builder-v79.html`：MD5 均 `9973CCACD0521539FB2E2912C3706AC6`，尺寸均 1,060,961 字节 —— 逐字节一致（t2 修复已同步双副本）。

### 4.3 声明/读取/写入三处配对（防未声明引用回归）

| 角色 | 位置 | 配对条件 |
|---|---|---|
| $linked_active 声明 | 生成器 15188（非 joystick+physics）、15230（joystick） | INI 565/828 `global $linked_active_4/9 = 0`（非 persist，瞬时） |
| 物理只读条件 | 生成器 7 处（16515/16583/16634/16649/16666/16673/16721） | 仅 physicsEnabled 组件生成（16496 guard），与声明条件同域 |
| 联动闩锁写入 | 生成器 9 处（16104/16142/16174/16185/16191/16332/16347/16360/16367） | 均包在 `tgtHasPhysics`（16141/16328 guard）内 |
| [Present] 布局签名重置 | 生成器 15504-15508 | INI 1399-1400 `$linked_active_4/9 = 0` |

回归语义核对（审计验收点 5）：else 分支保留旧 `$auto_prev=0` + rest 弹簧语义（16555-16557/16624-16631 等）；无物理/无 auto 组件不生成闩锁引用（16496 guard）；A7 的 $auto_goal/$auto_tgt 钉扎已加 `inRangeExpr` 门控（16377-16383）；布局重置同时清零 $linked_post 与 $linked_active（15500-15508），联动块 gateExpr 依赖 $linked_post 同步失效 → 目标释放回物理自由状态，语义自洽。

### 4.4 INI 改动范围纯净性

备份→修正版 git diff 仅含 7 hunk（18+/12-）：
1. +`global $linked_active_4 = 0`（565）
2. +`global $linked_active_9 = 0`（828）
3. +`$linked_active_4/9 = 0`（1399-1400，[Present] 重置）
4. 点击推送包 grp_bind_mode 门（13151-13154）
5. 离开 `$auto_4=1` → `$linked_active_4=0`（13929）
6. 激活 `$auto_4=0` → `$linked_active_4=1`（14123）
7. 离开 `$auto_9=1` → `$linked_active_9=0`（14145）
8. 激活 `$auto_9=0` → `$linked_active_9=1`（14339）
9. 物理读 6 处加 `&& $linked_active_x == 0`（14406/14960/14970/15019/15573/15583）

无任何其他行变动，无意外副作用。

---

## 遗留说明（非阻塞）

1. **真机复验**：环境无 headless 浏览器，未能以修复后生成器重新导出做端到端 byte 级比对。t3 已给出重新生成规则（浏览器打开修复后 ui-builder-v79.html → 导入 presets/ui_preset_19086112_20260831_215328.json → 导出），预期产物与本手改在对应 14 处差异上逐字节一致。此为可选加强项，不影响静态语义结论。
2. **follow 仍只跟 vars[0]（$auto_9）**：这是原生成器设计（审计 A5 记载），修复后因联动零写 $auto 而不再构成冲突源，保留原行为不引入新变化。
3. **生成器 A1 修复注释**与 `$linked_active` 声明均含"非 persist"设计（瞬时状态），确认不污染存档（A4 对应）。

## 验证文件清单（changedPaths 等价物，均为只读验证，未修改）

- 读取: `E:\代码\SSMT4-Alpha-main\public\ui-builder-v79.html`、`dist\ui-builder-v79.html`
- 读取: `K:\SSMT-Package-master\WorkSpace\ZZMI\希格莉德·空岛传奇\ui_config_19086112_20260831_215335.ini`、`.bak-pre-latch`
- 写入: `docs/panel-error-verify.md`（本报告）