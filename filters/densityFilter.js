// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * We no longer import { currentFilteredStars } from ../script.js.
 * Instead, we'll accept the star array as a parameter in initDensityOverlay() and updateDensityMapping().
 */

let densityGrid = null;

/**
 * Internal class to handle the grid and 2D squares for density mapping.
 */
class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    this.adjacentLines = [];
  }

  createGrid(stars) {
    const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
    this.cubesData = [];
    // Create grid cells
    for (let x = -halfExt; x <= halfExt; x += this.gridSize) {
      for (let y = -halfExt; y <= halfExt; y += this.gridSize) {
        for (let z = -halfExt; z <= halfExt; z += this.gridSize) {
          const posTC = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
          const distFromCenter = posTC.length();
          if (distFromCenter > this.maxDistance) continue;

          // TrueCoordinates cube (unchanged)
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

          // Compute projection: map tcPos onto a sphere of radius 100.
          let projectedPos;
          if (distFromCenter < 1e-6) {
            projectedPos = new THREE.Vector3(0, 0, 0);
          } else {
            const theta = Math.atan2(posTC.y, posTC.x);
            const phi = Math.acos(posTC.z / distFromCenter);
            const radius = 100;
            projectedPos = new THREE.Vector3(
              radius * Math.sin(phi) * Math.cos(theta),
              radius * Math.cos(phi),
              radius * Math.sin(phi) * Math.sin(theta)
            );
          }
          squareGlobe.position.copy(projectedPos);
          // Orient the square tangent to the sphere.
          const normal = projectedPos.clone().normalize();
          squareGlobe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

          // Store grid indices for later adjacent-line detection.
          const cell = {
            tcMesh: cubeTC,
            globeMesh: squareGlobe,
            tcPos: posTC,
            distances: [],
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
        const dx = cell.tcPos.x - star.x_coordinate;
        const dy = cell.tcPos.y - star.y_coordinate;
        const dz = cell.tcPos.z - star.z_coordinate;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      });
      dArr.sort((a, b) => a - b);
      cell.distances = dArr;
    });
  }

  computeAdjacentLines() {
    // Clear previous lines.
    this.adjacentLines.forEach(line => line.geometry.dispose());
    this.adjacentLines = [];
    // For each cell, check for neighbors in the 6 face-adjacent directions.
    const directions = [
      { dx: 1, dy: 0, dz: 0 },
      { dx: -1, dy: 0, dz: 0 },
      { dx: 0, dy: 1, dz: 0 },
      { dx: 0, dy: -1, dz: 0 },
      { dx: 0, dy: 0, dz: 1 },
      { dx: 0, dy: 0, dz: -1 }
    ];
    // Create a lookup map for quick neighbor search.
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
      cellMap.set(key, cell);
    });
    directions.forEach(dir => {
      this.cubesData.forEach(cell => {
        const neighborKey = `${cell.grid.ix + dir.dx},${cell.grid.iy + dir.dy},${cell.grid.iz + dir.dz}`;
        if (cellMap.has(neighborKey)) {
          const neighbor = cellMap.get(neighborKey);
          // To avoid duplicate lines, only add if current cell's key is less than neighbor's.
          const cellKey = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
          if (cellKey < neighborKey) {
            const geom = new THREE.BufferGeometry().setFromPoints([
              cell.globeMesh.position,
              neighbor.globeMesh.position
            ]);
            const mat = new THREE.LineBasicMaterial({
              color: 0x0000ff,
              transparent: true,
              opacity: 0.3,
              linewidth: 1
            });
            const line = new THREE.Line(geom, mat);
            line.renderOrder = 1;
            this.adjacentLines.push(line);
          }
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
      // Normalize ratio based on tcPos length
      let ratio = cell.tcPos.length() / this.maxDistance;
      if (ratio > 1) ratio = 1;
      // For alpha, use a low maximum (e.g. 0.3)
      const alpha = THREE.MathUtils.lerp(0.1, 0.3, ratio);

      cell.tcMesh.visible = showSquare;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.visible = showSquare;
      cell.globeMesh.material.opacity = alpha;
      // Adjust scale based on true distance: closer cells appear larger.
      const scale = THREE.MathUtils.lerp(1.5, 0.5, ratio);
      cell.globeMesh.scale.set(scale, scale, 1);
    });
    // (Assuming grid structure doesn't change, adjacent lines remain fixed.)
  }
}

/**
 * Creates the density overlay once, based on the final star set.
 * Returns the density overlay object (with cubesData and adjacentLines).
 */
export function initDensityOverlay(maxDistance, starArray) {
  densityGrid = new DensityGridOverlay(maxDistance, 2);
  densityGrid.createGrid(starArray);
  return densityGrid;
}

/**
 * Called after user changes the slider, or filters change the star set, etc.
 */
export function updateDensityMapping(starArray) {
  if (!densityGrid) return;
  densityGrid.update(starArray);
}
