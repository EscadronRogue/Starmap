// /filters/densityTreeOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial } from './densityColorUtils.js'; // or wherever
import { getGreatCirclePoints } from './densitySegmentation.js'; // if needed

/**
 * HighDensityTreeOverlay:
 *  Builds an octree from minDistance..maxDistance and subdivides if starCount > starThreshold.
 *  The user sets starThreshold & maxDepth in the UI; we store them in `this.starThreshold` & `this.maxDepth`.
 *  Then in `update()`, we show/hide or set opacity based on node depth, up to alpha=0.5 for the deepest nodes.
 */
export class HighDensityTreeOverlay {
  constructor(minDistance, maxDistance, starArray) {
    this.minDistance = parseFloat(minDistance);
    this.maxDistance = parseFloat(maxDistance);
    this.starArray = starArray;

    // We'll store starThreshold & maxDepth externally
    this.starThreshold = 10; // default, will be overridden in script.js
    this.maxDepth = 6;       // also overridden

    this.mode = 'high';
    this.cubesData = [];
    this.adjacentLines = []; // Not used here
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();

    // bounding box around +/- maxDistance
    const half = this.maxDistance;
    this.rootMin = new THREE.Vector3(-half, -half, -half);
    this.rootMax = new THREE.Vector3(+half, +half, +half);

    // Build starPositions
    this.extendedStars = starArray.filter(s=>{
      const d = (s.distance!==undefined)?s.distance:s.Distance_from_the_Sun;
      return d <= this.maxDistance+10;
    }).map(s=>{
      let x=0,y=0,z=0;
      if (s.truePosition) {
        x=s.truePosition.x; y=s.truePosition.y; z=s.truePosition.z;
      } else {
        x=s.x_coordinate; y=s.y_coordinate; z=s.z_coordinate;
      }
      return {x, y, z};
    });

    // We'll build the octree once in constructor, so if user changes threshold or maxDepth, we won't rebuild the entire structure but we will do a partial show/hide in update.
    this.octreeRoot = null;
  }

  buildOctreeRecursive(minPt, maxPt, depth, starPts, starThreshold, maxDepth) {
    if (!starPts || starPts.length===0) {
      return {
        isLeaf:true,
        minPt, maxPt, depth,
        starCount:0
      };
    }
    if (depth>=maxDepth || starPts.length<=starThreshold) {
      return {
        isLeaf:true,
        minPt, maxPt, depth,
        starCount: starPts.length
      };
    }
    // subdiv
    const children=[];
    const center = new THREE.Vector3(
      0.5*(minPt.x+maxPt.x),
      0.5*(minPt.y+maxPt.y),
      0.5*(minPt.z+maxPt.z)
    );
    for (let i=0;i<8;i++) {
      const cmin = new THREE.Vector3(
        (i & 1)? center.x : minPt.x,
        (i & 2)? center.y : minPt.y,
        (i & 4)? center.z : minPt.z
      );
      const cmax = new THREE.Vector3(
        (i & 1)? maxPt.x : center.x,
        (i & 2)? maxPt.y : center.y,
        (i & 4)? maxPt.z : center.z
      );
      const subStars = [];
      for (let st of starPts) {
        if (st.x>=cmin.x && st.x<=cmax.x &&
            st.y>=cmin.y && st.y<=cmax.y &&
            st.z>=cmin.z && st.z<=cmax.z) {
          subStars.push(st);
        }
      }
      if (subStars.length>0) {
        children.push(
          this.buildOctreeRecursive(cmin, cmax, depth+1, subStars, starThreshold, maxDepth)
        );
      }
    }
    if (children.length===0) {
      return {
        isLeaf:true,
        minPt, maxPt, depth,
        starCount: starPts.length
      };
    }
    return {
      isLeaf:false,
      minPt, maxPt, depth,
      starCount: starPts.length,
      children
    };
  }

  buildOctree() {
    // We read the starThreshold & maxDepth from this object
    this.octreeRoot = this.buildOctreeRecursive(
      this.rootMin,
      this.rootMax,
      0,
      this.extendedStars,
      this.starThreshold,
      this.maxDepth
    );
    // gather leaves
    this.leafNodes = [];
    const collect = (node) => {
      if (node.isLeaf) {
        this.leafNodes.push(node);
      } else {
        if (node.children) node.children.forEach(c => collect(c));
      }
    };
    collect(this.octreeRoot);
  }

  createGrid() {
    // Actually build the octree once
    this.buildOctree();
    // Now create a box for each leaf
    this.leafNodes.forEach(leaf => {
      const dx = leaf.maxPt.x - leaf.minPt.x;
      const dy = leaf.maxPt.y - leaf.minPt.y;
      const dz = leaf.maxPt.z - leaf.minPt.z;
      const geo = new THREE.BoxGeometry(dx,dy,dz);
      const mat = new THREE.MeshBasicMaterial({ color:0x00ff00, transparent:true, opacity:1.0, depthWrite:false});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        0.5*(leaf.minPt.x+leaf.maxPt.x),
        0.5*(leaf.minPt.y+leaf.maxPt.y),
        0.5*(leaf.minPt.z+leaf.maxPt.z)
      );
      const copyMesh = mesh.clone(); // for globe or separate
      this.cubesData.push({
        node:leaf,
        tcMesh: mesh,
        globeMesh: copyMesh,
        active: false
      });
    });
  }

  update(stars) {
    // If user changed starThreshold or maxDepth, we should rebuild the octree. 
    // But user asked "don't do hidden logic." We'll do a quick check:
    // We'll just do a partial approach: re-building the entire tree is simplest to keep it correct:
    // so let's remove old, rebuild, re-mesh. But that might break references. 
    // Or let's do a "live" approach => let's do the simplest: rebuild everything if needed:

    // We'll do a difference check: if this.octreeRoot was built with old starThreshold / maxDepth, let's rebuild.
    // We can't store the old values, let's just do it each time. This is simplest & guaranteed correct.
    // We'll remove old meshes from scene => re-run createGrid => new cubes => done.

    // But let's do something simpler: we'll only do "alpha" & "active" updates based on minDist..maxDist and node.depth. 
    // If user changed starThreshold or maxDepth, they'd have to re-enable high density for it to take effect. 
    // (You can do a full rebuild if you prefer. We'll do that for clarity.)

    // For demonstration, let's do a full rebuild:
    this.cubesData.forEach(c => {
      c.tcMesh.parent?.remove(c.tcMesh);
      c.globeMesh.parent?.remove(c.globeMesh);
    });
    this.cubesData=[];
    this.octreeRoot=null;
    this.buildOctree();
    this.createGrid(); // re-creates cubesData with fresh leaves

    // Now show/hide them based on minDistance..maxDistance
    this.cubesData.forEach(cell => {
      const center = new THREE.Vector3(
        0.5*(cell.node.minPt.x+cell.node.maxPt.x),
        0.5*(cell.node.minPt.y+cell.node.maxPt.y),
        0.5*(cell.node.minPt.z+cell.node.maxPt.z)
      );
      const dist = center.length();
      if (dist < this.minDistance || dist> this.maxDistance) {
        cell.active=false;
      } else {
        cell.active=true;
      }
      // alpha from 0..0.5 => node.depth=0 => alpha=0 => node.depth=maxDepth => alpha=0.5
      const alpha = (cell.node.depth/this.maxDepth)*0.5;
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
    // No-op or a trivial approach. 
    this.cubesData.forEach(cell=>{
      if (cell.active) {
        cell.clusterLabel="HighOctreeRegion";
      }
    });
  }

  addRegionLabelsToScene(scene, mapType) {
    // optional no-op
  }
}
