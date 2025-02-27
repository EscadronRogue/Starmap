// /filters/constellationOverlayFilter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Loads the constellation boundary segments from the boundaries text file.
 * Each line is expected to contain at least 8 parts with two endpoints and two constellation names.
 */
export async function loadConstellationBoundaries() {
  try {
    const resp = await fetch('constellation_boundaries.txt');
    if (!resp.ok) throw new Error(`Failed to load constellation_boundaries.txt: ${resp.status}`);
    const raw = await resp.text();
    const lines = raw.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const boundaries = [];
    lines.forEach(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 8) return;
      const ra1 = parseRA(parts[2]);
      const dec1 = parseDec(parts[3]);
      const ra2 = parseRA(parts[4]);
      const dec2 = parseDec(parts[5]);
      const const1 = parts[6];
      const const2 = parts[7];
      boundaries.push({ ra1, dec1, ra2, dec2, const1, const2 });
    });
    return boundaries;
  } catch (err) {
    console.error("Error loading constellation boundaries:", err);
    return [];
  }
}

function parseRA(raStr) {
  // Expect format "HH:MM:SS"
  const parts = raStr.split(':').map(Number);
  const hours = parts[0] + parts[1] / 60 + parts[2] / 3600;
  const degrees = hours * 15;
  return THREE.MathUtils.degToRad(degrees);
}

function parseDec(decStr) {
  // Expect format "+DD:MM:SS" or "-DD:MM:SS"
  const sign = decStr.startsWith('-') ? -1 : 1;
  const cleaned = decStr.replace('+', '');
  const parts = cleaned.split(':').map(Number);
  const degrees = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return THREE.MathUtils.degToRad(degrees * sign);
}

/**
 * Groups all endpoints by constellation.
 * Each boundary segment contributes both endpoints to each constellation it borders.
 */
function groupBoundaryPoints(boundaries) {
  const groups = {};
  boundaries.forEach(seg => {
    [seg.const1, seg.const2].forEach(cname => {
      if (!groups[cname]) groups[cname] = [];
      groups[cname].push({ ra: seg.ra1, dec: seg.dec1 });
      groups[cname].push({ ra: seg.ra2, dec: seg.dec2 });
    });
  });
  // Remove duplicate points for each constellation.
  for (const cname in groups) {
    groups[cname] = removeDuplicates(groups[cname]);
  }
  return groups;
}

function removeDuplicates(points) {
  const unique = [];
  points.forEach(pt => {
    if (!unique.some(u => Math.abs(u.ra - pt.ra) < 1e-6 && Math.abs(u.dec - pt.dec) < 1e-6)) {
      unique.push(pt);
    }
  });
  return unique;
}

/**
 * Orders a set of points to form a polygon.
 * (Here we simply compute the centroid and sort by angle.)
 */
function orderPoints(points) {
  let sumRa = 0, sumDec = 0;
  points.forEach(pt => { sumRa += pt.ra; sumDec += pt.dec; });
  const center = { ra: sumRa / points.length, dec: sumDec / points.length };
  points.sort((a, b) => {
    const angleA = Math.atan2(a.dec - center.dec, a.ra - center.ra);
    const angleB = Math.atan2(b.dec - center.dec, b.ra - center.ra);
    return angleA - angleB;
  });
  return points;
}

/**
 * Converts spherical coordinates (ra, dec) to a 3D position on a sphere of radius R.
 * (This is the same conversion used for the Globe map.)
 */
function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

/**
 * Creates an overlay mesh for a given constellation.
 * @param {Array} points - An ordered array of points ({ra, dec}) defining the boundary.
 * @param {string} constellationName - The constellation’s name.
 * @param {number} radius - The sphere radius (default 100).
 * @returns {THREE.Mesh} - A low opacity mesh covering the constellation area.
 */
function createOverlayMeshForConstellation(points, constellationName, radius = 100) {
  // Create a 2D shape using ra (x) and dec (y)
  const shape = new THREE.Shape();
  if (points.length === 0) return null;
  shape.moveTo(points[0].ra, points[0].dec);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].ra, points[i].dec);
  }
  shape.lineTo(points[0].ra, points[0].dec); // Close the shape

  // Triangulate the shape.
  const triangles = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
  // Convert each (ra, dec) to a 3D position on the sphere.
  const vertices = points.map(pt => radToSphere(pt.ra, pt.dec, radius));
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Build the index array from the triangulation.
  const indices = [];
  triangles.forEach(tri => {
    indices.push(tri[0], tri[1], tri[2]);
  });
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Generate a color (using a simple hash on the constellation name) and set low opacity.
  const hue = (Math.abs(hashString(constellationName)) % 360) / 360;
  const color = new THREE.Color().setHSL(hue, 0.7, 0.5);
  const material = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

// Simple hash function to derive a (consistent) number from a string.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

/**
 * Creates overlay meshes for each constellation on the globe map.
 * @returns {Promise<THREE.Mesh[]>} - An array of meshes representing constellation overlays.
 */
export async function createConstellationOverlaysForGlobe() {
  const boundaries = await loadConstellationBoundaries();
  const groups = groupBoundaryPoints(boundaries);
  const overlays = [];
  for (const cname in groups) {
    let pts = groups[cname];
    pts = orderPoints(pts);
    const mesh = createOverlayMeshForConstellation(pts, cname, 100);
    if (mesh) overlays.push(mesh);
  }
  return overlays;
}
