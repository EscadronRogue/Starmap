// /filters/constellationFilter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let boundaryData = [];
let centerData = [];

export let globeConstellationLines = [];
export let globeConstellationLabels = [];

/**
 * Build full constellation polygons from the segments parsed from the txt file.
 * The txt file contains segments (each with two endpoints in RA/DEC in degrees)
 * and two constellation names. Here we group segments by constellation and then order
 * them (using a greedy algorithm) to form a closed polygon.
 */
function buildConstellationPolygons() {
  const polygons = {}; // key: constellation, value: array of segments

  // Group each segment into each constellation it touches.
  boundaryData.forEach(seg => {
    const c1 = seg.const1;
    const c2 = seg.const2;
    if (c1) {
      if (!polygons[c1]) polygons[c1] = [];
      polygons[c1].push(seg);
    }
    if (c2) {
      if (!polygons[c2]) polygons[c2] = [];
      polygons[c2].push(seg);
    }
  });

  const result = [];
  Object.keys(polygons).forEach(constName => {
    const segments = polygons[constName];
    // Greedily order segments to form a polygon.
    const used = new Array(segments.length).fill(false);
    let polygonPoints = [];

    // Start with the first segment.
    const firstSeg = segments[0];
    let currentPoint = { ra: firstSeg.ra1, dec: firstSeg.dec1 };
    polygonPoints.push(currentPoint);
    let endPoint = { ra: firstSeg.ra2, dec: firstSeg.dec2 };
    used[0] = true;

    let found;
    do {
      found = false;
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const seg = segments[i];
        // Check if one endpoint matches the current endpoint (within a small tolerance, say 0.5°)
        if (pointsMatch(endPoint, { ra: seg.ra1, dec: seg.dec1 })) {
          polygonPoints.push({ ra: seg.ra2, dec: seg.dec2 });
          endPoint = { ra: seg.ra2, dec: seg.dec2 };
          used[i] = true;
          found = true;
          break;
        } else if (pointsMatch(endPoint, { ra: seg.ra2, dec: seg.dec2 })) {
          polygonPoints.push({ ra: seg.ra1, dec: seg.dec1 });
          endPoint = { ra: seg.ra1, dec: seg.dec1 };
          used[i] = true;
          found = true;
          break;
        }
      }
    } while (found);

    // If the polygon is closed (first and last points match) then remove duplicate final point.
    if (pointsMatch(polygonPoints[0], polygonPoints[polygonPoints.length - 1])) {
      polygonPoints.pop();
    }
    result.push({ constellation: constName, raDecPolygon: polygonPoints });
  });
  return result;
}

function pointsMatch(p1, p2, tol = 0.5) {
  // tol is in degrees
  return (Math.abs(p1.ra - p2.ra) < tol) && (Math.abs(p1.dec - p2.dec) < tol);
}

/**
 * Loads the constellation boundaries from the legacy text file.
 * The file format is assumed to be lines such as:
 * 001:002 M+ 22:52:00 +34:30:00 22:52:00 +52:30:00 AND LAC
 */
export async function loadConstellationBoundaries() {
  try {
    const resp = await fetch('constellation_boundaries.txt');
    if (!resp.ok) throw new Error(`Failed to load constellation_boundaries.txt: ${resp.status}`);
    const raw = await resp.text();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    boundaryData = [];
    lines.forEach(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 8) return;
      // parts[0] is an index pair, parts[1] is a flag, parts[2]-[5] are RA/DEC endpoints, parts[6] and [7] are constellation names.
      const raStr1 = parts[2];
      const decStr1 = parts[3];
      const raStr2 = parts[4];
      const decStr2 = parts[5];
      const c1 = parts[6];
      const c2 = parts[7];
      const ra1 = parseRA(raStr1);
      const dec1 = parseDec(decStr1);
      const ra2 = parseRA(raStr2);
      const dec2 = parseDec(decStr2);
      boundaryData.push({ ra1, dec1, ra2, dec2, const1: c1, const2: c2 });
    });
    console.log(`[ConstellationFilter] Boundaries: loaded ${boundaryData.length} segments from txt.`);
  } catch (err) {
    console.error('Error loading constellation boundaries:', err);
    boundaryData = [];
  }
}

/**
 * Loads the constellation centers from constellation_center.txt.
 * (The format is assumed to be similar to the legacy format.)
 */
export async function loadConstellationCenters() {
  try {
    const resp = await fetch('constellation_center.txt');
    if (!resp.ok) throw new Error(`Failed to load constellation_center.txt: ${resp.status}`);
    const raw = await resp.text();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    centerData = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const raStr = parts[1];
      const decStr = parts[2];
      const matchName = line.match(/"([^"]+)"/);
      const name = matchName ? matchName[1] : 'Unknown';
      const raVal = parseRA(raStr);
      const decVal = parseDec(decStr);
      centerData.push({ ra: raVal, dec: decVal, name });
    }
    console.log(`[ConstellationFilter] Centers: loaded ${centerData.length} items.`);
  } catch (err) {
    console.error('Error loading constellation centers:', err);
    centerData = [];
  }
}

/**
 * Creates constellation boundary lines for the Globe.
 * This function builds full polygons from the txt segments.
 */
export function createConstellationBoundariesForGlobe() {
  const lines = [];
  const R = 100;
  const polygons = buildConstellationPolygons();
  polygons.forEach(polyObj => {
    const points = polyObj.raDecPolygon.map(v => {
      const raRad = THREE.Math.degToRad(v.ra);
      const decRad = THREE.Math.degToRad(v.dec);
      const x = -R * Math.cos(decRad) * Math.cos(raRad);
      const y = R * Math.sin(decRad);
      const z = -R * Math.cos(decRad) * Math.sin(raRad);
      return new THREE.Vector3(x, y, z);
    });
    const curve = new THREE.CatmullRomCurve3(points);
    const curvePoints = curve.getPoints(64);
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineDashedMaterial({
      color: 0x888888,
      dashSize: 2,
      gapSize: 1,
      linewidth: 1,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    lines.push(line);
  });
  return lines;
}

/**
 * Creates constellation labels for the Globe using the centers.
 */
export function createConstellationLabelsForGlobe() {
  const labels = [];
  const R = 100;
  centerData.forEach(c => {
    const p = radToSphere(c.ra, c.dec, R);
    const baseFontSize = 300; // very large
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
    const planeGeom = new THREE.PlaneGeometry((canvas.width / 100), (canvas.height / 100));
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

function radToSphere(ra, dec, R) {
  const raRad = THREE.Math.degToRad(ra);
  const decRad = THREE.Math.degToRad(dec);
  const x = -R * Math.cos(decRad) * Math.cos(raRad);
  const y = R * Math.sin(decRad);
  const z = -R * Math.cos(decRad) * Math.sin(raRad);
  return new THREE.Vector3(x, y, z);
}

/**
 * Returns the raw boundary segments.
 */
export function getConstellationBoundaries() {
  return boundaryData;
}

function parseRA(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(x => parseFloat(x));
  const hours = hh + mm / 60 + ss / 3600;
  const deg = hours * 15;
  return deg;
}

function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const stripped = decStr.replace('+', '').replace('-', '');
  const [dd, mm, ss] = stripped.split(':').map(x => parseFloat(x));
  const degVal = (dd + mm / 60 + ss / 3600) * sign;
  return degVal;
}
