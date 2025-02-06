// script.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

import { applyFilters, setupFilterUI } from './filters/index.js';
import { createConnectionLines, mergeConnectionLines } from './filters/connectionsFilter.js';
import {
  createConstellationBoundariesForGlobe,
  createConstellationLabelsForGlobe
} from './filters/constellationFilter.js';
import { initDensityOverlay, updateDensityMapping } from './filters/densityFilter.js';
import { globeSurfaceOpaque } from './filters/globeSurfaceFilter.js';
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

// ---------------------------------------------------------
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

// Simple debounce helper
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

/**
 * Projects a star's (x,y,z) position onto a sphere of radius 100.
 */
function projectStarGlobe(star) {
  const v = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
  if (v.lengthSq() > 0) {
    v.normalize().multiplyScalar(100);
  }
  return { x: v.x, y: v.y, z: v.z };
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

    window.addEventListener('resize', () => this.onResize(), false);
    this.animate();
  }

  /**
   * Creates an InstancedMesh for the given stars.
   * Each star’s displaySize, displayColor, and displayOpacity are set by filters.
   *
   * We explicitly create an instanceColor attribute and write each star’s color into it.
   * We also force the material’s base color to white.
   * Because per‑instance opacity isn’t supported in stock MeshBasicMaterial,
   * we compute the average opacity and set it uniformly.
   */
  addStars(stars) {
    if (this.instancedStars) {
      this.scene.remove(this.instancedStars);
      this.instancedStars = null;
    }

    const instanceCount = stars.length;
    if (instanceCount === 0) return;

    const starGeometry = new THREE.SphereGeometry(1, 8, 8);
    const starMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      color: 0xffffff // force base color to white so that vertex colors are not tinted
    });

    const instanced = new THREE.InstancedMesh(starGeometry, starMaterial, instanceCount);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Create instanceColor attribute explicitly.
    instanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(instanceCount * 3),
      3,
      false
    );

    const dummy = new THREE.Object3D();
    const colorObj = new THREE.Color();

    let opacitySum = 0;
    for (let i = 0; i < instanceCount; i++) {
      const star = stars[i];

      let px, py, pz;
      if (this.mapType === 'TrueCoordinates') {
        px = star.x_coordinate;
        py = star.y_coordinate;
        pz = star.z_coordinate;
      } else {
        px = star.spherePosition?.x ?? 0;
        py = star.spherePosition?.y ?? 0;
        pz = star.spherePosition?.z ?? 0;
      }
      dummy.position.set(px, py, pz);
      dummy.scale.setScalar(star.displaySize * 0.2);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);

      // Manually update the instanceColor attribute.
      colorObj.set(star.displayColor || '#ffffff');
      instanced.instanceColor.setXYZ(i, colorObj.r, colorObj.g, colorObj.b);

      opacitySum += star.displayOpacity || 1.0;
    }
    starMaterial.opacity = opacitySum / instanceCount;

    instanced.instanceMatrix.needsUpdate = true;
    instanced.instanceColor.needsUpdate = true;

    this.instancedStars = instanced;
    this.scene.add(instanced);
    this.starObjects = stars;
  }

  /**
   * Creates connection lines.
   * For Globe maps, uses great‑circle arcs (createConnectionLines).
   * For TrueCoordinates maps, merges straight segments (mergeConnectionLines).
   */
  updateConnections(stars, connectionObjs) {
    if (this.connectionLines) {
      this.connectionLines.forEach(obj => this.scene.remove(obj));
      this.connectionLines = null;
    }
    if (!connectionObjs || connectionObjs.length === 0) return;

    if (this.mapType === 'Globe') {
      const linesArray = createConnectionLines(stars, connectionObjs, 'Globe');
      this.connectionLines = linesArray;
      linesArray.forEach(line => this.scene.add(line));
    } else {
      const merged = mergeConnectionLines(connectionObjs);
      this.scene.add(merged);
      this.connectionLines = [merged];
    }
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
// Raycasting (hover/click) for tooltips
function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  map.canvas.addEventListener('mousemove', (event) => {
    if (selectedStarData) return;
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);

    if (map.instancedStars) {
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
    }
  });

  map.canvas.addEventListener('click', (event) => {
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, map.camera);

    let clickedStar = null;
    if (map.instancedStars) {
      const intersects = raycaster.intersectObject(map.instancedStars, true);
      if (intersects.length > 0) {
        const index = intersects[0].instanceId;
        if (typeof index === 'number') {
          clickedStar = map.starObjects[index];
        }
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
  // Placeholder for any selected-star highlight logic.
  [trueCoordinatesMap, globeMap].forEach(map => {
    // no-op
  });
}

// ---------------------------------------------------------
// onload
window.onload = async () => {
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

    maxDistanceFromCenter = Math.max(
      ...cachedStars.map(s =>
        Math.sqrt(s.x_coordinate ** 2 + s.y_coordinate ** 2 + s.z_coordinate ** 2)
      )
    );

    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });

    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);

    buildAndApplyFilters();

    loader.classList.add('hidden');
  } catch (err) {
    console.error('Error initializing starmap:', err);
    alert('Initialization failed. Check console for details.');
    loader.classList.add('hidden');
  }
};

// ---------------------------------------------------------
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
 * Main function that re‑applies all filters, updates both maps, and re‑creates lines.
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

  // Ensure each star in the globe set has spherePosition.
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

  applyGlobeSurface(globeOpaqueSurface);

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
