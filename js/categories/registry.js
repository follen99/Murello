// Category registry: which draw.io element becomes which building element.
//
// To add a new *kind* of building element in code, add it to KINDS and teach
// io/plan-extract.js + model/build-project.js how to turn it into geometry.
// To recognise new draw.io shapes, users create *rules* (UI or JSON) — no code change needed.

export const KINDS = {
  wall:      { icon: 'wall',    color: '#3b4148', params: { thickness: null, height: null } },
  room:      { icon: 'room',    color: '#d9e6dd', params: { height: null, floor: null } },
  door:      { icon: 'door',    color: '#b07a4a', params: { height: 2.10, style: 'single' } },
  window:    { icon: 'window',  color: '#5a9fd4', params: { height: 1.20, sill: 0.90 } },
  opening:   { icon: 'opening', color: '#9aa3ab', params: { height: 2.10 } },
  furniture: { icon: 'sofa',    color: '#c9a77c', params: { model: 'box', height: null, elevation: 0, color: null } },
  column:    { icon: 'column',  color: '#7d858c', params: {} },
  stairs:    { icon: 'stairs',  color: '#a99c8a', params: {} },
  dimension: { icon: 'ruler',   color: '#2f6fde', params: {} },
  label:     { icon: 'text',    color: '#666',    params: {} },
  meta:      { icon: 'gear',    color: '#666',    params: {} },
  ignore:    { icon: 'eyeoff',  color: '#aaa',    params: {} },
};
/** Kinds a user can assign to an unknown element. */
export const ASSIGNABLE_KINDS = ['wall', 'room', 'door', 'window', 'opening', 'furniture', 'column', 'stairs', 'dimension', 'label', 'ignore'];

// ---------- furniture name guessing (IT + EN + draw.io floorplan names) ----------
const MODEL_KEYWORDS = [
  ['bed_double', /matrimonial|letto\s*(doppio|2)|double\s*bed|bed_?double|queen|king/],
  ['bed_single', /letto|lettino|\bbeds?\b|bed_?single|bunk/],
  ['sofa3', /divano|sofa|couch|chaise/],
  ['armchair', /poltrona|armchair|recliner/],
  ['coffee_table', /tavolino|coffee/],
  ['table_round', /tavolo\s*(rotondo|tondo)|round\s*table|table_?round/],
  ['office_chair', /office_?chair|sedia\s*(da\s*)?ufficio|girevole/],
  ['chair', /sedi[ae]|chair|sgabell|stool/],
  ['table_rect', /tavol|\btable|dining/],
  ['tv_unit', /\btv\b|tv_|televis|flat_tv|crt_tv|porta\s*tv/],
  ['bookcase', /librer|bookcase|bookshel|scaffal|shelv/],
  ['wardrobe', /armadi|guardaroba|wardrobe|closet/],
  ['nightstand', /comodin|nightstand|bedside/],
  ['dresser', /cassettier|com[oò]\b|dresser|\bchest\b/],
  ['desk', /scrivani|\bdesk|workstation/],
  ['fridge', /frigo|refrigerator|fridge|freezer/],
  ['cooktop_base', /piano\s*cottura|fornell|range|stove|\bhob\b|forno|oven|cooktop/],
  ['washbasin', /lavabo|washbasin|\bbasin|sink_1|lavandino\s*bagno/],
  ['sink_base', /lavell|lavandin|\bsink|lavastovigli|dishwasher/],
  ['island', /isola|island/],
  ['kitchen_linear', /cucina\s*(lineare|componibile)|kitchen|bancone|counter/],
  ['toilet', /\bwc\b|toilet|water|\bvaso\b|bidet/],
  ['shower', /docci|shower/],
  ['bathtub', /vasca|bathtub|\bbath\b|bathtub2/],
  ['washing_machine', /lavatric|asciugatric|washing|washer|dryer/],
  ['plant', /piant|plant|vaso\s*fiori/],
  ['floor_lamp', /lampad|\blamp/],
  ['rug', /tappet|\brug\b|carpet/],
  ['radiator', /termosifon|radiator|calorifer|stufa/],
  ['piano', /pianoforte|\bpiano\b/],
];
export function guessModel(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  for (const [id, re] of MODEL_KEYWORDS) if (re.test(t)) return id;
  return null;
}

