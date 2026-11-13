/* =====================================================================
 * booth.js — 부스(바닥 · 벽 · 통로 · 옆 부스 경계) 생성
 * ---------------------------------------------------------------------
 *  벽 좌표계(wallInfo): 부스 "안쪽"에서 벽을 바라볼 때
 *    origin : 벽 안쪽 면의 왼쪽 끝, 바닥 높이
 *    u      : 오른쪽 방향 단위벡터 (벽 길이 방향)
 *    n      : 벽 안쪽 면의 법선 (부스 안쪽을 향함)
 *  현수막 위치(u, y)는 이 좌표계 기준 → 현장에서 "벽 왼쪽 모서리에서 몇 cm,
 *  바닥에서 몇 cm" 로 바로 쓸 수 있다.
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const B = BS.booth = { wallMeshes: [] };

  /** 벽 하나의 실제 길이/높이/위치 정보 */
  B.wallInfo = function (key, b = BS.state.booth) {
    const THREE = window.THREE;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const w = b.walls[key];
    const W = b.width, D = b.depth, t = b.thickness;
    const horiz = key === 'back' || key === 'front';
    const len = w.fit ? (horiz ? W : D) : Math.max(1, w.len);
    const h = w.fit ? b.height : Math.max(1, w.h);
    let origin, u, n, box;
    // 앞/뒤 벽이 부스 폭만큼 길면 옆벽 두께만큼 모서리를 덮도록 연장
    const extL = horiz && len >= W - 0.01 && b.walls.left.on ? t : 0;
    const extR = horiz && len >= W - 0.01 && b.walls.right.on ? t : 0;
    switch (key) {
      case 'back':
        origin = V(-len / 2, 0, -D / 2); u = V(1, 0, 0); n = V(0, 0, 1);
        box = { x0: -len / 2 - extL, x1: len / 2 + extR, z0: -D / 2 - t, z1: -D / 2 };
        break;
      case 'front':
        origin = V(len / 2, 0, D / 2); u = V(-1, 0, 0); n = V(0, 0, -1);
        box = { x0: -len / 2 - extL, x1: len / 2 + extR, z0: D / 2, z1: D / 2 + t };
        break;
      case 'left': // 뒤쪽 모서리에 붙어서 앞으로 len 만큼
        origin = V(-W / 2, 0, -D / 2 + len); u = V(0, 0, -1); n = V(1, 0, 0);
        box = { x0: -W / 2 - t, x1: -W / 2, z0: -D / 2, z1: -D / 2 + len };
        break;
      case 'right':
        origin = V(W / 2, 0, -D / 2); u = V(0, 0, 1); n = V(-1, 0, 0);
        box = { x0: W / 2, x1: W / 2 + t, z0: -D / 2, z1: -D / 2 + len };
        break;
    }
    return { key, on: !!w.on, len, h, t, origin, u, n, box };
  };

  /** 벽 좌표(u, v) → 월드 좌표 */
  B.wallToWorld = function (info, u, v, off = 0) {
    return info.origin.clone().addScaledVector(info.u, u).setY(v).addScaledVector(info.n, off);
  };

  /** 월드 좌표 → 벽 좌표 {u, v} */
  B.worldToWall = function (info, p) {
    const d = p.clone().sub(info.origin);
    return { u: d.dot(info.u), v: p.y };
  };

  /* ---------------------------------------------------------------
   * 부스 다시 만들기
   * ------------------------------------------------------------- */
  B.build = function () {
    const THREE = window.THREE;
    const S = BS.scene, b = BS.state.booth;
    S.clearGroup(S.boothGroup);
    B.wallMeshes = [];
    const W = b.width, D = b.depth;

    // --- 부스 바닥(카펫) ---
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, 1, D),
      new THREE.MeshStandardMaterial({ color: b.floorColor, roughness: 1 })
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    floor.userData.isFloor = true;
    S.boothGroup.add(floor);

    // --- 벽 ---
    const wallMat = new THREE.MeshStandardMaterial({ color: b.wallColor, roughness: 0.92 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#b9bec5', roughness: 0.45, metalness: 0.55 });
    for (const key of BS.WALL_KEYS) {
      const info = B.wallInfo(key);
      if (!info.on) continue;
      const bx = info.box;
      const sx = bx.x1 - bx.x0, sz = bx.z1 - bx.z0;
      const cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2;
      const grp = new THREE.Group();
      grp.userData.wallKey = key;

      if (b.shape === 'panel') {
        // 칸막이 패널형: 알루미늄 기둥 + 상·하 레일 + 패널 판
        const along = sx > sz ? 'x' : 'z';
        const L = along === 'x' ? sx : sz;
        const T = along === 'x' ? sz : sx;
        const mod = Math.max(30, b.panelModule || 100);
        const n = Math.max(1, Math.round(L / mod));
        const step = L / n, post = Math.min(4, T + 1), rail = 4;
        const mk = (len, hh, th, mat, px, py, pz) => {
          const g = along === 'x' ? new THREE.BoxGeometry(len, hh, th) : new THREE.BoxGeometry(th, hh, len);
          const m = new THREE.Mesh(g, mat);
          if (along === 'x') m.position.set(cx - L / 2 + px, py, cz + pz);
          else m.position.set(cx + pz, py, cz - L / 2 + px);
          m.castShadow = true; m.receiveShadow = true;
          grp.add(m); return m;
        };
        for (let i = 0; i <= n; i++) mk(post, info.h, post, frameMat, U.clamp(i * step, post / 2, L - post / 2), info.h / 2, 0);
        mk(L, rail, T + 0.6, frameMat, L / 2, info.h - rail / 2, 0);
        mk(L, rail, T + 0.6, frameMat, L / 2, rail / 2, 0);
        for (let i = 0; i < n; i++) mk(step - post, info.h - rail * 2, Math.max(0.6, T * 0.6), wallMat, i * step + step / 2, info.h / 2, 0);
      } else {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, info.h, sz), wallMat);
        m.position.set(cx, info.h / 2, cz);
        m.castShadow = true; m.receiveShadow = true;
        grp.add(m);
      }
      grp.traverse((o) => { if (o.isMesh) { o.userData.wallKey = key; B.wallMeshes.push(o); } });
      S.boothGroup.add(grp);
    }

    // --- 통로 ---
    if (b.aisle && b.aisleWidth > 0) {
      const aw = b.aisleWidth;
      const span = W * 3 + 400;
      const aisle = new THREE.Mesh(
        new THREE.PlaneGeometry(span, aw),
        new THREE.MeshStandardMaterial({ color: '#c9cdd2', roughness: 0.95 })
      );
      aisle.rotation.x = -Math.PI / 2;
      aisle.position.set(0, -0.9, D / 2 + aw / 2);
      aisle.receiveShadow = true;
      S.boothGroup.add(aisle);
      dashedRect(S.boothGroup, -span / 2, span / 2, D / 2, D / 2 + aw, '#7b8794', 0.2, [true, false, true, false]);
      const lbl = floorText(`통로 폭 ${U.fmt(aw)} cm`, Math.min(24, aw * 0.16), '#4a5562');
      lbl.position.set(0, 0.3, D / 2 + aw / 2);
      S.boothGroup.add(lbl);
    }

    // --- 옆 부스 경계선 ---
    if (b.neighbors) {
      const col = '#8a5a00';
      dashedRect(S.boothGroup, -W * 1.5, -W / 2, -D / 2, D / 2, col, 0.25);
      dashedRect(S.boothGroup, W / 2, W * 1.5, -D / 2, D / 2, col, 0.25);
      dashedRect(S.boothGroup, -W / 2, W / 2, -D * 1.5, -D / 2, col, 0.25);
      const ts = U.clamp(Math.min(W, D) * 0.08, 10, 30);
      [['옆 부스', -W, 0], ['옆 부스', W, 0], ['뒤 부스', 0, -D]].forEach(([t, x, z]) => {
        const l = floorText(t, ts, col); l.position.set(x, 0.3, z); S.boothGroup.add(l);
      });
    }

    // 내 부스 경계(굵은 선)
    dashedRect(S.boothGroup, -W / 2, W / 2, -D / 2, D / 2, '#1d4ed8', 0.6, null, true);

    S.fitShadow(b);
    S.requestRender();
  };

  /* ---------------------------------------------------------------
   * 헬퍼: 바닥 점선 사각형 / 바닥 글씨
   * ------------------------------------------------------------- */
  function dashedRect(group, x0, x1, z0, z1, color, y, sides, solid) {
    const THREE = window.THREE;
    const s = sides || [true, true, true, true]; // 앞, 오른, 뒤, 왼
    const pts = [];
    if (s[2]) pts.push(x0, y, z0, x1, y, z0);
    if (s[1]) pts.push(x1, y, z0, x1, y, z1);
    if (s[0]) pts.push(x1, y, z1, x0, y, z1);
    if (s[3]) pts.push(x0, y, z1, x0, y, z0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = solid
      ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })
      : new THREE.LineDashedMaterial({ color, dashSize: 12, gapSize: 8 });
    const l = new THREE.LineSegments(g, m);
    if (!solid) l.computeLineDistances();
    l.userData.noPick = true;
    group.add(l);
  }

  /** 바닥에 눕힌 글씨 (평면도에서도 읽히도록) */
  function floorText(text, size, color) {
    const THREE = window.THREE;
    const fs = 96;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    ctx.font = `700 ${fs}px ${BS.FONT}`;
    cv.width = Math.ceil(ctx.measureText(text).width) + 40; cv.height = fs + 30;
    ctx.font = `700 ${fs}px ${BS.FONT}`;
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = BS.scene.maxAniso;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size * cv.width / cv.height, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 })
    );
    m.rotation.x = -Math.PI / 2;
    m.userData.noPick = true;
    return m;
  }
  B.floorText = floorText;

  /* ---------------------------------------------------------------
   * 형태 적용: 형태 선택 시 벽 on/off 를 기본값으로
   * ------------------------------------------------------------- */
  B.applyShape = function (shape) {
    const b = BS.state.booth;
    b.shape = shape;
    const sw = BS.SHAPES[shape].walls;
    for (const k of BS.WALL_KEYS) b.walls[k].on = !!sw[k];
    if (shape === 'panel' && b.thickness > 5) b.thickness = 4;
  };

  /** 부스 크기가 바뀌면 '맞춤' 벽의 길이/높이 표시값 갱신 */
  B.syncWallFit = function () {
    const b = BS.state.booth;
    for (const k of BS.WALL_KEYS) {
      const w = b.walls[k];
      if (w.fit) {
        w.len = (k === 'back' || k === 'front') ? b.width : b.depth;
        w.h = b.height;
      }
    }
  };
})(window.BS);
