// filters/constellationOverlayFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getConstellationBoundaries } from './constellationFilter.js';

const R = 100; // Globe radius

// --- Graph Coloring Helpers ---

/**
 * Compute a neighbor map for constellations from the boundary segments.
 * Two constellations are neighbors if they share a boundary segment.
 */
function computeNeighborMap() {
  const boundaries = getConstellationBoundaries(); // Each segment: {ra1,dec1,ra2,dec2,const1,const2}
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
  // Convert sets to arrays.
  Object.keys(neighbors).forEach(key => {
    neighbors[key] = Array.from(neighbors[key]);
  });
  return neighbors;
}

/**
 * Using a greedy algorithm, assign each constellation a color from a small palette
 * so that no two neighboring constellations share the same color.
 * We sort in descending order of neighbor count.
 */
function computeConstellationColorMapping() {
  const neighbors = computeNeighborMap();
  // Get all constellation names (if a constellation never appears as a neighbor, add it)
  const constellations = new Set();
  Object.keys(neighbors).forEach(c => constellations.add(c));
  const boundaries = getConstellationBoundaries();
  boundaries.forEach(seg => {
    if (seg.const1) constellations.add(seg.const1);
    if (seg.const2) constellations.add(seg.const2);
  });
  const constellationList = Array.from(constellations);
  // Sort in descending order by degree
  constellationList.sort((a, b) => (neighbors[b]?.length || 0) - (neighbors[a]?.length || 0));
  // Use a palette of 4 colors (expandable if needed)
  const palette = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3'];
  const colorMapping = {};
  for (const c of constellationList) {
    const used = new Set();
    (neighbors[c] || []).forEach(nb => {
      if (colorMapping[nb]) used.add(colorMapping[nb]);
    });
    // Choose the first palette color not already used by neighbors
    let assigned = null;
    for (let i = 0; i < palette.length; i++) {
      if (!used.has(palette[i])) {
        assigned = palette[i];
        break;
      }
    }
    // If none available, simply assign the first color (or you can generate a new one)
    colorMapping[c] = assigned || palette[0];
  }
  return colorMapping;
}

// --- Overlay Creation ---

/**
 * Creates a low-opacity overlay for each constellation by stitching together
 * the already-plotted boundary segments. For each constellation the segments are
 * grouped, connected by matching endpoints (using a small tolerance), then the 3D
 * polygon is projected onto a tangent plane and triangulated.
 *
 * After triangulation, each vertex is re-projected onto the sphere so that the
 * overlay perfectly follows the curvature of the globe.
 *
 * The overlay uses a color assigned by a graph–coloring algorithm so that adjacent
 * constellations have different colors.
 *
 * @returns {Array} Array of THREE.Mesh objects (overlays) for the Globe.
 */
function createConstellationOverlayForGlobe() {
  const boundaries = getConstellationBoundaries();
  // Group segments by constellation.
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
    // Build an ordered list of vertices by "walking" through connected segments.
    const ordered = [];
    const used = new Array(segs.length).fill(false);
    const convert = (seg, endpoint) =>
      radToSphere(endpoint === 0 ? seg.ra1 : seg.ra2, endpoint === 0 ? seg.dec1 : seg.dec2, R);
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
    if (ordered.length < 3) continue;
    // Ensure the polygon is closed.
    if (ordered[0].distanceTo(ordered[ordered.length - 1]) > 0.01) continue;
    if (ordered[0].distanceTo(ordered[ordered.length - 1]) < 0.001) {
      ordered.pop();
    }
    // Project the 3D polygon to a tangent plane.
    const centroid = new THREE.Vector3(0, 0, 0);
    ordered.forEach(p => centroid.add(p));
    centroid.divideScalar(ordered.length);
    const normal = centroid.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
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
    const flatIndices = [];
    indices.forEach(tri => flatIndices.push(...tri));
    geometry.setIndex(flatIndices);
    geometry.computeVertexNormals();
    // Project every vertex onto the sphere so the polygon follows the curvature.
    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      v.normalize().multiplyScalar(R);
      posAttr.setXYZ(i, v.x, v.y, v.z);
    }
    posAttr.needsUpdate = true;
    // Create material with polygonOffset so the overlay appears on top of the opaque surface.
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorMapping[constellation]),
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
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

// Export the main functions and the color mapping for reuse.
export { createConstellationOverlayForGlobe, computeConstellationColorMapping };
