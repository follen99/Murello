// Furniture model editor: compose rounded boxes, cylinders and spheres with numbers or expressions
// (w, d, h…), preview live in 3D, save to "My models". Can start from a draw.io sketch (top view).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { h, debounce, download, readFileAsText, uid } from '../core/util.js';
import { icon, openDialog } from './kit.js';
import { compileExpr, validateModel, setCustomModels, getModel, allModels, modelName } from '../furniture/models.js';
import { CATEGORIES } from '../furniture/library.js';
import { buildItemMesh, disposeGroup } from '../furniture/build.js';
import { drawModelThumb } from './thumbs.js';
import { parseDrawio } from '../io/drawio-parser.js';
import { prepareCell } from '../categories/registry.js';
import { parseLabel } from '../io/labels.js';

const MATS = ['main', 'soft', 'accent', 'wood', 'dark', 'white', 'metal', 'black', 'glass', 'ceramic', 'mattress', 'leaf', 'pot', 'counter', 'screen'];
const TAGS = ['wall', 'tall', 'seat', 'light', 'low', 'center', 'small', 'hanging', 'flat'];

export function openModelEditor(app, { model = null, fromDrawio = false } = {}) {
  const t = app.t;
  const base = model ? JSON.parse(JSON.stringify(model)) : { id: `my_${uid('m').slice(-6)}`, name: { it: t('editor.newName'), en: t('editor.newName') }, cat: 'custom', color: '#b8a48a', params: { w: 0.8, d: 0.5, h: 0.8 }, tags: [], parts: [{ s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.02, m: 'main' }] };
  if (model && !model.custom) { base.id = `my_${model.id}`; base.name = { it: `${modelName(model, 'it')} (copia)`, en: `${modelName(model, 'en')} (copy)` }; base.cat = 'custom'; }
  const M = base;
  const previousCustom = app.library.models.slice();
  const d = openDialog({ title: t('editor.title'), closeLabel: t('common.close'), onClose: () => { cleanup(); setCustomModels(app.library.models); } });
  let selRow = 0;

  // ---- preview renderer
  const cv = h('canvas'); const prev = h('div.model-preview', {}, cv);
  const top = h('canvas', { width: 160, height: 120, style: { width: '100%', height: '120px' } });
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(app.theme === 'dark' ? '#23272b' : '#eef0ec');
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(2, 4, 3); sun.castShadow = true; scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: app.theme === 'dark' ? '#2b3034' : '#e1e5df' }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 50); cam.position.set(1.6, 1.3, 2.2);
  const ctl = new OrbitControls(cam, cv); ctl.target.set(0, 0.4, 0); ctl.enableDamping = true;
  let mesh = null; let raf = 0; let alive = true;
  const loop = () => { if (!alive) return; raf = requestAnimationFrame(loop); const w = cv.clientWidth, hh = cv.clientHeight; if (w && (cv.width !== Math.round(w * renderer.getPixelRatio()))) { renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); } ctl.update(); renderer.render(scene, cam); };
  loop();
  function cleanup() { alive = false; cancelAnimationFrame(raf); if (mesh) disposeGroup(mesh); renderer.dispose(); }

  const rebuild = debounce(() => {
    let valid;
    try { valid = validateModel({ ...M, id: '__preview' }); } catch (e) { status.textContent = e.message; status.style.color = 'var(--bad)'; return; }
    status.textContent = '';
    setCustomModels([...previousCustom.filter((m) => m.id !== M.id), valid]);
    if (mesh) { scene.remove(mesh); disposeGroup(mesh); }
    mesh = buildItemMesh({ model: '__preview', w: null, d: null, h: null, color: null }, 2.7);
    scene.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh); const size = box.getSize(new THREE.Vector3());
    ctl.target.set(0, size.y / 2, 0);
    const R = Math.max(size.x, size.y, size.z, 0.3);
    if (!rebuild.fitted) { cam.position.set(R * 1.4, R * 1.2, R * 1.9); rebuild.fitted = true; }
    drawModelThumb(top, valid, { dark: app.theme === 'dark' });
  }, 120);
  const status = h('p.hint.small');

  // ---- meta
  const nameIn = h('input.input', { value: M.name[app.lang] || M.name.it });
  nameIn.addEventListener('input', () => { M.name = { it: nameIn.value, en: nameIn.value }; });
  const catSel = h('select', {}, CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === M.cat }, c.name[app.lang] || c.name.it)));
  catSel.addEventListener('change', () => { M.cat = catSel.value; });
  const color = h('input', { type: 'color', value: M.color });
  color.addEventListener('input', () => { M.color = color.value; rebuild(); });
  const dimIn = (k) => { const i = h('input', { type: 'number', step: 0.01, value: typeof M.params[k] === 'number' ? M.params[k] : 1 }); i.addEventListener('change', () => { M.params[k] = Math.max(0.01, +i.value || 0.1); rebuild(); }); return h('label.field', {}, h('span', {}, k), h('span.unit-input', {}, i, h('em', {}, 'm'))); };
  const elevIn = h('input', { type: 'number', step: 0.01, value: M.elevation || 0 }); elevIn.addEventListener('change', () => { M.elevation = +elevIn.value || 0; });
  const tags = h('div.chips', {}, ...TAGS.map((tg) => h('button.chip', { type: 'button', 'aria-pressed': String((M.tags || []).includes(tg)), title: t(`editor.tag.${tg}`), onclick: (e) => { M.tags = M.tags || []; const i = M.tags.indexOf(tg); if (i >= 0) M.tags.splice(i, 1); else M.tags.push(tg); e.currentTarget.setAttribute('aria-pressed', String(i < 0)); } }, t(`editor.tagName.${tg}`))));

  // ---- parts table
  const table = h('table.parts-table');
  const drawTable = () => {
    const head = h('tr', {}, ...['', 'x', 'y', 'z', 'w', 'h', 'd', 'r', 'mat', '×', ''].map((c) => h('th', {}, c)));
    const rows = M.parts.map((p, i) => {
      const cell = (k, width) => {
        const inp = h('input', { value: p[k] ?? '', style: width ? { width } : null, title: k });
        inp.addEventListener('input', () => {
          const v = inp.value.trim();
          if (v === '') delete p[k]; else p[k] = /^-?\d+(\.\d+)?$/.test(v) ? +v : v;
          try { if (p[k] != null) compileExpr(p[k]); inp.style.borderColor = ''; rebuild(); } catch { inp.style.borderColor = 'var(--bad)'; }
        });
        inp.addEventListener('focus', () => { selRow = i; table.querySelectorAll('tr').forEach((r, k2) => r.classList.toggle('sel', k2 === i + 1)); });
        return h('td', {}, inp);
      };
      const shape = h('select', {}, ['box', 'cyl', 'sph'].map((s) => h('option', { value: s, selected: p.s === s }, s)));
      shape.addEventListener('change', () => { p.s = shape.value; rebuild(); });
      const mat = h('select', {}, MATS.map((m) => h('option', { value: m, selected: (p.m || 'main') === m }, m)));
      mat.addEventListener('change', () => { p.m = mat.value; rebuild(); });
      return h(`tr${i === selRow ? '.sel' : ''}`, {}, h('td', {}, shape), cell('x'), cell('y'), cell('z'), cell('w'), cell('h'), cell('d'), cell('r'), h('td', {}, mat), cell('rep'),
        h('td', {}, h('button.iconbtn', { title: t('editor.dupPart'), onclick: () => { M.parts.splice(i + 1, 0, JSON.parse(JSON.stringify(p))); drawTable(); rebuild(); } }, icon('copy')),
          h('button.iconbtn', { title: t('common.delete'), onclick: () => { M.parts.splice(i, 1); drawTable(); rebuild(); } }, icon('trash'))));
    });
    table.replaceChildren(head, ...rows);
  };
  drawTable();

  const fileIn = h('input', { type: 'file', accept: '.json,.drawio,.xml', hidden: true });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0]; if (!file) return;
    const text = await readFileAsText(file);
    try {
      if (text.trim().startsWith('{')) { const j = JSON.parse(text); const m = validateModel(j.models?.[0] || j); Object.assign(M, m, { id: M.id }); }
      else Object.assign(M, await modelFromDrawio(text, M));
      nameIn.value = M.name[app.lang] || M.name.it; drawTable(); rebuild.fitted = false; rebuild();
      d.body.querySelectorAll('.dimrow input').forEach((inp, k) => { inp.value = M.params[['w', 'd', 'h'][k]]; });
    } catch (e) { app.toast(`${t('editor.importError')} ${e.message || ''}`, 'bad'); }
  });

  d.body.append(h('div.editor-grid', {},
    h('div', {},
      h('label.field.stack', {}, h('span', {}, t('insp.name')), nameIn),
      h('div.row', {}, h('label.field', { style: { flex: 1 } }, h('span', {}, t('editor.category')), catSel), h('label.field', {}, h('span', {}, t('insp.color')), color)),
      h('div.dimrow', {}, dimIn('w'), dimIn('d'), dimIn('h')),
      h('label.field', {}, h('span', {}, t('insp.elevation')), h('span.unit-input', {}, elevIn, h('em', {}, 'm'))),
      h('div.section', {}, h('h3', {}, t('editor.tags')), tags, h('p.hint.small', {}, t('editor.tagsHint'))),
      h('div.section', {}, h('h3', {}, t('editor.parts')), h('div', { style: { overflowX: 'auto' } }, table),
        h('div.row', { style: { marginTop: '6px' } },
          h('button.btn.small', { onclick: () => { M.parts.push({ s: 'box', x: 0, y: 0, z: 0, w: 0.2, h: 0.2, d: 0.2, r: 0.01, m: 'main' }); drawTable(); rebuild(); } }, icon('plus'), t('editor.addBox')),
          h('button.btn.small', { onclick: () => { M.parts.push({ s: 'cyl', x: 0, y: 0, z: 0, w: 0.1, h: 0.4, d: 0.1, m: 'dark' }); drawTable(); rebuild(); } }, icon('plus'), t('editor.addCyl'))),
        h('p.hint.small', {}, t('editor.exprHint'))),
    ),
    h('div', {}, prev, status, h('div.section', {}, h('h3', {}, t('editor.topView')), top),
      h('div.row', {}, h('button.btn.small', { onclick: () => fileIn.click() }, icon('upload'), t('editor.import')),
        h('button.btn.small', { onclick: () => download(`${M.id}.json`, JSON.stringify(M, null, 1), 'application/json') }, icon('download'), t('editor.export')), fileIn),
      h('p.hint.small', {}, t('editor.drawioHint'))),
  ));
  d.foot.append(...[
    model?.custom ? h('button.btn.danger.ghost', { onclick: () => { app.library.models = app.library.models.filter((m) => m.id !== model.id); app.saveLibrary(); d.close(); app.renderPanel(); } }, icon('trash'), t('common.delete')) : null,
    h('span.grow'),
    h('button.btn.ghost', { onclick: () => d.close() }, t('common.cancel')),
    h('button.btn.primary', { onclick: () => {
      let valid; try { valid = validateModel(M); } catch (e) { app.toast(e.message, 'bad'); return; }
      const i = app.library.models.findIndex((m) => m.id === valid.id);
      if (i >= 0) app.library.models[i] = valid; else app.library.models.push(valid);
      app.saveLibrary(); d.close(); app.ui.library = { q: '', cat: 'custom' }; app.openPanel('library'); app.toast(t('editor.saved'));
      app.refreshViews();
    } }, icon('check'), t('editor.save'))].filter(Boolean));
  rebuild();
  if (fromDrawio) setTimeout(() => fileIn.click(), 50);
  void getModel; void allModels;
  return d;
}

