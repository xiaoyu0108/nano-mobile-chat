/* nano-app.js — Nano 助手独立 App 首页 */
(function () {
  'use strict';
  var NANO_ID = 'nano_ai';
  var DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
    '<defs><linearGradient id="g" x1="8" y1="6" x2="72" y2="74" gradientUnits="userSpaceOnUse"><stop stop-color="#FFA6C5"/><stop offset=".55" stop-color="#F06A97"/><stop offset="1" stop-color="#CB3F72"/></linearGradient>' +
    '<radialGradient id="h" cx="0" cy="0" r="1" gradientTransform="translate(59 17) rotate(133) scale(54)"><stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="80" height="80" rx="22" fill="url(#g)"/>' +
    '<rect width="80" height="80" rx="22" fill="url(#h)"/>' +
    '<path d="M27 56V24l26 32V24" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round" opacity=".97"/>' +
    '<path d="M60.5 15.4c.72 4.4 4 7.68 8.4 8.4-4.4.72-7.68 4-8.4 8.4-.72-4.4-4-7.68-8.4-8.4 4.4-.72 7.68-4 8.4-8.4z" fill="#fff" opacity=".9"/>' +
    '<rect x="2.5" y="2.5" width="75" height="75" rx="20" fill="none" stroke="#fff" stroke-opacity=".25"/></svg>');

  function nanoAvatar(a) {
    var s = String(a || '');
    if (!s) return DEFAULT_AVATAR;
    // 旧版默认头像是低分辨率机器人脸：自动替换成新的品牌图标，不影响用户自定义头像
    if (s.indexOf('data:image/svg+xml') === 0 && s.indexOf('ff4d94') !== -1 &&
        (s.indexOf('ff9ecb') !== -1 || s.indexOf('x%3D%2218%22') !== -1 || s.indexOf('x="18"') !== -1)) {
      return DEFAULT_AVATAR;
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    var el = $('ncToast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, 1500);
  }
  function post(msg) { try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {} }
  function openPage(url, title) {
    if (window.parent && window.parent !== window) {
      post({ type: 'openFullscreen', url: url, title: title, showBack: true, source: 'settings' });
      return;
    }
    location.href = url;
  }
  var SESSION_KEY = 'nano_chat_sessions_v1';
  var CURRENT_KEY = 'nano_current_session';

  function loadSessions() {
    var list = [];
    try { list = JSON.parse(localStorage.getItem(SESSION_KEY) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (s) { return s && s.id; });
    if (!list.some(function (s) { return s.id === NANO_ID; })) {
      list.unshift({ id: NANO_ID, title: '主对话', createdAt: Date.now(), updatedAt: Date.now() });
    }
    list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return list;
  }
  function saveSessions(list) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify((list || []).slice(0, 40))); } catch (e) {}
  }
  function currentSessionId() {
    var id = '';
    try { id = localStorage.getItem(CURRENT_KEY) || ''; } catch (e) {}
    if (!id) id = NANO_ID;
    var list = loadSessions();
    if (!list.some(function (s) { return s.id === id; })) {
      id = NANO_ID;
      try { localStorage.setItem(CURRENT_KEY, id); } catch (e) {}
    }
    return id;
  }
  function touchSession(id, title) {
    if (!id) return;
    var list = loadSessions();
    var hit = list.find(function (s) { return s.id === id; });
    if (!hit) { hit = { id: id, title: title || '新对话', createdAt: Date.now() }; list.unshift(hit); }
    if (title) hit.title = title;
    hit.updatedAt = Date.now();
    saveSessions(list);
  }
  function newSession() {
    var id = NANO_ID + '_' + Date.now().toString(36);
    var list = loadSessions();
    list.unshift({ id: id, title: '新对话', createdAt: Date.now(), updatedAt: Date.now() });
    saveSessions(list);
    try { localStorage.setItem(CURRENT_KEY, id); } catch (e) {}
    openChat(current.name, current.avatar, id);
  }
  function renameSession(id) {
    if (!id) return;
    var list = loadSessions();
    var hit = list.find(function (s) { return s.id === id; });
    if (!hit) return;
    var next = '';
    try { next = prompt('重命名对话', hit.title || '新对话'); } catch (e) { next = ''; }
    if (next == null) return;
    next = String(next).replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!next) { toast('名字不能为空'); return; }
    hit.title = next;
    hit.updatedAt = Date.now();
    saveSessions(list);
    toast('对话已重命名');
    refreshSessions();
  }
  function deleteSession(id) {
    if (!id || id === NANO_ID) { toast('主对话不能删除'); return; }
    if (!confirm('删除这个对话窗口？聊天记录会一起删除。')) return;
    var list = loadSessions().filter(function (s) { return s.id !== id; });
    saveSessions(list);
    var key = 'chat_messages_' + id;
    try { localStorage.removeItem(key); } catch (e) {}
    try { if (window.localforage) localforage.removeItem(key).catch(function () {}); } catch (e) {}
    if (currentSessionId() === id) { try { localStorage.setItem(CURRENT_KEY, NANO_ID); } catch (e) {} }
    refresh();
  }
  function titleFromMessages(msgs) {
    var list = Array.isArray(msgs) ? msgs : [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m && m.type === 'right' && m.text && !m.isCard) return String(m.text).replace(/\s+/g, ' ').trim().slice(0, 18);
    }
    for (var j = 0; j < list.length; j++) {
      var n = list[j];
      if (n && n.text && !n.isCard) return String(n.text).replace(/\s+/g, ' ').trim().slice(0, 18);
    }
    return '';
  }
  function timeLabel(ts) {
    var d = new Date(ts || Date.now());
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return sameDay ? (hh + ':' + mm) : ((d.getMonth() + 1) + '/' + d.getDate());
  }

  function openChat(name, avatar, sessionId) {
    sessionId = sessionId || currentSessionId();
    try { localStorage.setItem(CURRENT_KEY, sessionId); } catch (e) {}
    touchSession(sessionId);
    if (window.parent && window.parent !== window) {
      post({ type: 'openChat', chatId: sessionId, chatName: name || '纳米', chatAvatar: avatar || '' });
      return;
    }
    location.href = 'chat_inner.html?chat=' + encodeURIComponent(sessionId) + '&name=' + encodeURIComponent(name || '纳米');
  }

  function getChar() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_characters_db', 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
        };
        req.onsuccess = function () {
          var db = req.result;
          try {
            var rq = db.transaction('characters', 'readonly').objectStore('characters').get(NANO_ID);
            rq.onsuccess = function () { db.close(); resolve(rq.result || null); };
            rq.onerror = function () { db.close(); resolve(null); };
          } catch (e) { db.close(); resolve(null); }
        };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function getMessagesFor(sessionId) {
    return new Promise(function (resolve) {
      var key = 'chat_messages_' + (sessionId || NANO_ID);
      try {
        if (window.localforage) {
          localforage.getItem(key).then(function (v) {
            if (Array.isArray(v)) return resolve(v);
            try { resolve(JSON.parse(localStorage.getItem(key) || '[]') || []); } catch (e) { resolve([]); }
          }).catch(function () {
            try { resolve(JSON.parse(localStorage.getItem(key) || '[]') || []); } catch (e) { resolve([]); }
          });
          return;
        }
      } catch (e) {}
      try { resolve(JSON.parse(localStorage.getItem(key) || '[]') || []); } catch (e) { resolve([]); }
    });
  }
  function getMessages() { return getMessagesFor(currentSessionId()); }

  var current = { name: '纳米', avatar: DEFAULT_AVATAR };
  var NC_ICON = {
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 6.5l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function renderMessages(msgs) {
    var box = $('ncMessages'); if (!box) return;
    var list = (Array.isArray(msgs) ? msgs : []).filter(function (m) { return m && (m.text || m.isCard); }).slice(-3);
    if (!list.length) {
      box.innerHTML = '<div class="nc-empty">还没有对话，点「开始对话」找 Nano。</div>';
      return;
    }
    box.innerHTML = list.map(function (m) {
      var text = m.isCard ? ('[卡片] ' + ((m.cardData && (m.cardData.name || m.cardData.title)) || '文件')) : String(m.text || '');
      var who = m.type === 'right' ? '我' : 'Nano';
      return '<div class="nc-msg ' + (m.type === 'right' ? 'me' : '') + '"><span class="nc-msg-role">' + who + '</span><span class="nc-msg-t">' + esc(text) + '</span></div>';
    }).join('');
  }

  function renderSessions(rows, activeId) {
    var box = $('ncSessionList'); if (!box) return;
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) {
      box.innerHTML = '<div class="nc-empty">还没有对话窗口，点「新对话」开始。</div>';
      return;
    }
    box.innerHTML = rows.map(function (s) {
      var active = s.id === activeId;
      var isMain = s.id === NANO_ID;
      return '<div class="nc-session' + (active ? ' active' : '') + '">' +
        '<button type="button" class="nc-session-main" data-session="' + esc(s.id) + '">' +
        '<span class="nc-session-title">' + esc(s.title || '新对话') + '</span>' +
        '<span class="nc-session-meta">' + (s.count || 0) + ' 条消息 · ' + timeLabel(s.updatedAt) + (active ? ' · 当前窗口' : '') + '</span>' +
        '</button>' +
        '<button type="button" class="nc-session-edit" data-rename-session="' + esc(s.id) + '" aria-label="重命名">' + NC_ICON.edit + '</button>' +
        (isMain ? '' : '<button type="button" class="nc-session-del" data-del-session="' + esc(s.id) + '" aria-label="删除">' + NC_ICON.x + '</button>') +
        '</div>';
    }).join('');
  }

  async function refreshSessions() {
    var list = loadSessions();
    var active = currentSessionId();
    var rows = [];
    for (var i = 0; i < Math.min(list.length, 10); i++) {
      var s = list[i];
      var msgs = await getMessagesFor(s.id);
      var autoTitle = titleFromMessages(msgs);
      var title = s.title || '';
      if ((!title || title === '新对话') && autoTitle) {
        title = autoTitle;
        s.title = title;
        s.updatedAt = s.updatedAt || Date.now();
        var all = loadSessions();
        var hit = all.find(function (x) { return x.id === s.id; });
        if (hit) { hit.title = title; saveSessions(all); }
      }
      rows.push({ id: s.id, title: title || '新对话', updatedAt: s.updatedAt, count: (Array.isArray(msgs) ? msgs.length : 0) });
    }
    renderSessions(rows, active);
  }


  function renderFiles(files) {
    var box = $('ncFilesList'); if (!box) return;
    var list = (Array.isArray(files) ? files : []).slice(0, 3);
    $('ncFileCount').textContent = Array.isArray(files) ? files.length : 0;
    if (!list.length) {
      box.innerHTML = '<div class="nc-empty">还没有生成文件。让 Nano 帮你导出 CSS、文本或代码，就会出现在这里。</div>';
      return;
    }
    box.innerHTML = list.map(function (f) {
      var ext = String(f.ext || 'txt').toUpperCase().slice(0, 4);
      return '<button class="nc-file" data-file="1"><span class="nc-file-icon">' + esc(ext) + '</span><span class="nc-file-main"><span class="nc-file-name">' + esc(f.name) + '</span><span class="nc-file-meta">' + (f.source === 'user' ? '我发送' : 'Nano 生成') + ' · ' + NanoFiles.formatSize(f.size) + '</span></span><span class="nc-file-arrow">' + NC_ICON.chev + '</span></button>';
    }).join('');
  }

  async function refresh() {
    var char = await getChar();
    current.name = (char && char.name) || '纳米';
    current.avatar = nanoAvatar(char && char.avatar);
    $('ncName').textContent = current.name;
    $('ncAvatar').src = current.avatar;
    $('ncIntro').textContent = '你的专属 Nano 助手 · 美化 / 世界书 / 人设 / 文件';
    var msgs = await getMessages();
    renderMessages(msgs);
    var sid = currentSessionId();
    var autoTitle = titleFromMessages(msgs);
    var sessions = loadSessions();
    var hit = sessions.find(function (s) { return s.id === sid; });
    if (hit && (!hit.title || hit.title === '新对话') && autoTitle) {
      hit.title = autoTitle;
      hit.updatedAt = Date.now();
      saveSessions(sessions);
    }
    try { await refreshSessions(); } catch (e) {}
    try {
      if (window.NanoFiles) {
        var imports = (Array.isArray(msgs) ? msgs : []).filter(function (m) {
          return m && m.isCard && m.cardData && m.cardData.cardType === 'file' && m.cardData.content;
        }).map(function (m) {
          return NanoFiles.add({
            id: m.cardData.fileId || ('msg_' + m.id),
            name: m.cardData.name || '文件',
            content: m.cardData.content,
            source: m.type === 'right' ? 'user' : 'nano',
            messageId: m.id,
            chatId: NANO_ID
          }).catch(function () {});
        });
        if (imports.length) await Promise.all(imports);
      }
      var files = window.NanoFiles ? await NanoFiles.list() : [];
      renderFiles(files);
    } catch (e) { renderFiles([]); }
  }

  $('ncBack').addEventListener('click', function () {
    if (window.parent && window.parent !== window) { post({ type: 'closeFullscreen' }); return; }
    try { history.back(); } catch (e) {}
  });
  $('ncChat').addEventListener('click', function () { openChat(current.name, current.avatar); });
  $('ncOpenChat').addEventListener('click', function () { openChat(current.name, current.avatar); });
  var newSessionBtn = $('ncNewSession');
  if (newSessionBtn) newSessionBtn.addEventListener('click', function () { newSession(); });
  var sessionListEl = $('ncSessionList');
  if (sessionListEl) sessionListEl.addEventListener('click', function (e) {
    var ren = e.target && e.target.closest ? e.target.closest('[data-rename-session]') : null;
    if (ren) {
      e.stopPropagation();
      renameSession(ren.getAttribute('data-rename-session'));
      return;
    }
    var del = e.target && e.target.closest ? e.target.closest('[data-del-session]') : null;
    if (del) {
      e.stopPropagation();
      deleteSession(del.getAttribute('data-del-session'));
      return;
    }
    var row = e.target && e.target.closest ? e.target.closest('[data-session]') : null;
    if (row) openChat(current.name, current.avatar, row.getAttribute('data-session'));
  });
  $('ncSettings').addEventListener('click', function () { openPage('nano-setting.html', 'Nano 设置'); });
  $('ncSettings2').addEventListener('click', function () { openPage('nano-setting.html', 'Nano 设置'); });
  var imageBtn = $('ncImage');
    if (imageBtn) imageBtn.addEventListener('click', function () { openPage('nano-image.html', 'Nano 生图室'); });
  $('ncFiles').addEventListener('click', function () { openPage('nano-files.html', 'Nano 文件'); });
  $('ncOpenFiles').addEventListener('click', function () { openPage('nano-files.html', 'Nano 文件'); });
  $('ncFilesList').addEventListener('click', function () { openPage('nano-files.html', 'Nano 文件'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  refresh();
})();
