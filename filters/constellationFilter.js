// /filters/constellationFilter.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let boundaryData = [];
let centerData = [];

export let globeConstellationLines = [];
export let globeConstellationLabels = [];

export async function loadConstellationBoundaries() {
  try {
    // Instead of loading the legacy text file, load the JSON data directly.
    const resp = await fetch('constellation_boundaries.json');
    if (!resp.ok) throw new Error(`Failed to load constellation_boundaries.json: ${resp.status}`);
    boundaryData = await resp.json();
    console.log(`[ConstellationFilter] Boundaries: loaded ${boundaryData.length} entries from JSON.`);
  } catch (err) {
    console.error('Error loading constellation boundaries JSON:', err);
    boundaryData = [];
  }
}

export async function loadConstellationCenters() {
  try {
    const resp = await fetch('constellation_center.txt');
    if (!resp.ok) throw new Error(`Failed to load constellation_center.txt: ${resp.status}`);
    const raw = await resp.text();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
    centerData = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const raStr = parts[1];
      const decStr = parts[2];
      const matchName = line.match(/"([^"]+)"/);
      const name = matchName ? matchName[1] : 'Unknown';
      const raVal = parseRA(raStr);
      const decVal = parseDec(decStr);
      centerData.push({ ra: raVal, dec: decVal, name });
    }
    console.log(`[ConstellationFilter] Centers: loaded ${centerData.length} items.`);
  } catch (err) {
    console.error('Error loading constellation centers:', err);
    centerData = [];
  }
}

export function createConstellationBoundariesForGlobe() {
  const lines = [];
  const R = 100;
  boundaryData.forEach(b => {
    if (b.raDecPolygon && b.raDecPolygon.length > 0) {
      const points = b.raDecPolygon.map(v => {
        // Convert RA/DEC (in degrees) to 3D point on sphere of radius R.
        const raRad = THREE.Math.degToRad(v.ra);
        const decRad = THREE.Math.degToRad(v.dec);
        const x = -R * Math.cos(decRad) * Math.cos(raRad);
        const y = R * Math.sin(decRad);
        const z = -R * Math.cos(decRad) * Math.sin(raRad);
        return new THREE.Vector3(x, y, z);
      });
      const curve = new THREE.CatmullRomCurve3(points);
      const curvePoints = curve.getPoints(64);
      const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const material = new THREE.LineDashedMaterial({
        color: 0x888888,
        dashSize: 2,
        gapSize: 1,
        linewidth: 1,
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      lines.push(line);
    }
  });
  return lines;
}

export function createConstellationLabelsForGlobe() {
  const labels = [];
  const R = 100;
  centerData.forEach(c => {
    const p = radToSphere(c.ra, c.dec, R);
    const baseFontSize = 300;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${baseFontSize}px Arial`;
    const textWidth = ctx.measureText(c.name).width;
    canvas.width = textWidth + 20;
    canvas.height = baseFontSize * 1.2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${baseFontSize}px Arial`;
    ctx.fillStyle = '#888888';
    ctx.fillText(c.name, 10, baseFontSize);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        opacity: { value: 0.5 }
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
    const planeGeom = new THREE.PlaneGeometry((canvas.width / 100), (canvas.height / 100));
    const label = new THREE.Mesh(planeGeom, material);
    label.position.copy(p);
    const normal = p.clone().normalize();
    const globalUp = new THREE.Vector3(0, 1, 0);
    let desiredUp = globalUp.clone().sub(normal.clone().multiplyScalar(globalUp.dot(normal)));
    if (desiredUp.lengthSq() < 1e-6) desiredUp = new THREE.Vector3(0, 0, 1);
    else desiredUp.normalize();
    const desiredRight = new THREE.Vector3().crossVectors(desiredUp, normal).normalize();
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(desiredRight, desiredUp, normal);
    label.setRotationFromMatrix(matrix);
    label.renderOrder = 1;
    labels.push(label);
  });
  return labels;
}

function radToSphere(ra, dec, R) {
  const raRad = THREE.Math.degToRad(ra);
  const decRad = THREE.Math.degToRad(dec);
  const x = -R * Math.cos(decRad) * Math.cos(raRad);
  const y = R * Math.sin(decRad);
  const z = -R * Math.cos(decRad) * Math.sin(raRad);
  return new THREE.Vector3(x, y, z);
}

export function getConstellationBoundaries() {
  return boundaryData;
}

function parseRA(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(x => parseFloat(x));
  const hours = hh + mm / 60 + ss / 3600;
  const deg = hours * 15;
  return deg;
}

function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const stripped = decStr.replace('+', '').replace('-', '');
  const [dd, mm, ss] = stripped.split(':').map(x => parseFloat(x));
  const degVal = (dd + mm / 60 + ss / 3600) * sign;
  return degVal;
}
