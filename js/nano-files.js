/* nano-files.js — Nano 文件库（独立于聊天消息）
   存储：IndexedDB nano_files_db / files
   用途：1) 归档 Nano 聊天里的文件卡片；2) 保存 Nano 主动生成的文件；
        3) Nano 文件页的列表、预览、下载、删除。 */
(function () {
  'use strict';
  var DB_NAME = 'nano_files_db';
  var STORE = 'files';
  var VERSION = 1;
  var CHAT_ID = 'nano_ai';
  var TOMB_KEY = 'nano_files_tombstones';
  var MIME = {
    txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8',
    css: 'text/css;charset=utf-8', html: 'text/html;charset=utf-8',
    js: 'text/javascript;charset=utf-8', json: 'application/json;charset=utf-8',
    csv: 'text/csv;charset=utf-8', xml: 'application/xml;charset=utf-8',
    svg: 'image/svg+xml', yml: 'text/yaml;charset=utf-8', yaml: 'text/yaml;charset=utf-8'
  };

  function openDB() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var store = db.createObjectStore(STORE, { keyPath: 'id' });
            try { store.createIndex('createdAt', 'createdAt', { unique: false }); } catch (err) {}
            try { store.createIndex('source', 'source', { unique: false }); } catch (err) {}
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('文件库打开失败')); };
      } catch (e) { reject(e); }
    });
  }

  function withStore(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE, mode);
          var store = tx.objectStore(STORE);
          var out = fn(store);
          tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(out); };
          tx.onerror = function () { try { db.close(); } catch (e) {} reject(tx.error || new Error('文件库操作失败')); };
          tx.onabort = function () { try { db.close(); } catch (e) {} reject(tx.error || new Error('文件库操作取消')); };
        } catch (e) { try { db.close(); } catch (e2) {} reject(e); }
      });
    });
  }

  function reqPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('读取失败')); };
    });
  }

  function getTombs() {
    try {
      var arr = JSON.parse(localStorage.getItem(TOMB_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveTombs(arr) {
    try { localStorage.setItem(TOMB_KEY, JSON.stringify((arr || []).slice(-1500))); } catch (e) {}
  }
  function isTomb(id) { return getTombs().indexOf(String(id)) > -1; }
  function addTomb(id) {
    id = String(id || '');
    if (!id) return;
    var arr = getTombs();
    if (arr.indexOf(id) === -1) { arr.push(id); saveTombs(arr); }
  }

  function normalize(file) {
    file = file || {};
    var name = String(file.name || '').trim() || ('nano-' + Date.now() + '.txt');
    var content = file.content == null ? '' : file.content;
    if (typeof content !== 'string') {
      try { content = JSON.stringify(content, null, 2); } catch (e) { content = String(content); }
    }
    var dot = name.lastIndexOf('.');
    var ext = String(file.ext || (dot > -1 ? name.slice(dot + 1) : 'txt')).replace(/^\./, '').toLowerCase();
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.' + (ext || 'txt');
    dot = name.lastIndexOf('.');
    ext = ext || (dot > -1 ? name.slice(dot + 1).toLowerCase() : 'txt');
    return {
      id: String(file.id || ('f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))),
      name: name,
      ext: ext,
      size: Number(file.size || content.length || 0),
      content: content,
      source: file.source === 'user' ? 'user' : 'nano',
      kind: String(file.kind || 'file'),
      action: String(file.action || ''),
      messageId: String(file.messageId || ''),
      chatId: String(file.chatId || CHAT_ID),
      createdAt: Number(file.createdAt || Date.now()),
      updatedAt: Date.now()
    };
  }

  async function add(file) {
    var rec = normalize(file);
    if (!String(rec.content).trim() && !rec.size) throw new Error('文件内容为空');
    if (isTomb(rec.id)) return null;
    try {
      var existing = await get(rec.id);
      if (existing && existing.createdAt) rec.createdAt = existing.createdAt;
      await withStore('readwrite', function (store) { store.put(rec); });
      return rec;
    } catch (e) {
      throw e;
    }
  }

  async function get(id) {
    try {
      return await withStore('readonly', function (store) { return reqPromise(store.get(String(id))); });
    } catch (e) { return null; }
  }

  async function list() {
    try {
      var all = await withStore('readonly', function (store) { return reqPromise(store.getAll()); });
      return (Array.isArray(all) ? all : []).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    } catch (e) { return []; }
  }

  async function remove(id) {
    addTomb(id);
    await withStore('readwrite', function (store) { store.delete(String(id)); });
    return true;
  }

  async function clear() {
    try {
      var cur = await list();
      cur.forEach(function (f) { addTomb(f.id); });
      if (window.localforage) {
        var msgs = await localforage.getItem('chat_messages_' + CHAT_ID);
        (Array.isArray(msgs) ? msgs : []).forEach(function (m) {
          if (m && m.isCard && m.cardData && m.cardData.cardType === 'file') {
            addTomb(m.cardData.fileId || ('msg_' + m.id));
          }
        });
      }
    } catch (e) {}
    await withStore('readwrite', function (store) { store.clear(); });
    return true;
  }

  function formatSize(n) {
    n = Number(n || 0);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function download(file) {
    if (!file) return;
    var type = MIME[String(file.ext || '').toLowerCase()] || 'text/plain;charset=utf-8';
    var blob = new Blob([String(file.content || '')], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = file.name || 'nano-file.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1500);
  }

  window.NanoFiles = {
    add: add, get: get, list: list, remove: remove, clear: clear,
    download: download, formatSize: formatSize, normalize: normalize
  };

  /* ---------- Nano 文件页 ---------- */
  if (document.getElementById('nfList')) {
    var state = { all: [], filter: 'all', q: '' };
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var toastTimer = null;
    function toast(msg) {
      var el = $('nfToast'); if (!el) return;
      el.textContent = msg; el.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1500);
    }
    function sourceLabel(f) { return f.source === 'user' ? '我发送' : 'Nano 生成'; }
    function dateText(ts) {
      var d = new Date(ts || Date.now());
      var now = new Date();
      var sameYear = d.getFullYear() === now.getFullYear();
      return (sameYear ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    function filtered() {
      var q = state.q.toLowerCase();
      return state.all.filter(function (f) {
        if (state.filter !== 'all' && f.source !== state.filter) return false;
        if (!q) return true;
        return (f.name + ' ' + f.content).toLowerCase().indexOf(q) > -1;
      });
    }
    function renderStats() {
      var total = state.all.reduce(function (n, f) { return n + (Number(f.size) || 0); }, 0);
      $('nfCount').textContent = state.all.length;
      $('nfSize').textContent = formatSize(total);
    }
    function render() {
      var items = filtered();
      var list = $('nfList');
      if (!items.length) {
        list.innerHTML = '';
        $('nfEmpty').style.display = 'block';
        $('nfEmpty').textContent = state.all.length ? '没有找到匹配的文件' : '还没有文件。Nano 生成文件或你发来文件后，会永久保存在这里。';
        return;
      }
      $('nfEmpty').style.display = 'none';
      list.innerHTML = items.map(function (f) {
        var preview = String(f.content || '').replace(/\s+/g, ' ').slice(0, 130);
        return '<button class="nf-item" data-id="' + esc(f.id) + '">' +
          '<div class="nf-icon">' + esc((f.ext || 'txt').toUpperCase().slice(0, 4)) + '</div>' +
          '<div class="nf-main"><div class="nf-name">' + esc(f.name) + '</div>' +
          '<div class="nf-preview">' + esc(preview || '（空文件）') + '</div>' +
          '<div class="nf-meta"><span class="nf-src ' + (f.source === 'user' ? 'user' : '') + '">' + sourceLabel(f) + '</span>' +
          '<span>' + dateText(f.createdAt) + '</span><span>' + formatSize(f.size) + '</span></div></div>' +
          '<span class="nf-arrow">›</span></button>';
      }).join('');
    }
    function openPreview(f) {
      if (!f) return;
      $('nfPreviewTitle').textContent = f.name;
      $('nfPreviewMeta').textContent = sourceLabel(f) + ' · ' + dateText(f.createdAt) + ' · ' + formatSize(f.size);
      $('nfPreviewCode').textContent = String(f.content || '');
      $('nfPreview').classList.add('show');
      $('nfPreview').dataset.id = f.id;
    }
    function closePreview() { $('nfPreview').classList.remove('show'); $('nfPreview').dataset.id = ''; }
    async function importFromChat() {
      if (!window.localforage) return;
      try {
        var msgs = await localforage.getItem('chat_messages_' + CHAT_ID);
        if (!Array.isArray(msgs) || !msgs.length) return;
        var tasks = msgs.filter(function (m) {
          return m && m.isCard && m.cardData && m.cardData.cardType === 'file' && m.cardData.content;
        }).map(function (m) {
          return add({
            id: m.cardData.fileId || ('msg_' + m.id),
            name: m.cardData.name || '文件',
            content: m.cardData.content,
            source: m.type === 'right' ? 'user' : 'nano',
            messageId: m.id,
            chatId: CHAT_ID
          }).catch(function () {});
        });
        if (tasks.length) await Promise.all(tasks);
      } catch (e) {}
    }
    async function refresh() {
      await importFromChat();
      state.all = await list();
      renderStats(); render();
    }
    $('nfList').addEventListener('click', function (e) {
      var item = e.target.closest('.nf-item'); if (!item) return;
      var f = state.all.find(function (x) { return x.id === item.dataset.id; });
      openPreview(f);
    });
    $('nfFilters').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]'); if (!b) return;
      state.filter = b.dataset.f;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      render();
    });
    $('nfSearch').addEventListener('input', function () { state.q = this.value.trim(); render(); });
    $('nfClear').addEventListener('click', async function () {
      if (!state.all.length) return toast('文件库已经是空的');
      if (!confirm('清空 Nano 文件库？只删除这里的文件，不影响聊天记录。')) return;
      await clear(); await refresh(); toast('文件库已清空');
    });
    $('nfPreviewClose').addEventListener('click', closePreview);
    $('nfPreview').addEventListener('click', function (e) { if (e.target === this) closePreview(); });
    $('nfPreviewDownload').addEventListener('click', function () {
      var f = state.all.find(function (x) { return x.id === $('nfPreview').dataset.id; });
      if (f) { download(f); toast('已开始下载'); }
    });
    $('nfPreviewDelete').addEventListener('click', async function () {
      var f = state.all.find(function (x) { return x.id === $('nfPreview').dataset.id; });
      if (!f) return;
      if (!confirm('删除这个文件？只删除文件库里的副本，不影响聊天。')) return;
      await remove(f.id); closePreview(); await refresh(); toast('已删除');
    });
    $('nfBack').addEventListener('click', function () {
      // Nano 文件页也回到 Nano 首页
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'openFullscreen', url: 'nano.html', title: 'Nano', showBack: true, source: 'main' }, '*');
          return;
        }
      } catch (e) {}
      location.href = 'nano.html';
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    refresh();
  }
})();
