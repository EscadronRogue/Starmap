// /filters/densityTreeOverlay.js

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.min.js';
import { getDoubleSidedLabelMaterial } from './densityColorUtils.js';
import { segmentOceanCandidate, getGreatCirclePoints } from './densitySegmentation.js';
import { loadConstellationCenters, getConstellationCenters,
         loadConstellationBoundaries, getConstellationBoundaries } from './constellationFilter.js';

// A simple function that returns the center of a bounding box
function getBoxCenter(minPt, maxPt) {
  return new THREE.Vector3(
    0.5 * (minPt.x + maxPt.x),
    0.5 * (minPt.y + maxPt.y),
    0.5 * (minPt.z + maxPt.z)
  );
}

// Returns a new bounding box if we subdivide quadrant i in an octree node
function getSubBoxBounds(minPt, maxPt, octIndex) {
  const center = getBoxCenter(minPt, maxPt);
  // Each bit in octIndex picks high or low for x/y/z
  // bit 0 => x, bit 1 => y, bit 2 => z
  const xHalf = (maxPt.x - minPt.x) * 0.5;
  const yHalf = (maxPt.y - minPt.y) * 0.5;
  const zHalf = (maxPt.z - minPt.z) * 0.5;

  const newMin = new THREE.Vector3();
  const newMax = new THREE.Vector3();

  newMin.x = (octIndex & 1) ? center.x : minPt.x;
  newMax.x = (octIndex & 1) ? maxPt.x : center.x;

  newMin.y = (octIndex & 2) ? center.y : minPt.y;
  newMax.y = (octIndex & 2) ? maxPt.y : center.y;

  newMin.z = (octIndex & 4) ? center.z : minPt.z;
  newMax.z = (octIndex & 4) ? maxPt.z : center.z;

  return { min: newMin, max: newMax };
}

/**
 * HighDensityTreeOverlay
 *  - Builds a simple Octree for the region from minDistance..maxDistance around the Sun.
 *  - Recursively subdivides each node if starCount > starThreshold from "high-density-count" slider.
 *  - For each leaf node, we create a box geometry. The deeper the node is, the more opaque/dark green it becomes (up to alpha=0.5).
 */
export class HighDensityTreeOverlay {
  constructor(minDistance, maxDistance, starArray) {
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.starArray = starArray;

    // We'll store references like in densityGridOverlay
    this.mode = 'high';
    this.regionLabelsGroupTC = new THREE.Group();
    this.regionLabelsGroupGlobe = new THREE.Group();
    this.adjacentLines = []; // We won't do adjacency lines here
    this.cubesData = [];     // We'll store final leaf nodes here, each with a mesh

    // We define bounding box that encloses [minDistance..maxDistance].
    // We interpret "centered" around (0,0,0). We'll make a big cube that encloses the sphere of radius maxDistance.
    // But we only keep sub-boxes whose center is between minDist..maxDist in radius.
    const halfSize = this.maxDistance;
    this.rootMin = new THREE.Vector3(-halfSize, -halfSize, -halfSize);
    this.rootMax = new THREE.Vector3( halfSize,  halfSize,  halfSize);

    // Build a starData array that includes all star positions
    // only for stars within [0, maxDistance + someMargin]
    this.extendedStars = this.starArray.filter(star => {
      let d = star.distance !== undefined ? star.distance : star.Distance_from_the_Sun;
      return d <= (this.maxDistance + 10);
    });

    // We'll do it once. The user can see the final overlay in cubesData.
    this.buildOctree();
  }

  buildOctree() {
    // read the starCount threshold from #high-density-count-slider
    const starCountSlider = document.getElementById('high-density-count-slider');
    const starThreshold = starCountSlider ? parseInt(starCountSlider.value) : 1;

    // We define a maxDepth so we don't subdivide infinitely
    const MAX_DEPTH = 6;

    // We define a recursive function "buildNode"
    const buildNode = (minPt, maxPt, depth, starPositions) => {
      // If no stars, return a leaf
      if (starPositions.length === 0) {
        return {
          isLeaf: true,
          depth,
          minPt, maxPt,
          starCount: 0
        };
      }

      // We'll see how far the corners are from center
      // We'll cull any node whose entire bounding box is below minDistance or above maxDistance?
      // Actually let's do a final check later if the center is < minDist or > maxDist, we won't create a mesh.
      // For now, we subdivide if starCount > starThreshold and depth<MAX_DEPTH.
      const starCount = starPositions.length;
      if (starCount <= starThreshold || depth >= MAX_DEPTH) {
        return {
          isLeaf: true,
          depth,
          minPt, maxPt,
          starCount
        };
      }

      // otherwise subdivide
      const children = [];
      const center = getBoxCenter(minPt, maxPt);
      for (let i = 0; i < 8; i++) {
        const subBB = getSubBoxBounds(minPt, maxPt, i);
        // filter starPositions that fall into subBB
        const childStars = [];
        for (let s of starPositions) {
          if (s.x >= subBB.min.x && s.x <= subBB.max.x &&
              s.y >= subBB.min.y && s.y <= subBB.max.y &&
              s.z >= subBB.min.z && s.z <= subBB.max.z) {
            childStars.push(s);
          }
        }
        if (childStars.length > 0) {
          children.push(buildNode(subBB.min, subBB.max, depth+1, childStars));
        }
      }
      return {
        isLeaf: false,
        depth,
        minPt, maxPt,
        starCount,
        children
      };
    };

    // Convert each star to a point {x,y,z} for quicker bounding checks
    const starPts = this.extendedStars.map(star => {
      // use star.x_coordinate,y_coordinate,z_coordinate if they exist
      // or use star.truePosition
      if (star.truePosition) {
        return { x: star.truePosition.x, y: star.truePosition.y, z: star.truePosition.z };
      }
      return { x: star.x_coordinate, y: star.y_coordinate, z: star.z_coordinate };
    });

    // Build the root node
    this.octreeRoot = buildNode(this.rootMin, this.rootMax, 0, starPts);

    // Next, gather all leaf nodes into this.cubesData
    this.collectLeafNodes(this.octreeRoot, []);
  }

