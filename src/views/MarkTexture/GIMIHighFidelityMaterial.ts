import * as THREE from 'three';

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

	attach(material: THREE.ShaderMaterial): void {
		this.materials.add(material);
		material.uniforms.uLightDir.value.copy(this.lightDirection);
		material.uniforms.uElementColor.value.copy(this.elementColor);
		material.uniforms.uEmissionStrength.value = this.emissionStrength;
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
	},
	vertexShader: `
		attribute vec4 ssmtRawTangent;
		varying vec2 vUv;
		varying vec3 vWorldPosition;
		varying vec3 vWorldNormal;
		varying vec3 vWorldTangent;
		varying float vTangentHandedness;

		vec3 safeNormalize(vec3 value, vec3 fallback) {
			float lengthSquared = dot(value, value);
			if (lengthSquared > ${EPSILON.toFixed(5)}) return value * inversesqrt(lengthSquared);
			return fallback;
		}

		vec3 fallbackTangent(vec3 normal) {
			vec3 axis = vec3(1.0, 0.0, 0.0);
			if (abs(normal.y) < 0.999) axis = vec3(0.0, 1.0, 0.0);
			return safeNormalize(cross(axis, normal), vec3(1.0, 0.0, 0.0));
		}

		void main() {
			vUv = uv;
			vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
			vec3 worldNormal = safeNormalize(normalMatrix * normal, vec3(0.0, 1.0, 0.0));
			vec3 tangent = mat3(modelMatrix) * ssmtRawTangent.xyz;
			tangent = tangent - worldNormal * dot(worldNormal, tangent);
			vWorldNormal = worldNormal;
			vWorldTangent = safeNormalize(tangent, fallbackTangent(worldNormal));
			vTangentHandedness = 1.0;
			if (ssmtRawTangent.w < 0.0) vTangentHandedness = -1.0;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: `
		uniform sampler2D uDiffuseMap0;
		uniform sampler2D uDiffuseMap1;
		uniform sampler2D uDiffuseMap2;
		uniform sampler2D uDiffuseMap3;
		uniform float uDiffuseCount;
		uniform sampler2D uNormalMap;
		uniform sampler2D uLightMap;
		uniform sampler2D uRampMap;
		uniform sampler2D uMetalMap;
		uniform sampler2D uBaseCurveLut;
		uniform sampler2D uRampCurveLut;
		uniform float uFrame;
		uniform vec3 uElementColor;
		uniform float uEmissionStrength;
		uniform float uHasDiffuseMap;
		uniform float uHasNormalMap;
		uniform float uHasLightMap;
		uniform float uHasRampMap;
		uniform float uHasMetalMap;
		uniform vec3 uFallbackColor;
		uniform float uNeedsReview;
		uniform vec3 uLightDir;
		varying vec2 vUv;
		varying vec3 vWorldPosition;
		varying vec3 vWorldNormal;
		varying vec3 vWorldTangent;
		varying float vTangentHandedness;

		vec3 safeNormalize(vec3 value, vec3 fallback) {
			float lengthSquared = dot(value, value);
			if (lengthSquared > ${EPSILON.toFixed(5)}) return value * inversesqrt(lengthSquared);
			return fallback;
		}

		vec3 srgbToLinear(vec3 color) {
			vec3 low = color / 12.92;
			vec3 high = pow(max((color + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
			return mix(high, low, step(color, vec3(0.04045)));
		}

		vec3 sampleCurve(sampler2D curve, vec3 color) {
			return vec3(
				texture2D(curve, vec2(clamp(color.r, 0.0, 1.0), 0.5)).r,
				texture2D(curve, vec2(clamp(color.g, 0.0, 1.0), 0.5)).r,
				texture2D(curve, vec2(clamp(color.b, 0.0, 1.0), 0.5)).r
			);
		}

		float rampRow(float materialId) {
			float row = 0.0;
			if (abs(materialId - 1.0) <= 0.05) row = 0.85;
			if (abs(materialId - 0.7) <= 0.05) row = 0.55;
			if (abs(materialId - 0.5) <= 0.05) row = 0.75;
			if (abs(materialId - 0.3) <= 0.05) row = 0.65;
			if (abs(materialId - 0.0) <= 0.05) row = 0.95;
			return row;
		}

		void main() {
			vec4 diffuseSample = vec4(uFallbackColor, 0.0);
			float diffuseAlpha = 0.0;
			if (uDiffuseCount > 0.5) {
				diffuseSample.rgb = vec3(0.0);
				if (uDiffuseCount > 0.0) {
					vec4 layer = texture2D(uDiffuseMap0, vUv);
					diffuseSample.rgb += layer.rgb;
					diffuseAlpha = max(diffuseAlpha, layer.a);
				}
				if (uDiffuseCount > 1.0) {
					vec4 layer = texture2D(uDiffuseMap1, vUv);
					diffuseSample.rgb += layer.rgb;
					diffuseAlpha = max(diffuseAlpha, layer.a);
				}
				if (uDiffuseCount > 2.0) {
					vec4 layer = texture2D(uDiffuseMap2, vUv);
					diffuseSample.rgb += layer.rgb;
					diffuseAlpha = max(diffuseAlpha, layer.a);
				}
				if (uDiffuseCount > 3.0) {
					vec4 layer = texture2D(uDiffuseMap3, vUv);
					diffuseSample.rgb += layer.rgb;
					diffuseAlpha = max(diffuseAlpha, layer.a);
				}
			}
			vec4 normalSample = vec4(0.5, 0.5, 1.0, 1.0);
			if (uHasNormalMap > 0.5) normalSample = texture2D(uNormalMap, vUv);
			vec4 lightSample = vec4(0.0, 1.0, 0.0, 0.0);
			if (uHasLightMap > 0.5) lightSample = texture2D(uLightMap, vUv);
			vec4 rampSample = vec4(0.72, 0.62, 0.58, 1.0);
			if (uHasRampMap > 0.5) rampSample = texture2D(uRampMap, vec2(0.5));

			vec2 normalXY = normalSample.rg * 2.0 - 1.0;
			float normalZ = sqrt(max(1.0 - dot(normalXY, normalXY), 0.0));
			vec3 geometricNormal = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
			vec3 tangent = vWorldTangent - geometricNormal * dot(geometricNormal, vWorldTangent);
			tangent = safeNormalize(tangent, vec3(1.0, 0.0, 0.0));
			vec3 bitangent = safeNormalize(cross(geometricNormal, tangent) * vTangentHandedness, vec3(0.0, 0.0, 1.0));
			vec3 surfaceNormal = safeNormalize(
				tangent * normalXY.x + bitangent * normalXY.y + geometricNormal * normalZ,
				geometricNormal
			);
			vec3 lightDirection = safeNormalize(uLightDir, vec3(0.0, 0.64278761, 0.76604444));
			float ndotl = dot(surfaceNormal, lightDirection);
			float lightGain = clamp(lightSample.g * 2.2, 0.0, 1.0);
			// The URP reference keeps the signed N.L term and forms the toon
			// shadow with a shifted smoothstep. Clamping N.L first makes the
			// back side start at 0.25, which washes out the entire character.
			float shadow = smoothstep(0.0, 1.08, ndotl + 0.55);
			float halfLambert = clamp(shadow * clamp(lightGain + 0.01, 0.0, 1.0), 0.0, 1.0);
			float rampX = clamp(halfLambert * 2.0, 0.0, 1.0);
			float fullyLit = 0.0;
			if (rampX > 0.998) fullyLit = 1.0;
			if (uHasRampMap > 0.5) rampSample = texture2D(uRampMap, vec2(rampX, rampRow(lightSample.a)));
			vec3 baseLinear = srgbToLinear(diffuseSample.rgb);
			vec3 rampLinear = srgbToLinear(rampSample.rgb);
			vec3 gradedBase = sampleCurve(uBaseCurveLut, baseLinear);
			vec3 gradedRamp = sampleCurve(uRampCurveLut, rampLinear);
			// Keep a visible fallback if a constrained WebGL implementation cannot
			// sample the small curve LUT texture; valid LUT samples remain unchanged.
			if (dot(gradedBase, gradedBase) < 0.000001 && dot(baseLinear, baseLinear) > 0.000001) gradedBase = baseLinear;
			if (dot(gradedRamp, gradedRamp) < 0.000001 && dot(rampLinear, rampLinear) > 0.000001) gradedRamp = rampLinear;
			gradedBase *= 1.8;
			vec3 bodyRamp = mix(gradedRamp, vec3(0.9294118, 0.89411765, 0.8901961), fullyLit);

			vec3 nonmetalColor = gradedBase * bodyRamp;
			float metalMask = step(0.55, lightSample.r);
			vec3 viewDirection = safeNormalize(cameraPosition - vWorldPosition, vec3(0.0, 0.0, 1.0));
			vec3 reflectedLight = reflect(-lightDirection, surfaceNormal);
			float glossyValue = pow(max(dot(reflectedLight, viewDirection), 0.0), 4.0);
			float maskedSpecular = glossyValue * metalMask * clamp(lightSample.b, 0.0, 1.0);
			float specularLevel = mix(0.02, 0.5, clamp(maskedSpecular, 0.0, 1.0));
			vec3 cameraNormal = safeNormalize(mat3(viewMatrix) * geometricNormal, vec3(0.0, 0.0, 1.0));
			vec2 matcapUv = cameraNormal.xy * 0.5 + 0.5;
			vec3 metalSample = vec3(0.75);
			if (uHasMetalMap > 0.5) metalSample = texture2D(uMetalMap, matcapUv).rgb;
			float matcapValue = dot(metalSample, vec3(0.2126, 0.7152, 0.0722));
			float matcapLevel = mix(0.1, 1.0, clamp(matcapValue, 0.0, 1.0));
			vec3 metalColor = baseLinear * (specularLevel * matcapLevel * 20.0);
			vec3 ordinaryColor = mix(nonmetalColor, metalColor, metalMask);

			float pulse = mix(1.0, 5.0, 0.5 + 0.5 * cos(uFrame / 50.0));
			vec3 specialEmission = gradedBase * uElementColor * (diffuseAlpha * uEmissionStrength * pulse);
			vec3 finalColor = ordinaryColor + specialEmission;
			if (uNeedsReview > 0.5) finalColor = mix(finalColor, vec3(1.0, 0.05, 0.05), 0.5);
			gl_FragColor = vec4(finalColor, 1.0);
			#include <colorspace_fragment>
		}
	`,
	side: THREE.DoubleSide,
});
