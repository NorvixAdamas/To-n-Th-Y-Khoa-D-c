/**
 * Interactive human anatomy — a WebGL scene built with Three.js.
 * The geometry is a stylised educational diagram (not a patient-specific
 * or photorealistic model). Anatomical terminology comes from Uberon.
 */
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

export const LAYERS = [
  { id: 'skin', label: 'Da & bề mặt', color: '#66dcea' },
  { id: 'muscle', label: 'Hệ cơ', color: '#c25b58' },
  { id: 'skeleton', label: 'Hệ xương', color: '#e9e3d3' },
  { id: 'nervous', label: 'Hệ thần kinh', color: '#f0c14b' },
  { id: 'circulatory', label: 'Hệ tuần hoàn', color: '#e04b58' },
  { id: 'respiratory', label: 'Hệ hô hấp', color: '#7db6e8' },
  { id: 'digestive', label: 'Hệ tiêu hóa', color: '#c98b5a' },
  { id: 'urinary', label: 'Hệ tiết niệu', color: '#9c7bd0' },
  { id: 'endocrine', label: 'Hệ nội tiết', color: '#4fb79a' }
];

/**
 * Organ catalogue. Positions are in scene units (body height ≈ 1.8).
 * `query` is the Uberon search term; `uberon` is the exact identifier.
 */
export const ORGANS = [
  { id: 'brain', vi: 'Não', en: 'brain', layer: 'nervous', query: 'brain', color: 0xd99b9b, position: [0, 1.69, 0.005], scale: [0.08, 0.094, 0.08], shape: 'sphere' },
  { id: 'cerebellum', vi: 'Tiểu não', en: 'cerebellum', layer: 'nervous', query: 'cerebellum', color: 0xe2ab54, position: [0, 1.62, -0.075], scale: [0.06, 0.038, 0.045], shape: 'sphere' },
  { id: 'thyroid', vi: 'Tuyến giáp', en: 'thyroid gland', layer: 'endocrine', query: 'thyroid gland', color: 0x4fc6a5, position: [0, 1.53, 0.04], scale: [0.048, 0.022, 0.028], shape: 'sphere' },
  { id: 'heart', vi: 'Tim', en: 'heart', layer: 'circulatory', query: 'heart', color: 0xdf4a58, position: [0.026, 1.225, 0.055], scale: [0.067, 0.085, 0.057], shape: 'sphere', rotation: [0, 0, -0.22] },
  { id: 'lung-left', vi: 'Phổi trái', en: 'left lung', layer: 'respiratory', query: 'left lung', color: 0x7fc2e8, position: [0.095, 1.32, 0], scale: [0.075, 0.135, 0.06], shape: 'sphere', rotation: [0, 0, 0.1] },
  { id: 'lung-right', vi: 'Phổi phải', en: 'right lung', layer: 'respiratory', query: 'right lung', color: 0x7fc2e8, position: [-0.095, 1.32, 0], scale: [0.075, 0.135, 0.06], shape: 'sphere', rotation: [0, 0, -0.1] },
  { id: 'liver', vi: 'Gan', en: 'liver', layer: 'digestive', query: 'liver', color: 0xa9614b, position: [-0.065, 1.07, 0.025], shape: 'liver' },
  { id: 'stomach', vi: 'Dạ dày', en: 'stomach', layer: 'digestive', query: 'stomach', color: 0xd79a67, position: [0.078, 1.065, 0.025], shape: 'stomach' },
  { id: 'spleen', vi: 'Lách', en: 'spleen', layer: 'digestive', query: 'spleen', color: 0x8e5a6b, position: [0.164, 1.09, -0.015], scale: [0.041, 0.06, 0.038], shape: 'sphere' },
  { id: 'pancreas', vi: 'Tụy', en: 'pancreas', layer: 'digestive', query: 'pancreas', color: 0xd7b47c, position: [0, 0.99, 0.03], shape: 'pancreas' },
  { id: 'kidney-left', vi: 'Thận trái', en: 'left kidney', layer: 'urinary', query: 'left kidney', color: 0x9d7ee0, position: [0.125, 0.95, -0.04], scale: [0.036, 0.06, 0.034], shape: 'sphere', rotation: [0, 0, 0.12] },
  { id: 'kidney-right', vi: 'Thận phải', en: 'right kidney', layer: 'urinary', query: 'right kidney', color: 0x9d7ee0, position: [-0.125, 0.95, -0.04], scale: [0.036, 0.06, 0.034], shape: 'sphere', rotation: [0, 0, -0.12] },
  { id: 'small-intestine', vi: 'Ruột non', en: 'small intestine', layer: 'digestive', query: 'small intestine', color: 0xd6a67a, position: [0, 0.83, 0.04], shape: 'coil' },
  { id: 'large-intestine', vi: 'Đại tràng', en: 'large intestine', layer: 'digestive', query: 'large intestine', color: 0xbb8a62, position: [0, 0.84, -0.025], shape: 'colon' },
  { id: 'bladder', vi: 'Bàng quang', en: 'urinary bladder', layer: 'urinary', query: 'urinary bladder', color: 0xb3a1e4, position: [0, 0.72, 0.03], scale: [0.05, 0.043, 0.043], shape: 'sphere' },
  { id: 'trachea', vi: 'Khí quản', en: 'trachea', layer: 'respiratory', query: 'trachea', color: 0x8ecbea, position: [0, 1.45, 0.02], shape: 'trachea' },
  { id: 'aorta', vi: 'Động mạch chủ', en: 'aorta', layer: 'circulatory', query: 'aorta', color: 0xc0394b, position: [0.005, 1.29, -0.015], shape: 'aorta' },
  { id: 'spinal-cord', vi: 'Tủy sống', en: 'spinal cord', layer: 'nervous', query: 'spinal cord', color: 0xf0c14b, position: [0, 1.12, -0.088], shape: 'cord' }
];

