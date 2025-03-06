// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';
import { HighDensityTreeOverlay } from './densityTreeOverlay.js'; // NEW

/**
 * Initializes the density overlay grid (low-density) or tree (high-density).
 * @param {number} minDistance - Minimum distance to consider
 * @param {number} maxDistance - Maximum distance to consider
 * @param {Array} starArray
 * @param {string} mode - "low" or "high"
 * @param {number} [gridSize=2]
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low", gridSize = 2) {
  if (mode === "low") {
    // Original grid approach
    const grid = new DensityGridOverlay(minDistance, maxDistance, gridSize, mode);
    grid.createGrid(starArray);
    return grid;
  } else {
    // "high" => new tree approach
    const tree = new HighDensityTreeOverlay(minDistance, maxDistance, starArray);
    // we keep the same naming pattern, so let's call createGrid() just to be consistent
    tree.createGrid();
    return tree;
  }
}

/**
 * Calls the overlay's update method.
 */
export function updateDensityMapping(starArray, gridOverlay) {
  if (!gridOverlay) return;
  gridOverlay.update(starArray);
}
