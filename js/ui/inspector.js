// Inspector: edit whatever is selected (furniture, wall, opening, wall decor, room, node).
import { h, uid, fmtLen, fmtArea } from '../core/util.js';
import { icon, lengthField, numberField, textField, selectField, switchField, colorField, section } from './kit.js';
import { store } from '../core/state.js';
import { derive } from '../model/derive.js';
import { getModel, allModels, modelName, itemDims, modelDefaults } from '../furniture/models.js';
import { FLOOR_TYPES } from '../view3d/materials.js';
import { DECOR_TYPES, DECOR_DEFAULTS } from '../view3d/build-floor.js';
import { splitWall } from '../view2d/plan2d.js';
import { dist } from '../core/geom.js';

export function renderInspector(app, el, titleEl) {
  const sel = store.selection;
  const t = app.t;
  const f = store.floorById(sel?.floorId) || store.floor;
  if (!sel) return false;
  const der = derive(f);
  let content = null; let title = '';
  const commit = (label, fn) => store.commit(label, fn);

  if (sel.type === 'item') {
    const it = f.items.find((i) => i.id === sel.id); if (!it) return false;
    const m = getModel(it.model); const dims = itemDims(it, f.height); const def = modelDefaults(m, f.height);
    title = it.name || modelName(m, app.lang);
    const coll = app.collisions?.get(it.id);
    const models = allModels();
    content = [
      coll ? h('div', {}, ...coll.reasons.slice(0, 4).map((r) => h(`div.issue.${coll.level === 'error' ? 'bad' : 'warn'}`, {}, icon('warn'), h('span', {}, t(`coll.${r.code}`))))) : null,
      textField(t('insp.name'), it.name, (v) => commit('rename', () => { it.name = v; }), { placeholder: modelName(m, app.lang) }),
      selectField(t('insp.model'), it.model, models.map((mm) => [mm.id, modelName(mm, app.lang)]), (v) => commit('model', () => { it.model = v; it.w = null; it.d = null; it.h = null; it.elevation = getModel(v).elevation || 0; })),
      section(t('insp.size'),
        lengthField(app, t('insp.width'), dims.w, (v) => commit('size', () => { it.w = v; }), { min: 0.05, max: 12 }),
        lengthField(app, t('insp.depth'), dims.d, (v) => commit('size', () => { it.d = v; }), { min: 0.02, max: 12 }),
        lengthField(app, t('insp.height'), dims.h, (v) => commit('size', () => { it.h = v; }), { min: 0.005, max: 6 }),
        lengthField(app, t('insp.elevation'), it.elevation || 0, (v) => commit('elev', () => { it.elevation = v; }), { min: 0, max: 5 }),
        (it.w || it.d || it.h) ? h('button.btn.small.ghost', { onclick: () => commit('size', () => { it.w = null; it.d = null; it.h = null; }) }, t('insp.resetSize', { w: fmtLen(def.w, app.settings.units, app.lang), d: fmtLen(def.d, app.settings.units, app.lang) })) : null,
      ),
      section(t('insp.position'),
        lengthField(app, 'X', it.x, (v) => commit('move', () => { it.x = v; }), { min: -1000, max: 1000 }),
        lengthField(app, 'Y', it.y, (v) => commit('move', () => { it.y = v; }), { min: -1000, max: 1000 }),
        numberField(t('insp.rotation'), Math.round(it.rot || 0), (v) => commit('rotate', () => { it.rot = ((v % 360) + 360) % 360; }), { step: 1, min: -360, max: 720, unit: '°' }),
        h('div.row', {},
          h('button.btn.small', { onclick: () => commit('rotate', () => { it.rot = ((it.rot || 0) + 270) % 360; }) }, '⟲ 90°'),
          h('button.btn.small', { onclick: () => commit('rotate', () => { it.rot = ((it.rot || 0) + 90) % 360; }) }, '⟳ 90°'),
          h('button.btn.small', { onclick: () => app.pushToWall(it) }, t('insp.toWall'))),
      ),
      section(t('insp.look'),
        colorField(t('insp.color'), it.color || m.color, (v, live) => { if (live) { it.color = v; app.refreshViews(); } else commit('color', () => { it.color = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
        colorField(t('insp.accent'), it.accent || '#e7e1d6', (v, live) => { if (live) { it.accent = v; app.refreshViews(); } else commit('color', () => { it.accent = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
      ),
      switchField(t('insp.lock'), it.locked, (v) => commit('lock', () => { it.locked = v; })),
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn', { onclick: () => app.duplicateItem(it) }, icon('copy'), t('insp.duplicate')),
        h('button.btn.danger', { onclick: () => app.deleteSelection() }, icon('trash'), t('common.delete'))),
    ];
  } else if (sel.type === 'wall') {
    const x = der.byId.get(sel.id); if (!x) return false;
    const w = x.w;
    title = t('insp.wall');
    const sideName = (s) => { const r = s === 1 ? x.roomL : x.roomR; return r ? (r.name || t('room.unnamed', { n: r.index + 1 })) : t('insp.outside'); };
    const off = sel.offset ?? x.len / 2; const side = sel.side || 1;
    const addOpening = (type) => {
      const width = type === 'window' ? 1.2 : type === 'door' ? 0.8 : 0.9;
      const o = { id: uid('o'), type, offset: Math.max(0, Math.min(x.len - width, off - width / 2)), width, height: type === 'window' ? 1.2 : 2.1, sill: type === 'window' ? 0.9 : 0, style: type === 'door' ? 'single' : type === 'window' ? 'double' : 'none', hinge: 'start', side };
      commit('addOpening', () => { (w.openings ||= []).push(o); });
      store.select({ type: 'opening', id: o.id, wallId: w.id, floorId: f.id });
    };
    const addDecor = (type) => {
      const dd = DECOR_DEFAULTS[type];
      const elev = sel.height > 0.2 && type !== 'radiator' ? Math.max(0, sel.height - dd.height / 2) : dd.elevation;
      const o = { id: uid('d'), type, side, offset: Math.max(0, Math.min(x.len - dd.width, off - dd.width / 2)), width: dd.width, height: dd.height, depth: dd.depth, elevation: +elev.toFixed(2), color: null };
      commit('addDecor', () => { (w.decor ||= []).push(o); });
      store.select({ type: 'decor', id: o.id, wallId: w.id, floorId: f.id });
    };
    content = [
      h('dl.kv', {}, h('dt', {}, t('insp.length')), h('dd', {}, fmtLen(x.len, app.settings.units, app.lang)), h('dt', {}, t('insp.sides')), h('dd', {}, `${sideName(1)} · ${sideName(-1)}`)),
      section(t('insp.addHere', { side: sideName(side), at: fmtLen(off, app.settings.units, app.lang) }),
        h('div.row', {},
          h('button.btn.small', { onclick: () => addOpening('window') }, icon('window'), t('open.window')),
          h('button.btn.small', { onclick: () => addOpening('door') }, icon('door'), t('open.door')),
          h('button.btn.small', { onclick: () => addOpening('opening') }, t('open.opening'))),
        h('div.row', { style: { marginTop: '6px' } }, ...DECOR_TYPES.map((dt) => h('button.btn.small.ghost', { onclick: () => addDecor(dt) }, t(`decor.${dt}`)))),
        h('p.hint.small', {}, t('insp.addHint')),
      ),
      section(t('insp.wallProps'),
        lengthField(app, t('insp.length'), x.len, (v) => commit('length', () => { const B = f.nodes.find((n) => n.id === w.b); B.x = x.A.x + x.dir.x * v; B.y = x.A.y + x.dir.y * v; }), { min: 0.05, max: 200 }),
        lengthField(app, t('insp.thickness'), w.thickness, (v) => commit('thk', () => { w.thickness = v; }), { min: 0.02, max: 1.5 }),
        lengthField(app, t('insp.wallHeight'), w.height, (v) => commit('wh', () => { w.height = v; }), { min: 0.1, max: 12, nullable: true, placeholder: x.h.toFixed(2) }),
        colorField(t('insp.colorSide', { side: sideName(1) }), w.colorL || x.roomL?.wallColor || '#f2f0eb', (v, live) => { if (!live) commit('wcolor', () => { w.colorL = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
        colorField(t('insp.colorSide', { side: sideName(-1) }), w.colorR || x.roomR?.wallColor || '#f2f0eb', (v, live) => { if (!live) commit('wcolor', () => { w.colorR = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
      ),
      (w.openings?.length || w.decor?.length) ? section(t('insp.onWall'), h('div.list', {},
        ...(w.openings || []).map((o) => h('div.list-row', { onclick: () => store.select({ type: 'opening', id: o.id, wallId: w.id, floorId: f.id }) }, icon(o.type === 'window' ? 'window' : 'door'), h('span.grow', {}, t(`open.${o.type}`)), h('small', {}, fmtLen(o.width, app.settings.units, app.lang)))),
        ...(w.decor || []).map((o) => h('div.list-row', { onclick: () => store.select({ type: 'decor', id: o.id, wallId: w.id, floorId: f.id }) }, icon('picture'), h('span.grow', {}, t(`decor.${o.type}`)), h('small', {}, `${o.side === 1 ? sideName(1) : sideName(-1)}`))))) : null,
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn.small', { onclick: () => { commit('split', (p, fl) => { const id = uid('n'); const P = { x: x.A.x + x.dir.x * off, y: x.A.y + x.dir.y * off }; fl.nodes.push({ id, ...P }); splitWall(fl, fl.walls.find((q) => q.id === w.id), id, P); }); } }, t('insp.split')),
        h('button.btn.small.danger', { onclick: () => app.deleteSelection() }, icon('trash'), t('common.delete'))),
    ];
  } else if (sel.type === 'opening') {
    const x = der.byId.get(sel.wallId); const o = x?.w.openings?.find((q) => q.id === sel.id); if (!o) return false;
    title = t(`open.${o.type}`);
    const styles = o.type === 'door' ? ['single', 'double', 'sliding', 'none'] : o.type === 'window' ? ['single', 'double', 'triple'] : ['none'];
    content = [
      selectField(t('insp.type'), o.type, [['door', t('open.door')], ['window', t('open.window')], ['opening', t('open.opening')]], (v) => commit('otype', () => { o.type = v; if (v === 'window') { o.sill = o.sill || 0.9; o.height = Math.min(o.height, 1.4); o.style = 'double'; } else { o.sill = 0; o.height = 2.1; o.style = v === 'door' ? 'single' : 'none'; } })),
      lengthField(app, t('insp.offset'), o.offset, (v) => commit('o', () => { o.offset = Math.min(v, x.len - o.width); }), { min: 0, max: x.len }),
      lengthField(app, t('insp.width'), o.width, (v) => commit('o', () => { o.width = Math.min(v, x.len - o.offset); }), { min: 0.2, max: x.len }),
      lengthField(app, t('insp.height'), o.height, (v) => commit('o', () => { o.height = v; }), { min: 0.2, max: x.h }),
      o.type === 'window' ? lengthField(app, t('insp.sill'), o.sill || 0, (v) => commit('o', () => { o.sill = v; }), { min: 0, max: x.h - 0.2 }) : null,
      styles.length > 1 ? selectField(t('insp.style'), o.style, styles.map((s) => [s, t(`ostyle.${s}`)]), (v) => commit('o', () => { o.style = v; })) : null,
      o.type === 'door' ? h('div.row', {},
        h('button.btn.small', { onclick: () => commit('o', () => { o.hinge = o.hinge === 'end' ? 'start' : 'end'; }) }, t('insp.flipHinge')),
        h('button.btn.small', { onclick: () => commit('o', () => { o.side = -(o.side || 1); }) }, t('insp.flipSide'))) : null,
      colorField(t('insp.frame'), o.frameColor || '#f4f3ef', (v, live) => { if (!live) commit('o', () => { o.frameColor = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn.small', { onclick: () => commit('o', () => { o.offset = (x.len - o.width) / 2; }) }, t('insp.center')),
        h('button.btn.small', { onclick: () => store.select({ type: 'wall', id: x.id, floorId: f.id, offset: o.offset + o.width / 2, side: o.side || 1 }) }, t('insp.backToWall')),
        h('button.btn.small.danger', { onclick: () => app.deleteSelection() }, icon('trash'), t('common.delete'))),
    ];
  } else if (sel.type === 'decor') {
    const x = der.byId.get(sel.wallId); const o = x?.w.decor?.find((q) => q.id === sel.id); if (!o) return false;
    title = t(`decor.${o.type}`);
    content = [
      selectField(t('insp.type'), o.type, DECOR_TYPES.map((d) => [d, t(`decor.${d}`)]), (v) => commit('d', () => { o.type = v; Object.assign(o, { width: DECOR_DEFAULTS[v].width, height: DECOR_DEFAULTS[v].height, depth: DECOR_DEFAULTS[v].depth }); })),
      lengthField(app, t('insp.offset'), o.offset, (v) => commit('d', () => { o.offset = Math.min(v, x.len - o.width); }), { min: 0, max: x.len }),
      lengthField(app, t('insp.elevation'), o.elevation, (v) => commit('d', () => { o.elevation = v; }), { min: 0, max: x.h }),
      lengthField(app, t('insp.width'), o.width, (v) => commit('d', () => { o.width = v; }), { min: 0.05, max: x.len }),
      lengthField(app, t('insp.height'), o.height, (v) => commit('d', () => { o.height = v; }), { min: 0.01, max: x.h }),
      lengthField(app, t('insp.depth'), o.depth || 0.03, (v) => commit('d', () => { o.depth = v; }), { min: 0.005, max: 1 }),
      colorField(t('insp.color'), o.color || '#c9b79c', (v, live) => { if (!live) commit('d', () => { o.color = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn.small', { onclick: () => commit('d', () => { o.side = -(o.side || 1); }) }, t('insp.otherSide')),
        h('button.btn.small', { onclick: () => commit('d', () => { o.offset = (x.len - o.width) / 2; }) }, t('insp.center')),
        h('button.btn.small.danger', { onclick: () => app.deleteSelection() }, icon('trash'), t('common.delete'))),
    ];
  } else if (sel.type === 'room') {
    const r = der.rooms.find((q) => q.id === sel.id); if (!r) return false;
    title = r.name || t('room.unnamed', { n: r.index + 1 });
    const upd = (fn) => commit('room', (p, fl) => {
      let a = fl.rooms.find((q) => q.id === r.id);
      if (!a) { a = { id: r.virtual ? uid('room') : r.id, name: r.name || '', anchor: r.labelPos, height: r.height ?? null, floor: r.floor ?? null, wallColor: r.wallColor ?? null }; fl.rooms.push(a); store.selection = { ...sel, id: a.id }; }
      fn(a);
    });
    content = [
      h('dl.kv', {}, h('dt', {}, t('insp.netArea')), h('dd', {}, fmtArea(r.netArea, app.lang)), h('dt', {}, t('insp.axisArea')), h('dd', {}, fmtArea(r.area, app.lang)), h('dt', {}, t('insp.perimeter')), h('dd', {}, fmtLen(r.perimeter, 'm', app.lang))),
      textField(t('insp.name'), r.name, (v) => upd((a) => { a.name = v; }), { placeholder: t('room.unnamed', { n: r.index + 1 }) }),
      lengthField(app, t('insp.roomHeight'), r.height, (v) => upd((a) => { a.height = v; }), { min: 1.5, max: 12, nullable: true, placeholder: (f.height || 2.7).toFixed(2) }),
      selectField(t('insp.floor'), r.floor || 'parquet', Object.keys(FLOOR_TYPES).map((k) => [k, t(`floorType.${k}`)]), (v) => upd((a) => { a.floor = v; })),
      colorField(t('insp.wallColor'), r.wallColor || '#f2f0eb', (v, live) => { if (!live) upd((a) => { a.wallColor = v; }); }, { allowReset: true, resetLabel: t('common.auto') }),
      h('div.row', { style: { marginTop: '12px' } }, h('button.btn', { onclick: () => app.openPanel('furnish', { roomId: r.id }) }, icon('wand'), t('insp.autoFurnish'))),
    ];
  } else if (sel.type === 'node') {
    const n = f.nodes.find((q) => q.id === sel.id); if (!n) return false;
    title = t('insp.node');
    const deg = f.walls.filter((w) => w.a === n.id || w.b === n.id).length;
    content = [
      h('p.hint', {}, t('insp.nodeHint', { n: deg })),
      lengthField(app, 'X', n.x, (v) => commit('node', () => { n.x = v; }), { min: -1000, max: 1000 }),
      lengthField(app, 'Y', n.y, (v) => commit('node', () => { n.y = v; }), { min: -1000, max: 1000 }),
      h('button.btn.small.danger', { onclick: () => app.deleteSelection() }, icon('trash'), t('insp.deleteNode')),
    ];
  } else return false;
  titleEl.textContent = title;
  el.replaceChildren(...content.filter(Boolean));
  void dist;
  return true;
}
