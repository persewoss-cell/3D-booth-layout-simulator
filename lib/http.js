/* =====================================================================
 * lib/http.js — API 공용 HTTP 헬퍼
 *  Vercel 전용 헬퍼(res.json 등)에 기대지 않고 Node 기본 API만 사용해서
 *  로컬 개발 서버(dev-server.js)에서도 같은 핸들러가 그대로 동작한다.
 * ===================================================================== */

/** 상태 코드를 담은 오류 — 핸들러에서 throw 하면 wrap() 이 응답으로 바꿔 줌 */
export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** JSON 응답 */
export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined) return res.end();
  if (typeof body === 'string') {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(body);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * 요청 본문(JSON) 읽기. Vercel 은 req.body 를 미리 파싱해 주고,
 * 로컬 서버에서는 스트림을 직접 읽는다.
 */
export async function readJson(req, limitBytes) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
  if (raw === null) {
    raw = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limitBytes) { reject(new HttpError(413, '요청 크기가 너무 큽니다')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (raw.length > limitBytes) throw new HttpError(413, '요청 크기가 너무 큽니다');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'JSON 형식이 올바르지 않습니다'); }
}

/** 쿼리 파라미터 (Vercel: req.query, 로컬: URL 파싱) */
export function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

/**
 * 핸들러 감싸기: CORS(다른 주소에 올린 앱에서도 호출 가능), 허용 메서드,
 * 오류 → JSON 응답 변환.  methods = { GET: async (req,res)=>{}, ... }
 */
export function wrap(methods) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', [...Object.keys(methods), 'OPTIONS'].join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return send(res, 204);
    const m = methods[req.method];
    if (!m) return send(res, 405, { error: '허용되지 않은 요청 방식입니다' }, { Allow: Object.keys(methods).join(', ') });
    try {
      await m(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.extra || {}) });
      console.error(err);
      send(res, 500, { error: '서버 오류가 발생했습니다' });
    }
  };
}
