/* ═══════════════════════════════════════════════════════════════
   CheeseCat (芝士猫) — File & code tools
   ═══════════════════════════════════════════════════════════════
   Gives the agent Kun-style file and code capabilities:
   - write / append / edit files (via PowerShell -EncodedCommand,
     paths & contents Base64-encoded → no quoting/injection issues)
   - grep-style text search, glob-style file find

   Notes:
   - The fs plugin only grants read permissions in this app, so all
     writes go through the existing execute_external_program command.
   - Single write is capped (~20KB) because the command line itself
     carries the Base64 payload.
   ═══════════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core'
import type { McpTool } from './XianZunMcp'

const strProp = (description: string) => ({ type: 'string', description })
const numProp = (description: string) => ({ type: 'number', description })
const boolProp = (description: string) => ({ type: 'boolean', description })

const MAX_RESULTS = 12000

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}\n…(结果过长,已截断)` : text

/** UTF-8 → Base64 (for embedding file contents / patterns safely). */
const encodeB64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** UTF-16LE → Base64 (PowerShell -EncodedCommand payload). */
const encodePsCommand = (script: string): string => {
  let bin = ''
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i)
    bin += String.fromCharCode(code & 0xff, (code >> 8) & 0xff)
  }
  return btoa(bin)
}

interface PsOutput {
  code: number
  stdout: string
  stderr: string
}

const execPs = async (script: string): Promise<PsOutput> =>
  invoke<PsOutput>('execute_external_program', {
    programPath: 'powershell',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePsCommand(script)],
  })

const psResult = (output: PsOutput): string => {
  const stderr = (output.stderr ?? '').trim()
  if ((output.code ?? 0) !== 0 || stderr) {
    const detail = stderr || `exit code ${output.code}`
    return `命令执行失败:${truncate(detail, 2000)}`
  }
  return truncate((output.stdout ?? '').trim() || '(无输出)', MAX_RESULTS)
}

/** Shared PS helpers: UTF-8 stdout + Base64-decoded literal strings. */
const PS_PREAMBLE =
  '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
  'function B64($s){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))};'

/* ═══════════════════════════════════════════════
   Tools
   ═══════════════════════════════════════════════ */

