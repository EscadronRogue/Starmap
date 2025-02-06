// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Updated density filter that builds a 3D grid of empty cubes,
 * clusters them using flood‑fill (26‑neighbor connectivity),
 * and classifies each contiguous region as follows:
 * 
 *   - Lake: volume < lakeVolumeThreshold (small, isolated cluster)
 *   - Ocean: independent basin with volume ≥ 0.5 * V_max
 *   - Sea: any other independent basin
 * 
 * It then creates region labels (using canvas textures) following the
 * same methodology as the other labels in the program.
 */

let densityGrid = null;

class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = []; // Each cell: { tcMesh, globeMesh, tcPos, grid, distances }
    this.adjacentLines = []; // Array of objects { line, cell1, cell2 }
    this.regionLabels = [];  // Array to hold region label meshes
    this.lakeVolumeThreshold = 3; // Volume threshold (in cube count) to classify as Lake
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
          
          // Create a cube for the TrueCoordinates view.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // For the Globe, use a flat square (plane) instead of a cube.
          const planeGeom = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
          const material2 = material.clone();
          const squareGlobe = new THREE.Mesh(planeGeom, material2);
          
          let projectedPos;
          if (distFromCenter < 1e-6) {
            projectedPos = new THREE.Vector3(0, 0, 0);
          } else {
            // Compute RA and dec from TC coordinates.
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
  
  // Cluster the cubes using flood‑fill (26‑neighbor connectivity).
  clusterCells() {
    const clusters = [];
    const visited = new Set();
    const cellKey = cell => `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
    
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      cellMap.set(cellKey(cell), cell);
    });
    
    // Offsets for all 26 neighbors.
    const neighborOffsets = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          neighborOffsets.push({ dx, dy, dz });
        }
      }
    }
    
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
      
      cluster.volume = cluster.cells.length;
      const centroid = new THREE.Vector3(0, 0, 0);
      cluster.cells.forEach(c => centroid.add(c.tcPos));
      centroid.divideScalar(cluster.volume);
      cluster.centroid = centroid;
      clusters.push(cluster);
    });
    
    return clusters;
  }
  
  // Classify clusters into regions.
  classifyRegions() {
    const clusters = this.clusterCells();
    if (clusters.length === 0) return [];
    const V_max = Math.max(...clusters.map(c => c.volume));
    
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
  
  // Create region labels (canvas-based plane meshes) for each classified region.
  createRegionLabels() {
    // Remove any old region labels.
    this.regionLabels.forEach(label => {
      if (label.parent) {
        label.parent.remove(label);
      }
    });
    this.regionLabels = [];
    
    const clusters = this.classifyRegions();
    clusters.forEach(cluster => {
      const labelText = `${cluster.type}`;
      // Create a canvas for the label.
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
      // Draw the label text in white.
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
      const planeGeom = new THREE.PlaneGeometry(canvas.width / 100, canvas.height / 100);
      const labelMesh = new THREE.Mesh(planeGeom, material);
      labelMesh.renderOrder = 2;
      
      // Project the cluster centroid onto the Globe.
      const radius = 100;
      const tc = cluster.centroid;
      const r = tc.length();
      const ra = Math.atan2(-tc.z, -tc.x);
      const dec = Math.asin(tc.y / r);
      const projectedPos = new THREE.Vector3(
        -radius * Math.cos(dec) * Math.cos(ra),
         radius * Math.sin(dec),
        -radius * Math.cos(dec) * Math.sin(ra)
      );
      labelMesh.position.copy(projectedPos);
      
      // Orient the label tangentially to the sphere.
      const normal = projectedPos.clone().normalize();
      labelMesh.lookAt(projectedPos.clone().add(normal));
      labelMesh.position.add(normal.multiplyScalar(2)); // Offset outward
      
      cluster.labelMesh = labelMesh;
      this.regionLabels.push(labelMesh);
    });
    return this.regionLabels;
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
}

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
  // Update (or create) region labels.
  densityGrid.createRegionLabels();
}
