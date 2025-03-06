// File: /filters/connectionsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Returns the cached or computed position for a star.
 * If the star has a computed truePosition, it is used.
 * Otherwise, if the star has x,y,z coordinates, they are used
 * and the resulting THREE.Vector3 is cached in star._cachedPosition.
 */
export function getPosition(star) {
  if (star.truePosition) {
    return star.truePosition;
  }
  if (star._cachedPosition) {
    return star._cachedPosition;
  }
  if (
    star.x_coordinate !== undefined &&
    star.y_coordinate !== undefined &&
    star.z_coordinate !== undefined
  ) {
    star._cachedPosition = new THREE.Vector3(
      star.x_coordinate,
      star.y_coordinate,
      star.z_coordinate
    );
    return star._cachedPosition;
  }
  star._cachedPosition = new THREE.Vector3(0, 0, 0);
  return star._cachedPosition;
}

/**
 * Computes connection pairs between stars that are within maxDistance.
 * This version uses a spatial grid partitioning to limit the number of comparisons.
 *
 * @param {Array} stars - Array of star objects.
 * @param {number} maxDistance - Maximum allowed distance for a connection.
 * @returns {Array} Array of connection objects: { starA, starB, distance }
 */
export function computeConnectionPairs(stars, maxDistance) {
  const pairs = [];
  const cellSize = maxDistance; // Using maxDistance as cell size
  const grid = new Map();

  // Build a grid index with each star’s computed position.
  stars.forEach((star, i) => {
    const pos = getPosition(star);
    const ix = Math.floor(pos.x / cellSize);
    const iy = Math.floor(pos.y / cellSize);
    const iz = Math.floor(pos.z / cellSize);
    const key = `${ix},${iy},${iz}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push({ star, pos, index: i });
  });

  // Get sorted keys so that when comparing neighbor cells we can avoid duplicates.
  const gridKeys = Array.from(grid.keys()).sort();

  gridKeys.forEach(key => {
    const cellStars = grid.get(key);
    // Compare all star pairs within the same cell.
    for (let i = 0; i < cellStars.length; i++) {
      for (let j = i + 1; j < cellStars.length; j++) {
        const { star: starA, pos: posA } = cellStars[i];
        const { star: starB, pos: posB } = cellStars[j];
        const distance = posA.distanceTo(posB);
        if (distance > 0 && distance <= maxDistance) {
          pairs.push({ starA, starB, distance });
        }
      }
    }
    // For neighboring cells, compare stars only once.
    const [ix, iy, iz] = key.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const neighborKey = `${ix + dx},${iy + dy},${iz + dz}`;
          // To avoid duplicate comparisons, only process neighbor cells with keys greater than current key.
          if (grid.has(neighborKey) && neighborKey > key) {
            const neighborStars = grid.get(neighborKey);
            cellStars.forEach(objA => {
              neighborStars.forEach(objB => {
                const distance = objA.pos.distanceTo(objB.pos);
                if (distance > 0 && distance <= maxDistance) {
                  pairs.push({ starA: objA.star, starB: objB.star, distance });
                }
              });
            });
          }
        }
      }
    }
  });

  return pairs;
}

/**
 * Merges connection line segments into a single THREE.LineSegments object.
 * Uses the star positions and their displayColor.
 *
 * @param {Array} connectionObjs - Array of connection objects.
 * @returns {THREE.LineSegments} - The merged connection lines.
 */
export function mergeConnectionLines(connectionObjs) {
  const positions = [];
  const colors = [];

  connectionObjs.forEach(pair => {
    const { starA, starB } = pair;
    const posA = getPosition(starA);
    const posB = getPosition(starB);
    positions.push(posA.x, posA.y, posA.z);
    positions.push(posB.x, posB.y, posB.z);

    // Set each vertex's color using the star's displayColor.
    const cA = new THREE.Color(starA.displayColor || '#ffffff');
    const cB = new THREE.Color(starB.displayColor || '#ffffff');
    colors.push(cA.r, cA.g, cA.b);
    colors.push(cB.r, cB.g, cB.b);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    linewidth: 1
  });

  return new THREE.LineSegments(geometry, material);
}

/**
 * Creates individual connection line objects between star pairs.
 * For "Globe" mode, a great‐circle curve is used.
 *
 * @param {Array} stars - Array of star objects.
 * @param {Array} pairs - Array of connection objects.
 * @param {string} mapType - Either "Globe" or other.
 * @returns {Array} - Array of THREE.Line objects.
 */
export function createConnectionLines(stars, pairs, mapType) {
  if (!pairs || pairs.length === 0) return [];

  const largestPairDistance = pairs.reduce((max, p) => Math.max(max, p.distance), 0);
  const lines = [];

  pairs.forEach(pair => {
    const { starA, starB, distance } = pair;
    let posA, posB;
    if (mapType === 'Globe') {
      if (!starA.spherePosition || !starB.spherePosition) return;
      posA = new THREE.Vector3(
        starA.spherePosition.x,
        starA.spherePosition.y,
        starA.spherePosition.z
      );
      posB = new THREE.Vector3(
        starB.spherePosition.x,
        starB.spherePosition.y,
        starB.spherePosition.z
      );
    } else {
      posA = getPosition(starA).clone();
      posB = getPosition(starB).clone();
    }

    const c1 = new THREE.Color(starA.displayColor || '#ffffff');
    const c2 = new THREE.Color(starB.displayColor || '#ffffff');
    const gradientColor = c1.clone().lerp(c2, 0.5);

    const normDist = distance / (largestPairDistance || distance);
    const lineThickness = THREE.MathUtils.lerp(5, 1, normDist);
    const lineOpacity = THREE.MathUtils.lerp(1.0, 0.3, normDist);

    let points;
    if (mapType === 'Globe') {
      const R = 100;
      const curve = new THREE.CatmullRomCurve3(getGreatCirclePoints(posA, posB, R, 32));
      points = curve.getPoints(32);
    } else {
      points = [posA, posB];
    }

    const geometryLine = new THREE.BufferGeometry().setFromPoints(points);
    const materialLine = new THREE.LineBasicMaterial({
      color: gradientColor,
      transparent: true,
      opacity: lineOpacity,
      linewidth: lineThickness
    });
    const line = new THREE.Line(geometryLine, materialLine);
    if (mapType === 'Globe') {
      line.renderOrder = 1;
    }
    lines.push(line);
  });
  return lines;
}

/**
 * Returns an array of points along a great‑circle arc between two points on a sphere.
 * This function now uses caching to avoid re‑computing curves for the same endpoints.
 *
 * @param {THREE.Vector3} p1 - Starting point.
 * @param {THREE.Vector3} p2 - Ending point.
 * @param {number} R - Radius of the sphere.
 * @param {number} segments - Number of segments for the arc.
 * @returns {Array<THREE.Vector3>} - Array of points along the arc.
 */
export function getGreatCirclePoints(p1, p2, R, segments) {
  const key = createGreatCircleKey(p1, p2, R, segments);
  if (greatCircleCache.has(key)) {
    return greatCircleCache.get(key);
  }
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
  greatCircleCache.set(key, points);
  return points;
}

// Internal cache for great-circle computations.
const greatCircleCache = new Map();

/**
 * Creates a cache key for getGreatCirclePoints based on rounded coordinates.
 *
 * @param {THREE.Vector3} p1
 * @param {THREE.Vector3} p2
 * @param {number} R
 * @param {number} segments
 * @returns {string} Cache key.
 */
function createGreatCircleKey(p1, p2, R, segments) {
  function round(val) {
    return Math.round(val * 10000) / 10000;
  }
  // Create keys for both points and sort them for symmetry.
  const p1Key = `${round(p1.x)},${round(p1.y)},${round(p1.z)}`;
  const p2Key = `${round(p2.x)},${round(p2.y)},${round(p2.z)}`;
  const ordered = [p1Key, p2Key].sort().join('|');
  return `${ordered}|${R}|${segments}`;
}
