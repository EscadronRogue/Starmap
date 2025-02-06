// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

/**
 * The DensityGridOverlay class now not only builds the 3D grid of cubes but also:
 * - Computes each cell’s distance to the stars.
 * - Sets an “active” flag based on a user‐controlled isolation value.
 * - Provides methods to run a flood‑fill (26‑neighbor) on the active cells, classifying
 *   contiguous regions as Lake, Gulf, Strait, Ocean, or Sea.
 * - Creates text labels (as Sprites) for each region.
 */
class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    // Each adjacent line object will store { line, cell1, cell2 }
    this.adjacentLines = [];
    // After clustering, we store region (cluster) data here.
    this.regionClusters = [];
    // We'll also keep groups for region labels for each map type.
    this.regionLabelsGroupTC = new THREE.Group(); // TrueCoordinates labels
    this.regionLabelsGroupGlobe = new THREE.Group(); // Globe labels
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
          
          // Build a cube (for the TrueCoordinates map)
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // For the Globe map, use a flat square (plane)
          const planeGeom = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
          const material2 = material.clone();
          const squareGlobe = new THREE.Mesh(planeGeom, material2);
          
          let projectedPos;
          if (distFromCenter < 1e-6) {
            projectedPos = new THREE.Vector3(0, 0, 0);
          } else {
            // Compute RA and dec from posTC (note the reversed x/z for the Globe)
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
            distances: [],
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false // will be set during update()
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
      cell.active = showSquare;
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
  }

  /**
   * Runs a flood‑fill (using 26‑neighbor connectivity) on all active (visible) cells
   * to group them into clusters. For each cluster the method computes:
   * – Volume (number of cells)
   * – Bounding box (in grid coordinates)
   * – Centroid (average of tcPos)
   * – The set of neighboring clusters.
   * Then, based on simple rules, each cluster is classified as:
   *   • Lake (very small or isolated)
   *   • Gulf (attached by only one neighbor)
   *   • Strait (if very elongated and thin)
   *   • Otherwise, an “independent basin” which is later re‑labeled as Ocean or Sea
   *     (Ocean if its volume is at least 50% of the largest independent basin).
   * Finally, a name (e.g. "Ocean 1") is assigned.
   *
   * @returns {Array} Array of cluster objects with properties: volume, centroid, type, label, etc.
   */
  classifyEmptyRegions() {
    // Assign unique id and reset cluster id for each cell.
    this.cubesData.forEach((cell, index) => {
      cell.id = index;
      cell.clusterId = null;
    });
    // Build a map (key = "ix,iy,iz") for active cells.
    const gridMap = new Map();
    this.cubesData.forEach((cell, index) => {
      if (cell.active) {
        const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
        gridMap.set(key, index);
      }
    });
    const clusters = [];
    const visited = new Set();
    for (let i = 0; i < this.cubesData.length; i++) {
      const cell = this.cubesData[i];
      if (!cell.active || visited.has(cell.id)) continue;
      const clusterCells = [];
      const stack = [cell];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        clusterCells.push(current);
        // Look in all 26 neighbor directions.
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const neighborKey = `${current.grid.ix + dx},${current.grid.iy + dy},${current.grid.iz + dz}`;
              if (gridMap.has(neighborKey)) {
                const neighborIndex = gridMap.get(neighborKey);
                const neighborCell = this.cubesData[neighborIndex];
                if (!visited.has(neighborCell.id)) {
                  stack.push(neighborCell);
                }
              }
            }
          }
        }
      }
      clusters.push(clusterCells);
    }
    // Compute properties for each cluster.
    const clusterData = clusters.map((cells, clusterId) => {
      const volume = cells.length;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let sumPos = new THREE.Vector3(0, 0, 0);
      cells.forEach(cell => {
        cell.clusterId = clusterId;
        const ix = cell.grid.ix, iy = cell.grid.iy, iz = cell.grid.iz;
        if (ix < minX) minX = ix;
        if (ix > maxX) maxX = ix;
        if (iy < minY) minY = iy;
        if (iy > maxY) maxY = iy;
        if (iz < minZ) minZ = iz;
        if (iz > maxZ) maxZ = iz;
        sumPos.add(cell.tcPos);
      });
      const centroid = sumPos.divideScalar(volume);
      const bbox = { minX, maxX, minY, maxY, minZ, maxZ };
      return { clusterId, cells, volume, centroid, bbox, neighbors: new Set(), type: null, label: '' };
    });
    // Determine neighboring clusters.
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      const currentClusterId = cell.clusterId;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const neighborKey = `${cell.grid.ix + dx},${cell.grid.iy + dy},${cell.grid.iz + dz}`;
            if (gridMap.has(neighborKey)) {
              const neighborIndex = gridMap.get(neighborKey);
              const neighborCell = this.cubesData[neighborIndex];
              if (neighborCell.clusterId !== currentClusterId) {
                clusterData[currentClusterId].neighbors.add(neighborCell.clusterId);
              }
            }
          }
        }
      }
    });
    // Classify clusters:
    const lakeThreshold = 5; // clusters smaller than this are Lakes
    clusterData.forEach(cluster => {
      if (cluster.volume < lakeThreshold) {
        cluster.type = 'Lake';
      } else if (cluster.neighbors.size === 0) {
        cluster.type = 'Lake';
      } else if (cluster.neighbors.size === 1) {
        cluster.type = 'Gulf';
      } else if (cluster.neighbors.size >= 2) {
        const dx = cluster.bbox.maxX - cluster.bbox.minX + 1;
        const dy = cluster.bbox.maxY - cluster.bbox.minY + 1;
        const dz = cluster.bbox.maxZ - cluster.bbox.minZ + 1;
        const minDim = Math.min(dx, dy, dz);
        const maxDim = Math.max(dx, dy, dz);
        if (minDim === 0) {
          cluster.type = 'IndependentBasin';
        } else {
          const aspectRatio = maxDim / minDim;
          if (aspectRatio > 3 && cluster.volume < 0.5 * (dx * dy * dz)) {
            cluster.type = 'Strait';
          } else {
            cluster.type = 'IndependentBasin';
          }
        }
      }
    });
    // Among independent basins, determine the maximum volume and then classify them as Ocean or Sea.
    const independentBasins = clusterData.filter(c => c.type === 'IndependentBasin');
    let maxVolume = 0;
    independentBasins.forEach(c => {
      if (c.volume > maxVolume) maxVolume = c.volume;
    });
    independentBasins.forEach(c => {
      if (c.volume >= 0.5 * maxVolume) {
        c.type = 'Ocean';
      } else {
        c.type = 'Sea';
      }
    });
    // Assign names using counters.
    let oceanCount = 0, seaCount = 0, gulfCount = 0, lakeCount = 0, straitCount = 0;
    clusterData.forEach(c => {
      if (c.type === 'Ocean') {
        oceanCount++;
        c.label = `Ocean ${oceanCount}`;
      } else if (c.type === 'Sea') {
        seaCount++;
        c.label = `Sea ${seaCount}`;
      } else if (c.type === 'Gulf') {
        gulfCount++;
        c.label = `Gulf ${gulfCount}`;
      } else if (c.type === 'Lake') {
        lakeCount++;
        c.label = `Lake ${lakeCount}`;
      } else if (c.type === 'Strait') {
        straitCount++;
        c.label = `Strait ${straitCount}`;
      }
    });
    this.regionClusters = clusterData;
    return clusterData;
  }

  /**
   * Creates a text label as a THREE.Sprite for the given text and position.
   * The label’s style (font size, scale) depends on the map type.
   *
   * @param {string} text - The text to display.
   * @param {THREE.Vector3} position - The 3D position at which to place the label.
   * @param {string} mapType - Either "Globe" or "TrueCoordinates".
   * @returns {THREE.Sprite} - The created label sprite.
   */
  createRegionLabel(text, position, mapType) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = mapType === 'Globe' ? 48 : 24;
    ctx.font = `${fontSize}px Arial`;
    const textWidth = ctx.measureText(text).width;
    canvas.width = textWidth + 20;
    canvas.height = fontSize * 1.2;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, 10, fontSize);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    const scaleFactor = mapType === 'Globe' ? 0.1 : 0.05;
    sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
    sprite.position.copy(position);
    return sprite;
  }

  /**
   * For the Globe map, projects a position (given in TrueCoordinates) onto the sphere of radius 100.
   *
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3} - The projected position.
   */
  projectToGlobe(position) {
    const dist = position.length();
    if (dist < 1e-6) return new THREE.Vector3(0, 0, 0);
    const ra = Math.atan2(-position.z, -position.x);
    const dec = Math.asin(position.y / dist);
    const radius = 100;
    return new THREE.Vector3(
      -radius * Math.cos(dec) * Math.cos(ra),
       radius * Math.sin(dec),
      -radius * Math.cos(dec) * Math.sin(ra)
    );
  }

  /**
   * Removes any existing region label group from the given scene and creates new labels
   * based on the current classification. Depending on the mapType, the cluster centroid is
   * used directly (for TrueCoordinates) or projected (for Globe).
   *
   * @param {THREE.Scene} scene - The scene to add the labels to.
   * @param {string} mapType - Either "Globe" or "TrueCoordinates".
   */
  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) {
        this.regionLabelsGroupTC.parent.remove(this.regionLabelsGroupTC);
      }
      this.regionLabelsGroupTC = new THREE.Group();
    } else if (mapType === 'Globe') {
      if (this.regionLabelsGroupGlobe.parent) {
        this.regionLabelsGroupGlobe.parent.remove(this.regionLabelsGroupGlobe);
      }
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    // Classify the current empty regions.
    const clusters = this.classifyEmptyRegions();
    clusters.forEach(cluster => {
      let labelPos;
      if (mapType === 'TrueCoordinates') {
        labelPos = cluster.centroid;
      } else if (mapType === 'Globe') {
        labelPos = this.projectToGlobe(cluster.centroid);
      }
      const labelSprite = this.createRegionLabel(cluster.label, labelPos, mapType);
      if (mapType === 'TrueCoordinates') {
        this.regionLabelsGroupTC.add(labelSprite);
      } else if (mapType === 'Globe') {
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });
    // Add the group to the scene.
    scene.add(mapType === 'TrueCoordinates' ? this.regionLabelsGroupTC : this.regionLabelsGroupGlobe);
  }
}

/**
 * Helper function to compute points along a great‑circle path between two points on a sphere.
 *
 * @param {THREE.Vector3} p1 - Starting position.
 * @param {THREE.Vector3} p2 - Ending position.
 * @param {number} R - Sphere radius.
 * @param {number} segments - Number of segments.
 * @returns {Array} - Array of THREE.Vector3 points.
 */
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

export function initDensityOverlay(maxDistance, starArray) {
  densityGrid = new DensityGridOverlay(maxDistance, 2);
  densityGrid.createGrid(starArray);
  return densityGrid;
}

export function updateDensityMapping(starArray) {
  if (!densityGrid) return;
  densityGrid.update(starArray);
}

