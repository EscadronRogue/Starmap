// /filters/constellationOverlayFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Global object storing each constellation's polygons for boundary checks.
 * Example structure:
 * {
 *   "AND": [ [ {ra, dec}, {ra, dec}, ...], [...], ... ],
 *   "CAS": [ ... ],
 *   ...
 * }
 */
export let constellationPolygons = {};

/**
 * Loads constellation boundaries from "constellation_boundaries.txt".
 * For each line, parse the RA/Dec start & end, plus the constellation name(s),
 * and build an array of polygon segments. This data is used by the overlay
 * (and also for naming cells in the density segmentation if you want).
 */
export async function loadConstellationBoundaries() {
  try {
    const response = await fetch('constellation_boundaries.txt');
    if (!response.ok) throw new Error(`Failed to load constellation_boundaries.txt: ${response.status}`);
    const raw = await response.text();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);

    // Helper to parse RA "HH:MM:SS" into degrees
    function raStringToDeg(raStr) {
      const [hh, mm, ss] = raStr.split(':').map(Number);
      return (hh + mm / 60 + ss / 3600) * 15;
    }
    // Helper to parse Dec "+DD:MM:SS" into degrees
    function decStringToDeg(decStr) {
      const sign = decStr.startsWith('-') ? -1 : 1;
      const stripped = decStr.replace('+','').replace('-','');
      const [dd, mm, ss] = stripped.split(':').map(Number);
      return sign * (dd + mm/60 + ss/3600);
    }

    constellationPolygons = {};

    // For each boundary line, we’ll create a minimal “triangle” polygon out of 3 points
    lines.forEach(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 7) return;
      // Example line:
      // 010:011 P+ 00:52:00 +48:00:00 01:07:00 +48:00:00 AND CAS
      // We skip the first 2-3 pieces, parse the next 4 for RA/Dec, then read the last part for the name(s).
      
      const raDegStart = raStringToDeg(parts[2]);
      const decDegStart = decStringToDeg(parts[3]);
      const raDegEnd   = raStringToDeg(parts[4]);
      const decDegEnd  = decStringToDeg(parts[5]);
      
      // The last part(s) typically includes two constellations, e.g. "AND CAS",
      // but many lines might just have one. We'll combine them into a single string and treat as a key:
      const name = parts.slice(6).join(" "); 
      // You might have lines like "AND CAS" if the segment is a boundary between two constellations,
      // so you may want to store polygons under both constellation codes. 
      // For simplicity, let's store them in a single key. Or you can parse further if needed.

      if (!constellationPolygons[name]) {
        constellationPolygons[name] = [];
      }

      // We'll build a minimal polygon with 3 points, so that a point‑in‑polygon check can be done.
      // In a real usage, you'd build an entire polygon from multiple segments. 
      // But for demonstration, we treat each line as a tri from start->end->start again.
      const pointA = { ra: raDegStart, dec: decDegStart };
      const pointB = { ra: raDegEnd,   dec: decDegEnd };
      
      // We'll just create a polygon with points [pointA, pointB, pointA].
      // A real approach might link segments together into bigger polygons, but this is a minimal example.
      constellationPolygons[name].push([ pointA, pointB, pointA ]);
    });

    console.log("Loaded constellation boundaries. Constellation Polygons:", constellationPolygons);

  } catch (err) {
    console.error("Error loading constellation boundaries:", err);
    constellationPolygons = {};
  }
}

/**
 * Simple point-in-polygon test on a *flat* RA/Dec plane (not entirely accurate for large polygons on a sphere).
 * But it's enough for smaller boundary segments if they've been subdivided.
 */
export function isPointInPolygon(point, polygon) {
  // point is { ra, dec }, polygon is array of points { ra, dec } 
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].ra, yi = polygon[i].dec;
    const xj = polygon[j].ra, yj = polygon[j].dec;
    const xk = point.ra,      yk = point.dec;
    
    const intersect = ((yi > yk) !== (yj > yk)) &&
      (xk < (xj - xi) * (yk - yi) / ((yj - yi) || 0.00000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * createConstellationOverlayForGlobe:
 *   The function your index.js references. 
 *   Typically, it returns an array of meshes that visually overlay the constellation polygons on the globe.
 *   Here’s a minimal stub that just returns an empty array, so you won’t get the import error.
 *   (If you want the real overlay, you can adapt your older code that draws lines or surfaces.)
 */
export function createConstellationOverlayForGlobe() {
  console.log("createConstellationOverlayForGlobe() - minimal stub. Returning an empty array of meshes...");
  return []; 
  // In a real usage, you would build three.js objects for each boundary and return them.
}
