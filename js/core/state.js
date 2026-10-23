// Application state: the project document, selection, undo/redo history and change events.
import { Emitter, uid, clone } from './util.js';

export const FORMAT = 'murello';
export const FORMAT_VERSION = 1;

export function newFloor(name = 'Piano terra', elevation = 0, height = 2.7) {
  return { id: uid('floor'), name, elevation, height, nodes: [], walls: [], rooms: [], items: [] };
}

export function newProject(name = 'Nuovo progetto') {
  const f = newFloor();
  const now = new Date().toISOString();
  return {
    format: FORMAT, version: FORMAT_VERSION,
    meta: { name, created: now, modified: now, app: 'Murello' },
    settings: { wallHeight: 2.7, extThickness: 0.30, intThickness: 0.10, slab: 0.30, measureMode: 'net' },
    floors: [f], activeFloor: f.id,
    customModels: [],
    source: null,
  };
}

class Store extends Emitter {
  constructor() {
    super();
    this.project = newProject();
    this.selection = null;
    this.past = []; this.future = [];
    this._gesture = null;
    this.maxHistory = 80;
  }
  get floor() { return this.project.floors.find((f) => f.id === this.project.activeFloor) || this.project.floors[0]; }
  floorById(id) { return this.project.floors.find((f) => f.id === id); }

  setProject(p, { keepHistory = false } = {}) {
    if (keepHistory) this._push();
    else { this.past = []; this.future = []; }
    this.project = p;
    if (!p.floors.find((f) => f.id === p.activeFloor)) p.activeFloor = p.floors[0]?.id;
    this.selection = null;
    this.emit('project', p);
    this.emit('change', { kind: 'project' });
    this.emit('select', null);
    this.emit('history');
  }

  _snapshot() { return JSON.stringify(this.project); }
  _push() {
    this.past.push(this._snapshot());
    if (this.past.length > this.maxHistory) this.past.shift();
    this.future = [];
  }

  /** Apply a change with undo support. `fn(project, floor)` mutates in place. */
  commit(label, fn, info = {}) {
    if (this._gesture) { fn(this.project, this.floor); this.emit('change', { label, ...info, live: true }); return; }
    this._push();
    fn(this.project, this.floor);
    this.project.meta.modified = new Date().toISOString();
    this.emit('change', { label, ...info });
    this.emit('history');
  }
  /** Start a continuous interaction (drag): one history entry for the whole gesture. */
  beginGesture() { if (!this._gesture) this._gesture = { snap: this._snapshot() }; }
  endGesture(label, info = {}) {
    const g = this._gesture; this._gesture = null;
    if (!g) return;
    if (g.snap !== this._snapshot()) {
      this.past.push(g.snap); if (this.past.length > this.maxHistory) this.past.shift();
      this.future = [];
      this.project.meta.modified = new Date().toISOString();
      this.emit('change', { label, ...info, gestureEnd: true });
      this.emit('history');
    }
  }
  cancelGesture() {
    const g = this._gesture; this._gesture = null;
    if (g) { this.project = JSON.parse(g.snap); this.emit('change', { kind: 'project' }); }
  }
  get inGesture() { return !!this._gesture; }

  undo() {
    if (!this.past.length) return;
    this.future.push(this._snapshot());
    this.project = JSON.parse(this.past.pop());
    this._afterHistory();
  }
  redo() {
    if (!this.future.length) return;
    this.past.push(this._snapshot());
    this.project = JSON.parse(this.future.pop());
    this._afterHistory();
  }
  _afterHistory() {
    if (this.selection && !this.resolve(this.selection)) this.select(null);
    this.emit('change', { kind: 'history' });
    this.emit('history');
  }

  select(sel) {
    const same = JSON.stringify(sel) === JSON.stringify(this.selection);
    this.selection = sel;
    if (!same) this.emit('select', sel);
  }
  /** Return the object referenced by a selection or null. */
  resolve(sel) {
    if (!sel) return null;
    const f = this.floorById(sel.floorId) || this.floor;
    if (sel.type === 'item') return f.items.find((i) => i.id === sel.id) || null;
    if (sel.type === 'wall') return f.walls.find((w) => w.id === sel.id) || null;
    if (sel.type === 'room') return { id: sel.id };
    if (sel.type === 'opening' || sel.type === 'decor') {
      const w = f.walls.find((x) => x.id === sel.wallId);
      const list = sel.type === 'opening' ? w?.openings : w?.decor;
      return list?.find((o) => o.id === sel.id) || null;
    }
    if (sel.type === 'node') return f.nodes.find((n) => n.id === sel.id) || null;
    return null;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

export const store = new Store();
export { clone };
