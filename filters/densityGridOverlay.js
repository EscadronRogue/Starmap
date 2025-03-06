import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  getDoubleSidedLabelMaterial, 
  getBlueColor, 
  lightenColor, 
  darkenColor, 
  getGreenColor 
} from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, segmentOceanCandidate } from './densitySegmentation.js';
import { loadConstellationCenters, getConstellationCenters, loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

let constellationFullNames = null;
async function loadConstellationFullNames() {
  if (constellationFullNames) return constellationFullNames;
  try {
    const resp = await fetch('constellation_full_names.json');
    if (!resp.ok) throw new Error(`Failed to load constellation_full_names.json: ${resp.status}`);
    constellationFullNames = await resp.json();
    console.log("Constellation full names loaded successfully.");
  } catch (err) {
    console.error("Error loading constellation full names:", err);
    constellationFullNames = {};
  }
  return constellationFullNames;
}

function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function computeSphericalCentroid(vertices) {
  const sum = new THREE.Vector3(0, 0, 0);
  vertices.forEach(v => sum.add(v));
  return sum.normalize().multiplyScalar(100);
}

function isPointInSphericalPolygon(point, vertices) {
  let angleSum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i].clone().normalize();
    const v2 = vertices[(i + 1) % vertices.length].clone().normalize();
    const d1 = v1.clone().sub(point).normalize();
    const d2 = v2.clone().sub(point).normalize();
    let angle = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    angleSum += angle;
  }
  return Math.abs(angleSum - 2 * Math.PI) < 0.1;
}

function subdivideGeometry(geometry, iterations) {
  let geo = geometry;
  for (let iter = 0; iter < iterations; iter++) {
    const posAttr = geo.getAttribute('position');
    const oldPositions = [];
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      oldPositions.push(v);
    }
    const oldIndices = geo.getIndex().array;
    const newVertices = [...oldPositions];
    const newIndices = [];
    const midpointCache = {};
    function getMidpoint(i1, i2) {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      if (midpointCache[key] !== undefined) return midpointCache[key];
      const v1 = newVertices[i1];
      const v2 = newVertices[i2];
      const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5).normalize().multiplyScalar(100);
      newVertices.push(mid);
      const idx = newVertices.length - 1;
      midpointCache[key] = idx;
      return idx;
    }
    for (let i = 0; i < oldIndices.length; i += 3) {
      const i0 = oldIndices[i];
      const i1 = oldIndices[i + 1];
      const i2 = oldIndices[i + 2];
      const m0 = getMidpoint(i0, i1);
      const m1 = getMidpoint(i1, i2);
      const m2 = getMidpoint(i2, i0);
      newIndices.push(i0, m0, m2);
      newIndices.push(m0, i1, m1);
      newIndices.push(m0, m1, m2);
      newIndices.push(m2, m1, i2);
    }
    const positions = [];
    newVertices.forEach(v => positions.push(v.x, v.y, v.z));
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
  }
  return geo;
}

function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

