// Export a project to draw.io (one page per floor). Lengths are written on the walls, so the file
// stays human-editable in draw.io; Murello-specific data travels in custom properties
// (murello_kind / murello_data, visible in draw.io via Edit ▸ Edit Data) for a lossless round trip.
import { derive } from '../model/derive.js';
import { add, mul } from '../core/geom.js';
import { getModel, itemDims, modelName } from '../furniture/models.js';

const PX = 100; // 1 m = 100 px (1 px = 1 cm)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const num = (v) => Math.round(v * 100) / 100;
const FP_SHAPES = { bed_double: 'bed_double', bed_single: 'bed_single', sofa3: 'sofa', sofa2: 'sofa', armchair: 'office_chair', chair: 'chair', office_chair: 'office_chair', bathtub: 'bathtub', toilet: 'toilet', shower: 'shower', fridge: 'refrigerator', cooktop_base: 'range_1', sink_base: 'sink_1', washbasin: 'sink_2', bookcase: 'bookcase', dresser: 'dresser', plant: 'plant', piano: 'piano', desk: 'workstation', tv_unit: 'flat_tv', stairs: 'stairs' };

export function exportDrawio(project, { lang = 'it' } = {}) {
  const pages = project.floors.map((f, fi) => pageXml(f, fi, project, lang));
  return `<mxfile host="Murello" agent="Murello" type="device">\n${pages.join('\n')}\n</mxfile>\n`;
}

