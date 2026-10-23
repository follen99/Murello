// Turns classified draw.io cells of one page into a "raw plan" in drawing units (px).
import { classifyCell, prepareCell, cellSignature, guessModel } from '../categories/registry.js';
import { pointAlongPolyline } from './drawio-parser.js';
import { parseLabel, parseMeta } from './labels.js';
import { obbCorners, polyArea, pointInPoly, polyCentroid, dist, sub, norm, add, mul, perp } from '../core/geom.js';
import { deg2rad } from '../core/util.js';

/**
 * @param page parsed page {id,name,cells}
 * @param ctx {userRules, assignments: {cellId|sig: {kind, params}}, unknownMode: 'ignore'|'assign', labelOpts}
 */
export function extractPage(page, ctx = {}) {
  const userRules = ctx.userRules || [];
  const assignments = ctx.assignments || {};
  const labelOpts = { defaultUnit: ctx.defaultUnit || 'auto' };
  const raw = {
    pageId: page.id, name: page.name,
    segments: [], rooms: [], openings: [], items: [], dimensions: [], labels: [], unknowns: [], meta: {}, ignored: [],
    counts: {},
  };
  const cells = page.cells.filter((c) => !c.isStructural && !c.isEdgeLabel);
  // First pass: meta (so label options apply)
  for (const c of cells) {
    prepareCell(c);
    if (/^\s*(murello|fp3d)\s*:/i.test(c.text || '')) Object.assign(raw.meta, parseMeta(c.text));
    if (c.attrs?.murello_kind === 'meta') { try { Object.assign(raw.meta, JSON.parse(c.attrs.murello_data || '{}')); } catch { /* */ } }
  }
  if (raw.meta.unit) labelOpts.defaultUnit = raw.meta.unit;

  const classified = cells.map((c) => {
    let cl = classifyCell(c, userRules);
    if (cl.unknown || cl.kind === 'unknown') {
      const sig = cellSignature(c);
      const as = assignments[c.id] || assignments[`sig:${sig}`];
      if (as) cl = { kind: as.kind, params: { ...(as.params || {}) }, assigned: true };
      else cl = { ...cl, sig };
    }
    return { c, cl };
  });

  // Room candidates found by heuristic: demote small rectangles fully inside another room to unknown/furniture.
  const roomCands = classified.filter((x) => x.cl.kind === 'room' && x.c.box);
  for (const x of roomCands) {
    if (!x.cl.heuristic) continue;
    const b = x.c.box, area = b.w * b.h;
    const container = roomCands.find((y) => y !== x && y.c.box && contains(y.c.box, b) && y.c.box.w * y.c.box.h > area);
    if (!container) continue;
    const ratio = area / (container.c.box.w * container.c.box.h);
    const lbl = parseLabel(x.c.text, labelOpts);
    const roomWord = /(camera|cucina|bagno|soggiorno|salotto|studio|ingresso|corridoio|disimpegno|ripostiglio|lavanderia|room|kitchen|bath|living|hall|closet|stanza|sala|cameretta|balcone|terrazz|garage|cantina)/i.test(lbl.name);
    if (roomWord && ratio > 0.03) continue;
    if (x.cl.furnitureGuess) x.cl = { kind: 'furniture', params: { model: x.cl.furnitureGuess }, heuristic: true };
    else if (ratio < 0.12) {
      const sig = cellSignature(x.c);
      const as = assignments[x.c.id] || assignments[`sig:${sig}`];
      x.cl = as ? { kind: as.kind, params: { ...(as.params || {}) }, assigned: true } : { kind: 'unknown', params: {}, unknown: true, sig };
    }
  }

  for (const { c, cl } of classified) {
    raw.counts[cl.kind] = (raw.counts[cl.kind] || 0) + 1;
    const corners = c.box ? obbCorners(c.center.x, c.center.y, c.box.w, c.box.h, deg2rad(c.rotation)) : null;
    switch (cl.kind) {
      case 'wall': addWall(raw, c, cl, corners, labelOpts); break;
      case 'room': addRoom(raw, c, cl, corners, labelOpts); break;
      case 'door': case 'window': case 'opening': {
        if (!corners && !c.polyline) break;
        const pts = corners || [c.polyline[0], c.polyline[c.polyline.length - 1]];
        const lbl = parseLabel(c.text, labelOpts);
        let axis = null;
        if (c.box) {
          const r = deg2rad(c.rotation); const lx = { x: Math.cos(r), y: Math.sin(r) }, ly = { x: -Math.sin(r), y: Math.cos(r) };
          const sq = Math.abs(c.box.w - c.box.h) / Math.max(c.box.w, c.box.h, 1e-9) < 0.25;
          axis = cl.kind === 'door' || sq ? lx : c.box.w >= c.box.h ? lx : ly;
        } else if (c.polyline) axis = norm(sub(c.polyline[c.polyline.length - 1], c.polyline[0]));
        raw.openings.push({ cellId: c.id, kind: cl.kind, corners: pts, center: polyCentroid(pts), axis, params: { ...cl.params }, own: !!cl.own, measure: lbl.measure, height: lbl.height, sill: lbl.sill, flipH: c.style.flipH === '1', flipV: c.style.flipV === '1', rotation: c.rotation });
        break;
      }
      case 'furniture': case 'column': case 'stairs': {
        if (!corners) break;
        const lbl = parseLabel(c.text, labelOpts);
        const params = { ...cl.params };
        if (cl.kind === 'furniture' && (!params.model || params.model === 'box')) params.model = guessModel(`${c.shapeName} ${c.text}`) || params.model || 'box';
        raw.items.push({ cellId: c.id, kind: cl.kind, center: { ...c.center }, w: c.box.w, d: c.box.h, rot: c.rotation, corners, params, own: !!cl.own, name: lbl.name, height: lbl.height ?? params.height ?? null, flipH: c.style.flipH === '1' });
        break;
      }
      case 'dimension': {
        let a, b;
        if (c.polyline) { a = c.polyline[0]; b = c.polyline[c.polyline.length - 1]; }
        else if (corners) {
          // horizontal dimension shape: measured along its width, through its middle
          const ml = { x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 };
          const mr = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 };
          a = ml; b = mr;
        }
        if (!a) break;
        const texts = [c.text, ...(c.extraLabels || []).map((l) => l.text)].join(' ');
        const lbl = parseLabel(texts, labelOpts);
        raw.dimensions.push({ cellId: c.id, a, b, value: lbl.measure, mode: lbl.mode || (cl.own ? cl.params.mode : null) });
        break;
      }
      case 'label': {
        if (!c.center && !c.box) break;
        const lbl = parseLabel(c.text, labelOpts);
        raw.labels.push({ cellId: c.id, pos: c.center, text: c.text, parsed: lbl, own: cl.own ? cl.params : null });
        break;
      }
      case 'meta': break;
      case 'unknown': {
        const pts = corners || (c.polyline ? c.polyline : null);
        if (!pts) break;
        raw.unknowns.push({ cellId: c.id, sig: cl.sig || cellSignature(c), corners: pts, center: polyCentroid(pts), text: c.text, styleRaw: c.styleRaw, shape: c.shapeName, box: c.box });
        break;
      }
      default: raw.ignored.push(c.id);
    }
  }
  return raw;
}

