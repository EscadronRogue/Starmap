// /filters/densityFilter.js

import { DensityGridOverlay } from './densityGridOverlay.js';
import { HighDensityTreeOverlay } from './densityTreeOverlay.js'; // new

/**
 * Initializes the density overlay.
 *   - If mode="low", do old DensityGridOverlay
 *   - If mode="high", do new HighDensityTreeOverlay
 */
export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low", gridSize = 2) {
  if (mode === "low") {
    const grid = new DensityGridOverlay(minDistance, maxDistance, gridSize, mode);
    grid.createGrid(starArray);
    return grid;
  } else {
    // new approach for high
    const tree = new HighDensityTreeOverlay(minDistance, maxDistance, starArray);
    tree.createGrid(); // build the 3D meshes from leaves
    return tree;
  }
}

export function updateDensityMapping(starArray, gridOverlay) {
  if (!gridOverlay) return;
  gridOverlay.update(starArray);
}
