/**
 * Filters stars based on their Distance_from_the_Sun.
 * Only stars with Distance_from_the_Sun between minDistance and maxDistance (in light years) are kept.
 *
 * @param {Array} stars - Array of star objects.
 * @param {Object} filters - The filters object that should include minDistance and maxDistance.
 * @returns {Array} - Filtered array of stars.
 */
export function applyDistanceFilter(stars, filters) {
  // Default values: show stars from 0 to 100 LY.
  const minDist = filters.minDistance !== null && filters.minDistance !== undefined
    ? parseFloat(filters.minDistance)
    : 0;
  const maxDist = filters.maxDistance !== null && filters.maxDistance !== undefined
    ? parseFloat(filters.maxDistance)
    : 100;
  return stars.filter(star => {
    if (star.Distance_from_the_Sun === undefined) return false;
    return star.Distance_from_the_Sun >= minDist && star.Distance_from_the_Sun <= maxDist;
  });
}
