// ============================================================
// heart-setting.js — 「心声美化」完整页面
// ------------------------------------------------------------
// 与聊天里的心声面板共用同一份数据：
//   模板   → IndexedDB  NanoVoiceDB / templates（keyPath: id）
//   已应用 → localStorage nano_voice_applied_css
//   内置提示词 → localStorage nano_heart_builtin_prompt
// 左边/上方是实时预览，改 CSS 立即生效；点「应用」同步到聊天里的心声弹窗。
// ============================================================
(function () {
  'use strict';

  var DB_NAME = 'NanoVoiceDB';
  var STORE_NAME = 'templates';
  var APPLIED_KEY = 'nano_voice_applied_css';
  var PROMPT_KEY = 'nano_heart_builtin_prompt';
  var $ = function (id) { return document.getElementById(id); };

  var db = null;
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }
  async function allTemplates() {
    if (!db) db = await openDB();
    return new Promise(function (resolve, reject) {
      var r = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      r.onsuccess = function () { resolve(r.result || []); };
      r.onerror = function () { reject(r.error); };
    });
  }
  async function putTemplate(id, name, css) {
    if (!db) db = await openDB();
    return new Promise(function (resolve, reject) {
      var r = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ id: id, name: name, css: css });
      r.onsuccess = function () { resolve(); };
      r.onerror = function () { reject(r.error); };
    });
  }
  async function removeTemplate(id) {
    if (!db) db = await openDB();
    return new Promise(function (resolve, reject) {
      var r = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
      r.onsuccess = function () { resolve(); };
      r.onerror = function () { reject(r.error); };
    });
  }
  // 内置美化：缺失时补回；同一内置模板升级时（版本标记还是旧版）刷新
  async function ensureBuiltinTemplates() {
    var extras = window.NANO_HEART_BUILTIN_TEMPLATES || [];
    if (!extras.length) return;
    var all = await allTemplates();
    var byId = {};
    all.forEach(function (t) { byId[t.id] = t; });
    var pending = [];
    extras.forEach(function (t) {
      if (!t || !t.id || !t.css) return;
      var cur = byId[t.id];
      var need = !cur;
      if (cur) {
        var stored = String(cur.css || '');
        var oldVer = stored.match(/nano-heart-pink-dots:v(\d+)/);
        if (oldVer && Number(oldVer[1]) < Number(t.version || 1)) need = true;
      }
      if (need) {
        // 旧版内置刚好正在使用时，把已应用的 CSS 一起升级，避免模板变了但弹窗还是旧样式
        try {
          if (cur && localStorage.getItem(APPLIED_KEY) === String(cur.css || '')) {
            localStorage.setItem(APPLIED_KEY, t.css);
          }
        } catch (e) {}
        pending.push(putTemplate(t.id, t.name, t.css));
      }
    });
    if (pending.length) {
      try { await Promise.all(pending); } catch (e) {}
    }
  }
  function sortTemplates(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      var ab = /^builtin_/.test(String(a.id || ''));
      var bb = /^builtin_/.test(String(b.id || ''));
      if (ab !== bb) return ab ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    });
  }

  function toast(msg) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,.8);color:#fff;font-size:13px;padding:9px 16px;border-radius:12px;pointer-events:none;transition:opacity .2s;opacity:0;';
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 250); }, 1500);
    } catch (e) {}
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  // ---- 模板文本解析 ----
  function cssOnly(text) {
    return window.NanoBeautifyRT ? window.NanoBeautifyRT.parse(text || '').css : String(text || '');
  }
  function runJs(text) {
    try {
      if (!window.NanoBeautifyRT) return;
      var p = window.NanoBeautifyRT.parse(text || '');
      window.NanoBeautifyRT.run('heart', p.js, { mountParent: document.body });
    } catch (e) {}
  }
  function parseSections(css) {
    var out = [];
    var m = String(css || '').match(/\/\*\s*@heart-sections([\s\S]*?)\*\//i);
    if (!m) return out;
    m[1].split(/\r?\n/).forEach(function (line) {
      var t = String(line).replace(/^\s*\*?\s?/, '').trim();
      if (!t) return;
      var mm = t.match(/^[\[【]\s*([^\]】]+?)\s*[\]】]\s*[:：]?\s*([\s\S]*)$/);
      if (mm && mm[1]) out.push({ name: mm[1].trim(), prompt: (mm[2] || '').trim() });
    });
    return out;
  }

  // ---- 实时预览：用「最近一条真实心声」做样例；没有才用占位 ----
  var realHeart = null; // { subject, thought, sections:[{name,content}] }
  function applyLive(css) {
    var st = $('nanoVoiceCustomCSS');
    if (st) st.textContent = cssOnly(css);
    runJs(css);
    renderSections();
  }
  function renderSections() {
    var wrap = $('hsSections');
    if (!wrap) return;
    wrap.innerHTML = '';
    var real = realHeart && Array.isArray(realHeart.sections) ? realHeart.sections : [];
    var list; var isSample = false;
    if (real.length) {
      list = real.map(function (s) { return { name: s.name, body: s.content || '' }; });
    } else {
      // 没有真实板块时，用模板里声明的板块 + 示例内容，方便调样式
      list = parseSections($('hsCss') ? $('hsCss').value : '').map(function (s) {
        return { name: s.name, body: '（示例）' + (s.prompt || '内容会由 AI 每轮生成') };
      });
      isSample = true;
    }
    list.forEach(function (s) {
      var sec = document.createElement('div');
      sec.className = 'iv-section';
      var title = document.createElement('div');
      title.className = 'iv-section-title';
      title.textContent = s.name || '';
      var body = document.createElement('div');
      body.className = 'iv-section-body';
      body.textContent = s.body || '';
      sec.appendChild(title); sec.appendChild(body);
      wrap.appendChild(sec);
    });
    void isSample;
  }
  var previewName = ''; // 当前打开的角色名（从 URL ?name=）
  function populatePreview() {
    var h = realHeart || {};
    var sender = h.sender || previewName || '角色';
    var sEl = $('hsSender'); if (sEl) sEl.textContent = sender;
    // 头像同步：优先用聊天里当前角色的头像
    var av = '';
    try { av = sessionStorage.getItem('nano_heart_preview_avatar') || ''; } catch (e) {}
    var img = $('hsAvatar');
    if (img) { if (av) { img.src = av; img.hidden = false; } else { img.hidden = true; } }
    var af = $('hsAvatarFallback'); if (af) { af.hidden = !!av; af.textContent = (sender || '角').slice(0, 1); }
    var rEl = $('hsRecipient'); if (rEl) rEl.textContent = h.recipient || '你';
    var tEl = $('hsTime'); if (tEl) tEl.textContent = h.time || '';
    var sub = $('hsSubject'); if (sub) sub.textContent = h.subject || '（还没有生成过心声：这里会显示「此刻 · 印象」）';
    var th = $('hsThought'); if (th) th.textContent = h.thought || '（还没有生成过心声：这里会显示「心声 · 手记」）';
    renderSections();
  }
  // 等 localforage 就绪（异步脚本，最多等 ~3s）
  function waitForLocalforage(ms) {
    return new Promise(function (resolve) {
      if (window.localforage) { resolve(true); return; }
      var t0 = Date.now();
      var timer = setInterval(function () {
        if (window.localforage) { clearInterval(timer); resolve(true); }
        else if (Date.now() - t0 > (ms || 3000)) { clearInterval(timer); resolve(false); }
      }, 120);
    });
  }
  // 读取该聊天的最后一条真实心声（localforage: chat_messages_<chatId>）
  async function loadRealHeart(chatId) {
    if (!chatId) return false;
    try { await waitForLocalforage(3000); } catch (e) {}
    if (!window.localforage) return false;
    try {
      var list = await localforage.getItem('chat_messages_' + chatId);
      if (!Array.isArray(list)) return false;
      for (var i = list.length - 1; i >= 0; i--) {
        var m = list[i];
        if (m && m.heart && (m.heart.subject || m.heart.thought || (m.heart.sections && m.heart.sections.length))) {
          realHeart = {
            subject: m.heart.subject || '',
            thought: m.heart.thought || '',
            sections: Array.isArray(m.heart.sections) ? m.heart.sections : [],
            time: m.time || ''
          };
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // ---- 下拉 ----
  var currentId = 'default';
  async function renderSelect(selectedId) {
    try { await ensureBuiltinTemplates(); } catch (e) {}
    var all = sortTemplates(await allTemplates());
    var sel = $('hsTemplateSelect');
    sel.innerHTML = '';
    var ph = document.createElement('option');
    ph.value = ''; ph.textContent = '— 选择预设 —'; ph.disabled = true;
    sel.appendChild(ph);
    all.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id; o.textContent = t.name;
      sel.appendChild(o);
    });
    var want = selectedId || currentId;
    if (all.some(function (t) { return t.id === want; })) { sel.value = want; currentId = want; }
    else if (all.length) { sel.value = all[0].id; currentId = all[0].id; }
    return all;
  }
  async function loadToEditor(id) {
    var all = await allTemplates();
    var t = all.find(function (x) { return x.id === id; });
    if (!t) return;
    currentId = id;
    $('hsCss').value = t.css || '';
    $('hsTemplateName').value = '';
    $('hsTemplateSelect').value = id;
    applyLive(t.css || '');
  }

  // 同步到聊天里的心声弹窗（实时生效，无需退出重进）
  function syncToChat(css) {
    try { window.parent.postMessage({ type: 'nanoVoiceCss', css: String(css || '') }, '*'); } catch (e) {}
  }
  // ---- 应用 ----
  async function applyAll() {
    var css = $('hsCss').value;
    var id = $('hsTemplateSelect').value;
    if (id) {
      try {
        var cur = (await allTemplates()).find(function (t) { return t.id === id; });
        await putTemplate(id, cur ? cur.name : '默认模板（完整）', css);
      } catch (e) {}
    }
    try { localStorage.setItem(APPLIED_KEY, css); } catch (e) {}
    try { localStorage.setItem(PROMPT_KEY, $('hsBuiltinPrompt').value || ''); } catch (e) {}
    applyLive(css);
    syncToChat(css);   // 立即同步到心声状态栏
    toast('已应用');
  }

  // ---- 事件绑定 ----
  function bind() {
    $('hsBack').addEventListener('click', function () {
      try { window.parent.postMessage({ type: 'closeFullscreen', keepPage: true }, '*'); } catch (e) {}
    });

    $('hsCollapse').addEventListener('click', function () {
      $('hsPreviewBody').classList.toggle('collapsed');
    });

    if ($('hsAvatarFrame')) $('hsAvatarFrame').addEventListener('click', function () {
      if (window.NanoAvatarFrame && window.NanoAvatarFrame.openUI) window.NanoAvatarFrame.openUI('heart');
      else toast('头像框模块未加载');
    });

    $('hsTemplateSelect').addEventListener('change', function () { loadToEditor(this.value); });

    // 保存：把当前编辑内容存进「已选中的预设」
    $('hsSaveTemplate').addEventListener('click', async function () {
      var id = $('hsTemplateSelect').value;
      var name = ($('hsTemplateName').value || '').trim();
      if (!id && !name) { toast('请输入预设名称'); return; }
      var css = $('hsCss').value;
      try {
        if (id) {
          var cur = (await allTemplates()).find(function (t) { return t.id === id; });
          await putTemplate(id, cur ? cur.name : name, css);
        } else {
          var newId = 'tpl_' + Date.now();
          await putTemplate(newId, name, css);
          currentId = newId;
          await renderSelect(newId);
        }
        $('hsTemplateName').value = '';
        applyLive(css);
        toast('已保存');
      } catch (e) { toast('保存失败'); }
    });
    // 「复制初始模板」：复制内置的完整初始模板，而不是把当前内容另存为预设。
    $('hsSaveAsBtn').addEventListener('click', async function () {
      var css = '';
      try {
        var all = await allTemplates();
        var def = all.find(function (t) { return t.id === 'default'; });
        if (def && def.css) css = def.css;
      } catch (e) {}
      if (!css) css = $('hsCss').value || '';
      if (!css) { toast('还没有可复制的模板'); return; }
      copyText(css).then(function () {
        toast('已复制初始模板');
      }).catch(function () {
        toast('复制失败，请手动选择');
      });
    });

    $('hsRenameTemplate').addEventListener('click', async function () {
      var id = $('hsTemplateSelect').value;
      var name = ($('hsTemplateName').value || '').trim();
      if (!id) { toast('请先选择一个预设'); return; }
      if (!name) { toast('请输入新名称'); return; }
      var all = await allTemplates();
      var t = all.find(function (x) { return x.id === id; });
      if (!t) return;
      await putTemplate(id, name, t.css);
      $('hsTemplateName').value = '';
      await renderSelect(id);
      toast('已改名');
    });

    $('hsDeleteTemplate').addEventListener('click', async function () {
      var id = $('hsTemplateSelect').value;
      if (!id) { toast('请先选择一个预设'); return; }
      if (id === 'default') { toast('默认模板不可删除'); return; }
      if (!confirm('确定删除这个预设？')) return;
      await removeTemplate(id);
      var all = await allTemplates();
      var next = all[0] ? all[0].id : '';
      await renderSelect(next);
      if (next) await loadToEditor(next);
      toast('已删除');
    });

    $('hsCss').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(bind._t);
      bind._t = setTimeout(function () { applyLive(v); syncToChat(v); }, 200);
    });

    $('hsClearBtn').addEventListener('click', function () {
      $('hsCss').value = '';
      try { localStorage.setItem(APPLIED_KEY, ''); } catch (e) {}
      applyLive('');
      if (window.NanoBeautifyRT) window.NanoBeautifyRT.clear('heart');
      toast('已清空');
    });

    $('hsRestoreBtn').addEventListener('click', async function () {
      var all = await allTemplates();
      var def = all.find(function (t) { return t.id === 'default'; });
      if (!def) { toast('找不到默认模板'); return; }
      $('hsCss').value = def.css || '';
      currentId = 'default';
      $('hsTemplateSelect').value = 'default';
      try { localStorage.setItem(APPLIED_KEY, def.css || ''); } catch (e) {}
      applyLive(def.css || '');
      toast('已还原默认模板');
    });

    $('hsApplyBtn').addEventListener('click', applyAll);
    if ($('hsKeepTop')) $('hsKeepTop').addEventListener('click', applyAll);

    $('hsExportBtn').addEventListener('click', function () {
      var name = ($('hsTemplateName').value || '').trim() || '心声美化';
      var text = JSON.stringify({ type: 'heart', name: name, css: $('hsCss').value }, null, 2);
      if (window.NanoExport) { window.NanoExport.file({ name: name + '.json', text: text }); return; }
      try {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name + '.json'; a.click();
      } catch (e) { toast('导出失败'); }
    });

    $('hsImportBtn').addEventListener('click', function () { $('hsFileInput').click(); });
    $('hsFileInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function (ev) {
        var txt = String(ev.target.result || '');
        var css = txt;
        try {
          var o = JSON.parse(txt);
          if (o && typeof o.css === 'string') css = o.css;
        } catch (e2) { /* 纯文本 */ }
        $('hsCss').value = css;
        applyLive(css);
        toast('已导入到编辑器（点「应用」生效）');
      };
      rd.readAsText(f);
      e.target.value = '';
    });
  }

  async function init() {
    try { bind(); } catch (e) { try { console.warn('[heart-setting] bind 失败', e); } catch (e2) {} }
    try { await renderSelect('default'); } catch (e) {}
    // 优先显示已应用；没有则显示默认模板
    var applied = '';
    try { applied = localStorage.getItem(APPLIED_KEY) || ''; } catch (e) {}
    try {
      if (applied) { $('hsCss').value = applied; }
      else {
        // 默认模板不存在（例如直接从设置页打开、还没进过聊天）时，
        // 回退到下拉里当前选中的预设，避免编辑器空白。
        var sel = $('hsTemplateSelect');
        var fallbackId = sel ? sel.value : 'default';
        await loadToEditor(fallbackId || 'default');
      }
    } catch (e) { if (applied) $('hsCss').value = applied; }
    try { $('hsBuiltinPrompt').value = localStorage.getItem(PROMPT_KEY) || ''; } catch (e) {}

    // 用该聊天「最近一条真实心声」做预览；没有就用占位
    var chatId = '';
    try {
      var sp = new URLSearchParams(location.search);
      chatId = sp.get('chat') || '';
      previewName = decodeURIComponent(sp.get('name') || '');
      if (!previewName) { try { previewName = sessionStorage.getItem('nano_heart_preview_name') || ''; } catch (e2) {} }
    } catch (e) {}
    try { await loadRealHeart(chatId); } catch (e) {}
    try { populatePreview(); } catch (e) {}

    try { applyLive($('hsCss').value); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
