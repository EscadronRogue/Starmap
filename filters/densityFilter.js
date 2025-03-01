// filters/densityfilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';

let densityGrid = null;

/**
 * Initializes the density overlay grid.
 * @param {number} maxDistance - Maximum distance for grid cells.
 * @param {Array} starArray - Array of star objects.
 * @returns {DensityGridOverlay} - The initialized grid overlay.
 */
export function initDensityOverlay(maxDistance, starArray) {
  densityGrid = new DensityGridOverlay(maxDistance, 2);
  densityGrid.createGrid(starArray);
  return densityGrid;
}

/**
 * Updates the density mapping based on the provided star array.
 * @param {Array} starArray - Array of star objects.
 */
export function updateDensityMapping(starArray) {
  if (!densityGrid) return;
  densityGrid.update(starArray);
}
