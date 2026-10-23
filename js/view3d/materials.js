// Shared materials and small procedural textures (no image downloads → tiny and fast).
import * as THREE from 'three';
import { rng } from '../core/util.js';

const cache = new Map();
let envMap = null;
export function setEnvMap(t) { envMap = t; cache.forEach((m) => { if ('envMap' in m && m.userData.useEnv) { m.envMap = t; m.needsUpdate = true; } }); }

const PRESETS = {
  main:     { roughness: 0.75, metalness: 0 },
  soft:     { roughness: 0.9, metalness: 0 },
  wood:     { color: '#c79a6b', roughness: 0.6, metalness: 0 },
  dark:     { color: '#3d3a37', roughness: 0.55, metalness: 0.1 },
  white:    { color: '#f5f4f0', roughness: 0.5, metalness: 0 },
  metal:    { color: '#b9bcc0', roughness: 0.28, metalness: 0.85, env: true },
  black:    { color: '#222326', roughness: 0.45, metalness: 0.2 },
  glass:    { color: '#cfe3ee', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, env: true },
  ceramic:  { color: '#f7f7f5', roughness: 0.18, metalness: 0, env: true },
  mattress: { color: '#f3efe7', roughness: 0.95, metalness: 0 },
  leaf:     { color: '#5f8a5a', roughness: 0.85, metalness: 0 },
  pot:      { color: '#b86f4c', roughness: 0.8, metalness: 0 },
  counter:  { color: '#d2cdc5', roughness: 0.35, metalness: 0, env: true },
  screen:   { color: '#15171a', roughness: 0.15, metalness: 0.3, env: true },
  accent:   { roughness: 0.85, metalness: 0 },
};

/** Lighten (k>0) or darken (k<0) a hex colour. */
export function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k > 0) c.lerp(new THREE.Color('#ffffff'), k); else c.lerp(new THREE.Color('#000000'), -k);
  return `#${c.getHexString()}`;
}

export function getMat(slot, color) {
  const p = PRESETS[slot] || PRESETS.main;
  const col = color || p.color || '#cccccc';
  const key = `${slot}|${col}`;
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: col, roughness: p.roughness, metalness: p.metalness, transparent: !!p.transparent, opacity: p.opacity ?? 1 });
  if (p.transparent) { m.depthWrite = false; m.side = THREE.DoubleSide; }
  if (p.env) { m.userData.useEnv = true; if (envMap) m.envMap = envMap; m.envMapIntensity = 1.0; }
  cache.set(key, m);
  return m;
}

/** Resolve the material for a part slot of an item. */
export function itemMaterial(slot, item, model) {
  const main = item.color || model.color || '#c7b8a3';
  switch (slot) {
    case 'main': return getMat('main', main);
    case 'soft': return getMat('soft', shade(main, 0.18));
    case 'accent': return getMat('accent', item.accent || shade(main, 0.45));
    default: return getMat(slot);
  }
}

// ---------- procedural floor textures ----------
export const FLOOR_TYPES = {
  parquet:      { color: '#c9a27a', size: 1.6, draw: planks('#c4a07c', 0.05) },
  parquet_dark: { color: '#7a5a43', size: 1.6, draw: planks('#77583f', 0.06) },
  herringbone:  { color: '#c49c72', size: 1.2, draw: herringbone('#c49c72') },
  tiles:        { color: '#d9d8d3', size: 1.2, draw: tiles('#dcdbd6', 2, '#bdbbb5') },
  tiles_large:  { color: '#cfcdc7', size: 2.4, draw: tiles('#d3d1cb', 2, '#b5b2ab') },
  cotto:        { color: '#b8735a', size: 1.2, draw: tiles('#b8735a', 4, '#d9c8b4', 0.06) },
  marble:       { color: '#eeece8', size: 2.0, draw: marble('#efedea') },
  concrete:     { color: '#a9a8a3', size: 3.0, draw: noise('#acaba6', 0.06) },
  carpet:       { color: '#b9b2a6', size: 1.0, draw: noise('#b9b2a6', 0.04, 1) },
};

const texCache = new Map();
export function floorMaterial(type = 'parquet') {
  const def = FLOOR_TYPES[type] || FLOOR_TYPES.parquet;
  if (texCache.has(type)) return texCache.get(type);
  const size = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  def.draw(g, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / def.size, 1 / def.size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: type === 'marble' ? 0.25 : type === 'carpet' ? 1 : 0.7, metalness: 0 });
  if (type === 'marble' || type === 'tiles') { m.userData.useEnv = true; if (envMap) m.envMap = envMap; m.envMapIntensity = 0.35; }
  texCache.set(type, m);
  return m;
}

