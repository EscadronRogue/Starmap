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
 * Simple debounce helper function.
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

/**
 * MapManager class for managing a Three.js scene.
 * The addStars method now creates an instanced mesh for performance.
 */
class MapManager {
  constructor({ canvasId, mapType }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType;
    this.scene = new THREE.Scene();

    // Create renderer with antialiasing and limit pixel ratio for performance.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);

    // Setup camera with different starting positions for the two map types.
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

    // Add basic lighting.
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(amb);
    const pt = new THREE.PointLight(0xffffff, 1);
    this.scene.add(pt);

    // Setup custom camera controls.
    this.controls = new ThreeDControls(this.camera, this.renderer.domElement);

    // Create a LabelManager instance (for updating star labels).
    this.labelManager = new LabelManager(mapType, this.scene);

    window.addEventListener('resize', () => this.onResize(), false);
    this.animate();
  }

  /**
   * addStars creates an instanced mesh for all stars.
   * For TrueCoordinates, we assume each star is drawn as a low-poly sphere.
   */
  addStars(stars) {
    // Remove any previously added instanced mesh.
    if (this.instancedStars) {
      this.scene.remove(this.instancedStars);
    }
    const instanceCount = stars.length;
    const starGeometry = new THREE.SphereGeometry(1, 8, 8); // low-poly sphere
    const starMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    this.instancedStars = new THREE.InstancedMesh(starGeometry, starMaterial, instanceCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < instanceCount; i++) {
      const star = stars[i];
      // For TrueCoordinates, set position using star.x_coordinate, star.y_coordinate, star.z_coordinate.
      dummy.position.set(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      // Scale based on star.displaySize (adjust multiplier as needed).
      dummy.scale.setScalar(star.displaySize * 0.2);
      dummy.updateMatrix();
      this.instancedStars.setMatrixAt(i, dummy.matrix);
    }
    this.instancedStars.instanceMatrix.needsUpdate = true;
    this.scene.add(this.instancedStars);
    this.starObjects = stars; // Save the star data for label updates.
  }

  /**
   * updateMap updates the scene by adding stars and connection lines.
   * Connection lines are merged using the mergeConnectionLines helper.
   */
  updateMap(stars, connectionObjs) {
    // Update star instanced mesh.
    this.addStars(stars);

    // Remove old connection lines.
    if (this.connectionLines) {
      this.scene.remove(this.connectionLines);
      this.connectionLines = null;
    }
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
    // Update labels (the LabelManager throttles its updates internally).
    if (this.labelManager && this.starObjects) {
      this.labelManager.updateLabels(this.starObjects);
    }
  }
}

/**
 * Dummy functions for projecting stars (if needed).
 */
function projectStarTrueCoordinates(star) {
  return null;
}
function projectStarGlobe(star) {
  return null;
}

/**
 * Initialize star interactions (raycasting for tooltip and selection).
 */
function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  map.canvas.addEventListener('mousemove', (event) => {
    if (selectedStarData) return;
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);
    // For instanced meshes, intersect the instanced object.
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
 * Update selected star highlight.
 * (In an instanced mesh, you might change an instanced attribute or shader flag.)
 * Here this function is a placeholder.
 */
function updateSelectedStarHighlight() {
  [trueCoordinatesMap, globeMap].forEach(map => {
    // For an instanced mesh, you would update the corresponding instance color or scale.
    // This is a placeholder to show where the update would occur.
  });
}

window.onload = async () => {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');

  try {
    cachedStars = await loadStarData();
    if (!cachedStars.length) throw new Error('No star data available');

    await setupFilterUI(cachedStars);

    // Debounce heavy filter updates.
    const debouncedBuildAndApplyFilters = debounce(buildAndApplyFilters, 150);
    const form = document.getElementById('filters-form');
    if (form) {
      form.addEventListener('change', debouncedBuildAndApplyFilters);

      // Update slider events with debouncing.
      const cSlider = document.getElementById('connection-slider');
      const cVal = document.getElementById('connection-value');
      if (cSlider && cVal) {
        cSlider.addEventListener('input', () => {
          cVal.textContent = cSlider.value;
          debouncedBuildAndApplyFilters();
        });
      }
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

    maxDistanceFromCenter = Math.max(
      ...cachedStars.map(s => Math.sqrt(s.x_coordinate ** 2 + s.y_coordinate ** 2 + s.z_coordinate ** 2))
    );

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
    // Expose maps to window for external resizing if needed.
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);

    buildAndApplyFilters();

    // Density overlay: unchanged from previous implementation.
    const currentFilters = getCurrentFilters();
    if (currentFilters.enableDensityMapping) {
      densityOverlay = initDensityOverlay(maxDistanceFromCenter, currentFilteredStars);
      densityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
        globeMap.scene.add(c.globeMesh);
      });
      densityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
      updateDensityMapping(currentFilteredStars);
    } else {
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
  } catch (err) {
    console.error('Error initializing starmap:', err);
    alert('Initialization of starmap failed. Please check console.');
  } finally {
    loader.classList.add('hidden');
  }
};

function getCurrentFilters() {
  const form = document.getElementById('filters-form');
  const formData = new FormData(form);
  return {
    enableConnections: (formData.get('enable-connections') !== null),
    enableDensityMapping: (formData.get('enable-density-mapping') !== null)
  };
}

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

  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;

  // For connection lines, use our merged helper if connections are enabled.
  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);

  removeConstellationObjectsFromGlobe();
  if (showConstellationBoundaries) {
    constellationLinesGlobe = createConstellationBoundariesForGlobe();
    constellationLinesGlobe.forEach(ln => globeMap.scene.add(ln));
  }
  if (showConstellationNames) {
    constellationLabelsGlobe = createConstellationLabelsForGlobe();
    constellationLabelsGlobe.forEach(lbl => globeMap.scene.add(lbl));
  }

  applyGlobeSurface(globeOpaqueSurface);

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
