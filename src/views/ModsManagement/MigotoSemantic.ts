import { evalConditionExpression, type CommandListEntry, type ModIniFullAnalysis, type ModResourceEntry, type TextureOverrideEntry } from './MigotoIni'

export interface MigotoDrawSnapshot {
  id: string
  label: string
  sourceIniPath: string
  hash: string
  matchFirstIndex?: number
  indexCount: number
  startIndex: number
  baseVertex: number
  ib?: ModResourceEntry
  bindings: Record<string, ModResourceEntry | undefined>
  vertexCandidates: Record<string, ModResourceEntry[]>
  semanticTextures: Partial<Record<'diffuse' | 'normal' | 'light', ModResourceEntry>>
  hashTextures: MigotoHashTextureBinding[]
}

export interface MigotoHashTextureBinding {
  hash: string
  overrideSectionName: string
  resource: ModResourceEntry
}

interface ExecutionState {
  bindings: Map<string, ModResourceEntry | undefined>
  custom: Map<string, ModResourceEntry | undefined>
}

const clean = (line: string) => {
  let quote = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if ((ch === '"' || ch === "'") && line[i - 1] !== '\\') quote = quote === ch ? '' : quote || ch
    if (!quote && (ch === ';' || ch === '#')) return line.slice(0, i).trim()
  }
  return line.trim()
}

const assignment = (line: string) => {
  const at = line.indexOf('=')
  return at < 0 ? undefined : { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }
}

const normalizeKey = (key: string) => key.replace(/^(?:(?:pre|post)\s+)+/i, '').trim().toLowerCase()
const isBinding = (key: string) => key === 'ib' || key === 'this' || /^vb\d+$/.test(key) || /^(?:vs|ps|gs|hs|ds|cs)-(?:t|u|cb)\d+$/.test(key)
const sourceName = (value: string) => value.replace(/^(?:ref|copy)\s+/i, '').replace(/\s+(?:unless_null|raw|stereo|mono|resolve_msaa).*$/i, '').trim()

const namespaced = (name: string, namespace: string) => {
  const match = name.match(/^(Resource|CommandList|CustomShader|TextureOverride)(.*)$/i)
  if (!match || !namespace || name.includes('\\')) return name.toLowerCase()
  return `${match[1]}\\${namespace}\\${match[2]}`.toLowerCase()
}

