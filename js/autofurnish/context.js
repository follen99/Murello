// Builds the plain-data scene context for one room (sent to the optimizer worker).
import { derive } from '../model/derive.js';
import { footprint, doorSwings } from '../tools/analysis.js';
import { add, mul, sub, norm, dot, polyArea, polyBBox, polyCentroid, pointInPoly, lineIntersect, dist } from '../core/geom.js';
import { getModel, itemDims } from '../furniture/models.js';

/** Inner (net) polygon of a room: each edge offset inwards by half the thickness of its wall. */
export function innerPolygon(der, room) {
  const ids = room.nodeIds; const n = ids.length;
  const pts = room.poly; const sign = polyArea(pts) > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const x = der.walls.find((q) => (q.w.a === ids[i] && q.w.b === ids[(i + 1) % n]) || (q.w.b === ids[i] && q.w.a === ids[(i + 1) % n]));
    const t = x ? x.t / 2 : 0.05;
    const d = norm(sub(b, a)); const inward = mul({ x: -d.y, y: d.x }, sign);
    lines.push({ p: add(a, mul(inward, t)), d });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i - 1 + n) % n], L1 = lines[i];
    const q = lineIntersect(L0.p, L0.d, L1.p, L1.d);
    out.push(q && dist(q, pts[i]) < 1.5 ? q : L1.p);
  }
  return out;
}

export function buildRoomContext(floor, roomId, { movableIds = null, extraItems = [], minPassage = 0.6 } = {}) {
  const der = derive(floor);
  const room = der.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const inner = innerPolygon(der, room);
  const H = floor.height || 2.7;
  const walls = [];
  const doors = [];
  const windows = [];
  const swings = doorSwings(der);
  for (const x of der.walls) {
    for (const side of [1, -1]) {
      const r = side === 1 ? x.roomL : x.roomR;
      if (!r || r.id !== room.id) continue;
      const off = mul(x.n, side * x.t / 2); const nrm = mul(x.n, side);
      walls.push({ a: add(x.A, off), b: add(x.B, off), normal: nrm });
      for (const o of x.w.openings || []) {
        const a = add(add(x.A, mul(x.dir, o.offset)), off), b = add(a, mul(x.dir, o.width));
        const center = mul(add(a, b), 0.5);
        if (o.type === 'window') windows.push({ a, b, center, width: o.width, normal: nrm, sill: o.sill || 0 });
        else {
          const sw = swings.find((s) => s.openingId === o.id && dot(s.out, nrm) > 0);
          doors.push({ center, width: o.width, swing: sw ? sw.poly : null, zone: [a, b, add(b, mul(nrm, 0.9)), add(a, mul(nrm, 0.9))], inner: add(center, mul(nrm, 0.35)) });
        }
      }
    }
  }
  const items = []; const fixed = [];
  for (const it of floor.items) {
    if (!pointInPoly({ x: it.x, y: it.y }, room.poly)) continue;
    const fp = footprint(it, H);
    const m = getModel(it.model);
    const isMov = movableIds ? movableIds.includes(it.id) : !(m.tags || []).includes('fixed');
    if (isMov) items.push(itemData(it, fp, m, H));
    else fixed.push({ corners: fp.corners, z0: fp.z0, top: fp.z1, flat: fp.flat });
  }
  for (const it of extraItems) {
    const fp = footprint(it, H); const m = getModel(it.model);
    items.push(itemData(it, fp, m, H));
  }
  const bb = polyBBox(inner);
  return {
    ctx: {
      room: { id: room.id, name: room.name, poly: room.poly, inner, area: room.netArea, centroid: polyCentroid(inner), bbox: bb },
      walls, doors, windows, fixed,
    },
    items, room,
  };
}

function itemData(it, fp, m, H) {
  const dims = itemDims(it, H);
  return { id: it.id, model: it.model, name: it.name || '', tags: m.tags || [], rel: m.rel || null, x: it.x, y: it.y, rot: it.rot || 0, w: dims.w, d: dims.d, h: dims.h, z0: fp.z0, top: fp.z1 };
}
