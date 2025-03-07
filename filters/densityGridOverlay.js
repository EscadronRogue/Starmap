// /filters/densityGridOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  getDoubleSidedLabelMaterial, 
  getBaseColor, 
  lightenColor, 
  darkenColor, 
  getBlueColor,
  getGreenColor
} from './densityColorUtils.js';
import { radToSphere, subdivideGeometry, getGreatCirclePoints } from '../utils/geometryUtils.js';
import { computeInterconnectedCell, segmentOceanCandidate } from './densitySegmentation.js';
import { loadConstellationCenters, getConstellationCenters, loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) to include grid cells.
   * @param {number} maxDistance - Maximum distance (LY) to include grid cells.
   * @param {number} gridSize - Size (in LY) of each grid cell.
   * @param {string} mode - "low" or "high".
   */
  constructor(minDistance, maxDistance, gridSize = 2, mode = "low") {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.gridSize = gridSize;
    this.mode = mode; // "low" or "high"
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
  }

  createGrid(stars) {
    const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
    this.cubesData = [];
    for (let x = -halfExt; x <= halfExt; x += this.gridSize) {
      for (let y = -halfExt; y <= halfExt; y += this.gridSize) {
        for (let z = -halfExt; z <= halfExt; z += this.gridSize) {
          const posTC = new THREE.Vector3(
            x + this.gridSize / 2,
            y + this.gridSize / 2,
            z + this.gridSize / 2
          );
          const distFromCenter = posTC.length();
          // Only include grid cells whose center is between minDistance and maxDistance.
          if (distFromCenter < this.minDistance || distFromCenter > this.maxDistance) continue;
          
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: (this.mode === "low") ? 0x0000ff : 0x00ff00,
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
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false
          };

          const cellRa = ((posTC.x + halfExt) / (2 * halfExt)) * 360;
          const cellDec = ((posTC.y + halfExt) / (2 * halfExt)) * 180 - 90;
          cell.ra = cellRa;
          cell.dec = cellDec;
          cell.id = this.cubesData.length;
          this.cubesData.push(cell);
        }
      }
    }
    // Use extended star set: include stars between (minDistance - 10) and (maxDistance + 10)
    const extendedStars = stars.filter(star => {
      const d = star.distance !== undefined ? star.distance : star.Distance_from_the_Sun;
      return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
    });
    this.cubesData.forEach(cell => computeCellDistances(cell, extendedStars));
    this.computeAdjacentLines();
  }

  computeAdjacentLines() {
    this.adjacentLines = [];
    const cellMap = new Map();
    this.cubesData.forEach(cell => {
      const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
      cellMap.set(key, cell);
    });
    const directions = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) {
            directions.push({ dx, dy, dz });
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

  update(stars) {
    const extendedStars = stars.filter(star => {
      const d = star.distance !== undefined ? star.distance : star.Distance_from_the_Sun;
      return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
    });
    this.cubesData.forEach(cell => {
      computeCellDistances(cell, extendedStars);
    });

    let isolationVal, toleranceVal;
    if (this.mode === "low") {
      isolationVal = parseFloat(document.getElementById('low-density-slider').value) || 7;
      toleranceVal = parseInt(document.getElementById('low-tolerance-slider').value) || 0;
    } else {
      isolationVal = parseFloat(document.getElementById('high-density-slider').value) || 1;
      toleranceVal = parseInt(document.getElementById('high-tolerance-slider').value) || 0;
    }
    this.cubesData.forEach(cell => {
      let isoDist = Infinity;
      if (cell.distances.length > toleranceVal) {
        isoDist = cell.distances[toleranceVal];
      }
      let showSquare = (this.mode === "low")
        ? (isoDist >= isolationVal)
        : (isoDist < isolationVal);
      cell.active = showSquare;
      let ratio = cell.tcPos.length() / this.maxDistance;
      if (ratio > 1) ratio = 1;
      const alpha = THREE.MathUtils.lerp(0.1, 0.3, ratio);
      cell.tcMesh.visible = showSquare;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.visible = showSquare;
      cell.globeMesh.material.opacity = alpha;
      const scale = THREE.MathUtils.lerp(20.0, 0.1, ratio);
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
        const avgScale = (cell1.globeMesh.scale.x + cell2.globeMesh.scale.x) / 2;
        line.material.linewidth = avgScale;
        line.visible = true;
      } else {
        line.visible = false;
      }
    });
  }

  async assignConstellationsToCells() {
    if (this.mode === "low") {
      await loadConstellationCenters();
      await loadConstellationBoundaries();
      const centers = getConstellationCenters();
      const boundaries = getConstellationBoundaries();
      if (!boundaries.length) {
        console.warn("No constellation boundaries available!");
        return;
      }
      function minAngularDistanceToSegment(cellPos, p1, p2) {
        const angleToP1 = cellPos.angleTo(p1);
        const angleToP2 = cellPos.angleTo(p2);
        const arcAngle = p1.angleTo(p2);
        const perpAngle = Math.asin(Math.abs(cellPos.clone().normalize().dot(p1.clone().cross(p2).normalize())));
        if (angleToP1 + angleToP2 - arcAngle < 1e-3) {
          return THREE.Math.radToDeg(perpAngle);
        } else {
          return THREE.Math.radToDeg(Math.min(angleToP1, angleToP2));
        }
      }
      function vectorToRaDec(cellPos) {
        const R = 100;
        const dec = Math.asin(cellPos.y / R);
        let ra = Math.atan2(-cellPos.z, -cellPos.x);
        let raDeg = ra * 180 / Math.PI;
        if (raDeg < 0) raDeg += 360;
        return { ra: raDeg, dec: dec * 180 / Math.PI };
      }
      const namesMapping = await loadConstellationFullNames();
      this.cubesData.forEach(cell => {
        if (!cell.active) return;
        const cellPos = cell.globeMesh.position.clone();
        let nearestBoundary = null;
        let minBoundaryDist = Infinity;
        boundaries.forEach(boundary => {
          const p1 = radToSphere(boundary.ra1, boundary.dec1, 100);
          const p2 = radToSphere(boundary.ra2, boundary.dec2, 100);
          const angDist = minAngularDistanceToSegment(cellPos, p1, p2);
          if (angDist < minBoundaryDist) {
            minBoundaryDist = angDist;
            nearestBoundary = boundary;
          }
        });
        if (!nearestBoundary) {
          cell.constellation = "Unknown";
          return;
        }
        const abbr1 = nearestBoundary.const1.toUpperCase();
        const abbr2 = nearestBoundary.const2 ? nearestBoundary.const2.toUpperCase() : null;
        const fullName1 = namesMapping[abbr1] || toTitleCase(abbr1);
        const fullName2 = abbr2 ? (namesMapping[abbr2] || toTitleCase(abbr2)) : null;
        const bp1 = radToSphere(nearestBoundary.ra1, nearestBoundary.dec1, 100);
        const bp2 = radToSphere(nearestBoundary.ra2, nearestBoundary.dec2, 100);
        let normal = bp1.clone().cross(bp2).normalize();
        const center1 = centers.find(c => {
          const nameUp = c.name.toUpperCase();
          return nameUp === abbr1 || nameUp === fullName1.toUpperCase();
        });
        let center1Pos = center1 ? radToSphere(center1.ra, center1.dec, 100) : null;
        if (center1Pos && normal.dot(center1Pos) < 0) {
          normal.negate();
        }
        const cellSide = normal.dot(cellPos);
        if (cellSide >= 0) {
          cell.constellation = toTitleCase(fullName1);
        } else if (fullName2) {
          cell.constellation = toTitleCase(fullName2);
        } else {
          const { ra: cellRA, dec: cellDec } = vectorToRaDec(cellPos);
          let bestConstellation = "Unknown";
          let minAngle = Infinity;
          centers.forEach(center => {
            const centerRAdeg = THREE.Math.radToDeg(center.ra);
            const centerDecdeg = THREE.Math.radToDeg(center.dec);
            const cosDelta = Math.sin(THREE.Math.degToRad(cellDec)) * Math.sin(THREE.Math.degToRad(centerDecdeg)) +
                             Math.cos(THREE.Math.degToRad(cellDec)) * Math.cos(THREE.Math.degToRad(centerDecdeg)) *
                             Math.cos(THREE.Math.degToRad(cellRA - centerRAdeg));
            const dist = Math.acos(THREE.MathUtils.clamp(cosDelta, -1, 1));
            if (dist < minAngle) {
              minAngle = dist;
              bestConstellation = toTitleCase(center.name);
            }
          });
          cell.constellation = bestConstellation;
        }
      });
    } else { // High density mode: assign using best star's system name.
      this.cubesData.forEach(cell => {
        if (cell.active) {
          cell.clusterLabel = this.getBestStarLabel([cell]);
        }
      });
    }
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
    ctx.fillText(text, 10, baseFontSize);
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

  computeCentroid(cells) {
    let sum = new THREE.Vector3(0, 0, 0);
    cells.forEach(c => sum.add(c.tcPos));
    return sum.divideScalar(cells.length);
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
      let labelPos = region.bestCell ? region.bestCell.tcPos : this.computeCentroid(region.cells);
      if (mapType === 'Globe') {
        labelPos = this.projectToGlobe(labelPos);
      }
      const labelSprite = this.createRegionLabel(region.label, labelPos, mapType);
      labelSprite.userData.labelScale = region.labelScale;
      if (mapType === 'TrueCoordinates') {
        this.regionLabelsGroupTC.add(labelSprite);
      } else {
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });
    scene.add(mapType === 'TrueCoordinates' ? this.regionLabelsGroupTC : this.regionLabelsGroupGlobe);
  }

  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    regions.forEach(region => {
      if (region.type === 'Oceanus' || region.type === 'Mare' || region.type === 'Lacus' ||
          region.type === 'Continens' || region.type === 'Peninsula' || region.type === 'Insula') {
        let baseColor = (this.mode === "low") ? getBlueColor(region.constName) : getGreenColor(region.constName);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || baseColor);
          cell.globeMesh.material.color.set(region.color || baseColor);
        });
      } else if (region.type === 'Fretum' || region.type === 'Isthmus') {
        let baseColor = (this.mode === "low") ? getBlueColor(region.constName) : getGreenColor(region.constName);
        region.color = lightenColor(baseColor, 0.1);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }

  getMajorityConstellation(cells) {
    const freq = {};
    cells.forEach(cell => {
      const cst = cell.constellation && cell.constellation !== "Unknown"
        ? toTitleCase(cell.constellation)
        : null;
      if (cst) {
        freq[cst] = (freq[cst] || 0) + 1;
      }
    });
    let maxCount = 0;
    let majority = "Unknown";
    Object.keys(freq).forEach(key => {
      if (freq[key] > maxCount) {
        maxCount = freq[key];
        majority = key;
      }
    });
    return majority;
  }

  classifyEmptyRegions() {
    this.regionClusters = [];
    const activeCells = this.cubesData.filter(c => c.active);
    const visited = new Set();
    const clusters = [];
    activeCells.forEach(cell => {
      if (visited.has(cell.id)) return;
      const stack = [cell];
      const clusterCells = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        clusterCells.push(current);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const nx = current.grid.ix + dx;
              const ny = current.grid.iy + dy;
              const nz = current.grid.iz + dz;
              const neighbor = activeCells.find(c => c.grid.ix === nx && c.grid.iy === ny && c.grid.iz === nz);
              if (neighbor && !visited.has(neighbor.id)) {
                stack.push(neighbor);
              }
            }
          }
        }
      }
      clusters.push(clusterCells);
    });
    let V_max = 0;
    clusters.forEach(c => {
      if (c.length > V_max) V_max = c.length;
    });
    const allRegions = [];
    clusters.forEach(c => {
      let subRegions;
      if (this.mode === "low") {
        const majority = this.getMajorityConstellation(c);
        subRegions = this.recursiveSegmentCluster(c, V_max, majority);
      } else {
        const bestLabel = this.getBestStarLabel(c);
        subRegions = this.recursiveSegmentCluster(c, V_max, bestLabel);
      }
      subRegions.forEach(sr => allRegions.push(sr));
    });
    this.regionClusters = allRegions;
    return allRegions;
  }

  recursiveSegmentCluster(cells, V_max, labelForCells) {
    const size = cells.length;
    if (this.mode === "low") {
      if (size < 0.1 * V_max) {
        return [{
          cells,
          volume: size,
          constName: labelForCells,
          type: "Lacus",
          label: `Lacus ${labelForCells}`,
          labelScale: 0.8,
          bestCell: computeInterconnectedCell(cells)
        }];
      }
      const segResult = segmentOceanCandidate(cells);
      if (!segResult.segmented) {
        if (size < 0.5 * V_max) {
          return [{
            cells,
            volume: size,
            constName: labelForCells,
            type: "Mare",
            label: `Mare ${labelForCells}`,
            labelScale: 0.9,
            bestCell: computeInterconnectedCell(cells)
          }];
        } else {
          return [{
            cells,
            volume: size,
            constName: labelForCells,
            type: "Oceanus",
            label: `Oceanus ${labelForCells}`,
            labelScale: 1.0,
            bestCell: computeInterconnectedCell(cells)
          }];
        }
      }
      const regions = [];
      segResult.cores.forEach(core => {
        const sub = this.recursiveSegmentCluster(core, V_max, this.getMajorityConstellation(core));
        sub.forEach(r => regions.push(r));
      });
      if (segResult.neck && segResult.neck.length > 0) {
        const neckLabel = this.getMajorityConstellation(segResult.neck);
        regions.push({
          cells: segResult.neck,
          volume: segResult.neck.length,
          constName: neckLabel,
          type: "Fretum",
          label: `Fretum ${neckLabel}`,
          labelScale: 0.7,
          bestCell: computeInterconnectedCell(segResult.neck),
          color: lightenColor(getBlueColor(neckLabel), 0.1)
        });
      }
      return regions;
    } else {
      if (size < 0.1 * V_max) {
        return [{
          cells,
          volume: size,
          constName: labelForCells,
          type: "Insula",
          label: `Insula ${labelForCells}`,
          labelScale: 0.8,
          bestCell: computeInterconnectedCell(cells)
        }];
      }
      const segResult = segmentOceanCandidate(cells);
      if (!segResult.segmented) {
        return [{
          cells,
          volume: size,
          constName: labelForCells,
          type: "Continens",
          label: `Continens ${labelForCells}`,
          labelScale: 1.0,
          bestCell: computeInterconnectedCell(cells)
        }];
      }
      const regions = [];
      segResult.cores.forEach(core => {
        let sub = this.recursiveSegmentCluster(core, V_max, this.getBestStarLabel(core));
        sub.forEach(r => {
          r.type = "Peninsula";
          r.label = `Peninsula ${r.constName}`;
          regions.push(r);
        });
      });
      if (segResult.neck && segResult.neck.length > 0) {
        const neckLabel = this.getBestStarLabel(segResult.neck);
        regions.push({
          cells: segResult.neck,
          volume: segResult.neck.length,
          constName: neckLabel,
          type: "Isthmus",
          label: `Isthmus ${neckLabel}`,
          labelScale: 0.7,
          bestCell: computeInterconnectedCell(segResult.neck),
          color: lightenColor(getGreenColor(neckLabel), 0.1)
        });
      }
      return regions;
    }
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
}

