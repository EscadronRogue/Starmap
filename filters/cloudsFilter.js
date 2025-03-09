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
 * Normalizes a star name for case-insensitive comparison,
 * removing leading/trailing spaces, etc.
 */
function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Creates a cloud overlay mesh from the cloud data and the currently plotted stars.
 * We do multiple checks for each star:
 *  - If cloud entry's "Star Name" matches star.Common_name_of_the_star (case-insensitive).
 *  - If cloud entry's HD matches star.HD (if numeric or string).
 * We also skip duplicates so that each star is only considered once.
 *
 * @param {Array} cloudData - Array of star objects from the cloud file.
 * @param {Array} plottedStars - Array of star objects currently visible/ploted.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null} - A mesh representing the cloud (convex hull), or null if not enough points.
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  // Build sets of unique "normalized" star names and HD values from the cloud file.
  const cloudNames = new Set();
  const cloudHDs = new Set();

  for (const entry of cloudData) {
    // (1) Add star name if present
    const starName = entry['Star Name'];
    if (starName) {
      cloudNames.add(normalizeName(starName));
    }

    // (2) Add HD if present
    const hdVal = entry['HD'];
    if (hdVal !== undefined && hdVal !== null) {
      // Convert to string then normalize (to handle '48915B' vs. '48915')
      cloudHDs.add(String(hdVal).trim().toLowerCase());
    }
  }

  // Now gather positions from the plotted stars that match on name or HD
  const positions = [];
  const usedSet = new Set(); // We track star IDs or references to avoid duplicates
  for (const star of plottedStars) {
    let matched = false;

    // Check star.Common_name_of_the_star
    const starName = star.Common_name_of_the_star ? normalizeName(star.Common_name_of_the_star) : '';

    // Check star.HD (converted to string)
    let starHD = null;
    if (star.HD !== undefined && star.HD !== null) {
      starHD = String(star.HD).trim().toLowerCase();
    }

    // If either name or HD matches, we consider it a match
    if (cloudNames.has(starName)) {
      matched = true;
    } else if (starHD && cloudHDs.has(starHD)) {
      matched = true;
    }

    // If matched, and we haven't used it yet, record the position
    if (matched && !usedSet.has(star)) {
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) {
          positions.push(star.truePosition);
          usedSet.add(star);
        }
      } else {
        if (star.spherePosition) {
          positions.push(star.spherePosition);
          usedSet.add(star);
        }
      }
    }
  }

  // Need at least three points to form a polygon
  if (positions.length < 3) return null;

  // Build a convex hull from the positions
  const geometry = new ConvexGeometry(positions);

  // Create a semi‑transparent material
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

  // Process each cloud file
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
