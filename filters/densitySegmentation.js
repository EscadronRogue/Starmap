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
 * Subdivide geometry on the sphere (legacy function).
 */
export function subdivideGeometry(geometry, iterations) {
  let geo = geometry;
  for (let iter = 0; iter < iterations; iter++) {
    const posAttr = geo.getAttribute('position');
    const oldPositions = [];
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      oldPositions.push(v);
    }
    const oldIndices = geo.getIndex().array;
    const newVertices = [...oldPositions];
    const newIndices = [];
    const midpointCache = {};

    function getMidpoint(i1, i2) {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      if (midpointCache[key] !== undefined) return midpointCache[key];
      const v1 = newVertices[i1];
      const v2 = newVertices[i2];
      const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5).normalize().multiplyScalar(100);
      newVertices.push(mid);
      const idx = newVertices.length - 1;
      midpointCache[key] = idx;
      return idx;
    }

    for (let i = 0; i < oldIndices.length; i += 3) {
      const i0 = oldIndices[i];
      const i1 = oldIndices[i + 1];
      const i2 = oldIndices[i + 2];
      const m0 = getMidpoint(i0, i1);
      const m1 = getMidpoint(i1, i2);
      const m2 = getMidpoint(i2, i0);
      newIndices.push(i0, m0, m2);
      newIndices.push(m0, i1, m1);
      newIndices.push(m0, m1, m2);
      newIndices.push(m2, m1, i2);
    }

    const positions = [];
    newVertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Returns the RA/DEC from a sphere coordinate (in degrees).
 */
export function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

/**
 * A small BFS to compute connected components among a set of cell objects.
 * We consider two cells connected if their ix,iy,iz differ by at most ±1.
 */
function computeConnectedComponents(cells) {
  const visited = new Set();
  const components = [];
  // for quick ID->cell lookups:
  const cellMap = new Map();
  cells.forEach(c => cellMap.set(c.id, c));

  function neighbors(cell) {
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nx = cell.grid.ix + dx;
          const ny = cell.grid.iy + dy;
          const nz = cell.grid.iz + dz;
          const neigh = cells.find(cc => cc.grid.ix === nx && cc.grid.iy === ny && cc.grid.iz === nz);
          if (neigh) {
            result.push(neigh);
          }
        }
      }
    }
    return result;
  }

  cells.forEach(cell => {
    if (visited.has(cell.id)) return;
    const stack = [cell];
    const comp = [];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      comp.push(cur);
      const nbrs = neighbors(cur);
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
 * Finds the single "best" choke point (or group) to segment a large cluster into two pieces.
 * Returns { segmented:false, cores:[cells] } if no neck is found.
 *
 * Now extended to handle multi-cube neck lumps:
 *  1) we gather all cells whose neighbor count ∈ [2..5]
 *  2) group them by adjacency => lumps
 *  3) for each lump, remove it -> if the remainder splits into exactly 2 big sub‑clusters
 *     whose smaller is ≥ 0.1 * bigger, we label that lump as 'neck' and we are done
 */
export function segmentOceanCandidate(cells) {
  // Quick neighbor count for each cell
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

  // 1) Collect "candidate" cells (2..5 neighbors)
  const candidateCells = [];
  cells.forEach(c => {
    const nCount = getNeighborCount(c, cells);
    if (nCount >= 2 && nCount <= 9) {
      candidateCells.push(c);
    }
  });
  if (candidateCells.length === 0) {
    // no single-cube or multi-cube "neck" candidate
    return { segmented: false, cores: [ cells ] };
  }

  // 2) group these candidate cells into BFS lumps
  const visited = new Set();
  const lumps = [];
  function getNeighborsInCandidates(cell) {
    // adjacency among candidateCells themselves
    return candidateCells.filter(cc => {
      if (cc === cell) return false;
      return Math.abs(cc.grid.ix - cell.grid.ix) <= 1 &&
             Math.abs(cc.grid.iy - cell.grid.iy) <= 1 &&
             Math.abs(cc.grid.iz - cell.grid.iz) <= 1;
    });
  }

  candidateCells.forEach(cand => {
    if (visited.has(cand.id)) return;
    const stack = [ cand ];
    const lump = [];
    while (stack.length > 0) {
      const top = stack.pop();
      if (visited.has(top.id)) continue;
      visited.add(top.id);
      lump.push(top);
      // push neighbors
      const localNbrs = getNeighborsInCandidates(top);
      localNbrs.forEach(nb => {
        if (!visited.has(nb.id)) {
          stack.push(nb);
        }
      });
    }
    lumps.push(lump);
  });

  // 3) For each lump, remove them from 'cells' => see if the remainder splits into exactly 2
  // big sub-clusters with ratio≥0.1
  for (let i = 0; i < lumps.length; i++) {
    const lump = lumps[i];
    // Temporarily remove the entire lump
    const remainder = cells.filter(c => !lump.includes(c));
    if (remainder.length === 0) continue;

    // compute connected components
    const comps = computeConnectedComponents(remainder);
    if (comps.length !== 2) {
      // we want exactly 2 sub-clusters
      continue;
    }
    const sizeA = comps[0].length;
    const sizeB = comps[1].length;
    const smaller = Math.min(sizeA, sizeB);
    const bigger = Math.max(sizeA, sizeB);
    if (bigger > 0 && smaller >= 0.1 * bigger) {
      // success => we found a multi-cube neck
      return {
        segmented: true,
        cores: [ comps[0], comps[1] ],
        neck: lump
      };
    }
  }

  // If none of the lumps worked => no segmentation
  return { segmented: false, cores: [ cells ] };
}

/**
 * Returns the centroid of the set of cells, used for labeling.
 */
export function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

/**
 * Finds the single cell in "cells" that has the highest local connectivity (most neighbors).
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
 * Returns an array of points on the great-circle arc between p1 and p2 on a sphere of radius R.
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
 * Assigns distinct color to region. (Used in some expansions.)
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
