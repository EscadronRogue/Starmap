// constellationFilter.js
// This module now loads constellation boundaries via the parser defined in constellationBoundariesParser.js
// and creates lines and labels for the Globe map.

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { loadConstellationPolygons } from './constellationBoundariesParser.js';

let constellationPolygons = {}; // Object mapping constellation name to array of polygons (each polygon is an array of {ra, dec})
let boundaryData = []; // (Optional) if you need raw segments
let centerData = [];

export let globeConstellationLines = [];
export let globeConstellationLabels = [];

// Load boundaries by fetching and parsing the raw file.
export async function loadConstellationBoundaries() {
  try {
    constellationPolygons = await loadConstellationPolygons('constellation_boundaries.txt');
    console.log(`[ConstellationFilter] Loaded constellation polygons for ${Object.keys(constellationPolygons).length} constellations.`);
  } catch (err) {
    console.error('Error loading constellation boundaries:', err);
    constellationPolygons = {};
  }
}

// Load constellation centers from a file.
export async function loadConstellationCenters() {
  try {
    const resp = await fetch('constellation_center.txt');
    if (!resp.ok) throw new Error(`Failed to load constellation_center.txt: ${resp.status}`);
    const raw = await resp.text();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    centerData = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;
      const raStr = parts[2];
      const decStr = parts[3];
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

// Helper: Convert RA string (hh:mm:ss) to radians.
function parseRA(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(x => parseFloat(x));
  const hours = hh + mm / 60 + ss / 3600;
  const deg = hours * 15;
  return degToRad(deg);
}

// Helper: Convert Dec string (±dd:mm:ss) to radians.
function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const stripped = decStr.replace('+', '').replace('-', '');
  const [dd, mm, ss] = stripped.split(':').map(x => parseFloat(x));
  const degVal = (dd + mm / 60 + ss / 3600) * sign;
  return degToRad(degVal);
}

function degToRad(d) {
  return d * Math.PI / 180;
}

// Convert RA/Dec (in radians) into a 3D position on a sphere of radius R.
function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

// Helper to compute points along a great‑circle path.
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

// Create constellation boundary lines for the Globe map using the stitched polygons.
export function createConstellationBoundariesForGlobe() {
  const lines = [];
  const R = 100;
  // Loop through each constellation in our polygons.
  for (const constName in constellationPolygons) {
    const polygons = constellationPolygons[constName];
    polygons.forEach(polygon => {
      // For each vertex in the polygon, convert RA and Dec (in degrees) to 3D coordinates.
      const points = polygon.map(pt => {
        const raRad = THREE.Math.degToRad(pt.ra);
        const decRad = THREE.Math.degToRad(pt.dec);
        return radToSphere(raRad, decRad, R);
      });
      // Create a smooth curve (Catmull-Rom) through these points.
      const curve = new THREE.CatmullRomCurve3(points);
      const curvePoints = curve.getPoints(32);
      const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const material = new THREE.LineDashedMaterial({
        color: 0x888888,
        dashSize: 2,
        gapSize: 1,
        linewidth: 1
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      lines.push(line);
    });
  }
  return lines;
}

// Create constellation label meshes for the Globe map.
export function createConstellationLabelsForGlobe() {
  const labels = [];
  const R = 100;
  centerData.forEach(c => {
    const raRad = THREE.Math.degToRad(c.ra);
    const decRad = THREE.Math.degToRad(c.dec);
    const p = radToSphere(raRad, decRad, R);
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
    const planeGeom = new THREE.PlaneGeometry((canvas.width / 100), (canvas.height / 100));
    const label = new THREE.Mesh(planeGeom, material);
    label.position.copy(p);
    const normal = p.clone().normalize();
    const globalUp = new THREE.Vector3(0, 1, 0);
    let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
    if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
    else desiredUp.normalize();
    const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
    const matrix = new THREE.Matrix4().makeBasis(desiredRight, desiredUp, normal);
    label.setRotationFromMatrix(matrix);
    label.renderOrder = 1;
    labels.push(label);
  });
  return labels;
}

export function getConstellationBoundaries() {
  return boundaryData;
}
