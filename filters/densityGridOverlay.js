// filters/densityGridOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { Line2 } from 'https://threejs.org/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'https://threejs.org/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'https://threejs.org/examples/jsm/lines/LineMaterial.js';
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
          
          // For the TrueCoordinates map, we still create the cube.
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // For the Globe map, we create a square that will be hidden.
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
    this.adjacentLines = [];
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
      cellMap.set(key, cell);
    });
    // Loop over all 26 neighbor directions (unique pairs only)
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
          // Use fat lines for the globe map connections
          const geometry = new LineGeometry();
          geometry.setPositions(positions);
          geometry.setColors(colors);
          const material = new LineMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.3,
            linewidth: 1, // initial value; updated in update()
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
          });
          const line = new Line2(geometry, material);
          line.computeLineDistances();
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
    
    // Update grid cells
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
      // For the TrueCoordinates map, show the cube.
      cell.tcMesh.visible = showSquare;
      cell.tcMesh.material.opacity = alpha;
      // For the Globe map, hide the square.
      cell.globeMesh.visible = false;
    });
    
    // Update adjacent connection lines (for the Globe map fat lines)
    this.adjacentLines.forEach(obj => {
      const { line, cell1, cell2 } = obj;
      if (cell1.active && cell2.active) {
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
        // Update fat line geometry
        obj.line.geometry.setPositions(positions);
        obj.line.geometry.setColors(colors);
        // Compute each cell's distance ratio from the Sun (using tcPos)
        const ratio1 = cell1.tcPos.length() / this.maxDistance;
        const ratio2 = cell2.tcPos.length() / this.maxDistance;
        const avgRatio = (ratio1 + ratio2) / 2;
        // Closer to the Sun (avgRatio near 0) => thicker; further (near 1) => thinner.
        const maxThickness = 50.0;
        const minThickness = 0.1;
        const thickness = THREE.MathUtils.lerp(maxThickness, minThickness, avgRatio);
        obj.line.material.linewidth = thickness;
        obj.line.material.needsUpdate = true;
        obj.line.visible = true;
      } else {
        obj.line.visible = false;
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
}