  collectLeafNodes(node, path) {
    if (node.isLeaf) {
      this.cubesData.push({
        node,
        active: false,          // We'll compute in update()
        tcPos: getBoxCenter(node.minPt, node.maxPt),
        depth: node.depth,
        minPt: node.minPt,
        maxPt: node.maxPt
      });
    } else {
      node.children.forEach(c => this.collectLeafNodes(c, path.concat(node)));
    }
  }

  // createGrid() is called by script, so let's keep a dummy
  createGrid() {
    // we already built the octree in constructor
    // but we want to create a mesh for each leaf node
    this.cubesData.forEach(cell => {
      // We'll store a 'tcMesh' and 'globeMesh' so the rest of the code won't break
      const minPt = cell.minPt;
      const maxPt = cell.maxPt;

      const sizeX = maxPt.x - minPt.x;
      const sizeY = maxPt.y - minPt.y;
      const sizeZ = maxPt.z - minPt.z;
      const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
      // color #00ff00 (pure green). alpha we'll set in update()
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 1.0, depthWrite: false });
      const cubeTC = new THREE.Mesh(geometry, material);
      // center
      cubeTC.position.set(
        0.5*(minPt.x+maxPt.x),
        0.5*(minPt.y+maxPt.y),
        0.5*(minPt.z+maxPt.z)
      );
      cell.tcMesh = cubeTC;

      // For the globe map, we do a single bounding-plane is not that meaningful for an octree box,
      // but let's mimic the same property name:
      const planeGeom = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
      const mat2 = material.clone();
      const boxGlobe = new THREE.Mesh(planeGeom, mat2);
      boxGlobe.position.copy(cubeTC.position.clone());
      cell.globeMesh = boxGlobe;
    });
  }

  update(stars) {
    // We'll read starCount slider again in case it changed
    const starCountSlider = document.getElementById('high-density-count-slider');
    const starThreshold = starCountSlider ? parseInt(starCountSlider.value) : 1;

    // We define a maximum possible depth
    const MAX_DEPTH = 6; // same as build
    // We'll do alpha from 0 up to 0.5. Depth 0 => alpha=0, depth=MAX_DEPTH => alpha=0.5
    // alpha = (depth / MAX_DEPTH)*0.5
    // But also we want to hide boxes whose center is < minDistance or > maxDistance

    this.cubesData.forEach(cell => {
      const center = cell.tcPos.clone();
      const dist = center.length();
      // If outside minDist..maxDist, hide
      if (dist < this.minDistance || dist > this.maxDistance) {
        cell.active = false;
      } else {
        cell.active = true;
      }

      // set alpha from 0..0.5 based on cell.depth
      const alpha = (cell.depth / MAX_DEPTH)*0.5;
      cell.tcMesh.material.opacity = alpha;
      cell.globeMesh.material.opacity = alpha;

      // also, if the node's starCount is below starThreshold => that box won't subdiv
      // but we do not remove them. Let's do a quick check: if starCount < threshold => we might hide?
      // Actually we built the tree at the time of creation, so let's do a partial approach:
      // We'll show everything that was subdivided if active, ignoring the new threshold changes?
      // For a fully dynamic approach, we'd rebuild the tree. But let's keep it simpler here:
      // We'll do no hiding based on star threshold for now, so we don't break the user approach.
    });

    // We do not do adjacency lines for the tree approach, so let's just hide them
    this.adjacentLines.forEach(obj => {
      obj.line.visible = false;
    });
  }

  // The rest is for labeling, etc. We keep them to avoid breaking the code

  getBestStarLabel(cells) {
    // We'll just return "Octree Region" or so
    return "Octree Region";
  }

  async assignConstellationsToCells() {
    // We'll do a trivial approach: each "cell" is a leaf node. We'll just label them with "HighDensityRegion"
    // If you want to do more advanced constellation logic, you'd do it similarly to densityGridOverlay
    this.cubesData.forEach(cell => {
      if (cell.active) {
        cell.clusterLabel = "HighDensityRegion";
      }
    });
  }

  addRegionLabelsToScene(scene, mapType) {
    if (mapType === 'TrueCoordinates') {
      if (this.regionLabelsGroupTC.parent) scene.remove(this.regionLabelsGroupTC);
      this.regionLabelsGroupTC = new THREE.Group();
    } else {
      if (this.regionLabelsGroupGlobe.parent) scene.remove(this.regionLabelsGroupGlobe);
      this.regionLabelsGroupGlobe = new THREE.Group();
    }
    // We won't do fancy region segmentation. We'll just create a label for each leaf if you want.
    // To avoid clutter, let's skip labeling all leaves. We'll do nothing or you can do a tiny label.

    // scene.add(...)  // if you had labels you'd add them.

    // no-op
  }
}

