// Auto-furnish panel: room, items to place (kits), objective (presets + weighted terms + user terms),
// optimisation in a Web Worker, preview of up to 3 solutions with a score breakdown.
import { h, uid, escapeHtml } from '../core/util.js';
import { icon, section, openDialog, selectField } from './kit.js';
import { store } from '../core/state.js';
import { derive } from '../model/derive.js';
import { BUILTIN_TERMS, PRESETS, CUSTOM_TEMPLATES, evaluate, enrichItem, makeGridEvaluator, compileCustomTerm } from '../autofurnish/terms.js';
import { buildRoomContext } from '../autofurnish/context.js';
import { KITS } from '../furniture/library.js';
import { allModels, modelName, getModel, modelDefaults, getCustomModels } from '../furniture/models.js';

const ART = {
  balanced: '<rect x="6" y="6" width="108" height="60" rx="3" class="r"/><rect x="10" y="10" width="34" height="24" rx="2" class="f"/><rect x="46" y="10" width="9" height="8" class="f2"/><rect x="98" y="10" width="12" height="34" class="f"/><path d="M60 64 C 60 46, 80 44, 92 30" class="p"/><rect x="54" y="62" width="14" height="6" class="d"/>',
  space: '<rect x="6" y="6" width="108" height="60" rx="3" class="r"/><rect x="10" y="10" width="44" height="10" class="f"/><rect x="100" y="12" width="10" height="40" class="f"/><rect x="10" y="44" width="10" height="18" class="f"/><circle cx="62" cy="38" r="17" class="c"/>',
  light: '<rect x="6" y="6" width="108" height="60" rx="3" class="r"/><rect x="40" y="4" width="40" height="5" class="w"/><path d="M50 12 L44 28 M60 12 L60 28 M70 12 L76 28" class="s"/><rect x="44" y="12" width="32" height="12" class="f"/><rect x="54" y="26" width="12" height="10" class="f2"/>',
  social: '<rect x="6" y="6" width="108" height="60" rx="3" class="r"/><rect x="34" y="10" width="52" height="14" rx="3" class="f"/><rect x="14" y="30" width="16" height="16" rx="3" class="f"/><rect x="90" y="30" width="16" height="16" rx="3" class="f"/><rect x="48" y="32" width="24" height="12" rx="2" class="f2"/><circle cx="60" cy="38" r="22" class="c"/>',
  accessible: '<rect x="6" y="6" width="108" height="60" rx="3" class="r"/><path d="M14 62 L14 40 Q14 34 20 34 L106 34" class="pw"/><rect x="10" y="10" width="40" height="16" class="f"/><rect x="96" y="44" width="14" height="18" class="f"/><rect x="8" y="62" width="14" height="6" class="d"/>',
};
const ART_CSS = '.r{fill:var(--surface-2);stroke:var(--graphite);stroke-width:2}.f{fill:var(--line-strong)}.f2{fill:var(--accent)}.c{fill:none;stroke:var(--ok);stroke-width:1.5;stroke-dasharray:3 3}.p{fill:none;stroke:var(--ok);stroke-width:2.5;stroke-dasharray:4 3}.pw{fill:none;stroke:var(--ok);stroke-width:9;opacity:.35;stroke-linecap:round}.w{fill:var(--dim)}.s{stroke:var(--accent);stroke-width:1.5}.d{fill:var(--surface)}';

export function presetArt(id) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 120 72'); s.setAttribute('class', 'art'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<style>${ART_CSS}</style>${ART[id] || ''}`;
  return s;
}

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('../autofurnish/worker.js', import.meta.url), { type: 'module' });
  return worker;
}

