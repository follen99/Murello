// Build three.js meshes from parametric furniture models. Geometries are merged per material
// (one draw call per material per item) and cached by item signature.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getModel, resolveParts, itemDims } from './models.js';
import { itemMaterial } from '../view3d/materials.js';

const unitCyl = new Map();
function cylGeo(tp, segments) {
  const k = `${tp.toFixed(3)}|${segments}`;
  if (!unitCyl.has(k)) unitCyl.set(k, new THREE.CylinderGeometry(0.5 * tp, 0.5, 1, segments, 1));
  return unitCyl.get(k);
}
const unitSph = new THREE.SphereGeometry(0.5, 18, 12);

function partGeometry(p, quality) {
  let g;
  if (p.s === 'cyl') {
    g = cylGeo(p.tp ?? 1, quality === 'low' ? 14 : 24).clone();
    if (p.ax === 'z') { g.scale(p.w, p.h, p.d); g.rotateX(Math.PI / 2); g.translate(p.x, p.y + p.d / 2, p.z + p.h / 2); }
    else { g.scale(p.w, p.h, p.d); g.translate(p.x, p.y + p.h / 2, p.z); }
  } else if (p.s === 'sph') {
    g = unitSph.clone(); g.scale(p.w, p.h, p.d); g.translate(p.x, p.y + p.h / 2, p.z);
  } else {
    const r = Math.min(p.r || 0, p.w / 2 - 1e-4, p.h / 2 - 1e-4, p.d / 2 - 1e-4);
    g = r > 0.002 ? new RoundedBoxGeometry(p.w, p.h, p.d, quality === 'low' ? 1 : 2, r) : new THREE.BoxGeometry(p.w, p.h, p.d);
    if (p.rot) g.rotateY(-p.rot * Math.PI / 180);
    g.translate(p.x, p.y + p.h / 2, p.z);
  }
  return g.index ? g.toNonIndexed() : g;
}

/** Build a THREE.Group for an item (origin at footprint centre, floor level). */
export function buildItemMesh(item, H, quality = 'high') {
  const model = getModel(item.model);
  const dims = itemDims(item, H);
  const parts = resolveParts(model, dims, H);
  const bySlot = new Map();
  for (const p of parts) {
    const g = partGeometry(p, quality);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!bySlot.has(p.m)) bySlot.set(p.m, []);
    bySlot.get(p.m).push(g);
  }
  const group = new THREE.Group();
  for (const [slot, geos] of bySlot) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    geos.forEach((g) => { if (g !== merged) g.dispose(); });
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, itemMaterial(slot, item, model));
    mesh.castShadow = slot !== 'glass';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.dims = dims;
  return group;
}

export function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}
