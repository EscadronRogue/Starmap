// /filters/constellationOverlayFilter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getConstellationBoundaries } from './constellationFilter.js';

const R = 100; // Globe radius

// --- Spherical Geometry Helpers ---
function radToSphere(ra, dec, R) {
  // Converts RA and Dec (in radians) into a point on the sphere.
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

function computeSphericalCentroid(vertices) {
  const sum = new THREE.Vector3(0, 0, 0);
  vertices.forEach(v => sum.add(v));
  return sum.normalize().multiplyScalar(R);
}

function subdivideGeometry(geometry, iterations) {
  let geo = geometry;
  for (let iter = 0; iter < iterations; iter++) {
    const posAttr = geo.getAttribute('position');
    const oldPositions = [];
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      oldPositions.push(v);
    }
    const oldIndices = geo.getIndex().array;
    const newVertices = [...oldPositions];
    const newIndices = [];
    const midpointCache = {};
    
    function getMidpoint(i1, i2) {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      if (midpointCache[key] !== undefined) return midpointCache[key];
      const v1 = newVertices[i1];
      const v2 = newVertices[i2];
      const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5).normalize().multiplyScalar(R);
      newVertices.push(mid);
      const idx = newVertices.length - 1;
      midpointCache[key] = idx;
      return idx;
    }
    
    for (let i = 0; i < oldIndices.length; i += 3) {
      const i0 = oldIndices[i];
      const i1 = oldIndices[i + 1];
      const i2 = oldIndices[i + 2];
      const m0 = getMidpoint(i0, i1);
      const m1 = getMidpoint(i1, i2);
      const m2 = getMidpoint(i2, i0);
      newIndices.push(i0, m0, m2);
      newIndices.push(m0, i1, m1);
      newIndices.push(m0, m1, m2);
      newIndices.push(m2, m1, i2);
    }
    
    const positions = [];
    newVertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
  }
  return geo;
}

// --- Overlay Creation ---
function computeConstellationColorMapping() {
  const boundaries = getConstellationBoundaries();
  const neighbors = {};
  boundaries.forEach(seg => {
    if (seg.const1) {
      const key1 = seg.const1.toUpperCase();
      const key2 = seg.const2 ? seg.const2.toUpperCase() : null;
      if (!neighbors[key1]) neighbors[key1] = new Set();
      if (key2) neighbors[key1].add(key2);
    }
    if (seg.const2) {
      const key2 = seg.const2.toUpperCase();
      const key1 = seg.const1 ? seg.const1.toUpperCase() : null;
      if (!neighbors[key2]) neighbors[key2] = new Set();
      if (key1) neighbors[key2].add(key1);
    }
  });
  const distinctPalette = [
    "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
    "#ffff33", "#a65628", "#f781bf", "#66c2a5", "#fc8d62",
    "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494",
    "#b3b3b3", "#1b9e77", "#d95f02", "#7570b3", "#e7298a"
  ];
  const colorMapping = {};
  const allConsts = new Set();
  for (const key in neighbors) { allConsts.add(key); }
  for (const seg of boundaries) {
    if (seg.const1) allConsts.add(seg.const1.toUpperCase());
    if (seg.const2) allConsts.add(seg.const2.toUpperCase());
  }
  const constellations = Array.from(allConsts);
  constellations.sort((a, b) => (neighbors[b] ? neighbors[b].size : 0) - (neighbors[a] ? neighbors[a].size : 0));
  const palette = distinctPalette;
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

export function createConstellationOverlayForGlobe() {
  const boundaries = getConstellationBoundaries();
  const groups = {};
  boundaries.forEach(seg => {
    if (seg.const1) {
      const key = seg.const1.toUpperCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(seg);
    }
    if (seg.const2 && seg.const2.toUpperCase() !== (seg.const1 ? seg.const1.toUpperCase() : '')) {
      const key = seg.const2.toUpperCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(seg);
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
    // Close polygon if not already closed.
    if (ordered.length > 0 && ordered[0].distanceTo(ordered[ordered.length - 1]) > 0.01) {
      ordered.push(ordered[0].clone());
    }
    // Create geometry (we don’t need triangulation for point-in-polygon tests).
    const vertices = [];
    ordered.forEach(p => vertices.push(p.x, p.y, p.z));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorMapping[constellation]),
      opacity: 0.15,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    // Store the ordered polygon in userData for use in cell lookup.
    mesh.userData.polygon = ordered; 
    mesh.userData.constellation = constellation;
    overlays.push(mesh);
  }
  return overlays;
}
