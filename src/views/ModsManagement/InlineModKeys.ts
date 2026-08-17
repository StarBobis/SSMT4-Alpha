import { join } from '@tauri-apps/api/path'
import { copyFile, exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { D3dxIniManager } from '../../store/D3dxIniManager'
import { GlobalConfig } from '../../store/GlobalConfig'
import type { ModInfo, ModKeyInfo } from '../../store/ModManager'
import { PathHelper } from '../../helper/PathHelper'
import { buildModRuntimePrefix, collectModRuntimeVariables } from './D3dxUserIniVariables'

export interface InlineKeyChoice {
  itemId: string
  sectionName: string
  sourceIni: string
  sourceIniPath: string
  variable: string
  options: string[]
  currentValue: string
  animationRisk?: boolean
}

interface InlineBackupManifest {
  version: 1
  gameName: string
  modRelativePath: string
  createdAt: number
  files: string[]
  applied: Array<Pick<InlineKeyChoice, 'sourceIniPath' | 'variable'> & { value: string }>
}

const safeSegment = (value: string) => {
  const normalized = value.replace(/\\/g, '/')
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const label = (normalized.split('/').filter(Boolean).pop() || 'mod')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 40)
  return `${label}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
const normalize = (value: string) => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

const getBackupRoot = async (gameName: string, modRelativePath: string) => {
  const cache = await GlobalConfig.SSMT4CustomCacheFolder()
  return join(cache, 'ModKeyInlineBackups', safeSegment(gameName), safeSegment(modRelativePath))
}

const collectIniFiles = async (root: string, relative = ''): Promise<string[]> => {
  const dir = relative ? await join(root, relative) : root
  const entries = await readDir(dir)
  const files: string[] = []
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory) files.push(...await collectIniFiles(root, child))
    else if (entry.name.toLowerCase().endsWith('.ini')) files.push(normalize(child))
  }
  return files
}

const readManifest = async (gameName: string, modRelativePath: string) => {
  const root = await getBackupRoot(gameName, modRelativePath)
  const path = await join(root, 'manifest.json')
  if (!(await exists(path))) return null
  try { return JSON.parse(await readTextFile(path)) as InlineBackupManifest } catch { return null }
}

export const hasInlineModKeyBackup = async (gameName: string, modRelativePath: string) =>
  !!(await readManifest(gameName, modRelativePath))

const getRuntimeValues = async (gameName: string, modRelativePath: string) => {
  const migoto = await PathHelper.GetGame3DmigotoFolderPath(gameName)
  if (!migoto) throw new Error('3Dmigoto install directory is not configured')
  const userIni = await join(migoto, 'd3dx_user.ini')
  if (!(await exists(userIni))) return new Map<string, string>()
  const lines = await D3dxIniManager.loadIni(userIni)
  const entries = D3dxIniManager.getSectionEntries(lines, 'Constants')
  const values = new Map<string, string>()
  collectModRuntimeVariables(modRelativePath, entries).forEach(entry => {
    values.set(entry.variableName.replace(/\\/g, '/').toLowerCase(), entry.value)
  })
  return values
}

const runtimeLookupKeys = (sourceIniPath: string, variable: string) => {
  const ini = normalize(sourceIniPath).toLowerCase()
  const name = variable.replace(/^\$/, '').toLowerCase()
  return [`${ini}/${name}`, name]
}

const detectAnimationRisk = (content: string, variable: string) => {
  const lines = content.split(/\r?\n/)
  const transientGlobals = new Set<string>()
  lines.forEach(line => {
    const declaration = line.trim().match(/^global\s+(?!persist\b)(\$[A-Za-z_][\w.]*)\b/i)
    if (declaration) transientGlobals.add(declaration[1].toLowerCase())
  })
  const animatedTemps = new Set<string>()
  lines.forEach(line => {
    const assignment = line.trim().match(/^(?:post\s+)?(\$[A-Za-z_][\w.]*)\s*=\s*(.+)$/i)
    if (!assignment) return
    const name = assignment[1].toLowerCase()
    if (!transientGlobals.has(name)) return
    const rhs = assignment[2].toLowerCase()
    if (rhs.includes(name) || /\btime\b|\$dt\b|\$auxtime\b|%/.test(rhs)) animatedTemps.add(name)
  })
  if (!animatedTemps.size) return false

  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (let index = 0; index < lines.length; index += 1) {
    const condition = lines[index].trim().match(/^(?:if|elif|else\s+if)\s+(.+)$/i)
    if (!condition || !new RegExp(`(?:^|[^\\w.])${escapedVariable}(?:$|[^\\w.])`, 'i').test(condition[1])) continue
    let depth = 0
    let end = lines.length - 1
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const text = lines[cursor].trim()
      if (/^if\s+/i.test(text)) depth += 1
      else if (/^endif\b/i.test(text)) {
        if (depth === 0) { end = cursor; break }
        depth -= 1
      }
    }
    const body = lines.slice(index + 1, end).join('\n').toLowerCase()
    if ([...animatedTemps].some(name => body.includes(name))) return true
  }
  return false
}

export const inspectInlineModKeys = async (gameName: string, mod: ModInfo, items: ModKeyInfo[]) => {
  const runtime = await getRuntimeValues(gameName, mod.relativePath)
  const choicesByVariable = new Map<string, InlineKeyChoice>()
  items.forEach(item => item.cycleValues.forEach(entry => {
    if (entry.values.length < 2) return
    const current = runtimeLookupKeys(item.sourceIniPath, entry.name)
      .map(key => runtime.get(key))
      .find(value => value !== undefined)
      ?? entry.constantBinding.initialValue
      ?? entry.values[0]
    const choice = {
      itemId: item.id,
      sectionName: item.sectionName,
      sourceIni: item.sourceIni,
      sourceIniPath: normalize(item.sourceIniPath),
      variable: entry.name,
      options: [...entry.values],
      currentValue: String(current),
    }
    choicesByVariable.set(`${choice.sourceIniPath.toLowerCase()}:${choice.variable.toLowerCase()}`, choice)
  }))

  // Menu-driven Mods often mutate persistent variables from CommandLists instead
  // of declaring the values directly in a [Key] section. Infer their discrete
  // domains from literal assignments/comparisons, which mirrors CommandList's
  // numeric expression semantics without attempting to execute command lists.
  const iniFiles = await collectIniFiles(mod.path)
  for (const sourceIniPath of iniFiles) {
    const content = await readTextFile(await join(mod.path, sourceIniPath))
    const persistent = new Map<string, { name: string; initial: string }>()
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(/^global\s+persist\s+(\$[A-Za-z_][\w.]*)\s*=\s*([^;#\s]+)/i)
      if (match) persistent.set(match[1].toLowerCase(), { name: match[1], initial: match[2] })
    }
    for (const entry of persistent.values()) {
      const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const literals = new Set<string>([entry.initial])
      const expression = new RegExp(`${escaped}\\s*(?:==|=)\\s*(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))`, 'gi')
      for (const match of content.matchAll(expression)) literals.add(match[1])
      const runtimeValue = runtimeLookupKeys(sourceIniPath, entry.name)
        .map(key => runtime.get(key))
        .find(value => value !== undefined)
      if (runtimeValue !== undefined) literals.add(runtimeValue)
      if (literals.size < 2) continue
      const key = `${sourceIniPath.toLowerCase()}:${entry.name.toLowerCase()}`
      const existing = choicesByVariable.get(key)
      const options = [...literals].sort((left, right) => Number(left) - Number(right))
      choicesByVariable.set(key, existing ? {
        ...existing,
        options: [...new Set([...existing.options, ...options])],
        currentValue: runtimeValue ?? existing.currentValue,
        animationRisk: existing.animationRisk || detectAnimationRisk(content, entry.name),
      } : {
        itemId: `constant:${sourceIniPath}:${entry.name}`,
        sectionName: entry.name.replace(/^\$/, ''),
        sourceIni: sourceIniPath.split('/').pop() || sourceIniPath,
        sourceIniPath,
        variable: entry.name,
        options,
        currentValue: runtimeValue ?? entry.initial,
        animationRisk: detectAnimationRisk(content, entry.name),
      })
    }
    choicesByVariable.forEach((choice, key) => {
      if (choice.sourceIniPath.toLowerCase() !== sourceIniPath.toLowerCase() || choice.animationRisk) return
      if (detectAnimationRisk(content, choice.variable)) {
        choicesByVariable.set(key, { ...choice, animationRisk: true })
      }
    })
  }
  return { choices: [...choicesByVariable.values()], hasBackup: !!(await readManifest(gameName, mod.relativePath)) }
}

const replaceConstantValue = (lines: string[], variable: string, value: string) => {
  let inConstants = false
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^(\\s*(?:(?:global|persist)\\s+)*${escaped}\\s*=\\s*).*$`, 'i')
  return lines.map(line => {
    const trimmed = line.trim()
    if (/^\[.*\]$/.test(trimmed)) inConstants = trimmed.toLowerCase() === '[constants]'
    return inConstants && pattern.test(line) ? line.replace(pattern, `$1${value}`) : line
  })
}

