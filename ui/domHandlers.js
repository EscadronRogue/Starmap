// ui/domHandlers.js

export function initDomEventHandlers() {
  // Initialize collapsible filter fieldsets (filter menu)
  const filterForm = document.getElementById('filters-form');
  if (filterForm) {
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
  }

  // Toggle sidebar menu on mobile
  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) {
        sidebar.classList.toggle('open');
      }
    });
  }

  // Enable/disable connection slider based on checkbox state
  const enableConnections = document.getElementById('enable-connections');
  if (enableConnections) {
    enableConnections.addEventListener('change', function() {
      const connectionSlider = document.getElementById('connection-slider');
      if (connectionSlider) {
        connectionSlider.disabled = !this.checked;
      }
    });
  }

  // Enable/disable low density mapping sliders
  const enableLowDensity = document.getElementById('enable-low-density-mapping');
  if (enableLowDensity) {
    enableLowDensity.addEventListener('change', function() {
      const disabled = !this.checked;
      const lowDensitySlider = document.getElementById('low-density-slider');
      const lowDensityNumber = document.getElementById('low-density-number');
      const lowToleranceSlider = document.getElementById('low-tolerance-slider');
      const lowDensityGridSlider = document.getElementById('low-density-grid-slider');
      const lowDensityGridNumber = document.getElementById('low-density-grid-number');
      if (lowDensitySlider) lowDensitySlider.disabled = disabled;
      if (lowDensityNumber) lowDensityNumber.disabled = disabled;
      if (lowToleranceSlider) lowToleranceSlider.disabled = disabled;
      if (lowDensityGridSlider) lowDensityGridSlider.disabled = disabled;
      if (lowDensityGridNumber) lowDensityGridNumber.disabled = disabled;
    });
  }

  // Enable/disable high density mapping sliders
  const enableHighDensity = document.getElementById('enable-high-density-mapping');
  if (enableHighDensity) {
    enableHighDensity.addEventListener('change', function() {
      const disabled = !this.checked;
      const highDensitySlider = document.getElementById('high-density-slider');
      const highDensityNumber = document.getElementById('high-density-number');
      const highToleranceSlider = document.getElementById('high-tolerance-slider');
      const highDensityGridSlider = document.getElementById('high-density-grid-slider');
      const highDensityGridNumber = document.getElementById('high-density-grid-number');
      if (highDensitySlider) highDensitySlider.disabled = disabled;
      if (highDensityNumber) highDensityNumber.disabled = disabled;
      if (highToleranceSlider) highToleranceSlider.disabled = disabled;
      if (highDensityGridSlider) highDensityGridSlider.disabled = disabled;
      if (highDensityGridNumber) highDensityGridNumber.disabled = disabled;
    });
  }

  // Update displayed slider values for tolerance sliders
  const lowToleranceSlider = document.getElementById('low-tolerance-slider');
  if (lowToleranceSlider) {
    lowToleranceSlider.addEventListener('input', function() {
      const valueSpan = document.getElementById('low-tolerance-value');
      if (valueSpan) valueSpan.textContent = this.value;
    });
  }
  const highToleranceSlider = document.getElementById('high-tolerance-slider');
  if (highToleranceSlider) {
    highToleranceSlider.addEventListener('input', function() {
      const valueSpan = document.getElementById('high-tolerance-value');
      if (valueSpan) valueSpan.textContent = this.value;
    });
  }

  // Sync distance slider and number input for minimum distance
  const minDistanceSlider = document.getElementById('min-distance-slider');
  const minDistanceNumber = document.getElementById('min-distance-number');
  if (minDistanceSlider && minDistanceNumber) {
    minDistanceSlider.addEventListener('input', function() {
      minDistanceNumber.value = this.value;
    });
    minDistanceNumber.addEventListener('input', function() {
      minDistanceSlider.value = this.value;
    });
  }

  // Sync distance slider and number input for maximum distance
  const maxDistanceSlider = document.getElementById('max-distance-slider');
  const maxDistanceNumber = document.getElementById('max-distance-number');
  if (maxDistanceSlider && maxDistanceNumber) {
    maxDistanceSlider.addEventListener('input', function() {
      maxDistanceNumber.value = this.value;
    });
    maxDistanceNumber.addEventListener('input', function() {
      maxDistanceSlider.value = this.value;
    });
  }

  // Sync low density slider and number input
  const lowDensitySlider = document.getElementById('low-density-slider');
  const lowDensityNumber = document.getElementById('low-density-number');
  const lowDensityValue = document.getElementById('low-density-value');
  if (lowDensitySlider && lowDensityNumber && lowDensityValue) {
    lowDensitySlider.addEventListener('input', function() {
      lowDensityNumber.value = this.value;
      lowDensityValue.textContent = this.value;
    });
    lowDensityNumber.addEventListener('input', function() {
      lowDensitySlider.value = this.value;
      lowDensityValue.textContent = this.value;
    });
  }

  // Sync high density slider and number input
  const highDensitySlider = document.getElementById('high-density-slider');
  const highDensityNumber = document.getElementById('high-density-number');
  const highDensityValue = document.getElementById('high-density-value');
  if (highDensitySlider && highDensityNumber && highDensityValue) {
    highDensitySlider.addEventListener('input', function() {
      highDensityNumber.value = this.value;
      highDensityValue.textContent = this.value;
    });
    highDensityNumber.addEventListener('input', function() {
      highDensitySlider.value = this.value;
      highDensityValue.textContent = this.value;
    });
  }

  // Sync low density grid slider and number input
  const lowDensityGridSlider = document.getElementById('low-density-grid-slider');
  const lowDensityGridNumber = document.getElementById('low-density-grid-number');
  if (lowDensityGridSlider && lowDensityGridNumber) {
    lowDensityGridSlider.addEventListener('input', function() {
      lowDensityGridNumber.value = this.value;
    });
    lowDensityGridNumber.addEventListener('input', function() {
      lowDensityGridSlider.value = this.value;
    });
  }

  // Sync high density grid slider and number input
  const highDensityGridSlider = document.getElementById('high-density-grid-slider');
  const highDensityGridNumber = document.getElementById('high-density-grid-number');
  if (highDensityGridSlider && highDensityGridNumber) {
    highDensityGridSlider.addEventListener('input', function() {
      highDensityGridNumber.value = this.value;
    });
    highDensityGridNumber.addEventListener('input', function() {
      highDensityGridSlider.value = this.value;
    });
  }

  // Fullscreen button listeners
  const fullscreenButtons = document.querySelectorAll('.fullscreen-btn');
  fullscreenButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const mapContainer = this.parentElement;
      const canvas = mapContainer.querySelector('canvas');
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (canvas.requestFullscreen) {
        canvas.requestFullscreen().catch(err => {
          console.error("Error attempting to enable full-screen mode:", err);
        });
      }
    });
  });

  // Adjust canvas on fullscreen exit
  document.addEventListener("fullscreenchange", function() {
    if (!document.fullscreenElement) {
      const canvases = document.querySelectorAll('.map-container canvas');
      canvases.forEach(canvas => {
        canvas.style.width = "";
        canvas.style.height = "";
      });
      window.dispatchEvent(new Event('resize'));
    }
  });
}
