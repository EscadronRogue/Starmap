/**
 * Displays the tooltip with star information at the specified coordinates.
 * @param {number} x - The X-coordinate on the screen.
 * @param {number} y - The Y-coordinate on the screen.
 * @param {Object} star - The star object containing information to display.
 */
export function showTooltip(x, y, star) {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip) {
        console.warn("Tooltip container not found in DOM.");
        return;
    }

    const tooltipStarName = document.getElementById('tooltip-starName');
    if (tooltipStarName) {
      tooltipStarName.textContent = star.Common_name_of_the_star || 'Unknown Star';
    }

    const tooltipSystemName = document.getElementById('tooltip-systemName');
    if (tooltipSystemName) {
      tooltipSystemName.textContent = star.Common_name_of_the_star_system || 'Unknown System';
    }

    const tooltipDistance = document.getElementById('tooltip-distance');
    if (tooltipDistance) {
      tooltipDistance.textContent = star.Distance_from_the_Sun !== undefined 
        ? `${star.Distance_from_the_Sun.toFixed(2)} LY` 
        : 'N/A';
    }

    const tooltipConstellation = document.getElementById('tooltip-constellation');
    if (tooltipConstellation) {
      tooltipConstellation.textContent = star.Constellation || 'N/A';
    }

    const tooltipStellarClass = document.getElementById('tooltip-stellarClass');
    if (tooltipStellarClass) {
      tooltipStellarClass.textContent = star.Stellar_class || 'N/A';
    }

    const tooltipMass = document.getElementById('tooltip-mass');
    if (tooltipMass) {
      tooltipMass.textContent = star.Mass !== undefined ? star.Mass : 'N/A';
    }

    const tooltipSize = document.getElementById('tooltip-size');
    if (tooltipSize) {
      tooltipSize.textContent = star.Size !== undefined ? star.Size : 'N/A';
    }

    const tooltipAbsoluteMag = document.getElementById('tooltip-absoluteMag');
    if (tooltipAbsoluteMag) {
      tooltipAbsoluteMag.textContent = star.Absolute_magnitude !== undefined 
        ? star.Absolute_magnitude 
        : 'N/A';
    }

    const tooltipParallax = document.getElementById('tooltip-parallax');
    if (tooltipParallax) {
      tooltipParallax.textContent = star.Parallax !== undefined ? star.Parallax : 'N/A';
    }

    const tooltipCatalogLink = document.getElementById('tooltip-catalogLink');
    if (tooltipCatalogLink) {
      if (star.Catalog_link) {
          tooltipCatalogLink.innerHTML = `<a href="${star.Catalog_link}" target="_blank" style="color: #ff6f61; text-decoration: underline;">Catalog</a>`;
      } else {
          tooltipCatalogLink.textContent = 'N/A';
      }
    }

    // Position tooltip near the cursor with a slight offset.
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${y + 15}px`;
    tooltip.classList.add('visible');
    tooltip.classList.remove('hidden');
}

/**
 * Hides the tooltip.
 */
export function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
       tooltip.classList.remove('visible');
       tooltip.classList.add('hidden');
    }
}
