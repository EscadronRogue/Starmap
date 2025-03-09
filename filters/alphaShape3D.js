// /filters/alphaShape3D.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * A simplified demonstration alpha shape approach in 3D.
 * Real production code should use a specialized geometry library or a robust algorithm.
 */

export function computeAlphaShape3D(points, alpha) {
  console.log("[alphaShape3D] Starting alpha shape. #points =", points.length, " alpha =", alpha);

  if (points.length < 4) {
    console.warn("[alphaShape3D] < 4 points, returning empty geometry.");
    return new THREE.BufferGeometry();
  }

  // 1) Tetrahedralize the points (mock placeholder).
  const tetraList = computeDelaunayTetrahedra(points);
  console.log("[alphaShape3D] Tetra list length:", tetraList.length);

  // 2) Filter tetrahedra by circumscribed radius
  const finalTetras = [];
  for (const tetra of tetraList) {
    const radius = circumscribedSphereRadius(tetra);
    if (radius <= alpha) {
      finalTetras.push(tetra);
    }
  }
  console.log("[alphaShape3D] Kept tetras after alpha filter:", finalTetras.length,
              " out of", tetraList.length);

  // 3) Build a mesh from the union of outer faces
  const geometry = buildMeshFromTetrahedra(finalTetras);
  console.log("[alphaShape3D] Final geometry vertex count:",
              geometry.attributes.position.count);

  return geometry;
}

/**
 * Mock function to create a naive set of tetrahedra from points.
 * Not a real Delaunay. 
 */
function computeDelaunayTetrahedra(points) {
  // For demonstration, chunk them in groups of 4.
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
 * Approximate circumscribed sphere radius of a tetrahedron by max edge length / 1.7
 */
function circumscribedSphereRadius(tetra) {
  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dist = tetra[i].distanceTo(tetra[j]);
      if (dist > maxDist) maxDist = dist;
    }
  }
  return maxDist / 1.7; // placeholder approximation
}

/**
 * Build geometry from outer faces of tetras.
 * This is naive: we add all faces, ignoring duplicates or adjacency.
 */
function buildMeshFromTetrahedra(tetraList) {
  const positions = [];
  for (const tetra of tetraList) {
    // 4 faces per tetra
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
