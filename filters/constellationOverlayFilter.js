// filters/constellationOverlayFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getConstellationBoundaries } from './constellationFilter.js';
import { getBaseColor } from './densityColorUtils.js';

const R = 100; // Globe radius

/**
 * Creates a low opacity overlay for each constellation.
 * It collects all boundary segments for a given constellation,
 * computes the convex hull (in a tangent plane), and then builds
 * a fan-triangulated mesh filled with a low opacity color.
 *
 * @returns {Array} Array of THREE.Mesh objects (overlays) for the Globe.
 */
function createConstellationOverlayForGlobe() {
  const boundaries = getConstellationBoundaries();
  const constellationPoints = {};

  // For each boundary segment add both endpoints to each constellation
  boundaries.forEach(seg => {
    // For the first constellation in the segment:
    if (!constellationPoints[seg.const1]) {
      constellationPoints[seg.const1] = [];
    }
    constellationPoints[seg.const1].push(radToSphere(seg.ra1, seg.dec1, R));
    constellationPoints[seg.const1].push(radToSphere(seg.ra2, seg.dec2, R));
    // For the second constellation:
    if (!constellationPoints[seg.const2]) {
      constellationPoints[seg.const2] = [];
    }
    constellationPoints[seg.const2].push(radToSphere(seg.ra1, seg.dec1, R));
    constellationPoints[seg.const2].push(radToSphere(seg.ra2, seg.dec2, R));
  });

  const overlays = [];
  for (const constellation in constellationPoints) {
    let pts = removeDuplicatePoints(constellationPoints[constellation]);
    if (pts.length < 3) continue;

    // Compute the (Euclidean) centroid.
    const centroid = new THREE.Vector3(0, 0, 0);
    pts.forEach(p => centroid.add(p));
    centroid.divideScalar(pts.length);

    // Use the normalized centroid as the plane normal.
    const n = centroid.clone().normalize();
    let globalUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(n.dot(globalUp)) > 0.9) {
      globalUp = new THREE.Vector3(1, 0, 0);
    }
    const tangent = globalUp.clone().sub(n.clone().multiplyScalar(n.dot(globalUp))).normalize();
    const bitangent = new THREE.Vector3().crossVectors(n, tangent).normalize();

    // Project each 3D point to 2D coordinates in the tangent plane.
    const pts2D = pts.map(p => {
      return new THREE.Vector2(p.dot(tangent), p.dot(bitangent));
    });

    // Compute convex hull indices of the 2D points.
    const hullIndices = convexHullIndices(pts2D);
    if (hullIndices.length < 3) continue;
    const hullPts2D = hullIndices.map(i => pts2D[i]);

    // Convert the 2D hull points back to 3D by "lifting" them to the tangent plane and projecting onto the sphere.
    const hullPts3D = hullPts2D.map(v => {
      const p = n.clone().multiplyScalar(R)
        .add(tangent.clone().multiplyScalar(v.x))
        .add(bitangent.clone().multiplyScalar(v.y));
      return p.normalize().multiplyScalar(R);
    });

    // Build geometry via fan triangulation.
    const vertices = [];
    hullPts3D.forEach(p => {
      vertices.push(p.x, p.y, p.z);
    });
    const indices = [];
    for (let i = 1; i < hullPts3D.length - 1; i++) {
      indices.push(0, i, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Material: use a base color for the constellation with low opacity.
    const color = getBaseColor(constellation);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    overlays.push(mesh);
  }
  return overlays;
}

// Helper: convert spherical coordinates (in radians) to 3D position on a sphere.
function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

// Helper: remove duplicate points (within a given tolerance)
function removeDuplicatePoints(points, tolerance = 1e-3) {
  const unique = [];
  points.forEach(p => {
    if (!unique.some(q => p.distanceTo(q) < tolerance)) {
      unique.push(p);
    }
  });
  return unique;
}

// Helper: simple convex hull using Graham scan in 2D.
function convexHullIndices(points) {
  if (points.length < 3) return [];
  let minIndex = 0;
  for (let i = 1; i < points.length; i++) {
    if (
      points[i].y < points[minIndex].y ||
      (points[i].y === points[minIndex].y && points[i].x < points[minIndex].x)
    ) {
      minIndex = i;
    }
  }
  const sortedIndices = points
    .map((p, i) => i)
    .filter(i => i !== minIndex)
    .sort((i, j) => {
      const angleI = Math.atan2(points[i].y - points[minIndex].y, points[i].x - points[minIndex].x);
      const angleJ = Math.atan2(points[j].y - points[minIndex].y, points[j].x - points[minIndex].x);
      return angleI - angleJ;
    });
  const hull = [minIndex, sortedIndices[0]];
  for (let k = 1; k < sortedIndices.length; k++) {
    let top = hull[hull.length - 1];
    let nextToTop = hull[hull.length - 2];
    const current = sortedIndices[k];
    while (
      hull.length >= 2 &&
      cross(points[nextToTop], points[top], points[current]) <= 0
    ) {
      hull.pop();
      top = hull[hull.length - 1];
      nextToTop = hull[hull.length - 2];
    }
    hull.push(current);
  }
  return hull;
}

function cross(p, q, r) {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

export { createConstellationOverlayForGlobe };
