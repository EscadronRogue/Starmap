// /filters/densitySegmentation.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor, getBlueColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

/**
 * Returns the constellation for a given cell using constellation boundaries.
 * This method uses the same approach as your constellation overlay filter.
 * It converts the cell’s globe‐projected position (if available, otherwise tcPos)
 * into celestial coordinates (RA and Dec in degrees) and then checks in which
 * constellation polygon the point falls.
 *
 * Note: This requires that the global variable "constellationPolygons" is available,
 * and that a function isPointInPolygon(point, polygon) is defined.
 */
export function getConstellationForCell(cell) {
  // Use globe projection since that is the reference for boundaries
  const pos = cell.spherePosition ? cell.spherePosition : cell.tcPos;
  const r = pos.length();
  if (r < 1e-6) return "Unknown";
  let ra = Math.atan2(-pos.z, -pos.x); // in radians
  if (ra < 0) ra += 2 * Math.PI;
  ra = THREE.Math.radToDeg(ra);
  const dec = Math.asin(pos.y / r); // in radians
  const decDeg = THREE.Math.radToDeg(dec);

  // Expect a global variable "constellationPolygons" containing the boundary polygons
  if (typeof constellationPolygons === "undefined" || typeof isPointInPolygon !== "function") {
    return "Unknown";
  }
  // Check each constellation’s polygons
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

/**
 * Attempts to segment an Ocean (or Sea) candidate cluster via neck candidate detection.
 * A neck candidate is any cell with between 2 and 3 neighbors.
 * The candidate is simulated removed; if the removal yields exactly two connected components
 * and the smaller component is at least 25% as big as the larger, segmentation is accepted.
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
    if (neighborCount >= 2 && neighborCount <= 3) {
      // Simulate removal of candidate cell.
      const remaining = cells.filter(cell => cell !== candidate);
      const components = computeConnectedComponents(remaining);
      if (components.length === 2) {
        const size1 = components[0].length;
        const size2 = components[1].length;
        const smaller = Math.min(size1, size2);
        const larger = Math.max(size1, size2);
        if (smaller >= 0.25 * larger) {
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
 * Tallies, for a given set of cells, the total volume (cell count) per constellation
 * using the boundary-based method, and returns the constellation with the highest count.
 */
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
 * Each region gets its own blue-based color based on its unique id, majority constellation, and type.
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
