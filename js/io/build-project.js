// From solver output (metres) to project floors.
import { newProject, newFloor } from '../core/state.js';
import { hasModel } from '../furniture/models.js';
import { uid } from '../core/util.js';

export function floorFromSolution(res, page, { elevation = 0, height = 2.7 } = {}) {
  const f = newFloor(page.name || 'Piano', elevation, height);
  const p = uid('f').slice(-6);
  const nid = (id) => `${p}_${id}`;
  f.nodes = res.nodes.map((n) => ({ id: nid(n.id), x: n.x, y: n.y }));
  f.walls = res.walls.map((w) => ({
    id: nid(w.id), a: nid(w.a), b: nid(w.b), thickness: w.thickness, height: w.height ?? null,
    openings: w.openings.map((o) => ({ ...o, id: nid(o.id) })), decor: w.decor.map((d) => ({ ...d, id: nid(d.id) })),
    colorL: w.colorL || null, colorR: w.colorR || null,
  }));
  f.rooms = res.rooms.filter((r) => r.name || r.height || r.floor || r.wallColor).map((r) => ({ id: nid(r.id), name: r.name, anchor: r.anchor, height: r.height, floor: r.floor, wallColor: r.wallColor }));
  f.items = res.items.map((it) => ({
    id: nid(it.id), model: hasModel(it.model) ? it.model : 'box', name: it.name || '', x: it.x, y: it.y, rot: ((it.rot % 360) + 360) % 360,
    w: it.w > 0.05 ? it.w : null, d: it.d > 0.05 ? it.d : null, h: it.h ?? null, elevation: it.elevation || 0, color: it.color || null, params: it.params || {},
  }));
  return f;
}

/** Build a whole project from solved pages. */
export function projectFromPages(solved, { name, settings }) {
  const p = newProject(name);
  Object.assign(p.settings, settings || {});
  p.floors = [];
  let elev = 0;
  for (const s of solved) {
    const h = s.raw.meta.height || p.settings.wallHeight;
    const e = s.raw.meta.elevation ?? elev;
    p.floors.push(floorFromSolution(s.res, s.page, { elevation: e, height: h }));
    elev = e + h + (p.settings.slab ?? 0.3);
  }
  p.activeFloor = p.floors[0].id;
  return p;
}

/** Replace the structure of existing floors, keeping furniture (and decor positions where walls still exist). */
export function updateStructure(project, solved) {
  const fresh = projectFromPages(solved, { name: project.meta.name, settings: project.settings });
  fresh.floors.forEach((nf, i) => {
    const old = project.floors.find((f) => f.name === nf.name) || project.floors[i];
    if (old) { nf.id = old.id; nf.items = old.items; nf.elevation = old.elevation; }
  });
  project.floors = fresh.floors.concat(project.floors.filter((f) => !fresh.floors.find((n) => n.id === f.id)));
  project.activeFloor = project.floors[0].id;
  return project;
}
