// /filters/densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial, getBaseColor, lightenColor, darkenColor, getBlueColor } from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, segmentOceanCandidate, computeCentroid, assignDistinctColorsToIndependent } from './densitySegmentation.js';

/**
 * The DensityGridOverlay class manages the 3D cells (tcMesh, globeMesh) used to visualize
 * empty space or cluster regions, including how we label them as 'Sea [constellation]' or 'Ocean [constellation]'.
 */
export class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];          // array of cell objects
    this.adjacentLines = [];      // lines connecting adjacent cells on the globe
    this.regionClusters = [];     // final array of region objects after classification
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
  }

  /**
   * Creates the grid of cells within maxDistance from center.
   */
  createGrid(stars) {
    const halfExt = Math.ceil(this.maxDistance / this.gridSize) * this.gridSize;
    this.cubesData = []; // reset

    for (let x = -halfExt; x <= halfExt; x += this.gridSize) {
      for (let y = -halfExt; y <= halfExt; y += this.gridSize) {
        for (let z = -halfExt; z <= halfExt; z += this.gridSize) {
          const posTC = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5);
          const distFromCenter = posTC.length();
          if (distFromCenter > this.maxDistance) continue;

          // 3D box for TrueCoordinates
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);

          // 2D plane for the globe
          const planeGeom = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
          const material2 = material.clone();
          const squareGlobe = new THREE.Mesh(planeGeom, material2);

          if (distFromCenter < 1e-6) {
            // near center
            squareGlobe.position.set(0, 0, 0);
          } else {
            // project onto sphere radius=100
            const ra = Math.atan2(-posTC.z, -posTC.x);
            const dec = Math.asin(posTC.y / distFromCenter);
            const radius = 100;
            const projectedPos = new THREE.Vector3(
              -radius * Math.cos(dec) * Math.cos(ra),
               radius * Math.sin(dec),
              -radius * Math.cos(dec) * Math.sin(ra)
            );
            squareGlobe.position.copy(projectedPos);
            const normal = projectedPos.clone().normalize();
            squareGlobe.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
          }

          const cell = {
            tcMesh: cubeTC,         // 3D box in TrueCoordinates
            globeMesh: squareGlobe, // plane in Globe
            tcPos: posTC,           // the raw 3D position
            distances: [],          // distances to stars
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false,
            constellation: "UNKNOWN",
            id: this.cubesData.length
          };
          this.cubesData.push(cell);
        }
      }
    }
    this.computeDistances(stars);
    this.computeAdjacentLines();
  }
  
  /**
   * For each cell, store a sorted array of distances to the stars,
   * so we can decide if the cell is "active" based on isolation or tolerance.
   */
  computeDistances(stars) {
    this.cubesData.forEach(cell => {
      const dArr = stars.map(star => {
        const starPos = star.truePosition
          ? star.truePosition
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        const dx = cell.tcPos.x - starPos.x;
        const dy = cell.tcPos.y - starPos.y;
        const dz = cell.tcPos.z - starPos.z;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
      });
      dArr.sort((a,b) => a - b);
      cell.distances = dArr;
    });
  }
  
  /**
   * Build lines between adjacent cells for the globe.
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
          // only push half of them to avoid duplicates
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
          // build a line for the globe
          const points = getGreatCirclePoints(cell.globeMesh.position, neighbor.globeMesh.position, 100, 16);

          const positions = [];
          const colors = [];
          const c1 = cell.globeMesh.material.color;
          const c2 = neighbor.globeMesh.material.color;
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            positions.push(p.x, p.y, p.z);
            const t = i / (points.length - 1);
            const r = THREE.MathUtils.lerp(c1.r, c2.r, t);
            const g = THREE.MathUtils.lerp(c1.g, c2.g, t);
            const b = THREE.MathUtils.lerp(c1.b, c2.b, t);
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
          this.adjacentLines.push({line, cell1: cell, cell2: neighbor});
        }
      });
    });
  }
  
  /**
   * For each cell, we see if it's "active" based on the user-chosen isolationVal & toleranceVal
   * from the filter UI. Then we set the cell meshes (tcMesh, globeMesh) visible or not.
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

      // color/opacity
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

    // lines
    this.adjacentLines.forEach(obj => {
      const { line, cell1, cell2 } = obj;
      if (cell1.globeMesh.visible && cell2.globeMesh.visible) {
        const points = getGreatCirclePoints(cell1.globeMesh.position, cell2.globeMesh.position, 100, 16);
        const positions = [];
        const colors = [];

        const c1 = cell1.globeMesh.material.color;
        const c2 = cell2.globeMesh.material.color;
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          positions.push(p.x, p.y, p.z);
          const t = i / (points.length - 1);
          const r = THREE.MathUtils.lerp(c1.r, c2.r, t);
          const g = THREE.MathUtils.lerp(c1.g, c2.g, t);
          const b = THREE.MathUtils.lerp(c1.b, c2.b, t);
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
   * The main function that groups active cells into clusters, determines the "majority" constellation,
   * and returns an array of region objects (like {type:"Sea", label:"Sea AND", cells:[...], ...}).
   */
  classifyEmptyRegions() {
    // Re-normalize all active cells' constellation to uppercase or "UNKNOWN"
    this.cubesData.forEach(cell => {
      if (cell.active) {
        if (cell.constellation && cell.constellation !== "UNKNOWN") {
          cell.constellation = cell.constellation.trim().toUpperCase();
        } else {
          cell.constellation = "UNKNOWN";
        }
      }
    });

    // We build a BFS/DFS to group them
    const gridMap = new Map();
    this.cubesData.forEach(cell => {
      cell.clusterId = null;
      if (cell.active) {
        const key = `${cell.grid.ix},${cell.grid.iy},${cell.grid.iz}`;
        gridMap.set(key, cell.id);
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
                const neighborCellID = gridMap.get(neighborKey);
                const neighborCell = this.cubesData[neighborCellID];
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

    // find the largest cluster size
    let V_max = 0;
    clusters.forEach(c => { if (c.length > V_max) V_max = c.length; });

    const regions = [];
    clusters.forEach((cells, idx) => {
      // build freq map for constellation
      const freq = {};
      cells.forEach(cell => {
        if (cell.constellation !== "UNKNOWN") {
          freq[cell.constellation] = (freq[cell.constellation] || 0) + 1;
        }
      });
      let majority = "UNKNOWN";
      let maxCount = 0;
      for (const nm in freq) {
        if (freq[nm] > maxCount) {
          maxCount = freq[nm];
          majority = nm;
        }
      }

      // pick region type
      const size = cells.length;
      let regionType = "Ocean";
      let labelScale = 1.0;
      if (size < 0.1 * V_max) {
        regionType = "Lake";
        labelScale = 0.8;
      } else if (size < 0.5 * V_max) {
        regionType = "Sea";
        labelScale = 0.9;
      }

      // check for segmentation
      const segResult = segmentOceanCandidate(cells);
      if (regionType === "Ocean" && segResult.segmented) {
        // segmented into sub-seas + neck
        segResult.cores.forEach((core, i) => {
          regions.push({
            clusterId: idx + `_sea_${i}`,
            cells: core,
            volume: core.length,
            constName: majority,
            type: "Sea",
            label: `Sea ${majority}`,
            labelScale: 0.9,
            bestCell: computeInterconnectedCell(core)
          });
        });
        if (segResult.neck && segResult.neck.length > 0) {
          regions.push({
            clusterId: idx + "_neck",
            cells: segResult.neck,
            volume: segResult.neck.length,
            constName: majority,
            type: "Strait",
            label: `Strait ${majority}`,
            labelScale: 0.7,
            bestCell: computeInterconnectedCell(segResult.neck),
            color: lightenColor(getBlueColor(majority), 0.1)
          });
        }
      } else {
        // normal single region
        regions.push({
          clusterId: idx,
          cells,
          volume: size,
          constName: majority,
          type: regionType,
          label: `${regionType} ${majority}`,
          labelScale,
          bestCell: computeInterconnectedCell(cells)
        });
      }
    });

    this.regionClusters = regions;
    return regions;
  }

  /**
   * Creates the region labels in 3D (TrueCoordinates or Globe).
   */
  addRegionLabelsToScene(scene, mapType) {
    // remove old
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) {
        scene.remove(this.regionLabelsGroupTC);
      }
      this.regionLabelsGroupTC = new THREE.Group();
    } else {
      if (this.regionLabelsGroupGlobe.parent) {
        scene.remove(this.regionLabelsGroupGlobe);
      }
      this.regionLabelsGroupGlobe = new THREE.Group();
    }

    // re-run classification
    this.updateRegionColors();  // <-- calls classifyEmptyRegions internally
    const regions = this.classifyEmptyRegions();

    // create a label for each region
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
      } else {
        this.regionLabelsGroupGlobe.add(labelSprite);
      }
    });

    // add the label group to the scene
    if (mapType === 'TrueCoordinates') {
      scene.add(this.regionLabelsGroupTC);
    } else {
      scene.add(this.regionLabelsGroupGlobe);
    }
  }

  /**
   * Re-classifies and then assigns distinct colors to any "Ocean"/"Sea"/"Lake" regions.
   */
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    const wateryRegions = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    assignDistinctColorsToIndependent(wateryRegions);

    // apply colors to the cells
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBlueColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBlueColor(region.constName));
        });
      } else if (region.type === 'Strait') {
        // lighten the parent's color
        let parentColor = getBlueColor(region.constName);
        region.color = lightenColor(parentColor, 0.1);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }

  /**
   * Called after we fetch constellation_boundaries.json. We loop over each active cell
   * and try to find its best matching constellation. Then store it as "constellation" (uppercase).
   */
  assignConstellationsToCells(constellationData) {
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      const projected = cell.tcPos.clone().normalize().multiplyScalar(100);
      const cellRaDec = vectorToRaDec(projected);
      let foundConstellation = null;
      for (const constellationObj of constellationData) {
        const polygon = constellationObj.raDecPolygon;
        if (pointInPolygon(cellRaDec, polygon)) {
          foundConstellation = constellationObj.constellation;
          break;
        }
      }
      cell.constellation = foundConstellation
        ? foundConstellation.trim().toUpperCase()
        : "UNKNOWN";
      console.log(`Cell ID ${cell.id} => assigned constellation ${cell.constellation}`);
    });
  }
}

// -------------------------------------
// Helper functions:

function vectorToRaDec(vector) {
  // Takes a point on the sphere radius=100, returns {ra, dec}
  const dec = Math.asin(vector.y / 100);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

function pointInPolygon(point, vs) {
  // Basic 2D ray-casting in RA/DEC
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].ra, yi = vs[i].dec;
    const xj = vs[j].ra, yj = vs[j].dec;
    const intersect = ((yi > point.dec) !== (yj > point.dec)) &&
      (point.ra < (xj - xi) * (point.dec - yi) / ((yj - yi) || 1e-10) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
