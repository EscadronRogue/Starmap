// filters/opacityFilter.js

/**
 * Applies opacity-based filters to the stars array.
 * @param {Array} stars - The array of star objects.
 * @param {Object} filters - The overall filters object.
 * @returns {Array} - Updated array of stars.
 */
export function applyOpacityFilter(stars, filters) {
  if (filters.opacity === '75') {
    // Force 0.75
    stars.forEach(star => {
      star.displayOpacity = 0.75;
    });
  } else if (filters.opacity === 'absolute-magnitude') {
    // Exaggerate brightness
    const magnitudes = stars
      .map(star => star.Absolute_magnitude)
      .filter(m => m !== undefined);

    if (magnitudes.length > 0) {
      const minMag = Math.min(...magnitudes);
      const maxMag = Math.max(...magnitudes);

      const minOpacity = 0.1;
      const maxOpacity = 1.0;

      stars.forEach(star => {
        if (star.Absolute_magnitude !== undefined) {
          const normalizedMag = (star.Absolute_magnitude - minMag) / (maxMag - minMag);
          const opacity = maxOpacity - normalizedMag * (maxOpacity - minOpacity);
          star.displayOpacity = Math.max(minOpacity, Math.min(maxOpacity, opacity));
        } else {
          star.displayOpacity = 1.0;
        }
      });
    }
  } else {
    // Default
    stars.forEach(star => {
      if (typeof star.displayOpacity === 'undefined') {
        star.displayOpacity = 1.0;
      }
    });
  }

  return stars;
}
