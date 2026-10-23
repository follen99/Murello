// 2D plan view on a <canvas>: pan/zoom (mouse, wheel, pinch), selection, dragging/rotating furniture,
// structure editing (move nodes, draw walls), measuring, auto-dimensions, walkability overlay.
import { store } from '../core/state.js';
import { derive } from '../model/derive.js';
import { getModel, resolveParts, itemDims, modelName } from '../furniture/models.js';
import { footprint, snapItem, clearances, doorSwings, walkGrid } from '../tools/analysis.js';
import { obbCorners, dist, sub, add, mul, norm, dot, distPointSeg, pointInPoly, projT, perp } from '../core/geom.js';
import { fmtLen, fmtArea, uid, clamp } from '../core/util.js';

const ROOM_TINTS = ['#e6eee3', '#efe8dc', '#e3e9f0', '#f0e4e1', '#e9e4ef', '#eeecdc', '#e0ecea', '#f1e9e1'];
const ROOM_TINTS_DARK = ['#2f3a33', '#3a352d', '#2e3540', '#3d3231', '#363140', '#3a3a2e', '#2d3b39', '#3b342f'];
const MAT_COL = { wood: '#c79a6b', dark: '#3d3a37', white: '#f5f4f0', metal: '#b9bcc0', black: '#2a2b2e', glass: '#cfe3ee', ceramic: '#fbfbfa', mattress: '#f3efe7', leaf: '#6f9a69', pot: '#b86f4c', counter: '#d2cdc5', screen: '#1d1f22' };

