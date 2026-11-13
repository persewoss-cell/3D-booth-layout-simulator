/* =====================================================================
 * cloud.js — 클라우드 저장 (Vercel API → MongoDB)
 * ---------------------------------------------------------------------
 *  - 저장하면 공유 링크(?id=xxxxxxxxxx)가 생긴다.
 *    링크가 있으면 누구나 볼 수 있고, 편집 비밀번호를 아는 사람만 덮어쓸 수 있다.
 *  - 이미지는 배치와 따로 한 장씩 올리고 받는다 (Vercel 요청 4.5MB 제한).
 *  - 다른 사람이 먼저 저장했으면(버전 불일치) 덮어쓸지 묻는다.
 *  - API 주소: <meta name="booth-api" content="https://…"> (비우면 같은 주소의 /api)
 *    file:// 로 열었을 때는 meta 에 주소를 넣어야 사용할 수 있다.
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const el = U.el;
  const PW_KEY = (id) => 'boothSimulator.cloudPw.' + id;

  const C = BS.cloud = {
    id: null,          // 연결된 배치 id
    title: '',
    version: 0,        // 마지막으로 받은/저장한 서버 버전
    updatedAt: null,
    dirty: false,      // 저장하지 않은 변경 있음
    password: null,    // 이번 세션에서 쓴 비밀번호
    busy: false,
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
   * API 호출
   * ------------------------------------------------------------- */
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(C.base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
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
   * 상태 / 로컬 기억
   * ------------------------------------------------------------- */
  /** 브라우저 자동저장에 함께 넣는 연결 정보 */
  C.meta = () => (C.id ? { id: C.id, title: C.title, version: C.version, updatedAt: C.updatedAt, dirty: C.dirty } : null);
  C.restoreMeta = function (m) {
    if (!m || !/^[A-Za-z0-9]{10}$/.test(m.id || '')) return;
    Object.assign(C, { id: m.id, title: m.title || '', version: m.version || 0, updatedAt: m.updatedAt || null, dirty: !!m.dirty });
  };
  function storedPw(id) { try { return localStorage.getItem(PW_KEY(id)); } catch { return null; } }
  function rememberPw(id, pw, yes) {
    try { if (yes) localStorage.setItem(PW_KEY(id), pw); else localStorage.removeItem(PW_KEY(id)); } catch { /* 무시 */ }
  }

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

  /** 클라우드 연결 해제 (새 부스 시작 등) */
  C.disconnect = function () {
    Object.assign(C, { id: null, title: '', version: 0, updatedAt: null, dirty: false, password: null });
    setUrl(null);
    C.render();
  };

  /** 편집이 일어날 때마다 (실행취소 지점 생성 시) */
  BS.on('dirty', () => { if (C.id && !C.loading) { C.dirty = true; C.render(); } });

  window.addEventListener('beforeunload', (e) => {
    if (C.id && C.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function stateData() {
    const s = BS.state;
    return { title: s.title, booth: s.booth, panels: s.panels, items: s.items, settings: s.settings };
  }

  /* ---------------------------------------------------------------
   * 불러오기
   * ------------------------------------------------------------- */
  /** 페이지를 ?id= 로 열었을 때 (또는 자동저장에 연결 정보가 있을 때) */
  C.startup = async function () {
    const urlId = C.urlId();
    if (!C.available()) { if (urlId) BS.toast('클라우드 링크는 웹 주소(https)에서 열어야 불러올 수 있습니다', 'warn', 6000); C.render(); return; }
    if (!urlId) {
      if (C.id) setUrl(C.id); // 자동저장된 클라우드 배치를 이어서 편집 중
      C.render();
      return;
    }
    const localSame = C.id === urlId;
    try {
      BS.toast('저장된 배치를 불러오는 중…');
      const doc = await api('GET', `/api/layouts/${urlId}`);
      if (localSame && C.dirty) {
        if (doc.version === C.version) {
          BS.toast('이 브라우저에 저장하지 않은 변경이 있어 이어서 편집합니다', 'info', 4500);
          C.render();
          return;
        }
        const ok = confirm(`이 배치는 다른 곳에서 더 새로 저장되었습니다 (${fmtTime(doc.updatedAt)}).\n\n[확인] 서버의 최신 버전 불러오기 (이 브라우저의 저장 안 된 변경은 사라짐)\n[취소] 이 브라우저의 변경을 유지`);
        if (!ok) { C.render(); return; }
      } else if (!localSame && C.id && C.dirty) {
        // 다른 클라우드 배치를 저장하지 않고 편집 중이었음
        if (!confirm(`"${C.title}" 배치에 저장하지 않은 변경이 있습니다.\n그래도 링크의 배치를 불러올까요?`)) { setUrl(C.id); C.render(); return; }
      }
      await applyDoc(doc);
      BS.toast(`"${doc.title}" 을(를) 불러왔습니다`);
    } catch (e) {
      BS.toast('불러오기 실패: ' + e.message, 'error', 6000);
      if (e.status === 404) { if (localSame) C.disconnect(); else setUrl(C.id); }
      C.render();
    }
  };

  /** 서버 문서 → 화면 */
  async function applyDoc(doc) {
    C.loading = true;
    try {
      const assets = {};
      const ids = doc.assetIds || [];
      let done = 0, failed = 0;
      // 이미지는 4장씩 병렬로 받기
      const queue = ids.slice();
      const worker = async () => {
        while (queue.length) {
          const a = queue.shift();
          try { assets[a] = await api('GET', `/api/assets?layout=${doc.id}&id=${encodeURIComponent(a)}`); }
          catch { failed++; }
          done++;
          if (ids.length > 2 && done % 3 === 0) BS.toast(`이미지 받는 중 ${done}/${ids.length}`, 'info', 1200);
        }
      };
      await Promise.all([1, 2, 3, 4].map(worker));
      const o = Object.assign({}, doc.data, { title: doc.title, assets });
      if (!BS.storage.applyPayload(o)) throw new Error('배치 데이터가 올바르지 않습니다');
      setConnected(doc, doc.title);
      C.dirty = false;
      BS.app.select(null);
      BS.app.rebuildAll();
      BS.history.reset();
      BS.ui.renderAll();
      BS.scene.setView('diag');
      BS.storage.saveLocal();
      if (failed) BS.toast(`이미지 ${failed}장을 받지 못했습니다`, 'warn', 5000);
    } finally {
      C.loading = false;
      C.render();
    }
  }

  /** 서버에서 다시 불러오기 (내 변경 버림) */
  C.reload = async function () {
    if (!C.id) return;
    if (C.dirty && !confirm('저장하지 않은 변경이 사라집니다. 서버의 최신 버전을 불러올까요?')) return;
    try { await applyDoc(await api('GET', `/api/layouts/${C.id}`)); BS.toast('최신 버전을 불러왔습니다'); }
    catch (e) { BS.toast('불러오기 실패: ' + e.message, 'error', 5000); }
  };

  /* ---------------------------------------------------------------
   * 저장
   * ------------------------------------------------------------- */
  C.save = async function (opts = {}) {
    if (!C.available()) {
      BS.toast('클라우드 저장은 배포된 웹 주소(Vercel)에서 열었을 때 사용할 수 있습니다. 지금은 JSON 내보내기를 이용하세요.', 'warn', 6000);
      return;
    }
    if (C.busy) return;
    BS.history.commit(); // 입력 중이던 값 반영
    if (!C.id || opts.asCopy) return openCreateDialog(opts.asCopy);
    let pw = C.password || storedPw(C.id);
    let remember = !!storedPw(C.id);
    if (!pw) {
      const r = await askPassword();
      if (!r) return;
      pw = r.pw; remember = r.remember;
    }
    await doUpdate(pw, remember, false);
  };

  async function doUpdate(pw, remember, force) {
    C.busy = true; C.render();
    try {
      const r = await api('PUT', `/api/layouts/${C.id}`, {
        password: pw, title: BS.state.title, data: stateData(),
        assetIds: Object.keys(BS.usedAssets()), baseVersion: C.version, force,
      });
      C.password = pw;
      rememberPw(C.id, pw, remember);
      setConnected(r, BS.state.title);
      await uploadAssets(r.missing, pw);
    } catch (e) {
      C.busy = false;
      if (e.status === 403) {
        C.password = null; rememberPw(C.id, '', false);
        BS.toast(e.message, 'error');
        const again = await askPassword(true);
        if (again) return doUpdate(again.pw, again.remember, force);
      } else if (e.status === 409) {
        const when = e.body && e.body.updatedAt ? ` (${fmtTime(e.body.updatedAt)})` : '';
        if (confirm(`다른 사람이 이 배치를 먼저 저장했습니다${when}.\n\n[확인] 내 화면으로 덮어쓰기\n[취소] 저장하지 않음 ([파일] 탭에서 '복사본으로 저장'도 가능)`)) {
          return doUpdate(pw, remember, true);
        }
      } else BS.toast('저장 실패: ' + e.message, 'error', 6000);
    } finally {
      C.busy = false; C.render();
    }
  }

  async function doCreate(title, pw, remember) {
    C.busy = true; C.render();
    try {
      BS.state.title = title;
      const r = await api('POST', '/api/layouts', {
        title, password: pw, data: stateData(), assetIds: Object.keys(BS.usedAssets()),
      });
      setConnected(r, title);
      C.password = pw;
      rememberPw(r.id, pw, remember);
      await uploadAssets(r.missing, pw, true);
      BS.ui.renderAll();
      if (!C.dirty) copyLink(true);
    } catch (e) {
      BS.toast('저장 실패: ' + e.message, 'error', 6000);
    } finally {
      C.busy = false; C.render();
    }
  }

  /** 서버에 없는 이미지 올리기 — 실패하면 '저장 안 됨' 상태로 남겨 다시 저장하게 함 */
  async function uploadAssets(missing, pw, quiet) {
    let failed = 0;
    for (let i = 0; i < missing.length; i++) {
      const id = missing[i];
      let data = BS.assets[id];
      if (!data) { failed++; continue; }
      if (missing.length > 1) BS.toast(`이미지 올리는 중 ${i + 1}/${missing.length}`, 'info', 1500);
      try {
        if (data.length > 3.9e6) data = await shrink(data);
        await api('POST', '/api/assets', { layoutId: C.id, password: pw, assetId: id, data });
      } catch (e) {
        failed++;
        console.warn(e);
      }
    }
    C.dirty = failed > 0;
    BS.storage.saveLocal();
    if (failed) BS.toast(`이미지 ${failed}장을 올리지 못했습니다. 다시 저장해 주세요.`, 'error', 6000);
    else if (!quiet) BS.toast(`클라우드에 저장했습니다 (버전 ${C.version})`);
  }

  /** 4MB 넘는 이미지는 JPG 로 다시 줄임 */
  function shrink(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let s = 1, q = 0.85, out = dataURL;
        const cv = document.createElement('canvas');
        for (let k = 0; k < 6 && out.length > 3.9e6; k++) {
          s *= 0.8;
          cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          out = cv.toDataURL('image/jpeg', q);
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('이미지 변환 실패'));
      img.src = dataURL;
    });
  }

  /** 클라우드에서 삭제 */
  C.remove = async function () {
    if (!C.id) return;
    if (!confirm(`"${C.title}" 을(를) 클라우드에서 삭제할까요?\n공유 링크가 더 이상 열리지 않습니다. (지금 화면은 이 브라우저에 남습니다)`)) return;
    let pw = C.password || storedPw(C.id);
    if (!pw) { const r = await askPassword(); if (!r) return; pw = r.pw; }
    try {
      await api('DELETE', `/api/layouts/${C.id}`, { password: pw });
      rememberPw(C.id, '', false);
      BS.toast('클라우드에서 삭제했습니다');
      C.disconnect();
      BS.storage.saveLocal();
    } catch (e) {
      if (e.status === 403) { C.password = null; rememberPw(C.id, '', false); }
      BS.toast('삭제 실패: ' + e.message, 'error', 5000);
    }
  };

  function copyLink(afterCreate) {
    const link = C.link();
    const done = () => BS.toast(afterCreate ? '저장했습니다! 공유 링크를 복사했습니다' : '공유 링크를 복사했습니다', 'info', 3500);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done, () => prompt('공유 링크', link));
    else prompt('공유 링크 (복사해서 사용하세요)', link);
  }
  C.copyLink = () => copyLink(false);

  /* ---------------------------------------------------------------
   * 대화상자
   * ------------------------------------------------------------- */
  function dialog(title, nodes, okLabel, onOk) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal');
      const card = modal.querySelector('.modal-card');
      card.innerHTML = '';
      const err = el('p', { class: 'form-error' });
      const ok = el('button', { type: 'button', class: 'btn primary' }, okLabel);
      const cancel = el('button', { type: 'button', class: 'btn' }, '취소');
      const form = el('form', { class: 'cloud-form' }, ...nodes, err,
        el('div', { class: 'modal-actions' }, cancel, ok));
      card.append(el('h2', { id: 'modal-title' }, title), form);
      let settled = false;
      const finish = (v) => { if (settled) return; settled = true; BS.ui._onClose = null; modal.hidden = true; resolve(v); };
      BS.ui._onClose = () => finish(null);
      cancel.onclick = () => finish(null);
      const submit = (e) => {
        if (e) e.preventDefault();
        const r = onOk();
        if (typeof r === 'string') { err.textContent = r; return; }
        finish(r);
      };
      form.addEventListener('submit', submit);
      ok.onclick = submit;
      modal.hidden = false;
      setTimeout(() => { const i = card.querySelector('input'); if (i) i.focus(); }, 30);
    });
  }
  const field = (label, input, hint) => el('label', { class: 'mfield' }, el('span', null, label), input, hint ? el('small', null, hint) : null);

  async function openCreateDialog(asCopy) {
    const title = el('input', { type: 'text', maxlength: 100, value: asCopy ? `${BS.state.title} 복사본` : BS.state.title });
    const pw = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '4자 이상' });
    const pw2 = el('input', { type: 'password', autocomplete: 'new-password' });
    const rem = el('input', { type: 'checkbox', checked: true });
    const r = await dialog(asCopy ? '복사본으로 저장' : '클라우드에 저장', [
      el('p', { class: 'muted' }, '저장하면 공유 링크가 생깁니다. 링크가 있으면 누구나 볼 수 있고, 아래 편집 비밀번호를 아는 사람만 수정·저장할 수 있습니다.'),
      field('배치 이름', title),
      field('편집 비밀번호', pw, '비밀번호는 찾을 수 없으니 함께 편집할 분들과 공유해 두세요.'),
      field('비밀번호 확인', pw2),
      el('label', { class: 'check' }, rem, ' 이 브라우저에 비밀번호 기억'),
    ], '저장하고 링크 만들기', () => {
      if (!title.value.trim()) return '배치 이름을 입력하세요';
      if (pw.value.length < 4) return '편집 비밀번호는 4자 이상이어야 합니다';
      if (pw.value !== pw2.value) return '비밀번호 확인이 일치하지 않습니다';
      return { title: title.value.trim(), pw: pw.value, remember: rem.checked };
    });
    if (!r) return;
    if (asCopy) { C.id = null; C.version = 0; }
    await doCreate(r.title, r.pw, r.remember);
  }

  function askPassword(retry) {
    const pw = el('input', { type: 'password', autocomplete: 'current-password' });
    const rem = el('input', { type: 'checkbox' });
    return dialog('편집 비밀번호', [
      el('p', { class: 'muted' }, retry ? '비밀번호가 맞지 않습니다. 다시 입력하세요.' : `"${C.title}" 을(를) 저장하려면 편집 비밀번호가 필요합니다.`),
      field('비밀번호', pw),
      el('label', { class: 'check' }, rem, ' 이 브라우저에 비밀번호 기억'),
      el('p', { class: 'hint' }, '비밀번호를 모르면 [취소] 후 [파일] 탭의 "복사본으로 저장"으로 내 링크를 새로 만들 수 있습니다.'),
    ], '확인', () => (pw.value ? { pw: pw.value, remember: rem.checked } : '비밀번호를 입력하세요'));
  }

  /* ---------------------------------------------------------------
   * 화면 표시: 툴바 버튼 · 헤더 상태 · [파일] 탭 클라우드 영역
   * ------------------------------------------------------------- */
  function fmtTime(t) {
    if (!t) return '';
    const d = new Date(t);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  C.render = function () {
    const btn = document.getElementById('btn-cloud');
    if (btn) {
      btn.hidden = !C.available();
      btn.classList.toggle('dirty', !!(C.id && C.dirty) || !C.id);
      btn.disabled = C.busy;
      btn.textContent = C.busy ? '☁ 저장 중…' : '☁ 저장';
      btn.title = C.id ? (C.dirty ? '저장하지 않은 변경이 있습니다 (Ctrl+S)' : '클라우드에 저장됨 (Ctrl+S)') : '클라우드에 저장하고 공유 링크 만들기 (Ctrl+S)';
    }
    const st = document.getElementById('cloud-state');
    if (st) {
      st.textContent = !C.available() ? '' : C.id ? (C.dirty ? `☁ ${C.title} · 저장 안 된 변경 있음` : `☁ ${C.title} · 클라우드 저장됨`) : '☁ 클라우드에 저장 안 됨';
      st.classList.toggle('warn', !!(C.id && C.dirty));
    }
    const box = document.getElementById('cloud-box');
    if (!box) return;
    box.innerHTML = '';
    const btnEl = (label, fn, cls = '') => el('button', { type: 'button', class: 'btn ' + cls, onclick: fn, disabled: C.busy }, label);
    if (!C.available()) {
      box.append(el('p', { class: 'hint' }, '클라우드 저장(MongoDB)은 이 앱을 Vercel 등 웹 주소에 배포해서 열었을 때 사용할 수 있습니다. 파일을 더블클릭해서 연 경우에는 아래 JSON 내보내기를 이용하세요.'));
      return;
    }
    if (!C.id) {
      box.append(
        el('p', { class: 'hint' }, '클라우드에 저장하면 공유 링크가 생겨서 다른 컴퓨터·다른 선생님과 같은 배치를 볼 수 있습니다. 수정은 편집 비밀번호가 있어야 합니다.'),
        el('div', { class: 'btn-col' }, btnEl('☁ 클라우드에 저장하고 링크 만들기', () => C.save(), 'primary')));
      return;
    }
    box.append(
      el('div', { class: 'cloud-card' + (C.dirty ? ' dirty' : '') },
        el('b', null, C.title),
        el('span', null, C.dirty ? '저장하지 않은 변경이 있습니다' : `저장됨 · 버전 ${C.version}${C.updatedAt ? ' · ' + fmtTime(C.updatedAt) : ''}`),
        el('input', { type: 'text', readOnly: true, value: C.link(), class: 'link', onfocus: (e) => e.target.select() })),
      el('div', { class: 'btn-col' },
        btnEl(C.busy ? '저장 중…' : '☁ 저장 (Ctrl+S)', () => C.save(), 'primary'),
        btnEl('🔗 공유 링크 복사', () => C.copyLink()),
        btnEl('⧉ 복사본으로 저장 (새 링크)', () => C.save({ asCopy: true })),
        btnEl('⟳ 서버의 최신 버전 다시 불러오기', () => C.reload())),
      el('div', { class: 'btn-row' },
        btnEl('연결 해제 (이 브라우저에서만 편집)', () => {
          if (C.dirty && !confirm('저장하지 않은 변경이 있습니다. 연결을 해제할까요? (화면 내용은 유지됩니다)')) return;
          C.disconnect(); BS.storage.saveLocal();
        }, 'sm'),
        btnEl('클라우드에서 삭제', () => C.remove(), 'sm danger')));
  };
})(window.BS);
