// filters/constellationOverlayFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getConstellationBoundaries } from './constellationFilter.js';

const R = 100; // Globe radius

// --- Graph Coloring Helpers (Non-recursive Greedy) ---

function computeNeighborMap() {
  const boundaries = getConstellationBoundaries(); // Each segment: {ra1, dec1, ra2, dec2, const1, const2}
  const neighbors = {};
  boundaries.forEach(seg => {
    if (seg.const1) {
      if (!neighbors[seg.const1]) neighbors[seg.const1] = new Set();
      if (seg.const2) neighbors[seg.const1].add(seg.const2);
    }
    if (seg.const2) {
      if (!neighbors[seg.const2]) neighbors[seg.const2] = new Set();
      if (seg.const1) neighbors[seg.const2].add(seg.const1);
    }
  });
  Object.keys(neighbors).forEach(key => {
    neighbors[key] = Array.from(neighbors[key]);
  });
  return neighbors;
}

function computeConstellationColorMapping() {
  const neighbors = computeNeighborMap();
  const allConsts = new Set();
  Object.keys(neighbors).forEach(c => allConsts.add(c));
  const boundaries = getConstellationBoundaries();
  boundaries.forEach(seg => {
    if (seg.const1) allConsts.add(seg.const1);
    if (seg.const2) allConsts.add(seg.const2);
  });
  const constellations = Array.from(allConsts);
  // Sort in descending order by neighbor count.
  constellations.sort((a, b) => (neighbors[b] ? neighbors[b].length : 0) - (neighbors[a] ? neighbors[a].length : 0));
  const palette = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3'];
  const colorMapping = {};
  for (const c of constellations) {
    const used = new Set();
    if (neighbors[c]) {
      for (const nb of neighbors[c]) {
        if (colorMapping[nb]) used.add(colorMapping[nb]);
      }
    }
    let assigned = palette.find(color => !used.has(color));
    if (!assigned) assigned = palette[0];
    colorMapping[c] = assigned;
  }
  return colorMapping;
}

// --- Spherical Overlay Creation Helpers ---

/**
 * Samples a boundary segment along its great‐circle arc.
 * @param {Object} seg - Boundary segment with ra1, dec1, ra2, dec2.
 * @param {number} samples - Number of sample points (including endpoints).
 * @returns {THREE.Vector3[]} Array of 3D points along the arc.
 */
function sampleBoundarySegment(seg, samples = 32) {
  const p1 = radToSphere(seg.ra1, seg.dec1, R);
  const p2 = radToSphere(seg.ra2, seg.dec2, R);
  return getGreatCirclePoints(p1, p2, R, samples);
}

/**
 * Projects an array of 3D points (on the sphere) to 2D coordinates on the tangent plane
 * defined at the given centroid.
 * @param {THREE.Vector3[]} points - 3D points on the sphere.
 * @param {THREE.Vector3} centroid - Spherical centroid.
 * @returns {THREE.Vector2[]} Array of 2D points.
 */
function projectPointsToTangent(points, centroid) {
  const normal = centroid.clone().normalize();
  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
  const tangent = up.clone().sub(normal.clone().multiplyScalar(normal.dot(up))).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return points.map(p => new THREE.Vector2(p.dot(tangent), p.dot(bitangent)));
}

/**
 * Sorts 2D points in counter-clockwise order around their centroid.
 * @param {THREE.Vector2[]} points2D - Array of 2D points.
 * @returns {THREE.Vector2[]} Sorted 2D points.
 */
function sortPointsByAngle(points2D) {
  const centroid = new THREE.Vector2(0, 0);
  points2D.forEach(p => centroid.add(p));
  centroid.divideScalar(points2D.length);
  return points2D.sort((a, b) => {
    const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
    const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
    return angleA - angleB;
  });
}

// --- Overlay Creation ---

/**
 * Creates a low-opacity overlay for each constellation. For each constellation, we
 * gather sample points along each boundary’s great‑circle arc so that the polygon
 * naturally follows the curvature. We then project these points onto a tangent plane,
 * sort them by angle, triangulate the polygon, and reproject the vertices onto the sphere.
 *
 * @returns {Array} Array of THREE.Mesh objects (overlays) for the Globe.
 */
function createConstellationOverlayForGlobe() {
  const boundaries = getConstellationBoundaries();
  const groups = {};
  boundaries.forEach(seg => {
    if (seg.const1) {
      if (!groups[seg.const1]) groups[seg.const1] = [];
      groups[seg.const1].push(seg);
    }
    if (seg.const2 && seg.const2 !== seg.const1) {
      if (!groups[seg.const2]) groups[seg.const2] = [];
      groups[seg.const2].push(seg);
    }
  });
  const colorMapping = computeConstellationColorMapping();
  const overlays = [];
  for (const constellation in groups) {
    const segs = groups[constellation];
    let points3D = [];
    // For each segment, sample many points along the arc.
    segs.forEach(seg => {
      const pts = sampleBoundarySegment(seg, 32);
      points3D = points3D.concat(pts);
    });
    if (points3D.length < 3) continue;
    // Remove duplicate (or nearly duplicate) points.
    points3D = points3D.filter((p, i) => {
      return points3D.findIndex((q, j) => i !== j && p.distanceTo(q) < 0.01) === i;
    });
    // Compute the spherical centroid (average, then normalize to R).
    const centroid = new THREE.Vector3(0, 0, 0);
    points3D.forEach(p => centroid.add(p));
    centroid.divideScalar(points3D.length).normalize().multiplyScalar(R);
    // Project points to 2D in the tangent plane at the centroid.
    let points2D = projectPointsToTangent(points3D, centroid);
    points2D = sortPointsByAngle(points2D);
    // Triangulate the 2D polygon.
    const indices2D = THREE.ShapeUtils.triangulateShape(points2D, []);
    // Create geometry from the sorted 3D points.
    // To ensure the overlay follows the curvature, we use the original 3D points ordered as in points2D.
    const sortedPoints3D = [];
    // Build a mapping from 2D to 3D by reprojecting each 2D point back into 3D using the tangent plane.
    // First, compute tangent and bitangent as before.
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(centroid.clone().normalize().dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
    const normal = centroid.clone().normalize();
    const tangent = up.clone().sub(normal.clone().multiplyScalar(normal.dot(up))).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    // For each sorted 2D point, compute the corresponding 3D point on the tangent plane,
    // then project that point onto the sphere.
    points2D.forEach(pt => {
      const p3 = tangent.clone().multiplyScalar(pt.x).add(bitangent.clone().multiplyScalar(pt.y)).add(centroid);
      p3.normalize().multiplyScalar(R);
      sortedPoints3D.push(p3);
    });
    const vertices = [];
    sortedPoints3D.forEach(p => {
      vertices.push(p.x, p.y, p.z);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices2D.flat());
    geometry.computeVertexNormals();
    // Create material; we use a basic material so it always follows the sphere's curvature.
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorMapping[constellation]),
      opacity: 0.15,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    overlays.push(mesh);
  }
  return overlays;
}

function getGreatCirclePoints(p1, p2, R, segments) {
  const points = [];
  const start = p1.clone().normalize().multiplyScalar(R);
  const end = p2.clone().normalize().multiplyScalar(R);
  const axis = new THREE.Vector3().crossVectors(start, end).normalize();
  const angle = start.angleTo(end);
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * angle;
    const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, theta);
    const point = start.clone().applyQuaternion(quaternion);
    points.push(point);
  }
  return points;
}

function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

export { createConstellationOverlayForGlobe, computeConstellationColorMapping };
