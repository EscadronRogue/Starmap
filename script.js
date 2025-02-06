// script.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

import { applyFilters, setupFilterUI } from './filters/index.js';
import { mergeConnectionLines } from './filters/connectionsFilter.js';
import {
  createConstellationBoundariesForGlobe,
  createConstellationLabelsForGlobe
} from './filters/constellationFilter.js';
import { globeSurfaceOpaque } from './filters/globeSurfaceFilter.js';

import { ThreeDControls } from './cameraControls.js';
import { LabelManager } from './labelManager.js';
import { showTooltip, hideTooltip } from './tooltips.js';

// Global variables for caching data and storing current scene objects.
let cachedStars = null;
let currentFilteredStars = [];
let currentConnections = [];
let currentGlobeFilteredStars = [];
let currentGlobeConnections = [];

let maxDistanceFromCenter = 0;
let selectedStarData = null;

let trueCoordinatesMap;
let globeMap;

let constellationLinesGlobe = [];
let constellationLabelsGlobe = [];
let globeSurfaceSphere = null;
let densityOverlay = null;

/**
 * Loads star data from the JSON file.
 */
async function loadStarData() {
  try {
    const resp = await fetch('complete_data_stars.json');
    if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
    const arr = await resp.json();
    console.log(`Loaded ${arr.length} stars.`);
    return arr;
  } catch (err) {
    console.error('Error loading star data:', err);
    return [];
  }
}

/**
 * Simple debounce helper function so we don't spam expensive operations on rapid changes.
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

/**
 * MapManager class for the 3D scenes.
 */
class MapManager {
  constructor({ canvasId, mapType }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType;
    this.scene = new THREE.Scene();

    // Basic renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
    // Cap pixel ratio to reduce performance overhead
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);

    // Camera
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

    // Basic lights
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(amb);
    const pt = new THREE.PointLight(0xffffff, 1);
    this.scene.add(pt);

    // Custom camera controls
    this.controls = new ThreeDControls(this.camera, this.renderer.domElement);

    // Label manager
    this.labelManager = new LabelManager(mapType, this.scene);

    window.addEventListener('resize', () => this.onResize(), false);

    // Begin animation loop
    this.animate();
  }

  /**
   * Creates an instanced mesh for the given stars (TrueCoordinates only).
   * For the globe, we typically do a different approach (but you have the same code for both here).
   */
  addStars(stars) {
    // Remove previous instanced mesh if exists
    if (this.instancedStars) {
      this.scene.remove(this.instancedStars);
      this.instancedStars = null;
    }

    const instanceCount = stars.length;
    const starGeometry = new THREE.SphereGeometry(1, 8, 8); // low-poly sphere
    const starMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    const instanced = new THREE.InstancedMesh(starGeometry, starMaterial, instanceCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < instanceCount; i++) {
      const star = stars[i];
      dummy.position.set(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      dummy.scale.setScalar(star.displaySize * 0.2);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    this.instancedStars = instanced;
    this.scene.add(instanced);
    this.starObjects = stars; // store data for reference
  }

  /**
   * Updates the map with a new set of stars and optional connection lines.
   */
  updateMap(stars, connectionObjs) {
    // Rebuild instanced star mesh
    this.addStars(stars);

    // Remove old connection lines if present
    if (this.connectionLines) {
      this.scene.remove(this.connectionLines);
      this.connectionLines = null;
    }
    // Merge connections into a single LineSegments object if we have them
    if (connectionObjs && connectionObjs.length > 0) {
      this.connectionLines = mergeConnectionLines(connectionObjs);
      this.scene.add(this.connectionLines);
    }
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
    // Note: We removed per-frame label updates here to avoid performance issues.
  }
}

/**
 * Dummy functions for projection logic if needed.
 */
function projectStarTrueCoordinates(star) {
  return null;
}
function projectStarGlobe(star) {
  return null;
}

/**
 * Initializes raycasting for star hover/click interactions (tooltips).
 */
function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  map.canvas.addEventListener('mousemove', (event) => {
    // If we have a star selected, we might skip hover highlighting (optional).
    if (selectedStarData) return;

    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);

    const intersects = raycaster.intersectObject(map.instancedStars, true);
    if (intersects.length > 0) {
      const index = intersects[0].instanceId;
      if (typeof index === 'number') {
        const star = map.starObjects[index];
        if (star) {
          showTooltip(event.clientX, event.clientY, star);
        }
      }
    } else {
      hideTooltip();
    }
  });

  map.canvas.addEventListener('click', (event) => {
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);

    const intersects = raycaster.intersectObject(map.instancedStars, true);
    if (intersects.length > 0) {
      const index = intersects[0].instanceId;
      if (typeof index === 'number') {
        const star = map.starObjects[index];
        if (star) {
          selectedStarData = star;
          showTooltip(event.clientX, event.clientY, star);
          updateSelectedStarHighlight();
        }
      }
    } else {
      selectedStarData = null;
      updateSelectedStarHighlight();
      hideTooltip();
    }
  });
}

