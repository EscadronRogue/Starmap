// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

// --- Load constellation center data for naming (synchronous load) ---
let densityCenterData = null;
function loadDensityCenterData() {
  if (densityCenterData !== null) return;
  densityCenterData = [];
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "constellation_center.txt", false); // synchronous
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

// --- Conversion Helpers (from constellationFilter.js) ---
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

// --- getDoubleSidedLabelMaterial (for Globe labels) ---
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

// --- DensityGridOverlay Class ---
class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = []; // Final regions after segmentation/classification
    // Groups for region labels (for TrueCoordinates and Globe)
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
          
          // TrueCoordinates: cube.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff, // Temporary; overwritten later.
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // Globe: plane.
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
          // Orient tangent to sphere.
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

  // ----- Segmentation & Classification -----
  // This function first groups active cells into clusters (via flood-fill on cubesData)
  // and then classifies each cluster relative to V_max.
  // Ocean candidates (volume >= 50% of V_max) are further segmented using relative connectivity.
  classifyEmptyRegions() {
    // Group active cells into clusters
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
    
    // Determine maximum volume among clusters
    let V_max = 0;
    clusters.forEach(cells => {
      if (cells.length > V_max) V_max = cells.length;
    });
    
    const regions = [];
    clusters.forEach((cells, idx) => {
      // Compute dominant constellation (using existing logic)
      const constCount = computeConstCount(cells);
      const dominantConst = getDominantConstellation(constCount);
      
      // Classification by volume relative to V_max:
      if (cells.length < 0.1 * V_max) {
        // Lake
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          dominantConst,
          type: "Lake",
          label: `Lake ${dominantConst}`,
          labelScale: 0.8,
          bestCell: computeInterconnectedCell(cells)
        });
      } else if (cells.length < 0.5 * V_max) {
        // Sea
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          dominantConst,
          type: "Sea",
          label: `Sea ${dominantConst}`,
          labelScale: 0.9,
          bestCell: computeInterconnectedCell(cells)
        });
      } else {
        // Ocean Candidate – attempt segmentation
        const segResult = segmentOceanCandidate(cells);
        if (!segResult.segmented) {
          // No segmentation performed: treat whole as Ocean
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            dominantConst,
            type: "Ocean",
            label: `Ocean ${dominantConst}`,
            labelScale: 1.0,
            bestCell: computeInterconnectedCell(cells)
          });
        } else {
          // Segmentation succeeded:
          // Among the resulting cores, designate the largest as the main Ocean.
          segResult.cores.sort((a, b) => b.length - a.length);
          const mainOcean = segResult.cores[0];
          regions.push({
            clusterId: idx,
            cells: mainOcean,
            volume: mainOcean.length,
            dominantConst,
            type: "Ocean",
            label: `Ocean ${dominantConst}`,
            labelScale: 1.0,
            bestCell: computeInterconnectedCell(mainOcean)
          });
          // Any other cores become Gulfs.
          for (let i = 1; i < segResult.cores.length; i++) {
            const gulf = segResult.cores[i];
            regions.push({
              clusterId: idx + "_gulf_" + i,
              cells: gulf,
              volume: gulf.length,
              dominantConst,
              type: "Gulf",
              label: `Gulf ${dominantConst}`,
              labelScale: 0.8,
              bestCell: computeInterconnectedCell(gulf)
            });
          }
          // Also, add the neck (if available) as a Strait.
          if (segResult.neck && segResult.neck.length > 0) {
            regions.push({
              clusterId: idx + "_neck",
              cells: segResult.neck,
              volume: segResult.neck.length,
              dominantConst,
              type: "Strait",
              label: `Strait`,
              labelScale: 0.7,
              bestCell: computeInterconnectedCell(segResult.neck)
            });
          }
        }
      }
    });
    
    this.regionClusters = regions;
    return regions;
  }

  /**
   * createRegionLabel:
   * Creates a region label using canvas-based text.
   */
  createRegionLabel(text, position, mapType) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Base font size depends on map type (Globe gets larger font)
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
      // Orient the label tangent to sphere.
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
   * Removes any existing region labels and adds new ones based on segmentation/classification.
   */
  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) scene.remove(this.regionLabelsGroupTC);
      this.regionLabelsGroupTC = new THREE.Group();
    } else if (mapType === 'Globe') {
      if (this.regionLabelsGroupGlobe.parent) scene.remove(this.regionLabelsGroupGlobe);
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    // Update cell colors (via segmentation classification)
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
      // Append label scale (we assume the label manager uses this scale later)
      const labelSprite = this.createRegionLabel(region.label, labelPos, mapType);
      labelSprite.userData.labelScale = region.labelScale;
      if (mapType === 'TrueCoordinates') {
        this.regionLabelsGroupTC.add(labelSprite);
      } else if (mapType === 'Globe') {
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });
    scene.add(mapType === 'TrueCoordinates' ? this.regionLabelsGroupTC : this.regionLabelsGroupGlobe);
  }

  /**
   * updateRegionColors:
   * For each region, assign colors based on its type.
   * Independent regions (Ocean, Sea, Lake) get a distinct base color.
   * For branch regions (Gulf/Strait) use a gradient from the ocean base color.
   */
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    // Assign base colors to independent regions (Ocean, Sea, Lake)
    const independentRegions = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    const colorMap = assignDistinctColorsToIndependent(independentRegions);
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        let col = region.color; // assigned by assignDistinctColorsToIndependent
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(col);
          cell.globeMesh.material.color.set(col);
        });
      } else if (region.type === 'Gulf' || region.type === 'Strait') {
        // For branch regions, use a gradient from the parent's color (from the corresponding ocean)
        let parentColor = new THREE.Color('#0099FF');
        // Look up the ocean region that has the same dominant constellation.
        independentRegions.forEach(r => {
          if (r.dominantConst === region.dominantConst) {
            parentColor = r.color;
          }
        });
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
}

