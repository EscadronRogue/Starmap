// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

// --- Load constellation center data for naming ---
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

// --- Helper color adjustment functions ---
function lightenColor(color, factor) {
  let hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.l = Math.min(1, hsl.l + factor);
  let newColor = new THREE.Color();
  newColor.setHSL(hsl.h, hsl.s, hsl.l);
  return newColor;
}
function darkenColor(color, factor) {
  let hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.l = Math.max(0, hsl.l - factor);
  let newColor = new THREE.Color();
  newColor.setHSL(hsl.h, hsl.s, hsl.l);
  return newColor;
}

// --- Helper to derive a base color from a constellation name ---
function getBaseColor(constName) {
  // Use a hash of the constellation name to generate a hue.
  let hash = 0;
  for (let i = 0; i < constName.length; i++) {
    hash = constName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = (hash % 360 + 360) % 360;
  return new THREE.Color(`hsl(${hue}, 70%, 50%)`);
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
          
          // Cube for TrueCoordinates.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // Plane for Globe.
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
  // Group active cells via 26-neighbor flood-fill, then compute V_max (largest cluster volume).
  // Classify clusters as:
  //   - Ocean: volume ≥ 50% of V_max
  //   - Sea: volume between 10% and 50% of V_max
  //   - Lake: volume < 10% of V_max
  // For Ocean candidates, attempt segmentation via bottleneck detection.
  // Each region is labeled based on the constellation nearest its most-connected cell.
  classifyEmptyRegions() {
    // Flood-fill grouping.
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
        const current = stack.pop();
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
    
    // Determine V_max.
    let V_max = 0;
    clusters.forEach(cells => {
      if (cells.length > V_max) V_max = cells.length;
    });
    
    const regions = [];
    clusters.forEach((cells, idx) => {
      // For each cluster, choose its best cell and assign its constellation.
      const bestCell = computeInterconnectedCell(cells);
      const regionConst = getConstellationForCell(bestCell);
      
      if (cells.length < 0.1 * V_max) {
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          constName: regionConst,
          type: "Lake",
          label: `Lake ${regionConst}`,
          labelScale: 0.8,
          bestCell
        });
      } else if (cells.length < 0.5 * V_max) {
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          constName: regionConst,
          type: "Sea",
          label: `Sea ${regionConst}`,
          labelScale: 0.9,
          bestCell
        });
      } else {
        // Ocean candidate: attempt bottleneck segmentation.
        const segResult = segmentOceanCandidate(cells);
        if (!segResult.segmented) {
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            constName: regionConst,
            type: "Ocean",
            label: `Ocean ${regionConst}`,
            labelScale: 1.0,
            bestCell
          });
        } else {
          // Overall cluster remains an Ocean.
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            constName: regionConst,
            type: "Ocean",
            label: `Ocean ${regionConst}`,
            labelScale: 1.0,
            bestCell
          });
          // For each sub-cluster, label as a Gulf.
          segResult.cores.forEach((core, i) => {
            const gulfBest = computeInterconnectedCell(core);
            const gulfConst = getConstellationForCell(gulfBest);
            // Derive gulf color by slightly darkening the parent's base color.
            let gulfColor = darkenColor(getBaseColor(regionConst), 0.05);
            regions.push({
              clusterId: idx + "_gulf_" + i,
              cells: core,
              volume: core.length,
              constName: gulfConst,
              type: "Gulf",
              label: `Gulf ${gulfConst}`,
              labelScale: 0.85,
              bestCell: gulfBest,
              color: gulfColor
            });
          });
          // Label the neck as a Strait.
          if (segResult.neck && segResult.neck.length > 0) {
            const neckBest = computeInterconnectedCell(segResult.neck);
            const neckConst = getConstellationForCell(neckBest);
            let straitColor = lightenColor(getBaseColor(regionConst), 0.1);
            regions.push({
              clusterId: idx + "_neck",
              cells: segResult.neck,
              volume: segResult.neck.length,
              constName: neckConst,
              type: "Strait",
              label: `Strait ${neckConst}`,
              labelScale: 0.7,
              bestCell: neckBest,
              color: straitColor
            });
          }
        }
      }
    });
    
    this.regionClusters = regions;
    return regions;
  }

  /**
   * createRegionLabel: Create a uniform canvas-based label.
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
   * projectToGlobe: Project a position onto a sphere of radius 100.
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
   * addRegionLabelsToScene: Remove any existing labels and add new ones.
   */
  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) scene.remove(this.regionLabelsGroupTC);
      this.regionLabelsGroupTC = new THREE.Group();
    } else if (mapType === 'Globe') {
      if (this.regionLabelsGroupGlobe.parent) scene.remove(this.regionLabelsGroupGlobe);
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
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
   * updateRegionColors: For independent regions (Ocean, Sea, Lake), use a base color.
   * For Gulf and Strait regions, derive a uniform color by slightly modifying the parent's base color.
   */
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    // Assign base colors for independent regions.
    const independentRegions = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    assignDistinctColorsToIndependent(independentRegions);
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBaseColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBaseColor(region.constName));
        });
      } else if (region.type === 'Gulf' || region.type === 'Strait') {
        // Derive from parent's base color.
        let parentColor = getBaseColor(region.constName);
        if (region.type === 'Strait') {
          region.color = lightenColor(parentColor, 0.1);
        } else if (region.type === 'Gulf') {
          region.color = darkenColor(parentColor, 0.05);
        }
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }
}

