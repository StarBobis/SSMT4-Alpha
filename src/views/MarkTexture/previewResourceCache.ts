import { readFile, stat } from '@tauri-apps/plugin-fs';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════
   SubMesh 3D preview — module-level resource caches

   A full preview reload used to re-read every .buf file, re-parse every
   triangle and re-decode every DDS each time the submesh/UV selection
   changed or the page was re-entered (the renderer is torn down on page
   deactivation, so even the GPU objects were rebuilt from scratch).

   These bounded LRU caches keep buffers, built geometries and decoded
   textures alive across rebuilds, page switches and renderer teardowns.
   Every entry is validated against file mtime+size, so anything that
   changes on disk is rebuilt exactly once and then cached again.

   Ownership rule: cached objects are flagged via userData. All preview
   teardown goes through releasePreviewResource(), which skips flagged
   (cache-owned) objects — they are disposed only on cache eviction.
   ═══════════════════════════════════════════════════════════════════ */

export const PREVIEW_CACHE_FLAG = 'ssmtPreviewCacheKey';

const PREVIEW_BUFFER_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const PREVIEW_TEXTURE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const PREVIEW_GEOMETRY_CACHE_MAX_ENTRIES = 16;

export type PreviewFileStamp = { mtimeMs: number; size: number };

export type PreviewGeometryStatusInfo =
	| { kind: 'limited'; count: number }
	| { kind: 'skipped'; count: number }
	| { kind: 'counts'; vertices: number; triangles: number };

export type CachedGeometryEntry = {
	geometry: THREE.BufferGeometry;
	needsReview?: boolean;
	statusInfo: PreviewGeometryStatusInfo;
	/** Source-file stamps captured during the build, keyed by absolute path. */
	stamps: Record<string, PreviewFileStamp>;
};

type CachedBufferEntry = PreviewFileStamp & { data: Uint8Array };
type CachedTextureEntry = { texture: THREE.Texture; stamp: PreviewFileStamp; bytes: number };

const previewBufferCache = new Map<string, CachedBufferEntry>();
let previewBufferCacheBytes = 0;
const previewGeometryCache = new Map<string, CachedGeometryEntry>();
const previewTextureCache = new Map<string, CachedTextureEntry>();
let previewTextureCacheBytes = 0;

const touchLru = <K, V>(map: Map<K, V>, key: K): void => {
	const value = map.get(key);
	if (value === undefined) return;
	map.delete(key);
	map.set(key, value);
};

const stampOfFileInfo = (info: { mtime: Date | null; size: number }): PreviewFileStamp => ({
	mtimeMs: info.mtime?.getTime() ?? 0,
	size: info.size,
});

const sameStamp = (left: PreviewFileStamp, right: PreviewFileStamp): boolean => (
	left.mtimeMs === right.mtimeMs && left.size === right.size
);

/** Shared teardown for preview textures/geometries: cache-owned objects
    are left alone and only disposed on cache eviction. */
export const releasePreviewResource = <T extends { userData: Record<string, unknown>; dispose(): void }>(
	resource: T | null | undefined,
): void => {
	if (!resource) return;
	if (resource.userData?.[PREVIEW_CACHE_FLAG]) return;
	resource.dispose();
};

const dropCachedGeometry = (entry: CachedGeometryEntry): void => {
	entry.geometry.userData[PREVIEW_CACHE_FLAG] = '';
	entry.geometry.dispose();
};

const dropCachedTexture = (entry: CachedTextureEntry): void => {
	entry.texture.userData[PREVIEW_CACHE_FLAG] = '';
	entry.texture.dispose();
};

/* ─────────────── Raw .buf / index-buffer file cache ─────────────── */

export const readPreviewBufferFile = async (path: string): Promise<{ data: Uint8Array; stamp: PreviewFileStamp }> => {
	const stamp = stampOfFileInfo(await stat(path));
	const cached = previewBufferCache.get(path);
	if (cached && sameStamp(cached, stamp)) {
		touchLru(previewBufferCache, path);
		return { data: cached.data, stamp };
	}
	if (cached) {
		previewBufferCache.delete(path);
		previewBufferCacheBytes -= cached.data.byteLength;
	}
	const data = await readFile(path);
	previewBufferCache.set(path, { ...stamp, data });
	previewBufferCacheBytes += data.byteLength;
	while (previewBufferCacheBytes > PREVIEW_BUFFER_CACHE_MAX_BYTES && previewBufferCache.size > 1) {
		const oldestKey = previewBufferCache.keys().next().value as string | undefined;
		if (oldestKey === undefined || oldestKey === path) break;
		const oldest = previewBufferCache.get(oldestKey);
		previewBufferCache.delete(oldestKey);
		if (oldest) previewBufferCacheBytes -= oldest.data.byteLength;
	}
	return { data, stamp };
};

