// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

// --- New: Load constellation center data ---
// We use a synchronous XMLHttpRequest to load "constellation_center.txt" so that
// the density filter can assign constellation names consistent with the globe labels.
let densityCenterData = null;

function loadDensityCenterData() {
  if (densityCenterData !== null) return;
  densityCenterData = [];
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "constellation_center.txt", false); // synchronous request
    xhr.send(null);
    if (xhr.status === 200) {
      const raw = xhr.responseText;
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length < 5) continue;
        const raStr = parts[2];
        const decStr = parts[3];
        const matchName = line.match(/"([^"]+)"/);
        const name = matchName ? matchName[1] : 'Unknown';
        const raVal = parseRA(raStr);
        const decVal = parseDec(decStr);
        densityCenterData.push({ ra: raVal, dec: decVal, name });
      }
      console.log(`[DensityFilter] Loaded ${densityCenterData.length} constellation centers.`);
    }
  } catch (err) {
    console.error("Error loading constellation_center.txt synchronously:", err);
  }
}

// --- Helper conversion functions (copied from constellationFilter.js) ---
function degToRad(d) {
  return d * Math.PI / 180;
}

function parseRA(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(x => parseFloat(x));
  const hours = hh + mm / 60 + ss / 3600;
  const deg = hours * 15;
  return degToRad(deg);
}

function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const stripped = decStr.replace('+', '').replace('-', '');
  const [dd, mm, ss] = stripped.split(':').map(x => parseFloat(x));
  const degVal = (dd + mm / 60 + ss / 3600) * sign;
  return degToRad(degVal);
}

// --- End new constellation center loading ---

