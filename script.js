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

let cachedStars = null;
let currentFilteredStars = [];
let currentConnections = [];
let currentGlobeFilteredStars = [];
let currentGlobeConnections = [];
let currentCylindricalConnections = [];

let maxDistanceFromCenter = 0;
let selectedStarData = null;

let trueCoordinatesMap;
let globeMap;
let cylindricalMap; // New cylindrical map manager

let constellationLinesGlobe = [];
let constellationLabelsGlobe = [];
let constellationOverlayGlobe = [];
let globeSurfaceSphere = null;
let lowDensityOverlay = null;
let highDensityOverlay = null;

/**
 * Helper: Convert spherical coordinates (ra, dec in radians) to a THREE.Vector3 for a given radius.
 */
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

/**
 * New: Compute the 2D cylindrical (equirectangular) projection for a star.
 * We now map:
 *   x = ((ra + π) / (2π)) * canvasWidth,
 *   y = ((dec + π/2) / π) * canvasHeight,
 * so that DEC = +90° appears at the top.
 */
function projectStarCylindrical(star, canvasWidth, canvasHeight) {
  let ra = star.RA_in_radian;
  if (ra > Math.PI) ra = ra - 2 * Math.PI;
  const dec = star.DEC_in_radian;
  const x = ((ra + Math.PI) / (2 * Math.PI)) * canvasWidth;
  const y = ((dec + Math.PI / 2) / Math.PI) * canvasHeight;
  return new THREE.Vector3(x, y, 0);
}

/**
 * Create a Globe grid for the Globe map.
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
  // Draw meridians: for every 30° of RA
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
  // Draw parallels: for every 30° of DEC
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
 * Create a grid for the cylindrical map (for reference).
 */
function createCylindricalGrid(width, height, options = {}) {
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
  // Vertical grid lines (e.g., every 30° RA)
  const numVertical = 12;
  for (let i = 0; i <= numVertical; i++) {
    const x = (i / numVertical) * width;
    const points = [new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, height, 0)];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }
  // Horizontal grid lines (for DEC)
  const numHorizontal = 6;
  for (let j = 0; j <= numHorizontal; j++) {
    const y = (j / numHorizontal) * height;
    const points = [new THREE.Vector3(0, y, 0), new THREE.Vector3(width, y, 0)];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    gridGroup.add(line);
  }
  return gridGroup;
}

// Existing MapManager for 3D maps (True Coordinates & Globe)
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
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
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

// New: CylindricalMapManager for the 2D cylindrical (equirectangular) projection.
class CylindricalMapManager {
  constructor({ canvasId, mapType }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType; // Should be 'Cylindrical'
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    // Set up an orthographic camera with (0,0) at the top-left.
    // This ensures that a computed position (x,y) where y=0 is at the top.
    this.camera = new THREE.OrthographicCamera(0, width, height, 0, -1000, 1000);
    this.camera.position.set(0, 0, 1);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    this.scene.add(this.camera);

    this.starGroup = new THREE.Group();
    this.scene.add(this.starGroup);

    this.connectionGroup = new THREE.Group();
    this.scene.add(this.connectionGroup);

    window.addEventListener('resize', () => this.onResize(), false);
    this.animate();
  }

  addStars(stars) {
    while (this.starGroup.children.length > 0) {
      const child = this.starGroup.children[0];
      this.starGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    stars.forEach(star => {
      let pos = star.cylindricalPosition;
      if (!pos) {
        pos = projectStarCylindrical(star, cw, ch);
      }
      const size = star.displaySize || 1;
      const circleGeom = new THREE.CircleGeometry(size * 1.0, 16);
      const material = new THREE.MeshBasicMaterial({
        color: star.displayColor || '#ffffff',
        transparent: true,
        opacity: 1.0
      });
      const starMesh = new THREE.Mesh(circleGeom, material);
      starMesh.position.copy(pos);
      this.starGroup.add(starMesh);
    });
  }

  updateConnections(stars, connectionObjs) {
    while (this.connectionGroup.children.length > 0) {
      const child = this.connectionGroup.children[0];
      this.connectionGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    if (!connectionObjs || connectionObjs.length === 0) return;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    connectionObjs.forEach(pair => {
      const starA = pair.starA;
      const starB = pair.starB;
      const posA = starA.cylindricalPosition || projectStarCylindrical(starA, cw, ch);
      const posB = starB.cylindricalPosition || projectStarCylindrical(starB, cw, ch);
      const geometry = new THREE.BufferGeometry().setFromPoints([posA, posB]);
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(starA.displayColor || '#ffffff'),
        transparent: true,
        opacity: 0.5,
        linewidth: 1
      });
      const line = new THREE.Line(geometry, material);
      this.connectionGroup.add(line);
    });
  }

