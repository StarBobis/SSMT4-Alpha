<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { dirname, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath as openExternal, revealItemInDir } from '@tauri-apps/plugin-opener';
import { moveFileToRecycleBin } from '../../utils/RecycleBin';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Grid, View } from '@element-plus/icons-vue';
import { useI18n } from 'vue-i18n';
import { AppStateManager } from '../../store/AppStateManager';
import { GlobalConfig } from '../../store/GlobalConfig';
import { ResourceManager } from '../../store/ResourceManager';
import { PathHelper } from '../../helper/PathHelper';
import { SSMTStringUtils } from '../../utils/SSMTStringUtils';
import { debugError } from '../../utils/debugLog';
import {
	applyTextureMemoryToItems,
	deleteTextureMemoryByPSHash,
	loadTextureMemoryByPSHash,
	saveTextureMemoryByPSHash,
} from '../../common/TextureMarkMemory';
import {
	addCustomTextureMarkName,
	getCustomTextureMarkNames,
	removeCustomTextureMarkName,
	type TextureMarkNameMemoryItem,
} from '../../common/TextureMarkNameMemory';
import { readDrawIBConfigFromWorkspace } from '../../common/DrawIBConfig';
import SubmeshPostProcessPreview from './SubmeshPostProcessPreview.vue';
import {
	applyTextureMarkForCurrentSubMesh,
	clearCurrentSubMeshTextureMarkup,
	exportHashStyleTextureModTemplateForCurrentSelection,
	exportSlotStyleTextureModTemplateForCurrentSelection,
	getMarkTextureComponentJsonPath,
	getMarkTextureDrawIBComponentJsonPath,
	getMarkTextureTrianglelistJsonPath,
	hasExistingSubMeshTextureMarks,
	readAppliedSubMeshTextureMarks,
	updateCurrentSubMeshTextureMarkupStyle,
} from './MarkTextureFull';

type MarkStyle = 'Hash' | 'Slot' | 'SharedSlot';

type TextureChannelKey = 'R' | 'G' | 'B' | 'A';

type TextureChannelPreview = {
	key: TextureChannelKey;
	label: TextureChannelKey;
	preview: string;
};

type TextureItem = {
	id: string;
	name: string;
	dedupedFileName: string;
	slot: string;
	ps_hash: string;
	render: boolean;
	suffix: string;
	size: string;
	preview: string;
	channelPreviews: TextureChannelPreview[];
	markName: string;
	markStyle: MarkStyle;
};

type PreviewTextureOption = {
	id: string;
	label: string;
	url: string;
	markName: string;
};

type SubMeshMarkedTextureSummary = {
	id: string;
	drawCallSelectionValue: string;
	preview: string;
	previewKey: string;
	textureName: string;
	dedupedFileName: string;
	slot: string;
	markName: string;
	markStyle: MarkStyle;
	status: 'applied' | 'pending';
	textureHash: string;
};

type SubMeshDrawerItem = {
	value: string;
	label: string;
	markCount: number;
	isSelected: boolean;
	markedTextures: SubMeshMarkedTextureSummary[];
};

type TrianglelistDedupedTextureProperty = {
	FALogDedupedFileName?: string;
	FADataDedupedFileName?: string;
};

type TrianglelistDedupedFileNameJson = Record<string, TrianglelistDedupedTextureProperty>;

type MarkTextureSelectionMemory = {
	subMesh?: string;
	drawCall?: string;
	drawCallBySubMesh?: Record<string, string>;
};

type MarkTextureGlobalUiConfig = {
	showUnrenderedTextures?: boolean;
	rgbaPreviewCardSize?: number;
};

type WorkspaceMarkTextureSource = {
	tabId: string;
	tabName: string;
	workspacePath: string;
	subMeshDrawCallMap: Record<string, string[]>;
	trianglelistDedupedData: TrianglelistDedupedFileNameJson;
	drawIBAliasMap: Record<string, string>;
	drawIBOrderMap: Record<string, number>;
	drawIBKeysByLengthDesc: string[];
	drawIBComponentMap: Record<string, { drawIB: string; componentIndex: string }>;
};

type WorkPageTabMeta = {
	id: string;
	name: string;
};

type WorkPageTabsIndex = {
	activeTabId: string;
	tabs: WorkPageTabMeta[];
};

const appSettings = AppStateManager.appSettings;
const { t } = useI18n();

const logPrefix = '[MarkTextureFull]';

const workspaceSources = ref<WorkspaceMarkTextureSource[]>([]);
const subMeshOptions = ref<string[]>([]);
const drawCallOptions = ref<string[]>([]);

const selectedSubMesh = ref('');
const selectedDrawCall = ref('');

const markStyleOptions: MarkStyle[] = ['Hash', 'Slot', 'SharedSlot'];
const textureChannelKeys: TextureChannelKey[] = ['R', 'G', 'B', 'A'];

const presetMarkNameOptions: Record<string, string[]> = {
	DEFAULT: ['DiffuseMap', 'NormalMap', 'LightMap', 'HighLightMap', 'RampMap', 'MaterialMap', 'StockingMap'],
	SRMI: ['DiffuseMap', 'NormalMap', 'MaterialMap', 'MaskMap', 'LightMap', 'EmissionMap', 'RampMap'],
	GIMI: ['DiffuseMap', 'NormalMap', 'LightMap', 'HighLightMap', 'MetalMap', 'MaterialMap', 'StockingMap'],
	HIMI: ['DiffuseMap', 'NormalMap', 'LightMap', 'FaceMap', 'HairMap', 'MaskMap', 'RampMap'],
	ZZMI: ['DiffuseMap', 'NormalMap', 'LightMap', 'BodyMaskMap', 'HairLightMap', 'MaterialMap', 'RampMap'],
	ZZMIDX12: ['DiffuseMap', 'NormalMap', 'LightMap', 'BodyMaskMap', 'HairLightMap', 'MaterialMap', 'RampMap'],
};

const gamePreset = ref('DEFAULT');
const customMarkNameOptions = ref<TextureMarkNameMemoryItem[]>([]);

const textureList = ref<TextureItem[]>([]);
const subMeshMarkedTextureMap = ref<Record<string, SubMeshMarkedTextureSummary[]>>({});
const drawCallSelectionBySubMesh = ref<Record<string, string>>({});
const activeChannelPreviewItem = ref<TextureItem | null>(null);
const showUnrenderedTextures = ref(true);
const rgbaPreviewCardSize = ref(0);
const isApplyingTextureMemory = ref(false);
const isApplyingAllDrawIBTextureMark = ref(false);
const isClearingCurrentDrawIBTextureMark = ref(false);
const isUpdatingCurrentDrawIBMarkStyle = ref(false);
const isDeletingCurrentTextureConfig = ref(false);
const isDeletingAllTextureConfigs = ref(false);
const isExportingHashTextureModTemplate = ref(false);
const isExportingSlotTextureModTemplate = ref(false);
const pendingRestoreSubMesh = ref('');
const pendingRestoreDrawCall = ref('');
const pendingDrawerDrawCallSelection = ref('');
let textureMemorySaveTimer: ReturnType<typeof setTimeout> | undefined;
let selectionMemorySaveTimer: ReturnType<typeof setTimeout> | undefined;
let workspaceUiConfigSaveTimer: ReturnType<typeof setTimeout> | undefined;
let rgbaPreviewResizeCleanup: (() => void) | undefined;
let textureListLoadToken = 0;
let markedTexturePreviewCacheSeed = 0;
let lastValidSubMeshSelection = '';
let lastValidDrawCallSelection = '';

const RGBA_PREVIEW_CARD_MIN_SIZE = 220;
const RGBA_PREVIEW_CARD_INITIAL_RATIO = 0.6;
const RGBA_PREVIEW_CARD_VIEWPORT_MARGIN = 32;

const currentGameName = computed(() => appSettings.CurrentGameName || 'Default');

const getPresetMarkNameList = (preset: string): string[] => {
	return [...(presetMarkNameOptions[preset] || presetMarkNameOptions.DEFAULT)];
};

const presetMarkNameList = computed(() => getPresetMarkNameList(gamePreset.value));

const normalizeMarkNameKey = (name: string): string => name.trim().toLocaleLowerCase();

const isPresetMarkName = (name: string): boolean => {
	const key = normalizeMarkNameKey(name);
	return presetMarkNameList.value.some(presetName => normalizeMarkNameKey(presetName) === key);
};

const refreshCustomMarkNameOptions = () => {
	customMarkNameOptions.value = getCustomTextureMarkNames(gamePreset.value)
		.filter(item => !isPresetMarkName(item.name));
};

const hasCustomMarkNameOptions = computed(() => customMarkNameOptions.value.length > 0);

const getRgbaPreviewCardMaxSize = (): number => {
	if (typeof window === 'undefined') {
		return 480;
	}

	return Math.max(
		RGBA_PREVIEW_CARD_MIN_SIZE,
		Math.min(window.innerWidth, window.innerHeight) - RGBA_PREVIEW_CARD_VIEWPORT_MARGIN
	);
};

const clampRgbaPreviewCardSize = (size: number): number => {
	if (!Number.isFinite(size)) {
		return Math.round(getRgbaPreviewCardMaxSize() * RGBA_PREVIEW_CARD_INITIAL_RATIO);
	}

	return Math.round(
		Math.min(
			getRgbaPreviewCardMaxSize(),
			Math.max(RGBA_PREVIEW_CARD_MIN_SIZE, size)
		)
	);
};

const ensureRgbaPreviewCardSize = () => {
	if (rgbaPreviewCardSize.value <= 0) {
		rgbaPreviewCardSize.value = clampRgbaPreviewCardSize(
			getRgbaPreviewCardMaxSize() * RGBA_PREVIEW_CARD_INITIAL_RATIO
		);
		return;
	}

	rgbaPreviewCardSize.value = clampRgbaPreviewCardSize(rgbaPreviewCardSize.value);
};

const rgbaPreviewCardStyle = computed(() => {
	ensureRgbaPreviewCardSize();
	return {
		width: `${rgbaPreviewCardSize.value}px`,
		height: `${rgbaPreviewCardSize.value}px`,
	};
});

const serializeSubMeshSelection = (tabId: string, subMeshName: string): string => {
	return JSON.stringify({ tabId, subMeshName });
};

const parseSubMeshSelection = (
	selectionValue: string
): { tabId: string; subMeshName: string } | undefined => {
	if (!selectionValue) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(selectionValue) as {
			tabId?: string;
			subMeshName?: string;
		};
		if (!parsed.tabId || !parsed.subMeshName) {
			return undefined;
		}

		return {
			tabId: parsed.tabId,
			subMeshName: parsed.subMeshName,
		};
	} catch {
		return undefined;
	}
};

const serializeDrawCallSelection = (
	tabId: string,
	subMeshName: string,
	drawCall: string
): string => {
	return JSON.stringify({ tabId, subMeshName, drawCall });
};

const parseDrawCallSelection = (
	selectionValue: string
): { tabId: string; subMeshName: string; drawCall: string } | undefined => {
	if (!selectionValue) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(selectionValue) as {
			tabId?: string;
			subMeshName?: string;
			drawCall?: string;
		};
		if (!parsed.tabId || !parsed.subMeshName || !parsed.drawCall) {
			return undefined;
		}

		return {
			tabId: parsed.tabId,
			subMeshName: parsed.subMeshName,
			drawCall: parsed.drawCall,
		};
	} catch {
		return undefined;
	}
};

const resolveDrawCallSelectionValue = (
	selectionValue: string,
	options: string[]
): string | undefined => {
	if (!selectionValue) {
		return undefined;
	}

	if (options.includes(selectionValue)) {
		return selectionValue;
	}

	return options.find(option => parseDrawCallSelection(option)?.drawCall === selectionValue);
};

const rememberDrawCallSelectionForSubMesh = (
	subMeshSelectionValue: string,
	drawCallSelectionValue: string
) => {
	if (!subMeshSelectionValue || !drawCallSelectionValue) {
		return;
	}

	drawCallSelectionBySubMesh.value = {
		...drawCallSelectionBySubMesh.value,
		[subMeshSelectionValue]: drawCallSelectionValue,
	};
};

const rememberCurrentDrawCallSelection = () => {
	if (!selectedSubMesh.value || !selectedDrawCall.value || !drawCallOptions.value.includes(selectedDrawCall.value)) {
		return;
	}

	rememberDrawCallSelectionForSubMesh(selectedSubMesh.value, selectedDrawCall.value);
};

const getRememberedDrawCallSelectionForSubMesh = (
	subMeshSelectionValue: string,
	options: string[]
): string | undefined => {
	const remembered = drawCallSelectionBySubMesh.value[subMeshSelectionValue] || '';
	return resolveDrawCallSelectionValue(remembered, options);
};

const getWorkspaceBaseDir = async (): Promise<string | undefined> => {
	console.log(`${logPrefix} getWorkspaceBaseDir input`, {
		currentGameName: appSettings.CurrentGameName,
		dbmtWorkFolder: appSettings.DBMTWorkFolder,
	});

	let gameName = appSettings.CurrentGameName;
	if (!gameName || gameName === 'Default') {
		gameName = 'DefaultGame';
		console.log(`${logPrefix} CurrentGameName invalid, fallback to DefaultGame`);
	}

	if (!appSettings.DBMTWorkFolder) {
		console.warn(`${logPrefix} DBMTWorkFolder is empty, skip DrawIB loading`);
		return undefined;
	}

	return join(appSettings.DBMTWorkFolder, 'WorkSpace', gameName);
};

const getWorkspacePath = async (workspaceName?: string): Promise<string | undefined> => {
	const workspaceBaseDir = await getWorkspaceBaseDir();
	if (!workspaceBaseDir) {
		return undefined;
	}

	const resolvedWorkspaceName = (workspaceName ?? appSettings.CurrentWorkSpace ?? '').trim();
	if (!resolvedWorkspaceName) {
		console.warn(`${logPrefix} workspaceName is empty, skip DrawIB loading`);
		return undefined;
	}

	const workspacePath = await join(workspaceBaseDir, resolvedWorkspaceName);
	console.log(`${logPrefix} resolved workspacePath`, workspacePath);
	return workspacePath;
};

