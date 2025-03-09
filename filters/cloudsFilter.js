// /filters/cloudsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { computeAlphaShape3D } from './alphaShape3D.js';

/**
 * Loads a cloud data file (JSON) from the provided URL.
 */
export async function loadCloudData(cloudFileUrl) {
  const response = await fetch(cloudFileUrl);
  if (!response.ok) {
    throw new Error(`Failed to load cloud data from ${cloudFileUrl}`);
  }
  return await response.json();
}

function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Creates an alpha-shaped overlay mesh from the cloud data and the currently plotted stars.
 * This method ensures the resulting shape can wrap around all points (a "concave hull" approach),
 * in contrast to a minimal convex hull that might omit some points from the boundary.
 *
 * @param {Array} cloudData - Array of star objects from the cloud file.
 * @param {Array} plottedStars - Array of star objects currently visible/plotted.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null}
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  // Gather sets of unique star names and HDs from the cloud data
  const cloudNames = new Set();
  const cloudHDs = new Set();

  for (const entry of cloudData) {
    const starName = entry['Star Name'];
    if (starName) {
      cloudNames.add(normalizeName(starName));
    }
    const hdVal = entry['HD'];
    if (hdVal !== undefined && hdVal !== null) {
      cloudHDs.add(String(hdVal).trim().toLowerCase());
    }
  }

  // Collect positions from plotted stars that match
  const positions = [];
  const usedSet = new Set();
  for (const star of plottedStars) {
    let matched = false;

    // Compare star.Common_name_of_the_star
    const starName = star.Common_name_of_the_star
      ? normalizeName(star.Common_name_of_the_star)
      : '';

    // Compare star.HD
    let starHD = null;
    if (star.HD !== undefined && star.HD !== null) {
      starHD = String(star.HD).trim().toLowerCase();
    }

    // Check if it matches name or HD
    if (cloudNames.has(starName)) {
      matched = true;
    } else if (starHD && cloudHDs.has(starHD)) {
      matched = true;
    }

    // If matched, avoid duplicates, gather position
    if (matched && !usedSet.has(star)) {
      let pt = null;
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) {
          pt = star.truePosition.clone();
        }
      } else {
        if (star.spherePosition) {
          pt = star.spherePosition.clone();
        }
      }
      if (pt) {
        positions.push(pt);
        usedSet.add(star);
      }
    }
  }

  // If fewer than 4 points, we can't do a real alpha shape in 3D
  // but if you want 3 points for a single triangle, adapt as needed:
  if (positions.length < 3) {
    return null;
  }

  // We pick an alpha parameter. Tweak as needed: smaller alpha => more "folded" shape.
  // For a real solution, you'd guess or find an alpha that covers your data well.
  const alpha = 2.0;

  const geometry = computeAlphaShape3D(positions, alpha);
  if (!geometry || geometry.attributes.position.count === 0) {
    // no geometry produced
    return null;
  }

  // Create a semi-transparent material
  const material = new THREE.MeshBasicMaterial({
    color: 0x0066ff,
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
  // Clear old overlays
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
