export enum BGType {
	Image = 'Image',
	Video = 'Video',
}

export enum SSMTLocale {
	en = 'en',
	zhs = 'zhs',
	zht = 'zht',
}

const normalizeLocale = (value: unknown): SSMTLocale => {
	if (value === SSMTLocale.en || value === SSMTLocale.zhs || value === SSMTLocale.zht) {
		return value
	}
	return SSMTLocale.en
}

export type TextureMarkStylePreference = 'Hash' | 'Slot' | 'SharedSlot'
export type GameBananaNsfwMode = 'show' | 'blur' | 'hide'
export type GameBananaTranslationProvider = 'openai' | 'compatible' | 'claude' | 'deepseek' | 'gemini' | 'google'

export const APP_UI_SCALE_MIN = 0.7
export const APP_UI_SCALE_MAX = 1.2
export const APP_UI_SCALE_STEP = 0.05

export const normalizeAppUiScale = (value: unknown): number => {
	if (value === null || value === undefined || value === '') {
		return 1
	}

	const numericValue = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(numericValue)) {
		return 1
	}

	const clampedValue = Math.min(APP_UI_SCALE_MAX, Math.max(APP_UI_SCALE_MIN, numericValue))
	return Math.round(clampedValue / APP_UI_SCALE_STEP) * APP_UI_SCALE_STEP
}

const normalizeTextureMarkStylePreference = (
	value: unknown
): TextureMarkStylePreference => {
	if (value === 'Slot') return 'Slot'
	if (value === 'SharedSlot') return 'SharedSlot'
	return 'Hash'
}

const normalizeGameBananaNsfwMode = (value: unknown): GameBananaNsfwMode => {
	return value === 'show' || value === 'hide' || value === 'blur' ? value : 'blur'
}

const normalizeGameBananaTranslationProvider = (value: unknown): GameBananaTranslationProvider => {
	return value === 'compatible' || value === 'claude' || value === 'deepseek' || value === 'gemini' || value === 'google'
		? value
		: 'openai'
}

const REASONING_EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const

export type XianZunReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const REASONING_EFFORT_OPTIONS = [...REASONING_EFFORTS]

const XIANZUN_APPROVAL_MODES = ['manual', 'auto', 'none'] as const

export type XianZunApprovalMode = (typeof XIANZUN_APPROVAL_MODES)[number]

export const XIANZUN_APPROVAL_MODE_OPTIONS = [...XIANZUN_APPROVAL_MODES]

const normalizeReasoningEffort = (value: unknown): XianZunReasoningEffort =>
	typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value)
		? (value as XianZunReasoningEffort)
		: 'auto'

const normalizeXianZunApprovalMode = (value: unknown): XianZunApprovalMode =>
	typeof value === 'string' && (XIANZUN_APPROVAL_MODES as readonly string[]).includes(value)
		? (value as XianZunApprovalMode)
		: 'manual'

const normalizeSidebarGameOrder = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return []
	}

	const seen = new Set<string>()
	const normalized: string[] = []

	for (const item of value) {
		if (typeof item !== 'string') {
			continue
		}

		const name = item.trim()
		if (!name || seen.has(name)) {
			continue
		}

		seen.add(name)
		normalized.push(name)
	}

	return normalized
}

const normalizeWorkspaceByGame = (value: unknown): Record<string, string> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}

	const normalized: Record<string, string> = {}

	for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
		if (typeof rawKey !== 'string' || typeof rawValue !== 'string') {
			continue
		}

		const key = rawKey.trim()
		const workspaceName = rawValue.trim()
		if (!key || !workspaceName) {
			continue
		}

		normalized[key] = workspaceName
	}

	return normalized
}

const parseVersionStringToNumber = (version: string): number => {
	const [majorRaw = '0', minorRaw = '0', patchRaw = '0'] = version
		.split('.')
		.map(part => part.match(/\d+/)?.[0] ?? '0')

	const major = Number.parseInt(majorRaw, 10)
	const minor = Number.parseInt(minorRaw, 10)
	const patch = Number.parseInt(patchRaw, 10)

	if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
		return 0
	}

	return major * 1000 + minor * 100 + patch
}

export class AppSettings {
	private static currentVersionNumber = 0
	VersionNumber:number = AppSettings.CURRENT_VERSION

