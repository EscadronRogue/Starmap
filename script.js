// script.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { applyFilters, setupFilterUI } from './filters/index.js';
import { createConnectionLines, mergeConnectionLines } from './filters/connectionsFilter.js';
import { createConstellationBoundariesForGlobe, createConstellationLabelsForGlobe } from './filters/constellationFilter.js';
import { initDensityOverlay, updateDensityMapping } from './filters/densityFilter.js';
import { applyGlobeSurfaceFilter } from './filters/globeSurfaceFilter.js';
import { ThreeDControls } from './cameraControls.js';
import { LabelManager } from './labelManager.js';
import { showTooltip, hideTooltip } from './tooltips.js';
import { cachedRadToSphere, degToRad } from './utils/geometryUtils.js';

let cachedStars = null;
let currentFilteredStars = [];
let currentConnections = [];
let currentGlobeFilteredStars = [];
let currentGlobeConnections = [];
let selectedStarData = null;
let selectedHighlightTrue = null;
let selectedHighlightGlobe = null;
let trueCoordinatesMap;
let globeMap;
let constellationLinesGlobe = [];
let constellationLabelsGlobe = [];
let constellationOverlayGlobe = [];
let globeSurfaceSphere = null;
let lowDensityOverlay = null;
let highDensityOverlay = null;

function getStarTruePosition(star) {
  const R = star.distance !== undefined ? star.distance : star.Distance_from_the_Sun;
  let ra, dec;
  if (star.RA_in_radian !== undefined && star.DEC_in_radian !== undefined) {
    ra = star.RA_in_radian;
    dec = star.DEC_in_radian;
  } else if (star.RA_in_degrees !== undefined && star.DEC_in_degrees !== undefined) {
    ra = degToRad(star.RA_in_degrees);
    dec = degToRad(star.DEC_in_degrees);
  } else {
    ra = 0;
    dec = 0;
  }
  return cachedRadToSphere(ra, dec, R);
}

function projectStarGlobe(star) {
  const R = 100;
  let ra, dec;
  if (star.RA_in_radian !== undefined && star.DEC_in_radian !== undefined) {
    ra = star.RA_in_radian;
    dec = star.DEC_in_radian;
  } else if (star.RA_in_degrees !== undefined && star.DEC_in_degrees !== undefined) {
    ra = degToRad(star.RA_in_degrees);
    dec = degToRad(star.DEC_in_degrees);
  } else {
    ra = 0;
    dec = 0;
  }
  return cachedRadToSphere(ra, dec, R);
}

