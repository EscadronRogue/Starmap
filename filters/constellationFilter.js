// filters/constellationFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * This file manages constellation boundaries & labels for the Globe map.
 * We store the parsed data from your .txt files and build lines/labels.
 */

// Internal data arrays
let boundaryData = [];
let centerData = [];

// We'll store references to the lines/labels in the globe scene
export let globeConstellationLines = [];
export let globeConstellationLabels = [];

/**
 * Load & parse "constellation_boundaries.txt"
 */
export async function loadConstellationBoundaries() {
  try {
    const resp = await fetch('constellation_boundaries.txt');
    if (!resp.ok) throw new Error(`Failed to load constellation_boundaries.txt: ${resp.status}`);
    const raw = await resp.text();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    boundaryData = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 8) continue;
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
    }
    console.log(`[ConstellationFilter] Boundaries: loaded ${boundaryData.length} lines.`);
  } catch (err) {
    console.error('Error loading constellation boundaries:', err);
    boundaryData = [];
  }
}

/**
 * Load & parse "constellation_center.txt"
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

/**
 * Build great-circle lines (THREE.Line) for each boundary segment, radius=100 on the globe.
 */
export function createConstellationBoundariesForGlobe() {
  const lines = [];
  const R = 100;
  boundaryData.forEach(b => {
    const p1 = radToSphere(b.ra1, b.dec1, R);
    const p2 = radToSphere(b.ra2, b.dec2, R);
    const curve = new THREE.CatmullRomCurve3(getGreatCirclePoints(p1, p2, R, 32));
    const points = curve.getPoints(32);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
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
  return lines;
}

/**
 * Build constellation label meshes for the Globe.
 * The labels are flat and follow the globe curvature.
 * Their text is scaled very large and oriented so that their local up equals the projection
 * of global up (0,1,0) onto the tangent plane at that point.
 */
export function createConstellationLabelsForGlobe() {
  const labels = [];
  const R = 100;
  centerData.forEach(c => {
    const p = radToSphere(c.ra, c.dec, R);
    const baseFontSize = 200; // Much larger for constellation labels
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${baseFontSize}px Arial`;
    const textWidth = ctx.measureText(c.name).width;
    canvas.width = textWidth + 20;
    canvas.height = baseFontSize * 1.2;
    ctx.font = `${baseFontSize}px Arial`;
    ctx.fillStyle = '#888888';
    ctx.fillText(c.name, 10, baseFontSize);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const planeGeom = new THREE.PlaneGeometry((canvas.width / 100), (canvas.height / 100));
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: true, depthTest: true });
    const label = new THREE.Mesh(planeGeom, mat);
    label.position.copy(p);
    // NEW ORIENTATION LOGIC: Compute label rotation explicitly.
    const normal = p.clone().normalize();
    const globalUp = new THREE.Vector3(0, 1, 0);
    let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
    if (desiredUp.lengthSq() < 1e-6) {
      desiredUp = new THREE.Vector3(0, 0, 1);
    } else {
      desiredUp.normalize();
    }
    const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(desiredRight, desiredUp, normal);
    label.setRotationFromMatrix(matrix);
    label.renderOrder = 1;
    labels.push(label);
  });
  return labels;
}

// Helpers
function parseRA(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(x => parseFloat(x));
  const hours = hh + mm / 60 + ss / 3600;
  const deg = hours * 15;
  return degToRad(deg);
}

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

function radToSphere(ra, dec, R) {
  const phi = (Math.PI / 2) - dec;
  const theta = ra;
  const x = R * Math.sin(phi) * Math.cos(theta);
  const y = R * Math.cos(phi);
  const z = R * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

/**
 * Generates points along the great‐circle path between two points on the sphere.
 */
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

/**
 * (Legacy) Creates a text sprite.
 */
function makeTextSprite(txt, opts) {
  const fontSize = opts.fontSize || 100;
  const color = opts.color || '#888888';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px sans-serif`;
  const w = ctx.measureText(txt).width;
  canvas.width = w;
  canvas.height = fontSize * 1.2;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(txt, 0, fontSize);
  const tex = new THREE.Texture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const scaleFactor = 0.02;
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
  return sprite;
}
