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
 * @param {Array} polygon - Array of THREE.Vector3 vertices (each assumed to be on radius 100)
 * @returns {number} - The smallest angular distance (in radians)
 */
function minAngularDistanceToVertices(cellPos, polygon) {
  let minAngle = Infinity;
  // Ensure cellPos is normalized to sphere radius (100)
  const cellNorm = cellPos.clone().setLength(100);
  polygon.forEach(vertex => {
    // Normalize vertex to radius 100 for consistency.
    const v = vertex.clone().setLength(100);
    const angle = cellNorm.angleTo(v);
    if (angle < minAngle) {
      minAngle = angle;
    }
  });
  return minAngle;
}

/**
 * New: Determines the constellation for a given cell by simply finding the overlay
 * whose boundary (any vertex) is closest in angular distance to the cell's globe position.
 * This way every cell is assigned based on the nearest overlay rather than strictly being “inside.”
 */
function getConstellationForCellUsingOverlay(cell) {
  if (!cell.globeMesh || !cell.globeMesh.position) {
    throw new Error(`Cell id ${cell.id} is missing a valid globeMesh position.`);
  }
  // Project cell's position onto a sphere of radius 100.
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
      console.log(`Cell id ${cell.id} assigned to constellation ${bestOverlay.userData.constellation} (min angular distance = ${bestDistance.toFixed(2)} rad).`);
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

// --- The rest of your file (connected components, segmentation, centroid, etc.) remains unchanged ---
