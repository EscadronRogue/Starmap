// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';

/**
 * Initializes the density overlay grid.
 *
 * @param {number} minDistance - Minimum distance to consider for density mapping.
 * @param {number} maxDistance - Maximum distance to consider for density mapping.
 * @param {Array} starArray - Array of star objects.
 * @param {string} mode - Either "isolation" (formerly low density) or "density" (formerly high density).
 * @param {number} [gridSize=2] - The base grid size (or starting value for adaptive subdivision).
 * @returns {DensityGridOverlay} - The initialized overlay.
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "isolation", gridSize = 2) {
  // Pass gridSize and mode into the overlay constructor.
  const grid = new DensityGridOverlay(minDistance, maxDistance, gridSize, mode);
  grid.createGrid(starArray);
  return grid;
}

/**
 * Updates the density mapping based on the provided star array using the given overlay.
 *
 * @param {Array} starArray - Array of star objects.
 * @param {DensityGridOverlay} gridOverlay - The density overlay instance to update.
 */
export function updateDensityMapping(starArray, gridOverlay) {
  if (!gridOverlay) return;
  gridOverlay.update(starArray);
}