// Helper: Computes distances from a cell to stars.
function computeCellDistances(cell, stars) {
  const dArr = stars.map(star => {
    let starPos = star.truePosition 
      ? star.truePosition 
      : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    const dx = cell.tcPos.x - starPos.x;
    const dy = cell.tcPos.y - starPos.y;
    const dz = cell.tcPos.z - starPos.z;
    return { distance: Math.sqrt(dx * dx + dy * dy + dz * dz), star };
  });
  dArr.sort((a, b) => a.distance - b.distance);
  cell.distances = dArr.map(obj => obj.distance);
  cell.nearestStar = dArr.length > 0 ? dArr[0].star : null;
}

// Helper function: Determines the best star label among cells.
function getBestStarLabel(cells) {
  let bestStar = null;
  let bestRank = -Infinity;
  cells.forEach(cell => {
    if (cell.nearestStar) {
      const rank = getStellarClassRank(cell.nearestStar);
      if (rank > bestRank) {
        bestRank = rank;
        bestStar = cell.nearestStar;
      } else if (rank === bestRank && bestStar) {
        if (cell.nearestStar.Absolute_magnitude !== undefined && bestStar.Absolute_magnitude !== undefined) {
          if (cell.nearestStar.Absolute_magnitude < bestStar.Absolute_magnitude) {
            bestStar = cell.nearestStar;
          }
        }
      }
    }
  });
  return bestStar 
    ? (bestStar.Common_name_of_the_star_system || bestStar.Common_name_of_the_star || "Unknown") 
    : "Unknown";
}

// Helper function: Provides a ranking for stellar classes.
function getStellarClassRank(star) {
  if (!star || !star.Stellar_class) return 0;
  const letter = star.Stellar_class.charAt(0).toUpperCase();
  const rankMap = { 'O': 7, 'B': 6, 'A': 5, 'F': 4, 'G': 3, 'K': 2, 'M': 1 };
  return rankMap[letter] || 0;
}

// Helper: Converts a sphere coordinate to RA/DEC (in degrees).
function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

// Helper: Converts a string to title case.
function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
