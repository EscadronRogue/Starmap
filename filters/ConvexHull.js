// /filters/ConvexHull.js
//
// Enhanced safety checks in addNewFaces() to avoid null references
// (edge.prev or edge.prev.vertex might be null in degenerate geometry).
//
// If we detect any null references, we simply skip building that face
// rather than crashing.
//
// Source: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/math/ConvexHull.js

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
      console.warn('THREE.ConvexHull: Need >= 4 points for a 3D hull. Returning empty hull.');
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
    object.traverse(node => {
      const g = node.geometry;
      if (!g) return;
      if (g.isGeometry) {
        const verts = g.vertices;
        for (let i = 0, l = verts.length; i < l; i++) {
          const v = verts[i].clone().applyMatrix4(node.matrixWorld);
          pts.push(v);
        }
      } else if (g.isBufferGeometry) {
        const attr = g.attributes.position;
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
    this.assigned.clear();
    this.unassigned.clear();

    if (!this.computeInitialHull()) {
      // degenerate => done
      return;
    }

    // Add the rest of the vertices
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const v = this.vertices[i];
      if (v.isOnHull) continue;
      this.assigned.append(v);
    }

    let iterations = 0;
    while (!this.assigned.isEmpty() && iterations < 1000) {
      const eyeVertex = this.nextVertexToAdd();
      if (!eyeVertex) break;

      const visibleFaces = this.getVisibleFaces(eyeVertex);
      this.removeVisibleFaces(visibleFaces);
      this.addNewFaces(eyeVertex, visibleFaces);
      this.resolveUnassignedPoints(visibleFaces);

      iterations++;
    }

    this.computeNormals();
    this.cleanHull();
  }

  computeNormals() {
    for (let i = 0; i < this.faces.length; i++) {
      this.faces[i].computeNormal();
    }
  }

  cleanHull() {
    // remove faces marked "Deleted"
    const valid = [];
    for (let i = 0; i < this.faces.length; i++) {
      if (this.faces[i].mark === Visible) {
        valid.push(this.faces[i]);
      }
    }
    this.faces = valid;
    this.edges = [];
  }

  computeInitialHull() {
    if (this.vertices.length < 4) return false;

    // find extremes
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
    let maxDist = 0;
    let pair = [];

    for (let i = 0; i < testSet.length - 1; i++) {
      for (let j = i + 1; j < testSet.length; j++) {
        _v1.subVectors(testSet[i].point, testSet[j].point);
        const dSq = _v1.lengthSq();
        if (dSq > maxDist) {
          maxDist = dSq;
          pair = [testSet[i], testSet[j]];
        }
      }
    }
    const vA = pair[0], vB = pair[1];
    if (!vA || !vB) {
      console.warn("ConvexHull: degenerate => no extremes found");
      return false;
    }

    // find third
    _v1.subVectors(vB.point, vA.point).normalize();
    let maxC = null;
    maxDist = -Infinity;
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vt = this.vertices[i];
      if (vt === vA || vt === vB) continue;
      _v2.subVectors(vt.point, vA.point);
      const area = _v2.cross(_v1).lengthSq();
      if (area > maxDist && area > 1e-10) {
        maxDist = area;
        maxC = vt;
      }
    }
    if (!maxC) {
      console.warn("ConvexHull: all points collinear => empty hull");
      return false;
    }

    // find fourth
    let maxD = null;
    maxDist = -Infinity;
    _v3.subVectors(maxC.point, vA.point).cross(_v1);
    for (let i = 0, l = this.vertices.length; i < l; i++) {
      const vt = this.vertices[i];
      if (vt === vA || vt === vB || vt === maxC) continue;
      const vol = Math.abs(_v3.dot(_v2.subVectors(vt.point, vA.point)));
      if (vol > maxDist && vol > 1e-10) {
        maxDist = vol;
        maxD = vt;
      }
    }
    if (!maxD) {
      console.warn("ConvexHull: all points coplanar => empty hull");
      return false;
    }

    const top = Face.create(vA, vB, maxC);
    const bottom = Face.create(vA, maxC, vB);

    _v1.copy(maxD.point);
    if (bottom.distanceToPoint(_v1) > 0) {
      this.faces.push(top, bottom);
    } else {
      top.flipIfValid();
      bottom.flipIfValid();
      this.faces.push(top, bottom);
    }

    const f3 = Face.create(vA, vB, maxD);
    const f4 = Face.create(vB, vA, maxD);
    this.faces.push(f3, f4);

    // link edges
    linkEdges(top, f3, vA, vB);
    linkEdges(top, f4, vB, maxC);
    linkEdges(top, bottom, maxC, vA);

    linkEdges(bottom, f3, vB, vA);
    linkEdges(bottom, f4, maxC, vB);

    linkEdges(f3, f4, vB, maxD);
    linkEdges(f3, bottom, maxD, vA);
    linkEdges(f4, top, maxD, vA);
    linkEdges(f4, bottom, maxC, maxD);

    for (let i = 0; i < 4; i++) {
      const face = this.faces[i];
      if (!face.edge) {
        console.warn("ConvexHull: invalid face => empty hull");
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
    let eyeV = null, maxDist = -Infinity;
    let node = this.assigned.first();
    while (node) {
      if (node.distance > maxDist) {
        maxDist = node.distance;
        eyeV = node;
      }
      node = node.next;
    }
    return eyeV;
  }

  getVisibleFaces(vertex) {
    const vis = [];
    for (let i = 0; i < this.faces.length; i++) {
      const face = this.faces[i];
      if (face.mark === Visible) {
        const dist = face.distanceToPoint(vertex.point);
        if (dist > this.tolerance) {
          vis.push(face);
        }
      }
    }
    return vis;
  }

  removeVisibleFaces(faces) {
    for (let i = 0; i < faces.length; i++) {
      faces[i].mark = Deleted;
    }
  }

  addNewFaces(eyeVertex, visibleFaces) {
    const horizon = [];
    if (visibleFaces.length === 0) return;

    this.findHorizon(eyeVertex.point, visibleFaces[0], null, horizon);
    this.newFaces = [];

    // Potentially horizon might contain edges that are null or missing prev.
    for (let i = 0; i < horizon.length; i++) {
      const edge = horizon[i];
      if (!edge) continue;
      if (!edge.vertex) continue;
      if (!edge.prev || !edge.prev.vertex) continue;

      // Create new face using the edge's two endpoints plus eyeVertex
      const newFace = Face.create(edge.vertex, edge.prev.vertex, eyeVertex);

      // If the twin edge can be found, set it
      if (edge.prev && edge.prev.face) {
        const twinEdge = edge.prev.face.getEdge(edge.vertex, eyeVertex);
        if (twinEdge) {
          newFace.getEdge(eyeVertex, edge.vertex).setTwin(twinEdge);
        }
      }
      newFace.computeNormal();
      newFace.computeCentroid();
      this.faces.push(newFace);
      this.newFaces.push(newFace);
    }
  }

  findHorizon(eyePt, crossFace, startEdge, horizon) {
    if (!crossFace || !crossFace.edge) return;
    this.deleteFaceVertices(crossFace);
    crossFace.mark = Deleted;

    let e0 = (startEdge === null) ? crossFace.edge : startEdge.next;
    let e1 = e0;

    do {
      const twin = e1.twin;
      if (!twin || !twin.face) {
        // no twin => horizon edge
        horizon.push(e1);
      } else {
        const oppFace = twin.face;
        if (oppFace.mark === Visible) {
          const dist = oppFace.distanceToPoint(eyePt);
          if (dist > this.tolerance) {
            this.findHorizon(eyePt, oppFace, twin, horizon);
          } else {
            horizon.push(e1);
          }
        }
      }
      e1 = e1.next;
    } while (e1 !== e0);
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
      const nxt = node.next;
      let maxFace = null;
      let maxDist = this.tolerance;
      for (let i = 0; i < this.newFaces.length; i++) {
        const nf = this.newFaces[i];
        const dist = nf.distanceToPoint(node.point);
        if (dist > maxDist) {
          maxDist = dist;
          maxFace = nf;
        }
      }
      if (maxFace) {
        this.assigned.append(node);
        node.face = maxFace;
        node.distance = maxDist;
        maxFace.outside = node;
      }
      node = nxt;
    }
    this.unassigned.clear();
  }
}