const removeKeySections = (lines: string[], sectionNames: Set<string>) => {
  const result: string[] = []
  let omit = false
  for (const line of lines) {
    const match = line.trim().match(/^\[(.*)\]$/)
    if (match) omit = sectionNames.has(match[1].trim().toLowerCase())
    if (!omit) result.push(line)
  }
  return result
}

type TruthValue = true | false | null

const stripOuterParens = (value: string) => {
  let text = value.trim()
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0
    let wraps = true
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '(') depth += 1
      else if (text[index] === ')') depth -= 1
      if (depth === 0 && index < text.length - 1) { wraps = false; break }
    }
    if (!wraps) break
    text = text.slice(1, -1).trim()
  }
  return text
}

const splitTopLevel = (value: string, operator: '&&' | '||') => {
  let depth = 0
  for (let index = 0; index <= value.length - operator.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')') depth -= 1
    else if (depth === 0 && value.slice(index, index + operator.length) === operator) {
      return [value.slice(0, index), value.slice(index + operator.length)] as const
    }
  }
  return null
}

const evaluateFixedExpression = (raw: string, fixed: Map<string, string>): TruthValue => {
  const expression = stripOuterParens(raw)
  const orParts = splitTopLevel(expression, '||')
  if (orParts) {
    const left = evaluateFixedExpression(orParts[0], fixed)
    const right = evaluateFixedExpression(orParts[1], fixed)
    if (left === true || right === true) return true
    if (left === false && right === false) return false
    return null
  }
  const andParts = splitTopLevel(expression, '&&')
  if (andParts) {
    const left = evaluateFixedExpression(andParts[0], fixed)
    const right = evaluateFixedExpression(andParts[1], fixed)
    if (left === false || right === false) return false
    if (left === true && right === true) return true
    return null
  }
  if (expression.startsWith('!') && expression[1] !== '=') {
    const value = evaluateFixedExpression(expression.slice(1), fixed)
    return value === null ? null : !value
  }
  const comparison = expression.match(/^(\$[A-Za-z_][\w.]*)\s*(===|!==|==|!=|<=|>=|<|>)\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/i)
  if (comparison) {
    const value = fixed.get(comparison[1].toLowerCase())
    if (value === undefined || !Number.isFinite(Number(value))) return null
    // CommandListOperand parses values as C++ float, so compare float32 values.
    const left = Math.fround(Number(value))
    const right = Math.fround(Number(comparison[3]))
    if (comparison[2] === '==') return left === right
    if (comparison[2] === '!=') return left !== right
    if (comparison[2] === '===') return Object.is(left, right)
    if (comparison[2] === '!==') return !Object.is(left, right)
    if (comparison[2] === '<=') return left <= right
    if (comparison[2] === '>=') return left >= right
    if (comparison[2] === '<') return left < right
    return left > right
  }
  const variable = expression.match(/^(\$[A-Za-z_][\w.]*)$/i)
  if (variable) {
    const value = fixed.get(variable[1].toLowerCase())
    return value === undefined || !Number.isFinite(Number(value)) ? null : Number(value) !== 0
  }
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(expression)) return Number(expression) !== 0
  return null
}

