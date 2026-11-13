/* =====================================================================
 * lib/layouts.js — 부스 배치 저장소 로직 (API 핸들러가 공통으로 사용)
 * ---------------------------------------------------------------------
 *  layouts 문서
 *    { _id: 'aB3xK9pQ2m',          공유 링크에 쓰는 10자리 id
 *      title, data,                data = { booth, panels, items, settings, title }
 *      assetIds: ['img_...'],      이 배치가 쓰는 이미지 id 목록
 *      summary: { shape, width, depth, height, items, panels },  목록 표시용 요약
 *      pw: { salt, hash },         비밀번호 (scrypt 해시, 원문 저장 안 함)
 *      fail: { count, at },        비밀번호 연속 실패 기록 (10번 틀리면 10분 잠금)
 *      version, createdAt, updatedAt }
 *
 *  열기·저장·삭제·이미지 모두 비밀번호가 필요하다. 목록에는 이름과 요약만 보인다.
 *  assets 문서
 *    { _id: '<layoutId>:<assetId>', layoutId, assetId, data: 'data:image/...' }
 *
 *  Vercel 은 요청/응답 본문을 4.5MB 로 제한하므로 이미지는 한 장씩 따로 올리고
 *  따로 받는다. (MongoDB 문서 16MB 제한도 함께 피함)
 * ===================================================================== */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';
import { HttpError } from './http.js';

export const LIMITS = {
  layoutBytes: 2 * 1024 * 1024,   // 배치 JSON (이미지 제외)
  assetBytes: 4 * 1024 * 1024,    // 이미지 1장 (dataURL 문자열)
  maxAssets: 200,
  titleLen: 100,
};

const ID_RE = /^[A-Za-z0-9]{10}$/;
const ASSET_RE = /^[A-Za-z0-9_-]{1,64}$/;
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function newId() {
  const b = randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += B62[b[i] % 62];
  return s;
}

/* --- 비밀번호 --- */
function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 32).toString('hex');
  return { salt, hash };
}
function checkPassword(pw, stored) {
  if (typeof pw !== 'string' || !stored) return false;
  const a = scryptSync(pw, stored.salt, 32);
  const b = Buffer.from(stored.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
function requirePasswordFormat(pw) {
  if (typeof pw !== 'string' || pw.length < 4 || pw.length > 100) throw new HttpError(400, '편집 비밀번호는 4자 이상이어야 합니다');
}

/* --- 입력 검증 --- */
export function checkId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(404, '배치를 찾을 수 없습니다');
  return id;
}
function cleanTitle(t) {
  return String(t || '').trim().slice(0, LIMITS.titleLen) || '이름 없는 부스';
}
function cleanData(data) {
  if (!data || typeof data !== 'object' || !data.booth || !Array.isArray(data.panels) || !Array.isArray(data.items)) {
    throw new HttpError(400, '부스 데이터 형식이 올바르지 않습니다');
  }
  const { booth, panels, items, settings, title } = data; // 알려진 필드만 저장 (assets 등 제외)
  const clean = { booth, panels, items, settings: settings || {}, title: title || '' };
  if (JSON.stringify(clean).length > LIMITS.layoutBytes) throw new HttpError(413, '배치 데이터가 너무 큽니다 (이미지 제외 2MB)');
  return clean;
}
function cleanAssetIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [...new Set(ids.filter((x) => typeof x === 'string' && ASSET_RE.test(x)))];
  if (out.length > LIMITS.maxAssets) throw new HttpError(413, `이미지는 배치 하나에 ${LIMITS.maxAssets}장까지 저장할 수 있습니다`);
  return out;
}

/** 목록에 보여줄 요약 */
function summarize(data) {
  const b = data.booth || {};
  return {
    shape: String(b.shape || ''), width: Number(b.width) || 0, depth: Number(b.depth) || 0, height: Number(b.height) || 0,
    items: data.items.length, panels: data.panels.length,
  };
}

/** 아직 서버에 없는 이미지 id 목록 */
async function missingAssets(db, layoutId, assetIds) {
  if (!assetIds.length) return [];
  const have = await db.collection('assets')
    .find({ layoutId, assetId: { $in: assetIds } }, { projection: { assetId: 1 } })
    .toArray();
  const set = new Set(have.map((d) => d.assetId));
  return assetIds.filter((a) => !set.has(a));
}

