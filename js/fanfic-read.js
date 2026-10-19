/* ============================================================
   fanfic-read.js — 阅读 / 逐章生成 / 段评 / 章评 / 分享
   ============================================================ */
(function () {
  'use strict';
  var F = window.NanoFanfic;
  if (!F) return;

  var params = new URLSearchParams(location.search);
  var storyId = params.get('id') || '';
  var story = F.get(storyId);
  var current = 0;
  var busy = false;
  var charSetting = '';
  var openPara = 0;
  var chapterCommentsOpen = false;

  function $(id) { return document.getElementById(id); }
  function toast(text) {
    var el = $('ffToast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(window.__ffToast);
    window.__ffToast = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function showLoading(text, sub, pct) {
    var el = $('ffLoading');
    if (!el) return;
    $('ffLoadingText').textContent = text || '正在写下一章';
    $('ffLoadingSub').textContent = sub || '正文优先，写完后补段评和章评';
    var bar = $('ffLoadingProgress');
    if (bar && typeof pct === 'number') bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    el.classList.add('show');
  }
  function hideLoading() {
    var el = $('ffLoading');
    if (el) el.classList.remove('show');
    var bar = $('ffLoadingProgress');
    if (bar) setTimeout(function () { bar.style.width = '0%'; }, 260);
  }
  function wordCount(s) { return String(s || '').replace(/\s/g, '').length; }
  function chapterParaCount(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean).length;
  }

  function goHome() { location.href = 'fanfic.html'; }

  function renderTop() {
    $('ffTopTitle').textContent = story.title || 'Untitled';
    $('ffTopSub').textContent = (story.userName || '你') + ' × ' + (story.charName || '角色') + ' · ' + (story.ending || 'HE');
  }

  function renderTabs() {
    var strip = $('ffChapterStrip');
    var list = story.chapters || [];
    if (!list.length) { strip.innerHTML = ''; return; }
    strip.innerHTML = list.map(function (c, i) {
      return '<button class="ff-chapter-tab' + (i === current ? ' on' : '') + '" type="button" data-ch="' + i + '">' + (c.no || (i + 1)) + '</button>';
    }).join('');
    var active = strip.querySelector('.ff-chapter-tab.on');
    if (active) {
      try { strip.scrollLeft = Math.max(0, active.offsetLeft - 40); } catch (e) {}
    }
  }

  function currentUserName() {
    try { return (window.NanoUserScope && NanoUserScope.currentUserName()) || '我'; } catch (e) { return '我'; }
  }

  function ensureCommentIds(ch) {
    if (!ch) return;
    var seq = 0;
    function fix(c) {
      if (!c) return;
      if (!c.id) c.id = 'c_' + Date.now().toString(36) + '_' + (seq++);
      if (Array.isArray(c.replies)) c.replies.forEach(fix);
    }
    (ch.paraComments || []).forEach(function (pc) { (pc.comments || []).forEach(fix); });
    (ch.chapterComments || []).forEach(fix);
    (ch.userParaComments || []).forEach(fix);
    (ch.userChapterComments || []).forEach(fix);
  }

  function commentHtml(c, para) {
    if (!c || !c.text) return '';
    var id = F.esc(c.id || '');
    var replies = (c.replies || []).map(function (r) {
      return '<div class="ff-reply"><b>' + F.esc(r.user || '读者') + '</b> ' + F.esc(r.text || '') + '</div>';
    }).join('');
    return '<div class="ff-comment" data-cid="' + id + '">' +
      '<b>' + F.esc(c.user || '读者') + '</b> ' + F.esc(c.text) +
      ' <button class="ff-reply-btn" type="button" data-reply="' + id + '" data-para="' + (para || '') + '">回复</button>' +
      (replies ? '<div class="ff-replies">' + replies + '</div>' : '') +
    '</div>';
  }

  function userCommentsFor(ch, para) {
    return (ch.userParaComments || []).filter(function (c) { return Number(c.para) === Number(para); });
  }

  function renderArticle() {
    var wrap = $('ffArticleWrap');
    var list = story.chapters || [];
    if (!list.length) {
      wrap.innerHTML = '<section class="ff-empty show" style="display:block">' +
        '<div class="ff-empty-mark">01</div>' +
        '<h2>第一章还没有开始</h2>' +
        '<p>点下面的按钮，让 TA 和你在故事里第一次见面。</p>' +
        '<button class="ff-dark-btn" id="ffFirst" type="button">生成第一章</button>' +
      '</section>';
      return;
    }
    var ch = list[current];
    ensureCommentIds(ch);
    var paras = String(ch.text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    var byPara = {};
    (ch.paraComments || []).forEach(function (pc) {
      var n = Number(pc && pc.para);
      if (!n || n < 1) return;
      if (!byPara[n]) byPara[n] = [];
      byPara[n].push(pc);
    });

    var no = ch.no || (current + 1);
    var title = String(ch.title || '').replace(/^第\s*[0-9一二三四五六七八九十百]+\s*章[：:·\s-]*/,'').trim();
    var html = '<section class="ff-chapter-head">' +
      '<div class="ff-chapter-no">CHAPTER ' + String(no).padStart(2, '0') + '</div>' +
      '<h1 class="ff-chapter-title">第 ' + no + ' 章' + (title ? (' <span>' + F.esc(title) + '</span>') : '') + '</h1>' +
      '<div class="ff-chapter-sub">' + wordCount(ch.text) + ' 字 · ' + (ch.finale ? '大结局' : '连载中') + '</div>' +
    '</section>';

    html += '<article class="ff-article">';
    paras.forEach(function (p, idx) {
      var n = idx + 1;
      var pcs = byPara[n] || [];
      var userCs = userCommentsFor(ch, n);
      var count = pcs.reduce(function (sum, pc) { return sum + (pc.comments || []).length; }, 0) + userCs.length;
      html += '<div class="ff-p">';
      html += '<p>' + F.esc(p).replace(/\n/g, '<br>') + '</p>';
      if (count > 0) {
        html += '<div class="ff-p-actions">' +
          '<button class="ff-bubble-btn" type="button" data-para="' + n + '" aria-label="段评">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 9.6 9.6 0 0 1-4.2-1L3 20l1.2-4.4A8.2 8.2 0 0 1 3 11.5 8.4 8.4 0 0 1 11.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg>' +
            '<span>' + count + '</span>' +
          '</button>' +
        '</div>';
        html += '<div class="ff-p-comments" id="ffpc-' + n + '"' + (openPara === n ? '' : ' hidden') + '>';
        html += '<div class="ff-para-tools"><span>段评 · 第 ' + n + ' 段</span><button class="ff-refresh-btn" type="button" data-refresh-para="' + n + '">刷新段评</button></div>';
        pcs.forEach(function (pc) {
          if (pc.quote && (pc.comments || []).length) html += '<div class="ff-comment ff-quote">“' + F.esc(pc.quote) + '”</div>';
          (pc.comments || []).forEach(function (c) { html += commentHtml(c, n); });
        });
        userCs.forEach(function (c) { html += commentHtml(c, n); });
        html += '<div class="ff-comment-compose"><input class="ff-comment-input" data-para-input="' + n + '" maxlength="160" placeholder="写段评…"><button type="button" data-send-para="' + n + '">发布</button></div>';
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</article>';

    var aiChapter = ch.chapterComments || [];
    var userChapter = ch.userChapterComments || [];
    var chapterCount = aiChapter.length + userChapter.length;
    html += '<section class="ff-comments-block' + (chapterCommentsOpen ? ' open' : '') + '">' +
      '<div class="ff-comments-head" data-toggle-chapter-comments>' +
        '<div class="ff-comments-title">CHAPTER COMMENTS <span class="ff-comment-count">' + chapterCount + '</span></div>' +
        '<div class="ff-comments-tools">' +
          '<button class="ff-refresh-btn" id="ffRefreshComments" type="button">刷新评论</button>' +
          '<span class="ff-fold-arrow">' + (chapterCommentsOpen ? '−' : '+') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="ff-comments-body">' +
        '<div class="ff-comments-list">' +
          aiChapter.map(function (c) { return commentHtml(c, ''); }).join('') +
          userChapter.map(function (c) { return commentHtml(c, ''); }).join('') +
        '</div>' +
        '<div class="ff-comment-compose chapter"><input class="ff-comment-input" id="ffChapterInput" maxlength="200" placeholder="写章评…"><button type="button" id="ffSendChapter">发布</button></div>' +
      '</div>' +
    '</section>';
    wrap.innerHTML = html;
  }

  function saveCurrentChapter(ch) {
    if (!ch) return;
    story.chapters[current] = ch;
    story.updatedAt = Date.now();
    F.save(story);
  }
  function rerenderKeepScroll() {
    var y = window.scrollY;
    renderArticle();
    try { window.scrollTo(0, y); } catch (e) {}
  }
  function findTopComment(ch, id) {
    var found = null;
    function scan(c) { if (c && String(c.id) === String(id)) found = c; }
    (ch.paraComments || []).forEach(function (pc) { (pc.comments || []).forEach(scan); });
    (ch.chapterComments || []).forEach(scan);
    (ch.userParaComments || []).forEach(scan);
    (ch.userChapterComments || []).forEach(scan);
    return found;
  }
  function addParaComment(para, text) {
    if (busy) { toast('生成中，稍等一下'); return; }
    text = String(text || '').trim();
    if (!text) { toast('先写点什么'); return; }
    var ch = story.chapters[current];
    if (!ch) return;
    ensureCommentIds(ch);
    ch.userParaComments = ch.userParaComments || [];
    ch.userParaComments.push({ id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5), para: Number(para), user: currentUserName(), text: text.slice(0, 160), ts: Date.now(), replies: [] });
    openPara = Number(para);
    saveCurrentChapter(ch);
    rerenderKeepScroll();
    toast('已发布段评');
  }
  function addChapterComment(text) {
    if (busy) { toast('生成中，稍等一下'); return; }
    text = String(text || '').trim();
    if (!text) { toast('先写点什么'); return; }
    var ch = story.chapters[current];
    if (!ch) return;
    ensureCommentIds(ch);
    ch.userChapterComments = ch.userChapterComments || [];
    ch.userChapterComments.push({ id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5), user: currentUserName(), text: text.slice(0, 200), ts: Date.now(), replies: [] });
    chapterCommentsOpen = true;
    saveCurrentChapter(ch);
    rerenderKeepScroll();
    toast('已发布章评');
  }
  function addReply(commentId, text) {
    if (busy) { toast('生成中，稍等一下'); return; }
    text = String(text || '').trim();
    if (!text) return;
    var ch = story.chapters[current];
    var c = findTopComment(ch, commentId);
    if (!c) return;
    c.replies = c.replies || [];
    c.replies.push({ user: currentUserName(), text: text.slice(0, 160), ts: Date.now() });
    saveCurrentChapter(ch);
    rerenderKeepScroll();
    toast('已回复');
  }
  async function refreshChapterComments() {
    if (busy) return;
    var ch = story.chapters[current];
    if (!ch) return;
    if (!ch.text) { toast('这一章还没有正文'); return; }
    busy = true;
    var btn = $('ffRefreshComments');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    showLoading('正在刷新章评', '在现有章评上追加新评论', 24);
    try {
      var existing = (ch.chapterComments || []).map(function (c) { return String(c.text || ''); })
        .concat((ch.userChapterComments || []).map(function (c) { return String(c.text || ''); }));
      var fresh = await generateChapterCommentsOnly(ch.text, existing);
      ch.chapterComments = (fresh || []).concat(ch.chapterComments || []);
      saveCurrentChapter(ch);
      chapterCommentsOpen = true;
      hideLoading();
      rerenderKeepScroll();
      toast('章评已刷新');
    } catch (e) {
      hideLoading();
      toast(String((e && e.message) || e || '刷新失败'));
    } finally {
      busy = false;
      var b = $('ffRefreshComments');
      if (b) { b.disabled = false; b.textContent = '刷新评论'; }
    }
  }

  async function refreshParaComments(para) {
    if (busy) return;
    var ch = story.chapters[current];
    if (!ch) return;
    var pn = Number(para);
    if (!pn || !ch.text) return;
    busy = true;
    var btn = document.querySelector('[data-refresh-para="' + pn + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    showLoading('正在刷新段评', '只更新第 ' + pn + ' 段，保留已有评论', 30);
    try {
      var existing = [];
      (ch.paraComments || []).forEach(function (pc) {
        if (Number(pc.para) === pn) (pc.comments || []).forEach(function (c) { existing.push(String(c.text || '')); });
      });
      (ch.userParaComments || []).forEach(function (c) { if (Number(c.para) === pn) existing.push(String(c.text || '')); });
      var out = await generateParaCommentsOnly(ch.text, pn, existing);
      ch.paraComments = (out.groups || []).concat(ch.paraComments || []);
      saveCurrentChapter(ch);
      openPara = pn;
      hideLoading();
      rerenderKeepScroll();
      toast('段评已刷新');
    } catch (e) {
      hideLoading();
      toast(String((e && e.message) || e || '刷新失败'));
    } finally {
      busy = false;
      var b2 = document.querySelector('[data-refresh-para="' + pn + '"]');
      if (b2) { b2.disabled = false; b2.textContent = '刷新段评'; }
    }
  }

  function renderBottom() {
    var box = $('ffBottom');
    if (!story.chapters || !story.chapters.length) { box.innerHTML = ''; return; }
    if (story.completed) {
      box.innerHTML = '<section class="ff-end">' +
        '<span>THE END</span>' +
        '<b>' + F.esc(story.ending || 'HE') + '</b>' +
        '<div style="margin-top:18px"><button class="ff-outline-btn" id="ffBackHome" type="button">返回书架</button></div>' +
      '</section>';
      return;
    }
    var nextNo = story.chapters.length + 1;
    var planned = story.plannedChapters || F.planFor(story.lengthType).planned;
    var reached = story.chapters.length >= planned;
    box.innerHTML = '<section class="ff-gen">' +
      '<div class="ff-gen-label">NEXT CHAPTER</div>' +
      '<textarea id="ffNextDirection" maxlength="800" placeholder="下一章想写什么？例如：让他先低头一次；或者写一场雨里的争吵。可以留空直接生成。"></textarea>' +
      '<label class="ff-finale"><input type="checkbox" id="ffFinale"> 下一章直接写大结局，提前完结</label>' +
      '<div class="ff-gen-actions">' +
        '<button class="ff-outline-btn" id="ffBackHome" type="button">书架</button>' +
        '<button class="ff-continue" id="ffContinue" type="button">继续生成第 ' + nextNo + ' 章</button>' +
      '</div>' +
      '<p class="ff-note">' + (reached ? '已到计划篇幅，可以勾选“大结局”收尾。' : '计划共约 ' + planned + ' 章。每章正文生成完成后，才会追加段评和章评。') + '</p>' +
    '</section>';
  }

  function renderAll() {
    renderTop();
    renderTabs();
    renderArticle();
    renderBottom();
  }

  function switchChapter(i) {
    if (!story.chapters || !story.chapters.length) return;
    current = Math.max(0, Math.min(story.chapters.length - 1, i));
    openPara = 0;
    renderAll();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* ---------------- 生成 ---------------- */
  function buildBodyPrompt(no, direction, finale) {
    var plan = story.plannedChapters || F.planFor(story.lengthType).planned;
    var words = story.wordsPerChapter || 2000;
    var prev = story.chapters || [];
    var summaries = prev.map(function (c) {
      return '第' + (c.no || '') + '章《' + (c.title || '') + '》：' + (c.summary || String(c.text || '').slice(0, 120));
    }).join('\n');
    var tail = prev.length ? String(prev[prev.length - 1].text || '').slice(-1000) : '';
    var finalLine = finale
      ? '这是全书的最后一章（大结局）。必须收束主线、回应前文的伏笔，并落在 ' + (story.ending || 'HE') + ' 的结局方向上。'
      : '这是连载中的一章。结尾留一个自然的钩子，但不要写“未完待续”或作者的话。';
    var style = String(story.customStyle || story.writingStyle || '').trim();
    var titleRule = story.title
      ? '小说已有标题《' + story.title + '》，不要另起小说标题。'
      : '这是第 1 章，你必须先输出「小说标题：……」，给整篇小说起一个正式、好记、有文学感的标题，然后再输出章节标题。';
    return '你是一个中文同人文作者。请写《' + (story.title || '未命名') + '》第 ' + no + ' 章。\n' +
      '【配对】' + (story.userName || '我') + ' × ' + (story.charName || '角色') + '\n' +
      '【题材】' + ((story.genres || []).join('、') || '未指定') + '\n' +
      ((story.genreNotes && story.genreNotes.length) ? ('【自定义题材说明】\n' + story.genreNotes.join('\n') + '\n') : '') +
      (story.customSetting ? ('【额外设定】\n' + story.customSetting + '\n') : '') +
      (charSetting ? ('【角色设定】\n' + charSetting.slice(0, 3000) + '\n') : '') +
      '【文风】' + (style || '由你根据题材选择最合适的文风，保持整篇统一') + '\n' +
      '【内容尺度】允许成人向 / NSFW 描写。亲密、欲望、身体反应都可以写，但要服务于人物关系和剧情推进，不要为了露骨而露骨。\n' +
      '【结局方向】' + (story.ending || 'HE') + '\n' +
      '【篇幅计划】全书约 ' + plan + ' 章，本章约 ' + words + ' 字。\n' +
      (summaries ? ('【前情摘要】\n' + summaries + '\n') : '') +
      (tail ? ('【上一章结尾】\n' + tail + '\n') : '') +
      (direction ? ('【本章方向】\n' + direction + '\n') : '') +
      '【硬性要求】\n' +
      '1. 只输出正文，不要解释、不要分析、不要作者的话、不要段评或章评。\n' +
      '2. ' + titleRule + ' 章节标题只写标题名，不要带“第 X 章”。\n' +
      '3. 第一行输出「小说标题：……」（仅第 1 章且未定标题时），下一行输出「章节标题：……」，然后空一行开始正文。\n' +
      '4. 正文分段，段与段之间空一行；保证本章完整：有场景、有对话、有推进、有收束，不要写到一半停住。\n' +
      '5. 文风严格服从【文风】；不要堆砌形容词，不要用“综上所述/总而言之”这类总结句。\n' +
      '6. ' + finalLine + '\n';
  }

  function cleanTitle(t) {
    return String(t || '').trim()
      .replace(/^[《「“"']+|[》」”"']+$/g, '')
      .replace(/^第\s*[0-9一二三四五六七八九十百]+\s*章[：:·\s-]*/,'')
      .trim();
  }
  function parseChapter(raw) {
    var s = String(raw || '').replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
    var novelTitle = '';
    var chapterTitle = '';
    var m = s.match(/^(?:小说标题|书名)[：:]\s*(.+)$/m);
    if (m) { novelTitle = cleanTitle(m[1]); s = s.replace(m[0], '').trim(); }
    m = s.match(/^(?:章节标题|标题)[：:]\s*(.+)$/m);
    if (m) { chapterTitle = cleanTitle(m[1]); s = s.replace(m[0], '').trim(); }
    s = s.replace(/^(第\s*[0-9一二三四五六七八九十百]+\s*章)\s*/,'').trim();
    return { novelTitle: novelTitle, chapterTitle: chapterTitle, body: s.trim() };
  }

  function parseComments(raw, paraCount) {
    var data = F.parseJson(raw);
    if (!data) return { summary: '', paraComments: [], chapterComments: [] };
    var paras = Array.isArray(data.paraComments) ? data.paraComments : [];
    var chapters = Array.isArray(data.chapterComments) ? data.chapterComments : [];
    var outParas = [];
    paras.forEach(function (pc) {
      var n = Number(pc && pc.para);
      if (!n || n < 1 || n > paraCount) return;
      var cs = (pc.comments || []).map(function (c) {
        return { user: String(c.user || '读者').slice(0, 12), text: String(c.text || '').slice(0, 140) };
      }).filter(function (c) { return c.text; }).slice(0, 8);
      if (!cs.length) return;
      outParas.push({ para: n, quote: String(pc.quote || '').slice(0, 40), comments: cs });
    });
    var outCh = chapters.map(function (c) {
      return { user: String(c.user || '读者').slice(0, 12), text: String(c.text || '').slice(0, 200) };
    }).filter(function (c) { return c.text; }).slice(0, 14);
    return {
      summary: String(data.summary || '').slice(0, 200),
      paraComments: outParas.slice(0, 12),
      chapterComments: outCh
    };
  }

  async function callBody(prompt, words) {
    var want = Math.min(32768, Math.max(6000, words * 2 + 4000));
    var limits = [want, 16384, 8192, 4096].filter(function (n, i, a) { return n > 0 && a.indexOf(n) === i; });
    var last = null;
    for (var i = 0; i < limits.length; i++) {
      try {
        return await F.callApi([{ role: 'system', content: prompt }], { maxTokens: limits[i], temperature: 0.92 });
      } catch (e) {
        last = e;
        var msg = String((e && e.message) || e || '');
        if (!/max.?tokens|too large|maximum.*tokens|token.*limit/i.test(msg)) throw e;
      }
    }
    throw last || new Error('生成失败');
  }

  async function generateComments(body, no) {
    var paras = String(body || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    var numbered = paras.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n\n').slice(0, 18000);
    var sys = '你是一群真实的中文网文读者。请针对下面这一章给出读者反应。\n' +
      '【正文（段落已编号）】\n' + numbered + '\n\n' +
      '【输出】只输出一个 JSON 对象，不要 markdown，不要解释：\n' +
      '{"summary":"本章剧情一句话总结（40字内）","paraComments":[{"para":3,"quote":"从该段摘6-24字高光句","comments":[{"user":"读者名","text":"评论"}]}],"chapterComments":[{"user":"读者名","text":"评论"}]}\n' +
      '要求：\n' +
      '1. paraComments 3-6 条，只挑最精彩、最有情绪或最有争议的段落，不要每段都有；para 必须在 1 到 ' + paras.length + ' 之间；每条 4-8 个评论，同一个段落可以有多条不同读者评论。\n' +
      '2. chapterComments 8-12 条。\n' +
      '3. 评论像真实读者：可以夸、吐槽、猜剧情、催更、讨论人物关系，口语化，不要 emoji，不要剧透后文。\n' +
      '4. 读者名用 2-6 个字的中文昵称，不要重复太多。\n' +
      '5. quote 必须真的出现在对应段落里，6-24 字。';
    var raw = '';
    var limits = [8192, 4096, 2048];
    var last = null;
    for (var i = 0; i < limits.length; i++) {
      try {
        raw = await F.callApi([{ role: 'system', content: sys }], { maxTokens: limits[i], temperature: 0.75 });
        break;
      } catch (e) {
        last = e;
        var msg = String((e && e.message) || e || '');
        if (!/max.?tokens|too large|maximum.*tokens|token.*limit/i.test(msg)) throw e;
      }
    }
    if (!raw && last) throw last;
    return parseComments(raw, paras.length);
  }

  async function generateChapterCommentsOnly(body, existingTexts) {
    var existing = (existingTexts || []).slice(-20).join('\n').slice(0, 3000);
    var sys = '你是一群真实的中文网文读者。请只针对这一章写新的章评，不要写段评。\n' +
      '【正文】\n' + String(body || '').slice(0, 16000) + '\n\n' +
      (existing ? ('【已有的章评（不要重复这些观点和句子）】\n' + existing + '\n\n') : '') +
      '【输出】只输出 JSON：{"chapterComments":[{"user":"读者名","text":"评论"}]}\n' +
      '要求：8-12 条，像真实读者，可以夸、吐槽、猜剧情、催更、讨论人物关系；口语化，不要 emoji，不要剧透后文；读者名 2-6 个中文字，不要重复太多。';
    var raw = '';
    var limits = [8192, 4096, 2048];
    var last = null;
    for (var i = 0; i < limits.length; i++) {
      try { raw = await F.callApi([{ role: 'system', content: sys }], { maxTokens: limits[i], temperature: 0.78 }); break; }
      catch (e) {
        last = e;
        var msg = String((e && e.message) || e || '');
        if (!/max.?tokens|too large|maximum.*tokens|token.*limit/i.test(msg)) throw e;
      }
    }
    if (!raw && last) throw last;
    var parsed = parseComments(raw, 1);
    return parsed.chapterComments || [];
  }

  async function generateParaCommentsOnly(body, para, existingTexts) {
    var paras = String(body || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    var target = paras[Number(para) - 1] || '';
    if (!target) return { groups: [], summary: '' };
    var existing = (existingTexts || []).slice(-12).join('\n').slice(0, 2000);
    var ctx = paras.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n\n').slice(0, 14000);
    var sys = '你是一群真实的中文网文读者。请只针对第 ' + para + ' 段写新的段评，不要写章评。\n' +
      '【全文（段落已编号）】\n' + ctx + '\n\n' +
      '【目标段落】第 ' + para + ' 段：' + target + '\n\n' +
      (existing ? ('【这段已有的评论（不要重复这些观点和句子）】\n' + existing + '\n\n') : '') +
      '【输出】只输出 JSON：{"paraComments":[{"para":' + para + ',"quote":"从目标段摘 6-24 字","comments":[{"user":"读者名","text":"评论"}]}]}\n' +
      '要求：1-2 组、每组 3-6 条；像真实读者，可以夸、吐槽、猜剧情、讨论人物；口语化，不要 emoji，不要剧透后文；读者名 2-6 个中文字。';
    var raw = '';
    var limits = [4096, 2048];
    var last = null;
    for (var i = 0; i < limits.length; i++) {
      try { raw = await F.callApi([{ role: 'system', content: sys }], { maxTokens: limits[i], temperature: 0.8 }); break; }
      catch (e) {
        last = e;
        var msg = String((e && e.message) || e || '');
        if (!/max.?tokens|too large|maximum.*tokens|token.*limit/i.test(msg)) throw e;
      }
    }
    if (!raw && last) throw last;
    var parsed = parseComments(raw, paras.length);
    var groups = (parsed.paraComments || []).filter(function (pc) { return Number(pc.para) === Number(para); });
    return { groups: groups, summary: parsed.summary || '' };
  }

  async function generateStoryTitle(parsed) {
    if (story.title) return story.title;
    if (parsed && parsed.novelTitle) return parsed.novelTitle;
    try {
      var sys = '给下面这篇同人文起一个正式、好记、有文学感的中文标题。只输出标题本身，不要书名号，不要解释。\n' +
        '配对：' + (story.userName || '我') + ' × ' + (story.charName || '角色') + '\n' +
        '题材：' + ((story.genres || []).join('、') || '未指定') + '\n' +
        '文风：' + (story.customStyle || story.writingStyle || '自然') + '\n' +
        '第一章标题：' + ((parsed && parsed.chapterTitle) || '') + '\n' +
        '第一章正文开头：' + String((parsed && parsed.body) || '').slice(0, 500);
      var t = await F.callApi([{ role: 'system', content: sys }], { maxTokens: 80, temperature: 0.85 });
      t = cleanTitle(String(t || '').split('\n')[0]).slice(0, 30);
      if (t) return t;
    } catch (e) {}
    return (story.charName || 'TA') + ' · ' + ((story.genres || [])[0] || '同人');
  }

  async function generateNext(opts) {
    opts = opts || {};
    if (busy) return;
    if (story.completed) { toast('这篇已经完结了'); return; }
    var no = (story.chapters || []).length + 1;
    var finale = !!opts.finale;
    var direction = String(opts.direction || '').trim();
    busy = true;
    var btn = $('ffContinue');
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    showLoading('正在写第 ' + no + ' 章', finale ? '大结局 · 正文优先' : '正文优先，写完后补段评和章评', 12);
    try {
      var prompt = buildBodyPrompt(no, direction, finale);
      var raw = await callBody(prompt, story.wordsPerChapter || 2000);
      var parsed = parseChapter(raw);
      if (wordCount(parsed.body) < 260) {
        showLoading('正在补全第 ' + no + ' 章', '上一版正文偏短，正在重写完整版', 38);
        raw = await callBody(prompt + '\n【补充要求】上一版正文过短或没有完整展开，请重写完整的一章，必须写够 ' + (story.wordsPerChapter || 2000) + ' 字左右。', story.wordsPerChapter || 2000);
        parsed = parseChapter(raw);
      }
      if (wordCount(parsed.body) < 120) throw new Error('正文生成失败，请重试');
      if (!parsed.chapterTitle) {
        var firstLine = String(parsed.body).replace(/\s+/g, ' ').split(/[。！？!?…]/)[0].trim();
        parsed.chapterTitle = firstLine.slice(0, 16) || '未命名';
      }
      showLoading('正在整理小说标题和读者反应', '正文已经写好，正在生成标题、段评和章评', 62);
      await new Promise(function (r) { setTimeout(r, 180); });
      if (!story.title) story.title = await generateStoryTitle(parsed);
      showLoading('正在生成段评和章评', '正文已经写好，正在整理读者反应', 74);
      var comments = { summary: '', paraComments: [], chapterComments: [] };
      var commentsOk = true;
      try {
        comments = await generateComments(parsed.body, no);
      } catch (e) {
        commentsOk = false;
      }
      var ch = {
        no: no,
        title: parsed.chapterTitle || ('第 ' + no + ' 章'),
        text: parsed.body,
        paraComments: comments.paraComments,
        chapterComments: comments.chapterComments,
        summary: comments.summary,
        finale: finale,
        ts: Date.now(),
        wordCount: wordCount(parsed.body)
      };
      story.chapters = story.chapters || [];
      story.chapters.push(ch);
      if (!story.title) story.title = parsed.novelTitle || ((story.charName || 'TA') + ' · ' + ((story.genres || [])[0] || '同人'));
      story.updatedAt = Date.now();
      if (finale) story.completed = true;
      showLoading('正在保存这一章', '马上就好', 94);
      F.save(story);
      current = story.chapters.length - 1;
      openPara = 0;
      renderAll();
      showLoading('完成', '这一章已经写好了', 100);
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
      if (!commentsOk) toast('正文已生成，段评/章评这次没拿到');
    } catch (e) {
      toast(String((e && e.message) || e || '生成失败'));
    } finally {
      busy = false;
      hideLoading();
      var b = $('ffContinue');
      if (b) { b.disabled = false; b.textContent = '继续生成第 ' + ((story.chapters || []).length + 1) + ' 章'; }
    }
  }

  /* ---------------- 分享到私聊 ---------------- */
  function share() {
    if (!story.chapters || !story.chapters.length) { toast('先写一章再分享'); return; }
    if (!story.charId) { toast('这个故事没有绑定角色'); return; }
    var content = story.chapters.map(function (c) {
      return '第' + (c.no || '') + '章 ' + (c.title || '') + '\n' + String(c.text || '');
    }).join('\n\n').slice(0, 8000);
    var card = {
      cardType: 'fanfic',
      title: story.title || '未命名同人文',
      sub: (story.userName || '你') + ' × ' + (story.charName || '角色'),
      storyId: story.id,
      excerpt: String(story.chapters[0].text || '').slice(0, 140),
      content: content,
      genres: (story.genres || []).join(' / '),
      chapters: story.chapters.length,
      ending: story.ending || 'HE'
    };
    try {
      localStorage.setItem('nano_pending_fanfic_card', JSON.stringify({ chatId: String(story.charId), card: card }));
    } catch (e) {}
    var url = 'chat_inner.html?chat=' + encodeURIComponent(story.charId) + '&name=' + encodeURIComponent(story.charName || '');
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'openFullscreen', url: url, title: '', showBack: false, source: 'fanfic' }, '*'); return; } catch (e) {}
    }
    location.href = url;
  }

  /* ---------------- 事件 ---------------- */
  $('ffChapterStrip').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-ch]');
    if (btn) switchChapter(Number(btn.getAttribute('data-ch')));
  });
  $('ffArticleWrap').addEventListener('click', function (e) {
    if (e.target.closest('#ffFirst')) { generateNext({ finale: false, direction: '' }); return; }
    if (e.target.closest('#ffRefreshComments')) { refreshChapterComments(); return; }
    var refreshPara = e.target.closest('[data-refresh-para]');
    if (refreshPara) { refreshParaComments(refreshPara.getAttribute('data-refresh-para')); return; }
    var toggle = e.target.closest('[data-toggle-chapter-comments]');
    if (toggle) {
      chapterCommentsOpen = !chapterCommentsOpen;
      var block = toggle.closest('.ff-comments-block');
      if (block) block.classList.toggle('open', chapterCommentsOpen);
      var arrow = toggle.querySelector('.ff-fold-arrow');
      if (arrow) arrow.textContent = chapterCommentsOpen ? '−' : '+';
      return;
    }
    if (e.target.closest('#ffSendChapter')) {
      var ci = $('ffChapterInput');
      addChapterComment(ci ? ci.value : '');
      return;
    }
    var sendPara = e.target.closest('[data-send-para]');
    if (sendPara) {
      var pn = sendPara.getAttribute('data-send-para');
      var inp = document.querySelector('[data-para-input="' + pn + '"]');
      addParaComment(pn, inp ? inp.value : '');
      return;
    }
    var sendReply = e.target.closest('[data-send-reply]');
    if (sendReply) {
      var cid = sendReply.getAttribute('data-send-reply');
      var form = sendReply.closest('.ff-reply-form');
      var rin = form ? form.querySelector('input') : null;
      addReply(cid, rin ? rin.value : '');
      return;
    }
    var rep = e.target.closest('[data-reply]');
    if (rep) {
      var rid = rep.getAttribute('data-reply');
      var para = rep.getAttribute('data-para') || '';
      var box = rep.closest('.ff-comment');
      if (box) {
        var old = box.querySelector('.ff-reply-form');
        if (old) { old.remove(); return; }
        var f = document.createElement('div');
        f.className = 'ff-reply-form';
        f.innerHTML = '<input maxlength="160" placeholder="回复 ' + F.esc(rep.parentNode.querySelector('b') ? rep.parentNode.querySelector('b').textContent : '') + '…"><button type="button" data-send-reply="' + F.esc(rid) + '" data-para="' + F.esc(para) + '">发送</button>';
        box.appendChild(f);
        var input = f.querySelector('input');
        if (input) { try { input.focus(); } catch (err) {} }
      }
      return;
    }
    var pbtn = e.target.closest('[data-para]');
    if (pbtn) {
      var pn2 = Number(pbtn.getAttribute('data-para'));
      var id = 'ffpc-' + pn2;
      var el = document.getElementById(id);
      if (el) el.hidden = !el.hidden;
      openPara = el && !el.hidden ? pn2 : 0;
    }
  });
  $('ffArticleWrap').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var inp = e.target.closest('.ff-comment-input');
    if (inp) {
      e.preventDefault();
      var p = inp.getAttribute('data-para-input');
      if (p) addParaComment(p, inp.value);
      else addChapterComment(inp.value);
      return;
    }
    var rin = e.target.closest('.ff-reply-form input');
    if (rin) {
      e.preventDefault();
      var btn = rin.parentNode.querySelector('[data-send-reply]');
      if (btn) addReply(btn.getAttribute('data-send-reply'), rin.value);
    }
  });
  $('ffBottom').addEventListener('click', function (e) {
    if (e.target.closest('#ffBackHome')) { goHome(); return; }
    if (e.target.closest('#ffContinue')) {
      var dir = $('ffNextDirection') ? $('ffNextDirection').value : '';
      var fin = $('ffFinale') ? $('ffFinale').checked : false;
      generateNext({ finale: fin, direction: dir });
    }
  });
  $('ffShare').addEventListener('click', share);
  $('ffBack').addEventListener('click', goHome);

  /* ---------------- 启动 ---------------- */
  try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoHideOuterHeader' }, '*'); } catch (e) {}
  if (!story) {
    toast('找不到这篇故事');
    setTimeout(goHome, 900);
    return;
  }
  try {
    var uid = window.NanoUserScope ? NanoUserScope.currentUserId() : '';
    if (uid && story.userId && String(story.userId) !== String(uid)) {
      toast('这个故事不属于当前 user');
      setTimeout(goHome, 900);
      return;
    }
  } catch (e) {}
  if ((story.chapters || []).length) current = Math.max(0, story.chapters.length - 1);
  // 读取角色设定，让文章更贴人设
  (async function () {
    try {
      var chars = window.NanoUserScope ? await NanoUserScope.loadChars() : [];
      var c = chars.find(function (x) { return String(x.id) === String(story.charId); });
      if (c) {
        story.charAvatar = story.charAvatar || c.avatar || '';
        charSetting = String(c.setting || c.desc || c.persona || '');
      }
    } catch (e) {}
    renderAll();
    if (params.get('start') === '1' && !(story.chapters || []).length) {
      setTimeout(function () { generateNext({ finale: false, direction: '' }); }, 300);
    }
  })();
  renderAll();
})();