function contains(a, b) {
  const e = 0.5;
  return b.x >= a.x - e && b.y >= a.y - e && b.x + b.w <= a.x + a.w + e && b.y + b.h <= a.y + a.h + e;
}

function addSeg(raw, a, b, extra) {
  if (dist(a, b) < 1e-6) return null;
  const s = { id: `s${raw.segments.length}`, a: { ...a }, b: { ...b }, ...extra };
  raw.segments.push(s);
  return s;
}

function addWall(raw, c, cl, corners, labelOpts) {
  const data = cl.own ? cl.params : {};
  const base = { cellId: c.id, src: 'wall', own: !!cl.own, data };
  if (c.polyline) {
    const pl = c.polyline;
    const segs = [];
    for (let i = 0; i < pl.length - 1; i++) segs.push(addSeg(raw, pl[i], pl[i + 1], { ...base, piece: i }));
    // labels: main value at the middle; extra labels at their relative position
    const lbls = [];
    if (c.text) lbls.push({ text: c.text, pos: 0 });
    for (const l of c.extraLabels || []) lbls.push(l);
    for (const l of lbls) {
      const p = parseLabel(l.text, labelOpts);
      const at = pointAlongPolyline(pl, l.pos ?? 0);
      const seg = segs[at.seg];
      if (!seg) continue;
      applyLabelToSeg(seg, p, labelOpts);
    }
    if (cl.own && data.mode) segs.forEach((s) => s && s.measure && (s.measure.mode = data.mode));
    return;
  }
  if (!corners) return;
  const shape = (c.shapeName || '').toLowerCase();
  const lbl = parseLabel(c.text, labelOpts);
  const thkPx = c.style.wallThickness ? parseFloat(c.style.wallThickness) : null;
  if (/wallcorner/.test(shape) || /wallu/.test(shape)) {
    // Legs along the inner side of the bounding box (draw.io draws them at the box edges).
    const t = thkPx ?? 10;
    const [p0, p1, p2, p3] = corners; // TL, TR, BR, BL (rotated)
    // top edge and left edge (wallCorner); top, left, right (wallU)
    const top = [shiftInto(p0, p1, p3, t / 2), shiftInto(p1, p0, p2, t / 2)];
    const left = [shiftInto(p0, p3, p1, t / 2), shiftInto(p3, p0, p2, t / 2)];
    const right = [shiftInto(p1, p2, p0, t / 2), shiftInto(p2, p1, p3, t / 2)];
    const legs = /wallu/.test(shape) ? [left, top, right] : [top, left];
    legs.forEach((lg, i) => addSeg(raw, lg[0], lg[1], { ...base, piece: i, thkPx: t, ...(i === 0 && lbl.measure ? { measure: { value: lbl.measure, mode: lbl.mode, src: 'label' } } : {}) }));
    return;
  }
  // straight wall from a line vertex or a thick rectangle: along the long axis
  const [p0, p1, p2, p3] = corners;
  const wLen = dist(p0, p1), hLen = dist(p1, p2);
  let a, b, t;
  if (wLen >= hLen) { a = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 }; b = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; t = hLen; }
  else { a = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }; b = { x: (p3.x + p2.x) / 2, y: (p3.y + p2.y) / 2 }; t = wLen; }
  const seg = addSeg(raw, a, b, { ...base, piece: 0, thkPx: cl.lineVertex ? null : (thkPx ?? t) });
  if (seg) applyLabelToSeg(seg, lbl, labelOpts);
}

