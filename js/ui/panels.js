// Side panels: furniture library, structure (floors, rooms, wall editing), tools, and "more" (mobile).
import { h, fmtLen, fmtArea, uid } from '../core/util.js';
import { icon, section, switchField, lengthField, rangeField, selectField } from './kit.js';
import { store, newFloor } from '../core/state.js';
import { derive } from '../model/derive.js';
import { allModels, modelName, modelDefaults } from '../furniture/models.js';
import { CATEGORIES } from '../furniture/library.js';
import { drawModelThumb } from './thumbs.js';

// ------------------------------------------------------------------ library
export function libraryPanel(app) {
  const t = app.t;
  const st = app.ui.library ||= { q: '', cat: 'all' };
  const search = h('input', { type: 'search', placeholder: t('lib.search'), value: st.q });
  const grid = h('div.lib-grid');
  const fill = () => {
    const q = st.q.toLowerCase();
    const list = allModels().filter((m) => (st.cat === 'all' || (m.custom ? 'custom' : m.cat) === st.cat) && (!q || `${modelName(m, 'it')} ${modelName(m, 'en')} ${m.id}`.toLowerCase().includes(q)));
    grid.replaceChildren(...list.map((m) => {
      const cv = h('canvas', { width: 64, height: 52 });
      const d = modelDefaults(m, store.floor.height);
      const card = h('button.lib-card', { type: 'button', title: t('lib.addHint'), draggable: app.flags.dragFromLibrary ? 'true' : null, onclick: () => app.addItem(m.id) },
        cv, h('span', {}, modelName(m, app.lang)), h('small', {}, `${Math.round(d.w * 100)}×${Math.round(d.d * 100)}`));
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/murello-model', m.id); e.dataTransfer.effectAllowed = 'copy'; });
      requestAnimationFrame(() => drawModelThumb(cv, m, { dark: app.theme === 'dark' }));
      return card;
    }));
    if (!list.length) grid.replaceChildren(h('p.empty-note', {}, t('lib.none')));
  };
  search.addEventListener('input', () => { st.q = search.value; fill(); });
  const chips = h('div.chips', {}, [['all', t('lib.all')], ...CATEGORIES.map((c) => [c.id, c.name[app.lang] || c.name.it])].map(([id, label]) =>
    h('button.chip', { 'aria-pressed': String(st.cat === id), onclick: (e) => { st.cat = id; chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); fill(); } }, label)));
  fill();
  return [
    h('label.search', {}, icon('search'), search), chips, grid,
    h('div.section', {}, h('div.row', {},
      h('button.btn.small', { onclick: () => app.openModelEditor() }, icon('plus'), t('lib.newModel')),
      h('button.btn.small.ghost', { onclick: () => app.openModelEditor({ fromDrawio: true }) }, t('lib.fromDrawio')))),
    h('p.hint.small', {}, app.flags.dragFromLibrary ? t('lib.hintDesktop') : t('lib.hintMobile')),
  ];
}

// ------------------------------------------------------------------ structure
export function structurePanel(app) {
  const t = app.t; const p = store.project; const f = store.floor; const der = derive(f);
  const floors = h('div.list', {}, ...p.floors.map((fl) => h(`div.list-row${fl.id === f.id ? '.active' : ''}`, { onclick: () => app.setFloor(fl.id) },
    icon('layers'), h('span.grow', {}, fl.name), h('small', {}, `${fmtLen(fl.elevation || 0, 'm', app.lang)} · h ${fmtLen(fl.height, 'm', app.lang)}`))));
  const fl = f;
  const floorProps = section(t('struct.thisFloor'),
    h('label.field.stack', {}, h('span', {}, t('insp.name')), (() => { const i = h('input.input', { value: fl.name }); i.addEventListener('change', () => store.commit('floorName', () => { fl.name = i.value.trim() || fl.name; })); return i; })()),
    lengthField(app, t('struct.floorHeight'), fl.height, (v) => store.commit('floorH', () => { fl.height = v; }), { min: 1.5, max: 12 }),
    lengthField(app, t('struct.elevation'), fl.elevation || 0, (v) => store.commit('floorE', () => { fl.elevation = v; }), { min: -20, max: 200 }),
    h('div.row', {},
      h('button.btn.small', { onclick: () => app.addFloor(false) }, icon('plus'), t('struct.addFloor')),
      h('button.btn.small', { onclick: () => app.addFloor(true) }, icon('copy'), t('struct.copyFloor')),
      p.floors.length > 1 ? h('button.btn.small.danger', { onclick: () => app.deleteFloor(fl.id) }, icon('trash')) : null),
    switchField(t('struct.showAll'), app.settings.showAllFloors, (v) => app.setSetting('showAllFloors', v)),
  );
  const rooms = der.rooms.map((r, i) => h(`div.list-row${store.selection?.type === 'room' && store.selection.id === r.id ? '.active' : ''}`, { onclick: () => store.select({ type: 'room', id: r.id, floorId: f.id }) },
    h('span.dot', { style: { background: ['#cfe0c9', '#e6d8c3', '#cbd8e8', '#ecd2cd', '#dbd2e8', '#e6e2c3'][i % 6] } }), h('span.grow', {}, r.name || t('room.unnamed', { n: i + 1 })), h('small', {}, fmtArea(r.netArea, app.lang))));
  const toolBtn = (id, ic, label) => h('button.btn.small', { 'aria-pressed': String(app.tool === id), class: app.tool === id ? 'btn small accent' : 'btn small', onclick: () => app.setTool(app.tool === id ? null : id) }, icon(ic), label);
  return [
    section(t('struct.floors'), floors), floorProps,
    section(`${t('struct.rooms')} `, rooms.length ? h('div.list', {}, ...rooms) : h('p.empty-note', {}, t('struct.noRooms'))),
    section(t('struct.edit'),
      h('div.row', {}, toolBtn('structure', 'node', t('struct.moveNodes')), toolBtn('wall', 'pencil', t('struct.drawWalls'))),
      h('p.hint.small', {}, app.tool === 'wall' ? t('struct.drawHint') : app.tool === 'structure' ? t('struct.nodesHint') : t('struct.editHint')),
      lengthField(app, t('struct.newWallThk'), p.settings.intThickness, (v) => store.commit('settings', () => { p.settings.intThickness = v; }), { min: 0.03, max: 1 })),
    section(t('struct.source'),
      h('div.row', {},
        h('button.btn.small', { onclick: () => app.openImport() }, icon('upload'), t('struct.reimport')),
        h('button.btn.small', { onclick: () => app.exportDrawio() }, icon('download'), t('menu.exportDrawio')))),
  ];
}

