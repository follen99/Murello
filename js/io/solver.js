// Measurement solver.
//
// The drawing gives the *topology* (which walls exist, how they connect, roughly where).
// The labels give the *truth* (real lengths). This module combines both:
//  1. snaps wall endpoints into nodes and splits walls at junctions;
//  2. turns every measure (wall label, room "4x3.5", dimension line, free text, opening width,
//     user input) into a constraint between two nodes along X, Y or along an oblique wall;
//  3. solves X and Y independently with a weighted union-find (orthogonal walls make the
//     problem linear), resolving oblique walls when one projection is known;
//  4. reports which measures are missing (with the exact wall to measure) and which are
//     inconsistent (with the cycle of measures that disagree);
//  5. produces node coordinates in metres (estimating from the drawing scale where allowed).
import {
  dist, sub, norm, cross, dot, projT, distPointSeg, segIntersect, pointInPoly, lerpP, polyCentroid, add, mul,
} from '../core/geom.js';
import { planarFaces, cleanFaceLoop } from '../model/faces.js';
import { clamp } from '../core/util.js';

const DEG = Math.PI / 180;
const AXIS_TOL = Math.tan(3 * DEG);

export const DEFAULT_SOLVE_OPTS = {
  mode: 'net',            // 'net' = clear distance between wall faces (tape measure), 'axis' = wall centre lines
  extThickness: 0.30,
  intThickness: 0.10,
  assumeAlign: true,      // nodes drawn on the same line are assumed aligned when nothing else relates them
  useEstimates: false,    // fill missing measures from the drawing scale
  userMeasures: {},       // key → metres (answers to "missing" requests)
  overrides: {},          // constraint key → metres | 'off'
  angles: {},             // key → degrees for oblique walls
  excluded: [],           // pieceKey list: walls removed from the drawing by the user
  doorHeight: 2.10, windowHeight: 1.20, windowSill: 0.90, openingHeight: 2.10,
};

class AxisUF {
  constructor(n) { this.p = Int32Array.from({ length: n }, (_, i) => i); this.o = new Float64Array(n); this.adj = Array.from({ length: n }, () => []); }
  find(i) {
    const p = this.p, o = this.o;
    if (p[i] === i) return i;
    const par = p[i]; const r = this.find(par);
    o[i] += o[par]; p[i] = r; return r;
  }
  same(i, j) { return this.find(i) === this.find(j); }
  delta(i, j) { this.find(i); this.find(j); return this.o[j] - this.o[i]; }
  /** pos_j - pos_i = d. Returns null on success or {diff} on conflict. */
  union(i, j, d, cid, tol) {
    const ri = this.find(i), rj = this.find(j);
    if (ri === rj) {
      const diff = (this.o[j] - this.o[i]) - d;
      if (Math.abs(diff) > tol) return { diff, path: this.path(i, j) };
      return null;
    }
    this.p[rj] = ri; this.o[rj] = this.o[i] + d - this.o[j];
    this.adj[i].push({ to: j, cid }); this.adj[j].push({ to: i, cid });
    return null;
  }
  path(i, j) {
    const prev = new Map([[i, null]]); const q = [i];
    while (q.length) {
      const u = q.shift(); if (u === j) break;
      for (const e of this.adj[u]) if (!prev.has(e.to)) { prev.set(e.to, { from: u, cid: e.cid }); q.push(e.to); }
    }
    const out = []; let u = j;
    while (prev.get(u)) { const s = prev.get(u); out.push(s.cid); u = s.from; }
    return out;
  }
}

const median = (arr) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (v) => Math.round(v * 10) / 10;
export const pairKey = (A, B, axis) => `pair:${r1(A.x)},${r1(A.y)}|${r1(B.x)},${r1(B.y)}|${axis}`;
/** Stable key of a wall piece (endpoints in drawing px, order-independent). */
export const pieceKey = (A, B) => {
  const [P, Q] = A.x < B.x || (A.x === B.x && A.y <= B.y) ? [A, B] : [B, A];
  return `wall:${r1(P.x)},${r1(P.y)}|${r1(Q.x)},${r1(Q.y)}`;
};

