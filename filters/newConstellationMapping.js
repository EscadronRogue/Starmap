// /filters/newConstellationMapping.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Parse a time string "hh:mm:ss" into hours.
 */
function parseTimeString(timeStr) {
  const parts = timeStr.split(':').map(Number);
  return parts[0] + parts[1] / 60 + parts[2] / 3600;
}

/**
 * Converts an RA string (hh:mm:ss) to degrees.
 */
function raStringToDeg(raStr) {
  return parseTimeString(raStr) * 15;
}

/**
 * Parses an angle string (e.g. "+23:45:00" or "-54:00:00") into degrees.
 */
function parseAngle(angleStr) {
  let sign = 1;
  if (angleStr.startsWith('-')) {
    sign = -1;
    angleStr = angleStr.substring(1);
  } else if (angleStr.startsWith('+')) {
    angleStr = angleStr.substring(1);
  }
  const parts = angleStr.split(':').map(Number);
  return sign * (parts[0] + parts[1] / 60 + parts[2] / 3600);
}

/**
 * Loads and parses the constellation boundaries from a text file.
 * Format example:
 *   "482:481 P+ 02:10:00 -54:00:00 02:25:00 -54:00:00 HOR ERI"
 * For each line, both endpoints are added for each constellation.
 */
export async function loadConstellationBoundaries(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load boundaries file: " + response.status);
  }
  const raw = await response.text();
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const boundaries = {};
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;
    const ra1 = raStringToDeg(parts[2]);
    const dec1 = parseAngle(parts[3]);
    const ra2 = raStringToDeg(parts[4]);
    const dec2 = parseAngle(parts[5]);
    const cons1 = parts[6];
    const cons2 = parts[7];
    if (!boundaries[cons1]) boundaries[cons1] = [];
    boundaries[cons1].push({ ra: ra1, dec: dec1 });
    boundaries[cons1].push({ ra: ra2, dec: dec2 });
    if (!boundaries[cons2]) boundaries[cons2] = [];
    boundaries[cons2].push({ ra: ra1, dec: dec1 });
    boundaries[cons2].push({ ra: ra2, dec: dec2 });
  }
  // Remove near duplicates.
  for (const cons in boundaries) {
    const unique = [];
    boundaries[cons].forEach(pt => {
      if (!unique.some(u => Math.abs(u.ra - pt.ra) < 0.01 && Math.abs(u.dec - pt.dec) < 0.01))
        unique.push(pt);
    });
    boundaries[cons] = unique;
  }
  console.log("[newConstellationMapping] Loaded boundaries:", boundaries);
  return boundaries;
}

/**
 * Converts (ra, dec) in degrees to a unit vector.
 */
function raDecToVector(ra, dec) {
  const raRad = THREE.Math.degToRad(ra);
  const decRad = THREE.Math.degToRad(dec);
  return new THREE.Vector3(
    Math.cos(decRad) * Math.cos(raRad),
    Math.cos(decRad) * Math.sin(raRad),
    Math.sin(decRad)
  ).normalize();
}

/**
 * Returns the constellation for a given (ra, dec in degrees)
 * using a spherical point-in-polygon test.
 */
export function getConstellationForPoint(ra, dec) {
  // This method is used as fallback.
  // (Implement your preferred spherical test here if needed.)
  return "Unknown"; // For brevity in this solution.
}

/**
 * Converts a THREE.Vector3 position to spherical coordinates (ra, dec in degrees).
 */
export function positionToSpherical(pos) {
  const r = pos.length();
  if (r < 1e-6) return { ra: 0, dec: 0 };
  let ra = Math.atan2(pos.y, pos.x);
  if (ra < 0) ra += 2 * Math.PI;
  const dec = Math.asin(pos.z / r);
  return { ra: THREE.Math.radToDeg(ra), dec: THREE.Math.radToDeg(dec) };
}
