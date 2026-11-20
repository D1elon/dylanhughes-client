// Getting a file ready to upload: what it is, how big, a small picture of it for its card, and, for photos, a copy
// with the camera's notes taken out.
import { extOf, kindOf } from './util.js';

const THUMB = 880; // the longest side of a card picture

// --- Photos: remove where and with what they were taken ----------------------------------------------------------
// A JPEG is a run of labelled segments before its picture data. This copies the file without the segments that
// carry Exif and XMP (camera, time, GPS), IPTC and comments, and without anything stored after the picture's end
// (phones put a short video there). The picture data is untouched, so nothing is re-compressed. The one Exif fact
// a picture needs, which way up it is, is written back in a segment holding nothing else.
export function stripJpeg(buffer) {
  const d = new DataView(buffer), size = d.byteLength;
  if (size < 4 || d.getUint16(0) !== 0xffd8) return null;
  const keep = [];
  let o = 2, orientation = 1, removed = 0;
  while (o + 4 <= size) {
    if (d.getUint8(o) !== 0xff) return null; // not laid out as expected: leave the file alone
    const marker = d.getUint8(o + 1);
    if (marker === 0xda) {
      // Picture data runs to the end marker; nothing after that is kept.
      const bytes = new Uint8Array(buffer);
      let end = size;
      for (let i = o + 2; i + 1 < size; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { end = i + 2; break; }
      removed += size - end;
      keep.push([o, end]);
      o = size;
      break;
    }
    const len = d.getUint16(o + 2), end = o + 2 + len;
    if (len < 2 || end > size) return null;
    const exif = marker === 0xe1 && len >= 14 && d.getUint32(o + 4) === 0x45786966; // "Exif"
    if (exif) {
      try {
        const tiff = o + 10, little = d.getUint16(tiff) === 0x4949;
        const ifd = tiff + d.getUint32(tiff + 4, little), count = d.getUint16(ifd, little);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (entry + 12 <= end && d.getUint16(entry, little) === 0x0112) orientation = d.getUint16(entry + 8, little);
        }
      } catch { /* unreadable: treated as upright */ }
    }
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) removed += end - o; else keep.push([o, end]);
    o = end;
  }
  if (!keep.length) return null;
  const parts = [new Uint8Array([0xff, 0xd8])];
  const turn = orientation >= 2 && orientation <= 8
    ? new Uint8Array([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    : null;
  keep.forEach(([a, b], i) => {
    // The orientation goes after the JFIF header if there is one, which must come first.
    const jfif = i === 0 && d.getUint8(a + 1) === 0xe0;
    if (turn && i === 0 && !jfif) parts.push(turn);
    parts.push(new Uint8Array(buffer, a, b - a));
    if (turn && jfif) parts.push(turn);
  });
  return { blob: new Blob(parts, { type: 'image/jpeg' }), removed };
}

// --- Card pictures ---------------------------------------------------------------------------------------------
function shrink(source, w, h) {
  const k = Math.min(1, THUMB / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/webp', 0.82));
}
async function imageInfo(blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const info = { w: bitmap.width, h: bitmap.height };
    // Small pictures are their own card picture.
    info.thumb = Math.max(info.w, info.h) > THUMB * 1.4 || blob.size > 350000 ? await shrink(bitmap, info.w, info.h) : null;
    return info;
  } finally { bitmap.close?.(); }
}
function videoInfo(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = info => { clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(info); };
    const timer = setTimeout(() => done({}), 9000); // a format this browser can't play still uploads, without a picture
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = async () => {
      try { done({ w: v.videoWidth, h: v.videoHeight, duration: Math.round(v.duration * 10) / 10, thumb: await shrink(v, v.videoWidth, v.videoHeight) }); } catch { done({}); }
    };
    v.onerror = () => done({});
    v.src = url;
  });
}

// What to upload for a chosen file: { kind, blob, meta, thumb, removed }.
export async function prepare(file, { strip = true } = {}) {
  const kind = kindOf(file.name), ext = extOf(file.name);
  let blob = file, removed = 0, info = {};
  if (kind === 'image') {
    if (strip && (ext === 'jpg' || ext === 'jpeg')) {
      const out = stripJpeg(await file.arrayBuffer());
      if (out) { blob = out.blob; removed = out.removed; }
    }
    if (ext !== 'svg') { try { info = await imageInfo(blob); } catch { info = {}; } }
  } else if (kind === 'video') {
    info = await videoInfo(file);
  } else if (kind === 'model') {
    try {
      const { modelThumb } = await import('../viewers/model3d.js');
      info = { thumb: await modelThumb(file, ext) };
    } catch { info = {}; }
  }
  const { thumb = null, ...dims } = info;
  const type = file.type || { glb: 'model/gltf-binary', gltf: 'model/gltf+json', stl: 'model/stl', obj: 'model/obj', '3mf': 'model/3mf', ply: 'application/octet-stream' }[ext] || 'application/octet-stream';
  return { kind, blob, thumb, removed, type, meta: { name: file.name, size: blob.size, type, ...dims } };
}
