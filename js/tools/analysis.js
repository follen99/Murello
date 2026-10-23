// Spatial analysis shared by the 2D/3D views and the auto-furnish worker (pure JS, no DOM).
// Collisions, clearances ("quote automatiche"), door swing zones, snapping, walkability grid.
import { obbCorners, satDepth, sub, add, mul, norm, perp, dot, dist, raySeg, pointInPoly, polyBBox, distPointSeg, cross } from '../core/geom.js';
import { getModel, itemDims, resolveParts, partsTop } from '../furniture/models.js';

const DEG = Math.PI / 180;

/** Footprint & vertical extent of an item. */
export function footprint(item, H = 2.7) {
  const dims = itemDims(item, H);
  const model = getModel(item.model);
  let top = dims.h;
  try { top = partsTop(resolveParts(model, dims, H)) || dims.h; } catch { /* keep h */ }
  const rot = (item.rot || 0) * DEG;
  const corners = obbCorners(item.x, item.y, dims.w, dims.d, rot);
  const z0 = item.elevation || 0;
  const tags = model.tags || [];
  return { id: item.id, item, corners, w: dims.w, d: dims.d, h: dims.h, z0, z1: z0 + top, rot, tags, flat: tags.includes('flat'), model };
}

/** Quarter-circle swing area of every door (plan polygons), with the wall side it opens into. */
export function doorSwings(der) {
  const out = [];
  for (const x of der.walls) for (const o of x.w.openings || []) {
    if (o.type !== 'door' || o.style === 'sliding' || o.style === 'none' || o.style === 'garage') continue;
    const side = o.side || 1;
    const leaves = o.style === 'double' ? 2 : 1;
    for (let k = 0; k < leaves; k++) {
      const hingeStart = leaves === 2 ? k === 0 : o.hinge !== 'end';
      const lw = o.width / leaves;
      const hingeU = hingeStart ? o.offset : o.offset + o.width;
      const face = mul(x.n, side * x.t / 2);
      const hinge = add(add(x.A, mul(x.dir, hingeU)), face);
      const along = mul(x.dir, hingeStart ? 1 : -1), out_ = mul(x.n, side);
      const poly = [hinge];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; poly.push(add(hinge, add(mul(along, Math.cos(a) * lw), mul(out_, Math.sin(a) * lw)))); }
      out.push({ poly, hinge, radius: lw, wallId: x.id, openingId: o.id, along, out: out_ });
    }
  }
  return out;
}

/** Clear zone in front of every door/opening (both sides), depth = min passage. */
export function openingZones(der, depth = 0.6) {
  const out = [];
  for (const x of der.walls) for (const o of x.w.openings || []) {
    if (o.type === 'window') continue;
    for (const s of [1, -1]) {
      const a = add(add(x.A, mul(x.dir, o.offset)), mul(x.n, s * x.t / 2));
      const b = add(a, mul(x.dir, o.width));
      const n = mul(x.n, s * depth);
      out.push({ poly: [a, b, add(b, n), add(a, n)], wallId: x.id, openingId: o.id, side: s });
    }
  }
  return out;
}

/** Wall polygons from derived data. */
export function wallPolys(der) {
  return der.walls.filter((x) => x.sL && x.eL).map((x) => ({ id: x.id, poly: [x.sR, x.eR, x.eL, x.sL], x }));
}

function overlapZ(a, b) { return Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.01; }

/**
 * Collision report.
 * @returns {Map<string, {level:'error'|'warn', reasons:{code:string, other?:string}[]}>}
 */
export function collisions(floor, der, opts = {}) {
  const H = floor.height || 2.7;
  const fps = floor.items.map((i) => footprint(i, H));
  const res = new Map();
  const add_ = (id, level, code, other) => {
    const r = res.get(id) || { level: 'warn', reasons: [] };
    if (level === 'error') r.level = 'error';
    r.reasons.push({ code, other });
    res.set(id, r);
  };
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) {
    const a = fps[i], b = fps[j];
    if (a.flat || b.flat) continue;
    if (!overlapZ(a, b)) continue;
    const depth = satDepth(a.corners, b.corners);
    if (depth <= 0.005) continue;
    // chairs slide under tables and desks: tolerate a partial overlap with their partner
    const tucked = (p, q) => { const r = p.model.rel; return r && (r.type === 'around' || r.type === 'front') && q.item.model.startsWith(r.target); };
    if ((tucked(a, b) || tucked(b, a)) && depth < 0.3) continue;
    add_(a.id, 'error', 'overlap', b.id); add_(b.id, 'error', 'overlap', a.id);
  }
  const walls = wallPolys(der);
  for (const a of fps) {
    if (a.tags.includes('structural')) continue;
    for (const w of walls) if (satDepth(a.corners, w.poly) > 0.008) { add_(a.id, 'error', 'wall', w.id); break; }
  }
  const swings = doorSwings(der);
  for (const a of fps) {
    if (a.flat || a.z0 > 2.0) continue;
    for (const s of swings) if (polyOverlap(a.corners, s.poly)) { add_(a.id, 'warn', 'door', s.openingId); break; }
  }
  if (opts.windows !== false) {
    for (const x of der.walls) for (const o of x.w.openings || []) {
      if (o.type !== 'window') continue;
      for (const s of [1, -1]) {
        const a0 = add(add(x.A, mul(x.dir, o.offset)), mul(x.n, s * x.t / 2));
        const zone = [a0, add(a0, mul(x.dir, o.width)), add(add(a0, mul(x.dir, o.width)), mul(x.n, s * 0.25)), add(a0, mul(x.n, s * 0.25))];
        for (const a of fps) if (!a.flat && a.z1 > (o.sill || 0) + 0.05 && a.z0 < (o.sill || 0) + o.height && polyOverlap(a.corners, zone)) add_(a.id, 'warn', 'window', o.id);
      }
    }
  }
  if (der.rooms.length) {
    for (const a of fps) {
      const c = { x: a.item.x, y: a.item.y };
      if (!der.rooms.some((r) => pointInPoly(c, r.poly))) add_(a.id, 'warn', 'outside');
    }
  }
  return res;
}

