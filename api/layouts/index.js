/* /api/layouts
 *   GET  — 배치 목록 [{ id, title, summary, updatedAt }] (비밀번호 불필요, 내용은 없음)
 *   POST — 새 배치 저장 { title, password, data, assetIds }
 *          → 201 { id, version, updatedAt, missing: [아직 안 올린 이미지 id] }
 */
import { wrap, send, readJson } from '../../lib/http.js';
import { createLayout, listLayouts, LIMITS } from '../../lib/layouts.js';

export default wrap({
  async GET(req, res) {
    send(res, 200, await listLayouts(), { 'Cache-Control': 'no-store' });
  },
  async POST(req, res) {
    const body = await readJson(req, LIMITS.layoutBytes + 64 * 1024);
    send(res, 201, await createLayout(body));
  },
});