// ----- New: Segmentation function for Ocean Candidates -----
// This function takes an array of cells (forming a cluster) and
// returns an object { segmented: Boolean, cores: [subclusters], neck: [cells] }.
function segmentOceanCandidate(cells) {
  // Compute connectivity for each cell (26-neighbor count within the cluster)
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
    cell.connectivity = count;
  });
  const C_avg = cells.reduce((sum, cell) => sum + cell.connectivity, 0) / cells.length;
  
  // Mark cells as "thin" if connectivity/C_avg < 0.7
  cells.forEach(cell => {
    cell.thin = (cell.connectivity / C_avg) < 0.7;
  });
  
  // Group thin cells using flood-fill (26-neighbor) on cells where cell.thin is true
  const thinCells = cells.filter(cell => cell.thin);
  const neckGroups = [];
  const visited = new Set();
  thinCells.forEach(cell => {
    if (visited.has(cell.id)) return;
    const group = [];
    const stack = [cell];
    while (stack.length > 0) {
      const current = stack.pop();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      group.push(current);
      // Look for adjacent thin cells in the overall cluster
      cells.forEach(other => {
        if (!visited.has(other.id) &&
            other.thin &&
            Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
            Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
            Math.abs(current.grid.iz - other.grid.iz) <= 1) {
          stack.push(other);
        }
      });
    }
    neckGroups.push(group);
  });
  
  // Choose a candidate neck group: one whose volume is < 15% of the ocean volume
  const oceanVol = cells.length;
  let candidateNeck = null;
  for (const group of neckGroups) {
    if (group.length < 0.40 * oceanVol) {
      // Also require that average connectivity in the group is < 0.5 * C_avg
      const neckConn = group.reduce((sum, cell) => sum + cell.connectivity, 0) / group.length;
      if (neckConn < 0.5 * C_avg) {
        candidateNeck = group;
        break;
      }
    }
  }
  
  if (!candidateNeck) {
    return { segmented: false, cores: [cells] };
  }
  
  // Remove candidateNeck cells from the cluster to produce remaining cells.
  const remaining = cells.filter(cell => !candidateNeck.includes(cell));
  
  // Partition the remaining cells into connected components using 26-neighbor flood-fill.
  const subClusters = [];
  const remVisited = new Set();
  remaining.forEach(cell => {
    if (remVisited.has(cell.id)) return;
    const comp = [];
    const stack = [cell];
    while (stack.length > 0) {
      const curr = stack.pop();
      if (remVisited.has(curr.id)) continue;
      remVisited.add(curr.id);
      comp.push(curr);
      remaining.forEach(other => {
        if (!remVisited.has(other.id) &&
            Math.abs(curr.grid.ix - other.grid.ix) <= 1 &&
            Math.abs(curr.grid.iy - other.grid.iy) <= 1 &&
            Math.abs(curr.grid.iz - other.grid.iz) <= 1) {
          stack.push(other);
        }
      });
    }
    subClusters.push(comp);
  });
  
  // Check that each resulting sub-cluster is at least 5% of the ocean volume.
  if (subClusters.length < 2 ||
      subClusters.some(comp => comp.length < 0.05 * oceanVol)) {
    return { segmented: false, cores: [cells] };
  }
  
  // If segmentation is acceptable, return the sub-clusters and the neck.
  return { segmented: true, cores: subClusters, neck: candidateNeck };
}

// ----- Helper Functions for Segmentation Naming -----
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
 * Loads constellation center data (if not already loaded) and then uses
 * the cell’s true coordinate (tcPos) to compute RA/DEC (in degrees)
 * and returns the name of the nearest constellation center.
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
    // Fallback hardcoded list (in degrees)
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
 * Helper to compute angular distance (in degrees) between two points on a sphere.
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
 * Merges branch objects with identical touchedCores.
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
 * For independent regions (Ocean, Sea, Lake), assign a base color.
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
