export type XianZunProviderProtocol = 'openai' | 'anthropic'
export type XianZunAnthropicAuth = 'bearer' | 'x-api-key'

export interface XianZunProvider {
  id: string
  name: string
  protocol: XianZunProviderProtocol
  baseUrl: string
  apiKey: string
  model: string
  models: string[]
  anthropicAuth: XianZunAnthropicAuth
  presetId?: string
  createdAt: number
  updatedAt: number
}

export interface XianZunProviderPreset {
  id: string
  name: string
  group: 'international' | 'china' | 'aggregator' | 'custom'
  protocol: XianZunProviderProtocol
  baseUrl: string
  defaultModel: string
  models: string[]
  hint?: string
}

export const XIANZUN_PROVIDER_GROUP_LABELS: Record<XianZunProviderPreset['group'], string> = {
  international: '国际厂商',
  china: '国产厂商',
  aggregator: '聚合 / 中转',
  custom: '自定义',
}

export const XIANZUN_PROVIDER_PRESETS: XianZunProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek 深度求索', group: 'china', protocol: 'openai', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-flash', models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'] },
  { id: 'openai', name: 'OpenAI / ChatGPT', group: 'international', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-5', models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'] },
  { id: 'anthropic', name: 'Anthropic Claude', group: 'international', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5', models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'], hint: 'Claude Code 中转站同样适用，Bearer 与 x-api-key 鉴权均可。' },
  { id: 'moonshot', name: 'Kimi / Moonshot 月之暗面', group: 'china', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2-0905-preview', models: ['kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking', 'moonshot-v1-128k'] },
  { id: 'zhipu', name: '智谱 GLM', group: 'china', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.6', models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4-flash'] },
  { id: 'qwen', name: '通义千问 / 阿里百炼', group: 'china', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3-max', models: ['qwen3-max', 'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwq-plus'] },
  { id: 'doubao', name: '豆包 / 火山方舟', group: 'china', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-1-6-250615', models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250828', 'doubao-seed-1-6-thinking-250715'] },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', group: 'aggregator', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V3.2-Exp', models: ['deepseek-ai/DeepSeek-V3.2-Exp', 'Qwen/Qwen3-235B-A22B', 'moonshotai/Kimi-K2-Instruct', 'zai-org/GLM-4.6'] },
  { id: 'qianfan', name: '百度千帆', group: 'china', protocol: 'openai', baseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.5-turbo-128k', models: ['ernie-4.5-turbo-128k', 'ernie-x1-turbo-32k', 'deepseek-v3', 'deepseek-r1'] },
  { id: 'minimax', name: 'MiniMax', group: 'china', protocol: 'openai', baseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M2', models: ['MiniMax-M2', 'MiniMax-Text-01'] },
  { id: 'spark', name: '讯飞星火', group: 'china', protocol: 'openai', baseUrl: 'https://spark-api-open.xf-yun.com/v1', defaultModel: '4.0Ultra', models: ['4.0Ultra', 'generalv3.5', 'max-32k', 'lite'] },
  { id: 'hunyuan', name: '腾讯混元', group: 'china', protocol: 'openai', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: 'hunyuan-turbos-latest', models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-lite'] },
  { id: 'stepfun', name: '阶跃星辰 StepFun', group: 'china', protocol: 'openai', baseUrl: 'https://api.stepfun.com/v1', defaultModel: 'step-2-16k', models: ['step-2-16k', 'step-1-128k', 'step-1-8k'] },
  { id: 'openrouter', name: 'OpenRouter', group: 'aggregator', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4.5', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'deepseek/deepseek-chat-v3-0324', 'moonshotai/kimi-k2'] },
  { id: 'custom', name: '自定义来源', group: 'custom', protocol: 'openai', baseUrl: '', defaultModel: '', models: [], hint: '支持 OpenAI Chat Completions 或 Anthropic Messages 兼容端点。' },
]

const providerId = (): string => `xz-provider-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

export const createXianZunProvider = (preset: XianZunProviderPreset): XianZunProvider => {
  const now = Date.now()
  return {
    id: providerId(),
    name: preset.name,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: preset.defaultModel,
    models: [...preset.models],
    anthropicAuth: preset.id === 'anthropic' ? 'x-api-key' : 'bearer',
    presetId: preset.id,
    createdAt: now,
    updatedAt: now,
  }
}

export const normalizeXianZunProvider = (raw: unknown): XianZunProvider | null => {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<XianZunProvider>
  const now = Date.now()
  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : providerId(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '未命名来源',
    protocol: value.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '',
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    model: typeof value.model === 'string' ? value.model.trim() : '',
    models: Array.isArray(value.models) ? value.models.filter((model): model is string => typeof model === 'string' && !!model.trim()) : [],
    anthropicAuth: value.anthropicAuth === 'x-api-key' ? 'x-api-key' : 'bearer',
    presetId: typeof value.presetId === 'string' ? value.presetId : undefined,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
  }
}

export const migrateLegacyXianZunProvider = (apiUrl: string, apiKey: string, model: string): XianZunProvider => ({
  id: 'xz-provider-legacy',
  name: 'DeepSeek 深度求索',
  protocol: 'openai',
  baseUrl: apiUrl.trim() || 'https://api.deepseek.com/v1',
  apiKey,
  model: model.trim() || 'deepseek-v4-flash',
  models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  anthropicAuth: 'bearer',
  presetId: 'deepseek',
  createdAt: Date.now(),
  updatedAt: Date.now(),
})
