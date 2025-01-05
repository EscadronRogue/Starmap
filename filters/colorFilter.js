// filters/colorFilter.js

import { generateConstellationColors, interpolateColor } from '../utils.js';
import { getStellarClassData } from './stellarClassData.js';

/**
 * We rework the "galactic-plane" logic with a simpler function:
 * computeGalacticColor(zVal, maxZ).
 */

function computeGalacticColor(zVal, maxZ) {
  // Range of zVal is [-maxZ, +maxZ].
  // normalized => [0..1].
  if (maxZ <= 0) return '#FFFFFF'; // fallback

  const frac = Math.min(Math.abs(zVal)/maxZ, 1); 
  // If zVal>0 => white->red, if zVal<0 => white->blue, else white.

  if (zVal > 0) {
    // #FFFFFF => #FF0000
    const colorDecimal = interpolateColor(0xffffff, 0xff0000, frac);
    return '#' + colorDecimal.toString(16).padStart(6, '0');
  } else if (zVal < 0) {
    // #FFFFFF => #0000FF
    const colorDecimal = interpolateColor(0xffffff, 0x0000ff, frac);
    return '#' + colorDecimal.toString(16).padStart(6, '0');
  } else {
    // exactly on plane => white
    return '#FFFFFF';
  }
}

export function applyColorFilter(stars, filters) {
  const stellarClassData = getStellarClassData();

  if (filters.color === 'constellation') {
    // per constellation
    const colorsMap = generateConstellationColors(stars);
    stars.forEach(star => {
      star.displayColor = colorsMap[star.Constellation] || '#FFFFFF';
    });

  } else if (filters.color === 'galactic-plane') {
    // reworked logic
    const maxZ = Math.max(...stars.map(s => Math.abs(s.z_coordinate)));
    stars.forEach(star => {
      const zVal = star.z_coordinate || 0;
      star.displayColor = computeGalacticColor(zVal, maxZ);
    });

  } else if (filters.color === 'stellar-class') {
    // from stellar_class.json
    stars.forEach(star => {
      let pClass = 'G';
      if (star.Stellar_class && typeof star.Stellar_class === 'string') {
        pClass = star.Stellar_class.charAt(0).toUpperCase();
      }
      const cData = stellarClassData[pClass];
      const colorHex = cData ? cData.color : '#FFFFFF';
      star.displayColor = colorHex;
    });

  } else {
    // default
    stars.forEach(star => {
      if (!star.displayColor) {
        star.displayColor = '#FFFFFF';
      }
    });
  }

  return stars;
}
