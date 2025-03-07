// /filters/connectionsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Computes connection pairs between stars that are within maxDistance.
 * Optimized using a spatial grid (cell size = maxDistance) to avoid checking every pair.
 *
 * @param {Array} stars - Array of star objects.
 * @param {number} maxDistance - Maximum distance (in Light Years) allowed to form a connection.
 * @returns {Array} Array of connection objects: { starA, starB, distance }
 */
export function computeConnectionPairs(stars, maxDistance) {
  const pairs = [];
  const cellSize = maxDistance;
  const grid = new Map();

  // Build grid: compute each star's position once (using truePosition if available)
  stars.forEach(star => {
    const pos = star.truePosition
      ? star.truePosition
      : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    // Store the computed position on a temporary property to avoid re‐computing it later.
    star._posForConnections = pos;
    const ix = Math.floor(pos.x / cellSize);
    const iy = Math.floor(pos.y / cellSize);
    const iz = Math.floor(pos.z / cellSize);
    const key = `${ix},${iy},${iz}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push(star);
  });

  // Loop through each cell and compare stars within the same cell and with neighbor cells.
  grid.forEach((starList, key) => {
    const [ix, iy, iz] = key.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const neighborKey = `${ix + dx},${iy + dy},${iz + dz}`;
          if (!grid.has(neighborKey)) continue;
          const neighborList = grid.get(neighborKey);
          // To avoid duplicate pairs, if the neighbor cell is the same as current cell,
          // only compare each distinct pair once.
          if (neighborKey === key) {
            for (let i = 0; i < starList.length; i++) {
              for (let j = i + 1; j < starList.length; j++) {
                const starA = starList[i];
                const starB = starList[j];
                const dist = starA._posForConnections.distanceTo(starB._posForConnections);
                if (dist > 0 && dist <= maxDistance) {
                  pairs.push({ starA, starB, distance: dist });
                }
              }
            }
          } else if (neighborKey > key) { // Process each neighbor cell only once.
            for (const starA of starList) {
              for (const starB of neighborList) {
                const dist = starA._posForConnections.distanceTo(starB._posForConnections);
                if (dist > 0 && dist <= maxDistance) {
                  pairs.push({ starA, starB, distance: dist });
                }
              }
            }
          }
        }
      }
    }
  });

  // Clean up the temporary property
  stars.forEach(star => { delete star._posForConnections; });

  return pairs;
}

/**
 * Merges connection line segments into a single THREE.LineSegments object.
 *
 * @param {Array} connectionObjs - Array of connection objects.
 * @returns {THREE.LineSegments} - The merged connection lines.
 */
export function mergeConnectionLines(connectionObjs) {
  const positions = [];
  const colors = [];

  connectionObjs.forEach(pair => {
    const { starA, starB } = pair;

    const posA = starA.truePosition ? starA.truePosition : new THREE.Vector3(starA.x_coordinate, starA.y_coordinate, starA.z_coordinate);
    const posB = starB.truePosition ? starB.truePosition : new THREE.Vector3(starB.x_coordinate, starB.y_coordinate, starB.z_coordinate);

    positions.push(posA.x, posA.y, posA.z);
    positions.push(posB.x, posB.y, posB.z);

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

  const mergedLines = new THREE.LineSegments(geometry, material);
  return mergedLines;
}

/**
 * Creates individual connection line objects between star pairs.
 *
 * @param {Array} stars - Array of star objects.
 * @param {Array} pairs - Array of connection objects.
 * @param {string} mapType - 'Globe' or other.
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
      posA = new THREE.Vector3(starA.spherePosition.x, starA.spherePosition.y, starA.spherePosition.z);
      posB = new THREE.Vector3(starB.spherePosition.x, starB.spherePosition.y, starB.spherePosition.z);
    } else {
      posA = starA.truePosition ? starA.truePosition.clone() : new THREE.Vector3(starA.x_coordinate, starA.y_coordinate, starA.z_coordinate);
      posB = starB.truePosition ? starB.truePosition.clone() : new THREE.Vector3(starB.x_coordinate, starB.y_coordinate, starB.z_coordinate);
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
 * Helper function to compute points along a great‑circle path between two points on a sphere.
 *
 * @param {THREE.Vector3} p1 - The starting point.
 * @param {THREE.Vector3} p2 - The ending point.
 * @param {number} R - Radius of the sphere.
 * @param {number} segments - Number of segments along the arc.
 * @returns {Array} - Array of THREE.Vector3 points.
 */
function getGreatCirclePoints(p1, p2, R, segments) {
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
