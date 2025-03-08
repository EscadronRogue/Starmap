// /ui/filterUI.js

/**
 * Manages the UI for the filter form, including slider synchronization,
 * enabling/disabling checkboxes, and any other form interactions.
 */
export function initFilterUI() {
  // Toggle sidebar menu on mobile
  document.getElementById('menu-toggle').addEventListener('click', function() {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  // Enable/disable connection slider and number input based on checkbox state
  const enableConnectionsChk = document.getElementById('enable-connections');
  const connectionSlider = document.getElementById('connection-slider');
  const connectionNumber = document.getElementById('connection-number');
  enableConnectionsChk.addEventListener('change', function() {
    const enabled = this.checked;
    connectionSlider.disabled = !enabled;
    connectionNumber.disabled = !enabled;
  });

  // Sync connection slider and number input
  connectionSlider.addEventListener('input', function() {
    connectionNumber.value = this.value;
  });
  connectionNumber.addEventListener('input', function() {
    connectionSlider.value = this.value;
  });

  // Enable/disable isolation mapping sliders (formerly low density)
  const enableIsolationChk = document.getElementById('enable-low-density-mapping');
  const isolationSlider = document.getElementById('low-density-slider');
  const isolationNumber = document.getElementById('low-density-number');
  const isolationToleranceSlider = document.getElementById('low-tolerance-slider');
  const isolationGridSlider = document.getElementById('low-density-grid-slider');
  const isolationGridNumber = document.getElementById('low-density-grid-number');

  enableIsolationChk.addEventListener('change', function() {
    const enabled = this.checked;
    isolationSlider.disabled = !enabled;
    isolationNumber.disabled = !enabled;
    isolationToleranceSlider.disabled = !enabled;
    isolationGridSlider.disabled = !enabled;
    isolationGridNumber.disabled = !enabled;
  });

  // Enable/disable density mapping sliders (formerly high density)
  const enableDensityChk = document.getElementById('enable-density-mapping');
  const densitySlider = document.getElementById('density-slider');
  const densityNumber = document.getElementById('density-number');
  const densityToleranceSlider = document.getElementById('density-tolerance-slider');
  const densityGridSlider = document.getElementById('density-grid-slider');
  const densityGridNumber = document.getElementById('density-grid-number');

  enableDensityChk.addEventListener('change', function() {
    const enabled = this.checked;
    densitySlider.disabled = !enabled;
    densityNumber.disabled = !enabled;
    densityToleranceSlider.disabled = !enabled;
    densityGridSlider.disabled = !enabled;
    densityGridNumber.disabled = !enabled;
  });

  // Update displayed slider values for tolerance sliders
  isolationToleranceSlider.addEventListener('input', function() {
    document.getElementById('low-tolerance-value').textContent = this.value;
  });
  densityToleranceSlider.addEventListener('input', function() {
    document.getElementById('density-tolerance-value').textContent = this.value;
  });

  // Sync distance slider and number input for minimum distance
  const minDistanceSlider = document.getElementById('min-distance-slider');
  const minDistanceNumber = document.getElementById('min-distance-number');
  minDistanceSlider.addEventListener('input', function() {
    minDistanceNumber.value = this.value;
  });
  minDistanceNumber.addEventListener('input', function() {
    minDistanceSlider.value = this.value;
  });

  // Sync distance slider and number input for maximum distance
  const maxDistanceSlider = document.getElementById('max-distance-slider');
  const maxDistanceNumber = document.getElementById('max-distance-number');
  maxDistanceSlider.addEventListener('input', function() {
    maxDistanceNumber.value = this.value;
  });
  maxDistanceNumber.addEventListener('input', function() {
    maxDistanceSlider.value = this.value;
  });

  // Sync isolation mapping slider and number input
  isolationSlider.addEventListener('input', function() {
    isolationNumber.value = this.value;
    document.getElementById('low-density-value').textContent = this.value;
  });
  isolationNumber.addEventListener('input', function() {
    isolationSlider.value = this.value;
    document.getElementById('low-density-value').textContent = this.value;
  });

  // Sync density mapping slider and number input
  densitySlider.addEventListener('input', function() {
    densityNumber.value = this.value;
    document.getElementById('density-value').textContent = this.value;
  });
  densityNumber.addEventListener('input', function() {
    densitySlider.value = this.value;
    document.getElementById('density-value').textContent = this.value;
  });

  // Sync isolation grid slider and number input
  isolationGridSlider.addEventListener('input', function() {
    isolationGridNumber.value = this.value;
  });
  isolationGridNumber.addEventListener('input', function() {
    isolationGridSlider.value = this.value;
  });

  // Sync density grid slider and number input
  densityGridSlider.addEventListener('input', function() {
    densityGridNumber.value = this.value;
  });
  densityGridNumber.addEventListener('input', function() {
    densityGridSlider.value = this.value;
  });

  // Fullscreen button listeners for each map container
  document.querySelectorAll('.fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const mapContainer = this.parentElement;
      const canvas = mapContainer.querySelector('canvas');
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        canvas.requestFullscreen().catch(err => {
          console.error("Error attempting to enable full-screen mode:", err);
        });
      }
    });
  });

  // Adjust canvas on fullscreen exit
  document.addEventListener("fullscreenchange", function() {
    if (!document.fullscreenElement) {
      document.querySelectorAll('.map-container canvas').forEach(canvas => {
        canvas.style.width = "";
        canvas.style.height = "";
      });
      window.dispatchEvent(new Event('resize'));
    }
  });

  console.log("[filterUI] Filter UI initialized.");
}
