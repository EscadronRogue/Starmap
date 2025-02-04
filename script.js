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

// Global references
let cachedStars = null;
let currentFilteredStars = [];
let currentConnections = [];
let currentGlobeFilteredStars = [];
let currentGlobeConnections = [];

let maxDistanceFromCenter = 0;

// TrueCoordinates map
let trueCoordinatesMap;
// Globe map
let globeMap;

// For globe
let constellationLinesGlobe = [];
let constellationLabelsGlobe = [];

// Opaque sphere
let globeSurfaceSphere = null;

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
 * MapManager class
 * Creates two 3D scenes: one for TrueCoordinates, one for Globe.
 * Uses the LabelManager to add 3D sprite labels.
 */
class MapManager {
  constructor({ canvasId, mapType, projectFunction }) {
    this.canvas = document.getElementById(canvasId);
    this.mapType = mapType;
    this.projectFunction = projectFunction;

    // Instead of storing many individual star meshes, we use an instanced mesh.
    this.starObjects = [];
    this.connectionLines = [];

    // Create a THREE scene
    this.scene = new THREE.Scene();

    // Use the label manager that places 3D sprite labels in the scene
    this.labelManager = new LabelManager(mapType, this.scene);

    // Setup camera
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

    // Setup renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Setup controls
    this.controls = new ThreeDControls(this.camera, this.renderer.domElement);

    // Basic lighting
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(amb);
    const pt = new THREE.PointLight(0xffffff, 1);
    this.scene.add(pt);

    window.addEventListener('resize', () => this.onResize(), false);

    this.animate();
  }

  /**
   * Builds a single InstancedMesh for all stars.
   * After setting each instance’s matrix and color, we mark the instanceMatrix and instanceColor as needing an update.
   * For the Globe map, if star.RA_in_radian and star.DEC_in_radian aren’t available, we use a fallback
   * based on the star’s existing x/y/z coordinates.
   */
  addStars(stars) {
    const count = stars.length;
    const geometry = new THREE.SphereGeometry(1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const star = stars[i];
      const sizeMult = (this.mapType === 'TrueCoordinates') ? 0.2 : 0.5;
      const adjustedSize = star.displaySize * sizeMult;
      dummy.scale.set(adjustedSize, adjustedSize, adjustedSize);

      if (this.mapType === 'TrueCoordinates') {
        dummy.position.set(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      } else {
        // For Globe, use RA/DEC if available; otherwise, fallback to computing from x,y,z.
        let theta, phi;
        if (star.RA_in_radian !== undefined && star.DEC_in_radian !== undefined) {
          theta = star.RA_in_radian;
          phi = (Math.PI / 2) - star.DEC_in_radian;
        } else {
          const r = Math.sqrt(star.x_coordinate ** 2 + star.y_coordinate ** 2 + star.z_coordinate ** 2);
          theta = Math.atan2(star.z_coordinate, star.x_coordinate);
          phi = Math.acos(star.y_coordinate / r);
        }
        const R = 100;
        const x = R * Math.sin(phi) * Math.cos(theta);
        const y = R * Math.cos(phi);
        const z = R * Math.sin(phi) * Math.sin(theta);
        dummy.position.set(x, y, z);
        star.spherePosition = { x, y, z };
      }
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);

      const color = new THREE.Color(star.displayColor || '#ffffff');
      instancedMesh.setColorAt(i, color);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    if (this.starObjects.length > 0) {
      this.starObjects.forEach(obj => this.scene.remove(obj));
    }
    this.scene.add(instancedMesh);
    this.starObjects = [instancedMesh];
  }

  updateMap(stars, connectionObjs) {
    // Remove previous star objects and connection lines.
    this.starObjects.forEach(obj => {
      if (obj) this.scene.remove(obj);
    });
    this.starObjects = [];

    this.connectionLines.forEach(line => {
      if (line) this.scene.remove(line);
    });
    this.connectionLines = [];

    // Add new stars via the instanced mesh.
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

    // Update labels (throttled inside LabelManager).
    const starList = (this.mapType === 'TrueCoordinates') ? currentFilteredStars : currentGlobeFilteredStars;
    this.labelManager.updateLabels(starList);
  }
}

function projectStarTrueCoordinates(star) {
  return null;
}
function projectStarGlobe(star) {
  return null;
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
          updateDensityMapping(currentFilteredStars);
        });
      }

      const tSlider = document.getElementById('tolerance-slider');
      const tVal = document.getElementById('tolerance-value');
      if (tSlider && tVal) {
        tSlider.addEventListener('input', () => {
          tVal.textContent = tSlider.value;
          updateDensityMapping(currentFilteredStars);
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

    buildAndApplyFilters();

    const cubes = initDensityOverlay(maxDistanceFromCenter, currentFilteredStars);
    cubes.forEach(c => {
      trueCoordinatesMap.scene.add(c.tcMesh);
      globeMap.scene.add(c.globeMesh);
    });
    updateDensityMapping(currentFilteredStars);
  } catch (err) {
    console.error('Error initializing starmap:', err);
    alert('Initialization of starmap failed. Please check console.');
  } finally {
    loader.classList.add('hidden');
  }
};

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
  } = applyFilters(cachedStars);

  currentFilteredStars = filteredStars;
  currentConnections = connections;
  currentGlobeFilteredStars = globeFilteredStars;
  currentGlobeConnections = globeConnections;

  const linesTrue = createConnectionLines(currentFilteredStars, currentConnections, 'TrueCoordinates');
  const linesGlobe = createConnectionLines(currentGlobeFilteredStars, globeConnections, 'Globe');

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

  updateDensityMapping(currentFilteredStars);
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

/**
 * Creates or removes a black sphere of radius=100 with front side rendering.
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
    globeMap.scene.add(globeSurfaceSphere);
  }
}