/**
 * Example placeholder for a selected star highlight.
 */
function updateSelectedStarHighlight() {
  // If you'd like to visually highlight the selected star in the instanced mesh,
  // you would modify the instance color or scale for that particular instance ID.
  // The code below is just a placeholder.
  [trueCoordinatesMap, globeMap].forEach(map => {
    // TODO: custom highlight logic
  });
}

/**
 * Runs on page load. Initializes UI, loads data, sets up scenes, etc.
 */
window.onload = async () => {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');

  try {
    cachedStars = await loadStarData();
    if (!cachedStars.length) throw new Error('No star data available');

    // Setup filter UI
    await setupFilterUI(cachedStars);

    // Debounce the filter changes so we don't spam expensive ops
    const debouncedApplyFilters = debounce(buildAndApplyFilters, 150);
    const form = document.getElementById('filters-form');
    if (form) {
      form.addEventListener('change', debouncedApplyFilters);

      // connection slider
      const cSlider = document.getElementById('connection-slider');
      const cVal = document.getElementById('connection-value');
      if (cSlider && cVal) {
        cSlider.addEventListener('input', () => {
          cVal.textContent = cSlider.value;
          debouncedApplyFilters();
        });
      }
      // density sliders
      const dSlider = document.getElementById('density-slider');
      const dVal = document.getElementById('density-value');
      if (dSlider && dVal) {
        dSlider.addEventListener('input', () => {
          dVal.textContent = dSlider.value;
          if (getCurrentFilters().enableDensityMapping) {
            updateDensityMapping(currentFilteredStars);
          }
        });
      }
      const tSlider = document.getElementById('tolerance-slider');
      const tVal = document.getElementById('tolerance-value');
      if (tSlider && tVal) {
        tSlider.addEventListener('input', () => {
          tVal.textContent = tSlider.value;
          if (getCurrentFilters().enableDensityMapping) {
            updateDensityMapping(currentFilteredStars);
          }
        });
      }
    }

    // Precompute the max distance once
    maxDistanceFromCenter = Math.max(
      ...cachedStars.map(s => Math.sqrt(s.x_coordinate**2 + s.y_coordinate**2 + s.z_coordinate**2))
    );

    // Create the two map scenes
    trueCoordinatesMap = new MapManager({
      canvasId: 'map3D',
      mapType: 'TrueCoordinates',
      projectFunction: projectStarTrueCoordinates,
    });
    globeMap = new MapManager({
      canvasId: 'sphereMap',
      mapType: 'Globe',
      projectFunction: projectStarGlobe,
    });

    // Set them global for debugging if wanted
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;

    // Init interactions for hover/click
    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);

    // First filter run
    buildAndApplyFilters();

    loader.classList.add('hidden');
  } catch (err) {
    console.error('Error initializing starmap:', err);
    alert('Initialization failed. Check console for details.');
    loader.classList.add('hidden');
  }
};

