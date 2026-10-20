(function () {
  'use strict';

  var NP = window.NanoPrompts;
  if (!NP) return;

  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = null;
  var editorCat = '';
  var editorId = '';
  var pendingIcon = '';
  var iconPicked = null;

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

  function iconSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 8h8M8 12h5"/></svg>';
  }

  function iconHtml(icon) {
    return icon
      ? '<span class="prompt-icon"><img src="' + esc(icon) + '" alt=""></span>'
      : '<span class="prompt-icon">' + iconSvg() + '</span>';
  }

  function excerpt(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 120) : '空提示词';
  }

  function render() {
    var host = $('promptSections');
    if (!host) return;
    var data = NP.read();
    host.innerHTML = NP.CATS.map(function (cat) {
      var item = data.cats[cat.id] || { active: 'builtin', custom: [] };
      var rows = '';
      rows += '<div class="row prompt-row" data-cat="' + cat.id + '" data-builtin="1">' +
        '<span class="prompt-icon">' + iconSvg() + '</span>' +
        '<span class="prompt-main"><span class="prompt-name">内置提示词</span>' +
        '<span class="prompt-sub">官方内置 · 不可查看或删除</span></span>' +
        '<span class="switch"><input type="checkbox" data-toggle="builtin" data-cat="' + cat.id + '"' + (item.active === 'builtin' ? ' checked' : '') + '><i></i></span>' +
        '</div>';
      rows += item.custom.map(function (p) {
        return '<div class="row prompt-row" data-cat="' + cat.id + '" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
          iconHtml(p.icon) +
          '<span class="prompt-main"><span class="prompt-name">' + esc(p.name) + '</span>' +
          '<span class="prompt-sub">' + esc(excerpt(p.content)) + '</span></span>' +
          '<span class="switch"><input type="checkbox" data-toggle="' + esc(p.id) + '" data-cat="' + cat.id + '"' + (item.active === p.id ? ' checked' : '') + '><i></i></span>' +
          '</div>';
      }).join('');
      rows += '<button class="row add-prompt-row" type="button" data-add="' + cat.id + '">' +
        '<span class="prompt-add-plus">+</span><span>添加提示词</span></button>';
      return '<div class="group-title">' + esc(cat.name) + ' · ' + esc(cat.sub) + '</div>' +
        '<section class="list prompt-card">' + rows + '</section>';
    }).join('');
  }

  function setActive(catId, active) {
    var data = NP.read();
    if (!data.cats[catId]) return;
    data.cats[catId].active = active;
    NP.write(data);
    render();
  }

  function openSheet(title, html) {
    $('promptSheetTitle').textContent = title;
    $('promptSheetBody').innerHTML = html;
    $('promptModal').classList.add('show');
  }

  function closeSheet() {
    $('promptModal').classList.remove('show');
    $('promptSheetBody').innerHTML = '';
    pendingIcon = '';
    editorCat = '';
    editorId = '';
  }

  function openDetail(catId, id) {
    var data = NP.read();
    var item = data.cats[catId];
    var p = item && item.custom.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    openSheet('提示词详情',
      '<div class="prompt-detail-head">' + iconHtml(p.icon) +
        '<span class="prompt-main"><span class="prompt-name">' + esc(p.name) + '</span>' +
        '<span class="prompt-sub">' + esc(NP.catInfo(catId) ? NP.catInfo(catId).name : '') + ' · ' + (item.active === id ? '已开启' : '未开启') + '</span></span></div>' +
      '<div class="prompt-detail">' + esc(p.content) + '</div>' +
      '<button class="sheet-btn" id="promptEditBtn">编辑提示词</button>' +
      '<button class="sheet-btn grey" id="promptDeleteBtn">删除提示词</button>'
    );
    $('promptEditBtn').addEventListener('click', function () { openEditor(catId, id); });
    $('promptDeleteBtn').addEventListener('click', function () {
      if (!confirm('删除提示词「' + p.name + '」？')) return;
      var d = NP.read();
      var c = d.cats[catId];
      c.custom = c.custom.filter(function (x) { return x.id !== id; });
      if (c.active === id) c.active = null;
      NP.write(d);
      closeSheet();
      render();
      toast('提示词已删除');
    });
  }

  function openEditor(catId, id) {
    var data = NP.read();
    var cat = data.cats[catId];
    var p = id ? cat.custom.filter(function (x) { return x.id === id; })[0] : null;
    editorCat = catId;
    editorId = p ? p.id : '';
    pendingIcon = p ? (p.icon || '') : '';
    openSheet(p ? '编辑提示词' : '添加提示词',
      '<div class="prompt-form-icon" id="promptIconPreview">' + iconHtml(pendingIcon) + '</div>' +
      '<div class="prompt-icon-actions">' +
        '<button class="mini-btn" type="button" id="promptPickIcon">导入 SVG 图标</button>' +
        '<button class="mini-btn" type="button" id="promptClearIcon">清除图标</button>' +
      '</div>' +
      '<div class="prompt-form-label">名称</div>' +
      '<input class="text-input prompt-name-input" id="promptNameInput" maxlength="40" placeholder="例如：温柔克制版" value="' + esc(p ? p.name : '') + '">' +
      '<div class="prompt-form-label">提示词内容</div>' +
      '<textarea class="prompt-textarea" id="promptContentInput" maxlength="20000" placeholder="写下希望 Nano 遵守的提示词">' + esc(p ? p.content : '') + '</textarea>' +
      '<button class="sheet-btn" id="promptSaveBtn">保存</button>'
    );
    $('promptPickIcon').addEventListener('click', function () {
      iconPicked = function (icon) {
        pendingIcon = icon;
        var box = $('promptIconPreview');
        if (box) box.innerHTML = iconHtml(icon);
      };
      var f = $('promptIconFile');
      if (f) f.click();
    });
    $('promptClearIcon').addEventListener('click', function () {
      pendingIcon = '';
      var box = $('promptIconPreview');
      if (box) box.innerHTML = iconHtml('');
    });
    $('promptSaveBtn').addEventListener('click', function () {
      var name = String($('promptNameInput').value || '').trim() || '未命名提示词';
      var content = String($('promptContentInput').value || '').trim();
      if (!content) { toast('请填写提示词内容'); return; }
      var d = NP.read();
      var c = d.cats[editorCat];
      if (!c) return;
      var wasEdit = !!editorId;
      if (editorId) {
        var found = null;
        c.custom.some(function (x) { if (x.id === editorId) { found = x; return true; } return false; });
        if (found) {
          found.name = name;
          found.content = content;
          found.icon = pendingIcon;
          found.at = Date.now();
        }
      } else {
        var item = { id: NP.newId(), name: name, content: content, icon: pendingIcon, at: Date.now() };
        c.custom.push(item);
      }
      NP.write(d);
      closeSheet();
      render();
      toast(wasEdit ? '提示词已保存' : '提示词已添加，可用开关启用');
    });
  }

  function onIconFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var isSvg = /\.svg$/i.test(f.name || '') || /image\/svg\+xml/i.test(f.type || '');
    if (!isSvg) { toast('请选择 SVG 图标文件'); e.target.value = ''; return; }
    if (f.size > 200 * 1024) { toast('SVG 文件不能超过 200KB'); e.target.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      if (!/<svg[\s>]/i.test(text)) { toast('SVG 读取失败'); return; }
      var result = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
      if (iconPicked) iconPicked(result);
    };
    reader.onerror = function () { toast('SVG 读取失败'); };
    reader.readAsText(f);
    e.target.value = '';
  }

  function bind() {
    var host = $('promptSections');
    if (host) {
      host.addEventListener('click', function (e) {
        if (e.target.closest('.switch')) return;
        var add = e.target.closest('[data-add]');
        if (add) { openEditor(add.getAttribute('data-add'), ''); return; }
        var row = e.target.closest('.prompt-row[data-id]');
        if (row) openDetail(row.getAttribute('data-cat'), row.getAttribute('data-id'));
      });
      host.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('.switch')) return;
        var row = e.target.closest && e.target.closest('.prompt-row[data-id]');
        if (!row) return;
        e.preventDefault();
        openDetail(row.getAttribute('data-cat'), row.getAttribute('data-id'));
      });
      host.addEventListener('change', function (e) {
        var input = e.target;
        if (!input || input.type !== 'checkbox') return;
        var catId = input.getAttribute('data-cat');
        var toggle = input.getAttribute('data-toggle');
        if (!catId || !toggle) return;
        if (toggle === 'builtin') setActive(catId, input.checked ? 'builtin' : null);
        else setActive(catId, input.checked ? toggle : null);
      });
    }
    var close = $('promptSheetClose');
    if (close) close.addEventListener('click', closeSheet);
    var modal = $('promptModal');
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeSheet(); });
    var file = $('promptIconFile');
    if (file) file.addEventListener('change', onIconFile);
    window.addEventListener('storage', function (e) { if (e.key === NP.KEY) render(); });
  }

  bind();
  render();
})();
