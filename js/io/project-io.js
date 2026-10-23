// Native project format (.murello.json): the full document, re-importable without loss.
import { FORMAT, FORMAT_VERSION, newProject } from '../core/state.js';
import { getModel, validateModel } from '../furniture/models.js';

export function serializeProject(project) {
  const used = new Set(project.floors.flatMap((f) => f.items.map((i) => i.model)));
  const customModels = (project.customModels || []).filter((m) => used.has(m.id));
  for (const id of used) { const m = getModel(id); if (m?.custom && !customModels.find((c) => c.id === id)) customModels.push(m); }
  const out = { ...project, format: FORMAT, version: FORMAT_VERSION, customModels, savedAt: new Date().toISOString() };
  return JSON.stringify(out, null, 1);
}

export class ProjectFormatError extends Error {}

/** Parse + validate + migrate a native project. */
export function parseProject(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new ProjectFormatError('json'); }
  if (!data || data.format !== FORMAT) throw new ProjectFormatError('format');
  if (data.version > FORMAT_VERSION) throw new ProjectFormatError('newer');
  const base = newProject(data.meta?.name);
  const p = { ...base, ...data };
  p.settings = { ...base.settings, ...(data.settings || {}) };
  p.meta = { ...base.meta, ...(data.meta || {}) };
  p.floors = (data.floors || []).map((f, i) => ({
    id: f.id || `floor_${i}`, name: f.name || `Piano ${i}`, elevation: +f.elevation || 0, height: +f.height || 2.7,
    nodes: (f.nodes || []).filter((n) => n && n.id && isFinite(n.x) && isFinite(n.y)),
    walls: (f.walls || []).map((w) => ({ openings: [], decor: [], colorL: null, colorR: null, height: null, ...w })),
    rooms: f.rooms || [], items: (f.items || []).filter((it) => it && it.id && isFinite(it.x) && isFinite(it.y)),
  }));
  if (!p.floors.length) p.floors = base.floors;
  const models = [];
  for (const m of data.customModels || []) { try { models.push(validateModel(m)); } catch { /* skip bad model */ } }
  p.customModels = models;
  if (!p.floors.find((f) => f.id === p.activeFloor)) p.activeFloor = p.floors[0].id;
  return p;
}

/** Library file: user models + recognition rules + custom objective terms. */
export function serializeLibrary(lib) {
  return JSON.stringify({ format: 'murello-library', version: 1, models: lib.models || [], rules: lib.rules || [], terms: lib.terms || [] }, null, 1);
}
export function parseLibrary(text) {
  const d = JSON.parse(text);
  if (d.format !== 'murello-library') throw new ProjectFormatError('format');
  return { models: d.models || [], rules: d.rules || [], terms: d.terms || [] };
}
