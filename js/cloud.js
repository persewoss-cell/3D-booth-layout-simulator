/* =====================================================================
 * cloud.js — 클라우드 저장 (Vercel API → MongoDB)
 * ---------------------------------------------------------------------
 *  흐름
 *   1) [새로 시작]에서 배치 이름·비밀번호를 정하면 바로 클라우드에 만들어진다.
 *   2) 이후에는 고칠 때마다 2초 뒤 자동으로 저장된다. (Ctrl+S: 바로 저장)
 *   3) [불러오기]는 저장된 배치 목록을 보여 주고, 열 때 비밀번호를 묻는다.
 *      한 번 맞게 입력한 비밀번호는 이 브라우저에 기억되어 다시 묻지 않는다.
 *   4) 다른 사람이 먼저 저장했으면(버전 불일치) 덮어쓸지 묻는다.
 *  이미지는 배치와 따로 한 장씩 올리고 받는다 (Vercel 요청 4.5MB 제한).
 *  API 주소: <meta name="booth-api" content="https://…"> (비우면 같은 주소의 /api)
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const el = U.el;
  const PW_KEY = (id) => 'boothSimulator.cloudPw.' + id;
  const AUTOSAVE_MS = 2000;

  const C = BS.cloud = {
    id: null,          // 열려 있는 클라우드 배치 id
    title: '',
    version: 0,        // 마지막으로 받은/저장한 서버 버전
    updatedAt: null,
    dirty: false,      // 아직 클라우드에 저장하지 않은 변경 있음
    password: null,
    status: 'idle',    // idle | saving | saved | error
    savedAt: null,
    busy: false,
    pendingCreate: null, // 만들기가 실패했을 때 다시 시도할 { title, password }
  };

  /** API 기본 주소 ('' = 같은 주소, null = 사용 불가) */
  C.base = (function () {
    const m = document.querySelector('meta[name="booth-api"]');
    const v = m && m.content.trim();
    if (v) return v.replace(/\/+$/, '');
    return /^https?:$/.test(location.protocol) ? '' : null;
  })();
  C.available = () => C.base !== null;

  /* ---------------------------------------------------------------
   * API 호출 (비밀번호는 헤더로 — 한글도 되도록 인코딩)
   * ------------------------------------------------------------- */
  async function api(method, path, body, password) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (password) headers['X-Booth-Password'] = encodeURIComponent(password);
    let res;
    try {
      res = await fetch(C.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw Object.assign(new Error('서버에 연결할 수 없습니다 (인터넷 연결 확인)'), { status: 0 });
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 이미지(dataURL)는 문자열 */ }
    if (!res.ok) {
      const msg = (json && json.error) || (res.status === 404 ? 'API 를 찾을 수 없습니다 (Vercel 에 배포했는지 확인)' : `서버 오류 (${res.status})`);
      throw Object.assign(new Error(msg), { status: res.status, body: json });
    }
    return json !== null ? json : text;
  }

  /* ---------------------------------------------------------------
   * 상태 · 비밀번호 기억 · 주소
   * ------------------------------------------------------------- */
  /** 브라우저 자동저장에 함께 넣는 연결 정보 */
  C.meta = () => (C.id || C.pendingCreate
    ? { id: C.id, title: C.title, version: C.version, updatedAt: C.updatedAt, dirty: C.dirty, pendingTitle: C.pendingCreate ? C.pendingCreate.title : null }
    : null);
  C.restoreMeta = function (m) {
    if (!m) return;
    if (m.id && /^[A-Za-z0-9]{10}$/.test(m.id)) {
      Object.assign(C, { id: m.id, title: m.title || '', version: m.version || 0, updatedAt: m.updatedAt || null, dirty: !!m.dirty });
    }
  };
  function storedPw(id) { try { return localStorage.getItem(PW_KEY(id)); } catch { return null; } }
  function rememberPw(id, pw) { try { localStorage.setItem(PW_KEY(id), pw); } catch { /* 무시 */ } }
  function forgetPw(id) { try { localStorage.removeItem(PW_KEY(id)); } catch { /* 무시 */ } }

  C.urlId = function () {
    const id = new URLSearchParams(location.search).get('id');
    return id && /^[A-Za-z0-9]{10}$/.test(id) ? id : null;
  };
  function setUrl(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set('id', id); else u.searchParams.delete('id');
    try { history.replaceState(null, '', u); } catch { /* file:// 등 */ }
  }
  C.link = () => {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('id', C.id);
    return u.toString();
  };
  function setConnected(r, title) {
    C.id = r.id; C.version = r.version; C.updatedAt = r.updatedAt || null;
    if (title !== undefined) C.title = title;
    setUrl(C.id);
  }

  /** 클라우드와 연결 끊기 (새로 시작·삭제 시) */
  C.disconnect = function () {
    clearTimeout(C.timer);
    Object.assign(C, { id: null, title: '', version: 0, updatedAt: null, dirty: false, password: null, status: 'idle', pendingCreate: null });
    setUrl(null);
    C.render();
  };

  function stateData() {
    const s = BS.state;
    return { title: s.title, booth: s.booth, panels: s.panels, items: s.items, settings: s.settings };
  }
  function fmtTime(t) {
    if (!t) return '';
    return new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function shortTime(t) {
    return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------------------------------------------------------
   * 시작할 때
   * ------------------------------------------------------------- */
  C.startup = async function () {
    C.render();
    if (!C.available()) {
      if (C.urlId()) BS.toast('클라우드 링크는 웹 주소(https)에서 열어야 불러올 수 있습니다', 'warn', 6000);
      return;
    }
    const urlId = C.urlId();
    if (urlId && urlId !== C.id) { await C.open(urlId); return; }
    if (!C.id) return;
    setUrl(C.id);
    if (C.dirty) C.scheduleSave(800);   // 지난번에 저장 못 한 변경 → 바로 저장
    else C.refresh();                    // 다른 사람이 고쳤을 수 있으니 최신 확인
  };

  /* ---------------------------------------------------------------
   * 열기
   * ------------------------------------------------------------- */
  /** 배치 열기 — 기억된 비밀번호가 있으면 바로, 없거나 틀리면 물어봄 */
  C.open = async function (id, title) {
    let pw = storedPw(id);
    let retry = false;
    for (;;) {
      if (!pw) {
        const r = await askPassword(title, retry);
        if (!r) return false;
        pw = r;
      }
      try {
        BS.toast('배치를 불러오는 중…', 'info', 1500);
        const doc = await api('GET', `/api/layouts/${id}`, null, pw);
        if (C.id && C.id !== id) await C.flush(); // 지금 배치의 저장 안 된 변경 먼저 저장
        await applyDoc(doc, pw);
        rememberPw(id, pw);
        BS.toast(`"${doc.title}" 을(를) 열었습니다`);
        return true;
      } catch (e) {
        if (e.status === 403) { forgetPw(id); pw = null; retry = true; continue; }
        BS.toast('불러오기 실패: ' + e.message, 'error', 6000);
        if (e.status === 404 && C.urlId() === id) setUrl(C.id);
        return false;
      }
    }
  };

  /** 서버 문서 → 화면 */
  async function applyDoc(doc, pw) {
    C.loading = true;
    try {
      const assets = {};
      const ids = (doc.assetIds || []).slice();
      let failed = 0;
      const worker = async () => {
        while (ids.length) {
          const a = ids.shift();
          try { assets[a] = await api('GET', `/api/assets?layout=${doc.id}&id=${encodeURIComponent(a)}`, null, pw); }
          catch { failed++; }
        }
      };
      await Promise.all([1, 2, 3, 4].map(worker));
      const o = Object.assign({}, doc.data, { title: doc.title, assets });
      if (!BS.storage.applyPayload(o)) throw new Error('배치 데이터가 올바르지 않습니다');
      clearTimeout(C.timer);
      setConnected(doc, doc.title);
      Object.assign(C, { dirty: false, password: pw, status: 'saved', savedAt: doc.updatedAt, pendingCreate: null });
      BS.app.select(null);
      BS.app.rebuildAll();
      BS.history.reset();
      BS.app.setDoc(true);
      BS.ui.renderAll();
      BS.scene.setView('diag');
      BS.storage.saveLocal();
      if (failed) BS.toast(`이미지 ${failed}장을 받지 못했습니다`, 'warn', 5000);
    } finally {
      C.loading = false;
      C.render();
    }
  }

  /** 조용히 최신 버전 확인 (내 변경이 없을 때만 바꿈) */
  C.refresh = async function () {
    const pw = C.password || storedPw(C.id);
    if (!C.id || !pw || C.dirty) return;
    try {
      const doc = await api('GET', `/api/layouts/${C.id}`, null, pw);
      C.password = pw;
      if (doc.version !== C.version && !C.dirty) {
        await applyDoc(doc, pw);
        BS.toast('다른 곳에서 저장된 최신 버전을 불러왔습니다');
      } else { C.status = 'saved'; C.savedAt = doc.updatedAt; C.render(); }
    } catch (e) { /* 오프라인 등 — 이 브라우저에 있는 내용으로 계속 */ }
  };

  /** 서버의 최신 버전 다시 불러오기 (내 변경 버림) */
  C.reload = async function () {
    if (!C.id) return;
    if (C.dirty && !confirm('저장하지 않은 변경이 사라집니다. 서버의 최신 버전을 불러올까요?')) return;
    const pw = C.password || storedPw(C.id);
    try { await applyDoc(await api('GET', `/api/layouts/${C.id}`, null, pw), pw); BS.toast('최신 버전을 불러왔습니다'); }
    catch (e) { BS.toast('불러오기 실패: ' + e.message, 'error', 5000); }
  };

  /* ---------------------------------------------------------------
   * 만들기 / 자동 저장
   * ------------------------------------------------------------- */
  /** 새 배치를 클라우드에 만들기 ([새로 시작], [복사본으로 저장]) */
  C.create = async function (title, password) {
    if (!C.available()) return false;
    clearTimeout(C.timer);
    C.busy = true; C.status = 'saving'; C.render();
    try {
      BS.state.title = title;
      const r = await api('POST', '/api/layouts', { title, password, data: stateData(), assetIds: Object.keys(BS.usedAssets()) });
      setConnected(r, title);
      Object.assign(C, { password, pendingCreate: null, dirty: false });
      rememberPw(r.id, password);
      const failed = await uploadAssets(r.missing, password);
      C.status = failed ? 'error' : 'saved'; C.savedAt = new Date();
      if (failed) C.dirty = true;
      BS.storage.saveLocal();
      BS.toast(`"${title}" 을(를) 만들었습니다. 이제 자동으로 저장됩니다.`, 'info', 3500);
      return true;
    } catch (e) {
      C.pendingCreate = { title, password };
      C.status = 'error';
      BS.toast('클라우드에 만들지 못했습니다: ' + e.message + ' (잠시 뒤 자동으로 다시 시도)', 'error', 6000);
      C.scheduleSave(15000);
      return false;
    } finally {
      C.busy = false; C.render();
    }
  };

  /** 편집이 일어날 때마다 (실행취소 지점 생성 시) → 잠시 뒤 자동 저장 */
  BS.on('dirty', () => {
    if (C.loading || !BS.app.hasDoc) return;
    if (!C.id && !C.pendingCreate) { C.render(); return; } // 클라우드에 없는 배치(파일로 연 경우 등)
    C.dirty = true;
    C.render();
    C.scheduleSave(AUTOSAVE_MS);
  });
  C.scheduleSave = function (ms) {
    clearTimeout(C.timer);
    C.timer = setTimeout(() => C.save(), ms);
  };
  /** 기다리지 않고 바로 저장 (Ctrl+S, 다른 배치 열기 전) */
  C.flush = async function () {
    clearTimeout(C.timer);
    if (C.dirty || C.pendingCreate) await C.save({ manual: true });
  };

  C.save = async function (opts = {}) {
    if (!C.available()) { if (opts.manual) BS.storage.exportJSON(); return; }
    if (C.busy) { C.again = true; return; }
    if (!C.id && C.pendingCreate) { await C.create(C.pendingCreate.title, C.pendingCreate.password); return; }
    if (!C.id) { if (opts.manual) BS.toast('이 배치는 아직 클라우드에 없습니다. [저장·인쇄] 탭에서 클라우드에 저장하세요.', 'warn', 4500); return; }
    if (!C.dirty && !opts.force && !opts.manual) return;
    let pw = C.password || storedPw(C.id);
    if (!pw) {
      pw = await askPassword(C.title, false);
      if (!pw) { C.status = 'error'; C.render(); return; }
    }
    C.busy = true; C.status = 'saving'; C.dirty = false; C.render();
    try {
      const r = await api('PUT', `/api/layouts/${C.id}`, {
        password: pw, title: BS.state.title, data: stateData(),
        assetIds: Object.keys(BS.usedAssets()), baseVersion: C.version, force: !!opts.force,
      });
      C.password = pw; rememberPw(C.id, pw);
      setConnected(r, BS.state.title);
      const failed = await uploadAssets(r.missing, pw);
      if (failed) { C.dirty = true; C.status = 'error'; C.scheduleSave(15000); BS.toast(`이미지 ${failed}장을 올리지 못했습니다. 잠시 뒤 다시 시도합니다.`, 'error', 5000); }
      else { C.status = 'saved'; C.savedAt = new Date(); }
      BS.storage.saveLocal();
      if (opts.manual && !failed) BS.toast('저장했습니다');
    } catch (e) {
      C.dirty = true;
      C.busy = false;
      if (e.status === 403) {
        // 누군가 비밀번호를 바꿈
        forgetPw(C.id); C.password = null;
        const again = await askPassword(C.title, true);
        if (again) { C.password = again; return C.save({ manual: true, force: opts.force }); }
        C.status = 'error';
      } else if (e.status === 409) {
        const when = e.body && e.body.updatedAt ? ` (${fmtTime(e.body.updatedAt)})` : '';
        if (confirm(`다른 사람이 이 배치를 먼저 저장했습니다${when}.\n\n[확인] 내 화면으로 덮어쓰기\n[취소] 다른 사람이 저장한 버전 불러오기 (내 최근 변경은 사라짐)`)) {
          return C.save({ manual: true, force: true });
        }
        C.dirty = false;
        try { await applyDoc(await api('GET', `/api/layouts/${C.id}`, null, pw), pw); } catch (e2) { BS.toast('불러오기 실패: ' + e2.message, 'error'); }
      } else {
        C.status = 'error';
        if (opts.manual || e.status !== 0) BS.toast('저장 실패: ' + e.message, 'error', 5000);
        C.scheduleSave(15000); // 네트워크 문제 → 잠시 뒤 다시
      }
    } finally {
      C.busy = false;
      C.render();
      if (C.again) { C.again = false; if (C.dirty) C.scheduleSave(300); }
    }
  };

  /** 서버에 없는 이미지 올리기 → 실패한 장 수 */
  async function uploadAssets(missing, pw) {
    let failed = 0;
    for (const id of missing || []) {
      let data = BS.assets[id];
      if (!data) { failed++; continue; }
      try {
        if (data.length > 3.9e6) data = await shrink(data);
        await api('POST', '/api/assets', { layoutId: C.id, password: pw, assetId: id, data });
      } catch (e) { failed++; console.warn(e); }
    }
    return failed;
  }

  /** 4MB 넘는 이미지는 JPG 로 다시 줄임 */
  function shrink(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let s = 1, out = dataURL;
        const cv = document.createElement('canvas');
        for (let k = 0; k < 6 && out.length > 3.9e6; k++) {
          s *= 0.8;
          cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          out = cv.toDataURL('image/jpeg', 0.85);
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('이미지 변환 실패'));
      img.src = dataURL;
    });
  }

  window.addEventListener('beforeunload', (e) => {
    if ((C.id || C.pendingCreate) && (C.dirty || C.busy)) { C.flush(); e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------------------------------------------------------
   * 그 밖의 동작: 복사본 · 비밀번호 변경 · 삭제 · 링크
   * ------------------------------------------------------------- */
  C.saveAsCopy = async function () {
    const r = await newDocDialog(C.id ? `${BS.state.title} 복사본` : BS.state.title, C.id ? '복사본으로 저장' : '클라우드에 저장');
    if (!r) return;
    await C.flush();
    C.disconnect();
    await C.create(r.title, r.pw);
    BS.ui.renderAll();
  };

  C.changePassword = async function () {
    if (!C.id) return;
    const cur = el('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '4자 이상' });
    const n2 = el('input', { type: 'password', autocomplete: 'new-password' });
    const known = C.password || storedPw(C.id);
    const r = await dialog('비밀번호 바꾸기', [
      known ? null : field('지금 비밀번호', cur),
      field('새 비밀번호', n1, '함께 작업하는 선생님들께 새 비밀번호를 알려 주세요.'),
      field('새 비밀번호 확인', n2),
    ], '바꾸기', () => {
      if (n1.value.length < 4) return '새 비밀번호는 4자 이상이어야 합니다';
      if (n1.value !== n2.value) return '새 비밀번호 확인이 일치하지 않습니다';
      return { cur: known || cur.value, next: n1.value };
    });
    if (!r) return;
    try {
      await C.flush();
      const res = await api('PUT', `/api/layouts/${C.id}`, {
        password: r.cur, newPassword: r.next, title: BS.state.title, data: stateData(),
        assetIds: Object.keys(BS.usedAssets()), baseVersion: C.version,
      });
      setConnected(res, BS.state.title);
      C.password = r.next; rememberPw(C.id, r.next);
      BS.storage.saveLocal();
      BS.toast('비밀번호를 바꿨습니다');
    } catch (e) { BS.toast('바꾸지 못했습니다: ' + e.message, 'error', 5000); }
    C.render();
  };

  C.forgetPassword = function () {
    if (!C.id) return;
    forgetPw(C.id); C.password = null;
    BS.toast('이 브라우저에서 비밀번호를 지웠습니다. 다음에 열 때 다시 묻습니다.');
    C.render();
  };

  C.remove = async function () {
    if (!C.id) return;
    if (!confirm(`"${C.title}" 을(를) 클라우드에서 완전히 삭제할까요?\n[불러오기] 목록과 공유 링크에서 사라지며 되돌릴 수 없습니다.`)) return;
    const pw = C.password || storedPw(C.id) || await askPassword(C.title, false);
    if (!pw) return;
    try {
      await api('DELETE', `/api/layouts/${C.id}`, { password: pw });
      forgetPw(C.id);
      C.disconnect();
      BS.app.closeDoc();
      BS.toast('클라우드에서 삭제했습니다');
    } catch (e) { BS.toast('삭제 실패: ' + e.message, 'error', 5000); }
  };

  C.copyLink = function () {
    const link = C.link();
    const done = () => BS.toast('링크를 복사했습니다. 받는 사람도 비밀번호가 있어야 열 수 있습니다.', 'info', 4000);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done, () => prompt('링크', link));
    else prompt('링크 (복사해서 사용하세요)', link);
  };

  /* ---------------------------------------------------------------
   * [불러오기] 창
   * ------------------------------------------------------------- */
  C.openDialog = async function () {
    const modal = document.getElementById('modal');
    const card = modal.querySelector('.modal-card');
    if (BS.ui._onClose) BS.ui.closeModal();
    card.innerHTML = '';
    const list = el('div', { class: 'open-list' }, el('div', { class: 'open-empty' }, '목록을 불러오는 중…'));
    const search = el('input', { type: 'text', class: 'open-search', placeholder: '배치 이름 검색' });
    const jsonBtn = el('button', { type: 'button', class: 'btn', onclick: () => { BS.ui.closeModal(); document.getElementById('file-json').click(); } }, '📄 JSON 파일에서 열기');
    const close = el('button', { type: 'button', class: 'btn', onclick: () => BS.ui.closeModal() }, '닫기');
    card.append(el('h2', { id: 'modal-title' }, '불러오기'));
    if (!C.available()) {
      card.append(el('p', { class: 'muted' }, '지금은 파일로 열어서 클라우드 목록을 볼 수 없습니다. 저장해 둔 JSON 파일을 여세요.'),
        el('div', { class: 'modal-actions' }, close, jsonBtn));
      modal.hidden = false;
      return;
    }
    card.append(el('p', { class: 'muted' }, '열 배치를 고르세요. 처음 여는 배치는 비밀번호를 물어보고, 그다음부터는 이 브라우저가 기억합니다.'),
      search, list, el('div', { class: 'modal-actions' }, jsonBtn, close));
    modal.hidden = false;
    setTimeout(() => search.focus(), 30);
    let docs = [];
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = docs.filter((d) => !q || d.title.toLowerCase().includes(q));
      list.innerHTML = '';
      if (!rows.length) { list.append(el('div', { class: 'open-empty' }, docs.length ? '검색 결과가 없습니다' : '저장된 배치가 없습니다. [새로 시작]으로 만들어 보세요.')); return; }
      for (const d of rows) {
        const s = d.summary || {};
        const shape = BS.SHAPES[s.shape] ? BS.SHAPES[s.shape].label : '';
        const info = [shape && `${shape} ${s.width}×${s.depth}`, s.items !== undefined && `물품 ${s.items}`, `수정 ${fmtTime(d.updatedAt)}`].filter(Boolean).join(' · ');
        list.append(el('button', { type: 'button', class: 'open-item', onclick: () => { BS.ui.closeModal(); C.open(d.id, d.title); } },
          el('div', { class: 'oi-main' }, el('b', null, d.title + (d.id === C.id ? '  (지금 열려 있음)' : '')), el('span', null, info)),
          el('span', { class: 'key', title: storedPw(d.id) ? '비밀번호 기억됨' : '비밀번호 필요' }, storedPw(d.id) ? '🔓' : '🔒')));
      }
    };
    search.oninput = draw;
    try { docs = await api('GET', '/api/layouts'); draw(); }
    catch (e) { list.innerHTML = ''; list.append(el('div', { class: 'open-empty' }, '목록을 불러오지 못했습니다: ' + e.message)); }
  };

  /* ---------------------------------------------------------------
   * 대화상자
   * ------------------------------------------------------------- */
  function dialog(title, nodes, okLabel, onOk) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal');
      const card = modal.querySelector('.modal-card');
      if (BS.ui._onClose) BS.ui.closeModal();
      card.innerHTML = '';
      const err = el('p', { class: 'form-error' });
      const ok = el('button', { type: 'submit', class: 'btn primary' }, okLabel);
      const cancel = el('button', { type: 'button', class: 'btn' }, '취소');
      const form = el('form', { class: 'cloud-form' }, ...nodes.filter(Boolean), err, el('div', { class: 'modal-actions' }, cancel, ok));
      card.append(el('h2', { id: 'modal-title' }, title), form);
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; BS.ui._onClose = null; modal.hidden = true; resolve(v); };
      BS.ui._onClose = () => finish(null);
      cancel.onclick = () => finish(null);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = onOk();
        if (typeof r === 'string') { err.textContent = r; return; }
        finish(r);
      });
      modal.hidden = false;
      setTimeout(() => { const i = card.querySelector('input'); if (i) i.focus(); }, 30);
    });
  }
  const field = (label, input, hint) => el('label', { class: 'mfield' }, el('span', null, label), input, hint ? el('small', null, hint) : null);

  function askPassword(title, retry) {
    const pw = el('input', { type: 'password', autocomplete: 'current-password' });
    return dialog('비밀번호', [
      el('p', { class: retry ? 'form-error' : 'muted' }, retry ? '비밀번호가 맞지 않습니다. 다시 입력하세요.' : `"${title || '배치'}" 의 비밀번호를 입력하세요.`),
      field('비밀번호', pw, '맞게 입력하면 이 브라우저가 기억해서 다음부터는 묻지 않습니다.'),
    ], '열기', () => (pw.value ? { pw: pw.value } : '비밀번호를 입력하세요')).then((r) => (r ? r.pw : null));
  }

  function newDocDialog(defTitle, heading) {
    const title = el('input', { type: 'text', maxlength: 100, value: defTitle || '' });
    const pw = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '4자 이상' });
    const pw2 = el('input', { type: 'password', autocomplete: 'new-password' });
    return dialog(heading, [
      field('배치 이름', title),
      field('비밀번호', pw, '이 배치를 열고 고칠 때 필요합니다.'),
      field('비밀번호 확인', pw2),
    ], '저장', () => {
      if (!title.value.trim()) return '배치 이름을 입력하세요';
      if (pw.value.length < 4) return '비밀번호는 4자 이상이어야 합니다';
      if (pw.value !== pw2.value) return '비밀번호 확인이 일치하지 않습니다';
      return { title: title.value.trim(), pw: pw.value };
    });
  }

  /* ---------------------------------------------------------------
   * 화면 표시: 왼쪽 위 상태 한 줄 · [저장·인쇄] 탭 클라우드 영역
   * ------------------------------------------------------------- */
  function statusText() {
    if (!BS.app.hasDoc) return '';
    if (C.id || C.pendingCreate) {
      if (C.status === 'error') return '저장 실패 · 다시 시도 중';
      if (C.busy || C.dirty) return '저장 중…';
      return C.savedAt ? `저장됨 ${shortTime(C.savedAt)}` : '저장됨';
    }
    return BS.ui.localSaved === false ? '이 브라우저에 저장 실패' : '이 브라우저에만 저장';
  }

  C.render = function () {
    const st = document.getElementById('save-state');
    if (st) {
      st.innerHTML = '';
      if (BS.app.hasDoc) {
        const cloud = !!(C.id || C.pendingCreate);
        st.append(el('span', { class: 'ss-title' }, (cloud ? '☁ ' : '') + (BS.state.title || '이름 없는 부스')));
        st.title = `${BS.state.title} — ${statusText()}`;
      }
    }
    // 저장 상태는 툴바의 💾 버튼 오른쪽에
    const ts = document.getElementById('tb-save-state');
    if (ts) {
      ts.textContent = statusText();
      ts.classList.toggle('err', C.status === 'error' && !!(C.id || C.pendingCreate));
    }
    const box = document.getElementById('cloud-box');
    if (!box) return;
    box.innerHTML = '';
    const b = (label, fn, cls = '') => el('button', { type: 'button', class: 'btn ' + cls, onclick: fn, disabled: C.busy }, label);
    if (!C.available()) {
      box.append(el('p', { class: 'hint' }, '클라우드 저장은 배포된 웹 주소(Vercel)에서 열었을 때 사용할 수 있습니다. 지금은 이 브라우저에만 자동 저장되니, 보관하려면 아래 JSON 내보내기를 쓰세요.'));
      return;
    }
    if (!C.id) {
      box.append(
        el('p', { class: 'hint' }, C.pendingCreate ? '클라우드에 만드는 중 문제가 생겨 다시 시도하고 있습니다.' : '이 배치는 아직 클라우드에 없습니다. 저장하면 다른 컴퓨터에서도 [불러오기]로 열 수 있고, 그다음부터는 자동으로 저장됩니다.'),
        el('div', { class: 'btn-col' }, b('☁ 클라우드에 저장', () => C.saveAsCopy(), 'primary')));
      return;
    }
    box.append(
      el('div', { class: 'cloud-card' + (C.status === 'error' ? ' dirty' : '') },
        el('b', null, BS.state.title),
        el('span', null, `${statusText()} · 버전 ${C.version}`),
        el('span', null, '고칠 때마다 자동으로 저장됩니다 (Ctrl+S: 바로 저장)'),
        el('input', { type: 'text', readOnly: true, value: C.link(), class: 'link', onfocus: (e) => e.target.select(), title: '받는 사람도 비밀번호가 있어야 열 수 있습니다' })),
      el('div', { class: 'btn-col' },
        b('🔗 링크 복사', () => C.copyLink()),
        b('⧉ 복사본으로 저장 (새 이름·비밀번호)', () => C.saveAsCopy()),
        b('🔑 비밀번호 바꾸기', () => C.changePassword()),
        b('⟳ 서버의 최신 버전 다시 불러오기', () => C.reload())),
      el('div', { class: 'btn-row' },
        b('이 브라우저에서 비밀번호 잊기', () => C.forgetPassword(), 'sm'),
        b('클라우드에서 삭제', () => C.remove(), 'sm danger')));
  };
})(window.BS);
