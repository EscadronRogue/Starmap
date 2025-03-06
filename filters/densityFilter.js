// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';

/**
 * Initializes the density overlay grid.
 * @param {number} minDistance - Minimum distance to consider for density mapping.
 * @param {number} maxDistance - Maximum distance to consider for density mapping.
 * @param {Array} starArray - Array of star objects.
 * @param {string} mode - "low" or "high" (default "low").
 * @param {number} [gridSize=2] - The size of each grid cell. (New slider-based value)
 * @returns {DensityGridOverlay} - The initialized grid overlay.
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low", gridSize = 2) {
  // We now pass gridSize into the constructor instead of always using 2
  const grid = new DensityGridOverlay(minDistance, maxDistance, gridSize, mode);
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
