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
