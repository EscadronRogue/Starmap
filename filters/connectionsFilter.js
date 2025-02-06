// filters/connectionsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { calculateDistance } from '../utils.js';

/**
 * Computes connection pairs between stars that are within maxDistance.
 *
 * @param {Array} stars - Array of star objects.
 * @param {number} maxDistance - Maximum allowed distance between stars.
 * @returns {Array} Array of connection objects: { starA, starB, distance }
 */
export function computeConnectionPairs(stars, maxDistance) {
  const pairs = [];
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const starA = stars[i];
      const starB = stars[j];
      const distance = calculateDistance(starA, starB);
      if (distance > 0 && distance <= maxDistance) {
        pairs.push({ starA, starB, distance });
      }
    }
  }
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
    
    // Use the stars' x, y, z positions.
    positions.push(starA.x_coordinate, starA.y_coordinate, starA.z_coordinate);
    positions.push(starB.x_coordinate, starB.y_coordinate, starB.z_coordinate);
    
    // Set each vertex's color from the star's displayColor.
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
 * Helper function to compute points along a great‑circle path between two points.
 *
 * @param {THREE.Vector3} p1 - Starting position.
 * @param {THREE.Vector3} p2 - Ending position.
 * @param {number} R - Sphere radius.
 * @param {number} segments - Number of segments.
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