const resolveWorkspaceLodPathForTab = async (
	workspacePath: string,
	tabName: string
): Promise<string> => {
	const trimmedTabName = tabName.trim();
	if (!trimmedTabName) {
		return workspacePath;
	}
	return join(workspacePath, trimmedTabName);
};

const getSelectedWorkspaceSource = (): WorkspaceMarkTextureSource | undefined => {
	const parsed = parseSubMeshSelection(selectedSubMesh.value);
	if (!parsed) {
		return undefined;
	}

	return workspaceSources.value.find(source => source.tabId === parsed.tabId);
};

const getSelectedSubMeshName = (): string => {
	return parseSubMeshSelection(selectedSubMesh.value)?.subMeshName || '';
};

const canBuildSlotTemplateFromSubMesh = (
	subMeshName: string
): { hash: string; matchIndexCount: string; matchFirstIndex: string } | undefined => {
	const parts = subMeshName
		.split('-')
		.map(part => part.trim())
		.filter(part => part.length > 0);

	if (parts.length < 3) {
		return undefined;
	}

	return {
		hash: parts[0],
		matchIndexCount: parts[1],
		matchFirstIndex: parts[2],
	};
};

const resolveDrawIBAlias = (source: WorkspaceMarkTextureSource, subMeshName: string): string => {
	const exactAlias = source.drawIBAliasMap[subMeshName];
	if (exactAlias) {
		return exactAlias;
	}

	const drawIBPrefix = subMeshName.split('-')[0]?.trim() || '';
	if (drawIBPrefix) {
		const prefixAlias = source.drawIBAliasMap[drawIBPrefix];
		if (prefixAlias) {
			return prefixAlias;
		}
	}

	for (const drawIB of source.drawIBKeysByLengthDesc) {
		if (subMeshName.startsWith(`${drawIB}-`)) {
			return source.drawIBAliasMap[drawIB] || '';
		}
	}

	return '';
};

const resolveSubMeshDrawIB = (
	source: WorkspaceMarkTextureSource,
	subMeshName: string
): string => {
	if (source.drawIBOrderMap[subMeshName] !== undefined) {
		return subMeshName;
	}

	const drawIBPrefix = subMeshName.split('-')[0]?.trim() || '';
	if (drawIBPrefix && source.drawIBOrderMap[drawIBPrefix] !== undefined) {
		return drawIBPrefix;
	}

	for (const drawIB of source.drawIBKeysByLengthDesc) {
		if (subMeshName.startsWith(`${drawIB}-`)) {
			return drawIB;
		}
	}

	return '';
};

const getSubMeshSortOrder = (
	source: WorkspaceMarkTextureSource,
	subMeshName: string
): number => {
	const drawIB = resolveSubMeshDrawIB(source, subMeshName);
	if (!drawIB) {
		return Number.MAX_SAFE_INTEGER;
	}

	return source.drawIBOrderMap[drawIB] ?? Number.MAX_SAFE_INTEGER;
};

const formatSubMeshLabel = (
	source: WorkspaceMarkTextureSource,
	subMeshName: string
): string => {
	const componentInfo = source.drawIBComponentMap[subMeshName];
	if (componentInfo) {
		const alias = source.drawIBAliasMap[componentInfo.drawIB] || '';
		const aliasSuffix = alias ? `.${alias}` : '';
		return `[${source.tabName}] ${componentInfo.drawIB}-${componentInfo.componentIndex}${aliasSuffix}`;
	}

	// 回退：DisplayIB-Component.json 无此映射，使用旧格式
	const alias = resolveDrawIBAlias(source, subMeshName);
	return alias
		? `[${source.tabName}] ${subMeshName} (${alias})`
		: `[${source.tabName}] ${subMeshName}`;
};

const subMeshOptionItems = computed(() => {
	return subMeshOptions.value
		.map(selectionValue => {
			const parsed = parseSubMeshSelection(selectionValue);
			if (!parsed) {
				return undefined;
			}

			const source = workspaceSources.value.find(item => item.tabId === parsed.tabId);
			if (!source) {
				return undefined;
			}

			return {
				value: selectionValue,
				label: formatSubMeshLabel(source, parsed.subMeshName),
			};
		})
		.filter((item): item is { value: string; label: string } => !!item);
});

const drawCallOptionItems = computed(() => {
	return drawCallOptions.value
		.map(selectionValue => {
			const parsed = parseDrawCallSelection(selectionValue);
			if (!parsed) {
				return undefined;
			}

			return {
				value: selectionValue,
				label: parsed.drawCall,
			};
		})
		.filter((item): item is { value: string; label: string } => !!item);
});

const subMeshDrawerItems = computed<SubMeshDrawerItem[]>(() => {
	return subMeshOptionItems.value.map(item => {
		const markedTextures = subMeshMarkedTextureMap.value[item.value] ?? [];
		return {
			value: item.value,
			label: item.label,
			markCount: markedTextures.length,
			isSelected: selectedSubMesh.value === item.value,
			markedTextures,
		};
	});
});

const previewTextureOptions = computed<PreviewTextureOption[]>(() => {
	const options = new Map<string, PreviewTextureOption>();
	const appliedOrPendingMarks = subMeshMarkedTextureMap.value[selectedSubMesh.value] ?? [];

	for (const mark of appliedOrPendingMarks) {
		if (!mark.preview) {
			continue;
		}
		options.set(`mark:${mark.id}`, {
			id: `mark:${mark.id}`,
			label: `${mark.markName || t('markTexture.preview.unmarkedTexture')} · ${mark.textureName}`,
			url: mark.preview,
			markName: mark.markName,
		});
	}

	for (const item of textureList.value) {
		if (!item.preview) {
			continue;
		}
		options.set(`current:${item.id}`, {
			id: `current:${item.id}`,
			label: `${item.markName || t('markTexture.preview.unmarkedTexture')} · ${item.name}`,
			url: item.preview,
			markName: item.markName,
		});
	}

	return Array.from(options.values());
});

const getCurrentGameFolderName = (): string => {
	const gameName = (appSettings.CurrentGameName || '').trim();
	if (!gameName || gameName === 'Default') {
		return 'DefaultGame';
	}
	return gameName;
};

const getSelectionMemoryConfigPath = async (): Promise<string | undefined> => {
	const workspaceBaseDir = await getWorkspaceBaseDir();
	if (!workspaceBaseDir) {
		return undefined;
	}

	return join(workspaceBaseDir, 'MarkTextureConfig.json');
};

const getGlobalUiConfigPath = async (): Promise<string> => {
	const globalFolder = await GlobalConfig.SSMT4GlobalConfigsFolder();
	return join(globalFolder, 'MarkTexturePageDisplayConfig.json');
};

const loadSelectionMemory = async () => {
	try {
		const configPath = await getSelectionMemoryConfigPath();
		if (!configPath) {
			return;
		}
		const content = await readTextFile(configPath);
		const parsed = JSON.parse(content) as MarkTextureSelectionMemory;

		if (typeof parsed.subMesh === 'string') {
			pendingRestoreSubMesh.value = parsed.subMesh;
		}
		if (typeof parsed.drawCall === 'string') {
			pendingRestoreDrawCall.value = parsed.drawCall;
		}
		if (typeof parsed.subMesh === 'string' && typeof parsed.drawCall === 'string') {
			rememberDrawCallSelectionForSubMesh(parsed.subMesh, parsed.drawCall);
		}
		if (parsed.drawCallBySubMesh && typeof parsed.drawCallBySubMesh === 'object') {
			const nextDrawCallSelectionBySubMesh: Record<string, string> = {};
			for (const [subMesh, drawCall] of Object.entries(parsed.drawCallBySubMesh)) {
				if (typeof subMesh === 'string' && typeof drawCall === 'string') {
					nextDrawCallSelectionBySubMesh[subMesh] = drawCall;
				}
			}
			drawCallSelectionBySubMesh.value = {
				...nextDrawCallSelectionBySubMesh,
				...drawCallSelectionBySubMesh.value,
			};
		}

	} catch {
		// No config yet or invalid JSON; keep defaults silently.
	}
};

const loadGlobalUiConfig = async () => {
	try {
		const configPath = await getGlobalUiConfigPath();
		const content = await readTextFile(configPath);
		const parsed = JSON.parse(content) as MarkTextureGlobalUiConfig;
		if (typeof parsed.showUnrenderedTextures === 'boolean') {
			showUnrenderedTextures.value = parsed.showUnrenderedTextures;
		}
		if (typeof parsed.rgbaPreviewCardSize === 'number') {
			rgbaPreviewCardSize.value = clampRgbaPreviewCardSize(parsed.rgbaPreviewCardSize);
		}
	} catch {
		// No global config yet or invalid JSON; keep current value.
	}

	ensureRgbaPreviewCardSize();
};

const loadWorkspaceMarkTextureSource = async (
	workspacePath: string,
	tab: WorkPageTabMeta
): Promise<WorkspaceMarkTextureSource | undefined> => {
	const componentJsonPath = await getMarkTextureComponentJsonPath(workspacePath);
	const trianglelistJsonPath = await getMarkTextureTrianglelistJsonPath(workspacePath);
	const drawIBComponentJsonPath = await getMarkTextureDrawIBComponentJsonPath(workspacePath);

	try {
		const [componentContent, trianglelistContent, drawIBConfigEntries] = await Promise.all([
			readTextFile(componentJsonPath),
			readTextFile(trianglelistJsonPath),
			readDrawIBConfigFromWorkspace(workspacePath).catch(() => []),
		]);

		const parsedComponent = JSON.parse(componentContent) as Record<string, unknown>;
		const parsedTrianglelist = JSON.parse(trianglelistContent) as TrianglelistDedupedFileNameJson;
		const subMeshDrawCallMap: Record<string, string[]> = {};

		for (const [subMeshName, drawCalls] of Object.entries(parsedComponent)) {
			if (!subMeshName.trim() || !Array.isArray(drawCalls)) {
				continue;
			}

			subMeshDrawCallMap[subMeshName] = drawCalls
				.filter((item): item is string => typeof item === 'string')
				.map(item => item.trim())
				.filter(item => item.length > 0);
		}

		if (Object.keys(subMeshDrawCallMap).length === 0) {
			return undefined;
		}

		const drawIBAliasMap: Record<string, string> = {};
		const drawIBOrderMap: Record<string, number> = {};
		for (const entry of drawIBConfigEntries) {
			const drawIB = (entry.DrawIB || '').trim();
			const alias = (entry.Alias || '').trim();
			if (!drawIB || !alias) {
				if (!drawIB) {
					continue;
				}
			}
			if (drawIBOrderMap[drawIB] === undefined) {
				drawIBOrderMap[drawIB] = Object.keys(drawIBOrderMap).length;
			}
			drawIBAliasMap[drawIB] = alias;
		}

		// 读取 DrawIB-Component.json 构建反向映射：submeshFolderName → { drawIB, componentIndex }
		const drawIBComponentMap: Record<string, { drawIB: string; componentIndex: string }> = {};
		try {
			if (await exists(drawIBComponentJsonPath)) {
				const drawIBComponentContent = await readTextFile(drawIBComponentJsonPath);
				const parsedDrawIBComponent = JSON.parse(drawIBComponentContent) as Record<string, Record<string, string>>;
				for (const [drawIB, componentDict] of Object.entries(parsedDrawIBComponent)) {
					if (!drawIB || typeof componentDict !== 'object') {
						continue;
					}
					for (const [componentIndex, submeshFolderName] of Object.entries(componentDict)) {
						if (!submeshFolderName || typeof submeshFolderName !== 'string') {
							continue;
						}
						drawIBComponentMap[submeshFolderName] = { drawIB, componentIndex };
					}
				}
			}
		} catch {
			// DrawIB-Component.json missing or invalid — leave map empty, fall back to legacy labels
		}

		return {
			tabId: tab.id,
			tabName: tab.name,
			workspacePath,
			subMeshDrawCallMap,
			trianglelistDedupedData: parsedTrianglelist,
			drawIBAliasMap,
			drawIBOrderMap,
			drawIBKeysByLengthDesc: Object.keys(drawIBOrderMap).sort((a, b) => b.length - a.length),
			drawIBComponentMap,
		};
	} catch (error) {
		console.warn(`${logPrefix} skip workspace mark texture source`, {
			tabId: tab.id,
			tabName: tab.name,
			workspacePath,
			error,
		});
		return undefined;
	}
};

const saveSelectionMemory = async () => {
	try {
		const configPath = await getSelectionMemoryConfigPath();
		if (!configPath) {
			return;
		}
		const configDir = await dirname(configPath);
		await mkdir(configDir, { recursive: true });
		const payload: MarkTextureSelectionMemory = {
			subMesh: selectedSubMesh.value,
			drawCall: selectedDrawCall.value,
			drawCallBySubMesh: drawCallSelectionBySubMesh.value,
		};
		await writeTextFile(configPath, JSON.stringify(payload, null, 2));
	} catch {
		// Silent failure: do not affect interaction flow.
	}
};

const saveGlobalUiConfig = async () => {
	try {
		const configPath = await getGlobalUiConfigPath();
		const configDir = await dirname(configPath);
		await mkdir(configDir, { recursive: true });
		const payload: MarkTextureGlobalUiConfig = {
			showUnrenderedTextures: showUnrenderedTextures.value,
			rgbaPreviewCardSize: clampRgbaPreviewCardSize(rgbaPreviewCardSize.value),
		};
		await writeTextFile(configPath, JSON.stringify(payload, null, 2));
	} catch {
		// Silent failure: do not affect interaction flow.
	}
};

const scheduleSaveSelectionMemory = () => {
	if (selectionMemorySaveTimer) {
		clearTimeout(selectionMemorySaveTimer);
	}

	selectionMemorySaveTimer = setTimeout(() => {
		void saveSelectionMemory();
	}, 200);
};

const scheduleSaveGlobalUiConfig = () => {
	if (workspaceUiConfigSaveTimer) {
		clearTimeout(workspaceUiConfigSaveTimer);
	}

	workspaceUiConfigSaveTimer = setTimeout(() => {
		void saveGlobalUiConfig();
	}, 200);
};

