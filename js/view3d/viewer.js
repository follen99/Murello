// 3D view: renders on demand (no continuous loop), orbit/pan/zoom, picking, dragging furniture,
// clicking walls to edit them, measuring, auto-dimension overlays.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { store } from '../core/state.js';
import { derive } from '../model/derive.js';
import { buildWalls, buildFloors, buildOpenings, buildDecor, BASE_Y } from './build-floor.js';
import { buildItemMesh, disposeGroup } from '../furniture/build.js';
import { setEnvMap } from './materials.js';
import { footprint, snapItem, clearances } from '../tools/analysis.js';
import { dot, sub } from '../core/geom.js';
import { fmtLen, clamp } from '../core/util.js';

export class Viewer3D {
  constructor(container, app) {
    this.app = app;
    this.el = container;
    this.flags = app.flags;
    const canvas = document.createElement('canvas');
    canvas.className = 'view-canvas';
    container.appendChild(canvas);
    this.overlay = document.createElement('div');
    this.overlay.className = 'view-overlay';
    container.appendChild(this.overlay);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.flags.maxPixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.45;
    setEnvMap(env);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
    this.camera.position.set(8, 12, 14);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 120;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xbfb5a6, 0.55);
    scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1e0, 2.7);
    sun.castShadow = true;
    const sm = this.flags.shadowMap;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
    scene.add(sun); scene.add(sun.target);

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = BASE_Y - 0.001; this.ground.receiveShadow = true;
    scene.add(this.ground);

    this.root = new THREE.Group(); scene.add(this.root);
    this.floors = new Map(); // floorId → {group, staticSig, walls, triWall, items: Map}
    this.helpers = new THREE.Group(); scene.add(this.helpers);
    this.raycaster = new THREE.Raycaster();
    this.ptr = new THREE.Vector2();
    this.needsRender = true;
    this.cut = Infinity;
    this.showAllFloors = false;
    this.measurePts = [];
    this._firstFit = true;

    this.setTheme(app.theme);
    this._bindPointer(canvas);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.visible) return;
      const moving = this.controls.update();
      if (this.needsRender || moving) { this.needsRender = false; this.render(); }
    };
    loop();
  }

  get visible() { return this.el.offsetParent !== null && this.el.clientWidth > 0; }
  requestRender() { this.needsRender = true; }
  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (!this.userMoved && store.floor.nodes.length && !this._firstFit) this.fit(this._lastFit || 'iso', false);
    this.requestRender();
  }
  setTheme(theme) {
    const dark = theme === 'dark';
    const bg = new THREE.Color(dark ? '#23272b' : '#e9ece8');
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 40, 90);
    this.ground.material.color.set(dark ? '#2b3034' : '#e3e7e1');
    this.hemi.intensity = dark ? 0.5 : 0.55;
    this.requestRender();
  }
  setQuality(flags) {
    this.flags = flags;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, flags.maxPixelRatio));
    this.sun.shadow.mapSize.set(flags.shadowMap, flags.shadowMap);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.resize();
  }

  // ---------------------------------------------------------------- sync with project
  sync() {
    const p = store.project;
    const active = store.floor;
    const seen = new Set();
    for (const floor of p.floors) {
      seen.add(floor.id);
      let F = this.floors.get(floor.id);
      if (!F) { F = { group: new THREE.Group(), items: new Map(), staticSig: '' }; this.floors.set(floor.id, F); this.root.add(F.group); }
      const visible = this.showAllFloors ? floor.elevation <= active.elevation + 1e-6 : floor.id === active.id;
      F.group.visible = visible;
      F.group.position.y = floor.elevation || 0;
      if (!visible) continue;
      const der = derive(floor);
      const cut = floor.id === active.id ? this.cut : Infinity;
      const sig = JSON.stringify([floor.nodes, floor.walls, floor.rooms, floor.height, cut, this.app.settings.doorAngle]);
      if (sig !== F.staticSig) {
        F.staticSig = sig;
        if (F.static) { disposeGroup(F.static); F.group.remove(F.static); }
        const st = new THREE.Group();
        const walls = buildWalls(floor, der, { cut });
        F.walls = walls.mesh; F.triWall = walls.triWall; F.triSide = walls.triSide; F.der = der;
        walls.mesh.userData.floorId = floor.id;
        st.add(walls.mesh, buildFloors(floor, der), buildOpenings(floor, der, { doorAngle: this.app.settings.doorAngle, cut }), buildDecor(floor, der, { cut }));
        st.traverse((o) => { o.userData.floorId = floor.id; });
        F.static = st; F.group.add(st);
      }
      F.der = der;
      // items: rebuild only those that changed
      const keep = new Set();
      for (const it of floor.items) {
        keep.add(it.id);
        const isig = JSON.stringify([it.model, it.w, it.d, it.h, it.color, it.accent, it.params, floor.height, this.flags.quality]);
        let rec = F.items.get(it.id);
        if (!rec || rec.sig !== isig) {
          if (rec) { disposeGroup(rec.mesh); F.group.remove(rec.mesh); }
          const mesh = buildItemMesh(it, floor.height, this.flags.quality);
          mesh.traverse((o) => { o.userData.itemId = it.id; o.userData.floorId = floor.id; });
          rec = { sig: isig, mesh }; F.items.set(it.id, rec); F.group.add(mesh);
        }
        rec.mesh.position.set(it.x, it.elevation || 0, it.y);
        rec.mesh.rotation.y = -(it.rot || 0) * Math.PI / 180;
      }
      for (const [id, rec] of F.items) if (!keep.has(id)) { disposeGroup(rec.mesh); F.group.remove(rec.mesh); F.items.delete(id); }
    }
    for (const [id, F] of this.floors) if (!seen.has(id)) { disposeGroup(F.group); this.root.remove(F.group); this.floors.delete(id); }
    this._fitLights();
    this.updateHelpers();
    if (this._firstFit && active.nodes.length) { this._firstFit = false; this.fit('iso', false); }
    this.requestRender();
  }

  _bbox() {
    const f = store.floor; const der = derive(f);
    const b = der.bbox; const pad = 1;
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad, w: b.w + 2 * pad, h: b.h + 2 * pad, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, elev: f.elevation || 0, height: f.height || 2.7 };
  }
  _fitLights() {
    const b = this._bbox();
    const R = Math.max(b.w, b.h) * 0.75 + 2;
    const s = this.sun;
    s.position.set(b.cx - R * 0.55, b.elev + R * 1.9, b.cy + R * 0.75);
    s.target.position.set(b.cx, b.elev, b.cy);
    const cam = s.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = R * 4;
    cam.updateProjectionMatrix();
    this.ground.scale.setScalar(Math.max(60, R * 8));
    this.ground.position.set(b.cx, BASE_Y - 0.001 + (this.showAllFloors ? 0 : b.elev), b.cy);
  }
  /** Camera presets: 'iso' | 'top' | 'front' | 'fit' */
  fit(mode = 'iso', animate = true) {
    this._lastFit = mode; this.userMoved = false;
    const b = this._bbox();
    const size = Math.max(b.w, b.h, 4);
    const target = new THREE.Vector3(b.cx, b.elev + 0.6, b.cy);
    const R = 0.5 * Math.hypot(b.w, b.h, b.height);
    const vfov = (this.camera.fov * Math.PI) / 180; const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const d = (R / Math.sin(Math.min(vfov, hfov) / 2)) * 1.0;
    let pos;
    if (mode === 'top') pos = new THREE.Vector3(b.cx, b.elev + d, b.cy + 0.01);
    else if (mode === 'front') pos = new THREE.Vector3(b.cx, b.elev + 1.6 + size * 0.15, b.cy + d * 0.95);
    else pos = new THREE.Vector3(b.cx + d * 0.42, b.elev + d * 0.72, b.cy + d * 0.56);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); this.requestRender(); return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone(); const t1 = performance.now();
    const step = () => {
      const k = clamp((performance.now() - t1) / 450, 0, 1); const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(p0, pos, e); this.controls.target.lerpVectors(t0, target, e); this.controls.update(); this.requestRender();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }
  setCut(v) { this.cut = v >= 3.9 ? Infinity : v; const r = document.getElementById('cutRange'); if (r && +r.value !== v) r.value = v; this.sync(); }

  render() {
    this._updateOverlayPositions();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- helpers (selection, collisions, quotes, measure)
  updateHelpers() {
    const H = this.helpers;
    while (H.children.length) { const c = H.children.pop(); c.geometry?.dispose(); }
    this.overlay.querySelectorAll('.lbl3d').forEach((e) => e.remove());
    this._labels = [];
    const f = store.floor; const F = this.floors.get(f.id); if (!F) return;
    const elev = f.elevation || 0;
    const sel = store.selection;
    const coll = this.app.collisions || new Map();
    const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const outline = (fp, color) => {
      const pts = [];
      for (const z of [fp.z0 + 0.002, fp.z1]) for (let i = 0; i < 4; i++) { const a = fp.corners[i], b = fp.corners[(i + 1) % 4]; pts.push(a.x, elev + z, a.y, b.x, elev + z, b.y); }
      for (const a of fp.corners) pts.push(a.x, elev + fp.z0, a.y, a.x, elev + fp.z1, a.y);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, lineMat(color)); l.renderOrder = 10; H.add(l);
    };
    for (const it of f.items) {
      const c = coll.get(it.id);
      const isSel = sel?.type === 'item' && sel.id === it.id;
      if (isSel || c) outline(footprint(it, f.height), isSel ? (c?.level === 'error' ? '#d64545' : '#f2b233') : c.level === 'error' ? '#d64545' : '#e08a2e');
    }
    if (sel?.type === 'item' && this.app.settings.autoQuotes) {
      const it = f.items.find((i) => i.id === sel.id);
      if (it) this._drawQuotes(f, F.der, it, elev);
    }
    if ((sel?.type === 'wall' || sel?.type === 'opening' || sel?.type === 'decor') && F.der) {
      const x = F.der.byId.get(sel.type === 'wall' ? sel.id : sel.wallId);
      if (x?.sL) {
        const shape = new THREE.Shape([x.sR, x.eR, x.eL, x.sL].map((p) => new THREE.Vector2(p.x, -p.y)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: Math.min(x.h, this.cut) + 0.02, bevelEnabled: false });
        g.rotateX(-Math.PI / 2); g.translate(0, elev + BASE_Y, 0);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#f2b233', transparent: true, opacity: 0.22, depthWrite: false }));
        m.scale.set(1, 1, 1); H.add(m);
        if (sel.type === 'wall' && sel.side) {
          const s = sel.side; const mid = { x: (x.A.x + x.B.x) / 2 + x.n.x * s * (x.t / 2 + 0.3), y: (x.A.y + x.B.y) / 2 + x.n.y * s * (x.t / 2 + 0.3) };
          this._label3d(new THREE.Vector3(mid.x, elev + 0.2, mid.y), this.app.t('wall.thisSide'), 'side');
        }
      }
    }
    // measure tool
    if (this.measurePts.length) {
      const pts = this.measurePts;
      for (const p of pts) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: '#2f6fde', depthTest: false })); s.position.copy(p); s.renderOrder = 11; H.add(s); }
      if (pts.length === 2) {
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const l = new THREE.Line(g, lineMat('#2f6fde')); l.renderOrder = 11; H.add(l);
        const m = pts[0].clone().add(pts[1]).multiplyScalar(0.5);
        this._label3d(m, fmtLen(pts[0].distanceTo(pts[1]), this.app.settings.units, this.app.lang), 'measure');
      }
    }
    this.requestRender();
  }
  _drawQuotes(f, der, it, elev) {
    const qs = clearances(f, der, it);
    const min = this.app.settings.minPassage, comfy = this.app.settings.comfortPassage;
    for (const q of qs) {
      if (q.d < 0.01) continue;
      const col = q.d < min ? '#d64545' : q.d < comfy ? '#e0a42e' : '#2f6fde';
      const y = elev + 0.03;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(q.from.x, y, q.from.y), new THREE.Vector3(q.to.x, y, q.to.y)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true })); l.renderOrder = 12; this.helpers.add(l);
      const m = new THREE.Vector3((q.from.x + q.to.x) / 2, y + 0.05, (q.from.y + q.to.y) / 2);
      this._label3d(m, fmtLen(q.d, this.app.settings.units, this.app.lang), q.d < min ? 'bad' : q.d < comfy ? 'warn' : 'ok');
    }
  }
  _label3d(pos, text, cls) {
    const el = document.createElement('div'); el.className = `lbl3d ${cls}`; el.textContent = text;
    this.overlay.appendChild(el); this._labels.push({ el, pos });
  }
  _updateOverlayPositions() {
    if (!this._labels?.length) return;
    const w = this.el.clientWidth, h = this.el.clientHeight; const v = new THREE.Vector3();
    for (const L of this._labels) {
      v.copy(L.pos).project(this.camera);
      const vis = v.z < 1 && v.z > -1;
      L.el.style.display = vis ? '' : 'none';
      L.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  // ---------------------------------------------------------------- picking & interaction
  _setPtr(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ptr, this.camera);
  }
  pick(e) {
    this._setPtr(e);
    const f = store.floor; const F = this.floors.get(f.id); if (!F) return null;
    const hits = this.raycaster.intersectObjects(F.group.children, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const ud = h.object.userData;
      if (ud.itemId) return { type: 'item', id: ud.itemId, point: h.point };
      let o = h.object; while (o && !o.userData.kind) o = o.parent;
      const kind = o?.userData.kind;
      if (kind === 'opening') return { type: 'opening', wallId: o.userData.wallId, id: o.userData.openingId, point: h.point };
      if (kind === 'decor') return { type: 'decor', wallId: o.userData.wallId, id: o.userData.decorId, point: h.point };
      if (kind === 'walls') {
        const wi = F.triWall[h.faceIndex]; if (wi < 0) continue;
        const x = F.der.walls[wi]; if (!x) continue;
        const side = F.triSide[h.faceIndex];
        const p = { x: h.point.x, y: h.point.z };
        return { type: 'wall', id: x.id, side: side || (dot(sub(p, x.A), x.n) >= 0 ? 1 : -1), offset: clamp(dot(sub(p, x.A), x.dir), 0, x.len), height: h.point.y - (f.elevation || 0), point: h.point };
      }
      if (kind === 'room') return { type: 'room', id: o.userData.roomId, point: h.point };
    }
    return null;
  }
  _floorPoint(e, y) {
    this._setPtr(e);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }
  _bindPointer(canvas) {
    let down = null; let drag = null;
    const pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size > 1) { if (drag) this._twistStart(pointers, drag); return; }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.app.tool === 'measure') return;
      const hit = this.pick(e);
      if (hit?.type === 'item') {
        const f = store.floor; const it = f.items.find((i) => i.id === hit.id);
        if (it && !it.locked) {
          const p = this._floorPoint(e, (f.elevation || 0) + (it.elevation || 0));
          if (p) { drag = { id: it.id, dx: it.x - p.x, dy: it.y - p.z, y: (f.elevation || 0) + (it.elevation || 0), moved: false, rot0: it.rot || 0 }; this.controls.enabled = false; canvas.setPointerCapture(e.pointerId); }
        }
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (drag && pointers.size >= 2 && drag.twist) { this._twistMove(pointers, drag); return; }
      if (drag) {
        const p = this._floorPoint(e, drag.y); if (!p) return;
        if (!drag.moved) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return; drag.moved = true; store.beginGesture(); store.select({ type: 'item', id: drag.id, floorId: store.floor.id }); }
        const f = store.floor; const it = f.items.find((i) => i.id === drag.id); if (!it) return;
        const s = this.app.settings.snap ? snapItem(f, derive(f), it, p.x + drag.dx, p.z + drag.dy, it.rot || 0, { grid: e.altKey ? 0 : this.app.settings.grid }) : { x: p.x + drag.dx, y: p.z + drag.dy, rot: it.rot };
        store.commit('move', () => { it.x = +s.x.toFixed(4); it.y = +s.y.toFixed(4); it.rot = s.rot; }, { items: [it.id] });
        return;
      }
      if (this.flags.hover && e.pointerType === 'mouse' && !e.buttons) this._hover(e);
      if (this.app.tool === 'measure' && this.measurePts.length === 1) {
        const hit = this.pick(e); if (hit?.point) { this._measurePreview = hit.point; }
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (drag) {
        if (drag.moved) store.endGesture('move', { items: [drag.id] });
        else if (!drag.twist) store.select({ type: 'item', id: drag.id, floorId: store.floor.id });
        drag = null; this.controls.enabled = true;
        down = null; return;
      }
      if (!down || e.type === 'pointercancel') { down = null; return; }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 5 && performance.now() - down.t < 600) this._click(e);
      down = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => {
      if (!this.flags.contextMenu) return;
      const hit = this.pick(e); if (!hit) return;
      e.preventDefault();
      this._select(hit);
      this.app.contextMenu(e.clientX, e.clientY, hit);
    });
  }
  _twistStart(pointers, drag) {
    if (!this.flags.twoFingerRotate) return;
    const [a, b] = [...pointers.values()];
    drag.twist = { a0: Math.atan2(b.y - a.y, b.x - a.x), rot0: store.floor.items.find((i) => i.id === drag.id)?.rot || 0 };
    if (!drag.moved) { drag.moved = true; store.beginGesture(); }
  }
  _twistMove(pointers, drag) {
    const [a, b] = [...pointers.values()];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    let rot = drag.twist.rot0 - (ang - drag.twist.a0) * 180 / Math.PI;
    const snapped = Math.round(rot / 15) * 15;
    if (Math.abs(snapped - rot) < 4) { if (Math.round(drag.lastSnap) !== snapped && navigator.vibrate && this.flags.haptics) navigator.vibrate(8); drag.lastSnap = snapped; rot = snapped; }
    const it = store.floor.items.find((i) => i.id === drag.id);
    if (it) store.commit('rotate', () => { it.rot = ((rot % 360) + 360) % 360; }, { items: [it.id] });
  }
  _hover(e) {
    const hit = this.pick(e);
    const c = this.renderer.domElement;
    c.style.cursor = hit?.type === 'item' ? 'grab' : hit?.type === 'wall' || hit?.type === 'opening' || hit?.type === 'decor' ? 'pointer' : '';
  }
  _click(e) {
    if (this.app.tool === 'measure') {
      const hit = this.pick(e);
      const p = hit?.point || this._floorPoint(e, store.floor.elevation || 0);
      if (!p) return;
      if (this.measurePts.length >= 2) this.measurePts = [];
      this.measurePts.push(p.clone());
      this.updateHelpers();
      return;
    }
    const hit = this.pick(e);
    this._select(hit);
  }
  _select(hit) {
    const fid = store.floor.id;
    if (!hit) { store.select(null); return; }
    if (hit.type === 'item') store.select({ type: 'item', id: hit.id, floorId: fid });
    else if (hit.type === 'wall') store.select({ type: 'wall', id: hit.id, floorId: fid, side: hit.side, offset: +hit.offset.toFixed(3), height: +hit.height.toFixed(3) });
    else if (hit.type === 'opening') store.select({ type: 'opening', id: hit.id, wallId: hit.wallId, floorId: fid });
    else if (hit.type === 'decor') store.select({ type: 'decor', id: hit.id, wallId: hit.wallId, floorId: fid });
    else if (hit.type === 'room') store.select({ type: 'room', id: hit.id, floorId: fid });
  }
  clearMeasure() { this.measurePts = []; this.updateHelpers(); }

  /** Render a still image (used by "save picture"). */
  snapshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
}
