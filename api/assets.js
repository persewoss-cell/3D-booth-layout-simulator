/* /api/assets — 업로드 이미지 (한 장씩)
 *   GET  ?layout=<배치 id>&id=<이미지 id>  (헤더 X-Booth-Password) → dataURL 문자열
 *   POST { layoutId, password, assetId, data: 'data:image/jpeg;base64,...' }
 */
import { wrap, send, readJson, query, passwordHeader } from '../lib/http.js';
import { getAsset, putAsset, LIMITS } from '../lib/layouts.js';

export default wrap({
  async GET(req, res) {
    const q = query(req);
    const data = await getAsset(q.layout, q.id, passwordHeader(req));
    send(res, 200, data, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' });
  },
  async POST(req, res) {
    const body = await readJson(req, LIMITS.assetBytes + 64 * 1024);
    send(res, 200, await putAsset(body));
  },
});
