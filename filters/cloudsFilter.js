// /filters/cloudsFilter.js
//
// Replaced the old minimal "ConvexGeometry" approach with the official
// three.js "ConvexHull" from /filters/ConvexHull.js to ensure all outer
// points on the hull are included.
//

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { ConvexHull } from './ConvexHull.js';

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
 * Creates a 3D mesh for the dust cloud by computing a convex hull of the cloud’s star positions.
 * @param {Array} cloudData - Array of star objects from the cloud file.
 * @param {Array} plottedStars - The star objects that are currently plotted.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null}
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {

  // Gather all relevant positions
  const positions = [];
  const cloudNames = new Set(cloudData.map(d => d["Star Name"]));
  
  // For each star that belongs to this cloud, use that star’s 3D position
  plottedStars.forEach(star => {
    if (cloudNames.has(star.Common_name_of_the_star)) {
      if (mapType === 'TrueCoordinates' && star.truePosition) {
        positions.push(star.truePosition.clone());
      } else if (mapType === 'Globe' && star.spherePosition) {
        positions.push(star.spherePosition.clone());
      }
    }
  });

  if (positions.length < 4) {
    // Need at least 4 points for a robust 3D hull (3 is only a triangle)
    return null;
  }

  // Use the official ConvexHull
  const hull = new ConvexHull().setFromPoints(positions);

  // The hull’s faces can be turned into a single BufferGeometry
  const geometry = new THREE.BufferGeometry();

  const verts = [];
  hull.faces.forEach(face => {
    // Each face is a cycle of 3 or more edges, but by default
    // the official hull code typically uses triangles
    let edge = face.edge;
    do {
      const point = edge.head().point;
      verts.push(point.x, point.y, point.z);
      edge = edge.next;
    } while (edge !== face.edge);
  });

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.computeVertexNormals();

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
 * Updates the dust cloud overlays on a given scene. Removes old overlays, loads each cloud’s data,
 * creates a hull for each, and adds them.
 * @param {Array} plottedStars - The array of star objects currently plotted.
 * @param {THREE.Scene} scene - The scene to which we add the cloud overlays.
 * @param {string} mapType - 'TrueCoordinates' or 'Globe'.
 * @param {Array<string>} cloudDataFiles - Array of URLs to the JSON files describing each dust cloud.
 */
export async function updateCloudsOverlay(plottedStars, scene, mapType, cloudDataFiles) {
  if (!scene.userData.cloudOverlays) {
    scene.userData.cloudOverlays = [];
  } else {
    scene.userData.cloudOverlays.forEach(mesh => scene.remove(mesh));
    scene.userData.cloudOverlays = [];
  }

  for (const fileUrl of cloudDataFiles) {
    try {
      const cloudData = await loadCloudData(fileUrl);
      const hullMesh = createCloudOverlay(cloudData, plottedStars, mapType);
      if (hullMesh) {
        scene.add(hullMesh);
        scene.userData.cloudOverlays.push(hullMesh);
      }
    } catch (error) {
      console.error(`Error building cloud overlay for ${fileUrl}:`, error);
    }
  }
}
