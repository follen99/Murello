// Auto-furnish optimizer (runs in a Web Worker so the page stays responsive).
// Simulated annealing over item positions/rotations with domain-specific moves
// (snap to a wall, place relative to a partner item, swap, jitter, rotate).
import { BUILTIN_TERMS, evaluate, enrichItem, makeGridEvaluator, compileCustomTerm } from './terms.js';
import { pointInPoly, dist, add, mul, norm, sub } from '../core/geom.js';
import { rng } from '../core/util.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'run') {
    try { run(msg); } catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
  } else if (msg.type === 'evaluate') {
    try {
      const { ctx, terms } = prepare(msg);
      ctx.items = msg.items.map((i) => enrichItem({ ...i }));
      const r = evaluate(ctx, terms);
      self.postMessage({ type: 'evaluated', ...r, errors: terms.errors });
    } catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
  }
};

function prepare(msg) {
  const ctx = msg.ctx;
  const terms = [];
  terms.errors = [];
  for (const t of BUILTIN_TERMS) {
    const w = msg.weights[t.id];
    if (w && w.weight > 0) terms.push({ ...t, weight: w.weight, dir: w.dir || t.dir });
  }
  for (const c of msg.custom || []) {
    if (!(c.weight > 0)) continue;
    try { terms.push(compileCustomTerm(c)); } catch (err) { terms.errors.push({ id: c.id, message: String(err.message || err) }); }
  }
  const gridEval = makeGridEvaluator(ctx, ctx.room.area > 40 ? 0.2 : 0.15);
  ctx.fixed = (ctx.fixed || []).map((f) => ({ ...f }));
  ctx.grid = () => (ctx._grid ||= gridEval(ctx.items, ctx.fixed, msg.minPassage));
  return { ctx, terms };
}

