<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { exists, readDir, readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { moveDirectoryToRecycleBin } from '../../utils/RecycleBin';
import { AppStateManager } from '../../store/AppStateManager';

type PreviewTextureOption = {
	id: string;
	label: string;
	url: string;
	markName?: string;
	ddsPath: string;
};

type PreviewSubMeshTarget = {
	id: string;
	workspacePath: string;
	subMeshName: string;
	diffuseUrl?: string;
	normalUrl?: string;
	diffuseDdsPath?: string;
	normalDdsPath?: string;
};

type SubMeshElement = {
	SemanticName?: string;
	SemanticIndex?: string | number;
	Format?: string;
	ByteWidth?: string | number;
};

type SubMeshCategoryBuffer = {
	FileName?: string;
	Type?: string;
	D3D11ElementList?: SubMeshElement[];
};

type SubMeshIndexBuffer = {
	FileName?: string;
	DXGI_FORMAT?: string;
};

type SubMeshJson = {
	GamePreset?: string;
	WorkGameType?: string;
	VertexOffset?: number | string;
	VertexCount?: number | string;
	IndexBufferList?: SubMeshIndexBuffer[];
	CategoryBufferList?: SubMeshCategoryBuffer[];
};

type LightingMode = 'half-lambert' | 'unlit' | 'pbr';

type ElementSource = {
	buffer: SubMeshCategoryBuffer;
	element: SubMeshElement;
	offset: number;
	stride: number;
	categoryIndex: number;
	elementIndex: number;
};

type UvLayer = ElementSource & {
	id: string;
	label: string;
};

type DataTypeItem = {
	id: string;
	name: string;
	folderPath: string;
	json: SubMeshJson;
	uvLayers: UvLayer[];
};

const props = defineProps<{
	workspacePath: string;
	subMeshName: string;
	visibleSubMeshTargets?: PreviewSubMeshTarget[];
	textureOptions: PreviewTextureOption[];
}>();

const emit = defineEmits<{
	(event: 'data-type-changed'): void;
	(event: 'review-targets-changed', targetIds: string[]): void;
}>();

const { t } = useI18n();

const MAX_PREVIEW_INDEX_COUNT = 600_000;
const PREVIEW_GEOMETRY_YIELD_TRIANGLES = 4096;
const yieldPreviewGeometryWork = (): Promise<void> => new Promise(resolve => globalThis.setTimeout(resolve, 0));
const SUBMESH_TASK_CONCURRENCY = 7;
const mapWithConcurrency = async <T, R>(
	items: readonly T[],
	mapper: (item: T, index: number) => Promise<R>,
	shouldContinue: () => boolean = () => true
): Promise<R[]> => {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(SUBMESH_TASK_CONCURRENCY, items.length) }, async () => {
		while (nextIndex < items.length && shouldContinue()) {
			const index = nextIndex++;
			results[index] = await mapper(items[index]!, index);
		}
	});
	await Promise.all(workers);
	return results;
};
const DDS_3D_TEXTURE_MAX_DIMENSION = 1024;
const PREVIEW_LIGHTING_MODE_STORAGE_KEY = 'ssmt4:post-processing-preview:lighting-mode';
const PREVIEW_OUTLINE_STORAGE_KEY = 'ssmt4:post-processing-preview:outline';
const PREVIEW_OUTLINE_WIDTH_STORAGE_KEY = 'ssmt4:post-processing-preview:outline-width';
const PREVIEW_OUTLINE_COLOR_STORAGE_KEY = 'ssmt4:post-processing-preview:outline-color';
const PREVIEW_OUTLINE_DIRECTION_STORAGE_KEY = 'ssmt4:post-processing-preview:outline-direction';
const PREVIEW_OUTLINE_WEIGHT_STORAGE_KEY = 'ssmt4:post-processing-preview:outline-weight';
const PREVIEW_OUTLINE_VISUALIZATION_STORAGE_KEY = 'ssmt4:post-processing-preview:outline-visualization';
const PREVIEW_OUTLINE_SKIP_TRANSPARENT_STORAGE_KEY = 'ssmt4:post-processing-preview:outline-skip-transparent';
const PREVIEW_OUTLINE_PREFERENCE_VERSION_KEY = 'ssmt4:post-processing-preview:outline-preference-version';
const PREVIEW_EMISSION_STORAGE_KEY = 'ssmt4:post-processing-preview:diffuse-alpha-emission';
const PREVIEW_EMISSION_COLOR_STORAGE_KEY = 'ssmt4:post-processing-preview:emission-color';
const PREVIEW_EMISSION_FACTOR_STORAGE_KEY = 'ssmt4:post-processing-preview:emission-factor';
const OUTLINE_WIDTH_MIN = 0.0001;
const OUTLINE_WIDTH_MAX = 0.01;
// Preview-space coordinates are metres.  Values beyond this threshold usually
// mean an incomplete/misinterpreted vertex stream rather than an intentional
// game model.  Keep it rendered, but mark it for the user and exclude it from
// automatic framing when a healthy component is available.
const MAX_REASONABLE_PREVIEW_COORDINATE_METERS = 5;
// Intentionally centralised tuning knobs for preview orientation and distance.
// Change these two values when a game needs a different resting orientation or
// a looser/tighter initial camera distance.
const PREVIEW_MODEL_X_ROTATION_DEGREES = -90;
const PREVIEW_REFERENCE_FRAME_DIAMETER_METERS = 2;
const PREVIEW_CAMERA_DISTANCE_MULTIPLIER = 1.65;
const STRUCTURED_BUFFER_TYPES = new Set(['NORMAL', 'BLENDWEIGHT', 'TANGENTFRAME']);
const REVERSED_WINDING_GAME_PRESETS = new Set(['WWMI', 'NTEMI', 'YYSLS', 'SNOWBREAK']);

const previewHost = ref<HTMLDivElement>();
const dataTypes = ref<DataTypeItem[]>([]);
const selectedDataTypeId = ref('');
const selectedUvLayerId = ref('');
const lightingMode = ref<LightingMode>(AppStateManager.appSettings.postProcessPreviewLightingMode);
// This controls the tangent-space normal's tilt, not mesh vertex displacement.
// Keeping 1.0 as the default applies a normal map without exaggerating it.
const normalStrength = ref(1);
const outlineEnabled = ref(localStorage.getItem(PREVIEW_OUTLINE_STORAGE_KEY) === 'true');
const outlineWidth = ref(Number.parseFloat(localStorage.getItem(PREVIEW_OUTLINE_WIDTH_STORAGE_KEY) || '0.001'));
const outlineColor = ref(localStorage.getItem(PREVIEW_OUTLINE_COLOR_STORAGE_KEY) || '#080a0f');
const hasPreferredOutlineDefaults = localStorage.getItem(PREVIEW_OUTLINE_PREFERENCE_VERSION_KEY) === '2';
const outlineDirectionSource = ref<OutlineDirectionSource>(hasPreferredOutlineDefaults
	? (localStorage.getItem(PREVIEW_OUTLINE_DIRECTION_STORAGE_KEY) as OutlineDirectionSource) || 'normal'
	: 'normal');
const outlineWeightSource = ref<OutlineWeightSource>(hasPreferredOutlineDefaults
	? (localStorage.getItem(PREVIEW_OUTLINE_WEIGHT_STORAGE_KEY) as OutlineWeightSource) || 'color-a-raw'
	: 'color-a-raw');
const outlineVisualization = ref<OutlineVisualization>(hasPreferredOutlineDefaults
	? (localStorage.getItem(PREVIEW_OUTLINE_VISUALIZATION_STORAGE_KEY) as OutlineVisualization) || 'outline'
	: 'outline');
const outlineSkipTransparent = ref(localStorage.getItem(PREVIEW_OUTLINE_SKIP_TRANSPARENT_STORAGE_KEY) !== 'false');
const diffuseAlphaEmissionEnabled = ref(localStorage.getItem(PREVIEW_EMISSION_STORAGE_KEY) === 'true');
const emissionColor = ref(localStorage.getItem(PREVIEW_EMISSION_COLOR_STORAGE_KEY) || '#ffffff');
const emissionFactor = ref(Number.parseFloat(localStorage.getItem(PREVIEW_EMISSION_FACTOR_STORAGE_KEY) || '1'));
const outlineWidthSlider = computed({
	get: () => Math.log(outlineWidth.value / OUTLINE_WIDTH_MIN) / Math.log(OUTLINE_WIDTH_MAX / OUTLINE_WIDTH_MIN),
	set: (position: number) => {
		outlineWidth.value = OUTLINE_WIDTH_MIN * Math.pow(OUTLINE_WIDTH_MAX / OUTLINE_WIDTH_MIN, position);
	},
});
const outlineWidthMarks = { 0: '0.0001', 0.5: '0.001', 1: '0.01' };
const isLoading = ref(false);
const isBuildingPreview = ref(false);
const previewError = ref('');
const previewStatus = ref('');
const previewSettingsOpen = ref(false);
const previewZoomOpen = ref(false);
let loadToken = 0;
let previewBuildToken = 0;
let rebuildScheduled = false;
let textureLoadToken = 0;

let renderer: THREE.WebGLRenderer | undefined;
let zoomRenderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let controls: OrbitControls | undefined;
let zoomControls: OrbitControls | undefined;
let material: THREE.ShaderMaterial | undefined;
let mesh: THREE.Mesh | undefined;
let previewRoot: THREE.Group | undefined;
let framingMeshes: THREE.Mesh[] = [];
let passiveMaterials: THREE.ShaderMaterial[] = [];
type OutlineDirectionSource = 'normal' | 'tangent' | '-tangent' | 'auto';
type OutlineWeightSource = 'constant' | 'color-a-raw' | 'color-a-signed';
type OutlineVisualization = 'outline' | 'normal' | 'tangent' | 'color-a' | 'weight';
type OutlineSettings = {
	enabled: boolean;
	width: number;
	color: string;
	directionSource: OutlineDirectionSource;
	weightSource: OutlineWeightSource;
	visualization: OutlineVisualization;
	skipTransparent: boolean;
};

class OutlineController {
	private readonly proxies = new Map<THREE.Mesh, THREE.Mesh>();
	private settings: OutlineSettings;

	constructor(settings: OutlineSettings) {
		this.settings = settings;
	}

	attach(sourceMesh: THREE.Mesh): void {
		if (this.proxies.has(sourceMesh)) return;
		const geometry = sourceMesh.geometry;
		geometry.computeBoundingSphere();
		const radius = geometry.boundingSphere?.radius || 1;
		const outlineMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uOutlineWidth: { value: Math.max(radius * this.settings.width, 0.0001) },
				uOutlineColor: { value: new THREE.Color(this.settings.color) },
				uDirectionSource: { value: ['normal', 'tangent', '-tangent', 'auto'].indexOf(this.settings.directionSource) },
				uWeightSource: { value: ['constant', 'color-a-raw', 'color-a-signed'].indexOf(this.settings.weightSource) },
				uVisualization: { value: ['outline', 'normal', 'tangent', 'color-a', 'weight'].indexOf(this.settings.visualization) },
			},
			vertexShader: `
				uniform float uOutlineWidth;
				uniform int uDirectionSource;
				uniform int uWeightSource;
				attribute vec4 ssmtRawTangent;
				attribute vec4 ssmtRawColor;
				varying vec3 vOutlineDirection;
				varying vec3 vRawTangent;
				varying float vColorA;
				varying float vOutlineWeight;
				void main() {
					vec3 safeNormal = length(normal) > 0.00001 ? normalize(normal) : vec3(0.0, 1.0, 0.0);
					bool hasTangent = length(ssmtRawTangent.xyz) > 0.00001;
					vec3 safeTangent = hasTangent ? normalize(ssmtRawTangent.xyz) : safeNormal;
					vec3 outlineDirection = safeNormal;
					if (uDirectionSource == 1) outlineDirection = safeTangent;
					if (uDirectionSource == 2) outlineDirection = -safeTangent;
					if (uDirectionSource == 3) outlineDirection = hasTangent ? safeTangent : safeNormal;
					float outlineWeight = 1.0;
					if (uWeightSource == 1) outlineWeight = ssmtRawColor.a;
					if (uWeightSource == 2) outlineWeight = ssmtRawColor.a * 2.0 - 1.0;
					vec3 transformedPosition = position + outlineDirection * uOutlineWidth * outlineWeight;
					vOutlineDirection = outlineDirection;
					vRawTangent = safeTangent;
					vColorA = ssmtRawColor.a;
					vOutlineWeight = outlineWeight;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
				}
			`,
			fragmentShader: `
				uniform vec3 uOutlineColor;
				uniform int uVisualization;
				varying vec3 vOutlineDirection;
				varying vec3 vRawTangent;
				varying float vColorA;
				varying float vOutlineWeight;
				void main() {
					vec3 debugColor = uOutlineColor;
					if (uVisualization == 1) debugColor = vOutlineDirection * 0.5 + 0.5;
					if (uVisualization == 2) debugColor = vRawTangent * 0.5 + 0.5;
					if (uVisualization == 3) debugColor = vec3(vColorA);
					if (uVisualization == 4) debugColor = vec3(vOutlineWeight * 0.5 + 0.5);
					gl_FragColor = vec4(debugColor, 1.0);
					#include <colorspace_fragment>
				}
			`,
			side: THREE.BackSide,
			depthTest: true,
			depthWrite: false,
			// Keep nearly coplanar inward/negative-semantic shells stable as camera
			// distance reduces depth-buffer precision.
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});
		const proxy = new THREE.Mesh(geometry, outlineMaterial);
		proxy.name = '__ssmt_outline_proxy__';
		proxy.renderOrder = sourceMesh.renderOrder + 1;
		proxy.visible = this.settings.enabled && !this.shouldSkip(sourceMesh);
		proxy.frustumCulled = sourceMesh.frustumCulled;
		sourceMesh.add(proxy);
		this.proxies.set(sourceMesh, proxy);
	}

	detach(sourceMesh: THREE.Mesh): void {
		const proxy = this.proxies.get(sourceMesh);
		if (!proxy) return;
		proxy.removeFromParent();
		(proxy.material as THREE.Material).dispose();
		this.proxies.delete(sourceMesh);
	}

	updateSettings(settings: OutlineSettings): void {
		this.settings = settings;
		for (const [sourceMesh, proxy] of this.proxies) {
			const geometry = sourceMesh.geometry;
			geometry.computeBoundingSphere();
			const radius = geometry.boundingSphere?.radius || 1;
			const proxyMaterial = proxy.material as THREE.ShaderMaterial;
			proxy.visible = settings.enabled && !this.shouldSkip(sourceMesh);
			proxyMaterial.uniforms.uOutlineWidth.value = Math.max(radius * settings.width, 0.0001);
			proxyMaterial.uniforms.uOutlineColor.value.set(settings.color);
			proxyMaterial.uniforms.uDirectionSource.value = ['normal', 'tangent', '-tangent', 'auto'].indexOf(settings.directionSource);
			proxyMaterial.uniforms.uWeightSource.value = ['constant', 'color-a-raw', 'color-a-signed'].indexOf(settings.weightSource);
			proxyMaterial.uniforms.uVisualization.value = ['outline', 'normal', 'tangent', 'color-a', 'weight'].indexOf(settings.visualization);
		}
	}

	private shouldSkip(sourceMesh: THREE.Mesh): boolean {
		if (!this.settings.skipTransparent) return false;
		const sourceMaterials = Array.isArray(sourceMesh.material) ? sourceMesh.material : [sourceMesh.material];
		return sourceMaterials.some(item => item.transparent);
	}

	dispose(): void {
		for (const sourceMesh of [...this.proxies.keys()]) this.detach(sourceMesh);
	}
}

