// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';
import { HighDensityTreeOverlay } from './densityTreeOverlay.js';

/**
 * Initializes the overlay.
 * - If mode="low", use the old grid approach.
 * - If mode="high", use the new octree approach.
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low", gridSize = 2) {
  if (mode === "low") {
    const grid = new DensityGridOverlay(minDistance, maxDistance, gridSize, mode);
    grid.createGrid(starArray);
    return grid;
  } else {
    const octree = new HighDensityTreeOverlay(minDistance, maxDistance, starArray);
    octree.createGrid();
    return octree;
  }
}

/** The update logic calls the overlay's `update()` method. */
export function updateDensityMapping(starArray, overlay) {
  if (!overlay) return;
  overlay.update(starArray);
}
