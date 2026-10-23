// Parametric furniture library.
//
// A model is pure data, so the in-app editor, user files and this built-in list share one format:
// {
//   id, name: {it, en}, cat, color, params: {w, d, h} (metres, defaults), elevation?,
//   tags: ['wall'|'tall'|'seat'|'light'|'low'|'center'], rel?: {type:'beside'|'around'|'faces'|'front', target:modelPrefix},
//   parts: [ { s:'box'|'cyl'|'sph', x, y, z, w, h, d, r?, tp?, ax?, m, rep? } ]
// }
// Coordinates: x across the width (centre 0), z across the depth (back = -d/2, front = +d/2), y up from the floor.
// Any numeric field may be an expression using: w d h H(floor height) i n (repeat index/count)
// and min max round floor ceil abs sqrt sin cos PI.
// Materials (m): main (item colour), soft (lighter main), wood, dark, white, metal, black, glass,
// ceramic, mattress, leaf, pot, counter, screen, accent.

const T = (it, en) => ({ it, en });

const sofaParts = [
  { s: 'cyl', x: '-w/2+0.08', y: 0, z: '-d/2+0.08', w: 0.05, d: 0.05, h: 0.1, m: 'dark' },
  { s: 'cyl', x: 'w/2-0.08', y: 0, z: '-d/2+0.08', w: 0.05, d: 0.05, h: 0.1, m: 'dark' },
  { s: 'cyl', x: '-w/2+0.08', y: 0, z: 'd/2-0.08', w: 0.05, d: 0.05, h: 0.1, m: 'dark' },
  { s: 'cyl', x: 'w/2-0.08', y: 0, z: 'd/2-0.08', w: 0.05, d: 0.05, h: 0.1, m: 'dark' },
  { s: 'box', x: 0, y: 0.1, z: 0, w: 'w', h: 0.28, d: 'd', r: 0.04, m: 'main' },
  { s: 'box', x: 0, y: 0.1, z: '-d/2+0.11', w: 'w-0.02', h: 'h-0.1', d: 0.22, r: 0.07, m: 'main' },
  { s: 'box', x: '-w/2+0.08', y: 0.1, z: 0.01, w: 0.16, h: 0.5, d: 'd-0.02', r: 0.06, m: 'main' },
  { s: 'box', x: 'w/2-0.08', y: 0.1, z: 0.01, w: 0.16, h: 0.5, d: 'd-0.02', r: 0.06, m: 'main' },
  { rep: 'max(1, round((w-0.32)/0.62))', s: 'box', x: '-(w-0.32)/2 + (w-0.32)/n*(i+0.5)', y: 0.38, z: 0.11, w: '(w-0.32)/n-0.015', h: 0.14, d: 'd-0.26', r: 0.05, m: 'soft' },
  { rep: 'max(1, round((w-0.32)/0.62))', s: 'box', x: '-(w-0.32)/2 + (w-0.32)/n*(i+0.5)', y: 0.4, z: '-d/2+0.3', w: '(w-0.32)/n-0.02', h: 'h-0.45', d: 0.16, r: 0.06, m: 'soft' },
];

