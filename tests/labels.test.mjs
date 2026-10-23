// Label parsing: how humans write lengths in draw.io.
import assert from 'node:assert/strict';
import { parseLabel, parseMeta } from '../js/io/labels.js';
import { parseLength } from '../js/core/util.js';

const cases = [
  ['3.40', 3.4], ['3,40', 3.4], ['340', 3.4], ['340 cm', 3.4], ['3m40', 3.4], ['2400mm', 2.4], ['3 m', 3], ['12', 12], ['0,9', 0.9],
];
for (const [txt, want] of cases) assert.equal(Math.round(parseLength(txt) * 1000) / 1000, want, txt);

let p = parseLabel('Cucina 4x3,5 h=2,70');
assert.equal(p.name, 'Cucina'); assert.deepEqual(p.wxd, [4, 3.5]); assert.equal(p.height, 2.7);
p = parseLabel('Bagno\n250 x 320');
assert.deepEqual(p.wxd, [2.5, 3.2]);
p = parseLabel('1.41 45°');
assert.equal(p.measure, 1.41); assert.equal(p.angle, 45);
p = parseLabel('3,40 sp=30');
assert.equal(p.measure, 3.4); assert.equal(p.thickness, 0.3);
p = parseLabel('Soggiorno');
assert.equal(p.measure, null); assert.equal(p.name, 'Soggiorno');
assert.deepEqual(parseMeta('murello: misure=asse h=2.70 est=30 int=10'), { mode: 'axis', height: 2.7, extThickness: 0.3, intThickness: 0.1 });
console.log('✓ label parsing');
