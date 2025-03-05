// /filters/distanceFilter.js

/**
 * Filters stars based on their distance.
 * Only stars with a valid distance (from the Sun) between minDistance and maxDistance (in light years) are kept.
 * 
 * It supports both the legacy property 'Distance_from_the_Sun' and the new property 'distance'.
 *
 * @param {Array} stars - Array of star objects.
 * @param {Object} filters - The filters object that should include minDistance and maxDistance.
 * @returns {Array} - Filtered array of stars.
 */
export function applyDistanceFilter(stars, filters) {
  // Default values: show stars from 0 to 20 LY.
  const minDist = filters.minDistance !== null && filters.minDistance !== undefined
    ? parseFloat(filters.minDistance)
    : 0;
  const maxDist = filters.maxDistance !== null && filters.maxDistance !== undefined
    ? parseFloat(filters.maxDistance)
    : 20;
  return stars.filter(star => {
    // Use the new 'distance' property if available, otherwise fall back to legacy 'Distance_from_the_Sun'
    const distance = star.distance !== undefined ? star.distance : star.Distance_from_the_Sun;
    if (distance === undefined) return false;
    return distance >= minDist && distance <= maxDist;
  });
}
