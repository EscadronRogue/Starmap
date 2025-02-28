// /filters/newConstellationMapping.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Parses a time string "hh:mm:ss" into hours.
 */
function parseTimeString(timeStr) {
  const parts = timeStr.split(':').map(Number);
  return parts[0] + parts[1] / 60 + parts[2] / 3600;
}

/**
 * Converts a time string to degrees (hours × 15).
 */
function timeToDegrees(timeStr) {
  return parseTimeString(timeStr) * 15;
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
 * Each line is expected to have the format:
 *   "482:481 P+ 02:10:00 -54:00:00 02:25:00 -54:00:00 HOR ERI"
 */
export async function loadConstellationBoundaries(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load boundaries file: " + response.status);
  }
  const raw = await response.text();
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const segments = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;
    const pOrM = parts[1]; // e.g. "P+" or "M+"
    const raStr1 = parts[2];
    const decStr1 = parts[3];
    const raStr2 = parts[4];
    const decStr2 = parts[5];
    const const1 = parts[6];
    const const2 = parts[7];
    const segment = {
      ra1: timeToDegrees(raStr1),  // in degrees
      dec1: parseAngle(decStr1),   // in degrees
      ra2: timeToDegrees(raStr2),
      dec2: parseAngle(decStr2),
      const1,
      const2,
      mode: pOrM
    };
    segments.push(segment);
  }
  return segments;
}

/**
 * Groups all segments by constellation. For every segment, both endpoints are added
 * under each constellation label.
 */
function groupSegmentsByConstellation(segments) {
  const groups = {};
  segments.forEach(seg => {
    if (seg.const1) {
      if (!groups[seg.const1]) groups[seg.const1] = [];
      groups[seg.const1].push({ ra: seg.ra1, dec: seg.dec1 });
      groups[seg.const1].push({ ra: seg.ra2, dec: seg.dec2 });
    }
    if (seg.const2) {
      if (!groups[seg.const2]) groups[seg.const2] = [];
      groups[seg.const2].push({ ra: seg.ra1, dec: seg.dec1 });
      groups[seg.const2].push({ ra: seg.ra2, dec: seg.dec2 });
    }
  });
  // For each constellation, remove near‐duplicate points and sort them.
  const polygons = {};
  for (const cons in groups) {
    const pts = groups[cons];
    const uniquePts = [];
    pts.forEach(pt => {
      if (!uniquePts.some(up => Math.abs(up.ra - pt.ra) < 0.01 && Math.abs(up.dec - pt.dec) < 0.01)) {
        uniquePts.push(pt);
      }
    });
    uniquePts.sort((a, b) => (a.ra === b.ra ? a.dec - b.dec : a.ra - b.ra));
    polygons[cons] = uniquePts;
  }
  return polygons;
}

/**
 * Computes the centroid of a polygon (array of {ra, dec} in degrees) by averaging
 * the corresponding unit vectors.
 */
function computeCentroid(polygon) {
  let sumX = 0, sumY = 0, sumZ = 0;
  polygon.forEach(pt => {
    const raRad = THREE.Math.degToRad(pt.ra);
    const decRad = THREE.Math.degToRad(pt.dec);
    const x = Math.cos(decRad) * Math.cos(raRad);
    const y = Math.cos(decRad) * Math.sin(raRad);
    const z = Math.sin(decRad);
    sumX += x; sumY += y; sumZ += z;
  });
  const len = polygon.length;
  const cx = sumX / len, cy = sumY / len, cz = sumZ / len;
  const r = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const ra = Math.atan2(cy, cx);
  const dec = Math.asin(cz / r);
  return { ra: THREE.Math.radToDeg(ra), dec: THREE.Math.radToDeg(dec) };
}

/**
 * Projects the polygon points onto a tangent plane (using a gnomonic projection)
 * centered at the polygon’s centroid.
 */
function projectPolygon(polygon, centroid) {
  const ra0 = THREE.Math.degToRad(centroid.ra);
  const dec0 = THREE.Math.degToRad(centroid.dec);
  const projected = polygon.map(pt => {
    const ra = THREE.Math.degToRad(pt.ra);
    const dec = THREE.Math.degToRad(pt.dec);
    const cosc = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
    const x = (Math.cos(dec) * Math.sin(ra - ra0)) / cosc;
    const y = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosc;
    return { x, y, orig: pt };
  });
  return projected;
}

/**
 * Triangulates a simple polygon (in 2D) via ear clipping.
 * The input polygon is an array of objects {x, y, orig}, where orig holds the original {ra, dec}.
 */