/** Concave-safe polygon overlap: SAT on the convex item vs every triangle of a fan (good enough for door sectors). */
export function polyOverlap(convexA, poly) {
  if (poly.length <= 4) return satDepth(convexA, poly) > 0.005;
  for (let i = 1; i < poly.length - 1; i++) if (satDepth(convexA, [poly[0], poly[i], poly[i + 1]]) > 0.005) return true;
  return false;
}

/**
 * Distances from each side of an item to the nearest obstacle (wall face or other item).
 * @returns {{side:string, from:{x,y}, to:{x,y}, d:number}[]}
 */
export function clearances(floor, der, item, maxDist = 4) {
  const H = floor.height || 2.7;
  const fp = footprint(item, H);
  const segs = [];
  for (const w of wallPolys(der)) for (let i = 0; i < 4; i++) segs.push([w.poly[i], w.poly[(i + 1) % 4]]);
  for (const other of floor.items) {
    if (other.id === item.id) continue;
    const o = footprint(other, H);
    if (o.flat || !overlapZ(fp, o) && !(o.z0 < 1.0 && fp.z0 < 1.0)) continue;
    for (let i = 0; i < 4; i++) segs.push([o.corners[i], o.corners[(i + 1) % 4]]);
  }
  const [bl, br, fr, fl] = fp.corners;
  const sides = [
    { side: 'back', a: bl, b: br }, { side: 'right', a: br, b: fr }, { side: 'front', a: fr, b: fl }, { side: 'left', a: fl, b: bl },
  ];
  const c = { x: item.x, y: item.y };
  const out = [];
  for (const s of sides) {
    const m = mul(add(s.a, s.b), 0.5);
    let n = norm(perp(sub(s.b, s.a)));
    if (dot(n, sub(m, c)) < 0) n = mul(n, -1);
    let best = null;
    for (const t of [0.15, 0.5, 0.85]) {
      const o = add(s.a, mul(sub(s.b, s.a), t));
      const o2 = add(o, mul(n, 0.001));
      for (const [p, q] of segs) {
        const d = raySeg(o2, n, p, q);
        if (d < maxDist && (!best || d < best.d)) best = { d, from: o, to: add(o2, mul(n, d)) };
      }
    }
    if (best) out.push({ side: s.side, ...best });
  }
  return out;
}

/** Snap position/rotation of an item being moved. Returns {x, y, rot, snapped: [...]}. */
export function snapItem(floor, der, item, x, y, rot, opts = {}) {
  const grid = opts.grid ?? 0.05;
  const snapDist = opts.snapDist ?? 0.15;
  let r = rot;
  const snapped = [];
  const H = floor.height || 2.7;
  const dims = itemDims(item, H);
  // rotation: align with the nearest wall direction when close
  if (opts.walls !== false) {
    let bestDir = null;
    for (const w of der.walls) {
      const p = { x, y };
      if (distPointSeg(p, w.A, w.B) > Math.max(dims.w, dims.d) + 0.5) continue;
      const wa = Math.atan2(w.dir.y, w.dir.x) / DEG;
      const diff = ((r - wa) % 90 + 135) % 90 - 45;
      if (Math.abs(diff) < 6 && (!bestDir || Math.abs(diff) < Math.abs(bestDir))) bestDir = diff;
    }
    if (bestDir != null) r -= bestDir;
  }
  let px = x, py = y;
  if (grid > 0) { px = Math.round(px / grid) * grid; py = Math.round(py / grid) * grid; }
  if (opts.walls !== false) {
    // translate so that the nearest item side touches a wall face
    const faces = [];
    for (const w of der.walls) for (const s of [1, -1]) {
      const off = mul(w.n, s * w.t / 2);
      faces.push({ a: add(w.A, off), b: add(w.B, off), n: mul(w.n, s), w });
    }
    const corners = obbCorners(px, py, dims.w, dims.d, r * DEG);
    const sides = [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]]];
    const c = { x: px, y: py };
    let best = null;
    for (const [a, b] of sides) {
      const m = mul(add(a, b), 0.5); let sn = norm(perp(sub(b, a))); if (dot(sn, sub(m, c)) < 0) sn = mul(sn, -1);
      for (const f of faces) {
        if (dot(sn, f.n) > -0.985) continue; // side must face the wall
        const dd = dot(sub(m, f.a), f.n); // distance of side from face (positive = in front of face)
        if (dd < -0.05 || dd > snapDist) continue;
        const t = dot(sub(m, f.a), norm(sub(f.b, f.a))) / dist(f.a, f.b);
        if (t < -0.2 || t > 1.2) continue;
        if (!best || Math.abs(dd) < Math.abs(best.dd)) best = { dd, n: f.n, f };
      }
    }
    if (best) { px -= best.n.x * (best.dd - 0.002); py -= best.n.y * (best.dd - 0.002); snapped.push({ type: 'wall', wallId: best.f.w.id }); }
  }
  return { x: px, y: py, rot: ((r % 360) + 360) % 360, snapped };
}

