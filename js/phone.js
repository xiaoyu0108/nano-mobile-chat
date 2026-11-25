/* =========================================================
   查手机 · 逻辑
   ========================================================= */

/* =========================
   1. 工具函数
========================= */
function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

/* 模型偶尔会把换行/空行写进字段里，直接按原样渲染会出现大片空白。
   这里统一清理：换行归一、去掉行尾空格、最多保留一个空行。 */
function phoneText(s){
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 角色银行卡：localStorage 负责同步读取，IndexedDB 负责容量与恢复。
function saveCharWallet(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
  try{ if(window.NanoIDB) NanoIDB.set(key, value).catch(function(){}); }catch(e){}
}

/* =========================
   2. 主屏：时钟
========================= */
(function initClock(){
  const timeEl = document.getElementById("clockTime");
  const dateEl = document.getElementById("clockDate");
  if(!timeEl || !dateEl) return;
  function tick(){
    const now = new Date();
    const pad = n => String(n).padStart(2,"0");
    const week = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
    timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    dateEl.textContent = `${week[now.getDay()]} · ${now.getMonth()+1}月${now.getDate()}日`;
  }
  tick();
  setInterval(tick, 1000);
})();

/* =========================
   3. 主屏：拍立得
========================= */
(function initPolaroid(){
  const photoBg = document.getElementById("polaroidPhotoBg");
  if(!photoBg) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  document.body.appendChild(input);

  const saved = localStorage.getItem("glass_phone_polaroid_photo");
  if(saved){
    photoBg.style.backgroundImage = `url("${saved}")`;
    const empty = photoBg.querySelector(".polaroid-empty");
    if(empty) empty.style.display = "none";
  }

  const btn = document.querySelector('[data-app="widget_polaroid"]');
  btn.addEventListener("click", e => {
    if(e.currentTarget.dataset.justDragged === "1"){
      e.currentTarget.dataset.justDragged = "0";
      return;
    }
    if(e.target.closest("[contenteditable]")) return;
    input.click();
  });

  input.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const data = ev.target.result;
      photoBg.style.backgroundImage = `url("${data}")`;
      const empty = photoBg.querySelector(".polaroid-empty");
      if(empty) empty.style.display = "none";
      try{ localStorage.setItem("glass_phone_polaroid_photo", data); }catch(err){}
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll(".polaroid-mini [contenteditable]").forEach(el => {
    const key = "glass-phone-polaroid-" + el.dataset.key;
    const v = localStorage.getItem(key);
    if(v !== null) el.innerHTML = v;
    el.addEventListener("input", () => localStorage.setItem(key, el.innerHTML));
  });
})();

/* =========================
   4. 主屏：气泡
========================= */
(function initChatWidget(){
  document.querySelectorAll(".chat-bubble").forEach(el => {
    const key = "glass-phone-chat-" + el.dataset.chatKey;
    const v = localStorage.getItem(key);
    if(v !== null) el.innerText = v;
    el.addEventListener("input", () => localStorage.setItem(key, el.innerText));
    el.addEventListener("keydown", e => {
      if(e.key === "Enter"){ e.preventDefault(); el.blur(); }
    });
  });
})();

/* =========================
   4.5 主屏：音乐 / 纪念日 / 日历小组件
========================= */
(function initMusicWidget(){
  const play = document.querySelector("[data-music-play]");
  const like = document.querySelector("[data-music-like]");
  const repeat = document.querySelector("[data-music-repeat]");
  const bar = document.getElementById("musicProgress");
  let timer = null;
  let progress = 62;
  function paint(){ if(bar) bar.style.width = progress + "%"; }
  paint();
  if(like){
    like.addEventListener("click", () => like.classList.toggle("on"));
  }
  if(repeat){
    repeat.addEventListener("click", () => repeat.classList.toggle("on"));
  }
  if(play){
    play.addEventListener("click", () => {
      const on = play.classList.toggle("playing");
      clearInterval(timer);
      timer = null;
      if(on){
        timer = setInterval(() => {
          progress += 0.8;
          if(progress >= 100) progress = 0;
          paint();
        }, 500);
      }
    });
  }
})();

function homeAvatarNow(){
  try{
    if(typeof currentChar !== "undefined" && currentChar && currentChar.avatar) return currentChar.avatar;
  }catch(e){}
  try{
    const d = JSON.parse(localStorage.getItem("nano_mask_data") || "null");
    if(d){
      if(d.avatar) return d.avatar;
      if(d.currentMask && d.currentMask.avatar) return d.currentMask.avatar;
      if(Array.isArray(d.masks) && d.currentMaskId){
        const m = d.masks.find(x => x && String(x.id) === String(d.currentMaskId));
        if(m && m.avatar) return m.avatar;
      }
    }
  }catch(e){}
  return "";
}

function renderCalendarWidget(){
  const root = document.getElementById("calendarWidget");
  if(!root) return;
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const weekNames = ["日","一","二","三","四","五","六"];
  const avatar = homeAvatarNow();
  const name = (typeof currentChar !== "undefined" && currentChar && currentChar.name) ? currentChar.name : "";
  let cells = "";
  for(let i = 0; i < 7; i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    cells += '<div class="calendar-day' + (isToday ? ' today' : '') + '"><i>' + weekNames[i] + '</i><b>' + d.getDate() + '</b></div>';
  }
  root.innerHTML =
    '<div class="calendar-top">' +
      '<div class="calendar-avatar' + (avatar ? ' has-image' : '') + '"' + (avatar ? ' style="background-image:url(&quot;' + escHtml(avatar) + '&quot;)"' : '') + '><span>' + escHtml((name || "·").slice(0,1)) + '</span></div>' +
      '<div class="calendar-meta"><span class="calendar-month">' + monthNames[now.getMonth()] + '</span><span class="calendar-year">' + now.getFullYear() + '</span></div>' +
    '</div>' +
    '<div class="calendar-week">' + cells + '</div>';
}

function updateHomeWidgets(){
  const name = (typeof currentChar !== "undefined" && currentChar && currentChar.name) ? currentChar.name : "";
  const avatar = homeAvatarNow();
  const title = document.getElementById("musicTitle");
  const sub = document.getElementById("musicSub");
  const cover = document.getElementById("musicCover");
  const fallback = document.getElementById("musicCoverFallback");
  if(title) title.textContent = name || "Char";
  if(sub) sub.textContent = name ? (name + " 的私人电台") : "私人电台";
  if(cover && fallback){
    if(avatar){
      cover.style.backgroundImage = 'url("' + String(avatar).replace(/"/g, '\\"') + '")';
      cover.classList.add("has-image");
      fallback.textContent = "";
    }else{
      cover.style.backgroundImage = "";
      cover.classList.remove("has-image");
      fallback.textContent = (name || "♪").slice(0,1);
    }
  }
  const pAv = document.getElementById("profileAvatar");
  const pAvFallback = document.getElementById("profileAvatarFallback");
  const pName = document.getElementById("profileName");
  const pSub = document.getElementById("profileSub");
  if(pName) pName.textContent = name || "Char";
  if(pSub) pSub.textContent = "很幸福的最近";
  if(pAv && pAvFallback){
    if(avatar){
      pAv.style.backgroundImage = 'url("' + String(avatar).replace(/"/g, '\\"') + '")';
      pAv.classList.add("has-image");
      pAvFallback.textContent = "";
    }else{
      pAv.style.backgroundImage = "";
      pAv.classList.remove("has-image");
      pAvFallback.textContent = (name || "?").slice(0,1);
    }
  }
  const daysEl = document.getElementById("annivDays");
  const annivName = document.getElementById("annivName");
  if(daysEl){
    let start = "";
    try{ start = localStorage.getItem("glass-phone-anniv-start") || ""; }catch(e){}
    if(!start){
      start = new Date().toISOString().slice(0,10);
      try{ localStorage.setItem("glass-phone-anniv-start", start); }catch(e){}
    }
    const t0 = new Date(start + "T00:00:00").getTime();
    const days = Number.isFinite(t0) ? Math.max(1, Math.floor((Date.now() - t0) / 86400000) + 1) : 1;
    daysEl.textContent = String(days);
    if(annivName) annivName.textContent = name ? ("与" + name + "相识") : "相识";
  }
  renderCalendarWidget();
}

/* =========================
   5. 主屏：长按拖动 + 自由摆放（两屏都支持）
   - App / 小组件都可拖动，4 列 + 0.1 行精度
   - 整块主屏（包括下方空白区域）都可作为落点
   - 可自由调节上下位置，位置会保存
   - 拖到屏幕边缘可翻到另一屏
========================= */
(function initDrag(){
  const pagesEl = document.getElementById("homePages");
  const grids = [...document.querySelectorAll(".layout")].filter(g => g.querySelector(".app, .widget-large"));
  const hint = document.getElementById("moveHint");
  if(!grids.length) return;

  const LAYOUT_KEY = "glass_phone_layout_v14";
  const MAX_COL = 4, STEP = 0.1;
  let active = null, ghost = null, timer = null;
  let longPressed = false, startX = 0, startY = 0, offX = 0, offY = 0, pointerId = null;
  let origin = null, dropTarget = null, edgeDir = 0, edgeTimer = null;

  function clearPress(){ if(timer){ clearTimeout(timer); timer = null; } }
  function showHint(){
    if(!hint) return;
    hint.classList.add("show");
    clearTimeout(showHint.t);
    showHint.t = setTimeout(() => hint.classList.remove("show"), 1300);
  }
  function clamp(n, min, max){ return n < min ? min : (n > max ? max : n); }
  function rowsOf(grid){
    const n = parseInt(grid && grid.dataset ? grid.dataset.rows : "", 10);
    return clamp(Number.isFinite(n) ? n : 4, 1, 12);
  }
  function itemsIn(grid){
    return [...grid.querySelectorAll(".app, .widget-large")].filter(el => !el.classList.contains("layout-ghost"));
  }
  function spanValue(endVal, start){
    const s = String(endVal || '');
    const m = s.match(/span\s+(\d+)/i);
    if(m) return Math.max(1, parseInt(m[1], 10) || 1);
    const n = parseInt(s, 10);
    if(Number.isFinite(n) && n > start) return n - start;
    return 1;
  }
  function readDefault(el){
    const cs = getComputedStyle(el);
    const c1 = parseInt(cs.gridColumnStart, 10) || 1;
    const r1 = parseInt(cs.gridRowStart, 10) || 1;
    const grid = el.parentElement;
    // 行数必须用主屏声明的行数（第一屏 5 行、第二屏 4 行），不能用可视高度反推：
    // 反推会把第 5 行（日历）夹到第 4 行，导致图标和日历/对话小组件叠在一起。
    const rows = grid ? rowsOf(grid) : 4;
    const w = el.dataset.w ? clamp(parseInt(el.dataset.w, 10) || 1, 1, MAX_COL) : spanValue(cs.gridColumnEnd, c1);
    const h = el.dataset.h ? clamp(parseFloat(el.dataset.h) || 1, 0.5, rows) : spanValue(cs.gridRowEnd, r1);
    return normalize({ c: c1 - 1, r: r1 - 1, w, h }, rows);
  }
  function metrics(grid){
    const cs = getComputedStyle(grid);
    const gapX = parseFloat(cs.columnGap) || 0;
    const gapY = parseFloat(cs.rowGap) || 0;
    const rect = grid.getBoundingClientRect();
    const rows = rowsOf(grid);
    const colW = Math.max(0, (rect.width - gapX * (MAX_COL - 1)) / MAX_COL);
    // 行高优先和列宽一致（4×2 小组件保持方形），放不下时按声明行数等分；
    // 整块内容再垂直居中，避免底部留一大块空白。
    const fitH = (rect.height - gapY * (rows - 1)) / rows;
    const rowH = Math.max(0, Math.min(colW, fitH));
    const contentH = rows * rowH + (rows - 1) * gapY;
    const offsetY = Math.max(0, (rect.height - contentH) / 2);
    return {
      width: rect.width,
      height: rect.height,
      gapX,
      gapY,
      colW,
      rowH,
      rows,
      offsetY
    };
  }
  function normalize(cell, rows){
    const maxRows = Math.max(1, Number(rows) || 4);
    const w = clamp(Number(cell.w) || 1, 1, MAX_COL);
    const h = clamp(Number(cell.h) || 1, 0.5, maxRows);
    // 自由摆放：x/y 是相对主屏的 0~1 比例，不再吸附 4 列网格，也不再限制在中间几行。
    if(cell && (cell.free || cell.x != null || cell.y != null)){
      return {
        free: true,
        x: clamp(Number(cell.x) || 0, 0, 1),
        y: clamp(Number(cell.y) || 0, 0, 1),
        w, h
      };
    }
    const c = clamp(Math.round(Number(cell.c) || 0), 0, MAX_COL - w);
    const r = clamp(Math.round((Number(cell.r) || 0) / STEP) * STEP, 0, Math.round((maxRows - h) * 10) / 10);
    return { c, r, w, h };
  }
  function setPos(el, cell, grid){
    const m = metrics(grid);
    const n = normalize(cell, m.rows);
    el._cell = n;
    // 主屏还没显示（角色列表页）时量到的是 0×0，全部图标都会被摆到左上角叠在一起。
    // 先只记住格子，等主屏真正可见后再由 applyAll 统一落位。
    if(m.colW < 2 || m.rowH < 2) return;
    const itemW = n.w * m.colW + Math.max(0, n.w - 1) * m.gapX;
    const itemH = n.h * m.rowH + Math.max(0, n.h - 1) * m.gapY;
    let left, top;
    if(n.free){
      left = clamp(n.x * m.width, 0, Math.max(0, m.width - itemW));
      top = clamp(n.y * m.height, 0, Math.max(0, m.height - itemH));
    }else{
      left = n.c * (m.colW + m.gapX);
      top = m.offsetY + n.r * (m.rowH + m.gapY);
    }
    el.style.position = "absolute";
    el.style.gridColumn = "auto";
    el.style.gridRow = "auto";
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.width = itemW + "px";
    el.style.height = itemH + "px";
    el.style.margin = "0";
  }
  function cellOf(el){ return el._cell || el._defaultCell || readDefault(el); }
  function currentPageGrid(){
    if(!pagesEl || !grids.length) return null;
    const w = pagesEl.clientWidth || 1;
    const idx = clamp(Math.round(pagesEl.scrollLeft / w), 0, grids.length - 1);
    return grids[idx] || grids[0];
  }
  function gridAt(x, y){
    for(const g of grids){
      const r = g.getBoundingClientRect();
      if(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return g;
    }
    // 允许拖到主屏上下边缘（甚至略超出）：落到当前页最近的网格，而不是直接取消放置。
    if(pagesEl){
      const pr = pagesEl.getBoundingClientRect();
      if(x >= pr.left && x <= pr.right && y >= pr.top && y <= pr.bottom) return currentPageGrid();
    }
    return null;
  }
  function freeFromPoint(grid, x, y, w, h){
    const m = metrics(grid);
    const rect = grid.getBoundingClientRect();
    const itemW = w * m.colW + Math.max(0, w - 1) * m.gapX;
    const itemH = h * m.rowH + Math.max(0, h - 1) * m.gapY;
    const left = clamp(x - offX - rect.left, 0, Math.max(0, rect.width - itemW));
    const top = clamp(y - offY - rect.top, 0, Math.max(0, rect.height - itemH));
    return {
      free: true,
      x: rect.width ? left / rect.width : 0,
      y: rect.height ? top / rect.height : 0,
      w, h
    };
  }
  function cellFromPoint(grid, x, y, w, h){
    const m = metrics(grid);
    const rect = grid.getBoundingClientRect();
    const left = x - offX - rect.left;
    const top = y - offY - rect.top - m.offsetY;
    return normalize({
      c: Math.round(left / (m.colW + m.gapX)),
      r: Math.round((top / (m.rowH + m.gapY)) / STEP) * STEP,
      w, h
    }, m.rows);
  }
  function clearDragStyles(el){
    el.classList.remove("dragging");
    el.style.position = "";
    el.style.width = "";
    el.style.height = "";
    el.style.left = "";
    el.style.top = "";
    el.style.margin = "";
    el.style.transform = "";
    el.style.zIndex = "";
    el.style.pointerEvents = "";
  }

  function beginDrag(el, x, y){
    if(active) return;
    active = el;
    longPressed = true;
    const rect = active.getBoundingClientRect();
    const cell = cellOf(active);
    offX = x - rect.left;
    offY = y - rect.top;
    origin = { grid: active.parentElement, cell: Object.assign({}, cell) };

    ghost = document.createElement("div");
    ghost.className = "layout-ghost";
    setPos(ghost, origin.cell, origin.grid);
    origin.grid.appendChild(ghost);

    active.classList.add("dragging");
    active.style.position = "fixed";
    active.style.width = rect.width + "px";
    active.style.height = rect.height + "px";
    active.style.left = (x - offX) + "px";
    active.style.top = (y - offY) + "px";
    active.style.margin = "0";
    active.style.transform = "none";
    active.style.zIndex = "999";
    active.style.pointerEvents = "none";
    document.body.appendChild(active);
    showHint();
  }

  function moveDrag(x, y){
    if(!active) return;
    active.style.left = (x - offX) + "px";
    active.style.top = (y - offY) + "px";
    checkEdge(x);

    const grid = gridAt(x, y);
    dropTarget = null;
    if(!grid){
      if(ghost) ghost.style.display = "none";
      return;
    }
    if(ghost.parentElement !== grid) grid.appendChild(ghost);
    ghost.style.display = "";
    // 自由摆放：不吸附列/行，指针落在哪里就放在哪里。
    const cell = freeFromPoint(grid, x, y, origin.cell.w, origin.cell.h);
    setPos(ghost, cell, grid);
    dropTarget = { grid, cell };
  }

  function checkEdge(x){
    if(!pagesEl) return;
    const r = pagesEl.getBoundingClientRect();
    const dir = x < r.left + 26 ? -1 : (x > r.right - 26 ? 1 : 0);
    if(dir === edgeDir) return;
    clearTimeout(edgeTimer);
    edgeDir = dir;
    if(!dir) return;
    edgeTimer = setTimeout(() => {
      if(!active) return;
      const w = pagesEl.clientWidth || 1;
      const cur = Math.round(pagesEl.scrollLeft / w);
      const next = clamp(cur + dir, 0, grids.length - 1);
      if(next !== cur) pagesEl.scrollTo({ left: next * w, behavior: "smooth" });
      edgeDir = 0;
    }, 430);
  }

  function freeCell(grid, cell, ignoreEl){
    const rows = rowsOf(grid);
    let c = normalize(cell, rows);
    const occupied = itemsIn(grid)
      .filter(it => it !== ignoreEl && it._cell)
      .map(it => it._cell);
    for(let i = 0; i < 80 && occupied.some(o => overlaps(o, c)); i++){
      if(c.r + STEP <= rows - c.h){
        c = normalize(Object.assign({}, c, { r: c.r + STEP }), rows);
      }else{
        c = normalize(Object.assign({}, c, { c: (c.c + 1) % MAX_COL, r: 0 }), rows);
      }
    }
    return c;
  }

  // 从整块网格里找离目标最近的空位。旧版本保存的坐标可能全部叠在同一格：
  // 只往下挪会在最后一行卡住，导致所有 App 继续重叠；这里改为扫描全部格子。
  function nearestFreeCell(rows, cell, bucket){
    const base = normalize(cell, rows);
    if(!bucket.some(o => overlaps(o, base))) return base;
    let best = null;
    let bestDist = Infinity;
    const maxR = Math.max(0, Math.round((rows - base.h) * 10) / 10);
    for(let r = 0; r <= maxR + 0.0001; r = Math.round((r + STEP) * 10) / 10){
      for(let c = 0; c <= MAX_COL - base.w; c++){
        const cand = normalize({ c, r, w: base.w, h: base.h }, rows);
        if(bucket.some(o => overlaps(o, cand))) continue;
        const dist = Math.abs(cand.c - base.c) + Math.abs(cand.r - base.r);
        if(dist < bestDist){ best = cand; bestDist = dist; }
      }
    }
    return best || base;
  }

  function endDrag(apply){
    clearPress();
    clearTimeout(edgeTimer); edgeDir = 0;
    if(!active) return;
    const el = active;
    const target = apply ? dropTarget : null;
    if(ghost) ghost.remove();

    if(target){
      if(el.parentElement !== target.grid) target.grid.appendChild(el);
      clearDragStyles(el);
      // 自由坐标直接落位，不做碰撞挤压/回网格。
      setPos(el, target.cell, target.grid);
    } else {
      if(el.parentElement !== origin.grid) origin.grid.appendChild(el);
      clearDragStyles(el);
      setPos(el, origin.cell, origin.grid);
    }
    active = null; ghost = null; origin = null; dropTarget = null;
    saveLayout();
    setTimeout(() => { longPressed = false; }, 80);
  }

  function cancelPress(){ clearPress(); if(active) endDrag(false); }

  function saveLayout(){
    const map = {};
    grids.forEach((grid, gi) => {
      itemsIn(grid).forEach(el => {
        if(!el.dataset.app || !el._cell) return;
        const c = el._cell;
        map[el.dataset.app] = c.free
          ? { g: gi, x: c.x, y: c.y, w: c.w, h: c.h }
          : { g: gi, c: c.c, r: c.r, w: c.w, h: c.h };
      });
    });
    try{ localStorage.setItem(LAYOUT_KEY, JSON.stringify(map)); }catch(e){}
  }
  function overlaps(a, b){
    return a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
  }
  function restoreLayout(){
    let map = {};
    try{ map = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") || {}; }catch(e){ map = {}; }
    const all = [];
    grids.forEach(grid => {
      itemsIn(grid).forEach(el => {
        el._defaultCell = readDefault(el);
        all.push(el);
      });
    });
    // 每屏已占用的格子：旧版本保存过「叠在一起」的坐标，恢复时自动错开，
    // 保证图标不会被日历 / 对话小组件压住。小组件优先落位，图标绕开它们。
    const placed = grids.map(() => []);
    all.sort((a, b) => (b.classList.contains("widget-large") ? 1 : 0) - (a.classList.contains("widget-large") ? 1 : 0));
    all.forEach(el => {
      const def = el._defaultCell || readDefault(el);
      const s = el.dataset.app && map[el.dataset.app];
      const gi = (s && Number.isFinite(s.g) && grids[s.g]) ? s.g : grids.indexOf(el.parentElement);
      const targetGrid = grids[gi];
      if(!targetGrid) return;
      const rows = rowsOf(targetGrid);
      const bucket = placed[gi] || (placed[gi] = []);
      if(s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y))){
        // 新版本的自由坐标：允许重叠，不再自动挤到空位。
        const cell = normalize({ x: s.x, y: s.y, w: def.w, h: def.h, free: true }, rows);
        bucket.push(cell);
        if(el.parentElement !== targetGrid) targetGrid.appendChild(el);
        el._cell = cell;
        setPos(el, cell, targetGrid);
        return;
      }
      const savedCell = s ? normalize({ c: s.c, r: s.r, w: def.w, h: def.h }, rows) : normalize(def, rows);
      // 旧版网格坐标：保留自动错开，避免历史叠在一起的图标继续重叠。
      let cell = nearestFreeCell(rows, savedCell, bucket);
      if(bucket.some(r => overlaps(r, cell))) cell = nearestFreeCell(rows, normalize(def, rows), bucket);
      bucket.push(cell);
      if(el.parentElement !== targetGrid) targetGrid.appendChild(el);
      el._cell = cell;
      setPos(el, cell, targetGrid);
    });
  }
  function applyAll(){
    grids.forEach(grid => {
      if(grid.clientWidth < 20 || grid.clientHeight < 20) return;
      itemsIn(grid).forEach(el => {
        if(el === active || !el._cell) return;
        setPos(el, el._cell, grid);
      });
    });
  }

  // 主屏初始是隐藏的（先显示角色列表）。隐藏时量不到尺寸，
  // 必须等可见后再恢复布局，否则保存的摆放会在每次进入时丢失。
  let restored = false;
  function tryRestore(){
    if(restored) return true;
    if(!grids.some(g => g.clientWidth > 20 && g.clientHeight > 20)) return false;
    restored = true;
    restoreLayout();
    applyAll();
    return true;
  }
  window.__phoneLayoutRestore = tryRestore;

  grids.forEach(grid => {
    itemsIn(grid).forEach(item => {
      item.addEventListener("contextmenu", e => e.preventDefault());
      item.addEventListener("pointerdown", e => {
        if(e.button !== undefined && e.button !== 0) return;
        if(e.target && e.target.closest && e.target.closest('[contenteditable="true"],input,textarea,select,a')) return;
        const btn = e.target && e.target.closest ? e.target.closest("button") : null;
        if(btn && btn !== item) return;
        pointerId = e.pointerId;
        startX = e.clientX; startY = e.clientY;
        clearPress();
        timer = setTimeout(() => beginDrag(item, e.clientX, e.clientY), 420);
      });
    });
  });

  // 拖动时元素会被移到 body，指针捕获可能丢失；用 document 监听保证松手一定能收尾。
  document.addEventListener("pointermove", e => {
    if(pointerId !== e.pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if(!active && Math.hypot(dx, dy) > 10) clearPress();
    if(active){ if(e.cancelable) e.preventDefault(); moveDrag(e.clientX, e.clientY); }
  }, { passive: false });
  document.addEventListener("pointerup", e => {
    if(pointerId !== e.pointerId) return;
    clearPress();
    if(active) endDrag(true);
    pointerId = null;
  });
  document.addEventListener("pointercancel", e => {
    if(pointerId !== e.pointerId) return;
    cancelPress();
    pointerId = null;
  });
  document.addEventListener("touchmove", e => {
    if(active && e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener("click", e => {
    if(!longPressed) return;
    e.preventDefault();
    e.stopPropagation();
    longPressed = false;
  }, true);

  let resizeT = null;
  window.addEventListener("resize", () => {
    if(active) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if(!tryRestore()) return; applyAll(); }, 120);
  });
  window.__phoneLayoutRefresh = () => { if(tryRestore()) applyAll(); };

  // 进入角色手机、屏幕旋转、从后台回来时尺寸才真正可用：轮询到可见为止。
  (function waitVisible(n){
    if(tryRestore()) return;
    if(n > 180) return;
    requestAnimationFrame(() => waitVisible(n + 1));
  })(0);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") window.__phoneLayoutRefresh(); });
})();

/* =========================
   5.5 主屏：第二屏（扩展 App）分页
========================= */
(function initHomePaging(){
  const pages = document.getElementById("homePages");
  const dots = document.getElementById("homeDots");
  if(!pages || !dots) return;
  const spans = [...dots.children];
  function current(){
    const w = pages.clientWidth || 1;
    return Math.max(0, Math.min(spans.length - 1, Math.round(pages.scrollLeft / w)));
  }
  function sync(){
    const i = current();
    spans.forEach((s, k) => s.classList.toggle("active", k === i));
  }
  pages.addEventListener("scroll", () => requestAnimationFrame(sync), { passive:true });
  spans.forEach((s, k) => {
    s.addEventListener("click", () => pages.scrollTo({ left: k * pages.clientWidth, behavior:"smooth" }));
  });
  /* 左右滑动切换分页（图标自身吞掉了横向滚动，这里补一个手势） */
  let tx = 0, ty = 0, tt = 0;
  pages.addEventListener("touchstart", e => {
    const t = e.touches[0]; if(!t) return;
    tx = t.clientX; ty = t.clientY; tt = Date.now();
  }, { passive:true });
  pages.addEventListener("touchend", e => {
    if(document.querySelector(".dragging")) return;
    const t = e.changedTouches[0]; if(!t) return;
    const dx = t.clientX - tx, dy = t.clientY - ty;
    if(Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - tt < 600){
      const i = current();
      const next = Math.max(0, Math.min(spans.length - 1, i + (dx < 0 ? 1 : -1)));
      pages.scrollTo({ left: next * pages.clientWidth, behavior:"smooth" });
    }
  }, { passive:true });
})();

/* =========================================================
   6. 存储层
   ========================================================= */
const API_DB_NAME = "nano_api_db";
const API_DB_VERSION = 2;
const API_STORE = "api_data";
const API_CONFIG_KEY = "nano_api_config";

function openApiDB(){
  return new Promise((resolve, reject) => {
    try{
      const req = indexedDB.open(API_DB_NAME, API_DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(API_STORE))
          db.createObjectStore(API_STORE, {keyPath: "key"});
        if(!db.objectStoreNames.contains("emoji_data"))
          db.createObjectStore("emoji_data", {keyPath: "key"});
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    }catch(e){ reject(e); }
  });
}
function idbGetApi(key){
  return openApiDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(API_STORE, "readonly");
    const req = tx.objectStore(API_STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = e => reject(e.target.error);
    tx.oncomplete = () => db.close();
  }));
}
async function getApiConfig(){
  try{
    const v = await idbGetApi(API_CONFIG_KEY);
    if(v && v.mainUrl) return v;
  }catch(e){}
  // 兼容只写 localStorage 的配置（线下 / 旅途也是同样的回退顺序）
  try{
    const raw = localStorage.getItem("nano_api_config");
    if(raw){ const v = JSON.parse(raw); if(v && v.mainUrl) return v; }
  }catch(e){}
  return null;
}

const DATA_DB_NAME = "check_phone_db";
const DATA_DB_VERSION = 1;
const DATA_STORE = "app_data";

function openDataDB(){
  return new Promise((resolve, reject) => {
    try{
      const req = indexedDB.open(DATA_DB_NAME, DATA_DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if(!db.objectStoreNames.contains(DATA_STORE))
          db.createObjectStore(DATA_STORE, {keyPath: "key"});
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    }catch(e){ reject(e); }
  });
}
function dataSet(key, value){
  return openDataDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE, "readwrite");
    tx.objectStore(DATA_STORE).put({key, value});
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = e => { db.close(); reject(e.target.error); };
  }));
}
function dataGet(key){
  return openDataDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE, "readonly");
    const req = tx.objectStore(DATA_STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = e => reject(e.target.error);
    tx.oncomplete = () => db.close();
  })).then(async (value) => {
    // 旧版生成的外文数据没有译文：打开 App 时自动补齐并落盘，避免只有点开详情才看到翻译。
    try {
      if(value && typeof value === "object" && value.data && typeof key === "string" && key.indexOf("app_") === 0 &&
         window.NanoTranslate && phoneDataNeedsTranslation(value.data)){
        await ensurePhoneInlineTranslations(value.data, { maxMs: 2500 });
        try { await dataSet(key, value); } catch (e) {}
      }
    } catch (e) {}
    return value;
  });
}