function jitter(hex, r, amount) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h + (r() - 0.5) * amount * 0.05, hsl.s * (1 + (r() - 0.5) * amount * 0.6), hsl.l * (1 + (r() - 0.5) * amount));
  return `#${c.getHexString()}`;
}
function planks(base, amount) {
  return (g, S) => {
    const r = rng(7); const rows = 8; const h = S / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * S * 0.6;
      while (x < S) {
        const len = S * (0.45 + r() * 0.4);
        g.fillStyle = jitter(base, r, amount * 2.2); g.fillRect(x, i * h, len, h);
        for (let k = 0; k < 7; k++) { g.strokeStyle = `rgba(60,40,20,${0.03 + r() * 0.05})`; g.lineWidth = 1 + r() * 2; const yy = i * h + r() * h; g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 6, x + len * 0.6, yy + (r() - 0.5) * 6, x + len, yy); g.stroke(); }
        g.fillStyle = 'rgba(40,25,10,0.35)'; g.fillRect(x, i * h, 2, h);
        x += len;
      }
      g.fillStyle = 'rgba(40,25,10,0.3)'; g.fillRect(0, i * h, S, 2);
    }
  };
}
function herringbone(base) {
  return (g, S) => {
    const r = rng(11); g.fillStyle = base; g.fillRect(0, 0, S, S);
    const u = S / 8; // plank width
    for (let row = -2; row < 12; row++) for (let col = -2; col < 6; col++) {
      for (const flip of [0, 1]) {
        g.save(); g.translate(col * u * 2 + flip * u, row * u * 2 / 2 * 2 + col * 0); g.translate(0, flip * u);
        g.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
        g.fillStyle = jitter(base, r, 0.25); g.fillRect(0, 0, u * 2.8, u * 0.98);
        g.strokeStyle = 'rgba(50,30,15,0.35)'; g.lineWidth = 1.5; g.strokeRect(0, 0, u * 2.8, u * 0.98);
        g.restore();
      }
    }
  };
}
function tiles(base, n, grout, var_ = 0.04) {
  return (g, S) => {
    const r = rng(3); g.fillStyle = grout; g.fillRect(0, 0, S, S);
    const t = S / n; const gw = Math.max(2, S / 220);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = jitter(base, r, var_ * 2); g.fillRect(i * t + gw / 2, j * t + gw / 2, t - gw, t - gw);
      for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(i * t + r() * t, j * t + r() * t, 2 + r() * 6, 2 + r() * 6); }
    }
  };
}
function marble(base) {
  return (g, S) => {
    const r = rng(5); g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `rgba(120,120,125,${0.06 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath(); let x = r() * S, y = 0; g.moveTo(x, y);
      while (y < S) { x += (r() - 0.5) * 60; y += 20 + r() * 40; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(180,178,172,0.5)'; g.lineWidth = 2; g.strokeRect(0, 0, S, S);
  };
}
function noise(base, amount, fine = 0) {
  return (g, S) => {
    const r = rng(9); g.fillStyle = base; g.fillRect(0, 0, S, S);
    const n = fine ? 9000 : 4000;
    for (let k = 0; k < n; k++) { const v = r(); g.fillStyle = v > 0.5 ? `rgba(255,255,255,${amount * r()})` : `rgba(0,0,0,${amount * r()})`; const s = fine ? 1 + r() * 2 : 2 + r() * 10; g.fillRect(r() * S, r() * S, s, s); }
  };
}

/** Abstract "art" for picture frames, generated from an id (no copyrighted imagery). */
const artCache = new Map();
export function artMaterial(seedStr = 'a') {
  if (artCache.has(seedStr)) return artCache.get(seedStr);
  let seed = 0; for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(seed || 1);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const palettes = [['#e9e2d4', '#d26b4a', '#2f5d62', '#e3b448'], ['#f1ede6', '#3c4f76', '#b9c5d6', '#d98e73'], ['#efe9df', '#6d8a6b', '#2b2b2b', '#cfa66b'], ['#f4efe9', '#c94f4f', '#f2c14e', '#3d5a80']];
  const pal = palettes[Math.floor(r() * palettes.length)];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 6; k++) {
    g.fillStyle = pal[1 + Math.floor(r() * 3)]; g.globalAlpha = 0.75 + r() * 0.25;
    if (r() > 0.5) { g.beginPath(); g.arc(r() * 256, r() * 256, 20 + r() * 80, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(r() * 200, r() * 200, 30 + r() * 120, 20 + r() * 110);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  artCache.set(seedStr, m);
  return m;
}

export const WALL_DEFAULT = '#f2f0eb';
export const WALL_EXTERIOR = '#dcd6cb';
export const WALL_CUT = '#3f444a';
