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

// ---------------------------------------------------------
// Global variables
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
let globeGrid = null;

// Global variables for the fixed transformation
// window.rotationQuaternion will rotate a unit true-coordinate vector to the desired (RA/DEC) direction
// window.globeOffset will be added after scaling to 100
window.rotationQuaternion = new THREE.Quaternion();
window.globeOffset = new THREE.Vector3(0, 0, 0);

// ---------------------------------------------------------
// Helper functions

// For the TrueCoordinates map, we simply use the file's x, y, z values.
function getStarTruePosition(star) {
  return new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
}

/**
 * For the Globe map, we project a star onto a sphere of radius 100 using the provided equatorial coordinates.
 * In our solution we "trust" the file’s RA_in_radian and DEC_in_radian values.
 */
function projectStarGlobe(star) {
  const R = 100;
  return new THREE.Vector3(
    -R * Math.cos(star.DEC_in_radian) * Math.cos(star.RA_in_radian),
     R * Math.sin(star.DEC_in_radian),
    -R * Math.cos(star.DEC_in_radian) * Math.sin(star.RA_in_radian)
  );
}

/**
 * Unified helper for projecting a true-coordinate position to the Globe map.
 * In our solution we “learned” that the proper projection of a true-coordinate vector
 * is to (1) normalize it, (2) apply a fixed rotation, (3) scale by 100, and (4) add a fixed offset.
 *
 * The global values window.rotationQuaternion and window.globeOffset must be computed in the main script.
 */
function projectToGlobe(pos) {
  const R = 100;
  let p = pos.clone().normalize();
  if (window.rotationQuaternion) {
    p.applyQuaternion(window.rotationQuaternion);
  }
  p.multiplyScalar(R);
  if (window.globeOffset) {
    p.add(window.globeOffset);
  }
  return p;
}

/**
 * Create a grid overlay on the inner surface of the sphere (radius 100).
 * This grid uses the same projection (projectToGlobe) as stars.
 */
