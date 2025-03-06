// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';
import { HighDensityTreeOverlay } from './densityTreeOverlay.js';

/**
 * Initializes the density overlay.
 * If mode === "low", use the grid‐based overlay.
 * If mode === "high", use the new octree‐based overlay.
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

export function updateDensityMapping(starArray, overlay) {
  if (!overlay) return;
  overlay.update(starArray);
}
