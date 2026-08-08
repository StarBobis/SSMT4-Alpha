/* ═══════════════════════════════════════════════════════════════
   CheeseCat (芝士猫) — MCP tool registry for Tauri commands
   ═══════════════════════════════════════════════════════════════
   Every #[tauri::command] registered in src-tauri/src/lib.rs is
   wrapped here as an MCP-style tool (name / description /
   inputSchema) so the agent can discover and call it. Arguments
   follow Tauri v2 JS naming (camelCase → snake_case mapping).
   ───────────────────────────────────────────────────────────────
   Commands that take AppHandle / State parameters are injected by
   Tauri automatically and must NOT be passed by the caller.
   ═══════════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core'

export interface McpToolSchema {
  type: 'object'
  properties: Record<string, { type: string; description: string; enum?: string[] }>
  required: string[]
}

export interface McpTool {
  name: string
  description: string
  category: string
  risk: RiskLevel
  inputSchema: McpToolSchema
  execute: (args: Record<string, unknown>) => string | Promise<string>
}

export type RiskLevel = 'read' | 'write' | 'danger'

export const riskLabel = (risk: RiskLevel): string => {
  if (risk === 'danger') return '危险操作'
  if (risk === 'write') return '写入操作'
  return '只读'
}

export const MCP_CATEGORY_LABELS: Record<string, string> = {
  system: '系统',
  launcher: '游戏启动',
  modManager: '模组管理',
  modLibrary: '模组库',
  modelExtract: '模型提取',
  textureExtract: '纹理提取',
  vscheck: 'VSCheck',
  compress: '压缩打包',
  recycle: '回收站',
}

const MAX_RESULT_CHARS = 12000

export const serializeResult = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '完成(命令执行成功,无返回值)'
  }
  let text: string
  try {
    text =
      typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n…(结果过长,已截断)`
  }
  return text
}

type Prop = {
  type: string
  description: string
  enum?: string[]
  properties?: Record<string, Prop>
  required?: string[]
  items?: {
    type: string
    properties?: Record<string, Prop>
    required?: string[]
  }
}

const strProp = (description: string, enumValues?: string[]): Prop => ({
  type: 'string',
  description,
  ...(enumValues ? { enum: enumValues } : {}),
})
const optStrProp = (description: string): Prop => ({ type: 'string', description })
const boolProp = (description: string): Prop => ({ type: 'boolean', description })
const arrStrProp = (description: string): Prop => ({ type: 'array', description })

const tool = (
  name: string,
  category: string,
  description: string,
  properties: Record<string, Prop>,
  required: string[],
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown,
  risk: RiskLevel = 'write',
): McpTool => ({
  name,
  category,
  description,
  risk,
  inputSchema: { type: 'object', properties, required },
  execute: async (args) => serializeResult(await run(args)),
})

/* ═══════════════════════════════════════════════
   Tauri command registry
   ═══════════════════════════════════════════════ */