	private static get CURRENT_VERSION(): number {
		return AppSettings.currentVersionNumber
	}

	static setCurrentVersionNumber(versionNumber: number): void {
		if (!Number.isFinite(versionNumber) || versionNumber <= 0) {
			return
		}
		AppSettings.currentVersionNumber = Math.trunc(versionNumber)
	}

	static getCurrentVersionNumber(): number {
		return AppSettings.currentVersionNumber
	}

	static parseVersionStringToNumber(version: string): number {
		return parseVersionStringToNumber(version)
	}

	bgType: BGType = BGType.Image
	bgImage: string = ''
	bgVideo: string = ''
	contentOpacity: number = 0.5
	globalDimMaskStrength: number = 2.5
	uiScale: number = 1
	DBMTWorkFolder: string = ''
	CurrentGameName: string = 'Default'
	githubToken: string = ''
	includePrereleaseUpdates: boolean = true
	coreVersion: string = ''
	coreReleaseDescription: string = ''
	coreVersionDev: string = ''
	coreReleaseDescriptionDev: string = ''
	coreVersionPlay: string = ''
	coreReleaseDescriptionPlay: string = ''
	coreVersionSsiceA: string = ''
	coreReleaseDescriptionSsiceA: string = ''
	ReverseOutputFolder: string = ''
	ReversedWorkSpaceName: string = 'Default'
	DRMSingleIniPath: string = ''
	DRMResSPath: string = ''
	DRMAclFolderPath: string = ''
	DRMTargetFolderPath: string = ''
	textureMarkStylePreference: TextureMarkStylePreference = 'Hash'
	locale: SSMTLocale = SSMTLocale.en
	windowWidth?: number = 1280
	windowHeight?: number = 720
	CurrentWorkSpace: string = 'Default'
	CurrentWorkSpaceByGame: Record<string, string> = {}
	sidebarGameOrder: string[] = []
	modsManagementBlurNsfw: boolean = true
	gamebananaNsfwMode: GameBananaNsfwMode = 'blur'
	gamebananaTranslationEnabled: boolean = true
	gamebananaTranslationRichText: boolean = false
	gamebananaTranslationProvider: GameBananaTranslationProvider = 'openai'
	gamebananaTranslationApiUrl: string = 'https://api.openai.com/v1'
	gamebananaTranslationApiKey: string = ''
	gamebananaTranslationModel: string = 'gpt-4o-mini'
	gamebananaTranslationTargetLanguage: string = '简体中文'
	gamebananaTranslationShortcut: string = 'Ctrl'
	showWindowShortcutEnabled: boolean = true
	// Nexus Mods uses a per-user API key and a game URL-domain (for example,
	// "skyrimspecialedition"), rather than GameBanana's numeric game ID.
	nexusModsApiKey: string = ''
	nexusModsGameDomain: string = ''
	// XianZun (小尊小尊) — AI chat agent. OpenAI-compatible endpoint, so it
	// works with DeepSeek out of the box and any compatible provider.
	xianzunApiKey: string = ''
	xianzunApiUrl: string = 'https://api.deepseek.com/v1'
	xianzunModel: string = 'deepseek-v4-flash'
	xianzunSystemPrompt: string = ''
	xianzunReasoningEffort: XianZunReasoningEffort = 'auto'
	xianzunApprovalMode: XianZunApprovalMode = 'manual'