const currentOutlineSettings = (): OutlineSettings => ({
	enabled: outlineEnabled.value,
	width: Math.min(Math.max(outlineWidth.value || 0.001, OUTLINE_WIDTH_MIN), OUTLINE_WIDTH_MAX),
	color: outlineColor.value || '#080a0f',
	directionSource: outlineDirectionSource.value,
	weightSource: outlineWeightSource.value,
	visualization: outlineVisualization.value,
	skipTransparent: outlineSkipTransparent.value,
});
const outlineController = new OutlineController(currentOutlineSettings());
let resizeObserver: ResizeObserver | undefined;
let zoomResizeObserver: ResizeObserver | undefined;
let zoomBoundsObserver: ResizeObserver | undefined;
let zoomTextureToken = 0;
let zoomTextureSnapshots: Array<{
	material: THREE.ShaderMaterial;
	diffuse: THREE.Texture | null;
	normal: THREE.Texture | null;
}> = [];
let zoomFullTextures: THREE.Texture[] = [];
let previewMaterialTextureSources: Array<{ material: THREE.ShaderMaterial; diffuseDdsPath: string; normalDdsPath: string }> = [];
let disposePreviewPointerControls: (() => void) | undefined;
let disposeZoomPointerControls: (() => void) | undefined;
let diffuseTexture: THREE.Texture | undefined;
let normalTexture: THREE.Texture | undefined;
const rotationCenter = new THREE.Vector3();
const zoomPreviewHost = ref<HTMLDivElement>();
const previewZoomDialogStyle = ref<Record<string, string>>({});

const activeDataType = computed(() => {
	return dataTypes.value.find(item => item.id === selectedDataTypeId.value);
});

const uvLayers = computed(() => activeDataType.value?.uvLayers ?? []);

const activeUvLayer = computed(() => {
	return uvLayers.value.find(item => item.id === selectedUvLayerId.value);
});

const selectedDiffuse = computed(() => {
	return findMarkedTexture('DiffuseMap');
});

const selectedNormal = computed(() => {
	return findMarkedTexture('NormalMap');
});

const hasPreviewTarget = computed(() => !!props.workspacePath && !!props.subMeshName);

const selectedDataTypeLabel = computed(() => {
	const dataType = activeDataType.value;
	if (!dataType) {
		return t('markTexture.preview.noDataTypes');
	}
	return dataType.name;
});

const selectedUvLayerLabel = computed(() => {
	return activeUvLayer.value?.label || t('markTexture.preview.uvLayer');
});

const currentLightingModeLabel = computed(() => {
	if (lightingMode.value === 'pbr') return t('markTexture.preview.pbr');
	if (lightingMode.value === 'unlit') return t('markTexture.preview.unlit');
	return t('markTexture.preview.halfLambert');
});

const restoreLightingModePreference = () => {
	const configuredMode = AppStateManager.appSettings.postProcessPreviewLightingMode;
	if (configuredMode === 'half-lambert' || configuredMode === 'unlit' || configuredMode === 'pbr') {
		lightingMode.value = configuredMode;
		return;
	}
	try {
		const stored = localStorage.getItem(PREVIEW_LIGHTING_MODE_STORAGE_KEY);
		if (stored === 'half-lambert' || stored === 'unlit' || stored === 'pbr') {
			lightingMode.value = stored;
		}
	} catch {
		// Storage can be unavailable in constrained web contexts. The default is
		// still a valid render mode, so persistence is intentionally optional.
	}
};

const saveLightingModePreference = (mode: LightingMode) => {
	AppStateManager.appSettings.postProcessPreviewLightingMode = mode;
	try {
		localStorage.setItem(PREVIEW_LIGHTING_MODE_STORAGE_KEY, mode);
	} catch {
		// Keep rendering functional even when local persistence is unavailable.
	}
};

const fallbackColor = computed(() => {
	return getFallbackColorForKey(props.subMeshName);
});

const getFallbackColorForKey = (key: string): THREE.Color => {
	let hash = 0;
	for (const char of key) {
		hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
	}
	const hue = ((hash >>> 0) % 360) / 360;
	return new THREE.Color().setHSL(hue, 0.46, 0.56);
};

const visibleSubMeshTargets = computed<PreviewSubMeshTarget[]>(() => {
	if (props.visibleSubMeshTargets) {
		return props.visibleSubMeshTargets;
	}
	return props.workspacePath && props.subMeshName
		? [{ id: props.subMeshName, workspacePath: props.workspacePath, subMeshName: props.subMeshName }]
		: [];
});

const normalizeSemantic = (semantic: string | undefined): string => {
	return (semantic || '').trim().toUpperCase();
};

const semanticMatches = (semantic: string | undefined, target: string): boolean => {
	const normalized = normalizeSemantic(semantic);
	return normalized === target || new RegExp(`^${target}\\d+$`).test(normalized);
};

const semanticIndexOf = (element: SubMeshElement, fallback: number): number => {
	const declared = Number.parseInt(String(element.SemanticIndex ?? ''), 10);
	if (Number.isFinite(declared)) return declared;
	const suffix = normalizeSemantic(element.SemanticName).match(/(\d+)$/)?.[1];
	const parsedSuffix = Number.parseInt(suffix || '', 10);
	return Number.isFinite(parsedSuffix) ? parsedSuffix : fallback;
};

const getByteWidth = (element: SubMeshElement): number => {
	const parsed = Number.parseInt(String(element.ByteWidth ?? ''), 10);
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}

	const normalizedFormat = (element.Format || '').trim().toUpperCase().replace(/^DXGI_FORMAT_/, '');
	const components = normalizedFormat.match(/[RGBA]\d+/g) ?? [];
	return components.reduce((total, component) => total + Number.parseInt(component.slice(1), 10) / 8, 0);
};

const getElementSources = (dataType: DataTypeItem, semantic: string): ElementSource[] => {
	const targetSemantic = normalizeSemantic(semantic);
	const result: ElementSource[] = [];

	for (const [categoryIndex, buffer] of (dataType.json.CategoryBufferList ?? []).entries()) {
		// This is the same structured-buffer route used by TheHerta4.  Other
		// buffer kinds (such as shape-key and dynamic-blend buffers) are not
		// vertex streams and must never be interpreted as positions or UVs.
		const bufferType = normalizeSemantic(buffer.Type);
		if (bufferType && !STRUCTURED_BUFFER_TYPES.has(bufferType)) {
			continue;
		}
		const elements = Array.isArray(buffer.D3D11ElementList) ? buffer.D3D11ElementList : [];
		let offset = 0;
		const stride = elements.reduce((total, element) => total + getByteWidth(element), 0);

		for (const [elementIndex, element] of elements.entries()) {
			if (semanticMatches(element.SemanticName, targetSemantic)) {
				result.push({
					buffer,
					element,
					offset,
					stride,
					categoryIndex,
					elementIndex,
				});
			}
			offset += getByteWidth(element);
		}
	}

	return result;
};

const buildUvLayers = (dataType: Omit<DataTypeItem, 'uvLayers'>): UvLayer[] => {
	const sources = getElementSources(dataType as DataTypeItem, 'TEXCOORD');
	return sources
		.filter(source => getFormatComponentCount(source.element.Format) >= 2)
		.map((source, index) => {
			const semanticIndex = semanticIndexOf(source.element, index);
			return {
				...source,
				id: `${source.categoryIndex}:${source.elementIndex}`,
				label: `TEXCOORD${semanticIndex}`,
			};
		});
};

const getFormatComponentCount = (format: string | undefined): number => {
	const normalizedFormat = (format || '').trim().toUpperCase().replace(/^DXGI_FORMAT_/, '');
	return normalizedFormat.match(/[RGBA]\d+/g)?.length ?? 0;
};

const getSubMeshRootPath = async (
	workspacePath = props.workspacePath,
	subMeshName = props.subMeshName
): Promise<string | undefined> => {
	if (!workspacePath || !subMeshName) {
		return undefined;
	}
	return join(workspacePath, subMeshName);
};

const loadDataTypeItem = async (rootPath: string, folderName: string): Promise<DataTypeItem | undefined> => {
	try {
		const folderPath = await join(rootPath, folderName);
		const folderEntries = await readDir(folderPath);
		const jsonEntry = folderEntries.find(item => !item.isDirectory && item.name?.endsWith('.json'));
		if (!jsonEntry?.name) {
			return undefined;
		}

		const parsed = JSON.parse(await readTextFile(await join(folderPath, jsonEntry.name))) as SubMeshJson;
		if (!Array.isArray(parsed.IndexBufferList) || !Array.isArray(parsed.CategoryBufferList)) {
			return undefined;
		}

		const baseItem = {
			id: folderName,
			name: (parsed.WorkGameType || folderName.replace(/^TYPE_/, '')).trim(),
			folderPath,
			json: parsed,
		};
		return {
			...baseItem,
			uvLayers: buildUvLayers(baseItem),
		} satisfies DataTypeItem;
	} catch {
		return undefined;
	}
};

const loadDefaultDataTypeForTarget = async (
	target: PreviewSubMeshTarget
): Promise<{ dataType: DataTypeItem; uvLayer?: UvLayer } | undefined> => {
	const rootPath = await getSubMeshRootPath(target.workspacePath, target.subMeshName);
	if (!rootPath || !(await exists(rootPath))) {
		return undefined;
	}
	const folderNames = (await readDir(rootPath))
		.filter(entry => entry.isDirectory && entry.name?.startsWith('TYPE_') && entry.name)
		.map(entry => entry.name!)
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
	for (const folderName of folderNames) {
		const dataType = await loadDataTypeItem(rootPath, folderName);
		if (dataType) {
			return { dataType, uvLayer: dataType.uvLayers[0] };
		}
	}
	return undefined;
};

const findMarkedTexture = (markName: 'DiffuseMap' | 'NormalMap'): PreviewTextureOption | undefined => {
	return props.textureOptions.find(item => item.ddsPath && item.markName?.trim().toLowerCase() === markName.toLowerCase());
};

const loadDataTypes = async () => {
	const token = ++loadToken;
	previewError.value = '';
	previewStatus.value = '';

	if (!hasPreviewTarget.value) {
		dataTypes.value = [];
		selectedDataTypeId.value = '';
		selectedUvLayerId.value = '';
		clearPreviewMesh();
		return;
	}

	isLoading.value = true;
	try {
		const rootPath = await getSubMeshRootPath();
		if (!rootPath || !(await exists(rootPath))) {
			dataTypes.value = [];
			return;
		}

		const entries = await readDir(rootPath);
		const candidates = entries.filter(entry => entry.isDirectory && entry.name?.startsWith('TYPE_') && entry.name);
		const loadedItems = await mapWithConcurrency(candidates, entry => loadDataTypeItem(rootPath, entry.name!));

		if (token !== loadToken) {
			return;
		}

		dataTypes.value = loadedItems
			.filter((item): item is DataTypeItem => !!item)
			.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));

		if (!dataTypes.value.some(item => item.id === selectedDataTypeId.value)) {
			selectedDataTypeId.value = dataTypes.value[0]?.id ?? '';
		}
		const nextUvLayers = dataTypes.value.find(item => item.id === selectedDataTypeId.value)?.uvLayers ?? [];
		if (!nextUvLayers.some(item => item.id === selectedUvLayerId.value)) {
			selectedUvLayerId.value = nextUvLayers[0]?.id ?? '';
		}
		// TYPE_* folder names and UV ids are often the same across SubMesh entries.
		// The selected ids may therefore not change, so explicitly rebuild with the new buffers.
		schedulePreviewRebuild();
	} catch (error) {
		if (token === loadToken) {
			dataTypes.value = [];
			selectedDataTypeId.value = '';
			selectedUvLayerId.value = '';
			previewError.value = String(error);
			schedulePreviewRebuild();
		}
	} finally {
		if (token === loadToken) {
			isLoading.value = false;
		}
	}
};