// ---------- builtin rules ----------
// A rule: { id, name, kind, params, when: [{field, op, value, key}] | code }
// fields: shape, style, label, attr, fill, type ('edge'|'vertex')
export const BUILTIN_RULES = [
  { id: 'b-meta', name: 'Murello meta', kind: 'meta', when: [{ field: 'label', op: 'regex', value: '^\\s*(murello|fp3d)\\s*:' }] },
  { id: 'b-fp-door', name: 'draw.io Floorplan · door', kind: 'door', when: [{ field: 'shape', op: 'regex', value: 'floorplan\\.door' }] },
  { id: 'b-fp-window', name: 'draw.io Floorplan · window', kind: 'window', when: [{ field: 'shape', op: 'regex', value: 'floorplan\\.window' }] },
  { id: 'b-fp-wall', name: 'draw.io Floorplan · wall', kind: 'wall', when: [{ field: 'shape', op: 'regex', value: 'floorplan\\.wall' }] },
  { id: 'b-fp-room', name: 'draw.io Floorplan · room', kind: 'room', when: [{ field: 'shape', op: 'regex', value: 'floorplan\\.room' }] },
  { id: 'b-fp-dim', name: 'draw.io Floorplan · dimension', kind: 'dimension', when: [{ field: 'shape', op: 'regex', value: 'dimension' }] },
  { id: 'b-fp-stairs', name: 'draw.io Floorplan · stairs', kind: 'stairs', when: [{ field: 'shape', op: 'regex', value: 'floorplan\\.(stairs|spiralstairs|stairsrest)' }] },
  { id: 'b-fp-furn', name: 'draw.io Floorplan · furniture', kind: 'furniture', auto: 'model', when: [{ field: 'shape', op: 'regex', value: 'floorplan\\.' }] },
  { id: 'b-kw-door', name: 'Label: door', kind: 'door', when: [{ field: 'label', op: 'regex', value: '^(porta|door|portone|ingresso)\\b' }] },
  { id: 'b-kw-window', name: 'Label: window', kind: 'window', when: [{ field: 'label', op: 'regex', value: '^(finestra|window|portafinestra|lucernario)\\b' }] },
  { id: 'b-kw-opening', name: 'Label: opening', kind: 'opening', when: [{ field: 'label', op: 'regex', value: '^(varco|arco|passaggio|opening|arch)\\b' }] },
  { id: 'b-kw-column', name: 'Label: column', kind: 'column', when: [{ field: 'label', op: 'regex', value: '^(pilastro|colonna|column|pillar)\\b' }] },
  { id: 'b-kw-stairs', name: 'Label: stairs', kind: 'stairs', when: [{ field: 'label', op: 'regex', value: '^(scala|scale|stairs?)\\b' }] },
];

function fieldValue(cell, f) {
  switch (f.field) {
    case 'shape': return cell.shapeName;
    case 'style': return cell.styleRaw;
    case 'label': return cell.text;
    case 'fill': return cell.style.fillColor || '';
    case 'type': return cell.edge ? 'edge' : 'vertex';
    case 'attr': return cell.attrs?.[f.key] ?? '';
    default: return '';
  }
}
function testCond(cell, c) {
  const val = String(fieldValue(cell, c) ?? '');
  const want = String(c.value ?? '');
  switch (c.op) {
    case 'equals': return val.toLowerCase() === want.toLowerCase();
    case 'contains': return val.toLowerCase().includes(want.toLowerCase());
    case 'startsWith': return val.toLowerCase().startsWith(want.toLowerCase());
    case 'regex': try { return new RegExp(want, 'i').test(val); } catch { return false; }
    case 'exists': return val !== '';
    default: return false;
  }
}

const compiledCode = new Map();
function testCode(rule, cell) {
  let fn = compiledCode.get(rule.code);
  if (!fn) {
    // User-authored matcher. Executed only for rules the user created or explicitly approved.
    fn = new Function('cell', `"use strict";\n${rule.code}`);
    compiledCode.set(rule.code, fn);
  }
  return !!fn(Object.freeze({ shape: cell.shapeName, style: { ...cell.style }, label: cell.text, attrs: { ...cell.attrs }, isEdge: cell.edge, width: cell.box?.w, height: cell.box?.h }));
}

export function ruleMatches(rule, cell) {
  if (rule.enabled === false) return false;
  if (rule.code && rule.approved === false) return false;
  if (rule.code) { try { return testCode(rule, cell); } catch { return false; } }
  const conds = Array.isArray(rule.when) ? rule.when : rule.when ? [rule.when] : [];
  return conds.length > 0 && conds.every((c) => testCond(cell, c));
}

/** Short, stable signature used to group unknown elements and to create rules from them. */
export function cellSignature(cell) {
  if (cell.edge) return 'edge';
  return cell.shapeName || 'rectangle';
}

const RECT_LIKE = new Set(['', 'rect', 'rectangle', 'rounded', 'whitespace', 'swimlane', 'label', 'process', 'mxgraph.basic.rect', 'mxgraph.floorplan.room']);