export const buildMigotoDrawSnapshots = (analysis: ModIniFullAnalysis, variables: Record<string, string>): MigotoDrawSnapshot[] => {
  const resources = new Map<string, ModResourceEntry>()
  for (const resource of analysis.resources) {
    resources.set(resource.sectionName.toLowerCase(), resource)
    if (resource.canonicalName) resources.set(resource.canonicalName.toLowerCase(), resource)
  }
  const resolveResource = (raw: string, namespace: string) => resources.get(namespaced(raw, namespace)) || resources.get(raw.toLowerCase())

  const commands = new Map<string, CommandListEntry>()
  for (const command of analysis.commandLists) {
    commands.set(command.sectionName.toLowerCase(), command)
    commands.set(namespaced(command.sectionName, command.namespace), command)
  }
  const resolveCommand = (raw: string, namespace: string) => {
    const normalized = raw.replace(/^commandlist/i, 'CommandList')
    return commands.get(namespaced(normalized, namespace)) || commands.get(normalized.toLowerCase())
  }

  // TextureOverrides are callbacks on resource binding. Their declaration
  // order is not runtime order, so keep every semantically valid VB binding as
  // a candidate instead of inventing an association from section names.
  const vertexCandidates: Record<string, ModResourceEntry[]> = {}
  const globalHashTextures: MigotoHashTextureBinding[] = []
  const conditionCanBeTrue = (condition: string) => {
    // DRAW_TYPE, shader/resource operands and caller draw fields are supplied
    // by 3DMigoto at runtime. Static preview must retain those branches as
    // possible states instead of evaluating the absent operand as zero.
    if (/\b(?:draw_type|first_index|index_count|vertex_count|instance_count)\b|\b(?:ps|vs|cs|gs|hs|ds)-[tucb]\d+\b|\bvb\d+(?:->\w+)?\b/i.test(condition)) return true
    return evalConditionExpression(condition, variables)
  }
  for (const override of analysis.textureOverrides) {
    for (const block of override.blocks) {
      if (!block.conditions.every(conditionCanBeTrue)) continue
      for (const replace of block.replaces) {
        const resource = resolveResource(replace.resourceName, override.namespace)
        if (/^vb\d+$/i.test(replace.slot) && resource && !(vertexCandidates[replace.slot.toLowerCase()] || []).includes(resource)) {
          ;(vertexCandidates[replace.slot.toLowerCase()] ||= []).push(resource)
        }
        if (replace.slot.toLowerCase() === 'this' && resource?.filename && !globalHashTextures.some(binding => (
          binding.hash === override.hash && binding.resource === resource
        ))) {
          globalHashTextures.push({ hash: override.hash, overrideSectionName: override.sectionName, resource })
        }
      }
    }
  }

  const snapshots: MigotoDrawSnapshot[] = []
  const appendSnapshot = (
    owner: TextureOverrideEntry,
    state: ExecutionState,
    indexCount: number,
    startIndex = 0,
    baseVertex = 0,
  ) => {
    // A large mod collection can contain thousands of unrelated replacement
    // VBs.  TextureOverride callbacks only see resources in their own INI
    // namespace (unless an explicit namespaced reference is used, in which
    // case it is already present in `state.bindings`).  Returning the global
    // candidate table made every draw in packs such as "GI All Girl Mod" try
    // to load virtually every character buffer.
    const localVertexCandidates = Object.fromEntries(Object.entries(vertexCandidates).map(([slot, candidates]) => [
      slot,
      candidates.filter(resource => owner.namespace
        ? resource.namespace === owner.namespace
        : resource.sourceIniPath === owner.sourceIniPath),
    ]).filter(([, candidates]) => candidates.length))
    const semantic = (...names: string[]) => names.flatMap(name => [
      state.custom.get(`resource\\gimi\\${name}`),
      state.custom.get(`resource\\srmi\\${name}`),
      state.custom.get(`resource\\zzmi\\${name}`),
    ]).find(Boolean)
    snapshots.push({
      id: `${owner.sourceIniPath}:${owner.sectionName}:${snapshots.length}`,
      label: owner.sectionName,
      sourceIniPath: owner.sourceIniPath,
      hash: owner.hash,
      matchFirstIndex: Number.isFinite(Number(owner.matchFirstIndex)) ? Number(owner.matchFirstIndex) : undefined,
      indexCount, startIndex, baseVertex,
      ib: state.bindings.get('ib'), bindings: Object.fromEntries(state.bindings), vertexCandidates: localVertexCandidates,
      semanticTextures: {
        diffuse: semantic('diffuse', 'diffusemap'),
        normal: semantic('normalmap', 'normal'),
        light: semantic('lightmap', 'light'),
      },
      hashTextures: globalHashTextures,
    })
  }
  const execute = (lines: string[], namespace: string, state: ExecutionState, owner: TextureOverrideEntry, callStack: Set<string>) => {
    const frames: Array<{ parent: boolean; matched: boolean; active: boolean }> = []
    let active = true
    const refresh = () => { active = frames.every(frame => frame.active) }
    for (const raw of lines) {
      const line = clean(raw)
      if (!line) continue
      const lower = line.toLowerCase()
      if (lower.startsWith('if ')) {
        const parent = active
        const match = parent && evalConditionExpression(line.slice(3), variables)
        frames.push({ parent, matched: match, active: match }); refresh(); continue
      }
      if (lower.startsWith('elif ') || lower.startsWith('else if ')) {
        const frame = frames[frames.length - 1]; if (!frame) continue
        const expr = line.slice(lower.startsWith('elif ') ? 5 : 8)
        const match = frame.parent && !frame.matched && evalConditionExpression(expr, variables)
        frame.active = match; frame.matched ||= match; refresh(); continue
      }
      if (lower === 'else') {
        const frame = frames[frames.length - 1]; if (!frame) continue
        frame.active = frame.parent && !frame.matched; frame.matched = true; refresh(); continue
      }
      if (lower === 'endif') { frames.pop(); refresh(); continue }
      if (!active) continue
      const item = assignment(line); if (!item) continue
      const key = normalizeKey(item.key)
      if (key === 'run') {
        const command = resolveCommand(sourceName(item.value), namespace)
        const commandId = command ? `${command.sourceIniPath}:${command.sectionName}`.toLowerCase() : ''
        if (command && !callStack.has(commandId)) {
          callStack.add(commandId); execute(command.bodyLines, command.namespace, state, owner, callStack); callStack.delete(commandId)
        }
        continue
      }
      if (/^drawindexed$/.test(key)) {
        if (/^from_caller$/i.test(item.value)) { appendSnapshot(owner, state, -1); continue }
        const args = /^auto$/i.test(item.value) ? [-1, 0, 0] : item.value.split(',').map(value => Number(value.trim()))
        if (!Number.isFinite(args[0])) continue
        appendSnapshot(owner, state, args[0], args[1] || 0, args[2] || 0)
        continue
      }
      if (!isBinding(key) && !key.startsWith('resource')) continue
      const src = sourceName(item.value)
      const sourceKey = normalizeKey(src)
      const resource = /^(?:null|none)$/i.test(src)
        ? undefined
        : resolveResource(src, namespace) || state.custom.get(src.toLowerCase()) || state.bindings.get(sourceKey)
      if (key.startsWith('resource')) state.custom.set(key, resource)
      else state.bindings.set(key, resource)
    }
  }

  for (const override of analysis.textureOverrides) {
    const state: ExecutionState = { bindings: new Map(), custom: new Map() }
    const before = snapshots.length
    execute(override.bodyLines, override.namespace, state, override, new Set())
    // A TextureOverride is a callback around the original API call. Unless it
    // explicitly skips handling, replacing the IB/textures and then reaching
    // the end of the section means the caller's DrawIndexed still executes.
    // Its numeric arguments are runtime state; -1 deliberately means "use the
    // complete replacement IB" in the offline preview instead of inventing a
    // range that the INI does not contain.
    if (snapshots.length === before && state.bindings.get('ib')?.filename && !/^skip$/i.test(override.handling.trim())) {
      appendSnapshot(override, state, -1)
    }
  }
  return snapshots.filter(snapshot => snapshot.ib?.filename)
}
