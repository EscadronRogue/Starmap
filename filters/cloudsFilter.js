// /filters/cloudsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { ConvexGeometry } from './ConvexGeometry.js';

/**
 * Loads a cloud data file (JSON) from the provided URL.
 * @param {string} cloudFileUrl - URL to the cloud JSON file.
 * @returns {Promise<Array>} - Promise resolving to an array of cloud star objects (the “cloud data”).
 */
export async function loadCloudData(cloudFileUrl) {
  const response = await fetch(cloudFileUrl);
  if (!response.ok) {
    throw new Error(`Failed to load cloud data from ${cloudFileUrl}`);
  }
  return await response.json();
}

/**
 * Normalize a star name by trimming spaces and converting to lowercase.
 */
function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Calculate the approximate on-sky angular distance (in degrees) between two RA/DEC points.
 * RA/DEC are in degrees. We convert them to radians for the spherical law of cosines.
 */
function angularSeparationDeg(ra1, dec1, ra2, dec2) {
  // Convert to radians
  const rad = Math.PI / 180;
  const r1 = ra1 * rad, d1 = dec1 * rad;
  const r2 = ra2 * rad, d2 = dec2 * rad;

  // Spherical law of cosines
  // cos(distance) = sin(d1)*sin(d2) + cos(d1)*cos(d2)*cos(r1 - r2)
  const cosDist = Math.sin(d1) * Math.sin(d2) +
                  Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  // clamp numerical issues
  const clamped = Math.min(Math.max(cosDist, -1), 1);
  const distRad = Math.acos(clamped);
  return distRad / rad; // convert back to degrees
}

/**
 * Creates a cloud overlay mesh from cloud data and the currently plotted stars.
 *
 * Steps:
 *   1) We read “Star Name” & “HD” from each entry in the cloud data and store them
 *      in sets for direct name or HD matching.
 *   2) For each star in your plottedStars, if it matches name or HD, we include it.
 *   3) If it did not match name or HD, we optionally do a fallback approach:
 *      we find if the star’s RA_in_degrees / DEC_in_degrees is close (within
 *      some angle tolerance) to the cloud data’s RA / DEC.
 *   4) If that star qualifies, we use star.truePosition or star.spherePosition (depending on mapType).
 *   5) Build a ConvexGeometry from all these star positions (≥3).
 *
 * @param {Array} cloudData - The star objects from the cloud file (with RA, DEC, Name, HD, etc).
 * @param {Array} plottedStars - The star objects currently visible/plotted in your starmap.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null} - A mesh (convex hull) or null if fewer than 3 points found.
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  // 1) Collect sets for name & HD from the cloud data, plus a RA/DEC map.
  const cloudNames = new Set();
  const cloudHDs = new Set();
  // We also keep an array of all RA/DEC from the cloud data so we can do fallback matching by proximity.
  const cloudPositions = []; // each item: { ra: number, dec: number }

  for (const entry of cloudData) {
    const name = entry['Star Name'];
    if (name) {
      cloudNames.add(normalizeName(name));
    }
    const hdVal = entry['HD'];
    if (hdVal !== undefined && hdVal !== null) {
      cloudHDs.add(String(hdVal).trim().toLowerCase());
    }
    // We store RA, DEC from the data for fallback
    if (typeof entry.RA === 'number' && typeof entry.DEC === 'number') {
      cloudPositions.push({ ra: entry.RA, dec: entry.DEC });
    }
  }

  // We'll gather positions from plotted stars that pass any of these checks:
  // - Name or HD matches
  // - RA/DEC is near (within TOL deg) one of the cloud data’s RA/DEC entries
  //   This helps catch if “Tau Ceti” or “HD 10700” is spelled differently.
  const TOL = 0.5; // half-degree tolerance – adjust as needed
  const usedStars = new Set();
  const positions = [];

  for (const star of plottedStars) {
    // We skip if we already included this star
    if (usedStars.has(star)) continue;

    let matched = false;

    // (a) Name or HD check
    const starName = star.Common_name_of_the_star ? normalizeName(star.Common_name_of_the_star) : '';
    let starHD = null;
    if (star.HD !== undefined && star.HD !== null) {
      starHD = String(star.HD).trim().toLowerCase();
    }

    if (cloudNames.has(starName) || (starHD && cloudHDs.has(starHD))) {
      matched = true;
    }

    // (b) If not matched, try fallback RA/DEC proximity
    // We only attempt if star has RA_in_degrees / DEC_in_degrees
    if (!matched) {
      if (typeof star.RA_in_degrees === 'number' && typeof star.DEC_in_degrees === 'number') {
        // We see if star is within TOL deg of ANY cloud RA/DEC
        for (const cpos of cloudPositions) {
          const dist = angularSeparationDeg(star.RA_in_degrees, star.DEC_in_degrees, cpos.ra, cpos.dec);
          if (dist < TOL) {
            matched = true;
            break;
          }
        }
      }
    }

    if (matched) {
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) {
          positions.push(star.truePosition);
          usedStars.add(star);
        }
      } else {
        if (star.spherePosition) {
          positions.push(star.spherePosition);
          usedStars.add(star);
        }
      }
    }
  }

  // If we found fewer than 3 corners, we skip building the polygon
  if (positions.length < 3) {
    return null;
  }

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
 * Updates the dust cloud overlays on a scene by re-reading the relevant data files,
 * creating convex hull meshes for each file, and adding them to the scene.
 *
 * @param {Array} plottedStars - The array of currently plotted stars.
 * @param {THREE.Scene} scene - The scene to which we add the cloud overlays.
 * @param {string} mapType - 'TrueCoordinates' or 'Globe'.
 * @param {Array<string>} cloudDataFiles - Array of file URLs for each dust cloud data JSON.
 */
export async function updateCloudsOverlay(plottedStars, scene, mapType, cloudDataFiles) {
  // Remove old overlays
  if (!scene.userData.cloudOverlays) {
    scene.userData.cloudOverlays = [];
  } else {
    scene.userData.cloudOverlays.forEach(mesh => scene.remove(mesh));
    scene.userData.cloudOverlays = [];
  }

  // For each dust cloud file, create a polygon
  for (const fileUrl of cloudDataFiles) {
    try {
      const cloudData = await loadCloudData(fileUrl);
      const overlay = createCloudOverlay(cloudData, plottedStars, mapType);
      if (overlay) {
        scene.add(overlay);
        scene.userData.cloudOverlays.push(overlay);
      }
    } catch (err) {
      console.error('Error loading cloud file:', fileUrl, err);
    }
  }
}
