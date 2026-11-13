/* /api/assets — 업로드 이미지 (한 장씩)
 *   GET  ?layout=<배치 id>&id=<이미지 id>  → dataURL 문자열 (오래 캐시)
 *   POST { layoutId, password, assetId, data: 'data:image/jpeg;base64,...' }
 */
import { wrap, send, readJson, query } from '../lib/http.js';
import { getAsset, putAsset, LIMITS } from '../lib/layouts.js';

export default wrap({
  async GET(req, res) {
    const q = query(req);
    const data = await getAsset(q.layout, q.id);
    // 이미지 id 는 올릴 때마다 새로 만들어지므로 내용이 바뀌지 않음 → 길게 캐시
    send(res, 200, data, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
  },
  async POST(req, res) {
    const body = await readJson(req, LIMITS.assetBytes + 64 * 1024);
    send(res, 200, await putAsset(body));
  },
});