function createGlobeGrid(R = 100, options = {}) {
  const gridGroup = new THREE.Group();
  const gridColor = options.color || 0x444444;
  const lineOpacity = options.opacity !== undefined ? options.opacity : 0.2;
  const lineWidth = options.lineWidth || 1;
  const material = new THREE.LineBasicMaterial({
    color: gridColor,
    transparent: true,
    opacity: lineOpacity,
    linewidth: lineWidth
  });
  for (let raDeg = 0; raDeg < 360; raDeg += 30) {
    const ra = THREE.Math.degToRad(raDeg);
    const points = [];
    for (let decDeg = -80; decDeg <= 80; decDeg += 2) {
      const dec = THREE.Math.degToRad(decDeg);
      points.push(cachedRadToSphere(ra, dec, R));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }
  for (let decDeg = -60; decDeg <= 60; decDeg += 30) {
    const dec = THREE.Math.degToRad(decDeg);
    const points = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const ra = (i / segments) * 2 * Math.PI;
      points.push(cachedRadToSphere(ra, dec, R));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }
  return gridGroup;
}

async function loadStarData() {
  const manifestUrl = 'data/manifest.json';
  try {
    const manifestResp = await fetch(manifestUrl);
    if (!manifestResp.ok) {
      console.warn(`Manifest file not found: ${manifestUrl}`);
      return [];
    }
    const fileNames = await manifestResp.json();
    const dataPromises = fileNames.map(name =>
      fetch(`data/${name}`).then(resp => {
        if (!resp.ok) {
          console.warn(`File not found: data/${name}`);
          return [];
        }
        return resp.json();
      })
    );
    const filesData = await Promise.all(dataPromises);
    const combinedData = filesData.flat();
    return combinedData;
  } catch (e) {
    console.warn("Error loading star data:", e);
    return [];
  }
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

async function buildAndApplyFilters() {
  if (!cachedStars) return;
  const filters = applyFilters(cachedStars);
  const {
    filteredStars,
    connections,
    globeFilteredStars,
    globeConnections,
    showConstellationBoundaries,
    showConstellationNames,
    showConstellationOverlay,
    globeOpaqueSurface,
    enableConnections,
    lowDensityMapping,
    highDensityMapping,
    lowDensity,
    lowTolerance,
    highDensity: highIsolation,
    highTolerance,
    lowDensityLabeling,
    highDensityLabeling,
    minDistance,
    maxDistance
  } = filters;

  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;

  currentGlobeFilteredStars.forEach(star => {
    star.spherePosition = projectStarGlobe(star);
  });
  currentFilteredStars.forEach(star => {
    star.truePosition = getStarTruePosition(star);
  });

  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  trueCoordinatesMap.labelManager.refreshLabels(currentFilteredStars);
  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  globeMap.labelManager.refreshLabels(currentGlobeFilteredStars);

  removeConstellationObjectsFromGlobe();
  removeConstellationOverlayObjectsFromGlobe();

  if (showConstellationBoundaries) {
    constellationLinesGlobe = createConstellationBoundariesForGlobe();
    constellationLinesGlobe.forEach(ln => globeMap.scene.add(ln));
  }
  if (showConstellationNames) {
    constellationLabelsGlobe = createConstellationLabelsForGlobe();
    constellationLabelsGlobe.forEach(lbl => globeMap.scene.add(lbl));
  }
  if (showConstellationOverlay) {
    // Overlay logic here if needed.
  }

  if (lowDensityMapping) {
    const form = document.getElementById('filters-form');
    const lowGridSliderValue = parseFloat(new FormData(form).get('low-density-grid-size') || '2');
    const lowGridSize = 4 / lowGridSliderValue;
    if (
      !lowDensityOverlay ||
      lowDensityOverlay.minDistance !== parseFloat(minDistance) ||
      lowDensityOverlay.maxDistance !== parseFloat(maxDistance) ||
      lowDensityOverlay.gridSize !== lowGridSize
    ) {
      if (lowDensityOverlay) {
        lowDensityOverlay.cubesData.forEach(c => {
          trueCoordinatesMap.scene.remove(c.tcMesh);
        });
        lowDensityOverlay.adjacentLines.forEach(obj => {
          globeMap.scene.remove(obj.line);
        });
      }
      lowDensityOverlay = initDensityOverlay(minDistance, maxDistance, cachedStars, "low", lowGridSize);
      lowDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      lowDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(cachedStars, lowDensityOverlay);
    if (lowDensityLabeling) {
      lowDensityOverlay.assignConstellationsToCells().then(() => {
        lowDensityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
        lowDensityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      });
    } else {
      if (lowDensityOverlay.regionLabelsGroupTC && lowDensityOverlay.regionLabelsGroupTC.parent) {
        lowDensityOverlay.regionLabelsGroupTC.parent.remove(lowDensityOverlay.regionLabelsGroupTC);
      }
      if (lowDensityOverlay.regionLabelsGroupGlobe && lowDensityOverlay.regionLabelsGroupGlobe.parent) {
        lowDensityOverlay.regionLabelsGroupGlobe.parent.remove(lowDensityOverlay.regionLabelsGroupGlobe);
      }
    }
  } else {
    if (lowDensityOverlay) {
      lowDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.remove(c.tcMesh);
        globeMap.scene.remove(c.globeMesh);
      });
      lowDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.remove(obj.line);
      });
      lowDensityOverlay = null;
    }
  }

  if (highDensityMapping) {
    const form = document.getElementById('filters-form');
    const highGridSliderValue = parseFloat(new FormData(form).get('high-density-grid-size') || '2');
    const highGridSize = 4 / highGridSliderValue;
    if (
      !highDensityOverlay ||
      highDensityOverlay.minDistance !== parseFloat(minDistance) ||
      highDensityOverlay.maxDistance !== parseFloat(maxDistance) ||
      highDensityOverlay.gridSize !== highGridSize
    ) {
      if (highDensityOverlay) {
        highDensityOverlay.cubesData.forEach(c => {
          trueCoordinatesMap.scene.remove(c.tcMesh);
        });
        highDensityOverlay.adjacentLines.forEach(obj => {
          globeMap.scene.remove(obj.line);
        });
      }
      highDensityOverlay = initDensityOverlay(minDistance, maxDistance, cachedStars, "high", highGridSize);
      highDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      highDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(cachedStars, highDensityOverlay);
    if (highDensityLabeling) {
      highDensityOverlay.assignConstellationsToCells().then(() => {
        highDensityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
        highDensityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      });
    } else {
      if (highDensityOverlay.regionLabelsGroupTC && highDensityOverlay.regionLabelsGroupTC.parent) {
        highDensityOverlay.regionLabelsGroupTC.parent.remove(highDensityOverlay.regionLabelsGroupTC);
      }
      if (highDensityOverlay.regionLabelsGroupGlobe && highDensityOverlay.regionLabelsGroupGlobe.parent) {
        highDensityOverlay.regionLabelsGroupGlobe.parent.remove(highDensityOverlay.regionLabelsGroupGlobe);
      }
    }
  } else {
    if (highDensityOverlay) {
      highDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.remove(c.tcMesh);
        globeMap.scene.remove(c.globeMesh);
      });
      highDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.remove(obj.line);
      });
      highDensityOverlay = null;
    }
  }
  applyGlobeSurface(globeOpaqueSurface);
}