/**
 * Classify one parsed draw.io cell.
 * @returns {{kind:string, params:object, rule?:object, heuristic?:boolean, unknown?:boolean}}
 */
export function classifyCell(cell, userRules = []) {
  // 1. Our own exported data wins.
  const own = cell.attrs?.murello_kind;
  if (own && KINDS[own]) {
    let data = {};
    try { data = JSON.parse(cell.attrs.murello_data || '{}'); } catch { /* ignore */ }
    return { kind: own, params: data, own: true };
  }
  // 2. User rules, then builtin rules.
  for (const r of userRules) if (ruleMatches(r, cell)) return { kind: r.kind, params: { ...(r.params || {}) }, rule: r };
  for (const r of BUILTIN_RULES) {
    if (ruleMatches(r, cell)) {
      const params = { ...(r.params || {}) };
      if (r.auto === 'model') params.model = guessModel(cell.shapeName + ' ' + cell.text) || 'box';
      if (r.kind === 'door') Object.assign(params, doorStyleFromShape(cell.shapeName));
      return { kind: r.kind, params, rule: r };
    }
  }
  // 3. Heuristics.
  const st = cell.style;
  if (cell.edge) {
    const sa = st.startArrow && st.startArrow !== 'none';
    const ea = st.endArrow == null ? true : st.endArrow !== 'none';
    if (sa && ea) return { kind: 'dimension', params: {}, heuristic: true };
    return { kind: 'wall', params: {}, heuristic: true };
  }
  if (!cell.box) return { kind: 'ignore', params: {} };
  const shape = cell.shapeName;
  if (shape === 'group' || (cell.hasChildren && !cell.text && (st.fillColor === 'none' || !st.fillColor) && (st.strokeColor === 'none'))) return { kind: 'ignore', params: {} };
  if (shape === 'line' || st.line || st._first === 'line') return { kind: 'wall', params: {}, heuristic: true, lineVertex: true };
  const isText = st._first === 'text' || st.text || shape === 'text' || ((st.strokeColor === 'none' || !st.strokeColor && st.text) && (st.fillColor === 'none' || !st.fillColor) && cell.text);
  if (isText) return { kind: 'label', params: {}, heuristic: true };
  if (RECT_LIKE.has(shape.toLowerCase()) || st.rounded !== undefined && !st.shape) {
    const { w, h } = cell.box; const thin = Math.min(w, h) / Math.max(w, h || 1);
    const fill = st.fillColor && st.fillColor !== 'none' ? st.fillColor : '#ffffff';
    const lum = lumOf(fill);
    if (thin < 1 / 6 && lum != null && lum < 0.45) return { kind: 'wall', params: {}, heuristic: true, thickRect: true };
    const m = guessModel(cell.text);
    return { kind: 'room', params: {}, heuristic: true, furnitureGuess: m };
  }
  return { kind: 'unknown', params: {}, unknown: true };
}

function lumOf(hex) {
  const h = String(hex).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export function doorStyleFromShape(shape) {
  const s = String(shape || '').toLowerCase();
  if (/double|opposing|uneven/.test(s)) return { style: 'double' };
  if (/sliding|pocket|accordion|bifold/.test(s)) return { style: 'sliding' };
  if (/garage|overhead/.test(s)) return { style: 'garage' };
  if (/right/.test(s)) return { style: 'single', hinge: 'right' };
  return { style: 'single', hinge: 'left' };
}

/** Prepare a parsed cell for classification (computes shapeName). */
export function prepareCell(cell) {
  const st = cell.style;
  let shape = st.shape || '';
  if (!shape) {
    const f = st._first || '';
    if (f && !/^(html|whitespace|rounded)$/i.test(f)) shape = f;
  }
  if (!shape && st.ellipse) shape = 'ellipse';
  cell.shapeName = shape;
  return cell;
}

/** Validate & normalise a user rule (from UI or JSON import). */
export function normaliseRule(r) {
  const kind = KINDS[r.kind] ? r.kind : 'ignore';
  return {
    id: r.id || `r_${Math.random().toString(36).slice(2, 9)}`,
    name: String(r.name || kind).slice(0, 80),
    kind,
    params: typeof r.params === 'object' && r.params ? r.params : {},
    when: Array.isArray(r.when) ? r.when.filter((c) => c && c.field && c.op).map((c) => ({ field: c.field, op: c.op, value: String(c.value ?? ''), key: c.key })) : [],
    code: r.code ? String(r.code) : undefined,
    enabled: r.enabled !== false,
    approved: r.approved === true || !r.code,
  };
}
