// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * This updated density filter now not only builds the grid of empty cubes,
 * but also clusters them and dynamically names each contiguous region.
 * The classification is as follows:
 *   - Lake: volume < lakeVolumeThreshold (small, isolated cluster)
 *   - Ocean: volume ≥ 0.5 * V_max (largest independent basin)
 *   - Sea: any other independent basin
 *
 * (For simplicity, the current version does not further subdivide using narrow connectors.)
 */

let densityGrid = null;

///////////////////////
// DENSITY GRID CLASS
///////////////////////

class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = []; // Each cell: { tcMesh, globeMesh, tcPos, grid }
    this.adjacentLines = []; // (For visualizing the grid – unchanged)
    this.regionLabels = [];  // Array to hold region label meshes
    // Configuration for region classification:
    this.lakeVolumeThreshold = 3; // Change as needed (in cube count)
  }

  createGrid(stars) {
    const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
    this.cubesData = [];
    for (let x = -halfExt; x <= halfExt; x += this.gridSize) {
      for (let y = -halfExt; y <= halfExt; y += this.gridSize) {
        for (let z = -halfExt; z <= halfExt; z += this.gridSize) {
          const posTC = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
          const distFromCenter = posTC.length();
          if (distFromCenter > this.maxDistance) continue;
          
          // Create a cube for TrueCoordinates view
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // Globe: use a flat square (plane) instead of a cube.
          const planeGeom = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
          const material2 = material.clone();
          const squareGlobe = new THREE.Mesh(planeGeom, material2);
          
          let projectedPos;
          if (distFromCenter < 1e-6) {
            projectedPos = new THREE.Vector3(0, 0, 0);
          } else {
            // Compute RA = atan2(-z, -x) and dec = asin(y / distFromCenter)
            const ra = Math.atan2(-posTC.z, -posTC.x);
            const dec = Math.asin(posTC.y / distFromCenter);
            const radius = 100;
            projectedPos = new THREE.Vector3(
              -radius * Math.cos(dec) * Math.cos(ra),
               radius * Math.sin(dec),
              -radius * Math.cos(dec) * Math.sin(ra)
            );
          }
          squareGlobe.position.copy(projectedPos);
          // Orient the square so that it is tangent to the sphere.
          const normal = projectedPos.clone().normalize();
          squareGlobe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
          
          const cell = {
            tcMesh: cubeTC,
            globeMesh: squareGlobe,
            tcPos: posTC,
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            }
          };
          this.cubesData.push(cell);
        }
      }
    }
    this.computeDistances(stars);
    this.computeAdjacentLines();
  }

  computeDistances(stars) {
    this.cubesData.forEach(cell => {
      // For each star, compute distance from the cell's center
      const dArr = stars.map(star => {
        let starPos;
        if (star.truePosition) {
          starPos = star.truePosition;
        } else {
          starPos = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        }
        const dx = cell.tcPos.x - starPos.x;
        const dy = cell.tcPos.y - starPos.y;
        const dz = cell.tcPos.z - starPos.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      });
      dArr.sort((a, b) => a - b);
      // We store the sorted distances in the cell (you can later use a tolerance slider if desired)
      cell.distances = dArr;
    });
  }
  
  computeAdjacentLines() {
    this.adjacentLines = [];
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
      cellMap.set(key, cell);
    });
    const directions = [
      { dx: 1, dy: 0, dz: 0 },
      { dx: 0, dy: 1, dz: 0 },
      { dx: 0, dy: 0, dz: 1 }
    ];
    directions.forEach(dir => {
      this.cubesData.forEach(cell => {
        const neighborKey = `${cell.grid.ix + dir.dx},${cell.grid.iy + dir.dy},${cell.grid.iz + dir.dz}`;
        if (cellMap.has(neighborKey)) {
          const neighbor = cellMap.get(neighborKey);
          const points = getGreatCirclePoints(cell.globeMesh.position, neighbor.globeMesh.position, 100, 16);
          const geom = new THREE.BufferGeometry().setFromPoints(points);
          const mat = new THREE.LineBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 0.3,
            linewidth: 1
          });
          const line = new THREE.Line(geom, mat);
          line.renderOrder = 1;
          this.adjacentLines.push({ line, cell1: cell, cell2: neighbor });
        }
      });
    });
  }
  
  /**
   * Clusters the cubes (cells) using flood‑fill (26‑neighbor connectivity) based on grid indices.
   * Returns an array of clusters, each of which is an object with:
   *   - cells: an array of cell objects in the cluster
   *   - volume: number of cells
   *   - centroid: average position (in TC space) of the cells
   */
  clusterCells() {
    const clusters = [];
    const visited = new Set();
    const cellKey = cell => `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;

    // Build a map from grid-key to cell.
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      cellMap.set(cellKey(cell), cell);
    });

    // Offsets for 26 neighbors in 3D.
    const neighborOffsets = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          neighborOffsets.push({ dx, dy, dz });
        }
      }
    }

    // Flood-fill each unvisited cell.
    this.cubesData.forEach(cell => {
      const key = cellKey(cell);
      if (visited.has(key)) return;
      const cluster = { cells: [] };
      const queue = [cell];
      visited.add(key);

      while (queue.length) {
        const current = queue.shift();
        cluster.cells.push(current);
        const { ix, iy, iz } = current.grid;
        neighborOffsets.forEach(offset => {
          const neighborKey = `${ix + offset.dx},${iy + offset.dy},${iz + offset.dz}`;
          if (cellMap.has(neighborKey) && !visited.has(neighborKey)) {
            visited.add(neighborKey);
            queue.push(cellMap.get(neighborKey));
          }
        });
      }
      // Compute volume and centroid.
      cluster.volume = cluster.cells.length;
      const centroid = new THREE.Vector3(0, 0, 0);
      cluster.cells.forEach(c => centroid.add(c.tcPos));
      centroid.divideScalar(cluster.volume);
      cluster.centroid = centroid;
      clusters.push(cluster);
    });
    return clusters;
  }

  /**
   * Classify the clusters into regions (Lake, Sea, Ocean).
   * Returns an array of region objects: { type, volume, centroid, cells }.
   */
  classifyRegions() {
    const clusters = this.clusterCells();
    if (clusters.length === 0) return [];
    // Determine maximum volume among clusters
    const V_max = Math.max(...clusters.map(c => c.volume));

    // Classify each cluster:
    //   - If volume < lakeVolumeThreshold => Lake.
    //   - Else if volume >= 0.5 * V_max => Ocean.
    //   - Else => Sea.
    clusters.forEach(cluster => {
      if (cluster.volume < this.lakeVolumeThreshold) {
        cluster.type = 'Lake';
      } else if (cluster.volume >= 0.5 * V_max) {
        cluster.type = 'Ocean';
      } else {
        cluster.type = 'Sea';
      }
    });

    return clusters;
  }

  /**
   * Creates or updates region labels for the classified empty-space regions.
   * Each label is a mesh (a plane with a canvas texture) that displays the region’s name.
   * The label is positioned at the cluster centroid (projected to Globe space).
   * Returns an array of label objects.
   */
  createRegionLabels() {
    // First remove any old region labels.
    this.regionLabels.forEach(label => {
      if (label.parent) {
        label.parent.remove(label);
      }
    });
    this.regionLabels = [];

    const clusters = this.classifyRegions();
    clusters.forEach((cluster, idx) => {
      // Build a label string. (You could later add constellation names if desired.)
      const labelText = `${cluster.type}`;
      // Create a canvas texture for the label.
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const baseFontSize = 48;
      ctx.font = `${baseFontSize}px Arial`;
      const textWidth = ctx.measureText(labelText).width;
      canvas.width = textWidth + 20;
      canvas.height = baseFontSize * 1.2;
      // Draw semi-transparent background.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Draw the text in white.
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, 10, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
      });
      // Create a plane for the label.
      const planeGeom = new THREE.PlaneGeometry(canvas.width / 100, canvas.height / 100);
      const labelMesh = new THREE.Mesh(planeGeom, material);
      labelMesh.renderOrder = 2;

      // Position: project the cluster centroid onto the Globe.
      const radius = 100;
      const tc = cluster.centroid;
      // Compute RA and dec from TC coordinates.
      const r = tc.length();
      const ra = Math.atan2(-tc.z, -tc.x);
      const dec = Math.asin(tc.y / r);
      const projectedPos = new THREE.Vector3(
        -radius * Math.cos(dec) * Math.cos(ra),
         radius * Math.sin(dec),
        -radius * Math.cos(dec) * Math.sin(ra)
      );
      labelMesh.position.copy(projectedPos);

      // Orient the label so that it is tangent to the sphere.
      const normal = projectedPos.clone().normalize();
      labelMesh.lookAt(projectedPos.clone().add(normal));
      // Optionally, add a slight offset outward.
      labelMesh.position.add(normal.multiplyScalar(2));

      // Store the label object (you might add additional properties, e.g. region id)
      cluster.labelMesh = labelMesh;
      this.regionLabels.push(labelMesh);
    });
    return this.regionLabels;
  }

  /**
   * Update method called on each frame (or when density mapping parameters change).
   * Adjusts visibility and opacity of grid cubes based on a slider (isolationVal) and
   * updates adjacent lines.
   */
  update(stars) {
    const densitySlider = document.getElementById('density-slider');
    const toleranceSlider = document.getElementById('tolerance-slider');
    if (!densitySlider || !toleranceSlider) return;
    
    const isolationVal = parseFloat(densitySlider.value) || 1;
    const toleranceVal = parseInt(toleranceSlider.value) || 0;
    
    this.cubesData.forEach(cell => {
      let isoDist = Infinity;
      if (cell.distances.length > toleranceVal) {
        isoDist = cell.distances[toleranceVal];
      }
      const showSquare = isoDist >= isolationVal;
      let ratio = cell.tcPos.length() / this.maxDistance;
      if (ratio > 1) ratio = 1;
      const alpha = THREE.MathUtils.lerp(0.1, 0.3, ratio);
      
      cell.tcMesh.visible = showSquare;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.visible = showSquare;
      cell.globeMesh.material.opacity = alpha;
      const scale = THREE.MathUtils.lerp(1.5, 0.5, ratio);
      cell.globeMesh.scale.set(scale, scale, 1);
    });
    
    this.adjacentLines.forEach(obj => {
      const { line, cell1, cell2 } = obj;
      if (cell1.globeMesh.visible && cell2.globeMesh.visible) {
        const points = getGreatCirclePoints(cell1.globeMesh.position, cell2.globeMesh.position, 100, 16);
        line.geometry.setFromPoints(points);
        line.visible = true;
      } else {
        line.visible = false;
      }
    });
    
    // Optionally, update region labels positions if needed.
    // For simplicity, we re-create the labels each update.
    // (You might wish to cache and update them more intelligently.)
  }
}

///////////////////////
// HELPER FUNCTIONS
///////////////////////

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

///////////////////////
// EXPORT FUNCTIONS
///////////////////////

export function initDensityOverlay(maxDistance, starArray) {
  densityGrid = new DensityGridOverlay(maxDistance, 2);
  densityGrid.createGrid(starArray);
  // (Optional: you might immediately add the grid cubes and adjacent lines to your scene.)
  return densityGrid;
}

export function updateDensityMapping(starArray) {
  if (!densityGrid) return;
  densityGrid.update(starArray);
  // After updating the grid, create/update region labels.
  const regionLabels = densityGrid.createRegionLabels();
  // It is up to your main script to add these label meshes to your scene.
  // For example, you might iterate over regionLabels and add each to your trueCoordinatesMap and globeMap scenes.
  // (See script.js updateDensityMapping() for an example of adding objects.)
}

