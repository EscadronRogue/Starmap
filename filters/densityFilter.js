// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

/**
 * DensityGridOverlay builds a 3D grid (of cubes) inside a sphere (radius = maxDistance).
 * It computes distances from stars, flags a cell as “active” if its tolerance-indexed distance
 * is at least the isolation value, and groups active cells via 26-neighbor flood-fill.
 *
 * Then for each contiguous region (cluster) the algorithm segments it into a “core”
 * (the main body) and any narrow branch(es) by iteratively eroding cells with fewer than 3 neighbors.
 *
 * For each narrow branch, the number of distinct connection points with the core is computed.
 * If the branch touches the core at only one point it is classified as a Gulf;
 * if it connects two (or more) independent basins (i.e. the refined neighbor set has size ≥2),
 * then it is a Strait.
 *
 * Clusters with only 1–2 cells are labeled as Lake.
 * Remaining (core) clusters that are not narrow are independent basins; among these,
 * if the volume is at least 50% of the largest independent basin, the basin is an Ocean;
 * otherwise, it is a Sea.
 *
 * Each region is assigned a label using the dominant constellation (computed only from its own cells)
 * and the type. Moreover, the label position is chosen as the position of the most interconnected cell
 * (rather than the arithmetic centroid).
 *
 * The final label takes the form: "<Type> <DominantConstellation>" (for example, "Ocean Orion" or "Strait Gemini").
 *
 * The class also provides a method to add these region labels (as THREE.Sprite objects) to a scene.
 */
