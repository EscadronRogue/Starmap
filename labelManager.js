// labelManager.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { hexToRGBA } from './utils.js';

/**
 * Simple hash function to generate a consistent number from a string.
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  return hash;
}

/**
 * LabelManager Class
 * Manages 3D sprite labels and connecting lines.
 */
export class LabelManager {
  /**
   * @param {string} mapType - 'TrueCoordinates' or 'Globe'
   * @param {THREE.Scene} scene - The scene to which labels and lines are added.
   */
  constructor(mapType, scene) {
    this.mapType = mapType;
    this.scene = scene;
    this.sprites = new Map();
    this.lines = new Map();
    this.offsets = new Map();
    // For throttling label updates
    this.lastLabelUpdate = 0;
  }

  /**
   * Generates an offset for a star’s label.
   * For Globe mode, the offset is computed in the tangent plane (i.e. the plane perpendicular
   * to the globe surface at the star’s position) using a hash-based random angle.
   */
  generateOffset(star) {
    if (this.offsets.has(star)) {
      return this.offsets.get(star);
    }
    let offset;
    if (this.mapType === 'TrueCoordinates') {
      const baseOffset = new THREE.Vector3(1, 1, 0);
      const sizeMultiplier = THREE.MathUtils.clamp(star.displaySize / 2, 0.5, 1.5);
      offset = baseOffset.clone().multiplyScalar(sizeMultiplier);
    } else if (this.mapType === 'Globe') {
      // Get the star's sphere position
      let starPosition;
      if (!star.spherePosition) {
        starPosition = new THREE.Vector3(0, 0, 0);
      } else {
        starPosition = new THREE.Vector3(
          star.spherePosition.x,
          star.spherePosition.y,
          star.spherePosition.z
        );
      }
      // Compute the normal (same as the normalized position)
      const normal = starPosition.clone().normalize();
      // Choose an arbitrary vector that is not parallel to the normal
      let arbitrary = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(arbitrary)) > 0.99) {
        arbitrary.set(1, 0, 0);
      }
      // Create two orthogonal tangent vectors spanning the tangent plane
      const tangent1 = new THREE.Vector3().crossVectors(normal, arbitrary).normalize();
      const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();
      // Use a hash-based angle to ensure consistency for this star
      const hash = hashString(star.displayName || star.Common_name_of_the_star || 'Star');
      const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
      const baseDistance = 2; // base offset distance (adjust as needed)
      const sizeFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
      // Compute the offset in the tangent plane
      offset = tangent1.clone().multiplyScalar(Math.cos(angle))
        .add(tangent2.clone().multiplyScalar(Math.sin(angle)))
        .multiplyScalar(baseDistance * sizeFactor);
    } else {
      offset = new THREE.Vector3(1, 1, 0);
    }
    this.offsets.set(star, offset);
    return offset;
  }

  /**
   * Creates a 3D sprite for a star and its connecting line.
   */
  createSpriteAndLine(star) {
    const starColor = star.displayColor || '#888888';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const baseFontSize = 24;
    const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
    const fontSize = baseFontSize * scaleFactor;
    ctx.font = `${fontSize}px Arial`;
    const textMetrics = ctx.measureText(star.displayName);
    const textWidth = textMetrics.width;
    const textHeight = fontSize;
    const paddingX = 10;
    const paddingY = 5;
    canvas.width = textWidth + paddingX * 2;
    canvas.height = textHeight + paddingY * 2;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = hexToRGBA(starColor, 0.2);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(star.displayName, paddingX, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      depthWrite: true,
      depthTest: true,
      transparent: true,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    const spriteScale = new THREE.Vector3(
      (canvas.width / 100) * scaleFactor,
      (canvas.height / 100) * scaleFactor,
      1
    );
    sprite.scale.copy(spriteScale);
    let starPosition;
    if (this.mapType === 'TrueCoordinates') {
      starPosition = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    } else {
      if (!star.spherePosition) {
        console.warn('Star missing spherePosition:', star);
        return;
      }
      starPosition = new THREE.Vector3(
        star.spherePosition.x,
        star.spherePosition.y,
        star.spherePosition.z
      );
    }
    const offset = this.generateOffset(star);
    const labelPosition = starPosition.clone().add(offset);
    sprite.position.copy(labelPosition);
    this.scene.add(sprite);
    this.sprites.set(star, sprite);

    const points = [starPosition, labelPosition];
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(starColor),
      transparent: true,
      opacity: 0.2,
      linewidth: 2,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(line);
    this.lines.set(star, line);
  }

  /**
   * Updates all star labels and connecting lines.
   * Throttles updates to roughly 30 FPS.
   */
  updateLabels(stars) {
    const now = performance.now();
    if (now - this.lastLabelUpdate < 33) {
      return;
    }
    this.lastLabelUpdate = now;

    stars.forEach(star => {
      if (!this.sprites.has(star)) {
        this.createSpriteAndLine(star);
      } else {
        const sprite = this.sprites.get(star);
        const line = this.lines.get(star);
        if (sprite && line) {
          const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
          const fontSize = 24 * scaleFactor;
          const canvas = sprite.material.map.image;
          const ctx = canvas.getContext('2d');
          ctx.font = `${fontSize}px Arial`;
          const textMetrics = ctx.measureText(star.displayName);
          const textWidth = textMetrics.width;
          const textHeight = fontSize;
          const paddingX = 10;
          const paddingY = 5;
          canvas.width = textWidth + paddingX * 2;
          canvas.height = textHeight + paddingY * 2;
          ctx.font = `${fontSize}px Arial`;
          ctx.fillStyle = hexToRGBA(star.displayColor || '#888888', 0.2);
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'middle';
          ctx.fillText(star.displayName, paddingX, canvas.height / 2);
          sprite.material.map.needsUpdate = true;
          sprite.scale.set(
            (canvas.width / 100) * scaleFactor,
            (canvas.height / 100) * scaleFactor,
            1
          );
          let starPosition;
          if (this.mapType === 'TrueCoordinates') {
            starPosition = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
          } else {
            if (!star.spherePosition) {
              console.warn('Star missing spherePosition:', star);
              return;
            }
            starPosition = new THREE.Vector3(
              star.spherePosition.x,
              star.spherePosition.y,
              star.spherePosition.z
            );
          }
          const offset = this.generateOffset(star);
          const labelPosition = starPosition.clone().add(offset);
          sprite.position.copy(labelPosition);
          const points = [starPosition, labelPosition];
          line.geometry.setFromPoints(points);
          line.material.color.set(new THREE.Color(star.displayColor || '#888888'));
          line.material.opacity = 0.2;
        }
      }
    });

    // Remove sprites and lines for stars no longer present
    this.sprites.forEach((sprite, star) => {
      if (!stars.includes(star)) {
        this.scene.remove(sprite);
        this.sprites.delete(star);
        const line = this.lines.get(star);
        if (line) {
          this.scene.remove(line);
          this.lines.delete(star);
        }
      }
    });
  }

  hideLabel(star) {
    if (this.sprites.has(star)) {
      this.sprites.get(star).visible = false;
    }
    if (this.lines.has(star)) {
      this.lines.get(star).visible = false;
    }
  }

  showLabel(star) {
    if (this.sprites.has(star)) {
      this.sprites.get(star).visible = true;
    }
    if (this.lines.has(star)) {
      this.lines.get(star).visible = true;
    }
  }

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