/**
 * Returns the relevant booleans from our filter form.
 */
function getCurrentFilters() {
  const form = document.getElementById('filters-form');
  if (!form) return { enableConnections: false, enableDensityMapping: false };
  const formData = new FormData(form);
  return {
    enableConnections: (formData.get('enable-connections') !== null),
    enableDensityMapping: (formData.get('enable-density-mapping') !== null)
  };
}

/**
 * Builds filter results and applies them to both maps.
 */
function buildAndApplyFilters() {
  if (!cachedStars) return;
  const {
    filteredStars,
    connections,
    globeFilteredStars,
    globeConnections,
    showConstellationBoundaries,
    showConstellationNames,
    globeOpaqueSurface,
    enableConnections,
    enableDensityMapping
  } = applyFilters(cachedStars);

  // Store the results
  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;

  // Update the TrueCoordinates map
  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  // Refresh label manager for TrueCoordinates
  trueCoordinatesMap.labelManager.refreshLabels(currentFilteredStars);

  // Update the Globe map
  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  // Refresh label manager for Globe
  globeMap.labelManager.refreshLabels(currentGlobeFilteredStars);

  // Remove old constellation lines/labels from globe, re-add if needed
  removeConstellationObjectsFromGlobe();
  if (showConstellationBoundaries) {
    constellationLinesGlobe = createConstellationBoundariesForGlobe();
    constellationLinesGlobe.forEach(ln => globeMap.scene.add(ln));
  }
  if (showConstellationNames) {
    constellationLabelsGlobe = createConstellationLabelsForGlobe();
    constellationLabelsGlobe.forEach(lbl => globeMap.scene.add(lbl));
  }

  // Apply globe surface (opaque/transparent)
  applyGlobeSurface(globeOpaqueSurface);

  // Density mapping overlay
  if (enableDensityMapping) {
    if (!densityOverlay) {
      densityOverlay = initDensityOverlay(maxDistanceFromCenter, currentFilteredStars);
      densityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
        globeMap.scene.add(c.globeMesh);
      });
      densityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(currentFilteredStars);
  } else {
    // Remove density overlay if it exists
    if (densityOverlay) {
      densityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.remove(c.tcMesh);
        globeMap.scene.remove(c.globeMesh);
      });
      densityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.remove(obj.line);
      });
      densityOverlay = null;
    }
  }
}

/**
 * Removes any previously-added constellation lines/labels from the globe scene.
 */
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

/**
 * Toggles the globe surface from transparent to opaque.
 */
function applyGlobeSurface(isOpaque) {
  if (globeSurfaceSphere) {
    globeMap.scene.remove(globeSurfaceSphere);
    globeSurfaceSphere = null;
  }
  if (isOpaque) {
    const geom = new THREE.SphereGeometry(100, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.FrontSide,
      depthWrite: true,
      depthTest: true,
      transparent: false,
    });
    globeSurfaceSphere = new THREE.Mesh(geom, mat);
    globeSurfaceSphere.renderOrder = 0;
    globeMap.scene.add(globeSurfaceSphere);
  }
}

/**
 * Initializes the density overlay once, from your existing code in filters/densityFilter.js.
 * We call this only if the user enabled the density mapping.
 */
function initDensityOverlay(maxDistance, starArray) {
  // This function is imported from your /filters/densityFilter.js:
  // export function initDensityOverlay(maxDistance, starArray) { ... }
  // but we replicate it here or simply call the import. 
  // For clarity in this code snippet, we'll assume we call the import:
  return window.initDensityOverlay(maxDistance, starArray);
}

/**
 * Updates the density overlay after user moves slider or filters change.
 * Also from your /filters/densityFilter.js
 */
function updateDensityMapping(starArray) {
  if (!densityOverlay) return;
  window.updateDensityMapping(starArray);
}
