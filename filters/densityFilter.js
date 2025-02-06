// filters/densityFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityGrid = null;

/**
 * DensityGridOverlay builds a 3D grid (using cubes) covering a sphere of radius maxDistance.
 * It computes distances from stars and flags a cell as "active" if its tolerance‐indexed distance
 * is at least the isolation value. Then it groups active cells via 26‑neighbor flood‑fill.
 *
 * After grouping, each cluster is classified as follows:
 *
 * 1. If the cluster has 1–2 cubes, it is a Lake.
 *
 * 2. For clusters larger than 2 cubes, we compute the bounding-box dimensions and define:
 *    - occupancy = volume / ((dx+1)*(dy+1)*(dz+1))
 *    - aspectRatio = max(dx,dy,dz) / min(dx,dy,dz) (with a fallback if min==0)
 *
 *    We then mark a cluster as “narrow” if its occupancy is less than a threshold (here 0.5)
 *    and its aspect ratio is greater than a threshold (here 2.5).
 *
 * 3. In a second pass, for each narrow cluster we build a refined neighbor set that includes only
 *    neighboring clusters that are not narrow (and that have >2 cells, i.e. are not lakes). If the
 *    refined neighbor set contains at least 2 independent basins then the narrow cluster is a Strait;
 *    otherwise it is a Gulf.
 *
 * 4. All clusters that are not narrow (and have >2 cells) are independent basins. Among these, if
 *    a basin’s volume is at least 50% of the largest independent basin, it is an Ocean; otherwise, it is a Sea.
 *
 * Finally, each cluster is assigned a label using the dominant constellation (as determined by a helper)
 * and the type. The final label is in the form "<Type> <ConstellationName>".
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
    // After clustering, store cluster data here.
    this.regionClusters = [];
    // Groups for region labels for different map types.
    this.regionLabelsGroupTC = new THREE.Group(); // TrueCoordinates
    this.regionLabelsGroupGlobe = new THREE.Group(); // Globe
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
            active: false // will be set in update()
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
   * Performs a 26‑neighbor flood‑fill on all active cells and groups them into clusters.
   * Then classifies each cluster as follows:
   *
   * (a) If volume (number of cells) ≤ 2 → Lake.
   *
   * (b) For clusters with volume > 2:
   *     Compute bounding box dimensions dx, dy, dz; then:
   *         occupancy = volume / ((dx+1)*(dy+1)*(dz+1))
   *         aspectRatio = max(dx,dy,dz) / (min(dx,dy,dz) || 1)
   *
   *     A cluster is flagged as "narrow" if (occupancy < 0.5 && aspectRatio > 2.5).
   *
   *     After computing a neighbor set (all clusters adjacent to any cell in this cluster),
   *     we refine the neighbor set for narrow clusters by including only those neighbors
   *     that are not themselves narrow (and that have volume > 2).
   *
   *     Then:
   *         - If a narrow cluster’s refined neighbor set has size ≥ 2, label it as Strait.
   *         - Otherwise, label it as Gulf.
   *
   * (c) All non-narrow clusters (with volume > 2) are independent basins.
   *     Among these, if volume ≥ 50% of the largest independent basin then label as Ocean,
   *     else label as Sea.
   *
   * For naming, for each cluster the dominant constellation (by cell count, as determined
   * by getConstellationForCell) is chosen and the final label is "<Type> <ConstellationName>".
   *
   * @returns {Array} Array of cluster objects with properties: volume, centroid, type, label, etc.
   */
  classifyEmptyRegions() {
    // Reset cluster id for each cell.
    this.cubesData.forEach((cell, index) => {
      cell.id = index;
      cell.clusterId = null;
    });
    // Build a map for active cells.
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
      const clusterCells = [];
      const stack = [cell];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        clusterCells.push(current);
        // Check all 26 neighbors.
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
    // Compute properties for each cluster.
    const clusterData = clusters.map((cells, clusterId) => {
      const volume = cells.length;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let sumPos = new THREE.Vector3(0, 0, 0);
      const constCount = {};
      cells.forEach(cell => {
        cell.clusterId = clusterId;
        const { ix, iy, iz } = cell.grid;
        if (ix < minX) minX = ix;
        if (ix > maxX) maxX = ix;
        if (iy < minY) minY = iy;
        if (iy > maxY) maxY = iy;
        if (iz < minZ) minZ = iz;
        if (iz > maxZ) maxZ = iz;
        sumPos.add(cell.tcPos);
        const cName = getConstellationForCell(cell);
        constCount[cName] = (constCount[cName] || 0) + 1;
      });
      const centroid = sumPos.divideScalar(volume);
      const bbox = { minX, maxX, minY, maxY, minZ, maxZ };
      const dx = maxX - minX;
      const dy = maxY - minY;
      const dz = maxZ - minZ;
      const bboxVolume = (dx + 1) * (dy + 1) * (dz + 1);
      const occupancy = volume / bboxVolume;
      const maxDim = Math.max(dx, dy, dz);
      const minDim = Math.min(dx, dy, dz) || 1;
      const aspectRatio = maxDim / minDim;
      // Compute neighbor set: all distinct cluster IDs adjacent to any cell in this cluster.
      const neighborSet = new Set();
      this.cubesData.forEach(cell => {
        if (!cell.active) return;
        if (cell.clusterId === clusterId) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const neighborKey = `${cell.grid.ix + dx},${cell.grid.iy + dy},${cell.grid.iz + dz}`;
                if (gridMap.has(neighborKey)) {
                  const neighborIndex = gridMap.get(neighborKey);
                  const neighborCell = this.cubesData[neighborIndex];
                  if (neighborCell.clusterId !== clusterId) {
                    neighborSet.add(neighborCell.clusterId);
                  }
                }
              }
            }
          }
        }
      });
      return {
        clusterId,
        cells,
        volume,
        centroid,
        bbox,
        neighbors: neighborSet,
        type: null,
        label: '',
        constCount,
        occupancy,
        aspectRatio,
        isNarrow: false // to be determined
      };
    });
    
    // First pass: mark clusters as "narrow" (if volume > 2) using chosen thresholds.
    const narrowOccupancyThreshold = 0.5;
    const narrowAspectThreshold = 2.5;
    clusterData.forEach(cluster => {
      if (cluster.volume <= 2) {
        cluster.type = 'Lake';
        cluster.isNarrow = false;
      } else {
        cluster.isNarrow = (cluster.occupancy < narrowOccupancyThreshold && cluster.aspectRatio > narrowAspectThreshold);
        // Temporarily mark as independent basin.
        cluster.type = 'IndependentBasin';
      }
    });
    
    // Second pass: for each narrow cluster, refine its neighbor set by including only those neighbors
    // that are not narrow and have volume > 2 (i.e. independent basins).
    clusterData.forEach(cluster => {
      if (cluster.volume > 2 && cluster.isNarrow) {
        let refinedNeighbors = new Set();
        cluster.neighbors.forEach(neighborId => {
          const neighbor = clusterData.find(c => c.clusterId === neighborId);
          if (neighbor && neighbor.volume > 2 && !neighbor.isNarrow) {
            refinedNeighbors.add(neighborId);
          }
        });
        // If the narrow cluster touches at least 2 independent basins, it is a Strait;
        // otherwise, it is a Gulf.
        if (refinedNeighbors.size >= 2) {
          cluster.type = 'Strait';
        } else {
          cluster.type = 'Gulf';
        }
      }
    });
    
    // Third pass: For clusters still marked as "IndependentBasin" (i.e. not narrow and not lakes),
    // determine the maximum volume and then label them as Ocean if volume ≥50% of maximum, else Sea.
    const independentBasins = clusterData.filter(c => c.type === 'IndependentBasin');
    let maxVolume = 0;
    independentBasins.forEach(c => {
      if (c.volume > maxVolume) maxVolume = c.volume;
    });
    independentBasins.forEach(c => {
      c.type = (c.volume >= 0.5 * maxVolume) ? 'Ocean' : 'Sea';
    });
    
    // Finally, for naming, choose the dominant constellation in each cluster.
    clusterData.forEach(c => {
      let dominantConst = 'Unknown';
      let maxCount = 0;
      for (const name in c.constCount) {
        if (c.constCount[name] > maxCount) {
          maxCount = c.constCount[name];
          dominantConst = name;
        }
      }
      c.label = `${c.type} ${dominantConst}`;
    });
    
    this.regionClusters = clusterData;
    return clusterData;
  }

  /**
   * Creates a text label (THREE.Sprite) for the given text and position.
   *
   * @param {string} text - The label text.
   * @param {THREE.Vector3} position - The 3D position.
   * @param {string} mapType - "Globe" or "TrueCoordinates".
   * @returns {THREE.Sprite} - The label sprite.
   */
  createRegionLabel(text, position, mapType) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = mapType === 'Globe' ? 48 : 24;
    ctx.font = `${fontSize}px Arial`;
    const textWidth = ctx.measureText(text).width;
    canvas.width = textWidth + 20;
    canvas.height = fontSize * 1.2;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, 10, fontSize);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    const scaleFactor = mapType === 'Globe' ? 0.1 : 0.05;
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
   * Removes any existing region label group from the scene and creates new labels
   * based on the current classification. For "TrueCoordinates" the centroid is used;
   * for "Globe" the centroid is projected.
   *
   * @param {THREE.Scene} scene - The scene to add labels to.
   * @param {string} mapType - "Globe" or "TrueCoordinates".
   */
  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) {
        this.regionLabelsGroupTC.parent.remove(this.regionLabelsGroupTC);
      }
      this.regionLabelsGroupTC = new THREE.Group();
    } else if (mapType === 'Globe') {
      if (this.regionLabelsGroupGlobe.parent) {
        this.regionLabelsGroupGlobe.parent.remove(this.regionLabelsGroupGlobe);
      }
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    const clusters = this.classifyEmptyRegions();
    clusters.forEach(cluster => {
      let labelPos;
      if (mapType === 'TrueCoordinates') {
        labelPos = cluster.centroid;
      } else if (mapType === 'Globe') {
        labelPos = this.projectToGlobe(cluster.centroid);
      }
      const labelSprite = this.createRegionLabel(cluster.label, labelPos, mapType);
      if (mapType === 'TrueCoordinates') {
        this.regionLabelsGroupTC.add(labelSprite);
      } else if (mapType === 'Globe') {
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });
    scene.add(mapType === 'TrueCoordinates' ? this.regionLabelsGroupTC : this.regionLabelsGroupGlobe);
  }
}

/**
 * Helper: Returns a constellation name for a cell based on its tcPos.
 * (This simple partition by RA may be replaced with a more sophisticated method.)
 *
 * @param {Object} cell - A grid cell.
 * @returns {string} - The constellation name.
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
 * Computes points along a great‑circle path between two points on a sphere.
 *
 * @param {THREE.Vector3} p1 - Starting position.
 * @param {THREE.Vector3} p2 - Ending position.
 * @param {number} R - Sphere radius.
 * @param {number} segments - Number of segments.
 * @returns {Array} - Array of THREE.Vector3 points.
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
