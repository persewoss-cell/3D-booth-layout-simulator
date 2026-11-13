/* POST /api/layouts — 새 배치 저장
 *   본문: { title, password, data, assetIds }
 *   응답: 201 { id, version, updatedAt, missing: [아직 안 올린 이미지 id] }
 */
import { wrap, send, readJson } from '../../lib/http.js';
import { createLayout, LIMITS } from '../../lib/layouts.js';

export default wrap({
  async POST(req, res) {
    const body = await readJson(req, LIMITS.layoutBytes + 64 * 1024);
    send(res, 201, await createLayout(body));
  },
});
