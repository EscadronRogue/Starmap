// /filters/alphaShape3D.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * A simplified demonstration alpha shape approach in 3D.
 * Real production code should use a specialized library or a robust algorithm.
 */

/**
 * Entry point to compute the alpha shape for an array of THREE.Vector3 points.
 * @param {THREE.Vector3[]} points - The set of 3D points.
 * @param {number} alpha - The alpha parameter controlling hull tightness.
 * @returns {THREE.BufferGeometry} - A geometry approximating a concave hull (alpha shape).
 */
export function computeAlphaShape3D(points, alpha) {
  if (points.length < 4) {
    // If fewer than 4 points, we can't build a 3D shape. Return a trivial geometry.
    return new THREE.BufferGeometry();
  }

  // 1) Tetrahedralize the points (mock placeholder).
  // In practice, you'd do a real Delaunay tetrahedralization or use an existing library.
  const tetraList = computeDelaunayTetrahedra(points);

  // 2) Filter tetrahedra: keep only those whose circumscribed sphere is <= alpha
  const finalTetras = [];
  for (const tetra of tetraList) {
    const radius = circumscribedSphereRadius(tetra);
    if (radius <= alpha) {
      finalTetras.push(tetra);
    }
  }

  // 3) Build a mesh from the outer faces of these tetrahedra
  return buildMeshFromTetrahedra(finalTetras);
}

/**
 * Mock function that returns a list of tetrahedra, each tetra being an array of 4 points.
 * In reality, you'd use a robust 3D Delaunay library or implement your own.
 * @param {THREE.Vector3[]} points
 * @returns {Array<THREE.Vector3[]>} - Array of tetras, each is an array [p1, p2, p3, p4].
 */
function computeDelaunayTetrahedra(points) {
  // Placeholder: create an extremely naive "tetra" set.
  // This is obviously not a real Delaunay. In real usage, import a 3D triangulation library.
  if (points.length < 4) return [];

  // Just form one big tetra from the first 4 points, ignoring the rest. (Silly example!)
  const tetras = [];
  for (let i = 0; i < points.length - 3; i += 4) {
    const chunk = [
      points[i],
      points[i + 1],
      points[i + 2],
      points[i + 3]
    ];
    tetras.push(chunk);
  }

  return tetras;
}

/**
 * Approximate circumscribed sphere radius of a tetrahedron.
 * @param {THREE.Vector3[]} tetra - array of 4 Vector3 points.
 */
function circumscribedSphereRadius(tetra) {
  // Placeholder approach: just measure max edge length among the 6 edges, then divide by ~1.7
  // Real circumscribed sphere logic is more intricate. We do a quick hack:
  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dist = tetra[i].distanceTo(tetra[j]);
      if (dist > maxDist) maxDist = dist;
    }
  }
  // dividing by ~1.7 is not accurate, but is a placeholder
  return maxDist / 1.7;
}

/**
 * Creates a mesh geometry from the union of outer faces of kept tetrahedra.
 * A real approach would track adjacency and only keep faces not shared by two tetrahedra.
 * Here we just unify all triangle faces.
 * @param {Array<THREE.Vector3[]>} tetraList
 * @returns {THREE.BufferGeometry}
 */
function buildMeshFromTetrahedra(tetraList) {
  const positions = [];
  // Each tetra has 4 faces, each face is a triangle of 3 points
  // We'll just add them all, ignoring shared faces, etc. (This will have duplicates).
  for (const tetra of tetraList) {
    const combos = [
      [0,1,2],
      [0,1,3],
      [0,2,3],
      [1,2,3]
    ];
    combos.forEach(tri => {
      const [a,b,c] = tri;
      positions.push(
        tetra[a].x, tetra[a].y, tetra[a].z,
        tetra[b].x, tetra[b].y, tetra[b].z,
        tetra[c].x, tetra[c].y, tetra[c].z
      );
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(positions), 3)
  );
  geometry.computeVertexNormals();
  return geometry;
}
