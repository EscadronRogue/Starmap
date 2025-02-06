// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Instead of subdividing a 3D cube and projecting its centers,
 * we now build a grid directly on the sphere.
 * We choose an angular step (in degrees) for RA and DEC.
 *
 * Each grid cell is defined by a (ra, dec) pair and lies exactly on the sphere of radius 100.
 *
 * We also compute, for each cell, a sorted array of distances (in Euclidean space) 
 * from the cell’s center to all stars’ projected positions (star.spherePosition).
 *
 * The grid overlay can then be updated (e.g. by hiding cells with too-low density).
 */

let densityGrid = null;

class DensityGridOverlay {
  /**
   * @param {number} angularStepDeg – the angular step in degrees for both RA and DEC
   */
  constructor(angularStepDeg = 10) {
    // Convert the step into radians.
    this.angularStep = THREE.Math.degToRad(angularStepDeg);
    this.cells = [];       // Array of grid cells (each corresponds to a (ra,dec) center)
    this.adjacentLines = []; // For drawing connections between neighboring cells
  }

  /**
   * Creates a grid on the sphere.
   * We will cover DEC from -80° to +80° (to avoid extreme distortions at the poles)
   * and RA from 0° to 360°.
   * For each (ra, dec) pair, we compute the cell’s center using the standard conversion.
   * We also create a flat plane (a square) at that center (oriented tangent to the sphere).
   *
   * @param {Array} stars – the full star array; each star must already have star.spherePosition set.
   */
  createGrid(stars) {
    this.cells = [];
    const R = 100;
    const decMin = THREE.Math.degToRad(-80);
    const decMax = THREE.Math.degToRad(80);
    const raMin = 0;
    const raMax = 2 * Math.PI;
    // Loop over DEC and RA.
    for (let dec = decMin; dec <= decMax; dec += this.angularStep) {
      for (let ra = raMin; ra < raMax; ra += this.angularStep) {
        // Compute the cell center on the sphere.
        const center = new THREE.Vector3(
          -R * Math.cos(dec) * Math.cos(ra),
           R * Math.sin(dec),
          -R * Math.cos(dec) * Math.sin(ra)
        );
        // Create a plane geometry for the cell.
        // We choose the cell’s size proportional to the angular step.
        // (Here we use a scaling factor so that the cell covers roughly the angular area.)
        const cellSize = R * this.angularStep * 0.8; // 0.8 is an arbitrary scale to avoid overlap
        const planeGeom = new THREE.PlaneGeometry(cellSize, cellSize);
        const material = new THREE.MeshBasicMaterial({
          color: 0x0000ff,
          transparent: true,
          opacity: 0.2,
          depthWrite: false
        });
        const plane = new THREE.Mesh(planeGeom, material);
        plane.position.copy(center);
        // Orient the plane so that it is tangent to the sphere.
        const normal = center.clone().normalize();
        plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        // Save the cell.
        this.cells.push({
          ra: ra,
          dec: dec,
          center: center,
          planeMesh: plane,
          distances: []  // to be computed below
        });
      }
    }
    // Once all cells are created, compute their distances to the stars.
    this.computeDistances(stars);
    // (Optionally, you can compute adjacent lines if desired.)
    this.computeAdjacentLines();
  }

  /**
   * For each cell, compute the Euclidean distances (in 3D) between its center and every star’s spherePosition.
   * Then sort the distances.
   * @param {Array} stars – the full star array; each star should have star.spherePosition.
   */
  computeDistances(stars) {
    this.cells.forEach(cell => {
      const dArr = stars.map(star => {
        return cell.center.distanceTo(star.spherePosition);
      });
      dArr.sort((a, b) => a - b);
      cell.distances = dArr;
    });
  }

