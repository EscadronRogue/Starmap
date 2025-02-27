// filters/densityColorUtils.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * Lightens a THREE.Color by increasing its lightness.
 */
export function lightenColor(color, factor) {
  let hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.l = Math.min(1, hsl.l + factor);
  let newColor = new THREE.Color();
  newColor.setHSL(hsl.h, hsl.s, hsl.l);
  return newColor;
}

/**
 * Darkens a THREE.Color by decreasing its lightness.
 */
export function darkenColor(color, factor) {
  let hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.l = Math.max(0, hsl.l - factor);
  let newColor = new THREE.Color();
  newColor.setHSL(hsl.h, hsl.s, hsl.l);
  return newColor;
}

/**
 * Derives a base color from a constellation name by hashing it into a hue.
 */
export function getBaseColor(constName) {
  let hash = 0;
  for (let i = 0; i < constName.length; i++) {
    hash = constName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = (hash % 360 + 360) % 360;
  return new THREE.Color(`hsl(${hue}, 70%, 50%)`);
}

/**
 * Returns a blue color based on a constellation name.
 * This forces the hue into the blue range (200 to 240).
 */
export function getBlueColor(constName) {
  let hash = 0;
  for (let i = 0; i < constName.length; i++) {
    hash = constName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = 200 + (Math.abs(hash) % 41); // hue between 200 and 240
  return new THREE.Color(`hsl(${hue}, 70%, 50%)`);
}

/**
 * Returns a double‑sided shader material for labels.
 */
export function getDoubleSidedLabelMaterial(texture, opacity = 1.0) {
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
