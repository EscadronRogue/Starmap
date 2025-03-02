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

/* ---------------------------------------------------------
   Global variables
--------------------------------------------------------- */
let cachedStars = null;
let currentFilteredStars = [];
let currentConnections = [];
let currentGlobeFilteredStars = [];
let currentGlobeConnections = [];

let maxDistanceFromCenter = 0;
let selectedStarData = null;

let trueCoordinatesMap;
let globeMap;
// NEW:
let mollweideMap;

let constellationLinesGlobe = [];
let constellationLabelsGlobe = [];
let constellationOverlayGlobe = [];
let globeSurfaceSphere = null;
let densityOverlay = null;

/* ---------------------------------------------------------
   Utility: RA/DEC -> sphere
--------------------------------------------------------- */
function radToSphere(ra, dec, R) {
  return new THREE.Vector3(
    -R * Math.cos(dec) * Math.cos(ra),
     R * Math.sin(dec),
    -R * Math.cos(dec) * Math.sin(ra)
  );
}

function getStarTruePosition(star) {
  const R = star.Distance_from_the_Sun;
  return radToSphere(star.RA_in_radian, star.DEC_in_radian, R);
}

function projectStarGlobe(star) {
  const R = 100;
  return radToSphere(star.RA_in_radian, star.DEC_in_radian, R);
}

/* ---------------------------------------------------------
   MOLLWEIDE PROJECTION (NEW)
--------------------------------------------------------- */
/**
 * Mollweide projection equations:
 *  We solve for theta such that 2theta + sin(2theta) = π * sin(dec).
 *  Then:
 *    x =  (2√2 / π) * (ra - λ0) * cos(theta)
 *    y =  √2 * sin(theta)
 *  Here we choose λ0 = 0 for the central meridian (ra center).
 *
 *  This function returns a {x, y} that typically covers x in [-2√2, 2√2], y in [-√2, √2].
 *  We'll store them in star.mollweidePosition as a Vector3(x, y, 0).
 */
function projectStarMollweide(star) {
  const ra = star.RA_in_radian;   // range [0..2π], or we can shift to [-π..π]
  const dec = star.DEC_in_radian; // range [-π/2..π/2]

  // Shift RA to be in [-π..π] so that the "center" is RA=0
  let lam = ra;
  if (lam > Math.PI) lam -= 2 * Math.PI;  // shift to [-π..π]

  // We want to solve 2theta + sin(2theta) = π sin(dec).
  const target = Math.PI * Math.sin(dec);
  let theta = dec; // an initial guess
  // We'll do a small iteration (Newton or secant).
  for (let i = 0; i < 10; i++) {
    const f  = 2 * theta + Math.sin(2 * theta) - target;
    const fp = 2 + 2 * Math.cos(2 * theta);
    theta -= f / fp;
  }

  const sqrt2 = Math.sqrt(2);
  const x = (2 * sqrt2 / Math.PI) * lam * Math.cos(theta);
  const y = sqrt2 * Math.sin(theta);

  // We'll place them in a Vector3 for convenience, z=0
  return new THREE.Vector3(x, y, 0);
}

/* ---------------------------------------------------------
   Optional helper: Create a globe "grid" of RA/DEC lines
--------------------------------------------------------- */
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
  // RA lines
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
  // DEC lines
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

/* ---------------------------------------------------------
   Main Map Manager for 3D and specialized 2D
--------------------------------------------------------- */
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

    if (mapType === 'Mollweide') {
      // Use an orthographic camera that can show x in [-3..3], y in [-2..2], etc.
      // We can adjust scale to get a decent fit on the canvas.
      // We might want more space if many stars, so we set some bounds:
      const left   = -3.0;
      const right  =  3.0;
      const top    =  2.0;
      const bottom = -2.0;
      this.camera = new THREE.OrthographicCamera(left, right, top, bottom, 1, 1000);
      // Position camera out of plane, looking at origin
      this.camera.position.set(0, 0, 10);
      this.camera.lookAt(new THREE.Vector3(0,0,0));
    } else if (mapType === 'TrueCoordinates') {
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.canvas.clientWidth / this.canvas.clientHeight,
        0.1,
        10000
      );
      this.camera.position.set(0, 0, 70);
      this.camera.lookAt(0, 0, 0);
    } else {
      // mapType === 'Globe'
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.canvas.clientWidth / this.canvas.clientHeight,
        0.1,
        10000
      );
      this.camera.position.set(0, 0, 200);
      this.camera.lookAt(0, 0, 0);
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
    // Remove old star objects
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
      } else if (this.mapType === 'Globe') {
        pos = star.spherePosition || new THREE.Vector3(0, 0, 0);
      } else {
        // Mollweide:
        pos = star.mollweidePosition || new THREE.Vector3(0, 0, 0);
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
    } else if (this.mapType === 'TrueCoordinates') {
      const merged = mergeConnectionLines(connectionObjs);
      this.connectionGroup.add(merged);
    } else {
      // Mollweide – for demonstration, just do a simple line between the 2D points:
      const positions = [];
      const colors = [];
      connectionObjs.forEach(pair => {
        const { starA, starB } = pair;
        const cA = new THREE.Color(starA.displayColor || '#ffffff');
        const cB = new THREE.Color(starB.displayColor || '#ffffff');
        // Use their mollweide positions
        const posA = starA.mollweidePosition || new THREE.Vector3();
        const posB = starB.mollweidePosition || new THREE.Vector3();
        positions.push(posA.x, posA.y, posA.z);
        positions.push(posB.x, posB.y, posB.z);
        colors.push(cA.r, cA.g, cA.b);
        colors.push(cB.r, cB.g, cB.b);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        linewidth: 1
      });
      const lines = new THREE.LineSegments(geometry, mat);
      this.connectionGroup.add(lines);
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

    if (this.mapType === 'Mollweide') {
      // Maintain aspect in the orthographic camera
      // We scale the left,right,top,bottom by the aspect ratio
      const aspect = w / h;
      // If we originally had:
      //   left=-3, right=3 => total width=6
      //   top=2, bottom=-2 => total height=4
      // We can keep the vertical size fixed, and scale horizontal:
      const halfH = 2; // from original top=2
      const halfW = halfH * aspect; // e.g. 2 * aspect
      this.camera.left   = -halfW;
      this.camera.right  =  halfW;
      this.camera.top    =  halfH;
      this.camera.bottom = -halfH;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    } else {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // If we want to tweak overlay rendering order for the Globe:
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
    // Render
    this.renderer.render(this.scene, this.camera);
  }
}