function computeCellDistances(cell, stars) {
  const dArr = stars.map(star => {
    let starPos = star.truePosition ? star.truePosition : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    const dx = cell.tcPos.x - starPos.x;
    const dy = cell.tcPos.y - starPos.y;
    const dz = cell.tcPos.z - starPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
  dArr.sort((a, b) => a - b);
  cell.distances = dArr;
}

export class DensityGridOverlay {
  /**
   * @param {number} minDistance - Minimum distance (LY) to include grid cells.
   * @param {number} maxDistance - Maximum distance (LY) to include grid cells.
   * @param {number} gridSize - For low density mode, the cell size in LY.
   * @param {string} mode - "low" or "high".
   */
  constructor(minDistance, maxDistance, gridSize = 2, mode = "low") {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.gridSize = gridSize;
    this.mode = mode;
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
    
    if (this.mode === "high") {
      // These parameters are updated from the UI
      this.starThreshold = 10;
      this.maxDepth = 6;
    }
  }

  createGrid(stars) {
    if (this.mode === "low") {
      // Use the existing grid‐based method.
      const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
      this.cubesData = [];
      for (let x = -halfExt; x <= halfExt; x += this.gridSize) {
        for (let y = -halfExt; y <= halfExt; y += this.gridSize) {
          for (let z = -halfExt; z <= halfExt; z += this.gridSize) {
            const posTC = new THREE.Vector3(x + this.gridSize / 2, y + this.gridSize / 2, z + this.gridSize / 2);
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
            const cell = {
              tcMesh: cubeTC,
              globeMesh: squareGlobe,
              tcPos: posTC,
              grid: {
                ix: Math.round(x / this.gridSize),
                iy: Math.round(y / this.gridSize),
                iz: Math.round(z / this.gridSize)
              },
              active: false,
              id: this.cubesData.length
            };
            this.cubesData.push(cell);
          }
        }
      }
      const extendedStars = stars.filter(star => {
        const d = star.Distance_from_the_Sun;
        return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
      });
      this.cubesData.forEach(cell => computeCellDistances(cell, extendedStars));
      this.computeAdjacentLines();
    } else if (this.mode === "high") {
      // Build an octree over the cube [-maxDistance, maxDistance]^3.
      const half = this.maxDistance;
      this.rootMin = new THREE.Vector3(-half, -half, -half);
      this.rootMax = new THREE.Vector3(half, half, half);
      // Use distance fallback: use s.distance if available.
      const starPts = stars.filter(s => {
        const d = (s.distance !== undefined) ? s.distance : s.Distance_from_the_Sun;
        return d <= this.maxDistance + 10;
      }).map(s => {
        if (s.truePosition) {
          return { x: s.truePosition.x, y: s.truePosition.y, z: s.truePosition.z };
        }
        return { x: s.x_coordinate, y: s.y_coordinate, z: s.z_coordinate };
      });
      this.octreeRoot = this.buildOctreeRecursive(this.rootMin, this.rootMax, 0, starPts, this.starThreshold, this.maxDepth);
      this.leafNodes = [];
      const collectLeaves = (node) => {
        if (node.isLeaf) {
          this.leafNodes.push(node);
        } else if (node.children) {
          node.children.forEach(child => collectLeaves(child));
        }
      };
      collectLeaves(this.octreeRoot);
      this.cubesData = [];
      this.leafNodes.forEach(leaf => {
        const center = new THREE.Vector3(
          0.5 * (leaf.minPt.x + leaf.maxPt.x),
          0.5 * (leaf.minPt.y + leaf.maxPt.y),
          0.5 * (leaf.minPt.z + leaf.maxPt.z)
        );
        if (center.length() > this.maxDistance) return;
        const dx = leaf.maxPt.x - leaf.minPt.x;
        const dy = leaf.maxPt.y - leaf.minPt.y;
        const dz = leaf.maxPt.z - leaf.minPt.z;
        const geometry = new THREE.BoxGeometry(dx, dy, dz);
        const opacity = (leaf.depth / this.maxDepth) * 0.5;
        const material = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          transparent: true,
          opacity: opacity,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(center);
        const meshClone = mesh.clone();
        this.cubesData.push({
          node: leaf,
          tcMesh: mesh,
          globeMesh: meshClone,
          active: true
        });
      });
    }
  }

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
            const material = new THREE.LineBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 0.3,
              linewidth: 1
            });
            const line = new THREE.Line(geom, material);
            line.renderOrder = 1;
            this.adjacentLines.push({ line, cell1: cell, cell2: neighbor });
          }
        });
      });
    }
  }

  update(stars) {
    if (this.mode === "low") {
      // Low-density update (unchanged)
      const extendedStars = stars.filter(star => {
        const d = star.Distance_from_the_Sun;
        return d >= Math.max(0, this.minDistance - 10) && d <= this.maxDistance + 10;
      });
      this.cubesData.forEach(cell => {
        computeCellDistances(cell, extendedStars);
      });
      const isolationVal = parseFloat(document.getElementById('low-density-slider').value) || 7;
      const toleranceVal = parseInt(document.getElementById('low-tolerance-slider').value) || 0;
      this.cubesData.forEach(cell => {
        let isoDist = Infinity;
        if (cell.distances.length > toleranceVal) {
          isoDist = cell.distances[toleranceVal];
        }
        let showSquare = (isoDist >= isolationVal);
        cell.active = showSquare;
        let ratio = cell.tcPos.length() / this.maxDistance;
        if (ratio > 1) ratio = 1;
        const alpha = THREE.MathUtils.lerp(0.1, 0.3, ratio);
        cell.tcMesh.visible = showSquare;
        cell.tcMesh.material.opacity = alpha;
        cell.globeMesh.visible = showSquare;
        cell.globeMesh.material.opacity = alpha;
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
    } else if (this.mode === "high") {
      // Rebuild the octree overlay so that slider changes take effect.
      // Remove old cubes from scene if any.
      this.cubesData.forEach(cell => {
        if (cell.tcMesh.parent) cell.tcMesh.parent.remove(cell.tcMesh);
        if (cell.globeMesh.parent) cell.globeMesh.parent.remove(cell.globeMesh);
      });
      this.cubesData = [];
      this.octreeRoot = null;
      this.buildOctree();
      this.createGrid();
      this.cubesData.forEach(cell => {
        const center = new THREE.Vector3(
          0.5 * (cell.node.minPt.x + cell.node.maxPt.x),
          0.5 * (cell.node.minPt.y + cell.node.maxPt.y),
          0.5 * (cell.node.minPt.z + cell.node.maxPt.z)
        );
        cell.active = (center.length() <= this.maxDistance);
        const alpha = (cell.node.depth / this.maxDepth) * 0.5;
        cell.tcMesh.material.opacity = alpha;
        cell.globeMesh.material.opacity = alpha;
        cell.tcMesh.visible = cell.active;
        cell.globeMesh.visible = cell.active;
      });
    }
  }

  buildOctreeRecursive(minPt, maxPt, depth, starPts, starThreshold, maxDepth) {
    if (!starPts || starPts.length === 0) {
      return { isLeaf: true, minPt, maxPt, depth, starCount: 0 };
    }
    if (depth >= maxDepth || starPts.length <= starThreshold) {
      return { isLeaf: true, minPt, maxPt, depth, starCount: starPts.length };
    }
    const children = [];
    const center = new THREE.Vector3(
      0.5 * (minPt.x + maxPt.x),
      0.5 * (minPt.y + maxPt.y),
      0.5 * (minPt.z + maxPt.z)
    );
    for (let i = 0; i < 8; i++) {
      const childMin = new THREE.Vector3(
        (i & 1) ? center.x : minPt.x,
        (i & 2) ? center.y : minPt.y,
        (i & 4) ? center.z : minPt.z
      );
      const childMax = new THREE.Vector3(
        (i & 1) ? maxPt.x : center.x,
        (i & 2) ? maxPt.y : center.y,
        (i & 4) ? maxPt.z : center.z
      );
      const childStars = starPts.filter(sp =>
        sp.x >= childMin.x && sp.x <= childMax.x &&
        sp.y >= childMin.y && sp.y <= childMax.y &&
        sp.z >= childMin.z && sp.z <= childMax.z
      );
      if (childStars.length > 0) {
        children.push(this.buildOctreeRecursive(childMin, childMax, depth + 1, childStars, starThreshold, maxDepth));
      }
    }
    if (children.length === 0) {
      return { isLeaf: true, minPt, maxPt, depth, starCount: starPts.length };
    }
    return { isLeaf: false, minPt, maxPt, depth, starCount: starPts.length, children };
  }

  buildOctree() {
    this.octreeRoot = this.buildOctreeRecursive(this.rootMin, this.rootMax, 0, this.extendedStars, this.starThreshold, this.maxDepth);
    this.leafNodes = [];
    const collectLeaves = (node) => {
      if (node.isLeaf) {
        this.leafNodes.push(node);
      } else if (node.children) {
        node.children.forEach(child => collectLeaves(child));
      }
    };
    collectLeaves(this.octreeRoot);
  }

  collectLeafNodes(node) {
    if (node.isLeaf) {
      this.leafNodes.push(node);
    } else if (node.children) {
      node.children.forEach(child => this.collectLeafNodes(child));
    }
  }

  getBestStarLabel(cells) {
    return "HighDensityOctree";
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
    const namesMapping = await loadConstellationFullNames();
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      const cellPos = cell.tcPos.clone();
      let nearestBoundary = null;
      let minBoundaryDist = Infinity;
      boundaries.forEach(bdry => {
         const p1 = radToSphere(bdry.ra1, bdry.dec1, 100);
         const p2 = radToSphere(bdry.ra2, bdry.dec2, 100);
         const angle = cellPos.angleTo(p1);
         if (angle < minBoundaryDist) {
           minBoundaryDist = angle;
           nearestBoundary = bdry;
         }
      });
      if (!nearestBoundary) {
        cell.constellation = "Unknown";
        return;
      }
      const abbr1 = nearestBoundary.const1.toUpperCase();
      const fullName1 = namesMapping[abbr1] || toTitleCase(abbr1);
      cell.constellation = toTitleCase(fullName1);
    });
  }

  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) scene.remove(this.regionLabelsGroupTC);
      this.regionLabelsGroupTC = new THREE.Group();
    } else {
      if (this.regionLabelsGroupGlobe.parent) scene.remove(this.regionLabelsGroupGlobe);
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    scene.add(mapType === 'TrueCoordinates' ? this.regionLabelsGroupTC : this.regionLabelsGroupGlobe);
  }
}
