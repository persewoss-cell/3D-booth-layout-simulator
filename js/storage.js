/* =====================================================================
 * storage.js — 자동 저장 · JSON 내보내기/불러오기 · 스크린샷 ·
 *              평면도(PNG/PDF) · 물품 목록(CSV) · 이미지/PDF 업로드 처리
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const ST = BS.storage = {};
  const KEY = 'boothSimulator.v1';
  const CDN = {
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  };

  /* ---------------------------------------------------------------
   * 1. localStorage 자동 저장
   * ------------------------------------------------------------- */
  function payload(includeAssets = true, withCloud = false) {
    const s = BS.state;
    return {
      app: 'booth-simulator', version: 1, savedAt: new Date().toISOString(),
      title: s.title, booth: s.booth, panels: s.panels, items: s.items, settings: s.settings,
      assets: includeAssets ? BS.usedAssets() : {},
      // 브라우저 자동저장에만: 연결된 클라우드 배치 정보 (JSON 내보내기에는 넣지 않음)
      cloud: withCloud && BS.cloud ? BS.cloud.meta() : undefined,
    };
  }

  let warnedQuota = false;
  ST.saveLocal = function () {
    if (!BS.app.hasDoc) return; // 열린 배치가 없으면 저장하지 않음
    try {
      localStorage.setItem(KEY, JSON.stringify(payload(true, true)));
      BS.emit('saved', true);
    } catch (err) {
      // 이미지 용량 초과 시 이미지 없이라도 저장
      try {
        localStorage.setItem(KEY, JSON.stringify(payload(false, true)));
        if (!warnedQuota) {
          warnedQuota = true;
          BS.toast('이미지 용량이 커서 브라우저 자동저장에서 이미지가 빠졌습니다. [파일] 탭에서 JSON으로 내보내 보관하세요.', 'warn', 6000);
        }
        BS.emit('saved', 'partial');
      } catch (e2) { BS.emit('saved', false); }
    }
  };
  ST.autosave = U.debounce(ST.saveLocal, 600);

  ST.loadLocal = function () {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const o = JSON.parse(raw);
      const ok = ST.applyPayload(o, true);
      if (ok && BS.cloud) BS.cloud.restoreMeta(o.cloud);
      return ok;
    } catch (e) { console.warn(e); return false; }
  };

  ST.clearLocal = function () { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } };

  /** 저장 데이터 → 상태 (구버전/누락 필드 보정) */
  ST.applyPayload = function (o, silent) {
    if (!o || !o.booth) { if (!silent) BS.toast('올바른 부스 파일이 아닙니다', 'error'); return false; }
    const b = Object.assign(BS.defaults.booth(o.booth.shape || 'U', o.booth.width, o.booth.depth, o.booth.height), o.booth);
    for (const k of BS.WALL_KEYS) b.walls[k] = Object.assign(BS.defaults.wall(false, 100, 240), (o.booth.walls || {})[k] || {});
    BS.state.title = o.title || BS.state.title;
    BS.state.booth = b;
    BS.state.panels = (o.panels || []).map((p) => {
      const q = BS.defaults.panel(p);
      q.cells = (q.cells || []).map((c) => BS.defaults.cell(c));
      return BS.defaults.fitCells(q);
    });
    BS.state.items = (o.items || []).map((i) => BS.defaults.item(i.type, i));
    BS.state.settings = Object.assign(BS.defaults.settings(), o.settings || {});
    BS.assets = Object.assign({}, o.assets || {});
    return true;
  };

  /* ---------------------------------------------------------------
   * 2. JSON 파일 내보내기 / 불러오기
   * ------------------------------------------------------------- */
  ST.exportJSON = function () {
    const data = JSON.stringify(payload(true), null, 1);
    U.download(`booth-layout_${U.dateStamp()}.json`, data, 'application/json');
    BS.toast('JSON 파일로 저장했습니다 (업로드 이미지 포함)');
  };

  ST.importJSON = function (file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const o = JSON.parse(fr.result);
        if (!ST.applyPayload(o)) return;
        BS.app.select(null);
        BS.app.rebuildAll();
        BS.app.setDoc(true);
        BS.app.commit();
        BS.ui.renderAll();
        BS.scene.setView('diag');
        ST.saveLocal();
        BS.toast(`"${file.name}" 불러오기 완료`);
      } catch (e) { BS.toast('JSON 을 읽을 수 없습니다: ' + e.message, 'error'); }
    };
    fr.readAsText(file);
  };

  /* ---------------------------------------------------------------
   * 3. 스크린샷 (현재 3D 뷰 PNG)
   * ------------------------------------------------------------- */
  ST.screenshot = function () {
    const url = BS.scene.capture();
    U.downloadDataURL(`booth-screenshot_${U.dateStamp()}.png`, url);
    BS.toast('스크린샷을 저장했습니다');
  };

  /* ---------------------------------------------------------------
   * 4. 이미지/PDF 업로드 → dataURL (긴 변 최대 2400px 로 축소)
   * ------------------------------------------------------------- */
  ST.readImageFile = async function (file) {
    const MAX = 2400;
    let canvas;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      canvas = await renderPdfFirstPage(file, MAX);
    } else {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 열 수 없습니다')); i.src = url; });
        const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * s); canvas.height = Math.round(img.naturalHeight * s);
        const ctx = canvas.getContext('2d');
        if (file.type !== 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } finally { URL.revokeObjectURL(url); }
    }
    const isPng = file.type === 'image/png';
    let data = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9);
    if (isPng && data.length > 2.5e6) data = canvas.toDataURL('image/jpeg', 0.9); // 너무 크면 JPG
    return { dataURL: data, w: canvas.width, h: canvas.height };
  };

  async function renderPdfFirstPage(file, MAX) {
    BS.toast('PDF 첫 페이지를 이미지로 변환하는 중…');
    if (!window.pdfjsLib) await U.loadScript(CDN.pdfjs);
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF 라이브러리를 불러오지 못했습니다(인터넷 연결 확인)');
    lib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = MAX / Math.max(v1.width, v1.height);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return cv;
  }

  /* ---------------------------------------------------------------
   * 5. 물품 목록 CSV (엑셀에서 한글이 깨지지 않도록 BOM 포함)
   * ------------------------------------------------------------- */
  ST.exportCSV = function () {
    const s = BS.state, b = s.booth;
    const q = (v) => {
      const t = String(v === undefined || v === null ? '' : v);
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const rows = [];
    rows.push(['수업나눔페스타 부스 물품 목록', '', '', '', '', '', '']);
    rows.push(['부스', `${BS.SHAPES[b.shape].label} ${b.width}×${b.depth}×${b.height}cm`, '', '', '', '', '']);
    rows.push([]);
    rows.push(['[요약] 구분', '종류', '가로(cm)', '깊이/세로(cm)', '높이(cm)', '수량', '이름']);
    // 집기: 종류 + 규격으로 묶기
    const groups = {};
    for (const it of s.items) {
      const def = BS.items.LIB[it.type] || { label: it.type, group: '기타' };
      if (def.ghost) continue;
      const k = `${it.type}|${it.w}|${it.d}|${it.h}|${it.cloth ? 1 : 0}`;
      (groups[k] = groups[k] || { def, it, n: 0, names: [] }).n++;
      groups[k].names.push(it.name);
    }
    Object.values(groups).sort((a, c) => a.def.group.localeCompare(c.def.group)).forEach((g) => {
      rows.push([g.def.group, g.def.label + (g.it.cloth ? ' (천 덮개)' : ''), g.it.w, g.it.d, g.it.h, g.n, g.names.join(' / ')]);
    });
    // 현수막/패널
    for (const p of s.panels) {
      const kind = p.mount === 'wall' ? `벽 현수막(${BS.WALL_LABEL[p.wall]})` : `자유 패널(${BS.panels.STANDS[p.stand].label})`;
      rows.push(['현수막·패널', kind, p.w, p.h, p.mount === 'wall' ? `하단 ${p.y}` : p.y + p.h, 1, p.name]);
    }
    rows.push([]);
    rows.push(['[상세] 번호', '이름', '종류', '규격(가로×깊이×높이 cm)', '위치(왼쪽벽→중심, 뒷벽→중심 cm)', '회전(°)', '비고']);
    let n = 1;
    for (const it of s.items) {
      const def = BS.items.LIB[it.type] || { label: it.type };
      rows.push([n++, it.name, def.label, `${it.w}×${it.d}×${it.h}`,
        `${U.fmt(it.x + b.width / 2)}, ${U.fmt(it.z + b.depth / 2)}`, it.rot || 0,
        [def.ghost ? '스케일용' : '', BS.app.warnings[it.id] ? '⚠ ' + BS.app.warnings[it.id].join(', ') : ''].filter(Boolean).join(' ')]);
    }
    for (const p of s.panels) {
      const pos = p.mount === 'wall'
        ? `${BS.WALL_LABEL[p.wall]} 왼쪽끝→${U.fmt(p.u)}cm, 바닥→하단 ${U.fmt(p.y)}cm`
        : `${U.fmt(p.x + b.width / 2)}, ${U.fmt(p.z + b.depth / 2)}`;
      const cells = (p.cols * p.rows > 1)
        ? `${p.cols}열×${p.rows}행, 칸 ${U.fmt(p.w / p.cols)}×${U.fmt(p.h / p.rows)}cm: ` + p.cells.map((c, i) => `${i + 1})${c.mode === 'text' ? (c.title || '텍스트') : c.mode === 'image' ? '이미지' : c.mode === 'color' ? '단색' : '빈칸'}`).join(' ')
        : '';
      rows.push([n++, p.name, p.mount === 'wall' ? '벽 현수막' : BS.panels.STANDS[p.stand].label, `${p.w}×${p.h} (두께 ${p.thick})`, pos, p.mount === 'wall' ? '' : (p.rot || 0), cells]);
    }
    const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    U.download(`booth-items_${U.dateStamp()}.csv`, csv, 'text/csv;charset=utf-8');
    BS.toast('물품 목록(CSV)을 저장했습니다');
  };

  /* ---------------------------------------------------------------
   * 6. 평면도 + 벽면 입면도 (현장 설치용, 2D 캔버스로 정확히 그림)
   * ------------------------------------------------------------- */
  const COLORS = { line: '#1f2933', dim: '#1565d8', wall: '#4b5563', warn: '#e03131', banner: '#e8590c', sub: '#6b7280' };

  /** 평면도 캔버스 */
  ST.drawPlan = function (pxPerCm = 4) {
    const s = BS.state, b = s.booth;
    const W = b.width, D = b.depth, t = b.thickness;
    const k = pxPerCm;
    const aisle = b.aisle ? Math.min(b.aisleWidth, 200) : 0;
    const margin = 70; // cm
    const headPx = 120;
    const listW = 720;
    const planW = (W + 2 * t + margin * 2) * k;
    const planH = (D + 2 * t + margin * 2 + aisle) * k;
    const ents = [...s.items.filter((i) => !i.hidden), ...s.panels.filter((p) => p.mount === 'free' && !p.hidden)];
    const rowsH = 40 + (ents.length + s.panels.filter((p) => p.mount === 'wall').length + 2) * 30;
    const cv = document.createElement('canvas');
    cv.width = Math.round(planW + listW);
    cv.height = Math.round(Math.max(planH + headPx, rowsH + headPx + 40));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);

    // 제목
    ctx.fillStyle = COLORS.line; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.font = `800 40px ${BS.FONT}`;
    ctx.fillText(`${s.title} — 배치 평면도`, 30, 24);
    ctx.font = `400 22px ${BS.FONT}`; ctx.fillStyle = COLORS.sub;
    ctx.fillText(`${BS.SHAPES[b.shape].label} 부스 · 폭 ${W} × 깊이 ${D} × 높이 ${b.height} cm · 벽 두께 ${t} cm · 단위 cm · 위쪽 = 뒷벽, 아래쪽 = 통로 · ${new Date().toLocaleDateString('ko-KR')}`, 30, 74);

    // 부스 좌표 → 캔버스
    const ox = (margin + t) * k, oy = headPx + (margin + t) * k;
    const X = (x) => ox + (x + W / 2) * k;
    const Y = (z) => oy + (z + D / 2) * k;

    // 50cm 격자
    ctx.save();
    ctx.beginPath(); ctx.rect(X(-W / 2), Y(-D / 2), W * k, D * k); ctx.clip();
    ctx.strokeStyle = '#e5e8ec'; ctx.lineWidth = 1;
    for (let x = -W / 2; x <= W / 2; x += 10) { ctx.beginPath(); ctx.moveTo(X(x), Y(-D / 2)); ctx.lineTo(X(x), Y(D / 2)); ctx.strokeStyle = Math.abs((x + W / 2) % 50) < 0.01 ? '#cfd5dc' : '#f0f2f5'; ctx.stroke(); }
    for (let z = -D / 2; z <= D / 2; z += 10) { ctx.beginPath(); ctx.moveTo(X(-W / 2), Y(z)); ctx.lineTo(X(W / 2), Y(z)); ctx.strokeStyle = Math.abs((z + D / 2) % 50) < 0.01 ? '#cfd5dc' : '#f0f2f5'; ctx.stroke(); }
    ctx.restore();

    // 부스 경계
    ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
    ctx.strokeRect(X(-W / 2), Y(-D / 2), W * k, D * k);
    ctx.setLineDash([]);

    // 통로
    if (aisle) {
      ctx.fillStyle = '#f1f3f5';
      ctx.fillRect(X(-W / 2) - margin * k * 0.8, Y(D / 2) + 2, (W + margin * 1.6) * k, aisle * k * 0.55);
      ctx.fillStyle = COLORS.sub; ctx.font = `600 22px ${BS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`통로 (폭 ${b.aisleWidth} cm)`, X(0), Y(D / 2) + aisle * k * 0.3);
    }

    // 벽
    for (const key of BS.WALL_KEYS) {
      const inf = BS.booth.wallInfo(key);
      if (!inf.on) continue;
      const bx = inf.box;
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(X(bx.x0), Y(bx.z0), Math.max(2, (bx.x1 - bx.x0) * k), Math.max(2, (bx.z1 - bx.z0) * k));
    }

    // 벽 현수막: 벽 안쪽 면에 주황색 띠 + 번호
    let num = 1;
    const legend = [];
    for (const p of s.panels.filter((q) => q.mount === 'wall' && !q.hidden)) {
      const inf = BS.booth.wallInfo(p.wall);
      const a = BS.booth.wallToWorld(inf, p.u, 0, 0), c = BS.booth.wallToWorld(inf, p.u + p.w, 0, 0);
      const n2 = inf.n.clone().multiplyScalar(4);
      const warn = !!BS.app.warnings[p.id];
      ctx.strokeStyle = warn ? COLORS.warn : COLORS.banner; ctx.lineWidth = Math.max(5, 2.5 * k); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(X(a.x + n2.x / 2), Y(a.z + n2.z / 2)); ctx.lineTo(X(c.x + n2.x / 2), Y(c.z + n2.z / 2)); ctx.stroke();
      const mid = a.clone().add(c).multiplyScalar(0.5).addScaledVector(inf.n, 14);
      badge(ctx, X(mid.x), Y(mid.z), num, warn ? COLORS.warn : COLORS.banner);
      legend.push({ num, name: p.name, spec: `${p.w}×${p.h}`, pos: `${BS.WALL_LABEL[p.wall]}: 왼쪽 끝→${U.fmt(p.u)}, 하단 ${U.fmt(p.y)}`, warn, banner: true });
      num++;
    }

    // 집기/자유 패널
    for (const e of ents) {
      const fp = BS.items.footprint(e);
      const warn = !!BS.app.warnings[e.id];
      const isPanel = e.kind === 'panel';
      const def = isPanel ? {} : (BS.items.LIB[e.type] || {});
      const col = isPanel ? '#fff4e6' : U.shade(e.color || '#cccccc', 0.55);
      ctx.fillStyle = col;
      ctx.strokeStyle = warn ? COLORS.warn : COLORS.line;
      ctx.lineWidth = warn ? 3 : 1.6;
      if (def.round) {
        ctx.beginPath(); ctx.arc(X(e.x), Y(e.z), e.w / 2 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (def.ghost) {
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.ellipse(X(e.x), Y(e.z), e.w / 2 * k, e.d / 2 * k, -U.rad(e.rot || 0), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath(); fp.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)))); ctx.closePath();
        ctx.fill(); ctx.stroke();
        // 앞면 표시(굵은 선)
        ctx.lineWidth = isPanel ? 5 : 3; ctx.strokeStyle = isPanel ? COLORS.banner : (warn ? COLORS.warn : '#495057');
        ctx.beginPath(); ctx.moveTo(X(fp[2].x), Y(fp[2].z)); ctx.lineTo(X(fp[3].x), Y(fp[3].z)); ctx.stroke();
      }
      badge(ctx, X(e.x), Y(e.z), num, warn ? COLORS.warn : '#343a40');
      const elev = !isPanel && BS.items.elev ? BS.items.elev[e.id] : 0;
      legend.push({
        num, name: e.name,
        spec: isPanel ? `${e.w}×${e.h} (${BS.panels.STANDS[e.stand].label})` : `${e.w}×${e.d}×${e.h}`,
        pos: `왼쪽벽→${U.fmt(e.x + W / 2)}, 뒷벽→${U.fmt(e.z + D / 2)}${e.rot ? `, ${e.rot}°` : ''}${elev ? `, 높이 ${elev} 위` : ''}`,
        warn,
      });
      num++;
    }

    // 전체 치수
    ctx.strokeStyle = COLORS.dim; ctx.fillStyle = COLORS.dim; ctx.lineWidth = 2;
    dimH(ctx, X(-W / 2), X(W / 2), Y(-D / 2) - (t + 30) * k, `${W} cm`);
    dimV(ctx, X(W / 2) + (t + 30) * k, Y(-D / 2), Y(D / 2), `${D} cm`);

    // 축척 막대
    const sb = 100 * k, sx = 30, sy = cv.height - 40;
    ctx.fillStyle = '#111'; ctx.fillRect(sx, sy, sb / 2, 8); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.strokeRect(sx, sy, sb, 8);
    ctx.font = `600 18px ${BS.FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('0', sx, sy - 4); ctx.fillText('50', sx + sb / 2 - 8, sy - 4); ctx.fillText('100 cm', sx + sb - 10, sy - 4);

    // 목록 표
    const lx = planW + 10;
    let ly = headPx + 10;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `800 24px ${BS.FONT}`; ctx.fillStyle = COLORS.line;
    ctx.fillText('번호 · 이름 · 규격(cm) · 설치 위치(cm)', lx, ly); ly += 40;
    ctx.font = `400 19px ${BS.FONT}`;
    for (const L of legend) {
      badge(ctx, lx + 16, ly + 12, L.num, L.warn ? COLORS.warn : L.banner ? COLORS.banner : '#343a40', 14);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = L.warn ? COLORS.warn : COLORS.line;
      ctx.font = `700 19px ${BS.FONT}`;
      ctx.fillText(clip(ctx, `${L.name}  ${L.spec}`, listW - 60), lx + 40, ly);
      ctx.font = `400 16px ${BS.FONT}`; ctx.fillStyle = COLORS.sub;
      ctx.fillText(clip(ctx, L.pos + (L.warn ? '  ⚠ 확인 필요' : ''), listW - 60), lx + 40, ly + 21);
      ly += 46;
    }
    return cv;
  };

  /** 벽면 입면도 캔버스 (켜진 벽마다) */
  ST.drawElevations = function (pxPerCm = 3) {
    const b = BS.state.booth, k = pxPerCm;
    // 현수막이 붙어 있는 벽만 그림
    const walls = BS.WALL_KEYS.map((kk) => BS.booth.wallInfo(kk))
      .filter((w) => BS.state.panels.some((p) => p.mount === 'wall' && p.wall === w.key && !p.hidden));
    if (!walls.length) return null;
    const pad = 60;
    const maxLen = Math.max(...walls.map((w) => w.len));
    const blockW = (maxLen + 120) * k;
    const heights = walls.map((w) => (w.h + 110) * k);
    const cv = document.createElement('canvas');
    cv.width = Math.round(blockW + pad * 2);
    cv.height = Math.round(heights.reduce((a, c) => a + c, 0) + 120);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = COLORS.line; ctx.font = `800 36px ${BS.FONT}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('벽면 입면도 (부스 안쪽에서 벽을 바라본 모습)', pad, 24);
    let y0 = 100;
    walls.forEach((inf, wi) => {
      const ox = pad + 60 * k, oy = y0 + 40 * k + inf.h * k; // 바닥선
      const WX = (u) => ox + u * k, WY = (v) => oy - v * k;
      ctx.fillStyle = COLORS.line; ctx.font = `800 26px ${BS.FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${BS.WALL_LABEL[inf.key]}  (길이 ${U.fmt(inf.len)} × 높이 ${U.fmt(inf.h)} cm)`, ox, WY(inf.h) - 34);
      ctx.fillStyle = BS.state.booth.wallColor; ctx.strokeStyle = COLORS.wall; ctx.lineWidth = 2;
      ctx.fillRect(WX(0), WY(inf.h), inf.len * k, inf.h * k); ctx.strokeRect(WX(0), WY(inf.h), inf.len * k, inf.h * k);
      ctx.beginPath(); ctx.moveTo(WX(-30), oy); ctx.lineTo(WX(inf.len + 30), oy); ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
      // 벽 치수
      ctx.strokeStyle = COLORS.dim; ctx.fillStyle = COLORS.dim; ctx.lineWidth = 1.5;
      dimH(ctx, WX(0), WX(inf.len), WY(inf.h) - 16, `${U.fmt(inf.len)}`);
      dimV(ctx, WX(-22), WY(inf.h), WY(0), `${U.fmt(inf.h)}`);
      const ps = BS.state.panels.filter((p) => p.mount === 'wall' && p.wall === inf.key && !p.hidden);
      ps.forEach((p, i) => {
        const rec = BS.panels.map.get(p.id);
        const x = WX(p.u), y = WY(p.y + p.h), w = p.w * k, h = p.h * k;
        if (rec && rec.canvas) ctx.drawImage(rec.canvas, x, y, w, h);
        const warn = !!BS.app.warnings[p.id];
        ctx.strokeStyle = warn ? COLORS.warn : COLORS.banner; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = `700 18px ${BS.FONT}`;
        const label = `${p.name} ${p.w}×${p.h}`;
        const lw = ctx.measureText(label).width + 12;
        ctx.fillRect(x + 4, y + 4, lw, 26);
        ctx.fillStyle = warn ? COLORS.warn : COLORS.line; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(label, x + 10, y + 8);
        // 위치 치수: 왼쪽 끝→현수막, 바닥→하단
        ctx.strokeStyle = '#2b8a3e'; ctx.fillStyle = '#2b8a3e'; ctx.lineWidth = 1.5;
        if (p.u > 0.5) dimH(ctx, WX(0), x, WY(p.y) + 22 + i * 26, `${U.fmt(p.u)}`);
        dimH(ctx, x, x + w, WY(p.y) + 22 + i * 26, `${p.w}`, COLORS.banner);
        if (p.y > 0.5) dimV(ctx, x + w + 18 + i * 4, WY(p.y), WY(0), `하단 ${U.fmt(p.y)}`);
        dimV(ctx, x + w + 18 + i * 4, y, WY(p.y), `${p.h}`, COLORS.banner);
      });
      y0 += heights[wi];
    });
    return cv;
  };

  /** 평면도 + 입면도 저장 (fmt: 'png' | 'pdf') */
  ST.exportPlan = async function (fmt = 'png') {
    const plan = ST.drawPlan(4);
    const elev = ST.drawElevations(3);
    if (fmt === 'png') {
      const w = Math.max(plan.width, elev ? elev.width : 0);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = plan.height + (elev ? elev.height + 20 : 0);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(plan, 0, 0);
      if (elev) { ctx.fillStyle = '#ced4da'; ctx.fillRect(0, plan.height + 8, w, 3); ctx.drawImage(elev, 0, plan.height + 20); }
      cv.toBlob((blob) => { U.download(`booth-plan_${U.dateStamp()}.png`, blob); BS.toast('평면도 PNG를 저장했습니다'); }, 'image/png');
      return;
    }
    // PDF: A3 가로, 1쪽 평면도 / 2쪽 입면도
    try {
      if (!window.jspdf) await U.loadScript(CDN.jspdf);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const addPage = (cv, first) => {
        if (!first) doc.addPage('a3', 'landscape');
        const pw = 420, ph = 297, m = 10;
        const s = Math.min((pw - m * 2) / cv.width, (ph - m * 2) / cv.height);
        doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', m, m, cv.width * s, cv.height * s);
      };
      addPage(plan, true);
      if (elev) addPage(elev, false);
      doc.save(`booth-plan_${U.dateStamp()}.pdf`);
      BS.toast('평면도 PDF(A3)를 저장했습니다');
    } catch (err) {
      // 오프라인 등으로 jsPDF 를 못 불러오면 인쇄 창으로 대체
      console.warn(err);
      const w = window.open('', '_blank');
      if (!w) { BS.toast('PDF 라이브러리를 불러오지 못했습니다. PNG로 저장해 주세요.', 'error'); return; }
      w.document.write(`<title>부스 평면도</title><style>@page{size:A3 landscape;margin:8mm}img{width:100%;page-break-after:always}</style><img src="${plan.toDataURL()}">${elev ? `<img src="${elev.toDataURL()}">` : ''}<script>onload=()=>print()<\/script>`);
      w.document.close();
    }
  };

  /* --- 2D 그리기 헬퍼 --- */
  function badge(ctx, x, y, n, color, r = 15) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${r * 1.1}px ${BS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 1);
  }
  function clip(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }
  function arrowTick(ctx, x, y, horiz) {
    ctx.beginPath();
    if (horiz) { ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); }
    else { ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); }
    ctx.stroke();
  }
  function dimH(ctx, x1, x2, y, label, color) {
    ctx.save();
    if (color) { ctx.strokeStyle = color; ctx.fillStyle = color; }
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    arrowTick(ctx, x1, y, true); arrowTick(ctx, x2, y, true);
    ctx.font = `700 18px ${BS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(label).width;
    const prev = ctx.fillStyle;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect((x1 + x2) / 2 - tw / 2 - 3, y - 22, tw + 6, 19);
    ctx.fillStyle = prev; ctx.fillText(label, (x1 + x2) / 2, y - 4);
    ctx.restore();
  }
  function dimV(ctx, x, y1, y2, label, color) {
    ctx.save();
    if (color) { ctx.strokeStyle = color; ctx.fillStyle = color; }
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
    arrowTick(ctx, x, y1, false); arrowTick(ctx, x, y2, false);
    ctx.translate(x - 5, (y1 + y2) / 2); ctx.rotate(-Math.PI / 2);
    ctx.font = `700 18px ${BS.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(label).width;
    const prev = ctx.fillStyle;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-tw / 2 - 3, -20, tw + 6, 19);
    ctx.fillStyle = prev; ctx.fillText(label, 0, -2);
    ctx.restore();
  }
})(window.BS);
