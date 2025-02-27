// filters/constellationOverlayFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Global object that will hold the constellation boundary data.
 * It maps a constellation name to an array of polygons.
 * Each polygon is represented as an array of points,
 * where each point is an object with { ra, dec } in degrees.
 */
export let constellationPolygons = {};

/**
 * Loads constellation boundaries from a text file and populates the
 * constellationPolygons object.
 *
 * The file is expected to have lines such as:
 *   010:011 P+ 00:52:00 +48:00:00 01:07:00 +48:00:00 AND CAS
 *
 * For simplicity, this example builds a polygon for each constellation by
 * adding each segment sequentially. In a real implementation you might want
 * to merge segments into proper closed polygons.
 */
export async function loadConstellationBoundaries() {
  try {
    const response = await fetch('constellation_boundaries.txt');
    if (!response.ok) throw new Error(`Failed to load constellation_boundaries.txt: ${response.status}`);
    const raw = await response.text();
    const lines = raw.split('\n').map(line => line.trim()).filter(line => line !== "");
    
    // Temporary structure: For each line, we use the segment’s endpoints
    lines.forEach(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 7) return;
      // parts[2] to parts[5] are the RA/Dec strings for the two endpoints.
      // The constellation name is in parts[6] and possibly further parts.
      const constName = parts.slice(6).join(" ");
      // Helper functions to convert string to degrees.
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
      
      // For this simple example, we treat each segment as a polygon with two distinct points.
      // (In practice, you would merge segments into a full closed boundary.)
      if (!constellationPolygons[constName]) {
        constellationPolygons[constName] = [];
      }
      // Here we store the segment as a two-point polygon.
      constellationPolygons[constName].push([point1, point2]);
    });
    console.log("Constellation boundaries loaded:", constellationPolygons);
  } catch (err) {
    console.error("Error loading constellation boundaries:", err);
  }
}

/**
 * A basic ray-casting point-in-polygon algorithm.
 * Expects:
 *   - point: an object { ra, dec } in degrees.
 *   - polygon: an array of points [{ ra, dec }, ...] in degrees.
 */
export function isPointInPolygon(point, polygon) {
  let x = point.ra, y = point.dec;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].ra, yi = polygon[i].dec;
    let xj = polygon[j].ra, yj = polygon[j].dec;
    let intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Creates and returns a THREE.Group that contains overlay meshes for each constellation.
 * For each constellation, it draws lines along the boundaries defined in constellationPolygons.
 * (This is a simplified version. In a production system you might draw filled meshes.)
 */
export function createConstellationOverlayForGlobe() {
  const overlayGroup = new THREE.Group();
  
  // Ensure that the boundaries are loaded.
  if (!constellationPolygons || Object.keys(constellationPolygons).length === 0) {
    console.warn("Constellation boundaries not loaded yet.");
    return overlayGroup;
  }
  
  // For each constellation, create a line for each polygon.
  for (const constName in constellationPolygons) {
    const polygons = constellationPolygons[constName];
    polygons.forEach(polygon => {
      // Convert each point in the polygon to a THREE.Vector3.
      // Here we use a simple projection: treat RA as x and Dec as y.
      // (In a real globe, you would project these points onto the sphere.)
      const points = polygon.map(pt => new THREE.Vector3(pt.ra, pt.dec, 0));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: 0x888888, linewidth: 2 });
      const line = new THREE.Line(geometry, material);
      overlayGroup.add(line);
    });
  }
  console.log("Constellation overlay for Globe created.");
  return overlayGroup;
}
