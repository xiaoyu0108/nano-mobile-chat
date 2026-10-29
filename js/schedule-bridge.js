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
    nationality: '',
    tz: '',
    wallNow: null,
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
  // 没有日程、但开了时间感知的角色：23:00~07:00 视为大概率在睡觉。
  function isNightSleepWindow(d) {
    var h = (d instanceof Date ? d : new Date()).getHours();
    return h >= 23 || h < 7;
  }

  function wakeKey(id) { return 'nano_schedule_wake_' + (id || 'default'); }

  // 同一个 key 记录「叫醒」或「没叫醒」：老数据没有 status 字段，按“叫醒”兼容。
  function readSleepChoice(id, dayKey) {
    try {
      var o = JSON.parse(localStorage.getItem(wakeKey(id)) || 'null');
      if (!o) return null;
      // 跨午夜也要记得：23:50 选择“让他睡”，00:20 再聊时仍然知道。
      var recent = o.at && (Date.now() - Number(o.at) < 12 * 3600 * 1000);
      if (o.date !== (dayKey || today()) && !recent) return null;
      if (!o.status) o.status = 'woken';
      return o;
    } catch (e) { return null; }
  }

  function markWoken(id, eventId) {
    try {
      localStorage.setItem(wakeKey(id), JSON.stringify({
        date: dstr(wallNowFor(cache.nationality)), at: Date.now(), eventId: eventId || '', status: 'woken'
      }));
    } catch (e) {}
  }

  function markSkipped(id, eventId) {
    try {
      localStorage.setItem(wakeKey(id), JSON.stringify({
        date: dstr(wallNowFor(cache.nationality)), at: Date.now(), eventId: eventId || '', status: 'skipped'
      }));
    } catch (e) {}
  }

  function timeAwareFor(id) {
    try {
      var raw = localStorage.getItem('chat_setting_timeAware_' + (id || ''));
      if (raw === null || raw === undefined || raw === '') return true;
      try { return JSON.parse(raw) !== false; } catch (e) { return raw !== 'false'; }
    } catch (e) { return true; }
  }
  function wallNowFor(nationality) {
    try {
      if (window.NanoHoliday && window.NanoHoliday.wallClock) {
        var tz = window.NanoHoliday.tzForNationality(nationality || '');
        return window.NanoHoliday.wallClock(new Date(), tz);
      }
    } catch (e) {}
    return new Date();
  }
  function wallMin(d) { return d.getHours() * 60 + d.getMinutes(); }

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

  function buildBlock(data, id, name, wallNow, opts) {
    if (!data) return '';
    opts = opts || {};
    // wallNow：角色所在地的「墙上时间」（外国角色不能按设备时区判断作息）
    var wn = (wallNow instanceof Date) ? wallNow : new Date();
    var d = dstr(wn);
    var todayEvents = eventsOf(data, d);
    var tm = new Date(wn.getTime() + 86400000);
    var tomorrow = dstr(tm);
    var tomorrowEvents = eventsOf(data, tomorrow);
    var cur = currentEvent(data, d, wn.getHours() * 60 + wn.getMinutes());
    var choice = readSleepChoice(id, d);
    var timeAware = (typeof opts.timeAware === 'boolean') ? opts.timeAware : timeAwareFor(id);
    // 有睡眠日程时按日程；没有日程时，开了时间感知的角色在 23:00~07:00 默认在睡觉。
    var asleep = !!(cur && isSleepEvent(cur) && isLateNight(wn)) ||
      (!cur && timeAware && isNightSleepWindow(wn));
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
    var choiceFresh = !!(choice && (Date.now() - (choice.at || 0) < 4 * 3600 * 1000));
    var wokeEvent = null;
    for (var i = 0; i < todayEvents.length; i++) {
      if (choice && String(todayEvents[i].id) === String(choice.eventId)) { wokeEvent = todayEvents[i]; break; }
    }
    if (choiceFresh && choice.status !== 'skipped') {
      lines.push('【你刚被用户叫醒】你本来在' + (wokeEvent ? ('「' + (wokeEvent.title || '睡觉') + '」') : '睡觉') +
        '，是用户把你叫醒的。你知道是 TA 叫醒的你，可以自然表现出困倦、被打断、或者被吵醒后的真实反应，不要装作没发生过。');
    } else {
      if (asleep) {
        lines.push('【你正在睡觉】现在是 ' + nowText(wn) + '（你的当地时间），你正在睡觉。若被消息吵到，你会是半睡半醒的状态；不要主动说自己被叫醒，除非用户确实叫了你。');
      }
      if (choiceFresh && choice.status === 'skipped') {
        lines.push('【用户没有叫醒你】刚才用户看到你正在睡觉，选择了「让他睡」，没有把你叫醒。你知道这件事：你后来一直没被吵醒。现在如果 TA 来找你，你心里清楚 TA 之前没有叫醒你，可以自然带出“你昨晚没叫我”这类反应，但不要每轮都提，也不要质问。');
      }
    }
    try {
      if (data.settings && data.settings.charId) {
        lines.push('你的角色名：' + (data.settings.name || name || '') + '。');
      }
    } catch (e) {}
    lines.push('');
    lines.push('【日程变动标记（必须遵守）】如果这轮聊天真的改变了你的计划（取消、改期、临时新增安排），在回复最后单独一行输出下面其中一个标记；标记不会显示给用户。系统会先生成一张「日程修改卡片」，等用户点允许后才真正改日程，所以不要自己在正文里宣布已经改好。只有确实改变、且用户也同意时才输出，不要为了输出而改变计划；如果你已经口头答应改日程，就必须同步输出对应标记，否则就等于没有改。');
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
      cache.nationality = String(opts.nationality || '');
      cache.tz = '';
      try { if (window.NanoHoliday && window.NanoHoliday.tzForNationality) cache.tz = window.NanoHoliday.tzForNationality(cache.nationality) || ''; } catch (e) {}
      cache.wallNow = wallNowFor(cache.nationality);
      cache.data = data;
      // 过期的待办按「角色当地时间」划掉，不能用设备时区。
      if (autoClosePast(data, cache.wallNow)) { try { writeStore(store); } catch (e) {} }
      var ta = (typeof opts.timeAware === 'boolean') ? opts.timeAware : timeAwareFor(cache.charId);
      if (data) {
        cache.block = buildBlock(data, cache.charId, name, cache.wallNow, { timeAware: ta });
      } else {
        // 没排日程，但仍要保留「睡眠 / 用户没叫醒我」这两件事。
        var parts = [];
        if (ta && isNightSleepWindow(cache.wallNow)) {
          parts.push('【当前状态 · 睡眠】现在是 ' + nowText(cache.wallNow) + '（你的当地时间），你正在睡觉。' +
            '若被消息吵到，你会是半睡半醒的状态；不要主动说自己被叫醒，除非用户确实叫了你。');
        }
        var noScheduleChoice = readSleepChoice(cache.charId, dstr(cache.wallNow));
        if (noScheduleChoice && noScheduleChoice.status === 'skipped' &&
            (Date.now() - (noScheduleChoice.at || 0) < 4 * 3600 * 1000)) {
          parts.push('【用户没有叫醒你】刚才用户看到你正在睡觉，选择了「让他睡」，没有把你叫醒。你知道这件事；现在 TA 来找你时，你心里清楚 TA 之前没有叫醒你，可以自然带出这类反应，但不要每轮都提，也不要质问。');
        }
        cache.block = parts.length ? (parts.join('\n') + '\n') : '';
      }
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

  function wallEvent(data) {
    var w = cache.wallNow || wallNowFor(cache.nationality);
    return currentEvent(data, dstr(w), wallMin(w));
  }

  function refreshCached() {
    return refreshContext({
      charId: cache.charId || getCharId(),
      charName: cache.charName,
      nationality: cache.nationality
    });
  }

  function showSleepModal(proceed, data) {
    var el = ensureModal();
    var body = document.getElementById('nanoScheduleSleepBody');
    var name = (data && data.settings && data.settings.name) || cache.charName || 'TA';
    var ev = wallEvent(data);
    if (body) {
      body.textContent = (ev && ev.title)
        ? (name + ' 正在「' + ev.title + '」，确认要叫醒 TA 吗？')
        : (name + ' 现在可能已经睡了，确认要叫醒 TA 吗？');
    }
    pendingProceed = proceed || null;
    el.style.display = 'flex';
    var yes = document.getElementById('nanoScheduleSleepYes');
    var no = document.getElementById('nanoScheduleSleepNo');
    if (yes && !yes.__nanoBound) {
      yes.__nanoBound = true;
      yes.addEventListener('click', function () {
        var fn = pendingProceed;
        var e = wallEvent(cache.data);
        markWoken(cache.charId || getCharId(), e ? e.id : '');
        closeSleepModal();
        refreshCached().then(function () {
          if (fn) { try { fn(); } catch (err) {} }
        });
      });
    }
    if (no && !no.__nanoBound) {
      no.__nanoBound = true;
      no.addEventListener('click', function () {
        var e = wallEvent(cache.data);
        // 记下“用户选择不叫醒”：之后角色聊天时知道自己没被叫醒，也不会反复弹窗。
        markSkipped(cache.charId || getCharId(), e ? e.id : '');
        closeSleepModal();
        refreshCached();
      });
    }
  }

  function sleepingNow(data, opts) {
    opts = opts || {};
    var id = cache.charId || getCharId();
    var w = cache.wallNow || wallNowFor(cache.nationality);
    var day = dstr(w);
    var choice = readSleepChoice(id, day);
    if (choice && (Date.now() - (choice.at || 0) < 8 * 3600 * 1000)) {
      // 叫醒或明确选择不叫醒后，本次夜里不再重复弹窗。
      return false;
    }
    var ev = currentEvent(data, day, wallMin(w));
    // 有睡眠日程：按日程；没有日程但开了时间感知：深夜默认在睡。
    if (ev) return isSleepEvent(ev) && isLateNight(w);
    var ta = (typeof opts.timeAware === 'boolean') ? opts.timeAware : timeAwareFor(id);
    return !!(ta && isNightSleepWindow(w));
  }

  function guardSend(proceed, opts) {
    var fn = typeof proceed === 'function' ? proceed : function () {};
    opts = opts || {};
    refreshContext(opts).then(function () {
      if (!sleepingNow(cache.data, opts)) { fn(); return; }
      showSleepModal(fn, cache.data);
    }).catch(function () { fn(); });
    return true;
  }

  function stripTags(text) {
    return String(text || '').replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
  }

  // 过期的待办自动划掉：只改本地状态，不调用任何 API。
  // 今天刚结束的留 2 小时给到点报备；超过 2 小时或日期已过就自动完成。
  function autoClosePast(data, wallNow) {
    if (!data || !Array.isArray(data.events)) return false;
    var now = (wallNow instanceof Date) ? wallNow : new Date();
    var d = dstr(now);
    var nm = now.getHours() * 60 + now.getMinutes();
    var changed = false;
    data.events.forEach(function (e) {
      if (!e || e.status !== 'todo' || !e.date) return;
      var pastDate = String(e.date) < d;
      var pastToday = String(e.date) === d && toMin(e.end) + 120 < nm;
      if (pastDate || pastToday) {
        e.status = 'done';
        e.autoClosed = true;
        e.autoClosedAt = Date.now();
        e.log = e.log || [];
        if (e.log.length < 30) e.log.push({ t: nowText(now).slice(11), m: '时间已过，自动划掉' });
        changed = true;
      }
    });
    return changed;
  }

  function applyChanges(changes, opts) {
    opts = opts || {};
    changes = Array.isArray(changes) ? changes : [];
    if (!changes.length) return Promise.resolve(0);
    var id = String(opts.charId || getCharId() || '');
    var name = String(opts.charName || getCharName() || '');
    return readStore().then(function (store) {
      var data = findData(store, id, name);
      if (!data) {
        if (!id) return 0;
        if (!store.chars) store.chars = {};
        data = { settings: { charId: id, name: name || 'char' }, events: [], gen: {} };
        store.chars[id] = data;
      }
      if (!Array.isArray(data.events)) data.events = [];
      var byId = {};
      data.events.forEach(function (e) { if (e && e.id) byId[String(e.id)] = e; });
      var n = 0;
      changes.forEach(function (it) {
        if (!it) return;
        if (it.kind === 'cancel') {
          var ev = byId[String(it.eventId)];
          if (ev && ev.status !== 'cancelled') {
            ev.status = 'cancelled';
            ev.reason = it.reason || '聊天里改变了计划';
            ev.chatEditedAt = Date.now();
            ev.log = ev.log || [];
            ev.log.push({ t: nowText().slice(11), m: '聊天后划掉：' + ev.reason });
            n++;
          }
        } else if (it.kind === 'move') {
          var mv = byId[String(it.eventId)];
          var st = /^\d{1,2}:\d{2}$/.test(it.start || '') ? it.start : '';
          var en = /^\d{1,2}:\d{2}$/.test(it.end || '') ? it.end : '';
          if (mv && st && en && toMin(en) > toMin(st)) {
            if (!mv.movedFrom) mv.movedFrom = mv.start;
            mv.start = st.length === 4 ? '0' + st : st;
            mv.end = en.length === 4 ? '0' + en : en;
            mv.chatEditedAt = Date.now();
            mv.log = mv.log || [];
            mv.log.push({ t: nowText().slice(11), m: '聊天后改期：' + mv.start + '-' + mv.end + (it.reason ? '（' + it.reason + '）' : '') });
            n++;
          }
        } else if (it.kind === 'add') {
          var date = /^\d{4}-\d{2}-\d{2}$/.test(it.date || '') ? it.date : today();
          var as = /^\d{1,2}:\d{2}$/.test(it.start || '') ? it.start : '';
          var ae = /^\d{1,2}:\d{2}$/.test(it.end || '') ? it.end : '';
          var title = it.title || '';
          if (as && ae && title && toMin(ae) > toMin(as)) {
            data.events.push({
              id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
              date: date, start: as.length === 4 ? '0' + as : as, end: ae.length === 4 ? '0' + ae : ae,
              title: title, place: it.place || '', who: '', note: it.note || '',
              mood: '', tag: 'life', status: 'todo', log: [{ t: nowText().slice(11), m: '聊天后新增安排' }],
              chatEditedAt: Date.now()
            });
            n++;
          }
        }
      });
      if (!n) return 0;
      store.lastCharId = store.lastCharId || id;
      return writeStore(store).then(function () {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'nanoScheduleUpdated', source: 'chat', charId: id }, '*');
          }
        } catch (e) {}
        return n;
      });
    }).catch(function () { return 0; });
  }

  // 只解析、不落库：私聊里先生成「日程修改卡片」，用户点允许后再 applyChanges。
  function parseMarkers(text, opts) {
    opts = opts || {};
    var src = String(text || '');
    var re = /\[schedule:(cancel|move|add)\|([^\]]+)\]/ig;
    var raw = [];
    var m;
    while ((m = re.exec(src)) !== null) raw.push({ act: String(m[1]).toLowerCase(), args: m[2] });
    var cleaned = stripTags(src.replace(re, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'));
    if (!raw.length) return Promise.resolve({ text: cleaned, changes: [] });
    var id = String(opts.charId || getCharId() || '');
    var name = String(opts.charName || getCharName() || '');
    return readStore().then(function (store) {
      var data = findData(store, id, name);
      var byId = {};
      (data && Array.isArray(data.events) ? data.events : []).forEach(function (e) { if (e && e.id) byId[String(e.id)] = e; });
      var changes = raw.map(function (it) {
        var parts = it.args.split('|').map(function (s) { return String(s || '').trim(); });
        if (it.act === 'cancel') {
          var ev = byId[String(parts[0])];
          if (!ev) return null;
          return { kind: 'cancel', eventId: String(ev.id), title: ev.title || '安排', oldDate: ev.date, oldStart: ev.start, oldEnd: ev.end, reason: parts[1] || '' };
        }
        if (it.act === 'move') {
          var mv = byId[String(parts[0])];
          if (!mv) return null;
          return { kind: 'move', eventId: String(mv.id), title: mv.title || '安排', oldDate: mv.date, oldStart: mv.start, oldEnd: mv.end, start: parts[1] || '', end: parts[2] || '', reason: parts[3] || '' };
        }
        return { kind: 'add', date: /^\d{4}-\d{2}-\d{2}$/.test(parts[0] || '') ? parts[0] : today(), start: parts[1] || '', end: parts[2] || '', title: parts[3] || '新安排', place: parts[4] || '', note: parts[5] || '' };
      }).filter(Boolean);
      return { text: cleaned, changes: changes };
    }).catch(function () { return { text: cleaned, changes: [] }; });
  }

  // 兼容旧调用：没有确认卡片时仍然直接应用。
  function applyMarkers(text, opts) {
    return parseMarkers(text, opts).then(function (p) {
      return applyChanges(p.changes, opts).then(function () { return p.text; });
    });
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
  function imageEndpoint(u, kind) {
    u = String(u || '').trim().replace(/\/+$/, '');
    u = u.replace(/\/images\/(generations|edits)$/i, '');
    return u + (kind === 'edit' ? '/images/edits' : '/images/generations');
  }
  function editUrl(u) { return imageEndpoint(u, 'edit'); }
  function dataUrlToBlob(u) {
    var comma = String(u).indexOf(',');
    var mime = (String(u).slice(5, comma).split(';')[0]) || 'image/png';
    var bin = atob(String(u).slice(comma + 1));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function faceRefFor(id) {
    try {
      if (window.NanoFaceRef && NanoFaceRef.get) return Promise.resolve(NanoFaceRef.get(id)).catch(function () { return ''; });
    } catch (e) {}
    try {
      var raw = localStorage.getItem('chat_setting_faceRef_' + (id || ''));
      if (raw) { try { return Promise.resolve(String(JSON.parse(raw) || '')); } catch (e) { return Promise.resolve(String(raw)); } }
    } catch (e) {}
    return Promise.resolve('');
  }
  function faceNote() {
    return '【锁脸说明】提供的人物参考图只用于保持长相（五官、脸型、肤色、发色）一致；请完全忽略参考图的姿势、角度、表情、背景与构图，按当前场景重新构图。';
  }
  // 有锁脸参考先走 /images/edits（multipart），失败再退回带 reference 字段的普通生图。
  function requestImage(cfg, prompt, faceRef, relay) {
    var url = imageEndpoint(cfg.imgUrl, 'gen');
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.imgKey) headers.Authorization = 'Bearer ' + cfg.imgKey;
    var note = faceRef ? faceNote() : '';
    var fullPrompt = note ? (note + '\n' + prompt) : prompt;
    function viaEdits() {
      if (!faceRef || String(faceRef).indexOf('data:') !== 0) return Promise.reject(new Error('no data ref'));
      var fd = new FormData();
      fd.append('model', cfg.imgModel || '');
      fd.append('prompt', fullPrompt);
      fd.append('n', '1');
      fd.append('size', '1024x1024');
      fd.append('image', dataUrlToBlob(faceRef), 'face.png');
      return fetch(editUrl(cfg.imgUrl), {
        method: 'POST',
        headers: cfg.imgKey ? { Authorization: 'Bearer ' + cfg.imgKey } : {},
        body: fd
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
    }
    function viaJson() {
      var body = JSON.stringify(Object.assign({ model: cfg.imgModel || undefined, prompt: fullPrompt, n: 1, size: '1024x1024' },
        faceRef ? { image: faceRef, reference_image: [faceRef], input_reference_image: [faceRef] } : {}));
      return fetch(url, { method: 'POST', headers: headers, body: body }).then(function (r) {
        if (!r.ok) throw new Error('生图接口返回 HTTP ' + r.status);
        return r.text();
      }).catch(function (err) {
        // 某些页面受 CORS 限制：退回外壳代发，避免日程生图直接失败。
        if (typeof relay !== 'function') throw err;
        return relay(url, headers, body);
      });
    }
    return viaEdits().catch(function () { return viaJson(); });
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

  function persistScheduleImage(src, name, prompt) {
    var p = (src && window.NanoImageCache && /^https?:\/\//i.test(src))
      ? NanoImageCache.toDataUrl(src).catch(function () { return ''; })
      : Promise.resolve('');
    return p.then(function (local) {
      var u = local || src;
      try { if (window.NanoGallery && u) NanoGallery.add({ url: u, source: '日程', charName: name || '', prompt: prompt || '', generated: true }); } catch (e) {}
      return u;
    });
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
        persistScheduleImage(src, job.charName, job.prompt).then(function (local) {
          return finishReport(job.charId, job.charName, job.eventId, local, 'api', job.prompt);
        }).then(function () {
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
      return Promise.all([readApiConfig(), faceRefFor(id)]).then(function (pair) {
        var cfg = pair[0], faceRef = pair[1] || '';
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
          return writeStore(store).then(function () {
          var token = 'schedimg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          var resultKey = 'sched_img_result_' + token;
          var job = { token: token, resultKey: resultKey, charId: id, charName: name, eventId: ev.id, prompt: prompt, startedAt: Date.now() };
          writeImgJob(job);
          var relay = function (url2, headers2, body2) {
            if (!(window.parent && window.parent !== window)) return Promise.reject(new Error('没有可用的代发窗口'));
            return requestParent(url2, headers2, body2, token, resultKey).then(function (r) {
              if (!r.ok) throw new Error(r.error || r.text || ('HTTP ' + (r.status || '')));
              return String(r.text || '');
            });
          };
          var req = requestImage(cfg, prompt, faceRef, relay);
          return req.then(function (raw) {
            var j = JSON.parse(String(raw || '{}'));
            var item = j && j.data && j.data[0];
            var src = item && (item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : ''));
            if (!src) throw new Error('生图接口没有返回图片地址');
            return persistScheduleImage(src, name, prompt).then(function (local) {
              return finishReport(id, name, ev.id, local, 'api', prompt);
            }).then(function (r) {
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
    parseMarkers: parseMarkers,
    applyChanges: applyChanges,
    currentEvent: function () { return wallEvent(cache.data); },
    isSleeping: function () { return sleepingNow(cache.data); },
    markWoken: function () {
      var ev = wallEvent(cache.data);
      markWoken(cache.charId || getCharId(), ev ? ev.id : '');
      return refreshCached();
    },
    markSkipped: function () {
      var ev = wallEvent(cache.data);
      markSkipped(cache.charId || getCharId(), ev ? ev.id : '');
      return refreshCached();
    },
    getData: function () { return cache.data; }
  };
})();
