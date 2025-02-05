// labelManager.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { hexToRGBA } from './utils.js';

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  return hash;
}

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
    this.offsets = new Map();
    this.lastLabelUpdate = 0;
  }

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
      let starPos;
      if (star.spherePosition) {
        starPos = new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);
      } else {
        console.warn('Missing spherePosition for star in LabelManager.generateOffset');
        starPos = new THREE.Vector3(0, 0, 0);
      }
      const normal = starPos.clone().normalize();
      let tangent = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) {
        tangent = new THREE.Vector3(1, 0, 0);
      }
      tangent = tangent.cross(normal).normalize();
      const bitangent = normal.clone().cross(tangent).normalize();
      const hash = hashString(star.displayName || star.Common_name_of_the_star || 'Star');
      const angle = (hash % 360) * (Math.PI / 180);
      const baseDistance = 2;
      const sizeFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
      offset = tangent.clone().multiplyScalar(Math.cos(angle))
                .add(bitangent.clone().multiplyScalar(Math.sin(angle)))
                .multiplyScalar(baseDistance * sizeFactor);
    } else {
      offset = new THREE.Vector3(1, 1, 0);
    }
    this.offsets.set(star, offset);
    return offset;
  }

  createSpriteAndLine(star) {
    const starColor = star.displayColor || '#888888';
    const baseFontSize = this.mapType === 'Globe' ? 64 : 24;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
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
    
    let labelObj;
    if (this.mapType === 'Globe') {
      const planeGeom = new THREE.PlaneGeometry((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor);
      const material = getDoubleSidedLabelMaterial(texture);
      labelObj = new THREE.Mesh(planeGeom, material);
      
      let starPosition = new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);
      const offset = this.generateOffset(star);
      const labelPosition = starPosition.clone().add(offset);
      labelObj.position.copy(labelPosition);
      
      const normal = starPosition.clone().normalize();
      const globalUp = new THREE.Vector3(0, 1, 0);
      let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
      if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
      else desiredUp.normalize();
      const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
      const matrix = new THREE.Matrix4();
      matrix.makeBasis(desiredRight, desiredUp, normal);
      labelObj.setRotationFromMatrix(matrix);
      labelObj.renderOrder = 1;
    } else {
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        depthWrite: true,
        depthTest: true,
        transparent: true,
      });
      labelObj = new THREE.Sprite(spriteMaterial);
      const spriteScale = new THREE.Vector3(
        (canvas.width / 100) * scaleFactor,
        (canvas.height / 100) * scaleFactor,
        1
      );
      labelObj.scale.copy(spriteScale);
      let starPosition = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
      const offset = this.generateOffset(star);
      const labelPosition = starPosition.clone().add(offset);
      labelObj.position.copy(labelPosition);
    }
    this.scene.add(labelObj);
    this.sprites.set(star, labelObj);
    
    let starPosition;
    if (this.mapType === 'TrueCoordinates') {
      starPosition = new THREE.Vector3(star.x_coordinate, star.y_coordinate, star.z_coordinate);
    } else {
      starPosition = new THREE.Vector3(star.spherePosition.x, star.spherePosition.y, star.spherePosition.z);
    }
    const points = [starPosition, labelObj.position.clone()];
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(star.displayColor || '#888888'),
      transparent: true,
      opacity: 0.2,
      linewidth: 2,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.renderOrder = 1;
    this.scene.add(line);
    this.lines.set(star, line);
  }

  updateLabels(stars) {
    const now = performance.now();
    // Throttle label updates to every 100ms instead of 33ms to reduce load
    if (now - this.lastLabelUpdate < 100) return;
    this.lastLabelUpdate = now;
    stars.forEach(star => {
      if (!this.sprites.has(star)) {
        this.createSpriteAndLine(star);
      } else {
        const labelObj = this.sprites.get(star);
        const line = this.lines.get(star);
        const scaleFactor = THREE.MathUtils.clamp(star.displaySize / 2, 1, 5);
        const baseFontSize = this.mapType === 'Globe' ? 64 : 24;
        const fontSize = baseFontSize * scaleFactor;
        const canvas = this.mapType === 'Globe'
          ? labelObj.material.uniforms.map.value.image
          : labelObj.material.map.image;
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
        if (this.mapType === 'Globe') {
          labelObj.material.uniforms.map.value.needsUpdate = true;
        } else {
          labelObj.material.map.needsUpdate = true;
          labelObj.scale.set((canvas.width / 100) * scaleFactor, (canvas.height / 100) * scaleFactor, 1);
        }
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
        const offset = this.generateOffset(star);
        const labelPosition = starPosition.clone().add(offset);
        labelObj.position.copy(labelPosition);
        const points = [starPosition, labelObj.position.clone()];
        line.geometry.setFromPoints(points);
        line.material.color.set(new THREE.Color(star.displayColor || '#888888'));
        line.material.opacity = 0.2;
      }
    });
    this.sprites.forEach((labelObj, star) => {
      if (!stars.includes(star)) {
        this.scene.remove(labelObj);
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
    if (this.sprites.has(star)) this.sprites.get(star).visible = false;
    if (this.lines.has(star)) this.lines.get(star).visible = false;
  }

  showLabel(star) {
    if (this.sprites.has(star)) this.sprites.get(star).visible = true;
    if (this.lines.has(star)) this.lines.get(star).visible = true;
  }

  removeLabels() {
    this.sprites.forEach((labelObj, star) => {
      this.scene.remove(labelObj);
    });
    this.sprites.clear();
    this.lines.forEach((line, star) => {
      this.scene.remove(line);
    });
    this.lines.clear();
  }
}
