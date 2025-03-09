// /filters/cloudsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

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
 * Computes a best‑fit plane normal for a set of points using a simplified approach.
 * For robustness, we take the cross product of two non‑collinear vectors.
 * @param {Array<THREE.Vector3>} points - The array of 3D points.
 * @param {THREE.Vector3} centroid - The computed centroid of the points.
 * @returns {THREE.Vector3} - A unit normal vector for the best‑fit plane.
 */
function computeBestFitNormal(points, centroid) {
  if (points.length < 3) return new THREE.Vector3(0, 0, 1);
  const v1 = points[1].clone().sub(centroid);
  // Find a point not collinear with v1
  let v2 = null;
  for (let i = 2; i < points.length; i++) {
    const candidate = points[i].clone().sub(centroid);
    if (candidate.lengthSq() > 1e-6 && Math.abs(v1.dot(candidate)) < v1.length() * candidate.length() * 0.99) {
      v2 = candidate;
      break;
    }
  }
  if (!v2) {
    // Fallback: use default normal
    return new THREE.Vector3(0, 0, 1);
  }
  return new THREE.Vector3().crossVectors(v1, v2).normalize();
}

/**
 * Computes the 2D convex hull of a set of points using the monotone chain algorithm.
 * @param {Array} points - Array of objects with properties {x, y, original} (the original 3D point).
 * @returns {Array} - Array of points in convex-hull order.
 */
function convexHull2D(points) {
  // Sort points by x then y.
  const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // Remove last element of each list (duplicate endpoints)
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Creates a dust cloud overlay mesh by projecting the plotted star positions onto a best‑fit plane,
 * computing the 2D convex hull, and then reconstructing a 3D polygon.
 *
 * @param {Array} cloudData - Array of star objects from the cloud file.
 * @param {Array} plottedStars - Array of star objects currently visible/ploted.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null} - A mesh representing the cloud, or null if insufficient points.
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  const positions = [];
  // Use the "Star Name" field from the cloud file to filter plotted stars.
  const cloudNames = new Set(cloudData.map(d => d["Star Name"]));
  plottedStars.forEach(star => {
    if (cloudNames.has(star.Common_name_of_the_star)) {
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) positions.push(star.truePosition.clone());
      } else {
        if (star.spherePosition) positions.push(star.spherePosition.clone());
      }
    }
  });
  if (positions.length < 3) return null;

  // Compute centroid.
  const centroid = new THREE.Vector3();
  positions.forEach(p => centroid.add(p));
  centroid.divideScalar(positions.length);

  // Compute best-fit plane normal.
  const normal = computeBestFitNormal(positions, centroid);

  // Construct basis vectors for the plane.
  const basisX = new THREE.Vector3();
  if (Math.abs(normal.x) > 0.9) {
    basisX.set(0, 1, 0);
  } else {
    basisX.set(1, 0, 0);
  }
  basisX.cross(normal).normalize();
  const basisY = new THREE.Vector3().crossVectors(normal, basisX).normalize();

  // Project each 3D point onto the 2D plane.
  const points2D = positions.map(p => {
    const diff = new THREE.Vector3().subVectors(p, centroid);
    return { x: diff.dot(basisX), y: diff.dot(basisY), original: p };
  });

  // Compute convex hull in 2D.
  const hull2D = convexHull2D(points2D);
  if (hull2D.length < 3) return null;

  // Map 2D hull points back to 3D.
  const hull3D = hull2D.map(pt => {
    return new THREE.Vector3().copy(centroid)
      .addScaledVector(basisX, pt.x)
      .addScaledVector(basisY, pt.y);
  });

  // Create a polygon geometry from the ordered hull points.
  const vertices = [];
  hull3D.forEach(pt => {
    vertices.push(pt.x, pt.y, pt.z);
  });
  // Triangulate the 2D hull using THREE.ShapeUtils.
  const hull2DPoints = hull2D.map(pt => new THREE.Vector2(pt.x, pt.y));
  const indices2D = THREE.ShapeUtils.triangulateShape(hull2DPoints, []);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices2D.flat());
  geometry.computeVertexNormals();

  // Create material and mesh.
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
 * Updates the dust clouds overlay on a given scene.
 * @param {Array} plottedStars - The array of currently plotted stars.
 * @param {THREE.Scene} scene - The scene to add the cloud overlays to.
 * @param {string} mapType - 'TrueCoordinates' or 'Globe'
 * @param {Array<string>} cloudDataFiles - Array of URLs for cloud JSON files.
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