function createGlobeGrid(R = 100, options = {}) {
  const gridGroup = new THREE.Group();
  const gridColor = options.color || 0x444444;
  const lineOpacity = options.opacity !== undefined ? options.opacity : 0.25;
  const lineWidth = options.lineWidth || 1;

  const material = new THREE.LineBasicMaterial({
    color: gridColor,
    transparent: true,
    opacity: lineOpacity,
    linewidth: lineWidth
  });

  // Draw meridians (constant RA) every 30°.
  for (let raDeg = 0; raDeg < 360; raDeg += 30) {
    const ra = THREE.Math.degToRad(raDeg);
    const points = [];
    // Vary dec from -80° to +80°.
    for (let decDeg = -80; decDeg <= 80; decDeg += 2) {
      const dec = THREE.Math.degToRad(decDeg);
      points.push(new THREE.Vector3(
        -R * Math.cos(dec) * Math.cos(ra),
         R * Math.sin(dec),
        -R * Math.cos(dec) * Math.sin(ra)
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }

  // Draw parallels (constant dec) every 30° from -60° to +60°.
  for (let decDeg = -60; decDeg <= 60; decDeg += 30) {
    const dec = THREE.Math.degToRad(decDeg);
    const points = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const ra = (i / segments) * 2 * Math.PI;
      points.push(new THREE.Vector3(
        -R * Math.cos(dec) * Math.cos(ra),
         R * Math.sin(dec),
        -R * Math.cos(dec) * Math.sin(ra)
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }

  return gridGroup;
}

// ---------------------------------------------------------
// MapManager class
class MapManager {
  constructor({ canvasId, mapType }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType;
    this.scene = new THREE.Scene();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
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

    // Group to hold individual star meshes
    this.starGroup = new THREE.Group();
    this.scene.add(this.starGroup);

    window.addEventListener('resize', () => this.onResize(), false);
    this.animate();
  }

  /**
   * For the TrueCoordinates map we use the raw positions from the file.
   * For the Globe map we use the precomputed sphere positions.
   */
  addStars(stars) {
    // Remove existing star meshes.
    while (this.starGroup.children.length > 0) {
      const child = this.starGroup.children[0];
      this.starGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }

    stars.forEach(star => {
      // Use a default size if displaySize is not set.
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
        pos = getStarTruePosition(star);
      } else {
        pos = star.spherePosition || new THREE.Vector3(0, 0, 0);
      }
      starMesh.position.copy(pos);
      this.starGroup.add(starMesh);
    });
    // Keep a reference to the star data.
    this.starObjects = stars;
  }

  /**
   * Creates connection lines.
   */
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

// ---------------------------------------------------------
// Raycasting for tooltips
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
    } else {
      selectedStarData = null;
      hideTooltip();
    }
  });
}

function updateSelectedStarHighlight() {
  // (Placeholder for selected-star highlight logic.)
  [trueCoordinatesMap, globeMap].forEach(map => {
    // No-op for now.
  });
}

// ---------------------------------------------------------
// Main onload
window.onload = async () => {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');

  try {
    // Load star data.
    cachedStars = await loadStarData();
    if (!cachedStars.length) throw new Error('No star data available');

    // Set up the filter UI.
    await setupFilterUI(cachedStars);

    // Attach event listeners for filter changes (with debouncing).
    const debouncedApplyFilters = debounce(buildAndApplyFilters, 150);
    const form = document.getElementById('filters-form');
    if (form) {
      form.addEventListener('change', debouncedApplyFilters);
      const cSlider = document.getElementById('connection-slider');
      const cVal = document.getElementById('connection-value');
      if (cSlider && cVal) {
        cSlider.addEventListener('input', () => {
          cVal.textContent = cSlider.value;
          debouncedApplyFilters();
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

    // Compute max distance from the Sun.
    maxDistanceFromCenter = Math.max(
      ...cachedStars.map(s =>
        Math.sqrt(s.x_coordinate ** 2 + s.y_coordinate ** 2 + s.z_coordinate ** 2)
      )
    );

    // Initialize the maps.
    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);

    // Compute the Globe map positions for stars using the correct method.
    // For the Globe map, we “trust” the provided equatorial values.
    cachedStars.forEach(star => {
      star.spherePosition = projectStarGlobe(star);
    });

    // Now compute a fixed rotation and offset by comparing a reference star’s two projections.
    const refStar = cachedStars.find(star => star.Common_name_of_the_star !== 'Sun');
    if (refStar) {
      // Desired position using the RA_in_radian/DEC_in_radian method.
      const desired = new THREE.Vector3(
        -100 * Math.cos(refStar.DEC_in_radian) * Math.cos(refStar.RA_in_radian),
         100 * Math.sin(refStar.DEC_in_radian),
        -100 * Math.cos(refStar.DEC_in_radian) * Math.sin(refStar.RA_in_radian)
      );
      // Raw position: use the true coordinate, normalized, rotated (if any) and scaled by 100.
      const raw = new THREE.Vector3(refStar.x_coordinate, refStar.y_coordinate, refStar.z_coordinate)
                      .normalize()
                      .applyQuaternion(window.rotationQuaternion) // might be identity at this point
                      .multiplyScalar(100);
      // Compute the offset required.
      window.globeOffset = desired.clone().sub(raw);
    } else {
      window.globeOffset = new THREE.Vector3(0, 0, 0);
    }

    // Create and add the globe grid.
    globeGrid = createGlobeGrid(100, { color: 0x444444, opacity: 0.2, lineWidth: 1 });
    globeMap.scene.add(globeGrid);

    buildAndApplyFilters();

    loader.classList.add('hidden');
  } catch (err) {
    console.error('Error initializing starmap:', err);
    alert('Initialization failed. Check console for details.');
    loader.classList.add('hidden');
  }
};

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

// Simple debounce helper.
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

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
 * Main function that re-applies all filters, updates both maps, and re-creates lines.
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

  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;

  // For the Globe map, update each star’s spherePosition.
  currentGlobeFilteredStars.forEach(star => {
    star.spherePosition = projectStarGlobe(star);
  });

  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  trueCoordinatesMap.labelManager.refreshLabels(currentFilteredStars);

  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  globeMap.labelManager.refreshLabels(currentGlobeFilteredStars);

  removeConstellationObjectsFromGlobe();
  if (showConstellationBoundaries) {
    constellationLinesGlobe = createConstellationBoundariesForGlobe();
    constellationLinesGlobe.forEach(ln => globeMap.scene.add(ln));
  }
  if (showConstellationNames) {
    constellationLabelsGlobe = createConstellationLabelsForGlobe();
    constellationLabelsGlobe.forEach(lbl => globeMap.scene.add(lbl));
  }

  applyGlobeSurfaceFilter({ globeOpaqueSurface });
  
  if (getCurrentFilters().enableDensityMapping) {
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
