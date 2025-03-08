// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';

/**
 * Initializes the density overlay grid.
 * For mode "low" (the isolation filter) the original uniform grid method is used.
 * For mode "high" (the new density filter) an adaptive KD tree–style subdivision is used.
 *
 * @param {number} minDistance - Minimum distance (LY) to include grid cells.
 * @param {number} maxDistance - Maximum distance (LY) to include grid cells.
 * @param {Array} starArray - Array of star objects.
 * @param {string} mode - "low" for the isolation filter or "high" for the density filter.
 * @param {number} [gridSize=2] - The size of each grid cell (only used in low mode).
 * @returns {DensityGridOverlay} - The initialized grid overlay.
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low", gridSize = 2) {
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
