// Derived geometry of a floor (cached by content signature):
// mitred wall outlines, junction hubs, rooms (faces) with areas, which room is on each wall side.
import { sub, add, mul, norm, perp, dist, dot, cross, lineIntersect, pointInPoly, polyArea, polyCentroid, polyBBox, polyPerimeter } from '../core/geom.js';
import { planarFaces, cleanFaceLoop } from './faces.js';

const cache = new Map();

export function floorSignature(floor) {
  return JSON.stringify([floor.height, floor.nodes, floor.walls.map((w) => [w.id, w.a, w.b, w.thickness, w.height]), floor.rooms]);
}

export function derive(floor) {
  const sig = floorSignature(floor);
  const c = cache.get(floor.id);
  if (c && c.sig === sig) return c.data;
  const data = compute(floor);
  cache.set(floor.id, { sig, data });
  return data;
}

function compute(floor) {
  const nodeMap = new Map(floor.nodes.map((n) => [n.id, n]));
  const walls = [];
  for (const w of floor.walls) {
    const A = nodeMap.get(w.a), B = nodeMap.get(w.b);
    if (!A || !B) continue;
    const len = dist(A, B); if (len < 1e-4) continue;
    const dir = norm(sub(B, A)); const n = perp(dir); // n = "left" side normal
    walls.push({ w, id: w.id, A, B, len, dir, n, t: w.thickness || 0.1 });
  }
  const byId = new Map(walls.map((x) => [x.id, x]));
  // ---- junctions: mitre corners ----
  const inc = new Map();
  for (const x of walls) for (const [node, out] of [[x.w.a, x.dir], [x.w.b, mul(x.dir, -1)]]) {
    if (!inc.has(node)) inc.set(node, []);
    inc.get(node).push({ x, out, ang: Math.atan2(out.y, out.x), atStart: node === x.w.a });
  }
  const hubs = [];
  for (const [nodeId, list] of inc) {
    const P = nodeMap.get(nodeId);
    list.sort((a, b) => a.ang - b.ang);
    const k = list.length;
    if (k === 1) {
      const e = list[0]; const nl = perp(e.out);
      setCorner(e, add(P, mul(nl, e.x.t / 2)), add(P, mul(nl, -e.x.t / 2)), true);
      continue;
    }
    const pts = [];
    for (let i = 0; i < k; i++) {
      const e1 = list[i], e2 = list[(i + 1) % k];
      // region between e1 (its left side, ccw) and e2 (its right side)
      const l1 = perp(e1.out), r2 = mul(perp(e2.out), -1);
      const p1 = add(P, mul(l1, e1.x.t / 2)), p2 = add(P, mul(r2, e2.x.t / 2));
      let q = lineIntersect(p1, e1.out, p2, e2.out);
      const maxMiter = Math.max(e1.x.t, e2.x.t) * 2.5;
      if (!q || dist(q, P) > maxMiter || dot(sub(q, P), e1.out) < -maxMiter) q = k === 2 && Math.abs(cross(e1.out, e2.out)) < 1e-6 ? p1 : mid2(p1, p2);
      pts.push(q);
      e1.left = q; e2.right = q;
    }
    for (const e of list) setCorner(e, e.left, e.right, false);
    if (k >= 3) hubs.push({ node: nodeId, poly: pts, h: Math.max(...list.map((e) => wallHeightOf(e.x.w, floor))) });
  }
  function setCorner(e, left, right, cap) {
    // left/right are relative to the outgoing direction at that node
    if (e.atStart) { e.x.sL = left; e.x.sR = right; e.x.capS = cap; }
    else { e.x.eR = left; e.x.eL = right; e.x.capE = cap; }
  }

  // ---- rooms ----
  const ids = [...new Set(walls.flatMap((x) => [x.w.a, x.w.b]))];
  const local = new Map(ids.map((id, i) => [id, i]));
  const pts = ids.map((id) => nodeMap.get(id));
  const { faces } = planarFaces(pts, walls.map((x) => [local.get(x.w.a), local.get(x.w.b)]));
  const rooms = []; const usedAttr = new Set();
  for (const f of faces) {
    if (f.outer) continue;
    const loop = cleanFaceLoop(f.nodes); if (loop.length < 3) continue;
    const poly = loop.map((i) => ({ x: pts[i].x, y: pts[i].y }));
    const area = Math.abs(polyArea(poly)); if (area < 0.05) continue;
    const centroid = polyCentroid(poly);
    let attr = floor.rooms.find((r) => !usedAttr.has(r.id) && r.anchor && pointInPoly(r.anchor, poly));
    if (attr) usedAttr.add(attr.id);
    const virtualId = `auto_${Math.round(centroid.x * 20)}_${Math.round(centroid.y * 20)}`;
    const room = { ...(attr || { id: virtualId, name: '', anchor: centroid, auto: true, virtual: true }), poly, area, centroid, labelPos: labelPoint(poly, centroid), bbox: polyBBox(poly), perimeter: polyPerimeter(poly), nodeIds: loop.map((i) => ids[i]) };
    rooms.push(room);
  }
  // net area ≈ axis area minus half wall thickness along the perimeter
  for (const r of rooms) {
    let loss = 0;
    for (let i = 0; i < r.nodeIds.length; i++) {
      const a = r.nodeIds[i], b = r.nodeIds[(i + 1) % r.nodeIds.length];
      const x = walls.find((q) => (q.w.a === a && q.w.b === b) || (q.w.a === b && q.w.b === a));
      if (x) loss += x.len * x.t / 2;
    }
    r.netArea = Math.max(0, r.area - loss);
  }
  rooms.forEach((r, i) => { if (!r.name) r.displayName = null; r.index = i; });
  // ---- wall sides → rooms ----
  for (const x of walls) {
    const m = add(x.A, mul(x.dir, x.len / 2));
    const pl = add(m, mul(x.n, x.t / 2 + 0.03)), pr = add(m, mul(x.n, -(x.t / 2 + 0.03)));
    x.roomL = rooms.find((r) => pointInPoly(pl, r.poly)) || null;
    x.roomR = rooms.find((r) => pointInPoly(pr, r.poly)) || null;
    x.h = wallHeightOf(x.w, floor, x.roomL, x.roomR);
  }
  for (const hb of hubs) hb.h = Math.max(...(inc.get(hb.node) || []).map((e) => e.x.h || floor.height));
  return { nodeMap, walls, byId, hubs, rooms, bbox: bboxOf(floor.nodes) };
}