/** Move point a (on edge a→b) inwards towards `toward` by distance d along the edge perpendicular. */
function shiftInto(a, b, toward, d) {
  const dir = norm(sub(b, a));
  let n = perp(dir);
  if ((toward.x - a.x) * n.x + (toward.y - a.y) * n.y < 0) n = mul(n, -1);
  return add(a, mul(n, d));
}

function applyLabelToSeg(seg, p, labelOpts) {
  void labelOpts;
  if (p.measure) seg.measure = { value: p.measure, mode: p.mode, src: 'label', angle: p.angle };
  else if (p.angle != null) seg.angle = p.angle;
  if (p.thickness) seg.thickness = p.thickness;
  if (p.height) seg.height = p.height;
}

function addRoom(raw, c, cl, corners, labelOpts) {
  if (!corners) return;
  const lbl = parseLabel(c.text, labelOpts);
  const data = cl.own ? cl.params : {};
  const room = { cellId: c.id, poly: corners, name: lbl.name || data.name || '', wxd: lbl.wxd, height: lbl.height ?? data.height ?? null, mode: lbl.mode, data, own: !!cl.own };
  raw.rooms.push(room);
  // sides become wall segments (deduplicated later by the solver)
  const sides = [];
  for (let i = 0; i < 4; i++) sides.push(addSeg(raw, corners[i], corners[(i + 1) % 4], { cellId: c.id, src: 'room', piece: i }));
  room.sideSegs = sides.map((s) => s?.id);
  void polyArea; void pointInPoly;
}