function run(msg) {
  const { ctx, terms } = prepare(msg);
  if (terms.errors.length) self.postMessage({ type: 'termErrors', errors: terms.errors });
  const R = rng(msg.seed || 12345);
  const base = msg.items.map((i) => ({ ...i }));
  const n = base.length;
  if (!n) { self.postMessage({ type: 'done', solutions: [] }); return; }
  const restarts = msg.restarts || 4;
  const iters = Math.max(1500, Math.min(9000, 900 * n)) * (msg.effort || 1);
  const budget = (msg.budgetMs || 7000) / restarts;
  const results = [];
  const faces = ctx.walls;
  const inner = ctx.room.inner;
  const bb = ctx.room.bbox;

  const randInside = (it) => {
    for (let k = 0; k < 60; k++) {
      const p = { x: bb.minX + R() * bb.w, y: bb.minY + R() * bb.h };
      if (pointInPoly(p, inner)) { it.x = p.x; it.y = p.y; return; }
    }
    it.x = ctx.room.centroid.x; it.y = ctx.room.centroid.y;
  };
  const snapToWall = (it) => {
    if (!faces.length) return randInside(it);
    const f = faces[Math.floor(R() * faces.length)];
    const L = dist(f.a, f.b); if (L < it.w * 0.6) return randInside(it);
    const t = (it.w / 2 + R() * Math.max(0, L - it.w)) / L;
    const p = add(f.a, mul(sub(f.b, f.a), t));
    const r = Math.atan2(-f.normal.x, f.normal.y);
    it.rot = (r * 180 / Math.PI + 360) % 360;
    const q = add(p, mul(f.normal, it.d / 2 + 0.004));
    it.x = q.x; it.y = q.y;
  };
  const placeRelative = (it, items) => {
    const { type, target } = it.rel || {};
    const cands = items.filter((o) => o !== it && o.model.startsWith(target));
    if (!cands.length) return false;
    const t = enrichItem({ ...cands[Math.floor(R() * cands.length)] });
    const side = norm(sub(t.corners[1], t.corners[0])); // along the target's width
    if (type === 'beside') {
      const s = R() < 0.5 ? -1 : 1;
      const p = add(t.backCenter, add(mul(side, s * (t.w / 2 + it.w / 2 + 0.03)), mul(t.front, it.d / 2 + 0.02)));
      it.x = p.x; it.y = p.y; it.rot = t.rot;
    } else if (type === 'around') {
      const k = Math.floor(R() * 4); const a = t.corners[k], b = t.corners[(k + 1) % 4];
      const L = dist(a, b); const u = 0.5 + (R() - 0.5) * Math.max(0, (L - it.w) / L);
      const m = add(a, mul(sub(b, a), u)); const out = norm(sub(m, t));
      const p = add(m, mul(out, it.d / 2 - 0.08));
      it.x = p.x; it.y = p.y; const v = sub(t, p); it.rot = (Math.atan2(-v.x, v.y) * 180 / Math.PI + 360) % 360;
    } else if (type === 'faces') {
      const d = 2.2 + R() * 1.3; const p = add(t.frontCenter, mul(t.front, d));
      it.x = p.x; it.y = p.y; const v = sub(t, p); it.rot = (Math.atan2(-v.x, v.y) * 180 / Math.PI + 360) % 360;
    } else if (type === 'front') {
      const gap = it.tags.includes('low') ? 0.4 : 0.05;
      const p = add(t.frontCenter, mul(t.front, it.d / 2 + gap));
      it.x = p.x; it.y = p.y;
      it.rot = it.tags.includes('seat') ? (t.rot + 180) % 360 : t.rot;
    } else if (type === 'near') {
      const a = R() * Math.PI * 2; const p = add(t, { x: Math.cos(a) * (1 + R() * 0.6), y: Math.sin(a) * (1 + R() * 0.6) });
      it.x = p.x; it.y = p.y; const v = sub(t, p); it.rot = (Math.atan2(-v.x, v.y) * 180 / Math.PI + 360) % 360;
    }
    return true;
  };

  const score = (items) => { ctx.items = items.map((i) => enrichItem({ ...i })); return evaluate(ctx, terms); };
  const t0all = performance.now();
  let lastPost = 0;
  for (let rs = 0; rs < restarts; rs++) {
    const cur = base.map((i) => ({ ...i }));
    if (!(msg.keepCurrent && rs === 0)) {
      for (const it of cur) { if (it.tags.includes('wall')) snapToWall(it); else randInside(it); }
      for (const it of cur) if (it.rel && R() < 0.8) placeRelative(it, cur);
    }
    let curS = score(cur);
    let best = { items: cur.map((i) => ({ ...i })), ...curS };
    const T0 = 3.0, T1 = 0.02;
    const t0 = performance.now();
    for (let k = 0; k < iters; k++) {
      if (performance.now() - t0 > budget) break;
      const T = T0 * Math.pow(T1 / T0, k / iters);
      const cand = cur.map((i) => ({ ...i }));
      const it = cand[Math.floor(R() * n)];
      const mv = R();
      if (mv < 0.32) { const s = 0.05 + T * 0.25; it.x += (R() - 0.5) * s * 2; it.y += (R() - 0.5) * s * 2; }
      else if (mv < 0.45) it.rot = ((it.rot || 0) + (R() < 0.5 ? 90 : 270)) % 360;
      else if (mv < 0.68) { if (it.tags.includes('wall') || R() < 0.25) snapToWall(it); else randInside(it); }
      else if (mv < 0.86) { if (!it.rel || !placeRelative(it, cand)) snapToWall(it); }
      else if (n > 1) { const o = cand[Math.floor(R() * n)]; if (o !== it) { [it.x, o.x] = [o.x, it.x]; [it.y, o.y] = [o.y, it.y]; } }
      const s = score(cand);
      const dJ = s.J - curS.J;
      if (dJ >= 0 || R() < Math.exp(dJ / T)) {
        for (let q = 0; q < n; q++) Object.assign(cur[q], cand[q]);
        curS = s;
        if (s.J > best.J) best = { items: cand.map((i) => ({ ...i })), ...s };
      }
      const now = performance.now();
      if (now - lastPost > 120) { lastPost = now; self.postMessage({ type: 'progress', value: (rs + k / iters) / restarts, best: best.J }); }
    }
    results.push(best);
  }
  results.sort((a, b) => b.J - a.J);
  const out = [];
  for (const r of results) {
    if (out.some((o) => o.items.reduce((s, it, i) => s + dist(it, r.items[i]), 0) / n < 0.25)) continue;
    out.push(r);
    if (out.length >= 3) break;
  }
  self.postMessage({
    type: 'done', ms: Math.round(performance.now() - t0all),
    solutions: out.map((r) => ({ J: r.J, breakdown: r.breakdown, items: r.items.map((i) => ({ id: i.id, x: +i.x.toFixed(4), y: +i.y.toFixed(4), rot: Math.round(i.rot || 0) })) })),
  });
}
