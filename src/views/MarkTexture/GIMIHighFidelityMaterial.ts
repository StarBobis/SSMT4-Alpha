import * as THREE from 'three';
import gimiFragmentShader from './shaders/gimi-high-fidelity.frag.glsl?raw';
import gimiVertexShader from './shaders/gimi-high-fidelity.vert.glsl?raw';

export type GIMITextureKind = 'diffuse' | 'normal' | 'lightMap' | 'rampMap' | 'metalMap';
export const GIMI_MAX_DIFFUSE_LAYERS = 4;
const diffuseLayerUniformNames = ['uDiffuseMap0', 'uDiffuseMap1', 'uDiffuseMap2', 'uDiffuseMap3'] as const;

type GIMITextureUniforms = {
	map: 'uDiffuseMap' | 'uNormalMap' | 'uLightMap' | 'uRampMap' | 'uMetalMap';
	hasMap: 'uHasDiffuseMap' | 'uHasNormalMap' | 'uHasLightMap' | 'uHasRampMap' | 'uHasMetalMap';
};

const textureUniforms: Record<GIMITextureKind, GIMITextureUniforms> = {
	diffuse: { map: 'uDiffuseMap', hasMap: 'uHasDiffuseMap' },
	normal: { map: 'uNormalMap', hasMap: 'uHasNormalMap' },
	lightMap: { map: 'uLightMap', hasMap: 'uHasLightMap' },
	rampMap: { map: 'uRampMap', hasMap: 'uHasRampMap' },
	metalMap: { map: 'uMetalMap', hasMap: 'uHasMetalMap' },
};

const CURVE_LUT_SIZE = 512;
const EPSILON = 0.00001;

const saturate = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * Blender's CurveMapping is a piecewise cubic curve.  The v12 material only
 * adds one combined-channel point, so this monotone Hermite bake has exactly
 * the same three knots as the source graph and is sampled in GLSL as a LUT.
 */
const sampleCombinedCurve = (x: number, pointX: number, pointY: number): number => {
	const leftSlope = pointY / Math.max(pointX, EPSILON);
	const middleSlope = 1;
	const rightSlope = (1 - pointY) / Math.max(1 - pointX, EPSILON);
	const x0 = x <= pointX ? 0 : pointX;
	const y0 = x <= pointX ? 0 : pointY;
	const x1 = x <= pointX ? pointX : 1;
	const y1 = x <= pointX ? pointY : 1;
	const t = saturate((x - x0) / Math.max(x1 - x0, EPSILON));
	const t2 = t * t;
	const t3 = t2 * t;
	const m0 = x <= pointX ? leftSlope : middleSlope;
	const m1 = x <= pointX ? middleSlope : rightSlope;
	const span = x1 - x0;
	return saturate(
		(2 * t3 - 3 * t2 + 1) * y0
			+ (t3 - 2 * t2 + t) * span * m0
			+ (-2 * t3 + 3 * t2) * y1
			+ (t3 - t2) * span * m1
	);
};

const createCombinedCurveLut = (pointX: number, pointY: number): THREE.DataTexture => {
	const pixels = new Uint8Array(CURVE_LUT_SIZE * 4);
	for (let index = 0; index < CURVE_LUT_SIZE; index += 1) {
		const value = Math.round(sampleCombinedCurve(index / (CURVE_LUT_SIZE - 1), pointX, pointY) * 255);
		const offset = index * 4;
		pixels[offset] = value;
		pixels[offset + 1] = value;
		pixels[offset + 2] = value;
		pixels[offset + 3] = 255;
	}
	const texture = new THREE.DataTexture(pixels, CURVE_LUT_SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.colorSpace = THREE.NoColorSpace;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
};

const baseCurveLut = createCombinedCurveLut(0.457726, 0.298387);
const rampCurveLut = createCombinedCurveLut(0.499811, 0.378282);

export class GIMITextureSet {
	static apply(material: THREE.ShaderMaterial, kind: GIMITextureKind, texture: THREE.Texture | undefined): void {
		if (kind === 'diffuse') {
			this.applyDiffuseLayers(material, texture ? [texture] : []);
			return;
		}
		const names = textureUniforms[kind];
		material.uniforms[names.map].value = texture ?? null;
		material.uniforms[names.hasMap].value = texture ? 1 : 0;
	}

	static applyDiffuseLayers(material: THREE.ShaderMaterial, textures: readonly THREE.Texture[]): void {
		for (let index = 0; index < GIMI_MAX_DIFFUSE_LAYERS; index += 1) {
			material.uniforms[diffuseLayerUniformNames[index]].value = textures[index] ?? null;
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
	private normalStrength = 0.55;

	attach(material: THREE.ShaderMaterial): void {
		this.materials.add(material);
		material.uniforms.uLightDir.value.copy(this.lightDirection);
		material.uniforms.uElementColor.value.copy(this.elementColor);
		material.uniforms.uEmissionStrength.value = this.emissionStrength;
		material.uniforms.uNormalStrength.value = this.normalStrength;
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
		this.normalStrength = THREE.MathUtils.clamp(Number.isFinite(strength) ? strength : 0.55, 0, 1);
		for (const material of this.materials) {
			material.uniforms.uNormalStrength.value = this.normalStrength;
		}
	}

	dispose(): void {
		this.materials.clear();
	}
}

export const createGIMIHighFidelityMaterial = (fallbackColor: THREE.Color, needsReview = false): THREE.ShaderMaterial => new THREE.ShaderMaterial({
	uniforms: {
		uDiffuseMap0: { value: null },
		uDiffuseMap1: { value: null },
		uDiffuseMap2: { value: null },
		uDiffuseMap3: { value: null },
		uDiffuseCount: { value: 0 },
		uNormalMap: { value: null },
		uLightMap: { value: null },
		uRampMap: { value: null },
		uMetalMap: { value: null },
		uHasDiffuseMap: { value: 0 },
		uHasNormalMap: { value: 0 },
		uHasLightMap: { value: 0 },
		uHasRampMap: { value: 0 },
		uHasMetalMap: { value: 0 },
		uFallbackColor: { value: fallbackColor.clone() },
		uNeedsReview: { value: needsReview ? 1 : 0 },
		uLightDir: { value: new THREE.Vector3(0, Math.cos(THREE.MathUtils.degToRad(50)), Math.sin(THREE.MathUtils.degToRad(50))) },
		uBaseCurveLut: { value: baseCurveLut },
		 uRampCurveLut: { value: rampCurveLut },
		uFrame: { value: 0 },
		uElementColor: { value: new THREE.Color('#a8a8a8') },
		uEmissionStrength: { value: 1 },
		uNormalStrength: { value: 0.55 },
	},
	vertexShader: gimiVertexShader.replaceAll('__EPSILON__', EPSILON.toFixed(5)),
	fragmentShader: gimiFragmentShader.replaceAll('__EPSILON__', EPSILON.toFixed(5)),
	side: THREE.DoubleSide,
});
