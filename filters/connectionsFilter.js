// filters/connectionsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { calculateDistance } from '../utils.js';

/**
 * We separate "computeConnectionPairs" from "createConnectionLines":
 * - computeConnectionPairs() calculates star pairs within max distance.
 * - createConnectionLines() receives those pairs + mapType => creates lines for 3D maps.
 */

export function computeConnectionPairs(stars, userMaxDistance) {
  const pairs = [];
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const starA = stars[i];
      const starB = stars[j];
      const dist = calculateDistance(starA, starB);

      if (dist > 0 && dist <= userMaxDistance) {
        pairs.push({ starA, starB, distance: dist });
      }
    }
  }
  return pairs;
}

export function createConnectionLines(stars, pairs, mapType) {
  if (!pairs || pairs.length === 0) return [];

  // Largest distance for thickness/opacity normalization
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

    // Colors
    const c1 = new THREE.Color(starA.displayColor || '#ffffff');
    const c2 = new THREE.Color(starB.displayColor || '#ffffff');
    const gradientColor = c1.clone().lerp(c2, 0.5);

    // thickness & opacity
    const normDist = distance / (largestPairDistance || distance);
    const lineThickness = THREE.MathUtils.lerp(5, 1, normDist);
    const lineOpacity = THREE.MathUtils.lerp(1.0, 0.3, normDist);

    // For Globe -> great-circle
    // For TrueCoordinates -> direct line
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
      linewidth: lineThickness
    });
    const line = new THREE.Line(geometry, material);
    return line;
  });

  return lines.filter(l => l !== null);
}

/**
 * Great-circle path generator for the globe
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
