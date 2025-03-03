// /filters/densityGridOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getBlueColor, lightenColor, darkenColor, getGreenColor } from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, segmentOceanCandidate } from './densitySegmentation.js';
import { loadConstellationCenters, getConstellationCenters, loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance for grid cells (in light years).
   * @param {number} maxDistance - Maximum distance for grid cells (in light years).
   * @param {number} gridSize - Size of each grid cell.
   * @param {string} mode - "low" or "high" (affects coloring/logic).
   */
  constructor(minDistance, maxDistance, gridSize = 2, mode = "low") {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.gridSize = gridSize;
    this.mode = mode; // "low" or "high"
    this.cubesData = [];
    this.adjacentLines = [];
    // These groups are used later for labeling regions.
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
  }

  createGrid(stars) {
    this.cubesData = [];
    // Define grid limits based on the maximum distance.
    const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
    for (let x = -halfExt; x < halfExt; x += this.gridSize) {
      for (let y = -halfExt; y < halfExt; y += this.gridSize) {
        for (let z = -halfExt; z < halfExt; z += this.gridSize) {
          // Calculate the center of this cell.
          const pos = new THREE.Vector3(
            x + this.gridSize / 2,
            y + this.gridSize / 2,
            z + this.gridSize / 2
          );
          const dist = pos.length();
          // Only include cells whose center is between minDistance and maxDistance.
          if (dist < this.minDistance || dist > this.maxDistance) continue;
          // Create a cube mesh to represent the cell.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: (this.mode === "low") ? 0x0000ff : 0x00ff00,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cube = new THREE.Mesh(geometry, material);
          cube.position.copy(pos);
          const cell = {
            tcMesh: cube,
            grid: { ix: Math.round(x / this.gridSize), iy: Math.round(y / this.gridSize), iz: Math.round(z / this.gridSize) },
            tcPos: pos,
            active: false,
            distances: []
          };
          this.cubesData.push(cell);
        }
      }
    }
    // For each cell, compute the distances from its center to each star.
    this.cubesData.forEach(cell => {
      cell.distances = stars.map(star => {
        const starPos = star.truePosition
          ? star.truePosition
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        return cell.tcPos.distanceTo(starPos);
      }).sort((a, b) => a - b);
      cell.nearestStar = stars.find(star => {
        const starPos = star.truePosition
          ? star.truePosition
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        return cell.tcPos.distanceTo(starPos) === cell.distances[0];
      });
    });
    this.computeAdjacentLines();
  }

  computeAdjacentLines() {
    this.adjacentLines = [];
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
      cellMap.set(key, cell);
    });
    const directions = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          // To avoid duplicates, only push one direction per pair.
          if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) {
            directions.push({ dx, dy, dz });
          }
        }
      }
    }
    directions.forEach(dir => {
      this.cubesData.forEach(cell => {
        const neighborKey = `${cell.grid.ix + dir.dx},${cell.grid.iy + dir.dy},${cell.grid.iz + dir.dz}`;
        if (cellMap.has(neighborKey)) {
          const neighbor = cellMap.get(neighborKey);
          const points = getGreatCirclePoints(cell.tcPos, neighbor.tcPos, this.maxDistance, 16);
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
            linewidth: 1
          });
          const line = new THREE.Line(geometry, material);
          this.adjacentLines.push({ line, cell1: cell, cell2: neighbor });
        }
      });
    });
  }

  update(stars) {
    // Recompute each cell's distances to stars.
    this.cubesData.forEach(cell => {
      cell.distances = stars.map(star => {
        const starPos = star.truePosition
          ? star.truePosition
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        return cell.tcPos.distanceTo(starPos);
      }).sort((a, b) => a - b);
      cell.nearestStar = stars.find(star => {
        const starPos = star.truePosition
          ? star.truePosition
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        return cell.tcPos.distanceTo(starPos) === cell.distances[0];
      });
    });
    // Additional update logic (e.g., activating cells based on density criteria) remains unchanged.
  }

  // Additional methods (e.g., assignConstellationsToCells, addRegionLabelsToScene) can be added here.
}