// Short helper to link edges across faces
function linkEdges(faceA, faceB, va, vb) {
  if (!faceA || !faceB) return;
  const eA = faceA.getEdge(va, vb);
  const eB = faceB.getEdge(vb, va);
  if (eA && eB) {
    eA.setTwin(eB);
  }
}

const Visible = 0;
const Deleted = 1;

class VertexList {
  constructor() {
    this.head = null;
    this.tail = null;
  }
  first() {
    return this.head;
  }
  isEmpty() {
    return this.head === null;
  }
  clear() {
    this.head = this.tail = null;
  }
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
  constructor(pt) {
    this.point = pt;
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
    const f = new Face();
    const e0 = new HalfEdge(a, f);
    const e1 = new HalfEdge(b, f);
    const e2 = new HalfEdge(c, f);
    e0.next = e1; e1.next = e2; e2.next = e0;
    f.edge = e0;
    return f;
  }
  computeCentroid() {
    this.centroid.set(0, 0, 0);
    let e = this.edge;
    let count = 0;
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
  flipIfValid() {
    if (!this.edge || !this.edge.next || !this.edge.prev) return;
    this.normal.negate();
    let e = this.edge;
    do {
      const tmp = e.head();
      e.vertex = e.tail();
      if (e.prev) {
        e.prev.vertex = tmp;
      }
      const oldPrev = e.prev;
      e.prev = e.next;
      e.next = oldPrev;
      e = oldPrev;
    } while (e !== this.edge);
    this.computeCentroid();
  }
}

class HalfEdge {
  constructor(vertex, face) {
    this.vertex = vertex;
    this.face = face;
    this.prev = null;
    this.next = null;
    this.twin = null;
  }
  head() {
    return this.vertex;
  }
  tail() {
    return this.prev ? this.prev.vertex : null;
  }
  setTwin(edge) {
    this.twin = edge;
    edge.twin = this;
  }
}

export { ConvexHull };
