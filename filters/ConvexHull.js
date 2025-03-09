// /filters/ConvexHull.js
//
// Official Three.js ConvexHull, from the "three.js/examples/jsm/math/ConvexHull.js" file,
// with only minor adjustments for ES module usage in our environment.
//
// Source Reference:
//   https://github.com/mrdoob/three.js/blob/dev/examples/jsm/math/ConvexHull.js
//
import {
	Vector3
} from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

class ConvexHull {

	constructor() {

		this.tolerance = - 1;

		this.faces = [];  // the generated faces of the convex hull
		this.newFaces = []; // used in expand()

		this.vertices = [];  // reference to the original vertices
		this.assigned = new VertexList();
		this.unassigned = new VertexList();
		this.edges = [];

	}

	setFromPoints( points ) {

		if ( Array.isArray( points ) !== true ) {

			console.error( 'THREE.ConvexHull: Points parameter is not an array.' );

		}

		if ( points.length < 4 ) {

			console.error( 'THREE.ConvexHull: The algorithm needs at least four points.' );

		}

		this.makeEmpty();

		// convert vector3 to the internal structure

		for ( let i = 0, l = points.length; i < l; i ++ ) {

			this.vertices.push( new VertexNode( points[ i ] ) );

		}

		// start

		this.compute();

		return this;

	}

	setFromObject( object ) {

		const points = [];

		object.updateMatrixWorld( true );

		object.traverse( function ( node ) {

			const geometry = node.geometry;

			if ( geometry !== undefined ) {

				if ( geometry.isGeometry ) {

					const vertices = geometry.vertices;

					for ( let i = 0, l = vertices.length; i < l; i ++ ) {

						const vertex = vertices[ i ].clone();
						vertex.applyMatrix4( node.matrixWorld );

						points.push( vertex );

					}

				} else if ( geometry.isBufferGeometry ) {

					const attribute = geometry.attributes.position;

					if ( attribute !== undefined ) {

						for ( let i = 0, l = attribute.count; i < l; i ++ ) {

							_v1.fromBufferAttribute( attribute, i ).applyMatrix4( node.matrixWorld );

							points.push( _v1.clone() );

						}

					}

				}

			}

		} );

		return this.setFromPoints( points );

	}

	makeEmpty() {

		this.faces = [];
		this.vertices = [];

		return this;

	}

	compute() {

		let vertex;

		// reset assigned lists

		this.assigned.clear();
		this.unassigned.clear();

		// start from an extreme seed tetrahedron

		this.computeInitialHull();

		// add all vertices except those which are part of the initial hull

		for ( let i = 0, l = this.vertices.length; i < l; i ++ ) {

			vertex = this.vertices[ i ];

			if ( vertex.isOnHull ) {

				continue;

			}

			this.assigned.append( vertex );

		}

		// expand hull

		let iterations = 0; // performance safeguard

		while ( ! this.assigned.isEmpty() && iterations < 1000 ) {

			const vertex = this.nextVertexToAdd();
			const faces = this.getVisibleFaces( vertex );

			this.removeVisibleFaces( faces );

			this.addNewFaces( vertex, faces );

			this.resolveUnassignedPoints( faces );

			iterations ++;

		}

		this.computeNormals();

		// done

		this.cleanHull();

	}

	computeNormals() {

		for ( let i = 0, l = this.faces.length; i < l; i ++ ) {

			const face = this.faces[ i ];
			face.computeNormal();

		}

	}

	cleanHull() {

		// edges

		this.edges = [];

		// merge redundant faces

		const faces = [];

		for ( let i = 0, l = this.faces.length; i < l; i ++ ) {

			const face = this.faces[ i ];
			if ( face.mark === Visible ) faces.push( face );

		}

		this.faces = faces;

	}

