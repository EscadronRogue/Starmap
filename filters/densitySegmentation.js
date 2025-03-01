// /filters/densitySegmentation.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getIndividualBlueColor } from './densityColorUtils.js';
import { getDensityCenterData } from './densityData.js';
import { positionToSpherical, getConstellationForPoint } from './newConstellationMapping.js';

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
 * New: Determines the constellation for a given cell by choosing the overlay
 * whose boundary (any vertex) is closest in angular distance to the cell's globe position.
 * This method does not require the cell to be strictly inside the polygon.
 * @param {Object} cell - A density cell that has a globeMesh with a valid position.
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

/* ----- The remainder of your file (connected components, segmentation, centroid, etc.) remains unchanged ----- */

export function assignDistinctColorsToIndependent(regions) {
  regions.forEach(region => {
    region.color = getIndividualBlueColor(region.clusterId + region.constName + region.type);
  });
}
