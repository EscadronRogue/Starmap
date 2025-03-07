// /filters/densityData.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { degToRad, parseRA, parseDec } from '../utils/geometryUtils.js';

let densityCenterData = null;

/**
 * Loads constellation center data asynchronously if not already loaded.
 * This replaces the synchronous XHR call with an async fetch.
 */
export async function loadDensityCenterData() {
  if (densityCenterData !== null) return;
  densityCenterData = [];
  try {
    const response = await fetch("constellation_center.txt");
    if (!response.ok) {
      throw new Error(`Failed to fetch constellation_center.txt: ${response.status}`);
    }
    const raw = await response.text();
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
  } catch (err) {
    console.error("Error loading constellation_center.txt asynchronously:", err);
  }
}

/**
 * Returns the loaded density center data.
 */
export function getDensityCenterData() {
  return densityCenterData;
}
