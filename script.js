import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { applyFilters, setupFilterUI } from './filters/index.js';
import { createConnectionLines, mergeConnectionLines } from './filters/connectionsFilter.js';
import {
  createConstellationBoundariesForGlobe,
  createConstellationLabelsForGlobe
} from './filters/constellationFilter.js';
import { initDensityOverlay, updateDensityMapping } from './filters/densityFilter.js';
import { applyGlobeSurfaceFilter } from './filters/globeSurfaceFilter.js';
import { ThreeDControls } from './cameraControls.js';
import { LabelManager } from './labelManager.js';
import { showTooltip, hideTooltip } from './tooltips.js';

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

function radToSphere(ra, dec, R) {
  return new THREE.Vector3(
    -R * Math.cos(dec) * Math.cos(ra),
     R * Math.sin(dec),
    -R * Math.cos(dec) * Math.sin(ra)
  );
}
function getStarTruePosition(star) {
  const R = star.distance !== undefined ? star.distance : star.Distance_from_the_Sun;
  let ra, dec;
  if (star.RA_in_radian !== undefined && star.DEC_in_radian !== undefined) {
    ra = star.RA_in_radian;
    dec = star.DEC_in_radian;
  } else if (star.RA_in_degrees !== undefined && star.DEC_in_degrees !== undefined) {
    ra = THREE.Math.degToRad(star.RA_in_degrees);
    dec = THREE.Math.degToRad(star.DEC_in_degrees);
  } else {
    ra = 0; dec = 0;
  }
  return radToSphere(ra, dec, R);
}
function projectStarGlobe(star) {
  const R = 100;
  let ra, dec;
  if (star.RA_in_radian !== undefined && star.DEC_in_radian !== undefined) {
    ra = star.RA_in_radian;
    dec = star.DEC_in_radian;
  } else if (star.RA_in_degrees !== undefined && star.DEC_in_degrees !== undefined) {
    ra = THREE.Math.degToRad(star.RA_in_degrees);
    dec = THREE.Math.degToRad(star.DEC_in_degrees);
  } else {
    ra = 0; dec = 0;
  }
  return radToSphere(ra, dec, R);
}
function createGlobeGrid(R = 100, options = {}) {
  const gridGroup = new THREE.Group();
  const gridColor = options.color || 0x444444;
  const lineOpacity = (options.opacity !== undefined) ? options.opacity : 0.2;
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
      points.push(radToSphere(ra, THREE.Math.degToRad(decDeg), R));
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
      points.push(radToSphere(ra, dec, R));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }
  return gridGroup;
}
async function loadStarData() {
  try {
    const resp = await fetch('data/manifest.json');
    if (!resp.ok) {
      console.warn("Manifest file not found.");
      return [];
    }
    const fileNames = await resp.json();
    const dataPromises = fileNames.map(name =>
      fetch(`data/${name}`).then(r => r.ok ? r.json() : [])
    );
    const all = await Promise.all(dataPromises);
    return all.flat();
  } catch(e) {
    console.warn("Error loading star data:", e);
    return [];
  }
}
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
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
    highDensityLabeling,
    minDistance,
    maxDistance
  } = filters;
  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;
  currentGlobeFilteredStars.forEach(s => { s.spherePosition = projectStarGlobe(s); });
  currentFilteredStars.forEach(s => { s.truePosition = getStarTruePosition(s); });
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
  if (lowDensityMapping) {
    const form = document.getElementById('filters-form');
    const gridVal = parseInt(new FormData(form).get('low-density-grid-size') || "5", 10);
    const gridSize = Math.min(Math.max(gridVal, 1), 10);
    if (!lowDensityOverlay ||
        lowDensityOverlay.minDistance !== parseFloat(minDistance) ||
        lowDensityOverlay.maxDistance !== parseFloat(maxDistance) ||
        lowDensityOverlay.gridSize !== gridSize) {
      if (lowDensityOverlay) {
        lowDensityOverlay.cubesData.forEach(c => {
          trueCoordinatesMap.scene.remove(c.tcMesh);
          globeMap.scene.remove(c.globeMesh);
        });
        lowDensityOverlay.adjacentLines.forEach(obj => { globeMap.scene.remove(obj.line); });
      }
      lowDensityOverlay = initDensityOverlay(minDistance, maxDistance, cachedStars, "low", gridSize);
      lowDensityOverlay.cubesData.forEach(c => { trueCoordinatesMap.scene.add(c.tcMesh); });
      lowDensityOverlay.adjacentLines.forEach(obj => { globeMap.scene.add(obj.line); });
    }
    updateDensityMapping(cachedStars, lowDensityOverlay);
    const labelCk = form.querySelector('#enable-low-density-labeling');
    if (labelCk && labelCk.checked) {
      lowDensityOverlay.assignConstellationsToCells().then(() => {
        lowDensityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
        lowDensityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      });
    } else {
      if (lowDensityOverlay.regionLabelsGroupTC?.parent) {
        lowDensityOverlay.regionLabelsGroupTC.parent.remove(lowDensityOverlay.regionLabelsGroupTC);
      }
      if (lowDensityOverlay.regionLabelsGroupGlobe?.parent) {
        lowDensityOverlay.regionLabelsGroupGlobe.parent.remove(lowDensityOverlay.regionLabelsGroupGlobe);
      }
    }
  } else {
    if (lowDensityOverlay) {
      lowDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.remove(c.tcMesh);
        globeMap.scene.remove(c.globeMesh);
      });
      lowDensityOverlay.adjacentLines.forEach(obj => { globeMap.scene.remove(obj.line); });
      lowDensityOverlay = null;
    }
  }
  if (highDensityMapping) {
    const form = document.getElementById('filters-form');
    const starT = parseInt(form.querySelector('#high-octree-star-threshold').value || "10", 10);
    const maxD = parseInt(form.querySelector('#high-octree-max-depth').value || "6", 10);
    if (!highDensityOverlay ||
        highDensityOverlay.minDistance !== parseFloat(minDistance) ||
        highDensityOverlay.maxDistance !== parseFloat(maxDistance)) {
      if (highDensityOverlay) {
        highDensityOverlay.cubesData.forEach(c => {
          trueCoordinatesMap.scene.remove(c.tcMesh);
          globeMap.scene.remove(c.globeMesh);
        });
        highDensityOverlay.adjacentLines.forEach(obj => { globeMap.scene.remove(obj.line); });
      }
      highDensityOverlay = initDensityOverlay(minDistance, maxDistance, cachedStars, "high");
      highDensityOverlay.cubesData.forEach(c => { trueCoordinatesMap.scene.add(c.tcMesh); });
      highDensityOverlay.adjacentLines.forEach(obj => { globeMap.scene.add(obj.line); });
    }
    highDensityOverlay.starThreshold = starT;
    highDensityOverlay.maxDepth = maxD;
    updateDensityMapping(cachedStars, highDensityOverlay);
    const highLabelCk = form.querySelector('#enable-high-density-labeling');
    if (highLabelCk && highLabelCk.checked) {
      highDensityOverlay.assignConstellationsToCells().then(() => {
        highDensityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
        highDensityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      });
    } else {
      if (highDensityOverlay.regionLabelsGroupTC?.parent) {
        highDensityOverlay.regionLabelsGroupTC.parent.remove(highDensityOverlay.regionLabelsGroupTC);
      }
      if (highDensityOverlay.regionLabelsGroupGlobe?.parent) {
        highDensityOverlay.regionLabelsGroupGlobe.parent.remove(highDensityOverlay.regionLabelsGroupGlobe);
      }
    }
  } else {
    if (highDensityOverlay) {
      highDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.remove(c.tcMesh);
        globeMap.scene.remove(c.globeMesh);
      });
      highDensityOverlay.adjacentLines.forEach(obj => { globeMap.scene.remove(obj.line); });
      highDensityOverlay = null;
    }
  }
  applyGlobeSurface(globeOpaqueSurface);
}
function removeConstellationObjectsFromGlobe() {
  if (constellationLinesGlobe?.length > 0) {
    constellationLinesGlobe.forEach(l => globeMap.scene.remove(l));
  }
  constellationLinesGlobe = [];
  if (constellationLabelsGlobe?.length > 0) {
    constellationLabelsGlobe.forEach(lbl => globeMap.scene.remove(lbl));
  }
  constellationLabelsGlobe = [];
}
function removeConstellationOverlayObjectsFromGlobe() {
  if (constellationOverlayGlobe?.length > 0) {
    constellationOverlayGlobe.forEach(m => globeMap.scene.remove(m));
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
      transparent: false,
      depthWrite: true,
      depthTest: true
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
    this.camera = new THREE.PerspectiveCamera(75, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 10000);
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
    this.starGroup = new THREE.Group();
    this.scene.add(this.starGroup);
    window.addEventListener('resize', () => this.onResize(), false);
    this.animate();
  }
  addStars(stars) {
    while (this.starGroup.children.length > 0) {
      const child = this.starGroup.children[0];
      this.starGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    stars.forEach(star => {
      const size = star.displaySize || 1;
      const geom = new THREE.SphereGeometry(size * 0.2, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: star.displayColor || '#ffffff', transparent: true, opacity: 1.0 });
      const starMesh = new THREE.Mesh(geom, mat);
      let pos;
      if (this.mapType === 'TrueCoordinates') {
        pos = star.truePosition ? star.truePosition.clone() : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      } else {
        pos = star.spherePosition || new THREE.Vector3(0, 0, 0);
      }
      starMesh.position.copy(pos);
      this.starGroup.add(starMesh);
    });
    this.starObjects = stars;
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
      linesArray.forEach(l => this.connectionGroup.add(l));
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
function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  map.canvas.addEventListener('mousemove', evt => {
    if (selectedStarData) return;
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    const ints = raycaster.intersectObjects(map.starGroup.children, true);
    if (ints.length > 0) {
      const idx = map.starGroup.children.indexOf(ints[0].object);
      if (idx >= 0 && map.starObjects[idx]) {
        showTooltip(evt.clientX, evt.clientY, map.starObjects[idx]);
      }
    } else {
      hideTooltip();
    }
  });
  map.canvas.addEventListener('click', evt => {
    const tip = document.getElementById('tooltip');
    if (tip) {
      const tr = tip.getBoundingClientRect();
      if (evt.clientX >= tr.left && evt.clientX <= tr.right &&
          evt.clientY >= tr.top && evt.clientY <= tr.bottom) {
        return;
      }
    }
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    const ints = raycaster.intersectObjects(map.starGroup.children, true);
    let clickedStar = null;
    if (ints.length > 0) {
      const idx = map.starGroup.children.indexOf(ints[0].object);
      if (idx >= 0) {
        clickedStar = map.starObjects[idx];
      }
    }
    if (clickedStar) {
      selectedStarData = clickedStar;
      showTooltip(evt.clientX, evt.clientY, clickedStar);
      updateSelectedStarHighlight();
    } else {
      selectedStarData = null;
      updateSelectedStarHighlight();
      hideTooltip();
    }
  });
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
  if (selectedStarData) {
    let posTrue = selectedStarData.truePosition ? selectedStarData.truePosition : new THREE.Vector3(selectedStarData.x_coordinate, selectedStarData.y_coordinate, selectedStarData.z_coordinate);
    let r = (selectedStarData.displaySize || 2) * 0.2 * 1.2;
    const hGeom = new THREE.SphereGeometry(r, 16, 16);
    const hMat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
    selectedHighlightTrue = new THREE.Mesh(hGeom, hMat);
    selectedHighlightTrue.position.copy(posTrue);
    trueCoordinatesMap.scene.add(selectedHighlightTrue);
    let posGlobe = selectedStarData.spherePosition ? selectedStarData.spherePosition : projectStarGlobe(selectedStarData);
    let r2 = (selectedStarData.displaySize || 2) * 0.2 * 1.2;
    const hGeom2 = new THREE.SphereGeometry(r2, 16, 16);
    const hMat2 = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
    selectedHighlightGlobe = new THREE.Mesh(hGeom2, hMat2);
    selectedHighlightGlobe.position.copy(posGlobe);
    globeMap.scene.add(selectedHighlightGlobe);
  }
}
async function main() {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');
  try {
    cachedStars = await loadStarData();
    if (!cachedStars.length) throw new Error("No star data available");
    await setupFilterUI(cachedStars);
    const debouncedApplyFilters = debounce(buildAndApplyFilters, 150);
    const form = document.getElementById('filters-form');
    if (form) { form.addEventListener('change', debouncedApplyFilters); }
    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;
    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);
    cachedStars.forEach(star => {
      star.spherePosition = projectStarGlobe(star);
      star.truePosition = getStarTruePosition(star);
    });
    const globeGrid = createGlobeGrid(100, { color: 0x444444, opacity: 0.2, lineWidth: 1 });
    globeMap.scene.add(globeGrid);
    buildAndApplyFilters();
    loader.classList.add('hidden');
  } catch (err) {
    console.error("Error initializing starmap:", err);
    alert("Initialization failed. Check console for details.");
    loader.classList.add('hidden');
  }
}
window.onload = main;
