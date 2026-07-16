import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';
import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/controls/PointerLockControls.js';

const container = document.body;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x7db8e8, 0.022);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const controls = new PointerLockControls(camera, renderer.domElement);

const overlay = document.getElementById('overlay');
const statsText = document.getElementById('stats');
const hudText = document.getElementById('hud');
const hotbar = document.getElementById('hotbar');
const startButton = document.getElementById('startBtn');

const WORLD_SIZE = { width: 48, height: 20, depth: 48 };
const EMPTY = 0;
const blockTypes = {
  0: { name: 'Air', color: 0x000000, solid: false },
  1: { name: 'Grass', color: 0x67c25d, solid: true },
  2: { name: 'Dirt', color: 0x8b5a2b, solid: true },
  3: { name: 'Stone', color: 0x7a7a7a, solid: true },
  4: { name: 'Wood', color: 0x9b6b33, solid: true },
  5: { name: 'Leaves', color: 0x2d8a27, solid: true, transparent: true, opacity: 0.82 },
  6: { name: 'Sand', color: 0xf2dc8e, solid: true },
};
const inventorySlots = [1, 2, 3, 4, 5, 6];
let activeSlot = 0;

const world = [];
const visibleMap = new Map();
const materials = new Map();
const BLOCK_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const HIGHLIGHT_GEOMETRY = new THREE.BoxGeometry(1.06, 1.06, 1.06);

const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const moveState = { forward: false, backward: false, left: false, right: false, jump: false };
let selectedTarget = null;
let activeFaceNormal = new THREE.Vector3();
let worldTime = 8;

const sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight, sunLight);

const sunSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.25, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffee99 })
);
scene.add(sunSphere);

const highlightBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(HIGHLIGHT_GEOMETRY),
  new THREE.LineBasicMaterial({ color: 0xffffff })
);
highlightBox.visible = false;
scene.add(highlightBox);

const mobMaterial = new THREE.MeshLambertMaterial({ color: 0x8c2a2a, flatShading: true });
const mobGeometry = new THREE.BoxGeometry(0.8, 1.4, 0.8);
const mobs = [];

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function getMaterial(type) {
  if (materials.has(type)) {
    return materials.get(type);
  }
  const info = blockTypes[type];
  const material = new THREE.MeshLambertMaterial({
    color: info.color,
    transparent: !!info.transparent,
    opacity: info.opacity ?? 1,
    flatShading: true,
  });
  materials.set(type, material);
  return material;
}

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function isInside(x, y, z) {
  return x >= 0 && z >= 0 && y >= 0 && x < WORLD_SIZE.width && y < WORLD_SIZE.height && z < WORLD_SIZE.depth;
}

function getBlock(x, y, z) {
  if (!isInside(x, y, z)) return EMPTY;
  return world[x][y][z];
}

function isSolid(x, y, z) {
  return getBlock(x, y, z) !== EMPTY;
}

function hasVisibleFace(x, y, z) {
  return [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ].some(([dx, dy, dz]) => !isSolid(x + dx, y + dy, z + dz));
}

function createBlockMesh(x, y, z, type) {
  if (type === EMPTY || !hasVisibleFace(x, y, z)) return;
  const key = blockKey(x, y, z);
  if (visibleMap.has(key)) return;
  const mesh = new THREE.Mesh(BLOCK_GEOMETRY, getMaterial(type));
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  mesh.userData.position = { x, y, z };
  scene.add(mesh);
  visibleMap.set(key, mesh);
}

function removeBlockMesh(x, y, z) {
  const key = blockKey(x, y, z);
  const mesh = visibleMap.get(key);
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  visibleMap.delete(key);
}

function updateBlockVisibility(x, y, z) {
  if (!isInside(x, y, z)) return;
  const type = getBlock(x, y, z);
  const key = blockKey(x, y, z);
  if (type === EMPTY) {
    removeBlockMesh(x, y, z);
    return;
  }
  if (hasVisibleFace(x, y, z)) {
    if (!visibleMap.has(key)) createBlockMesh(x, y, z, type);
  } else {
    removeBlockMesh(x, y, z);
  }
}

function updateNeighbors(x, y, z) {
  [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].forEach(([dx,dy,dz]) => {
    updateBlockVisibility(x + dx, y + dy, z + dz);
  });
}

function setBlock(x, y, z, type) {
  if (!isInside(x, y, z)) return;
  world[x][y][z] = type;
  updateBlockVisibility(x, y, z);
  updateNeighbors(x, y, z);
}

