uniform sampler2D uDiffuseMap0;
uniform sampler2D uDiffuseMap1;
uniform sampler2D uDiffuseMap2;
uniform sampler2D uDiffuseMap3;
uniform float uDiffuseCount;
uniform sampler2D uNormalMap;
uniform sampler2D uFaceSdfMap;
uniform sampler2D uLightMap;
uniform sampler2D uRampMap;
uniform sampler2D uMetalMap;
uniform float uFrame;
uniform vec3 uElementColor;
uniform float uEmissionStrength;
uniform float uNormalStrength;
uniform float uMetalMaterial;
uniform float uSpecularHighlights;
uniform float uFaceSdfChannel;
uniform float uIsFaceMesh;
uniform float uUseVertexColorAo;
uniform float uFaceUseLightMapAo;
uniform float uFaceSdfSoftness;
uniform float uFaceSdfOffset;
uniform vec3 uDarkShadowColor;
uniform vec3 uCoolDarkShadowColor;
uniform float uUseCoolShadowColorOrTex;
uniform vec3 uFaceDarkShadowColor;
uniform vec3 uFaceCoolDarkShadowColor;
uniform float uFaceUseCoolShadowColorOrTex;
uniform float uBrightFac;
uniform float uBrightAreaShadowFactor;
uniform vec3 uLightAreaColorTint;
uniform float uIsEyeMesh;
uniform float uRampIndices0;
uniform float uRampIndices1;
uniform float uRampIndices2;
uniform float uRampIndices3;
uniform float uRampIndices4;
uniform float uFaceRampIndices0;
uniform float uFaceRampIndices1;
uniform float uFaceRampIndices2;
uniform float uFaceRampIndices3;
uniform float uFaceRampIndices4;
uniform float uHasNormalMap;
uniform float uHasFaceSdfMap;
uniform float uHasLightMap;
uniform float uHasRampMap;
uniform float uHasMetalMap;
uniform vec3 uFallbackColor;
uniform float uNeedsReview;
uniform vec3 uLightDir;
uniform vec3 uFaceForward;
uniform vec3 uFaceRight;
uniform vec3 uFaceUp;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying float vTangentHandedness;
varying float vVertexAo;

vec3 safeNormalize(vec3 value, vec3 fallback) {
    float lengthSquared = dot(value, value);
    if (lengthSquared > __EPSILON__) return value * inversesqrt(lengthSquared);
    return fallback;
}

