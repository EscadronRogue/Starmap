// /filters/ConvexHull.js
//
// Based on the official three.js ConvexHull, with an added fallback
// to handle degenerate point sets without crashing.
//
// Source Reference:
//   https://github.com/mrdoob/three.js/blob/dev/examples/jsm/math/ConvexHull.js
//
// ADJUSTMENT: if we cannot form a valid 4-point simplex, we skip
// the flipping logic & hull steps to avoid crashing with null edges.
//

import {
  Vector3
} from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

class ConvexHull {

  constructor() {
    this.tolerance = -1;
    this.faces = [];
    this.newFaces = [];
    this.vertices = [];
    this.assigned = new VertexList();
    this.unassigned = new VertexList();
    this.edges = [];
  }

  setFromPoints(points) {
    if (!Array.isArray(points)) {
      console.error('THREE.ConvexHull: Points parameter is not an array.');
    }
    if (points.length < 4) {
      console.warn('THREE.ConvexHull: Need at least four distinct points for a robust 3D hull. Returning empty hull.');
      return this.makeEmpty();
    }
    this.makeEmpty();
    for (let i = 0, l = points.length; i < l; i++) {
      this.vertices.push(new VertexNode(points[i]));
    }
    this.compute();
    return this;
  }

  setFromObject(object) {
    const pts = [];
    object.updateMatrixWorld(true);
    object.traverse(function (node) {
      const geo = node.geometry;
      if (!geo) return;
      if (geo.isGeometry) {
        const verts = geo.vertices;
        for (let i = 0, l = verts.length; i < l; i++) {
          const v = verts[i].clone().applyMatrix4(node.matrixWorld);
          pts.push(v);
        }
      } else if (geo.isBufferGeometry) {
        const attr = geo.attributes.position;
        if (attr) {
          for (let i = 0; i < attr.count; i++) {
            _v1.fromBufferAttribute(attr, i).applyMatrix4(node.matrixWorld);
            pts.push(_v1.clone());
          }
        }
      }
    });
    return this.setFromPoints(pts);
  }

  makeEmpty() {
    this.faces = [];
    this.vertices = [];
    return this;
  }

  compute() {
    // Clear assigned lists
    this.assigned.clear();
    this.unassigned.clear();

    // Build seed tetrahedron
    const success = this.computeInitialHull();
    if (!success) {
      // The fallback inside computeInitialHull failed => degenerate
      return;
    }

    // Add all vertices except those on the initial hull
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const v = this.vertices[i];
      if (v.isOnHull) continue;
      this.assigned.append(v);
    }

    let iterCount = 0;
    while (!this.assigned.isEmpty() && iterCount < 1000) {
      const eyeVertex = this.nextVertexToAdd();
      if (!eyeVertex) break;
      const visibleFaces = this.getVisibleFaces(eyeVertex);
      this.removeVisibleFaces(visibleFaces);
      this.addNewFaces(eyeVertex, visibleFaces);
      this.resolveUnassignedPoints(visibleFaces);
      iterCount++;
    }

