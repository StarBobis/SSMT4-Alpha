<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { join } from '@tauri-apps/api/path';
import { exists, readDir, readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { moveDirectoryToRecycleBin } from '../../utils/RecycleBin';

type PreviewTextureOption = {
	id: string;
	label: string;
	url: string;
	markName?: string;
};

type SubMeshElement = {
	SemanticName?: string;
	SemanticIndex?: string;
	Format?: string;
	ByteWidth?: string;
};

type SubMeshCategoryBuffer = {
	FileName?: string;
	D3D11ElementList?: SubMeshElement[];
};

type SubMeshIndexBuffer = {
	FileName?: string;
	DXGI_FORMAT?: string;
};

type SubMeshJson = {
	WorkGameType?: string;
	IndexBufferList?: SubMeshIndexBuffer[];
	CategoryBufferList?: SubMeshCategoryBuffer[];
};

type DataTypeConfig = {
	primaryDataTypeFolder?: string;
};

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
	textureOptions: PreviewTextureOption[];
}>();

const emit = defineEmits<{
	(event: 'data-type-changed'): void;
}>();

const { t } = useI18n();

const DATA_TYPE_CONFIG_FILE_NAME = 'PostProcessDataTypeConfig.json';
const MAX_PREVIEW_INDEX_COUNT = 600_000;

const previewHost = ref<HTMLDivElement>();
const dataTypes = ref<DataTypeItem[]>([]);
const selectedDataTypeId = ref('');
const selectedUvLayerId = ref('');
const selectedDiffuseId = ref('');
const selectedNormalId = ref('');
const lightingMode = ref<'half-lambert' | 'unlit'>('half-lambert');
const displacementStrength = ref(0);
const isLoading = ref(false);
const isBuildingPreview = ref(false);
const previewError = ref('');
const primaryDataTypeFolder = ref('');
const previewStatus = ref('');
let loadToken = 0;
let previewBuildToken = 0;
let textureLoadToken = 0;
let userSelectedDiffuse = false;
let userSelectedNormal = false;

let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let controls: OrbitControls | undefined;
let material: THREE.ShaderMaterial | undefined;
let mesh: THREE.Mesh | undefined;
let resizeObserver: ResizeObserver | undefined;
let diffuseTexture: THREE.Texture | undefined;
let normalTexture: THREE.Texture | undefined;

const activeDataType = computed(() => {
	return dataTypes.value.find(item => item.id === selectedDataTypeId.value);
});

const uvLayers = computed(() => activeDataType.value?.uvLayers ?? []);

const activeUvLayer = computed(() => {
	return uvLayers.value.find(item => item.id === selectedUvLayerId.value);
});

const selectedDiffuse = computed(() => {
	return props.textureOptions.find(item => item.id === selectedDiffuseId.value && item.url);
});

const selectedNormal = computed(() => {
	return props.textureOptions.find(item => item.id === selectedNormalId.value && item.url);
});

const hasPreviewTarget = computed(() => !!props.workspacePath && !!props.subMeshName);

const isCurrentDataTypePrimary = computed(() => {
	return !!activeDataType.value && activeDataType.value.id === primaryDataTypeFolder.value;
});

const selectedDataTypeLabel = computed(() => {
	const dataType = activeDataType.value;
	if (!dataType) {
		return t('markTexture.preview.noDataTypes');
	}
	return dataType.id === primaryDataTypeFolder.value ? `★ ${dataType.name}` : dataType.name;
});

const selectedUvLayerLabel = computed(() => {
	return activeUvLayer.value?.label || t('markTexture.preview.uvLayer');
});

const selectedDiffuseLabel = computed(() => {
	return selectedDiffuse.value?.label || t('markTexture.preview.diffuseFallback');
});

const selectedNormalLabel = computed(() => {
	return selectedNormal.value?.label || t('markTexture.preview.normalFallback');
});

const fallbackColor = computed(() => {
	let hash = 0;
	for (const char of props.subMeshName) {
		hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
	}
	const hue = ((hash >>> 0) % 360) / 360;
	return new THREE.Color().setHSL(hue, 0.46, 0.56);
});

const normalizeSemantic = (semantic: string | undefined): string => {
	return (semantic || '').trim().toUpperCase();
};

