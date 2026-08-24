import { exists, readDir, readTextFile, writeFile } from '@tauri-apps/plugin-fs'
import type {
  ModKeyConstantBinding,
  ModInfo,
  ModKeyCycleValue,
  ModKeyInfo,
  ModKeyProperty,
  ModKeyScalarValue,
} from '../../store/ModManager'

export interface MigotoIniAnalysisResult {
  modKeyList: ModKeyInfo[]
  excludedPreviewFileNames: string[]
}

/** A single parsed [Resource*] section from a mod INI file */
export interface ModResourceEntry {
  sectionName: string
  sourceIni: string
  sourceIniPath: string
  /** Stable id used by the Mod Analysis page. Usually sourceIniPath::sectionName. */
  resourceId?: string
  /** 3Dmigoto-style namespace for non-global sections. */
  namespace?: string
  /** Namespaced section name used for conflict-free lookup. */
  canonicalName?: string
  filename: string
  type: string
  format: string
  stride: string
  /** All key=value pairs from this section (lowercased keys) */
  allProps: Record<string, string>
  bodyLines?: string[]
  order?: number
}

/** Full INI analysis including parsed resources */
export interface ModIniFullAnalysis {
  modKeyList: ModKeyInfo[]
  constantBindings: ModKeyConstantBinding[]
  resources: ModResourceEntry[]
  textureOverrides: TextureOverrideEntry[]
  commandLists: CommandListEntry[]
  excludedPreviewFileNames: string[]
}

/** A conditional block within a TextureOverride or CommandList */
export interface ConditionalBlock {
  conditions: string[]  // e.g. ["$var == 1"], empty = unconditional
  replaces: { slot: string; resourceName: string; resourceId?: string; unresolved?: boolean }[]
  drawCalls: { type: string; value: string }[]
  runs?: string[]
}

/** A parsed [TextureOverride*] section */
export interface TextureOverrideEntry {
  sectionName: string
  sourceIni: string
  sourceIniPath: string
  hash: string
  matchFirstIndex: string
  handling: string
  matchPriority: string
  /** Conditional blocks: unconditional block first (no conditions), then if/else/endif */
  blocks: ConditionalBlock[]
  /** Flat list of all replaces (for backward compat) */
  replaces: { slot: string; resourceName: string; resourceId?: string; unresolved?: boolean }[]
  /** All draw calls */
  drawCalls: { type: string; value: string }[]
  /** Other key=value pairs */
  allProps: Record<string, string>
  /** Original command stream. Order is semantically significant in 3DMigoto. */
  bodyLines: string[]
  namespace: string
  order: number
}

/** Variable definition extracted from INI */
export interface VariableDef {
  name: string
  initialValue: string
  possibleValues: string[]
  sourceIni: string
  sectionName: string
}

/** A parsed [CommandList*] or [CustomShader*] section */
export interface CommandListEntry {
  sectionName: string
  sourceIni: string
  sourceIniPath: string
  bodyLines: string[]
  namespace: string
  order: number
  /** Each block: condition stack → replaces */
  blocks: {
    conditions: string[]
    replaces: { slot: string; resourceName: string; resourceId?: string; unresolved?: boolean }[]
    drawCalls: { type: string; value: string }[]
    runs?: string[]
  }[]
}

interface VariableCandidate {
  name: string
  initialValue?: string
  possibleValues?: string[]
  sourceIni: string
  sectionName: string
}

/** Auto-grouped DrawIB group (按 DrawIB 自动归组，供按键与预设功能使用) */
export interface DrawIBGroup {
  groupKey: string
  drawHash?: string
  matchFirstIndex?: string
  groupType?: 'mainHash' | 'vb' | 'vertexLimitRaise' | 'slotCheck'
  groupTags?: Array<'hashStyleTexture'>
  variants?: DrawIBGroupVariant[]
  sectionNames: string[]
  ibFile: string
  ibFormat: string
  ibSourceIniPath?: string
  ibResourceId?: string
  vbFiles: {
    slot: string
    resourceName: string
    filename: string
    resourceId?: string
    absolutePath?: string
    sourceLabel?: string
    stride?: string
    format?: string
    sourceIniPath?: string
    unresolved?: boolean
    drawCalls?: { type: string; value: string; conditions: string[] }[]
  }[]
  textureFiles: { slot: string; resourceName: string; filename: string; resourceId?: string; sourceIniPath?: string; sourceLabel?: string; unresolved?: boolean }[]
  /** Raw conditional blocks from all TextureOverrides in this group (for variable filtering) */
  allBlocks: ConditionalBlock[]
}

export interface DrawIBGroupVariant {
  id: string
  label: string
  sectionNames: string[]
  sourceIniPaths: string[]
  vbFiles: DrawIBGroup['vbFiles']
  textureFiles: DrawIBGroup['textureFiles']
  allBlocks: ConditionalBlock[]
}

export interface MigotoIniAnalysisSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: MigotoIniAnalysisResult
  error?: string
}

interface MigotoIniAnalysisEntry extends MigotoIniAnalysisSnapshot {
  gameName: string
  modRelativePath: string
  modPath: string
  queued: boolean
  listeners: Set<(snapshot: MigotoIniAnalysisSnapshot) => void>
}

interface IniSectionRange {
  sectionName: string
  sectionNameLower: string
  headerLine: string
  startLine: number
  endLine: number
  bodyLines: string[]
  keySectionIndex: number | null
}

