// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * We no longer import { currentFilteredStars } from ../script.js.
 * Instead, we'll accept the star array as a parameter in initDensityOverlay() and updateDensityMapping().
 */

let densityGrid = null;

/**
 * Internal class to handle the grid/cubes for density mapping.
 */
class DensityGridOverlay {
  constructor(maxDistance, gridSize=2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
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

          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);

          // Mirror on globe
          let geometry2 = geometry.clone();
          let material2 = material.clone();

          let projectedPos;
          if (distFromCenter < 1e-6) {
            projectedPos = new THREE.Vector3(0,0,0);
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
          const cubeGlobe = new THREE.Mesh(geometry2, material2);
          cubeGlobe.position.copy(projectedPos);
          if (distFromCenter > 1e-6) {
            cubeGlobe.lookAt(0,0,0);
          }

          this.cubesData.push({
            tcMesh: cubeTC,
            globeMesh: cubeGlobe,
            tcPos: posTC,
            distances: []
          });
        }
      }
    }
    this.computeDistances(stars);
  }

  computeDistances(stars) {
    this.cubesData.forEach(cell => {
      const dArr = stars.map(star => {
        const dx = cell.tcPos.x - star.x_coordinate;
        const dy = cell.tcPos.y - star.y_coordinate;
        const dz = cell.tcPos.z - star.z_coordinate;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
      });
      dArr.sort((a,b) => a - b);
      cell.distances = dArr;
    });
  }

  update(stars) {
    // If star data changes drastically, we might want to re-run computeDistances.
    // For now, let's assume star set is stable
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
      const showCube = (isoDist >= isolationVal);
      let ratio = isoDist / this.maxDistance;
      if (ratio > 1) ratio = 1;
      const alpha = THREE.MathUtils.lerp(0.0, 1.0, ratio);

      cell.tcMesh.visible = showCube;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.visible = showCube;
      cell.globeMesh.material.opacity = alpha;
    });
  }
}

/**
 * Creates the density overlay once, based on the final star set.
 * Returns the array of {tcMesh, globeMesh} objects so we can add them to each scene.
 */
export function initDensityOverlay(maxDistance, starArray) {
  densityGrid = new DensityGridOverlay(maxDistance, 2);
  densityGrid.createGrid(starArray);
  return densityGrid.cubesData; // The script adds them to the scenes
}

/**
 * Called after user changes the slider, or filters change the star set, etc.
 */
export function updateDensityMapping(starArray) {
  if (!densityGrid) return;
  // If star set changed drastically, we might do "densityGrid.computeDistances(starArray);" again
  densityGrid.update(starArray);
}
