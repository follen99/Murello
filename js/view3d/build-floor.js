// Builds the static 3D geometry of one floor: walls (one merged mesh), room floors, openings, wall decor.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { dot, sub, add, mul } from '../core/geom.js';
import { getMat, floorMaterial, artMaterial, WALL_DEFAULT, WALL_EXTERIOR, WALL_CUT, shade } from './materials.js';

export const BASE_Y = -0.12; // walls go a little below the floor: the house reads as a solid object

const wallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
export function getWallMaterial() { return wallMaterial; }

/**
 * @returns {{mesh: THREE.Mesh, triWall: Int32Array, triSide: Int8Array}}
 */
export function buildWalls(floor, der, { cut = Infinity } = {}) {
  const pos = [], nor = [], col = [], triWall = [], triSide = [];
  const c = new THREE.Color();
  const pushTri = (a, b, cc, N, color, wi, side) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * N[0] + cr[1] * N[1] + cr[2] * N[2] < 0) { const t = b; b = cc; cc = t; }
    c.set(color);
    for (const v of [a, b, cc]) { pos.push(v[0], v[1], v[2]); nor.push(N[0], N[1], N[2]); col.push(c.r, c.g, c.b); }
    triWall.push(wi); triSide.push(side);
  };
  const quad = (p0, p1, p2, p3, N, color, wi, side) => { pushTri(p0, p1, p2, N, color, wi, side); pushTri(p0, p2, p3, N, color, wi, side); };
  const P3 = (p, y) => [p.x, y, p.y];

  der.walls.forEach((x, wi) => {
    const w = x.w; const h = Math.min(x.h, cut); const t = x.t;
    if (!x.sL || !x.eL || !x.sR || !x.eR) return;
    const uL0 = dot(sub(x.sL, x.A), x.dir), uL1 = dot(sub(x.eL, x.A), x.dir);
    const uR0 = dot(sub(x.sR, x.A), x.dir), uR1 = dot(sub(x.eR, x.A), x.dir);
    const lo = Math.max(uL0, uR0) + 0.005, hi = Math.min(uL1, uR1) - 0.005;
    const holes = (w.openings || []).map((o) => {
      const a = Math.max(lo, o.offset), b = Math.min(hi, o.offset + o.width);
      const y0 = Math.max(0, o.sill || 0); const y1 = Math.min(h - 0.02, y0 + o.height);
      return { a, b, y0, y1 };
    }).filter((o) => o.b - o.a > 0.02 && o.y1 > o.y0 + 0.02).sort((p, q) => p.a - q.a);
    const colL = w.colorL || x.roomL?.wallColor || (x.roomL ? WALL_DEFAULT : WALL_EXTERIOR);
    const colR = w.colorR || x.roomR?.wallColor || (x.roomR ? WALL_DEFAULT : WALL_EXTERIOR);
    const pt = (u, s, y) => { const p = add(add(x.A, mul(x.dir, u)), mul(x.n, s * t / 2)); return [p.x, y, p.y]; };
    for (const [s, u0, u1, color] of [[1, uL0, uL1, colL], [-1, uR0, uR1, colR]]) {
      const N = [x.n.x * s, 0, x.n.y * s];
      const br = [u0, u1, ...holes.flatMap((o) => [o.a, o.b])].filter((u) => u >= u0 - 1e-6 && u <= u1 + 1e-6).sort((a, b) => a - b);
      for (let k = 0; k < br.length - 1; k++) {
        const p = br[k], q = br[k + 1]; if (q - p < 1e-5) continue;
        const m = (p + q) / 2; const hole = holes.find((o) => m > o.a && m < o.b);
        const spans = hole ? [[BASE_Y, hole.y0], [hole.y1, h]] : [[BASE_Y, h]];
        for (const [ya, yb] of spans) if (yb - ya > 1e-4) quad(pt(p, s, ya), pt(q, s, ya), pt(q, s, yb), pt(p, s, yb), N, color, wi, s);
      }
    }
    // top (cut look)
    const top = [x.sL, x.eL, x.eR, x.sR].map((p) => P3(p, h));
    quad(top[0], top[1], top[2], top[3], [0, 1, 0], h < x.h - 1e-3 ? WALL_CUT : shade(WALL_CUT, 0.12), wi, 0);
    // free ends
    if (x.capS) quad(P3(x.sL, BASE_Y), P3(x.sR, BASE_Y), P3(x.sR, h), P3(x.sL, h), [-x.dir.x, 0, -x.dir.y], WALL_DEFAULT, wi, 0);
    if (x.capE) quad(P3(x.eL, BASE_Y), P3(x.eR, BASE_Y), P3(x.eR, h), P3(x.eL, h), [x.dir.x, 0, x.dir.y], WALL_DEFAULT, wi, 0);
    // reveals
    for (const o of holes) {
      const rv = '#ebe8e1';
      quad(pt(o.a, 1, o.y0), pt(o.a, -1, o.y0), pt(o.a, -1, o.y1), pt(o.a, 1, o.y1), [x.dir.x, 0, x.dir.y], rv, wi, 0);
      quad(pt(o.b, 1, o.y0), pt(o.b, -1, o.y0), pt(o.b, -1, o.y1), pt(o.b, 1, o.y1), [-x.dir.x, 0, -x.dir.y], rv, wi, 0);
      quad(pt(o.a, 1, o.y0), pt(o.b, 1, o.y0), pt(o.b, -1, o.y0), pt(o.a, -1, o.y0), [0, 1, 0], o.y0 > 0.01 ? '#e2ddd3' : '#8a8580', wi, 0);
      if (o.y1 < h - 1e-3) quad(pt(o.a, 1, o.y1), pt(o.b, 1, o.y1), pt(o.b, -1, o.y1), pt(o.a, -1, o.y1), [0, -1, 0], rv, wi, 0);
    }
  });
  for (const hb of der.hubs) {
    const h = Math.min(hb.h, cut);
    const P = hb.poly;
    for (let i = 1; i < P.length - 1; i++) pushTri(P3(P[0], h), P3(P[i], h), P3(P[i + 1], h), [0, 1, 0], h < hb.h - 1e-3 ? WALL_CUT : shade(WALL_CUT, 0.12), -1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, wallMaterial);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.kind = 'walls';
  return { mesh, triWall: Int32Array.from(triWall), triSide: Int8Array.from(triSide) };
}

