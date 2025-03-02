// /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getIndividualBlueColor } from './densityColorUtils.js';
import { getDensityCenterData } from './densityData.js';

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
 * Spherical point-in-polygon test.
 * For a given polygon (array of THREE.Vector3 on the sphere) and a test point,
 * compute the sum of angles between the test point and each adjacent pair of vertices.
 * If the total angle is nearly 2π, the point is considered inside.
 * @param {THREE.Vector3} point - The test point (assumed to be on the sphere, e.g. length = 100)
 * @param {Array} polygon - Array of THREE.Vector3 vertices (assumed to lie on the sphere)
 * @returns {boolean} - true if point is inside the spherical polygon.
 */
function isPointInSphericalPolygon(point, polygon) {
  let totalAngle = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const v1 = polygon[i].clone().sub(point).normalize();
    const v2 = polygon[(i + 1) % n].clone().sub(point).normalize();
    totalAngle += Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1));
  }
  return Math.abs(totalAngle - 2 * Math.PI) < 0.3;
}

/**
 * Computes the minimal angular distance (in radians) from a cell's position to a polygon’s edge.
 * For each edge (between vertices v1 and v2), we compute the perpendicular distance
 * (using great‑circle geometry). If the perpendicular falls outside the edge segment,
 * the distance to the closer endpoint is used.
 * @param {THREE.Vector3} cellPos - The cell’s position (should be set to length 100)
 * @param {Array} polygon - Array of THREE.Vector3 vertices (the overlay boundary)
 * @returns {number} - Minimal angular distance (in radians)
 */
function minAngularDistanceToPolygon(cellPos, polygon) {
  let minAngle = Infinity;
  const n = polygon.length;
  // Normalize cellPos (should already be on the sphere)
  const cellNorm = cellPos.clone().setLength(100);
  for (let i = 0; i < n; i++) {
    const v1 = polygon[i].clone().setLength(100);
    const v2 = polygon[(i + 1) % n].clone().setLength(100);
    // Compute perpendicular angular distance to the great circle defined by v1 and v2.
    const nEdge = new THREE.Vector3().crossVectors(v1, v2).normalize();
    let angleDist = Math.asin(Math.abs(cellNorm.dot(nEdge)));
    // Check if the perpendicular falls on the segment:
    const angleToV1 = cellNorm.angleTo(v1);
    const angleToV2 = cellNorm.angleTo(v2);
    const edgeAngle = v1.angleTo(v2);
    if (angleToV1 + angleToV2 > edgeAngle + 1e-3) {
      angleDist = Math.min(angleToV1, angleToV2);
    }
    if (angleDist < minAngle) {
      minAngle = angleDist;
    }
  }
  return minAngle;
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
    if (neighborCount >= 2 && neighborCount <= 7) {
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
 * Each region's color is determined by a function using its clusterId, constName, and type.
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
