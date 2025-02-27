// filters/constellationOverlayFilter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

// Global object mapping constellation names to an array of polygons (each polygon is an array of {ra, dec} points)
export let constellationPolygons = {};

/**
 * Loads constellation boundaries from a file and builds the constellationPolygons object.
 * Each line in the boundaries file has segments with start and end RA/Dec plus the constellation name.
 * For simplicity, here each segment is stored as a simple polygon with three points.
 */
export async function loadConstellationBoundaries() {
  try {
    const response = await fetch('constellation_boundaries.txt');
    if (!response.ok) throw new Error(`Failed to load constellation_boundaries.txt: ${response.status}`);
    const raw = await response.text();
    const lines = raw.split('\n').map(line => line.trim()).filter(line => line);
    lines.forEach(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 7) return;
      // For example, a line might be:
      // "010:011 P+ 00:52:00 +48:00:00 01:07:00 +48:00:00 AND CAS"
      const constellationName = parts.slice(6).join(" ");
      // Convert RA/Dec strings into degrees.
      function raStringToDeg(raStr) {
        const [h, m, s] = raStr.split(':').map(Number);
        return (h + m / 60 + s / 3600) * 15;
      }
      function decStringToDeg(decStr) {
        const sign = decStr.startsWith('-') ? -1 : 1;
        const [d, m, s] = decStr.replace('+','').split(':').map(Number);
        return sign * (d + m / 60 + s / 3600);
      }
      const point1 = { ra: raStringToDeg(parts[2]), dec: decStringToDeg(parts[3]) };
      const point2 = { ra: raStringToDeg(parts[4]), dec: decStringToDeg(parts[5]) };
      // For our purposes we treat each segment as a polygon (using three points so that our point‑in‑polygon test works)
      if (!constellationPolygons[constellationName]) {
        constellationPolygons[constellationName] = [];
      }
      constellationPolygons[constellationName].push([ point1, point2, point1 ]);
    });
    console.log("Loaded constellation boundaries:", constellationPolygons);
  } catch (err) {
    console.error("Error loading constellation boundaries:", err);
  }
}

/**
 * A basic point‑in‑polygon test using the ray‑casting algorithm.
 * Expects the polygon to be an array of points, each with {ra, dec} in degrees.
 */
export function isPointInPolygon(point, polygon) {
  let x = point.ra, y = point.dec;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].ra, yi = polygon[i].dec;
    let xj = polygon[j].ra, yj = polygon[j].dec;
    let intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.0000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