	constructor(init?: Partial<AppSettings>) {
		if (init) {
			Object.assign(this, init)
		}

		// Ensure defaults for fields that may be undefined/null after assignment
		this.bgType = init?.bgType ?? this.bgType
		this.bgImage = init?.bgImage ?? this.bgImage
		this.bgVideo = init?.bgVideo ?? this.bgVideo
		this.contentOpacity = init?.contentOpacity ?? this.contentOpacity

		this.globalDimMaskStrength = init?.globalDimMaskStrength ?? this.globalDimMaskStrength
		this.uiScale = normalizeAppUiScale(init?.uiScale)
		this.DBMTWorkFolder = init?.DBMTWorkFolder ?? this.DBMTWorkFolder
		this.CurrentGameName = init?.CurrentGameName ?? this.CurrentGameName
		this.githubToken = init?.githubToken ?? this.githubToken
		this.includePrereleaseUpdates = init?.includePrereleaseUpdates ?? this.includePrereleaseUpdates
		this.coreVersion = init?.coreVersion ?? this.coreVersion
		this.coreReleaseDescription = init?.coreReleaseDescription ?? this.coreReleaseDescription
		this.coreVersionDev = init?.coreVersionDev ?? this.coreVersion
		this.coreReleaseDescriptionDev = init?.coreReleaseDescriptionDev ?? this.coreReleaseDescription
		this.coreVersionPlay = init?.coreVersionPlay ?? this.coreVersionPlay
		this.coreReleaseDescriptionPlay = init?.coreReleaseDescriptionPlay ?? this.coreReleaseDescriptionPlay
		this.coreVersionSsiceA = init?.coreVersionSsiceA ?? this.coreVersionSsiceA
		this.coreReleaseDescriptionSsiceA = init?.coreReleaseDescriptionSsiceA ?? this.coreReleaseDescriptionSsiceA
		this.ReverseOutputFolder = init?.ReverseOutputFolder ?? this.ReverseOutputFolder
		this.ReversedWorkSpaceName = init?.ReversedWorkSpaceName ?? this.ReversedWorkSpaceName
		this.DRMSingleIniPath = init?.DRMSingleIniPath ?? this.DRMSingleIniPath
		this.DRMResSPath = init?.DRMResSPath ?? this.DRMResSPath
		this.DRMAclFolderPath = init?.DRMAclFolderPath ?? this.DRMAclFolderPath
		this.DRMTargetFolderPath = init?.DRMTargetFolderPath ?? this.DRMTargetFolderPath
		this.textureMarkStylePreference = normalizeTextureMarkStylePreference(
			init?.textureMarkStylePreference
		)
		this.locale = normalizeLocale(init?.locale)
		this.windowWidth = init?.windowWidth ?? this.windowWidth
		this.windowHeight = init?.windowHeight ?? this.windowHeight
		this.CurrentWorkSpace = init?.CurrentWorkSpace ?? this.CurrentWorkSpace
		this.CurrentWorkSpaceByGame = normalizeWorkspaceByGame(init?.CurrentWorkSpaceByGame)
		this.sidebarGameOrder = normalizeSidebarGameOrder(init?.sidebarGameOrder)
		this.modsManagementBlurNsfw = init?.modsManagementBlurNsfw ?? this.modsManagementBlurNsfw
		this.gamebananaNsfwMode = normalizeGameBananaNsfwMode(init?.gamebananaNsfwMode)
		this.gamebananaTranslationEnabled = init?.gamebananaTranslationEnabled ?? this.gamebananaTranslationEnabled
		this.gamebananaTranslationRichText = init?.gamebananaTranslationRichText ?? this.gamebananaTranslationRichText
		this.gamebananaTranslationProvider = normalizeGameBananaTranslationProvider(init?.gamebananaTranslationProvider)
		this.gamebananaTranslationApiUrl = init?.gamebananaTranslationApiUrl ?? this.gamebananaTranslationApiUrl
		this.gamebananaTranslationApiKey = init?.gamebananaTranslationApiKey ?? this.gamebananaTranslationApiKey
		this.gamebananaTranslationModel = init?.gamebananaTranslationModel ?? this.gamebananaTranslationModel
		this.gamebananaTranslationTargetLanguage = init?.gamebananaTranslationTargetLanguage ?? this.gamebananaTranslationTargetLanguage
		const savedTranslationShortcut = init?.gamebananaTranslationShortcut?.trim()
		this.gamebananaTranslationShortcut = !savedTranslationShortcut || savedTranslationShortcut.toLowerCase() === 'ctrl+shift+t'
			? 'Ctrl'
			: savedTranslationShortcut
		this.showWindowShortcutEnabled = init?.showWindowShortcutEnabled ?? this.showWindowShortcutEnabled
		this.nexusModsApiKey = init?.nexusModsApiKey ?? this.nexusModsApiKey
		this.nexusModsGameDomain = init?.nexusModsGameDomain?.trim().toLowerCase() ?? this.nexusModsGameDomain
		this.xianzunApiKey = init?.xianzunApiKey ?? this.xianzunApiKey
		this.xianzunApiUrl = init?.xianzunApiUrl?.trim() || this.xianzunApiUrl
		// Normalize legacy model names (deepseek-flash / deepseek-pro) to the
		// current v4 naming so persisted settings keep working.
		const savedXianzunModel = init?.xianzunModel?.trim()
		this.xianzunModel =
			savedXianzunModel === 'deepseek-flash' || savedXianzunModel === 'deepseek-pro'
				? savedXianzunModel === 'deepseek-pro'
					? 'deepseek-v4-pro'
					: 'deepseek-v4-flash'
				: savedXianzunModel || this.xianzunModel
		this.xianzunSystemPrompt = init?.xianzunSystemPrompt ?? this.xianzunSystemPrompt
		this.xianzunReasoningEffort = normalizeReasoningEffort(init?.xianzunReasoningEffort)
		this.xianzunApprovalMode = normalizeXianZunApprovalMode(init?.xianzunApprovalMode)
		// VersionNumber is always controlled by current app code version,
		// not by persisted settings.json.
		this.VersionNumber = AppSettings.CURRENT_VERSION
	}

