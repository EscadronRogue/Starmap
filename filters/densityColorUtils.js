// File: /filters/densityColorUtils.js
// This file contains color utility functions used for generating blue‐based colors.

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

export function lightenColor(color, factor) {
  let hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.l = Math.min(1, hsl.l + factor);
  let newColor = new THREE.Color();
  newColor.setHSL(hsl.h, hsl.s, hsl.l);
  return newColor;
}

export function darkenColor(color, factor) {
  let hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.l = Math.max(0, hsl.l - factor);
  let newColor = new THREE.Color();
  newColor.setHSL(hsl.h, hsl.s, hsl.l);
  return newColor;
}

export function getBaseColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = (hash % 360 + 360) % 360;
  return new THREE.Color(`hsl(${hue}, 70%, 50%)`);
}

export function getBlueColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = 200 + (Math.abs(hash) % 41); // hue between 200 and 240
  return new THREE.Color(`hsl(${hue}, 70%, 50%)`);
}

export function getIndividualBlueColor(seedStr) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  let normalized = (Math.abs(hash) % 1000) / 1000;
  let hue = 180 + normalized * 80; // hue between 180 and 260
  let saturation = 70;
  let lightness = 50;
  return new THREE.Color(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
}

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