const ORGAN_UBERON = {
  brain: 'UBERON:0000955', cerebellum: 'UBERON:0002037', thyroid: 'UBERON:0002046',
  heart: 'UBERON:0000948', 'lung-left': 'UBERON:0002168', 'lung-right': 'UBERON:0002167',
  liver: 'UBERON:0002107', stomach: 'UBERON:0000945', spleen: 'UBERON:0002106',
  pancreas: 'UBERON:0001264', 'kidney-left': 'UBERON:0004538', 'kidney-right': 'UBERON:0004539',
  'small-intestine': 'UBERON:0002108', 'large-intestine': 'UBERON:0000059',
  bladder: 'UBERON:0001255', trachea: 'UBERON:0003126', aorta: 'UBERON:0000947',
  'spinal-cord': 'UBERON:0002240'
};
for (const organ of ORGANS) organ.uberon = ORGAN_UBERON[organ.id] || null;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function organGeometry(def) {
  switch (def.shape) {
    case 'liver': {
      const shape = new THREE.Shape();
      shape.moveTo(-0.13, -0.04);
      shape.bezierCurveTo(-0.155, 0.035, -0.08, 0.09, 0.015, 0.075);
      shape.bezierCurveTo(0.115, 0.06, 0.155, -0.005, 0.12, -0.06);
      shape.bezierCurveTo(0.06, -0.115, -0.065, -0.105, -0.13, -0.04);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.1, bevelEnabled: true, bevelSize: 0.012,
        bevelThickness: 0.012, bevelSegments: 3, curveSegments: 14
      });
      geo.center();
      geo.scale(0.82, 0.82, 1);
      return geo;
    }
    case 'stomach': {
      const geo = new THREE.TorusGeometry(0.052, 0.026, 12, 28, Math.PI * 1.4);
      geo.rotateZ(-0.42);
      geo.scale(1, 1.12, 0.82);
      return geo;
    }
    case 'pancreas': {
      const geo = new THREE.CapsuleGeometry(0.021, 0.1, 6, 14);
      geo.rotateZ(Math.PI / 2);
      return geo;
    }
    case 'coil': {
      const pts = [];
      for (let i = 0; i <= 44; i++) {
        const t = i / 44;
        const angle = t * Math.PI * 4.3;
        const radius = 0.084 * (1 - t * 0.2);
        pts.push(V(Math.cos(angle) * radius, 0.075 - t * 0.15, Math.sin(angle) * 0.03));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 100, 0.0105, 6, false);
    }
    case 'colon': {
      const pts = [
        V(-0.108, 0.06, 0.01), V(-0.128, -0.015, 0.01), V(-0.126, -0.08, 0.01),
        V(-0.075, -0.122, 0.01), V(0, -0.132, 0.01), V(0.075, -0.122, 0.01),
        V(0.126, -0.08, 0.01), V(0.128, -0.015, 0.01), V(0.108, 0.06, 0.01),
        V(0.06, 0.09, 0.01), V(0, 0.096, 0.01), V(-0.06, 0.09, 0.01)
      ];
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.021, 7, true);
    }
    case 'trachea': {
      const geo = new THREE.CylinderGeometry(0.012, 0.014, 0.13, 14);
      return geo;
    }
    case 'aorta': {
      const pts = [
        V(0, -0.16, 0), V(0.005, -0.06, 0.008), V(0.005, 0.055, 0.008),
        V(-0.03, 0.13, 0), V(-0.072, 0.11, -0.01), V(-0.084, 0.02, -0.018),
        V(-0.078, -0.12, -0.015)
      ];
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.015, 8, false);
    }
    case 'cord':
      return new THREE.CylinderGeometry(0.011, 0.011, 0.3, 10);
    default:
      return new THREE.SphereGeometry(1, 28, 20);
  }
}