function mid2(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

export function wallHeightOf(w, floor, roomL, roomR) {
  if (w.height) return w.height;
  const hs = [roomL?.height, roomR?.height].filter((h) => h > 0);
  return hs.length ? Math.max(...hs) : floor.height || 2.7;
}

function bboxOf(nodes) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 10, maxY: 8, w: 10, h: 8 };
  return polyBBox(nodes);
}

/** A point well inside the polygon for the room label (centroid, or pole-ish fallback). */
function labelPoint(poly, c) {
  if (pointInPoly(c, poly)) return c;
  const bb = polyBBox(poly); let best = null;
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
    const p = { x: bb.minX + (bb.w * i) / 10, y: bb.minY + (bb.h * j) / 10 };
    if (!pointInPoly(p, poly)) continue;
    let d = Infinity; for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; d = Math.min(d, distSeg(p, a, b)); }
    if (!best || d > best.d) best = { p, d };
  }
  return best?.p || c;
}
function distSeg(p, a, b) { const ab = sub(b, a); const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); return dist(p, add(a, mul(ab, t))); }

/** Inner face segments of walls bordering a room (used by tools & auto-furnish). */
export function roomWallFaces(der, room) {
  const out = [];
  for (const x of der.walls) {
    for (const side of ['L', 'R']) {
      const r = side === 'L' ? x.roomL : x.roomR;
      if (!r || r.id !== room.id) continue;
      const s = side === 'L' ? 1 : -1;
      const off = mul(x.n, s * x.t / 2);
      out.push({ a: add(x.A, off), b: add(x.B, off), normal: mul(x.n, s), wall: x, side });
    }
  }
  return out;
}

/** Outline polygon of a wall (4 points) for 2D drawing and collision tests. */
export function wallPolygon(x) {
  return [x.sR, x.eR, x.eL, x.sL].filter(Boolean);
}
