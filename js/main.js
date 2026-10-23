// Murello — application shell.
import { store, newProject, newFloor } from './core/state.js';
import { persist, DEFAULT_SETTINGS } from './core/persist.js';
import { detectDevice, featureFlags } from './core/device.js';
import { makeT, resolveLang } from './core/i18n.js';
import { h, debounce, download, slug, uid, readFileAsText, fmtLen, fmtArea } from './core/util.js';
import { icon, openDialog, confirmDialog, selectField, switchField, lengthField } from './ui/kit.js';
import { derive } from './model/derive.js';
import { collisions, snapItem } from './tools/analysis.js';
import { setCustomModels, getModel, modelDefaults, validateModel, modelName } from './furniture/models.js';
import { normaliseRule } from './categories/registry.js';
import { serializeProject, parseProject } from './io/project-io.js';
import { exportDrawio } from './io/drawio-export.js';
import { Plan2D } from './view2d/plan2d.js';
import { libraryPanel, structurePanel, toolsPanel, morePanel } from './ui/panels.js';
import { renderInspector } from './ui/inspector.js';
import { openImportWizard } from './ui/import-wizard.js';
import { AI_RULES } from './ui/ai-rules.js';
import { FEATURE_TABLE } from './core/device.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...(persist.loadSettings() || {}) };
    this.library = persist.loadLibrary();
    this.library.models = (this.library.models || []).map((m) => { try { return validateModel(m); } catch { return null; } }).filter(Boolean);
    this.library.rules = (this.library.rules || []).map(normaliseRule);
    this.library.terms = this.library.terms || [];
    setCustomModels(this.library.models);
    this.ui = {}; this.tool = null; this.panel = null; this.collisions = new Map();
    this.font = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif';
    this.applyDevice();
    this.applyTheme();
    this.applyLang();
  }

  // ------------------------------------------------------------------ setup
  applyDevice() {
    this.device = this.settings.ui === 'auto' ? detectDevice() : this.settings.ui;
    this.flags = featureFlags(this.device, this.settings.quality);
    document.documentElement.classList.toggle('is-mobile', this.flags.mobile);
    document.documentElement.classList.toggle('is-desktop', this.flags.desktop);
  }
  applyTheme() {
    const pref = this.settings.theme;
    this.theme = pref === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
    document.documentElement.dataset.theme = this.theme;
    this.viewer?.setTheme(this.theme); this.plan2d?.setTheme();
  }
  applyLang() {
    this.lang = resolveLang(this.settings.lang);
    this.t = makeT(this.lang);
    document.documentElement.lang = this.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = this.t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  }

  async init() {
    // project
    const saved = persist.loadProject();
    if (saved) { try { store.setProject(parseProject(JSON.stringify(saved))); } catch { /* start fresh */ } }
    this.plan2d = new Plan2D($('#view2d'), this);
    // 3D is loaded lazily (three.js is the heaviest part)
    this.view = this.settings.view || (this.flags.mobile ? '3d' : 'split');
    if (!this.flags.splitView && this.view === 'split') this.view = '3d';
    this.setView(this.view);
    this.bindUI();
    store.on('change', (info) => this.onChange(info));
    store.on('select', () => this.onSelect());
    store.on('history', () => this.updateHistoryButtons());
    store.on('project', () => { this.renderFloorSelect(); $('#projectName').value = store.project.meta.name; this.plan2d._fitted = false; });
    this.renderFloorSelect();
    $('#projectName').value = store.project.meta.name;
    this.onChange({ kind: 'init' });
    if (this.flags.desktop) this.openPanel('library'); else this.closePanel();
    $('#app').removeAttribute('aria-busy');
    this.renderEmpty();
    // deep link: ?example=appartamento
    const ex = new URLSearchParams(location.search).get('example');
    if (ex) openImportWizard(this, { url: `examples/${ex.replace(/[^\w-]/g, '')}.drawio` });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.settings.theme === 'auto' && this.applyTheme());
  }

  async ensureViewer() {
    if (this.viewer) return this.viewer;
    if (!this._viewerP) {
      this._viewerP = import('./view3d/viewer.js').then(({ Viewer3D }) => {
        this.viewer = new Viewer3D($('#view3d'), this);
        this.viewer.showAllFloors = this.settings.showAllFloors;
        this.viewer.sync();
        return this.viewer;
      }).catch((e) => { console.error(e); this.toast(this.t('err.webgl'), 'bad'); });
    }
    return this._viewerP;
  }

  bindUI() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]'); if (!a) return;
      const act = a.dataset.action;
      const map = {
        undo: () => store.undo(), redo: () => store.redo(), settings: () => this.openSettings(), help: () => this.openHelp(),
        'file-menu': () => this.fileMenu(a), menu: () => this.openPanel('more'), 'close-panel': () => this.closePanel(), deselect: () => store.select(null),
        fit2d: () => this.plan2d.fit(),
      };
      map[act]?.();
    });
    $('#viewSwitch').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) this.setView(b.dataset.view); });
    $('#rail').addEventListener('click', (e) => { const b = e.target.closest('[data-panel]'); if (!b) return; if (this.panel === b.dataset.panel) this.closePanel(); else this.openPanel(b.dataset.panel); });
    $('#floorSelect').addEventListener('change', (e) => this.setFloor(e.target.value));
    $('#projectName').addEventListener('change', (e) => store.commit('rename', (p) => { p.meta.name = e.target.value.trim() || p.meta.name; }));
    $('#tools3d').addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (b) this.viewer?.fit(b.dataset.cam); });
    $('#cutRange').addEventListener('input', (e) => this.viewer?.setCut(+e.target.value));
    $('#fileInput').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openImportWizard(this, { text: await readFileAsText(f), name: f.name }); });
    // drag & drop a file anywhere
    document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', async (e) => {
      const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault();
      openImportWizard(this, { text: await readFileAsText(f), name: f.name });
    });
    // bottom sheet: tap the handle to expand
    document.querySelectorAll('.sheet-handle').forEach((hd) => hd.addEventListener('click', () => hd.parentElement.classList.toggle('expanded')));
    if (this.flags.keyboard) this.bindKeys();
    window.addEventListener('beforeunload', () => this.saveNow());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctxmenu')) $('#ctxmenu').hidden = true; });
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
      if (e.key === ' ' && !typing) { this.spaceDown = true; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); store.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.exportProject(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openImport(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { if (typing) return; e.preventDefault(); const it = this.selectedItem(); if (it) this.duplicateItem(it); return; }
      if (typing) return;
      const sel = store.selection;
      if (e.key === '?') { this.openHelp(); return; }
      if (e.key === 'Escape') { if (this.tool) this.setTool(null); else store.select(null); $('#ctxmenu').hidden = true; return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); this.deleteSelection(); } return; }
      const k = e.key.toLowerCase();
      if (k === 'r' && sel?.type === 'item') { const it = this.selectedItem(); store.commit('rotate', () => { it.rot = ((it.rot || 0) + (e.shiftKey ? 270 : 90)) % 360; }); return; }
      if (k === 'm') { this.setTool(this.tool === 'measure' ? null : 'measure'); return; }
      if (k === 'w') { this.setTool(this.tool === 'wall' ? null : 'wall'); return; }
      if (k === '1') this.setView('2d'); else if (k === '2') this.setView('3d'); else if (k === '3') this.setView('split');
      else if (k === 'f') { this.plan2d.fit(); this.viewer?.fit('iso'); }
      if (e.key.startsWith('Arrow') && sel?.type === 'item') {
        e.preventDefault();
        const it = this.selectedItem(); const step = e.shiftKey ? 0.1 : 0.01;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store.commit('nudge', () => { it.x = +(it.x + dx).toFixed(4); it.y = +(it.y + dy).toFixed(4); });
      }
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ') this.spaceDown = false; });
  }

  // ------------------------------------------------------------------ change handling
  onChange(info = {}) {
    const f = store.floor;
    this.collisionsLater();
    this.plan2d.draw();
    if (this.viewer) { this.viewer.sync(); }
    else if (this.view !== '2d') this.ensureViewer();
    if (!info.live) {
      this.renderInspectorNow();
      if (this.panel && this.panel !== 'furnish' && this.panel !== 'rules') this.renderPanel();
      this.saveLater();
      this.renderEmpty();
      this.renderFloorSelect();
    }
    this.updateStatus();
    void f;
  }
  onSelect() {
    this.renderInspectorNow();
    const it = this.selectedItem();
    if (it && this.flags.mobile && this.view === '2d') requestAnimationFrame(() => this.plan2d.ensureVisible(it, $('#inspector').getBoundingClientRect().height));
    this.plan2d.draw();
    this.viewer?.updateHelpers();
    if (this.panel === 'structure') this.renderPanel();
    this.updateStatus();
  }
  refreshViews() { this.plan2d.draw(); this.viewer?.sync(); }
  collisionsLater = debounce(() => {
    const f = store.floor;
    try { this.collisions = collisions(f, derive(f)); } catch (e) { console.error(e); this.collisions = new Map(); }
    this.plan2d.draw(); this.viewer?.updateHelpers();
    if (this.panel === 'tools') this.renderPanel();
    this.updateStatus();
  }, 120);
  saveLater = debounce(() => this.saveNow(), 700);
  saveNow() {
    if (store.inGesture) return;
    const ok = persist.saveProject(serializeProject(store.project));
    if (!ok && !this._warnedQuota) { this._warnedQuota = true; this.toast(this.t('err.storage'), 'bad'); }
  }
  saveLibrary() { persist.saveLibrary(this.library); setCustomModels(this.library.models); }
  setSetting(k, v) {
    this.settings[k] = v; persist.saveSettings(this.settings);
    if (k === 'showAllFloors' && this.viewer) { this.viewer.showAllFloors = v; this.viewer.sync(); }
    if (k === 'doorAngle') this.viewer?.sync();
    this.plan2d.draw(); this.viewer?.updateHelpers();
    this.collisionsLater();
  }

  // ------------------------------------------------------------------ views & panels
  setView(v) {
    if (v === 'split' && !this.flags.splitView) v = '3d';
    this.view = v; this.settings.view = v; persist.saveSettings(this.settings);
    const views = $('#views'); views.classList.remove('mode-2d', 'mode-3d', 'mode-split'); views.classList.add(`mode-${v}`);
    document.querySelectorAll('#viewSwitch [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    if (v !== '2d') this.ensureViewer().then(() => { this.viewer?.resize(); this.viewer?.sync(); });
    requestAnimationFrame(() => { this.plan2d.resize(); });
  }
  openPanel(name, opts = {}) {
    if (name !== 'furnish') import('./ui/furnish-panel.js').then((m) => m.discardFurnishPreview(this));
    this.panel = name; this.panelOpts = opts;
    $('#sidepanel').classList.remove('collapsed');
    document.querySelectorAll('#rail [data-panel]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.panel === name)));
    if (this.flags.mobile) $('#inspector').hidden = true;
    this.renderPanel();
    requestAnimationFrame(() => { this.plan2d.resize(); this.viewer?.resize(); });
  }
  closePanel() {
    if (this.panel === 'furnish') import('./ui/furnish-panel.js').then((m) => m.discardFurnishPreview(this));
    this.panel = null;
    $('#sidepanel').classList.add('collapsed');
    document.querySelectorAll('#rail [data-panel]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    requestAnimationFrame(() => { this.plan2d.resize(); this.viewer?.resize(); });
  }
  async renderPanel() {
    const name = this.panel; if (!name) return;
    const body = $('#panelBody'); this.panelBody = body;
    $('#panelTitle').textContent = this.t(`panel.${name}`);
    const scroll = body.scrollTop;
    let content = [];
    if (name === 'library') content = libraryPanel(this);
    else if (name === 'structure') content = structurePanel(this);
    else if (name === 'tools') content = toolsPanel(this);
    else if (name === 'more') content = morePanel(this);
    else if (name === 'furnish') content = (await import('./ui/furnish-panel.js')).furnishPanel(this, this.panelOpts || {});
    else if (name === 'rules') content = (await import('./ui/rules-panel.js')).rulesPanel(this);
    if (this.panel !== name) return;
    this.panelOpts = {};
    body.replaceChildren(...content.filter(Boolean));
    body.scrollTop = scroll;
  }
  renderInspectorNow() {
    const insp = $('#inspector');
    const ok = store.selection && renderInspector(this, $('#inspBody'), $('#inspTitle'));
    const wasHidden = insp.hidden;
    insp.hidden = !ok;
    if (ok && this.flags.mobile) { this.closePanelSoft(); }
    if (wasHidden !== insp.hidden) requestAnimationFrame(() => { this.plan2d.resize(); this.viewer?.resize(); });
  }
  closePanelSoft() { if (this.panel && this.panel !== 'furnish') { this.panel = null; $('#sidepanel').classList.add('collapsed'); document.querySelectorAll('#rail [data-panel]').forEach((b) => b.setAttribute('aria-pressed', 'false')); } }
  renderFloorSelect() {
    const sel = $('#floorSelect'); const p = store.project;
    sel.replaceChildren(...p.floors.map((f) => h('option', { value: f.id, selected: f.id === p.activeFloor }, f.name)));
    sel.parentElement.hidden = p.floors.length < 2 && this.flags.mobile;
  }
  setFloor(id) {
    store.project.activeFloor = id; store.select(null);
    this.plan2d._fitted = false; this.plan2d.fit();
    this.onChange({ kind: 'floor' });
    this.viewer?.fit('iso');
  }
  setTool(tool) {
    this.tool = tool;
    this.plan2d.cancelTool(); this.viewer?.clearMeasure();
    if ((tool === 'wall' || tool === 'structure') && this.view === '3d') this.setView(this.flags.splitView ? 'split' : '2d');
    this.plan2d.cv.style.cursor = tool === 'measure' || tool === 'wall' ? 'crosshair' : '';
    if (this.panel) this.renderPanel();
    this.plan2d.draw(); this.updateStatus();
    if (tool) this.toast(this.t(`toolHint.${tool}`));
  }
  clearMeasure() { this.plan2d.clearMeasure(); this.viewer?.clearMeasure(); }
  updateHistoryButtons() {
    document.querySelector('[data-action="undo"]')?.toggleAttribute('disabled', !store.canUndo);
    document.querySelector('[data-action="redo"]')?.toggleAttribute('disabled', !store.canRedo);
  }
  updateStatus() {
    if (!this.flags.statusBar) return;
    const f = store.floor; const der = derive(f);
    const area = der.rooms.reduce((s, r) => s + r.netArea, 0);
    const errs = [...this.collisions.values()].filter((c) => c.level === 'error').length;
    const warns = this.collisions.size - errs;
    const parts = [
      h('span', {}, `${f.name} · ${der.rooms.length} ${this.t('status.rooms')} · ${fmtArea(area, this.lang)}`),
      h('span', {}, `${f.items.length} ${this.t('status.items')}`),
      errs ? h('span.bad', {}, `${errs} ${this.t('status.collisions')}`) : null,
      warns ? h('span.warn', {}, `${warns} ${this.t('status.warnings')}`) : null,
      h('span.sep'),
      h('span', {}, this.tool ? this.t(`toolHint.${this.tool}`) : this.t('status.hint')),
    ];
    $('#statusbar').replaceChildren(...parts.filter(Boolean));
  }
  renderEmpty() {
    const el = $('#emptyState');
    const empty = !store.project.floors.some((f) => f.walls.length);
    el.hidden = !empty;
    $('#views').classList.toggle('is-empty', empty);
    if (!empty) return;
    const t = this.t;
    el.replaceChildren(h('div.empty-card', {},
      h('h1', {}, t('empty.title')),
      h('p', {}, t('empty.text')),
      h('ol', {}, ...t('empty.steps').split('|').map((s) => h('li', {}, s))),
      h('div.row', {}, h('button.btn.primary', { onclick: () => this.openImport() }, icon('upload'), t('empty.import')),
        h('button.btn', { onclick: () => openImportWizard(this, { url: 'examples/appartamento.drawio' }) }, t('empty.example'))),
      h('div.row', {}, h('button.btn.ghost.small', { onclick: () => { this.setView(this.flags.splitView ? 'split' : '2d'); this.setTool('wall'); } }, icon('pencil'), t('empty.draw')))));
  }

  // ------------------------------------------------------------------ actions
  selectedItem() { const s = store.selection; return s?.type === 'item' ? store.floor.items.find((i) => i.id === s.id) : null; }
  addItem(modelId, at = null) {
    const f = store.floor; const der = derive(f); const m = getModel(modelId);
    let p = at;
    if (!p) {
      const selRoom = store.selection?.type === 'room' ? der.rooms.find((r) => r.id === store.selection.id) : null;
      const center = this.view === '3d' && this.viewer ? { x: this.viewer.controls.target.x, y: this.viewer.controls.target.z } : this.plan2d.toWorld({ x: this.plan2d.W / 2, y: this.plan2d.H / 2 });
      const room = selRoom || der.rooms.find((r) => pointInPolyLocal(center, r.poly)) || der.rooms.slice().sort((a, b) => b.area - a.area)[0];
      p = room ? room.labelPos : center;
    }
    const it = { id: uid('i'), model: modelId, name: '', x: +p.x.toFixed(3), y: +p.y.toFixed(3), rot: 0, w: null, d: null, h: null, elevation: m.elevation || 0, color: null, params: {} };
    const s = snapItem(f, der, it, it.x, it.y, 0, { grid: this.settings.grid, walls: false });
    it.x = s.x; it.y = s.y;
    store.commit('add', (pj, fl) => { fl.items.push(it); });
    store.select({ type: 'item', id: it.id, floorId: f.id });
    if (this.flags.haptics) navigator.vibrate?.(10);
  }
  duplicateItem(it) {
    const copy = { ...JSON.parse(JSON.stringify(it)), id: uid('i'), x: it.x + 0.3, y: it.y + 0.3, locked: false };
    store.commit('duplicate', (p, f) => { f.items.push(copy); });
    store.select({ type: 'item', id: copy.id, floorId: store.floor.id });
  }
  pushToWall(it) {
    const f = store.floor; const s = snapItem(f, derive(f), it, it.x, it.y, it.rot || 0, { grid: 0, snapDist: 3 });
    store.commit('toWall', () => { it.x = s.x; it.y = s.y; it.rot = s.rot; });
  }
  deleteSelection() {
    const sel = store.selection; if (!sel) return;
    store.commit('delete', (p, f) => {
      if (sel.type === 'item') f.items = f.items.filter((i) => i.id !== sel.id);
      else if (sel.type === 'wall') f.walls = f.walls.filter((w) => w.id !== sel.id);
      else if (sel.type === 'opening') { const w = f.walls.find((x) => x.id === sel.wallId); if (w) w.openings = w.openings.filter((o) => o.id !== sel.id); }
      else if (sel.type === 'decor') { const w = f.walls.find((x) => x.id === sel.wallId); if (w) w.decor = w.decor.filter((o) => o.id !== sel.id); }
      else if (sel.type === 'node') { f.walls = f.walls.filter((w) => w.a !== sel.id && w.b !== sel.id); f.nodes = f.nodes.filter((n) => n.id !== sel.id); }
      else if (sel.type === 'room') { f.rooms = f.rooms.filter((r) => r.id !== sel.id); }
      const used = new Set(f.walls.flatMap((w) => [w.a, w.b]));
      f.nodes = f.nodes.filter((n) => used.has(n.id) || sel.type === 'node');
    });
    store.select(null);
  }
  addFloor(copy) {
    const p = store.project; const cur = store.floor;
    const top = p.floors.reduce((m, f) => Math.max(m, (f.elevation || 0) + f.height), 0);
    const f = newFloor(this.t('struct.floorN', { n: p.floors.length }), top + (p.settings.slab ?? 0.3), cur.height);
    if (copy) {
      const map = new Map();
      f.nodes = cur.nodes.map((n) => { const id = uid('n'); map.set(n.id, id); return { ...n, id }; });
      const der = derive(cur); const ext = new Set(der.walls.filter((x) => !x.roomL || !x.roomR).map((x) => x.id));
      f.walls = cur.walls.filter((w) => ext.has(w.id)).map((w) => ({ ...JSON.parse(JSON.stringify(w)), id: uid('w'), a: map.get(w.a), b: map.get(w.b), openings: (w.openings || []).filter((o) => o.type === 'window').map((o) => ({ ...o, id: uid('o') })), decor: [] }));
      const used = new Set(f.walls.flatMap((w) => [w.a, w.b])); f.nodes = f.nodes.filter((n) => used.has(n.id));
    }
    store.commit('addFloor', (pj) => { pj.floors.push(f); pj.activeFloor = f.id; });
    this.renderFloorSelect(); this.setFloor(f.id);
  }
  async deleteFloor(id) {
    const f = store.floorById(id);
    if (!(await confirmDialog(this, { title: this.t('struct.deleteFloor'), text: this.t('struct.deleteFloorText', { name: f.name }), ok: this.t('common.delete'), danger: true }))) return;
    store.commit('delFloor', (p) => { p.floors = p.floors.filter((x) => x.id !== id); p.activeFloor = p.floors[0].id; });
    this.renderFloorSelect(); this.setFloor(store.project.activeFloor);
  }
  async newProject() {
    if (store.project.floors.some((f) => f.walls.length) && !(await confirmDialog(this, { title: this.t('menu.new'), text: this.t('confirm.new'), ok: this.t('menu.new'), danger: true }))) return;
    store.setProject(newProject(this.t('project.untitled')));
    this.plan2d._fitted = false; this.onChange({ kind: 'project' });
  }
  openImport() { openImportWizard(this); }
  loadProject(p, { keepHistory = false } = {}) {
    for (const m of p.customModels || []) if (!this.library.models.find((x) => x.id === m.id)) this.library.models.push(m);
    this.saveLibrary();
    store.setProject(p, { keepHistory });
    this.plan2d._fitted = false; this.plan2d.fit();
    if (this.viewer) { this.viewer._firstFit = true; this.viewer.sync(); this.viewer.fit('iso', false); }
    else this.ensureViewer();
    this.onChange({ kind: 'project' });
    this.saveNow();
  }
  exportProject() {
    download(`${slug(store.project.meta.name)}.murello.json`, serializeProject(store.project), 'application/json');
    this.toast(this.t('toast.exported'));
  }
  exportDrawio() {
    download(`${slug(store.project.meta.name)}.drawio`, exportDrawio(store.project, { lang: this.lang }), 'application/xml');
    this.toast(this.t('toast.exportedDrawio'));
  }
  async saveImage() {
    if (this.view === '2d') { this.plan2d._draw(); this.plan2d.cv.toBlob((b) => download(`${slug(store.project.meta.name)}-2d.png`, b)); return; }
    const v = await this.ensureViewer(); const url = v.snapshot();
    const a = document.createElement('a'); a.href = url; a.download = `${slug(store.project.meta.name)}-3d.png`; a.click();
  }
  mergeLibrary(lib, { fromFile = false } = {}) {
    let models = 0, rules = 0, terms = 0;
    for (const m of lib.models || []) { try { const v = validateModel(m); const i = this.library.models.findIndex((x) => x.id === v.id); if (i >= 0) this.library.models[i] = v; else this.library.models.push(v); models++; } catch { /* skip */ } }
    for (const r of lib.rules || []) { const n = normaliseRule({ ...r, approved: fromFile && r.code ? false : r.approved }); if (fromFile && n.code) n.approved = false; this.library.rules.push(n); rules++; }
    for (const tm of lib.terms || []) { this.library.terms.push({ ...tm, id: tm.id || uid('t'), approved: fromFile ? false : tm.approved }); terms++; }
    this.saveLibrary(); this.renderPanel();
    return { models, rules, terms };
  }
  async openModelEditor(opts = {}) {
    const { openModelEditor } = await import('./ui/model-editor.js');
    openModelEditor(this, opts);
  }

  fileMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const t = this.t;
    this.showMenu(r.left, r.bottom + 4, [
      ['file', t('menu.new'), () => this.newProject()],
      ['upload', t('menu.import'), () => this.openImport(), 'Ctrl+O'],
      '-',
      ['download', t('menu.exportProject'), () => this.exportProject(), 'Ctrl+S'],
      ['download', t('menu.exportDrawio'), () => this.exportDrawio()],
      ['camera', t('tools.saveImage'), () => this.saveImage()],
      '-',
      ['tag', t('rules.manage'), () => this.openPanel('rules')],
      ['plus', t('lib.newModel'), () => this.openModelEditor()],
    ]);
  }
  contextMenu(x, y, hit) {
    const t = this.t;
    const items = [];
    if (hit.type === 'item') {
      const it = this.selectedItem(); if (!it) return;
      items.push(['rotate', t('ctx.rotate'), () => store.commit('rotate', () => { it.rot = ((it.rot || 0) + 90) % 360; }), 'R'],
        ['copy', t('insp.duplicate'), () => this.duplicateItem(it), 'Ctrl+D'],
        ['wall', t('insp.toWall'), () => this.pushToWall(it)],
        ['lock', it.locked ? t('ctx.unlock') : t('ctx.lock'), () => store.commit('lock', () => { it.locked = !it.locked; })], '-',
        ['trash', t('common.delete'), () => this.deleteSelection(), 'Del']);
    } else if (hit.type === 'wall') {
      items.push(['window', t('ctx.addWindow'), () => this.quickAdd('window')], ['door', t('ctx.addDoor'), () => this.quickAdd('door')], ['picture', t('ctx.addPicture'), () => this.quickAdd('picture')], '-', ['trash', t('common.delete'), () => this.deleteSelection()]);
    } else if (hit.type === 'room') {
      items.push(['wand', t('insp.autoFurnish'), () => this.openPanel('furnish', { roomId: hit.id })]);
    } else items.push(['trash', t('common.delete'), () => this.deleteSelection(), 'Del']);
    this.showMenu(x, y, items);
  }
  quickAdd(kind) {
    const insp = $('#inspBody');
    const btn = [...insp.querySelectorAll('button')].find((b) => b.textContent.trim() === this.t(kind === 'picture' ? 'decor.picture' : `open.${kind}`));
    btn?.click();
  }
  showMenu(x, y, items) {
    const m = $('#ctxmenu');
    m.replaceChildren(...items.map((it) => (it === '-' ? h('hr') : h('button', { onclick: () => { m.hidden = true; it[2](); } }, icon(it[0]), h('span', {}, it[1]), it[3] && this.flags.keyboard ? h('kbd', {}, it[3]) : null))));
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`; m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  }

  toast(text, kind = '', action = null) {
    const host = $('#toasts');
    const el = h(`div.toast${kind ? `.${kind}` : ''}`, { role: 'status' }, h('span', {}, text), action ? h('button', { onclick: action.fn }, action.label) : null);
    host.appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
    while (host.children.length > 3) host.firstChild.remove();
  }

  openSettings() {
    const t = this.t; const s = this.settings;
    const d = openDialog({ title: t('menu.settings'), narrow: true, closeLabel: t('common.close') });
    const set = (k, reload) => (v) => { this.setSetting(k, v); if (reload === 'lang') { this.applyLang(); this.renderPanel(); this.renderInspectorNow(); this.renderEmpty(); this.updateStatus(); } if (reload === 'theme') this.applyTheme(); if (reload === 'device') this.toast(t('settings.reload')); };
    d.body.append(
      selectField(t('settings.lang'), s.lang, [['auto', t('settings.auto')], ['it', 'Italiano'], ['en', 'English']], set('lang', 'lang')),
      selectField(t('settings.theme'), s.theme, [['auto', t('settings.auto')], ['light', t('settings.light')], ['dark', t('settings.dark')]], set('theme', 'theme')),
      selectField(t('settings.ui'), s.ui, [['auto', `${t('settings.auto')} (${t(`settings.${this.device}`)})`], ['desktop', t('settings.desktop')], ['mobile', t('settings.mobile')]], set('ui', 'device')),
      selectField(t('settings.quality'), s.quality, [['auto', t('settings.auto')], ['high', t('settings.high')], ['low', t('settings.low')]], set('quality', 'device')),
      selectField(t('settings.units'), s.units, [['m', t('settings.metres')], ['cm', t('settings.cm')]], (v) => { set('units')(v); this.renderPanel(); this.renderInspectorNow(); }),
      h('hr.divider'),
      h('p.hint', {}, t('settings.importDefaults')),
      selectField(t('import.measureMode'), s.measureMode, [['net', t('import.modeNet')], ['axis', t('import.modeAxis')]], set('measureMode')),
      lengthField(this, t('import.extThk'), s.extThickness, set('extThickness'), { min: 0.03, max: 1 }),
      lengthField(this, t('import.intThk'), s.intThickness, set('intThickness'), { min: 0.03, max: 1 }),
      lengthField(this, t('import.height'), s.wallHeight, set('wallHeight'), { min: 1.5, max: 8 }),
      h('hr.divider'),
      h('div.row', {}, h('button.btn.small.danger', { onclick: async () => { if (await confirmDialog(this, { title: t('settings.reset'), text: t('settings.resetText'), ok: t('settings.reset'), danger: true })) { localStorage.clear(); location.reload(); } } }, t('settings.reset'))),
    );
    d.foot.append(h('button.btn.primary', { onclick: () => { d.close(); if (s.ui !== this.device && s.ui !== 'auto' || s.quality !== this.flags.quality && s.quality !== 'auto') location.reload(); } }, t('common.done')));
  }
  openHelp() {
    const t = this.t;
    const d = openDialog({ title: t('help.title'), closeLabel: t('common.close') });
    const kbd = [['1 / 2 / 3', t('help.k.views')], ['R', t('help.k.rotate')], ['Del', t('help.k.delete')], ['Ctrl+D', t('help.k.dup')], [t('help.k.arrowsKey'), t('help.k.arrows')], ['M', t('help.k.measure')], ['W', t('help.k.wall')], ['F', t('help.k.fit')], ['Ctrl+Z / Ctrl+Y', t('help.k.undo')], ['Ctrl+S', t('help.k.save')], [t('help.k.spaceKey'), t('help.k.pan')], ['Alt', t('help.k.nosnap')]];
    d.body.append(...[
      h('div.section', {}, h('h3', {}, t('help.workflow')), h('ol.hint', {}, ...t('help.workflowSteps').split('|').map((s) => h('li', {}, s)))),
      h('div.section', {}, h('h3', {}, t('help.drawio')), h('ul.hint', {}, ...t('help.drawioRules').split('|').map((s) => h('li', {}, s)))),
      this.aiRulesSection(),
      h('div.section', {}, h('h3', {}, t('help.devices')), h('p.hint', {}, t('help.devicesText', { device: t(`settings.${this.device}`) })),
        h('div.kv', {}, ...FEATURE_TABLE.flatMap(([k, dev]) => [h('dt', {}, t(`feature.${k}`)), h('dd', {}, h(`span.badge${this.flags[k] ? '.ok' : ''}`, {}, t(`settings.${dev}`)))]))),
      this.flags.keyboard ? h('div.section', {}, h('h3', {}, t('help.keys')), h('div.kv', {}, ...kbd.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', { style: { textAlign: 'left' } }, v)]))) : null,
      h('div.section', {}, h('h3', {}, t('help.privacy')), h('p.hint', {}, t('help.privacyText'))),
    ].filter(Boolean));
    d.foot.append(h('a.btn.ghost', { href: repoUrl(), target: '_blank', rel: 'noopener' }, 'GitHub'), h('button.btn.primary', { onclick: () => d.close() }, t('common.close')));
  }
  /** Copyable rules for an AI assistant that has to generate a draw.io file Murello can read. */
  aiRulesSection() {
    const t = this.t;
    const text = AI_RULES[this.lang] || AI_RULES.it;
    const area = h('textarea.code.ai-rules', { readonly: true, rows: 12, 'aria-label': t('help.ai') }, text);
    const copy = async () => {
      try { await navigator.clipboard.writeText(text); }
      catch { area.select(); document.execCommand('copy'); }
      this.toast(t('help.aiCopied'));
    };
    return h('div.section', {}, h('h3', {}, t('help.ai')), h('p.hint', {}, t('help.aiText')), area,
      h('div.row', { style: { marginTop: '6px' } }, h('button.btn.small', { type: 'button', onclick: copy }, icon('copy'), t('help.aiCopy'))));
  }
}

function repoUrl() {
  const host = location.hostname;
  if (host.endsWith('github.io')) { const user = host.split('.')[0]; const repo = location.pathname.split('/').filter(Boolean)[0]; return `https://github.com/${user}/${repo || ''}`; }
  return 'https://github.com/';
}
function pointInPolyLocal(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }

const app = new App();
window.murello = app; // handy for debugging in the console
app.__store = store;
app.init().catch((e) => { console.error(e); document.body.append(h('pre', {}, String(e.stack || e))); });
export { fmtLen, switchField, modelDefaults, modelName };
