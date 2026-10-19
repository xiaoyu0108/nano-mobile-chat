/* ============================================================
   fanfic-create.js — 新建同人文
   ============================================================ */
(function () {
  'use strict';
  var F = window.NanoFanfic;
  if (!F) return;

  var chars = [];
  var selectedCharId = '';
  var genres = [];
  var ending = 'HE';
  var lengthType = 'short';
  var writingStyle = '';
  var selectedCustomStyle = null;
  var customLib = { genres: [], styles: [] };
  var started = false;

  function $(id) { return document.getElementById(id); }
  function toast(text) {
    var el = $('ffToast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(window.__ffToast);
    window.__ffToast = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }
  function currentUser() {
    return window.NanoUserScope ? NanoUserScope.currentUser() : null;
  }

  async function loadChars() {
    try {
      chars = window.NanoUserScope ? await NanoUserScope.loadChars() : [];
    } catch (e) { chars = []; }
    var box = $('ffChars');
    if (!chars.length) {
      box.innerHTML = '';
      $('ffNoChars').style.display = 'block';
      return;
    }
    $('ffNoChars').style.display = 'none';
    box.innerHTML = chars.map(function (c) {
      var av = c.avatar ? '<img src="' + F.esc(c.avatar) + '" alt="">' : F.esc(String(c.name || '?').slice(0, 1));
      return '<button class="ff-char" type="button" data-id="' + F.esc(c.id) + '">' +
        '<span class="ff-char-av">' + av + '</span>' +
        '<span class="ff-char-name">' + F.esc(c.name || '') + '</span>' +
        '<span class="ff-char-sub">' + (c.gender && c.gender !== '未知' ? F.esc(c.gender) : '角色') + '</span>' +
      '</button>';
    }).join('');
  }

  function renderGenres() {
    var box = $('ffGenres');
    var html = F.GENRES.map(function (g) {
      return '<div class="ff-genre-group">' +
        '<div class="ff-genre-title">' + F.esc(g.group) + '</div>' +
        '<div class="ff-chips">' + g.items.map(function (name) {
          return '<button class="ff-chip' + (genres.indexOf(name) >= 0 ? ' on' : '') + '" type="button" data-genre="' + F.esc(name) + '">' + F.esc(name) + '</button>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');
    if (customLib.genres.length) {
      html += '<div class="ff-genre-group"><div class="ff-genre-title">自定义</div><div class="ff-chips">' +
        customLib.genres.map(function (it) {
          return '<button class="ff-chip' + (genres.indexOf(it.title) >= 0 ? ' on' : '') + '" type="button" data-genre="' + F.esc(it.title) + '" title="' + F.esc(it.desc || '') + '">' + F.esc(it.title) + '</button>';
        }).join('') + '</div></div>';
    }
    box.innerHTML = html;
    updateCustomGenreHint();
  }

  function updateCustomGenreHint() {
    var el = $('ffCustomGenreHint');
    if (!el) return;
    var notes = customLib.genres.filter(function (it) { return genres.indexOf(it.title) > -1 && it.desc; });
    el.textContent = notes.length ? notes.map(function (it) { return it.title + '：' + it.desc; }).join('\n') : '';
    el.style.whiteSpace = notes.length ? 'pre-line' : '';
  }

  function renderStyles() {
    var box = $('ffStyles');
    var html = (F.STYLES || []).map(function (name) {
      return '<button class="ff-chip' + (writingStyle === name && !selectedCustomStyle ? ' on' : '') + '" type="button" data-style="' + F.esc(name) + '">' + F.esc(name) + '</button>';
    }).join('');
    if (customLib.styles.length) {
      html += customLib.styles.map(function (it) {
        return '<button class="ff-chip' + (selectedCustomStyle && selectedCustomStyle.id === it.id ? ' on' : '') + '" type="button" data-style="' + F.esc(it.title) + '" data-custom-style="' + F.esc(it.id) + '" title="' + F.esc(it.desc || '') + '">' + F.esc(it.title) + '</button>';
      }).join('');
    }
    box.innerHTML = html;
    var hint = $('ffCustomStyleHint');
    if (hint) hint.textContent = selectedCustomStyle && selectedCustomStyle.desc ? selectedCustomStyle.desc : '';
  }

  function updatePlan() {
    var plan = F.planFor(lengthType);
    var words = parseInt($('ffWords').value, 10) || 2000;
    $('ffPlanHint').textContent = '计划约 ' + plan.planned + ' 章（' + plan.range + '），每章约 ' + words + ' 字。';
  }

  function setSelectedChar(id) {
    selectedCharId = id || '';
    Array.prototype.forEach.call(document.querySelectorAll('.ff-char'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-id') === selectedCharId);
    });
  }

  function start() {
    if (started) return;
    var char = chars.find(function (c) { return String(c.id) === String(selectedCharId); });
    if (!char) { toast('先选择一个角色'); return; }
    if (!genres.length) { toast('至少选一个题材'); return; }
    var words = Math.max(800, Math.min(6000, parseInt($('ffWords').value, 10) || 2000));
    var plan = F.planFor(lengthType);
    var u = currentUser();
    var genreNotes = customLib.genres.filter(function (it) { return genres.indexOf(it.title) > -1 && it.desc; })
      .map(function (it) { return it.title + '：' + it.desc; });
    var customStyleText = String($('ffCustomStyle').value || '').trim();
    if (selectedCustomStyle) {
      customStyleText = selectedCustomStyle.title + (customStyleText ? ('：' + customStyleText) : (selectedCustomStyle.desc ? ('：' + selectedCustomStyle.desc) : ''));
    }
    var story = {
      id: F.uid(),
      userId: window.NanoUserScope ? NanoUserScope.currentUserId() : '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: String($('ffTitle').value || '').trim(),
      userName: (u && u.name) || (window.NanoUserScope ? NanoUserScope.currentUserName() : '我'),
      charId: String(char.id),
      charName: char.name || '角色',
      charAvatar: char.avatar || '',
      genres: genres.slice(),
      genreNotes: genreNotes,
      customSetting: String($('ffSetting').value || '').trim(),
      writingStyle: writingStyle,
      customStyle: customStyleText,
      ending: ending,
      lengthType: lengthType,
      plannedChapters: plan.planned,
      wordsPerChapter: words,
      chapters: [],
      completed: false
    };
    started = true;
    F.save(story);
    location.href = 'fanfic-read.html?id=' + encodeURIComponent(story.id) + '&start=1';
  }

  $('ffChars').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-id]');
    if (btn) setSelectedChar(btn.getAttribute('data-id'));
  });
  $('ffGenres').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-genre]');
    if (!btn) return;
    var name = btn.getAttribute('data-genre');
    var i = genres.indexOf(name);
    if (i >= 0) genres.splice(i, 1); else genres.push(name);
    btn.classList.toggle('on', genres.indexOf(name) >= 0);
    updateCustomGenreHint();
  });
  $('ffEnding').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-ending]');
    if (!btn) return;
    ending = btn.getAttribute('data-ending');
    Array.prototype.forEach.call($('ffEnding').querySelectorAll('.ff-seg'), function (el) {
      el.classList.toggle('on', el === btn);
    });
  });
  $('ffLength').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-length]');
    if (!btn) return;
    lengthType = btn.getAttribute('data-length');
    Array.prototype.forEach.call($('ffLength').querySelectorAll('.ff-seg'), function (el) {
      el.classList.toggle('on', el === btn);
    });
    updatePlan();
  });
  $('ffStyles').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-style]');
    if (!btn) return;
    var name = btn.getAttribute('data-style');
    var cid = btn.getAttribute('data-custom-style');
    if (cid) {
      var it = customLib.styles.find(function (x) { return String(x.id) === String(cid); });
      if (selectedCustomStyle && selectedCustomStyle.id === cid) {
        selectedCustomStyle = null;
        writingStyle = '';
      } else {
        selectedCustomStyle = it || null;
        writingStyle = name;
        if (it && it.desc) $('ffCustomStyle').value = it.desc;
      }
    } else {
      selectedCustomStyle = null;
      writingStyle = writingStyle === name ? '' : name;
    }
    renderStyles();
  });
  $('ffWordQuick').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-words]');
    if (!btn) return;
    $('ffWords').value = btn.getAttribute('data-words');
    Array.prototype.forEach.call($('ffWordQuick').querySelectorAll('.ff-chip'), function (el) {
      el.classList.toggle('on', el === btn);
    });
    updatePlan();
  });
  $('ffWords').addEventListener('input', updatePlan);
  $('ffStart').addEventListener('click', start);
  $('ffBack').addEventListener('click', function () {
    if (history.length > 1) history.back();
    else location.href = 'fanfic.html';
  });

  try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoHideOuterHeader' }, '*'); } catch (e) {}
  try { customLib = F.loadCustom(); } catch (e) { customLib = { genres: [], styles: [] }; }
  renderGenres();
  renderStyles();
  updatePlan();
  loadChars();
})();