class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    // Each adjacent line object stores { line, cell1, cell2 }
    this.adjacentLines = [];
    // After clustering, we store region data here.
    this.regionClusters = [];
    // Groups for region labels (for TrueCoordinates and Globe maps)
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
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
          
          // Create cube for TrueCoordinates map.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // For Globe map, use a flat plane.
          const planeGeom = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
          const material2 = material.clone();
          const squareGlobe = new THREE.Mesh(planeGeom, material2);
          
          let projectedPos;
          if (distFromCenter < 1e-6) {
            projectedPos = new THREE.Vector3(0, 0, 0);
          } else {
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
            distances: [],
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false
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
        let starPos = star.truePosition
          ? star.truePosition
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
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
   * SEGMENTATION & CLASSIFICATION
   *
   * 1. Group active cells using 26-neighbor flood-fill.
   * 2. For clusters with ≤2 cells, mark as Lake.
   * 3. For clusters with >2 cells, perform segmentation:
   *    – Use an iterative erosion (removing cells with fewer than 3 neighbors within the cluster)
   *      to extract the “core” (main body) and the removed cells are candidate branches.
   *    – For each branch, count the number of distinct connection points to the core.
   *         • If a branch connects in only one spot, it is a Gulf.
   *         • If it connects in two or more spots—and the independent basins connected are different—it is a Strait.
   * 4. For clusters with no branches, treat the whole cluster as an independent basin.
   * 5. Among independent basins (the cores), if a basin’s volume is ≥50% of the largest then label it Ocean;
   *    otherwise label it Sea.
   * 6. For naming, determine the dominant constellation from the cells of the region.
   * 7. For label placement, choose the cell within the region that has the highest connectivity
   *    (the “most interconnected” cell) rather than the arithmetic centroid.
   *
   * @returns {Array} Array of region objects.
   */
  classifyEmptyRegions() {
    // Reset cluster IDs.
    this.cubesData.forEach((cell, index) => {
      cell.id = index;
      cell.clusterId = null;
    });
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
      let clusterCells = [];
      let stack = [cell];
      while (stack.length > 0) {
        let current = stack.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        clusterCells.push(current);
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

    // Process each cluster.
    let regions = [];
    clusters.forEach((cells, idx) => {
      if (cells.length <= 2) {
        // Small clusters: Lake.
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          dominantConst: getDominantConstellation(computeConstCount(cells)),
          type: 'Lake',
          bestCell: computeInterconnectedCell(cells) // choose most connected cell for label
        });
      } else {
        // For clusters >2, perform segmentation.
        const seg = this.segmentCluster(cells);
        if (seg.branches.length > 0) {
          // Core is the main body.
          if (seg.core.length > 0) {
            regions.push({
              clusterId: idx,
              cells: seg.core,
              volume: seg.core.length,
              dominantConst: getDominantConstellation(computeConstCount(seg.core)),
              type: 'IndependentBasin',
              bestCell: computeInterconnectedCell(seg.core)
            });
          }
          // Process each branch.
          seg.branches.forEach(branch => {
            // For each branch, use the branch's best cell.
            // Classify branch as Gulf if connectionCount === 1; if ≥2, then (if the two connected independent basins are different) as Strait.
            let bType = (branch.connectionCount === 1) ? 'Gulf' : 'Strait';
            regions.push({
              clusterId: idx + '_branch',
              cells: branch.cells,
              volume: branch.cells.length,
              dominantConst: getDominantConstellation(computeConstCount(branch.cells)),
              type: bType,
              bestCell: computeInterconnectedCell(branch.cells)
            });
          });
        } else {
          // No branches: treat entire cluster as independent basin.
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            dominantConst: getDominantConstellation(computeConstCount(cells)),
            type: 'IndependentBasin',
            bestCell: computeInterconnectedCell(cells)
          });
        }
      }
    });
    // Among independent basins, determine maximum volume.
    let independentBasins = regions.filter(r => r.type === 'IndependentBasin');
    let maxVolume = 0;
    independentBasins.forEach(r => { if (r.volume > maxVolume) maxVolume = r.volume; });
    independentBasins.forEach(r => {
      r.type = (r.volume >= 0.5 * maxVolume) ? 'Ocean' : 'Sea';
    });
    // Finally, assign labels using the region’s dominant constellation.
    regions.forEach(r => {
      r.label = `${r.type} ${r.dominantConst}`;
    });
    this.regionClusters = regions;
    return regions;
  }

  /**
   * Creates a text label (THREE.Sprite) for the given text at the given position.
   * This function is modeled after the star/constellation label creation.
   *
   * @param {string} text - The label text.
   * @param {THREE.Vector3} position - The 3D position.
   * @param {string} mapType - "Globe" or "TrueCoordinates".
   * @returns {THREE.Sprite} - The label sprite.
   */
  createRegionLabel(text, position, mapType) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const baseFontSize = (mapType === 'Globe' ? 64 : 24);
    ctx.font = `${baseFontSize}px Arial`;
    const textWidth = ctx.measureText(text).width;
    canvas.width = textWidth + 20;
    canvas.height = baseFontSize * 1.2;
    ctx.font = `${baseFontSize}px Arial`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 10, baseFontSize);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    const scaleFactor = (mapType === 'Globe' ? 0.1 : 0.05);
    sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
    sprite.position.copy(position);
    return sprite;
  }

  /**
   * For the Globe map, projects a position onto a sphere of radius 100.
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
   * Removes any existing region label group from the scene and adds new labels based on the current classification.
   * Instead of using the centroid of a region, this method uses the "best cell" (the most interconnected cell)
   * as the label position.
   *
   * @param {THREE.Scene} scene - The scene to add labels to.
   * @param {string} mapType - "Globe" or "TrueCoordinates".
   */
  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) scene.remove(this.regionLabelsGroupTC);
      this.regionLabelsGroupTC = new THREE.Group();
    } else if (mapType === 'Globe') {
      if (this.regionLabelsGroupGlobe.parent) scene.remove(this.regionLabelsGroupGlobe);
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    const regions = this.classifyEmptyRegions();
    regions.forEach(region => {
      let labelPos;
      // Use the "best cell" position rather than the arithmetic centroid.
      if (region.bestCell) {
        labelPos = region.bestCell.tcPos;
      } else {
        labelPos = region.centroid;
      }
      if (mapType === 'Globe') {
        labelPos = this.projectToGlobe(labelPos);
      }
      const labelSprite = this.createRegionLabel(region.label, labelPos, mapType);
      if (mapType === 'TrueCoordinates') {
        this.regionLabelsGroupTC.add(labelSprite);
      } else if (mapType === 'Globe') {
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });
    scene.add(mapType === 'TrueCoordinates' ? this.regionLabelsGroupTC : this.regionLabelsGroupGlobe);
  }

  /**
   * SEGMENT CLUSTER:
   * Given an array of cells (a cluster), perform iterative erosion:
   * repeatedly remove cells that have fewer than 3 neighbors within the cluster.
   * The remaining cells form the "core" and the removed cells are grouped (by connectivity)
   * into branch candidates. For each branch, count how many distinct core cells are adjacent.
   *
   * Returns an object: { core: [cells], branches: [ { cells: [cells], connectionCount } ] }.
   */
  segmentCluster(cells) {
    let coreCells = cells.slice();
    let removedCells = [];
    let changed = true;
    while (changed) {
      changed = false;
      let nextCore = [];
      for (let cell of coreCells) {
        let count = 0;
        for (let other of coreCells) {
          if (cell === other) continue;
          if (Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
              Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
              Math.abs(cell.grid.iz - other.grid.iz) <= 1) {
            count++;
          }
        }
        if (count < 3) {
          removedCells.push(cell);
          changed = true;
        } else {
          nextCore.push(cell);
        }
      }
      coreCells = nextCore;
    }
    // Group removed cells into branches.
    let branches = [];
    let visited = new Set();
    for (let cell of removedCells) {
      if (visited.has(cell.id)) continue;
      let branch = [];
      let stack = [cell];
      while (stack.length > 0) {
        let current = stack.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        branch.push(current);
        for (let other of removedCells) {
          if (visited.has(other.id)) continue;
          if (Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
              Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
              Math.abs(current.grid.iz - other.grid.iz) <= 1) {
            stack.push(other);
          }
        }
      }
      // For each branch, count how many distinct core cells are adjacent.
      let connectionSet = new Set();
      branch.forEach(bCell => {
        coreCells.forEach(coreCell => {
          if (Math.abs(bCell.grid.ix - coreCell.grid.ix) <= 1 &&
              Math.abs(bCell.grid.iy - coreCell.grid.iy) <= 1 &&
              Math.abs(bCell.grid.iz - coreCell.grid.iz) <= 1) {
            connectionSet.add(coreCell.id);
          }
        });
      });
      branches.push({ cells: branch, connectionCount: connectionSet.size });
    }
    return { core: coreCells, branches };
  }
}