    this.computeNormals();
    this.cleanHull();
  }

  computeNormals() {
    for (let i = 0, l = this.faces.length; i < l; i++) {
      const face = this.faces[i];
      face.computeNormal();
    }
  }

  cleanHull() {
    // remove deleted faces
    const validFaces = [];
    for (let i = 0; i < this.faces.length; i++) {
      if (this.faces[i].mark === Visible) {
        validFaces.push(this.faces[i]);
      }
    }
    this.faces = validFaces;
    this.edges = [];
  }

  computeInitialHull() {
    // Identify extremes
    if (this.vertices.length < 4) return false;

    let minX = this.vertices[0], maxX = this.vertices[0];
    let minY = this.vertices[0], maxY = this.vertices[0];
    let minZ = this.vertices[0], maxZ = this.vertices[0];
    for (let i = 1, l = this.vertices.length; i < l; i++) {
      const v = this.vertices[i];
      if (v.point.x < minX.point.x) minX = v;
      if (v.point.x > maxX.point.x) maxX = v;
      if (v.point.y < minY.point.y) minY = v;
      if (v.point.y > maxY.point.y) maxY = v;
      if (v.point.z < minZ.point.z) minZ = v;
      if (v.point.z > maxZ.point.z) maxZ = v;
    }
    const testSet = [minX, maxX, minY, maxY, minZ, maxZ];

    // Pick the two farthest
    let maxDist = 0, pair = [];
    for (let i = 0; i < testSet.length - 1; i++) {
      for (let j = i + 1; j < testSet.length; j++) {
        _v1.subVectors(testSet[i].point, testSet[j].point);
        const d = _v1.lengthSq();
        if (d > maxDist) {
          maxDist = d;
          pair = [testSet[i], testSet[j]];
        }
      }
    }
    const vA = pair[0], vB = pair[1];
    if (!vA || !vB) {
      // fallback
      console.warn("ConvexHull: degenerate data. Can't find distinct extremes.");
      return false;
    }

    // find a third point
    _v1.subVectors(vB.point, vA.point).normalize();
    let maxC = null; maxDist = -Infinity;
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vtx = this.vertices[i];
      if (vtx === vA || vtx === vB) continue;
      _v2.subVectors(vtx.point, vA.point);
      const area = _v2.cross(_v1).lengthSq();
      if (area > maxDist && area > 1e-10) {
        maxDist = area;
        maxC = vtx;
      }
    }
    if (!maxC) {
      console.warn("ConvexHull: All points appear collinear or identical. Can't form a tetrahedron.");
      return false;
    }

    // find a 4th point
    let maxD = null; maxDist = -Infinity;
    _v3.subVectors(maxC.point, vA.point).cross(_v1);
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vtx = this.vertices[i];
      if (vtx === vA || vtx === vB || vtx === maxC) continue;
      const vol = Math.abs(_v3.dot(_v2.subVectors(vtx.point, vA.point)));
      if (vol > maxDist && vol > 1e-10) {
        maxDist = vol;
        maxD = vtx;
      }
    }
    if (!maxD) {
      console.warn("ConvexHull: Points appear coplanar. Can't form a 3D tetrahedron.");
      return false;
    }

    // Now build tetrahedron
    const top = Face.create(vA, vB, maxC);
    const bottom = Face.create(vA, maxC, vB);
    _v1.copy(maxD.point);
    if (bottom.distanceToPoint(_v1) > 0) {
      this.faces.push(top, bottom);
    } else {
      top.flip();
      bottom.flip();
      this.faces.push(top, bottom);
    }

    const f3 = Face.create(vA, vB, maxD);
    const f4 = Face.create(vB, vA, maxD);
    this.faces.push(f3, f4);

    // link them
    top.getEdge(vA, vB).setTwin(f3.getEdge(vA, vB));
    top.getEdge(vB, maxC).setTwin(f4.getEdge(vB, maxC));
    top.getEdge(maxC, vA).setTwin(bottom.getEdge(vA, maxC));

    bottom.getEdge(vB, vA).setTwin(f3.getEdge(vB, vA));
    bottom.getEdge(maxC, vB).setTwin(f4.getEdge(maxC, vB));
    f3.getEdge(vB, maxD).setTwin(f4.getEdge(maxD, vB));
    f3.getEdge(maxD, vA).setTwin(bottom.getEdge(vA, maxD));
    f4.getEdge(vA, maxD).setTwin(top.getEdge(maxD, vA));
    f4.getEdge(maxD, maxC).setTwin(bottom.getEdge(maxC, maxD));

    for (let i = 0; i < 4; i++) {
      const face = this.faces[i];
      if (!face.edge) {
        // If degenerate, skip
        console.warn("ConvexHull: skipping degenerate face (no edges).");
        return false;
      }
      face.computeNormal();
      face.computeCentroid();
      face.mark = Visible;
    }

    return true;
  }

  nextVertexToAdd() {
    if (this.assigned.isEmpty()) return null;
    let eyeVertex;
    let maxDistance = -Infinity;
    let node = this.assigned.first();
    while (node) {
      if (node.distance > maxDistance) {
        maxDistance = node.distance;
        eyeVertex = node;
      }
      node = node.next;
    }
    return eyeVertex;
  }

  getVisibleFaces(vertex) {
    const visible = [];
    for (let i = 0; i < this.faces.length; i++) {
      const f = this.faces[i];
      if (f.mark === Visible) {
        const dist = f.distanceToPoint(vertex.point);
        if (dist > this.tolerance) {
          visible.push(f);
        }
      }
    }
    return visible;
  }

  removeVisibleFaces(visibleFaces) {
    for (let i = 0; i < visibleFaces.length; i++) {
      visibleFaces[i].mark = Deleted;
    }
  }

  addNewFaces(eyeVertex, visibleFaces) {
    const horizon = [];
    this.findHorizon(eyeVertex.point, visibleFaces[0], null, horizon);
    this.newFaces = [];
    for (let i = 0; i < horizon.length; i++) {
      const edge = horizon[i];
      const f = Face.create(edge.vertex, edge.prev.vertex, eyeVertex);
      f.getEdge(eyeVertex, edge.vertex).setTwin(edge.prev.face.getEdge(edge.vertex, eyeVertex));
      this.newFaces.push(f);
    }
    for (let i = 0; i < this.newFaces.length; i++) {
      const nf = this.newFaces[i];
      nf.computeNormal();
      nf.computeCentroid();
      this.faces.push(nf);
    }
  }

  findHorizon(eyePoint, crossFace, edge, horizon) {
    this.deleteFaceVertices(crossFace);
    crossFace.mark = Deleted;
    let edge0 = (edge === null) ? crossFace.edge : edge.next;
    let edge1 = edge0;
    do {
      const twin = edge1.twin;
      const oppFace = twin.face;
      if (oppFace.mark === Visible) {
        const dist = oppFace.distanceToPoint(eyePoint);
        if (dist > this.tolerance) {
          this.findHorizon(eyePoint, oppFace, twin, horizon);
        } else {
          horizon.push(edge1);
        }
      }
      edge1 = edge1.next;
    } while (edge1 !== edge0);
  }

  deleteFaceVertices(face) {
    this.assigned.remove(face.outside);
    face.outside = null;
  }

  resolveUnassignedPoints(visibleFaces) {
    for (let i = 0; i < visibleFaces.length; i++) {
      const face = visibleFaces[i];
      if (!face.outside) continue;
      this.unassigned.append(face.outside);
      this.assigned.remove(face.outside);
      face.outside = null;
    }
    let node = this.unassigned.first();
    while (node) {
      const nextNode = node.next;
      let maxDist = this.tolerance;
      let maxFace = null;
      for (let i = 0; i < this.newFaces.length; i++) {
        const f = this.newFaces[i];
        const dist = f.distanceToPoint(node.point);
        if (dist > maxDist) {
          maxDist = dist;
          maxFace = f;
        }
      }
      if (maxFace) {
        this.assigned.append(node);
        node.face = maxFace;
        node.distance = maxDist;
        maxFace.outside = node;
      } else {
        // no face
      }
      node = nextNode;
    }
    this.unassigned.clear();
  }

}