export class Plan2D {
  constructor(container, app) {
    this.app = app; this.el = container;
    this.cv = document.createElement('canvas'); this.cv.className = 'view-canvas';
    container.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    this.scale = 50; this.ox = 0; this.oy = 0; // screen = world*scale + o
    this.measure = []; this.hoverPt = null;
    this.drawWall = null; // {start:{x,y,nodeId?}}
    this.walkOverlay = false;
    this._fitted = false;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }
  get visible() { return this.el.offsetParent !== null && this.el.clientWidth > 0; }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    if (this.W && this._fitted) { this.ox += (w - this.W) / 2; this.oy += (h - this.H) / 2; }
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = `${w}px`; this.cv.style.height = `${h}px`;
    this.dpr = dpr; this.W = w; this.H = h;
    if (!this._fitted && store.floor.nodes.length) this.fit();
    this.draw();
  }
  toScreen(p) { return { x: p.x * this.scale + this.ox, y: p.y * this.scale + this.oy }; }
  toWorld(s) { return { x: (s.x - this.ox) / this.scale, y: (s.y - this.oy) / this.scale }; }
  fit() {
    if (!this.visible || this.W < 50) { this._fitted = false; return; }
    const f = store.floor; const der = derive(f);
    const b = der.bbox; if (!isFinite(b.minX)) return;
    const pad = 40;
    const s = Math.min((this.W - pad * 2) / Math.max(b.w, 1), (this.H - pad * 2) / Math.max(b.h, 1));
    this.scale = clamp(s, 5, 400);
    this.ox = this.W / 2 - ((b.minX + b.maxX) / 2) * this.scale;
    this.oy = this.H / 2 - ((b.minY + b.maxY) / 2) * this.scale;
    this._fitted = true;
    this.draw();
  }
  /** Make sure a world point is visible above a bottom sheet of height `cover` px. */
  ensureVisible(p, cover = 0) {
    const s = this.toScreen(p); const visH = this.H - cover;
    if (s.x > 30 && s.x < this.W - 30 && s.y > 30 && s.y < visH - 30) return;
    this.ox = this.W / 2 - p.x * this.scale; this.oy = visH / 2 - p.y * this.scale; this.draw();
  }
  zoomAt(sx, sy, k) {
    const ns = clamp(this.scale * k, 4, 600); k = ns / this.scale;
    this.ox = sx - (sx - this.ox) * k; this.oy = sy - (sy - this.oy) * k; this.scale = ns;
    this.draw();
  }
  setTheme() { this.colors = null; this.draw(); }
  _colors() {
    if (this.colors) return this.colors;
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    const dark = this.app.theme === 'dark';
    this.colors = {
      dark, bg: v('--plan-bg', '#f4f5f2'), grid: v('--plan-grid', 'rgba(40,50,60,0.06)'), grid2: v('--plan-grid-major', 'rgba(40,50,60,0.12)'),
      wall: v('--plan-wall', '#30353b'), text: v('--text', '#23292f'), muted: v('--text-muted', '#6a737c'),
      accent: v('--accent', '#e9a92b'), dim: v('--dim', '#2f6fde'), bad: '#d64545', warn: '#e0a42e', ok: '#3c9a5f', floor: dark ? '#2a2f33' : '#ffffff',
    };
    return this.colors;
  }

  // ------------------------------------------------------------------ drawing
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }
  _draw() {
    if (!this.visible) return;
    const g = this.g, C = this._colors(), s = this.scale;
    const f = store.floor; const der = derive(f);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, this.W, this.H);
    this._grid(g, C);
    g.save(); g.translate(this.ox, this.oy); g.scale(s, s);
    const px = 1 / s; // one screen pixel in world units
    const sel = store.selection;
    // rooms
    const tints = C.dark ? ROOM_TINTS_DARK : ROOM_TINTS;
    der.rooms.forEach((r, i) => {
      g.beginPath(); r.poly.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
      g.fillStyle = tints[i % tints.length]; g.fill();
      if (sel?.type === 'room' && sel.id === r.id) { g.fillStyle = 'rgba(233,169,43,0.18)'; g.fill(); }
    });
    // walkability overlay
    if (this.walkOverlay) this._drawWalk(g, f, der);
    // door swings
    g.lineWidth = px; g.strokeStyle = C.muted;
    for (const sw of doorSwings(der)) {
      g.setLineDash([4 * px, 3 * px]);
      g.beginPath(); g.moveTo(sw.poly[1].x, sw.poly[1].y);
      for (let i = 2; i < sw.poly.length; i++) g.lineTo(sw.poly[i].x, sw.poly[i].y);
      g.stroke(); g.setLineDash([]);
      g.beginPath(); g.moveTo(sw.hinge.x, sw.hinge.y); const end = sw.poly[sw.poly.length - 1]; g.lineTo(end.x, end.y); g.lineWidth = 2 * px; g.stroke(); g.lineWidth = px;
    }
    // walls
    g.fillStyle = C.wall;
    for (const x of der.walls) {
      if (!x.sL) continue;
      g.beginPath(); [x.sR, x.eR, x.eL, x.sL].forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
    }
    for (const hb of der.hubs) { g.beginPath(); hb.poly.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); }
    // openings: cut the wall and draw symbols
    for (const x of der.walls) for (const o of x.w.openings || []) {
      const a = add(x.A, mul(x.dir, o.offset)), b = add(x.A, mul(x.dir, o.offset + o.width));
      const nn = mul(x.n, x.t / 2 + px);
      g.beginPath(); g.moveTo(a.x + nn.x, a.y + nn.y); g.lineTo(b.x + nn.x, b.y + nn.y); g.lineTo(b.x - nn.x, b.y - nn.y); g.lineTo(a.x - nn.x, a.y - nn.y); g.closePath();
      g.fillStyle = C.floor; g.fill();
      const isSel = sel?.type === 'opening' && sel.id === o.id;
      if (o.type === 'window') {
        g.strokeStyle = isSel ? C.accent : '#5a9fd4'; g.lineWidth = (isSel ? 3 : 1.5) * px;
        for (const k of [-0.22, 0.22]) { const off = mul(x.n, x.t * k); g.beginPath(); g.moveTo(a.x + off.x, a.y + off.y); g.lineTo(b.x + off.x, b.y + off.y); g.stroke(); }
        g.lineWidth = px; g.beginPath(); g.moveTo(a.x + nn.x, a.y + nn.y); g.lineTo(a.x - nn.x, a.y - nn.y); g.moveTo(b.x + nn.x, b.y + nn.y); g.lineTo(b.x - nn.x, b.y - nn.y); g.stroke();
      } else if (isSel) { g.strokeStyle = C.accent; g.lineWidth = 3 * px; g.strokeRect(Math.min(a.x, b.x) - 0, Math.min(a.y, b.y), 0, 0); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    }
    // decor ticks
    for (const x of der.walls) for (const d of x.w.decor || []) {
      const s1 = d.side || 1; const a = add(add(x.A, mul(x.dir, d.offset)), mul(x.n, s1 * x.t / 2)); const b = add(a, mul(x.dir, d.width));
      const o = mul(x.n, s1 * Math.max(d.depth || 0.03, 3 * px));
      const isSel = sel?.type === 'decor' && sel.id === d.id;
      g.fillStyle = isSel ? C.accent : '#b48a60';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b.x + o.x, b.y + o.y); g.lineTo(a.x + o.x, a.y + o.y); g.closePath(); g.fill();
    }
    // selected wall highlight
    if (sel?.type === 'wall') {
      const x = der.byId.get(sel.id);
      if (x?.sL) { g.beginPath(); [x.sR, x.eR, x.eL, x.sL].forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fillStyle = C.accent; g.fill(); }
    }
    // items
    const coll = this.app.collisions || new Map();
    const sorted = f.items.slice().sort((a, b) => (a.elevation || 0) - (b.elevation || 0) || (getModel(a.model).tags?.includes('flat') ? -1 : 1));
    for (const it of sorted) this._drawItem(g, it, f, C, px, sel?.type === 'item' && sel.id === it.id, coll.get(it.id));
    // room labels
    g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    der.rooms.forEach((r) => {
      const p = this.toScreen(r.labelPos);
      const name = r.name || this.app.t('room.unnamed', { n: r.index + 1 });
      const fs = clamp(this.scale * 0.22, 10, 15);
      if (r.bbox.w * this.scale < 50) return;
      g.font = `600 ${fs}px ${this.app.font}`; g.fillStyle = C.text; g.fillText(name, p.x, p.y - fs * 0.6);
      g.font = `400 ${fs * 0.85}px ${this.app.font}`; g.fillStyle = C.muted; g.fillText(fmtArea(r.netArea, this.app.lang), p.x, p.y + fs * 0.55);
    });
    // wall dimensions
    if (this.app.settings.showWallDims) this._wallDims(g, der, C);
    // auto quotes
    if (sel?.type === 'item' && this.app.settings.autoQuotes) {
      const it = f.items.find((i) => i.id === sel.id);
      if (it) for (const q of clearances(f, der, it)) this._dimLine(g, q.from, q.to, q.d, q.d < this.app.settings.minPassage ? C.bad : q.d < this.app.settings.comfortPassage ? C.warn : C.dim);
    }
    // structure edit: nodes
    if (this.app.tool === 'structure' || this.app.tool === 'wall') {
      for (const n of f.nodes) {
        const p = this.toScreen(n); const isSel = sel?.type === 'node' && sel.id === n.id;
        g.beginPath(); g.arc(p.x, p.y, isSel ? 6 : 4.5, 0, Math.PI * 2); g.fillStyle = isSel ? C.accent : '#fff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = C.wall; g.stroke();
      }
    }
    // draw-wall preview
    if (this.app.tool === 'wall' && this.drawWall && this.hoverPt) {
      const a = this.toScreen(this.drawWall.start), b = this.toScreen(this.hoverPt);
      g.strokeStyle = C.accent; g.lineWidth = Math.max(2, store.project.settings.intThickness * this.scale); g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.lineCap = 'butt';
      this._label(g, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, fmtLen(dist(this.drawWall.start, this.hoverPt), this.app.settings.units, this.app.lang), C.accent);
    }
    // measure
    if (this.measure.length) {
      const pts = this.measure.length === 1 && this.hoverPt ? [this.measure[0], this.hoverPt] : this.measure;
      if (pts.length === 2) this._dimLine(g, pts[0], pts[1], dist(pts[0], pts[1]), C.dim, true);
      for (const p of this.measure) { const q = this.toScreen(p); g.beginPath(); g.arc(q.x, q.y, 4, 0, Math.PI * 2); g.fillStyle = C.dim; g.fill(); }
    }
    // scale bar
    this._scaleBar(g, C);
  }
  _grid(g, C) {
    const s = this.scale; let step = 1;
    if (s < 12) step = 5; else if (s > 120) step = 0.1; else if (s > 60) step = 0.5;
    const w0 = this.toWorld({ x: 0, y: 0 }), w1 = this.toWorld({ x: this.W, y: this.H });
    g.lineWidth = 1;
    for (let x = Math.floor(w0.x / step) * step; x <= w1.x; x += step) {
      const sx = Math.round(x * s + this.ox) + 0.5; const major = Math.abs(x - Math.round(x)) < 1e-6 && (step < 1 ? true : Math.round(x) % 5 === 0);
      g.strokeStyle = major ? C.grid2 : C.grid; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, this.H); g.stroke();
    }
    for (let y = Math.floor(w0.y / step) * step; y <= w1.y; y += step) {
      const sy = Math.round(y * s + this.oy) + 0.5; const major = Math.abs(y - Math.round(y)) < 1e-6 && (step < 1 ? true : Math.round(y) % 5 === 0);
      g.strokeStyle = major ? C.grid2 : C.grid; g.beginPath(); g.moveTo(0, sy); g.lineTo(this.W, sy); g.stroke();
    }
  }
  _scaleBar(g, C) {
    const target = 100 / this.scale; const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find((v) => v >= target * 0.6) || 20;
    const len = nice * this.scale; const x = 16, y = this.H - 18;
    g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + len, y); g.lineTo(x + len, y - 4); g.stroke();
    g.font = `500 11px ${this.app.font}`; g.fillStyle = C.text; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(fmtLen(nice, nice < 1 ? 'cm' : 'm', this.app.lang), x + len + 6, y + 2);
  }
  _drawItem(g, it, f, C, px, isSel, coll) {
    const model = getModel(it.model); const dims = itemDims(it, f.height);
    const parts = resolveParts(model, dims, f.height).filter((p) => (it.elevation || 0) + p.y < 2.2).sort((a, b) => (a.y + (a.ax === 'z' ? a.d : a.h)) - (b.y + (b.ax === 'z' ? b.d : b.h)));
    const main = it.color || model.color || '#c7b8a3';
    g.save(); g.translate(it.x, it.y); g.rotate((it.rot || 0) * Math.PI / 180);
    const hanging = (it.elevation || 0) > 1.2;
    g.globalAlpha = hanging ? 0.55 : 1;
    // base footprint shadow
    g.fillStyle = C.dark ? 'rgba(0,0,0,0.35)' : 'rgba(30,35,40,0.08)';
    roundRect(g, -dims.w / 2 + 0.02, -dims.d / 2 + 0.03, dims.w, dims.d, 0.03); g.fill();
    for (const p of parts) {
      const col = p.m === 'main' ? main : p.m === 'soft' ? lighten(main, 0.2) : p.m === 'accent' ? (it.accent || lighten(main, 0.45)) : MAT_COL[p.m] || main;
      g.fillStyle = col; g.strokeStyle = C.dark ? 'rgba(0,0,0,0.5)' : 'rgba(40,40,40,0.35)'; g.lineWidth = px;
      if (p.s === 'cyl' && p.ax !== 'z' || p.s === 'sph') { g.beginPath(); g.ellipse(p.x, p.z, p.w / 2, p.d / 2, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else if (p.s === 'cyl') { g.fillRect(p.x - p.w / 2, p.z, p.w, p.h); }
      else { g.save(); g.translate(p.x, p.z); if (p.rot) g.rotate(-p.rot * Math.PI / 180); roundRect(g, -p.w / 2, -p.d / 2, p.w, p.d, Math.min(p.r || 0, p.w / 2, p.d / 2)); g.fill(); g.stroke(); g.restore(); }
    }
    g.globalAlpha = 1;
    // outline
    roundRect(g, -dims.w / 2, -dims.d / 2, dims.w, dims.d, 0.02);
    if (coll || isSel) {
      g.lineWidth = (isSel ? 2.5 : 2) * px;
      g.strokeStyle = coll?.level === 'error' ? C.bad : coll ? C.warn : C.accent;
      g.stroke();
      if (coll?.level === 'error') { g.save(); g.clip(); g.strokeStyle = 'rgba(214,69,69,0.35)'; g.lineWidth = px; for (let k = -dims.w - dims.d; k < dims.w + dims.d; k += 10 * px) { g.beginPath(); g.moveTo(k - dims.d, -dims.d); g.lineTo(k + dims.d, dims.d); g.stroke(); } g.restore(); }
    }
    // front marker
    g.strokeStyle = C.dark ? 'rgba(255,255,255,0.5)' : 'rgba(30,30,30,0.45)'; g.lineWidth = 1.5 * px;
    g.beginPath(); g.moveTo(-Math.min(0.08, dims.w / 4), dims.d / 2 + 3 * px); g.lineTo(0, dims.d / 2 + 7 * px); g.lineTo(Math.min(0.08, dims.w / 4), dims.d / 2 + 3 * px); g.stroke();
    if (isSel) {
      // rotation handle behind the item
      const hy = -dims.d / 2 - 22 * px;
      g.strokeStyle = C.accent; g.lineWidth = 1.5 * px; g.beginPath(); g.moveTo(0, -dims.d / 2); g.lineTo(0, hy); g.stroke();
      g.beginPath(); g.arc(0, hy, 7 * px, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.stroke();
      g.beginPath(); g.arc(0, hy, 3.5 * px, -2.4, 1.2); g.stroke();
    }
    g.restore();
    // name
    if (dims.w * this.scale > 60 && (isSel || this.app.settings.showNames)) {
      const p = this.toScreen({ x: it.x, y: it.y });
      g.font = `500 11px ${this.app.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      this._label(g, p.x, p.y, it.name || modelName(model, this.app.lang), C.text);
    }
  }
  _label(g, x, y, text, color) {
    g.font = `600 11px ${this.app.font}`; const w = g.measureText(text).width + 8;
    g.fillStyle = this._colors().dark ? 'rgba(30,33,36,0.9)' : 'rgba(255,255,255,0.92)'; roundRect(g, x - w / 2, y - 9, w, 18, 4); g.fill();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5);
  }
  _dimLine(g, a, b, d, color, ticks = true) {
    const A = this.toScreen(a), B = this.toScreen(b);
    g.strokeStyle = color; g.lineWidth = 1.25; g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
    if (ticks) {
      const dir = norm(sub(B, A)); const n = perp(dir);
      for (const P of [A, B]) { g.beginPath(); g.moveTo(P.x + (n.x - dir.x) * 4, P.y + (n.y - dir.y) * 4); g.lineTo(P.x - (n.x - dir.x) * 4, P.y - (n.y - dir.y) * 4); g.stroke(); }
    }
    if (dist(A, B) > 18) this._label(g, (A.x + B.x) / 2, (A.y + B.y) / 2, fmtLen(d, this.app.settings.units, this.app.lang), color);
  }
  _wallDims(g, der, C) {
    for (const x of der.walls) {
      if (x.len * this.scale < 40) continue;
      const side = x.roomL && !x.roomR ? -1 : x.roomR && !x.roomL ? 1 : 0;
      if (!side && !this.app.settings.showInnerDims) continue;
      const s = side || 1;
      const off = mul(x.n, s * (x.t / 2 + 14 / this.scale));
      this._dimLine(g, add(x.A, off), add(x.B, off), x.len, C.dim);
    }
  }
  _drawWalk(g, f, der) {
    if (!this._walkCache || this._walkCache.sig !== this._walkSig(f)) {
      const grids = der.rooms.map((r) => walkGrid(f, der, r, { minPassage: this.app.settings.minPassage }));
      this._walkCache = { sig: this._walkSig(f), grids };
    }
    for (const G of this._walkCache.grids) {
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
        const k = j * G.nx + i; if (!G.inside[k]) continue;
        g.fillStyle = G.walk[k] ? 'rgba(60,154,95,0.28)' : G.free[k] ? 'rgba(214,69,69,0.22)' : 'rgba(0,0,0,0)';
        g.fillRect(G.x0 + i * G.cell, G.y0 + j * G.cell, G.cell + 0.002, G.cell + 0.002);
      }
    }
  }
  _walkSig(f) { return JSON.stringify([f.items, f.walls, f.nodes, this.app.settings.minPassage]); }

  // ------------------------------------------------------------------ hit testing
  hit(sp) {
    const f = store.floor; const der = derive(f); const w = this.toWorld(sp); const tolW = 8 / this.scale;
    const sel = store.selection;
    if (sel?.type === 'item') {
      const it = f.items.find((i) => i.id === sel.id);
      if (it) {
        const dims = itemDims(it, f.height); const r = (it.rot || 0) * Math.PI / 180;
        const hp = add({ x: it.x, y: it.y }, { x: Math.sin(r) * (dims.d / 2 + 22 / this.scale), y: -Math.cos(r) * (dims.d / 2 + 22 / this.scale) });
        if (dist(hp, w) < 12 / this.scale) return { type: 'rotate', id: it.id };
      }
    }
    if (this.app.tool === 'structure' || this.app.tool === 'wall') {
      for (const n of f.nodes) if (dist(n, w) < 9 / this.scale) return { type: 'node', id: n.id };
    }
    const items = f.items.slice().sort((a, b) => (b.elevation || 0) - (a.elevation || 0));
    for (const it of items) { const fp = footprint(it, f.height); if (pointInPoly(w, fp.corners)) return { type: 'item', id: it.id }; }
    for (const x of der.walls) {
      for (const o of x.w.openings || []) {
        const a = add(x.A, mul(x.dir, o.offset)), b = add(x.A, mul(x.dir, o.offset + o.width));
        if (distPointSeg(w, a, b) < x.t / 2 + tolW) return { type: 'opening', id: o.id, wallId: x.id };
      }
      for (const d of x.w.decor || []) {
        const a = add(add(x.A, mul(x.dir, d.offset)), mul(x.n, (d.side || 1) * x.t / 2)), b = add(a, mul(x.dir, d.width));
        if (distPointSeg(w, a, b) < tolW * 0.8) return { type: 'decor', id: d.id, wallId: x.id };
      }
    }
    for (const x of der.walls) {
      if (distPointSeg(w, x.A, x.B) < x.t / 2 + tolW * 0.5) {
        const side = dot(sub(w, x.A), x.n) >= 0 ? 1 : -1;
        return { type: 'wall', id: x.id, side, offset: clamp(dot(sub(w, x.A), x.dir), 0, x.len) };
      }
    }
    const r = der.rooms.find((rr) => pointInPoly(w, rr.poly));
    if (r) return { type: 'room', id: r.id };
    return null;
  }

  // ------------------------------------------------------------------ interaction
  _bind() {
    const cv = this.cv; const pointers = new Map();
    let st = null; // current interaction
    const sp = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = sp(e); this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, sp(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (st?.kind === 'item' && this.app.flags.twoFingerRotate) {
          const it = store.floor.items.find((i) => i.id === st.id);
          if (!st.moved) { st.moved = true; store.beginGesture(); }
          st = { ...st, kind: 'twist', a0: Math.atan2(b.y - a.y, b.x - a.x), rot0: it?.rot || 0 };
        } else {
          if (st?.moved && st.kind !== 'pan') store.endGesture('edit');
          st = { kind: 'pinch', d0: dist(a, b), s0: this.scale, c0: mul(add(a, b), 0.5), o0: { x: this.ox, y: this.oy } };
        }
        return;
      }
      if (pointers.size > 2) return;
      const p = sp(e); const w = this.toWorld(p);
      const panBtn = e.button === 1 || e.button === 2 || (e.button === 0 && this.app.spaceDown);
      if (panBtn) { st = { kind: 'pan', p0: p, o0: { x: this.ox, y: this.oy }, moved: true }; return; }
      if (this.app.tool === 'measure') { st = { kind: 'measure', p0: p }; return; }
      if (this.app.tool === 'wall') { st = { kind: 'wallclick', p0: p }; return; }
      const h = this.hit(p);
      if (h?.type === 'rotate') { st = { kind: 'rotate', id: h.id, moved: false, p0: p }; return; }
      if (h?.type === 'item') {
        const it = store.floor.items.find((i) => i.id === h.id);
        st = { kind: 'item', id: h.id, p0: p, off: { x: it.x - w.x, y: it.y - w.y }, moved: false, locked: it.locked };
        return;
      }
      if (h?.type === 'node') { st = { kind: 'node', id: h.id, p0: p, moved: false }; return; }
      if (h?.type === 'decor') { st = { kind: 'decor', h, p0: p, moved: false }; return; }
      if (h?.type === 'opening') { st = { kind: 'opening', h, p0: p, moved: false }; return; }
      st = { kind: 'pan', p0: p, o0: { x: this.ox, y: this.oy }, moved: false, hit: h };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = sp(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      const w = this.toWorld(p);
      if (!st) {
        this.hoverPt = this.app.tool === 'wall' ? this._snapWallPoint(w).p : this.app.tool === 'measure' ? this._snapMeasure(w) : null;
        if (this.app.tool === 'measure' || this.app.tool === 'wall') this.draw();
        if (this.app.flags.hover && e.pointerType === 'mouse') { const h = this.hit(p); cv.style.cursor = h?.type === 'item' ? 'grab' : h?.type === 'rotate' ? 'alias' : h ? 'pointer' : 'default'; }
        return;
      }
      const moved = dist(p, st.p0 || p) > 4;
      if (st.kind === 'pinch') {
        const [a, b] = [...pointers.values()]; if (!b) return;
        const k = dist(a, b) / st.d0; const c = mul(add(a, b), 0.5);
        this.scale = clamp(st.s0 * k, 4, 600); const kk = this.scale / st.s0;
        this.ox = c.x - (st.c0.x - st.o0.x) * kk; this.oy = c.y - (st.c0.y - st.o0.y) * kk; this.draw(); return;
      }
      if (st.kind === 'twist') {
        const [a, b] = [...pointers.values()]; if (!b) return;
        let rot = st.rot0 + (Math.atan2(b.y - a.y, b.x - a.x) - st.a0) * 180 / Math.PI;
        const sn = Math.round(rot / 15) * 15; if (Math.abs(sn - rot) < 4) { if (st.last !== sn && this.app.flags.haptics) navigator.vibrate?.(8); st.last = sn; rot = sn; }
        const it = store.floor.items.find((i) => i.id === st.id); if (it) store.commit('rotate', () => { it.rot = ((rot % 360) + 360) % 360; });
        return;
      }
      if (st.kind === 'pan') { if (!moved && !st.moved) return; st.moved = true; this.ox = st.o0.x + p.x - st.p0.x; this.oy = st.o0.y + p.y - st.p0.y; this.draw(); return; }
      if (st.kind === 'item' && !st.locked) {
        if (!st.moved) { if (!moved) return; st.moved = true; store.beginGesture(); store.select({ type: 'item', id: st.id, floorId: store.floor.id }); }
        const f = store.floor; const it = f.items.find((i) => i.id === st.id); if (!it) return;
        const s = this.app.settings.snap && !e.altKey ? snapItem(f, derive(f), it, w.x + st.off.x, w.y + st.off.y, it.rot || 0, { grid: this.app.settings.grid }) : { x: w.x + st.off.x, y: w.y + st.off.y, rot: it.rot };
        if (s.snapped?.length && !st.snapBuzz && this.app.flags.haptics) { navigator.vibrate?.(6); st.snapBuzz = true; } else if (!s.snapped?.length) st.snapBuzz = false;
        store.commit('move', () => { it.x = +s.x.toFixed(4); it.y = +s.y.toFixed(4); it.rot = s.rot; });
        return;
      }
      if (st.kind === 'rotate') {
        const f = store.floor; const it = f.items.find((i) => i.id === st.id); if (!it) return;
        if (!st.moved) { st.moved = true; store.beginGesture(); }
        let rot = Math.atan2(w.x - it.x, -(w.y - it.y)) * 180 / Math.PI;
        const stepDeg = e.shiftKey ? 45 : 15; const sn = Math.round(rot / stepDeg) * stepDeg;
        if (Math.abs(sn - rot) < (e.shiftKey ? 22.5 : 5)) rot = sn;
        store.commit('rotate', () => { it.rot = ((rot % 360) + 360) % 360; });
        return;
      }
      if (st.kind === 'node') {
        if (!st.moved) { if (!moved) return; st.moved = true; store.beginGesture(); }
        const f = store.floor; const n = f.nodes.find((q) => q.id === st.id); if (!n) return;
        const q = this._snapNode(w, n);
        store.commit('node', () => { n.x = q.x; n.y = q.y; });
        return;
      }
      if (st.kind === 'opening' || st.kind === 'decor') {
        if (!st.moved) { if (!moved) return; st.moved = true; store.beginGesture(); store.select({ type: st.kind, id: st.h.id, wallId: st.h.wallId, floorId: store.floor.id }); }
        const f = store.floor; const der = derive(f); const x = der.byId.get(st.h.wallId); if (!x) return;
        const list = st.kind === 'opening' ? x.w.openings : x.w.decor; const o = list.find((q) => q.id === st.h.id); if (!o) return;
        const u = clamp(dot(sub(w, x.A), x.dir) - o.width / 2, 0, Math.max(0, x.len - o.width));
        const g = this.app.settings.grid || 0.01;
        store.commit('slide', () => { o.offset = +(Math.round(u / g) * g).toFixed(3); });
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (!st) return;
      const p = sp(e); const w = this.toWorld(p);
      const k = st.kind;
      if (k === 'pinch' || k === 'twist') { if (k === 'twist') store.endGesture('rotate'); if (pointers.size === 0) st = null; return; }
      if (k === 'measure') { this._measureClick(w); st = null; return; }
      if (k === 'wallclick') { this._wallClick(w, e); st = null; return; }
      if (k === 'item' || k === 'rotate' || k === 'node' || k === 'opening' || k === 'decor') {
        if (st.moved) store.endGesture(k === 'node' ? 'node' : k === 'rotate' ? 'rotate' : 'move');
        else if (k === 'item') store.select({ type: 'item', id: st.id, floorId: store.floor.id });
        else if (k === 'node') store.select({ type: 'node', id: st.id, floorId: store.floor.id });
        else if (k === 'opening' || k === 'decor') store.select({ type: k, id: st.h.id, wallId: st.h.wallId, floorId: store.floor.id });
        st = null; return;
      }
      if (k === 'pan' && !st.moved && e.type !== 'pointercancel') {
        const h = st.hit;
        const fid = store.floor.id;
        if (!h) store.select(null);
        else if (h.type === 'wall') store.select({ type: 'wall', id: h.id, floorId: fid, side: h.side, offset: +h.offset.toFixed(3) });
        else store.select({ ...h, floorId: fid });
      }
      st = null;
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.app.flags.contextMenu) return;
      const h = this.hit(sp(e)); if (!h || h.type === 'rotate') return;
      const fid = store.floor.id;
      store.select(h.type === 'wall' ? { type: 'wall', id: h.id, floorId: fid, side: h.side, offset: h.offset } : { ...h, floorId: fid });
      this.app.contextMenu(e.clientX, e.clientY, h);
    });
    cv.addEventListener('dblclick', () => { if (this.app.tool === 'wall') { this.drawWall = null; this.draw(); } });
    cv.addEventListener('dragover', (e) => { e.preventDefault(); });
    cv.addEventListener('drop', (e) => {
      e.preventDefault();
      const model = e.dataTransfer.getData('text/murello-model');
      if (model) this.app.addItem(model, this.toWorld(sp(e)));
    });
  }
  _snapMeasure(w) {
    const f = store.floor; let best = null;
    for (const n of f.nodes) { const d = dist(n, w); if (d < 10 / this.scale && (!best || d < best.d)) best = { d, p: { x: n.x, y: n.y } }; }
    const der = derive(f);
    if (!best) for (const x of der.walls) for (const s of [1, -1]) {
      const a = add(x.A, mul(x.n, s * x.t / 2)), b = add(x.B, mul(x.n, s * x.t / 2));
      const t = clamp(projT(w, a, b), 0, 1); const q = add(a, mul(sub(b, a), t));
      const d = dist(q, w); if (d < 8 / this.scale && (!best || d < best.d)) best = { d, p: q };
    }
    return best?.p || w;
  }
  _measureClick(w) {
    const p = this._snapMeasure(w);
    if (this.measure.length >= 2) this.measure = [];
    this.measure.push(p); this.draw();
    if (this.measure.length === 2) this.app.toast(this.app.t('measure.result', { d: fmtLen(dist(this.measure[0], this.measure[1]), this.app.settings.units, this.app.lang) }));
  }
  clearMeasure() { this.measure = []; this.draw(); }
  _snapNode(w, n) {
    const f = store.floor; const g = 0.01;
    let p = { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g };
    // align with neighbours
    const neigh = f.walls.filter((x) => x.a === n.id || x.b === n.id).map((x) => f.nodes.find((q) => q.id === (x.a === n.id ? x.b : x.a))).filter(Boolean);
    const tol = 8 / this.scale;
    for (const q of neigh) { if (Math.abs(q.x - p.x) < tol) p.x = q.x; if (Math.abs(q.y - p.y) < tol) p.y = q.y; }
    return { x: +p.x.toFixed(4), y: +p.y.toFixed(4) };
  }
  _snapWallPoint(w) {
    const f = store.floor; const tol = 10 / this.scale;
    for (const n of f.nodes) if (dist(n, w) < tol) return { p: { x: n.x, y: n.y }, nodeId: n.id };
    const der = derive(f);
    for (const x of der.walls) { const t = projT(w, x.A, x.B); if (t > 0.02 && t < 0.98 && distPointSeg(w, x.A, x.B) < tol) return { p: add(x.A, mul(sub(x.B, x.A), t)), wallId: x.id, t }; }
    let p = { x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 };
    if (this.drawWall) { const a = this.drawWall.start; if (Math.abs(p.x - a.x) < tol * 1.5) p.x = a.x; if (Math.abs(p.y - a.y) < tol * 1.5) p.y = a.y; }
    return { p };
  }
  _wallClick(w) {
    const s = this._snapWallPoint(w);
    if (!this.drawWall) { this.drawWall = { start: s.p, snap: s }; this.draw(); return; }
    const a = this.drawWall, b = s;
    if (dist(a.start, b.p) < 0.05) { this.drawWall = null; this.draw(); return; }
    store.commit('addWall', (proj, f) => {
      const nodeFor = (snap, p) => {
        if (snap.nodeId) return snap.nodeId;
        if (snap.wallId) { // split wall (T junction)
          const w0 = f.walls.find((x) => x.id === snap.wallId);
          if (w0) {
            const id = uid('n'); f.nodes.push({ id, x: +p.x.toFixed(4), y: +p.y.toFixed(4) });
            splitWall(f, w0, id, p);
            return id;
          }
        }
        const id = uid('n'); f.nodes.push({ id, x: +p.x.toFixed(4), y: +p.y.toFixed(4) }); return id;
      };
      const na = nodeFor(a.snap, a.start); const nb = nodeFor(b, b.p);
      f.walls.push({ id: uid('w'), a: na, b: nb, thickness: proj.settings.intThickness, height: null, openings: [], decor: [], colorL: null, colorR: null });
      a.snap = { nodeId: nb };
    });
    this.drawWall = { start: b.p, snap: this.drawWall.snap };
    this.draw();
  }
  cancelTool() { this.drawWall = null; this.measure = []; this.draw(); }
}

/** Split wall w0 at node id (point p): keeps openings/decor on the right piece. */
export function splitWall(f, w0, nodeId, p) {
  const A = f.nodes.find((n) => n.id === w0.a), B = f.nodes.find((n) => n.id === w0.b);
  const L = dist(A, B); const cut = dist(A, p);
  const w1 = { ...w0, id: uid('w'), a: nodeId, b: w0.b, openings: [], decor: [] };
  const keepO = [], keepD = [];
  for (const o of w0.openings || []) { if (o.offset + o.width / 2 <= cut) keepO.push(o); else w1.openings.push({ ...o, offset: Math.max(0, o.offset - cut) }); }
  for (const d of w0.decor || []) { if (d.offset + d.width / 2 <= cut) keepD.push(d); else w1.decor.push({ ...d, offset: Math.max(0, d.offset - cut) }); }
  w0.b = nodeId; w0.openings = keepO; w0.decor = keepD;
  f.walls.push(w1);
  void L;
}

function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function lighten(hex, k) {
  const n = parseInt(String(hex).slice(1), 16); if (!isFinite(n)) return hex;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(c + (255 - c) * k);
  return `#${((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1)}`;
}
export { obbCorners };
