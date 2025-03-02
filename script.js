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

let maxDistanceFromCenter = 0;
let selectedStarData = null;

let trueCoordinatesMap;
let globeMap;
let cylindricalMap; // New map for cylindrical projection

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

function projectStarCylindrical(star) {
  // Cylindrical equidistant (plate carrée) projection:
  // x = scale * (RA - PI)
  // y = scale * DEC
  const scale = 100; // adjust scale as needed
  const x = scale * (star.RA_in_radian - Math.PI);
  const y = scale * star.DEC_in_radian;
  return new THREE.Vector3(x, y, 0);
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

    if (this.mapType === 'Cylindrical') {
      // For a flat 2D view, use an orthographic camera.
      const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      const frustumSize = 400;
      this.camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
         frustumSize * aspect / 2,
         frustumSize / 2,
        -frustumSize / 2,
        -1000,
         1000
      );
      this.camera.position.set(0, 0, 1);
      this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    } else {
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.canvas.clientWidth / this.canvas.clientHeight,
        0.1,
        10000
      );
      if (this.mapType === 'TrueCoordinates') {
        this.camera.position.set(0, 0, 70);
      } else {
        this.camera.position.set(0, 0, 200);
      }
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
      let starMesh;
      if (this.mapType === 'Cylindrical') {
        const geometry = new THREE.CircleGeometry(size * 0.2, 12);
        const material = new THREE.MeshBasicMaterial({
          color: star.displayColor || '#ffffff',
          transparent: true,
          opacity: 1.0
        });
        starMesh = new THREE.Mesh(geometry, material);
        let pos = star.cylindricalPosition ? new THREE.Vector3(star.cylindricalPosition.x, star.cylindricalPosition.y, 0) : new THREE.Vector3(0,0,0);
        starMesh.position.copy(pos);
      } else {
        const sphereGeometry = new THREE.SphereGeometry(size * 0.2, 12, 12);
        const material = new THREE.MeshBasicMaterial({
          color: star.displayColor || '#ffffff',
          transparent: true,
          opacity: 1.0
        });
        starMesh = new THREE.Mesh(sphereGeometry, material);
        if (this.mapType === 'TrueCoordinates') {
          let pos = star.truePosition ? star.truePosition.clone() : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
          starMesh.position.copy(pos);
        } else {
          let pos = star.spherePosition || new THREE.Vector3(0, 0, 0);
          starMesh.position.copy(pos);
        }
      }
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
    if (this.mapType === 'Globe' || this.mapType === 'TrueCoordinates') {
      if (this.mapType === 'Globe') {
        const linesArray = createConnectionLines(stars, connectionObjs, 'Globe');
        linesArray.forEach(line => this.connectionGroup.add(line));
      } else {
        const merged = mergeConnectionLines(connectionObjs);
        this.connectionGroup.add(merged);
      }
    } else if (this.mapType === 'Cylindrical') {
      // For 2D, simply draw straight lines between the cylindrical positions.
      const positions = [];
      const colors = [];
      connectionObjs.forEach(pair => {
        const posA = starPositionCylindrical(pair.starA);
        const posB = starPositionCylindrical(pair.starB);
        positions.push(posA.x, posA.y, 0);
        positions.push(posB.x, posB.y, 0);
        const cA = new THREE.Color(pair.starA.displayColor || '#ffffff');
        const cB = new THREE.Color(pair.starB.displayColor || '#ffffff');
        colors.push(cA.r, cA.g, cA.b);
        colors.push(cB.r, cB.g, cB.b);
      });
      if (positions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.5
        });
        const lines = new THREE.LineSegments(geometry, material);
        this.connectionGroup.add(lines);
      }
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
    if (this.mapType === 'Cylindrical') {
      const aspect = w / h;
      const frustumSize = 400;
      this.camera.left = -frustumSize * aspect / 2;
      this.camera.right = frustumSize * aspect / 2;
      this.camera.top = frustumSize / 2;
      this.camera.bottom = -frustumSize / 2;
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }
}

function starPositionCylindrical(star) {
  return star.cylindricalPosition ? new THREE.Vector3(star.cylindricalPosition.x, star.cylindricalPosition.y, 0) : new THREE.Vector3(0,0,0);
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
        Math.sqrt(s.x_coordinate**2 + s.y_coordinate**2 + s.z_coordinate**2)
      )
    );

    trueCoordinatesMap = new MapManager({ canvasId: 'map3D', mapType: 'TrueCoordinates' });
    globeMap = new MapManager({ canvasId: 'sphereMap', mapType: 'Globe' });
    cylindricalMap = new MapManager({ canvasId: 'cylindricalMap', mapType: 'Cylindrical' });
    window.trueCoordinatesMap = trueCoordinatesMap;
    window.globeMap = globeMap;
    window.cylindricalMap = cylindricalMap;

    initStarInteractions(trueCoordinatesMap);
    initStarInteractions(globeMap);
    initStarInteractions(cylindricalMap);

    cachedStars.forEach(star => {
      star.spherePosition = projectStarGlobe(star);
      star.truePosition = getStarTruePosition(star);
      star.cylindricalPosition = projectStarCylindrical(star);
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

  currentGlobeFilteredStars.forEach(star => {
    star.spherePosition = projectStarGlobe(star);
  });
  currentFilteredStars.forEach(star => {
    star.truePosition = getStarTruePosition(star);
    star.cylindricalPosition = projectStarCylindrical(star);
  });

  trueCoordinatesMap.updateMap(currentFilteredStars, currentConnections);
  trueCoordinatesMap.labelManager.refreshLabels(currentFilteredStars);
  globeMap.updateMap(currentGlobeFilteredStars, currentGlobeConnections);
  globeMap.labelManager.refreshLabels(currentGlobeFilteredStars);
  cylindricalMap.updateMap(currentFilteredStars, currentConnections);
  cylindricalMap.labelManager.refreshLabels(currentFilteredStars);

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
