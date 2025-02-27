// filters/densitySegmentation.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor, getBlueColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

/**
 * Attempts to segment an Ocean (or Sea) candidate cluster via bottleneck detection.
 * In this updated version, segmentation only occurs if there is a neck (a group of thin cells)
 * that—after filtering out tail cells—separates the region into two or more connected sub‑clusters.
 */
export function segmentOceanCandidate(cells) {
  // Compute connectivity and mark thin cells.
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

  // Collect thin cells and group them into potential neck groups.
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

  // Look for a neck group that is narrow relative to the overall volume.
  let candidateNeck = null;
  const oceanVol = cells.length;
  for (const group of neckGroups) {
    // Use a threshold (e.g., neck group must be less than 15% of the total volume)
    if (group.length < 0.15 * oceanVol) {
      const neckAvgConn = group.reduce((s, cell) => s + cell.connectivity, 0) / group.length;
      if (neckAvgConn < 0.5 * C_avg) {
        // Filter out tail cells from the neck group
        const filteredNeck = filterNeckGroup(group);
        if (filteredNeck.length > 0) {
          candidateNeck = filteredNeck;
          break;
        }
      }
    }
  }

  // Only segment if a candidate neck exists.
  if (candidateNeck) {
    // Remove the neck cells from the original set
    const cellsWithoutNeck = cells.filter(cell => !candidateNeck.includes(cell));
    // Compute connected components on the remaining cells.
    const components = computeConnectedComponents(cellsWithoutNeck);
    // Filter out very small components (e.g., less than 10% of the total volume)
    const significantComponents = components.filter(comp => comp.length >= 0.1 * oceanVol);
    if (significantComponents.length >= 2) {
      return { segmented: true, cores: significantComponents, neck: candidateNeck };
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
 * Filters out tail cells from a neck (candidate strait) group.
 * A tail cell is defined as having only one neighbor within the neck group.
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

/**
 * Returns the majority constellation among a set of cells.
 * For each cell, getConstellationForCell is called and then the most frequent name is returned.
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
