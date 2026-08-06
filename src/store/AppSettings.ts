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
	convertRgbaChannelTextures: boolean = true
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
		this.convertRgbaChannelTextures = init?.convertRgbaChannelTextures ?? this.convertRgbaChannelTextures
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
			convertRgbaChannelTextures: this.convertRgbaChannelTextures,
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
		}
	}
}