  updateMap(stars, connectionObjs) {
    this.addStars(stars);
    this.updateConnections(stars, connectionObjs);
  }

  onResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }
}

// Optional: Initialize interactions for 3D maps (for the 2D cylindrical map, similar interaction logic can be added if needed)
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
      updateSelectedStarHighlight();
    } else {
      selectedStarData = null;
      updateSelectedStarHighlight();
      hideTooltip();
    }
  });
}

function updateSelectedStarHighlight() {
  // Optional: implement highlighting if desired.
}

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
    }

    maxDistanceFromCenter = Math.max(
      ...cachedStars.map(s =>
        Math.sqrt(s.x_coordinate ** 2 + s.y_coordinate ** 2 + s.z_coordinate ** 2)
      )
    );

    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });
    cylindricalMap = new CylindricalMapManager({ canvasId: 'cylindricalMap', mapType: 'Cylindrical' });
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;
    window.cylindricalMap = cylindricalMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);
    // For the cylindrical map, interactions can be added if desired.

    cachedStars.forEach(star => {
      star.spherePosition = projectStarGlobe(star);
      star.truePosition = getStarTruePosition(star);
    });

    const globeGrid = createGlobeGrid(100, { color: 0x444444, opacity: 0.2, lineWidth: 1 });
    globeMap.scene.add(globeGrid);

    // Optional: Add a grid to the cylindrical map
    const cylGrid = createCylindricalGrid(cylindricalMap.canvas.clientWidth, cylindricalMap.canvas.clientHeight, { color: 0x444444, opacity: 0.2, lineWidth: 1 });
    cylindricalMap.scene.add(cylGrid);

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

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => { func.apply(this, args); }, wait);
  };
}

function getCurrentFilters() {
  const form = document.getElementById('filters-form');
  if (!form) return { enableConnections: false, lowDensityMapping: false, highDensityMapping: false };
  const formData = new FormData(form);
  return {
    enableConnections: (formData.get('enable-connections') !== null),
    lowDensityMapping: (formData.get('enable-low-density-mapping') !== null),
    highDensityMapping: (formData.get('enable-high-density-mapping') !== null)
  };
}

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
    lowDensityMapping,
    highDensityMapping,
    lowDensity,
    lowTolerance,
    highDensity: highIsolation,
    highTolerance
  } = applyFilters(cachedStars);

  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;
  currentCylindricalConnections = connections; // Reuse connection data

  currentGlobeFilteredStars.forEach(star => {
    star.spherePosition = projectStarGlobe(star);
  });
  currentFilteredStars.forEach(star => {
    star.truePosition = getStarTruePosition(star);
  });
  currentFilteredStars.forEach(star => {
    const cw = cylindricalMap.canvas.clientWidth;
    const ch = cylindricalMap.canvas.clientHeight;
    star.cylindricalPosition = projectStarCylindrical(star, cw, ch);
  });

  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  trueCoordinatesMap.labelManager.refreshLabels(currentFilteredStars);
  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  globeMap.labelManager.refreshLabels(currentGlobeFilteredStars);
  cylindricalMap.updateMap(currentFilteredStars, currentCylindricalConnections);

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

  // LOW DENSITY MAPPING
  if (lowDensityMapping) {
    if (!lowDensityOverlay) {
      lowDensityOverlay = initDensityOverlay(maxDistanceFromCenter, currentFilteredStars, "low");
      lowDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      lowDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(currentFilteredStars, lowDensityOverlay);
    lowDensityOverlay.assignConstellationsToCells().then(() => {
      lowDensityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
      lowDensityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      console.log("=== DEBUG: Low Density cluster distribution ===");
    });
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

  // HIGH DENSITY MAPPING
  if (highDensityMapping) {
    if (!highDensityOverlay) {
      highDensityOverlay = initDensityOverlay(maxDistanceFromCenter, currentFilteredStars, "high");
      highDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      highDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(currentFilteredStars, highDensityOverlay);
    highDensityOverlay.assignConstellationsToCells().then(() => {
      highDensityOverlay.addRegionLabelsToScene(trueCoordinatesMap.scene, 'TrueCoordinates');
      highDensityOverlay.addRegionLabelsToScene(globeMap.scene, 'Globe');
      console.log("=== DEBUG: High Density cluster distribution ===");
    });
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

export { MapManager };
