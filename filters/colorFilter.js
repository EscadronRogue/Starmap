// /filters/colorFilter.js

import { getStellarClassData } from './stellarClassData.js';
import { computeConstellationColorMapping } from './constellationOverlayFilter.js';
import { generateConstellationColors } from '../utils.js';

/**
 * Applies color filter to stars based on the selected filter.
 * Supported filters:
 *   - "stellar-class": Color based on stellar class.
 *   - "constellation": Color based on the constellation overlay (using the "Constellation" field from the data).
 *   - "galactic-plane": Color based on position relative to the galactic plane.
 *   - (default): White.
 *
 * @param {Array} stars - Array of star objects.
 * @param {Object} filters - The current filters object.
 * @returns {Array} Updated array of star objects.
 */
export function applyColorFilter(stars, filters) {
  const stellarClassData = getStellarClassData();

  if (filters.color === 'stellar-class') {
    stars.forEach(star => {
      const primaryClass = star.Stellar_class ? star.Stellar_class.charAt(0).toUpperCase() : 'G';
      const classData = stellarClassData[primaryClass];
      star.displayColor = classData ? classData.color : '#FFFFFF';
    });
  } else if (filters.color === 'constellation') {
    const colorsMap = computeConstellationColorMapping();
    stars.forEach(star => {
      // Directly use the constellation provided in the data file.
      const constKey = star.Constellation ? star.Constellation.toUpperCase() : '';
      star.displayColor = colorsMap[constKey] || '#FFFFFF';
    });
  } else if (filters.color === 'galactic-plane') {
    const maxZ = Math.max(...stars.map(s => Math.abs(s.z_coordinate)));
    stars.forEach(star => {
      const factor = Math.abs(star.z_coordinate) / maxZ;
      if (star.z_coordinate < 0) {
        star.displayColor = interpolateHex('#ffffff', '#0000ff', factor);
      } else if (star.z_coordinate > 0) {
        star.displayColor = interpolateHex('#ffffff', '#ff0000', factor);
      } else {
        star.displayColor = '#ffffff';
      }
    });
  } else {
    stars.forEach(star => {
      if (!star.displayColor) {
        star.displayColor = '#FFFFFF';
      }
    });
  }
  return stars;
}

function interpolateHex(hex1, hex2, factor) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  const r = Math.round(c1.r + factor * (c2.r - c1.r));
  const g = Math.round(c1.g + factor * (c2.g - c1.g));
  const b = Math.round(c1.b + factor * (c2.b - c1.b));
  return rgbToHex(r, g, b);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  const componentToHex = c => c.toString(16).padStart(2, '0');
  return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
}
