// /filters/densityFilter.js
// This module implements the Density Filter as a true KD tree.
// Each leaf is colored in green: the root leaf is light green (opacity 0.1) and, as subdivision increases,
// the leaves become darker and more opaque (up to 0.5). The subdivision is driven by a user‑adjustable threshold
// (the percentage of currently plotted stars contained in a leaf).

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial } from './densityColorUtils.js';
import { radToSphere, getGreatCirclePoints } from '../utils/geometryUtils.js';
import { segmentOceanCandidate } from './densitySegmentation.js';

export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) to include grid cells.
   * @param {number} maxDistance - Maximum distance (LY) to include grid cells.
   * @param {number} subdivisionThresholdPercent - Percentage of total stars in a cell to trigger subdivision (default is 5).
   */
  constructor(minDistance, maxDistance, subdivisionThresholdPercent = 5) {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.subdivisionThresholdPercent = subdivisionThresholdPercent;
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
  }

  createGrid(stars) {
    this.cubesData = [];
    // Filter stars using an extended range.
    const extendedStars = stars.filter(star => {
      const d = star.Distance_from_the_Sun;
      return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
    });
    const points = extendedStars.map(star => {
      if (star.truePosition) return star.truePosition.clone();
      return new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    });
    const totalCount = points.length;
    // Use the user‑defined threshold (as a percentage) for subdivision.
    const thresholdCount = totalCount * (this.subdivisionThresholdPercent / 100);
    const bbox = this.computeBoundingBox(points);
    // Recursively subdivide the points using a KD tree–style approach.
    const leafCells = this.subdivide(points, bbox, thresholdCount, 0);
    // Determine the maximum depth reached.
    let maxDepth = 0;
    leafCells.forEach(cell => {
      if (cell.depth > maxDepth) maxDepth = cell.depth;
    });
    // For each leaf cell, create a visual cell.
    leafCells.forEach(cell => {
      const sizeX = cell.bbox.max.x - cell.bbox.min.x;
      const sizeY = cell.bbox.max.y - cell.bbox.min.y;
      const sizeZ = cell.bbox.max.z - cell.bbox.min.z;
      const cellSize = Math.max(sizeX, sizeY, sizeZ);
      const geometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
      // Interpolate opacity from 0.1 (depth 0) to 0.5 (max depth).
      const depthRatio = maxDepth > 0 ? cell.depth / maxDepth : 0;
      const alpha = 0.1 + depthRatio * (0.5 - 0.1);
      // Interpolate lightness: shallow leaves (depth=0) are light (L=0.8) and deep leaves are darker (L=0.4).
      const L = 0.8 - depthRatio * (0.8 - 0.4);
      // Create a green color using HSL (hue=120°, saturation=70%).
      const color = new THREE.Color().setHSL(120 / 360, 0.7, L);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: alpha,
        depthWrite: false
      });
      const cubeTC = new THREE.Mesh(geometry, material);
      cubeTC.position.copy(cell.center);
      // For the Globe view, create a plane that is projected onto the sphere.
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
      // Create cell object.
      const cellObj = {
        tcMesh: cubeTC,
        globeMesh: squareGlobe,
        center: cell.center,
        bbox: cell.bbox,
        count: cell.count,
        volume: cell.volume,
        density: cell.count / cell.volume,
        depth: cell.depth,
        active: false,
        grid: { ix: 0, iy: 0, iz: 0 }
      };
      this.cubesData.push(cellObj);
    });
    this.computeAdjacentLines();
  }

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

  // Recursively subdivide the set of points within bbox until the number of points is below threshold.
  // The current recursion depth is passed as 'depth'.
  subdivide(points, bbox, threshold, depth) {
    if (points.length <= threshold || points.length <= 1) {
      const center = new THREE.Vector3(
        (bbox.min.x + bbox.max.x) / 2,
        (bbox.min.y + bbox.max.y) / 2,
        (bbox.min.z + bbox.max.z) / 2
      );
      const volume = (bbox.max.x - bbox.min.x) * (bbox.max.y - bbox.min.y) * (bbox.max.z - bbox.min.z) || 1;
      return [{ center, bbox, count: points.length, volume, depth }];
    }
    // Determine the longest axis.
    const sizeX = bbox.max.x - bbox.min.x;
    const sizeY = bbox.max.y - bbox.min.y;
    const sizeZ = bbox.max.z - bbox.min.z;
    let axis = 'x';
    if (sizeY >= sizeX && sizeY >= sizeZ) axis = 'y';
    else if (sizeZ >= sizeX && sizeZ >= sizeY) axis = 'z';
    // Sort points along the chosen axis.
    points.sort((a, b) => a[axis] - b[axis]);
    const medianIndex = Math.floor(points.length / 2);
    const medianValue = points[medianIndex][axis];
    // Define left and right bounding boxes.
    const leftBbox = { min: bbox.min.clone(), max: bbox.max.clone() };
    leftBbox.max[axis] = medianValue;
    const rightBbox = { min: bbox.min.clone(), max: bbox.max.clone() };
    rightBbox.min[axis] = medianValue;
    const leftPoints = points.slice(0, medianIndex);
    const rightPoints = points.slice(medianIndex);
    const leftLeaves = this.subdivide(leftPoints, leftBbox, threshold, depth + 1);
    const rightLeaves = this.subdivide(rightPoints, rightBbox, threshold, depth + 1);
    return leftLeaves.concat(rightLeaves);
  }

  computeAdjacentLines() {
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

  // Simple adjacent check based on bounding boxes.
  areCellsAdjacent(cell1, cell2, tol) {
    const b1 = cell1.bbox;
    const b2 = cell2.bbox;
    const overlapX = !(b1.max.x < b2.min.x - tol || b1.min.x > b2.max.x + tol);
    const overlapY = !(b1.max.y < b2.min.y - tol || b1.min.y > b2.max.y + tol);
    const overlapZ = !(b1.max.z < b2.min.z - tol || b1.min.z > b2.max.z + tol);
    return overlapX && overlapY && overlapZ;
  }

  update(stars) {
    // Remove previous cell meshes and adjacent lines.
    this.cubesData.forEach(cell => {
      if (cell.tcMesh && cell.tcMesh.parent) cell.tcMesh.parent.remove(cell.tcMesh);
      if (cell.globeMesh && cell.globeMesh.parent) cell.globeMesh.parent.remove(cell.globeMesh);
    });
    this.adjacentLines.forEach(obj => {
      if (obj.line && obj.line.parent) obj.line.parent.remove(obj.line);
    });
    this.buildAdaptiveGrid(stars);
    const densityThreshold = parseFloat(document.getElementById('density-slider').value) || 1;
    // Determine max depth among current cells.
    let maxDepth = 0;
    this.cubesData.forEach(cell => {
      if (cell.depth > maxDepth) maxDepth = cell.depth;
    });
    this.cubesData.forEach(cell => {
      cell.density = cell.count / cell.volume;
      cell.active = (cell.density > densityThreshold);
      let ratio = cell.center.length() / this.maxDistance;
      if (ratio > 1) ratio = 1;
      const depthRatio = maxDepth > 0 ? cell.depth / maxDepth : 0;
      const alpha = 0.1 + depthRatio * (0.5 - 0.1);
      const L = 0.8 - depthRatio * (0.8 - 0.4);
      cell.tcMesh.material.color.setHSL(120 / 360, 0.7, L);
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.material.color.setHSL(120 / 360, 0.7, L);
      cell.globeMesh.material.opacity = alpha;
      cell.tcMesh.visible = cell.active;
      cell.globeMesh.visible = cell.active;
      const scale = THREE.MathUtils.lerp(20.0, 0.1, ratio);
      cell.globeMesh.scale.set(scale, scale, 1);
    });
    this.computeAdjacentLines();
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

  buildAdaptiveGrid(stars) {
    this.cubesData = [];
    const extendedStars = stars.filter(star => {
      const d = star.Distance_from_the_Sun;
      return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
    });
    const points = extendedStars.map(star => {
      if (star.truePosition) return star.truePosition.clone();
      return new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    });
    const totalCount = points.length;
    const thresholdCount = totalCount * (this.subdivisionThresholdPercent / 100);
    const bbox = this.computeBoundingBox(points);
    const leafCells = this.subdivide(points, bbox, thresholdCount, 0);
    leafCells.forEach(cell => {
      const sizeX = cell.bbox.max.x - cell.bbox.min.x;
      const sizeY = cell.bbox.max.y - cell.bbox.min.y;
      const sizeZ = cell.bbox.max.z - cell.bbox.min.z;
      const cellSize = Math.max(sizeX, sizeY, sizeZ);
      const geometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
      // Compute color and opacity based on depth.
      let maxDepth = 0;
      leafCells.forEach(c => {
        if (c.depth > maxDepth) maxDepth = c.depth;
      });
      const depthRatio = maxDepth > 0 ? cell.depth / maxDepth : 0;
      const alpha = 0.1 + depthRatio * (0.5 - 0.1);
      const L = 0.8 - depthRatio * (0.8 - 0.4);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(120 / 360, 0.7, L),
        transparent: true,
        opacity: alpha,
        depthWrite: false
      });
      const cubeTC = new THREE.Mesh(geometry, material);
      cubeTC.position.copy(cell.center);
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
      const cellObj = {
        tcMesh: cubeTC,
        globeMesh: squareGlobe,
        center: cell.center,
        bbox: cell.bbox,
        count: cell.count,
        volume: cell.volume,
        density: cell.count / cell.volume,
        depth: cell.depth,
        active: false,
        grid: { ix: 0, iy: 0, iz: 0 }
      };
      this.cubesData.push(cellObj);
    });
  }
}

export function initDensityFilter(minDistance, maxDistance, starArray, subdivisionThresholdPercent = 5) {
  const overlay = new DensityGridOverlay(minDistance, maxDistance, subdivisionThresholdPercent);
  overlay.createGrid(starArray);
  return overlay;
}

export function updateDensityFilter(starArray, overlay) {
  if (!overlay) return;
  overlay.update(starArray);
}
