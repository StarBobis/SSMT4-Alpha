import * as THREE from 'three';
import gimiFragmentShader from './shaders/gimi-high-fidelity.frag.glsl?raw';
import gimiVertexShader from './shaders/gimi-high-fidelity.vert.glsl?raw';

export type GIMITextureKind = 'diffuse' | 'normal' | 'faceSdf' | 'lightMap' | 'rampMap' | 'metalMap';
// Keep the authored layer count used by the preview data. The target WebGL
// implementations expose more than the eight-unit minimum; retaining four
// layers avoids silently dropping marked DiffuseMaps.
export const GIMI_MAX_DIFFUSE_LAYERS = 4;
const diffuseLayerUniformNames = ['uDiffuseMap0', 'uDiffuseMap1', 'uDiffuseMap2', 'uDiffuseMap3'] as const;

type GIMITextureSampling = 'authored-data' | 'continuous';

type GIMITextureUniforms = {
	map: 'uDiffuseMap' | 'uNormalMap' | 'uFaceSdfMap' | 'uLightMap' | 'uRampMap' | 'uMetalMap';
	hasMap: 'uHasDiffuseMap' | 'uHasNormalMap' | 'uHasFaceSdfMap' | 'uHasLightMap' | 'uHasRampMap' | 'uHasMetalMap';
};

const textureUniforms: Record<GIMITextureKind, GIMITextureUniforms> = {
	diffuse: { map: 'uDiffuseMap', hasMap: 'uHasDiffuseMap' },
	normal: { map: 'uNormalMap', hasMap: 'uHasNormalMap' },
	faceSdf: { map: 'uFaceSdfMap', hasMap: 'uHasFaceSdfMap' },
	lightMap: { map: 'uLightMap', hasMap: 'uHasLightMap' },
	rampMap: { map: 'uRampMap', hasMap: 'uHasRampMap' },
	metalMap: { map: 'uMetalMap', hasMap: 'uHasMetalMap' },
};

const EPSILON = 0.00001;

export class GIMITextureSet {
	private static configureTextureSampling(
		texture: THREE.Texture | undefined,
		sampling: GIMITextureSampling,
		clampEdges = false,
	): void {
		if (!texture) return;
		// Continuous maps use bilinear/trilinear sampling so their texels do not
		// become visible rectangles under close-up or oblique views. Discrete
		// authored data remains available for maps that truly require exact IDs.
		if (sampling === 'authored-data') {
			texture.generateMipmaps = false;
			texture.minFilter = THREE.NearestFilter;
			texture.magFilter = THREE.NearestFilter;
		} else {
			const compressed = texture instanceof THREE.CompressedTexture;
			const hasMipmaps = texture.mipmaps.length > 1;
			texture.generateMipmaps = !compressed;
			texture.minFilter = hasMipmaps || !compressed
				? THREE.LinearMipmapLinearFilter
				: THREE.LinearFilter;
			texture.magFilter = THREE.LinearFilter;
		}
		if (clampEdges) {
			texture.wrapS = THREE.ClampToEdgeWrapping;
			texture.wrapT = THREE.ClampToEdgeWrapping;
		}
		texture.needsUpdate = true;
	}

	static apply(material: THREE.ShaderMaterial, kind: GIMITextureKind, texture: THREE.Texture | undefined): void {
		if (kind === 'diffuse') {
			this.applyDiffuseLayers(material, texture ? [texture] : []);
			return;
		}
		const names = textureUniforms[kind];
		// Face SDF is a continuous distance field, while the ILM/light map also
		// contains continuous AO and masks. Their semantic thresholds are handled
		// in the shader; nearest-neighbour texture sampling visibly exposes texels.
		const sampling: GIMITextureSampling = 'continuous';
		this.configureTextureSampling(texture, sampling, kind !== 'normal');
		material.uniforms[names.map].value = texture ?? null;
		material.uniforms[names.hasMap].value = texture ? 1 : 0;
	}

