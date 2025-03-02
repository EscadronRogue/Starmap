// filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';

/**
 * Initializes the density overlay grid.
 * @param {number} maxDistance - Maximum distance for grid cells.
 * @param {Array} starArray - Array of star objects.
 * @param {string} mode - "low" or "high" (default "low").
 * @returns {DensityGridOverlay} - The initialized grid overlay.
 */
export function initDensityOverlay(maxDistance, starArray, mode = "low") {
  const grid = new DensityGridOverlay(maxDistance, 2, mode);
  grid.createGrid(starArray);
  return grid;
}

/**
 * Updates the density mapping based on the provided star array using the given overlay.
 * @param {Array} starArray - Array of star objects.
 * @param {DensityGridOverlay} gridOverlay - The density overlay instance to update.
 */
export function updateDensityMapping(starArray, gridOverlay) {
  if (!gridOverlay) return;
  gridOverlay.update(starArray);
}
