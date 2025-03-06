import { DensityGridOverlay } from './densityGridOverlay.js';

export function initDensityOverlay(minDistance, maxDistance, starArray, mode = "low", gridSize = 2) {
  const overlay = new DensityGridOverlay(minDistance, maxDistance, gridSize, mode);
  overlay.createGrid(starArray);
  return overlay;
}

export function updateDensityMapping(starArray, overlay) {
  if (!overlay) return;
  overlay.update(starArray);
}
