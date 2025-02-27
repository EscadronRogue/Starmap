// /filters/colorFilter.js

import { getStellarClassData } from './stellarClassData.js';

/**
 * Applies color filter to stars based on the selected filter.
 * Supported filters:
 *   - "stellar-class": Colors based on stellar class.
 *   - "constellation": Colors based on the star's "Constellation" field using a fixed mapping
 *                      that mimics the constellation overlay color logic.
 *   - "galactic-plane": Colors based on the star’s position relative to the galactic plane.
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
    // Use a fixed palette similar to the constellation overlay.
    const distinctPalette = [
      "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
      "#ffff33", "#a65628", "#f781bf", "#66c2a5", "#fc8d62",
      "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494",
      "#b3b3b3", "#1b9e77", "#d95f02", "#7570b3", "#e7298a"
    ];
    // Build a mapping from unique constellation names (uppercased) found in the star data.
    const constellationSet = new Set();
    stars.forEach(star => {
      if (star.Constellation) {
        constellationSet.add(star.Constellation.toUpperCase());
      }
    });
    const constellations = Array.from(constellationSet).sort();
    const colorMapping = {};
    constellations.forEach((constName, index) => {
      colorMapping[constName] = distinctPalette[index % distinctPalette.length];
    });
    // Apply the mapping to each star.
    stars.forEach(star => {
      const constKey = star.Constellation ? star.Constellation.toUpperCase() : '';
      star.displayColor = colorMapping[constKey] || '#FFFFFF';
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
