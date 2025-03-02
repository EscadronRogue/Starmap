// /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getIndividualBlueColor } from './densityColorUtils.js';
import { getDensityCenterData } from './densityData.js';

/**
 * Helper: Standard 2D ray-casting point-in-polygon test.
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
 * Spherical point-in-polygon test. Not used by the strait logic, just here for reference.
 */
export function isPointInSphericalPolygon(point, polygon) {
  let totalAngle = 0;
  for (let i = 0; i < polygon.length; i++) {
    const v1 = polygon[i].clone().sub(point).normalize();
    const v2 = polygon[(i + 1) % polygon.length].clone().sub(point).normalize();
    totalAngle += Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1));
  }
  return Math.abs(totalAngle - 2 * Math.PI) < 0.3;
}

/**
 * Subdivide geometry on the sphere (legacy).
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
 * Minimal function to convert a sphere vector -> RA/DEC in deg.
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
 * BFS to compute connected components among a set of cells, with adjacency
 * defined by |ix1-ix2|<=1, etc.
 */
function computeConnectedComponents(cells) {
  const visited = new Set();
  const components = [];
  const getNeighbors = (cell) => {
    const results = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          const nx = cell.grid.ix + dx;
          const ny = cell.grid.iy + dy;
          const nz = cell.grid.iz + dz;
          const found = cells.find(c => c.grid.ix === nx && c.grid.iy === ny && c.grid.iz === nz);
          if (found) results.push(found);
        }
      }
    }
    return results;
  };

  cells.forEach(cell => {
    if (visited.has(cell.id)) return;
    const stack = [ cell ];
    const comp = [];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      comp.push(cur);
      getNeighbors(cur).forEach(n => {
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
 * If removing a certain set of "candidate" cells splits the cluster into
 * exactly 2 sub‑clusters of size ratio≥0.1, we call that set the "neck".
 */
function testNeckRemoval(cells, neckSet) {
  if (neckSet.length === 0) return null;
  if (neckSet.length >= cells.length) return null;
  // remove them
  const remainder = cells.filter(c => !neckSet.includes(c));
  if (remainder.length === 0) return null;
  const comps = computeConnectedComponents(remainder);
  if (comps.length !== 2) return null;
  const sA = comps[0].length;
  const sB = comps[1].length;
  const smaller = Math.min(sA, sB);
  const bigger = Math.max(sA, sB);
  if (bigger === 0) return null;
  if (smaller >= 0.1 * bigger) {
    // valid 2-part split
    return {
      coreA: comps[0],
      coreB: comps[1]
    };
  }
  return null;
}

/**
 * Returns neighbor count for 'cell' among 'cluster'.
 */
function getNeighborCount(cell, cluster) {
  let nCount = 0;
  for (let i = 0; i < cluster.length; i++) {
    const other = cluster[i];
    if (other === cell) continue;
    if (Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
        Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
        Math.abs(cell.grid.iz - other.grid.iz) <= 1) {
      nCount++;
    }
  }
  return nCount;
}

/**
 * Gathers all "candidate" cells whose neighbor count is in [2..5].
 * Then lumps them by adjacency. Then for each lump:
 *   (a) if lumpsize > 10% of cluster, pick a subset (lowest neighbor counts).
 *   (b) try removing that. If it splits cluster => success.
 */
export function segmentOceanCandidate(cells) {
  const clusterSize = cells.length;
  if (clusterSize < 2) {
    return { segmented: false, cores: [cells] };
  }

  // 1) gather single-cube candidates
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

  // 2) BFS lumps among these candidateCells
  const lumps = [];
  const visited = new Set();

  function getCandidateNeighbors(cell) {
    return candidateCells.filter(cc => {
      if (cc===cell) return false;
      return (Math.abs(cc.grid.ix - cell.grid.ix)<=1 &&
              Math.abs(cc.grid.iy - cell.grid.iy)<=1 &&
              Math.abs(cc.grid.iz - cell.grid.iz)<=1);
    });
  }

  candidateCells.forEach(cand => {
    if (visited.has(cand.id)) return;
    const stack = [cand];
    const lump = [];
    while (stack.length>0) {
      const top = stack.pop();
      if (visited.has(top.id)) continue;
      visited.add(top.id);
      lump.push(top);
      const nbrs = getCandidateNeighbors(top);
      nbrs.forEach(n => {
        if (!visited.has(n.id)) stack.push(n);
      });
    }
    lumps.push(lump);
  });

  // 3) For each lump, ensure lumpsize <= 10% cluster. If bigger => pick subset
  // with minimal neighbor counts. Then test removal.
  const maxNeckVol = Math.floor(0.1*clusterSize);
  for (let i=0; i<lumps.length; i++) {
    const lump = lumps[i];
    let usedLump;
    if (lump.length > maxNeckVol) {
      // pick best subset
      // sort lump by ascending neighbor count
      const sorted = lump.slice().sort((a,b)=>{
        const na = getNeighborCount(a, cells);
        const nb = getNeighborCount(b, cells);
        return na - nb;
      });
      usedLump = sorted.slice(0, maxNeckVol);
    } else {
      usedLump = lump;
    }
    // test removing usedLump
    const testResult = testNeckRemoval(cells, usedLump);
    if (testResult) {
      // success => we found a multi-cube neck
      return {
        segmented: true,
        cores: [ testResult.coreA, testResult.coreB ],
        neck: usedLump
      };
    }
  }

  // no lumps worked
  return { segmented: false, cores: [ cells ] };
}

/**
 * Returns the centroid of the set of cells (for labeling).
 */
export function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

/**
 * The "best cell" for labeling a region. 
 */
export function computeInterconnectedCell(cells) {
  let best = cells[0];
  let bestCount = 0;
  cells.forEach(cell => {
    let cnt = 0;
    cells.forEach(o => {
      if (o===cell) return;
      if (Math.abs(cell.grid.ix - o.grid.ix)<=1 &&
          Math.abs(cell.grid.iy - o.grid.iy)<=1 &&
          Math.abs(cell.grid.iz - o.grid.iz)<=1) {
        cnt++;
      }
    });
    if (cnt>bestCount) {
      bestCount=cnt;
      best=cell;
    }
  });
  return best;
}

/**
 * Great circle path points.
 */
export function getGreatCirclePoints(p1, p2, R, segments) {
  const points = [];
  const start = p1.clone().normalize().multiplyScalar(R);
  const end = p2.clone().normalize().multiplyScalar(R);
  const axis = new THREE.Vector3().crossVectors(start, end).normalize();
  const angle = start.angleTo(end);
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments)*angle;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, theta);
    const point = start.clone().applyQuaternion(q);
    points.push(point);
  }
  return points;
}

/**
 * For coloring each region distinctly.
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
