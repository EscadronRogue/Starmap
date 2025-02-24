// filters/densityData.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

let densityCenterData = null;

/**
 * Loads constellation center data (synchronously) if not already loaded.
 */
export function loadDensityCenterData() {
  if (densityCenterData !== null) return;
  densityCenterData = [];
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "constellation_center.txt", false); // synchronous
    xhr.send(null);
    if (xhr.status === 200) {
      const raw = xhr.responseText;
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length < 5) continue;
        const raStr = parts[2];
        const decStr = parts[3];
        const matchName = line.match(/"([^"]+)"/);
        const name = matchName ? matchName[1] : 'Unknown';
        const raVal = parseRA(raStr);
        const decVal = parseDec(decStr);
        densityCenterData.push({ ra: raVal, dec: decVal, name });
      }
      console.log(`[DensityFilter] Loaded ${densityCenterData.length} constellation centers.`);
    }
  } catch (err) {
    console.error("Error loading constellation_center.txt synchronously:", err);
  }
}

/**
 * Returns the loaded density center data.
 */
export function getDensityCenterData() {
  return densityCenterData;
}

/**
 * Converts degrees to radians.
 */
export function degToRad(d) {
  return d * Math.PI / 180;
}

/**
 * Parses an RA string (e.g. "12:34:56") and returns radians.
 */
export function parseRA(raStr) {
  const [hh, mm, ss] = raStr.split(':').map(x => parseFloat(x));
  const hours = hh + mm / 60 + ss / 3600;
  const deg = hours * 15;
  return degToRad(deg);
}

/**
 * Parses a DEC string (e.g. "-12:34:56") and returns radians.
 */
export function parseDec(decStr) {
  const sign = decStr.startsWith('-') ? -1 : 1;
  const stripped = decStr.replace('+', '').replace('-', '');
  const [dd, mm, ss] = stripped.split(':').map(x => parseFloat(x));
  const degVal = (dd + mm / 60 + ss / 3600) * sign;
  return degToRad(degVal);
}