	static applyDiffuseLayers(material: THREE.ShaderMaterial, textures: readonly THREE.Texture[]): void {
		for (let index = 0; index < GIMI_MAX_DIFFUSE_LAYERS; index += 1) {
			const texture = textures[index];
			this.configureTextureSampling(texture, 'continuous');
			material.uniforms[diffuseLayerUniformNames[index]].value = texture ?? null;
		}
		material.uniforms.uDiffuseCount.value = Math.min(textures.length, GIMI_MAX_DIFFUSE_LAYERS);
	}

	static texture(material: THREE.ShaderMaterial, kind: GIMITextureKind): THREE.Texture | null {
		if (kind === 'diffuse') {
			return material.uniforms.uDiffuseMap0?.value as THREE.Texture | null;
		}
		return material.uniforms[textureUniforms[kind].map].value as THREE.Texture | null;
	}
}

export class GIMIShaderController {
	private readonly materials = new Set<THREE.ShaderMaterial>();
	private readonly lightDirection = new THREE.Vector3(0, Math.cos(THREE.MathUtils.degToRad(50)), Math.sin(THREE.MathUtils.degToRad(50)));
	private readonly elementColor = new THREE.Color('#a8a8a8');
	private emissionStrength = 1;
	private normalStrength = 1;
	private metalMaterial = false;

	attach(material: THREE.ShaderMaterial): void {
		this.materials.add(material);
		material.uniforms.uLightDir.value.copy(this.lightDirection);
		material.uniforms.uElementColor.value.copy(this.elementColor);
		material.uniforms.uEmissionStrength.value = this.emissionStrength;
		material.uniforms.uNormalStrength.value = this.normalStrength;
		material.uniforms.uMetalMaterial.value = this.metalMaterial ? 1 : 0;
	}

	detach(material: THREE.ShaderMaterial): void {
		this.materials.delete(material);
	}

	setLightDirection(direction: THREE.Vector3): void {
		if (direction.lengthSq() < EPSILON || !Number.isFinite(direction.lengthSq())) return;
		this.lightDirection.copy(direction).normalize();
		for (const material of this.materials) {
			material.uniforms.uLightDir.value.copy(this.lightDirection);
		}
	}

	setVirtualSun(rotationXDegrees: number): void {
		const angle = THREE.MathUtils.degToRad(rotationXDegrees);
		// The preview root rotates imported Blender-space geometry by -90 degrees.
		// Apply the same conversion on CPU; GLSL only receives a normalized world direction.
		this.setLightDirection(new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)));
	}

	setFrame(frame: number): void {
		if (!Number.isFinite(frame)) return;
		for (const material of this.materials) {
			material.uniforms.uFrame.value = frame;
		}
	}

	setEmission(elementColor: THREE.ColorRepresentation, strength: number): void {
		this.elementColor.set(elementColor);
		this.emissionStrength = Math.max(0, Number.isFinite(strength) ? strength : 0);
		for (const material of this.materials) {
			material.uniforms.uElementColor.value.copy(this.elementColor);
			material.uniforms.uEmissionStrength.value = this.emissionStrength;
		}
	}

	setNormalStrength(strength: number): void {
		this.normalStrength = THREE.MathUtils.clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
		for (const material of this.materials) {
			material.uniforms.uNormalStrength.value = this.normalStrength;
		}
	}

	setMetalMaterial(enabled: boolean): void {
		this.metalMaterial = enabled;
		for (const material of this.materials) {
			material.uniforms.uMetalMaterial.value = enabled ? 1 : 0;
		}
	}

	dispose(): void {
		this.materials.clear();
	}
}

