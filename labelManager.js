// labelManager.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { hexToRGBA } from './utils.js';

/**
 * Simple hash function to generate a consistent number from a string.
 * Used to generate deterministic angles for label offsets in the Globe map.
 * @param {string} str - The input string to hash.
 * @returns {number} - A hash code derived from the input string.
 */
function hashString(str) {
  let hash = 0;
  for(let i=0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * LabelManager Class
 * Manages high-quality 3D sprite labels with dynamic offsets and connecting lines.
 */
export class LabelManager {
  /**
   * @param {string} mapType - 'TrueCoordinates' or 'Globe'
   * @param {THREE.Scene} scene - The THREE.Scene to which labels and lines are added.
   */
  constructor(mapType, scene) {
    this.mapType = mapType;
    this.scene = scene;

    // Map to store star => sprite
    this.sprites = new Map();

    // Map to store star => line
    this.lines = new Map();

    // To ensure consistent offsets, store offset vectors for each star
    this.offsets = new Map();
  }

  /**
   * Generates an offset for a star based on its size and map type.
   * - For TrueCoordinates: Minimal fixed offset to keep labels close.
   * - For Globe: Deterministic offset based on star's name to prevent overlap.
   * @param {Object} star - The star object.
   * @returns {THREE.Vector3} - The offset vector.
   */
  generateOffset(star) {
    if (this.offsets.has(star)) {
      return this.offsets.get(star);
    }

    let offset;
    if (this.mapType === 'TrueCoordinates') {
      // Minimal fixed offset for TrueCoordinates to keep labels close to stars
      // Adjust the multiplier slightly based on star size
      const baseOffset = new THREE.Vector3(1, 1, 0);
      const sizeMultiplier = THREE.MathUtils.clamp(star.displaySize / 2, 0.5, 1.5); // Clamp between 0.5 and 1.5
      offset = baseOffset.clone().multiplyScalar(sizeMultiplier);
    } else if (this.mapType === 'Globe') {
      // Deterministic offset for Globe based on star's name
      const hash = hashString(star.displayName || star.Common_name_of_the_star || 'Star');
      const angle = (hash % 360) * (Math.PI / 180); // Convert degrees to radians
      const baseDistance = 2; // Base offset units
      const sizeFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5); // Scale between 1 and 5

      // Calculate offset based on angle and distance
      const offsetX = baseDistance * sizeFactor * Math.cos(angle);
      const offsetY = baseDistance * sizeFactor * Math.sin(angle);
      const offsetZ = 0; // Keep in the same plane for 2D offset

      offset = new THREE.Vector3(offsetX, offsetY, offsetZ);
    } else {
      // Default minimal offset if mapType is unrecognized
      offset = new THREE.Vector3(1, 1, 0);
    }

    this.offsets.set(star, offset);
    return offset;
  }

  /**
   * Creates a 3D sprite for the given star and adds a connecting line.
   * Ensures accurate positioning for TrueCoordinates and maintains Globe functionality.
   * @param {Object} star - The star object.
   */
  createSpriteAndLine(star) {
    // Use star.displayColor for the label background tint
    const starColor = star.displayColor || '#888888';

    // Create a canvas for the label
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const baseFontSize = 24; // Base font size in pixels

    // Adjust font size based on star size for proportionality
    const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5); // Clamp between 1 and 5
    const fontSize = baseFontSize * scaleFactor;
    ctx.font = `${fontSize}px Arial`;

    // Measure text to set canvas size
    const textMetrics = ctx.measureText(star.displayName);
    const textWidth = textMetrics.width;
    const textHeight = fontSize; // Approximate text height

    // Set canvas size with padding
    const paddingX = 10; // 10px padding on each side
    const paddingY = 5;  // 5px padding top and bottom
    canvas.width = textWidth + paddingX * 2;
    canvas.height = textHeight + paddingY * 2;

    // Redefine font after resizing canvas
    ctx.font = `${fontSize}px Arial`;

    // Draw translucent background with reduced opacity
    ctx.fillStyle = hexToRGBA(starColor, 0.2); // Reduced opacity from 0.3 to 0.2
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw white text
    ctx.fillStyle = '#ffffff'; // White text
    ctx.textBaseline = 'middle';
    ctx.fillText(
      star.displayName,
      paddingX,
      canvas.height / 2
    );

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Create sprite material
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      depthWrite: true,
      depthTest: true,
      transparent: true,
    });

    // Create sprite
    const sprite = new THREE.Sprite(spriteMaterial);

    // Scale sprite based on canvas size and star size
    const spriteScale = new THREE.Vector3(
      (canvas.width / 100) * scaleFactor,  // Adjust scaling factors as needed
      (canvas.height / 100) * scaleFactor,
      1
    );
    sprite.scale.copy(spriteScale);

    // Determine position based on mapType
    let starPosition;
    if (this.mapType === 'TrueCoordinates') {
      starPosition = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    } else {
      if (!star.spherePosition) {
        console.warn('Star missing spherePosition:', star);
        return;
      }
      starPosition = new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);
    }

    // Apply offset
    const offset = this.generateOffset(star);
    const labelPosition = starPosition.clone().add(offset);
    sprite.position.copy(labelPosition);

    // Add sprite to scene and map
    this.scene.add(sprite);
    this.sprites.set(star, sprite);

    // Create connecting line
    const points = [];
    points.push(starPosition);
    points.push(labelPosition);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

    const lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(hexToRGBA(starColor, 0.2)),
      transparent: true,
      opacity: 0.2, // Reduced opacity
      linewidth: 2,  // Attempt to set thicker lines (Note: WebGL may not support >1)
    });

    const line = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(line);
    this.lines.set(star, line);
  }

  /**
   * Updates all star labels and connecting lines.
   * For each star, if there's no sprite, create it. Then position it.
   * @param {Array} stars - Array of star objects to display.
   */
  updateLabels(stars) {
    // Ensure we have a sprite and line for each star
    stars.forEach(star => {
      if (!this.sprites.has(star)) {
        this.createSpriteAndLine(star);
      } else {
        // Update existing sprite and line
        const sprite = this.sprites.get(star);
        const line = this.lines.get(star);
        if (sprite && line) {
          // Adjust font size and sprite scale based on star size
          const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5); // Clamp between 1 and 5
          const fontSize = 24 * scaleFactor; // Base font size scaled

          // Update canvas
          const canvas = sprite.material.map.image;
          const ctx = canvas.getContext('2d');
          ctx.font = `${fontSize}px Arial`;

          // Measure text to set canvas size
          const textMetrics = ctx.measureText(star.displayName);
          const textWidth = textMetrics.width;
          const textHeight = fontSize; // Approximate text height

          // Resize canvas
          const paddingX = 10;
          const paddingY = 5;
          canvas.width = textWidth + paddingX * 2;
          canvas.height = textHeight + paddingY * 2;

          // Redefine font after resizing
          ctx.font = `${fontSize}px Arial`;

          // Redraw background with reduced opacity
          ctx.fillStyle = hexToRGBA(star.displayColor || '#888888', 0.2);
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Redraw white text
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            star.displayName,
            paddingX,
            canvas.height / 2
          );

          // Update texture
          sprite.material.map.needsUpdate = true;

          // Update sprite scale
          sprite.scale.set(
            (canvas.width / 100) * scaleFactor,
            (canvas.height / 100) * scaleFactor,
            1
          );

          // Update position based on mapType
          let starPosition;
          if (this.mapType === 'TrueCoordinates') {
            starPosition = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
          } else {
            if (!star.spherePosition) {
              console.warn('Star missing spherePosition:', star);
              return;
            }
            starPosition = new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);
          }

          // Recompute offset with proportional adjustment
          const offset = this.generateOffset(star);
          const labelPosition = starPosition.clone().add(offset);
          sprite.position.copy(labelPosition);

          // Update connecting line geometry and material
          const points = [];
          points.push(starPosition);
          points.push(labelPosition);
          line.geometry.setFromPoints(points);

          // Update line color and opacity
          line.material.color.setHex(new THREE.Color(hexToRGBA(star.displayColor || '#888888', 0.2)).getHex());
          line.material.opacity = 0.2; // Ensure opacity remains consistent
        }
      }
    });

    // Remove sprites and lines for stars that are no longer present
    this.sprites.forEach((sprite, star) => {
      if (!stars.includes(star)) {
        this.scene.remove(sprite);
        this.sprites.delete(star);

        // Remove corresponding line
        const line = this.lines.get(star);
        if (line) {
          this.scene.remove(line);
          this.lines.delete(star);
        }
      }
    });
  }

  /**
   * Hides a star's label and connecting line
   * @param {Object} star - The star object.
   */
  hideLabel(star) {
    if (this.sprites.has(star)) {
      this.sprites.get(star).visible = false;
    }
    if (this.lines.has(star)) {
      this.lines.get(star).visible = false;
    }
  }

  /**
   * Shows a star's label and connecting line
   * @param {Object} star - The star object.
   */
  showLabel(star) {
    if (this.sprites.has(star)) {
      this.sprites.get(star).visible = true;
    }
    if (this.lines.has(star)) {
      this.lines.get(star).visible = true;
    }
  }

  /**
   * Removes all sprite labels and connecting lines from the scene.
   */
  removeLabels() {
    this.sprites.forEach((sprite, star) => {
      this.scene.remove(sprite);
    });
    this.sprites.clear();

    this.lines.forEach((line, star) => {
      this.scene.remove(line);
    });
    this.lines.clear();
  }
}
