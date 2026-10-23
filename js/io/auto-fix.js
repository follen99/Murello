// Automatic resolution proposals for the measurement check: a value for every missing length,
// a corrected unit for suspicious lengths, and for every inconsistency the single length that,
// once changed, closes the loop while staying closest to the drawing.
import { solvePlan } from './solver.js';
import { dist } from '../core/geom.js';

const round = (v, step) => Math.round(v / step) * step;

/**
 * Proposed answer for a missing request: the drawing estimate, rounded to 1 cm (or 0.5°).
 * Walls shorter than the wall thicknesses around them have no meaningful clear length: for those
 * the proposal is the centre-line length, stored under an "|axis" key.
 */
export function proposeMissing(m) {
  if (m.kind === 'angle') return { key: m.key, value: round(m.estimate, 0.5), angle: true };
  if (m.tiny) return { key: `${m.key}|axis`, value: Math.max(0.01, round(m.axisEstimate, 0.01)), axis: true };
  return { key: m.key, value: Math.max(0.01, round(m.estimate, 0.01)) };
}

/** Store an approved missing-length proposal. */
export function applyMissing(pp, p) {
  if (p.angle) pp.angles[p.key] = p.value; else pp.userMeasures[p.key] = p.value;
}

/** Proposed fix for a conflict: try dropping each length of the loop and keep the most plausible outcome. */
export function proposeConflictFix(raw, opts, res, conflict) {
  const nodes = res.preview.nodes;
  let best = null;
  for (const c of conflict.cycle) {
    if (!c?.src || !c.key) continue;
    const trial = { ...opts, overrides: { ...opts.overrides }, userMeasures: { ...opts.userMeasures } };
    if (c.src.type === 'user') delete trial.userMeasures[c.key]; else trial.overrides[c.key] = 'off';
    const r = solvePlan(raw, trial);
    if (r.issues.conflicts.length >= res.issues.conflicts.length || r.issues.missing.length > res.issues.missing.length) continue;
    const A = r.positions[c.a], B = r.positions[c.b];
    if (!A || !B) continue;
    const axis = c.kind === 'x' ? Math.abs(B.x - A.x) : c.kind === 'y' ? Math.abs(B.y - A.y) : dist(A, B);
    const adjust = c.value - c.typed; // half thicknesses added for clear ("net") lengths
    const to = round(axis - adjust, 0.005);
    if (!(to > 0.005) || Math.abs(to - c.typed) < 0.005) continue;
    const P = nodes[c.a], Q = nodes[c.b];
    const px = c.kind === 'x' ? Math.abs(Q.x - P.x) : c.kind === 'y' ? Math.abs(Q.y - P.y) : dist(P, Q);
    const drawn = Math.max(0.01, px * res.scale - adjust);
    if (Math.abs(to - drawn) > Math.max(0.15, drawn * 0.5)) continue; // implausible against the drawing
    const score = r.issues.conflicts.length * 10 + Math.abs(to - drawn) / Math.max(drawn, 0.1);
    if (!best || score < best.score) best = { score, key: c.key, srcType: c.src.type, src: c.src, from: c.typed, to, drawn, pieces: c.pieces };
  }
  return best;
}

/** Store an approved proposal in the per-page answers. */
export function applyFix(pp, fix) {
  if (fix.srcType === 'user') pp.userMeasures[fix.key] = fix.to;
  else pp.overrides[fix.key] = fix.to;
}
