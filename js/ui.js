/* =====================================================================
 * ui.js — 왼쪽 설정 패널(부스 설치/물품 추가/목록/저장·인쇄) · 오른쪽 선택 항목 패널
 *         · 툴바 · 새로 시작 창
 * ---------------------------------------------------------------------
 *  입력값을 바꾸면(input) 즉시 3D 에 반영하고, 입력이 끝나면(change)
 *  실행취소 지점을 만든다.
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const el = U.el;
  const UI = BS.ui = { tab: 'booth', cellIdx: 0, live: [], folds: loadFolds() };

  /** 접기/펼치기 상태 기억 (브라우저별) */
  function loadFolds() {
    try { return Object.assign({ 'file.cloud': true }, JSON.parse(localStorage.getItem('boothSimulator.folds') || '{}')); }
    catch { return { 'file.cloud': true }; }
  }
  function saveFolds() { try { localStorage.setItem('boothSimulator.folds', JSON.stringify(UI.folds)); } catch { /* 무시 */ } }
  const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;

  /* ---------------------------------------------------------------
   * 초기화
   * ------------------------------------------------------------- */
  UI.init = function () {
    // 탭
    document.querySelectorAll('.tabs .tab').forEach((b) => b.addEventListener('click', () => UI.showTab(b.dataset.tab)));
    // 패널 접기/펼치기
    const narrow = () => window.matchMedia('(max-width: 820px)').matches;
    document.getElementById('btn-panel-close').onclick = () => UI.setPanel(false);
    document.getElementById('btn-panel-open').onclick = () => UI.setPanel(!document.body.classList.contains('panel-open') || document.body.classList.contains('panel-collapsed'));
    if (narrow()) UI.setPanel(false); else UI.setPanel(true);

    // 툴바
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      BS.scene.setView(b.dataset.view);
      if (narrow()) UI.setPanel(false);
    }));
    document.getElementById('btn-focus').onclick = () => BS.app.focus();
    document.getElementById('btn-grid').onclick = () => UI.toggleSetting('grid');
    document.getElementById('btn-dims').onclick = () => UI.toggleSetting('dims');
    const snapSel = document.getElementById('sel-snap');
    snapSel.value = String(BS.state.settings.snap);
    snapSel.onchange = () => { BS.state.settings.snap = +snapSel.value; BS.storage.autosave(); };
    document.getElementById('btn-undo').onclick = () => BS.history.undo();
    document.getElementById('btn-redo').onclick = () => BS.history.redo();
    document.getElementById('btn-shot').onclick = () => BS.storage.screenshot();
    // 새로 시작 / 불러오기 (왼쪽 위 + 빈 화면 가운데)
    document.getElementById('btn-new').onclick = () => UI.openNew();
    document.getElementById('btn-open').onclick = () => BS.cloud.openDialog();
    document.querySelector('#welcome [data-act=new]').onclick = () => UI.openNew();
    document.querySelector('#welcome [data-act=open]').onclick = () => BS.cloud.openDialog();
    document.getElementById('btn-insp-close').onclick = () => BS.app.select(null);
    document.getElementById('btn-help').onclick = () => UI.openHelp();
    // 💾 지금 저장: 클라우드 배치면 바로 저장, 클라우드에 없으면 클라우드에 만들기, 파일로 연 경우 이 브라우저에 저장
    document.getElementById('btn-save').onclick = () => {
      const C = BS.cloud;
      if (C.available()) { if (C.id || C.pendingCreate) C.save({ manual: true }); else C.saveAsCopy(); }
      else { BS.storage.saveLocal(); BS.toast('이 브라우저에 저장했습니다 (다른 곳에 보관하려면 [저장·인쇄] → JSON 내보내기)'); }
    };
    document.getElementById('btn-walk-exit').onclick = () => { BS.scene.setMode('orbit'); BS.scene.setView('diag'); };

    // 걷기 패드 (누르고 있는 동안 이동)
    document.querySelectorAll('#walkpad [data-k]').forEach((b) => {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); BS.scene.keys[k] = true; };
      const off = () => { BS.scene.keys[k] = false; };
      b.addEventListener('pointerdown', on);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, off));
    });

    // 파일 입력
    document.getElementById('file-json').onchange = (e) => { const f = e.target.files[0]; if (f) BS.storage.importJSON(f); e.target.value = ''; };
    document.getElementById('file-image').onchange = onImageFile;

    // 모달 바깥 클릭으로 닫기
    document.getElementById('modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && !UI.modalLocked) UI.closeModal(); });

    // 이벤트 구독
    BS.on('select', (id) => {
      UI.cellIdx = 0;
      renderSel(); renderLayers(); renderSelbar();
      // 선택하면 오른쪽 설정 패널이 열림 (모바일은 [속성] 버튼으로 열기)
      document.body.classList.toggle('has-sel', !!id);
      if (!id) document.body.classList.remove('insp-open');
    });
    BS.on('entityMoved', () => { UI.refreshLive(); renderSelbar(); });
    BS.on('warnings', (w) => { updateWarnBadge(w); renderSelWarn(); UI.layerStatusOnly(); });
    BS.on('history', updateUndoButtons);
    BS.on('saved', (ok) => { UI.localSaved = ok; BS.cloud.render(); });
    BS.on('viewMode', (m) => {
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active',
        (m === 'ortho' && b.dataset.view === 'top') || (m === 'walk' && b.dataset.view === 'eye')));
    });

    UI.renderAll();
    updateToggles();
    updateUndoButtons();
    document.getElementById('loading').remove();
  };

  UI.setPanel = function (open) {
    document.body.classList.toggle('panel-open', open);
    document.body.classList.toggle('panel-collapsed', !open);
    setTimeout(() => BS.scene.resize(), 260);
  };

  UI.showTab = function (name) {
    UI.tab = name;
    document.querySelectorAll('.tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    if (window.matchMedia('(max-width: 820px)').matches && !document.body.classList.contains('panel-open')) UI.setPanel(true);
  };

  UI.renderAll = function () {
    renderBooth(); renderAdd(); renderSel(); renderLayers(); renderFile(); renderSelbar();
    document.body.classList.toggle('has-sel', !!BS.app.selId);
    updateToggles(); updateWarnBadge(BS.app.warnings);
    document.getElementById('sel-snap').value = String(BS.state.settings.snap);
  };

  UI.toggleSetting = function (key) {
    const s = BS.state.settings;
    s[key] = !s[key];
    if (key === 'grid') BS.scene.gridGroup.visible = s.grid && BS.app.hasDoc;
    if (key === 'dims') { BS.scene.dimGroup.visible = s.dims && BS.app.hasDoc; BS.app.refreshSelDims(); }
    BS.scene.requestRender();
    updateToggles();
    BS.storage.autosave();
  };

  function updateToggles() {
    document.getElementById('btn-grid').classList.toggle('on', !!BS.state.settings.grid);
    document.getElementById('btn-dims').classList.toggle('on', !!BS.state.settings.dims);
  }
  function updateUndoButtons() {
    document.getElementById('btn-undo').disabled = !BS.history.canUndo() && BS.history.last === null;
    document.getElementById('btn-redo').disabled = !BS.history.canRedo();
  }
  function updateWarnBadge(w) {
    const n = Object.keys(w || {}).length;
    const b = document.getElementById('warn-count');
    b.textContent = n ? String(n) : '';
    b.title = n ? `경고 ${n}개 (겹침/밖으로 나감)` : '';
  }

  /* ---------------------------------------------------------------
   * 입력 위젯 헬퍼
   * ------------------------------------------------------------- */
  /**
   * 숫자 입력
   * @param o {label, get, set, min, max, step, unit, what, hint}
   *   what: 변경 시 app.changed(what) 인자
   */
  function num(o) {
    const inp = el('input', { type: 'number', step: o.step || 1, min: o.min, max: o.max, inputmode: 'decimal' });
    inp.value = U.fmt(o.get());
    inp.addEventListener('input', () => {
      let v = parseFloat(inp.value);
      if (!Number.isFinite(v)) return;
      if (o.min !== undefined) v = Math.max(o.min, v);
      if (o.max !== undefined) v = Math.min(o.max, v);
      o.set(v);
      BS.app.changed(o.what || 'all');
      if (o.after) o.after(v);
    });
    inp.addEventListener('change', () => { inp.value = U.fmt(o.get()); BS.app.commit(); });
    UI.live.push({ inp, get: o.get });
    return row(o.label, el('div', { class: 'num-wrap' }, inp, o.unit === '' ? null : el('span', { class: 'unit' }, o.unit || 'cm')), o.hint);
  }
  function text(o) {
    const inp = o.multiline ? el('textarea', { rows: o.rows || 3 }) : el('input', { type: 'text' });
    inp.value = o.get() || '';
    if (o.placeholder) inp.placeholder = o.placeholder;
    const apply = o.debounce ? U.debounce(() => { BS.app.changed(o.what || 'all'); if (o.after) o.after(); }, o.debounce) : () => { BS.app.changed(o.what || 'all'); if (o.after) o.after(); };
    inp.addEventListener('input', () => { o.set(inp.value); apply(); });
    inp.addEventListener('change', () => BS.app.commit());
    return row(o.label, inp);
  }
  function color(o) {
    const inp = el('input', { type: 'color' });
    inp.value = o.get();
    inp.addEventListener('input', () => { o.set(inp.value); BS.app.changed(o.what || 'all'); });
    inp.addEventListener('change', () => BS.app.commit());
    return row(o.label, inp);
  }
  function check(o) {
    const inp = el('input', { type: 'checkbox' });
    inp.checked = !!o.get();
    inp.addEventListener('change', () => { o.set(inp.checked); BS.app.changed(o.what || 'all'); BS.app.commit(); if (o.after) o.after(); });
    return el('label', { class: 'check' }, inp, ' ', o.label);
  }
  function select(o) {
    const s = el('select', null, ...o.options.map(([v, t]) => el('option', { value: v }, t)));
    s.value = String(o.get());
    s.addEventListener('change', () => { o.set(s.value); BS.app.changed(o.what || 'all'); BS.app.commit(); if (o.after) o.after(); });
    return row(o.label, s);
  }
  function seg(o) {
    const wrap = el('div', { class: 'seg' });
    o.options.forEach(([v, t]) => {
      const b = el('button', { type: 'button', class: String(o.get()) === String(v) ? 'on' : '' }, t);
      b.onclick = () => { o.set(v); BS.app.changed(o.what || 'all'); BS.app.commit(); if (o.after) o.after(); };
      wrap.appendChild(b);
    });
    return o.label ? row(o.label, wrap) : wrap;
  }
  function row(label, control, hint) {
    return el('div', { class: 'row' }, el('label', { class: 'lbl' }, label), el('div', { class: 'ctl' }, control, hint ? el('div', { class: 'hint' }, hint) : null));
  }
  /** 제목을 누르면 접히고 펼쳐지는 큰 섹션 */
  function fold(key, title, ...children) {
    const d = el('details', { class: 'fold' }, el('summary', null, title), el('div', { class: 'fold-body' }, ...children));
    d.open = !!UI.folds[key];
    d.addEventListener('toggle', () => { UI.folds[key] = d.open; saveFolds(); });
    return d;
  }
  /** 섹션 안의 작은 접기 항목 (예: 사각 테이블) */
  function sub(key, title, ...children) {
    const d = el('details', { class: 'sub' }, el('summary', null, title), el('div', { class: 'sub-body' }, ...children));
    d.open = !!UI.folds[key];
    d.addEventListener('toggle', () => { UI.folds[key] = d.open; saveFolds(); });
    return d;
  }
  function section(title, ...children) {
    return el('div', { class: 'section' }, title ? el('h3', null, title) : null, ...children);
  }
  function btn(label, onclick, cls = '', title) {
    return el('button', { type: 'button', class: 'btn ' + cls, onclick, title });
  }
  function button(label, onclick, cls = '', title) {
    const b = btn(label, onclick, cls, title); b.textContent = label; return b;
  }
  /** 드래그 등으로 값이 바뀌면 입력창 숫자만 갱신 */
  UI.refreshLive = function () {
    UI.live = UI.live.filter((l) => l.inp.isConnected);
    for (const l of UI.live) if (document.activeElement !== l.inp) l.inp.value = U.fmt(l.get());
  };

  /* ---------------------------------------------------------------
   * 부스 형태 아이콘 (위에서 본 모습)
   * ------------------------------------------------------------- */
  function shapeIcon(shape) {
    const w = BS.SHAPES[shape].walls;
    const L = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    let s = '<rect x="10" y="10" width="40" height="40" class="fl"/>';
    s += '<g class="wl">';
    if (w.back) s += L(8, 10, 52, 10);
    if (w.left) s += L(10, 8, 10, 50);
    if (w.right) s += L(50, 8, 50, 50);
    s += '</g>';
    if (shape === 'panel') s += '<g class="pp">' + [10, 23.3, 36.6, 50].map((x) => `<circle cx="${x}" cy="10" r="2.4"/>`).join('') + [23.3, 36.6, 50].map((y) => `<circle cx="10" cy="${y}" r="2.4"/><circle cx="50" cy="${y}" r="2.4"/>`).join('') + '</g>';
    s += '<text x="30" y="58" class="ar">통로 ▼</text>';
    return `<svg viewBox="0 0 60 62" aria-hidden="true">${s}</svg>`;
  }
  function shapePicker(get, set) {
    const wrap = el('div', { class: 'shape-grid' });
    for (const k of Object.keys(BS.SHAPES)) {
      const sh = BS.SHAPES[k];
      const b = el('button', { type: 'button', class: 'shape-card' + (get() === k ? ' on' : ''), html: shapeIcon(k) });
      b.appendChild(el('b', null, sh.label));
      b.appendChild(el('small', null, sh.desc));
      b.onclick = () => { set(k); wrap.querySelectorAll('.shape-card').forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
      wrap.appendChild(b);
    }
    return wrap;
  }

  /* ---------------------------------------------------------------
   * [부스] 탭
   * ------------------------------------------------------------- */
  function renderBooth() {
    const pane = document.getElementById('tab-booth');
    pane.innerHTML = '';
    const b = BS.state.booth;
    const reb = () => renderBooth();

    pane.appendChild(section('부스 형태',
      shapePicker(() => b.shape, (k) => { BS.booth.applyShape(k); BS.app.changed('booth'); BS.app.commit(); reb(); warnFloating(); }),
    ));

    pane.appendChild(section('크기',
      num({ label: '폭 (가로)', get: () => b.width, set: (v) => { b.width = v; }, min: 50, max: 3000, what: 'booth' }),
      num({ label: '깊이', get: () => b.depth, set: (v) => { b.depth = v; }, min: 50, max: 3000, what: 'booth' }),
      num({ label: '벽 높이', get: () => b.height, set: (v) => { b.height = v; }, min: 30, max: 600, what: 'booth' }),
      num({ label: '벽 두께', get: () => b.thickness, set: (v) => { b.thickness = v; }, min: 0.5, max: 50, step: 0.5, what: 'booth' }),
      b.shape === 'panel' ? num({ label: '패널 1장 폭', get: () => b.panelModule, set: (v) => { b.panelModule = v; }, min: 30, max: 300, what: 'booth', hint: '칸막이 패널 기둥 간격' }) : null,
      el('div', { class: 'row2' },
        color({ label: '바닥 색', get: () => b.floorColor, set: (v) => { b.floorColor = v; }, what: 'booth' }),
        color({ label: '벽 색', get: () => b.wallColor, set: (v) => { b.wallColor = v; }, what: 'booth' })),
    ));

    // 벽 개별 설정
    const wallBox = el('div', { class: 'walls' });
    for (const k of BS.WALL_KEYS) {
      const w = b.walls[k];
      const card = el('div', { class: 'wall-card' + (w.on ? '' : ' off') });
      card.appendChild(el('div', { class: 'wall-head' },
        check({ label: BS.WALL_LABEL[k], get: () => w.on, set: (v) => { w.on = v; }, what: 'booth', after: reb }),
        w.on ? check({ label: '부스 크기에 맞춤', get: () => w.fit, set: (v) => { w.fit = v; }, what: 'booth', after: reb }) : null));
      if (w.on && !w.fit) {
        card.appendChild(el('div', { class: 'row2' },
          num({ label: '길이', get: () => w.len, set: (v) => { w.len = v; }, min: 10, max: 3000, what: 'booth' }),
          num({ label: '높이', get: () => w.h, set: (v) => { w.h = v; }, min: 10, max: 600, what: 'booth' })));
      }
      wallBox.appendChild(card);
    }
    pane.appendChild(section('벽 개별 설정', wallBox,
      el('p', { class: 'hint' }, '앞벽은 통로 쪽 벽입니다. 좌·우 벽을 짧게 하면 뒷벽 쪽부터 붙습니다.')));

    pane.appendChild(section('주변 표시',
      check({ label: '옆 부스·뒤 부스 경계선', get: () => b.neighbors, set: (v) => { b.neighbors = v; }, what: 'booth' }),
      check({ label: '앞 통로 표시', get: () => b.aisle, set: (v) => { b.aisle = v; }, what: 'booth', after: reb }),
      b.aisle ? num({ label: '통로 폭', get: () => b.aisleWidth, set: (v) => { b.aisleWidth = v; }, min: 50, max: 1000, what: 'booth' }) : null,
    ));

    pane.appendChild(section('부스 이름',
      text({ label: '배치 이름', get: () => BS.state.title, set: (v) => { BS.state.title = v; }, what: 'none', after: () => BS.cloud.render() }),
      el('p', { class: 'hint' }, '[불러오기] 목록에 이 이름으로 보입니다.'),
    ));
  }

  /** 벽이 꺼져서 떠 있는 벽 현수막 안내 */
  function warnFloating() {
    const n = BS.state.panels.filter((p) => p.mount === 'wall' && !BS.state.booth.walls[p.wall].on).length;
    if (n) BS.toast(`꺼진 벽에 붙은 현수막이 ${n}개 있습니다. 현수막을 눌러 오른쪽 설정에서 다른 벽으로 옮기거나 '바닥에 세우기'로 바꾸세요.`, 'warn', 5500);
  }

  /* ---------------------------------------------------------------
   * [물품 추가] 탭 — 모든 큰 제목은 접혀 있고 누르면 펼쳐짐
   * ------------------------------------------------------------- */
  const newBanner = { name: '새 현수막', w: 120, h: 90, wall: 'back', y: 100, cols: 1, rows: 1 };
  /** 추가 양식 입력값 (탭을 다시 그려도 유지) */
  const F = UI.addForm = {
    rect: { w: 180, d: 60, h: 72, cloth: false },
    round: { w: 90, h: 72, cloth: false },
    chair: { w: 45, d: 50, h: 85 },
    stool: { w: 38, h: 65 },
    paper: { pose: 'stand', land: false, pw: 21, ph: 29.7 },
    book: { pose: 'closed', pw: 15, ph: 22, thick: 2 },
    acrylic: { pw: 21, ph: 29.7 },
  };
  /** 양식용 숫자 입력 (3D 에는 바로 반영하지 않음) */
  function fnum(obj, key, label, unit = 'cm', min = 0.5) {
    const inp = el('input', { type: 'number', min, step: 0.5, inputmode: 'decimal' });
    inp.value = U.fmt(obj[key]);
    inp.oninput = () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && v >= min) obj[key] = v; };
    return row(label, el('div', { class: 'num-wrap' }, inp, el('span', { class: 'unit' }, unit)));
  }
  function fcheck(obj, key, label) {
    const inp = el('input', { type: 'checkbox', checked: !!obj[key] });
    inp.onchange = () => { obj[key] = inp.checked; };
    return el('label', { class: 'check' }, inp, ' ', label);
  }
  function fseg(obj, key, options, onChange) {
    const wrap = el('div', { class: 'seg' });
    options.forEach(([v, t]) => {
      const b = el('button', { type: 'button', class: obj[key] === v ? 'on' : '' }, t);
      b.onclick = () => { obj[key] = v; wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); if (onChange) onChange(v); };
      wrap.appendChild(b);
    });
    return wrap;
  }
  function examples(label, list) {
    return el('div', { class: 'preset-row examples' }, el('span', { class: 'muted' }, label),
      ...list.map(([t, fn]) => button(t, fn, 'chip')));
  }
  function libGrid(list) {
    const grid = el('div', { class: 'lib-grid' });
    for (const p of list) {
      const def = BS.items.LIB[p.type];
      const d = Object.assign({}, def.defaults, p.over);
      const size = def.round ? `Ø${d.w}×${d.h}` : `${d.w}×${d.d}×${d.h}`;
      grid.appendChild(button(`${p.label}\n${size}`, () => BS.app.addItem(p.type, Object.assign({}, p.over)), 'lib-btn'));
    }
    return grid;
  }

  function renderAdd() {
    const pane = document.getElementById('tab-add');
    pane.innerHTML = '';
    pane.appendChild(el('p', { class: 'hint', style: { margin: '10px 0 4px' } }, '제목을 누르면 펼쳐집니다. 작품·노트북 등은 테이블을 먼저 선택한 뒤 추가하면 그 위에 놓입니다.'));

    // 1) 벽 현수막
    const nb = newBanner;
    const f = (label, k, o = {}) => {
      const inp = el('input', { type: o.type || 'number', min: o.min, step: o.step || 1 });
      inp.value = nb[k];
      inp.oninput = () => { nb[k] = o.type === 'text' ? inp.value : U.num(inp.value, nb[k]); };
      return row(label, o.type === 'text' ? inp : el('div', { class: 'num-wrap' }, inp, el('span', { class: 'unit' }, o.unit === undefined ? 'cm' : o.unit)));
    };
    const wallSel = el('select', null, ...BS.WALL_KEYS.map((k) => el('option', { value: k }, BS.WALL_LABEL[k] + (BS.state.booth.walls[k].on ? '' : ' (꺼짐)'))));
    wallSel.value = nb.wall; wallSel.onchange = () => { nb.wall = wallSel.value; };
    pane.appendChild(fold('add.wall', '벽 현수막 만들기',
      f('이름', 'name', { type: 'text' }),
      el('div', { class: 'row2' }, f('가로', 'w', { min: 1 }), f('세로', 'h', { min: 1 })),
      row('붙일 벽', wallSel),
      f('바닥→하단', 'y', { min: 0 }),
      el('div', { class: 'row2' }, f('칸: 열', 'cols', { min: 1, unit: '열' }), f('행', 'rows', { min: 1, unit: '행' })),
      button('＋ 벽에 현수막 추가', () => {
        const inf = BS.booth.wallInfo(nb.wall);
        if (!inf.on) BS.toast(`${BS.WALL_LABEL[nb.wall]}이 꺼져 있습니다. [부스 설치] 탭에서 켜 주세요.`, 'warn', 4000);
        const p = BS.defaults.panel({
          name: nb.name || '현수막', w: Math.max(1, nb.w), h: Math.max(1, nb.h), wall: nb.wall,
          y: Math.max(0, nb.y), cols: Math.max(1, nb.cols | 0), rows: Math.max(1, nb.rows | 0),
          u: Math.max(0, (inf.len - nb.w) / 2),
        });
        p.cells = p.cells.map((c, i) => BS.defaults.cell({ mode: 'text', title: p.cols * p.rows > 1 ? `칸 ${i + 1}` : p.name, body: '' }));
        BS.app.addPanel(p);
      }, 'primary wide'),
      examples('예시 (뒷벽에 바로 추가)', [
        ['연구학교 5개교 현수막 (2×3칸)', () => {
          const inf = BS.booth.wallInfo('back');
          const p = BS.panels.presetResearchSchools({ wall: 'back' });
          p.u = Math.max(0, (inf.len - p.w) / 2); p.y = Math.max(0, Math.min(20, inf.h - p.h));
          BS.app.addPanel(p);
        }],
        ['가로 현수막 300×90', () => addWallPreset('가로 현수막', 300, 90, 140)],
        ['상단 간판 300×40', () => addWallPreset('상단 간판', 300, 40, 195)],
      ]),
      examples('벽에 붙이는 작품 (눈높이 150 중심)', BS.items.PAPER_SIZES.filter(([n]) => !n.startsWith('사진')).map(([n, w, h]) =>
        [n, () => addWallPreset(`${n} 작품`, w, h, Math.max(0, 150 - h / 2), true)])),
    ));

    // 2) 패널 · 배너
    const standGrid = el('div', { class: 'lib-grid' });
    const STD = [
      ['rollup', '롤업 배너', 85, 200], ['xbanner', 'X배너', 60, 180], ['sign', '입간판', 60, 90],
      ['easel', '이젤 위 작품', 60, 80], ['board', '패널', 90, 180],
    ];
    for (const [st, label, w, h] of STD) {
      standGrid.appendChild(button(`${label}\n${w}×${h}`, () => {
        const p = BS.defaults.panel({
          name: label, mount: 'free', stand: st, w, h, y: BS.panels.STANDS[st].y, cols: 1, rows: 1,
          cells: [BS.defaults.cell({ mode: 'text', title: label, body: '내용을 입력하거나 이미지를 올리세요', titleSize: Math.min(10, w / 8), bodySize: Math.min(4, w / 18) })],
          border: st === 'easel' ? 2 : 0.5, frameColor: st === 'easel' ? '#6b4f35' : '#3a3f47',
        });
        BS.app.addPanel(p);
      }, 'lib-btn'));
    }
    pane.appendChild(fold('add.stand', '패널 · 배너 (바닥에 세우기)', standGrid));

    // 3) 테이블
    const clothColor = (on) => (on ? '#1f3a68' : '#f2f2ee');
    const addRect = (w, d, h) => BS.app.addItem('table-rect', { w, d, h, cloth: F.rect.cloth, color: clothColor(F.rect.cloth), name: '사각 테이블' });
    const addRound = (w, h) => BS.app.addItem('table-round', { w, d: w, h, cloth: F.round.cloth, color: clothColor(F.round.cloth), name: '원형 테이블' });
    pane.appendChild(fold('add.table', '테이블',
      sub('add.table.rect', '사각 테이블',
        el('div', { class: 'row3' }, fnum(F.rect, 'w', '가로'), fnum(F.rect, 'd', '깊이'), fnum(F.rect, 'h', '높이')),
        fcheck(F.rect, 'cloth', '천 덮개 씌우기'),
        button('＋ 이 크기로 추가', () => addRect(F.rect.w, F.rect.d, F.rect.h), 'primary wide'),
        examples('예시 크기로 바로 추가 (높이 72)', [[180, 60], [180, 45], [150, 60], [120, 60], [120, 45], [75, 75]].map(([w, d]) => [`${w}×${d}`, () => addRect(w, d, 72)]))),
      sub('add.table.round', '원형 테이블',
        el('div', { class: 'row2' }, fnum(F.round, 'w', '지름'), fnum(F.round, 'h', '높이')),
        fcheck(F.round, 'cloth', '천 덮개 씌우기'),
        button('＋ 이 크기로 추가', () => addRound(F.round.w, F.round.h), 'primary wide'),
        examples('예시 크기로 바로 추가', [[60, 72], [75, 72], [90, 72], [120, 72], [60, 105]].map(([w, h]) => [h > 100 ? `Ø${w} 스탠딩` : `Ø${w}`, () => addRound(w, h)]))),
    ));

    // 4) 의자
    pane.appendChild(fold('add.chair', '의자',
      sub('add.chair.chair', '의자',
        el('div', { class: 'row3' }, fnum(F.chair, 'w', '가로'), fnum(F.chair, 'd', '깊이'), fnum(F.chair, 'h', '높이')),
        button('＋ 이 크기로 추가', () => BS.app.addItem('chair', { w: F.chair.w, d: F.chair.d, h: F.chair.h }), 'primary wide'),
        examples('예시 크기로 바로 추가', [
          ['일반 45×50×85', () => BS.app.addItem('chair', { w: 45, d: 50, h: 85 })],
          ['접이식 44×46×80', () => BS.app.addItem('chair', { w: 44, d: 46, h: 80, name: '접이식 의자' })],
          ['학생용 40×40×75', () => BS.app.addItem('chair', { w: 40, d: 40, h: 75, name: '학생 의자' })],
          ['높은 의자 45×45×105', () => BS.app.addItem('chair', { w: 45, d: 45, h: 105, name: '높은 의자' })],
        ])),
      sub('add.chair.stool', '스툴 (둥근 의자)',
        el('div', { class: 'row2' }, fnum(F.stool, 'w', '지름'), fnum(F.stool, 'h', '높이')),
        button('＋ 이 크기로 추가', () => BS.app.addItem('stool', { w: F.stool.w, d: F.stool.w, h: F.stool.h }), 'primary wide'),
        examples('예시 크기로 바로 추가', [[38, 45], [38, 65], [35, 75]].map(([w, h]) => [`Ø${w}×${h}`, () => BS.app.addItem('stool', { w, d: w, h })]))),
    ));

    // 5) 전시 작품
    const P = F.paper;
    const paperDims = (w, h) => (P.land ? [h, w] : [w, h]);
    const addPaper = (name, w, h) => {
      const [pw, ph] = paperDims(w, h);
      BS.app.addItem('paper', { pw, ph, pose: P.pose, name: `${name} 작품`, color: P.pose === 'frame' ? '#5b4636' : '#ffffff' });
    };
    const B = F.book;
    const addBook = (name, pw, ph) => BS.app.addItem('book', { pw, ph, thick: B.thick, pose: B.pose, name });
    pane.appendChild(fold('add.art', '전시 작품',
      sub('add.art.paper', '지류 작품 (A4·A0·도화지·사진)',
        row('놓는 방식', fseg(P, 'pose', [['stand', '세워 놓기'], ['flat', '눕히기'], ['frame', '액자']])),
        row('방향', fseg(P, 'land', [[false, '세로'], [true, '가로']])),
        examples('규격으로 바로 추가', BS.items.PAPER_SIZES.map(([n, w, h]) => [n, () => addPaper(n, w, h)])),
        el('div', { class: 'row2' }, fnum(P, 'pw', '가로'), fnum(P, 'ph', '세로')),
        button('＋ 직접 입력한 크기로 추가', () => BS.app.addItem('paper', { pw: P.pw, ph: P.ph, pose: P.pose, name: '지류 작품', color: P.pose === 'frame' ? '#5b4636' : '#ffffff' }), 'wide'),
        el('p', { class: 'hint' }, '추가한 뒤 오른쪽 설정에서 작품 이미지(사진·스캔·PDF)를 올리세요. 벽에 붙이는 작품은 [벽 현수막 만들기]의 용지 크기를 쓰세요.')),
      sub('add.art.book', '책 · 북스탠드',
        row('놓는 방식', fseg(B, 'pose', [['closed', '덮은 책'], ['open', '펼친 책'], ['stand', '북스탠드']])),
        examples('크기로 바로 추가', [
          ['단행본 15×22', () => addBook('책', 15, 22)], ['A5 책', () => addBook('A5 책', 14.8, 21)],
          ['A4 책·문집', () => addBook('A4 문집', 21, 29.7)], ['그림책 25×25', () => addBook('그림책', 25, 25)],
          ['포트폴리오 A3', () => addBook('포트폴리오', 29.7, 42)],
        ]),
        el('div', { class: 'row3' }, fnum(B, 'pw', '가로'), fnum(B, 'ph', '세로'), fnum(B, 'thick', '두께', 'cm', 0.3)),
        button('＋ 직접 입력한 크기로 추가', () => addBook('책', B.pw, B.ph), 'wide'),
        el('p', { class: 'hint' }, '표지(펼친 책은 펼친 면) 이미지를 올릴 수 있습니다.')),
      sub('add.art.acrylic', '아크릴 스탠드 (POP 꽂이)',
        examples('규격으로 바로 추가', [['A5', 14.8, 21], ['A4', 21, 29.7], ['A3', 29.7, 42], ['A4 가로', 29.7, 21]].map(([n, w, h]) =>
          [n, () => BS.app.addItem('acrylic', { pw: w, ph: h, name: `아크릴 스탠드 ${n}` })]))),
      sub('add.art.obj', '입체 작품 · 소품', libGrid(BS.items.CATALOG.objects)),
    ));

    // 6) 디지털
    pane.appendChild(fold('add.digital', '디지털', libGrid(BS.items.CATALOG.digital)));
    // 7) 사람
    pane.appendChild(fold('add.people', '사람 (크기 비교용)', libGrid(BS.items.CATALOG.people)));
    // 8) 진열 (맨 아래)
    pane.appendChild(fold('add.display', '진열 (선반·전시단·좌대)', libGrid(BS.items.CATALOG.display)));
  }
  function addWallPreset(name, w, h, y, artwork) {
    const inf = BS.booth.wallInfo('back');
    const p = BS.defaults.panel({
      name, w, h, wall: 'back', y: Math.max(0, Math.min(y, inf.h - h)), u: Math.max(0, (inf.len - w) / 2),
      border: artwork ? 0.3 : 1, thick: artwork ? 0.3 : 1,
      cells: [artwork
        ? BS.defaults.cell({ mode: 'empty' })
        : BS.defaults.cell({ mode: 'text', title: name, body: `${w}×${h} cm`, titleSize: Math.min(12, h / 6), bodySize: Math.min(5, h / 14) })],
    });
    BS.app.addPanel(p);
  }

  /* ---------------------------------------------------------------
   * 오른쪽 선택 항목 패널 — 선택한 물체/현수막 속성
   * ------------------------------------------------------------- */
  function renderSel() {
    const pane = document.getElementById('insp-body');
    pane.innerHTML = '';
    UI.live = [];
    const e = BS.app.selected();
    document.getElementById('insp-title').textContent = e ? e.name : '선택 항목';
    if (!e) return;
    const isPanel = e.kind === 'panel';
    const what = isPanel ? 'panels' : 'items';
    const rerender = () => renderSel();
    const syncLayer = () => renderLayers();

    // 공통 머리글
    const head = el('div', { class: 'sel-head' },
      el('div', { class: 'sel-title' },
        el('span', { class: 'kind' }, isPanel ? (e.mount === 'wall' ? '벽 현수막' : BS.panels.STANDS[e.stand].label) : BS.items.LIB[e.type].label),
        el('div', { id: 'sel-warn' })),
      el('div', { class: 'sel-actions' },
        button('◎ 포커스', () => BS.app.focus(), 'sm'),
        button('⧉ 복제', () => BS.app.duplicate(), 'sm', 'Ctrl+D'),
        button(e.locked ? '🔒 잠김' : '🔓 잠금', () => { e.locked = !e.locked; BS.app.commit(); rerender(); syncLayer(); }, 'sm' + (e.locked ? ' on' : '')),
        button(e.hidden ? '🙈 숨김' : '👁 보임', () => { e.hidden = !e.hidden; BS.app.changed(what); BS.app.commit(); rerender(); syncLayer(); }, 'sm' + (e.hidden ? ' on' : '')),
        button('🗑 삭제', () => BS.app.remove(), 'sm danger', 'Delete')));
    pane.appendChild(head);
    pane.appendChild(text({ label: '이름', get: () => e.name, set: (v) => { e.name = v; }, what: 'none', after: () => {
      UI.layerNamesOnly(); renderSelbar(); document.getElementById('insp-title').textContent = e.name;
    } }));

    if (isPanel) renderPanelProps(pane, e, rerender);
    else renderItemProps(pane, e, rerender);
    renderSelWarn();
  }

  function renderSelWarn() {
    const box = document.getElementById('sel-warn');
    if (!box) return;
    const id = BS.app.selId;
    const e = BS.find(id);
    const w = BS.app.warnings[id];
    box.innerHTML = '';
    if (!e) return;
    const canOutside = e.kind === 'item' || e.mount === 'free'; // 바닥에 놓는 물건만
    // '부스 밖으로 나감' 경고는 무시할 수 있음 (통로의 배너, 안내판 등)
    const setOutside = (v) => {
      e.allowOutside = v || undefined;
      BS.app.evaluate(); BS.app.commit(); renderSelWarn(); renderSelbar();
      BS.toast(v ? `"${e.name}"은(는) 부스 밖에 있어도 경고하지 않습니다` : `"${e.name}"의 부스 밖 경고를 다시 표시합니다`);
    };
    // 벽 현수막끼리 겹침도 무시할 수 있음 (현수막 위에 현수막을 덧붙이는 경우)
    const isWall = e.kind === 'panel' && e.mount === 'wall';
    const setOverlap = (v) => {
      e.allowOverlap = v || undefined;
      BS.app.changed('place'); BS.app.commit(); renderSelWarn();
      BS.toast(v ? `"${e.name}"은(는) 다른 현수막 위에 붙여도 경고하지 않습니다` : `"${e.name}"의 겹침 경고를 다시 표시합니다`);
    };
    if (w) {
      const outside = w.includes(BS.items.OUTSIDE_MSG);
      const overlap = isWall && w.some((m) => m.endsWith('와 겹침'));
      box.appendChild(el('div', { class: 'warn-box' }, '⚠ ' + w.join(' · '),
        outside && canOutside ? el('div', { class: 'warn-actions' },
          button('무시하기 (부스 밖에 둬도 됨)', () => setOutside(true), 'sm')) : null,
        overlap ? el('div', { class: 'warn-actions' },
          button('무시하기 (현수막 위에 붙임)', () => setOverlap(true), 'sm')) : null));
    }
    if (e.allowOutside && canOutside) {
      box.appendChild(el('div', { class: 'ok-box' }, '부스 밖 경고를 무시하는 중',
        button('다시 경고 받기', () => setOutside(false), 'sm')));
    }
    if (e.allowOverlap && isWall) {
      box.appendChild(el('div', { class: 'ok-box' }, '겹침 경고를 무시하는 중',
        el('span', { class: 'btn-row', style: { marginTop: 0, flexWrap: 'nowrap' } },
          button('맨 앞으로', () => { bringFront(e); BS.app.changed('place'); BS.app.commit(); BS.toast(`"${e.name}"을(를) 맨 앞으로 옮겼습니다`); }, 'sm'),
          button('다시 경고 받기', () => setOverlap(false), 'sm'))));
    }
  }

  /** 겹친 현수막 중 맨 앞(위)에 보이게 (기본은 작은 현수막이 앞) */
  function bringFront(p) {
    p.front = Math.max(0, ...BS.state.panels.map((q) => q.front || 0)) + 1;
  }

  /** 위치 입력 (부스 왼쪽 벽/뒷벽 기준 거리로 표시) */
  function floorPos(e, what) {
    const b = BS.state.booth;
    return [
      el('div', { class: 'row2' },
        num({ label: '왼쪽 벽→중심', get: () => e.x + b.width / 2, set: (v) => { e.x = v - b.width / 2; }, what: 'place', step: 1 }),
        num({ label: '뒷벽→중심', get: () => e.z + b.depth / 2, set: (v) => { e.z = v - b.depth / 2; }, what: 'place', step: 1 })),
      rotRow(e),
    ];
  }
  function rotRow(e) {
    const r = num({ label: '회전', get: () => e.rot || 0, set: (v) => { e.rot = U.normDeg(v); }, what: 'place', step: 15, unit: '°' });
    r.querySelector('.ctl').appendChild(el('div', { class: 'btn-row' },
      button('⟲ 15°', () => BS.app.rotate(15), 'sm'),
      button('⟳ 15°', () => BS.app.rotate(-15), 'sm'),
      button('90°', () => BS.app.rotate(90), 'sm'),
      button('0°', () => { e.rot = 0; BS.app.changed('place'); BS.app.commit(); UI.refreshLive(); }, 'sm')));
    return r;
  }

  function renderItemProps(pane, e, rerender) {
    const def = BS.items.LIB[e.type];
    const sz = (label, key, o = {}) => num(Object.assign({ label, get: () => e[key], set: (v) => { e[key] = v; }, min: 0.3, max: 2000, step: 0.5, what: 'items' }, o));
    let sizeRows;
    if (def.derive) {
      // 작품: 실제 크기(가로·세로)와 놓는 방식 → 가로·깊이·높이는 자동 계산
      const poses = e.type === 'paper' ? [['stand', '세워 놓기'], ['flat', '눕히기'], ['frame', '액자']]
        : e.type === 'book' ? [['closed', '덮은 책'], ['open', '펼친 책'], ['stand', '북스탠드']] : null;
      sizeRows = [
        el('div', { class: e.type === 'book' ? 'row3' : 'row2' }, sz('가로', 'pw', { label: e.type === 'book' ? '가로(한 면)' : '가로' }), sz('세로', 'ph'),
          e.type === 'book' ? sz('두께', 'thick') : null),
        poses ? seg({ label: '놓는 방식', get: () => e.pose, options: poses, set: (v) => { e.pose = v; }, what: 'items', after: rerender }) : null,
        e.type !== 'book' ? el('div', { class: 'preset-row' }, el('span', { class: 'muted' }, '규격'),
          ...BS.items.PAPER_SIZES.map(([n, w, h]) => button(n, () => {
            const land = e.pw > e.ph;
            e.pw = land ? h : w; e.ph = land ? w : h;
            BS.app.changed('items'); BS.app.commit(); UI.refreshLive();
          }, 'chip')),
          button('↻ 가로/세로', () => { [e.pw, e.ph] = [e.ph, e.pw]; BS.app.changed('items'); BS.app.commit(); UI.refreshLive(); }, 'chip')) : null,
        el('p', { class: 'hint' }, `차지하는 공간: ${U.fmt(e.w)}×${U.fmt(e.d)}×${U.fmt(e.h)} cm (자동 계산)`),
      ];
    } else if (def.round) {
      sizeRows = [el('div', { class: 'row2' }, sz('지름', 'w', { set: (v) => { e.w = v; e.d = v; } }), sz('높이', 'h'))];
    } else if (e.type === 'tv') {
      sizeRows = [
        el('div', { class: 'row2' }, sz('화면 가로', 'w'), sz('전체 높이', 'h')),
        el('div', { class: 'preset-row' }, el('span', { class: 'muted' }, '화면 크기'),
          ...[[43, 95], [50, 111], [55, 122], [65, 144], [75, 166], [86, 190]].map(([inch, w]) => button(`${inch}인치`, () => {
            e.w = w; BS.app.changed('items'); BS.app.commit(); UI.refreshLive();
          }, 'chip'))),
        sz('받침 깊이', 'd'),
      ];
    } else {
      sizeRows = [el('div', { class: 'row3' }, sz('가로', 'w'), sz('깊이', 'd'), sz('높이', 'h'))];
    }
    const colorLabel = e.type === 'paper' ? '액자 색' : e.type === 'book' ? '표지 색' : def.cloth && e.cloth ? '천 색' : '색상';
    pane.appendChild(section('크기 · 모양',
      e.type === 'solid' ? select({ label: '모양', get: () => e.form, options: [['cube', '정육면체/직육면체'], ['sphere', '구'], ['cylinder', '원기둥'], ['cone', '원뿔'], ['pyramid', '사각뿔'], ['torus', '고리']], set: (v) => { e.form = v; }, what: 'items' }) : null,
      ...sizeRows,
      e.type === 'paper' && e.pose !== 'frame' ? null : color({ label: colorLabel, get: () => e.color, set: (v) => { e.color = v; }, what: 'items' }),
      def.cloth ? check({ label: '천 덮개', get: () => e.cloth, set: (v) => { e.cloth = v; if (v && e.color === '#f2f2ee') e.color = '#1f3a68'; if (!v && e.color === '#1f3a68') e.color = '#f2f2ee'; }, what: 'items', after: rerender }) : null,
      e.type === 'table-rect' ? el('div', { class: 'preset-row' }, el('span', { class: 'muted' }, '대여 규격'),
        ...[[180, 60], [180, 45], [150, 60], [120, 60], [120, 45]].map(([w, d]) => button(`${w}×${d}`, () => { e.w = w; e.d = d; e.h = 72; BS.app.changed('items'); BS.app.commit(); UI.refreshLive(); }, 'chip'))) : null,
    ));
    if (def.image) {
      const isScreen = def.image === 'screen';
      const thumb = e.img && BS.assets[e.img] ? el('img', { class: 'thumb', src: BS.assets[e.img], alt: '올린 이미지' }) : el('div', { class: 'thumb empty' }, '이미지 없음');
      pane.appendChild(section(isScreen ? '화면 이미지' : (e.type === 'book' ? (e.pose === 'open' ? '펼친 면 이미지' : '표지 이미지') : '작품 이미지'),
        thumb,
        el('div', { class: 'btn-row' },
          button(e.img ? '이미지 바꾸기' : '이미지/PDF 올리기', () => pickImage(e, null), 'primary'),
          e.img ? button('지우기', () => { e.img = null; BS.app.changed('items'); BS.app.commit(); rerender(); }, 'sm') : null),
        e.img ? seg({ label: '비율', get: () => e.fit || (isScreen ? 'cover' : 'contain'), options: [['contain', '맞춤'], ['cover', '채우기'], ['stretch', '늘이기']], set: (v) => { e.fit = v; }, what: 'items', after: rerender }) : null,
        el('p', { class: 'hint' }, isScreen ? '발표 화면이나 영상 캡처를 올리면 화면에 보입니다.' : '작품 사진·스캔 이미지(PNG/JPG) 또는 PDF 첫 페이지.')));
    }
    pane.appendChild(section('위치 · 회전', ...floorPos(e),
      def.stack ? el('p', { class: 'hint' }, '테이블·선반·전시단 위로 옮기면 그 높이에 자동으로 올라갑니다.' + (BS.items.elev && BS.items.elev[e.id] ? ` (현재 ${BS.items.elev[e.id]}cm 위)` : '')) : null));
  }

  function renderPanelProps(pane, p, rerender) {
    const b = BS.state.booth;
    // 크기 · 테두리 (맨 위)
    pane.appendChild(section('크기 · 테두리',
      el('div', { class: 'row2' },
        num({ label: '가로', get: () => p.w, set: (v) => { p.w = v; }, min: 1, max: 2000, what: 'panels' }),
        num({ label: '세로', get: () => p.h, set: (v) => { p.h = v; }, min: 1, max: 1000, what: 'panels' })),
      el('div', { class: 'row3' },
        num({ label: '두께', get: () => p.thick, set: (v) => { p.thick = v; }, min: 0.1, max: 20, step: 0.1, what: 'panels' }),
        num({ label: '테두리', get: () => p.border, set: (v) => { p.border = v; }, min: 0, max: 20, step: 0.5, what: 'panels' }),
        color({ label: '테두리색', get: () => p.frameColor, set: (v) => { p.frameColor = v; }, what: 'panels' })),
    ));

    // 부착 방식
    pane.appendChild(section('설치 방식',
      seg({ get: () => p.mount, options: [['wall', '벽에 부착'], ['free', '바닥에 세우기']], set: (v) => {
        if (v === p.mount) return;
        p.mount = v;
        if (v === 'free') { p.x = 0; p.z = 0; p.rot = 0; p.y = BS.panels.STANDS[p.stand].y; }
        else { const inf = BS.booth.wallInfo(p.wall); p.u = Math.max(0, (inf.len - p.w) / 2); p.y = Math.max(0, Math.min(p.y, inf.h - p.h)); }
      }, what: 'panels', after: rerender }),
      ...(p.mount === 'wall' ? [
        seg({ label: '벽', get: () => p.wall, options: BS.WALL_KEYS.map((k) => [k, BS.WALL_SHORT[k] + (b.walls[k].on ? '' : '✕')]), set: (v) => {
          p.wall = v; const inf = BS.booth.wallInfo(v); p.u = U.clamp(p.u, 0, Math.max(0, inf.len - p.w));
        }, what: 'panels', after: rerender }),
        el('div', { class: 'row2' },
          num({ label: '벽 왼쪽 끝→왼쪽 끝', get: () => p.u, set: (v) => { p.u = v; }, what: 'place' }),
          num({ label: '바닥→하단', get: () => p.y, set: (v) => { p.y = v; }, what: 'place', min: 0 })),
        el('div', { class: 'btn-row' },
          button('가로 가운데', () => { const inf = BS.booth.wallInfo(p.wall); p.u = Math.max(0, (inf.len - p.w) / 2); BS.app.changed('place'); BS.app.commit(); UI.refreshLive(); }, 'sm'),
          button('세로 가운데', () => { const inf = BS.booth.wallInfo(p.wall); p.y = Math.max(0, (inf.h - p.h) / 2); BS.app.changed('place'); BS.app.commit(); UI.refreshLive(); }, 'sm'),
          button('눈높이(중심 150)', () => { p.y = Math.max(0, 150 - p.h / 2); BS.app.changed('place'); BS.app.commit(); UI.refreshLive(); }, 'sm')),
        el('p', { class: 'hint' }, '부스 안쪽에서 벽을 바라볼 때 기준입니다. 3D 화면에서 드래그하면 벽 모서리·다른 현수막에 붙습니다.'),
      ] : [
        select({ label: '거치대', get: () => p.stand, options: Object.entries(BS.panels.STANDS).map(([k, v]) => [k, v.label]), set: (v) => { p.stand = v; p.y = BS.panels.STANDS[v].y; }, what: 'panels', after: rerender }),
        num({ label: '바닥→판 하단', get: () => p.y, set: (v) => { p.y = v; }, what: 'panels', min: 0 }),
        ...floorPos(p),
      ]),
    ));


    // 칸 분할
    pane.appendChild(section('칸 분할',
      el('div', { class: 'row2' },
        num({ label: '열(가로 칸)', get: () => p.cols, set: (v) => { p.cols = Math.round(v); BS.defaults.fitCells(p); }, min: 1, max: 12, unit: '열', what: 'panels', after: () => renderCells(p) }),
        num({ label: '행(세로 칸)', get: () => p.rows, set: (v) => { p.rows = Math.round(v); BS.defaults.fitCells(p); }, min: 1, max: 12, unit: '행', what: 'panels', after: () => renderCells(p) })),
      el('div', { class: 'row-inline' },
        check({ label: '칸 구분선', get: () => p.divider, set: (v) => { p.divider = v; }, what: 'panels' }),
        color({ label: '', get: () => p.dividerColor, set: (v) => { p.dividerColor = v; }, what: 'panels' }),
        num({ label: '굵기', get: () => p.dividerWidth, set: (v) => { p.dividerWidth = v; }, min: 0, max: 20, step: 0.5, what: 'panels' })),
      el('div', { id: 'cells-box' }),
    ));
    renderCells(p);
  }

  /** 칸 선택 미니 그리드 + 칸 내용 편집기 */
  function renderCells(p) {
    const box = document.getElementById('cells-box');
    if (!box) return;
    box.innerHTML = '';
    UI.cellIdx = U.clamp(UI.cellIdx, 0, p.cells.length - 1);
    const cw = p.w / p.cols, ch = p.h / p.rows;
    box.appendChild(el('p', { class: 'hint' }, `칸 하나 크기: ${U.fmt(cw)} × ${U.fmt(ch)} cm  ·  편집할 칸을 고르세요`));
    const grid = el('div', { class: 'cell-grid', style: { gridTemplateColumns: `repeat(${p.cols}, 1fr)`, aspectRatio: `${p.w} / ${p.h}` } });
    p.cells.forEach((c, i) => {
      const lbl = c.mode === 'text' ? (c.title || '텍스트') : c.mode === 'image' ? '🖼 이미지' : c.mode === 'color' ? '' : '빈 칸';
      const b = el('button', { type: 'button', class: 'cell-btn' + (i === UI.cellIdx ? ' on' : ''), style: { background: c.mode === 'empty' ? '' : c.bg, color: c.color } },
        el('span', { class: 'ci' }, String(i + 1)), el('span', { class: 'ct' }, lbl));
      b.onclick = () => { UI.cellIdx = i; renderCells(p); };
      grid.appendChild(b);
    });
    box.appendChild(grid);

    const c = p.cells[UI.cellIdx];
    const redraw = () => renderCells(p);
    const ed = el('div', { class: 'cell-editor' });
    ed.appendChild(el('h4', null, `${UI.cellIdx + 1}번 칸 내용`));
    ed.appendChild(seg({ get: () => c.mode, options: [['image', '이미지'], ['text', '텍스트'], ['color', '단색'], ['empty', '빈 칸']], set: (v) => {
      c.mode = v;
      if (v === 'text' && !c.title && !c.body) c.title = '제목';
    }, what: 'panels', after: redraw }));

    if (c.mode === 'image') {
      const thumb = c.img && BS.assets[c.img] ? el('img', { class: 'thumb', src: BS.assets[c.img], alt: '업로드한 이미지' }) : el('div', { class: 'thumb empty' }, '이미지 없음');
      ed.appendChild(thumb);
      ed.appendChild(el('div', { class: 'btn-row' },
        button(c.img ? '이미지 바꾸기' : '이미지/PDF 올리기', () => pickImage(p, UI.cellIdx), 'primary'),
        c.img ? button('지우기', () => { c.img = null; BS.app.changed('panels'); BS.app.commit(); redraw(); }, 'sm') : null));
      ed.appendChild(el('p', { class: 'hint' }, 'PNG/JPG 또는 PDF 첫 페이지(슬라이드 내보내기 이미지 권장). 비율이 다르면 아래에서 고르세요.'));
      ed.appendChild(seg({ label: '비율', get: () => c.fit, options: [['contain', '맞춤'], ['cover', '채우기'], ['stretch', '늘이기']], set: (v) => { c.fit = v; }, what: 'panels', after: redraw }));
      ed.appendChild(color({ label: '여백 색', get: () => c.bg, set: (v) => { c.bg = v; }, what: 'panels' }));
    } else if (c.mode === 'text') {
      ed.appendChild(text({ label: '제목', get: () => c.title, set: (v) => { c.title = v; }, what: 'panels', debounce: 120, after: () => updateCellLabel(p) }));
      ed.appendChild(text({ label: '본문', get: () => c.body, set: (v) => { c.body = v; }, what: 'panels', multiline: true, rows: 3, debounce: 150 }));
      ed.appendChild(el('div', { class: 'row2' },
        num({ label: '제목 글자 높이', get: () => c.titleSize, set: (v) => { c.titleSize = v; }, min: 0.5, max: 100, step: 0.5, what: 'panels' }),
        num({ label: '본문 글자 높이', get: () => c.bodySize, set: (v) => { c.bodySize = v; }, min: 0.5, max: 100, step: 0.5, what: 'panels' })));
      ed.appendChild(el('div', { class: 'row2' },
        color({ label: '글자색', get: () => c.color, set: (v) => { c.color = v; }, what: 'panels', }),
        color({ label: '배경색', get: () => c.bg, set: (v) => { c.bg = v; }, what: 'panels' })));
      ed.appendChild(seg({ label: '정렬', get: () => c.align, options: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], set: (v) => { c.align = v; }, what: 'panels', after: redraw }));
    } else if (c.mode === 'color') {
      ed.appendChild(color({ label: '칸 색', get: () => c.bg, set: (v) => { c.bg = v; }, what: 'panels', }));
    } else {
      ed.appendChild(el('p', { class: 'hint' }, '빈 칸은 자리표시자(빗금)로 보입니다. 나중에 내용을 채우세요.'));
    }
    if (p.cells.length > 1) {
      ed.appendChild(el('div', { class: 'btn-row' },
        button('이 칸 글꼴·색을 모든 텍스트 칸에 적용', () => {
          for (const o of p.cells) if (o !== c && o.mode === 'text') { o.titleSize = c.titleSize; o.bodySize = c.bodySize; o.color = c.color; o.bg = c.bg; o.align = c.align; }
          BS.app.changed('panels'); BS.app.commit(); redraw();
        }, 'sm')));
    }
    box.appendChild(ed);
  }
  function updateCellLabel(p) {
    const btns = document.querySelectorAll('#cells-box .cell-btn');
    const c = p.cells[UI.cellIdx];
    if (btns[UI.cellIdx]) btns[UI.cellIdx].querySelector('.ct').textContent = c.title || '텍스트';
  }

  let pickTarget = null;
  function pickImage(p, idx) {
    pickTarget = { id: p.id, idx }; // idx === null → 물품(작품/화면) 이미지
    document.getElementById('file-image').click();
  }
  async function onImageFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !pickTarget) return;
    const p = BS.find(pickTarget.id);
    if (!p) return;
    try {
      const r = await BS.storage.readImageFile(f);
      if (pickTarget.idx === null) {
        p.img = BS.addAsset(r.dataURL);
        BS.app.changed('items'); BS.app.commit();
        BS.toast('이미지를 넣었습니다');
        if (BS.app.selId === p.id) renderSel();
        return;
      }
      const c = p.cells[pickTarget.idx];
      c.mode = 'image';
      c.img = BS.addAsset(r.dataURL);
      // 이미지 비율과 칸 비율 비교 안내
      const cr = (p.w / p.cols) / (p.h / p.rows), ir = r.w / r.h;
      BS.app.changed('panels'); BS.app.commit();
      if (Math.abs(cr - ir) / cr > 0.04) BS.toast(`이미지 비율(${ir.toFixed(2)})이 칸 비율(${cr.toFixed(2)})과 다릅니다 — 맞춤/채우기/늘이기를 골라 보세요`, 'info', 5000);
      else BS.toast('이미지를 넣었습니다');
      if (BS.app.selId === p.id) renderSel();
    } catch (err) {
      console.error(err);
      BS.toast('이미지를 넣지 못했습니다: ' + err.message, 'error', 5000);
    }
  }

  /* ---------------------------------------------------------------
   * [목록] 탭 — 레이어 패널
   * ------------------------------------------------------------- */
  function renderLayers() {
    const pane = document.getElementById('tab-layers');
    pane.innerHTML = '';
    const mk = (e) => {
      const def = e.kind === 'item' ? BS.items.LIB[e.type] : null;
      const spec = e.kind === 'panel' ? `${U.fmt(e.w)}×${U.fmt(e.h)}` : def && def.round ? `Ø${U.fmt(e.w)}×${U.fmt(e.h)}` : `${U.fmt(e.w)}×${U.fmt(e.d)}×${U.fmt(e.h)}`;
      const sub = e.kind === 'panel' ? (e.mount === 'wall' ? BS.WALL_LABEL[e.wall] : BS.panels.STANDS[e.stand].label) : def.label;
      const r = el('div', { class: 'layer' + (e.id === BS.app.selId ? ' on' : '') + (e.hidden ? ' hid' : ''), 'data-id': e.id },
        el('button', { type: 'button', class: 'layer-name', onclick: () => BS.app.select(e.id), ondblclick: () => BS.app.focus(e.id), title: '클릭: 선택 · 더블클릭: 포커스' },
          el('span', { class: 'ln' }, e.name),
          el('span', { class: 'ls' }, `${sub} · ${spec}`)),
        el('span', { class: 'lw', title: (BS.app.warnings[e.id] || []).join(', ') }, BS.app.warnings[e.id] ? '⚠' : ''),
        el('button', { type: 'button', class: 'ib' + (e.hidden ? ' on' : ''), title: e.hidden ? '보이기' : '숨기기', onclick: () => {
          e.hidden = !e.hidden; BS.app.changed(e.kind === 'panel' ? 'panels' : 'items'); BS.app.commit(); renderLayers(); if (e.id === BS.app.selId) renderSel();
        } }, e.hidden ? '🙈' : '👁'),
        el('button', { type: 'button', class: 'ib' + (e.locked ? ' on' : ''), title: e.locked ? '잠금 해제' : '잠그기(실수로 안 움직이게)', onclick: () => {
          e.locked = !e.locked; BS.app.commit(); renderLayers(); if (e.id === BS.app.selId) renderSel();
        } }, e.locked ? '🔒' : '🔓'));
      return r;
    };
    const ps = BS.state.panels, its = BS.state.items;
    pane.appendChild(section(`현수막 · 패널 (${ps.length})`, ps.length ? el('div', { class: 'layers' }, ...ps.map(mk)) : el('p', { class: 'hint' }, '[물품 추가] 탭에서 현수막을 만드세요.')));
    pane.appendChild(section(`물품 (${its.length})`, its.length ? el('div', { class: 'layers' }, ...its.map(mk)) : el('p', { class: 'hint' }, '[물품 추가] 탭에서 테이블·의자·작품을 넣으세요.')));
    const cnt = {};
    for (const it of its) { const d = BS.items.LIB[it.type]; if (!d.ghost) cnt[d.label] = (cnt[d.label] || 0) + 1; }
    pane.appendChild(section('개수 요약', el('div', { class: 'summary' },
      ...Object.entries(cnt).map(([k, v]) => el('span', { class: 'chip-s' }, `${k} ${v}`)),
      el('span', { class: 'chip-s' }, `현수막·패널 ${ps.length}`))));
  }
  /** 경고 아이콘만 갱신(드래그 중 전체 다시 그리기 방지) */
  UI.layerStatusOnly = function () {
    document.querySelectorAll('#tab-layers .layer').forEach((r) => {
      const w = BS.app.warnings[r.dataset.id];
      const s = r.querySelector('.lw');
      s.textContent = w ? '⚠' : ''; s.title = w ? w.join(', ') : '';
    });
  };
  UI.layerNamesOnly = function () {
    document.querySelectorAll('#tab-layers .layer').forEach((r) => {
      const e = BS.find(r.dataset.id);
      if (e) r.querySelector('.ln').textContent = e.name;
    });
  };

  /* ---------------------------------------------------------------
   * [저장·인쇄] 탭 — 큰 제목마다 접기
   * ------------------------------------------------------------- */
  function renderFile() {
    const pane = document.getElementById('tab-file');
    pane.innerHTML = '';
    pane.appendChild(fold('file.cloud', '클라우드 저장 · 공유', el('div', { id: 'cloud-box' })));
    BS.cloud.render();
    pane.appendChild(fold('file.print', '이미지 · 인쇄물',
      el('div', { class: 'btn-col' },
        button('📷 현재 3D 화면 스크린샷 (PNG)', () => BS.storage.screenshot()),
        button('📐 평면도 + 벽면 입면도 (PNG)', () => BS.storage.exportPlan('png')),
        button('🖨 평면도 + 벽면 입면도 (PDF, A3)', () => BS.storage.exportPlan('pdf')),
        button('📋 물품 목록 (CSV, 엑셀)', () => BS.storage.exportCSV())),
      el('p', { class: 'hint' }, '평면도에는 각 물품의 번호·규격·설치 위치(왼쪽 벽/뒷벽에서 거리)가, 입면도에는 현수막의 가로 위치와 하단 높이가 표시됩니다.')));
    pane.appendChild(fold('file.json', '파일로 저장 · 불러오기 (JSON)',
      el('p', { class: 'hint' }, '인터넷 없이 보관하거나 다른 곳으로 옮길 때 씁니다 (올린 이미지 포함).'),
      el('div', { class: 'btn-col' },
        button('💾 JSON 파일로 내보내기', () => BS.storage.exportJSON()),
        button('📂 JSON 파일 불러오기', () => document.getElementById('file-json').click()))));
  }

  /* ---------------------------------------------------------------
   * 조작 방법 팝업 ([조작방법] 버튼 또는 ? 키)
   * ------------------------------------------------------------- */
  UI.openHelp = function () {
    const modal = document.getElementById('modal');
    const card = modal.querySelector('.modal-card');
    if (UI._onClose) UI.closeModal();
    card.innerHTML = '';
    const k = (t) => el('kbd', null, t);
    const tr = (keys, desc) => el('tr', null, el('td', null, ...keys), el('td', null, desc));
    card.append(
      el('h2', { id: 'modal-title' }, '조작 방법'),
      el('h3', null, '화면 보기'),
      el('table', { class: 'help-table' },
        tr(['마우스 왼쪽 드래그'], '화면 회전'),
        tr(['마우스 휠'], '확대 / 축소'),
        tr(['마우스 오른쪽 드래그'], '화면 이동'),
        tr(['한 손가락 / 두 손가락'], '터치: 회전 / 확대·이동'),
        tr([k('방향키')], '아무것도 선택하지 않았을 때 화면을 앞뒤·좌우로 이동 (Shift: 빠르게)'),
        tr([k('1'), '~', k('6')], '정면 · 좌측 · 우측 · 평면도 · 조감 · 눈높이'),
        tr([k('G'), ' ', k('M')], '바닥 격자 / 치수선 켜기·끄기'),
        tr(['눈높이 시점'], 'W/A/S/D·방향키로 걷기, Q/E 회전, 드래그로 둘러보기, Esc 종료')),
      el('h3', null, '물체 다루기'),
      el('table', { class: 'help-table' },
        tr(['클릭 / 드래그'], '선택 / 이동 (벽 현수막은 벽 위에서)'),
        tr([k('방향키')], '선택한 물체를 스냅 간격만큼 이동 (Shift: 10cm)'),
        tr([k('R'), ' ', k('Shift+R')], '15° 회전'),
        tr([k('F'), ' / 더블클릭'], '선택한 물체로 화면 이동(포커스)'),
        tr([k('Ctrl+D')], '복제'),
        tr([k('Delete')], '삭제'),
        tr([k('Esc')], '선택 해제')),
      el('h3', null, '저장 · 되돌리기'),
      el('table', { class: 'help-table' },
        tr([k('Ctrl+Z')], '실행취소'),
        tr([k('Ctrl+Shift+Z')], '다시실행'),
        tr([k('Ctrl+S')], '바로 저장 (평소에는 고칠 때마다 자동 저장)')),
      el('p', { class: 'hint' }, '빨간색으로 보이면 다른 물체와 겹치거나 부스·벽 밖으로 나간 상태입니다. 테이블을 먼저 선택한 뒤 작품을 추가하면 그 위에 놓입니다.'),
      el('div', { class: 'modal-actions' }, button('닫기', () => UI.closeModal(), 'primary')),
    );
    modal.hidden = false;
  };


  /* ---------------------------------------------------------------
   * 선택 물체 빠른 조작 막대 (화면 하단)
   * ------------------------------------------------------------- */
  function renderSelbar() {
    const bar = document.getElementById('selbar');
    const e = BS.app.selected();
    if (!e) { bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('has-sel'); return; }
    bar.hidden = false;
    bar.innerHTML = '';
    const isWall = e.kind === 'panel' && e.mount === 'wall';
    const spec = e.kind === 'panel' ? `${U.fmt(e.w)}×${U.fmt(e.h)}cm` : `${U.fmt(e.w)}×${U.fmt(e.d)}×${U.fmt(e.h)}cm`;
    bar.append(...[
      el('div', { class: 'sb-name' }, el('b', null, (e.locked ? '🔒 ' : '') + e.name), el('span', null, spec)),
      isWall ? null : button('⟲', () => BS.app.rotate(15), 'sb', '15° 회전 (R)'),
      isWall ? null : button('⟳', () => BS.app.rotate(-15), 'sb', '-15° 회전 (Shift+R)'),
      button('◎', () => BS.app.focus(), 'sb', '포커스 (F)'),
      button('⧉', () => BS.app.duplicate(), 'sb', '복제 (Ctrl+D)'),
      button('🗑', () => BS.app.remove(), 'sb danger', '삭제 (Delete)'),
      button('속성', () => document.body.classList.add('insp-open'), 'sb wide', '속성 편집'),
      button('✕', () => BS.app.select(null), 'sb', '선택 해제 (Esc)'),
    ].filter(Boolean));
    document.body.classList.toggle('has-sel', true);
  }

  /* ---------------------------------------------------------------
   * 새로 시작 창: 배치 이름 · 벽 형태 · 크기 · (클라우드) 비밀번호
   * ------------------------------------------------------------- */
  UI.openNew = function () {
    const modal = document.getElementById('modal');
    const card = modal.querySelector('.modal-card');
    if (UI._onClose) UI.closeModal();
    card.innerHTML = '';
    const cloud = BS.cloud.available();
    const cfg = { shape: 'U', w: 300, d: 300, h: 240, demo: false };
    const nInp = (k, label) => {
      const i = el('input', { type: 'number', min: 50, max: 3000, value: cfg[k], inputmode: 'decimal' });
      i.oninput = () => { cfg[k] = U.num(i.value, cfg[k]); };
      return el('label', { class: 'mnum' }, el('span', null, label), el('div', { class: 'num-wrap' }, i, el('span', { class: 'unit' }, 'cm')));
    };
    const title = el('input', { type: 'text', maxlength: 100, placeholder: '예) 3학년 과학 수업나눔 부스' });
    const pw = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '4자 이상' });
    const pw2 = el('input', { type: 'password', autocomplete: 'new-password' });
    const demo = el('input', { type: 'checkbox' });
    demo.onchange = () => { cfg.demo = demo.checked; };
    const err = el('p', { class: 'form-error' });
    const mf = (label, input, hint) => el('label', { class: 'mfield' }, el('span', null, label), input, hint ? el('small', null, hint) : null);
    card.append(
      el('h2', { id: 'modal-title' }, '새로 시작'),
      el('h3', null, '1. 배치 이름'),
      mf('', title, cloud ? '[불러오기] 목록에 이 이름으로 보입니다.' : null),
      el('h3', null, '2. 벽 형태'),
      shapePicker(() => cfg.shape, (k) => { cfg.shape = k; }),
      el('h3', null, '3. 크기 (cm)'),
      el('div', { class: 'mnums' }, nInp('w', '폭'), nInp('d', '깊이'), nInp('h', '벽 높이')),
      el('div', { class: 'preset-row' }, el('span', { class: 'muted' }, '자주 쓰는 크기'),
        ...[[300, 300], [300, 200], [600, 300], [200, 200]].map(([w, d]) => button(`${w}×${d}`, () => {
          cfg.w = w; cfg.d = d;
          card.querySelectorAll('.mnum input')[0].value = w; card.querySelectorAll('.mnum input')[1].value = d;
        }, 'chip'))),
      el('label', { class: 'check big' }, demo, ' 예시 배치 넣기 (뒷벽 연구학교 현수막 + 테이블 2개 + 의자 4개)'),
      cloud ? el('h3', null, '4. 비밀번호') : null,
      cloud ? el('div', { class: 'cloud-form' },
        mf('비밀번호', pw, '이 배치를 열고 고칠 때 필요합니다. 함께 작업할 선생님과 공유하세요. 이 브라우저에는 기억되어 다시 묻지 않습니다.'),
        mf('비밀번호 확인', pw2)) : el('p', { class: 'hint' }, '지금은 파일로 열어서 클라우드 저장을 쓸 수 없습니다. 이 브라우저에만 자동 저장됩니다.'),
      err,
      el('div', { class: 'modal-actions' },
        button('취소', () => UI.closeModal(), ''),
        button('만들기', () => {
          const name = title.value.trim();
          if (!name) { err.textContent = '배치 이름을 입력하세요'; title.focus(); return; }
          if (cloud && pw.value.length < 4) { err.textContent = '비밀번호는 4자 이상이어야 합니다'; pw.focus(); return; }
          if (cloud && pw.value !== pw2.value) { err.textContent = '비밀번호 확인이 일치하지 않습니다'; pw2.focus(); return; }
          const w = U.clamp(cfg.w, 50, 3000), d = U.clamp(cfg.d, 50, 3000), h = U.clamp(cfg.h, 30, 600);
          UI.closeModal();
          BS.app.newBooth(cfg.shape, w, d, h, cfg.demo, name);
          if (cloud) BS.cloud.create(name, pw.value);
          else BS.toast(`"${name}" 을(를) 만들었습니다`);
        }, 'primary')),
    );
    modal.hidden = false;
    setTimeout(() => title.focus(), 50);
  };
  UI.openSetup = UI.openNew; // 예전 이름 호환

  UI.closeModal = function () {
    const modal = document.getElementById('modal');
    if (modal.hidden) return false;
    modal.hidden = true;
    if (UI._onClose) { const f = UI._onClose; UI._onClose = null; f(); } // 대화상자 취소 처리
    return true;
  };
})(window.BS);
