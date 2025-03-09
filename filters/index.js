// /filters/index.js

import { loadStellarClassData } from './stellarClassData.js';
import { applySizeFilter } from './sizeFilter.js';
import { applyColorFilter } from './colorFilter.js';
import { applyOpacityFilter } from './opacityFilter.js';
import { applyStarsShownFilter } from './starsShownFilter.js';
import { computeConnectionPairs } from './connectionsFilter.js';
import { applyStellarClassLogic, generateStellarClassFilters as scGenerate } from './stellarClassFilter.js';
import { loadConstellationBoundaries, loadConstellationCenters } from './constellationFilter.js';
import { applyGlobeSurfaceFilter } from './globeSurfaceFilter.js';
import { createConstellationOverlayForGlobe } from './constellationOverlayFilter.js';
import { applyDistanceFilter } from './distanceFilter.js';

// Import the new Isolation and Density Filter modules.
import { initIsolationFilter, updateIsolationFilter } from './isolationFilter.js';
import { initDensityFilter, updateDensityFilter } from './densityFilter.js';

let filterForm = null;

export async function setupFilterUI(allStars) {
  filterForm = document.getElementById('filters-form');
  if (!filterForm) {
    console.warn('[setupFilterUI] No #filters-form found in DOM!');
    return;
  }
  loadStellarClassData();
  scGenerate(allStars);
  const mainLegends = filterForm.querySelectorAll('legend.collapsible');
  mainLegends.forEach(legend => {
    const fc = legend.nextElementSibling;
    if (fc) fc.style.maxHeight = '0px';
    legend.addEventListener('click', () => {
      legend.classList.toggle('active');
      const isActive = legend.classList.contains('active');
      legend.setAttribute('aria-expanded', isActive);
      if (fc) fc.style.maxHeight = isActive ? fc.scrollHeight + 'px' : '0px';
    });
  });
  addConstellationsFieldset();
  addGlobeSurfaceFieldset();
  // Clouds fieldset is added in the UI file.
  await loadConstellationBoundaries();
  await loadConstellationCenters();
}

function addConstellationsFieldset() {
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.classList.add('collapsible');
  legend.textContent = 'Constellations';
  fs.appendChild(legend);
  const contentDiv = document.createElement('div');
  contentDiv.classList.add('filter-content', 'scrollable-category');
  contentDiv.style.maxHeight = '0px';
  legend.addEventListener('click', () => {
    legend.classList.toggle('active');
    const isActive = legend.classList.contains('active');
    legend.setAttribute('aria-expanded', isActive);
    contentDiv.style.maxHeight = isActive ? contentDiv.scrollHeight + 'px' : '0px';
  });
  const boundaryDiv = document.createElement('div');
  boundaryDiv.classList.add('filter-item');
  const boundaryChk = document.createElement('input');
  boundaryChk.type = 'checkbox';
  boundaryChk.id = 'show-constellation-boundaries';
  boundaryChk.name = 'show-constellation-boundaries';
  boundaryChk.checked = true;
  const boundaryLbl = document.createElement('label');
  boundaryLbl.htmlFor = 'show-constellation-boundaries';
  boundaryLbl.textContent = 'Show Constellation Boundaries';
  boundaryDiv.appendChild(boundaryChk);
  boundaryDiv.appendChild(boundaryLbl);
  contentDiv.appendChild(boundaryDiv);
  const namesDiv = document.createElement('div');
  namesDiv.classList.add('filter-item');
  const namesChk = document.createElement('input');
  namesChk.type = 'checkbox';
  namesChk.id = 'show-constellation-names';
  namesChk.name = 'show-constellation-names';
  namesChk.checked = true;
  const namesLbl = document.createElement('label');
  namesLbl.htmlFor = 'show-constellation-names';
  namesLbl.textContent = 'Show Constellation Names';
  namesDiv.appendChild(namesChk);
  namesDiv.appendChild(namesLbl);
  contentDiv.appendChild(namesDiv);
  const overlayDiv = document.createElement('div');
  overlayDiv.classList.add('filter-item');
  const overlayChk = document.createElement('input');
  overlayChk.type = 'checkbox';
  overlayChk.id = 'show-constellation-overlay';
  overlayChk.name = 'show-constellation-overlay';
  overlayChk.checked = false;
  const overlayLbl = document.createElement('label');
  overlayLbl.htmlFor = 'show-constellation-overlay';
  overlayLbl.textContent = 'Show Constellation Overlays';
  overlayDiv.appendChild(overlayChk);
  overlayDiv.appendChild(overlayLbl);
  contentDiv.appendChild(overlayDiv);
  fs.appendChild(contentDiv);
  filterForm.appendChild(fs);
}

