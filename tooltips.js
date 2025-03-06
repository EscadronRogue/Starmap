/**
 * Displays the tooltip with star information at the specified coordinates.
 * Builds the entire tooltip innerHTML so that all requested details appear.
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
    
    // Ensure the tooltip can receive pointer events.
    tooltip.style.pointerEvents = 'auto';
    
    // Attach a click event listener (if not already attached) so that clicks inside
    // the tooltip do not propagate further.
    if (!tooltip.hasAttribute('data-stop-propagation')) {
        tooltip.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        tooltip.setAttribute('data-stop-propagation', 'true');
    }
    
    // Build the tooltip content with all fields.
    tooltip.innerHTML = `
      <div id="tooltip-starName"><strong>Name:</strong> ${star.Common_name_of_the_star || 'Unknown Star'}</div>
      <div id="tooltip-systemName"><strong>System:</strong> ${star.Common_name_of_the_star_system || 'Unknown System'}</div>
      <div id="tooltip-distance"><strong>Distance:</strong> ${star.Distance_from_the_Sun !== undefined ? star.Distance_from_the_Sun.toFixed(2) + ' LY' : 'N/A'}</div>
      <div id="tooltip-constellation"><strong>Constellation:</strong> ${star.Constellation || 'N/A'}</div>
      <div id="tooltip-stellarClass"><strong>Stellar Class:</strong> ${star.Stellar_class || 'N/A'}</div>
      <div id="tooltip-mass"><strong>Mass:</strong> ${star.Mass !== undefined ? star.Mass : 'N/A'}</div>
      <div id="tooltip-size"><strong>Size:</strong> ${star.Size !== undefined ? star.Size : 'N/A'}</div>
      <div id="tooltip-absoluteMag"><strong>Absolute Mag:</strong> ${star.Absolute_magnitude !== undefined ? star.Absolute_magnitude : 'N/A'}</div>
      <div id="tooltip-parallax"><strong>Parallax:</strong> ${star.Parallax !== undefined ? star.Parallax : 'N/A'}</div>
      <div id="tooltip-catalogLink">
        <strong>Catalog:</strong> 
        ${star.Catalog_link 
            ? `<a href="${star.Catalog_link}" target="_blank" style="color: #ff6f61; text-decoration: underline;">Catalog</a>` 
            : 'N/A'}
      </div>
    `;
    
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
       // Disable pointer events when hidden so that underlying canvas events work.
       tooltip.style.pointerEvents = 'none';
    }
}
