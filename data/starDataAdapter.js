// data/starDataAdapter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Normalizes raw star data to have consistent property names.
 * 
 * For each star:
 * - Ensures `distance` exists (using `Distance_from_the_Sun` if missing).
 * - Ensures `ra` and `dec` (in radians) exist:
 *   - Uses `RA_in_radian`/`DEC_in_radian` if available,
 *   - Otherwise converts from `RA_in_degrees`/`DEC_in_degrees`.
 * - Ensures a Stellar_class exists (defaults to "G").
 *
 * @param {Array} stars - Array of raw star objects.
 * @returns {Array} - Array of normalized star objects.
 */
export function normalizeStarData(stars) {
  return stars.map(star => {
    const normalized = { ...star };

    // Normalize distance
    if (normalized.distance === undefined && normalized.Distance_from_the_Sun !== undefined) {
      normalized.distance = parseFloat(normalized.Distance_from_the_Sun);
    }

    // Normalize RA and DEC (in radians)
    if (normalized.RA_in_radian !== undefined && normalized.DEC_in_radian !== undefined) {
      normalized.ra = parseFloat(normalized.RA_in_radian);
      normalized.dec = parseFloat(normalized.DEC_in_radian);
    } else if (normalized.RA_in_degrees !== undefined && normalized.DEC_in_degrees !== undefined) {
      normalized.ra = THREE.Math.degToRad(parseFloat(normalized.RA_in_degrees));
      normalized.dec = THREE.Math.degToRad(parseFloat(normalized.DEC_in_degrees));
    } else {
      normalized.ra = 0;
      normalized.dec = 0;
    }

    // Ensure Stellar_class exists; default to 'G'
    if (!normalized.Stellar_class) {
      normalized.Stellar_class = 'G';
    }

    return normalized;
  });
}
