// /filters/connectionsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { calculateDistance } from '../utils.js';

/**
 * Computes connection pairs using a grid‐based spatial index to avoid the O(n²) loop.
 * Stars are binned into cubic cells of size equal to the maximum allowed distance.
 */
export function computeConnectionPairs(stars, maxDistance) {
  const pairs = [];
  if (stars.length === 0) return pairs;
  const cellSize = maxDistance; // set cell size equal to maxDistance

  const grid = new Map();
  function getCellKey(x, y, z) {
    const ix = Math.floor(x / cellSize);
    const iy = Math.floor(y / cellSize);
    const iz = Math.floor(z / cellSize);
    return `${ix},${iy},${iz}`;
  }

  // Populate the grid with stars (using x_coordinate, y_coordinate, z_coordinate)
  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    const key = getCellKey(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push({ index: i, star: star });
  }

  // Offsets for the neighboring cells (including the cell itself)
  const neighborOffsets = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        neighborOffsets.push([dx, dy, dz]);
      }
    }
  }

  // For each star, check its cell and neighboring cells
  for (let i = 0; i < stars.length; i++) {
    const starA = stars[i];
    const cellX = Math.floor(starA.x_coordinate / cellSize);
    const cellY = Math.floor(starA.y_coordinate / cellSize);
    const cellZ = Math.floor(starA.z_coordinate / cellSize);
    for (const offset of neighborOffsets) {
      const key = `${cellX + offset[0]},${cellY + offset[1]},${cellZ + offset[2]}`;
      const cellStars = grid.get(key);
      if (!cellStars) continue;
      for (const item of cellStars) {
        const j = item.index;
        if (j <= i) continue; // avoid duplicate pairs
        const starB = item.star;
        const dist = calculateDistance(starA, starB);
        if (dist > 0 && dist <= maxDistance) {
          pairs.push({ starA, starB, distance: dist });
        }
      }
    }
  }
  return pairs;
}

/**
 * Creates connection lines between star pairs.
 */
export function createConnectionLines(stars, pairs, mapType) {
  if (!pairs || pairs.length === 0) return [];

  // Largest distance for normalization
  const largestPairDistance = pairs.reduce((maxSoFar, p) => {
    return p.distance > maxSoFar ? p.distance : maxSoFar;
  }, 0);

  const lines = pairs.map(pair => {
    const { starA, starB, distance } = pair;

    let posA, posB;
    if (mapType === 'Globe') {
      if (!starA.spherePosition || !starB.spherePosition) {
        return null;
      }
      posA = new THREE.Vector3(starA.spherePosition.x, starA.spherePosition.y, starA.spherePosition.z);
      posB = new THREE.Vector3(starB.spherePosition.x, starB.spherePosition.y, starB.spherePosition.z);
    } else {
      posA = new THREE.Vector3(starA.x_coordinate, starA.y_coordinate, starA.z_coordinate);
      posB = new THREE.Vector3(starB.x_coordinate, starB.y_coordinate, starB.z_coordinate);
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

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: gradientColor,
      transparent: true,
      opacity: lineOpacity,
      linewidth: lineThickness,
    });
    const line = new THREE.Line(geometry, material);
    // Ensure connection lines on the Globe are rendered above the globe surface.
    if (mapType === 'Globe') {
      line.renderOrder = 1;
    }
    return line;
  });

  return lines.filter(l => l !== null);
}

/**
 * Returns an array of points along the great-circle path between two points on the sphere.
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