const loadPresetMarkOptions = async () => {
	try {
		const config = await ResourceManager.loadGameConfig(currentGameName.value);
		const preset = (config?.gamePreset || 'DEFAULT').toUpperCase();
		gamePreset.value = preset;
	} catch {
		gamePreset.value = 'DEFAULT';
	}
	refreshCustomMarkNameOptions();
};

const loadSubMeshOptions = async () => {
	console.log(`${logPrefix} loadSubMeshOptions start`);
	try {
		const workspacePath = await getWorkspacePath();
		if (!workspacePath) {
			console.warn(`${logPrefix} workspacePath unavailable, clear SubMesh options`);
			workspaceSources.value = [];
			subMeshOptions.value = [];
			drawCallOptions.value = [];
			selectedSubMesh.value = '';
			selectedDrawCall.value = '';
			textureList.value = [];
			ElMessage.info(t('markTexture.messages.noCurrentWorkspaceDetected'));
			return;
		}

		const tabsIndexPath = await join(workspacePath, 'Config', 'WorkPageTabs.json');
		const tabsIndexContent = await readTextFile(tabsIndexPath);
		const tabsIndex = JSON.parse(tabsIndexContent) as WorkPageTabsIndex;
		const tabs = Array.isArray(tabsIndex.tabs)
			? tabsIndex.tabs
				.filter(tab => !!tab && typeof tab.id === 'string' && typeof tab.name === 'string')
				.map(tab => ({ id: tab.id.trim(), name: tab.name.trim() || tab.id.trim() }))
				.filter(tab => tab.id.length > 0)
			: [];

		const sources = (
			await Promise.all(
				tabs.map(async tab => {
					const workspaceLodPath = await resolveWorkspaceLodPathForTab(workspacePath, tab.name);
					return loadWorkspaceMarkTextureSource(workspaceLodPath, tab);
				})
			)
		).filter((item): item is WorkspaceMarkTextureSource => !!item);

		workspaceSources.value = sources;
		const nextSubMeshOptions = sources
			.flatMap(source => {
				return Object.keys(source.subMeshDrawCallMap)
					.sort((a, b) => {
						const orderCompare = getSubMeshSortOrder(source, a) - getSubMeshSortOrder(source, b);
						if (orderCompare !== 0) {
							return orderCompare;
						}

						// 使用 DrawIB-Component.json 的 ComponentIndex 数值排序
						const compA = source.drawIBComponentMap[a];
						const compB = source.drawIBComponentMap[b];
						if (compA && compB) {
							const drawIBCompare = naturalCompare(compA.drawIB, compB.drawIB);
							if (drawIBCompare !== 0) {
								return drawIBCompare;
							}
							return parseInt(compA.componentIndex, 10) - parseInt(compB.componentIndex, 10);
						}

						return naturalCompare(a, b);
					})
					.map(subMeshName => serializeSubMeshSelection(source.tabId, subMeshName));
			});

		subMeshOptions.value = nextSubMeshOptions;

		if (
			pendingRestoreSubMesh.value &&
			subMeshOptions.value.includes(pendingRestoreSubMesh.value)
		) {
			selectedSubMesh.value = pendingRestoreSubMesh.value;
			pendingRestoreSubMesh.value = '';
		} else if (!selectedSubMesh.value || !subMeshOptions.value.includes(selectedSubMesh.value)) {
			selectedSubMesh.value = subMeshOptions.value[0] ?? '';
		}

		syncDrawCallOptionsBySubMesh();
		const restoredDrawCall = resolveDrawCallSelectionValue(
			pendingRestoreDrawCall.value,
			drawCallOptions.value
		);
		if (restoredDrawCall) {
			selectedDrawCall.value = restoredDrawCall;
			rememberCurrentDrawCallSelection();
		}
		pendingRestoreDrawCall.value = '';

		console.log(`${logPrefix} submeshes loaded`, {
			count: subMeshOptions.value.length,
			selectedSubMesh: selectedSubMesh.value,
		});

		if (subMeshOptions.value.length === 0) {
			ElMessage.warning(t('markTexture.messages.noSubMeshConfigEntries'));
		}

		await refreshSubMeshMarkedTextureSummary();
	} catch (error) {
		workspaceSources.value = [];
		subMeshOptions.value = [];
		drawCallOptions.value = [];
		subMeshMarkedTextureMap.value = {};
		selectedSubMesh.value = '';
		selectedDrawCall.value = '';
		textureList.value = [];
		ElMessage.warning(t('markTexture.messages.loadSubMeshListFailed'));
		console.error(`${logPrefix} loadSubMeshOptions failed`, error);
	}
};

const getPixelSlotFromTextureFileName = (textureFileName: string): string => {
	const startPos = textureFileName.indexOf('-');
	const endPos = textureFileName.indexOf('=');
	if (startPos < 0 || endPos < 0 || endPos <= startPos + 1) {
		return '';
	}

	let pixelSlot = textureFileName.slice(startPos + 1, endPos);
	if (pixelSlot.includes('-vs')) {
		const lastDash = pixelSlot.lastIndexOf('-');
		if (lastDash > 0) {
			pixelSlot = pixelSlot.slice(0, lastDash);
		}
	}

	return pixelSlot;
};

const getImageSize = (previewUrl: string): Promise<string> => {
	if (!previewUrl) {
		return Promise.resolve('-');
	}

	return new Promise(resolve => {
		const img = new Image();
		img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
		img.onerror = () => resolve('-');
		img.src = previewUrl;
	});
};

const buildTexturePreviewUrl = async (
	workspacePath: string,
	fileName: string,
	cacheBustToken: number
): Promise<string> => {
	if (!fileName) {
		return '';
	}

	const filePath = await join(workspacePath, 'DedupedTextures_jpg', fileName);
	if (!(await exists(filePath))) {
		return '';
	}

	return `${convertFileSrc(filePath)}?t=${cacheBustToken}`;
};

const createEmptyChannelPreviews = (): TextureChannelPreview[] => {
	return textureChannelKeys.map(key => ({
		key,
		label: key,
		preview: '',
	}));
};

const nextMarkedTexturePreviewCacheBustToken = (): number => {
	markedTexturePreviewCacheSeed += 1;
	return Date.now() + markedTexturePreviewCacheSeed;
};

const getTextureEntriesForDrawCall = (
	source: WorkspaceMarkTextureSource,
	drawCall: string
): Array<[string, TrianglelistDedupedTextureProperty]> => {
	return Object.entries(source.trianglelistDedupedData)
		.filter(([textureFileName]) => textureFileName.startsWith(drawCall))
		.sort((a, b) => naturalCompare(a[0], b[0]));
};

const getVisibleTextureEntriesForDrawCall = (
	source: WorkspaceMarkTextureSource,
	drawCall: string
): Array<[string, TrianglelistDedupedTextureProperty]> => {
	const entries = getTextureEntriesForDrawCall(source, drawCall);
	if (showUnrenderedTextures.value) {
		return entries;
	}

	return entries.filter(([, textureProperty]) => (textureProperty?.FADataDedupedFileName || '').trim().length > 0);
};

const isBrowserPreviewFileName = (fileName: string): boolean => {
	return /\.(jpe?g|png|webp|gif|bmp)$/i.test(fileName);
};

const getAppliedTexturePreviewUrl = async (
	folderPath: string,
	markFileName: string,
	cacheBustToken: number
): Promise<string> => {
	if (!folderPath || !markFileName) {
		return '';
	}

	const jpgFileName = markFileName.replace(/\.[^.]+$/, '.jpg');
	const previewCandidates = [
		jpgFileName,
		...(isBrowserPreviewFileName(markFileName) && markFileName !== jpgFileName ? [markFileName] : []),
	];

	for (const candidate of previewCandidates) {
		const filePath = await join(folderPath, candidate);
		if (await exists(filePath)) {
			return `${convertFileSrc(filePath)}?t=${cacheBustToken}`;
		}
	}

	return '';
};

const findAppliedTextureSourceEntry = (
	source: WorkspaceMarkTextureSource,
	subMeshName: string,
	markDedupedFileName: string,
	markHash: string,
	markSlot: string
): [string, TrianglelistDedupedTextureProperty] | undefined => {
	const drawCalls = source.subMeshDrawCallMap[subMeshName] ?? [];
	const normalizedMarkDedupedFileName = markDedupedFileName.trim().toLowerCase();
	const normalizedMarkHash = markHash.trim().toLowerCase();
	const normalizedMarkSlot = markSlot.trim().toLowerCase();

	for (const drawCall of drawCalls) {
		const entries = getTextureEntriesForDrawCall(source, drawCall);
		const matchedByDedupedFileName = entries.find(([, textureProperty]) => {
			const dedupedFileName = (textureProperty?.FALogDedupedFileName || '').trim().toLowerCase();
			return !!normalizedMarkDedupedFileName && dedupedFileName === normalizedMarkDedupedFileName;
		});
		if (matchedByDedupedFileName) {
			return matchedByDedupedFileName;
		}

		const matchedByHash = entries.find(([textureFileName]) => {
			const fileHash = SSMTStringUtils.getFileHashFromFileName(textureFileName).trim().toLowerCase();
			return !!normalizedMarkHash && fileHash === normalizedMarkHash;
		});
		if (matchedByHash) {
			return matchedByHash;
		}

		const matchedBySlot = entries.find(([textureFileName]) => {
			const slot = getPixelSlotFromTextureFileName(textureFileName).trim().toLowerCase();
			return !!normalizedMarkSlot && slot === normalizedMarkSlot;
		});
		if (matchedBySlot) {
			return matchedBySlot;
		}
	}

	return undefined;
};

const getAppliedTextureDedupedPreviewUrl = async (
	source: WorkspaceMarkTextureSource,
	subMeshName: string,
	markDedupedFileName: string,
	markHash: string,
	markSlot: string,
	cacheBustToken: number
): Promise<string> => {
	const directDedupedFileName = markDedupedFileName.trim();
	if (directDedupedFileName) {
		return buildTexturePreviewUrl(
			source.workspacePath,
			directDedupedFileName.replace(/\.[^.]+$/, '.jpg'),
			cacheBustToken
		);
	}

	const sourceEntry = findAppliedTextureSourceEntry(
		source,
		subMeshName,
		markDedupedFileName,
		markHash,
		markSlot
	);
	const dedupedFileName = (sourceEntry?.[1]?.FALogDedupedFileName || '').trim();
	if (!dedupedFileName) {
		return '';
	}

	return buildTexturePreviewUrl(
		source.workspacePath,
		dedupedFileName.replace(/\.[^.]+$/, '.jpg'),
		cacheBustToken
	);
};

const resolveDrawCallSelectionForAppliedMark = (
	source: WorkspaceMarkTextureSource,
	subMeshName: string,
	markDedupedFileName: string,
	markHash: string,
	markSlot: string
): string => {
	const drawCalls = source.subMeshDrawCallMap[subMeshName] ?? [];
	const normalizedMarkDedupedFileName = markDedupedFileName.trim().toLowerCase();
	const normalizedMarkHash = markHash.trim().toLowerCase();
	const normalizedMarkSlot = markSlot.trim().toLowerCase();

	for (const drawCall of drawCalls) {
		const entries = getTextureEntriesForDrawCall(source, drawCall);
		const matched = entries.some(([textureFileName, textureProperty]) => {
			const dedupedFileName = (textureProperty?.FALogDedupedFileName || '').trim().toLowerCase();
			const fileHash = SSMTStringUtils.getFileHashFromFileName(textureFileName).trim().toLowerCase();
			const slot = getPixelSlotFromTextureFileName(textureFileName).trim().toLowerCase();
			return (
				(!!normalizedMarkDedupedFileName && dedupedFileName === normalizedMarkDedupedFileName) ||
				(!!normalizedMarkHash && fileHash === normalizedMarkHash) ||
				(!!normalizedMarkSlot && slot === normalizedMarkSlot)
			);
		});

		if (matched) {
			return serializeDrawCallSelection(source.tabId, subMeshName, drawCall);
		}
	}

	return drawCalls[0]
		? serializeDrawCallSelection(source.tabId, subMeshName, drawCalls[0])
		: '';
};

const buildMarkedTextureSummaryForSubMesh = async (
	source: WorkspaceMarkTextureSource,
	subMeshName: string,
	cacheBustToken: number
): Promise<SubMeshMarkedTextureSummary[]> => {
	const appliedMarks = await readAppliedSubMeshTextureMarks({
		workspacePath: source.workspacePath,
		subMesh: subMeshName,
	});

	return Promise.all(
		appliedMarks.map(async mark => {
			const id = [
				source.tabId,
				subMeshName,
				mark.markFileName,
				mark.markName,
				mark.markStyle,
				mark.markHash,
				mark.markSlot,
			].join('-');
			const sourcePreview = await getAppliedTextureDedupedPreviewUrl(
				source,
				subMeshName,
				mark.markDedupedFileName,
				mark.markHash,
				mark.markSlot,
				cacheBustToken
			);
			const copiedPreview = sourcePreview
				? ''
				: await getAppliedTexturePreviewUrl(
					mark.folderPath,
					mark.markFileName,
					cacheBustToken
				);

			return {
				id,
				drawCallSelectionValue: resolveDrawCallSelectionForAppliedMark(
					source,
					subMeshName,
					mark.markDedupedFileName,
					mark.markHash,
					mark.markSlot
				),
				preview: sourcePreview || copiedPreview,
				previewKey: `${id}-${cacheBustToken}`,
				textureName: mark.markFileName,
				dedupedFileName: mark.markDedupedFileName,
				slot: mark.markSlot,
				markName: mark.markName,
				markStyle: mark.markStyle,
				status: 'applied',
				textureHash: mark.markHash,
			};
		})
	);
};

