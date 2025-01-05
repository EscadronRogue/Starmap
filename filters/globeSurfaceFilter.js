// filters/globeSurfaceFilter.js

/**
 * A new filter that toggles the Globe surface from transparent to opaque black.
 * We'll store a global boolean "globeSurfaceOpaque" here, so script.js can read it
 * and modify the sphere geometry as needed.
 */

export let globeSurfaceOpaque = false;

/**
 * applyGlobeSurfaceFilter:
 *  - Called by applyFilters in index.js.
 *  - We simply store a boolean in "globeSurfaceOpaque."
 */
export function applyGlobeSurfaceFilter(filters) {
  // If "globe-opaque-surface" is checked => filters.globeOpaqueSurface = true
  globeSurfaceOpaque = filters.globeOpaqueSurface;
}
