// filters/densitySegmentation.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor, getBlueColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

/**
 * Attempts to segment an Ocean (or Sea) candidate cluster via neck candidate detection.
 * A neck candidate is any cell with between 2 and 5 neighbors.
 * The candidate is simulated removed and the cluster is re-partitioned.
 * If the removal yields exactly two connected components and the smaller one is at least 10%
 * as big as the larger one, segmentation is accepted.
 */
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
      // Simulate removal of the candidate cell
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

/**
 * Computes the centroid (average position) of a set of cells.
 */
export function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

/**
 * Computes connected components from a set of cells.
 * Two cells are connected if their grid indices differ by at most 1 in each dimension.
 */
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

/**
 * Finds the cell with the highest connectivity within a group.
 */
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

/**
 * Returns the majority constellation among a set of cells.
 * For each cell, getConstellationForCell is called and the most frequent name is returned.
 */
export function getMajorityConstellation(cells) {
  const counts = {};
  cells.forEach(cell => {
    const cons = getConstellationForCell(cell);
    counts[cons] = (counts[cons] || 0) + 1;
  });
  let majority = "Unknown";
  let maxCount = 0;
  for (const cons in counts) {
    if (counts[cons] > maxCount) {
      majority = cons;
      maxCount = counts[cons];
    }
  }
  return majority;
}

/**
 * Returns the constellation for a given cell.
 * Uses loaded density center data if available; otherwise falls back to hard‐coded centers.
 */
export function getConstellationForCell(cell) {
  loadDensityCenterData();
  const pos = cell.tcPos;
  const r = pos.length();
  if (r < 1e-6) return "Unknown";
  const ra = Math.atan2(-pos.z, -pos.x);
  let normRa = ra;
  if (normRa < 0) normRa += 2 * Math.PI;
  const raDeg = THREE.MathUtils.radToDeg(normRa);
  const dec = Math.asin(pos.y / r);
  const decDeg = THREE.MathUtils.radToDeg(dec);
  if (isNaN(decDeg)) return "Unknown";
  const centers = getDensityCenterData();
  if (centers && centers.length > 0) {
    let best = centers[0];
    let bestDist = angularDistance(raDeg, decDeg, THREE.Math.radToDeg(best.ra), THREE.Math.radToDeg(best.dec));
    for (let i = 1; i < centers.length; i++) {
      const center = centers[i];
      const d = angularDistance(raDeg, decDeg, THREE.Math.radToDeg(center.ra), THREE.Math.radToDeg(center.dec));
      if (d < bestDist) {
        bestDist = d;
        best = center;
      }
    }
    return best.name;
  } else {
    const fallbackCenters = [
      { name: "Orion", ra: 83, dec: -5 },
      { name: "Gemini", ra: 100, dec: 20 },
      { name: "Taurus", ra: 65, dec: 15 },
      { name: "Leo", ra: 152, dec: 12 },
      { name: "Scorpius", ra: 255, dec: -30 },
      { name: "Cygnus", ra: 310, dec: 40 },
      { name: "Pegasus", ra: 330, dec: 20 }
    ];
    let best = fallbackCenters[0];
    let bestDist = angularDistance(raDeg, decDeg, best.ra, best.dec);
    for (let i = 1; i < fallbackCenters.length; i++) {
      const center = fallbackCenters[i];
      const d = angularDistance(raDeg, decDeg, center.ra, center.dec);
      if (d < bestDist) {
        bestDist = d;
        best = center;
      }
    }
    return best.name;
  }
}

/**
 * Computes the angular distance (in degrees) between two points given in RA/DEC.
 */
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

/**
 * Returns an array of points along the great‑circle path between two points.
 */
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

/**
 * Assigns distinct base colors to independent regions.
 * Each region gets its own blue-based color based on its unique id, constellation, and type.
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
