// /filters/densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { 
  getDoubleSidedLabelMaterial, 
  getBaseColor, 
  lightenColor, 
  darkenColor, 
  getBlueColor,
  // Removed hexToRGBA because it’s not provided by densityColorUtils.js
} from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, segmentOceanCandidate } from './densitySegmentation.js';
// Instead of constellation centers, we now import boundaries:
import { getConstellationBoundaries } from './constellationFilter.js';

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
            // Calculate RA/DEC from grid coordinates:
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

          // Calculate RA/DEC directly from the grid cell.
          // RA: map x from [-halfExt, halfExt] to [0,360]
          // DEC: map y from [-halfExt, halfExt] to [-90,+90]
          const cellRa = ((posTC.x + halfExt) / (2 * halfExt)) * 360;
          const cellDec = ((posTC.y + halfExt) / (2 * halfExt)) * 180 - 90;
          cell.ra = cellRa;
          cell.dec = cellDec;

          // assign an ID for logging
          cell.id = this.cubesData.length;
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
  
  // ------------------ NEW: Constellation Attribution using Boundaries ------------------
  // This method now groups the boundary segments (from the TXT file) to build full RA/DEC polygons
  // for each constellation and then uses a point‑in‑polygon test to assign each active cell
  // the constellation that actually contains its (RA,DEC) coordinates.
  async assignConstellationsToCells() {
    const boundaries = getConstellationBoundaries();
    if (!boundaries || boundaries.length === 0) {
      console.warn("No constellation boundaries available!");
      return;
    }
    
    // Helper: Convert a 3D point (on a sphere of radius R) to {ra, dec} in degrees.
    function vectorToRaDec(vector, R) {
      const dec = Math.asin(vector.y / R);
      let ra = Math.atan2(-vector.z, -vector.x);
      let raDeg = THREE.Math.radToDeg(ra);
      if (raDeg < 0) raDeg += 360;
      return { ra: raDeg, dec: THREE.Math.radToDeg(dec) };
    }
    
    // Helper: Group boundary segments by constellation and order them to form a polygon.
    function getConstellationPolygons() {
      const groups = {};
      boundaries.forEach(seg => {
        if (seg.const1) {
          const key = seg.const1.toUpperCase();
          if (!groups[key]) groups[key] = [];
          groups[key].push(seg);
        }
        if (seg.const2 && seg.const2.toUpperCase() !== (seg.const1 ? seg.const1.toUpperCase() : '')) {
          const key = seg.const2.toUpperCase();
          if (!groups[key]) groups[key] = [];
          groups[key].push(seg);
        }
      });
  
      const R = 100;
      const constellationPolygons = {};
  
      for (const constellation in groups) {
        const segs = groups[constellation];
        const ordered = [];
        const used = new Array(segs.length).fill(false);
  
        // Convert a segment endpoint to a 3D point using the pre-loaded radian values.
        function convert(seg, endpoint) {
          const ra = endpoint === 0 ? seg.ra1 : seg.ra2;
          const dec = endpoint === 0 ? seg.dec1 : seg.dec2;
          return radToSphere(ra, dec, R);
        }
  
        if (segs.length === 0) continue;
        let currentPoint = convert(segs[0], 0);
        ordered.push(currentPoint);
        used[0] = true;
        let currentEnd = convert(segs[0], 1);
        ordered.push(currentEnd);
        let changed = true;
        let iteration = 0;
        while (changed && iteration < segs.length) {
          changed = false;
          for (let i = 0; i < segs.length; i++) {
            if (used[i]) continue;
            const seg = segs[i];
            const p0 = convert(seg, 0);
            const p1 = convert(seg, 1);
            if (p0.distanceTo(currentEnd) < 0.01) {
              ordered.push(p1);
              currentEnd = p1;
              used[i] = true;
              changed = true;
            } else if (p1.distanceTo(currentEnd) < 0.01) {
              ordered.push(p0);
              currentEnd = p0;
              used[i] = true;
              changed = true;
            }
          }
          iteration++;
        }
        if (ordered.length < 3) continue;
        // Check if the polygon is closed
        if (ordered[0].distanceTo(ordered[ordered.length - 1]) > 0.1) {
          // Not a closed loop: skip this constellation
          continue;
        } else {
          if (ordered[0].distanceTo(ordered[ordered.length - 1]) < 0.01) {
            ordered.pop();
          }
        }
        // Map ordered 3D points to RA/DEC in degrees
        const polygon = ordered.map(p => vectorToRaDec(p, R));
        constellationPolygons[constellation] = polygon;
      }
      return constellationPolygons;
    }
    
    // Helper: Standard ray-casting point-in-polygon test (for RA/DEC space).
    function pointInPolygonRADEC(point, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].ra, yi = polygon[i].dec;
        const xj = polygon[j].ra, yj = polygon[j].dec;
        const intersect = ((yi > point.dec) !== (yj > point.dec)) &&
                          (point.ra < (xj - xi) * (point.dec - yi) / (yj - yi + 1e-9) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
    
    // Get all constellation polygons as {CONSTELLATION_NAME: [{ra, dec}, ...], ...}
    const constellationPolygons = getConstellationPolygons();
    
    // Now, for each active cell, check in which constellation polygon (if any) it falls.
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      const cellPoint = { ra: cell.ra, dec: cell.dec };
      let assigned = "UNKNOWN";
      for (const constName in constellationPolygons) {
        const polygon = constellationPolygons[constName];
        if (pointInPolygonRADEC(cellPoint, polygon)) {
          assigned = constName;
          break;
        }
      }
      cell.constellation = assigned;
      console.log(`Cell ID ${cell.id} assigned to constellation ${cell.constellation}`);
    });
  }
  // ------------------ End Constellation Attribution ------------------

  getMajorityConstellation(cells) {
    const freq = {};
    cells.forEach(cell => {
      const cst = cell.constellation && cell.constellation !== "UNKNOWN" ? cell.constellation : null;
      if (cst) {
        freq[cst] = (freq[cst] || 0) + 1;
      }
    });
    let maxCount = 0;
    let majority = "UNKNOWN";
    Object.keys(freq).forEach(key => {
      if (freq[key] > maxCount) {
        maxCount = freq[key];
        majority = key;
      }
    });
    return majority;
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
    console.log("=== DEBUG: Checking cluster distribution after assignment ===");
    regions.forEach((region, idx) => {
      console.log(`Cluster #${idx} => Type: ${region.type}, Label: ${region.label}, Constellation: ${region.constName}`);
      let cellStr = "Cells: [";
      region.cells.forEach(cell => {
        cellStr += `ID${cell.id}:${cell.constellation || "UNKNOWN"}, `;
      });
      cellStr += "]";
      console.log(cellStr);
    });
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
  
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBlueColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBlueColor(region.constName));
        });
      } else if (region.type === 'Strait') {
        let parentColor = getBlueColor(region.constName);
        region.color = lightenColor(parentColor, 0.1);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }
  
  // ------------------ Region Classification ------------------
  classifyEmptyRegions() {
    // Reset cell IDs and clear any previous cluster info.
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
      const majority = this.getMajorityConstellation(cells);
      // Use thresholds to classify clusters:
      if (cells.length < 0.1 * V_max) {
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          constName: majority,
          type: "Lake",
          label: `Lake ${majority}`,
          labelScale: 0.8,
          bestCell: computeInterconnectedCell(cells)
        });
      } else if (cells.length < 0.5 * V_max) {
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          constName: majority,
          type: "Sea",
          label: `Sea ${majority}`,
          labelScale: 0.9,
          bestCell: computeInterconnectedCell(cells)
        });
      } else {
        const segResult = segmentOceanCandidate(cells);
        if (!segResult.segmented) {
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            constName: majority,
            type: "Ocean",
            label: `Ocean ${majority}`,
            labelScale: 1.0,
            bestCell: computeInterconnectedCell(cells)
          });
        } else {
          segResult.cores.forEach((core, i) => {
            const coreMajority = this.getMajorityConstellation(core);
            regions.push({
              clusterId: idx + "_sea_" + i,
              cells: core,
              volume: core.length,
              constName: coreMajority,
              type: "Sea",
              label: `Sea ${coreMajority}`,
              labelScale: 0.9,
              bestCell: computeInterconnectedCell(core)
            });
          });
          if (segResult.neck && segResult.neck.length > 0) {
            const neckMajority = this.getMajorityConstellation(segResult.neck);
            let straitColor = lightenColor(getBlueColor(neckMajority), 0.1);
            regions.push({
              clusterId: idx + "_neck",
              cells: segResult.neck,
              volume: segResult.neck.length,
              constName: neckMajority,
              type: "Strait",
              label: `Strait ${neckMajority}`,
              labelScale: 0.7,
              bestCell: computeInterconnectedCell(segResult.neck),
              color: straitColor
            });
          }
        }
      }
    });
    this.regionClusters = regions;
    return regions;
  }
  
  // ------------------ End Region Classification ------------------
}

// Helper: Converts RA and DEC in radians into a 3D point on a sphere of radius R.
// (x and z reversed so that celestial north appears at (0,R,0))
function radToSphere(ra, dec, R) {
  const x = -R * Math.cos(dec) * Math.cos(ra);
  const y = R * Math.sin(dec);
  const z = -R * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}
