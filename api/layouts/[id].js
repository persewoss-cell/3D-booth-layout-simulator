/* /api/layouts/:id
 *   GET    — 배치 불러오기 (링크만 있으면 누구나)
 *   PUT    — 덮어쓰기 { password, title, data, assetIds, baseVersion, force?, newPassword? }
 *            → { version, updatedAt, missing } | 403 비밀번호 틀림 | 409 다른 사람이 먼저 저장
 *   DELETE — 삭제 { password }
 */
import { wrap, send, readJson, query } from '../../lib/http.js';
import { getLayout, updateLayout, deleteLayout, LIMITS } from '../../lib/layouts.js';

const idOf = (req) => query(req).id;

export default wrap({
  async GET(req, res) {
    send(res, 200, await getLayout(idOf(req)), { 'Cache-Control': 'no-store' });
  },
  async PUT(req, res) {
    const body = await readJson(req, LIMITS.layoutBytes + 64 * 1024);
    send(res, 200, await updateLayout(idOf(req), body));
  },
  async DELETE(req, res) {
    const body = await readJson(req, 16 * 1024);
    send(res, 200, await deleteLayout(idOf(req), body));
  },
});