function generateTerrain() {
  for (let x = 0; x < WORLD_SIZE.width; x++) {
    world[x] = [];
    for (let y = 0; y < WORLD_SIZE.height; y++) {
      world[x][y] = [];
      for (let z = 0; z < WORLD_SIZE.depth; z++) {
        world[x][y][z] = EMPTY;
      }
    }
  }

  for (let x = 0; x < WORLD_SIZE.width; x++) {
    for (let z = 0; z < WORLD_SIZE.depth; z++) {
      const height = Math.floor(
        7 +
        Math.sin(x * 0.18) * 3 +
        Math.cos(z * 0.18) * 3 +
        (Math.random() * 2 - 1) * 1.5
      );
      const surface = clamp(height, 3, WORLD_SIZE.height - 5);
      for (let y = 0; y <= surface; y++) {
        let type = 3;
        if (y === surface) {
          type = 1;
        } else if (y > surface - 3) {
          type = 2;
        } else if (surface < 5) {
          type = 6;
        }
        world[x][y][z] = type;
      }
    }
  }

  for (let i = 0; i < 20; i++) {
    const x = Math.floor(Math.random() * (WORLD_SIZE.width - 8)) + 4;
    const z = Math.floor(Math.random() * (WORLD_SIZE.depth - 8)) + 4;
    createTreeAt(x, z);
  }

  for (let i = 0; i < 6; i++) {
    const x = Math.floor(Math.random() * (WORLD_SIZE.width - 12)) + 6;
    const z = Math.floor(Math.random() * (WORLD_SIZE.depth - 12)) + 6;
    createMobAt(x, z);
  }
}

function createTreeAt(x, z) {
  const height = Math.floor(Math.random() * 2) + 4;
  const ground = findSurfaceHeight(x, z);
  if (ground < 2 || ground + height + 3 >= WORLD_SIZE.height) return;
  for (let y = ground + 1; y <= ground + height; y++) {
    setBlock(x, y, z, 4);
  }

  const leavesBase = ground + height;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = 0; dy <= 2; dy++) {
        const dist = Math.abs(dx) + Math.abs(dz) + dy;
        if (dist <= 3 && Math.random() > 0.2) {
          const lx = x + dx;
          const ly = leavesBase + dy;
          const lz = z + dz;
          if (isInside(lx, ly, lz) && getBlock(lx, ly, lz) === EMPTY) {
            setBlock(lx, ly, lz, 5);
          }
        }
      }
    }
  }
}

function findSurfaceHeight(x, z) {
  for (let y = WORLD_SIZE.height - 1; y >= 0; y--) {
    if (getBlock(x, y, z) !== EMPTY) return y;
  }
  return 0;
}

function createMobAt(x, z) {
  const y = findSurfaceHeight(x, z) + 1;
  const mesh = new THREE.Mesh(mobGeometry, mobMaterial);
  mesh.position.set(x + 0.5, y + 0.7, z + 0.5);
  scene.add(mesh);
  mobs.push({ mesh, direction: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5) });
}

function buildWorld() {
  visibleMap.clear();
  for (let x = 0; x < WORLD_SIZE.width; x++) {
    for (let y = 0; y < WORLD_SIZE.height; y++) {
      for (let z = 0; z < WORLD_SIZE.depth; z++) {
        updateBlockVisibility(x, y, z);
      }
    }
  }
}

function updateSelection() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const objects = Array.from(visibleMap.values());
  const intersects = raycaster.intersectObjects(objects, false);
  if (!intersects.length) {
    highlightBox.visible = false;
    selectedTarget = null;
    return;
  }
  const intersection = intersects[0];
  const mesh = intersection.object;
  const pos = mesh.userData.position;
  selectedTarget = { x: pos.x, y: pos.y, z: pos.z };
  activeFaceNormal.copy(intersection.face.normal);
  highlightBox.visible = true;
  highlightBox.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
}

function mineBlock() {
  if (!controls.isLocked || !selectedTarget) return;
  const { x, y, z } = selectedTarget;
  setBlock(x, y, z, EMPTY);
}

function placeBlock() {
  if (!controls.isLocked || !selectedTarget) return;
  const type = inventorySlots[activeSlot];
  if (type === EMPTY) return;
  const targetX = selectedTarget.x + activeFaceNormal.x;
  const targetY = selectedTarget.y + activeFaceNormal.y;
  const targetZ = selectedTarget.z + activeFaceNormal.z;
  if (!isInside(targetX, targetY, targetZ)) return;
  if (getBlock(targetX, targetY, targetZ) !== EMPTY) return;
  setBlock(targetX, targetY, targetZ, type);
}

function updateSunlight(delta) {
  worldTime = (worldTime + delta * 0.08) % 24;
  const angle = (worldTime / 24) * Math.PI * 2;
  const sunX = Math.cos(angle) * 80;
  const sunY = Math.sin(angle) * 80 + 10;
  sunLight.position.set(sunX, sunY, 20);
  sunSphere.position.copy(sunLight.position);
  const fogStrength = clamp(Math.cos(angle) * 0.2 + 0.5, 0.15, 0.9);
  scene.fog.density = fogStrength * 0.03;
  const skyColor = new THREE.Color().setHSL(0.55, 0.65, clamp(Math.cos(angle) * 0.25 + 0.5, 0.18, 0.75));
  scene.background = skyColor;
  ambientLight.intensity = clamp(Math.cos(angle) * 0.25 + 0.8, 0.45, 1.0);
  sunLight.intensity = clamp(Math.cos(angle) * 0.65 + 0.4, 0.1, 1.2);
}

