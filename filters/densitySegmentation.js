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
 * New: 3D point-in-polygon test via planar projection.
 * For the given polygon (an array of THREE.Vector3 on the sphere) we:
 *   1. Compute its centroid.
 *   2. Build a local (u,v) basis in the plane defined by the first edge.
 *   3. Project both the polygon vertices and the test point onto that plane.
 *   4. Run a standard 2D point-in-polygon test.
 * @param {THREE.Vector3} point - The test point (assumed to lie on the sphere; e.g. set to radius 100)
 * @param {Array} polygon - Array of THREE.Vector3 vertices of the overlay polygon.
 * @returns {boolean} - true if the point lies inside the projected polygon.
 */
function isPointInPolygon3D(point, polygon) {
  if (polygon.length < 3) return false;
  const centroid = new THREE.Vector3();
  polygon.forEach(v => centroid.add(v));
  centroid.divideScalar(polygon.length);
  
  // Use first edge to define a local plane.
  const v1 = polygon[0].clone().sub(centroid);
  if (v1.lengthSq() < 1e-6) return false;
  const u = v1.clone().normalize();
  const normal = new THREE.Vector3().crossVectors(v1, polygon[1].clone().sub(centroid)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  
  // Project polygon vertices and point onto the plane.
  const poly2D = polygon.map(p => {
    const diff = p.clone().sub(centroid);
    return { x: diff.dot(u), y: diff.dot(v) };
  });
  const diffPoint = point.clone().sub(centroid);
  const point2D = { x: diffPoint.dot(u), y: diffPoint.dot(v) };
  
  return pointInPolygon2D(point2D, poly2D);
}

/**
 * Fallback: For a given cell position and a polygon, compute the minimum angular distance.
 * The method iterates over each edge of the polygon. For each edge (between v1 and v2),
 * we compute the distance from cellPos (normalized) to the great circle defined by v1 and v2.
 * If the perpendicular falls outside the arc, we use the smaller distance to an endpoint.
 * @param {THREE.Vector3} cellPos - normalized test position.
 * @param {Array} polygon - Array of THREE.Vector3 vertices (assumed normalized).
 * @returns {number} - Minimal angular distance (in radians) from cellPos to the polygon.
 */
function minAngularDistanceToPolygon(cellPos, polygon) {
  let minAngle = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const v1 = polygon[i].clone().normalize();
    const v2 = polygon[(i + 1) % n].clone().normalize();
    // Compute the great circle defined by v1 and v2.
    const nEdge = new THREE.Vector3().crossVectors(v1, v2).normalize();
    // Angular distance from cellPos to the great circle:
    let angleDist = Math.asin(Math.abs(cellPos.dot(nEdge)));
    // Now check if the perpendicular falls on the arc.
    const angleToV1 = cellPos.angleTo(v1);
    const angleToV2 = cellPos.angleTo(v2);
    const edgeAngle = v1.angleTo(v2);
    if (angleToV1 + angleToV2 > edgeAngle + 1e-3) {
      // Perpendicular falls outside the arc; use min distance to endpoints.
      angleDist = Math.min(angleToV1, angleToV2);
    }
    if (angleDist < minAngle) {
      minAngle = angleDist;
    }
  }
  return minAngle;
}

/**
 * --- Overlay-Based Constellation Lookup ---
 * This function uses the overlay data created for the globe.
 * It assumes that window.constellationOverlayGlobe is an array of THREE.Mesh overlays,
 * each with userData.polygon (an ordered array of THREE.Vector3 on the sphere)
 * and userData.constellation (the constellation label).
 *
 * First it attempts an exact test using isPointInPolygon3D.
 * If that fails, it falls back to choosing the overlay with the smallest angular distance
 * (if that distance is below a threshold).
 */
function getConstellationForCellUsingOverlay(cell) {
  if (!cell.globeMesh || !cell.globeMesh.position) {
    throw new Error(`Cell id ${cell.id} is missing a valid globeMesh position.`);
  }
  // Project cell position onto sphere of radius 100.
  const cellPos = cell.globeMesh.position.clone().setLength(100);
  
  let bestOverlay = null;
  let bestDistance = Infinity;
  
  if (window.constellationOverlayGlobe && window.constellationOverlayGlobe.length > 0) {
    for (const overlay of window.constellationOverlayGlobe) {
      if (!overlay.userData || !overlay.userData.polygon) continue;
      const poly = overlay.userData.polygon; // vertices on the sphere
      if (isPointInPolygon3D(cellPos, poly)) {
        console.log(`Cell id ${cell.id} falls inside overlay for constellation ${overlay.userData.constellation} (exact test).`);
        return overlay.userData.constellation;
      }
      // Fallback: compute minimal angular distance.
      const angle = minAngularDistanceToPolygon(cellPos.clone().normalize(), poly.map(v => v.clone().normalize()));
      if (angle < bestDistance) {
        bestDistance = angle;
        bestOverlay = overlay;
      }
    }
    // Define a threshold (in radians) for acceptable distance (e.g. 0.2 rad ~ 11.5°).
    const threshold = 0.2;
    if (bestOverlay && bestDistance < threshold) {
      console.log(`Cell id ${cell.id} assigned via fallback to constellation ${bestOverlay.userData.constellation} with angular distance ${bestDistance.toFixed(2)} rad.`);
      return bestOverlay.userData.constellation;
    }
  }
  return "Unknown";
}

/**
 * Returns the constellation for a given density cell.
 * This version relies solely on the overlay data.
 * If the cell’s globe projection does not fall within any overlay polygon,
 * a warning is logged and "Unknown" is returned.
 */
export function getConstellationForCell(cell) {
  const cons = getConstellationForCellUsingOverlay(cell);
  if (cons === "Unknown") {
    console.warn(`Cell id ${cell.id} did not fall inside any overlay polygon. Returning "Unknown".`);
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
 */
export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
