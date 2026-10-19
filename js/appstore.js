// ============================================================
// appstore.js — AppStore 逻辑
// - 导入 HTML / 复制模板
// - 已安装列表（打开 / 删除）
// - 设置：存储圆环 + 各 App 占用（清除 / 压缩）、备份（选择导出）、危险操作
// ============================================================
(function () {
  'use strict';

  var DB_NAME = 'nano_appstore_db';
  var DB_VERSION = 2;
  var STORE_APPS = 'apps';
  var STORE_DATA = 'appdata';

  // ===== DOM =====
  var $pageStore    = document.getElementById('pageStore');
  var $pageSettings = document.getElementById('pageSettings');
  var $nav          = document.querySelector('.nav');

  var $appList   = document.getElementById('appList');
  var $empty     = document.getElementById('emptyState');
  var $searchWrap= document.getElementById('searchWrap');
  var $search    = document.getElementById('searchInput');
  var $appCount  = document.getElementById('appCount');

  var $copyBtn   = document.getElementById('copyTemplate');
  var $importBtn = document.getElementById('importHtml');
  var $fileInput = document.getElementById('fileInput');

  var $usageValue   = document.getElementById('usageValue');
  var $setUsage     = document.getElementById('setUsage');
  var $storagePanel = document.getElementById('storagePanel');
  var $ringBar      = document.getElementById('ringBar');
  var $ringPercent  = document.getElementById('ringPercent');
  var $ringUsed     = document.getElementById('ringUsed');
  var $ringQuota    = document.getElementById('ringQuota');
  var $ringApps     = document.getElementById('ringApps');
  var $usageList    = document.getElementById('usageList');

  var $setClearData = document.getElementById('setClearData');
  var $setExport    = document.getElementById('setExport');
  var $setImport    = document.getElementById('setImport');
  var $backupInput  = document.getElementById('backupInput');
  var $setUninstall = document.getElementById('setUninstallAll');

  // 清除弹窗
  var $clearModal    = document.getElementById('clearModal');
  var $clearList     = document.getElementById('clearList');
  var $clearAll      = document.getElementById('clearAll');
  var $clearNone     = document.getElementById('clearNone');
  var $clearSelected = document.getElementById('clearSelected');
  var $clearCancel   = document.getElementById('clearCancel');
  var $clearOk       = document.getElementById('clearOk');

  // 卸载弹窗
  var $uninstallModal    = document.getElementById('uninstallModal');
  var $uninstallList     = document.getElementById('uninstallList');
  var $uninstallAll      = document.getElementById('uninstallAll');
  var $uninstallNone     = document.getElementById('uninstallNone');
  var $uninstallSelected = document.getElementById('uninstallSelected');
  var $uninstallCancel   = document.getElementById('uninstallCancel');
  var $uninstallOk       = document.getElementById('uninstallOk');

  var $toast = document.getElementById('toast');

  var $confirmModal  = document.getElementById('confirmModal');
  var $confirmTitle  = document.getElementById('confirmTitle');
  var $confirmDesc   = document.getElementById('confirmDesc');
  var $confirmCancel = document.getElementById('confirmCancel');
  var $confirmOk     = document.getElementById('confirmOk');

  // 图标设计
  var $iconModal  = document.getElementById('iconModal');
  var $iconPrev   = document.getElementById('iconPrev');
  var $iconLetter = document.getElementById('iconLetter');
  var $iconColor  = document.getElementById('iconColor');
  var $iconAvatar = document.getElementById('iconAvatar');
  var $iconUpload = document.getElementById('iconUpload');
  var $iconClear  = document.getElementById('iconClear');
  var $iconCancel = document.getElementById('iconCancel');
  var $iconOk     = document.getElementById('iconOk');
  var $iconFile   = document.getElementById('iconFile');

  var $exportModal    = document.getElementById('exportModal');
  var $exportList     = document.getElementById('exportList');
  var $exportAll      = document.getElementById('exportAll');
  var $exportNone     = document.getElementById('exportNone');
  var $exportSelected = document.getElementById('exportSelected');
  var $exportCancel   = document.getElementById('exportCancel');
  var $exportOk       = document.getElementById('exportOk');

  // ===== Toast =====
  var toastTimer = null;
  function toast(text) {
    if (!$toast) return;
    $toast.textContent = text;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.classList.remove('show'); }, 1600);
  }

  // ===== 确认弹窗 =====
  var confirmResolver = null;
  function confirmBox(title, desc, okText) {
    $confirmTitle.textContent = title || '确认';
    $confirmDesc.textContent = desc || '';
    $confirmOk.textContent = okText || '确定';
    $confirmModal.classList.add('on');
    return new Promise(function (resolve) { confirmResolver = resolve; });
  }
  function closeConfirm(result) {
    $confirmModal.classList.remove('on');
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
  }
  $confirmCancel.addEventListener('click', function () { closeConfirm(false); });
  $confirmOk.addEventListener('click', function () { closeConfirm(true); });
  $confirmModal.addEventListener('click', function (e) {
    if (e.target === $confirmModal) closeConfirm(false);
  });

  // ===== IndexedDB =====
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_APPS)) d.createObjectStore(STORE_APPS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_DATA)) d.createObjectStore(STORE_DATA, { keyPath: 'key' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGetAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(STORE_APPS, 'readonly').objectStore(STORE_APPS).getAll();
          r.onsuccess = function () { resolve(r.result || []); db.close(); };
          r.onerror = function () { resolve([]); db.close(); };
        } catch (e) { resolve([]); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return []; });
  }

  function dbGetAllData() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(STORE_DATA, 'readonly').objectStore(STORE_DATA).getAll();
          r.onsuccess = function () { resolve(r.result || []); db.close(); };
          r.onerror = function () { resolve([]); db.close(); };
        } catch (e) { resolve([]); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return []; });
  }

  function dbPut(app) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_APPS, 'readwrite');
          tx.objectStore(STORE_APPS).put(app);
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function dbDelete(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_APPS, 'readwrite');
          tx.objectStore(STORE_APPS).delete(id);
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function dbClearApps() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_APPS, 'readwrite');
          tx.objectStore(STORE_APPS).clear();
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function dbClearAppData() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_DATA, 'readwrite');
          tx.objectStore(STORE_DATA).clear();
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  // 按前缀清除某个 App 的存储（key 形如 appId:xxx）
  function dbClearAppDataById(appId) {
    var prefix = appId + ':';
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE_DATA, 'readwrite');
          var store = tx.objectStore(STORE_DATA);
          var keysReq = store.getAllKeys();
          keysReq.onsuccess = function () {
            (keysReq.result || []).forEach(function (k) {
              if (typeof k === 'string' && k.indexOf(prefix) === 0) store.delete(k);
            });
          };
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  // 压缩：把 app.html 里多余的空白 / 注释 / 换行去掉（无害化，不改变逻辑）
  function compressHtml(html) {
    if (typeof html !== 'string') return html;
    var out = html;
    // 去 HTML 注释（不动 script 里的）
    out = out.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
    // 合并连续空白（不动 <pre> / <textarea> / <script> / <style>）
    var blocks = [];
    out = out.replace(/<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, function (m) {
      blocks.push(m);
      return '\u0000B' + (blocks.length - 1) + '\u0000';
    });
    out = out.replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    out = out.replace(/\u0000B(\d+)\u0000/g, function (_, i) { return blocks[Number(i)]; });
    return out;
  }

  // ===== manifest =====
  function parseManifest(html) {
    try {
      var m = html.match(/<script[^>]*id=["']nano-manifest["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!m) return null;
      return JSON.parse(m[1]);
    } catch (e) { return null; }
  }

  // ===== 格式化 =====
  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function byteLen(str) {
    if (!str) return 0;
    try { return new Blob([str]).size; } catch (e) { return String(str).length; }
  }

  // ===== 商店列表 =====
  var allApps = [];
  var keyword = '';

  function renderList() {
    var apps = allApps.filter(function (a) {
      if (!keyword) return true;
      var k = keyword.toLowerCase();
      return (a.name || '').toLowerCase().indexOf(k) !== -1
          || (a.desc || '').toLowerCase().indexOf(k) !== -1
          || (a.id || '').toLowerCase().indexOf(k) !== -1;
    });

    $appCount.textContent = allApps.length ? (allApps.length + ' 个') : '';

    if (!allApps.length) {
      $searchWrap.hidden = true;
      $appList.hidden = true;
      $empty.hidden = false;
      return;
    }

    $searchWrap.hidden = false;
    $empty.hidden = true;

    if (!apps.length) {
      $appList.hidden = false;
      $appList.innerHTML = '<div style="padding:28px 16px;text-align:center;color:var(--muted);font-size:13px">没有匹配的应用</div>';
      return;
    }

    $appList.hidden = false;
    $appList.innerHTML = '';

    apps.sort(function (a, b) { return (b.installedAt || 0) - (a.installedAt || 0); });

    apps.forEach(function (app) {
      var row = document.createElement('div');
      row.className = 'app-row';

      var icon = document.createElement('div');
      icon.className = 'app-icon';
      if (app.icon && /^(data:image\/|https?:\/\/|blob:)/i.test(app.icon)) {
        var img = document.createElement('img');
        img.src = app.icon; img.alt = '';
        icon.appendChild(img);
      } else {
        icon.textContent = (app.icon && String(app.icon).length <= 4)
          ? app.icon
          : (app.name || '?').charAt(0).toUpperCase();
        if (/^#[0-9a-f]{3,8}$/i.test(app.color || '')) { icon.style.background = app.color; icon.style.color = '#fff'; }
      }
      row.appendChild(icon);

      var meta = document.createElement('div');
      meta.className = 'app-meta';
      var name = document.createElement('div');
      name.className = 'app-name';
      name.textContent = app.name || app.id || '未命名';
      var desc = document.createElement('div');
      desc.className = 'app-desc';
      desc.textContent = app.desc || ('v' + (app.version || '1.0.0'));
      meta.appendChild(name);
      meta.appendChild(desc);
      row.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'app-actions';

      var openBtn = document.createElement('button');
      openBtn.className = 'app-open';
      openBtn.textContent = '打开';
      openBtn.addEventListener('click', function (e) { e.stopPropagation(); openApp(app.id); });
      actions.appendChild(openBtn);

      var iconBtn = document.createElement('button');
      iconBtn.className = 'app-del';
      iconBtn.style.color = 'var(--accent)';
      iconBtn.setAttribute('aria-label', '设计图标');
      iconBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
      iconBtn.addEventListener('click', function (e) { e.stopPropagation(); openIconEditor(app); });
      actions.appendChild(iconBtn);

      var delBtn = document.createElement('button');
      delBtn.className = 'app-del';
      delBtn.setAttribute('aria-label', '删除');
      delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1zM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z"/></svg>';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmBox('删除应用', '确定删除「' + (app.name || app.id) + '」吗？该应用的数据也会一并清除。', '删除')
          .then(function (ok) {
            if (!ok) return;
            Promise.all([dbDelete(app.id), dbClearAppDataById(app.id)]).then(function () {
              toast('已删除');
              refresh();
            }).catch(function () { toast('删除失败'); });
          });
      });
      actions.appendChild(delBtn);

      row.appendChild(actions);
      row.addEventListener('click', function () { openApp(app.id); });

      $appList.appendChild(row);
    });
  }

  function openApp(id) {
    var url = 'app-host.html?id=' + encodeURIComponent(id);
    if (window.parent && window.parent !== window) {
      try {
        // 应用自带导航：不显示外壳顶栏/返回；从应用返回时回到 AppStore
        window.parent.postMessage({ type: 'openFullscreen', url: url, title: '应用', showBack: false, source: 'appstore' }, '*');
        return;
      } catch (e) {}
    }
    location.href = url;
  }

  // ===== 图标设计 =====
  function readMyAvatar() {
    try {
      var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
      for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) {
          var m = d.masks.filter(function (x) { return x.id === d.currentMaskId; })[0] || d.masks[0];
          if (m && m.avatar) return m.avatar;
        }
      }
    } catch (e) {}
    return '';
  }
  var iconEditApp = null;
  var iconEditImage = '';
  function paintIconPrev() {
    if (!$iconPrev) return;
    if (iconEditImage) {
      $iconPrev.textContent = '';
      $iconPrev.style.background = '#e5e5ea';
      $iconPrev.innerHTML = '<img src="' + iconEditImage.replace(/"/g, '&quot;') + '" style="width:100%;height:100%;object-fit:cover">';
    } else {
      $iconPrev.innerHTML = '';
      $iconPrev.textContent = ($iconLetter.value || 'A');
      $iconPrev.style.background = $iconColor.value || '#4a6cf7';
    }
  }
  function openIconEditor(app) {
    iconEditApp = app;
    var icon = String(app.icon || '');
    var isImg = /^(data:image\/|https?:\/\/|blob:)/i.test(icon);
    iconEditImage = isImg ? icon : '';
    $iconLetter.value = isImg ? '' : (icon || (app.name || 'A').charAt(0));
    $iconColor.value = /^#[0-9a-f]{3,8}$/i.test(app.color || '') ? app.color : '#4a6cf7';
    paintIconPrev();
    $iconModal.classList.add('on');
  }
  function closeIconEditor() { $iconModal.classList.remove('on'); iconEditApp = null; iconEditImage = ''; }

  if ($iconModal) {
    $iconModal.addEventListener('click', function (e) { if (e.target === $iconModal) closeIconEditor(); });
    $iconCancel.addEventListener('click', closeIconEditor);
    $iconLetter.addEventListener('input', paintIconPrev);
    $iconColor.addEventListener('input', paintIconPrev);
    $iconAvatar.addEventListener('click', function () {
      var av = readMyAvatar();
      if (!av) { toast('还没有设置头像'); return; }
      iconEditImage = av; paintIconPrev();
    });
    $iconUpload.addEventListener('click', function () { $iconFile.click(); });
    $iconClear.addEventListener('click', function () { iconEditImage = ''; paintIconPrev(); });
    $iconFile.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      $iconFile.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (ev) { iconEditImage = String(ev.target.result || ''); paintIconPrev(); };
      reader.readAsDataURL(f);
    });
    $iconOk.addEventListener('click', function () {
      if (!iconEditApp) return;
      var app = iconEditApp;
      var letter = ($iconLetter.value || '').trim();
      app.icon = iconEditImage || letter || (app.name || 'A').charAt(0);
      app.color = $iconColor.value || '';
      dbPut(app).then(function () {
        closeIconEditor();
        toast('图标已更新');
        refresh();
      }).catch(function () { toast('保存失败'); });
    });
  }

    // ===== 通用：选择列表 =====
  function renderPicker(listEl, selectedSet, countEl, okEl, defaultAll) {
    listEl.innerHTML = '';
    selectedSet.clear();

    if (!allApps.length) {
      listEl.innerHTML = '<div class="storage-empty">还没有安装任何应用</div>';
      countEl.textContent = '已选 0 个';
      okEl.disabled = true;
      return;
    }

    if (defaultAll !== false) {
      allApps.forEach(function (a) { selectedSet.add(a.id); });
    }

    allApps.forEach(function (app) {
      var row = document.createElement('div');
      row.className = 'picker-row';

      var check = document.createElement('div');
      check.className = 'picker-check' + (selectedSet.has(app.id) ? ' on' : '');
      row.appendChild(check);

      var nm = document.createElement('div');
      nm.className = 'picker-name';
      nm.textContent = app.name || app.id;
      row.appendChild(nm);

      var sz = document.createElement('div');
      sz.className = 'picker-size';
      sz.textContent = formatBytes(byteLen(app.html || ''));
      row.appendChild(sz);

      row.addEventListener('click', function () {
        if (selectedSet.has(app.id)) {
          selectedSet.delete(app.id);
          check.classList.remove('on');
        } else {
          selectedSet.add(app.id);
          check.classList.add('on');
        }
        countEl.textContent = '已选 ' + selectedSet.size + ' 个';
        okEl.disabled = selectedSet.size === 0;
      });

      listEl.appendChild(row);
    });

    countEl.textContent = '已选 ' + selectedSet.size + ' 个';
    okEl.disabled = selectedSet.size === 0;
  }

  function syncPicker(listEl, selectedSet, countEl, okEl) {
    var checks = listEl.querySelectorAll('.picker-check');
    allApps.forEach(function (app, i) {
      if (checks[i]) checks[i].classList.toggle('on', selectedSet.has(app.id));
    });
    countEl.textContent = '已选 ' + selectedSet.size + ' 个';
    okEl.disabled = selectedSet.size === 0;
  }

  function refresh() {
    return dbGetAll().then(function (apps) {
      allApps = apps || [];
      renderList();
      updateUsage();
      if ($storagePanel.classList.contains('on')) renderUsageList();
    });
  }

  // ===== 导入 =====
  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var html = String(e.target.result || '');
      var manifest = parseManifest(html);
      if (!manifest || !manifest.id) { toast('缺少 nano-manifest 或 id'); return; }
      var app = {
        id: String(manifest.id),
        name: manifest.name || manifest.id,
        icon: manifest.icon || '',
        color: manifest.color || '',
        desc: manifest.desc || '',
        version: manifest.version || '1.0.0',
        permissions: manifest.permissions || [],
        html: html,
        installedAt: Date.now()
      };
      dbPut(app).then(function () {
        toast('已导入「' + app.name + '」');
        refresh();
      }).catch(function (err) {
        toast('导入失败：' + (err && err.message ? err.message : err));
      });
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  // ===== 模板 =====
  var TEMPLATE = [
'<!DOCTYPE html>',
'<html lang="zh-CN">',
'<head>',
'<meta charset="UTF-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>我的应用</title>',
'<script type="application/json" id="nano-manifest">',
'{',
'  "id": "my-first-app",',
'  "name": "我的应用",',
'  "icon": "A",',
'  "desc": "一句话介绍这个应用",',
'  "version": "1.0.0",',
'  "permissions": ["persona", "characters", "worldbook", "memory", "api", "tts"]',
'}',
'</' + 'script>',
'<style>',
'  body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f2f2f7;color:#111}',
'  h1{font-size:20px;margin:0 0 10px}',
'  .card{background:#fff;border-radius:16px;padding:16px;margin-top:14px;box-shadow:0 1px 3px rgba(0,0,0,.05)}',
'  button{padding:10px 16px;border:0;border-radius:12px;background:#4a6cf7;color:#fff;font-size:14px}',
'  #out{margin-top:12px;font-size:14px;line-height:1.6;white-space:pre-wrap}',
'</style>',
'</head>',
'<body>',
'  <h1>你好，Nano</h1>',
'  <div class="card">',
'    <button id="load">读取我的资料</button>',
'    <div id="out"></div>',
'  </div>',
'<script>',
'  document.getElementById("load").onclick = async function(){',
'    var me = await Nano.persona();',
'    var chars = await Nano.characters();',
'    var wb = await Nano.worldbook();',
'    var out = document.getElementById("out");',
'    out.textContent =',
'      "用户：" + ((me && me.name) || "未设置") + "\\n" +',
'      "角色：" + (chars.map(function(c){return c.name;}).join("、") || "无") + "\\n" +',
'      "世界书：" + (wb ? (wb.length + " 字") : "空");',
'  };',
'</' + 'script>',
'</body>',
'</html>'
  ].join('\n');

  // 优先使用独立的 Nano DIY 模板文件；读取失败时回退到内置简版
  function getTemplateText() {
    try {
      return fetch('nano-app-template.html', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status)); })
        .then(function (t) { return (t && t.indexOf('nano-manifest') > -1) ? t : TEMPLATE; })
        .catch(function () { return TEMPLATE; });
    } catch (e) { return Promise.resolve(TEMPLATE); }
  }
  function copyTemplate() {
    getTemplateText().then(function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Nano 模板已复制'); })
          .catch(function () { fallbackCopy(text); });
      } else fallbackCopy(text);
    });
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Nano 模板已复制'); }
    catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

  // ===== 存储：圆环 + 各 App 占用 =====
  var CIRC = 2 * Math.PI * 44; // r=44

  function updateUsage() {
    if (!$usageValue) return;
    if (!(navigator.storage && navigator.storage.estimate)) {
      $usageValue.textContent = '—';
      return;
    }
    navigator.storage.estimate().then(function (est) {
      var usage = (est && est.usage) || 0;
      var quota = (est && est.quota) || 0;
      $usageValue.textContent = usage ? formatBytes(usage) : '—';

      if ($ringUsed) $ringUsed.textContent = usage ? formatBytes(usage) : '—';
      if ($ringQuota) $ringQuota.textContent = quota ? formatBytes(quota) : '—';

      var pct = quota ? Math.min(100, (usage / quota) * 100) : 0;
      if ($ringPercent) $ringPercent.textContent = pct < 1 && usage > 0 ? '<1%' : Math.round(pct) + '%';
      if ($ringBar) {
        var offset = CIRC * (1 - pct / 100);
        $ringBar.style.strokeDashoffset = String(offset);
      }

      var appCount = allApps.length;
      if ($ringApps) $ringApps.textContent = appCount ? (appCount + ' 个应用') : '没有应用';
    }).catch(function () { $usageValue.textContent = '—'; });
  }

  // 计算各 App 占用
  function computeUsageByApp() {
    return Promise.all([dbGetAll(), dbGetAllData()]).then(function (res) {
      var apps = res[0] || [];
      var data = res[1] || [];

      // 每个 App：html 大小 + 它的数据大小
      var map = {};
      apps.forEach(function (a) {
        map[a.id] = {
          id: a.id,
          name: a.name || a.id,
          icon: a.icon || '',
          htmlBytes: byteLen(a.html || ''),
          dataBytes: 0,
          htmlCompressed: false
        };
      });

      data.forEach(function (rec) {
        if (!rec || !rec.key) return;
        var i = rec.key.indexOf(':');
        if (i < 0) return;
        var id = rec.key.slice(0, i);
        if (!map[id]) return;
        map[id].dataBytes += byteLen(JSON.stringify(rec.value));
      });

      var list = Object.keys(map).map(function (k) { return map[k]; });
      list.sort(function (a, b) { return (b.htmlBytes + b.dataBytes) - (a.htmlBytes + a.dataBytes); });
      return list;
    });
  }

  function renderUsageList() {
    computeUsageByApp().then(function (list) {
      if (!list.length) {
        $usageList.innerHTML = '<div class="storage-empty">还没有安装任何应用</div>';
        return;
      }
      var maxBytes = Math.max.apply(null, list.map(function (x) { return x.htmlBytes + x.dataBytes; })) || 1;

      $usageList.innerHTML = '';
      list.forEach(function (item) {
        var total = item.htmlBytes + item.dataBytes;
        var pct = Math.max(2, (total / maxBytes) * 100);

        var el = document.createElement('div');
        el.className = 'usage-item';

        var ic = document.createElement('div');
        ic.className = 'usage-icon';
        if (item.icon && /^(data:image\/|https?:\/\/|blob:)/i.test(item.icon)) {
          var img = document.createElement('img');
          img.src = item.icon; img.alt = '';
          ic.appendChild(img);
        } else {
          ic.textContent = (item.icon && String(item.icon).length <= 4)
            ? item.icon
            : (item.name || '?').charAt(0).toUpperCase();
        }
        el.appendChild(ic);

        var main = document.createElement('div');
        main.className = 'usage-main';
        var nm = document.createElement('div');
        nm.className = 'usage-name';
        nm.textContent = item.name;
        var sz = document.createElement('div');
        sz.className = 'usage-size';
        sz.textContent = formatBytes(total) +
          '（本体 ' + formatBytes(item.htmlBytes) + ' · 数据 ' + formatBytes(item.dataBytes) + '）';
        var bar = document.createElement('div');
        bar.className = 'usage-bar';
        var i2 = document.createElement('i');
        i2.style.width = pct + '%';
        bar.appendChild(i2);
        main.appendChild(nm);
        main.appendChild(sz);
        main.appendChild(bar);
        el.appendChild(main);

        var acts = document.createElement('div');
        acts.className = 'usage-acts';

        var clearBtn = document.createElement('button');
        clearBtn.className = 'usage-btn warn';
        clearBtn.textContent = '清除数据';
        clearBtn.addEventListener('click', function () {
          confirmBox('清除应用数据', '将清除「' + item.name + '」的存储数据（选中状态、进度等），应用本体保留。', '清除')
            .then(function (ok) {
              if (!ok) return;
              dbClearAppDataById(item.id).then(function () {
                toast('已清除 ' + item.name + ' 的数据');
                renderUsageList();
                updateUsage();
              }).catch(function () { toast('清除失败'); });
            });
        });
        acts.appendChild(clearBtn);

        var zipBtn = document.createElement('button');
        zipBtn.className = 'usage-btn';
        zipBtn.textContent = '压缩';
        zipBtn.addEventListener('click', function () {
          var app = allApps.filter(function (a) { return a.id === item.id; })[0];
          if (!app || !app.html) { toast('找不到应用'); return; }
          var before = byteLen(app.html);
          var after = compressHtml(app.html);
          var afterBytes = byteLen(after);
          if (afterBytes >= before) { toast('已经很小了，无需压缩'); return; }
          confirmBox('压缩存储', '将「' + item.name + '」的 HTML 从 ' + formatBytes(before) + ' 压缩到约 ' + formatBytes(afterBytes) + '。可能移除多余空白和注释。', '压缩')
            .then(function (ok) {
              if (!ok) return;
              app.html = after;
              dbPut(app).then(function () {
                toast('已压缩，节省 ' + formatBytes(before - afterBytes));
                renderUsageList();
                updateUsage();
              }).catch(function () { toast('压缩失败'); });
            });
        });
        acts.appendChild(zipBtn);

        el.appendChild(acts);
        $usageList.appendChild(el);
      });
    });
  }

  // 展开 / 收起
  $setUsage.addEventListener('click', function () {
    var on = $storagePanel.classList.toggle('on');
    $setUsage.classList.toggle('open', on);
    if (on) renderUsageList();
  });

  // ===== 设置：清空全部数据 =====
  var clearSelected = new Set();

  $setClearData.addEventListener('click', function () {
    $clearModal.classList.add('on');
    renderPicker($clearList, clearSelected, $clearSelected, $clearOk, true);
  });
  $clearCancel.addEventListener('click', function () { $clearModal.classList.remove('on'); });
  $clearModal.addEventListener('click', function (e) {
    if (e.target === $clearModal) $clearModal.classList.remove('on');
  });
  $clearAll.addEventListener('click', function () {
    clearSelected.clear();
    allApps.forEach(function (a) { clearSelected.add(a.id); });
    syncPicker($clearList, clearSelected, $clearSelected, $clearOk);
  });
  $clearNone.addEventListener('click', function () {
    clearSelected.clear();
    syncPicker($clearList, clearSelected, $clearSelected, $clearOk);
  });
  $clearOk.addEventListener('click', function () {
    var ids = Array.from(clearSelected);
    if (!ids.length) return;
    Promise.all(ids.map(function (id) { return dbClearAppDataById(id); }))
      .then(function () {
        $clearModal.classList.remove('on');
        toast('已清除 ' + ids.length + ' 个应用的数据');
        renderUsageList();
        updateUsage();
      })
      .catch(function () { toast('清除失败'); });
  });

  // ===== 导出：先选择 =====
  var exportSelected = new Set();

  $setExport.addEventListener('click', function () {
    $exportModal.classList.add('on');
    renderPicker($exportList, exportSelected, $exportSelected, $exportOk, true);
  });
  $exportCancel.addEventListener('click', function () { $exportModal.classList.remove('on'); });
  $exportModal.addEventListener('click', function (e) {
    if (e.target === $exportModal) $exportModal.classList.remove('on');
  });
  $exportAll.addEventListener('click', function () {
    exportSelected.clear();
    allApps.forEach(function (a) { exportSelected.add(a.id); });
    syncPicker($exportList, exportSelected, $exportSelected, $exportOk);
  });
  $exportNone.addEventListener('click', function () {
    exportSelected.clear();
    syncPicker($exportList, exportSelected, $exportSelected, $exportOk);
  });

  $exportOk.addEventListener('click', function () {
    var picked = allApps.filter(function (a) { return exportSelected.has(a.id); });
    if (!picked.length) return;
    var payload = {
      type: 'nano-appstore-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      apps: picked
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'nano-appstore-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $exportModal.classList.remove('on');
    toast('已导出 ' + picked.length + ' 个应用');
  });

  // ===== 导入备份 =====
  $setImport.addEventListener('click', function () { $backupInput.click(); });
  $backupInput.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    $backupInput.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var obj = JSON.parse(ev.target.result || '{}');
        var apps = Array.isArray(obj.apps) ? obj.apps : (Array.isArray(obj) ? obj : []);
        if (!apps.length) { toast('备份文件为空'); return; }
        Promise.all(apps.map(function (a) {
          if (!a || !a.id || !a.html) return Promise.resolve();
          a.installedAt = a.installedAt || Date.now();
          return dbPut(a);
        })).then(function () {
          toast('已导入 ' + apps.length + ' 个应用');
          refresh();
        }).catch(function () { toast('导入失败'); });
      } catch (err) { toast('备份文件解析失败'); }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(f);
  });

  // ===== 危险：选择式卸载 =====
  var uninstallSelected = new Set();

  $setUninstall.addEventListener('click', function () {
    $uninstallModal.classList.add('on');
    renderPicker($uninstallList, uninstallSelected, $uninstallSelected, $uninstallOk, true);
  });
  $uninstallCancel.addEventListener('click', function () { $uninstallModal.classList.remove('on'); });
  $uninstallModal.addEventListener('click', function (e) {
    if (e.target === $uninstallModal) $uninstallModal.classList.remove('on');
  });
  $uninstallAll.addEventListener('click', function () {
    uninstallSelected.clear();
    allApps.forEach(function (a) { uninstallSelected.add(a.id); });
    syncPicker($uninstallList, uninstallSelected, $uninstallSelected, $uninstallOk);
  });
  $uninstallNone.addEventListener('click', function () {
    uninstallSelected.clear();
    syncPicker($uninstallList, uninstallSelected, $uninstallSelected, $uninstallOk);
  });
  $uninstallOk.addEventListener('click', function () {
    var ids = Array.from(uninstallSelected);
    if (!ids.length) return;
    confirmBox('确认卸载', '将卸载选中的 ' + ids.length + ' 个应用，本体与数据都会被删除，无法恢复。', '卸载')
      .then(function (ok) {
        if (!ok) return;
        Promise.all(ids.map(function (id) {
          return Promise.all([dbDelete(id), dbClearAppDataById(id)]);
        })).then(function () {
          $uninstallModal.classList.remove('on');
          toast('已卸载 ' + ids.length + ' 个应用');
          refresh();
        }).catch(function () { toast('卸载失败'); });
      });
  });

  // ===== 导航 =====
  $nav.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    $nav.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    var tab = btn.dataset.tab;
    $pageStore.hidden = tab !== 'store';
    $pageSettings.hidden = tab !== 'settings';
    if (tab === 'settings') updateUsage();
  });

  // ===== 事件 =====
  $importBtn.addEventListener('click', function () { $fileInput.click(); });
  $fileInput.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    $fileInput.value = '';
    importFile(f);
  });
  $copyBtn.addEventListener('click', copyTemplate);
  $search.addEventListener('input', function () {
    keyword = this.value.trim();
    renderList();
  });

  // ===== 从 DIY 应用返回后刷新（图标/名称可能被应用自己改过） =====
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'nanoAppManifestChanged') refresh();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('pageshow', function () { refresh(); });

  // ===== 启动 =====
  refresh();

  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'pageLoaded', page: 'appstore' }, '*');
    }
  } catch (e) {}
})();