	computeInitialHull() {

		let minX, maxX, minY, maxY, minZ, maxZ;
		let i, l;
		let vertices = this.vertices;

		minX = maxX = vertices[ 0 ];
		minY = maxY = vertices[ 0 ];
		minZ = maxZ = vertices[ 0 ];

		// find extreme points along x, y, z axes

		for ( i = 0, l = vertices.length; i < l; i ++ ) {

			const vertex = vertices[ i ];
			if ( vertex.point.x < minX.point.x ) minX = vertex;
			if ( vertex.point.x > maxX.point.x ) maxX = vertex;
			if ( vertex.point.y < minY.point.y ) minY = vertex;
			if ( vertex.point.y > maxY.point.y ) maxY = vertex;
			if ( vertex.point.z < minZ.point.z ) minZ = vertex;
			if ( vertex.point.z > maxZ.point.z ) maxZ = vertex;

		}

		// 4 points with the greatest span along each axis

		const vtxs = [ minX, maxX, minY, maxY, minZ, maxZ ];

		let maxDistance = 0;
		let pair = [];
		// find the two points farthest apart

		for ( i = 0; i < vtxs.length - 1; i ++ ) {

			for ( let j = i + 1; j < vtxs.length; j ++ ) {

				_v1.subVectors( vtxs[ i ].point, vtxs[ j ].point );
				const distance = _v1.lengthSq();
				if ( distance > maxDistance ) {

					maxDistance = distance;
					pair = [ vtxs[ i ], vtxs[ j ] ];

				}

			}

		}

		const vA = pair[ 0 ];
		const vB = pair[ 1 ];

		// dir

		_v1.subVectors( vB.point, vA.point );
		_v1.normalize();

		let maxC = null;
		maxDistance = - Infinity;
		// third point

		for ( i = 0, l = this.vertices.length; i < l; i ++ ) {

			const vertex = this.vertices[ i ];
			if ( vertex === vA || vertex === vB ) continue;

			_v2.subVectors( vertex.point, vA.point );

			const area = _v2.cross( _v1 ).lengthSq();

			if ( area > maxDistance && area > 1e-10 ) { // min area

				maxDistance = area;
				maxC = vertex;

			}

		}

		let maxD = null;
		let maxVolume = - Infinity;

		// fourth point

		_v3.subVectors( maxC.point, vA.point );
		_v3.cross( _v1 );

		for ( i = 0, l = this.vertices.length; i < l; i ++ ) {

			const vertex = this.vertices[ i ];
			if ( vertex === vA || vertex === vB || vertex === maxC ) continue;

			const volume = Math.abs( _v3.dot( _v2.subVectors( vertex.point, vA.point ) ) );

			if ( volume > maxVolume && volume > 1e-10 ) {

				maxVolume = volume;
				maxD = vertex;

			}

		}

		if ( ! maxC || ! maxD ) {

			// It means all points lie in a line or a plane or all points are coincident
			// fallback to any random tetrahedron
			// (If they're truly in a line or plane, that means the hull is degenerate)

			const backup = [];
			for ( let i = 0, l = vertices.length; i < l; i ++ ) {

				if ( backup.length < 4 && vertices[ i ] !== vA ) {

					backup.push( vertices[ i ] );

				}

			}

			maxC = backup[ 0 ];
			maxD = backup[ 1 ];
			if ( backup.length < 2 ) {

				// fallback: all points are the same
				maxC = vA;
				maxD = vB;

			}

		}

		// build the tetrahedron

		const faces = [];
		const top = Face.create( vA, vB, maxC );
		const bottom = Face.create( vA, maxC, vB );

		// orient

		_v1.copy( maxD.point );
		if ( bottom.distanceToPoint( _v1 ) > 0 ) {

			// face A

			this.faces.push( top, bottom );

		} else {

			// face B
			top.flip();
			bottom.flip();
			this.faces.push( top, bottom );

		}

		// compute the third and fourth face
		const face3 = Face.create( vA, vB, maxD );
		const face4 = Face.create( vB, vA, maxD );

		this.faces.push( face3, face4 );

		// link them together

		top.getEdge( vA, vB ).setTwin( face3.getEdge( vA, vB ) );
		top.getEdge( vB, maxC ).setTwin( face4.getEdge( vB, maxC ) ); // not sure
		top.getEdge( maxC, vA ).setTwin( bottom.getEdge( vA, maxC ) );

		bottom.getEdge( vB, vA ).setTwin( face3.getEdge( vB, vA ) );
		bottom.getEdge( maxC, vB ).setTwin( face4.getEdge( maxC, vB ) );

		face3.getEdge( vB, maxD ).setTwin( face4.getEdge( maxD, vB ) );
		face3.getEdge( maxD, vA ).setTwin( bottom.getEdge( vA, maxD ) );

		face4.getEdge( vA, maxD ).setTwin( top.getEdge( maxD, vA ) );
		face4.getEdge( maxD, maxC ).setTwin( bottom.getEdge( maxC, maxD ) );

		for ( let i = 0; i < 4; i ++ ) {

			this.faces[ i ].computeNormal();
			this.faces[ i ].computeCentroid();
			this.faces[ i ].mark = Visible;

		}

	}

