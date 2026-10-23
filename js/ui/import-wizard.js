// Import wizard: file → recognition of elements (unknown ones: ignore or assign a category) →
// measurement check (missing / inconsistent measures, highlighted on a preview) → project.
import { h, debounce, readFileAsText, fmtLen, uid } from '../core/util.js';
import { openDialog, icon, selectField, switchField, lengthField } from './kit.js';
import { parseDrawio, DrawioError } from '../io/drawio-parser.js';
import { extractPage } from '../io/plan-extract.js';
import { solvePlan } from '../io/solver.js';
import { projectFromPages, updateStructure } from '../io/build-project.js';
import { parseProject } from '../io/project-io.js';
import { ASSIGNABLE_KINDS, normaliseRule } from '../categories/registry.js';
import { allModels, modelName } from '../furniture/models.js';
import { store } from '../core/state.js';

const STATUS_COLORS = { measured: '#30353b', derived: '#4f7fd6', estimated: '#d9962a', missing: '#e9a92b', conflict: '#d64545' };

export function openImportWizard(app, preset = null) {
  const t = app.t;
  const S = {
    step: 1, doc: null, fileName: '', pages: [], active: 0, unknownMode: 'ignore', assignments: {}, remember: {},
    opts: { mode: app.settings.measureMode, extThickness: app.settings.extThickness, intThickness: app.settings.intThickness, assumeAlign: true, defaultUnit: app.settings.defaultUnit, wallHeight: app.settings.wallHeight },
    perPage: [], useEstimates: false, focus: null, acceptConflicts: false,
  };
  const d = openDialog({ title: t('import.title'), closeLabel: t('common.close') });
  const steps = h('div.steps');
  d.dlg.querySelector('.dlg-inner').insertBefore(steps, d.body);

  const renderSteps = () => {
    steps.replaceChildren(...[t('import.step1'), t('import.step2'), t('import.step3')].map((label, i) =>
      h(`span${S.step === i + 1 ? '.on' : S.step > i + 1 ? '.done' : ''}`, {}, h('b', {}, S.step > i + 1 ? '✓' : String(i + 1)), label)));
  };

  // ---------------------------------------------------------------- step 1: file
  const step1 = () => {
    S.step = 1; renderSteps(); d.setTitle(t('import.title'));
    const input = h('input', { type: 'file', accept: '.drawio,.xml,.json,.murello,.svg', hidden: true });
    input.addEventListener('change', () => input.files[0] && loadFile(input.files[0]));
    const drop = h('div.drop', { tabindex: 0, role: 'button', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); } },
      icon('upload'), h('b', {}, t('import.drop')), h('span.hint', {}, t('import.dropHint')), input);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
    const examples = h('div.row', {},
      h('span.hint', {}, t('import.examples')),
      h('button.btn.small', { onclick: () => loadUrl('examples/appartamento.drawio') }, t('import.exApartment')),
      h('button.btn.small', { onclick: () => loadUrl('examples/bilocale-misure-mancanti.drawio') }, t('import.exStudio')),
    );
    const how = h('details', {}, h('summary', {}, t('import.howTitle')), h('ol.hint', {}, ...t('import.howSteps').split('|').map((s) => h('li', {}, s))));
    d.body.replaceChildren(drop, h('div.section', {}, examples), how);
    d.foot.replaceChildren(h('span.grow', {}, t('import.privacy')), h('button.btn.ghost', { onclick: () => d.close() }, t('common.cancel')));
  };

  async function loadUrl(url) {
    try { const r = await fetch(url); const txt = await r.text(); await loadText(txt, url.split('/').pop()); } catch (e) { app.toast(t('import.errFetch'), 'bad'); }
  }
  async function loadFile(file) { try { await loadText(await readFileAsText(file), file.name); } catch { app.toast(t('import.errRead'), 'bad'); } }
  async function loadText(text, name) {
    S.fileName = name;
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      try {
        const p = parseProject(trimmed);
        d.close();
        app.loadProject(p, { fromFile: name });
        return;
      } catch (e) { app.toast(t(`import.err.${e.message}`) || t('import.errProject'), 'bad'); return; }
    }
    try { S.doc = await parseDrawio(trimmed); }
    catch (e) { app.toast(e instanceof DrawioError ? t(`import.err.${e.message}`) : t('import.errXml'), 'bad'); return; }
    S.perPage = S.doc.pages.map(() => ({ userMeasures: {}, overrides: {}, angles: {} }));
    // apply meta mode of first page if present
    const firstMeta = extractPage(S.doc.pages[0], {}).meta;
    if (firstMeta.mode) S.opts.mode = firstMeta.mode;
    if (firstMeta.height) S.opts.wallHeight = firstMeta.height;
    analyse();
    step2();
  }

  function analyse() {
    const userRules = app.library.rules.filter((r) => r.enabled !== false);
    const assignments = S.unknownMode === 'assign' ? S.assignments : {};
    S.pages = S.doc.pages.map((page, i) => {
      const raw = extractPage(page, { userRules, assignments, defaultUnit: S.opts.defaultUnit });
      const pp = S.perPage[i];
      const res = solvePlan(raw, { ...S.opts, mode: raw.meta.mode || S.opts.mode, userMeasures: pp.userMeasures, overrides: pp.overrides, angles: pp.angles, useEstimates: S.useEstimates });
      return { page, raw, res };
    });
  }

  // ---------------------------------------------------------------- step 2: recognition
  const step2 = () => {
    S.step = 2; renderSteps(); d.setTitle(t('import.recognitionTitle', { file: S.fileName }));
    const body = [];
    S.pages.forEach(({ page, raw }, pi) => {
      const chips = Object.entries(raw.counts).filter(([k]) => k !== 'ignore' && k !== 'meta').map(([k, n]) => h(`span.badge${k === 'unknown' ? '.warn' : ''}`, {}, `${t(`kind.${k}`)} · ${n}`));
      body.push(h('div.section', {}, h('h3', {}, page.name, h('span.count', {}, `· ${t('import.pageOf', { i: pi + 1, n: S.pages.length })}`)), h('div.summary-chips', {}, chips)));
      if (!raw.segments.length) body.push(h('p.issue.bad', {}, icon('warn'), t('import.noWalls')));
    });
    const unknowns = groupUnknowns();
    const optsBox = h('div.section', {}, h('h3', {}, t('import.options')),
      selectField(t('import.measureMode'), S.opts.mode, [['net', t('import.modeNet')], ['axis', t('import.modeAxis')]], (v) => { S.opts.mode = v; }),
      h('p.hint.small', {}, t('import.modeHint')),
      selectField(t('import.defaultUnit'), S.opts.defaultUnit, [['auto', t('import.unitAuto')], ['cm', 'cm'], ['m', 'm']], (v) => { S.opts.defaultUnit = v; }),
      lengthField(app, t('import.extThk'), S.opts.extThickness, (v) => { S.opts.extThickness = v; }, { min: 0.03, max: 1 }),
      lengthField(app, t('import.intThk'), S.opts.intThickness, (v) => { S.opts.intThickness = v; }, { min: 0.03, max: 1 }),
      lengthField(app, t('import.height'), S.opts.wallHeight, (v) => { S.opts.wallHeight = v; }, { min: 1.5, max: 8 }),
      switchField(t('import.assumeAlign'), S.opts.assumeAlign, (v) => { S.opts.assumeAlign = v; }),
    );
    const left = h('div');
    if (unknowns.length) {
      const seg = h('div.seg', { role: 'tablist' },
        h('button', { 'aria-pressed': String(S.unknownMode === 'ignore'), onclick: () => { S.unknownMode = 'ignore'; analyse(); step2(); } }, t('import.unkIgnore')),
        h('button', { 'aria-pressed': String(S.unknownMode === 'assign'), onclick: () => { S.unknownMode = 'assign'; analyse(); step2(); } }, t('import.unkAssign')));
      left.append(h('div.section', {}, h('h3', {}, t('import.unknownTitle', { n: unknowns.reduce((s, u) => s + u.items.length, 0) })),
        h('p.hint', {}, t('import.unknownHint')), seg,
        h('p.hint.small', {}, S.unknownMode === 'ignore' ? t('import.unkIgnoreHint') : t('import.unkAssignHint'))));
      if (S.unknownMode === 'assign') left.append(...unknowns.map(renderUnknown));
    } else left.append(h('div.section', {}, h('p.empty-note', {}, t('import.allKnown'))));
    d.body.replaceChildren(h('div.import-grid', {}, h('div', {}, ...body, left), optsBox));
    d.foot.replaceChildren(
      h('button.btn.ghost', { onclick: step1 }, t('common.back')), h('span.grow'),
      h('button.btn.primary', { onclick: () => { saveRemembered(); analyse(); step3(); } }, t('import.toMeasures')),
    );
  };

  function groupUnknowns() {
    const map = new Map();
    // unknowns as found with no assignment (re-extract without assignments to list them all)
    const userRules = app.library.rules.filter((r) => r.enabled !== false);
    S.doc.pages.forEach((page) => {
      const raw = extractPage(page, { userRules, assignments: {} });
      for (const u of raw.unknowns) {
        const key = `sig:${u.sig}`;
        if (!map.has(key)) map.set(key, { key, sig: u.sig, items: [], text: u.text });
        map.get(key).items.push(u);
      }
    });
    return [...map.values()];
  }
  function renderUnknown(group) {
    const cur = S.assignments[group.key] || { kind: 'ignore', params: {} };
    const cv = h('canvas', { width: 112, height: 88 });
    drawShapeThumb(cv, group.items[0]);
    const kindSel = h('select', {}, ASSIGNABLE_KINDS.map((k) => h('option', { value: k, selected: k === cur.kind }, t(`kind.${k}`))));
    const extra = h('div.row');
    const renderExtra = () => {
      extra.replaceChildren();
      const a = S.assignments[group.key];
      if (a?.kind === 'furniture') {
        const ms = h('select', {}, allModels().map((m) => h('option', { value: m.id, selected: m.id === (a.params.model || 'box') }, modelName(m, app.lang))));
        ms.addEventListener('change', () => { a.params.model = ms.value; });
        extra.append(ms);
      }
      if (a && a.kind !== 'ignore') {
        const rem = h('input', { type: 'checkbox', checked: !!S.remember[group.key] });
        rem.addEventListener('change', () => { S.remember[group.key] = rem.checked; });
        extra.append(h('label.row.hint.small', {}, rem, t('import.remember')));
      }
    };
    kindSel.addEventListener('change', () => {
      S.assignments[group.key] = { kind: kindSel.value, params: kindSel.value === 'furniture' ? { model: 'box' } : {} };
      renderExtra();
    });
    if (!S.assignments[group.key]) S.assignments[group.key] = { ...cur };
    renderExtra();
    const label = group.text ? `«${group.text.slice(0, 40)}»` : t('import.noLabel');
    return h('div.unk', {}, cv, h('div', {}, h('b', {}, label), h('div.meta', {}, `${t('import.shape')}: ${group.sig} · ${group.items.length}×`), h('div.row', {}, kindSel), extra));
  }
  function saveRemembered() {
    if (S.unknownMode !== 'assign') return;
    let added = 0;
    for (const [key, on] of Object.entries(S.remember)) {
      if (!on) continue;
      const a = S.assignments[key]; if (!a || a.kind === 'ignore') continue;
      const sig = key.slice(4);
      const g = groupUnknowns().find((x) => x.key === key);
      const when = [{ field: 'shape', op: 'equals', value: sig }];
      if (g?.text && ['ellipse', 'rectangle', 'rect', 'rounded', 'edge'].includes(sig)) when.push({ field: 'label', op: 'equals', value: g.text });
      app.library.rules.push(normaliseRule({ id: uid('rule'), name: g?.text || sig, kind: a.kind, params: a.params, when }));
      added++;
    }
    if (added) { app.saveLibrary(); app.toast(t('import.rulesSaved', { n: added })); }
  }

  // ---------------------------------------------------------------- step 3: measures
  const resolveLater = debounce(() => { analyse(); step3(true); }, 250);
  const step3 = (keepScroll = false) => {
    S.step = 3; renderSteps(); d.setTitle(t('import.measuresTitle'));
    const scroll = d.body.scrollTop;
    const P = S.pages[S.active];
    const tabs = S.pages.length > 1 ? h('div.chips', {}, S.pages.map((p, i) => {
      const n = p.res.issues.missing.length + p.res.issues.conflicts.length;
      return h('button.chip', { 'aria-pressed': String(i === S.active), onclick: () => { S.active = i; S.focus = null; step3(); } }, p.page.name, n ? ` · ${n}` : ' ✓');
    })) : null;
    const cv = h('canvas');
    const box = h('div.preview-box', {}, cv);
    const legend = h('div.legend', {}, ...['measured', 'derived', 'estimated', 'missing', 'conflict'].map((k) => h('span', {}, h('i', { style: { background: STATUS_COLORS[k] } }), t(`import.st.${k}`))));
    const issues = renderIssues(P);
    const r = P.res;
    const summary = h('div.summary-chips', {},
      h('span.badge', {}, `${t('import.walls')} · ${r.walls.length}`), h('span.badge', {}, `${t('import.rooms')} · ${r.rooms.length}`),
      r.issues.missing.length ? h('span.badge.warn', {}, `${t('import.missing')} · ${r.issues.missing.length}`) : h('span.badge.ok', {}, t('import.noMissing')),
      r.issues.conflicts.length ? h('span.badge.bad', {}, `${t('import.conflicts')} · ${r.issues.conflicts.length}`) : null,
      r.issues.assumptions ? h('span.badge.dim', { title: t('import.assumptionsHint') }, `${t('import.assumptions')} · ${r.issues.assumptions}`) : null,
    );
    d.body.replaceChildren(tabs || '', h('div.import-grid', {}, h('div', {}, box, legend, h('p.hint.small', {}, t('import.previewHint'))), h('div', {}, summary, issues)));
    requestAnimationFrame(() => drawPreview(cv, P));
    const allMissing = S.pages.reduce((s, p) => s + p.res.issues.missing.length, 0);
    const allConf = S.pages.reduce((s, p) => s + p.res.issues.conflicts.length, 0);
    const ok = (allMissing === 0 || S.useEstimates) && (allConf === 0 || S.acceptConflicts);
    const createBtn = h('button.btn.primary', { disabled: !ok, onclick: create }, t('import.create'));
    d.foot.replaceChildren(
      h('button.btn.ghost', { onclick: step2 }, t('common.back')),
      h('span.grow', {}, ok ? t('import.ready') : allMissing ? t('import.needMissing', { n: allMissing }) : t('import.needConflicts', { n: allConf })),
      createBtn,
    );
    if (keepScroll) d.body.scrollTop = scroll;
  };

  function renderIssues(P) {
    const out = h('div');
    const pp = S.perPage[S.active];
    const r = P.res;
    if (r.issues.notes.some((n) => n.code === 'noMeasures')) out.append(h('div.issue.warn', {}, icon('warn'), h('span', {}, t('import.noMeasures'))));
    r.issues.missing.forEach((m, i) => {
      const id = `m${i}`;
      const isAngle = m.kind === 'angle';
      const inp = h('input', { type: 'number', inputmode: 'decimal', step: isAngle ? 0.5 : app.settings.units === 'cm' ? 1 : 0.01, placeholder: isAngle ? String(m.estimate) : app.settings.units === 'cm' ? String(Math.round(m.estimate * 100)) : m.estimate.toFixed(2) });
      const commit = () => {
        const v = parseFloat(String(inp.value).replace(',', '.')); if (!isFinite(v) || v <= 0) return;
        if (isAngle) pp.angles[m.key] = v; else pp.userMeasures[m.key] = app.settings.units === 'cm' ? v / 100 : v;
        S.focus = null; analyse(); step3(true);
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('focus', () => { S.focus = { type: 'missing', m }; redrawPreview(); });
      const what = isAngle ? t('import.askAngle') : m.free ? t(`import.askFree.${m.kind}`) : t(`import.askWall.${m.kind}`);
      out.append(h(`div.ask${S.focus?.m === m ? '.focus' : ''}`, { id, onmouseenter: () => { S.focus = { type: 'missing', m }; redrawPreview(); } },
        h('p', {}, h('b', {}, t('import.missingN', { n: i + 1 })), ' ', what),
        h('div.row', {}, h('span.unit-input', {}, inp, h('em', {}, isAngle ? '°' : app.settings.units === 'cm' ? 'cm' : 'm')),
          h('button.btn.small', { onclick: commit }, t('common.apply')),
          h('span.hint.small', {}, t('import.estimate', { v: isAngle ? `${m.estimate}°` : fmtLen(m.estimate, app.settings.units, app.lang) })))));
    });
    if (r.issues.missing.length) {
      out.append(switchField(t('import.useEstimates'), S.useEstimates, (v) => { S.useEstimates = v; analyse(); step3(true); }));
      out.append(h('p.hint.small', {}, t('import.useEstimatesHint')));
    }
    r.issues.conflicts.forEach((c, i) => {
      const cycle = c.cycle.filter((x) => x.src);
      const rows = cycle.map((x) => {
        const inp = h('input', { type: 'number', step: 0.01, value: x.typed.toFixed(2) });
        inp.addEventListener('change', () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (v > 0) { pp.overrides[x.key] = v; analyse(); step3(true); } });
        const off = h('button.btn.small.ghost', { onclick: () => { pp.overrides[x.key] = 'off'; analyse(); step3(true); } }, t('import.ignoreMeasure'));
        return h('div.row', {}, h('span.grow.hint.small', {}, `${t(`import.src.${x.src.type}`)} ${x.src.name ? `«${x.src.name}»` : ''}`), h('span.unit-input', {}, inp, h('em', {}, 'm')), off);
      });
      out.append(h(`div.ask${S.focus?.c === c ? '.focus' : ''}`, { onmouseenter: () => { S.focus = { type: 'conflict', c }; redrawPreview(); } },
        h('p', {}, h('b', {}, t('import.conflictN', { n: i + 1 })), ' ', t('import.conflictText', { d: fmtLen(Math.abs(c.diff), 'cm', app.lang) })),
        h('p.cycle', {}, t('import.conflictCycle')), ...rows));
    });
    if (r.issues.conflicts.length) out.append(switchField(t('import.acceptConflicts'), S.acceptConflicts, (v) => { S.acceptConflicts = v; step3(true); }));
    const notes = r.issues.notes.filter((n) => n.code !== 'noMeasures');
    if (notes.length) out.append(h('details.section', {}, h('summary.hint', {}, t('import.notes', { n: notes.length })), ...notes.map((n) => h('p.hint.small', {}, t(`import.note.${n.code}`, n)))));
    if (!r.issues.missing.length && !r.issues.conflicts.length) out.append(h('div.issue', {}, icon('check'), h('span', {}, t('import.allGood'))));
    return out;
  }

  let lastCanvas = null;
  function redrawPreview() { if (lastCanvas) drawPreview(lastCanvas, S.pages[S.active]); d.body.querySelectorAll('.ask').forEach((el) => el.classList.remove('focus')); }
  function drawPreview(cv, P) {
    lastCanvas = cv;
    const r = P.res; const pv = r.preview;
    const W = cv.clientWidth || 400, H = cv.clientHeight || 300; const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = pv.pieces.flatMap((p) => [p.a, p.b]).concat((pv.unknowns || []).flatMap((u) => u.corners));
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const s = Math.min((W - 40) / Math.max(1, maxX - minX), (H - 40) / Math.max(1, maxY - minY));
    const tx = (W - (maxX - minX) * s) / 2 - minX * s, ty = (H - (maxY - minY) * s) / 2 - minY * s;
    const T = (p) => ({ x: p.x * s + tx, y: p.y * s + ty });
    const dark = app.theme === 'dark';
    g.fillStyle = dark ? '#1f2326' : '#f6f7f4'; g.fillRect(0, 0, W, H);
    // unknown shapes
    g.setLineDash([3, 3]); g.strokeStyle = '#a0a6ad';
    for (const u of pv.unknowns || []) { g.beginPath(); u.corners.forEach((p, i) => { const q = T(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.closePath(); g.stroke(); }
    g.setLineDash([]);
    // openings
    g.fillStyle = 'rgba(90,159,212,0.35)';
    for (const o of P.raw.openings) { g.beginPath(); o.corners.forEach((p, i) => { const q = T(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.closePath(); g.fill(); }
    const focusPieces = new Set();
    if (S.focus?.type === 'missing' && S.focus.m.piece != null) focusPieces.add(S.focus.m.piece);
    for (const p of pv.pieces) {
      const a = T(p.a), b = T(p.b);
      const col = dark && p.status === 'measured' ? '#d9dcde' : STATUS_COLORS[p.status];
      g.strokeStyle = col; g.lineWidth = p.status === 'missing' || focusPieces.has(p.idx) ? 6 : p.exterior ? 4 : 3; g.lineCap = 'round';
      if (p.status === 'estimated') g.setLineDash([6, 4]);
      if (focusPieces.has(p.idx)) { g.save(); g.strokeStyle = 'rgba(233,169,43,0.35)'; g.lineWidth = 16; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.restore(); }
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L > 46) {
        const txt = p.status === 'missing' ? '?' : fmtLen(p.len, app.settings.units, app.lang);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        g.font = `600 ${p.status === 'missing' ? 13 : 10}px ${app.font}`; const w = g.measureText(txt).width + 8;
        g.fillStyle = p.status === 'missing' ? '#e9a92b' : dark ? 'rgba(35,39,43,0.92)' : 'rgba(255,255,255,0.92)';
        g.beginPath(); g.roundRect?.(mx - w / 2, my - 8, w, 16, 8); g.fill();
        g.fillStyle = p.status === 'missing' ? '#33260a' : p.status === 'conflict' ? '#d64545' : dark ? '#e9ebec' : '#30353b';
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, mx, my + 0.5);
      }
    }
    // free-distance requests and focused conflict
    for (const m of r.issues.missing) if (m.piece == null) {
      const a = T(m.pa), b = T(m.pb); g.strokeStyle = '#e9a92b'; g.setLineDash([4, 4]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(a.x, a.y); if (m.kind === 'x') g.lineTo(b.x, a.y); else if (m.kind === 'y') g.lineTo(a.x, b.y); else g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    }
    if (S.focus?.type === 'missing' && S.focus.m.piece == null) { const a = T(S.focus.m.pa), b = T(S.focus.m.pb); for (const q of [a, b]) { g.beginPath(); g.arc(q.x, q.y, 7, 0, 7); g.fillStyle = '#e9a92b'; g.fill(); } }
    for (const n of pv.nodes) { const q = T(n); g.beginPath(); g.arc(q.x, q.y, 2, 0, 7); g.fillStyle = dark ? '#9aa3ab' : '#30353b'; g.fill(); }
  }

  // ---------------------------------------------------------------- create
  async function create() {
    const solved = S.pages.filter((p) => p.res.walls.length);
    if (!solved.length) { app.toast(t('import.noWalls'), 'bad'); return; }
    const settings = { measureMode: S.opts.mode, extThickness: S.opts.extThickness, intThickness: S.opts.intThickness, wallHeight: S.opts.wallHeight };
    let mode = 'new';
    if (store.project.floors.some((f) => f.items.length)) {
      mode = await new Promise((resolve) => {
        const q = openDialog({ title: t('import.keepTitle'), narrow: true, onClose: (v) => resolve(v || 'cancel') });
        q.body.append(h('p', {}, t('import.keepText')));
        q.foot.append(h('button.btn.ghost', { onclick: () => q.close('cancel') }, t('common.cancel')), h('button.btn', { onclick: () => q.close('new') }, t('import.keepNew')), h('button.btn.primary', { onclick: () => q.close('update') }, t('import.keepUpdate')));
      });
      if (mode === 'cancel') return;
    }
    S.pages.forEach((p) => { p.raw.meta.height = p.raw.meta.height || S.opts.wallHeight; });
    if (mode === 'update') {
      const proj = JSON.parse(JSON.stringify(store.project));
      updateStructure(proj, solved);
      app.loadProject(proj, { keepHistory: true });
    } else {
      const name = (S.fileName || 'Murello').replace(/\.(drawio|xml)$/i, '');
      app.loadProject(projectFromPages(solved, { name, settings }), { fromFile: S.fileName });
    }
    d.close();
    const est = S.pages.reduce((s, p) => s + p.res.issues.missing.length, 0);
    app.toast(est ? t('import.doneEstimated', { n: est }) : t('import.done'));
  }

  step1();
  if (preset?.text) loadText(preset.text, preset.name); else if (preset?.url) loadUrl(preset.url);
  return d;
}

function drawShapeThumb(cv, u) {
  const g = cv.getContext('2d');
  const pts = u.corners;
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const s = Math.min((cv.width - 16) / Math.max(1, maxX - minX), (cv.height - 16) / Math.max(1, maxY - minY));
  const T = (p) => ({ x: (p.x - minX) * s + (cv.width - (maxX - minX) * s) / 2, y: (p.y - minY) * s + (cv.height - (maxY - minY) * s) / 2 });
  g.fillStyle = '#e8eaf0'; g.strokeStyle = '#6a737c'; g.lineWidth = 2;
  g.beginPath();
  if (u.shape === 'ellipse') { const a = T({ x: minX, y: minY }), b = T({ x: maxX, y: maxY }); g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / 2, (b.y - a.y) / 2, 0, 0, 7); }
  else pts.forEach((p, i) => { const q = T(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); });
  g.closePath(); g.fill(); g.stroke();
}
