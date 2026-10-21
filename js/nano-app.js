/* nano-app.js — Nano 助手独立 App 首页 */
(function () {
  'use strict';
  var NANO_ID = 'nano_ai';
  var DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ecb"/><stop offset="1" stop-color="#ff4d94"/></linearGradient></defs>' +
    '<rect width="80" height="80" rx="20" fill="url(#g)"/>' +
    '<rect x="18" y="24" width="44" height="34" rx="12" fill="#fff" opacity="0.95"/>' +
    '<circle cx="32" cy="41" r="4.5" fill="#ff4d94"/><circle cx="48" cy="41" r="4.5" fill="#ff4d94"/>' +
    '<rect x="38" y="12" width="4" height="10" rx="2" fill="#fff"/><circle cx="40" cy="11" r="4" fill="#fff"/></svg>');

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
  function openChat(name, avatar) {
    if (window.parent && window.parent !== window) {
      post({ type: 'openChat', chatId: NANO_ID, chatName: name || '纳米', chatAvatar: avatar || '' });
      return;
    }
    location.href = 'chat_inner.html?chat=' + encodeURIComponent(NANO_ID) + '&name=' + encodeURIComponent(name || '纳米');
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

  function getMessages() {
    return new Promise(function (resolve) {
      var key = 'chat_messages_' + NANO_ID;
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

  var current = { name: '纳米', avatar: DEFAULT_AVATAR };

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
      return '<button class="nc-file" data-file="1"><span class="nc-file-icon">' + esc(ext) + '</span><span class="nc-file-main"><span class="nc-file-name">' + esc(f.name) + '</span><span class="nc-file-meta">' + (f.source === 'user' ? '我发送' : 'Nano 生成') + ' · ' + NanoFiles.formatSize(f.size) + '</span></span><span class="nc-file-arrow">›</span></button>';
    }).join('');
  }

  async function refresh() {
    var char = await getChar();
    current.name = (char && char.name) || '纳米';
    current.avatar = (char && char.avatar) || DEFAULT_AVATAR;
    $('ncName').textContent = current.name;
    $('ncAvatar').src = current.avatar;
    $('ncIntro').textContent = '你的专属 Nano 助手 · 美化 / 世界书 / 人设 / 文件';
    var msgs = await getMessages();
    renderMessages(msgs);
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
  $('ncSettings').addEventListener('click', function () { openPage('nano-setting.html', 'Nano 设置'); });
  $('ncSettings2').addEventListener('click', function () { openPage('nano-setting.html', 'Nano 设置'); });
  $('ncFiles').addEventListener('click', function () { openPage('nano-files.html', 'Nano 文件'); });
  $('ncOpenFiles').addEventListener('click', function () { openPage('nano-files.html', 'Nano 文件'); });
  $('ncFilesList').addEventListener('click', function () { openPage('nano-files.html', 'Nano 文件'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  refresh();
})();
