// filters/densityGridOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial, getBaseColor, lightenColor, darkenColor } from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, getConstellationForCell, segmentOceanCandidate, computeCentroid, assignDistinctColorsToIndependent } from './densitySegmentation.js';

export class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = []; // Final regions after segmentation/classification
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();

    // New group for the continuous contour zones
    this.densityContourGroup = new THREE.Group();
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
            // grid indices for cell location in the TC system
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false,
            isoDist: Infinity // will be computed in update()
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
        let starPos = star.truePosition ? star.truePosition : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
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
    // (Existing code for drawing connections between cells – not used in the new zone visualization)
    this.adjacentLines = [];
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
      cellMap.set(key, cell);
    });
    // For completeness, include all 26 neighbor directions (unique per pair)
    const directions = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) {
            directions.push({dx, dy, dz});
          }
        }
      }
    }
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
  
  // Instead of updating discrete squares and lines, we now build a continuous density field,
  // blur it with a Gaussian, and then extract contour lines via marching squares.
  update(stars) {
    // Get density threshold parameters from the UI
    const densitySlider = document.getElementById('density-slider');
    const toleranceSlider = document.getElementById('tolerance-slider');
    if (!densitySlider || !toleranceSlider) return;
    
    const isolationVal = parseFloat(densitySlider.value) || 1;
    const toleranceVal = parseInt(toleranceSlider.value) || 0;
    
    // For each cell, compute its “density measure” (here we use the isoDist value)
    this.cubesData.forEach(cell => {
      let isoDist = Infinity;
      if (cell.distances.length > toleranceVal) {
        isoDist = cell.distances[toleranceVal];
      }
      cell.isoDist = isoDist;
      // Optionally, you could set cell.active based on a threshold here.
      cell.active = (isoDist >= isolationVal);
    });
    
    // Remove any previous contour meshes from the scene by clearing the group.
    this.densityContourGroup.children.length = 0;
    
    // Build a continuous 2D density field from the globe projection of each cell.
    const { field, minX, minY, cellWidth, cellHeight, resX, resY } = this.computeDensityField();
    // Apply Gaussian blur to the field.
    const blurred = this.gaussianBlur(field, 5, 1.0);
    // Run marching squares to extract contours at the given threshold.
    const contours = this.marchingSquares(blurred, isolationVal);
    // Convert each contour (in grid space) to a set of 3D positions on the globe.
    contours.forEach(contour => {
      const points3D = this.convertContourTo3D(contour, minX, minY, cellWidth, cellHeight);
      if (points3D.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points3D);
        const material = new THREE.LineBasicMaterial({
          color: 0xffaa00,
          linewidth: 2,
          transparent: true,
          opacity: 0.8
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 2;
        this.densityContourGroup.add(line);
      }
    });
  }

  // Computes a 2D density field based on the projected (x,y) positions of each cell.
  // Returns an object with the 2D array "field" plus parameters to convert back to world space.
  computeDensityField() {
    // Collect x,y coordinates from each cell's globeMesh.position.
    let xs = this.cubesData.map(c => c.globeMesh.position.x);
    let ys = this.cubesData.map(c => c.globeMesh.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Set resolution for the density field (number of cells along x and y)
    const resX = 200, resY = 200;
    const cellWidth = (maxX - minX) / (resX - 1);
    const cellHeight = (maxY - minY) / (resY - 1);
    // Initialize field with zeros.
    const field = [];
    for (let i = 0; i < resX; i++) {
      field[i] = [];
      for (let j = 0; j < resY; j++) {
        field[i][j] = 0;
      }
    }
    // Also keep a weight matrix for averaging.
    const weight = [];
    for (let i = 0; i < resX; i++) {
      weight[i] = [];
      for (let j = 0; j < resY; j++) {
        weight[i][j] = 0;
      }
    }
    // For each cell, add its isoDist value into the corresponding grid bin.
    this.cubesData.forEach(cell => {
      const pos = cell.globeMesh.position;
      const i = Math.round((pos.x - minX) / cellWidth);
      const j = Math.round((pos.y - minY) / cellHeight);
      if (i >= 0 && i < resX && j >= 0 && j < resY) {
        field[i][j] += cell.isoDist;
        weight[i][j] += 1;
      }
    });
    // Average out the values
    for (let i = 0; i < resX; i++) {
      for (let j = 0; j < resY; j++) {
        if (weight[i][j] > 0) {
          field[i][j] /= weight[i][j];
        }
      }
    }
    return { field, minX, minY, cellWidth, cellHeight, resX, resY };
  }

  // A simple Gaussian blur implementation over a 2D array.
  // kernelSize should be an odd number.
  gaussianBlur(matrix, kernelSize, sigma) {
    const resX = matrix.length, resY = matrix[0].length;
    const kernel = [];
    const half = Math.floor(kernelSize / 2);
    let sum = 0;
    for (let i = -half; i <= half; i++) {
      kernel[i + half] = [];
      for (let j = -half; j <= half; j++) {
        const value = Math.exp(-(i * i + j * j) / (2 * sigma * sigma));
        kernel[i + half][j + half] = value;
        sum += value;
      }
    }
    // Normalize kernel.
    for (let i = 0; i < kernelSize; i++) {
      for (let j = 0; j < kernelSize; j++) {
        kernel[i][j] /= sum;
      }
    }
    // Create a new matrix for the output.
    const output = [];
    for (let i = 0; i < resX; i++) {
      output[i] = [];
      for (let j = 0; j < resY; j++) {
        output[i][j] = 0;
      }
    }
    // Convolve
    for (let i = 0; i < resX; i++) {
      for (let j = 0; j < resY; j++) {
        let acc = 0;
        for (let ki = -half; ki <= half; ki++) {
          for (let kj = -half; kj <= half; kj++) {
            const ii = i + ki;
            const jj = j + kj;
            if (ii >= 0 && ii < resX && jj >= 0 && jj < resY) {
              acc += matrix[ii][jj] * kernel[ki + half][kj + half];
            }
          }
        }
        output[i][j] = acc;
      }
    }
    return output;
  }

  // A very basic marching squares implementation.
  // Returns an array of contours, each a list of {x, y} points in grid (matrix) coordinates.
  marchingSquares(matrix, threshold) {
    const contours = [];
    const resX = matrix.length, resY = matrix[0].length;
    // For each cell (square defined by 4 adjacent grid points)
    // We will output segments for cells where the density crosses the threshold.
    for (let i = 0; i < resX - 1; i++) {
      for (let j = 0; j < resY - 1; j++) {
        // Corners:
        const a = matrix[i][j] >= threshold ? 1 : 0;
        const b = matrix[i+1][j] >= threshold ? 1 : 0;
        const c = matrix[i+1][j+1] >= threshold ? 1 : 0;
        const d = matrix[i][j+1] >= threshold ? 1 : 0;
        const state = a * 8 + b * 4 + c * 2 + d * 1;
        const segments = [];
        // For brevity, we list a few cases. In production code you would handle all 16.
        // Here we illustrate a simple case:
        if (state === 5 || state === 10) {
          // Ambiguous case; simply interpolate on horizontal midlines.
          segments.push({ p1: { x: i + 0.5, y: j }, p2: { x: i + 0.5, y: j+1 } });
        } else if (state === 0 || state === 15) {
          // No contour in this cell.
        } else {
          // For non-ambiguous cases, interpolate along edges.
          // Example: state === 1 (only d is 1)
          if (state === 1) {
            segments.push({
              p1: { x: i, y: j+this.interpolate(matrix[i][j+1], matrix[i+1][j+1], threshold) },
              p2: { x: i+this.interpolate(matrix[i][j], matrix[i][j+1], threshold), y: j+1 }
            });
          }
          // (Additional cases should be added here.)
        }
        // For each segment, add it as its own contour (for simplicity)
        segments.forEach(seg => {
          contours.push([seg.p1, seg.p2]);
        });
      }
    }
    return contours;
  }

  // Linear interpolation helper: returns fraction between v1 and v2 at which the threshold is reached.
  interpolate(v1, v2, threshold) {
    if (Math.abs(v2 - v1) < 1e-6) return 0;
    return (threshold - v1) / (v2 - v1);
  }

  // Converts a contour (list of {x,y} in grid coordinates) to 3D points on the globe.
  convertContourTo3D(contour, minX, minY, cellWidth, cellHeight) {
    const points3D = [];
    contour.forEach(pt => {
      // Convert grid coordinate (pt.x, pt.y) back to world x,y.
      const worldX = minX + pt.x * cellWidth;
      const worldY = minY + pt.y * cellHeight;
      // Assume the globe is a sphere of radius 100.
      // For a given (x,y) inside the circle, compute z so that x^2+y^2+z^2=100^2.
      let r2 = worldX * worldX + worldY * worldY;
      let z = 0;
      if (r2 <= 100 * 100) {
        z = -Math.sqrt(100 * 100 - r2);
      }
      points3D.push(new THREE.Vector3(worldX, worldY, z));
    });
    return points3D;
  }

  // Call this method to update the contour overlay.
  // It builds the density field, applies blur, extracts contours, and adds them to densityContourGroup.
  updateContours() {
    const { field, minX, minY, cellWidth, cellHeight, resX, resY } = this.computeDensityField();
    const blurred = this.gaussianBlur(field, 5, 1.0);
    // Use the isolation value from the slider as the threshold for contours.
    const densitySlider = document.getElementById('density-slider');
    const threshold = parseFloat(densitySlider.value) || 1;
    const contours = this.marchingSquares(blurred, threshold);
    // Remove any existing contour meshes.
    this.densityContourGroup.children.length = 0;
    // Convert each contour to 3D and create a Three.js line.
    contours.forEach(contour => {
      const points3D = this.convertContourTo3D(contour, minX, minY, cellWidth, cellHeight);
      if (points3D.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points3D);
        const material = new THREE.LineBasicMaterial({
          color: 0xffaa00,
          linewidth: 2,
          transparent: true,
          opacity: 0.8
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 2;
        this.densityContourGroup.add(line);
      }
    });
  }

  // In the addRegionLabelsToScene method (and updateRegionColors) the previous behavior remains unchanged.
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

  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    const independentRegions = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    assignDistinctColorsToIndependent(independentRegions);
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBaseColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBaseColor(region.constName));
        });
      } else if (region.type === 'Gulf' || region.type === 'Strait') {
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

  classifyEmptyRegions() {
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
    
    let V_max = 0;
    clusters.forEach(cells => {
      if (cells.length > V_max) V_max = cells.length;
    });
    
    const regions = [];
    clusters.forEach((cells, idx) => {
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
          segResult.cores.forEach((core, i) => {
            const gulfBest = computeInterconnectedCell(core);
            const gulfConst = getConstellationForCell(gulfBest);
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
}
