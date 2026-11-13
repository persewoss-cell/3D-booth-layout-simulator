/* =====================================================================
 * lib/db.js — MongoDB 연결 (서버리스 환경에서 연결 재사용)
 *  환경변수: MONGODB_URI (필수), MONGODB_DB (선택, 기본 booth_simulator)
 *  컬렉션:
 *    layouts : 부스 배치 문서 (이미지 제외)
 *    assets  : 업로드 이미지 (문서 1개 = 이미지 1장, dataURL 문자열)
 * ===================================================================== */
import { HttpError } from './http.js';

let injected = null;
/** 로컬 테스트용: 다른 DB 구현(메모리 DB 등)을 끼워 넣음 */
export function useDb(db) { injected = db; }

// 서버리스 함수가 다시 호출될 때 연결을 재사용하도록 전역에 보관
const g = globalThis;

export async function getDb() {
  if (injected) return injected;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new HttpError(500, '서버에 MONGODB_URI 환경변수가 설정되지 않았습니다');
  if (!g.__boothMongo) {
    g.__boothMongo = (async () => {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || 'booth_simulator');
      // 처음 연결할 때 한 번만 인덱스 확인
      await db.collection('assets').createIndex({ layoutId: 1 });
      return db;
    })().catch((err) => {
      g.__boothMongo = null; // 다음 요청에서 다시 시도
      console.error('MongoDB 연결 실패', err);
      throw new HttpError(503, '데이터베이스에 연결하지 못했습니다');
    });
  }
  return g.__boothMongo;
}
