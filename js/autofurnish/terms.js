// Auto-furnish objective: J = Σ weightᵢ · (±termᵢ) − penalty
// Every builtin term returns a value in [0, 1]. "max" terms are rewarded, "min" terms are penalised.
// This module is pure JS and runs both in the page ("Try" button) and in the optimizer worker.
import { obbCorners, satDepth, dist, sub, add, mul, norm, dot, pointInPoly, polyBBox, distPointSeg, raySeg } from '../core/geom.js';

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- helpers exposed to custom terms
export const helpers = {
  dist, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), clamp01,
  sum: (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0),
  avg: (arr, f = (x) => x) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0),
  pointInPoly,
  /** distance from a point to the nearest wall face of the room */
  distToWalls(ctx, p) { let m = Infinity; for (const w of ctx.walls) m = Math.min(m, distPointSeg(p, w.a, w.b)); return m; },
  /** gap between the back of an item and the wall behind it (Infinity if none) */
  backGap(ctx, it) {
    let best = Infinity;
    for (const w of ctx.walls) {
      if (dot(it.back, w.normal) > -0.94) continue;
      const g = raySeg(it.backCenter, it.back, w.a, w.b);
      if (g < best) best = g;
    }
    return best;
  },
  /** cosine between where `a` faces and the direction to `b` (1 = looking straight at it) */
  facing(a, b) { const v = norm(sub(b, a)); return dot(a.front, v); },
  overlap(a, b) { return satDepth(a.corners, b.corners); },
  nearest(ctx, it, test) { let best = null; for (const o of ctx.items) if (o !== it && test(o)) { const d = dist(o, it); if (!best || d < best.d) best = { o, d }; } return best?.o || null; },
};

/** Build per-item derived data used by terms. */
export function enrichItem(it) {
  const r = (it.rot || 0) * DEG;
  const corners = obbCorners(it.x, it.y, it.w, it.d, r);
  const front = { x: -Math.sin(r), y: Math.cos(r) };
  const back = { x: Math.sin(r), y: -Math.cos(r) };
  return Object.assign(it, { corners, front, back, backCenter: add(it, mul(back, it.d / 2)), frontCenter: add(it, mul(front, it.d / 2)) });
}

