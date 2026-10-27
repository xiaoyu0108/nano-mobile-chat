(function () {
  'use strict';

  var DB_NAME = 'nano_app_storage';
  var DB_STORE = 'kv';
  var IDB_KEY = 'nano_schedule_v2';
  var LS_KEY = 'charSchedule.v2';

  var cache = {
    store: null,
    charId: '',
    charName: '',
    data: null,
    block: '',
    loading: null
  };

  function pad(n) { return String(n).padStart(2, '0'); }
  function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return dstr(new Date()); }
  function toMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    return m ? (+m[1]) * 60 + (+m[2]) : 0;
  }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowText(d) {
    d = (d instanceof Date) ? d : new Date();
    return dstr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getCharId() {
    try { return String(new URLSearchParams(location.search).get('chat') || ''); } catch (e) { return ''; }
  }
  function getCharName() {
    try { return String(new URLSearchParams(location.search).get('name') || ''); } catch (e) { return ''; }
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function () { reject(req.error || new Error('idb open failed')); };
      } catch (e) { reject(e); }
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
          r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); try { db.close(); } catch (e) {} };
          r.onerror = function () { resolve(null); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(null); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return null; });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(value, key);
          tx.oncomplete = function () { resolve(true); try { db.close(); } catch (e) {} };
          tx.onerror = function () { resolve(false); try { db.close(); } catch (e) {} };
          tx.onabort = function () { resolve(false); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(false); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return false; });
  }

  function normalizeStore(o) {
    if (!o || typeof o !== 'object') return { version: 2, lastCharId: '', chars: {} };
    if (!o.chars || typeof o.chars !== 'object') o.chars = {};
    o.version = 2;
    return o;
  }

  function readLocalStore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return normalizeStore(JSON.parse(raw));
    } catch (e) { return null; }
  }

  function lightStore(store) {
    try {
      return JSON.parse(JSON.stringify(store, function (k, v) {
        if (k === 'src' && typeof v === 'string' && v.indexOf('data:') === 0) return '';
        return v;
      }));
    } catch (e) { return store; }
  }

  function writeStore(store) {
    store = normalizeStore(store);
    var p = idbSet(IDB_KEY, store);
    try {
      var txt = JSON.stringify(lightStore(store));
      if (txt.length < 4300000) localStorage.setItem(LS_KEY, txt);
    } catch (e) {}
    return p;
  }

  function readStore() {
    return idbGet(IDB_KEY).then(function (o) {
      if (o) return normalizeStore(o);
      var local = readLocalStore();
      if (local) return local;
      return { version: 2, lastCharId: '', chars: {} };
    }).catch(function () {
      return readLocalStore() || { version: 2, lastCharId: '', chars: {} };
    });
  }

  function findData(store, id, name) {
    if (!store || !store.chars) return null;
    if (id && store.chars[id]) return store.chars[id];
    if (name) {
      var ids = Object.keys(store.chars);
      for (var i = 0; i < ids.length; i++) {
        var d = store.chars[ids[i]];
        if (d && d.settings && String(d.settings.name || '') === String(name)) return d;
      }
    }
    if (!id && !name && store.lastCharId && store.chars[store.lastCharId]) return store.chars[store.lastCharId];
    return null;
  }

  function eventsOf(data, date) {
    if (!data || !Array.isArray(data.events)) return [];
    return data.events.filter(function (e) { return e && e.date === date; })
      .sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
  }

  function currentEvent(data, dayKey, mins) {
    var d = dayKey || today(), nm = (typeof mins === 'number') ? mins : nowMin();
    var list = eventsOf(data, d);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.status === 'cancelled') continue;
      if (toMin(e.start) <= nm && nm < toMin(e.end)) return e;
    }
    return null;
  }

  function isSleepEvent(e) {
    if (!e) return false;
    var s = String(e.title || '') + ' ' + String(e.note || '') + ' ' + String(e.tag || '');
    return /睡|就寝|晚安|入睡|睡眠|午睡/.test(s);
  }

  function isLateNight(d) {
    var h = (d instanceof Date ? d : new Date()).getHours();
    return h >= 22 || h < 8;
  }

  function wakeKey(id) { return 'nano_schedule_wake_' + (id || 'default'); }

  function readWake(id, dayKey) {
    try {
      var o = JSON.parse(localStorage.getItem(wakeKey(id)) || 'null');
      return o && o.date === (dayKey || today()) ? o : null;
    } catch (e) { return null; }
  }

  function markWoken(id, eventId) {
    try {
      localStorage.setItem(wakeKey(id), JSON.stringify({
        date: today(), at: Date.now(), eventId: eventId || ''
      }));
    } catch (e) {}
  }

  function eventLine(e, withId) {
    var s = e.start + '-' + e.end + ' ' + (e.title || '安排');
    var ex = [];
    if (e.place) ex.push(e.place);
    if (e.who) ex.push('与' + e.who);
    if (e.note) ex.push(String(e.note).replace(/\s+/g, ' ').slice(0, 50));
    if (ex.length) s += '（' + ex.join('，') + '）';
    if (e.status === 'cancelled') s += '［已划掉' + (e.reason ? '：' + e.reason : '') + '］';
    else if (e.status === 'done') s += '［已完成］';
    if (withId) s += ' [id:' + e.id + ']';
    return '- ' + s;
  }

  function buildBlock(data, id, name, wallNow) {
    if (!data) return '';
    // wallNow：角色所在地的「墙上时间」（外国角色不能按设备时区判断作息）
    var wn = (wallNow instanceof Date) ? wallNow : new Date();
    var d = dstr(wn);
    var todayEvents = eventsOf(data, d);
    var tm = new Date(wn.getTime() + 86400000);
    var tomorrow = dstr(tm);
    var tomorrowEvents = eventsOf(data, tomorrow);
    var cur = currentEvent(data, d, wn.getHours() * 60 + wn.getMinutes());
    var wake = readWake(id, d);
    var lines = [];
    lines.push('【你的真实日程 · 当前状态（重要）】');
    lines.push('现在时间：' + nowText(wn) + '。');
    if (todayEvents.length) {
      lines.push('你今天的安排：');
      todayEvents.slice(0, 16).forEach(function (e) { lines.push(eventLine(e, true)); });
    } else {
      lines.push('你今天还没有排日程。');
    }
    if (cur) {
      lines.push('你此刻正处于：' + cur.start + '-' + cur.end + ' ' + (cur.title || '安排') +
        (cur.place ? '（' + cur.place + '）' : '') + (cur.note ? '，' + cur.note : ''));
    } else {
      lines.push('你此刻没有正在进行的安排（空档时间）。');
    }
    if (tomorrowEvents.length) {
      lines.push('你明天的安排：');
      tomorrowEvents.slice(0, 12).forEach(function (e) { lines.push(eventLine(e, true)); });
    }
    lines.push('以上是你本人真实的日程和此刻状态。聊天时不要与之矛盾：用户问你在做什么/在哪，就按当前安排自然回答；不要编造与日程冲突的事。');
    if (wake) {
      var wokeEvent = null;
      for (var i = 0; i < todayEvents.length; i++) {
        if (String(todayEvents[i].id) === String(wake.eventId)) { wokeEvent = todayEvents[i]; break; }
      }
      if (Date.now() - (wake.at || 0) < 4 * 3600 * 1000) {
        lines.push('【你刚被用户叫醒】你本来在' + (wokeEvent ? ('「' + (wokeEvent.title || '睡觉') + '」') : '睡觉') +
          '，是用户把你叫醒的。你知道是 TA 叫醒的你，可以自然表现出困倦、被打断、或者被吵醒后的真实反应，不要装作没发生过。');
      }
    } else if (cur && isSleepEvent(cur) && isLateNight(wn)) {
      lines.push('【你正在睡觉】现在是深夜，你正在睡觉。若被消息吵到，你会是半睡半醒的状态；不要主动说自己被叫醒，除非用户确实叫了你。');
    }
    try {
      if (data.settings && data.settings.charId) {
        lines.push('你的角色名：' + (data.settings.name || name || '') + '。');
      }
    } catch (e) {}
    lines.push('');
    lines.push('【日程变动标记（必须遵守）】如果这轮聊天真的改变了你的计划（取消、改期、临时新增安排），在回复最后单独一行输出下面其中一个标记；标记不会显示给用户。只有确实改变时才输出，不要为了输出而改变计划：');
    lines.push('[schedule:cancel|事件ID|原因]');
    lines.push('[schedule:move|事件ID|新开始HH:MM|新结束HH:MM|原因]');
    lines.push('[schedule:add|YYYY-MM-DD|HH:MM|HH:MM|标题|地点|备注]');
    return lines.join('\n');
  }

  function refreshContext(opts) {
    opts = opts || {};
    var id = String(opts.charId || getCharId() || '');
    var name = String(opts.charName || getCharName() || '');
    if (cache.loading) return cache.loading;
    cache.loading = readStore().then(function (store) {
      var data = findData(store, id, name);
      cache.store = store;
      cache.charId = id || (store.lastCharId || '');
      cache.charName = name;
      cache.data = data;
      // 角色当地时间（与系统提示词的时间块一致，避免日程说「现在 12:00」而角色那边是凌晨）
      var wallNow = null;
      try {
        if (window.NanoHoliday && window.NanoHoliday.wallClock) {
          wallNow = window.NanoHoliday.wallClock(new Date(), window.NanoHoliday.tzForNationality(opts.nationality || ''));
        }
      } catch (e) {}
      cache.block = data ? buildBlock(data, cache.charId, name, wallNow) : '';
      return cache.block;
    }).catch(function () {
      cache.block = '';
      return '';
    }).then(function (block) {
      cache.loading = null;
      return block;
    });
    return cache.loading;
  }

  function promptBlockSync() {
    return cache.block || '';
  }

  function ensureModal() {
    var el = document.getElementById('nanoScheduleSleepModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'nanoScheduleSleepModal';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.38);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);';
    el.innerHTML =
      '<div style="width:100%;max-width:320px;background:#fff;border-radius:22px;padding:22px 20px 18px;box-shadow:0 24px 70px rgba(0,0,0,.3);text-align:center;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;">' +
        '<div style="width:44px;height:44px;border-radius:50%;background:#f2f2f7;display:grid;place-items:center;margin:0 auto 12px;color:#1c1c1e;font-size:22px;">◔</div>' +
        '<div style="font-size:17px;font-weight:700;color:#1c1c1e;">对方正在睡觉啦</div>' +
        '<div id="nanoScheduleSleepBody" style="margin-top:8px;font-size:13px;line-height:1.6;color:#6b6b70;"></div>' +
        '<div style="display:flex;gap:10px;margin-top:18px;">' +
          '<button id="nanoScheduleSleepNo" style="flex:1;height:44px;border:0;border-radius:14px;background:#f2f2f7;color:#1c1c1e;font-size:15px;font-weight:600;">让他睡</button>' +
          '<button id="nanoScheduleSleepYes" style="flex:1;height:44px;border:0;border-radius:14px;background:#111;color:#fff;font-size:15px;font-weight:600;">叫醒他</button>' +
        '</div>' +
      '</div>';
    el.addEventListener('click', function (e) { if (e.target === el) closeSleepModal(); });
    document.body.appendChild(el);
    return el;
  }

  var pendingProceed = null;

  function closeSleepModal() {
    var el = document.getElementById('nanoScheduleSleepModal');
    if (el) el.style.display = 'none';
    pendingProceed = null;
  }

  function showSleepModal(proceed, data) {
    var el = ensureModal();
    var body = document.getElementById('nanoScheduleSleepBody');
    var name = (data && data.settings && data.settings.name) || cache.charName || 'TA';
    var ev = currentEvent(data);
    if (body) {
      body.textContent = name + ' 正在' + ((ev && ev.title) ? ('「' + ev.title + '」') : '睡觉') +
        '，确认要叫醒 TA 吗？';
    }
    pendingProceed = proceed || null;
    el.style.display = 'flex';
    var yes = document.getElementById('nanoScheduleSleepYes');
    var no = document.getElementById('nanoScheduleSleepNo');
    if (yes && !yes.__nanoBound) {
      yes.__nanoBound = true;
      yes.addEventListener('click', function () {
        var fn = pendingProceed;
        var e = currentEvent(cache.data);
        markWoken(cache.charId || getCharId(), e ? e.id : '');
        closeSleepModal();
        refreshContext().then(function () {
          if (fn) { try { fn(); } catch (err) {} }
        });
      });
    }
    if (no && !no.__nanoBound) {
      no.__nanoBound = true;
      no.addEventListener('click', function () { closeSleepModal(); });
    }
  }

  function sleepingNow(data) {
    if (!data) return false;
    var ev = currentEvent(data);
    if (!ev || !isSleepEvent(ev) || !isLateNight()) return false;
    return !readWake(cache.charId || getCharId());
  }

  function guardSend(proceed) {
    var fn = typeof proceed === 'function' ? proceed : function () {};
    refreshContext().then(function () {
      if (!sleepingNow(cache.data)) { fn(); return; }
      showSleepModal(fn, cache.data);
    }).catch(function () { fn(); });
    return true;
  }

  function stripTags(text) {
    return String(text || '').replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
  }

  function applyMarkers(text, opts) {
    opts = opts || {};
    var src = String(text || '');
    var re = /\[schedule:(cancel|move|add)\|([^\]]+)\]/ig;
    var found = [];
    var m;
    while ((m = re.exec(src)) !== null) found.push({ full: m[0], act: String(m[1]).toLowerCase(), args: m[2] });
    if (!found.length) return Promise.resolve(src);
    var cleaned = src.replace(re, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    cleaned = stripTags(cleaned);

    var id = String(opts.charId || getCharId() || '');
    var name = String(opts.charName || getCharName() || '');
    return readStore().then(function (store) {
      var data = findData(store, id, name);
      if (!data) return cleaned;
      if (!Array.isArray(data.events)) data.events = [];
      var byId = {};
      data.events.forEach(function (e) { if (e && e.id) byId[String(e.id)] = e; });
      var changed = false;
      found.forEach(function (it) {
        var parts = it.args.split('|').map(function (s) { return String(s || '').trim(); });
        if (it.act === 'cancel') {
          var ev = byId[String(parts[0])];
          if (ev && ev.status !== 'cancelled') {
            ev.status = 'cancelled';
            ev.reason = parts[1] || '聊天里改变了计划';
            ev.chatEditedAt = Date.now();
            ev.log = ev.log || [];
            ev.log.push({ t: nowText().slice(11), m: '聊天后划掉：' + ev.reason });
            changed = true;
          }
        } else if (it.act === 'move') {
          var mv = byId[String(parts[0])];
          var st = /^\d{1,2}:\d{2}$/.test(parts[1] || '') ? parts[1] : '';
          var en = /^\d{1,2}:\d{2}$/.test(parts[2] || '') ? parts[2] : '';
          if (mv && st && en && toMin(en) > toMin(st)) {
            if (!mv.movedFrom) mv.movedFrom = mv.start;
            mv.start = st.length === 4 ? '0' + st : st;
            mv.end = en.length === 4 ? '0' + en : en;
            mv.chatEditedAt = Date.now();
            mv.log = mv.log || [];
            mv.log.push({ t: nowText().slice(11), m: '聊天后改期：' + mv.start + '-' + mv.end + (parts[3] ? '（' + parts[3] + '）' : '') });
            changed = true;
          }
        } else if (it.act === 'add') {
          var date = /^\d{4}-\d{2}-\d{2}$/.test(parts[0] || '') ? parts[0] : today();
          var as = /^\d{1,2}:\d{2}$/.test(parts[1] || '') ? parts[1] : '';
          var ae = /^\d{1,2}:\d{2}$/.test(parts[2] || '') ? parts[2] : '';
          var title = parts[3] || '';
          if (as && ae && title && toMin(ae) > toMin(as)) {
            data.events.push({
              id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
              date: date, start: as.length === 4 ? '0' + as : as, end: ae.length === 4 ? '0' + ae : ae,
              title: title, place: parts[4] || '', who: '', note: parts[5] || '',
              mood: '', tag: 'life', status: 'todo', log: [{ t: nowText().slice(11), m: '聊天后新增安排' }],
              chatEditedAt: Date.now()
            });
            changed = true;
          }
        }
      });
      if (!changed) return cleaned;
      store.lastCharId = store.lastCharId || id;
      return writeStore(store).then(function () {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'nanoScheduleUpdated', source: 'chat', charId: id }, '*');
          }
        } catch (e) {}
        return cleaned;
      });
    }).catch(function () { return cleaned; });
  }

  function readApiConfig() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_api_db');
        req.onupgradeneeded = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
          } catch (err) {}
        };
        req.onsuccess = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('api_data')) { resolve(null); return; }
            var r = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
            r.onsuccess = function () {
              var rec = r.result;
              var v = rec ? (rec.value && typeof rec.value === 'object' ? rec.value : rec) : null;
              if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
              resolve(v);
            };
            r.onerror = function () { resolve(null); };
          } catch (err) { resolve(null); }
        };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    }).then(function (cfg) {
      if (!cfg) {
        try { cfg = JSON.parse(localStorage.getItem('nano_api_config') || 'null'); } catch (e) { cfg = null; }
      }
      if (cfg && cfg.value && typeof cfg.value === 'object' && !cfg.mainUrl) cfg = cfg.value;
      return cfg;
    });
  }

  function epImg(u, suf) {
    u = String(u || '').trim().replace(/\/+$/, '');
    return u.endsWith(suf) ? u : u + suf;
  }

  function buildImagePrompt(data, ev) {
    var st = (data && data.settings) || {};
    var persona = String(st.persona || '').replace(/\s+/g, ' ').slice(0, 260);
    return (st.style || '自然光生活随拍，真实照片质感') + '。主角：' + (st.name || '角色') +
      (persona ? '（' + persona + '）' : '') + '。场景：' + (ev.place || '室内') + '，' + (ev.title || '日常') +
      (ev.who ? '，与' + ev.who + '在一起' : '') + '。' + String(ev.note || '').slice(0, 120) +
      '。时间约 ' + (ev.start || '') + '。';
  }

  function hashStr(s) {
    var h = 1779033703 ^ String(s).length;
    for (var i = 0; i < String(s).length; i++) {
      h = Math.imul(h ^ String(s).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function artSvg(seed) {
    var r = rng(hashStr(seed)), W = 640, H = 400;
    function g(l) { return 'hsl(0,0%,' + l.toFixed(1) + '%)'; }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + g(93 + r() * 5) + '"/><stop offset="1" stop-color="' + g(68 + r() * 16) + '"/></linearGradient></defs><rect width="' + W + '" height="' + H + '" fill="url(#g)"/>';
    s += '<circle cx="' + (120 + r() * 400).toFixed(0) + '" cy="' + (60 + r() * 110).toFixed(0) + '" r="' + (26 + r() * 42).toFixed(0) + '" fill="' + (r() < .5 ? '#111' : '#fff') + '" opacity=".92"/>';
    for (var i = 0; i < 4; i++) {
      var y = 185 + i * 48 + r() * 22, d = 'M0 ' + H + ' L0 ' + y.toFixed(0);
      for (var x = 80; x <= W + 80; x += 80) d += ' Q' + (x - 40) + ' ' + (y + (r() - .5) * 74).toFixed(0) + ' ' + x + ' ' + (y + (r() - .5) * 30).toFixed(0);
      s += '<path d="' + d + ' L' + W + ' ' + H + 'Z" fill="' + g(60 - i * 15) + '" opacity=".93"/>';
    }
    for (var k = 0; k < 5; k++) {
      var x2 = r() * W;
      s += '<line x1="' + x2.toFixed(0) + '" y1="0" x2="' + x2.toFixed(0) + '" y2="' + H + '" stroke="#000" stroke-opacity=".05"/>';
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s + '</svg>');
  }

  function finishReport(id, name, eventId, src, kind, prompt) {
    return readStore().then(function (fresh) {
      var data = findData(fresh, id, name);
      if (!data) return false;
      var target = null;
      (data.events || []).forEach(function (x) { if (x && String(x.id) === String(eventId)) target = x; });
      if (!target) return false;
      target.img = { src: src, kind: kind, prompt: prompt };
      target.report = { at: Date.now(), note: String(target.mood || target.note || '').trim().slice(0, 80), delivered: false };
      target.imgTriedAt = Date.now();
      fresh.imgGenDay = today();
      fresh.imgGenAt = Date.now();
      fresh.lastCharId = fresh.lastCharId || id;
      return writeStore(fresh).then(function () {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'nanoScheduleUpdated', source: 'chat', charId: id }, '*');
          }
        } catch (e) {}
        return true;
      });
    });
  }

  function imgDayKey(id) { return 'nano_schedule_img_day_' + (id || 'default'); }
  function imgClaimKey(id) { return 'nano_schedule_img_claim_' + (id || 'default'); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var IMG_JOB_KEY = 'nano_schedule_img_job_v1';

  function readImgJob() {
    try { var raw = localStorage.getItem(IMG_JOB_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeImgJob(job) {
    try { localStorage.setItem(IMG_JOB_KEY, JSON.stringify(job)); } catch (e) {}
  }
  function clearImgJob(token) {
    try {
      var j = readImgJob();
      if (!token || !j || j.token === token) {
        localStorage.removeItem(IMG_JOB_KEY);
        if (j && j.resultKey) localStorage.removeItem(j.resultKey);
      }
    } catch (e) {}
  }
  function waitParent(token, resultKey, timeout) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function onMsg(ev) {
        if (!ev || !ev.data || ev.data.type !== 'chatApiDone' || ev.data.token !== token) return;
        finish(true);
      }
      function finish(fromMsg) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        setTimeout(function () {
          try {
            var raw = localStorage.getItem(resultKey);
            if (!raw) throw new Error('后台没有返回结果');
            localStorage.removeItem(resultKey);
            resolve(JSON.parse(raw));
          } catch (e) { reject(e); }
        }, fromMsg ? 40 : 0);
      }
      window.addEventListener('message', onMsg);
      setTimeout(function () {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        var e = new Error('图片仍在后台生成');
        e.background = true;
        reject(e);
      }, timeout || 120000);
    });
  }
  function requestParent(url, headers, body, token, resultKey) {
    try {
      if (!window.parent || window.parent === window) return Promise.reject(new Error('no parent'));
      window.parent.postMessage({ type: 'chatApiFetch', token: token, resultKey: resultKey, url: url, method: 'POST', headers: headers, body: body }, '*');
      return waitParent(token, resultKey, 120000);
    } catch (e) { return Promise.reject(e); }
  }

  function watchImgJob(job) {
    if (!job || !job.resultKey) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (tries > 120) { clearInterval(timer); return; }
      var raw = '';
      try { raw = localStorage.getItem(job.resultKey) || ''; } catch (e) {}
      if (!raw) return;
      clearInterval(timer);
      try { localStorage.removeItem(job.resultKey); } catch (e) {}
      try {
        var r = JSON.parse(raw);
        if (!r.ok) throw new Error(r.error || r.text || ('HTTP ' + (r.status || '')));
        var j = JSON.parse(String(r.text || '{}'));
        var item = j && j.data && j.data[0];
        var src = item && (item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : ''));
        if (!src) throw new Error('生图接口没有返回图片地址');
        finishReport(job.charId, job.charName, job.eventId, src, 'api', job.prompt).then(function () {
          clearImgJob(job.token);
        });
      } catch (e) {
        clearImgJob(job.token);
        try {
          if (typeof window.showAlert === 'function') {
            window.showAlert('日程生图失败', ((e && e.message) || '后台生图失败') + '\n今天不会再次自动调用，避免浪费额度。');
          }
        } catch (err) {}
      }
    }, 5000);
  }

  function generateDueReport(opts) {
    opts = opts || {};
    var id = String(opts.charId || getCharId() || '');
    var name = String(opts.charName || getCharName() || '');
    return readStore().then(function (store) {
      var data = findData(store, id, name);
      if (!data || !Array.isArray(data.events)) return { ok: true, skipped: true };
      if (data.photoReport === false) return { ok: true, skipped: true };
      var d = today();
      var localLock = '';
      try { localLock = localStorage.getItem(imgDayKey(id)) || ''; } catch (e) {}
      if (localLock === d || data.imgGenDay === d) return { ok: true, skipped: true };
      var nm = nowMin();
      var due = data.events.filter(function (e) {
        return e && e.status === 'todo' && e.date === d && !e.img && !isSleepEvent(e) &&
          (!e.imgTriedAt || Date.now() - e.imgTriedAt > 30 * 60 * 1000) &&
          toMin(e.start) <= nm && nm <= toMin(e.end) + 120;
      });
      if (!due.length) return { ok: true, skipped: true };
      due.sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
      var ev = due[0];
      var prompt = buildImagePrompt(data, ev);
      return readApiConfig().then(function (cfg) {
        if (!cfg || !cfg.imgUrl) {
          return { ok: false, error: '还没有配置生图 API，请到「API → 生图」填写地址、Key 和模型' };
        }
        // 跨页面抢锁：私聊和日程页同时触发时，只允许一个真正调用生图接口
        var claimToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        try { localStorage.setItem(imgClaimKey(id), JSON.stringify({ day: d, token: claimToken })); } catch (e) {}
        return delay(140).then(function () {
          var claim = null;
          try { claim = JSON.parse(localStorage.getItem(imgClaimKey(id)) || 'null'); } catch (e) {}
          if (!claim || claim.token !== claimToken) return { ok: true, skipped: true };
          // 抢到锁后占住当天的生图额度：无论成功失败，今天都不再调用第二次
          data.imgGenDay = d;
          data.imgGenAt = Date.now();
          ev.imgTriedAt = Date.now();
          try { localStorage.setItem(imgDayKey(id), d); } catch (e) {}
          var url = epImg(cfg.imgUrl, '/images/generations');
          var headers = { 'Content-Type': 'application/json' };
          if (cfg.imgKey) headers.Authorization = 'Bearer ' + cfg.imgKey;
          var body = JSON.stringify({ model: cfg.imgModel || undefined, prompt: prompt, n: 1, size: '1024x1024' });
          return writeStore(store).then(function () {
          var token = 'schedimg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          var resultKey = 'sched_img_result_' + token;
          var job = { token: token, resultKey: resultKey, charId: id, charName: name, eventId: ev.id, prompt: prompt, startedAt: Date.now() };
          writeImgJob(job);
          var req;
          if (window.parent && window.parent !== window) {
            req = requestParent(url, headers, body, token, resultKey).then(function (r) {
              if (!r.ok) throw new Error(r.error || r.text || ('HTTP ' + (r.status || '')));
              return String(r.text || '');
            });
          } else {
            req = fetch(url, { method: 'POST', headers: headers, body: body }).then(function (res) {
              if (!res.ok) throw new Error('生图接口返回 HTTP ' + res.status);
              return res.text();
            });
          }
          return req.then(function (raw) {
            var j = JSON.parse(String(raw || '{}'));
            var item = j && j.data && j.data[0];
            var src = item && (item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : ''));
            if (!src) throw new Error('生图接口没有返回图片地址');
            return finishReport(id, name, ev.id, src, 'api', prompt).then(function (r) {
              clearImgJob(token);
              return r ? { ok: true } : { ok: false, error: '图片已生成，但写入日程失败' };
            });
          }, function (e) {
            if (e && e.background) watchImgJob(job);
            else clearImgJob(token);
            throw e;
          });
        });
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || '生图失败', background: !!(e && e.background) };
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || '读取日程失败' };
    });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || '读取日程失败' };
    });
  }

  function takeReports(opts) {
    opts = opts || {};
    var id = String(opts.charId || getCharId() || '');
    var name = String(opts.charName || getCharName() || '');
    return readStore().then(function (store) {
      var data = findData(store, id, name);
      if (!data || !Array.isArray(data.events)) return [];
      if (data.photoReport === false) return [];
      var out = [];
      var cutoff = Date.now() - 24 * 3600 * 1000;
      var changed = false;
      data.events.forEach(function (e) {
        if (!e || !e.img || !e.report || e.report.delivered) return;
        var at = Number(e.report.at || 0);
        if (at && at < cutoff) { e.report.delivered = true; changed = true; return; }
        e.report.delivered = true;
        changed = true;
        out.push({
          charId: id,
          charName: (data.settings && data.settings.name) || name,
          eventId: e.id,
          title: e.title || '日程记录',
          place: e.place || '',
          date: e.date || today(),
          start: e.start || '',
          end: e.end || '',
          note: e.report.note || e.mood || e.note || '',
          img: e.img.src || '',
          at: at || Date.now()
        });
      });
      out.sort(function (a, b) { return a.at - b.at; });
      out = out.slice(-5);
      if (!changed || !out.length) return out;
      return writeStore(store).then(function () { return out; });
    }).catch(function () { return []; });
  }

  window.NanoScheduleBridge = {
    refreshContext: refreshContext,
    promptBlockSync: promptBlockSync,
    guardSend: guardSend,
    generateDueReport: generateDueReport,
    takeReports: takeReports,
    applyMarkers: applyMarkers,
    currentEvent: function () { return currentEvent(cache.data); },
    isSleeping: function () { return sleepingNow(cache.data); },
    markWoken: function () {
      var ev = currentEvent(cache.data);
      markWoken(cache.charId || getCharId(), ev ? ev.id : '');
      return refreshContext();
    },
    getData: function () { return cache.data; }
  };
})();