vec3 srgbToLinear(vec3 color) {
    vec3 low = color / 12.92;
    vec3 high = pow(max((color + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
    return mix(high, low, step(color, vec3(0.04045)));
}

float faceSdfChannel(vec4 textureValue, float channel) {
    if (channel < 0.5) return textureValue.r;
    if (channel < 1.5) return textureValue.g;
    if (channel < 2.5) return textureValue.b;
    return textureValue.a;
}

float rampIndexToV(float index) {
    return index * -0.1 + 1.05;
}

// GetShadowRampColor: LightMap.A selects the authored row, while the shadow
// value selects the horizontal RampMap position.
vec3 getShadowRampColor(float shadow, float lightMapAlpha, bool isFace) {
    float rampIndex = isFace ? uFaceRampIndices0 : uRampIndices0;
    if (lightMapAlpha >= 0.25) rampIndex = isFace ? uFaceRampIndices1 : uRampIndices1;
    if (lightMapAlpha >= 0.45) rampIndex = isFace ? uFaceRampIndices2 : uRampIndices2;
    if (lightMapAlpha >= 0.65) rampIndex = isFace ? uFaceRampIndices3 : uRampIndices3;
    if (lightMapAlpha >= 0.95) rampIndex = isFace ? uFaceRampIndices4 : uRampIndices4;

    // AvatarShaderUtils::GetShadowRampColor samples the cool half of the
    // packed RampMap when _UseCoolShadowColorOrTex is enabled. The offset is
    // part of the material semantic, not a face-only adjustment.
    float useCoolRamp = isFace ? uFaceUseCoolShadowColorOrTex : uUseCoolShadowColorOrTex;
    float rampSampling = step(0.5, useCoolRamp) * 0.5;
    float rampV = clamp(rampIndexToV(rampIndex) - rampSampling, 0.0, 1.0);
    vec3 rampColor = vec3(1.0);
    if (uHasRampMap > 0.5) rampColor = srgbToLinear(texture2D(uRampMap, vec2(clamp(shadow, 0.0, 1.0), rampV)).rgb);
    // AvatarShaderUtils::GetShadowRampColor applies the same bright-end rule
    // to body and face materials.  The face pass changes only the vertical
    // SDF boundary; it does not get a second RampMap interpretation.
    return mix(rampColor, vec3(shadow), step(uBrightFac, shadow));
}

vec3 getDarkShadowColor(bool isFace) {
    // The reference shader shares the code path, but the material constants
    // are allowed to differ. The captured face material uses a darker
    // _DarkShadowColor (0.8490566) than the body material (1.0); collapsing
    // these uniforms makes the face shadow visibly brighter than the neck.
    vec3 regularColor = isFace ? uFaceDarkShadowColor : uDarkShadowColor;
    vec3 coolColor = isFace ? uFaceCoolDarkShadowColor : uCoolDarkShadowColor;
    float useCool = isFace ? uFaceUseCoolShadowColorOrTex : uUseCoolShadowColorOrTex;
    return mix(regularColor, coolColor, step(0.5, useCool));
}

float getReferenceShadow(vec3 normal, vec3 light, float ao) {
    // GenshinCelShaderURP::GetShadow (_GreyFac=1.08, _DarkFac=0.55).
    float halfLambert = smoothstep(0.0, 1.08, dot(normal, light) + 0.55);
    float shadow = clamp(2.0 * halfLambert * ao, 0.0, 1.0);
    return mix(shadow, 1.0, step(0.9, ao));
}

float getDirectionalRampShadow(vec3 normal, vec3 light) {
    // Face LightMap.G is not a valid AO source for the captured face asset:
    // it is an almost solid mask and would force the reference AO fast path
    // to shadow=1 everywhere. Keep the same half-Lambert curve, but omit AO.
    float halfLambert = smoothstep(0.0, 1.08, dot(normal, light) + 0.55);
    return clamp(2.0 * halfLambert, 0.0, 1.0);
}



vec3 applyReferenceMetal(
    vec3 shadowColorTint,
    vec3 geometricNormal,
    float ndoth,
    float lightMapR,
    float shadow
) {
    vec3 cameraNormal = safeNormalize(mat3(viewMatrix) * geometricNormal, vec3(0.0, 0.0, 1.0));
    vec2 matcapUv = cameraNormal.xy * 0.5 + 0.5;
    float sphere = 1.0;
    if (uHasMetalMap > 0.5) sphere = texture2D(uMetalMap, matcapUv).r;
    sphere = clamp(sphere * 3.0, 0.0, 1.0); // _MTMapBrightness = 3

    vec3 metalColor = shadowColorTint * mix(vec3(0.51, 0.30, 0.19), vec3(1.0), sphere);
    float metalSpecular = clamp(pow(max(ndoth, 0.001), 90.0) * 15.0, 0.0, 1.0) * lightMapR;
    float shadowTransition = shadow > 0.0 ? shadow : 0.0;
    metalSpecular = mix(metalSpecular, metalSpecular * 0.2, shadowTransition);
    vec3 metal = metalColor + vec3(metalSpecular * 0.5);
    metal *= mix(vec3(1.0), vec3(0.78, 0.77, 0.82), shadowTransition);
    return lightMapR > 0.89 ? metal : shadowColorTint;
}

void main() {
    vec4 mainTex = vec4(uFallbackColor, 0.0);
    if (uDiffuseCount > 0.5) {
        // The first authored DiffuseMap is the opaque base. Its alpha often
        // contains blush/detail data and must not erase the base color.
        if (uDiffuseCount > 0.0) {
            mainTex = texture2D(uDiffuseMap0, vUv);
        }
        // Additional maps are straight-alpha source-over overlays. Do not
        // premultiply the first layer: its alpha may carry authored detail
        // and must not erase the base RGB. Each later alpha is only coverage.
        if (uDiffuseCount > 1.0) {
            vec4 overlay = texture2D(uDiffuseMap1, vUv);
            float coverage = clamp(overlay.a, 0.0, 1.0);
            mainTex.rgb = mix(mainTex.rgb, overlay.rgb, coverage);
            mainTex.a = coverage + mainTex.a * (1.0 - coverage);
        }
        if (uDiffuseCount > 2.0) {
            vec4 overlay = texture2D(uDiffuseMap2, vUv);
            float coverage = clamp(overlay.a, 0.0, 1.0);
            mainTex.rgb = mix(mainTex.rgb, overlay.rgb, coverage);
            mainTex.a = coverage + mainTex.a * (1.0 - coverage);
        }
        if (uDiffuseCount > 3.0) {
            vec4 overlay = texture2D(uDiffuseMap3, vUv);
            float coverage = clamp(overlay.a, 0.0, 1.0);
            mainTex.rgb = mix(mainTex.rgb, overlay.rgb, coverage);
            mainTex.a = coverage + mainTex.a * (1.0 - coverage);
        }
    }

    // Eye meshes are an explicit semantic class: no normal, LightMap, Ramp,
    // metal or face-shadow work is performed for them.
    if (uIsEyeMesh > 0.5) {
        float eyePulse = mix(1.0, 5.0, 0.5 + 0.5 * cos(uFrame / 50.0));
        vec3 eyeColor = srgbToLinear(mainTex.rgb) * uElementColor * uEmissionStrength * eyePulse;
        gl_FragColor = vec4(eyeColor, 1.0);
        return;
    }

    // The reference face pass uses LightMap.R as the participation mask for
    // its SDF/ramp result.  A missing map must therefore not silently become
    // R=0, otherwise the whole face is lerped back to the unlit base texture
    // and appears uniformly bright.  Keep authored values untouched when a
    // map exists; only the missing-map fallback is neutralized.
    vec4 ilmTex = vec4(0.0, 1.0, 0.0, 0.0);
    if (uHasLightMap > 0.5) ilmTex = texture2D(uLightMap, vUv);

    vec3 geometricNormal = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
    vec3 normalWS = geometricNormal;
    if (uHasNormalMap > 0.5) {
        vec4 normalSample = texture2D(uNormalMap, vUv);
        vec2 normalXY = (normalSample.rg * 2.0 - 1.0) * clamp(uNormalStrength, 0.0, 1.0);
        float normalZ = sqrt(max(1.0 - dot(normalXY, normalXY), 0.0));
        vec3 tangent = safeNormalize(vWorldTangent - geometricNormal * dot(geometricNormal, vWorldTangent), vec3(1.0, 0.0, 0.0));
        vec3 bitangent = safeNormalize(cross(geometricNormal, tangent) * vTangentHandedness, vec3(0.0, 0.0, 1.0));
        normalWS = safeNormalize(tangent * normalXY.x + bitangent * normalXY.y + geometricNormal * normalZ, geometricNormal);
    }

    float isFace = step(0.5, uIsFaceMesh);
    vec3 baseColor = srgbToLinear(mainTex.rgb);
    vec3 lightDirection = safeNormalize(uLightDir, vec3(0.0, 0.64278761, 0.76604444));
    // The body uses the reference GetShadow result: LightMap.G is the authored
    // AO term and vertex COLOR.R is its multiplier. The face asset under test
    // has a different G-shaped mask, so its Ramp X is selected separately below.
    float lightMapAo = ilmTex.g;
    // The reference AvatarGenshinPass uses LightMap.G * vertexColor.R for
    // both body and face passes. The face branch changes only the SDF
    // boundary; it does not change the AO source. Keep the uniform as a
    // compatibility override, but default all lit mesh semantics to it.
    float vertexAoFactor = mix(1.0, vVertexAo, clamp(uUseVertexColorAo, 0.0, 1.0));
    float bodyAoFactor = clamp(lightMapAo * vertexAoFactor, 0.0, 1.0);
    float bodyRampX = getReferenceShadow(normalWS, lightDirection, bodyAoFactor);
    float faceRampX = uFaceUseLightMapAo > 0.5
        ? bodyRampX
        : getDirectionalRampShadow(normalWS, lightDirection);
    vec3 bodyRampColor = getShadowRampColor(bodyRampX, ilmTex.a, false);

    // Face SDF controls the vertical boundary. Face Ramp X deliberately does
    // not consume the suspect LightMap.G unless the explicit override is set;
    // LightMap.A still selects the authored RampMap row.
    vec3 rampTexCol = getShadowRampColor(isFace > 0.5 ? faceRampX : bodyRampX, ilmTex.a, isFace > 0.5);
    // Both reference material paths apply the authored light-area tint after
    // the RampMap lookup.
    vec3 brightAreaColor = rampTexCol * uLightAreaColorTint;
    vec3 finalSurfaceColor;

    if (isFace > 0.5) {
        // A face SDF is the authored source for the vertical boundary. When
        // it has not been marked for this submesh, falling back to the shared
        // reference shadow is less surprising than treating the whole face as
        // the bright region.
        float brightAreaMask = faceRampX;
        if (uHasFaceSdfMap > 0.5) {
            vec3 faceUp = safeNormalize(uFaceUp, vec3(0.0, 1.0, 0.0));
            vec3 faceForward = safeNormalize(uFaceForward, vec3(0.0, 0.0, 1.0));
            vec3 faceRight = safeNormalize(uFaceRight, vec3(1.0, 0.0, 0.0));
            vec3 lightDirProj = safeNormalize(lightDirection - faceUp * dot(lightDirection, faceUp), faceForward);
            float isRight = dot(lightDirProj, faceRight) > 0.0 ? 1.0 : 0.0;
            vec2 sdfUv = vec2(mix(vUv.x, 1.0 - vUv.x, isRight), vUv.y);
            float sdfValue = clamp(faceSdfChannel(texture2D(uFaceSdfMap, sdfUv), uFaceSdfChannel) + uFaceSdfOffset, 0.0, 1.0);
            float forwardLight = dot(faceForward, lightDirProj) * 0.5 + 0.5;
            float transition = max(uFaceSdfSoftness, 0.0001);
            float sdfShadow = smoothstep(forwardLight - transition, forwardLight + transition, 1.0 - sdfValue);
            brightAreaMask = 1.0 - sdfShadow;
        }
        // LightMap.R controls how much the face accepts the SDF/ramp result;
        // the selected FaceSDFMap channel controls only the boundary. The
        // reference face and body passes use the same material-level dark
        // shadow tint calculation.
        // With no authored LightMap, a face still needs the reference SDF
        // branch.  Treat participation as fully enabled only in that case;
        // when a map is present its R channel remains authoritative.
        float faceLightMapParticipation = uHasLightMap > 0.5 ? clamp(ilmTex.r, 0.0, 1.0) : 1.0;
        // Face and body share the material dark-shadow tint in the reference
        // shader; only the SDF determines which side of the face is dark.
        vec3 faceDarkShadowColor = rampTexCol * getDarkShadowColor(true);
        vec3 shadowColorTint = mix(faceDarkShadowColor, brightAreaColor, brightAreaMask);
        vec3 faceDiffuse = shadowColorTint * baseColor;
        finalSurfaceColor = mix(baseColor, faceDiffuse, faceLightMapParticipation);
    } else {
        // AvatarGenshinPass body path: the ramp result is graded by the
        // authored dark/light shadow colors before it reaches the base map.
        vec3 bodyBrightAreaColor = bodyRampColor * uLightAreaColorTint;
        vec3 bodyDarkShadowColor = bodyRampColor * getDarkShadowColor(false);
        vec3 bodyShadowColorTint = mix(bodyDarkShadowColor, bodyBrightAreaColor, clamp(uBrightAreaShadowFactor, 0.0, 1.0));
        vec3 bodyDiffuse = baseColor * bodyShadowColorTint;
        vec3 viewDirection = safeNormalize(cameraPosition - vWorldPosition, vec3(0.0, 0.0, 1.0));
        vec3 halfVector = safeNormalize(viewDirection + lightDirection, viewDirection);
        float ndoth = dot(normalWS, halfVector);

        // AvatarSpecularHelper::specular_color, with the sample material's
        // Shininess=10, SpecMulti=0.2 and white specular color. R is the
        // high-specular mask; B supplies the authored shape threshold.
        float specularTerm = pow(max(ndoth, 0.001), 10.0);
        float specularVisible = step(1.015 - ilmTex.b, specularTerm);
        vec3 specular = vec3(specularTerm * 0.2 * ilmTex.r * 0.5 * specularVisible * uSpecularHighlights);
        specular *= 1.0 - step(0.90, ilmTex.r);

        // Only an explicit _MetalMaterial enables this reference branch. The
        // material constant is not present in a texture frame dump, so false
        // remains the safe default until it is captured per submesh.
        vec3 metalDiffuse = applyReferenceMetal(bodyDiffuse, geometricNormal, ndoth, ilmTex.r, bodyRampX);
        bodyDiffuse = mix(bodyDiffuse, metalDiffuse, step(0.5, uMetalMaterial));
        finalSurfaceColor = bodyDiffuse + specular;
    }

    // A single non-face DiffuseMap uses alpha as its authored emission mask.
    // Multi-layer maps reserve alpha for compositing, and faces use SDF/ramp
    // semantics. Keep the result HDR so UnrealBloom has a real input.
    float diffuseEmissionMask = (uDiffuseCount > 0.5 && uDiffuseCount < 1.5 && isFace < 0.5)
        ? clamp(mainTex.a, 0.0, 1.0)
        : 0.0;
    float emissionPulse = mix(1.0, 5.0, 0.5 + 0.5 * cos(uFrame / 50.0));
    vec3 specialEmission = baseColor * uElementColor * diffuseEmissionMask * uEmissionStrength * emissionPulse;
    vec3 finalColor = finalSurfaceColor + specialEmission;
    if (uNeedsReview > 0.5) finalColor = mix(finalColor, vec3(1.0, 0.05, 0.05), 0.5);
    gl_FragColor = vec4(finalColor, 1.0);
}
