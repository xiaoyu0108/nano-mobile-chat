/* ============================================================
   nano-heart-builtin.js — 心声内置美化模板
   ------------------------------------------------------------
   这里的内置模板会在心声初始化 / 心声美化页打开时写入
   NanoVoiceDB/templates（只补缺失，不覆盖用户已改过的同名预设）。
   ============================================================ */
(function () {
  'use strict';

  var PINK_DOTS_CSS = `/* nano-heart-pink-dots:v2
   ============================================================
   心声 · 粉色波点便签（内置）
   ------------------------------------------------------------
   超级淡的粉色波点便签卡片，顶部中间透明胶带；
   卡片内只保留左对齐的头像 / 昵称，下面直接是心声。
   收件人、时间、此刻印象、小标题等默认隐藏，需要时删掉对应
   display:none 那一行即可。

   ---- 想怎么 DIY 都行（都在本模板里改）----
   1) 隐藏 / 显示某部分：删掉对应 display:none!important 即可。
      .iv-caption        “发送人”小字
      .iv-unread         未读红点
      .iv-meta           收件人 / 时间
      .iv-subject        此刻 · 印象
      .iv-content-label  “心声 · 手记”小标题
   2) 移动头像：.iv-avatar{ position:absolute; left:10px; top:40px; }
      .iv-sender 已是 position:relative；不要用 position:fixed。
   3) 头像 / 昵称换位置或居右：
      .iv-sender{ flex-direction:row-reverse; }
      .iv-sender-info{ margin-left:0; margin-right:12px; text-align:right; }
   4) 换胶带位置 / 大小 / 角度：改 .nano-voice-modal::before 的
      left / top / width / height / transform。
   5) 加新板块（评论区、穿搭等）：在文件末尾的 @heart-sections
      注释块里，每行写「[板块名] 生成要求」。
   6) 加贴纸 / 文字：用 .iv-deco-top / .iv-deco-bottom 的 ::before / ::after，
      或给 .iv-deco 加 .on 后放图片；也可以写 @js 脚本块（写法见默认模板）。
   注意：不要删 JS 写入数据的 id / 类名，也不要写 position:fixed。
   ============================================================ */
.nano-voice-modal {
  --iv-avatar-size: 46px;
  --iv-avatar-radius: 14px;
  position: relative;
  width: min(372px, calc(100vw - 32px));
  max-height: none;
  overflow: visible;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  background-color: #fff8fb;
  background-image:
    radial-gradient(circle at center, rgba(236, 182, 201, 0.38) 1.8px, transparent 2.3px),
    linear-gradient(180deg, #fffafc 0%, #fff2f7 100%);
  background-size: 18px 18px, 100% 100%;
  background-repeat: repeat, no-repeat;
  border: 1px solid #f7dfe7;
  border-radius: 14px 14px 16px 10px;
  box-shadow: 0 20px 46px rgba(187, 132, 152, 0.16), 0 2px 6px rgba(187, 132, 152, 0.06);
  color: #6b5560;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* 顶部中间的透明胶带 */
.nano-voice-modal::before {
  content: "";
  position: absolute;
  z-index: 20;
  top: -12px;
  right: auto;
  left: 50%;
  width: 94px;
  height: 24px;
  transform: translateX(-50%) rotate(-2deg);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(244, 240, 244, 0.42)),
    repeating-linear-gradient(105deg, rgba(255, 255, 255, 0.42) 0 7px, rgba(255, 255, 255, 0.14) 7px 14px);
  border: 1px solid rgba(255, 255, 255, 0.88);
  border-radius: 1px;
  box-shadow: 0 1px 4px rgba(160, 120, 137, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  -webkit-backdrop-filter: blur(1.5px) saturate(120%);
  backdrop-filter: blur(1.5px) saturate(120%);
  opacity: 0.96;
  pointer-events: none;
}

/* 纸面柔光 */
.nano-voice-modal::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  background: radial-gradient(circle at 82% 12%, rgba(255, 255, 255, 0.55), transparent 38%);
  pointer-events: none;
}

/* 头像 + 昵称：左上角，左对齐 */
.nano-voice-modal .iv-header {
  position: relative;
  z-index: 2;
  padding: 32px 22px 6px;
  background: transparent;
  border-bottom: 0;
  border-radius: 0;
  text-align: left;
}
.nano-voice-modal .iv-sender {
  flex-direction: row;
  align-items: center;
  text-align: left;
}
.nano-voice-modal .iv-avatar {
  width: var(--iv-avatar-size, 46px);
  height: var(--iv-avatar-size, 46px);
  flex: 0 0 var(--iv-avatar-size, 46px);
  border-radius: var(--iv-avatar-radius, 14px);
  border: 2px solid rgba(255, 255, 255, 0.92);
  background: #ffe7ef;
  box-shadow: 0 3px 9px rgba(187, 132, 152, 0.16);
}
.nano-voice-modal .iv-avatar img { border-radius: inherit; }
.nano-voice-modal .iv-avatar-fallback {
  color: #c68ba1;
  font-size: 17px;
  font-weight: 700;
}
.nano-voice-modal .iv-sender-info {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 0 0 12px;
  text-align: left;
}
.nano-voice-modal .iv-name {
  color: #855a6b;
  font-family: "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", sans-serif;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.4px;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* 只留下头像、昵称和心声 */
.nano-voice-modal .iv-caption,
.nano-voice-modal .iv-unread,
.nano-voice-modal .iv-meta,
.nano-voice-modal .iv-subject,
.nano-voice-modal .iv-content-label { display: none !important; }

.nano-voice-modal .iv-content {
  position: relative;
  z-index: 2;
  min-height: 0;
  padding: 4px 22px 26px;
  background: transparent;
  border-radius: 0 0 16px 10px;
}
.nano-voice-modal .iv-thought {
  color: #6d5560;
  font-family: "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 15.5px;
  font-weight: 400;
  font-style: normal;
  line-height: 1.85;
  letter-spacing: 0.25px;
  padding: 0;
  max-height: 48vh;
  transform: none;
  text-shadow: none;
  white-space: pre-wrap;
  word-break: break-word;
}
.nano-voice-modal .iv-thought::after { display: none !important; content: none !important; }

/* 附加文字 / 附加板块（默认空则完全不出现） */
.nano-voice-modal .iv-extra-text {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px dashed #f0d7e1;
  color: #a17f8d;
  font-size: 12.5px;
  line-height: 1.7;
}
.nano-voice-modal .iv-section {
  padding: 12px 22px;
  border-top: 1px dashed #f0d3df;
  background: rgba(255, 255, 255, 0.32);
}
.nano-voice-modal .iv-section-title {
  color: #b07e91;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.4px;
  margin-bottom: 6px;
}
.nano-voice-modal .iv-section-body {
  color: #6d5560;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.nano-voice-modal.has-sections .iv-content { border-radius: 0; }
.nano-voice-modal.has-sections .iv-sections {
  border-radius: 0 0 16px 10px;
  overflow: hidden;
}

/* ============================================================
   附加板块定义区
   想新增板块时，在下面注释块里每行写：[板块名] 生成要求
   例如：[评论区] 以粉丝视角写 5 条评论，每条 20 字
   现在为空 = 不生成任何附加板块。
   ============================================================ */
/* @heart-sections
*/`;

  var X_POST_JS = `
(function(){
  var modal = document.querySelector('.nano-voice-modal');
  if (!modal) return;
  modal.classList.add('x-mode');
  var doc = document;
  function byId(a, b) { return doc.getElementById(a) || (b ? doc.getElementById(b) : null); }
  function mk(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : '&quot;';
    });
  }
  function hash(s) {
    var h = 2166136261;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 10000) {
      var v = (n / 10000).toFixed(1);
      if (v === '5.2') v = '5.3';
      return v + '万';
    }
    return String(n);
  }
  function handleFor(name) {
    var raw = String(name || '').trim();
    var py = '';
    if (window.pinyinPro) {
      try { py = window.pinyinPro.pinyin(raw, { toneType: 'none', type: 'array' }).join(''); } catch (e) {}
    }
    if (!py) py = raw.toLowerCase();
    py = py.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!py) py = 'user' + (hash(raw) % 9973);
    return '@' + py.slice(0, 15);
  }
  var waiting = false;
  function ensurePinyin(cb) {
    if (window.pinyinPro) { cb(); return; }
    window.__nanoXPinyinQueue = window.__nanoXPinyinQueue || [];
    if (cb) window.__nanoXPinyinQueue.push(cb);
    if (waiting || window.__nanoXPinyinLoading) return;
    window.__nanoXPinyinLoading = true;
    waiting = true;
    var s = doc.createElement('script');
    s.src = '../js/pinyin-pro.min.js';
    s.onload = function () {
      window.__nanoXPinyinLoading = false;
      var q = window.__nanoXPinyinQueue || [];
      window.__nanoXPinyinQueue = [];
      for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) {} }
    };
    s.onerror = function () { window.__nanoXPinyinLoading = false; };
    doc.head.appendChild(s);
  }

  var senderEl = byId('ivSender', 'hsSender') || modal.querySelector('.iv-name');
  var thoughtEl = byId('ivThought', 'hsThought') || modal.querySelector('.iv-thought');
  var sectionsEl = byId('ivSections', 'hsSections') || modal.querySelector('.iv-sections');
  var timeEl = byId('ivTime', 'hsTime');
  var avatarEl = byId('ivAvatar', 'hsAvatar') || modal.querySelector('.iv-avatar img');
  var avatarFallback = byId('ivAvatarFallback', 'hsAvatarFallback');
  var info = senderEl ? senderEl.parentNode : null;
  var senderRow = info ? info.parentNode : null;
  var content = modal.querySelector('.iv-content');

  // ---- 顶栏：返回 / 贴文 / X / 更多 ----
  if (!modal.querySelector('.x-topnav')) {
    var nav = mk('div', 'x-topnav');
    var back = mk('button', 'x-nav-btn x-nav-back');
    back.type = 'button';
    back.setAttribute('aria-label', '返回');
    back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg>';
    var navTitle = mk('div', 'x-nav-title', '贴文');
    var right = mk('div', 'x-nav-right');
    var logo = mk('span', 'x-logo');
    logo.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
    var more = mk('button', 'x-nav-btn x-nav-more');
    more.type = 'button';
    more.setAttribute('aria-label', '更多');
    more.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
    right.appendChild(logo);
    right.appendChild(more);
    nav.appendChild(back);
    nav.appendChild(navTitle);
    nav.appendChild(right);
    if (modal.firstChild) modal.insertBefore(nav, modal.firstChild); else modal.appendChild(nav);
  }

  // ---- 作者行：认证标 + @拼音 + 关注 ----
  var badge = null;
  var handleEl = null;
  var followBtn = null;
  if (info && senderEl) {
    badge = info.querySelector('.x-badge');
    if (!badge) {
      badge = mk('span', 'x-badge');
      badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1d9bf0" d="M12 2.2l2.1 2 2.9-.4 1.3 2.6 2.6 1.3-.4 2.9 2 2.1-2 2.1.4 2.9-2.6 1.3-1.3 2.6-2.9-.4-2.1 2-2.1-2-2.9.4-1.3-2.6L2.1 19l.4-2.9-2-2.1 2-2.1L2.1 9l2.6-1.3L6 5.1l2.9.4L12 2.2z"/><path fill="#fff" d="M10.6 15.4l-3-3 1.3-1.3 1.7 1.7 4.1-4.1 1.3 1.3-5.4 5.4z"/></svg>';
      senderEl.parentNode.insertBefore(badge, senderEl.nextSibling);
    }
    handleEl = info.querySelector('.x-handle');
    if (!handleEl) {
      handleEl = mk('span', 'x-handle', '@');
      if (badge && badge.parentNode) badge.parentNode.insertBefore(handleEl, badge.nextSibling);
      else senderEl.parentNode.insertBefore(handleEl, senderEl.nextSibling);
    }
  }
  if (senderRow && !senderRow.querySelector('.x-follow')) {
    followBtn = mk('button', 'x-follow', '关注');
    followBtn.type = 'button';
    senderRow.appendChild(followBtn);
  } else if (senderRow) {
    followBtn = senderRow.querySelector('.x-follow');
  }

  // ---- 正文下方：时间 / 数据 / 操作栏 ----
  var metaEl = content ? content.querySelector('.x-meta') : null;
  if (content && !metaEl) {
    metaEl = mk('div', 'x-meta');
    content.appendChild(metaEl);
  }
  var actionsEl = content ? content.querySelector('.x-actions') : null;
  if (content && !actionsEl) {
    actionsEl = mk('div', 'x-actions');
    actionsEl.innerHTML =
      '<button class="x-act" data-act="reply" type="button" aria-label="回复"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 9.6 9.6 0 0 1-4.2-1L3 20l1.2-4.4A8.2 8.2 0 0 1 3 11.5 8.4 8.4 0 0 1 11.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg><span class="x-c-reply">0</span></button>' +
      '<button class="x-act" data-act="repost" type="button" aria-label="转发"><svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span class="x-c-repost">0</span></button>' +
      '<button class="x-act" data-act="like" type="button" aria-label="喜欢"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/></svg><span class="x-c-like">0</span></button>' +
      '<button class="x-act" data-act="save" type="button" aria-label="收藏"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span class="x-c-save">0</span></button>' +
      '<button class="x-act" data-act="share" type="button" aria-label="分享"><svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M12 16V3"/><path d="M7 8l5-5 5 5"/></svg></button>';
    content.appendChild(actionsEl);
  }

  // ---- 底部：假输入框 + X 底部导航 ----
  if (!modal.querySelector('.x-bottom-dock')) {
    var dock = mk('div', 'x-bottom-dock');
    var replyBar = mk('div', 'x-reply-bar');
    var fakeInput = mk('div', 'x-rb-input', '发布你的回复');
    replyBar.appendChild(fakeInput);
    dock.appendChild(replyBar);
    var bottomNav = mk('div', 'x-bottom-nav');
    bottomNav.innerHTML =
      '<button class="x-nav-item on" type="button" data-nav="home" aria-label="主页"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3l9 7.5V21a1 1 0 0 1-1 1h-5.5v-6.5h-5V22H4a1 1 0 0 1-1-1V10.5L12 3z"/></svg></button>' +
      '<button class="x-nav-item" type="button" data-nav="search" aria-label="搜索"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg></button>' +
      '<button class="x-nav-item x-nav-x" type="button" data-nav="x" aria-label="X"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></button>' +
      '<button class="x-nav-item" type="button" data-nav="notifications" aria-label="通知"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a6 6 0 0 0-6 6v4.6L4.2 16.4A1 1 0 0 0 5 18h14a1 1 0 0 0 .8-1.6L18 12.6V8a6 6 0 0 0-6-6zm0 20a3 3 0 0 0 2.8-2H9.2a3 3 0 0 0 2.8 2z"/></svg></button>' +
      '<button class="x-nav-item" type="button" data-nav="messages" aria-label="消息"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v.5l-9 5.3-9-5.3V6zm0 2.9V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8.9l-9 5.3-9-5.3z"/></svg></button>';
    dock.appendChild(bottomNav);
    modal.appendChild(dock);
  }

  function parsePerson(seg) {
    seg = String(seg == null ? '' : seg).trim();
    if (!seg) return null;
    var fields = seg.split('|');
    var name = '';
    var handle = '';
    var text = '';
    if (fields.length >= 3) {
      name = fields[0].trim();
      handle = fields[1].trim();
      text = fields.slice(2).join('|').trim();
    } else if (fields.length === 2) {
      name = fields[0].trim();
      text = fields[1].trim();
    } else {
      text = seg;
    }
    if (!text) return null;
    if (!name) name = '匿名网友';
    handle = handle.replace(/^@+/, '');
    return { name: name, handle: handle, text: text };
  }
  function demoThreads() {
    return [
      { name: '半糖去冰', handle: 'bantangqubing', text: '这句话像是说给某个人听的，偏偏还装得若无其事。', time: '2小时', reply: { name: '夜航船', handle: 'yehangchuan', text: '嘴硬的人最好懂，也最难哄。' } },
      { name: '路过一只猫', handle: 'luguoyizhimao', text: '看到这里突然安静了，原来他也会反复想这些。', time: '4小时', reply: { name: '今天也没睡', handle: 'jintianyemeishui', text: '越平静的句子越藏不住。' } }
    ];
  }
  function parseThreads(raw) {
    var text = String(raw || '').replace(/（/g, '(').replace(/）/g, ')');
    if (!text) return [];
    if (text.indexOf('(示例)') === 0) return demoThreads();
    var lines = text.split(String.fromCharCode(10));
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '').trim();
      if (!line) continue;
      line = line.replace(/^[0-9]+[.、)]/, '').replace(/^[-*•]/, '').trim();
      if (!line) continue;
      if (/^(评论区|格式|要求|说明|例如)/.test(line)) continue;
      var parts = line.split('||');
      var main = parsePerson(parts[0]);
      if (!main) continue;
      var reply = parts[1] ? parsePerson(parts[1]) : null;
      out.push({ name: main.name, handle: main.handle, text: main.text, reply: reply, time: ['2小时', '4小时', '昨天', '3天'][out.length % 4] });
      if (out.length >= 2) break;
    }
    return out;
  }
  function replyNode(th, opts) {
    opts = opts || {};
    var row = mk('div', 'x-reply' + (opts.reply ? ' x-reply-is-reply' : ''));
    var avCol = mk('div', 'x-av-col');
    var av = mk('div', 'x-reply-av', String(th.name || '匿').slice(0, 1));
    avCol.appendChild(av);
    row.appendChild(avCol);
    var main = mk('div', 'x-reply-main');
    var head = mk('div', 'x-reply-head');
    head.appendChild(mk('span', 'x-reply-name', th.name || '匿名网友'));
    var hd = mk('span', 'x-reply-handle');
    if (th.handle) {
      hd.textContent = '@' + th.handle.replace(/^@+/, '');
      hd.setAttribute('data-keep', '1');
    } else {
      hd.textContent = handleFor(th.name);
      hd.setAttribute('data-name', th.name || '');
    }
    head.appendChild(hd);
    main.appendChild(head);
    if (opts.replyTo) main.appendChild(mk('div', 'x-reply-to', '回复 @' + String(opts.replyTo).replace(/^@+/, '')));
    main.appendChild(mk('div', 'x-reply-text', th.text || ''));
    var meta = mk('div', 'x-reply-meta');
    meta.appendChild(mk('span', '', th.time || '刚刚'));
    var replyMark = mk('span', 'x-reply-like');
    replyMark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 9.6 9.6 0 0 1-4.2-1L3 20l1.2-4.4A8.2 8.2 0 0 1 3 11.5 8.4 8.4 0 0 1 11.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg><span>回复</span>';
    meta.appendChild(replyMark);
    var like = mk('span', 'x-reply-like');
    like.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/></svg><span>' + (3 + (hash(th.name + th.text) % 88)) + '</span>';
    meta.appendChild(like);
    main.appendChild(meta);
    row.appendChild(main);
    return row;
  }

  var lastSender = '';
  var lastFollowing = false;
  var decorating = false;
  function decorate() {
    if (decorating) return;
    decorating = true;
    try {
      var sender = senderEl ? String(senderEl.textContent || '').trim() : '';
      var thought = thoughtEl ? String(thoughtEl.textContent || '').trim() : '';
      var time = timeEl ? String(timeEl.textContent || '').trim() : '';
      if (sender !== lastSender) {
        lastSender = sender;
        lastFollowing = false;
        if (followBtn) { followBtn.classList.remove('following'); followBtn.textContent = '关注'; }
      }
      if (handleEl) {
        var nextHandle = handleFor(sender);
        if (handleEl.textContent !== nextHandle) handleEl.textContent = nextHandle;
      }
      if (avatarFallback) {
        var initial = String(sender || '?').slice(0, 1);
        if (avatarFallback.textContent !== initial) avatarFallback.textContent = initial;
      }
      var seed = hash(sender + '|' + thought + '|' + time);
      var views = 6000 + (seed % 86000);
      if (views === 52000) views += 137;
      var likes = 120 + ((seed >>> 7) % 2600);
      if (likes === 1123) likes += 17;
      var reposts = 18 + ((seed >>> 13) % 280);
      if (reposts === 124) reposts += 9;
      var saves = 24 + ((seed >>> 19) % 520);
      if (saves === 917) saves += 11;

      var threads = [];
      if (sectionsEl) {
        var secs = sectionsEl.querySelectorAll('.iv-section');
        var sec = null;
        for (var i = 0; i < secs.length; i++) {
          var st = secs[i].querySelector('.iv-section-title');
          if (st && /评论|回复/.test(st.textContent || '')) { sec = secs[i]; break; }
        }
        if (sec) {
          sec.classList.add('x-comment-section');
          var bodyEl = sec.querySelector('.iv-section-body');
          var raw = bodyEl ? String(bodyEl.textContent || '') : '';
          var sig = raw + '|' + sender + '|' + thought;
          if (sec.__xSig !== sig) {
            sec.__xSig = sig;
            threads = parseThreads(raw);
            var box = sec.querySelector('.x-replies');
            if (!box) { box = mk('div', 'x-replies'); sec.appendChild(box); }
            box.innerHTML = '';
            for (var j = 0; j < threads.length; j++) {
              var thread = mk('div', 'x-thread');
              thread.appendChild(replyNode(threads[j], {}));
              if (threads[j].reply) thread.appendChild(replyNode(threads[j].reply, { reply: true, replyTo: threads[j].handle || threads[j].name }));
              box.appendChild(thread);
            }
            var title = sec.querySelector('.iv-section-title');
            if (title) title.setAttribute('data-count', String(threads.length));
          } else {
            threads = sec.__xThreads || [];
          }
          sec.__xThreads = threads;
        }
      }

      if (metaEl) {
        var t = time;
        if (!t || t === '刚刚' || t.length > 12) {
          var now = new Date();
          t = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        }
        var d = new Date();
        d.setDate(d.getDate() - (1 + (seed % 11)));
        var meta = t + ' · ' + d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' · ' + fmt(views) + ' 次查看';
        if (metaEl.textContent !== meta) metaEl.textContent = meta;
      }
      if (actionsEl) {
        var likeBtn = actionsEl.querySelector('[data-act="like"]');
        var saveBtn = actionsEl.querySelector('[data-act="save"]');
        var liked = !!(likeBtn && likeBtn.classList.contains('liked'));
        var saved = !!(saveBtn && saveBtn.classList.contains('saved'));
        var setText = function (sel, val) {
          var n = actionsEl.querySelector(sel);
          if (n && n.textContent !== String(val)) n.textContent = String(val);
        };
        setText('.x-c-reply', threads.length || 0);
        setText('.x-c-repost', fmt(reposts));
        setText('.x-c-like', fmt(liked ? likes + 1 : likes));
        setText('.x-c-save', fmt(saved ? saves + 1 : saves));
        actionsEl.__likes = likes;
        actionsEl.__saves = saves;
      }
    } finally {
      decorating = false;
    }
  }

  on(modal, 'click', function (e) {
    var back = e.target.closest('.x-nav-back');
    if (back) {
      var exit = byId('ivExit');
      if (exit) { try { exit.click(); } catch (e2) {} }
      else {
        var layer = byId('nanoVoiceLayer');
        if (layer) layer.classList.remove('active');
      }
      return;
    }
    var f = e.target.closest('.x-follow');
    if (f) {
      lastFollowing = !lastFollowing;
      f.classList.toggle('following', lastFollowing);
      f.textContent = lastFollowing ? '已关注' : '关注';
      try { e.stopPropagation(); } catch (e2) {}
      return;
    }
    var navItem = e.target.closest('.x-nav-item');
    if (navItem) {
      if (navItem.getAttribute('data-nav') === 'home' || navItem.getAttribute('data-nav') === 'x') {
        try { modal.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e2) { modal.scrollTop = 0; }
      }
      return;
    }
    var act = e.target.closest('.x-act');
    if (!act) return;
    var kind = act.getAttribute('data-act');
    if (kind === 'like') {
      var likes = Number(actionsEl && actionsEl.__likes) || 0;
      var liked = act.classList.toggle('liked');
      var span = act.querySelector('.x-c-like');
      if (span) span.textContent = fmt(liked ? likes + 1 : likes);
    } else if (kind === 'save') {
      var saves = Number(actionsEl && actionsEl.__saves) || 0;
      var saved = act.classList.toggle('saved');
      var span2 = act.querySelector('.x-c-save');
      if (span2) span2.textContent = fmt(saved ? saves + 1 : saves);
    } else if (kind === 'reply') {
      if (sectionsEl) {
        try { sectionsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e2) { sectionsEl.scrollIntoView(); }
      }
    }
  });

  observe(modal, function () {
    clearTimeout(decorate.__t);
    decorate.__t = setTimeout(decorate, 60);
  }, { childList: true, subtree: true, characterData: true });

  function applyGuestHandles() {
    if (!sectionsEl) return;
    var nodes = sectionsEl.querySelectorAll('.x-reply-handle[data-name]');
    for (var i = 0; i < nodes.length; i++) {
      var nm = nodes[i].getAttribute('data-name') || '';
      var h = handleFor(nm);
      if (nodes[i].textContent !== h) nodes[i].textContent = h;
    }
  }
  ensurePinyin(function () { decorate(); applyGuestHandles(); });
  decorate();

  onCleanup(function () {
    modal.classList.remove('x-mode');
    var kill = modal.querySelectorAll('.x-topnav,.x-badge,.x-handle,.x-follow,.x-meta,.x-actions,.x-bottom-dock');
    for (var i = 0; i < kill.length; i++) { try { kill[i].remove(); } catch (e) {} }
    var secs = modal.querySelectorAll('.x-comment-section');
    for (var j = 0; j < secs.length; j++) {
      secs[j].classList.remove('x-comment-section');
      try { secs[j].__xSig = ''; secs[j].__xThreads = null; } catch (e) {}
      var t = secs[j].querySelector('.iv-section-title');
      if (t) t.removeAttribute('data-count');
      var r = secs[j].querySelector('.x-replies');
      if (r) r.remove();
    }
  });
})();
`;
  var X_POST_CSS = `/* nano-heart-x-post:v4
   ============================================================
   心声 · X 帖子风（内置）
   ------------------------------------------------------------
   顶栏：返回 / 贴文 / X / 更多
   作者：昵称 + 认证标 + @拼音 + 关注
   正文：心声本身，不额外加“此刻印象”那一行
   互动：回复 / 转发 / 喜欢 / 收藏 / 分享
   评论：2 组，一组一条评论 + 一条回复，竖向线连接
   底栏：假输入框 + 主页 / 搜索 / X / 通知 / 消息
   ============================================================ */
.nano-voice-modal {
  --iv-avatar-size: 44px;
  --iv-avatar-radius: 50%;
  width: min(430px, calc(100vw - 10px));
  max-height: min(760px, calc(100vh - 90px));
  padding: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  background: #000;
  background-color: #000;
  color: #e7e9ea;
  border: 0;
  border-radius: 18px;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.62);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.nano-voice-modal::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
.nano-voice-modal::before,
.nano-voice-modal::after { display: none !important; content: none !important; }
.nano-voice-modal .iv-deco { display: none !important; }

/* ---------- 顶栏 ---------- */
.nano-voice-modal .x-topnav {
  position: sticky;
  top: 0;
  z-index: 40;
  height: 50px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  background: rgba(0, 0, 0, 0.96);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.nano-voice-modal .x-nav-btn {
  width: 38px;
  height: 38px;
  border: 0;
  padding: 0;
  border-radius: 50%;
  background: none;
  color: #e7e9ea;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.nano-voice-modal .x-nav-btn:active { background: #16181c; }
.nano-voice-modal .x-nav-btn svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.nano-voice-modal .x-nav-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  color: #e7e9ea;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0;
  white-space: nowrap;
}
.nano-voice-modal .x-nav-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.nano-voice-modal .x-logo {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e7e9ea;
}
.nano-voice-modal .x-logo svg { width: 19px; height: 19px; fill: currentColor; }
.nano-voice-modal .x-nav-more svg {
  width: 21px;
  height: 21px;
  fill: currentColor;
  stroke: none;
}

/* ---------- 作者行 ---------- */
.nano-voice-modal .iv-header {
  position: relative;
  z-index: 2;
  padding: 10px 16px 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  text-align: left;
}
.nano-voice-modal .iv-sender { align-items: flex-start; gap: 0; }
.nano-voice-modal .iv-avatar {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border: 0;
  border-radius: 50%;
  background: #333639;
  box-shadow: none;
}
.nano-voice-modal .iv-avatar img { border-radius: 50%; }
.nano-voice-modal .iv-avatar img[hidden] { display: none !important; }
.nano-voice-modal .iv-avatar-fallback { color: #fff; font-size: 17px; font-weight: 700; }
.nano-voice-modal .iv-sender-info {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0 0 0 10px;
  text-align: left;
}
.nano-voice-modal .iv-name {
  display: inline-block;
  max-width: calc(100% - 22px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
  color: #e7e9ea;
  font-size: 15px;
  line-height: 1.3;
  font-weight: 800;
  letter-spacing: 0;
}
.nano-voice-modal .iv-caption,
.nano-voice-modal .iv-unread,
.nano-voice-modal .iv-meta { display: none !important; }
.nano-voice-modal .iv-subject { display: none !important; }

.nano-voice-modal .x-badge { display: inline-flex; width: 16px; height: 16px; margin-left: 3px; vertical-align: -3px; }
.nano-voice-modal .x-badge svg { width: 16px; height: 16px; display: block; }
.nano-voice-modal .x-handle {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
  color: #71767b;
  font-size: 14px;
  line-height: 1.3;
  font-weight: 400;
}
.nano-voice-modal .x-follow {
  flex: 0 0 auto;
  margin-left: 10px;
  margin-top: 0;
  height: 31px;
  padding: 0 15px;
  border: 1px solid #536471;
  border-radius: 999px;
  background: #eff3f4;
  color: #0f1419;
  font-size: 13px;
  font-weight: 800;
  line-height: 29px;
  cursor: pointer;
  transition: transform 0.12s, background 0.12s;
}
.nano-voice-modal .x-follow.following { background: transparent; color: #e7e9ea; border-color: #536471; }
.nano-voice-modal .x-follow:active { transform: scale(0.96); }

/* ---------- 正文 ---------- */
.nano-voice-modal .iv-content {
  position: relative;
  z-index: 2;
  min-height: 0;
  padding: 10px 16px 0;
  background: transparent;
  border-radius: 0;
}
.nano-voice-modal .iv-content-label { display: none !important; }
.nano-voice-modal .iv-thought {
  color: #e7e9ea;
  font-family: inherit;
  font-size: 17px;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: 0;
  padding: 0;
  max-height: none;
  overflow: visible;
  white-space: pre-wrap;
  word-break: break-word;
}
.nano-voice-modal .iv-thought::after { display: none !important; content: none !important; }
.nano-voice-modal .iv-extra-text { display: none !important; }

.nano-voice-modal .x-meta {
  color: #71767b;
  font-size: 14px;
  line-height: 1.4;
  padding: 12px 0 0;
  border: 0;
}
.nano-voice-modal .x-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0 12px;
  border: 0;
}
.nano-voice-modal .x-act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: none;
  color: #71767b;
  padding: 2px 0;
  font: inherit;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.12s, transform 0.12s;
}
.nano-voice-modal .x-act svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.nano-voice-modal .x-act.liked { color: #f91880; }
.nano-voice-modal .x-act.liked svg { fill: #f91880; stroke: #f91880; }
.nano-voice-modal .x-act.saved { color: #1d9bf0; }
.nano-voice-modal .x-act.saved svg { fill: #1d9bf0; stroke: #1d9bf0; }
.nano-voice-modal .x-act:active { transform: scale(0.94); }

/* ---------- 评论区 ---------- */
.nano-voice-modal .iv-sections {
  position: relative;
  z-index: 2;
  display: block;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0 16px 6px;
}
.nano-voice-modal .iv-section { padding: 0; border: 0; background: transparent; }
.nano-voice-modal .iv-section-title {
  margin: 0;
  padding: 12px 0 6px;
  color: #e7e9ea;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: none;
  border: 0;
}
.nano-voice-modal .iv-section-title::after {
  content: " " attr(data-count);
  color: #71767b;
  font-size: 14px;
  font-weight: 500;
}
.nano-voice-modal .iv-section-body { display: none !important; }
.nano-voice-modal .x-replies { display: block; padding: 0; }
.nano-voice-modal .x-thread { display: block; padding: 0; }
.nano-voice-modal .x-thread + .x-thread { margin-top: 6px; }
.nano-voice-modal .x-reply {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border: 0;
}
.nano-voice-modal .x-av-col {
  position: relative;
  width: 36px;
  flex: 0 0 36px;
  align-self: stretch;
}
.nano-voice-modal .x-thread .x-reply:not(:last-child) .x-av-col::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 42px;
  bottom: -16px;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: #2f3336;
}
.nano-voice-modal .x-reply-av {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 50%;
  background: #333639;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
}
.nano-voice-modal .x-reply-main { flex: 1 1 auto; min-width: 0; padding-top: 1px; }
.nano-voice-modal .x-reply-head { display: flex; align-items: baseline; gap: 4px; min-width: 0; color: #e7e9ea; }
.nano-voice-modal .x-reply-name {
  color: #e7e9ea;
  font-size: 14.5px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nano-voice-modal .x-reply-handle {
  color: #71767b;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nano-voice-modal .x-reply-to { color: #71767b; font-size: 12.5px; line-height: 1.3; margin-top: 1px; }
.nano-voice-modal .x-reply-text {
  margin-top: 2px;
  color: #e7e9ea;
  font-size: 14.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.nano-voice-modal .x-reply-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 5px;
  color: #71767b;
  font-size: 12px;
}
.nano-voice-modal .x-reply-like { display: inline-flex; align-items: center; gap: 4px; color: #71767b; }
.nano-voice-modal .x-reply-like svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---------- 底栏 ---------- */
.nano-voice-modal .x-bottom-dock {
  position: sticky;
  bottom: 0;
  z-index: 40;
  background: #000;
  padding: 6px 0 0;
  margin-top: 4px;
}
.nano-voice-modal .x-reply-bar { display: block; padding: 0 16px 7px; background: #000; border: 0; }
.nano-voice-modal .x-rb-input {
  height: 38px;
  border-radius: 999px;
  background: #16181c;
  color: #71767b;
  font-size: 14px;
  display: flex;
  align-items: center;
  padding: 0 16px;
}
.nano-voice-modal .x-bottom-nav {
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 50px;
  padding: 0 6px 4px;
}
.nano-voice-modal .x-nav-item {
  width: 52px;
  height: 40px;
  border: 0;
  background: none;
  color: #71767b;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.nano-voice-modal .x-nav-item:active { background: #16181c; border-radius: 999px; }
.nano-voice-modal .x-nav-item svg {
  width: 23px;
  height: 23px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.1;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.nano-voice-modal .x-nav-item.on { color: #e7e9ea; }
.nano-voice-modal .x-nav-item.x-nav-x { color: #e7e9ea; }
.nano-voice-modal .x-nav-item.x-nav-x svg { width: 24px; height: 24px; fill: currentColor; stroke: none; }
.nano-voice-modal .x-nav-item[data-nav="home"] svg,
.nano-voice-modal .x-nav-item[data-nav="notifications"] svg,
.nano-voice-modal .x-nav-item[data-nav="messages"] svg { fill: currentColor; stroke: none; }
.nano-voice-modal .x-nav-item[data-nav="search"] svg { fill: none; stroke: currentColor; }

.nano-voice-modal .iv-section:not(.x-comment-section) { padding: 10px 0; border: 0; }
.nano-voice-modal .iv-section:not(.x-comment-section) .iv-section-title { padding: 0 0 6px; border: 0; }
.nano-voice-modal .iv-section:not(.x-comment-section) .iv-section-body {
  display: block !important;
  color: #c7c9cb;
  font-size: 14px;
  line-height: 1.6;
}
.nano-voice-modal.has-sections .iv-content { border-radius: 0; }
.nano-voice-modal.has-sections .iv-sections { border-radius: 0; overflow: visible; }

@media (max-width: 420px) {
  .nano-voice-modal .iv-thought { font-size: 16.5px; }
  .nano-voice-modal .x-reply-text { font-size: 14px; }
  .nano-voice-modal .x-bottom-nav { height: 48px; }
}

/* ============================================================
   评论区由 AI 生成：2 组，每条评论 + 1 条回复，一行一组。
   ============================================================ */
/* @heart-sections
[评论区] 以 X 网友的视角，对这条心声写 2 条评论，每条评论下面必须有 1 条回复；不要编号、不要解释、不要用表格。每行一条，严格格式：昵称|@handle|评论内容||昵称|@handle|回复内容
*/

/* @js
` + X_POST_JS + `
*/`;


  window.NANO_HEART_BUILTIN_TEMPLATES = [
    {
      id: 'builtin_pink_dots',
      name: '粉色波点便签 · 内置',
      version: 2,
      css: PINK_DOTS_CSS
    },
    {
      id: 'builtin_x_post',
      name: 'X 帖子风 · 内置',
      version: 4,
      css: X_POST_CSS
    }
  ];
})();
