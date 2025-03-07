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

  // Enable/disable connection slider based on checkbox state
  const enableConnectionsChk = document.getElementById('enable-connections');
  const connectionSlider = document.getElementById('connection-slider');
  enableConnectionsChk.addEventListener('change', function() {
    connectionSlider.disabled = !this.checked;
  });

  // Enable/disable low density mapping sliders
  const enableLowDensityChk = document.getElementById('enable-low-density-mapping');
  const lowDensitySlider = document.getElementById('low-density-slider');
  const lowDensityNumber = document.getElementById('low-density-number');
  const lowToleranceSlider = document.getElementById('low-tolerance-slider');
  const lowDensityGridSlider = document.getElementById('low-density-grid-slider');
  const lowDensityGridNumber = document.getElementById('low-density-grid-number');

  enableLowDensityChk.addEventListener('change', function() {
    const lowEnabled = this.checked;
    lowDensitySlider.disabled = !lowEnabled;
    lowDensityNumber.disabled = !lowEnabled;
    lowToleranceSlider.disabled = !lowEnabled;
    lowDensityGridSlider.disabled = !lowEnabled;
    lowDensityGridNumber.disabled = !lowEnabled;
  });

  // Enable/disable high density mapping sliders
  const enableHighDensityChk = document.getElementById('enable-high-density-mapping');
  const highDensitySlider = document.getElementById('high-density-slider');
  const highDensityNumber = document.getElementById('high-density-number');
  const highToleranceSlider = document.getElementById('high-tolerance-slider');
  const highDensityGridSlider = document.getElementById('high-density-grid-slider');
  const highDensityGridNumber = document.getElementById('high-density-grid-number');

  enableHighDensityChk.addEventListener('change', function() {
    const highEnabled = this.checked;
    highDensitySlider.disabled = !highEnabled;
    highDensityNumber.disabled = !highEnabled;
    highToleranceSlider.disabled = !highEnabled;
    highDensityGridSlider.disabled = !highEnabled;
    highDensityGridNumber.disabled = !highEnabled;
  });

  // Update displayed slider values for tolerance sliders
  lowToleranceSlider.addEventListener('input', function() {
    document.getElementById('low-tolerance-value').textContent = this.value;
  });
  highToleranceSlider.addEventListener('input', function() {
    document.getElementById('high-tolerance-value').textContent = this.value;
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

  // Sync low density slider and number input
  lowDensitySlider.addEventListener('input', function() {
    lowDensityNumber.value = this.value;
    document.getElementById('low-density-value').textContent = this.value;
  });
  lowDensityNumber.addEventListener('input', function() {
    lowDensitySlider.value = this.value;
    document.getElementById('low-density-value').textContent = this.value;
  });

  // Sync high density slider and number input
  highDensitySlider.addEventListener('input', function() {
    highDensityNumber.value = this.value;
    document.getElementById('high-density-value').textContent = this.value;
  });
  highDensityNumber.addEventListener('input', function() {
    highDensitySlider.value = this.value;
    document.getElementById('high-density-value').textContent = this.value;
  });

  // Sync low density grid slider and number input
  lowDensityGridSlider.addEventListener('input', function() {
    lowDensityGridNumber.value = this.value;
  });
  lowDensityGridNumber.addEventListener('input', function() {
    lowDensityGridSlider.value = this.value;
  });

  // Sync high density grid slider and number input
  highDensityGridSlider.addEventListener('input', function() {
    highDensityGridNumber.value = this.value;
  });
  highDensityGridNumber.addEventListener('input', function() {
    highDensityGridSlider.value = this.value;
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
