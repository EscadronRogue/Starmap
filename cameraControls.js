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

        // Bind event handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);

        // Attach event listeners
        this.domElement.addEventListener('mousedown', this.onMouseDown, false);
        this.domElement.addEventListener('mousemove', this.onMouseMove, false);
        this.domElement.addEventListener('mouseup', this.onMouseUp, false);
        this.domElement.addEventListener('wheel', this.onWheel, false);
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
     * Destroys the controls by removing event listeners.
     */
    dispose() {
        this.domElement.removeEventListener('mousedown', this.onMouseDown, false);
        this.domElement.removeEventListener('mousemove', this.onMouseMove, false);
        this.domElement.removeEventListener('mouseup', this.onMouseUp, false);
        this.domElement.removeEventListener('wheel', this.onWheel, false);
    }
}
