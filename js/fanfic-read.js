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
  function toast(text, ms) {
    var el = $('ffToast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(window.__ffToast);
    window.__ffToast = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
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

  async function saveCurrentChapter(ch) {
    if (!ch) return false;
    story.chapters[current] = ch;
    story.updatedAt = Date.now();
    var res = await F.saveAsync(story);
    if (!res || !res.ok) toast('保存失败：存储空间不可用，请清理后重试');
    return !!(res && res.ok);
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
  async function addParaComment(para, text) {
    if (busy) { toast('生成中，稍等一下'); return; }
    text = String(text || '').trim();
    if (!text) { toast('先写点什么'); return; }
    var ch = story.chapters[current];
    if (!ch) return;
    ensureCommentIds(ch);
    ch.userParaComments = ch.userParaComments || [];
    ch.userParaComments.push({ id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5), para: Number(para), user: currentUserName(), text: text.slice(0, 160), ts: Date.now(), replies: [] });
    openPara = Number(para);
    await saveCurrentChapter(ch);
    rerenderKeepScroll();
    toast('已发布段评');
  }
  async function addChapterComment(text) {
    if (busy) { toast('生成中，稍等一下'); return; }
    text = String(text || '').trim();
    if (!text) { toast('先写点什么'); return; }
    var ch = story.chapters[current];
    if (!ch) return;
    ensureCommentIds(ch);
    ch.userChapterComments = ch.userChapterComments || [];
    ch.userChapterComments.push({ id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5), user: currentUserName(), text: text.slice(0, 200), ts: Date.now(), replies: [] });
    chapterCommentsOpen = true;
    await saveCurrentChapter(ch);
    rerenderKeepScroll();
    toast('已发布章评');
  }
  async function addReply(commentId, text) {
    if (busy) { toast('生成中，稍等一下'); return; }
    text = String(text || '').trim();
    if (!text) return;
    var ch = story.chapters[current];
    var c = findTopComment(ch, commentId);
    if (!c) return;
    c.replies = c.replies || [];
    c.replies.push({ user: currentUserName(), text: text.slice(0, 160), ts: Date.now() });
    await saveCurrentChapter(ch);
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
      await saveCurrentChapter(ch);
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
      await saveCurrentChapter(ch);
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
    var draft = (story.draft && Number(story.draft.no) === nextNo) ? story.draft : null;
    box.innerHTML = '<section class="ff-gen">' +
      '<div class="ff-gen-label">NEXT CHAPTER</div>' +
      '<textarea id="ffNextDirection" maxlength="800" placeholder="下一章想写什么？例如：让他先低头一次；或者写一场雨里的争吵。可以留空直接生成。"></textarea>' +
      '<label class="ff-finale"><input type="checkbox" id="ffFinale"> 下一章直接写大结局，提前完结</label>' +
      '<div class="ff-gen-actions">' +
        '<button class="ff-outline-btn" id="ffBackHome" type="button">书架</button>' +
        '<button class="ff-continue" id="ffContinue" type="button">' + (draft ? '继续写第 ' + nextNo + ' 章草稿' : '继续生成第 ' + nextNo + ' 章') + '</button>' +
      '</div>' +
      '<p class="ff-note">' + (draft
        ? '第 ' + nextNo + ' 章已有未完成草稿（已写 ' + wordCount(draft.text) + ' 字），点击会接着写，不会重头开始。'
        : (reached ? '已到计划篇幅，可以勾选“大结局”收尾。' : '计划共约 ' + planned + ' 章。每章正文生成完成后，才会追加段评和章评。')) + '</p>' +
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
  function globalUserPrompts() {
    try {
      if (!window.NanoPrompts || !NanoPrompts.read) return '';
      var data = NanoPrompts.read();
      var cat = data && data.cats && data.cats.global;
      if (!cat || !cat.custom) return '';
      return cat.custom.filter(function (p) { return p && p.on && String(p.content || '').trim(); })
        .map(function (p) { return String(p.content || '').trim(); }).join('\n');
    } catch (e) { return ''; }
  }
  function styleGuard() {
    var rules = '';
    try { if (window.NanoPrompts && NanoPrompts.styleRules) rules = String(NanoPrompts.styleRules() || ''); } catch (e) {}
    var custom = globalUserPrompts();
    return '【全篇表达红线 · 必须遵守】\n' +
      (rules ? (rules + '\n') : '') +
      (custom ? ('【你的全局提示词 · 同人文适用部分】\n' + custom + '\n') : '') +
      '【同人文补充】这是小说创作，需要完整写双方角色的对白、动作和心理；若全局提示词与“完整写双方”冲突，以完整写双方为准，其余照常遵守。\n' +
      '1. 禁止油腻霸总 / 偶像剧动描：胸腔震动、喉结滚动、眸色一暗、低笑、轻笑、勾唇、似笑非笑、指节泛白、嗓音低哑、下颌线绷紧、慢镜头，也不要把普通动作写成性暗示。\n' +
      '2. 禁止“你在玩火 / 你是我的 / 逃不掉 / 乖 / 听话 / 女人 / 丫头 / 小家伙”等台词和称呼。\n' +
      '3. 禁止 AI 八股和排比升华：“不是…而是…”“那一刻…”“空气突然安静”“心口一紧”“理智的弦断了”“连他自己都没察觉”。\n' +
      '4. 情绪靠具体动作、停顿、答非所问和场景细节表达，不靠形容词堆砌、金句总结、强行煽情。\n' +
      '5. 对话像真人：短句、口语、允许沉默和废话；不要每段都金句，不要每个人都像情感博主。\n' +
      '6. 写之前自检：出现以上词句就整句删掉重写，不要只换同义词，也不要保留这些词做比喻。\n';
  }
  function buildBodyPrompt(no, direction, finale) {
    var prev = story.chapters || [];
    var summaries = prev.map(function (c) {
      return '第' + (c.no || '') + '章《' + (c.title || '') + '》：' + (c.summary || String(c.text || '').slice(0, 120));
    }).join('\n');
    var tail = prev.length ? String(prev[prev.length - 1].text || '').slice(-1000) : '';
    var finalLine = finale
      ? '这是全书的最后一章（大结局）。必须收束主线、回应前文的伏笔，并落在 ' + (story.ending || 'HE') + ' 的结局方向上。'
      : '这是连载中的一章。请完整写完这一章，充分展开，不要压缩成梗概，也不要提前收束。';
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
      '【内容尺度】亲密关系可以写得成熟、细腻，有情感张力和身体反应，但必须服务于人物关系和剧情推进；不要为了露骨而露骨，也不要使用低俗直白的词。\n' +
      '【结局方向】' + (story.ending || 'HE') + '\n' +
      '【篇幅】请完整写完这一章，充分展开，不要压缩成梗概，也不要提前收束。\n' +
      (summaries ? ('【前情摘要】\n' + summaries + '\n') : '') +
      (tail ? ('【上一章结尾】\n' + tail + '\n') : '') +
      (direction ? ('【本章方向】\n' + direction + '\n') : '') +
      '【硬性要求】\n' +
      '1. 只输出正文，不要解释、不要分析、不要作者的话、不要段评或章评。\n' +
      '2. ' + titleRule + ' 章节标题只写标题名，不要带“第 X 章”。\n' +
      '3. 第一行输出「小说标题：……」（仅第 1 章且未定标题时），下一行输出「章节标题：……」，然后空一行开始正文。\n' +
      '4. 正文分段，段与段之间空一行；充分展开场景、对话和人物心理，不要用概括代替具体描写。\n' +
      '5. 文风严格服从【文风】；不要堆砌形容词，不要用“综上所述/总而言之”这类总结句。\n' +
      '6. 以上【配对】【题材】【自定义题材说明】【额外设定】【角色设定】【文风】【结局方向】【前情摘要】【本章方向】全部有效，必须逐条落实，不得擅自更改人物关系、人物设定或结局。\n' +
      '7. ' + finalLine + '\n\n' + styleGuard();
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

  // 单次请求只用一个稳妥的输出上限；不同服务限制不同，失败就静默换小一档。
  // 不在提示词里提任何 token / 上限，避免模型反过来拿“写不下”当借口。
  function isTokenLimitError(msg) {
    return /max.?tokens|too large|maximum.*tokens|token.*limit|context.*length|exceed.*token/i.test(String(msg || ''));
  }
  async function callBody(prompt, words) {
    // 提示词里不写任何字数 / token 限制；输出预算只放在接口参数里。
    // 4096 是主聊天同款量级、绝大多数模型都能接受；10k 字靠分段继续写，不在 prompt 里提长度。
    return await F.callApi([{ role: 'system', content: prompt }], { maxTokens: 4096, temperature: 0.92 });
  }

  function cleanContinuation(raw) {
    var s = String(raw || '').replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
    s = s.replace(/^(?:好的|好|当然|没问题|明白了|收到)[，,。！!：:\s]*/i, '');
    s = s.replace(/^(?:以下是|这是)(?:续写|接续|接下来的|本章的?下一部分)[^\n]*\n+/i, '');
    s = s.replace(/^(?:小说标题|书名)[：:].*\n?/gmi, '');
    s = s.replace(/^(?:章节标题|标题)[：:].*\n?/gmi, '');
    s = s.replace(/^第\s*[0-9一二三四五六七八九十百]+\s*章[：:·\s-]*.*\n+/i, '');
    s = s.replace(/^（?接上文）?[：:\s]*/,'');
    return s.trim();
  }

  // 模型续写时偶尔会把上一段最后几句原样再写一遍，这里把重叠部分切掉
  function trimOverlap(prev, next) {
    var a = String(prev || '');
    var b = String(next || '');
    if (!a || !b) return b;
    var max = Math.min(1000, a.length, b.length);
    for (var len = max; len >= 40; len--) {
      if (a.slice(-len) === b.slice(0, len)) return b.slice(len).trim();
    }
    var na = a.slice(-500).replace(/\s+/g, '');
    var nb = b.slice(0, 500).replace(/\s+/g, '');
    for (var l = Math.min(na.length, nb.length); l >= 30; l--) {
      if (na.slice(-l) === nb.slice(0, l)) {
        return b.slice(Math.min(b.length, l + 16)).trim();
      }
    }
    return b;
  }

  function buildContinuePrompt(no, direction, finale, tail, chunkWords, isFinal) {
    var style = String(story.customStyle || story.writingStyle || '').trim();
    return '你正在续写《' + (story.title || '未命名') + '》第 ' + no + ' 章。\n' +
      '【配对】' + (story.userName || '我') + ' × ' + (story.charName || '角色') + '\n' +
      '【题材】' + ((story.genres || []).join('、') || '未指定') + '\n' +
      ((story.genreNotes && story.genreNotes.length) ? ('【自定义题材说明】\n' + story.genreNotes.join('\n') + '\n') : '') +
      (story.customSetting ? ('【额外设定】\n' + story.customSetting + '\n') : '') +
      (charSetting ? ('【角色设定】\n' + charSetting.slice(0, 2200) + '\n') : '') +
      '【文风】' + (style || '沿用上文的文风，保持全篇统一') + '\n' +
      '【结局方向】' + (story.ending || 'HE') + '\n' +
      (direction ? ('【本章方向】\n' + direction + '\n') : '') +
      '【已有正文结尾】\n' + String(tail || '').slice(-1900) + '\n\n' +
      '【本次要求】\n' +
      '1. 紧接上文继续写下去，直到本章自然结束；充分展开，不要压缩成梗概。\n' +
      '2. 不要重复已有内容，不要重写开头，不要输出章节标题或小说标题，不要解释，不要总结，不要作者的话。\n' +
      '3. 保持人物、场景、语气和叙事视角与上文一致；以上全部设定与文风继续有效，不要因为分段而改变。\n' +
      (isFinal
        ? ('4. 这一部分是本章的收尾：收束本章的矛盾或场景，' + (finale ? '并完成全书大结局。' : '不要写“未完待续”。') + '\n')
        : '4. 这一部分不是本章结尾，不要提前收束全章。\n') +
      '\n' + styleGuard();
  }

  async function generateChapterText(no, direction, finale) {
    var target = Math.max(800, Number(story.wordsPerChapter) || 2000);
    var draft = (story.draft && Number(story.draft.no) === Number(no)) ? story.draft : null;
    var acc = draft ? String(draft.text || '') : '';
    var novelTitle = draft ? String(draft.novelTitle || '') : '';
    var chapterTitle = draft ? String(draft.chapterTitle || '') : '';
    var rounds = 0;
    var maxRounds = Math.min(20, Math.ceil(target / 4000) + 4);

    if (!acc) {
      var prompt = buildBodyPrompt(no, direction, finale);
      showLoading('正在写第 ' + no + ' 章', finale ? '大结局 · 正文优先' : '正文优先，写完后补段评和章评', 12);
      var raw = await callBody(prompt, target);
      var parsed = parseChapter(raw);
      novelTitle = parsed.novelTitle || '';
      chapterTitle = parsed.chapterTitle || '';
      acc = parsed.body || '';
      if (wordCount(acc) < 200) {
        showLoading('正在重写第 ' + no + ' 章', '开头没有完整展开，正在重写', 30);
        raw = await callBody(prompt + '\n【补充要求】正文过短，请重新写这一章的开头，充分展开场景和对话。', target);
        parsed = parseChapter(raw);
        novelTitle = parsed.novelTitle || novelTitle;
        chapterTitle = parsed.chapterTitle || chapterTitle;
        acc = parsed.body || acc;
      }
      if (wordCount(acc) < 120) throw new Error('正文生成失败，请重试');
      story.draft = { no: no, novelTitle: novelTitle, chapterTitle: chapterTitle, text: acc, target: target, ts: Date.now() };
      try { await F.saveAsync(story); } catch (e) {}
      rounds++;
    }

    // 目标很长时多次续写；每次只带上一段结尾，避免上下文越滚越大
    while (wordCount(acc) < target * 0.94 && rounds < maxRounds) {
      var total = wordCount(acc);
      var remaining = Math.max(600, target - total);
      var chunkWords = Math.min(6000, Math.max(1500, remaining));
      var isFinal = (total + chunkWords) >= (target * 0.9);
      var pct = 12 + Math.min(72, Math.round((total / Math.max(1, target)) * 72));
      showLoading('正在续写第 ' + no + ' 章', '已写 ' + total + ' 字 / 目标约 ' + target + ' 字', pct);
      var cont = buildContinuePrompt(no, direction, finale, acc.slice(-1900), chunkWords, isFinal);
      var raw2 = await callBody(cont, chunkWords);
      var cleaned = cleanContinuation(raw2);
      cleaned = trimOverlap(acc, cleaned);
      if (!cleaned || wordCount(cleaned) < 20) break;
      acc = acc.replace(/\s+$/, '') + '\n\n' + cleaned;
      story.draft = { no: no, novelTitle: novelTitle, chapterTitle: chapterTitle, text: acc, target: target, ts: Date.now() };
      try { await F.saveAsync(story); } catch (e) {}
      rounds++;
      if (wordCount(cleaned) < 120) break;
      if (isFinal && wordCount(cleaned) >= 300) break;
    }

    if (wordCount(acc) < 120) throw new Error('正文生成失败，请重试');
    return { novelTitle: novelTitle, chapterTitle: chapterTitle, body: acc.trim() };
  }

  function chapterTextForComments(body) {
    var full = String(body || '');
    if (full.length <= 2200) return full;
    return full.slice(0, 700) + '\n\n……（中间省略）……\n\n' + full.slice(-1300);
  }

  async function generateComments(body, no) {
    var paras = String(body || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    var numbered = paras.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n\n').slice(0, 2200);
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
    var limits = [4096, 2048, 1200];
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
    var existing = (existingTexts || []).slice(-12).join('\n').slice(0, 800);
    var sys = '你是一群真实的中文网文读者。请只针对这一章写新的章评，不要写段评。\n' +
      '【正文】\n' + chapterTextForComments(body) + '\n\n' +
      (existing ? ('【已有的章评（不要重复这些观点和句子）】\n' + existing + '\n\n') : '') +
      '【输出】只输出 JSON：{"chapterComments":[{"user":"读者名","text":"评论"}]}\n' +
      '要求：8-12 条，像真实读者，可以夸、吐槽、猜剧情、催更、讨论人物关系；口语化，不要 emoji，不要剧透后文；读者名 2-6 个中文字，不要重复太多。';
    var raw = '';
    var limits = [4096, 2048, 1200];
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
    var existing = (existingTexts || []).slice(-8).join('\n').slice(0, 800);
    var pnum = Number(para) || 1;
    var from = Math.max(0, pnum - 3), to = Math.min(paras.length, pnum + 2);
    var ctx = paras.slice(from, to).map(function (p, i) { return (from + i + 1) + '. ' + p; }).join('\n\n').slice(0, 1800);
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
      var gen = await generateChapterText(no, direction, finale);
      var parsed = {
        novelTitle: gen.novelTitle || '',
        chapterTitle: gen.chapterTitle || '',
        body: gen.body || ''
      };
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
      delete story.draft;
      showLoading('正在保存这一章', '马上就好', 94);
      var saved = await F.saveAsync(story);
      if (!saved || !saved.ok) throw new Error('保存失败：浏览器存储空间不可用');
      current = story.chapters.length - 1;
      openPara = 0;
      renderAll();
      showLoading('完成', '这一章已经写好了', 100);
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
      if (!commentsOk) toast('正文已生成，段评/章评这次没拿到');
    } catch (e) {
      if (story.draft) {
        story.updatedAt = Date.now();
        try { await F.saveAsync(story); } catch (e2) {}
      }
      var msg = String((e && e.message) || e || '生成失败');
      if (story.draft) msg += '（未完成的草稿已保留，可再点一次继续）';
      toast(msg, 6500);
      try { renderBottom(); } catch (e3) {}
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
  (async function boot() {
    // 旧版书库在 localStorage，新版主存储在 IndexedDB；等两边合并完再找故事，
    // 避免长篇正文写满 localStorage 后刷新出现“找不到这篇故事”。
    try { if (F.ready) await F.ready(); } catch (e) {}
    story = F.get(storyId) || story;
    if (!story) {
      // 极慢设备上 IndexedDB 可能晚于合并超时，再给一次机会再判定丢失
      await new Promise(function (r) { setTimeout(r, 900); });
      story = F.get(storyId) || story;
    }
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
})();