/** 공개해도 되는 필드만 */
function publicLayout(doc) {
  return {
    id: doc._id, title: doc.title, data: doc.data, assetIds: doc.assetIds || [],
    version: doc.version, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

const LOCK = { tries: 10, ms: 10 * 60 * 1000 };

/** 비밀번호 확인 (연속 10번 틀리면 10분 동안 거부) */
async function loadWithPassword(db, id, password) {
  const col = db.collection('layouts');
  const doc = await col.findOne({ _id: checkId(id) });
  if (!doc) throw new HttpError(404, '배치를 찾을 수 없습니다');
  const fail = doc.fail || { count: 0, at: 0 };
  const recent = Date.now() - new Date(fail.at).getTime() < LOCK.ms;
  if (recent && fail.count >= LOCK.tries) throw new HttpError(429, '비밀번호를 여러 번 틀려 잠시 잠겼습니다. 10분 뒤에 다시 시도하세요');
  if (!checkPassword(password, doc.pw)) {
    await col.updateOne({ _id: doc._id }, { $set: { fail: { count: (recent ? fail.count : 0) + 1, at: new Date() } } });
    throw new HttpError(403, '비밀번호가 맞지 않습니다');
  }
  if (fail.count) await col.updateOne({ _id: doc._id }, { $set: { fail: { count: 0, at: new Date(0) } } });
  return doc;
}

/* =====================================================================
 * 공개 함수
 * ===================================================================== */

/** 새 배치 저장 → { id, version, missing } */
export async function createLayout(body) {
  requirePasswordFormat(body.password);
  const db = await getDb();
  const now = new Date();
  const assetIds = cleanAssetIds(body.assetIds);
  const doc = {
    _id: newId(),
    title: cleanTitle(body.title),
    data: cleanData(body.data),
    assetIds,
    summary: null,
    pw: hashPassword(body.password),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  doc.summary = summarize(doc.data);
  await db.collection('layouts').insertOne(doc);
  return { id: doc._id, version: 1, updatedAt: now, missing: assetIds };
}

/** 배치 목록 (이름·요약·수정 시각만, 최근 수정순) */
export async function listLayouts() {
  const db = await getDb();
  const docs = await db.collection('layouts')
    .find({}, { projection: { title: 1, summary: 1, updatedAt: 1, createdAt: 1 } })
    .toArray();
  docs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return docs.slice(0, 500).map((d) => ({ id: d._id, title: d.title, summary: d.summary || null, updatedAt: d.updatedAt, createdAt: d.createdAt }));
}

/** 배치 불러오기 (비밀번호 필요) */
export async function getLayout(id, password) {
  const db = await getDb();
  return publicLayout(await loadWithPassword(db, id, password));
}

/**
 * 배치 덮어쓰기 (비밀번호 필요)
 *  baseVersion 이 서버 버전과 다르면 409 — 다른 사람이 먼저 저장한 경우.
 *  force: true 면 무시하고 덮어씀.
 */
export async function updateLayout(id, body) {
  const db = await getDb();
  const doc = await loadWithPassword(db, id, body.password);
  if (!body.force && Number(body.baseVersion) !== doc.version) {
    throw new HttpError(409, '다른 사람이 먼저 저장했습니다', { version: doc.version, updatedAt: doc.updatedAt });
  }
  const assetIds = cleanAssetIds(body.assetIds);
  const now = new Date();
  const data = cleanData(body.data);
  const set = { title: cleanTitle(body.title), data, summary: summarize(data), assetIds, updatedAt: now };
  if (body.newPassword) { requirePasswordFormat(body.newPassword); set.pw = hashPassword(body.newPassword); }
  const r = await db.collection('layouts').updateOne(
    body.force ? { _id: doc._id } : { _id: doc._id, version: doc.version },
    { $set: set, $inc: { version: 1 } },
  );
  if (!r.matchedCount) throw new HttpError(409, '다른 사람이 먼저 저장했습니다');
  // 더 이상 쓰지 않는 이미지 정리
  await db.collection('assets').deleteMany({ layoutId: doc._id, assetId: { $nin: assetIds } });
  const version = body.force ? (await db.collection('layouts').findOne({ _id: doc._id }, { projection: { version: 1 } })).version : doc.version + 1;
  return { id: doc._id, version, updatedAt: now, missing: await missingAssets(db, doc._id, assetIds) };
}

/** 배치 삭제 (비밀번호 필요) */
export async function deleteLayout(id, body) {
  const db = await getDb();
  const doc = await loadWithPassword(db, id, body.password);
  await db.collection('assets').deleteMany({ layoutId: doc._id });
  await db.collection('layouts').deleteOne({ _id: doc._id });
  return { ok: true };
}

/** 이미지 1장 올리기 (비밀번호 필요) */
export async function putAsset(body) {
  const db = await getDb();
  const doc = await loadWithPassword(db, body.layoutId, body.password);
  const assetId = body.assetId;
  if (typeof assetId !== 'string' || !ASSET_RE.test(assetId)) throw new HttpError(400, '이미지 id 가 올바르지 않습니다');
  if (!(doc.assetIds || []).includes(assetId)) throw new HttpError(400, '배치에서 쓰지 않는 이미지입니다 (배치를 먼저 저장하세요)');
  const data = body.data;
  if (typeof data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) {
    throw new HttpError(400, '이미지 형식이 올바르지 않습니다 (PNG/JPG/WEBP)');
  }
  if (data.length > LIMITS.assetBytes) throw new HttpError(413, '이미지가 너무 큽니다 (4MB 이하)');
  await db.collection('assets').updateOne(
    { _id: `${doc._id}:${assetId}` },
    { $set: { layoutId: doc._id, assetId, data, updatedAt: new Date() } },
    { upsert: true },
  );
  return { ok: true };
}

/** 이미지 1장 받기 → dataURL 문자열 (비밀번호 필요) */
export async function getAsset(layoutId, assetId, password) {
  checkId(layoutId);
  if (typeof assetId !== 'string' || !ASSET_RE.test(assetId)) throw new HttpError(404, '이미지를 찾을 수 없습니다');
  const db = await getDb();
  await loadWithPassword(db, layoutId, password);
  const a = await db.collection('assets').findOne({ _id: `${layoutId}:${assetId}` });
  if (!a) throw new HttpError(404, '이미지를 찾을 수 없습니다');
  return a.data;
}
