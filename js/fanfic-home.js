/* ============================================================
   fanfic-home.js — 同人文书架
   ============================================================ */
(function () {
  'use strict';
  var F = window.NanoFanfic;
  if (!F) return;

  var customTab = 'genres';
  function $(id) { return document.getElementById(id); }
  function toast(text) {
    var el = $('ffToast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(window.__ffToast);
    window.__ffToast = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }
  function go(url) { location.href = url; }
  function when(ts) {
    var n = Date.now() - (Number(ts) || 0);
    if (n < 60000) return '刚刚';
    if (n < 3600000) return Math.floor(n / 60000) + ' 分钟前';
    if (n < 86400000) return Math.floor(n / 3600000) + ' 小时前';
    var d = Math.floor(n / 86400000);
    if (d < 30) return d + ' 天前';
    return new Date(ts).toLocaleDateString();
  }

  function render() {
    var uid = window.NanoUserScope ? NanoUserScope.currentUserId() : '';
    var list = F.load().filter(function (s) {
      return !uid || !s.userId || String(s.userId) === String(uid);
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    $('ffCount').textContent = list.length + ' works';
    var shelf = $('ffShelf');
    if (!list.length) {
      shelf.innerHTML = '';
      $('ffEmpty').classList.add('show');
      return;
    }
    $('ffEmpty').classList.remove('show');
    shelf.innerHTML = list.map(function (s, i) {
      var total = s.plannedChapters || F.planFor(s.lengthType).planned;
      var done = (s.chapters || []).length;
      var pct = Math.max(0, Math.min(100, Math.round(done / Math.max(1, total) * 100)));
      var status = s.completed ? 'COMPLETE' : ('CH. ' + done + ' / ' + total);
      return '<div class="ff-work" data-id="' + F.esc(s.id) + '" role="button" tabindex="0">' +
        '<div class="ff-work-top">' +
          '<span class="ff-work-no">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="ff-work-title">' + F.esc(s.title || 'Untitled') + '</span>' +
          '<span class="ff-work-status' + (s.completed ? ' done' : '') + '">' + status + '</span>' +
        '</div>' +
        '<div class="ff-work-meta">' +
          '<span>' + F.esc(s.userName || '你') + ' × ' + F.esc(s.charName || '角色') + '</span>' +
          '<i>·</i><span>' + F.esc(s.ending || 'HE') + '</span>' +
          '<i>·</i><span>' + F.esc(F.planFor(s.lengthType).label) + '</span>' +
          '<i>·</i><span>' + when(s.updatedAt) + '</span>' +
        '</div>' +
        '<div class="ff-work-genres">' + F.esc((s.genres || []).slice(0, 6).join(' / ') || '未选题材') + '</div>' +
        '<div class="ff-progress"><span style="width:' + pct + '%"></span></div>' +
        '<button class="ff-del" data-del="' + F.esc(s.id) + '" type="button">删除</button>' +
      '</div>';
    }).join('');
  }

  function openStory(id) {
    if (!id) return;
    go('fanfic-read.html?id=' + encodeURIComponent(id));
  }

  function renderCustom() {
    var custom = F.loadCustom();
    var list = custom[customTab] || [];
    var box = $('ffCustomList');
    if (!list.length) {
      box.innerHTML = '<div class="ff-custom-empty">还没有自定义' + (customTab === 'genres' ? '题材' : '文风') + '，在下面添加一个。</div>';
      return;
    }
    box.innerHTML = list.map(function (it) {
      return '<div class="ff-custom-item">' +
        '<div class="ff-custom-copy"><div class="ff-custom-title">' + F.esc(it.title) + '</div>' +
        (it.desc ? '<div class="ff-custom-desc">' + F.esc(it.desc) + '</div>' : '') +
        '</div>' +
        '<button class="ff-custom-del" data-del-custom="' + F.esc(it.id) + '" type="button">删除</button>' +
      '</div>';
    }).join('');
  }
  function openCustom() {
    $('ffCustomTitle').value = '';
    $('ffCustomDesc').value = '';
    renderCustom();
    $('ffCustomModal').classList.add('show');
  }
  function closeCustom() { $('ffCustomModal').classList.remove('show'); }
  function addCustom() {
    var title = String($('ffCustomTitle').value || '').trim();
    var desc = String($('ffCustomDesc').value || '').trim();
    if (!title) { toast('先写标题'); return; }
    var custom = F.loadCustom();
    var arr = custom[customTab] || [];
    if (arr.some(function (x) { return String(x.title).toLowerCase() === title.toLowerCase(); })) { toast('已经有一个同名的了'); return; }
    arr.unshift({ id: 'cu_' + Date.now().toString(36), title: title.slice(0, 24), desc: desc.slice(0, 300) });
    custom[customTab] = arr;
    F.saveCustom(custom);
    $('ffCustomTitle').value = '';
    $('ffCustomDesc').value = '';
    renderCustom();
    toast('已添加');
  }

  $('ffShelf').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      var id = del.getAttribute('data-del');
      var s = F.get(id);
      if (!s) return;
      if (!confirm('删除《' + (s.title || 'Untitled') + '》？')) return;
      F.remove(id);
      render();
      toast('已删除');
      return;
    }
    var w = e.target.closest('[data-id]');
    if (w) openStory(w.getAttribute('data-id'));
  });
  $('ffShelf').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var w = e.target.closest('[data-id]');
    if (w) { e.preventDefault(); openStory(w.getAttribute('data-id')); }
  });

  function newStory() { go('fanfic-create.html'); }
  $('ffNew').addEventListener('click', newStory);
  $('ffNew2').addEventListener('click', newStory);
  $('ffNewEmpty').addEventListener('click', newStory);
  $('ffCustom').addEventListener('click', openCustom);
  $('ffCustomClose').addEventListener('click', closeCustom);
  $('ffCustomAdd').addEventListener('click', addCustom);
  $('ffCustomModal').addEventListener('click', function (e) {
    if (e.target === $('ffCustomModal')) closeCustom();
    var tab = e.target.closest('[data-custom-tab]');
    if (tab) {
      customTab = tab.getAttribute('data-custom-tab');
      Array.prototype.forEach.call(document.querySelectorAll('[data-custom-tab]'), function (el) { el.classList.toggle('on', el === tab); });
      renderCustom();
      return;
    }
    var del = e.target.closest('[data-del-custom]');
    if (del) {
      var id = del.getAttribute('data-del-custom');
      var custom = F.loadCustom();
      custom[customTab] = (custom[customTab] || []).filter(function (x) { return String(x.id) !== String(id); });
      F.saveCustom(custom);
      renderCustom();
      toast('已删除');
    }
  });
  $('ffBack').addEventListener('click', function () {
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } catch (e) {}
    }
    if (history.length > 1) history.back();
    else go('discover.html');
  });

  try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoHideOuterHeader' }, '*'); } catch (e) {}
  render();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') render();
  });
})();
