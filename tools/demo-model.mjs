// Draws the demo space's sample part (a mounting plate with a spring boss) and writes it as a binary STL, in
// millimetres, Z up, as a slicer would expect. Run once: node tools/demo-model.mjs
import { writeFile } from 'node:fs/promises';
import { Shape, Path, ExtrudeGeometry, Mesh, MeshBasicMaterial, Group } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const rounded = (w, h, r) => {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
  s.lineTo(w / 2, h / 2 - r); s.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
  s.lineTo(-w / 2 + r, h / 2); s.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-w / 2, -h / 2 + r); s.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
  return s;
};
const hole = (x, y, r) => new Path().absarc(x, y, r, 0, Math.PI * 2, true);
const ring = (ro, ri) => { const s = new Shape().absarc(0, 0, ro, 0, Math.PI * 2); s.holes.push(hole(0, 0, ri)); return s; };
const solid = (shape, depth, z = 0, bevel = 0.5) => {
  const g = new ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 28 });
  g.translate(0, 0, z + bevel);
  return new Mesh(g, new MeshBasicMaterial());
};

// The plate: 64 by 38, 4 thick, with two screw holes, a slot, and a hole through the middle for the spring.
const plate = rounded(64, 38, 7);
plate.holes.push(hole(-24, 0, 2.2), hole(24, 0, 2.2), hole(0, 0, 5));
const slot = new Path();
slot.moveTo(-9, 11); slot.absarc(-9, 12.5, 1.5, -Math.PI / 2, Math.PI / 2, true); slot.lineTo(9, 14); slot.absarc(9, 12.5, 1.5, Math.PI / 2, -Math.PI / 2, true); slot.lineTo(-9, 11);
plate.holes.push(slot);

const part = new Group();
part.add(solid(plate, 4));
part.add(solid(ring(9.5, 5), 9, 3.2, 0.6));        // the boss the spring sits on
part.add(solid(ring(6.6, 5), 5, 11.4, 0.4));       // its neck
for (const x of [-24, 24]) { const pad = solid(ring(5, 2.2), 1.6, 3.4, 0.3); pad.position.x = x; part.add(pad); }
part.updateMatrixWorld(true);

const stl = new STLExporter().parse(part, { binary: true });
await writeFile('assets/demo/mounting-plate.stl', Buffer.from(stl.buffer));
console.log('assets/demo/mounting-plate.stl', stl.byteLength, 'bytes');
