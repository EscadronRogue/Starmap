// filters/globeSurfaceFilter.js

/**
 * A filter that toggles the Globe surface from transparent to opaque black.
 * The global boolean "globeSurfaceOpaque" is now set to true by default.
 */

export let globeSurfaceOpaque = true; // ON by default

/**
 * applyGlobeSurfaceFilter:
 *  - Called by applyFilters in index.js.
 *  - Simply stores the boolean value from the filters.
 */
export function applyGlobeSurfaceFilter(filters) {
  globeSurfaceOpaque = filters.globeOpaqueSurface;
}
