// filters/index.js

import { loadStellarClassData } from './stellarClassData.js';
import { applySizeFilter } from './sizeFilter.js';
import { applyColorFilter } from './colorFilter.js';
import { applyOpacityFilter } from './opacityFilter.js';
import { applyStarsShownFilter } from './starsShownFilter.js';
import { computeConnectionPairs } from './connectionsFilter.js';
import { applyStellarClassLogic, generateStellarClassFilters as scGenerate } from './stellarClassFilter.js';

// For constellations
import { loadConstellationBoundaries, loadConstellationCenters } from './constellationFilter.js';

// The new file that manages globe surface toggling
import { applyGlobeSurfaceFilter } from './globeSurfaceFilter.js';

let filterForm = null;

/**
 * Sets up the entire filter UI, including the new categories:
 * - Constellations (with Show Boundaries, Show Names)
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
    // We do not collapse them automatically. We let them remain as is or set them collapsed by default.
    // If you want them open by default, you can do legend.classList.add('active').
    // We'll keep the existing categories as is, to not break anything else:
    legend.classList.remove('active');
    const fc = legend.nextElementSibling;
    if (fc) fc.style.maxHeight = null; // collapsed by default

    legend.addEventListener('click', () => {
      legend.classList.toggle('active');
      const isActive = legend.classList.contains('active');
      legend.setAttribute('aria-expanded', isActive);
      if (fc) {
        fc.style.maxHeight = isActive ? fc.scrollHeight + 'px' : null;
      }
    });
  });

  // Add new fieldset for Constellations
  addConstellationsFieldset();

  // Add new fieldset for Globe Surface
  addGlobeSurfaceFieldset();

  // We force them "active" so the user sees the checkboxes right away (to fix "no boxes to turn on/off").
  forceOpenFieldsets(['Constellations', 'Globe Surface']);

  // Load constellation data in background
  await loadConstellationBoundaries();
  await loadConstellationCenters();
}

/**
 * Adds a fieldset for "Constellations" with 2 checkboxes: "Boundaries" & "Names"
 */
function addConstellationsFieldset() {
  const fs = document.createElement('fieldset');

  // Collapsible legend
  const legend = document.createElement('legend');
  legend.classList.add('collapsible');
  legend.textContent = 'Constellations';
  fs.appendChild(legend);

  const contentDiv = document.createElement('div');
  contentDiv.classList.add('filter-content');
  contentDiv.style.maxHeight = '0'; // will be forced open later

  // Show Boundaries
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

  // Show Names
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
  contentDiv.style.maxHeight = '0'; // will be forced open later

  // Opaque Globe
  const surfDiv = document.createElement('div');
  surfDiv.classList.add('filter-item');
  const surfChk = document.createElement('input');
  surfChk.type = 'checkbox';
  surfChk.id = 'globe-opaque-surface';
  surfChk.name = 'globe-opaque-surface';
  surfChk.checked = false; // default transparent
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
 * We forcibly "open" the fieldset for the newly added categories so the user sees the checkboxes 
 * even if the main code tries to keep them collapsed. 
 */
function forceOpenFieldsets(fieldsetTitles) {
  // fieldsetTitles is array like ['Constellations','Globe Surface']
  // We'll find all legends in the form, if legend.textContent matches, we open it.
  const legends = filterForm.querySelectorAll('legend.collapsible');
  legends.forEach(legend => {
    const titleText = legend.textContent.trim();
    if (fieldsetTitles.includes(titleText)) {
      // Mark it active
      legend.classList.add('active');
      legend.setAttribute('aria-expanded','true');
      // Expand the next sibling filter-content
      const fc = legend.nextElementSibling;
      if (fc && fc.classList.contains('filter-content')) {
        fc.style.maxHeight = fc.scrollHeight + 'px';
      }
    }
  });
}

/**
 * Main applyFilters pipeline
 */
export function applyFilters(allStars) {
  if (!filterForm) {
    filterForm = document.getElementById('filters-form');
    if (!filterForm) {
      // fallback
      return {
        filteredStars: allStars,
        connections: [],
        globeFilteredStars: allStars,
        globeConnections: [],
        showConstellationBoundaries: false,
        showConstellationNames: false,
        globeOpaqueSurface: false
      };
    }
  }
  const formData = new FormData(filterForm);

  const filters = {
    size: formData.get('size'),                // 'distance', 'stellar-class'
    color: formData.get('color'),              // 'constellation', 'galactic-plane', 'stellar-class'
    opacity: formData.get('opacity'),          // '75', 'absolute-magnitude'
    starsShown: formData.get('stars-shown'),   // 'all', 'visible'
    connections: parseFloat(formData.get('connections')) || 7,

    // Our new checkboxes
    showConstellationBoundaries: (formData.get('show-constellation-boundaries') !== null),
    showConstellationNames: (formData.get('show-constellation-names') !== null),
    globeOpaqueSurface: (formData.get('globe-opaque-surface') !== null)
  };

  // 1) "Stars Shown"
  let filteredStars = applyStarsShownFilter(allStars, filters);

  // 2) "Stellar Class" logic
  filteredStars = applyStellarClassLogic(filteredStars, filterForm);

  // 3) size filter
  filteredStars = applySizeFilter(filteredStars, filters);

  // 4) color filter
  filteredStars = applyColorFilter(filteredStars, filters);

  // 5) opacity filter
  filteredStars = applyOpacityFilter(filteredStars, filters);

  // exclude sun from globe
  const globeFiltered = filteredStars.filter(s => s.Common_name_of_the_star !== 'Sun');

  // compute connections
  const pairs = computeConnectionPairs(filteredStars, filters.connections);
  const globePairs = computeConnectionPairs(globeFiltered, filters.connections);

  // Also apply globe surface filter logic
  // (We store or do nothing special)
  applyGlobeSurfaceFilter(filters);

  return {
    filteredStars,
    connections: pairs,
    globeFilteredStars: globeFiltered,
    globeConnections: globePairs,
    showConstellationBoundaries: filters.showConstellationBoundaries,
    showConstellationNames: filters.showConstellationNames,
    globeOpaqueSurface: filters.globeOpaqueSurface
  };
}

// re-export
export { scGenerate as generateStellarClassFilters };