const buildPendingTextureSummaryForCurrentSubMesh = (): SubMeshMarkedTextureSummary[] => {
	const source = getSelectedWorkspaceSource();
	const subMeshName = getSelectedSubMeshName();
	const drawCallSelectionValue = selectedDrawCall.value;
	if (!source || !subMeshName || !selectedSubMesh.value || !drawCallSelectionValue) {
		return [];
	}

	return textureList.value
		.filter(item => item.markName.trim())
		.map(item => ({
			id: [
				source.tabId,
				subMeshName,
				selectedDrawCall.value,
				item.name,
				item.markName,
				item.markStyle,
				'pending',
			].join('-'),
			drawCallSelectionValue,
			preview: item.preview,
			previewKey: `${item.id}-${item.preview}`,
			textureName: item.name,
			dedupedFileName: item.dedupedFileName,
			slot: item.slot,
			markName: item.markName,
			markStyle: item.markStyle,
			status: 'pending' as const,
			textureHash: SSMTStringUtils.getFileHashFromFileName(item.name),
		}));
};

const dedupeTextureSummaryByIdentity = (items: SubMeshMarkedTextureSummary[]): SubMeshMarkedTextureSummary[] => {
	const summaryMap = new Map<string, SubMeshMarkedTextureSummary>()

	for (const item of items) {
		const dedupedKey = item.dedupedFileName.trim().toLowerCase()
		const hashKey = item.textureHash.trim().toLowerCase()
		const slotKey = item.slot.trim().toLowerCase()
		const identityKey = dedupedKey
			? `deduped::${dedupedKey}`
			: hashKey
				? `hash::${hashKey}`
				: slotKey
					? `slot::${slotKey}`
					: ''
		if (!identityKey) {
			continue
		}

		summaryMap.set(identityKey, item)
	}

	return Array.from(summaryMap.values())
};

const syncPendingTextureSummaryForCurrentSubMesh = () => {
	if (!selectedSubMesh.value) {
		return;
	}

	const existing = subMeshMarkedTextureMap.value[selectedSubMesh.value] ?? [];
	const applied = existing.filter(summary => summary.status === 'applied');
	const appliedKeys = new Set(
		applied.flatMap(summary => [
			`${summary.markName}::deduped::${summary.dedupedFileName}`.toLowerCase(),
			`${summary.markName}::hash::${summary.textureHash}`.toLowerCase(),
			`${summary.markName}::slot::${summary.slot}`.toLowerCase(),
		])
	);
	const pending = buildPendingTextureSummaryForCurrentSubMesh().filter(summary => {
		const dedupedKey = `${summary.markName}::deduped::${summary.dedupedFileName}`.toLowerCase();
		const hashKey = `${summary.markName}::hash::${summary.textureHash}`.toLowerCase();
		const slotKey = `${summary.markName}::slot::${summary.slot}`.toLowerCase();
		return !appliedKeys.has(dedupedKey) && !appliedKeys.has(hashKey) && !appliedKeys.has(slotKey);
	});

	subMeshMarkedTextureMap.value = {
		...subMeshMarkedTextureMap.value,
		[selectedSubMesh.value]: dedupeTextureSummaryByIdentity([...applied, ...pending]),
	};
};

const refreshSubMeshMarkedTextureSummary = async (selectionValue?: string) => {
	const nextMap = selectionValue
		? { ...subMeshMarkedTextureMap.value }
		: {};
	const targetValues = selectionValue ? [selectionValue] : subMeshOptions.value;
	const cacheBustToken = nextMarkedTexturePreviewCacheBustToken();

	await Promise.all(
		targetValues.map(async value => {
			const parsed = parseSubMeshSelection(value);
			const source = parsed
				? workspaceSources.value.find(item => item.tabId === parsed.tabId)
				: undefined;

			if (!parsed || !source) {
				delete nextMap[value];
				return;
			}

			nextMap[value] = await buildMarkedTextureSummaryForSubMesh(
				source,
				parsed.subMeshName,
				cacheBustToken
			);
		})
	);

	subMeshMarkedTextureMap.value = nextMap;
	syncPendingTextureSummaryForCurrentSubMesh();
};

const invalidateSubMeshMarkedTextureSummaryCache = (selectionValue: string) => {
	if (!selectionValue) {
		return;
	}

	subMeshMarkedTextureMap.value = {
		...subMeshMarkedTextureMap.value,
		[selectionValue]: [],
	};
};

