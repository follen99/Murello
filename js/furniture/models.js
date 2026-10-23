// Model registry + safe evaluation of part expressions (no three.js dependency: usable in workers).
import { BUILTIN_MODELS } from './library.js';

const ALLOWED_IDS = new Set(['w', 'd', 'h', 'H', 'i', 'n', 'min', 'max', 'round', 'floor', 'ceil', 'abs', 'sqrt', 'sin', 'cos', 'atan', 'PI']);
const fnCache = new Map();

export class ExprError extends Error {}

/** Compile a numeric expression. Only arithmetic, comparisons, ternaries and whitelisted names are allowed. */
export function compileExpr(expr) {
  if (typeof expr === 'number') return () => expr;
  const src = String(expr ?? '0').trim() || '0';
  if (fnCache.has(src)) return fnCache.get(src);
  if (!/^[\w\s+\-*/%().,?:<>=!&|]*$/.test(src)) throw new ExprError(`Invalid characters in "${src}"`);
  const ids = src.match(/[A-Za-z_]\w*/g) || [];
  for (const id of ids) if (!ALLOWED_IDS.has(id)) throw new ExprError(`Unknown name "${id}" in "${src}"`);
  // eslint-disable-next-line no-new-func
  const f = new Function('v', `const {w,d,h,H,i,n}=v; const {min,max,round,floor,ceil,abs,sqrt,sin,cos,atan,PI}=Math; return (${src});`);
  const safe = (v) => { const r = +f(v); return Number.isFinite(r) ? r : 0; };
  fnCache.set(src, safe);
  return safe;
}

let customModels = [];
const index = new Map(BUILTIN_MODELS.map((m) => [m.id, m]));
export function setCustomModels(list) {
  customModels = (list || []).filter(Boolean);
  for (const k of [...index.keys()]) if (!BUILTIN_MODELS.find((m) => m.id === k)) index.delete(k);
  for (const m of customModels) index.set(m.id, m);
}
export function getCustomModels() { return customModels; }
export function getModel(id) { return index.get(id) || index.get('box'); }
export function hasModel(id) { return index.has(id); }
export function allModels() { return [...BUILTIN_MODELS, ...customModels]; }

/** Default dimensions of a model (resolving expressions like h:'H'). */
export function modelDefaults(model, H = 2.7) {
  const p = model.params || {};
  const ev = (x, def) => { try { return compileExpr(x ?? def)({ w: 0, d: 0, h: 0, H, i: 0, n: 1 }); } catch { return def; } };
  return { w: ev(p.w, 0.6), d: ev(p.d, 0.6), h: ev(p.h, 0.8) };
}

/** Effective dimensions of an item. */
export function itemDims(item, H = 2.7) {
  const m = getModel(item.model);
  const def = modelDefaults(m, H);
  return { w: item.w || def.w, d: item.d || def.d, h: item.h || def.h };
}

/** Resolve all parts of a model for the given dimensions. Invalid parts are skipped. */
export function resolveParts(model, dims, H = 2.7) {
  const out = [];
  for (const part of model.parts || []) {
    let count = 1;
    try { if (part.rep != null) count = Math.max(0, Math.min(64, Math.round(compileExpr(part.rep)({ ...dims, H, i: 0, n: 1 })))); } catch { count = 0; }
    for (let i = 0; i < count; i++) {
      const v = { ...dims, H, i, n: count };
      try {
        const g = (k, def = 0) => (part[k] == null ? def : compileExpr(part[k])(v));
        const p = { s: part.s || 'box', x: g('x'), y: g('y'), z: g('z'), w: g('w', 0.1), h: g('h', 0.1), d: g('d', 0.1), r: g('r'), tp: part.tp == null ? 1 : g('tp', 1), rot: g('rot'), ax: part.ax || 'y', m: part.m || 'main' };
        if (p.w > 0.0005 && p.h > 0.0005 && p.d > 0.0005) out.push(p);
      } catch { /* skip invalid part */ }
    }
  }
  return out;
}

/** Height actually occupied by a model (max y of its parts). */
export function partsTop(parts) { return parts.reduce((m, p) => Math.max(m, p.y + (p.ax === 'z' ? p.d : p.h)), 0); }

/** Validate a model coming from a file or the editor. Throws on fatal problems. */
export function validateModel(m) {
  if (!m || typeof m !== 'object') throw new ExprError('Model must be an object');
  const id = String(m.id || '').replace(/[^\w-]/g, '_').slice(0, 60);
  if (!id) throw new ExprError('Model needs an id');
  const parts = Array.isArray(m.parts) ? m.parts.slice(0, 200) : [];
  for (const p of parts) for (const k of ['x', 'y', 'z', 'w', 'h', 'd', 'r', 'tp', 'rep', 'rot']) if (p[k] != null) compileExpr(p[k]);
  const name = typeof m.name === 'string' ? { it: m.name, en: m.name } : { it: m.name?.it || id, en: m.name?.en || m.name?.it || id };
  return {
    id, name, cat: m.cat || 'custom', color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#c7b8a3',
    params: { w: m.params?.w ?? 0.6, d: m.params?.d ?? 0.6, h: m.params?.h ?? 0.8 }, elevation: +m.elevation || 0,
    tags: Array.isArray(m.tags) ? m.tags.map(String).slice(0, 10) : [], rel: m.rel || undefined,
    parts: parts.map((p) => {
      const o = {}; for (const k of ['s', 'x', 'y', 'z', 'w', 'h', 'd', 'r', 'tp', 'ax', 'm', 'rep', 'rot']) if (p[k] != null) o[k] = p[k];
      if (!['box', 'cyl', 'sph'].includes(o.s)) o.s = 'box';
      return o;
    }),
    custom: true,
  };
}

export function modelName(model, lang = 'it') { return model?.name?.[lang] || model?.name?.it || model?.id || ''; }