// ---------------------------------------------------------------- builtin terms
export const BUILTIN_TERMS = [
  {
    id: 'walkway', dir: 'max', grid: true,
    name: { it: 'Passaggi liberi', en: 'Clear walkways' },
    desc: { it: 'Quota di pavimento raggiungibile dalle porte con un passaggio largo almeno quanto il minimo impostato.', en: 'Share of floor reachable from the doors through passages at least as wide as the minimum set.' },
    fn: (ctx) => { const g = ctx.grid(); return g.free ? g.walk / g.free : 0; },
  },
  {
    id: 'openSpace', dir: 'max', grid: true,
    name: { it: 'Spazio aperto al centro', en: 'Open centre' },
    desc: { it: 'Premia un grande spazio libero continuo (il cerchio libero più grande).', en: 'Rewards one large continuous free area (the biggest empty circle).' },
    fn: (ctx) => { const g = ctx.grid(); const half = Math.min(ctx.room.bbox.w, ctx.room.bbox.h) / 2; return clamp01(g.maxClear / Math.max(0.5, half)); },
  },
  {
    id: 'wallAffinity', dir: 'max',
    name: { it: 'Mobili contro il muro', en: 'Furniture against walls' },
    desc: { it: 'Letti, armadi, divani e cucine stanno meglio con lo schienale appoggiato al muro.', en: 'Beds, wardrobes, sofas and kitchens work best with their back to a wall.' },
    fn: (ctx, h) => { const ws = ctx.items.filter((i) => i.tags.includes('wall')); if (!ws.length) return 1; return h.avg(ws, (i) => Math.exp(-h.backGap(ctx, i) / 0.08)); },
  },
  {
    id: 'naturalLight', dir: 'max',
    name: { it: 'Vicino alle finestre', en: 'Near windows' },
    desc: { it: 'Scrivanie, tavoli e sedute vicino alla luce naturale.', en: 'Desks, tables and seating close to daylight.' },
    fn: (ctx, h) => { const ls = ctx.items.filter((i) => i.tags.includes('light') || i.tags.includes('seat') && !i.tags.includes('small')); if (!ls.length || !ctx.windows.length) return 1; return h.avg(ls, (i) => Math.max(...ctx.windows.map((w) => Math.exp(-dist(i, w.center) / 1.6)))); },
  },
  {
    id: 'windowBlock', dir: 'min',
    name: { it: 'Finestre coperte', en: 'Blocked windows' },
    desc: { it: 'Penalizza mobili alti davanti alle finestre.', en: 'Penalises tall furniture in front of windows.' },
    fn: (ctx) => {
      if (!ctx.windows.length) return 0;
      let blocked = 0, total = 0;
      for (const w of ctx.windows) {
        total += w.width;
        const zone = [w.a, w.b, add(w.b, mul(w.normal, 0.45)), add(w.a, mul(w.normal, 0.45))];
        for (const it of ctx.items) if (it.top > (w.sill || 0) + 0.1 && satDepth(it.corners, zone) > 0.01) { blocked += Math.min(w.width, it.w); }
      }
      return clamp01(blocked / Math.max(0.1, total));
    },
  },
  {
    id: 'relations', dir: 'max',
    name: { it: 'Abbinamenti', en: 'Pairings' },
    desc: { it: 'Comodini accanto al letto, sedie attorno al tavolo, divano rivolto alla TV, sedia davanti alla scrivania.', en: 'Nightstands beside the bed, chairs around the table, sofa facing the TV, chair at the desk.' },
    fn: (ctx, h) => {
      const rel = ctx.items.filter((i) => i.rel); if (!rel.length) return 1;
      return h.avg(rel, (i) => relationScore(ctx, i, h));
    },
  },
  {
    id: 'conversation', dir: 'max',
    name: { it: 'Conversazione', en: 'Conversation' },
    desc: { it: 'Le sedute si guardano a una distanza comoda per parlare (1,2–3,5 m).', en: 'Seats face each other at a comfortable talking distance (1.2–3.5 m).' },
    fn: (ctx, h) => {
      const seats = ctx.items.filter((i) => i.tags.includes('seat') && !(i.rel?.type === 'around') && !(i.rel?.type === 'front' && i.rel.target === 'desk'));
      if (seats.length < 2) return 0.5;
      const c = { x: h.avg(seats, (s) => s.x), y: h.avg(seats, (s) => s.y) };
      return h.avg(seats, (s) => { const d = dist(s, c) * 2; const dd = d < 1.2 ? d / 1.2 : d > 3.5 ? Math.max(0, 1 - (d - 3.5) / 2) : 1; return clamp01((h.facing(s, c) + 1) / 2) * dd; });
    },
  },
  {
    id: 'symmetry', dir: 'max',
    name: { it: 'Equilibrio visivo', en: 'Visual balance' },
    desc: { it: 'Il "peso" dei mobili è distribuito attorno al centro della stanza.', en: 'Furniture "weight" is spread around the centre of the room.' },
    fn: (ctx) => {
      let ax = 0, ay = 0, A = 0; for (const i of ctx.items) { const a = i.w * i.d; ax += i.x * a; ay += i.y * a; A += a; }
      if (!A) return 1; const c = { x: ax / A, y: ay / A };
      const diag = Math.hypot(ctx.room.bbox.w, ctx.room.bbox.h) / 2; return clamp01(1 - dist(c, ctx.room.centroid) / diag);
    },
  },
  {
    id: 'entranceClear', dir: 'max',
    name: { it: 'Ingressi sgombri', en: 'Clear entrances' },
    desc: { it: 'Lascia libera una fascia davanti a ogni porta.', en: 'Keeps a strip in front of every door empty.' },
    fn: (ctx) => {
      if (!ctx.doors.length) return 1;
      let bad = 0; for (const d of ctx.doors) for (const it of ctx.items) if (!it.tags.includes('flat') && satDepth(it.corners, d.zone) > 0.01) bad++;
      return clamp01(1 - bad / ctx.doors.length);
    },
  },
  {
    id: 'compactness', dir: 'min',
    name: { it: 'Dispersione', en: 'Spread' },
    desc: { it: 'Distanza media dei mobili dal loro baricentro: minimizzala per raggrupparli.', en: 'Average distance of the furniture from its centre: minimise to group it.' },
    fn: (ctx, h) => { if (ctx.items.length < 2) return 0; const c = { x: h.avg(ctx.items, (i) => i.x), y: h.avg(ctx.items, (i) => i.y) }; const diag = Math.hypot(ctx.room.bbox.w, ctx.room.bbox.h); return clamp01(h.avg(ctx.items, (i) => dist(i, c)) / (diag / 2)); },
  },
];

