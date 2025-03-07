// /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getIndividualBlueColor } from './densityColorUtils.js';
import { getDensityCenterData } from './densityData.js';
import { radToSphere, subdivideGeometry, getGreatCirclePoints, vectorToRaDec } from '../utils/geometryUtils.js';

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
 * Export subdivideGeometry from our utility (unchanged).
 */
export { subdivideGeometry };

/**
 * Finds a segmentation (choke point) in a cluster of cells.
 * Returns an object with segmented flag, cores (an array of two clusters if segmented),
 * and neck (the cells at the choke point).
 */
export function segmentOceanCandidate(cells) {
  function getNeighborCount(cell, cluster) {
    let count = 0;
    for (let i = 0; i < cluster.length; i++) {
      const other = cluster[i];
      if (other === cell) continue;
      if (
        Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
        Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
        Math.abs(cell.grid.iz - other.grid.iz) <= 1
      ) {
        count++;
      }
    }
    return count;
  }

  const candidateCells = [];
  cells.forEach(c => {
    const nCount = getNeighborCount(c, cells);
    if (nCount >= 2 && nCount <= 5) {
      candidateCells.push(c);
    }
  });
  if (candidateCells.length === 0) {
    return { segmented: false, cores: [cells] };
  }

  const visited = new Set();
  const lumps = [];
  function getNeighborsInCandidates(cell) {
    return candidateCells.filter(cc => {
      if (cc === cell) return false;
      return Math.abs(cc.grid.ix - cell.grid.ix) <= 1 &&
             Math.abs(cc.grid.iy - cell.grid.iy) <= 1 &&
             Math.abs(cc.grid.iz - cell.grid.iz) <= 1;
    });
  }

  candidateCells.forEach(cand => {
    if (visited.has(cand.id)) return;
    const stack = [cand];
    const lump = [];
    while (stack.length > 0) {
      const top = stack.pop();
      if (visited.has(top.id)) continue;
      visited.add(top.id);
      lump.push(top);
      const localNbrs = getNeighborsInCandidates(top);
      localNbrs.forEach(nb => {
        if (!visited.has(nb.id)) {
          stack.push(nb);
        }
      });
    }
    lumps.push(lump);
  });

  for (let i = 0; i < lumps.length; i++) {
    const lump = lumps[i];
    const remainder = cells.filter(c => !lump.includes(c));
    if (remainder.length === 0) continue;
    const comps = computeConnectedComponents(remainder);
    if (comps.length !== 2) {
      continue;
    }
    const sizeA = comps[0].length;
    const sizeB = comps[1].length;
    const smaller = Math.min(sizeA, sizeB);
    const bigger = Math.max(sizeA, sizeB);
    if (bigger > 0 && smaller >= 0.1 * bigger) {
      return {
        segmented: true,
        cores: [comps[0], comps[1]],
        neck: lump
      };
    }
  }
  return { segmented: false, cores: [cells] };
}

/**
 * Helper: Computes connected components among a set of cells using BFS.
 */
function computeConnectedComponents(cells) {
  const visited = new Set();
  const components = [];
  cells.forEach(cell => {
    if (visited.has(cell.id)) return;
    const stack = [cell];
    const comp = [];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      comp.push(cur);
      const nbrs = getCellNeighbors(cur, cells);
      nbrs.forEach(n => {
        if (!visited.has(n.id)) {
          stack.push(n);
        }
      });
    }
    components.push(comp);
  });
  return components;
}

/**
 * Helper: Finds neighbor cells in the given set.
 */
function getCellNeighbors(cell, cells) {
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const nx = cell.grid.ix + dx;
        const ny = cell.grid.iy + dy;
        const nz = cell.grid.iz + dz;
        const neighbor = cells.find(cc => cc.grid.ix === nx && cc.grid.iy === ny && cc.grid.iz === nz);
        if (neighbor) {
          result.push(neighbor);
        }
      }
    }
  }
  return result;
}

/**
 * Computes the most interconnected cell among a set of cells.
 * This function examines the immediate neighborhood of each cell and returns the cell with the highest neighbor count.
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
