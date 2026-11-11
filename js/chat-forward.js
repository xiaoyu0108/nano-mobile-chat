(function () {
  'use strict';
  if (window.NanoForward) return;

  var CHAR_DB = 'nano_characters_db';
  var GROUPS_KEY = 'nano_groups_data';
  var PENDING_CARDS = 'nano_pending_store_cards';
  var PENDING_GROUP = 'nano_pending_group_cards';
  var MAX_ITEMS = 80;
  var MAX_TEXT = 400;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readOwner() {
    try {
      var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
      for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) {
          var id = d.currentMaskId;
          if (id == null || id === '') return '';
          return String(id);
        }
      }
    } catch (e) {}
    return '';
  }

  function openCharDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(CHAR_DB);
        req.onupgradeneeded = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
          } catch (err) {}
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function getAllChars() {
    return openCharDB().then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { resolve([]); return; }
        try {
          var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
          r.onsuccess = function () { resolve(r.result || []); try { db.close(); } catch (e) {} };
          r.onerror = function () { resolve([]); try { db.close(); } catch (e) {} };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }

  function readGroups() {
    try {
      var raw = localStorage.getItem(GROUPS_KEY);
      if (!raw) return [];
      var d = JSON.parse(raw);
      return (d && Array.isArray(d.groups)) ? d.groups : [];
    } catch (e) { return []; }
  }

  function collectTargets(opts) {
    var owner = String(opts.owner || readOwner() || '');
    var currentId = String(opts.currentId || '');
    var kind = opts.sourceKind === 'group' ? 'group' : 'private';
    return getAllChars().then(function (chars) {
      var byId = {};
      (chars || []).forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; });
      var out = { chats: [], groups: [] };
      (chars || []).forEach(function (c) {
        if (!c || c.id == null || c.nanoAssistant) return;
        if (String(c.id) === currentId && kind === 'private') return;
        if (owner && String(c.bindUser || '') !== owner) return;
        out.chats.push({ id: String(c.id), name: String(c.name || c.id), avatar: c.avatar || '' });
      });
      readGroups().forEach(function (g) {
        if (!g || !g.id) return;
        if (String(g.id) === currentId && kind === 'group') return;
        if (owner) {
          var mine = String(g.createdBy || '') === owner;
          if (!mine) {
            var mem = g.members || [];
            for (var i = 0; i < mem.length; i++) {
              var mc = byId[String(mem[i])];
              if (mc && String(mc.bindUser || '') === owner) { mine = true; break; }
            }
          }
          if (!mine) return;
        }
        out.groups.push({ id: String(g.id), name: String(g.name || '群聊'), avatar: g.avatar || '' });
      });
      out.chats.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
      out.groups.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
      return out;
    });
  }

  function toast(text) {
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:100px;transform:translateX(-50%);z-index:99999;' +
      'max-width:80vw;padding:10px 16px;border-radius:12px;background:rgba(28,28,30,.92);color:#fff;' +
      'font-size:14px;line-height:1.4;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.22);' +
      'transition:opacity .2s ease;';
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; }, 1600);
    setTimeout(function () { try { el.remove(); } catch (e) {} }, 1900);
  }

  function buildCard(opts) {
    var items = Array.isArray(opts.items) ? opts.items.slice(0, MAX_ITEMS) : [];
    return {
      cardType: 'forwardBundle',
      title: '聊天记录',
      sub: '来自 ' + String(opts.sourceName || '聊天'),
      count: items.length,
      footer: '转发聊天记录',
      items: items.map(function (it) {
        return {
          who: String((it && it.who) || ''),
          text: String((it && it.text) || '').slice(0, MAX_TEXT),
          time: String((it && it.time) || '')
        };
      })
    };
  }

  function enqueuePrivate(targetId, entry) {
    var q = {};
    try { q = JSON.parse(localStorage.getItem(PENDING_CARDS) || '{}') || {}; } catch (e) { q = {}; }
    if (!Array.isArray(q[targetId])) q[targetId] = [];
    q[targetId].push(entry);
    localStorage.setItem(PENDING_CARDS, JSON.stringify(q));
  }

  function enqueueGroup(targetId, entry) {
    var q = {};
    try { q = JSON.parse(localStorage.getItem(PENDING_GROUP) || '{}') || {}; } catch (e) { q = {}; }
    if (!Array.isArray(q[targetId])) q[targetId] = [];
    q[targetId].push(entry);
    localStorage.setItem(PENDING_GROUP, JSON.stringify(q));
  }

  function close() {
    var ov = document.getElementById('nanoForwardOverlay');
    if (ov) { ov.style.opacity = '0'; setTimeout(function () { try { ov.remove(); } catch (e) {} }, 180); }
  }

  function renderSheet(targets, opts) {
    close();
    var ov = document.createElement('div');
    ov.id = 'nanoForwardOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.34);display:flex;' +
      'align-items:flex-end;justify-content:center;opacity:0;transition:opacity .18s ease;';
    var sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%;max-width:520px;max-height:78vh;overflow:auto;background:#fff;' +
      'border-radius:18px 18px 0 0;padding:14px 14px calc(18px + env(safe-area-inset-bottom));' +
      'box-sizing:border-box;font-family:inherit;';
    var title = document.createElement('div');
    title.innerHTML = '<div style="font-size:17px;font-weight:600;color:#1c1c1e;margin:2px 4px 4px;">转发到</div>' +
      '<div style="font-size:12px;color:#8e8e93;margin:0 4px 12px;">已选 ' + opts.items.length + ' 条 · 来自 ' + esc(opts.sourceName) + '</div>';
    sheet.appendChild(title);

    if (!opts.mode) opts.mode = 'merge';
    var modeBar = document.createElement('div');
    modeBar.style.cssText = 'display:flex;gap:8px;margin:0 4px 10px;';
    var modeHint = document.createElement('div');
    modeHint.style.cssText = 'font-size:12px;color:#8e8e93;margin:0 4px 10px;';
    var modeButtons = [];
    function modeButton(mode, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'flex:1;padding:9px 10px;border-radius:10px;border:0;font:inherit;font-size:13px;' +
        'cursor:pointer;background:#f2f2f7;color:#636366;';
      function paint() {
        var on = opts.mode === mode;
        b.style.background = on ? '#e8f2ff' : '#f2f2f7';
        b.style.color = on ? '#0a84ff' : '#636366';
        b.style.fontWeight = on ? '600' : '400';
      }
      b.addEventListener('click', function () {
        opts.mode = mode;
        modeButtons.forEach(function (x) { x.paint(); });
        modeHint.textContent = mode === 'split'
          ? '分条转发：每条记录单独作为一条消息发送。'
          : '合并转发：打包成一张聊天记录卡片，点开查看全文。';
      });
      modeButtons.push({ paint: paint });
      paint();
      modeBar.appendChild(b);
    }
    modeButton('merge', '合并转发');
    modeButton('split', '分条转发');
    sheet.appendChild(modeBar);
    modeHint.textContent = opts.mode === 'split'
      ? '分条转发：每条记录单独作为一条消息发送。'
      : '合并转发：打包成一张聊天记录卡片，点开查看全文。';
    sheet.appendChild(modeHint);

    function section(label) {
      var h = document.createElement('div');
      h.textContent = label;
      h.style.cssText = 'font-size:12px;color:#8e8e93;margin:12px 4px 6px;';
      sheet.appendChild(h);
    }

    function row(target, isGroup) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;padding:11px 10px;border:0;' +
        'background:transparent;border-radius:12px;text-align:left;font:inherit;cursor:pointer;' +
        'color:#1c1c1e;font-size:15px;';
      btn.addEventListener('touchstart', function () { btn.style.background = 'rgba(0,0,0,.05)'; }, { passive: true });
      btn.addEventListener('touchend', function () { btn.style.background = 'transparent'; }, { passive: true });
      var av = document.createElement('span');
      av.textContent = String(target.name || '?').charAt(0);
      av.style.cssText = 'width:38px;height:38px;border-radius:10px;flex:0 0 auto;display:flex;align-items:center;' +
        'justify-content:center;background:' + (isGroup ? '#e8f2ff' : '#f2f2f7') + ';color:' + (isGroup ? '#0a84ff' : '#636366') + ';' +
        'font-size:16px;font-weight:600;' + (target.avatar ? 'background-image:url(' + JSON.stringify(target.avatar) + ');background-size:cover;color:transparent;' : '');
      var name = document.createElement('span');
      name.textContent = target.name || target.id;
      name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      var tag = document.createElement('span');
      tag.textContent = isGroup ? '群聊' : '私聊';
      tag.style.cssText = 'font-size:11px;color:#8e8e93;flex:0 0 auto;';
      btn.appendChild(av);
      btn.appendChild(name);
      btn.appendChild(tag);
      btn.addEventListener('click', function () {
        var card = buildCard(opts);
        var entry = { card: card, side: 'right' };
        if (opts.mode === 'split') entry.mode = 'split';
        try {
          if (isGroup) enqueueGroup(target.id, entry);
          else enqueuePrivate(target.id, entry);
          close();
          toast((opts.mode === 'split' ? '已分条转发到「' : '已合并转发到「') + (target.name || target.id) + '」');
        } catch (e) {
          toast('转发失败，请重试');
        }
      });
      sheet.appendChild(btn);
    }

    if (targets.chats.length) {
      section('角色 · 私聊');
      targets.chats.forEach(function (t) { row(t, false); });
    }
    if (targets.groups.length) {
      section('群聊');
      targets.groups.forEach(function (t) { row(t, true); });
    }
    if (!targets.chats.length && !targets.groups.length) {
      var empty = document.createElement('div');
      empty.textContent = '没有可转发的对象';
      empty.style.cssText = 'padding:28px 0;text-align:center;color:#8e8e93;font-size:14px;';
      sheet.appendChild(empty);
    }

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.style.cssText = 'width:100%;margin-top:14px;padding:12px;border:0;border-radius:12px;' +
      'background:#f2f2f7;color:#1c1c1e;font:inherit;font-size:15px;font-weight:500;cursor:pointer;';
    cancel.addEventListener('click', close);
    sheet.appendChild(cancel);

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.appendChild(sheet);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.style.opacity = '1'; });
  }

  function openViewer(cardData) {
    cardData = cardData || {};
    var old = document.getElementById('nanoForwardViewer');
    if (old) { try { old.remove(); } catch (e) {} }
    var items = Array.isArray(cardData.items) ? cardData.items : [];
    var ov = document.createElement('div');
    ov.id = 'nanoForwardViewer';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.34);display:flex;' +
      'align-items:flex-end;justify-content:center;opacity:0;transition:opacity .18s ease;';
    var sheet = document.createElement('div');
    sheet.style.cssText = 'width:100%;max-width:520px;height:55vh;display:flex;flex-direction:column;' +
      'background:#fff;border-radius:18px 18px 0 0;box-sizing:border-box;font-family:inherit;';
    var head = document.createElement('div');
    head.style.cssText = 'padding:14px 16px 10px;border-bottom:1px solid rgba(0,0,0,.06);flex:0 0 auto;';
    head.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '<div><div style="font-size:16px;font-weight:600;color:#1c1c1e;">聊天记录</div>' +
      '<div style="font-size:12px;color:#8e8e93;margin-top:2px;">' + esc(cardData.sub || '合并转发') + ' · 共 ' + (Number(cardData.count) || items.length) + ' 条</div></div>' +
      '<button type="button" data-close style="border:0;background:#f2f2f7;color:#1c1c1e;border-radius:999px;width:30px;height:30px;font-size:18px;line-height:1;cursor:pointer;">×</button></div>';
    var list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow:auto;padding:12px 16px 18px;';
    if (items.length) {
      list.innerHTML = items.map(function (it) {
        if (!it) return '';
        var who = String(it.who || '');
        var when = String(it.time || '');
        var text = String(it.text || '');
        return '<div style="padding:9px 0;border-bottom:1px solid rgba(0,0,0,.05);">' +
          '<div style="font-size:11px;color:#9a8f86;margin-bottom:3px;">' + esc(who) + (when ? (' · ' + esc(when)) : '') + '</div>' +
          '<div style="font-size:14px;line-height:1.55;color:#2c2c2e;white-space:pre-wrap;word-break:break-word;">' + esc(text) + '</div>' +
          '</div>';
      }).join('');
    } else {
      list.innerHTML = '<div style="padding:30px 0;text-align:center;color:#8e8e93;font-size:14px;">没有可显示的聊天记录</div>';
    }
    head.querySelector('[data-close]').addEventListener('click', function () { closeViewer(); });
    sheet.appendChild(head);
    sheet.appendChild(list);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeViewer(); });
    ov.appendChild(sheet);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.style.opacity = '1'; });
    function closeViewer() {
      ov.style.opacity = '0';
      setTimeout(function () { try { ov.remove(); } catch (e) {} }, 180);
    }
  }

  function open(opts) {
    opts = opts || {};
    if (!Array.isArray(opts.items) || !opts.items.length) { toast('请先选择要转发的消息'); return; }
    var run = (opts.targets && (Array.isArray(opts.targets.chats) || Array.isArray(opts.targets.groups)))
      ? Promise.resolve(opts.targets)
      : collectTargets(opts);
    run.then(function (targets) {
      renderSheet({ chats: targets.chats || [], groups: targets.groups || [] }, opts);
    }).catch(function () { toast('读取转发列表失败'); });
  }

  window.NanoForward = { open: open, openViewer: openViewer, buildCard: buildCard };
})();
