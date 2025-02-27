// filters/constellationOverlayFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getConstellationBoundaries } from './constellationFilter.js';
import { getBaseColor } from './densityColorUtils.js';

const R = 100; // Globe radius

/**
 * Creates a low-opacity overlay for each constellation by using the
 * already plotted boundary segments. For each constellation, we group
 * its segments, order them by matching endpoints, and then fill the
 * resulting polygon.
 *
 * @returns {Array} Array of THREE.Mesh objects (overlays) for the Globe.
 */
function createConstellationOverlayForGlobe() {
  const boundaries = getConstellationBoundaries(); // array of segments {ra1, dec1, ra2, dec2, const1, const2}
  const groups = {};

  // Group segments by constellation name.
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

  const overlays = [];
  for (const constellation in groups) {
    const segs = groups[constellation];
    // Build an ordered list of vertices by "walking" along connected segments.
    const ordered = [];
    const used = new Array(segs.length).fill(false);
    // Helper to convert a segment’s endpoint (0 or 1) to a 3D point.
    const convert = (seg, endpoint) => {
      return radToSphere(endpoint === 0 ? seg.ra1 : seg.ra2, endpoint === 0 ? seg.dec1 : seg.dec2, R);
    };
    if (segs.length === 0) continue;
    // Start with the first segment.
    let currentPoint = convert(segs[0], 0);
    ordered.push(currentPoint);
    used[0] = true;
    let currentEnd = convert(segs[0], 1);
    ordered.push(currentEnd);

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        const seg = segs[i];
        const p0 = convert(seg, 0);
        const p1 = convert(seg, 1);
        if (p0.distanceTo(currentEnd) < 0.001) {
          ordered.push(p1);
          currentEnd = p1;
          used[i] = true;
          changed = true;
        } else if (p1.distanceTo(currentEnd) < 0.001) {
          ordered.push(p0);
          currentEnd = p0;
          used[i] = true;
          changed = true;
        }
      }
    }
    // Ensure the polygon is closed.
    if (ordered.length < 3 || ordered[0].distanceTo(ordered[ordered.length - 1]) > 0.01) {
      // Cannot form a proper closed polygon; skip.
      continue;
    }
    // Remove duplicate last point if present.
    if (ordered[0].distanceTo(ordered[ordered.length - 1]) < 0.001) {
      ordered.pop();
    }

    // Project the 3D polygon onto a tangent plane for triangulation.
    const centroid = new THREE.Vector3(0, 0, 0);
    ordered.forEach(p => centroid.add(p));
    centroid.divideScalar(ordered.length);
    const normal = centroid.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(up)) > 0.9) {
      up = new THREE.Vector3(1, 0, 0);
    }
    const tangent = up.clone().sub(normal.clone().multiplyScalar(normal.dot(up))).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const pts2D = ordered.map(p => new THREE.Vector2(p.dot(tangent), p.dot(bitangent)));
    const indices = THREE.ShapeUtils.triangulateShape(pts2D, []);

    // Build geometry using the ordered 3D vertices.
    const vertices = [];
    ordered.forEach(p => {
      vertices.push(p.x, p.y, p.z);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    // Flatten indices.
    const flatIndices = [];
    indices.forEach(tri => flatIndices.push(...tri));
    geometry.setIndex(flatIndices);
    geometry.computeVertexNormals();

    // Create a mesh with low opacity.
    const material = new THREE.MeshBasicMaterial({
      color: getBaseColor(constellation),
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

// Helper: convert (ra, dec) to 3D point on sphere.
function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

export { createConstellationOverlayForGlobe };
