import { join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { GlobalConfig } from '../store/GlobalConfig'

export type TextureMemoryMarkStyle = 'Hash' | 'Slot' | 'SharedSlot'
export type TextureMemoryFaceNormalChannel = 'R' | 'G' | 'B' | 'A'

export type TextureMemoryTargetItem = {
	slot: string
	markName: string
	markStyle: TextureMemoryMarkStyle
	faceNormalChannel?: TextureMemoryFaceNormalChannel
	render: boolean
	suffix: string
}

export type TextureSlotMemoryItem = {
	Slot: string
	MarkName: string
	MarkStyle: TextureMemoryMarkStyle
	FaceSDFChannel?: TextureMemoryFaceNormalChannel
	Render: boolean
	Suffix: string
}

export type TextureMemoryConfig = {
	SlotList: TextureSlotMemoryItem[]
	PixelShaderHashList?: string[]
}

const resolveGameFolderName = (currentGameName: string): string => {
	const gameName = (currentGameName || '').trim()
	if (!gameName || gameName === 'Default') {
		return 'DefaultGame'
	}
	return gameName
}

const getTextureMemoryConfigFilePath = async (
	currentGameName: string,
	psHash: string
): Promise<string> => {
	const gameFolder = await GlobalConfig.TextureConfigsGameFolder(resolveGameFolderName(currentGameName))
	return join(gameFolder, `${psHash}.json`)
}

export const loadTextureMemoryByPSHash = async (
	currentGameName: string,
	psHash: string
): Promise<TextureMemoryConfig | null> => {
	if (!psHash) {
		return null
	}

	try {
		const configPath = await getTextureMemoryConfigFilePath(currentGameName, psHash)
		const content = await readTextFile(configPath)
		return JSON.parse(content) as TextureMemoryConfig
	} catch {
		return null
	}
}

export const applyTextureMemoryToItems = <T extends TextureMemoryTargetItem>(
	items: T[],
	memoryConfig: TextureMemoryConfig
): T[] => {
	const slotMap = new Map<string, TextureSlotMemoryItem>()
	for (const item of memoryConfig.SlotList || []) {
		if (!item || typeof item.Slot !== 'string') {
			continue
		}
		slotMap.set(item.Slot, item)
	}

	return items.map(item => {
		const memory = slotMap.get(item.slot)
		if (!memory) {
			return item
		}

		const nextMarkStyle: TextureMemoryMarkStyle =
			memory.MarkStyle === 'Slot' || memory.MarkStyle === 'Hash' || memory.MarkStyle === 'SharedSlot'
				? memory.MarkStyle
				: item.markStyle

		return {
			...item,
			markName: memory.MarkName ?? item.markName,
			markStyle: nextMarkStyle,
			faceNormalChannel: memory.FaceSDFChannel === 'G' || memory.FaceSDFChannel === 'B' || memory.FaceSDFChannel === 'A'
				? memory.FaceSDFChannel
				: memory.FaceSDFChannel === 'R'
					? 'R'
					: item.faceNormalChannel,
			render: typeof memory.Render === 'boolean' ? memory.Render : item.render,
			suffix: memory.Suffix || item.suffix,
		}
	})
}

export const saveTextureMemoryByPSHash = async (
	currentGameName: string,
	psHash: string,
	items: TextureMemoryTargetItem[]
): Promise<void> => {
	if (!psHash || items.length === 0) {
		return
	}

	const payload: TextureMemoryConfig = {
		SlotList: items.map(item => ({
			Slot: item.slot,
			MarkName: item.markName,
			MarkStyle: item.markStyle,
			FaceSDFChannel: item.markName.trim().toLowerCase() === 'facesdfmap'
				? item.faceNormalChannel
				: undefined,
			Render: item.render,
			Suffix: item.suffix,
		})),
	}

	const gameFolder = await GlobalConfig.TextureConfigsGameFolder(resolveGameFolderName(currentGameName))
	await mkdir(gameFolder, { recursive: true })
	const configPath = await getTextureMemoryConfigFilePath(currentGameName, psHash)
	await writeTextFile(configPath, JSON.stringify(payload, null, 2))
}

export const deleteTextureMemoryByPSHash = async (
	currentGameName: string,
	psHash: string
): Promise<boolean> => {
	if (!psHash) {
		return false
	}

	const configPath = await getTextureMemoryConfigFilePath(currentGameName, psHash)
	if (!(await exists(configPath))) {
		return false
	}

	await remove(configPath)
	return true
}
