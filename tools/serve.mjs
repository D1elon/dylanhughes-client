// A local server that behaves like GitHub Pages does for this site: real files are served, anything else gets the
// app shell (as 404.html does when published). Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.argv[2]) || 4200;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.pdf': 'application/pdf', '.stl': 'model/stl', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(root, normalize(path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let status = 200;
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    file = join(root, '404.html');
    status = 404;
  }
  try {
    const body = await readFile(file);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const head = { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    if (range && status === 200) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : body.length - 1;
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 }).end(body.subarray(start, end + 1));
    } else {
      res.writeHead(status, { ...head, 'content-length': body.length }).end(body);
    }
  } catch {
    res.writeHead(500).end('error');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