// ------------------------------------------------------------------ tools
export function toolsPanel(app) {
  const t = app.t; const s = app.settings;
  const issues = [...(app.collisions || new Map())].map(([id, c]) => {
    const it = store.floor.items.find((i) => i.id === id); if (!it) return null;
    return h(`div.issue.${c.level === 'error' ? 'bad' : 'warn'}`, { onclick: () => store.select({ type: 'item', id, floorId: store.floor.id }) }, icon('warn'),
      h('span', {}, h('b', {}, it.name || modelName(allModels().find((m) => m.id === it.model) || { id: it.model }, app.lang)), ' — ', c.reasons.map((r) => t(`coll.${r.code}`)).filter((v, i, a) => a.indexOf(v) === i).join(', ')));
  }).filter(Boolean);
  const measureOn = app.tool === 'measure';
  return [
    section(t('tools.measure'),
      h('div.row', {}, h(`button.btn.small${measureOn ? '.accent' : ''}`, { onclick: () => app.setTool(measureOn ? null : 'measure') }, icon('ruler'), measureOn ? t('tools.measureStop') : t('tools.measureStart')),
        h('button.btn.small.ghost', { onclick: () => app.clearMeasure() }, t('tools.clear'))),
      h('p.hint.small', {}, t('tools.measureHint'))),
    section(`${t('tools.issues')} `, issues.length ? h('div', {}, ...issues) : h('p.empty-note', {}, t('tools.noIssues'))),
    section(t('tools.passages'),
      lengthField(app, t('tools.minPassage'), s.minPassage, (v) => app.setSetting('minPassage', v), { min: 0.3, max: 2 }),
      lengthField(app, t('tools.comfortPassage'), s.comfortPassage, (v) => app.setSetting('comfortPassage', v), { min: 0.4, max: 3 }),
      switchField(t('tools.autoQuotes'), s.autoQuotes, (v) => app.setSetting('autoQuotes', v)),
      switchField(t('tools.walkMap'), app.plan2d?.walkOverlay, (v) => { app.plan2d.walkOverlay = v; if (v && app.view === '3d') app.setView(app.flags.splitView ? 'split' : '2d'); app.plan2d.draw(); }),
      h('p.hint.small', {}, t('tools.walkHint'))),
    section(t('tools.display'),
      switchField(t('tools.wallDims'), s.showWallDims, (v) => app.setSetting('showWallDims', v)),
      switchField(t('tools.innerDims'), s.showInnerDims, (v) => app.setSetting('showInnerDims', v)),
      switchField(t('tools.names'), s.showNames, (v) => app.setSetting('showNames', v)),
      switchField(t('tools.snap'), s.snap, (v) => app.setSetting('snap', v)),
      selectField(t('tools.grid'), String(s.grid), [['0', t('tools.gridOff')], ['0.01', '1 cm'], ['0.05', '5 cm'], ['0.1', '10 cm']], (v) => app.setSetting('grid', +v)),
      rangeField(t('tools.doorAngle'), s.doorAngle, { min: 0, max: 90, step: 5, fmt: (v) => `${v}°` }, (v, live) => { if (!live) app.setSetting('doorAngle', v); })),
    section(t('tools.picture'), h('button.btn.small', { onclick: () => app.saveImage() }, icon('camera'), t('tools.saveImage'))),
  ];
}

// ------------------------------------------------------------------ more (mobile)
export function morePanel(app) {
  const t = app.t;
  const b = (ic, label, fn) => h('div.list-row', { onclick: fn }, icon(ic), h('span.grow', {}, label), icon('chev'));
  return [
    section(t('menu.file'), h('div.list', {},
      b('file', t('menu.new'), () => app.newProject()),
      b('upload', t('menu.import'), () => app.openImport()),
      b('download', t('menu.exportProject'), () => app.exportProject()),
      b('download', t('menu.exportDrawio'), () => app.exportDrawio()),
      b('camera', t('tools.saveImage'), () => app.saveImage()))),
    section(t('panel.rules'), h('div.list', {}, b('tag', t('rules.manage'), () => app.openPanel('rules')))),
    section(t('menu.more'), h('div.list', {},
      b('undo', t('menu.undo'), () => store.undo()), b('redo', t('menu.redo'), () => store.redo()),
      b('gear', t('menu.settings'), () => app.openSettings()), b('help', t('menu.help'), () => app.openHelp()))),
  ];
}

export { uid, newFloor };
