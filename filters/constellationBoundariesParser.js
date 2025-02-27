// constellationBoundariesParser.js
// This module loads raw boundary segment data (e.g. from "constellation_boundaries.txt"),
// parses each line (which is in the form:
//   "097:098 P+ 20:08:30 +08:30:00 20:18:00 +08:30:00 AQL DEL"
// ), groups segments by a chosen primary constellation (here, the first label),
// and then stitches segments together into closed polygons.
// These polygons are then returned for use in point‑in‑polygon tests.

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

// Convert RA from "hh:mm:ss" string to degrees.
function parseRA(raStr) {
  const parts = raStr.split(':').map(Number);
  // RA in hours to degrees (1 hour = 15 degrees)
  return (parts[0] + parts[1] / 60 + parts[2] / 3600) * 15;
}

// Convert Dec from "±dd:mm:ss" string to degrees.
function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const parts = decStr.replace('+', '').replace('-', '').split(':').map(Number);
  return sign * (parts[0] + parts[1] / 60 + parts[2] / 3600);
}

// Parse one line of the raw boundaries file.
function parseBoundaryLine(line) {
  // Expected format:
  // "097:098 P+ 20:08:30 +08:30:00 20:18:00 +08:30:00 AQL DEL"
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 8) return null;
  const segIds = tokens[0]; // e.g., "097:098"
  const segType = tokens[1]; // e.g., "P+"
  const ra1 = parseRA(tokens[2]);
  const dec1 = parseDec(tokens[3]);
  const ra2 = parseRA(tokens[4]);
  const dec2 = parseDec(tokens[5]);
  const const1 = tokens[6]; // first constellation label
  const const2 = tokens[7]; // second constellation label
  return {
    segIds,
    segType,
    start: { ra: ra1, dec: dec1 },
    end: { ra: ra2, dec: dec2 },
    const1,
    const2
  };
}

// Group segments by a chosen primary constellation.
// Here we use the first label (const1) as the primary assignment.
function groupSegmentsByConstellation(segments) {
  const groups = {};
  segments.forEach(seg => {
    if (!seg) return;
    const primary = seg.const1;
    if (!groups[primary]) groups[primary] = [];
    groups[primary].push(seg);
  });
  return groups;
}

// Compute the angular distance (in degrees) between two RA/Dec points.
function angularDistance(p1, p2) {
  const ra1 = THREE.Math.degToRad(p1.ra);
  const dec1 = THREE.Math.degToRad(p1.dec);
  const ra2 = THREE.Math.degToRad(p2.ra);
  const dec2 = THREE.Math.degToRad(p2.dec);
  const sinDDec = Math.sin((dec2 - dec1) / 2);
  const sinDRA = Math.sin((ra2 - ra1) / 2);
  const a = sinDDec * sinDDec + Math.cos(dec1) * Math.cos(dec2) * sinDRA * sinDRA;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return THREE.Math.radToDeg(c);
}

// Given an array of segments (each with start and end points in RA/Dec),
// try to stitch them together into one or more closed polygons.
// A simple chaining algorithm is used with a fixed tolerance.
function stitchSegments(segments) {
  const polygons = [];
  const used = new Array(segments.length).fill(false);
  const tolerance = 0.1; // degrees tolerance for matching endpoints

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    // Start a new polygon with segment i.
    let currentPolygon = [segments[i].start, segments[i].end];
    used[i] = true;
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const seg = segments[j];
        const lastPoint = currentPolygon[currentPolygon.length - 1];
        // Check if seg.start is near the last point.
        if (angularDistance(lastPoint, seg.start) < tolerance) {
          currentPolygon.push(seg.end);
          used[j] = true;
          extended = true;
          break;
        }
        // Otherwise, if seg.end is near the last point, add seg.start.
        if (angularDistance(lastPoint, seg.end) < tolerance) {
          currentPolygon.push(seg.start);
          used[j] = true;
          extended = true;
          break;
        }
      }
    }
    // If the polygon is closed (first and last point match within tolerance), remove duplicate.
    if (angularDistance(currentPolygon[0], currentPolygon[currentPolygon.length - 1]) < tolerance) {
      currentPolygon.pop();
    }
    // Only accept valid polygons with at least three vertices.
    if (currentPolygon.length >= 3) {
      polygons.push(currentPolygon);
    }
  }
  return polygons;
}

// Load the raw boundary file from the given URL, parse and stitch segments into polygons.
export async function loadConstellationPolygons(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Failed to load boundaries");
    const raw = await resp.text();
    const lines = raw.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const segments = lines.map(parseBoundaryLine).filter(seg => seg !== null);
    // Group segments by primary constellation.
    const groups = groupSegmentsByConstellation(segments);
    // For each constellation, stitch segments into polygons.
    const constellationPolygons = {};
    for (const constName in groups) {
      constellationPolygons[constName] = stitchSegments(groups[constName]);
    }
    return constellationPolygons;
  } catch (e) {
    console.error("Error loading constellation polygons:", e);
    return {};
  }
}
