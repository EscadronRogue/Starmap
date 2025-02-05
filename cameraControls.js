// cameraControls.js

// Import Three.js as an ES module
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Custom Camera Controls for 3D Maps
 */

/* ----------------------------
   ThreeDControls Class
   ---------------------------- */
/**
 * Handles zooming and orbital rotation for 3D maps.
 */
export class ThreeDControls {
    /**
     * Creates an instance of ThreeDControls.
     * @param {THREE.PerspectiveCamera} camera - The Three.js camera to control.
     * @param {HTMLElement} domElement - The DOM element to attach event listeners to.
     */
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;

        // Rotation parameters
        this.isRotating = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.rotationSpeed = 0.005;

        // Zoom parameters
        // Removed minDistance and maxDistance to allow unlimited zoom

        // Touch controls variables
        this.isTouchRotating = false;
        this.isPinching = false;
        this.lastTouch = null;
        this.touchStartDistance = 0;

        // Bind event handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);

        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);

        // Attach event listeners for mouse events
        this.domElement.addEventListener('mousedown', this.onMouseDown, false);
        this.domElement.addEventListener('mousemove', this.onMouseMove, false);
        this.domElement.addEventListener('mouseup', this.onMouseUp, false);
        this.domElement.addEventListener('wheel', this.onWheel, false);

        // Attach event listeners for touch events
        this.domElement.addEventListener('touchstart', this.onTouchStart, false);
        this.domElement.addEventListener('touchmove', this.onTouchMove, false);
        this.domElement.addEventListener('touchend', this.onTouchEnd, false);
        this.domElement.addEventListener('touchcancel', this.onTouchEnd, false);
    }

    /**
     * Handles mouse down events to initiate rotation.
     * @param {MouseEvent} event 
     */
    onMouseDown(event) {
        this.isRotating = true;
        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    /**
     * Handles mouse move events to perform rotation.
     * @param {MouseEvent} event 
     */
    onMouseMove(event) {
        if (!this.isRotating) return;

        const deltaMove = {
            x: event.clientX - this.previousMousePosition.x,
            y: event.clientY - this.previousMousePosition.y
        };

        const offset = new THREE.Vector3();
        offset.copy(this.camera.position).sub(new THREE.Vector3(0, 0, 0)); // Assuming looking at origin

        let theta = Math.atan2(offset.x, offset.z);
        let phi = Math.atan2(Math.sqrt(offset.x * offset.x + offset.z * offset.z), offset.y);

        theta -= deltaMove.x * this.rotationSpeed;
        phi -= deltaMove.y * this.rotationSpeed;

        // Restrict phi to prevent the camera from flipping
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));

        const radius = offset.length();
        this.camera.position.set(
            radius * Math.sin(phi) * Math.sin(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.cos(theta)
        );
        this.camera.lookAt(new THREE.Vector3(0, 0, 0));

        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }

    /**
     * Handles mouse up events to stop rotation.
     * @param {MouseEvent} event 
     */
    onMouseUp(event) {
        this.isRotating = false;
    }

    /**
     * Handles wheel events to perform zooming.
     * @param {WheelEvent} event 
     */
    onWheel(event) {
        event.preventDefault();

        const delta = event.deltaY;
        const zoomSpeed = 0.1;

        // Calculate new distance
        const direction = new THREE.Vector3();
        direction.copy(this.camera.position).normalize();

        const distance = this.camera.position.length();
        const newDistance = distance + delta * zoomSpeed * (distance / 100); // Adjust zoom speed based on distance

        // Removed limits on newDistance
        this.camera.position.set(
            direction.x * newDistance,
            direction.y * newDistance,
            direction.z * newDistance
        );

        this.camera.updateProjectionMatrix();
    }

    /**
     * Helper function to get distance between two touches.
     * @param {Touch} touch1 
     * @param {Touch} touch2 
     * @returns {number}
     */
    getTouchDistance(touch1, touch2) {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Handles touch start events.
     * @param {TouchEvent} event 
     */
    onTouchStart(event) {
        if (event.touches.length === 1) {
            // Single touch for rotation
            this.isTouchRotating = true;
            this.lastTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        } else if (event.touches.length === 2) {
            // Two fingers for pinch zoom
            this.isPinching = true;
            this.isTouchRotating = false;
            this.touchStartDistance = this.getTouchDistance(event.touches[0], event.touches[1]);
        }
    }

    /**
     * Handles touch move events.
     * @param {TouchEvent} event 
     */
    onTouchMove(event) {
        event.preventDefault();
        if (this.isPinching && event.touches.length === 2) {
            // Handle pinch zoom
            const currentDistance = this.getTouchDistance(event.touches[0], event.touches[1]);
            const deltaDistance = currentDistance - this.touchStartDistance;
            const zoomSpeed = 0.5; // Adjust zoom sensitivity for touch
            const direction = new THREE.Vector3();
            direction.copy(this.camera.position).normalize();
            const distance = this.camera.position.length();
            const newDistance = distance - deltaDistance * zoomSpeed * (distance / 100);
            this.camera.position.set(
                direction.x * newDistance,
                direction.y * newDistance,
                direction.z * newDistance
            );
            this.camera.updateProjectionMatrix();
            // Update starting distance for smooth pinch zoom
            this.touchStartDistance = currentDistance;
        } else if (this.isTouchRotating && event.touches.length === 1) {
            const touch = event.touches[0];
            const deltaMove = {
                x: touch.clientX - this.lastTouch.x,
                y: touch.clientY - this.lastTouch.y
            };

            const offset = new THREE.Vector3();
            offset.copy(this.camera.position).sub(new THREE.Vector3(0, 0, 0)); // Assuming looking at origin

            let theta = Math.atan2(offset.x, offset.z);
            let phi = Math.atan2(Math.sqrt(offset.x * offset.x + offset.z * offset.z), offset.y);

            theta -= deltaMove.x * this.rotationSpeed;
            phi -= deltaMove.y * this.rotationSpeed;

            // Restrict phi to prevent the camera from flipping
            phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));

            const radius = offset.length();
            this.camera.position.set(
                radius * Math.sin(phi) * Math.sin(theta),
                radius * Math.cos(phi),
                radius * Math.sin(phi) * Math.cos(theta)
            );
            this.camera.lookAt(new THREE.Vector3(0, 0, 0));

            this.lastTouch = { x: touch.clientX, y: touch.clientY };
        }
    }

    /**
     * Handles touch end and touch cancel events.
     * @param {TouchEvent} event 
     */
    onTouchEnd(event) {
        if (event.touches.length === 0) {
            this.isTouchRotating = false;
            this.isPinching = false;
            this.lastTouch = null;
            this.touchStartDistance = 0;
        } else if (event.touches.length === 1) {
            // If one finger remains, treat it as rotation.
            this.isPinching = false;
            this.isTouchRotating = true;
            this.lastTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }
    }

    /**
     * Destroys the controls by removing event listeners.
     */
    dispose() {
        this.domElement.removeEventListener('mousedown', this.onMouseDown, false);
        this.domElement.removeEventListener('mousemove', this.onMouseMove, false);
        this.domElement.removeEventListener('mouseup', this.onMouseUp, false);
        this.domElement.removeEventListener('wheel', this.onWheel, false);

        this.domElement.removeEventListener('touchstart', this.onTouchStart, false);
        this.domElement.removeEventListener('touchmove', this.onTouchMove, false);
        this.domElement.removeEventListener('touchend', this.onTouchEnd, false);
        this.domElement.removeEventListener('touchcancel', this.onTouchEnd, false);
    }
}
