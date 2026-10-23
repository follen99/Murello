// Recognition rules ("categories"): how draw.io shapes become building elements.
// Users add their own rules with a form (shape name / style / label / Edit-Data property) or, for full
// flexibility, with a small JavaScript predicate. Rules can be exported/imported as JSON.
import { h, uid, download, readFileAsText } from '../core/util.js';
import { icon, section, openDialog, selectField } from './kit.js';
import { BUILTIN_RULES, ASSIGNABLE_KINDS, normaliseRule, KINDS } from '../categories/registry.js';
import { allModels, modelName } from '../furniture/models.js';
import { serializeLibrary, parseLibrary } from '../io/project-io.js';

const FIELDS = ['shape', 'label', 'style', 'attr', 'fill', 'type'];
const OPS = ['equals', 'contains', 'startsWith', 'regex', 'exists'];

export function rulesPanel(app) {
  const t = app.t;
  const rules = app.library.rules;
  const rows = rules.map((r) => h('div.list-row', {},
    (() => { const c = h('input', { type: 'checkbox', checked: r.enabled !== false, title: t('rules.enabled') }); c.addEventListener('change', () => { r.enabled = c.checked; app.saveLibrary(); }); return c; })(),
    h('span.grow', { onclick: () => editRule(app, r) }, h('b', {}, r.name), h('br'), h('small', {}, `${describe(app, r)} → ${t(`kind.${r.kind}`)}`)),
    r.code && r.approved === false ? h('span.badge.warn', {}, t('af.toReview')) : null,
    h('button.iconbtn', { title: t('common.edit'), onclick: () => editRule(app, r) }, icon('pencil')),
    h('button.iconbtn', { title: t('common.delete'), onclick: () => { app.library.rules = app.library.rules.filter((x) => x !== r); app.saveLibrary(); app.renderPanel(); } }, icon('trash'))));
  const fileIn = h('input', { type: 'file', accept: '.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0]; if (!file) return;
    try {
      const lib = parseLibrary(await readFileAsText(file));
      const n = app.mergeLibrary(lib, { fromFile: true });
      app.toast(t('rules.imported', n));
    } catch { app.toast(t('rules.importError'), 'bad'); }
  });
  return [
    h('p.hint', {}, t('rules.intro')),
    section(t('rules.mine', { n: rules.length }), rows.length ? h('div.list', {}, ...rows) : h('p.empty-note', {}, t('rules.none')),
      h('div.row', { style: { marginTop: '8px' } }, h('button.btn.small', { onclick: () => editRule(app, null) }, icon('plus'), t('rules.new')))),
    section(t('rules.share'), h('div.row', {},
      h('button.btn.small', { onclick: () => download('murello-libreria.json', serializeLibrary(app.library), 'application/json') }, icon('download'), t('rules.export')),
      h('button.btn.small', { onclick: () => fileIn.click() }, icon('upload'), t('rules.import')), fileIn),
      h('p.hint.small', {}, t('rules.shareHint'))),
    h('details.section', {}, h('summary', {}, h('b', {}, t('rules.builtin', { n: BUILTIN_RULES.length }))),
      h('p.hint.small', {}, t('rules.builtinHint')),
      h('div.list', {}, ...BUILTIN_RULES.map((r) => h('div.list-row', {}, h('span.grow', {}, h('small', {}, `${describe(app, r)} → ${t(`kind.${r.kind}`)}`)))))),
    h('details.section', {}, h('summary', {}, h('b', {}, t('rules.kinds'))), h('p.hint.small', {}, t('rules.kindsHint')),
      h('div.list', {}, ...Object.keys(KINDS).filter((k) => k !== 'meta').map((k) => h('div.list-row', {}, h('span.dot', { style: { background: KINDS[k].color } }), h('span.grow', {}, t(`kind.${k}`)), h('small', {}, k))))),
  ];
}

function describe(app, r) {
  if (r.code) return app.t('rules.codeRule');
  return (r.when || []).map((c) => `${app.t(`rules.f.${c.field}`)}${c.key ? `[${c.key}]` : ''} ${app.t(`rules.op.${c.op}`)} “${c.value}”`).join(' ∧ ');
}

