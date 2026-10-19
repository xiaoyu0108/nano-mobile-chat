// ============================================================
// nano-tool-trace.js — 「工具调用」居中固定小卡片（类系统提示）
//   · 固定在屏幕正中，可折叠 / 展开
//   · 不会自动消失（点右上角 × 才关闭）
//   · 左侧小扳手图标；展开可查看用过的工具、参数与结果
// 用法：
//   var h = NanoToolTrace.begin('weather', {city:'北京'})
//   NanoToolTrace.done(h, '结果') / NanoToolTrace.fail(h, '错误')
//   NanoToolTrace.system('提示')   // 瞬时系统提示（自动消失）
//   NanoToolTrace.clear()
// ============================================================
(function () {
  'use strict';
  if (window.NanoToolTrace) return;

  var CSS_ID = 'nano-tool-trace-css', ROOT_ID = 'nano-tool-trace-root';
  function ensure() {
    if (document.getElementById(ROOT_ID)) return document.getElementById(ROOT_ID);
    if (!document.getElementById(CSS_ID)) {
      var st = document.createElement('style');
      st.id = CSS_ID;
      st.textContent = [
        '#nano-tool-trace-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px}',
        '.ntt-sys{background:rgba(20,22,30,.92);color:#fff;font-size:13px;font-weight:600;line-height:1.5;padding:11px 18px;border-radius:15px;max-width:80%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.35);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:nttIn .22s cubic-bezier(.22,.68,0,1);display:flex;align-items:center;gap:9px}',
        '.ntt-spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:nttSpin .7s linear infinite;flex:none}',
        '.ntt-card{pointer-events:auto;width:auto;max-width:88vw;min-width:190px;background:rgba(242,242,245,.97);border:1px solid rgba(0,0,0,.06);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.16);overflow:hidden;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:nttIn .22s cubic-bezier(.22,.68,0,1)}',
        '.ntt-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none}',
        '.ntt-wrench{width:15px;height:15px;flex:none;color:#5b6472}',
        '.ntt-head .t{flex:1;min-width:0;font-size:12px;font-weight:600;color:#4a4f5a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ntt-head .badge{font-size:10px;font-weight:700;color:#4a5cf0;background:rgba(74,92,240,.12);border-radius:8px;padding:2px 7px}',
        '.ntt-chev{width:14px;height:14px;color:#9a9a9a;transition:transform .2s;flex:none}',
        '.ntt-close{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#9a9a9a;flex:none;font-size:15px;line-height:1}',
        '.ntt-close:active{background:rgba(0,0,0,.08)}',
        '.ntt-card.collapsed .ntt-chev{transform:rotate(-90deg)}',
        '.ntt-card.collapsed .ntt-list{display:none}',
        '.ntt-list{border-top:1px solid rgba(0,0,0,.06);padding:6px 12px 10px;max-height:46vh;overflow:auto;min-width:240px}',
        '.ntt-step{padding:8px 0;border-top:1px solid rgba(0,0,0,.05)}',
        '.ntt-step:first-child{border-top:none}',
        '.ntt-row{display:flex;align-items:center;gap:8px}',
        '.ntt-dot{width:16px;height:16px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:9px;font-weight:800;color:#fff;background:#4a5cf0}',
        '.ntt-step.done .ntt-dot{background:#2ec26b}',
        '.ntt-step.fail .ntt-dot{background:#e05b4b}',
        '.ntt-name{font-size:12px;font-weight:700;color:#22252c}',
        '.ntt-args{font-size:10px;color:#8a8a8a;font-family:ui-monospace,Menlo,monospace;word-break:break-all;margin:4px 0 0 24px;line-height:1.5}',
        '.ntt-res{font-size:11px;color:#333;line-height:1.6;margin:6px 0 0 24px;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto;background:#fff;border-radius:9px;padding:7px 9px}',
        '@keyframes nttSpin{to{transform:rotate(360deg)}}',
        '@keyframes nttIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'
      ].join('');
      document.head.appendChild(st);
    }
    var root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    return root;
  }
  var root = null;
  function el() { if (!root || !document.body.contains(root)) root = ensure(); return root; }

  var WRENCH = '<svg class="ntt-wrench" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6.5a4 4 0 0 0-5.2 5.2l-6 6a1.4 1.4 0 0 0 2 2l6-6a4 4 0 0 0 5.2-5.2l-2.1 2.1-2-2 2.1-2.1z"/></svg>';
  var CHEV = '<svg class="ntt-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  var sysTimer = null;
  function system(text, persist) {
    var r = el();
    var node = document.createElement('div');
    node.className = 'ntt-sys';
    if (!persist) { var sp = document.createElement('span'); sp.className = 'ntt-spin'; node.appendChild(sp); }
    var tx = document.createElement('span'); tx.textContent = String(text || ''); node.appendChild(tx);
    r.appendChild(node);
    if (!persist) { clearTimeout(sysTimer); sysTimer = setTimeout(function () { try { node.remove(); } catch (e) {} }, 2000); }
    return node;
  }

  var card = null, listEl = null, count = 0, activeCount = 0;
  function cardEl() {
    var r = el();
    if (card && document.body.contains(card)) return card;
    card = document.createElement('div');
    card.className = 'ntt-card';
    card.innerHTML = '<div class="ntt-head">' + WRENCH
      + '<span class="t">工具调用</span><span class="badge">0</span>' + CHEV
      + '<span class="ntt-close" role="button" aria-label="关闭">×</span></div>'
      + '<div class="ntt-list"></div>';
    listEl = card.querySelector('.ntt-list');
    card.querySelector('.ntt-head').addEventListener('click', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('ntt-close')) return;
      card.classList.toggle('collapsed');
    });
    card.querySelector('.ntt-close').addEventListener('click', function (e) {
      e.stopPropagation();
      try { card.remove(); } catch (err) {}
      card = null; listEl = null; count = 0;
    });
    r.appendChild(card);
    return card;
  }
  function setBadge() {
    if (!card) return;
    var b = card.querySelector('.badge');
    var running = activeCount > 0;
    if (b) b.textContent = running ? ('进行中 ' + activeCount) : (count + ' 个');
    var t = card.querySelector('.t');
    if (t) t.textContent = running ? '正在调用工具' : ('本次使用了 ' + count + ' 个工具');
  }

  function begin(tool, args) {
    cardEl();
    card.classList.remove('collapsed');
    var step = document.createElement('div');
    step.className = 'ntt-step running';
    step.id = 'ntt' + Date.now() + Math.random().toString(36).slice(2, 4);
    step.innerHTML = '<div class="ntt-row"><span class="ntt-dot">…</span><span class="ntt-name">' + escapeHtml(tool || 'tool') + '</span></div>'
      + '<div class="ntt-args">' + escapeHtml(args ? JSON.stringify(args) : '') + '</div>';
    listEl.appendChild(step);
    count++; activeCount++;
    setBadge();
    return step.id;
  }
  function finish(id, ok, text) {
    if (!card) return;
    var step = id ? card.querySelector('#' + id) : null;
    if (step) {
      step.className = 'ntt-step ' + (ok ? 'done' : 'fail');
      step.querySelector('.ntt-dot').textContent = ok ? '✓' : '✕';
      if (text) {
        var res = document.createElement('div');
        res.className = 'ntt-res';
        res.textContent = String(text).slice(0, 2000);
        step.appendChild(res);
      }
    }
    activeCount = Math.max(0, activeCount - 1);
    setBadge();
    if (activeCount === 0) card.classList.add('collapsed');   // 完成后折叠，但不消失
  }
  function done(id, text) { finish(id, true, text); }
  function fail(id, text) { finish(id, false, text); }
  function clear() {
    clearTimeout(sysTimer);
    activeCount = 0; count = 0;
    try { if (card) card.remove(); } catch (e) {}
    card = null; listEl = null;
    var r = el(); var s = r.querySelector('.ntt-sys'); if (s) s.remove();
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  window.NanoToolTrace = { system: system, begin: begin, done: done, fail: fail, clear: clear };
})();