interface ParsedIniContent {
  modKeyList: ModKeyInfo[]
  constantBindings: ModKeyConstantBinding[]
  excludedPreviewFileNames: string[]
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
const KNOWN_KEY_TYPES = new Set(['default', 'hold', 'toggle', 'cycle'])
const CYCLE_ONLY_PROPERTIES = new Set(['wrap', 'smart'])
const HOLD_ONLY_PROPERTIES = new Set(['delay', 'release_delay'])

const MIGOTO_VKEY_NAMES = new Set(`LBUTTON RBUTTON CANCEL MBUTTON XBUTTON1 XBUTTON2 BACK BACKSPACE BACK_SPACE TAB CLEAR RETURN ENTER SHIFT CONTROL CTRL MENU ALT PAUSE CAPITAL CAPS CAPSLOCK CAPS_LOCK KANA HANGUEL HANGUL JUNJA FINAL HANJA KANJI ESCAPE CONVERT NONCONVERT ACCEPT MODECHANGE SPACE PRIOR PGUP PAGEUP PAGE_UP NEXT PGDN PAGEDOWN PAGE_DOWN END HOME LEFT UP RIGHT DOWN SELECT PRINT EXECUTE SNAPSHOT PRSCR PRINTSCREEN PRINT_SCREEN INSERT DELETE HELP LWIN LEFT_WIN LEFT_WINDOWS RWIN RIGHT_WIN RIGHT_WINDOWS APPS SLEEP MULTIPLY ADD SEPARATOR SUBTRACT DECIMAL DIVIDE NUMLOCK SCROLL LSHIFT LEFT_SHIFT RSHIFT RIGHT_SHIFT LCONTROL LEFT_CONTROL LCTRL LEFT_CTRL RCONTROL RIGHT_CONTROL RCTRL RIGHT_CTRL LMENU LEFT_MENU LALT LEFT_ALT RMENU RIGHT_MENU RALT RIGHT_ALT BROWSER_BACK BROWSER_FORWARD BROWSER_REFRESH BROWSER_STOP BROWSER_SEARCH BROWSER_FAVORITES BROWSER_HOME VOLUME_MUTE VOLUME_DOWN VOLUME_UP MEDIA_NEXT_TRACK MEDIA_PREV_TRACK MEDIA_STOP MEDIA_PLAY_PAUSE LAUNCH_MAIL LAUNCH_MEDIA_SELECT LAUNCH_APP1 LAUNCH_APP2 OEM_1 COLON SEMICOLON SEMI_COLON OEM_PLUS PLUS EQUALS OEM_COMMA COMMA OEM_MINUS MINUS UNDERSCORE OEM_PERIOD PERIOD OEM_2 SLASH FORWARD_SLASH QUESTION QUESTION_MARK OEM_3 TILDE GRAVE OEM_4 OEM_5 BACKSLASH BACK_SLASH PIPE VERTICAL_BAR OEM_6 OEM_7 QUOTE DOUBLE_QUOTE OEM_8 OEM_102 PROCESSKEY ATTN CRSEL EXSEL EREOF PLAY ZOOM NONAME PA1 OEM_CLEAR`.split(' '))
for (let index = 0; index <= 9; index += 1) MIGOTO_VKEY_NAMES.add(`NUMPAD${index}`)
for (let index = 1; index <= 24; index += 1) MIGOTO_VKEY_NAMES.add(`F${index}`)
const MIGOTO_SYMBOL_KEYS = new Set([';', ':', '=', ',', '<', '_', '.', '>', '/', '?', '`', '~', '[', '{', '\\', '|', ']', '}', "'", '"', '*', '-', '+'])
const MIGOTO_LEGACY_SINGLE_KEYS = new Set(['NUM 1', 'NUM 2', 'NUM 3', 'NUM 4', 'NUM 5', 'NUM 6', 'NUM 7', 'NUM 8', 'NUM 9', 'NUM /', 'PRNT SCRN'])
const MIGOTO_XINPUT_BUTTONS = new Set(['DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'START', 'BACK', 'LEFT_THUMB', 'RIGHT_THUMB', 'LEFT_SHOULDER', 'RIGHT_SHOULDER', 'A', 'B', 'X', 'Y', 'GUIDE'])

const isMigotoVKey = (rawToken: string): boolean => {
  let token = rawToken.trim().toUpperCase()
  if (token.startsWith('NO_')) token = token.slice(3)
  if (/^[A-Z0-9]$/.test(token) || /^0X[0-9A-F]+$/.test(token)) return true
  if (token.startsWith('VK_')) token = token.slice(3)
  return MIGOTO_VKEY_NAMES.has(token) || MIGOTO_SYMBOL_KEYS.has(token)
}

const isMigotoXInputKey = (rawValue: string): boolean => {
  let value = rawValue.trim().toUpperCase()
  if (value.startsWith('NO_')) value = value.slice(3)
  const match = value.match(/^XB([1-4])?_(.+)$/)
  if (!match) return false
  if (MIGOTO_XINPUT_BUTTONS.has(match[2])) return true
  const trigger = match[2].match(/^(LEFT_TRIGGER|RIGHT_TRIGGER)(?:\s*>\s*(\d+))?$/)
  return !!trigger && (trigger[2] === undefined || Number(trigger[2]) <= 255)
}

export const validateMigotoKeyBinding = (rawValue: string): string | null => {
  const value = rawValue.trim()
  if (!value) return 'Key binding cannot be empty'
  if (MIGOTO_LEGACY_SINGLE_KEYS.has(value.toUpperCase()) || isMigotoVKey(value) || isMigotoXInputKey(value)) return null
  const tokens = value.split(/ +/).filter(Boolean)
  if (tokens.length && tokens.every((token) => token.toLowerCase() === 'no_modifiers' || isMigotoVKey(token) || isMigotoXInputKey(token))) return null
  return `Invalid 3Dmigoto key binding: ${value}`
}

const joinPath = (...parts: string[]) => parts
  .map((part, index) => {
    const normalized = String(part || '').replace(/\\/g, '/')
    if (index === 0) return normalized.replace(/\/+$/g, '')
    return normalized.replace(/^\/+|\/+$/g, '')
  })
  .filter(Boolean)
  .join('/')

const normalizePath = (value: string) => String(value || '').replace(/\\/g, '/')

const getRelativePath = (basePath: string, fullPath: string) => {
  const normalizedBase = normalizePath(basePath).replace(/\/+$/g, '')
  const normalizedFull = normalizePath(fullPath)
  if (normalizedFull.startsWith(`${normalizedBase}/`)) {
    return normalizedFull.slice(normalizedBase.length + 1)
  }
  return normalizedFull
}

const getCacheKey = (gameName: string, modRelativePath: string) => `${gameName}:${modRelativePath}`

const getFileName = (value: string) => {
  const trimmed = value.trim().replace(/^['"]+|['"]+$/g, '')
  if (!trimmed) return ''
  const normalized = trimmed.replace(/\\/g, '/')
  return (normalized.split('/').pop() || '').trim()
}

const getLowerFileName = (value: string) => getFileName(value).toLowerCase()

const isDisabledIniEntryName = (value: string) => value.trim().toLowerCase().startsWith('disabled')

const isImageFileName = (value: string) => {
  const lower = value.toLowerCase()
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

const resolveResourceAbsolutePath = (modPath: string, resource: Pick<ModResourceEntry, 'filename' | 'sourceIniPath'>) => {
  const normalizedModPath = normalizePath(modPath).replace(/\/+$/g, '')
  const iniDir = resource.sourceIniPath.includes('/')
    ? resource.sourceIniPath.slice(0, resource.sourceIniPath.lastIndexOf('/'))
    : ''
  const base = iniDir ? joinPath(normalizedModPath, iniDir) : normalizedModPath
  return joinPath(base, resource.filename)
}

const isResourceReferencePlaceholder = (filename: string) => filename.startsWith('[ref:') && filename.endsWith(']')

const filterMissingResourceFiles = async (modPath: string, resources: ModResourceEntry[]) => {
  const filtered: ModResourceEntry[] = []
  for (const resource of resources) {
    const filename = resource.filename.trim()
    if (!filename || isResourceReferencePlaceholder(filename)) {
      filtered.push(resource)
      continue
    }

    const resourcePath = resolveResourceAbsolutePath(modPath, resource)
    if (await exists(resourcePath)) {
      filtered.push(resource)
    }
  }
  return filtered
}

const inferLineEnding = (content: string) => (content.includes('\r\n') ? '\r\n' : '\n')

const parseAssignment = (line: string) => {
  const index = line.indexOf('=')
  if (index === -1) return null
  return {
    key: line.slice(0, index).trim(),
    value: line.slice(index + 1).trim(),
  }
}

const stripInlineComment = (value: string) => {
  let quote = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if ((ch === '"' || ch === "'") && value[i - 1] !== '\\') {
      quote = quote === ch ? '' : quote || ch
    }
    if (!quote && (ch === ';' || ch === '#')) {
      return value.slice(0, i).trim()
    }
  }
  return value.trim()
}

const normalizeCommandKey = (key: string) => {
  let normalized = key.trim()
  for (;;) {
    const next = normalized.replace(/^(pre|post)\s+/i, '').trim()
    if (next === normalized) return normalized
    normalized = next
  }
}

const normalizeResourceReference = (value: string) => {
  let normalized = stripInlineComment(value).split(',')[0]?.trim() || ''
  normalized = normalized.replace(/^(ref|copy)\s+/i, '').trim()
  return normalized
}

const isNullResourceReference = (value: string) => {
  const lower = normalizeResourceReference(value).toLowerCase()
  return !lower || lower === 'null'
}

const buildConstantBindingKey = (sourceIniPath: string, variableName: string) => `${sourceIniPath.toLowerCase()}::${variableName.toLowerCase()}`

const cloneConstantBinding = (binding: ModKeyConstantBinding): ModKeyConstantBinding => ({
  ...binding,
  declarationModifiers: [...binding.declarationModifiers],
})

const createPlaceholderConstantBinding = (sourceIni: string, sourceIniPath: string, name: string): ModKeyConstantBinding => ({
  bindingKey: buildConstantBindingKey(sourceIniPath, name),
  name,
  initialValue: '',
  declarationSourceIni: sourceIni,
  declarationSourceIniPath: sourceIniPath,
  declarationSectionName: 'Constants',
  declarationModifiers: ['global'],
  createdByEditor: true,
})

const parseConstantDeclarationKey = (key: string) => {
  const tokens = key.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  const name = tokens[tokens.length - 1].trim()
  if (!name.startsWith('$')) return null

  return {
    name,
    modifiers: tokens.slice(0, -1).map((token) => token.trim().toLowerCase()).filter(Boolean),
  }
}

const buildConstantDeclarationLine = (binding: ModKeyConstantBinding) => {
  const modifiers = binding.declarationModifiers
    .map((modifier) => modifier.trim())
    .filter(Boolean)
    .join(' ')
  const name = binding.name.trim()
  const value = binding.initialValue.trim()

  return `${modifiers ? `${modifiers} ` : ''}${name} = ${value}`
}

const buildValueSummary = (item: {
  extraProperties: ModKeyProperty[]
  activeValues: ModKeyScalarValue[]
  cycleValues: ModKeyCycleValue[]
}) => {
  const segments: string[] = []

  item.extraProperties.forEach((entry) => {
    segments.push(`${entry.key} = ${entry.value}`)
  })

  item.activeValues
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .forEach(({ name, value }) => {
      segments.push(`${name} = ${value}`)
    })

  item.cycleValues
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .forEach(({ name, values }) => {
      segments.push(`${name} = ${values.join(', ')}`)
    })

  return segments.join(' | ')
}

const cloneExtraProperty = (entry: ModKeyProperty): ModKeyProperty => ({
  id: entry.id,
  key: entry.key,
  value: entry.value,
})

export const cloneModKeyInfo = (item: ModKeyInfo): ModKeyInfo => ({
  ...item,
  keys: [...item.keys],
  backs: [...item.backs],
  activeValues: item.activeValues.map((entry) => ({
    ...entry,
    constantBinding: cloneConstantBinding(entry.constantBinding),
  })),
  cycleValues: item.cycleValues.map((entry) => ({
    ...entry,
    values: [...entry.values],
    constantBinding: cloneConstantBinding(entry.constantBinding),
  })),
  extraProperties: item.extraProperties.map(cloneExtraProperty),
})

export const linkSharedConstantBindings = (items: ModKeyInfo[]) => {
  const sharedBindings = new Map<string, ModKeyConstantBinding>()

  items.forEach((item) => {
    ;[...item.activeValues, ...item.cycleValues].forEach((entry) => {
      const bindingKey = entry.constantBinding.bindingKey || buildConstantBindingKey(item.sourceIniPath, entry.name)
      const existing = sharedBindings.get(bindingKey)
      if (existing) {
        entry.constantBinding = existing
        return
      }

      entry.constantBinding.bindingKey = bindingKey
      sharedBindings.set(bindingKey, entry.constantBinding)
    })
  })

  return items
}

const createEmptyResult = (): MigotoIniAnalysisResult => ({
  modKeyList: [],
  excludedPreviewFileNames: [],
})

const parseIniSections = (content: string): IniSectionRange[] => {
  const lines = content.split(/\r?\n/)
  const sections: IniSectionRange[] = []
  let currentStart = -1
  let currentName = ''
  let currentHeaderLine = ''
  let keySectionIndex = 0

  const pushCurrent = (endLine: number) => {
    if (currentStart === -1) return
    const sectionNameLower = currentName.toLowerCase()
    const isKeySection = sectionNameLower.startsWith('key')
    sections.push({
      sectionName: currentName,
      sectionNameLower,
      headerLine: currentHeaderLine,
      startLine: currentStart,
      endLine,
      bodyLines: lines.slice(currentStart + 1, endLine + 1),
      keySectionIndex: isKeySection ? keySectionIndex++ : null,
    })
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      pushCurrent(index - 1)
      currentStart = index
      currentHeaderLine = line
      currentName = trimmed.slice(1, -1)
    }
  })

  pushCurrent(lines.length - 1)
  return sections
}

const parseKeySection = (
  section: IniSectionRange,
  sourceIni: string,
  sourceIniPath: string,
): ModKeyInfo | null => {
  const keys: string[] = []
  const backs: string[] = []
  const activeValuesMap = new Map<string, ModKeyScalarValue>()
  const cycleValuesMap = new Map<string, ModKeyCycleValue>()
  const extraProperties: ModKeyProperty[] = []
  let keyType = ''
  let conditionSummary = ''

  section.bodyLines.forEach((rawLine, lineIndex) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      return
    }

    const assignment = parseAssignment(trimmed)
    if (!assignment) {
      return
    }

    const lowerKey = assignment.key.toLowerCase()
    if (lowerKey === 'key') {
      if (assignment.value) keys.push(assignment.value)
      return
    }

    if (lowerKey === 'back') {
      if (assignment.value) backs.push(assignment.value)
      return
    }

    if (lowerKey === 'type') {
      keyType = assignment.value
      return
    }

    if (lowerKey === 'condition') {
      conditionSummary = assignment.value
      return
    }

    if (assignment.key.trim().startsWith('$')) {
      const values = assignment.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)

      if (values.length <= 1) {
        activeValuesMap.set(assignment.key.trim(), {
          name: assignment.key.trim(),
          value: values[0] || assignment.value.trim(),
          constantBinding: createPlaceholderConstantBinding(sourceIni, sourceIniPath, assignment.key.trim()),
        })
      } else {
        cycleValuesMap.set(assignment.key.trim(), {
          name: assignment.key.trim(),
          values,
          constantBinding: createPlaceholderConstantBinding(sourceIni, sourceIniPath, assignment.key.trim()),
        })
      }
      return
    }

    extraProperties.push({
      id: `${sourceIniPath}:${section.keySectionIndex}:${lineIndex}`,
      key: assignment.key,
      value: assignment.value,
    })
  })

