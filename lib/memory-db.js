/* =====================================================================
 * lib/memory-db.js — 로컬 시험용 메모리 DB (MongoDB 없이 API 동작 확인)
 *  이 앱이 쓰는 MongoDB 드라이버 기능만 흉내 낸다:
 *  findOne / find().toArray() / insertOne / updateOne(upsert) /
 *  deleteOne / deleteMany / createIndex, 조건 $in·$nin, 갱신 $set·$inc
 *  서버를 끄면 데이터는 사라진다. (실제 배포에서는 쓰지 않음)
 * ===================================================================== */
function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('$in' in cond) return cond.$in.includes(v);
      if ('$nin' in cond) return !cond.$nin.includes(v);
      throw new Error('memory-db: 지원하지 않는 조건 ' + JSON.stringify(cond));
    }
    return v === cond;
  });
}
function project(doc, projection) {
  if (!projection) return structuredClone(doc);
  const keys = Object.keys(projection);
  if (keys.some((k) => projection[k])) {
    const out = { _id: doc._id };
    for (const k of keys) if (projection[k] && k in doc) out[k] = structuredClone(doc[k]);
    return out;
  }
  const out = structuredClone(doc);
  for (const k of keys) delete out[k];
  return out;
}
function applyUpdate(doc, update) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [k, v] of Object.entries(fields)) {
      if (op === '$set') doc[k] = structuredClone(v);
      else if (op === '$inc') doc[k] = (doc[k] || 0) + v;
      else throw new Error('memory-db: 지원하지 않는 갱신 ' + op);
    }
  }
}

export function memoryDb() {
  const cols = new Map();
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      cols.set(name, {
        async findOne(f, o = {}) { for (const d of docs.values()) if (matches(d, f)) return project(d, o.projection); return null; },
        find(f, o = {}) { return { toArray: async () => [...docs.values()].filter((d) => matches(d, f)).map((d) => project(d, o.projection)) }; },
        async insertOne(d) {
          if (docs.has(d._id)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
          docs.set(d._id, structuredClone(d)); return { insertedId: d._id };
        },
        async updateOne(f, u, o = {}) {
          for (const d of docs.values()) if (matches(d, f)) { applyUpdate(d, u); return { matchedCount: 1, modifiedCount: 1 }; }
          if (o.upsert) { const d = { ...f }; applyUpdate(d, u); docs.set(d._id, d); return { matchedCount: 0, upsertedCount: 1 }; }
          return { matchedCount: 0, modifiedCount: 0 };
        },
        async deleteOne(f) { for (const [id, d] of docs) if (matches(d, f)) { docs.delete(id); return { deletedCount: 1 }; } return { deletedCount: 0 }; },
        async deleteMany(f) { let n = 0; for (const [id, d] of [...docs]) if (matches(d, f)) { docs.delete(id); n++; } return { deletedCount: n }; },
        async createIndex() { return 'ok'; },
        _docs: docs,
      });
    }
    return cols.get(name);
  };
  return { collection };
}