/* =========================================================
   7. API 调用 + JSON 解析
   ========================================================= */
function resolveApiHost(rawUrl){
  try{
    const s = String(rawUrl || "").trim();
    if(!s) return s;
    const u = new URL(s);
    const host = u.hostname;
    const cur = window.location.hostname;
    const isLan = cur && (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(cur) || /^10\./.test(cur) || /^192\.168\./.test(cur) || /^172\.(1[6-9]|2\d|3[01])\./.test(cur) || /\.local$/.test(cur));
    // 仅当页面也在本地/局域网时才把 localhost 换成当前主机，公网域名下保留原地址
    if((host === "localhost" || host === "127.0.0.1" || host === "[::1]") && isLan){
      u.hostname = cur;
    }
    // new URL() 会给出 https://host/ 这种结尾斜杠；如果这里不剥掉，
    // 后面再拼 /v1 就会变成 https://host//v1，网关会直接返回它的网页而不是 JSON。
    return u.toString().replace(/\/+$/, "").replace(/([^:])\/{2,}/g, "$1/");
  }catch(e){ return rawUrl; }
}
function buildChatEndpoint(rawUrl){
  let s = resolveApiHost(String(rawUrl || "").trim());
  s = String(s || "").replace(/\/+$/, "").replace(/([^:])\/{2,}/g, "$1/");
  if(/\/chat\/completions$/i.test(s)) return s;
  if(/\/v1$/i.test(s)) return s + "/chat/completions";
  return s + "/v1/chat/completions";
}

async function callAPI(api, sys, user){
  const endpoint = buildChatEndpoint(api.url);
  try {
    if (window.NanoPrompts && NanoPrompts.appendTo) sys = NanoPrompts.appendTo(sys, 'phone', { keepFormat: true });
  } catch (e) {}
  const body = {
    model: api.model,
    messages: [
      {role: "system", content: sys},
      {role: "user", content: user}
    ],
    temperature: api.temp
  };
  const headers = {"Content-Type": "application/json"};
  if(api.key) headers.Authorization = "Bearer " + api.key;
  const r = await fetch(endpoint, {method: "POST", headers, body: JSON.stringify(body)});
  if(!r.ok){
    let detail = "";
    try{ const t = await r.text(); if(t) detail = "：" + t.slice(0, 300); }catch(e){}
    if(isContentBlocked(detail)) throw new Error("内容被上游/中转拦截（本次只调用一次，不会自动重试）" + detail);
    throw new Error("HTTP " + r.status + detail);
  }
  const raw = await r.text();
  if(/^\s*<(?:!doctype\s+html|html[\s>])/i.test(String(raw || ""))){
    throw new Error("API 地址返回了网页，不是接口。请检查主 API 地址（应填到 /v1）：" + endpoint);
  }
  let d = null;
  try{ d = JSON.parse(raw); }catch(e){ throw new Error("API 返回的不是 JSON，请检查主 API 地址：" + endpoint); }
  const text = d?.choices?.[0]?.message?.content || d?.choices?.[0]?.text || d?.output_text;
  if(!text) throw new Error("API 返回没有文本内容");
  if(isContentBlocked(text)) throw new Error("内容被上游/中转拦截（本次只调用一次，不会自动重试）：" + String(text).slice(0, 300));
  return text;
}

