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

/**
 * DensityGridOverlay
 * 
 * Constructs an overlay for density mapping.
 *
 * In "isolation" mode, a fixed grid is used.
 * In "density" mode, a KD tree approach recursively subdivides the star positions 
 * until each cell contains less than 5% of all plotted stars.
 */
export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) to include cells.
   * @param {number} maxDistance - Maximum distance (LY) to include cells.
   * @param {number} gridSize - Base grid size (or starting subdivision value).
   * @param {string} mode - Either "isolation" or "density".
   */
  constructor(minDistance, maxDistance, gridSize = 2, mode = "isolation") {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.gridSize = gridSize;
    this.mode = mode; // "isolation" or "density"
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
    // For KD tree mode, totalStars is set during grid creation.
    this.totalStars = 0;
  }

  createGrid(stars) {
    if (this.mode === "isolation") {
      // Fixed-grid method for isolation mapping.
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
            if (distFromCenter < this.minDistance || distFromCenter > this.maxDistance) continue;
            
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
      // Compute distances using an extended star set.
      const extendedStars = stars.filter(star => {
        const d = star.Distance_from_the_Sun;
        return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
      });
      this.cubesData.forEach(cell => computeCellDistances(cell, extendedStars));
      this.computeAdjacentLines();
    } else if (this.mode === "density") {
      // KD tree method for density mapping.
      this.totalStars = stars.length;
      const points = stars.map(star => ({ position: star.truePosition.clone(), star: star }));
      const threshold = 0.05 * this.totalStars; // 5% threshold
      this.cubesData = buildKDTree(points, 0, threshold, this);
      // In density mode, we do not use adjacent lines.
      this.adjacentLines = [];
    }
  }

  computeAdjacentLines() {
    if (this.mode === "density") {
      this.adjacentLines = [];
      return;
    }
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
    if (this.mode === "isolation") {
      const isolationVal = parseFloat(document.getElementById('low-density-slider').value) || 7;
      const toleranceVal = parseInt(document.getElementById('low-tolerance-slider').value) || 0;
      this.cubesData.forEach(cell => {
        let isoDist = Infinity;
        if (cell.distances.length > toleranceVal) {
          isoDist = cell.distances[toleranceVal];
        }
        const showSquare = (isoDist >= isolationVal);
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
    } else if (this.mode === "density") {
      // For density mode, determine a normalized value based on cell.count.
      this.cubesData.forEach(cell => {
        let normalized = THREE.MathUtils.clamp(cell.count / (0.05 * this.totalStars), 0, 1);
        cell.active = true;
        const alpha = THREE.MathUtils.lerp(0.10, 0.5, normalized);
        // Interpolate between light green and dark green.
        const lightGreen = new THREE.Color('#90ee90');
        const darkGreen = new THREE.Color('#006400');
        const color = lightGreen.clone().lerp(darkGreen, normalized);
        cell.tcMesh.visible = true;
        cell.tcMesh.material.opacity = alpha;
        cell.tcMesh.material.color.set(color);
        cell.globeMesh.visible = true;
        cell.globeMesh.material.opacity = alpha;
        cell.globeMesh.material.color.set(color);
        const scale = THREE.MathUtils.lerp(20.0, 0.1, normalized);
        cell.globeMesh.scale.set(scale, scale, 1);
      });
    }
  }

  async assignConstellationsToCells() {
    if (this.mode === "isolation") {
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
    } else { // In density mode, assign a best star label per cell.
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
      let labelPos = region.bestCell
        ? region.bestCell.tcPos
        : this.computeCentroid(region.cells);
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
        let baseColor = (this.mode === "isolation") ? getBlueColor(region.constName) : getGreenColor(region.constName);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || baseColor);
          cell.globeMesh.material.color.set(region.color || baseColor);
        });
      } else if (region.type === 'Fretum' || region.type === 'Isthmus') {
        let baseColor = (this.mode === "isolation") ? getBlueColor(region.constName) : getGreenColor(region.constName);
        region.color = lightenColor(baseColor, 0.1);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }
}

// -------------------------------------------------------------------
// Helper function to compute cell distances.
function computeCellDistances(cell, stars) {
  const dArr = stars.map(star => {
    let starPos = star.truePosition ? star.truePosition : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    const dx = cell.tcPos.x - starPos.x;
    const dy = cell.tcPos.y - starPos.y;
    const dz = cell.tcPos.z - starPos.z;
    return { distance: Math.sqrt(dx * dx + dy * dy + dz * dz), star };
  });
  dArr.sort((a, b) => a.distance - b.distance);
  cell.distances = dArr.map(obj => obj.distance);
  cell.nearestStar = dArr.length > 0 ? dArr[0].star : null;
}

// -------------------------------------------------------------------
// KD Tree Helpers for Density Mode

function buildKDTree(points, depth, threshold, overlay) {
  if (points.length <= threshold) {
    return [createCellFromPoints(points, overlay)];
  }
  const axis = depth % 3;
  points.sort((a, b) => a.position.getComponent(axis) - b.position.getComponent(axis));
  const medianIndex = Math.floor(points.length / 2);
  const leftPoints = points.slice(0, medianIndex);
  const rightPoints = points.slice(medianIndex);
  let cells = [];
  cells = cells.concat(buildKDTree(leftPoints, depth + 1, threshold, overlay));
  cells = cells.concat(buildKDTree(rightPoints, depth + 1, threshold, overlay));
  return cells;
}

function createCellFromPoints(points, overlay) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  points.forEach(pt => {
    const pos = pt.position;
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.z < minZ) minZ = pos.z;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y > maxY) maxY = pos.y;
    if (pos.z > maxZ) maxZ = pos.z;
  });
  const minVec = new THREE.Vector3(minX, minY, minZ);
  const maxVec = new THREE.Vector3(maxX, maxY, maxZ);
  const center = new THREE.Vector3().addVectors(minVec, maxVec).multiplyScalar(0.5);
  const boxSize = new THREE.Vector3().subVectors(maxVec, minVec);
  const sizeX = boxSize.x || overlay.gridSize;
  const sizeY = boxSize.y || overlay.gridSize;
  const sizeZ = boxSize.z || overlay.gridSize;
  const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  const materialColor = (overlay.mode === "isolation") ? 0x0000ff : 0x00ff00;
  const material = new THREE.MeshBasicMaterial({
    color: materialColor,
    transparent: true,
    opacity: 1.0,
    depthWrite: false
  });
  const cubeTC = new THREE.Mesh(geometry, material);
  cubeTC.position.copy(center);
  
  const planeGeom = new THREE.PlaneGeometry(sizeX, sizeY);
  const material2 = material.clone();
  const squareGlobe = new THREE.Mesh(planeGeom, material2);
  let projectedPos;
  const distFromCenter = center.length();
  if (distFromCenter < 1e-6) {
    projectedPos = new THREE.Vector3(0, 0, 0);
  } else {
    const ra = Math.atan2(-center.z, -center.x);
    const dec = Math.asin(center.y / distFromCenter);
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
    tcPos: center,
    count: points.length,
    active: true
  };
  cell.id = overlay.cubesData ? overlay.cubesData.length : 0;
  return cell;
}

function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