export const BUILTIN_MODELS = [
  // ---------- living ----------
  { id: 'sofa3', name: T('Divano 3 posti', '3-seat sofa'), cat: 'living', color: '#7d8a99', params: { w: 2.2, d: 0.95, h: 0.85 }, tags: ['wall', 'seat'], rel: { type: 'faces', target: 'tv' }, parts: sofaParts },
  { id: 'sofa2', name: T('Divano 2 posti', '2-seat sofa'), cat: 'living', color: '#a3876a', params: { w: 1.6, d: 0.9, h: 0.85 }, tags: ['wall', 'seat'], rel: { type: 'faces', target: 'tv' }, parts: sofaParts },
  {
    id: 'armchair', name: T('Poltrona', 'Armchair'), cat: 'living', color: '#c0866b', params: { w: 0.85, d: 0.85, h: 0.85 }, tags: ['seat'], rel: { type: 'near', target: 'sofa' }, parts: [
      { s: 'box', x: 0, y: 0.08, z: 0, w: 'w', h: 0.3, d: 'd', r: 0.05, m: 'main' },
      { s: 'box', x: 0, y: 0.08, z: '-d/2+0.1', w: 'w', h: 'h-0.08', d: 0.2, r: 0.07, m: 'main' },
      { s: 'box', x: '-w/2+0.07', y: 0.08, z: 0, w: 0.14, h: 0.5, d: 'd', r: 0.06, m: 'main' },
      { s: 'box', x: 'w/2-0.07', y: 0.08, z: 0, w: 0.14, h: 0.5, d: 'd', r: 0.06, m: 'main' },
      { s: 'box', x: 0, y: 0.38, z: 0.1, w: 'w-0.3', h: 0.13, d: 'd-0.24', r: 0.05, m: 'soft' },
      { s: 'cyl', x: '-w/2+0.08', y: 0, z: '-d/2+0.08', w: 0.04, d: 0.04, h: 0.08, m: 'dark' },
      { s: 'cyl', x: 'w/2-0.08', y: 0, z: '-d/2+0.08', w: 0.04, d: 0.04, h: 0.08, m: 'dark' },
      { s: 'cyl', x: '-w/2+0.08', y: 0, z: 'd/2-0.08', w: 0.04, d: 0.04, h: 0.08, m: 'dark' },
      { s: 'cyl', x: 'w/2-0.08', y: 0, z: 'd/2-0.08', w: 0.04, d: 0.04, h: 0.08, m: 'dark' },
    ],
  },
  {
    id: 'coffee_table', name: T('Tavolino', 'Coffee table'), cat: 'living', color: '#b48a60', params: { w: 1.1, d: 0.6, h: 0.42 }, tags: ['low', 'center'], rel: { type: 'front', target: 'sofa' }, parts: [
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.015, m: 'main' },
      { s: 'box', x: 0, y: 0.12, z: 0, w: 'w-0.12', h: 0.02, d: 'd-0.12', r: 0.008, m: 'main' },
      { s: 'cyl', x: '-w/2+0.06', y: 0, z: '-d/2+0.06', w: 0.035, d: 0.035, h: 'h-0.04', m: 'dark' },
      { s: 'cyl', x: 'w/2-0.06', y: 0, z: '-d/2+0.06', w: 0.035, d: 0.035, h: 'h-0.04', m: 'dark' },
      { s: 'cyl', x: '-w/2+0.06', y: 0, z: 'd/2-0.06', w: 0.035, d: 0.035, h: 'h-0.04', m: 'dark' },
      { s: 'cyl', x: 'w/2-0.06', y: 0, z: 'd/2-0.06', w: 0.035, d: 0.035, h: 'h-0.04', m: 'dark' },
    ],
  },
  {
    id: 'tv_unit', name: T('Mobile TV', 'TV unit'), cat: 'living', color: '#e9e4dc', params: { w: 1.8, d: 0.42, h: 0.48 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0.06, z: 0, w: 'w', h: 'h-0.06', d: 'd', r: 0.012, m: 'main' },
      { s: 'box', x: 0, y: 0, z: 0, w: 'w-0.1', h: 0.06, d: 'd-0.1', m: 'dark' },
      { rep: 'max(2, round(w/0.6))', s: 'box', x: '-w/2 + w/n*(i+0.5)', y: 0.1, z: 'd/2', w: 'w/n-0.012', h: 'h-0.14', d: 0.01, r: 0.004, m: 'soft' },
      { s: 'box', x: 0, y: 'h', z: -0.02, w: 0.3, h: 0.03, d: 0.2, r: 0.01, m: 'black' },
      { s: 'box', x: 0, y: 'h+0.03', z: -0.03, w: 0.05, h: 0.12, d: 0.04, m: 'black' },
      { s: 'box', x: 0, y: 'h+0.1', z: -0.03, w: 'min(w*0.75, 1.45)', h: 'min(w*0.75, 1.45)*0.5625', d: 0.04, r: 0.01, m: 'screen' },
    ],
  },
  {
    id: 'bookcase', name: T('Libreria', 'Bookcase'), cat: 'living', color: '#d9c7a8', params: { w: 0.9, d: 0.35, h: 1.9 }, tags: ['wall', 'tall'], parts: [
      { s: 'box', x: '-w/2+0.012', y: 0, z: 0, w: 0.025, h: 'h', d: 'd', m: 'main' },
      { s: 'box', x: 'w/2-0.012', y: 0, z: 0, w: 0.025, h: 'h', d: 'd', m: 'main' },
      { s: 'box', x: 0, y: 0, z: '-d/2+0.006', w: 'w', h: 'h', d: 0.012, m: 'main' },
      { rep: 'max(2, floor(h/0.36))+1', s: 'box', x: 0, y: '(h-0.025)*i/(n-1)', z: 0, w: 'w-0.05', h: 0.025, d: 'd', m: 'main' },
      { rep: 'max(1, floor(h/0.36))', s: 'box', x: '-w/2+0.03+ (w-0.06)*0.3*(1+0.4*sin(i*2.1))/2', y: '(h-0.025)*i/max(1, floor(h/0.36)) + 0.025', z: 0, w: '(w-0.06)*0.55*(0.7+0.3*cos(i*1.7))', h: '0.24 + 0.05*sin(i*3)', d: 'd*0.8', m: 'accent' },
    ],
  },
  {
    id: 'rug', name: T('Tappeto', 'Rug'), cat: 'living', color: '#c9b79c', params: { w: 2.0, d: 1.4, h: 0.012 }, tags: ['low', 'center', 'flat'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.004, m: 'main' },
      { s: 'box', x: 0, y: 'h', z: 0, w: 'w-0.16', h: 0.002, d: 'd-0.16', m: 'soft' },
    ],
  },
  {
    id: 'floor_lamp', name: T('Lampada da terra', 'Floor lamp'), cat: 'living', color: '#f2ede4', params: { w: 0.35, d: 0.35, h: 1.6 }, tags: ['tall'], parts: [
      { s: 'cyl', x: 0, y: 0, z: 0, w: 0.28, d: 0.28, h: 0.025, m: 'black' },
      { s: 'cyl', x: 0, y: 0.02, z: 0, w: 0.025, d: 0.025, h: 'h-0.3', m: 'metal' },
      { s: 'cyl', x: 0, y: 'h-0.32', z: 0, w: 'w', d: 'd', h: 0.32, tp: 0.65, m: 'main' },
    ],
  },
  {
    id: 'plant', name: T('Pianta', 'Plant'), cat: 'decor', color: '#5f8a5a', params: { w: 0.5, d: 0.5, h: 1.2 }, tags: [], parts: [
      { s: 'cyl', x: 0, y: 0, z: 0, w: 'w*0.65', d: 'd*0.65', h: 'h*0.28', tp: 1.2, m: 'pot' },
      { s: 'sph', x: 0, y: 'h*0.3', z: 0, w: 'w*0.9', d: 'd*0.9', h: 'h*0.45', m: 'main' },
      { s: 'sph', x: 'w*0.12', y: 'h*0.52', z: '-d*0.08', w: 'w*0.75', d: 'd*0.75', h: 'h*0.4', m: 'main' },
      { s: 'sph', x: '-w*0.1', y: 'h*0.62', z: 'd*0.1', w: 'w*0.6', d: 'd*0.6', h: 'h*0.38', m: 'soft' },
    ],
  },
  {
    id: 'piano', name: T('Pianoforte', 'Upright piano'), cat: 'living', color: '#1f1f22', params: { w: 1.5, d: 0.6, h: 1.25 }, tags: ['wall', 'tall'], parts: [
      { s: 'box', x: 0, y: 0, z: '-d/2+0.15', w: 'w', h: 'h', d: 0.3, r: 0.02, m: 'main' },
      { s: 'box', x: 0, y: 0.68, z: 0.05, w: 'w-0.1', h: 0.05, d: 0.3, r: 0.01, m: 'main' },
      { s: 'box', x: 0, y: 0.73, z: 0.08, w: 'w-0.14', h: 0.02, d: 0.16, m: 'white' },
      { s: 'box', x: '-w/2+0.04', y: 0, z: 0.05, w: 0.06, h: 0.73, d: 0.3, m: 'main' },
      { s: 'box', x: 'w/2-0.04', y: 0, z: 0.05, w: 0.06, h: 0.73, d: 0.3, m: 'main' },
    ],
  },
  // ---------- dining ----------
  {
    id: 'table_rect', name: T('Tavolo', 'Dining table'), cat: 'dining', color: '#b8875a', params: { w: 1.6, d: 0.9, h: 0.75 }, tags: ['center', 'light'], parts: [
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.012, m: 'main' },
      { s: 'box', x: '-w/2+0.07', y: 0, z: '-d/2+0.07', w: 0.06, h: 'h-0.04', d: 0.06, r: 0.01, m: 'main' },
      { s: 'box', x: 'w/2-0.07', y: 0, z: '-d/2+0.07', w: 0.06, h: 'h-0.04', d: 0.06, r: 0.01, m: 'main' },
      { s: 'box', x: '-w/2+0.07', y: 0, z: 'd/2-0.07', w: 0.06, h: 'h-0.04', d: 0.06, r: 0.01, m: 'main' },
      { s: 'box', x: 'w/2-0.07', y: 0, z: 'd/2-0.07', w: 0.06, h: 'h-0.04', d: 0.06, r: 0.01, m: 'main' },
    ],
  },
  {
    id: 'table_round', name: T('Tavolo rotondo', 'Round table'), cat: 'dining', color: '#e8e2d8', params: { w: 1.1, d: 1.1, h: 0.75 }, tags: ['center', 'light', 'round'], parts: [
      { s: 'cyl', x: 0, y: 'h-0.035', z: 0, w: 'w', d: 'd', h: 0.035, m: 'main' },
      { s: 'cyl', x: 0, y: 0.02, z: 0, w: 0.09, d: 0.09, h: 'h-0.05', m: 'dark' },
      { s: 'cyl', x: 0, y: 0, z: 0, w: 'w*0.5', d: 'd*0.5', h: 0.03, tp: 0.8, m: 'dark' },
    ],
  },
  {
    id: 'chair', name: T('Sedia', 'Chair'), cat: 'dining', color: '#c49a6c', params: { w: 0.45, d: 0.5, h: 0.85 }, tags: ['seat', 'small'], rel: { type: 'around', target: 'table' }, parts: [
      { s: 'box', x: 0, y: 0.42, z: 0.01, w: 'w', h: 0.04, d: 'd-0.02', r: 0.012, m: 'main' },
      { s: 'cyl', x: '-w/2+0.04', y: 0, z: '-d/2+0.04', w: 0.03, d: 0.03, h: 'h-0.05', m: 'main' },
      { s: 'cyl', x: 'w/2-0.04', y: 0, z: '-d/2+0.04', w: 0.03, d: 0.03, h: 'h-0.05', m: 'main' },
      { s: 'cyl', x: '-w/2+0.04', y: 0, z: 'd/2-0.05', w: 0.03, d: 0.03, h: 0.42, m: 'main' },
      { s: 'cyl', x: 'w/2-0.04', y: 0, z: 'd/2-0.05', w: 0.03, d: 0.03, h: 0.42, m: 'main' },
      { s: 'box', x: 0, y: 'h-0.25', z: '-d/2+0.04', w: 'w-0.04', h: 0.2, d: 0.025, r: 0.01, m: 'main' },
    ],
  },
  // ---------- bedroom ----------
  {
    id: 'bed_double', name: T('Letto matrimoniale', 'Double bed'), cat: 'bedroom', color: '#9aa7b3', params: { w: 1.7, d: 2.1, h: 0.95 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0.08, z: 0.04, w: 'w', h: 0.24, d: 'd-0.08', r: 0.03, m: 'main' },
      { s: 'box', x: 0, y: 0, z: '-d/2+0.04', w: 'w', h: 'h', d: 0.08, r: 0.035, m: 'main' },
      { s: 'box', x: 0, y: 0.32, z: 0.04, w: 'w-0.08', h: 0.2, d: 'd-0.14', r: 0.05, m: 'mattress' },
      { s: 'box', x: 0, y: 0.5, z: '0.04 + (d-0.14)*0.17', w: 'w-0.04', h: 0.06, d: '(d-0.14)*0.66', r: 0.03, m: 'accent' },
      { rep: 2, s: 'box', x: '(i-0.5)*(w-0.14)/2', y: 0.52, z: '-d/2+0.32', w: '(w-0.3)/2', h: 0.11, d: 0.36, r: 0.05, m: 'white' },
      { s: 'cyl', x: '-w/2+0.08', y: 0, z: 'd/2-0.08', w: 0.05, d: 0.05, h: 0.08, m: 'dark' },
      { s: 'cyl', x: 'w/2-0.08', y: 0, z: 'd/2-0.08', w: 0.05, d: 0.05, h: 0.08, m: 'dark' },
    ],
  },
  {
    id: 'bed_single', name: T('Letto singolo', 'Single bed'), cat: 'bedroom', color: '#b9a588', params: { w: 0.95, d: 2.05, h: 0.85 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0.08, z: 0.04, w: 'w', h: 0.24, d: 'd-0.08', r: 0.03, m: 'main' },
      { s: 'box', x: 0, y: 0, z: '-d/2+0.04', w: 'w', h: 'h', d: 0.08, r: 0.035, m: 'main' },
      { s: 'box', x: 0, y: 0.32, z: 0.04, w: 'w-0.06', h: 0.18, d: 'd-0.14', r: 0.05, m: 'mattress' },
      { s: 'box', x: 0, y: 0.48, z: '0.04 + (d-0.14)*0.17', w: 'w-0.02', h: 0.06, d: '(d-0.14)*0.66', r: 0.03, m: 'accent' },
      { s: 'box', x: 0, y: 0.5, z: '-d/2+0.3', w: 'w-0.2', h: 0.1, d: 0.34, r: 0.05, m: 'white' },
    ],
  },
  {
    id: 'wardrobe', name: T('Armadio', 'Wardrobe'), cat: 'bedroom', color: '#ece8e1', params: { w: 2.0, d: 0.6, h: 2.4 }, tags: ['wall', 'tall'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd-0.02', r: 0.01, m: 'main' },
      { rep: 'max(1, round(w/0.5))', s: 'box', x: '-w/2 + w/n*(i+0.5)', y: 0.08, z: 'd/2-0.012', w: 'w/n-0.008', h: 'h-0.1', d: 0.02, r: 0.004, m: 'soft' },
      { rep: 'max(1, round(w/0.5))', s: 'box', x: '-w/2 + w/n*(i+0.5) + (i%2==0 ? 1 : -1)*(w/n/2-0.05)', y: 'h*0.45', z: 'd/2+0.005', w: 0.015, h: 0.3, d: 0.02, m: 'metal' },
    ],
  },
  {
    id: 'nightstand', name: T('Comodino', 'Nightstand'), cat: 'bedroom', color: '#cbb08c', params: { w: 0.45, d: 0.4, h: 0.5 }, tags: ['wall', 'small'], rel: { type: 'beside', target: 'bed' }, parts: [
      { s: 'box', x: 0, y: 0.08, z: 0, w: 'w', h: 'h-0.08', d: 'd', r: 0.012, m: 'main' },
      { s: 'box', x: 0, y: 'h*0.55', z: 'd/2', w: 'w-0.04', h: 'h*0.3', d: 0.01, r: 0.004, m: 'soft' },
      { s: 'box', x: 0, y: 0, z: 0, w: 'w-0.06', h: 0.08, d: 'd-0.06', m: 'dark' },
    ],
  },
  {
    id: 'dresser', name: T('Cassettiera', 'Dresser'), cat: 'bedroom', color: '#d6c2a3', params: { w: 1.2, d: 0.5, h: 0.85 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0.1, z: 0, w: 'w', h: 'h-0.1', d: 'd', r: 0.012, m: 'main' },
      { rep: 3, s: 'box', x: 0, y: '0.14 + (h-0.18)/3*i', z: 'd/2', w: 'w-0.05', h: '(h-0.18)/3-0.02', d: 0.01, r: 0.004, m: 'soft' },
      { rep: 3, s: 'box', x: 0, y: '0.14 + (h-0.18)/3*(i+0.5)', z: 'd/2+0.01', w: 0.18, h: 0.015, d: 0.02, m: 'metal' },
      { s: 'cyl', x: '-w/2+0.06', y: 0, z: '-d/2+0.06', w: 0.04, d: 0.04, h: 0.1, m: 'dark' },
      { s: 'cyl', x: 'w/2-0.06', y: 0, z: '-d/2+0.06', w: 0.04, d: 0.04, h: 0.1, m: 'dark' },
      { s: 'cyl', x: '-w/2+0.06', y: 0, z: 'd/2-0.06', w: 0.04, d: 0.04, h: 0.1, m: 'dark' },
      { s: 'cyl', x: 'w/2-0.06', y: 0, z: 'd/2-0.06', w: 0.04, d: 0.04, h: 0.1, m: 'dark' },
    ],
  },
  // ---------- office ----------
  {
    id: 'desk', name: T('Scrivania', 'Desk'), cat: 'office', color: '#efece6', params: { w: 1.4, d: 0.7, h: 0.75 }, tags: ['wall', 'light'], parts: [
      { s: 'box', x: 0, y: 'h-0.03', z: 0, w: 'w', h: 0.03, d: 'd', r: 0.008, m: 'main' },
      { s: 'box', x: '-w/2+0.02', y: 0, z: 0, w: 0.04, h: 'h-0.03', d: 'd-0.06', m: 'dark' },
      { s: 'box', x: 'w/2-0.02', y: 0, z: 0, w: 0.04, h: 'h-0.03', d: 'd-0.06', m: 'dark' },
      { s: 'box', x: 'w/2-0.25', y: 0.1, z: 0, w: 0.4, h: 'h-0.16', d: 'd-0.1', r: 0.01, m: 'wood' },
      { s: 'box', x: '-w*0.12', y: 'h+0.08', z: '-d/2+0.12', w: 0.6, h: 0.36, d: 0.03, r: 0.01, m: 'screen' },
      { s: 'box', x: '-w*0.12', y: 'h', z: '-d/2+0.12', w: 0.08, h: 0.1, d: 0.05, m: 'black' },
    ],
  },
  {
    id: 'office_chair', name: T('Sedia da ufficio', 'Office chair'), cat: 'office', color: '#3f4650', params: { w: 0.62, d: 0.62, h: 1.05 }, tags: ['seat', 'small'], rel: { type: 'front', target: 'desk' }, parts: [
      { rep: 5, s: 'box', x: '0.13*cos(i*1.2566)', y: 0.03, z: '0.13*sin(i*1.2566)', w: 0.28, h: 0.035, d: 0.04, m: 'black', rot: 'i*72' },
      { s: 'cyl', x: 0, y: 0.05, z: 0, w: 0.05, d: 0.05, h: 0.36, m: 'metal' },
      { s: 'box', x: 0, y: 0.42, z: 0.02, w: 0.5, h: 0.08, d: 0.48, r: 0.035, m: 'main' },
      { s: 'box', x: 0, y: 0.52, z: -0.23, w: 0.46, h: 'h-0.52', d: 0.07, r: 0.035, m: 'main' },
    ],
  },
  // ---------- kitchen ----------
  {
    id: 'kitchen_linear', name: T('Cucina lineare', 'Kitchen run'), cat: 'kitchen', color: '#e8e4dc', params: { w: 3.0, d: 0.62, h: 0.9 }, tags: ['wall', 'tall'], parts: [
      { s: 'box', x: 0, y: 0, z: -0.03, w: 'w', h: 0.1, d: 'd-0.1', m: 'dark' },
      { rep: 'max(1, round(w/0.6))', s: 'box', x: '-w/2 + w/n*(i+0.5)', y: 0.1, z: -0.01, w: 'w/n-0.006', h: 'h-0.14', d: 'd-0.06', r: 0.006, m: 'main' },
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.006, m: 'counter' },
      { s: 'box', x: '-w*0.22', y: 'h-0.005', z: 0.02, w: 0.6, h: 0.01, d: 0.42, r: 0.02, m: 'metal' },
      { s: 'cyl', x: '-w*0.22', y: 'h', z: '-d/2+0.07', w: 0.03, d: 0.03, h: 0.3, m: 'metal' },
      { s: 'box', x: 'w*0.2', y: 'h-0.003', z: 0.02, w: 0.6, h: 0.008, d: 0.5, r: 0.01, m: 'screen' },
      { rep: 'max(1, round(w/0.6))', s: 'box', x: '-w/2 + w/n*(i+0.5)', y: 'h+0.6', z: '-d/2+0.18', w: 'w/n-0.006', h: 0.7, d: 0.35, r: 0.006, m: 'main' },
    ],
  },
  {
    id: 'kitchen_base', name: T('Base cucina', 'Base cabinet'), cat: 'kitchen', color: '#e8e4dc', params: { w: 0.6, d: 0.62, h: 0.9 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0, z: -0.03, w: 'w', h: 0.1, d: 'd-0.1', m: 'dark' },
      { s: 'box', x: 0, y: 0.1, z: -0.01, w: 'w-0.006', h: 'h-0.14', d: 'd-0.06', r: 0.006, m: 'main' },
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.006, m: 'counter' },
    ],
  },
  {
    id: 'kitchen_wall', name: T('Pensile', 'Wall cabinet'), cat: 'kitchen', color: '#e8e4dc', params: { w: 0.6, d: 0.35, h: 0.7 }, elevation: 1.45, tags: ['wall', 'hanging'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w-0.006', h: 'h', d: 'd', r: 0.006, m: 'main' },
      { s: 'box', x: 0, y: 0.05, z: 'd/2', w: 0.12, h: 0.012, d: 0.02, m: 'metal' },
    ],
  },
  {
    id: 'sink_base', name: T('Lavello', 'Sink unit'), cat: 'kitchen', color: '#e8e4dc', params: { w: 0.9, d: 0.62, h: 0.9 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0, z: -0.03, w: 'w', h: 0.1, d: 'd-0.1', m: 'dark' },
      { s: 'box', x: 0, y: 0.1, z: -0.01, w: 'w-0.006', h: 'h-0.14', d: 'd-0.06', r: 0.006, m: 'main' },
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.006, m: 'counter' },
      { s: 'box', x: 0, y: 'h-0.005', z: 0.02, w: 'w*0.6', h: 0.01, d: 0.42, r: 0.02, m: 'metal' },
      { s: 'cyl', x: 0, y: 'h', z: '-d/2+0.07', w: 0.03, d: 0.03, h: 0.3, m: 'metal' },
    ],
  },
  {
    id: 'cooktop_base', name: T('Piano cottura + forno', 'Hob + oven'), cat: 'kitchen', color: '#e8e4dc', params: { w: 0.6, d: 0.62, h: 0.9 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0, z: -0.03, w: 'w', h: 0.1, d: 'd-0.1', m: 'dark' },
      { s: 'box', x: 0, y: 0.1, z: -0.01, w: 'w-0.006', h: 'h-0.14', d: 'd-0.06', r: 0.006, m: 'main' },
      { s: 'box', x: 0, y: 0.2, z: 'd/2-0.035', w: 'w-0.06', h: 0.5, d: 0.012, r: 0.006, m: 'screen' },
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.006, m: 'counter' },
      { s: 'box', x: 0, y: 'h-0.002', z: 0.02, w: 'w-0.04', h: 0.008, d: 0.5, r: 0.01, m: 'screen' },
    ],
  },
  {
    id: 'fridge', name: T('Frigorifero', 'Fridge'), cat: 'kitchen', color: '#d8dade', params: { w: 0.7, d: 0.68, h: 1.9 }, tags: ['wall', 'tall'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.03, m: 'main' },
      { s: 'box', x: 0, y: 'h*0.62', z: 'd/2+0.003', w: 'w-0.02', h: 0.006, d: 0.008, m: 'dark' },
      { s: 'box', x: 'w/2-0.06', y: 'h*0.66', z: 'd/2+0.02', w: 0.02, h: 0.35, d: 0.03, m: 'metal' },
      { s: 'box', x: 'w/2-0.06', y: 'h*0.35', z: 'd/2+0.02', w: 0.02, h: 0.25, d: 0.03, m: 'metal' },
    ],
  },
  {
    id: 'island', name: T('Isola', 'Kitchen island'), cat: 'kitchen', color: '#5d6b63', params: { w: 1.8, d: 0.9, h: 0.92 }, tags: ['center'], parts: [
      { s: 'box', x: 0, y: 0, z: -0.1, w: 'w-0.1', h: 'h-0.04', d: 'd-0.25', r: 0.01, m: 'main' },
      { s: 'box', x: 0, y: 'h-0.04', z: 0, w: 'w', h: 0.04, d: 'd', r: 0.01, m: 'counter' },
    ],
  },
  // ---------- bathroom ----------
  {
    id: 'toilet', name: T('WC', 'Toilet'), cat: 'bathroom', color: '#f6f6f4', params: { w: 0.38, d: 0.6, h: 0.8 }, tags: ['wall', 'small'], parts: [
      { s: 'box', x: 0, y: 0.38, z: '-d/2+0.09', w: 'w', h: 'h-0.38', d: 0.18, r: 0.04, m: 'main' },
      { s: 'cyl', x: 0, y: 0, z: 0.06, w: 'w*0.85', d: 'd-0.15', h: 0.38, tp: 1.15, m: 'main' },
      { s: 'cyl', x: 0, y: 0.38, z: 0.06, w: 'w', d: 'd-0.12', h: 0.03, m: 'main' },
    ],
  },
  {
    id: 'washbasin', name: T('Lavabo', 'Washbasin'), cat: 'bathroom', color: '#cfc3b0', params: { w: 0.7, d: 0.47, h: 0.85 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0.3, z: 0, w: 'w', h: 'h-0.42', d: 'd-0.02', r: 0.01, m: 'main' },
      { s: 'box', x: 0, y: 'h-0.12', z: 0, w: 'w', h: 0.12, d: 'd', r: 0.03, m: 'ceramic' },
      { s: 'cyl', x: 0, y: 'h', z: '-d/2+0.06', w: 0.03, d: 0.03, h: 0.18, m: 'metal' },
      { s: 'box', x: 0, y: 'h+0.4', z: '-d/2+0.01', w: 'w*0.85', h: 0.6, d: 0.02, r: 0.01, m: 'glass' },
    ],
  },
  {
    id: 'shower', name: T('Doccia', 'Shower'), cat: 'bathroom', color: '#f4f4f2', params: { w: 0.9, d: 0.9, h: 2.0 }, tags: ['wall', 'tall'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 0.05, d: 'd', r: 0.02, m: 'ceramic' },
      { s: 'box', x: 0, y: 0.05, z: 'd/2-0.005', w: 'w', h: 'h-0.05', d: 0.01, m: 'glass' },
      { s: 'box', x: 'w/2-0.005', y: 0.05, z: 0, w: 0.01, h: 'h-0.05', d: 'd', m: 'glass' },
      { s: 'cyl', x: '-w/2+0.12', y: 'h-0.1', z: '-d/2+0.12', w: 0.2, d: 0.2, h: 0.015, m: 'metal' },
      { s: 'cyl', x: '-w/2+0.03', y: 1.0, z: '-d/2+0.03', w: 0.02, d: 0.02, h: 'h-1.05', m: 'metal' },
    ],
  },
  {
    id: 'bathtub', name: T('Vasca', 'Bathtub'), cat: 'bathroom', color: '#f6f6f4', params: { w: 1.7, d: 0.75, h: 0.55 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.06, m: 'main' },
      { s: 'box', x: 0.03, y: 'h-0.004', z: 0, w: 'w-0.16', h: 0.008, d: 'd-0.14', r: 0.05, m: 'accent' },
      { s: 'cyl', x: '-w/2+0.08', y: 'h', z: 0, w: 0.03, d: 0.03, h: 0.12, m: 'metal' },
    ],
  },
  {
    id: 'washing_machine', name: T('Lavatrice', 'Washing machine'), cat: 'bathroom', color: '#f2f2f0', params: { w: 0.6, d: 0.6, h: 0.85 }, tags: ['wall'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.02, m: 'main' },
      { s: 'cyl', x: 0, y: 'h*0.25', z: 'd/2', w: 0.38, d: 0.38, h: 0.03, ax: 'z', m: 'glass' },
      { s: 'cyl', x: 0, y: 'h*0.25+0.03', z: 'd/2', w: 0.32, d: 0.32, h: 0.035, ax: 'z', m: 'screen' },
      { s: 'box', x: 0, y: 'h-0.12', z: 'd/2', w: 'w-0.06', h: 0.08, d: 0.01, m: 'soft' },
    ],
  },
  {
    id: 'radiator', name: T('Termosifone', 'Radiator'), cat: 'decor', color: '#f4f4f2', params: { w: 0.8, d: 0.1, h: 0.6 }, elevation: 0.12, tags: ['wall', 'hanging', 'small'], parts: [
      { rep: 'max(2, round(w/0.08))', s: 'box', x: '-w/2 + w/n*(i+0.5)', y: 0, z: 0, w: 'w/n-0.012', h: 'h', d: 'd', r: 0.01, m: 'main' },
    ],
  },
  // ---------- structure ----------
  {
    id: 'column', name: T('Pilastro', 'Column'), cat: 'structure', color: '#f1efe9', params: { w: 0.3, d: 0.3, h: 'H' }, tags: ['fixed', 'structural'], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.004, m: 'main' },
    ],
  },
  {
    id: 'stairs', name: T('Scala', 'Stairs'), cat: 'structure', color: '#c8a77f', params: { w: 1.0, d: 3.2, h: 'H' }, tags: ['fixed', 'structural'], parts: [
      { rep: 'max(2, round(h/0.18))', s: 'box', x: 0, y: 0, z: 'd/2 - d/n*(i+0.5)', w: 'w', h: 'h/n*(i+1)', d: 'd/n+0.002', r: 0.004, m: 'main' },
    ],
  },
  {
    id: 'box', name: T('Blocco generico', 'Generic block'), cat: 'structure', color: '#c7b8a3', params: { w: 0.6, d: 0.6, h: 0.8 }, tags: [], parts: [
      { s: 'box', x: 0, y: 0, z: 0, w: 'w', h: 'h', d: 'd', r: 0.015, m: 'main' },
    ],
  },
];

