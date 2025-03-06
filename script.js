// script.js

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
// Global variables for star highlight meshes
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

/**
 * Converts spherical coordinates (RA, DEC) to a THREE.Vector3 on a sphere of radius R.
 */
function radToSphere(ra, dec, R) {
  return new THREE.Vector3(
    -R * Math.cos(dec) * Math.cos(ra),
     R * Math.sin(dec),
    -R * Math.cos(dec) * Math.sin(ra)
  );
}

/**
 * Computes the true 3D position of a star using its RA/DEC and its distance.
 * It supports both the new "distance" property and the legacy "Distance_from_the_Sun" property.
 */
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
    ra = 0; 
    dec = 0;
  }
  return radToSphere(ra, dec, R);
}

/**
 * Projects a star onto the Globe.
 */
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
    ra = 0; 
    dec = 0;
  }
  return radToSphere(ra, dec, R);
}

/**
 * Creates a grid for the Globe map.
 * This function builds a set of lines (using great-circle points) representing RA/DEC grid lines.
 */
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
  // Draw meridians (constant RA)
  for (let raDeg = 0; raDeg < 360; raDeg += 30) {
    const ra = THREE.Math.degToRad(raDeg);
    const points = [];
    for (let decDeg = -80; decDeg <= 80; decDeg += 2) {
      const dec = THREE.Math.degToRad(decDeg);
      points.push(radToSphere(ra, dec, R));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }
  // Draw parallels (constant DEC)
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

/**
 * Loads star data by reading every JSON file listed in data/manifest.json.
 */
async function loadStarData() {
  const manifestUrl = 'data/manifest.json';
  try {
    const manifestResp = await fetch(manifestUrl);
    if (!manifestResp.ok) {
      console.warn(`Manifest file not found: ${manifestUrl}`);
      return [];
    }
    const fileNames = await manifestResp.json(); // e.g., ["Stars1.json", "Stars2.json", ...]
    // Load each file in parallel
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
    // Flatten all arrays into one array
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
    // Optional overlay handling.
  }

  // LOW DENSITY MAPPING – use the complete star set (cachedStars) for density mapping
  if (lowDensityMapping) {
    // We also read the "low-density-grid-size" from the form data
    // We invert it so that a lower slider => bigger cells => larger gridSize
    // For example, default slider=2 => gridSize=2 => matches current code
    // If slider=1 => gridSize=4 => bigger cells, if slider=4 => gridSize=1 => smaller cells
    const form = document.getElementById('filters-form');
    const lowGridSliderValue = parseFloat(new FormData(form).get('low-density-grid-size') || '2');
    const lowGridSize = 4 / lowGridSliderValue;  // invert relationship

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
        console.log("=== DEBUG: Low Density cluster distribution ===");
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

  // HIGH DENSITY MAPPING – also use cachedStars
  if (highDensityMapping) {
    // Similarly read the "high-density-grid-size"
    const form = document.getElementById('filters-form');
    const highGridSliderValue = parseFloat(new FormData(form).get('high-density-grid-size') || '2');
    const highGridSize = 4 / highGridSliderValue;  // invert relationship

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
        console.log("=== DEBUG: High Density cluster distribution ===");
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
      const sphereGeometry = new THREE.SphereGeometry(size * 0.2, 12, 12);
      const material = new THREE.MeshBasicMaterial({
        color: star.displayColor || '#ffffff',
        transparent: true,
        opacity: 1.0
      });
      const starMesh = new THREE.Mesh(sphereGeometry, material);
      let pos;
      if (this.mapType === 'TrueCoordinates') {
        pos = star.truePosition
          ? star.truePosition.clone()
          : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
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
    if (this.mapType === 'Globe' && window.constellationOverlayGlobe) {
      window.constellationOverlayGlobe.forEach(mesh => {
        if (this.camera.position.length() > 100) {
          mesh.material.depthTest = false;
          mesh.renderOrder = 2;
        } else {
          mesh.material.depthTest = true;
          mesh.renderOrder = 0;
        }
      });
    }
    if (this.mapType === 'Globe') {
      this.scene.traverse(child => {
        if (child.material && child.material.uniforms && child.material.uniforms.cameraPos) {
          child.material.uniforms.cameraPos.value.copy(this.camera.position);
        }
      });
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  map.canvas.addEventListener('mousemove', (event) => {
    if (selectedStarData) return;
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    const intersects = raycaster.intersectObjects(map.starGroup.children, true);
    if (intersects.length > 0) {
      const index = map.starGroup.children.indexOf(intersects[0].object);
      if (index >= 0 && map.starObjects[index]) {
        showTooltip(event.clientX, event.clientY, map.starObjects[index]);
      }
    } else {
      hideTooltip();
    }
  });
  
  map.canvas.addEventListener('click', (event) => {
    // Check if the click occurred inside the tooltip's bounding box.
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
      const tRect = tooltip.getBoundingClientRect();
      if (
        event.clientX >= tRect.left && event.clientX <= tRect.right &&
        event.clientY >= tRect.top && event.clientY <= tRect.bottom
      ) {
        // Click occurred inside the tooltip; do nothing.
        return;
      }
    }
    
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    const intersects = raycaster.intersectObjects(map.starGroup.children, true);
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
    } else {
      selectedStarData = null;
      updateSelectedStarHighlight();
      hideTooltip();
    }
  });
}

function updateSelectedStarHighlight() {
  // Remove existing highlights if any.
  if (selectedHighlightTrue) {
    trueCoordinatesMap.scene.remove(selectedHighlightTrue);
    selectedHighlightTrue = null;
  }
  if (selectedHighlightGlobe) {
    globeMap.scene.remove(selectedHighlightGlobe);
    selectedHighlightGlobe = null;
  }
  if (selectedStarData) {
    // Highlight in TrueCoordinates Map
    let posTrue = selectedStarData.truePosition 
      ? selectedStarData.truePosition 
      : new THREE.Vector3(selectedStarData.x_coordinate, selectedStarData.y_coordinate, selectedStarData.z_coordinate);
    let radius = (selectedStarData.displaySize || 2) * 0.2 * 1.2;
    const highlightGeom = new THREE.SphereGeometry(radius, 16, 16);
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
    selectedHighlightTrue = new THREE.Mesh(highlightGeom, highlightMat);
    selectedHighlightTrue.position.copy(posTrue);
    trueCoordinatesMap.scene.add(selectedHighlightTrue);

    // Highlight in Globe Map
    let posGlobe = selectedStarData.spherePosition 
      ? selectedStarData.spherePosition 
      : projectStarGlobe(selectedStarData);
    let radiusGlobe = (selectedStarData.displaySize || 2) * 0.2 * 1.2;
    const highlightGeomGlobe = new THREE.SphereGeometry(radiusGlobe, 16, 16);
    const highlightMatGlobe = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
    selectedHighlightGlobe = new THREE.Mesh(highlightGeomGlobe, highlightMatGlobe);
    selectedHighlightGlobe.position.copy(posGlobe);
    globeMap.scene.add(selectedHighlightGlobe);
  }
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
    console.error('Error initializing starmap:', err);
    alert('Initialization failed. Check console for details.');
    loader.classList.add('hidden');
  }
}

window.onload = main;
