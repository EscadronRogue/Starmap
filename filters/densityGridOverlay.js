// /filters/densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  getDoubleSidedLabelMaterial, 
  getBaseColor, 
  lightenColor, 
  darkenColor, 
  getBlueColor,
} from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, segmentOceanCandidate } from './densitySegmentation.js';
// Import loaders and getters for constellation centers and boundaries:
import { loadConstellationCenters, getConstellationCenters, loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

/**
 * Helper function to convert a string to Title Case.
 */
function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * NEW: Load constellation full names from an external JSON file.
 */
let constellationFullNames = null;
async function loadConstellationFullNames() {
  if (constellationFullNames) return constellationFullNames;
  try {
    const resp = await fetch('constellation_full_names.json');
    if (!resp.ok) throw new Error(`Failed to load constellation_full_names.json: ${resp.status}`);
    constellationFullNames = await resp.json();
    console.log("Constellation full names loaded successfully.");
  } catch (err) {
    console.error("Error loading constellation full names:", err);
    constellationFullNames = {};
  }
  return constellationFullNames;
}

// --- Spherical Triangulation Helpers ---

function computeSphericalCentroid(vertices) {
  const sum = new THREE.Vector3(0, 0, 0);
  vertices.forEach(v => sum.add(v));
  return sum.normalize().multiplyScalar(100);
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
      const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5).normalize().multiplyScalar(100);
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

// --- Helper to convert a sphere point (THREE.Vector3) to RA/DEC in degrees ---
function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

// --- Overlay Creation ---

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
  const namesMappingPromise = loadConstellationFullNames();
  const overlays = [];
  for (const constellation in groups) {
    const segs = groups[constellation];
    const ordered = [];
    const used = new Array(segs.length).fill(false);
    const convert = (seg, endpoint) =>
      radToSphere(endpoint === 0 ? seg.ra1 : seg.ra2, endpoint === 0 ? seg.dec1 : seg.dec2, 100);
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
        v.normalize().multiplyScalar(100);
        posAttr.setXYZ(i, v.x, v.y, v.z);
      }
      posAttr.needsUpdate = true;
    }
    geometry = subdivideGeometry(geometry, 2);
    // Instead of a hard-coded color, we will use the external mapping.
    // Wait for the constellation full names mapping to be available.
    namesMappingPromise.then(namesMapping => {
      const fullName = namesMapping[constellation] || toTitleCase(constellation);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(fullName),
        opacity: 0.15,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      mesh.userData.polygon = ordered;
      mesh.userData.constellation = constellation;
      const orderedRADEC = ordered.map(p => vectorToRaDec(p));
      mesh.userData.raDecPolygon = orderedRADEC;
      overlays.push(mesh);
    });
  }
  return overlays;
}

