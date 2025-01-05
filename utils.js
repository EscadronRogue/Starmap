// utils.js

/**
 * Utility Functions for Starmap Visualization
 */

/**
 * Generates unique colors for each constellation.
 * @param {Array} stars - Array of star objects.
 * @returns {Object} - Mapping of constellation names to unique HEX colors.
 */
export function generateConstellationColors(stars) {
  const constellations = [...new Set(stars.map(star => star.Constellation))];
  const constellationColors = {};
  const colorPalette = generateColorPalette(constellations.length);

  constellations.forEach((constellation, index) => {
    constellationColors[constellation] = colorPalette[index];
  });

  return constellationColors;
}

/**
 * Generates a color palette with a specified number of unique colors.
 * @param {number} numColors - Number of unique colors to generate.
 * @returns {Array} - Array of HEX color strings.
 */
function generateColorPalette(numColors) {
  const palette = [];
  const hueStep = 360 / (numColors || 1);

  for (let i = 0; i < numColors; i++) {
    const hue = i * hueStep;
    const saturation = 70; // Percentage
    const lightness = 50; // Percentage
    palette.push(hslToHex(hue, saturation, lightness));
  }

  return palette;
}

/**
 * Converts HSL color to HEX format.
 * @param {number} h - Hue (0-360).
 * @param {number} s - Saturation (0-100).
 * @param {number} l - Lightness (0-100).
 * @returns {string} - HEX color string.
 */
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Interpolates between two HEX colors (which can be either '#rrggbb' strings or decimal numbers)
 * based on a factor (0..1).
 * @param {string|number} color1 - Starting color. Could be '#ffffff' or 0xffffff
 * @param {string|number} color2 - Ending color. Could be '#0000ff' or 0x0000ff
 * @param {number} factor - Interpolation factor in [0..1].
 * @returns {number} - Interpolated color as a decimal (e.g. 0xff9933).
 */
export function interpolateColor(color1, color2, factor) {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);

  const r = Math.round(c1.r + factor * (c2.r - c1.r));
  const g = Math.round(c1.g + factor * (c2.g - c1.g));
  const b = Math.round(c1.b + factor * (c2.b - c1.b));

  return (r << 16) + (g << 8) + b;
}

/**
 * Converts a HEX color (string or decimal) to an {r,g,b} object.
 * Example: '#ff00ff' => {r:255, g:0, b:255}
 * or decimal 0xff00ff => same result
 * @param {string|number} hex - The color, either a string (#rrggbb) or decimal (0xrrggbb).
 * @returns {Object} - { r, g, b }
 */
function hexToRgb(hex) {
  if (typeof hex === 'number') {
    // Convert the decimal color to a #rrggbb format
    // e.g., 0xff00ff => #ff00ff
    hex = '#' + hex.toString(16).padStart(6, '0');
  }

  // Now 'hex' is guaranteed to be a string
  // remove '#'
  const normalized = hex.replace('#','');
  const bigint = parseInt(normalized, 16);

  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return { r, g, b };
}

/**
 * Calculates the Euclidean distance between two stars.
 * @param {Object} starA - star with x,y,z
 * @param {Object} starB - star with x,y,z
 * @returns {number} - distance in LY
 */
export function calculateDistance(starA, starB) {
  const dx = starA.x_coordinate - starB.x_coordinate;
  const dy = starA.y_coordinate - starB.y_coordinate;
  const dz = starA.z_coordinate - starB.z_coordinate;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/**
 * Converts HEX color to RGBA string. e.g., (#ff00ff, 0.5) => 'rgba(255,0,255,0.5)'
 * @param {string} hex - the color
 * @param {number} opacity - in [0..1].
 * @returns {string} - RGBA
 */
export function hexToRGBA(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Resizes the canvas to fit its container.
 * @param {HTMLCanvasElement} canvas
 */
export function resizeCanvas(canvas) {
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
}

/**
 * minimalRADifference ensures RA stays in [-π, π]
 * @param {number} ra
 * @returns {number}
 */
export function minimalRADifference(ra) {
  while (ra > Math.PI) ra -= 2 * Math.PI;
  while (ra < -Math.PI) ra += 2 * Math.PI;
  return ra;
}
