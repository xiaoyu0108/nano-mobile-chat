/* ============================================================
   cycle.js — 月潮页面
   ============================================================ */
(function () {
  'use strict';

  var NC = window.NanoCycle;
  if (!NC) return;

  var data = NC.load();
  var view = new Date();
  var viewYear = view.getFullYear();
  var viewMonth = view.getMonth();
  var editing = null;
  var chars = [];
  var onboardPeriod = data.periodLength || 5;
  var onboardCycle = data.cycleLength || 28;
  var setPeriod = data.periodLength || 5;
  var setCycle = data.cycleLength || 28;
  var setRemind = data.reminderDays || 3;

  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  var PHASE = {
    menstrual: { name: '经期', en: 'MENSTRUAL PHASE', desc: '这几天身体在休息。允许自己慢一点，热水、甜食和睡眠都可以多一点。' },
    follicular: { name: '卵泡期', en: 'FOLLICULAR PHASE', desc: '经期结束后的轻快阶段，精力慢慢回来。适合把想做的小事往前推一推。' },
    fertile: { name: '排卵期', en: 'OVULATION WINDOW', desc: '排卵日前后，身体和情绪都更敏感。记得照顾好自己，也尊重自己的节奏。' },
    ovulation: { name: '排卵日', en: 'OVULATION DAY', desc: '排卵日当天，可能会更有表达欲和亲近感。留意身体的细微信号。' },
    luteal: { name: '黄体期', en: 'LUTEAL PHASE', desc: '身体在为下一次周期做准备。可以放慢一点，多睡一会儿，少喝冰的。' }
  };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(text) {
    var el = $('cyToast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(window.__cyToast);
    window.__cyToast = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }
  function mondayIndex(d) { return d.getDay(); }

  function save(next) {
    data = NC.save(next || data);
    render();
    renderOnboard();
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    renderHero();
    renderCalendar();
    renderPhase();
    renderPermSummary();
  }

  function renderHero() {
    var st = NC.stats(data);
    var p = PHASE[st.phase] || PHASE.luteal;
    $('cyPhaseKicker').textContent = p.name + ' · ' + p.en.replace(' PHASE', '');
    if (st.currentRecord) {
      $('cyDays').textContent = st.periodDay;
      $('cyDays').nextElementSibling.textContent = '天';
      $('cyPhaseKicker').textContent = '经期 · MENSTRUAL';
      document.querySelector('.cy-count-label').textContent = '经期第几天';
      $('cyNextDate').textContent = '预计持续到 ' + NC.niceDate(NC.recordEnd(data, st.currentRecord));
    } else {
      $('cyDays').textContent = st.daysUntil;
      $('cyDays').nextElementSibling.textContent = '天';
      document.querySelector('.cy-count-label').textContent = '距离下次经期';
      $('cyNextDate').textContent = st.daysUntil === 0 ? '预计就是今天' : ('预计 ' + NC.niceDate(st.nextStart));
    }
    var progress = 0;
    try {
      progress = Math.max(0, Math.min(100, Math.round(NC.diffDays(st.cycleStart, st.today) / Math.max(1, st.cycleLength) * 100)));
    } catch (e) {}
    if (st.currentRecord) progress = Math.max(2, Math.min(20, progress));
    $('cyProgress').style.width = progress + '%';
    $('cyTodayLabel').textContent = '今天 ' + (new Date().getMonth() + 1) + '/' + new Date().getDate();
    $('cyCycleLen').textContent = st.cycleLength + ' 天周期';
  }

  function renderCalendar() {
    var mid = new Date(viewYear, viewMonth, 15, 12);
    var midKey = dateKey(mid.getFullYear(), mid.getMonth(), mid.getDate());
    var st = NC.stats(data, midKey);
    var first = new Date(viewYear, viewMonth, 1, 12);
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var startPad = mondayIndex(first);
    var today = NC.todayKey();
    var html = '';
    for (var i = 0; i < startPad; i++) html += '<span class="cy-day other"></span>';
    for (var d = 1; d <= daysInMonth; d++) {
      var key = dateKey(viewYear, viewMonth, d);
      var info = NC.dayInfo(data, key, st);
      var cls = ['cy-day'];
      if (info.period) cls.push('period');
      else if (info.predicted) cls.push('predicted');
      else if (info.ovulation) cls.push('ovulation');
      else if (info.fertile) cls.push('fertile');
      if (key === today) cls.push('is-today');
      html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + key + '">' +
        '<span class="num">' + d + '</span>' +
        (info.ovulation ? '<i class="dot-mark"></i>' : '') +
        '</button>';
    }
    $('cyGrid').innerHTML = html;
    $('cyMonth').textContent = viewYear + '年' + (viewMonth + 1) + '月';
    $('cyMonthEn').textContent = MONTHS[viewMonth];
  }

  function renderPhase() {
    var st = NC.stats(data);
    var p = PHASE[st.phase] || PHASE.luteal;
    $('cyPhaseName').textContent = p.name;
    $('cyPhaseEn').textContent = p.en;
    $('cyPhaseDesc').textContent = p.desc;
    $('cyPhaseChip').textContent = st.currentRecord
      ? ('经期第 ' + st.periodDay + ' 天')
      : (st.daysUntil === 0 ? '预计今天' : ('还有 ' + st.daysUntil + ' 天'));
    var progress = Math.max(0, Math.min(100, Math.round(NC.diffDays(st.cycleStart, st.today) / Math.max(1, st.cycleLength) * 100)));
    $('cyPhaseTrack').style.width = progress + '%';
    $('cyOvulation').textContent = NC.niceDate(st.ovulation).replace('月', '/').replace('日', '');
    $('cyFertile').textContent = NC.niceDate(st.fertileStart).replace('月', '/').replace('日', '') + '–' + NC.niceDate(st.fertileEnd).replace('月', '/').replace('日', '');
  }

  function renderPermSummary() {
    var perms = data.permissions || [];
    var sel = chars.filter(function (c) { return perms.indexOf(String(c.id)) > -1; });
    var avs = $('cyPermAvatars');
    var summary = $('cyPermSummary');
    if (!avs || !summary) return;
    if (!sel.length) {
      avs.innerHTML = '<span class="cy-perm-av empty">·</span>';
      summary.textContent = '仅自己可见';
      return;
    }
    avs.innerHTML = sel.slice(0, 3).map(function (c) {
      var av = c.avatar ? '<img src="' + esc(c.avatar) + '" alt="">' : esc(String(c.name).slice(0, 1));
      return '<span class="cy-perm-av">' + av + '</span>';
    }).join('');
    summary.textContent = sel.slice(0, 3).map(function (c) { return c.name; }).join('、') + (sel.length > 3 ? ' 等 ' + sel.length + ' 人' : '');
  }

  /* ---------------- 日历点击 → 记录 ---------------- */
  function openRecord(date) {
    date = date || NC.todayKey();
    var rec = null;
    for (var i = 0; i < data.records.length; i++) {
      var r = data.records[i];
      if (date >= r.start && date <= NC.recordEnd(data, r)) { rec = r; break; }
    }
    editing = { oldStart: rec ? rec.start : '' };
    $('cySheetTitle').textContent = rec ? '修改经期' : '记录经期';
    $('cySheetSub').textContent = rec ? '改完后，后面的推算会自动跟着调整' : '选择这一次的开始和结束日期';
    $('cyStart').value = rec ? rec.start : date;
    $('cyEnd').value = rec ? rec.end : NC.addDays(date, Math.max(1, data.periodLength) - 1);
    $('cyDeleteRecord').style.display = rec ? '' : 'none';
    $('cySheet').classList.add('show');
  }

  function closeRecord() {
    $('cySheet').classList.remove('show');
    editing = null;
  }

  function saveRecord() {
    var start = $('cyStart').value;
    var end = $('cyEnd').value || start;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { toast('请选择开始日期'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) end = start;
    if (NC.diffDays(start, end) < 0) end = start;
    var oldStart = editing && editing.oldStart;
    var next = NC.load();
    next.records = next.records.filter(function (r) {
      if (oldStart && r.start === oldStart) return false;
      var re = NC.recordEnd(next, r);
      var overlap = !(end < r.start || start > re);
      return !overlap;
    });
    next.records.push({ start: start, end: end });
    next.records.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    next.onboarded = true;
    save(next);
    closeRecord();
    toast('已记录 ' + NC.niceDate(start) + '–' + NC.niceDate(end));
  }

  function deleteRecord() {
    if (!editing || !editing.oldStart) return;
    var next = NC.load();
    next.records = next.records.filter(function (r) { return r.start !== editing.oldStart; });
    save(next);
    closeRecord();
    toast('已删除这条记录');
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    setPeriod = data.periodLength;
    setCycle = data.cycleLength;
    setRemind = data.reminderDays;
    $('cySetPeriod').textContent = setPeriod;
    $('cySetCycle').textContent = setCycle;
    $('cySetRemind').textContent = setRemind;
    $('cyReminderOn').checked = data.reminderEnabled !== false;
    $('cySettingSheet').classList.add('show');
  }
  function closeSettings() { $('cySettingSheet').classList.remove('show'); }
  function saveSettings() {
    var next = NC.load();
    next.periodLength = setPeriod;
    next.cycleLength = setCycle;
    next.reminderDays = setRemind;
    next.reminderEnabled = $('cyReminderOn').checked;
    next.onboarded = true;
    save(next);
    closeSettings();
    toast('周期设置已更新');
  }
  function resetAll() {
    if (!confirm('清空所有经期记录和角色权限？这个操作不能撤销。')) return;
    var next = NC.defaults();
    data = NC.save(next);
    onboardPeriod = data.periodLength;
    onboardCycle = data.cycleLength;
    render();
    closeSettings();
    renderOnboard();
    toast('已清空');
  }

  /* ---------------- 引导 ---------------- */
  function renderOnboard() {
    var el = $('cyOnboard');
    if (!el) return;
    el.classList.toggle('show', !data.onboarded);
    $('cyOnboardPeriod').textContent = onboardPeriod;
    $('cyOnboardCycle').textContent = onboardCycle;
    if (!$('cyOnboardStart').value) {
      var d = new Date();
      d.setDate(d.getDate() - 14);
      $('cyOnboardStart').value = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  function finishOnboard() {
    var start = $('cyOnboardStart').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { toast('请选择最近一次经期的开始日期'); return; }
    var next = NC.load();
    next.onboarded = true;
    next.periodLength = onboardPeriod;
    next.cycleLength = onboardCycle;
    next.records = [{ start: start, end: NC.addDays(start, onboardPeriod - 1) }];
    data = NC.save(next);
    onboardPeriod = data.periodLength;
    onboardCycle = data.cycleLength;
    renderOnboard();
    render();
    toast('月潮已经开始记录');
  }

  /* ---------------- 角色权限 ---------------- */
  var permDraft = null;

  async function loadChars() {
    try {
      chars = window.NanoUserScope ? await NanoUserScope.loadChars() : [];
    } catch (e) { chars = []; }
    // 角色权限按 user 分别存储；这里只显示当前 user 绑定的角色，不删除其他 user 的授权
    renderPermSummary();
    if (permDraft) renderCharSheet();
  }

  function renderCharSheet() {
    var box = $('cyCharList');
    if (!box) return;
    if (!chars.length) {
      box.innerHTML = '<div class="cy-empty-chars">当前 user 下还没有角色。先创建一个角色，再回来开放权限。</div>';
      return;
    }
    var perms = permDraft || [];
    box.innerHTML = chars.map(function (c) {
      var on = perms.indexOf(String(c.id)) > -1;
      var av = c.avatar
        ? '<img src="' + esc(c.avatar) + '" alt="">'
        : esc(String(c.name).slice(0, 1));
      return '<label class="cy-char-row">' +
        '<span class="cy-char-av">' + av + '</span>' +
        '<span class="cy-char-name">' + esc(c.name) + '<span>' + (on ? '可以知道你的月潮' : '不会读到你的记录') + '</span></span>' +
        '<input type="checkbox" class="cy-switch cy-char-toggle" data-id="' + esc(c.id) + '"' + (on ? ' checked' : '') + '>' +
        '</label>';
    }).join('');
  }

  async function openPermSheet() {
    if (!chars.length) { try { await loadChars(); } catch (e) {} }
    var visible = {};
    chars.forEach(function (c) { visible[String(c.id)] = 1; });
    permDraft = (data.permissions || []).map(String).filter(function (id) { return !!visible[id]; });
    renderCharSheet();
    $('cyPermSheet').classList.add('show');
  }
  function closePermSheet() {
    $('cyPermSheet').classList.remove('show');
    permDraft = null;
  }
  function togglePermDraft(id, on) {
    if (!permDraft) permDraft = [];
    permDraft = permDraft.filter(function (x) { return String(x) !== String(id); });
    if (on) permDraft.push(String(id));
    renderCharSheet();
  }
  function savePermSheet() {
    var next = NC.load();
    next.permissions = (permDraft || []).slice();
    data = NC.save(next);
    closePermSheet();
    renderPermSummary();
    toast('月潮权限已更新');
  }

  /* ---------------- 系统提醒 ---------------- */
  function requestNotify() {
    try {
      if (window.NanoNotify) {
        NanoNotify.ensurePermission();
        setTimeout(function () {
          NanoCycle.checkSystemReminder();
          updateNotifyBtn();
        }, 450);
      }
    } catch (e) {}
  }
  function updateNotifyBtn() {
    var btn = $('cyNotifyBtn');
    if (!btn) return;
    var granted = false;
    try { granted = typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch (e) {}
    btn.textContent = granted ? '系统提醒已开启 · 点击测试' : '开启系统提醒';
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('cyBack').addEventListener('click', function () {
      if (window.parent !== window) {
        try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } catch (e) {}
      }
      if (history.length > 1) history.back();
      else location.href='../index.html';
    });
    $('cySettings').addEventListener('click', openSettings);
    $('cyPrev').addEventListener('click', function () {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    });
    $('cyNext').addEventListener('click', function () {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    });
    $('cyGrid').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-date]');
      if (btn) openRecord(btn.getAttribute('data-date'));
    });
    $('cyRecord').addEventListener('click', function () {
      var d = new Date();
      openRecord(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    });
    $('cyAdjust').addEventListener('click', openSettings);
    $('cySheetClose').addEventListener('click', closeRecord);
    $('cyCancelRecord').addEventListener('click', closeRecord);
    $('cySaveRecord').addEventListener('click', saveRecord);
    $('cyDeleteRecord').addEventListener('click', deleteRecord);
    $('cySheet').addEventListener('click', function (e) { if (e.target === $('cySheet')) closeRecord(); });

    $('cySettingClose').addEventListener('click', closeSettings);
    $('cySaveSetting').addEventListener('click', saveSettings);
    $('cyReset').addEventListener('click', resetAll);
    $('cySettingSheet').addEventListener('click', function (e) { if (e.target === $('cySettingSheet')) closeSettings(); });

    $('cySettingSheet').addEventListener('click', function (e) {
      var b = e.target.closest('[data-set]');
      if (!b) return;
      var parts = b.getAttribute('data-set').split(':');
      var delta = parseInt(parts[1], 10) || 0;
      if (parts[0] === 'cycle') setCycle = Math.max(18, Math.min(60, setCycle + delta));
      if (parts[0] === 'period') setPeriod = Math.max(2, Math.min(14, setPeriod + delta));
      if (parts[0] === 'remind') setRemind = Math.max(0, Math.min(14, setRemind + delta));
      $('cySetCycle').textContent = setCycle;
      $('cySetPeriod').textContent = setPeriod;
      $('cySetRemind').textContent = setRemind;
    });

    $('cyPermOpen').addEventListener('click', openPermSheet);
    $('cyPermClose').addEventListener('click', closePermSheet);
    $('cyPermCancel').addEventListener('click', closePermSheet);
    $('cyPermSave').addEventListener('click', savePermSheet);
    $('cyPermSheet').addEventListener('click', function (e) { if (e.target === $('cyPermSheet')) closePermSheet(); });
    $('cyCharList').addEventListener('change', function (e) {
      var cb = e.target.closest('.cy-char-toggle');
      if (cb) togglePermDraft(cb.getAttribute('data-id'), cb.checked);
    });
    $('cyNotifyBtn').addEventListener('click', requestNotify);

    var onboardCard = document.querySelector('.cy-onboard-card');
    if (onboardCard) {
      onboardCard.addEventListener('click', function (e) {
        var b = e.target.closest('[data-step]');
        if (!b) return;
        var parts = b.getAttribute('data-step').split(':');
        var delta = parseInt(parts[1], 10) || 0;
        if (parts[0] === 'period') onboardPeriod = Math.max(2, Math.min(14, onboardPeriod + delta));
        if (parts[0] === 'cycle') onboardCycle = Math.max(18, Math.min(60, onboardCycle + delta));
        $('cyOnboardPeriod').textContent = onboardPeriod;
        $('cyOnboardCycle').textContent = onboardCycle;
      });
    }
    $('cyOnboardSave').addEventListener('click', finishOnboard);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') NC.checkSystemReminder();
  });

  /* ---------------- 启动 ---------------- */
  try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoHideOuterHeader' }, '*'); } catch (e) {}
  renderOnboard();
  bind();
  render();
  updateNotifyBtn();
  loadChars();
  setTimeout(function () { NC.checkSystemReminder(); }, 1200);
})();