export const fileTools: McpTool[] = [
  {
    name: 'write_text_file',
    description:
      '创建或覆盖写入一个文本文件(自动创建父目录,UTF-8 编码)。注意:会直接写盘,需要用户确认;单次内容上限约 20KB,更大的内容请拆分多次或改用 append。',
    category: '文件与代码',
    risk: 'danger',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('目标文件绝对路径,如 C:\\Games\\Mods\\notes.txt'),
        content: strProp('要写入的完整内容'),
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const content = String(args.content ?? '')
      if (!path) return '缺少必需参数:path(文件路径)。'
      if (!content) return '缺少必需参数:content(文件内容)。'
      if (content.length > 20000) {
        return '内容超过 20KB 上限,请拆分写入或用 run_shell_command。'
      }
      const script =
        PS_PREAMBLE +
        '$p=B64(\'' + encodeB64(path) + '\');' +
        '$c=B64(\'' + encodeB64(content) + '\');' +
        '$d=Split-Path -Parent $p;' +
        'if($d -and -not (Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};' +
        '[IO.File]::WriteAllText($p,$c,(New-Object Text.UTF8Encoding $false));' +
        'Write-Output ("OK "+(Get-Item -LiteralPath $p).Length+" bytes")'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'edit_text_file',
    description:
      '在文件中用新文本替换旧文本(精确字符串匹配,全部匹配都会被替换),用于精准修改文件片段。若旧文本不存在会明确报错,不会破坏文件。',
    category: '文件与代码',
    risk: 'danger',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('目标文件绝对路径'),
        oldText: strProp('要被替换的原文(必须与文件内容完全一致,注意换行符)'),
        newText: strProp('替换后的新文本'),
      },
      required: ['path', 'oldText', 'newText'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const oldText = String(args.oldText ?? '')
      const newText = String(args.newText ?? '')
      if (!path) return '缺少必需参数:path(文件路径)。'
      if (!oldText) return '缺少必需参数:oldText(要替换的原文)。'
      const script =
        PS_PREAMBLE +
        '$p=B64(\'' + encodeB64(path) + '\');' +
        '$o=B64(\'' + encodeB64(oldText) + '\');' +
        '$n=B64(\'' + encodeB64(newText) + '\');' +
        'if(-not (Test-Path -LiteralPath $p)){Write-Output "NO_FILE";exit 0};' +
        '$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8);' +
        '$cnt=([regex]::Matches($t,[regex]::Escape($o))).Count;' +
        'if($cnt -eq 0){Write-Output "NO_MATCH: 文件中未找到要替换的原文,请检查路径与内容(注意换行符)。";exit 0};' +
        '$t=$t.Replace($o,$n);' +
        '[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding $false));' +
        'Write-Output ("REPLACED "+$cnt+" occurrences")'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'append_text_file',
    description: '向文件末尾追加内容(文件不存在时自动创建,UTF-8 编码)。',
    category: '文件与代码',
    risk: 'danger',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('目标文件绝对路径'),
        content: strProp('要追加的内容'),
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const content = String(args.content ?? '')
      if (!path) return '缺少必需参数:path(文件路径)。'
      if (!content) return '缺少必需参数:content(要追加的内容)。'
      const script =
        PS_PREAMBLE +
        '$p=B64(\'' + encodeB64(path) + '\');' +
        '$c=B64(\'' + encodeB64(content) + '\');' +
        '$d=Split-Path -Parent $p;' +
        'if($d -and -not (Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null};' +
        'Add-Content -LiteralPath $p -Value $c -Encoding UTF8;' +
        'Write-Output "APPENDED"'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'search_text',
    description:
      '在目录中按正则表达式搜索文本(grep 风格),返回 文件路径:行号:匹配行,最多 200 条。适合在代码/配置/日志中查找内容。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: strProp('搜索的正则表达式,如 "gamebanana_download|install_mod"'),
        path: strProp('要搜索的目录绝对路径(如 C:\\Dev\\SSMT4-Alpha\\src)'),
        filePatterns: strProp('限定文件扩展名,逗号分隔,如 "*.ts,*.vue" 或 "*.json"(可选,默认全部文本文件)'),
        ignoreCase: boolProp('是否忽略大小写(可选,默认 true)'),
      },
      required: ['pattern', 'path'],
    },
    execute: async (args) => {
      const pattern = String(args.pattern ?? '').trim()
      const path = String(args.path ?? '').trim()
      if (!pattern) return '缺少必需参数:pattern(搜索模式)。'
      if (!path) return '缺少必需参数:path(搜索目录)。'
      const extensions = String(args.filePatterns ?? '').trim()
      const ignoreCase = args.ignoreCase === undefined ? true : Boolean(args.ignoreCase)
      const script =
        PS_PREAMBLE +
        '$dir=B64(\'' + encodeB64(path) + '\');' +
        '$pat=B64(\'' + encodeB64(pattern) + '\');' +
        '$exts=B64(\'' + encodeB64(extensions) + '\');' +
        '$case=$(' + String(ignoreCase).toLowerCase() + ');' +
        'if(-not (Test-Path -LiteralPath $dir)){Write-Output "NO_DIR: 目录不存在";exit 0};' +
        '$files=Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue;' +
        'if($exts){' +
        '$extList=($exts -split ","|ForEach-Object{$_.Trim().TrimStart("*").TrimStart(".")}|Where-Object{$_});' +
        '$files=$files|Where-Object{$extList -contains $_.Extension.TrimStart(".")}};' +
        '$count=0;' +
        'foreach($f in $files){' +
        '$ln=0;' +
        'Get-Content -LiteralPath $f.FullName -Encoding UTF8 -ErrorAction SilentlyContinue|ForEach-Object{' +
        '$ln++;' +
        'if(($case -and $_ -match $pat) -or ((-not $case) -and $_ -cmatch $pat)){' +
        '$count++;' +
        'if($count -le 200){Write-Output ("$($f.FullName):${ln}:$($_.Trim())")}' +
        '}' +
        '}' +
        '};' +
        'if($count -eq 0){Write-Output "NO_MATCHES";exit 0};' +
        'Write-Output ("TOTAL_MATCHES "+$count)'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'find_files',
    description:
      '在目录中按文件名通配符查找文件/文件夹(glob 风格),返回匹配的绝对路径列表,最多 500 条。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        namePattern: strProp('文件名通配符,如 "*.ini" 或 "*frame*" 或 "config.*"'),
        path: strProp('要查找的目录绝对路径'),
        maxResults: numProp('最多返回条数(可选,默认 500)'),
      },
      required: ['namePattern', 'path'],
    },
    execute: async (args) => {
      const namePattern = String(args.namePattern ?? '').trim()
      const path = String(args.path ?? '').trim()
      if (!namePattern) return '缺少必需参数:namePattern(文件名模式)。'
      if (!path) return '缺少必需参数:path(查找目录)。'
      const max = Math.min(Math.max(Number(args.maxResults) || 500, 1), 1000)
      const script =
        PS_PREAMBLE +
        '$dir=B64(\'' + encodeB64(path) + '\');' +
        '$name=B64(\'' + encodeB64(namePattern) + '\');' +
        'if(-not (Test-Path -LiteralPath $dir)){Write-Output "NO_DIR: 目录不存在";exit 0};' +
        '$hits=Get-ChildItem -LiteralPath $dir -Recurse -ErrorAction SilentlyContinue|' +
        'Where-Object{$_.Name -like $name}|Select-Object -First ' + max + ';' +
        'if(-not $hits){Write-Output "NO_MATCHES";exit 0};' +
        '$hits|ForEach-Object{$_.FullName}'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'list_project_scripts',
    description:
      '读取项目 package.json 中的可用脚本清单(如 build、typecheck、test 等),返回 脚本名:命令。配合 run_shell_command 可执行项目的构建/检查/测试(例如先查脚本,再在项目目录运行 npm run build 或 npx vue-tsc --noEmit 验证修改)。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('项目目录绝对路径(需包含 package.json)'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '缺少必需参数:path(项目目录)。'
      const script =
        PS_PREAMBLE +
        '$p=B64(\'' + encodeB64(path) + '\');' +
        '$pkg=Join-Path $p "package.json";' +
        'if(-not (Test-Path -LiteralPath $pkg)){Write-Output "NO_PACKAGE_JSON: 该目录没有 package.json";exit 0};' +
        '$json=Get-Content -LiteralPath $pkg -Raw -Encoding UTF8|ConvertFrom-Json;' +
        '$scripts=$json.scripts;' +
        'if(-not $scripts){Write-Output "NO_SCRIPTS: package.json 中没有 scripts";exit 0};' +
        '$scripts.PSObject.Properties|ForEach-Object{"$($_.Name): $($_.Value)"}'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'get_directory_tree',
    description:
      '生成目录结构树(类似 repo_map/文件树):递归列出目录与文件,带缩进层级,自动跳过 node_modules/.git/dist 等大目录。用于快速了解一个项目或文件夹的整体结构。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('要展示的目录绝对路径'),
        maxDepth: numProp('最大递归深度(可选,默认 2)'),
        maxEntries: numProp('最多展示条目数(可选,默认 300)'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '缺少必需参数:path(目录路径)。'
      const depth = Math.min(Math.max(Number(args.maxDepth) || 2, 1), 6)
      const max = Math.min(Math.max(Number(args.maxEntries) || 300, 10), 1000)
      const script =
        PS_PREAMBLE +
        '$root=B64(\'' + encodeB64(path) + '\');' +
        '$maxDepth=' + depth + ';' +
        '$max=' + max + ';' +
        '$count=0;' +
        'function ShowDir($p,$lv){' +
        'if($lv -gt $maxDepth -or $count -ge $max){return};' +
        'Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue|ForEach-Object{' +
        'if($count -ge $max){return};' +
        '$skip=$_.PSIsContainer -and ($_.Name -in @("node_modules",".git","dist","bin","obj",".venv","target",".next"));' +
        'if($skip){return};' +
        '$indent=("  "*$lv);' +
        'if($_.PSIsContainer){' +
        '$count++;Write-Output ($indent + "[D] " + $_.Name);' +
        'ShowDir $_.FullName ($lv+1)' +
        '}else{' +
        '$count++;Write-Output ($indent + "    " + $_.Name)' +
        '}' +
        '}' +
        '};' +
        'if(-not (Test-Path -LiteralPath $root)){Write-Output "NO_DIR: 目录不存在";exit 0};' +
        'Write-Output $root;' +
        'ShowDir $root 1;' +
        'Write-Output ("-- "+$count+" entries")'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'get_file_outline',
    description:
      '提取单个代码文件的符号概览(类、函数、接口、枚举、顶层常量及其行号),按扩展名适配 TypeScript/JavaScript/Vue/Rust/JSON。用于快速了解文件里有什么,再决定读哪段。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('代码文件绝对路径(.ts/.tsx/.js/.jsx/.vue/.rs/.json 等)'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '缺少必需参数:path(文件路径)。'
      const script =
        PS_PREAMBLE +
        '$p=B64(\'' + encodeB64(path) + '\');' +
        'if(-not (Test-Path -LiteralPath $p)){Write-Output "NO_FILE: 文件不存在";exit 0};' +
        '$ext=[IO.Path]::GetExtension($p).ToLower();' +
        '$pat=$null;' +
        'if($ext -in @(".ts",".tsx",".js",".jsx",".vue",".mjs",".cjs")){' +
        '$pat="^\s*(export\s+)?(default\s+)?(async\s+)?(class|function|interface|enum|type|const|let|var)\s+[\w\u0024]+"}' +
        'elseif($ext -eq ".rs"){' +
        '$pat="^\s*(pub\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|type|const|static)\s+[\w_]+"}' +
        'elseif($ext -eq ".json"){' +
        '$pat="^\s*\"[^"]+\"\s*:"' +
        '};' +
        'if(-not $pat){Write-Output ("UNSUPPORTED: 暂不支持 "+$ext+" 文件,可用 read_text_file 直接读");exit 0};' +
        '$ln=0;$total=0;' +
        'Get-Content -LiteralPath $p -Encoding UTF8 -ErrorAction SilentlyContinue|ForEach-Object{' +
        '$ln++;' +
        'if($_ -match $pat){$total++;Write-Output ("${ln}: "+$_.Trim())}' +
        '};' +
        'Write-Output ("-- "+$total+" symbols")'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'git_status',
    description: '查看 Git 仓库当前状态(git status --short):列出新增/修改/删除/未跟踪的文件。适合了解一个代码项目是否有未提交的改动。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('Git 仓库目录绝对路径(包含 .git)'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '缺少必需参数:path(Git 仓库目录)。'
      const script =
        PS_PREAMBLE +
        '$dir=B64(\'' + encodeB64(path) + '\');' +
        'if(-not (Test-Path -LiteralPath (Join-Path $dir ".git"))){Write-Output "NO_GIT: 该目录不是 Git 仓库";exit 0};' +
        '$out = & git -C $dir status --short 2>&1;' +
        'if($LASTEXITCODE -ne 0){Write-Output ("GIT_ERROR: "+($out -join " "));exit 0};' +
        'if(-not $out){Write-Output "CLEAN: 工作区没有未提交的改动";exit 0};' +
        '$out|Select-Object -First 200'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'git_log',
    description: '查看 Git 提交历史(git log --oneline),返回最近的提交哈希与标题。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('Git 仓库目录绝对路径'),
        count: numProp('显示最近多少条(可选,默认 15,最大 50)'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '缺少必需参数:path(Git 仓库目录)。'
      const count = Math.min(Math.max(Number(args.count) || 15, 1), 50)
      const script =
        PS_PREAMBLE +
        '$dir=B64(\'' + encodeB64(path) + '\');' +
        '$out = & git -C $dir log --oneline -n ' + count + ' 2>&1;' +
        'if($LASTEXITCODE -ne 0){Write-Output ("GIT_ERROR: "+($out -join " "));exit 0};' +
        'if(-not $out){Write-Output "NO_COMMITS";exit 0};' +
        '$out'
      return psResult(await execPs(script))
    },
  },
  {
    name: 'git_diff',
    description: '查看 Git 工作区与暂存区的差异(git diff),返回修改内容。适合了解别人/之前改了什么代码。',
    category: '文件与代码',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('Git 仓库目录绝对路径'),
        file: strProp('只看某个文件的差异(可选,仓库内相对路径)'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '缺少必需参数:path(Git 仓库目录)。'
      const file = String(args.file ?? '').trim()
      const script =
        PS_PREAMBLE +
        '$dir=B64(\'' + encodeB64(path) + '\');' +
        '$file=B64(\'' + encodeB64(file) + '\');' +
        'if($file){$out = & git -C $dir diff -- $file 2>&1}else{$out = & git -C $dir diff 2>&1};' +
        'if($LASTEXITCODE -ne 0){Write-Output ("GIT_ERROR: "+($out -join " "));exit 0};' +
        'if(-not $out){Write-Output "NO_DIFF: 没有未暂存的修改";exit 0};' +
        '$out'
      return psResult(await execPs(script))
    },
  },
]
