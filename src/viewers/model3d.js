// The 3D viewer: turns a GLB, glTF, STL, OBJ, 3MF or PLY file into something you can turn over in your hands. Loaded
// only when a model is opened. The model is centred and scaled to a common size, so a saved view means the same
// thing whatever units the file was drawn in; its real size is read out beside the controls.
import {
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator, Box3, Vector3, Spherical, Group, Mesh, MeshStandardMaterial, Color,
  DirectionalLight, HemisphereLight, GridHelper, SRGBColorSpace, ACESFilmicToneMapping, DoubleSide,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// A printed part's look for files that carry no material of their own.
const plain = () => new MeshStandardMaterial({ color: new Color('#9aa3b2'), roughness: 0.62, metalness: 0.08, side: DoubleSide });

async function load(data, ext) {
  const text = () => new TextDecoder().decode(data);
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(data, '', resolve, reject));
    return { object: gltf.scene, zUp: false, unit: '' };
  }
  if (ext === 'stl') {
    const g = new STLLoader().parse(data);
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = plain();
    if (g.hasColors) m.vertexColors = true;
    return { object: new Mesh(g, m), zUp: true, unit: 'mm' };
  }
  if (ext === 'ply') {
    const g = new PLYLoader().parse(data);
    g.computeVertexNormals();
    const m = plain();
    if (g.attributes.color) m.vertexColors = true;
    return { object: new Mesh(g, m), zUp: true, unit: '' };
  }
  if (ext === 'obj') {
    const object = new OBJLoader().parse(text());
    object.traverse(o => { if (o.isMesh) o.material = plain(); });
    return { object, zUp: false, unit: '' };
  }
  if (ext === '3mf') return { object: new ThreeMFLoader().parse(data), zUp: true, unit: 'mm' };
  throw new Error('This kind of 3D file can’t be shown here.');
}

// Shows the model at `url` (or in `data`) inside `el`. Resolves once the first frame is drawn.
export async function mountModel(el, { url, data, ext, label = '3D model', interactive = true }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    throw new Error('This device can’t show 3D here. Try downloading the file instead.');
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const canvas = renderer.domElement;
  canvas.className = 'model-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label}. Drag to turn it, or use the arrow keys; plus and minus zoom.`);
  canvas.tabIndex = 0;

  const scene = new Scene();
  if (!interactive) scene.background = new Color('#0B0C0F'); // a card picture gets the cabinet's black behind it
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new HemisphereLight(0xffffff, 0x10131a, 0.25));
  const keyLight = new DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(2.5, 4, 3);
  // A royal rim from behind, the colour of the site's lamps.
  const rim = new DirectionalLight(0x2b59ff, 2.4);
  rim.position.set(-3, 1.5, -3.5);
  scene.add(keyLight, rim);

  if (!data) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('This model couldn’t be loaded. Try reloading the page.');
    data = await res.arrayBuffer();
  }
  const { object, zUp, unit } = await load(data, ext);

  // Stand it upright, centre it, and scale it so its longest reach from the middle is one unit.
  object.updateMatrixWorld(true);
  const real = new Box3().setFromObject(object, true).getSize(new Vector3()); // its size as drawn, in the file's own axes
  const holder = new Group();
  holder.add(object);
  if (zUp) holder.rotation.x = -Math.PI / 2;
  holder.updateMatrixWorld(true);
  const box = new Box3().setFromObject(holder, true);
  if (box.isEmpty()) throw new Error('This file has nothing in it to show.');
  const centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 || 1;
  const root = new Group();
  root.add(holder);
  holder.position.sub(centre);
  root.scale.setScalar(1 / half);
  scene.add(root);
  const floor = -(box.getSize(new Vector3()).y / 2) / half;
  const grid = new GridHelper(6, 30, 0x2b59ff, 0x262a31);
  grid.position.y = floor - 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  const camera = new PerspectiveCamera(32, 1, 0.01, 100);
  const HOME = { p: [1.9, 1.25, 2.6], t: [0, 0, 0] };
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.4;
  controls.maxDistance = 12;
  controls.autoRotateSpeed = 1.6;
  controls.enabled = interactive;

  let dirty = true, alive = true, tween = null, raf = 0;
  const apply = v => { camera.position.fromArray(v.p); controls.target.fromArray(v.t); controls.update(); dirty = true; };
  function fit() {
    const w = el.clientWidth || 640, hgt = el.clientHeight || 480;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    // A narrow stage needs the camera further back to keep the whole model in view.
    camera.fov = camera.aspect < 1 ? 32 / Math.max(0.55, camera.aspect) : 32;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  el.append(canvas);
  fit();
  apply(HOME);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(fit) : null;
  ro?.observe(el);
  controls.addEventListener('change', () => { dirty = true; });
  controls.addEventListener('start', () => { tween = null; });

  // Arrow keys turn it; plus and minus zoom.
  canvas.addEventListener('keydown', e => {
    const turn = { ArrowLeft: [-0.16, 0], ArrowRight: [0.16, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key];
    const zoom = { '+': 0.88, '=': 0.88, '-': 1.14, _: 1.14 }[e.key];
    if (!turn && !zoom) return;
    e.preventDefault();
    const off = camera.position.clone().sub(controls.target), s = new Spherical().setFromVector3(off);
    if (turn) { s.theta += turn[0]; s.phi = Math.min(Math.PI - 0.05, Math.max(0.05, s.phi + turn[1])); }
    if (zoom) s.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, s.radius * zoom));
    camera.position.copy(controls.target).add(off.setFromSpherical(s));
    controls.update(); dirty = true;
  });

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (tween) {
      const k = Math.min(1, (now - tween.start) / tween.ms), e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(tween.fromP, tween.toP, e);
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      if (k >= 1) tween = null;
      dirty = true;
    }
    if (controls.update()) dirty = true;
    if (dirty) { dirty = false; renderer.render(scene, camera); }
  }
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);

  const round = n => Math.round(n * 10) / 10;
  return {
    unit,
    size: { x: round(real.x), y: round(real.y), z: round(real.z) },
    getView: () => ({ p: camera.position.toArray().map(n => Math.round(n * 1000) / 1000), t: controls.target.toArray().map(n => Math.round(n * 1000) / 1000) }),
    setView(v, { instant = still() } = {}) {
      if (!v?.p || !v?.t) return;
      if (instant) { apply(v); return; }
      tween = { start: performance.now(), ms: 700, fromP: camera.position.clone(), toP: new Vector3().fromArray(v.p), fromT: controls.target.clone(), toT: new Vector3().fromArray(v.t) };
    },
    reset() { this.setView(HOME); },
    setSpin(on) { controls.autoRotate = on; dirty = true; },
    setWireframe(on) { root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.wireframe = on; }); }); dirty = true; },
    // A picture of the current view, for the item's card.
    snapshot(type = 'image/webp', quality = 0.86) {
      renderer.render(scene, camera);
      return new Promise(resolve => canvas.toBlob(resolve, type, quality));
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      controls.dispose();
      root.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }); } });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
}

// A card picture for a model file, drawn off screen from the same three-quarter view the viewer opens on.
export async function modelThumb(file, ext) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;background:#0B0C0F';
  document.body.append(el);
  let viewer;
  try {
    viewer = await mountModel(el, { data: await file.arrayBuffer(), ext, interactive: false });
    return await viewer.snapshot();
  } finally {
    viewer?.destroy();
    el.remove();
  }
}
