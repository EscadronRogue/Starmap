// /filters/ConvexGeometry.js

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
