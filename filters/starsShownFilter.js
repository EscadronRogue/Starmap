// filters/starsShownFilter.js

/**
 * Filters stars based on "Stars Shown" filter: 'all' or 'visible'.
 * @param {Array} stars - Array of star objects.
 * @param {Object} filters - The overall filters object.
 * @returns {Array} - Filtered array of stars.
 */
export function applyStarsShownFilter(stars, filters) {
  let output = [...stars];
  if (filters.starsShown === 'visible') {
    output = output.filter(star => star.Apparent_magnitude <= 6);
  }
  return output;
}
