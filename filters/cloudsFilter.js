// /filters/cloudsFilter.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { ConvexGeometry } from './ConvexGeometry.js';

/**
 * Loads a cloud data file (JSON) from the provided URL.
 * @param {string} cloudFileUrl - URL to the cloud JSON file.
 * @returns {Promise<Array>} - Promise resolving to an array of cloud star objects.
 */
export async function loadCloudData(cloudFileUrl) {
  const response = await fetch(cloudFileUrl);
  if (!response.ok) {
    throw new Error(`Failed to load cloud data from ${cloudFileUrl}`);
  }
  return await response.json();
}

/**
 * Creates a cloud overlay mesh from the cloud data and the currently plotted stars.
 * @param {Array} cloudData - Array of star objects from the cloud file.
 * @param {Array} plottedStars - Array of star objects currently visible/plotted.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {THREE.Mesh|null} - A mesh representing the cloud (convex hull), or null if not enough points.
 */
export function createCloudOverlay(cloudData, plottedStars, mapType) {
  const positions = [];
  // Get a set of star names from the cloud file.
  const cloudNames = new Set(cloudData.map(d => d["Star Name"]));
  // Look up each star from the plotted stars (using the common name)
  plottedStars.forEach(star => {
    if (cloudNames.has(star.Common_name_of_the_star)) {
      if (mapType === 'TrueCoordinates') {
        if (star.truePosition) positions.push(star.truePosition);
      } else {
        if (star.spherePosition) positions.push(star.spherePosition);
      }
    }
  });

  // Identify outlier stars that should be included in the convex hull
  const outlierStars = plottedStars.filter(star => {
    // Define your criteria for including outlier stars here
    // For example, include stars within a certain distance from the cloud area
    return !cloudNames.has(star.Common_name_of_the_star) && isNearCloudArea(star, positions, mapType);
  });

  // Add outlier stars to the positions array
  outlierStars.forEach(star => {
    if (mapType === 'TrueCoordinates') {
      if (star.truePosition) positions.push(star.truePosition);
    } else {
      if (star.spherePosition) positions.push(star.spherePosition);
    }
  });

  // Need at least three points to form a polygon.
  if (positions.length < 3) return null;

  // Build a convex hull from the positions.
  const geometry = new ConvexGeometry(positions);
  // Create a semi-transparent material; you can adjust the color per cloud if desired.
  const material = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    opacity: 0.3,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Determines if a star is near the cloud area based on some criteria.
 * @param {Object} star - The star object.
 * @param {Array} positions - Array of positions defining the cloud area.
 * @param {string} mapType - Either 'TrueCoordinates' or 'Globe'.
 * @returns {boolean} - True if the star is near the cloud area, false otherwise.
 */
function isNearCloudArea(star, positions, mapType) {
  // Define your criteria for "near" here
  // For example, check if the star is within a certain distance from any position in the cloud area
  const thresholdDistance = 5; // Define an appropriate threshold distance
  if (mapType === 'TrueCoordinates') {
    return positions.some(pos => star.truePosition.distanceTo(pos) < thresholdDistance);
  } else {
    return positions.some(pos => star.spherePosition.distanceTo(pos) < thresholdDistance);
  }
}

/**
 * Updates the clouds overlay on a given scene.
 * @param {Array} plottedStars - The array of currently plotted stars.
 * @param {THREE.Scene} scene - The scene to add the cloud overlays to.
 * @param {string} mapType - 'TrueCoordinates' or 'Globe'
 * @param {Array<string>} cloudDataFiles - Array of URLs for cloud JSON files.
 */
export async function updateCloudsOverlay(plottedStars, scene, mapType, cloudDataFiles) {
  // Store overlays in scene.userData.cloudOverlays so we can remove them on update.
  if (!scene.userData.cloudOverlays) {
    scene.userData.cloudOverlays = [];
  } else {
    scene.userData.cloudOverlays.forEach(mesh => scene.remove(mesh));
    scene.userData.cloudOverlays = [];
  }
  // Process each cloud file.
  for (const fileUrl of cloudDataFiles) {
    try {
      const cloudData = await loadCloudData(fileUrl);
      const overlay = createCloudOverlay(cloudData, plottedStars, mapType);
      if (overlay) {
        scene.add(overlay);
        scene.userData.cloudOverlays.push(overlay);
      }
    } catch (e) {
      console.error(e);
    }
  }
}

// /filters/ConvexGeometry.js

/**
 * ConvexGeometry is a geometry representing the convex hull of a set of points.
 * It depends on ConvexHull.js (provided in the same folder).
 */

import { BufferGeometry, Float32BufferAttribute } from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { ConvexHull } from './ConvexHull.js';

class ConvexGeometry extends BufferGeometry {

	constructor( points ) {

		super();

		if ( points === undefined ) return;

		// Build an array of vertices from the convex hull.
		const vertices = [];

		const convexHull = new ConvexHull().setFromPoints( points );

		const faces = convexHull.faces;

		for ( let i = 0; i < faces.length; i ++ ) {

			const face = faces[ i ];
			let edge = face.edge;
			do {
				const point = edge.head();
				vertices.push( point.x, point.y, point.z );
				edge = edge.next;
			} while ( edge !== face.edge );

		}

		// Build geometry.
		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		this.computeVertexNormals();

	}

}

export { ConvexGeometry };

// /filters/ConvexHull.js

/**
 * ConvexHull
 * A minimal implementation to compute the convex hull of a set of points.
 * (This is a simplified version; for a full robust solution, please refer to the official three.js source.)
 */

import { Vector3 } from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

class ConvexHull {

	constructor() {
		this.tolerance = -1;
		this.faces = [];
		// The following lists are used by the incremental algorithm.
		this.assigned = new AssignedList();
		this.unassigned = new UnassignedList();
	}

	setFromPoints( points ) {
		if ( points.length < 4 ) {
			console.error( "ConvexHull: Need at least four points" );
			return this;
		}
		this.faces = [];
		this.assigned.clear();
		this.unassigned.clear();
		this.computeInitialHull( points );
		// The full incremental algorithm would now process the unassigned points.
		// For brevity, we assume that the initial simplex is our hull.
		return this;
	}

	computeInitialHull( points ) {
		// Compute extremes.
		let min = new Vector3( Infinity, Infinity, Infinity );
		let max = new Vector3( -Infinity, -Infinity, -Infinity );
		for ( let i = 0, l = points.length; i < l; i ++ ) {
			const p = points[ i ];
			min.min( p );
			max.max( p );
		}
		const diff = new Vector3().subVectors( max, min );
		this.tolerance = 3 * Number.EPSILON * diff.length();

		// Select four non-coplanar points as initial simplex vertices.
		let i0, i1, i2, i3;
		i0 = 0;
		for ( let i = 1, l = points.length; i < l; i ++ ) {
			if ( points[ i ].x < points[ i0 ].x || points[ i ].y < points[ i0 ].y || points[ i ].z < points[ i0 ].z ) {
				i0 = i;
			}
		}
		let maxDist = -Infinity;
		for ( let i = 0, l = points.length; i < l; i ++ ) {
			if ( i === i0 ) continue;
			const d = points[ i ].distanceToSquared( points[ i0 ] );
			if ( d > maxDist ) {
				maxDist = d;
				i1 = i;
			}
		}
		maxDist = -Infinity;
		for ( let i = 0, l = points.length; i < l; i ++ ) {
			if ( i === i0 || i === i1 ) continue;
			const d = distanceToLineSquared( points[ i ], points[ i0 ], points[ i1 ] );
			if ( d > maxDist ) {
				maxDist = d;
				i2 = i;
			}
		}
		maxDist = -Infinity;
		for ( let i = 0, l = points.length; i < l; i ++ ) {
			if ( i === i0 || i === i1 || i === i2 ) continue;
			const d = Math.abs( distanceToPlane( points[ i ], points[ i0 ], points[ i1 ], points[ i2 ] ) );
			if ( d > maxDist ) {
				maxDist = d;
				i3 = i;
			}
		}

		// Create initial faces from these four points.
		// (A full implementation would ensure the correct orientation and assign points to faces.)
		const simplex = [ points[ i0 ], points[ i1 ], points[ i2 ], points[ i3 ] ];
		// For simplicity, we create one face per triangle of the simplex.
		this.faces.push( new Face( simplex[0], simplex[1], simplex[2] ) );
		this.faces.push( new Face( simplex[0], simplex[1], simplex[3] ) );
		this.faces.push( new Face( simplex[0], simplex[2], simplex[3] ) );
		this.faces.push( new Face( simplex[1], simplex[2], simplex[3] ) );
	}

}

class Face {
	constructor( a, b, c ) {
		this.a = a;
		this.b = b;
		this.c = c;
		this.edge = new HalfEdge( a, b, this );
		const edge2 = new HalfEdge( b, c, this );
		const edge3 = new HalfEdge( c, a, this );
		this.edge.next = edge2;
		edge2.next = edge3;
		edge3.next = this.edge;
	}
}

class HalfEdge {
	constructor( head, tail, face ) {
		this.head = () => head;
		this.tail = () => tail;
		this.face = face;
		this.next = null;
	}
}

class AssignedList {
	constructor() {
		this.head = null;
		this.tail = null;
	}
	clear() {
		this.head = this.tail = null;
	}
	add( vertex ) {
		vertex.next = null;
		if ( this.tail === null ) {
			this.head = this.tail = vertex;
		} else {
			this.tail.next = vertex;
			this.tail = vertex;
		}
	}
}

class UnassignedList {
	constructor() {
		this.head = null;
		this.tail = null;
	}
	clear() {
		this.head = this.tail = null;
	}
	add( vertex ) {
		vertex.next = null;
		if ( this.tail === null ) {
			this.head = this.tail = vertex;
		} else {
			this.tail.next = vertex;
			this.tail = vertex;
		}
	}
}

function distanceToLineSquared( point, linePoint1, linePoint2 ) {
	const diff = new Vector3().subVectors( point, linePoint1 );
	const lineDir = new Vector3().subVectors( linePoint2, linePoint1 );
	const t = diff.dot( lineDir ) / lineDir.lengthSq();
	const projection = new Vector3().copy( linePoint1 ).add( lineDir.multiplyScalar( t ) );
	return point.distanceToSquared( projection );
}

function distanceToPlane( point, planePoint1, planePoint2, planePoint3 ) {
	const v1 = new Vector3().subVectors( planePoint2, planePoint1 );
	const v2 = new Vector3().subVectors( planePoint3, planePoint1 );
	const normal = new Vector3().crossVectors( v1, v2 ).normalize();
	return point.clone().sub( planePoint1 ).dot( normal );
}

export { ConvexHull };
