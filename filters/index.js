// /filters/index.js
import { loadStellarClassData } from './stellarClassData.js';
import { applySizeFilter } from './sizeFilter.js';
import { applyColorFilter } from './colorFilter.js';
import { applyOpacityFilter } from './opacityFilter.js';
import { applyStarsShownFilter } from './starsShownFilter.js';
import { computeConnectionPairs } from './connectionsFilter.js';
import { applyStellarClassLogic, generateStellarClassFilters as scGenerate } from './stellarClassFilter.js';

// For constellations
import { loadConstellationBoundaries, loadConstellationCenters } from './constellationFilter.js';
// Import the new overlay filter
import { createConstellationOverlaysForGlobe } from './constellationOverlayFilter.js';

// The new file that manages globe surface toggling
import { applyGlobeSurfaceFilter } from './globeSurfaceFilter.js';

let filterForm = null;

/**
 * Sets up the entire filter UI, including the new categories:
 * - Constellations (with Show Boundaries, Show Names, Show Overlays)
 * - Globe Surface (Opaque/Transparent)
 */
export async function setupFilterUI(allStars) {
  filterForm = document.getElementById('filters-form');
  if (!filterForm) {
    console.warn('[setupFilterUI] No #filters-form found in DOM!');
    return;
  }

  // Load stellar class data
  loadStellarClassData();

  // Generate the stellar class subcategories
  scGenerate(allStars);

  // Make existing legends collapsible
  const mainLegends = filterForm.querySelectorAll('legend.collapsible');
  mainLegends.forEach(legend => {
    const fc = legend.nextElementSibling;
    if (fc) fc.style.maxHeight = '0px';
    legend.addEventListener('click', () => {
      legend.classList.toggle('active');
      const isActive = legend.classList.contains('active');
      legend.setAttribute('aria-expanded', isActive);
      if (fc) {
        fc.style.maxHeight = isActive ? fc.scrollHeight + 'px' : '0px';
      }
    });
  });

  // Add new fieldset for Constellations
  addConstellationsFieldset();

  // Add new fieldset for Globe Surface
  addGlobeSurfaceFieldset();

  // All categories now start closed.
  // Load constellation data in background
  await loadConstellationBoundaries();
  await loadConstellationCenters();
}

/**
 * Adds a fieldset for "Constellations" with 3 checkboxes: 
 * "Show Constellation Boundaries", "Show Constellation Names", and "Show Constellation Overlays"
 */
function addConstellationsFieldset() {
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.classList.add('collapsible');
  legend.textContent = 'Constellations';
  fs.appendChild(legend);
  const contentDiv = document.createElement('div');
  contentDiv.classList.add('filter-content');
  contentDiv.style.maxHeight = '0px';
  // Make this fieldset collapsible (like the others)
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
  
  // New overlay checkbox
  const overlayDiv = document.createElement('div');
  overlayDiv.classList.add('filter-item');
  const overlayChk = document.createElement('input');
  overlayChk.type = 'checkbox';
  overlayChk.id = 'show-constellation-overlays';
  overlayChk.name = 'show-constellation-overlays';
  overlayChk.checked = false; // default off
  const overlayLbl = document.createElement('label');
  overlayLbl.htmlFor = 'show-constellation-overlays';
  overlayLbl.textContent = 'Show Constellation Overlays';
  overlayDiv.appendChild(overlayChk);
  overlayDiv.appendChild(overlayLbl);
  contentDiv.appendChild(overlayDiv);
  
  fs.appendChild(contentDiv);
  filterForm.appendChild(fs);
}

/**
 * Adds a fieldset for "Globe Surface" with 1 checkbox: "Opaque Globe Surface"
 */
function addGlobeSurfaceFieldset() {
  const fs = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.classList.add('collapsible');
  legend.textContent = 'Globe Surface';
  fs.appendChild(legend);
  const contentDiv = document.createElement('div');
  contentDiv.classList.add('filter-content');
  contentDiv.style.maxHeight = '0px';
  // Make this fieldset collapsible (like the others)
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
  surfChk.checked = false;
  const surfLbl = document.createElement('label');
  surfLbl.htmlFor = 'globe-opaque-surface';
  surfLbl.textContent = 'Opaque Globe Surface';
  surfDiv.appendChild(surfChk);
  surfDiv.appendChild(surfLbl);
  contentDiv.appendChild(surfDiv);
  fs.appendChild(contentDiv);
  filterForm.appendChild(fs);
}

/**
 * Main applyFilters pipeline.
 */
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
        showConstellationOverlays: false,
        globeOpaqueSurface: false,
        enableConnections: false,
        enableDensityMapping: false
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
    showConstellationOverlays: (formData.get('show-constellation-overlays') !== null),
    globeOpaqueSurface: (formData.get('globe-opaque-surface') !== null),
    enableConnections: (formData.get('enable-connections') !== null),
    enableDensityMapping: (formData.get('enable-density-mapping') !== null)
  };

  let filteredStars = applyStarsShownFilter(allStars, filters);
  filteredStars = applyStellarClassLogic(filteredStars, filterForm);
  filteredStars = applySizeFilter(filteredStars, filters);
  filteredStars = applyColorFilter(filteredStars, filters);
  filteredStars = applyOpacityFilter(filteredStars, filters);

  const globeFiltered = filteredStars.filter(s => s.Common_name_of_the_star !== 'Sun');

  let pairs = [];
  let globePairs = [];
  if (filters.enableConnections) {
    pairs = computeConnectionPairs(filteredStars, filters.connections);
    globePairs = computeConnectionPairs(globeFiltered, filters.connections);
  }

  applyGlobeSurfaceFilter(filters);

  return {
    filteredStars,
    connections: pairs,
    globeFilteredStars: globeFiltered,
    globeConnections: globePairs,
    showConstellationBoundaries: filters.showConstellationBoundaries,
    showConstellationNames: filters.showConstellationNames,
    showConstellationOverlays: filters.showConstellationOverlays,
    globeOpaqueSurface: filters.globeOpaqueSurface,
    enableConnections: filters.enableConnections,
    enableDensityMapping: filters.enableDensityMapping
  };
}

// re-export
export { scGenerate as generateStellarClassFilters };