const naturalCompare = (left: string, right: string): number => {
	return left.localeCompare(right, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
};

const setPreviewImageVisibility = (event: Event, visible: boolean) => {
	const target = event.target;
	if (!(target instanceof HTMLImageElement)) {
		return;
	}

	target.style.opacity = visible ? '1' : '0';
};

const handlePreviewImageLoad = (event: Event) => {
	setPreviewImageVisibility(event, true);
};

const handlePreviewImageError = (event: Event) => {
	setPreviewImageVisibility(event, false);
};

const handleTextureMarkChanged = () => {
	scheduleSaveTextureMemory();
	syncPendingTextureSummaryForCurrentSubMesh();
};

const rememberCustomMarkName = (markName: string) => {
	const normalizedName = markName.trim();
	if (!normalizedName || isPresetMarkName(normalizedName)) {
		return;
	}

	addCustomTextureMarkName(gamePreset.value, normalizedName);
	refreshCustomMarkNameOptions();
};

const handleTextureMarkNameChanged = (markName: string) => {
	rememberCustomMarkName(markName);
	handleTextureMarkChanged();
};

const handleRemoveCustomMarkName = (event: MouseEvent, markName: string) => {
	event.preventDefault();
	event.stopPropagation();

	if (removeCustomTextureMarkName(gamePreset.value, markName)) {
		refreshCustomMarkNameOptions();
		ElMessage.success(t('markTexture.messages.customMarkNameDeleted'));
	}
};

const openChannelPreviewCard = (item: TextureItem) => {
	ensureRgbaPreviewCardSize();
	activeChannelPreviewItem.value = item;
};

const closeChannelPreviewCard = () => {
	activeChannelPreviewItem.value = null;
};

const stopRgbaPreviewResize = () => {
	rgbaPreviewResizeCleanup?.();
	rgbaPreviewResizeCleanup = undefined;
};

const startRgbaPreviewResize = (event: PointerEvent) => {
	event.preventDefault();
	event.stopPropagation();

	ensureRgbaPreviewCardSize();
	const startPointerX = event.clientX;
	const startPointerY = event.clientY;
	const startSize = rgbaPreviewCardSize.value;

	const handlePointerMove = (moveEvent: PointerEvent) => {
		const deltaX = moveEvent.clientX - startPointerX;
		const deltaY = moveEvent.clientY - startPointerY;
		const nextSize = startSize + Math.max(deltaX, deltaY);
		rgbaPreviewCardSize.value = clampRgbaPreviewCardSize(nextSize);
	};

	const handlePointerUp = () => {
		stopRgbaPreviewResize();
		scheduleSaveGlobalUiConfig();
	};

	window.addEventListener('pointermove', handlePointerMove);
	window.addEventListener('pointerup', handlePointerUp);
	window.addEventListener('pointercancel', handlePointerUp);

	rgbaPreviewResizeCleanup = () => {
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		window.removeEventListener('pointercancel', handlePointerUp);
	};
};

const handleRgbaPreviewWheel = (event: WheelEvent) => {
	event.preventDefault();
	event.stopPropagation();

	ensureRgbaPreviewCardSize();
	const wheelDelta = event.deltaY;
	if (!Number.isFinite(wheelDelta) || wheelDelta === 0) {
		return;
	}

	const resizeStep = Math.max(24, Math.round(rgbaPreviewCardSize.value * 0.06));
	const nextSize = wheelDelta < 0
		? rgbaPreviewCardSize.value + resizeStep
		: rgbaPreviewCardSize.value - resizeStep;

	rgbaPreviewCardSize.value = clampRgbaPreviewCardSize(nextSize);
	scheduleSaveGlobalUiConfig();
};

const syncRgbaPreviewCardSizeToViewport = () => {
	rgbaPreviewCardSize.value = clampRgbaPreviewCardSize(rgbaPreviewCardSize.value);
};

const getTextureSuffixFromFileName = (textureFileName: string): string => {
	const lastDot = textureFileName.lastIndexOf('.');
	if (lastDot < 0) {
		return '';
	}
	return textureFileName.slice(lastDot);
};

const loadTextureMemoryForCurrentList = async (loadToken = textureListLoadToken) => {
	if (textureList.value.length === 0) {
		return;
	}

	const psHash = textureList.value[0].ps_hash;
	if (!psHash) {
		return;
	}

	try {
		console.log(`${logPrefix} trying load texture memory`, { psHash });
		const parsed = await loadTextureMemoryByPSHash(currentGameName.value, psHash);
		if (!parsed) {
			return;
		}

		isApplyingTextureMemory.value = true;
		if (loadToken !== textureListLoadToken) {
			return;
		}
		textureList.value = applyTextureMemoryToItems(textureList.value, parsed);
		console.log(`${logPrefix} texture memory loaded`, { psHash, count: textureList.value.length });
	} catch (error) {
		console.log(`${logPrefix} texture memory not found or invalid, skip`, { psHash, error });
	} finally {
		setTimeout(() => {
			isApplyingTextureMemory.value = false;
		}, 0);
	}
};

const saveTextureMemoryForCurrentList = async () => {
	if (textureList.value.length === 0) {
		return;
	}

	const psHash = textureList.value[0].ps_hash;
	if (!psHash) {
		return;
	}

	try {
		await saveTextureMemoryByPSHash(currentGameName.value, psHash, textureList.value);
		console.log(`${logPrefix} texture memory saved`, { psHash, count: textureList.value.length });
	} catch (error) {
		console.warn(`${logPrefix} failed to save texture memory`, { psHash, error });
	}
};

const resetCurrentTextureListMarks = () => {
	const defaultMarkStyle: MarkStyle = appSettings.textureMarkStylePreference === 'Slot' ? 'Slot' : 'Hash';
	textureList.value = textureList.value.map(item => ({
		...item,
		markName: '',
		markStyle: defaultMarkStyle,
	}));
};

const scheduleSaveTextureMemory = () => {
	if (isApplyingTextureMemory.value) {
		return;
	}

	if (textureMemorySaveTimer) {
		clearTimeout(textureMemorySaveTimer);
	}

	textureMemorySaveTimer = setTimeout(() => {
		void saveTextureMemoryForCurrentList();
	}, 250);
};

const loadTextureListByDrawCall = async (drawCallSelectionValue: string) => {
	const loadToken = ++textureListLoadToken;
	const drawCallSelection = parseDrawCallSelection(drawCallSelectionValue);
	const drawCall = drawCallSelection?.drawCall || '';
	const selectedSubMeshAtStart = selectedSubMesh.value;
	console.log(`${logPrefix} loadTextureListByDrawCall start`, {
		subMesh: selectedSubMeshAtStart,
		drawCallSelectionValue,
		drawCall,
	});

	if (!selectedSubMeshAtStart || !drawCallSelection || !drawCall) {
		textureList.value = [];
		return;
	}

	try {
		const source = getSelectedWorkspaceSource();
		const subMeshName = getSelectedSubMeshName();
		if (
			!source ||
			!subMeshName ||
			drawCallSelection.tabId !== source.tabId ||
			drawCallSelection.subMeshName !== subMeshName
		) {
			if (loadToken !== textureListLoadToken) {
				return;
			}
			textureList.value = [];
			return;
		}

		const matchedEntries = getVisibleTextureEntriesForDrawCall(source, drawCall);
		const previewCacheBustToken = Date.now();

		const nextTextureList: TextureItem[] = await Promise.all(
			matchedEntries.map(async ([textureFileName, textureProperty], index) => {
				const defaultMarkStyle: MarkStyle =
					appSettings.textureMarkStylePreference === 'Slot' ? 'Slot' : 'Hash';
				const faLogDedupedFileName = (textureProperty?.FALogDedupedFileName || '').trim();
				const render = (textureProperty?.FADataDedupedFileName || '').trim().length > 0;
				const dedupedBaseName = faLogDedupedFileName
					? faLogDedupedFileName.replace(/\.[^.]+$/, '')
					: '';

				let preview = '';
				let size = '-';
				let channelPreviews = createEmptyChannelPreviews();
				if (dedupedBaseName) {
					preview = await buildTexturePreviewUrl(
						source.workspacePath,
						`${dedupedBaseName}.jpg`,
						previewCacheBustToken
					);
					channelPreviews = await Promise.all(
						textureChannelKeys.map(async key => ({
							key,
							label: key,
							preview: await buildTexturePreviewUrl(
								source.workspacePath,
								`${dedupedBaseName}_${key}.jpg`,
								previewCacheBustToken
							),
						}))
					);
					size = await getImageSize(preview);
				}

				return {
					id: `${source.tabId}-${subMeshName}-${drawCall}-${index}`,
					name: textureFileName,
					dedupedFileName: faLogDedupedFileName,
					slot: getPixelSlotFromTextureFileName(textureFileName),
					ps_hash: SSMTStringUtils.getPSHashFromFileName(textureFileName),
					render,
					suffix: getTextureSuffixFromFileName(textureFileName),
					size,
					preview,
					channelPreviews,
					markName: '',
					markStyle: defaultMarkStyle,
				};
			})
		);

		if (
			loadToken !== textureListLoadToken ||
			selectedSubMesh.value !== selectedSubMeshAtStart ||
			selectedDrawCall.value !== drawCallSelectionValue
		) {
			return;
		}
			
		textureList.value = nextTextureList;
		await loadTextureMemoryForCurrentList(loadToken);
		if (loadToken !== textureListLoadToken) {
			return;
		}
		console.log(`${logPrefix} texture list loaded`, {
			count: nextTextureList.length,
			drawCall,
		});
	} catch (error) {
		if (loadToken !== textureListLoadToken) {
			return;
		}
		console.warn(`${logPrefix} failed to load TrianglelistDedupedFileName.json`, error);
		textureList.value = [];
	}
};

const getDrawCallTextureItemCount = (
	source: WorkspaceMarkTextureSource,
	drawCall: string
): number => {
	if (!drawCall) {
		return 0;
	}

	return getTextureEntriesForDrawCall(source, drawCall).length;
};

const getPreferredDrawCallSelectionValue = (
	source: WorkspaceMarkTextureSource | undefined,
	subMeshName: string,
	options: string[]
): string | undefined => {
	if (!source || !subMeshName || options.length === 0) {
		return undefined;
	}

	let preferredSelectionValue = options[0];
	let maxTextureItemCount = -1;

	for (const selectionValue of options) {
		const parsed = parseDrawCallSelection(selectionValue);
		if (!parsed || parsed.tabId !== source.tabId || parsed.subMeshName !== subMeshName) {
			continue;
		}

		const textureItemCount = getDrawCallTextureItemCount(source, parsed.drawCall);
		if (textureItemCount > maxTextureItemCount) {
			maxTextureItemCount = textureItemCount;
			preferredSelectionValue = selectionValue;
		}
	}

	return preferredSelectionValue;
};

const syncDrawCallOptionsBySubMesh = (options?: { preferCurrentSelection?: boolean }) => {
	const source = getSelectedWorkspaceSource();
	const subMeshName = getSelectedSubMeshName();
	const drawCalls = source && subMeshName ? source.subMeshDrawCallMap[subMeshName] ?? [] : [];
	const nextDrawCallOptions = source && subMeshName
		? drawCalls
			.filter(drawCall => getDrawCallTextureItemCount(source, drawCall) > 0)
			.map(drawCall => serializeDrawCallSelection(source.tabId, subMeshName, drawCall))
		: [];
	drawCallOptions.value = nextDrawCallOptions;

	const shouldPreferCurrentSelection = options?.preferCurrentSelection !== false;
	const nextSelectedDrawCall = shouldPreferCurrentSelection
		? resolveDrawCallSelectionValue(selectedDrawCall.value, nextDrawCallOptions)
		: undefined;

	const rememberedSelection = getRememberedDrawCallSelectionForSubMesh(
		selectedSubMesh.value,
		nextDrawCallOptions
	);

	if (!nextSelectedDrawCall) {
		selectedDrawCall.value = rememberedSelection
			?? getPreferredDrawCallSelectionValue(source, subMeshName, nextDrawCallOptions)
			?? '';
	} else if (selectedDrawCall.value !== nextSelectedDrawCall) {
		selectedDrawCall.value = nextSelectedDrawCall;
	}

	rememberCurrentDrawCallSelection();

	console.log(`${logPrefix} drawcalls synced`, {
		subMesh: subMeshName,
		drawCallCount: drawCallOptions.value.length,
		selectedDrawCall: parseDrawCallSelection(selectedDrawCall.value)?.drawCall || '',
	});
};

const switchDrawCallByWheel = (event: WheelEvent) => {
	if (drawCallOptions.value.length <= 1) {
		return;
	}

	const currentIndex = Math.max(drawCallOptions.value.indexOf(selectedDrawCall.value), 0);
	const step = event.deltaY > 0 ? 1 : -1;

	let nextIndex = currentIndex + step;
	if (nextIndex < 0) {
		nextIndex = drawCallOptions.value.length - 1;
	} else if (nextIndex >= drawCallOptions.value.length) {
		nextIndex = 0;
	}

	selectedDrawCall.value = drawCallOptions.value[nextIndex] ?? selectedDrawCall.value;
};

const selectSubMeshFromDrawer = (selectionValue: string) => {
	rememberCurrentDrawCallSelection();
	selectedSubMesh.value = selectionValue;
};

const selectMarkedTextureSummary = (
	subMeshSelectionValue: string,
	summary: SubMeshMarkedTextureSummary
) => {
	rememberCurrentDrawCallSelection();
	pendingDrawerDrawCallSelection.value = summary.drawCallSelectionValue;
	selectedSubMesh.value = subMeshSelectionValue;
	selectedDrawCall.value = summary.drawCallSelectionValue;
	rememberDrawCallSelectionForSubMesh(subMeshSelectionValue, summary.drawCallSelectionValue);
};

const initializeMarkTexturePage = async () => {
	console.log(`${logPrefix} initializeMarkTexturePage start`);
	await Promise.all([loadSelectionMemory(), loadGlobalUiConfig()]);
	await Promise.all([loadPresetMarkOptions(), loadSubMeshOptions()]);
	console.log(`${logPrefix} initializeMarkTexturePage done`);
};

const revealTextureInDedupedFolder = async (item: TextureItem) => {
	const workspacePath = getSelectedWorkspaceSource()?.workspacePath;
	if (!workspacePath) {
		ElMessage.warning(t('markTexture.messages.currentWorkspaceFolderNotDetected'));
		return;
	}

	const dedupedFileName = item.dedupedFileName.trim();
	if (!dedupedFileName) {
		ElMessage.warning(t('markTexture.messages.currentEntryMissingDedupedFileName'));
		return;
	}

	const dedupedFolderPath = await join(workspacePath, 'DedupedTextures');
	const targetFilePath = await join(dedupedFolderPath, dedupedFileName);

	try {
		await revealItemInDir(targetFilePath);
	} catch (error) {
		console.error(`${logPrefix} reveal deduped texture failed`, {
			targetFilePath,
			error,
		});
		try {
			await openExternal(dedupedFolderPath);
		} catch {
			// Ignore fallback error and show unified feedback below.
		}
		ElMessage.error(t('markTexture.messages.revealTextureFailed'));
	}
};

const applyTextureMark = async () => {
	if (isApplyingAllDrawIBTextureMark.value) {
		return;
	}

	if (!selectedSubMesh.value) {
		ElMessage.warning(t('markTexture.messages.selectSubMeshFirst'));
		return;
	}

	const source = getSelectedWorkspaceSource();
	const subMeshName = getSelectedSubMeshName();
	if (!source || !subMeshName) {
		ElMessage.warning(t('markTexture.messages.currentWorkspaceFolderNotDetected'));
		return;
	}

	isApplyingAllDrawIBTextureMark.value = true;
	try {
		const result = await applyTextureMarkForCurrentSubMesh({
			workspacePath: source.workspacePath,
			tabId: source.tabId,
			subMesh: subMeshName,
			textureList: textureList.value,
		});

		if (result.appliedCount === 0) {
			ElMessage.warning(t('markTexture.messages.noApplicableTextureMarks'));
			return;
		}

		invalidateSubMeshMarkedTextureSummaryCache(selectedSubMesh.value);
		await refreshSubMeshMarkedTextureSummary(selectedSubMesh.value);
		ElMessage.success(
			t('markTexture.messages.applyCompleted', {
				count: result.appliedCount,
				subMesh: `[${source.tabName}] ${subMeshName}`,
				folders: result.targetFolderCount,
			})
		);
	} catch (error) {
		debugError('MarkTextureFull', 'applyTextureMark failed', error);
		ElMessage.error(t('markTexture.messages.applyTextureMarksFailed'));
	} finally {
		isApplyingAllDrawIBTextureMark.value = false;
	}
};

const cancelTextureMark = () => {
	if (isClearingCurrentDrawIBTextureMark.value) {
		return;
	}

	void (async () => {
		if (!selectedSubMesh.value) {
			ElMessage.warning(t('markTexture.messages.selectSubMeshFirst'));
			return;
		}

		const source = getSelectedWorkspaceSource();
		const subMeshName = getSelectedSubMeshName();
		if (!source || !subMeshName) {
			ElMessage.warning(t('markTexture.messages.currentWorkspaceFolderNotDetected'));
			return;
		}

		isClearingCurrentDrawIBTextureMark.value = true;
		try {
			const result = await clearCurrentSubMeshTextureMarkup({
				workspacePath: source.workspacePath,
				subMesh: subMeshName,
			});

			if (result.clearedFolderCount === 0) {
				ElMessage.warning(t('markTexture.messages.noImportJsonTargetDirectories'));
				return;
			}

			await refreshSubMeshMarkedTextureSummary(selectedSubMesh.value);
			ElMessage.success(t('markTexture.messages.clearedTextureMarks', { folders: result.clearedFolderCount }));
		} catch (error) {
			debugError('MarkTextureFull', 'cancelTextureMark failed', error);
			ElMessage.error(t('markTexture.messages.clearTextureMarksFailed'));
		} finally {
			isClearingCurrentDrawIBTextureMark.value = false;
		}
	})();
};

const deleteCurrentTextureMemory = async () => {
	if (isDeletingCurrentTextureConfig.value) {
		return;
	}

	const psHash = textureList.value[0]?.ps_hash?.trim() || '';
	if (!psHash) {
		ElMessage.warning(t('markTexture.messages.currentPsHashNotDetected'));
		return;
	}

	try {
		await ElMessageBox.confirm(
			t('markTexture.messages.confirmDeleteCurrentTextureConfig'),
			t('markTexture.dialog.deleteCurrentTextureConfigTitle'),
			{
				confirmButtonText: t('markTexture.common.confirm'),
				cancelButtonText: t('markTexture.common.cancel'),
				type: 'warning',
			}
		);
	} catch {
		return;
	}

	isDeletingCurrentTextureConfig.value = true;
	try {
		const deleted = await deleteTextureMemoryByPSHash(currentGameName.value, psHash);
		if (!deleted) {
			ElMessage.warning(t('markTexture.messages.textureConfigNotFoundForCurrentPsHash'));
			return;
		}

		resetCurrentTextureListMarks();
		ElMessage.success(t('markTexture.messages.deletedCurrentTextureConfig'));
	} catch (error) {
		debugError('MarkTextureFull', 'deleteCurrentTextureMemory failed', error);
		ElMessage.error(t('markTexture.messages.deleteCurrentTextureConfigFailed'));
	} finally {
		isDeletingCurrentTextureConfig.value = false;
	}
};

const deleteAllTextureConfigs = async () => {
	if (isDeletingAllTextureConfigs.value) {
		return;
	}

	const gameFolderName = getCurrentGameFolderName();
	let gameFolder: string;
	try {
		gameFolder = await GlobalConfig.TextureConfigsGameFolder(gameFolderName);
	} catch {
		ElMessage.error(t('markTexture.messages.unableToLocateTextureConfigFolder'));
		return;
	}

	try {
		await ElMessageBox.confirm(
			t('markTexture.messages.confirmDeleteAllTextureConfigs'),
			t('markTexture.dialog.deleteAllTextureConfigsTitle'),
			{
				confirmButtonText: t('markTexture.common.confirm'),
				cancelButtonText: t('markTexture.common.cancel'),
				type: 'warning',
			}
		);
	} catch {
		return;
	}

	isDeletingAllTextureConfigs.value = true;
	try {
		let entries: { name?: string }[];
		try {
			entries = await readDir(gameFolder);
		} catch {
			ElMessage.success(t('markTexture.messages.deletedAllTextureConfigs', { count: 0 }));
			return;
		}

		const jsonFiles = entries.filter(e => e.name?.endsWith('.json') && e.name);
		let deletedCount = 0;

		for (const entry of jsonFiles) {
			try {
				const filePath = await join(gameFolder, entry.name!);
				await moveFileToRecycleBin(filePath);
				deletedCount += 1;
			} catch {
				// skip individual file removal errors
			}
		}

		ElMessage.success(t('markTexture.messages.deletedAllTextureConfigs', { count: deletedCount }));
	} catch (error) {
		debugError('MarkTextureFull', 'deleteAllTextureConfigs failed', error);
		ElMessage.error(t('markTexture.messages.deleteAllTextureConfigsFailed'));
	} finally {
		isDeletingAllTextureConfigs.value = false;
	}
};

const updateCurrentDrawIBMarkStyle = async (markStyle: MarkStyle) => {
	if (isApplyingAllDrawIBTextureMark.value || isClearingCurrentDrawIBTextureMark.value || isUpdatingCurrentDrawIBMarkStyle.value) {
		return;
	}

	if (!selectedSubMesh.value) {
		ElMessage.warning(t('markTexture.messages.selectSubMeshFirst'));
		return;
	}

	const source = getSelectedWorkspaceSource();
	const subMeshName = getSelectedSubMeshName();
	if (!source || !subMeshName) {
		ElMessage.warning(t('markTexture.messages.currentWorkspaceFolderNotDetected'));
		return;
	}

	isUpdatingCurrentDrawIBMarkStyle.value = true;
	try {
		// Step 1: Update all items in the current list to the chosen style
		textureList.value = textureList.value.map(item => ({
			...item,
			markStyle,
		}));
		await saveTextureMemoryForCurrentList();

		// Step 2: Only apply to JSON files if the submesh already has existing marks
		const hasExistingMarks = await hasExistingSubMeshTextureMarks(
			source.workspacePath,
			subMeshName
		);

		if (hasExistingMarks) {
			await updateCurrentSubMeshTextureMarkupStyle({
				workspacePath: source.workspacePath,
				subMesh: subMeshName,
				markStyle,
			});
			await refreshSubMeshMarkedTextureSummary(selectedSubMesh.value);
		}

		ElMessage.success(
			t('markTexture.messages.updatedTextureMarksStyle', {
				style: markStyle,
				count: textureList.value.length,
			})
		);
	} catch (error) {
		debugError('MarkTextureFull', 'updateCurrentDrawIBMarkStyle failed', error);
		ElMessage.error(t('markTexture.messages.batchUpdateTextureMarkStyleFailed'));
	} finally {
		isUpdatingCurrentDrawIBMarkStyle.value = false;
	}
};

const exportHashStyleTextureModTemplate = async () => {
	if (
		isApplyingAllDrawIBTextureMark.value ||
		isClearingCurrentDrawIBTextureMark.value ||
		isUpdatingCurrentDrawIBMarkStyle.value ||
		isExportingHashTextureModTemplate.value ||
		isExportingSlotTextureModTemplate.value
	) {
		return;
	}

	if (!selectedSubMesh.value) {
		ElMessage.warning(t('markTexture.messages.selectSubMeshFirst'));
		return;
	}

	const source = getSelectedWorkspaceSource();
	const subMeshName = getSelectedSubMeshName();
	const drawCall = parseDrawCallSelection(selectedDrawCall.value)?.drawCall || '';
	if (!source || !subMeshName || !drawCall) {
		ElMessage.warning(t('markTexture.messages.selectDrawCallFirst'));
		return;
	}

	const drawIB = resolveDrawIBAlias(source, subMeshName) || subMeshName.split('-')[0]?.trim() || '';
	if (!drawIB) {
		ElMessage.warning(t('markTexture.messages.drawIBNotDetectedForCurrentSubMesh'));
		return;
	}

	const workspaceName = (appSettings.CurrentWorkSpace || '').trim();
	if (!workspaceName) {
		ElMessage.warning(t('markTexture.messages.currentWorkspaceFolderNotDetected'));
		return;
	}

	isExportingHashTextureModTemplate.value = true;
	try {
		const generatedModFolderPath = await PathHelper.GetWorkspaceGeneratedModFolderPath(workspaceName);
		if (!generatedModFolderPath) {
			ElMessage.error(t('markTexture.messages.generatedModFolderPathResolveFailed'));
			return;
		}

		const result = await exportHashStyleTextureModTemplateForCurrentSelection({
			workspacePath: source.workspacePath,
			generatedModFolderPath,
			tabId: source.tabId,
			drawIB,
			textureList: textureList.value,
			currentGameName: currentGameName.value,
		});

		if (result.exportedTextureCount <= 0) {
			ElMessage.warning(t('markTexture.messages.noHashTextureMarksToExport'));
			return;
		}

		await openExternal(result.generatedFolderPath);
		ElMessage.success(
			t('markTexture.messages.hashTextureModTemplateExported', {
				count: result.exportedTextureCount,
				drawIB: result.drawIB,
				skipped: result.skippedSlotStyleCount,
			})
		);
	} catch (error) {
		debugError('MarkTextureFull', 'exportHashStyleTextureModTemplate failed', error);
		ElMessage.error(t('markTexture.messages.exportHashTextureModTemplateFailed'));
	} finally {
		isExportingHashTextureModTemplate.value = false;
	}
};

const exportSlotStyleTextureModTemplate = async () => {
	if (
		isApplyingAllDrawIBTextureMark.value ||
		isClearingCurrentDrawIBTextureMark.value ||
		isUpdatingCurrentDrawIBMarkStyle.value ||
		isExportingHashTextureModTemplate.value ||
		isExportingSlotTextureModTemplate.value
	) {
		return;
	}

	if (!selectedSubMesh.value) {
		ElMessage.warning(t('markTexture.messages.selectSubMeshFirst'));
		return;
	}

	const source = getSelectedWorkspaceSource();
	const subMeshName = getSelectedSubMeshName();
	const drawCall = parseDrawCallSelection(selectedDrawCall.value)?.drawCall || '';
	if (!source || !subMeshName || !drawCall) {
		ElMessage.warning(t('markTexture.messages.selectDrawCallFirst'));
		return;
	}

	if (!canBuildSlotTemplateFromSubMesh(subMeshName)) {
		ElMessage.warning(t('markTexture.messages.invalidCurrentSubMeshForSlotTemplate'));
		return;
	}

	const workspaceName = (appSettings.CurrentWorkSpace || '').trim();
	if (!workspaceName) {
		ElMessage.warning(t('markTexture.messages.currentWorkspaceFolderNotDetected'));
		return;
	}

	isExportingSlotTextureModTemplate.value = true;
	try {
		const generatedModFolderPath = await PathHelper.GetWorkspaceGeneratedModFolderPath(workspaceName);
		if (!generatedModFolderPath) {
			ElMessage.error(t('markTexture.messages.generatedModFolderPathResolveFailed'));
			return;
		}

		const result = await exportSlotStyleTextureModTemplateForCurrentSelection({
			workspacePath: source.workspacePath,
			generatedModFolderPath,
			tabId: source.tabId,
			subMesh: subMeshName,
			textureList: textureList.value,
			gamePreset: gamePreset.value,
		});

		if (result.exportedTextureCount <= 0) {
			ElMessage.warning(t('markTexture.messages.noSlotTextureMarksToExport'));
			return;
		}

		await openExternal(result.generatedFolderPath);
		ElMessage.success(
			t('markTexture.messages.slotTextureModTemplateExported', {
				count: result.exportedTextureCount,
				subMesh: result.subMesh,
				skipped: result.skippedHashStyleCount,
			})
		);
	} catch (error) {
		debugError('MarkTextureFull', 'exportSlotStyleTextureModTemplate failed', error);
		ElMessage.error(t('markTexture.messages.exportSlotTextureModTemplateFailed'));
	} finally {
		isExportingSlotTextureModTemplate.value = false;
	}
};

onMounted(initializeMarkTexturePage);
onActivated(initializeMarkTexturePage);
onMounted(() => {
	ensureRgbaPreviewCardSize();
	window.addEventListener('resize', syncRgbaPreviewCardSizeToViewport);
});
onBeforeUnmount(() => {
	stopRgbaPreviewResize();
	window.removeEventListener('resize', syncRgbaPreviewCardSizeToViewport);
	/* Clear pending save timers */
	if (textureMemorySaveTimer) {
		clearTimeout(textureMemorySaveTimer);
		textureMemorySaveTimer = undefined;
	}
	if (selectionMemorySaveTimer) {
		clearTimeout(selectionMemorySaveTimer);
		selectionMemorySaveTimer = undefined;
	}
	if (workspaceUiConfigSaveTimer) {
		clearTimeout(workspaceUiConfigSaveTimer);
		workspaceUiConfigSaveTimer = undefined;
	}
});

watch(
	() => [appSettings.DBMTWorkFolder, appSettings.CurrentGameName, appSettings.CurrentWorkSpace],
	() => {
		console.log(`${logPrefix} workspace-related setting changed, reload SubMesh options`, {
			dbmtWorkFolder: appSettings.DBMTWorkFolder,
			currentGameName: appSettings.CurrentGameName,
			currentWorkSpace: appSettings.CurrentWorkSpace,
		});
		void loadSubMeshOptions();
	},
	{ immediate: false }
);

watch(
	() => selectedSubMesh.value,
	(newSubMesh) => {
		if (lastValidSubMeshSelection && lastValidDrawCallSelection) {
			rememberDrawCallSelectionForSubMesh(lastValidSubMeshSelection, lastValidDrawCallSelection);
		}
		lastValidSubMeshSelection = newSubMesh || '';
		lastValidDrawCallSelection = '';
		textureListLoadToken += 1;
		textureList.value = [];
		selectedDrawCall.value = '';
		syncDrawCallOptionsBySubMesh({ preferCurrentSelection: false });
		if (
			pendingDrawerDrawCallSelection.value &&
			drawCallOptions.value.includes(pendingDrawerDrawCallSelection.value)
		) {
			selectedDrawCall.value = pendingDrawerDrawCallSelection.value;
			rememberCurrentDrawCallSelection();
		}
		pendingDrawerDrawCallSelection.value = '';
	}
);

watch(
	() => selectedDrawCall.value,
	(newDrawCall) => {
		rememberCurrentDrawCallSelection();
		if (newDrawCall && selectedSubMesh.value && drawCallOptions.value.includes(newDrawCall)) {
			lastValidSubMeshSelection = selectedSubMesh.value;
			lastValidDrawCallSelection = newDrawCall;
		}
		void loadTextureListByDrawCall(newDrawCall);
	}
);

watch(
	() => textureList.value.map(item => `${item.id}:${item.markName}:${item.markStyle}`).join('|'),
	() => {
		syncPendingTextureSummaryForCurrentSubMesh();
	}
);

watch(
	() => [selectedSubMesh.value, selectedDrawCall.value],
	() => {
		scheduleSaveSelectionMemory();
	}
);

watch(
	() => showUnrenderedTextures.value,
	() => {
		scheduleSaveGlobalUiConfig();
		syncDrawCallOptionsBySubMesh();
		void loadTextureListByDrawCall(selectedDrawCall.value);
	}
);

</script>

<template>
	<div class="mark-texture-page">
		<div class="mark-layout">
			<section class="left-card">
				<div class="left-workspace">
					<div class="submesh-side-column">
						<nav class="submesh-drawer-list" aria-label="Submesh">
							<section
								v-for="subMesh in subMeshDrawerItems"
								:key="subMesh.value"
								class="submesh-drawer-item"
								:class="{ 'is-selected': subMesh.isSelected }"
							>
								<div class="submesh-drawer-row">
									<button
										class="submesh-select-btn"
										type="button"
										:title="subMesh.label"
										@click="selectSubMeshFromDrawer(subMesh.value)"
									>
										<span class="submesh-label">{{ subMesh.label }}</span>
										<span class="submesh-count">{{ subMesh.markCount }}</span>
									</button>
								</div>

								<div class="submesh-marked-list">
									<button
										v-for="summary in subMesh.markedTextures"
										:key="summary.id"
										class="submesh-marked-texture"
										type="button"
										:title="summary.textureName"
										@click="selectMarkedTextureSummary(subMesh.value, summary)"
									>
										<span class="submesh-mark-preview">
											<img
												:key="summary.previewKey"
												:src="summary.preview"
												:alt="summary.markName"
												:style="{ opacity: summary.preview ? 1 : 0 }"
												@load="handlePreviewImageLoad"
												@error="handlePreviewImageError"
											/>
										</span>
										<span class="submesh-mark-meta">
											<span class="submesh-mark-meta-row">
												<span class="submesh-mark-name">{{ summary.markName }}</span>
												<span
													class="submesh-mark-status"
													:class="summary.status === 'applied' ? 'is-applied' : 'is-pending'"
												>
													{{ summary.status === 'applied' ? '已应用' : '未应用' }}
												</span>
											</span>
											<span class="submesh-mark-style">{{ summary.markStyle }}</span>
										</span>
									</button>
									<div v-if="subMesh.markedTextures.length === 0" class="submesh-empty-mark">
										-
									</div>
								</div>
							</section>
						</nav>

						<SubmeshPostProcessPreview
							:key="selectedSubMesh"
							:workspace-path="getSelectedWorkspaceSource()?.workspacePath || ''"
							:sub-mesh-name="getSelectedSubMeshName()"
							:texture-options="previewTextureOptions"
							@data-type-changed="refreshSubMeshMarkedTextureSummary(selectedSubMesh)"
						/>
					</div>

					<div class="texture-editor-pane">
						<div class="texture-editor-toolbar">
							<div class="texture-drawcall-select" @wheel.prevent="switchDrawCallByWheel">
								<el-select
									v-model="selectedDrawCall"
									:placeholder="t('markTexture.ui.drawCall')"
									filterable
									popper-class="mark-texture-select-popper mark-texture-nav-popper"
								>
									<el-option
										v-for="item in drawCallOptionItems"
										:key="item.value"
										:label="item.label"
										:value="item.value"
									/>
								</el-select>
							</div>
						</div>

						<div class="texture-list">
							<article
								class="texture-item"
								v-for="item in textureList"
								:key="item.id"
							>
								<div class="texture-item-actions">
									<el-tooltip
										:content="t('markTexture.ui.viewRgbaChannels')"
										placement="top"
										:show-after="250"
									>
										<button
											type="button"
											class="texture-item-action-btn"
											:aria-label="t('markTexture.ui.viewRgbaChannels')"
											@click.stop="openChannelPreviewCard(item)"
										>
											<el-icon><Grid /></el-icon>
										</button>
									</el-tooltip>
									<el-tooltip
										:content="t('markTexture.ui.locateFileInDedupedTextures')"
										placement="top"
										:show-after="250"
									>
										<button
											type="button"
											class="texture-item-action-btn"
											:aria-label="t('markTexture.ui.locateFileInDedupedTextures')"
											@click.stop="revealTextureInDedupedFolder(item)"
										>
											<el-icon><View /></el-icon>
										</button>
									</el-tooltip>
								</div>
								<div class="preview-wrap">
									<img
										:src="item.preview"
										:alt="item.name"
										:style="{ opacity: item.preview ? 1 : 0 }"
										@load="handlePreviewImageLoad"
										@error="handlePreviewImageError"
									/>
								</div>

								<div class="texture-meta">
									<div class="meta-row name-row">
										<span class="label">{{ t('markTexture.ui.name') }}</span>
										<span class="value">{{ item.name }}</span>
									</div>

									<div class="meta-row">
										<span class="label">{{ t('markTexture.ui.slotSize') }}</span>
										<span class="value">{{ item.slot }} / {{ item.size }} / {{ t('markTexture.ui.render') }}: {{ item.render }}</span>
									</div>

									<div class="meta-row select-row">
										<span class="label">{{ t('markTexture.ui.markName') }}</span>
										<div class="mark-name-select-wrap">
											<el-select
												v-model="item.markName"
												@change="handleTextureMarkNameChanged(item.markName)"
												filterable
												allow-create
												default-first-option
												popper-class="mark-texture-select-popper mark-name-select-popper"
												:placeholder="t('markTexture.placeholders.selectOrEnterMarkName')"
											>
												<el-option
													:key="'__empty_mark_name'"
													:label="' '"
													:value="''"
												/>
												<el-option-group :label="t('markTexture.markNameGroups.preset')">
													<el-option
														v-for="name in presetMarkNameList"
														:key="`preset-${name}`"
														:label="name"
														:value="name"
													/>
												</el-option-group>
												<el-option-group
													v-if="hasCustomMarkNameOptions"
													:label="t('markTexture.markNameGroups.custom')"
												>
													<el-option
														v-for="customName in customMarkNameOptions"
														:key="`custom-${customName.name}`"
														:label="customName.name"
														:value="customName.name"
													>
														<div class="custom-mark-name-option">
															<span class="custom-mark-name-text">{{ customName.name }}</span>
															<button
																type="button"
																class="custom-mark-name-delete-button"
																:title="t('markTexture.actions.deleteCustomMarkName')"
																:aria-label="t('markTexture.actions.deleteCustomMarkName')"
																@mousedown.stop.prevent
																@click="handleRemoveCustomMarkName($event, customName.name)"
															>
																<el-icon><Delete /></el-icon>
															</button>
														</div>
													</el-option>
												</el-option-group>
											</el-select>
										</div>
									</div>

									<div class="meta-row select-row">
										<span class="label">{{ t('markTexture.ui.markStyle') }}</span>
										<div class="mark-style-select-wrap">
											<el-select
												v-model="item.markStyle"
												popper-class="mark-texture-select-popper"
												@change="handleTextureMarkChanged"
												:placeholder="t('markTexture.placeholders.selectMarkStyle')"
											>
												<el-option
													v-for="style in markStyleOptions"
													:key="style"
													:label="style"
													:value="style"
												/>
											</el-select>
											<span class="mark-style-selected-value">
												{{ item.markStyle || t('markTexture.placeholders.selectMarkStyle') }}
											</span>
										</div>
									</div>
								</div>
							</article>
						</div>
					</div>
				</div>
			</section>

			<div
				v-if="activeChannelPreviewItem"
				class="channel-preview-overlay"
				role="dialog"
				aria-modal="true"
				:aria-label="t('markTexture.ui.rgbaChannelPreview')"
				@click.self="closeChannelPreviewCard"
			>
				<div
					class="channel-preview-modal"
					:style="rgbaPreviewCardStyle"
					@click.stop
					@wheel.prevent="handleRgbaPreviewWheel"
				>
					<button
						class="channel-preview-close-btn"
						type="button"
						aria-label="Close RGBA preview"
						@click="closeChannelPreviewCard"
					>
						x
					</button>

					<div class="channel-preview-modal-grid">
						<div
							v-for="channel in activeChannelPreviewItem.channelPreviews"
							:key="`${activeChannelPreviewItem.id}-${channel.key}`"
							class="channel-modal-card"
						>
							<div class="channel-modal-card-label">{{ channel.label.toUpperCase() }}</div>
							<div class="channel-modal-card-preview">
								<img
									:src="channel.preview"
									:alt="channel.key"
									:style="{ opacity: channel.preview ? 1 : 0 }"
									@load="handlePreviewImageLoad"
									@error="handlePreviewImageError"
								/>
							</div>
						</div>
					</div>

					<div
						class="channel-preview-resize-handle"
						role="presentation"
						@pointerdown="startRgbaPreviewResize"
					/>
				</div>
			</div>

			<aside class="right-card glass-scrollbar">
				<div class="menu-stack">
					<div class="filter-toggle-row">
						<span class="filter-toggle-label">{{ t('markTexture.ui.showUnrenderedTextures') }}</span>
						<el-switch
							v-model="showUnrenderedTextures"
						/>
					</div>

					<el-button
						type="primary"
						:loading="isApplyingAllDrawIBTextureMark"
						:disabled="isClearingCurrentDrawIBTextureMark"
						@click="applyTextureMark"
					>
							{{ t('markTexture.actions.applySubMeshMark') }}
					</el-button>
					<el-button
						:loading="isClearingCurrentDrawIBTextureMark"
						:disabled="isApplyingAllDrawIBTextureMark || isUpdatingCurrentDrawIBMarkStyle"
						@click="cancelTextureMark"
					>
							{{ t('markTexture.actions.clearSubMeshMark') }}
					</el-button>
					<el-button
						type="danger"
						plain
						:loading="isDeletingCurrentTextureConfig"
						:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark || isUpdatingCurrentDrawIBMarkStyle"
						@click="deleteCurrentTextureMemory"
					>
							{{ t('markTexture.actions.deleteCurrentTextureConfig') }}
					</el-button>
					<el-button
						type="danger"
						:loading="isDeletingAllTextureConfigs"
						:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark || isUpdatingCurrentDrawIBMarkStyle"
						@click="deleteAllTextureConfigs"
					>
							{{ t('markTexture.actions.deleteAllTextureConfigs') }}
					</el-button>

					<div class="menu-divider" />

					<div class="template-export-row">
						<el-button
							:loading="isExportingHashTextureModTemplate"
							:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark || isUpdatingCurrentDrawIBMarkStyle || isExportingSlotTextureModTemplate"
							@click="exportHashStyleTextureModTemplate"
						>
							{{ t('markTexture.actions.exportHashTextureModTemplate') }}
						</el-button>
						<el-button
							:loading="isExportingSlotTextureModTemplate"
							:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark || isUpdatingCurrentDrawIBMarkStyle || isExportingHashTextureModTemplate"
							@click="exportSlotStyleTextureModTemplate"
						>
							{{ t('markTexture.actions.exportSlotTextureModTemplate') }}
						</el-button>
					</div>

					<div class="mark-style-action-row">
						<el-button
							:loading="isUpdatingCurrentDrawIBMarkStyle"
							:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark"
							:title="t('markTexture.actions.setAllToHashStyle')"
							@click="updateCurrentDrawIBMarkStyle('Hash')"
						>
							Hash
						</el-button>
						<el-button
							:loading="isUpdatingCurrentDrawIBMarkStyle"
							:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark"
							:title="t('markTexture.actions.setAllToSlotStyle')"
							@click="updateCurrentDrawIBMarkStyle('Slot')"
						>
							Slot
						</el-button>
						<el-button
							:loading="isUpdatingCurrentDrawIBMarkStyle"
							:disabled="isApplyingAllDrawIBTextureMark || isClearingCurrentDrawIBTextureMark"
							:title="t('markTexture.actions.setAllToSharedSlotStyle')"
							@click="updateCurrentDrawIBMarkStyle('SharedSlot')"
						>
							SharedSlot
						</el-button>
					</div>
				</div>
			</aside>
		</div>
	</div>
</template>

<style scoped>
.mark-texture-page {
	height: 100%;
	padding: 28px;
	box-sizing: border-box;
	overflow: hidden;
	color: #e8ecf5;
	backdrop-filter: blur(6px);
	-webkit-backdrop-filter: blur(6px);
}

.mark-layout {
	height: 100%;
	display: flex;
	gap: 16px;
	align-items: stretch;
	min-height: 0;
}

.left-card,
.right-card {
	background:
		linear-gradient(145deg, rgba(var(--theme-surface-tint-rgb), 0.07), rgba(var(--theme-surface-tint-rgb), 0.025)),
		rgba(255, 255, 255, 0.035);
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.12);
	border-radius: 14px;
	box-shadow: 0 16px 38px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.035) inset;
}

