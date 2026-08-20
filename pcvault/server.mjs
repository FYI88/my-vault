// server.mjs — zero-dependency static dev server for the PC vault.
// Serves pcvault/src/ (the whole app) over http for the preview/browser harness.
// Run: npm run dev   (PORT env overrides the default 8779)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('./src/', import.meta.url)));
// PORT=0 is set in some tool environments as "pick a random port" — for a dev
// server that means "use the default", so any non-positive value falls back.
const envPort = Number.parseInt(process.env.PORT, 10);
const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 8779;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// SEC-009 — the dev page must get the same protections the Electron shell gives
// it: frame-ancestors only works as a response header, and nosniff blocks
// content-type sniffing. Keep this string in sync with CSP_HEADER in main.js.
const CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'";
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
};

createServer(async (req, res) => {
  const send = (code, headers, body) => {
    res.writeHead(code, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  };
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { // root ends with a separator — prefix collision is impossible
      send(403, { 'content-type': 'text/plain' }, 'forbidden');
      return;
    }
    const data = await readFile(file);
    send(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' }, data);
  } catch {
    send(404, { 'content-type': 'text/plain' }, 'not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`pcvault dev server: http://127.0.0.1:${port} (serving ${root})`);
});
