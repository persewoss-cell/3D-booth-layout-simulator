/* =====================================================================
 * dev-server.js — 로컬 개발 서버 (Vercel 없이 앱 + API 실행)
 *   npm run dev          → .env 의 MONGODB_URI 로 실제 MongoDB 에 연결
 *   npm run dev:memory   → MongoDB 없이 메모리 DB 로 시험 (껐다 켜면 초기화)
 *   주소: http://localhost:3000   (PORT 환경변수로 변경)
 * 배포(Vercel)에서는 이 파일을 쓰지 않습니다. api/ 폴더가 그대로 서버리스 함수가 됩니다.
 * ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// .env 읽기 (간단한 KEY=VALUE 형식)
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (process.argv.includes('--memory')) {
  const { useDb } = await import('./lib/db.js');
  const { memoryDb } = await import('./lib/memory-db.js');
  useDb(memoryDb());
  console.log('메모리 DB 모드 (MongoDB 연결 없음, 서버를 끄면 데이터 삭제)');
} else if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI 가 없습니다. .env 파일을 만들거나 npm run dev:memory 로 실행하세요.');
}

const routes = [
  [/^\/api\/layouts\/?$/, 'api/layouts/index.js', []],
  [/^\/api\/layouts\/([^/]+)\/?$/, 'api/layouts/[id].js', ['id']],
  [/^\/api\/assets\/?$/, 'api/assets.js', []],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  for (const [re, file, names] of routes) {
    const m = url.pathname.match(re);
    if (!m) continue;
    const mod = await import(path.join(ROOT, file));
    req.query = Object.fromEntries(url.searchParams);
    names.forEach((n, i) => { req.query[n] = decodeURIComponent(m[i + 1]); });
    return mod.default(req, res);
  }
  // 정적 파일 (숨김 파일·node_modules 는 제공하지 않음)
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])(\.|node_modules)/.test(path.relative(ROOT, file))) {
    res.statusCode = 403; return res.end('forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(PORT, () => console.log(`부스 시뮬레이터: http://localhost:${PORT}`));