export function furnishPanel(app, opts = {}) {
  const t = app.t; const f = store.floor; const der = derive(f);
  const st = app.ui.furnish ||= { roomId: null, extra: [], preset: 'balanced', weights: null, includeExisting: true, solutions: null, active: 0, running: false, progress: 0 };
  if (opts.roomId) st.roomId = opts.roomId;
  if (!der.rooms.find((r) => r.id === st.roomId)) {
    const selRoom = store.selection?.type === 'room' ? store.selection.id : null;
    st.roomId = selRoom || der.rooms.slice().sort((a, b) => b.area - a.area)[0]?.id || null;
  }
  if (!st.weights) st.weights = weightsFromPreset('balanced');
  if (!der.rooms.length) return [h('p.empty-note', {}, t('af.noRooms'))];
  const room = der.rooms.find((r) => r.id === st.roomId);
  const rerender = () => app.renderPanel();

  // room + items
  const roomSel = selectField(t('af.room'), st.roomId, der.rooms.map((r, i) => [r.id, r.name || t('room.unnamed', { n: i + 1 })]), (v) => { st.roomId = v; st.solutions = null; rerender(); });
  const inRoom = f.items.filter((it) => room && pointIn(it, room.poly));
  const extraList = h('div.chips', {}, ...st.extra.map((m, i) => h('button.chip', { 'aria-pressed': 'true', title: t('af.removeItem'), onclick: () => { st.extra.splice(i, 1); rerender(); } }, `${modelName(getModel(m), app.lang)} ×`)));
  const kitSel = h('select', {}, h('option', { value: '' }, t('af.addKit')), ...KITS.map((k) => h('option', { value: k.id }, k.name[app.lang] || k.name.it)));
  kitSel.addEventListener('change', () => { const k = KITS.find((x) => x.id === kitSel.value); if (k) { st.extra.push(...k.items); rerender(); } });
  const addSel = h('select', {}, h('option', { value: '' }, t('af.addOne')), ...allModels().filter((m) => !(m.tags || []).includes('fixed')).map((m) => h('option', { value: m.id }, modelName(m, app.lang))));
  addSel.addEventListener('change', () => { if (addSel.value) { st.extra.push(addSel.value); rerender(); } });
  const incl = h('input', { type: 'checkbox', checked: st.includeExisting });
  incl.addEventListener('change', () => { st.includeExisting = incl.checked; });

  // presets
  const presets = h('div.preset-grid', {}, ...PRESETS.map((p) => h('button.preset', { 'aria-pressed': String(st.preset === p.id), onclick: () => { st.preset = p.id; st.weights = weightsFromPreset(p.id); rerender(); } },
    presetArt(p.art), h('b', {}, p.name[app.lang] || p.name.it), h('span', {}, p.desc[app.lang] || p.desc.it))));

  // terms
  const termsBox = h('div');
  for (const term of BUILTIN_TERMS) termsBox.append(termRow(app, term, st.weights[term.id] ||= { weight: 0, dir: term.dir }, () => { st.preset = null; updateFormula(); }));
  const customs = app.library.terms || [];
  const customBox = h('div', {}, ...customs.map((c) => customRow(app, c, rerender, () => updateFormula())));
  const formula = h('div.formula');
  const updateFormula = () => {
    const parts = [];
    for (const term of BUILTIN_TERMS) { const w = st.weights[term.id]; if (w?.weight) parts.push(`${w.dir === 'min' ? '−' : '+'} ${w.weight}·${term.id}`); }
    for (const c of customs) if (c.enabled !== false && c.approved !== false && c.weight) parts.push(`${c.dir === 'min' ? '−' : '+'} ${c.weight}·${c.id}`);
    formula.textContent = `J = ${parts.join(' ').replace(/^\+ /, '') || '0'} − 60·${t('af.penalty')}`;
  };
  updateFormula();

  // run / results
  const prog = h('div.progress', {}, h('i', { style: { width: `${Math.round(st.progress * 100)}%` } }));
  const results = h('div');
  if (st.solutions) renderSolutions(app, st, results);
  const runBtn = h('button.btn.primary.block', { disabled: st.running || !room, onclick: () => run(app, st, room, prog, results, rerender) }, icon('wand'), st.running ? t('af.running') : t('af.run'));

  return [
    section(t('af.where'), roomSel, room ? h('p.hint.small', {}, t('af.roomInfo', { n: inRoom.length })) : null),
    section(t('af.what'), h('label.row.hint', {}, incl, t('af.includeExisting')), extraList, h('div.row', {}, kitSel, addSel)),
    section(t('af.goal'), h('p.hint.small', {}, t('af.goalHint')), presets),
    h('details.section', { open: !st.preset }, h('summary', {}, h('b', {}, t('af.terms'))), h('p.hint.small', {}, t('af.termsHint')), formula, termsBox),
    h('details.section', {}, h('summary', {}, h('b', {}, t('af.custom', { n: customs.length }))), h('p.hint.small', {}, t('af.customHint')), customBox,
      h('button.btn.small', { onclick: () => editCustomTerm(app, null, rerender) }, icon('code'), t('af.newTerm'))),
    h('div.section', {}, runBtn, st.running || st.progress > 0 && st.progress < 1 ? prog : null),
    results,
  ];
}

