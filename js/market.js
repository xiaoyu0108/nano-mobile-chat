// ============================================================
// market.js — 共享集市
// ------------------------------------------------------------
// 共享：所有资源通过 Nano 的 Cloudflare Worker（nano-push 后端）中转，
//       任何用户发布的资源，其他人打开集市都能看到并下载/导入。
//       未配置服务器时自动降级为「仅本机」模式，并提示去配置。
//
// 导入目标（写入对应功能的真实存储，导入即在对应功能区生效）：
//   线上美化  -> 聊天美化      beautify_chat_v2
//   全局美化  -> 全局美化      beautify_global_v2
//   线下美化  -> 线下美化      MeetSettingsDB / main_settings.customCSS
//   心声美化  -> 心声弹窗      nano_voice_applied_css
//   世界书    -> nano_worldbook_db / worldbook_data
//   表情包    -> nano_api_db / emoji_data (nano_emoji_data)
//   角色卡    -> nano_characters_db / characters
//   字体      -> BeautifyAppDB / appliedFont  + postMessage beautify:font
//   音乐      -> nano_music_db / audio_files + localStorage nano_music_songs
// ============================================================
(function () {
  'use strict';

  /* ============================================================
     分类 & 图标
     ============================================================ */
  var CATEGORIES = [
    { name: '线上美化', desc: '聊天界面视觉方案', key: 'online' },
    { name: '全局美化', desc: '全站通用样式布局', key: 'global' },
    { name: '线下美化', desc: '离线页面本地样式', key: 'offline' },
    { name: '心声美化', desc: '心声弹窗展示样式', key: 'thought' },
    { name: '世界书',   desc: '设定规则扩展条目', key: 'lore' },
    { name: '表情包',   desc: '聊天图片表情素材', key: 'sticker' },
    { name: '角色卡',   desc: '角色卡设定文件', key: 'character' },
    { name: '字体',     desc: '美化页全局字体', key: 'font' },
    { name: '音乐',     desc: '音乐App音频文件', key: 'music' },
    { name: '小组件',   desc: '桌面小组件与代码', key: 'widget' },
    { name: '提示词',   desc: '线下 / 线上 / 群聊 / 社交', key: 'prompt' },
    { name: '其他',     desc: '线下文件与 APP HTML', key: 'other' }
  ];

  var catSvgs = {
    online: '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10 6.5h4M10 10h3"/><circle cx="15" cy="16.5" r="1" fill="currentColor" stroke="none"/></svg>',
    global: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 9h18M9 9v12"/></svg>',
    offline: '<svg viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 13h8M8 17h6"/></svg>',
    thought: '<svg viewBox="0 0 24 24"><path d="M21 9c0 4.5-8 9-9 9s-9-4.5-9-9a4.5 4.5 0 0 1 9-1.5A4.5 4.5 0 0 1 21 9Z"/><circle cx="12" cy="9" r="1" fill="currentColor" stroke="none"/></svg>',
    lore: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20"/><path d="M8 7h8M8 11h6"/></svg>',
    sticker: '<svg viewBox="0 0 24 24"><path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/><circle cx="8.5" cy="9.5" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="9.5" r=".8" fill="currentColor" stroke="none"/><circle cx="15.5" cy="9.5" r=".8" fill="currentColor" stroke="none"/><path d="M8 13c2 1.5 6 1.5 8 0"/></svg>',
    character: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7.5" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/><path d="M3 4v4M1 6h4M21 4v4M19 6h4"/></svg>',
    font: '<svg viewBox="0 0 24 24"><path d="M5 19 12 4l7 15"/><path d="M8 13h8"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    widget: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/></svg>',
    prompt: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 8h8M8 12h5"/></svg>',
    other: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>'
  };

  var ICONS = {
    like: '<svg viewBox="0 0 24 24"><path d="M7 10v10H4V10h3Z"/><path d="M7 10l4-7c1.5 0 2.5 1.5 1.5 3.5L11 10h6a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2H7"/></svg>',
    // 下载：向下箭头 + 托盘
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v10"/><path d="m8 11 4 3.5 4-3.5"/><path d="M5 19.5h14"/></svg>',
    // 导入：向右箭头进入区域（和下载明显不同）
    import: '<svg viewBox="0 0 24 24"><path d="M13 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H13"/><path d="M20 12H9.5"/><path d="m13 8.5 3.5 3.5L13 15.5"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>'
  };

  var PROMPT_PARTS = [
    { key: 'offline', name: '线下' },
    { key: 'online', name: '线上' },
    { key: 'group', name: '群聊' },
    { key: 'social', name: '社交软件' }
  ];
  var OTHER_TYPES = [
    { key: 'file', name: '普通文件' },
    { key: 'offline-rules', name: '线下规则' },
    { key: 'offline-style', name: '线下文风' },
    { key: 'app-html', name: 'APP HTML' }
  ];
  function promptPartName(key) {
    for (var i = 0; i < PROMPT_PARTS.length; i++) if (PROMPT_PARTS[i].key === key) return PROMPT_PARTS[i].name;
    return '线下';
  }
  function otherTypeName(key) {
    for (var i = 0; i < OTHER_TYPES.length; i++) if (OTHER_TYPES[i].key === key) return OTHER_TYPES[i].name;
    return '普通文件';
  }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function catName(k) { for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === k) return CATEGORIES[i].name; return k || '其他'; }
  function fileSize(n) {
    if (n == null) return '文件资源';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function fileExt(name) {
    var e = String(name || 'FILE').split('.').pop().toUpperCase();
    return e.length > 5 || e.indexOf('/') >= 0 ? 'FILE' : e;
  }
  function today() {
    return new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  function rand(n) { return Math.random().toString(36).slice(2, 2 + (n || 4)); }
  function postToShell(msg) {
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
  }
  function avatarHTML(avatar, name, cls) {
    if (avatar) return '<div class="' + (cls || 'avatar') + '"><img src="' + esc(avatar) + '" alt=""></div>';
    return '<div class="' + (cls || 'avatar') + '">' + esc((name || 'U').slice(0, 1) || 'U') + '</div>';
  }

  /* ============================================================
     文件 <-> dataURL 工具
     ============================================================ */
  var URL_CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
  function blobURL(blob) {
    if (!blob) return '';
    if (URL_CACHE) { var h = URL_CACHE.get(blob); if (h) return h; var u = URL.createObjectURL(blob); URL_CACHE.set(blob, u); return u; }
    return URL.createObjectURL(blob);
  }
  function blobToDataURL(blob) {
    return new Promise(function (res) {
      try { var r = new FileReader(); r.onload = function () { res(String(r.result || '')); }; r.onerror = function () { res(''); }; r.readAsDataURL(blob); }
      catch (e) { res(''); }
    });
  }
  function dataURLToBlob(dataURL) {
    try {
      var parts = String(dataURL).split(',');
      var mime = (parts[0].match(/:(.*?);/) || [, 'application/octet-stream'])[1];
      var bin = atob(parts[1] || '');
      var len = bin.length, u8 = new Uint8Array(len);
      for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch (e) { return null; }
  }
  function dataURLToArrayBuffer(dataURL) {
    var b = dataURLToBlob(dataURL);
    if (!b) return Promise.resolve(new ArrayBuffer(0));
    if (b.arrayBuffer) return b.arrayBuffer();
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { res(new ArrayBuffer(0)); }; r.readAsArrayBuffer(b); });
  }
  function dataURLToText(dataURL) {
    var b = dataURLToBlob(dataURL);
    if (!b) return Promise.resolve('');
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result || '')); }; r.onerror = function () { res(''); }; r.readAsText(b); });
  }
  // 压缩图片为 JPEG dataURL（尽量保留画质：max 2048，q0.9）
  function compressImage(file, max, quality) {
    max = max || 2048; quality = quality || 0.9;
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (w > max || h > max) {
              if (w >= h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; }
            }
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/jpeg', quality));
          } catch (e) { URL.revokeObjectURL(url); blobToDataURL(file).then(resolve); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); blobToDataURL(file).then(resolve); };
        img.src = url;
      } catch (e) { blobToDataURL(file).then(resolve); }
    });
  }

  /* ============================================================
     共享后端（复用 nano-push Worker）
     ============================================================ */
  var DEFAULT_BASE = 'https://nanopush.nano315.online';
  function baseURL() {
    var v = '';
    try { v = (localStorage.getItem('nano_push_endpoint') || '').trim(); } catch (e) {}
    v = v.replace(/\/+$/, '');
    return v || DEFAULT_BASE;
  }
  function api(path, opts) {
    var base = baseURL();
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctrl) { opts.signal = ctrl.signal; setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 9000); }
    return fetch(base + path, opts).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }
  var MODE = { server: 'server', local: 'local' };
  var mode = MODE.local;

  /* ============================================================
     本机存储（自己的资源 / 离线缓存）
     ============================================================ */
  var DB_NAME = 'NanoMarketDB', DB_VER = 1, db = null;
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('posts')) d.createObjectStore('posts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbAll(s) { return new Promise(function (res, rej) { var r = db.transaction(s, 'readonly').objectStore(s).getAll(); r.onsuccess = function () { res(r.result || []); }; r.onerror = function () { rej(r.error); }; }); }
  function idbGet(s, k) { return new Promise(function (res, rej) { var r = db.transaction(s, 'readonly').objectStore(s).get(k); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function idbPut(s, v) { return new Promise(function (res, rej) { var tx = db.transaction(s, 'readwrite'); tx.objectStore(s).put(v); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }
  function idbDel(s, k) { return new Promise(function (res, rej) { var tx = db.transaction(s, 'readwrite'); tx.objectStore(s).delete(k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }

  /* ============================================================
     状态
     ============================================================ */
  var feed = [];               // 摘要列表（首页/分类）
  var fullCache = {};          // id -> 完整数据（含 images/files dataURL）
  var owned = {};              // id -> token（自己发布的）
  var liked = {};              // id -> 1（我点赞过的）
  var hidden = {};             // id -> 1（服务器删不掉时，至少在本机隐藏）
  var user = { name: '资源玩家', bio: '分享灵感，也收藏灵感。', avatar: '' };
  var totalImports = 0;
  var selectedCategory = 'all';
  var detailId = null;
  var draftImages = [];        // {blob,name}
  var draftFiles = [];         // File
  var avatarDraft = null;

  function loadOwned() {
    try { owned = JSON.parse(localStorage.getItem('market_owned') || '{}') || {}; } catch (e) { owned = {}; }
    try { liked = JSON.parse(localStorage.getItem('market_liked') || '{}') || {}; } catch (e) { liked = {}; }
    try { hidden = JSON.parse(localStorage.getItem('market_hidden') || '{}') || {}; } catch (e) { hidden = {}; }
  }
  function saveOwned() { try { localStorage.setItem('market_owned', JSON.stringify(owned)); } catch (e) {} }
  function saveLiked() { try { localStorage.setItem('market_liked', JSON.stringify(liked)); } catch (e) {} }
  function saveHidden() { try { localStorage.setItem('market_hidden', JSON.stringify(hidden)); } catch (e) {} }
  function isOwner(id) { return !!owned[id]; }

  /* ============================================================
     摘要 / 完整对象
     ============================================================ */
  function toSummary(it) {
    return {
      id: it.id, title: it.title, category: it.category,
      desc: (it.desc || '').slice(0, 200), tags: it.tags || [],
      author: it.author, avatar: it.avatar || '', date: it.date, created: it.created,
      cover: (it.images && it.images[0]) || '', imageCount: (it.images || []).length,
      fileCount: (it.files || []).length,
      promptPart: it.promptPart || '', otherType: it.otherType || '',
      likes: it.likes || 0, downloads: it.downloads || 0, imports: it.imports || 0
    };
  }

  function filtered(cat, q) {
    q = (q || '').trim().toLowerCase();
    return feed.filter(function (p) {
      if (cat && cat !== 'all' && p.category !== cat) return false;
      if (!q) return true;
      var hay = [p.title, p.desc, p.author, (p.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
  }

  /* ============================================================
     渲染
     ============================================================ */
  function renderFolders() {
    $('folderGrid').innerHTML = CATEGORIES.map(function (c) {
      return '<button class="folder" data-cat="' + c.key + '">'
        + '<div class="folder-tab"></div>'
        + '<div class="folder-body"><div class="folder-icon">' + catSvgs[c.key] + '</div>'
        + '<div class="folder-meta"><strong>' + esc(c.name) + '</strong><small>' + esc(c.desc) + '</small></div></div>'
        + '<span class="folder-arrow">›</span></button>';
    }).join('');
    $('resourceCategory').innerHTML = CATEGORIES.map(function (c) {
      return '<option value="' + c.key + '">' + esc(c.name) + ' — ' + esc(c.desc) + '</option>';
    }).join('');
    if ($('promptPart')) {
      $('promptPart').innerHTML = PROMPT_PARTS.map(function (p) {
        return '<option value="' + p.key + '">' + esc(p.name) + '</option>';
      }).join('');
    }
    if ($('otherType')) {
      $('otherType').innerHTML = OTHER_TYPES.map(function (p) {
        return '<option value="' + p.key + '">' + esc(p.name) + '</option>';
      }).join('');
    }
    syncSubGroups();
  }

  function syncSubGroups() {
    var cat = $('resourceCategory') ? $('resourceCategory').value : '';
    if ($('promptPartGroup')) $('promptPartGroup').hidden = cat !== 'prompt';
    if ($('otherTypeGroup')) $('otherTypeGroup').hidden = cat !== 'other';
  }

  function makePostCard(p) {
    var cover = p.cover ? '<img src="' + esc(p.cover) + '" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:12px;margin-bottom:12px">' : '';
    var fileBadge = p.fileCount > 1 ? (p.fileCount + 'F') : (p.fileCount ? fileExt((p.title || 'FILE')) : (p.imageCount ? 'IMG' : 'TXT'));
    var fileTitle = p.fileCount ? (p.fileCount + ' 个文件') : (p.imageCount ? '仅图片分享' : '纯文字分享');
    var fileSub = [p.imageCount ? (p.imageCount + ' 张图片') : '', p.fileCount ? (p.fileCount + ' 个文件') : ''].filter(Boolean).join(' · ') || '无附件';
    return '<article class="post" data-post="' + p.id + '">'
      + '<div class="post-head">' + avatarHTML(p.avatar, p.author)
      + '<div class="post-head-info"><div class="author">' + esc(p.author) + '</div><div class="date">' + esc(p.date) + '</div></div>'
      + '<span class="post-tag">' + esc(catName(p.category))
      + (p.category === 'prompt' ? (' · ' + esc(promptPartName(p.promptPart))) : (p.category === 'other' ? (' · ' + esc(otherTypeName(p.otherType))) : ''))
      + '</span></div>'
      + cover
      + '<h3>' + esc(p.title) + '</h3>'
      + '<p class="post-excerpt">' + esc(p.desc || '发布者暂未填写详细介绍。') + '</p>'
      + '<div class="post-file">'
      + '<div class="file-badge">' + esc(fileBadge) + '</div>'
      + '<div class="file-info"><strong>' + esc(fileTitle) + '</strong>'
      + '<small>' + esc(fileSub) + '</small></div>'
      + '<span style="color:#ccc;font-size:18px;margin-left:auto;">›</span></div>'
      + '<div class="post-foot">'
      + '<span class="post-stat">' + ICONS.like + (p.likes || 0) + '</span>'
      + '<span class="post-stat">' + ICONS.download + (p.downloads || 0) + '</span>'
      + '<span class="post-stat">' + (p.imports || 0) + ' 导入</span>'
      + '</div></article>';
  }

  function renderPosts(target, list) {
    $(target).innerHTML = list.length ? list.map(makePostCard).join('')
      : '<div class="empty"><strong>这里还没有资源</strong>换个分类看看，或发布第一份分享</div>';
  }

  function renderHome() {
    renderPosts('homePosts', filtered('all', $('homeSearch').value));
    $('recentLabel').textContent = feed.length + ' ITEMS';
    updateProfile();
  }

  function updateProfile() {
    $('profileName').textContent = user.name;
    $('profileBio').textContent = user.bio || '还没有填写个人简介';
    var av = $('profileAvatar');
    av.innerHTML = user.avatar ? '<img src="' + esc(user.avatar) + '" alt="">' : esc((user.name || 'U').slice(0, 1) || 'U');
    var mine = feed.filter(function (p) { return isOwner(p.id); });
    $('myPostCount').textContent = mine.length;
    $('myLikeCount').textContent = mine.reduce(function (s, p) { return s + (p.likes || 0); }, 0);
    $('myImportCount').textContent = totalImports;
    $('myPosts').innerHTML = mine.length ? mine.map(function (p) {
      return '<div class="my-resource" data-post="' + p.id + '">'
        + '<div class="file-badge">' + fileExt(p.title || 'FILE') + '</div>'
        + '<div class="my-resource-info"><strong>' + esc(p.title) + '</strong>'
        + '<small>' + esc(catName(p.category)) + ' · ' + esc(p.date) + ' · ' + (p.fileCount || 0) + ' 个文件</small></div>'
        + '<button class="my-resource-delete" data-delete="' + p.id + '">删除</button></div>';
    }).join('') : '<div class="empty"><strong>你还没有上传资源</strong>去「发布」分享你的第一份资源</div>';
  }

  /* ============================================================
     详情
     ============================================================ */
  function ensureFull(id) {
    if (fullCache[id]) return Promise.resolve(fullCache[id]);
    if (mode === MODE.server) {
      return api('/market/item?id=' + encodeURIComponent(id)).then(function (r) {
        if (r && r.ok && r.item) { fullCache[id] = r.item; return r.item; }
        throw new Error('not-found');
      });
    }
    return idbGet('posts', id).then(function (it) { if (it) fullCache[id] = it; return it || null; });
  }

  var OPEN_IMPORT = {
    online: '聊天美化', global: '全局美化', offline: '线下美化', thought: '心声美化',
    lore: '世界书', sticker: '表情包', character: '角色卡', font: '字体', music: '音乐',
    widget: '桌面小组件', prompt: '提示词'
  };

  function renderDetail(p) {
    var gallery = '';
    if (p.images && p.images.length) {
      gallery = '<div class="detail-gallery">' + p.images.map(function (src, i) {
        return '<div class="detail-gallery-item" data-lightbox="' + i + '"><img src="' + esc(src) + '" alt="">'
          + '<div class="gallery-overlay">' + ICONS.image + '</div></div>';
      }).join('') + '</div>';
    }
    var files = p.files || [];
    var filesHTML = files.length ? '<div class="detail-files">'
      + '<div class="detail-files-title">' + files.length + ' 个文件</div>'
      + files.map(function (f, i) {
        return '<div class="detail-file-item">'
          + '<div class="file-badge">' + esc(fileExt(f.name)) + '</div>'
          + '<div class="detail-file-info"><strong>' + esc(f.name) + '</strong>'
          + '<small>' + esc(fileSize(f.size)) + ' · ' + esc(f.mime || '未知类型') + '</small></div>'
          + '<div class="detail-file-actions">'
          + '<button class="file-action-btn primary" data-import="' + i + '" title="导入到功能区">' + ICONS.import + '</button>'
          + '<button class="file-action-btn" data-download="' + i + '" title="下载文件">' + ICONS.download + '</button>'
          + '</div></div>';
      }).join('') + '</div>' : '';

    var target = OPEN_IMPORT[p.category] ? ('导入后将写入：<b>' + OPEN_IMPORT[p.category] + '</b>') : '该类资源可下载后自行使用';
    if (p.category === 'prompt') {
      target = '导入后将写入：<b>提示词 · ' + promptPartName(p.promptPart) + '</b>';
    } else if (p.category === 'other') {
      if (p.otherType === 'offline-rules') target = '导入后将写入：<b>线下规则区</b>（保留原始分组）';
      else if (p.otherType === 'offline-style') target = '导入后将写入：<b>线下文风</b>';
      else if (p.otherType === 'app-html') target = '导入后将写入：<b>AppStore</b>';
      else target = '该类资源可下载后自行使用';
    }

    $('detailContent').innerHTML =
      '<div class="detail-author">' + avatarHTML(p.avatar, p.author)
      + '<div class="detail-author-info"><div class="name">' + esc(p.author) + '</div>'
      + '<div class="meta">' + esc(p.date) + ' · ' + esc(catName(p.category))
      + (p.category === 'prompt' ? (' · ' + esc(promptPartName(p.promptPart))) : (p.category === 'other' ? (' · ' + esc(otherTypeName(p.otherType))) : ''))
      + '</div></div></div>'
      + '<h1 class="detail-title">' + esc(p.title) + '</h1>'
      + '<div class="detail-desc">' + esc(p.desc || '发布者暂未填写详细介绍。') + '</div>'
      + ((p.tags && p.tags.length) ? '<div class="detail-tags">' + p.tags.map(function (t) { return '<span class="detail-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '')
      + gallery + filesHTML
      + '<div class="detail-bottom-bar">'
      + '<button class="detail-reaction' + (p.likedByMe ? ' liked' : '') + '" id="detailLike">' + ICONS.like + ' ' + (p.likes || 0) + '</button>'
      + (isOwner(p.id)
        ? '<button class="detail-delete" id="detailDelete" title="删除这条资源">' + ICONS.trash + '</button>'
        : '<button class="detail-reaction" id="detailHide" title="只在本机隐藏这条资源">本机隐藏</button>')
      + '</div>'
      + '<p class="detail-note">' + target + '<br>' + (mode === MODE.server ? '资源由所有用户共享，保存在共享服务器上。' : '当前为仅本机模式，资源只有你自己能看到。') + '</p>';

    $('detailPage').classList.add('show');
    document.body.style.overflow = 'hidden';

    document.querySelectorAll('[data-lightbox]').forEach(function (el) {
      el.onclick = function () {
        var i = parseInt(el.dataset.lightbox, 10);
        if (p.images && p.images[i]) {
          $('lightboxImg').src = p.images[i];
          $('lightbox').classList.add('show');
        }
      };
    });
  }

  async function openDetail(id) {
    detailId = id;
    var sum = feed.filter(function (x) { return x.id === id; })[0] || {};
    try {
      var full = await ensureFull(id);
      if (!full) { toast('资源读取失败'); return; }
      var merged = Object.assign({}, sum, full);
      merged.likedByMe = !!liked[id];
      renderDetail(merged);
    } catch (e) {
      toast('资源读取失败，请检查网络');
    }
  }
  function closeDetail() {
    $('detailPage').classList.remove('show');
    document.body.style.overflow = '';
    detailId = null;
  }

  /* ============================================================
     计数更新 / 点赞 / 删除
     ============================================================ */
  function bumpSummary(id, field, delta) {
    var s = feed.filter(function (x) { return x.id === id; })[0];
    if (s) s[field] = Math.max(0, (s[field] || 0) + delta);
    if (fullCache[id]) fullCache[id][field] = Math.max(0, (fullCache[id][field] || 0) + delta);
  }
  function countRemote(id, field, delta) {
    bumpSummary(id, field, delta);
    if (mode === MODE.server) api('/market/count', { method: 'POST', body: JSON.stringify({ id: id, field: field, delta: delta }) }).catch(function () {});
    else if (fullCache[id]) idbPut('posts', fullCache[id]).catch(function () {});
  }

  async function toggleLike(id) {
    var on = !liked[id];
    if (on) liked[id] = 1; else delete liked[id];
    saveLiked();
    countRemote(id, 'likes', on ? 1 : -1);
    var sum = feed.filter(function (x) { return x.id === id; })[0] || {};
    var full = fullCache[id] || {};
    full.likedByMe = on;
    if (detailId === id) renderDetail(Object.assign({}, sum, full));
    renderHome();
  }

  async function deletePost(id) {
    var msg = '';
    try {
      if (mode === MODE.server) {
        try {
          await api('/market/delete', {
            method: 'POST',
            body: JSON.stringify({ id: id, token: owned[id] || '' })
          });
        } catch (e) {
          msg = String(e && e.message || '');
          // 404：服务器上已经没有这条（例如旧 KV 集市迁移后），直接清本机即可。
          // 403：服务器上这条还有删除凭证，但本机没有；不能真删，只能本机隐藏。
          if (!/http 404/.test(msg) && !/http 403/.test(msg)) throw e;
        }
      }
      hidden[id] = 1; saveHidden();
      await idbDel('posts', id).catch(function () {});
      feed = feed.filter(function (p) { return p.id !== id; });
      delete fullCache[id];
      delete owned[id]; saveOwned();
      renderHome(); updateProfile();
      if (detailId === id) closeDetail();
      toast(/http 403/.test(msg) ? '服务器上的旧资源缺少删除凭证，已从本机隐藏' : '资源已删除');
    } catch (e) { toast('删除失败'); }
  }

  /* ============================================================
     下载 / 导入
     ============================================================ */
  function urlToDataURL(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { reject(fr.error || new Error('read failed')); };
        fr.readAsDataURL(blob);
      });
    });
  }

  function downloadFile(p, index) {
    var files = p.files || [];
    var f = files[index];
    var href = f && (f.data || f.url);
    if (!f || !href) { toast('此文件没有可下载的数据'); return; }
    try {
      var a = document.createElement('a');
      a.href = href;
      a.download = f.name || 'resource';
      if (!/^data:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
      document.body.appendChild(a); a.click(); a.remove();
      countRemote(p.id, 'downloads', 1);
      renderDetail(Object.assign({}, p));
      toast('已开始下载');
    } catch (e) { toast('下载失败'); }
  }

  function extractCss(text, fileName) {
    if (/\.json$/i.test(fileName || '') || /^\s*[{[]/.test(text)) {
      try {
        var o = JSON.parse(text);
        if (typeof o === 'string') return o;
        if (o && typeof o.css === 'string') return o.css;
        if (o && typeof o.code === 'string') return o.code;
      } catch (e) {}
    }
    return text;
  }

  // ---- 美化类 ----
  async function applyBeautify(target, css, name) {
    try {
      localStorage.setItem('beautify_' + target, css);
      localStorage.setItem('beautify_' + target + '_v2', css);
      localStorage.setItem('beautify_' + target + '_time', String(Date.now()));
    } catch (e) {}
    // 同时写入美化 App 的预设库与 applied_* 设置，预设下拉里立刻可见。
    try {
      await putBeautifyPreset({
        category: target, name: name || '集市美化', code: css,
        createdAt: Date.now(), source: 'market'
      });
      await putBeautifySetting('applied_' + target, css);
    } catch (e) { console.warn('[market] save beautify preset failed', e); }
    postToShell({ type: 'beautify:apply', target: target, css: css });
  }
  async function applyHeart(css, name) {
    try { localStorage.setItem('nano_voice_applied_css', css); } catch (e) {}
    // 心声模板库（NanoVoiceDB/templates）也写一份，心声美化页的预设列表能看到。
    try { await putHeartTemplate(name || '集市心声', css); } catch (e) { console.warn('[market] save heart template failed', e); }
    postToShell({ type: 'nanoVoiceCss', css: css });
  }
  function applyOffline(css) {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('MeetSettingsDB');
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' });
      };
      req.onsuccess = function () {
        var d = req.result;
        try {
          var tx = d.transaction('settings', 'readwrite'), st = tx.objectStore('settings');
          var g = st.get('main_settings');
          g.onsuccess = function () { var rec = g.result || { id: 'main_settings' }; rec.customCSS = css; st.put(rec); };
          tx.oncomplete = function () { d.close(); postToShell({ type: 'offlineSettingsChanged' }); res(); };
          tx.onerror = function () { d.close(); rej(tx.error); };
        } catch (e) { try { d.close(); } catch (e2) {} rej(e); }
      };
      req.onerror = function () { rej(req.error); };
    });
  }
  // 把导入的样式同时写进对应 App 的「预设库」，
  // 这样在「聊天美化 / 全局美化 / 心声美化」里能直接看到并使用，
  // 而不是只改了已应用样式、预设列表里什么都没有。
  function openBeautifyDb() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('BeautifyAppDB');
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('presets')) d.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function putBeautifyPreset(rec) {
    return openBeautifyDb().then(function (d) {
      return new Promise(function (res, rej) {
        try {
          var tx = d.transaction('presets', 'readwrite');
          tx.objectStore('presets').add(rec);
          tx.oncomplete = function () { d.close(); res(); };
          tx.onerror = function () { d.close(); rej(tx.error); };
        } catch (e) { try { d.close(); } catch (e2) {} rej(e); }
      });
    });
  }
  function putBeautifySetting(key, value) {
    return openBeautifyDb().then(function (d) {
      return new Promise(function (res, rej) {
        try {
          var tx = d.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key: key, value: value });
          tx.oncomplete = function () { d.close(); res(); };
          tx.onerror = function () { d.close(); rej(tx.error); };
        } catch (e) { try { d.close(); } catch (e2) {} rej(e); }
      });
    });
  }
  function openHeartDb() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('NanoVoiceDB');
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id' });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function putHeartTemplate(name, css) {
    return openHeartDb().then(function (d) {
      return new Promise(function (res, rej) {
        try {
          var tx = d.transaction('templates', 'readwrite');
          tx.objectStore('templates').put({ id: 'tpl_' + Date.now() + '_' + rand(4), name: name || '集市心声', css: css || '', createdAt: Date.now() });
          tx.oncomplete = function () { d.close(); res(); };
          tx.onerror = function () { d.close(); rej(tx.error); };
        } catch (e) { try { d.close(); } catch (e2) {} rej(e); }
      });
    });
  }

  async function runBeautify(areaKey, file, post) {
    var text = extractCss(await dataURLToText(file.data), file.name);
    var name = (post && post.title) || (file.name || '集市资源').replace(/\.[^.]+$/, '');
    if (areaKey === 'online') await applyBeautify('chat', text, name);
    else if (areaKey === 'global') await applyBeautify('global', text, name);
    else if (areaKey === 'offline') await applyOffline(text);
    else if (areaKey === 'thought') await applyHeart(text, name);
  }

  // ---- 世界书 ----
  function wbEntry(src) {
    var e = src || {};
    var keys = e.key || e.keys || e.keywords || e.keyword || '';
    if (Array.isArray(keys)) keys = keys.join(',');
    return {
      id: 'e_' + Date.now() + rand(4), enabled: e.disable !== true && e.enabled !== false,
      title: e.comment || e.name || '', keywords: String(keys).replace(/,\s+/g, ','),
      keywordEnabled: e.constant !== true, vectorEnabled: e.vectorized === true,
      permanent: e.constant === true, position: 'before_char', scanDepth: 4,
      priority: typeof e.order === 'number' ? e.order : 100,
      probability: typeof e.probability === 'number' ? e.probability : 100,
      content: String(e.content || ''), collapsed: true
    };
  }
  function parseWbEntries(text) {
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (parsed) {
      var arr = Array.isArray(parsed) ? parsed : (parsed.entries || null);
      if (arr && arr.length) return { name: parsed.name || '', entries: arr.map(wbEntry).filter(function (x) { return x.content.trim(); }) };
    }
    return { name: '', entries: [{ id: 'e_' + Date.now(), enabled: true, title: '', keywords: '', keywordEnabled: false, vectorEnabled: false, permanent: true, position: 'before_char', scanDepth: 4, priority: 100, probability: 100, content: text, collapsed: true }] };
  }
  function importWorldbook(file) {
    return dataURLToText(file.data).then(function (text) {
      var parsed = parseWbEntries(text);
      var name = (file.name || 'worldbook').replace(/\.[^.]+$/, '');
      var newFile = {
        id: 'f_' + Date.now(), name: parsed.name || name, entries: parsed.entries,
        group: null, scope: 'global', boundCharacters: [],
        size: Math.ceil(text.length / 1024) + 'KB', ext: (fileExt(file.name) || 'txt').toLowerCase()
      };
      return new Promise(function (res, rej) {
        var req = indexedDB.open('nano_worldbook_db', 1);
        req.onupgradeneeded = function (e) { var d = e.target.result; if (!d.objectStoreNames.contains('worldbook_data')) d.createObjectStore('worldbook_data', { keyPath: 'key' }); };
        req.onsuccess = function () {
          var d = req.result;
          var tx = d.transaction('worldbook_data', 'readwrite'), st = tx.objectStore('worldbook_data');
          var g = st.get('data');
          g.onsuccess = function () {
            var val = (g.result && g.result.value) || { groups: [{ id: 'g1', name: '默认分组' }], files: [] };
            if (!Array.isArray(val.files)) val.files = [];
            val.files.push(newFile);
            st.put({ key: 'data', value: val });
            try { localStorage.setItem('nano_worldbook_data_v5', JSON.stringify(val)); } catch (e) {}
          };
          tx.oncomplete = function () { d.close(); res(); };
          tx.onerror = function () { d.close(); rej(tx.error); };
        };
        req.onerror = function () { rej(req.error); };
      });
    });
  }

  // ---- 表情包 ----
  function parseEmojiText(text) {
    var out = [];
    var t = String(text || '').trim();
    if (!t) return out;
    if (/^[{[]/.test(t)) {
      try {
        var p = JSON.parse(t);
        var arr = Array.isArray(p) ? p : (p.emojis || p.stickers || p.items || p.list || p.data || p.results || p.images || p.pack || []);
        arr.forEach(function (it) {
          if (!it) return;
          if (typeof it === 'string') { out.push({ name: '表情包', url: it }); return; }
          var url = it.url || it.src || it.image || it.img || it.link || it.file || it.href || it.path;
          var nm = it.name || it.title || it.label || it.desc || it.meaning || it.text || '表情包';
          if (url) out.push({ name: String(nm), url: String(url) });
        });
        if (out.length) return out;
      } catch (e) {}
    }
    t.split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*([^:：\t]{0,30}?)\s*[:：\t]\s*(https?:\/\/\S+|data:image\/\S+)\s*$/);
      if (m) { out.push({ name: m[1] || '表情包', url: m[2] }); return; }
      var u = line.match(/(https?:\/\/\S+|data:image\/\S+)/);
      if (u) out.push({ name: '表情包', url: u[0] });
    });
    return out;
  }
  function importEmoji(file) {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('nano_api_db', 2);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('emoji_data')) d.createObjectStore('emoji_data', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('api_data')) d.createObjectStore('api_data', { keyPath: 'key' });
      };
      req.onsuccess = function () {
        var d = req.result;
        var tx = d.transaction('emoji_data', 'readwrite'), st = tx.objectStore('emoji_data');
        var g = st.get('nano_emoji_data');
        g.onsuccess = async function () {
          var data = (g.result && g.result.value) || { emojiGroups: [], balance: 0, favorites: [] };
          if (!Array.isArray(data.emojiGroups)) data.emojiGroups = [];
          var group = { id: 'g' + Date.now(), name: (file.name || '集市表情').replace(/\.[^.]+$/, '').slice(0, 16), emojis: [] };
          var isImage = /^image\//i.test(file.mime || '') || /^data:image\//i.test(file.data);
          if (isImage) {
            group.emojis.push({ id: 'e' + Date.now() + '_' + rand(4), name: group.name, url: file.data });
          } else {
            var text = await dataURLToText(file.data);
            parseEmojiText(text).forEach(function (x, i) {
              if (!/^(https?:\/\/|data:image\/)/i.test(x.url)) return;
              group.emojis.push({ id: 'e' + Date.now() + '_' + i + rand(3), name: x.name, url: x.url });
            });
          }
          if (!group.emojis.length) { rej(new Error('empty')); return; }
          data.emojiGroups.push(group);
          st.put({ key: 'nano_emoji_data', value: data });
          try { localStorage.setItem('nano_emoji_data', JSON.stringify(data)); } catch (e) {}
        };
        tx.oncomplete = function () { d.close(); postToShell({ type: 'nanoEmojiUpdated' }); res(); };
        tx.onerror = function () { d.close(); rej(tx.error); };
      };
      req.onerror = function () { rej(req.error); };
    });
  }

  // ---- 角色卡 ----
  function parseLooseJson(text) {
    var t = String(text || '').trim();
    try { return JSON.parse(t); } catch (e) {}
    try {
      var b64 = t.replace(/^data:[^,]*,/, '').replace(/-/g, '+').replace(/_/g, '/');
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {}
    try { return JSON.parse(decodeURIComponent(t)); } catch (e) {}
    return null;
  }
  function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var ds = new DecompressionStream('deflate');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer();
    } catch (e) { return Promise.resolve(null); }
  }
  async function readPNGChunks(buf) {
    var u8 = new Uint8Array(buf);
    if (u8.length < 8 || u8[0] !== 137 || u8[1] !== 80 || u8[2] !== 78 || u8[3] !== 71) return {};
    var out = {}, off = 8;
    function read4(p) { return (u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]; }
    while (off + 8 < u8.length) {
      var len = read4(off);
      var type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      var dataStart = off + 8;
      if (type === 'tEXt') {
        var nul = dataStart; while (nul < dataStart + len && u8[nul] !== 0) nul++;
        var kw = String.fromCharCode.apply(null, u8.slice(dataStart, nul));
        var val = String.fromCharCode.apply(null, u8.slice(nul + 1, dataStart + len));
        out[kw] = (out[kw] || '') + val;
      } else if (type === 'zTXt') {
        var z = dataStart; while (z < dataStart + len && u8[z] !== 0) z++;
        var kw2 = String.fromCharCode.apply(null, u8.slice(dataStart, z));
        var inf = await inflate(u8.slice(z + 2, dataStart + len));
        if (inf) out[kw2] = (out[kw2] || '') + new TextDecoder('utf-8').decode(inf);
      } else if (type === 'iTXt') {
        var k = dataStart; while (k < dataStart + len && u8[k] !== 0) k++;
        var kw3 = String.fromCharCode.apply(null, u8.slice(dataStart, k));
        var compFlag = u8[k + 1];
        var rest = k + 3; // keyword\0 compFlag compMethod \0 lang \0 translated \0 text
        var nul2 = rest; while (nul2 < dataStart + len && u8[nul2] !== 0) nul2++;
        var nul3 = nul2 + 1; while (nul3 < dataStart + len && u8[nul3] !== 0) nul3++;
        var txtBytes = u8.slice(nul3 + 1, dataStart + len);
        var dec;
        if (compFlag === 1) { var inf2 = await inflate(txtBytes); dec = inf2 ? new TextDecoder('utf-8').decode(inf2) : ''; }
        else dec = new TextDecoder('utf-8').decode(txtBytes);
        out[kw3] = (out[kw3] || '') + dec;
      }
      off = dataStart + len + 4;
      if (type === 'IEND') break;
    }
    return out;
  }
  function parseCardData(json) {
    if (!json || typeof json !== 'object') return null;
    var d = json.data && typeof json.data === 'object' ? json.data : json;
    var name = d.name || d.nickname || d.char_name || json.name || '未命名';
    var gender = d.gender || d.sex || '男';
    var nationality = d.nationality || d.country || '中国';
    var desc = d.description || d.desc || d.persona || '';
    var personality = d.personality || '';
    var scenario = d.scenario || d.world || '';
    var first = d.first_mes || d.first_message || d.firstMessage || d.greeting || '';
    var alt = d.alternate_greetings || d.alternateGreetings || [];
    var example = d.mes_example || d.mesExample || d.example_dialogue || '';
    var setting = '';
    if (desc) setting += '【外貌与基本设定】\n' + desc + '\n\n';
    if (personality) setting += '【性格特征】\n' + personality + '\n\n';
    if (scenario) setting += '【开场背景】\n' + scenario + '\n\n';
    if (example) setting += '【对话示例】\n' + example + '\n\n';
    if (first) setting += '【首条消息】\n' + first;
    var greetings = [];
    if (Array.isArray(alt)) greetings = alt.slice();
    if (first) greetings.unshift(first);
    var embedded = d.character_book || (d.extensions && d.extensions.world) || null;
    return { name: String(name), gender: String(gender), nationality: String(nationality), setting: setting.trim(), greetings: greetings, embeddedWorldbook: embedded };
  }
  function currentMaskId() {
    var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) {
          if (d.currentMaskId) return d.currentMaskId;
          if (d.masks[0]) return d.masks[0].id;
        }
      } catch (e) {}
    }
    return '';
  }
  async function importCharacter(file) {
    var cardObj = null;
    if (/^image\/png/i.test(file.mime || '') || /\.png$/i.test(file.name || '')) {
      var buf = await dataURLToArrayBuffer(file.data);
      var chunks = await readPNGChunks(buf);
      var keys = ['ccv3', 'character_card_v3', 'chara', 'character', 'card', 'data', 'json', 'chub', 'character_card'];
      for (var i = 0; i < keys.length && !cardObj; i++) {
        if (chunks[keys[i]]) { var parsed = parseLooseJson(chunks[keys[i]]); if (parsed) cardObj = parsed; }
      }
      if (!cardObj) throw new Error('无法解析 PNG 角色卡数据');
    } else {
      var text = await dataURLToText(file.data);
      cardObj = parseLooseJson(text);
      if (!cardObj) throw new Error('无法解析角色卡 JSON');
    }
    var card = parseCardData(cardObj);
    if (!card) throw new Error('角色卡字段缺失');
    var isPngCard = /^image\/png/i.test(file.mime || '') || /\.png$/i.test(file.name || '');
    var rec = {
      // 只有 PNG 角色卡的文件本体才是头像；JSON 卡不能把 JSON 文本当头像。
      id: 'c' + Date.now(), name: card.name, avatar: isPngCard ? file.data : '', gender: card.gender,
      nationality: card.nationality, setting: card.setting, bindUser: currentMaskId(),
      isNpc: false, nanoAssistant: false, greetings: card.greetings, worldbookBindings: []
    };
    await new Promise(function (res, rej) {
      var req = indexedDB.open('nano_characters_db');
      req.onupgradeneeded = function (e) { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); };
      req.onsuccess = function () {
        var d = req.result;
        var tx = d.transaction('characters', 'readwrite');
        tx.objectStore('characters').put(rec);
        tx.oncomplete = function () { d.close(); res(); };
        tx.onerror = function () { d.close(); rej(tx.error); };
      };
      req.onerror = function () { rej(req.error); };
    });
    // 角色卡内嵌世界书
    if (card.embeddedWorldbook) {
      try {
        var wbText = JSON.stringify(card.embeddedWorldbook);
        await importWorldbook({ name: (card.name || '角色') + '-世界书.json', data: 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(wbText))) });
      } catch (e) {}
    }
    postToShell({ type: 'contactsDataUpdated' });
    postToShell({ type: 'nanoCharUpdated', chatId: rec.id, name: rec.name, avatar: rec.avatar });
  }

  // ---- 字体 ----
  function fontFormat(name) {
    var s = String(name || '').toLowerCase().split(/[?#]/)[0];
    if (/\.woff2$/.test(s)) return 'woff2';
    if (/\.woff$/.test(s)) return 'woff';
    if (/\.(otf|tof)$/.test(s)) return 'opentype';
    if (/\.ttf$/.test(s)) return 'truetype';
    if (/\.(ttc|otc)$/.test(s)) return '';
    if (/\.eot$/.test(s)) return 'embedded-opentype';
    if (/\.svg$/.test(s)) return 'svg';
    return '';
  }
  async function importFont(file) {
    var isFont = /font|woff|ttf|otf|truetype|opentype/i.test(file.mime || '') || /\.(ttf|otf|tof|woff2?|ttc|otc|eot|svg)$/i.test(file.name || '');
    if (isFont) {
      var ab = await dataURLToArrayBuffer(file.data);
      var state = { name: file.name, source: file.name, type: 'file', data: ab, size: 16, cssFamily: '', cssText: '' };
      await new Promise(function (res, rej) {
        var req = indexedDB.open('BeautifyAppDB', 1);
        req.onupgradeneeded = function (e) {
          var d = e.target.result;
          if (!d.objectStoreNames.contains('presets')) d.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
          if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = function () {
          var d = req.result;
          var tx = d.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key: 'appliedFont', value: state });
          tx.oncomplete = function () { d.close(); res(); };
          tx.onerror = function () { d.close(); rej(tx.error); };
        };
        req.onerror = function () { rej(req.error); };
      });
      try { localStorage.removeItem('beautify_font'); } catch (e) {}
      try {
        await putBeautifyPreset({ category: 'font', name: file.name, font: state, createdAt: Date.now(), source: 'market' });
      } catch (e) { console.warn('[market] save font preset failed', e); }
      postToShell({ type: 'beautify:font', cfg: { family: 'NanoBeautifyFont', name: file.name, source: file.name, type: 'file', size: 16, format: fontFormat(file.name), data: ab } });
      return;
    }
    // 文本/JSON：视为字体链接
    var text = (await dataURLToText(file.data)).trim();
    var url = '';
    try { var o = JSON.parse(text); url = o.url || o.source || ''; } catch (e) { url = text; }
    if (!/^https?:\/\/|^data:/i.test(url)) throw new Error('不是有效的字体文件或字体链接');
    var cfg = { family: 'NanoBeautifyFont', name: file.name, source: url, type: 'url', size: 16, format: fontFormat(url) };
    try { localStorage.setItem('beautify_font', JSON.stringify(cfg)); } catch (e) {}
    try { await putBeautifySetting('appliedFont', cfg); } catch (e) {}
    try {
      await putBeautifyPreset({ category: 'font', name: file.name, font: cfg, createdAt: Date.now(), source: 'market' });
    } catch (e) { console.warn('[market] save font preset failed', e); }
    postToShell({ type: 'beautify:font', cfg: cfg });
  }

  // ---- 音乐 ----
  async function importMusic(file) {
    var ab = await dataURLToArrayBuffer(file.data);
    if (!ab || !ab.byteLength) throw new Error('音频为空');
    if (ab.byteLength > 50 * 1024 * 1024) throw new Error('音频超过 50MB');
    var songId = 'song_' + Date.now() + '_' + rand(6);
    await new Promise(function (res, rej) {
      var req = indexedDB.open('nano_music_db', 3);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('music_data')) d.createObjectStore('music_data', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('audio_files')) d.createObjectStore('audio_files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('lyrics_data')) d.createObjectStore('lyrics_data', { keyPath: 'id' });
      };
      req.onsuccess = function () {
        var d = req.result;
        var tx = d.transaction('audio_files', 'readwrite');
        tx.objectStore('audio_files').put({ id: songId, data: ab, type: file.mime || 'audio/mpeg' });
        tx.oncomplete = function () { d.close(); res(); };
        tx.onerror = function () { d.close(); rej(tx.error); };
      };
      req.onerror = function () { rej(req.error); };
    });
    var songs = [];
    try { songs = JSON.parse(localStorage.getItem('nano_music_songs') || '[]') || []; } catch (e) { songs = []; }
    songs.push({
      id: songId, source: 'local', name: (file.name || '音乐').replace(/\.[^.]+$/, ''),
      artist: '未知歌手', cover: '', fileType: file.mime || 'audio/mpeg', lyrics: ''
    });
    try { localStorage.setItem('nano_music_songs', JSON.stringify(songs)); } catch (e) {}
    postToShell({ type: 'nanoMusicUpdated' });
  }

  // ---- 桌面小组件 ----
  async function importWidget(file, post) {
    var text = await dataURLToText(file.data);
    var items = [];
    var rawName = String((post && post.title) || file.name || '集市小组件').replace(/\.[^.]+$/, '');
    function addItem(name, code, w, h) {
      code = String(code || '').trim();
      if (!code) return;
      items.push({
        name: String(name || rawName).slice(0, 20),
        code: code,
        w: Math.max(1, Math.min(4, parseInt(w, 10) || 2)),
        h: Math.max(0.3, Math.min(6, Number(h) || 2))
      });
    }
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (Array.isArray(parsed)) {
      parsed.forEach(function (it) {
        if (!it) return;
        if (typeof it === 'string') addItem(rawName, it);
        else addItem(it.name || it.title || rawName, it.code || it.html || it.content || '', it.w, it.h);
      });
    } else if (parsed && typeof parsed === 'object') {
      var arr = Array.isArray(parsed.widgets) ? parsed.widgets : null;
      if (arr) arr.forEach(function (it) { if (it) addItem(it.name || it.title || rawName, it.code || it.html || it.content || '', it.w, it.h); });
      else addItem(parsed.name || rawName, parsed.code || parsed.html || parsed.content || '', parsed.w, parsed.h);
    }
    if (!items.length) addItem(rawName, text, 2, 2);
    if (!items.length) throw new Error('没有可导入的小组件');

    var layout = window.NanoIDB ? await NanoIDB.get('nano_widget_layout_v1') : null;
    if (!layout || !Array.isArray(layout.pages)) {
      layout = { ver: 4, rows: 0, dock: ['chat', 'api', 'imessage', 'settings'], lib: [], pages: [[]] };
    }
    if (!Array.isArray(layout.lib)) layout.lib = [];
    items.forEach(function (it, i) {
      layout.lib.push({
        id: 'w' + Date.now().toString(36) + i + rand(3),
        name: it.name, code: it.code, live: false, w: it.w, h: it.h
      });
    });
    if (!window.NanoIDB) throw new Error('桌面存储模块未加载');
    var saved = await NanoIDB.set('nano_widget_layout_v1', layout);
    if (!saved) throw new Error('写入桌面小组件失败');
    postToShell({ type: 'nanoDesktopChanged', layout: true });
  }

  // ---- 提示词 ----
  async function importPrompt(file, post) {
    if (!window.NanoPrompts) throw new Error('提示词模块未加载');
    var text = await dataURLToText(file.data);
    var part = (post && post.promptPart) || 'offline';
    var data = NanoPrompts.read();
    var cat = data.cats[part];
    if (!cat) throw new Error('提示词板块不存在');
    var baseName = String((post && post.title) || file.name || '集市提示词').replace(/\.[^.]+$/, '');
    var list = [];
    function push(name, content) {
      content = String(content == null ? '' : content).trim();
      if (!content) return;
      list.push({ id: NanoPrompts.newId(), name: String(name || baseName).slice(0, 40), content: content, icon: '', at: Date.now() });
    }
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (Array.isArray(parsed)) {
      parsed.forEach(function (it, i) {
        if (typeof it === 'string') push(baseName + (i ? ' ' + (i + 1) : ''), it);
        else if (it && typeof it === 'object') push(it.name || it.title || (baseName + (i ? ' ' + (i + 1) : '')), it.content || it.text || '');
      });
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.prompts)) {
        parsed.prompts.forEach(function (it, i) {
          if (!it) return;
          if (typeof it === 'string') push(baseName + (i ? ' ' + (i + 1) : ''), it);
          else push(it.name || it.title || (baseName + (i ? ' ' + (i + 1) : '')), it.content || it.text || '');
        });
      } else if (typeof parsed.content === 'string' || typeof parsed.text === 'string') {
        push(parsed.name || parsed.title || baseName, parsed.content || parsed.text);
      } else if (typeof parsed[part] === 'string') {
        push(parsed.name || baseName, parsed[part]);
      } else {
        push(baseName, text);
      }
    } else {
      push(baseName, text);
    }
    if (!list.length) throw new Error('提示词为空');
    cat.custom = cat.custom.concat(list);
    NanoPrompts.write(data);
    postToShell({ type: 'nanoPromptsUpdated' });
  }

  // ---- 线下规则 / 文风 / APP HTML ----
  function openMeetSettingsDB() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open('MeetSettingsDB', 2);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('rules')) d.createObjectStore('rules', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('stylePresets')) d.createObjectStore('stylePresets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cssPresets')) d.createObjectStore('cssPresets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cotPresets')) d.createObjectStore('cotPresets', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('messages')) d.createObjectStore('messages', { keyPath: 'id' });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function meetGet(db, store, key) {
    return new Promise(function (res) {
      try {
        var r = db.transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function meetPut(db, store, value) {
    return new Promise(function (res, rej) {
      try {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      } catch (e) { rej(e); }
    });
  }
  function importRuleChild(src, index) {
    var o = (src && typeof src === 'object') ? src : { content: src };
    var content = String(o.content != null ? o.content : (o.text != null ? o.text : '')).trim();
    return {
      id: 'r_' + Date.now().toString(36) + '_' + index + rand(3),
      name: String(o.name || o.title || content.slice(0, 20) || '规则').slice(0, 40),
      content: content,
      enabled: o.enabled !== false
    };
  }
  function importRuleGroup(src, index, fallbackName) {
    var o = (src && typeof src === 'object') ? src : { name: fallbackName, content: src };
    var raw = Array.isArray(o.rules) ? o.rules : (Array.isArray(o.children) ? o.children : null);
    var children = raw
      ? raw.map(importRuleChild).filter(function (c) { return c.content || c.name; })
      : ((o.content != null || o.text != null) ? [importRuleChild(o, 0)] : []);
    return {
      id: 'g_' + Date.now().toString(36) + '_' + index + rand(3),
      name: String(o.name || o.title || fallbackName || '导入规则'),
      enabled: o.enabled !== false,
      expanded: o.expanded !== false,
      rules: children
    };
  }
  function splitRuleParagraphs(text) {
    var norm = String(text || '').replace(/\r\n?/g, '\n');
    var paras = norm.split(/\n\s*\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (paras.length) return paras;
    return norm.trim() ? [norm.trim()] : [];
  }
  function parseRuleBackup(text, fallbackName) {
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (parsed && parsed.kind === 'nano-offline-rules' && Array.isArray(parsed.groups)) {
      return { backup: true, groups: parsed.groups.map(function (g, i) { return importRuleGroup(g, i, fallbackName); }).filter(function (g) { return g.rules.length; }) };
    }
    if (Array.isArray(parsed)) {
      var looksLikeGroups = parsed.length > 0 && parsed.every(function (g) {
        return g && typeof g === 'object' && (Array.isArray(g.rules) || Array.isArray(g.children));
      });
      if (looksLikeGroups) {
        return { backup: false, groups: parsed.map(function (g, i) { return importRuleGroup(g, i, fallbackName); }).filter(function (g) { return g.rules.length; }) };
      }
      var flat = parsed.map(importRuleChild).filter(function (c) { return c.content || c.name; });
      return {
        backup: false,
        groups: flat.length ? [{
          id: 'g_' + Date.now().toString(36) + rand(3),
          name: fallbackName || '导入规则', enabled: true, expanded: true, rules: flat
        }] : []
      };
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.groups)) {
        return { backup: false, groups: parsed.groups.map(function (g, i) { return importRuleGroup(g, i, fallbackName); }).filter(function (g) { return g.rules.length; }) };
      }
      if (Array.isArray(parsed.rules)) return { backup: false, groups: [importRuleGroup(parsed, 0, fallbackName)] };
      return { backup: false, groups: [importRuleGroup(parsed, 0, fallbackName)] };
    }
    var paras = splitRuleParagraphs(text);
    var rules = paras.map(function (p, i) { return importRuleChild({ content: p }, i); });
    return {
      backup: false,
      groups: rules.length ? [{
        id: 'g_' + Date.now().toString(36) + rand(3),
        name: fallbackName || '导入规则', enabled: true, expanded: true, rules: rules
      }] : []
    };
  }
  async function importOfflineRules(file, post) {
    var text = await dataURLToText(file.data);
    var fallbackName = String((post && post.title) || file.name || '导入规则').replace(/\.[^.]+$/, '');
    var parsed = parseRuleBackup(text, fallbackName);
    if (!parsed.groups.length) throw new Error('没有可导入的规则');
    if (parsed.backup && !confirm('检测到线下规则备份，导入会覆盖当前全部规则组并恢复原始分组，继续？')) {
      var cancelled = new Error('cancelled'); cancelled.silent = true; throw cancelled;
    }
    var db = await openMeetSettingsDB();
    var current = await meetGet(db, 'rules', 'main_rules');
    var groups = (current && Array.isArray(current.groups)) ? current.groups : [];
    groups = parsed.backup ? parsed.groups : groups.concat(parsed.groups);
    await meetPut(db, 'rules', { id: 'main_rules', groups: groups });
    try { db.close(); } catch (e) {}
    postToShell({ type: 'offlineSettingsChanged' });
  }
  async function importOfflineStyle(file, post) {
    var text = await dataURLToText(file.data);
    var content = String(text || '').trim();
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        content = String(parsed.style != null ? parsed.style : (parsed.content != null ? parsed.content : (parsed.text != null ? parsed.text : content))).trim();
      }
    } catch (e) {}
    if (!content) throw new Error('文风内容为空');
    var name = String((post && post.title) || file.name || '集市文风').replace(/\.[^.]+$/, '');
    var db = await openMeetSettingsDB();
    var rec = await meetGet(db, 'settings', 'main_settings') || {
      id: 'main_settings', style: '', cot: '', wordCount: '', person: 'auto', predictUser: 'forbid',
      customCSS: '', bgImage: '', autoSummary: true, memThreshold: 5, nsfw: false, maxTokens: '',
      timeAware: true, builtinBody: false, statusBars: []
    };
    rec.style = content;
    await meetPut(db, 'settings', rec);
    var presetRec = await meetGet(db, 'stylePresets', 'style_presets') || { id: 'style_presets', presets: [] };
    if (!Array.isArray(presetRec.presets)) presetRec.presets = [];
    presetRec.presets.push({ name: name, content: content });
    await meetPut(db, 'stylePresets', presetRec);
    try { db.close(); } catch (e) {}
    postToShell({ type: 'offlineSettingsChanged' });
  }
  function importAppHtml(file, post) {
    return dataURLToText(file.data).then(function (html) {
      var m = String(html).match(/<script[^>]*id=["']nano-manifest["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!m) throw new Error('缺少 nano-manifest');
      var manifest = null;
      try { manifest = JSON.parse(m[1]); } catch (e) {}
      if (!manifest || !manifest.id) throw new Error('清单缺少 id');
      var app = {
        id: String(manifest.id),
        name: manifest.name || manifest.id,
        icon: manifest.icon || '',
        color: manifest.color || '',
        desc: manifest.desc || '',
        version: manifest.version || '1.0.0',
        permissions: manifest.permissions || [],
        html: String(html),
        installedAt: Date.now()
      };
      return new Promise(function (res, rej) {
        var req = indexedDB.open('nano_appstore_db', 2);
        req.onupgradeneeded = function (e) {
          var d = e.target.result;
          if (!d.objectStoreNames.contains('apps')) d.createObjectStore('apps', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('appdata')) d.createObjectStore('appdata', { keyPath: 'key' });
        };
        req.onsuccess = function () {
          var d = req.result;
          try {
            var tx = d.transaction('apps', 'readwrite');
            tx.objectStore('apps').put(app);
            tx.oncomplete = function () { d.close(); res(); };
            tx.onerror = function () { d.close(); rej(tx.error); };
          } catch (e) { try { d.close(); } catch (e2) {} rej(e); }
        };
        req.onerror = function () { rej(req.error); };
      }).then(function () {
        postToShell({ type: 'nanoAppManifestChanged', app: app });
      });
    });
  }

  var IMPORT_HANDLERS = {
    online: runBeautify.bind(null, 'online'),
    global: runBeautify.bind(null, 'global'),
    offline: runBeautify.bind(null, 'offline'),
    thought: runBeautify.bind(null, 'thought'),
    lore: importWorldbook,
    sticker: importEmoji,
    character: importCharacter,
    font: importFont,
    music: importMusic,
    widget: importWidget,
    prompt: importPrompt
  };

  async function importResource(p, index) {
    var files = p.files || [];
    var f = files[index];
    if (!f || (!f.data && !f.url)) { toast('这份资源没有可导入的文件'); return; }
    var importGate = null;
    try { importGate = (window.parent && window.parent.NanoImportGate) || window.NanoImportGate; } catch (err) { importGate = window.NanoImportGate; }
    if (importGate && importGate.ensure) {
      var gateOk = false;
      try { gateOk = await importGate.ensure(); } catch (err) { gateOk = false; }
      if (!gateOk) return;
    }
    var handler = IMPORT_HANDLERS[p.category];
    if (p.category === 'other') {
      if (p.otherType === 'offline-rules') handler = importOfflineRules;
      else if (p.otherType === 'offline-style') handler = importOfflineStyle;
      else if (p.otherType === 'app-html') handler = importAppHtml;
    }
    if (!handler) { downloadFile(p, index); toast('「' + catName(p.category) + '」请下载后自行使用'); return; }
    try {
      // 新市场把文件放 R2，item 里只有 URL；导入前按需取回 dataURL，旧数据仍然直接用 f.data。
      if (!f.data && f.url) f.data = await urlToDataURL(f.url);
    } catch (e) {
      toast('文件读取失败，请检查 R2 跨域设置');
      return;
    }
    try {
      await handler(f, p);
      totalImports++;
      try { if (db) await idbPut('settings', { key: 'imports', value: totalImports }); } catch (e) {}
      countRemote(p.id, 'imports', 1);
      // 通知外壳广播给美化 / 储存等页面，让它们立刻重新读取最新预设与占用。
      postToShell({ type: 'marketResourceImported', category: p.category || '' });
      renderHome(); updateProfile();
      var targetName = OPEN_IMPORT[p.category] || catName(p.category);
      if (p.category === 'prompt') targetName = '提示词 · ' + promptPartName(p.promptPart);
      if (p.category === 'other') targetName = otherTypeName(p.otherType);
      toast('已导入到「' + targetName + '」并生效');
    } catch (e) {
      if (e && e.silent) return;
      console.warn('[market] import failed', e);
      toast('导入失败：' + (e && e.message ? e.message : '文件格式不支持'));
    }
  }

  /* ============================================================
     发布
     ============================================================ */
  function renderImagePreviews() {
    $('imagePreviewGrid').innerHTML = draftImages.map(function (img, i) {
      return '<div class="upload-image-item"><img src="' + blobURL(img.blob) + '" alt="">'
        + '<button type="button" class="remove-img" data-remove-img="' + i + '">×</button></div>';
    }).join('');
  }
  function renderFilePreviews() {
    $('uploadFileList').innerHTML = draftFiles.map(function (f, i) {
      return '<div class="upload-file-item"><div class="file-badge">' + esc(fileExt(f.name)) + '</div>'
        + '<div class="file-info"><strong>' + esc(f.name) + '</strong><small>' + esc(fileSize(f.size)) + '</small></div>'
        + '<button type="button" class="remove-btn" data-remove-file="' + i + '">×</button></div>';
    }).join('');
    $('fileLabel').textContent = draftFiles.length ? ('已选择 ' + draftFiles.length + ' 个文件') : '点击选择文件';
  }

  async function buildItem() {
    var images = [];
    for (var i = 0; i < draftImages.length; i++) {
      images.push(await compressImage(draftImages[i].blob, 2048, 0.9));
    }
    var cover = draftImages.length ? await compressImage(draftImages[0].blob, 520, 0.72) : '';
    var files = [];
    for (var j = 0; j < draftFiles.length; j++) {
      var f = draftFiles[j];
      files.push({ name: f.name, size: f.size, mime: f.type || 'application/octet-stream', data: await blobToDataURL(f) });
    }
    var category = $('resourceCategory').value;
    return {
      id: 'p' + Date.now() + rand(4),
      title: $('resourceTitle').value.trim(),
      category: category,
      promptPart: category === 'prompt' ? ($('promptPart') ? $('promptPart').value : 'offline') : '',
      otherType: category === 'other' ? ($('otherType') ? $('otherType').value : 'file') : '',
      desc: $('resourceDesc').value.trim(),
      tags: $('resourceTags').value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean),
      images: images, cover: cover, files: files,
      author: user.name, avatar: user.avatar || '', owner: true,
      date: today(), created: Date.now(),
      likes: 0, downloads: 0, imports: 0, likedByMe: false
    };
  }

  async function submitForm() {
    if (!$('resourceTitle').value.trim()) { toast('请填写资源名称'); return; }
    var btn = $('submitBtn');
    btn.disabled = true; btn.textContent = '发布中…';
    try {
      var item = await buildItem();
      var summary = toSummary(item);
      var token = 'tok_' + Date.now() + rand(8);
      if (mode === MODE.server) {
        try {
          await api('/market/post', { method: 'POST', body: JSON.stringify({ item: item, summary: summary, token: token }) });
        } catch (e) {
          console.warn('[market] post failed, saving local', e);
          mode = MODE.local;
          updateModeBanner();
          toast('共享服务器不可用，已保存到本机');
        }
      }
      // 本机也存一份（离线可见 / 作为自己的资源）
      try { await idbPut('posts', item); } catch (e) {}
      fullCache[item.id] = item;
      owned[item.id] = token; saveOwned();
      feed = feed.filter(function (x) { return x.id !== item.id; });
      feed.unshift(summary);
      $('uploadForm').reset();
      draftImages = []; draftFiles = [];
      renderImagePreviews(); renderFilePreviews(); syncSubGroups();
      renderHome();
      showPage('page-profile');
      toast('发布成功');
    } catch (e) {
      toast('发布失败：' + (e && e.message ? e.message : '请重试'));
    } finally {
      btn.disabled = false; btn.textContent = '发布资源';
    }
  }

  /* ============================================================
     页面切换
     ============================================================ */
  function showPage(id) {
    document.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === id); });
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.page === id); });
    // 返回键放在顶栏里：首页隐藏，其他页面显示（不再挂在顶栏下面）。
    var back = $('topBackBtn');
    if (back) back.hidden = (id === 'page-home');
    if (id === 'page-profile') updateProfile();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openCategory(key) {
    selectedCategory = key;
    var c = null;
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === key) c = CATEGORIES[i];
    $('categoryTitle').textContent = c ? c.name : '全部资源';
    $('categorySub').textContent = c ? (c.desc + '。点击帖子查看完整详情。') : '浏览集市内的全部用户分享。';
    $('categorySearch').value = '';
    renderPosts('categoryPosts', filtered(key, ''));
    showPage('page-category');
  }

  /* ============================================================
     模式提示
     ============================================================ */
  function updateModeBanner() {
    var b = $('modeBanner'), t = $('modeText'), set = $('modeSet');
    if (mode === MODE.server) {
      b.classList.remove('warn');
      t.innerHTML = '已连接共享服务器 · 你上传的资源 <b>所有人都能看到</b>（当前 ' + feed.length + ' 份资源）';
      set.hidden = true;
    } else {
      b.classList.add('warn');
      t.innerHTML = '仅本机模式 · 现在只有你自己能看到资源。<b>配置共享服务器后</b>即可让所有用户互相看到';
      set.hidden = false;
    }
  }
  $('modeSet').onclick = function () {
    var cur = baseURL();
    var v = prompt('填写共享服务器地址（Nano 推送 Worker 地址，留空则仅本机）：', cur);
    if (v === null) return;
    v = v.trim().replace(/\/+$/, '');
    try { localStorage.setItem('nano_push_endpoint', v); } catch (e) {}
    toast(v ? '已保存，正在连接…' : '已切换为仅本机模式');
    boot();
  };

  /* ============================================================
     事件
     ============================================================ */
  document.addEventListener('click', function (e) {
    var folder = e.target.closest('[data-cat]');
    if (folder) { openCategory(folder.dataset.cat); return; }
    var del = e.target.closest('[data-delete]');
    if (del) { e.stopPropagation(); if (confirm('确定删除这条资源吗？')) deletePost(del.dataset.delete); return; }
    var post = e.target.closest('[data-post]');
    if (post) { openDetail(post.dataset.post); return; }
  });

  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.page === 'page-category') openCategory('all');
      else showPage(b.dataset.page);
    });
  });

  $('topSearchBtn').onclick = function () { showPage('page-home'); $('homeSearch').focus(); $('homeSearch').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('topProfileBtn').onclick = function () { showPage('page-profile'); };
  $('brandBtn').onclick = function () {
    if ($('detailPage').classList.contains('show')) { closeDetail(); return; }
    var active = document.querySelector('.page.active');
    if (active && active.id !== 'page-home') { showPage('page-home'); return; }
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'nanoCloseOverlay' }, '*'); else history.back(); } catch (e) {}
  };
  $('homeSearch').addEventListener('input', function () { renderPosts('homePosts', filtered('all', $('homeSearch').value)); });
  $('homeSearchBtn').onclick = function () {
    var q = $('homeSearch').value;
    openCategory('all');
    $('categorySearch').value = q;
    renderPosts('categoryPosts', filtered('all', q));
  };
  if ($('topBackBtn')) $('topBackBtn').onclick = function () {
    if ($('detailPage').classList.contains('show')) { closeDetail(); return; }
    showPage('page-home');
  };
  $('categorySearch').addEventListener('input', function () { renderPosts('categoryPosts', filtered(selectedCategory, $('categorySearch').value)); });

  // 图片上传
  $('imageInput').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { if (!f.type || f.type.indexOf('image/') === 0) draftImages.push({ blob: f, name: f.name }); });
    renderImagePreviews(); e.target.value = '';
  });
  $('imagePreviewGrid').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove-img]');
    if (rm) { draftImages.splice(parseInt(rm.dataset.removeImg, 10), 1); renderImagePreviews(); }
  });
  // 文件上传
  $('resourceFile').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { draftFiles.push(f); });
    renderFilePreviews(); e.target.value = '';
  });
  $('uploadFileList').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove-file]');
    if (rm) { draftFiles.splice(parseInt(rm.dataset.removeFile, 10), 1); renderFilePreviews(); }
  });
  $('clearUpload').onclick = function () {
    $('uploadForm').reset(); draftImages = []; draftFiles = [];
    renderImagePreviews(); renderFilePreviews(); syncSubGroups();
  };
  if ($('resourceCategory')) $('resourceCategory').addEventListener('change', syncSubGroups);
  $('uploadForm').addEventListener('submit', function (e) { e.preventDefault(); submitForm(); });

  // 详情交互
  $('detailBack').onclick = closeDetail;
  $('detailPage').addEventListener('click', async function (e) {
    var cached = fullCache[detailId];
    var sum = feed.filter(function (x) { return x.id === detailId; })[0] || {};
    var p = Object.assign({}, sum, cached || {});
    if (e.target.closest('#detailLike')) { await toggleLike(detailId); return; }
    if (e.target.closest('#detailDelete')) { if (confirm('确定删除这条资源吗？')) deletePost(detailId); return; }
    if (e.target.closest('#detailHide')) {
      var hideId = detailId;
      hidden[hideId] = 1; saveHidden();
      feed = feed.filter(function (p) { return p.id !== hideId; });
      delete fullCache[hideId];
      closeDetail(); renderHome(); updateProfile();
      toast('已在本机隐藏；服务器上的资源不受影响');
      return;
    }
    var imp = e.target.closest('[data-import]');
    if (imp) { importResource(p, parseInt(imp.dataset.import, 10)); return; }
    var dl = e.target.closest('[data-download]');
    if (dl) { downloadFile(p, parseInt(dl.dataset.download, 10)); return; }
  });

  $('lightboxClose').onclick = function () { $('lightbox').classList.remove('show'); if (!$('detailPage').classList.contains('show')) document.body.style.overflow = ''; };
  $('lightbox').addEventListener('click', function (e) { if (e.target === $('lightbox')) { $('lightbox').classList.remove('show'); if (!$('detailPage').classList.contains('show')) document.body.style.overflow = ''; } });

  // 资料编辑
  $('editProfileBtn').onclick = function () {
    $('nicknameInput').value = user.name;
    $('bioInput').value = user.bio || '';
    avatarDraft = null;
    $('profileModal').classList.add('show');
  };
  function closeProfileModal() { $('profileModal').classList.remove('show'); avatarDraft = null; }
  $('closeProfileModal').onclick = $('cancelProfileModal').onclick = closeProfileModal;
  $('profileModal').addEventListener('click', function (e) { if (e.target === $('profileModal')) closeProfileModal(); });
  $('avatarFile').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.type && f.type.indexOf('image/') !== 0) { toast('请选择图片文件'); return; }
    avatarDraft = await compressImage(f, 200, 0.85);
    toast('头像已选择');
  });
  $('saveProfileModal').onclick = async function () {
    user.name = $('nicknameInput').value.trim() || '资源玩家';
    user.bio = $('bioInput').value.trim() || '分享灵感，也收藏灵感。';
    if (avatarDraft) user.avatar = avatarDraft;
    try { if (db) await idbPut('settings', { key: 'user', value: user }); } catch (e) {}
    feed.forEach(function (s) { if (isOwner(s.id)) { s.author = user.name; s.avatar = user.avatar; } });
    try { localStorage.setItem('market_user', JSON.stringify(user)); } catch (e) {}
    closeProfileModal(); renderHome(); updateProfile();
    toast('资料已保存');
    if (detailId) { var p = fullCache[detailId]; if (p) renderDetail(Object.assign({}, feed.filter(function (x) { return x.id === detailId; })[0] || {}, p)); }
  };

  /* ============================================================
     启动
     ============================================================ */
  async function loadLocalFeed() {
    var items = [];
    try { if (db) items = await idbAll('posts'); } catch (e) {}
    feed = items.filter(function (it) { return it && !hidden[it.id]; })
      .map(toSummary)
      .sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
    items.forEach(function (it) { fullCache[it.id] = it; });
  }

  async function boot() {
    try { renderFolders(); } catch (e) { console.warn('[market] renderFolders failed', e); }
    loadOwned();
    try { var u = JSON.parse(localStorage.getItem('market_user') || 'null'); if (u) user = Object.assign(user, u); } catch (e) {}
    try {
      db = await openDB();
      var si = await idbGet('settings', 'imports'); totalImports = (si && si.value) || 0;
      var su = await idbGet('settings', 'user'); if (su && su.value) user = Object.assign(user, su.value);
    } catch (e) {}

    renderImagePreviews(); renderFilePreviews();

    if (baseURL()) {
      try {
        var r = await api('/market/list');
        if (r && r.ok && Array.isArray(r.items)) {
          mode = MODE.server;
          feed = r.items.filter(function (s) { return s && !hidden[s.id]; });
          // 合并本机自己的资源（保证自己发的即时可见）
          var localOwn = [];
          try { localOwn = (await idbAll('posts')).filter(function (it) { return isOwner(it.id) && !hidden[it.id]; }); } catch (e) {}
          localOwn.forEach(function (it) {
            fullCache[it.id] = it;
            if (!feed.some(function (s) { return s.id === it.id; })) feed.unshift(toSummary(it));
          });
        } else { throw new Error('bad'); }
      } catch (e) {
        mode = MODE.local;
        await loadLocalFeed();
      }
    } else {
      mode = MODE.local;
      await loadLocalFeed();
    }
    updateModeBanner();
    renderHome();
  }

  boot();
})();