export function editRule(app, rule) {
  const t = app.t;
  const r = rule ? JSON.parse(JSON.stringify(rule)) : { id: uid('rule'), name: '', kind: 'furniture', params: {}, when: [{ field: 'shape', op: 'equals', value: '' }], enabled: true };
  const d = openDialog({ title: rule ? t('rules.edit') : t('rules.new'), closeLabel: t('common.close') });
  let advanced = !!r.code;
  const render = () => {
    const name = h('input.input', { value: r.name, placeholder: t('rules.namePh') });
    name.addEventListener('input', () => { r.name = name.value; });
    const conds = h('div');
    const drawConds = () => conds.replaceChildren(...r.when.map((c, i) => {
      const fs = h('select', {}, FIELDS.map((f) => h('option', { value: f, selected: f === c.field }, t(`rules.f.${f}`))));
      const os = h('select', {}, OPS.map((o) => h('option', { value: o, selected: o === c.op }, t(`rules.op.${o}`))));
      const key = h('input.input', { value: c.key || '', placeholder: t('rules.keyPh'), style: { width: '110px', display: c.field === 'attr' ? '' : 'none' } });
      const val = h('input.input', { value: c.value, placeholder: t('rules.valuePh') });
      fs.addEventListener('change', () => { c.field = fs.value; key.style.display = c.field === 'attr' ? '' : 'none'; });
      os.addEventListener('change', () => { c.op = os.value; });
      key.addEventListener('input', () => { c.key = key.value; });
      val.addEventListener('input', () => { c.value = val.value; });
      return h('div.row', { style: { marginBottom: '6px' } }, fs, key, os, h('span.grow', {}, val), r.when.length > 1 ? h('button.iconbtn', { onclick: () => { r.when.splice(i, 1); drawConds(); } }, icon('close')) : null);
    }));
    drawConds();
    const params = h('div');
    const drawParams = () => {
      params.replaceChildren();
      const num = (k, label, def) => { const i = h('input', { type: 'number', step: 0.01, value: r.params[k] ?? def ?? '' }); i.addEventListener('change', () => { r.params[k] = i.value === '' ? null : +i.value; }); return h('label.field', {}, h('span', {}, label), h('span.unit-input', {}, i, h('em', {}, 'm'))); };
      if (r.kind === 'furniture') {
        params.append(selectField(t('insp.model'), r.params.model || 'box', allModels().map((m) => [m.id, modelName(m, app.lang)]), (v) => { r.params.model = v; }), num('height', t('insp.height')), num('elevation', t('insp.elevation'), 0));
        const col = h('input', { type: 'color', value: r.params.color || '#c7b8a3' }); col.addEventListener('input', () => { r.params.color = col.value; });
        params.append(h('label.field', {}, h('span', {}, t('insp.color')), col));
      } else if (r.kind === 'window') params.append(num('height', t('insp.height'), 1.2), num('sill', t('insp.sill'), 0.9));
      else if (r.kind === 'door') { params.append(num('height', t('insp.height'), 2.1), selectField(t('insp.style'), r.params.style || 'single', ['single', 'double', 'sliding', 'none'].map((s) => [s, t(`ostyle.${s}`)]), (v) => { r.params.style = v; })); }
      else if (r.kind === 'opening') params.append(num('height', t('insp.height'), 2.1));
      else if (r.kind === 'wall') params.append(num('thickness', t('insp.thickness')), num('height', t('insp.wallHeight')));
    };
    const kind = selectField(t('rules.becomes'), r.kind, ASSIGNABLE_KINDS.map((k) => [k, t(`kind.${k}`)]), (v) => { r.kind = v; r.params = {}; drawParams(); });
    drawParams();
    const code = h('textarea.code', { spellcheck: 'false' }, r.code || "// cell: { shape, style, label, attrs, isEdge, width, height }\nreturn cell.shape === 'mxgraph.floorplan.fireplace';");
    code.addEventListener('input', () => { r.code = code.value; });
    d.body.replaceChildren(
      h('label.field.stack', {}, h('span', {}, t('rules.name')), name),
      h('div.seg', { style: { margin: '10px 0' } },
        h('button', { 'aria-pressed': String(!advanced), onclick: () => { advanced = false; delete r.code; render(); } }, t('rules.simple')),
        h('button', { 'aria-pressed': String(advanced), onclick: () => { advanced = true; r.code = code.value; render(); } }, t('rules.advanced'))),
      advanced ? h('div', {}, h('p.hint.small', {}, t('rules.codeHint')), code)
        : h('div', {}, h('p.hint.small', {}, t('rules.whenHint')), conds, h('button.btn.small.ghost', { onclick: () => { r.when.push({ field: 'label', op: 'contains', value: '' }); drawConds(); } }, icon('plus'), t('rules.addCond'))),
      h('hr.divider'), kind, params,
      h('p.hint.small', {}, t('rules.findShape')));
  };
  render();
  d.foot.append(h('button.btn.ghost', { onclick: () => d.close() }, t('common.cancel')), h('button.btn.primary', { onclick: () => {
    if (advanced) { try { new Function('cell', r.code); } catch (e) { app.toast(e.message, 'bad'); return; } r.approved = true; } else delete r.code;
    const nr = normaliseRule({ ...r, approved: true });
    if (!nr.code && !nr.when.length) { app.toast(t('rules.needCond'), 'bad'); return; }
    const list = app.library.rules; const i = list.findIndex((x) => x.id === nr.id);
    if (i >= 0) list[i] = nr; else list.push(nr);
    app.saveLibrary(); d.close(); app.renderPanel();
  } }, t('common.save')));
}
