/* =====================================================================
 * panels.js — 현수막(벽 부착) · 자유 패널(배너/입간판/이젤) 시스템
 * ---------------------------------------------------------------------
 *  - 현수막 하나 = 칸(cols × rows) 들의 모음. 칸마다 이미지/텍스트/단색/빈칸.
 *  - 모든 칸을 캔버스 한 장(긴 변 ≥ 2048px)에 그려 텍스처로 입힘.
 *  - 벽 부착: 벽 좌표 (u = 왼쪽 끝 거리, y = 하단 높이)
 *  - 자유 패널: 바닥 좌표 (x, z, rot) + 거치대 종류(stand)
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const P = BS.panels = { map: new Map() }; // id → { group, board, geoKey, texKey, canvas }

  /** 자유 패널 거치대 종류 */
  P.STANDS = {
    board: { label: '패널(받침발)', foot: 36, y: 3 },
    rollup: { label: '롤업 배너', foot: 30, y: 9 },
    xbanner: { label: 'X배너(독립형)', foot: 44, y: 6 },
    sign: { label: '입간판', foot: 42, y: 45 },
    easel: { label: '이젤 위 작품', foot: 62, y: 72 },
  };
  P.footDepth = (p) => (P.STANDS[p.stand] || P.STANDS.board).foot;

  /* ---------------------------------------------------------------
   * 1. 캔버스에 현수막 내용 그리기
   * ------------------------------------------------------------- */
  /** px/cm 결정: 긴 변 최소 2048px, 최대 기기 한계·4096px */
  P.pxPerCm = function (p) {
    const long = Math.max(p.w, p.h, 1);
    const maxTex = Math.min(4096, BS.scene.maxTex || 4096);
    return Math.max(2048 / long, Math.min(10, maxTex / long));
  };

  P.drawCanvas = function (p, ppcOverride) {
    const ppc = ppcOverride || P.pxPerCm(p);
    const cv = document.createElement('canvas');
    cv.width = Math.max(8, Math.round(p.w * ppc));
    cv.height = Math.max(8, Math.round(p.h * ppc));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);

    const cols = Math.max(1, p.cols | 0), rows = Math.max(1, p.rows | 0);
    const cw = cv.width / cols, ch = cv.height / rows;
    const cellW = p.w / cols, cellH = p.h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = p.cells[r * cols + c] || BS.defaults.cell({ mode: 'empty' });
        ctx.save();
        ctx.beginPath(); ctx.rect(c * cw, r * ch, cw, ch); ctx.clip();
        drawCell(ctx, cell, c * cw, r * ch, cw, ch, ppc, cellW, cellH);
        ctx.restore();
      }
    }
    // 칸 구분선
    if (p.divider && (cols > 1 || rows > 1) && p.dividerWidth > 0) {
      ctx.strokeStyle = p.dividerColor || '#ffffff';
      ctx.lineWidth = Math.max(1, p.dividerWidth * ppc);
      ctx.beginPath();
      for (let c = 1; c < cols; c++) { ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, cv.height); }
      for (let r = 1; r < rows; r++) { ctx.moveTo(0, r * ch); ctx.lineTo(cv.width, r * ch); }
      ctx.stroke();
    }
    // 테두리
    if (p.border > 0) {
      const bw = p.border * ppc;
      ctx.strokeStyle = p.frameColor || '#333';
      ctx.lineWidth = bw;
      ctx.strokeRect(bw / 2, bw / 2, cv.width - bw, cv.height - bw);
    }
    return cv;
  };

  /** 칸 하나 그리기 */
  function drawCell(ctx, cell, x, y, w, h, ppc, cmW, cmH) {
    const mode = cell.mode || 'empty';
    if (mode === 'empty') {
      ctx.fillStyle = '#eef1f4'; ctx.fillRect(x, y, w, h);
      // 빗금
      ctx.strokeStyle = 'rgba(120,130,145,0.18)'; ctx.lineWidth = Math.max(1, 0.4 * ppc);
      const stp = 8 * ppc;
      ctx.beginPath();
      for (let k = -h; k < w; k += stp) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
      ctx.stroke();
      ctx.fillStyle = '#8792a0';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.min(w, h) * 0.09;
      ctx.font = `600 ${fs}px ${BS.FONT}`;
      ctx.fillText('빈 칸', x + w / 2, y + h / 2 - fs * 0.7);
      ctx.font = `400 ${fs * 0.75}px ${BS.FONT}`;
      ctx.fillText(`${U.fmt(cmW)} × ${U.fmt(cmH)} cm`, x + w / 2, y + h / 2 + fs * 0.6);
      return;
    }
    ctx.fillStyle = cell.bg || '#ffffff';
    ctx.fillRect(x, y, w, h);
    if (mode === 'color') return;

    if (mode === 'image') {
      const img = BS.assetImage(cell.img);
      if (!img) {
        ctx.fillStyle = '#9aa3ad'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.min(w, h) * 0.07}px ${BS.FONT}`;
        ctx.fillText(cell.img ? '이미지 불러오는 중…' : '이미지를 올려주세요', x + w / 2, y + h / 2);
        return;
      }
      const iw = img.naturalWidth, ih = img.naturalHeight;
      let dw = w, dh = h;
      if (cell.fit === 'contain') { const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s; }
      else if (cell.fit === 'cover') { const s = Math.max(w / iw, h / ih); dw = iw * s; dh = ih * s; }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return;
    }

    // --- 텍스트 ---
    const pad = Math.min(w, h) * 0.07;
    const maxW = w - pad * 2;
    const tfs = Math.max(4, (cell.titleSize || 8) * ppc);
    const bfs = Math.max(4, (cell.bodySize || 4) * ppc);
    const tLines = cell.title ? wrap(ctx, cell.title, `800 ${tfs}px ${BS.FONT}`, maxW) : [];
    const bLines = cell.body ? wrap(ctx, cell.body, `400 ${bfs}px ${BS.FONT}`, maxW) : [];
    const tLH = tfs * 1.22, bLH = bfs * 1.45, gap = (tLines.length && bLines.length) ? tfs * 0.6 : 0;
    const total = tLines.length * tLH + gap + bLines.length * bLH;
    let cy = y + Math.max(pad, (h - total) / 2);
    const al = cell.align || 'center';
    const tx = al === 'left' ? x + pad : al === 'right' ? x + w - pad : x + w / 2;
    ctx.textAlign = al; ctx.textBaseline = 'top';
    ctx.fillStyle = cell.color || '#111';
    ctx.font = `800 ${tfs}px ${BS.FONT}`;
    for (const ln of tLines) { ctx.fillText(ln, tx, cy + tfs * 0.08); cy += tLH; }
    cy += gap;
    ctx.font = `400 ${bfs}px ${BS.FONT}`;
    for (const ln of bLines) { ctx.fillText(ln, tx, cy + bfs * 0.1); cy += bLH; }
  }
  P.drawCell = drawCell;

  /** 줄바꿈 (한글은 글자 단위, 영문은 단어 단위) */
  function wrap(ctx, text, font, maxW) {
    ctx.font = font;
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      const tokens = para.match(/[A-Za-z0-9.,!?'"()\-:;/]+\s*|\s+|./g) || [];
      let line = '';
      for (const tk of tokens) {
        const test = line + tk;
        if (ctx.measureText(test).width > maxW && line) {
          out.push(line.trimEnd());
          line = tk.trimStart();
          // 한 토큰이 너무 길면 글자 단위로 자르기
          while (ctx.measureText(line).width > maxW && line.length > 1) {
            let i = line.length - 1;
            while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
            out.push(line.slice(0, i)); line = line.slice(i);
          }
        } else line = test;
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  /* ---------------------------------------------------------------
   * 2. 3D 메시 만들기
   * ------------------------------------------------------------- */
  const MAT = {};
  function metal() {
    return MAT.metal || (MAT.metal = new window.THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.4, metalness: 0.6 }));
  }
  function dark() {
    return MAT.dark || (MAT.dark = new window.THREE.MeshStandardMaterial({ color: '#2f3338', roughness: 0.6 }));
  }
  function wood() {
    return MAT.wood || (MAT.wood = new window.THREE.MeshStandardMaterial({ color: '#a7774a', roughness: 0.75 }));
  }

  /** 기하 변경 감지용 키 */
  const geoKey = (p) => JSON.stringify([p.w, p.h, p.thick, p.frameColor, p.mount, p.stand, p.mount === 'free' ? p.y : 0]);
  const texKey = (p) => JSON.stringify([p.w, p.h, p.cols, p.rows, p.cells, p.border, p.frameColor, p.divider, p.dividerColor, p.dividerWidth]);

  function buildPanel(p, rec) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData.entId = p.id;

    // 판(board): 원점 = 판 중심의 "뒷면"(벽 쪽). 앞면이 +z
    const board = new THREE.Group();
    const th = Math.max(0.2, p.thick);
    const side = new THREE.MeshStandardMaterial({ color: p.frameColor, roughness: 0.6 });
    const front = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, emissive: '#ffffff', emissiveIntensity: 0.28 });
    const back = new THREE.MeshStandardMaterial({ color: '#d5d8dc', roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, th), [side, side, side, side, front, back]);
    body.position.z = th / 2;
    body.castShadow = true; body.receiveShadow = true;
    board.add(body);

    // 선택/경고 외곽선
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w + 1.2, p.h + 1.2, th + 1.2)),
      new THREE.LineBasicMaterial({ color: '#1e88ff', depthTest: false, transparent: true })
    );
    edge.position.z = th / 2; edge.visible = false; edge.renderOrder = 15; edge.userData.noPick = true;
    board.add(edge);
    // 경고 덮개(반투명 빨강)
    const warn = new THREE.Mesh(
      new THREE.PlaneGeometry(p.w, p.h),
      new THREE.MeshBasicMaterial({ color: '#ff2d20', transparent: true, opacity: 0.28, depthWrite: false })
    );
    warn.position.z = th + 0.15; warn.visible = false; warn.userData.noPick = true;
    board.add(warn);

    group.add(board);
    rec.board = board; rec.body = body; rec.front = front; rec.side = side; rec.edge = edge; rec.warn = warn;

    if (p.mount === 'free') buildStand(p, group, board);
    return group;
  }

  /** 자유 패널 거치대 */
  function buildStand(p, group, board) {
    const THREE = window.THREE;
    const w = p.w, h = p.h, y = p.y;
    const add = (geo, mat, x, yy, z, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, yy, z); m.rotation.x = rx; m.rotation.z = rz;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); return m;
    };
    const cyl = (r, len) => new THREE.CylinderGeometry(r, r, len, 10);
    /** 두 점을 잇는 막대 */
    const rod = (a, b, r, mat) => {
      const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
      const len = A.distanceTo(Bv);
      const m = new THREE.Mesh(cyl(r, len), mat);
      m.position.copy(A).add(Bv).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize());
      m.castShadow = true; group.add(m); return m;
    };

    let zOff = 0, tilt = 0;
    switch (p.stand) {
      case 'rollup':
        add(new THREE.BoxGeometry(w + 6, 9, 22), metal(), 0, 4.5, 0);
        rod([0, 9, -4], [0, y + h, -4], 1, metal());
        zOff = -1; break;
      case 'xbanner':
        rod([-w / 2 + 2, y + h - 2, -3], [w / 2 - 2, y + 2, -3], 0.8, dark());
        rod([w / 2 - 2, y + h - 2, -3], [-w / 2 + 2, y + 2, -3], 0.8, dark());
        rod([0, y + h * 0.45, -3], [0, 0, -3], 1, dark());
        [[-18, 14], [18, 14], [0, -20]].forEach(([fx, fz]) => rod([0, 22, -3], [fx, 0, fz], 0.8, dark()));
        break;
      case 'sign':
        [-1, 1].forEach((s) => {
          add(new THREE.BoxGeometry(3, y + h + 4, 3), wood(), s * (w / 2 + 1.5), (y + h + 4) / 2, 0);
          add(new THREE.BoxGeometry(5, 3, 40), wood(), s * (w / 2 + 1.5), 1.5, 0);
        });
        add(new THREE.BoxGeometry(w + 6, 3, 2), wood(), 0, y - 1.5, 0);
        break;
      case 'easel': {
        tilt = -0.14;
        const top = y + h + 12;
        rod([-w * 0.36, 0, 16], [-w * 0.08, top, -2], 1.4, wood());
        rod([w * 0.36, 0, 16], [w * 0.08, top, -2], 1.4, wood());
        rod([0, 0, -44], [0, top - 4, -4], 1.3, wood());
        add(new THREE.BoxGeometry(w * 0.86, 2.4, 7), wood(), 0, y - 1.2, 4);
        zOff = 0.5; break;
      }
      default: // board: 받침발 두 개
        [-1, 1].forEach((s) => add(new THREE.BoxGeometry(5, 4, 36), dark(), s * (w / 2 - 8), 2, 0));
    }
    board.position.set(0, y + h / 2, zOff - p.thick / 2);
    board.rotation.x = tilt;
  }

  /** 위치 반영 (벽 / 바닥) */
  /**
   * 같은 벽에서 겹친 현수막은 작은 것이 앞(위)에 붙는다. [맨 앞으로]를 누른
   * 현수막(front 값이 큰 것)은 크기와 상관없이 더 앞에.
   * → 서로 깜빡이며 섞여 보이지 않게, 현수막 위에 덧붙인 현수막 표현.
   * @returns { id: 벽에서 띄울 거리(cm) }
   */
  P.wallOffsets = function () {
    const off = {};
    const ps = BS.state.panels.filter((p) => p.mount === 'wall' && !p.hidden)
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.front || 0) - (b.p.front || 0) || b.p.w * b.p.h - a.p.w * a.p.h || a.i - b.i)
      .map((x) => x.p);
    ps.forEach((p, i) => {
      let o = 0.15;
      for (let j = 0; j < i; j++) {
        const q = ps[j];
        if (q.wall === p.wall && P.overlapRect(p, q)) o = Math.max(o, off[q.id] + Math.max(0.2, q.thick) + 0.1);
      }
      off[p.id] = o;
    });
    return off;
  };
  P.overlapRect = (p, q) => p.u < q.u + q.w - 0.05 && q.u < p.u + p.w - 0.05 && p.y < q.y + q.h - 0.05 && q.y < p.y + p.h - 0.05;

  P.place = function (p, group, offsets) {
    if (p.mount === 'wall') {
      const info = BS.booth.wallInfo(p.wall);
      const off = (offsets || P.wallOffsets())[p.id] || 0.15;
      const c = BS.booth.wallToWorld(info, p.u + p.w / 2, p.y + p.h / 2, off);
      group.position.copy(c);
      group.rotation.set(0, Math.atan2(info.n.x, info.n.z), 0);
      const rec = P.map.get(p.id);
      if (rec) rec.board.position.set(0, 0, 0);
    } else {
      group.position.set(p.x, 0, p.z);
      group.rotation.set(0, U.rad(p.rot || 0), 0);
    }
    group.visible = !p.hidden;
  };

  /* ---------------------------------------------------------------
   * 3. 상태 → 3D 동기화
   * ------------------------------------------------------------- */
  P.sync = function () {
    const THREE = window.THREE;
    const S = BS.scene;
    const alive = new Set();
    const offs = P.wallOffsets();
    for (const p of BS.state.panels) {
      BS.defaults.fitCells(p);
      alive.add(p.id);
      let rec = P.map.get(p.id);
      const gk = geoKey(p);
      if (!rec || rec.geoKey !== gk) {
        if (rec) { S.panelGroup.remove(rec.group); S.disposeObj(rec.group); }
        rec = { geoKey: gk, texKey: null };
        rec.group = buildPanel(p, rec);
        S.panelGroup.add(rec.group);
        P.map.set(p.id, rec);
      }
      const tk = texKey(p);
      if (rec.texKey !== tk || rec.needsTex) {
        rec.texKey = tk; rec.needsTex = false;
        const cv = P.drawCanvas(p);
        rec.canvas = cv;
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = S.maxAniso;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        if (rec.front.map) rec.front.map.dispose();
        rec.front.map = tex; rec.front.emissiveMap = tex;
        rec.front.needsUpdate = true;
      }
      rec.ent = p;
      P.place(p, rec.group, offs);
    }
    for (const [id, rec] of P.map) {
      if (!alive.has(id)) { S.panelGroup.remove(rec.group); S.disposeObj(rec.group); P.map.delete(id); }
    }
    S.requestRender();
  };

  /** 업로드 이미지 로드 완료 시 해당 현수막 텍스처 다시 그림 */
  BS.on('assetLoaded', (id) => {
    let any = false;
    for (const p of BS.state.panels) {
      if (p.cells.some((c) => c.img === id)) { const r = P.map.get(p.id); if (r) { r.needsTex = true; any = true; } }
    }
    if (any) { P.sync(); BS.emit('panelTexture'); }
  });

  /* ---------------------------------------------------------------
   * 4. 경고 판정: 벽 밖으로 나감 / 같은 벽 현수막끼리 겹침
   * ------------------------------------------------------------- */
  P.evaluate = function () {
    const res = {};
    const wallPanels = BS.state.panels.filter((p) => p.mount === 'wall' && !p.hidden);
    const infos = {};
    for (const k of BS.WALL_KEYS) infos[k] = BS.booth.wallInfo(k);
    for (const p of wallPanels) {
      const inf = infos[p.wall];
      const msgs = [];
      if (!inf.on) msgs.push('벽이 꺼져 있음');
      if (p.u < -0.05 || p.u + p.w > inf.len + 0.05 || p.y < -0.05 || p.y + p.h > inf.h + 0.05) msgs.push('벽 밖으로 나감');
      for (const q of wallPanels) {
        if (q === p || q.wall !== p.wall) continue;
        if (p.allowOverlap || q.allowOverlap) continue; // 현수막 위에 덧붙인 현수막 (겹침 허용)
        if (P.overlapRect(p, q)) {
          msgs.push(`"${q.name}"와 겹침`); break;
        }
      }
      if (msgs.length) res[p.id] = msgs;
    }
    return res;
  };

  /** 선택/경고 표시 갱신 */
  P.setStatus = function (id, selected, warn) {
    const rec = P.map.get(id);
    if (!rec) return;
    rec.edge.visible = selected || warn;
    rec.edge.material.color.set(warn ? '#ff2d20' : '#1e88ff');
    rec.warn.visible = warn;
    rec.side.emissive.set(warn ? '#ff2d20' : selected ? '#1e88ff' : '#000000');
    rec.side.emissiveIntensity = warn ? 0.7 : selected ? 0.45 : 0;
  };

  /* ---------------------------------------------------------------
   * 5. 벽 위 드래그: 스냅 + 벽 안으로 제한
   * ------------------------------------------------------------- */
  P.constrainWall = function (p, u, y, snapStep) {
    const inf = BS.booth.wallInfo(p.wall);
    const TH = Math.max(4, snapStep || 0);
    let su = null, sy = null, bestU = TH, bestY = TH;
    const candU = [0, inf.len - p.w, (inf.len - p.w) / 2];
    const candY = [0, inf.h - p.h];
    for (const q of BS.state.panels) {
      if (q === p || q.mount !== 'wall' || q.wall !== p.wall || q.hidden) continue;
      candU.push(q.u + q.w, q.u - p.w, q.u, q.u + q.w - p.w);
      candY.push(q.y, q.y + q.h, q.y - p.h, q.y + q.h - p.h);
    }
    for (const c of candU) { const d = Math.abs(u - c); if (d < bestU) { bestU = d; su = c; } }
    for (const c of candY) { const d = Math.abs(y - c); if (d < bestY) { bestY = d; sy = c; } }
    u = su !== null ? su : U.snap(u, snapStep);
    y = sy !== null ? sy : U.snap(y, snapStep);
    u = inf.len >= p.w ? U.clamp(u, 0, inf.len - p.w) : 0;
    y = inf.h >= p.h ? U.clamp(y, 0, inf.h - p.h) : 0;
    return { u, y };
  };

  /* ---------------------------------------------------------------
   * 6. 프리셋: 연구학교 5개교 현수막 (2열 × 3행, 칸당 100×70)
   * ------------------------------------------------------------- */
  P.presetResearchSchools = function (over) {
    const names = ['○○초등학교', '△△초등학교', '□□중학교', '◇◇중학교', '☆☆고등학교'];
    const palette = ['#1f4e8c', '#2f7d4f', '#8a3f8f', '#b5541c', '#1f6f80'];
    const cells = names.map((n, i) => BS.defaults.cell({
      mode: 'text', title: n, body: '연구학교 · 연구 주제를 입력하세요',
      titleSize: 9, bodySize: 4, color: '#ffffff', bg: palette[i], align: 'center',
    }));
    cells.push(BS.defaults.cell({ mode: 'empty' }));
    return BS.defaults.panel(Object.assign({
      name: '연구학교 5개교 현수막', mount: 'wall', wall: 'back',
      w: 200, h: 210, cols: 2, rows: 3, cells,
      divider: true, dividerColor: '#ffffff', dividerWidth: 1.5,
      border: 1, frameColor: '#2b2f36', thick: 1,
    }, over || {}));
  };
})(window.BS);
