// /filters/densityFilter.js
// This module implements the Density Filter as a true KD tree.
// Each leaf cell is colored in green: the root cell (depth 0) is light green with opacity 0.1,
// and deeper leaves become darker (lower HSL lightness) and more opaque (up to 0.5).
// We now use an absolute star‑count threshold for filtering cells,
// while the kd‑tree subdivision threshold is fixed (default 10 stars per cell).

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { radToSphere, getGreatCirclePoints } from '../utils/geometryUtils.js';

export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) to include grid cells.
   * @param {number} maxDistance - Maximum distance (LY) to include grid cells.
   * @param {number} kdSubdivisionThreshold - Fixed threshold for kd‑tree subdivision (default 10).
   */
  constructor(minDistance, maxDistance, kdSubdivisionThreshold = 10) {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    // This value controls how many stars a cell can contain at most
    // before no further subdivision. For density grouping, a higher number
    // produces larger cells.
    this.kdSubdivisionThreshold = kdSubdivisionThreshold;
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
    // Use the fixed kd‑tree threshold (stars per cell)
    const thresholdCount = this.kdSubdivisionThreshold;
    const bbox = this.computeBoundingBox(points);
    const leafCells = this.subdivide(points, bbox, thresholdCount, 0);
    // Determine maximum depth reached.
    let maxDepth = 0;
    leafCells.forEach(cell => {
      if (cell.depth > maxDepth) maxDepth = cell.depth;
    });
    // For each leaf cell, create visual cell meshes.
    leafCells.forEach(cell => {
      const sizeX = cell.bbox.max.x - cell.bbox.min.x;
      const sizeY = cell.bbox.max.y - cell.bbox.min.y;
      const sizeZ = cell.bbox.max.z - cell.bbox.min.z;
      const cellSize = Math.max(sizeX, sizeY, sizeZ);
      const geometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
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
      const cellObj = {
        tcMesh: cubeTC,
        globeMesh: squareGlobe,
        center: cell.center,
        bbox: cell.bbox,
        count: cell.count,
        volume: cell.volume,
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

  // Recursively subdivide the set of points until the number in the cell is <= threshold.
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
    const sizeX = bbox.max.x - bbox.min.x;
    const sizeY = bbox.max.y - bbox.min.y;
    const sizeZ = bbox.max.z - bbox.min.z;
    let axis = 'x';
    if (sizeY >= sizeX && sizeY >= sizeZ) axis = 'y';
    else if (sizeZ >= sizeX && sizeZ >= sizeY) axis = 'z';
    points.sort((a, b) => a[axis] - b[axis]);
    const medianIndex = Math.floor(points.length / 2);
    const medianValue = points[medianIndex][axis];
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

  // Helper to check if two cells (their bounding boxes) are adjacent.
  areCellsAdjacent(cell1, cell2, tol) {
    const b1 = cell1.bbox;
    const b2 = cell2.bbox;
    const overlapX = !(b1.max.x < b2.min.x - tol || b1.min.x > b2.max.x + tol);
    const overlapY = !(b1.max.y < b2.min.y - tol || b1.min.y > b2.max.y + tol);
    const overlapZ = !(b1.max.z < b2.min.z - tol || b1.min.z > b2.max.z + tol);
    return overlapX && overlapY && overlapZ;
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

  // In update, we now use an absolute star count threshold for filtering.
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
    // Read the filtering threshold (absolute star count) from the slider.
    const starThreshold = parseFloat(document.getElementById('density-subdivision-percent-slider').value) || 1;
    let maxDepth = 0;
    this.cubesData.forEach(cell => {
      if (cell.depth > maxDepth) maxDepth = cell.depth;
    });
    // Log cell counts for debugging.
    console.log("Density Filter: cell counts =", this.cubesData.map(c => c.count));
    this.cubesData.forEach(cell => {
      // Mark the cell active if its star count meets or exceeds the threshold.
      cell.active = (cell.count >= starThreshold);
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
    const thresholdCount = this.kdSubdivisionThreshold;
    const bbox = this.computeBoundingBox(points);
    const leafCells = this.subdivide(points, bbox, thresholdCount, 0);
    leafCells.forEach(cell => {
      const sizeX = cell.bbox.max.x - cell.bbox.min.x;
      const sizeY = cell.bbox.max.y - cell.bbox.min.y;
      const sizeZ = cell.bbox.max.z - cell.bbox.min.z;
      const cellSize = Math.max(sizeX, sizeY, sizeZ);
      const geometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
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
        depth: cell.depth,
        active: false,
        grid: { ix: 0, iy: 0, iz: 0 }
      };
      this.cubesData.push(cellObj);
    });
  }
}

export function initDensityFilter(minDistance, maxDistance, starArray, kdSubdivisionThreshold = 10) {
  const overlay = new DensityGridOverlay(minDistance, maxDistance, kdSubdivisionThreshold);
  overlay.createGrid(starArray);
  return overlay;
}

export function updateDensityFilter(starArray, overlay) {
  if (!overlay) return;
  overlay.update(starArray);
}