/** Build a model from a draw.io top view: every shape becomes a part (scaled from labels, or 1 px = 1 cm). */
export async function modelFromDrawio(text, M) {
  const doc = await parseDrawio(text);
  const cells = doc.pages[0].cells.filter((c) => c.vertex && c.box && !c.isEdgeLabel).map(prepareCell)
    .filter((c) => !(c.style._first === 'text' || c.style.text));
  if (!cells.length) throw new Error('no shapes');
  const minX = Math.min(...cells.map((c) => c.box.x)), minY = Math.min(...cells.map((c) => c.box.y));
  const maxX = Math.max(...cells.map((c) => c.box.x + c.box.w)), maxY = Math.max(...cells.map((c) => c.box.y + c.box.h));
  let scale = 0.01;
  const biggest = cells.slice().sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const lb = parseLabel(biggest.text);
  if (lb.wxd) scale = lb.wxd[0] / biggest.box.w; else if (lb.measure) scale = lb.measure / biggest.box.w;
  const W = (maxX - minX) * scale, D = (maxY - minY) * scale;
  const parts = cells.map((c) => {
    const p = parseLabel(c.text);
    const height = p.height || (c === biggest ? 0.75 : 0.4);
    const elev = p.sill || 0;
    const cx = ((c.box.x + c.box.w / 2 - minX) * scale - W / 2) / W, cz = ((c.box.y + c.box.h / 2 - minY) * scale - D / 2) / D;
    const fw = (c.box.w * scale) / W, fd = (c.box.h * scale) / D;
    const r4 = (v) => Math.round(v * 1000) / 1000;
    const fill = c.style.fillColor && c.style.fillColor !== 'none' ? c.style.fillColor : null;
    return { s: c.shapeName === 'ellipse' ? 'cyl' : 'box', x: `w*${r4(cx)}`, z: `d*${r4(cz)}`, y: elev, w: `w*${r4(fw)}`, d: `d*${r4(fd)}`, h: height, r: c.style.rounded === '1' ? 0.03 : 0.008, m: fill && c !== biggest ? 'accent' : 'main' };
  });
  const top = Math.max(...parts.map((p) => p.y + p.h));
  for (const p of parts) { p.h = `h*${Math.round((p.h / top) * 1000) / 1000}`; p.y = p.y ? `h*${Math.round((p.y / top) * 1000) / 1000}` : 0; }
  return { params: { w: Math.round(W * 100) / 100, d: Math.round(D * 100) / 100, h: Math.round(top * 100) / 100 }, parts, name: biggest.text ? { it: parseLabel(biggest.text).name || M.name.it, en: parseLabel(biggest.text).name || M.name.en } : M.name, color: biggest.style.fillColor && biggest.style.fillColor !== 'none' ? biggest.style.fillColor : M.color };
}