  const activeValues = Array.from(activeValuesMap.values())
  const cycleValues = Array.from(cycleValuesMap.values())
  const valueSummary = buildValueSummary({ extraProperties, activeValues, cycleValues })
  if (!valueSummary && keys.length === 0 && backs.length === 0 && !keyType) {
    return null
  }

  return {
    id: `${sourceIniPath}::${section.keySectionIndex ?? -1}`,
    sourceIni,
    sourceIniPath,
    sectionName: section.sectionName,
    sectionIndex: section.keySectionIndex ?? -1,
    keyName: keys[0] || '',
    backName: backs[0] || '',
    keyType,
    keys,
    backs,
    conditionSummary,
    valueSummary,
    activeValues,
    cycleValues,
    extraProperties,
  }
}

const parseConstantsSection = (
  section: IniSectionRange,
  sourceIni: string,
  sourceIniPath: string,
) => {
  const constantBindings: ModKeyConstantBinding[] = []

  section.bodyLines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      return
    }

    const assignment = parseAssignment(trimmed)
    if (!assignment) {
      return
    }

    const declaration = parseConstantDeclarationKey(assignment.key)
    if (!declaration) {
      return
    }

    constantBindings.push({
      bindingKey: buildConstantBindingKey(sourceIniPath, declaration.name),
      name: declaration.name,
      initialValue: assignment.value.trim(),
      declarationSourceIni: sourceIni,
      declarationSourceIniPath: sourceIniPath,
      declarationSectionName: section.sectionName,
      declarationModifiers: declaration.modifiers,
      createdByEditor: false,
    })
  })

  return constantBindings
}

const attachConstantBindingsToModKeys = (modKeyList: ModKeyInfo[], constantBindings: ModKeyConstantBinding[]) => {
  const bindingsByName = new Map<string, ModKeyConstantBinding[]>()
  constantBindings.forEach((binding) => {
    const key = binding.name.toLowerCase()
    const list = bindingsByName.get(key) || []
    list.push(binding)
    bindingsByName.set(key, list)
  })

  const sharedBindings = new Map<string, ModKeyConstantBinding>()

  const resolveBinding = (item: ModKeyInfo, variableName: string) => {
    const lowerName = variableName.toLowerCase()
    const candidates = bindingsByName.get(lowerName) || []
    const matchedBinding = [...candidates].reverse().find((binding) => binding.declarationSourceIniPath.toLowerCase() === item.sourceIniPath.toLowerCase())
      || candidates[candidates.length - 1]
      || createPlaceholderConstantBinding(item.sourceIni, item.sourceIniPath, variableName)

    const bindingKey = matchedBinding.bindingKey || buildConstantBindingKey(matchedBinding.declarationSourceIniPath || item.sourceIniPath, variableName)
    const sharedBinding = sharedBindings.get(bindingKey)
    if (sharedBinding) {
      return sharedBinding
    }

    const nextBinding = cloneConstantBinding(matchedBinding)
    nextBinding.bindingKey = bindingKey
    sharedBindings.set(bindingKey, nextBinding)
    return nextBinding
  }

  modKeyList.forEach((item) => {
    item.activeValues.forEach((entry) => {
      entry.constantBinding = resolveBinding(item, entry.name.trim())
    })
    item.cycleValues.forEach((entry) => {
      entry.constantBinding = resolveBinding(item, entry.name.trim())
    })
  })

  return modKeyList
}

const parseResourceSection = (section: IniSectionRange, sourceIni: string, sourceIniPath: string, namespace = '', order = 0): ModResourceEntry => {
  const allProps: Record<string, string> = {}
  let filename = ''
  let type = ''
  let format = ''
  let stride = ''

  section.bodyLines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) return
    const assignment = parseAssignment(trimmed)
    if (!assignment) return
    const key = assignment.key.trim()
    const value = assignment.value.trim()
    allProps[key.toLowerCase()] = value
    const keyLower = key.toLowerCase()
    if (keyLower === 'filename') filename = value
    else if (keyLower === 'type') type = value
    else if (keyLower === 'format') format = value
    else if (keyLower === 'stride') stride = value
  })

  // ResourceRef sections with no body still represent a resource reference.
  // Derive the filename from the section name (e.g. "ResourceRefHeadDiffuse" → "HeadDiffuse").
  if (!filename && section.sectionNameLower.startsWith('resourceref')) {
    // Strip "ResourceRef" prefix (case-insensitive)
    const refName = section.sectionName.slice(11) // "ResourceRef".length === 11
    if (refName) {
      filename = `[ref:${refName}]`
    }
  }

  const prefix = section.sectionName.match(/^(Resource)/i)?.[0] || 'Resource'
  const suffix = section.sectionName.slice(prefix.length)
  const canonicalName = namespace ? `${prefix}\\${namespace}\\${suffix}` : section.sectionName
  return { sectionName: section.sectionName, sourceIni, sourceIniPath, filename, type, format, stride, allProps, bodyLines: [...section.bodyLines], namespace, canonicalName, resourceId: `${sourceIniPath.toLowerCase()}::${section.sectionName.toLowerCase()}`, order }
}

const isSlotKey = (key: string) => {
  const lower = normalizeCommandKey(key).toLowerCase()
  if (lower === 'ib' || lower === 'this') return true
  if (/^vb\d+$/.test(lower)) return true
  if (/^(vs|ps|gs|hs|ds|cs)-(t|s|u|cb)\d+$/.test(lower)) return true
  if (/^(o|so)\d+$/.test(lower)) return true
  return false
}

