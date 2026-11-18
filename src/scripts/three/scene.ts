import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createObject, type Finish, type ObjectKind } from './objects';

const BLUE = 0x1c45f5, LIME = 0xd3ff52;
const BASE: Record<ObjectKind, { rx: number; ry: number; rz: number; spin: number }> = {
  play: { rx: 0.12, ry: -0.5, rz: 0.06, spin: 0 },
  pause: { rx: 0.18, ry: 0.55, rz: -0.14, spin: 0 },
  camera: { rx: 0.24, ry: -0.62, rz: 0.04, spin: 0 },
  reel: { rx: 0.55, ry: 0.35, rz: 0, spin: 0.6 },
};

interface Item {
  canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  obj: THREE.Group; base: (typeof BASE)[ObjectKind]; phase: number; visible: boolean; w: number; h: number;
}

/** Mounts one renderer per canvas. Returns a cleanup function. Sets data-ready after the first frame. */
export function mountScene(canvases: HTMLCanvasElement[], opts: { animate: boolean }): () => void {
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const items: Item[] = [];
  const observers: Array<ResizeObserver | IntersectionObserver> = [];
  let raf = 0;

  const draw = (it: Item, t: number) => {
    const b = it.base, p = it.phase;
    it.obj.position.y = Math.sin(t * 0.9 + p) * 0.12;
    it.obj.position.x = Math.cos(t * 0.6 + p) * 0.05;
    it.obj.rotation.x = b.rx + Math.sin(t * 0.5 + p) * 0.12 + pointer.y * 0.18;
    it.obj.rotation.y = b.ry + Math.sin(t * 0.4 + p) * 0.18 + pointer.x * 0.25;
    it.obj.rotation.z = b.rz + t * b.spin + Math.sin(t * 0.35 + p) * 0.05;
    it.renderer.render(it.scene, it.camera);
    if (it.canvas.dataset.ready !== 'true') it.canvas.dataset.ready = 'true';
  };

  canvases.forEach((canvas, i) => {
    canvas.dataset.animating = String(opts.animate);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, 6.2);
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2.5, 3.5, 4); scene.add(key);
    const pb = new THREE.PointLight(BLUE, 40); pb.position.set(-3, -1.5, 2.5); scene.add(pb);
    const pl = new THREE.PointLight(LIME, 30); pl.position.set(3, -2.2, 1.6); scene.add(pl);
    const kind = (canvas.dataset.kind ?? 'play') as ObjectKind;
    const obj = createObject(kind, (canvas.dataset.finish ?? 'blue') as Finish);
    obj.scale.setScalar(parseFloat(canvas.dataset.scale ?? '1'));
    scene.add(obj);
    const it: Item = { canvas, renderer, scene, camera, obj, base: BASE[kind], phase: i * 1.37, visible: true, w: 0, h: 0 };
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      it.w = w; it.h = h;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      draw(it, 0);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver((es) => { it.visible = es[0].isIntersecting; }, { rootMargin: '120px' });
    io.observe(canvas);
    observers.push(ro, io);
    items.push(it);
  });

  if (opts.animate) {
    window.addEventListener('pointermove', onMove, { passive: true });
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      if (!document.hidden) for (const it of items) if (it.visible && it.w && it.h) draw(it, t);
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    observers.forEach((o) => o.disconnect());
    items.forEach((it) => it.renderer.dispose());
  };
}