const halfFloatToNumber = (value: number): number => {
	const sign = (value & 0x8000) === 0 ? 1 : -1;
	const exponent = (value >> 10) & 0x1f;
	const fraction = value & 0x03ff;
	if (exponent === 0) {
		return sign * 2 ** -14 * (fraction / 1024);
	}
	if (exponent === 0x1f) {
		return fraction === 0 ? sign * Infinity : Number.NaN;
	}
	return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
};

type FormatPart = {
	bits: number;
	type: 'float' | 'unorm' | 'snorm' | 'uint' | 'sint';
};

const getFormatParts = (format: string | undefined): FormatPart[] => {
	const normalizedFormat = (format || '').trim().toUpperCase().replace(/^DXGI_FORMAT_/, '');
	const matches = normalizedFormat.match(/[RGBA](\d+)/g) ?? [];
	const type: FormatPart['type'] = normalizedFormat.includes('SNORM')
		? 'snorm'
		: normalizedFormat.includes('UNORM')
			? 'unorm'
			: normalizedFormat.includes('SINT')
				? 'sint'
				: normalizedFormat.includes('UINT')
					? 'uint'
					: 'float';
	return matches.map(match => ({ bits: Number.parseInt(match.slice(1), 10), type }));
};

const readComponent = (view: DataView, offset: number, part: FormatPart): number | undefined => {
	if (offset < 0 || offset + part.bits / 8 > view.byteLength) {
		return undefined;
	}

	if (part.bits === 32) {
		if (part.type === 'float') return view.getFloat32(offset, true);
		if (part.type === 'uint' || part.type === 'unorm') {
			const value = view.getUint32(offset, true);
			return part.type === 'unorm' ? value / 0xffffffff : value;
		}
		const value = view.getInt32(offset, true);
		if (part.type === 'snorm') return Math.max(-1, value / 0x7fffffff);
		return value;
	}

	if (part.bits === 16) {
		if (part.type === 'float') return halfFloatToNumber(view.getUint16(offset, true));
		if (part.type === 'uint' || part.type === 'unorm') {
			const value = view.getUint16(offset, true);
			return part.type === 'unorm' ? value / 0xffff : value;
		}
		const value = view.getInt16(offset, true);
		if (part.type === 'snorm') return Math.max(-1, value / 0x7fff);
		return value;
	}

	if (part.bits === 8) {
		if (part.type === 'uint' || part.type === 'unorm') {
			const value = view.getUint8(offset);
			return part.type === 'unorm' ? value / 0xff : value;
		}
		const value = view.getInt8(offset);
		if (part.type === 'snorm') return Math.max(-1, value / 0x7f);
		return value;
	}

	return undefined;
};

const readElementValues = (
	data: Uint8Array | undefined,
	source: ElementSource | undefined,
	vertexIndex: number
): number[] | undefined => {
	if (!data || !source || source.stride <= 0 || vertexIndex < 0) {
		return undefined;
	}

	const parts = getFormatParts(source.element.Format);
	if (parts.length === 0) {
		return undefined;
	}

	const startOffset = vertexIndex * source.stride + source.offset;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const result: number[] = [];
	let offset = startOffset;
	for (const part of parts) {
		const value = readComponent(view, offset, part);
		if (value === undefined || !Number.isFinite(value)) {
			return undefined;
		}
		result.push(value);
		offset += part.bits / 8;
	}
	return result;
};

const readIndices = (data: Uint8Array, format: string | undefined): number[] => {
	const normalizedFormat = (format || '').toUpperCase();
	const isUint16 = normalizedFormat.includes('R16_UINT');
	const bytesPerIndex = isUint16 ? 2 : 4;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const values: number[] = [];
	for (let offset = 0; offset + bytesPerIndex <= view.byteLength; offset += bytesPerIndex) {
		values.push(isUint16 ? view.getUint16(offset, true) : view.getUint32(offset, true));
	}
	return values;
};

const vertexCapacity = (data: Uint8Array, source: ElementSource): number => {
	return source.stride > 0 ? Math.floor(data.byteLength / source.stride) : 0;
};

type VertexSlice = {
	bufferOffset: number;
	indexOffset: number;
	vertexCount?: number;
};