function relationScore(ctx, it, h) {
  const { type, target } = it.rel;
  const cand = ctx.items.filter((o) => o !== it && o.model.startsWith(target));
  if (!cand.length) return 1;
  let best = 0;
  for (const t of cand) {
    let s = 0;
    if (type === 'beside') { // next to the head of the target (its back corners)
      const sideL = add(t.backCenter, add(mul(norm(sub(t.corners[0], t.corners[1])), t.w / 2 + it.w / 2 + 0.03), mul(t.front, it.d / 2 + 0.02)));
      const sideR = add(t.backCenter, add(mul(norm(sub(t.corners[1], t.corners[0])), t.w / 2 + it.w / 2 + 0.03), mul(t.front, it.d / 2 + 0.02)));
      const d = Math.min(dist(it, sideL), dist(it, sideR));
      s = Math.exp(-d / 0.25) * clamp01((dot(it.front, t.front) + 1) / 2);
    } else if (type === 'around') {
      const dEdge = Math.max(0, Math.min(...[0, 1, 2, 3].map((k) => distPointSeg(it, t.corners[k], t.corners[(k + 1) % 4]))));
      s = Math.exp(-Math.abs(dEdge - 0.22) / 0.15) * clamp01(h.facing(it, t));
    } else if (type === 'faces') {
      const d = dist(it, t); const ok = d > 1.8 && d < 4.5 ? 1 : Math.exp(-Math.min(Math.abs(d - 1.8), Math.abs(d - 4.5)));
      s = clamp01(h.facing(it, t)) * clamp01(h.facing(t, it)) * ok;
    } else if (type === 'front') { // in front of target's front side
      const p = add(t.frontCenter, mul(t.front, it.d / 2 + (it.tags.includes('low') ? 0.4 : 0.05)));
      s = Math.exp(-dist(it, p) / 0.3);
    } else if (type === 'near') {
      s = Math.exp(-Math.max(0, dist(it, t) - 1.2) / 0.6);
    }
    best = Math.max(best, s);
  }
  return best;
}

// ---------------------------------------------------------------- presets
export const PRESETS = [
  {
    id: 'balanced', name: { it: 'Equilibrato', en: 'Balanced' },
    desc: { it: 'Un buon compromesso: mobili al muro, passaggi comodi, abbinamenti rispettati.', en: 'A good compromise: furniture on walls, comfortable passages, pairings respected.' },
    weights: { walkway: 6, wallAffinity: 6, relations: 6, entranceClear: 6, naturalLight: 3, windowBlock: 4, openSpace: 3 },
    art: 'balanced',
  },
  {
    id: 'space', name: { it: 'Massimo spazio', en: 'Maximum space' },
    desc: { it: 'Tutto lungo le pareti per liberare il centro della stanza.', en: 'Everything along the walls to free the middle of the room.' },
    weights: { openSpace: 9, walkway: 8, wallAffinity: 8, entranceClear: 7, relations: 3, compactness: 0 },
    art: 'space',
  },
  {
    id: 'light', name: { it: 'Luce naturale', en: 'Daylight' },
    desc: { it: 'Scrivanie e sedute verso le finestre, nessun mobile alto davanti ai vetri.', en: 'Desks and seats towards windows, nothing tall in front of the glass.' },
    weights: { naturalLight: 9, windowBlock: 9, walkway: 5, relations: 5, wallAffinity: 4, entranceClear: 5 },
    art: 'light',
  },
  {
    id: 'social', name: { it: 'Conviviale', en: 'Social' },
    desc: { it: 'Sedute raccolte e rivolte l\'una verso l\'altra, ideale per il soggiorno.', en: 'Seats grouped and facing each other, ideal for a living room.' },
    weights: { conversation: 9, relations: 8, walkway: 5, wallAffinity: 3, symmetry: 4, compactness: 5, entranceClear: 6 },
    art: 'social',
  },
  {
    id: 'accessible', name: { it: 'Accessibile', en: 'Accessible' },
    desc: { it: 'Passaggi ampi (almeno 90 cm) e ingressi completamente liberi.', en: 'Wide passages (at least 90 cm) and fully clear entrances.' },
    weights: { walkway: 10, entranceClear: 10, openSpace: 6, wallAffinity: 6, relations: 4 },
    minPassage: 0.9,
    art: 'accessible',
  },
];