.left-card {
	flex: 8;
	min-width: 0;
	display: flex;
	flex-direction: column;
	height: 100%;
	max-height: 100%;
	min-height: 0;
	overflow: hidden;
	padding: 16px;
}

.left-workspace {
	flex: 1;
	min-height: 0;
	min-width: 0;
	display: grid;
	grid-template-columns: minmax(220px, 30%) minmax(0, 1fr);
	gap: 14px;
}

.submesh-side-column {
	min-width: 0;
	min-height: 0;
	display: grid;
	grid-template-rows: minmax(150px, 1fr) minmax(560px, 68%);
	gap: 14px;
}

.submesh-drawer-list {
	min-height: 0;
	min-width: 0;
	overflow-y: auto;
	overflow-x: hidden;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-right: 4px;
	scrollbar-width: thin;
	scrollbar-color: rgba(var(--theme-surface-tint-rgb), 0.36) transparent;
}

.submesh-drawer-list::-webkit-scrollbar {
	width: 8px;
}

.texture-list::-webkit-scrollbar {
	width: 0;
	height: 0;
}

.submesh-drawer-list::-webkit-scrollbar-track {
	background: transparent;
}

.submesh-drawer-list::-webkit-scrollbar-thumb {
	background: rgba(var(--theme-surface-tint-rgb), 0.28);
	border-radius: 999px;
}

