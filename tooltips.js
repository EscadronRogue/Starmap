/**
 * Displays the tooltip with star information at the specified coordinates.
 * @param {number} x - The X-coordinate on the screen.
 * @param {number} y - The Y-coordinate on the screen.
 * @param {Object} star - The star object containing information to display.
 */
export function showTooltip(x, y, star) {
    const tooltip = document.getElementById('tooltip');
    const tooltipStarName = document.getElementById('tooltip-starName');
    const tooltipSystemName = document.getElementById('tooltip-systemName');
    const tooltipDistance = document.getElementById('tooltip-distance');
    const tooltipConstellation = document.getElementById('tooltip-constellation');
    const tooltipStellarClass = document.getElementById('tooltip-stellarClass');
    const tooltipMass = document.getElementById('tooltip-mass');
    const tooltipSize = document.getElementById('tooltip-size');
    const tooltipAbsoluteMag = document.getElementById('tooltip-absoluteMag');
    const tooltipParallax = document.getElementById('tooltip-parallax');
    const tooltipCatalogLink = document.getElementById('tooltip-catalogLink');

    tooltipStarName.textContent = star.Common_name_of_the_star || 'Unknown Star';
    tooltipSystemName.textContent = star.Common_name_of_the_star_system || 'Unknown System';
    tooltipDistance.textContent = star.Distance_from_the_Sun !== undefined ? `${star.Distance_from_the_Sun.toFixed(2)} LY` : 'N/A';
    tooltipConstellation.textContent = star.Constellation || 'N/A';
    tooltipStellarClass.textContent = star.Stellar_class || 'N/A';
    tooltipMass.textContent = star.Mass !== undefined ? star.Mass : 'N/A';
    tooltipSize.textContent = star.Size !== undefined ? star.Size : 'N/A';
    tooltipAbsoluteMag.textContent = star.Absolute_magnitude !== undefined ? star.Absolute_magnitude : 'N/A';
    tooltipParallax.textContent = star.Parallax !== undefined ? star.Parallax : 'N/A';

    if (star.Catalog_link) {
        tooltipCatalogLink.innerHTML = `<a href="${star.Catalog_link}" target="_blank" style="color: #ff6f61; text-decoration: underline;">Catalog</a>`;
    } else {
        tooltipCatalogLink.textContent = 'N/A';
    }

    // Position tooltip near the cursor with slight offset
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
    tooltip.classList.remove('visible');
    tooltip.classList.add('hidden');
}
