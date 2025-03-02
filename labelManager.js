import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { hexToRGBA } from './utils.js';

/**
 * Returns a ShaderMaterial that renders a texture double‑sided.
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
    this.sprites = new Map();
    this.lines = new Map();
    this.labelCache = new Map(); 
  }

  /**
   * Creates or updates the label and connecting line for a star.
   */
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
      // For Globe, use 64px; for Cylindrical (2D) use a larger size (e.g. 32px) than TrueCoordinates (24px)
      let baseFontSize;
      if (this.mapType === 'Globe') {
        baseFontSize = 64;
      } else if (this.mapType === 'Cylindrical') {
        baseFontSize = 32; // Bigger text for 2D map
      } else {
        baseFontSize = 24;
      }
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
        const planeGeom = new THREE.PlaneGeometry((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor);
        const material = getDoubleSidedLabelMaterial(texture);
        labelObj = new THREE.Mesh(planeGeom, material);
        labelObj.renderOrder = 1;
      } else {
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          depthWrite: true,
          depthTest: true,
          transparent: true,
        });
        labelObj = new THREE.Sprite(spriteMaterial);
        labelObj.scale.set((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor, 1);
      }
      this.sprites.set(star, labelObj);
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
      this.labelCache.set(star, { lastText: displayName, lastColor: starColor, lastSize: star.displaySize });
    }
    if (!this.scene.children.includes(labelObj)) {
      this.scene.add(labelObj);
    }
    if (!this.scene.children.includes(lineObj)) {
      this.scene.add(lineObj);
    }
    let starPos;
    if (this.mapType === 'TrueCoordinates') {
      starPos = star.truePosition ? new THREE.Vector3(star.truePosition.x, star.truePosition.y, star.truePosition.z)
                                   : new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    } else if (this.mapType === 'Globe') {
      starPos = star.spherePosition ? new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z)
                                    : new THREE.Vector3(0, 0, 0);
    } else {
      starPos = star.cylindricalPosition ? star.cylindricalPosition.clone() : new THREE.Vector3(0, 0, 0);
    }
    const offset = this.computeLabelOffset(star, starPos);
    const labelPos = starPos.clone().add(offset);
    labelObj.position.copy(labelPos);
    if (this.mapType === 'Globe') {
      const normal = starPos.clone().normalize();
      const globalUp = new THREE.Vector3(0, 1, 0);
      let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
      if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
      else desiredUp.normalize();
      const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
      const matrix = new THREE.Matrix4().makeBasis(desiredRight, desiredUp, normal);
      labelObj.setRotationFromMatrix(matrix);
    }
    // For 2D cylindrical, no rotation.
    const points = [starPos, labelPos];
    lineObj.geometry.setFromPoints(points);
    lineObj.material.color.set(star.displayColor || '#888888');
  }

  computeLabelOffset(star, starPos) {
    if (this.mapType === 'TrueCoordinates') {
      return new THREE.Vector3(1, 1, 0).multiplyScalar(THREE.MathUtils.clamp(star.displaySize / 2, 0.5, 1.5));
    } else if (this.mapType === 'Cylindrical') {
      // For 2D, add a fixed pixel offset.
      return new THREE.Vector3(5, -5, 0);
    } else {
      const normal = starPos.clone().normalize();
      let tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) {
        tangent = new THREE.Vector3(1, 0, 0);
      }
      tangent.cross(normal).normalize();
      const bitangent = normal.clone().cross(tangent).normalize();
      const angle = Math.random() * Math.PI * 2;
      const baseDistance = 2;
      const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
      return tangent.clone().multiplyScalar(Math.cos(angle))
        .add(bitangent.clone().multiplyScalar(Math.sin(angle)))
        .multiplyScalar(baseDistance * scaleFactor);
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
