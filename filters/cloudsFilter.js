// /filters/cloudsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
// This is a hypothetical import for alpha-shape or concave geometry generation.
// You must provide or install an actual library that can produce a 3D mesh.
import { generateConcaveMesh } from './myAlphaShapes3D.js';

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
 * Normalizes a star name or ID for case-insensitive comparison.
 */
function normalizeName(value) {
  if (!value) return '';
  return value.trim().toLowerCase();
}

/**
 * Creates a cloud overlay mesh from the cloud data and the currently plotted stars.
 * Instead of a convex hull, we use a hypothetical "concave hull" or "alpha shape" approach
 * so that *all* matched points lie on (or very near) the surface.
 *
 * @param {Array} cloudData   - Array of star objects from the cloud file.
 * @param {Array} plottedStars - Array of star objects currently visible/plotted.
 * @param {string} mapType     - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null}  - A mesh representing the shape, or null if not enough points.
 */
export function createConcaveCloudOverlay(cloudData, plottedStars, mapType) {
  // 1) Build sets of unique "normalized" star names and HD IDs from the cloud data.
  const cloudNames = new Set();
  const cloudHDs = new Set();

  cloudData.forEach(entry => {
    const entryName = entry['Star Name'] ? normalizeName(entry['Star Name']) : '';
    if (entryName) {
      cloudNames.add(entryName);
    }
    if (entry['HD'] !== undefined && entry['HD'] !== null) {
      cloudHDs.add(normalizeName(String(entry['HD'])));
    }
  });

  // 2) Collect matched star positions from your 'plottedStars'.
  //    We'll skip duplicates with a usedSet.
  const usedSet = new Set();
  const positions = [];

  for (const star of plottedStars) {
    let matched = false;
    // Compare names
    const starName = star.Common_name_of_the_star ? normalizeName(star.Common_name_of_the_star) : '';
    // Compare HD
    let starHD = null;
    if (star.HD !== undefined && star.HD !== null) {
      starHD = normalizeName(String(star.HD));
    }

    // If star's name or HD is found in the cloud sets, it's a match.
    if (cloudNames.has(starName) || (starHD && cloudHDs.has(starHD))) {
      matched = true;
    }

    // If matched, gather the correct 3D position (and avoid duplicates).
    if (matched && !usedSet.has(star)) {
      let pos = null;
      if (mapType === 'TrueCoordinates') {
        pos = star.truePosition;
      } else {
        pos = star.spherePosition;
      }
      if (pos) {
        positions.push(pos);
        usedSet.add(star);
      }
    }
  }

  // Need at least 3 points for a polygon (2D) or at least 4 for a typical 3D surface,
  // but let's keep it at 3 as a minimal requirement.
  if (positions.length < 3) {
    return null;
  }

  // 3) Build a concave or alpha-shape mesh from these points.
  //    This is a placeholder call to a hypothetical library or function.
  //    Provide an "alpha" parameter or other method to control shape detail.
  const alphaValue = 0.2; // arbitrary example
  const concaveGeometry = generateConcaveMesh(positions, alphaValue);

  if (!concaveGeometry) {
    // If the library fails or no geometry produced
    return null;
  }

  // 4) Create a semi-transparent material
  const material = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    opacity: 0.3,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const mesh = new THREE.Mesh(concaveGeometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Updates the clouds overlay on a given scene using a concave or alpha shape approach
 * so that all points are included on the boundary.
 *
 * @param {Array} plottedStars       - The array of currently plotted stars.
 * @param {THREE.Scene} scene        - The scene to add the cloud overlays to.
 * @param {string} mapType           - 'TrueCoordinates' or 'Globe'
 * @param {Array<string>} cloudFiles - Array of URLs for cloud JSON files.
 */
export async function updateCloudsOverlay(plottedStars, scene, mapType, cloudFiles) {
  if (!scene.userData.cloudOverlays) {
    scene.userData.cloudOverlays = [];
  } else {
    // Remove old overlays
    scene.userData.cloudOverlays.forEach(mesh => scene.remove(mesh));
    scene.userData.cloudOverlays = [];
  }

  for (const fileUrl of cloudFiles) {
    try {
      const cloudData = await loadCloudData(fileUrl);
      // Instead of the old createCloudOverlay, we call the new createConcaveCloudOverlay
      const overlayMesh = createConcaveCloudOverlay(cloudData, plottedStars, mapType);
      if (overlayMesh) {
        scene.add(overlayMesh);
        scene.userData.cloudOverlays.push(overlayMesh);
      }
    } catch (err) {
      console.error(`Error loading or building concave cloud from ${fileUrl}:`, err);
    }
  }
}