interface InlineConditionalBranch {
  controlIndex: number
  expression: string | null
  start: number
  end: number
}

interface InlineConditionalChain {
  branches: InlineConditionalBranch[]
  endifIndex: number
}

const parseConditionalChain = (lines: string[], ifIndex: number): InlineConditionalChain | null => {
  const first = lines[ifIndex].trim().match(/^if\s+(.+)$/i)
  if (!first) return null
  const branches: InlineConditionalBranch[] = [{ controlIndex: ifIndex, expression: first[1], start: ifIndex + 1, end: ifIndex }]
  let depth = 0
  for (let index = ifIndex + 1; index < lines.length; index += 1) {
    const text = lines[index].trim()
    if (/^if\s+/i.test(text)) { depth += 1; continue }
    if (/^endif\b/i.test(text)) {
      if (depth > 0) { depth -= 1; continue }
      branches[branches.length - 1].end = index - 1
      return { branches, endifIndex: index }
    }
    if (depth !== 0) continue
    const elif = text.match(/^(?:elif|else\s+if)\s+(.+)$/i)
    if (elif || /^else\b/i.test(text)) {
      branches[branches.length - 1].end = index - 1
      branches.push({ controlIndex: index, expression: elif?.[1] ?? null, start: index + 1, end: index })
    }
  }
  return null
}

