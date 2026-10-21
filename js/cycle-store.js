/* ============================================================
   cycle-store.js — 月潮（经期记录 / 预测 / 角色权限）
   数据只保存在本机 localStorage，不同步到任何第三方服务器。
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoCycle) return;

  var KEY = 'nano_cycle_data';
  var DAY = 86400000;

  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }
  function todayKey() { return keyOf(new Date()); }
  function addDays(s, n) {
    var d = parse(s);
    if (!d) return '';
    d.setDate(d.getDate() + Number(n || 0));
    return keyOf(d);
  }
  function diffDays(a, b) {
    var da = parse(a), db = parse(b);
    if (!da || !db) return 0;
    return Math.round((db.getTime() - da.getTime()) / DAY);
  }
  function clamp(n, min, max, dflt) {
    n = parseInt(n, 10);
    if (!isFinite(n)) n = dflt;
    return Math.max(min, Math.min(max, n));
  }
  function niceDate(s) {
    var d = parse(s);
    if (!d) return String(s || '');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function defaults() {
    return {
      version: 1,
      onboarded: false,
      cycleLength: 28,
      periodLength: 5,
      reminderDays: 3,
      reminderEnabled: true,
      permissions: [],
      permissionsByUser: {},
      records: [],
      lastNotified: '',
      lastCardMonth: '',
      lastCardChar: '',
      updatedAt: 0
    };
  }

  function normalize(raw) {
    var d = defaults();
    if (raw && typeof raw === 'object') {
      d.onboarded = !!raw.onboarded;
      d.cycleLength = clamp(raw.cycleLength, 18, 60, 28);
      d.periodLength = clamp(raw.periodLength, 2, 14, 5);
      d.reminderDays = clamp(raw.reminderDays, 0, 14, 3);
      d.reminderEnabled = raw.reminderEnabled !== false;
      d.permissions = Array.isArray(raw.permissions) ? raw.permissions.map(String).filter(Boolean) : [];
      d.permissionsByUser = (raw.permissionsByUser && typeof raw.permissionsByUser === 'object') ? raw.permissionsByUser : {};
      Object.keys(d.permissionsByUser).forEach(function (k) {
        var arr = d.permissionsByUser[k];
        d.permissionsByUser[k] = Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
      });
      d.records = Array.isArray(raw.records) ? raw.records.filter(function (r) {
        return r && parse(r.start);
      }).map(function (r) {
        var start = keyOf(parse(r.start));
        var end = parse(r.end) ? keyOf(parse(r.end)) : addDays(start, d.periodLength - 1);
        if (diffDays(start, end) < 0) end = start;
        return { start: start, end: end };
      }).sort(function (a, b) { return a.start < b.start ? -1 : 1; }) : [];
      d.lastNotified = String(raw.lastNotified || '');
      d.lastCardMonth = String(raw.lastCardMonth || '');
      d.lastCardChar = String(raw.lastCardChar || '');
      d.updatedAt = Number(raw.updatedAt) || 0;
    }
    return d;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var d = normalize(raw ? JSON.parse(raw) : null);
      var uid = currentUserId() || 'default';
      if (!d.permissionsByUser[uid] && d.permissions.length) {
        // 旧数据：把当前权限归到当前 user 名下
        d.permissionsByUser[uid] = d.permissions.slice();
      }
      d.permissions = (d.permissionsByUser[uid] || []).slice();
      return d;
    } catch (e) { return defaults(); }
  }

  var lastSaved = null;
  function save(data) {
    var d = normalize(data);
    // 周期/设置是全局的；只有角色权限按 user 分开存，切换 user 不会清空另一个 user 的授权
    var uid = currentUserId() || 'default';
    d.permissionsByUser = d.permissionsByUser || {};
    d.permissionsByUser[uid] = (d.permissions || []).map(String).filter(Boolean);
    d.updatedAt = Date.now();
    lastSaved = d;
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('nanoCycleUpdated', { detail: d })); } catch (e) {}
    syncWorkerDebounced(d);
    return d;
  }

  function avgCycle(d) {
    if (!d || !d.records || d.records.length < 2) return d ? d.cycleLength : 28;
    var starts = d.records.map(function (r) { return r.start; });
    var gaps = [];
    for (var i = 1; i < starts.length; i++) {
      var g = diffDays(starts[i - 1], starts[i]);
      if (g >= 18 && g <= 60) gaps.push(g);
    }
    if (!gaps.length) return d.cycleLength;
    gaps = gaps.slice(-6);
    var sum = gaps.reduce(function (a, b) { return a + b; }, 0);
    return Math.round(sum / gaps.length);
  }

  function avgPeriod(d) {
    if (!d || !d.records || !d.records.length) return d ? d.periodLength : 5;
    var lens = d.records.map(function (r) { return diffDays(r.start, r.end) + 1; }).filter(function (n) { return n >= 1 && n <= 14; });
    if (!lens.length) return d.periodLength;
    lens = lens.slice(-6);
    return Math.max(2, Math.round(lens.reduce(function (a, b) { return a + b; }, 0) / lens.length));
  }

  function recordEnd(d, rec) {
    return rec.end || addDays(rec.start, avgPeriod(d) - 1);
  }

  function containsRecord(d, date) {
    for (var i = 0; i < d.records.length; i++) {
      var r = d.records[i];
      if (date >= r.start && date <= recordEnd(d, r)) return r;
    }
    return null;
  }

  // 从最近一次记录向前/向后推算周期起点
  function predictedStarts(d, stats) {
    var starts = d.records.map(function (r) { return r.start; });
    var anchor = stats && stats.cycleStart ? stats.cycleStart : (starts.length ? starts[starts.length - 1] : todayKey());
    var len = stats && stats.cycleLength ? stats.cycleLength : avgCycle(d);
    var out = [];
    for (var n = -12; n <= 18; n++) out.push(addDays(anchor, n * len));
    starts.forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
    out.sort();
    return out;
  }

  function stats(d, date) {
    d = d || load();
    date = date || todayKey();
    var len = avgCycle(d);
    var period = avgPeriod(d);
    var records = d.records || [];
    var curRec = containsRecord(d, date);
    var lastRec = null;
    for (var i = records.length - 1; i >= 0; i--) {
      if (records[i].start <= date) { lastRec = records[i]; break; }
    }
    if (!lastRec && records.length) lastRec = records[0];
    var cycleStart = lastRec ? lastRec.start : (curRec ? curRec.start : addDays(date, 0));
    if (curRec) cycleStart = curRec.start;

    // 如果今天已经越过当前周期的预测起点，就顺着推到包含今天的那个周期
    var nextStart = addDays(cycleStart, len);
    var guard = 0;
    while (nextStart <= date && guard < 500) {
      cycleStart = nextStart;
      nextStart = addDays(cycleStart, len);
      guard++;
    }
    // 今天正好是预测经期第一天
    var daysUntil = Math.max(0, diffDays(date, nextStart));

    var ovulation = addDays(nextStart, -14);
    var fertileStart = addDays(ovulation, -5);
    var fertileEnd = addDays(ovulation, 1);

    var phase = 'follicular';
    if (curRec) phase = 'menstrual';
    else if (date >= fertileStart && date <= fertileEnd) phase = (date === ovulation ? 'ovulation' : 'fertile');
    else if (date < ovulation) phase = 'follicular';
    else phase = 'luteal';

    return {
      today: date,
      cycleLength: len,
      periodLength: period,
      cycleStart: cycleStart,
      nextStart: nextStart,
      daysUntil: daysUntil,
      ovulation: ovulation,
      fertileStart: fertileStart,
      fertileEnd: fertileEnd,
      phase: phase,
      currentRecord: curRec,
      periodDay: curRec ? (diffDays(curRec.start, date) + 1) : 0,
      lastRecord: lastRec
    };
  }

  function dayInfo(d, date, st) {
    d = d || load();
    st = st || stats(d, date);
    var rec = containsRecord(d, date);
    var predicted = false, ovulation = false, fertile = false;
    var starts = predictedStarts(d, st);
    for (var i = 0; i < starts.length; i++) {
      var s = starts[i];
      if (!rec && date >= s && date <= addDays(s, st.periodLength - 1)) predicted = true;
      if (date === addDays(s, -14)) ovulation = true;
      if (date >= addDays(s, -19) && date <= addDays(s, -13)) fertile = true;
    }
    if (rec) predicted = false;
    return {
      period: !!rec,
      predicted: predicted,
      ovulation: ovulation,
      fertile: fertile && !ovulation,
      today: date === todayKey()
    };
  }

  function allowed(charId) {
    if (charId == null || charId === '') return false;
    var d = load();
    return d.onboarded && d.permissions.indexOf(String(charId)) > -1;
  }

  function promptBlock(charId, opts) {
    opts = opts || {};
    var d = load();
    if (!d.onboarded || !allowed(charId)) return '';
    var st = stats(d, opts.date);
    var lines = [];
    lines.push('【月潮 · 她的经期（她只对你开放了这份记录）】');
    lines.push('今天是 ' + st.today + '。');
    if (st.currentRecord) {
      lines.push('她现在正在经期：' + niceDate(st.currentRecord.start) + ' 开始的这一轮，今天是第 ' + st.periodDay + ' 天（预计持续约 ' + st.periodLength + ' 天）。');
    } else {
      lines.push('她当前处于' + phaseName(st.phase) + '。');
    }
    lines.push('最近一次经期：' + (st.lastRecord ? (niceDate(st.lastRecord.start) + '–' + niceDate(recordEnd(d, st.lastRecord))) : '暂无记录') + '；平均周期约 ' + st.cycleLength + ' 天。');
    lines.push('预计下次经期：' + niceDate(st.nextStart) + '（还有 ' + st.daysUntil + ' 天），预计持续 ' + st.periodLength + ' 天。');
    lines.push('预计排卵日：' + niceDate(st.ovulation) + '；排卵期：' + niceDate(st.fertileStart) + '–' + niceDate(st.fertileEnd) + '。');
    lines.push('这是她自己的私密记录，推算不一定完全准确。你知道就好，不要生硬地播报日期、周期或“系统推算”，也不要在不合适的场合反复提。');
    var due = d.reminderEnabled && st.daysUntil >= 0 && st.daysUntil <= d.reminderDays;
    if (due) {
      lines.push('【提醒时机】她预计 ' + (st.daysUntil === 0 ? '今天' : (st.daysUntil + ' 天后')) + ' 来经期。这一轮可以自然地关心一下她：提醒她注意休息、别太累、备好用品，语气要像你本人，不要像提醒机器人。');
    }
    if (opts.proactive && due) {
      lines.push('【本轮是主动消息】请把“经期快到了”作为自然的切入点，说 1~3 句关心的话；不要提“记录/推算/提醒设置”。');
    }
    return lines.join('\n');
  }

  function phaseName(p) {
    return ({ menstrual: '经期', follicular: '卵泡期', fertile: '排卵期', ovulation: '排卵日', luteal: '黄体期' })[p] || '黄体期';
  }

  function workerCycle(charId) {
    var d = load();
    if (!d.onboarded || !allowed(charId)) return null;
    var st = stats(d);
    return {
      lastStart: st.cycleStart,
      nextStart: st.nextStart,
      cycleLength: st.cycleLength,
      periodLength: st.periodLength,
      remindDays: d.reminderEnabled ? d.reminderDays : 0
    };
  }

  function currentUserId() {
    try {
      var hd = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
      if (hd && hd.currentMaskId) return String(hd.currentMaskId);
      if (hd && Array.isArray(hd.masks) && hd.masks[0] && hd.masks[0].id) return String(hd.masks[0].id);
    } catch (e) {}
    return '';
  }
  function appId() {
    var s = '';
    try {
      var root = window.NANO_ROOT || new URL('./', location.href).href;
      var u = new URL(root, location.href);
      s = u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) { s = String(location.origin || '') + String(location.pathname || ''); }
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return 'app_' + h.toString(36);
  }
  function deviceId() {
    var id = '';
    try { id = localStorage.getItem('nano_device_id') || ''; } catch (e) {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('nano_device_id', id); } catch (e) {}
    }
    return id || 'default';
  }

  function syncWorker(d) {
    try {
      var uid = currentUserId();
      if (!uid || !d) return;
      var endpoint = (localStorage.getItem('nano_push_endpoint') || 'https://nanopush.nano315.online').replace(/\/+$/, '');
      var token = localStorage.getItem('nano_peek_token') || localStorage.getItem('nano_push_token') || '';
      var cycles = {};
      (d.permissions || []).forEach(function (id) { var c = workerCycle(id); if (c) cycles[id] = c; });
      fetch(endpoint + '/auto/cycle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Push-Token': localStorage.getItem('nano_push_token') || '',
          'X-Peek-Token': localStorage.getItem('nano_peek_token') || ''
        },
        body: JSON.stringify({ token: token, appId: appId(), deviceId: deviceId(), userId: uid, cycles: cycles })
      }).catch(function () {});
    } catch (e) {}
  }
  var syncTimer = null;
  function syncWorkerDebounced(d) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncWorker(lastSaved || d); }, 500);
  }

  function currentChatId() {
    try {
      var m = /[?&]chat=([^&]+)/.exec(location.search || '');
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function deliverCycleCard(d, st) {
    var ids = (d.permissions || []).map(String).filter(Boolean);
    if (!ids.length) return null;
    var cur = currentChatId();
    var charId = cur && ids.indexOf(cur) > -1 ? cur : ids[0];
    var month = st.today.slice(0, 7);
    var sub = st.daysUntil === 0 ? '预计今天来' : ('预计还有 ' + st.daysUntil + ' 天');
    var cardData = {
      cardType: 'cycle',
      title: '经期提醒',
      sub: sub,
      date: niceDate(st.nextStart),
      cycle: st.cycleLength + ' 天周期',
      note: '这几天可能会累，记得提前休息、备好用品',
      footer: '提前照顾好自己'
    };
    var card = { id: 'cycle_' + month + '_' + charId, chatId: charId, cardData: cardData, ts: Date.now() };
    try {
      if (cur && String(cur) === String(charId) && window.__chat && window.__chat.addMessage) {
        var now = new Date();
        window.__chat.addMessage('left', '', pad(now.getHours()) + ':' + pad(now.getMinutes()), null, false, true, cardData);
      } else {
        var q = {};
        try { q = JSON.parse(localStorage.getItem('nano_pending_cycle_cards') || '{}') || {}; } catch (e) { q = {}; }
        q[charId] = card;
        localStorage.setItem('nano_pending_cycle_cards', JSON.stringify(q));
      }
      return card;
    } catch (e) { return null; }
  }

  function checkSystemReminder() {
    var d = load();
    if (!d.onboarded || !d.reminderEnabled) return false;
    var st = stats(d);
    if (st.daysUntil < 0 || st.daysUntil > d.reminderDays) return false;
    var did = false;
    var month = st.today.slice(0, 7);
    // 一个月最多一张卡片，由一个月度 char 发一次
    if (String(d.lastCardMonth || '') !== month) {
      var card = deliverCycleCard(d, st);
      if (card) {
        d.lastCardMonth = month;
        d.lastCardChar = String(card.chatId || '');
        save(d);
        did = true;
      }
    }
    if (d.lastNotified === st.today) return did;
    var canNotify = true;
    try { canNotify = ('Notification' in window) && Notification.permission === 'granted'; } catch (e) { canNotify = false; }
    if (canNotify) {
      d.lastNotified = st.today;
      save(d);
      try {
        if (window.NanoNotify) {
          window.NanoNotify.notify('月潮', st.daysUntil === 0 ? '预计今天来经期，记得照顾好自己。' : ('预计还有 ' + st.daysUntil + ' 天来经期，提前准备一下。'), { target: 'cycle', channel: 'cycle' });
        }
      } catch (e) {}
      did = true;
    }
    return did;
  }

  window.NanoCycle = {
    KEY: KEY,
    load: load,
    save: save,
    defaults: defaults,
    stats: stats,
    dayInfo: dayInfo,
    avgCycle: avgCycle,
    avgPeriod: avgPeriod,
    phaseName: phaseName,
    allowed: allowed,
    promptBlock: promptBlock,
    workerCycle: workerCycle,
    checkSystemReminder: checkSystemReminder,
    syncWorker: syncWorker,
    todayKey: todayKey,
    addDays: addDays,
    diffDays: diffDays,
    niceDate: niceDate,
    recordEnd: recordEnd,
    esc: esc
  };
})();