/* ---------------------------------------------------------
   Mouse interactions (tooltip)
--------------------------------------------------------- */
function initStarInteractions(map) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  map.canvas.addEventListener('mousemove', (event) => {
    if (selectedStarData) return;
    const rect = map.canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // For Mollweide, the star is in z=0 plane, but we can still pick them with raycaster + OrthographicCamera
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
      updateSelectedStarHighlight();
    } else {
      selectedStarData = null;
      updateSelectedStarHighlight();
      hideTooltip();
    }
  });
}

function updateSelectedStarHighlight() {
  // Placeholder: implement highlighting if desired
}

/* ---------------------------------------------------------
   Main onload
--------------------------------------------------------- */
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
        Math.sqrt(s.x_coordinate**2 + s.y_coordinate**2 + s.z_coordinate**2)
      )
    );

    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });
    // NEW: Mollweide map
    mollweideMap = new MapManager({ canvasId: 'mollweideMap', mapType: 'Mollweide' });

    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;
    window.mollweideMap = mollweideMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);
    initStarInteractions(mollweideMap);

    // Set star positions for each type of map
    cachedStars.forEach(star => {
      star.spherePosition     = projectStarGlobe(star);
      star.truePosition       = getStarTruePosition(star);
      star.mollweidePosition  = projectStarMollweide(star);
    });

    // Optional: Add globe grid overlay
    const globeGrid = createGlobeGrid(100, { color: 0x444444, opacity: 0.2, lineWidth: 1 });
    globeMap.scene.add(globeGrid);

    buildAndApplyFilters(); // Initial filter application

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
 * Main filter application function.
 */
async function buildAndApplyFilters() {
  if (!cachedStars) return;
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
    enableDensityMapping
  } = applyFilters(cachedStars);

  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;

  // Update star positions
  currentGlobeFilteredStars.forEach(star => {
    star.spherePosition = projectStarGlobe(star);
  });
  currentFilteredStars.forEach(star => {
    star.truePosition = getStarTruePosition(star);
  });
  // Also recalc Mollweide positions, in case filters changed size/color – but typically RA/DEC doesn't change:
  filteredStars.forEach(star => {
    star.mollweidePosition = projectStarMollweide(star);
  });

  // Update maps
  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  trueCoordinatesMap.labelManager.refreshLabels(currentFilteredStars);

  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  globeMap.labelManager.refreshLabels(currentGlobeFilteredStars);

  // NEW: update Mollweide map with all (because the filter for "which" might be the same as the globe)
  mollweideMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  mollweideMap.labelManager.refreshLabels(currentGlobeFilteredStars);

  // Remove previous constellation objects
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
    // You could add code to generate or show a polygon overlay here
  }

  if (enableDensityMapping) {
    if (!densityOverlay) {
      densityOverlay = initDensityOverlay(maxDistanceFromCenter, currentFilteredStars);
      densityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      densityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(currentFilteredStars);
    densityOverlay.assignConstellationsToCells().then(() => {
      densityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
      densityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      console.log("=== DEBUG: Checking cluster distribution after assignment ===");
      debugClusterData();
    });
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

  applyGlobeSurface(globeOpaqueSurface);
}

function debugClusterData() {
  if (!densityOverlay) return;
  const regions = densityOverlay.classifyEmptyRegions();
  regions.forEach((reg, idx) => {
    console.log(
      `Cluster #${idx} => Type: ${reg.type}, Label: ${reg.label}, Constellation: ${reg.constName}`
    );
    const cellIDs = reg.cells.map(c => `ID${c.id}:${c.constellation}`);
    console.log(`Cells: [${cellIDs.join(", ")}]`);
  });
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

/**
 * Toggle opaque or transparent globe surface.
 */
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

export { MapManager };