  /**
   * Computes adjacent lines between grid cells so that a grid mesh can be drawn.
   * For our spherical grid, we connect each cell to its neighbor in RA and also to one neighbor in DEC.
   */
  computeAdjacentLines() {
    this.adjacentLines = [];
    // Group cells by their dec index.
    const groups = {};
    this.cells.forEach(cell => {
      // Compute an index for dec; use the rounded value.
      const decIdx = Math.round((cell.dec - THREE.Math.degToRad(-80)) / this.angularStep);
      if (!groups[decIdx]) groups[decIdx] = [];
      groups[decIdx].push(cell);
    });
    // For each dec row, sort the cells by RA.
    for (const decIdx in groups) {
      groups[decIdx].sort((a, b) => a.ra - b.ra);
    }
    // Connect cells within each row (wrap-around).
    for (const decIdx in groups) {
      const row = groups[decIdx];
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        const nextCell = row[(i + 1) % row.length];
        const geom = new THREE.BufferGeometry().setFromPoints([cell.center, nextCell.center]);
        const mat = new THREE.LineBasicMaterial({
          color: 0x0000ff,
          transparent: true,
          opacity: 0.3,
          linewidth: 1
        });
        const line = new THREE.Line(geom, mat);
        this.adjacentLines.push({ line: line, cell1: cell, cell2: nextCell });
      }
    }
    // Connect cells in adjacent rows.
    const decIndices = Object.keys(groups).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < decIndices.length - 1; i++) {
      const rowA = groups[decIndices[i]];
      const rowB = groups[decIndices[i + 1]];
      // For each cell in rowA, connect it to the cell in rowB with the closest RA.
      rowA.forEach(cellA => {
        let closest = null;
        let minDiff = Infinity;
        rowB.forEach(cellB => {
          const diff = Math.abs(cellA.ra - cellB.ra);
          if (diff < minDiff) {
            minDiff = diff;
            closest = cellB;
          }
        });
        if (closest) {
          const geom = new THREE.BufferGeometry().setFromPoints([cellA.center, closest.center]);
          const mat = new THREE.LineBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 0.3,
            linewidth: 1
          });
          const line = new THREE.Line(geom, mat);
          this.adjacentLines.push({ line: line, cell1: cellA, cell2: closest });
        }
      });
    }
  }

  /**
   * Updates the grid overlay.
   * For each cell, based on the isolation value (from a slider) and the number of nearby stars,
   * adjust the cell’s visibility and opacity.
   * (The details of the mapping from distance to opacity are adjustable.)
   *
   * @param {Array} stars – the full star array.
   */
  update(stars) {
    const densitySlider = document.getElementById('density-slider');
    const toleranceSlider = document.getElementById('tolerance-slider');
    if (!densitySlider || !toleranceSlider) return;
    
    const isolationVal = parseFloat(densitySlider.value) || 1;
    const toleranceVal = parseInt(toleranceSlider.value) || 0;
    
    this.cells.forEach(cell => {
      let isoDist = Infinity;
      if (cell.distances.length > toleranceVal) {
        isoDist = cell.distances[toleranceVal];
      }
      const show = isoDist >= isolationVal;
      cell.planeMesh.visible = show;
      // Set opacity based on the isolation distance (tune as needed)
      const alpha = THREE.MathUtils.clamp(isoDist / 50, 0.1, 0.3);
      cell.planeMesh.material.opacity = alpha;
    });
    
    // Update adjacent lines so that they’re only visible if both connected cells are visible.
    this.adjacentLines.forEach(obj => {
      const { line, cell1, cell2 } = obj;
      line.visible = cell1.planeMesh.visible && cell2.planeMesh.visible;
    });
  }
}

export function initDensityOverlay(maxDistance, starArray) {
  // Here we choose an angular step of 10° (adjustable).
  densityGrid = new DensityGridOverlay(10);
  densityGrid.createGrid(starArray);
  return densityGrid;
}

export function updateDensityMapping(starArray) {
  if (!densityGrid) return;
  densityGrid.update(starArray);
}