.submesh-drawer-list::-webkit-scrollbar-thumb:hover {
	background: rgba(var(--theme-surface-tint-rgb), 0.44);
}

.submesh-drawer-item {
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.09);
	border-radius: 10px;
	background: rgba(var(--theme-surface-tint-rgb), 0.035);
	overflow: visible;
}

.submesh-drawer-item.is-selected {
	border-color: rgba(var(--theme-surface-tint-rgb), 0.34);
	background: rgba(var(--theme-surface-tint-rgb), 0.075);
	box-shadow: inset 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.05);
}

.submesh-drawer-row {
	min-height: 38px;
}

.submesh-select-btn,
.submesh-marked-texture {
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.submesh-select-btn {
	width: 100%;
	min-height: 38px;
	min-width: 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 8px;
	padding: 0 9px;
	text-align: left;
}

.submesh-select-btn:hover,
.submesh-marked-texture:hover {
	background: rgba(255, 255, 255, 0.045);
}

.submesh-label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: rgba(244, 247, 255, 0.88);
	font-size: 12px;
	font-weight: 600;
}

.submesh-count {
	min-width: 24px;
	height: 20px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0 6px;
	border-radius: 999px;
	background: rgba(var(--theme-surface-tint-rgb), 0.11);
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.14);
	color: rgba(232, 236, 245, 0.78);
	font-size: 11px;
	font-weight: 700;
}

.submesh-marked-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 0 8px 8px;
}

.submesh-marked-texture {
	min-width: 0;
	display: grid;
	grid-template-columns: 38px minmax(0, 1fr);
	align-items: center;
	gap: 8px;
	padding: 6px;
	border-radius: 8px;
	text-align: left;
	background: rgba(255, 255, 255, 0.026);
}

.submesh-mark-preview {
	width: 38px;
	height: 38px;
	border-radius: 6px;
	overflow: hidden;
	border: 1px solid rgba(255, 255, 255, 0.10);
	background: rgba(0, 0, 0, 0.16);
}

.submesh-mark-preview img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	transition: opacity 0.18s ease;
}

.submesh-mark-meta {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.submesh-mark-meta-row {
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 6px;
}

.submesh-mark-name,
.submesh-mark-style {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.submesh-mark-name {
	color: #f4f7ff;
	font-size: 12px;
	font-weight: 700;
	white-space: normal;
	text-overflow: clip;
	overflow-wrap: anywhere;
	line-height: 1.25;
}

.submesh-mark-style {
	color: rgba(232, 236, 245, 0.62);
	font-size: 11px;
}

.submesh-mark-status {
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 42px;
	height: 16px;
	padding: 0 6px;
	border-radius: 999px;
	font-size: 10px;
	font-weight: 800;
	line-height: 1;
	white-space: nowrap;
	box-sizing: border-box;
}

.submesh-mark-status.is-applied {
	color: rgba(194, 255, 211, 0.96);
	background: rgba(38, 196, 101, 0.20);
	border: 1px solid rgba(72, 236, 126, 0.44);
}

.submesh-mark-status.is-pending {
	color: rgba(255, 205, 205, 0.98);
	background: rgba(239, 68, 68, 0.20);
	border: 1px solid rgba(255, 112, 112, 0.42);
}

.submesh-empty-mark {
	padding: 7px 8px;
	color: rgba(232, 236, 245, 0.34);
	font-size: 12px;
	text-align: center;
}

.texture-editor-pane {
	--texture-list-padding: 4px;
	min-height: 0;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.texture-editor-toolbar {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	align-items: center;
	gap: 10px;
	min-width: 0;
	padding-right: var(--texture-list-padding);
	box-sizing: border-box;
}

.texture-drawcall-select,
.texture-drawcall-select .el-select {
	min-width: 0;
	width: 100%;
}

.texture-drawcall-select :deep(.el-select__wrapper) {
	width: 100%;
	min-width: 0;
	min-height: 34px;
	border-radius: 10px;
}

.right-card {
	flex: 2;
	min-width: 180px;
	align-self: flex-start;
	position: sticky;
	top: 0;
	padding: 16px;
	max-height: 100%;
	min-height: 0;
	overflow-y: auto;
	overflow-x: hidden;
}

.texture-list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overflow-x: hidden;
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-right: var(--texture-list-padding);
	scrollbar-width: none;
	scrollbar-color: transparent transparent;
}

.texture-item {
	--meta-row-height: 30px;
	--meta-row-gap: 6px;
	--preview-size: calc(var(--meta-row-height) * 3 + var(--meta-row-gap) * 2);
	position: relative;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	align-items: start;
	gap: 14px;
	background: rgba(var(--theme-surface-tint-rgb), 0.045);
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
	border-radius: 12px;
	padding: 10px;
}

.texture-item-actions {
	position: absolute;
	top: 8px;
	right: 8px;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 6px;
	opacity: 0;
	transform: translateY(-2px);
	pointer-events: none;
	transition: opacity 0.16s ease, transform 0.16s ease;
}

.texture-item:hover .texture-item-actions,
.texture-item:focus-within .texture-item-actions {
	opacity: 1;
	transform: translateY(0);
	pointer-events: auto;
}

.texture-item-action-btn {
	width: 28px;
	height: 28px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	color: rgba(244, 247, 255, 0.78);
	background:
		linear-gradient(145deg, rgba(var(--theme-surface-tint-rgb), 0.18), rgba(var(--theme-surface-tint-rgb), 0.07)),
		rgba(8, 11, 18, 0.78);
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.16);
	border-radius: 7px;
	box-shadow: 0 8px 18px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.06);
	backdrop-filter: blur(10px) saturate(1.2);
	-webkit-backdrop-filter: blur(10px) saturate(1.2);
	cursor: pointer;
	transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.texture-item-action-btn:hover,
.texture-item-action-btn:focus-visible {
	color: #ffffff;
	background:
		linear-gradient(145deg, rgba(var(--theme-surface-tint-rgb), 0.28), rgba(var(--theme-surface-tint-rgb), 0.12)),
		rgba(14, 18, 28, 0.94);
	border-color: rgba(var(--theme-surface-tint-rgb), 0.30);
	transform: translateY(-1px);
	outline: none;
}

.texture-item-action-btn :deep(.el-icon) {
	font-size: 16px;
}

.channel-preview-overlay {
	position: fixed;
	inset: 0;
	z-index: 3000;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px;
	background: rgba(0, 0, 0, 0.34);
	backdrop-filter: blur(6px);
	-webkit-backdrop-filter: blur(6px);
}

.channel-preview-modal {
	position: relative;
	max-width: calc(100vw - 32px);
	max-height: calc(100vh - 32px);
	overflow: hidden;
	display: flex;
	align-items: stretch;
	justify-content: stretch;
	padding: 12px;
	border-radius: 20px;
  border: var(--t-material-border);
  background: var(--t-material-bg);
  box-shadow: var(--t-material-shadow);
	backdrop-filter: blur(18px) saturate(1.35);
	-webkit-backdrop-filter: blur(18px) saturate(1.35);
	user-select: none;
}

.channel-preview-close-btn {
	position: absolute;
	top: 12px;
	right: 12px;
	z-index: 3;
	width: 30px;
	height: 30px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.04);
	color: rgba(244, 247, 255, 0.88);
	font-size: 14px;
	font-weight: 700;
	pointer-events: auto;
	cursor: pointer;
	transition: all 0.2s ease;
}

