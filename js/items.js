/* =====================================================================
 * items.js — 테이블 · 의자 · 진열대 등 집기 라이브러리
 * ---------------------------------------------------------------------
 *  - 각 집기는 (가로 w × 깊이 d × 높이 h, cm) + 색상 으로 정의
 *  - 원점 = 바닥면 중심, 앞쪽 = +z (회전 0° 일 때 통로를 향함)
 *  - 충돌 검사(2D 회전 사각형 SAT + 높이 범위), 부스 밖 검사,
 *    작은 물건 자동 적층(테이블 위 노트북 등)
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const I = BS.items = { map: new Map() };

  /* ---------------------------------------------------------------
   * 1. 라이브러리 정의
   *   support : 위에 물건을 올릴 수 있음
   *   stack   : 받침(support) 위에 올라감
   *   ghost   : 충돌/부스 밖 검사 제외(스케일용 사람)
   * ------------------------------------------------------------- */
  I.LIB = {
    'table-rect': { label: '직사각 테이블', group: '테이블', defaults: { w: 180, d: 60, h: 72, color: '#f2f2ee' }, support: true, table: true, cloth: true },
    'table-square': { label: '정사각 테이블', group: '테이블', defaults: { w: 75, d: 75, h: 72, color: '#f2f2ee' }, support: true, table: true, cloth: true },
    'table-round': { label: '원형 테이블', group: '테이블', defaults: { w: 90, d: 90, h: 72, color: '#f2f2ee' }, support: true, table: true, round: true },
    'chair': { label: '의자', group: '의자', defaults: { w: 45, d: 50, h: 85, color: '#3d5a80' }, chair: true },
    'stool': { label: '스툴', group: '의자', defaults: { w: 38, d: 38, h: 65, color: '#3d5a80' }, chair: true, round: true },
    'shelf': { label: '진열 선반', group: '진열', defaults: { w: 120, d: 40, h: 180, color: '#e9e4da' }, support: true },
    'platform': { label: '낮은 전시 단', group: '진열', defaults: { w: 120, d: 60, h: 40, color: '#ffffff' }, support: true },
    'pedestal': { label: '좌대(스탠드)', group: '진열', defaults: { w: 40, d: 40, h: 90, color: '#ffffff' }, support: true },
    'box': { label: '상자(자유 크기)', group: '진열', defaults: { w: 40, d: 30, h: 30, color: '#c8a47e' }, stack: true },
    'laptop': { label: '노트북', group: '디지털', defaults: { w: 34, d: 24, h: 22, color: '#5b6068' }, stack: true },
    'monitor': { label: '모니터', group: '디지털', defaults: { w: 60, d: 20, h: 45, color: '#2b2e33' }, stack: true },
    'terminal': { label: '단말 자리(노트북+모니터)', group: '디지털', defaults: { w: 120, d: 60, h: 72, color: '#f2f2ee' }, support: false, table: true },
    'kiosk': { label: '스탠드형 키오스크', group: '디지털', defaults: { w: 55, d: 50, h: 150, color: '#e6e8eb' } },
    'person160': { label: '사람 160cm', group: '사람(스케일)', defaults: { w: 44, d: 24, h: 160, color: '#8d99ae' }, ghost: true },
    'person175': { label: '사람 175cm', group: '사람(스케일)', defaults: { w: 48, d: 26, h: 175, color: '#6c7a91' }, ghost: true },
  };

  /** 라이브러리 패널에 보여줄 프리셋 (대여용 표준 규격 포함) */
  I.PRESETS = [
    { group: '테이블', items: [
      { type: 'table-rect', label: '직사각 테이블 180×60', over: { w: 180, d: 60, h: 72 } },
      { type: 'table-rect', label: '직사각 테이블 180×45', over: { w: 180, d: 45, h: 72 } },
      { type: 'table-rect', label: '직사각 테이블 120×60', over: { w: 120, d: 60, h: 72 } },
      { type: 'table-rect', label: '테이블 180×60 (천 덮개)', over: { w: 180, d: 60, h: 72, cloth: true, color: '#1f3a68' } },
      { type: 'table-square', label: '정사각 테이블 75×75', over: {} },
      { type: 'table-round', label: '원형 테이블 Ø90', over: {} },
      { type: 'table-round', label: '원형 테이블 Ø60 (카페형)', over: { w: 60, d: 60, h: 72 } },
    ] },
    { group: '의자', items: [
      { type: 'chair', label: '의자 45×50', over: {} },
      { type: 'stool', label: '스툴', over: {} },
    ] },
    { group: '진열', items: [
      { type: 'shelf', label: '진열 선반 120×40×180', over: {} },
      { type: 'shelf', label: '낮은 진열장 90×40×90', over: { w: 90, d: 40, h: 90 } },
      { type: 'platform', label: '낮은 전시 단 120×60×40', over: {} },
      { type: 'pedestal', label: '좌대 40×40×90', over: {} },
      { type: 'box', label: '상자/소품', over: {} },
    ] },
    { group: '디지털', items: [
      { type: 'terminal', label: '단말 자리 (책상+노트북+모니터)', over: {} },
      { type: 'laptop', label: '노트북 (테이블 위에 올리기)', over: {} },
      { type: 'monitor', label: '모니터 (테이블 위에 올리기)', over: {} },
      { type: 'kiosk', label: '스탠드형 키오스크', over: {} },
    ] },
    { group: '사람(스케일 확인)', items: [
      { type: 'person160', label: '사람 실루엣 160cm', over: {} },
      { type: 'person175', label: '사람 실루엣 175cm', over: {} },
    ] },
  ];

  /* ---------------------------------------------------------------
   * 2. 모양 만들기 (builder) — 원점: 바닥 중심
   * ------------------------------------------------------------- */
  function std(color, rough = 0.7, metal = 0) {
    return new window.THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }
  function box(g, w, h, d, mat, x, y, z) {
    const m = new window.THREE.Mesh(new window.THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function cyl(g, r1, r2, h, mat, x, y, z, seg = 24) {
    const m = new window.THREE.Mesh(new window.THREE.CylinderGeometry(r1, r2, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }

  function tableRect(g, it, M) {
    const { w, d, h } = it;
    const top = 3;
    if (it.cloth) {
      // 천 덮개: 상판에서 바닥 근처까지 덮음
      box(g, w + 2, top, d + 2, M.main, 0, h - top / 2, 0);
      box(g, w + 2, h - top - 4, d + 2, M.main, 0, (h - top - 4) / 2 + 4, 0);
      return;
    }
    box(g, w, top, d, M.main, 0, h - top / 2, 0);
    const lx = w / 2 - 4, lz = d / 2 - 4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 3.5, h - top, 3.5, M.metal, sx * lx, (h - top) / 2, sz * lz);
    box(g, w - 10, 6, 1.5, M.metal, 0, h - top - 3, -lz); // 뒤쪽 보강대
  }
  function tableRound(g, it, M) {
    const r = it.w / 2, h = it.h;
    cyl(g, r, r, 3, M.main, 0, h - 1.5, 0, 48);
    cyl(g, 3, 3, h - 3, M.metal, 0, (h - 3) / 2, 0, 16);
    cyl(g, r * 0.45, r * 0.5, 2, M.metal, 0, 1, 0, 32);
  }
  function chair(g, it, M) {
    const { w, d, h } = it;
    const seatH = Math.min(46, h * 0.54);
    box(g, w, 4, d * 0.9, M.main, 0, seatH, d * 0.05);
    box(g, w, h - seatH - 2, 3, M.main, 0, seatH + (h - seatH) / 2, -d / 2 + 2);
    const lx = w / 2 - 3, lz = d / 2 - 4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 2.5, seatH - 2, 2.5, M.metal, sx * lx, (seatH - 2) / 2, sz * lz);
  }
  function stool(g, it, M) {
    const r = it.w / 2, h = it.h;
    cyl(g, r, r, 4, M.main, 0, h - 2, 0, 32);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      box(g, 2.5, h - 4, 2.5, M.metal, Math.cos(a) * r * 0.7, (h - 4) / 2, Math.sin(a) * r * 0.7);
    }
  }
  function shelf(g, it, M) {
    const { w, d, h } = it;
    const t = 2;
    box(g, t, h, d, M.main, -w / 2 + t / 2, h / 2, 0);
    box(g, t, h, d, M.main, w / 2 - t / 2, h / 2, 0);
    box(g, w, h, 1, M.main, 0, h / 2, -d / 2 + 0.5);
    const n = Math.max(2, Math.round(h / 40));
    for (let i = 0; i <= n; i++) {
      const y = i === 0 ? 6 : i === n ? h - t / 2 : 6 + (h - 6) * i / n;
      box(g, w - t * 2, t, d - 1, M.main, 0, y, 0.5);
    }
    box(g, w - t * 2, 6, 1, M.main, 0, 3, d / 2 - 0.5); // 걸레받이
  }
  function blockItem(g, it, M) {
    box(g, it.w, it.h, it.d, M.main, 0, it.h / 2, 0);
    // 윗면 테두리 느낌
    box(g, it.w + 0.6, 1.2, it.d + 0.6, M.edge, 0, it.h - 0.6, 0);
  }
  function plainBox(g, it, M) { box(g, it.w, it.h, it.d, M.main, 0, it.h / 2, 0); }
  function laptop(g, it, M, ox = 0, oy = 0, oz = 0) {
    const { w, d, h } = it;
    const baseH = Math.max(1.5, h * 0.08);
    box(g, w, baseH, d, M.main, ox, oy + baseH / 2, oz);
    const sh = Math.min(h - baseH, d * 0.95);
    const scr = new window.THREE.Group();
    scr.position.set(ox, oy + baseH, oz - d / 2 + 0.8);
    scr.rotation.x = -0.28;
    box(scr, w, sh, 0.8, M.main, 0, sh / 2, 0);
    box(scr, w * 0.92, sh * 0.86, 0.2, M.screen, 0, sh / 2, 0.45);
    g.add(scr);
  }
  function monitor(g, it, M, ox = 0, oy = 0, oz = 0) {
    const { w, d, h } = it;
    box(g, Math.min(w * 0.4, 24), 1.5, Math.min(d, 18), M.main, ox, oy + 0.75, oz);
    const sh = Math.max(10, h - 10);
    const sw = w;
    box(g, 4, sh * 0.6, 2.5, M.main, ox, oy + sh * 0.3 + 1, oz - 2);
    box(g, sw, sh * 0.62 * 1.0, 3, M.main, ox, oy + h - sh * 0.31, oz);
    box(g, sw * 0.95, sh * 0.56, 0.3, M.screen, ox, oy + h - sh * 0.31, oz + 1.6);
  }
  function terminal(g, it, M) {
    tableRect(g, it, M);
    laptop(g, { w: 34, d: 24, h: 22 }, M.dev, -it.w * 0.22, it.h, it.d * 0.05);
    monitor(g, { w: 55, d: 18, h: 45 }, M.dev, it.w * 0.18, it.h, -it.d * 0.15);
  }
  function kiosk(g, it, M) {
    const { w, d, h } = it;
    box(g, w, 4, d, M.metal, 0, 2, 0);
    box(g, w * 0.5, h * 0.62, d * 0.4, M.main, 0, h * 0.31 + 4, -d * 0.1);
    const head = new window.THREE.Group();
    head.position.set(0, h * 0.66, 0);
    head.rotation.x = -0.5;
    box(head, w, h * 0.34, 4, M.main, 0, h * 0.17, 0);
    box(head, w * 0.9, h * 0.3, 0.3, M.screen, 0, h * 0.17, 2.2);
    g.add(head);
  }
  function person(g, it, M) {
    const H = it.h, s = H / 170;
    const legH = H * 0.47, torsoH = H * 0.3, headR = H * 0.065;
    const THREE = window.THREE;
    const hipW = it.w * 0.42;
    for (const sx of [-1, 1]) cyl(g, 6 * s, 5 * s, legH, M.main, sx * hipW / 2.6, legH / 2, 0, 12);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(it.w * 0.3, torsoH - it.w * 0.3, 6, 14), M.main);
    torso.scale.z = (it.d / it.w) * 1.2;
    torso.position.set(0, legH + torsoH / 2 + 2 * s, 0);
    torso.castShadow = true; g.add(torso);
    for (const sx of [-1, 1]) {
      const arm = cyl(g, 3.5 * s, 3 * s, H * 0.33, M.main, sx * it.w * 0.42, legH + torsoH - H * 0.16, 0, 10);
      arm.rotation.z = sx * 0.06;
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 16), M.main);
    head.position.set(0, H - headR, 0); head.castShadow = true; g.add(head);
    // 앞 방향 표시(코)
    box(g, 2 * s, 2.5 * s, 2 * s, M.main, 0, H - headR, headR * 0.95);
  }

  const BUILD = {
    'table-rect': tableRect, 'table-square': tableRect, 'table-round': tableRound,
    chair, stool, shelf, platform: blockItem, pedestal: blockItem, box: plainBox,
    laptop: (g, it, M) => laptop(g, it, M), monitor: (g, it, M) => monitor(g, it, M),
    terminal, kiosk, person160: person, person175: person,
  };

  function buildItem(it, rec) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData.entId = it.id;
    const inner = new THREE.Group();     // 적층 높이(elev)만큼 올리는 그룹
    group.add(inner);
    const isDev = it.type === 'laptop' || it.type === 'monitor';
    const M = {
      main: std(it.color, it.cloth ? 0.95 : 0.6),
      metal: std('#8f959c', 0.35, 0.65),
      edge: std(U.shade(it.color, -0.15), 0.6),
      screen: new THREE.MeshStandardMaterial({ color: '#0d1b2a', roughness: 0.25, emissive: '#1b3a5c', emissiveIntensity: 0.6 }),
    };
    if (isDev) M.metal = M.main;
    M.dev = { main: std('#3a3f46', 0.5, 0.2), screen: M.screen };
    (BUILD[it.type] || plainBox)(inner, it, M);
    rec.mats = [];
    inner.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { if (!rec.mats.includes(m)) rec.mats.push(m); }); } });

    // 선택/경고 외곽선 (바닥 발자국 기준 상자)
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(it.w + 1.5, it.h + 1, it.d + 1.5)),
      new THREE.LineBasicMaterial({ color: '#1e88ff', depthTest: false, transparent: true })
    );
    edge.position.y = it.h / 2; edge.visible = false; edge.renderOrder = 15; edge.userData.noPick = true;
    inner.add(edge);
    // 바닥 발자국(경고 시 빨간 영역)
    const foot = new THREE.Mesh(
      new THREE.PlaneGeometry(it.w, it.d),
      new THREE.MeshBasicMaterial({ color: '#ff2d20', transparent: true, opacity: 0.35, depthWrite: false })
    );
    foot.rotation.x = -Math.PI / 2; foot.position.y = 0.4; foot.visible = false; foot.userData.noPick = true;
    inner.add(foot);
    rec.inner = inner; rec.edge = edge; rec.foot = foot;
    return group;
  }

  const geoKey = (it) => JSON.stringify([it.type, it.w, it.d, it.h, it.color, !!it.cloth]);

  /* ---------------------------------------------------------------
   * 3. 상태 → 3D 동기화
   * ------------------------------------------------------------- */
  I.sync = function () {
    const S = BS.scene;
    const alive = new Set();
    for (const it of BS.state.items) {
      alive.add(it.id);
      if (I.LIB[it.type] && I.LIB[it.type].round) it.d = it.w; // 원형은 지름 하나
      let rec = I.map.get(it.id);
      const gk = geoKey(it);
      if (!rec || rec.geoKey !== gk) {
        if (rec) { S.itemGroup.remove(rec.group); S.disposeObj(rec.group); }
        rec = { geoKey: gk };
        rec.group = buildItem(it, rec);
        S.itemGroup.add(rec.group);
        I.map.set(it.id, rec);
      }
      rec.ent = it;
    }
    for (const [id, rec] of I.map) {
      if (!alive.has(id)) { S.itemGroup.remove(rec.group); S.disposeObj(rec.group); I.map.delete(id); }
    }
    I.placeAll();
  };

  /** 위치/회전/적층 높이 반영 */
  I.placeAll = function () {
    const elev = I.computeElevations();
    for (const it of BS.state.items) {
      const rec = I.map.get(it.id);
      if (!rec) continue;
      rec.group.position.set(it.x, 0, it.z);
      rec.group.rotation.set(0, U.rad(it.rot || 0), 0);
      rec.group.visible = !it.hidden;
      const e = elev[it.id] || 0;
      rec.inner.position.y = e;
      rec.group.userData.elev = e;
    }
    BS.scene.requestRender();
  };

  /* ---------------------------------------------------------------
   * 4. 2D 발자국(회전 사각형) 계산 · 충돌 판정
   * ------------------------------------------------------------- */
  /** 엔티티의 바닥 발자국 꼭짓점 4개 [{x,z}] */
  I.footprint = function (e) {
    const w = e.w, d = e.kind === 'panel' ? BS.panels.footDepth(e) : e.d;
    const r = U.rad(e.rot || 0), c = Math.cos(r), s = Math.sin(r);
    // three.js y축 회전: x' = x*c + z*s, z' = -x*s + z*c
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => ({
      x: e.x + x * c + z * s, z: e.z - x * s + z * c,
    }));
  };

  function overlapSAT(A, B) {
    for (const poly of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % 4];
        const nx = p2.z - p1.z, nz = -(p2.x - p1.x);
        let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
        for (const p of A) { const v = p.x * nx + p.z * nz; aMin = Math.min(aMin, v); aMax = Math.max(aMax, v); }
        for (const p of B) { const v = p.x * nx + p.z * nz; bMin = Math.min(bMin, v); bMax = Math.max(bMax, v); }
        const len = Math.hypot(nx, nz) || 1;
        if (aMax - bMin < 0.3 * len || bMax - aMin < 0.3 * len) return false; // 0.3cm 여유
      }
    }
    return true;
  }
  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > pt.z) !== (b.z > pt.z) && pt.x < (b.x - a.x) * (pt.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }

  /** 작은 물건(stack)이 받침(support) 위에 있으면 그 높이로 올림 */
  I.computeElevations = function () {
    const out = {};
    const supports = BS.state.items.filter((s) => !s.hidden && I.LIB[s.type] && I.LIB[s.type].support);
    for (const it of BS.state.items) {
      const def = I.LIB[it.type];
      if (!def || !def.stack) continue;
      let best = 0;
      for (const s of supports) {
        if (s === it) continue;
        if (pointInPoly({ x: it.x, z: it.z }, I.footprint(s))) best = Math.max(best, s.h);
      }
      out[it.id] = best;
    }
    I.elev = out;
    return out;
  };

  /** 받침(support) 위에 올라가 있는 작은 물건들 (함께 이동/회전용) */
  I.riders = function (sup) {
    const def = I.LIB[sup.type];
    if (!def || !def.support) return [];
    const elev = I.elev || I.computeElevations();
    const fp = I.footprint(sup);
    return BS.state.items.filter((it) => it !== sup && I.LIB[it.type] && I.LIB[it.type].stack && !it.locked &&
      Math.abs((elev[it.id] || 0) - sup.h) < 0.01 && pointInPoly({ x: it.x, z: it.z }, fp));
  };

  /**
   * 충돌/부스 밖 판정 — 집기 + 자유 패널
   * @returns { id: [메시지...] }
   */
  I.evaluate = function () {
    const res = {};
    const b = BS.state.booth;
    const W = b.width / 2, D = b.depth / 2;
    const elev = I.elev || I.computeElevations();
    const ents = [
      ...BS.state.items.filter((i) => !i.hidden),
      ...BS.state.panels.filter((p) => p.mount === 'free' && !p.hidden),
    ];
    const info = ents.map((e) => {
      const def = e.kind === 'item' ? I.LIB[e.type] || {} : {};
      const y0 = e.kind === 'item' ? (elev[e.id] || 0) : 0;
      const y1 = e.kind === 'item' ? y0 + e.h : e.y + e.h;
      return { e, def, fp: I.footprint(e), y0, y1 };
    });
    const add = (id, m) => { (res[id] = res[id] || []).includes(m) || res[id].push(m); };
    for (const a of info) {
      if (a.def.ghost) continue;
      if (a.fp.some((p) => p.x < -W - 0.3 || p.x > W + 0.3 || p.z < -D - 0.3 || p.z > D + 0.3)) add(a.e.id, '부스 밖으로 나감');
    }
    for (let i = 0; i < info.length; i++) {
      for (let j = i + 1; j < info.length; j++) {
        const a = info[i], c = info[j];
        if (a.def.ghost || c.def.ghost) continue;
        // 의자는 테이블 아래로 넣을 수 있음
        if ((a.def.chair && c.def.table) || (c.def.chair && a.def.table)) continue;
        if (a.y1 <= c.y0 + 0.3 || c.y1 <= a.y0 + 0.3) continue; // 높이가 안 겹침(적층)
        if (overlapSAT(a.fp, c.fp)) {
          add(a.e.id, `"${c.e.name}"와 겹침`);
          add(c.e.id, `"${a.e.name}"와 겹침`);
        }
      }
    }
    return res;
  };

  /** 선택/경고 표시 */
  I.setStatus = function (id, selected, warn) {
    const rec = I.map.get(id);
    if (!rec) return;
    rec.edge.visible = selected || warn;
    rec.edge.material.color.set(warn ? '#ff2d20' : '#1e88ff');
    rec.foot.visible = warn;
    for (const m of rec.mats) {
      if (!m.emissive || m === rec.mats.screen) continue;
      if (m.userData.baseEm === undefined) { m.userData.baseEm = m.emissive.getHex(); m.userData.baseEi = m.emissiveIntensity; }
      if (warn) { m.emissive.set('#ff1a0d'); m.emissiveIntensity = 0.55; }
      else if (selected) { m.emissive.set('#1e6fff'); m.emissiveIntensity = 0.18; }
      else { m.emissive.setHex(m.userData.baseEm); m.emissiveIntensity = m.userData.baseEi; }
    }
  };

  /** 드래그 시: 그리드 스냅 + 부스 벽면에 붙이기 */
  I.constrainFloor = function (e, x, z, step) {
    x = U.snap(x, step); z = U.snap(z, step);
    const b = BS.state.booth;
    const TH = Math.max(4, step);
    // 회전된 발자국의 축정렬 반폭
    const w = e.w, d = e.kind === 'panel' ? BS.panels.footDepth(e) : e.d;
    const r = U.rad(e.rot || 0);
    const hx = Math.abs(Math.cos(r)) * w / 2 + Math.abs(Math.sin(r)) * d / 2;
    const hz = Math.abs(Math.sin(r)) * w / 2 + Math.abs(Math.cos(r)) * d / 2;
    const W = b.width / 2, D = b.depth / 2;
    if (Math.abs(x - hx - -W) < TH) x = -W + hx;
    if (Math.abs(x + hx - W) < TH) x = W - hx;
    if (Math.abs(z - hz - -D) < TH) z = -D + hz;
    if (Math.abs(z + hz - D) < TH) z = D - hz;
    return { x, z };
  };
})(window.BS);