// ---------------------------------------------------------------- example custom terms (shown in the editor)
export const CUSTOM_TEMPLATES = [
  {
    id: 'tv_far', name: { it: 'TV lontana dalla finestra', en: 'TV away from the window' }, dir: 'max',
    code: `// Riflessi sullo schermo: tieni la TV lontana dalle finestre.\nconst tv = ctx.items.find(i => i.model.startsWith('tv'));\nif (!tv || !ctx.windows.length) return 1;\nconst d = Math.min(...ctx.windows.map(w => h.dist(tv, w.center)));\nreturn h.clamp01(d / 4);`,
  },
  {
    id: 'bed_door', name: { it: 'Letto non di fronte alla porta', en: 'Bed not facing the door' }, dir: 'min',
    code: `// Valore alto = letto allineato con una porta (da minimizzare).\nconst bed = ctx.items.find(i => i.model.startsWith('bed'));\nif (!bed || !ctx.doors.length) return 0;\nreturn Math.max(...ctx.doors.map(d => h.clamp01(h.facing(bed, d.center))));`,
  },
  {
    id: 'near_wall_desk', name: { it: 'Scrivania con vista', en: 'Desk with a view' }, dir: 'max',
    code: `// La scrivania guarda verso una finestra.\nconst desk = ctx.items.find(i => i.model === 'desk');\nif (!desk || !ctx.windows.length) return 1;\nreturn Math.max(...ctx.windows.map(w => h.clamp01(h.facing(desk, w.center))));`,
  },
];

// ---------------------------------------------------------------- evaluation
/**
 * Evaluate the objective for a layout.
 * @param ctx scene context (see buildContext)
 * @param terms [{id, dir, weight, fn}]
 */
export function evaluate(ctx, terms) {
  ctx._grid = null;
  const breakdown = {};
  let J = 0;
  for (const t of terms) {
    if (!t.weight) continue;
    let v = 0;
    try { v = +t.fn(ctx, helpers); if (!Number.isFinite(v)) v = 0; } catch (e) { v = 0; breakdown[`${t.id}:error`] = String(e.message || e); }
    breakdown[t.id] = v;
    J += t.weight * (t.dir === 'min' ? -v : v);
  }
  const pen = penalty(ctx);
  breakdown._penalty = pen;
  J -= pen * 60;
  return { J, breakdown };
}

/** Hard constraints: overlaps, outside the room, inside walls, blocking door swings. */
export function penalty(ctx) {
  let p = 0;
  const items = ctx.items;
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (a.tags.includes('flat') || b.tags.includes('flat')) continue;
      if (Math.min(a.top, b.top) - Math.max(a.z0, b.z0) <= 0.01) continue;
      p += satDepth(a.corners, b.corners);
    }
    for (const f of ctx.fixed) if (!a.tags.includes('flat') && Math.min(a.top, f.top) - Math.max(a.z0, f.z0) > 0.01) p += satDepth(a.corners, f.corners);
    for (const c of a.corners) if (!pointInPoly(c, ctx.room.inner)) p += 0.2 + distOut(c, ctx.room.inner);
    if (!a.tags.includes('flat')) for (const d of ctx.doors) if (d.swing && fanOverlap(a.corners, d.swing)) p += 0.6;
  }
  return p;
}
function distOut(p, poly) { let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, distPointSeg(p, poly[i], poly[(i + 1) % poly.length])); return m; }
function fanOverlap(A, poly) { for (let i = 1; i < poly.length - 1; i++) if (satDepth(A, [poly[0], poly[i], poly[i + 1]]) > 0.01) return true; return false; }

