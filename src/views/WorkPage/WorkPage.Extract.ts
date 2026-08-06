import { ElMessage } from 'element-plus';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import { ResourceManager } from '../../store/ResourceManager';
import { i18n } from '../../i18n';
import { debugLog } from '../../utils/debugLog';
import { autoApplyTextureMarksFromHistoryForTab, type MarkStyle } from '../MarkTexture/MarkTextureFull';
import {
	buildExtractModelPayload,
	validateExtractModelPayloadNotEmpty,
	validateFrameAnalysisFolderPath,
} from './WorkPage.Validate';

const t = i18n.global.t;

type ModelRow = {
	drawIB: string;
	aliasName: string;
};

type ExtractInvokeArgs = {
	frameAnalysisFolder: string;
	gamePreset: string;
	workspaceRootPath: string;
	lodName: string;
	lodWorkspacePath: string;
};

export type FullExtractDataTypeFilter = 'all' | 'gpu-preskinning-only' | 'cpu-preskinning-only';

type ExtractBaseParams = {
	frameAnalysisFolderPath: string;
	/** 当前激活的工作空间标签页名称，即 LOD 名称（如 "LOD0"） */
	activeTabName: string;
	getWorkspaceBaseDir: () => Promise<string | undefined>;
	workspaceName: string;
	currentGameName: string;
};

type ExtractSharedParams = ExtractBaseParams & {
	openPath: (path: string | undefined, emptyMsg: string) => Promise<void>;
};

const openCurrentWorkspaceFolder = async (params: ExtractSharedParams): Promise<void> => {
	const invokeArgs = await resolveExtractInvokeArgs(params);
	if (!invokeArgs) {
		return;
	}

	if (!params.workspaceName) {
		ElMessage.warning(t('workPage.messages.selectOrCreateWorkspaceFirst'));
		return;
	}

	const path = invokeArgs.lodWorkspacePath;
	await mkdir(path, { recursive: true });
	await params.openPath(path, t('workPage.messages.openFailed'));
};

const resolveExtractInvokeArgs = async (
	params: ExtractBaseParams
): Promise<ExtractInvokeArgs | undefined> => {
	const frameAnalysisError = validateFrameAnalysisFolderPath(params.frameAnalysisFolderPath);
	if (frameAnalysisError) {
		ElMessage.warning(frameAnalysisError);
		return undefined;
	}

	const workspaceBase = await params.getWorkspaceBaseDir();
	if (!workspaceBase) {
		ElMessage.warning(t('workPage.messages.selectGameAndCacheFirst'));
		return undefined;
	}

	if (!params.workspaceName) {
		ElMessage.warning(t('workPage.messages.selectOrCreateWorkspaceFirst'));
		return undefined;
	}

	const lodName = params.activeTabName.trim();
	if (!lodName) {
		ElMessage.warning(t('workPage.messages.selectOrCreateWorkspaceFirst'));
		return undefined;
	}

	const workspaceRootPath = await join(workspaceBase, params.workspaceName);
	const lodWorkspacePath = await join(workspaceRootPath, lodName);
	const currentConfig = await ResourceManager.loadGameConfig(params.currentGameName);
	const presetName = currentConfig?.gamePreset || params.currentGameName;
	const frameAnalysisFolder = params.frameAnalysisFolderPath.trim();

	return {
		frameAnalysisFolder,
		gamePreset: presetName,
		workspaceRootPath,
		lodName,
		lodWorkspacePath,
	};
};