/* --------------------------------------------------------------------------
   Helper: getDoubleSidedLabelMaterial
   (Used for Globe labels so they render double–sided and follow the same
    orientation as our star/constellation labels.)
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
    this.regionClusters = []; // Final regions (independent basins and branches)
    // Groups for region labels
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
          
          // TrueCoordinates: create a cube.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff, // Temporary; will be overwritten by updateRegionColors()
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
          // For Globe, orient the square tangent to the sphere.
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
          // Generate a series of points along a great-circle between the two cells.
          const points = getGreatCirclePoints(cell.globeMesh.position, neighbor.globeMesh.position, 100, 16);
          // Create a BufferGeometry with vertex positions and vertex colors (gradient from cell1 to cell2).
          const positions = [];
          const colors = [];
          const c1 = cell.globeMesh.material.color;
          const c2 = neighbor.globeMesh.material.color;
          for (let i = 0; i < points.length; i++) {
            positions.push(points[i].x, points[i].y, points[i].z);
            let t = i / (points.length - 1);
            let r = THREE.MathUtils.lerp(c1.r, c2.r, t);
            let g = THREE.MathUtils.lerp(c1.g, c2.g, t);
            let b = THREE.MathUtils.lerp(c1.b, c2.b, t);
            colors.push(r, g, b);
          }
          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
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
    
    // Update adjacent lines with new positions and gradient colors.
    this.adjacentLines.forEach(obj => {
      const { line, cell1, cell2 } = obj;
      if (cell1.globeMesh.visible && cell2.globeMesh.visible) {
        const points = getGreatCirclePoints(cell1.globeMesh.position, cell2.globeMesh.position, 100, 16);
        const positions = [];
        const colors = [];
        const c1 = cell1.globeMesh.material.color;
        const c2 = cell2.globeMesh.material.color;
        for (let i = 0; i < points.length; i++) {
          positions.push(points[i].x, points[i].y, points[i].z);
          let t = i / (points.length - 1);
          let r = THREE.MathUtils.lerp(c1.r, c2.r, t);
          let g = THREE.MathUtils.lerp(c1.g, c2.g, t);
          let b = THREE.MathUtils.lerp(c1.b, c2.b, t);
          colors.push(r, g, b);
        }
        line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        line.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        line.geometry.attributes.position.needsUpdate = true;
        line.geometry.attributes.color.needsUpdate = true;
        line.visible = true;
      } else {
        line.visible = false;
      }
    });
  }

  /* ------------------------------------------------------------------------
     SEGMENTATION & CLASSIFICATION
     
     1. Flood-fill active cells into clusters.
     2. Clusters with ≤2 cells are Lakes.
     3. For clusters with >2 cells:
         a. Iteratively erode cells with fewer than 3 neighbors to produce the "core".
         b. Compute connected components of the core. (If >1, treat each as an independent basin.)
         c. Group the removed cells (cells not in core) into branch components.
         d. For each branch, compute the set of distinct core components it touches.
            – If a branch touches ≥2 different cores (i.e. connects two different independent basins), classify it as a Strait.
            – Otherwise, classify it as a Gulf.
            – Also, ignore branches that are too short (e.g. fewer than 5 cells or maximum branch length < 3×gridSize).
         e. If no branch is detected, treat the entire cluster as an independent basin.
     4. Among independent basins, label as Ocean if volume ≥50% of the largest independent basin; otherwise, as Sea.
     5. For each region, compute the dominant constellation (using only that region’s cells).
     6. For label placement, choose the "best cell" (the cell with the highest connectivity) instead of the centroid.
  ------------------------------------------------------------------------ */
  classifyEmptyRegions() {
    // Flood-fill: group active cells.
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
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          dominantConst: getDominantConstellation(computeConstCount(cells)),
          type: 'Lake',
          bestCell: computeInterconnectedCell(cells)
        });
      } else {
        const seg = this.segmentCluster(cells);
        // Merge branch components with identical touchedCores.
        let mergedBranches = mergeBranches(seg.branches);
        // Only include branches that are significant.
        mergedBranches = mergedBranches.filter(branch => branch.cells.length >= 5 && computeBranchLength(branch.cells) >= 3 * this.gridSize);
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
          regions.push({
            clusterId: idx,
            cells: seg.cores.length > 0 ? seg.cores[0] : cells,
            volume: seg.cores.length > 0 ? seg.cores[0].length : cells.length,
            dominantConst: getDominantConstellation(computeConstCount(seg.cores.length > 0 ? seg.cores[0] : cells)),
            type: 'IndependentBasin',
            bestCell: computeInterconnectedCell(seg.cores.length > 0 ? seg.cores[0] : cells)
          });
        }
        mergedBranches.forEach(branch => {
          let bType = (branch.touchedCores.size >= 2) ? 'Strait' : 'Gulf';
          regions.push({
            clusterId: idx + '_branch',
            cells: branch.cells,
            volume: branch.cells.length,
            dominantConst: getDominantConstellation(computeConstCount(branch.cells)),
            type: bType,
            bestCell: computeInterconnectedCell(branch.cells),
            touchedCores: branch.touchedCores
          });
        });
      }
    });
    
    // Among independent basins, determine maximum volume.
    let independentBasins = regions.filter(r => r.type === 'IndependentBasin');
    let maxVolume = 0;
    independentBasins.forEach(r => { if (r.volume > maxVolume) maxVolume = r.volume; });
    independentBasins.forEach(r => {
      r.type = (r.volume >= 0.5 * maxVolume) ? 'Ocean' : 'Sea';
    });
    
    regions.forEach(r => {
      r.label = `${r.type} ${r.dominantConst}`;
    });
    
    this.regionClusters = regions;
    return regions;
  }

  /**
   * SEGMENT CLUSTER:
   * Given a cluster (array of cells), iteratively erode cells with fewer than 3 neighbors
   * to form the core, then group the removed cells into branch components. For each branch,
   * compute the set of distinct core indices it touches.
   *
   * Returns: { cores: Array of core arrays, branches: Array of branch objects }.
   * Each branch object is { cells: [cells], touchedCores: Set }.
   */
  segmentCluster(cells) {
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
    // Branches: cells not in the core.
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
   * updateRegionColors:
   * Updates each cell's material color based on its region.
   * Independent regions (Ocean, Sea, Lake) are assigned distinct colors.
   * Branch regions (Gulf, Strait) are given a gradient from the parent's color(s) to white.
   */
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    // Assign distinct colors to independent regions.
    const independentRegions = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    const colorMap = assignDistinctColorsToIndependent(independentRegions);
    // Update cell colors.
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        let col = region.color; // from assignDistinctColorsToIndependent
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(col);
          cell.globeMesh.material.color.set(col);
        });
      } else if (region.type === 'Gulf' || region.type === 'Strait') {
        // For branch regions, use a gradient.
        let parentColor = new THREE.Color('#0099FF');
        if (region.type === 'Gulf' && region.touchedCores && region.touchedCores.size === 1) {
          let coreIndex = Array.from(region.touchedCores)[0];
          independentRegions.forEach(r => {
            if (r.clusterId == coreIndex) {
              parentColor = r.color;
            }
          });
        } else if (region.type === 'Strait' && region.touchedCores && region.touchedCores.size >= 2) {
          let cols = [];
          region.touchedCores.forEach(coreIndex => {
            independentRegions.forEach(r => {
              if (r.clusterId == coreIndex) {
                cols.push(r.color);
              }
            });
          });
          if (cols.length > 0) {
            let sumR = 0, sumG = 0, sumB = 0;
            cols.forEach(c => {
              sumR += c.r;
              sumG += c.g;
              sumB += c.b;
            });
            sumR /= cols.length;
            sumG /= cols.length;
            sumB /= cols.length;
            parentColor = new THREE.Color(sumR, sumG, sumB);
          }
        }
        let maxDist = 0;
        region.cells.forEach(cell => {
          let d = cell.tcPos.distanceTo(region.bestCell.tcPos);
          if (d > maxDist) maxDist = d;
        });
        region.cells.forEach(cell => {
          let d = cell.tcPos.distanceTo(region.bestCell.tcPos);
          let factor = maxDist > 0 ? d / maxDist : 0;
          let col = parentColor.clone().lerp(new THREE.Color('#ffffff'), factor);
          cell.tcMesh.material.color.set(col);
          cell.globeMesh.material.color.set(col);
        });
      }
    });
  }

  /**
   * createRegionLabel:
   * Creates a region label using the same formatting as star/constellation labels.
   * For TrueCoordinates the base font size is 400 (so labels are huge).
   * For the Globe map, after creating a plane, the label is oriented so that its "up"
   * vector is the projection of the global up (0,1,0) onto the tangent plane at its position,
   * exactly as in our star/constellation labels.
   */
  createRegionLabel(text, position, mapType) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const baseFontSize = (mapType === 'Globe' ? 300 : 400);
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
      const planeGeom = new THREE.PlaneGeometry(canvas.width / 100, canvas.height / 100);
      const material = getDoubleSidedLabelMaterial(texture, 1.0);
      labelObj = new THREE.Mesh(planeGeom, material);
      labelObj.renderOrder = 1;
      // Orient the label: its up should be the projection of global up onto the tangent plane.
      const normal = position.clone().normalize();
      const globalUp = new THREE.Vector3(0, 1, 0);
      let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
      if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
      else desiredUp.normalize();
      const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
      const matrix = new THREE.Matrix4().makeBasis(desiredRight, desiredUp, normal);
      labelObj.setRotationFromMatrix(matrix);
    } else {
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        depthWrite: true,
        depthTest: true,
        transparent: true,
      });
      labelObj = new THREE.Sprite(spriteMaterial);
      const scaleFactor = 0.22;
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
   * addRegionLabelsToScene:
   * Removes any existing region label group from the scene and adds new labels.
   * The label for each region is placed at the position of the "best cell" (the most interconnected cell)
   * rather than at the arithmetic centroid.
   */
  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) scene.remove(this.regionLabelsGroupTC);
      this.regionLabelsGroupTC = new THREE.Group();
    } else if (mapType === 'Globe') {
      if (this.regionLabelsGroupGlobe.parent) scene.remove(this.regionLabelsGroupGlobe);
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    // Update cell colors based on region classification.
    this.updateRegionColors();
    const regions = this.classifyEmptyRegions();
    regions.forEach(region => {
      let labelPos;
      if (region.bestCell) {
        labelPos = region.bestCell.tcPos;
      } else {
        labelPos = computeCentroid(region.cells);
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
   Helper Functions for Segmentation and Naming
-------------------------------------------------------------------------- */

function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}

function computeConstCount(cells) {
  let count = {};
  cells.forEach(c => {
    let name = getConstellationForCell(c);
    count[name] = (count[name] || 0) + 1;
  });
  return count;
}

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
 * Updated getConstellationForCell:
 * Now it first loads constellation center data from "constellation_center.txt"
 * (using the same logic as in the constellation filter). If available, it uses
 * those centers (converted from radians to degrees) to compute the angular
 * distance from the cell’s position (converted to RA/DEC in degrees).
 * If no center data is available, it falls back to a hardcoded list.
 */
function getConstellationForCell(cell) {
  loadDensityCenterData();
  const pos = cell.tcPos;
  const r = pos.length();
  if (r < 1e-6) return "Unknown";
  const ra = Math.atan2(-pos.z, -pos.x);
  let normRa = ra;
  if (normRa < 0) normRa += 2 * Math.PI;
  const raDeg = THREE.MathUtils.radToDeg(normRa);
  const dec = Math.asin(pos.y / r);
  const decDeg = THREE.MathUtils.radToDeg(dec);
  if (isNaN(decDeg)) return "Unknown";

  if (densityCenterData && densityCenterData.length > 0) {
    let best = densityCenterData[0];
    let bestDist = angularDistance(raDeg, decDeg, THREE.Math.radToDeg(best.ra), THREE.Math.radToDeg(best.dec));
    for (let i = 1; i < densityCenterData.length; i++) {
      const center = densityCenterData[i];
      const d = angularDistance(raDeg, decDeg, THREE.Math.radToDeg(center.ra), THREE.Math.radToDeg(center.dec));
      if (d < bestDist) {
        bestDist = d;
        best = center;
      }
    }
    return best.name;
  } else {
    // Fallback hardcoded list (values in degrees)
    const centers = [
      { name: "Orion", ra: 83, dec: -5 },
      { name: "Gemini", ra: 100, dec: 20 },
      { name: "Taurus", ra: 65, dec: 15 },
      { name: "Leo", ra: 152, dec: 12 },
      { name: "Scorpius", ra: 255, dec: -30 },
      { name: "Cygnus", ra: 310, dec: 40 },
      { name: "Pegasus", ra: 330, dec: 20 }
    ];
    let best = centers[0];
    let bestDist = angularDistance(raDeg, decDeg, best.ra, best.dec);
    for (let i = 1; i < centers.length; i++) {
      const center = centers[i];
      const d = angularDistance(raDeg, decDeg, center.ra, center.dec);
      if (d < bestDist) {
        bestDist = d;
        best = center;
      }
    }
    return best.name;
  }
}

/**
 * Helper to compute angular distance (in degrees) between two points on a sphere
 * given in RA and DEC (both in degrees).
 */
function angularDistance(ra1, dec1, ra2, dec2) {
  const r1 = THREE.Math.degToRad(ra1);
  const d1 = THREE.Math.degToRad(dec1);
  const r2 = THREE.Math.degToRad(ra2);
  const d2 = THREE.Math.degToRad(dec2);
  const cosDist = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  const clamped = Math.min(Math.max(cosDist, -1), 1);
  const dist = Math.acos(clamped);
  return THREE.Math.radToDeg(dist);
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

function computeBranchLength(cells) {
  let maxDist = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      let d = cells[i].tcPos.distanceTo(cells[j].tcPos);
      if (d > maxDist) maxDist = d;
    }
  }
  return maxDist;
}

/**
 * Merges branch objects that have the same set of touchedCores.
 */
function mergeBranches(branches) {
  let merged = {};
  branches.forEach(branch => {
    let key = Array.from(branch.touchedCores).sort().join(',');
    if (!merged[key]) {
      merged[key] = { cells: [], touchedCores: new Set(branch.touchedCores) };
    }
    merged[key].cells = merged[key].cells.concat(branch.cells);
  });
  return Object.values(merged);
}

/**
 * assignDistinctColorsToIndependent:
 * Given an array of independent regions (of type Ocean, Sea, or Lake),
 * assign each a distinct color by distributing hues evenly.
 * Returns a mapping from region.clusterId to the assigned THREE.Color,
 * and also assigns region.color.
 */
function assignDistinctColorsToIndependent(regions) {
  const colorMap = {};
  const types = ['Ocean', 'Sea', 'Lake'];
  types.forEach(type => {
    const group = regions.filter(r => r.type === type);
    const count = group.length;
    group.forEach((region, i) => {
      let hue = (360 * i / count) % 360;
      if (type === 'Ocean') hue = (hue + 240) % 360;   // Blue tones.
      else if (type === 'Sea') hue = (hue + 200) % 360;  // Lighter blue.
      else if (type === 'Lake') hue = (hue + 160) % 360; // Cyan.
      const col = new THREE.Color(`hsl(${hue}, 70%, 50%)`);
      region.color = col;
      colorMap[region.clusterId] = col;
    });
  });
  return colorMap;
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
