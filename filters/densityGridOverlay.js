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
 * Constructs a grid overlay for density mapping.
 * 
 * For mode "low" (isolation filter) a uniform grid is built (unchanged).
 * For mode "high" (density filter) an adaptive KD tree–style subdivision is used.
 */
export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) to include grid cells.
   * @param {number} maxDistance - Maximum distance (LY) to include grid cells.
   * @param {number} gridSize - Size (in LY) of each grid cell (used only in low mode).
   * @param {string} mode - "low" (isolation) or "high" (density).
   */
  constructor(minDistance, maxDistance, gridSize = 2, mode = "low") {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.gridSize = gridSize;
    this.mode = mode; // "low" (isolation) or "high" (density)
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
    // For adaptive grid mode, store global bounding volume.
    this.globalVolume = 1;
  }

  /**
   * Creates the grid overlay.
   * In low mode the uniform grid method is used.
   * In high mode the grid is built adaptively using a KD tree–style subdivision.
   * @param {Array} stars - Array of star objects.
   */
  createGrid(stars) {
    if (this.mode === "low") {
      // === Uniform grid for Isolation Filter (unchanged) ===
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
      // Compute distances using an extended star set.
      const extendedStars = stars.filter(star => {
        const d = star.Distance_from_the_Sun;
        return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
      });
      this.cubesData.forEach(cell => computeCellDistances(cell, extendedStars));
    } else {
      // === Adaptive grid for Density Filter using KD tree–style subdivision ===
      this.buildAdaptiveGrid(stars);
    }
    this.computeAdjacentLines();
  }

  /**
   * Computes adjacent lines between grid cells.
   * In low mode the original neighbor lookup via grid indices is used.
   * In high mode (adaptive grid), adjacent lines are computed by testing if cells’ bounding boxes intersect.
   */
  computeAdjacentLines() {
    if (this.mode === "low") {
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
    } else {
      // For adaptive grid in high mode, use bounding-box intersection.
      this.adjacentLines = [];
      const tol = 0.001;
      for (let i = 0; i < this.cubesData.length; i++) {
        for (let j = i + 1; j < this.cubesData.length; j++) {
          const cell1 = this.cubesData[i];
          const cell2 = this.cubesData[j];
          if (this.areCellsAdjacent(cell1, cell2, tol)) {
            const points = getGreatCirclePoints(cell1.globeMesh.position, cell2.globeMesh.position, 100, 16);
            const positions = [];
            const colors = [];
            const c1 = cell1.globeMesh.material.color;
            const c2 = cell2.globeMesh.material.color;
            for (let k = 0; k < points.length; k++) {
              positions.push(points[k].x, points[k].y, points[k].z);
              let t = k / (points.length - 1);
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
            this.adjacentLines.push({ line, cell1, cell2 });
          }
        }
      }
    }
  }

  /**
   * Determines if two adaptive cells (with bounding boxes) are adjacent.
   * @param {Object} cell1 - A cell object with a bbox property.
   * @param {Object} cell2 - Another cell object with a bbox property.
   * @param {number} tol - Tolerance.
   * @returns {boolean} - True if the cells are adjacent or overlapping.
   */
  areCellsAdjacent(cell1, cell2, tol) {
    const b1 = cell1.bbox;
    const b2 = cell2.bbox;
    const overlapX = !(b1.max.x < b2.min.x - tol || b1.min.x > b2.max.x + tol);
    const overlapY = !(b1.max.y < b2.min.y - tol || b1.min.y > b2.max.y + tol);
    const overlapZ = !(b1.max.z < b2.min.z - tol || b1.min.z > b2.max.z + tol);
    return overlapX && overlapY && overlapZ;
  }

  /**
   * Builds an adaptive grid (via recursive subdivision) for high density mode.
   * Subdivides the bounding box until each leaf contains fewer than 5% of the total stars.
   * @param {Array} stars - Array of star objects.
   */
  buildAdaptiveGrid(stars) {
    // Clear previous data
    this.cubesData = [];
    // Filter stars with an extended range (same as in uniform grid)
    const extendedStars = stars.filter(star => {
      const d = star.Distance_from_the_Sun;
      return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
    });
    // Build an array of positions from the star data
    const points = extendedStars.map(star => {
      if (star.truePosition) {
        return star.truePosition.clone();
      } else {
        return new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      }
    });
    const totalCount = points.length;
    const thresholdCount = totalCount * 0.05;
    // Compute the overall bounding box and store global volume.
    const bbox = this.computeBoundingBox(points);
    this.globalBbox = bbox;
    this.globalVolume = ((bbox.max.x - bbox.min.x) * (bbox.max.y - bbox.min.y) * (bbox.max.z - bbox.min.z)) || 1;
    // Recursively subdivide the points/box until each leaf has <= thresholdCount points.
    const leafCells = this.subdivide(points, bbox, thresholdCount);
    // For each leaf, create a cell object.
    leafCells.forEach(cell => {
      // Compute cell size as the maximum extent of the bbox.
      const sizeX = cell.bbox.max.x - cell.bbox.min.x;
      const sizeY = cell.bbox.max.y - cell.bbox.min.y;
      const sizeZ = cell.bbox.max.z - cell.bbox.min.z;
      const cellSize = Math.max(sizeX, sizeY, sizeZ);
      // Create a cube mesh for the TrueCoordinates view.
      const geometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00, // Base green (will be updated in update)
        transparent: true,
        opacity: 1.0,
        depthWrite: false
      });
      const cubeTC = new THREE.Mesh(geometry, material);
      cubeTC.position.copy(cell.center);
      // Create a plane mesh for the Globe view.
      const planeGeom = new THREE.PlaneGeometry(cellSize, cellSize);
      const material2 = material.clone();
      const squareGlobe = new THREE.Mesh(planeGeom, material2);
      let distFromCenter = cell.center.length();
      let projectedPos;
      if (distFromCenter < 1e-6) {
        projectedPos = new THREE.Vector3(0, 0, 0);
      } else {
        const ra = Math.atan2(-cell.center.z, -cell.center.x);
        const dec = Math.asin(cell.center.y / distFromCenter);
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
      // Create a cell object and store computed properties.
      const cellObj = {
        tcMesh: cubeTC,
        globeMesh: squareGlobe,
        center: cell.center,
        bbox: cell.bbox,
        count: cell.count,
        volume: cell.volume,
        // In adaptive mode all cells are shown (coloring is based on subdivision)
        active: true,
        grid: { ix: 0, iy: 0, iz: 0 } // dummy for compatibility
      };
      this.cubesData.push(cellObj);
    });
  }

  /**
   * Computes the axis-aligned bounding box for an array of THREE.Vector3 points.
   * @param {Array} points - Array of THREE.Vector3.
   * @returns {Object} - { min, max }.
   */
  computeBoundingBox(points) {
    if (points.length === 0) return { min: new THREE.Vector3(), max: new THREE.Vector3() };
    const min = points[0].clone();
    const max = points[0].clone();
    points.forEach(p => {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    });
    return { min, max };
  }

  /**
   * Recursively subdivides an array of points within a bounding box until the number
   * of points in a leaf is <= threshold.
   * @param {Array} points - Array of THREE.Vector3.
   * @param {Object} bbox - { min, max }.
   * @param {number} threshold - Maximum allowed points per leaf.
   * @returns {Array} - Array of leaf cell objects: { center, bbox, count, volume }.
   */
  subdivide(points, bbox, threshold) {
    if (points.length <= threshold || points.length <= 1) {
      const center = new THREE.Vector3(
        (bbox.min.x + bbox.max.x) / 2,
        (bbox.min.y + bbox.max.y) / 2,
        (bbox.min.z + bbox.max.z) / 2
      );
      const volume = (bbox.max.x - bbox.min.x) * (bbox.max.y - bbox.min.y) * (bbox.max.z - bbox.min.z) || 1;
      return [{ center, bbox, count: points.length, volume }];
    }
    // Determine the longest axis of the bbox.
    const sizeX = bbox.max.x - bbox.min.x;
    const sizeY = bbox.max.y - bbox.min.y;
    const sizeZ = bbox.max.z - bbox.min.z;
    let axis = 'x';
    if (sizeY >= sizeX && sizeY >= sizeZ) axis = 'y';
    else if (sizeZ >= sizeX && sizeZ >= sizeY) axis = 'z';
    // Sort the points along the chosen axis.
    points.sort((a, b) => a[axis] - b[axis]);
    const medianIndex = Math.floor(points.length / 2);
    const medianValue = points[medianIndex][axis];
    // Create bounding boxes for left and right halves.
    const leftBbox = {
      min: bbox.min.clone(),
      max: bbox.max.clone()
    };
    leftBbox.max[axis] = medianValue;
    const rightBbox = {
      min: bbox.min.clone(),
      max: bbox.max.clone()
    };
    rightBbox.min[axis] = medianValue;
    const leftPoints = points.slice(0, medianIndex);
    const rightPoints = points.slice(medianIndex);
    const leftLeaves = this.subdivide(leftPoints, leftBbox, threshold);
    const rightLeaves = this.subdivide(rightPoints, rightBbox, threshold);
    return leftLeaves.concat(rightLeaves);
  }

  /**
   * Updates the grid overlay.
   * In low mode the uniform grid cells are updated as before.
   * In high mode the adaptive grid is rebuilt and then cells are colored based on their subdivision.
   * @param {Array} stars - Array of star objects.
   */
  update(stars) {
    if (this.mode === "low") {
      // === Low mode update (isolation filter) remains unchanged ===
      const extendedStars = stars.filter(star => {
        const d = star.Distance_from_the_Sun;
        return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
      });
      this.cubesData.forEach(cell => {
        computeCellDistances(cell, extendedStars);
      });
      let isolationVal = parseFloat(document.getElementById('low-density-slider').value) || 7;
      let toleranceVal = parseInt(document.getElementById('low-tolerance-slider').value) || 0;
      this.cubesData.forEach(cell => {
        let isoDist = Infinity;
        if (cell.distances && cell.distances.length > toleranceVal) {
          isoDist = cell.distances[toleranceVal];
        }
        let showSquare = (isoDist >= isolationVal);
        cell.active = showSquare;
        let ratio = cell.tcPos.length() / this.maxDistance;
        if (ratio > 1) ratio = 1;
        const alpha = THREE.MathUtils.lerp(0.1, 0.3, ratio);
        cell.tcMesh.visible = cell.active;
        cell.tcMesh.material.opacity = alpha;
        cell.globeMesh.visible = cell.active;
        cell.globeMesh.material.opacity = alpha;
        const scale = THREE.MathUtils.lerp(20.0, 0.1, ratio);
        cell.globeMesh.scale.set(scale, scale, 1);
      });
    } else {
      // === High mode update (density filter using adaptive grid) ===
      // Remove previous cell meshes and adjacent lines from scenes.
      this.cubesData.forEach(cell => {
        if (cell.tcMesh && cell.tcMesh.parent) cell.tcMesh.parent.remove(cell.tcMesh);
        if (cell.globeMesh && cell.globeMesh.parent) cell.globeMesh.parent.remove(cell.globeMesh);
      });
      this.adjacentLines.forEach(obj => {
        if (obj.line && obj.line.parent) obj.line.parent.remove(obj.line);
      });
      // Rebuild the adaptive grid from the updated star array.
      this.buildAdaptiveGrid(stars);
      // For high mode, we now compute a subdivision factor based on cell volume relative to the global volume.
      // Cells that are much smaller (i.e. heavily subdivided) will get a higher factor.
      this.cubesData.forEach(cell => {
        const factor = 1 - (cell.volume / this.globalVolume);
        // Map factor to alpha: low factor -> 0.10 (light green), high factor -> 0.5 (dark green).
        const alpha = THREE.MathUtils.lerp(0.10, 0.5, factor);
        // Interpolate color between light green and dark green.
        const lightGreen = new THREE.Color('#90EE90');
        const darkGreen = new THREE.Color('#006400');
        const cellColor = lightGreen.clone().lerp(darkGreen, factor);
        cell.tcMesh.material.color.set(cellColor);
        cell.globeMesh.material.color.set(cellColor);
        cell.tcMesh.material.opacity = alpha;
        cell.globeMesh.material.opacity = alpha;
        cell.tcMesh.visible = true;
        cell.globeMesh.visible = true;
        // Optionally adjust scale based on distance from center.
        let ratio = cell.center.length() / this.maxDistance;
        if (ratio > 1) ratio = 1;
        const scale = THREE.MathUtils.lerp(20.0, 0.1, ratio);
        cell.globeMesh.scale.set(scale, scale, 1);
      });
      // Recompute adjacent lines for the adaptive grid.
      this.computeAdjacentLines();
    }
    // In both modes, update adjacent line geometries.
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
    } else { // High density mode
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

/**
 * Helper function to compute cell distances (used only in low mode).
 */
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

/**
 * Placeholder helper: returns the best star label based on stellar class ranking.
 */
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
  return bestStar ? (bestStar.Common_name_of_the_star_system || bestStar.Common_name_of_the_star || "Unknown") : "Unknown";
}

/**
 * Placeholder helper: ranks a star’s stellar class.
 */
function getStellarClassRank(star) {
  if (!star || !star.Stellar_class) return 0;
  const letter = star.Stellar_class.charAt(0).toUpperCase();
  const rankMap = { 'O': 7, 'B': 6, 'A': 5, 'F': 4, 'G': 3, 'K': 2, 'M': 1 };
  return rankMap[letter] || 0;
}

/**
 * Helper: Converts a string to title case.
 */
function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