function pageXml(floor, fi, project, lang) {
  const der = derive(floor);
  const b = der.bbox;
  const ox = -b.minX * PX + 80, oy = -b.minY * PX + 100;
  const P = (p) => ({ x: Math.round((p.x * PX + ox) * 10) / 10, y: Math.round((p.y * PX + oy) * 10) / 10 });
  const cells = [];
  let n = 2;
  const id = (k) => `p${fi}_${k}_${n++}`;
  const obj = (label, kind, data, inner) => `<object label="${esc(label)}" murello_kind="${kind}" murello_data="${esc(JSON.stringify(data))}" id="${id(kind)}">${inner}</object>`;
  // meta
  cells.push(obj(`murello: misure=asse h=${num(floor.height)}`, 'meta', { mode: 'axis', height: floor.height, elevation: floor.elevation },
    `<mxCell style="text;html=1;align=left;verticalAlign=middle;strokeColor=none;fillColor=none;fontColor=#8a9096;fontSize=10;" vertex="1" parent="1"><mxGeometry x="${ox - 60}" y="${oy - 80}" width="260" height="20" as="geometry"/></mxCell>`));
  // walls
  for (const x of der.walls) {
    const w = x.w; const A = P(x.A), B = P(x.B);
    const data = { thickness: w.thickness, height: w.height, decor: w.decor || [], colorL: w.colorL, colorR: w.colorR, mode: 'axis' };
    const sw = Math.max(2, Math.round(w.thickness * PX));
    cells.push(obj(num(x.len).toFixed(2), 'wall', data,
      `<mxCell style="endArrow=none;startArrow=none;html=1;strokeWidth=${sw};strokeColor=#2B2F33;fontColor=#1F5FBF;fontSize=11;labelBackgroundColor=#FFFFFF;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${A.x}" y="${A.y}" as="sourcePoint"/><mxPoint x="${B.x}" y="${B.y}" as="targetPoint"/></mxGeometry></mxCell>`));
    // openings
    for (const o of w.openings || []) {
      const s = o.side || 1;
      const mid = add(x.A, mul(x.dir, o.offset + o.width / 2));
      const deg = Math.atan2(x.dir.y, x.dir.x) * 180 / Math.PI;
      const data2 = { height: o.height, sill: o.sill, style: o.style, hinge: o.hinge, openSide: s, frameColor: o.frameColor };
      const wpx = o.width * PX;
      if (o.type === 'door') {
        const c = add(mid, mul(x.n, s * o.width / 2)); const C = P(c);
        const rot = s > 0 ? deg + 180 : deg;
        const shape = o.style === 'double' ? 'doorDouble' : o.style === 'sliding' ? 'doorSliding' : o.hinge === 'end' ? 'doorRight' : 'doorLeft';
        cells.push(obj(String(Math.round(o.width * 100)), 'door', data2,
          `<mxCell style="verticalLabelPosition=bottom;html=1;verticalAlign=top;align=center;shape=mxgraph.floorplan.${shape};rotation=${num(rot)};fontColor=#1F5FBF;fontSize=10;" vertex="1" parent="1"><mxGeometry x="${C.x - wpx / 2}" y="${C.y - wpx / 2}" width="${wpx}" height="${wpx}" as="geometry"/></mxCell>`));
      } else {
        const C = P(mid); const hpx = Math.max(6, x.t * PX);
        const style = o.type === 'window'
          ? `verticalLabelPosition=bottom;html=1;verticalAlign=top;align=center;shape=mxgraph.floorplan.window;rotation=${num(deg)};`
          : `rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=#FFFFFF;strokeColor=#9AA3AB;rotation=${num(deg)};`;
        cells.push(obj(o.type === 'window' ? '' : 'varco', o.type, data2,
          `<mxCell style="${style}" vertex="1" parent="1"><mxGeometry x="${C.x - wpx / 2}" y="${C.y - hpx / 2}" width="${wpx}" height="${hpx}" as="geometry"/></mxCell>`));
      }
    }
  }
  // rooms (labels)
  for (const r of der.rooms) {
    const C = P(r.labelPos);
    const label = [r.name || '', r.height ? `h=${num(r.height)}` : ''].filter(Boolean).join('\n');
    if (!label && !r.floor && !r.wallColor) continue;
    cells.push(obj(label.replace(/\n/g, '<br>'), 'label', { name: r.name, height: r.height, floor: r.floor, wallColor: r.wallColor },
      `<mxCell style="text;html=1;align=center;verticalAlign=middle;strokeColor=none;fillColor=none;fontStyle=1;fontColor=#2B2F33;" vertex="1" parent="1"><mxGeometry x="${C.x - 70}" y="${C.y - 20}" width="140" height="40" as="geometry"/></mxCell>`));
  }
  // furniture
  for (const it of floor.items) {
    const m = getModel(it.model); const dims = itemDims(it, floor.height);
    const C = P(it); const w = dims.w * PX, d = dims.d * PX;
    const fp = FP_SHAPES[it.model];
    const kind = it.model === 'column' ? 'column' : it.model === 'stairs' ? 'stairs' : 'furniture';
    const style = fp ? `html=1;shape=mxgraph.floorplan.${fp};rotation=${num(it.rot || 0)};verticalLabelPosition=bottom;verticalAlign=top;fontSize=10;` : `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=${it.color || m.color || '#E8D9C4'};strokeColor=#6B6257;rotation=${num(it.rot || 0)};fontSize=10;`;
    const data = { model: it.model, name: it.name, w: dims.w, d: dims.d, h: it.h, elevation: it.elevation || 0, color: it.color, accent: it.accent, rot: it.rot || 0, params: it.params || {} };
    cells.push(obj(it.name || modelName(m, lang), kind, data, `<mxCell style="${style}" vertex="1" parent="1"><mxGeometry x="${C.x - w / 2}" y="${C.y - d / 2}" width="${w}" height="${d}" as="geometry"/></mxCell>`));
  }
  const W = Math.round(b.w * PX + 200), Hh = Math.round(b.h * PX + 240);
  return `  <diagram id="${esc(floor.id)}" name="${esc(floor.name)}">
    <mxGraphModel dx="${W}" dy="${Hh}" grid="1" gridSize="10" guides="1" tooltips="1" connect="0" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.max(1169, W)}" pageHeight="${Math.max(827, Hh)}" math="0" shadow="0">
      <root><mxCell id="0"/><mxCell id="1" parent="0"/>
${cells.map((c) => `        ${c}`).join('\n')}
      </root>
    </mxGraphModel>
  </diagram>`;
}
