/* =====================================================================
 * app.js — 앱 제어: 초기화 · 변경 반영 · 선택 · 추가/삭제/복제/회전 · 데모 장면
 * ---------------------------------------------------------------------
 *  UI 나 마우스 조작은 상태(BS.state)를 바꾼 뒤 BS.app.changed(...) 를
 *  호출하고, 조작이 끝나면 BS.app.commit() 으로 실행취소 지점을 만든다.
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const A = BS.app = { selId: null, warnings: {}, hasDoc: false };

  /* ---------------------------------------------------------------
   * 시작
   * ------------------------------------------------------------- */
  A.start = function () {
    BS.scene.init(document.getElementById('canvas-host'));
    BS.interaction.init();

    // 이 브라우저에서 작업하던 배치가 있으면 이어서, 없으면(처음 방문) 빈 화면
    const loaded = BS.storage.loadLocal();
    A.rebuildAll();
    BS.history.reset();
    A.setDoc(loaded);
    BS.ui.init();
    BS.scene.setView('diag');
    BS.scene.tween = null; // 첫 화면은 바로
    jumpDiag();
    // 클라우드: ?id= 링크로 열었으면 불러오기, 이어서 편집이면 최신 버전 확인
    BS.cloud.startup();

    BS.on('restored', () => { A.rebuildAll(); if (A.selId && !BS.find(A.selId)) A.select(null); BS.ui.renderAll(); });
    BS.on('dirty', () => BS.storage.autosave());

    // 글꼴이 늦게 로드되면 텍스처 다시 그리기
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        for (const r of BS.panels.map.values()) r.needsTex = true;
        BS.panels.sync(); BS.booth.build(); BS.scene.buildBoothDims(); A.refreshSelDims();
      });
    }
    document.body.classList.add('ready');
  };

  function jumpDiag() {
    BS.scene.setView('diag');
    const tw = BS.scene.tween;
    if (tw) { BS.scene.persp.position.copy(tw.p1); BS.scene.controls.target.copy(tw.t1); BS.scene.tween = null; BS.scene.controls.update(); }
  }

  /* ---------------------------------------------------------------
   * 데모 장면: 300×300 ㄷ자, 뒷벽 연구학교 현수막, 테이블 2 + 의자 4
   * ------------------------------------------------------------- */
  A.demoState = function (shape = 'U', W = 300, D = 300, H = 240) {
    const st = {
      version: 1,
      title: '수업나눔페스타 전시 부스',
      booth: BS.defaults.booth(shape, W, D, H),
      panels: [],
      items: [],
      settings: Object.assign(BS.defaults.settings(), BS.state.settings || {}),
    };
    const banner = BS.panels.presetResearchSchools({ wall: 'back' });
    banner.u = Math.max(0, (W - banner.w) / 2);
    banner.y = Math.max(0, Math.min(20, H - banner.h));
    st.panels.push(banner);

    // 앞쪽 테이블(통로를 향함) + 오른쪽 테이블
    const it = BS.defaults.item;
    const fz = D / 2 - 35;
    st.items.push(it('table-rect', { name: '안내 테이블', x: 0, z: fz }));
    st.items.push(it('table-rect', { name: '전시 테이블', x: W / 2 - 35, z: -D / 2 + 125, rot: 90 }));
    st.items.push(it('chair', { name: '의자 1', x: -45, z: fz - 55 }));
    st.items.push(it('chair', { name: '의자 2', x: 45, z: fz - 55 }));
    st.items.push(it('chair', { name: '의자 3', x: W / 2 - 90, z: -D / 2 + 95, rot: 90 }));
    st.items.push(it('chair', { name: '의자 4', x: W / 2 - 90, z: -D / 2 + 155, rot: 90 }));
    st.items.push(it('laptop', { name: '노트북', x: 40, z: fz }));
    st.items.push(it('person175', { name: '관람객 175cm', x: -W / 2 - 45, z: D / 2 + 45, rot: 150 }));
    return st;
  };

  A.loadDemo = function (shape, W, D, H) {
    const st = A.demoState(shape, W, D, H);
    Object.assign(BS.state, st);
    BS.assets = {};
  };

  /**
   * 배치가 열려 있는지 표시. 닫혀 있으면 가운데는 빈 화면(전시장 바닥만)이고
   * 왼쪽에는 [새로 시작] [불러오기]만 보인다.
   */
  A.setDoc = function (on) {
    A.hasDoc = !!on;
    document.body.classList.toggle('no-doc', !on);
    const S = BS.scene;
    S.boothGroup.visible = S.panelGroup.visible = S.itemGroup.visible = !!on;
    S.gridGroup.visible = !!on && !!BS.state.settings.grid;
    S.dimGroup.visible = !!on && !!BS.state.settings.dims;
    S.selDimGroup.visible = !!on;
    if (!on && A.selId) A.select(null);
    S.requestRender();
    if (BS.cloud) BS.cloud.render();
  };

  /** 배치 닫기 (클라우드에서 삭제한 뒤 등) → 빈 화면 */
  A.closeDoc = function () {
    Object.assign(BS.state, { title: '', booth: BS.defaults.booth(), panels: [], items: [] });
    BS.assets = {};
    A.rebuildAll();
    BS.history.reset();
    A.setDoc(false);
    BS.storage.clearLocal();
    BS.ui.renderAll();
  };

  /** 새 배치 시작 (title: 배치 이름) */
  A.newBooth = function (shape, W, D, H, withDemo, title) {
    // 지금 배치는 이미 자동 저장되어 있음 → 연결만 끊고 새 배치로
    if (BS.cloud.id || BS.cloud.pendingCreate) { BS.cloud.flush(); BS.cloud.disconnect(); }
    if (withDemo) A.loadDemo(shape, W, D, H);
    else {
      Object.assign(BS.state, {
        booth: BS.defaults.booth(shape, W, D, H), panels: [], items: [],
      });
      BS.assets = {};
    }
    if (title) BS.state.title = title;
    A.select(null);
    A.rebuildAll();
    BS.history.reset();
    A.setDoc(true);
    BS.storage.saveLocal();
    BS.ui.renderAll();
    jumpDiag();
  };

  /* ---------------------------------------------------------------
   * 변경 반영
   * ------------------------------------------------------------- */
  A.rebuildAll = function () {
    BS.booth.syncWallFit();
    BS.booth.build();
    BS.panels.sync();
    BS.items.sync();
    BS.scene.buildGrid();
    BS.scene.buildBoothDims();
    A.evaluate();
    A.refreshSelDims();
  };

  /**
   * 무엇이 바뀌었는지 알려주면 필요한 부분만 다시 만든다.
   * @param what 'booth' | 'panels' | 'items' | 'place'(위치만) | 'all'
   */
  A.changed = function (what = 'all') {
    if (what === 'booth' || what === 'all') {
      BS.booth.syncWallFit();
      BS.booth.build();
      BS.scene.buildGrid();
      BS.scene.buildBoothDims();
      BS.panels.sync();
      BS.items.sync();
    } else if (what === 'panels') BS.panels.sync();
    else if (what === 'items') BS.items.sync();
    else if (what === 'place') { BS.items.placeAll(); for (const p of BS.state.panels) { const r = BS.panels.map.get(p.id); if (r) BS.panels.place(p, r.group); } }
    A.evaluate();
    A.refreshSelDims();
    BS.scene.requestRender();
    BS.emit('changed', what);
    BS.storage.autosave();
  };

  A.commit = function () { BS.history.commit(); };

  /** 경고(겹침/밖으로 나감) 판정 후 색 표시 */
  A.evaluate = function () {
    const w = Object.assign({}, BS.panels.evaluate(), BS.items.evaluate());
    A.warnings = w;
    for (const p of BS.state.panels) BS.panels.setStatus(p.id, p.id === A.selId, !!w[p.id]);
    for (const it of BS.state.items) BS.items.setStatus(it.id, it.id === A.selId, !!w[it.id]);
    BS.emit('warnings', w);
  };

  /* ---------------------------------------------------------------
   * 선택
   * ------------------------------------------------------------- */
  A.selected = () => (A.selId ? BS.find(A.selId) : null);
  A.objectOf = function (id) {
    const r = BS.panels.map.get(id) || BS.items.map.get(id);
    return r ? r.group : null;
  };

  A.select = function (id, opts = {}) {
    if (id && !BS.find(id)) id = null;
    const changed = A.selId !== id;
    A.selId = id;
    A.evaluate();
    A.refreshSelDims();
    if (changed || opts.force) BS.emit('select', id, opts);
    BS.scene.requestRender();
  };

  A.refreshSelDims = function () {
    const e = A.selected();
    BS.scene.buildSelDims(e, e ? A.objectOf(e.id) : null);
  };

  /** 선택 물체로 카메라 이동 */
  A.focus = function (id = A.selId) {
    const e = id && BS.find(id);
    if (!e) { BS.toast('먼저 물체나 현수막을 선택하세요'); return; }
    const obj = A.objectOf(id);
    let normal = null;
    if (e.kind === 'panel') {
      if (e.mount === 'wall') normal = BS.booth.wallInfo(e.wall).n.clone();
      else normal = new window.THREE.Vector3(Math.sin(U.rad(e.rot)), 0, Math.cos(U.rad(e.rot)));
    }
    BS.scene.focusObject(obj, normal);
  };

  /* ---------------------------------------------------------------
   * 추가 / 삭제 / 복제 / 회전
   * ------------------------------------------------------------- */
  /** 화면 중앙 근처의 빈 바닥 위치 찾기 */
  function freeSpot(w, d) {
    const b = BS.state.booth;
    const tgt = BS.scene.mode === 'ortho' ? BS.scene.orthoControls.target : BS.scene.controls.target;
    let x = U.clamp(tgt.x, -b.width / 2 + w / 2, b.width / 2 - w / 2);
    let z = U.clamp(tgt.z, -b.depth / 2 + d / 2, b.depth / 2 - d / 2);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(z)) z = 0;
    return { x: U.snap(x, 5), z: U.snap(z, 5) };
  }

  A.addItem = function (type, over = {}) {
    const it = BS.defaults.item(type, U.clone(over));
    if (over.label) delete it.label;
    const n = BS.state.items.filter((i) => i.type === type).length + 1;
    it.name = (over.name || BS.items.LIB[type].label) + (n > 1 ? ' ' + n : '');
    // 작품·노트북 같은 작은 물건: 선택한 테이블(받침)이 있으면 그 위에 놓기
    const sel = A.selected();
    const def = BS.items.LIB[type] || {};
    if (def.derive) BS.items.derive(it);
    if (def.stack && sel && sel.kind === 'item' && (BS.items.LIB[sel.type] || {}).support) {
      const r = U.rad(sel.rot || 0);
      const onTop = BS.items.riders(sel).length;
      const lim = Math.max(0, sel.w / 2 - it.w / 2);
      const off = U.clamp([0, -1, 1][onTop % 3] * (it.w + 5), -lim, lim); // 겹치지 않게 조금씩 옆으로
      it.x = sel.x + Math.cos(r) * off; it.z = sel.z - Math.sin(r) * off; it.rot = sel.rot || 0;
    } else {
      const pos = freeSpot(it.w, it.d);
      it.x = pos.x; it.z = pos.z;
    }
    BS.state.items.push(it);
    A.changed('items');
    A.commit();
    A.select(it.id, { scroll: true });
    BS.toast(`"${it.name}" 추가됨 — 드래그해서 옮기세요`);
    return it;
  };

  A.addPanel = function (p) {
    BS.defaults.fitCells(p);
    if (p.mount === 'free') {
      const pos = freeSpot(p.w, BS.panels.footDepth(p));
      p.x = pos.x; p.z = pos.z;
    }
    BS.state.panels.push(p);
    A.changed('panels');
    A.commit();
    A.select(p.id, { scroll: true });
    BS.toast(`"${p.name}" 추가됨`);
    return p;
  };

  A.remove = function (id = A.selId) {
    const e = id && BS.find(id);
    if (!e) return;
    if (e.locked) { BS.toast('잠긴 항목은 삭제할 수 없습니다 (잠금 해제 후 삭제)', 'warn'); return; }
    if (e.kind === 'panel') BS.state.panels = BS.state.panels.filter((p) => p.id !== id);
    else BS.state.items = BS.state.items.filter((i) => i.id !== id);
    if (A.selId === id) A.selId = null;
    A.changed(e.kind === 'panel' ? 'panels' : 'items');
    A.commit();
    A.select(null);
    BS.toast(`"${e.name}" 삭제됨 (Ctrl+Z 로 되돌리기)`);
  };

  A.duplicate = function (id = A.selId) {
    const e = id && BS.find(id);
    if (!e) return;
    const c = U.clone(e);
    c.id = U.uid(e.kind === 'panel' ? 'pn' : 'it');
    c.name = e.name.replace(/( 복사본)?( \d+)?$/, '') + ' 복사본';
    c.locked = false;
    if (e.kind === 'panel' && e.mount === 'wall') {
      const inf = BS.booth.wallInfo(e.wall);
      c.u = e.u + e.w + 10 <= inf.len - e.w ? e.u + e.w + 10 : Math.max(0, e.u - e.w - 10);
      BS.state.panels.push(c);
    } else {
      const r = U.rad(e.rot || 0);
      const step = (e.w || 50) + 10;
      c.x = e.x + Math.cos(r) * step; c.z = e.z - Math.sin(r) * step;
      (e.kind === 'panel' ? BS.state.panels : BS.state.items).push(c);
    }
    A.changed(e.kind === 'panel' ? 'panels' : 'items');
    A.commit();
    A.select(c.id, { scroll: true });
    BS.toast(`"${c.name}" 복제됨`);
  };

  A.rotate = function (delta, id = A.selId) {
    const e = id && BS.find(id);
    if (!e) return;
    if (e.kind === 'panel' && e.mount === 'wall') { BS.toast('벽 현수막은 회전하지 않습니다'); return; }
    if (e.locked) { BS.toast('잠긴 항목입니다', 'warn'); return; }
    // 받침 위 물건도 같은 중심으로 회전
    const riders = e.kind === 'item' ? BS.items.riders(e) : [];
    const r = U.rad(delta), c = Math.cos(r), s = Math.sin(r);
    for (const o of riders) {
      const dx = o.x - e.x, dz = o.z - e.z;
      o.x = e.x + dx * c + dz * s; o.z = e.z - dx * s + dz * c;
      o.rot = U.normDeg((o.rot || 0) + delta);
    }
    e.rot = U.normDeg(Math.round(((e.rot || 0) + delta) * 10) / 10);
    A.changed('place');
    A.commit();
    BS.emit('entityMoved', e);
  };

  /** 방향키로 조금씩 이동 */
  A.nudge = function (dx, dz, id = A.selId) {
    const e = id && BS.find(id);
    if (!e || e.locked) return;
    if (e.kind === 'panel' && e.mount === 'wall') { e.u += dx; e.y -= dz; }
    else {
      const riders = e.kind === 'item' ? BS.items.riders(e) : [];
      e.x += dx; e.z += dz;
      for (const o of riders) { o.x += dx; o.z += dz; }
    }
    A.changed('place');
    BS.emit('entityMoved', e);
    A.commitSoon();
  };
  A.commitSoon = U.debounce(() => A.commit(), 400);
})(window.BS);
