// File: /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor, getBlueColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

// This module assumes that constellation boundary data is provided externally and stored in
// a global variable called "constellationPolygons" and that a function "isPointInPolygon(point, polygon)"
// is available in the global scope.

// Converts RA/Dec strings to degrees.
function raToDeg(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(Number);
  return (hh + mm / 60 + ss / 3600) * 15;
}
function decToDeg(decStr) {
  const sign = decStr[0] === '-' ? -1 : 1;
  const [dd, mm, ss] = decStr.replace('+', '').split(':').map(Number);
  return sign * (dd + mm / 60 + ss / 3600);
}

// The following functions rely on external boundary data rather than embedding any raw data.

// Returns the constellation for a given cell using constellation boundaries.
export function getConstellationForCell(cell) {
  // Use globe-projected position since the boundaries are defined for the globe.
  const pos = cell.spherePosition ? cell.spherePosition : cell.tcPos;
  const r = pos.length();
  if (r < 1e-6) return "Unknown";
  let ra = Math.atan2(-pos.z, -pos.x);
  if (ra < 0) ra += 2 * Math.PI;
  ra = THREE.Math.radToDeg(ra);
  const dec = Math.asin(pos.y / r);
  const decDeg = THREE.Math.radToDeg(dec);
  
  if (typeof constellationPolygons === "undefined" || typeof isPointInPolygon !== "function") {
    return "Unknown";
  }
  for (const constName in constellationPolygons) {
    const polygons = constellationPolygons[constName];
    for (const polygon of polygons) {
      if (isPointInPolygon({ ra, dec: decDeg }, polygon)) {
        return constName;
      }
    }
  }
  return "Unknown";
}

// Segments a cluster if a neck candidate is found.
export function segmentOceanCandidate(cells) {
  for (const candidate of cells) {
    let neighborCount = 0;
    for (const other of cells) {
      if (candidate === other) continue;
      if (
        Math.abs(candidate.grid.ix - other.grid.ix) <= 1 &&
        Math.abs(candidate.grid.iy - other.grid.iy) <= 1 &&
        Math.abs(candidate.grid.iz - other.grid.iz) <= 1
      ) {
        neighborCount++;
      }
    }
    if (neighborCount >= 2 && neighborCount <= 5) {
      const remaining = cells.filter(cell => cell !== candidate);
      const components = computeConnectedComponents(remaining);
      if (components.length === 2) {
        const size1 = components[0].length;
        const size2 = components[1].length;
        const smaller = Math.min(size1, size2);
        const larger = Math.max(size1, size2);
        if (smaller >= 0.10 * larger) {
          return { segmented: true, cores: components, neck: [candidate] };
        }
      }
    }
  }
  return { segmented: false, cores: [cells] };
}

export function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

function computeConnectedComponents(cells) {
  const components = [];
  const visited = new Set();
  for (const cell of cells) {
    if (visited.has(cell.id)) continue;
    const comp = [];
    const stack = [cell];
    while (stack.length > 0) {
      const current = stack.pop();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      comp.push(current);
      cells.forEach(other => {
        if (!visited.has(other.id) &&
            Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
            Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
            Math.abs(current.grid.iz - other.grid.iz) <= 1) {
          stack.push(other);
        }
      });
    }
    components.push(comp);
  }
  return components;
}

export function computeInterconnectedCell(cells) {
  let bestCell = cells[0];
  let maxCount = 0;
  cells.forEach(cell => {
    let count = 0;
    cells.forEach(other => {
      if (cell === other) return;
      if (
        Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
        Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
        Math.abs(cell.grid.iz - other.grid.iz) <= 1
      ) {
        count++;
      }
    });
    if (count > maxCount) {
      maxCount = count;
      bestCell = cell;
    }
  });
  return bestCell;
}

export function getMajorityConstellation(cells) {
  const volumeByConstellation = {};
  cells.forEach(cell => {
    const cons = getConstellationForCell(cell);
    volumeByConstellation[cons] = (volumeByConstellation[cons] || 0) + 1;
  });
  let majority = "Unknown";
  let maxVolume = 0;
  for (const cons in volumeByConstellation) {
    if (volumeByConstellation[cons] > maxVolume) {
      maxVolume = volumeByConstellation[cons];
      majority = cons;
    }
  }
  return majority;
}

export function angularDistance(ra1, dec1, ra2, dec2) {
  const r1 = THREE.Math.degToRad(ra1);
  const d1 = THREE.Math.degToRad(dec1);
  const r2 = THREE.Math.degToRad(ra2);
  const d2 = THREE.Math.degToRad(dec2);
  const cosDist = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  const clamped = Math.min(Math.max(cosDist, -1), 1);
  const dist = Math.acos(clamped);
  return THREE.Math.radToDeg(dist);
}

export function getGreatCirclePoints(p1, p2, R, segments) {
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

export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
