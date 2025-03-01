// /filters/densityGridOverlay.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import {
  getDoubleSidedLabelMaterial,
  getBaseColor,
  lightenColor,
  darkenColor,
  getBlueColor
} from './densityColorUtils.js';
import {
  getGreatCirclePoints,
  computeInterconnectedCell,
  segmentOceanCandidate,
  computeCentroid,
  assignDistinctColorsToIndependent
} from './densitySegmentation.js';

/**
 * Class for managing a 3D grid overlay that determines "Sea [constellation]",
 * "Ocean [constellation]", etc. Now updated so that each sub-sea re-checks
 * its own local majority if we do segmentation.
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

          // Globe plane
          const planeGeom = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
          const material2 = material.clone();
          const squareGlobe = new THREE.Mesh(planeGeom, material2);

          if (distFromCenter < 1e-6) {
            squareGlobe.position.set(0,0,0);
          } else {
            const ra = Math.atan2(-posTC.z, -posTC.x);
            const dec = Math.asin(posTC.y / distFromCenter);
            const R = 100;
            const projectedPos = new THREE.Vector3(
              -R * Math.cos(dec) * Math.cos(ra),
               R * Math.sin(dec),
              -R * Math.cos(dec) * Math.sin(ra)
            );
            squareGlobe.position.copy(projectedPos);
            const normal = projectedPos.clone().normalize();
            squareGlobe.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
          }

          const cell = {
            tcMesh: cubeTC,
            globeMesh: squareGlobe,
            tcPos: posTC,
            distances: [],
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

  // Main BFS/DFS classification
  classifyEmptyRegions() {
    // normalize each active cell
    this.cubesData.forEach(cell => {
      if (cell.active) {
        if (cell.constellation && cell.constellation !== "UNKNOWN") {
          cell.constellation = cell.constellation.trim().toUpperCase();
        } else {
          cell.constellation = "UNKNOWN";
        }
      }
    });

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
                const neighborId = gridMap.get(neighborKey);
                const neighborCell = this.cubesData[neighborId];
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
    clusters.forEach(c => {
      if (c.length > V_max) V_max = c.length;
    });

    const regions = [];
    clusters.forEach((cells, idx) => {
      // build freq map for the entire cluster
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

      // check segmentation
      const segResult = segmentOceanCandidate(cells);
      if (regionType === "Ocean" && segResult.segmented) {
        // Instead of reusing the entire cluster's majority for sub-seas,
        // re-check local freq for each subregion “core”:
        segResult.cores.forEach((core, i) => {
          const localFreq = {};
          core.forEach(c => {
            if (c.constellation !== "UNKNOWN") {
              localFreq[c.constellation] = (localFreq[c.constellation] || 0) + 1;
            }
          });
          let localMajority = "UNKNOWN";
          let localMax = 0;
          for (const nm in localFreq) {
            if (localFreq[nm] > localMax) {
              localMax = localFreq[nm];
              localMajority = nm;
            }
          }
          regions.push({
            clusterId: idx + `_sea_${i}`,
            cells: core,
            volume: core.length,
            constName: localMajority,
            type: "Sea",
            label: `Sea ${localMajority}`,
            labelScale: 0.9,
            bestCell: computeInterconnectedCell(core)
          });
        });
        // for the “neck” subregion (if it exists), recalc freq
        if (segResult.neck && segResult.neck.length > 0) {
          const localFreq = {};
          segResult.neck.forEach(c => {
            if (c.constellation !== "UNKNOWN") {
              localFreq[c.constellation] = (localFreq[c.constellation] || 0) + 1;
            }
          });
          let localMajority = "UNKNOWN";
          let localMax = 0;
          for (const nm in localFreq) {
            if (localFreq[nm] > localMax) {
              localMax = localFreq[nm];
              localMajority = nm;
            }
          }
          regions.push({
            clusterId: idx + "_neck",
            cells: segResult.neck,
            volume: segResult.neck.length,
            constName: localMajority,
            type: "Strait",
            label: `Strait ${localMajority}`,
            labelScale: 0.7,
            bestCell: computeInterconnectedCell(segResult.neck),
            color: lightenColor(getBlueColor(localMajority), 0.1)
          });
        }
      } else {
        // normal single region, or a big cluster that is “Sea” or “Lake”
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
   * Called to actually create label sprites or planes for the region.
   */
  addRegionLabelsToScene(scene, mapType) {
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

    this.updateRegionColors();
    const regions = this.classifyEmptyRegions();
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

    if (mapType === 'TrueCoordinates') {
      scene.add(this.regionLabelsGroupTC);
    } else {
      scene.add(this.regionLabelsGroupGlobe);
    }
  }

  /**
   * Re-classify, then color watery regions with distinct palette.
   */
  updateRegionColors() {
    const regions = this.classifyEmptyRegions();
    const watery = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    assignDistinctColorsToIndependent(watery);

    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBlueColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBlueColor(region.constName));
        });
      } else if (region.type === 'Strait') {
        const pColor = getBlueColor(region.constName);
        region.color = lightenColor(pColor, 0.1);
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
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

      // orient to sphere
      const normal = position.clone().normalize();
      const globalUp = new THREE.Vector3(0,1,0);
      let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
      if (desiredUp.lengthSq() < 1e-6) {
        desiredUp = new THREE.Vector3(0,0,1);
      } else {
        desiredUp.normalize();
      }
      const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
      const matrix = new THREE.Matrix4().makeBasis(desiredRight, desiredUp, normal);
      labelObj.setRotationFromMatrix(matrix);

    } else {
      // TrueCoordinates => sprite
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        depthWrite: true,
        depthTest: true,
        transparent: true
      });
      labelObj = new THREE.Sprite(spriteMaterial);
      const scaleFactor = 0.22;
      labelObj.scale.set((canvas.width/100)*scaleFactor, (canvas.height/100)*scaleFactor, 1);
    }

    labelObj.position.copy(position);
    return labelObj;
  }

  /**
   * Convert from TrueCoordinates position to sphere radius=100
   */
  projectToGlobe(position) {
    const dist = position.length();
    if (dist < 1e-6) {
      return new THREE.Vector3(0,0,0);
    }
    const ra = Math.atan2(-position.z, -position.x);
    const dec = Math.asin(position.y / dist);
    const R = 100;
    return new THREE.Vector3(
      -R * Math.cos(dec) * Math.cos(ra),
       R * Math.sin(dec),
      -R * Math.cos(dec) * Math.sin(ra)
    );
  }

  /**
   * Assign each active cell's “constellation” property by checking RA/DEC polygons
   */
  assignConstellationsToCells(constellationData) {
    this.cubesData.forEach(cell => {
      if (!cell.active) return;
      const R = 100;
      const projected = cell.tcPos.clone().normalize().multiplyScalar(R);
      const cellRaDec = vectorToRaDec(projected);
      let foundConstellation = null;
      for (const cObj of constellationData) {
        if (pointInPolygon(cellRaDec, cObj.raDecPolygon)) {
          foundConstellation = cObj.constellation;
          break;
        }
      }
      cell.constellation = foundConstellation
        ? foundConstellation.trim().toUpperCase()
        : "UNKNOWN";
      console.log(`Cell ID ${cell.id} => assigned constellation [${cell.constellation}]`);
    });
  }
}

// Helpers
function vectorToRaDec(vector) {
  const R = 100;
  const dec = Math.asin(vector.y / R);
  let ra = Math.atan2(-vector.z, -vector.x);
  let raDeg = ra * 180 / Math.PI;
  if (raDeg < 0) raDeg += 360;
  return { ra: raDeg, dec: dec * 180 / Math.PI };
}

function pointInPolygon(point, vs) {
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