function removeConstellationObjectsFromGlobe() {
  if (constellationLinesGlobe && constellationLinesGlobe.length > 0) {
    constellationLinesGlobe.forEach(l => globeMap.scene.remove(l));
  }
  constellationLinesGlobe = [];
  if (constellationLabelsGlobe && constellationLabelsGlobe.length > 0) {
    constellationLabelsGlobe.forEach(lbl => globeMap.scene.remove(lbl));
  }
  constellationLabelsGlobe = [];
}

function removeConstellationOverlayObjectsFromGlobe() {
  if (constellationOverlayGlobe && constellationOverlayGlobe.length > 0) {
    constellationOverlayGlobe.forEach(mesh => globeMap.scene.remove(mesh));
  }
  constellationOverlayGlobe = [];
}

function applyGlobeSurface(isOpaque) {
  if (globeSurfaceSphere) {
    globeMap.scene.remove(globeSurfaceSphere);
    globeSurfaceSphere = null;
  }
  if (isOpaque) {
    const geom = new THREE.SphereGeometry(99, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.FrontSide,
      depthWrite: true,
      depthTest: true,
      transparent: false
    });
    globeSurfaceSphere = new THREE.Mesh(geom, mat);
    globeSurfaceSphere.renderOrder = 0;
    globeMap.scene.add(globeSurfaceSphere);
  }
}

class MapManager {
  constructor({ canvasId, mapType }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      10000
    );
    if (mapType === 'TrueCoordinates') {
      this.camera.position.set(0, 0, 70);
    } else {
      this.camera.position.set(0, 0, 200);
    }
    this.scene.add(this.camera);
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(amb);
    const pt = new THREE.PointLight(0xffffff, 1);
    this.scene.add(pt);
    this.controls = new ThreeDControls(this.camera, this.renderer.domElement);
    this.labelManager = new LabelManager(mapType, this.scene);
    // Remove old star group usage.
    this.starGroup = new THREE.Group();
    this.scene.add(this.starGroup);
    // NEW: Use instanced mesh for stars.
    this.instancedStars = null;
    this.starObjects = [];
    this.debouncedResize = debounce(() => this.onResize(), 200);
    window.addEventListener('resize', this.debouncedResize, false);
    this.animate();
  }

  // UPDATED: Use instanced rendering to draw stars in one draw call.
  addStars(stars) {
    if (this.instancedStars) {
      this.scene.remove(this.instancedStars);
      this.instancedStars.geometry.dispose();
      this.instancedStars.material.dispose();
      this.instancedStars = null;
    }
    const count = stars.length;
    const baseRadius = 0.2;
    const geometry = new THREE.SphereGeometry(baseRadius, 12, 12);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0
    });
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    const instanceColors = new Float32Array(count * 3);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const star = stars[i];
      let pos;
      if (this.mapType === 'TrueCoordinates') {
        pos = star.truePosition ? star.truePosition.clone() : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      } else {
        pos = star.spherePosition || new THREE.Vector3(0, 0, 0);
      }
      const scale = star.displaySize || 2;
      dummy.position.copy(pos);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
      const color = new THREE.Color(star.displayColor || '#ffffff');
      instanceColors[i * 3] = color.r;
      instanceColors[i * 3 + 1] = color.g;
      instanceColors[i * 3 + 2] = color.b;
    }
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3);
    instancedMesh.instanceColor.needsUpdate = true;
    this.scene.add(instancedMesh);
    this.instancedStars = instancedMesh;
    // Also update starObjects for interactions.
    this.starObjects = stars;
    // Optionally, clear the old starGroup.
    while (this.starGroup.children.length > 0) {
      const child = this.starGroup.children[0];
      this.starGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  updateConnections(stars, connectionObjs) {
    if (this.connectionGroup) {
      this.scene.remove(this.connectionGroup);
      this.connectionGroup = null;
    }
    if (!connectionObjs || connectionObjs.length === 0) return;
    this.connectionGroup = new THREE.Group();
    if (this.mapType === 'Globe') {
      const linesArray = createConnectionLines(stars, connectionObjs, 'Globe');
      linesArray.forEach(line => this.connectionGroup.add(line));
    } else {
      const merged = mergeConnectionLines(connectionObjs);
      this.connectionGroup.add(merged);
    }
    this.scene.add(this.connectionGroup);
  }

  updateMap(stars, connectionObjs) {
    this.addStars(stars);
    this.updateConnections(stars, connectionObjs);
  }

  onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }
}

