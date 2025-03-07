// /filters/constellationFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { radToSphere } from '../utils/geometryUtils.js';

let boundaryData = [];
let centerData = [];

export let globeConstellationLines = [];
export let globeConstellationLabels = [];

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

export function getConstellationCenters() {
  return centerData;
}

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

export function getConstellationBoundaries() {
  return boundaryData;
}
