(function () {
  'use strict';

  var KEY = 'nano_api_logs_v1';
  var $ = function (id) { return document.getElementById(id); };
  var filter = 'all';
  var query = '';
  var range = 100;
  var toastTimer = null;

  var KIND_LABEL = {
    chat: '聊天 API',
    memory: '记忆',
    push: '推送',
    mcp: 'MCP',
    market: '集市',
    link: '链接',
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
    if (filter === 'error' && log.ok) return false;
    if (filter !== 'all' && filter !== 'error' && log.kind !== filter) return false;
    if (!query) return true;
    var hay = [log.url, log.error, log.page, log.method, log.kind, log.meta && log.meta.model].join(' ').toLowerCase();
    return hay.indexOf(query.toLowerCase()) !== -1;
  }

  function render() {
    var all = readLogs();
    var errors = all.filter(function (x) { return x && !x.ok; }).length;
    var list = all.filter(matches).slice(0, range);
    var summary = $('logSummary');
    if (summary) summary.textContent = '共 ' + all.length + ' 条 · 错误 ' + errors + ' 条' + (list.length !== all.filter(matches).length ? (' · 当前显示 ' + list.length + ' 条') : '');
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
      detailBits.push('页面：' + (log.page || '') + (log.pageTitle ? (' · ' + log.pageTitle) : ''));
      detailBits.push('用户：' + (log.userId || '未识别'));
      if (metaBits.length) detailBits.push('请求：' + metaBits.join(' · '));
      if (log.error) detailBits.push('错误：' + log.error);
      if (log.detail) detailBits.push('响应摘要：' + log.detail);
      return '<div class="log-row ' + (log.ok ? 'ok' : 'fail') + '" data-id="' + esc(log.id) + '" role="button" tabindex="0">' +
        '<span class="log-dot ' + (log.ok ? 'ok' : 'error') + '"></span>' +
        '<span class="log-main">' +
          '<span class="log-title"><b>' + esc(log.method || 'GET') + '</b> ' + esc(shortUrl(log.url)) +
            ' <em class="log-status ' + statusClass(log) + '">' + esc(statusText(log)) + '</em></span>' +
          '<span class="log-sub">' + esc(fmtTime(log.at)) + ' · ' + esc(KIND_LABEL[log.kind] || log.kind || '其他') +
            ' · ' + esc(log.page || '') + ' · ' + esc(log.duration || 0) + 'ms' + (log.ok ? '' : (' · ' + esc(String(log.error || '请求失败').split('\n')[0].slice(0, 90)))) + '</span>' +
          '<span class="log-detail">' + detailBits.map(esc).join('<br>') +
            '<span class="log-row-actions"><button type="button" class="log-mini" data-copy="' + esc(log.id) + '">复制错误</button>' +
            '<button type="button" class="log-mini danger" data-remove="' + esc(log.id) + '">删除</button></span>' +
          '</span>' +
        '</span>' +
      '</div>';
    }).join('');
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
      Array.prototype.forEach.call(chips.querySelectorAll('.log-chip'), function (x) {
        x.classList.toggle('active', x === btn);
      });
      render();
    });

    var search = $('logSearch');
    if (search) search.addEventListener('input', function () {
      query = String(this.value || '').trim();
      render();
    });

    var rangeEl = $('logRange');
    if (rangeEl) rangeEl.addEventListener('change', function () {
      range = parseInt(this.value, 10) || 100;
      render();
    });

    var list = $('logList');
    if (list) {
      list.addEventListener('click', function (e) {
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