export function createAnatomyViewer(container, { onSelect } = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x061321, 0.025);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 1.02, 3.35);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.92, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 6.2;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = Math.PI - 0.3;

  scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x08131f, 1.5));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
  key.position.set(2.5, 3.2, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x66c9e8, 0.8);
  fill.position.set(-2.5, 1.2, 2);
  scene.add(fill);
  const rim = new THREE.PointLight(0x1fb8d4, 18, 8);
  rim.position.set(-1.8, 1.6, -1.8);
  scene.add(rim);

  const materials = [];
  function mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.42,
      metalness: opts.metalness ?? 0.03,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      depthWrite: opts.depthWrite ?? true,
      side: opts.side ?? THREE.FrontSide
    });
    materials.push(m);
    return m;
  }

  const root = new THREE.Group();
  scene.add(root);

  const groups = {};
  for (const layer of LAYERS) {
    groups[layer.id] = new THREE.Group();
    groups[layer.id].name = layer.id;
    root.add(groups[layer.id]);
  }

  /* -------------------------------------------------------------- stage */
  const stage = new THREE.Group();
  scene.add(stage);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.18, 64),
    new THREE.MeshBasicMaterial({ color: 0x061724, transparent: true, opacity: 0.82, depthWrite: false })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.004;
  stage.add(floor);
  for (const r of [0.55, 0.82, 1.08]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.0035, 72),
      new THREE.MeshBasicMaterial({ color: 0x2b9cb2, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.008;
    stage.add(ring);
  }
  const grid = new THREE.PolarGridHelper(1.08, 12, 6, 64, 0x174f60, 0x0c2b36);
  grid.position.y = 0.006;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  grid.material.depthWrite = false;
  stage.add(grid);

  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(180 * 3);
  for (let i = 0; i < 180; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * 0.7;
    dustPositions[i * 3] = Math.cos(a) * r;
    dustPositions[i * 3 + 1] = 0.05 + Math.random() * 1.8;
    dustPositions[i * 3 + 2] = Math.sin(a) * r - 0.1;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0x58c9db, size: 0.0065, transparent: true, opacity: 0.45,
    sizeAttenuation: true, depthWrite: false
  }));
  stage.add(dust);

  /* -------------------------------------------------------------- skin */
  const skinMat = mat(0x6ccfdf, {
    opacity: 0.17, roughness: 0.32, metalness: 0.04,
    emissive: 0x0c3d4a, emissiveIntensity: 0.7,
    depthWrite: false, side: THREE.DoubleSide
  });

  const headSkinMat = skinMat.clone();
  headSkinMat.opacity = 0.4;
  headSkinMat.emissiveIntensity = 0.55;
  materials.push(headSkinMat);

  function skinMesh(geometry, position, scale, rotation, material = skinMat) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.renderOrder = 3;
    groups.skin.add(mesh);
    return mesh;
  }

  function capsuleBetween(a, b, radius, material) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 8, 16);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
    return mesh;
  }

  const torsoProfile = [
    [0.0, 0.68], [0.12, 0.69], [0.17, 0.75], [0.175, 0.82], [0.155, 0.92],
    [0.15, 1.02], [0.165, 1.13], [0.205, 1.25], [0.225, 1.36],
    [0.195, 1.43], [0.1, 1.47], [0.0, 1.48]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = skinMesh(new THREE.LatheGeometry(torsoProfile, 48));
  torso.scale.z = 0.62;

  skinMesh(new THREE.SphereGeometry(1, 32, 24), [0, 0.73, 0], [0.165, 0.105, 0.13]);
  skinMesh(new THREE.SphereGeometry(0.135, 32, 24), [0, 1.68, 0], [0.92, 1.05, 0.95], null, headSkinMat);
  skinMesh(new THREE.CylinderGeometry(0.05, 0.062, 0.13, 20), [0, 1.535, 0]);

  for (const side of [-1, 1]) {
    skinMesh(new THREE.SphereGeometry(1, 20, 16), [side * 0.22, 1.4, 0], [0.085, 0.075, 0.075]);
    groups.skin.add(capsuleBetween(V(side * 0.245, 1.37, 0), V(side * 0.3, 1.1, 0.005), 0.05, skinMat));
    groups.skin.add(capsuleBetween(V(side * 0.3, 1.1, 0.005), V(side * 0.325, 0.85, 0.02), 0.038, skinMat));
    skinMesh(new THREE.SphereGeometry(1, 18, 14), [side * 0.335, 0.79, 0.025], [0.04, 0.055, 0.028]);
    groups.skin.add(capsuleBetween(V(side * 0.1, 0.69, 0), V(side * 0.12, 0.41, 0), 0.068, skinMat));
    groups.skin.add(capsuleBetween(V(side * 0.12, 0.41, 0), V(side * 0.128, 0.09, 0), 0.05, skinMat));
    skinMesh(new THREE.SphereGeometry(1, 18, 14), [side * 0.128, 0.035, 0.05], [0.06, 0.035, 0.1]);
  }

  /* ---------------------------------------------------------- skeleton */
  const boneMat = mat(0xd8cfb9, { roughness: 0.62, metalness: 0.02, opacity: 0.62 });
  const bone = groups.skeleton;

  function boneBetween(a, b, radius) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const geo = new THREE.CylinderGeometry(radius * 0.8, radius, dir.length(), 8);
    const mesh = new THREE.Mesh(geo, boneMat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 26, 20), boneMat);
  skull.position.set(0, 1.685, 0);
  skull.scale.set(0.9, 1.06, 0.95);
  bone.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.045, 0.1), boneMat);
  jaw.position.set(0, 1.605, 0.018);
  bone.add(jaw);

  for (let i = 0; i < 17; i++) {
    const y = 0.78 + i * 0.043;
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.016, 0.032), boneMat);
    v.position.set(0, y, -0.083);
    bone.add(v);
    const process = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.032, 6), boneMat);
    process.position.set(0, y + 0.004, -0.108);
    process.rotation.x = -Math.PI / 2;
    bone.add(process);
  }

  for (let i = 0; i < 9; i++) {
    const y = 1.4 - i * 0.048;
    const w = 0.17 - i * 0.008;
    const d = 0.118 - i * 0.004;
    for (const side of [-1, 1]) {
      const pts = [
        V(0, y + 0.012, -0.078),
        V(side * w * 0.55, y + 0.014, -0.045),
        V(side * w, y + 0.004, 0.022),
        V(side * w * 0.82, y - 0.02, d),
        V(side * 0.035, y - 0.03, d * 0.96)
      ];
      const rib = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.0068, 6, false),
        boneMat
      );
      bone.add(rib);
    }
  }
  const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.016), boneMat);
  sternum.position.set(0, 1.245, 0.117);
  bone.add(sternum);

  for (const side of [-1, 1]) {
    bone.add(boneBetween(V(side * 0.19, 1.43, 0.01), V(0.03, 1.44, 0.08), 0.009));
  }

  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.017, 8, 30, Math.PI), boneMat);
  pelvis.position.set(0, 0.725, -0.02);
  pelvis.rotation.x = Math.PI / 2;
  pelvis.rotation.z = Math.PI;
  bone.add(pelvis);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), boneMat);
    wing.position.set(side * 0.105, 0.75, 0);
    wing.scale.set(0.07, 0.075, 0.032);
    wing.rotation.z = side * 0.3;
    bone.add(wing);
    bone.add(boneBetween(V(side * 0.215, 1.39, 0), V(side * 0.29, 1.11, 0), 0.012));
    bone.add(boneBetween(V(side * 0.29, 1.11, 0), V(side * 0.32, 0.85, 0.015), 0.009));
    bone.add(boneBetween(V(side * 0.29, 1.11, 0), V(side * 0.31, 0.86, 0.025), 0.007));
    bone.add(boneBetween(V(side * 0.1, 0.72, 0), V(side * 0.118, 0.43, 0), 0.016));
    bone.add(boneBetween(V(side * 0.118, 0.43, 0), V(side * 0.126, 0.1, 0), 0.011));
    bone.add(boneBetween(V(side * 0.131, 0.43, 0.012), V(side * 0.14, 0.1, 0.012), 0.007));
    for (const joint of [V(side * 0.29, 1.11, 0), V(side * 0.118, 0.43, 0)]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), boneMat);
      ball.position.copy(joint);
      bone.add(ball);
    }
  }

  /* ------------------------------------------------------------ muscles */
  const muscleMat = mat(0xb45550, { roughness: 0.62, opacity: 0.72 });
  const muscle = groups.muscle;
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), muscleMat);
    pec.position.set(side * 0.072, 1.3, 0.065);
    pec.scale.set(0.085, 0.06, 0.035);
    pec.rotation.z = side * 0.15;
    muscle.add(pec);
    muscle.add(capsuleBetween(V(side * 0.22, 1.36, 0), V(side * 0.26, 1.15, 0.005), 0.038, muscleMat));
    muscle.add(capsuleBetween(V(side * 0.095, 0.66, 0.02), V(side * 0.108, 0.46, 0.02), 0.05, muscleMat));
    muscle.add(capsuleBetween(V(side * 0.108, 0.4, 0.005), V(side * 0.115, 0.16, 0.005), 0.037, muscleMat));
  }
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const ab = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), muscleMat);
      ab.position.set(side * 0.035, 1.1 - i * 0.075, 0.1);
      ab.scale.set(0.03, 0.032, 0.012);
      muscle.add(ab);
    }
  }

  /* ------------------------------------------------------------- organs */
  const selectable = [];
  for (const def of ORGANS) {
    const material = mat(def.color, {
      roughness: 0.34, metalness: 0.02,
      emissive: def.color, emissiveIntensity: 0.09
    });
    const mesh = new THREE.Mesh(organGeometry(def), material);
    mesh.position.set(...def.position);
    if (def.shape === 'sphere') mesh.scale.set(...def.scale);
    if (def.rotation) mesh.rotation.set(...def.rotation);
    mesh.userData.baseScale = mesh.scale.clone();
    mesh.userData.baseEmissive = 0.09;
    mesh.userData.organ = def;
    mesh.name = def.id;
    groups[def.layer].add(mesh);
    selectable.push(mesh);
  }

  /* --------------------------------------------------- organ connections */
  const respMat = mat(0x9ed4f0, { roughness: 0.38, emissive: 0x4e9bc4, emissiveIntensity: 0.12 });
  for (const side of [-1, 1]) {
    groups.respiratory.add(capsuleBetween(V(0, 1.405, 0.02), V(side * 0.078, 1.3, 0.015), 0.007, respMat));
  }

  const vesselMat = mat(0xb93242, { roughness: 0.4, emissive: 0x6d1420, emissiveIntensity: 0.12 });
  groups.circulatory.add(capsuleBetween(V(-0.035, 1.39, -0.03), V(-0.035, 1.05, -0.03), 0.011, vesselMat));
  groups.circulatory.add(capsuleBetween(V(0.012, 1.36, 0.02), V(0.012, 1.5, 0.03), 0.007, vesselMat));
  for (const side of [-1, 1]) {
    groups.circulatory.add(capsuleBetween(V(0.01, 1.34, 0.02), V(side * 0.045, 1.47, 0.02), 0.005, vesselMat));
    groups.circulatory.add(capsuleBetween(V(side * 0.025, 0.98, 0.02), V(side * 0.09, 0.79, 0.015), 0.005, vesselMat));
  }

  const ureterMat = mat(0xc9b8ef, { roughness: 0.45, emissive: 0x6f5799, emissiveIntensity: 0.08 });
  for (const side of [-1, 1]) {
    groups.urinary.add(capsuleBetween(V(side * 0.125, 0.91, -0.03), V(side * 0.02, 0.74, 0.015), 0.004, ureterMat));
  }

  const nerveMat = mat(0xe0b54a, { roughness: 0.5, emissive: 0x6b5010, emissiveIntensity: 0.1 });
  for (const side of [-1, 1]) {
    groups.nervous.add(capsuleBetween(V(side * 0.02, 1.48, -0.06), V(side * 0.16, 1.34, -0.02), 0.004, nerveMat));
    groups.nervous.add(capsuleBetween(V(side * 0.02, 1.0, -0.08), V(side * 0.1, 0.67, -0.035), 0.0045, nerveMat));
    groups.nervous.add(capsuleBetween(V(side * 0.1, 0.67, -0.035), V(side * 0.115, 0.14, -0.01), 0.0035, nerveMat));
  }

  /* ---------------------------------------------------------- interaction */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let selected = null;
  let autoRotate = false;
  let disposed = false;
  let pointerDown = null;

  function setPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pick(event) {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(selectable.filter(m => m.parent && m.parent.visible), false);
    return hits.length ? hits[0].object : null;
  }

  function setEmissive(mesh, value) {
    if (mesh?.material?.emissive) mesh.material.emissiveIntensity = value;
  }

  function highlight(mesh) {
    if (hovered && hovered !== mesh) setEmissive(hovered, hovered === selected ? 0.65 : hovered.userData.baseEmissive);
    hovered = mesh;
    if (mesh) setEmissive(mesh, 0.42);
    renderer.domElement.style.cursor = mesh ? 'pointer' : 'grab';
  }

  function select(mesh) {
    if (selected) {
      setEmissive(selected, selected.userData.baseEmissive);
      if (selected.userData.baseScale) selected.scale.copy(selected.userData.baseScale);
    }
    selected = mesh;
    if (mesh) setEmissive(mesh, 0.65);
    if (mesh && onSelect) onSelect(mesh.userData.organ);
  }

  const onMove = (event) => {
    if (disposed || event.buttons) return;
    highlight(pick(event));
  };
  const onDown = (event) => { pointerDown = { x: event.clientX, y: event.clientY }; };
  const onUp = (event) => {
    if (disposed) return;
    const start = pointerDown;
    pointerDown = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const mesh = pick(event);
    if (mesh) select(mesh);
  };
  const onLeave = () => highlight(null);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointerleave', onLeave);

  const resize = () => {
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 560;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let frameId;
  const clock = new THREE.Clock();
  function animate() {
    if (disposed) return;
    frameId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    if (autoRotate) root.rotation.y += 0.0035;
    if (selected && selected.userData.baseScale) {
      selected.scale.copy(selected.userData.baseScale).multiplyScalar(1 + Math.sin(t * 2.6) * 0.012);
    }
    stage.rotation.y = Math.sin(t * 0.08) * 0.02;
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    groups,
    selectOrgan(id) {
      const mesh = selectable.find(m => m.userData.organ.id === id);
      if (mesh) select(mesh);
    },
    setLayer(id, visible) {
      if (groups[id]) groups[id].visible = visible;
    },
    getLayers() { return groups; },
    toggleAutoRotate() { autoRotate = !autoRotate; return autoRotate; },
    front() {
      camera.position.set(0, 1.02, 3.35);
      controls.target.set(0, 0.92, 0);
      controls.update();
    },
    back() {
      camera.position.set(0, 1.02, -3.35);
      controls.target.set(0, 0.92, 0);
      controls.update();
    },
    reset() {
      root.rotation.set(0, 0, 0);
      this.front();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      for (const m of materials) m.dispose();
      scene.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