	static fromJSON(raw?: Partial<AppSettings>): AppSettings {
		const source = raw || {}
		const mapped: Partial<AppSettings> = {
			...source,
		}

		return new AppSettings(mapped)
	}

	toJSON(): Record<string, unknown> {
		return {
			VersionNumber: this.VersionNumber,
			bgType: this.bgType,
			bgImage: this.bgImage,
			bgVideo: this.bgVideo,
			contentOpacity: this.contentOpacity,
			globalDimMaskStrength: this.globalDimMaskStrength,
			uiScale: this.uiScale,
			DBMTWorkFolder: this.DBMTWorkFolder,
			CurrentGameName: this.CurrentGameName,
			githubToken: this.githubToken,
			includePrereleaseUpdates: this.includePrereleaseUpdates,
			coreVersion: this.coreVersion,
			coreReleaseDescription: this.coreReleaseDescription,
			coreVersionDev: this.coreVersionDev,
			coreReleaseDescriptionDev: this.coreReleaseDescriptionDev,
			coreVersionPlay: this.coreVersionPlay,
			coreReleaseDescriptionPlay: this.coreReleaseDescriptionPlay,
			coreVersionSsiceA: this.coreVersionSsiceA,
			coreReleaseDescriptionSsiceA: this.coreReleaseDescriptionSsiceA,
			ReverseOutputFolder: this.ReverseOutputFolder,
			ReversedWorkSpaceName: this.ReversedWorkSpaceName,
			DRMSingleIniPath: this.DRMSingleIniPath,
			DRMResSPath: this.DRMResSPath,
			DRMAclFolderPath: this.DRMAclFolderPath,
			DRMTargetFolderPath: this.DRMTargetFolderPath,
			textureMarkStylePreference: this.textureMarkStylePreference,
			locale: this.locale,
			windowWidth: this.windowWidth,
			windowHeight: this.windowHeight,
			CurrentWorkSpace: this.CurrentWorkSpace,
			CurrentWorkSpaceByGame: this.CurrentWorkSpaceByGame,
			sidebarGameOrder: this.sidebarGameOrder,
			modsManagementBlurNsfw: this.modsManagementBlurNsfw,
			gamebananaNsfwMode: this.gamebananaNsfwMode,
			gamebananaTranslationEnabled: this.gamebananaTranslationEnabled,
			gamebananaTranslationRichText: this.gamebananaTranslationRichText,
			gamebananaTranslationProvider: this.gamebananaTranslationProvider,
			gamebananaTranslationApiUrl: this.gamebananaTranslationApiUrl,
			gamebananaTranslationApiKey: this.gamebananaTranslationApiKey,
			gamebananaTranslationModel: this.gamebananaTranslationModel,
			gamebananaTranslationTargetLanguage: this.gamebananaTranslationTargetLanguage,
			gamebananaTranslationShortcut: this.gamebananaTranslationShortcut,
			showWindowShortcutEnabled: this.showWindowShortcutEnabled,
			nexusModsApiKey: this.nexusModsApiKey,
			nexusModsGameDomain: this.nexusModsGameDomain,
			xianzunApiKey: this.xianzunApiKey,
			xianzunApiUrl: this.xianzunApiUrl,
			xianzunModel: this.xianzunModel,
			xianzunSystemPrompt: this.xianzunSystemPrompt,
			xianzunReasoningEffort: this.xianzunReasoningEffort,
			xianzunApprovalMode: this.xianzunApprovalMode,
		}
	}
}