const getByteWidth = (element: SubMeshElement): number => {
	const parsed = Number.parseInt(element.ByteWidth || '', 10);
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
		const elements = Array.isArray(buffer.D3D11ElementList) ? buffer.D3D11ElementList : [];
		let offset = 0;
		const stride = elements.reduce((total, element) => total + getByteWidth(element), 0);

		for (const [elementIndex, element] of elements.entries()) {
			if (normalizeSemantic(element.SemanticName) === targetSemantic) {
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
			const declaredIndex = Number.parseInt(source.element.SemanticIndex || '', 10);
			const semanticIndex = Number.isFinite(declaredIndex) ? declaredIndex : index;
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

const getSubMeshRootPath = async (): Promise<string | undefined> => {
	if (!props.workspacePath || !props.subMeshName) {
		return undefined;
	}
	return join(props.workspacePath, props.subMeshName);
};

const getDataTypeConfigPath = async (): Promise<string | undefined> => {
	const rootPath = await getSubMeshRootPath();
	return rootPath ? join(rootPath, DATA_TYPE_CONFIG_FILE_NAME) : undefined;
};

const loadDataTypeConfig = async (): Promise<DataTypeConfig> => {
	try {
		const configPath = await getDataTypeConfigPath();
		if (!configPath || !(await exists(configPath))) {
			return {};
		}
		const parsed = JSON.parse(await readTextFile(configPath)) as DataTypeConfig;
		return typeof parsed.primaryDataTypeFolder === 'string' ? parsed : {};
	} catch {
		return {};
	}
};

const sortDataTypes = (items: DataTypeItem[], primaryId: string): DataTypeItem[] => {
	return [...items].sort((left, right) => {
		if (left.id === primaryId) return -1;
		if (right.id === primaryId) return 1;
		return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
	});
};

const resetTextureSelections = () => {
	userSelectedDiffuse = false;
	userSelectedNormal = false;
	applyMarkedTextureDefaults();
};

const findMarkedTexture = (markName: 'DiffuseMap' | 'NormalMap'): PreviewTextureOption | undefined => {
	return props.textureOptions.find(item => item.url && item.markName?.trim().toLowerCase() === markName.toLowerCase());
};

const applyMarkedTextureDefaults = () => {
	if (!userSelectedDiffuse) {
		selectedDiffuseId.value = findMarkedTexture('DiffuseMap')?.id ?? '';
	}
	if (!userSelectedNormal) {
		selectedNormalId.value = findMarkedTexture('NormalMap')?.id ?? '';
	}
};

const loadDataTypes = async () => {
	const token = ++loadToken;
	previewError.value = '';
	previewStatus.value = '';
	resetTextureSelections();

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

		const [entries, config] = await Promise.all([readDir(rootPath), loadDataTypeConfig()]);
		const candidates = entries.filter(entry => entry.isDirectory && entry.name?.startsWith('TYPE_') && entry.name);
		const loadedItems = await Promise.all(
			candidates.map(async entry => {
				const folderName = entry.name!;
				const folderPath = await join(rootPath, folderName);
				try {
					const folderEntries = await readDir(folderPath);
					const jsonEntry = folderEntries.find(item => !item.isDirectory && item.name?.endsWith('.json') && item.name !== DATA_TYPE_CONFIG_FILE_NAME);
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
			})
		);

		if (token !== loadToken) {
			return;
		}

		const nextItems = loadedItems.filter((item): item is DataTypeItem => !!item);
		primaryDataTypeFolder.value = nextItems.some(item => item.id === config.primaryDataTypeFolder)
			? config.primaryDataTypeFolder || ''
			: '';
		dataTypes.value = sortDataTypes(nextItems, primaryDataTypeFolder.value);

		if (!dataTypes.value.some(item => item.id === selectedDataTypeId.value)) {
			selectedDataTypeId.value = dataTypes.value[0]?.id ?? '';
		}
		const nextUvLayers = dataTypes.value.find(item => item.id === selectedDataTypeId.value)?.uvLayers ?? [];
		if (!nextUvLayers.some(item => item.id === selectedUvLayerId.value)) {
			selectedUvLayerId.value = nextUvLayers[0]?.id ?? '';
		}
		// TYPE_* folder names and UV ids are often the same across SubMesh entries.
		// The selected ids may therefore not change, so explicitly rebuild with the new buffers.
		void rebuildPreview();
	} catch (error) {
		if (token === loadToken) {
			dataTypes.value = [];
			selectedDataTypeId.value = '';
			selectedUvLayerId.value = '';
			previewError.value = String(error);
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

const createMaterial = () => {
	return new THREE.ShaderMaterial({
		uniforms: {
			uDiffuseMap: { value: null },
			uNormalMap: { value: null },
			uHasDiffuseMap: { value: 0 },
			uHasNormalMap: { value: 0 },
			uDisplacementStrength: { value: 0 },
			uFallbackColor: { value: fallbackColor.value.clone() },
			uLightDirection: { value: new THREE.Vector3(0.4, 0.8, 0.55).normalize() },
		},
		vertexShader: `
			uniform sampler2D uNormalMap;
			uniform float uHasNormalMap;
			uniform float uDisplacementStrength;
			varying vec2 vUv;
			varying vec3 vWorldPosition;
			varying vec3 vWorldNormal;

			void main() {
				vUv = uv;
				vec3 displacedPosition = position;
				if (uHasNormalMap > 0.5 && uDisplacementStrength > 0.00001) {
					float height = texture2D(uNormalMap, uv).b * 2.0 - 1.0;
					displacedPosition += normal * height * uDisplacementStrength;
				}
				vec4 worldPosition = modelMatrix * vec4(displacedPosition, 1.0);
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
			uniform vec3 uFallbackColor;
			uniform vec3 uLightDirection;
			varying vec2 vUv;
			varying vec3 vWorldPosition;
			varying vec3 vWorldNormal;

			void main() {
				vec3 baseColor = uFallbackColor;
				if (uHasDiffuseMap > 0.5) {
					baseColor = texture2D(uDiffuseMap, vUv).rgb;
				}
				#ifdef UNLIT
					gl_FragColor = vec4(baseColor, 1.0);
				#else
					vec3 normal = normalize(vWorldNormal);
					if (uHasNormalMap > 0.5) {
						vec3 mapNormal = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
						normal = normalize(normal + mapNormal * 0.65);
					}
					float halfLambert = clamp(dot(normal, normalize(uLightDirection)) * 0.5 + 0.5, 0.0, 1.0);
					float toonBand = floor(halfLambert * 3.0 + 0.001) / 2.0;
					vec3 color = baseColor * (0.18 + toonBand * 0.82);
					gl_FragColor = vec4(color, 1.0);
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

const framePreview = () => {
	if (!mesh || !camera || !controls) {
		return;
	}
	const geometry = mesh.geometry;
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	if (!box || box.isEmpty()) {
		return;
	}
	const center = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const diameter = Math.max(size.x, size.y, size.z, 0.001);
	const distance = diameter / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
	camera.near = Math.max(diameter / 1_000, 0.001);
	camera.far = Math.max(diameter * 1_000, 100);
	camera.position.copy(center).add(new THREE.Vector3(1.1, 0.82, 1.25).normalize().multiplyScalar(distance * 1.65));
	camera.updateProjectionMatrix();
	controls.target.copy(center);
	controls.update();
	renderPreview();
};

const clearPreviewMesh = () => {
	if (mesh && scene) {
		scene.remove(mesh);
		mesh.geometry.dispose();
	}
	mesh = undefined;
	renderPreview();
};

const updateMaterialMode = () => {
	if (!material) {
		return;
	}
	if (lightingMode.value === 'unlit') {
		material.defines = { ...(material.defines ?? {}), UNLIT: 1 };
	} else {
		const { UNLIT: _unlit, ...nextDefines } = material.defines ?? {};
		material.defines = nextDefines;
	}
	material.needsUpdate = true;
	renderPreview();
};

const updateMaterialSettings = () => {
	if (!material) {
		return;
	}
	material.uniforms.uDisplacementStrength.value = displacementStrength.value;
	material.uniforms.uFallbackColor.value.copy(fallbackColor.value);
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

const updateMaterialTextures = async () => {
	const token = ++textureLoadToken;
	const [nextDiffuse, nextNormal] = await Promise.all([
		loadTexture(selectedDiffuse.value?.url || '', true),
		loadTexture(selectedNormal.value?.url || '', false),
	]);
	if (token !== textureLoadToken) {
		nextDiffuse?.dispose();
		nextNormal?.dispose();
		return;
	}
	replaceTexture('diffuse', nextDiffuse);
	replaceTexture('normal', nextNormal);
};

const buildPreviewGeometry = async () => {
	const dataType = activeDataType.value;
	const uvLayer = activeUvLayer.value;
	if (!dataType || !uvLayer) {
		clearPreviewMesh();
		previewStatus.value = '';
		return;
	}

	const positionSource = getElementSources(dataType, 'POSITION')[0];
	const normalSource = getElementSources(dataType, 'NORMAL')[0];
	const indexBuffer = dataType.json.IndexBufferList?.[0];
	if (!positionSource || !indexBuffer?.FileName) {
		throw new Error(t('markTexture.preview.unsupportedGeometry'));
	}

	const sourceBufferCache = new Map<string, Uint8Array>();
	const [positionData, normalData, uvData, indexData] = await Promise.all([
		getBufferData(dataType, positionSource, sourceBufferCache),
		normalSource ? getBufferData(dataType, normalSource, sourceBufferCache) : Promise.resolve(undefined),
		getBufferData(dataType, uvLayer, sourceBufferCache),
		readFile(await join(dataType.folderPath, indexBuffer.FileName)),
	]);
	const sourceIndices = readIndices(indexData, indexBuffer.DXGI_FORMAT);
	const maxIndexCount = Math.min(
		sourceIndices.length - (sourceIndices.length % 3),
		MAX_PREVIEW_INDEX_COUNT
	);
	const remappedIndices: number[] = [];
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const remap = new Map<number, number>();
	let useSourceNormals = !!normalSource;
	let skippedTriangleCount = 0;

	for (let indexOffset = 0; indexOffset < maxIndexCount; indexOffset += 3) {
		const triangleSourceIndices = sourceIndices.slice(indexOffset, indexOffset + 3);
		const trianglePositions = triangleSourceIndices.map(index => readElementValues(positionData, positionSource, index));
		if (trianglePositions.some(values => !values || values.length < 3)) {
			skippedTriangleCount += 1;
			continue;
		}

		for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
			const sourceIndex = triangleSourceIndices[vertexOffset];
			let targetIndex = remap.get(sourceIndex);
			if (targetIndex === undefined) {
				targetIndex = remap.size;
				remap.set(sourceIndex, targetIndex);
				const position = trianglePositions[vertexOffset]!;
				const normal = readElementValues(normalData, normalSource, sourceIndex);
				const uv = readElementValues(uvData, uvLayer, sourceIndex);
				positions.push(position[0], position[1], position[2]);
				if (normal && normal.length >= 3) {
					normals.push(normal[0], normal[1], normal[2]);
				} else {
					useSourceNormals = false;
					normals.push(0, 0, 0);
				}
				uvs.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
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

	clearPreviewMesh();
	if (!scene || !material) {
		geometry.dispose();
		return;
	}
	mesh = new THREE.Mesh(geometry, material);
	scene.add(mesh);
	previewStatus.value = sourceIndices.length > MAX_PREVIEW_INDEX_COUNT
		? t('markTexture.preview.previewLimited', { count: MAX_PREVIEW_INDEX_COUNT.toLocaleString() })
		: skippedTriangleCount > 0
			? t('markTexture.preview.skippedInvalidTriangles', { count: skippedTriangleCount })
			: t('markTexture.preview.vertexTriangleCount', {
				vertices: remap.size.toLocaleString(),
				triangles: (remappedIndices.length / 3).toLocaleString(),
			});
	framePreview();
};

const rebuildPreview = async () => {
	const token = ++previewBuildToken;
	previewError.value = '';
	if (!renderer || !activeDataType.value || !activeUvLayer.value) {
		clearPreviewMesh();
		return;
	}
	isBuildingPreview.value = true;
	try {
		await buildPreviewGeometry();
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

const setCurrentDataTypePrimary = async () => {
	const dataType = activeDataType.value;
	if (!dataType || isCurrentDataTypePrimary.value) {
		return;
	}
	try {
		const configPath = await getDataTypeConfigPath();
		if (!configPath) {
			return;
		}
		await writeTextFile(configPath, JSON.stringify({ primaryDataTypeFolder: dataType.id } satisfies DataTypeConfig, null, 2));
		primaryDataTypeFolder.value = dataType.id;
		dataTypes.value = sortDataTypes(dataTypes.value, dataType.id);
		ElMessage.success(t('markTexture.preview.primaryDataTypeSet'));
		emit('data-type-changed');
	} catch (error) {
		console.error('Failed to set primary data type', error);
		ElMessage.error(t('markTexture.preview.primaryDataTypeSetFailed'));
	}
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
		if (primaryDataTypeFolder.value === dataType.id) {
			primaryDataTypeFolder.value = '';
		}
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
	controls.enablePan = true;
	controls.addEventListener('change', renderPreview);
	resizeObserver = new ResizeObserver(resizePreview);
	resizeObserver.observe(previewHost.value);
	resizePreview();
};

const disposeRenderer = () => {
	resizeObserver?.disconnect();
	resizeObserver = undefined;
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
	() => props.textureOptions.map(item => `${item.id}:${item.markName || ''}:${item.url}`).join('|'),
	() => {
		const validIds = new Set(props.textureOptions.map(item => item.id));
		if (selectedDiffuseId.value && !validIds.has(selectedDiffuseId.value)) userSelectedDiffuse = false;
		if (selectedNormalId.value && !validIds.has(selectedNormalId.value)) userSelectedNormal = false;
		applyMarkedTextureDefaults();
	},
	{ immediate: true }
);

watch(selectedDataTypeId, () => {
	const layers = uvLayers.value;
	if (!layers.some(item => item.id === selectedUvLayerId.value)) {
		selectedUvLayerId.value = layers[0]?.id ?? '';
	}
	void rebuildPreview();
});

watch(selectedUvLayerId, () => {
	void rebuildPreview();
});

watch([selectedDiffuseId, selectedNormalId], () => {
	void updateMaterialTextures();
});

watch(lightingMode, () => {
	updateMaterialMode();
});

watch([displacementStrength, fallbackColor], () => {
	updateMaterialSettings();
});

onMounted(async () => {
	initializeRenderer();
	await nextTick();
	await rebuildPreview();
	void updateMaterialTextures();
});

onBeforeUnmount(() => {
	loadToken += 1;
	previewBuildToken += 1;
	textureLoadToken += 1;
	disposeRenderer();
});
</script>

<template>
	<section class="submesh-preview-panel" :aria-label="t('markTexture.preview.title')">
		<div class="preview-heading">
			<div>
				<h2>{{ t('markTexture.preview.title') }}</h2>
				<p>{{ t('markTexture.preview.hint') }}</p>
			</div>
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

		<div class="preview-controls">
			<label>
				<span>{{ t('markTexture.preview.dataType') }}</span>
				<div class="preview-select-wrap">
					<el-select v-model="selectedDataTypeId" :disabled="dataTypes.length === 0" size="small">
						<el-option
							v-for="dataType in dataTypes"
							:key="dataType.id"
							:label="dataType.id === primaryDataTypeFolder ? `★ ${dataType.name}` : dataType.name"
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
			<label>
				<span>{{ t('markTexture.preview.diffuseMap') }}</span>
				<div class="preview-select-wrap">
					<el-select
						v-model="selectedDiffuseId"
						clearable
						:placeholder="t('markTexture.preview.diffuseFallback')"
						size="small"
						@change="userSelectedDiffuse = true"
					>
						<el-option :label="t('markTexture.preview.diffuseFallback')" value="" />
						<el-option v-for="item in textureOptions.filter(item => item.url)" :key="item.id" :label="item.label" :value="item.id" />
					</el-select>
					<span class="preview-select-value">{{ selectedDiffuseLabel }}</span>
				</div>
			</label>
			<label>
				<span>{{ t('markTexture.preview.normalMap') }}</span>
				<div class="preview-select-wrap">
					<el-select
						v-model="selectedNormalId"
						clearable
						:placeholder="t('markTexture.preview.normalFallback')"
						size="small"
						@change="userSelectedNormal = true"
					>
						<el-option :label="t('markTexture.preview.normalFallback')" value="" />
						<el-option v-for="item in textureOptions.filter(item => item.url)" :key="item.id" :label="item.label" :value="item.id" />
					</el-select>
					<span class="preview-select-value">{{ selectedNormalLabel }}</span>
				</div>
			</label>
			<label>
				<span>{{ t('markTexture.preview.renderMode') }}</span>
				<el-select v-model="lightingMode" size="small">
					<el-option :label="t('markTexture.preview.halfLambert')" value="half-lambert" />
					<el-option :label="t('markTexture.preview.unlit')" value="unlit" />
				</el-select>
			</label>
			<label class="displacement-control">
				<span>{{ t('markTexture.preview.normalDisplacement') }}</span>
				<el-slider v-model="displacementStrength" :min="0" :max="0.08" :step="0.002" :disabled="!selectedNormal" />
			</label>
		</div>

		<div class="preview-actions">
			<el-button size="small" :disabled="!activeDataType || isCurrentDataTypePrimary" @click="setCurrentDataTypePrimary">
				{{ isCurrentDataTypePrimary ? t('markTexture.preview.primaryDataType') : t('markTexture.preview.setPrimaryDataType') }}
			</el-button>
			<el-button size="small" type="danger" plain :disabled="!activeDataType" @click="deleteCurrentDataType">
				{{ t('markTexture.preview.deleteDataType') }}
			</el-button>
			<el-button size="small" :disabled="!mesh" @click="framePreview">
				{{ t('markTexture.preview.frame') }}
			</el-button>
		</div>

		<div ref="previewHost" class="preview-canvas-wrap" :class="{ 'is-loading': isLoading || isBuildingPreview }">
			<div v-if="!hasPreviewTarget" class="preview-empty">{{ t('markTexture.preview.selectSubMesh') }}</div>
			<div v-else-if="dataTypes.length === 0 && !isLoading" class="preview-empty">{{ t('markTexture.preview.noDataTypes') }}</div>
			<div v-else-if="previewError" class="preview-empty is-error">{{ previewError }}</div>
			<div class="preview-overlay-info">
				<span>{{ selectedDiffuse ? t('markTexture.preview.usingDiffuseMap') : t('markTexture.preview.diffuseFallback') }}</span>
				<span>{{ selectedNormal ? t('markTexture.preview.usingNormalMap') : t('markTexture.preview.normalFallback') }}</span>
			</div>
		</div>
		<p v-if="previewStatus" class="preview-status">{{ previewStatus }}</p>
	</section>
</template>

<style scoped>
.submesh-preview-panel {
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 9px;
	padding: 11px;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.13);
	border-radius: 12px;
	background:
		linear-gradient(145deg, rgba(var(--theme-surface-tint-rgb), 0.07), rgba(var(--theme-surface-tint-rgb), 0.015)),
		rgba(7, 10, 17, 0.34);
	overflow-x: hidden;
	overflow-y: auto;
}

.preview-heading {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
}

.preview-heading h2 {
	margin: 0;
	color: rgba(246, 249, 255, 0.94);
	font-size: 12px;
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
	border: 1px solid rgba(255, 255, 255, 0.13);
	border-radius: 7px;
	color: rgba(242, 246, 255, 0.76);
	background: rgba(255, 255, 255, 0.045);
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
}

.preview-canvas-wrap {
	position: relative;
	flex: 0 0 auto;
	width: 100%;
	aspect-ratio: 1 / 1;
	min-height: 0;
	overflow: hidden;
	border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.13);
	border-radius: 9px;
	background:
		radial-gradient(circle at 50% 22%, rgba(var(--theme-surface-tint-rgb), 0.13), transparent 48%),
		linear-gradient(145deg, rgba(19, 24, 36, 0.94), rgba(5, 7, 12, 0.9));
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
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 6px;
	background: rgba(3, 5, 9, 0.55);
	color: rgba(244, 247, 255, 0.72);
	font-size: 9px;
	line-height: 1.25;
	pointer-events: none;
}

@keyframes preview-loading {
	from { transform: translateX(-100%); }
	to { transform: translateX(100%); }
}
</style>
