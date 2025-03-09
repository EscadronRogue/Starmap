// /filters/myAlphaShapes3D.js
// A naive "3D alpha shape" approach, from scratch, for demonstration.

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * generateConcaveMesh(positions, alpha):
 *   Creates a naive, approximate "concave" shape passing near all points.
 *   1) Connect points with edges if distance < alpha
 *   2) Attempt to form triangles from every triplet of points that are mutually connected
 *   3) Combine into a single BufferGeometry
 * 
 * @param {THREE.Vector3[]} positions  - Array of point positions
 * @param {number} alpha               - Distance threshold for connecting edges
 * @returns {THREE.BufferGeometry|null}
 */
export function generateConcaveMesh(positions, alpha) {
  if (positions.length < 4) {
    console.warn("Not enough points for naive 3D alpha shape.");
    return null;
  }

  // Step A: Build adjacency (which points are within alpha)
  // We'll store edges in a adjacencyMap: index => array of connected indices
  const adjacencyMap = new Map();
  for (let i = 0; i < positions.length; i++) {
    adjacencyMap.set(i, []);
  }

  // Build list of all edges (i < j)
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dist = positions[i].distanceTo(positions[j]);
      if (dist <= alpha) {
        adjacencyMap.get(i).push(j);
        adjacencyMap.get(j).push(i);
      }
    }
  }

  // Step B: Attempt to form triangles: we look for triplets (i, j, k)
  // where i->j, j->k, i->k are all connected edges
  // This can generate a lot of overlapping triangles in 3D. A more
  // robust approach is to do Delaunay or surface reconstruction.
  const triangles = [];
  for (let i = 0; i < positions.length; i++) {
    const adjI = adjacencyMap.get(i);
    for (let a = 0; a < adjI.length; a++) {
      const j = adjI[a];
      if (j <= i) continue; // ensure i < j
      // intersection of adjacency for i & j => potential shared neighbors
      const adjJ = adjacencyMap.get(j);
      const sharedNeighbors = adjI.filter(x => adjJ.includes(x) && x > j);
      // each x in sharedNeighbors forms a triangle i-j-x
      for (const k of sharedNeighbors) {
        triangles.push([i, j, k]);
      }
    }
  }

  if (triangles.length === 0) {
    console.warn("No triangles formed with alpha =", alpha);
    return null;
  }

  // Step C: Build a geometry from these triangles
  // We'll store positions in a float array, then build a BufferGeometry
  const vertices = [];
  for (const tri of triangles) {
    // tri is [i, j, k]
    const [i, j, k] = tri;
    const p1 = positions[i];
    const p2 = positions[j];
    const p3 = positions[k];
    vertices.push(p1.x, p1.y, p1.z);
    vertices.push(p2.x, p2.y, p2.z);
    vertices.push(p3.x, p3.y, p3.z);
  }

  const geometry = new THREE.BufferGeometry();
  const vertexFloat32 = new Float32Array(vertices);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertexFloat32, 3));

  // step D: (Optional) compute normals, merge duplicates, etc.
  geometry.computeVertexNormals();

  return geometry;
}
