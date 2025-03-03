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
  const R = star.Distance_from_the_Sun;
  return radToSphere(star.RA_in_radian, star.DEC_in_radian, R);
}

function projectStarGlobe(star) {
  const R = 100;
  return radToSphere(star.RA_in_radian, star.DEC_in_radian, R);
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
      points.push(radToSphere(ra, dec, R));
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

/**
 * UPDATED: Load star data from multiple files in the "data" folder.
 * Instead of loading a single "complete_data_stars.json", we load an array of files
 * (e.g. "data/Stars_0_20_LY.json", "data/Stars_20_25_LY.json", "data/Stars_35_40_LY.json")
 * and merge their contents.
 */
async function loadStarData() {
  // List all star data files that follow the naming convention in the data folder
  const starFiles = [
    'data/Stars_0_20_LY.json',
    'data/Stars_20_25_LY.json',
    'data/Stars_35_40_LY.json'
    // Add more files here as needed
  ];
  try {
    const starArrays = await Promise.all(
      starFiles.map(async file => {
        const resp = await fetch(file);
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status} loading ${file}`);
        return await resp.json();
      })
    );
    const allStars = starArrays.flat();
    console.log(`Loaded ${allStars.length} stars from ${starFiles.length} files.`);
    return allStars;
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

  // LOW DENSITY MAPPING
  if (lowDensityMapping) {
    // Reinitialize overlay if min/max distance have changed.
    if (!lowDensityOverlay ||
        lowDensityOverlay.minDistance !== parseFloat(minDistance) ||
        lowDensityOverlay.maxDistance !== parseFloat(maxDistance)) {
      if (lowDensityOverlay) {
        lowDensityOverlay.cubesData.forEach(c => {
          trueCoordinatesMap.scene.remove(c.tcMesh);
        });
        lowDensityOverlay.adjacentLines.forEach(obj => {
          globeMap.scene.remove(obj.line);
        });
      }
      lowDensityOverlay = initDensityOverlay(minDistance, maxDistance, currentFilteredStars, "low");
      lowDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      lowDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(currentFilteredStars, lowDensityOverlay);
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

  // HIGH DENSITY MAPPING
  if (highDensityMapping) {
    if (!highDensityOverlay ||
        highDensityOverlay.minDistance !== parseFloat(minDistance) ||
        highDensityOverlay.maxDistance !== parseFloat(maxDistance)) {
      if (highDensityOverlay) {
        highDensityOverlay.cubesData.forEach(c => {
          trueCoordinatesMap.scene.remove(c.tcMesh);
        });
        highDensityOverlay.adjacentLines.forEach(obj => {
          globeMap.scene.remove(obj.line);
        });
      }
      highDensityOverlay = initDensityOverlay(minDistance, maxDistance, currentFilteredStars, "high");
      highDensityOverlay.cubesData.forEach(c => {
        trueCoordinatesMap.scene.add(c.tcMesh);
      });
      highDensityOverlay.adjacentLines.forEach(obj => {
        globeMap.scene.add(obj.line);
      });
    }
    updateDensityMapping(currentFilteredStars, highDensityOverlay);
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

export { MapManager };

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

    // Compute overall maximum distance for initial setup (if needed)
    const trueCoordinates = cachedStars.map(s =>
      new THREE.Vector3(s.x_coordinate, s.y_coordinate, s.z_coordinate)
    );
    const overallMaxDistance = Math.max(...trueCoordinates.map(v => v.length()));

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
};
