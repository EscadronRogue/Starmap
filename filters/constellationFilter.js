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
      // e.g. "354:608 M+ 15:03:00 -55:00:00 15:03:00 -54:00:00 NOR LUP"
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
      // e.g. "011 P+ 06:00:00 +70:00:00 "Camelopardalis""
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
 * Build great-circle lines (THREE.Line) for each boundary segment, radius=100 on the globe
 */
export function createConstellationBoundariesForGlobe() {
  const lines = [];
  const R = 100; // Globe radius

  boundaryData.forEach(b => {
    const p1 = radToSphere(b.ra1, b.dec1, R);
    const p2 = radToSphere(b.ra2, b.dec2, R);

    // Create a great-circle curve between p1 and p2
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
 * Build label sprites for each constellation center
 */
export function createConstellationLabelsForGlobe() {
  const labels = [];
  const R = 100; // Globe radius

  centerData.forEach(c => {
    const p = radToSphere(c.ra, c.dec, R);
    const spr = makeTextSprite(c.name, { fontSize: 100, color: '#888888' });
    spr.position.copy(p);
    labels.push(spr);
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
  // x = R sin(phi) cos(theta), y = R cos(phi), z = R sin(phi) sin(theta)
  const phi = (Math.PI / 2) - dec;
  const theta = ra;
  const x = R * Math.sin(phi) * Math.cos(theta);
  const y = R * Math.cos(phi);
  const z = R * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

/**
 * Generates points along the great-circle path between two points on the sphere
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
  // UPDATED: Enable depthTest and depthWrite so that constellation labels are occluded by obstacles
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);

  // Smaller scale
  const scaleFactor = 0.02;
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);

  return sprite;
}