/* ─────────────── Built BufferGeometry cache ─────────────── */

/** Returns the cached entry when every source file still matches its
    recorded mtime+size; stale entries are dropped so callers rebuild. */
export const getValidatedPreviewGeometry = async (key: string): Promise<CachedGeometryEntry | undefined> => {
	const entry = previewGeometryCache.get(key);
	if (!entry) return undefined;
	const paths = Object.keys(entry.stamps);
	try {
		const infos = await Promise.all(paths.map(path => stat(path)));
		const valid = paths.every((path, index) => sameStamp(entry.stamps[path]!, stampOfFileInfo(infos[index]!)));
		if (!valid) {
			previewGeometryCache.delete(key);
			dropCachedGeometry(entry);
			return undefined;
		}
	} catch {
		previewGeometryCache.delete(key);
		dropCachedGeometry(entry);
		return undefined;
	}
	touchLru(previewGeometryCache, key);
	return entry;
};

export const storePreviewGeometry = (key: string, entry: CachedGeometryEntry): void => {
	const previous = previewGeometryCache.get(key);
	if (previous) {
		previewGeometryCache.delete(key);
		dropCachedGeometry(previous);
	}
	entry.geometry.userData[PREVIEW_CACHE_FLAG] = key;
	previewGeometryCache.set(key, entry);
	while (previewGeometryCache.size > PREVIEW_GEOMETRY_CACHE_MAX_ENTRIES) {
		const oldestKey = previewGeometryCache.keys().next().value as string | undefined;
		if (oldestKey === undefined) break;
		const oldest = previewGeometryCache.get(oldestKey);
		previewGeometryCache.delete(oldestKey);
		if (oldest) dropCachedGeometry(oldest);
	}
};

/* ─────────────── Decoded DDS texture cache ─────────────── */

const estimateTextureBytes = (texture: THREE.Texture): number => {
	const mipmaps = (texture as THREE.CompressedTexture).mipmaps;
	if (Array.isArray(mipmaps) && mipmaps.length > 0) {
		const total = mipmaps.reduce((sum, level) => (
			sum + ((level as { data?: { byteLength?: number } }).data?.byteLength ?? 0)
		), 0);
		if (total > 0) return total;
	}
	const image = texture.image as { data?: { byteLength?: number }; width?: number; height?: number } | undefined;
	if (image?.data?.byteLength) return image.data.byteLength;
	if (image?.width && image?.height) return image.width * image.height * 4;
	return 1024 * 1024;
};

export const getValidatedPreviewTexture = async (key: string, ddsPath: string): Promise<THREE.Texture | undefined> => {
	const entry = previewTextureCache.get(key);
	if (!entry) return undefined;
	try {
		const stamp = stampOfFileInfo(await stat(ddsPath));
		if (!sameStamp(entry.stamp, stamp)) {
			previewTextureCache.delete(key);
			previewTextureCacheBytes -= entry.bytes;
			dropCachedTexture(entry);
			return undefined;
		}
	} catch {
		previewTextureCache.delete(key);
		previewTextureCacheBytes -= entry.bytes;
		dropCachedTexture(entry);
		return undefined;
	}
	touchLru(previewTextureCache, key);
	return entry.texture;
};

export const storePreviewTexture = async (key: string, ddsPath: string, texture: THREE.Texture): Promise<void> => {
	let stamp: PreviewFileStamp = { mtimeMs: 0, size: 0 };
	try {
		stamp = stampOfFileInfo(await stat(ddsPath));
	} catch {
		// Keep a zero stamp; the next validation will simply re-stat the file.
	}
	const previous = previewTextureCache.get(key);
	if (previous) {
		previewTextureCache.delete(key);
		previewTextureCacheBytes -= previous.bytes;
		dropCachedTexture(previous);
	}
	const bytes = Math.max(estimateTextureBytes(texture), 1);
	texture.userData[PREVIEW_CACHE_FLAG] = key;
	previewTextureCache.set(key, { texture, stamp, bytes });
	previewTextureCacheBytes += bytes;
	while (previewTextureCacheBytes > PREVIEW_TEXTURE_CACHE_MAX_BYTES && previewTextureCache.size > 1) {
		const oldestKey = previewTextureCache.keys().next().value as string | undefined;
		if (oldestKey === undefined || oldestKey === key) break;
		const oldest = previewTextureCache.get(oldestKey);
		previewTextureCache.delete(oldestKey);
		if (oldest) {
			previewTextureCacheBytes -= oldest.bytes;
			dropCachedTexture(oldest);
		}
	}
};