/** Room floors (textured) + slab under the house. */
export function buildFloors(floor, der) {
  const group = new THREE.Group();
  for (const r of der.rooms) {
    const shape = new THREE.Shape(r.poly.map((p) => new THREE.Vector2(p.x, -p.y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.003, 0);
    const mesh = new THREE.Mesh(g, floorMaterial(r.floor || 'parquet'));
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'room', roomId: r.id };
    group.add(mesh);
    // slab edge (a thin darker extrusion under the floor)
    const ex = new THREE.ExtrudeGeometry(shape, { depth: -BASE_Y - 0.004, bevelEnabled: false });
    ex.rotateX(-Math.PI / 2); ex.translate(0, BASE_Y, 0);
    const slab = new THREE.Mesh(ex, getMat('main', '#cfcac1'));
    slab.receiveShadow = true;
    group.add(slab);
  }
  return group;
}

// ---------------- openings ----------------
const box = (w, h, d, r = 0) => (r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d));

function placeOnWall(obj, x, along, y) {
  const p = add(x.A, mul(x.dir, along));
  obj.position.set(p.x, y, p.y);
  obj.rotation.y = Math.atan2(-x.dir.y, x.dir.x);
}

export function buildOpenings(floor, der, { doorAngle = 20, cut = Infinity } = {}) {
  const group = new THREE.Group();
  for (const x of der.walls) {
    for (const o of x.w.openings || []) {
      const g = new THREE.Group();
      g.userData = { kind: 'opening', wallId: x.id, openingId: o.id };
      const w = o.width, t = x.t;
      const top = Math.min(x.h - 0.02, (o.sill || 0) + o.height);
      const hgt = top - (o.sill || 0);
      if (hgt <= 0.02) continue;
      const frameCol = o.frameColor || (o.type === 'window' ? '#f4f3ef' : '#efece6');
      if (o.type === 'window') {
        const fw = 0.055, fd = Math.min(0.08, t * 0.6);
        const fm = getMat('white', frameCol);
        const parts = [
          [w, fw, fd, 0, fw / 2], [w, fw, fd, 0, hgt - fw / 2],
          [fw, hgt, fd, -w / 2 + fw / 2, hgt / 2], [fw, hgt, fd, w / 2 - fw / 2, hgt / 2],
        ];
        const leaves = o.style === 'single' || w < 0.7 ? 1 : o.style === 'triple' ? 3 : 2;
        for (let k = 1; k < leaves; k++) parts.push([fw * 0.9, hgt - fw * 2, fd * 0.9, -w / 2 + (w * k) / leaves, hgt / 2]);
        for (const [pw, ph, pd, px, py] of parts) { const m = new THREE.Mesh(box(pw, ph, pd, 0.008), fm); m.position.set(px, py, 0); m.castShadow = true; g.add(m); }
        const glass = new THREE.Mesh(new THREE.BoxGeometry(w - fw * 2, hgt - fw * 2, 0.012), getMat('glass'));
        glass.position.set(0, hgt / 2, 0); g.add(glass);
        if ((o.sill || 0) > 0.05) {
          const sill = new THREE.Mesh(box(w + 0.08, 0.03, t + 0.06, 0.006), getMat('counter'));
          sill.position.set(0, -0.015, 0); sill.receiveShadow = true; g.add(sill);
        }
        placeOnWall(g, x, o.offset + w / 2, o.sill || 0);
      } else if (o.type === 'door') {
        const fm = getMat('white', frameCol);
        const cw = 0.06, cd = 0.012;
        for (const s of [1, -1]) {
          for (const [pw, ph, px, py] of [[cw, hgt, -w / 2 - cw / 2 + 0.01, hgt / 2], [cw, hgt, w / 2 + cw / 2 - 0.01, hgt / 2], [w + cw * 2 - 0.02, cw, 0, hgt + cw / 2 - 0.01]]) {
            const m = new THREE.Mesh(box(pw, ph, cd, 0.004), fm); m.position.set(px, py, s * (t / 2 + cd / 2)); g.add(m);
          }
        }
        if (o.style !== 'none' && o.style !== 'garage') {
          const leafMat = getMat('main', o.leafColor || '#d8c3a5');
          const leaves = o.style === 'double' ? 2 : 1;
          const lw = (w - 0.01) / leaves;
          for (let k = 0; k < leaves; k++) {
            const hingeStart = leaves === 2 ? k === 0 : o.hinge !== 'end';
            const side = o.side || 1;
            const pivot = new THREE.Group();
            const hx = hingeStart ? -w / 2 : w / 2;
            pivot.position.set(hx, 0, side * (t / 2 - 0.03));
            const leaf = new THREE.Mesh(box(lw, hgt - 0.01, 0.04, 0.008), leafMat);
            leaf.position.set(hingeStart ? lw / 2 : -lw / 2, (hgt - 0.01) / 2, 0);
            leaf.castShadow = true; leaf.receiveShadow = true;
            const handle = new THREE.Mesh(box(0.12, 0.018, 0.02, 0.006), getMat('metal'));
            handle.position.set((hingeStart ? 1 : -1) * (lw - 0.08), 1.0 - (hgt - 0.01) / 2, side * 0.035);
            leaf.add(handle);
            pivot.add(leaf);
            const ang = (o.style === 'sliding' ? 0 : doorAngle) * Math.PI / 180;
            if (o.style === 'sliding') pivot.position.x += (hingeStart ? 1 : -1) * lw * Math.min(1, doorAngle / 90) * 0.9;
            else pivot.rotation.y = (hingeStart ? -1 : 1) * side * ang;
            g.add(pivot);
          }
        }
        placeOnWall(g, x, o.offset + w / 2, 0);
      } else {
        placeOnWall(g, x, o.offset + w / 2, 0);
      }
      if (cut < x.h) g.traverse((m) => { if (m.isMesh && m.position.y > cut) m.visible = false; });
      group.add(g);
    }
  }
  return group;
}

