// /filters/cloudsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { ConvexGeometry } from './ConvexGeometry.js';

/**
 * Loads a cloud data file (JSON) from the provided URL.
 * @param {string} cloudFileUrl - URL to the cloud JSON file.
 * @returns {Promise<Array>} - Promise resolving to an array of cloud star objects.
 */
export async function loadCloudData(cloudFileUrl) {
  const response = await fetch(cloudFileUrl);
  if (!response.ok) {
    throw new Error(`Failed to load cloud data from ${cloudFileUrl}`);
  }
  return await response.json();
}

/**
 * Creates a cloud overlay mesh from the cloud data and the currently plotted stars.
 * @param {Array} cloudData - Array of star objects from the cloud file.
 * @param {Array} plottedStars - Array of star objects currently visible/plotted.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null} - A mesh representing the cloud (convex hull), or null if not enough points.
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  const positions = [];
  // Get a set of star names from the cloud file.
  const cloudNames = new Set(cloudData.map(d => d["Star Name"]));
  // Look up each star from the plotted stars (using the common name)
  plottedStars.forEach(star => {
    if (cloudNames.has(star.Common_name_of_the_star)) {
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) positions.push(star.truePosition);
      } else {
        if (star.spherePosition) positions.push(star.spherePosition);
      }
    }
  });

  // Identify outlier stars that should be included in the convex hull
  const outlierStars = plottedStars.filter(star => {
    // Define your criteria for including outlier stars here
    // For example, include stars within a certain distance from the cloud area
    return !cloudNames.has(star.Common_name_of_the_star) && isNearCloudArea(star, positions, mapType);
  });

  // Add outlier stars to the positions array
  outlierStars.forEach(star => {
    if (mapType === 'TrueCoordinates') {
      if (star.truePosition) positions.push(star.truePosition);
    } else {
      if (star.spherePosition) positions.push(star.spherePosition);
    }
  });

  // Need at least three points to form a polygon.
  if (positions.length < 3) return null;

  // Build a convex hull from the positions.
  let geometry = new ConvexGeometry(positions);

  // Refine the convex hull until all stars are included
  while (!allStarsIncluded(plottedStars, geometry, mapType)) {
    const additionalPoints = getAdditionalPoints(plottedStars, geometry, mapType);
    positions.push(...additionalPoints);
    geometry = new ConvexGeometry(positions);
  }

  // Create a semi-transparent material; you can adjust the color per cloud if desired.
  const material = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    opacity: 0.3,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Determines if a star is near the cloud area based on some criteria.
 * @param {Object} star - The star object.
 * @param {Array} positions - Array of positions defining the cloud area.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {boolean} - True if the star is near the cloud area, false otherwise.
 */
function isNearCloudArea(star, positions, mapType) {
  // Define your criteria for "near" here
  // For example, check if the star is within a certain distance from any position in the cloud area
  const thresholdDistance = 5; // Define an appropriate threshold distance
  if (mapType === 'TrueCoordinates') {
    return positions.some(pos => star.truePosition.distanceTo(pos) < thresholdDistance);
  } else {
    return positions.some(pos => star.spherePosition.distanceTo(pos) < thresholdDistance);
  }
}

/**
 * Checks if all stars are included in the convex hull.
 * @param {Array} plottedStars - Array of star objects.
 * @param {THREE.BufferGeometry} geometry - The convex hull geometry.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {boolean} - True if all stars are included, false otherwise.
 */
function allStarsIncluded(plottedStars, geometry, mapType) {
  const vertices = geometry.attributes.position.array;
  const vertexSet = new Set();
  for (let i = 0; i < vertices.length; i += 3) {
    vertexSet.add(`${vertices[i]},${vertices[i+1]},${vertices[i+2]}`);
  }
  return plottedStars.every(star => {
    const pos = mapType === 'TrueCoordinates' ? star.truePosition : star.spherePosition;
    return vertexSet.has(`${pos.x},${pos.y},${pos.z}`);
  });
}

/**
 * Gets additional points to include in the convex hull.
 * @param {Array} plottedStars - Array of star objects.
 * @param {THREE.BufferGeometry} geometry - The convex hull geometry.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {Array} - Array of additional points to include.
 */
function getAdditionalPoints(plottedStars, geometry, mapType) {
  const vertices = geometry.attributes.position.array;
  const vertexSet = new Set();
  for (let i = 0; i < vertices.length; i += 3) {
    vertexSet.add(`${vertices[i]},${vertices[i+1]},${vertices[i+2]}`);
  }
  const additionalPoints = [];
  plottedStars.forEach(star => {
    const pos = mapType === 'TrueCoordinates' ? star.truePosition : star.spherePosition;
    if (!vertexSet.has(`${pos.x},${pos.y},${pos.z}`)) {
      additionalPoints.push(pos);
    }
  });
  return additionalPoints;
}

/**
 * Updates the clouds overlay on a given scene.
 * @param {Array} plottedStars - The array of currently plotted stars.
 * @param {THREE.Scene} scene - The scene to add the cloud overlays to.
 * @param {string} mapType - 'TrueCoordinates' or 'Globe'
 * @param {Array<string>} cloudDataFiles - Array of URLs for cloud JSON files.
 */
export async function updateCloudsOverlay(plottedStars, scene, mapType, cloudDataFiles) {
  // Store overlays in scene.userData.cloudOverlays so we can remove them on update.
  if (!scene.userData.cloudOverlays) {
    scene.userData.cloudOverlays = [];
  } else {
    scene.userData.cloudOverlays.forEach(mesh => scene.remove(mesh));
    scene.userData.cloudOverlays = [];
  }
  // Process each cloud file.
  for (const fileUrl of cloudDataFiles) {
    try {
      const cloudData = await loadCloudData(fileUrl);
      const overlay = createCloudOverlay(cloudData, plottedStars, mapType);
      if (overlay) {
        scene.add(overlay);
        scene.userData.cloudOverlays.push(overlay);
      }
    } catch (e) {
      console.error(e);
    }
  }
}
