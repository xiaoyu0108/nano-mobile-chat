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

/* =========================
   2. 主屏：时钟
========================= */
(function initClock(){
  const timeEl = document.getElementById("clockTime");
  const dateEl = document.getElementById("clockDate");
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
   5. 主屏：长按拖动 + 自由换位（两屏都支持）
   - 1×1 App：和另一个 App 交换，或拖到空格
   - 2×2 小组件：和另一个小组件交换，或拖到空位
   - 拖到屏幕边缘可翻到另一屏
========================= */
(function initDrag(){
  const pagesEl = document.getElementById("homePages");
  const grids = [...document.querySelectorAll(".layout")].filter(g => g.querySelector(".app, .widget-large"));
  const hint = document.getElementById("moveHint");
  if(!grids.length) return;

  const LAYOUT_KEY = "glass_phone_layout_v8";
  const MAX_COL = 4, MAX_ROW = 4;
  let active = null, placeholder = null, timer = null;
  let longPressed = false, startX = 0, startY = 0, offsetX = 0, offsetY = 0, pointerId = null;
  let origin = null, dropTarget = null, edgeDir = 0, edgeTimer = null;

  function clearPress(){ if(timer){ clearTimeout(timer); timer = null; } }
  function showHint(){
    if(!hint) return;
    hint.classList.add("show");
    clearTimeout(showHint.t);
    showHint.t = setTimeout(() => hint.classList.remove("show"), 1300);
  }
  function clamp(n, min, max){ return n < min ? min : (n > max ? max : n); }
  function itemsIn(grid){ return [...grid.querySelectorAll(".app, .widget-large")]; }
  function spanValue(endVal, start){
    const s = String(endVal || '');
    const m = s.match(/span\s+(\d+)/i);
    if(m) return Math.max(1, parseInt(m[1], 10) || 1);
    const n = parseInt(s, 10);
    if(Number.isFinite(n) && n > start) return n - start;
    return 1;
  }
  function cellOf(el){
    const cs = getComputedStyle(el);
    const c1 = parseInt(cs.gridColumnStart, 10) || 1;
    const r1 = parseInt(cs.gridRowStart, 10) || 1;
    return {
      c: c1 - 1,
      r: r1 - 1,
      w: spanValue(cs.gridColumnEnd, c1),
      h: spanValue(cs.gridRowEnd, r1)
    };
  }
  function setCell(el, cell){
    el.style.gridColumn = (cell.c + 1) + " / span " + cell.w;
    el.style.gridRow = (cell.r + 1) + " / span " + cell.h;
  }
  function overlap(a, b){
    return a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
  }
  function occupantAt(grid, cell, exclude){
    for(const el of itemsIn(grid)){
      if(el === active || el === placeholder || el === exclude) continue;
      if(overlap(cellOf(el), cell)) return el;
    }
    return null;
  }
  function findFreeCell(grid, w, h, pc, pr){
    let best = null, bestD = Infinity;
    for(let r = 0; r <= MAX_ROW - h; r++){
      for(let c = 0; c <= MAX_COL - w; c++){
        const cell = { c, r, w, h };
        if(occupantAt(grid, cell, null)) continue;
        const d = Math.abs(c - pc) + Math.abs(r - pr);
        if(d < bestD){ bestD = d; best = cell; }
      }
    }
    return best;
  }
  function gridAt(x, y){
    for(const g of grids){
      const r = g.getBoundingClientRect();
      if(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return g;
    }
    return null;
  }
  function cellFromPoint(grid, x, y, w, h){
    const cs = getComputedStyle(grid);
    const gapX = parseFloat(cs.columnGap) || 0;
    const gapY = parseFloat(cs.rowGap) || 0;
    const r = grid.getBoundingClientRect();
    const cw = (r.width - gapX * (MAX_COL - 1)) / MAX_COL;
    const ch = (r.height - gapY * (MAX_ROW - 1)) / MAX_ROW;
    const c = clamp(Math.floor((x - r.left) / (cw + gapX)), 0, MAX_COL - w);
    const row = clamp(Math.floor((y - r.top) / (ch + gapY)), 0, MAX_ROW - h);
    return { c, r: row, w, h };
  }
  function clearDropMarks(){
    document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
  }
  function resetPlaceholder(){
    if(!placeholder || !origin) return;
    if(placeholder.parentElement !== origin.grid) origin.grid.appendChild(placeholder);
    setCell(placeholder, origin.cell);
  }

  function beginDrag(el, x, y){
    if(active) return;
    active = el;
    longPressed = true;
    const r = active.getBoundingClientRect();
    offsetX = x - r.left - r.width / 2;
    offsetY = y - r.top - r.height / 2;
    origin = { grid: active.parentElement, cell: cellOf(active) };

    placeholder = document.createElement("div");
    placeholder.className = active.classList.contains("widget-large") ? "widget-large placeholder" : "app placeholder";
    setCell(placeholder, origin.cell);
    origin.grid.appendChild(placeholder);

    active.classList.add("dragging");
    active.style.position = "fixed";
    active.style.width = r.width + "px";
    active.style.height = r.height + "px";
    active.style.left = (x - r.width / 2 - offsetX) + "px";
    active.style.top = (y - r.height / 2 - offsetY) + "px";
    active.style.margin = "0";
    active.style.pointerEvents = "none";
    document.body.appendChild(active);
    showHint();
  }

  function moveDrag(x, y){
    if(!active) return;
    active.style.left = (x - active.offsetWidth / 2 - offsetX) + "px";
    active.style.top = (y - active.offsetHeight / 2 - offsetY) + "px";
    checkEdge(x);

    const grid = gridAt(x, y);
    clearDropMarks();
    dropTarget = null;
    if(!grid){ resetPlaceholder(); return; }

    const size = origin.cell;
    const cell = cellFromPoint(grid, x, y, size.w, size.h);
    const hit = occupantAt(grid, cell, null);

    if(hit && cellOf(hit).w === size.w && cellOf(hit).h === size.h){
      dropTarget = { grid, cell: cellOf(hit), swapEl: hit };
      hit.classList.add("drop-target");
      if(placeholder.parentElement !== grid) grid.appendChild(placeholder);
      setCell(placeholder, cellOf(hit));
      return;
    }
    if(hit){
      const free = findFreeCell(grid, size.w, size.h, cell.c, cell.r);
      if(free){
        dropTarget = { grid, cell: free, swapEl: null };
        if(placeholder.parentElement !== grid) grid.appendChild(placeholder);
        setCell(placeholder, free);
      } else resetPlaceholder();
      return;
    }
    dropTarget = { grid, cell, swapEl: null };
    if(placeholder.parentElement !== grid) grid.appendChild(placeholder);
    setCell(placeholder, cell);
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

  function clearDragStyles(el){
    el.classList.remove("dragging");
    el.style.position = "";
    el.style.width = "";
    el.style.height = "";
    el.style.left = "";
    el.style.top = "";
    el.style.margin = "";
    el.style.pointerEvents = "";
  }

  function endDrag(apply){
    clearPress();
    clearTimeout(edgeTimer); edgeDir = 0;
    if(!active) return;
    const el = active;
    const target = apply ? dropTarget : null;
    clearDropMarks();

    if(target){
      const src = origin;
      if(target.swapEl){
        const other = target.swapEl;
        setCell(other, src.cell);
        if(other.parentElement !== src.grid) src.grid.appendChild(other);
      }
      setCell(el, target.cell);
      if(el.parentElement !== target.grid) target.grid.appendChild(el);
    } else {
      resetPlaceholder();
      setCell(el, origin.cell);
      if(el.parentElement !== origin.grid) origin.grid.appendChild(el);
    }
    if(placeholder) placeholder.remove();
    clearDragStyles(el);
    active = null; placeholder = null; origin = null; dropTarget = null;
    saveLayout();
    setTimeout(() => { longPressed = false; }, 80);
  }

  function cancelPress(){ clearPress(); if(active) endDrag(false); }

  function saveLayout(){
    const map = {};
    grids.forEach((grid, gi) => {
      itemsIn(grid).forEach(el => {
        if(el.classList.contains("placeholder") || !el.dataset.app) return;
        const c = cellOf(el);
        map[el.dataset.app] = { g: gi, c: c.c, r: c.r, w: c.w, h: c.h };
      });
    });
    try{ localStorage.setItem(LAYOUT_KEY, JSON.stringify(map)); }catch(e){}
  }
  function restoreLayout(){
    let map = {};
    try{ map = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") || {}; }catch(e){ map = {}; }
    const occ = grids.map(() => []);
    grids.forEach((grid, gi) => {
      itemsIn(grid).forEach(el => {
        const s = el.dataset.app && map[el.dataset.app];
        if(!s || !Number.isFinite(s.g) || !grids[s.g]) return;
        const tg = grids[s.g];
        const isWidget = el.classList.contains("widget-large");
        const w = isWidget ? 2 : 1;
        const h = isWidget ? 2 : 1;
        const cell = { c: clamp(s.c, 0, MAX_COL - w), r: clamp(s.r, 0, MAX_ROW - h), w: w, h: h };
        if(cell.c + cell.w > MAX_COL || cell.r + cell.h > MAX_ROW) return;
        if(occ[s.g].some(o => overlap(o, cell))) return;
        if(el.parentElement !== tg) tg.appendChild(el);
        setCell(el, cell);
        occ[s.g].push(cell);
      });
    });
  }

  grids.forEach(grid => {
    itemsIn(grid).forEach(item => {
      item.addEventListener("contextmenu", e => e.preventDefault());
      item.addEventListener("pointerdown", e => {
        if(e.button !== undefined && e.button !== 0) return;
        if(e.target && e.target.closest && e.target.closest('[contenteditable="true"],input,textarea')) return;
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

  restoreLayout();
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
    if(v) return v;
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
  }));
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
    return u.toString();
  }catch(e){ return rawUrl; }
}
function buildChatEndpoint(rawUrl){
  let s = resolveApiHost(String(rawUrl || "").trim().replace(/\/+$/, ""));
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
    try{ const t = await r.text(); if(t) detail = "：" + t.slice(0, 200); }catch(e){}
    throw new Error("HTTP " + r.status + detail);
  }
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content || d?.choices?.[0]?.text || d?.output_text;
  if(!text) throw new Error("API 返回没有文本内容");
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

const SYS_JSON = "你是虚构角色的手机数据生成器。内容面向成年读者，属于虚构创作；成人向内容不限角色，可以自然包含成人向的情感、暧昧、亲密与性相关内容，不必刻意回避。禁止血腥暴力和违法内容。所有内容必须严格贴合给定的人设、世界书与记忆库，不要脱离角色自由发挥。只输出用户要求的 JSON，不要输出任何解释、markdown 代码块或多余文字。\n【语言规则】所有内容必须让中文用户看得懂：默认用简体中文；如果角色是外国人、内容本身是韩语/英语/日语等外语，必须在原文后面用「（中文：……）」附上简体中文翻译，绝不能只输出外文。";


/* 通用的「贴合人设」硬性约束 */
const PERSONA_RULE = "硬性要求：所有内容必须贴合上面的角色设定、世界书设定与记忆库，符合角色的身份、性格、说话方式、社交圈、作息与近期经历；不得出现与角色无关的通用模板内容；不同角色的内容必须明显不同。内容要自然与「用户」产生关联：每个 App 至少有 1-2 条自然涉及用户（用用户的名字、与用户共同经历的事、用户说过的话，或直接从记忆库取材），但不要每条都硬提用户，保持自然。\n【反雷同】每次生成都要换新的场景、时间、物件、话术与结构，避免反复套用同一批句式或套路；避免千篇一律的空泛描写。\n【自然表达】称呼与用词要自然、克制、有具体质感，避免过度亲昵或模板化。";

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
    const isGlobal = (f.scope || "global") === "global";
    const isLocalBound = (f.scope === "local") && (
      (Array.isArray(f.boundCharacters) && f.boundCharacters.includes(charId)) || bindIds.has(f.id)
    );
    if(!isGlobal && !isLocalBound) return;
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
  const db = await openMemoryDB();
  if(!db) return (mergedList||[]).map(it => String(it&&(it.content||it.text)||'').trim()).filter(Boolean).slice(-16);
  return new Promise(resolve => {
    const out = [];
    const push = t => { t = String(t || "").trim(); if(t && out.indexOf(t) < 0) out.push(t); };
    try{
      const tx = db.transaction(["config","memories"], "readonly");
      const rc = tx.objectStore("config").get("memlist_" + id);
      rc.onsuccess = () => {
        const list = (mergedList != null) ? mergedList : ((rc.result && Array.isArray(rc.result.value)) ? rc.result.value : []);
        list.forEach(it => push(it && (it.content || it.text)));
      };
      try{
        const rm = tx.objectStore("memories").index("chatId").getAll(id);
        rm.onsuccess = () => (rm.result || []).forEach(it => push(it && (it.content || it.text)));
      }catch(e){}
      tx.oncomplete = () => { try{ db.close(); }catch(e){} resolve(out.slice(-16)); };
      tx.onerror = () => { try{ db.close(); }catch(e){} resolve(out.slice(-16)); };
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
  const bad = /(裸体|裸照|强奸|幼女|正太|血腥|肢解|自残|自杀|毒品|犯罪|虐待|)/i;
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

请生成 3 条「${char.name}」的 B 站观看历史。
要求：
1. 标题像真实 B 站视频标题（可含「」、疑问句、数字），与角色兴趣强相关。
2. 每条包含：
   - title: 视频标题（15-40 字）
   - up: UP 主名称（3-12 字）
   - date: 观看时间，格式 "2026年8月12日 11:23"
   - duration: 视频总时长，格式 "01:42" 或 "10:00"
   - progress: 观看进度，格式 "00:03"（小于 duration）
   - desc: 视频简介（25-60 字）
只输出 JSON 数组，形如 [{"title":"...","up":"...","date":"...","duration":"...","progress":"...","desc":"..."}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("视频数据格式错误");
  return a.slice(0, 3);
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

请生成 4 条「${char.name}」图库照片的文字描述，按顺序：
- 第 1-2 条：日常（日常片段、心情、看到的景色）
- 第 3 条：私密（只有角色自己知道的小事、独处时的状态）
- 第 4 条：不为人说（角色不愿对别人说的隐秘念头，克制、点到为止）
要求：
1. 每条 8-25 字，像照片上的一行字，有画面感、贴合角色。
2. 4 条不要重复。
只输出 JSON 数组，形如 [{"text":"..."}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("图库数据格式错误");
  return a.slice(0, 4);
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
   - body: 正文段落数组（2-3 段）
只输出 JSON 数组，形如 [{"sender":"...","date":"...","subject":"...","preview":"...","icon":"person","unread":false,"title":"...","body":["...","..."]}]`;
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
只输出 JSON 对象，形如 {"steps":{"total":8426,"goal":10000,"hours":[...]},"distance":{"total":"5.80","kcal":318},"sleep":{"score":92,"duration":"8小时12分","deep":"1h 48m","weekly":[...]},"screen":{"hours":3,"minutes":46,"weekly":[...]}}`;
  const t = await callAPI(api, SYS_JSON, user);
  const o = extractJSON(t);
  if(!o || !o.steps) throw new Error("健康数据格式错误");
  return o;
}

async function genBrowser(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的浏览器记录生成器。
${ctx}

${PERSONA_RULE}

请生成 4-5 条「${char.name}」的浏览器搜索/访问记录。
要求：
1. 内容符合角色兴趣与生活，可包含 1 条角色私下查过的日常问题。
2. 网址像真实域名。
3. 字段：
   - keyword: 搜索词或页面标题（显示在列表第一行）
   - url: 网址
   - site: 网站名（如 "NANO JOURNAL"）
   - title: 网页标题（详情页大标题）
   - time: 完整时间，如 "今天 22:06"
   - visits: 访问次数（整数）
   - intro: 页面摘要（40-80 字）
   - quote: 页面引用句（15-40 字）
   - points: 3 条要点字符串数组
只输出 JSON 数组，形如 [{"keyword":"...","url":"...","site":"...","title":"...","time":"...","visits":3,"intro":"...","quote":"...","points":["..."]}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("浏览器数据格式错误");
  return a.slice(0, 5);
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

请整理 4 条「${char.name}」不为人说的私事，贴合其人设与经历。
要求：
1. 角色可以写不愿公开的亲密关系、欲望与性相关的私事，语气自然，不要刻意回避。
2. 每条包含：
   - type: 序号，如 "PRIVATE / 01"
   - time: 时间，如 "23:41"
   - title: 标题（6-14 字）
   - preview: 一句隐晦的概述（15-30 字，第一人称）
   - detail: 不为人说的具体内容（20-60 字）
   - tags: 2 个短标签数组，如 ["心事","私密"]
   - level: "轻" 或 "中"（默认 "轻"）
只输出 JSON 数组，形如 [{"type":"PRIVATE / 01","time":"23:41","title":"...","preview":"...","detail":"...","tags":["心事","私密"],"level":"轻"}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("私密数据格式错误");
  return a.slice(0, 6);
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
  const shuffled = pool.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 4);
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
      detail: it.detail,
      tags: it.tags,
      level: "轻"
    };
  });
}

async function genChat(api, char){
  const ctx = await buildCharContext(char);
  const user = `你是「${char.name}」的聊天 App 数据生成器。
${ctx}

${PERSONA_RULE}

请生成 3 个「${char.name}」与 NPC 的聊天会话（不要生成和用户本人的会话）。
要求：
1. 3 个聊天对象是不同的 NPC（家人、朋友、同事、暗恋对象、陌生人等），必须符合角色的社交圈与世界观。
2. 每个会话 5-8 条聊天记录，有来有回，语气贴合各自身份。
3. 字段：
   - name: NPC 名字（2-8 字）
   - lastMsg: 最后一条消息（列表预览）
   - time: 最后消息时间，如 "昨天 22:13"、"8月27日"
   - unread: 未读数量（0-5 整数）
   - messages: 消息数组，每条 {"side":"left"|"right","text":"..."}
     - left = NPC 发的，right = 角色自己发的
只输出 JSON 数组，形如 [{"name":"...","lastMsg":"...","time":"...","unread":0,"messages":[{"side":"left","text":"..."}]}]`;
  const t = await callAPI(api, SYS_JSON, user);
  const a = extractJSON(t);
  if(!Array.isArray(a) || !a.length) throw new Error("聊天数据格式错误");
  return a.slice(0, 3);
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
    card.innerHTML = `
      <div class="vd-thumb">
        <div class="vd-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
        <div class="vd-duration">${escHtml(v.progress || "00:00")} / ${escHtml(v.duration || "00:00")}</div>
      </div>
      <div class="vd-info">
        <div class="vd-title">${escHtml(v.title)}</div>
        <div class="vd-up">${escHtml(v.up)}</div>
        <div class="vd-date">${escHtml(v.date)}</div>
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
    await dataSet(`app_${currentChar.id}_video`, {type:"video", data});
    renderVideoList(data);
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openVideoDetail(v){
  appHost.querySelector("[data-dtitle]").textContent = v.title || "";
  appHost.querySelector("[data-dmeta]").textContent = (v.up || "") + " · " + (v.date || "");
  appHost.querySelector("[data-ddesc]").textContent = v.desc || "";
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
      <div class="ab-grid" data-grid></div>
    </main>
    <div class="ab-viewer" data-viewer>
      <div class="ab-viewer-nav">
        <button class="ab-close" data-close><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <div></div>
      </div>
      <div class="ab-viewer-body"><div class="ab-viewer-card" data-viewer-card></div></div>
      <div class="ab-viewer-foot">照片</div>
    </div>
  </div>`;
  appHost.querySelector("[data-back]").onclick = closeApp;
  appHost.querySelector("[data-refresh]").onclick = () => startGeneration(["album"]);
  appHost.querySelector("[data-close]").onclick = () => appHost.querySelector("[data-viewer]").classList.remove("open");
  const saved = await dataGet(`app_${currentChar.id}_album`);
  renderAlbumGrid(saved?.data || []);
}
function renderAlbumGrid(photos){
  const grid = appHost.querySelector("[data-grid]");
  const count = appHost.querySelector("[data-count]");
  count.textContent = photos.length + " 张";
  grid.innerHTML = "";
  if(!photos.length){
    grid.innerHTML = `<div class="app-empty" style="grid-column:1/-1">暂无照片，点右上角刷新生成</div>`;
    return;
  }
  photos.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "ab-photo";
    card.style.background = AB_GRADIENTS[i % AB_GRADIENTS.length];
    const kind = i < 2 ? "日常" : i < 4 ? "私密" : "不为人说";
    card.innerHTML = `<div class="ab-photo-text">${escHtml(p.text)}</div><div class="ab-photo-tag">${kind}</div>`;
    card.onclick = () => openAlbumViewer(p.text, i);
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
    await dataSet(`app_${currentChar.id}_album`, {type:"album", data});
    renderAlbumGrid(data);
  }catch(e){
    if(grid) grid.innerHTML = `<div class="app-error" style="grid-column:1/-1">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openAlbumViewer(text, i){
  const card = appHost.querySelector("[data-viewer-card]");
  card.style.background = AB_GRADIENTS[i % AB_GRADIENTS.length];
  card.textContent = text;
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
    await dataSet(`app_${currentChar.id}_mail`, {type:"mail", data});
    renderMailList(data);
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openMailDetail(m){
  const body = Array.isArray(m.body) ? m.body : [m.body || ""];
  appHost.querySelector("[data-dtitle]").textContent = m.title || m.subject || "";
  appHost.querySelector("[data-dsender]").textContent = m.sender || "";
  appHost.querySelector("[data-dbody]").innerHTML = body.map(p => `<p>${escHtml(p)}</p>`).join("");
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
      <div class="bw-heading"><h2>搜索记录</h2><span data-count>0 条</span></div>
      <div class="bw-records" data-list></div>
    </main>
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
  renderBrowserList(saved?.data || []);
}
function renderBrowserList(items){
  const list = appHost.querySelector("[data-list]");
  const count = appHost.querySelector("[data-count]");
  count.textContent = items.length + " 条";
  list.innerHTML = "";
  if(!items.length){
    list.innerHTML = `<div class="app-empty">暂无搜索记录，点右上角刷新生成</div>`;
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
    const data = await genBrowser(api, currentChar);
    await dataSet(`app_${currentChar.id}_browser`, {type:"browser", data});
    renderBrowserList(data);
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
  appHost.querySelector("[data-dcontent]").innerHTML = `
    <h4>页面内容</h4>
    <p>${escHtml(it.intro || "")}</p>
    ${it.quote ? `<div class="quote">${escHtml(it.quote)}</div>` : ""}
    ${points.length ? `<p>页面摘要：</p><ul>${points.map(x => `<li>${escHtml(x)}</li>`).join("")}</ul>` : ""}`;
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
  return {text: last.transcript || last.text || "", time: last.time || chatTimeLabel(last)};
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

  chatUserRemark = (await dataGet(`app_${currentChar.id}_chat_remark_user`)) || "";
  chatUserAvatar = await loadUserAvatar();
  const saved = await dataGet(`app_${currentChar.id}_chat`);
  const userMsgs = await loadUserChatMessages();
  renderChatList(saved?.data || [], userMsgs);
}
async function reloadChatList(){
  const saved = await dataGet(`app_${currentChar.id}_chat`);
  renderChatList(saved?.data || [], await loadUserChatMessages());
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
    </div>`;
  const uConv = {id: USER_CONV_ID, name: nick, avatar: uAv, messages: userMsgs || [], isUser: true};
  uRow.onclick = () => openChatDetail(uConv);
  list.appendChild(uRow);

  (chats || []).forEach(c => {
    const row = document.createElement("div");
    row.className = "ct-item";
    row.innerHTML = `
      <div class="ct-avatar">${escHtml(String(c.name || "?").slice(0,1))}</div>
      <div class="ct-main">
        <div class="ct-name">${escHtml(c.name || "")}</div>
        <div class="ct-last">${escHtml(c.lastMsg || "")}</div>
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
    await dataSet(`app_${currentChar.id}_chat`, {type:"chat", data});
    renderChatList(data, await loadUserChatMessages());
  }catch(e){
    if(list) list.innerHTML = `<div class="app-error">生成失败：${escHtml(e.message)}</div>`;
  }
}
function openChatDetail(c){
  const isUser = !!c.isUser;
  currentConv = c;
  appHost.querySelector("[data-dtitle]").textContent = c.name || "";
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
      wrap.className = "ct-msg" + (isRight ? " right" : "");
      /* right = 手机主人 char；left = 对方（user 或 NPC） */
      const showAv = isRight ? !!charAv : (isUser && !!c.avatar);
      const avUrl = isRight ? charAv : (isUser ? c.avatar : "");
      const avStyle = showAv ? ` style="background-image:url('${escHtml(String(avUrl).replace(/'/g, "%27"))}')"` : "";
      /* 有头像时不渲染首字，避免字母压在图片上 */
      const avTxt = showAv ? "" : (isRight ? charInit : escHtml(String(c.name || "?").slice(0,1)));
      wrap.innerHTML = `<div class="ct-msg-avatar"${avStyle}>${avTxt}</div><div class="ct-msg-bubble">${escHtml(m.text || "")}</div>`;
      box.appendChild(wrap);
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
            <div class="st-btn-sub">电脑上一键共享整个屏幕，TA 每 30 秒点评一次（需能识图的模型）</div>
          </div>
          <svg class="st-btn-chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
        </button>
      </div>

      <div class="st-row">
        <button class="st-btn" data-act="ios-screen">
          <div>
            <div class="st-btn-title">iOS 快捷指令 · 窥屏</div>
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
async function buildAppShareText(appId){
  const app = SETTINGS_APPS.find(a => a.id === appId);
  const label = app ? app.name : appId;
  let text = "";
  try { const saved = await dataGet(`app_${currentChar.id}_${appId}`); text = saved ? JSON.stringify(saved.data, null, 1) : ""; } catch(e){}
  if(!text || text === "null") text = "（这个 App 还没有生成内容）";
  if(text.length > 4000) text = text.slice(0, 4000) + "\n…（已截断）";
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
    <div style="font-size:12px;color:#8e8e93;margin-bottom:10px">勾选要分享的 App，TA 会在聊天里收到并和你讨论</div>
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
}
function leaveChar(){
  innerTop.style.display = "none";
  phoneHome.style.display = "grid";
  selectPage.classList.remove("hidden");
  currentChar = null;
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

const NON_REFRESH_APPS = ["settings","widget_polaroid","chat_widget"];

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
  video:`"video":[{"title":"视频标题","up":"UP主","date":"2026年8月12日 11:23","duration":"01:42","progress":"00:03","desc":"简介"}]`,
  diary:`"diary":[{"date":"2026 · 08 · 28","name":"标题","day":"星期五","weather":"晴","content":"正文"}]`,
  album:`"album":[{"text":"照片文字"}]`,
  mail:`"mail":[{"sender":"发件人","date":"8月27日","subject":"标题","preview":"预览","icon":"person","unread":false,"title":"正文标题","body":["段落一","段落二"]}]`,
  memo:`"memo":[{"group":"过去 7 天","items":[{"title":"标题","meta":"日期 · 摘要","content":"正文"}]}]`,
  health:`"health":{"steps":{"total":8426,"goal":10000,"hours":[24个整数]},"distance":{"total":"5.80","kcal":318},"sleep":{"score":92,"duration":"8小时12分","deep":"1h 48m","weekly":[7个0-100]},"screen":{"hours":3,"minutes":46,"weekly":[7个整数分钟]}}`,
  browser:`"browser":[{"keyword":"搜索词","url":"https://example.com/a","site":"网站名","title":"网页标题","time":"今天 22:06","visits":3,"intro":"页面摘要","quote":"引用句","points":["要点一","要点二","要点三"]}]`,
  game:`"game":[{"name":"中文游戏名","id":"4827 1936","winRate":68,"matches":327,"wins":222,"losses":105,"rank":"大师","rating":2847,"rankMark":"III","recent":[{"result":"W","mode":"排位赛","time":"今天 · 21:42","kda":"18 / 6 / 11"}],"habit":"隐藏游戏习惯","weekly":[35,55,43,75,100,67,46]}]`,
  private:`"private":[{"type":"PRIVATE / 01","time":"23:41","title":"标题","preview":"一句隐晦的概述","detail":"不为人说的具体内容","tags":["心事","私密"],"level":"轻"}]`,
  chat:`"chat":[{"name":"NPC名字","lastMsg":"最后一条","time":"昨天 22:13","unread":0,"messages":[{"side":"left","text":"消息"}]}]`,
  doubao:`"doubao":[{"role":"char","content":"角色问豆包的问题"},{"role":"ai","content":"豆包的回答"}]`,
  taobao:`"taobao":{"cart":[{"name":"商品名","shop":"店铺","spec":"规格","price":"129"}],"orders":[{"shop":"店铺","name":"商品名","spec":"规格","price":"129","status":"交易成功","time":"8月27日"}],"food":[{"restaurant":"店名","dish":"菜品","price":"26.8","status":"已送达","time":"今天 12:18"}]}`,
  store:`"store":{"cart":[{"name":"商品名","shop":"店铺","spec":"规格","price":"129"}],"orders":[{"shop":"店铺","name":"商品名","spec":"规格","price":"129","status":"交易成功","time":"8月27日"}],"food":[{"restaurant":"店名","dish":"菜品","price":"26.8","status":"已送达","time":"今天 12:18"}]}`,
  mapcal:`"mapcal":{"places":[{"name":"地点名","address":"地址或区域","time":"今天 14:20","note":"搜索或导航备注"}],"events":[{"date":"10月4日","day":"星期六","time":"15:30","title":"安排标题","info":"地点或说明","tag":"工作"}]}`,
  wallet:`"wallet":{"balance":12800.5,"transactions":[{"type":"expense","desc":"星巴克","amount":32,"time":"2026-10-24T10:15:00"},{"type":"income","desc":"工资入账","amount":12800,"time":"2026-10-23T08:00:00"}]}`
};
const MULTI_COUNT = {
  video:"video 3 条", diary:"diary 3 篇", album:"album 5 条", mail:"mail 4 封",
  memo:"memo 约 4 条（分 2-3 组，每组 1-2 条）", browser:"browser 4 条", game:"game 2 个",
  private:"private 4 条不为人说的私事 / 心事（成人角色可含亲密关系）", chat:"chat 3 个会话（每个 5-8 条消息）",
  doubao:"doubao 8-10 条消息（char 与 ai 交替，构成一次完整对话）",
  taobao:"taobao：cart 2-3 件、orders 2-3 单、food 2-3 单",
  store:"store：cart 2-3 件、orders 2-3 单、food 2-3 单",
  mapcal:"mapcal：places 3 个、events 4 条",
  wallet:"wallet：transactions 10 条左右（收入 2-3 条、支出 7-8 条），balance 为余额"
};

function buildMultiPrompt(ids, char, ctx){
  const need = ids.filter(id => MULTI_SPEC[id]).map(id => MULTI_SPEC[id]).join(",\n  ");
  const counts = ids.filter(id => MULTI_COUNT[id]).map(id => MULTI_COUNT[id]).join("；");
  const matureLine = "【成人向】内容面向成年读者，成人向内容不限角色；禁止血腥暴力和违法内容。\n";
  let walletContext = "";
  if(ids.includes("wallet")){
    let w = null;
    try{ w = JSON.parse(localStorage.getItem("nano_char_wallet_" + (char && char.id || "")) || "null"); }catch(e){}
    const bal = (w && typeof w.balance === "number") ? w.balance : 20000;
    const recent = (w && Array.isArray(w.transactions) && w.transactions.length)
      ? w.transactions.slice(0, 5).map(t => (t.type === "income" ? "+" : "-") + "¥" + t.amount + " " + (t.desc || "") + " " + (t.time || "")).join("\n")
      : "（暂无）";
    walletContext = `\n【当前银行卡余额】¥${bal}\n【最近流水】\n${recent}\nwallet 的 balance 必须等于当前余额 + 收入合计 - 支出合计；流水时间在最近 7 天内，按从新到旧排列；收入 2-3 条、支出 7-8 条，至少 1-2 条自然涉及用户。\n`;
  }
  return `你是「${char.name}」的手机数据生成器。
${ctx}

${PERSONA_RULE}
${matureLine}
${walletContext}
【本次随机编号】${Date.now().toString(36)}-${Math.floor(Math.random()*1e6)}
请根据这个编号换一个与以往不同的切入角度、场景与措辞来写，避免和之前生成的内容雷同。
请一次性生成以下 App 的数据（只生成这些：${ids.join("、")}）：
{
  ${need}
}
数量要求：${counts || "按示例数量生成"}；health 的 hours 恰好 24 个整数、weekly 恰好 7 个数字。
必须保证每一个 App 都有数据，一个都不能漏。
严禁生成「和用户本人」的聊天会话。

【写作要求 · 每条都要有内容，不要只写一两句】
- video.desc：40-80 字，写清视频讲了什么 + 角色的反应。
- diary.content：120-200 字，有具体场景、动作、心情变化，像真人日记。
- mail.body：每封 3-4 段，每段 30-60 字，有称呼、正文、落款的感觉。
- memo：总数约 4 条，分 2-3 组；每条 content 90-150 字，写清具体经过、心情或待办细节，不要写得太短。
- browser.intro：50-100 字；quote：15-40 字；points 3 条各 15-30 字。
${ids.includes("private") ? "- private.preview：一句隐晦的概述；detail：不为人说的具体内容，写角色不愿公开的私事、难以启齿的心事或亲密关系里的秘密；角色可以涉及亲密与性相关的私事。\n" : ""}
- game.habit：40-80 字，写清玩法习惯与心态。
- chat：每个会话 6-10 条消息，有来有回，单条 5-25 字。
- album.text：10-30 字，有画面感。
- doubao：8-10 条，char 提问与 ai 回答交替；问题贴合角色当下生活与困惑，ai 回答口语化、可带分点，单条 20-60 字。
- taobao / store：商品名、店铺、规格、价格要像真实电商；外卖写清店名、菜品、时间与配送状态；cart/orders/food 都要有数据。
- mapcal.places：写角色搜索或导航过的、有真实感的地点；events：写接下来的日程，含时间、地点、类型标签。
${ids.includes("wallet") ? "- wallet：10 条左右收支，收入 2-3 条（工资、稿费、项目结款、分红、报销、退款、红包等），支出 7-8 条；金额、店铺、时间必须符合角色的身份与消费水平；至少 1-2 条自然涉及用户；时间在最近 7 天内，按从新到旧排列；balance 与流水收支一致，不能为负。\n" : ""}
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
  return undefined;
}

async function genMulti(api, char, ids, opts){
  const ctx = (opts && opts.lite) ? buildLiteContext(char) : await buildCharContext(char);
  const user = buildMultiPrompt(ids, char, ctx);
  const endpoint = buildChatEndpoint(api.url);
  let __sysJson = SYS_JSON;
  try {
    if (window.NanoPrompts && NanoPrompts.appendTo) __sysJson = NanoPrompts.appendTo(__sysJson, 'phone', { keepFormat: true });
  } catch (e) {}
  // 32768 会被很多兼容接口直接 400（超过模型上限），而且更容易输出到一半截断。
  const maxTokens = Math.min(12288, Math.max(4096, Number(api.maxTokens) || 8192));
  const baseBody = {
    model: api.model,
    messages: [{role:"system", content:__sysJson},{role:"user", content:user}],
    temperature: api.temp,
    max_tokens: maxTokens,
    presence_penalty: 0.4,
    frequency_penalty: 0.5
  };
  const headers = {"Content-Type":"application/json"};
  if(api.key) headers.Authorization = "Bearer " + api.key;

  const log = [];
  log.push({t:"sec", s:"请求信息"});
  log.push({t:"", s:"URL: " + endpoint});
  log.push({t:"", s:"Model: " + api.model});
  log.push({t:"", s:"Apps: " + ids.join(", ")});

  let resp, rawText = "";
  let useJsonFormat = true, tokens = maxTokens, lastErr = "";
  for(let attempt = 0; attempt < 4; attempt++){
    const payload = Object.assign({}, baseBody, {max_tokens: tokens});
    if(useJsonFormat) payload.response_format = {type:"json_object"};
    try{
      resp = await fetch(endpoint, {method:"POST", headers, body: JSON.stringify(payload)});
    }catch(e){
      log.push({t:"err", s:"网络错误: " + e.message});
      return {ok:{}, log, fatal:"网络错误：" + e.message};
    }
    try{ rawText = await resp.text(); }catch(e){ rawText = ""; }
    if(resp.ok) break;
    lastErr = "HTTP " + resp.status + (rawText ? "：" + rawText.slice(0,150) : "");
    // 接口不支持 response_format：去掉再试
    if(useJsonFormat && /response_format|json_object|invalid|unsupported|unknown/i.test(rawText)){
      log.push({t:"warn", s:"接口不支持 response_format，已改为普通 JSON 输出"});
      useJsonFormat = false;
      continue;
    }
    // 模型不支持这么大的 max_tokens：降到 4096 再试
    if(tokens > 4096 && /max_tokens|max output|too large|invalid/i.test(rawText)){
      log.push({t:"warn", s:"接口不接受 max_tokens=" + tokens + "，已降到 4096"});
      tokens = 4096;
      continue;
    }
    break;
  }
  log.push({t: resp && resp.ok ? "ok" : "err", s:"HTTP " + (resp && resp.status)});
  if(!resp || !resp.ok) return {ok:{}, log, fatal:lastErr || "请求失败"};

  /* ⚠️ rawText 是 API 外层响应，必须取出 choices[0].message.content 才是模型内容 */
  let content = "", finishReason = "";
  try{
    const env = JSON.parse(rawText);
    if(env && typeof env === "object"){
      content = env?.choices?.[0]?.message?.content || env?.choices?.[0]?.text || env?.output_text || "";
      finishReason = env?.choices?.[0]?.finish_reason || "";
    }
  }catch(e){}
  if(finishReason) log.push({t: finishReason === "length" ? "warn" : "", s:"finish_reason: " + finishReason});
  if(!content) content = rawText;   /* 兼容直接返回模型内容的接口 */
  const text = String(content);
  log.push({t:"sec", s:"模型内容（前 1200 字）"});
  log.push({t:"", s: text.slice(0,1200) || "(空)"});

  let json = null;
  try{ json = JSON.parse(text.replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"").trim()); }
  catch(e){ json = extractJSON(text); }

  log.push({t:"sec", s:"解析结果"});
  const ok = {};
  const source = (json && typeof json === "object") ? json : {};
  if(!json || typeof json !== "object") log.push({t:"warn", s:"顶层 JSON 解析失败，尝试逐个 App 抢救…"});
  for(const id of ids){
    let data = source[id];
    if(data === undefined || data === null){
      data = extractAppValue(text, id);
      if(data !== undefined && data !== null) log.push({t:"warn", s:`${id}: 顶层缺失，已从原文抢救`});
    }
    if(data === undefined || data === null){ log.push({t:"err", s:`${id}: 缺失`}); continue; }
    let valid = true, reason = "";
    if(["video","diary","album","mail","memo","browser","game","private","chat","doubao"].includes(id)){
      if(!Array.isArray(data) || !data.length){ valid = false; reason = "不是非空数组"; }
    }
    if(id === "health" && (!data || typeof data !== "object" || !data.steps)){ valid = false; reason = "缺少 steps"; }
    if((id === "taobao" || id === "store") && (!data || typeof data !== "object" || !(Array.isArray(data.cart) || Array.isArray(data.orders) || Array.isArray(data.food)))){ valid = false; reason = "缺少 cart/orders/food"; }
    if(id === "mapcal" && (!data || typeof data !== "object" || !(Array.isArray(data.places) || Array.isArray(data.events)))){ valid = false; reason = "缺少 places/events"; }
    if(id === "wallet" && (!data || typeof data !== "object" || !Array.isArray(data.transactions) || !data.transactions.length)){ valid = false; reason = "缺少 transactions"; }
    if(!valid){ log.push({t:"err", s:`${id}: 校验失败（${reason}）`}); continue; }
    ok[id] = {type:id, data};
    log.push({t:"ok", s:`${id}: OK（${Array.isArray(data)?data.length+" 条":"对象"}）`});
  }
  return {ok, log, fatal:null};
}

/* ===== 生成状态（非阻塞 · 可切换 App · 一次只调用一次 API） ===== */
const genState = { running:false, ids:[], failed:[], log:[] };
try{ if(window.NanoRefresh) window.NanoRefresh.define({ id:'phone', name:'手机', url:'phone.html', title:'手机' }); }catch(e){}
let lastFailedIds = [];

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
function mergeWalletForChar(charId, data) {
  const key = "nano_char_wallet_" + (charId || "default");
  let cur = { balance: 20000, transactions: [] };
  try{
    const w = JSON.parse(localStorage.getItem(key) || "null");
    if(w && typeof w === "object"){
      cur.balance = Number(w.balance) || 0;
      cur.transactions = Array.isArray(w.transactions) ? w.transactions : [];
    }
  }catch(e){}
  const now = Date.now();
  const txs = [];
  (Array.isArray(data && data.transactions) ? data.transactions : []).forEach(function(t, i){
    if(!t || typeof t !== "object") return;
    const type = t.type === "income" ? "income" : "expense";
    const amount = Math.round((parseFloat(t.amount) || 0) * 100) / 100;
    if(!(amount > 0)) return;
    let time = t.time || t.date || new Date(now - i * 3600000).toISOString();
    const d = new Date(time);
    if(isNaN(d.getTime())) time = new Date(now - i * 3600000).toISOString();
    txs.push({
      id: "ctx_" + now + "_" + Math.random().toString(36).slice(2, 7),
      type: type,
      amount: amount,
      desc: String(t.desc || t.name || "").trim() || (type === "income" ? "收入" : "支出"),
      time: time
    });
  });
  txs.sort(function(a, b){ return new Date(b.time) - new Date(a.time); });
  let net = 0;
  txs.forEach(function(t){ net += (t.type === "income" ? t.amount : -t.amount); });
  const balance = Math.max(0, Math.round((cur.balance + net) * 100) / 100);
  const merged = { balance: balance, transactions: txs.slice(0, 500) };
  try{ localStorage.setItem(key, JSON.stringify(merged)); }catch(e){}
  return merged;
}

async function startGeneration(ids){
  if(genState.running) return;
  ids = (ids || []).filter(Boolean);
  if(!ids.length) return;
  const api = await getApiInfo();
  if(!api) return;
  genState.running = true;
  try{ if(window.NanoRefresh) NanoRefresh.start({ key:'gen', label:'生成内容' }); }catch(e){}
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
  let blockedSkipped = false;
  let liteUsed = false;

  const runBatch = async (batch, label) => {
    showGenToast(label);
    let r = {ok:{}, log:[], fatal:null};
    try{
      r = await genMulti(api, currentChar, batch);
    }catch(e){
      r.log.push({t:"err", s:"异常: " + ((e && e.stack) || e.message || e)});
      r.fatal = (e && e.message) || String(e);
    }

    genState.log.push({t:"sec", s:label});
    (r.log || []).forEach(l => genState.log.push(l));

    /* 生成服务的内容安全策略偶尔会把整段请求拦掉。
       处理顺序：先去掉「私密」重试；如果还被拦，再用不含世界书/记忆的轻量上下文重试。
       其它错误不自动重试，避免在背后多扣一次 API。 */
    if(r.fatal && isContentBlocked(r.fatal)){
      let retryBatch = batch;
      if(retryBatch.indexOf("private") >= 0){
        blockedSkipped = true;
        retryBatch = retryBatch.filter(id => id !== "private");
        genState.log.push({t:"warn", s:"内容被安全策略拦截，自动去掉「私密」再试一次…"});
        if(retryBatch.length){
          try{
            r = await genMulti(api, currentChar, retryBatch);
          }catch(e){
            r = {ok:{}, log:[], fatal:(e && e.message) || String(e)};
          }
          genState.log.push({t:"sec", s:label + "（已跳过私密）"});
          (r.log || []).forEach(l => genState.log.push(l));
        }
      }
      if(r.fatal && isContentBlocked(r.fatal) && retryBatch.length){
        liteUsed = true;
        genState.log.push({t:"warn", s:"仍被拦截，改用轻量上下文（不含世界书 / 记忆）重试…"});
        try{
          r = await genMulti(api, currentChar, retryBatch, { lite: true });
        }catch(e){
          r = {ok:{}, log:[], fatal:(e && e.message) || String(e)};
        }
        genState.log.push({t:"sec", s:label + "（轻量上下文）"});
        (r.log || []).forEach(l => genState.log.push(l));
      }
    }
    /* 私密被拦时不拖垮整页：用本地个人随想补齐 */
    if(batch.indexOf("private") >= 0 && !(r.ok && r.ok.private) && blockedSkipped){
      if(!r.ok) r.ok = {};
      r.ok.private = { type: "private", data: genPrivateLocal(currentChar) };
      genState.log.push({t:"warn", s:"私密：已用本地个人随想补充（不消耗 API）"});
    }
    if(r.fatal) fatalMsgs.push(`${label}：${r.fatal}`);

    /* 生成完就立刻落盘 */
    for(const id of Object.keys(r.ok)){
      try{
        let payload = r.ok[id];
        if(id === "wallet"){
          const merged = mergeWalletForChar(currentChar.id, payload.data);
          payload = { type: "wallet", data: merged };
          r.ok[id] = payload;
        }
        await dataSet(`app_${currentChar.id}_${id}`, payload);
        okAll[id] = payload;
      }
      catch(e){ genState.log.push({t:"err", s:`写入 ${id} 失败: ${e.message}`}); }
    }
    await reRenderCurrentApp();
    return r;
  };

  await runBatch(ids, `正在一次生成 ${ids.length} 个 App…（可返回切换其它 App）`);

  genState.running = false;
  hideGenToast();
  await reRenderCurrentApp();

  const failed = ids.filter(id => !okAll[id]);
  genState.failed = failed;
  if(!failed.length){ try{ if(window.NanoRefresh) NanoRefresh.success('已生成 ' + Object.keys(okAll).length + ' 个 App 的内容', { key:'gen' }); }catch(e){} }
  if(failed.length){
    lastFailedIds = failed;
    const all = getAppsForRefresh();
    const names = failed.map(id => { const a = all.find(x => x.id === id); return a ? a.name : id; });
    const done = ids.length - failed.length;
    const msg = (done ? `已保存 ${done} 个 App 的内容。\n` : "") +
      ((blockedSkipped || liteUsed) ? `模型安全策略拦截了部分内容${blockedSkipped ? "，「私密」已用本地随想补充" : ""}${liteUsed ? "，并用轻量上下文重试" : ""}；如果仍有失败，可调整人设 / 世界书后再试。\n` : "") +
      (fatalMsgs.length ? fatalMsgs.join("\n") + "\n" : "") +
      `以下 App 生成失败：${names.join("、")}\n` +
      `可点「重新生成」只补失败的部分。`;
    showGenFail(msg);
    try{ if(window.NanoRefresh) NanoRefresh.fail('以下 App 生成失败：' + names.join('、'), { key:'gen' }); }catch(e){}
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
document.getElementById("genFailClose").onclick = hideGenFail;
document.getElementById("genFailSheet").addEventListener("click", e => {
  if(e.target === document.getElementById("genFailSheet")) hideGenFail();
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
    try{ const saved = await dataGet(`app_${currentChar.id}_${appId}`); data = saved ? saved.data : null; }catch(e){}
    if(!appHost.contains(frame)) return;
    try{
      const w = frame.contentWindow;
      w.__phoneRefresh = () => startGeneration([appId]);
      if(typeof w[renderName] === "function") w[renderName](data);
    }catch(e){}
  });
}
function openDoubao(){ return openHostedApp("doubao", "doubao.html", "renderDoubaoConversation"); }
function openTaobao(){ return openHostedApp("taobao", "taobao.html", "renderCharShopping"); }
function openStore(){ return openHostedApp("store", "taobao.html", "renderCharShopping"); }
function openMapcal(){ return openHostedApp("mapcal", "mapcal.html", "renderCharMapCalendar"); }
function openWallet(){
  const id = currentChar ? currentChar.id : "";
  const nm = currentChar ? currentChar.name : "";
  return openHostedApp("wallet", "phone-wallet.html?chat=" + encodeURIComponent(id) + "&name=" + encodeURIComponent(nm), "renderCharWallet");
}

/* 窥屏配置：内嵌在本 App 内，返回时回到「设置」而不是退出手机 */
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
  else if(d && d.type === "phoneAppRefresh"){ try{ startGeneration([currentAppId || "wallet"]); }catch(err){} }
  else if(d && d.type === "startScreenShare"){
    // 窥屏页嵌在「查手机」里时，把共享请求继续交给外壳
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