// ---------------------------------------------------------------- fast walk grid for the optimizer
export function makeGridEvaluator(ctx, cell = 0.15) {
  const bb = ctx.room.bbox;
  const nx = Math.max(1, Math.ceil(bb.w / cell)), ny = Math.max(1, Math.ceil(bb.h / cell)); const N = nx * ny;
  const base = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = { x: bb.minX + (i + 0.5) * cell, y: bb.minY + (j + 0.5) * cell };
    base[j * nx + i] = pointInPoly(p, ctx.room.inner) ? 1 : 0;
  }
  let inside = 0; for (let k = 0; k < N; k++) inside += base[k];
  const seeds = [];
  for (const d of ctx.doors) {
    const i = Math.floor((d.inner.x - bb.minX) / cell), j = Math.floor((d.inner.y - bb.minY) / cell);
    if (i >= 0 && j >= 0 && i < nx && j < ny) seeds.push(j * nx + i);
  }
  const free = new Uint8Array(N), dt = new Float32Array(N), reach = new Uint8Array(N);
  const stack = new Int32Array(N);
  const mark = (corners) => {
    const b = polyBBox(corners);
    const i0 = Math.max(0, Math.floor((b.minX - bb.minX) / cell)), i1 = Math.min(nx - 1, Math.floor((b.maxX - bb.minX) / cell));
    const j0 = Math.max(0, Math.floor((b.minY - bb.minY) / cell)), j1 = Math.min(ny - 1, Math.floor((b.maxY - bb.minY) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i; if (!free[k]) continue;
      if (pointInPoly({ x: bb.minX + (i + 0.5) * cell, y: bb.minY + (j + 0.5) * cell }, corners)) free[k] = 0;
    }
  };
  return function compute(items, fixed, minPassage) {
    free.set(base);
    for (const f of fixed) if (f.z0 < 1.2 && !f.flat) mark(f.corners);
    for (const it of items) if (it.z0 < 1.2 && !it.tags.includes('flat')) mark(it.corners);
    const INF = 1e6;
    for (let k = 0; k < N; k++) dt[k] = free[k] ? INF : 0;
    const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : dt[j * nx + i]);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (dt[k]) dt[k] = Math.min(dt[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + 1.414, at(i + 1, j - 1) + 1.414); }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; if (dt[k]) dt[k] = Math.min(dt[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + 1.414, at(i - 1, j + 1) + 1.414); }
    const rad = minPassage / 2 / cell;
    reach.fill(0); let sp = 0;
    const ok = (k) => free[k] && dt[k] >= rad - 0.5;
    const seedList = seeds.length ? seeds : (() => { let bk = -1; for (let k = 0; k < N; k++) if (free[k] && (bk < 0 || dt[k] > dt[bk])) bk = k; return bk >= 0 ? [bk] : []; })();
    for (const s0 of seedList) {
      // find the closest valid cell around the seed
      let s = -1; const si = s0 % nx, sj = (s0 / nx) | 0;
      for (let r = 0; r < 5 && s < 0; r++) for (let dj = -r; dj <= r && s < 0; dj++) for (let di = -r; di <= r && s < 0; di++) { const ii = si + di, jj = sj + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && ok(jj * nx + ii)) s = jj * nx + ii; }
      if (s >= 0 && !reach[s]) { reach[s] = 1; stack[sp++] = s; }
    }
    while (sp) {
      const k = stack[--sp]; const i = k % nx, j = (k / nx) | 0;
      if (i > 0 && !reach[k - 1] && ok(k - 1)) { reach[k - 1] = 1; stack[sp++] = k - 1; }
      if (i < nx - 1 && !reach[k + 1] && ok(k + 1)) { reach[k + 1] = 1; stack[sp++] = k + 1; }
      if (j > 0 && !reach[k - nx] && ok(k - nx)) { reach[k - nx] = 1; stack[sp++] = k - nx; }
      if (j < ny - 1 && !reach[k + nx] && ok(k + nx)) { reach[k + nx] = 1; stack[sp++] = k + nx; }
    }
    let nFree = 0, nWalk = 0, maxDt = 0;
    const rr = Math.floor(rad);
    for (let k = 0; k < N; k++) {
      if (!free[k]) continue; nFree++; if (dt[k] < INF && dt[k] > maxDt) maxDt = dt[k];
      if (reach[k]) { nWalk++; continue; }
      // cell covered by the body of a reachable neighbour
      const i = k % nx, j = (k / nx) | 0; let cov = false;
      for (let dj = -rr; dj <= rr && !cov; dj++) for (let di = -rr; di <= rr && !cov; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && reach[jj * nx + ii] && di * di + dj * dj <= rr * rr) cov = true; }
      if (cov) nWalk++;
    }
    return { inside, free: nFree, walk: nWalk, maxClear: maxDt * cell };
  };
}

/** Compile user-written terms (inside the worker, or in the page for "Try"). */
export function compileCustomTerm(t) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('ctx', 'h', `"use strict";\n${t.code}`);
  return { id: t.id, dir: t.dir === 'min' ? 'min' : 'max', weight: +t.weight || 0, fn, custom: true, name: t.name };
}