/** Parse conditional blocks from body lines (if/else/endif) */
const parseConditionalBlocks = (bodyLines: string[]): ConditionalBlock[] => {
  const blocks: ConditionalBlock[] = []
  // Each condition is a single expression string, kept as a separate stack entry so
  // evalCondition (single $var == value / !(...) / truthy) works unchanged.
  // if-frame = { baseDepth, siblingConditions }. endif resets stack to baseDepth.
  const condStack: string[] = []
  let cur: ConditionalBlock = { conditions: [], replaces: [], drawCalls: [], runs: [] }
  interface IfFrame { baseDepth: number; siblingConditions: string[] }
  const ifFrames: IfFrame[] = []

  const pushBlock = () => { if (cur.replaces.length > 0 || cur.drawCalls.length > 0 || (cur.runs?.length || 0) > 0) blocks.push({ ...cur, conditions: [...cur.conditions], runs: [...(cur.runs || [])] }) }

  const startBranch = (condStr: string | null) => {
    const frame = ifFrames[ifFrames.length - 1]
    if (!frame) {
      if (condStr) condStack.push(condStr)
      cur = { conditions: [...condStack], replaces: [], drawCalls: [], runs: [] }
      return
    }
    condStack.length = frame.baseDepth
    for (const sib of frame.siblingConditions) {
      condStack.push(`!(${sib})`)
    }
    if (condStr) {
      condStack.push(condStr)
      frame.siblingConditions.push(condStr)
    }
    cur = { conditions: [...condStack], replaces: [], drawCalls: [], runs: [] }
  }

  for (const rawLine of bodyLines) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
    const lower = trimmed.toLowerCase()

    if (lower.startsWith("if ")) {
      pushBlock()
      ifFrames.push({ baseDepth: condStack.length, siblingConditions: [] })
      startBranch(trimmed.slice(3).trim())
      continue
    }
    if (lower.startsWith("else if ")) {
      pushBlock()
      startBranch(trimmed.slice(8).trim())
      continue
    }
    if (lower.startsWith("elif ")) {
      pushBlock()
      startBranch(trimmed.slice(5).trim())
      continue
    }
    if (lower === "else") {
      pushBlock()
      startBranch(null)
      continue
    }
    if (lower === "endif") {
      pushBlock()
      const frame = ifFrames.pop()
      if (frame) condStack.length = frame.baseDepth
      cur = { conditions: [...condStack], replaces: [], drawCalls: [], runs: [] }
      continue
    }

    const assignment = parseAssignment(trimmed)
    if (!assignment) continue
    const key = normalizeCommandKey(assignment.key)
    const value = stripInlineComment(assignment.value)
    if (isSlotKey(key)) {
      if (!isNullResourceReference(value)) {
        cur.replaces.push({ slot: key.toLowerCase(), resourceName: normalizeResourceReference(value) })
      }
    } else if (["drawindexed", "drawindexedinstanced", "draw"].includes(key.toLowerCase())) {
      cur.drawCalls.push({ type: key.toLowerCase(), value })
    } else if (key.toLowerCase() === "run" && value) {
      cur.runs?.push(normalizeResourceReference(value))
    }
  }
  pushBlock()
  return blocks
}

const parseTextureOverrideSection = (section: IniSectionRange, sourceIni: string, sourceIniPath: string, namespace: string, order: number): TextureOverrideEntry => {
  const allProps: Record<string, string> = {}
  let hash = ''
  let matchFirstIndex = ''
  let handling = ''
  let matchPriority = ''

  const blocks = parseConditionalBlocks(section.bodyLines)
  const allReplaces = blocks.flatMap(b => b.replaces)
  const allDrawCalls = blocks.flatMap(b => b.drawCalls)

  section.bodyLines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('if ') || trimmed.toLowerCase() === 'else' || trimmed.toLowerCase() === 'endif') return
    const assignment = parseAssignment(trimmed)
    if (!assignment) return
    const key = assignment.key.trim()
    const value = assignment.value.trim()
    allProps[key.toLowerCase()] = value
    const kl = key.toLowerCase()
    if (kl === 'hash') hash = value
    else if (kl === 'match_first_index') matchFirstIndex = value
    else if (kl === 'handling') handling = value
    else if (kl === 'match_priority') matchPriority = value
  })

  return { sectionName: section.sectionName, sourceIni, sourceIniPath, hash, matchFirstIndex, handling, matchPriority, blocks, replaces: allReplaces, drawCalls: allDrawCalls, allProps, bodyLines: [...section.bodyLines], namespace, order }
}

const parseCommandListSection = (section: IniSectionRange, sourceIni: string, sourceIniPath: string, namespace: string, order: number): CommandListEntry => {
  const blocks: CommandListEntry["blocks"] = []
  // Each condition is a single expression string, kept as a separate stack entry so
  // evalCondition works unchanged. if-frame = { baseDepth, siblingConditions }.
  const conditionStack: string[] = []
  let currentBlock: CommandListEntry["blocks"][0] = { conditions: [], replaces: [], drawCalls: [], runs: [] }
  interface IfFrame { baseDepth: number; siblingConditions: string[] }
  const ifFrames: IfFrame[] = []

  const flushBlock = () => {
    if (currentBlock.replaces.length > 0 || currentBlock.drawCalls.length > 0 || (currentBlock.runs?.length || 0) > 0) {
      blocks.push(currentBlock)
    }
  }

  const startBranch = (condStr: string | null) => {
    const frame = ifFrames[ifFrames.length - 1]
    if (!frame) {
      if (condStr) conditionStack.push(condStr)
      currentBlock = { conditions: [...conditionStack], replaces: [], drawCalls: [], runs: [] }
      return
    }
    conditionStack.length = frame.baseDepth
    for (const sib of frame.siblingConditions) {
      conditionStack.push(`!(${sib})`)
    }
    if (condStr) {
      conditionStack.push(condStr)
      frame.siblingConditions.push(condStr)
    }
    currentBlock = { conditions: [...conditionStack], replaces: [], drawCalls: [], runs: [] }
  }

  section.bodyLines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) return
    const lower = trimmed.toLowerCase()

    if (lower.startsWith("if ")) {
      flushBlock()
      ifFrames.push({ baseDepth: conditionStack.length, siblingConditions: [] })
      startBranch(trimmed.slice(3).trim())
      return
    }
    if (lower.startsWith("else if ")) {
      flushBlock()
      startBranch(trimmed.slice(8).trim())
      return
    }
    if (lower.startsWith("elif ")) {
      flushBlock()
      startBranch(trimmed.slice(5).trim())
      return
    }
    if (lower === "else") {
      flushBlock()
      startBranch(null)
      return
    }
    if (lower === "endif") {
      flushBlock()
      const frame = ifFrames.pop()
      if (frame) conditionStack.length = frame.baseDepth
      currentBlock = { conditions: [...conditionStack], replaces: [], drawCalls: [], runs: [] }
      return
    }

    const assignment = parseAssignment(trimmed)
    if (!assignment) return
    const key = normalizeCommandKey(assignment.key)
    const value = stripInlineComment(assignment.value)
    if (isSlotKey(key)) {
      const slot = key.toLowerCase()
      const resourceName = normalizeResourceReference(value)
      if (!isNullResourceReference(value)) currentBlock.replaces.push({ slot, resourceName })
    } else if (["drawindexed", "drawindexedinstanced", "draw"].includes(key.toLowerCase())) {
      currentBlock.drawCalls.push({ type: key.toLowerCase(), value })
    } else if (key.toLowerCase() === "run" && value) {
      currentBlock.runs?.push(normalizeResourceReference(value))
    }
  })
  flushBlock()

  return { sectionName: section.sectionName, sourceIni, sourceIniPath, bodyLines: [...section.bodyLines], namespace, order, blocks: blocks.filter(b => b.replaces.length > 0 || b.drawCalls.length > 0 || (b.runs?.length || 0) > 0) }
}