export function solvePlan(raw, options = {}) {
  const O = { ...DEFAULT_SOLVE_OPTS, ...options };
  const res = {
    ok: true, complete: true, nodes: [], walls: [], rooms: [], items: [], openingsOut: [],
    issues: { missing: [], conflicts: [], suspicious: [], notes: [], assumptions: 0, estimated: 0 },
    preview: { nodes: [], pieces: [], excluded: [], openings: [], unknowns: raw.unknowns || [], dims: [], texts: [] },
    scale: 0.01, constraints: [], positions: [],
  };
  const segs = raw.segments.filter((s) => dist(s.a, s.b) > 1e-6);
  if (!segs.length) { res.ok = false; res.complete = false; res.issues.notes.push({ code: 'noWalls' }); return res; }

  // ---------- 1. tolerance & nodes ----------
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) for (const p of [s.a, s.b]) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  const tol = clamp(diag * 0.004, 1.5, 6);
  const nodes = [];
  const addNode = (p) => {
    for (let i = 0; i < nodes.length; i++) if (Math.abs(nodes[i].x - p.x) < tol && Math.abs(nodes[i].y - p.y) < tol && dist(nodes[i], p) < tol) return i;
    nodes.push({ x: p.x, y: p.y }); return nodes.length - 1;
  };
  for (const s of segs) { s.na = addNode(s.a); s.nb = addNode(s.b); }
  // crossings
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    const r = segIntersect(A.a, A.b, B.a, B.b); if (!r) continue;
    const ea = tol / dist(A.a, A.b), eb = tol / dist(B.a, B.b);
    if (r.t > ea && r.t < 1 - ea && r.u > eb && r.u < 1 - eb) addNode(r.p);
  }

  // ---------- 2. pieces (split at junctions, dedupe) ----------
  const pieceMap = new Map(); const pieces = [];
  const getPiece = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    let p = pieceMap.get(k);
    if (!p) { p = { idx: pieces.length, a: Math.min(a, b), b: Math.max(a, b), segs: [], thickness: null, height: null, own: [] }; pieceMap.set(k, p); pieces.push(p); }
    return p;
  };
  for (const s of segs) {
    if (s.na === s.nb) continue;
    const A = nodes[s.na], B = nodes[s.nb]; const L = dist(A, B);
    const on = [{ n: s.na, t: 0 }, { n: s.nb, t: 1 }];
    nodes.forEach((N, i) => {
      if (i === s.na || i === s.nb) return;
      const t = projT(N, A, B);
      if (t > tol / L && t < 1 - tol / L && distPointSeg(N, A, B) < tol) on.push({ n: i, t });
    });
    on.sort((p, q) => p.t - q.t);
    s.pieces = [];
    for (let k = 0; k < on.length - 1; k++) {
      if (on[k].n === on[k + 1].n) continue;
      const p = getPiece(on[k].n, on[k + 1].n);
      p.segs.push(s.id); s.pieces.push(p.idx);
      if (s.thickness) p.thickness = Math.max(p.thickness || 0, s.thickness);
      if (s.height) p.height = Math.max(p.height || 0, s.height);
      if (s.thkPx) p.thkPx = Math.max(p.thkPx || 0, s.thkPx);
      if (s.src === 'wall') p.isWall = true;
      if (s.own) p.own.push(s);
    }
  }
  // walls removed by the user: drop their pieces (nodes stay, so keys and indices remain stable)
  const excluded = new Set(O.excluded || []);
  if (excluded.size) {
    const remap = new Map(); const kept = [];
    for (const p of pieces) {
      const key = pieceKey(nodes[p.a], nodes[p.b]);
      if (excluded.has(key)) { res.preview.excluded.push({ key, a: nodes[p.a], b: nodes[p.b] }); pieceMap.delete(`${p.a}-${p.b}`); continue; }
      remap.set(p.idx, kept.length); p.idx = kept.length; kept.push(p);
    }
    pieces.splice(0, pieces.length, ...kept);
    for (const s of segs) if (s.pieces) s.pieces = s.pieces.filter((i) => remap.has(i)).map((i) => remap.get(i));
  }
  const dirOf = (a, b) => {
    const A = nodes[a], B = nodes[b]; const dx = B.x - A.x, dy = B.y - A.y;
    if (Math.abs(dy) <= AXIS_TOL * Math.abs(dx)) return 'h';
    if (Math.abs(dx) <= AXIS_TOL * Math.abs(dy)) return 'v';
    return 'o';
  };

  // ---------- 3. bridge gaps covered by openings / ignored elements ----------
  const adjPieces = () => { const m = nodes.map(() => []); pieces.forEach((p) => { m[p.a].push(p); m[p.b].push(p); }); return m; };
  let adj = adjPieces();
  const gapElems = [
    ...(raw.openings || []).map((o) => ({ ...o, isOpening: true })),
    ...(raw.unknowns || []).map((u) => ({ ...u, kind: 'ignore', isOpening: false })),
  ];
  for (const E of gapElems) {
    const poly = E.corners; if (!poly || poly.length < 3) continue;
    const inside = [];
    nodes.forEach((N, i) => {
      if (!adj[i].length) return;
      let near = pointInPoly(N, poly);
      if (!near) for (let k = 0; k < poly.length; k++) if (distPointSeg(N, poly[k], poly[(k + 1) % poly.length]) < tol * 1.5) { near = true; break; }
      if (near) inside.push(i);
    });
    let best = null;
    for (let i = 0; i < inside.length; i++) for (let j = i + 1; j < inside.length; j++) {
      const p = inside[i], q = inside[j];
      if (pieceMap.has(p < q ? `${p}-${q}` : `${q}-${p}`) || excluded.has(pieceKey(nodes[p], nodes[q]))) continue;
      const d = norm(sub(nodes[q], nodes[p]));
      const along = (n, other) => adj[n].some((pc) => {
        const far = pc.a === n ? pc.b : pc.a; const e = norm(sub(nodes[far], nodes[n]));
        return Math.abs(cross(e, d)) < Math.sin(6 * DEG) && dot(e, norm(sub(nodes[other], nodes[n]))) < 0;
      });
      if (!along(p, q) || !along(q, p)) continue;
      const cdist = distPointSeg(E.center, nodes[p], nodes[q]);
      if (!best || cdist < best.cdist) best = { p, q, cdist };
    }
    if (best) {
      const pc = getPiece(best.p, best.q);
      pc.bridge = E.isOpening ? E.cellId : 'ignored'; pc.isWall = true;
      if (E.isOpening) E.bridgePiece = pc.idx;
      adj = adjPieces();
    }
  }
  for (const p of pieces) p.dir = dirOf(p.a, p.b);

  // ---------- 4. faces in drawing space → exterior walls ----------
  const facesPx = planarFaces(nodes, pieces.map((p) => [p.a, p.b]));
  const exteriorSet = new Set();
  for (const f of facesPx.faces) if (f.outer) f.edges.forEach((ei) => exteriorSet.add(ei));
  pieces.forEach((p) => { p.exterior = exteriorSet.has(p.idx); });

  // ---------- 5. scale estimate (px → m) ----------
  const ratios = [];
  for (const s of segs) if (s.measure?.value) ratios.push(s.measure.value / dist(s.a, s.b));
  for (const r of raw.rooms || []) if (r.wxd) {
    const L01 = dist(r.poly[0], r.poly[1]), L12 = dist(r.poly[1], r.poly[2]);
    const [a, b] = matchWxd(r.wxd, L01, L12); ratios.push(a / L01, b / L12);
  }
  for (const d of raw.dimensions || []) if (d.value) ratios.push(d.value / dist(d.a, d.b));
  let scale = median(ratios.filter((x) => isFinite(x) && x > 0));
  if (!scale) {
    scale = raw.meta?.scale ? 1 / raw.meta.scale : 0.01;
    res.issues.notes.push({ code: 'noMeasures' });
  }
  res.scale = scale;
  for (const p of pieces) {
    const ownT = p.own.map((s) => s.data?.thickness).find((t) => t > 0);
    p.thk = p.thickness || ownT || (p.thkPx ? clamp(p.thkPx * scale, 0.04, 0.8) : null) || (p.exterior ? O.extThickness : O.intThickness);
    const ownH = p.own.map((s) => s.data?.height).find((t) => t > 0);
    p.h = p.height || ownH || null;
  }
  adj = adjPieces();

  // ---------- 6. constraints ----------
  const C = []; const byCid = new Map();
  const halfPerp = (n, dirv) => {
    let m = 0;
    for (const pc of adj[n]) {
      const far = pc.a === n ? pc.b : pc.a; const e = norm(sub(nodes[far], nodes[n]));
      if (Math.abs(cross(e, dirv)) > Math.sin(30 * DEG)) m = Math.max(m, pc.thk / 2);
    }
    return m;
  };
  const addC = ({ na, nb, value, mode, src, key, angle, pieces: pcs, noAdjust, forceKind }) => {
    if (na == null || nb == null || na === nb || !(value > 0)) return null;
    const ov = O.overrides[key];
    if (ov === 'off') return null;
    const typed = typeof ov === 'number' && ov > 0 ? ov : value;
    const A = nodes[na], B = nodes[nb];
    const dx = B.x - A.x, dy = B.y - A.y;
    const kind = forceKind || (Math.abs(dy) <= AXIS_TOL * Math.abs(dx) ? 'x' : Math.abs(dx) <= AXIS_TOL * Math.abs(dy) ? 'y' : 'len');
    const m = mode || O.mode;
    const dirv = kind === 'x' ? { x: 1, y: 0 } : kind === 'y' ? { x: 0, y: 1 } : norm({ x: dx, y: dy });
    let axisVal = typed;
    if (m === 'net' && !noAdjust) axisVal += halfPerp(na, dirv) + halfPerp(nb, dirv);
    const c = {
      cid: `c${C.length}`, key, kind, a: na, b: nb, typed, value: axisVal, mode: m, src, angle: angle ?? O.angles[key],
      sign: kind === 'x' ? Math.sign(dx) || 1 : kind === 'y' ? Math.sign(dy) || 1 : 1, pieces: pcs || [], overridden: typeof ov === 'number',
    };
    C.push(c); byCid.set(c.cid, c); return c;
  };
  // wall / room-side labels
  for (const s of segs) {
    if (!s.measure?.value || s.na === s.nb || !s.pieces?.length) continue;
    addC({ na: s.na, nb: s.nb, value: s.measure.value, mode: s.measure.mode || (s.own ? 'axis' : null), angle: s.measure.angle ?? s.angle, src: { type: 'label', cellId: s.cellId, text: fmtSrc(s.measure.value) }, key: `seg:${s.cellId}:${s.piece}`, pieces: s.pieces });
  }
  // rooms "W x D"
  for (const r of raw.rooms || []) {
    if (!r.wxd || !r.sideSegs) continue;
    const sides = r.sideSegs.map((id) => segs.find((s) => s.id === id)).filter(Boolean);
    if (sides.length !== 4) continue;
    const L01 = dist(r.poly[0], r.poly[1]), L12 = dist(r.poly[1], r.poly[2]);
    const [wv, dv, swapped] = matchWxd(r.wxd, L01, L12);
    if (swapped) res.issues.notes.push({ code: 'wxdSwapped', name: r.name });
    const mk = (s, v, tag) => s.pieces?.length && addC({ na: s.na, nb: s.nb, value: v, mode: r.mode, src: { type: 'room', cellId: r.cellId, name: r.name, text: `${r.name || ''} ${fmtSrc(r.wxd[0])}×${fmtSrc(r.wxd[1])}`.trim() }, key: `room:${r.cellId}:${tag}`, pieces: s.pieces });
    mk(sides[0], wv, 'w0'); mk(sides[2], wv, 'w1'); mk(sides[1], dv, 'd0'); mk(sides[3], dv, 'd1');
  }
  // dimension lines → nearest aligned nodes
  for (const d of raw.dimensions || []) {
    if (!d.value) { res.issues.notes.push({ code: 'dimNoValue', cellId: d.cellId }); continue; }
    const dx = d.b.x - d.a.x, dy = d.b.y - d.a.y;
    const horiz = Math.abs(dy) <= AXIS_TOL * Math.abs(dx), vert = Math.abs(dx) <= AXIS_TOL * Math.abs(dy);
    const pick = (P) => {
      let best = -1, bd = Infinity;
      nodes.forEach((N, i) => {
        if (!adj[i].length) return;
        const off = horiz ? Math.abs(N.x - P.x) : vert ? Math.abs(N.y - P.y) : dist(N, P);
        if (off > tol * (horiz || vert ? 1.2 : 2)) return;
        const dd = dist(N, P); if (dd < bd) { bd = dd; best = i; }
      });
      return best < 0 ? null : best;
    };
    const na = pick(d.a), nb = pick(d.b);
    res.preview.dims.push({ a: d.a, b: d.b, value: d.value, ok: na != null && nb != null });
    if (na == null || nb == null) { res.issues.notes.push({ code: 'dimUnattached', cellId: d.cellId }); continue; }
    addC({ na, nb, value: d.value, mode: d.mode, src: { type: 'dimension', cellId: d.cellId, text: fmtSrc(d.value) }, key: `dim:${d.cellId}` });
  }
  // free text that is only a length → nearest wall segment
  const maxTextDist = Math.max(40, diag * 0.06);
  for (const t of raw.labels || []) {
    const p = t.parsed;
    if (!p || p.measure == null || p.name || p.wxd) continue;
    let best = null;
    for (const s of segs) {
      if (!s.pieces?.length) continue;
      const tt = projT(t.pos, s.a, s.b); if (tt < 0.05 || tt > 0.95) continue;
      const dd = distPointSeg(t.pos, s.a, s.b);
      const score = dd + (s.measure ? maxTextDist * 0.5 : 0);
      if (dd < maxTextDist && (!best || score < best.score)) best = { s, score };
    }
    res.preview.texts.push({ pos: t.pos, value: p.measure, ok: !!best });
    if (!best) { res.issues.notes.push({ code: 'textUnattached', text: t.text }); continue; }
    addC({ na: best.s.na, nb: best.s.nb, value: p.measure, mode: p.mode, src: { type: 'text', cellId: t.cellId, text: fmtSrc(p.measure) }, key: `text:${t.cellId}`, pieces: best.s.pieces });
  }
  // opening widths on bridged gaps (clear width = axis length of the gap)
  for (const E of gapElems) {
    if (!E.isOpening || E.bridgePiece == null || !E.measure) continue;
    const pc = pieces[E.bridgePiece];
    addC({ na: pc.a, nb: pc.b, value: E.measure, mode: 'axis', noAdjust: true, src: { type: 'opening', cellId: E.cellId, text: fmtSrc(E.measure) }, key: `open:${E.cellId}`, pieces: [pc.idx] });
  }
  // rectangular faces that contain a "Name WxD" text
  for (const t of raw.labels || []) {
    if (!t.parsed?.wxd) continue;
    const f = facesPx.faces.find((F) => !F.outer && pointInPoly(t.pos, F.nodes.map((i) => nodes[i])));
    if (!f) continue;
    const corners = rectCorners(f.nodes, nodes);
    if (!corners) { res.issues.notes.push({ code: 'wxdNotRect', name: t.parsed.name }); continue; }
    const [c0, c1, c2, c3] = corners;
    const [wv, dv] = matchWxd(t.parsed.wxd, dist(nodes[c0], nodes[c1]), dist(nodes[c1], nodes[c2]));
    const src = { type: 'room', cellId: t.cellId, name: t.parsed.name, text: `${t.parsed.name} ${fmtSrc(t.parsed.wxd[0])}×${fmtSrc(t.parsed.wxd[1])}` };
    addC({ na: c0, nb: c1, value: wv, mode: t.parsed.mode, src, key: `rtext:${t.cellId}:w0` });
    addC({ na: c3, nb: c2, value: wv, mode: t.parsed.mode, src, key: `rtext:${t.cellId}:w1` });
    addC({ na: c1, nb: c2, value: dv, mode: t.parsed.mode, src, key: `rtext:${t.cellId}:d0` });
    addC({ na: c0, nb: c3, value: dv, mode: t.parsed.mode, src, key: `rtext:${t.cellId}:d1` });
  }
  // user answers
  for (const [key, val] of Object.entries(O.userMeasures)) {
    if (!(val > 0)) continue;
    const m = key.match(/^pair:([-\d.]+),([-\d.]+)\|([-\d.]+),([-\d.]+)\|(x|y|len)(\|axis)?$/);
    if (!m) continue;
    const na = nearestNode(nodes, { x: +m[1], y: +m[2] }, tol * 2), nb = nearestNode(nodes, { x: +m[3], y: +m[4] }, tol * 2);
    if (na == null || nb == null) continue;
    addC({ na, nb, value: val, mode: m[6] ? 'axis' : null, src: { type: 'user', text: fmtSrc(val) }, key, forceKind: m[5] });
  }
  res.constraints = C;

  // ---------- 6b. suspicious units ----------
  // A length that disagrees with the drawing scale by ~100× was almost certainly read in the wrong
  // unit ("19" meant as cm but read as m). Propose the value that matches the drawing.
  for (const c of C) {
    if (c.overridden || !['label', 'text', 'dimension'].includes(c.src.type)) continue;
    const A = nodes[c.a], B = nodes[c.b];
    const px = c.kind === 'x' ? Math.abs(B.x - A.x) : c.kind === 'y' ? Math.abs(B.y - A.y) : dist(A, B);
    if (px < 0.5) continue;
    const drawn = px * scale;
    const q = c.typed / drawn;
    if (q < 8 && q > 1 / 8) continue;
    const cands = [c.typed / 100, c.typed / 1000, c.typed * 100].filter((v) => v / drawn > 1 / 3 && v / drawn < 3);
    if (!cands.length) continue;
    const proposed = cands.sort((u, v) => Math.abs(Math.log(u / drawn)) - Math.abs(Math.log(v / drawn)))[0];
    res.issues.suspicious.push({ key: c.key, src: c.src, typed: c.typed, proposed: Math.round(proposed * 10000) / 10000, drawn, pieces: c.pieces, a: c.a, b: c.b });
  }

  // ---------- 7. solve ----------
  const X = new AxisUF(nodes.length), Y = new AxisUF(nodes.length);
  const tolOf = (v) => 0.02 + 0.003 * Math.abs(v);
  const conflicts = [];
  const reportConflict = (c, r) => {
    const path = r.path.map((cid) => byCid.get(cid)).filter(Boolean);
    conflicts.push({ cid: c.cid, key: c.key, diff: r.diff, constraint: c, cycle: [c, ...path], axis: c.kind });
  };
  for (const p of pieces) {
    if (p.dir === 'h') Y.union(p.a, p.b, 0, `s${p.idx}`, 1e9);
    else if (p.dir === 'v') X.union(p.a, p.b, 0, `s${p.idx}`, 1e9);
  }
  const prio = { user: 0, label: 1, opening: 1, room: 2, dimension: 3, text: 4 };
  const ordered = C.slice().sort((a, b) => (prio[a.src.type] ?? 5) - (prio[b.src.type] ?? 5));
  for (const c of ordered) {
    if (c.kind === 'x') { const r = X.union(c.a, c.b, c.sign * c.value, c.cid, tolOf(c.value)); if (r) reportConflict(c, r); }
    else if (c.kind === 'y') { const r = Y.union(c.a, c.b, c.sign * c.value, c.cid, tolOf(c.value)); if (r) reportConflict(c, r); }
  }
  const lenCs = C.filter((c) => c.kind === 'len');
  const cyc = (U, c) => U.path(c.a, c.b).map((cid) => byCid.get(cid)).filter((x) => x && x !== c);
  const obliquePass = () => {
    let changed = true, any = false;
    while (changed) {
      changed = false;
      for (const c of lenCs) {
        if (c.done) continue;
        const A = nodes[c.a], B = nodes[c.b];
        const sx = Math.sign(B.x - A.x) || 1, sy = Math.sign(B.y - A.y) || 1;
        const kx = X.same(c.a, c.b), ky = Y.same(c.a, c.b);
        const L = c.value;
        if (kx && ky) {
          const got = Math.hypot(X.delta(c.a, c.b), Y.delta(c.a, c.b));
          if (Math.abs(got - L) > tolOf(L)) conflicts.push({ cid: c.cid, key: c.key, diff: got - L, constraint: c, cycle: [c, ...cyc(X, c), ...cyc(Y, c)], axis: 'len' });
          c.done = true; continue;
        }
        if (kx) {
          const dx = X.delta(c.a, c.b); const d2 = L * L - dx * dx;
          if (d2 < -1e-6) { conflicts.push({ cid: c.cid, key: c.key, diff: Math.abs(dx) - L, constraint: c, cycle: [c, ...cyc(X, c)], axis: 'len' }); c.done = true; continue; }
          Y.union(c.a, c.b, sy * Math.sqrt(Math.max(0, d2)), c.cid, 1e9); c.done = true; changed = any = true; continue;
        }
        if (ky) {
          const dy = Y.delta(c.a, c.b); const d2 = L * L - dy * dy;
          if (d2 < -1e-6) { conflicts.push({ cid: c.cid, key: c.key, diff: Math.abs(dy) - L, constraint: c, cycle: [c, ...cyc(Y, c)], axis: 'len' }); c.done = true; continue; }
          X.union(c.a, c.b, sx * Math.sqrt(Math.max(0, d2)), c.cid, 1e9); c.done = true; changed = any = true; continue;
        }
        if (c.angle != null) {
          const th = Math.abs(c.angle) * DEG;
          X.union(c.a, c.b, sx * L * Math.abs(Math.cos(th)), c.cid, 1e9);
          Y.union(c.a, c.b, sy * L * Math.abs(Math.sin(th)), c.cid, 1e9);
          c.done = true; changed = any = true;
        }
      }
    }
    return any;
  };
  obliquePass();
  let assumptions = 0;
  if (O.assumeAlign) {
    const used = adj.map((l) => l.length > 0);
    const alignAxis = (U, coord) => {
      const idx = nodes.map((_, i) => i).filter((i) => used[i]).sort((a, b) => nodes[a][coord] - nodes[b][coord]);
      for (let k = 1; k < idx.length; k++) {
        const i = idx[k - 1], j = idx[k];
        if (Math.abs(nodes[j][coord] - nodes[i][coord]) < tol * 0.6 && !U.same(i, j)) { U.union(i, j, 0, `align`, 1e9); assumptions++; }
      }
    };
    alignAxis(X, 'x'); alignAxis(Y, 'y');
    obliquePass();
  }
  res.issues.assumptions = assumptions;
  res.issues.conflicts = dedupeConflicts(conflicts);

  // ---------- 8. missing measures ----------
  const usedNodes = nodes.map((_, i) => i).filter((i) => adj[i].length);
  const missing = [];
  const findMissing = (U, axis) => {
    const roots = new Set(usedNodes.map((i) => U.find(i)));
    if (roots.size <= 1) return;
    // union-find over components for Kruskal
    const comp = new Map([...roots].map((r) => [r, r]));
    const cf = (r) => { while (comp.get(r) !== r) r = comp.get(r); return r; };
    // slanted walls with a known length are linked as soon as their angle is given (asked below)
    for (const c of lenCs) {
      if (c.done) continue;
      const ra = U.find(c.a), rb = U.find(c.b);
      if (comp.has(ra) && comp.has(rb) && cf(ra) !== cf(rb)) comp.set(cf(rb), cf(ra));
    }
    const cands = [];
    for (const p of pieces) {
      if (p.dir === (axis === 'x' ? 'v' : 'h')) continue;
      const ra = U.find(p.a), rb = U.find(p.b); if (ra === rb) continue;
      cands.push({ p, ra, rb, cost: (p.exterior ? 0 : 1) + (p.bridge ? 2 : 0) + (p.dir === 'o' ? 0.5 : 0) - Math.min(0.9, dist(nodes[p.a], nodes[p.b]) / diag) });
    }
    cands.sort((a, b) => a.cost - b.cost);
    for (const c of cands) {
      const A = cf(c.ra), B = cf(c.rb); if (A === B) continue;
      comp.set(B, A);
      const kind = c.p.dir === 'o' ? 'len' : axis;
      missing.push(mkMissing(c.p.a, c.p.b, kind, c.p.idx));
    }
    // components not linkable by a wall: ask a free distance between the closest nodes
    const groups = new Map();
    for (const i of usedNodes) { const g = cf(U.find(i)); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
    const keys = [...groups.keys()];
    for (let k = 1; k < keys.length; k++) {
      const g0 = groups.get(keys[0]), g1 = groups.get(keys[k]);
      let best = null;
      for (const i of g0) for (const j of g1) {
        const off = axis === 'x' ? Math.abs(nodes[i].y - nodes[j].y) : Math.abs(nodes[i].x - nodes[j].x);
        const s = off + 0.1 * dist(nodes[i], nodes[j]);
        if (!best || s < best.s) best = { i, j, s };
      }
      if (best) missing.push(mkMissing(best.i, best.j, axis, null, true));
    }
  };
  const mkMissing = (a, b, kind, pieceIdx, free = false) => {
    const A = nodes[a], B = nodes[b];
    const est = kind === 'x' ? Math.abs(B.x - A.x) * scale : kind === 'y' ? Math.abs(B.y - A.y) * scale : dist(A, B) * scale;
    // estimate in the user's chosen mode (net subtracts the half thicknesses again)
    const dirv = norm(sub(B, A));
    const adjust = O.mode === 'net' ? halfPerp(a, kind === 'x' ? { x: 1, y: 0 } : kind === 'y' ? { x: 0, y: 1 } : dirv) + halfPerp(b, kind === 'x' ? { x: 1, y: 0 } : kind === 'y' ? { x: 0, y: 1 } : dirv) : 0;
    return { key: pairKey(A, B, kind), kind, a, b, pa: { ...A }, pb: { ...B }, piece: pieceIdx, free, estimate: Math.max(0.01, est - adjust), axisEstimate: est, tiny: est - adjust < 0.02, exterior: pieceIdx != null ? pieces[pieceIdx].exterior : false };
  };
  findMissing(X, 'x'); findMissing(Y, 'y');
  for (const c of lenCs) if (!c.done) {
    const A = nodes[c.a], B = nodes[c.b];
    const ang = Math.atan2(Math.abs(B.y - A.y), Math.abs(B.x - A.x)) / DEG;
    missing.push({ key: c.key, kind: 'angle', a: c.a, b: c.b, pa: { ...A }, pb: { ...B }, estimate: Math.round(ang * 10) / 10, constraint: c.cid });
  }
  // dedupe (same pair could be asked for x and len)
  const seen = new Set();
  res.issues.missing = missing.filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));

  // ---------- 9. positions ----------
  const place = (U, coord) => {
    const groups = new Map();
    nodes.forEach((N, i) => { const r = U.find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    const pos = new Float64Array(nodes.length);
    for (const [r, members] of groups) {
      let sd = 0, so = 0; for (const i of members) { sd += nodes[i][coord]; so += U.o[i]; }
      const base = (sd / members.length) * scale - so / members.length;
      for (const i of members) pos[i] = base + U.o[i];
      void r;
    }
    return { pos, comps: [...groups.values()].filter((g) => g.some((i) => adj[i].length)).length };
  };
  const px = place(X, 'x'), py = place(Y, 'y');
  const estimatedAxes = (px.comps > 1 ? 1 : 0) + (py.comps > 1 ? 1 : 0) + lenCs.filter((c) => !c.done).length;
  res.complete = res.issues.missing.length === 0;
  res.issues.estimated = estimatedAxes;
  let mx = Infinity, my = Infinity;
  usedNodes.forEach((i) => { mx = Math.min(mx, px.pos[i]); my = Math.min(my, py.pos[i]); });
  const M = nodes.map((_, i) => ({ x: px.pos[i] - mx, y: py.pos[i] - my }));
  res.positions = M;

  // affine px → m (for items, labels, openings far from walls)
  const fit = (coord, P) => {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const i of usedNodes) { const a = nodes[i][coord], b = P[i][coord]; n++; sx += a; sy += b; sxx += a * a; sxy += a * b; }
    const den = n * sxx - sx * sx; const k = Math.abs(den) < 1e-9 ? scale : (n * sxy - sx * sy) / den;
    return { k, c: (sy - k * sx) / Math.max(1, n) };
  };
  const fx = fit('x', M), fy = fit('y', M);
  const toM = (p) => ({ x: fx.k * p.x + fx.c, y: fy.k * p.y + fy.c });
  const sAvg = (Math.abs(fx.k) + Math.abs(fy.k)) / 2;
  res.transform = { fx, fy, sAvg };

  // ---------- 10. preview statuses ----------
  const measuredPieces = new Set(); C.forEach((c) => c.pieces.forEach((i) => measuredPieces.add(i)));
  const conflictPieces = new Set();
  for (const cf of res.issues.conflicts) for (const c of cf.cycle) (c.pieces.length ? c.pieces : piecesBetween(c.a, c.b)).forEach((i) => conflictPieces.add(i));
  function piecesBetween(a, b) { return pieces.filter((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)).map((p) => p.idx); }
  const missingPieces = new Map(); res.issues.missing.forEach((m, k) => { if (m.piece != null) missingPieces.set(m.piece, k); });
  res.preview.nodes = nodes;
  res.preview.pieces = pieces.map((p) => {
    const sameX = X.same(p.a, p.b), sameY = Y.same(p.a, p.b);
    let status = missingPieces.has(p.idx) ? 'missing' : conflictPieces.has(p.idx) ? 'conflict' : measuredPieces.has(p.idx) ? 'measured' : sameX && sameY ? 'derived' : 'estimated';
    return { idx: p.idx, key: pieceKey(nodes[p.a], nodes[p.b]), a: nodes[p.a], b: nodes[p.b], status, len: dist(M[p.a], M[p.b]), exterior: p.exterior, bridge: p.bridge, missingIndex: missingPieces.get(p.idx) };
  });

  // ---------- 11. geometry in metres ----------
  buildGeometry(res, { raw, nodes, M, pieces, toM, sAvg, O, gapElems, segs });
  return res;
}

