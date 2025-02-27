// filters/densitySegmentation.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor, getBlueColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

/**
 * Attempts to segment an Ocean candidate cluster via bottleneck detection.
 * (Note: This algorithm is a placeholder that splits the cluster in half if a neck is detected.)
 */
export function segmentOceanCandidate(cells) {
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
    cell.connectivity = count;
  });
  const C_avg = cells.reduce((sum, cell) => sum + cell.connectivity, 0) / cells.length;

  cells.forEach(cell => {
    cell.thin = (cell.connectivity / C_avg) < 0.5;
  });

  const thinCells = cells.filter(cell => cell.thin);
  const neckGroups = [];
  const visited = new Set();
  thinCells.forEach(cell => {
    if (visited.has(cell.id)) return;
    const group = [];
    const stack = [cell];
    while (stack.length > 0) {
      const current = stack.pop();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      group.push(current);
      cells.forEach(other => {
        if (
          !visited.has(other.id) &&
          other.thin &&
          Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
          Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
          Math.abs(current.grid.iz - other.grid.iz) <= 1
        ) {
          stack.push(other);
        }
      });
    }
    neckGroups.push(group);
  });

  const oceanVol = cells.length;
  for (const group of neckGroups) {
    if (group.length < 0.15 * oceanVol) {
      const neckAvgConn = group.reduce((s, cell) => s + cell.connectivity, 0) / group.length;
      if (neckAvgConn < 0.5 * C_avg) {
        // If segmentation is detected, split cells into two clusters (a simple split)
        const half = Math.floor(cells.length / 2);
        const core1 = cells.slice(0, half);
        const core2 = cells.slice(half);
        return { segmented: true, cores: [core1, core2], neck: group };
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
 * (Unused here) Computes a count of cells per constellation.
 */
export function computeConstCount(cells) {
  let count = {};
  cells.forEach(c => {
    let name = getConstellationForCell(c);
    count[name] = (count[name] || 0) + 1;
  });
  return count;
}

/**
 * (Unused here) Returns the dominant constellation name.
 */
export function getDominantConstellation(countObj) {
  let dom = 'Unknown';
  let max = 0;
  for (let name in countObj) {
    if (countObj[name] > max) {
      max = countObj[name];
      dom = name;
    }
  }
  return dom;
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
 * (This function remains as before.)
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}

/**
 * Returns the majority constellation among a set of cells.
 * For each cell, we call getConstellationForCell and then choose the one with the highest count.
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
 * Filters out tail cells from a neck (candidate strait) group.
 * A tail cell is defined as having only one neighbor in the group.
 */
export function filterNeckGroup(neckCells) {
  return neckCells.filter(cell => {
    let count = 0;
    neckCells.forEach(other => {
      if (cell === other) return;
      if (
        Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
        Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
        Math.abs(cell.grid.iz - other.grid.iz) <= 1
      ) {
        count++;
      }
    });
    return count > 1;
  });
}