	/**
	 * Returns the next vertex to create/update the hull with.
	 */
	nextVertexToAdd() {

		if ( this.assigned.isEmpty() ) return null;

		let eyeVertex, maxDistance = - Infinity;

		// Note that assigned vertices are linked into a vertex list

		const eyeVertexNode = this.assigned.first();

		for ( let node = eyeVertexNode; node !== null; node = node.next ) {

			const vertex = node;
			if ( vertex.distance > maxDistance ) {

				maxDistance = vertex.distance;
				eyeVertex = vertex;

			}

		}

		return eyeVertex;

	}

	getVisibleFaces( vertex ) {

		const visible = [];

		// faces are linked via their "mark" property

		for ( let i = 0; i < this.faces.length; i ++ ) {

			const face = this.faces[ i ];

			const dist = face.distanceToPoint( vertex.point );
			if ( dist > this.tolerance ) {

				visible.push( face );

			}

		}

		return visible;

	}

	removeVisibleFaces( visibleFaces ) {

		for ( let i = 0; i < visibleFaces.length; i ++ ) {

			const face = visibleFaces[ i ];
			face.mark = Deleted;

		}

	}

	addNewFaces( eyeVertex, visibleFaces ) {

		const horizon = [];

		this.findHorizon( eyeVertex.point, visibleFaces[ 0 ], null, horizon );

		this.newFaces = [];

		for ( let i = 0; i < horizon.length; i ++ ) {

			const edge = horizon[ i ];
			const face = Face.create( edge.vertex, edge.prev.vertex, eyeVertex );
			face.getEdge( eyeVertex, edge.vertex ).setTwin( edge.prev.face.getEdge( edge.vertex, eyeVertex ) );
			this.newFaces.push( face );

		}

		// link newly created faces

		for ( let i = 0; i < this.newFaces.length; i ++ ) {

			const face = this.newFaces[ i ];
			face.computeNormal();
			face.computeCentroid();
			this.faces.push( face );

		}

	}

	findHorizon( eyePoint, crossFace, edge, horizon ) {

		// For each face that is visible from the eyePoint,
		// recursively find all edges that form the horizon

		this.deleteFaceVertices( crossFace );

		crossFace.mark = Deleted;

		const edge0 = ( edge === null ) ? crossFace.edge : edge.next;
		let edge1 = edge0;

		do {

			const twinEdge = edge1.twin;
			const oppositeFace = twinEdge.face;

			if ( oppositeFace.mark === Visible ) {

				const dist = oppositeFace.distanceToPoint( eyePoint );
				if ( dist > this.tolerance ) {

					this.findHorizon( eyePoint, oppositeFace, twinEdge, horizon );

				} else {

					horizon.push( edge1 );

				}

			}

			edge1 = edge1.next;

		} while ( edge1 !== edge0 );

	}

	deleteFaceVertices( face ) {

		this.assigned.remove( face.outside );
		face.outside = null;

	}

	resolveUnassignedPoints( visibleFaces ) {

		for ( let i = 0; i < visibleFaces.length; i ++ ) {

			const face = visibleFaces[ i ];
			const vertex = face.outside;
			if ( ! vertex ) continue;

			this.unassigned.append( vertex );
			this.assigned.remove( vertex );
			face.outside = null;

		}

		for ( let node = this.unassigned.first(); node !== null; ) {

			const vertex = node;
			const nextNode = node.next;

			let maxDistance = this.tolerance;
			let maxFace = null;

			for ( let i = 0; i < this.newFaces.length; i ++ ) {

				const face = this.newFaces[ i ];
				const dist = face.distanceToPoint( vertex.point );
				if ( dist > maxDistance ) {

					maxDistance = dist;
					maxFace = face;

				}

			}

			if ( maxFace ) {

				this.assigned.append( vertex );
				vertex.face = maxFace;
				vertex.distance = maxDistance;
				maxFace.outside = vertex;

			} else {

				// not visible any more

				this.unassigned.remove( vertex );

			}

			node = nextNode;

		}

	}

}

