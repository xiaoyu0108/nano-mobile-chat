(function () {
  'use strict';

  var KEY = 'nano_api_logs_v1';
  var $ = function (id) { return document.getElementById(id); };
  var filter = 'all';
  var query = '';
  var appFilter = 'all';
  var range = 30;
  var expanded = false;
  var toastTimer = null;

  // 每个页面 → App 名称。日志里的 page 是发起请求的页面文件名。
  var APP_LABEL = {
    'qa': 'Q&A',
    'offline': '线下',
    'chat': '聊天',
    'groups': '群聊',
    'moments': '朋友圈',
    'ins': 'Instagram',
    'imessage': 'iMessage',
    'halo': 'Halo',
    'books': 'Books',
    'music': '音乐',
    'index.html': '主界面',
    'home.html': '主界面',
    'chat.html': '聊天',
    'chat_inner.html': '私聊',
    'groups.html': '群聊',
    'group-setting.html': '群聊设置',
    'qa.html': 'Q&A',
    'moments.html': '朋友圈',
    'ins.html': 'Instagram',
    'imessage.html': 'iMessage',
    'halo.html': 'Halo',
    'books.html': 'Books',
    'music.html': '音乐',
    'offline.html': '线下',
    'offline-setting.html': '线下设置',
    'phone.html': '手机',
    'meet.html': '回忆',
    'discover.html': '发现',
    'doubao.html': '豆包',
    'taobao.html': '淘宝',
    'mapcal.html': '地图日历',
    'appstore.html': '应用商店',
    'app-host.html': 'App 宿主',
    'nano-app-template.html': 'App 模板',
    'nano.html': 'Nano',
    'nano-setting.html': 'Nano 设置',
    'nano-files.html': 'Nano 文件',
    'api.html': 'API 设置',
    'other.html': '设置·通知',
    'settings.html': '设置',
    'settings-logs.html': '后台日志',
    'settings-notifications.html': '设置·通知',
    'settings-other.html': '设置·其它',
    'settings-prompts.html': '设置·提示词',
    'settings-desktop.html': '设置·桌面',
    'storage.html': '储存',
    'backup.html': '备份',
    'ios-setting.html': 'iOS 设置',
    'more.html': '更多',
    'character.html': '角色',
    'heart-setting.html': '心声设置',
    'inner-setting.html': '内心设置',
    'beautify.html': '美化',
    'schedule.html': '日程',
    'pomodoro.html': '番茄钟',
    'worldbook.html': '世界书',
    'mask.html': '马甲',
    'wallet.html': '钱包',
    'market.html': '集市',
    'mall.html': '商城',
    'assistant.html': '助手',
    'favorite.html': '收藏',
    'emoji.html': '表情',
    'mcp.html': 'MCP',
    'family-card.html': '亲属卡',
    'couple-spaces.html': '情侣空间',
    'cycle.html': '周期',
    'memory.html': '记忆',
    'memory palace.html': '记忆宫殿',
    'fanfic.html': '同人',
    'fanfic-create.html': '同人创作',
    'fanfic-read.html': '同人阅读',
    'video-call.html': '视频通话',
    'voice-call.html': '语音通话'
  };
  function appKey(log) {
    var a = String((log && log.app) || '').trim();
    if (a) return a;
    var p = String((log && log.page) || '').trim();
    if (!p) return 'unknown';
    return p.split('?')[0];
  }
  function appLabel(key) {
    if (key === 'unknown') return '未知页面';
    return APP_LABEL[key] || key.replace(/\.html?$/i, '');
  }

  var KIND_LABEL = {
    chat: '聊天 API',
    image: '图片 API',
    tts: '语音 API',
    audio: '音频',
    video: '视频',
    memory: '记忆',
    push: '推送',
    schedule: '定时',
    mcp: 'MCP',
    market: '集市',
    link: '链接',
    social: '社交',
    other: '其他'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function readLogs() {
    if (window.NanoApiLogs && NanoApiLogs.read) return NanoApiLogs.read();
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (e) { return []; }
  }

  function fmtTime(ts) {
    var d = new Date(Number(ts) || 0);
    var now = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var hm = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  function safeUrl(u) {
    try {
      var x = new URL(String(u || ''), location.href);
      ['token', 'key', 'api_key', 'apikey', 'access_token', 'authorization', 'secret'].forEach(function (k) {
        if (x.searchParams.has(k)) x.searchParams.set(k, '***');
      });
      return x.href;
    } catch (e) { return String(u || '').slice(0, 800); }
  }

  function shortUrl(u) {
    try {
      var x = new URL(String(u || ''), location.href);
      var path = (x.pathname || '/').replace(/^\/+/, '');
      if (path.length > 46) path = '…' + path.slice(-46);
      return x.host === location.host ? ('/' + path) : (x.host + '/' + path);
    } catch (e) { return String(u || '').slice(0, 80); }
  }

  function statusClass(log) {
    if (log.ok) return 'ok';
    if (!log.status) return 'net';
    if (log.status === 429) return 'quota';
    if (log.status >= 500) return 'server';
    return 'client';
  }

  function statusText(log) {
    if (!log.status) return '网络';
    return String(log.status);
  }

  function matches(log) {
    if (!log) return false;
    if (appFilter !== 'all' && appKey(log) !== appFilter) return false;
    if (filter === 'error' && log.ok) return false;
    if (filter !== 'all' && filter !== 'error' && log.kind !== filter) return false;
    if (!query) return true;
    var hay = [log.url, log.error, log.page, appLabel(appKey(log)), log.method, log.kind, log.meta && log.meta.model].join(' ').toLowerCase();
    return hay.indexOf(query.toLowerCase()) !== -1;
  }

  function refreshAppOptions(all) {
    var sel = $('logApp');
    if (!sel) return;
    var seen = {};
    all.forEach(function (log) { seen[appKey(log)] = 1; });
    var keys = Object.keys(seen).sort(function (a, b) { return appLabel(a).localeCompare(appLabel(b), 'zh-CN'); });
    if (appFilter !== 'all' && keys.indexOf(appFilter) === -1) appFilter = 'all';
    var html = '<option value="all">全部 App</option>' + keys.map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(appLabel(k)) + '</option>';
    }).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = appFilter;
  }

  function render() {
    var all = readLogs();
    refreshAppOptions(all);
    var errors = all.filter(function (x) { return x && !x.ok; }).length;
    var matched = all.filter(matches);
    var limit = expanded ? matched.length : Math.min(matched.length, range);
    var list = matched.slice(0, limit);
    var hidden = Math.max(0, matched.length - list.length);
    var summary = $('logSummary');
    if (summary) {
      summary.textContent = '共 ' + all.length + ' 条 · 错误 ' + errors + ' 条' +
        (appFilter === 'all' ? '' : (' · 当前 App：' + appLabel(appFilter))) +
        ' · 匹配 ' + matched.length + ' 条 · 显示 ' + list.length + ' 条' +
        (hidden ? (' · 已折叠 ' + hidden + ' 条') : '');
    }
    var host = $('logList');
    var empty = $('logEmpty');
    if (!host) return;
    if (!list.length) {
      host.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    host.innerHTML = list.map(function (log) {
      var meta = log.meta || {};
      var metaBits = [];
      if (meta.model) metaBits.push(meta.model);
      if (meta.messages != null) metaBits.push(meta.messages + ' 条消息');
      if (meta.maxTokens != null) metaBits.push('max ' + meta.maxTokens);
      if (meta.inputChars != null) metaBits.push(meta.inputChars + ' 字输入');
      if (meta.stream) metaBits.push('stream');
      var detailBits = [];
      detailBits.push('完整地址：' + safeUrl(log.url));
      detailBits.push('App：' + appLabel(appKey(log)) + ' · 页面：' + (log.page || '') + (log.pageTitle ? (' · ' + log.pageTitle) : ''));
      detailBits.push('用户：' + (log.userId || '未识别'));
      if (metaBits.length) detailBits.push('请求：' + metaBits.join(' · '));
      if (log.error) detailBits.push('错误：' + log.error);
      if (log.detail) detailBits.push('响应摘要：' + log.detail);
      return '<div class="log-row ' + (log.ok ? 'ok' : 'fail') + '" data-id="' + esc(log.id) + '" role="button" tabindex="0">' +
        '<span class="log-dot ' + (log.ok ? 'ok' : 'error') + '"></span>' +
        '<span class="log-main">' +
          '<span class="log-title"><b>' + esc(log.method || 'GET') + '</b>' +
            '<span class="log-url" title="' + esc(safeUrl(log.url)) + '">' + esc(shortUrl(log.url)) + '</span>' +
            '<em class="log-status ' + statusClass(log) + '">' + esc(statusText(log)) + '</em></span>' +
          '<span class="log-sub">' + esc(fmtTime(log.at)) + ' · ' + esc(KIND_LABEL[log.kind] || log.kind || '其他') +
            ' · ' + esc(appLabel(appKey(log))) + ' · ' + esc(log.duration || 0) + 'ms' + (log.ok ? '' : (' · ' + esc(String(log.error || '请求失败').split('\n')[0].slice(0, 90)))) + '</span>' +
          '<span class="log-detail">' + detailBits.map(esc).join('<br>') +
            '<span class="log-row-actions"><button type="button" class="log-mini" data-copy="' + esc(log.id) + '">复制错误</button>' +
            '<button type="button" class="log-mini danger" data-remove="' + esc(log.id) + '">删除</button></span>' +
          '</span>' +
        '</span>' +
      '</div>';
    }).join('') +
    (hidden ? ('<button type="button" class="log-more-btn" data-more="1">展开更多（还有 ' + hidden + ' 条）</button>') : '') +
    ((expanded && matched.length > range) ? '<button type="button" class="log-more-btn" data-collapse="1">收起（只显示 ' + range + ' 条）</button>' : '');
  }

  function copyText(text) {
    text = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('已复制');
    } catch (e) { toast('复制失败'); }
  }

  function removeLog(id) {
    var all = readLogs().filter(function (x) { return x && x.id !== id; });
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
    render();
  }

  function bind() {
    var chips = $('logChips');
    if (chips) chips.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-filter]');
      if (!btn) return;
      filter = btn.getAttribute('data-filter') || 'all';
      expanded = false;
      Array.prototype.forEach.call(chips.querySelectorAll('.log-chip'), function (x) {
        x.classList.toggle('active', x === btn);
      });
      render();
    });

    var appSel = $('logApp');
    if (appSel) appSel.addEventListener('change', function () {
      appFilter = this.value || 'all';
      expanded = false;
      render();
    });

    var search = $('logSearch');
    if (search) search.addEventListener('input', function () {
      query = String(this.value || '').trim();
      expanded = false;
      render();
    });

    var rangeEl = $('logRange');
    if (rangeEl) rangeEl.addEventListener('change', function () {
      range = parseInt(this.value, 10) || 30;
      expanded = false;
      render();
    });

    var list = $('logList');
    if (list) {
      list.addEventListener('click', function (e) {
        var more = e.target.closest('[data-more]');
        if (more) {
          expanded = true;
          render();
          return;
        }
        var collapse = e.target.closest('[data-collapse]');
        if (collapse) {
          expanded = false;
          render();
          return;
        }
        var copy = e.target.closest('[data-copy]');
        if (copy) {
          e.stopPropagation();
          var log = readLogs().filter(function (x) { return x && x.id === copy.getAttribute('data-copy'); })[0];
          if (log) copyText([log.method + ' ' + safeUrl(log.url), 'HTTP ' + log.status, log.error, log.detail].filter(Boolean).join('\n'));
          return;
        }
        var del = e.target.closest('[data-remove]');
        if (del) {
          e.stopPropagation();
          removeLog(del.getAttribute('data-remove'));
          return;
        }
        var row = e.target.closest('.log-row');
        if (row) row.classList.toggle('open');
      });
      list.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var row = e.target.closest('.log-row');
        if (!row) return;
        e.preventDefault();
        row.classList.toggle('open');
      });
    }

    var clear = $('logClear');
    if (clear) clear.addEventListener('click', function () {
      if (!confirm('清空全部后台日志？')) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      render();
      toast('日志已清空');
    });

    var exp = $('logExport');
    if (exp) exp.addEventListener('click', function () {
      var data = '';
      try { data = window.NanoApiLogs ? NanoApiLogs.exportJson() : JSON.stringify({ logs: readLogs() }, null, 2); }
      catch (e) { data = JSON.stringify({ logs: readLogs() }, null, 2); }
      try {
        var blob = new Blob([data], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'nano-api-logs-' + Date.now() + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        toast('已导出');
      } catch (e) { toast('导出失败'); }
    });

    window.addEventListener('NANO_API_LOG', render);
    window.addEventListener('storage', function (e) { if (e.key === KEY) render(); });
  }

  bind();
  render();
})();
