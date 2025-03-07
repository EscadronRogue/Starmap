// /utils/geometryUtils.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Converts degrees to radians.
 */
export function degToRad(deg) {
  return deg * Math.PI / 180;
}

/**
 * Parses a Right Ascension string (e.g. "12:34:56") and returns radians.
 */
export function parseRA(raStr) {
  const parts = raStr.split(':').map(Number);
  const hours = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  return degToRad(hours * 15);
}

/**
 * Parses a Declination string (e.g. "-12:34:56") and returns radians.
 */
export function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const parts = decStr.replace('+', '').split(':').map(Number);
  const degrees = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  return degToRad(degrees * sign);
}

/**
 * Given a vector on a sphere of radius R, returns the corresponding RA and DEC in degrees.
 * @param {THREE.Vector3} vector - The vector on the sphere.
 * @param {number} R - The sphere radius (default 100).
 * @returns {Object} - An object with properties ra and dec (in degrees).
 */
export function vectorToRaDec(vector, R = 100) {
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

/**
 * Converts RA and DEC (in radians) to a THREE.Vector3 on a sphere of radius R.
 */
export function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

/**
 * Subdivides the triangles of a BufferGeometry a given number of iterations.
 * @param {THREE.BufferGeometry} geometry - The geometry to subdivide.
 * @param {number} iterations - Number of subdivision iterations.
 * @returns {THREE.BufferGeometry} - The subdivided geometry.
 */
export function subdivideGeometry(geometry, iterations) {
  let geo = geometry;
  for (let iter = 0; iter < iterations; iter++) {
    const posAttr = geo.getAttribute('position');
    const oldPositions = [];
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      oldPositions.push(v);
    }
    const oldIndices = geo.getIndex().array;
    const newVertices = [...oldPositions];
    const newIndices = [];
    const midpointCache = {};

    function getMidpoint(i1, i2) {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      if (midpointCache[key] !== undefined) return midpointCache[key];
      const v1 = newVertices[i1];
      const v2 = newVertices[i2];
      const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5).normalize().multiplyScalar(100);
      newVertices.push(mid);
      const idx = newVertices.length - 1;
      midpointCache[key] = idx;
      return idx;
    }

    for (let i = 0; i < oldIndices.length; i += 3) {
      const i0 = oldIndices[i];
      const i1 = oldIndices[i + 1];
      const i2 = oldIndices[i + 2];
      const m0 = getMidpoint(i0, i1);
      const m1 = getMidpoint(i1, i2);
      const m2 = getMidpoint(i2, i0);
      newIndices.push(i0, m0, m2);
      newIndices.push(m0, i1, m1);
      newIndices.push(m0, m1, m2);
      newIndices.push(m2, m1, i2);
    }

    const positions = [];
    newVertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Generates points along a great‑circle arc between two points on a sphere of radius R.
 * @param {THREE.Vector3} p1 - Starting point.
 * @param {THREE.Vector3} p2 - Ending point.
 * @param {number} R - Radius of the sphere.
 * @param {number} segments - Number of segments.
 * @returns {THREE.Vector3[]} - Array of points on the arc.
 */
export function getGreatCirclePoints(p1, p2, R, segments) {
  const points = [];
  const start = p1.clone().normalize().multiplyScalar(R);
  const end = p2.clone().normalize().multiplyScalar(R);
  const axis = new THREE.Vector3().crossVectors(start, end).normalize();
  const angle = start.angleTo(end);
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * angle;
    const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, theta);
    const point = start.clone().applyQuaternion(quaternion);
    points.push(point);
  }
  return points;
}