function pointIn(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }

function weightsFromPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  const w = {};
  for (const term of BUILTIN_TERMS) w[term.id] = { weight: p.weights[term.id] || 0, dir: term.dir };
  return w;
}

function termRow(app, term, w, onChange) {
  const out = h('output', {}, String(w.weight));
  const r = h('input', { type: 'range', min: 0, max: 10, step: 1, value: w.weight, 'aria-label': term.name[app.lang] });
  r.addEventListener('input', () => { w.weight = +r.value; out.textContent = r.value; onChange(); });
  const dir = h(`button.dirbtn.${w.dir}`, { type: 'button', title: app.t('af.dirHint'), onclick: () => { w.dir = w.dir === 'max' ? 'min' : 'max'; dir.className = `dirbtn ${w.dir}`; dir.textContent = app.t(`af.${w.dir}`); onChange(); } }, app.t(`af.${w.dir}`));
  return h('div.term', {}, h('span.term-name', {}, term.name[app.lang] || term.name.it), dir, h('span.term-desc', {}, term.desc[app.lang] || term.desc.it), h('div.term-ctl', {}, r, out));
}

function customRow(app, c, rerender, onChange) {
  const t = app.t;
  const pending = c.approved === false;
  const out = h('output', {}, String(c.weight || 0));
  const r = h('input', { type: 'range', min: 0, max: 10, step: 1, value: c.weight || 0, disabled: pending });
  r.addEventListener('input', () => { c.weight = +r.value; out.textContent = r.value; onChange(); });
  r.addEventListener('change', () => app.saveLibrary());
  const dir = h(`button.dirbtn.${c.dir}`, { type: 'button', onclick: () => { c.dir = c.dir === 'max' ? 'min' : 'max'; app.saveLibrary(); rerender(); } }, t(`af.${c.dir}`));
  return h('div.term', {},
    h('span.term-name', {}, icon('code'), c.name || c.id, pending ? h('span.badge.warn', {}, t('af.toReview')) : null), dir,
    h('div.term-ctl', {}, r, out,
      h('button.btn.small.ghost', { onclick: () => editCustomTerm(app, c, rerender) }, pending ? t('af.review') : t('common.edit')),
      h('button.iconbtn', { title: t('common.delete'), onclick: () => { app.library.terms = app.library.terms.filter((x) => x !== c); app.saveLibrary(); rerender(); } }, icon('trash'))));
}

