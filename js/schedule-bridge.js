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
    persona: '',
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
  // 只有开启「允许生图」的角色才能生成日程报备照片。
  function charAllowsImage(id) {
    try {
      var raw = localStorage.getItem('chat_setting_allowImage_' + String(id || ''));
      if (raw === null) return false;
      var v = raw;
      try { v = JSON.parse(raw); } catch (e) {}
      return v === true || v === 1 || v === 'true' || v === '1';
    } catch (e) { return false; }
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
    return /睡|就寝|晚安|入睡|睡眠|午睡|赖床|补觉|小睡/.test(s);
  }

  function isDaytime(d) {
    var h = (d instanceof Date ? d : new Date()).getHours();
    return h >= 7 && h < 19;
  }
  // 按人设推断作息：年轻夜猫子、作息规律的长辈/上班族，入睡和起床时间不同；
  // 同一个人每天也会有波动，不能每天固定一个点判定“已经睡了”。
  function personaText(data, opts) {
    var p = '';
    try { p = String((data && data.settings && (data.settings.persona || data.settings.setting || data.settings.desc)) || ''); } catch (e) {}
    if (!p && opts && opts.persona) p = String(opts.persona);
    if (!p && cache.persona) p = String(cache.persona);
    return p;
  }
  function personaAge(text) {
    var m = /(\d{2})\s*(?:岁|周岁)/.exec(String(text || ''));
    return m ? +m[1] : 0;
  }
  function sleepProfile(data, opts, dayKey) {
    var text = personaText(data, opts);
    var age = personaAge(text);
    var owlText = /(熬夜|夜猫|通宵|失眠|夜班|凌晨|深夜|夜生活|酒吧|夜店|主播|程序员|写手|作家|自由职业|电竞|打游戏)/.test(text);
    var regularText = /(早睡|作息规律|养生|退休|老年人|长辈|中年|教师|老师|医生|护士|军人|警察|朝九晚五|上班族)/.test(text);
    var owl = owlText || (!regularText && age >= 16 && age <= 28);
    var regular = regularText || (!owlText && age >= 45);
    if (owl && regular) { owl = false; regular = false; }
    var start, wake, span;
    if (owl) { start = 80; wake = 530; span = 80; }          // 夜猫子：约 01:20 睡，08:50 起
    else if (regular) { start = 1370; wake = 400; span = 35; } // 规律：约 22:50 睡，06:40 起
    else { start = 1420; wake = 450; span = 40; }             // 普通：约 23:40 睡，07:30 起
    var r = rng(hashStr(String((data && data.settings && data.settings.charId) || cache.charId || '') + '|' + (dayKey || today())));
    // 每天不一样：多数在小范围浮动；偶尔通宵或早睡，周末普遍晚一点。
    var weekend = false;
    try { var wd = new Date(String(dayKey || today()) + 'T12:00:00').getDay(); weekend = (wd === 0 || wd === 6); } catch (e) {}
    if (owl && r() < 0.22) { start = 240 + Math.round(r() * 100); wake = 720 + Math.round(r() * 100); }
    else if (owl && r() < 0.14) { start = 1380 + Math.round(r() * 40); wake = 430 + Math.round(r() * 50); }
    else if (regular && r() < 0.10) { start = 60 + Math.round(r() * 50); wake = 480 + Math.round(r() * 50); }
    else if (!owl && !regular && r() < 0.12) { start = 40 + Math.round(r() * 70); wake = 560 + Math.round(r() * 80); }
    else if (!owl && !regular && r() < 0.08) { start = 1330 + Math.round(r() * 40); wake = 390 + Math.round(r() * 40); }
    else {
      start += Math.round((r() * 2 - 1) * span);
      wake += Math.round((r() * 2 - 1) * span * 0.7);
    }
    if (weekend && !regular) {
      start += 35 + Math.round(r() * 45);
      wake += 35 + Math.round(r() * 45);
    }
    start = ((start % 1440) + 1440) % 1440;
    wake = ((wake % 1440) + 1440) % 1440;
    return { start: start, wake: wake, owl: owl, regular: regular };
  }
  function inSleepWindow(mins, profile) {
    var s = profile.start, w = profile.wake;
    if (s === w) return false;
    if (s < w) return mins >= s && mins < w;
    return mins >= s || mins < w;
  }
  function isBusyEvent(e) {
    if (!e) return false;
    var s = String(e.title || '') + ' ' + String(e.note || '') + ' ' + String(e.tag || '');
    if (/睡|就寝|晚安|入睡|睡眠|午睡|休息|吃饭|午饭|晚饭|早餐|下班|放学|收工|结束|通勤|路上|自由|空档|摸鱼/.test(s)) return false;
    return /(上班|上课|开会|会议|面试|考试|加班|值班|手术|拍摄|直播|训练|排练|出差|赶稿|工作|打工|营业|接待|讲座|培训|实验|庭审|执勤|出警|飞行|航班|课程|班)/.test(s);
  }
  function statusNow(data, opts, wall) {
    opts = opts || {};
    var w = (wall instanceof Date) ? wall : (cache.wallNow || wallNowFor(cache.nationality));
    var id = String(opts.charId || cache.charId || getCharId() || '');
    var day = dstr(w);
    var mins = wallMin(w);
    var timeAware = (typeof opts.timeAware === 'boolean') ? opts.timeAware : timeAwareFor(id);
    if (!timeAware) return { kind: '', timeAware: false };
    var ev = data ? currentEvent(data, day, mins) : null;
    var profile = sleepProfile(data, opts, day);
    if (ev && isSleepEvent(ev)) {
      // 夜猫子即使日程里写了“睡觉”，在 TA 通常入睡的时间之前也只是躺下，没真睡着。
      if (profile.owl && !isDaytime(w) && !inSleepWindow(mins, profile)) {
        return { kind: 'awake', event: ev, inBed: true, profile: profile, timeAware: true };
      }
      return { kind: 'sleep', event: ev, daytime: isDaytime(w), profile: profile, timeAware: true };
    }
    if (!ev && inSleepWindow(mins, profile)) return { kind: 'sleep', event: null, daytime: isDaytime(w), profile: profile, timeAware: true };
    if (ev && isBusyEvent(ev)) return { kind: 'busy', event: ev, profile: profile, timeAware: true };
    return { kind: '', event: ev, profile: profile, timeAware: true };
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

  function busyKey(id) { return 'nano_schedule_busy_' + (id || 'default'); }
  function readBusyChoice(id, dayKey) {
    try {
      var o = JSON.parse(localStorage.getItem(busyKey(id)) || 'null');
      if (!o) return null;
      var recent = o.at && (Date.now() - Number(o.at) < 12 * 3600 * 1000);
      if (o.date !== (dayKey || today()) && !recent) return null;
      return o;
    } catch (e) { return null; }
  }
  function markBusy(id, eventId, status) {
    try {
      localStorage.setItem(busyKey(id), JSON.stringify({
        date: dstr(wallNowFor(cache.nationality)), at: Date.now(), eventId: eventId || '', status: status || 'interrupted'
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
    // 有睡眠日程按日程；没有睡眠日程时按人设 + 当天波动推断作息，不能统一按 23:00 算。
    var st = statusNow(data, { charId: id, timeAware: timeAware, persona: opts.persona }, wn);
    var asleep = timeAware && st.kind === 'sleep';
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
    if (timeAware && st.kind === 'awake' && st.inBed) {
      lines.push('【你还没睡着】你已经躺下了，但按你的作息还没真正睡着。若被消息吵到，你会是清醒但有点困的状态；可以自然表现出“刚躺下还没睡”。');
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
        lines.push('【你正在睡觉】现在是 ' + nowText(wn) + '（你的当地时间），' + (st.daytime ? '你还在睡。' : '你正在睡觉。') +
          '若被消息吵到，你会是半睡半醒的状态；不要主动说自己被叫醒，除非用户确实叫了你。');
      }
      if (choiceFresh && choice.status === 'skipped') {
        lines.push('【用户没有叫醒你】刚才用户看到你正在睡觉，选择了「让他睡」，没有把你叫醒。你知道这件事：你后来一直没被吵醒。现在如果 TA 来找你，你心里清楚 TA 之前没有叫醒你，可以自然带出“你昨晚没叫我”这类反应，但不要每轮都提，也不要质问。');
      }
    }
    // 用户在你上班 / 上课 / 开会时来找你：记住 TA 是坚持找你，还是选择先不打扰。
    var busyChoice = readBusyChoice(id, d);
    if (timeAware && cur && isBusyEvent(cur)) {
      var sameEvent = !busyChoice || !busyChoice.eventId || String(busyChoice.eventId) === String(cur.id);
      var busyFresh = !!(busyChoice && sameEvent && (Date.now() - (busyChoice.at || 0) < 2 * 3600 * 1000));
      if (busyFresh && busyChoice.status === 'leftAlone') {
        lines.push('【用户让你先忙】你正在「' + (cur.title || '忙') + '」，用户看到你在忙，选择先不打扰你。你知道这件事：不要抱怨，也不要每轮都提；等你有空再自然回。');
      } else if (busyFresh && busyChoice.status === 'interrupted') {
        lines.push('【你正忙时被用户找了】你正在「' + (cur.title || '忙') + '」，用户还是来找你了。你可以简短回应、说明自己在忙，或按人设决定先停一下，但不要装作没事，也不要因此指责对方。');
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
      cache.persona = String(opts.persona || '');
      cache.tz = '';
      try { if (window.NanoHoliday && window.NanoHoliday.tzForNationality) cache.tz = window.NanoHoliday.tzForNationality(cache.nationality) || ''; } catch (e) {}
      cache.wallNow = wallNowFor(cache.nationality);
      cache.data = data;
      // 过期的待办按「角色当地时间」划掉，不能用设备时区。
      if (autoClosePast(data, cache.wallNow)) { try { writeStore(store); } catch (e) {} }
      var ta = (typeof opts.timeAware === 'boolean') ? opts.timeAware : timeAwareFor(cache.charId);
      if (data) {
        cache.block = buildBlock(data, cache.charId, name, cache.wallNow, { timeAware: ta, persona: cache.persona });
      } else {
        // 没排日程：按人设 + 当天波动推断作息，并保留「用户没叫醒我」这件事。
        var parts = [];
        var noScheduleStatus = statusNow(null, { charId: cache.charId, timeAware: ta, persona: cache.persona }, cache.wallNow);
        if (noScheduleStatus.kind === 'sleep') {
          parts.push('【当前状态 · 睡眠】现在是 ' + nowText(cache.wallNow) + '（你的当地时间），' + (noScheduleStatus.daytime ? '你还在睡。' : '你正在睡觉。') +
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
        '<div id="nanoScheduleModalTitle" style="font-size:17px;font-weight:700;color:#1c1c1e;">对方正在睡觉啦</div>' +
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
  var pendingKind = 'sleep';

  function closeSleepModal() {
    var el = document.getElementById('nanoScheduleSleepModal');
    if (el) el.style.display = 'none';
    pendingProceed = null;
    pendingKind = 'sleep';
  }

  function wallEvent(data) {
    var w = cache.wallNow || wallNowFor(cache.nationality);
    return currentEvent(data, dstr(w), wallMin(w));
  }

  function refreshCached() {
    return refreshContext({
      charId: cache.charId || getCharId(),
      charName: cache.charName,
      nationality: cache.nationality,
      persona: cache.persona
    });
  }

  function showScheduleModal(kind, proceed, data) {
    var el = ensureModal();
    var body = document.getElementById('nanoScheduleSleepBody');
    var title = document.getElementById('nanoScheduleModalTitle');
    var name = (data && data.settings && data.settings.name) || cache.charName || 'TA';
    var ev = wallEvent(data);
    var isBusy = kind === 'busy';
    var daytime = (function () {
      var w = cache.wallNow || wallNowFor(cache.nationality);
      var h = w.getHours();
      return h >= 7 && h < 19;
    })();
    if (title) title.textContent = isBusy ? '对方正在忙' : (daytime ? '对方还在睡' : '对方正在睡觉啦');
    if (body) {
      if (isBusy) {
        body.textContent = (ev && ev.title)
          ? (name + ' 正在「' + ev.title + '」，要现在找 TA 吗？')
          : (name + ' 现在可能正在忙，要现在找 TA 吗？');
      } else {
        body.textContent = (ev && ev.title && isSleepEvent(ev))
          ? (name + ' 正在「' + ev.title + '」，确认要叫醒 TA 吗？')
          : (name + (daytime ? ' 现在可能还在睡，' : ' 现在可能已经睡了，') + '确认要叫醒 TA 吗？');
      }
    }
    pendingKind = kind;
    pendingProceed = proceed || null;
    el.style.display = 'flex';
    var yes = document.getElementById('nanoScheduleSleepYes');
    var no = document.getElementById('nanoScheduleSleepNo');
    if (yes) yes.textContent = isBusy ? '坚持找他' : '叫醒他';
    if (no) no.textContent = isBusy ? '让他忙' : '让他睡';
    if (yes && !yes.__nanoBound) {
      yes.__nanoBound = true;
      yes.addEventListener('click', function () {
        var fn = pendingProceed;
        var kindNow = pendingKind;
        var e = wallEvent(cache.data);
        if (kindNow === 'busy') markBusy(cache.charId || getCharId(), e ? e.id : '', 'interrupted');
        else markWoken(cache.charId || getCharId(), e ? e.id : '');
        closeSleepModal();
        refreshCached().then(function () {
          if (fn) { try { fn(); } catch (err) {} }
        });
      });
    }
    if (no && !no.__nanoBound) {
      no.__nanoBound = true;
      no.addEventListener('click', function () {
        var kindNow = pendingKind;
        var e = wallEvent(cache.data);
        // 记下“用户选择不叫醒 / 先不打扰”：之后角色聊天时知道这件事，也不会反复弹窗。
        if (kindNow === 'busy') markBusy(cache.charId || getCharId(), e ? e.id : '', 'leftAlone');
        else markSkipped(cache.charId || getCharId(), e ? e.id : '');
        closeSleepModal();
        refreshCached();
      });
    }
  }

  function showSleepModal(proceed, data) { showScheduleModal('sleep', proceed, data); }

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
    return statusNow(data, opts, w).kind === 'sleep';
  }

  function busyNow(data, opts) {
    opts = opts || {};
    var id = cache.charId || getCharId();
    var w = cache.wallNow || wallNowFor(cache.nationality);
    var st = statusNow(data, opts, w);
    if (st.kind !== 'busy') return false;
    var choice = readBusyChoice(id, dstr(w));
    if (!choice) return true;
    if (Date.now() - (choice.at || 0) > 2 * 3600 * 1000) return true;
    // 同一个日程事件已经选择过“坚持找他 / 让他忙”，不要每发一条都弹。
    if (choice.eventId && st.event && String(choice.eventId) !== String(st.event.id)) return true;
    return false;
  }

  function guardSend(proceed, opts) {
    var fn = typeof proceed === 'function' ? proceed : function () {};
    opts = opts || {};
    refreshContext(opts).then(function () {
      // 只有「开启了时间感知 + 确实排了日程」的角色才弹作息 / 忙碌窗。
      if (!cache.data || !Array.isArray(cache.data.events) || !cache.data.events.length) { fn(); return; }
      var st = statusNow(cache.data, opts, cache.wallNow);
      if (st.kind === 'sleep' && sleepingNow(cache.data, opts)) {
        showScheduleModal('sleep', fn, cache.data);
        return;
      }
      if (st.kind === 'busy' && busyNow(cache.data, opts)) {
        showScheduleModal('busy', fn, cache.data);
        return;
      }
      fn();
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
    return '【锁脸 · 只锁五官】参考图只用于保持五官、脸型、肤色、发色与发型一致；请忽略参考图的姿势、角度、表情、服装、背景与构图，按当前场景重新构图。';
  }
  // 有锁脸参考先走 /images/edits（multipart），失败再退回带 reference 字段的普通生图。
  async function requestImage(cfg, prompt, lock, relay) {
    lock = lock || {};
    var faceRef = String(lock.faceRef || '');
    var faceRefs = (lock.refs && lock.refs.length) ? lock.refs.slice() : (faceRef ? [faceRef] : []);
    // 普通生图也读取 API 的正面 / 反面提示词，并参考日程本身的场景上下文。
    var aug = { prompt: prompt, negative: '' };
    try {
      if (window.NanoImagePrompt && NanoImagePrompt.augment) {
        aug = await NanoImagePrompt.augment(prompt, { appendNegative: true });
      }
    } catch (e) {}
    prompt = aug.prompt;
    var url = imageEndpoint(cfg.imgUrl, 'gen');
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.imgKey) headers.Authorization = 'Bearer ' + cfg.imgKey;
    var note = lock.note || (faceRef ? faceNote() : '');
    var fullPrompt = note ? (note + '\n' + prompt) : prompt;
    function viaEdits() {
      var dataRefs = faceRefs.filter(function (x) { return String(x).indexOf('data:') === 0; });
      if (!dataRefs.length) return Promise.reject(new Error('no data ref'));
      var fd = new FormData();
      fd.append('model', cfg.imgModel || '');
      fd.append('prompt', fullPrompt);
      fd.append('n', '1');
      fd.append('size', '1024x1024');
      dataRefs.forEach(function (ref, idx) {
        fd.append('image', dataUrlToBlob(ref), 'reference-' + (idx + 1) + '.png');
      });
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
      var payload = { model: cfg.imgModel || undefined, prompt: fullPrompt, n: 1, size: '1024x1024' };
      var refs = faceRefs.filter(Boolean);
      var singleRef = faceRef || refs[0] || '';
      var body = JSON.stringify(Object.assign(payload,
        refs.length ? {
          image: singleRef,
          reference_image: refs,
          input_reference_image: refs,
          reference_images: refs,
          ref_image: singleRef
        } : {}));
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
    var lead = String(st.name || '角色');
    var who = String(ev.who || '').trim();
    var cast = lead;
    if (who) cast += /(用户|你)/.test(who) ? '和用户' : ('、' + who);
    else cast += '一人';
    return '人物：' + cast + '。' + (st.style || '自然光生活随拍，真实照片质感') + '。主角：' + lead +
      (persona ? '（' + persona + '）' : '') + '。场景：' + (ev.place || '室内') + '，' + (ev.title || '日常') +
      (who ? '，与' + who + '在一起' : '') + '。' + String(ev.note || '').slice(0, 120) +
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
      // 日程报备只发「安排本身」的内容，不再把角色的心声/感悟当作报备文字发到私聊。
      target.report = { at: Date.now(), note: String(target.note || target.title || '').trim().slice(0, 80), delivered: false };
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
    // 未开启「允许生图」的 char：不生成日程照片。
    if (!charAllowsImage(id)) return Promise.resolve({ ok: true, skipped: true });
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
      return Promise.all([
        readApiConfig(),
        (window.NanoFaceLock && NanoFaceLock.build)
          ? NanoFaceLock.build(id, prompt, { charName: name, maxRefs: 4 }).catch(function(){ return null; })
          : faceRefFor(id).then(function (r) { return { faceRef: r || '', refs: r ? [r] : [], note: r ? faceNote() : '' }; })
      ]).then(function (pair) {
        var cfg = pair[0];
        var lock = pair[1] || { faceRef: '', refs: [], note: '' };
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
          var req = requestImage(cfg, prompt, lock, relay);
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
        // 兼容旧数据：以前可能把 mood（心声/感悟）写进了 report.note；这里丢弃它，
        // 只发日程本身的安排文字。
        var reportNote = String(e.report.note || '').trim();
        if (reportNote && e.mood && reportNote === String(e.mood).trim()) reportNote = '';
        out.push({
          charId: id,
          charName: (data.settings && data.settings.name) || name,
          eventId: e.id,
          title: e.title || '日程记录',
          place: e.place || '',
          date: e.date || today(),
          start: e.start || '',
          end: e.end || '',
          note: reportNote || e.note || e.title || '',
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
    isBusy: function () { return busyNow(cache.data); },
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
