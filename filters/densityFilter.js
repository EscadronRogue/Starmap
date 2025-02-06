// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

/* --------------------------------------------------------------------------
   Helper: getDoubleSidedLabelMaterial
   (Copied from our LabelManager logic so that density labels use the same shader
    as the constellation labels on the Globe.)
-------------------------------------------------------------------------- */
function getDoubleSidedLabelMaterial(texture, opacity = 1.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: { value: opacity }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec2 uvCorrected = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
        vec4 color = texture2D(map, uvCorrected);
        gl_FragColor = vec4(color.rgb, color.a * opacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide
  });
}

/* --------------------------------------------------------------------------
   DensityGridOverlay Class
-------------------------------------------------------------------------- */
class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = []; // Final regions (including independent basins and branches)
    this.regionLabelsGroupTC = new THREE.Group(); // For TrueCoordinates map
    this.regionLabelsGroupGlobe = new THREE.Group(); // For Globe map
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
          
          // TrueCoordinates: create a cube.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // Globe: use a plane.
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
    const directions = [{dx:1,dy:0,dz:0}, {dx:0,dy:1,dz:0}, {dx:0,dy:0,dz:1}];
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

  /* ------------------------------------------------------------------------
     SEGMENTATION & CLASSIFICATION
     
     The algorithm first groups active cells via flood–fill.
     
     • Clusters with ≤2 cells are Lakes.
     
     • For clusters with >2 cells, we perform an iterative erosion:
         – Remove cells with fewer than 3 neighbors (within the cluster).
         – The remaining cells form the "core."
     
     • Then we compute connected components on the core (if more than one, each is an independent basin).
     
     • Next, the removed cells (cells in the original cluster but not in the core) are grouped into
       branch candidates. For each branch, we compute the set of distinct core components (by index)
       that the branch touches.
         – If the branch touches at least 2 different core components, it is a Strait (connecting two
           different independent basins).
         – Otherwise, it is a Gulf.
     
     • For clusters that yield no branches, the entire cluster is treated as an independent basin.
     
     • Finally, among independent basins (the core components), those with volume ≥50% of the largest
       are labeled as Ocean; the others as Sea.
     
     • For naming, for each region (independent basin or branch) the dominant constellation is computed
       (using only that region’s cells), and the label is formatted in the same manner as star labels.
     
     • For label placement, the region’s “best cell” is chosen as the one with the highest connectivity
       (i.e. the most neighbors within the region).
  ------------------------------------------------------------------------ */
  classifyEmptyRegions() {
    // Flood-fill: group active cells into clusters.
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
    
    let regions = [];
    clusters.forEach((cells, idx) => {
      if (cells.length <= 2) {
        // Label small clusters as Lake.
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          dominantConst: getDominantConstellation(computeConstCount(cells)),
          type: 'Lake',
          bestCell: computeInterconnectedCell(cells)
        });
      } else {
        // For clusters with >2 cells, perform segmentation.
        const seg = this.segmentCluster(cells);
        // If we get more than one core component, each becomes an independent basin.
        if (seg.cores.length > 1) {
          seg.cores.forEach(coreComp => {
            regions.push({
              clusterId: idx,
              cells: coreComp,
              volume: coreComp.length,
              dominantConst: getDominantConstellation(computeConstCount(coreComp)),
              type: 'IndependentBasin',
              bestCell: computeInterconnectedCell(coreComp)
            });
          });
        } else {
          // Single core component.
          regions.push({
            clusterId: idx,
            cells: seg.cores.length > 0 ? seg.cores[0] : cells,
            volume: seg.cores.length > 0 ? seg.cores[0].length : cells.length,
            dominantConst: getDominantConstellation(computeConstCount(seg.cores.length > 0 ? seg.cores[0] : cells)),
            type: 'IndependentBasin',
            bestCell: computeInterconnectedCell(seg.cores.length > 0 ? seg.cores[0] : cells)
          });
        }
        // Process branches.
        seg.branches.forEach(branch => {
          // Determine unique core components that this branch touches.
          let touchedCores = branch.touchedCores; // already computed in segmentCluster
          let bType = (touchedCores.size >= 2) ? 'Strait' : 'Gulf';
          regions.push({
            clusterId: idx + '_branch',
            cells: branch.cells,
            volume: branch.cells.length,
            dominantConst: getDominantConstellation(computeConstCount(branch.cells)),
            type: bType,
            bestCell: computeInterconnectedCell(branch.cells)
          });
        });
      }
    });
    
    // Among independent basins (regions with type 'IndependentBasin'), determine maximum volume.
    let independentBasins = regions.filter(r => r.type === 'IndependentBasin');
    let maxVolume = 0;
    independentBasins.forEach(r => { if (r.volume > maxVolume) maxVolume = r.volume; });
    independentBasins.forEach(r => {
      r.type = (r.volume >= 0.5 * maxVolume) ? 'Ocean' : 'Sea';
    });
    
    // Finally, assign final labels.
    regions.forEach(r => {
      r.label = `${r.type} ${r.dominantConst}`;
    });
    
    this.regionClusters = regions;
    return regions;
  }

  /**
   * SEGMENT CLUSTER:
   * Given an array of cells (a cluster), perform iterative erosion to remove cells with fewer than 3 neighbors.
   * Then, compute connected components on the remaining cells (the "core"). Also, group the removed cells
   * (i.e. those not in the core) into branches. For each branch, determine which core components (by index)
   * the branch contacts.
   *
   * Returns an object: { cores: Array of core components, branches: Array of branch objects }.
   * Each branch object is of the form { cells: [cells], touchedCores: Set of indices }.
   */
  segmentCluster(cells) {
    // Iterative erosion.
    let coreCells = cells.slice();
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
          changed = true;
        } else {
          nextCore.push(cell);
        }
      }
      coreCells = nextCore;
    }
    
    // Compute connected components among coreCells.
    let cores = [];
    let visitedCore = new Set();
    for (let cell of coreCells) {
      if (visitedCore.has(cell.id)) continue;
      let comp = [];
      let stack = [cell];
      while (stack.length > 0) {
        let current = stack.pop();
        if (visitedCore.has(current.id)) continue;
        visitedCore.add(current.id);
        comp.push(current);
        for (let other of coreCells) {
          if (!visitedCore.has(other.id)) {
            if (Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
                Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
                Math.abs(current.grid.iz - other.grid.iz) <= 1) {
              stack.push(other);
            }
          }
        }
      }
      cores.push(comp);
    }
    
    // Branches: cells in the original cluster that are not in coreCells.
    let removedCells = cells.filter(c => !coreCells.includes(c));
    let branches = [];
    let visitedBranch = new Set();
    for (let cell of removedCells) {
      if (visitedBranch.has(cell.id)) continue;
      let branchComp = [];
      let stack = [cell];
      while (stack.length > 0) {
        let current = stack.pop();
        if (visitedBranch.has(current.id)) continue;
        visitedBranch.add(current.id);
        branchComp.push(current);
        for (let other of removedCells) {
          if (!visitedBranch.has(other.id)) {
            if (Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
                Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
                Math.abs(current.grid.iz - other.grid.iz) <= 1) {
              stack.push(other);
            }
          }
        }
      }
      // Determine which core components this branch touches.
      let touchedCores = new Set();
      branchComp.forEach(bCell => {
        cores.forEach((comp, index) => {
          comp.forEach(coreCell => {
            if (Math.abs(bCell.grid.ix - coreCell.grid.ix) <= 1 &&
                Math.abs(bCell.grid.iy - coreCell.grid.iy) <= 1 &&
                Math.abs(bCell.grid.iz - coreCell.grid.iz) <= 1) {
              touchedCores.add(index);
            }
          });
        });
      });
      branches.push({ cells: branchComp, touchedCores });
    }
    
    return { cores, branches };
  }
  
  /**
   * Creates a region label as a THREE.Sprite using the same rules and format as star/constellation labels.
   *
   * @param {string} text - The label text.
   * @param {THREE.Vector3} position - The position where the label will be placed.
   * @param {string} mapType - "Globe" or "TrueCoordinates".
   * @returns {THREE.Sprite|THREE.Mesh} - The label object.
   */
  createRegionLabel(text, position, mapType) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const baseFontSize = (mapType === 'Globe' ? 64 : 24);
    ctx.font = `${baseFontSize}px Arial`;
    const textWidth = ctx.measureText(text).width;
    canvas.width = textWidth + 20;
    canvas.height = baseFontSize * 1.2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${baseFontSize}px Arial`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 10, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    let labelObj;
    if (mapType === 'Globe') {
      const planeGeom = new THREE.PlaneGeometry((canvas.width / 100), (canvas.height / 100));
      const material = getDoubleSidedLabelMaterial(texture, 1.0);
      labelObj = new THREE.Mesh(planeGeom, material);
      labelObj.renderOrder = 1;
    } else {
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        depthWrite: true,
        depthTest: true,
        transparent: true,
      });
      labelObj = new THREE.Sprite(spriteMaterial);
      const scaleFactor = 0.05;
      labelObj.scale.set((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor, 1);
    }
    labelObj.position.copy(position);
    return labelObj;
  }

  /**
   * For the Globe map, projects a position onto a sphere of radius 100.
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
   * Removes any existing region label group from the scene and adds new labels.
   * The label for each region is placed at the "best cell" (the most interconnected cell).
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
}

/* --------------------------------------------------------------------------
   Helper Functions
-------------------------------------------------------------------------- */

/**
 * Computes the arithmetic centroid (average position) of a set of cells.
 */
function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

/**
 * Computes a count object for the constellations of the given cells.
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
 * Returns the dominant constellation name from a count object.
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
 * Computes the cell with the highest connectivity (number of neighbors within the set).
 * This cell is used for label placement.
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
 * (This simple RA-based partition may be replaced with a more advanced method.)
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
