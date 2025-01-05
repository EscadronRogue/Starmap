// filters/stellarClassData.js

let stellarClassData = {};

/**
 * Loads the stellar_class.json data asynchronously.
 */
export async function loadStellarClassData() {
  try {
    const response = await fetch('./stellar_class.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch stellar_class.json: ${response.status}`);
    }
    stellarClassData = await response.json();
    console.log('Stellar class data loaded successfully.');
  } catch (error) {
    console.error('Error loading stellar class data:', error);
  }
}

/**
 * Getter for the loaded stellar class data.
 */
export function getStellarClassData() {
  return stellarClassData;
}
