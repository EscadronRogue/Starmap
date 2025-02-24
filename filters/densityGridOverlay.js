// filters/densityGridOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial, getBaseColor, lightenColor, darkenColor } from './densityColorUtils.js';
import { getGreatCirclePoints, computeInterconnectedCell, getConstellationForCell, segmentOceanCandidate, computeCentroid, assignDistinctColorsToIndependent } from './densitySegmentation.js';

/**
 * This updated overlay no longer shows discrete squares and their connecting lines.
 * Instead, it uses the grid data to build a continuous density field (via a simple
 * nearest–neighbor interpolation on a regular (lat,lon) grid on the sphere) and then
 * applies a marching squares algorithm to extract contour lines at the threshold value.
 * Finally, each closed contour is projected into a local tangent plane and converted into
 * a THREE.Shape whose geometry is used to create a filled, semi–transparent zone overlay.
 */
export class DensityGridOverlay {
  constructor(maxDistance, gridSize = 2) {
    this.maxDistance = maxDistance;
    this.gridSize = gridSize;
    this.cubesData = [];
    // (We no longer use adjacentLines for visualization.)
    this.regionClusters = []; // Final regions after segmentation/classification
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
    // New group to hold the contour zone meshes
    this.contourGroup = new THREE.Group();
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
          
          // (For density calculations we keep the TrueCoordinates mesh but we will not display it.)
          const geometry = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
          const material = new THREE.MeshBasicMaterial({
            color: 0x0000ff,
            transparent: true,
            opacity: 1.0,
            depthWrite: false
          });
          const cubeTC = new THREE.Mesh(geometry, material);
          cubeTC.position.copy(posTC);
          
          // Create a square that will be projected onto the globe.
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
          
          // For later interpolation we store the globe position along with computed spherical coordinates.
          const cell = {
            tcMesh: cubeTC,
            globeMesh: squareGlobe,
            tcPos: posTC,
            distances: [], // will be computed below
            grid: {
              ix: Math.round(x / this.gridSize),
              iy: Math.round(y / this.gridSize),
              iz: Math.round(z / this.gridSize)
            },
            active: false,
            density: 0 // will store the isoDist value here
          };

          // Precompute spherical coordinates from the globeMesh.position.
          // Using our projection: x = -R*cos(dec)*cos(ra), y = R*sin(dec), z = -R*cos(dec)*sin(ra)
          const R = 100;
          const pos = squareGlobe.position;
          cell.lat = Math.asin(pos.y / R); // dec in radians
          // Recover ra from x and z (note the negatives in the projection)
          cell.lon = Math.atan2(-pos.z, -pos.x);
          
          this.cubesData.push(cell);
        }
      }
    }
    this.computeDistances(stars);
    // We no longer compute adjacent lines.
  }

  computeDistances(stars) {
    // For each grid cell, compute distances from the cell center (tcPos) to each star (using truePosition)
    this.cubesData.forEach(cell => {
      const dArr = stars.map(star => {
        let starPos = star.truePosition ? star.truePosition : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
        const dx = cell.tcPos.x - starPos.x;
        const dy = cell.tcPos.y - starPos.y;
        const dz = cell.tcPos.z - starPos.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      });
      dArr.sort((a, b) => a - b);
      // Use the tolerance–th nearest distance as a measure of isolation (i.e. low density)
      // (This is the same as in your original update method.)
      cell.density = (dArr.length > 0) ? dArr[0] : 0;
    });
  }

  /**
   * New update method: Instead of adjusting individual square visibility and scale,
   * we simply update the contour zones overlay.
   * The density threshold is taken from the density slider.
   */
  update(stars, scene) {
    // Recompute densities
    this.computeDistances(stars);
    // Remove any old contour zones.
    if (this.contourGroup.parent) {
      this.contourGroup.parent.remove(this.contourGroup);
    }
    this.contourGroup = new THREE.Group();
    // Generate contour zones from the continuous density field.
    this.updateContourZones();
    scene.add(this.contourGroup);
  }

  /**
   * updateContourZones:
   *   – Interpolates a continuous density field from the grid (using nearest–neighbor over (lat,lon)).
   *   – Runs a marching squares algorithm to extract contour segments at the threshold.
   *   – Assembles segments into closed loops.
   *   – For each closed loop, builds a filled overlay (via a local tangent plane projection) and adds it to this.contourGroup.
   */
  updateContourZones() {
    // Define parameters for the regular (lat,lon) grid.
    const R = 100;
    const latMin = -Math.PI / 2;
    const latMax = Math.PI / 2;
    const lonMin = -Math.PI;
    const lonMax = Math.PI;
    const latStep = 4 * Math.PI / 180; // 4° steps
    const lonStep = 4 * Math.PI / 180;
    const nLat = Math.round((latMax - latMin) / latStep) + 1;
    const nLon = Math.round((lonMax - lonMin) / lonStep) + 1;
    
    // Build the density field as a 2D array.
    // For each grid point, use nearest–neighbor interpolation from cubesData.
    const densityField = [];
    for (let i = 0; i < nLat; i++) {
      densityField[i] = [];
      const lat = latMin + i * latStep;
      for (let j = 0; j < nLon; j++) {
        const lon = lonMin + j * lonStep;
        // Find nearest cube cell (in spherical space)
        let bestDist = Infinity;
        let bestDensity = 0;
        // Represent the grid point as a unit vector on the sphere.
        const gp = new THREE.Vector3(
          -R * Math.cos(lat) * Math.cos(lon),
           R * Math.sin(lat),
          -R * Math.cos(lat) * Math.sin(lon)
        ).normalize();
        this.cubesData.forEach(cell => {
          // Represent cell position as a unit vector.
          const cp = new THREE.Vector3().copy(cell.globeMesh.position).normalize();
          const d = gp.angleTo(cp); // angular distance in radians
          if (d < bestDist) {
            bestDist = d;
            bestDensity = cell.density;
          }
        });
        densityField[i][j] = bestDensity;
      }
    }
    
    // Get the threshold value from the density slider (assumed to be in LY).
    const densitySlider = document.getElementById('density-slider');
    const threshold = parseFloat(densitySlider.value) || 1;
    
    // Run marching squares on the densityField.
    const segments = this.marchingSquares(densityField, threshold, latMin, latMax, lonMin, lonMax);
    // Assemble segments into closed loops.
    const contours = this.assembleContours(segments);
    
    // For each contour polygon (in lat,lon), create a filled mesh.
    contours.forEach(polygon => {
      const mesh = this.createContourMesh(polygon, R);
      if (mesh) this.contourGroup.add(mesh);
    });
  }

  /**
   * marchingSquares:
   *   Runs a basic marching squares algorithm on the 2D densityField.
   *   Returns an array of line segments (each segment: {p1: {lon, lat}, p2: {lon, lat}})
   */
  marchingSquares(field, threshold, latMin, latMax, lonMin, lonMax) {
    const segments = [];
    const nLat = field.length;
    const nLon = field[0].length;
    const latStep = (latMax - latMin) / (nLat - 1);
    const lonStep = (lonMax - lonMin) / (nLon - 1);
    
    // For each cell (a square of 4 grid points)
    for (let i = 0; i < nLat - 1; i++) {
      for (let j = 0; j < nLon - 1; j++) {
        // Corners:
        const tl = field[i][j] >= threshold ? 1 : 0;
        const tr = field[i][j+1] >= threshold ? 1 : 0;
        const br = field[i+1][j+1] >= threshold ? 1 : 0;
        const bl = field[i+1][j] >= threshold ? 1 : 0;
        const index = (tl << 3) | (tr << 2) | (br << 1) | bl;
        if (index === 0 || index === 15) continue;
        
        // Compute (lon,lat) coordinates for the corners.
        const x = lonMin + j * lonStep;
        const y = latMin + i * latStep;
        const topLeft = { lon: x, lat: y };
        const topRight = { lon: x + lonStep, lat: y };
        const bottomRight = { lon: x + lonStep, lat: y + latStep };
        const bottomLeft = { lon: x, lat: y + latStep };
        
        // Helper: linear interpolate along an edge.
        const lerp = (p1, p2, v1, v2) => {
          const t = (threshold - v1) / (v2 - v1);
          return {
            lon: p1.lon + t * (p2.lon - p1.lon),
            lat: p1.lat + t * (p2.lat - p1.lat)
          };
        };
        
        // Get the field values at corners.
        const fTL = field[i][j];
        const fTR = field[i][j+1];
        const fBR = field[i+1][j+1];
        const fBL = field[i+1][j];
        
        // Lookup: there are 16 cases. For simplicity we hardcode the ones where edges cross.
        // (This table is not complete for ambiguous cases, but suffices for demonstration.)
        switch(index) {
          case 1: // 0001
            segments.push({ p1: lerp(bottomLeft, topLeft, fBL, fTL), p2: lerp(bottomLeft, bottomRight, fBL, fBR) });
            break;
          case 2: // 0010
            segments.push({ p1: lerp(bottomRight, topRight, fBR, fTR), p2: lerp(bottomRight, bottomLeft, fBR, fBL) });
            break;
          case 3: // 0011
            segments.push({ p1: lerp(bottomRight, topRight, fBR, fTR), p2: lerp(bottomLeft, topLeft, fBL, fTL) });
            break;
          case 4: // 0100
            segments.push({ p1: lerp(topRight, topLeft, fTR, fTL), p2: lerp(topRight, bottomRight, fTR, fBR) });
            break;
          case 5: // 0101 (ambiguous)
            segments.push({ p1: lerp(topRight, topLeft, fTR, fTL), p2: lerp(bottomLeft, bottomRight, fBL, fBR) });
            segments.push({ p1: lerp(bottomLeft, topLeft, fBL, fTL), p2: lerp(topRight, bottomRight, fTR, fBR) });
            break;
          case 6: // 0110
            segments.push({ p1: lerp(topRight, topLeft, fTR, fTL), p2: lerp(bottomRight, bottomLeft, fBR, fBL) });
            break;
          case 7: // 0111
            segments.push({ p1: lerp(bottomLeft, topLeft, fBL, fTL), p2: lerp(topRight, bottomRight, fTR, fBR) });
            break;
          case 8: // 1000
            segments.push({ p1: lerp(topLeft, topRight, fTL, fTR), p2: lerp(topLeft, bottomLeft, fTL, fBL) });
            break;
          case 9: // 1001
            segments.push({ p1: lerp(topLeft, topRight, fTL, fTR), p2: lerp(bottomLeft, bottomRight, fBL, fBR) });
            break;
          case 10: // 1010
            segments.push({ p1: lerp(topLeft, bottomLeft, fTL, fBL), p2: lerp(bottomRight, topRight, fBR, fTR) });
            break;
          case 11: // 1011
            segments.push({ p1: lerp(topLeft, bottomLeft, fTL, fBL), p2: lerp(bottomRight, bottomLeft, fBR, fBL) });
            break;
          case 12: // 1100
            segments.push({ p1: lerp(topLeft, bottomLeft, fTL, fBL), p2: lerp(topRight, bottomRight, fTR, fBR) });
            break;
          case 13: // 1101
            segments.push({ p1: lerp(topRight, bottomRight, fTR, fBR), p2: lerp(topLeft, topRight, fTL, fTR) });
            break;
          case 14: // 1110
            segments.push({ p1: lerp(bottomRight, bottomLeft, fBR, fBL), p2: lerp(topLeft, topRight, fTL, fTR) });
            break;
        }
      }
    }
    return segments;
  }

  /**
   * Assemble the individual segments into closed loops.
   * This simple algorithm groups segments by matching endpoints (rounded to 4 decimals).
   * Returns an array of polygons, each polygon is an array of {lon, lat} points.
   */
  assembleContours(segments) {
    const roundPt = pt => ({ lon: Number(pt.lon.toFixed(4)), lat: Number(pt.lat.toFixed(4)) });
    // Build a map from endpoint string to segments starting/ending there.
    const endpointMap = new Map();
    segments.forEach(seg => {
      const p1 = roundPt(seg.p1);
      const p2 = roundPt(seg.p2);
      const key1 = `${p1.lon},${p1.lat}`;
      const key2 = `${p2.lon},${p2.lat}`;
      if (!endpointMap.has(key1)) endpointMap.set(key1, []);
      if (!endpointMap.has(key2)) endpointMap.set(key2, []);
      endpointMap.get(key1).push({ seg, pt: p1, other: p2 });
      endpointMap.get(key2).push({ seg, pt: p2, other: p1 });
    });
    const used = new Set();
    const contours = [];
    segments.forEach(seg => {
      const segKey = JSON.stringify([roundPt(seg.p1), roundPt(seg.p2)]);
      if (used.has(segKey)) return;
      let contour = [];
      // Start from seg.p1 and follow chain.
      let current = roundPt(seg.p1);
      contour.push(current);
      let next = roundPt(seg.p2);
      used.add(segKey);
      while (true) {
        contour.push(next);
        const key = `${next.lon},${next.lat}`;
        const connections = endpointMap.get(key);
        let found = null;
        for (let conn of connections) {
          const candidateKey = JSON.stringify([conn.pt, conn.other]);
          if (used.has(candidateKey)) continue;
          found = conn.other;
          used.add(candidateKey);
          break;
        }
        if (!found) break;
        if (Math.abs(found.lon - contour[0].lon) < 1e-3 && Math.abs(found.lat - contour[0].lat) < 1e-3) {
          // Closed loop
          break;
        }
        next = found;
      }
      if (contour.length > 2) contours.push(contour);
    });
    return contours;
  }

  /**
   * Convert (lat, lon) to 3D position on a sphere of radius R using our projection.
   */
  latLonTo3D(lat, lon, R) {
    return new THREE.Vector3(
      -R * Math.cos(lat) * Math.cos(lon),
       R * Math.sin(lat),
      -R * Math.cos(lat) * Math.sin(lon)
    );
  }

  /**
   * Given a polygon (an array of {lon, lat} in radians), create a filled mesh.
   * We project the polygon into a local tangent plane (using the polygon centroid as origin),
   * build a 2D THREE.Shape, triangulate it, and then lift it back to 3D.
   */
  createContourMesh(polygon, R) {
    if (polygon.length < 3) return null;
    // Compute centroid in (lon,lat)
    let sumLon = 0, sumLat = 0;
    polygon.forEach(p => { sumLon += p.lon; sumLat += p.lat; });
    const cenLon = sumLon / polygon.length;
    const cenLat = sumLat / polygon.length;
    const center3D = this.latLonTo3D(cenLat, cenLon, R);
    // Build a local tangent plane basis at the centroid.
    const normal = center3D.clone().normalize();
    // Choose an arbitrary vector not parallel to normal.
    let tangent = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(tangent)) > 0.9) tangent = new THREE.Vector3(1, 0, 0);
    tangent = tangent.sub(normal.clone().multiplyScalar(normal.dot(tangent))).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    // Project each (lon,lat) point to 2D using:
    // p2D = [ (x - center3D) dot tangent, (x - center3D) dot bitangent ]
    const points2D = polygon.map(p => {
      const pt3D = this.latLonTo3D(p.lat, p.lon, R);
      const vec = pt3D.clone().sub(center3D);
      return new THREE.Vector2(vec.dot(tangent), vec.dot(bitangent));
    });
    // Build a THREE.Shape from points2D.
    const shape = new THREE.Shape(points2D);
    // Create geometry from the shape.
    const geometry = new THREE.ShapeGeometry(shape);
    // Now lift the 2D vertices back to 3D:
    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
      const vx = vertices[i];
      const vy = vertices[i+1];
      // Reconstruct 3D point: center3D + vx*tangent + vy*bitangent.
      const pos3D = center3D.clone().add(tangent.clone().multiplyScalar(vx)).add(bitangent.clone().multiplyScalar(vy));
      vertices[i] = pos3D.x;
      vertices[i+1] = pos3D.y;
      vertices[i+2] = pos3D.z;
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.3, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }

  // The methods for classifying regions and adding region labels remain unchanged.
  classifyEmptyRegions() {
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
      const bestCell = computeInterconnectedCell(cells);
      const regionConst = getConstellationForCell(bestCell);
      
      if (cells.length < 0.1 * V_max) {
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          constName: regionConst,
          type: "Lake",
          label: `Lake ${regionConst}`,
          labelScale: 0.8,
          bestCell
        });
      } else if (cells.length < 0.5 * V_max) {
        regions.push({
          clusterId: idx,
          cells,
          volume: cells.length,
          constName: regionConst,
          type: "Sea",
          label: `Sea ${regionConst}`,
          labelScale: 0.9,
          bestCell
        });
      } else {
        const segResult = segmentOceanCandidate(cells);
        if (!segResult.segmented) {
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            constName: regionConst,
            type: "Ocean",
            label: `Ocean ${regionConst}`,
            labelScale: 1.0,
            bestCell
          });
        } else {
          regions.push({
            clusterId: idx,
            cells,
            volume: cells.length,
            constName: regionConst,
            type: "Ocean",
            label: `Ocean ${regionConst}`,
            labelScale: 1.0,
            bestCell
          });
          segResult.cores.forEach((core, i) => {
            const gulfBest = computeInterconnectedCell(core);
            const gulfConst = getConstellationForCell(gulfBest);
            let gulfColor = darkenColor(getBaseColor(regionConst), 0.05);
            regions.push({
              clusterId: idx + "_gulf_" + i,
              cells: core,
              volume: core.length,
              constName: gulfConst,
              type: "Gulf",
              label: `Gulf ${gulfConst}`,
              labelScale: 0.85,
              bestCell: gulfBest,
              color: gulfColor
            });
          });
          if (segResult.neck && segResult.neck.length > 0) {
            const neckBest = computeInterconnectedCell(segResult.neck);
            const neckConst = getConstellationForCell(neckBest);
            let straitColor = lightenColor(getBaseColor(regionConst), 0.1);
            regions.push({
              clusterId: idx + "_neck",
              cells: segResult.neck,
              volume: segResult.neck.length,
              constName: neckConst,
              type: "Strait",
              label: `Strait ${neckConst}`,
              labelScale: 0.7,
              bestCell: neckBest,
              color: straitColor
            });
          }
        }
      }
    });
    
    this.regionClusters = regions;
    return regions;
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
        labelPos = computeCentroid(region.cells);
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
    const independentRegions = regions.filter(r => r.type === 'Ocean' || r.type === 'Sea' || r.type === 'Lake');
    assignDistinctColorsToIndependent(independentRegions);
    regions.forEach(region => {
      if (region.type === 'Ocean' || region.type === 'Sea' || region.type === 'Lake') {
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color || getBaseColor(region.constName));
          cell.globeMesh.material.color.set(region.color || getBaseColor(region.constName));
        });
      } else if (region.type === 'Gulf' || region.type === 'Strait') {
        let parentColor = getBaseColor(region.constName);
        if (region.type === 'Strait') {
          region.color = lightenColor(parentColor, 0.1);
        } else if (region.type === 'Gulf') {
          region.color = darkenColor(parentColor, 0.05);
        }
        region.cells.forEach(cell => {
          cell.tcMesh.material.color.set(region.color);
          cell.globeMesh.material.color.set(region.color);
        });
      }
    });
  }
}
