// Planar face extraction: given nodes and undirected edges, find the enclosed faces (rooms).
import { polyArea } from '../core/geom.js';

/**
 * @param {{x:number,y:number}[]} pts node positions (index = node index)
 * @param {[number,number][]} edges
 * @returns {{faces: {nodes:number[], area:number, outer:boolean, edges:number[]}[]}}
 */
export function planarFaces(pts, edges) {
  const n = pts.length;
  const adj = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], ei) => {
    if (a === b) return;
    adj[a].push({ to: b, ei, ang: Math.atan2(pts[b].y - pts[a].y, pts[b].x - pts[a].x) });
    adj[b].push({ to: a, ei, ang: Math.atan2(pts[a].y - pts[b].y, pts[a].x - pts[b].x) });
  });
  for (const l of adj) l.sort((p, q) => p.ang - q.ang);
  const visited = new Set();
  const faces = [];
  const key = (a, b, ei) => `${a}>${b}#${ei}`;
  for (let a = 0; a < n; a++) {
    for (const h of adj[a]) {
      if (visited.has(key(a, h.to, h.ei))) continue;
      const face = []; const fEdges = [];
      let u = a, cur = h, guard = 0;
      while (guard++ < 100000) {
        const k = key(u, cur.to, cur.ei);
        if (visited.has(k)) break;
        visited.add(k);
        face.push(u); fEdges.push(cur.ei);
        const vtx = cur.to;
        const list = adj[vtx];
        // incoming direction reversed: find index of edge back to u, take the previous one (turn to the "right" in y-down)
        const back = list.findIndex((e) => e.to === u && e.ei === cur.ei);
        const nxt = list[(back - 1 + list.length) % list.length];
        u = vtx; cur = nxt;
      }
      if (face.length >= 3) faces.push({ nodes: face, edges: fEdges, area: polyArea(face.map((i) => pts[i])) });
    }
  }
  // Mark the outer face of every connected component: the one with the largest |area|; it has the opposite sign of inner faces.
  const comp = new Int32Array(n).fill(-1); let c = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || !adj[i].length) continue;
    const st = [i]; comp[i] = c;
    while (st.length) { const u = st.pop(); for (const e of adj[u]) if (comp[e.to] < 0) { comp[e.to] = c; st.push(e.to); } }
    c++;
  }
  const byComp = new Map();
  for (const f of faces) {
    const k = comp[f.nodes[0]];
    if (!byComp.has(k)) byComp.set(k, []);
    byComp.get(k).push(f);
  }
  for (const list of byComp.values()) {
    let best = null;
    for (const f of list) if (!best || Math.abs(f.area) > Math.abs(best.area)) best = f;
    const sign = Math.sign(best.area);
    // inner faces have the opposite sign of the outer one; same-sign loops are outer boundaries too
    for (const f of list) f.outer = f === best || Math.sign(f.area) === sign || Math.abs(f.area) < 1e-9;
  }
  return { faces, components: c };
}

/** Remove "spikes" (u→v→u) caused by dangling walls from a face node loop. */
export function cleanFaceLoop(nodes) {
  const out = nodes.slice();
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], c = out[(i + 1) % out.length];
      if (a === c) { // spike at i
        const j = (i + 1) % out.length;
        if (j > i) { out.splice(j, 1); out.splice(i, 1); } else { out.splice(i, 1); out.splice(j, 1); }
        changed = true; break;
      }
    }
    for (let i = 0; i < out.length && !changed; i++) {
      if (out[i] === out[(i + 1) % out.length]) { out.splice(i, 1); changed = true; }
    }
  }
  return out;
}
