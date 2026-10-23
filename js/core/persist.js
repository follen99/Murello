// Autosave in the browser (localStorage). Everything stays on the user's device.
const K = { project: 'murello.project.v1', settings: 'murello.settings.v1', library: 'murello.library.v1' };

function read(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } }
function write(key, val) {
  try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); return true; } catch { return false; }
}

export const persist = {
  loadProject: () => read(K.project),
  saveProject: (json) => write(K.project, json),
  clearProject: () => { try { localStorage.removeItem(K.project); } catch { /* */ } },
  loadSettings: () => read(K.settings),
  saveSettings: (s) => write(K.settings, s),
  loadLibrary: () => read(K.library) || { models: [], rules: [], terms: [] },
  saveLibrary: (l) => write(K.library, l),
};

export const DEFAULT_SETTINGS = {
  lang: 'auto', theme: 'auto', ui: 'auto', quality: 'auto', units: 'm',
  minPassage: 0.6, comfortPassage: 0.9,
  snap: true, grid: 0.05, autoQuotes: true, showWallDims: true, showInnerDims: false, showNames: false,
  doorAngle: 20, view: null, showAllFloors: false,
  measureMode: 'net', extThickness: 0.30, intThickness: 0.10, wallHeight: 2.70, defaultUnit: 'auto',
};
