(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  var APPS = [
    { id: 'chat', name: '聊天', icon: 'chat' }, { id: 'api', name: 'API', icon: 'api' }, { id: 'couple', name: '情侣空间', icon: 'couple' },
    { id: 'halo', name: 'Halo', icon: 'halo' }, { id: 'instagram', name: 'Instagram', icon: 'instagram' }, { id: 'together', name: 'Books', icon: 'together' },
    { id: 'music', name: '音乐', icon: 'music' }, { id: 'memory', name: '记忆宫殿', icon: 'memory' }, { id: 'imessage', name: 'iMessage', icon: 'imessage' },
    { id: 'qa', name: '问答邮箱', icon: 'qa' }, { id: 'pomodoro', name: '番茄钟', icon: 'pomodoro' }, { id: 'nano', name: 'Nano', icon: 'nano' },
    { id: 'peek', name: '窥屏', icon: 'peek' }, { id: 'market', name: '共享集市', icon: 'market' }, { id: 'shop', name: '商城', icon: 'shop' },
    { id: 'schedule', name: '日程', icon: 'schedule' }, { id: 'mcp', name: 'MCP', icon: 'mcp' }, { id: 'tide', name: '月潮', icon: 'tide' },
    { id: 'fanfic', name: '同人文', icon: 'fanfic' }, { id: 'store', name: '应用商店', icon: 'store' }, { id: 'book', name: '世界书', icon: 'book' },
    { id: 'beauty', name: '美化', icon: 'beauty' }, { id: 'phone', name: '查手机', icon: 'phone' }, { id: 'settings', name: '设置', icon: 'settings' }
  ];

const APP_ICONS = {
 chat:'<path d="M5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7l-5.5 3.5V17A3 3 0 0 1 3 14V7a3 3 0 0 1 2-3Zm2.5 5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm4.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"/>',
 /* API：代码括号 + 斜杠 */
 api:'<path d="M8.7 7.3 4 12l4.7 4.7 1.4-1.4L6.8 12l3.3-3.3-1.4-1.4Zm6.6 0-1.4 1.4 3.3 3.3-3.3 3.3 1.4 1.4L20 12l-4.7-4.7ZM13.9 4h-2.2l-2 16h2.2l2-16Z"/>',
 couple:'<path d="M12 21s-8.5-5.2-9.8-10.4C1.1 6.1 6.7 2.5 10.4 6L12 7.7 13.6 6c3.7-3.5 9.3.1 8.2 4.6C20.5 15.8 12 21 12 21Z"/>',
 halo:'<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 3a7 7 0 0 1 6.9 6H14a2 2 0 0 0-4 0H5.1A7 7 0 0 1 12 5Zm0 14a7 7 0 0 1-6.9-6H10a2 2 0 0 0 4 0h4.9a7 7 0 0 1-6.9 6Z"/>',
 instagram:'<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7Zm5 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm5.5-4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z"/>',
 /* 一起看 = 一起看书：翻开的书 */
 together:'<path fill-rule="evenodd" d="M2.5 5.4C5.8 4.8 9.2 5.3 11.2 6.9v12.4C9.2 17.9 5.8 17.5 2.5 18.1ZM5 9.4h4.6v1.5H5ZM5 12.4h4.6v1.5H5ZM21.5 5.4C18.2 4.8 14.8 5.3 12.8 6.9v12.4c2-1.4 5.4-1.8 8.7-1.2ZM14.4 9.4H19v1.5h-4.6ZM14.4 12.4H19v1.5h-4.6Z"/>',
 music:'<path d="M19 3v12.2a4 4 0 1 1-2-3.5V7l-8 2v9.2a4 4 0 1 1-2-3.5V6l12-3Z"/>',
 memory:'<g transform="scale(.046875)"><path d="M184 0c30.9 0 56 25.1 56 56V456c0 30.9-25.1 56-56 56c-28.9 0-52.7-21.9-55.7-50.1c-5.2 1.4-10.7 2.1-16.3 2.1c-35.3 0-64-28.7-64-64c0-7.4 1.3-14.6 3.6-21.2C21.4 367.4 0 338.2 0 304c0-31.9 18.7-59.5 45.8-72.3C37.1 220.8 32 207 32 192c0-30.7 21.6-56.3 50.4-62.6C80.8 123.9 80 118 80 112c0-29.9 20.6-55.1 48.3-62.1C131.3 21.9 155.1 0 184 0zM328 0c28.9 0 52.6 21.9 55.7 49.9c27.8 7 48.3 32.1 48.3 62.1c0 6-.8 11.9-2.4 17.4c28.8 6.2 50.4 31.9 50.4 62.6c0 15-5.1 28.8-13.8 39.7C493.3 244.5 512 272.1 512 304c0 34.2-21.4 63.4-51.6 74.8c2.3 6.6 3.6 13.8 3.6 21.2c0 35.3-28.7 64-64 64c-5.6 0-11.1-.7-16.3-2.1c-3 28.2-26.8 50.1-55.7 50.1c-30.9 0-56-25.1-56-56V56c0-30.9 25.1-56 56-56z"/></g>',
 imessage:'<path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-5l-4 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5v2h12V8H6Zm0 4v2h8v-2H6Z"/>',
 peek:'<path d="M12 5c-5.5 0-9.5 5.5-10 7 1.5 3 5 7 10 7s8.5-4 10-7c-.5-1.5-4.5-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
 market:'<path d="M4 3h16l2 5v2a3 3 0 0 1-2 2.8V21H4v-8.2A3 3 0 0 1 2 10V8l2-5Zm1.4 2L4.2 8h15.6l-1.2-3H5.4ZM6 13v6h12v-6H6Zm2 1h8v2H8v-2Z"/>',
 mcp:'<path d="M16 7V3h-2v4h-4V3H8v4H6v3c0 2.21 1.79 4 4 4h1v6h2v-6h1c2.21 0 4-1.79 4-4V7h-2Z"/>',
 tide:'<path d="M2 8c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v3c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2V8Zm0 7c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v3c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2v-3Z"/>',
 fanfic:'<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/>',
 store:'<path d="M12 2 3 6v5c0 5.5 3.8 9.8 9 11 5.2-1.2 9-5.5 9-11V6l-9-4Zm0 3.2 6 2.7V11c0 4-2.5 7.4-6 8.6-3.5-1.2-6-4.6-6-8.6V7.9l6-2.7Zm-1 3.3v3H8v2h3v3h2v-3h3v-2h-3v-3h-2Z"/>',
 /* 世界书：地球 */
 book:'<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3.1a15.7 15.7 0 0 0-1.4-4.1A8 8 0 0 1 18.9 8ZM12 4c.8 1.2 1.4 2.5 1.8 4h-3.6c.4-1.5 1-2.8 1.8-4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.3a17 17 0 0 0 0 4H4.3Zm.8 2h3.1c.3 1.5.8 2.9 1.4 4.1A8 8 0 0 1 5.1 16Zm3.1-8H5.1a8 8 0 0 1 4.5-4.1A15.7 15.7 0 0 0 8.2 8ZM12 20c-.8-1.2-1.4-2.5-1.8-4h3.6c-.4 1.5-1 2.8-1.8 4Zm2.2-6H9.8a15 15 0 0 1 0-4h4.4a15 15 0 0 1 0 4Zm.4 6.1c.6-1.2 1.1-2.6 1.4-4.1h3.1a8 8 0 0 1-4.5 4.1ZM16.7 14a17 17 0 0 0 0-4h3.3a8.2 8.2 0 0 1 0 4h-3.3Z"/>',
 beauty:'<path d="M12 2 14.4 8.6 21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2Zm7 13 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
 settings:'<path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-6l-.4 3a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 1.7 1L9 21h6l.4-3a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.5-2.1-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/>',
 phone:'<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h10V5H7Zm4 15h2v1h-2v-1Z"/>',
 schedule:'<path fill-rule="evenodd" d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2ZM5 9v11h14V9H5Zm3 3h3v3H8Zm5 0h3v3h-3Z"/>',
 shop:'<path d="M18 6h-2a4 4 0 0 0-8 0H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Zm-6-2a2 2 0 0 1 2 2h-4a2 2 0 0 1 2-2Zm6 16H6V8h2v2h2V8h4v2h2V8h2v12Z"/>',
 qa:'<path d="M11.6 3C7.96 3 5 5.96 5 9.6h3.2c0-1.88 1.52-3.4 3.4-3.4s3.4 1.52 3.4 3.4c0 1.3-.74 2.43-1.83 2.99-1.84.94-3.37 2.87-3.37 5.11V19h3.2v-1.3c0-.96.55-1.83 1.42-2.27 2.02-1.03 3.38-3.12 3.38-5.83C17.6 5.96 14.64 3 11.6 3ZM9.8 20.4h3.2V24H9.8z"/>',
 pomodoro:'<path d="M12 4a8 8 0 1 0 8 8 8 8 0 0 0-8-8Zm0 3a5 5 0 1 1-5 5 5 5 0 0 1 5-5Zm-1 1.5V13l3.5 2 1-1.7L13 12V8.5ZM9 1h6v2H9z"/>',
 nano:'<path d="M12 1.8c.88 4.7 4.4 8.22 9.1 9.1-4.7.88-8.22 4.4-9.1 9.1-.88-4.7-4.4-8.22-9.1-9.1 4.7-.88 8.22-4.4 9.1-9.1Z"/><path d="M19.4 2.2c.18.96.82 1.6 1.78 1.78-.96.18-1.6.82-1.78 1.78-.18-.96-.82-1.6-1.78-1.78.96-.18 1.6-.82 1.78-1.78Z"/>'
};

  function appIconHtml(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (APP_ICONS[name] || APP_ICONS.book) + '</svg>';
  }

  var IDB_BG = 'nano_desktop_bg';
  var IDB_CUSTOM = 'nano_app_custom';
  var IDB_PRESETS = 'nano_desktop_presets';
  var IDB_LAYOUT = 'nano_widget_layout_v1';
  var IDB_IMGS = 'nano_widget_images_v1';
  var LS_BG = 'nano_desktop_bg_ls';
  var LS_CUSTOM = 'nano_app_custom_ls';
  var CUSTOM_SOUND_KEY = 'nano_custom_sound';
  var toastTimer = null;
  var bg = null;
  var custom = {};
  var presets = [];
  var pendingIcon = '';
  var pendingIconMode = 'fill';
  var pendingAvatar = '';
  var editingApp = '';
  var maskData = { masks: [], currentMaskId: null };
  var currentUser = null;

  var NN = null;
  // 优先用当前文档自己的 NanoNotify：试听发生在当前 iframe 的用户手势里，
  // 用父窗口的实例经常拿不到手势，AudioContext 一直 suspended，听起来就是没声音。
  try { NN = window.NanoNotify || (window.parent && window.parent.NanoNotify ? window.parent.NanoNotify : null); } catch (e) {}
  function findNanoPush() {
    var chain = [];
    var w = window;
    for (var i = 0; i < 8; i++) {
      chain.push(w);
      try { if (w.parent && w.parent !== w) w = w.parent; else break; } catch (e) { break; }
    }
    // 优先用最顶层窗口的实例：权限、SW 注册和 localStorage 身份都以顶层为准。
    for (var j = chain.length - 1; j >= 0; j--) {
      try { if (chain[j].NanoPush) return chain[j].NanoPush; } catch (e) {}
    }
    return null;
  }
  var NP = null;
  try { NP = findNanoPush(); } catch (e) {}

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function post(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function openPage(url, title) {
    if (!post({ type: 'openFullscreen', url: url, title: title || '', showBack: true, source: 'settings' })) {
      try { location.href = url; } catch (e) {}
    }
  }

  function notifyHome(layout) {
    post({ type: 'nanoDesktopChanged', layout: !!layout });
  }

  function requestPersistStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    } catch (e) {}
  }

  function saveBgBoth(next) {
    var p = next ? NanoIDB.set(IDB_BG, next) : NanoIDB.del(IDB_BG);
    try {
      if (next) localStorage.setItem(LS_BG, JSON.stringify(next));
      else localStorage.removeItem(LS_BG);
    } catch (e) {}
    return p;
  }

  function saveCustomBoth(next) {
    var p = NanoIDB.set(IDB_CUSTOM, next || {});
    try { localStorage.setItem(LS_CUSTOM, JSON.stringify(next || {})); } catch (e) {}
    return p;
  }

  var sheetBack = null;

  function openSheet(title, html, onBack) {
    sheetBack = onBack || null;
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = html;
    $('modal').classList.add('show');
  }

  function closeSheet() {
    sheetBack = null;
    $('modal').classList.remove('show');
    $('sheetBody').innerHTML = '';
  }

  function backSheet() {
    if (sheetBack) {
      var f = sheetBack;
      sheetBack = null;
      f();
    } else {
      closeSheet();
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMB(n) {
    if (!isFinite(n) || n <= 0) return '0 MB';
    if (n > 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function idbOpen(name, version, stores) {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(name, version);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          (stores || []).forEach(function (s) {
            if (!db.objectStoreNames.contains(s.name)) {
              db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
            }
          });
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }

  function idbGet(name, version, store, key, stores) {
    return idbOpen(name, version, stores).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(store, 'readonly').objectStore(store).get(key);
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  function idbPut(name, version, store, value, stores) {
    return idbOpen(name, version, stores).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(value);
          tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(true); };
          tx.onerror = function () { try { db.close(); } catch (e) {} resolve(false); };
        } catch (e) { try { db.close(); } catch (e2) {} resolve(false); }
      });
    }).catch(function () { return false; });
  }

  function saveMaskData() {
    try { localStorage.setItem('nano_mask_data', JSON.stringify(maskData)); } catch (e) {}
    return idbPut('nano_mask_db', 1, 'mask_data', { key: 'data', value: maskData }, [{ name: 'mask_data', keyPath: 'key' }]);
  }

  function loadMask() {
    try {
      var raw = localStorage.getItem('nano_mask_data');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) return Promise.resolve(d);
      }
    } catch (e) {}
    return idbGet('nano_mask_db', 1, 'mask_data', 'data', [{ name: 'mask_data', keyPath: 'key' }]).then(function (row) {
      return row && row.value && Array.isArray(row.value.masks) ? row.value : { masks: [], currentMaskId: null };
    });
  }

  function currentMask(data) {
    if (!data || !data.masks || !data.masks.length) return null;
    return data.masks.find(function (m) { return String(m.id) === String(data.currentMaskId); }) || data.masks[0];
  }

  function getMaskAvatar(id) {
    return idbGet('MaskAvatarDB', 1, 'avatars', id, [{ name: 'avatars', keyPath: 'id' }]).then(function (row) {
      return row && row.data ? row.data : '';
    });
  }

  function resizeImage(file, max, type, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取失败')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片无法解析')); };
        img.onload = function () {
          var w = img.width, h = img.height, scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          try { resolve(canvas.toDataURL(type || 'image/jpeg', quality || .86)); }
          catch (e) { reject(e); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function loadAll() {
    return Promise.all([
      NanoIDB.get(IDB_BG),
      NanoIDB.get(IDB_CUSTOM),
      NanoIDB.get(IDB_PRESETS),
      loadMask()
    ]).then(function (r) {
      bg = r[0] || null;
      custom = r[1] && typeof r[1] === 'object' ? r[1] : {};
      if (!bg) {
        try { bg = JSON.parse(localStorage.getItem(LS_BG) || 'null'); } catch (e) {}
      }
      if (!r[1] || !Object.keys(custom).length) {
        try {
          var localCustom = JSON.parse(localStorage.getItem(LS_CUSTOM) || 'null');
          if (localCustom && typeof localCustom === 'object' && Object.keys(localCustom).length) {
            custom = localCustom;
            try { NanoIDB.set(IDB_CUSTOM, custom); } catch (e) {}
          }
        } catch (e) {}
      }
      try { if (bg && !r[0]) NanoIDB.set(IDB_BG, bg); } catch (e) {}
      presets = Array.isArray(r[2]) ? r[2] : [];
      var data = r[3];
      maskData = data && Array.isArray(data.masks) ? data : { masks: [], currentMaskId: null };
      currentUser = currentMask(maskData);
      renderInfo(currentUser, maskData);
    }).catch(function () {
      renderInfo(null, { masks: [] });
    });
  }

  function renderInfo(m, data) {
    var av = $('idAvatar'), nm = $('idName'), sub = $('idSub');
    if (!av || !nm || !sub) return;
    var name = m && m.name ? m.name : '纳米用户';
    nm.textContent = name;
    sub.textContent = '纳米 ID · 本地账号' + (data && data.masks ? ' · ' + data.masks.length + ' 个面具' : '');
    av.textContent = String(name).charAt(0).toUpperCase();
    av.style.backgroundImage = '';
    if (m && m.id) {
      getMaskAvatar(m.id).then(function (url) {
        if (!url) return;
        av.style.backgroundImage = 'url("' + String(url).replace(/"/g, '\\"') + '")';
        av.textContent = '';
      });
    }
  }

  /* ================= 内置通知栏外观 ================= */
  var NOTIFY_STYLE_KEY = 'nano_app_notify_style';
  var notifyCssAuto = false;
  function readNotifyStyle() {
    var out = { glass: 'frosted', avatar: 'circle', shape: 'pill', template: 'default', css: '', cleared: false };
    try {
      var o = JSON.parse(localStorage.getItem(NOTIFY_STYLE_KEY) || '{}') || {};
      if (o.glass === 'liquid') out.glass = 'liquid';
      if (o.avatar === 'square') out.avatar = 'square';
      if (o.shape === 'rounded') out.shape = 'rounded';
      if (['default', 'graypink', 'night', 'mint', 'sunset', 'clear'].indexOf(o.template) >= 0) out.template = o.template;
      out.css = String(o.css || '');
      out.cleared = !!o.cleared;
    } catch (e) {}
    return out;
  }
  // 从当前通知栏样式表里收集初始模板，填进可编辑输入框；清空后不会偷偷回填
  function collectNotifyTemplateCss() {
    var doc = document;
    try {
      if (window.parent && window.parent !== window && window.parent.document) doc = window.parent.document;
    } catch (e) {}
    var out = [];
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        try {
          if (r.type === 1) {
            if (String(r.selectorText || '').indexOf('.app-notify') > -1) out.push(r.cssText);
          } else if (r.type === 4 && r.cssRules) {
            var inner = [];
            for (var j = 0; j < r.cssRules.length; j++) {
              var rr = r.cssRules[j];
              if (rr.type === 1 && String(rr.selectorText || '').indexOf('.app-notify') > -1) inner.push(rr.cssText);
            }
            if (inner.length) out.push('@media ' + (r.conditionText || '') + '{\n' + inner.join('\n') + '\n}');
          }
        } catch (e) {}
      }
    }
    try {
      for (var s = 0; s < doc.styleSheets.length; s++) {
        try { if (doc.styleSheets[s].cssRules) walk(doc.styleSheets[s].cssRules); } catch (e) {}
      }
    } catch (e) {}
    return out.length ? '/* 内置通知栏初始模板（可直接修改；清空后使用内置样式） */\n' + out.join('\n') : '';
  }
  function writeNotifyStyle(s) {
    try { localStorage.setItem(NOTIFY_STYLE_KEY, JSON.stringify(s)); } catch (e) {}
    post({ type: 'notifyStyleChanged', style: s });
  }
  function notifyStyleFromUI() {
    var css = ($('notifyCss') && $('notifyCss').value) || '';
    var empty = !css.trim();
    if (notifyCssAuto && !empty) css = '';
    return {
      glass: ($('notifyGlass') && $('notifyGlass').value) || 'frosted',
      avatar: ($('notifyAvatarShape') && $('notifyAvatarShape').value) || 'circle',
      shape: ($('notifyShape') && $('notifyShape').value) || 'pill',
      template: ($('notifyTemplate') && $('notifyTemplate').value) || 'default',
      css: css,
      cleared: empty
    };
  }
  function renderNotifyStyle() {
    var s = readNotifyStyle();
    if ($('notifyGlass')) $('notifyGlass').value = s.glass;
    if ($('notifyAvatarShape')) $('notifyAvatarShape').value = s.avatar;
    if ($('notifyShape')) $('notifyShape').value = s.shape;
    if ($('notifyTemplate')) $('notifyTemplate').value = s.template;
    if ($('notifyCss')) {
      notifyCssAuto = !s.css && !s.cleared;
      $('notifyCss').value = s.css || (s.cleared ? '' : collectNotifyTemplateCss());
    }
  }
  function previewNotifyStyle() {
    var s = notifyStyleFromUI();
    writeNotifyStyle(s);
    var avatar = (currentUser && currentUser.avatar) || '';
    var ok = post({ type: 'notifyPreview', title: '通知预览', body: '毛玻璃、头像与胶囊形状会实时生效', name: '通知预览', avatar: avatar });
    if (!ok) {
      try {
        if (window.parent && window.parent.__nanoAppNotify) window.parent.__nanoAppNotify('通知预览', '毛玻璃、头像与胶囊形状会实时生效', 'preview', { name: '通知预览', avatar: avatar, target: '' });
      } catch (e) {}
    }
    toast('已保存并预览');
  }

  function renderValues() {
    var bgv = $('bgValue');
    if (bgv) bgv.textContent = bg && bg.type === 'image' ? '自定义图片' : (bg && bg.type === 'color' ? '纯色' : '默认');
    var av = $('appsValue');
    if (av) {
      var n = Object.keys(custom || {}).length;
      av.textContent = n ? n + ' 个已自定义' : '默认';
    }
    var pv = $('presetsValue');
    if (pv) pv.textContent = presets.length + ' 个';
    var size = $('ballSize');
    var sizeVal = $('ballSizeValue');
    var settings = readBall();
    if (size) size.value = String(settings.size || 52);
    if (sizeVal) sizeVal.textContent = String(settings.size || 52);
    var bt = $('ballToggle');
    if (bt) bt.checked = settings.enabled !== false;
    var bp = $('ballPreview');
    if (bp) {
      bp.style.width = (settings.size || 52) + 'px';
      bp.style.height = (settings.size || 52) + 'px';
      bp.innerHTML = settings.image
        ? '<img src="' + esc(settings.image) + '" alt="">'
        : '<i class="ball-core"></i>';
    }
    var bs = $('ballStyleValue');
    if (bs) bs.textContent = settings.image ? '自定义图片' : '经典样式';
    var brs = $('ballResetStyle');
    if (brs) brs.style.display = settings.image ? '' : 'none';
    refreshStorage();
    refreshNotify();
  }

  function readBall() {
    try {
      var raw = localStorage.getItem('nanoApiBall');
      var s = raw ? JSON.parse(raw) : {};
      return Object.assign({ enabled: true, size: 52, icon: 'classic', x: null, y: null }, s || {});
    } catch (e) {
      return { enabled: true, size: 52, icon: 'classic', x: null, y: null };
    }
  }

  function writeBall(settings) {
    try { localStorage.setItem('nanoApiBall', JSON.stringify(settings)); } catch (e) {}
    post({ type: 'apiBallSettings', settings: settings });
    var sizeVal = $('ballSizeValue');
    if (sizeVal) sizeVal.textContent = String(settings.size || 52);
  }

  function refreshStorage() {
    var el = $('storageUsage');
    if (!el) return;
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (e) {
        el.textContent = fmtMB(e.usage || 0) + ' / ' + fmtMB(e.quota || 0);
      }).catch(function () { el.textContent = '不可用'; });
    } else {
      el.textContent = '不可用';
    }
  }

  function refreshNotify() {
    var keep = $('keepToggle');
    if (keep) keep.checked = localStorage.getItem('nano_keep_alive') === '1';
    var notify = $('notifyToggle');
    if (notify) notify.checked = localStorage.getItem('nano_notify_enabled') === '1';
    loadCustomSoundThenFill();
    refreshPush();
    renderNotifyStyle();
  }

  function loadCustomSoundThenFill() {
    return NanoIDB.get(CUSTOM_SOUND_KEY).then(function (v) {
      if (v && v.url && NN && NN.setCustomSound) NN.setCustomSound(v.url);
      var nameEl = $('customSoundName');
      if (nameEl) nameEl.textContent = v && v.name ? v.name : '未上传';
      fillSounds(true);
    }).catch(function () { fillSounds(true); });
  }

  function fillSounds(reset) {
    var sel = $('soundSelect');
    if (!sel || !NN || !NN.sounds) return;
    if (sel.options.length && !reset) return;
    var cur = localStorage.getItem('nano_notify_sound') || 'ding';
    sel.innerHTML = '';
    NN.sounds.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id || s.key || s.name;
      o.textContent = s.name || s.label || s.id || '提示音';
      if (o.value === cur) o.selected = true;
      sel.appendChild(o);
    });
    if (NN.getCustomSound && NN.getCustomSound()) {
      var c = document.createElement('option');
      c.value = 'custom';
      c.textContent = '自定义 MP3';
      if (cur === 'custom') c.selected = true;
      sel.appendChild(c);
    }
  }

  function refreshPush() {
    var status = $('webPushStatus');
    var btn = $('webPushBtn');
    var toggle = $('webPushToggle');
    if (!NP) {
      if (status) status.textContent = '未加载';
      if (btn) btn.textContent = '不可用';
      if (toggle) { toggle.checked = false; toggle.disabled = true; }
      return;
    }
    Promise.resolve(NP.status ? NP.status() : null).then(function (s) {
      if (!s) {
        if (status) status.textContent = '可开启';
        if (btn) btn.textContent = '开启';
        if (toggle) toggle.checked = false;
        return;
      }
      if (toggle) toggle.checked = !!s.subscribed;
      if (status) {
        if (s.permission === 'denied') status.textContent = '权限被拒绝（到系统设置允许 Nano 通知）';
        else if (s.permission === 'unsupported') status.textContent = '此环境不支持系统通知';
        else if (s.permission !== 'granted') status.textContent = '需要允许通知后开启';
        else if (s.subscribed) status.textContent = '已开启';
        else if (s.configured) status.textContent = '已配置，等待订阅';
        else status.textContent = '未订阅';
      }
      if (btn) btn.textContent = s.subscribed ? '重新订阅' : '开启';
      // 浏览器显示「已订阅」不代表服务端真的会推：再问一次 Worker 有没有配置和订阅。
      if (s.subscribed && status) {
        status.textContent = '已开启 · 检查服务端…';
        var qs = '?appId=' + encodeURIComponent(s.appId || '') +
          '&deviceId=' + encodeURIComponent(s.deviceId || '') +
          '&userId=' + encodeURIComponent(s.userId || '') +
          '&token=' + encodeURIComponent((localStorage.getItem('nano_peek_token') || localStorage.getItem('nano_push_token') || ''));
        var sctrl = null, st = null;
        try { sctrl = new AbortController(); st = setTimeout(function () { try { sctrl.abort(); } catch (e) {} }, 6000); } catch (e) {}
        fetch(pushEndpoint() + '/auto/status' + qs, { cache: 'no-store', signal: sctrl ? sctrl.signal : undefined })
          .then(function (r) {
            if (r.status === 401) return { __unauthorized: true };
            return r.json();
          })
          .then(function (j) {
            if (st) { clearTimeout(st); st = null; }
            if (j && j.__unauthorized) {
              status.textContent = '已开启 · 服务端设置了 PUSH_TOKEN，请先填写令牌';
              return;
            }
            if (!j || !j.ok) { status.textContent = '已开启 · 服务端未响应'; return; }
            if (j.vapidOk === false) {
              status.textContent = '已开启 · 服务端 VAPID 不可用，请检查 Worker 的 D1 绑定';
              return;
            }
            if (!j.subs) {
              // 浏览器里已有订阅、服务端却没有（换过 Worker/清过 KV/换过面具）时自动补登记。
              // 只补写已有订阅，绝不在非用户手势里申请权限或重建订阅——那才是
              // 「补登记失败 / 通知权限未开启」反复出现的根因。
              status.textContent = '已开启 · 服务端没有订阅记录，正在自动补登记…';
              // 每次打开设置页只自动补登记一次，避免服务端异常时无限重试/一直刷错误。
              if (refreshPush._autoSynced) {
                status.textContent = '已开启 · 服务端没有订阅记录，请点「重新订阅」';
                return;
              }
              if (!refreshPush._reregistering && NP && NP.syncSubscription) {
                refreshPush._autoSynced = true;
                refreshPush._reregistering = true;
                Promise.resolve(NP.syncSubscription()).then(function (ok) {
                  refreshPush._reregistering = false;
                  if (ok) { setTimeout(refreshPush, 1200); }
                  else if (status) status.textContent = '已开启 · 浏览器里没有可登记的通知订阅，请点「重新订阅」';
                }).catch(function (err) {
                  refreshPush._reregistering = false;
                  if (status) status.textContent = '自动补登记失败：' + ((err && err.message) || '未知错误') + '；请点「重新订阅」';
                });
              }
              return;
            }
            if (!j.configured || !j.enabled) { status.textContent = '已开启 · 主动消息尚未同步（打开一次私聊后生效）'; return; }
            var when = '';
            if (j.nextMsgAt) {
              var d = new Date(j.nextMsgAt);
              when = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
            }
            status.textContent = '已开启 · 后台运行中' + (when ? ('（下次 ' + when + '）') : '');
          })
          .catch(function () { if (st) clearTimeout(st); status.textContent = '已开启 · 服务端检查失败（超时或网络异常）'; });
      }
    }).catch(function () { if (status) status.textContent = '检查失败'; });
  }

  function setBg(next) {
    bg = next;
    renderValues();
    Promise.resolve(saveBgBoth(next)).then(function () { notifyHome(false); });
  }

  function openBgSheet() {
    openSheet('桌面背景',
      '<button class="sheet-btn" id="pickBg">选择图片</button>' +
      '<div class="swatches">' +
        '<button class="swatch" data-color="#ffffff" style="background:#fff" aria-label="白色"></button>' +
        '<button class="swatch" data-color="#f2f2f7" style="background:#f2f2f7" aria-label="浅灰"></button>' +
        '<button class="swatch" data-color="#d1d1d6" style="background:#d1d1d6" aria-label="灰色"></button>' +
        '<button class="swatch" data-color="#8e8e93" style="background:#8e8e93" aria-label="深灰"></button>' +
        '<button class="swatch" data-color="#111111" style="background:#111" aria-label="黑色"></button>' +
      '</div>' +
      '<button class="sheet-btn grey" id="resetBg">恢复默认背景</button>'
    );
    var pick = $('pickBg');
    if (pick) pick.addEventListener('click', function () { $('bgFile').click(); });
    var reset = $('resetBg');
    if (reset) reset.addEventListener('click', function () { setBg(null); closeSheet(); toast('已恢复默认背景'); });
    $('sheetBody').querySelectorAll('.swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        setBg({ type: 'color', value: b.dataset.color, at: Date.now() });
        closeSheet();
        toast('桌面背景已更新');
      });
    });
  }

  function globalIconMode() {
    return custom.__iconMode === 'free' ? 'free' : 'fill';
  }
  function toggleGlobalIconMode() {
    custom.__iconMode = globalIconMode() === 'free' ? 'fill' : 'free';
    saveCustomBoth(custom).then(function () { notifyHome(false); });
    renderValues();
    openAppsSheet();
    toast(custom.__iconMode === 'free' ? '全部 App：不保留外部包裹器' : '全部 App：保留白色包裹器');
  }

  function openAppsSheet() {
    var gmode = globalIconMode();
    var wrapOn = gmode !== 'free';
    var rows = '<button class="icon-wrap-toggle' + (wrapOn ? ' on' : '') + '" id="toggleIconWrap" type="button" role="switch" aria-checked="' + (wrapOn ? 'true' : 'false') + '">' +
      '<span class="iw-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3.5" y="3.5" width="12" height="12" rx="3.5"/>' +
        '<rect x="8.5" y="8.5" width="12" height="12" rx="3.5" fill="currentColor" stroke="none" opacity=".16"/>' +
        '<rect x="8.5" y="8.5" width="12" height="12" rx="3.5"/>' +
      '</svg></span>' +
      '<span class="iw-main"><span class="iw-title">外部包裹器</span>' +
      '<span class="iw-sub">' + (wrapOn ? '自定义图标套一层白色圆角底' : '按图片自身轮廓显示，不加底') + '</span></span>' +
      '<span class="iw-pill"><span class="iw-dot"></span><span class="iw-state">' + (wrapOn ? '保留' : '不保留') + '</span></span>' +
      '</button>' +
      APPS.map(function (a) {
      var c = custom[a.id] || {};
      var name = c.name || a.name;
      var preview = c.icon
        ? ((custom.__iconMode || c.iconMode || 'fill') !== 'free'
          ? '<span class="app-preview-wrap"><img class="app-preview-custom fill" src="' + esc(c.icon) + '" alt=""></span>'
          : '<img class="app-preview-custom" src="' + esc(c.icon) + '" alt="">')
        : '<span class="app-preview">' + appIconHtml(a.icon) + '</span>';
      return '<button class="list-row" data-app="' + a.id + '">' + preview +
        '<span class="list-main"><span class="list-name">' + esc(name) + '</span><span class="list-sub">' + esc(c.name || c.icon ? '已自定义' : '默认') + '</span></span>' +
        '<span class="chev">›</span></button>';
    }).join('');
    openSheet('App 图标与名称', rows);
    var toggle = $('toggleIconWrap');
    if (toggle) toggle.addEventListener('click', toggleGlobalIconMode);
    $('sheetBody').querySelectorAll('[data-app]').forEach(function (row) {
      row.addEventListener('click', function () { openAppEditor(row.dataset.app); });
    });
  }

  function openAppEditor(id) {
    var a = APPS.find(function (x) { return x.id === id; });
    if (!a) return;
    editingApp = id;
    pendingIcon = (custom[id] && custom[id].icon) || '';
    pendingIconMode = custom.__iconMode || (custom[id] && custom[id].iconMode) || 'fill';
    var name = (custom[id] && custom[id].name) || a.name;
    openSheet('编辑 ' + a.name,
      '<div class="edit-preview"><span class="edit-icon-box" id="editIconBox">' + (pendingIcon ? '<img class="app-preview-custom edit' + (pendingIconMode === 'fill' ? ' fill' : '') + '" src="' + esc(pendingIcon) + '" alt="">' : '<span class="app-preview">' + appIconHtml(a.icon) + '</span>') + '</span>' +
      '<button class="mini-btn" id="pickIcon">选择图标</button></div>' +
      '<input class="edit-name" id="editName" maxlength="12" value="' + esc(name) + '" placeholder="App 名称">' +
      '<button class="sheet-btn" id="saveApp">保存</button>' +
      '<button class="sheet-btn grey" id="resetApp">恢复默认</button>',
      function () { openAppsSheet(); }
    );
    var pick = $('pickIcon');
    if (pick) pick.addEventListener('click', function () { $('iconFile').click(); });
    var save = $('saveApp');
    if (save) save.addEventListener('click', function () {
      var v = ($('editName').value || '').trim() || a.name;
      var patch = {};
      if (v !== a.name) patch.name = v;
      if (pendingIcon) { patch.icon = pendingIcon; }
      if (Object.keys(patch).length) custom[id] = patch; else delete custom[id];
      saveCustomBoth(custom).then(function () { notifyHome(false); });
      renderValues();
      openAppsSheet();
      toast('已保存');
    });
    var reset = $('resetApp');
    if (reset) reset.addEventListener('click', function () {
      delete custom[id];
      saveCustomBoth(custom).then(function () { notifyHome(false); });
      renderValues();
      openAppsSheet();
      toast('已恢复默认');
    });
  }

  function openProfileEdit() {
    if (!currentUser) {
      toast('没有可编辑的面具');
      openPage('mask.html', '面具');
      return;
    }
    pendingAvatar = '';
    var name = currentUser.name || '未命名';
    var avatarHtml = currentUser.avatar
      ? '<img src="' + esc(currentUser.avatar) + '" alt="">'
      : esc(String(name).charAt(0).toUpperCase());
    openSheet('编辑资料',
      '<div class="edit-preview">' +
        '<span class="profile-edit-avatar" id="profilePreview">' + avatarHtml + '</span>' +
        '<button class="mini-btn" id="pickAvatar">选择头像</button>' +
      '</div>' +
      '<input class="edit-name" id="editProfileName" maxlength="16" value="' + esc(name) + '" placeholder="昵称">' +
      '<button class="sheet-btn" id="saveProfile">保存</button>'
    );
    getMaskAvatar(currentUser.id).then(function (url) {
      if (!url) return;
      currentUser.avatar = url;
      var p = $('profilePreview');
      if (p) p.innerHTML = '<img src="' + esc(url) + '" alt="">';
    });
    var pick = $('pickAvatar');
    if (pick) pick.addEventListener('click', function () {
      var f = $('avatarFile');
      if (f) f.click();
    });
    var save = $('saveProfile');
    if (save) save.addEventListener('click', function () {
      var v = ($('editProfileName').value || '').trim() || '未命名';
      currentUser.name = v;
      var idx = (maskData.masks || []).findIndex(function (m) { return String(m.id) === String(currentUser.id); });
      if (idx >= 0) maskData.masks[idx].name = v;
      var tasks = [];
      tasks.push(NanoIDB ? Promise.resolve(saveMaskData()) : Promise.resolve(false));
      if (pendingAvatar) {
        tasks.push(idbPut('MaskAvatarDB', 1, 'avatars', { id: currentUser.id, data: pendingAvatar }, [{ name: 'avatars', keyPath: 'id' }]));
        currentUser.avatar = pendingAvatar;
        if (idx >= 0) maskData.masks[idx].avatar = pendingAvatar;
      }
      Promise.all(tasks).then(function () {
        post({ type: 'currentMaskChanged', maskId: currentUser.id, data: maskData });
        post({ type: 'homeDataUpdated', data: maskData });
        renderInfo(currentUser, maskData);
        closeSheet();
        toast('资料已保存');
      });
    });
  }

  function openPresetsSheet() {
    var html = '<button class="sheet-btn" id="savePreset">保存当前桌面为预设</button>';
    if (presets.length) {
      html += presets.map(function (p) {
        return '<div class="list-row" data-preset="' + esc(p.id) + '">' +
          '<span class="list-main"><span class="list-name">' + esc(p.name || '未命名预设') + '</span>' +
          '<span class="list-sub">' + new Date(p.at || Date.now()).toLocaleString() + '</span></span>' +
          '<span class="preset-actions">' +
            '<button class="mini-btn dark" data-act="apply">切换</button>' +
            '<button class="mini-btn" data-act="overwrite">覆盖</button>' +
            '<button class="mini-btn" data-act="delete">删除</button>' +
          '</span></div>';
      }).join('');
    } else {
      html += '<div class="note">还没有预设。保存后会出现在这里，可以随时切换、覆盖或删除。</div>';
    }
    openSheet('桌面装饰预设', html);
    var save = $('savePreset');
    if (save) save.addEventListener('click', savePreset);
    $('sheetBody').querySelectorAll('[data-preset]').forEach(function (row) {
      var id = row.dataset.preset;
      row.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var act = b.dataset.act;
          if (act === 'apply') applyPreset(id);
          else if (act === 'overwrite') overwritePreset(id);
          else if (act === 'delete') deletePreset(id);
        });
      });
    });
  }

  async function savePreset() {
    var name = prompt('预设名称', '桌面 ' + (presets.length + 1));
    if (name == null) return;
    name = String(name).trim() || '未命名预设';
    var layout = await NanoIDB.get(IDB_LAYOUT);
    var imgs = await NanoIDB.get(IDB_IMGS);
    presets.push({ id: 'p' + Date.now(), name: name, at: Date.now(), bg: bg, apps: custom, layout: layout || null, imgs: imgs || null });
    await NanoIDB.set(IDB_PRESETS, presets);
    renderValues();
    openPresetsSheet();
    toast('预设已保存');
  }

  async function applyPreset(id) {
    var p = presets.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    bg = p.bg || null;
    custom = p.apps && typeof p.apps === 'object' ? p.apps : {};
    await saveBgBoth(bg);
    await saveCustomBoth(custom);
    if (p.layout) await NanoIDB.set(IDB_LAYOUT, p.layout);
    else await NanoIDB.del(IDB_LAYOUT);
    if (p.imgs) await NanoIDB.set(IDB_IMGS, p.imgs);
    else await NanoIDB.del(IDB_IMGS);
    renderValues();
    notifyHome(true);
    closeSheet();
    toast('已切换到「' + (p.name || '预设') + '」');
  }

  async function overwritePreset(id) {
    var p = presets.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    var layout = await NanoIDB.get(IDB_LAYOUT);
    var imgs = await NanoIDB.get(IDB_IMGS);
    p.bg = bg;
    p.apps = custom;
    p.layout = layout || null;
    p.imgs = imgs || null;
    p.at = Date.now();
    await NanoIDB.set(IDB_PRESETS, presets);
    openPresetsSheet();
    toast('预设已更新');
  }

  async function deletePreset(id) {
    if (!confirm('删除这个预设？')) return;
    presets = presets.filter(function (x) { return String(x.id) !== String(id); });
    await NanoIDB.set(IDB_PRESETS, presets);
    renderValues();
    openPresetsSheet();
    toast('预设已删除');
  }

  function exportDesktop() {
    Promise.all([NanoIDB.get(IDB_LAYOUT), NanoIDB.get(IDB_IMGS)]).then(function (r) {
      var data = {
        version: 1,
        kind: 'nano-desktop-decoration',
        exportedAt: new Date().toISOString(),
        bg: bg,
        apps: custom,
        layout: r[0] || null,
        imgs: r[1] || null,
        presets: presets
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '纳米桌面装饰-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('已导出桌面装饰');
    });
  }

  function importDesktop(file) {
    var reader = new FileReader();
    reader.onload = async function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d || d.kind !== 'nano-desktop-decoration') throw new Error('不是桌面装饰文件');
        bg = d.bg || null;
        custom = d.apps && typeof d.apps === 'object' ? d.apps : {};
        var jobs = [];
        jobs.push(saveBgBoth(bg));
        jobs.push(saveCustomBoth(custom));
        jobs.push(d.layout ? NanoIDB.set(IDB_LAYOUT, d.layout) : NanoIDB.del(IDB_LAYOUT));
        jobs.push(d.imgs ? NanoIDB.set(IDB_IMGS, d.imgs) : NanoIDB.del(IDB_IMGS));
        if (Array.isArray(d.presets) && d.presets.length) {
          var ids = new Set(presets.map(function (p) { return String(p.id); }));
          d.presets.forEach(function (p) { if (p && p.id && !ids.has(String(p.id))) presets.push(p); });
          jobs.push(NanoIDB.set(IDB_PRESETS, presets));
        }
        await Promise.all(jobs);
        renderValues();
        notifyHome(true);
        toast('桌面装饰已导入');
      } catch (e) {
        toast(e && e.message ? e.message : '导入失败');
      }
    };
    reader.readAsText(file);
  }

  async function resetDesktop() {
    if (!confirm('还原默认桌面？背景、App 图标/名称和布局会恢复默认，预设会保留。')) return;
    bg = null;
    custom = {};
    await Promise.all([NanoIDB.del(IDB_BG), NanoIDB.del(IDB_CUSTOM), NanoIDB.del(IDB_LAYOUT), NanoIDB.del(IDB_IMGS)]);
    try {
      localStorage.removeItem('mpLayout4');
      localStorage.removeItem('mpImgs3');
      localStorage.removeItem(LS_BG);
      localStorage.removeItem(LS_CUSTOM);
    } catch (e) {}
    renderValues();
    notifyHome(true);
    toast('已还原默认桌面');
  }

  function pushEndpoint() {
    var endpoint = '';
    try { endpoint = (localStorage.getItem('nano_push_endpoint') || localStorage.getItem('nano_peek_url') || '').trim(); } catch (e) {}
    if (!endpoint) endpoint = 'https://nanopush.nano315.online';
    return endpoint.replace(/\/+$/, '');
  }

  async function enablePush() {
    if (!NP) { toast('推送模块未加载'); return false; }
    // 安卓 Chrome 必须在用户手势里请求通知权限；放到 fetch 之后会丢失手势，
    // 表现为订阅失败（registration failed / push service error）。
    // 设置页在 iframe 里时，必须向顶层窗口请求，浏览器不认 iframe 的权限请求。
    try {
      var topWin = null;
      try { topWin = (window.top && window.top !== window) ? window.top : null; } catch (e0) { topWin = null; }
      var nWin = (topWin && topWin.Notification) ? topWin : (('Notification' in window) ? window : null);
      if (nWin && nWin.Notification && nWin.Notification.permission === 'default') {
        await nWin.Notification.requestPermission();
      }
    } catch (e) {}
    var endpoint = pushEndpoint();
    var key = '';
    try { key = (localStorage.getItem('nano_push_vapid') || '').trim(); } catch (e) {}
    var token = '';
    try { token = localStorage.getItem('nano_push_token') || localStorage.getItem('nano_peek_token') || ''; } catch (e) {}
    // 每次都向服务端确认当前 VAPID 公钥：Worker 换过密钥后，浏览器里旧的公钥
    // 会让订阅和新私钥对不上，推送服务直接拒绝，表现就是「一直开着但从来没推送」。
    var freshKey = '';
    var keyError = '';
    try {
      var vctrl = new AbortController();
      var vt = setTimeout(function () { try { vctrl.abort(); } catch (e) {} }, 6000);
      try {
        var r = await fetch(endpoint + '/vapid', { credentials: 'omit', cache: 'no-store', signal: vctrl.signal });
        var j = await r.json();
        freshKey = (j && (j.publicKey || j.vapid || j.key)) || '';
        keyError = (j && j.error) || '';
      } finally { clearTimeout(vt); }
    } catch (e) { keyError = (e && e.message) || ''; }
    if (freshKey) key = freshKey;
    if (!key) { toast(keyError || '服务端未返回 VAPID 公钥（请检查 Worker 的 D1 绑定）'); return false; }
    try {
      localStorage.setItem('nano_push_vapid', key);
      NP.setup(endpoint, key, token);
      // 强制重建订阅：旧订阅可能绑定着服务端已经换掉的 VAPID 私钥。
      await NP.enable(true);
      localStorage.setItem('nano_notify_enabled', '1');
      var testOk = true;
      try { if (NP.test) await NP.test(); } catch (e) { testOk = false; }
      refreshNotify();
      refreshPush();
      toast(testOk ? 'Web Push 已开启，已发送测试通知' : 'Web Push 已开启，但测试通知没弹出：请检查系统通知权限');
      return true;
    } catch (e) {
      toast(e && e.message ? e.message : '开启失败');
      var t = $('webPushToggle');
      if (t) t.checked = false;
      return false;
    }
  }

  /* ================= 界面安全区 ================= */
  var SHIFT_STEP = 4, SHIFT_MIN = -160, SHIFT_MAX = 200, INSET_DEFAULT = 48;
  var INSET_ENABLED_KEY = 'nano_top_inset_enabled';
  var SHIFT_KEYS = { top: 'nanoTopShift', bottom: 'nanoBottomShift', inset: 'nano_top_inset' };
  var SHIFT_VAL = { top: 'topShiftVal', bottom: 'bottomShiftVal', inset: 'insetShiftVal' };

  function shiftRead(key) {
    try {
      var v = localStorage.getItem(key);
      if (v === null || v === '') return key === SHIFT_KEYS.inset ? INSET_DEFAULT : 0;
      return parseInt(v, 10) || 0;
    } catch (e) { return key === SHIFT_KEYS.inset ? INSET_DEFAULT : 0; }
  }

  function insetEnabled() {
    try {
      var v = localStorage.getItem(INSET_ENABLED_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    try { return /iPhone|Android/i.test(navigator.userAgent); } catch (e) { return false; }
  }

  function shiftRender(target, n) {
    var el = $(SHIFT_VAL[target]);
    if (el) el.textContent = (n > 0 ? '+' : '') + n;
  }

  function shiftPostInset(enabled, value) {
    post({ type: 'nanoTopInset', enabled: !!enabled, value: value });
  }

  function shiftApply(target, n) {
    n = parseInt(n, 10) || 0;
    if (target === 'inset') n = Math.max(0, Math.min(220, n));
    else n = Math.max(SHIFT_MIN, Math.min(SHIFT_MAX, n));
    var key = SHIFT_KEYS[target];
    try { localStorage.setItem(key, String(n)); } catch (e) {}
    shiftRender(target, n);
    if (target === 'inset') { shiftPostInset(insetEnabled(), n); return; }
    post({ type: target === 'top' ? 'nanoTopShift' : 'nanoBottomShift', value: n });
  }

  function syncInsetUI() {
    var on = insetEnabled();
    var t = $('insetToggle');
    var row = $('insetNudgeRow');
    if (t) t.checked = on;
    if (row) row.style.display = on ? '' : 'none';
  }

  function initInterface() {
    document.querySelectorAll('.nudge-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = this.getAttribute('data-target');
        var dir = parseInt(this.getAttribute('data-dir'), 10) || 0;
        if (!target) return;
        if (target === 'inset') {
          if (dir === 0) {
            try { localStorage.removeItem(SHIFT_KEYS.inset); } catch (e) {}
            shiftRender('inset', INSET_DEFAULT);
            shiftPostInset(insetEnabled(), null);
            return;
          }
          shiftApply('inset', shiftRead(SHIFT_KEYS.inset) + dir * 2);
          return;
        }
        shiftApply(target, dir === 0 ? 0 : shiftRead(SHIFT_KEYS[target]) + dir * SHIFT_STEP);
      });
    });
    on('insetToggle', 'change', function () {
      var on = this.checked;
      try { localStorage.setItem(INSET_ENABLED_KEY, on ? '1' : '0'); } catch (e) {}
      syncInsetUI();
      shiftPostInset(on, on ? shiftRead(SHIFT_KEYS.inset) : null);
    });
    shiftRender('top', shiftRead(SHIFT_KEYS.top));
    shiftRender('bottom', shiftRead(SHIFT_KEYS.bottom));
    shiftRender('inset', shiftRead(SHIFT_KEYS.inset));
    syncInsetUI();
  }

  /* ================= 纳米助手 ================= */
  var NANO_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
    '<defs><linearGradient id="g" x1="8" y1="6" x2="72" y2="74" gradientUnits="userSpaceOnUse"><stop stop-color="#FFA6C5"/><stop offset=".55" stop-color="#F06A97"/><stop offset="1" stop-color="#CB3F72"/></linearGradient>' +
    '<radialGradient id="h" cx="0" cy="0" r="1" gradientTransform="translate(59 17) rotate(133) scale(54)"><stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="80" height="80" rx="22" fill="url(#g)"/>' +
    '<rect width="80" height="80" rx="22" fill="url(#h)"/>' +
    '<path d="M27 56V24l26 32V24" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round" opacity=".97"/>' +
    '<path d="M60.5 15.4c.72 4.4 4 7.68 8.4 8.4-4.4.72-7.68 4-8.4 8.4-.72-4.4-4-7.68-8.4-8.4 4.4-.72 7.68-4 8.4-8.4z" fill="#fff" opacity=".9"/>' +
    '<rect x="2.5" y="2.5" width="75" height="75" rx="20" fill="none" stroke="#fff" stroke-opacity=".25"/></svg>'
  );

  function ensureNanoCharacter(on) {
    return new Promise(function (resolve) {
      function run(attempt) {
        try {
          var req = indexedDB.open('nano_characters_db', 1);
          req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
          };
          req.onsuccess = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('characters')) {
              var empty = db.objectStoreNames.length === 0;
              try { db.close(); } catch (err) {}
              if (empty && attempt < 1) {
                var del = indexedDB.deleteDatabase('nano_characters_db');
                del.onsuccess = function () { run(attempt + 1); };
                del.onerror = function () { resolve(false); };
                return;
              }
              resolve(false);
              return;
            }
            try {
              var tx = db.transaction('characters', 'readwrite');
              var st = tx.objectStore('characters');
              var g = st.get('nano_ai');
              g.onsuccess = function () {
                var ex = g.result;
                try {
                  if (on) {
                    if (!ex) {
                      st.put({ id: 'nano_ai', name: '纳米', avatar: NANO_AVATAR, gender: '女', nationality: '中国', setting: '', bindUser: '', isNpc: true, nanoAssistant: true });
                    } else {
                      ex.name = ex.name || '纳米';
                      ex.isNpc = true;
                      ex.nanoAssistant = true;
                      st.put(ex);
                    }
                  } else if (ex) {
                    st.delete('nano_ai');
                  }
                } catch (err) {}
              };
              tx.oncomplete = function () { try { db.close(); } catch (err) {} resolve(true); };
              tx.onerror = function () { try { db.close(); } catch (err) {} resolve(false); };
            } catch (err) { try { db.close(); } catch (err2) {} resolve(false); }
          };
          req.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      }
      run(0);
    });
  }

  function initAssistant() {
    var t = $('nanoToggle');
    if (!t) return;
    var on = false;
    try { on = localStorage.getItem('nano_assistant_enabled') === '1'; } catch (e) {}
    t.checked = on;
    if (on) ensureNanoCharacter(true);
    t.addEventListener('change', function () {
      var v = this.checked;
      ensureNanoCharacter(v).then(function () {
        try { localStorage.setItem('nano_assistant_enabled', v ? '1' : '0'); } catch (e) {}
        post({ type: 'nanoCharUpdated' });
        post({ type: 'contactsDataUpdated' });
        post({ type: 'homeDataUpdated' });
        toast(v ? '纳米助手已开启' : '纳米助手已关闭');
      });
    });
  }

  function bind() {
    on('backBtn', 'click', function () {
      if (!post({ type: 'closeFullscreen' })) { try { history.back(); } catch (e) {} }
    });

    on('idCard', 'click', openProfileEdit);
    on('avatarFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      var done = function (url) {
        if (!url) return;
        pendingAvatar = url;
        var p = $('profilePreview');
        if (p) p.innerHTML = '<img src="' + esc(url) + '" alt="">';
      };
      if (window.NanoAvatarCrop) {
        NanoAvatarCrop.open(f, { outputSize: 360, aspect: 1, quality: 0.9, title: '裁剪头像' }).then(done).catch(function () { toast('头像处理失败'); });
        return;
      }
      resizeImage(f, 320, 'image/png').then(done).catch(function () { toast('头像处理失败'); });
    });

    on('rowBg', 'click', openBgSheet);
    on('rowApps', 'click', openAppsSheet);
    on('rowPresets', 'click', openPresetsSheet);
    on('rowImport', 'click', function () { var f = $('importFile'); if (f) f.click(); });
    on('rowExport', 'click', exportDesktop);
    on('rowReset', 'click', resetDesktop);

    on('bgFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      resizeImage(f, 1800, 'image/jpeg', .88).then(function (url) {
        setBg({ type: 'image', value: url, at: Date.now() });
        closeSheet();
        toast('桌面背景已更新');
      }).catch(function () { toast('图片处理失败'); });
      e.target.value = '';
    });

    on('iconFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      resizeImage(f, 320, 'image/png').then(function (url) {
        pendingIcon = url;
        var p = $('editIconBox');
        if (p) p.innerHTML = '<img class="app-preview-custom edit' + (pendingIconMode === 'fill' ? ' fill' : '') + '" src="' + esc(url) + '" alt="">';
      }).catch(function () { toast('图标处理失败'); });
      e.target.value = '';
    });

    on('importFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importDesktop(f);
      e.target.value = '';
    });

    on('sheetClose', 'click', backSheet);
    on('modal', 'click', function (e) { if (e.target === $('modal')) closeSheet(); });

    on('keepToggle', 'change', function () {
      var on = this.checked;
      try { localStorage.setItem('nano_keep_alive', on ? '1' : '0'); } catch (e) {}
      post({ type: 'keepAlive', enabled: on });
      if (on && navigator.wakeLock) { navigator.wakeLock.request('screen').catch(function () {}); }
    });

    on('notifyToggle', 'change', function () {
      var on = this.checked;
      try { localStorage.setItem('nano_notify_enabled', on ? '1' : '0'); } catch (e) {}
      post({ type: 'notifySetting', enabled: on });
      if (on && NN && NN.ensurePermission) { try { NN.ensurePermission(); } catch (e) {} }
    });

    on('webPushBtn', 'click', enablePush);
    on('webPushToggle', 'change', function () {
      var t = this;
      if (t.checked) {
        enablePush().then(function (ok) { if (!ok) t.checked = false; });
      } else if (NP && NP.disable) {
        Promise.resolve(NP.disable()).then(function () {
          toast('Web Push 已关闭');
          refreshPush();
        }).catch(function () { t.checked = true; });
      }
    });

    on('uploadSoundBtn', 'click', function () { var f = $('soundFile'); if (f) f.click(); });
    on('soundFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 12 * 1024 * 1024) { toast('铃声文件不能超过 12MB'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var data = { url: String(reader.result || ''), name: f.name || '自定义 MP3', at: Date.now() };
        NanoIDB.set(CUSTOM_SOUND_KEY, data).then(function () {
          if (NN && NN.setCustomSound) NN.setCustomSound(data.url);
          try { localStorage.setItem('nano_notify_sound', 'custom'); } catch (err) {}
          var nameEl = $('customSoundName');
          if (nameEl) nameEl.textContent = data.name;
          fillSounds(true);
          toast('铃声已保存');
        });
      };
      reader.readAsDataURL(f);
      e.target.value = '';
    });

    on('soundSelect', 'change', function () {
      try { localStorage.setItem('nano_notify_sound', this.value); } catch (e) {}
    });
    on('soundPreview', 'click', function () {
      if (NN && NN.playSound) { try { NN.playSound($('soundSelect').value); } catch (e) {} }
    });

    ['notifyGlass', 'notifyAvatarShape', 'notifyShape', 'notifyTemplate'].forEach(function (id) {
      on(id, 'change', function () { writeNotifyStyle(notifyStyleFromUI()); });
    });
    var notifyCssTimer = null;
    on('notifyCss', 'input', function () {
      notifyCssAuto = false;
      clearTimeout(notifyCssTimer);
      notifyCssTimer = setTimeout(function () { writeNotifyStyle(notifyStyleFromUI()); }, 180);
    });
    on('notifyCss', 'change', function () { notifyCssAuto = false; writeNotifyStyle(notifyStyleFromUI()); });
    on('notifyTemplateFill', 'click', function () {
      var ta = $('notifyCss');
      if (!ta) return;
      ta.value = collectNotifyTemplateCss();
      notifyCssAuto = true;
      writeNotifyStyle(notifyStyleFromUI());
      toast('已填入初始模板，可直接修改');
    });
    on('notifyCssClear', 'click', function () {
      var ta = $('notifyCss');
      if (!ta) return;
      ta.value = '';
      notifyCssAuto = false;
      writeNotifyStyle(notifyStyleFromUI());
      toast('已清空输入框');
    });
    on('notifyPreview', 'click', previewNotifyStyle);
    on('notifyStyleReset', 'click', function () {
      var def = { glass: 'frosted', avatar: 'circle', shape: 'pill', template: 'default', css: '', cleared: false };
      writeNotifyStyle(def);
      notifyCssAuto = false;
      renderNotifyStyle();
      toast('已恢复初始模板');
    });

    on('clearCache', 'click', function () {
      if (!window.caches) { toast('当前环境不支持'); return; }
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).then(function () { toast('缓存已清理'); refreshStorage(); });
    });
    on('storagePage', 'click', function () { openPage('storage.html', '储存'); });

    on('ballToggle', 'change', function () {
      var s = readBall();
      s.enabled = this.checked;
      writeBall(s);
    });
    on('ballSize', 'input', function () {
      var s = readBall();
      s.size = Number(this.value) || 52;
      var v = $('ballSizeValue');
      if (v) v.textContent = String(s.size);
      var bp = $('ballPreview');
      if (bp) { bp.style.width = s.size + 'px'; bp.style.height = s.size + 'px'; }
      writeBall(s);
    });
    on('ballResetPos', 'click', function () {
      var s = readBall();
      s.x = null;
      s.y = null;
      writeBall(s);
      toast('悬浮球位置已重置');
    });
    on('ballStyleRow', 'click', function () {
      var f = $('ballFile');
      if (f) f.click();
    });
    on('ballFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      resizeImage(f, 240, 'image/png').then(function (url) {
        var s = readBall();
        s.image = url;
        writeBall(s);
        renderValues();
        toast('悬浮球样式已更新');
      }).catch(function () { toast('图片处理失败'); });
      e.target.value = '';
    });
    on('ballResetStyle', 'click', function () {
      var s = readBall();
      delete s.image;
      writeBall(s);
      renderValues();
      toast('已恢复经典样式');
    });

    document.querySelectorAll('[data-open]').forEach(function (el) {
      el.addEventListener('click', function () {
        openPage(el.dataset.open, el.dataset.title || '');
      });
    });

    on('assistantSettings', 'click', function () { openPage('nano-setting.html', '纳米设置'); });
    on('backupPage', 'click', function () { openPage('backup.html', '备份与恢复'); });
  }

  /* ================= 返回：设置子页回上一页，而不是直接回主页 ================= */
  function settingsBack() {
    var page = document.body && document.body.dataset ? document.body.dataset.page : '';
    if (page && page !== 'settings') {
      // 设置子页永远先回设置首页，不把整个浮层关掉回桌面
      try { location.href = 'settings.html'; } catch (e) {}
      return true;
    }
    return false;
  }

  window.__nanoInternalBack = function () {
    return settingsBack();
  };

  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.type !== 'nanoRequestBack') return;
    var handled = false;
    try { handled = settingsBack(); } catch (err) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: handled ? 'nanoBackHandled' : 'nanoBackUnhandled' }, '*');
      }
    } catch (err) {}
  });

  function upgradeRowChevrons() {
    var page = document.body.getAttribute('data-page') || '';
    if (page !== 'notifications' && page !== 'other') return;
    var svg = '<svg viewBox="0 0 8 13" width="8" height="13" aria-hidden="true"><path d="M1 1.5L6.5 6.5L1 11.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    Array.prototype.forEach.call(document.querySelectorAll('.row'), function (row) {
      if (row.classList.contains('subrow') || row.classList.contains('group-title')) return;
      if (row.hasAttribute('data-static')) return;
      var chev = row.querySelector('.chev');
      if (chev) { chev.innerHTML = svg; chev.classList.add('svg-chev'); return; }
      if (row.querySelector('.row-svg-chev')) return;
      var span = document.createElement('span');
      span.className = 'row-svg-chev';
      span.innerHTML = svg;
      row.appendChild(span);
    });
  }

  function init() {
    bind();
    upgradeRowChevrons();
    initInterface();
    initAssistant();
    requestPersistStorage();
    loadAll().then(function () {
      renderValues();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
