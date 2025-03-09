// /filters/alphaShape3D.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * A minimal demonstration alpha shape approach in 3D.
 * We now generate all 4-combinations of the points, forming multiple tetrahedra,
 * and apply a naive circumscribed radius test to filter them by alpha.
 * This is still not a robust alpha shape library, but includes debug logging.
 */

export function computeAlphaShape3D(points, alpha) {
  console.log("[alphaShape3D] Starting alpha shape. #points =", points.length, " alpha =", alpha);

  if (points.length < 4) {
    console.warn("[alphaShape3D] < 4 points, returning empty geometry.");
    return new THREE.BufferGeometry();
  }

  // 1) Generate tetrahedra from all 4-combinations of the points
  const tetraList = computeAllTetrahedra(points);
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
 * Build tetrahedra from all 4-combinations of the given points.
 * This is still not a Delaunay approach, but ensures all points are used in some tetras.
 */
function computeAllTetrahedra(points) {
  const tetras = [];
  const n = points.length;
  // Generate all 4-combinations (a<b<c<d)
  for (let a = 0; a < n; a++) {
    for (let b = a+1; b < n; b++) {
      for (let c = b+1; c < n; c++) {
        for (let d = c+1; d < n; d++) {
          tetras.push([ points[a], points[b], points[c], points[d] ]);
        }
      }
    }
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
    // Each tetra has 4 triangular faces
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