// UPDATED: Modify interaction to support instanced mesh raycasting.
function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseMove(event) {
    if (selectedStarData) return;
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    let intersects = [];
    if (map.instancedStars) {
      intersects = raycaster.intersectObject(map.instancedStars);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId !== undefined && map.starObjects[instanceId]) {
          showTooltip(event.clientX, event.clientY, map.starObjects[instanceId]);
          return;
        }
      }
    } else {
      intersects = raycaster.intersectObjects(map.starGroup.children, true);
      if (intersects.length > 0) {
        const index = map.starGroup.children.indexOf(intersects[0].object);
        if (index >= 0 && map.starObjects[index]) {
          showTooltip(event.clientX, event.clientY, map.starObjects[index]);
          return;
        }
      }
    }
    hideTooltip();
  }

  function onClick(event) {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
      const tRect = tooltip.getBoundingClientRect();
      if (event.clientX >= tRect.left && event.clientX <= tRect.right &&
          event.clientY >= tRect.top && event.clientY <= tRect.bottom) {
        return;
      }
    }
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    let intersects = [];
    if (map.instancedStars) {
      intersects = raycaster.intersectObject(map.instancedStars);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId !== undefined) {
          selectedStarData = map.starObjects[instanceId];
          showTooltip(event.clientX, event.clientY, selectedStarData);
          updateSelectedStarHighlight();
          return;
        }
      }
    } else {
      intersects = raycaster.intersectObjects(map.starGroup.children, true);
      let clickedStar = null;
      if (intersects.length > 0) {
        const index = map.starGroup.children.indexOf(intersects[0].object);
        if (index >= 0) {
          clickedStar = map.starObjects[index];
        }
      }
      if (clickedStar) {
        selectedStarData = clickedStar;
        showTooltip(event.clientX, event.clientY, clickedStar);
        updateSelectedStarHighlight();
        return;
      }
    }
    selectedStarData = null;
    updateSelectedStarHighlight();
    hideTooltip();
  }

  map.canvas.addEventListener('mousemove', onMouseMove);
  map.canvas.addEventListener('click', onClick);
}

function updateSelectedStarHighlight() {
  if (selectedHighlightTrue) {
    trueCoordinatesMap.scene.remove(selectedHighlightTrue);
    selectedHighlightTrue = null;
  }
  if (selectedHighlightGlobe) {
    globeMap.scene.remove(selectedHighlightGlobe);
    selectedHighlightGlobe = null;
  }
  if (!selectedStarData) return;
  let posTrue = selectedStarData.truePosition ? selectedStarData.truePosition : new THREE.Vector3(selectedStarData.x_coordinate, selectedStarData.y_coordinate, selectedStarData.z_coordinate);
  let radius = (selectedStarData.displaySize || 2) * 0.2 * 1.2;
  const highlightGeom = new THREE.SphereGeometry(radius, 16, 16);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
  selectedHighlightTrue = new THREE.Mesh(highlightGeom, highlightMat);
  selectedHighlightTrue.position.copy(posTrue);
  trueCoordinatesMap.scene.add(selectedHighlightTrue);

  let posGlobe = selectedStarData.spherePosition ? selectedStarData.spherePosition : projectStarGlobe(selectedStarData);
  let radiusGlobe = (selectedStarData.displaySize || 2) * 0.2 * 1.2;
  const highlightGeomGlobe = new THREE.SphereGeometry(radiusGlobe, 16, 16);
  const highlightMatGlobe = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
  selectedHighlightGlobe = new THREE.Mesh(highlightGeomGlobe, highlightMatGlobe);
  selectedHighlightGlobe.position.copy(posGlobe);
  globeMap.scene.add(selectedHighlightGlobe);
}

async function main() {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');
  try {
    cachedStars = await loadStarData();
    if (!cachedStars.length) throw new Error('No star data available');
    await setupFilterUI(cachedStars);
    const debouncedApplyFilters = debounce(buildAndApplyFilters, 150);
    const form = document.getElementById('filters-form');
    if (form) {
      form.addEventListener('change', debouncedApplyFilters);
    }
    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });
    // Initialize interactions for each map.
    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;
    cachedStars.forEach(star => {
      star.spherePosition = projectStarGlobe(star);
      star.truePosition = getStarTruePosition(star);
    });
    const globeGrid = createGlobeGrid(100, { color: 0x444444, opacity: 0.2, lineWidth: 1 });
    globeMap.scene.add(globeGrid);
    buildAndApplyFilters();
    loader.classList.add('hidden');
  } catch (err) {
    console.error('Error initializing starmap:', err);
    alert('Initialization failed. Check console for details.');
    loader.classList.add('hidden');
  }
}

window.onload = main;
export { MapManager };