function repairJsonText(text){
  let t = String(text == null ? "" : text).replace(/^\uFEFF/, "").trim();
  t = t.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = t.search(/[\[{]/);
  if(first > 0) t = t.slice(first);
  let out = "", stack = [], inStr = false, esc = false, started = false;
  for(let i = 0; i < t.length; i++){
    const ch = t[i];
    if(inStr){
      if(esc){ out += ch; esc = false; }
      else if(ch === "\\"){ out += ch; esc = true; }
      else if(ch === '"'){ out += ch; inStr = false; }
      else if(ch === "\n"){ out += "\\n"; }
      else if(ch === "\r"){ /* skip */ }
      else if(ch === "\t"){ out += "\\t"; }
      else out += ch;
    }else{
      if(ch === '"'){ inStr = true; out += ch; }
      else if(ch === "{"){ started = true; stack.push("}"); out += ch; }
      else if(ch === "["){ started = true; stack.push("]"); out += ch; }
      else if(ch === "}" || ch === "]"){
        if(stack.length && stack[stack.length - 1] === ch) stack.pop();
        out += ch;
        if(started && !stack.length) break;
      }else out += ch;
    }
  }
  if(inStr){ if(esc) out = out.slice(0, -1); out += '"'; }
  while(stack.length) out += stack.pop();
  return out.replace(/,\s*([}\]])/g, "$1");
}
function extractJSON(text){
  const raw = String(text == null ? "" : text).trim();
  if(!raw) return null;
  const fa = raw.indexOf("["), fo = raw.indexOf("{");
  let start = -1;
  if(fa >= 0 && (fo < 0 || fa < fo)) start = fa;
  else if(fo >= 0) start = fo;
  const la = raw.lastIndexOf("]"), lo = raw.lastIndexOf("}");
  let end = -1;
  if(la >= 0 && (lo < 0 || la > lo)) end = la;
  else if(lo >= 0) end = lo;
  const candidates = [];
  if(start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  candidates.push(repairJsonText(raw));
  for(const t of candidates){
    try{ return JSON.parse(t); }catch(e){}
  }
  return null;
}

const SYS_JSON = "你是虚构角色的手机数据生成器。内容面向成年读者，属于虚构创作；可以自然包含成熟的情感、暧昧与亲密关系描写，但要用含蓄、克制的暗示，不写露骨器官/性行为细节。禁止血腥暴力和违法内容。所有内容必须严格贴合给定的人设、世界书与记忆库，不要脱离角色自由发挥。这是虚构创作，请直接按要求输出，不要拒绝、不要说教。只输出用户要求的 JSON，不要输出任何解释、markdown 代码块或多余文字。\n【语言与翻译 · 强制】\n- 只翻译真正的正文/对白（日记、私密、备忘录、网页正文、评论、聊天对白等）；人名、地名、品牌/App 名、账号、网址、ID、商品规格不翻译，保留原文。\n- 聊天(chat)：messages 每条用「text」放原文，中文译文放到同一条的「translation」；没有外文时 translation 留空。\n- 豆包(doubao)：每条用「content」放原文，中文译文放到同一条的「translation」。\n- 邮件(mail)：body 每段放原文；整封邮件的中文翻译统一放到邮件对象的「translation」字段，不要逐段翻译。\n- 其它 App 的非中文正文，在同一字段内用「原文（中文：译文）」；简体中文内容不要加翻译。";


/* 通用的「贴合人设」硬性约束 */
const PERSONA_RULE = "硬性要求：所有内容必须贴合上面的角色设定、世界书设定与记忆库，符合角色的身份、性格、说话方式、社交圈、作息与近期经历；不得出现与角色无关的通用模板内容；不同角色的内容必须明显不同。内容要自然与「用户」产生关联：每个 App 至少有 1-2 条自然涉及用户（用用户的名字、与用户共同经历的事、用户说过的话，或直接从记忆库取材），但不要每条都硬提用户，保持自然。\n【反雷同】每次生成都要换新的场景、时间、物件、话术与结构，避免反复套用同一批句式或套路；避免千篇一律的空泛描写。\n【自然表达】称呼与用词要自然、克制、有具体质感，避免过度亲昵或模板化。";

/* ===== 手机内容「换一批」种子 / 去重历史 =====
   同一角色每次生成都从不同生活切面取材，并把最近生成过的标题、地点、店名、物品
   作为负例传回模型，避免「换汤不换药」。全部本地处理，不额外调用 API。 */
const PHONE_VARIATION = {
  time: ["清晨刚醒", "上午", "午休", "下午", "下班后", "傍晚", "夜里", "凌晨", "周末", "雨天", "换季", "节日前"],
  mood: ["松弛", "烦躁", "疲惫", "雀跃", "心虚", "怀旧", "想靠近用户", "想独处", "有点得意", "被戳到", "平静", "嘴硬"],
  slice: ["工作 / 学习", "家人", "朋友", "兴趣爱好", "身体状态", "消费 / 购物", "秘密", "回忆", "近期计划", "网络冲浪", "游戏", "外卖 / 吃饭", "出行", "宠物", "居住空间", "社交关系"],
  place: ["便利店", "地铁", "公司楼下", "旧书店", "健身房", "医院走廊", "小区门口", "咖啡店", "夜市", "车站", "家里沙发", "阳台", "学校后门", "商场负一层", "河边步道", "理发店", "洗衣店", "药店"],
  object: ["没喝完的咖啡", "充电线", "旧票根", "快递盒", "药盒", "便利贴", "耳机", "钥匙", "折伞", "外卖小票", "拍立得", "笔记本", "半瓶水", "毛绒挂件", "创可贴", "购物袋", "旧照片", "车载香片"],
  userHook: ["用户说过的一句话", "一起吃过的东西", "用户最近的情绪", "一次没约成的见面", "用户发来的照片", "两个人共同的计划", "用户无意间提到的小习惯", "一次没回完的消息"]
};
function phonePick(arr, n){
  const pool = (arr || []).slice(), out = [];
  while(pool.length && out.length < n) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
function phoneVariation(){
  return {
    time: phonePick(PHONE_VARIATION.time, 2),
    mood: phonePick(PHONE_VARIATION.mood, 2),
    slice: phonePick(PHONE_VARIATION.slice, 3),
    place: phonePick(PHONE_VARIATION.place, 2),
    object: phonePick(PHONE_VARIATION.object, 3),
    userHook: phonePick(PHONE_VARIATION.userHook, 2),
    salt: Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6)
  };
}
function phoneToday(){
  const d = new Date();
  const week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + week[d.getDay()];
}
function phoneVariationBlock(v){
  return `【本批变化种子 · 必须自然写进内容，不要写成提纲】
- 今天：${phoneToday()}
- 时间锚点：${v.time.join("、")}
- 情绪基调：${v.mood.join("、")}
- 生活切面：${v.slice.join("、")}
- 场景 / 地点：${v.place.join("、")}
- 具体物件：${v.object.join("、")}
- 与用户有关的切入点：${v.userHook.join("、")}
- 随机编号：${v.salt}
硬性要求：不同 App 必须写不同的事件和场景；同一个 App 里的多条内容也要换人物、地点、物件和叙事角度；不要把种子逐条照抄成清单，要自然融进具体细节。`;
}
const PHONE_SIG_KEY = cid => "phone_recent_sigs_" + String(cid || "");
function loadPhoneSigs(cid){
  try{
    const o = JSON.parse(localStorage.getItem(PHONE_SIG_KEY(cid)) || "{}");
    return (o && typeof o === "object") ? o : {};
  }catch(e){ return {}; }
}
function uniqSigs(arr){
  const out = [];
  (arr || []).forEach(x => {
    const s = String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, 42);
    if(s.length >= 2 && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}
function collectPhoneSigs(id, data){
  const out = [];
  const add = v => { if(v != null) out.push(v); };
  const each = (arr, fn) => { if(Array.isArray(arr)) arr.forEach(fn); };
  if(id === "video") each(data, it => { add(it && it.title); add(it && it.category); each(it && it.comments, c => add(c && c.text)); });
  else if(id === "diary") each(data, it => add(it && (it.name || it.date)));
  else if(id === "album") each(data, it => { add(it && it.text); add(it && it.album); add(it && it.detail); });
  else if(id === "mail") each(data, it => add(it && (it.subject || it.title)));
  else if(id === "memo") each(data, g => each(g && g.items, it => add(it && it.title)));
  else if(id === "browser"){
    each(data && data.normal, it => { add(it && (it.keyword || it.site)); each(it && it.sections, s => add(s && s.heading)); });
    each(data && data.incognito, it => { add(it && (it.keyword || it.site)); each(it && it.sections, s => add(s && s.heading)); });
  }else if(id === "game") each(data, it => add(it && it.name));
  else if(id === "private") each(data, it => add(it && it.title));
  else if(id === "chat") each(data && data.chats, it => add(it && it.name));
  else if(id === "doubao") each(data, it => { if(it && it.role === "char") add(it.content); });
  else if(id === "taobao" || id === "store"){
    each(data && data.cart, it => add(it && (it.name || it.shop)));
    each(data && data.orders, it => add(it && (it.name || it.shop)));
    each(data && data.food, it => add(it && (it.restaurant || it.dish)));
  }else if(id === "mapcal"){
    each(data && data.places, it => add(it && (it.name || it.address)));
    each(data && data.events, it => add(it && it.title));
  }else if(id === "wallet"){
    each(data && data.transactions, it => add(it && it.desc));
  }
  return uniqSigs(out);
}
function rememberPhoneSigs(cid, id, data){
  try{
    const all = loadPhoneSigs(cid);
    const merged = uniqSigs((all[id] || []).concat(collectPhoneSigs(id, data)));
    all[id] = merged.slice(-14);
    localStorage.setItem(PHONE_SIG_KEY(cid), JSON.stringify(all));
  }catch(e){}
}
function phoneRecentBlock(recent, ids){
  const lines = [];
  (ids || []).forEach(id => {
    const arr = uniqSigs((recent && recent[id]) || []).slice(-10);
    if(arr.length) lines.push(id + "：" + arr.join(" / "));
  });
  if(!lines.length) return "";
  return `\n【最近已经生成过 · 必须避开】\n${lines.join("\n")}\n这些标题、地点、店名、物品、NPC 名字和事件都已经出现过：不要原样重复，也不要只改一两个字；每条新内容都要换一个不同的具体事件。\n`;
}


/* =========================================================
   7.5 人设 / 世界书 读取
   ========================================================= */
function readUserProfile(){
  for (const k of ["nano_mask_data","nano_home_data"]) {
    try{
      const d = JSON.parse(localStorage.getItem(k) || "null");
      if(d && Array.isArray(d.masks)){
        const cur = d.masks.find(m => m.id === d.currentMaskId) || d.masks[0] || null;
        if(cur) return cur;
      }
    }catch(e){}
  }
  return null;
}
function charSetting(c){ return (c && (c.setting || c.desc || "")) || ""; }

function openWorldbookDB(){
  return new Promise(resolve => {
    try{
      const req = indexedDB.open("nano_worldbook_db", 1);
      req.onupgradeneeded = e => {
        try{
          const db = e.target.result;
          if(!db.objectStoreNames.contains("worldbook_data"))
            db.createObjectStore("worldbook_data", {keyPath:"key"});
        }catch(e2){}
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
}
async function readWorldbookRaw(){
  try{
    const raw = localStorage.getItem("nano_worldbook_data_v5");
    if(raw){
      const d = JSON.parse(raw);
      if(d && Array.isArray(d.files)) return d;
    }
  }catch(e){}
  const db = await openWorldbookDB();
  if(!db) return null;
  return new Promise(resolve => {
    try{
      const r = db.transaction("worldbook_data","readonly").objectStore("worldbook_data").get("data");
      r.onsuccess = () => resolve(r.result ? r.result.value : null);
      r.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
}
async function readWorldbookForChar(char){
  const wb = await readWorldbookRaw();
  if(!wb || !Array.isArray(wb.files)) return [];
  const charId = char && char.id;
  const bindIds = new Set(((char && char.worldbookBindings) || []).map(w => w.id));
  const out = [];
  wb.files.forEach(f => {
    const scope = f.scope || "global";
    const isGlobal = scope === "global";
    const isLocalBound = (scope === "local") && (
      (Array.isArray(f.boundCharacters) && f.boundCharacters.includes(charId)) || bindIds.has(f.id)
    );
    const isOnline = scope === "online" && (
      !Array.isArray(f.boundCharacters) || !f.boundCharacters.length ||
      f.boundCharacters.includes(charId) || bindIds.has(f.id)
    );
    if(!isGlobal && !isLocalBound && !isOnline) return;
    (f.entries || []).forEach(en => {
      if(!en || en.enabled === false) return;
      if(!en.content || !String(en.content).trim()) return;
      const kw = String(en.keywords || "").trim();
      const always = en.permanent === true || en.keywordEnabled === false || !kw;
      if(!always) return;   /* 带关键词触发的条目在手机生成场景下不强制读取 */
      out.push({book: f.name, title: en.title || "", content: en.content});
    });
  });
  return out;
}
function openMemoryDB(){
  return new Promise(resolve => {
    try{
      const req = indexedDB.open("nano_vector_memory_db", 5);
      req.onupgradeneeded = e => {
        try{
          const d = e.target.result, tx = e.target.transaction;
          if(!d.objectStoreNames.contains("memories")){
            const s = d.createObjectStore("memories", {keyPath:"id"});
            s.createIndex("chatId","chatId",{unique:false});
            s.createIndex("type","type",{unique:false});
            s.createIndex("hasVector","hasVector",{unique:false});
          }
          if(!d.objectStoreNames.contains("config")) d.createObjectStore("config", {keyPath:"key"});
          if(!d.objectStoreNames.contains("chat_state")) d.createObjectStore("chat_state", {keyPath:"chatId"});
          if(!d.objectStoreNames.contains("chat_messages")) d.createObjectStore("chat_messages", {keyPath:"chatId"});
        }catch(e2){}
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
}
/* 读取该角色的长期记忆库（memlist_<chatId> + memories 索引） */
async function readMemoryForChar(char){
  const id = char && char.id;
  if(!id) return [];
  let mergedList = null;
  if (window.NanoMemLink && window.NanoMemLink.readList) {
    try { mergedList = await window.NanoMemLink.readList(id); } catch(e) { mergedList = null; }
  }
  const tsOf = it => {
    try {
      const n = Number(it && (it.ts || it.at));
      if (Number.isFinite(n) && n > 0) return n;
      const d = Date.parse((it && (it.date || it.time)) || '');
      return Number.isFinite(d) ? d : 0;
    } catch (e) { return 0; }
  };
  const finish = list => {
    const seen = {};
    return (list || []).map(it => ({ text: String((it && (it.content || it.text)) || '').trim(), ts: tsOf(it) }))
      .filter(x => x.text)
      .sort((a, b) => b.ts - a.ts)
      .filter(x => !seen[x.text] && (seen[x.text] = 1))
      .slice(0, 16)
      .map(x => x.text);
  };
  const db = await openMemoryDB();
  if(!db) return finish(mergedList || []);
  return new Promise(resolve => {
    const out = [];
    const push = it => {
      if (!it) return;
      const t = String(it.content || it.text || '').trim();
      if (t) out.push({ text: t, ts: tsOf(it) });
    };
    try{
      const tx = db.transaction(["config","memories"], "readonly");
      const rc = tx.objectStore("config").get("memlist_" + id);
      rc.onsuccess = () => {
        const list = (mergedList != null) ? mergedList : ((rc.result && Array.isArray(rc.result.value)) ? rc.result.value : []);
        list.forEach(push);
      };
      try{
        const rm = tx.objectStore("memories").index("chatId").getAll(id);
        rm.onsuccess = () => (rm.result || []).forEach(push);
      }catch(e){}
      tx.oncomplete = () => { try{ db.close(); }catch(e){} resolve(finish(out)); };
      tx.onerror = () => { try{ db.close(); }catch(e){} resolve(finish(out)); };
    }catch(e){ try{ db.close(); }catch(e2){} resolve([]); }
  });
}

async function buildCharContext(char){
  const user = readUserProfile();
  const parts = [];
  if(user && user.name) parts.push("【用户姓名】" + user.name);
  if(user && user.setting) parts.push("【用户设定】\n" + user.setting);
  parts.push("【角色姓名】" + ((char && char.name) || ""));
  const st = charSetting(char);
  if(char && char.desc && char.desc !== st) parts.push("【角色简介】\n" + char.desc);
  if(st) parts.push("【角色设定】\n" + st);
  const wb = await readWorldbookForChar(char);
  if(wb.length) parts.push("【世界书设定】\n" + wb.map(w => (w.title ? "· " + w.title + "：" : "· ") + w.content).join("\n"));
  const mem = await readMemoryForChar(char);
  if(mem.length) parts.push("【记忆库（你与用户共同经历 / 已知的事）】\n" + mem.map(m => "· " + m).join("\n"));
  return parts.join("\n\n");
}

/* 内容受限时的轻量上下文：去掉世界书、记忆库和用户设定，只保留脱敏后的角色概况 */
function sanitizeContextText(s, max){
  const bad = /(裸体|裸照|强奸|幼女|正太|血腥|肢解|自残|自杀|毒品|犯罪|虐待)/i;
  const lines = String(s || "").split(/\n+/).filter(line => line && !bad.test(line));
  return lines.join("\n").slice(0, max || 1000);
}
function buildLiteContext(char){
  const user = readUserProfile();
  const parts = [];
  if(user && user.name) parts.push("【用户称呼】" + user.name);
  parts.push("【角色姓名】" + ((char && char.name) || ""));
  const st = sanitizeContextText(char && (char.setting || char.desc), 1000);
  if(st) parts.push("【角色概况】\n" + st);
  parts.push("【生成范围】只写日常、工作、消费、社交和个人随想，生活化，若是情侣关系，爱人之间的秘密通常也被记录。");
  return parts.join("\n\n");
}

/* =========================================================
   8. 生成器
   ========================================================= */
async function genVideo(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的视频 App 数据生成器。
${ctx}

${PERSONA_RULE}

请生成 4 条「${char.name}」在 B 站/短视频 App 的观看记录与收藏，不要全是同一类视频。
要求：
1. 至少覆盖 3 种不同分区：日常 vlog、影视解说、游戏、美食、音乐/Live、舞蹈、知识科普、健身、情感/八卦、ASMR、猎奇、动漫、成熟题材等，必须贴合角色兴趣与近期生活。
2. 其中 1-2 条可以是他不想被人看到的「私密收藏/深夜播放」：暧昧向、情感代餐、ASMR、身材/亲密关系相关、自己偷偷搜索的尴尬内容等；这是成年虚构角色，含蓄克制，不写露骨细节，也不要违法/血腥。
3. 标题像真实 B 站/短视频标题（可含「」、疑问句、数字、emoji），15-40 字；简介要写清视频讲了什么 + 角色为什么看/看完的反应。
4. 每条包含：
   - title: 视频标题
   - up: UP 主名称（3-12 字）
   - date: 观看时间，格式 "2026年8月12日 11:23"
   - duration: 视频总时长，格式 "01:42" 或 "10:00"
   - progress: 观看进度，格式 "00:03"（小于 duration；深夜私密视频可以写很早退出）
   - desc: 视频简介（30-60 字，写清视频内容 + 角色反应，不要写空行）
   - category: 分区/标签，如 "影视解说"、"深夜"、"ASMR"、"游戏"、"私密收藏"
   - tags: 2-3 个短标签数组
   - collected: true/false 是否收藏
   - private: true/false 是否不想被别人看到（深夜/私密/尴尬内容用 true）
   - note: 角色自己的一句备注（可选，10-30 字，例如"留着睡前看"）
   - comments: 2-3 条弹幕/评论，每条 {"user":"网名","text":"..."}，像真实 B 站弹幕，短、玩梗、有活人感
只输出 JSON 数组，形如 [{"title":"...","up":"...","date":"...","duration":"...","progress":"...","desc":"...","category":"...","tags":["..."],"collected":false,"private":false,"note":"...","comments":[{"user":"...","text":"..."}]}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("视频数据格式错误");
  return a.slice(0, 4);
}

async function genDiary(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的日记数据生成器，用于虚构角色的生活记录。
${ctx}

${PERSONA_RULE}

请生成 3 篇「${char.name}」的日记。
要求：
1. 以角色第一人称写，内容贴合其近况与内心（可包含不易说出口的隐秘心绪，但克制、含蓄，最多 1 篇略有波澜）。
2. 每篇包含：
   - date: 日期，格式 "2026 · 08 · 28"
   - name: 日记标题（4-10 字）
   - day: 星期几
   - weather: 天气
   - content: 日记正文（70-120 字，自然记叙）
3. 标题与内容不要重复。
只输出 JSON 数组，形如 [{"date":"...","name":"...","day":"...","weather":"...","content":"..."}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("日记数据格式错误");
  return a.slice(0, 3);
}

async function genAlbum(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的图库数据生成器。
${ctx}

${PERSONA_RULE}

请生成 8 条「${char.name}」图库照片的描述，不要全是同一种日常。
要求：
1. 覆盖不同相册类型：日常、自拍、美食、旅行/街景、截图、宠物、工作/学习、与用户的合照、私密相册等，至少 4 种；不要 8 条都是同一个房间/同一杯咖啡/同一只猫。
2. 其中 2 条放进「私密相册」：只有角色自己知道、不想被别人看到的内容，例如亲密关系、暧昧合照、暧昧聊天截图、身材记录、偷偷保存的人、私密购物/礼物等；这是成年虚构角色，但只用含蓄、克制的暗示，不写露骨细节，不要违法/血腥，也不要 8 条都写私密。
3. 每条不是抽象的「心情」：要像照片里被定格的瞬间，写清光线、地点、物件、人物局部、当时发生的小事，12-40 字；至少 1 条是没看镜头的抓拍、至少 1 条有具体到能想象出来的小细节（招牌、雨伞、车窗、桌角、耳机线等），不要只写“想你/很忙/很累”。
4. 每条包含：
   - text: 照片上的一行字/描述（12-40 字）
   - date: 拍摄日期，如 "8月27日 21:14"
   - place: 地点（可留空）
   - people: 画面里出现的人（可留空，如 "你"、"妈妈"、"同事"）
   - album: 相册分类（日常 / 自拍 / 美食 / 旅行 / 截图 / 工作 / 宠物 / 私密）
   - private: true/false 是否在私密相册
   - detail: 这张照片背后的具体细节（30-70 字，角色为什么留着它）
5. 8 条不要重复同一场景、同一物件或同一句式。
只输出 JSON 数组，形如 [{"text":"...","date":"...","place":"...","people":"...","album":"日常","private":false,"detail":"..."}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("图库数据格式错误");
  return a.slice(0, 8);
}

async function genMail(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的邮箱数据生成器。
${ctx}

${PERSONA_RULE}

请为「${char.name}」生成 4 封邮箱收件。
要求：
1. 邮件可以是：工作/学习单位通知、App 订阅/账单、其他 NPC 的私信、广告推广、系统安全提醒等，符合角色身份与社交圈。
2. 发件人真实感强（可用真实品牌名或符合世界书的 NPC 名）。
3. 每封包含：
   - sender: 发件人名
   - date: 日期，如 "8月27日"
   - subject: 邮件标题
   - preview: 预览摘要（20-40 字）
   - icon: 图标类型，"person" / "chat" / "gicon" 三选一
   - unread: 是否未读 true/false
    - title: 邮件正文标题
    - body: 正文段落数组（2-3 段，放原文）
    - translation: 整封邮件的中文翻译（外文邮件必填，统一写一段，不要逐段；中文邮件留空）
 只输出 JSON 数组，形如 [{"sender":"...","date":"...","subject":"...","preview":"...","icon":"person","unread":false,"title":"...","body":["...","..."],"translation":"..."}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("邮件数据格式错误");
  return a.slice(0, 4);
}

async function genMemo(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的备忘录数据生成器。
${ctx}

${PERSONA_RULE}

请为「${char.name}」生成 3 个备忘录分组。
要求：
1. 分组名像真实时间分组（如 "过去 7 天"、"过去 30 天"、"七月"）。
2. 每组 2-3 条。
3. 字段：
   - group: 分组名
   - items: 数组，每条含：
     - title: 短标题
     - meta: "日期 · 摘要"
     - content: 备忘录正文（可多段，用 \\n）
只输出 JSON 数组，形如 [{"group":"...","items":[{"title":"...","meta":"...","content":"..."}]}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("备忘录数据格式错误");
  return a.slice(0, 3);
}

async function genHealth(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的健康 App 数据生成器。
${ctx}

${PERSONA_RULE}

请生成「${char.name}」一天的 Apple 健康数据，作息与运动量要贴合角色设定。
要求：
- steps: {total(整数), goal(整数), hours(24 个整数数组)}
- distance: {total(公里数字符串), kcal(整数)}
- sleep: {score(0-100), duration("7小时12分"), deep("1h 48m"), weekly(7 个 0-100 数组)}
- screen: {hours(整数), minutes(整数), weekly(7 个整数分钟数)}
只输出 JSON 对象，形如 {"steps":{"total":8426,"goal":10000,"hours":[1200,0,0,0,0,0,0,320,540,860,430,210,680,920,1500,1200,760,340,880,1120,640,300,150,0]},"distance":{"total":"5.80","kcal":318},"sleep":{"score":92,"duration":"8小时12分","deep":"1h 48m","weekly":[78,85,60,92,70,88,95]},"screen":{"hours":3,"minutes":46,"weekly":[120,95,140,60,180,210,226]}}`;
  const t = await callAPI(api, SYS_JSON, user);
  const o = extractJSON(t);
  if(!o || !o.steps) throw new Error("健康数据格式错误");
  return o;
}

/* 浏览器数据兼容：旧数据是数组（只有普通记录），新数据是 {normal, incognito} */
function normalizeBrowserData(raw){
  const clean = arr => (Array.isArray(arr) ? arr : [])
    .filter(it => it && typeof it === "object")
    .filter(it => it.keyword || it.query || it.title || it.url);
  if(Array.isArray(raw)) return { normal: clean(raw), incognito: [] };
  if(raw && typeof raw === "object"){
    return {
      normal: clean(raw.normal || raw.history),
      incognito: clean(raw.incognito || raw.private)
    };
  }
  return { normal: [], incognito: [] };
}

async function genBrowser(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的浏览器记录生成器。
${ctx}

${PERSONA_RULE}

请生成「${char.name}」的浏览器记录，分成「普通搜索」和「无痕浏览」两组。
要求：
1. normal（普通搜索/访问记录）5-6 条：符合角色兴趣与生活的日常搜索、网页访问，类型要丰富：工作/学习资料、购物比价、外卖/菜谱、健康、追剧/追星、游戏攻略、旅游攻略、本地服务、论坛/八卦、新闻、租房/二手、情感求助等；不要全是同一类。
2. incognito（无痕浏览）3-4 条：角色真正不想被别人看到的内容。可以是亲密关系里的反复确认、暗恋/心事、私密身体困扰、内衣/私密购物、偷偷搜索某个人、难以启齿的小习惯、羞耻的自我搜索等。这是成年虚构角色，可以写得有画面，但要含蓄克制，不写露骨细节；不要违法/血腥，也不要把无痕写成普通的购物记录。
3. 每条记录必须是一张「能点开看的网页」，页面内容要丰富，不能只有一句摘要：
   - keyword: 搜索词或页面标题（显示在列表第一行）
   - url: 网址，像真实域名
   - site: 网站名（如 "NANO JOURNAL"）
   - title: 网页标题（详情页大标题）
   - time: 完整时间，如 "今天 22:06"
   - visits: 访问次数（整数）
   - intro: 页面导语/摘要（60-120 字，具体到网页里发生了什么）
   - sections: 2-3 个网页正文区块，每个 {"heading":"小标题","text":"正文 80-180 字，有具体细节/数据/对话/观点","list":["可选要点"]}
   - quote: 页面里被角色注意到的一句原话（15-50 字）
   - points: 3 条页面要点字符串数组
   - comments: 3-5 条网页评论/跟帖，每条 {"user":"网名","text":"..."}，像真实评论区，有夸有骂有玩梗
   - related: 2-3 条相关推荐，每条 {"title":"...","site":"...","url":"..."}
4. 普通和无痕都要换新主题，不要重复最近生成过的搜索词和网页。
只输出 JSON 对象，形如 {"normal":[{"keyword":"...","url":"...","site":"...","title":"...","time":"今天 22:06","visits":3,"intro":"...","sections":[{"heading":"...","text":"...","list":["..."]}],"quote":"...","points":["...","...","..."],"comments":[{"user":"...","text":"..."}],"related":[{"title":"...","site":"...","url":"..."}]}],"incognito":[{"keyword":"...","url":"...","site":"...","title":"...","time":"今天 23:41","visits":2,"intro":"...","sections":[{"heading":"...","text":"...","list":["..."]}],"quote":"...","points":["...","...","..."],"comments":[{"user":"...","text":"..."}],"related":[{"title":"...","site":"...","url":"..."}]}]}`;
  const t = await callAPI(api, SYS_JSON, user);
  const o = extractJSON(t);
  const model = normalizeBrowserData(o);
  if(!model.normal.length && !model.incognito.length) throw new Error("浏览器数据格式错误");
  model.normal = model.normal.slice(0, 8);
  model.incognito = model.incognito.slice(0, 6);
  return model;
}

async function genGame(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的游戏 App 数据生成器。
${ctx}

${PERSONA_RULE}

请生成 2-3 个「${char.name}」常玩的游戏。
要求：游戏名必须使用中文（如「英雄联盟」「无畏契约」「原神」「第五人格」），不要使用英文名；段位也用中文或通用中文缩写（如「大师」「王者」「钻石 II」）。
每个游戏包含：
- name: 游戏名（真实或符合角色风格）
- id: 游戏 ID，如 "4827 1936"
- winRate: 胜率 0-100 整数
- matches: 总场次
- wins: 胜场
- losses: 负场
- rank: 段位名，如 "MASTER III"
- rating: 评分数字，如 2847
- rankMark: 段位罗马数字，如 "III"
- recent: 最近 4 场对局数组，每条：
   - result: "W" 或 "L"
   - mode: "Ranked Match" 或 "Casual Match"
   - time: "今天 · 21:42"
   - kda: "18 / 6 / 11"
- habit: 隐藏游戏习惯描述（30-60 字）
- weekly: 7 个 0-100 数字（周一到周日活跃度）
只输出 JSON 数组，形如 [{"name":"...","id":"...","winRate":68,"matches":327,"wins":222,"losses":105,"rank":"MASTER III","rating":2847,"rankMark":"III","recent":[{"result":"W","mode":"Ranked Match","time":"今天 · 21:42","kda":"18 / 6 / 11"}],"habit":"...","weekly":[35,55,43,75,100,67,46]}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("游戏数据格式错误");
  return a.slice(0, 3);
}

async function genPrivate(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的私事整理器。
${ctx}

${PERSONA_RULE}

请整理 5 条「${char.name}」不为人说的私事，贴合其人设与经历。
要求：
1. 每条都要是一件完整、具体、有意义的事，而不是一句空泛的心情。必须有具体时间、地点、人物、对话、动作或后续；5 条分别来自不同生活切面（家人、朋友、工作/学习、亲密关系、身体状态、消费、旧回忆等），不要都是「想你 / 自卑 / 怕失去 / 暗恋」。
2. 角色可以写不愿公开的亲密关系与难以启齿的私事；其中 1-2 条可以写见不得人的心动、欲望或幻想，用暗示、停顿、随身物件、气味、距离和场景来写，写角色的羞耻、克制和反复想起的念头；不要直白描写身体，不使用露骨词汇，避免被内容审核截断。
3. 每条包含：
   - type: 序号，如 "PRIVATE / 01"
   - time: 时间，如 "23:41"
   - title: 标题（6-14 字）
   - preview: 30-55 字，第一人称，写清是什么事、和谁、发生在哪
   - detail: 100-200 字，写清具体经过：当时在做什么、对方说了什么、自己怎么反应、后来有没有后续
   - tags: 2 个短标签数组，如 ["心事","私密"]
   - level: "轻" 或 "中"（默认 "轻"）
只输出 JSON 数组，形如 [{"type":"PRIVATE / 01","time":"23:41","title":"...","preview":"...","detail":"...","tags":["心事","私密"],"level":"轻"}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("私密数据格式错误");
  return a.slice(0, 8);
}

/* 内容策略拦截时，用本地模板补上「个人随想」，保证查手机不会因为一个 App 整页失败 */
function genPrivateLocal(char){
  const user = readUserProfile();
  const uname = (user && user.name) || "你";
  const st = String((char && (char.setting || char.desc)) || "");
  const pool = [
    { title: "没说出口的话", preview: "有些话到了嘴边，又觉得不必说了。", detail: "今天路过一家店，突然想起" + uname + "提过喜欢的东西。当时没接话，后来一直记着。", tags: ["日常", "随想"] },
    { title: "一个人的时候", preview: "其实也没有那么喜欢独处。", detail: "回到家把灯都打开，才觉得安静得有点过头。想找人说句话，又不知道从哪句开始。", tags: ["夜晚", "心事"] },
    { title: "装作不在意", preview: "有件事我还在意，只是没说。", detail: "白天表现得很平常，晚上又想起来。可能下次见面还是会装作已经过去了。", tags: ["心事", "日常"] },
    { title: "反复看过的消息", preview: "你发来的那句话，我看了好几遍。", detail: "明明只是一句很普通的话，却让我停了一会儿。回得太快显得奇怪，就隔了几分钟才回。", tags: ["关系", "随想"] },
    { title: "最近有点累", preview: "累是真的，但不想让你担心。", detail: "今天事情很多，回到家只想躺着。有人问起的时候，还是习惯说“还好”。", tags: ["工作", "日常"] },
    { title: "还没想好", preview: "关于以后的事，我还没想清楚。", detail: "偶尔会想到很远的以后，但每次想到一半就停下来了。等想明白了，再告诉你。", tags: ["未来", "心事"] },
    { title: "想起一件小事", preview: "今天突然想起很久以前的一句话。", detail: "是很小的事，小到当时没觉得重要。现在想起来，却记得很清楚。", tags: ["记忆", "日常"] },
    { title: "不太习惯被看见", preview: "我也会有不确定的时候。", detail: "只是不太习惯让别人看见。大多数时候，把情绪收一收，就过去了。", tags: ["情绪", "随想"] },
    { title: "没发出去的消息", preview: "有一段话打完了，又删掉了。", detail: "其实很想直接告诉你，但又怕太明显。最后只留下一个很普通的晚安。", tags: ["心事", "关系"] },
    { title: "不想让人知道", preview: "有些念头，我只敢在夜里想一想。", detail: "白天可以装作什么都没发生，晚上却会反复想起。第二天还是会照常起床。", tags: ["夜晚", "私密"] },
    { title: "离你近一点", preview: "今天有一瞬间，很想离你再近一点。", detail: "不是非要说出口，只是那一刻身体比脑子先动了一下。后来又装作没事。", tags: ["关系", "私密"] },
    { title: "没说出口的喜欢", preview: "其实有句话，我很想问。", detail: "又怕问了就回不去。于是话到嘴边，还是换成了别的话题。", tags: ["心事", "关系"] }
  ];
  if (/设计|画|稿|创作|写/.test(st)) {
    pool.push({ title: "没完成的那一点", preview: "改了又改，还是觉得差一点。", detail: "其实可以交差了，但自己那关过不去。想听听" + uname + "的意见，又怕显得太在意。", tags: ["工作", "随想"] });
  }
  if (/学生|考试|论文|学校/.test(st)) {
    pool.push({ title: "没说出口的压力", preview: "最近的事比说出来的多。", detail: "别人问起就说还好。其实有点慌，只是不想把这种情绪分给别人。", tags: ["学校", "心事"] });
  }
  const shuffled = pool.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 5);
  const tails = [
    "那晚我把手机扣在桌上，屏幕亮了两次，都是" + uname + "发来的，我等到第三次才回。",
    "第二天有人问起，我只说没事，转身去洗了把脸，回来继续做手上的事。",
    "这件事我没跟任何人讲过，连" + uname + "也只看到我后来很平常的样子。",
    "后来我把那张小票夹进了书里，偶尔翻到会停一下，再合上。",
    "当时窗外有车经过，我下意识把声音关小，怕被人听见。"
  ];
  return shuffled.map(function (it, i) {
    var h = 21 + Math.floor(Math.random() * 4);
    if (h >= 24) h -= 24;
    var hh = String(h).padStart(2, "0");
    var mm = String(Math.floor(Math.random() * 60)).padStart(2, "0");
    return {
      type: "PRIVATE / " + String(i + 1).padStart(2, "0"),
      time: hh + ":" + mm,
      title: it.title,
      preview: it.preview,
      detail: it.detail + " " + tails[i % tails.length],
      tags: it.tags,
      level: "轻"
    };
  });
}

/* 聊天数据兼容：旧数据是数组（只有会话），新数据是 {userRemark, chats} */
function normalizeChatData(raw){
  const clean = arr => (Array.isArray(arr) ? arr : [])
    .filter(it => it && typeof it === "object" && (it.name || it.lastMsg || (Array.isArray(it.messages) && it.messages.length)))
    .map(it => {
      const msgs = (Array.isArray(it.messages) ? it.messages : [])
        .filter(m => m && typeof m === "object" && (m.text || m.name || m.sender))
        .map(m => Object.assign({}, m, {
          side: (m.side === "right" || m.right) ? "right" : "left",
          text: phoneText(m.text || ""),
          name: String(m.name || m.sender || "").trim()
        }));
      const out = Object.assign({}, it, { messages: msgs });
      if(!out.lastMsg && msgs.length) out.lastMsg = msgs[msgs.length - 1].text || "";
      // 群聊兜底：模型没显式标 group，但左侧消息有多个发言人 → 按群聊渲染。
      const leftNames = [...new Set(msgs.filter(m => m.side !== "right" && m.name).map(m => m.name))];
      if(out.group){
        if(!Array.isArray(out.members) || !out.members.length) out.members = leftNames;
      }else if(leftNames.length >= 2){
        out.group = true;
        out.members = leftNames;
        if(!/群/.test(String(out.name || ""))) out.name = String(out.name || "闲聊") + "（群）";
      }
      return out;
    });
  if(Array.isArray(raw)) return {userRemark: "", chats: clean(raw)};
  if(raw && typeof raw === "object"){
    return {
      userRemark: String(raw.userRemark || raw.remark || raw.user_note || "").trim(),
      chats: clean(raw.chats || raw.data || [])
    };
  }
  return {userRemark: "", chats: []};
}
async function genChat(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的聊天 App 数据生成器。
${ctx}

${PERSONA_RULE}

请生成「${char.name}」手机里的聊天数据：3 个与 NPC 的聊天会话，以及「${char.name}」给用户存的联系人备注。
要求：
1. 3 个聊天对象是不同的 NPC（家人、朋友、同事、暗恋对象、陌生人等），必须符合角色的社交圈与世界观；不要生成和用户本人的会话。
2. 每个会话 5-8 条聊天记录，有来有回，语气贴合各自身份。
3. userRemark：${char.name} 在自己手机里给「用户」存的备注（2-8 字），要符合两人的关系、角色对用户的称呼习惯与性格，可以是亲昵、别扭、吐槽式或普通备注，不要用「小姑娘/小东西/丫头/女人」这类油腻称呼。
4. 会话字段：
   - name: NPC 名字（2-8 字）
   - lastMsg: 最后一条消息（列表预览）
   - time: 最后消息时间，如 "昨天 22:13"、"8月27日"
   - unread: 未读数量（0-5 整数）
    - messages: 消息数组，每条 {"side":"left"|"right","text":"原文","translation":"中文时留空；外文时填中文译文"}
      - left = NPC 发的，right = 角色自己发的
 只输出 JSON 对象，形如 {"userRemark":"...","chats":[{"name":"...","lastMsg":"...","time":"...","unread":0,"messages":[{"side":"left","text":"...","translation":""}]}]}`;
  const t = await callAPI(api, SYS_JSON, user);
  const o = extractJSON(t);
  const model = normalizeChatData(o);
  if(!model.chats.length) throw new Error("聊天数据格式错误");
  model.chats = model.chats.slice(0, 3);
  return model;
}

async function generateFor(appId, api, char){
  if(appId === "video")   return {type: "video",   data: await genVideo(api, char)};
  if(appId === "diary")   return {type: "diary",   data: await genDiary(api, char)};
  if(appId === "album")   return {type: "album",   data: await genAlbum(api, char)};
  if(appId === "mail")    return {type: "mail",    data: await genMail(api, char)};
  if(appId === "memo")    return {type: "memo",    data: await genMemo(api, char)};
  if(appId === "health")  return {type: "health",  data: await genHealth(api, char)};
  if(appId === "browser") return {type: "browser", data: await genBrowser(api, char)};
  if(appId === "game")    return {type: "game",    data: await genGame(api, char)};
  if(appId === "private") return {type: "private", data: await genPrivate(api, char)};
  if(appId === "chat")    return {type: "chat",    data: await genChat(api, char)};
  return null;
}

/* =========================================================
   9. App 渲染器
   ========================================================= */
const appHost = document.getElementById("appHost");
let currentAppId = null;

function closeApp(){
  appHost.classList.remove("show");
  appHost.innerHTML = "";
  currentAppId = null;
  appHost._bwMode = null;
}

/* ---------- 视频 ---------- */
async function openVideoList(){
  appHost.innerHTML = `<div class="vd-wrap">
    <header class="vd-top">
      <div class="vd-top-left" data-back>
        <div>
          <div class="vd-top-title">视频</div>
          <div class="vd-top-sub">VIDEO HISTORY</div>
        </div>
      </div>
      <button class="vd-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="vd-content">
      <div class="vd-heading"><h2>观看历史</h2><span data-count>0 条</span></div>
      <div class="vd-list" data-list></div>
    </main>
    <div class="dt" data-detail>
      <header class="dt-top">
        <button class="dt-back" data-dback aria-label="返回"><svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div class="dt-title">视频</div>
        <div class="dt-right"></div>
      </header>
      <div class="dt-scroll">
        <div class="vd-player"><div class="vd-player-btn"><svg viewBox="0 0 24 24" fill="none"><path d="m9 6 9 6-9 6V6Z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div></div>
        <div class="vd-detail-title" data-dtitle></div>
        <div class="vd-detail-meta" data-dmeta></div>
        <div class="vd-detail-desc" data-ddesc></div>
      </div>
    </div>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["video"]);
  appHost.querySelector("[data-dback]").onclick = () => appHost.querySelector("[data-detail]").classList.remove("open");
  const saved = await dataGet(`app_${currentChar.id}_video`);
  renderVideoList(saved?.data || []);
}
function renderVideoList(videos){
  const list = appHost.querySelector("[data-list]");
  const count = appHost.querySelector("[data-count]");
  count.textContent = videos.length + " 条";
  list.innerHTML = "";
  if(!videos.length){
    list.innerHTML = `<div class="app-empty">暂无观看历史，点右上角刷新生成</div>`;
    return;
  }
  videos.forEach(v => {
    const card = document.createElement("article");
    card.className = "vd-item";
    const tags = [];
    if(v.category) tags.push(`<span class="vd-tag main">${escHtml(v.category)}</span>`);
    (Array.isArray(v.tags) ? v.tags : []).slice(0, 2).forEach(t => tags.push(`<span class="vd-tag">${escHtml(t)}</span>`));
    if(v.collected) tags.push(`<span class="vd-tag fav">已收藏</span>`);
    if(v.private) tags.push(`<span class="vd-tag private">私密</span>`);
    card.innerHTML = `
      <div class="vd-thumb">
        <div class="vd-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
        <div class="vd-duration">${escHtml(v.progress || "00:00")} / ${escHtml(v.duration || "00:00")}</div>
      </div>
      <div class="vd-info">
        <div class="vd-title">${escHtml(phoneText(v.title))}</div>
        <div class="vd-up">${escHtml(phoneText(v.up))}</div>
        <div class="vd-tags">${tags.join("")}</div>
        <div class="vd-date">${escHtml(phoneText(v.date))}</div>
      </div>`;
    card.onclick = () => openVideoDetail(v);
    list.appendChild(card);
  });
}
async function refreshVideo(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  if(list) list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genVideo(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_video`, {type:"video", data});
    renderVideoList(data);
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openVideoDetail(v){
  appHost.querySelector("[data-dtitle]").textContent = phoneText(v.title || "");
  const metaBits = [v.up, v.date, v.category].filter(Boolean).map(x => phoneText(x));
  if(v.duration) metaBits.push("时长 " + v.duration);
  appHost.querySelector("[data-dmeta]").textContent = metaBits.join(" · ");
  const tags = (Array.isArray(v.tags) ? v.tags : []).map(t => `<span class="vd-tag">${escHtml(phoneText(t))}</span>`).join("");
  const comments = (Array.isArray(v.comments) ? v.comments : []).filter(c => c && (c.text || c.user)).map(c =>
    `<div class="vd-comment"><span class="vd-comment-user">${escHtml(c.user || "网友")}</span><span class="vd-comment-text">${escHtml(phoneText(c.text || ""))}</span></div>`
  ).join("");
  const desc = phoneText(v.desc || "");
  const note = phoneText(v.note || "");
  const blocks = [];
  if(desc) blocks.push(`<div class="vd-desc-text">${escHtml(desc)}</div>`);
  if(note) blocks.push(`<div class="vd-note">${escHtml(note)}</div>`);
  if(tags) blocks.push(`<div class="vd-tags detail">${tags}</div>`);
  if(v.private) blocks.push(`<div class="vd-private-hint">这条被角色标记为不想被别人看到的内容</div>`);
  if(comments) blocks.push(`<div class="vd-comments"><div class="vd-comments-title">弹幕 / 评论</div>${comments}</div>`);
  appHost.querySelector("[data-ddesc]").innerHTML = blocks.join("");
  appHost.querySelector("[data-detail]").classList.add("open");
}

/* ---------- 日记 ---------- */
const DIARY_COLORS = ["#e8e8ea","#dcdcdf","#e2e2e4","#d4d4d8","#e6e6e8","#d8d8db"];
const DIARY_SPINES = ["rgba(90,90,95,.5)","#8a8a90","#7a7a80","#909096","#828288","#888890"];

async function openDiary(){
  appHost.innerHTML = `<div class="dy-wrap">
    <header class="dy-top">
      <div class="dy-top-left" data-back>
        <div>
          <div class="dy-top-title">日记</div>
          <div class="dy-top-sub">DIARY</div>
        </div>
      </div>
      <button class="dy-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <div class="diary-list" data-list></div>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["diary"]);
  const saved = await dataGet(`app_${currentChar.id}_diary`);
  renderDiaryList(saved?.data || []);
}
function renderDiaryList(diaries){
  const list = appHost.querySelector("[data-list]");
  list.innerHTML = "";
  if(!diaries.length){
    list.innerHTML = `<div class="app-empty">暂无日记，点右上角刷新生成</div>`;
    return;
  }
  const grid = document.createElement("div");
  grid.className = "diary-grid";
  diaries.forEach((d, i) => {
    const ci = i % DIARY_COLORS.length;
    const wrap = document.createElement("div");
    wrap.className = "diary-item";
    wrap.innerHTML = `
      <div class="diary-book">
        <div class="diary-cover" style="background:${DIARY_COLORS[ci]}">
          <div class="diary-spine" style="background:${DIARY_SPINES[ci]}"></div>
          <div class="diary-star">☆</div>
          <div class="diary-cover-label">DIARY · 2026</div>
          <div class="diary-cover-name">${escHtml(d.name)}</div>
          <div class="diary-cover-lines"><span></span><span></span></div>
        </div>
      </div>
      <div class="diary-info">
        <div class="diary-info-name">${escHtml(d.name)}</div>
        <div class="diary-info-date">${escHtml(d.date)}</div>
      </div>`;
    wrap.onclick = () => openDiaryDetail(d);
    grid.appendChild(wrap);
  });
  list.appendChild(grid);
}
async function refreshDiary(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  if(list) list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genDiary(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_diary`, {type:"diary", data});
    renderDiaryList(data);
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openDiaryDetail(d){
  appHost.insertAdjacentHTML("beforeend", `
    <div class="dt open" data-detail>
      <header class="dt-top">
        <button class="dt-back" data-dback aria-label="返回"><svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div class="dt-title">日记</div>
        <div class="dt-right"></div>
      </header>
      <div class="dt-scroll">
        <div class="dy-paper">
          <div class="dy-paper-date">${escHtml(d.date)}</div>
          <div class="dy-paper-title">${escHtml(d.name)}</div>
          <div class="dy-paper-meta">
            <span>${escHtml(d.day)}</span><span class="dy-paper-dot"></span><span>${escHtml(d.weather)}</span>
          </div>
          <div class="dy-paper-rule"></div>
          <div class="dy-paper-body">${escHtml(d.content)}</div>
        </div>
      </div>
    </div>`);
  const det = appHost.querySelector("[data-detail]");
  det.querySelector("[data-dback]").onclick = () => det.remove();
}

/* ---------- 图库 ---------- */
const ALBUM_BG = ["#d1d1d6","#bfc0c5","#d8d8dc","#c4c5ca","#d0d0d4","#b9bbc0"];

const AB_GRADIENTS = [
  "linear-gradient(135deg,#e9e9ec,#d8d8dc)",
  "linear-gradient(135deg,#e2e2e5,#cfcfd4)",
  "linear-gradient(135deg,#ececee,#dcdce0)",
  "linear-gradient(135deg,#e5e5e8,#d2d2d7)",
  "linear-gradient(135deg,#eaeaea,#d6d6da)",
  "linear-gradient(135deg,#e0e0e3,#cdcdd2)"
];

async function openAlbum(){
  appHost.innerHTML = `<div class="ab-wrap">
    <header class="ab-top">
      <div class="ab-top-left" data-back>
        <div>
          <div class="ab-top-title">图库</div>
          <div class="ab-top-sub">ALBUM</div>
        </div>
      </div>
      <button class="ab-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="ab-content">
      <div class="ab-heading"><h2>照片</h2><span data-count>0 张</span></div>
      <div class="ab-tabs" data-tabs></div>
      <div class="ab-grid" data-grid></div>
    </main>
    <div class="ab-viewer" data-viewer>
      <div class="ab-viewer-nav">
        <button class="ab-close" data-close><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div></div>
      </div>
      <div class="ab-viewer-body"><div class="ab-viewer-card" data-viewer-card></div><div class="ab-viewer-meta" data-viewer-meta></div></div>
      <div class="ab-viewer-foot">照片</div>
    </div>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["album"]);
  appHost.querySelector("[data-close]").onclick = () => appHost.querySelector("[data-viewer]").classList.remove("open");
  const saved = await dataGet(`app_${currentChar.id}_album`);
  appHost._albumFilter = "all";
  renderAlbumGrid(saved?.data || []);
}
function renderAlbumGrid(photos){
  const grid = appHost.querySelector("[data-grid]");
  const tabs = appHost.querySelector("[data-tabs]");
  const count = appHost.querySelector("[data-count]");
  const filter = appHost._albumFilter || "all";
  const all = Array.isArray(photos) ? photos.filter(p => p && (p.text || p.detail)) : [];
  const albums = [];
  all.forEach(p => { const a = String(p.album || "").trim(); if(a && a !== "私密" && albums.indexOf(a) < 0) albums.push(a); });
  const hasPrivate = all.some(p => p.private || p.album === "私密");
  if(tabs){
    const items = [{ id:"all", label:"全部" }].concat(albums.map(a => ({ id:a, label:a })));
    if(hasPrivate) items.push({ id:"private", label:"私密" });
    tabs.innerHTML = items.map(t => `<button class="ab-tab${filter === t.id ? " active" : ""}" data-album="${escHtml(t.id)}" type="button">${escHtml(t.label)}</button>`).join("");
    tabs.querySelectorAll("[data-album]").forEach(b => {
      b.onclick = () => { appHost._albumFilter = b.dataset.album || "all"; renderAlbumGrid(all); };
    });
  }
  let photosFiltered = all;
  if(filter === "private") photosFiltered = all.filter(p => p.private || p.album === "私密");
  else if(filter !== "all") photosFiltered = all.filter(p => String(p.album || "") === filter);
  count.textContent = photosFiltered.length + " 张";
  grid.innerHTML = "";
  if(!photosFiltered.length){
    grid.innerHTML = `<div class="app-empty" style="grid-column:1/-1">${filter === "private" ? "私密相册是空的" : "暂无照片，点右上角刷新生成"}</div>`;
    return;
  }
  photosFiltered.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "ab-photo" + (p.private || p.album === "私密" ? " private" : "");
    card.style.background = AB_GRADIENTS[i % AB_GRADIENTS.length];
    const badge = (p.private || p.album === "私密") ? "私密" : (p.album || "");
    card.innerHTML = `<div class="ab-photo-text">${escHtml(p.text)}</div>
      ${badge ? `<div class="ab-photo-badge">${escHtml(badge)}</div>` : ""}
      ${(p.date || p.place) ? `<div class="ab-photo-meta">${escHtml([p.date, p.place].filter(Boolean).join(" · "))}</div>` : ""}`;
    card.onclick = () => openAlbumViewer(p, i);
    grid.appendChild(card);
  });
}
async function refreshAlbum(){
  const api = await getApiInfo();
  if(!api) return;
  const grid = appHost.querySelector("[data-grid]");
  if(grid) grid.innerHTML = `<div class="app-empty" style="grid-column:1/-1">正在生成…</div>`;
  try{
    const data = await genAlbum(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_album`, {type:"album", data});
    renderAlbumGrid(data);
  }catch(e){
    if(grid) grid.innerHTML = `<div class="app-error" style="grid-column:1/-1">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openAlbumViewer(photo, i){
  const p = (photo && typeof photo === "object") ? photo : { text: String(photo || "") };
  const card = appHost.querySelector("[data-viewer-card]");
  const meta = appHost.querySelector("[data-viewer-meta]");
  card.style.background = AB_GRADIENTS[i % AB_GRADIENTS.length];
  card.innerHTML = `<div class="ab-viewer-text">${escHtml(p.text || "")}</div>`;
  if(meta){
    const rows = [];
    if(p.detail) rows.push(`<div class="ab-viewer-detail">${escHtml(p.detail)}</div>`);
    const info = [p.date, p.place, p.people ? ("出镜：" + p.people) : "", p.private || p.album === "私密" ? "私密相册" : p.album].filter(Boolean);
    if(info.length) rows.push(`<div class="ab-viewer-info">${info.map(escHtml).join(" · ")}</div>`);
    meta.innerHTML = rows.join("");
  }
  appHost.querySelector("[data-viewer]").classList.add("open");
}

/* ---------- 邮件 ---------- */
async function openMail(){
  const av = currentChar.avatar || "";
  const initial = av ? "" : escHtml(String(currentChar.name || "?").slice(0,1));
  appHost.innerHTML = `<div class="ml-wrap">
    <header class="ml-top">
      <div class="ml-top-left" data-back>
        <div>
          <div class="ml-top-title">邮箱</div>
          <div class="ml-top-sub">MAIL</div>
        </div>
      </div>
      <button class="ml-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="ml-content">
      <div class="ml-search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></svg>
        <span>搜索邮件</span>
        <div class="ml-avatar" ${av ? `style="background-image:url('${escHtml(av)}')"` : ""}>${initial}</div>
      </div>
      <div class="ml-section">主要</div>
      <div class="ml-list" data-list></div>
    </main>
    <div class="dt" data-detail>
      <header class="dt-top">
        <button class="dt-back" data-dback aria-label="返回"><svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div class="dt-title"></div>
        <div class="dt-right">
          <button class="dt-plain-btn" aria-label="上一封"><svg viewBox="0 0 24 24"><path d="m6.5 14 5.5-5.5L17.5 14"/></svg></button>
          <button class="dt-plain-btn" aria-label="下一封"><svg viewBox="0 0 24 24"><path d="m6.5 10 5.5 5.5L17.5 10"/></svg></button>
        </div>
      </header>
      <div class="dt-scroll">
        <div class="ml-detail-title" data-dtitle></div>
        <div class="ml-detail-sender"><span class="from" data-dsender></span><span class="details">详情</span></div>
        <div class="ml-detail-body" data-dbody></div>
      </div>
      <footer class="ml-detail-bottom">
        <div class="ml-action"><svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M9 7V4h6v3M8 9v9M16 9v9M5 7l1 14h12l1-14" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>删除</span></div>
        <div class="ml-action"><svg viewBox="0 0 24 24" fill="none"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>分享</span></div>
        <div class="ml-action"><svg viewBox="0 0 24 24" fill="none"><path d="M9 8 4 12l5 4M5 12h8.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>回复转发</span></div>
        <div class="ml-action"><svg viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.3" fill="#111"/><circle cx="12" cy="12" r="1.3" fill="#111"/><circle cx="19" cy="12" r="1.3" fill="#111"/></svg><span>更多</span></div>
      </footer>
    </div>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["mail"]);
  appHost.querySelector("[data-dback]").onclick = () => appHost.querySelector("[data-detail]").classList.remove("open");
  const saved = await dataGet(`app_${currentChar.id}_mail`);
  renderMailList(saved?.data || []);
}

function mailIconHTML(type){
  if(type === "gicon") return `<div class="ml-icon ml-icon-gicon">G</div>`;
  if(type === "chat") return `<div class="ml-icon ml-icon-chat"><svg viewBox="0 0 24 24" fill="none"><path d="M5 17.5C3.9 16.1 3.5 14.5 3.5 12.5 3.5 7.8 7.3 4 12 4s8.5 3.8 8.5 8.5S16.7 21 12 21c-1.8 0-3.4-.5-4.8-1.4L4 21l1-3.5Z" stroke="#222" stroke-width="1.7"/></svg></div>`;
  return `<div class="ml-icon ml-icon-person"></div>`;
}
function renderMailList(mails){
  const list = appHost.querySelector("[data-list]");
  list.innerHTML = "";
  if(!mails.length){
    list.innerHTML = `<div class="app-empty">暂无邮件，点右上角刷新生成</div>`;
    return;
  }
  mails.forEach(m => {
    const a = document.createElement("div");
    a.className = "ml-item" + (m.unread ? " unread" : "");
    a.innerHTML = mailIconHTML(m.icon || "person") + `
      <div class="ml-main">
        <div class="ml-top-row"><div class="ml-sender">${escHtml(m.sender)}</div><div class="ml-date">${escHtml(m.date)}</div></div>
        <div class="ml-subject">${escHtml(m.subject)}</div>
        <div class="ml-preview">${escHtml(m.preview)}</div>
      </div>
      <svg class="ml-star" viewBox="0 0 24 24" fill="none"><path d="m12 3 2.75 5.57 6.15.89-4.45 4.34 1.05 6.13L12 17.04l-5.5 2.89 1.05-6.13L3.1 9.46l6.15-.89L12 3Z" stroke="#9aa0a6" stroke-width="1.6"/></svg>`;
    a.onclick = () => openMailDetail(m);
    list.appendChild(a);
  });
}
async function refreshMail(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  if(list) list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genMail(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_mail`, {type:"mail", data});
    renderMailList(data);
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openMailDetail(m){
  const body = Array.isArray(m.body)
    ? m.body
    : String(m.body || "").split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  appHost.querySelector("[data-dtitle]").textContent = m.title || m.subject || "";
  appHost.querySelector("[data-dsender]").textContent = m.sender || "";
  const origs = [], zhs = [];
  body.forEach(p => {
    const bi = phoneSplitBilingual(p);
    origs.push(bi.orig);
    if(bi.zh) zhs.push(bi.zh);
  });
  const box = appHost.querySelector("[data-dbody]");
  box.innerHTML = origs.map(p => `<p>${escHtml(p)}</p>`).join("");
  const unified = String(m.translation || "").trim() || zhs.join("\n");
  if(unified){
    /* 邮件整封统一翻译一次，不再逐段在正文里插「中文：」。 */
    const d = document.createElement("div");
    d.className = "ml-trans-unified";
    d.style.cssText = "margin-top:14px;padding-top:10px;border-top:1px dashed rgba(127,127,127,.4);font-size:13px;line-height:1.6;opacity:.8;white-space:pre-wrap;word-break:break-word;";
    d.textContent = unified;
    box.appendChild(d);
  } else {
    const joined = origs.join("\n").trim();
    if(joined && phoneNeedsTranslation(joined)){
      try{
        if(window.NanoTranslate){
          window.NanoTranslate.toZh(joined).then(tr => {
            tr = String(tr || "").trim();
            if(!tr || !document.body.contains(box)) return;
            const d = document.createElement("div");
            d.className = "ml-trans-unified";
            d.style.cssText = "margin-top:14px;padding-top:10px;border-top:1px dashed rgba(127,127,127,.4);font-size:13px;line-height:1.6;opacity:.8;white-space:pre-wrap;word-break:break-word;";
            d.textContent = tr;
            box.appendChild(d);
          }).catch(function(){});
        }
      }catch(e){}
    }
  }
  appHost.querySelector("[data-detail]").classList.add("open");
}

/* ---------- 备忘录 ---------- */
async function openMemo(){
  appHost.innerHTML = `<div class="mm-wrap">
    <header class="mm-top">
      <div class="mm-top-left" data-back>
        <div>
          <div class="mm-top-title">备忘录</div>
          <div class="mm-top-sub">MEMO</div>
        </div>
      </div>
      <button class="mm-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="mm-content">
      <div class="mm-search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></svg>
        <input id="mmSearch" placeholder="搜索备忘录">
      </div>
      <div class="mm-heading"><h2>备忘录</h2><span data-count>0 条</span></div>
      <div class="mm-chips">
        <button class="mm-chip active" data-filter="all">全部</button>
        <button class="mm-chip" data-filter="pinned">已置顶</button>
        <button class="mm-chip" data-filter="idea">灵感</button>
        <button class="mm-chip" data-filter="diary">日记</button>
      </div>
      <main class="mm-list" data-list></main>
    </main>
    <button class="mm-fab" data-fab>＋</button>
    <div class="mm-editor" data-editor>
      <div class="mm-editor-inner">
        <div class="mm-edit-top">
          <button class="mm-edit-btn" data-cancel>取消</button>
          <button class="mm-edit-btn primary" data-save>完成</button>
        </div>
        <input class="mm-title-input" data-etitle placeholder="标题">
        <div class="mm-meta" data-emeta>新建备忘录</div>
        <textarea class="mm-body-input" data-ebody placeholder="写下此刻想记录的事情……"></textarea>
      </div>
    </div>
  </div>`;

  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["memo"]);

  // 状态
  let saved = await dataGet(`app_${currentChar.id}_memo`);
  // 把 AI 的 groups/items 展平成 notes
  let notes = memoToNotes(saved?.data || []);
  let filter = "all", editingId = null;
  const listEl = appHost.querySelector("[data-list]");
  const countEl = appHost.querySelector("[data-count]");
  const searchEl = appHost.querySelector("#mmSearch");
  const editor = appHost.querySelector("[data-editor]");
  const etitle = appHost.querySelector("[data-etitle]");
  const ebody = appHost.querySelector("[data-ebody]");
  const emeta = appHost.querySelector("[data-emeta]");

  function persistNotes(){ dataSet(`app_${currentChar.id}_memo`, {type:"memo", data: notesToGroups(notes)}); }

  function render(){
    const q = searchEl.value.trim().toLowerCase();
    let arr = notes.filter(n =>
      (filter === "all" || (filter === "pinned" && n.pinned) || n.tag === filter) &&
      (!q || (n.title + n.body).toLowerCase().includes(q))
    );
    arr.sort((a,b) => Number(b.pinned) - Number(a.pinned));
    countEl.textContent = arr.length + " 条";
    listEl.innerHTML = arr.map(n => `
      <article class="mm-note ${n.pinned ? "pinned" : ""}" data-id="${n.id}">
        <div class="mm-note-top"><span class="mm-pin">⌖</span><div class="mm-note-title">${escHtml(n.title || "无标题")}</div></div>
        <div class="mm-note-preview">${escHtml(n.body || "暂无内容")}</div>
        <div class="mm-note-bottom">
          <span>${escHtml(n.time || "")}</span>
          ${n.tag ? `<span class="mm-tag">${n.tag === "idea" ? "灵感" : "日记"}</span>` : ""}
        </div>
      </article>`).join("");
    listEl.querySelectorAll(".mm-note").forEach(el => {
      el.onclick = () => openEditor(Number(el.dataset.id));
    });
  }

  function openEditor(id){
    editingId = id || null;
    if(id){
      const n = notes.find(x => x.id === id);
      etitle.value = n.title; ebody.value = n.body;
      emeta.textContent = "最后编辑 · " + (n.time || "");
    } else {
      etitle.value = ""; ebody.value = ""; emeta.textContent = "新建备忘录";
    }
    editor.classList.add("open");
    setTimeout(() => etitle.focus(), 350);
  }
  function closeEditor(){ editor.classList.remove("open"); }

  appHost.querySelector("[data-fab]").onclick = () => openEditor(null);
  appHost.querySelector("[data-cancel]").onclick = closeEditor;
  appHost.querySelector("[data-save]").onclick = () => {
    const title = etitle.value.trim() || "无标题";
    const body = ebody.value.trim();
    const now = new Date();
    const t = "今天 " + String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");
    if(editingId){
      const n = notes.find(x => x.id === editingId);
      n.title = title; n.body = body; n.time = t;
    } else {
      notes.unshift({id: Date.now(), title, body, time: t, tag: "", pinned: false});
    }
    persistNotes(); closeEditor(); render();
  };

  searchEl.oninput = render;
  appHost.querySelectorAll(".mm-chip").forEach(chip => {
    chip.onclick = () => {
      filter = chip.dataset.filter;
      appHost.querySelectorAll(".mm-chip").forEach(c => c.classList.toggle("active", c === chip));
      render();
    };
  });

  render();
}

/* memo 数据结构转换：AI groups → 扁平 notes */
function memoToNotes(groups){
  const out = [];
  let id = 1;
  (groups || []).forEach(g => {
    (g.items || []).forEach(it => {
      out.push({
        id: id++,
        title: it.title || "无标题",
        body: it.content || "",
        time: it.meta || g.group || "",
        tag: "",
        pinned: false
      });
    });
  });
  if(!out.length){
    out.push({id:1,title:"还没有备忘录",body:"点右下角 + 新建一条。",time:"",tag:"",pinned:false});
  }
  return out;
}
/* 扁平 notes → 回写 groups（保持后端兼容） */
function notesToGroups(notes){
  if(!notes.length) return [];
  return [{group:"全部备忘录", items: notes.map(n => ({title:n.title, meta:n.time, content:n.body}))}];
}

async function refreshMemo(){
  const api = await getApiInfo();
  if(!api) return;
  const listEl = appHost.querySelector("[data-list]");
  if(listEl) listEl.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genMemo(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_memo`, {type:"memo", data});
    openMemo();
  }catch(e){
    if(listEl) listEl.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
/* ---------- 健康 ---------- */
async function openHealth(){
  const av = currentChar.avatar || "";
  appHost.innerHTML = `<div class="hl-wrap">
    <header class="hl-top">
      <div class="hl-top-left" data-back>
        <div>
          <div class="hl-top-title">健康</div>
          <div class="hl-top-sub">CHARACTER WELLNESS</div>
        </div>
      </div>
      <button class="hl-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="hl-content" data-home></main>
    <div class="dt" data-detail>
      <header class="dt-top">
        <button class="dt-back" data-dback aria-label="返回"><svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div class="dt-title" data-dtitle>步数</div>
        <div class="dt-right"></div>
      </header>
      <div class="dt-scroll">
        <div class="hl-detail-main">
          <div class="hl-detail-kicker" data-dkicker></div>
          <div class="hl-detail-number" data-dnumber></div>
          <div class="hl-detail-sub" data-dsub></div>
          <div class="hl-tabs">
            <button class="hl-tab active" data-period="day">日</button>
            <button class="hl-tab" data-period="week">周</button>
            <button class="hl-tab" data-period="month">月</button>
            <button class="hl-tab" data-period="year">年</button>
          </div>
          <div class="hl-chart-wrap">
            <svg class="hl-chart-svg" viewBox="0 0 400 215" preserveAspectRatio="none">
              <g stroke="#eef0f2" stroke-width="1">
                <line x1="0" y1="35" x2="400" y2="35"/><line x1="0" y1="88" x2="400" y2="88"/>
                <line x1="0" y1="141" x2="400" y2="141"/><line x1="0" y1="194" x2="400" y2="194"/>
              </g>
              <path id="hlArea" d="" fill="#f1f2f4"></path>
              <path id="hlLine" d="" fill="none" stroke="#17181b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
              <g id="hlPoints"></g>
            </svg>
          </div>
          <div class="hl-axis" data-daxis></div>
          <div class="hl-summary">
            <div class="hl-summary-label">趋势评分 · <span data-dperiod>今日</span></div>
            <div class="hl-summary-text" data-dsummary></div>
            <div class="hl-trend-score"><span>状态评价</span><b data-dscore></b></div>
          </div>
          <div class="hl-detail-stats" data-dstats></div>
        </div>
      </div>
    </div>
  </div>`;

  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["health"]);
  appHost.querySelector("[data-dback]").onclick = () => appHost.querySelector("[data-detail]").classList.remove("open");

  const saved = await dataGet(`app_${currentChar.id}_health`);
  renderHealthHome(saved?.data || null);
}

function renderHealthHome(h){
  const home = appHost.querySelector("[data-home]");
  if(!h){
    home.innerHTML = `<div class="app-empty">暂无健康数据，点右上角刷新生成</div>`;
    return;
  }
  const steps = h.steps?.total || 0;
  const goal = h.steps?.goal || 10000;
  const pct = Math.min(100, Math.round(steps / goal * 100));
  const dist = h.distance?.total || "0.00";
  const kcal = h.distance?.kcal || 0;
  const sleep = h.sleep?.score ?? "—";
  const sc = h.screen || {};
  const hours = Array.isArray(h.steps?.hours) ? h.steps.hours.slice(0, 12) : [];
  const sleepW = Array.isArray(h.sleep?.weekly) ? h.sleep.weekly : [];
  const runW = Array.isArray(h.screen?.weekly) ? h.screen.weekly : [];
  const maxSteps = Math.max(1, ...hours);

  home.innerHTML = `
    <section class="hl-hero">
      <div class="hl-hero-top">
        <div>
          <div class="hl-hero-label">今日活动量</div>
          <div class="hl-hero-num">${steps.toLocaleString()} <span>步</span></div>
        </div>
        <div class="hl-ring" style="background:conic-gradient(#fff 0 ${pct}%,#444 ${pct}% 100%)"><b>${pct}%</b></div>
      </div>
      <div class="hl-hero-bottom">
        <div class="hl-hero-stat"><strong>${escHtml(String(dist))} km</strong>移动距离</div>
        <div class="hl-hero-stat"><strong>${kcal} kcal</strong>活动消耗</div>
        <div class="hl-hero-stat"><strong>${sleep}</strong>睡眠评分</div>
      </div>
    </section>

    <div class="hl-grid">
      <article class="hl-card" data-k="steps">
        <div class="hl-card-head"><div class="hl-card-title">步数</div><div class="hl-chev">›</div></div>
        <div class="hl-card-value">${steps.toLocaleString()} <small>步</small></div>
        <div class="hl-mini-label">目标 ${goal.toLocaleString()}</div>
        <div class="hl-mini-chart">${hours.map(v => `<i class="hl-bar hot" style="height:${Math.round(v/maxSteps*100)}%"></i>`).join("")}</div>
        <span class="hl-pill good">今日状态良好</span>
      </article>

      <article class="hl-card hl-run" data-k="walk">
        <div class="hl-card-head"><div class="hl-card-title">步行 + 跑步</div><div class="hl-chev">›</div></div>
        <div class="hl-card-value">${escHtml(String(dist))} <small>km</small></div>
        <div class="hl-mini-label">活动消耗 ${kcal} kcal</div>
        <div class="hl-mini-chart">${runW.map(v => `<i class="hl-bar hot" style="height:${Math.max(6,Math.min(100,v))}%"></i>`).join("")}</div>
        <span class="hl-pill">本周趋势</span>
      </article>

      <article class="hl-card hl-sleep" data-k="sleep">
        <div class="hl-card-head"><div class="hl-card-title">睡眠</div><div class="hl-chev">›</div></div>
        <div class="hl-card-value">${escHtml(h.sleep?.duration || "—")}</div>
        <div class="hl-mini-label">睡眠评分 ${sleep} / 100</div>
        <div class="hl-mini-chart">${sleepW.map(v => `<i class="hl-bar hot" style="height:${Math.max(6,Math.min(100,v))}%"></i>`).join("")}</div>
        <span class="hl-pill good">恢复状态很好</span>
      </article>

      <article class="hl-card hl-screen" data-k="screen">
        <div class="hl-card-head"><div class="hl-card-title">屏幕使用</div><div class="hl-chev">›</div></div>
        <div class="hl-card-value">${sc.hours || 0}h ${sc.minutes || 0}m</div>
        <div class="hl-mini-label">今日使用时长</div>
        <div class="hl-mini-chart">${runW.map(v => `<i class="hl-bar hot" style="height:${Math.max(6,Math.min(100,v))}%"></i>`).join("")}</div>
        <span class="hl-pill">今日控制得不错</span>
      </article>
    </div>

    <div class="hl-section-title">今日总结</div>
    <div class="hl-insight">
      <div class="hl-insight-dot">✦</div>
      <p>活动量与睡眠都处在不错的水平，今天的整体状态很稳定。<span>综合健康趋势 · ${sleep} 分</span></p>
    </div>`;

  home.querySelectorAll("[data-k]").forEach(a => {
    a.onclick = () => openHealthDetail(a.dataset.k, h);
  });
}

async function refreshHealth(){
  const api = await getApiInfo();
  if(!api) return;
  const home = appHost.querySelector("[data-home]");
  home.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genHealth(api, currentChar);
    await dataSet(`app_${currentChar.id}_health`, {type:"health", data});
    renderHealthHome(data);
  }catch(e){
    home.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}

function openHealthDetail(k, h){
  const detail = appHost.querySelector("[data-detail]");
  const periodData = healthPeriodData(k, h);
  let period = "day";

  function draw(){
    const d = periodData;
    const p = d.periods[period];
    appHost.querySelector("[data-dtitle]").textContent = d.title;
    appHost.querySelector("[data-dkicker]").textContent = d.kicker;
    appHost.querySelector("[data-dnumber]").innerHTML = d.number;
    appHost.querySelector("[data-dsub]").textContent = p.sub || d.sub || "";
    appHost.querySelector("[data-dperiod]").textContent = {day:"今日",week:"本周",month:"本月",year:"今年"}[period];
    appHost.querySelector("[data-dsummary]").textContent = p.summary;
    appHost.querySelector("[data-dscore]").textContent = p.score;
    appHost.querySelector("[data-daxis]").innerHTML = p.x.map(x => `<span>${x}</span>`).join("");
    appHost.querySelector("[data-dstats]").innerHTML = p.stats.map(s => `<div class="hl-ds"><span>${s[0]}</span><b>${s[1]}</b></div>`).join("");
    const vals = p.v, W = 400, H = 194, pad = 5, max = 100, min = 0;
    const pts = vals.map((v, i) => {
      const x = pad + i * (W - pad * 2) / (vals.length - 1);
      const y = H - 8 - (v - min) / (max - min) * (H - 25);
      return [x, y];
    });
    const path = pts.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
    const area = path + " L " + pts[pts.length-1][0] + " " + H + " L " + pts[0][0] + " " + H + " Z";
    appHost.querySelector("#hlLine").setAttribute("d", path);
    appHost.querySelector("#hlArea").setAttribute("d", area);
    appHost.querySelector("#hlPoints").innerHTML = pts.map((q, i) =>
      i === pts.length - 1 ? `<circle cx="${q[0]}" cy="${q[1]}" r="5" fill="#fff" stroke="#17181b" stroke-width="3"/>` : ""
    ).join("");
  }
  detail.querySelectorAll(".hl-tab").forEach(t => {
    t.onclick = () => {
      period = t.dataset.period;
      detail.querySelectorAll(".hl-tab").forEach(x => x.classList.toggle("active", x === t));
      draw();
    };
  });
  detail.querySelectorAll(".hl-tab").forEach(t => t.classList.toggle("active", t.dataset.period === "day"));
  draw();
  detail.classList.add("open");
}

/* 健康四种卡的周期数据 */
function healthPeriodData(k, h){
  const base = {
    steps:{ title:"步数", kicker:"今日步数", number:(h.steps?.total||0).toLocaleString()+" <span>步</span>", sub:"目标 " + (h.steps?.goal||10000).toLocaleString() },
    walk:{ title:"步行 + 跑步", kicker:"今日移动距离", number:(h.distance?.total||"0.00")+" <span>公里</span>", sub:(h.distance?.kcal||0)+" kcal" },
    sleep:{ title:"睡眠", kicker:"今日睡眠", number:(h.sleep?.duration||"—"), sub:"评分 "+(h.sleep?.score||"—")+" / 100" },
    screen:{ title:"屏幕使用", kicker:"今日屏幕使用", number:(h.screen?.hours||0)+"h "+(h.screen?.minutes||0)+"m", sub:"今日" }
  }[k];

  const hours24 = Array.isArray(h.steps?.hours) && h.steps.hours.length === 24 ? h.steps.hours : Array(12).fill(0);
  const dayV = (arr) => arr.filter((_,i) => i % 2 === 0).slice(0, 12).map(v => Math.min(100, v));
  const maxDay = Math.max(1, ...dayV(hours24));
  const dayNorm = dayV(hours24).map(v => Math.round(v / maxDay * 100));
  const sleepW = Array.isArray(h.sleep?.weekly) ? h.sleep.weekly : [70,80,75,85,82,90,88];
  const screenW = Array.isArray(h.screen?.weekly) ? h.screen.weekly : [80,75,72,68,60,55,50];
  const screenNorm = screenW.map(v => Math.min(100, v));
  const distNorm = sleepW.map(v => Math.min(100, Math.round(v * 0.9)));

  const stat = {
    steps:[["今日","×"],["目标","×"]],
    walk:[["距离","×"],["消耗","×"]],
    sleep:[["时长","×"],["评分","×"]],
    screen:[["时长","×"],["占比","×"]]
  };

  return Object.assign(base, {
    periods:{
      day:{ v: k==="sleep"?sleepW:(k==="screen"?screenNorm:dayNorm), x:["08","10","12","14","16","18","20"], score: k==="sleep"?h.sleep?.score||88:82,
        summary:"数据整体稳定，处于健康区间。",
        stats:[["今日","—"],["目标","—"]] },
      week:{ v: sleepW, x:["一","二","三","四","五","六","日"], score:88, summary:"本周趋势平稳。", stats:[["周均","—"],["较上周","—"]] },
      month:{ v: distNorm, x:["1","5","10","15","20","25","30"], score:86, summary:"本月整体呈上升趋势。", stats:[["月均","—"],["达标","—"]] },
      year:{ v: screenNorm, x:["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"], score:90, summary:"今年保持稳定节奏。", stats:[["年均","—"],["趋势","—"]] }
    }
  });
}

/* ---------- 浏览器 ---------- */
async function openBrowser(){
  appHost.innerHTML = `<div class="bw-wrap">
    <header class="bw-top">
      <div class="bw-top-left" data-back>
        <div>
          <div class="bw-top-title">浏览器</div>
          <div class="bw-top-sub">BROWSER HISTORY</div>
        </div>
      </div>
      <button class="bw-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="bw-content">
      <div class="bw-search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></svg>
        <input data-q placeholder="搜索或输入网址">
        <button class="bw-go" data-go>↑</button>
      </div>
      <div class="bw-tip hidden" data-tip>无痕浏览是单独归档，不会混进搜索记录</div>
      <div class="bw-heading"><h2 data-mode-title>搜索记录</h2><span data-count>0 条</span></div>
      <div class="bw-records" data-list></div>
    </main>
    <nav class="bw-tabbar">
      <button class="bw-tab active" data-mode="normal" type="button">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></svg>
        <span>搜索</span>
      </button>
      <button class="bw-tab" data-mode="incognito" type="button">
        <svg viewBox="0 0 24 24"><path d="M4.5 10.5 6 7.8a2.2 2.2 0 0 1 1.9-1.1h8.2a2.2 2.2 0 0 1 1.9 1.1l1.5 2.7"/><path d="M3.5 12.2c1.7-1.4 3.9-2.2 6.1-2.2 1.3 0 2.1.6 2.4 1.4.3-.8 1.1-1.4 2.4-1.4 2.2 0 4.4.8 6.1 2.2"/><circle cx="8.2" cy="14.2" r="2.6"/><circle cx="15.8" cy="14.2" r="2.6"/></svg>
        <span>无痕浏览</span>
      </button>
    </nav>
    <div class="dt" data-detail>
      <header class="dt-top">
        <button class="dt-back" data-dback aria-label="返回"><svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div class="dt-title">网页详情</div>
        <div class="dt-right">
          <button class="dt-icon-btn" data-drefresh aria-label="刷新">
            <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
          </button>
        </div>
      </header>
      <div class="dt-scroll">
        <div class="bw-detail-bar">
          <svg class="bw-lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          <div class="bw-detail-url" data-durl></div>
        </div>
        <article class="bw-web-card">
          <div class="bw-web-head">
            <div class="bw-web-site" data-dsite></div>
            <div class="bw-web-title" data-dtitle></div>
          </div>
          <div class="bw-visit"><span>访问时间</span><strong data-dtime></strong></div>
          <div class="bw-web-content" data-dcontent></div>
        </article>
        <div class="bw-info">
          <div class="bw-info-row"><span>搜索关键词</span><span data-dkw></span></div>
          <div class="bw-info-row"><span>网页地址</span><span data-dfull></span></div>
          <div class="bw-info-row"><span>访问次数</span><span data-dvisits></span></div>
        </div>
      </div>
    </div>
  </div>`;

  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["browser"]);
  const detail = appHost.querySelector("[data-detail]");
  appHost.querySelector("[data-dback]").onclick = () => detail.classList.remove("open");
  appHost.querySelector("[data-drefresh]").onclick = () => {
    const c = appHost._bwCurrent; if(!c) return;
    c.visits = (c.visits || 0) + 1;
    appHost.querySelector("[data-dvisits]").textContent = c.visits + " 次";
  };

  const saved = await dataGet(`app_${currentChar.id}_browser`);
  const model = normalizeBrowserData(saved?.data);
  const setMode = mode => {
    appHost._bwMode = mode;
    appHost.querySelectorAll(".bw-tab").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    appHost.querySelector("[data-mode-title]").textContent = mode === "incognito" ? "无痕浏览" : "搜索记录";
    appHost.querySelector("[data-tip]").classList.toggle("hidden", mode !== "incognito");
    renderBrowserList(model, mode);
  };
  appHost.querySelectorAll(".bw-tab").forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
  setMode(appHost._bwMode === "incognito" ? "incognito" : "normal");
}
function renderBrowserList(model, mode){
  const items = mode === "incognito" ? model.incognito : model.normal;
  const list = appHost.querySelector("[data-list]");
  const count = appHost.querySelector("[data-count]");
  count.textContent = items.length + " 条";
  list.classList.toggle("incognito", mode === "incognito");
  list.innerHTML = "";
  if(!items.length){
    list.innerHTML = `<div class="app-empty">${mode === "incognito" ? "没有无痕浏览记录，点右上角刷新生成" : "暂无搜索记录，点右上角刷新生成"}</div>`;
    return;
  }
  items.forEach(it => {
    const row = document.createElement("div");
    row.className = "bw-record";
    row.innerHTML = `
      <div class="bw-site-icon">${escHtml(String(it.site || "WEB").slice(0,1))}</div>
      <div class="bw-record-main">
        <div class="bw-keyword">${escHtml(it.keyword || it.query || "")}</div>
        <div class="bw-url">${escHtml(it.url || "")}</div>
      </div>
      <div class="bw-record-side">
        <div>${escHtml(it.time || "")}</div>
        <div>访问 ${it.visits || 1} 次</div>
      </div>
      <div class="bw-arrow">›</div>`;
    row.onclick = () => openBrowserDetail(it);
    list.appendChild(row);
  });
}
async function refreshBrowser(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  if(list) list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const model = await genBrowser(api, currentChar);
    try { await ensurePhoneInlineTranslations(model); } catch (e) {}
    await dataSet(`app_${currentChar.id}_browser`, {type:"browser", data:model});
    renderBrowserList(model, appHost._bwMode || "normal");
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openBrowserDetail(it){
  appHost._bwCurrent = it;
  appHost.querySelector("[data-durl]").textContent = it.url || "";
  appHost.querySelector("[data-dsite]").textContent = it.site || "WEB";
  appHost.querySelector("[data-dtitle]").textContent = it.title || it.keyword || "";
  appHost.querySelector("[data-dtime]").textContent = it.time || "";
  appHost.querySelector("[data-dkw]").textContent = it.keyword || it.query || "";
  appHost.querySelector("[data-dfull]").textContent = it.url || "";
  appHost.querySelector("[data-dvisits]").textContent = (it.visits || 1) + " 次";
  const points = Array.isArray(it.points) ? it.points : [];
  const sections = Array.isArray(it.sections) ? it.sections.filter(s => s && (s.heading || s.text)) : [];
  const comments = Array.isArray(it.comments) ? it.comments.filter(c => c && (c.user || c.text)) : [];
  const related = Array.isArray(it.related) ? it.related.filter(r => r && (r.title || r.site)) : [];
  appHost.querySelector("[data-dcontent]").innerHTML = `
    <h4>页面内容</h4>
    <p class="bw-intro">${escHtml(it.intro || "")}</p>
    ${sections.map(s => `<div class="bw-section">
      ${s.heading ? `<div class="bw-section-title">${escHtml(s.heading)}</div>` : ""}
      ${s.text ? `<div class="bw-section-text">${escHtml(s.text)}</div>` : ""}
      ${Array.isArray(s.list) && s.list.length ? `<ul class="bw-section-list">${s.list.map(x => `<li>${escHtml(x)}</li>`).join("")}</ul>` : ""}
    </div>`).join("")}
    ${it.quote ? `<div class="quote">${escHtml(it.quote)}</div>` : ""}
    ${points.length ? `<p>页面摘要：</p><ul>${points.map(x => `<li>${escHtml(x)}</li>`).join("")}</ul>` : ""}
    ${related.length ? `<div class="bw-related-title">相关推荐</div><div class="bw-related">${related.map(r => `<div class="bw-related-item"><div class="bw-related-name">${escHtml(r.title || "")}</div><div class="bw-related-site">${escHtml(r.site || "")}${r.url ? " · " + escHtml(r.url) : ""}</div></div>`).join("")}</div>` : ""}
    ${comments.length ? `<div class="bw-comments-title">网页评论</div><div class="bw-comments">${comments.map(c => `<div class="bw-comment"><span class="bw-comment-user">${escHtml(c.user || "网友")}</span><span class="bw-comment-text">${escHtml(c.text || "")}</span></div>`).join("")}</div>` : ""}`;
  appHost.querySelector("[data-detail]").classList.add("open");
}

/* ---------- 游戏 ---------- */
const GAME_COLORS = ["#5d5be9","#f15a24","#2779e9","#e91e63","#2a8a4a","#8b57dd","#f4a623"];

async function openGame(){
  const av = currentChar.avatar || "";
  appHost.innerHTML = `<div class="gm-wrap">
    <header class="gm-top">
      <div class="gm-top-left" data-back>
        <div>
          <div class="gm-top-title">游戏</div>
          <div class="gm-top-sub">PRIVATE GAME RECORD</div>
        </div>
      </div>
      <button class="gm-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:#333;fill:none;stroke-width:1.6">
          <path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/>
          <path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/>
        </svg>
      </button>
    </header>
    <main class="gm-content">
      <section class="gm-player">
        <div class="gm-player-head">
          <div class="gm-avatar" ${av ? `style="background-image:url('${escHtml(av)}')"` : ""}>${av ? "" : escHtml(String(currentChar.name || "?").slice(0,1))}</div>
          <div class="gm-player-info">
            <div class="gm-name">${escHtml(currentChar.name || "Character")}</div>
            <div class="gm-state">PLAYER PROFILE</div>
          </div>
        </div>
        <div class="gm-game-label">GAME FILE / 001</div>
        <div class="gm-game-status">PRIVATE</div>
      </section>
      <div class="gm-selector">
        <div class="gm-selector-title">他的游戏记录</div>
        <div class="gm-switch" data-count>0 GAME</div>
      </div>
      <div data-list></div>
      <div class="gm-footer">END OF PRIVATE RECORD</div>
    </main>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["game"]);
  const saved = await dataGet(`app_${currentChar.id}_game`);
  renderGameList(saved?.data || []);
}

function renderGameList(games){
  appHost.querySelector("[data-count]").textContent = games.length + " GAME" + (games.length > 1 ? "S" : "");
  const list = appHost.querySelector("[data-list]");
  list.innerHTML = "";
  if(!games.length){
    list.innerHTML = `<div class="app-empty">暂无游戏数据，点右上角刷新生成</div>`;
    return;
  }
  games.forEach(g => {
    const card = document.createElement("section");
    card.className = "gm-card";
    const recent = Array.isArray(g.recent) ? g.recent : [];
    const weekly = Array.isArray(g.weekly) && g.weekly.length === 7 ? g.weekly : [35,55,43,75,100,67,46];
    card.innerHTML = `
      <div class="gm-head">
        <div class="gm-logo">${escHtml(String(g.name || "?").slice(0,2).toUpperCase())}</div>
        <div class="gm-info">
          <div class="gm-gname">${escHtml(g.name || "")}</div>
          <div class="gm-gid">ID · ${escHtml(g.id || "")}</div>
        </div>
        <div class="gm-online"></div>
      </div>
      <div class="gm-stats">
        <div class="gm-stat"><div class="gm-stat-label">WIN RATE</div><div class="gm-stat-value">${g.winRate || 0}<span class="gm-stat-small">%</span></div></div>
        <div class="gm-stat"><div class="gm-stat-label">MATCHES</div><div class="gm-stat-value">${g.matches || 0}</div></div>
        <div class="gm-stat"><div class="gm-stat-label">WINS</div><div class="gm-stat-value">${g.wins || 0}</div></div>
        <div class="gm-stat"><div class="gm-stat-label">LOSSES</div><div class="gm-stat-value">${g.losses || 0}</div></div>
      </div>
      <div class="gm-rank">
        <div class="gm-rank-left">
          <div class="gm-rank-label">CURRENT RANK</div>
          <div class="gm-rank-name">${escHtml(g.rank || "")}</div>
          <div class="gm-rank-score">${g.rating ? g.rating.toLocaleString() + " RATING" : ""}</div>
        </div>
        <div class="gm-rank-mark">${escHtml(g.rankMark || "")}</div>
      </div>
      ${recent.length ? `
        <div class="gm-section">最近战绩</div>
        <div class="gm-recent">
          ${recent.slice(0,4).map(m => `
            <div class="gm-match">
              <div class="gm-result ${m.result === "W" ? "win" : ""}">${escHtml(m.result || "")}</div>
              <div class="gm-match-main">
                <div class="gm-match-mode">${escHtml(m.mode || "")}</div>
                <div class="gm-match-time">${escHtml(m.time || "")}</div>
              </div>
              <div class="gm-match-kda">${escHtml(m.kda || "")}</div>
              <div class="gm-match-arrow">›</div>
            </div>`).join("")}
        </div>` : ""}
      <div class="gm-behavior">
        <div class="gm-behavior-top">
          <div class="gm-behavior-title">隐藏的游戏习惯</div>
          <div class="gm-behavior-lock">PRIVATE DETAIL</div>
        </div>
        <div class="gm-behavior-text">${escHtml(g.habit || "")}</div>
        <div class="gm-mini-bars">
          ${weekly.map(v => `<div class="gm-bar" style="height:${Math.max(6, Math.min(100, v))}%"></div>`).join("")}
        </div>
        <div class="gm-days"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      </div>`;
    list.appendChild(card);
  });
}
async function refreshGame(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genGame(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_game`, {type:"game", data});
    renderGameList(data);
  }catch(e){
    list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}

/* ---------- 私密 ---------- */
async function openPrivate(){
  const av = currentChar.avatar || "";
  appHost.innerHTML = `<div class="pv-wrap">
    <header class="pv-top">
      <div class="pv-top-left" data-back>
        <div>
          <div class="pv-top-title">私密</div>
          <div class="pv-top-sub">PRIVATE ARCHIVE</div>
        </div>
      </div>
      <button class="pv-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <main class="pv-content">
      <section class="pv-character">
        <div class="pv-char-head">
          <div class="pv-avatar" ${av ? `style="background-image:url('${escHtml(av)}')"` : ""}>${av ? "" : escHtml(String(currentChar.name || "?").slice(0,1))}</div>
          <div class="pv-char-info">
            <div class="pv-char-name">${escHtml(currentChar.name || "Character")}</div>
            <div class="pv-char-status">PRIVATE RECORD</div>
          </div>
          <div class="pv-secret-count" data-count>00</div>
        </div>
        <div class="pv-file-number">FILE / 001</div>
        <div class="pv-access-text">RESTRICTED</div>
      </section>
      <div class="pv-section-head">
        <div class="pv-section-title">被藏起来的东西</div>
        <div class="pv-section-count" data-count2>00 RECORDS</div>
      </div>
      <div data-list></div>
      <section class="pv-observe">
        <div class="pv-observe-line"></div>
        <div class="pv-observe-title">你正在窥探他的私人档案</div>
        <div class="pv-observe-desc">有些事情从未被主动说起。<br>但它们一直被藏在这里。</div>
      </section>
      <div class="pv-bottom-space"></div>
    </main>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["private"]);
  const saved = await dataGet(`app_${currentChar.id}_private`);
  renderPrivateList(appHost.querySelector("[data-list]"), saved?.data || []);
}

function renderPrivateList(list, secrets){
  const pad = n => String(n).padStart(2,"0");
  appHost.querySelector("[data-count]").textContent = pad(secrets.length);
  appHost.querySelector("[data-count2]").textContent = pad(secrets.length) + " RECORDS";
  list.innerHTML = "";
  if(!secrets.length){
    list.innerHTML = `<div class="app-empty">暂无秘密，点右上角刷新生成</div>`;
    return;
  }
  secrets.forEach((s, i) => {
    const card = document.createElement("article");
    card.className = "pv-secret";
    const tags = Array.isArray(s.tags) ? s.tags : [];
    card.innerHTML = `
      <div class="pv-secret-main">
        <div class="pv-secret-top">
          <div class="pv-secret-type">${escHtml(s.type || ("PRIVATE / " + pad(i+1)))}</div>
          <div class="pv-secret-time">${escHtml(s.time || "")}</div>
        </div>
        <div class="pv-secret-title">${escHtml(s.title || "")}</div>
        <div class="pv-secret-content" data-peek>
          <div class="pv-secret-blur">${escHtml(s.preview || "")}</div>
        </div>
        ${tags.length ? `<div class="pv-tags">${tags.map(t => `<span class="pv-tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
        <div class="pv-hidden-info">
          <div class="pv-hidden-label">DISCOVERED DETAIL</div>
          <div class="pv-hidden-value">${escHtml(s.detail || "")}</div>
        </div>
      </div>
      <div class="pv-peek" data-peek-btn>点击窥探</div>`;
    const toggle = () => {
      card.classList.toggle("revealed");
      card.querySelector("[data-peek-btn]").textContent =
        card.classList.contains("revealed") ? "收起秘密" : "点击窥探";
    };
    card.querySelector("[data-peek]").onclick = toggle;
    card.querySelector("[data-peek-btn]").onclick = toggle;
    list.appendChild(card);
  });
}
async function refreshPrivate(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genPrivate(api, currentChar);
    try { await ensurePhoneInlineTranslations(data); } catch (e) {}
    await dataSet(`app_${currentChar.id}_private`, {type:"private", data});
    renderPrivateList(list, data);
  }catch(e){
    list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}

/* ---------- 聊天（与 chat_inner 同步的 user 会话 + AI 生成的其它会话） ---------- */
const USER_CONV_ID = "__user__";
let chatUserRemark = "";      /* char 给 user 的备注（可自行修改） */
let currentConv = null;       /* 当前打开的会话 */

function userNickname(){
  if(chatUserRemark) return chatUserRemark;
  const u = readUserProfile();
  return (u && (u.name || u.nickname)) || "你";
}
let chatUserAvatar = "";
function userAvatar(){
  const u = readUserProfile();
  return chatUserAvatar || (u && (u.avatar || u.avatarUrl)) || "";
}
/* 用户头像可能存在独立的 MaskAvatarDB */
async function loadUserAvatar(){
  const u = readUserProfile();
  if(!u) return "";
  if(u.avatar) return u.avatar;
  const db = await idbOpen("MaskAvatarDB", 1, e => {
    try{
      const d = e.target.result;
      if(!d.objectStoreNames.contains("avatars")) d.createObjectStore("avatars", { keyPath:"id" });
    }catch(e2){}
  });
  const rec = await idbGet(db, "avatars", u.id);
  return (rec && rec.data) || "";
}

/* 底层：打开 IndexedDB 并读取一条记录 */
function idbOpen(name, version, onUpgrade){
  return new Promise(resolve => {
    try{
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      if(onUpgrade) req.onupgradeneeded = onUpgrade;
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => resolve(null);
    }catch(e){ resolve(null); }
  });
}
function idbGet(db, store, key){
  return new Promise(resolve => {
    if(!db) return resolve(null);
    try{
      const tx = db.transaction(store, "readonly");
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      tx.oncomplete = () => { try{ db.close(); }catch(e){} };
    }catch(e){ resolve(null); }
  });
}
/* localforage 默认库：DB "localforage" / store "keyvaluepairs"（与 chat_inner 完全一致） */
function openLocalforageDB(){
  return idbOpen("localforage", 1, e => {
    try{
      const d = e.target.result;
      if(!d.objectStoreNames.contains("keyvaluepairs")) d.createObjectStore("keyvaluepairs", { keyPath:"key" });
    }catch(e2){}
  });
}
function asMsgArray(v){
  if(!v) return null;
  if(Array.isArray(v)) return v;
  if(typeof v === "string"){ try{ const a = JSON.parse(v); return Array.isArray(a) ? a : null; }catch(e){ return null; } }
  if(Array.isArray(v.messages)) return v.messages;
  if(v.value !== undefined) return asMsgArray(v.value);
  return null;
}
/* 依次尝试：localforage → nano_vector_memory_db.chat_messages → localStorage */
async function loadRawMessages(chatId){
  const key = "chat_messages_" + chatId;
  const lfdb = await openLocalforageDB();
  const lfRec = await idbGet(lfdb, "keyvaluepairs", key);
  const lfArr = asMsgArray(lfRec && lfRec.value);
  if(lfArr && lfArr.length) return lfArr;

  const memdb = await openMemoryDB();
  const memRec = await idbGet(memdb, "chat_messages", chatId);
  const memArr = asMsgArray(memRec && memRec.messages);
  if(memArr && memArr.length) return memArr;

  try{
    const a = JSON.parse(localStorage.getItem(key) || "[]");
    if(Array.isArray(a) && a.length) return a;
  }catch(e){}
  return [];
}
async function loadUserChatMessages(){
  /* 优先取当前查手机角色的私聊记录，取不到再退回最近一次聊天 */
  const chatId = (currentChar && currentChar.id) || getLastChatId();
  let msgs = [];
  if(chatId) msgs = await loadRawMessages(chatId);
  const last = getLastChatId();
  if(!msgs.length && last && last !== chatId) msgs = await loadRawMessages(last);
  return (Array.isArray(msgs) ? msgs : [])
    .filter(m => m && !m.recalled && (m.text || m.transcript))
    .map(m => ({
      side: m.type === "left" ? "right" : "left",
      text: m.transcript || m.text || "",
      translation: m.translation || "",
      time: m.time || "",
      ts: m.ts || null
    }))
    .slice(-10);
}
function chatTimeLabel(m){
  if(m.ts){
    const d = new Date(m.ts), now = new Date();
    const pad = n => String(n).padStart(2,"0");
    const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if(d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth()+1) + "月" + d.getDate() + "日 " + hm;
  }
  return m.time || "";
}
/* 取 HH:MM 作为居中时间小字；依次回退：消息时间 → 时间戳 → 会话时间 → 当前时间 */
function msgClock(m, conv){
  const p = n => String(n).padStart(2,"0");
  const pick = s => { const t = String(s || "").match(/(\d{1,2}):(\d{2})/); return t ? (p(t[1]) + ":" + t[2]) : ""; };
  const fromMsg = pick(m && m.time);
  if(fromMsg) return fromMsg;
  if(m && m.ts){
    const d = new Date(m.ts);
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }
  const fromConv = pick(conv && conv.time);
  if(fromConv) return fromConv;
  const now = new Date();
  return p(now.getHours()) + ":" + p(now.getMinutes());
}
function userConvPreview(msgs){
  if(!msgs.length) return {text:"还没有和 TA 的聊天记录", time:""};
  const last = msgs[msgs.length - 1];
  const parsed = phoneSplitBilingual(last.transcript || last.text || "");
  const zh = parsed.zh || String(last.translation || "").trim();
  let text = parsed.orig || "";
  if(zh) text += " · " + zh;
  return {text: text, time: last.time || chatTimeLabel(last)};
}


async function openChat(){
  appHost.innerHTML = `<div class="ct-wrap">
    <header class="ct-top">
      <div class="ct-top-left" data-back>
        <div>
          <div class="ct-top-title">聊天</div>
          <div class="ct-top-sub">MESSAGES</div>
        </div>
      </div>
      <button class="ct-top-btn" data-refresh aria-label="刷新">
        <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.2L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.7 4.2L20 15"/><path d="M20 19v-4h-4"/></svg>
      </button>
    </header>
    <div class="ct-search">
      <div class="ct-search-box">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></svg>
        <span>搜索</span>
      </div>
    </div>
    <div class="ct-list" data-list></div>
    <nav class="ct-tabbar">
      <button class="ct-tab active">
        <svg viewBox="0 0 24 24"><path d="M20.4 11.7c0 4.2-3.8 7.6-8.4 7.6-1 0-2-.2-2.9-.5l-4.7 1.6 1.3-3.6a7.2 7.2 0 0 1-2.1-5.1c0-4.2 3.8-7.6 8.4-7.6s8.4 3.4 8.4 7.6Z"/></svg>
        <span>聊天</span>
      </button>
      <button class="ct-tab">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.4"/><path d="M5.4 19.6c0-3.4 2.9-6.1 6.6-6.1s6.6 2.7 6.6 6.1"/></svg>
        <span>通讯录</span>
      </button>
      <button class="ct-tab">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m15.4 8.6-2 4.8-4.8 2 2-4.8z"/></svg>
        <span>发现</span>
      </button>
      <button class="ct-tab">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.4"/><path d="M5.4 19.6c0-3.4 2.9-6.1 6.6-6.1s6.6 2.7 6.6 6.1"/></svg>
        <span>我的</span>
      </button>
    </nav>
    <div class="ct-detail" data-detail>
      <header class="dt-top">
        <button class="dt-back" data-dback aria-label="返回"><svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div class="dt-title" data-dtitle>聊天</div>
        <div class="dt-right">
          <button class="dt-icon-btn" data-dmore aria-label="更多">
            <svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
          </button>
        </div>
      </header>
      <div class="ct-msgs" data-msgs></div>
      <div class="ct-inputbar">
        <button class="ct-input-btn" aria-label="更多">
          <svg viewBox="0 0 24 24"><path d="M12 5.5v13M5.5 12h13"/></svg>
        </button>
        <input class="ct-input-field" placeholder="发送消息…" readonly>
        <button class="ct-input-btn" aria-label="表情">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.3a4.1 4.1 0 0 0 6.8 0"/><circle cx="9.4" cy="9.9" r=".95" fill="currentColor" stroke="none"/><circle cx="14.6" cy="9.9" r=".95" fill="currentColor" stroke="none"/></svg>
        </button>
        <button class="ct-send" aria-label="发送">
          <svg viewBox="0 0 24 24"><path d="M12 19V6M6.6 11.4 12 6l5.4 5.4"/></svg>
        </button>
      </div>
    </div>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["chat"]);
  appHost.querySelector("[data-dback]").onclick = () => appHost.querySelector("[data-detail]").classList.remove("open");
  appHost.querySelector("[data-dmore]").onclick = () => {
    if(currentConv && currentConv.isUser) openRemarkEditor();
  };

  chatUserAvatar = await loadUserAvatar();
  const saved = await dataGet(`app_${currentChar.id}_chat`);
  const model = normalizeChatData(saved?.data);
  const manualRemark = (await dataGet(`app_${currentChar.id}_chat_remark_user`)) || "";
  chatUserRemark = manualRemark || model.userRemark || "";
  const userMsgs = await loadUserChatMessages();
  renderChatList(model.chats, userMsgs);
}
async function reloadChatList(){
  const saved = await dataGet(`app_${currentChar.id}_chat`);
  renderChatList(normalizeChatData(saved?.data).chats, await loadUserChatMessages());
}
/* 给 user 的备注编辑 */
function openRemarkEditor(){
  const sheet = document.getElementById("remarkSheet");
  const input = document.getElementById("remarkInput");
  input.value = chatUserRemark || userNickname();
  sheet.classList.remove("hidden");
  setTimeout(() => { try{ input.focus(); input.select(); }catch(e){} }, 60);
}
document.getElementById("remarkCancel").onclick = () => document.getElementById("remarkSheet").classList.add("hidden");
document.getElementById("remarkSheet").addEventListener("click", e => {
  if(e.target === document.getElementById("remarkSheet")) document.getElementById("remarkSheet").classList.add("hidden");
});
document.getElementById("remarkSave").onclick = async () => {
  const v = document.getElementById("remarkInput").value.trim();
  chatUserRemark = v;
  try{ await dataSet(`app_${currentChar.id}_chat_remark_user`, v); }catch(e){}
  document.getElementById("remarkSheet").classList.add("hidden");
  if(currentConv && currentConv.isUser){
    currentConv.name = v;
    const t = appHost.querySelector("[data-dtitle]");
    if(t) t.textContent = v;
  }
  await reloadChatList();
};
function renderChatList(chats, userMsgs){
  const list = appHost.querySelector("[data-list]");
  list.innerHTML = "";

  /* 固定置顶：与 user 的聊天（与 chat_inner 实时同步，不生成） */
  const nick = userNickname();
  const uPrev = userConvPreview(userMsgs || []);
  const uAv = userAvatar();
  const uRow = document.createElement("div");
  uRow.className = "ct-item";
  uRow.innerHTML = `
    <div class="ct-avatar user" ${uAv ? `style="background-image:url('${escHtml(String(uAv).replace(/'/g, "%27"))}')"` : ""}>${uAv ? "" : escHtml(String(nick).slice(0,1))}</div>
    <div class="ct-main">
      <div class="ct-name">${escHtml(nick)}</div>
      <div class="ct-last">${escHtml(uPrev.text)}</div>
    </div>
    <div class="ct-side">
      <div class="ct-time">${escHtml(uPrev.time)}</div>
      <button class="ct-remark-btn" data-remark type="button">改备注</button>
    </div>`;
  const uConv = {id: USER_CONV_ID, name: nick, avatar: uAv, messages: userMsgs || [], isUser: true};
  uRow.onclick = () => openChatDetail(uConv);
  const remarkBtn = uRow.querySelector("[data-remark]");
  if(remarkBtn) remarkBtn.onclick = e => { e.stopPropagation(); openRemarkEditor(); };
  list.appendChild(uRow);

  (chats || []).forEach(c => {
    const row = document.createElement("div");
    row.className = "ct-item";
    const isGroup = !!c.group;
    const members = Array.isArray(c.members) ? c.members.map(n => String((n && n.name) || n || "").trim()).filter(Boolean) : [];
    const avHtml = isGroup
      ? (members.length
          ? `<div class="ct-avatar group">${members.slice(0,4).map(n => `<span>${escHtml(n.slice(0,1))}</span>`).join("")}</div>`
          : `<div class="ct-avatar">群</div>`)
      : `<div class="ct-avatar">${escHtml(String(c.name || "?").slice(0,1))}</div>`;
    const __bi = phoneSplitBilingual(c.lastMsg || "");
    const __last = __bi.orig + (__bi.zh ? (" · " + __bi.zh) : "");
    row.innerHTML = `
      ${avHtml}
      <div class="ct-main">
        <div class="ct-name">${escHtml(c.name || "")}${isGroup ? `<span class="ct-group-tag">群${members.length ? " · " + members.length + "人" : ""}</span>` : ""}</div>
        <div class="ct-last">${escHtml(phoneText(__last))}</div>
      </div>
      <div class="ct-side">
        <div class="ct-time">${escHtml(c.time || "")}</div>
        ${c.unread > 0 ? `<div class="ct-badge">${c.unread > 99 ? "99+" : c.unread}</div>` : `<div class="ct-badge placeholder"></div>`}
      </div>`;
    row.onclick = () => openChatDetail(c);
    list.appendChild(row);
  });

  if(!(chats || []).length && !(userMsgs || []).length){
    list.innerHTML += `<div class="app-empty">暂无其它会话，点右上角刷新生成</div>`;
  }
}
async function refreshChat(){
  const api = await getApiInfo();
  if(!api) return;
  const list = appHost.querySelector("[data-list]");
  if(list) list.innerHTML = `<div class="app-empty">正在生成…</div>`;
  try{
    const data = await genChat(api, currentChar);
    const model = normalizeChatData(data);
    try { await ensurePhoneInlineTranslations(model); } catch (e) {}
    await dataSet(`app_${currentChar.id}_chat`, {type:"chat", data: model});
    const manual = (await dataGet(`app_${currentChar.id}_chat_remark_user`)) || "";
    chatUserRemark = manual || model.userRemark || "";
    renderChatList(model.chats, await loadUserChatMessages());
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
/* ---------- 查手机聊天：外文自动补中文译文 ---------- */
const __phoneTransCache = Object.create(null);
function phoneNeedsTranslation(text){
  const s = String(text || "").trim();
  if(!s) return false;
  // 已经带了中文翻译就不再重复翻
  if(/（中文[:：]|\(中文[:：]/.test(s)) return false;
  // 韩/日/俄/阿/泰/印地等非拉丁文字：一律翻
  if(/[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f\u0900-\u097f]/.test(s)) return true;
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (s.match(/[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]/g) || []).length;
  // 中文为主、只夹了几个英文单词：不翻
  if(cjk >= 2 && latin <= cjk * 2) return false;
  return latin >= 3;
}
/* 生成后统一补齐翻译：把「原文||译文」转成同一字段里的「原文（中文：译文）」，
   再对仍然只有外文的可见字段调用免费翻译，确保列表/正文/详情一起显示译文。 */
const PHONE_TRANS_SKIP_KEY = /^(url|href|id|img|image|imageUrl|src|photo|cover|thumb|background|bg|avatar|avatarUrl|icon|ts|time|date|type|price|amount|spec|status|level|unread|visits|result|mode|kda|side|role|winRate|matches|wins|losses|rating|rankMark|duration|progress|balance|kcal|steps|goal|total|deep|score|weekly|hours|matches|value|count|limit|private|collected|unreadCount|translation|translationZh|zh|sender|up|user|shop|restaurant|place|people|members|member|name|subject)$/i;
function phoneInlineBars(s){
  const t = String(s == null ? "" : s);
  const i = t.indexOf("||");
  if(i < 0) return t;
  const orig = t.slice(0, i).trim();
  const tr = t.slice(i + 2).trim();
  if(!orig) return t;
  if(!tr) return orig;
  return orig + "（中文：" + tr + "）";
}
/* 把「原文（中文：译文）」或「原文||译文」拆成原文 / 译文两段。
   私聊、豆包、邮件用它把外语和中文分开显示（中间一条虚线），不再带「中文：」标签。 */
function phoneSplitBilingual(s){
  let t = String(s == null ? "" : s).trim();
  if(!t) return { orig:"", zh:"" };
  const bar = t.indexOf("||");
  if(bar >= 0){
    const o = t.slice(0, bar).trim(), z = t.slice(bar + 2).trim();
    if(o && z) return { orig:o, zh:z };
  }
  const m = t.match(/^([\s\S]*?)[（(]\s*中文\s*[:：]\s*([\s\S]*?)\s*[)）]\s*$/);
  if(m) return { orig:String(m[1] || "").trim(), zh:String(m[2] || "").trim() };
  return { orig:t, zh:"" };
}
function phoneTransDiv(text){
  const d = document.createElement("div");
  d.className = "ct-msg-trans";
  d.style.cssText = "margin-top:6px;padding-top:5px;border-top:1px dashed rgba(127,127,127,.38);font-size:12px;line-height:1.45;opacity:.78;white-space:pre-wrap;word-break:break-word;";
  d.textContent = String(text || "").trim();
  return d;
}
function phoneWalkStrings(node, fn, depth){
  if(depth > 8 || node == null) return;
  if(Array.isArray(node)){
    node.forEach((v, i) => phoneWalkStrings(v, fn, depth + 1));
    return;
  }
  if(typeof node !== "object") return;
  Object.keys(node).forEach(k => {
    const v = node[k];
    if(typeof v === "string") fn(node, k, v);
    else if(v && typeof v === "object") phoneWalkStrings(v, fn, depth + 1);
  });
}
function phoneDataNeedsTranslation(data){
  let need = false;
  phoneWalkStrings(data, (obj, key, val) => {
    if(need || PHONE_TRANS_SKIP_KEY.test(key)) return;
    const trimmed = String(val || "").trim();
    if(/^(data:|blob:|https?:\/\/|\/\/|\.\.?\/)/i.test(trimmed)) return;
    if(phoneNeedsTranslation(phoneInlineBars(val))) need = true;
  });
  return need;
}
async function ensurePhoneInlineTranslations(data, opts){
  if(!data || typeof data !== "object" || !window.NanoTranslate) return data;
  const maxMs = (opts && Number(opts.maxMs)) || 30000;
  const deadline = Date.now() + maxMs;
  const jobs = [];
  phoneWalkStrings(data, (obj, key, val) => {
    if(PHONE_TRANS_SKIP_KEY.test(key)) return;
    // 聊天/豆包已经单独给了 translation 字段：不要再把译文混进原文。
    if((key === "text" || key === "content") && obj && String(obj.translation || "").trim()) return;
    // 邮件的正文统一翻译：标题/收件人不再逐字加译文，正文由邮件详情底部统一展示。
    if(key === "title" && obj && Array.isArray(obj.body)) return;
    const trimmed = String(val || "").trim();
    if(/^(data:|blob:|https?:\/\/|\/\/|\.\.?\/)/i.test(trimmed)) return;
    const fixed = phoneInlineBars(val);
    if(fixed !== val) obj[key] = fixed;
    if(!phoneNeedsTranslation(fixed)) return;
    jobs.push({ obj, key, text: fixed });
  });
  if(!jobs.length) return data;
  const cache = Object.create(null);
  let cursor = 0;
  const worker = async () => {
    while(cursor < jobs.length && Date.now() < deadline){
      const job = jobs[cursor++];
      const key = String(job.text);
      let tr = cache[key];
      if(tr === undefined){
        try {
          tr = await Promise.race([
            window.NanoTranslate.toZh(key),
            new Promise(resolve => setTimeout(() => resolve(""), 6000))
          ]);
        } catch(e) { tr = ""; }
        tr = String(tr || "").trim();
        cache[key] = tr;
      }
      if(tr && tr !== job.text && !/（中文[:：]/.test(job.text)){
        job.obj[job.key] = job.text + "（中文：" + tr + "）";
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return data;
}
function phoneApplyTranslation(el, text){
  if(!el || !phoneNeedsTranslation(text) || !window.NanoTranslate) return;
  const key = String(text);
  const done = function(tr){
    tr = String(tr || '').trim();
    if(!tr || !document.body.contains(el) || el.querySelector(".ct-msg-trans")) return;
    el.appendChild(phoneTransDiv(tr));
  };
  if(__phoneTransCache[key]){ done(__phoneTransCache[key]); return; }
  try{
    window.NanoTranslate.toZh(key).then(function(tr){
      tr = String(tr || "").trim();
      if(tr){ __phoneTransCache[key] = tr; done(tr); }
    }).catch(function(){});
  }catch(e){}
}
function openChatDetail(c){
  const isUser = !!c.isUser;
  const isGroup = !!c.group;
  currentConv = c;
  appHost.querySelector("[data-dtitle]").textContent = c.name || "";
  const more = appHost.querySelector("[data-dmore]");
  if(more){
    more.style.display = isUser ? "" : "none";
    more.setAttribute("aria-label", isUser ? "修改备注" : "更多");
  }
  const box = appHost.querySelector("[data-msgs]");
  const charAv = (currentChar && currentChar.avatar) || "";
  const charInit = escHtml(String((currentChar && currentChar.name) || "?").slice(0,1));
  const msgs = c.messages || [];
  box.innerHTML = "";
  if(!msgs.length){
    box.innerHTML = `<div class="app-empty">${isUser ? "还没有和 TA 的聊天记录" : "暂无聊天内容"}</div>`;
  }else{
    let lastTs = 0;
    msgs.forEach((m, i) => {
      const label = msgClock(m, c);
      const gap = m.ts && lastTs ? (m.ts - lastTs) > 5 * 60 * 1000 : false;
      if(label && (i === 0 || gap)){
        const div = document.createElement("div");
        div.className = "ct-time-div";
        div.textContent = label;
        box.appendChild(div);
      }
      if(m.ts) lastTs = m.ts;
      const isRight = m.side === "right";
      const wrap = document.createElement("div");
      wrap.className = "ct-msg" + (isRight ? " right" : "") + (isGroup ? " grouped" : "");
      /* right = 手机主人 char；left = 对方（user 或 NPC） */
      const showAv = isRight ? !!charAv : (isUser && !!c.avatar);
      const avUrl = isRight ? charAv : (isUser ? c.avatar : "");
      const avStyle = showAv ? ` style="background-image:url('${escHtml(String(avUrl).replace(/'/g, "%27"))}')"` : "";
      /* 有头像时不渲染首字，避免字母压在图片上；群聊左侧用发言人名字首字当头像 */
      const senderName = String(m.name || m.sender || "").trim();
      const avTxt = showAv ? "" : (isRight ? charInit : escHtml((senderName || c.name || "?").slice(0, 1)));
      const nameLine = (isGroup && !isRight && senderName) ? `<div class="ct-sender">${escHtml(senderName)}</div>` : "";
      const bi = phoneSplitBilingual(m.text || "");
      wrap.innerHTML = `<div class="ct-msg-avatar"${avStyle}>${avTxt}</div><div class="ct-msg-body">${nameLine}<div class="ct-msg-bubble">${escHtml(phoneText(bi.orig))}</div></div>`;
      box.appendChild(wrap);
      try{
        const bubble = wrap.querySelector(".ct-msg-bubble");
        /* 私聊/群聊：外语在上，一条虚线，下面是中文译文（不再加「中文：」前缀）。 */
        const zh = bi.zh || String(m.translation || "").trim();
        if (zh) {
          bubble.appendChild(phoneTransDiv(zh));
        } else {
          phoneApplyTranslation(bubble, phoneText(bi.orig));
        }
      }catch(e){}
    });
  }
  appHost.querySelector("[data-detail]").classList.add("open");
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

/* 从聊天页切回手机时，实时刷新与 user 的会话 */
async function syncUserChatLive(){
  if(currentAppId !== "chat" || !appHost.classList.contains("show")) return;
  const list = appHost.querySelector("[data-list]");
  if(!list) return;
  const msgs = await loadUserChatMessages();
  const prev = userConvPreview(msgs);
  const firstRow = list.querySelector(".ct-item");
  if(firstRow){
    const last = firstRow.querySelector(".ct-last");
    const time = firstRow.querySelector(".ct-time");
    if(last) last.textContent = prev.text;
    if(time) time.textContent = prev.time;
  }
  if(currentConv && currentConv.isUser){
    currentConv.messages = msgs;
    const det = appHost.querySelector("[data-detail]");
    if(det && det.classList.contains("open")) openChatDetail(currentConv);
  }
}
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") syncUserChatLive(); });
window.addEventListener("focus", syncUserChatLive);

/* =========================================================
   10. 设置页
   ========================================================= */
const SETTINGS_APPS = [
  {id:"game",name:"游戏"},{id:"mail",name:"邮箱"},{id:"settings",name:"设置"},
  {id:"video",name:"视频"},{id:"diary",name:"日记"},{id:"private",name:"私密"},
  {id:"health",name:"健康"},{id:"chat",name:"聊天"},
  {id:"doubao",name:"豆包"},{id:"taobao",name:"淘宝"},{id:"mapcal",name:"地图日程"},{id:"wallet",name:"钱包"},
  {id:"album",name:"相册"},{id:"memo",name:"备忘录"},{id:"browser",name:"浏览器"}
];

async function openSettings(){
  const c = currentChar || {};
  const av = c.avatar || "";
  const proactiveOn = (localStorage.getItem("nano_takeover_proactive") === "1");
  const pagesN = localStorage.getItem("nano_takeover_pages") || "5";
  const pagesLabel = (pagesN === "all") ? "全部" : (parseInt(pagesN, 10) || 5) + " 页";
  appHost.innerHTML = `<div class="st-wrap">
    <header class="st-top">
      <div class="st-top-left" data-back>
        <div>
          <div class="st-top-title">设置</div>
          <div class="st-top-sub">SETTINGS</div>
        </div>
      </div>
      <div class="st-top-right"></div>
    </header>
    <main class="st-content">
      <div class="st-card">
        <div class="st-avatar" ${av ? `style="background-image:url('${escHtml(av)}')"` : ""}>${av ? "" : escHtml(String(c.name || "").slice(0,1))}</div>
        <div class="st-info">
          <div class="st-name">${escHtml(c.name || "")}</div>
          <div class="st-desc">Apple 账户、iCloud+ 等</div>
        </div>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="wallpaper">
          <div>
            <div class="st-btn-title">修改壁纸</div>
            <div class="st-btn-sub">从相册选择图片作为主屏背景</div>
          </div>
          <svg class="st-btn-chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="takeover">
          <div>
            <div class="st-btn-title">让 TA 接管我的手机</div>
            <div class="st-btn-sub">测试：TA 会翻看你的 App 并给你发消息</div>
          </div>
          <svg class="st-btn-chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="proactive-toggle">
          <div>
            <div class="st-btn-title">允许 TA 主动查看我的手机</div>
            <div class="st-btn-sub">默认关闭；开启后 TA 才会随机反查（也可在私聊设置里单独开启）</div>
          </div>
          <span style="font-size:13px;color:#8a8a8f;margin-left:8px">${proactiveOn ? "开" : "关"}</span>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="pages">
          <div>
            <div class="st-btn-title">每次查看的页数</div>
            <div class="st-btn-sub">越少越省调用次数；「全部」会翻完所有页面</div>
          </div>
          <span style="font-size:13px;color:#8a8a8f;margin-left:8px">${pagesLabel}</span>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="screenshare">
          <div>
            <div class="st-btn-title">让 TA 看我的真实屏幕</div>
            <div class="st-btn-sub">电脑或安卓 APK 一键共享整个屏幕，TA 每 30 秒点评一次（需能识图的模型）</div>
          </div>
          <svg class="st-btn-chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="ios-screen">
          <div>
            <div class="st-btn-title">iOS 快捷指令 · Share</div>
            <div class="st-btn-sub">手机用屏幕速聊：截图 → 服务端 → 回复弹通知，回到 Nano 自动进聊天</div>
          </div>
          <svg class="st-btn-chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="share">
          <div>
            <div class="st-btn-title">把手机内容分享给 TA</div>
            <div class="st-btn-sub">选择要分享的 App，TA 会在聊天里收到并和你讨论</div>
          </div>
          <svg class="st-btn-chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>

      <div class="st-section">换图标</div>
      <div class="st-icon-list"></div>

      <div class="st-danger">
        <button class="st-danger-btn" data-act="reset-wallpaper">恢复默认壁纸</button>
        <button class="st-danger-btn" data-act="reset-icons">恢复默认图标</button>
      </div>
    </main>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;

  const iconList = appHost.querySelector(".st-icon-list");
  for(let i = 0; i < SETTINGS_APPS.length; i++){
    const a = SETTINGS_APPS[i];
    const custom = await dataGet(`icon_${currentChar.id}_${a.id}`);
    const iconMode = (await dataGet(`iconmode_${currentChar.id}_${a.id}`)) || "fill";
    const row = document.createElement("div");
    row.className = "st-icon-row";
    const curIcon = document.querySelector(`#phoneHome [data-app="${CSS.escape(a.id)}"] .icon`);
    row.innerHTML = `
      <div class="st-icon-preview ${custom ? "custom" : ""}" ${custom ? `style="background-image:url('${escHtml(custom)}')"` : ""}>
        ${custom ? "" : (curIcon ? curIcon.innerHTML : "")}
      </div>
      <div class="st-icon-name">${escHtml(a.name)}</div>
      ${custom ? `<select class="st-icon-mode" data-mode-for="${a.id}">
        <option value="free"${iconMode === "free" ? " selected" : ""}>自由形状</option>
        <option value="fill"${iconMode === "fill" ? " selected" : ""}>填充包裹器</option>
      </select>` : ""}
      ${custom ? `<button class="st-mini-btn" data-reset="${a.id}">重置</button>` : ""}
      <button class="st-pick-btn" data-pick="${a.id}">更换</button>`;
    iconList.appendChild(row);
  }

  iconList.querySelectorAll("[data-pick]").forEach(btn => {
    btn.onclick = () => {
      pickImage(async data => {
        await dataSet(`icon_${currentChar.id}_${btn.dataset.pick}`, data);
        await applyIcons(currentChar.id);
        openSettings();
      });
    };
  });
  iconList.querySelectorAll("[data-reset]").forEach(btn => {
    btn.onclick = async () => {
      await dataSet(`icon_${currentChar.id}_${btn.dataset.reset}`, "");
      await dataSet(`iconmode_${currentChar.id}_${btn.dataset.reset}`, "");
      await applyIcons(currentChar.id);
      openSettings();
    };
  });
  iconList.querySelectorAll("[data-mode-for]").forEach(sel => {
    sel.onchange = async () => {
      await dataSet(`iconmode_${currentChar.id}_${sel.dataset.modeFor}`, sel.value);
      await applyIcons(currentChar.id);
    };
  });

  appHost.querySelector('[data-act="wallpaper"]').onclick = () => {
    pickImage(async data => {
      await dataSet(`wallpaper_${currentChar.id}`, data);
      await applyWallpaper(currentChar.id);
      openSettings();
    });
  };

  appHost.querySelector('[data-act="takeover"]').onclick = () => {
    const info = { id: currentChar.id, name: currentChar.name, avatar: currentChar.avatar || "" };
    try{
      const t = window.parent;
      if(t && t !== window && t.CharTakeover && t.CharTakeover.start){ t.CharTakeover.start(info); return; }
      if(window.CharTakeover && window.CharTakeover.start){ window.CharTakeover.start(info); return; }
      if(t && t !== window) t.postMessage({ type:"startTakeover", charId: info.id, charName: info.name, avatar: info.avatar }, "*");
    }catch(e){}
  };

  appHost.querySelector('[data-act="proactive-toggle"]').onclick = () => {
    const on = localStorage.getItem("nano_takeover_proactive") === "1";
    try{ localStorage.setItem("nano_takeover_proactive", on ? "0" : "1"); }catch(e){}
    openSettings();
  };

  appHost.querySelector('[data-act="pages"]').onclick = () => {
    const order = ["3", "5", "7", "10", "15", "all"];
    const cur = localStorage.getItem("nano_takeover_pages") || "5";
    const i = Math.max(0, order.indexOf(cur));
    const next = order[(i + 1) % order.length];
    try{ localStorage.setItem("nano_takeover_pages", next); }catch(e){}
    openSettings();
  };

  appHost.querySelector('[data-act="screenshare"]').onclick = () => {
    const info = { id: currentChar.id, name: currentChar.name, avatar: currentChar.avatar || "" };
    try{
      const t = window.parent;
      if(t && t !== window && t.ScreenShare && t.ScreenShare.start){ t.ScreenShare.start(info); return; }
      if(window.ScreenShare && window.ScreenShare.start){ window.ScreenShare.start(info); return; }
      if(t && t !== window) t.postMessage({ type:"startScreenShare", charId: info.id, charName: info.name, avatar: info.avatar }, "*");
    }catch(e){}
  };
  const iosScreenBtn = appHost.querySelector('[data-act="ios-screen"]');
  if (iosScreenBtn) iosScreenBtn.onclick = () => { openScreenSetup(); };
  appHost.querySelector('[data-act="reset-wallpaper"]').onclick = async () => {
    await dataSet(`wallpaper_${currentChar.id}`, "");
    await applyWallpaper(currentChar.id);
    openSettings();
  };
  appHost.querySelector('[data-act="reset-icons"]').onclick = async () => {
    for(const a of SETTINGS_APPS) await dataSet(`icon_${currentChar.id}_${a.id}`, "");
    await applyIcons(currentChar.id);
    openSettings();
  };
  const shareBtn = appHost.querySelector('[data-act="share"]');
  if (shareBtn) shareBtn.onclick = () => openPhoneSharePicker();
}

/* ---------- 查手机：把内容按 App 分享给 TA ---------- */
function phoneShareEsc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function phoneShareToast(msg){
  let t = document.getElementById("phoneShareToast");
  if(!t){ t = document.createElement("div"); t.id = "phoneShareToast";
    t.style.cssText = "position:fixed;left:50%;bottom:46px;transform:translateX(-50%) translateY(8px);background:rgba(20,20,20,.9);color:#fff;padding:9px 16px;border-radius:999px;font-size:13px;z-index:300;opacity:0;transition:all .2s;pointer-events:none";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(()=>{ t.style.opacity = "1"; t.style.transform = "translateX(-50%) translateY(0)"; });
  clearTimeout(t._tm);
  t._tm = setTimeout(()=>{ t.style.opacity = "0"; t.style.transform = "translateX(-50%) translateY(8px)"; }, 1800);
}
function phoneShareClip(s, n){
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}
/* 浏览器记录单独排版：普通浏览和无痕浏览都要完整带上。
   之前直接塞 JSON，普通记录太长把后面的无痕部分挤出 4000 字上限，角色就看不到无痕内容了。 */
function formatBrowserShare(data){
  const norm = (data && Array.isArray(data.normal)) ? data.normal : [];
  const incog = (data && Array.isArray(data.incognito)) ? data.incognito : [];
  const one = (it, i) => {
    it = it || {};
    const pts = Array.isArray(it.points) ? it.points.slice(0, 3).map(x => phoneShareClip(x, 28)).join("；") : "";
    const sec0 = (Array.isArray(it.sections) && it.sections[0]) ? it.sections[0] : null;
    const secTxt = sec0 ? ((sec0.heading ? phoneShareClip(sec0.heading, 20) + "：" : "") + phoneShareClip(sec0.text || "", 90)) : "";
    return (i + 1) + ". " + phoneShareClip(it.title || it.keyword || "未命名网页", 50) +
      "\n   站点：" + phoneShareClip(it.site || "", 18) + "｜搜索：" + phoneShareClip(it.keyword || "", 30) +
      "\n   时间：" + phoneShareClip(it.time || "", 20) + "｜访问 " + (Number(it.visits) || 1) + " 次" +
      (it.url ? ("\n   链接：" + phoneShareClip(it.url, 90)) : "") +
      (it.intro ? ("\n   简介：" + phoneShareClip(it.intro, 120)) : "") +
      (secTxt ? ("\n   内容：" + secTxt) : "") +
      (pts ? ("\n   要点：" + pts) : "") +
      (it.quote ? ("\n   原话：" + phoneShareClip(it.quote, 50)) : "");
  };
  return "【普通浏览记录】\n" + (norm.length ? norm.map(one).join("\n") : "（无）") +
    "\n\n【无痕浏览记录 · 不想被别人看到】\n" + (incog.length ? incog.map(one).join("\n") : "（无）");
}
async function buildAppShareText(appId){
  const app = SETTINGS_APPS.find(a => a.id === appId);
  const label = app ? app.name : appId;
  let text = "";
  try {
    const saved = await dataGet(`app_${currentChar.id}_${appId}`);
    if(saved && saved.data != null){
      text = (appId === "browser") ? formatBrowserShare(saved.data) : JSON.stringify(saved.data, null, 1);
    }
  } catch(e){}
  if(!text || text === "null") text = "（这个 App 还没有生成内容）";
  const cap = appId === "browser" ? 6000 : 4000;
  if(text.length > cap) text = text.slice(0, cap) + "\n…（已截断）";
  return { app: appId, name: label, text: text };
}
function openPhoneSharePicker(){
  const old = document.getElementById("phoneSharePicker");
  if(old) old.remove();
  const rows = SETTINGS_APPS.map(a => `<label style="display:flex;align-items:center;gap:12px;padding:13px 4px;border-bottom:1px solid #f0f0f0"><input type="checkbox" data-app="${a.id}" checked style="width:20px;height:20px"><span style="font-size:15px">${phoneShareEsc(a.name)}</span></label>`).join("");
  const ov = document.createElement("div");
  ov.id = "phoneSharePicker";
  ov.style.cssText = "position:fixed;inset:0;z-index:250;background:rgba(0,0,0,.4);display:flex;align-items:flex-end";
  ov.innerHTML = `<div style="width:100%;max-width:430px;margin:0 auto;background:#fff;border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));max-height:82vh;display:flex;flex-direction:column">
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">分享给 TA</div>
    <div style="font-size:12px;color:#8e8e93;margin-bottom:10px">勾选要分享的 App；TA 收到后不会自动回复，点「回复」或发一条消息才会读</div>
    <div style="overflow:auto;flex:1">${rows}</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button id="psAll" style="flex:1;height:44px;border:0;border-radius:12px;background:#f2f2f7;font-size:15px;font-weight:600">全选 / 全不选</button>
      <button id="psGo" style="flex:1;height:44px;border:0;border-radius:12px;background:#111;color:#fff;font-size:15px;font-weight:600">分享</button>
    </div>
    <button id="psCancel" style="margin-top:8px;height:40px;border:0;background:transparent;color:#8e8e93;font-size:14px">取消</button>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", e => { if(e.target === ov) close(); });
  ov.querySelector("#psCancel").onclick = close;
  ov.querySelector("#psAll").onclick = () => {
    const boxes = ov.querySelectorAll("input[data-app]");
    const anyOff = Array.from(boxes).some(b => !b.checked);
    boxes.forEach(b => b.checked = anyOff);
  };
  ov.querySelector("#psGo").onclick = async () => {
    const picks = Array.from(ov.querySelectorAll("input[data-app]")).filter(b => b.checked).map(b => b.getAttribute("data-app"));
    if(!picks.length){ phoneShareToast("请至少选择一个 App"); return; }
    const items = [];
    for(const id of picks){ try { items.push(await buildAppShareText(id)); } catch(e){} }
    try { localStorage.setItem("nano_pending_phone_share", JSON.stringify({ chatId: currentChar.id, name: currentChar.name, ts: Date.now(), items: items })); } catch(e){}
    close();
    try { if(window.parent && window.parent !== window) window.parent.postMessage({ type: "NANO_PHONE_SHARE", chatId: currentChar.id, name: currentChar.name }, "*"); } catch(e){}
    phoneShareToast("已分享 " + items.length + " 个 App 给 TA");
  };
}

function pickImage(cb){
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
  document.body.appendChild(inp);
  inp.onchange = e => {
    const f = e.target.files?.[0];
    if(!f){ inp.remove(); return; }
    const r = new FileReader();
    r.onload = ev => { cb(ev.target.result); inp.remove(); };
    r.readAsDataURL(f);
  };
  inp.click();
}

/* =========================================================
   11. 控制器
   ========================================================= */
const selectPage = document.getElementById("phoneSelectPage");
const phoneHome = document.getElementById("phoneHome");
const innerTop = document.getElementById("checkInnerTopbar");
const charList = document.getElementById("checkCharList");
const refreshSheet = document.getElementById("checkRefreshSheet");
const appListEl = document.getElementById("checkAppList");

let currentChar = null;
const WALLPAPER_EL = document.getElementById("wallpaper");

const CHAR_DB_NAME = "nano_characters_db";
const CHAR_STORE = "characters";

function loadCharsFromDB(){
  return new Promise(resolve => {
    try{
      const req = indexedDB.open(CHAR_DB_NAME, 1);
      req.onupgradeneeded = e => {
        try{
          const d = e.target.result;
          if(!d.objectStoreNames.contains(CHAR_STORE)) d.createObjectStore(CHAR_STORE, {keyPath:"id"});
        }catch(e2){}
      };
      req.onsuccess = e => {
        try{
          const d = e.target.result;
          const r = d.transaction(CHAR_STORE, "readonly").objectStore(CHAR_STORE).getAll();
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => resolve([]);
        }catch(e2){ resolve([]); }
      };
      req.onerror = () => resolve([]);
    }catch(e){ resolve([]); }
  });
}

function getCurrentUserId(){
  const keys = ["nano_mask_data","nano_home_data"];
  for(const k of keys){
    try{
      const d = JSON.parse(localStorage.getItem(k) || "null");
      if(d && Array.isArray(d.masks)){
        const cur = d.masks.find(m => m.id === d.currentMaskId);
        if(cur) return cur.id;
        if(d.masks[0]) return d.masks[0].id;
      }
    }catch(e){}
  }
  return null;
}

function getLastChatId(){
  try{
    const info = JSON.parse(sessionStorage.getItem("last_chat_info") || "null");
    return info && info.chatId ? String(info.chatId) : null;
  }catch(e){ return null; }
}

async function getChars(){
  let chars = [];
  try{ chars = await loadCharsFromDB(); }catch(e){ chars = []; }
  chars = (chars || []).filter(c => c && (c.name || c.id));
  const uid = getCurrentUserId();
  // 用户隔离：只看绑定到「当前人设」的角色（含本人小号/名下 NPC），不再把别人的 NPC/小号算进来；
  // 纳米是助手不是角色，永远不出现。
  let list = chars.filter(c => c && !c.nanoAssistant && String(c.bindUser || '') === String(uid || ''));

  const lastId = getLastChatId();
  if(lastId){
    list.sort((a, b) => (String(a.id) === lastId ? -1 : 0) - (String(b.id) === lastId ? -1 : 0));
  }
  if(!list.length){
    list = [];
  }
  return list;
}
function charName(c){ return c.name || c.nickname || c.char_name || c.character_name || "未命名角色"; }
function charDesc(c){ return c.desc || c.description || c.bio || c.persona || c.setting || "当前角色"; }
function charAvatar(c){ return c.avatar || c.avatarUrl || c.image || c.img || ""; }

async function renderChars(){
  const list = await getChars();
  charList.innerHTML = "";
  list.forEach((c, i) => {
    const id = String(c.id || c.charId || c.uid || c.name || ("char_" + i));
    const b = document.createElement("button");
    b.className = "check-char-card";
    const av = charAvatar(c);
    b.innerHTML = `
      <div class="check-char-avatar" ${av ? `style="background-image:url('${escHtml(av)}')"` : ""}>${av ? "" : escHtml(String(charName(c)).slice(0,1))}</div>
      <div class="check-char-info">
        <div class="check-char-name">${escHtml(charName(c))}</div>
        <div class="check-char-desc">${escHtml(charDesc(c))}</div>
      </div>
      <div class="check-char-arrow">›</div>`;
    b.onclick = () => enterChar(c, id);
    charList.appendChild(b);
  });
  // 通知点击直接进入某个角色的手机：phone.html?char=<角色id>
  try {
    const want = String(new URLSearchParams(location.search).get('char') || '').trim();
    if (want) {
      const hit = list.find((c, i) => String(c.id || c.charId || c.uid || c.name || ('char_' + i)) === want);
      if (hit) {
        const id = String(hit.id || hit.charId || hit.uid || hit.name || '');
        enterChar(hit, id);
        try {
          const u = new URL(location.href);
          u.searchParams.delete('char');
          const qs = u.searchParams.toString();
          history.replaceState(null, '', u.pathname + (qs ? ('?' + qs) : '') + u.hash);
        } catch (e) {}
      }
    }else{
      // 没有指定角色：如果上次在后台生成失败还没被读过，直接进入那个角色的手机把失败面板带出来。
      let pending = null;
      list.forEach((c, i) => {
        const id = String(c.id || c.charId || c.uid || c.name || ('char_' + i));
        const rec = loadPhoneGenFail(id);
        if(rec && (!pending || Number(rec.at || 0) > pending.at)){
          pending = { c, id, at: Number(rec.at || 0) };
        }
      });
      if(pending) enterChar(pending.c, pending.id);
    }
  } catch (e) {}
}

async function applyWallpaper(charId){
  const url = await dataGet(`wallpaper_${charId}`);
  WALLPAPER_EL.style.backgroundImage = (url && url.length > 10) ? `url("${url}")` : "";
}
async function applyIcons(charId){
  document.querySelectorAll("#phoneHome .icon-box").forEach(box => {
    box.classList.remove("has-custom", "mode-free", "mode-fill");
    box.style.backgroundImage = "";
    box.querySelectorAll(".phone-custom-img").forEach(img => img.remove());
  });
  const els = [...document.querySelectorAll("#phoneHome .app[data-app], #phoneHome .dock-slot[data-app]")];
  for(const el of els){
    const appId = el.dataset.app;
    const url = await dataGet(`icon_${charId}_${appId}`);
    if(url && url.length > 10){
      const box = el.querySelector(".icon-box");
      if(box){
        const mode = (await dataGet(`iconmode_${charId}_${appId}`)) || "fill";
        box.classList.add("has-custom", mode === "free" ? "mode-free" : "mode-fill");
        if(mode === "free"){
          box.style.backgroundImage = "";
          const img = document.createElement("img");
          img.className = "phone-custom-img";
          img.src = url;
          img.alt = "";
          box.appendChild(img);
        }else{
          box.style.backgroundImage = `url("${url}")`;
        }
      }
    }
  }
}
async function applyCharCustom(charId){
  await applyWallpaper(charId);
  await applyIcons(charId);
}

function enterChar(c, id){
  currentChar = Object.assign({}, c, {
    id: id,
    name: charName(c),
    desc: charDesc(c),
    avatar: charAvatar(c)
  });
  selectPage.classList.add("hidden");
  innerTop.style.display = "grid";
  phoneHome.style.display = "grid";
  document.getElementById("checkInnerTitle").textContent = charName(c) + " 的手机";
  applyCharCustom(id);
  updateHomeWidgets();
  // 主屏变为可见后再恢复用户保存的图标 / 小组件摆放。
  try{ if(window.__phoneLayoutRefresh) requestAnimationFrame(() => window.__phoneLayoutRefresh()); }catch(e){}
  // 上次在后台生成失败：进入这个角色的手机时把失败面板补回来，方便查看原因 / 继续生成。
  try{
    if(!genState.running){
      const rec = loadPhoneGenFail(id);
      if(rec && (rec.failed || []).length){
        lastFailedIds = rec.failed.slice();
        genState.log = Array.isArray(rec.log) ? rec.log.slice() : [];
        const rb = document.getElementById("genFailRetry");
        if(rb) rb.textContent = "继续生成";
        showGenFail(rec.msg || "以下 App 未生成完整，可点「继续生成」只补失败的部分。");
      }
    }
  }catch(e){}
}
function leaveChar(){
  innerTop.style.display = "none";
  phoneHome.style.display = "grid";
  selectPage.classList.remove("hidden");
  try{ hideGenFail(); }catch(e){}
  /* 关闭当前 App，避免生成过程中返回角色列表后界面还残留上一个角色的内容。
     正在进行的生成使用角色快照继续写盘，不受这里影响。 */
  try{ closeApp(); }catch(e){}
  currentChar = null;
  updateHomeWidgets();
}

function exitPhone(){
  try{
    if(window.parent && window.parent !== window){
      window.parent.postMessage({ type: "closeFullscreen" }, "*");
      return;
    }
  }catch(e){}
  if(history.length > 1) history.back();
  else window.location.href = "home.html";
}

document.getElementById("checkBack").onclick = exitPhone;
document.getElementById("checkInnerBack").onclick = leaveChar;

  const NON_REFRESH_APPS = ["settings","widget_polaroid","chat_widget","music_widget","profile_widget","calendar_widget"];

function getAppsForRefresh(){
  return [...document.querySelectorAll('#phoneHome [data-app]')]
    .filter(el => !NON_REFRESH_APPS.includes(el.dataset.app))
    .map(el => ({
      id: el.dataset.app,
      name: el.getAttribute("aria-label") || el.querySelector(".app-name")?.textContent?.trim() || el.dataset.app
    }));
}

async function getApiInfo(){
  const cfg = await getApiConfig();
  if(!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel){
    alert("未读取到主 API 配置，请先在 API 页配置主接口、Key 和模型。");
    return null;
  }
  return {
    url: cfg.mainUrl,
    key: cfg.mainKey,
    model: cfg.mainModel,
    temp: (typeof cfg.mainTemp === "number" ? cfg.mainTemp : 0.85),
    maxTokens: Number(cfg.mainMax) || 0
  };
}

/* 刷新面板 */
document.getElementById("checkRefresh").onclick = async () => {
  if(!currentChar) return;
  if(genState.running){ showGenToast("正在生成中，请稍候…"); return; }
  const apps = getAppsForRefresh();
  appListEl.className = "check-app-grid";
  appListEl.innerHTML = apps.map(a =>
    `<label class="check-app-item checked">
       <input type="checkbox" value="${escHtml(a.id)}" checked>
       <span class="nm">${escHtml(a.name)}</span>
     </label>`).join("");
  appListEl.querySelectorAll("input").forEach(cb => {
    cb.addEventListener("change", () => {
      cb.closest(".check-app-item").classList.toggle("checked", cb.checked);
    });
  });
  document.getElementById("checkSelectAll").textContent = "取消全部选择";

  const statusEl = document.getElementById("checkApiStatus");
  const cfg = await getApiConfig();
  if(!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel){
    statusEl.innerHTML = `<span class="bad">未读取到主 API 配置</span><br>请先在 API 页配置主接口、Key 和模型。`;
  }else{
    statusEl.innerHTML = `使用主 API：<span class="ok">${escHtml(cfg.mainModel)}</span><br>接口：${escHtml(cfg.mainUrl)}`;
  }

  refreshSheet.classList.remove("hidden");
};
document.getElementById("checkRefreshClose").onclick = () => refreshSheet.classList.add("hidden");
refreshSheet.addEventListener("click", e => { if(e.target === refreshSheet) refreshSheet.classList.add("hidden"); });

document.getElementById("checkSelectAll").onclick = () => {
  const boxes = [...appListEl.querySelectorAll("input")];
  const all = boxes.length && boxes.every(x => x.checked);
  boxes.forEach(x => {
    x.checked = !all;
    x.closest(".check-app-item").classList.toggle("checked", !all);
  });
  document.getElementById("checkSelectAll").textContent = all ? "选择全部 App" : "取消全部选择";
};

/* ===== 单次 API 生成多个 App ===== */
const MULTI_SPEC = {
  video:`"video":[{"title":"视频标题","up":"UP主","date":"2026年8月12日 11:23","duration":"01:42","progress":"00:03","desc":"简介","category":"影视解说","tags":["标签"],"collected":false,"private":false,"note":"角色备注","comments":[{"user":"网名","text":"弹幕"}]}]`,
  diary:`"diary":[{"date":"2026 · 08 · 28","name":"标题","day":"星期五","weather":"晴","content":"正文"}]`,
  album:`"album":[{"text":"照片文字","date":"8月27日 21:14","place":"地点","people":"画面里的人","album":"日常","private":false,"detail":"照片背后的细节"}]`,
  mail:`"mail":[{"sender":"发件人","date":"8月27日","subject":"标题","preview":"预览","icon":"person","unread":false,"title":"正文标题","body":["段落一","段落二"],"translation":"整封邮件的中文翻译，统一写在这里；中文邮件留空"}]`,
  memo:`"memo":[{"group":"过去 7 天","items":[{"title":"标题","meta":"日期 · 摘要","content":"正文"}]}]`,
  health:`"health":{"steps":{"total":8426,"goal":10000,"hours":[1200,0,0,0,0,0,0,320,540,860,430,210,680,920,1500,1200,760,340,880,1120,640,300,150,0]},"distance":{"total":"5.80","kcal":318},"sleep":{"score":92,"duration":"8小时12分","deep":"1h 48m","weekly":[78,85,60,92,70,88,95]},"screen":{"hours":3,"minutes":46,"weekly":[120,95,140,60,180,210,226]}}`,
  browser:`"browser":{"normal":[{"keyword":"搜索词","url":"https://example.com/a","site":"网站名","title":"网页标题","time":"今天 22:06","visits":3,"intro":"页面导语 60-120 字","sections":[{"heading":"小标题","text":"正文 80-180 字","list":["可选要点"]}],"quote":"页面原话","points":["要点一","要点二","要点三"],"comments":[{"user":"网名","text":"评论"}],"related":[{"title":"相关推荐","site":"网站名","url":"https://example.com/rel"}]}],"incognito":[{"keyword":"无痕搜索词","url":"https://example.com/b","site":"网站名","title":"网页标题","time":"今天 23:41","visits":2,"intro":"页面导语","sections":[{"heading":"小标题","text":"正文","list":["要点"]}],"quote":"页面原话","points":["要点一","要点二","要点三"],"comments":[{"user":"网名","text":"评论"}],"related":[{"title":"相关推荐","site":"网站名","url":"https://example.com/rel"}]}]}`,
  game:`"game":[{"name":"中文游戏名","id":"4827 1936","winRate":68,"matches":327,"wins":222,"losses":105,"rank":"大师","rating":2847,"rankMark":"III","recent":[{"result":"W","mode":"排位赛","time":"今天 · 21:42","kda":"18 / 6 / 11"}],"habit":"隐藏游戏习惯","weekly":[35,55,43,75,100,67,46]}]`,
  private:`"private":[{"type":"PRIVATE / 01","time":"23:41","title":"标题","preview":"30-55 字：说清是什么事、和谁、发生在哪","detail":"100-200 字：具体时间、地点、人物、对话、动作、当时的念头和后来发生的小后续","tags":["心事","私密"],"level":"轻"}]`,
  chat:`"chat":{"userRemark":"角色给用户存的备注（2-8字）","chats":[{"name":"会话名 / 群名","group":false,"members":["群聊时的成员名"],"lastMsg":"最后一条","time":"昨天 22:13","unread":0,"messages":[{"side":"left","name":"这条是谁发的（群聊时填）","text":"原文","translation":"中文时留空；外文时填中文译文"}]}]}`,
  doubao:`"doubao":[{"role":"char","content":"角色问豆包的问题（原文）","translation":"中文时留空；外文时填中文译文"},{"role":"ai","content":"豆包的回答（原文）","translation":"中文时留空；外文时填中文译文"}]`,
  taobao:`"taobao":{"cart":[{"name":"商品名","shop":"店铺","spec":"规格","price":"129"}],"orders":[{"shop":"店铺","name":"商品名","spec":"规格","price":"129","status":"交易成功","time":"8月27日"}],"food":[{"restaurant":"店名","dish":"菜品","price":"26.8","status":"已送达","time":"今天 12:18"}]}`,
  store:`"store":{"cart":[{"name":"商品名","shop":"店铺","spec":"规格","price":"129"}],"orders":[{"shop":"店铺","name":"商品名","spec":"规格","price":"129","status":"交易成功","time":"8月27日"}],"food":[{"restaurant":"店名","dish":"菜品","price":"26.8","status":"已送达","time":"今天 12:18"}]}`,
  mapcal:`"mapcal":{"places":[{"name":"地点名","address":"地址或区域","time":"今天 14:20","note":"搜索或导航备注"}],"events":[{"date":"10月4日","day":"星期六","time":"15:30","title":"安排标题","info":"地点或说明","tag":"工作"}]}`,
  wallet:`"wallet":{"balance":12800.5,"transactions":[{"type":"expense","desc":"星巴克","amount":32,"time":"2026-10-24T10:15:00"},{"type":"income","desc":"工资入账","amount":12800,"time":"2026-10-23T08:00:00"}]}`
};
const MULTI_COUNT = {
  video:"video 4 条（至少 3 种分区，含 1-2 条私密/深夜收藏）", diary:"diary 3 篇", album:"album 8 条（至少 4 种相册类型，含 2 条私密相册）", mail:"mail 4 封",
  memo:"memo 约 4 条（分 2-3 组，每组 1-2 条）", browser:"browser：normal 5-6 条、incognito 3-4 条（无痕可含私密内容）", game:"game 2 个",
  private:"private 5 条确实发生过、有细节的私事 / 秘密（每条 preview 30-55 字、detail 100-200 字；其中 1-2 条写隐晦的心动/欲望/幻想，用暗示和场景表达，不露骨）", chat:"chat：userRemark 1 条（角色给用户的备注），chats 3 个会话（2 个一对一 + 1 个群聊；每个 4-5 轮、8-10 条消息；群聊左侧消息必须带 name；外文消息把译文放在 translation）",
  doubao:"doubao 8-10 条消息（char 与 ai 交替，构成一次完整对话）",
  taobao:"taobao：cart 2-3 件、orders 2-3 单、food 2-3 单",
  store:"store：cart 2-3 件、orders 2-3 单、food 2-3 单",
  mapcal:"mapcal：places 3 个、events 4 条",
  wallet:"wallet：transactions 10 条左右（收入 2-3 条、支出 7-8 条），balance 为余额，必须符合人设财富阶层"
};

async function buildMultiPrompt(ids, char, ctx){
  // 输出太长时模型会从后往前截断；把钱包 / 相册 / 浏览器 / 聊天这些容易被截掉的 App 排到最前面。
  const PREFERRED_ORDER = ["wallet","album","browser","private","memo","chat","video","mapcal","taobao","store","health","game","doubao","mail","diary"];
  const orderedIds = ids.slice().sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a), ib = PREFERRED_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  // 把「当前已经存着的内容」也当成负例：用户点刷新时，即使历史记录还是空的，
  // 也不会把同一批标题、地点、店名、物品再生成一遍。
  const variation = phoneVariation();
  const recent = loadPhoneSigs(char && char.id);
  for(const id of orderedIds){
    try{
      const saved = await dataGet(`app_${char.id}_${id}`);
      const d = saved && (saved.data || saved);
      if(d){
        recent[id] = uniqSigs((recent[id] || []).concat(collectPhoneSigs(id, d))).slice(-14);
      }
    }catch(e){}
  }
  const need = orderedIds.filter(id => MULTI_SPEC[id]).map(id => MULTI_SPEC[id]).join(",\n  ");
  const counts = orderedIds.filter(id => MULTI_COUNT[id]).map(id => MULTI_COUNT[id]).join("；");
  const matureLine = "【成熟题材】内容面向成年读者，可以写成熟的情感、暧昧与亲密关系；含蓄克制，不写露骨细节；禁止血腥暴力和违法内容。\n";
  let walletContext = "";
  if(ids.includes("wallet")){
    const wkey = "nano_char_wallet_" + (char && char.id || "");
    let w = null;
    try{ w = JSON.parse(localStorage.getItem(wkey) || "null"); }catch(e){}
    if(!w && window.NanoIDB){
      try{
        const saved = await NanoIDB.get(wkey);
        if(saved && typeof saved === "object"){ w = saved; saveCharWallet(wkey, w); }
      }catch(e){}
    }
    let profile = null;
    try{
      if(window.NanoCharWealth){
        profile = NanoCharWealth.profileFor((char && (char.setting || char.desc)) || "", (char && char.name) || "");
        NanoCharWealth.saveProfile(char && char.id, profile);
      }
    }catch(e){}
    let bal = (w && typeof w.balance === "number") ? w.balance : (profile ? profile.balance : 5000);
    if(profile && (!w || w.seedVersion !== 2 || w.wealthTier !== profile.tier || !!w.lowFamily !== !!profile.lowFamily || !!w.veryPoor !== !!profile.veryPoor)){
      bal = profile.balance;
      w = { balance: bal, transactions: [], wealthTier: profile.tier, wealthLabel: profile.label, lowFamily: !!profile.lowFamily, veryPoor: !!profile.veryPoor, seedVersion: 2 };
      saveCharWallet(wkey, w);
    }else if(w && !w.balanceManual && profile && window.NanoCharWealth && NanoCharWealth.clampBalance){
      // 旧数据可能已经被越滚越高：生成前先把余额压回人设区间，模型才会按正确余额编流水。
      const fixed = NanoCharWealth.clampBalance(profile, bal);
      if(fixed !== bal){ bal = fixed; w.balance = bal; saveCharWallet(wkey, w); }
    }
    const recent = (w && Array.isArray(w.transactions) && w.transactions.length)
      ? w.transactions.slice(0, 5).map(t => (t.type === "income" ? "+" : "-") + "¥" + t.amount + " " + (t.desc || "") + " " + (t.time || "")).join("\n")
      : "（暂无）";
    const wealth = (profile && window.NanoCharWealth) ? ("\n" + NanoCharWealth.promptBlock(profile) + "\n") : "";
    walletContext = wealth + `\n【当前银行卡余额】¥${bal}\n【最近流水】\n${recent}\nwallet 的 balance 必须等于当前余额 + 收入合计 - 支出合计；流水时间在最近 7 天内，按从新到旧排列；收入 2-3 条、支出 7-8 条，至少 1-2 条自然涉及用户。收入类型、消费场所和金额必须符合上面的财富阶层，学生不能出现项目尾款/分红/股权/公司报销。\n`;
  }
  return `你是「${char.name}」的手机数据生成器。
${ctx}

${PERSONA_RULE}
${matureLine}
${walletContext}
${phoneVariationBlock(variation)}
${phoneRecentBlock(recent, orderedIds)}
请围绕上面的变化种子，换一个与以往不同的切入角度、场景与措辞来写，避免和之前生成的内容雷同。
请一次性生成以下 App 的数据（只生成这些：${orderedIds.join("、")}）：
{
  ${need}
}
数量要求：${counts || "按示例数量生成"}；health 的 hours 恰好 24 个整数、weekly 恰好 7 个数字。
优先保证每个 App 都至少出现：如果篇幅不够，宁可每个 App 写短一点，也不要漏掉后面的 App；确实写不出的 App 可以跳过，继续写后面的 App，不要中断整段 JSON。
严禁生成「和用户本人」的聊天会话。

【语言与翻译 · 强制】
- 所有 App 的所有可见文字默认用简体中文。
- 只翻译真正的正文/对白（日记、私密、备忘录、网页正文、评论、聊天对白等）；人名、地名、品牌/App 名、账号、网址、ID、商品规格不翻译，保留原文。
- 聊天(chat)：messages 每条用 text 放原文，中文译文放到同一条的 translation；没有外文时 translation 留空。
- 豆包(doubao)：每条用 content 放原文，中文译文放到同一条的 translation。
- 邮件(mail)：body 每段放原文；整封邮件的中文翻译统一放到邮件对象的 translation 字段，不要逐段翻译。
- 其它 App 的非中文正文，在同一字段内用「原文（中文：译文）」；简体中文不要加翻译。

【写作要求 · 每条都要有内容，不要只写一两句】
- 同批内每条至少要有 2 个只属于这次的具体新细节（人名 / 店名 / 地名 / 数字 / 物件 / 原话）；不要只换同义词，也不要套同一句式的模板。
- 不同 App 不要复写同一个事件、同一件物品、同一家店；diary / album / private / memo 必须分属不同生活切面，不要都围绕「想你 / 忙 / 累」打转。
- chat 的 NPC、browser 的搜索词、video 的分区、private 的秘密类型、mail 的发件人每次都要换新，不要总用同一批身份、主题和场景。
- video：4 条，至少 3 种分区；不要每次都用 ASMR，ASMR 最多偶尔出现 1 条；1-2 条可以是「私密收藏 / 深夜播放」的暧昧向、身材/亲密关系内容（成年虚构角色，含蓄克制，不写露骨细节，不违法/血腥）；video.desc 30-60 字，写清视频讲了什么 + 角色的反应，不要写空行；comments 是 2-3 条真实感弹幕/评论。
- diary.content：120-200 字，有具体场景、动作、心情变化，像真人日记；不要总写同一种日常。
- mail.body：每封 3-4 段，每段 30-60 字，有称呼、正文、落款的感觉。
- memo：总数约 4 条，分 2-3 组；每条 content 90-150 字，写清具体经过、心情或待办细节，不要写得太短。
- browser.normal：5-6 条日常搜索/访问，类型要丰富（工作学习、购物、外卖、健康、追剧追星、游戏、旅游、本地服务、论坛八卦、新闻、二手、情感求助等）；browser.incognito：3-4 条角色私下查过、不想被别人看到的私密内容（亲密关系、暗恋、身体困扰、内衣/礼物、偷偷搜索某个人、难以启齿的小习惯等），含蓄克制，不写露骨细节；普通和无痕都要换新主题。
- browser 的每一条都必须像能点开看的网页：intro 60-120 字；sections 2-3 个正文区块，每个 text 80-180 字，有具体细节/数据/对话/观点；quote 15-50 字；points 3 条各 15-30 字；comments 3-5 条真实评论区跟帖；related 2-3 条相关推荐。
${ids.includes("private") ? "- private：写 5 条真正有内容的私密记录，不是情绪短句。每条 preview 30-55 字，写清是什么事、和谁、发生在哪；detail 100-200 字，要像一段被藏起来的日记/录音转写：有具体时间、地点、人物、对话、动作、当时的想法和后来发生的小后续，读者看完能知道一件完整的事。不要用「想你 / 自卑 / 怕失去 / 暗恋」这类空泛模板反复凑数；不同条目必须是不同的人、不同的事件、不同的生活切面（家人、朋友、工作/学习、亲密关系、身体、消费、旧回忆等）。其中 1-2 条可以是角色见不得人的心动、欲望或幻想：用暗示、停顿、随身物件、气味、距离和场景来写，写 TA 的羞耻、克制和反复想起的念头，不要直白描写身体或使用露骨词汇，避免被内容审核截断。\n" : ""}
- game.habit：40-80 字，写清玩法习惯与心态。
- chat.userRemark：${char.name} 在手机里给用户存的备注（2-8 字），符合两人的关系与角色对用户的称呼习惯，不要用「小姑娘/小东西/丫头/女人」这类油腻称呼。
- chat.chats：3 个会话 = 2 个一对一 + 1 个群聊；每个会话 4-5 轮、8-10 条消息，有来有回，单条 5-25 字；群聊的 group=true、members 写 3-5 个成员，左侧消息必须用 name 标明是谁说的；不要生成和用户本人的会话；NPC 身份、名字、关系和聊天主题每次都要换新。
- album：8 条，至少 4 种相册类型，其中 2 条 private=true 放进私密相册（亲密关系、暧昧合照、暧昧聊天截图、身材记录、偷偷保存的人等；成年虚构角色，但含蓄克制，不写露骨细节）；album.text 12-40 字，写清光线、地点、物件、人物局部或当时发生的小事，不要抽象心情；detail 30-70 字，写清角色为什么留着这张；场景和物件每次都要换，不要 8 条都围绕「想你 / 忙 / 累」。
- doubao：8-10 条，char 提问与 ai 回答交替；问题贴合角色当下生活与困惑，ai 回答口语化、可带分点，单条 20-60 字。
- taobao / store：商品名、店铺、规格、价格要像真实电商；外卖写清店名、菜品、时间与配送状态；cart/orders/food 都要有数据，店名和商品不要每次都用同一批。
- mapcal.places：写角色搜索或导航过的、有真实感的地点；events：写接下来的日程，含时间、地点、类型标签；地点和日程每次都要换。
${ids.includes("wallet") ? "- wallet：10 条左右收支，收入 2-3 条，收入来源必须严格符合角色的财富阶层（学生只能是生活费/兼职/奖学金/红包/退款；穷人只能是日结/兼职/红包/退款/补助；富人才可以有分红/投资/项目结款），支出 7-8 条；金额、店铺、时间必须符合角色的身份与消费水平；至少 1-2 条自然涉及用户；时间在最近 7 天内，按从新到旧排列；balance 必须等于【当前银行卡余额】+ 收入合计 - 支出合计，且必须落在角色财富阶层的合理区间内，不能为负，不能把穷学生写成十几万存款。\n" : ""}
最后再检查一次：如果某个标题、地点、店名、物品或事件在「最近已经生成过」里出现过，必须换掉；不要只改一个字或换个说法。
【JSON 格式 · 稳优先】字段名必须与示例一致，但允许省略可选字段（如 tags / note / comments / related / list / points 等），省略不影响显示；不确定的字段宁可留空或省略，也不要写坏 JSON。每条内容可以短一点，但必须保证括号闭合、逗号正确、字符串里没有真实换行。
每个 App 的数据格式必须严格符合示例字段名，只输出一个 JSON 对象，不要解释、不要代码块。
输出必须是合法 JSON：只输出一个 JSON 对象，不要代码块、注释或多余文字；字符串内部不要出现真实换行，需要分段时写成 \\n；字段之间可以不留空格，但不要为了「紧凑」省略上面要求的内容。`;
}

/* 从原始文本中用括号配对提取某个 App 的值（用于顶层解析失败时抢救已生成内容） */
function extractAppValue(raw, id){
  let m;
  try{ m = new RegExp('"' + id + '"\\s*:\\s*').exec(raw); }catch(e){ return undefined; }
  if(!m) return undefined;
  const start = m.index + m[0].length;
  const ch0 = raw[start];
  if(ch0 !== "[" && ch0 !== "{") return undefined;
  let depth = 0, inStr = false, esc = false;
  for(let j = start; j < raw.length; j++){
    const ch = raw[j];
    if(inStr){
      if(esc) esc = false;
      else if(ch === "\\") esc = true;
      else if(ch === '"') inStr = false;
      continue;
    }
    if(ch === '"'){ inStr = true; continue; }
    if(ch === "[" || ch === "{") depth++;
    else if(ch === "]" || ch === "}"){
      depth--;
      if(depth === 0){
        try{ return JSON.parse(raw.slice(start, j + 1)); }catch(e){ return undefined; }
      }
    }
  }
  // 输出被截断时，最后一个 App 往往没有闭合括号：补全后再尝试抢救。
  try{
    const fixed = repairJsonText(raw.slice(start));
    const v = JSON.parse(fixed);
    if(v !== undefined && v !== null) return v;
  }catch(e){}
  return undefined;
}

/* 把 stream:true 的 SSE 文本还原成和普通响应一样的 choices 结构 */
function sseRawToEnvelope(raw){
  const text = String(raw || "");
  if(!/^\s*data:/m.test(text)) return text;
  let content = "", finish = "";
  text.split(/\r?\n/).forEach(function(line){
    const m = line.match(/^\s*data:\s*(.*)$/);
    if(!m) return;
    const chunk = String(m[1] || "").trim();
    if(!chunk || chunk === "[DONE]") return;
    try{
      const o = JSON.parse(chunk);
      const ch = o && o.choices && o.choices[0];
      if(ch){
        content += (ch.delta && ch.delta.content) || (ch.message && ch.message.content) || "";
        if(ch.finish_reason) finish = ch.finish_reason;
      }
    }catch(e){}
  });
  return JSON.stringify({choices:[{message:{content}, finish_reason:finish}]});
}

async function genMulti(api, char, ids, opts){
  const ctx = (opts && opts.lite) ? buildLiteContext(char) : await buildCharContext(char);
  const user = await buildMultiPrompt(ids, char, ctx);
  const endpoint = buildChatEndpoint(api.url);
  let __sysJson = SYS_JSON;
  try {
    if (window.NanoPrompts && NanoPrompts.appendTo) __sysJson = NanoPrompts.appendTo(__sysJson, 'phone', { keepFormat: true });
  } catch (e) {}
  // 一次生成全部 App 时输出很长；默认给 24576。用户可在 API 设置里调低以兼容只支持小输出的模型。
  const maxTokens = Math.min(32768, Math.max(4096, Number(api.maxTokens) || 24576));
  // 手机内容属于创作类数据：温度至少 0.9，并提高重复惩罚，避免每次生成同一批模板；
  // 用户在 API 页填得更高时保持用户设置。
  const creativeTemp = Math.max(0.9, Number(api.temp) || 0.9);
  const baseBody = {
    model: api.model,
    messages: [{role:"system", content:__sysJson},{role:"user", content:user}],
    temperature: creativeTemp,
    max_tokens: maxTokens,
    presence_penalty: 0.6,
    frequency_penalty: 0.7
  };
  const headers = {"Content-Type":"application/json"};
  if(api.key) headers.Authorization = "Bearer " + api.key;

  const log = [];
  log.push({t:"sec", s:"请求信息"});
  log.push({t:"", s:"URL: " + endpoint});
  log.push({t:"", s:"Model: " + api.model});
  log.push({t:"", s:"Apps: " + ids.join(", ")});

  /* 强制一次请求生成全部 App：不再自动做参数降级、流式兼容或任何重试。
     失败就直接把错误交给用户，由用户自己点「重新生成」，避免一次点击偷偷扣多次 API。 */
  let resp, rawText = "", lastErr = "";
  const post = async function(payload){
    return fetch(endpoint, {method:"POST", headers, body: JSON.stringify(payload)});
  };
  const payload = {
    model: api.model,
    messages: baseBody.messages,
    temperature: creativeTemp,
    max_tokens: maxTokens,
    presence_penalty: 0.6,
    frequency_penalty: 0.7
  };
  try{
    resp = await post(payload);
  }catch(e){
    log.push({t:"err", s:"网络错误: " + e.message});
    return {ok:{}, log, fatal:"网络错误：" + e.message};
  }
  try{ rawText = await resp.text(); }catch(e){ rawText = ""; }
  // 流式响应用 SSE 返回时，转成普通 choices 结构，后面的解析逻辑完全复用。
  if(resp.ok && (/text\/event-stream/i.test(resp.headers.get("content-type") || "") || /^\s*data:/.test(String(rawText || "")))){
    rawText = sseRawToEnvelope(rawText);
  }
  // 网关地址填错时经常返回 200 + 登录页 HTML，看起来“API 调用了”，但其实没进模型。
  if(resp.ok && /^\s*<(?:!doctype\s+html|html[\s>])/i.test(String(rawText || ""))){
    log.push({t:"err", s:"API 返回的是 HTML 网页，不是模型 JSON。请检查主 API 地址（应填到 /v1，不能有多余路径）。"});
    return {ok:{}, log, fatal:"API 地址返回了网页，不是接口：\n" + endpoint};
  }
  if(!resp.ok) lastErr = "HTTP " + resp.status + (rawText ? "：" + rawText.slice(0,150) : "");
  log.push({t: resp.ok ? "ok" : "err", s:"HTTP " + resp.status});
  if(!resp.ok){
    return {ok:{}, log, fatal: lastErr || "请求失败"};
  }

  /* ⚠️ rawText 是 API 外层响应，必须取出 choices[0].message.content 才是模型内容 */
  let content = "", finishReason = "";
  try{
    const env = JSON.parse(rawText);
    if(env && typeof env === "object"){
      content = env?.choices?.[0]?.message?.content || env?.choices?.[0]?.text || env?.output_text || "";
      finishReason = env?.choices?.[0]?.finish_reason || "";
    }
  }catch(e){}
  const truncated = finishReason === "length";
  if(finishReason) log.push({t: truncated ? "warn" : "", s:"finish_reason: " + finishReason + (truncated ? "（输出被截断，已保留截断前生成的内容）" : "")});
  if(!content) content = rawText;   /* 兼容直接返回模型内容的接口 */
  const text = String(content);
  log.push({t:"sec", s:"模型内容（前 1200 字）"});
  log.push({t:"", s: text.slice(0,1200) || "(空)"});

  let json = null;
  try{ json = JSON.parse(text.replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"").trim()); }
  catch(e){ json = extractJSON(text); }

  log.push({t:"sec", s:"解析结果"});
  const ok = {};
  const partialIds = [];
  const source = (json && typeof json === "object") ? json : {};
  if(!json || typeof json !== "object") log.push({t:"warn", s:"顶层 JSON 解析失败，尝试逐个 App 抢救…"});
  const ARRAY_APPS = ["video","diary","album","mail","memo","game","private","doubao"];
  for(const id of ids){
    let data = source[id];
    if(data === undefined || data === null){
      data = extractAppValue(text, id);
      if(data !== undefined && data !== null) log.push({t:"warn", s:`${id}: 顶层缺失，已从原文抢救`});
    }
    if(data === undefined || data === null){ log.push({t:"err", s:`${id}: 缺失`}); continue; }
    let valid = true, reason = "";
    if(id === "browser"){
      data = normalizeBrowserData(data);
      if(data.normal.length > 6) data.normal = data.normal.slice(0, 6);
      if(data.incognito.length > 4) data.incognito = data.incognito.slice(0, 4);
      if(!data.normal.length || !data.incognito.length){
        if(data.normal.length || data.incognito.length){
          /* 两组只生成了一组：先保存已生成的部分，同时记为未完成，让用户可继续补。 */
          ok[id] = {type:id, data};
          partialIds.push(id);
          log.push({t:"warn", s:`${id}: 只生成了一部分（普通 ${data.normal.length} 条 / 无痕 ${data.incognito.length} 条），已先保存`});
          continue;
        }
        valid = false;
        reason = "normal / incognito 都为空";
      }
    }else if(id === "chat"){
      data = normalizeChatData(data);
      if(!data.chats.length){ valid = false; reason = "chats 为空"; }
      else data.chats = data.chats.slice(0, 3);
    }else if(ARRAY_APPS.includes(id)){
      if(!Array.isArray(data) || !data.length){ valid = false; reason = "不是非空数组"; }
      else{
        data = data.filter(it => it && typeof it === "object" && Object.keys(it).length);
        if(!data.length){ valid = false; reason = "数组里没有有效内容"; }
        else if(id === "video") data = data.slice(0, 4);
      }
    }
    if(id === "health" && (!data || typeof data !== "object" || !data.steps)){ valid = false; reason = "缺少 steps"; }
    if((id === "taobao" || id === "store") && (!data || typeof data !== "object" || !(Array.isArray(data.cart) || Array.isArray(data.orders) || Array.isArray(data.food)))){ valid = false; reason = "缺少 cart/orders/food"; }
    if(id === "mapcal" && (!data || typeof data !== "object" || !(Array.isArray(data.places) || Array.isArray(data.events)))){ valid = false; reason = "缺少 places/events"; }
    if(id === "wallet" && (!data || typeof data !== "object" || !Array.isArray(data.transactions) || !data.transactions.length)){ valid = false; reason = "缺少 transactions"; }
    if(!valid){ log.push({t:"err", s:`${id}: 校验失败（${reason}）`}); continue; }
    ok[id] = {type:id, data};
    const count = id === "browser"
      ? `普通 ${data.normal.length} 条 / 无痕 ${data.incognito.length} 条`
      : (id === "chat" ? `${data.chats.length} 个会话${data.userRemark ? " + 备注" : ""}` : (Array.isArray(data) ? data.length + " 条" : "对象"));
    log.push({t:"ok", s:`${id}: OK（${count}）`});
  }
  if(truncated){
    const missing = ids.filter(id => !ok[id] || partialIds.includes(id));
    log.push({t:"warn", s:`输出达到上限被截断，已保留截断前生成的 ${ids.length - missing.length} 个 App` + (missing.length ? `；未完成：${missing.join("、")}` : "")});
  }
  /* 模型/中转直接返回了内容安全拦截时，给出明确提示；绝不自动重试，也不把已经付费的响应丢掉当成普通格式错误。 */
  if(!Object.keys(ok).length && (isContentBlocked(text) || isContentBlocked(rawText))){
    log.push({t:"err", s:"内容被上游/中转拦截（只调用一次，不会自动重试）"});
    return {ok:{}, log, fatal:"本次内容被上游/中转拦截。已只调用一次 API，不会自动重试；可以调整尺度、换模型或换中转后再试。", truncated:false, partialIds};
  }
  if(!Object.keys(ok).length){
    /* 已经付过一次费：明确告诉用户是格式问题，不要表现得像没请求过，也不自动重试。 */
    const why = json ? "模型返回了 JSON，但没有任何一个 App 通过校验" : "模型输出不是合法 JSON";
    log.push({t:"err", s:why + "（本次只调用一次，不会自动重试）"});
    return {ok:{}, log, fatal:why + "。本次只调用一次 API，不会自动重试；可点「重新生成」再试。", truncated, partialIds};
  }
  return {ok, log, fatal:null, truncated, partialIds};
}

/* ===== 生成状态（非阻塞 · 可切换 App · 一次只调用一次 API） ===== */
const genState = { running:false, ids:[], failed:[], log:[], charId:"" };
try{ if(window.NanoRefresh) window.NanoRefresh.define({ id:'phone', name:'手机', url:'phone.html', title:'手机' }); }catch(e){}
let lastFailedIds = [];

/* 生成失败信息落盘：退出查手机后失败通知点回来 / 下次进入该角色手机时，
   失败面板和日志仍然在，可以直接看原因或继续补生成。 */
const PHONE_FAIL_PREFIX = "phone_gen_fail_";
function savePhoneGenFail(charId, rec){
  if(charId == null || charId === "") return;
  try{ localStorage.setItem(PHONE_FAIL_PREFIX + charId, JSON.stringify(rec)); }catch(e){}
}
function loadPhoneGenFail(charId){
  if(charId == null || charId === "") return null;
  try{ return JSON.parse(localStorage.getItem(PHONE_FAIL_PREFIX + charId) || "null"); }catch(e){ return null; }
}
function clearPhoneGenFail(charId){
  if(charId == null || charId === "") return;
  try{ localStorage.removeItem(PHONE_FAIL_PREFIX + charId); }catch(e){}
}

/* 跨 iframe 的生成锁：后台还在生成时，从通知/桌面再次打开查手机不会重复调用 API。 */
const PHONE_GEN_LOCK = "phone_gen_lock";
function phoneGenLockBusy(){
  try{
    const o = JSON.parse(localStorage.getItem(PHONE_GEN_LOCK) || "null");
    return !!(o && o.at && Date.now() - Number(o.at) < 3 * 60 * 1000);
  }catch(e){ return false; }
}
function setPhoneGenLock(charId){
  try{ localStorage.setItem(PHONE_GEN_LOCK, JSON.stringify({ charId:String(charId || ""), at:Date.now() })); }catch(e){}
}
function clearPhoneGenLock(){
  try{ localStorage.removeItem(PHONE_GEN_LOCK); }catch(e){}
}

/* 直接单独打开 phone.html 时，生成过程中刷新/关闭页面会中断请求；
   在支持 beforeunload 的环境里给出提示。iframe 内退出由主框架保留后台帧。 */
try{
  window.addEventListener("beforeunload", function(e){
    if(!genState.running) return;
    e.preventDefault();
    e.returnValue = "手机内容正在生成，离开会中断本次生成。";
    return e.returnValue;
  });
}catch(e){}

function showGenToast(text){
  document.getElementById("genToastText").textContent = text || "正在生成手机内容…";
  document.getElementById("genToast").classList.remove("hidden");
}
function hideGenToast(){ document.getElementById("genToast").classList.add("hidden"); }
function showGenFail(msg){
  document.getElementById("genFailMsg").textContent = msg;
  document.getElementById("genFailSheet").classList.remove("hidden");
}
function hideGenFail(){ document.getElementById("genFailSheet").classList.add("hidden"); }
function isContentBlocked(s){
  return /内容被拦截|FAILED_PRECONDITION|content[\s_-]*(block|policy|filter)|safety/i.test(String(s || ""));
}

async function reRenderCurrentApp(){
  if(!appHost.classList.contains("show") || !currentAppId) return;
  try{ await renderAppById(currentAppId); }catch(e){}
}

// 把生成的钱包流水合并进角色银行卡（亲属卡「他的」共用同一份数据）
// charInfo 必须是「开始生成时」的角色快照，不能依赖 currentChar（用户可能已经返回列表）。
function mergeWalletForChar(charId, data, charInfo) {
  const key = "nano_char_wallet_" + (charId || "default");
  const info = charInfo || ((typeof currentChar !== "undefined" && currentChar) || {});
  let profile = null;
  try{
    if(window.NanoCharWealth){
      profile = NanoCharWealth.profileFor(info.setting || info.desc || "", info.name || "");
      NanoCharWealth.saveProfile(charId, profile);
    }
  }catch(e){}
  let cur = { balance: profile ? profile.balance : 5000, transactions: [], seedVersion: 2, wealthTier: profile ? profile.tier : "", wealthLabel: profile ? profile.label : "", lowFamily: profile ? !!profile.lowFamily : false, veryPoor: profile ? !!profile.veryPoor : false };
  try{
    const w = JSON.parse(localStorage.getItem(key) || "null");
    if(w && typeof w === "object"){
      if(w.seedVersion !== 2 || (profile && w.wealthTier !== profile.tier) || (profile && !!w.lowFamily !== !!profile.lowFamily) || (profile && !!w.veryPoor !== !!profile.veryPoor)){
        cur = { balance: profile ? profile.balance : (Number(w.balance) || 0), transactions: [], seedVersion: 2, wealthTier: profile ? profile.tier : "", wealthLabel: profile ? profile.label : "", lowFamily: profile ? !!profile.lowFamily : false, veryPoor: profile ? !!profile.veryPoor : false };
      }else{
        cur.balance = Number(w.balance) || 0;
        cur.transactions = Array.isArray(w.transactions) ? w.transactions : [];
        cur.seedVersion = 2;
        cur.wealthTier = w.wealthTier || "";
        cur.wealthLabel = w.wealthLabel || "";
        cur.lowFamily = !!w.lowFamily;
        cur.veryPoor = !!w.veryPoor;
        cur.balanceManual = !!w.balanceManual;
        cur.updatedAt = w.updatedAt || "";
      }
    }
  }catch(e){}
  const now = Date.now();
  let txs = [];
  (Array.isArray(data && data.transactions) ? data.transactions : []).forEach(function(t, i){
    if(!t || typeof t !== "object") return;
    const type = t.type === "income" ? "income" : "expense";
    const amount = Math.round((parseFloat(t.amount) || 0) * 100) / 100;
    if(!(amount > 0)) return;
    let time = t.time || t.date || new Date(now - i * 3600000).toISOString();
    const d = new Date(time);
    if(isNaN(d.getTime())) time = new Date(now - i * 3600000).toISOString();
    txs.push({
      id: "ctx_" + now + "_" + i + "_" + Math.random().toString(36).slice(2, 7),
      type: type,
      amount: amount,
      desc: String(t.desc || t.name || "").trim() || (type === "income" ? "收入" : "支出"),
      time: time
    });
  });
  try{ if(profile && window.NanoCharWealth) txs = NanoCharWealth.sanitizeTransactions(profile, txs, { balance: cur.balance }); }catch(e){}
  txs.sort(function(a, b){ return new Date(b.time) - new Date(a.time); });
  let net = 0;
  txs.forEach(function(t){ net += (t.type === "income" ? t.amount : -t.amount); });

  /* 余额口径：
     - 模型给了 balance：以模型的「本轮结束余额」为准（它会看到当前余额再算收支）；
     - 模型没给 balance：当前余额 + 本轮净收支；
     - 手动编辑过的余额优先保留，不再被自动按人设压回去；
     - 自动生成必须被限制在角色财富阶层的余额区间内，避免穷学生越生成越富。 */
  let balance = cur.balance + net;
  const modelBal = Number(data && data.balance);
  if(Number.isFinite(modelBal) && modelBal >= 0) balance = modelBal;
  if(cur.balanceManual){
    balance = Math.max(0, balance);
  }else if(profile && window.NanoCharWealth && NanoCharWealth.clampBalance){
    balance = NanoCharWealth.clampBalance(profile, balance);
  }else{
    balance = Math.max(0, balance);
  }
  balance = Math.round(balance * 100) / 100;

  /* 保留旧流水，再把本轮新流水接上；亲属卡 / 查手机都能看到更完整的银行流水。 */
  const seenTx = {};
  const mergedTxs = [];
  (txs.concat(cur.transactions || [])).forEach(function(t){
    if(!t || typeof t !== "object") return;
    const id = String(t.id || (t.time + "|" + t.type + "|" + t.amount + "|" + t.desc));
    if(seenTx[id]) return;
    seenTx[id] = 1;
    mergedTxs.push(t);
  });
  mergedTxs.sort(function(a, b){ return new Date(b.time) - new Date(a.time); });

  const merged = {
    balance: balance,
    transactions: mergedTxs.slice(0, 300),
    seedVersion: 2,
    wealthTier: profile ? profile.tier : "",
    wealthLabel: profile ? profile.label : "",
    lowFamily: profile ? !!profile.lowFamily : false,
    veryPoor: profile ? !!profile.veryPoor : false,
    balanceManual: !!cur.balanceManual,
    updatedAt: new Date(now).toISOString()
  };
  saveCharWallet(key, merged);
  return merged;
}

function phoneGenCharMatches(c){
  return !!(c && typeof currentChar !== "undefined" && currentChar && String(currentChar.id) === String(c.id));
}

async function startGeneration(ids){
  if(genState.running) return;
  if(phoneGenLockBusy()){
    showGenToast("正在生成中，请稍候…");
    setTimeout(hideGenToast, 1600);
    return;
  }
  ids = (ids || []).filter(Boolean);
  if(!ids.length) return;
  /* 关键：生成一开始就锁定角色快照。
     用户可以在生成过程中返回角色列表 / 退出手机页面，currentChar 会变成 null；
     后续写盘、合并钱包、刷新界面都必须用这份快照，否则整批生成会在最后一步全部失败。 */
  if(!currentChar || currentChar.id == null){ showGenToast("请先进入一个角色的手机再生成"); setTimeout(hideGenToast, 1600); return; }
  const genChar = Object.assign({}, currentChar);
  genState.running = true;
  genState.charId = genChar.id;
  setPhoneGenLock(genChar.id);
  // 慢模型可能生成好几分钟：定时续期，避免锁过期后另一个页面又开一次请求。
  const lockTimer = setInterval(() => setPhoneGenLock(genChar.id), 30000);
  /* refresh-notify.js 在 phone.js 之后加载，这里再 define 一次，
     保证生成期间退出页面时主框架能把 iframe 保留在后台继续生成。 */
  try{
    if(window.NanoRefresh){
      NanoRefresh.define({ id:'phone', name:'手机', url:'phone.html', title:'手机' });
      NanoRefresh.start({ key:'gen', label:'生成内容' });
    }
  }catch(e){}
  const api = await getApiInfo();
  if(!api){
    genState.running = false;
    clearInterval(lockTimer);
    clearPhoneGenLock();
    try{ if(window.NanoRefresh) NanoRefresh.fail("未读取到主 API 配置", { key:'gen', url:'phone:' + genChar.id }); }catch(e){}
    return;
  }
  genState.ids = ids.slice();
  genState.failed = [];
  genState.log = [];
  lastFailedIds = [];
  refreshSheet.classList.add("hidden");
  hideGenFail();

  /* 生成策略：一次点击只调用一次 API（把勾选的 App 一次性生成）。
     若网关超时 / HTTP 错误导致没生成，不再「暗自」自动拆分重试——
     改为弹出失败面板，由用户自己点「重新生成」再补，绝不在背后多扣 API。 */
  const okAll = {};
  const fatalMsgs = [];
  let wasTruncated = false;
  const partialIdSet = new Set();

  const runBatch = async (batch, label) => {
    showGenToast(label);
    let r = {ok:{}, log:[], fatal:null};
    try{
      r = await genMulti(api, genChar, batch);
    }catch(e){
      r.log.push({t:"err", s:"异常: " + ((e && e.stack) || e.message || e)});
      r.fatal = (e && e.message) || String(e);
    }

    genState.log.push({t:"sec", s:label});
    (r.log || []).forEach(l => genState.log.push(l));

    /* 内容被拦截也不再自动重试：保持一次点击只调用一次 API。
       私密缺失时用本地个人随想补齐，不消耗 API。 */
    if(batch.indexOf("private") >= 0 && !(r.ok && r.ok.private)){
      if(!r.ok) r.ok = {};
      r.ok.private = { type: "private", data: genPrivateLocal(genChar) };
      genState.log.push({t:"warn", s:"私密：已用本地个人随想补充（不消耗 API）"});
    }
    if(r.truncated) wasTruncated = true;
    (r.partialIds || []).forEach(id => partialIdSet.add(id));
    if(r.fatal) fatalMsgs.push(`${label}：${r.fatal}`);

    /* 生成完就立刻落盘：能解析出来的 App 先保存，缺失的 App 留给「继续生成」补。 */
    for(const id of Object.keys(r.ok)){
      try{
        let payload = r.ok[id];
        if(id === "wallet"){
          const merged = mergeWalletForChar(genChar.id, payload.data, genChar);
          payload = { type: "wallet", data: merged };
          r.ok[id] = payload;
        }
        // 翻译与正文一起落盘：先补齐所有可见外文的中文译文，再保存和渲染。
        try { await ensurePhoneInlineTranslations(payload && payload.data); } catch (e) {}
        await dataSet(`app_${genChar.id}_${id}`, payload);
        okAll[id] = payload;
        try{ rememberPhoneSigs(genChar.id, id, payload.data); }catch(e){}
      }
      catch(e){ genState.log.push({t:"err", s:`写入 ${id} 失败: ${e.message}`}); }
    }
    if(phoneGenCharMatches(genChar)) await reRenderCurrentApp();
    return r;
  };

  // 按你的要求：一次请求生成全部 App，不分批。
  try {
    await runBatch(ids, `正在一次生成 ${ids.length} 个 App…（可返回切换其它 App）`);
  } catch (e) {
    fatalMsgs.push('生成异常：' + ((e && e.message) || e));
  } finally {
    genState.running = false;
    clearInterval(lockTimer);
    clearPhoneGenLock();
    hideGenToast();
    if(phoneGenCharMatches(genChar)){
      try { await reRenderCurrentApp(); } catch (e) {}
    }
  }

  const failed = ids.filter(id => !okAll[id] || partialIdSet.has(id));
  genState.failed = failed;
  const retryBtn = document.getElementById("genFailRetry");
  if(!failed.length){
    if(retryBtn) retryBtn.textContent = "重新生成";
    clearPhoneGenFail(genChar.id);
    try{ if(window.NanoRefresh) NanoRefresh.success('已生成 ' + Object.keys(okAll).length + ' 个 App 的内容', { key:'gen', url:'phone:' + genChar.id, title:(genChar.name || 'TA') + ' 的手机' }); }catch(e){}
  }
  if(failed.length){
    lastFailedIds = failed;
    const all = getAppsForRefresh();
    const names = failed.map(id => { const a = all.find(x => x.id === id); return a ? a.name : id; });
    const done = Object.keys(okAll).length;
    if(retryBtn) retryBtn.textContent = done ? "继续生成" : "重新生成";
    const msg = (done ? `已保存 ${done} 个 App 的内容，未生成完的部分可以继续补。\n` : "") +
      (wasTruncated ? `本次输出达到上限被截断，已保留截断前生成的 App。\n` : "") +
      (fatalMsgs.length ? fatalMsgs.join("\n") + "\n" : "") +
      `以下 App 未生成完整：${names.join("、")}\n` +
      `可点「${done ? "继续生成" : "重新生成"}」只补失败的部分。`;
    showGenFail(msg);
    // 落盘：退出查手机后点失败通知回来，或下次进入这个角色的手机，失败面板还在。
    savePhoneGenFail(genChar.id, {
      charId: genChar.id,
      charName: genChar.name || "",
      msg: msg,
      failed: failed.slice(),
      log: genState.log.slice(),
      at: Date.now()
    });
    try{ if(window.NanoRefresh) NanoRefresh.fail('以下 App 生成失败：' + names.join('、'), { key:'gen', url:'phone:' + genChar.id, title:(genChar.name || 'TA') + ' 的手机' }); }catch(e){}
  }
}

document.getElementById("checkRunRefresh").onclick = () => {
  const selected = [...appListEl.querySelectorAll("input:checked")].map(x => x.value);
  if(!selected.length){ alert("请至少选择一个 App"); return; }
  startGeneration(selected);
};
document.getElementById("genFailRetry").onclick = () => {
  hideGenFail();
  if(lastFailedIds.length) startGeneration(lastFailedIds);
};
document.getElementById("genFailLog").onclick = () => showLogSheet(genState.log, lastFailedIds);
document.getElementById("genFailClose").onclick = () => {
  hideGenFail();
  if(currentChar) clearPhoneGenFail(currentChar.id);
};
document.getElementById("genFailSheet").addEventListener("click", e => {
  if(e.target === document.getElementById("genFailSheet")){
    hideGenFail();
    if(currentChar) clearPhoneGenFail(currentChar.id);
  }
});

function showLogSheet(log, failed){
  const body = document.getElementById("checkLogBody");
  body.innerHTML =
    `<span class="lg-sec">失败 App：</span>${failed.join("、")}\n\n` +
    log.map(l => {
      const cls = l.t === "ok" ? "lg-ok" : l.t === "err" ? "lg-err"
                : l.t === "sec" ? "lg-sec" : l.t === "warn" ? "lg-warn" : "";
      return cls ? `<span class="${cls}">${escHtml(l.s)}</span>` : escHtml(l.s);
    }).join("\n");
  document.getElementById("checkLogSheet").classList.remove("hidden");
}
document.getElementById("checkLogClose").onclick = () =>
  document.getElementById("checkLogSheet").classList.add("hidden");

/* ---------- 新 App 宿主：加载原版页面（UI 不变，仅注入数据） ---------- */
async function openHostedApp(appId, file, renderName){
  const hostCharId = (typeof currentChar !== "undefined" && currentChar) ? currentChar.id : "";
  if(!hostCharId){ showGenToast("请先进入一个角色的手机"); setTimeout(hideGenToast, 1600); return; }
  appHost.innerHTML = `<iframe class="app-frame" data-frame src="${file}" title=""></iframe>`;
  const frame = appHost.querySelector("[data-frame]");
  if(!frame) return;
  frame.addEventListener("load", async () => {
    if(!appHost.contains(frame)) return;
    // 把宿主(phone.html)从主框架拿到的安全区像素值透传给内嵌 App 的 iframe，
    // 否则豆包/淘宝/地图等顶栏会因为读不到 --safe-top 而顶进灵动岛。
    try{
      const de = frame.contentDocument && frame.contentDocument.documentElement;
      if(de){
        const cs = getComputedStyle(document.documentElement);
        const top = cs.getPropertyValue('--safe-top').trim();
        const bot = cs.getPropertyValue('--safe-bottom').trim();
        if(top) de.style.setProperty('--safe-top', top);
        if(bot) de.style.setProperty('--safe-bottom', bot);
      }
    }catch(e){}
    let data = null;
    try{ const saved = await dataGet(`app_${hostCharId}_${appId}`); data = saved ? saved.data : null; }catch(e){}
    if(!appHost.contains(frame)) return;
    /* 加载期间用户可能已经返回角色列表；此时 iframe 已被移除，不再注入旧角色数据。 */
    if(!(typeof currentChar !== "undefined" && currentChar && String(currentChar.id) === String(hostCharId))) return;
    try{
      const w = frame.contentWindow;
      w.__phoneRefresh = () => startGeneration([appId]);
      if(typeof w[renderName] === "function") w[renderName](data);
    }catch(e){}
  });
}
function openDoubao(){ return openHostedApp("doubao", "doubao.html?v=20261125b", "renderDoubaoConversation"); }
function openTaobao(){ return openHostedApp("taobao", "taobao.html", "renderCharShopping"); }
function openStore(){ return openHostedApp("store", "taobao.html", "renderCharShopping"); }
function openMapcal(){ return openHostedApp("mapcal", "mapcal.html", "renderCharMapCalendar"); }
async function openWallet(){
  const id = currentChar ? currentChar.id : "";
  const nm = currentChar ? currentChar.name : "";
  try{
    if(id && window.NanoCharWealth){
      const profile = NanoCharWealth.profileFor((currentChar && (currentChar.setting || currentChar.desc)) || "", nm);
      NanoCharWealth.saveProfile(id, profile);
      const key = "nano_char_wallet_" + id;
      let w = null;
      try{ w = JSON.parse(localStorage.getItem(key) || "null"); }catch(e){}
      if(!w && window.NanoIDB){
        try{
          const saved = await NanoIDB.get(key);
          if(saved && typeof saved === "object"){ w = saved; saveCharWallet(key, w); }
        }catch(e){}
      }
      if(!w || w.seedVersion !== 2 || w.wealthTier !== profile.tier || !!w.lowFamily !== !!profile.lowFamily || !!w.veryPoor !== !!profile.veryPoor){
        let seedTxs = [];
        try{ seedTxs = NanoCharWealth.randomWalletTransactions(profile, 10, nm, { balance: profile.balance }); }catch(e){}
        saveCharWallet(key, {
          balance: profile.balance, transactions: seedTxs, seedVersion: 2,
          wealthTier: profile.tier, wealthLabel: profile.label, lowFamily: !!profile.lowFamily, veryPoor: !!profile.veryPoor, balanceManual: false
        });
      }else{
        let changed = false;
        if(!w.balanceManual && NanoCharWealth.clampBalance){
          const fixed = NanoCharWealth.clampBalance(profile, w.balance);
          if(fixed !== w.balance){ w.balance = fixed; changed = true; }
        }
        if(!Array.isArray(w.transactions) || !w.transactions.length){
          try{ w.transactions = NanoCharWealth.randomWalletTransactions(profile, 10, nm, { balance: w.balance }); changed = true; }catch(e){}
        }
        if(changed){ w.balanceRange = profile.balanceRange || w.balanceRange; saveCharWallet(key, w); }
      }
    }
  }catch(e){}
  return openHostedApp("wallet", "phone-wallet.html?chat=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(nm), "renderCharWallet");
}

/* Share配置：内嵌在本 App 内，返回时回到「设置」而不是退出手机 */
async function openScreenSetup(){
  currentAppId = "screensetup";
  const url = "ios-setting.html?chat=" + encodeURIComponent(currentChar.id) + "&name=" + encodeURIComponent(currentChar.name || "");
  appHost.innerHTML = `<iframe class="app-frame" data-frame src="${url}" title=""></iframe>`;
  const frame = appHost.querySelector("[data-frame]");
  if(!frame) return;
  frame.addEventListener("load", () => {
    if(!appHost.contains(frame)) return;
    // 透传安全区像素值，避免内页顶栏顶进灵动岛
    try{
      const de = frame.contentDocument && frame.contentDocument.documentElement;
      if(de){
        const cs = getComputedStyle(document.documentElement);
        const top = cs.getPropertyValue("--safe-top").trim();
        const bot = cs.getPropertyValue("--safe-bottom").trim();
        if(top) de.style.setProperty("--safe-top", top);
        if(bot) de.style.setProperty("--safe-bottom", bot);
      }
    }catch(e){}
  });
}

/* 子页面点返回时关闭当前 App */
window.addEventListener("message", e => {
  const d = e && e.data;
  if(d && d.type === "phoneAppClose") closeApp();
  else if(d && d.type === "screenSetupClose"){ try{ openSettings(); }catch(err){} }
  else if(d && d.type === "phoneAppRefresh"){ try{ startGeneration([d.appId || currentAppId || "wallet"]); }catch(err){} }
  else if(d && d.type === "nanoOverlayReopen"){
    // 复用的缓存页重新显示时刷新角色列表，避免刚新增/删除角色后还显示旧数据。
    try{ renderChars(); updateHomeWidgets(); }catch(err){}
  }
  else if(d && d.type === "startScreenShare"){
    // Share页嵌在「查手机」里时，把共享请求继续交给外壳
    try{
      if(window.parent && window.parent !== window) window.parent.postMessage(d, "*");
      else if(window.ScreenShare && window.ScreenShare.start) window.ScreenShare.start({ id:d.charId, name:d.charName, avatar:d.avatar });
    }catch(err){}
  }
});

/* App 路由 */
async function renderAppById(appId){
  if(appId === "video")        await openVideoList();
  else if(appId === "diary")   await openDiary();
  else if(appId === "album")   await openAlbum();
  else if(appId === "mail")    await openMail();
  else if(appId === "memo")    await openMemo();
  else if(appId === "health")  await openHealth();
  else if(appId === "browser") await openBrowser();
  else if(appId === "game")    await openGame();
  else if(appId === "private") await openPrivate();
  else if(appId === "chat")    await openChat();
  else if(appId === "doubao")  await openDoubao();
  else if(appId === "taobao")  await openTaobao();
  else if(appId === "store")   await openStore();
  else if(appId === "mapcal")  await openMapcal();
  else if(appId === "wallet")  await openWallet();
  else if(appId === "settings") await openSettings();
}

let _lastPhoneAppOpen = { id: "", at: 0 };
async function openApp(appId){
  const _now = Date.now();
  if (appHost.classList.contains("show") && currentAppId === appId && _now - _lastPhoneAppOpen.at < 700) return;
  _lastPhoneAppOpen = { id: appId, at: _now };
  currentAppId = appId;
  appHost.innerHTML = "";
  appHost.classList.add("show");
  await renderAppById(appId);
  /* 正在生成该 App 时，把空态提示换成「正在生成…」 */
  if(genState.running && genState.ids.includes(appId)){
    appHost.querySelectorAll(".app-empty").forEach(el => { el.textContent = "正在生成…"; });
  }
}

document.querySelectorAll('#phoneHome .app[data-app], #phoneHome .dock-slot[data-app]').forEach(el => {
  el.addEventListener("click", e => {
    if(el.dataset.justDragged === "1"){ el.dataset.justDragged = "0"; return; }
    const id = el.dataset.app;
    if(["video","diary","album","mail","memo","health","browser","game","private","chat","doubao","taobao","store","mapcal","wallet","settings"].includes(id)){
      e.preventDefault();
      e.stopPropagation();
      openApp(id);
    }
  }, true);
});

renderChars();
updateHomeWidgets();