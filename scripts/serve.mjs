#!/usr/bin/env node
// Local dev server for public/ that applies the same headers as vercel.json.
// Use http://localhost (a secure context), never a LAN IP: WebCrypto and the
// service worker don't run on plain-http IP addresses.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Enough of Vercel's source syntax for this project: literal paths and "(.*)".
const toRegex = (source) => new RegExp('^' + source.replace(/[.+?^${}|[\]\\]/g, '\\$&').replace(/\\?\(\\?\.\*\\?\)/g, '(.*)') + '$');
const rules = (config.headers ?? []).map((r) => ({ re: toRegex(r.source), headers: r.headers }));

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
    for (const rule of rules) if (rule.re.test(path)) for (const h of rule.headers) headers[h.key] = h.value;
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, 'localhost', () => console.log(`Linger dev server: http://localhost:${PORT}`));