export const mcpTools: McpTool[] = [
  /* ── System ── */
  tool(
    'set_show_window_shortcut_enabled',
    'system',
    '启用或禁用 Alt+F 全局快捷键(用于唤起/最小化 SSMT 窗口)。',
    { enabled: boolProp('是否启用快捷键') },
    ['enabled'],
    (args) => invoke('set_show_window_shortcut_enabled', { enabled: args.enabled }),
  ),

  /* ── Game launcher ── */
  tool(
    'configure_zzmi_launch_settings',
    'launcher',
    '配置 ZZMI 启动设置(修改游戏配置文件中的画质选项)。',
    {
      options: {
        type: 'object',
        description: '启动设置选项',
        properties: {
          targetExePath: { type: 'string', description: '游戏 exe 完整路径' },
          configureGame: { type: 'boolean', description: '是否写入游戏配置(默认 true)' },
        },
        required: ['targetExePath'],
      },
    },
    ['options'],
    (args) => invoke('configure_zzmi_launch_settings', { options: args.options }),
  ),
  tool(
    'configure_wwmi_launch_settings',
    'launcher',
    '配置 WWMI 启动设置(需要管理员权限,通过 wuwa_settings 工具修改画质/帧率等选项)。',
    {
      options: {
        type: 'object',
        description: '启动设置选项',
        properties: {
          targetExePath: { type: 'string', description: '游戏 exe 完整路径' },
          configureGame: { type: 'boolean', description: '是否写入游戏配置(默认 true)' },
          applyPerfTweaks: { type: 'boolean', description: '应用性能优化(默认 false)' },
          unlockFps: { type: 'boolean', description: '解锁帧率(默认 false)' },
          forceMaxLodBias: { type: 'boolean', description: '强制最大 LOD 偏移(默认 false)' },
          disableWoundedFx: { type: 'boolean', description: '禁用受伤特效(默认 false)' },
        },
        required: ['targetExePath'],
      },
    },
    ['options'],
    (args) => invoke('configure_wwmi_launch_settings', { options: args.options }),
  ),
  tool(
    'execute_external_program',
    'launcher',
    '执行外部程序并等待其退出,返回退出码、stdout 与 stderr。',
    {
      programPath: strProp('程序完整路径'),
      args: arrStrProp('命令行参数列表(可选)'),
      workDir: optStrProp('工作目录(可选,默认程序所在目录)'),
    },
    ['programPath'],
    (args) =>
      invoke('execute_external_program', {
        programPath: args.programPath,
        args: args.args,
        workDir: args.workDir,
      }),
  ),
  tool(
    'launch_programs',
    'launcher',
    '按顺序启动一组程序(可等待进程退出、设置超时)。',
    {
      programs: {
        type: 'array',
        description: '程序列表,每项包含 path、args、workDir、waitForProcessName、waitTimeoutSecs、waitOnly',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '程序完整路径' },
            args: { type: 'string', description: '参数(单字符串,可选)' },
            workDir: { type: 'string', description: '工作目录(可选)' },
            waitForProcessName: { type: 'string', description: '等待的进程名(可选)' },
            waitTimeoutSecs: { type: 'number', description: '等待超时秒数(可选)' },
            waitOnly: { type: 'boolean', description: '仅等待不启动(可选)' },
          },
          required: ['path'],
        },
      },
    },
    ['programs'],
    (args) => invoke('launch_programs', { programs: args.programs }),
  ),
  tool(
    'file_md5',
    'launcher',
    '计算指定文件的 MD5 值,返回小写十六进制字符串。',
    { path: strProp('文件完整路径') },
    ['path'],
    (args) => invoke('file_md5', { path: args.path }),
    'read',
  ),

  /* ── Mod manager ── */
  tool(
    'watch_mods',
    'modManager',
    '开始监听 Mods 目录的文件变化(修改/新增时前端会收到事件)。',
    { installDir: strProp('游戏安装目录(包含 Mods 子目录)') },
    ['installDir'],
    (args) => invoke('watch_mods', { installDir: args.installDir }),
  ),
  tool(
    'unwatch_mods',
    'modManager',
    '停止监听 Mods 目录。',
    {},
    [],
    () => invoke('unwatch_mods'),
  ),
  tool(
    'preview_mod_archive',
    'modManager',
    '预览 Mod 压缩包或目录的结构(文件列表、大小、类型),用于安装前确认内容。',
    { path: strProp('Mod 压缩包或目录的完整路径') },
    ['path'],
    (args) => invoke('preview_mod_archive', { path: args.path }),
    'read',
  ),
  tool(
    'mod_install_target_exists',
    'modManager',
    '检查安装目标是否已存在(同名 Mod 是否已安装)。',
    {
      installDir: strProp('游戏安装目录'),
      targetName: strProp('Mod 名称(安装后的文件夹名)'),
      targetGroup: strProp('目标分组,如 Ayaka;根目录填 Root'),
    },
    ['installDir', 'targetName', 'targetGroup'],
    (args) =>
      invoke('mod_install_target_exists', {
        installDir: args.installDir,
        targetName: args.targetName,
        targetGroup: args.targetGroup,
      }),
    'read',
  ),
  tool(
    'install_mod_archive',
    'modManager',
    '将本地 Mod 压缩包安装到 Mods 目录(解压到 分组/Mod名)。',
    {
      gameName: strProp('游戏名称(与安装目录对应)'),
      installDir: strProp('游戏安装目录'),
      archivePath: strProp('Mod 压缩包完整路径'),
      targetName: strProp('Mod 名称(安装后的文件夹名)'),
      targetGroup: strProp('目标分组,如 Ayaka;根目录填 Root'),
      password: optStrProp('压缩包密码(可选)'),
      backupExisting: boolProp('是否备份已存在的同名目录(可选,默认 true)'),
    },
    ['gameName', 'installDir', 'archivePath', 'targetName', 'targetGroup'],
    (args) =>
      invoke('install_mod_archive', {
        gameName: args.gameName,
        installDir: args.installDir,
        archivePath: args.archivePath,
        targetName: args.targetName,
        targetGroup: args.targetGroup,
        password: args.password,
        backupExisting: args.backupExisting,
      }),
  ),
  tool(
    'gamebanana_download_and_install_mod',
    'modManager',
    '从 GameBanana 下载 Mod 并自动安装。下载 URL 需为 GameBanana 文件链接。',
    {
      gameName: strProp('游戏名称'),
      installDir: strProp('游戏安装目录'),
      downloadUrl: strProp('GameBanana 下载链接'),
      archiveName: strProp('保存的压缩包文件名(含扩展名)'),
      targetName: strProp('Mod 名称(安装后的文件夹名)'),
      targetGroup: strProp('目标分组,如 Ayaka;根目录填 Root'),
      password: optStrProp('压缩包密码(可选)'),
      previewUrls: arrStrProp('预览图 URL 列表(可选)'),
      expectedSizeBytes: { type: 'number', description: '预期下载大小(可选)' },
    },
    ['gameName', 'installDir', 'downloadUrl', 'archiveName', 'targetName', 'targetGroup'],
    (args) =>
      invoke('gamebanana_download_and_install_mod', {
        gameName: args.gameName,
        installDir: args.installDir,
        downloadUrl: args.downloadUrl,
        archiveName: args.archiveName,
        targetName: args.targetName,
        targetGroup: args.targetGroup,
        password: args.password,
        previewUrls: args.previewUrls,
        expectedSizeBytes: args.expectedSizeBytes,
      }),
  ),
  tool(
    'cancel_gamebanana_download_and_install_mod',
    'modManager',
    '取消正在进行的 GameBanana 下载安装任务。',
    { gameName: strProp('游戏名称'), targetName: strProp('Mod 名称') },
    ['gameName', 'targetName'],
    (args) =>
      invoke('cancel_gamebanana_download_and_install_mod', {
        gameName: args.gameName,
        targetName: args.targetName,
      }),
  ),
  tool(
    'nexusmods_download_and_install_mod',
    'modManager',
    '从 Nexus Mods 下载 Mod 并安装(必须安装到 NexusMods 分组)。',
    {
      gameName: strProp('游戏名称'),
      installDir: strProp('游戏安装目录'),
      downloadUrl: strProp('Nexus Mods 下载链接'),
      archiveName: strProp('保存的压缩包文件名(含扩展名)'),
      targetName: strProp('Mod 名称(安装后的文件夹名)'),
      targetGroup: strProp('目标分组(必须为 NexusMods)'),
      password: optStrProp('压缩包密码(可选)'),
      expectedSizeBytes: { type: 'number', description: '预期下载大小(可选)' },
      previewUrls: arrStrProp('预览图 URL 列表(可选)'),
    },
    ['gameName', 'installDir', 'downloadUrl', 'archiveName', 'targetName', 'targetGroup'],
    (args) =>
      invoke('nexusmods_download_and_install_mod', {
        gameName: args.gameName,
        installDir: args.installDir,
        downloadUrl: args.downloadUrl,
        archiveName: args.archiveName,
        targetName: args.targetName,
        targetGroup: args.targetGroup,
        password: args.password,
        expectedSizeBytes: args.expectedSizeBytes,
        previewUrls: args.previewUrls,
      }),
  ),
  tool(
    'cancel_nexusmods_download_and_install_mod',
    'modManager',
    '取消正在进行的 Nexus Mods 下载安装任务。',
    { gameName: strProp('游戏名称'), targetName: strProp('Mod 名称') },
    ['gameName', 'targetName'],
    (args) =>
      invoke('cancel_nexusmods_download_and_install_mod', {
        gameName: args.gameName,
        targetName: args.targetName,
      }),
  ),
  tool(
    'export_mod_archive',
    'modManager',
    '将已安装的 Mod 目录导出为压缩包。',
    {
      installDir: strProp('游戏安装目录'),
      modRelativePath: strProp('Mod 在 Mods 下的相对路径'),
      outputDir: strProp('输出目录'),
      archiveName: strProp('导出文件名(含扩展名)'),
      format: strProp('压缩格式,如 zip / 7z / rar', ['zip', '7z', 'rar']),
      password: optStrProp('压缩密码(可选)'),
    },
    ['installDir', 'modRelativePath', 'outputDir', 'archiveName', 'format'],
    (args) =>
      invoke('export_mod_archive', {
        installDir: args.installDir,
        modRelativePath: args.modRelativePath,
        outputDir: args.outputDir,
        archiveName: args.archiveName,
        format: args.format,
        password: args.password,
      }),
  ),
  tool(
    'scan_directory',
    'modManager',
    '扫描 Mods 目录下的指定子目录,返回目录/文件结构。',
    {
      installDir: strProp('游戏安装目录'),
      relativePath: strProp('Mods 下的相对路径,根目录填 Root'),
    },
    ['installDir', 'relativePath'],
    (args) =>
      invoke('scan_directory', {
        installDir: args.installDir,
        relativePath: args.relativePath,
      }),
    'read',
  ),
  tool(
    'get_mod_key_list',
    'modManager',
    '获取指定 Mod 目录下所有 INI 中的按键(MKey/快捷键)列表,返回按键名称与描述。',
    {
      installDir: strProp('游戏安装目录'),
      modRelativePath: strProp('Mod 在 Mods 下的相对路径'),
    },
    ['installDir', 'modRelativePath'],
    (args) =>
      invoke('get_mod_key_list', {
        installDir: args.installDir,
        modRelativePath: args.modRelativePath,
      }),
    'read',
  ),

  /* ── Mod library ── */
  tool(
    'mod_library_stream_scan',
    'modLibrary',
    '流式扫描游戏 Mod 库的指定分组(有缓存时秒回),返回 Mod 列表与分组列表。',
    {
      gameName: strProp('游戏名称'),
      installDir: strProp('游戏安装目录'),
      groupPath: strProp('分组路径,根目录填 Root'),
    },
    ['gameName', 'installDir', 'groupPath'],
    (args) =>
      invoke('mod_library_stream_scan', {
        gameName: args.gameName,
        installDir: args.installDir,
        groupPath: args.groupPath,
      }),
    'read',
  ),
  tool(
    'mod_library_scan_group',
    'modLibrary',
    '扫描并索引指定分组的 Mod 库(与 stream_scan 类似,非流式)。',
    {
      gameName: strProp('游戏名称'),
      installDir: strProp('游戏安装目录'),
      groupPath: strProp('分组路径,根目录填 Root'),
    },
    ['gameName', 'installDir', 'groupPath'],
    (args) =>
      invoke('mod_library_scan_group', {
        gameName: args.gameName,
        installDir: args.installDir,
        groupPath: args.groupPath,
      }),
    'read',
  ),
  tool(
    'mod_library_refresh_group',
    'modLibrary',
    '强制重新索引指定分组并返回最新结果。',
    {
      gameName: strProp('游戏名称'),
      installDir: strProp('游戏安装目录'),
      groupPath: strProp('分组路径,根目录填 Root'),
    },
    ['gameName', 'installDir', 'groupPath'],
    (args) =>
      invoke('mod_library_refresh_group', {
        gameName: args.gameName,
        installDir: args.installDir,
        groupPath: args.groupPath,
      }),
  ),
  tool(
    'mod_library_refresh_all',
    'modLibrary',
    '全量重新索引整个 Mod 库并返回全部 Mod 与分组。',
    { gameName: strProp('游戏名称'), installDir: strProp('游戏安装目录') },
    ['gameName', 'installDir'],
    (args) =>
      invoke('mod_library_refresh_all', {
        gameName: args.gameName,
        installDir: args.installDir,
      }),
  ),
  tool(
    'mod_library_all_mods',
    'modLibrary',
    '获取 Mod 库中全部 Mod 与分组(未索引时自动索引)。',
    { gameName: strProp('游戏名称'), installDir: strProp('游戏安装目录') },
    ['gameName', 'installDir'],
    (args) =>
      invoke('mod_library_all_mods', {
        gameName: args.gameName,
        installDir: args.installDir,
      }),
    'read',
  ),
  tool(
    'watch_mod_library',
    'modLibrary',
    '开始监听 Mod 库文件变化。',
    { installDir: strProp('游戏安装目录') },
    ['installDir'],
    (args) => invoke('watch_mod_library', { installDir: args.installDir }),
  ),
  tool(
    'unwatch_mod_library',
    'modLibrary',
    '停止监听 Mod 库文件变化。',
    {},
    [],
    () => invoke('unwatch_mod_library'),
  ),
  tool(
    'find_nested_ini_files',
    'modLibrary',
    '递归查找指定分组下所有嵌套的 INI 文件,返回相对路径列表。',
    {
      installDir: strProp('游戏安装目录'),
      groupPath: strProp('分组路径,根目录填 Root'),
    },
    ['installDir', 'groupPath'],
    (args) =>
      invoke('find_nested_ini_files', {
        installDir: args.installDir,
        groupPath: args.groupPath,
      }),
    'read',
  ),

  /* ── Model extraction ── */
  tool(
    'extract_models_new',
    'modelExtract',
    '从 FrameAnalysis 数据提取模型(所有数据类型),输出到工作区。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      gamePreset: strProp('游戏预设,如 NTEMI / ZZMIDX12 / WWMI'),
      workspaceRootPath: strProp('工作区根路径'),
      lodName: strProp('LOD 名称(如 Lod0)'),
    },
    ['frameAnalysisFolder', 'gamePreset', 'workspaceRootPath', 'lodName'],
    (args) =>
      invoke('extract_models_new', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        gamePreset: args.gamePreset,
        workspaceRootPath: args.workspaceRootPath,
        lodName: args.lodName,
      }),
  ),
  tool(
    'full_extract',
    'modelExtract',
    '按数据类型过滤器执行完整提取(模型/纹理等),返回提取统计。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      gamePreset: strProp('游戏预设'),
      workspaceRootPath: strProp('工作区根路径'),
      lodName: strProp('LOD 名称'),
      dataTypeFilter: strProp('数据类型过滤器:All / Model / Texture / Shader 等', ['All', 'Model', 'Texture', 'Shader']),
    },
    ['frameAnalysisFolder', 'gamePreset', 'workspaceRootPath', 'lodName', 'dataTypeFilter'],
    (args) =>
      invoke('full_extract', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        gamePreset: args.gamePreset,
        workspaceRootPath: args.workspaceRootPath,
        lodName: args.lodName,
        dataTypeFilter: args.dataTypeFilter,
      }),
  ),
  tool(
    'analyze_draw_ib_submeshes',
    'modelExtract',
    '分析指定 DrawIB hash 的子网格范围,返回子网格列表(提取指定 hash 模型的第一步)。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      drawIb: strProp('DrawIB hash 字符串(如 0x 开头的 64 位哈希)'),
    },
    ['frameAnalysisFolder', 'drawIb'],
    (args) =>
      invoke('analyze_draw_ib_submeshes', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        drawIb: args.drawIb,
      }),
    'read',
  ),
  tool(
    'regenerate_draw_ib_component_json',
    'modelExtract',
    '重新生成 LOD 工作区中 DrawIB 组件 JSON(修复导入语义)。',
    { lodWorkspacePath: strProp('LOD 工作区路径') },
    ['lodWorkspacePath'],
    (args) =>
      invoke('regenerate_draw_ib_component_json', {
        lodWorkspacePath: args.lodWorkspacePath,
      }),
  ),

  /* ── Texture extraction ── */
  tool(
    'extract_deduped_textures',
    'textureExtract',
    '提取去重后的纹理(按内容哈希去重),输出到工作区。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      gamePreset: strProp('游戏预设'),
      workspaceRootPath: strProp('工作区根路径'),
      lodName: strProp('LOD 名称'),
    },
    ['frameAnalysisFolder', 'gamePreset', 'workspaceRootPath', 'lodName'],
    (args) =>
      invoke('extract_deduped_textures', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        gamePreset: args.gamePreset,
        workspaceRootPath: args.workspaceRootPath,
        lodName: args.lodName,
      }),
  ),
  tool(
    'extract_trianglelist_textures',
    'textureExtract',
    '提取 TriangleList 类型的纹理,输出到工作区。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      gamePreset: strProp('游戏预设'),
      workspaceRootPath: strProp('工作区根路径'),
      lodName: strProp('LOD 名称'),
    },
    ['frameAnalysisFolder', 'gamePreset', 'workspaceRootPath', 'lodName'],
    (args) =>
      invoke('extract_trianglelist_textures', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        gamePreset: args.gamePreset,
        workspaceRootPath: args.workspaceRootPath,
        lodName: args.lodName,
      }),
  ),

  /* ── VSCheck ── */
  tool(
    'update_vscheck',
    'vscheck',
    '更新工作区中的 VSCheck 数据(从 FrameAnalysis 重新生成 IB hash 集合)。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      gamePreset: strProp('游戏预设'),
      workspacePath: strProp('工作区路径'),
    },
    ['frameAnalysisFolder', 'gamePreset', 'workspacePath'],
    (args) =>
      invoke('update_vscheck', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        gamePreset: args.gamePreset,
        workspacePath: args.workspacePath,
      }),
  ),
  tool(
    'generate_vscheck',
    'vscheck',
    '为生成的 Mod 生成 VSCheck 文件。',
    {
      frameAnalysisFolder: strProp('FrameAnalysis 数据文件夹路径'),
      gamePreset: strProp('游戏预设'),
      workspacePath: strProp('工作区路径'),
      generatedModFolderPath: strProp('生成的 Mod 文件夹路径'),
    },
    ['frameAnalysisFolder', 'gamePreset', 'workspacePath', 'generatedModFolderPath'],
    (args) =>
      invoke('generate_vscheck', {
        frameAnalysisFolder: args.frameAnalysisFolder,
        gamePreset: args.gamePreset,
        workspacePath: args.workspacePath,
        generatedModFolderPath: args.generatedModFolderPath,
      }),
  ),

  /* ── Compress / archive ── */
  tool(
    'extract_zip_archive',
    'compress',
    '解压 ZIP 压缩包到目标目录。',
    {
      zipPath: strProp('ZIP 文件完整路径'),
      destDir: strProp('解压目标目录'),
    },
    ['zipPath', 'destDir'],
    (args) =>
      invoke('extract_zip_archive', {
        zipPath: args.zipPath,
        destDir: args.destDir,
      }),
  ),
  tool(
    'create_rar_archive',
    'compress',
    '将目录打包为 RAR 压缩包。',
    {
      sourceDir: strProp('源目录路径'),
      outputPath: strProp('输出 RAR 文件路径'),
    },
    ['sourceDir', 'outputPath'],
    (args) =>
      invoke('create_rar_archive', {
        sourceDir: args.sourceDir,
        outputPath: args.outputPath,
      }),
  ),
  tool(
    'create_mod_archive',
    'compress',
    '将 Mod 目录打包为 Mod 压缩包(支持 zip / 7z / rar,可加密)。',
    {
      sourceDir: strProp('Mod 源目录路径'),
      outputPath: strProp('输出压缩包路径'),
      format: strProp('压缩格式:zip / 7z / rar', ['zip', '7z', 'rar']),
      password: optStrProp('压缩密码(可选)'),
    },
    ['sourceDir', 'outputPath', 'format'],
    (args) =>
      invoke('create_mod_archive', {
        sourceDir: args.sourceDir,
        outputPath: args.outputPath,
        format: args.format,
        password: args.password,
      }),
  ),

  /* ── Recycle bin ── */
  tool(
    'move_file_to_recycle_bin',
    'recycle',
    '将文件移动到系统回收站(可恢复,不会永久删除)。',
    { path: strProp('文件完整路径') },
    ['path'],
    (args) => invoke('move_file_to_recycle_bin', { path: args.path }),
    'danger',
  ),
  tool(
    'move_dir_to_recycle_bin',
    'recycle',
    '将整个目录移动到系统回收站(可恢复,不会永久删除)。',
    { path: strProp('目录完整路径') },
    ['path'],
    (args) => invoke('move_dir_to_recycle_bin', { path: args.path }),
    'danger',
  ),
]

/* ═══════════════════════════════════════════════
   Validation — missing required args produce a
   "please ask the user" response so the agent
   turns it into a clarifying question.
   ═══════════════════════════════════════════════ */

export interface ValidateResult {
  ok: boolean
  message: string
}

export const validateToolArgs = (
  schema: McpToolSchema,
  args: Record<string, unknown> | undefined,
): ValidateResult => {
  const received = args ?? {}
  const missing: string[] = []
  for (const key of schema.required) {
    const value = received[key]
    if (value === undefined || value === null || value === '') {
      missing.push(key)
    }
  }
  if (missing.length === 0) {
    return { ok: true, message: '' }
  }

  const hints = missing
    .map((key) => {
      const prop = schema.properties[key]
      return prop ? `${key}(${prop.description})` : key
    })
    .join('、')

  return {
    ok: false,
    message: `缺少必需参数:${hints}。不要猜测或编造这些值,请先向用户询问补齐后再调用。`,
  }
}
