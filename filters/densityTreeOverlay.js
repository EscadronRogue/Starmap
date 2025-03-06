// /filters/densityTreeOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';

/**
 * HighDensityTreeOverlay uses an octree approach for the high density filter.
 * The user sets the "Star Threshold" and "Max Depth" via sliders.
 * On each update, the octree is rebuilt using these parameters.
 * Each leaf node is represented by a cube.
 * The deeper a leaf is (closer to max depth), the higher its opacity (up to 0.5).
 */
export class HighDensityTreeOverlay {
  constructor(minDistance, maxDistance, starArray) {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.starArray = starArray;

    // These parameters are set by the filter menu
    this.starThreshold = 10;
    this.maxDepth = 6;

    this.mode = 'high';
    this.cubesData = [];
    this.adjacentLines = [];
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();

    const half = this.maxDistance;
    this.rootMin = new THREE.Vector3(-half, -half, -half);
    this.rootMax = new THREE.Vector3(half, half, half);

    this.extendedStars = starArray.filter(s => {
      const d = (s.distance !== undefined) ? s.distance : s.Distance_from_the_Sun;
      return d <= this.maxDistance + 10;
    }).map(s => {
      if (s.truePosition) {
        return { x: s.truePosition.x, y: s.truePosition.y, z: s.truePosition.z };
      }
      return { x: s.x_coordinate, y: s.y_coordinate, z: s.z_coordinate };
    });
    this.octreeRoot = null;
  }

  buildOctreeRecursive(minPt, maxPt, depth, starPts, starThreshold, maxDepth) {
    if (!starPts || starPts.length === 0) {
      return { isLeaf: true, minPt, maxPt, depth, starCount: 0 };
    }
    if (depth >= maxDepth || starPts.length <= starThreshold) {
      return { isLeaf: true, minPt, maxPt, depth, starCount: starPts.length };
    }
    const children = [];
    const center = new THREE.Vector3(
      0.5 * (minPt.x + maxPt.x),
      0.5 * (minPt.y + maxPt.y),
      0.5 * (minPt.z + maxPt.z)
    );
    for (let i = 0; i < 8; i++) {
      const childMin = new THREE.Vector3(
        (i & 1) ? center.x : minPt.x,
        (i & 2) ? center.y : minPt.y,
        (i & 4) ? center.z : minPt.z
      );
      const childMax = new THREE.Vector3(
        (i & 1) ? maxPt.x : center.x,
        (i & 2) ? maxPt.y : center.y,
        (i & 4) ? maxPt.z : center.z
      );
      const childStars = starPts.filter(sp =>
        sp.x >= childMin.x && sp.x <= childMax.x &&
        sp.y >= childMin.y && sp.y <= childMax.y &&
        sp.z >= childMin.z && sp.z <= childMax.z
      );
      if (childStars.length > 0) {
        children.push(this.buildOctreeRecursive(childMin, childMax, depth + 1, childStars, starThreshold, maxDepth));
      }
    }
    if (children.length === 0) {
      return { isLeaf: true, minPt, maxPt, depth, starCount: starPts.length };
    }
    return { isLeaf: false, minPt, maxPt, depth, starCount: starPts.length, children };
  }

  buildOctree() {
    this.octreeRoot = this.buildOctreeRecursive(this.rootMin, this.rootMax, 0, this.extendedStars, this.starThreshold, this.maxDepth);
    this.leafNodes = [];
    const collectLeaves = (node) => {
      if (node.isLeaf) {
        this.leafNodes.push(node);
      } else if (node.children) {
        node.children.forEach(child => collectLeaves(child));
      }
    };
    collectLeaves(this.octreeRoot);
  }

  createGrid() {
    this.buildOctree();
    this.cubesData = [];
    this.leafNodes.forEach(leaf => {
      const dx = leaf.maxPt.x - leaf.minPt.x;
      const dy = leaf.maxPt.y - leaf.minPt.y;
      const dz = leaf.maxPt.z - leaf.minPt.z;
      const geometry = new THREE.BoxGeometry(dx, dy, dz);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 1.0,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        0.5 * (leaf.minPt.x + leaf.maxPt.x),
        0.5 * (leaf.minPt.y + leaf.maxPt.y),
        0.5 * (leaf.minPt.z + leaf.maxPt.z)
      );
      const meshClone = mesh.clone();
      this.cubesData.push({
        node: leaf,
        tcMesh: mesh,
        globeMesh: meshClone,
        active: false
      });
    });
  }

  update(stars) {
    // Rebuild the octree each time so slider changes take effect
    // Remove old meshes
    this.cubesData.forEach(cell => {
      if (cell.tcMesh.parent) cell.tcMesh.parent.remove(cell.tcMesh);
      if (cell.globeMesh.parent) cell.globeMesh.parent.remove(cell.globeMesh);
    });
    this.cubesData = [];
    this.octreeRoot = null;
    this.buildOctree();
    this.createGrid();
    // Now update each cell’s visibility and opacity
    this.cubesData.forEach(cell => {
      const center = new THREE.Vector3(
        0.5 * (cell.node.minPt.x + cell.node.maxPt.x),
        0.5 * (cell.node.minPt.y + cell.node.maxPt.y),
        0.5 * (cell.node.minPt.z + cell.node.maxPt.z)
      );
      const dist = center.length();
      cell.active = (dist >= this.minDistance && dist <= this.maxDistance);
      // Set opacity proportional to depth (0 at depth 0, 0.5 at maxDepth)
      const alpha = (cell.node.depth / this.maxDepth) * 0.5;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.material.opacity = alpha;
      cell.tcMesh.visible = cell.active;
      cell.globeMesh.visible = cell.active;
    });
  }

  getBestStarLabel(cells) {
    return "HighDensityOctree";
  }

  async assignConstellationsToCells() {
    this.cubesData.forEach(cell => {
      if (cell.active) {
        cell.clusterLabel = "HighOctreeRegion";
      }
    });
  }

  addRegionLabelsToScene(scene, mapType) {
    // No labeling for this example.
  }
}
