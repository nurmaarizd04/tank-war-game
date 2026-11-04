import * as THREE from "three";
import { tankById } from "../data/tanks";
import type { Particle } from "../game/effects";
import type { Game } from "../game/game";
import { angleDiff, clamp, lerp, smoothing } from "../game/math";
import type { Tank } from "../game/tank";
import type { Obstacle, World } from "../game/world";
import { applyEnvironment, buildTank, createTankEnvironment, disposeTankRig, setWrecked, textures, TRACK_H, type TankRig } from "./models";

const MOBILE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
const ROOF_COLORS = [0x8a4b3a, 0x6d6a63, 0x7b5a41, 0x5d6670, 0x94785a];
const FOV = 40;
const TILT = (55 * Math.PI) / 180;
/** Kamera dari belakang tank: jarak ke belakang, tinggi, titik pandang di depan tank */
const CHASE = { fov: 58, back: 200, height: 105, ahead: 170, lookHeight: 18 };
/** Saat gedung menghalangi: kamera naik & mendekat (lebih menunduk) */
const CHASE_LIFTED = { back: 110, height: 250 };

// ---------------- Partikel (satu draw call per lapisan) ----------------

class ParticleLayer {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly capacity: number;
  readonly material: THREE.ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("pcolor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("psize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("palpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
          vColor = pcolor; vAlpha = palpha;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor, (1.0 - smoothstep(0.12, 0.5, d)) * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  fill(list: Particle[], accept: (p: Particle) => boolean, W: number, H: number) {
    let n = 0;
    for (const p of list) {
      if (n >= this.capacity || !accept(p)) continue;
      const t = p.life / p.maxLife;
      this.pos[n * 3] = p.x - W / 2;
      this.pos[n * 3 + 1] = p.z;
      this.pos[n * 3 + 2] = p.y - H / 2;
      const [r, g, b] = p.color.split(",").map(Number);
      this.col[n * 3] = r / 255;
      this.col[n * 3 + 1] = g / 255;
      this.col[n * 3 + 2] = b / 255;
      this.size[n] = p.size * 2;
      this.alpha[n] =
        p.kind === "smoke" ? 0.5 * t : p.kind === "dust" ? 0.38 * t : p.kind === "fire" ? Math.min(1, t * 1.5) : p.kind === "spark" ? t : 1;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ["position", "pcolor", "psize", "palpha"]) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface ObstacleSlot {
  mesh: THREE.InstancedMesh | THREE.Object3D;
  index: number;
  extra?: THREE.InstancedMesh[];
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 7000);
  private readonly sun: THREE.DirectionalLight;
  private readonly overlay: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private env = new THREE.Group();
  private world: World | null = null;
  private rigs = new Map<string, { rig: TankRig; modelId: string }>();
  private obstacleSlots = new Map<number, ObstacleSlot>();
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private smoke = new ParticleLayer(700, false);
  private glow = new ParticleLayer(500, true);
  private lights: THREE.PointLight[] = [];
  private shells: THREE.InstancedMesh;
  private trackDecals: THREE.InstancedMesh;
  private scorchDecals: THREE.InstancedMesh;
  private trackIndex = 0;
  private scorchIndex = 0;
  private aimLine: THREE.Line;
  private focusX = 1200;
  private focusY = 800;
  private targetX = 1200;
  private targetY = 800;
  private followRate = 5;
  /** Kamera dari belakang tank pemain (false = pandangan atas untuk demo/menu) */
  private chaseOn = false;
  private chaseAngle = 0;
  /** Arah dunia yang menghadap ke atas layar (−π/2 = pandangan atas biasa) */
  private yaw = -Math.PI / 2;
  private lift = 0;
  private shakeAmount = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private time = 0;
  private readonly tmp = new THREE.Object3D();
  private readonly vec = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly mats = {
    concrete: new THREE.MeshStandardMaterial({ map: textures.concrete(), roughness: 0.95 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.95, flatShading: true }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5b4027, roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    crate: new THREE.MeshStandardMaterial({ map: textures.crate(), roughness: 0.9 }),
    barrel: new THREE.MeshStandardMaterial({ map: textures.barrel(), roughness: 0.6, metalness: 0.3 }),
  };
  private readonly facade = textures.facade();
  private readonly hemi = new THREE.HemisphereLight(0xe4efff, 0x46552c, 1.25);
  /** Pantulan untuk cat & logam tank */
  private tankEnv: THREE.Texture | null = null;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE || window.devicePixelRatio < 2, powerPreference: "high-performance" });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.overlay = overlay;
    this.octx = overlay.getContext("2d")!;

    this.scene.background = new THREE.Color(0x7d8f6a);
    this.scene.fog = new THREE.Fog(0x7d8f6a, 1500, 3400);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -720;
    cam.right = 720;
    cam.top = 720;
    cam.bottom = -720;
    cam.near = 50;
    cam.far = 2200;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.sun, this.sun.target);

    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffb060, 0, 320, 1.6);
      this.lights.push(light);
      this.scene.add(light);
    }

    this.scene.add(this.env, this.smoke.points, this.glow.points);

    this.shells = new THREE.InstancedMesh(new THREE.CapsuleGeometry(2, 14, 4, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }), 128);
    this.shells.count = 0;
    this.shells.frustumCulled = false;
    this.scene.add(this.shells);

    const trackGeo = new THREE.PlaneGeometry(5, 1).rotateX(-Math.PI / 2);
    this.trackDecals = new THREE.InstancedMesh(trackGeo, new THREE.MeshBasicMaterial({ color: 0x2a2014, transparent: true, opacity: 0.2, depthWrite: false }), 2400);
    this.scorchDecals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: textures.soft(), color: 0x140f0a, transparent: true, opacity: 0.8, depthWrite: false }),
      100,
    );
    for (const mesh of [this.trackDecals, this.scorchDecals]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.clearInstances(mesh);
      this.scene.add(mesh);
    }

    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 12, gapSize: 10, transparent: true, opacity: 0.55 }));
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private clearInstances(mesh: THREE.InstancedMesh) {
    this.tmp.position.set(0, -1000, 0);
    this.tmp.scale.set(0, 0, 0);
    this.tmp.updateMatrix();
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.tmp.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 1.6 : 2);
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(this.cssW, this.cssH, false);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    this.overlay.width = Math.round(this.cssW * this.dpr);
    this.overlay.height = Math.round(this.cssH * this.dpr);
    this.updateParticleScale();
  }

  private updateParticleScale() {
    const scale = (this.cssH * this.dpr) / (2 * Math.tan(((this.camera.fov / 2) * Math.PI) / 180));
    this.smoke.material.uniforms.uScale.value = scale;
    this.glow.material.uniforms.uScale.value = scale;
  }

  /** Ganti FOV & jarak kabut sesuai mode kamera */
  private applyCameraMode() {
    this.camera.fov = this.chaseOn ? CHASE.fov : FOV;
    this.camera.updateProjectionMatrix();
    this.updateParticleScale();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.chaseOn ? 700 : 1500;
    fog.far = this.chaseOn ? 2600 : 3400;
  }

  // ---------------- Kamera ----------------

  /** Pandangan atas yang mengikuti titik (demo / menu) */
  focus(x: number, y: number, snap = false, rate = 5) {
    this.chaseOn = false;
    this.yaw = -Math.PI / 2;
    this.targetX = x;
    this.targetY = y;
    this.followRate = rate;
    if (snap) {
      this.focusX = x;
      this.focusY = y;
    }
  }

  /** Kamera dari belakang tank, berputar mengikuti arah badan tank */
  chase(x: number, y: number, angle: number, snap = false) {
    this.chaseOn = true;
    this.chaseAngle = angle;
    this.focusX = this.targetX = x;
    this.focusY = this.targetY = y;
    if (snap) {
      this.yaw = angle;
      this.lift = 0;
    }
  }

  /** Ubah arah di layar (x kanan, y bawah) menjadi arah di dunia sesuai putaran kamera */
  viewToWorld(x: number, y: number) {
    const fx = Math.cos(this.yaw);
    const fy = Math.sin(this.yaw);
    return { x: -fy * x - fx * y, y: fx * x - fy * y };
  }

  get focusPoint() {
    return { x: this.focusX, y: this.focusY };
  }

  shake(amount: number) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  private get distance() {
    // ±820 unit dunia terlihat melebar di layar landscape
    return clamp(820 / (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * this.camera.aspect), 470, 760);
  }

  private updateCamera(dt: number) {
    if (this.camera.fov !== (this.chaseOn ? CHASE.fov : FOV)) this.applyCameraMode();
    if (this.chaseOn) {
      this.updateChaseCamera(dt);
      return;
    }
    const W = this.world?.width ?? 2400;
    const H = this.world?.height ?? 1600;
    const k = smoothing(this.followRate, dt);
    this.focusX += (this.targetX - this.focusX) * k;
    this.focusY += (this.targetY - this.focusY) * k;
    // Boleh sedikit melewati tepi agar tank di pinggir arena tetap di tengah layar
    this.focusX = clamp(this.focusX, 60, W - 60);
    this.focusY = clamp(this.focusY, 40, H - 40);
    const d = this.distance;
    const fx = this.focusX - W / 2;
    const fz = this.focusY - H / 2;
    const sx = this.shakeAmount > 0.3 ? (Math.random() - 0.5) * this.shakeAmount : 0;
    const sz = this.shakeAmount > 0.3 ? (Math.random() - 0.5) * this.shakeAmount : 0;
    this.shakeAmount *= Math.exp(-dt * 9);
    this.camera.position.set(fx + sx, Math.sin(TILT) * d, fz + Math.cos(TILT) * d + sz);
    this.camera.lookAt(fx + sx, 0, fz + sz);
    this.sun.position.set(fx - 380, 700, fz + 260);
    this.sun.target.position.set(fx, 0, fz);
  }

  private updateChaseCamera(dt: number) {
    const W = this.world?.width ?? 2400;
    const H = this.world?.height ?? 1600;
    this.yaw += angleDiff(this.yaw, this.chaseAngle) * smoothing(3.5, dt);
    this.lift += ((this.chaseBlocked() ? 1 : 0) - this.lift) * smoothing(4, dt);
    const back = lerp(CHASE.back, CHASE_LIFTED.back, this.lift);
    const height = lerp(CHASE.height, CHASE_LIFTED.height, this.lift);
    const fx = Math.cos(this.yaw);
    const fy = Math.sin(this.yaw);
    const tx = this.focusX - W / 2;
    const tz = this.focusY - H / 2;
    const sx = this.shakeAmount > 0.3 ? (Math.random() - 0.5) * this.shakeAmount : 0;
    const sy = this.shakeAmount > 0.3 ? (Math.random() - 0.5) * this.shakeAmount * 0.5 : 0;
    this.shakeAmount *= Math.exp(-dt * 9);
    this.camera.position.set(tx - fx * back + sx, height + sy, tz - fy * back);
    this.camera.lookAt(tx + fx * CHASE.ahead + sx, CHASE.lookHeight + sy, tz + fy * CHASE.ahead);
    // Bayangan dipusatkan di depan tank, area yang paling banyak terlihat
    const ax = tx + fx * 380;
    const az = tz + fy * 380;
    this.sun.position.set(ax - 380, 700, az + 260);
    this.sun.target.position.set(ax, 0, az);
  }

  /** Ada gedung di antara tank dan kamera (bagian garis pandang yang lebih rendah dari atap) */
  private chaseBlocked() {
    if (!this.world) return false;
    const fx = Math.cos(this.yaw);
    const fy = Math.sin(this.yaw);
    for (let t = 0.15; t <= 0.65; t += 0.1) {
      const o = this.world.pointBlocked(this.focusX - fx * CHASE.back * t, this.focusY - fy * CHASE.back * t);
      if (o?.kind === "building") return true;
    }
    return false;
  }

  /** Titik di tanah di bawah posisi layar. far = bila mengarah ke langit, pakai titik jauh searah pandangan */
  screenToGround(sx: number, sy: number, far = false) {
    if (!this.world) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1), this.camera);
    const ray = this.raycaster.ray;
    const hit = ray.intersectPlane(this.groundPlane, this.vec);
    if (hit) return { x: hit.x + this.world.width / 2, y: hit.z + this.world.height / 2 };
    if (!far) return null;
    const d = Math.hypot(ray.direction.x, ray.direction.z) || 1;
    return { x: ray.origin.x + (ray.direction.x / d) * 3000 + this.world.width / 2, y: ray.origin.z + (ray.direction.z / d) * 3000 + this.world.height / 2 };
  }

  private project(x: number, height: number, y: number) {
    const W = this.world?.width ?? 2400;
    const H = this.world?.height ?? 1600;
    this.vec.set(x - W / 2, height, y - H / 2).project(this.camera);
    return { x: ((this.vec.x + 1) / 2) * this.cssW, y: ((1 - this.vec.y) / 2) * this.cssH, behind: this.vec.z > 1 };
  }

  // ---------------- Dunia ----------------

  setWorld(world: World) {
    this.world = world;
    this.scene.remove(this.env);
    this.env.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (!Object.values(this.mats).includes(m as THREE.MeshStandardMaterial)) m.dispose();
      }
    });
    for (const { rig, modelId } of this.rigs.values()) {
      this.scene.remove(rig.root);
      disposeTankRig(rig, tankById(modelId));
    }
    this.rigs.clear();
    for (const mesh of this.pickupMeshes.values()) this.scene.remove(mesh);
    this.pickupMeshes.clear();
    this.obstacleSlots.clear();
    this.clearInstances(this.trackDecals);
    this.clearInstances(this.scorchDecals);
    this.env = new THREE.Group();
    this.scene.add(this.env);
    this.buildEnvironment(world);
  }

  private buildEnvironment(world: World) {
    const W = world.width;
    const H = world.height;
    const theme = world.theme;
    (this.scene.background as THREE.Color).set(theme.sky);
    this.scene.fog!.color.set(theme.sky);
    this.hemi.groundColor.set(theme.bounce);
    this.mats.rock.color.set(theme.rock);
    const roofColors = theme.roofs ?? ROOF_COLORS;

    const groundTex = new THREE.CanvasTexture(world.ground);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
    ground.receiveShadow = true;
    this.env.add(ground);

    const outside = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: theme.outside, roughness: 1 }));
    outside.position.y = -0.5;
    outside.receiveShadow = true;
    this.env.add(outside);

    // Tembok batas arena
    const border = [
      [0, -H / 2 - 9, W + 36, 18],
      [0, H / 2 + 9, W + 36, 18],
      [-W / 2 - 9, 0, 18, H],
      [W / 2 + 9, 0, 18, H],
    ];
    for (const [x, z, w, d] of border) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 22, d), this.mats.concrete);
      wall.position.set(x, 11, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.env.add(wall);
    }

    const trees = world.obstacles.filter((o) => o.kind === "tree");
    const crates = world.obstacles.filter((o) => o.kind === "crate");
    const barrels = world.obstacles.filter((o) => o.kind === "barrel");

    for (const o of world.obstacles) {
      const x = o.x - W / 2;
      const z = o.y - H / 2;
      if (o.kind === "building") {
        const height = 46 + o.tint * 40;
        const tex = this.facade.clone();
        tex.repeat.set(Math.max(1, Math.round(o.w / 60)), Math.max(1, Math.round(height / 50)));
        tex.needsUpdate = true;
        const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(o.w, height, o.h), wallMat);
        body.position.set(x, height / 2, z);
        body.castShadow = true;
        body.receiveShadow = true;
        this.env.add(body);
        // Atap pelana di sepanjang sisi terpanjang
        const alongX = o.w >= o.h;
        const span = (alongX ? o.h : o.w) + 10;
        const length = (alongX ? o.w : o.h) + 10;
        const tri = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, span * 0.34)]);
        const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: length, bevelEnabled: false });
        roofGeo.translate(0, 0, -length / 2);
        if (alongX) roofGeo.rotateY(Math.PI / 2);
        const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: roofColors[Math.floor(o.tint * roofColors.length)], roughness: 0.85, flatShading: true }));
        roof.position.set(x, height, z);
        roof.castShadow = true;
        this.env.add(roof);
      } else if (o.kind === "wall") {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(o.w, 28, o.h), this.mats.concrete);
        wall.position.set(x, 14, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.env.add(wall);
      } else if (o.kind === "rock") {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r, 0), this.mats.rock);
        rock.scale.set(1, 0.75, 1);
        rock.rotation.set(o.tint * 3, o.tint * 7, o.tint * 2);
        rock.position.set(x, o.r * 0.35, z);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.env.add(rock);
      }
    }

    // Pohon (instanced: batang + 2 lapis daun)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.5, 4, 24, 6).translate(0, 12, 0), this.mats.trunk, trees.length);
    const low = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1.5, 7).translate(0, 0.75, 0), this.mats.leaves, trees.length);
    const high = new THREE.InstancedMesh(new THREE.ConeGeometry(0.72, 1.25, 7).translate(0, 0.62, 0), this.mats.leaves, trees.length);
    trees.forEach((o, i) => {
      const x = o.x - W / 2;
      const z = o.y - H / 2;
      const { hue, sat, light } = theme.leaves;
      const color = new THREE.Color().setHSL(lerp(hue[0], hue[1], o.tint) / 360, sat, lerp(light[0], light[1], o.tint));
      const s = o.r * 1.1;
      this.setInstance(trunk, i, x, 0, z, 1, 1, 1, o.tint * 6);
      this.setInstance(low, i, x, 16, z, s, s, s, o.tint * 6);
      this.setInstance(high, i, x, 16 + s * 0.85, z, s, s, s, o.tint * 6);
      low.setColorAt(i, color);
      high.setColorAt(i, color.clone().offsetHSL(0, 0, 0.05));
      this.obstacleSlots.set(o.index, { mesh: trunk, index: i, extra: [low, high] });
    });
    for (const mesh of [trunk, low, high]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.env.add(mesh);
    }

    const crateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(30, 30, 30).translate(0, 15, 0), this.mats.crate, crates.length);
    crates.forEach((o, i) => {
      this.setInstance(crateMesh, i, o.x - W / 2, 0, o.y - H / 2, 1, 1, 1, o.tint * 1.5);
      this.obstacleSlots.set(o.index, { mesh: crateMesh, index: i });
    });
    const barrelMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(12, 12, 28, 16).translate(0, 14, 0), this.mats.barrel, barrels.length);
    barrels.forEach((o, i) => {
      this.setInstance(barrelMesh, i, o.x - W / 2, 0, o.y - H / 2, 1, 1, 1, o.tint * 6);
      this.obstacleSlots.set(o.index, { mesh: barrelMesh, index: i });
    });
    for (const mesh of [crateMesh, barrelMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.env.add(mesh);
    }

    // Obstacle yang sudah hancur (misal pemain bergabung di tengah) disembunyikan
    for (const o of world.obstacles) if (o.destroyed) this.obstacleDestroyed(o);
  }

  private setInstance(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number) {
    this.tmp.position.set(x, y, z);
    this.tmp.rotation.set(0, rotY, 0);
    this.tmp.scale.set(sx, sy, sz);
    this.tmp.updateMatrix();
    mesh.setMatrixAt(i, this.tmp.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  obstacleDestroyed(o: Obstacle) {
    const slot = this.obstacleSlots.get(o.index);
    if (!slot || !(slot.mesh instanceof THREE.InstancedMesh)) return;
    const W = this.world?.width ?? 2400;
    const H = this.world?.height ?? 1600;
    if (o.kind === "tree") {
      // Sisakan tunggul
      this.setInstance(slot.mesh, slot.index, o.x - W / 2, 0, o.y - H / 2, 1.3, 0.22, 1.3, 0);
      for (const leaves of slot.extra ?? []) this.setInstance(leaves, slot.index, 0, -1000, 0, 0, 0, 0, 0);
    } else {
      this.setInstance(slot.mesh, slot.index, 0, -1000, 0, 0, 0, 0, 0);
    }
  }

  private drainDecals(world: World) {
    const W = world.width;
    const H = world.height;
    for (const d of world.decals) {
      if (d.kind === "track") {
        const tw = d.width * 0.22;
        const off = d.width / 2 - tw / 2;
        for (const side of [-1, 1]) {
          const px = d.x - Math.sin(d.angle) * off * side;
          const py = d.y + Math.cos(d.angle) * off * side;
          this.tmp.position.set(px - W / 2, 0.25, py - H / 2);
          this.tmp.rotation.set(0, -d.angle, 0);
          this.tmp.scale.set(1, 1, tw);
          this.tmp.updateMatrix();
          this.trackDecals.setMatrixAt(this.trackIndex, this.tmp.matrix);
          this.trackIndex = (this.trackIndex + 1) % this.trackDecals.count;
        }
        this.trackDecals.instanceMatrix.needsUpdate = true;
      } else {
        this.tmp.position.set(d.x - W / 2, 0.35 + this.scorchIndex * 0.001, d.y - H / 2);
        this.tmp.rotation.set(0, Math.random() * 6, 0);
        this.tmp.scale.set(d.r * 2, 1, d.r * 2);
        this.tmp.updateMatrix();
        this.scorchDecals.setMatrixAt(this.scorchIndex, this.tmp.matrix);
        this.scorchIndex = (this.scorchIndex + 1) % this.scorchDecals.count;
        this.scorchDecals.instanceMatrix.needsUpdate = true;
      }
    }
    world.decals.length = 0;
  }

  // ---------------- Frame ----------------

  render(dt: number, game: Game) {
    const world = game.world;
    if (world !== this.world) this.setWorld(world);
    if (window.innerWidth !== this.cssW || window.innerHeight !== this.cssH) this.resize();
    this.time += dt;
    const W = world.width;
    const H = world.height;

    this.syncTanks(game.tanks, game.mode === "solo" || game.mode === "demo", W, H);
    this.syncShells(game, W, H);
    this.syncPickups(game, W, H);
    this.drainDecals(world);

    const particles = game.effects.particles;
    this.smoke.fill(particles, (p) => p.kind === "smoke" || p.kind === "dust" || p.kind === "debris", W, H);
    this.glow.fill(particles, (p) => p.kind === "fire" || p.kind === "spark", W, H);

    // Kilatan cahaya: pakai 4 lampu untuk kilatan paling terang
    const flashes = [...game.effects.flashes].sort((a, b) => b.intensity * (b.life / b.maxLife) - a.intensity * (a.life / a.maxLife));
    this.lights.forEach((light, i) => {
      const f = flashes[i];
      if (!f) {
        light.intensity = 0;
        return;
      }
      light.position.set(f.x - W / 2, f.z + 20, f.y - H / 2);
      light.intensity = f.intensity * (f.life / f.maxLife) * 2500;
    });

    const local = game.local;
    if (local?.alive && game.input.aimStick) {
      const pts = [new THREE.Vector3(local.muzzleX - W / 2, 22, local.muzzleY - H / 2), new THREE.Vector3(local.pivotX + Math.cos(local.turret) * local.model.range - W / 2, 22, local.pivotY + Math.sin(local.turret) * local.model.range - H / 2)];
      this.aimLine.geometry.setFromPoints(pts);
      this.aimLine.computeLineDistances();
      this.aimLine.visible = true;
    } else this.aimLine.visible = false;

    this.updateCamera(dt);
    this.gl.render(this.scene, this.camera);
    this.drawOverlay(game);
  }

  private syncTanks(tanks: Tank[], fadeWrecks: boolean, W: number, H: number) {
    const present = new Set<string>();
    for (const t of tanks) {
      present.add(t.id);
      let entry = this.rigs.get(t.id);
      if (!entry || entry.modelId !== t.model.id) {
        if (entry) {
          this.scene.remove(entry.rig.root);
          disposeTankRig(entry.rig, tankById(entry.modelId));
        }
        entry = { rig: buildTank(t.model), modelId: t.model.id };
        this.tankEnv ??= createTankEnvironment(this.gl);
        applyEnvironment(entry.rig, this.tankEnv);
        this.rigs.set(t.id, entry);
        this.scene.add(entry.rig.root);
      }
      const { rig } = entry;
      rig.root.position.set(t.x - W / 2, 0, t.y - H / 2);
      rig.root.rotation.y = -t.angle;
      rig.turret.rotation.y = -(t.turret - t.angle);
      rig.barrel.position.x = t.sprites.muzzle - t.model.look.barrel - t.recoil * 6;
      for (const tread of rig.treads) tread.offset.x = -t.trackDistance / 8;
      setWrecked(rig, !t.alive);
      const flash = t.alive ? t.hitFlash * 0.45 : 0;
      for (const m of rig.paint) {
        const glow = t.alive ? (m.userData.glow as THREE.Color | undefined) : undefined;
        m.emissive.setRGB(flash + (glow?.r ?? 0), flash * 0.85 + (glow?.g ?? 0), flash * 0.6 + (glow?.b ?? 0));
      }
      rig.shield.visible = t.alive && t.shield > 0;
      if (rig.shield.visible) (rig.shield.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(this.time * 8) * 0.06;
      // Bangkai tenggelam perlahan lalu hilang
      const sink = fadeWrecks && !t.alive ? clamp((t.deadTime - 10) / 3, 0, 1) : 0;
      rig.root.position.y = -sink * TRACK_H * 2.5;
      rig.root.visible = sink < 1;
    }
    for (const [id, { rig, modelId }] of this.rigs) {
      if (present.has(id)) continue;
      this.scene.remove(rig.root);
      disposeTankRig(rig, tankById(modelId));
      this.rigs.delete(id);
    }
  }

  private syncShells(game: Game, W: number, H: number) {
    const shells = game.shells;
    const n = Math.min(shells.length, 128);
    for (let i = 0; i < n; i++) {
      const s = shells[i];
      this.tmp.position.set(s.x - W / 2, 22, s.y - H / 2);
      this.tmp.rotation.set(0, -Math.atan2(s.vy, s.vx), 0);
      this.tmp.scale.set(1, 1, 1);
      this.tmp.updateMatrix();
      this.shells.setMatrixAt(i, this.tmp.matrix);
    }
    this.shells.count = n;
    this.shells.instanceMatrix.needsUpdate = true;
    // Jejak cahaya peluru
    for (let i = 0; i < n; i++) {
      const s = shells[i];
      if (Math.random() < 0.6) game.effects.particles.push({ kind: "fire", x: s.x - s.vx * 0.01, y: s.y - s.vy * 0.01, z: 22, vx: 0, vy: 0, vz: 0, life: 0.12, maxLife: 0.12, size: 5, grow: -20, drag: 0, gravity: 0, color: "255,200,110" });
    }
  }

  private syncPickups(game: Game, W: number, H: number) {
    const present = new Set<number>();
    for (const p of game.pickups) {
      present.add(p.id);
      let mesh = this.pickupMeshes.get(p.id);
      if (!mesh) {
        mesh = this.buildPickup(p.kind);
        this.pickupMeshes.set(p.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(p.x - W / 2, 16 + Math.sin(this.time * 3 + p.id) * 4, p.y - H / 2);
      mesh.rotation.y = this.time * 1.8;
      mesh.visible = p.life > 3 || Math.floor(p.life * 6) % 2 === 1;
    }
    for (const [id, mesh] of this.pickupMeshes) {
      if (present.has(id)) continue;
      this.scene.remove(mesh);
      this.pickupMeshes.delete(id);
    }
  }

  private buildPickup(kind: "repair" | "rapid") {
    const group = new THREE.Group();
    const color = kind === "repair" ? 0x3ddc84 : 0xffc233;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 });
    if (kind === "repair") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(18, 18, 18), mat);
      group.add(box);
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (const [w, h] of [
        [12, 4],
        [4, 12],
      ]) {
        for (const side of [-1, 1]) {
          const cross = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1), white);
          cross.position.z = side * 9.2;
          group.add(cross);
        }
      }
    } else {
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(13), mat));
    }
    group.traverse((o) => (o.castShadow = true));
    return group;
  }

  // ---------------- Lapisan 2D (nama, HP, minimap, joystick) ----------------

  private drawOverlay(game: Game) {
    const ctx = this.octx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const battle = game.mode === "solo" || game.isVersus;
    if (!battle) return;
    const local = game.local;

    // Nama & bar HP di atas tank
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const t of game.tanks) {
      if (!t.alive) continue;
      const p = this.project(t.x, 62, t.y);
      if (p.behind) continue;
      const w = 50;
      const ratio = clamp(t.hp / t.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(p.x - w / 2 - 1, p.y - 1, w + 2, 7);
      ctx.fillStyle = t === local ? "#46d36b" : ratio < 0.35 ? "#ff9f43" : "#ef4b4b";
      ctx.fillRect(p.x - w / 2, p.y, w * ratio, 5);
      if (t === local && game.mode !== "client" && t.reloadProgress < 1) {
        ctx.fillStyle = "rgba(255,210,120,0.9)";
        ctx.fillRect(p.x - w / 2, p.y + 7, w * t.reloadProgress, 3);
      }
      if (t.label) {
        ctx.font = `700 ${t === local ? 14 : 13}px Rajdhani, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.strokeText(t.label, p.x, p.y - 3);
        ctx.fillStyle = t === local ? "#9dffb4" : "#ffffff";
        ctx.fillText(t.label, p.x, p.y - 3);
      }
    }

    // Angka kerusakan melayang
    ctx.textBaseline = "middle";
    for (const text of game.effects.texts) {
      const p = this.project(text.x, text.z, text.y);
      if (p.behind) continue;
      ctx.globalAlpha = Math.min(1, text.life * 2);
      ctx.font = `bold ${text.size}px "Russo One", sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(text.text, p.x, p.y);
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    this.drawIndicators(ctx, game);
    this.drawMinimap(ctx, game);
    this.drawSticks(ctx, game);
  }

  /** Panah di tepi layar yang menunjuk musuh di luar pandangan */
  private drawIndicators(ctx: CanvasRenderingContext2D, game: Game) {
    const local = game.local;
    const cx = this.cssW / 2;
    const cy = this.cssH / 2;
    for (const t of game.tanks) {
      if (!t.alive || t === local || (local && t.team === local.team)) continue;
      const p = this.project(t.x, 20, t.y);
      const inside = !p.behind && p.x > 0 && p.x < this.cssW && p.y > 0 && p.y < this.cssH;
      if (inside) continue;
      let dx = p.x - cx;
      let dy = p.y - cy;
      if (p.behind) {
        dx = -dx;
        dy = -dy;
      }
      const a = Math.atan2(dy, dx);
      const margin = 30;
      const k = Math.min((cx - margin) / Math.abs(Math.cos(a) || 0.001), (cy - margin) / Math.abs(Math.sin(a) || 0.001));
      ctx.save();
      ctx.translate(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
      ctx.rotate(a);
      ctx.fillStyle = "rgba(239,75,75,0.92)";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, game: Game) {
    const world = game.world;
    const mw = clamp(this.cssW * 0.15, 110, 180);
    const mh = (mw * world.height) / world.width;
    const mx = this.cssW - mw - 12;
    const my = 62;
    const k = mw / world.width;
    ctx.fillStyle = "rgba(10,14,8,0.6)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(mx, my, mw, mh, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(200,200,190,0.45)";
    for (const o of world.obstacles) {
      if (o.destroyed || (o.kind !== "building" && o.kind !== "wall" && o.kind !== "rock")) continue;
      if (o.round) ctx.fillRect(mx + (o.x - o.r) * k, my + (o.y - o.r) * k, o.r * 2 * k, o.r * 2 * k);
      else ctx.fillRect(mx + (o.x - o.w / 2) * k, my + (o.y - o.h / 2) * k, Math.max(1.5, o.w * k), Math.max(1.5, o.h * k));
    }
    // Area yang terlihat kamera
    const corners = [
      [0, 0],
      [this.cssW, 0],
      [this.cssW, this.cssH],
      [0, this.cssH],
    ].map(([sx, sy]) => this.screenToGround(sx, sy));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(mx + c!.x * k, my + c!.y * k) : ctx.moveTo(mx + c!.x * k, my + c!.y * k)));
      ctx.closePath();
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.clip();
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(mx + c!.x * k, my + c!.y * k) : ctx.moveTo(mx + c!.x * k, my + c!.y * k)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    for (const p of game.pickups) {
      ctx.fillStyle = p.kind === "repair" ? "#3ddc84" : "#ffc233";
      ctx.fillRect(mx + p.x * k - 1.5, my + p.y * k - 1.5, 3, 3);
    }
    for (const t of game.tanks) {
      if (!t.alive) continue;
      ctx.fillStyle = t === game.local ? "#46d36b" : "#ef4b4b";
      ctx.beginPath();
      if (t === game.local) {
        // Panah arah hadap tank pemain
        const a = t.angle;
        const px = mx + t.x * k;
        const py = my + t.y * k;
        ctx.moveTo(px + Math.cos(a) * 6, py + Math.sin(a) * 6);
        ctx.lineTo(px + Math.cos(a + 2.5) * 4.5, py + Math.sin(a + 2.5) * 4.5);
        ctx.lineTo(px + Math.cos(a - 2.5) * 4.5, py + Math.sin(a - 2.5) * 4.5);
        ctx.closePath();
      } else ctx.arc(mx + t.x * k, my + t.y * k, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSticks(ctx: CanvasRenderingContext2D, game: Game) {
    const input = game.input;
    const r = input.radius;
    for (const stick of [input.left, input.right]) {
      if (!stick.active) continue;
      const dx = stick.x - stick.ox;
      const dy = stick.y - stick.oy;
      const d = Math.hypot(dx, dy);
      const k = d > r ? r / d : 1;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(stick.ox, stick.oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = stick === input.right && d > r * 0.35 ? "rgba(255,120,80,0.75)" : "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(stick.ox + dx * k, stick.oy + dy * k, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
