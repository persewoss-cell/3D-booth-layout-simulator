/* =====================================================================
 * scene.js — 렌더러 · 카메라 · 조명 · 격자 · 치수선 · 시점 프리셋 · 걷기 모드
 * ---------------------------------------------------------------------
 *  - 원근 카메라(OrbitControls) + 평면도용 정사영 카메라 두 개를 운용
 *  - 화면이 바뀔 때만 다시 그리는 on-demand 렌더링(배터리·발열 절약)
 * ===================================================================== */
(function (BS) {
  'use strict';
  const U = BS.util;
  const S = BS.scene = {
    dirty: true,       // 다음 프레임에 다시 그릴지
    mode: 'orbit',     // 'orbit' | 'ortho' | 'walk'
    tween: null,
  };

  S.requestRender = () => { S.dirty = true; };

  /* ---------------------------------------------------------------
   * 초기화
   * ------------------------------------------------------------- */
  S.init = function (host) {
    const THREE = window.THREE;
    S.host = host;

    // --- 렌더러 ---
    const r = S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    r.domElement.tabIndex = 0;
    S.maxAniso = r.capabilities.getMaxAnisotropy();
    S.maxTex = r.capabilities.maxTextureSize;

    // 상호작용 모듈이 OrbitControls 보다 먼저 pointerdown 을 받도록 미리 등록
    r.domElement.addEventListener('pointerdown', (e) => S.onPreDown && S.onPreDown(e));

    // --- 장면 ---
    const scene = S.scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9edf2');

    // --- 카메라 ---
    S.persp = new THREE.PerspectiveCamera(45, 1, 1, 40000);
    S.persp.position.set(420, 330, 560);
    S.ortho = new THREE.OrthographicCamera(-200, 200, 200, -200, 1, 40000);
    S.ortho.up.set(0, 0, -1);       // 평면도: 화면 위쪽 = 뒷벽
    S.ortho.position.set(0, 2000, 0);
    S.camera = S.persp;

    // --- 컨트롤(원근) ---
    const OC = BS.OrbitControls;
    const c = S.controls = new OC(S.persp, r.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.minDistance = 4;          // 작품 글씨가 읽힐 만큼 가까이
    c.maxDistance = 8000;       // 전시장 전체가 보일 만큼 멀리
    c.maxPolarAngle = Math.PI * 0.495;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.zoomSpeed = 1.1;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.target.set(0, 90, 0);
    c.addEventListener('change', S.requestRender);
    c.addEventListener('start', () => { S.tween = null; });

    // --- 컨트롤(정사영 평면도) ---
    const oc = S.orthoControls = new OC(S.ortho, r.domElement);
    oc.enableRotate = false;
    oc.screenSpacePanning = true;
    oc.zoomToCursor = true;
    oc.minZoom = 0.15; oc.maxZoom = 60;
    oc.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    oc.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    oc.enabled = false;
    oc.addEventListener('change', S.requestRender);

    // --- 조명: 환경광(반구) + 주광(그림자) + 보조광 ---
    const hemi = new THREE.HemisphereLight('#ffffff', '#b8b1a6', 1.6);
    scene.add(hemi);
    const sun = S.sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(260, 620, 420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 4;
    scene.add(sun); scene.add(sun.target);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.6);
    fill.position.set(-400, 300, 300);
    scene.add(fill);

    // --- 전시장 바닥(넓은 평면) ---
    const hall = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.MeshStandardMaterial({ color: '#d8dbdf', roughness: 0.95 })
    );
    hall.rotation.x = -Math.PI / 2;
    hall.position.y = -1.2;
    hall.receiveShadow = true;
    scene.add(hall);

    // --- 레이어 그룹 ---
    S.boothGroup = new THREE.Group(); scene.add(S.boothGroup);
    S.panelGroup = new THREE.Group(); scene.add(S.panelGroup);
    S.itemGroup = new THREE.Group(); scene.add(S.itemGroup);
    S.gridGroup = new THREE.Group(); scene.add(S.gridGroup);
    S.dimGroup = new THREE.Group(); scene.add(S.dimGroup);
    S.selDimGroup = new THREE.Group(); scene.add(S.selDimGroup);

    // --- 크기 대응 ---
    const ro = new ResizeObserver(() => S.resize());
    ro.observe(host);
    S.resize();

    // --- 걷기 모드 키 입력 ---
    S.keys = {};
    window.addEventListener('keydown', (e) => {
      if (S.mode !== 'walk' || BS.isTyping()) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e', 'shift'].includes(k)) {
        S.keys[k] = true;
        if (k.startsWith('arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => { S.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { S.keys = {}; });

    S.clock = new THREE.Clock();
    requestAnimationFrame(S.loop);
  };

  S.resize = function () {
    const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
    S.renderer.setSize(w, h, false);
    S.renderer.domElement.style.width = w + 'px';
    S.renderer.domElement.style.height = h + 'px';
    S.persp.aspect = w / h;
    S.persp.updateProjectionMatrix();
    S.updateOrthoFrustum();
    S.requestRender();
  };

  /** 정사영 카메라의 기본 화면 높이(cm) — zoom 은 컨트롤이 조절 */
  S.orthoSpan = 600;
  S.updateOrthoFrustum = function () {
    const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
    const a = w / h, hs = S.orthoSpan / 2;
    S.ortho.left = -hs * a; S.ortho.right = hs * a;
    S.ortho.top = hs; S.ortho.bottom = -hs;
    S.ortho.updateProjectionMatrix();
  };

  /** 그림자 카메라 범위를 부스 크기에 맞춤 */
  S.fitShadow = function (b) {
    const R = Math.max(b.width, b.depth) * 0.5 + (b.aisle ? b.aisleWidth : 0) + 200;
    const cam = S.sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.near = 10; cam.far = 3000;
    cam.updateProjectionMatrix();
    S.sun.target.position.set(0, 0, 0);
  };

  /* ---------------------------------------------------------------
   * 렌더 루프
   * ------------------------------------------------------------- */
  S.loop = function () {
    requestAnimationFrame(S.loop);
    const dt = Math.min(0.1, S.clock.getDelta());
    let changed = false;

    if (S.tween) { S.stepTween(); changed = true; }
    if (S.mode !== 'walk' && S.stepPan(dt)) changed = true;
    if (S.mode === 'walk') { if (S.stepWalk(dt)) changed = true; }
    else if (S.mode === 'ortho') { if (S.orthoControls.update()) changed = true; }
    else if (S.controls.enabled || S.controls.enableDamping) { if (S.controls.update()) changed = true; }

    if (changed || S.dirty) {
      S.dirty = false;
      if (S.onBeforeRender) S.onBeforeRender();
      S.renderer.render(S.scene, S.camera);
    }
  };

  /** 지금 화면을 강제로 그리고 PNG dataURL 반환 */
  S.capture = function () {
    if (S.onBeforeRender) S.onBeforeRender();
    S.renderer.render(S.scene, S.camera);
    return S.renderer.domElement.toDataURL('image/png');
  };

  /* ---------------------------------------------------------------
   * 카메라 이동(부드러운 전환)
   * ------------------------------------------------------------- */
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  S.flyTo = function (pos, target, dur = 700) {
    const THREE = window.THREE;
    if (S.mode !== 'orbit') S.setMode('orbit');
    S.tween = {
      p0: S.persp.position.clone(), t0: S.controls.target.clone(),
      p1: new THREE.Vector3().copy(pos), t1: new THREE.Vector3().copy(target),
      start: performance.now(), dur,
    };
  };

  S.stepTween = function () {
    const tw = S.tween;
    const k = Math.min(1, (performance.now() - tw.start) / tw.dur);
    const e = ease(k);
    S.persp.position.lerpVectors(tw.p0, tw.p1, e);
    S.controls.target.lerpVectors(tw.t0, tw.t1, e);
    S.persp.lookAt(S.controls.target);
    if (k >= 1) { S.tween = null; S.controls.update(); }
  };

  /** 크기(size)의 물체가 화면에 꽉 차도록 하는 거리 */
  S.fitDistance = function (w, h, margin = 1.25) {
    const fov = U.rad(S.persp.fov);
    const dv = (h / 2) / Math.tan(fov / 2);
    const dh = (w / 2) / (Math.tan(fov / 2) * S.persp.aspect);
    return Math.max(dv, dh) * margin;
  };

  /* ---------------------------------------------------------------
   * 모드 전환: orbit(원근) / ortho(평면도) / walk(관람객 걷기)
   * ------------------------------------------------------------- */
  S.setMode = function (mode) {
    S.mode = mode;
    S.tween = null;
    S.controls.enabled = mode === 'orbit';
    S.orthoControls.enabled = mode === 'ortho';
    S.camera = mode === 'ortho' ? S.ortho : S.persp;
    document.body.classList.toggle('walk-mode', mode === 'walk');
    document.body.classList.toggle('ortho-mode', mode === 'ortho');
    if (mode === 'orbit') {
      // 걷기 모드에서 돌아올 때 회전 중심을 시선 앞쪽에 둔다
      const dir = new window.THREE.Vector3();
      S.persp.getWorldDirection(dir);
      if (S.controls.target.distanceTo(S.persp.position) < 20) {
        S.controls.target.copy(S.persp.position).addScaledVector(dir, 250);
      }
    }
    BS.emit('viewMode', mode);
    S.requestRender();
  };

  /** 시점 프리셋 */
  S.setView = function (name) {
    const THREE = window.THREE;
    const b = BS.state.booth;
    const W = b.width, D = b.depth, H = b.height;
    const cy = H * 0.45;
    const tgt = new THREE.Vector3(0, cy, 0);
    let pos;
    switch (name) {
      case 'front': {
        const d = S.fitDistance(W + 60, H + 60);
        pos = new THREE.Vector3(0, cy + 20, D / 2 + d); break;
      }
      case 'left': {
        const d = S.fitDistance(D + 60, H + 60);
        pos = new THREE.Vector3(-(W / 2 + d), cy + 20, 0); break;
      }
      case 'right': {
        const d = S.fitDistance(D + 60, H + 60);
        pos = new THREE.Vector3(W / 2 + d, cy + 20, 0); break;
      }
      case 'diag': {
        const d = S.fitDistance(Math.hypot(W, D) + 60, H + 140, 1.45);
        pos = tgt.clone().addScaledVector(new THREE.Vector3(0.6, 0.62, 1).normalize(), d);
        break;
      }
      case 'top': return S.topView();
      case 'eye': return S.startWalk();
      default: return;
    }
    S.flyTo(pos, tgt);
  };

  /** 위에서 본 평면도(정사영) */
  S.topView = function () {
    const b = BS.state.booth;
    S.setMode('ortho');
    const extraZ = b.aisle ? Math.min(b.aisleWidth, 250) : 0;
    const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
    const needW = b.width + 120, needH = b.depth + 120 + extraZ;
    S.orthoSpan = Math.max(needH, needW * h / w);
    S.updateOrthoFrustum();
    S.ortho.zoom = 1;
    const cz = extraZ / 2;
    S.orthoControls.target.set(0, 0, cz);
    S.ortho.position.set(0, 2000, cz);
    S.ortho.lookAt(0, 0, cz);
    S.ortho.updateProjectionMatrix();
    S.orthoControls.update();
    S.requestRender();
  };

  /* ---------------------------------------------------------------
   * 관람객 시점 걷기 모드 (눈높이 150cm)
   *   W/S/↑/↓: 앞뒤   A/D: 옆걸음   ←/→, Q/E: 회전   Shift: 빠르게
   *   마우스/한 손가락 드래그: 둘러보기   휠: 앞뒤 이동
   * ------------------------------------------------------------- */
  S.walk = { yaw: 0, pitch: -0.05, eye: 150, speed: 110, look: null };

  S.startWalk = function () {
    const b = BS.state.booth;
    S.setMode('walk');
    S.walk.yaw = 0; S.walk.pitch = -0.06;
    S.persp.position.set(0, S.walk.eye, b.depth / 2 + Math.max(160, b.width * 0.55));
    S.applyWalkCam();
    BS.toast('관람객 시점: W/A/S/D 또는 화살표로 이동, 드래그로 둘러보기, Esc로 종료', 'info', 4200);
  };

  S.applyWalkCam = function () {
    const THREE = window.THREE;
    const w = S.walk;
    w.pitch = U.clamp(w.pitch, -1.35, 1.35);
    const dir = new THREE.Vector3(
      -Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.cos(w.yaw) * Math.cos(w.pitch));
    S.persp.position.y = w.eye;
    S.persp.lookAt(S.persp.position.clone().add(dir));
    S.requestRender();
  };

  /** 걷기 이동 1 스텝 (화면 하단 방향 패드도 S.keys 를 사용) */
  S.stepWalk = function (dt) {
    const k = S.keys, w = S.walk;
    const sp = w.speed * (k.shift ? 2.5 : 1) * dt;
    let fwd = 0, side = 0, turn = 0;
    if (k.w || k.arrowup) fwd += 1;
    if (k.s || k.arrowdown) fwd -= 1;
    if (k.a) side -= 1;
    if (k.d) side += 1;
    if (k.arrowleft || k.q) turn += 1;
    if (k.arrowright || k.e) turn -= 1;
    if (!fwd && !side && !turn) return false;
    w.yaw += turn * 1.6 * dt;
    const sx = -Math.sin(w.yaw), sz = -Math.cos(w.yaw);
    S.persp.position.x += (sx * fwd + -sz * side) * sp;
    S.persp.position.z += (sz * fwd + sx * side) * sp;
    S.applyWalkCam();
    return true;
  };

  S.walkWheel = function (dy) {
    const w = S.walk;
    const step = -Math.sign(dy) * 25;
    S.persp.position.x += -Math.sin(w.yaw) * step;
    S.persp.position.z += -Math.cos(w.yaw) * step;
    S.applyWalkCam();
  };

  /* ---------------------------------------------------------------
   * 방향키 화면 이동 (선택한 물체가 없을 때)
   *   ↑↓: 화면 앞뒤(바닥과 평행)  ←→: 좌우   Shift: 3배 빠르게
   *   카메라와 회전 중심을 함께 옮기므로 보는 각도는 그대로 유지
   * ------------------------------------------------------------- */
  S.panKeys = {};
  S.stepPan = function (dt) {
    const k = S.panKeys;
    const fwd = (k.arrowup ? 1 : 0) - (k.arrowdown ? 1 : 0);
    const side = (k.arrowright ? 1 : 0) - (k.arrowleft ? 1 : 0);
    if (!fwd && !side) return false;
    const THREE = window.THREE;
    const ortho = S.mode === 'ortho';
    const cam = ortho ? S.ortho : S.persp;
    const ctl = ortho ? S.orthoControls : S.controls;
    // 멀리서 볼수록 빠르게
    const dist = ortho ? S.orthoSpan / cam.zoom : cam.position.distanceTo(ctl.target);
    const speed = U.clamp(dist * 0.6, 40, 1500) * (S.panFast ? 3 : 1) * dt;
    let f, r;
    if (ortho) { f = new THREE.Vector3(0, 0, -1); r = new THREE.Vector3(1, 0, 0); } // 평면도: 위쪽 = 뒷벽
    else {
      f = new THREE.Vector3(); cam.getWorldDirection(f); f.y = 0;
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    }
    const move = f.multiplyScalar(fwd * speed).add(r.multiplyScalar(side * speed));
    cam.position.add(move);
    ctl.target.add(move);
    S.tween = null;
    return true;
  };

  /* ---------------------------------------------------------------
   * 포커스: 선택 물체를 화면 가운데로 부드럽게
   * ------------------------------------------------------------- */
  S.focusObject = function (obj3d, normal) {
    const THREE = window.THREE;
    if (!obj3d) return;
    const box = new THREE.Box3().setFromObject(obj3d);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    if (S.mode === 'ortho') {
      S.orthoControls.target.set(c.x, 0, c.z);
      S.ortho.position.set(c.x, 2000, c.z);
      S.ortho.zoom = U.clamp(S.orthoSpan / (Math.max(size.x, size.z) * 2.2), 0.3, 40);
      S.ortho.updateProjectionMatrix();
      S.orthoControls.update();
      S.requestRender();
      return;
    }
    let dir;
    if (normal) {
      dir = normal.clone().normalize();
      dir.y = 0.12; dir.normalize();
    } else {
      dir = S.persp.position.clone().sub(S.controls.target);
      if (S.mode === 'walk' || dir.lengthSq() < 1) dir.set(0.4, 0.5, 1);
      dir.y = Math.max(dir.y, dir.length() * 0.25);
      dir.normalize();
    }
    const span = normal ? Math.max(size.x, size.z, size.y) : Math.max(size.x, size.y, size.z);
    const dist = Math.max(span < 60 ? 80 : 45, S.fitDistance(span, span, 1.7));
    S.flyTo(c.clone().addScaledVector(dir, dist), c);
  };

  /* ---------------------------------------------------------------
   * 바닥 눈금 격자 (10cm / 50cm / 100cm)
   * ------------------------------------------------------------- */
  S.buildGrid = function () {
    const THREE = window.THREE;
    const b = BS.state.booth;
    clearGroup(S.gridGroup);
    const mx = Math.ceil((b.width / 2 + 100) / 100) * 100;
    const mzBack = Math.ceil((b.depth / 2 + 100) / 100) * 100;
    const mzFront = Math.ceil((b.depth / 2 + (b.aisle ? b.aisleWidth : 0) + 60) / 100) * 100;
    const layers = [
      { step: 10, color: '#56606c', opacity: 0.16 },
      { step: 50, color: '#3a4450', opacity: 0.32 },
      { step: 100, color: '#1f2a36', opacity: 0.55 },
    ];
    layers.forEach((L, li) => {
      const pts = [];
      for (let x = -mx; x <= mx + 0.01; x += L.step) {
        if (li < 2 && Math.abs(x % layers[li + 1].step) < 0.01) continue;
        pts.push(x, 0, -mzBack, x, 0, mzFront);
      }
      for (let z = -mzBack; z <= mzFront + 0.01; z += L.step) {
        if (li < 2 && Math.abs(z % layers[li + 1].step) < 0.01) continue;
        pts.push(-mx, 0, z, mx, 0, z);
      }
      // 부스 중심이 원점이므로 100cm 선이 부스 가장자리와 맞도록 오프셋 하지 않음
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineBasicMaterial({ color: L.color, transparent: true, opacity: L.opacity, depthWrite: false });
      const ls = new THREE.LineSegments(g, m);
      ls.position.y = 0.25 + li * 0.05;
      ls.renderOrder = 1;
      S.gridGroup.add(ls);
    });
    S.gridGroup.visible = !!BS.state.settings.grid && BS.app.hasDoc !== false;
    S.requestRender();
  };

  /* ---------------------------------------------------------------
   * 글자 스프라이트 / 치수선
   * ------------------------------------------------------------- */
  /** 캔버스 글자 → 스프라이트 (height: 월드 cm 높이) */
  S.makeLabel = function (text, height = 10, opts = {}) {
    const THREE = window.THREE;
    const fs = 64, pad = 18;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    ctx.font = `700 ${fs}px ${BS.FONT}`;
    const tw = Math.ceil(ctx.measureText(text).width);
    cv.width = tw + pad * 2; cv.height = fs + pad * 1.4;
    ctx.font = `700 ${fs}px ${BS.FONT}`;
    ctx.fillStyle = opts.bg || 'rgba(255,255,255,0.92)';
    roundRect(ctx, 2, 2, cv.width - 4, cv.height - 4, 16); ctx.fill();
    ctx.strokeStyle = opts.color || '#1565d8'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = opts.color || '#1565d8';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, cv.width / 2, cv.height / 2 + 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = S.maxAniso;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: !!opts.depthTest, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(height * cv.width / cv.height, height, 1);
    sp.renderOrder = 20;
    sp.userData.noPick = true;
    return sp;
  };

  /**
   * 치수선: a→b 구간을 offset 방향으로 띄워 그리고 가운데 라벨 표시
   * @param group 넣을 그룹, a/b: Vector3, off: Vector3(띄움), label: 문자열
   */
  S.dimLine = function (group, a, b, off, label, opts = {}) {
    const THREE = window.THREE;
    const color = opts.color || '#1565d8';
    const a2 = a.clone().add(off), b2 = b.clone().add(off);
    const dir = b2.clone().sub(a2).normalize();
    const offN = off.clone().normalize();
    const tick = opts.tick || 5;
    // 45° 틱 마크 방향
    const tdir = dir.clone().add(offN).normalize().multiplyScalar(tick);
    const pts = [
      a2, b2,
      a, a2.clone().addScaledVector(offN, tick * 0.6),
      b, b2.clone().addScaledVector(offN, tick * 0.6),
      a2.clone().sub(tdir), a2.clone().add(tdir),
      b2.clone().sub(tdir), b2.clone().add(tdir),
    ];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color, depthTest: !!opts.depthTest, transparent: true });
    const ls = new THREE.LineSegments(g, m);
    ls.renderOrder = 19;
    ls.userData.noPick = true;
    group.add(ls);
    if (label) {
      const sp = S.makeLabel(label, opts.labelSize || 10, { color, depthTest: opts.depthTest });
      sp.position.copy(a2).add(b2).multiplyScalar(0.5).addScaledVector(offN, (opts.labelSize || 10) * 0.55);
      group.add(sp);
    }
  };

  /** 부스 전체 치수(폭 × 깊이 × 높이) */
  S.buildBoothDims = function () {
    const THREE = window.THREE;
    clearGroup(S.dimGroup);
    const b = BS.state.booth;
    const W = b.width, D = b.depth, H = b.height, t = b.thickness;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const ls = U.clamp(Math.max(W, D) * 0.045, 8, 30);
    // 폭: 앞쪽 바닥
    S.dimLine(S.dimGroup, V(-W / 2, 0.5, D / 2), V(W / 2, 0.5, D / 2), V(0, 0, 35), `폭 ${U.fmt(W)} cm`, { labelSize: ls });
    // 깊이: 오른쪽 바닥
    S.dimLine(S.dimGroup, V(W / 2, 0.5, -D / 2), V(W / 2, 0.5, D / 2), V(35 + t, 0, 0), `깊이 ${U.fmt(D)} cm`, { labelSize: ls });
    // 높이: 뒤-왼쪽 모서리 바깥
    const anyWall = BS.WALL_KEYS.some((k) => b.walls[k].on);
    if (anyWall) {
      S.dimLine(S.dimGroup, V(-W / 2 - t, 0, -D / 2 - t), V(-W / 2 - t, H, -D / 2 - t), V(-30, 0, 0), `높이 ${U.fmt(H)} cm`, { labelSize: ls });
    }
    S.dimGroup.visible = !!BS.state.settings.dims && BS.app.hasDoc !== false;
    S.requestRender();
  };

  /** 선택한 물체의 치수(가로×깊이×높이) */
  S.buildSelDims = function (ent, obj3d) {
    const THREE = window.THREE;
    clearGroup(S.selDimGroup);
    if (!ent || !obj3d || !BS.state.settings.dims || ent.hidden) { S.requestRender(); return; }
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const col = '#e8590c';
    const g = new THREE.Group();
    if (ent.kind === 'panel' && ent.mount === 'wall') {
      // 벽 현수막: 가로 · 세로 · 바닥→하단 높이
      const w = ent.w, h = ent.h, ls = U.clamp(Math.max(w, h) * 0.06, 4, 14);
      const z = ent.thick + 0.5;
      S.dimLine(g, V(-w / 2, h / 2, z), V(w / 2, h / 2, z), V(0, 12, 0), `${U.fmt(w)} cm`, { color: col, labelSize: ls, tick: 3 });
      S.dimLine(g, V(w / 2, -h / 2, z), V(w / 2, h / 2, z), V(12, 0, 0), `${U.fmt(h)} cm`, { color: col, labelSize: ls, tick: 3 });
      if (ent.y > 0.5) {
        S.dimLine(g, V(-w / 2, -h / 2 - ent.y, z), V(-w / 2, -h / 2, z), V(-12, 0, 0), `하단 ${U.fmt(ent.y)} cm`, { color: '#2b8a3e', labelSize: ls, tick: 3 });
      }
      g.position.copy(obj3d.position); g.quaternion.copy(obj3d.quaternion);
      g.translateY(0); // 패널 그룹 원점 = 패널 중심
    } else {
      const w = ent.w;
      const d = ent.kind === 'panel' ? BS.panels.footDepth(ent) : ent.d;
      const top = ent.kind === 'panel' ? ent.y + ent.h : ent.h;
      const base = (obj3d.userData.elev || 0);
      const ls = U.clamp(Math.max(w, d, top) * 0.06, 4, 14);
      const y0 = base + 0.5;
      S.dimLine(g, V(-w / 2, y0, d / 2), V(w / 2, y0, d / 2), V(0, 0, 14), `${U.fmt(w)} cm`, { color: col, labelSize: ls, tick: 3 });
      S.dimLine(g, V(w / 2, y0, -d / 2), V(w / 2, y0, d / 2), V(14, 0, 0), `${U.fmt(d)} cm`, { color: col, labelSize: ls, tick: 3 });
      S.dimLine(g, V(-w / 2, base, d / 2), V(-w / 2, base + top, d / 2), V(-14, 0, 0), `${U.fmt(top)} cm`, { color: col, labelSize: ls, tick: 3 });
      g.position.set(obj3d.position.x, 0, obj3d.position.z);
      g.rotation.y = obj3d.rotation.y;
    }
    S.selDimGroup.add(g);
    S.requestRender();
  };

  /* ---------------------------------------------------------------
   * 헬퍼
   * ------------------------------------------------------------- */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  S.roundRect = roundRect;

  /** 그룹의 모든 자식 제거 + GPU 자원 해제 */
  function disposeObj(o) {
    o.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        const ms = Array.isArray(n.material) ? n.material : [n.material];
        ms.forEach((m) => { if (m.map && !m.map.userData.shared) m.map.dispose(); m.dispose(); });
      }
    });
  }
  function clearGroup(g) {
    while (g.children.length) { const c = g.children.pop(); disposeObj(c); }
  }
  S.clearGroup = clearGroup;
  S.disposeObj = disposeObj;
})(window.BS);
