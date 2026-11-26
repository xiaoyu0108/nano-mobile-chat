/* 聊天记录清理 · 三选一（压缩 / 部分清除 / 全部删除）
   记忆不在这里处理：删聊天记录永远不动长期记忆。 */
(function () {
  'use strict';

  var state = null;
  var root = null;
  var view = 'main';
  var busy = false;

  var CSS =
    '.ncc-bg{position:fixed;inset:0;z-index:100500;background:rgba(0,0,0,.34);display:none;align-items:flex-end;justify-content:center;padding:0}' +
    '.ncc-bg.show{display:flex}' +
    '.ncc-sheet{width:100%;max-width:520px;background:#fff;border-radius:22px 22px 0 0;padding:16px 18px calc(16px + max(var(--nano-safe-bottom,0px), env(safe-area-inset-bottom,0px)));box-shadow:0 -12px 42px rgba(0,0,0,.22);animation:nccUp .22s cubic-bezier(.2,.9,.3,1);box-sizing:border-box}' +
    '@keyframes nccUp{from{transform:translateY(24px);opacity:.5}to{transform:none;opacity:1}}' +
    '.ncc-grab{width:38px;height:4px;border-radius:4px;background:#dedee2;margin:0 auto 14px}' +
    '.ncc-title{font-size:17px;font-weight:700;color:#1b1b1d;letter-spacing:-.2px}' +
    '.ncc-sub{font-size:12.5px;color:#8a8a90;line-height:1.55;margin-top:5px}' +
    '.ncc-list{margin-top:14px;border-top:1px solid #f0f0f2}' +
    '.ncc-row{display:flex;align-items:center;gap:12px;width:100%;padding:14px 2px;border:0;border-bottom:1px solid #f0f0f2;background:none;text-align:left;font:inherit;color:#1b1b1d}' +
    '.ncc-row:active{background:#fafafa}' +
    '.ncc-ic{width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none}' +
    '.ncc-ic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
    '.ncc-ic.gray{background:#f2f2f4;color:#555}' +
    '.ncc-ic.blue{background:#eaf2ff;color:#2f6fd6}' +
    '.ncc-ic.red{background:#ffeded;color:#e5484d}' +
    '.ncc-t{flex:1;min-width:0}' +
    '.ncc-t b{display:block;font-size:15px;font-weight:600}' +
    '.ncc-t small{display:block;font-size:12px;color:#8a8a90;line-height:1.5;margin-top:2px}' +
    '.ncc-chev{color:#c6c6c8;font-size:20px;line-height:1}' +
    '.ncc-actions{display:flex;gap:10px;margin-top:16px}' +
    '.ncc-btn{flex:1;height:44px;border-radius:12px;border:0;font:inherit;font-size:15px;font-weight:600;background:#f2f2f4;color:#1b1b1d}' +
    '.ncc-btn:active{opacity:.75}' +
    '.ncc-btn.primary{background:#1b1b1d;color:#fff}' +
    '.ncc-btn.danger{background:#e5484d;color:#fff}' +
    '.ncc-btn[disabled]{opacity:.45}' +
    '.ncc-fields{display:flex;align-items:center;gap:8px;margin-top:14px}' +
    '.ncc-input{width:100%;height:44px;border:1px solid #e4e4e7;border-radius:12px;background:#fafafa;padding:0 12px;font:inherit;font-size:16px;text-align:center;outline:none;box-sizing:border-box}' +
    '.ncc-input:focus{border-color:#1b1b1d;background:#fff}' +
    '.ncc-dash{color:#a0a0a6;font-size:14px;flex:none}' +
    '.ncc-err{min-height:18px;margin-top:8px;font-size:12px;color:#e5484d}' +
    '.ncc-note{margin-top:10px;padding:10px 12px;border-radius:12px;background:#fafafa;color:#8a8a90;font-size:12px;line-height:1.55}' +
    '.ncc-toast{position:fixed;left:50%;bottom:calc(28px + max(var(--nano-safe-bottom,0px), env(safe-area-inset-bottom,0px)));transform:translateX(-50%);z-index:100501;background:rgba(27,27,29,.92);color:#fff;font-size:13px;line-height:1.4;padding:10px 16px;border-radius:999px;max-width:86vw;text-align:center;opacity:0;pointer-events:none;transition:.2s}' +
    '.ncc-toast.show{opacity:1}';

  function injectCss() {
    if (document.getElementById('ncc-style')) return;
    var st = document.createElement('style');
    st.id = 'ncc-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ensureRoot() {
    injectCss();
    if (root) return root;
    root = document.createElement('div');
    root.className = 'ncc-bg';
    root.id = 'ncc-root';
    root.innerHTML = '<div class="ncc-sheet" role="dialog" aria-modal="true"><div class="ncc-grab"></div><div id="ncc-body"></div></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      if (e.target === root && !busy) close();
    });
    try {
      var vv = window.visualViewport;
      var syncKb = function () {
        if (!root) return;
        var sheet = root.querySelector('.ncc-sheet');
        if (!sheet) return;
        var kb = 0;
        if (vv) kb = Math.max(0, (window.innerHeight || 0) - vv.height - (vv.offsetTop || 0));
        sheet.style.marginBottom = kb > 0 ? (kb + 'px') : '';
      };
      if (vv) {
        vv.addEventListener('resize', syncKb);
        vv.addEventListener('scroll', syncKb);
      }
      window.addEventListener('resize', syncKb);
    } catch (e) {}
    return root;
  }

  function toast(text) {
    var t = document.getElementById('ncc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ncc-toast';
      t.className = 'ncc-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function body() { return document.getElementById('ncc-body'); }

  function renderMain() {
    view = 'main';
    var scope = (state && state.scope) || '聊天';
    body().innerHTML =
      '<div class="ncc-title">' + esc(scope) + '记录</div>' +
      '<div class="ncc-sub">当前共 ' + (state.total || 0) + ' 条。删除记录不会删除已经总结的长期记忆。</div>' +
      '<div class="ncc-list">' +
        '<button class="ncc-row" data-act="compress"><span class="ncc-ic blue"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 15l5-5 4 4 3-3 6 6"/><circle cx="8.2" cy="9.2" r="1.3"/></svg></span><span class="ncc-t"><b>压缩聊天记录</b><small>压缩照片和聊天里的冗余数据，不删除消息</small></span><span class="ncc-chev">›</span></button>' +
        '<button class="ncc-row" data-act="partial"><span class="ncc-ic gray"><svg viewBox="0 0 24 24"><path d="M6 4v16M18 4v16"/><path d="M9 12h6"/><path d="M9 9l-3 3 3 3M15 9l3 3-3 3"/></svg></span><span class="ncc-t"><b>部分清除</b><small>输入起止条数，只删这一段，后面的保留</small></span><span class="ncc-chev">›</span></button>' +
        '<button class="ncc-row" data-act="all"><span class="ncc-ic red"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/></svg></span><span class="ncc-t"><b>全部删除</b><small>删光当前会话的聊天记录，记忆保留</small></span><span class="ncc-chev">›</span></button>' +
      '</div>' +
      '<div class="ncc-actions"><button class="ncc-btn" data-act="cancel">取消</button></div>';
  }

  function renderPartial() {
    view = 'partial';
    body().innerHTML =
      '<div class="ncc-title">部分清除</div>' +
      '<div class="ncc-sub">当前共 ' + (state.total || 0) + ' 条。输入要删除的起止条数：例如 1 - 200，会删掉第 1 到 200 条，第 200 条之后的记录保留。</div>' +
      '<div class="ncc-fields">' +
        '<input class="ncc-input" id="ncc-start" type="number" inputmode="numeric" min="1" max="' + (state.total || 1) + '" value="1" placeholder="起始">' +
        '<span class="ncc-dash">到</span>' +
        '<input class="ncc-input" id="ncc-end" type="number" inputmode="numeric" min="1" max="' + (state.total || 1) + '" value="' + (state.total || '') + '" placeholder="结束">' +
      '</div>' +
      '<div class="ncc-err" id="ncc-err"></div>' +
      '<div class="ncc-note">只删除这个区间内的聊天记录；长期记忆、记忆卡片不受影响。</div>' +
      '<div class="ncc-actions"><button class="ncc-btn" data-act="back">返回</button><button class="ncc-btn danger" data-act="do-partial">删除这一段</button></div>';
    setTimeout(function () { var el = document.getElementById('ncc-end'); if (el) el.focus(); }, 150);
  }

  function renderAllConfirm() {
    view = 'all';
    body().innerHTML =
      '<div class="ncc-title">全部删除</div>' +
      '<div class="ncc-sub">将删除当前会话的全部 ' + (state.total || 0) + ' 条聊天记录，无法恢复。</div>' +
      '<div class="ncc-note">已经总结的长期记忆和记忆卡片会保留，不会因为删记录而消失。</div>' +
      '<div class="ncc-actions"><button class="ncc-btn" data-act="back">返回</button><button class="ncc-btn danger" data-act="do-all">全部删除</button></div>';
  }

  function setBusy(on, text) {
    busy = !!on;
    var sheet = root && root.querySelector('.ncc-sheet');
    if (sheet) sheet.style.opacity = on ? '.65' : '';
    var btns = root ? root.querySelectorAll('button') : [];
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !!on;
    if (on && text) toast(text);
  }

  function resetSheet() {
    if (!root) return;
    var sheet = root.querySelector('.ncc-sheet');
    if (sheet) {
      sheet.style.opacity = '';
      sheet.style.marginBottom = '';
    }
    var btns = root.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = false;
  }

  function close() {
    if (!root) return;
    root.classList.remove('show');
    resetSheet();
    state = null;
    busy = false;
  }

  function open(opts) {
    ensureRoot();
    resetSheet();
    state = {
      scope: (opts && opts.scope) || '聊天',
      total: Math.max(0, parseInt(opts && opts.total, 10) || 0),
      compress: opts && opts.compress,
      partial: opts && opts.partial,
      deleteAll: opts && opts.deleteAll
    };
    renderMain();
    root.classList.add('show');
  }

  async function doCompress() {
    if (busy || !state || typeof state.compress !== 'function') return;
    setBusy(true, '正在压缩照片和聊天数据…');
    try {
      var r = await state.compress();
      r = r || {};
      var bits = [];
      if (r.images) bits.push(r.images + ' 张照片');
      if (r.messages) bits.push(r.messages + ' 条聊天');
      if (!bits.length) {
        toast('没有可压缩的内容');
      } else {
        var saved = Math.max(0, (Number(r.before) || 0) - (Number(r.after) || 0));
        toast('已压缩 ' + bits.join('、') + (saved ? '，节省约 ' + fmtBytes(saved) : ''));
      }
      close();
    } catch (e) {
      toast('压缩失败：' + ((e && e.message) || e));
      setBusy(false);
    }
  }

  async function doPartial() {
    if (busy || !state || typeof state.partial !== 'function') return;
    var sEl = document.getElementById('ncc-start');
    var eEl = document.getElementById('ncc-end');
    var errEl = document.getElementById('ncc-err');
    var start = parseInt(sEl && sEl.value, 10);
    var end = parseInt(eEl && eEl.value, 10);
    var total = state.total || 0;
    if (!isFinite(start) || !isFinite(end)) {
      if (errEl) errEl.textContent = '请输入起始和结束条数';
      return;
    }
    if (start < 1 || end < 1) {
      if (errEl) errEl.textContent = '条数从 1 开始';
      return;
    }
    if (start > end) {
      if (errEl) errEl.textContent = '起始条数不能大于结束条数';
      return;
    }
    if (end > total) {
      if (errEl) errEl.textContent = '结束条数不能超过当前总条数 ' + total;
      return;
    }
    setBusy(true, '正在删除第 ' + start + ' - ' + end + ' 条…');
    try {
      var r = await state.partial(start, end);
      r = r || {};
      toast('已删除 ' + (r.deleted || 0) + ' 条' + (r.remaining ? '，保留 ' + r.remaining + ' 条' : ''));
      close();
    } catch (e) {
      toast('删除失败：' + ((e && e.message) || e));
      setBusy(false);
    }
  }

  async function doAll() {
    if (busy || !state || typeof state.deleteAll !== 'function') return;
    setBusy(true, '正在删除全部聊天记录…');
    try {
      await state.deleteAll();
      toast('已删除全部聊天记录，长期记忆保留');
      close();
    } catch (e) {
      toast('删除失败：' + ((e && e.message) || e));
      setBusy(false);
    }
  }

  document.addEventListener('click', function (e) {
    if (!root || !root.classList.contains('show')) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || !root.contains(el)) return;
    var act = el.getAttribute('data-act');
    if (act === 'cancel') { if (!busy) close(); }
    else if (act === 'back') { if (!busy) renderMain(); }
    else if (act === 'compress') doCompress();
    else if (act === 'partial') { if (!busy) renderPartial(); }
    else if (act === 'all') { if (!busy) renderAllConfirm(); }
    else if (act === 'do-partial') doPartial();
    else if (act === 'do-all') doAll();
  });

  // 压缩聊天本身：只清掉最近 20 条以外的隐藏思维链 / 工具调用元数据，
  // 不动可见正文、翻译、引用和卡片，所以聊天内容不会少。
  function compactMessages(arr, keepRecent) {
    if (!Array.isArray(arr)) return 0;
    var keep = keepRecent == null ? 20 : Math.max(0, keepRecent);
    var stop = Math.max(0, arr.length - keep);
    var changed = 0;
    for (var i = 0; i < stop; i++) {
      var m = arr[i];
      if (!m || typeof m !== 'object') continue;
      var did = false;
      if (m.think) { m.think = null; did = true; }
      if (m.tools) { m.tools = null; did = true; }
      if (did) changed++;
    }
    return changed;
  }

  window.NanoClearChat = { open: open, close: close, compactMessages: compactMessages };
})();