/** Editor dialog for a user-defined objective term. */
export function editCustomTerm(app, term, done) {
  const t = app.t;
  const cur = term ? { ...term } : { id: `t_${Math.random().toString(36).slice(2, 7)}`, name: '', dir: 'max', weight: 5, code: CUSTOM_TEMPLATES[0].code, enabled: true };
  const d = openDialog({ title: term ? t('af.editTerm') : t('af.newTerm'), closeLabel: t('common.close') });
  const name = h('input.input', { value: cur.name, placeholder: t('af.termName') });
  const dirSel = h('select', {}, h('option', { value: 'max', selected: cur.dir === 'max' }, t('af.maxLong')), h('option', { value: 'min', selected: cur.dir === 'min' }, t('af.minLong')));
  const code = h('textarea.code', { spellcheck: 'false', autocapitalize: 'off' }, cur.code);
  code.addEventListener('keydown', (e) => { if (e.key === 'Tab' && app.flags.codeEditorTabs) { e.preventDefault(); const s = code.selectionStart; code.setRangeText('  ', s, code.selectionEnd, 'end'); } });
  const tpl = h('select', {}, h('option', { value: '' }, t('af.templates')), ...CUSTOM_TEMPLATES.map((x) => h('option', { value: x.id }, x.name[app.lang] || x.name.it)));
  tpl.addEventListener('change', () => { const x = CUSTOM_TEMPLATES.find((y) => y.id === tpl.value); if (x) { code.value = x.code; if (!name.value) name.value = x.name[app.lang]; dirSel.value = x.dir; } });
  const result = h('div.hint');
  const test = () => {
    const st = app.ui.furnish || {}; const f = store.floor;
    const built = buildRoomContext(f, st.roomId || derive(f).rooms[0]?.id, {});
    if (!built) { result.textContent = t('af.noRooms'); return; }
    try {
      const term = compileCustomTerm({ id: 'test', code: code.value, dir: dirSel.value, weight: 1 });
      const ctx = built.ctx; ctx.items = built.items.map((i) => enrichItem({ ...i }));
      const ge = makeGridEvaluator(ctx); ctx.grid = () => (ctx._grid ||= ge(ctx.items, ctx.fixed, app.settings.minPassage));
      const r = evaluate(ctx, [term]);
      const err = r.breakdown['test:error'];
      result.innerHTML = err ? `<span style="color:var(--bad)">${escapeHtml(err)}</span>` : escapeHtml(t('af.testValue', { v: (r.breakdown.test ?? 0).toFixed(3) }));
    } catch (e) { result.innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`; }
  };
  const apiDoc = h('details', {}, h('summary.hint', {}, t('af.apiTitle')), h('pre.code.hint', { style: { whiteSpace: 'pre-wrap' } }, t('af.apiDoc')));
  d.body.append(...[
    term?.approved === false ? h('div.issue.warn', {}, icon('warn'), h('span', {}, t('af.reviewWarn'))) : null,
    h('label.field.stack', {}, h('span', {}, t('af.termName')), name),
    h('label.field', {}, h('span', {}, t('af.direction')), dirSel),
    h('div.row', {}, h('span.grow.hint', {}, t('af.codeLabel')), tpl), code, apiDoc,
    h('div.row', {}, h('button.btn.small', { onclick: test }, t('af.test')), result)].filter(Boolean));
  d.foot.append(
    h('button.btn.ghost', { onclick: () => d.close() }, t('common.cancel')),
    h('button.btn.primary', { onclick: () => {
      try { compileCustomTerm({ id: 'x', code: code.value }); } catch (e) { result.innerHTML = `<span style="color:var(--bad)">${escapeHtml(e.message)}</span>`; return; }
      const obj = { ...cur, name: name.value.trim() || cur.id, dir: dirSel.value, code: code.value, approved: true };
      const list = app.library.terms ||= [];
      const i = list.findIndex((x) => x.id === obj.id);
      if (i >= 0) list[i] = obj; else list.push(obj);
      app.saveLibrary(); d.close(); done?.();
    } }, term?.approved === false ? t('af.approveSave') : t('common.save')));
}

function run(app, st, room, prog, results, rerender) {
  const f = store.floor;
  const extraItems = st.extra.map((m) => {
    const d = modelDefaults(getModel(m), f.height);
    return { id: uid('i'), model: m, name: '', x: room.labelPos.x, y: room.labelPos.y, rot: 0, w: null, d: null, h: null, elevation: getModel(m).elevation || 0, color: null, params: {}, _new: true, _dims: d };
  });
  const inRoom = f.items.filter((it) => pointIn(it, room.poly));
  const movable = st.includeExisting ? inRoom.filter((it) => !(getModel(it.model).tags || []).includes('fixed') && !it.locked).map((it) => it.id) : [];
  const built = buildRoomContext(f, room.id, { movableIds: movable, extraItems, minPassage: st.preset === 'accessible' ? Math.max(0.9, app.settings.minPassage) : app.settings.minPassage });
  if (!built || !built.items.length) { app.toast(app.t('af.nothing')); return; }
  st.running = true; st.progress = 0; st.solutions = null; st.extraItems = extraItems;
  rerender();
  const w = getWorker();
  const customs = (app.library.terms || []).filter((c) => c.enabled !== false && c.approved !== false && c.weight > 0).map((c) => ({ id: c.id, code: c.code, dir: c.dir, weight: c.weight, name: c.name }));
  const minPassage = built.ctx && (st.preset === 'accessible' ? Math.max(0.9, app.settings.minPassage) : app.settings.minPassage);
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { st.progress = m.value; const bar = app.panelBody?.querySelector('.progress > i'); if (bar) bar.style.width = `${Math.round(m.value * 100)}%`; }
    else if (m.type === 'termErrors') app.toast(app.t('af.termError', { list: m.errors.map((x) => x.id).join(', ') }), 'bad');
    else if (m.type === 'error') { st.running = false; app.toast(m.message, 'bad'); rerender(); }
    else if (m.type === 'done') {
      st.running = false; st.progress = 1; st.solutions = m.solutions; st.active = 0;
      if (m.solutions.length) previewSolution(app, st, 0);
      rerender();
    }
  };
  w.postMessage({ type: 'run', ctx: built.ctx, items: built.items, weights: st.weights, custom: customs, minPassage, seed: (Date.now() & 0xffff) + 1, restarts: 4, budgetMs: app.flags.mobile ? 5000 : 7000, customModels: getCustomModels() });
}

function previewSolution(app, st, idx) {
  const sol = st.solutions[idx]; if (!sol) return;
  if (!store.inGesture) store.beginGesture();
  const f = store.floor;
  store.commit('autofurnish', () => {
    for (const e of st.extraItems || []) if (!f.items.find((i) => i.id === e.id)) { const { _new, _dims, ...clean } = e; void _new; void _dims; f.items.push(clean); }
    for (const p of sol.items) { const it = f.items.find((i) => i.id === p.id); if (it) { it.x = p.x; it.y = p.y; it.rot = p.rot; } }
  });
  st.active = idx;
}

function renderSolutions(app, st, box) {
  const t = app.t;
  if (!st.solutions.length) { box.append(h('p.empty-note', {}, t('af.noSolution'))); return; }
  const sol = st.solutions[st.active];
  const tabs = h('div.solutions', {}, ...st.solutions.map((s, i) => h(`button.btn.small${i === st.active ? '.accent' : ''}`, { onclick: () => { previewSolution(app, st, i); app.renderPanel(); } }, t('af.solution', { n: i + 1 }))));
  const bars = h('div.bars');
  const allTerms = [...BUILTIN_TERMS, ...(app.library.terms || []).map((c) => ({ id: c.id, name: { it: c.name, en: c.name } }))];
  for (const [k, v] of Object.entries(sol.breakdown)) {
    if (k.startsWith('_') || k.includes(':')) continue;
    const term = allTerms.find((x) => x.id === k); const w = st.weights[k] || (app.library.terms || []).find((c) => c.id === k);
    const isMin = (w?.dir || term?.dir) === 'min';
    bars.append(h('span', {}, term?.name?.[app.lang] || k), h('span.track', {}, h(`i${isMin ? '.min' : ''}`, { style: { width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` } })), h('span', {}, v.toFixed(2)));
  }
  const pen = sol.breakdown._penalty || 0;
  box.append(section(t('af.results'), tabs,
    h('p.hint.small', {}, t('af.score', { j: sol.J.toFixed(1) }), pen > 0.01 ? h('span.badge.bad', {}, ` ${t('af.penaltyLeft')}`) : h('span.badge.ok', {}, ` ${t('af.noPenalty')}`)),
    bars,
    h('div.row', { style: { marginTop: '10px' } },
      h('button.btn.primary', { onclick: () => { store.endGesture('autofurnish'); st.solutions = null; st.extra = []; app.toast(t('af.applied')); app.renderPanel(); } }, icon('check'), t('af.apply')),
      h('button.btn.ghost', { onclick: () => { store.cancelGesture(); st.solutions = null; app.refreshViews(); app.renderPanel(); } }, t('af.discard')))));
}

export function discardFurnishPreview(app) {
  const st = app.ui.furnish;
  if (st?.solutions && store.inGesture) { store.cancelGesture(); st.solutions = null; }
}