const tryAutoApplyTextureMarksAfterExtract = async (args: {
	workspacePath: string;
	currentGameName: string;
	activeTabId: string;
	textureMarkStylePreference: MarkStyle;
}): Promise<void> => {
	if (!args.workspacePath || !args.activeTabId) {
		return;
	}

	try {
		const result = await autoApplyTextureMarksFromHistoryForTab({
			workspacePath: args.workspacePath,
			tabId: args.activeTabId,
			currentGameName: args.currentGameName,
			defaultMarkStyle: args.textureMarkStylePreference,
		});

		if (result.appliedSubMeshCount <= 0) {
			ElMessage.info(t('workPage.messages.autoApplyTextureMarksNotFound'));
			return;
		}

		ElMessage.success(
			t('workPage.messages.autoApplyTextureMarksCompleted', {
				subMeshes: result.appliedSubMeshCount,
				drawCalls: result.matchedDrawCallCount,
				textures: result.appliedTextureCount,
			})
		);
	} catch (error) {
		console.error('Auto apply texture marks failed', error);
		ElMessage.error(
			t('workPage.messages.autoApplyTextureMarksFailed', {
				error: String(error),
			})
		);
	}
};

export const runExtractModels = async (
	isExtracting: boolean,
	modelRows: ModelRow[],
	frameAnalysisFolderPath: string,
	activeTabName: string,
	getWorkspaceBaseDir: () => Promise<string | undefined>,
	workspaceName: string,
	currentGameName: string,
	activeTabId: string,
	convertRgbaChannelTextures: boolean,
	textureMarkStylePreference: MarkStyle,
	setIsExtracting: (value: boolean) => void,
	openPath: (path: string | undefined, emptyMsg: string) => Promise<void>
): Promise<void> => {
	if (isExtracting) return;

	const payload = buildExtractModelPayload(modelRows);

	const payloadError = validateExtractModelPayloadNotEmpty(payload);
	if (payloadError) {
		ElMessage.info(payloadError);
		return;
	}

	setIsExtracting(true);
	try {
		const invokeArgs = await resolveExtractInvokeArgs({
			frameAnalysisFolderPath,
			activeTabName,
			getWorkspaceBaseDir,
			workspaceName,
			currentGameName,
		});
		if (!invokeArgs) return;

		await invoke('extract_models_new', {
			frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
			gamePreset: invokeArgs.gamePreset,
			workspaceRootPath: invokeArgs.workspaceRootPath,
			lodName: invokeArgs.lodName,
			convertRgbaChannelTextures,
		});
		ElMessage.success(t('workPage.messages.modelExtractionAndDedupedCompleted'));
		await tryAutoApplyTextureMarksAfterExtract({
			workspacePath: invokeArgs.lodWorkspacePath,
			currentGameName,
			activeTabId,
			textureMarkStylePreference,
		});

		const path = invokeArgs.lodWorkspacePath;
		await mkdir(path, { recursive: true });
		await openPath(path, t('workPage.messages.openFailed'));
	} catch (err) {
		console.error('Model extraction failed', err);
		ElMessage.error(t('workPage.messages.modelExtractionFailed', { error: String(err) }));
	} finally {
		setIsExtracting(false);
	}
};

	export const runFullExtract = async (
		isExtracting: boolean,
		frameAnalysisFolderPath: string,
		activeTabName: string,
		dataTypeFilter: FullExtractDataTypeFilter,
		getWorkspaceBaseDir: () => Promise<string | undefined>,
		workspaceName: string,
		currentGameName: string,
		activeTabId: string,
		convertRgbaChannelTextures: boolean,
		textureMarkStylePreference: MarkStyle,
		setIsExtracting: (value: boolean) => void,
		openPath: (path: string | undefined, emptyMsg: string) => Promise<void>
	): Promise<void> => {
		if (isExtracting) return;

		setIsExtracting(true);
		try {
			const invokeArgs = await resolveExtractInvokeArgs({
				frameAnalysisFolderPath,
				activeTabName,
				getWorkspaceBaseDir,
				workspaceName,
				currentGameName,
			});
			if (!invokeArgs) return;

			await invoke('full_extract', {
				frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
				gamePreset: invokeArgs.gamePreset,
				workspaceRootPath: invokeArgs.workspaceRootPath,
				lodName: invokeArgs.lodName,
				dataTypeFilter,
				convertRgbaChannelTextures,
			});
			ElMessage.success(t('workPage.messages.fullExtractionTriggered'));
			await tryAutoApplyTextureMarksAfterExtract({
				workspacePath: invokeArgs.lodWorkspacePath,
				currentGameName,
				activeTabId,
				textureMarkStylePreference,
			});

			const path = invokeArgs.lodWorkspacePath;
			await mkdir(path, { recursive: true });
			await openPath(path, t('workPage.messages.openFailed'));
		} catch (err) {
			console.error('Full extraction failed', err);
			ElMessage.error(t('workPage.messages.fullExtractionFailed', { error: String(err) }));
		} finally {
			setIsExtracting(false);
		}
	};

