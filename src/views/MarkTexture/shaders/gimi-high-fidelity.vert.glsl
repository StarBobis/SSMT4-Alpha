attribute vec4 ssmtRawTangent;
attribute vec4 ssmtRawColor;
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

vec3 fallbackTangent(vec3 normal) {
    vec3 axis = vec3(1.0, 0.0, 0.0);
    if (abs(normal.y) < 0.999) axis = vec3(0.0, 1.0, 0.0);
    return safeNormalize(cross(axis, normal), vec3(1.0, 0.0, 0.0));
}

void main() {
    vUv = uv;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    // uLightDir and the tangent are both in world space. normalMatrix instead
    // transforms into view space here, which made the toon band drift with the
    // camera and gave cloth a moving satin-like highlight.
    vec3 worldNormal = safeNormalize(mat3(modelMatrix) * normal, vec3(0.0, 1.0, 0.0));
    vec3 tangent = mat3(modelMatrix) * ssmtRawTangent.xyz;
    tangent = tangent - worldNormal * dot(worldNormal, tangent);
    vWorldNormal = worldNormal;
    vWorldTangent = safeNormalize(tangent, fallbackTangent(worldNormal));
    vTangentHandedness = ssmtRawTangent.w < 0.0 ? -1.0 : 1.0;
    // Genshin's body pass uses vertex COLOR.R as a second AO factor.
    // Geometry construction supplies white when the source stream is absent.
    vVertexAo = clamp(ssmtRawColor.r, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
