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
 * Samples a boundary segment along its great‑circle arc.
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
 * Computes tangent and bitangent vectors for a tangent plane defined at the given point.
 * @param {THREE.Vector3} centroid - The point defining the tangent plane.
 * @returns {Object} Object with properties tangent and bitangent.
 */
function computeTangentPlane(centroid) {
  const normal = centroid.clone().normalize();
  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
  const tangent = up.clone().sub(normal.clone().multiplyScalar(normal.dot(up))).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return { tangent, bitangent };
}

/**
 * Projects a 3D point onto the tangent plane defined by the given centroid.
 * @param {THREE.Vector3} point - The 3D point on the sphere.
 * @param {THREE.Vector3} centroid - The point defining the tangent plane.
 * @param {THREE.Vector3} tangent 
 * @param {THREE.Vector3} bitangent 
 * @returns {THREE.Vector2} The 2D coordinates in the tangent plane.
 */
function projectPointToPlane(point, centroid, tangent, bitangent) {
  return new THREE.Vector2(point.dot(tangent), point.dot(bitangent));
}

/**
 * Sorts the original 3D points based on the angle of their projection in the tangent plane.
 * @param {THREE.Vector3[]} points3D - Array of 3D points.
 * @param {THREE.Vector3} centroid - Tangent plane center.
 * @param {THREE.Vector3} tangent 
 * @param {THREE.Vector3} bitangent 
 * @returns {{points3D: THREE.Vector3[], points2D: THREE.Vector2[]}} Object containing the sorted 3D points and their 2D projections.
 */
function sortPointsByAngle3D(points3D, centroid, tangent, bitangent) {
  // Compute the projection and angle for each point.
  const arr = points3D.map(p => {
    const proj = projectPointToPlane(p, centroid, tangent, bitangent);
    const angle = Math.atan2(proj.y, proj.x);
    return { point: p, proj, angle };
  });
  arr.sort((a, b) => a.angle - b.angle);
  return {
    points3D: arr.map(item => item.point),
    points2D: arr.map(item => item.proj)
  };
}

// --- Overlay Creation ---

/**
 * Creates a low-opacity overlay for each constellation by sampling each boundary’s
 * great‑circle arc so that the polygon naturally follows the sphere’s curvature.
 * The sampled 3D points are then projected onto a tangent plane at the spherical
 * centroid, sorted, triangulated, and reprojected back onto the sphere.
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
    // Sample many points along each boundary arc.
    segs.forEach(seg => {
      const pts = sampleBoundarySegment(seg, 32);
      points3D = points3D.concat(pts);
    });
    if (points3D.length < 3) continue;
    // Remove duplicates.
    points3D = points3D.filter((p, i) =>
      points3D.findIndex((q, j) => i !== j && p.distanceTo(q) < 0.01) === i
    );
    // Compute the spherical centroid.
    const centroid = new THREE.Vector3(0, 0, 0);
    points3D.forEach(p => centroid.add(p));
    centroid.divideScalar(points3D.length).normalize().multiplyScalar(R);
    // Compute tangent plane basis.
    const { tangent, bitangent } = computeTangentPlane(centroid);
    // Sort the original 3D points based on the angle of their projection.
    const { points3D: sorted3D, points2D: sorted2D } = sortPointsByAngle3D(points3D, centroid, tangent, bitangent);
    // Triangulate the 2D polygon.
    const indices2D = THREE.ShapeUtils.triangulateShape(sorted2D, []);
    if (!indices2D || indices2D.length === 0) continue;
    // Build geometry from sorted 3D points.
    const vertices = [];
    sorted3D.forEach(p => {
      vertices.push(p.x, p.y, p.z);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices2D.flat());
    geometry.computeVertexNormals();
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
