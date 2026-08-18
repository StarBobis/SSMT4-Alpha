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
uniform float uNormalStrength;
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
        if (uDiffuseCount > 0.0) { vec4 layer = texture2D(uDiffuseMap0, vUv); diffuseSample.rgb += layer.rgb; diffuseAlpha = max(diffuseAlpha, layer.a); }
        if (uDiffuseCount > 1.0) { vec4 layer = texture2D(uDiffuseMap1, vUv); diffuseSample.rgb += layer.rgb; diffuseAlpha = max(diffuseAlpha, layer.a); }
        if (uDiffuseCount > 2.0) { vec4 layer = texture2D(uDiffuseMap2, vUv); diffuseSample.rgb += layer.rgb; diffuseAlpha = max(diffuseAlpha, layer.a); }
        if (uDiffuseCount > 3.0) { vec4 layer = texture2D(uDiffuseMap3, vUv); diffuseSample.rgb += layer.rgb; diffuseAlpha = max(diffuseAlpha, layer.a); }
    }
    vec4 normalSample = vec4(0.5, 0.5, 1.0, 1.0);
    if (uHasNormalMap > 0.5) normalSample = texture2D(uNormalMap, vUv);
    vec4 lightSample = vec4(0.0, 1.0, 0.0, 0.0);
    if (uHasLightMap > 0.5) lightSample = texture2D(uLightMap, vUv);
    vec4 rampSample = vec4(0.72, 0.62, 0.58, 1.0);

    vec2 normalXY = (normalSample.rg * 2.0 - 1.0) * clamp(uNormalStrength, 0.0, 1.0);
    float normalZ = sqrt(max(1.0 - dot(normalXY, normalXY), 0.0));
    vec3 geometricNormal = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
    vec3 tangent = safeNormalize(vWorldTangent - geometricNormal * dot(geometricNormal, vWorldTangent), vec3(1.0, 0.0, 0.0));
    vec3 bitangent = safeNormalize(cross(geometricNormal, tangent) * vTangentHandedness, vec3(0.0, 0.0, 1.0));
    vec3 surfaceNormal = safeNormalize(tangent * normalXY.x + bitangent * normalXY.y + geometricNormal * normalZ, geometricNormal);
    vec3 lightDirection = safeNormalize(uLightDir, vec3(0.0, 0.64278761, 0.76604444));
    // Match the reference avatar body pass: LightMap.G is AO, not a brightness multiplier.
    float aoFactor = clamp(lightSample.g * vVertexAo, 0.0, 1.0);
    float halfLambert = smoothstep(0.0, 1.08, dot(surfaceNormal, lightDirection) + 0.55);
    float rampX = clamp(2.0 * halfLambert * aoFactor, 0.0, 1.0);
    if (aoFactor > 0.90) rampX = 1.0;
    float fullyLit = step(0.998, rampX);
    if (uHasRampMap > 0.5) rampSample = texture2D(uRampMap, vec2(rampX, rampRow(lightSample.a)));
    vec3 baseLinear = srgbToLinear(diffuseSample.rgb);
    vec3 rampLinear = srgbToLinear(rampSample.rgb);
    vec3 gradedBase = sampleCurve(uBaseCurveLut, baseLinear);
    vec3 gradedRamp = sampleCurve(uRampCurveLut, rampLinear);
    if (dot(gradedBase, gradedBase) < 0.000001 && dot(baseLinear, baseLinear) > 0.000001) gradedBase = baseLinear;
    if (dot(gradedRamp, gradedRamp) < 0.000001 && dot(rampLinear, rampLinear) > 0.000001) gradedRamp = rampLinear;
    gradedBase *= 1.8;
    gradedRamp *= 0.97;
    vec3 bodyRamp = mix(gradedRamp, vec3(0.85, 0.77519834, 0.765), fullyLit);
    // Indirect fill lifts only the shadow end and is independent of bloom.
    vec3 nonmetalColor = gradedBase * bodyRamp + gradedBase * (0.10 * (1.0 - rampX));
    float metalMask = step(0.90, lightSample.r);
    vec3 viewDirection = safeNormalize(cameraPosition - vWorldPosition, vec3(0.0, 0.0, 1.0));
    vec3 halfDirection = safeNormalize(viewDirection + lightDirection, viewDirection);
    float glossyValue = pow(max(dot(surfaceNormal, halfDirection), 0.0), 90.0);
    vec3 cameraNormal = safeNormalize(mat3(viewMatrix) * geometricNormal, vec3(0.0, 0.0, 1.0));
    vec2 matcapUv = cameraNormal.xy * 0.5 + 0.5;
    vec3 metalSample = vec3(0.75);
    if (uHasMetalMap > 0.5) metalSample = texture2D(uMetalMap, matcapUv).rgb;
    float matcapValue = dot(metalSample, vec3(0.2126, 0.7152, 0.0722));
    vec3 metalMatcap = mix(vec3(0.51, 0.30, 0.19), vec3(1.0), clamp(matcapValue * 3.0, 0.0, 1.0));
    float metalSpecular = glossyValue * clamp(lightSample.r, 0.0, 1.0) * 0.5;
    vec3 metalColor = nonmetalColor * metalMatcap + baseLinear * metalSpecular;
    vec3 ordinaryColor = mix(nonmetalColor, metalColor, metalMask);
    float pulse = mix(1.0, 5.0, 0.5 + 0.5 * cos(uFrame / 50.0));
    vec3 specialEmission = gradedBase * uElementColor * (diffuseAlpha * uEmissionStrength * pulse);
    vec3 finalColor = ordinaryColor + specialEmission;
    if (uNeedsReview > 0.5) finalColor = mix(finalColor, vec3(1.0, 0.05, 0.05), 0.5);
    gl_FragColor = vec4(finalColor, 1.0);
    #include <colorspace_fragment>
}