function updateMobs(delta) {
  mobs.forEach((mob) => {
    mob.mesh.position.addScaledVector(mob.direction, delta);
    const x = mob.mesh.position.x;
    const z = mob.mesh.position.z;
    if (x < 1 || x > WORLD_SIZE.width - 1 || z < 1 || z > WORLD_SIZE.depth - 1) {
      mob.direction.multiplyScalar(-1);
    }
    mob.mesh.rotation.y += delta * 0.4;
  });
}

function getGroundHeight(x, z) {
  for (let y = WORLD_SIZE.height - 1; y >= 0; y--) {
    if (isSolid(Math.floor(x), y, Math.floor(z))) return y + 1.6;
  }
  return 1.6;
}

function updatePlayer(delta) {
  if (!controls.isLocked) return;
  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  velocity.y -= 25 * delta;

  direction.z = Number(moveState.forward) - Number(moveState.backward);
  direction.x = Number(moveState.right) - Number(moveState.left);
  direction.normalize();

  if (moveState.forward || moveState.backward) velocity.z -= direction.z * 60 * delta;
  if (moveState.left || moveState.right) velocity.x -= direction.x * 60 * delta;
  if (moveState.jump && Math.abs(velocity.y) < 0.05) {
    velocity.y = 11;
  }

  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);
  camera.position.y += velocity.y * delta;

  const groundHeight = getGroundHeight(camera.position.x, camera.position.z);
  if (camera.position.y < groundHeight) {
    velocity.y = 0;
    camera.position.y = groundHeight;
  }
}

function updateUI() {
  const x = camera.position.x.toFixed(1);
  const y = camera.position.y.toFixed(1);
  const z = camera.position.z.toFixed(1);
  const blockName = inventorySlots[activeSlot] ? blockTypes[inventorySlots[activeSlot]].name : 'Empty';
  statsText.innerHTML = `Position: ${x}, ${y}, ${z} | Selected: ${blockName}`;
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.033);
  updatePlayer(delta);
  updateSelection();
  updateSunlight(delta);
  updateMobs(delta);
  updateUI();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function buildHotbar() {
  hotbar.innerHTML = '';
  inventorySlots.forEach((type, index) => {
    const slot = document.createElement('button');
    slot.className = 'hotbar-slot';
    if (index === activeSlot) {
      slot.classList.add('selected');
    }
    slot.innerHTML = `<span>${blockTypes[type].name}</span>`;
    slot.addEventListener('click', () => {
      activeSlot = index;
      buildHotbar();
    });
    hotbar.appendChild(slot);
  });
}

function createSceneFloor() {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshPhongMaterial({ color: 0x5d7ea7, side: THREE.DoubleSide, transparent: true, opacity: 0.35 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.1;
  scene.add(plane);
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', resize);

window.addEventListener('keydown', (event) => {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW': moveState.forward = true; break;
    case 'ArrowLeft':
    case 'KeyA': moveState.left = true; break;
    case 'ArrowDown':
    case 'KeyS': moveState.backward = true; break;
    case 'ArrowRight':
    case 'KeyD': moveState.right = true; break;
    case 'Space': moveState.jump = true; break;
    case 'Digit1': activeSlot = 0; buildHotbar(); break;
    case 'Digit2': activeSlot = 1; buildHotbar(); break;
    case 'Digit3': activeSlot = 2; buildHotbar(); break;
    case 'Digit4': activeSlot = 3; buildHotbar(); break;
    case 'Digit5': activeSlot = 4; buildHotbar(); break;
    case 'Digit6': activeSlot = 5; buildHotbar(); break;
  }
});

window.addEventListener('keyup', (event) => {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW': moveState.forward = false; break;
    case 'ArrowLeft':
    case 'KeyA': moveState.left = false; break;
    case 'ArrowDown':
    case 'KeyS': moveState.backward = false; break;
    case 'ArrowRight':
    case 'KeyD': moveState.right = false; break;
    case 'Space': moveState.jump = false; break;
  }
});

renderer.domElement.addEventListener('mousedown', (event) => {
  if (!controls.isLocked) return;
  if (event.button === 0) mineBlock();
  if (event.button === 2) placeBlock();
});

document.addEventListener('contextmenu', (event) => event.preventDefault());

startButton.addEventListener('click', () => {
  controls.lock();
});

controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  hudText.textContent = 'Mining and building enabled. Use the hotbar or keys 1-6 to select a block.';
});

controls.addEventListener('unlock', () => {
  overlay.classList.remove('hidden');
  hudText.textContent = 'Pointer unlocked. Click to resume.';
});

function initialize() {
  createSceneFloor();
  generateTerrain();
  buildWorld();
  buildHotbar();
  camera.position.set(WORLD_SIZE.width / 2, 12, WORLD_SIZE.depth / 2);
  camera.lookAt(WORLD_SIZE.width / 2, 10, WORLD_SIZE.depth / 2 - 5);
  animate();
}

initialize();
