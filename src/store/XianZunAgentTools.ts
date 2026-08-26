/* ═══════════════════════════════════════════════════════════════
   CheeseCat (芝士猫) — General agent tools
   ═══════════════════════════════════════════════════════════════
   Common agent capabilities (shell, file read, web fetch) so the
   assistant can inspect the machine and run commands, mirroring the
   standard toolset of popular coding agents (Claude/Codex-style).

   Notes:
   - Shell execution goes through the existing execute_external_program
     Tauri command (unrestricted by the shell plugin scope).
   - File writes are intentionally NOT exposed here: the fs plugin
     only has read permissions in this app, so writes go through
     run_shell_command instead.
   ═══════════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core'
import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import type { McpTool } from './XianZunMcp'

const strProp = (description: string) => ({ type: 'string', description })

const MAX_SHELL_OUTPUT_CHARS = 12000
const MAX_FILE_CHARS = 20000
const MAX_WEB_CHARS = 8000

const stripHtml = (value: string): string =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}\n…(内容过长,已截断)` : text

export const agentTools: McpTool[] = [
  {
    name: 'run_shell_command',
    description:
      '在 Windows 上执行一条命令行命令(PowerShell 语法),返回退出码、stdout 与 stderr。适合文件操作、目录遍历、进程查询、脚本执行等任何 shell 能做的事。注意:此操作会在用户电脑上执行命令,需要用户确认;长时间运行的命令可能阻塞,请先想清楚再调用。',
    category: '通用能力',
    risk: 'danger',
    inputSchema: {
      type: 'object',
      properties: {
        command: strProp('要执行的 PowerShell 命令(整条命令字符串,如 Get-ChildItem C:\\Games)'),
        workDir: strProp('工作目录(可选,默认程序所在目录)'),
      },
      required: ['command'],
    },
    execute: async (args) => {
      const command = String(args.command ?? '').trim()
      if (!command) {
        return '缺少必需参数:command(要执行的命令)。请先向用户确认要执行什么命令。'
      }
      const output = await invoke<{ code: number; stdout: string; stderr: string }>(
        'execute_external_program',
        {
          programPath: 'powershell',
          args: ['-NoProfile', '-NonInteractive', '-Command', command],
          workDir: args.workDir ? String(args.workDir) : undefined,
        },
      )
      const stdout = truncate(output.stdout ?? '', MAX_SHELL_OUTPUT_CHARS)
      const stderr = truncate(output.stderr ?? '', MAX_SHELL_OUTPUT_CHARS)
      return JSON.stringify(
        {
          exitCode: output.code ?? -1,
          stdout: stdout || '(无输出)',
          stderr: stderr || '',
        },
        null,
        2,
      )
    },
  },
  {
    name: 'read_entire_text_file',
    description:
      '读取一个文本文件的全部内容(限应用有读取权限的目录:用户主目录、桌面、文档、下载、应用数据等)。',
    category: '通用能力',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('文件的绝对路径,如 C:\\Users\\me\\Desktop\\note.txt'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) {
        return '缺少必需参数:path(文件路径)。'
      }
      try {
        const content = await readTextFile(path)
        return truncate(content, MAX_FILE_CHARS)
      } catch (error) {
        return `读取失败:${String(error)}。可能原因:路径不存在、是二进制文件,或应用没有该目录的读取权限。`
      }
    },
  },
  {
    name: 'list_directory',
    description:
      '列出目录下的条目(文件/文件夹名称),用于查看目录结构。限应用有读取权限的目录。',
    category: '通用能力',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('目录的绝对路径,如 C:\\Users\\me\\Desktop'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) {
        return '缺少必需参数:path(目录路径)。'
      }
      try {
        const entries = await readDir(path)
        const list = entries
          .slice(0, 500)
          .map((entry) => `${entry.isDirectory ? '[目录]' : '[文件]'} ${entry.name}`)
        return list.length === 0
          ? '(空目录)'
          : `共 ${entries.length} 项${entries.length > 500 ? '(仅显示前 500 项)' : ''}:\n${list.join('\n')}`
      } catch (error) {
        return `列目录失败:${String(error)}。可能原因:路径不存在或没有读取权限。`
      }
    },
  },
  {
    name: 'file_exists',
    description: '检查文件或目录是否存在,返回布尔值。',
    category: '通用能力',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        path: strProp('文件或目录的绝对路径'),
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) {
        return '缺少必需参数:path(路径)。'
      }
      try {
        const result = await exists(path)
        return `存在:${result}`
      } catch (error) {
        return `检查失败:${String(error)}`
      }
    },
  },
  {
    name: 'fetch_webpage',
    description:
      '抓取一个网页(https/http)并提取纯文本内容(去除 HTML 标签与脚本),用于读取文档、文章、API 说明等。图片类内容无法返回,只会返回文本。',
    category: '通用能力',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        url: strProp('网页完整 URL,如 https://example.com/page'),
        maxChars: { type: 'number', description: '最多返回字符数(可选,默认 8000)' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      const url = String(args.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) {
        return '无效 URL:必须以 http:// 或 https:// 开头。'
      }
      try {
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
          return `抓取失败:HTTP ${response.status}`
        }
        const html = await response.text()
        const limit = Math.min(Math.max(Number(args.maxChars) || MAX_WEB_CHARS, 1000), MAX_WEB_CHARS * 4)
        return truncate(stripHtml(html), limit)
      } catch (error) {
        return `抓取失败:${String(error)}`
      }
    },
  },
]
