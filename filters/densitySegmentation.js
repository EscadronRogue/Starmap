// /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getIndividualBlueColor } from './densityColorUtils.js';
import { getDensityCenterData } from './densityData.js';
import { positionToSpherical, getConstellationForPoint } from './newConstellationMapping.js';

/**
 * Helper: Standard 2D ray-casting point-in-polygon test.
 * @param {Object} point - {x, y}
 * @param {Array} vs - Array of vertices [{x, y}, ...]
 * @returns {boolean} - true if the point is inside the polygon.
 */
function pointInPolygon2D(point, vs) {
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y;
    const xj = vs[j].x, yj = vs[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
                      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Helper: Computes the minimal angular distance (in radians) between a cell's position
 * (cellPos) and an overlay polygon's vertices.
 * Both cellPos and the polygon vertices are assumed to lie on a sphere.
 * @param {THREE.Vector3} cellPos - The cell's position (should be set to length 100)
 * @param {Array} polygon - Array of THREE.Vector3 vertices (the overlay boundary)
 * @returns {number} - The smallest angular distance (in radians)
 */
function minAngularDistanceToVertices(cellPos, polygon) {
  let minAngle = Infinity;
  // Ensure cellPos is set to sphere radius 100.
  const cellNorm = cellPos.clone().setLength(100);
  polygon.forEach(vertex => {
    const v = vertex.clone().setLength(100);
    const angle = cellNorm.angleTo(v);
    if (angle < minAngle) {
      minAngle = angle;
    }
  });
  return minAngle;
}

/**
 * Determines the constellation for a given cell by choosing the overlay
 * whose boundary (any vertex) is closest in angular distance to the cell's globe position.
 * @param {Object} cell - A density cell with a globeMesh having a valid position.
 * @returns {string} - The assigned constellation name.
 */
function getConstellationForCellUsingOverlay(cell) {
  if (!cell.globeMesh || !cell.globeMesh.position) {
    throw new Error(`Cell id ${cell.id} is missing a valid globeMesh position.`);
  }
  // Project the cell's position onto a sphere of radius 100.
  const cellPos = cell.globeMesh.position.clone().setLength(100);
  
  let bestOverlay = null;
  let bestDistance = Infinity;
  
  if (window.constellationOverlayGlobe && window.constellationOverlayGlobe.length > 0) {
    for (const overlay of window.constellationOverlayGlobe) {
      if (!overlay.userData || !overlay.userData.polygon) continue;
      const poly = overlay.userData.polygon; // Array of THREE.Vector3
      const distance = minAngularDistanceToVertices(cellPos, poly);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOverlay = overlay;
      }
    }
    if (bestOverlay) {
      console.log(
        `Cell id ${cell.id} assigned to constellation ${bestOverlay.userData.constellation} ` +
        `(min angular distance = ${bestDistance.toFixed(2)} rad).`
      );
      return bestOverlay.userData.constellation;
    }
  }
  return "Unknown";
}

/**
 * Returns the constellation for a given density cell.
 * This version uses the nearest-overlay (vertex-based) approach.
 */
export function getConstellationForCell(cell) {
  const cons = getConstellationForCellUsingOverlay(cell);
  if (cons === "Unknown") {
    console.warn(`Cell id ${cell.id} did not find a nearby overlay. Returning "Unknown".`);
    return "Unknown";
  }
  return cons;
}

/**
 * Computes connected components among cells.
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
 * Segments an ocean candidate by looking for a narrow "neck" between connected components.
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
 * Computes the centroid of a set of cells (using their true coordinate positions).
 */
export function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

/**
 * Finds the cell most "interconnected" with its neighbors.
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
 * Determines the majority constellation of a set of cells.
 * If the majority vote is "Unknown", a warning is logged.
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
  if (majority === "Unknown") {
    console.warn("Majority constellation for cluster is Unknown. Check overlay data.");
  }
  console.log(`Majority constellation for cluster: ${majority}`);
  return majority;
}

/**
 * Generates points along the great‑circle path between two points on a sphere.
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
 * Assigns distinct colors to regions.
 * Each region's color is determined using its clusterId, constellation name, and type.
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