export const CATEGORIES = [
  { id: 'living', name: T('Soggiorno', 'Living') },
  { id: 'dining', name: T('Pranzo', 'Dining') },
  { id: 'bedroom', name: T('Camera', 'Bedroom') },
  { id: 'kitchen', name: T('Cucina', 'Kitchen') },
  { id: 'bathroom', name: T('Bagno', 'Bathroom') },
  { id: 'office', name: T('Studio', 'Office') },
  { id: 'decor', name: T('Decoro', 'Decor') },
  { id: 'structure', name: T('Struttura', 'Structure') },
  { id: 'custom', name: T('I miei modelli', 'My models') },
];

/** Room kits used by auto-furnish ("Camera da letto" → bed + 2 nightstands + wardrobe …). */
export const KITS = [
  { id: 'bedroom', name: T('Camera matrimoniale', 'Double bedroom'), items: ['bed_double', 'nightstand', 'nightstand', 'wardrobe', 'dresser'] },
  { id: 'kidroom', name: T('Cameretta', 'Kids room'), items: ['bed_single', 'desk', 'office_chair', 'wardrobe', 'bookcase'] },
  { id: 'living', name: T('Soggiorno', 'Living room'), items: ['sofa3', 'armchair', 'coffee_table', 'tv_unit', 'bookcase', 'plant', 'rug'] },
  { id: 'dining', name: T('Zona pranzo', 'Dining area'), items: ['table_rect', 'chair', 'chair', 'chair', 'chair'] },
  { id: 'kitchen', name: T('Cucina', 'Kitchen'), items: ['kitchen_linear', 'fridge', 'table_round', 'chair', 'chair'] },
  { id: 'office', name: T('Studio', 'Home office'), items: ['desk', 'office_chair', 'bookcase', 'armchair', 'plant'] },
  { id: 'bathroom', name: T('Bagno', 'Bathroom'), items: ['toilet', 'washbasin', 'shower', 'washing_machine'] },
];
