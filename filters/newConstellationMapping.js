// /filters/newConstellationMapping.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Utility: Parse a time string "hh:mm:ss" into hours.
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
 * Each line should be in the format (example):
 *   "482:481 P+ 02:10:00 -54:00:00 02:25:00 -54:00:00 HOR ERI"
 *
 * For each line, both endpoint coordinates are added to the boundary for both listed constellations.
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
  // Remove near-duplicates from each constellation’s set.
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
 * Converts (ra, dec) in degrees to a THREE.Vector3 unit vector.
 */
function raDecToVector(ra, dec) {
  const raRad = THREE.Math.degToRad(ra);
  const decRad = THREE.Math.degToRad(dec);
  return new THREE.Vector3(Math.cos(decRad) * Math.cos(raRad), Math.cos(decRad) * Math.sin(raRad), Math.sin(decRad)).normalize();
}

/**
 * Spherical point-in-polygon test using the winding number method.
 * polygon: array of vertices {ra, dec} (in degrees).
 * point: {ra, dec} in degrees.
 * Returns true if the winding sum is close to 2π.
 */
function isPointInSphericalPolygon(point, polygon, tolerance = 0.2) {
  const pVec = raDecToVector(point.ra, point.dec);
  let totalAngle = 0;
  const n = polygon.length;
  if (n < 3) return false;
  // Convert polygon vertices to unit vectors.
  const verts = polygon.map(pt => raDecToVector(pt.ra, pt.dec));
  for (let i = 0; i < n; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    // Compute the angle between (v1 and v2) as seen from pVec.
    // Using atan2 formulation:
    const angle = Math.atan2(v1.clone().cross(v2).dot(pVec), v1.dot(v2) - pVec.dot(v1) * pVec.dot(v2));
    totalAngle += angle;
  }
  // Debug: log the winding angle for this polygon.
  // console.log(`Winding angle for point (${point.ra.toFixed(2)},${point.dec.toFixed(2)}) in polygon:`, totalAngle);
  return Math.abs(Math.abs(totalAngle) - 2 * Math.PI) < tolerance;
}

// Global variable holding the constellation polygons.
export let constellationPolygons = {};

/**
 * Initializes constellation polygons by loading the boundaries file.
 */
export async function initConstellationPolygons(url) {
  constellationPolygons = await loadConstellationBoundaries(url);
  console.log("[newConstellationMapping] Constellation polygons initialized.");
}

/**
 * Returns the constellation label for a given point (ra, dec in degrees)
 * by testing against each constellation polygon using our spherical point-in-polygon test.
 */
export function getConstellationForPoint(ra, dec) {
  for (const cons in constellationPolygons) {
    const poly = constellationPolygons[cons];
    if (poly.length < 3) continue;
    if (isPointInSphericalPolygon({ ra, dec }, poly)) {
      // Debug: log when a match is found.
      // console.log(`Point (${ra.toFixed(2)}, ${dec.toFixed(2)}) inside ${cons}`);
      return cons;
    }
  }
  return "Unknown";
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
