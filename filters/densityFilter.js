// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';

/**
 * Initializes the density overlay grid.
 * @param {number} minDistance - Minimum distance to consider for density mapping.
 * @param {number} maxDistance - Maximum distance to consider for density mapping.
 * @param {Array} starArray - Array of star objects.
 * @param {string} mode - "low" or "high" (default "low").
 * @returns {DensityGridOverlay} - The initialized grid overlay.
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low") {
  const grid = new DensityGridOverlay(minDistance, maxDistance, 2, mode);
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