// ---------------- wall decor ----------------
export const DECOR_TYPES = ['picture', 'mirror', 'shelf', 'tv', 'radiator', 'sconce', 'clock', 'panel'];
export const DECOR_DEFAULTS = {
  picture: { width: 0.7, height: 0.5, depth: 0.03, elevation: 1.35 },
  mirror: { width: 0.6, height: 0.9, depth: 0.02, elevation: 1.1 },
  shelf: { width: 1.0, height: 0.03, depth: 0.22, elevation: 1.5 },
  tv: { width: 1.25, height: 0.72, depth: 0.04, elevation: 1.0 },
  radiator: { width: 0.8, height: 0.6, depth: 0.1, elevation: 0.12 },
  sconce: { width: 0.18, height: 0.25, depth: 0.15, elevation: 1.8 },
  clock: { width: 0.4, height: 0.4, depth: 0.04, elevation: 1.9 },
  panel: { width: 1.0, height: 1.0, depth: 0.02, elevation: 0.0 },
};

export function buildDecor(floor, der, { cut = Infinity } = {}) {
  const group = new THREE.Group();
  for (const x of der.walls) {
    for (const d of x.w.decor || []) {
      if (d.elevation > cut) continue;
      const g = new THREE.Group(); g.userData = { kind: 'decor', wallId: x.id, decorId: d.id };
      const W = d.width, H = d.height, D = d.depth || DECOR_DEFAULTS[d.type]?.depth || 0.03;
      const color = d.color;
      const add3 = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
      switch (d.type) {
        case 'picture': {
          add3(box(W, H, D, 0.004), getMat('main', color || '#2e2b28'), 0, H / 2, D / 2);
          const art = add3(new THREE.PlaneGeometry(W - 0.08, H - 0.08), artMaterial(d.id), 0, H / 2, D + 0.001); art.castShadow = false;
          break;
        }
        case 'mirror':
          add3(box(W, H, D, 0.01), getMat('main', color || '#b7a888'), 0, H / 2, D / 2);
          add3(new THREE.PlaneGeometry(W - 0.05, H - 0.05), getMat('metal', '#dfe6ea'), 0, H / 2, D + 0.001);
          break;
        case 'shelf': {
          add3(box(W, 0.03, D, 0.005), getMat('main', color || '#b48a60'), 0, 0.015, D / 2);
          const n = Math.max(2, Math.round(W / 0.12));
          for (let k = 0; k < n * 0.6; k++) add3(box(0.03 + (k % 3) * 0.01, 0.18 + (k % 4) * 0.03, D * 0.75), getMat('accent', ['#c96f4a', '#3d5a80', '#e0b44a', '#6d8a6b'][k % 4]), -W / 2 + 0.06 + k * 0.045, 0.03 + (0.18 + (k % 4) * 0.03) / 2, D * 0.45);
          break;
        }
        case 'tv':
          add3(box(W, H, D, 0.01), getMat('black'), 0, H / 2, D / 2);
          add3(new THREE.PlaneGeometry(W - 0.03, H - 0.03), getMat('screen'), 0, H / 2, D + 0.001);
          break;
        case 'radiator': {
          const n = Math.max(2, Math.round(W / 0.08));
          for (let k = 0; k < n; k++) add3(box(W / n - 0.012, H, D, 0.01), getMat('main', color || '#f4f4f2'), -W / 2 + (W / n) * (k + 0.5), H / 2, D / 2);
          break;
        }
        case 'sconce':
          add3(box(0.08, 0.12, 0.04, 0.01), getMat('metal'), 0, H / 2, 0.02);
          add3(new THREE.CylinderGeometry(W * 0.35, W / 2, H * 0.6, 20, 1, true), getMat('main', color || '#f3eee4'), 0, H * 0.6, D * 0.6);
          break;
        case 'clock':
          add3(new THREE.CylinderGeometry(W / 2, W / 2, D, 36).rotateX(Math.PI / 2), getMat('main', color || '#f7f5f0'), 0, H / 2, D / 2);
          add3(box(0.012, W * 0.32, 0.005), getMat('black'), 0, H / 2 + W * 0.12, D + 0.004);
          add3(box(W * 0.22, 0.012, 0.005), getMat('black'), W * 0.08, H / 2, D + 0.006);
          break;
        default: // panel / custom
          add3(box(W, H, D, 0.004), getMat('main', color || '#c9b79c'), 0, H / 2, D / 2);
      }
      // place: side +1 = left face (normal n), -1 = right face
      const s = d.side || 1;
      const p = add(add(x.A, mul(x.dir, d.offset + W / 2)), mul(x.n, s * x.t / 2));
      g.position.set(p.x, d.elevation, p.y);
      // local +z must point along the face normal (n*s); local +x along the wall direction as seen from that side
      const nx = x.n.x * s, nz = x.n.y * s;
      g.rotation.y = Math.atan2(nx, nz);
      group.add(g);
    }
  }
  return group;
}