const commentInlineLine = (line: string, reason: 'control' | 'unreachable') => {
  if (!line.trim()) return line
  const indent = line.match(/^\s*/)?.[0] || ''
  return `${indent}; SSMT inline ${reason}: ${line.trim()}`
}

const foldFixedControlFlow = (lines: string[], fixed: Map<string, string>) => {
  const next = [...lines]

  const commentRange = (start: number, end: number) => {
    for (let index = start; index <= end; index += 1) {
      if (!/^\s*[;#]/.test(next[index])) next[index] = commentInlineLine(next[index], 'unreachable')
    }
  }

  const transformRange = (start: number, end: number) => {
    let index = start
    while (index <= end) {
      if (!/^\s*if\s+/i.test(lines[index])) { index += 1; continue }
      const chain = parseConditionalChain(lines, index)
      if (!chain || chain.endifIndex > end) { index += 1; continue }

      let selectedBranch = -1
      let decidable = true
      for (let branchIndex = 0; branchIndex < chain.branches.length; branchIndex += 1) {
        const expression = chain.branches[branchIndex].expression
        if (expression === null) { selectedBranch = branchIndex; break }
        const truth = evaluateFixedExpression(expression, fixed)
        if (truth === null) { decidable = false; break }
        if (truth) { selectedBranch = branchIndex; break }
      }

      if (decidable) {
        chain.branches.forEach((branch, branchIndex) => {
          next[branch.controlIndex] = commentInlineLine(lines[branch.controlIndex], 'control')
          if (branchIndex === selectedBranch) transformRange(branch.start, branch.end)
          else commentRange(branch.start, branch.end)
        })
        next[chain.endifIndex] = commentInlineLine(lines[chain.endifIndex], 'control')
      } else {
        chain.branches.forEach(branch => transformRange(branch.start, branch.end))
      }
      index = chain.endifIndex + 1
    }
  }

  transformRange(0, lines.length - 1)
  return next
}

const freezeVariablesAndCommentUnreachableDraws = (lines: string[], fixed: Map<string, string>) => {
  const resolved = new Map(fixed)
  const declaredGlobals = new Set<string>()
  lines.forEach(line => {
    const declaration = line.trim().match(/^global(?:\s+persist)?\s+(\$[A-Za-z_][\w.]*)\b/i)
    if (declaration) declaredGlobals.add(declaration[1].toLowerCase())
  })

  let folded = foldFixedControlFlow(lines, resolved)
  for (let pass = 0; pass < 8; pass += 1) {
    const assignments = new Map<string, { values: Set<number>; dynamic: boolean }>()
    folded.forEach(line => {
      if (/^\s*[;#]/.test(line)) return
      const assignment = line.trim().match(/^(?:(?:global(?:\s+persist)?|post)\s+)?(\$[A-Za-z_][\w.]*)\s*=\s*(.+?)\s*$/i)
      if (!assignment) return
      const name = assignment[1].toLowerCase()
      if (!declaredGlobals.has(name) || resolved.has(name)) return
      const state = assignments.get(name) || { values: new Set<number>(), dynamic: false }
      const rhs = assignment[2].trim()
      if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(rhs)) state.values.add(Math.fround(Number(rhs)))
      else state.dynamic = true
      assignments.set(name, state)
    })

    let changed = false
    assignments.forEach((state, name) => {
      if (!state.dynamic && state.values.size === 1) {
        resolved.set(name, String([...state.values][0]))
        changed = true
      }
    })
    if (!changed) break
    folded = foldFixedControlFlow(lines, resolved)
  }

  let sectionNameForFreeze = ''
  return folded.map(line => {
    const header = line.trim().match(/^\[(.*)\]$/)
    if (header) sectionNameForFreeze = header[1].trim().toLowerCase()
    if (sectionNameForFreeze === 'constants' || /^\s*[;#]/.test(line)) return line
    const assignment = line.trim().match(/^(?:post\s+)?(\$[A-Za-z_][\w.]*)\s*=/i)
    if (!assignment || !resolved.has(assignment[1].toLowerCase())) return line
    return `${line.match(/^\s*/)?.[0] || ''}; SSMT inline fixed variable: ${line.trim()}`
  })
}

const collectReachableResourceReferences = (lines: string[]) => {
  const references = new Set<string>()
  lines.forEach(line => {
    if (/^\s*(?:[;#]|\[)/.test(line)) return
    for (const match of line.matchAll(/\b(Resource[A-Za-z0-9_.-]+)\b/gi)) references.add(match[1].toLowerCase())
  })
  return references
}

const commentUnreferencedResourceSections = (lines: string[], references: Set<string>) => {
  const next = [...lines]
  let sectionStart = -1
  let sectionName = ''
  const commentSection = (end: number) => {
    if (sectionStart < 0 || !sectionName.toLowerCase().startsWith('resource') || references.has(sectionName.toLowerCase())) return
    const body = next.slice(sectionStart + 1, end + 1).join('\n')
    const isTextureOrMesh = /(?:^|\s)(?:filename|type)\s*=\s*[^\n]*(?:\.dds|\.png|\.jpe?g|\.tga|\.buf|\.ib|\.vb|buffer|texture)/im.test(body)
    if (!isTextureOrMesh) return
    for (let index = sectionStart; index <= end; index += 1) {
      if (next[index].trim()) next[index] = `${next[index].match(/^\s*/)?.[0] || ''}; SSMT inline unreachable resource: ${next[index].trim()}`
    }
  }
  next.forEach((line, index) => {
    const match = line.trim().match(/^\[(.*)\]$/)
    if (!match) return
    commentSection(index - 1)
    sectionStart = index
    sectionName = match[1].trim()
  })
  commentSection(next.length - 1)
  return next
}

const writeRuntimeValues = async (
  gameName: string,
  modRelativePath: string,
  applied: InlineBackupManifest['applied'],
) => {
  const migoto = await PathHelper.GetGame3DmigotoFolderPath(gameName)
  if (!migoto) throw new Error('3Dmigoto install directory is not configured')
  const userIni = await join(migoto, 'd3dx_user.ini')
  if (!(await exists(userIni))) return
  let lines = await D3dxIniManager.loadIni(userIni)
  const prefix = buildModRuntimePrefix(modRelativePath)
  const values = Object.fromEntries(applied.map(entry => [
    `${prefix}${normalize(entry.sourceIniPath).replace(/\//g, '\\')}\\${entry.variable.replace(/^\$/, '')}`,
    entry.value,
  ]))
  lines = D3dxIniManager.setIniValues(lines, 'Constants', values)
  await D3dxIniManager.saveIni(userIni, lines)
}

export const applyInlineModKeys = async (
  gameName: string,
  mod: ModInfo,
  choices: InlineKeyChoice[],
  selected: Record<string, string>,
) => {
  if (await readManifest(gameName, mod.relativePath)) throw new Error('This Mod already has an active inline-key backup')
  const chosen = choices.filter(choice => selected[`${choice.itemId}:${choice.variable}`] !== undefined)
  if (!chosen.length) throw new Error('No switch parameters selected')

  const files = await collectIniFiles(mod.path)
  const root = await getBackupRoot(gameName, mod.relativePath)
  const filesRoot = await join(root, 'files')
  await mkdir(filesRoot, { recursive: true })
  for (const relative of files) {
    const source = await join(mod.path, relative)
    const target = await join(filesRoot, relative)
    const targetDir = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')))
    await mkdir(targetDir, { recursive: true })
    await copyFile(source, target)
  }

  const applied = chosen.map(choice => ({
    sourceIniPath: choice.sourceIniPath,
    variable: choice.variable,
    value: selected[`${choice.itemId}:${choice.variable}`],
  }))
  const manifest: InlineBackupManifest = { version: 1, gameName, modRelativePath: mod.relativePath, createdAt: Date.now(), files, applied }
  await writeTextFile(await join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const byFile = new Map<string, typeof chosen>()
  chosen.forEach(choice => byFile.set(choice.sourceIniPath, [...(byFile.get(choice.sourceIniPath) || []), choice]))
  const selectedChoiceKeys = new Set(chosen.map(choice => `${choice.itemId}:${choice.variable}`))
  const removableSectionsByFile = new Map<string, Set<string>>()
  const choicesByItem = new Map<string, InlineKeyChoice[]>()
  choices.filter(choice => !choice.itemId.startsWith('constant:')).forEach(choice => {
    choicesByItem.set(choice.itemId, [...(choicesByItem.get(choice.itemId) || []), choice])
  })
  choicesByItem.forEach(itemChoices => {
    if (!itemChoices.every(choice => selectedChoiceKeys.has(`${choice.itemId}:${choice.variable}`))) return
    const first = itemChoices[0]
    const sections = removableSectionsByFile.get(first.sourceIniPath) || new Set<string>()
    sections.add(first.sectionName.toLowerCase())
    removableSectionsByFile.set(first.sourceIniPath, sections)
  })
  const preparedFiles = new Map<string, string[]>()
  const globalResourceReferences = new Set<string>()
  for (const relative of files) {
    const fileChoices = byFile.get(relative) || []
    const path = await join(mod.path, relative)
    let lines = (await readTextFile(path)).split(/\r?\n/)
    fileChoices.forEach(choice => {
      lines = replaceConstantValue(lines, choice.variable, selected[`${choice.itemId}:${choice.variable}`])
    })
    const fixed = new Map(fileChoices.map(choice => [
      choice.variable.toLowerCase(),
      selected[`${choice.itemId}:${choice.variable}`],
    ]))
    lines = freezeVariablesAndCommentUnreachableDraws(lines, fixed)
    collectReachableResourceReferences(lines).forEach(reference => globalResourceReferences.add(reference))
    preparedFiles.set(relative, lines)
  }
  for (const relative of files) {
    let lines = preparedFiles.get(relative) || []
    lines = commentUnreferencedResourceSections(lines, globalResourceReferences)
    lines = removeKeySections(lines, removableSectionsByFile.get(relative) || new Set<string>())
    const path = await join(mod.path, relative)
    await writeTextFile(path, lines.join('\r\n'))
  }
  await writeRuntimeValues(gameName, mod.relativePath, applied)
  return manifest
}

export const restoreInlineModKeys = async (gameName: string, mod: ModInfo) => {
  const manifest = await readManifest(gameName, mod.relativePath)
  if (!manifest) throw new Error('No inline-key backup exists for this Mod')
  const root = await getBackupRoot(gameName, mod.relativePath)
  const filesRoot = await join(root, 'files')
  for (const relative of manifest.files) {
    const source = await join(filesRoot, relative)
    const target = await join(mod.path, relative)
    if (await exists(source)) await copyFile(source, target)
  }
  await writeRuntimeValues(gameName, mod.relativePath, manifest.applied)
  await writeTextFile(await join(root, 'manifest.json.restored'), JSON.stringify({ ...manifest, restoredAt: Date.now() }, null, 2))
  await remove(await join(root, 'manifest.json'))
  return manifest
}
