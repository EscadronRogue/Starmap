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
    // Separate caches per map instance.
    this.sprites = new Map();
    this.lines = new Map();
    this.labelCache = new Map(); 
  }

  createOrUpdateLabel(star) {
    const starColor = star.displayColor || '#888888';
    const displayName = star.displayName || '';
    const cached = this.labelCache.get(star) || {};
    const textChanged = (cached.lastText !== displayName);
    const colorChanged = (cached.lastColor !== starColor);
    const sizeChanged = (cached.lastSize !== star.displaySize);
    let labelObj = this.sprites.get(star);
    let lineObj = this.lines.get(star);
    const needsRebuild = (!labelObj || textChanged || colorChanged || sizeChanged);

    if (needsRebuild) {
      if (labelObj) this.scene.remove(labelObj);
      if (lineObj) this.scene.remove(lineObj);

      // Choose base font size; larger for Globe map since we use plane geometry.
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
      ctx.font = `${fontSize}px Arial`;
      ctx.fillStyle = hexToRGBA(starColor, 0.2);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayName, paddingX, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;

      if (this.mapType === 'Globe') {
        // Use a plane so we can rotate it tangent to the sphere.
        const planeGeom = new THREE.PlaneGeometry((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor);
        const material = getDoubleSidedLabelMaterial(texture);
        labelObj = new THREE.Mesh(planeGeom, material);
        labelObj.renderOrder = 1;
      } else if (this.mapType === 'TrueCoordinates') {
        // For TrueCoordinates, use a sprite with a small scale.
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          depthWrite: true,
          depthTest: true,
          transparent: true,
        });
        labelObj = new THREE.Sprite(spriteMaterial);
        labelObj.scale.set((canvas.width / 100) * scaleFactor * 0.22, (canvas.height / 100) * scaleFactor * 0.22, 1);
      } else if (this.mapType === 'Cylindrical') {
        // For Cylindrical, use a sprite with a larger scale so it’s readable.
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          depthWrite: true,
          depthTest: true,
          transparent: true,
        });
        labelObj = new THREE.Sprite(spriteMaterial);
        labelObj.scale.set((canvas.width / 100) * scaleFactor * 0.5, (canvas.height / 100) * scaleFactor * 0.5, 1);
      }

      this.sprites.set(star, labelObj);

      // Create connecting line between star and its label.
      const lineGeom = new THREE.BufferGeometry();
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(starColor),
        transparent: true,
        opacity: 0.2,
        linewidth: 2,
      });
      lineObj = new THREE.Line(lineGeom, lineMat);
      lineObj.renderOrder = 1;
      this.lines.set(star, lineObj);

      // Update our cache.
      this.labelCache.set(star, {
        lastText: displayName,
        lastColor: starColor,
        lastSize: star.displaySize
      });
    }

    if (!this.scene.children.includes(labelObj)) {
      this.scene.add(labelObj);
    }
    if (!this.scene.children.includes(lineObj)) {
      this.scene.add(lineObj);
    }

    // Determine the star's position in the appropriate coordinate system.
    let starPos;
    if (this.mapType === 'TrueCoordinates') {
      starPos = star.truePosition
        ? new THREE.Vector3(star.truePosition.x, star.truePosition.y, star.truePosition.z)
        : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    } else if (this.mapType === 'Globe') {
      starPos = new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);
    } else if (this.mapType === 'Cylindrical') {
      starPos = new THREE.Vector3(star.cylindricalPosition.x, star.cylindricalPosition.y, 0);
    }

    // Compute an offset for the label.
    const offset = this.computeLabelOffset(star, starPos);
    const labelPos = starPos.clone().add(offset);
    labelObj.position.copy(labelPos);

    // For Globe labels, orient the plane tangent to the sphere.
    if (this.mapType === 'Globe' && (labelObj instanceof THREE.Mesh)) {
      const normal = starPos.clone().normalize();
      const globalUp = new THREE.Vector3(0, 1, 0);
      let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
      if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
      else desiredUp.normalize();
      const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
      const matrix = new THREE.Matrix4().makeBasis(desiredRight, desiredUp, normal);
      labelObj.setRotationFromMatrix(matrix);
    }
    
    // Draw a connecting line between the star and its label.
    const points = [starPos, labelPos];
    lineObj.geometry.setFromPoints(points);
    lineObj.material.color.set(new THREE.Color(star.displayColor || '#888888'));
  }

  /**
   * Computes the label offset based on the map type.
   * For TrueCoordinates, no offset is applied.
   * For Globe, a random tangent offset is computed.
   * For Cylindrical, a fixed downward offset is used.
   */
  computeLabelOffset(star, starPos) {
    if (this.mapType === 'TrueCoordinates') {
      return new THREE.Vector3(0, 0, 0);
    } else if (this.mapType === 'Globe') {
      const normal = starPos.clone().normalize();
      let tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) tangent = new THREE.Vector3(1, 0, 0);
      tangent.cross(normal).normalize();
      const bitangent = normal.clone().cross(tangent).normalize();
      const angle = Math.random() * Math.PI * 2;
      const baseDistance = 2;
      const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
      return tangent.clone().multiplyScalar(Math.cos(angle))
             .add(bitangent.clone().multiplyScalar(Math.sin(angle)))
             .multiplyScalar(baseDistance * scaleFactor);
    } else if (this.mapType === 'Cylindrical') {
      // Fixed offset (e.g. 20 pixels downward) so the label appears below the star.
      return new THREE.Vector3(0, 20, 0);
    }
  }

  refreshLabels(stars) {
    const inNewSet = new Set(stars);
    stars.forEach(star => {
      if (star.displayVisible) {
        this.createOrUpdateLabel(star);
      }
    });
    this.sprites.forEach((labelObj, star) => {
      if (!inNewSet.has(star) || !star.displayVisible) {
        this.scene.remove(labelObj);
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
    this.sprites.forEach(obj => this.scene.remove(obj));
    this.lines.forEach(obj => this.scene.remove(obj));
    this.sprites.clear();
    this.lines.clear();
    this.labelCache.clear();
  }
}