/* HELPER FUNCTIONS */

/**
 * Computes the arithmetic centroid (average position) of an array of cells.
 */
function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

/**
 * Computes a simple object counting the occurrences of constellation names in the given cells.
 */
function computeConstCount(cells) {
  let count = {};
  cells.forEach(c => {
    let name = getConstellationForCell(c);
    count[name] = (count[name] || 0) + 1;
  });
  return count;
}

/**
 * Given a count object, returns the name with the highest count.
 */
function getDominantConstellation(countObj) {
  let dom = 'Unknown';
  let max = 0;
  for (let name in countObj) {
    if (countObj[name] > max) {
      max = countObj[name];
      dom = name;
    }
  }
  return dom;
}

/**
 * Computes and returns the cell (from an array) that has the highest connectivity
 * (i.e. the largest number of neighbors within the same array). This cell is used for label placement.
 */
function computeInterconnectedCell(cells) {
  let bestCell = cells[0];
  let maxCount = 0;
  cells.forEach(cell => {
    let count = 0;
    cells.forEach(other => {
      if (cell === other) return;
      if (Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
          Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
          Math.abs(cell.grid.iz - other.grid.iz) <= 1) {
        count++;
      }
    });
    if (count > maxCount) {
      maxCount = count;
      bestCell = cell;
    }
  });
  return bestCell;
}

/**
 * Helper: Returns a constellation name for a cell based on its tcPos.
 * (This simple partition by RA can be replaced with a more advanced method.)
 */
function getConstellationForCell(cell) {
  const pos = cell.tcPos;
  let ra = Math.atan2(-pos.z, -pos.x);
  if (ra < 0) ra += 2 * Math.PI;
  const raDeg = THREE.MathUtils.radToDeg(ra);
  if (raDeg < 60) return "Orion";
  else if (raDeg < 120) return "Gemini";
  else if (raDeg < 180) return "Taurus";
  else if (raDeg < 240) return "Leo";
  else if (raDeg < 300) return "Scorpius";
  else return "Cygnus";
}

/**
 * Computes points along a great-circle path between two points on a sphere.
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