// Constants
const Visible = 0;
const Deleted = 1;

class VertexList {
  constructor() {
    this.head = null;
    this.tail = null;
  }
  first() { return this.head; }
  isEmpty() { return this.head === null; }
  clear() { this.head = this.tail = null; }
  append(vertex) {
    if (!this.head) {
      this.head = vertex;
    } else {
      this.tail.next = vertex;
    }
    vertex.prev = this.tail;
    vertex.next = null;
    this.tail = vertex;
  }
  remove(vertex) {
    if (!vertex) return;
    if (vertex.prev === null) {
      this.head = vertex.next;
    } else {
      vertex.prev.next = vertex.next;
    }
    if (vertex.next === null) {
      this.tail = vertex.prev;
    } else {
      vertex.next.prev = vertex.prev;
    }
  }
}

class VertexNode {
  constructor(point) {
    this.point = point;
    this.prev = null;
    this.next = null;
    this.face = null;
    this.distance = 0;
    this.isOnHull = false;
  }
}

class Face {
  constructor() {
    this.normal = new Vector3();
    this.centroid = new Vector3();
    this.mark = Visible;
    this.edge = null;
    this.outside = null;
  }
  static create(a, b, c) {
    const face = new Face();
    const e0 = new HalfEdge(a, face);
    const e1 = new HalfEdge(b, face);
    const e2 = new HalfEdge(c, face);
    e0.next = e1; e1.next = e2; e2.next = e0;
    face.edge = e0;
    return face;
  }
  computeCentroid() {
    this.centroid.set(0, 0, 0);
    let count = 0;
    let e = this.edge;
    do {
      this.centroid.add(e.head().point);
      count++;
      e = e.next;
    } while (e !== this.edge);
    this.centroid.multiplyScalar(1 / count);
  }
  computeNormal() {
    const a = this.edge.head().point;
    const b = this.edge.next.head().point;
    const c = this.edge.next.next.head().point;
    _v1.subVectors(b, a);
    _v2.subVectors(c, a);
    this.normal.crossVectors(_v1, _v2).normalize();
  }
  distanceToPoint(pt) {
    return this.normal.dot(_v1.subVectors(pt, this.centroid));
  }
  getEdge(a, b) {
    let e = this.edge;
    do {
      if (e.head() === a && e.tail() === b) {
        return e;
      }
      e = e.next;
    } while (e !== this.edge);
    return null;
  }
  flip() {
    // If degenerate, skip
    if (!this.edge) return;
    this.normal.negate();
    let e = this.edge;
    do {
      const tmp = e.head();
      e.vertex = e.tail();
      e.prev.vertex = tmp;
      const tmpNext = e.prev;
      e.prev = e.next;
      e.next = tmpNext;
      e = tmpNext;
    } while (e !== this.edge);
    this.computeCentroid();
  }
}

class HalfEdge {
  constructor(vertex, face) {
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
  setTwin(e) {
    this.twin = e;
    e.twin = this;
  }
}

export { ConvexHull };
