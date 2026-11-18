import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ObjectKind = 'play' | 'pause' | 'camera' | 'reel';
export type Finish = 'blue' | 'lime' | 'chrome' | 'navy';

const BLUE = 0x1c45f5, LIME = 0xd3ff52, CREAM = 0xfff9eb, NAVY = 0x0e1233;
const MAT = {
  blue: () => new THREE.MeshPhysicalMaterial({ color: BLUE, metalness: 0.1, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03 }),
  lime: () => new THREE.MeshPhysicalMaterial({ color: LIME, metalness: 0.05, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 }),
  cream: () => new THREE.MeshPhysicalMaterial({ color: CREAM, metalness: 0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 }),
  navy: () => new THREE.MeshPhysicalMaterial({ color: NAVY, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }),
  chrome: () => new THREE.MeshPhysicalMaterial({ color: 0xf4f6fb, metalness: 1, roughness: 0.06 }),
  lens: () => new THREE.MeshPhysicalMaterial({ color: 0x0a0f2e, metalness: 0.2, roughness: 0.04, clearcoat: 1 }),
};

function disc(r: number, t: number, mat: THREE.Material): THREE.Mesh {
  const pts = [new THREE.Vector2(0, -t / 2)];
  const rr = t / 2, cx = r - rr;
  for (let i = 0; i <= 18; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 18;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * rr, Math.sin(a) * rr));
  }
  pts.push(new THREE.Vector2(0, t / 2));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 112), mat);
  m.rotation.x = Math.PI / 2;
  return m;
}

function playButton(finish: Finish): THREE.Group {
  const g = new THREE.Group();
  const chrome = finish === 'chrome';
  g.add(disc(1, 0.32, chrome ? MAT.chrome() : MAT.blue()));
  const s = new THREE.Shape();
  s.moveTo(-0.27, 0.38); s.lineTo(-0.27, -0.38); s.lineTo(0.43, 0); s.lineTo(-0.27, 0.38);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 6, curveSegments: 8 });
  geo.translate(-0.03, 0, 0);
  const glyph = new THREE.Mesh(geo, chrome ? MAT.lime() : MAT.cream());
  glyph.position.z = 0.14;
  g.add(glyph);
  return g;
}

function pauseButton(finish: Finish): THREE.Group {
  const g = new THREE.Group();
  const mat = finish === 'blue' ? MAT.blue() : MAT.lime();
  const geo = new THREE.CapsuleGeometry(0.21, 0.78, 16, 48);
  for (const x of [-0.31, 0.31]) { const m = new THREE.Mesh(geo, mat); m.position.x = x; g.add(m); }
  return g;
}

function camera(): THREE.Group {
  const g = new THREE.Group();
  const chrome = MAT.chrome();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(1.7, 1.08, 0.78, 6, 0.17), MAT.navy()));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.47, 0.5, 72), chrome);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0.12, -0.03, 0.62); g.add(barrel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.055, 24, 72), MAT.blue());
  ring.position.set(0.12, -0.03, 0.87); g.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.37, 72), MAT.lens());
  glass.position.set(0.12, -0.03, 0.872); g.add(glass);
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.28, 0.52, 4, 0.08), chrome);
  top.position.set(-0.46, 0.64, 0); g.add(top);
  const rec = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24), MAT.lime());
  rec.position.set(0.58, 0.58, 0.18); g.add(rec);
  return g;
}

function reel(): THREE.Group {
  const s = new THREE.Shape();
  s.absarc(0, 0, 1, 0, Math.PI * 2, false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0.22, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const c = new THREE.Path(); c.absarc(0, 0, 0.11, 0, Math.PI * 2, true); s.holes.push(c);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4, curveSegments: 56 });
  geo.center();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, MAT.chrome()));
  return g;
}

export function createObject(kind: ObjectKind, finish: Finish): THREE.Group {
  if (kind === 'play') return playButton(finish);
  if (kind === 'pause') return pauseButton(finish);
  if (kind === 'camera') return camera();
  return reel();
}
