// filters/densitySegmentation.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

/**
 * Attempts to segment an Ocean candidate cluster via bottleneck detection.
 */
export function segmentOceanCandidate(cells) {
  cells.forEach(cell => {
    let count = 0;
    cells.forEach(other => {
      if (cell === other) return;
      if (Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
          Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
          Math.abs(cell.grid.iz - other.grid.iz) <= 1) {
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
        if (!visited.has(other.id) && other.thin &&
            Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
            Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
            Math.abs(current.grid.iz - other.grid.iz) <= 1) {
          stack.push(other);
        }
      });
    }
    neckGroups.push(group);
  });
  
  const oceanVol = cells.length;
  let candidateNeck = null;
  for (const group of neckGroups) {
    if (group.length >= 0.15 * oceanVol) continue;
    const neckAvgConn = group.reduce((s, cell) => s + cell.connectivity, 0) / group.length;
    if (neckAvgConn >= 0.5 * C_avg) continue;
    const remaining = cells.filter(cell => !group.includes(cell));
    const subClusters = [];
    const remVisited = new Set();
    remaining.forEach(cell => {
      if (remVisited.has(cell.id)) return;
      const comp = [];
      const stack = [cell];
      while (stack.length > 0) {
        const curr = stack.pop();
        if (remVisited.has(curr.id)) continue;
        remVisited.add(curr.id);
        comp.push(curr);
        remaining.forEach(other => {
          if (!remVisited.has(other.id) &&
              Math.abs(curr.grid.ix - other.grid.ix) <= 1 &&
              Math.abs(curr.grid.iy - other.grid.iy) <= 1 &&
              Math.abs(curr.grid.iz - other.grid.iz) <= 1) {
            stack.push(other);
          }
        });
      }
      subClusters.push(comp);
    });
    if (subClusters.length === 2 &&
        subClusters.every(comp => comp.length >= 0.1 * oceanVol)) {
      candidateNeck = group;
      return { segmented: true, cores: subClusters, neck: candidateNeck };
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
      if (Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
          Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
          Math.abs(cell.grid.iz - other.grid.iz) <= 1) {
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
 * Merges branch objects with identical touchedCores.
 */
export function mergeBranches(branches) {
  let merged = {};
  branches.forEach(branch => {
    let key = Array.from(branch.touchedCores).sort().join(',');
    if (!merged[key]) {
      merged[key] = { cells: [], touchedCores: new Set(branch.touchedCores) };
    }
    merged[key].cells = merged[key].cells.concat(branch.cells);
  });
  return Object.values(merged);
}

/**
 * Assigns distinct base colors to independent regions.
 * This updated version uses predefined blue shades for each type.
 */
export function assignDistinctColorsToIndependent(regions) {
  const colorMap = {};
  // Define distinct blue palettes for each region type.
  const bluePalettes = {
    Ocean: ['#001f3f', '#003366', '#004080', '#0059b3', '#0074D9'],
    Sea:   ['#003f7f', '#0059b3', '#0074D9', '#3399ff', '#66ccff'],
    Lake:  ['#66ccff', '#99ccff', '#cce6ff', '#e6f2ff']
  };

  ['Ocean', 'Sea', 'Lake'].forEach(type => {
    const group = regions.filter(r => r.type === type);
    const palette = bluePalettes[type] || [];
    group.forEach((region, i) => {
      // Cycle through the palette if there are more regions than available colors.
      const colorHex = palette[i % palette.length];
      region.color = new THREE.Color(colorHex);
      colorMap[region.clusterId] = region.color;
    });
  });
  return colorMap;
}
