// filters/constellationOverlayFilter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { cachedRadToSphere, getGreatCirclePoints, subdivideGeometry } from '../utils/geometryUtils.js';
import { getConstellationBoundaries } from './constellationFilter.js';

const R = 100;
const distinctPalette = [
  "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
  "#ffff33", "#a65628", "#f781bf", "#66c2a5", "#fc8d62",
  "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494",
  "#b3b3b3", "#1b9e77", "#d95f02", "#7570b3", "#e7298a"
];

export function computeConstellationColorMapping() {
  const boundaries = getConstellationBoundaries();
  const constellationsSet = new Set();
  boundaries.forEach(seg => {
    if (seg.const1) constellationsSet.add(seg.const1.toUpperCase());
    if (seg.const2) constellationsSet.add(seg.const2.toUpperCase());
  });
  const constellations = Array.from(constellationsSet).sort();
  const colorMapping = {};
  const palette = distinctPalette;
  for (let i = 0; i < constellations.length; i++) {
    colorMapping[constellations[i]] = palette[i % palette.length];
  }
  return colorMapping;
}

function computeSphericalCentroid(vertices) {
  const sum = new THREE.Vector3(0, 0, 0);
  vertices.forEach(v => sum.add(v));
  return sum.normalize().multiplyScalar(R);
}

function isPointInSphericalPolygon(point, vertices) {
  let angleSum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i].clone().normalize();
    const v2 = vertices[(i + 1) % vertices.length].clone().normalize();
    const d1 = v1.clone().sub(point).normalize();
    const d2 = v2.clone().sub(point).normalize();
    let angle = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    angleSum += angle;
  }
  return Math.abs(angleSum - 2 * Math.PI) < 0.1;
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
      cachedRadToSphere(endpoint === 0 ? seg.ra1 : seg.ra2, endpoint === 0 ? seg.dec1 : seg.dec2, R);
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
    let geometry;
    const centroid = computeSphericalCentroid(ordered);
    if (isPointInSphericalPolygon(centroid, ordered)) {
      const vertices = [];
      ordered.forEach(p => vertices.push(p.x, p.y, p.z));
      vertices.push(centroid.x, centroid.y, centroid.z);
      const vertexArray = new Float32Array(vertices);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(vertexArray, 3));
      const indices = [];
      const n = ordered.length;
      const centroidIndex = n;
      for (let i = 0; i < n; i++) {
        indices.push(i, (i + 1) % n, centroidIndex);
      }
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
    } else {
      const tangent = new THREE.Vector3();
      const bitangent = new THREE.Vector3();
      const tempCentroid = new THREE.Vector3(0, 0, 0);
      ordered.forEach(p => tempCentroid.add(p));
      tempCentroid.divideScalar(ordered.length);
      const normal = tempCentroid.clone().normalize();
      let up = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
      tangent.copy(up).sub(normal.clone().multiplyScalar(normal.dot(up))).normalize();
      bitangent.crossVectors(normal, tangent).normalize();
      const pts2D = ordered.map(p => new THREE.Vector2(p.dot(tangent), p.dot(bitangent)));
      const indices2D = THREE.ShapeUtils.triangulateShape(pts2D, []);
      const vertices = [];
      ordered.forEach(p => vertices.push(p.x, p.y, p.z));
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices2D.flat());
      geometry.computeVertexNormals();
      const posAttr = geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
        v.normalize().multiplyScalar(R);
        posAttr.setXYZ(i, v.x, v.y, v.z);
      }
      posAttr.needsUpdate = true;
    }
    geometry = subdivideGeometry(geometry, 2);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorMapping[constellation]),
      opacity: 0.15,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    mesh.userData.constellation = constellation;
    overlays.push(mesh);
  }
  return overlays;
}
