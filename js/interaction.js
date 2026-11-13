/* =====================================================================
 * interaction.js — 3D 뷰 클릭 선택 · 드래그 이동 · 키보드 단축키
 * ---------------------------------------------------------------------
 *  - 집기/자유 패널 : 바닥 평면 위 드래그 (그리드 스냅 + 벽면 붙이기)
 *  - 벽 현수막      : 벽 평면 위 드래그 (모서리/다른 현수막 스냅, 벽 밖 금지)
 *  - 빈 곳 클릭     : 선택 해제 (드래그로 화면을 돌린 경우는 제외)
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const X = BS.interaction = { drag: null, look: null };

  /** 입력창에 타이핑 중인지 */
  BS.isTyping = function () {
    const a = document.activeElement;
    if (!a) return false;
    const t = a.tagName;
    return (t === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(a.type)) || t === 'TEXTAREA' || t === 'SELECT' || a.isContentEditable;
  };

  X.init = function () {
    const THREE = window.THREE;
    const S = BS.scene;
    const dom = S.renderer.domElement;
    X.ray = new THREE.Raycaster();
    X.ndc = new THREE.Vector2();

    S.onPreDown = onDown;
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => {
      if (S.mode === 'walk') { e.preventDefault(); S.walkWheel(e.deltaY); }
    }, { passive: false });
    dom.addEventListener('dblclick', () => { if (BS.app.selId) BS.app.focus(); });
    window.addEventListener('keydown', onKey);
  };

  /* ---------------------------------------------------------------
   * 피킹
   * ------------------------------------------------------------- */
  function setRay(e) {
    const r = BS.scene.renderer.domElement.getBoundingClientRect();
    X.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    X.ray.setFromCamera(X.ndc, BS.scene.camera);
  }
  function visibleChain(o) {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  }
  /** 화면 좌표 아래의 엔티티 id (벽에 가려지면 null) */
  X.pick = function (e) {
    setRay(e);
    const S = BS.scene;
    const targets = [S.panelGroup, S.itemGroup, ...BS.booth.wallMeshes];
    const hits = X.ray.intersectObjects(targets, true);
    for (const h of hits) {
      if (!h.object.isMesh || h.object.userData.noPick || !visibleChain(h.object)) continue;
      if (h.object.userData.wallKey) return null; // 벽이 먼저 맞음
      for (let n = h.object; n; n = n.parent) if (n.userData.entId) return { id: n.userData.entId, point: h.point };
    }
    return null;
  };

  function rayPlane(e, normal, point) {
    setRay(e);
    const THREE = window.THREE;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    const out = new THREE.Vector3();
    return X.ray.ray.intersectPlane(plane, out) ? out : null;
  }

  /* ---------------------------------------------------------------
   * 포인터 이벤트
   * ------------------------------------------------------------- */
  function onDown(e) {
    const S = BS.scene;
    X.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 우클릭 = 화면 이동(컨트롤)
    const hit = X.pick(e);
    if (hit) {
      if (hit.id !== BS.app.selId) BS.app.select(hit.id, { scroll: true });
      const ent = BS.find(hit.id);
      if (ent && !ent.locked && !ent.hidden) startDrag(e, ent, hit.point);
      else if (ent && ent.locked) X.pendingLockMsg = true;
      return;
    }
    if (S.mode === 'walk') {
      X.look = { x: e.clientX, y: e.clientY, yaw: S.walk.yaw, pitch: S.walk.pitch, id: e.pointerId };
      S.renderer.domElement.setPointerCapture(e.pointerId);
    }
    X.maybeDeselect = true;
  }

  function startDrag(e, ent, point) {
    const THREE = window.THREE;
    const S = BS.scene;
    const dom = S.renderer.domElement;
    S.controls.enabled = false; S.orthoControls.enabled = false;
    dom.setPointerCapture(e.pointerId);
    const d = { ent, id: e.pointerId, moved: false };
    if (ent.kind === 'panel' && ent.mount === 'wall') {
      const info = BS.booth.wallInfo(ent.wall);
      d.mode = 'wall';
      d.info = info;
      d.planePt = info.origin.clone();
      d.normal = info.n.clone();
      const p = rayPlane(e, d.normal, d.planePt) || point;
      const wp = BS.booth.worldToWall(info, p);
      d.off = { u: ent.u - wp.u, v: ent.y - wp.v };
    } else {
      d.mode = 'floor';
      const elev = (BS.items.elev && BS.items.elev[ent.id]) || 0;
      d.normal = new THREE.Vector3(0, 1, 0);
      d.planePt = new THREE.Vector3(0, elev, 0);
      const p = rayPlane(e, d.normal, d.planePt) || point;
      d.off = { x: ent.x - p.x, z: ent.z - p.z };
      // 테이블 위 노트북 등은 함께 움직임
      d.riders = ent.kind === 'item' ? BS.items.riders(ent).map((r) => ({ r, dx: r.x - ent.x, dz: r.z - ent.z })) : [];
    }
    X.drag = d;
    document.body.classList.add('dragging');
  }

  function onMove(e) {
    const S = BS.scene;
    if (X.drag && X.drag.id === e.pointerId) {
      const d = X.drag;
      if (!d.moved && X.down && Math.hypot(e.clientX - X.down.x, e.clientY - X.down.y) < 3) return;
      const p = rayPlane(e, d.normal, d.planePt);
      if (!p) return;
      const snap = BS.state.settings.snap || 0;
      const ent = d.ent;
      if (d.mode === 'wall') {
        const wp = BS.booth.worldToWall(d.info, p);
        const c = BS.panels.constrainWall(ent, wp.u + d.off.u, wp.v + d.off.v, snap);
        if (c.u === ent.u && c.y === ent.y) return;
        ent.u = c.u; ent.y = c.y;
      } else {
        const c = BS.items.constrainFloor(ent, p.x + d.off.x, p.z + d.off.z, snap);
        if (c.x === ent.x && c.z === ent.z) return;
        ent.x = c.x; ent.z = c.z;
        for (const o of d.riders) { o.r.x = ent.x + o.dx; o.r.z = ent.z + o.dz; }
      }
      d.moved = true;
      BS.app.changed('place');
      BS.emit('entityMoved', ent);
      return;
    }
    if (X.look && X.look.id === e.pointerId) {
      const k = 0.005;
      S.walk.yaw = X.look.yaw + (e.clientX - X.look.x) * k;
      S.walk.pitch = X.look.pitch + (e.clientY - X.look.y) * k;
      S.applyWalkCam();
      return;
    }
    // 마우스 올리면 커서 모양
    if (e.pointerType === 'mouse' && !e.buttons) {
      const now = performance.now();
      if (now - (X.lastHover || 0) > 60) {
        X.lastHover = now;
        const h = X.pick(e);
        const ent = h && BS.find(h.id);
        S.renderer.domElement.style.cursor = ent ? (ent.locked ? 'not-allowed' : 'move') : (S.mode === 'ortho' ? 'grab' : 'default');
      }
    }
  }

  function onUp(e) {
    const S = BS.scene;
    const moved = X.down ? Math.hypot(e.clientX - X.down.x, e.clientY - X.down.y) : 99;
    if (X.drag && X.drag.id === e.pointerId) {
      const d = X.drag;
      X.drag = null;
      document.body.classList.remove('dragging');
      S.controls.enabled = S.mode === 'orbit';
      S.orthoControls.enabled = S.mode === 'ortho';
      if (d.moved) { BS.app.commit(); BS.emit('dragEnd', d.ent); }
    }
    if (X.look && X.look.id === e.pointerId) X.look = null;
    if (X.maybeDeselect && moved < 4 && e.type === 'pointerup') BS.app.select(null);
    if (X.pendingLockMsg && moved < 4) BS.toast('잠긴 항목입니다 — 목록에서 🔒 를 눌러 해제하세요', 'warn');
    X.pendingLockMsg = false;
    X.maybeDeselect = false;
  }

  /* ---------------------------------------------------------------
   * 키보드 단축키
   * ------------------------------------------------------------- */
  function onKey(e) {
    const S = BS.scene;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      if (BS.isTyping() && document.activeElement.tagName === 'TEXTAREA') return;
      e.preventDefault();
      if (e.shiftKey) BS.history.redo(); else BS.history.undo();
      return;
    }
    if (mod && key === 'y') { e.preventDefault(); BS.history.redo(); return; }
    if (BS.isTyping()) return;
    if (mod && key === 'd') { e.preventDefault(); BS.app.duplicate(); return; }
    if (mod && key === 's') { e.preventDefault(); BS.storage.exportJSON(); return; }
    if (key === 'escape') {
      if (BS.ui.closeModal()) return;
      if (S.mode === 'walk') { S.setMode('orbit'); S.setView('diag'); return; }
      BS.app.select(null); return;
    }
    if (key === 'delete' || key === 'backspace') { if (BS.app.selId) { e.preventDefault(); BS.app.remove(); } return; }
    if (mod) return;
    if (key === 'r' && BS.app.selId) { BS.app.rotate(e.shiftKey ? -15 : 15); return; }
    if (key === 'f' && BS.app.selId) { BS.app.focus(); return; }
    if (S.mode === 'walk') return; // 걷기 모드에서는 WASD/화살표가 이동용
    if (key.startsWith('arrow') && BS.app.selId) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : Math.max(1, BS.state.settings.snap || 1);
      // 화면 방향 기준이 아니라 부스 좌표(앞/뒤/좌/우) 기준
      const map = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] };
      const [dx, dz] = map[key];
      BS.app.nudge(dx, dz);
      return;
    }
    const views = { 1: 'front', 2: 'left', 3: 'right', 4: 'top', 5: 'diag', 6: 'eye' };
    if (views[key]) { S.setView(views[key]); return; }
    if (key === 'g') { BS.ui.toggleSetting('grid'); return; }
    if (key === 'm') { BS.ui.toggleSetting('dims'); return; }
  }
})(window.BS);