/**
 * Walkability grid of a room: free cells, distance to obstacles and cells reachable from doors
 * with a body of diameter `minPassage`.
 */
export function walkGrid(floor, der, room, { cell = 0.1, minPassage = 0.6, items = floor.items, extra = [] } = {}) {
  const H = floor.height || 2.7;
  const bb = polyBBox(room.poly);
  const nx = Math.max(1, Math.ceil(bb.w / cell)), ny = Math.max(1, Math.ceil(bb.h / cell));
  const N = nx * ny;
  const inside = new Uint8Array(N), free = new Uint8Array(N);
  const blockers = [];
  for (const it of items) { const f = footprint(it, H); if (!f.flat && f.z0 < 1.2) blockers.push(f.corners); }
  for (const c of extra) blockers.push(c);
  const wp = wallPolys(der).map((w) => w.poly);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = { x: bb.minX + (i + 0.5) * cell, y: bb.minY + (j + 0.5) * cell };
    const k = j * nx + i;
    if (!pointInPoly(p, room.poly)) continue;
    inside[k] = 1;
    let blocked = false;
    for (const poly of wp) if (pointInPoly(p, poly)) { blocked = true; break; }
    if (!blocked) for (const poly of blockers) if (pointInPoly(p, poly)) { blocked = true; break; }
    free[k] = blocked ? 0 : 1;
  }
  // distance transform (chamfer 3-4) in cell units to nearest non-free cell
  const INF = 1e9; const dt = new Float32Array(N);
  for (let k = 0; k < N; k++) dt[k] = free[k] ? INF : 0;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : dt[j * nx + i]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!dt[k]) continue; dt[k] = Math.min(dt[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + 1.414, at(i + 1, j - 1) + 1.414); }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (!dt[k]) continue; dt[k] = Math.min(dt[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + 1.414, at(i - 1, j + 1) + 1.414); }
  // reachable from doors with clearance radius
  const rad = minPassage / 2 / cell;
  const ok = (k) => free[k] && dt[k] * 1 >= rad - 0.5;
  const reach = new Uint8Array(N); const q = [];
  const seeds = [];
  for (const x of der.walls) for (const o of x.w.openings || []) {
    if (o.type === 'window') continue;
    for (const s of [1, -1]) {
      const p = add(add(add(x.A, mul(x.dir, o.offset + o.width / 2)), mul(x.n, s * (x.t / 2 + 0.15))), { x: 0, y: 0 });
      if (pointInPoly(p, room.poly)) seeds.push(p);
    }
  }
  for (const p of seeds) {
    const i = Math.floor((p.x - bb.minX) / cell), j = Math.floor((p.y - bb.minY) / cell);
    // search nearby ok cell
    for (let r = 0; r < 4; r++) {
      let found = false;
      for (let dj = -r; dj <= r && !found; dj++) for (let di = -r; di <= r && !found; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const k = jj * nx + ii; if (ok(k) && !reach[k]) { reach[k] = 1; q.push(k); found = true; }
      }
      if (found) break;
    }
  }
  while (q.length) {
    const k = q.pop(); const i = k % nx, j = (k / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii; if (!reach[kk] && ok(kk)) { reach[kk] = 1; q.push(kk); }
    }
  }
  // cells covered by the "body" of reachable centres = walkable floor
  const walk = new Uint8Array(N);
  const rr = Math.max(0, Math.floor(rad));
  for (let k = 0; k < N; k++) if (reach[k]) {
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
      if (di * di + dj * dj > rr * rr) continue; const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const kk = jj * nx + ii; if (free[kk]) walk[kk] = 1;
    }
  }
  let nIn = 0, nFree = 0, nWalk = 0, maxDt = 0;
  for (let k = 0; k < N; k++) { if (inside[k]) nIn++; if (free[k]) { nFree++; if (dt[k] < INF && dt[k] > maxDt) maxDt = dt[k]; } if (walk[k]) nWalk++; }
  return { nx, ny, cell, x0: bb.minX, y0: bb.minY, inside, free, dt, reach, walk, seeds: seeds.length, stats: { inside: nIn, free: nFree, walk: nWalk, maxClear: maxDt * cell } };
}

export { cross };
