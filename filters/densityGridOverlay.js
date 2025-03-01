// densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  segmentOceanCandidate, 
  computeInterconnectedCell, 
  computeCentroid 
} from './densitySegmentation.js';
import { lightenColor, getBlueColor, darkenColor } from './densityColorUtils.js';

// Assume that centerData is loaded by constellationFilter.js (via TXT) and is globally available.
if (typeof centerData === 'undefined') {
  // If not already defined, create an empty array.
  var centerData = [];
}

/**
 * The DensityGridOverlay class creates a 3D grid overlay of “cells” covering the sky,
 * computes distances to stars, and later clusters cells and assigns them a constellation
 * based on the TXT‑based constellation centers.
 */
export class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];  // Array of cells
    this.adjacentLines = []; // For drawing cell connection lines
    this.regionClusters = []; // Clusters after segmentation (ocean, sea, etc.)
    
    // These groups will hold region label sprites for the two map types:
    this.regionLabelsGroupTC = null;
    this.regionLabelsGroupGlobe = null;
  }

  // (Methods to create the grid, compute distances etc. should remain largely the same.)
  // For brevity, we assume you already have methods such as createGrid() and computeDistances().

  /**
   * OLD: Cluster segmentation and classification based on cell volume.
   * Uses thresholds (here: 0.1*V_max and 0.5*V_max) to classify clusters as Lakes, Seas, or Oceans.
   * Also, if a cell in the cluster has a “narrow” connection (neighbors count between 2 and 5), mark the region as a Strait.
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
      // If any cell in the cluster has a small neighbor count, consider the region a Strait.
      const hasStrait = cells.some(cell => this.countNeighbors(cell, cells) >= 2 && this.countNeighbors(cell, cells) <= 5);
      if (hasStrait) {
        regionType = "Strait";
      }
      const majorityConstellation = this.getMajorityConstellation(cells);
      // For labeling, you might want to set a label scale based on region type.
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
   * Computes clusters of adjacent active cells using a flood‐fill (DFS) approach.
   */
  computeClusters() {
    const clusters = [];
    const visited = new Set();
    const grid = this.cubesData;
    const keyFor = (cell) => `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
    // Build a lookup map of active cells
    const cellMap = new Map();
    grid.forEach(cell => {
      cellMap.set(keyFor(cell), cell);
    });
    grid.forEach(cell => {
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
   * Counts the number of neighboring cells (in a 3x3x3 neighborhood) within the given cluster.
   */
  countNeighbors(cell, cluster) {
    let count = 0;
    cluster.forEach(other => {
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
   * Returns the majority constellation among the cells in a cluster.
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
   * Assigns a constellation name to each active cell.
   * Instead of using the JSON file, we now use the TXT‑based centers (in centerData).
   * In addition, we reverse the horizontal (RA) axis via a custom conversion.
   */
  async assignConstellationsToCells() {
    if (!centerData.length) {
      console.error("Center data is not loaded!");
      return;
    }
    const R = 100;
    // Define conversion from RA/Dec (in degrees) to a 3D vector with reversed horizontal axis.
    const degToSphereReversed = (raDeg, decDeg, R) => {
      const raRad = THREE.Math.degToRad(raDeg);
      const decRad = THREE.Math.degToRad(decDeg);
      // Reverse horizontal axis: positive x instead of negative.
      const x = R * Math.cos(decRad) * Math.cos(raRad);
      const y = R * Math.sin(decRad);
      const z = -R * Math.cos(decRad) * Math.sin(raRad);
      return new THREE.Vector3(x, y, z);
    };

    // For each active cell, compute its own RA/Dec.
    // (Since your grid covers the whole sky, you can compute RA and DEC from the cell's tcPos.)
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      // Convert the true coordinates (tcPos) to a unit vector and then compute RA/Dec.
      const pos = cell.tcPos.clone().normalize().multiplyScalar(R);
      // Reverse horizontal axis: use atan2(-z, x)
      let ra = Math.atan2(-pos.z, pos.x);
      if (ra < 0) ra += 2 * Math.PI;
      const dec = Math.asin(pos.y / R);
      cell.ra = THREE.Math.radToDeg(ra);
      cell.dec = THREE.Math.radToDeg(dec);
    });

    // For each active cell, find the center that minimizes angular distance.
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
   * Adds region labels (for oceans, seas, lakes, straits) to the given scene.
   */
  addRegionLabelsToScene(scene, mapType) {
    const regions = this.classifyEmptyRegions();
    regions.forEach(region => {
      let labelPos;
      if (region.bestCell) {
        labelPos = region.bestCell.tcPos.clone();
      } else {
        labelPos = computeCentroid(region.cells);
      }
      if (mapType === 'Globe') {
        labelPos = this.projectToGlobe(labelPos);
      }
      const labelSprite = this.createRegionLabel(region.label, labelPos, mapType);
      labelSprite.userData.labelScale = region.labelScale || 1.0;
      if (mapType === 'TrueCoordinates') {
        if (!this.regionLabelsGroupTC) {
          this.regionLabelsGroupTC = new THREE.Group();
          scene.add(this.regionLabelsGroupTC);
        }
        this.regionLabelsGroupTC.add(labelSprite);
      } else if (mapType === 'Globe') {
        if (!this.regionLabelsGroupGlobe) {
          this.regionLabelsGroupGlobe = new THREE.Group();
          scene.add(this.regionLabelsGroupGlobe);
        }
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });
  }

  /**
   * Projects a true coordinate position onto the globe’s surface.
   */
  projectToGlobe(position) {
    const R = 100;
    if (position.length() < 1e-6) return new THREE.Vector3(0, 0, 0);
    // Compute spherical coordinates from position (using the current convention)
    let ra = Math.atan2(-position.z, position.x);
    if (ra < 0) ra += 2 * Math.PI;
    const dec = Math.asin(position.y / position.length());
    // For globe projection, we use the same reversed horizontal conversion:
    return new THREE.Vector3(
      R * Math.cos(dec) * Math.cos(ra),
      R * Math.sin(dec),
      -R * Math.cos(dec) * Math.sin(ra)
    );
  }

  /**
   * Creates a region label (as a sprite or plane) at the given position.
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
        transparent: true
      });
      labelObj = new THREE.Sprite(spriteMaterial);
      const scaleFactor = 0.22;
      labelObj.scale.set((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor, 1);
    }
    labelObj.position.copy(position);
    return labelObj;
  }
}
