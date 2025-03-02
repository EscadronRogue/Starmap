// /filters/densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  getDoubleSidedLabelMaterial, 
  getBaseColor, 
  lightenColor, 
  darkenColor, 
  getBlueColor,
} from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, segmentOceanCandidate } from './densitySegmentation.js';
import { loadConstellationCenters, getConstellationCenters, loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

/**
 * Instead of hard‑coding the mapping from constellation abbreviations to full names,
 * we load the data from an external JSON file.
 */
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

/**
 * Helper: Convert a string to Title Case.
 */
function toTitleCase(str) {
  if (!str || typeof str !== "string") return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Helper: Compute the spherical centroid of a set of vertices.
 */
function computeSphericalCentroid(vertices) {
  const sum = new THREE.Vector3(0, 0, 0);
  vertices.forEach(v => sum.add(v));
  return sum.normalize().multiplyScalar(100);
}

/**
 * Helper: Test if a point lies inside a spherical polygon.
 */
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

/**
 * Helper: Subdivide geometry on the sphere.
 */
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
    newVertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Helper: Convert a sphere point (THREE.Vector3) to RA/DEC (in degrees).
 */
function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

/**
 * Helper: Convert RA/DEC (radians) to a point on the sphere of radius R.
 */
function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

/**
 * Exported class that manages the density grid overlay.
 */
export class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionClusters = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
  }

  /**
   * Creates the grid cells based on the provided stars.
   */
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

          // Create corresponding square for Globe view:
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

          // Calculate RA/DEC from the grid cell (for logging)
          const cellRa = ((posTC.x + halfExt) / (2 * halfExt)) * 360;
          const cellDec = ((posTC.y + halfExt) / (2 * halfExt)) * 180 - 90;
          cell.ra = cellRa;
          cell.dec = cellDec;

          cell.id = this.cubesData.length;
          this.cubesData.push(cell);
        }
      }
    }
    this.computeDistances(stars);
    this.computeAdjacentLines();
  }

  /**
   * For each grid cell, compute distances to all stars.
   */
  computeDistances(stars) {
    this.cubesData.forEach(cell => {
      const dArr = stars.map(star => {
        let starPos = star.truePosition 
                      ? star.truePosition 
                      : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        const dx = cell.tcPos.x - starPos.x;
        const dy = cell.tcPos.y - starPos.y;
        const dz = cell.tcPos.z - starPos.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      });
      dArr.sort((a, b) => a - b);
      cell.distances = dArr;
    });
  }

  /**
   * Computes lines connecting adjacent grid cells.
   */
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

  /**
   * Updates the grid cells’ visibility and appearance based on the stars.
   */
  update(stars) {
    const densitySlider = document.getElementById('density-slider');
    const toleranceSlider = document.getElementById('tolerance-slider');
    if (!densitySlider || !toleranceSlider) return;
    const isolationVal = parseFloat(densitySlider.value) || 1;
    const toleranceVal = parseInt(toleranceSlider.value) || 0;
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

  /**
   * Assigns constellations to grid cells using the nearest constellation boundary.
   * This method loads the full names mapping from the external JSON.
   */
  async assignConstellationsToCells() {
    await loadConstellationCenters();
    await loadConstellationBoundaries();
    const centers = getConstellationCenters();
    const boundaries = getConstellationBoundaries();
    if (boundaries.length === 0) {
      console.warn("No constellation boundaries available!");
      return;
    }
    function radToSphere(ra, dec, R) {
      const x = -R * Math.cos(dec) * Math.cos(ra);
      const y = R * Math.sin(dec);
      const z = -R * Math.cos(dec) * Math.sin(ra);
      return new THREE.Vector3(x, y, z);
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
         // fallback: pick nearest constellation center
         const { ra: cellRA, dec: cellDec } = vectorToRaDec(cellPos);
         let bestConstellation = "Unknown";
         let minAngle = Infinity;
         centers.forEach(center => {
            const centerRAdeg = THREE.Math.radToDeg(center.ra);
            const centerDecdeg = THREE.Math.radToDeg(center.dec);
            const angDist = angularDistance(cellRA, cellDec, centerRAdeg, centerDecdeg);
            if (angDist < minAngle) {
              minAngle = angDist;
              bestConstellation = toTitleCase(center.name);
            }
         });
         cell.constellation = bestConstellation;
      }
    });
  }

  /**
   * Helper for spherical angular distance in degrees.
   */
  getAngularDistanceDeg(ra1, dec1, ra2, dec2) {
    const ra1Rad = THREE.Math.degToRad(ra1);
    const dec1Rad = THREE.Math.degToRad(dec1);
    const ra2Rad = THREE.Math.degToRad(ra2);
    const dec2Rad = THREE.Math.degToRad(dec2);
    const cosDelta = Math.sin(dec1Rad) * Math.sin(dec2Rad) +
                     Math.cos(dec1Rad) * Math.cos(dec2Rad) * Math.cos(ra1Rad - ra2Rad);
    const delta = Math.acos(THREE.MathUtils.clamp(cosDelta, -1, 1));
    return THREE.Math.radToDeg(delta);
  }

  /**
   * Creates a region label mesh.
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

  /**
   * Projects a point from TrueCoordinates to the Globe.
   */
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

  /**
   * Computes the centroid of a set of cells (using their true coordinate positions).
   */
  computeCentroid(cells) {
    let sum = new THREE.Vector3(0, 0, 0);
    cells.forEach(c => sum.add(c.tcPos));
    return sum.divideScalar(cells.length);
  }

  /**
   * Adds region labels to the provided scene.
   */
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
        labelPos = this.computeCentroid(region.cells);
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

  /**
   * Updates cell colors based on region classification.
   */
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    regions.forEach(region => {
      if (region.type === 'Oceanus' || region.type === 'Mare' || region.type === 'Lacus') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBlueColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBlueColor(region.constName));
        });
      } else if (region.type === 'Fretum') {
        let parentColor = getBlueColor(region.constName);
        region.color = lightenColor(getBlueColor(region.constName), 0.1);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }

  /**
   * Recursively segments a cluster to find necks (straits) multiple times if needed.
   */
  recursiveSegmentCluster(cells, V_max) {
    const regions = [];
    const clusterSize = cells.length;
    const majority = this.getMajorityConstellation(cells);

    if (clusterSize < 0.1 * V_max) {
      // "Lacus"
      regions.push({
        cells,
        volume: clusterSize,
        constName: majority,
        type: "Lacus",
        label: `Lacus ${majority}`,
        labelScale: 0.8,
        bestCell: computeInterconnectedCell(cells)
      });
      return regions;
    } else if (clusterSize < 0.5 * V_max) {
      // "Mare"
      regions.push({
        cells,
        volume: clusterSize,
        constName: majority,
        type: "Mare",
        label: `Mare ${majority}`,
        labelScale: 0.9,
        bestCell: computeInterconnectedCell(cells)
      });
      return regions;
    }

    // Possibly an "Oceanus", check for straits
    const segResult = segmentOceanCandidate(cells);
    if (!segResult.segmented) {
      // It's a single large region with no strait found
      regions.push({
        cells,
        volume: clusterSize,
        constName: majority,
        type: "Oceanus",
        label: `Oceanus ${majority}`,
        labelScale: 1.0,
        bestCell: computeInterconnectedCell(cells)
      });
    } else {
      // We have a neck + 2 big cores => we classify each core *recursively*
      segResult.cores.forEach((core, i) => {
        const subRegions = this.recursiveSegmentCluster(core, V_max);
        subRegions.forEach(sr => regions.push(sr));
      });
      // Then the neck region
      if (segResult.neck && segResult.neck.length > 0) {
        const neckMajority = this.getMajorityConstellation(segResult.neck);
        let straitColor = lightenColor(getBlueColor(neckMajority), 0.1);
        regions.push({
          cells: segResult.neck,
          volume: segResult.neck.length,
          constName: neckMajority,
          type: "Fretum",
          label: `Fretum ${neckMajority}`,
          labelScale: 0.7,
          bestCell: computeInterconnectedCell(segResult.neck),
          color: straitColor
        });
      }
    }
    return regions;
  }

  /**
   * Returns the majority constellation among a set of cells.
   */
  getMajorityConstellation(cells) {
    const freq = {};
    cells.forEach(cell => {
      const cst = cell.constellation && cell.constellation !== "Unknown" ? toTitleCase(cell.constellation) : null;
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

  /**
   * Classifies grid cells into regions, subdividing clusters repeatedly if needed.
   */
  classifyEmptyRegions() {
    // Clear the previous regionClusters before reclassifying
    this.regionClusters = [];

    // Step 1) Identify which cells are active
    const activeCells = this.cubesData.filter(c => c.active);

    // Step 2) Group connected components
    const clusters = [];
    const visited = new Set();
    const cellMap = new Map();
    activeCells.forEach(cell => cellMap.set(cell.id, cell));

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
              const neighborKey = `${current.grid.ix + dx},${current.grid.iy + dy},${current.grid.iz + dz}`;
              // Identify the neighbor in cellMap
              const found = activeCells.find(c => 
                c.grid.ix === current.grid.ix + dx &&
                c.grid.iy === current.grid.iy + dy &&
                c.grid.iz === current.grid.iz + dz
              );
              if (found && !visited.has(found.id)) {
                stack.push(found);
              }
            }
          }
        }
      }
      clusters.push(clusterCells);
    });

    // Step 3) Determine maximum cluster size
    let V_max = 0;
    clusters.forEach(c => {
      if (c.length > V_max) V_max = c.length;
    });

    // Step 4) For each cluster, subdivide recursively if needed
    const finalRegions = [];
    clusters.forEach(c => {
      const subRegions = this.recursiveSegmentCluster(c, V_max);
      subRegions.forEach(sr => finalRegions.push(sr));
    });

    this.regionClusters = finalRegions;
    return finalRegions;
  }

  /**
   * Removes references, if needed.
   */
  getRegionClusters() {
    return this.regionClusters;
  }
}

/* End of /filters/densityGridOverlay.js */