export const triggerAllTextures = async (
	params: ExtractSharedParams
): Promise<void> => {
	try {
		const invokeArgs = await resolveExtractInvokeArgs(params);
		if (!invokeArgs) return;

		await invoke('extract_deduped_textures', {
			frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
			gamePreset: invokeArgs.gamePreset,
			workspaceRootPath: invokeArgs.workspaceRootPath,
			lodName: invokeArgs.lodName,
		});

		await invoke('extract_trianglelist_textures', {
			frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
			gamePreset: invokeArgs.gamePreset,
			workspaceRootPath: invokeArgs.workspaceRootPath,
			lodName: invokeArgs.lodName,
		});

		ElMessage.success(t('workPage.messages.allTextureExtractionCompleted'));
		await openCurrentWorkspaceFolder(params);
	} catch (err) {
		console.error('Failed to extract all texture types', err);
		ElMessage.error(t('workPage.messages.extractAllTextureTypesFailed', { error: String(err) }));
	}
};

export const triggerDedupedTextures = async (
	params: ExtractSharedParams
): Promise<void> => {
	try {
		const invokeArgs = await resolveExtractInvokeArgs(params);
		if (!invokeArgs) return;

		await invoke('extract_deduped_textures', {
			frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
			gamePreset: invokeArgs.gamePreset,
			workspaceRootPath: invokeArgs.workspaceRootPath,
			lodName: invokeArgs.lodName,
		});
		ElMessage.success(t('workPage.messages.dedupedTexturesExtractionCompleted'));
		await openCurrentWorkspaceFolder(params);
	} catch (err) {
		console.error('DedupedTextures extraction failed', err);
		ElMessage.error(t('workPage.messages.dedupedTexturesExtractionFailed', { error: String(err) }));
	}
};

export const triggerTrianglelistTextures = async (
	params: ExtractSharedParams
): Promise<void> => {
	try {
		const invokeArgs = await resolveExtractInvokeArgs(params);
		if (!invokeArgs) return;

		await invoke('extract_trianglelist_textures', {
			frameAnalysisFolder: invokeArgs.frameAnalysisFolder,
			gamePreset: invokeArgs.gamePreset,
			workspaceRootPath: invokeArgs.workspaceRootPath,
			lodName: invokeArgs.lodName,
		});
		ElMessage.success(t('workPage.messages.trianglelistTexturesExtractionCompleted'));
		await openCurrentWorkspaceFolder(params);
	} catch (err) {
		console.error('TrianglelistTextures extraction failed', err);
		ElMessage.error(t('workPage.messages.trianglelistTexturesExtractionFailed', { error: String(err) }));
	}
};

export const handleTextureMenuCommand = async (
	cmd: unknown,
	params: ExtractSharedParams
): Promise<void> => {
	const normalizedCmd = typeof cmd === 'string' ? cmd.trim() : String(cmd ?? '');
	debugLog('WorkPage.Extract', 'texture command(raw):', cmd);
	debugLog('WorkPage.Extract', 'texture command(normalized):', normalizedCmd);

	if (normalizedCmd === 'allTextures') {
		await triggerAllTextures(params);
		return;
	}

	if (normalizedCmd === 'dedupedTextures') {
		await triggerDedupedTextures(params);
		return;
	}

	if (normalizedCmd === 'trianglelistTextures') {
		await triggerTrianglelistTextures(params);
		return;
	}

	ElMessage.warning(t('workPage.messages.unknownTextureExtractionCommand', { command: normalizedCmd }));
};
