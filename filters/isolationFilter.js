// /filters/isolationFilter.js
// This module implements the Isolation Filter using a uniform grid (the former “low density” filter).
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial, getBlueColor, lightenColor } from './densityColorUtils.js';
import { radToSphere, getGreatCirclePoints } from '../utils/geometryUtils.js';
import { loadConstellationCenters, getConstellationCenters, loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

// The IsolationGridOverlay class encapsulates the original uniform grid logic.
export class IsolationGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) for cells.
   * @param {number} maxDistance - Maximum distance (LY) for cells.
   * @param {number} gridSize - The size (in LY) of each cell.
   */
  constructor(minDistance, maxDistance, gridSize = 2) {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.gridSize = gridSize;
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
          // Only include cells within the specified distance range.
          if (distFromCenter < this.minDistance || distFromCenter > this.maxDistance) continue;
          
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff, // Blue color for Isolation Filter
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
      const d = star.Distance_from_the_Sun;
      return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
    });
    this.cubesData.forEach(cell => {
      computeCellDistances(cell, extendedStars);
    });
    const isolationVal = parseFloat(document.getElementById('isolation-slider').value) || 7;
    const toleranceVal = parseInt(document.getElementById('isolation-tolerance-slider').value) || 0;
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
    // Assume loadConstellationFullNames is available in context.
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
  }
}

// Helper: compute cell distances for the uniform grid.
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

// Helper: convert a string to title case.
function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