export const createGIMIHighFidelityMaterial = (fallbackColor: THREE.Color, needsReview = false, flipNormalY = false): THREE.ShaderMaterial => new THREE.ShaderMaterial({
	uniforms: {
		uDiffuseMap0: { value: null },
		uDiffuseMap1: { value: null },
		uDiffuseMap2: { value: null },
		uDiffuseMap3: { value: null },
		uDiffuseCount: { value: 0 },
		uNormalMap: { value: null },
		uFaceSdfMap: { value: null },
		uLightMap: { value: null },
		uRampMap: { value: null },
		uMetalMap: { value: null },
		uHasDiffuseMap: { value: 0 },
		uHasNormalMap: { value: 0 },
		uHasFaceSdfMap: { value: 0 },
		uHasLightMap: { value: 0 },
		uHasRampMap: { value: 0 },
		uHasMetalMap: { value: 0 },
		uFallbackColor: { value: fallbackColor.clone() },
		uNeedsReview: { value: needsReview ? 1 : 0 },
		uLightDir: { value: new THREE.Vector3(0, Math.cos(THREE.MathUtils.degToRad(50)), Math.sin(THREE.MathUtils.degToRad(50))) },
		uFrame: { value: 0 },
		uElementColor: { value: new THREE.Color('#a8a8a8') },
		uEmissionStrength: { value: 1 },
		uNormalStrength: { value: 1 },
	// DirectX-convention normal maps (WWMI / YYSLS / IdentityV) store an
	// inverted green channel; flip the decoded tangent-space Y for them.
	uNormalMapFlipY: { value: flipNormalY ? 1 : 0 },
		// _MetalMaterial is a material constant in the reference shader. A
		// MetalMap alone is only its sphere map and must not enable this branch.
		uMetalMaterial: { value: 0 },
		uSpecularHighlights: { value: 0 },
		uFaceSdfChannel: { value: 0 },
		uIsFaceMesh: { value: 0 },
		// AvatarGenshinPass uses vertex COLOR.R together with LightMap.G for both
		// body and face. This stays separate from the face SDF role.
		uUseVertexColorAo: { value: 0 },
		uIsEyeMesh: { value: 0 },
		uFaceSdfOffset: { value: 0 },
		// Material-level shadow tints from GenshinCelShaderURP. LightMap.A only
		// chooses the RampMap row and must not choose a second dark-color table.
		// The captured body material uses white tints and the normal (non-cool)
		// RampMap half.
		uDarkShadowColor: { value: new THREE.Vector3(1, 1, 1) },
		uCoolDarkShadowColor: { value: new THREE.Vector3(1, 1, 1) },
		uUseCoolShadowColorOrTex: { value: 0 },
		// Face is an independent SDF-driven unlit pass. These are its captured
		// warm light/shadow tints and intentionally do not reference RampMap.
		uFaceLightTint: { value: new THREE.Vector3(0.85, 0.787525, 0.780263) },
		uFaceShadowTint: { value: new THREE.Vector3(0.7553715, 0.31918, 0.2698094) },
		uBrightFac: { value: 0.99 },
		uBrightAreaShadowFactor: { value: 1 },
		// _LightAreaColorTint is shared by the reference body and face materials.
		// It is applied after the ramp lookup, not baked into the RampMap.
		uLightAreaColorTint: { value: new THREE.Vector3(0.9528302, 0.9528302, 0.9528302) },
		// Body ramp controls remain independent from the face controls. Defaults
		// preserve the established GIMI preview order.
		uRampIndices0: { value: 1 },
		uRampIndices1: { value: 4 },
		uRampIndices2: { value: 3 },
		uRampIndices3: { value: 5 },
		uRampIndices4: { value: 2 },
		// The preview root maps the imported local basis (right +X, forward -Y,
		// up +Z) through its -90 degree X rotation into this world-space basis.
		// RotationX(-90): local -Y becomes world +Z, and local +Z becomes world +Y.
		uFaceForward: { value: new THREE.Vector3(0, 0, 1) },
		uFaceRight: { value: new THREE.Vector3(1, 0, 0) },
		uFaceUp: { value: new THREE.Vector3(0, 1, 0) },
	},
	vertexShader: gimiVertexShader.replaceAll('__EPSILON__', EPSILON.toFixed(5)),
	fragmentShader: gimiFragmentShader.replaceAll('__EPSILON__', EPSILON.toFixed(5)),
	side: THREE.DoubleSide,
});
