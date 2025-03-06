// /filters/densityTreeOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial } from './densityColorUtils.js'; // or some needed import
import { getGreatCirclePoints } from './densitySegmentation.js'; // if needed

/**
 * HighDensityTreeOverlay:
 *  An octree approach just for "high" density mode.
 *  Subdivides if starCount > #high-density-count-slider, up to a max depth, 
 *  and draws a box for each final leaf node. The deeper the node => the more opaque up to alpha=0.5.
 */
export class HighDensityTreeOverlay {
  constructor(minDistance, maxDistance, starArray) {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.starArray = starArray;

    this.mode = 'high'; // for consistency
    this.cubesData = [];
    this.adjacentLines = []; // we won't do adjacency lines
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();

    // We'll define an octree bounding box from -maxDistance..+maxDistance
    const halfSize = this.maxDistance;
    this.rootMin = new THREE.Vector3(-halfSize, -halfSize, -halfSize);
    this.rootMax = new THREE.Vector3(+halfSize, +halfSize, +halfSize);

    // We'll store extended star positions in a local array.
    this.extendedStars = starArray.filter(s => {
      let d = s.distance !== undefined ? s.distance : s.Distance_from_the_Sun;
      return d <= (this.maxDistance+10);
    }).map(s => {
      // We assume s.truePosition or x/y/z
      let x=0,y=0,z=0;
      if (s.truePosition) {
        x = s.truePosition.x; y = s.truePosition.y; z = s.truePosition.z;
      } else {
        x = s.x_coordinate; y = s.y_coordinate; z = s.z_coordinate;
      }
      return { x, y, z };
    });

    // Build the octree
    this.buildOctree();
  }

  buildOctree() {
    const starCountSlider = document.getElementById('high-density-count-slider');
    const starThreshold = starCountSlider ? parseInt(starCountSlider.value) : 1;
    const MAX_DEPTH = 6; // or 7, up to you

    // Recursively build
    const buildNode = (minPt, maxPt, depth, starPts) => {
      if (starPts.length === 0) {
        return {
          isLeaf: true,
          minPt, maxPt, depth,
          starCount: 0
        };
      }
      if (depth >= MAX_DEPTH || starPts.length <= starThreshold) {
        return {
          isLeaf: true,
          minPt, maxPt, depth,
          starCount: starPts.length
        };
      }
      // subdiv
      const children = [];
      const center = new THREE.Vector3(
        0.5*(minPt.x+maxPt.x),
        0.5*(minPt.y+maxPt.y),
        0.5*(minPt.z+maxPt.z)
      );
      for (let i=0; i<8; i++) {
        const childMin = new THREE.Vector3(
          (i & 1)? center.x : minPt.x,
          (i & 2)? center.y : minPt.y,
          (i & 4)? center.z : minPt.z
        );
        const childMax = new THREE.Vector3(
          (i & 1)? maxPt.x : center.x,
          (i & 2)? maxPt.y : center.y,
          (i & 4)? maxPt.z : center.z
        );
        // gather childStars
        const childStars = [];
        for (let sp of starPts) {
          if (sp.x >= childMin.x && sp.x <= childMax.x &&
              sp.y >= childMin.y && sp.y <= childMax.y &&
              sp.z >= childMin.z && sp.z <= childMax.z) {
            childStars.push(sp);
          }
        }
        if (childStars.length>0) {
          children.push( buildNode(childMin, childMax, depth+1, childStars) );
        }
      }
      if (children.length===0) {
        // no children => leaf
        return {
          isLeaf: true,
          minPt, maxPt, depth,
          starCount: starPts.length
        };
      }
      return {
        isLeaf: false,
        minPt, maxPt, depth,
        starCount: starPts.length,
        children
      };
    };

    this.octreeRoot = buildNode(this.rootMin, this.rootMax, 0, this.extendedStars);
    // collect leaf nodes
    this.leafNodes = [];
    const collectLeaves = (node) => {
      if (node.isLeaf) {
        this.leafNodes.push(node);
      } else if (node.children) {
        node.children.forEach(c => collectLeaves(c));
      }
    };
    collectLeaves(this.octreeRoot);
  }

  createGrid() {
    // We just create a 3D box for each leaf node
    this.leafNodes.forEach(node => {
      const dx = node.maxPt.x - node.minPt.x;
      const dy = node.maxPt.y - node.minPt.y;
      const dz = node.maxPt.z - node.minPt.z;
      const geometry = new THREE.BoxGeometry(dx, dy, dz);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity:1.0, depthWrite: false});
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        0.5*(node.minPt.x+node.maxPt.x),
        0.5*(node.minPt.y+node.maxPt.y),
        0.5*(node.minPt.z+node.maxPt.z)
      );
      // We'll store an object in cubesData so script.js can add it
      const cellObj = {
        node,
        tcMesh: mesh,
        globeMesh: mesh.clone(), // we can just clone or build a separate one
        active: false
      };
      this.cubesData.push(cellObj);
    });
  }

  update(stars) {
    // read starCount slider again
    const starCountSlider = document.getElementById('high-density-count-slider');
    const starThreshold = starCountSlider ? parseInt(starCountSlider.value) : 1;
    const MAX_DEPTH = 6;

    this.cubesData.forEach(cell => {
      const center = new THREE.Vector3(
        0.5*(cell.node.minPt.x + cell.node.maxPt.x),
        0.5*(cell.node.minPt.y + cell.node.maxPt.y),
        0.5*(cell.node.minPt.z + cell.node.maxPt.z)
      );
      const dist = center.length();
      if (dist < this.minDistance || dist > this.maxDistance) {
        cell.active=false;
      } else {
        cell.active=true;
      }
      // alpha from 0..0.5 => depth=0 => alpha=0 => depth=MAX_DEPTH => alpha=0.5
      const alpha = (cell.node.depth / MAX_DEPTH)*0.5;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.material.opacity = alpha;
      cell.tcMesh.visible = cell.active;
      cell.globeMesh.visible = cell.active;
    });
  }

  /** Some placeholders so we don't break anything else. */
  getBestStarLabel(cells) {
    return "HighDensityOctree";
  }

  async assignConstellationsToCells() {
    // If you want to do advanced logic, do it. Otherwise no-op
    this.cubesData.forEach(c => {
      if (c.active) {
        c.clusterLabel = "HighDensityRegion";
      }
    });
  }

  addRegionLabelsToScene(scene, mapType) {
    // optional no-op
  }
}
