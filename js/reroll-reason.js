/* ============================================================
   reroll-reason.js — 统一的「重roll 纠正」弹窗
   点击重roll时先让用户填写上一版的问题（可留空），
   确认后由各页面把原因注入下一次系统提示词。
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoReroll) return;

  var STYLE_ID = 'nanoRerollStyle';
  var current = null;

  var QUICK = [
    { k: '字数不达标', t: '字数不达标，内容太短' },
    { k: 'OOC / 出戏', t: 'OOC，脱离人设' },
    { k: '太油腻', t: '太油腻，有霸总/土味情话' },
    { k: '掉格式', t: '掉格式，没有按要求的格式输出' },
    { k: '太啰嗦', t: '太啰嗦，句子太长' },
    { k: '重复复读', t: '重复复读，绕回同一个话题' }
  ];

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.nrr-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(30,22,26,.34);',
      'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;',
      'opacity:0;transition:opacity .2s ease;}',
      '.nrr-overlay.show{opacity:1;}',
      '.nrr-sheet{width:100%;max-width:480px;background:linear-gradient(180deg,#fffdfb,#fff7f2);',
      'border-radius:26px 26px 0 0;padding:10px 20px calc(20px + max(env(safe-area-inset-bottom,0px),8px));',
      'box-shadow:0 -18px 60px rgba(80,40,55,.18);transform:translateY(24px);transition:transform .24s cubic-bezier(.2,.8,.2,1);',
      'box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;}',
      '.nrr-overlay.show .nrr-sheet{transform:translateY(0);}',
      '.nrr-grab{width:36px;height:4px;border-radius:9px;background:#e8d9d3;margin:2px auto 16px;}',
      '.nrr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px;}',
      '.nrr-title{font-size:18px;font-weight:700;letter-spacing:-.3px;color:#3d2b31;}',
      '.nrr-sub{margin-top:5px;font-size:12.5px;line-height:1.5;color:#a1848c;}',
      '.nrr-x{width:30px;height:30px;border:0;border-radius:50%;background:#f4e7e2;color:#a1848c;font-size:17px;line-height:1;flex:none;}',
      '.nrr-chips{display:flex;gap:8px;overflow-x:auto;padding:12px 0 10px;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
      '.nrr-chips::-webkit-scrollbar{display:none;}',
      '.nrr-chip{flex:none;border:1px solid #efdcd5;background:#fff;color:#8b6470;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:600;}',
      '.nrr-chip:active{transform:scale(.95);}',
      '.nrr-input{width:100%;height:104px;resize:none;border:1px solid #efddd7;border-radius:16px;background:#fff;',
      'padding:12px 13px;font-size:14px;line-height:1.55;color:#3d2b31;outline:none;box-sizing:border-box;font-family:inherit;}',
      '.nrr-input::placeholder{color:#c2aaae;}',
      '.nrr-input:focus{border-color:#dfa6b2;box-shadow:0 0 0 3px rgba(223,166,178,.14);}',
      '.nrr-foot{display:flex;gap:10px;margin-top:14px;}',
      '.nrr-btn{flex:1;height:46px;border:0;border-radius:15px;font-size:15px;font-weight:700;font-family:inherit;}',
      '.nrr-cancel{background:#f4e9e5;color:#8d6a73;}',
      '.nrr-go{background:linear-gradient(135deg,#e69aa8,#cf7e97);color:#fff;box-shadow:0 8px 20px rgba(207,126,151,.28);}',
      '.nrr-go:active,.nrr-cancel:active{transform:scale(.98);}',
      'html.nrr-lock,html.nrr-lock body{overflow:hidden;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function closeCurrent(val) {
    var c = current;
    current = null;
    if (!c) return;
    try { document.documentElement.classList.remove('nrr-lock'); } catch (e) {}
    try { c.overlay.classList.remove('show'); } catch (e) {}
    setTimeout(function () { try { c.overlay.remove(); } catch (e) {} }, 240);
    try { c.resolve(val); } catch (e) {}
  }

  function ask(opts) {
    opts = opts || {};
    injectStyle();
    if (current) closeCurrent(null);
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'nrr-overlay';
      overlay.innerHTML =
        '<div class="nrr-sheet" role="dialog" aria-modal="true">' +
          '<div class="nrr-grab"></div>' +
          '<div class="nrr-head">' +
            '<div><div class="nrr-title">' + esc(opts.title || '重roll 纠正') + '</div>' +
            '<div class="nrr-sub">' + esc(opts.subtitle || '上一版哪里不对？可以留空直接重写') + '</div></div>' +
            '<button class="nrr-x" type="button" data-nrr="close" aria-label="关闭">&times;</button>' +
          '</div>' +
          '<div class="nrr-chips">' +
            QUICK.map(function (q) { return '<button class="nrr-chip" type="button" data-nrr-chip="' + esc(q.t) + '">' + esc(q.k) + '</button>'; }).join('') +
          '</div>' +
          '<textarea class="nrr-input" maxlength="300" placeholder="' + esc(opts.placeholder || '例如：字数不达标、OOC、太油腻、掉格式、复读…') + '"></textarea>' +
          '<div class="nrr-foot">' +
            '<button class="nrr-btn nrr-cancel" type="button" data-nrr="cancel">取消</button>' +
            '<button class="nrr-btn nrr-go" type="button" data-nrr="go">重新生成</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      try { document.documentElement.classList.add('nrr-lock'); } catch (e) {}
      var ta = overlay.querySelector('.nrr-input');
      current = { overlay: overlay, resolve: resolve };
      requestAnimationFrame(function () { overlay.classList.add('show'); });

      function finish(v) { closeCurrent(v); }

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { finish(null); return; }
        var chip = e.target.closest('[data-nrr-chip]');
        if (chip) {
          var text = chip.getAttribute('data-nrr-chip') || '';
          var cur = String(ta.value || '').trim();
          if (!cur) ta.value = text;
          else if (cur.indexOf(text) === -1) ta.value = cur.replace(/[，,。\s]*$/, '') + '，' + text;
          try { ta.focus(); } catch (err) {}
          return;
        }
        var btn = e.target.closest('[data-nrr]');
        if (!btn) return;
        var act = btn.getAttribute('data-nrr');
        if (act === 'go') finish(String(ta.value || '').trim());
        else finish(null);
      });

      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); finish(String(ta.value || '').trim()); }
      });
    });
  }

  function block(reason) {
    var r = String(reason || '').trim();
    if (!r) return '';
    return '\n\n【本次重roll · 必须修正的问题（优先级最高）】\n' +
      '用户认为上一版回复存在这些问题：' + r + '\n' +
      '请从用户最后一条消息开始，完整重写这一轮的全部回复，不要接着上一版继续写，也不要只补后半段。\n' +
      '严格避免上述问题：字数不够就写够；OOC 就回到人设和世界书；油腻就删掉所有霸总、土味、索抱索亲话术；掉格式就严格按格式输出；啰嗦就收紧句子；复读就换新的信息推进话题。' +
      '不要解释你在修改，不要提起“重roll/上一版/用户要求”，直接输出修正后的完整内容。';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.NanoReroll = {
    ask: ask,
    block: block,
    close: function () { closeCurrent(null); }
  };
})();