// ============= VertexList

class VertexList {

	constructor() {

		this.head = null;
		this.tail = null;

	}

	first() {

		return this.head;

	}

	isEmpty() {

		return ( this.head === null );

	}

	clear() {

		this.head = this.tail = null;

	}

	append( vertex ) {

		if ( this.head === null ) {

			this.head = vertex;

		} else {

			this.tail.next = vertex;

		}

		vertex.prev = this.tail;
		vertex.next = null;
		this.tail = vertex;

	}

	remove( vertex ) {

		if ( vertex.prev === null ) {

			this.head = vertex.next;

		} else {

			vertex.prev.next = vertex.next;

		}

		if ( vertex.next === null ) {

			this.tail = vertex.prev;

		} else {

			vertex.next.prev = vertex.prev;

		}

	}

}

// ============= Face

const Visible = 0;
const Deleted = 1;

class Face {

	constructor() {

		this.normal = new Vector3();
		this.centroid = new Vector3();
		this.mark = Visible;

		this.edge = null; // a HalfEdge

		this.outside = null; // reference to a vertex in a vertex list

	}

	static create( a, b, c ) {

		const face = new Face();

		const e0 = new HalfEdge( a, face );
		const e1 = new HalfEdge( b, face );
		const e2 = new HalfEdge( c, face );

		// join edges

		e0.next = e1;
		e1.next = e2;
		e2.next = e0;

		// reference head

		face.edge = e0;

		return face;

	}

	computeCentroid() {

		this.centroid.set( 0, 0, 0 );
		let edge = this.edge;
		let count = 0;

		do {

			this.centroid.add( edge.head().point );
			count ++;
			edge = edge.next;

		} while ( edge !== this.edge );

		this.centroid.multiplyScalar( 1 / count );

	}

	computeNormal() {

		const a = this.edge.head().point;
		const b = this.edge.next.head().point;
		const c = this.edge.next.next.head().point;

		_v1.subVectors( b, a );
		_v2.subVectors( c, a );
		this.normal.crossVectors( _v1, _v2 ).normalize();

	}

	distanceToPoint( point ) {

		return this.normal.dot( _v1.subVectors( point, this.centroid ) );

	}

	getEdge( a, b ) {

		let edge = this.edge;

		do {

			if ( edge.head() === a && edge.tail() === b ) {

				return edge;

			}

			edge = edge.next;

		} while ( edge !== this.edge );

		return null;

	}

	flip() {

		const edge = this.edge;
		if ( edge === null ) return;

		this.normal.negate();

		let prev = edge.prev;
		let next = edge.next;

		edge.prev = next;
		edge.next = prev;

		const tmp = edge.head();
		edge.vertex = edge.tail();
		edge.prev.vertex = tmp;

		let e = next;
		while ( e !== edge ) {

			prev = e.prev;
			next = e.next;

			e.prev = next;
			e.next = prev;

			const tmp2 = e.head();
			e.vertex = e.tail();
			e.prev.vertex = tmp2;

			e = next;

		}

		this.computeCentroid();

	}

}

// ============= HalfEdge

class HalfEdge {

	constructor( vertex, face ) {

		this.vertex = vertex;
		this.prev = null;
		this.next = null;
		this.twin = null;
		this.face = face;

	}

	head() {

		return this.vertex;

	}

	tail() {

		return this.prev ? this.prev.vertex : null;

	}

	length() {

		const head = this.head();
		const tail = this.tail();
		if ( head === null || tail === null ) return 0;

		return head.point.distanceTo( tail.point );

	}

	setTwin( edge ) {

		this.twin = edge;
		edge.twin = this;

	}

}

// ============= Vertex

class VertexNode {

	constructor( point ) {

		this.point = point;
		this.prev = null;
		this.next = null;
		this.face = null;
		this.distance = 0;
		this.isOnHull = false;

	}

}

export { ConvexHull };
