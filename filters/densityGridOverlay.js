// densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  getBlueColor, lightenColor, darkenColor, getIndividualBlueColor 
} from './densityColorUtils.js';
import { computeInterconnectedCell, segmentOceanCandidate, computeCentroid } from './densitySegmentation.js';

// We assume that constellation center data is loaded via the TXT file
// and is available globally as "centerData" (or you can import it appropriately).
if (typeof centerData === 'undefined') {
  var centerData = []; // Fallback if not loaded
}

export class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];       // Array of cell objects
    this.adjacentLines = [];   // For drawing connection lines (if needed)
    this.regionClusters = [];  // Regions (ocean/sea/lake/strait) after clustering
    this.regionLabelsGroupTC = null;
    this.regionLabelsGroupGlobe = null;
  }

  /**
   * Creates a grid of cubic cells covering the sky.
   * Each cell gets a "tcPos" (true coordinate position), a grid index,
   * and an initial inactive state.
   * @param {Array} stars - The star array (used later for distance computations)
   */
  createGrid(stars) {
    this.cubesData = [];
    const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
    for (let x = -halfExt; x <= halfExt; x += this.gridSize) {
      for (let y = -halfExt; y <= halfExt; y += this.gridSize) {
        for (let z = -halfExt; z <= halfExt; z += this.gridSize) {
          // Center of cell
          const pos = new THREE.Vector3(
            x + this.gridSize / 2,
            y + this.gridSize / 2,
            z + this.gridSize / 2
          );
          // Only include cells within maxDistance (a sphere)
          if (pos.length() > this.maxDistance) continue;
          const cell = {
            id: this.cubesData.length,
            tcPos: pos.clone(),
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false,
            distances: [],
            constellation: "UNKNOWN"
          };
          this.cubesData.push(cell);
        }
      }
    }
    this.computeDistances(stars);
    this.computeAdjacentLines();
  }

  /**
   * Computes the distance from each cell to every star.
   * @param {Array} stars - Array of star objects.
   */
  computeDistances(stars) {
    this.cubesData.forEach(cell => {
      const dArr = stars.map(star => {
        // Use star.truePosition if available; otherwise fallback to coordinates.
        const starPos = star.truePosition ? star.truePosition : 
                        new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        return starPos.distanceTo(cell.tcPos);
      });
      dArr.sort((a, b) => a - b);
      cell.distances = dArr;
    });
  }

  /**
   * (Optional) Computes adjacent connection lines between cells.
   */
  computeAdjacentLines() {
    // For now we clear any previous lines.
    this.adjacentLines = [];
    // Implementation for drawing grid connections can be added as needed.
  }

  /**
   * Updates the grid cells based on the current star data.
   * Here you could update which cells are active by applying a threshold
   * based on the cell's distance to its nth-nearest star.
   * @param {Array} stars - Array of star objects.
   */
  update(stars) {
    this.computeDistances(stars);
    // Optionally update cell "active" status based on some criteria.
  }

  /**
   * Clusters adjacent active cells using a flood-fill (DFS) algorithm.
   * @returns {Array} - Array of clusters (each cluster is an array of cells).
   */
  computeClusters() {
    const clusters = [];
    const visited = new Set();
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      cellMap.set(`${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`, cell);
    });
    this.cubesData.forEach(cell => {
      if (!cell.active || visited.has(cell.id)) return;
      const cluster = [];
      const stack = [cell];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        cluster.push(current);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const neighborKey = `${current.grid.ix + dx},${current.grid.iy + dy},${current.grid.iz + dz}`;
              if (cellMap.has(neighborKey)) {
                const neighbor = cellMap.get(neighborKey);
                if (neighbor.active && !visited.has(neighbor.id)) {
                  stack.push(neighbor);
                }
              }
            }
          }
        }
      }
      clusters.push(cluster);
    });
    return clusters;
  }

  /**
   * Counts neighbors for a cell within a given set.
   */
  countNeighbors(cell, cells) {
    let count = 0;
    cells.forEach(other => {
      if (cell.id === other.id) return;
      if (Math.abs(cell.grid.ix - other.grid.ix) <= 1 &&
          Math.abs(cell.grid.iy - other.grid.iy) <= 1 &&
          Math.abs(cell.grid.iz - other.grid.iz) <= 1) {
        count++;
      }
    });
    return count;
  }

  /**
   * Determines the majority constellation among a group of cells.
   */
  getMajorityConstellation(cells) {
    const freq = {};
    cells.forEach(cell => {
      const cst = cell.constellation || "UNKNOWN";
      freq[cst] = (freq[cst] || 0) + 1;
    });
    let majority = "UNKNOWN", maxCount = 0;
    Object.keys(freq).forEach(key => {
      if (freq[key] > maxCount) {
        majority = key;
        maxCount = freq[key];
      }
    });
    return majority;
  }

  /**
   * Clusters the cells and classifies them as Oceans, Seas, Lakes, or Straits.
   * Uses the old logic based on cell volume thresholds.
   */
  classifyEmptyRegions() {
    const clusters = this.computeClusters();
    const regions = [];
    const V_max = Math.max(...clusters.map(c => c.length));
    clusters.forEach((cells, idx) => {
      let regionType = "Ocean";
      if (cells.length < 0.1 * V_max) {
        regionType = "Lake";
      } else if (cells.length < 0.5 * V_max) {
        regionType = "Sea";
      }
      // Check for narrow connections to flag a Strait.
      const hasStrait = cells.some(cell => {
        const n = this.countNeighbors(cell, cells);
        return (n >= 2 && n <= 5);
      });
      if (hasStrait) {
        regionType = "Strait";
      }
      const majorityConstellation = this.getMajorityConstellation(cells);
      const labelScale = regionType === "Ocean" ? 1.0 : (regionType === "Sea" ? 0.9 : 0.8);
      const region = {
        clusterId: idx,
        cells: cells,
        volume: cells.length,
        constName: majorityConstellation,
        type: regionType,
        label: `${regionType} ${majorityConstellation}`,
        labelScale: labelScale,
        bestCell: computeInterconnectedCell(cells)
      };
      regions.push(region);
    });
    this.regionClusters = regions;
    return regions;
  }

  /**
   * Assigns each active cell a constellation based on the TXT‑derived constellation centers.
   * The horizontal (RA) axis is reversed in the conversion.
   */
  async assignConstellationsToCells() {
    if (!centerData.length) {
      console.error("Center data is not loaded!");
      return;
    }
    const R = 100;
    // Conversion function that reverses the horizontal axis.
    const degToSphereReversed = (raDeg, decDeg, R) => {
      const raRad = THREE.Math.degToRad(raDeg);
      const decRad = THREE.Math.degToRad(decDeg);
      const x = R * Math.cos(decRad) * Math.cos(raRad); // positive x now
      const y = R * Math.sin(decRad);
      const z = -R * Math.cos(decRad) * Math.sin(raRad);
      return new THREE.Vector3(x, y, z);
    };

    // For each active cell, compute its RA and DEC from its tcPos.
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      const pos = cell.tcPos.clone().normalize().multiplyScalar(R);
      let ra = Math.atan2(-pos.z, pos.x);
      if (ra < 0) ra += 2 * Math.PI;
      const dec = Math.asin(pos.y / R);
      cell.ra = THREE.Math.radToDeg(ra);
      cell.dec = THREE.Math.radToDeg(dec);
    });

    // Assign constellation by finding the center with the smallest angular distance.
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      let bestConstellation = "UNKNOWN";
      let minAngle = Infinity;
      const cellVec = degToSphereReversed(cell.ra, cell.dec, R);
      centerData.forEach(center => {
        const centerVec = degToSphereReversed(center.ra, center.dec, R);
        const angle = cellVec.angleTo(centerVec);
        if (angle < minAngle) {
          minAngle = angle;
          bestConstellation = center.name;
        }
      });
      cell.constellation = bestConstellation;
      console.log(`Cell ID ${cell.id} assigned to constellation ${cell.constellation}`);
    });
  }

  /**
   * Projects a true coordinate position onto the globe’s surface.
   */
  projectToGlobe(position) {
    const R = 100;
    if (position.length() < 1e-6) return new THREE.Vector3(0, 0, 0);
    let ra = Math.atan2(-position.z, position.x);
    if (ra < 0) ra += 2 * Math.PI;
    const dec = Math.asin(position.y / position.length());
    return new THREE.Vector3(
      R * Math.cos(dec) * Math.cos(ra),
      R * Math.sin(dec),
      -R * Math.cos(dec) * Math.sin(ra)
    );
  }

  /**
   * Creates a region label object at the given position.
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
      const material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: texture },
          opacity: { value: 1.0 }
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
      labelObj = new THREE.Mesh(planeGeom, material);
      labelObj.renderOrder = 1;
      // Orient the label tangent to the sphere.
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
}

function computeCentroid(cells) {
  let sum = new THREE.Vector3(0, 0, 0);
  cells.forEach(c => sum.add(c.tcPos));
  return sum.divideScalar(cells.length);
}
