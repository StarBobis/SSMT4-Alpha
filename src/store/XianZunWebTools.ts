/* ═══════════════════════════════════════════════════════════════
   CheeseCat (芝士猫) — Web tools (GameBanana)
   ═══════════════════════════════════════════════════════════════
   Gives the agent read access to GameBanana so it can search mods,
   inspect details (screenshots, description, download links) and
   show them to the user — no browser needed. Mirrors the API calls
   used by the GameBanana page (apiv11).
   ═══════════════════════════════════════════════════════════════ */

import { fetch } from '@tauri-apps/plugin-http'
import type { McpTool } from './XianZunMcp'

const API_BASE = 'https://gamebanana.com/apiv11'
const DEFAULT_IMAGE_BASE = 'https://images.gamebanana.com/img/ss/mods'

export const GAMEBANANA_ID_BY_PRESET: Record<string, number> = {
  GIMI: 8552,
  WWMI: 20357,
  SRMI: 18366,
  ZZMI: 19567,
  HIMI: 10349,
}

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)

const asNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** Pick the best screenshot URL from a GameBanana image record. */
const imageUrl = (image: Record<string, unknown>): string => {
  const direct =
    asString(image['_sFile']) ||
    asString(image['_sFile800']) ||
    asString(image['_sFile530']) ||
    asString(image['_sFile220']) ||
    asString(image['_sFile100'])
  const base = asString(image['_sBaseUrl']) || DEFAULT_IMAGE_BASE
  if (!direct) return ''
  return `${base.replace(/\/$/, '')}/${direct.replace(/^\//, '')}`
}

const apiGet = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
  const search = new URLSearchParams(params)
  const response = await fetch(`${API_BASE}${path}?${search.toString()}`, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`GameBanana HTTP ${response.status}`)
  }
  const data = (await response.json()) as T & { _sErrorMessage?: unknown; error?: unknown }
  const apiError = asString(data._sErrorMessage) || asString(data.error)
  if (apiError) throw new Error(apiError)
  return data
}

interface GbModRecord {
  _idRow?: unknown
  _sName?: unknown
  _sProfileUrl?: unknown
  _sDescription?: unknown
  _nViewCount?: unknown
  _nLikeCount?: unknown
  _nDownloadCount?: unknown
  _aPreviewMedia?: { _aImages?: Array<Record<string, unknown>> }
  _aSubmitter?: { _sName?: unknown }
}

/** Resolve a game preset name (GIMI/WWMI/SRMI/ZZMI/HIMI) to a GameBanana game id. */
const resolveGameId = (gameName: string | undefined): number | null => {
  const name = (gameName ?? '').trim().toUpperCase()
  if (!name) return null
  return GAMEBANANA_ID_BY_PRESET[name] ?? null
}

/* ═══════════════════════════════════════════════
   Tools (all read-only)
   ═══════════════════════════════════════════════ */

const strProp = (description: string) => ({ type: 'string', description })

