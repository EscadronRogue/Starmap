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
 * Creates an alpha-shaped overlay mesh from cloud data + currently plotted stars.
 * Includes debug logs to see how many stars are matched, geometry size, etc.
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  console.log("[cloudsFilter] createCloudOverlay: Cloud data length =", cloudData.length,
              " #plottedStars =", plottedStars.length, " mapType =", mapType);

  // 1) Build sets of unique star names & HDs
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
  console.log("[cloudsFilter] unique cloudNames size =", cloudNames.size,
              " unique cloudHDs size =", cloudHDs.size);

  // 2) Collect matched positions
  const positions = [];
  const usedSet = new Set();
  let matchCount = 0;
  for (const star of plottedStars) {
    let matched = false;

    const starName = star.Common_name_of_the_star
      ? normalizeName(star.Common_name_of_the_star)
      : '';

    let starHD = null;
    if (star.HD !== undefined && star.HD !== null) {
      starHD = String(star.HD).trim().toLowerCase();
    }

    // If name or HD matches
    if (cloudNames.has(starName)) {
      matched = true;
    } else if (starHD && cloudHDs.has(starHD)) {
      matched = true;
    }

    if (matched && !usedSet.has(star)) {
      console.log(`  [cloudsFilter] Matched star: name="${star.Common_name_of_the_star}" HD=${star.HD}`);
      let pt = null;
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) pt = star.truePosition.clone();
      } else {
        if (star.spherePosition) pt = star.spherePosition.clone();
      }
      if (pt) {
        positions.push(pt);
        usedSet.add(star);
        matchCount++;
      }
    }
  }

  console.log("[cloudsFilter] matched star count =", matchCount,
              " final positions length =", positions.length);

  // 3) If fewer than 3 or 4 points, can't form shape
  if (positions.length < 3) {
    console.warn("[cloudsFilter] not enough points for shape, returning null.");
    return null;
  }

  // 4) Build alpha shape
  // Increase alpha to e.g. 10 or 9999 if you want to ensure large tetrahedra pass
  const alpha = 10.0;  // or 9999
  console.log("[cloudsFilter] calling computeAlphaShape3D with alpha =", alpha);
  const geometry = computeAlphaShape3D(positions, alpha);

  if (!geometry || geometry.attributes.position.count === 0) {
    console.warn("[cloudsFilter] alpha shape geometry is empty, returning null.");
    return null;
  }
  console.log("[cloudsFilter] alpha shape geometry vertex count =",
              geometry.attributes.position.count);

  // 5) Build material/mesh
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
 */
export async function updateCloudsOverlay(plottedStars, scene, mapType, cloudDataFiles) {
  console.log("[cloudsFilter] updateCloudsOverlay: #plottedStars =", plottedStars.length,
              " mapType =", mapType,
              " #cloudDataFiles =", cloudDataFiles.length);

  if (!scene.userData.cloudOverlays) {
    scene.userData.cloudOverlays = [];
  } else {
    scene.userData.cloudOverlays.forEach(mesh => scene.remove(mesh));
    scene.userData.cloudOverlays = [];
  }

  for (const fileUrl of cloudDataFiles) {
    console.log("[cloudsFilter] loading cloud file:", fileUrl);
    try {
      const cloudData = await loadCloudData(fileUrl);
      const overlay = createCloudOverlay(cloudData, plottedStars, mapType);
      if (overlay) {
        scene.add(overlay);
        scene.userData.cloudOverlays.push(overlay);
        console.log("[cloudsFilter] added overlay to scene.");
      } else {
        console.log("[cloudsFilter] overlay = null, skipping.");
      }
    } catch (e) {
      console.error("[cloudsFilter] error loading or creating overlay:", e);
    }
  }
}