// ----- Refined segmentation for Ocean Candidates -----
function segmentOceanCandidate(cells) {
  // Compute connectivity for each cell.
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
  
  // Mark cells as thin if connectivity < 0.5 * C_avg.
  cells.forEach(cell => {
    cell.thin = (cell.connectivity / C_avg) < 0.5;
  });
  
  // Group thin cells via flood-fill.
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
      cells.forEach(other => {
        if (!visited.has(other.id) && other.thin &&
            Math.abs(current.grid.ix - other.grid.ix) <= 1 &&
            Math.abs(current.grid.iy - other.grid.iy) <= 1 &&
            Math.abs(current.grid.iz - other.grid.iz) <= 1) {
          stack.push(other);
        }
      });
    }
    neckGroups.push(group);
  });
  
  const oceanVol = cells.length;
  let candidateNeck = null;
  // Look for a neck group that is less than 15% of ocean volume and whose removal splits the cluster into exactly two sub-clusters, each at least 10% of oceanVol.
  for (const group of neckGroups) {
    if (group.length >= 0.15 * oceanVol) continue;
    const neckAvgConn = group.reduce((s, cell) => s + cell.connectivity, 0) / group.length;
    if (neckAvgConn >= 0.5 * C_avg) continue;
    const remaining = cells.filter(cell => !group.includes(cell));
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
    if (subClusters.length === 2 &&
        subClusters.every(comp => comp.length >= 0.1 * oceanVol)) {
      candidateNeck = group;
      return { segmented: true, cores: subClusters, neck: candidateNeck };
    }
  }
  return { segmented: false, cores: [cells] };
}

// ----- Helper functions for segmentation naming -----
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
 * Updated getConstellationForCell: Uses loaded constellation centers.
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
 * Helper: Angular distance (in degrees) between two points.
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
 * For independent regions (Ocean, Sea, Lake), assign a base color via an even hue distribution.
 */
function assignDistinctColorsToIndependent(regions) {
  const colorMap = {};
  const types = ['Ocean', 'Sea', 'Lake'];
  types.forEach(type => {
    const group = regions.filter(r => r.type === type);
    const count = group.length;
    group.forEach((region, i) => {
      let hue = (360 * i / count) % 360;
      if (type === 'Ocean') hue = (hue + 240) % 360;
      else if (type === 'Sea') hue = (hue + 200) % 360;
      else if (type === 'Lake') hue = (hue + 160) % 360;
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