const VARIABLE_NAME_PATTERN = /\$\\[^=!<>\s&|,+\-*/%^()[\]{};#]+\\[A-Za-z_][A-Za-z0-9_.]*|\$[A-Za-z_][A-Za-z0-9_.]*/g
const SIMPLE_COMPARE_PATTERN = /(\$\\[^=!<>\s&|,+\-*/%^()[\]{};#]+\\[A-Za-z_][A-Za-z0-9_.]*|\$[A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=|<=|>=|<|>)\s*([^&|)\r\n]+)/g
const SIMPLE_LITERAL_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+|0x[0-9a-f]+)$/i

const normalizeVariableName = (name: string) => name.trim()

const isSimplePreviewLiteral = (value: string) => {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed || trimmed.startsWith('$')) return false
  return SIMPLE_LITERAL_PATTERN.test(trimmed)
}

const addVariableCandidate = (varMap: Map<string, VariableDef>, candidate: VariableCandidate) => {
  const name = normalizeVariableName(candidate.name)
  if (!name.startsWith('$')) return
  const key = name.toLowerCase()
  const possibleValues = (candidate.possibleValues || [])
    .map(value => value.trim())
    .filter(Boolean)
  const initialValue = candidate.initialValue?.trim() || possibleValues[0] || '0'
  const existing = varMap.get(key)

  if (!existing) {
    const values = possibleValues.length > 0 ? [...possibleValues] : [initialValue]
    if (initialValue && !values.includes(initialValue)) values.unshift(initialValue)
    varMap.set(key, {
      name,
      initialValue,
      possibleValues: values,
      sourceIni: candidate.sourceIni,
      sectionName: candidate.sectionName,
    })
    return
  }

  if ((!existing.initialValue || existing.initialValue === '0') && initialValue) {
    existing.initialValue = initialValue
  }
  for (const value of possibleValues) {
    if (!existing.possibleValues.includes(value)) existing.possibleValues.push(value)
  }
  if (initialValue && !existing.possibleValues.includes(initialValue)) {
    existing.possibleValues.unshift(initialValue)
  }
}

const collectVariablesFromExpression = (
  expression: string,
  sourceIni: string,
  sectionName: string,
  varMap: Map<string, VariableDef>,
) => {
  for (const match of expression.matchAll(VARIABLE_NAME_PATTERN)) {
    addVariableCandidate(varMap, {
      name: match[0],
      sourceIni,
      sectionName,
    })
  }

  for (const match of expression.matchAll(SIMPLE_COMPARE_PATTERN)) {
    const value = match[3].trim().replace(/^['"]|['"]$/g, '')
    if (!isSimplePreviewLiteral(value)) continue
    addVariableCandidate(varMap, {
      name: match[1],
      possibleValues: [value],
      sourceIni,
      sectionName,
    })
  }
}

const comparePreviewValues = (left: string, right: string) => {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  const leftIsNumber = Number.isFinite(leftNumber)
  const rightIsNumber = Number.isFinite(rightNumber)
  if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/** Extract all preview-relevant variables from declarations, key assignments, and command-list expressions. */
export const extractVariables = (analysis: ModIniFullAnalysis): VariableDef[] => {
  const varMap = new Map<string, VariableDef>()

  for (const binding of analysis.constantBindings) {
    addVariableCandidate(varMap, {
      name: binding.name,
      initialValue: binding.initialValue,
      sourceIni: binding.declarationSourceIni,
      sectionName: binding.declarationSectionName,
    })
  }

  for (const key of analysis.modKeyList) {
    if (key.conditionSummary) {
      collectVariablesFromExpression(key.conditionSummary, key.sourceIni, key.sectionName, varMap)
    }
    for (const av of key.activeValues) {
      addVariableCandidate(varMap, {
        name: av.name,
        initialValue: av.constantBinding?.initialValue || av.value,
        possibleValues: [av.value],
        sourceIni: key.sourceIni,
        sectionName: key.sectionName,
      })
      collectVariablesFromExpression(av.value, key.sourceIni, key.sectionName, varMap)
    }
    for (const cv of key.cycleValues) {
      addVariableCandidate(varMap, {
        name: cv.name,
        initialValue: cv.constantBinding?.initialValue || cv.values[0] || '',
        possibleValues: cv.values,
        sourceIni: key.sourceIni,
        sectionName: key.sectionName,
      })
    }
  }

  for (const to of analysis.textureOverrides) {
    for (const block of to.blocks) {
      block.conditions.forEach(condition => collectVariablesFromExpression(condition, to.sourceIni, to.sectionName, varMap))
      block.drawCalls.forEach(drawCall => collectVariablesFromExpression(drawCall.value, to.sourceIni, to.sectionName, varMap))
    }
  }

  for (const commandList of analysis.commandLists) {
    for (const block of commandList.blocks) {
      block.conditions.forEach(condition => collectVariablesFromExpression(condition, commandList.sourceIni, commandList.sectionName, varMap))
      block.drawCalls.forEach(drawCall => collectVariablesFromExpression(drawCall.value, commandList.sourceIni, commandList.sectionName, varMap))
    }
  }

  return Array.from(varMap.values())
    .map(variable => ({
      ...variable,
      possibleValues: [...new Set(variable.possibleValues)].sort(comparePreviewValues),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Evaluate a single condition string against variable states */
export const evalCondition = (cond: string, varStates: Record<string, string>): boolean => {
  // Patterns: "$var == value", "$var != value", "$var" (truthy)
  const trimmed = cond.trim()
  // Negated wrapper: !($var == value)
  if (trimmed.startsWith('!(') && trimmed.endsWith(')')) return !evalCondition(trimmed.slice(2, -1), varStates)
  // Equality
  const eqMatch = trimmed.match(/^(\$[^\s=!<>]+)\s*==\s*(.+)$/)
  if (eqMatch) return (varStates[eqMatch[1]] || '0') === eqMatch[2].trim()
  // Inequality
  const neqMatch = trimmed.match(/^(\$[^\s=!<>]+)\s*!=\s*(.+)$/)
  if (neqMatch) return (varStates[neqMatch[1]] || '0') !== neqMatch[2].trim()
  // Just variable name → truthy check (non-zero)
  const varMatch = trimmed.match(/^(\$[^\s=!<>]+)$/)
  if (varMatch) return (varStates[varMatch[1]] || '0') !== '0'
  // Unknown condition → assume true
  return true
}

const splitLogicalCondition = (input: string, operator: '&&' | '||'): string[] => {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length - 1; i++) {
    const ch = input[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)

    if (depth === 0 && input.slice(i, i + 2) === operator) {
      result.push(input.slice(start, i).trim())
      start = i + 2
      i += 1
    }
  }

  if (start > 0) result.push(input.slice(start).trim())
  return result
}

export const evalConditionExpression = (cond: string, varStates: Record<string, string>): boolean => {
  const trimmed = cond.trim()
  if (!trimmed) return true

  const orParts = splitLogicalCondition(trimmed, '||')
  if (orParts.length > 0) return orParts.some(part => evalConditionExpression(part, varStates))

  const andParts = splitLogicalCondition(trimmed, '&&')
  if (andParts.length > 0) return andParts.every(part => evalConditionExpression(part, varStates))

  if (trimmed.startsWith('!(') && trimmed.endsWith(')')) {
    return !evalConditionExpression(trimmed.slice(2, -1), varStates)
  }

  const compareMatch = trimmed.match(/^(\$[^\s=!<>]+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/)
  if (compareMatch) {
    const left = varStates[compareMatch[1]] || '0'
    const right = compareMatch[3].trim()
    const operator = compareMatch[2]

    if (operator === '==') return left === right
    if (operator === '!=') return left !== right

    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false

    if (operator === '<') return leftNumber < rightNumber
    if (operator === '>') return leftNumber > rightNumber
    if (operator === '<=') return leftNumber <= rightNumber
    if (operator === '>=') return leftNumber >= rightNumber
  }

  return evalCondition(trimmed, varStates)
}

/** Filter a list of conditional blocks based on current variable states */
export const filterActiveBlocks = (blocks: ConditionalBlock[], varStates: Record<string, string>): ConditionalBlock[] => {
  const result: ConditionalBlock[] = []
  for (const block of blocks) {
    let allTrue = true
    for (const cond of block.conditions) {
      if (cond === 'else') { allTrue = true; break }
      if (!evalConditionExpression(cond, varStates)) { allTrue = false; break }
    }
    if (allTrue) result.push(block)
  }
  return result
}

/** Group TextureOverrides by IB hash, resolving CommandList references where needed */
export const groupDrawIBs = (textureOverrides: TextureOverrideEntry[], resources: ModResourceEntry[], commandLists: CommandListEntry[]): DrawIBGroup[] => {
  const resourceMap = new Map<string, ModResourceEntry>()
  resources.forEach(r => {
    resourceMap.set(r.sectionName, r)
    resourceMap.set(r.sectionName.toLowerCase(), r)
    if (r.canonicalName) resourceMap.set(r.canonicalName.toLowerCase(), r)
  })
  const findResource = (name: string): ModResourceEntry | undefined => resourceMap.get(name) || resourceMap.get(name.toLowerCase())
  const commandMap = new Map<string, CommandListEntry>()
  const addCommandAlias = (alias: string, commandList: CommandListEntry) => {
    const normalized = alias.trim().toLowerCase()
    if (normalized && !commandMap.has(normalized)) commandMap.set(normalized, commandList)
  }
  for (const commandList of commandLists) {
    const sectionName = commandList.sectionName.trim()
    addCommandAlias(sectionName, commandList)
    const lower = sectionName.toLowerCase()
    if (lower.startsWith('commandlist')) {
      addCommandAlias(sectionName.slice('CommandList'.length), commandList)
    }
  }
  const findCommandList = (rawName: string): CommandListEntry | undefined => {
    const normalized = rawName.trim().toLowerCase()
    if (!normalized) return undefined
    const exact = commandMap.get(normalized)
    if (exact) return exact

    const parts = normalized.split('\\').filter(Boolean)
    const lastPart = parts[parts.length - 1]
    if (!lastPart) return undefined
    return commandMap.get(lastPart) || commandMap.get(`commandlist${lastPart}`)
  }
  const isPreviewVariableCondition = (condition: string) => condition.includes('$')
  const expandBlock = (block: ConditionalBlock, parentConditions: string[] = [], seen = new Set<string>()): ConditionalBlock[] => {
    const conditions = [...parentConditions, ...block.conditions].filter(isPreviewVariableCondition)
    const expanded: ConditionalBlock[] = []
    if (block.replaces.length > 0 || block.drawCalls.length > 0) {
      expanded.push({
        conditions,
        replaces: [...block.replaces],
        drawCalls: [...block.drawCalls],
      })
    }

    for (const runName of block.runs || []) {
      const commandList = findCommandList(runName)
      if (!commandList) continue
      const seenKey = `${commandList.sourceIniPath}::${commandList.sectionName}`
      if (seen.has(seenKey)) continue
      const nextSeen = new Set(seen)
      nextSeen.add(seenKey)
      for (const commandBlock of commandList.blocks) {
        expanded.push(...expandBlock(commandBlock, conditions, nextSeen))
      }
    }

    return expanded
  }

  // Resolve CommandList references: if a TextureOverride has no ib but has run=CommandList,
  // expand the CommandList's blocks into separate TextureOverrides
  const resolvedTOs = textureOverrides.map(to => {
    const expandedBlocks = to.blocks.flatMap(block => expandBlock(block))
    if (expandedBlocks.length === 0) return to
    return {
      ...to,
      blocks: expandedBlocks,
      replaces: expandedBlocks.flatMap(block => block.replaces),
      drawCalls: expandedBlocks.flatMap(block => block.drawCalls),
    }
  })

  // Generated mods normally use different hashes for their Position/Blend/
  // Texcoord overrides and DrawIB override. Anchor each group at an explicit
  // IB binding, then attach resource overrides from the same INI.
  const groups = new Map<string, TextureOverrideEntry[]>()
  const ibAnchors = resolvedTOs.filter(to => to.replaces.some(replace => replace.slot === 'ib'))
  ibAnchors.forEach((anchor, index) => {
    const related = resolvedTOs.filter(candidate => candidate.sourceIniPath === anchor.sourceIniPath && (
      candidate === anchor || candidate.replaces.some(replace => (
        replace.slot.startsWith('vb') || /^(?:ps|vs|gs|cs)-t\d+$/i.test(replace.slot) || replace.slot === 'this'
      ))
    ))
    groups.set(`${anchor.sourceIniPath}::${anchor.hash || anchor.sectionName}::${index}`, related)
  })
  if (groups.size === 0) {
    resolvedTOs.forEach(to => {
      if (!to.hash) return
      const key = `${to.sourceIniPath}::${to.hash}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(to)
    })
  }

  const result: DrawIBGroup[] = []
  groups.forEach((tos, mapKey) => {
    const anchor = tos.find(to => to.replaces.some(replace => replace.slot === 'ib'))
    const allSectionNames = tos.map(t => t.sectionName)
    // Find IB resource
    const ibReplace = tos.flatMap(t => t.replaces).find(r => r.slot === 'ib')
    const ibRes = ibReplace ? findResource(ibReplace.resourceName) : undefined
    const normalizedResourceStem = (name: string, suffix: RegExp) => name.replace(/^resource/i, '').replace(suffix, '').toLowerCase()
    const ibStem = normalizedResourceStem(ibRes?.sectionName || ibReplace?.resourceName || '', /(?:ib|_index)$/i)
    const drawHash = anchor?.hash || ''
    const commonPrefixLength = (left: string, right: string) => {
      let index = 0
      while (index < left.length && index < right.length && left[index] === right[index]) index += 1
      return index
    }

    // Find VB resources (dedup by resourceName)
    const vbSeen = new Set<string>()
    const vbFiles: DrawIBGroup['vbFiles'] = []
    tos.flatMap(t => t.replaces).forEach(r => {
      if (r.slot.startsWith('vb') && !vbSeen.has(r.resourceName)) {
        vbSeen.add(r.resourceName)
        const res = findResource(r.resourceName)
        vbFiles.push({
          slot: r.slot,
          resourceName: r.resourceName,
          filename: res?.filename || r.resourceName,
          stride: res?.stride,
          format: res?.format,
          sourceIniPath: res?.sourceIniPath,
        })
      }
    })
    if (!vbFiles.some(vb => /position/i.test(`${vb.resourceName} ${vb.filename}`))) {
      const inferredPosition = resources
        .filter(resource => resource.sourceIniPath === anchor?.sourceIniPath && /position/i.test(resource.sectionName) && !!resource.filename)
        .sort((left, right) => {
          const leftHashScore = drawHash && `${left.sectionName} ${left.filename}`.toLowerCase().includes(drawHash.toLowerCase()) ? 1000 : 0
          const rightHashScore = drawHash && `${right.sectionName} ${right.filename}`.toLowerCase().includes(drawHash.toLowerCase()) ? 1000 : 0
          return rightHashScore + commonPrefixLength(ibStem, normalizedResourceStem(right.sectionName, /position.*$/i))
            - leftHashScore - commonPrefixLength(ibStem, normalizedResourceStem(left.sectionName, /position.*$/i))
        })[0]
      const positionMatchesHash = !!(inferredPosition && drawHash && `${inferredPosition.sectionName} ${inferredPosition.filename}`.toLowerCase().includes(drawHash.toLowerCase()))
      if (inferredPosition && (positionMatchesHash || commonPrefixLength(ibStem, normalizedResourceStem(inferredPosition.sectionName, /position.*$/i)) >= 4)) {
        vbFiles.unshift({
          slot: 'vb0',
          resourceName: inferredPosition.sectionName,
          filename: inferredPosition.filename,
          stride: inferredPosition.stride,
          format: inferredPosition.format,
          sourceIniPath: inferredPosition.sourceIniPath,
        })
      }
    }

    // Find texture resources
    const texSeen = new Set<string>()
    const textureFiles: DrawIBGroup['textureFiles'] = []
    tos.forEach(textureOverride => textureOverride.replaces.forEach(r => {
      const shaderSlot = r.slot.startsWith('ps-t') || r.slot.startsWith('vs-t') || r.slot.startsWith('gs-t') || r.slot.startsWith('cs-t')
      const namedTexture = r.slot === 'this' && /diffuse|albedo|base.?color|normal|light.?map|ilm|texture/i.test(textureOverride.sectionName)
      if ((shaderSlot || namedTexture) && !texSeen.has(r.resourceName)) {
        texSeen.add(r.resourceName)
        const res = findResource(r.resourceName)
        textureFiles.push({
          slot: r.slot === 'this' ? `hash:${textureOverride.hash || '?'}` : r.slot,
          resourceName: r.resourceName,
          filename: res?.filename || r.resourceName,
          sourceIniPath: res?.sourceIniPath,
          sourceLabel: textureOverride.sectionName,
        })
      }
    }))
    result.push({
      groupKey: mapKey,
      drawHash,
      matchFirstIndex: anchor?.matchFirstIndex,
      sectionNames: allSectionNames,
      ibFile: ibRes?.filename || ibReplace?.resourceName || '',
      ibFormat: ibRes?.format || '',
      ibSourceIniPath: ibRes?.sourceIniPath,
      vbFiles,
      textureFiles,
      allBlocks: tos.flatMap(t => t.blocks),
    })
  })

  return result
}

const parseIniContent = (content: string, sourceIni: string, sourceIniPath: string) => {
  const modKeyList: ModKeyInfo[] = []
  const constantBindings: ModKeyConstantBinding[] = []
  const excludedPreviewFileNames = new Set<string>()
  const resources: ModResourceEntry[] = []
  const textureOverrides: TextureOverrideEntry[] = []
  const commandLists: CommandListEntry[] = []
  const sections = parseIniSections(content)
  const firstSectionOffset = content.search(/^\s*\[/m)
  const preamble = firstSectionOffset >= 0 ? content.slice(0, firstSectionOffset) : content
  const declaredNamespace = preamble.split(/\r?\n/).map(line => parseAssignment(stripInlineComment(line.trim())))
    .find(item => item?.key.toLowerCase() === 'namespace')?.value.trim()
  // 3DMigoto gives recursively loaded INIs a path namespace unless the INI
  // explicitly replaces it with `namespace = ...` in its preamble.
  const namespace = declaredNamespace ?? sourceIniPath.replace(/\//g, '\\')

  sections.forEach((section, sectionOrder) => {
    if (section.sectionNameLower === 'constants') {
      constantBindings.push(...parseConstantsSection(section, sourceIni, sourceIniPath))
      return
    }

    if (section.sectionNameLower.startsWith('resource')) {
      const res = parseResourceSection(section, sourceIni, sourceIniPath, namespace, sectionOrder)
      resources.push(res)
      if (res.filename) {
        const fileNameLower = getLowerFileName(res.filename)
        if (fileNameLower) excludedPreviewFileNames.add(fileNameLower)
      }
      return
    }

    if (section.sectionNameLower.startsWith('textureoverride')) {
      textureOverrides.push(parseTextureOverrideSection(section, sourceIni, sourceIniPath, namespace, sectionOrder))
      return
    }

    if (section.sectionNameLower.startsWith('commandlist') || section.sectionNameLower.startsWith('customshader')) {
      commandLists.push(parseCommandListSection(section, sourceIni, sourceIniPath, namespace, sectionOrder))
      return
    }

    if (!section.sectionNameLower.startsWith('key')) {
      return
    }

    const keyItem = parseKeySection(section, sourceIni, sourceIniPath)
    if (keyItem) {
      modKeyList.push(keyItem)
    }
  })

  modKeyList.sort((left, right) => left.sourceIni.localeCompare(right.sourceIni, undefined, { sensitivity: 'base' })
    || left.sectionIndex - right.sectionIndex
    || left.sectionName.localeCompare(right.sectionName, undefined, { sensitivity: 'base' }))

  return {
    modKeyList,
    constantBindings,
    resources,
    textureOverrides,
    commandLists,
    excludedPreviewFileNames: Array.from(excludedPreviewFileNames).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
  } satisfies ParsedIniContent & { resources: ModResourceEntry[]; textureOverrides: TextureOverrideEntry[]; commandLists: CommandListEntry[] }
}

const collectIniFilesRecursive = async (path: string, output: string[]) => {
  let entries: Array<{ name?: string; isDirectory?: boolean }> = []

  try {
    entries = await readDir(path)
  } catch {
    return
  }

  for (const entry of entries) {
    const entryName = entry?.name || ''
    if (!entryName) continue

    const fullPath = joinPath(path, entryName)
    if (entry.isDirectory) {
      if (entryName.startsWith('.') || entryName.startsWith('$') || isDisabledIniEntryName(entryName)) {
        continue
      }
      await collectIniFilesRecursive(fullPath, output)
      continue
    }

    if (entryName.toLowerCase().endsWith('.ini') && !isDisabledIniEntryName(entryName)) {
      output.push(fullPath)
    }
  }
}

/** Full analysis: parses all INI files in a mod directory, returning keys + resources */
export const analyzeModIniFilesFull = async (modPath: string): Promise<ModIniFullAnalysis> => {
  const iniFiles: string[] = []
  await collectIniFilesRecursive(modPath, iniFiles)
  iniFiles.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  const allModKeyList: ModKeyInfo[] = []
  const allResources: ModResourceEntry[] = []
  const allTextureOverrides: TextureOverrideEntry[] = []
  const allCommandLists: CommandListEntry[] = []
  const excludedPreviewFileNames = new Set<string>()
  const allConstantBindings: ModKeyConstantBinding[] = []

  for (const iniFile of iniFiles) {
    const content = await readTextFile(iniFile)
    const sourceIni = getFileName(iniFile) || iniFile
    const sourceIniPath = getRelativePath(modPath, iniFile)
    const parsed = parseIniContent(content, sourceIni, sourceIniPath)
    allModKeyList.push(...parsed.modKeyList)
    allConstantBindings.push(...parsed.constantBindings)
    allResources.push(...parsed.resources)
    allTextureOverrides.push(...parsed.textureOverrides)
    allCommandLists.push(...parsed.commandLists)
    parsed.excludedPreviewFileNames.forEach((fileName) => excludedPreviewFileNames.add(fileName))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  attachConstantBindingsToModKeys(allModKeyList, allConstantBindings)

  allModKeyList.sort((left, right) => left.sourceIni.localeCompare(right.sourceIni, undefined, { sensitivity: 'base' })
    || left.sectionIndex - right.sectionIndex
    || left.sectionName.localeCompare(right.sectionName, undefined, { sensitivity: 'base' }))

  const filteredResources = await filterMissingResourceFiles(modPath, allResources)

  return {
    modKeyList: allModKeyList,
    constantBindings: allConstantBindings,
    resources: filteredResources,
    textureOverrides: allTextureOverrides,
    commandLists: allCommandLists,
    excludedPreviewFileNames: Array.from(excludedPreviewFileNames)
      .filter((fileName) => isImageFileName(fileName))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
  }
}

const analyzeModIniFiles = async (modPath: string): Promise<MigotoIniAnalysisResult> => {
  const iniFiles: string[] = []
  await collectIniFilesRecursive(modPath, iniFiles)
  iniFiles.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  const mergedResult = createEmptyResult()
  const excludedPreviewFileNames = new Set<string>()
  const constantBindings: ModKeyConstantBinding[] = []

  for (const iniFile of iniFiles) {
    const content = await readTextFile(iniFile)
    const sourceIni = getFileName(iniFile) || iniFile
    const sourceIniPath = getRelativePath(modPath, iniFile)
    const parsed = parseIniContent(content, sourceIni, sourceIniPath)
    mergedResult.modKeyList.push(...parsed.modKeyList)
    constantBindings.push(...parsed.constantBindings)
    parsed.excludedPreviewFileNames.forEach((fileName) => excludedPreviewFileNames.add(fileName))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  attachConstantBindingsToModKeys(mergedResult.modKeyList, constantBindings)

  mergedResult.modKeyList.sort((left, right) => left.sourceIni.localeCompare(right.sourceIni, undefined, { sensitivity: 'base' })
    || left.sectionIndex - right.sectionIndex
    || left.sectionName.localeCompare(right.sectionName, undefined, { sensitivity: 'base' }))

  mergedResult.excludedPreviewFileNames = Array.from(excludedPreviewFileNames)
    .filter((fileName) => isImageFileName(fileName))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))

  return mergedResult
}

const normalizeCycleValues = (values: string[]) => values
  .map((value) => value.trim())
  .filter(Boolean)

const collectConstantBindingsByFile = (items: ModKeyInfo[]) => {
  const bindingsByFile = new Map<string, Map<string, ModKeyConstantBinding>>()

  items.forEach((item) => {
    ;[...item.activeValues, ...item.cycleValues].forEach((entry) => {
      const variableName = entry.name.trim()
      if (!variableName.startsWith('$')) return

      const binding = entry.constantBinding
      const sourceIniPath = (binding.declarationSourceIniPath || item.sourceIniPath).trim() || item.sourceIniPath
      const initialValue = binding.initialValue.trim()
      if (!initialValue && binding.createdByEditor) {
        return
      }
      if (!initialValue) {
        throw new Error(`Variable ${variableName} in [${item.sectionName}] must define an initial value in [Constants]`)
      }

      const normalizedBinding: ModKeyConstantBinding = {
        ...cloneConstantBinding(binding),
        bindingKey: buildConstantBindingKey(sourceIniPath, variableName),
        name: variableName,
        initialValue,
        declarationSourceIni: binding.declarationSourceIni || item.sourceIni,
        declarationSourceIniPath: sourceIniPath,
        declarationSectionName: binding.declarationSectionName || 'Constants',
        declarationModifiers: binding.declarationModifiers.length ? [...binding.declarationModifiers] : ['global'],
        createdByEditor: binding.createdByEditor,
      }

      const fileBindings = bindingsByFile.get(sourceIniPath) || new Map<string, ModKeyConstantBinding>()
      fileBindings.set(variableName.toLowerCase(), normalizedBinding)
      bindingsByFile.set(sourceIniPath, fileBindings)
    })
  })

  return bindingsByFile
}

const buildConstantsSectionBodyLines = (section: IniSectionRange, bindings: ModKeyConstantBinding[]) => {
  const bindingMap = new Map(bindings.map((binding) => [binding.name.toLowerCase(), binding]))
  const handled = new Set<string>()
  const bodyLines: string[] = []

  section.bodyLines.forEach((rawLine) => {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      bodyLines.push(rawLine)
      return
    }

    const assignment = parseAssignment(trimmed)
    if (!assignment) {
      bodyLines.push(rawLine)
      return
    }

    const declaration = parseConstantDeclarationKey(assignment.key)
    if (!declaration) {
      bodyLines.push(rawLine)
      return
    }

    const binding = bindingMap.get(declaration.name.toLowerCase())
    if (!binding) {
      bodyLines.push(rawLine)
      return
    }

    handled.add(declaration.name.toLowerCase())
    bodyLines.push(buildConstantDeclarationLine({
      ...binding,
      declarationModifiers: binding.declarationModifiers.length ? binding.declarationModifiers : declaration.modifiers,
    }))
  })

  const missingBindings = bindings.filter((binding) => !handled.has(binding.name.toLowerCase()))
  if (missingBindings.length > 0 && bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim()) {
    bodyLines.push('')
  }

  missingBindings.forEach((binding) => {
    bodyLines.push(buildConstantDeclarationLine(binding))
  })

  return bodyLines
}

const buildKeySectionBodyLines = (item: ModKeyInfo) => {
  const bodyLines: string[] = []

  item.keys
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      bodyLines.push(`Key = ${value}`)
    })

  item.backs
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      bodyLines.push(`Back = ${value}`)
    })

  if (item.keyType.trim()) {
    bodyLines.push(`type = ${item.keyType.trim()}`)
  }

  if (item.conditionSummary.trim()) {
    bodyLines.push(`condition = ${item.conditionSummary.trim()}`)
  }

  item.extraProperties.forEach((entry) => {
    const key = entry.key.trim()
    if (!key) return
    bodyLines.push(`${key} = ${entry.value.trim()}`)
  })

  item.activeValues.forEach((entry) => {
    const name = entry.name.trim()
    if (!name) return
    bodyLines.push(`${name} = ${entry.value.trim()}`)
  })

  item.cycleValues.forEach((entry) => {
    const name = entry.name.trim()
    if (!name) return
    const values = normalizeCycleValues(entry.values)
    bodyLines.push(`${name} = ${values.join(', ')}`)
  })

  return bodyLines
}

const validateModKeyItem = (item: ModKeyInfo) => {
  if (!item.sectionName.trim()) {
    throw new Error('Missing key section name')
  }

  const keys = item.keys.map((value) => value.trim()).filter(Boolean)
  if (keys.length === 0) {
    throw new Error(`Section [${item.sectionName}] must contain at least one Key entry`)
  }
  for (const key of [...keys, ...item.backs.map((value) => value.trim()).filter(Boolean)]) {
    const error = validateMigotoKeyBinding(key)
    if (error) throw new Error(`${error} in [${item.sectionName}]`)
  }

  const keyTypeLower = item.keyType.trim().toLowerCase()
  if (keyTypeLower && !KNOWN_KEY_TYPES.has(keyTypeLower)) {
    throw new Error(`Unsupported key type: ${item.keyType}`)
  }

  const extraPropertyNames = item.extraProperties.map((entry) => entry.key.trim().toLowerCase())
  if (keyTypeLower !== 'cycle' && extraPropertyNames.some((name) => CYCLE_ONLY_PROPERTIES.has(name))) {
    throw new Error(`Cycle-only properties require type = cycle in [${item.sectionName}]`)
  }

  if (keyTypeLower !== 'hold' && extraPropertyNames.some((name) => HOLD_ONLY_PROPERTIES.has(name))) {
    throw new Error(`Hold-only delay properties require type = hold in [${item.sectionName}]`)
  }

  item.activeValues.forEach((entry) => {
    if (!entry.name.trim().startsWith('$')) {
      throw new Error(`Variable names must start with $ in [${item.sectionName}]`)
    }
  })

  item.cycleValues.forEach((entry) => {
    if (!entry.name.trim().startsWith('$')) {
      throw new Error(`Variable names must start with $ in [${item.sectionName}]`)
    }
    const values = normalizeCycleValues(entry.values)
    if (values.length === 0) {
      throw new Error(`Cycle variable ${entry.name} must contain at least one value in [${item.sectionName}]`)
    }
  })
}

const saveModIniFiles = async (modPath: string, items: ModKeyInfo[]) => {
  const itemsByFile = new Map<string, ModKeyInfo[]>()
  const constantBindingsByFile = collectConstantBindingsByFile(items)
  items.forEach((item) => {
    validateModKeyItem(item)
    const list = itemsByFile.get(item.sourceIniPath) || []
    list.push(item)
    itemsByFile.set(item.sourceIniPath, list)
  })

  const targetFiles = new Set<string>([
    ...itemsByFile.keys(),
    ...constantBindingsByFile.keys(),
  ])

  for (const sourceIniPath of targetFiles) {
    const fileItems = itemsByFile.get(sourceIniPath) || []
    const fullPath = joinPath(modPath, sourceIniPath)
    const originalContent = await readTextFile(fullPath)
    const lineEnding = inferLineEnding(originalContent)
    const hadTrailingNewline = /\r?\n$/.test(originalContent)
    const lines = originalContent.split(/\r?\n/)
    const sections = parseIniSections(originalContent)
    const replacements = fileItems
      .map((item) => {
        const target = sections.find((section) => section.keySectionIndex === item.sectionIndex)
        if (!target) {
          throw new Error(`Unable to locate section [${item.sectionName}] in ${sourceIniPath}`)
        }
        if (target.sectionName.toLowerCase() !== item.sectionName.toLowerCase()) {
          throw new Error(`Section mismatch while saving ${item.sectionName} in ${sourceIniPath}`)
        }
        return { target, bodyLines: buildKeySectionBodyLines(item) }
      })
    const constantBindings = Array.from(constantBindingsByFile.get(sourceIniPath)?.values() || [])
    const constantsSection = sections.find((section) => section.sectionNameLower === 'constants')

    if (constantsSection && constantBindings.length > 0) {
      replacements.push({
        target: constantsSection,
        bodyLines: buildConstantsSectionBodyLines(constantsSection, constantBindings),
      })
    }

    replacements.sort((left, right) => right.target.startLine - left.target.startLine)

    replacements.forEach(({ target, bodyLines }) => {
      lines.splice(target.startLine + 1, target.endLine - target.startLine, ...bodyLines)
    })

    if (!constantsSection && constantBindings.length > 0) {
      if (lines.length > 0 && lines[lines.length - 1].trim()) {
        lines.push('')
      }
      lines.push('[Constants]')
      constantBindings.forEach((binding) => {
        lines.push(buildConstantDeclarationLine(binding))
      })
    }

    const nextContent = `${lines.join(lineEnding)}${hadTrailingNewline ? lineEnding : ''}`
    await writeFile(fullPath, new TextEncoder().encode(nextContent))
  }
}

class MigotoIniService {
  private readonly cache = new Map<string, MigotoIniAnalysisEntry>()
  private readonly queue: string[] = []
  private readonly gameGenerations = new Map<string, number>()
  private runningCount = 0
  // Allow more parallel INI analysis to keep the pipeline full without blocking the UI.
  // Capped at 4 to avoid saturating the filesystem / IPC layer.
  private readonly concurrency = Math.min(4, (typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4))

  private notify(entry: MigotoIniAnalysisEntry) {
    const snapshot: MigotoIniAnalysisSnapshot = {
      status: entry.status,
      result: entry.result,
      error: entry.error,
    }
    entry.listeners.forEach((listener) => listener(snapshot))
  }

  private getGeneration(gameName: string) {
    return this.gameGenerations.get(gameName) || 0
  }

  private ensureEntry(gameName: string, modRelativePath: string, modPath = '') {
    const cacheKey = getCacheKey(gameName, modRelativePath)
    let entry = this.cache.get(cacheKey)
    if (!entry) {
      entry = {
        gameName,
        modRelativePath,
        modPath,
        status: 'idle',
        queued: false,
        listeners: new Set(),
      }
      this.cache.set(cacheKey, entry)
    } else if (modPath) {
      entry.modPath = modPath
    }
    return entry
  }

  private dequeue(cacheKey: string) {
    const index = this.queue.indexOf(cacheKey)
    if (index !== -1) {
      this.queue.splice(index, 1)
    }
  }

  private async processQueue() {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const cacheKey = this.queue.shift()
      if (!cacheKey) return

      const entry = this.cache.get(cacheKey)
      if (!entry || !entry.modPath) {
        continue
      }

      entry.queued = false
      entry.status = 'loading'
      entry.error = undefined
      this.notify(entry)

      const generation = this.getGeneration(entry.gameName)
      this.runningCount += 1

      try {
        const result = await analyzeModIniFiles(entry.modPath)
        if (generation !== this.getGeneration(entry.gameName)) {
          continue
        }

        const currentEntry = this.cache.get(cacheKey)
        if (!currentEntry) continue
        currentEntry.status = 'ready'
        currentEntry.result = result
        currentEntry.error = undefined
        this.notify(currentEntry)
      } catch (error) {
        if (generation !== this.getGeneration(entry.gameName)) {
          continue
        }

        const currentEntry = this.cache.get(cacheKey)
        if (!currentEntry) continue
        currentEntry.status = 'error'
        currentEntry.result = undefined
        currentEntry.error = String(error)
        this.notify(currentEntry)
      } finally {
        this.runningCount = Math.max(0, this.runningCount - 1)
      }
    }
  }

  public subscribe(gameName: string, modRelativePath: string, listener: (snapshot: MigotoIniAnalysisSnapshot) => void) {
    const entry = this.ensureEntry(gameName, modRelativePath)
    entry.listeners.add(listener)
    listener({
      status: entry.status,
      result: entry.result,
      error: entry.error,
    })

    return () => {
      entry.listeners.delete(listener)
    }
  }

  public getSnapshot(gameName: string, modRelativePath: string): MigotoIniAnalysisSnapshot {
    const entry = this.cache.get(getCacheKey(gameName, modRelativePath))
    if (!entry) {
      return { status: 'idle' }
    }

    return {
      status: entry.status,
      result: entry.result,
      error: entry.error,
    }
  }

  public ensureQueued(gameName: string, mod: Pick<ModInfo, 'relativePath' | 'path'>) {
    const entry = this.ensureEntry(gameName, mod.relativePath, mod.path)
    if (entry.status === 'ready' || entry.status === 'loading' || entry.queued) {
      return
    }

    entry.queued = true
    this.dequeue(getCacheKey(gameName, mod.relativePath))
    this.queue.push(getCacheKey(gameName, mod.relativePath))
    void this.processQueue()
  }

  public async load(gameName: string, mod: Pick<ModInfo, 'relativePath' | 'path'>): Promise<MigotoIniAnalysisResult> {
    const snapshot = this.getSnapshot(gameName, mod.relativePath)
    if (snapshot.status === 'ready' && snapshot.result) {
      return snapshot.result
    }

    this.ensureQueued(gameName, mod)

    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe(gameName, mod.relativePath, (nextSnapshot) => {
        if (nextSnapshot.status === 'ready' && nextSnapshot.result) {
          unsubscribe()
          resolve(nextSnapshot.result)
        } else if (nextSnapshot.status === 'error') {
          unsubscribe()
          reject(nextSnapshot.error || 'Migoto ini analysis failed')
        }
      })
    })
  }

  public prefetch(gameName: string, mods: Array<Pick<ModInfo, 'relativePath' | 'path'>>) {
    mods.forEach((mod) => this.ensureQueued(gameName, mod))
  }

  public invalidate(gameName: string, modRelativePath: string) {
    const cacheKey = getCacheKey(gameName, modRelativePath)
    this.cache.delete(cacheKey)
    this.dequeue(cacheKey)
  }

  public clearGame(gameName: string) {
    this.gameGenerations.set(gameName, this.getGeneration(gameName) + 1)

    Array.from(this.cache.keys()).forEach((cacheKey) => {
      if (cacheKey.startsWith(`${gameName}:`)) {
        this.cache.delete(cacheKey)
      }
    })

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].startsWith(`${gameName}:`)) {
        this.queue.splice(index, 1)
      }
    }
  }

  public async saveModKeys(gameName: string, mod: Pick<ModInfo, 'relativePath' | 'path'>, items: ModKeyInfo[]) {
    const entry = this.ensureEntry(gameName, mod.relativePath, mod.path)
    entry.status = 'loading'
    entry.error = undefined
    this.notify(entry)

    try {
      await saveModIniFiles(mod.path, items.map(cloneModKeyInfo))
      const result = await analyzeModIniFiles(mod.path)
      entry.status = 'ready'
      entry.result = result
      entry.error = undefined
      this.notify(entry)
      return result
    } catch (error) {
      entry.status = 'error'
      entry.error = String(error)
      this.notify(entry)
      throw error
    }
  }
}

export const migotoIniService = new MigotoIniService()
