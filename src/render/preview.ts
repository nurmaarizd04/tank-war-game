import * as THREE from "three";
import { tankById, type TankModel } from "../data/tanks";
import { buildTank, disposeTankRig, type TankRig } from "./models";

/** Pratinjau tank 3D yang berputar di garasi */
export class TankPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 5, 2000);
  private rig: TankRig | null = null;
  private modelId = "";
  private frame = 0;
  private last = 0;
  private spin = -0.6;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.enabled = true;
    this.scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x3a3020, 1.3));
    const key = new THREE.DirectionalLight(0xfff0d0, 2.8);
    key.position.set(-120, 220, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90 });
    const rim = new THREE.DirectionalLight(0xffb45a, 1.4);
    rim.position.set(160, 80, -160);
    this.scene.add(key, rim);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(58, 61, 4, 48), new THREE.MeshStandardMaterial({ color: 0x2b3122, roughness: 0.8, metalness: 0.2 }));
    stage.position.y = -2;
    stage.receiveShadow = true;
    this.scene.add(stage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(59, 0.8, 8, 64), new THREE.MeshBasicMaterial({ color: 0xf5a524 }));
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
  }

  show(model: TankModel) {
    if (model.id === this.modelId) return;
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeTankRig(this.rig, tankById(this.modelId));
    }
    this.modelId = model.id;
    this.rig = buildTank(model);
    this.rig.root.traverse((o) => (o.castShadow = true));
    this.scene.add(this.rig.root);
    const size = model.look.length + model.look.barrel;
    this.camera.position.set(0, size * 0.62, size * 1.12);
    this.camera.lookAt(0, 12, 0);
  }

  start() {
    cancelAnimationFrame(this.frame);
    this.last = performance.now();
    const loop = (time: number) => {
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (time - this.last) / 1000);
      this.last = time;
      this.resize();
      this.spin += dt * 0.45;
      if (this.rig) {
        this.rig.root.rotation.y = this.spin;
        this.rig.turret.rotation.y = Math.sin(time / 1300) * 0.5;
      }
      this.gl.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.frame);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.gl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}
