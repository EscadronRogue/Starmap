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
    return !cloudNames.has(star.Common_name_of_the_star) && isNearCloudArea(star, positions);
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
  const geometry = new ConvexGeometry(positions);
  // Create a semi‑transparent material; you can adjust the color per cloud if desired.
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
 * @returns {boolean} - True if the star is near the cloud area, false otherwise.
 */
function isNearCloudArea(star, positions) {
  // Define your criteria for "near" here
  // For example, check if the star is within a certain distance from any position in the cloud area
  const thresholdDistance = 5; // Define an appropriate threshold distance
  if (mapType === 'TrueCoordinates') {
    return positions.some(pos => star.truePosition.distanceTo(pos) < thresholdDistance);
  } else {
    return positions.some(pos => star.spherePosition.distanceTo(pos) < thresholdDistance);
  }
}
