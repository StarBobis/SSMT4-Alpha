import { fetch } from '@tauri-apps/plugin-http'
import type { XianZunAnthropicAuth } from './XianZunProviders'
import { xianZunEndpoint } from './XianZunApi'

export interface XianZunApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface XianZunNativeToolCall {
  id: string
  name: string
  arguments: string
  index: number
}

export interface XianZunStreamUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
}

export interface XianZunStreamResult {
  content: string
  reasoning: string
  toolCalls: XianZunNativeToolCall[]
  usage: XianZunStreamUsage | null
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] }

const toAnthropicMessages = (messages: XianZunApiMessage[]): { system: string; messages: AnthropicMessage[] } => {
  const system: string[] = []
  const converted: AnthropicMessage[] = []
  const push = (role: 'user' | 'assistant', block: AnthropicBlock) => {
    const previous = converted[converted.length - 1]
    if (previous?.role === role) previous.content.push(block)
    else converted.push({ role, content: [block] })
  }

  for (const message of messages) {
    if (message.role === 'system') system.push(message.content)
    else if (message.role === 'assistant') push('assistant', { type: 'text', text: message.content || ' ' })
    else push('user', { type: 'text', text: message.content })
  }
  while (converted[0]?.role === 'assistant') converted.shift()
  return { system: system.join('\n\n'), messages: converted }
}

const headersFor = (apiKey: string, auth: XianZunAnthropicAuth): Record<string, string> => ({
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
  ...(auth === 'x-api-key' ? { 'x-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
})

const anthropicEndpoint = (baseUrl: string, resource: 'messages' | 'models'): string => {
  return xianZunEndpoint(baseUrl, resource, 'anthropic')
}

export const streamXianZunAnthropic = async (options: {
  baseUrl: string
  apiKey: string
  model: string
  auth: XianZunAnthropicAuth
  messages: XianZunApiMessage[]
  signal: AbortSignal
  temperature: number
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
  onChunk: (chunk: { content?: string; reasoning?: string; toolCall?: { index: number; name?: string; argumentsDelta?: string } }) => void
}): Promise<XianZunStreamResult> => {
  const converted = toAnthropicMessages(options.messages)
  const body: Record<string, unknown> = {
    model: options.model,
    messages: converted.messages,
    stream: true,
    max_tokens: 8192,
    temperature: Math.max(0, Math.min(1, options.temperature)),
  }
  if (converted.system) body.system = converted.system
  if (options.tools?.length) {
    body.tools = options.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }))
  }

  const response = await fetch(anthropicEndpoint(options.baseUrl, 'messages'), {
    method: 'POST',
    headers: headersFor(options.apiKey, options.auth),
    body: JSON.stringify(body),
    signal: options.signal,
    connectTimeout: 60000,
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Claude API HTTP ${response.status}${detail ? ` - ${detail}` : ''}`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Claude API 未返回流式响应')

  const decoder = new TextDecoder()
  const blockKinds = new Map<number, { kind: string; toolIndex: number }>()
  const toolCalls: XianZunNativeToolCall[] = []
  let buffer = ''
  let content = ''
  let reasoning = ''
  let promptTokens = 0
  let completionTokens = 0
  let cacheHitTokens = 0
  let cacheMissTokens = 0
  let toolIndex = 0

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload) return
    try {
      const event = JSON.parse(payload) as {
        type?: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
        message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
        usage?: { output_tokens?: number }
        error?: { message?: string }
      }
      if (event.type === 'error') throw new Error(event.error?.message || 'Claude stream error')
      if (event.type === 'message_start') {
        promptTokens = event.message?.usage?.input_tokens ?? 0
        cacheHitTokens = event.message?.usage?.cache_read_input_tokens ?? 0
        cacheMissTokens = event.message?.usage?.cache_creation_input_tokens ?? 0
      } else if (event.type === 'message_delta') {
        completionTokens = event.usage?.output_tokens ?? completionTokens
      } else if (event.type === 'content_block_start' && event.index !== undefined) {
        const kind = event.content_block?.type || 'text'
        const currentToolIndex = kind === 'tool_use' ? toolIndex++ : -1
        blockKinds.set(event.index, { kind, toolIndex: currentToolIndex })
        if (kind === 'tool_use') {
          toolCalls[currentToolIndex] = {
            id: event.content_block?.id || `tool-${currentToolIndex}`,
            name: event.content_block?.name || '',
            arguments: '',
            index: currentToolIndex,
          }
          options.onChunk({ toolCall: { index: currentToolIndex, name: event.content_block?.name || '' } })
        }
      } else if (event.type === 'content_block_delta' && event.index !== undefined) {
        const block = blockKinds.get(event.index)
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          content += event.delta.text
          options.onChunk({ content: event.delta.text })
        } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          reasoning += event.delta.thinking
          options.onChunk({ reasoning: event.delta.thinking })
        } else if (event.delta?.type === 'input_json_delta' && block?.toolIndex !== undefined && block.toolIndex >= 0) {
          const delta = event.delta.partial_json || ''
          toolCalls[block.toolIndex].arguments += delta
          options.onChunk({ toolCall: { index: block.toolIndex, argumentsDelta: delta } })
        }
      }
    } catch (error) {
      if (error instanceof Error && /Claude stream error/.test(error.message)) throw error
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) processLine(line)
  }
  if (buffer.trim()) processLine(buffer)

  return {
    content,
    reasoning,
    toolCalls: toolCalls.filter((call) => call?.name),
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cacheHitTokens,
      cacheMissTokens,
    },
  }
}

export const testXianZunProvider = async (options: {
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  auth: XianZunAnthropicAuth
}): Promise<void> => {
  const anthropic = options.protocol === 'anthropic'
  const response = await fetch(
    anthropic ? anthropicEndpoint(options.baseUrl, 'models') : xianZunEndpoint(options.baseUrl, 'models'),
    {
      headers: anthropic ? headersFor(options.apiKey, options.auth) : { Authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}
