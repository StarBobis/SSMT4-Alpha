import * as THREE from 'three';

const FACE_NECK_PLANE_TOLERANCE_METERS = 0.001;
// The bottommost sampled vertex is often the pointed chin tip. A shallow
// height band captures the jaw ring where the face actually meets the neck.
const FACE_CHIN_HEIGHT_TOLERANCE_METERS = 0.004;
const NECK_ANCHOR_SEARCH_RADIUS_METERS = 0.06;

const getVertices = (
	geometry: THREE.BufferGeometry,
	rotation: THREE.Quaternion,
	referencedOnly: boolean
): THREE.Vector3[] => {
	const positions = geometry.getAttribute('position');
	if (!positions) return [];
	const index = geometry.getIndex();
	const referenced = index ? new Set<number>(Array.from(index.array)) : undefined;
	const nonIndexedTriangleVertexCount = Math.floor(positions.count / 3) * 3;
	const vertices: THREE.Vector3[] = [];
	for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
		// Ignore vertices not referenced by a triangle; these are the isolated
		// vertices explicitly excluded by the neck-anchor rule.
		if (referencedOnly && (
			(referenced && !referenced.has(vertexIndex))
			|| (!referenced && vertexIndex >= nonIndexedTriangleVertexCount)
		)) continue;
		vertices.push(new THREE.Vector3().fromBufferAttribute(positions, vertexIndex).applyQuaternion(rotation));
	}
	return vertices;
};

const getYozPlaneVertices = (
	geometry: THREE.BufferGeometry,
	rotation: THREE.Quaternion,
	referencedOnly: boolean
): THREE.Vector3[] => {
	const vertices = getVertices(geometry, rotation, referencedOnly);
	if (vertices.length === 0) return [];
	const nearestPlaneDistance = Math.min(...vertices.map(vertex => Math.abs(vertex.x)));
	return vertices.filter(vertex => (
		Math.abs(vertex.x) <= nearestPlaneDistance + FACE_NECK_PLANE_TOLERANCE_METERS
	));
};

const findFaceAnchorAcrossMeshes = (
	geometries: THREE.BufferGeometry[],
	rotation: THREE.Quaternion
): THREE.Vector3 | undefined => {
	const vertices = geometries.flatMap(geometry => getYozPlaneVertices(geometry, rotation, false));
	if (vertices.length === 0) return undefined;
	const lowestZ = Math.min(...vertices.map(vertex => vertex.z));
	const chinCandidates = vertices.filter(vertex => vertex.z <= lowestZ + FACE_CHIN_HEIGHT_TOLERANCE_METERS);
	// Imported faces point toward -Y. The jaw vertex nearest the neck therefore
	// lies toward the rear (+Y), rather than at the forward-most (-Y) chin tip.
	return chinCandidates.reduce((selected, vertex) => (vertex.y > selected.y ? vertex : selected)).clone();
};

const findNeckAnchor = (geometry: THREE.BufferGeometry, rotation: THREE.Quaternion): THREE.Vector3 | undefined => {
	const vertices = getYozPlaneVertices(geometry, rotation, true);
	if (vertices.length === 0) return undefined;
	const highest = vertices.reduce((selected, vertex) => (
		vertex.z > selected.z || (vertex.z === selected.z && vertex.y > selected.y) ? vertex : selected
	));
	const expected = highest.clone().add(new THREE.Vector3(0, -0.024, -0.18));
	const nearby = vertices.filter(vertex => vertex.distanceTo(expected) <= NECK_ANCHOR_SEARCH_RADIUS_METERS);
	const candidates = nearby.length > 0 ? nearby : vertices;
	return candidates.reduce((selected, vertex) => {
		// The matching neck point is on the front side of a mesh facing -Y.
		if (vertex.y !== selected.y) return vertex.y < selected.y ? vertex : selected;
		return vertex.distanceToSquared(expected) < selected.distanceToSquared(expected) ? vertex : selected;
	}).clone();
};

const createFaceNeckObjectRotation = (): THREE.Quaternion => {
	const rotateZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
	const rotateX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
	// Blender operation order around the world origin: R Z -90, then R X 90.
	return rotateZ.premultiply(rotateX);
};

/**
 * Aligns preview objects only. The neck/body object is deliberately left in
 * its source orientation; only the marked face objects are transformed. This
 * prevents a body Submesh that contains the neck from being laid on its side.
 * BufferGeometry and extracted vertex buffers are never written.
 */
export const applyFaceNeckObjectAlignment = (
	faceMeshes: THREE.Mesh[],
	neckMesh: THREE.Mesh
): boolean => {
	const objectRotation = createFaceNeckObjectRotation();
	for (const faceMesh of faceMeshes) {
		faceMesh.position.set(0, 0, 0);
		faceMesh.quaternion.copy(objectRotation);
	}

	const faceAnchor = findFaceAnchorAcrossMeshes(faceMeshes.map(faceMesh => faceMesh.geometry), objectRotation);
	// The neck/body remains in its original object transform, so its anchor is
	// evaluated without applying the face correction rotation.
	const neckAnchor = findNeckAnchor(neckMesh.geometry, new THREE.Quaternion());
	if (!faceAnchor || !neckAnchor) return false;

	// Keep the neck/head object fixed and move the complete face group onto it.
	const translation = neckAnchor.sub(faceAnchor);
	// The requested translation is constrained to the YOZ plane.
	translation.x = 0;
	for (const faceMesh of faceMeshes) faceMesh.position.copy(translation);
	return true;
};
