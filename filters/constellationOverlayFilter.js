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

// --- Overlay Creation ---

/**
 * Creates a low-opacity overlay for each constellation by stitching together
 * the already-plotted boundary segments. For each constellation, the segments are
 * grouped, ordered by matching endpoints (using a tolerance), then the 3D polygon
 * is projected onto a tangent plane, triangulated, and finally each vertex is
 * re-projected onto the sphere so that the overlay follows the globe’s curvature.
 *
 * A custom shader discards back-facing fragments depending on whether the camera
 * is inside or outside the sphere. (Uniform "isInside" is updated per frame.)
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
    const ordered = [];
    const used = new Array(segs.length).fill(false);
    const convert = (seg, endpoint) =>
      radToSphere(endpoint === 0 ? seg.ra1 : seg.ra2, endpoint === 0 ? seg.dec1 : seg.dec2, R);
    if (segs.length === 0) continue;
    let currentPoint = convert(segs[0], 0);
    ordered.push(currentPoint);
    used[0] = true;
    let currentEnd = convert(segs[0], 1);
    ordered.push(currentEnd);
    let changed = true;
    let iteration = 0;
    while (changed && iteration < segs.length) {
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
      iteration++;
    }
    if (ordered.length < 3) continue;
    if (ordered[0].distanceTo(ordered[ordered.length - 1]) > 0.01) continue;
    if (ordered[0].distanceTo(ordered[ordered.length - 1]) < 0.001) {
      ordered.pop();
    }
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
    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      v.normalize().multiplyScalar(R);
      posAttr.setXYZ(i, v.x, v.y, v.z);
    }
    posAttr.needsUpdate = true;
    // Create custom shader material with uniform "isInside"
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(colorMapping[constellation]) },
        opacity: { value: 0.15 },
        cameraPos: { value: new THREE.Vector3() },
        isInside: { value: false }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        uniform vec3 cameraPos;
        uniform bool isInside;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(cameraPos - vPosition);
          if (isInside) {
            if(dot(vNormal, viewDir) > 0.0) discard;
          } else {
            if(dot(vNormal, viewDir) < 0.0) discard;
          }
          gl_FragColor = vec4(color, opacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    overlays.push(mesh);
  }
  return overlays;
}

function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

export { createConstellationOverlayForGlobe, computeConstellationColorMapping };