function addGlobeSurfaceFieldset() {
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.classList.add('collapsible');
  legend.textContent = 'Globe Surface';
  fs.appendChild(legend);
  const contentDiv = document.createElement('div');
  contentDiv.classList.add('filter-content');
  contentDiv.style.maxHeight = '0px';
  legend.addEventListener('click', () => {
    legend.classList.toggle('active');
    const isActive = legend.classList.contains('active');
    legend.setAttribute('aria-expanded', isActive);
    contentDiv.style.maxHeight = isActive ? contentDiv.scrollHeight + 'px' : '0px';
  });
  const surfDiv = document.createElement('div');
  surfDiv.classList.add('filter-item');
  const surfChk = document.createElement('input');
  surfChk.type = 'checkbox';
  surfChk.id = 'globe-opaque-surface';
  surfChk.name = 'globe-opaque-surface';
  surfChk.checked = true;
  const surfLbl = document.createElement('label');
  surfLbl.htmlFor = 'globe-opaque-surface';
  surfLbl.textContent = 'Opaque Globe Surface';
  surfDiv.appendChild(surfChk);
  surfDiv.appendChild(surfLbl);
  contentDiv.appendChild(surfDiv);
  fs.appendChild(contentDiv);
  filterForm.appendChild(fs);
}

export function applyFilters(allStars) {
  if (!filterForm) {
    filterForm = document.getElementById('filters-form');
    if (!filterForm) {
      return {
        filteredStars: allStars,
        connections: [],
        globeFilteredStars: allStars,
        globeConnections: [],
        showConstellationBoundaries: false,
        showConstellationNames: false,
        showConstellationOverlay: false,
        globeOpaqueSurface: false,
        enableConnections: false,
        enableIsolationFilter: false,
        enableDensityFilter: false,
        isolation: 7,
        isolationTolerance: 0,
        densityThresholdStars: 5,
        enableIsolationLabeling: false,
        enableDensityLabeling: false,
        minDistance: 0,
        maxDistance: 20,
        isolationGridSize: 0,
        densityGridSize: 0,
        showClouds: false
      };
    }
  }
  const formData = new FormData(filterForm);
  const filters = {
    size: formData.get('size'),
    color: formData.get('color'),
    opacity: formData.get('opacity'),
    starsShown: formData.get('stars-shown'),
    connections: parseFloat(formData.get('connections')) || 7,
    showConstellationBoundaries: (formData.get('show-constellation-boundaries') !== null),
    showConstellationNames: (formData.get('show-constellation-names') !== null),
    showConstellationOverlay: (formData.get('show-constellation-overlay') !== null),
    globeOpaqueSurface: (formData.get('globe-opaque-surface') !== null),
    enableConnections: (formData.get('enable-connections') !== null),
    enableIsolationFilter: (formData.get('enable-isolation-filter') !== null),
    enableDensityFilter: (formData.get('enable-density-filter') !== null),
    isolation: parseFloat(formData.get('isolation')) || 7,
    isolationTolerance: parseInt(formData.get('isolation-tolerance')) || 0,
    densityThresholdStars: parseFloat(formData.get('density-subdivision-percent')) || 5,
    enableIsolationLabeling: (formData.get('enable-isolation-labeling') !== null),
    enableDensityLabeling: (formData.get('enable-density-labeling') !== null),
    minDistance: formData.get('min-distance'),
    maxDistance: formData.get('max-distance'),
    isolationGridSize: parseFloat(formData.get('isolation-grid-size')) || 0,
    densityGridSize: parseFloat(formData.get('density-grid-size')) || 0,
    showClouds: (formData.get('enable-clouds') !== null)
  };

  let filteredStars = applyDistanceFilter(allStars, filters);
  filteredStars = applyStarsShownFilter(filteredStars, filters);
  filteredStars = applyStellarClassLogic(filteredStars, filterForm);
  filteredStars = applySizeFilter(filteredStars, filters);
  filteredStars = applyColorFilter(filteredStars, filters);
  filteredStars = applyOpacityFilter(filteredStars, filters);

  const globeFiltered = filteredStars.filter(s => s.Common_name_of_the_star !== 'Sol');
  let pairs = [];
  let globePairs = [];
  if (filters.enableConnections) {
    pairs = computeConnectionPairs(filteredStars, filters.connections);
    globePairs = computeConnectionPairs(globeFiltered, filters.connections);
  }

  applyGlobeSurfaceFilter(filters);

  if (filters.showConstellationOverlay) {
    const constellationOverlay = createConstellationOverlayForGlobe();
    constellationOverlay.forEach(mesh => {
      window.globeMap.scene.add(mesh);
    });
  }

  return {
    filteredStars,
    connections: pairs,
    globeFilteredStars: globeFiltered,
    globeConnections: globePairs,
    showConstellationBoundaries: filters.showConstellationBoundaries,
    showConstellationNames: filters.showConstellationNames,
    showConstellationOverlay: filters.showConstellationOverlay,
    globeOpaqueSurface: filters.globeOpaqueSurface,
    enableConnections: filters.enableConnections,
    enableIsolationFilter: filters.enableIsolationFilter,
    enableDensityFilter: filters.enableDensityFilter,
    isolation: filters.isolation,
    isolationTolerance: filters.isolationTolerance,
    densityThresholdStars: filters.densityThresholdStars,
    enableIsolationLabeling: filters.enableIsolationLabeling,
    enableDensityLabeling: filters.enableDensityLabeling,
    minDistance: filters.minDistance,
    maxDistance: filters.maxDistance,
    isolationGridSize: filters.isolationGridSize,
    densityGridSize: filters.densityGridSize,
    showClouds: filters.showClouds
  };
}

export { scGenerate as generateStellarClassFilters };
