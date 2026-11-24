/* ============================================================
   js/xinsu.js
   「心愫」：角色写给用户的交心小作文
   - 私聊里和气泡同一次 API 输出，用 [xinsu:标题|正文] 标记
   - 每 4.5~5.5 天最多一次，只对近 24 小时聊过天的角色触发
   - 聊天里显示 X 风格卡片，点击进入 html/xinsu.html
   - 历史只读当前 char 自己的心愫
   ============================================================ */
(function () {
  'use strict';

  var DAY = 86400000;
  var LIST_P = 'nano_xinsu_list_';
  var META_P = 'nano_xinsu_meta_';
  var STATE_P = 'nano_xinsu_state_';
  var ASK_COOLDOWN = 6 * 3600000;

  function keyOf(prefix, id) {
    return prefix + String(id == null ? 'default' : id).replace(/[^\w\u4e00-\u9fa5-]/g, '_');
  }
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function cleanTitle(s) {
    return String(s || '')
      .replace(/^[\s《「『"“'‘【\[]+/, '')
      .replace(/[》」』"”'’】\]]+$/, '')
      .replace(/[。．.!！?？~～]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16);
  }
  function cleanBody(s) {
    var t = String(s || '').replace(/\r\n/g, '\n');
    // 模型偶尔会把换行写成字面量 \n
    t = t.replace(/\\n/g, '\n').trim();
    // 不是信：允许模型偶尔手滑写了称呼，落地前去掉开头那半句。
    t = t.replace(/^亲爱的[^，,。.!！\n]{0,12}[，,。.!！:：]\s*/, '');
    t = t.replace(/^[「『"“'‘]+/, '').replace(/[」』"”'’]+$/, '').trim();
    return t;
  }
  function parseEssayPayload(raw) {
    var s = String(raw || '').trim();
    var sep = s.indexOf('|');
    if (sep < 0) sep = s.indexOf('｜');
    var title = sep > -1 ? s.slice(0, sep) : '';
    var body = sep > -1 ? s.slice(sep + 1) : s;
    title = cleanTitle(title);
    body = cleanBody(body);
    if (!body) return null;
    if (body.length < 120) return null;
    return { title: title || '心愫', body: body };
  }

  function list(charId) {
    var arr = readJson(keyOf(LIST_P, charId), []);
    return Array.isArray(arr) ? arr.filter(function (x) { return x && x.body; }) : [];
  }
  function get(charId, essayId) {
    if (!essayId) return null;
    var arr = list(charId);
    for (var i = arr.length - 1; i >= 0; i--) {
      if (String(arr[i].id) === String(essayId)) return arr[i];
    }
    return arr.length ? arr[arr.length - 1] : null;
  }
  function meta(charId) {
    var m = readJson(keyOf(META_P, charId), null);
    return (m && typeof m === 'object') ? m : {};
  }
  function saveMeta(charId, patch) {
    var m = meta(charId);
    if (patch && patch.charName) m.name = String(patch.charName).slice(0, 40);
    if (patch && patch.charAvatar) {
      var av = String(patch.charAvatar);
      // data URL 头像太大就不塞 localStorage，页面会用首字母兜底。
      if (av.length <= 400000) m.avatar = av;
    }
    m.updatedAt = Date.now();
    writeJson(keyOf(META_P, charId), m);
  }
  function state(charId) {
    var st = readJson(keyOf(STATE_P, charId), null);
    return (st && typeof st === 'object') ? st : {};
  }
  function saveState(charId, st) { writeJson(keyOf(STATE_P, charId), st || {}); }

  function add(charId, info) {
    info = info || {};
    var body = cleanBody(info.body);
    if (!body) return null;
    var now = Date.now();
    var rec = {
      id: 'xs_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      title: cleanTitle(info.title) || '心愫',
      body: body,
      at: now
    };
    var arr = list(charId);
    arr.push(rec);
    // 每个 char 最多留 60 篇，避免 localStorage 越积越满。
    if (arr.length > 60) arr = arr.slice(-60);
    writeJson(keyOf(LIST_P, charId), arr);
    saveMeta(charId, info);
    var st = state(charId);
    st.lastAt = now;
    st.lastAskAt = now;
    // 4.5~5.5 天一次
    st.nextAt = now + (4.5 + Math.random()) * DAY;
    st.count = (Number(st.count) || 0) + 1;
    saveState(charId, st);
    return rec;
  }

  // 本轮是否该让角色写心愫：近 24h 有真实聊天、关系不是刚建、由用户这轮发起、
  // 距上次心愫约 5 天，且至少间隔 6h 才再次询问模型。
  function shouldWrite(charId, messages) {
    if (!charId) return false;
    var id = String(charId);
    if (id === 'default' || id === 'char' || id === 'nano_ai' || id === 'nano') return false;
    var now = Date.now();
    var st = state(id);
    if (st.nextAt && now < Number(st.nextAt)) return false;
    if (st.lastAskAt && now - Number(st.lastAskAt) < ASK_COOLDOWN) return false;
    var arr = Array.isArray(messages) ? messages : [];
    var total = 0, firstTs = 0, lastTs = 0, lastReal = null;
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!m || m.recalled || m.isTip || m.isCard) continue;
      if (m.type !== 'left' && m.type !== 'right') continue;
      var txt = String(m.text || '').trim();
      if (!txt && !m.isVoice) continue;
      total++;
      var ts = Number(m.ts) || 0;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (ts > lastTs) lastTs = ts;
      }
      lastReal = m;
    }
    if (!lastReal) return false;
    if (now - (lastTs || now) > DAY) return false;      // 24 小时内聊过
    if (lastReal.type !== 'right') return false;          // 必须由用户这一轮发起
    if (total < 12) return false;                         // 至少有过一小段真实对话
    if (firstTs && now - firstTs < DAY) return false;     // 认识/聊天至少一天
    return true;
  }

  function markAsked(charId) {
    var st = state(charId);
    st.lastAskAt = Date.now();
    saveState(charId, st);
  }

  function promptBlock(charName) {
    return '【心愫 · 本轮必须额外输出（只此一次）】\n' +
      '你此刻有些平时不太直接说出口的心里话，想在普通聊天气泡之外，单独写给对方。\n' +
      '在正常聊天气泡写完之后，另起一行输出这个标签（这一行不会作为气泡发送，会变成一张「心愫」卡片）：\n' +
      '[xinsu:短标题|正文]\n' +
      '硬性要求：\n' +
      '- 短标题 2~8 个字，不加书名号、引号、句号，例如：其实有点怕。\n' +
      '- 正文 450~550 个汉字，第一人称。它不是信：不要写“亲爱的xx”这种开头，不要称呼开头，不要落款。\n' +
      '- 写你真实的感受、在意、害怕、依赖、最近反复想到的事、对你们关系的心里话；具体、真诚、克制，可以有一点脆弱。\n' +
      '- 不要写成日记、作文或抒情散文，不要排比堆砌，不要说教，不要油腻/霸总/命令式语气，不要提 AI、模型、用户、提示词、设定。\n' +
      '- 正文可以分 2~3 段，段落之间用真实换行；正文里不要出现方括号标签、Markdown、标题或小标题。\n' +
      '- 气泡消息照常写 1~3 条，不要因为写心愫就省略聊天。\n' +
      '- 本轮只输出一个 [xinsu:...]，不要重复，不要输出 [/xinsu]。';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dateLabel(ts) {
    try {
      var d = new Date(Number(ts) || Date.now());
      var now = new Date();
      var sameYear = d.getFullYear() === now.getFullYear();
      var mm = d.getMonth() + 1, dd = d.getDate();
      var hh = String(d.getHours()).padStart(2, '0'), mi = String(d.getMinutes()).padStart(2, '0');
      return (sameYear ? '' : (d.getFullYear() + '年')) + mm + '月' + dd + '日 ' + hh + ':' + mi;
    } catch (e) { return ''; }
  }
  function paraphrase(text, n) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
  }

  window.NanoXinSu = {
    list: list,
    get: get,
    meta: meta,
    add: add,
    shouldWrite: shouldWrite,
    markAsked: markAsked,
    promptBlock: promptBlock,
    parseEssayPayload: parseEssayPayload,
    dateLabel: dateLabel,
    paraphrase: paraphrase
  };

  /* ---------------- 私聊：卡片点击 ---------------- */
  var isPage = false;
  try { isPage = !!(document.body && document.body.classList.contains('xs-page')); } catch (e) {}
  if (!isPage) {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var hit = null;
      try { hit = t && t.closest ? t.closest('.bubble-card.xinsu, .xs-card') : null; } catch (err) {}
      if (!hit) return;
      var card = hit.closest ? (hit.closest('.bubble-card.xinsu') || hit) : hit;
      var inner = card.querySelector ? (card.querySelector('.xs-card') || card) : card;
      var essayId = inner.getAttribute('data-xs-id') || card.getAttribute('data-xs-id') || '';
      var charId = inner.getAttribute('data-xs-char') || card.getAttribute('data-xs-char') || '';
      if (!charId) {
        try { charId = new URLSearchParams(location.search).get('chat') || ''; } catch (err) {}
      }
      if (!essayId || !charId) return;
      e.preventDefault();
      e.stopPropagation();
      var pageUrl = 'xinsu.html?char=' + encodeURIComponent(charId) + '&id=' + encodeURIComponent(essayId);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'openFullscreen',
            url: pageUrl,
            title: '心愫',
            showBack: false,
            source: 'chat_inner'
          }, '*');
        } else {
          location.href = pageUrl;
        }
      } catch (err) {}
    }, true);
    return;
  }

  /* ---------------- 心愫页面 ---------------- */
  function param(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
  }
  var charId = param('char');
  var essayId = param('id');
  var listEl, metaEl, mainEl, histEl, histListEl;

  function avatarHtml(src, name, cls) {
    var s = String(src || '');
    if (s) {
      return '<img class="' + cls + '" src="' + esc(s) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.style.display=\'flex\');">' +
        '<div class="' + cls + ' xs-avatar-fallback" style="display:none">' + esc((name || '?').trim().charAt(0)) + '</div>';
    }
    return '<div class="' + cls + ' xs-avatar-fallback">' + esc((name || '?').trim().charAt(0)) + '</div>';
  }
  var BADGE = '<svg class="xs-badge" viewBox="0 0 24 24" aria-label="认证"><circle cx="12" cy="12" r="11" fill="#1d9bf0"/><path d="m7 12.4 3.1 3.1L17.4 8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderEssay(rec) {
    if (!rec) {
      mainEl.innerHTML = '<div class="xs-empty"><div class="xs-empty-title">还没有写下的心愫</div><div class="xs-empty-sub">等一个安静的深夜，TA 会把心里话留在这里。</div></div>';
      return;
    }
    var m = metaEl;
    var name = m.name || 'TA';
    var av = avatarHtml(m.avatar, name, 'xs-avatar');
    var paras = String(rec.body || '').split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    mainEl.innerHTML =
      '<article class="xs-article">' +
        '<div class="xs-author">' + av +
          '<div class="xs-author-meta">' +
            '<div class="xs-name-row"><span class="xs-name">' + esc(name) + '</span>' + BADGE + '</div>' +
            '<div class="xs-date">' + esc(dateLabel(rec.at)) + '</div>' +
          '</div>' +
        '</div>' +
        '<h1 class="xs-essay-title">' + esc(rec.title || '心愫') + '</h1>' +
        '<div class="xs-essay-body">' + paras + '</div>' +
      '</article>';
    try { document.title = '心愫 · ' + name; } catch (e) {}
  }

  function renderHistory() {
    var arr = list(charId).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (!arr.length) {
      histListEl.innerHTML = '<div class="xs-empty"><div class="xs-empty-title">还没有历史心愫</div><div class="xs-empty-sub">TA 写下的每一篇都会留在这里。</div></div>';
      return;
    }
    histListEl.innerHTML = arr.map(function (r) {
      return '<div class="xs-hitem" data-id="' + esc(r.id) + '">' +
        '<div class="xs-hitem-main">' +
          '<div class="xs-hitem-date">' + esc(dateLabel(r.at)) + '</div>' +
          '<div class="xs-hitem-title">' + esc(r.title || '心愫') + '</div>' +
          '<div class="xs-hitem-excerpt">' + esc(paraphrase(r.body, 90)) + '</div>' +
        '</div>' +
        '<svg class="xs-hitem-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(histListEl.querySelectorAll('.xs-hitem'), function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id') || '';
        essayId = id;
        try { history.replaceState(null, '', 'xinsu.html?char=' + encodeURIComponent(charId) + '&id=' + encodeURIComponent(id)); } catch (e) {}
        renderEssay(get(charId, id));
        showHistory(false);
        try { window.scrollTo(0, 0); } catch (e) {}
      });
    });
  }

  function showHistory(on) {
    if (!histEl) return;
    histEl.hidden = !on;
    if (on) renderHistory();
    document.body.classList.toggle('xs-history-open', !!on);
  }

  function initPage() {
    listEl = document.getElementById('xsHistoryList');
    histEl = document.getElementById('xsHistory');
    histListEl = listEl;
    mainEl = document.getElementById('xsMain');
    metaEl = meta(charId);
    // 页面地址里带 name 时兜底（旧卡片/分享链接）
    if (!metaEl.name && param('name')) metaEl.name = param('name');
    renderEssay(get(charId, essayId));
    var back = document.getElementById('xsBack');
    if (back) back.addEventListener('click', function () {
      try { if (window.parent && window.parent !== window) { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } } catch (e) {}
      if (history.length > 1) history.back();
    });
    var hb = document.getElementById('xsHistoryBtn');
    if (hb) hb.addEventListener('click', function () { showHistory(true); });
    var hBack = document.getElementById('xsHistoryBack');
    if (hBack) hBack.addEventListener('click', function () { showHistory(false); });
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'nanoHideOuterHeader' }, '*'); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
  else initPage();
})();
