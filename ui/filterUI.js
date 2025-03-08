// /ui/filterUI.js
// Manages the UI for the filter form.
export function initFilterUI() {
  // Toggle sidebar menu on mobile.
  document.getElementById('menu-toggle').addEventListener('click', function() {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  // Enable/disable connection slider based on checkbox state.
  const enableConnectionsChk = document.getElementById('enable-connections');
  const connectionSlider = document.getElementById('connection-slider');
  const connectionNumber = document.getElementById('connection-number');
  enableConnectionsChk.addEventListener('change', function() {
    const enabled = this.checked;
    connectionSlider.disabled = !enabled;
    connectionNumber.disabled = !enabled;
  });
  connectionSlider.addEventListener('input', function() {
    connectionNumber.value = this.value;
  });
  connectionNumber.addEventListener('input', function() {
    connectionSlider.value = this.value;
  });

  // Isolation Filter UI controls.
  const enableIsolationChk = document.getElementById('enable-isolation-filter');
  const isolationSlider = document.getElementById('isolation-slider');
  const isolationNumber = document.getElementById('isolation-number');
  const isolationToleranceSlider = document.getElementById('isolation-tolerance-slider');
  const isolationGridSlider = document.getElementById('isolation-grid-slider');
  const isolationGridNumber = document.getElementById('isolation-grid-number');

  enableIsolationChk.addEventListener('change', function() {
    const enabled = this.checked;
    isolationSlider.disabled = !enabled;
    isolationNumber.disabled = !enabled;
    isolationToleranceSlider.disabled = !enabled;
    isolationGridSlider.disabled = !enabled;
    isolationGridNumber.disabled = !enabled;
  });
  isolationSlider.addEventListener('input', function() {
    isolationNumber.value = this.value;
    document.getElementById('isolation-value').textContent = this.value;
  });
  isolationNumber.addEventListener('input', function() {
    isolationSlider.value = this.value;
    document.getElementById('isolation-value').textContent = this.value;
  });
  isolationToleranceSlider.addEventListener('input', function() {
    document.getElementById('isolation-tolerance-value').textContent = this.value;
  });
  isolationGridSlider.addEventListener('input', function() {
    isolationGridNumber.value = this.value;
  });
  isolationGridNumber.addEventListener('input', function() {
    isolationGridSlider.value = this.value;
  });

  // Density Filter UI controls.
  const enableDensityChk = document.getElementById('enable-density-filter');
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
  densitySlider.addEventListener('input', function() {
    densityNumber.value = this.value;
    document.getElementById('density-value').textContent = this.value;
  });
  densityNumber.addEventListener('input', function() {
    densitySlider.value = this.value;
    document.getElementById('density-value').textContent = this.value;
  });
  densityToleranceSlider.addEventListener('input', function() {
    document.getElementById('density-tolerance-value').textContent = this.value;
  });
  densityGridSlider.addEventListener('input', function() {
    densityGridNumber.value = this.value;
  });
  densityGridNumber.addEventListener('input', function() {
    densityGridSlider.value = this.value;
  });

  // Distance slider sync.
  const minDistanceSlider = document.getElementById('min-distance-slider');
  const minDistanceNumber = document.getElementById('min-distance-number');
  minDistanceSlider.addEventListener('input', function() {
    minDistanceNumber.value = this.value;
  });
  minDistanceNumber.addEventListener('input', function() {
    minDistanceSlider.value = this.value;
  });
  const maxDistanceSlider = document.getElementById('max-distance-slider');
  const maxDistanceNumber = document.getElementById('max-distance-number');
  maxDistanceSlider.addEventListener('input', function() {
    maxDistanceNumber.value = this.value;
  });
  maxDistanceNumber.addEventListener('input', function() {
    maxDistanceSlider.value = this.value;
  });

  // Fullscreen button listeners.
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