function fmtSrc(v) { return (Math.round(v * 100) / 100).toString(); }

function matchWxd(wxd, L01, L12) {
  const [a, b] = wxd;
  if (Math.abs(a - b) < 1e-9) return [a, b, false];
  const drawnWide = L01 >= L12, labelWide = a >= b;
  if (drawnWide === labelWide) return [a, b, false];
  const r1v = Math.max(L01, L12) / Math.max(1e-9, Math.min(L01, L12));
  return r1v > 1.15 ? [b, a, true] : [a, b, false];
}

function nearestNode(nodes, p, maxD) {
  let best = null, bd = maxD;
  nodes.forEach((N, i) => { const d = dist(N, p); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** If a face loop is an axis-aligned rectangle (ignoring collinear intermediate nodes), return its 4 corner nodes TL,TR,BR,BL. */
function rectCorners(loop, nodes) {
  const pts = loop.map((i) => nodes[i]);
  const corners = [];
  for (let k = 0; k < loop.length; k++) {
    const a = pts[(k - 1 + pts.length) % pts.length], b = pts[k], c = pts[(k + 1) % pts.length];
    const u = norm(sub(b, a)), w = norm(sub(c, b));
    if (Math.abs(cross(u, w)) > 0.5) corners.push(loop[k]);
  }
  if (corners.length !== 4) return null;
  const cp = corners.map((i) => nodes[i]);
  const cx = cp.reduce((s, p) => s + p.x, 0) / 4, cy = cp.reduce((s, p) => s + p.y, 0) / 4;
  const tl = corners.find((i) => nodes[i].x < cx && nodes[i].y < cy);
  const tr = corners.find((i) => nodes[i].x > cx && nodes[i].y < cy);
  const br = corners.find((i) => nodes[i].x > cx && nodes[i].y > cy);
  const bl = corners.find((i) => nodes[i].x < cx && nodes[i].y > cy);
  if ([tl, tr, br, bl].some((v) => v == null)) return null;
  return [tl, tr, br, bl];
}

function dedupeConflicts(list) {
  const out = []; const seen = new Set();
  for (const c of list) {
    const k = c.cycle.map((x) => x.cid).sort().join(',');
    if (seen.has(k)) continue; seen.add(k); out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometry in metres: walls (merged), openings, rooms, items.
function buildGeometry(res, { raw, nodes, M, pieces, toM, sAvg, O, gapElems }) {
  const nid = (i) => `n${i}`;
  const used = new Set(); pieces.forEach((p) => { used.add(p.a); used.add(p.b); });
  let walls = pieces.map((p) => ({
    id: `w${p.idx}`, a: p.a, b: p.b, thickness: Math.round(p.thk * 1000) / 1000, height: p.h, exterior: p.exterior,
    src: [...new Set(p.segs)], bridge: p.bridge || null, ownData: p.own.map((s) => ({ data: s.data, a: toM(s.a), b: toM(s.b) })),
  })).filter((w) => dist(M[w.a], M[w.b]) > 0.005);

  // Openings as absolute points in metres
  const openings = [];
  for (const E of gapElems) {
    if (!E.isOpening) continue;
    let pc = E.bridgePiece != null ? pieces[E.bridgePiece] : null;
    if (!pc) {
      let best = null; const ext = Math.max(...E.corners.map((p) => dist(p, E.center))) * 1.3 + 4;
      for (const p of pieces) {
        const A = nodes[p.a], B = nodes[p.b]; const t = projT(E.center, A, B);
        if (t < -0.02 || t > 1.02) continue;
        if (E.axis && Math.abs(cross(norm(sub(B, A)), E.axis)) > Math.sin(25 * DEG)) continue;
        const d = distPointSeg(E.center, A, B);
        if (d < ext && (!best || d < best.d)) best = { p, d };
      }
      pc = best?.p;
    }
    if (!pc) { res.issues.notes.push({ code: 'openingOrphan', cellId: E.cellId }); continue; }
    const A = nodes[pc.a], B = nodes[pc.b];
    const ts = E.corners.map((p) => projT(p, A, B));
    let t0 = clamp(Math.min(...ts), 0, 1), t1 = clamp(Math.max(...ts), 0, 1);
    if (E.bridgePiece != null) { t0 = 0; t1 = 1; }
    const MA = M[pc.a], MB = M[pc.b]; const L = dist(MA, MB);
    let width = (t1 - t0) * L;
    if (E.measure && E.bridgePiece == null) { const tc = (t0 + t1) / 2; width = E.measure; t0 = tc - width / 2 / L; t1 = tc + width / 2 / L; }
    const p0 = lerpP(MA, MB, clamp(t0, 0, 1)), p1 = lerpP(MA, MB, clamp(t1, 0, 1));
    const side = Math.sign(cross(sub(B, A), sub(E.center, A))) || 1;
    const own = E.own ? E.params : {};
    const kind = E.kind;
    const def = kind === 'door' ? { height: O.doorHeight } : kind === 'window' ? { height: O.windowHeight, sill: O.windowSill } : { height: O.openingHeight };
    openings.push({
      type: kind, p0, p1, sidePoint: add(lerpP(MA, MB, (t0 + t1) / 2), mul(norm(perpOf(sub(MB, MA))), side * 0.5)),
      height: E.height ?? own.height ?? E.params.height ?? def.height,
      sill: kind === 'window' ? (E.sill ?? own.sill ?? E.params.sill ?? def.sill) : 0,
      style: own.style || E.params.style || (kind === 'door' ? 'single' : kind === 'window' ? 'double' : 'none'),
      hinge: own.hinge || (E.params.hinge === 'right' ? (E.flipH ? 'start' : 'end') : (E.flipH ? 'end' : 'start')),
      frameColor: own.frameColor, cellId: E.cellId, openSide: own.openSide,
    });
  }

  // Merge collinear chains through degree-2 nodes
  const merged = mergeCollinear(walls, M);
  walls = merged;

  // Final node list (only used nodes)
  const keep = new Set(); walls.forEach((w) => { keep.add(w.a); keep.add(w.b); });
  res.nodes = [...keep].map((i) => ({ id: nid(i), x: round4(M[i].x), y: round4(M[i].y) }));
  const P = (i) => M[i];
  res.walls = walls.map((w) => ({ id: w.id, a: nid(w.a), b: nid(w.b), thickness: w.thickness, height: w.height ?? null, exterior: w.exterior, openings: [], decor: [], colorL: null, colorR: null, src: w.src }));
  const wById = new Map(res.walls.map((w, k) => [w.id, { w, raw: walls[k] }]));

  // assign openings to walls
  for (const o of openings) {
    const c = { x: (o.p0.x + o.p1.x) / 2, y: (o.p0.y + o.p1.y) / 2 };
    const hit = nearestWall(walls, P, c);
    if (!hit) continue;
    const { w } = wById.get(hit.id);
    const A = P(hit.a), B = P(hit.b), L = dist(A, B);
    const s0 = projT(o.p0, A, B) * L, s1 = projT(o.p1, A, B) * L;
    const off = clamp(Math.min(s0, s1), 0, L), width = Math.min(Math.abs(s1 - s0), L - off);
    const side = Math.sign(cross(sub(B, A), sub(o.sidePoint, A))) || 1;
    w.openings.push({
      id: `o${w.openings.length}_${w.id}`, type: o.type, offset: round4(off), width: round4(Math.max(0.3, width)), height: o.height, sill: o.sill,
      style: o.style, hinge: s1 >= s0 ? o.hinge : (o.hinge === 'start' ? 'end' : 'start'), side: o.openSide ?? side, frameColor: o.frameColor || null,
    });
  }
  // decor & colours from own (round-trip) data
  for (const rw of walls) {
    for (const od of rw.ownData || []) {
      const d = od.data || {};
      for (const dc of d.decor || []) {
        const segDir = norm(sub(od.b, od.a));
        const pc = add(od.a, mul(segDir, (dc.offset || 0) + (dc.width || 0) / 2));
        const hit = nearestWall(walls, P, pc); if (!hit) continue;
        const { w } = wById.get(hit.id);
        const A = P(hit.a), B = P(hit.b); const L = dist(A, B);
        const same = dot(norm(sub(B, A)), segDir) > 0;
        const center = projT(pc, A, B) * L;
        w.decor.push({ ...dc, id: dc.id || `d${w.decor.length}_${w.id}`, offset: round4(clamp(center - (dc.width || 0) / 2, 0, L)), side: same ? dc.side : -dc.side });
      }
      const hit = rw;
      const { w } = wById.get(hit.id);
      const same = dot(norm(sub(P(hit.b), P(hit.a))), norm(sub(od.b, od.a))) > 0;
      if (d.colorL) w[same ? 'colorL' : 'colorR'] = d.colorL;
      if (d.colorR) w[same ? 'colorR' : 'colorL'] = d.colorR;
    }
  }

  // rooms: faces of the metre graph
  const idxs = [...keep];
  const local = new Map(idxs.map((v, k) => [v, k]));
  const fpts = idxs.map((i) => M[i]);
  const { faces } = planarFaces(fpts, walls.map((w) => [local.get(w.a), local.get(w.b)]));
  const roomShapes = (raw.rooms || []).map((r) => ({ c: toM(polyCentroid(r.poly)), r }));
  const labels = (raw.labels || []).filter((l) => l.parsed?.name || l.own).map((l) => ({ c: toM(l.pos), l }));
  let n = 0;
  res.rooms = [];
  for (const f of faces) {
    if (f.outer) continue;
    const loop = cleanFaceLoop(f.nodes);
    if (loop.length < 3) continue;
    const poly = loop.map((k) => fpts[k]);
    const area = Math.abs(polyAreaM(poly));
    if (area < 0.05) continue;
    const shape = roomShapes.find((s) => pointInPoly(s.c, poly));
    const label = labels.find((s) => pointInPoly(s.c, poly));
    n++;
    const own = label?.l.own || shape?.r.data || {};
    const name = shape?.r.name || label?.l.parsed?.name || own.name || '';
    res.rooms.push({
      id: `r${n}`, name, anchor: polyCentroidM(poly), height: shape?.r.height ?? label?.l.parsed?.height ?? own.height ?? null,
      floor: own.floor || null, wallColor: own.wallColor || null, auto: !name,
    });
  }

  // items
  res.items = (raw.items || []).map((it, k) => {
    const c = toM(it.center);
    const own = it.own ? it.params : {};
    return {
      id: `i${k}`, kind: it.kind, model: own.model || (it.kind === 'column' ? 'column' : it.kind === 'stairs' ? 'stairs' : it.params.model || 'box'),
      name: own.name || it.name || '', x: round4(c.x), y: round4(c.y), rot: own.rot ?? it.rot ?? 0,
      w: round4(own.w ?? it.w * sAvg), d: round4(own.d ?? it.d * sAvg), h: own.h ?? it.height ?? it.params.height ?? null,
      elevation: own.elevation ?? it.params.elevation ?? 0, color: own.color ?? it.params.color ?? null, params: own.params || {},
    };
  });
}

function perpOf(v) { return { x: -v.y, y: v.x }; }
const round4 = (v) => Math.round(v * 10000) / 10000;
function polyAreaM(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; }
function polyCentroidM(p) { return polyCentroid(p); }

function nearestWall(walls, P, c) {
  let best = null;
  for (const w of walls) {
    const A = P(w.a), B = P(w.b); const t = projT(c, A, B);
    if (t < -0.01 || t > 1.01) continue;
    const d = distPointSeg(c, A, B);
    if (d < Math.max(0.25, w.thickness) && (!best || d < best.d)) best = { w, d };
  }
  return best?.w || null;
}

function mergeCollinear(walls, M) {
  let list = walls.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const inc = new Map();
    list.forEach((w) => { for (const n of [w.a, w.b]) { if (!inc.has(n)) inc.set(n, []); inc.get(n).push(w); } });
    for (const [n, ws] of inc) {
      if (ws.length !== 2) continue;
      const [w1, w2] = ws;
      if (Math.abs(w1.thickness - w2.thickness) > 0.002 || (w1.height ?? -1) !== (w2.height ?? -1)) continue;
      const o1 = w1.a === n ? w1.b : w1.a, o2 = w2.a === n ? w2.b : w2.a;
      if (o1 === o2) continue;
      const d1 = norm(sub(M[n], M[o1])), d2 = norm(sub(M[o2], M[n]));
      if (Math.abs(cross(d1, d2)) > Math.sin(0.5 * DEG) || dot(d1, d2) < 0) continue;
      const nw = {
        id: w1.id, a: o1, b: o2, thickness: w1.thickness, height: w1.height, exterior: w1.exterior || w2.exterior,
        src: [...new Set([...(w1.src || []), ...(w2.src || [])])], bridge: null, ownData: [...(w1.ownData || []), ...(w2.ownData || [])],
      };
      list = list.filter((w) => w !== w1 && w !== w2); list.push(nw);
      changed = true; break;
    }
  }
  return list;
}
