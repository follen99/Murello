// 2D geometry helpers. Points are plain {x, y} objects (plan coordinates, y grows "down" like draw.io).

export const v = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
/** Left normal (counter-clockwise in a y-up frame). */
export const perp = (a) => ({ x: -a.y, y: a.x });
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const angleOf = (a) => Math.atan2(a.y, a.x);
export const rot = (p, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };
export const rotAround = (p, c, ang) => add(c, rot(sub(p, c), ang));

/** Parameter t of the projection of p onto segment ab (unclamped). */
export function projT(p, a, b) {
  const ab = sub(b, a); const l2 = dot(ab, ab);
  return l2 < 1e-12 ? 0 : dot(sub(p, a), ab) / l2;
}
export function closestOnSeg(p, a, b) {
  const t = Math.max(0, Math.min(1, projT(p, a, b)));
  return { p: lerpP(a, b, t), t };
}
export function distPointSeg(p, a, b) { return dist(p, closestOnSeg(p, a, b).p); }
/** Perpendicular distance to the infinite line through a,b. */
export function distPointLine(p, a, b) {
  const ab = sub(b, a); const l = len(ab);
  return l < 1e-12 ? dist(p, a) : Math.abs(cross(ab, sub(p, a))) / l;
}

/** Intersection of lines p + s*d and q + t*e. Returns null if parallel. */
export function lineIntersect(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const s = cross(sub(q, p), e) / den;
  return add(p, mul(d, s));
}
/** Proper segment intersection; returns {p, t, u} or null. */
export function segIntersect(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { p: add(a, mul(r, t)), t, u };
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
export function polyCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n]; const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(s, 1 / Math.max(1, pts.length));
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function polyBBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
export function polyPerimeter(pts) {
  let s = 0; for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]); return s;
}

/** Corners of an oriented rectangle centred at c, size w×d, rotated by `ang` radians. Order: back-left, back-right, front-right, front-left (front = +y local). */
export function obbCorners(cx, cy, w, d, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), hw = w / 2, hd = d / 2;
  const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  return pts.map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

/** Separating axis test between two convex polygons. Returns penetration depth (0 = no overlap). */
export function satDepth(A, B) {
  let minDepth = Infinity;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = { x: -(q.y - p.y), y: q.x - p.x }; const l = Math.hypot(ax.x, ax.y); if (l < 1e-12) continue;
      ax.x /= l; ax.y /= l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const r of A) { const d = r.x * ax.x + r.y * ax.y; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const r of B) { const d = r.x * ax.x + r.y * ax.y; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      if (o < minDepth) minDepth = o;
    }
  }
  return minDepth;
}

/** Ray (origin o, unit dir d) vs segment ab → distance or Infinity. */
export function raySeg(o, d, a, b) {
  const e = sub(b, a); const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return Infinity;
  const ao = sub(a, o);
  const t = cross(ao, e) / den; const u = cross(ao, d) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/** Remove consecutive duplicate points and "spikes" (a→b→a). */
export function cleanPolygon(pts, eps = 1e-6) {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (dist(a, b) < eps || dist(a, c) < eps) { out.splice(i, 1); changed = true; break; }
    }
  }
  // drop collinear vertices
  changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (Math.abs(cross(sub(b, a), sub(c, b))) < eps * Math.max(1, dist(a, c)) && dot(sub(b, a), sub(c, b)) > 0) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

/** Polygon offset for convex-ish simple polygons (miter). Positive = inwards for CCW in y-up. */
export function offsetPolygon(pts, dlt) {
  const n = pts.length; const sign = polyArea(pts) > 0 ? 1 : -1; const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const d1 = norm(sub(b, a)), d2 = norm(sub(c, b));
    const n1 = mul(perp(d1), sign * dlt), n2 = mul(perp(d2), sign * dlt);
    const p = lineIntersect(add(a, n1), d1, add(b, n2), d2);
    out.push(p && dist(p, b) < Math.abs(dlt) * 6 ? p : add(b, n1));
  }
  return out;
}