function triangulatePolygon(polygon) {
  let vertices = polygon.slice(); // copy array
  const triangles = [];
  function isConvex(a, b, c) {
    return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 0;
  }
  function pointInTriangle(p, a, b, c) {
    const areaOrig = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    const area1 = Math.abs((a.x - p.x) * (b.y - p.y) - (b.x - p.x) * (a.y - p.y));
    const area2 = Math.abs((b.x - p.x) * (c.y - p.y) - (c.x - p.x) * (b.y - p.y));
    const area3 = Math.abs((c.x - p.x) * (a.y - p.y) - (a.x - p.x) * (c.y - p.y));
    return Math.abs(area1 + area2 + area3 - areaOrig) < 1e-6;
  }
  while (vertices.length > 3) {
    let earFound = false;
    for (let i = 0; i < vertices.length; i++) {
      const prev = vertices[(i - 1 + vertices.length) % vertices.length];
      const curr = vertices[i];
      const next = vertices[(i + 1) % vertices.length];
      if (!isConvex(prev, curr, next)) continue;
      let hasPointInside = false;
      for (let j = 0; j < vertices.length; j++) {
        if (j === (i - 1 + vertices.length) % vertices.length || j === i || j === (i + 1) % vertices.length) continue;
        if (pointInTriangle(vertices[j], prev, curr, next)) {
          hasPointInside = true;
          break;
        }
      }
      if (!hasPointInside) {
        triangles.push([prev.orig, curr.orig, next.orig]);
        vertices.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      // Fallback: use a triangle fan
      for (let i = 1; i < vertices.length - 1; i++) {
        triangles.push([vertices[0].orig, vertices[i].orig, vertices[i + 1].orig]);
      }
      vertices = [];
    }
  }
  if (vertices.length === 3) {
    triangles.push([vertices[0].orig, vertices[1].orig, vertices[2].orig]);
  }
  return triangles;
}

/**
 * Builds an array of triangles (with bounding boxes) for each constellation.
 * The input is an object mapping constellation labels to a polygon (array of {ra, dec}).
 */
function buildTriangles(polygons) {
  const triangles = [];
  for (const cons in polygons) {
    const poly = polygons[cons];
    if (poly.length < 3) continue;
    const centroid = computeCentroid(poly);
    const projected = projectPolygon(poly, centroid);
    const tris = triangulatePolygon(projected);
    tris.forEach(tri => {
      const ras = tri.map(pt => pt.ra);
      const decs = tri.map(pt => pt.dec);
      const bbox = {
        minRA: Math.min(...ras),
        maxRA: Math.max(...ras),
        minDec: Math.min(...decs),
        maxDec: Math.max(...decs)
      };
      triangles.push({
        constellation: cons,
        vertices: tri, // each vertex: {ra, dec} in degrees
        bbox
      });
    });
  }
  return triangles;
}

// Global variable storing the built triangle array.
let constellationTriangles = [];

/**
 * Initializes the constellation mapping.
 * Loads the boundaries from the provided URL, groups segments into polygons,
 * triangulates each polygon, and builds a fast‐lookup structure.
 */
export async function initConstellationMapping(boundariesUrl) {
  const segments = await loadConstellationBoundaries(boundariesUrl);
  const polygons = groupSegmentsByConstellation(segments);
  constellationTriangles = buildTriangles(polygons);
}

/**
 * Checks if a given point (ra, dec in degrees) is inside a triangle.
 * The triangle is specified by an array of three vertices {ra, dec}.
 * We project both the triangle and the point onto a tangent plane (centered at the triangle’s centroid)
 * and then perform a standard 2D point‑in‑triangle test.
 */
function isPointInTriangle(ra, dec, triangle) {
  const centroid = computeCentroid(triangle);
  const projTriangle = projectPolygon(triangle, centroid);
  const pt = projectPolygon([{ ra, dec }], centroid)[0];
  const [a, b, c] = projTriangle;
  const denominator = ((b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y));
  const alpha = ((b.y - c.y) * (pt.x - c.x) + (c.x - b.x) * (pt.y - c.y)) / denominator;
  const beta = ((c.y - a.y) * (pt.x - c.x) + (a.x - c.x) * (pt.y - c.y)) / denominator;
  const gamma = 1.0 - alpha - beta;
  return (alpha >= 0) && (beta >= 0) && (gamma >= 0);
}

/**
 * Returns the constellation label for a given (ra, dec) point in degrees.
 * It first uses the bounding boxes of the precomputed triangles to narrow candidates,
 * then performs a precise point‑in‑triangle test.
 */
export function getConstellationForPoint(ra, dec) {
  for (const tri of constellationTriangles) {
    if (ra < tri.bbox.minRA || ra > tri.bbox.maxRA || dec < tri.bbox.minDec || dec > tri.bbox.maxDec) {
      continue;
    }
    if (isPointInTriangle(ra, dec, tri.vertices)) {
      return tri.constellation;
    }
  }
  return "Unknown";
}

/**
 * Converts a 3D position (THREE.Vector3) to spherical coordinates (ra, dec in degrees).
 */
export function positionToSpherical(pos) {
  const r = pos.length();
  if (r < 1e-6) return { ra: 0, dec: 0 };
  let ra = Math.atan2(pos.y, pos.x);
  if (ra < 0) ra += 2 * Math.PI;
  const dec = Math.asin(pos.z / r);
  return { ra: THREE.Math.radToDeg(ra), dec: THREE.Math.radToDeg(dec) };
}
