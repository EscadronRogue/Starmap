// filters/colorFilter.js

import { getStellarClassData } from './stellarClassData.js';
// NEW: Use the same constellation color mapping as in the overlay filter.
import { computeConstellationColorMapping } from './constellationOverlayFilter.js';
import { generateConstellationColors } from '../utils.js';

/**
 * Applies the selected color filter to the star objects.
 * Supported filters:
 *   - "stellar-class": Colors from stellar_class.json.
 *   - "constellation": Stars get the color of their constellation zone.
 *   - "galactic-plane": Colors based on distance from the galactic plane.
 *   - (default): Fallback to white.
 *
 * @param {Array} stars - The array of star objects.
 * @param {Object} filters - The current filters settings.
 * @returns {Array} - The updated star objects.
 */
export function applyColorFilter(stars, filters) {
  const stellarClassData = getStellarClassData();

  if (filters.color === 'stellar-class') {
    stars.forEach(star => {
      let pClass = 'G';
      if (star.Stellar_class && typeof star.Stellar_class === 'string') {
        pClass = star.Stellar_class.charAt(0).toUpperCase();
      }
      const cData = stellarClassData[pClass];
      let colorValue = cData ? cData.color : '#FFFFFF';
      colorValue = normalizeColor(colorValue);
      star.displayColor = colorValue;
    });
  } else if (filters.color === 'constellation') {
    const colorsMap = computeConstellationColorMapping();
    stars.forEach(star => {
      let colorValue = colorsMap[star.Constellation] || '#FFFFFF';
      colorValue = normalizeColor(colorValue);
      star.displayColor = colorValue;
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

function normalizeColor(colorValue) {
  if (typeof colorValue === 'number') {
    return '#' + colorValue.toString(16).padStart(6, '0');
  }
  if (typeof colorValue === 'string') {
    colorValue = colorValue.trim();
    if (colorValue[0] !== '#') {
      return '#' + colorValue;
    }
    return colorValue;
  }
  return '#FFFFFF';
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
