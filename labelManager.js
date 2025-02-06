// labelManager.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { hexToRGBA } from './utils.js';

/**
 * Returns a ShaderMaterial that renders a texture double‑sided without mirroring.
 */
function getDoubleSidedLabelMaterial(texture, opacity = 1.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: { value: opacity }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec2 uvCorrected = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
        vec4 color = texture2D(map, uvCorrected);
        gl_FragColor = vec4(color.rgb, color.a * opacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide
  });
}

export class LabelManager {
  constructor(mapType, scene) {
    this.mapType = mapType;
    this.scene = scene;

    // We store references to the label objects (meshes/sprites) and lines
    this.sprites = new Map();
    this.lines = new Map();

    // For quickly detecting if label text/color changed
    this.labelCache = new Map(); 
    // e.g. labelCache.set(star, { lastText: 'Sirius', lastColor: '#ffffff', /* ... */ });
  }

  /**
   * Creates or updates the sprite and line for the given star.
   * This is only called when we know something about the star changed
   * (display name, color, size, or the star is newly filtered in).
   */
  createOrUpdateLabel(star) {
    const starColor = star.displayColor || '#888888';
    const displayName = star.displayName || '';

    // Check if we have a label cache entry and if text/color changed
    const cached = this.labelCache.get(star) || {};
    const textChanged = (cached.lastText !== displayName);
    const colorChanged = (cached.lastColor !== starColor);
    const sizeChanged = (cached.lastSize !== star.displaySize);

    // If label already exists, we only rebuild the texture if text or color changed
    let labelObj = this.sprites.get(star);
    let lineObj = this.lines.get(star);

    // If the label doesn't exist yet, or if something changed that requires a rebuild:
    if (!labelObj || textChanged || colorChanged || sizeChanged) {
      // If we already had a label, remove it from scene first
      if (labelObj) this.scene.remove(labelObj);
      if (lineObj) this.scene.remove(lineObj);

      // (Re)create the label
      const baseFontSize = (this.mapType === 'Globe' ? 64 : 24);
      const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
      const fontSize = baseFontSize * scaleFactor;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = `${fontSize}px Arial`;
      const textMetrics = ctx.measureText(displayName);
      const textWidth = textMetrics.width;
      const textHeight = fontSize;
      const paddingX = 10;
      const paddingY = 5;
      canvas.width = textWidth + paddingX * 2;
      canvas.height = textHeight + paddingY * 2;

      // Re-draw background + text
      ctx.font = `${fontSize}px Arial`;
      ctx.fillStyle = hexToRGBA(starColor, 0.2);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayName, paddingX, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;

      if (this.mapType === 'Globe') {
        // Create plane for label
        const planeGeom = new THREE.PlaneGeometry(
          (canvas.width / 100) * scaleFactor,
          (canvas.height / 100) * scaleFactor
        );
        const material = getDoubleSidedLabelMaterial(texture);
        labelObj = new THREE.Mesh(planeGeom, material);
        labelObj.renderOrder = 1;
      } else {
        // TrueCoordinates -> use Sprite
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          depthWrite: true,
          depthTest: true,
          transparent: true,
        });
        labelObj = new THREE.Sprite(spriteMaterial);
        labelObj.scale.set(
          (canvas.width / 100) * scaleFactor,
          (canvas.height / 100) * scaleFactor,
          1
        );
      }

      // Store them so we can reuse
      this.sprites.set(star, labelObj);

      // Now create the line
      const lineGeometry = new THREE.BufferGeometry();
      const lineMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(starColor),
        transparent: true,
        opacity: 0.2,
        linewidth: 2,
      });
      lineObj = new THREE.Line(lineGeometry, lineMaterial);
      lineObj.renderOrder = 1;
      this.lines.set(star, lineObj);

      // Save to cache
      this.labelCache.set(star, {
        lastText: displayName,
        lastColor: starColor,
        lastSize: star.displaySize
      });
    }

    // Make sure they're in the scene 
    if (!this.scene.children.includes(labelObj)) {
      this.scene.add(labelObj);
    }
    if (!this.scene.children.includes(lineObj)) {
      this.scene.add(lineObj);
    }

    // Update positions:
    const starPosition = (this.mapType === 'TrueCoordinates')
      ? new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate)
      : new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);

    // Offset for label (so it’s not exactly at the star)
    const offset = this.computeLabelOffset(star, starPosition);
    const labelPosition = starPosition.clone().add(offset);
    labelObj.position.copy(labelPosition);

    // For Globe: re-orient the plane so it’s tangent to the sphere
    if (this.mapType === 'Globe' && labelObj instanceof THREE.Mesh) {
      const normal = starPosition.clone().normalize();
      const globalUp = new THREE.Vector3(0, 1, 0);
      let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
      if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
      else desiredUp.normalize();
      const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
      const matrix = new THREE.Matrix4().makeBasis(desiredRight, desiredUp, normal);
      labelObj.setRotationFromMatrix(matrix);
    }

    // Update line positions
    const points = [starPosition, labelPosition];
    lineObj.geometry.setFromPoints(points);
    lineObj.material.color.set(star.displayColor || '#888888');
  }

  /**
   * Compute an offset vector to position the label away from the star.
   */
  computeLabelOffset(star, starPos) {
    // You can keep your existing offset logic. 
    // For example:
    if (this.mapType === 'TrueCoordinates') {
      // just a small offset in X, Y
      return new THREE.Vector3(1, 1, 0).multiplyScalar(
        THREE.MathUtils.clamp(star.displaySize / 2, 0.5, 1.5)
      );
    } else {
      // tangent offset for Globe
      const normal = starPos.clone().normalize();
      let tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) {
        tangent = new THREE.Vector3(1, 0, 0);
      }
      tangent.cross(normal).normalize();
      const bitangent = normal.clone().cross(tangent).normalize();
      // angle + scale for distribution 
      const angle = Math.random() * Math.PI * 2;
      const baseDistance = 2;
      const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
      return tangent.clone().multiplyScalar(Math.cos(angle))
        .add(bitangent.clone().multiplyScalar(Math.sin(angle)))
        .multiplyScalar(baseDistance * scaleFactor);
    }
  }

  /**
   * Called once when the filter or star set changes. 
   * We create or update labels for all stars in the new array 
   * and remove labels that no longer appear.
   */
  refreshLabels(stars) {
    const setOfStars = new Set(stars);

    // Create or update labels for every star in the new set
    for (const star of stars) {
      if (star.displayVisible) {
        this.createOrUpdateLabel(star);
      }
    }

    // Remove labels for any star not in the new set
    // (or star is no longer displayVisible)
    this.sprites.forEach((obj, star) => {
      if (!setOfStars.has(star) || !star.displayVisible) {
        this.scene.remove(obj);
        this.sprites.delete(star);
        const line = this.lines.get(star);
        if (line) {
          this.scene.remove(line);
          this.lines.delete(star);
        }
        this.labelCache.delete(star);
      }
    });
  }

  removeAllLabels() {
    this.sprites.forEach((obj, star) => {
      this.scene.remove(obj);
    });
    this.lines.forEach((obj, star) => {
      this.scene.remove(obj);
    });
    this.sprites.clear();
    this.lines.clear();
    this.labelCache.clear();
  }
}
