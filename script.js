// script.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

import { applyFilters, setupFilterUI } from './filters/index.js';
import { createConnectionLines } from './filters/connectionsFilter.js';
import { initDensityOverlay, updateDensityMapping } from './filters/densityFilter.js';
import {
  createConstellationBoundariesForGlobe,
  createConstellationLabelsForGlobe,
  globeConstellationLines,
  globeConstellationLabels,
} from './filters/constellationFilter.js';
import { globeSurfaceOpaque } from './filters/globeSurfaceFilter.js';

import { ThreeDControls } from './cameraControls.js';
import { LabelManager } from './labelManager.js';
import { showTooltip, hideTooltip } from './tooltips.js';

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

class MapManager {
  constructor({ canvasId, mapType, projectFunction }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType;
    this.projectFunction = projectFunction;

    this.starObjects = [];
    this.connectionLines = [];
    this.scene = new THREE.Scene();
    this.labelManager = new LabelManager(mapType, this.scene);

    if (mapType === 'TrueCoordinates') {
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.canvas.clientWidth / this.canvas.clientHeight,
        0.1,
        10000
      );
      this.camera.position.set(0, 0, 70);
    } else {
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.canvas.clientWidth / this.canvas.clientHeight,
        0.1,
        10000
      );
      this.camera.position.set(0, 0, 200);
    }

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.controls = new ThreeDControls(this.camera, this.renderer.domElement);

    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(amb);
    const pt = new THREE.PointLight(0xffffff, 1);
    this.scene.add(pt);

    window.addEventListener('resize', () => this.onResize(), false);
    this.animate();
  }

  addStars(stars) {
    stars.forEach(star => {
      const sizeMult = (this.mapType === 'TrueCoordinates') ? 0.2 : 0.5;
      const adjustedSize = star.displaySize * sizeMult;
      const color = new THREE.Color(star.displayColor || '#ffffff');
      const opacity = star.displayOpacity ?? 1.0;
      let mesh;
      if (this.mapType === 'TrueCoordinates') {
        const geom = new THREE.SphereGeometry(adjustedSize, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
        mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      } else {
        const theta = star.RA_in_radian;
        const phi = (Math.PI / 2) - star.DEC_in_radian;
        const R = 100;
        const x = R * Math.sin(phi) * Math.cos(theta);
        const y = R * Math.cos(phi);
        const z = R * Math.sin(phi) * Math.sin(theta);
        star.spherePosition = { x, y, z };
        const geom = new THREE.CircleGeometry(adjustedSize, 16);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
          side: THREE.DoubleSide,
        });
        mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(x, y, z);
        const normal = new THREE.Vector3(x, y, z).normalize();
        const defaultNormal = new THREE.Vector3(0, 0, 1);
        const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, normal);
        mesh.quaternion.copy(quat);
        mesh.renderOrder = 1;
      }
      mesh.userData.star = star;
      mesh.userData.originalScale = mesh.scale.clone();
      this.scene.add(mesh);
      this.starObjects.push({ mesh, data: star });
    });
  }

  updateMap(stars, connectionObjs) {
    this.starObjects.forEach(o => {
      if (o.mesh) {
        this.scene.remove(o.mesh);
      }
    });
    this.starObjects = [];
    this.connectionLines.forEach(line => {
      if (line) this.scene.remove(line);
    });
    this.connectionLines = [];
    this.addStars(stars);
    if (connectionObjs && connectionObjs.length > 0) {
      connectionObjs.forEach(line => {
        this.scene.add(line);
        this.connectionLines.push(line);
      });
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
    let starList = (this.mapType === 'TrueCoordinates') ? currentFilteredStars : currentGlobeFilteredStars;
    this.labelManager.updateLabels(starList);
  }
}

function projectStarTrueCoordinates(star) {
  return null;
}
function projectStarGlobe(star) {
  return null;
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
    const objects = map.starObjects.map(obj => obj.mesh);
    const intersects = raycaster.intersectObjects(objects, true);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const star = intersect.object.userData.star;
      if (star) {
        showTooltip(event.clientX, event.clientY, star);
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
    const objects = map.starObjects.map(obj => obj.mesh);
    const intersects = raycaster.intersectObjects(objects, true);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const star = intersect.object.userData.star;
      if (star) {
        selectedStarData = star;
        showTooltip(event.clientX, event.clientY, star);
        updateSelectedStarHighlight();
      }
    } else {
      selectedStarData = null;
      updateSelectedStarHighlight();
      hideTooltip();
    }
  });
}

function updateSelectedStarHighlight() {
  [trueCoordinatesMap, globeMap].forEach(map => {
    map.starObjects.forEach(obj => {
      if (selectedStarData && obj.data === selectedStarData) {
        const orig = obj.mesh.userData.originalScale;
        obj.mesh.scale.copy(orig.clone().multiplyScalar(1.5));
      } else {
        obj.mesh.scale.copy(obj.mesh.userData.originalScale);
      }
    });
  });
}

window.onload = async () => {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');

  try {
    cachedStars = await loadStarData();
    if (!cachedStars.length) throw new Error('No star data available');

    await setupFilterUI(cachedStars);

    const form = document.getElementById('filters-form');
    if (form) {
      form.addEventListener('change', () => buildAndApplyFilters());

      const cSlider = document.getElementById('connection-slider');
      const cVal = document.getElementById('connection-value');
      if (cSlider && cVal) {
        cSlider.addEventListener('input', () => {
          cVal.textContent = cSlider.value;
          buildAndApplyFilters();
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
    // Attach these to window so the fullscreen exit handler can access them.
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);

    buildAndApplyFilters();

    // Density overlay: initialize only if density mapping is enabled.
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

  const linesTrue = createConnectionLines(currentFilteredStars, currentConnections, 'TrueCoordinates');
  const linesGlobe = createConnectionLines(currentGlobeFilteredStars, currentGlobeConnections, 'Globe');

  trueCoordinatesMap.updateMap(currentFilteredStars, linesTrue);
  globeMap.updateMap(currentGlobeFilteredStars, linesGlobe);

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

  // Update density mapping only if enabled.
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
