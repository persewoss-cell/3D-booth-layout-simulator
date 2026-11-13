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
   *   cover   : 투명 케이스 — 안에 넣은 작품과 겹쳐도 경고하지 않음
   *   image   : 작품/화면 이미지를 올릴 수 있음 (it.img = asset id)
   *   derive  : 작품 크기(pw·ph·두께·놓는 방식)에서 가로·깊이·높이를 자동 계산
   * ------------------------------------------------------------- */
  I.LIB = {
    'table-rect': { label: '사각 테이블', group: '테이블', defaults: { w: 180, d: 60, h: 72, color: '#f2f2ee' }, support: true, table: true, cloth: true },
    'table-square': { label: '정사각 테이블', group: '테이블', defaults: { w: 75, d: 75, h: 72, color: '#f2f2ee' }, support: true, table: true, cloth: true },
    'table-round': { label: '원형 테이블', group: '테이블', defaults: { w: 90, d: 90, h: 72, color: '#f2f2ee' }, support: true, table: true, round: true, cloth: true },
    'chair': { label: '의자', group: '의자', defaults: { w: 45, d: 50, h: 85, color: '#3d5a80' }, chair: true },
    'stool': { label: '스툴', group: '의자', defaults: { w: 38, d: 38, h: 65, color: '#3d5a80' }, chair: true, round: true },
    'shelf': { label: '진열 선반', group: '진열', defaults: { w: 120, d: 40, h: 180, color: '#e9e4da' }, support: true },
    'platform': { label: '낮은 전시 단', group: '진열', defaults: { w: 120, d: 60, h: 40, color: '#ffffff' }, support: true },
    'pedestal': { label: '좌대(스탠드)', group: '진열', defaults: { w: 40, d: 40, h: 90, color: '#ffffff' }, support: true },
    'box': { label: '상자(자유 크기)', group: '진열', defaults: { w: 40, d: 30, h: 30, color: '#c8a47e' }, stack: true },
    'laptop': { label: '노트북', group: '디지털', defaults: { w: 34, d: 24, h: 22, color: '#5b6068' }, stack: true, image: 'screen' },
    'monitor': { label: '모니터', group: '디지털', defaults: { w: 60, d: 20, h: 45, color: '#2b2e33' }, stack: true, image: 'screen' },
    'terminal': { label: '단말 자리(노트북+모니터)', group: '디지털', defaults: { w: 120, d: 60, h: 72, color: '#f2f2ee' }, support: false, table: true },
    'kiosk': { label: '스탠드형 키오스크', group: '디지털', defaults: { w: 55, d: 50, h: 150, color: '#e6e8eb' } },
    'tablet': { label: '태블릿 PC', group: '디지털', defaults: { w: 25, d: 16, h: 19, color: '#2b2e33' }, stack: true, image: 'screen' },
    'tv': { label: '스탠드형 TV', group: '디지털', defaults: { w: 124, d: 65, h: 165, color: '#2b2e33' }, image: 'screen' },
    // --- 전시 작품 (테이블·전시단 위에 올리면 자동으로 그 높이에 놓임) ---
    'paper': { label: '지류 작품', group: '전시 작품', defaults: { pw: 21, ph: 29.7, pose: 'stand', w: 21, d: 12, h: 30, color: '#5b4636' }, stack: true, image: 'art', derive: true },
    'book': { label: '책', group: '전시 작품', defaults: { pw: 15, ph: 22, thick: 2, pose: 'closed', w: 15, d: 22, h: 2, color: '#2f5d8a' }, stack: true, image: 'art', derive: true },
    'acrylic': { label: '아크릴 스탠드(POP)', group: '전시 작품', defaults: { pw: 21, ph: 29.7, w: 23, d: 9, h: 32, color: '#dfe7ef' }, stack: true, image: 'art', derive: true },
    'solid': { label: '입체 작품', group: '전시 작품', defaults: { form: 'cube', w: 20, d: 20, h: 20, color: '#e07a5f' }, stack: true },
    'vase': { label: '도자기·꽃병', group: '전시 작품', defaults: { w: 18, d: 18, h: 30, color: '#c9ada7' }, stack: true, round: true },
    'plant': { label: '화분', group: '전시 작품', defaults: { w: 30, d: 30, h: 60, color: '#b5651d' }, stack: true, round: true },
    'case': { label: '투명 아크릴 케이스', group: '전시 작품', defaults: { w: 40, d: 30, h: 35, color: '#3a3f47' }, stack: true, cover: true },
    'leaflet': { label: '리플릿 꽂이', group: '전시 작품', defaults: { w: 23, d: 16, h: 28, color: '#dfe7ef' }, stack: true },
    'nameplate': { label: '삼각 명패', group: '전시 작품', defaults: { w: 25, d: 7, h: 7, color: '#ffffff' }, stack: true },
    'person160': { label: '사람 160cm', group: '사람(스케일)', defaults: { w: 44, d: 24, h: 160, color: '#8d99ae' }, ghost: true },
    'person175': { label: '사람 175cm', group: '사람(스케일)', defaults: { w: 48, d: 26, h: 175, color: '#6c7a91' }, ghost: true },
  };

  /** 라이브러리 버튼 목록 — ui.js 의 [물품 추가] 탭에서 사용 (over: 기본값 덮어쓰기) */
  I.CATALOG = {
    digital: [
      { type: 'tablet', label: '태블릿 PC (거치대)', over: {} },
      { type: 'tv', label: '스탠드형 TV 55인치', over: { w: 122, h: 160, name: 'TV 55인치' } },
      { type: 'tv', label: '스탠드형 TV 65인치', over: { w: 144, h: 170, name: 'TV 65인치' } },
      { type: 'tv', label: '스탠드형 TV 75인치', over: { w: 166, h: 180, name: 'TV 75인치' } },
      { type: 'laptop', label: '노트북', over: {} },
      { type: 'monitor', label: '모니터', over: {} },
      { type: 'terminal', label: '단말 자리 (책상+노트북+모니터)', over: {} },
      { type: 'kiosk', label: '스탠드형 키오스크', over: {} },
    ],
    people: [
      { type: 'person160', label: '사람 실루엣 160cm', over: {} },
      { type: 'person175', label: '사람 실루엣 175cm', over: {} },
    ],
    display: [
      { type: 'shelf', label: '진열 선반 120×40×180', over: {} },
      { type: 'shelf', label: '낮은 진열장 90×40×90', over: { w: 90, d: 40, h: 90 } },
      { type: 'platform', label: '낮은 전시 단 120×60×40', over: {} },
      { type: 'pedestal', label: '좌대 40×40×90', over: {} },
      { type: 'box', label: '상자/소품', over: {} },
    ],
    // 전시 작품 — 입체·기타
    objects: [
      { type: 'solid', label: '정육면체', over: { form: 'cube', w: 20, d: 20, h: 20 } },
      { type: 'solid', label: '직육면체', over: { form: 'cube', w: 30, d: 15, h: 10, name: '직육면체' } },
      { type: 'solid', label: '구', over: { form: 'sphere', w: 20, d: 20, h: 20, color: '#81b29a', name: '구' } },
      { type: 'solid', label: '원기둥', over: { form: 'cylinder', w: 15, d: 15, h: 25, color: '#f2cc8f', name: '원기둥' } },
      { type: 'solid', label: '원뿔', over: { form: 'cone', w: 18, d: 18, h: 25, color: '#3d405b', name: '원뿔' } },
      { type: 'solid', label: '사각뿔(피라미드)', over: { form: 'pyramid', w: 20, d: 20, h: 18, color: '#e9c46a', name: '사각뿔' } },
      { type: 'solid', label: '고리(도넛)', over: { form: 'torus', w: 20, d: 20, h: 6, color: '#9d4edd', name: '고리' } },
      { type: 'vase', label: '도자기·꽃병', over: {} },
      { type: 'case', label: '투명 아크릴 케이스', over: {} },
      { type: 'leaflet', label: '리플릿 꽂이', over: {} },
      { type: 'nameplate', label: '삼각 명패', over: {} },
      { type: 'plant', label: '화분', over: {} },
    ],
  };

  /** 지류 작품 규격 (가로×세로 cm, 세로 방향 기준) */
  I.PAPER_SIZES = [
    ['A5', 14.8, 21], ['A4', 21, 29.7], ['A3', 29.7, 42], ['A2', 42, 59.4], ['A1', 59.4, 84.1], ['A0', 84.1, 118.9],
    ['8절', 27.2, 39.4], ['4절', 39.4, 54.5], ['사진 4×6', 10.2, 15.2],
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
    if (it.cloth) { // 원형 천 덮개
      cyl(g, r + 1, r + 1, 3, M.main, 0, h - 1.5, 0, 48);
      cyl(g, r + 1, r + 3, h - 7, M.main, 0, (h - 7) / 2 + 4, 0, 48);
      return;
    }
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

  /* --- 전시 작품 --------------------------------------------------- */
  const PAPER_TILT = U.rad(15), FRAME_TILT = U.rad(10), FRAME = 2.5;

  /** 작품 크기·놓는 방식 → 가로(w)·깊이(d)·높이(h) 자동 계산 */
  I.derive = function (it) {
    const pw = Math.max(1, it.pw || 1), ph = Math.max(1, it.ph || 1);
    if (it.type === 'paper') {
      if (it.pose === 'flat') { it.w = pw; it.d = ph; it.h = 0.3; }
      else if (it.pose === 'frame') {
        const H = ph + FRAME * 2;
        it.w = pw + FRAME * 2; it.d = r1(H * Math.sin(FRAME_TILT) + 7); it.h = r1(H * Math.cos(FRAME_TILT) + 0.5);
      } else { it.w = pw; it.d = r1(ph * Math.sin(PAPER_TILT) + 6); it.h = r1(ph * Math.cos(PAPER_TILT) + 1.5); }
    } else if (it.type === 'book') {
      const t = Math.max(0.3, it.thick || 2);
      if (it.pose === 'open') { it.w = pw * 2; it.d = ph; it.h = r1(t / 2 + 1); }
      else if (it.pose === 'stand') { it.w = pw + 2; it.d = 16; it.h = r1(ph * Math.cos(PAPER_TILT) + 2); }
      else { it.w = pw; it.d = ph; it.h = t; }
    } else if (it.type === 'acrylic') { it.w = pw + 2; it.d = 9; it.h = r1(ph + 2); }
  };
  const r1 = (v) => Math.round(v * 10) / 10;

  /** 앞면이 +z 인 얇은 판 (앞면에만 이미지) */
  function sheet(g, w, h, t, front, side, x, y, z) {
    return box(g, w, h, t, [side, side, side, side, front, side], x, y, z);
  }
  /** 바닥 뒤쪽으로 기울어진 그룹 (pivot: 아래 앞 모서리) */
  function tilted(g, tilt, z) {
    const t = new window.THREE.Group();
    t.position.set(0, 0, z); t.rotation.x = -tilt; g.add(t); return t;
  }

  function paper(g, it, M) {
    const pw = it.pw, ph = it.ph;
    if (it.pose === 'flat') {
      box(g, pw, 0.3, ph, [M.paper, M.paper, M.face, M.paper, M.paper, M.paper], 0, 0.15, 0);
      return;
    }
    if (it.pose === 'frame') {
      const H = ph + FRAME * 2, W = pw + FRAME * 2;
      const t = tilted(g, FRAME_TILT, it.d / 2 - 3);
      box(t, W, FRAME, 2.2, M.main, 0, FRAME / 2, 0);
      box(t, W, FRAME, 2.2, M.main, 0, H - FRAME / 2, 0);
      box(t, FRAME, H, 2.2, M.main, -W / 2 + FRAME / 2, H / 2, 0);
      box(t, FRAME, H, 2.2, M.main, W / 2 - FRAME / 2, H / 2, 0);
      sheet(t, pw, ph, 0.4, M.face, M.paper, 0, H / 2, -0.4);
      box(g, 2, H * 0.75, 1.2, M.main, 0, H * 0.33, -it.d / 2 + 2).rotation.x = U.rad(-12); // 뒷받침
      return;
    }
    // 탁상 거치대에 세움
    const t = tilted(g, PAPER_TILT, it.d / 2 - 3);
    sheet(t, pw, ph, 0.3, M.face, M.paper, 0, ph / 2 + 1.2, 0);
    box(t, pw * 0.9, 1.2, 3, M.stand, 0, 0.6, 1);           // 받침 턱
    box(g, Math.min(4, pw * 0.2), ph * 0.8, 1, M.stand, 0, ph * 0.38, -it.d / 2 + 2).rotation.x = U.rad(-14);
  }

  function book(g, it, M) {
    const pw = it.pw, ph = it.ph, th = Math.max(0.3, it.thick || 2);
    if (it.pose === 'open') {
      // 펼친 책: 두 면이 살짝 V 자
      for (const s of [-1, 1]) {
        const half = new window.THREE.Group();
        half.rotation.z = s * -0.05;
        g.add(half);
        box(half, pw, th / 2, ph, M.main, s * pw / 2, th / 4, 0);
        box(half, pw - 0.6, 0.3, ph - 0.6, [M.paper, M.paper, s < 0 ? M.faceL : M.faceR, M.paper, M.paper, M.paper], s * pw / 2, th / 2 + 0.15, 0);
      }
      return;
    }
    if (it.pose === 'stand') {
      // 북스탠드 + 세운 책
      box(g, pw * 0.8, 0.8, 14, M.stand, 0, 0.4, 0);
      const t = tilted(g, PAPER_TILT, 4);
      box(t, pw, ph, th, [M.paper, M.main, M.paper, M.paper, M.face, M.main], 0, ph / 2 + 1.5, -th / 2);
      box(t, pw * 0.9, 1.5, 3, M.stand, 0, 0.75, 1);
      box(g, 2, ph * 0.75, 1, M.stand, 0, ph * 0.36, -5).rotation.x = U.rad(-14);
      return;
    }
    // 덮은 책(눕힘): 윗면 = 표지
    box(g, pw, th, ph, [M.paper, M.main, M.face, M.main, M.paper, M.paper], 0, th / 2, 0);
  }

  function acrylic(g, it, M) {
    const pw = it.pw, ph = it.ph;
    box(g, it.w, 0.6, it.d, M.glass, 0, 0.3, 0);                // 바닥판
    const t = tilted(g, U.rad(8), 1);
    sheet(t, pw, ph, 0.2, M.face, M.paper, 0, ph / 2 + 1, -0.3);
    box(t, it.w, ph + 1.5, 0.3, M.glass, 0, (ph + 1.5) / 2 + 0.6, 0.4); // 앞 아크릴
  }

  function solid(g, it, M) {
    const THREE = window.THREE;
    let geo;
    switch (it.form) {
      case 'sphere': geo = new THREE.SphereGeometry(0.5, 32, 24); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
      case 'cone': geo = new THREE.ConeGeometry(0.5, 1, 32); break;
      case 'pyramid': geo = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4); geo.rotateY(Math.PI / 4); break;
      case 'torus': geo = new THREE.TorusGeometry(0.36, 0.14, 16, 40); geo.rotateX(Math.PI / 2); geo.scale(1, 3.5, 1); break;
      default: geo = new THREE.BoxGeometry(1, 1, 1);
    }
    const m = new THREE.Mesh(geo, M.main);
    m.scale.set(it.w, it.h, it.d); m.position.y = it.h / 2;
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  }

  function vase(g, it, M) {
    const THREE = window.THREE;
    const r = it.w / 2, h = it.h;
    const prof = [[0, 0], [0.62, 0], [0.8, 0.12], [1, 0.38], [0.86, 0.62], [0.45, 0.82], [0.42, 0.93], [0.55, 1]]
      .map(([x, y]) => new THREE.Vector2(x * r, y * h));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), M.main);
    m.material.side = THREE.DoubleSide;
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  }

  function plant(g, it, M) {
    const r = it.w / 2, h = it.h, potH = h * 0.32;
    cyl(g, r * 0.62, r * 0.48, potH, M.main, 0, potH / 2, 0, 24);
    cyl(g, r * 0.58, r * 0.58, 1, M.soil, 0, potH - 0.2, 0, 24);
    const leaf = M.leaf;
    const pts = [[0, 0.62, 0, 0.55], [-0.45, 0.5, 0.15, 0.42], [0.45, 0.52, -0.1, 0.42], [0.1, 0.78, -0.3, 0.4], [-0.15, 0.88, 0.25, 0.36], [0.2, 0.95, 0.15, 0.3]];
    for (const [x, y, z, s] of pts) {
      const m = new window.THREE.Mesh(new window.THREE.IcosahedronGeometry(r * s * 1.3, 1), leaf);
      m.position.set(x * r, y * h, z * r); m.castShadow = true; g.add(m);
    }
  }

  function glassCase(g, it, M) {
    const THREE = window.THREE;
    box(g, it.w, 3, it.d, M.main, 0, 1.5, 0);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h - 3, it.d), M.glass);
    gl.position.y = 3 + (it.h - 3) / 2; gl.renderOrder = 5; g.add(gl);
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(gl.geometry), new THREE.LineBasicMaterial({ color: '#9fb3c8', transparent: true, opacity: 0.8 }));
    ed.position.copy(gl.position); ed.userData.noPick = true; g.add(ed);
  }

  function leaflet(g, it, M) {
    const { w, d, h } = it;
    box(g, w, 0.6, d, M.glass, 0, 0.3, 0);
    const cols = ['#f4a261', '#2a9d8f', '#e9c46a'];
    for (let i = 0; i < 3; i++) {
      const z = d / 2 - 2 - i * (d - 4) / 3, ph = h * (0.55 + i * 0.2);
      box(g, w - 2, ph * 0.9, 0.3, std(cols[i], 0.8), 0, ph * 0.45 + 0.6, z - 1);
      box(g, w, ph * 0.5, 0.3, M.glass, 0, ph * 0.25 + 0.6, z);
    }
    box(g, w, h, 0.3, M.glass, 0, h / 2, -d / 2 + 0.2);
  }

  function nameplate(g, it, M) {
    const THREE = window.THREE;
    const r = Math.max(it.h, it.d) / 1.5;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, it.w, 3), M.main);
    m.rotation.z = Math.PI / 2; m.rotation.x = Math.PI / 2;
    m.scale.set(1, 1, 1);
    m.position.y = r * 0.5;
    m.castShadow = true; g.add(m);
  }

  function tablet(g, it, M) {
    const { w, d, h } = it;
    box(g, w * 0.5, 1, d * 0.8, M.stand, 0, 0.5, 0);
    const sh = Math.min(h / Math.cos(0.35), w * 0.72);
    const t = tilted(g, 0.35, d / 2 - 4);
    box(t, w, sh, 0.8, [M.main, M.main, M.main, M.main, M.face, M.main], 0, sh / 2 + 1, 0);
    box(g, 3, h * 0.7, 1, M.stand, 0, h * 0.35, -d / 2 + 3).rotation.x = -0.35;
  }

  function tv(g, it, M) {
    const { w, d, h } = it;
    const sh = w * 9 / 16, bez = 1.2;
    const cy = h - sh / 2 - bez;
    // 바퀴 달린 받침 + 기둥 2개
    box(g, w * 0.55, 4, 6, M.stand, 0, 8, 0);
    for (const s of [-1, 1]) {
      box(g, 6, 3, d, M.stand, s * w * 0.25, 6, 0);
      for (const z of [-1, 1]) cyl(g, 2.5, 2.5, 3, M.dark, s * w * 0.25, 2.5, z * (d / 2 - 4), 12).rotation.x = Math.PI / 2;
      box(g, 5, cy, 4, M.stand, s * w * 0.18, cy / 2 + 6, -8);
    }
    box(g, w + bez * 2, sh + bez * 2, 5, M.main, 0, cy, -3);
    sheet(g, w, sh, 0.3, M.face, M.main, 0, cy, -0.4);
  }

  const BUILD = {
    'table-rect': tableRect, 'table-square': tableRect, 'table-round': tableRound,
    chair, stool, shelf, platform: blockItem, pedestal: blockItem, box: plainBox,
    laptop: (g, it, M) => laptop(g, it, M), monitor: (g, it, M) => monitor(g, it, M),
    terminal, kiosk, person160: person, person175: person,
    tablet, tv, paper, book, acrylic, solid, vase, plant, case: glassCase, leaflet, nameplate,
  };

  /* --- 작품/화면 이미지 텍스처 ------------------------------------------ */
  /**
   * 이미지(asset)를 cmW×cmH 비율 캔버스에 그린 재질. 이미지가 없으면 자리표시.
   * kind: 'art'(종이, 흰 바탕) | 'screen'(화면, 꺼진 화면색)
   */
  function faceMaterial(it, cmW, cmH, kind) {
    const THREE = window.THREE;
    const img = it.img ? BS.assetImage(it.img) : null;
    if (!img && kind === 'screen') {
      return new THREE.MeshStandardMaterial({ color: '#0d1b2a', roughness: 0.25, emissive: '#1b3a5c', emissiveIntensity: 0.6 });
    }
    const long = kind === 'art' ? 2048 : 1024;
    const ppc = long / Math.max(cmW, cmH, 1);
    const cv = document.createElement('canvas');
    cv.width = Math.max(8, Math.round(cmW * ppc)); cv.height = Math.max(8, Math.round(cmH * ppc));
    const ctx = cv.getContext('2d');
    if (img) {
      BS.panels.drawCell(ctx, { mode: 'image', img: it.img, fit: it.fit || (kind === 'screen' ? 'cover' : 'contain'), bg: kind === 'screen' ? '#000000' : '#ffffff' }, 0, 0, cv.width, cv.height, ppc, cmW, cmH);
    } else {
      ctx.fillStyle = '#fbfbf8'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#d8dce1'; ctx.lineWidth = Math.max(2, cv.width * 0.01);
      ctx.strokeRect(cv.width * 0.06, cv.height * 0.06, cv.width * 0.88, cv.height * 0.88);
      ctx.fillStyle = '#9aa3ad'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.min(cv.width, cv.height) * 0.08}px ${BS.FONT}`;
      ctx.fillText('작품 이미지', cv.width / 2, cv.height / 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = BS.scene.maxAniso;
    return new THREE.MeshStandardMaterial({
      map: tex, roughness: kind === 'screen' ? 0.3 : 0.85,
      emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: kind === 'screen' ? 0.75 : 0.25,
    });
  }

  /** 이미지 면의 실제 크기(cm) */
  function faceSize(it) {
    switch (it.type) {
      case 'paper': case 'acrylic': return [it.pw, it.ph];
      case 'book': return it.pose === 'open' ? [it.pw * 2, it.ph] : [it.pw, it.ph];
      case 'tv': return [it.w, it.w * 9 / 16];
      case 'tablet': return [it.w, it.w * 0.72];
      case 'laptop': return [it.w, it.d];
      case 'monitor': return [it.w, it.h * 0.5];
      case 'kiosk': return [it.w, it.h * 0.34];
      default: return [it.w, it.h];
    }
  }

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
    M.paper = std('#f7f6f2', 0.9);
    M.stand = std('#c9ced4', 0.4, 0.3);
    M.dark = std('#222222', 0.7);
    M.soil = std('#4a3728', 1);
    M.leaf = std('#4f8a3c', 0.85);
    M.glass = new THREE.MeshStandardMaterial({ color: '#dff1ff', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false });
    const def = I.LIB[it.type] || {};
    if (def.image) {
      const [fw, fh] = faceSize(it);
      M.face = faceMaterial(it, fw, fh, def.image);
      if (def.image === 'screen') { M.screen = M.face; M.dev.screen = M.face; }
      if (it.type === 'book' && it.pose === 'open') {
        // 펼친 책: 한 장의 이미지를 왼쪽/오른쪽 면으로 나눠 붙임
        const L = M.face.clone(), R = M.face.clone();
        for (const [m, off] of [[L, 0], [R, 0.5]]) {
          if (!m.map) continue;
          const t = m.map.clone(); t.repeat.set(0.5, 1); t.offset.set(off, 0); t.needsUpdate = true;
          m.map = t; m.emissiveMap = t;
        }
        M.faceL = L; M.faceR = R;
      }
    }
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

  const geoKey = (it) => JSON.stringify([it.type, it.w, it.d, it.h, it.color, !!it.cloth, it.pw, it.ph, it.thick, it.pose, it.form,
    it.img || null, it.fit || null, !!(it.img && BS.assetImage(it.img))]);

  /** 업로드 이미지 로드가 끝나면 그 이미지를 쓰는 물품 다시 만들기 */
  BS.on('assetLoaded', (id) => { if (BS.state.items.some((i) => i.img === id)) I.sync(); });

  /* ---------------------------------------------------------------
   * 3. 상태 → 3D 동기화
   * ------------------------------------------------------------- */
  I.sync = function () {
    const S = BS.scene;
    const alive = new Set();
    for (const it of BS.state.items) {
      alive.add(it.id);
      if (I.LIB[it.type] && I.LIB[it.type].round) it.d = it.w; // 원형은 지름 하나
      if (I.LIB[it.type] && I.LIB[it.type].derive) I.derive(it); // 작품 크기 → 가로·깊이·높이
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

  const OUTSIDE = I.OUTSIDE_MSG = '부스 밖으로 나감';

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
      if (a.e.allowOutside) continue; // 사용자가 '부스 밖 허용'으로 무시한 물건
      if (a.fp.some((p) => p.x < -W - 0.3 || p.x > W + 0.3 || p.z < -D - 0.3 || p.z > D + 0.3)) add(a.e.id, OUTSIDE);
    }
    for (let i = 0; i < info.length; i++) {
      for (let j = i + 1; j < info.length; j++) {
        const a = info[i], c = info[j];
        if (a.def.ghost || c.def.ghost) continue;
        // 의자는 테이블 아래로 넣을 수 있음
        if ((a.def.chair && c.def.table) || (c.def.chair && a.def.table)) continue;
        // 투명 케이스 안에 넣은 작품
        if ((a.def.cover && c.def.stack) || (c.def.cover && a.def.stack)) continue;
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
