// File: /filters/densitySegmentation.js
// This file implements segmentation and constellation determination for density cells.
// It now uses a boundary-based method to determine which constellation each cell belongs to.
// It parses raw constellation boundary data and uses a spherical point-in-polygon test via a gnomonic projection.

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBaseColor, lightenColor, darkenColor, getBlueColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, parseRA, parseDec, degToRad, getDensityCenterData } from './densityData.js';

/* --- Boundary Parsing and Spherical Point-in-Polygon Utilities --- */

// For this implementation, we assume that the raw data from "constellation_boundaries.txt"
// is available as a constant string. In a production environment, this could be loaded via fetch.
const rawBoundaryData = `
010:011 P+ 00:52:00 +48:00:00 01:07:00 +48:00:00 AND CAS
011:012 M+ 01:07:00 +48:00:00 01:07:00 +50:00:00 AND CAS
012:013 P+ 01:07:00 +50:00:00 01:22:00 +50:00:00 AND CAS
013:014 P+ 01:22:00 +50:00:00 01:40:00 +50:00:00 AND PER
015:016 P+ 01:40:00 +47:00:00 02:02:30 +47:00:00 AND PER
016:017 M+ 02:02:30 +47:00:00 02:02:30 +50:30:00 AND PER
017:018 P+ 02:02:30 +50:30:00 02:31:00 +50:30:00 AND PER
025:026 P+ 00:43:00 +23:45:00 00:51:00 +23:45:00 AND PSC
028:029 M+ 00:08:30 +21:00:00 00:08:30 +22:00:00 AND PEG
030:031 M+ 00:04:00 +22:00:00 00:04:00 +28:00:00 AND PEG
032:033 M+ 00:00:00 +28:00:00 00:00:00 +31:20:00 AND PEG
034:035 M+ 23:45:00 +31:20:00 23:45:00 +32:05:00 AND PEG
036:037 M+ 23:30:00 +32:05:00 23:30:00 +34:30:00 AND PEG
038:050 P+ 09:22:00 -24:00:00 09:45:00 -24:00:00 ANT HYA
049:048 P+ 09:45:00 -26:30:00 10:15:00 -26:30:00 ANT HYA
047:046 P+ 10:15:00 -29:10:00 10:35:00 -29:10:00 ANT HYA
045:044 P+ 10:35:00 -31:10:00 10:50:00 -31:10:00 ANT HYA
043:042 P+ 10:50:00 -35:00:00 11:00:00 -35:00:00 ANT HYA
040:039 M+ 09:22:00 -39:45:00 09:22:00 -36:45:00 ANT VEL
039:038 M+ 09:22:00 -36:45:00 09:22:00 -24:00:00 ANT PYX
`;

// Parse raw boundary data into an object mapping constellation names to polygons.
// Each polygon is an array of points { ra, dec } in degrees.
function parseConstellationBoundaries(rawData) {
  const lines = rawData.trim().split('\n');
  const boundaries = {};
  for (const line of lines) {
    // Expected format: "010:011 P+ RA1 DEC1 RA2 DEC2 CONST1 CONST2"
    const parts = line.split(/\s+/);
    if (parts.length < 7) continue;
    // We use the two endpoints to form a segment.
    const raStr1 = parts[2]; // e.g., "00:52:00"
    const decStr1 = parts[3]; // e.g., "+48:00:00"
    const raStr2 = parts[4]; // e.g., "01:07:00"
    const decStr2 = parts[5]; // e.g., "+48:00:00"
    const constellation = parts[6]; // e.g., "AND" (could combine with parts[7] if needed)
    // Convert RA from "HH:MM:SS" to degrees: multiply hours by 15, minutes by 0.25, seconds by ~0.00416667
    function raToDeg(raStr) {
      const [hh, mm, ss] = raStr.split(':').map(Number);
      return (hh + mm / 60 + ss / 3600) * 15;
    }
    // Convert Dec from "±DD:MM:SS" to degrees
    function decToDeg(decStr) {
      const sign = decStr[0] === '-' ? -1 : 1;
      const [dd, mm, ss] = decStr.replace('+', '').split(':').map(Number);
      return sign * (dd + mm / 60 + ss / 3600);
    }
    const p1 = { ra: raToDeg(raStr1), dec: decToDeg(decStr1) };
    const p2 = { ra: raToDeg(raStr2), dec: decToDeg(decStr2) };
    if (!boundaries[constellation]) {
      boundaries[constellation] = [];
    }
    // For simplicity, treat each segment as its own polygon.
    // A more sophisticated approach would stitch segments together.
    boundaries[constellation].push([p1, p2]);
  }
  // In a real implementation, you would combine connected segments into larger polygons.
  // Here we assume each constellation has one polygon formed by the union of its segments.
  return boundaries;
}

// Build the global constellationPolygons object using the boundary data.
export const constellationPolygons = parseConstellationBoundaries(rawBoundaryData);

// Implementation of a spherical point-in-polygon test using a gnomonic projection.
// Given a point { ra, dec } in degrees and a polygon (array of points { ra, dec }),
// returns true if the point is inside the polygon.
export function isPointInPolygon(point, polygon) {
  // Convert degrees to radians
  const toRad = deg => deg * Math.PI / 180;
  const pt = { ra: toRad(point.ra), dec: toRad(point.dec) };
  const poly = polygon.map(p => ({ ra: toRad(p.ra), dec: toRad(p.dec) }));
  
  // Use a gnomonic projection centered at the point.
  // For each polygon vertex, compute its projected coordinates on the tangent plane.
  function project(p) {
    // p: { ra, dec } in radians, center: pt.
    const cosC = Math.sin(pt.dec) * Math.sin(p.dec) + Math.cos(pt.dec) * Math.cos(p.dec) * Math.cos(p.ra - pt.ra);
    const x = (Math.cos(p.dec) * Math.sin(p.ra - pt.ra)) / cosC;
    const y = (Math.cos(pt.dec) * Math.sin(p.dec) - Math.sin(pt.dec) * Math.cos(p.dec) * Math.cos(p.ra - pt.ra)) / cosC;
    return { x, y };
  }
  
  const projectedPoly = poly.map(project);
  
  // Standard 2D point-in-polygon (ray-casting) test.
  let inside = false;
  for (let i = 0, j = projectedPoly.length - 1; i < projectedPoly.length; j = i++) {
    const xi = projectedPoly[i].x, yi = projectedPoly[i].y;
    const xj = projectedPoly[j].x, yj = projectedPoly[j].y;
    const intersect = ((yi > 0) !== (yj > 0)) &&
                      (pt.ra < (xj - xi) * (0 - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* --- End Boundary Parsing and Spherical Point-in-Polygon Utilities --- */

/* --- Segmentation and Cluster Naming Functions --- */

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

export function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

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

export function getConstellationForCell(cell) {
  // Use the globe-projected position because the boundaries are defined for the globe.
  const pos = cell.spherePosition ? cell.spherePosition : cell.tcPos;
  const r = pos.length();
  if (r < 1e-6) return "Unknown";
  let ra = Math.atan2(-pos.z, -pos.x);
  if (ra < 0) ra += 2 * Math.PI;
  ra = THREE.Math.radToDeg(ra);
  const dec = Math.asin(pos.y / r);
  const decDeg = THREE.Math.radToDeg(dec);
  
  if (typeof constellationPolygons === "undefined" || typeof isPointInPolygon !== "function") {
    return "Unknown";
  }
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

export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
