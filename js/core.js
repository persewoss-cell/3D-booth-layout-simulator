/* =====================================================================
 * core.js — 공용 유틸리티 · 상태(State) 모델 · 실행취소(History) · 이벤트
 * ---------------------------------------------------------------------
 *  - 모든 길이 단위는 cm 입니다. (three.js 1 unit = 1 cm)
 *  - 좌표계: 부스 바닥 중심이 원점(0,0,0)
 *      x : 왼쪽(-) → 오른쪽(+)   (통로에서 부스를 바라볼 때 기준)
 *      z : 뒤(-, 뒷벽) → 앞(+, 통로)
 *      y : 위(+)
 *  - 이 파일은 <script> 로 로드되는 일반 스크립트입니다.
 *    (file:// 더블클릭 실행을 위해 ES 모듈 대신 전역 네임스페이스 BS 사용)
 * ===================================================================== */
window.BS = window.BS || {};

(function (BS) {
  'use strict';

  /* ---------------------------------------------------------------
   * 1. 유틸리티
   * ------------------------------------------------------------- */
  const U = BS.util = {
    uid(prefix = 'id') {
      return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    },
    clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
    snap(v, step) { return step > 0 ? Math.round(v / step) * step : v; },
    clone(o) { return JSON.parse(JSON.stringify(o)); },
    num(v, def = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : def; },
    /** 소수점 1자리까지 보기 좋게 */
    fmt(v) { return String(Math.round(v * 10) / 10); },
    deg(r) { return r * 180 / Math.PI; },
    rad(d) { return d * Math.PI / 180; },
    /** 각도를 0~360 범위로 */
    normDeg(d) { d = d % 360; return d < 0 ? d + 360 : d; },
    debounce(fn, ms) {
      let t = null;
      return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    },
    /** 간단한 DOM 생성 헬퍼: el('div', {class:'x', onclick:fn}, child, '텍스트') */
    el(tag, attrs, ...children) {
      const e = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          const v = attrs[k];
          if (v === undefined || v === null || v === false) continue;
          if (k === 'class') e.className = v;
          else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
          else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
          else if (k === 'html') e.innerHTML = v;
          else if (k in e && typeof v !== 'string') e[k] = v;
          else e.setAttribute(k, v === true ? '' : v);
        }
      }
      for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
      return e;
    },
    /** 색 밝기 조정 (#rrggbb, amt -1~1) */
    shade(hex, amt) {
      const c = parseInt(hex.slice(1), 16);
      let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      const f = (x) => Math.round(amt < 0 ? x * (1 + amt) : x + (255 - x) * amt);
      r = f(r); g = f(g); b = f(b);
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },
    download(filename, dataOrBlob, mime) {
      const blob = dataOrBlob instanceof Blob ? dataOrBlob : new Blob([dataOrBlob], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    downloadDataURL(filename, dataURL) {
      const a = document.createElement('a');
      a.href = dataURL; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    },
    dateStamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    },
    /** 외부 스크립트(UMD) 지연 로드 */
    loadScript(src) {
      return new Promise((res, rej) => {
        if (document.querySelector(`script[data-src="${src}"]`)) return res();
        const s = document.createElement('script');
        s.src = src; s.async = true; s.dataset.src = src;
        s.onload = () => res(); s.onerror = () => rej(new Error('스크립트 로드 실패: ' + src));
        document.head.appendChild(s);
      });
    },
  };

  /* ---------------------------------------------------------------
   * 2. 간단한 이벤트 버스
   * ------------------------------------------------------------- */
  const listeners = {};
  BS.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  BS.emit = (ev, ...args) => { (listeners[ev] || []).forEach((fn) => fn(...args)); };

  /** 화면 하단 알림 */
  BS.toast = function (msg, kind = 'info', ms = 2600) {
    const box = document.getElementById('toast');
    if (!box) { console.log(msg); return; }
    const t = U.el('div', { class: 'toast-item ' + kind }, msg);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove(); // 최대 3개만 표시
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, ms);
  };

  /* ---------------------------------------------------------------
   * 3. 상수: 부스 형태, 벽 이름
   * ------------------------------------------------------------- */
  /** 캔버스 글꼴 (한글 웹폰트 → 시스템 한글 글꼴 순) */
  BS.FONT = "'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Nanum Gothic', 'WenQuanYi Zen Hei', sans-serif";

  BS.WALL_KEYS = ['back', 'left', 'right', 'front'];
  BS.WALL_LABEL = { back: '뒷벽', left: '좌측 벽', right: '우측 벽', front: '앞벽' };
  BS.WALL_SHORT = { back: '뒤', left: '좌', right: '우', front: '앞' };

  BS.SHAPES = {
    U: { label: 'ㄷ자', desc: '3면 벽 (뒤·좌·우)', walls: { back: true, left: true, right: true, front: false } },
    I: { label: 'ㅡ자', desc: '뒷벽 1면', walls: { back: true, left: false, right: false, front: false } },
    L: { label: 'ㄴ자', desc: '2면 벽 (뒤·좌)', walls: { back: true, left: true, right: false, front: false } },
    island: { label: '독립형 섬', desc: '벽 없음', walls: { back: false, left: false, right: false, front: false } },
    panel: { label: '칸막이 패널형', desc: '조립식 패널 3면', walls: { back: true, left: true, right: true, front: false } },
  };

  /* ---------------------------------------------------------------
   * 4. 기본값 생성기
   * ------------------------------------------------------------- */
  BS.defaults = {
    wall(on, len, h) { return { on, fit: true, len, h }; },

    booth(shape = 'U', width = 300, depth = 300, height = 240) {
      const sw = BS.SHAPES[shape].walls;
      return {
        shape, width, depth, height,
        thickness: 5,
        floorColor: '#9aa6b4',
        wallColor: '#f6f6f3',
        walls: {
          back: BS.defaults.wall(sw.back, width, height),
          left: BS.defaults.wall(sw.left, depth, height),
          right: BS.defaults.wall(sw.right, depth, height),
          front: BS.defaults.wall(sw.front, width, height),
        },
        panelModule: 100,      // 칸막이 패널 1장 폭(cm)
        aisle: true,           // 앞 통로 표시
        aisleWidth: 200,       // 통로 폭(cm)
        neighbors: true,       // 옆 부스 경계선 표시
      };
    },

    /** 현수막/패널의 칸(cell) */
    cell(over) {
      return Object.assign({
        mode: 'text',          // 'image' | 'text' | 'color' | 'empty'
        title: '', body: '',
        titleSize: 8,          // 제목 글자 높이(cm)
        bodySize: 4,           // 본문 글자 높이(cm)
        color: '#1d2b4f',      // 글자색
        bg: '#ffffff',         // 배경색 (단색 모드에서는 칸 색)
        align: 'center',       // left | center | right
        img: null,             // 이미지 asset id
        fit: 'contain',        // contain(맞춤) | cover(채우기) | stretch(늘이기)
      }, over || {});
    },

    /** 현수막(벽 부착) / 자유 패널(바닥 거치) */
    panel(over) {
      const p = Object.assign({
        id: U.uid('pn'), kind: 'panel',
        name: '새 현수막',
        mount: 'wall',         // 'wall' | 'free'
        wall: 'back', u: 0, y: 90,     // 벽 부착: 벽 왼쪽 끝→현수막 왼쪽 끝 거리, 바닥→하단 높이
        x: 0, z: 0, rot: 0, stand: 'board', // 자유 패널: 바닥 위치/회전/거치대 종류
        w: 90, h: 120, thick: 1,
        border: 1, frameColor: '#3a3f47',
        cols: 1, rows: 1,
        divider: true, dividerColor: '#ffffff', dividerWidth: 1,
        cells: [],
        locked: false, hidden: false,
      }, over || {});
      BS.defaults.fitCells(p);
      return p;
    },

    /** cols*rows 개수에 맞게 cells 배열 길이 조정 */
    fitCells(p) {
      const n = Math.max(1, (p.cols | 0) * (p.rows | 0));
      if (!Array.isArray(p.cells)) p.cells = [];
      while (p.cells.length < n) p.cells.push(BS.defaults.cell({ mode: 'empty' }));
      if (p.cells.length > n) p.cells.length = n;
      return p;
    },

    item(type, over) {
      const def = BS.items && BS.items.LIB[type];
      const base = def ? def.defaults : { w: 50, d: 50, h: 50, color: '#999999' };
      return Object.assign({
        id: U.uid('it'), kind: 'item', type,
        name: def ? def.label : type,
        w: base.w, d: base.d, h: base.h, color: base.color,
        x: 0, z: 0, rot: 0,
        cloth: false,
        locked: false, hidden: false,
      }, over || {});
    },

    settings() {
      return { grid: true, dims: true, snap: 5, labels: false };
    },
  };

  /* ---------------------------------------------------------------
   * 5. 전역 상태
   *    BS.state  : 장면 데이터 (저장/실행취소 대상)
   *    BS.assets : 업로드 이미지 { id: dataURL }  (실행취소 스냅샷에서 제외)
   * ------------------------------------------------------------- */
  BS.state = {
    version: 1,
    title: '수업나눔페스타 전시 부스',
    booth: BS.defaults.booth(),
    panels: [],
    items: [],
    settings: BS.defaults.settings(),
  };
  BS.assets = {};

  /** id 로 엔티티 찾기 */
  BS.find = function (id) {
    return BS.state.panels.find((p) => p.id === id) || BS.state.items.find((i) => i.id === id) || null;
  };

  /* ---------------------------------------------------------------
   * 6. 실행취소 / 다시실행 (스냅샷 방식)
   * ------------------------------------------------------------- */
  function snapshot() {
    const s = BS.state;
    return JSON.stringify({ title: s.title, booth: s.booth, panels: s.panels, items: s.items });
  }

  const H = BS.history = {
    undoStack: [], redoStack: [], last: null, max: 150,
    reset() { this.undoStack = []; this.redoStack = []; this.last = snapshot(); BS.emit('history'); },
    /** 변경이 끝난 시점에 호출 — 이전 스냅샷을 undo 스택에 넣는다 */
    commit() {
      const s = snapshot();
      if (s === this.last) return false;
      if (this.last !== null) this.undoStack.push(this.last);
      if (this.undoStack.length > this.max) this.undoStack.shift();
      this.redoStack = [];
      this.last = s;
      BS.emit('history');
      BS.emit('dirty');
      return true;
    },
    canUndo() { return this.undoStack.length > 0; },
    canRedo() { return this.redoStack.length > 0; },
    undo() {
      // 입력 중이던 값이 아직 commit 안 됐을 수 있으므로 먼저 반영
      this.commit();
      if (!this.undoStack.length) return;
      this.redoStack.push(this.last);
      this.last = this.undoStack.pop();
      this._restore(this.last);
    },
    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(this.last);
      this.last = this.redoStack.pop();
      this._restore(this.last);
    },
    _restore(json) {
      const o = JSON.parse(json);
      Object.assign(BS.state, o);
      BS.emit('history');
      BS.emit('restored');
      BS.emit('dirty');
    },
  };

  /* ---------------------------------------------------------------
   * 7. 업로드 이미지(asset) 관리 — dataURL → HTMLImageElement 캐시
   * ------------------------------------------------------------- */
  const imgCache = {};
  BS.assetImage = function (id) {
    if (!id || !BS.assets[id]) return null;
    let rec = imgCache[id];
    if (!rec || rec.src !== BS.assets[id]) {
      const img = new Image();
      rec = imgCache[id] = { img, src: BS.assets[id], ready: false };
      img.onload = () => { rec.ready = true; BS.emit('assetLoaded', id); };
      img.src = BS.assets[id];
    }
    return rec.ready ? rec.img : null;
  };
  BS.addAsset = function (dataURL) {
    const id = U.uid('img');
    BS.assets[id] = dataURL;
    return id;
  };
  /** 현재 장면에서 사용 중인 이미지 id 목록 */
  BS.usedAssets = function () {
    const used = {};
    for (const p of BS.state.panels) for (const c of p.cells) if (c.img && BS.assets[c.img]) used[c.img] = BS.assets[c.img];
    return used;
  };
})(window.BS);
