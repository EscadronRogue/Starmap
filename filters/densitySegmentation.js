// /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getIndividualBlueColor } from './densityColorUtils.js';
import { loadDensityCenterData, getDensityCenterData } from './densityData.js';
import { getConstellationForPoint, positionToSpherical } from './newConstellationMapping.js';

/**
 * Helper: Standard 2D ray-casting point-in-polygon test.
 * point: {x, y}; vs: array of vertices {x, y}.
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
 * Projects a THREE.Vector3 onto a plane defined by a center, tangent, and bitangent.
 * Returns an object with {x, y}.
 */
function projectToPlane(pos, center, tangent, bitangent) {
  const diff = new THREE.Vector3().subVectors(pos, center);
  return {
    x: diff.dot(tangent),
    y: diff.dot(bitangent)
  };
}

/**
 * Computes the centroid (average) of an array of THREE.Vector3.
 */
function computeCentroidFromVertices(vertices) {
  const centroid = new THREE.Vector3(0, 0, 0);
  vertices.forEach(v => centroid.add(v));
  centroid.divideScalar(vertices.length);
  return centroid;
}

/**
 * Attempts to determine the constellation for a cell using the globe overlay zones.
 * Assumes that window.constellationOverlayGlobe is an array of THREE.Mesh overlays
 * each with userData.polygon (an ordered array of THREE.Vector3) and userData.constellation.
 */
function getConstellationForCellUsingOverlay(cell) {
  if (!cell.globeMesh || !cell.globeMesh.position) return "Unknown";
  const cellPos = cell.globeMesh.position;
  if (window.constellationOverlayGlobe && window.constellationOverlayGlobe.length > 0) {
    for (const overlay of window.constellationOverlayGlobe) {
      if (!overlay.userData || !overlay.userData.polygon) continue;
      const poly = overlay.userData.polygon; // Array of THREE.Vector3
      // Compute centroid of the polygon.
      const centroid = computeCentroidFromVertices(poly);
      // Define a tangent plane at the centroid.
      const normal = centroid.clone().normalize();
      let tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) tangent = new THREE.Vector3(1, 0, 0);
      tangent.sub(normal.clone().multiplyScalar(normal.dot(tangent))).normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      // Project each polygon vertex onto the plane.
      const poly2D = poly.map(v => projectToPlane(v, centroid, tangent, bitangent));
      // Project the cell position onto the same plane.
      const cell2D = projectToPlane(cellPos, centroid, tangent, bitangent);
      // Check if the cell falls inside the polygon.
      if (pointInPolygon2D(cell2D, poly2D)) {
        console.log(`Cell id ${cell.id} is inside overlay for constellation ${overlay.userData.constellation}`);
        return overlay.userData.constellation;
      }
    }
  }
  return "Unknown";
}

/**
 * Computes the angular distance (in degrees) between two points (ra, dec) in degrees.
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
 * Returns the constellation for a given density cell.
 * First, it checks whether the cell's globe projection falls within any overlay zone.
 * If not, it falls back to the spherical method (using newConstellationMapping.js),
 * and then to density center data if necessary.
 */
export function getConstellationForCell(cell) {
  let cons = getConstellationForCellUsingOverlay(cell);
  if (cons !== "Unknown") return cons;
  
  // Fallback: use the spherical method.
  const pos = cell.spherePosition ? cell.spherePosition : cell.tcPos;
  if (!pos) return "Unknown";
  const spherical = positionToSpherical(pos);
  cons = getConstellationForPoint(spherical.ra, spherical.dec);
  if (cons !== "Unknown") return cons;
  
  // Final fallback: density center data.
  const centers = getDensityCenterData();
  if (centers && centers.length > 0) {
    let minDist = Infinity;
    let bestCons = "Unknown";
    centers.forEach(center => {
      const centerRA = THREE.Math.radToDeg(center.ra);
      const centerDec = THREE.Math.radToDeg(center.dec);
      const d = angularDistance(spherical.ra, spherical.dec, centerRA, centerDec);
      console.log(`Distance from cell id ${cell.id} to center ${center.name}: ${d.toFixed(2)}°`);
      if (d < minDist) {
        minDist = d;
        bestCons = center.name;
      }
    });
    cons = bestCons;
  }
  return cons;
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
 * Computes connected components among the active cells.
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
 * Finds the cell most “interconnected” with its neighbors.
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
 * If the majority vote is "Unknown" but some cells have valid labels, the best available non-"Unknown" label is chosen.
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
    for (const cons in volumeByConstellation) {
      if (cons !== "Unknown" && volumeByConstellation[cons] > 0) {
        majority = cons;
        break;
      }
    }
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