export async function assignConstellationsToCells() {
  await loadConstellationCenters();
  await loadConstellationBoundaries();
  const centers = getConstellationCenters();
  const boundaries = getConstellationBoundaries();
  if (boundaries.length === 0) {
    console.warn("No constellation boundaries available!");
    return;
  }
  function radToSphere(ra, dec, R) {
    const x = -R * Math.cos(dec) * Math.cos(ra);
    const y = R * Math.sin(dec);
    const z = -R * Math.cos(dec) * Math.sin(ra);
    return new THREE.Vector3(x, y, z);
  }
  function minAngularDistanceToSegment(cellPos, p1, p2) {
    const angleToP1 = cellPos.angleTo(p1);
    const angleToP2 = cellPos.angleTo(p2);
    const arcAngle = p1.angleTo(p2);
    const perpAngle = Math.asin(Math.abs(cellPos.clone().normalize().dot(p1.clone().cross(p2).normalize())));
    if (angleToP1 + angleToP2 - arcAngle < 1e-3) {
      return THREE.Math.radToDeg(perpAngle);
    } else {
      return THREE.Math.radToDeg(Math.min(angleToP1, angleToP2));
    }
  }
  function vectorToRaDec(vector) {
    const R = 100;
    const dec = Math.asin(vector.y / R);
    let ra = Math.atan2(-vector.z, -vector.x);
    let raDeg = ra * 180 / Math.PI;
    if (raDeg < 0) raDeg += 360;
    return { ra: raDeg, dec: dec * 180 / Math.PI };
  }
  
  // Load the constellation full names mapping from the JSON file.
  const namesMapping = await loadConstellationFullNames();
  
  this.cubesData.forEach(cell => {
    if (!cell.active) return;
    const cellPos = cell.globeMesh.position.clone();
    let nearestBoundary = null;
    let minBoundaryDist = Infinity;
    boundaries.forEach(boundary => {
       const p1 = radToSphere(boundary.ra1, boundary.dec1, 100);
       const p2 = radToSphere(boundary.ra2, boundary.dec2, 100);
       const angDist = minAngularDistanceToSegment(cellPos, p1, p2);
       if (angDist < minBoundaryDist) {
         minBoundaryDist = angDist;
         nearestBoundary = boundary;
       }
    });
    if (!nearestBoundary) {
       cell.constellation = "Unknown";
       return;
    }
    const abbr1 = nearestBoundary.const1.toUpperCase();
    const abbr2 = nearestBoundary.const2 ? nearestBoundary.const2.toUpperCase() : null;
    const fullName1 = namesMapping[abbr1] || toTitleCase(abbr1);
    const fullName2 = abbr2 ? (namesMapping[abbr2] || toTitleCase(abbr2)) : null;
    
    const bp1 = radToSphere(nearestBoundary.ra1, nearestBoundary.dec1, 100);
    const bp2 = radToSphere(nearestBoundary.ra2, nearestBoundary.dec2, 100);
    let normal = bp1.clone().cross(bp2).normalize();
    const center1 = centers.find(c => {
      const nameUp = c.name.toUpperCase();
      return nameUp === abbr1 || nameUp === fullName1.toUpperCase();
    });
    let center1Pos = center1 ? radToSphere(center1.ra, center1.dec, 100) : null;
    if (center1Pos && normal.dot(center1Pos) < 0) {
       normal.negate();
    }
    const cellSide = normal.dot(cellPos);
    if (cellSide >= 0) {
       cell.constellation = toTitleCase(fullName1);
    } else if (fullName2) {
       cell.constellation = toTitleCase(fullName2);
    } else {
       const { ra: cellRA, dec: cellDec } = vectorToRaDec(cellPos);
       let bestConstellation = "Unknown";
       let minAngle = Infinity;
       centers.forEach(center => {
          const centerRAdeg = THREE.Math.radToDeg(center.ra);
          const centerDecdeg = THREE.Math.radToDeg(center.dec);
          const angDist = angularDistance(cellRA, cellDec, centerRAdeg, centerDecdeg);
          if (angDist < minAngle) {
            minAngle = angDist;
            bestConstellation = toTitleCase(center.name);
          }
       });
       cell.constellation = bestConstellation;
    }
    console.log(`Cell ID ${cell.id} assigned to constellation ${cell.constellation} via boundary attribution.`);
    
    function angularDistance(ra1, dec1, ra2, dec2) {
      const ra1Rad = THREE.Math.degToRad(ra1);
      const dec1Rad = THREE.Math.degToRad(dec1);
      const ra2Rad = THREE.Math.degToRad(ra2);
      const dec2Rad = THREE.Math.degToRad(dec2);
      const cosDelta = Math.sin(dec1Rad) * Math.sin(dec2Rad) +
                       Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.cos(ra1Rad - ra2Rad);
      const delta = Math.acos(THREE.MathUtils.clamp(cosDelta, -1, 1));
      return THREE.Math.radToDeg(delta);
    }
  });
  // End of assignConstellationsToCells
}

/**
 * Creates constellation label meshes for the Globe.
 */
export function createConstellationLabelsForGlobe() {
  const labels = [];
  const R = 100;
  const centers = getConstellationCenters();
  centers.forEach(c => {
    const p = radToSphere(c.ra, c.dec, R);
    const baseFontSize = 300;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${baseFontSize}px Arial`;
    const textWidth = ctx.measureText(c.name).width;
    canvas.width = textWidth + 20;
    canvas.height = baseFontSize * 1.2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${baseFontSize}px Arial`;
    ctx.fillStyle = '#888888';
    ctx.fillText(c.name, 10, baseFontSize);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        opacity: { value: 0.5 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec2 uvCorrected = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
          vec4 color = texture2D(map, uvCorrected);
          gl_FragColor = vec4(color.rgb, color.a * opacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });
    const planeGeom = new THREE.PlaneGeometry(canvas.width / 100, canvas.height / 100);
    const label = new THREE.Mesh(planeGeom, material);
    label.position.copy(p);
    const normal = p.clone().normalize();
    const globalUp = new THREE.Vector3(0, 1, 0);
    let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
    if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
    else desiredUp.normalize();
    const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(desiredRight, desiredUp, normal);
    label.setRotationFromMatrix(matrix);
    label.renderOrder = 1;
    labels.push(label);
  });
  return labels;
}

// (Other helper functions remain unchanged)