const parseNonNegativeInteger = (value: number | string | undefined): number => {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getVertexSlice = (dataType: DataTypeItem): VertexSlice => {
	const bufferOffset = parseNonNegativeInteger(dataType.json.VertexOffset);
	const vertexCount = parseNonNegativeInteger(dataType.json.VertexCount);
	if (vertexCount === 0) {
		return { bufferOffset: 0, indexOffset: 0 };
	}

	// TheHerta4 slices every standard vertex buffer first, and only then
	// localises the index buffer when its vertex offset is non-zero.
	return {
		bufferOffset,
		indexOffset: bufferOffset,
		vertexCount,
	};
};

const applyPluginCoordinateSystem = (values: number[]): [number, number, number] => {
	// MeshCreateHelper.set_import_coordinate(): from_forward='-Z', from_up='Y'.
	// Applied to a DirectX position/direction this is (x, -z, y).
	return [values[0], -values[2], values[1]];
};

const getBufferData = async (
	dataType: DataTypeItem,
	source: ElementSource,
	cache: Map<string, Uint8Array>
): Promise<Uint8Array> => {
	const fileName = source.buffer.FileName?.trim() || '';
	if (!fileName) {
		throw new Error('Category buffer file name is missing.');
	}
	const cached = cache.get(fileName);
	if (cached) {
		return cached;
	}
	const path = await join(dataType.folderPath, fileName);
	const data = await readFile(path);
	cache.set(fileName, data);
	return data;
};

const createMaterial = (color = fallbackColor.value, needsReview = false) => {
	return new THREE.ShaderMaterial({
		uniforms: {
			uDiffuseMap: { value: null },
			uNormalMap: { value: null },
			uHasDiffuseMap: { value: 0 },
			uHasNormalMap: { value: 0 },
			uNormalStrength: { value: normalStrength.value },
			uFallbackColor: { value: color.clone() },
			uNeedsReview: { value: needsReview ? 1 : 0 },
			uEmissionEnabled: { value: diffuseAlphaEmissionEnabled.value ? 1 : 0 },
			uEmissionColor: { value: new THREE.Color(emissionColor.value) },
			uEmissionFactor: { value: Math.max(0, emissionFactor.value || 0) },
			// This direction is deliberately expressed in world coordinates.  Camera
			// orbiting, or a future mesh transform, must not rotate the light.
			uWorldLightDirection: { value: new THREE.Vector3(0.4, 0.8, 0.55).normalize() },
		},
		vertexShader: `
			varying vec2 vUv;
			varying vec3 vWorldPosition;
			varying vec3 vWorldNormal;

			void main() {
				vUv = uv;
				vec4 worldPosition = modelMatrix * vec4(position, 1.0);
				vWorldPosition = worldPosition.xyz;
				vWorldNormal = normalize(mat3(modelMatrix) * normal);
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: `
			uniform sampler2D uDiffuseMap;
			uniform sampler2D uNormalMap;
			uniform float uHasDiffuseMap;
			uniform float uHasNormalMap;
			uniform float uNormalStrength;
			uniform vec3 uFallbackColor;
			uniform float uNeedsReview;
			uniform float uEmissionEnabled;
			uniform vec3 uEmissionColor;
			uniform float uEmissionFactor;
			uniform vec3 uWorldLightDirection;
			varying vec2 vUv;
			varying vec3 vWorldPosition;
			varying vec3 vWorldNormal;

			vec3 decodeTangentNormal(vec2 encodedXY, float strength) {
				// Several games store unrelated data in B.  Decode only RG and rebuild
				// the positive tangent-space Z component on the unit hemisphere.
				vec2 xy = (encodedXY * 2.0 - 1.0) * strength;
				float xyLength = length(xy);
				if (xyLength > 0.9999) {
					xy *= 0.9999 / xyLength;
				}
				float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
				return normalize(vec3(xy, z));
			}

			vec3 applyTangentNormal(vec3 geometricNormal, vec3 tangentNormal) {
				vec3 positionDx = dFdx(vWorldPosition);
				vec3 positionDy = dFdy(vWorldPosition);
				vec2 uvDx = dFdx(vUv);
				vec2 uvDy = dFdy(vUv);
				float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;

				if (abs(determinant) < 0.000001) {
					return geometricNormal;
				}

				vec3 tangent = (positionDx * uvDy.y - positionDy * uvDx.y) / determinant;
				tangent = normalize(tangent - geometricNormal * dot(geometricNormal, tangent));
				vec3 bitangent = normalize(cross(geometricNormal, tangent));
				if (determinant < 0.0) {
					bitangent = -bitangent;
				}
				return normalize(
					tangent * tangentNormal.x + bitangent * tangentNormal.y + geometricNormal * tangentNormal.z
				);
			}

			void main() {
				vec4 diffuseSample = vec4(uFallbackColor, 0.0);
				if (uHasDiffuseMap > 0.5) {
					diffuseSample = texture2D(uDiffuseMap, vUv);
				}
				vec3 baseColor = diffuseSample.rgb;
				vec3 emission = uEmissionColor * (uEmissionFactor * diffuseSample.a * uEmissionEnabled);
				if (uNeedsReview > 0.5) {
					baseColor = mix(baseColor, vec3(1.0, 0.05, 0.05), 0.5);
				}
				#ifdef UNLIT
					gl_FragColor = vec4(baseColor + emission, 1.0);
				#else
					vec3 normal = normalize(vWorldNormal);
					if (uHasNormalMap > 0.5) {
						vec3 tangentNormal = decodeTangentNormal(texture2D(uNormalMap, vUv).rg, uNormalStrength);
						normal = applyTangentNormal(normal, tangentNormal);
					}
					#ifdef PBR
					vec3 lightDirection = normalize(uWorldLightDirection);
					vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
					vec3 halfVector = normalize(lightDirection + viewDirection);
					float nDotL = max(dot(normal, lightDirection), 0.0);
					float nDotV = max(dot(normal, viewDirection), 0.0);
					float nDotH = max(dot(normal, halfVector), 0.0);
					float vDotH = max(dot(viewDirection, halfVector), 0.0);
					float roughness = 0.56;
					float alpha = roughness * roughness;
					float alphaSquared = alpha * alpha;
					float distribution = alphaSquared / max(3.14159265 * pow(nDotH * nDotH * (alphaSquared - 1.0) + 1.0, 2.0), 0.0001);
					float geometryK = (roughness + 1.0) * (roughness + 1.0) / 8.0;
					float geometry = (nDotV / max(nDotV * (1.0 - geometryK) + geometryK, 0.0001))
						* (nDotL / max(nDotL * (1.0 - geometryK) + geometryK, 0.0001));
					vec3 f0 = vec3(0.04);
					vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vDotH, 5.0);
					vec3 specular = distribution * geometry * fresnel / max(4.0 * nDotV * nDotL, 0.0001);
					vec3 diffuse = (1.0 - fresnel) * baseColor / 3.14159265;
					gl_FragColor = vec4(baseColor * 0.12 + (diffuse + specular) * nDotL + emission, 1.0);
				#else
					float halfLambert = clamp(dot(normal, normalize(uWorldLightDirection)) * 0.5 + 0.5, 0.0, 1.0);
					float toonBand = floor(halfLambert * 3.0 + 0.001) / 2.0;
					vec3 color = baseColor * (0.18 + toonBand * 0.82);
					gl_FragColor = vec4(color + emission, 1.0);
					#endif
				#endif
				#include <colorspace_fragment>
			}
		`,
		side: THREE.DoubleSide,
	});
};

const renderPreview = () => {
	if (renderer && scene && camera) {
		renderer.render(scene, camera);
	}
	if (zoomRenderer && scene && camera) {
		zoomRenderer.render(scene, camera);
	}
};

const resizePreview = () => {
	if (!previewHost.value || !renderer || !camera) {
		return;
	}
	const { width, height } = previewHost.value.getBoundingClientRect();
	if (width <= 0 || height <= 0) {
		return;
	}
	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	renderPreview();
};

const resizeZoomPreview = () => {
	if (!zoomPreviewHost.value || !zoomRenderer || !camera) {
		return;
	}
	const { width, height } = zoomPreviewHost.value.getBoundingClientRect();
	if (width <= 0 || height <= 0) {
		return;
	}
	zoomRenderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	renderPreview();
};

const getPreviewPageBounds = (): DOMRect | undefined => {
	const page = previewHost.value?.closest('.mark-texture-page');
	return page?.getBoundingClientRect();
};

const updateZoomPreviewBounds = () => {
	const pageBounds = getPreviewPageBounds();
	if (!pageBounds || pageBounds.width <= 0 || pageBounds.height <= 0) {
		return;
	}
	// This is a bare model overlay now: fit the square directly to the post-
	// processing page, rather than reserving title or dialog chrome.
	const pageMargin = 18;
	const canvasSize = Math.max(1, Math.floor(Math.min(
		1_000,
		pageBounds.width - pageMargin * 2,
		pageBounds.height - pageMargin * 2,
	)));
	previewZoomDialogStyle.value = {
		'--preview-zoom-canvas-size': `${canvasSize}px`,
		'--preview-zoom-canvas-left': `${Math.round(pageBounds.left + (pageBounds.width - canvasSize) / 2)}px`,
		'--preview-zoom-canvas-top': `${Math.round(pageBounds.top + (pageBounds.height - canvasSize) / 2)}px`,
	};
};

const openZoomPreview = () => {
	if (!mesh || previewZoomOpen.value) {
		return;
	}
	previewZoomOpen.value = true;
	void nextTick(() => {
		updateZoomPreviewBounds();
		initializeZoomRenderer();
		void applyFullSizeZoomTextures();
	});
};

const closeZoomPreview = () => {
	restoreEmbeddedPreviewTextures();
	previewZoomOpen.value = false;
	disposeZoomRenderer();
};

const suppressZoomOverlayKeyboard = (event: KeyboardEvent) => {
	if (event.key === 'Escape') {
		event.preventDefault();
		event.stopImmediatePropagation();
		closeZoomPreview();
		return;
	}
	// The fullscreen preview is modal for application content. Do not let page
	// shortcuts, selection controls, or focused form inputs react underneath it.
	event.preventDefault();
	event.stopImmediatePropagation();
};

const initializeZoomRenderer = () => {
	if (!zoomPreviewHost.value || zoomRenderer) {
		return;
	}
	zoomRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
	zoomRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	zoomRenderer.setClearColor(0x000000, 0);
	zoomRenderer.outputColorSpace = THREE.SRGBColorSpace;
	zoomPreviewHost.value.appendChild(zoomRenderer.domElement);
	disposeZoomPointerControls = createModelPointerControls(zoomRenderer.domElement, closeZoomPreview);
	if (camera) {
		zoomControls = new OrbitControls(camera, zoomRenderer.domElement);
		zoomControls.enableDamping = false;
		zoomControls.enableRotate = false;
		zoomControls.enablePan = false;
		zoomControls.zoomSpeed = 1.1;
		zoomControls.target.copy(rotationCenter);
		// OrbitControls is constructed with target=(0,0,0). Its constructor may
		// immediately update the shared camera against that default target.
		// Apply the real model pivot immediately; otherwise the camera stays aimed
		// at the origin until the first wheel/pointer interaction calls update().
		zoomControls.update();
		zoomControls.addEventListener('change', renderPreview);
	}
	const previewPage = previewHost.value?.closest('.mark-texture-page');
	if (previewPage) {
		zoomBoundsObserver = new ResizeObserver(updateZoomPreviewBounds);
		zoomBoundsObserver.observe(previewPage);
	}
	window.addEventListener('resize', updateZoomPreviewBounds);
	window.addEventListener('keydown', suppressZoomOverlayKeyboard, true);
	updateZoomPreviewBounds();
	zoomResizeObserver = new ResizeObserver(resizeZoomPreview);
	zoomResizeObserver.observe(zoomPreviewHost.value);
	resizeZoomPreview();
};

const disposeZoomRenderer = () => {
	zoomResizeObserver?.disconnect();
	zoomResizeObserver = undefined;
	zoomBoundsObserver?.disconnect();
	zoomBoundsObserver = undefined;
	window.removeEventListener('resize', updateZoomPreviewBounds);
	window.removeEventListener('keydown', suppressZoomOverlayKeyboard, true);
	disposeZoomPointerControls?.();
	disposeZoomPointerControls = undefined;
	zoomControls?.dispose();
	zoomControls = undefined;
	zoomRenderer?.dispose();
	zoomRenderer?.domElement.remove();
	zoomRenderer = undefined;
	// The zoom canvas owns the shared camera aspect while open. Restore the
	// embedded square canvas immediately after the dialog has closed.
	void nextTick(resizePreview);
};

const getGeometrySurfaceCentroid = (geometry: THREE.BufferGeometry): THREE.Vector3 => {
	const position = geometry.getAttribute('position');
	if (!position || position.count === 0) {
		return new THREE.Vector3();
	}

	const centroid = new THREE.Vector3();
	const triangleCentroid = new THREE.Vector3();
	const vertexA = new THREE.Vector3();
	const vertexB = new THREE.Vector3();
	const vertexC = new THREE.Vector3();
	const edgeAB = new THREE.Vector3();
	const edgeAC = new THREE.Vector3();
	let totalDoubleArea = 0;
	const index = geometry.getIndex();
	const vertexIndexAt = (offset: number): number => index ? index.getX(offset) : offset;
	const triangleVertexCount = index ? index.count : position.count;

	// Area-weighted triangle centroids provide a stable rotation point even for
	// unevenly tessellated meshes.  This is the preview's initial centre of mass.
	for (let offset = 0; offset + 2 < triangleVertexCount; offset += 3) {
		vertexA.fromBufferAttribute(position, vertexIndexAt(offset));
		vertexB.fromBufferAttribute(position, vertexIndexAt(offset + 1));
		vertexC.fromBufferAttribute(position, vertexIndexAt(offset + 2));
		edgeAB.subVectors(vertexB, vertexA);
		edgeAC.subVectors(vertexC, vertexA);
		const doubleArea = edgeAB.cross(edgeAC).length();
		if (doubleArea <= 0.0000001) {
			continue;
		}
		triangleCentroid.copy(vertexA).add(vertexB).add(vertexC).multiplyScalar(1 / 3);
		centroid.addScaledVector(triangleCentroid, doubleArea);
		totalDoubleArea += doubleArea;
	}

	if (totalDoubleArea > 0) {
		return centroid.multiplyScalar(1 / totalDoubleArea);
	}

	// Degenerate geometry has no meaningful surface area; use the arithmetic
	// mean of its vertices instead of leaving the rotation origin at (0, 0, 0).
	for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
		centroid.add(new THREE.Vector3().fromBufferAttribute(position, vertexIndex));
	}
	return centroid.multiplyScalar(1 / position.count);
};

const framePreview = () => {
	if (!previewRoot || !camera || !controls) {
		return;
	}
	// Review meshes may have implausibly huge coordinates.  They must remain
	// visible, but cannot be allowed to push normal components out of view.
	const objectsToFrame = framingMeshes.length > 0 ? framingMeshes : [previewRoot];
	const box = new THREE.Box3();
	for (const object of objectsToFrame) {
		box.expandByObject(object);
	}
	if (box.isEmpty()) {
		return;
	}
	const center = rotationCenter.clone();
	const size = box.getSize(new THREE.Vector3());
	const actualDiameter = Math.max(size.x, size.y, size.z, 0.001);
	// A two-metre object is the initial framing reference.  Capping the fitting
	// diameter prevents a malformed component from making the whole preview
	// appear empty; users can still zoom out with the wheel to inspect it.
	const diameter = Math.min(actualDiameter, PREVIEW_REFERENCE_FRAME_DIAMETER_METERS);
	const distance = diameter / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
	camera.near = Math.max(diameter / 1_000, 0.001);
	camera.far = Math.max(actualDiameter * 1_000, 100);
	camera.position.copy(center).add(new THREE.Vector3(1.1, 0.82, 1.25).normalize().multiplyScalar(distance * PREVIEW_CAMERA_DISTANCE_MULTIPLIER));
	camera.updateProjectionMatrix();
	controls.target.copy(center);
	controls.update();
	renderPreview();
};

const clearPreviewMesh = () => {
	outlineController.dispose();
	if (previewRoot && scene) {
		scene.remove(previewRoot);
		const disposedGeometries = new Set<THREE.BufferGeometry>();
		previewRoot.traverse(object => {
			if (object instanceof THREE.Mesh && !disposedGeometries.has(object.geometry)) {
				disposedGeometries.add(object.geometry);
				object.geometry.dispose();
			}
		});
	}
	for (const passiveMaterial of passiveMaterials) {
		const diffuse = passiveMaterial.uniforms.uDiffuseMap.value as THREE.Texture | null;
		const normal = passiveMaterial.uniforms.uNormalMap.value as THREE.Texture | null;
		diffuse?.dispose();
		normal?.dispose();
		passiveMaterial.dispose();
	}
	passiveMaterials = [];
	previewRoot = undefined;
	framingMeshes = [];
	mesh = undefined;
	rotationCenter.set(0, 0, 0);
	renderPreview();
};

const createModelPointerControls = (canvas: HTMLCanvasElement, onTap?: () => void): (() => void) => {
	let activePointerId: number | undefined;
	let lastPointerX = 0;
	let lastPointerY = 0;
	let didDrag = false;
	const worldUp = new THREE.Vector3(0, 1, 0);
	const worldRight = new THREE.Vector3();
	const worldUpFromCamera = new THREE.Vector3();

	const movePreviewObject = (deltaX: number, deltaY: number) => {
		if (!camera || !previewRoot) {
			return;
		}
		camera.updateMatrixWorld();
		const viewportHeight = Math.max(canvas.clientHeight, 1);
		const cameraDistance = Math.max(camera.position.distanceTo(rotationCenter), 0.001);
		const worldUnitsPerPixel = (2 * cameraDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) / viewportHeight;
		worldRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
		worldUpFromCamera.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
		// The world-space pivot and camera target stay fixed at the screen
		// centre. Shift-drag changes only the model's offset from that pivot.
		previewRoot.position.addScaledVector(worldRight, deltaX * worldUnitsPerPixel);
		previewRoot.position.addScaledVector(worldUpFromCamera, -deltaY * worldUnitsPerPixel);
	};

	const rotateMeshAroundCenter = (axis: THREE.Vector3, angle: number) => {
		if (!previewRoot) {
			return;
		}
		const offsetFromCenter = previewRoot.position.clone().sub(rotationCenter).applyAxisAngle(axis, angle);
		previewRoot.position.copy(rotationCenter).add(offsetFromCenter);
		previewRoot.rotateOnWorldAxis(axis, angle);
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || !previewRoot || !camera) {
			return;
		}
		activePointerId = event.pointerId;
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
		didDrag = false;
		canvas.setPointerCapture(event.pointerId);
		event.preventDefault();
	};

	const onPointerMove = (event: PointerEvent) => {
		if (event.pointerId !== activePointerId || !previewRoot || !camera) {
			return;
		}
		const deltaX = event.clientX - lastPointerX;
		const deltaY = event.clientY - lastPointerY;
		if (Math.abs(deltaX) + Math.abs(deltaY) > 1) {
			didDrag = true;
		}
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;

		if (event.shiftKey) {
			movePreviewObject(deltaX, deltaY);
		} else {
			// Rotate the model itself around its current centre.  The shader
			// transforms normals through modelMatrix into world space while
			// uWorldLightDirection remains a world-space constant.
			rotateMeshAroundCenter(worldUp, deltaX * 0.01);
			worldRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
			rotateMeshAroundCenter(worldRight, deltaY * 0.01);
		}
		previewRoot.updateMatrixWorld(true);
		renderPreview();
		event.preventDefault();
	};

	const releasePointer = (event: PointerEvent) => {
		if (event.pointerId !== activePointerId) {
			return;
		}
		if (canvas.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}
		const shouldTap = !didDrag && event.type === 'pointerup';
		activePointerId = undefined;
		if (shouldTap) onTap?.();
	};

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', releasePointer);
	canvas.addEventListener('pointercancel', releasePointer);
	return () => {
		canvas.removeEventListener('pointerdown', onPointerDown);
		canvas.removeEventListener('pointermove', onPointerMove);
		canvas.removeEventListener('pointerup', releasePointer);
		canvas.removeEventListener('pointercancel', releasePointer);
	};
};

const initializePreviewPointerControls = () => {
	if (!renderer) {
		return;
	}
	disposePreviewPointerControls?.();
	disposePreviewPointerControls = createModelPointerControls(renderer.domElement);
};

const updateMaterialMode = () => {
	const previewMaterials = [material, ...passiveMaterials].filter((item): item is THREE.ShaderMaterial => !!item);
	if (previewMaterials.length === 0) {
		return;
	}
	for (const previewMaterial of previewMaterials) {
		const { UNLIT: _unlit, PBR: _pbr, ...nextDefines } = previewMaterial.defines ?? {};
		previewMaterial.defines = lightingMode.value === 'unlit'
			? { ...nextDefines, UNLIT: 1 }
			: lightingMode.value === 'pbr'
				? { ...nextDefines, PBR: 1 }
				: nextDefines;
		previewMaterial.needsUpdate = true;
	}
	renderPreview();
};

const updateMaterialSettings = () => {
	for (const previewMaterial of [material, ...passiveMaterials]) {
		if (previewMaterial) {
			previewMaterial.uniforms.uNormalStrength.value = normalStrength.value;
			previewMaterial.uniforms.uEmissionEnabled.value = diffuseAlphaEmissionEnabled.value ? 1 : 0;
			previewMaterial.uniforms.uEmissionColor.value.set(emissionColor.value);
			previewMaterial.uniforms.uEmissionFactor.value = Math.max(0, emissionFactor.value || 0);
		}
	}
	if (material) {
		material.uniforms.uFallbackColor.value.copy(fallbackColor.value);
	}
	renderPreview();
};

const replaceTexture = (kind: 'diffuse' | 'normal', texture: THREE.Texture | undefined) => {
	if (!material) {
		texture?.dispose();
		return;
	}
	if (kind === 'diffuse') {
		diffuseTexture?.dispose();
		diffuseTexture = texture;
		material.uniforms.uDiffuseMap.value = texture ?? null;
		material.uniforms.uHasDiffuseMap.value = texture ? 1 : 0;
	} else {
		normalTexture?.dispose();
		normalTexture = texture;
		material.uniforms.uNormalMap.value = texture ?? null;
		material.uniforms.uHasNormalMap.value = texture ? 1 : 0;
	}
	renderPreview();
};

const applyTextureToMaterial = (
	targetMaterial: THREE.ShaderMaterial,
	kind: 'diffuse' | 'normal',
	texture: THREE.Texture | undefined
) => {
	if (kind === 'diffuse') {
		targetMaterial.uniforms.uDiffuseMap.value = texture ?? null;
		targetMaterial.uniforms.uHasDiffuseMap.value = texture ? 1 : 0;
	} else {
		targetMaterial.uniforms.uNormalMap.value = texture ?? null;
		targetMaterial.uniforms.uHasNormalMap.value = texture ? 1 : 0;
	}
};

const loadTexture = (url: string, colorTexture: boolean): Promise<THREE.Texture | undefined> => {
	if (!url) {
		return Promise.resolve(undefined);
	}
	return new Promise(resolve => {
		new THREE.TextureLoader().load(
			url,
			texture => {
				texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
				texture.wrapS = THREE.RepeatWrapping;
				texture.wrapT = THREE.RepeatWrapping;
				texture.anisotropy = 1;
				resolve(texture);
			},
			undefined,
			() => resolve(undefined)
		);
	});
};

const decodeRgbaDds = (bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } => {
	if (bytes.byteLength < 128 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'DDS ') {
		throw new Error('Invalid DDS texture');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const height = view.getUint32(12, true);
	const width = view.getUint32(16, true);
	const hasDx10Header = view.getUint32(84, true) === 0x30315844;
	const dataOffset = hasDx10Header ? 148 : 128;
	const byteLength = width * height * 4;
	if (!width || !height || dataOffset + byteLength > bytes.byteLength) {
		throw new Error('Incomplete DDS texture');
	}
	return { width, height, pixels: bytes.slice(dataOffset, dataOffset + byteLength) };
};

const loadCompressedDdsTexture = async (ddsPath: string, colorTexture: boolean): Promise<THREE.Texture | undefined> => {
	if (!renderer || !ddsPath) return undefined;
	const bytes = await readFile(ddsPath);
	if (bytes.byteLength < 128 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'DDS ') return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16, true);
	const height = view.getUint32(12, true);
	const mipCount = Math.max(1, view.getUint32(28, true));
	const fourCc = view.getUint32(84, true);
	const hasDx10Header = fourCc === 0x30315844;
	const dxgiFormat = hasDx10Header ? view.getUint32(128, true) : 0;
	const legacyFourCc = String.fromCharCode(fourCc & 0xff, (fourCc >>> 8) & 0xff, (fourCc >>> 16) & 0xff, (fourCc >>> 24) & 0xff);
	let format: THREE.CompressedPixelFormat | undefined;
	let blockBytes = 16;
	let extensionName = '';
	if (dxgiFormat === 71 || dxgiFormat === 72 || legacyFourCc === 'DXT1') {
		format = THREE.RGBA_S3TC_DXT1_Format;
		blockBytes = 8;
		extensionName = 'WEBGL_compressed_texture_s3tc';
	} else if (dxgiFormat === 74 || dxgiFormat === 75 || legacyFourCc === 'DXT3') {
		format = THREE.RGBA_S3TC_DXT3_Format;
		extensionName = 'WEBGL_compressed_texture_s3tc';
	} else if (dxgiFormat === 77 || dxgiFormat === 78 || legacyFourCc === 'DXT5') {
		format = THREE.RGBA_S3TC_DXT5_Format;
		extensionName = 'WEBGL_compressed_texture_s3tc';
	} else if (dxgiFormat === 80 || dxgiFormat === 81 || legacyFourCc === 'ATI1' || legacyFourCc === 'BC4U') {
		format = dxgiFormat === 81 ? THREE.SIGNED_RED_RGTC1_Format : THREE.RED_RGTC1_Format;
		blockBytes = 8;
		extensionName = 'EXT_texture_compression_rgtc';
	} else if (dxgiFormat === 83 || dxgiFormat === 84 || legacyFourCc === 'ATI2' || legacyFourCc === 'BC5U') {
		format = dxgiFormat === 84 ? THREE.SIGNED_RED_GREEN_RGTC2_Format : THREE.RED_GREEN_RGTC2_Format;
		extensionName = 'EXT_texture_compression_rgtc';
	} else if (dxgiFormat === 98 || dxgiFormat === 99) {
		format = THREE.RGBA_BPTC_Format;
		extensionName = 'EXT_texture_compression_bptc';
	}
	if (!format || !renderer.getContext().getExtension(extensionName)) return undefined;
	let offset = hasDx10Header ? 148 : 128;
	let mipWidth = width;
	let mipHeight = height;
	const mipmaps: Array<{ data: Uint8Array; width: number; height: number }> = [];
	for (let level = 0; level < mipCount; level += 1) {
		const byteLength = Math.max(1, Math.ceil(mipWidth / 4)) * Math.max(1, Math.ceil(mipHeight / 4)) * blockBytes;
		if (offset + byteLength > bytes.byteLength) return undefined;
		mipmaps.push({ data: bytes.subarray(offset, offset + byteLength), width: mipWidth, height: mipHeight });
		offset += byteLength;
		mipWidth = Math.max(1, mipWidth >> 1);
		mipHeight = Math.max(1, mipHeight >> 1);
	}
	const texture = new THREE.CompressedTexture(mipmaps, width, height, format, THREE.UnsignedByteType);
	texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	// Geometry already converts the DDS/3DMigoto V coordinate to Blender's UV
	// convention. Keep raw and compressed uploads identical and do not flip twice.
	texture.flipY = false;
	texture.generateMipmaps = false;
	texture.minFilter = mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
};

const loadDdsTexture = async (
	ddsPath: string,
	colorTexture: boolean,
	maxDimension: number | undefined = DDS_3D_TEXTURE_MAX_DIMENSION
): Promise<THREE.Texture | undefined> => {
	if (!ddsPath) return undefined;
	try {
		const compressedTexture = await loadCompressedDdsTexture(ddsPath, colorTexture);
		if (compressedTexture) return compressedTexture;
		const preparedPath = await invoke<string>('prepare_dds_webgl_preview', maxDimension
			? { sourcePath: ddsPath, maxDimension }
			: { sourcePath: ddsPath });
		const decoded = decodeRgbaDds(await readFile(preparedPath));
		const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat, THREE.UnsignedByteType);
		texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		// The geometry owns the V-axis conversion; DDS pixels stay in source order.
		texture.flipY = false;
		texture.generateMipmaps = true;
		texture.minFilter = THREE.LinearMipmapLinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.needsUpdate = true;
		return texture;
	} catch (error) {
		console.warn('Failed to load DDS preview texture', ddsPath, error);
		return undefined;
	}
};

const restoreEmbeddedPreviewTextures = () => {
	zoomTextureToken += 1;
	for (const snapshot of zoomTextureSnapshots) {
		snapshot.material.uniforms.uDiffuseMap.value = snapshot.diffuse;
		snapshot.material.uniforms.uHasDiffuseMap.value = snapshot.diffuse ? 1 : 0;
		snapshot.material.uniforms.uNormalMap.value = snapshot.normal;
		snapshot.material.uniforms.uHasNormalMap.value = snapshot.normal ? 1 : 0;
	}
	zoomTextureSnapshots = [];
	for (const texture of zoomFullTextures) texture.dispose();
	zoomFullTextures = [];
	renderPreview();
};

const applyFullSizeZoomTextures = async () => {
	restoreEmbeddedPreviewTextures();
	// restoreEmbeddedPreviewTextures increments the token to invalidate older work.
	const activeToken = ++zoomTextureToken;
	zoomTextureSnapshots = previewMaterialTextureSources.map(source => ({
		material: source.material,
		diffuse: source.material.uniforms.uDiffuseMap.value as THREE.Texture | null,
		normal: source.material.uniforms.uNormalMap.value as THREE.Texture | null,
	}));
	const loaded = await mapWithConcurrency(previewMaterialTextureSources, async source => ({
		source,
		diffuse: await loadDdsTexture(source.diffuseDdsPath, true, undefined),
		normal: await loadDdsTexture(source.normalDdsPath, false, undefined),
	}));
	if (!previewZoomOpen.value || activeToken !== zoomTextureToken) {
		for (const item of loaded) {
			item.diffuse?.dispose();
			item.normal?.dispose();
		}
		return;
	}
	for (const item of loaded) {
		if (item.diffuse) {
			item.source.material.uniforms.uDiffuseMap.value = item.diffuse;
			item.source.material.uniforms.uHasDiffuseMap.value = 1;
			zoomFullTextures.push(item.diffuse);
		}
		if (item.normal) {
			item.source.material.uniforms.uNormalMap.value = item.normal;
			item.source.material.uniforms.uHasNormalMap.value = 1;
			zoomFullTextures.push(item.normal);
		}
	}
	renderPreview();
};

const loadPreviewTexture = (ddsPath: string, url: string, colorTexture: boolean) => (
	ddsPath ? loadDdsTexture(ddsPath, colorTexture) : loadTexture(url, colorTexture)
);

const updateMaterialTextures = async () => {
	const token = ++textureLoadToken;
	const [nextDiffuse, nextNormal] = await Promise.all([
		loadPreviewTexture(selectedDiffuse.value?.ddsPath || '', selectedDiffuse.value?.url || '', true),
		loadPreviewTexture(selectedNormal.value?.ddsPath || '', selectedNormal.value?.url || '', false),
	]);
	if (token !== textureLoadToken) {
		nextDiffuse?.dispose();
		nextNormal?.dispose();
		return;
	}
	replaceTexture('diffuse', nextDiffuse);
	replaceTexture('normal', nextNormal);
};

type PreviewGeometryBuildResult = {
	geometry: THREE.BufferGeometry;
	status: string;
	needsReview?: boolean;
};

const createPreviewGeometry = async (
	dataType: DataTypeItem,
	uvLayer: UvLayer,
	buildToken: number
): Promise<PreviewGeometryBuildResult | undefined> => {

	const positionSource = getElementSources(dataType, 'POSITION')[0];
	const normalSource = getElementSources(dataType, 'NORMAL')[0];
	const tangentSource = getElementSources(dataType, 'TANGENT')[0];
	const colorSource = getElementSources(dataType, 'COLOR')[0];
	const indexBuffer = dataType.json.IndexBufferList?.[0];
	if (!positionSource || !indexBuffer?.FileName) {
		throw new Error(t('markTexture.preview.unsupportedGeometry'));
	}

	const sourceBufferCache = new Map<string, Uint8Array>();
	const [positionData, normalData, tangentData, colorData, uvData, indexData] = await Promise.all([
		getBufferData(dataType, positionSource, sourceBufferCache),
		normalSource ? getBufferData(dataType, normalSource, sourceBufferCache) : Promise.resolve(undefined),
		tangentSource ? getBufferData(dataType, tangentSource, sourceBufferCache) : Promise.resolve(undefined),
		colorSource ? getBufferData(dataType, colorSource, sourceBufferCache) : Promise.resolve(undefined),
		getBufferData(dataType, uvLayer, sourceBufferCache),
		readFile(await join(dataType.folderPath, indexBuffer.FileName)),
	]);
	// The TYPE folder and the UV selector can both change while a previous
	// buffer read is in flight.  Never let that older read replace the newer
	// mesh: doing so leaves the UI displaying one UV layer while the canvas is
	// actually sampling another one.
	if (buildToken !== previewBuildToken) {
		return undefined;
	}
	const sourceIndices = readIndices(indexData, indexBuffer.DXGI_FORMAT);
	const streamCapacities = [
		vertexCapacity(positionData, positionSource),
		vertexCapacity(uvData, uvLayer),
		...(normalData && normalSource ? [vertexCapacity(normalData, normalSource)] : []),
	];
	if (streamCapacities.some(capacity => capacity <= 0 || capacity !== streamCapacities[0])) {
		throw new Error(t('markTexture.preview.unsupportedGeometry'));
	}
	const vertexSlice = getVertexSlice(dataType);
	const sourceVertexCapacity = streamCapacities[0];
	const activeVertexCount = vertexSlice.vertexCount ?? sourceVertexCapacity;
	if (vertexSlice.bufferOffset + activeVertexCount > sourceVertexCapacity) {
		throw new Error(t('markTexture.preview.unsupportedGeometry'));
	}
	const maxIndexCount = Math.min(
		sourceIndices.length - (sourceIndices.length % 3),
		MAX_PREVIEW_INDEX_COUNT
	);
	const remappedIndices: number[] = [];
	const positions: number[] = [];
	const normals: number[] = [];
	const rawTangents: number[] = [];
	const rawColors: number[] = [];
	const rawNormalW: number[] = [];
	const uvs: number[] = [];
	const remap = new Map<number, number>();
	let useSourceNormals = !!normalSource;
	let skippedTriangleCount = 0;
	let hasImplausibleCoordinates = false;
	const shouldReverseWinding = REVERSED_WINDING_GAME_PRESETS.has(normalizeSemantic(dataType.json.GamePreset));

	for (let indexOffset = 0; indexOffset < maxIndexCount; indexOffset += 3) {
		if (indexOffset > 0 && indexOffset % (PREVIEW_GEOMETRY_YIELD_TRIANGLES * 3) === 0) {
			await yieldPreviewGeometryWork();
			if (buildToken !== previewBuildToken) return undefined;
		}
		const triangleSourceIndices = sourceIndices
			.slice(indexOffset, indexOffset + 3)
			.map(index => index - vertexSlice.indexOffset);
		if (shouldReverseWinding) {
			triangleSourceIndices.reverse();
		}
		if (triangleSourceIndices.some(index => index < 0 || index >= activeVertexCount)) {
			skippedTriangleCount += 1;
			continue;
		}
		const triangleBufferIndices = triangleSourceIndices.map(index => index + vertexSlice.bufferOffset);
		const trianglePositions = triangleBufferIndices.map(index => readElementValues(positionData, positionSource, index));
		const triangleUvs = triangleBufferIndices.map(index => readElementValues(uvData, uvLayer, index));
		if (
			trianglePositions.some(values => !values || values.length < 3)
			|| triangleUvs.some(values => !values || values.length < 2)
		) {
			skippedTriangleCount += 1;
			continue;
		}

		for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
			const sourceIndex = triangleSourceIndices[vertexOffset];
			const bufferIndex = triangleBufferIndices[vertexOffset];
			let targetIndex = remap.get(sourceIndex);
			if (targetIndex === undefined) {
				targetIndex = remap.size;
				remap.set(sourceIndex, targetIndex);
				const position = applyPluginCoordinateSystem(trianglePositions[vertexOffset]!);
				if (position.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_REASONABLE_PREVIEW_COORDINATE_METERS)) {
					hasImplausibleCoordinates = true;
				}
				const normalValues = readElementValues(normalData, normalSource, bufferIndex);
				const tangentValues = readElementValues(tangentData, tangentSource, bufferIndex);
				const colorValues = readElementValues(colorData, colorSource, bufferIndex);
				const uv = triangleUvs[vertexOffset]!;
				positions.push(...position);
				if (normalValues && normalValues.length >= 3) {
					normals.push(...applyPluginCoordinateSystem(normalValues));
				} else {
					useSourceNormals = false;
					normals.push(0, 0, 0);
				}
				const tangent = tangentValues && tangentValues.length >= 3
					? applyPluginCoordinateSystem(tangentValues)
					: [0, 0, 0];
				rawTangents.push(tangent[0], tangent[1], tangent[2], tangentValues?.[3] ?? 1);
				rawColors.push(colorValues?.[0] ?? 1, colorValues?.[1] ?? 1, colorValues?.[2] ?? 1, colorValues?.[3] ?? 1);
				rawNormalW.push(normalValues?.[3] ?? 0);
				// Keep 3DMigoto's UVs unchanged. DDS rows and Direct3D UVs share a
				// top-origin convention; uploading DDS data without flipY preserves it.
				// Blender's importer uses 1 - v for Blender only and is not applicable here.
				uvs.push(uv[0], uv[1]);
			}
			remappedIndices.push(targetIndex);
		}
	}

	if (remappedIndices.length === 0) {
		throw new Error(t('markTexture.preview.noRenderableTriangles'));
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setAttribute('ssmtRawTangent', new THREE.Float32BufferAttribute(rawTangents, 4));
	geometry.setAttribute('ssmtRawColor', new THREE.Float32BufferAttribute(rawColors, 4));
	geometry.setAttribute('ssmtRawNormalW', new THREE.Float32BufferAttribute(rawNormalW, 1));
	geometry.setIndex(
		new THREE.BufferAttribute(
			remap.size > 65_535 ? new Uint32Array(remappedIndices) : new Uint16Array(remappedIndices),
			1
		)
	);
	if (useSourceNormals) {
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	} else {
		geometry.computeVertexNormals();
	}
	geometry.computeBoundingSphere();

	if (buildToken !== previewBuildToken) {
		geometry.dispose();
		return undefined;
	}
	return {
		geometry,
		status: sourceIndices.length > MAX_PREVIEW_INDEX_COUNT
			? t('markTexture.preview.previewLimited', { count: MAX_PREVIEW_INDEX_COUNT.toLocaleString() })
			: skippedTriangleCount > 0
				? t('markTexture.preview.skippedInvalidTriangles', { count: skippedTriangleCount })
				: t('markTexture.preview.vertexTriangleCount', {
					vertices: remap.size.toLocaleString(),
					triangles: (remappedIndices.length / 3).toLocaleString(),
				}),
		needsReview: hasImplausibleCoordinates,
	};
};

/**
 * Keep a problematic component visible instead of silently dropping it.  This
 * path intentionally favours observability over perfect reconstruction: it
 * reads positions directly from the full source stream, gives absent UVs a
 * neutral value, and only folds genuinely out-of-range indices back into the
 * available vertex buffer.  It is used for incomplete or unusual data types.
 */
const createPermissivePreviewGeometry = async (
	dataType: DataTypeItem,
	buildToken: number
): Promise<PreviewGeometryBuildResult | undefined> => {
	const positionSource = getElementSources(dataType, 'POSITION')[0];
	const normalSource = getElementSources(dataType, 'NORMAL')[0];
	const tangentSource = getElementSources(dataType, 'TANGENT')[0];
	const colorSource = getElementSources(dataType, 'COLOR')[0];
	const indexBuffer = dataType.json.IndexBufferList?.[0];
	if (!positionSource || !indexBuffer?.FileName) {
		return undefined;
	}

	const sourceBufferCache = new Map<string, Uint8Array>();
	const [positionData, normalData, tangentData, colorData, indexData] = await Promise.all([
		getBufferData(dataType, positionSource, sourceBufferCache),
		normalSource ? getBufferData(dataType, normalSource, sourceBufferCache) : Promise.resolve(undefined),
		tangentSource ? getBufferData(dataType, tangentSource, sourceBufferCache) : Promise.resolve(undefined),
		colorSource ? getBufferData(dataType, colorSource, sourceBufferCache) : Promise.resolve(undefined),
		readFile(await join(dataType.folderPath, indexBuffer.FileName)),
	]);
	if (buildToken !== previewBuildToken) {
		return undefined;
	}

	const capacity = vertexCapacity(positionData, positionSource);
	if (capacity <= 0) {
		return undefined;
	}
	const sourceIndices = readIndices(indexData, indexBuffer.DXGI_FORMAT);
	const maxIndexCount = Math.min(
		sourceIndices.length - (sourceIndices.length % 3),
		MAX_PREVIEW_INDEX_COUNT
	);
	const positions: number[] = [];
	const normals: number[] = [];
	const rawTangents: number[] = [];
	const rawColors: number[] = [];
	const rawNormalW: number[] = [];
	const uvs: number[] = [];
	const remappedIndices: number[] = [];
	const remap = new Map<number, number>();
	let useSourceNormals = !!normalSource;
	const shouldReverseWinding = REVERSED_WINDING_GAME_PRESETS.has(normalizeSemantic(dataType.json.GamePreset));

	for (let indexOffset = 0; indexOffset < maxIndexCount; indexOffset += 3) {
		if (indexOffset > 0 && indexOffset % (PREVIEW_GEOMETRY_YIELD_TRIANGLES * 3) === 0) {
			await yieldPreviewGeometryWork();
			if (buildToken !== previewBuildToken) return undefined;
		}
		const triangle = sourceIndices.slice(indexOffset, indexOffset + 3).map(rawIndex => (
			rawIndex >= 0 && rawIndex < capacity
				? rawIndex
				: ((rawIndex % capacity) + capacity) % capacity
		));
		if (shouldReverseWinding) triangle.reverse();
		const triangleRemappedIndices: number[] = [];
		let isValidTriangle = true;
		for (const bufferIndex of triangle) {
			let targetIndex = remap.get(bufferIndex);
			if (targetIndex === undefined) {
				const positionValues = readElementValues(positionData, positionSource, bufferIndex);
				if (!positionValues || positionValues.length < 3) {
					isValidTriangle = false;
					break;
				}
				targetIndex = remap.size;
				remap.set(bufferIndex, targetIndex);
				positions.push(...applyPluginCoordinateSystem(positionValues));
				const normalValues = readElementValues(normalData, normalSource, bufferIndex);
				const tangentValues = readElementValues(tangentData, tangentSource, bufferIndex);
				const colorValues = readElementValues(colorData, colorSource, bufferIndex);
				if (normalValues && normalValues.length >= 3) {
					normals.push(...applyPluginCoordinateSystem(normalValues));
				} else {
					useSourceNormals = false;
					normals.push(0, 0, 0);
				}
				const tangent = tangentValues && tangentValues.length >= 3
					? applyPluginCoordinateSystem(tangentValues)
					: [0, 0, 0];
				rawTangents.push(tangent[0], tangent[1], tangent[2], tangentValues?.[3] ?? 1);
				rawColors.push(colorValues?.[0] ?? 1, colorValues?.[1] ?? 1, colorValues?.[2] ?? 1, colorValues?.[3] ?? 1);
				rawNormalW.push(normalValues?.[3] ?? 0);
				uvs.push(0, 0);
			}
			triangleRemappedIndices.push(targetIndex);
		}
		if (isValidTriangle && triangleRemappedIndices.length === 3) {
			remappedIndices.push(...triangleRemappedIndices);
		}
	}

	if (remappedIndices.length < 3 || buildToken !== previewBuildToken) {
		return undefined;
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setAttribute('ssmtRawTangent', new THREE.Float32BufferAttribute(rawTangents, 4));
	geometry.setAttribute('ssmtRawColor', new THREE.Float32BufferAttribute(rawColors, 4));
	geometry.setAttribute('ssmtRawNormalW', new THREE.Float32BufferAttribute(rawNormalW, 1));
	geometry.setIndex(new THREE.BufferAttribute(
		remap.size > 65_535 ? new Uint32Array(remappedIndices) : new Uint16Array(remappedIndices),
		1
	));
	if (useSourceNormals) {
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	} else {
		geometry.computeVertexNormals();
	}
	geometry.computeBoundingSphere();
	return {
		geometry,
		status: t('markTexture.preview.vertexTriangleCount', {
			vertices: remap.size.toLocaleString(),
			triangles: (remappedIndices.length / 3).toLocaleString(),
		}),
		needsReview: true,
	};
};

const getPreviewRootCentroid = (previewMeshes: THREE.Mesh[]): THREE.Vector3 => {
	const centroid = new THREE.Vector3();
	let totalWeight = 0;
	for (const previewMesh of previewMeshes) {
		const geometry = previewMesh.geometry;
		const triangleCount = Math.max((geometry.getIndex()?.count ?? 0) / 3, 1);
		centroid.addScaledVector(getGeometrySurfaceCentroid(geometry), triangleCount);
		totalWeight += triangleCount;
	}
	return totalWeight > 0 ? centroid.multiplyScalar(1 / totalWeight) : centroid;
};

const buildPreviewGeometry = async (buildToken: number) => {
	const dataType = activeDataType.value;
	const uvLayer = activeUvLayer.value;
	if (!scene || !material) {
		clearPreviewMesh();
		previewStatus.value = '';
		return;
	}
	const activeTargetIsVisible = visibleSubMeshTargets.value.some(target => (
		target.workspacePath === props.workspacePath && target.subMeshName === props.subMeshName
	));
	if (visibleSubMeshTargets.value.length === 0) {
		clearPreviewMesh();
		previewStatus.value = '';
		emit('review-targets-changed', []);
		return;
	}

	let activeGeometry: PreviewGeometryBuildResult | undefined;
	if (activeTargetIsVisible && dataType) {
		try {
			activeGeometry = uvLayer
				? await createPreviewGeometry(dataType, uvLayer, buildToken)
				: await createPermissivePreviewGeometry(dataType, buildToken);
		} catch {
			activeGeometry = await createPermissivePreviewGeometry(dataType, buildToken).catch(() => undefined);
		}
	}
	if (buildToken !== previewBuildToken) {
		return;
	}

	const otherTargets = visibleSubMeshTargets.value.filter(target => (
		target.workspacePath !== props.workspacePath || target.subMeshName !== props.subMeshName
	));
	const passiveSources = await mapWithConcurrency(otherTargets, async target => {
		const source = await loadDefaultDataTypeForTarget(target);
		if (!source || buildToken !== previewBuildToken) {
			return undefined;
		}
		try {
			const geometry = source.uvLayer
				? await createPreviewGeometry(source.dataType, source.uvLayer, buildToken)
				: await createPermissivePreviewGeometry(source.dataType, buildToken);
			return geometry ? { target, geometry } : undefined;
		} catch {
			const geometry = await createPermissivePreviewGeometry(source.dataType, buildToken).catch(() => undefined);
			return geometry ? { target, geometry } : undefined;
		}
	}, () => buildToken === previewBuildToken);
	const passiveRenderables = await mapWithConcurrency(passiveSources, async source => {
		if (!source) return undefined;
		const [diffuse, normal] = await Promise.all([
			loadPreviewTexture(source.target.diffuseDdsPath || '', source.target.diffuseUrl || '', true),
			loadPreviewTexture(source.target.normalDdsPath || '', source.target.normalUrl || '', false),
		]);
		return { source, diffuse, normal };
	}, () => buildToken === previewBuildToken);
	if (buildToken !== previewBuildToken) {
		activeGeometry?.geometry.dispose();
		for (const renderable of passiveRenderables) {
			renderable?.source.geometry.geometry.dispose();
			renderable?.diffuse?.dispose();
			renderable?.normal?.dispose();
		}
		return;
	}

	clearPreviewMesh();
	previewMaterialTextureSources = [];
	previewRoot = new THREE.Group();
	previewRoot.rotation.x = THREE.MathUtils.degToRad(PREVIEW_MODEL_X_ROTATION_DEGREES);
	const meshes: THREE.Mesh[] = [];
	const healthyMeshes: THREE.Mesh[] = [];
	if (activeGeometry) {
		material.uniforms.uNeedsReview.value = activeGeometry.needsReview ? 1 : 0;
		mesh = new THREE.Mesh(activeGeometry.geometry, material);
		previewRoot.add(mesh);
		outlineController.attach(mesh);
		meshes.push(mesh);
		if (!activeGeometry.needsReview) healthyMeshes.push(mesh);
		const activeTextureTarget = visibleSubMeshTargets.value.find(target => (
			target.workspacePath === props.workspacePath && target.subMeshName === props.subMeshName
		));
		previewMaterialTextureSources.push({
			material,
			diffuseDdsPath: activeTextureTarget?.diffuseDdsPath || selectedDiffuse.value?.ddsPath || '',
			normalDdsPath: activeTextureTarget?.normalDdsPath || selectedNormal.value?.ddsPath || '',
		});
	}
	for (const renderable of passiveRenderables) {
		if (!renderable) continue;
		const { source, diffuse, normal } = renderable;
		const passiveMaterial = createMaterial(
			getFallbackColorForKey(source.target.subMeshName),
			source.geometry.needsReview === true
		);
		applyTextureToMaterial(passiveMaterial, 'diffuse', diffuse);
		applyTextureToMaterial(passiveMaterial, 'normal', normal);
		passiveMaterials.push(passiveMaterial);
		previewMaterialTextureSources.push({
			material: passiveMaterial,
			diffuseDdsPath: source.target.diffuseDdsPath || '',
			normalDdsPath: source.target.normalDdsPath || '',
		});
		const passiveMesh = new THREE.Mesh(source.geometry.geometry, passiveMaterial);
		previewRoot.add(passiveMesh);
		outlineController.attach(passiveMesh);
		meshes.push(passiveMesh);
		if (!source.geometry.needsReview) healthyMeshes.push(passiveMesh);
	}
	mesh ??= meshes[0];
	if (meshes.length === 0) {
		clearPreviewMesh();
		previewStatus.value = '';
		emit('review-targets-changed', []);
		return;
	}
	const activeTarget = visibleSubMeshTargets.value.find(target => (
		target.workspacePath === props.workspacePath && target.subMeshName === props.subMeshName
	));
	const reviewTargetIds = [
		...(activeGeometry?.needsReview && activeTarget ? [activeTarget.id] : []),
		...passiveRenderables.flatMap(renderable => (
			renderable?.source.geometry.needsReview ? [renderable.source.target.id] : []
		)),
	];
	emit('review-targets-changed', reviewTargetIds);
	scene.add(previewRoot);
	previewRoot.updateMatrixWorld(true);
	framingMeshes = healthyMeshes.length > 0 ? healthyMeshes : meshes;
	rotationCenter.copy(previewRoot.localToWorld(getPreviewRootCentroid(framingMeshes)));
	previewStatus.value = activeGeometry?.status || '';
	updateMaterialMode();
	updateMaterialSettings();
	framePreview();
};

const rebuildPreview = async () => {
	if (previewZoomOpen.value) closeZoomPreview();
	const token = ++previewBuildToken;
	previewError.value = '';
	if (!renderer) {
		clearPreviewMesh();
		return;
	}
	isBuildingPreview.value = true;
	try {
		await buildPreviewGeometry(token);
	} catch (error) {
		if (token === previewBuildToken) {
			clearPreviewMesh();
			previewError.value = error instanceof Error ? error.message : String(error);
		}
	} finally {
		if (token === previewBuildToken) {
			isBuildingPreview.value = false;
		}
	}
};

const schedulePreviewRebuild = () => {
	if (rebuildScheduled) return;
	rebuildScheduled = true;
	queueMicrotask(() => {
		rebuildScheduled = false;
		if (renderer) void rebuildPreview();
	});
};

const deleteOtherDataTypes = async () => {
	const retainedDataType = activeDataType.value;
	const otherDataTypes = dataTypes.value.filter(item => item.id !== retainedDataType?.id);
	if (!retainedDataType || otherDataTypes.length === 0) {
		return;
	}
	try {
		await ElMessageBox.confirm(
			t('markTexture.preview.confirmDeleteOtherDataTypes', { name: retainedDataType.name, count: otherDataTypes.length }),
			t('markTexture.preview.deleteOtherDataTypes'),
			{
				confirmButtonText: t('markTexture.common.confirm'),
				cancelButtonText: t('markTexture.common.cancel'),
				type: 'warning',
			}
		);
	} catch {
		return;
	}

	const deletionResults = await Promise.allSettled(otherDataTypes.map(item => moveDirectoryToRecycleBin(item.folderPath)));
	const failedDeletions = deletionResults.filter(result => result.status === 'rejected');
	if (failedDeletions.length > 0) {
		console.error('Failed to delete some other data types', failedDeletions);
	}
	await loadDataTypes();
	emit('data-type-changed');
	if (failedDeletions.length > 0) {
		ElMessage.error(t('markTexture.preview.otherDataTypesDeleteFailed'));
		return;
	}
	ElMessage.success(t('markTexture.preview.otherDataTypesDeleted'));
};

const deleteCurrentDataType = async () => {
	const dataType = activeDataType.value;
	if (!dataType) {
		return;
	}
	try {
		await ElMessageBox.confirm(
			t('markTexture.preview.confirmDeleteDataType', { name: dataType.name }),
			t('markTexture.preview.deleteDataType'),
			{
				confirmButtonText: t('markTexture.common.confirm'),
				cancelButtonText: t('markTexture.common.cancel'),
				type: 'warning',
			}
		);
	} catch {
		return;
	}

	try {
		await moveDirectoryToRecycleBin(dataType.folderPath);
		selectedDataTypeId.value = '';
		selectedUvLayerId.value = '';
		await loadDataTypes();
		ElMessage.success(t('markTexture.preview.dataTypeDeleted'));
		emit('data-type-changed');
	} catch (error) {
		console.error('Failed to delete data type', error);
		ElMessage.error(t('markTexture.preview.dataTypeDeleteFailed'));
	}
};

const initializeRenderer = () => {
	if (!previewHost.value || renderer) {
		return;
	}
	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
	renderer.setClearColor(0x000000, 0);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	previewHost.value.appendChild(renderer.domElement);

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(36, 1, 0.01, 10_000);
	material = createMaterial();
	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = false;
	// Mouse drag is handled below as model rotation.  OrbitControls remains for
	// wheel zoom and camera framing, but must not turn the camera around the
	// object or it would conceal world-fixed lighting.
	controls.enableRotate = false;
	controls.enablePan = false;
	controls.addEventListener('change', renderPreview);
	initializePreviewPointerControls();
	resizeObserver = new ResizeObserver(resizePreview);
	resizeObserver.observe(previewHost.value);
	resizePreview();
};

const disposeRenderer = () => {
	resizeObserver?.disconnect();
	resizeObserver = undefined;
	disposeZoomRenderer();
	disposePreviewPointerControls?.();
	disposePreviewPointerControls = undefined;
	controls?.dispose();
	controls = undefined;
	clearPreviewMesh();
	diffuseTexture?.dispose();
	normalTexture?.dispose();
	diffuseTexture = undefined;
	normalTexture = undefined;
	material?.dispose();
	material = undefined;
	renderer?.dispose();
	renderer?.domElement.remove();
	renderer = undefined;
	scene = undefined;
	camera = undefined;
};

watch(
	() => [props.workspacePath, props.subMeshName],
	() => {
		void loadDataTypes();
	},
	{ immediate: true }
);

watch(
	() => visibleSubMeshTargets.value
		.map(target => `${target.id}:${target.workspacePath}:${target.subMeshName}:${target.diffuseDdsPath || ''}:${target.normalDdsPath || ''}`)
		.join('|'),
	() => {
		schedulePreviewRebuild();
	},
	{ immediate: true }
);

watch(
	() => props.textureOptions.map(item => `${item.id}:${item.markName || ''}:${item.ddsPath}`).join('|'),
	() => {
		void updateMaterialTextures();
	},
	{ immediate: true }
);

watch(selectedDataTypeId, () => {
	const layers = uvLayers.value;
	if (!layers.some(item => item.id === selectedUvLayerId.value)) {
		selectedUvLayerId.value = layers[0]?.id ?? '';
	}
	schedulePreviewRebuild();
});

watch(selectedUvLayerId, () => {
	schedulePreviewRebuild();
});

watch(lightingMode, mode => {
	updateMaterialMode();
	saveLightingModePreference(mode);
});

watch([normalStrength, fallbackColor, diffuseAlphaEmissionEnabled, emissionColor, emissionFactor], () => {
	localStorage.setItem(PREVIEW_EMISSION_STORAGE_KEY, String(diffuseAlphaEmissionEnabled.value));
	localStorage.setItem(PREVIEW_EMISSION_COLOR_STORAGE_KEY, emissionColor.value);
	localStorage.setItem(PREVIEW_EMISSION_FACTOR_STORAGE_KEY, String(emissionFactor.value));
	updateMaterialSettings();
});

onMounted(async () => {
	restoreLightingModePreference();
	initializeRenderer();
	await nextTick();
	schedulePreviewRebuild();
	void updateMaterialTextures();
});

onBeforeUnmount(() => {
	loadToken += 1;
	previewBuildToken += 1;
	textureLoadToken += 1;
	disposeRenderer();
});

watch([outlineEnabled, outlineWidth, outlineColor, outlineDirectionSource, outlineWeightSource, outlineVisualization, outlineSkipTransparent], ([enabled, width, color, direction, weight, visualization, skipTransparent]) => {
	localStorage.setItem(PREVIEW_OUTLINE_STORAGE_KEY, String(enabled));
	localStorage.setItem(PREVIEW_OUTLINE_WIDTH_STORAGE_KEY, String(width));
	localStorage.setItem(PREVIEW_OUTLINE_COLOR_STORAGE_KEY, color);
	localStorage.setItem(PREVIEW_OUTLINE_DIRECTION_STORAGE_KEY, direction);
	localStorage.setItem(PREVIEW_OUTLINE_WEIGHT_STORAGE_KEY, weight);
	localStorage.setItem(PREVIEW_OUTLINE_VISUALIZATION_STORAGE_KEY, visualization);
	localStorage.setItem(PREVIEW_OUTLINE_SKIP_TRANSPARENT_STORAGE_KEY, String(skipTransparent));
	localStorage.setItem(PREVIEW_OUTLINE_PREFERENCE_VERSION_KEY, '2');
	outlineController.updateSettings(currentOutlineSettings());
	renderPreview();
});

// This view is route-cached. Explicitly close the teleported overlay whenever
// the page is deactivated so it cannot survive a page switch.
onDeactivated(() => {
	loadToken += 1;
	previewBuildToken += 1;
	textureLoadToken += 1;
	closeZoomPreview();
	disposeRenderer();
});

onActivated(async () => {
	if (renderer) return;
	initializeRenderer();
	await nextTick();
	void loadDataTypes();
	schedulePreviewRebuild();
	void updateMaterialTextures();
});
</script>

<template>
	<section class="submesh-preview-panel" :aria-label="t('markTexture.preview.title')">
		<div class="preview-heading">
			<div>
				<h2>{{ t('markTexture.preview.title') }}</h2>
				<p>{{ t('markTexture.preview.hint') }}</p>
			</div>
			<div class="preview-heading-actions">
				<button
					class="preview-icon-button"
					type="button"
					:title="t('markTexture.preview.settings')"
					:aria-label="t('markTexture.preview.settings')"
					@click="previewSettingsOpen = true"
				>
					⚙
				</button>
				<button
					class="preview-icon-button"
					type="button"
					:title="t('markTexture.preview.reload')"
					:aria-label="t('markTexture.preview.reload')"
					@click="loadDataTypes"
				>
					↻
				</button>
			</div>
		</div>

		<div class="preview-controls">
			<label>
				<span>{{ t('markTexture.preview.dataType') }}</span>
				<div class="preview-select-wrap">
					<el-select v-model="selectedDataTypeId" :disabled="dataTypes.length === 0" size="small">
						<el-option
							v-for="dataType in dataTypes"
							:key="dataType.id"
							:label="dataType.name"
							:value="dataType.id"
						/>
					</el-select>
					<span class="preview-select-value">{{ selectedDataTypeLabel }}</span>
				</div>
			</label>
			<label>
				<span>{{ t('markTexture.preview.uvLayer') }}</span>
				<div class="preview-select-wrap">
					<el-select v-model="selectedUvLayerId" :disabled="uvLayers.length === 0" size="small">
						<el-option v-for="layer in uvLayers" :key="layer.id" :label="layer.label" :value="layer.id" />
					</el-select>
					<span class="preview-select-value">{{ selectedUvLayerLabel }}</span>
				</div>
			</label>
		</div>

		<div class="preview-actions">
			<el-button size="small" type="warning" plain :disabled="!activeDataType || dataTypes.length < 2" @click="deleteOtherDataTypes">
				{{ t('markTexture.preview.deleteOtherDataTypes') }}
			</el-button>
			<el-button size="small" type="danger" plain :disabled="!activeDataType" @click="deleteCurrentDataType">
				{{ t('markTexture.preview.deleteDataType') }}
			</el-button>
			<el-button size="small" :disabled="!mesh" @click="framePreview">
				{{ t('markTexture.preview.frame') }}
			</el-button>
		</div>

		<div
			ref="previewHost"
			class="preview-canvas-wrap"
			:class="{ 'is-loading': isLoading || isBuildingPreview }"
			@dblclick="openZoomPreview"
		>
			<div v-if="!hasPreviewTarget" class="preview-empty">{{ t('markTexture.preview.selectSubMesh') }}</div>
			<div v-else-if="dataTypes.length === 0 && !isLoading" class="preview-empty">{{ t('markTexture.preview.noDataTypes') }}</div>
			<div v-else-if="previewError" class="preview-empty is-error">{{ previewError }}</div>
			<div class="preview-overlay-info">
				<span>{{ selectedDiffuse ? t('markTexture.preview.usingDiffuseMap') : t('markTexture.preview.diffuseFallback') }}</span>
				<span>{{ selectedNormal ? t('markTexture.preview.usingNormalMap') : t('markTexture.preview.normalFallback') }}</span>
				<span>{{ t('markTexture.preview.renderMode') }} · {{ currentLightingModeLabel }}</span>
			</div>
			<button
				class="preview-zoom-button"
				type="button"
				:title="t('markTexture.preview.zoom')"
				:aria-label="t('markTexture.preview.zoom')"
				:disabled="!mesh"
				@click="openZoomPreview"
			>
				⤢
			</button>
		</div>
		<p v-if="previewStatus" class="preview-status">{{ previewStatus }}</p>

		<el-drawer
			v-model="previewSettingsOpen"
			:with-header="false"
			direction="rtl"
			size="min(320px, 88vw)"
			append-to-body
			class="preview-settings-drawer"
		>
			<section class="preview-settings-page">
				<div class="preview-settings-heading">
					<h3>{{ t('markTexture.preview.settings') }}</h3>
					<p>{{ t('markTexture.preview.autoTextureMaps') }}</p>
				</div>
				<label>
					<span>{{ t('markTexture.preview.renderMode') }}</span>
					<el-select v-model="lightingMode" size="small">
						<el-option :label="t('markTexture.preview.halfLambert')" value="half-lambert" />
						<el-option :label="t('markTexture.preview.pbr')" value="pbr" />
						<el-option :label="t('markTexture.preview.unlit')" value="unlit" />
					</el-select>
				</label>
				<label class="displacement-control">
					<span>{{ t('markTexture.preview.normalDisplacement') }}</span>
					<el-slider v-model="normalStrength" :min="0" :max="1" :step="0.002" :disabled="!selectedNormal" />
				</label>
				<label class="outline-control">
					<span>{{ t('markTexture.preview.diffuseAlphaEmission') }}</span>
					<el-switch v-model="diffuseAlphaEmissionEnabled" />
				</label>
				<label class="outline-control">
					<span>{{ t('markTexture.preview.emissionColor') }}</span>
					<el-color-picker v-model="emissionColor" size="small" :disabled="!diffuseAlphaEmissionEnabled" />
				</label>
				<label class="displacement-control">
					<span>{{ t('markTexture.preview.emissionFactor') }}</span>
					<el-slider
						v-model="emissionFactor"
						:min="0"
						:max="8"
						:step="0.01"
						:disabled="!diffuseAlphaEmissionEnabled"
						show-input
						:show-input-controls="false"
					/>
				</label>
				<label class="outline-control">
					<span>{{ t('markTexture.preview.outline') }}</span>
					<el-switch v-model="outlineEnabled" />
				</label>
				<label class="displacement-control">
					<span>{{ t('markTexture.preview.outlineWidth') }}</span>
					<el-slider
						v-model="outlineWidthSlider"
						:min="0"
						:max="1"
						:step="0.001"
						:marks="outlineWidthMarks"
						:format-tooltip="() => outlineWidth.toPrecision(3)"
					/>
				</label>
				<label class="outline-control">
					<span>{{ t('markTexture.preview.outlineColor') }}</span>
					<el-color-picker v-model="outlineColor" size="small" />
				</label>
				<label>
					<span>{{ t('markTexture.preview.outlineDirection') }}</span>
					<el-select v-model="outlineDirectionSource" size="small">
						<el-option :label="t('markTexture.preview.outlineDirectionNormal')" value="normal" />
						<el-option :label="t('markTexture.preview.outlineDirectionTangent')" value="tangent" />
						<el-option :label="t('markTexture.preview.outlineDirectionNegativeTangent')" value="-tangent" />
						<el-option :label="t('markTexture.preview.outlineDirectionAuto')" value="auto" />
					</el-select>
				</label>
				<label>
					<span>{{ t('markTexture.preview.outlineWeight') }}</span>
					<el-select v-model="outlineWeightSource" size="small">
						<el-option :label="t('markTexture.preview.outlineWeightColorARaw')" value="color-a-raw" />
						<el-option :label="t('markTexture.preview.outlineWeightConstant')" value="constant" />
						<el-option :label="t('markTexture.preview.outlineWeightColorASigned')" value="color-a-signed" />
					</el-select>
				</label>
				<label>
					<span>{{ t('markTexture.preview.outlineVisualization') }}</span>
					<el-select v-model="outlineVisualization" size="small">
						<el-option :label="t('markTexture.preview.outlineVisualizationOutline')" value="outline" />
						<el-option :label="t('markTexture.preview.outlineVisualizationNormal')" value="normal" />
						<el-option :label="t('markTexture.preview.outlineVisualizationTangent')" value="tangent" />
						<el-option :label="t('markTexture.preview.outlineVisualizationColorA')" value="color-a" />
						<el-option :label="t('markTexture.preview.outlineVisualizationWeight')" value="weight" />
					</el-select>
				</label>
				<label class="outline-control">
					<span>{{ t('markTexture.preview.outlineSkipTransparent') }}</span>
					<el-switch v-model="outlineSkipTransparent" />
				</label>
				<div class="preview-settings-map-status">
					<span>{{ selectedDiffuse ? t('markTexture.preview.usingDiffuseMap') : t('markTexture.preview.diffuseFallback') }}</span>
					<span>{{ selectedNormal ? t('markTexture.preview.usingNormalMap') : t('markTexture.preview.normalFallback') }}</span>
				</div>
			</section>
		</el-drawer>

		<Teleport to="body">
			<div
				v-if="previewZoomOpen"
				class="preview-zoom-overlay"
				@click.self="closeZoomPreview"
				@wheel.prevent
				@contextmenu.prevent
			>
				<div ref="zoomPreviewHost" class="preview-zoom-canvas-wrap" :style="previewZoomDialogStyle" />
			</div>
		</Teleport>
	</section>
</template>

<style scoped>
.submesh-preview-panel {
	box-sizing: border-box;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 13px;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.2);
	border-radius: 14px;
	/* Match the adjacent M/S matrix instead of introducing a darker material. */
	background: rgba(var(--theme-surface-tint-rgb), 0.045);
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.018);
	overflow-x: hidden;
	overflow-y: visible;
}

.preview-heading {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
}

.preview-heading-actions {
	display: flex;
	align-items: center;
	gap: 5px;
}

.preview-heading h2 {
	margin: 0;
	color: rgba(246, 249, 255, 0.94);
	font-size: 13px;
	font-weight: 750;
}

.preview-heading p,
.preview-status {
	margin: 3px 0 0;
	color: rgba(232, 236, 245, 0.55);
	font-size: 10px;
	line-height: 1.35;
}

.preview-icon-button {
	width: 25px;
	height: 25px;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.16);
	border-radius: 7px;
	color: rgba(242, 246, 255, 0.76);
	background: rgba(var(--theme-surface-tint-rgb), 0.055);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
	font-size: 17px;
	line-height: 1;
	cursor: pointer;
}

.preview-icon-button:hover {
	color: #fff;
	background: rgba(var(--theme-surface-tint-rgb), 0.14);
}

.preview-controls {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 7px;
}

.preview-controls label {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
	color: rgba(232, 236, 245, 0.66);
	font-size: 10px;
	line-height: 1;
}

.preview-controls :deep(.el-select),
.preview-controls :deep(.el-select__wrapper) {
	min-width: 0;
	width: 100%;
}

.preview-controls :deep(.el-select__wrapper) {
	min-height: 27px;
	border-radius: 7px;
	font-size: 10px;
	background: rgba(var(--theme-surface-tint-rgb), 0.055);
	box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.13) inset !important;
	transition: box-shadow 0.16s ease, background 0.16s ease;
}

.preview-controls :deep(.el-select__wrapper:hover),
.preview-controls :deep(.el-select__wrapper.is-focused) {
	background: rgba(var(--theme-surface-tint-rgb), 0.09);
	box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.30) inset !important;
}

.preview-select-wrap {
	position: relative;
	min-width: 0;
}

.preview-select-value {
	position: absolute;
	inset: 2px 28px 2px 8px;
	z-index: 2;
	display: block;
	overflow: hidden;
	color: rgba(244, 247, 255, 0.9);
	font-size: 10px;
	line-height: 23px;
	text-overflow: ellipsis;
	white-space: nowrap;
	pointer-events: none;
}

.preview-select-wrap :deep(.el-select__selected-item),
.preview-select-wrap :deep(.el-select__placeholder) {
	color: transparent !important;
}

.displacement-control {
	grid-column: 1 / -1;
}

.displacement-control :deep(.el-slider) {
	margin: 1px 7px 0;
	width: auto;
}

.preview-settings-page {
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-height: 100%;
	padding: 18px;
	color: rgba(236, 241, 250, 0.82);
	background:
		linear-gradient(150deg, rgba(var(--theme-surface-tint-rgb), 0.095), rgba(9, 12, 20, 0.94)),
		var(--t-material-bg);
}

.preview-settings-heading h3 {
	margin: 0;
	color: rgba(249, 251, 255, 0.96);
	font-size: 15px;
}

.preview-settings-heading p {
	margin: 6px 0 0;
	color: rgba(232, 236, 245, 0.58);
	font-size: 11px;
	line-height: 1.45;
}

.preview-settings-page > label {
	display: flex;
	flex-direction: column;
	gap: 6px;
	color: rgba(232, 236, 245, 0.72);
	font-size: 11px;
}

.preview-settings-page > .outline-control {
	flex-direction: row;
	align-items: center;
	justify-content: space-between;
	min-height: 32px;
}

.preview-settings-page :deep(.el-select__wrapper) {
	min-height: 32px;
	border-radius: 8px;
	font-size: 11px;
	background: rgba(var(--theme-surface-tint-rgb), 0.07);
	box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.17) inset !important;
}

.preview-settings-page .displacement-control :deep(.el-slider) {
	margin: 4px 8px 0;
	width: auto;
}

.preview-settings-map-status {
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 10px;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.16);
	border-radius: 9px;
	color: rgba(236, 241, 250, 0.67);
	font-size: 11px;
	line-height: 1.35;
	background: rgba(var(--theme-surface-tint-rgb), 0.045);
}

:deep(.preview-settings-drawer .el-drawer) {
	border-left: 1px solid rgba(var(--theme-surface-tint-rgb), 0.2);
	background: transparent;
}

:deep(.preview-settings-drawer .el-drawer__body) {
	padding: 0;
}

.preview-actions {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 6px;
}

.preview-actions .el-button {
	min-width: 0;
	margin: 0;
	padding: 0 5px;
	font-size: 10px;
	color: rgba(244, 247, 255, 0.82);
	border-color: rgba(var(--theme-surface-tint-rgb), 0.15);
	background: rgba(var(--theme-surface-tint-rgb), 0.045);
	box-shadow: none;
}

.preview-actions .el-button:not(.is-disabled):hover {
	color: #fff;
	border-color: rgba(var(--theme-surface-tint-rgb), 0.32);
	background: rgba(var(--theme-surface-tint-rgb), 0.12);
}

.preview-canvas-wrap {
	box-sizing: border-box;
	position: relative;
	flex: 0 0 auto;
	width: 100%;
	aspect-ratio: 1 / 1;
	min-height: auto;
	overflow: hidden;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.16);
	border-radius: 10px;
	background:
		radial-gradient(circle at 50% 22%, rgba(var(--theme-surface-tint-rgb), 0.13), transparent 48%),
		linear-gradient(145deg, rgba(var(--theme-surface-tint-rgb), 0.065), rgba(var(--theme-surface-tint-rgb), 0.025));
	box-shadow: inset 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.025);
}

.preview-canvas-wrap :deep(canvas) {
	display: block;
	width: 100%;
	height: 100%;
	touch-action: none;
}

.preview-canvas-wrap.is-loading::after {
	content: '';
	position: absolute;
	inset: 0;
	pointer-events: none;
	background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.055), transparent);
	animation: preview-loading 1.1s linear infinite;
}

.preview-empty {
	position: absolute;
	inset: 0;
	z-index: 1;
	display: grid;
	place-items: center;
	padding: 20px;
	color: rgba(232, 236, 245, 0.52);
	font-size: 11px;
	text-align: center;
	pointer-events: none;
}

.preview-empty.is-error {
	color: rgba(255, 166, 166, 0.88);
}

.preview-overlay-info {
	position: absolute;
	left: 7px;
	bottom: 7px;
	z-index: 1;
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-width: calc(100% - 14px);
	padding: 5px 7px;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.16);
	border-radius: 6px;
	background: rgba(8, 11, 18, 0.58);
	backdrop-filter: blur(8px);
	-webkit-backdrop-filter: blur(8px);
	color: rgba(244, 247, 255, 0.72);
	font-size: 9px;
	line-height: 1.25;
	pointer-events: none;
}

.preview-zoom-button {
	position: absolute;
	right: 7px;
	bottom: 7px;
	z-index: 2;
	width: 27px;
	height: 27px;
	padding: 0;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.22);
	border-radius: 7px;
	background: rgba(var(--theme-surface-tint-rgb), 0.10);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
	color: rgba(245, 249, 255, 0.9);
	font-size: 16px;
	line-height: 1;
	cursor: pointer;
}

.preview-zoom-button:hover:not(:disabled) {
	background: rgba(var(--theme-surface-tint-rgb), 0.2);
	border-color: rgba(var(--theme-surface-tint-rgb), 0.42);
}

.preview-zoom-button:disabled {
	opacity: 0.42;
	cursor: default;
}

.preview-zoom-canvas-wrap {
	box-sizing: border-box;
	position: fixed;
	left: var(--preview-zoom-canvas-left, 50%);
	top: var(--preview-zoom-canvas-top, 50%);
	width: var(--preview-zoom-canvas-size, 1000px);
	height: var(--preview-zoom-canvas-size, 1000px);
	overflow: hidden;
	background: transparent;
}

.preview-zoom-canvas-wrap :deep(canvas) {
	display: block;
	width: 100%;
	height: 100%;
}

.preview-zoom-overlay {
	position: fixed;
	top: 32px;
	right: 0;
	bottom: 0;
	left: 0;
	/* Above every page-level control and popper.  The title bar remains outside
	 * this overlay so page switching/window controls stay deliberately usable. */
	z-index: 1000000;
	background: rgba(3, 6, 12, 0.72);
	backdrop-filter: blur(2px);
	-webkit-backdrop-filter: blur(2px);
}

@keyframes preview-loading {
	from { transform: translateX(-100%); }
	to { transform: translateX(100%); }
}
</style>