export const webTools: McpTool[] = [
  {
    name: 'gamebanana_search_mods',
    description:
      '在 GameBanana 上按关键词搜索 Mod,返回每条 Mod 的 ID、名称、页面链接、预览图 URL(可直接用 markdown 图片语法展示)、作者、点赞数。展示给用户前请用图片语法嵌入预览图。',
    category: 'GameBanana',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: strProp('搜索关键词(Mod 名称,如 "Ayaka 泳装" 或 "Hutao")'),
        gameName: strProp('游戏预设名:GIMI / WWMI / SRMI / ZZMI / HIMI(可选,默认 GIMI/8552)'),
        categoryId: { type: 'number', description: 'GameBanana 分类 ID(可选,先查分类再筛选)' },
        limit: { type: 'number', description: '返回条数,1-20,默认 8' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query ?? '').trim()
      if (!query) {
        return '缺少必需参数:query(搜索关键词)。请向用户询问要搜索的 Mod。'
      }
      const gameId = resolveGameId(String(args.gameName ?? '')) ?? 8552
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20)
      const params: Record<string, string> = {
        _nPage: '1',
        _nPerpage: String(limit),
        _sOrderBy: '_tsDateUpdated,DESC',
        '_aFilters[Generic_Game]': String(gameId),
        '_aFilters[Generic_Name]': `contains,${query}`,
      }
      if (args.categoryId !== undefined && Number(args.categoryId) > 0) {
        params['_aFilters[Generic_Category]'] = String(Number(args.categoryId))
      }

      const payload = await apiGet<{ _aRecords?: GbModRecord[] }>('/Mod/Index', params)
      const records = Array.isArray(payload._aRecords) ? payload._aRecords : []
      if (records.length === 0) {
        return `在 GameBanana(游戏 id=${gameId})上未找到包含 "${query}" 的 Mod。可以换关键词重试,或提示用户去应用内 GameBanana 页面手动浏览。`
      }

      const list = records.map((record) => {
        const images = record._aPreviewMedia?._aImages ?? []
        return {
          id: asNumber(record._idRow),
          name: asString(record._sName),
          profileUrl: asString(record._sProfileUrl) || `https://gamebanana.com/mods/${asNumber(record._idRow)}`,
          screenshot: imageUrl(images[0] ?? {}),
          author: asString(record._aSubmitter?._sName),
          likes: asNumber(record._nLikeCount),
        }
      })
      return JSON.stringify(list, null, 2)
    },
  },
  {
    name: 'gamebanana_get_mod_detail',
    description:
      '获取某个 GameBanana Mod 的完整详情:名称、作者、描述、截图列表(大图 URL)、下载链接。拿到下载链接后可引导用户,或配合 gamebanana_download_and_install_mod 直接安装。',
    category: 'GameBanana',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        modId: { type: 'number', description: 'GameBanana Mod ID(数字,可从搜索结果的 id 字段获得)' },
      },
      required: ['modId'],
    },
    execute: async (args) => {
      const modId = Number(args.modId)
      if (!Number.isSafeInteger(modId) || modId <= 0) {
        return '缺少必需参数:modId(有效的 GameBanana Mod ID)。请先搜索或向用户询问。'
      }
      const profile = await apiGet<GbModRecord & {
        _sText?: unknown
        _tsDateAdded?: unknown
        _aFiles?: Array<Record<string, unknown>>
        _aArchivedFiles?: Array<Record<string, unknown>>
      }>(`/Mod/${modId}/ProfilePage`)

      const images = profile._aPreviewMedia?._aImages ?? []
      const screenshots = images
        .map(imageUrl)
        .filter((url) => url.length > 0)
        .slice(0, 8)
      const files = (profile._aArchivedFiles ?? profile._aFiles ?? []).map((file) => ({
        fileName: asString(file['_sFile']),
        downloadUrl: asString(file['_sDownloadUrl']),
        sizeBytes: asNumber(file['_nFilesize']),
      }))

      const description = stripHtml(asString(profile._sText ?? profile._sDescription))
      const detail = {
        id: modId,
        name: asString(profile._sName),
        profileUrl:
          asString(profile._sProfileUrl) || `https://gamebanana.com/mods/${modId}`,
        author: asString(profile._aSubmitter?._sName),
        downloads: asNumber(profile._nDownloadCount),
        views: asNumber(profile._nViewCount),
        likes: asNumber(profile._nLikeCount),
        screenshots,
        files,
        description: description.slice(0, 2000),
      }
      return JSON.stringify(detail, null, 2)
    },
  },
  {
    name: 'gamebanana_get_categories',
    description:
      '获取某个游戏在 GameBanana 上的分类列表(名称、ID、Mod 数量),用于按类型筛选 Mod(如 服装、武器、模型替换 等)。',
    category: 'GameBanana',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        gameName: strProp('游戏预设名:GIMI / WWMI / SRMI / ZZMI / HIMI(可选,默认 GIMI/8552)'),
      },
      required: [],
    },
    execute: async (args) => {
      const gameId = resolveGameId(String(args.gameName ?? '')) ?? 8552
      const records = await apiGet<Array<Record<string, unknown>>>('/Mod/Categories', {
        _idGameRow: String(gameId),
        _sSort: 'a_to_z',
        _bShowEmpty: 'false',
      })
      const list = (Array.isArray(records) ? records : [])
        .map((record) => ({
          id: asNumber(record['_idRow']),
          name: asString(record['_sName']),
          modCount: asNumber(record['_nItemCount']),
        }))
        .filter((item) => item.id > 0)
        .slice(0, 100)
      if (list.length === 0) {
        return `GameBanana(游戏 id=${gameId})没有返回分类。`
      }
      return JSON.stringify(list, null, 2)
    },
  },
]