.channel-preview-close-btn:hover {
	background: rgba(255, 120, 120, 0.16);
	border-color: rgba(255, 160, 160, 0.38);
	color: #ffffff;
}

.channel-preview-close-btn:focus-visible {
	outline: 2px solid rgba(255, 160, 160, 0.45);
	outline-offset: 2px;
}

.channel-preview-modal-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	grid-template-rows: repeat(2, minmax(0, 1fr));
	gap: 10px;
	min-height: 0;
	height: 100%;
	width: 100%;
	position: relative;
	z-index: 1;
}

.channel-modal-card {
	position: relative;
	width: 100%;
	height: 100%;
}

.channel-modal-card-label {
	position: absolute;
	top: 10px;
	left: 10px;
	z-index: 2;
	padding: 4px 9px;
	border-radius: 999px;
	background: rgba(var(--theme-surface-tint-rgb), 0.12);
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.20);
	color: rgba(244, 247, 255, 0.92);
	font-size: 12px;
	font-weight: 700;
	line-height: 1;
	letter-spacing: 0.04em;
	pointer-events: none;
	user-select: none;
}

.channel-modal-card-preview {
	width: 100%;
	height: 100%;
	border-radius: 14px;
	overflow: hidden;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
	background:
		linear-gradient(135deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01)),
		linear-gradient(135deg, rgba(var(--theme-surface-tint-rgb), 0.07), rgba(10, 12, 18, 0.72));
	box-shadow: inset 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.025);
}

.channel-preview-resize-handle {
	position: absolute;
	right: 6px;
	bottom: 6px;
	z-index: 2;
	width: 18px;
	height: 18px;
	border-right: 2px solid rgba(255, 255, 255, 0.32);
	border-bottom: 2px solid rgba(255, 255, 255, 0.32);
	border-bottom-right-radius: 4px;
	cursor: nwse-resize;
	opacity: 0.9;
	transition: opacity 0.2s ease, border-color 0.2s ease;
}

.channel-preview-resize-handle:hover {
	opacity: 1;
	border-color: rgba(117, 214, 187, 0.82);
}

.channel-modal-card-preview img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	display: block;
	background: rgba(0, 0, 0, 0.18);
	transition: opacity 0.18s ease;
}

.preview-wrap {
	width: var(--preview-size);
	height: var(--preview-size);
	aspect-ratio: 1 / 1;
	align-self: flex-start;
	border-radius: 8px;
	overflow: hidden;
	border: 1px solid rgba(255, 255, 255, 0.1);
}

.preview-wrap img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	transition: opacity 0.18s ease;
}

.channel-card {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.channel-card-label {
	font-size: 0.76rem;
	font-weight: 700;
	letter-spacing: 0.06em;
	color: rgba(232, 236, 245, 0.78);
	text-align: center;
}

.channel-card-preview {
	aspect-ratio: 1 / 1;
	border-radius: 10px;
	overflow: hidden;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
	background:
		linear-gradient(135deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01)),
		linear-gradient(135deg, rgba(var(--theme-surface-tint-rgb), 0.07), rgba(10, 12, 18, 0.72));
	box-shadow: inset 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.025);
}

.channel-card-preview img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	transition: opacity 0.18s ease;
}

.texture-meta {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
}

.meta-row {
	display: grid;
	grid-template-columns: 78px minmax(0, 1fr);
	align-items: center;
	min-height: var(--meta-row-height);
	gap: 8px;
	min-width: 0;
}

.label {
	color: rgba(232, 236, 245, 0.8);
	font-size: 0.8rem;
}

.value {
	color: #f4f7ff;
	font-size: 0.84rem;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.name-row {
	align-items: start;
	min-height: auto;
}

.name-row .label {
	padding-top: 1px;
}

.name-row .value {
	display: block;
	max-width: 100%;
	font-weight: 600;
	font-size: 0.88rem;
	white-space: normal;
	overflow: hidden;
	text-overflow: clip;
	overflow-wrap: anywhere;
	word-break: break-all;
	line-height: 1.35;
}

.left-card :deep(.el-input__inner),
.right-card :deep(.el-input__inner) {
	font-size: 12px;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.left-card :deep(.el-select__selected-item),
.right-card :deep(.el-select__selected-item) {
	display: flex;
	align-items: center;
	min-width: 0;
	max-width: 100%;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.88) !important;
	line-height: 24px;
}

.left-card :deep(.el-select__selection),
.right-card :deep(.el-select__selection) {
	min-width: 0;
	overflow: hidden;
	position: relative;
}

.left-card :deep(.el-select__placeholder),
.right-card :deep(.el-select__placeholder) {
	display: block;
	width: 100%;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	pointer-events: none;
}

.left-card :deep(.el-select__placeholder > span),
.right-card :deep(.el-select__placeholder > span) {
	display: block;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.left-card :deep(.el-select__placeholder:not(.is-transparent)),
.right-card :deep(.el-select__placeholder:not(.is-transparent)),
.left-card :deep(.el-select__placeholder:not(.is-transparent) > span),
.right-card :deep(.el-select__placeholder:not(.is-transparent) > span) {
	color: rgba(255, 255, 255, 0.88) !important;
}

.left-card :deep(.el-select__placeholder:not(.is-transparent)),
.right-card :deep(.el-select__placeholder:not(.is-transparent)) {
	z-index: 2;
}

.left-card :deep(.el-select__placeholder.is-transparent),
.right-card :deep(.el-select__placeholder.is-transparent) {
	color: rgba(255, 255, 255, 0.38) !important;
}

.left-card :deep(.el-select__input-wrapper:not(.is-hidden)),
.right-card :deep(.el-select__input-wrapper:not(.is-hidden)) {
	z-index: 3;
}

/* Ensure el-select fills the grid column inside meta-row */
.left-card :deep(.meta-row.select-row .el-select) {
	width: 100%;
	min-width: 0;
}

.left-card :deep(.meta-row.select-row .el-select__wrapper) {
	width: 100%;
	min-width: 0;
}

.mark-name-select-wrap {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-width: 0;
}

.mark-name-select-wrap :deep(.el-select) {
	flex: 1 1 auto;
	min-width: 0;
}

.mark-style-select-wrap {
	position: relative;
	width: 100%;
	min-width: 0;
}

.mark-style-select-wrap :deep(.el-select) {
	width: 100%;
}

.mark-style-selected-value {
	position: absolute;
	inset: 3px 30px 3px 12px;
	z-index: 4;
	display: flex;
	align-items: center;
	min-width: 0;
	overflow: hidden;
	color: rgba(255, 255, 255, 0.9);
	font-size: 12px;
	line-height: 24px;
	text-overflow: ellipsis;
	white-space: nowrap;
	pointer-events: none;
}

.mark-style-select-wrap :deep(.el-select__placeholder) {
	color: transparent !important;
}

.menu-stack {
	display: flex;
	flex-direction: column;
	gap: 10px;
	height: 100%;
	min-width: 0;
}

.menu-stack > div,
.menu-stack .el-dropdown {
	min-width: 0;
	width: 100%;
}

.menu-stack .el-select {
	width: 100%;
	min-width: 0;
}

.menu-stack :deep(.el-select__wrapper) {
	width: 100%;
	min-width: 0;
}

:global(.mark-texture-select-popper.el-select__popper.el-popper) {
	max-width: min(460px, calc(100vw - 24px)) !important;
}

:global(.mark-name-select-popper.el-select__popper.el-popper) {
	width: min(460px, calc(100vw - 24px)) !important;
	min-width: min(460px, calc(100vw - 24px)) !important;
	overflow: hidden;
}

:global(.mark-name-select-popper .el-select-dropdown),
:global(.mark-name-select-popper .el-select-dropdown__wrap),
:global(.mark-name-select-popper .el-scrollbar),
:global(.mark-name-select-popper .el-scrollbar__wrap),
:global(.mark-name-select-popper .el-select-dropdown__list),
:global(.mark-name-select-popper .el-select-group),
:global(.mark-name-select-popper .el-select-group__wrap) {
	width: 100% !important;
	min-width: 0 !important;
	max-width: 100% !important;
	box-sizing: border-box;
	overflow-x: hidden;
}

:global(.mark-texture-nav-popper.el-select__popper.el-popper) {
	max-width: min(520px, calc(100vw - 24px)) !important;
}

:global(.mark-texture-select-popper .el-select-dropdown__item) {
	max-width: 100%;
	padding-right: 28px;
}

:global(.mark-name-select-popper .el-select-group__title) {
	color: rgba(255,255,255,0.52);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0;
}

:global(.mark-name-select-popper .el-select-dropdown__item) {
	width: 100%;
	min-width: 0;
	max-width: 100%;
	box-sizing: border-box;
	height: 32px;
	line-height: 32px;
	padding-right: 8px;
}

:global(.custom-mark-name-option) {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-width: 0;
}

:global(.custom-mark-name-text) {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

:global(.custom-mark-name-delete-button) {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 22px;
	width: 22px;
	height: 22px;
	padding: 0;
	border: 0;
	border-radius: 5px;
	background: transparent;
	color: rgba(255,255,255,0.42);
	cursor: pointer;
	opacity: 0.72;
	transition: background-color 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

:global(.custom-mark-name-delete-button:hover) {
	background: rgba(255,255,255,0.10);
	color: rgba(255,255,255,0.92);
	opacity: 1;
}

.menu-stack .el-button {
	margin-left: 0;
	width: 100%;
	height: 34px;
	border-radius: 10px;
	border: 1px solid rgba(255,255,255,0.10);
	background: rgba(255,255,255,0.04);
	color: rgba(255,255,255,0.70);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.3px;
	transition: all 0.2s ease;
	position: relative;
	overflow: hidden;
}
.menu-stack .el-button::before {
	content: '';
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	height: 1px;
	background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
	pointer-events: none;
}
.menu-stack .el-button:hover {
	background: rgba(255,255,255,0.08);
	border-color: rgba(255,255,255,0.20);
	color: rgba(255,255,255,0.90);
	transform: translateY(-1px);
	box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.menu-stack .el-button:active {
	transform: translateY(0) scale(0.98);
}
.menu-stack .el-button.is-disabled,
.menu-stack .el-button.is-disabled:hover {
	opacity: 0.35;
	cursor: not-allowed;
	transform: none !important;
	background: rgba(255,255,255,0.04);
	border-color: rgba(255,255,255,0.10);
}
.menu-stack .el-button.el-button--primary {
	background: rgba(var(--theme-surface-tint-rgb), 0.08);
	border-color: rgba(var(--theme-surface-tint-rgb), 0.18);
	color: rgba(var(--theme-surface-tint-rgb), 0.85);
}
.menu-stack .el-button.el-button--primary:hover {
	background: rgba(var(--theme-surface-tint-rgb), 0.14);
	border-color: rgba(var(--theme-surface-tint-rgb), 0.30);
	color: rgba(166, 232, 255, 1);
	box-shadow: 0 4px 16px rgba(var(--theme-surface-tint-rgb), 0.08);
}
.menu-stack .el-button.el-button--danger {
	background: rgba(220, 80, 80, 0.08);
	border-color: rgba(220, 80, 80, 0.18);
	color: rgba(255, 130, 130, 0.85);
}
.menu-stack .el-button.el-button--danger:hover {
	background: rgba(220, 80, 80, 0.14);
	border-color: rgba(220, 80, 80, 0.30);
	color: rgba(255, 150, 150, 1);
	box-shadow: 0 4px 16px rgba(220, 80, 80, 0.08);
}

.filter-toggle-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: 12px;
	width: 100%;
	box-sizing: border-box;
	min-height: 34px;
	padding: 7px 10px;
	border-radius: 10px;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.06);
}

.filter-toggle-label {
	min-width: 0;
	font-size: 12px;
	line-height: 1.35;
	color: rgba(232, 236, 245, 0.88);
	overflow-wrap: anywhere;
	white-space: normal;
}

.filter-toggle-row :deep(.el-switch) {
	justify-self: end;
	flex-shrink: 0;
}

.template-export-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 10px;
}

.template-export-row .el-button {
	margin-left: 0;
	width: 100%;
}

.mark-style-action-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 8px;
}

.mark-style-action-row .el-button {
	min-width: 0;
	width: 100%;
	margin-left: 0;
	padding-left: 6px;
	padding-right: 6px;
}

.menu-bottom {
	margin-top: auto;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.menu-divider {
	height: 1px;
	background: rgba(255, 255, 255, 0.12);
}

.folder-dropdown-btn {
	justify-content: flex-start;
}

.folder-dropdown-icon {
	margin-right: 6px;
}

@media (max-width: 960px) {
	.mark-texture-page {
		overflow: auto;
	}

	.mark-layout {
		flex-direction: column;
		height: auto;
	}

	.left-card,
	.right-card {
		min-width: 0;
		position: static;
		max-height: none;
		overflow: visible;
	}

	.left-card {
		min-height: 420px;
	}

	.left-workspace {
		grid-template-columns: 1fr;
	}

	.submesh-side-column {
		grid-template-rows: minmax(180px, auto) minmax(560px, auto);
	}

	.submesh-drawer-list {
		max-height: 360px;
	}

	.texture-editor-toolbar {
		grid-template-columns: 1fr;
	}

	.texture-item {
		grid-template-columns: 1fr;
	}

	.channel-preview-overlay {
		padding: 16px;
	}

	.channel-preview-modal {
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 32px);
		padding: 10px;
	}

	.channel-preview-modal-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.preview-wrap {
		width: 100%;
		height: 180px;
	}

	.template-export-row {
		grid-template-columns: 1fr;
	}
}
</style>
