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

  // 四个板块使用不同 SVG；用户自己导入的 SVG 图标保持原样，不替换
  function catIconSvg(catId) {
    if (catId === 'offline') {
      return '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9"/><path d="M9.5 19v-5h5v5"/></svg>';
    }
    if (catId === 'online') {
      return '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 5h4"/><circle cx="12" cy="18" r="1"/><path d="M9 9h6M9 12.5h4"/></svg>';
    }
    if (catId === 'group') {
      return '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17.5" cy="9" r="2.2"/><path d="M15.5 14.2c2.8-.4 5 1.4 5 4.3"/></svg>';
    }
    if (catId === 'global') {
      return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21M12 3C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9"/></svg>';
    }
    if (catId === 'imessage') return '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 8h8M8 12h5"/></svg>';
    if (catId === 'ins') return '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".8" fill="currentColor" stroke="none"/></svg>';
    if (catId === 'halo') return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
    if (catId === 'music') return '<svg viewBox="0 0 24 24"><path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';
    if (catId === 'moments') return '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5-5 5-3-3-5 5"/></svg>';
    if (catId === 'phone') return '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a14 14 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"/></svg>';
    if (catId === 'call') return '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10 5-3v10l-5-3"/></svg>';
    if (catId === 'books') return '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 5.5v16M8 7h8M8 11h6"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M12 3.2l1.6 4.1 4.2 1.6-4.2 1.6L12 14.6l-1.6-4.1-4.2-1.6 4.2-1.6Z"/><path d="M18.5 14.5l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9Z"/><path d="M5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7Z"/></svg>';
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
        '<span class="prompt-icon">' + catIconSvg(cat.id) + '</span>' +
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
        '<span class="prompt-add-plus">' + catIconSvg(cat.id) + '</span><span>添加提示词</span></button>';
      return '<div class="group-title"><span class="prompt-cat-icon">' + catIconSvg(cat.id) + '</span>' + esc(cat.name) + ' · ' + esc(cat.sub) + '</div>' +
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

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('文件读取失败')); };
      r.readAsText(file);
    });
  }

  function jsonToPromptText(raw) {
    var d;
    try { d = JSON.parse(raw); } catch (e) { return raw; }
    var keys = ['content', 'prompt', 'system', 'text', 'value', 'body'];
    function walk(v, depth) {
      if (typeof v === 'string') return v;
      if (!v || depth > 6) return '';
      if (Array.isArray(v)) {
        return v.map(function (x) { return walk(x, depth + 1); }).filter(Boolean).join('\n\n');
      }
      if (typeof v === 'object') {
        for (var i = 0; i < keys.length; i++) {
          if (typeof v[keys[i]] === 'string' && v[keys[i]].trim()) return v[keys[i]];
        }
        var out = [];
        Object.keys(v).forEach(function (k) {
          var s = walk(v[k], depth + 1);
          if (s) out.push(s);
        });
        return out.join('\n\n');
      }
      return '';
    }
    return walk(d, 0) || raw;
  }

  function docxXmlToText(xml) {
    return String(xml || '')
      .replace(/<w:tab[^>]*\/>/gi, '\t')
      .replace(/<w:br[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function readDocxText(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压 docx，请另存为 txt');
    var buf = await file.arrayBuffer();
    var dv = new DataView(buf);
    var off = 0;
    while (off + 30 <= buf.byteLength) {
      if (dv.getUint32(off, true) !== 0x04034b50) break;
      var flags = dv.getUint16(off + 6, true);
      var method = dv.getUint16(off + 8, true);
      var csize = dv.getUint32(off + 18, true);
      var nlen = dv.getUint16(off + 26, true);
      var elen = dv.getUint16(off + 28, true);
      var name = new TextDecoder('utf-8').decode(new Uint8Array(buf, off + 30, nlen));
      var start = off + 30 + nlen + elen;
      var data = new Uint8Array(buf, start, csize);
      if (name === 'word/document.xml') {
        if (method === 8) {
          var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          data = new Uint8Array(await new Response(stream).arrayBuffer());
        }
        return docxXmlToText(new TextDecoder('utf-8').decode(data));
      }
      off = start + csize;
      if (!csize && (flags & 0x08)) {
        // 数据描述符：向后寻找下一个 local header
        var p = start;
        while (p + 4 <= buf.byteLength) {
          if (dv.getUint32(p, true) === 0x04034b50) break;
          p++;
        }
        off = p;
      }
    }
    throw new Error('docx 中没有找到正文');
  }

  function readLegacyDocText(buf) {
    function score(s) {
      var m = s.match(/[\u4e00-\u9fff]/g);
      return m ? m.length : 0;
    }
    var u8 = new TextDecoder('utf-8').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
    var u16 = new TextDecoder('utf-16le').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
    var best = score(u16) > score(u8) ? u16 : u8;
    best = best.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (best.length < 8) throw new Error('无法读取这个 .doc，请另存为 docx 或 txt');
    return best;
  }

  async function readPromptFile(file) {
    var name = String(file.name || '').toLowerCase();
    if (/\.docx$/.test(name)) return readDocxText(file);
    if (/\.doc$/.test(name)) return readLegacyDocText(await file.arrayBuffer());
    var text = await readAsText(file);
    if (/\.json$/.test(name)) return jsonToPromptText(text);
    return text;
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
        '<button class="mini-btn" type="button" id="promptImportBtn" style="display:inline-flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></svg>导入提示词文件</button>' +
        '<input type="file" id="promptImportFile" accept=".txt,.md,.markdown,.json,.doc,.docx,.rtf,text/plain,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none">' +
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
    var importBtn = $('promptImportBtn');
    var importFile = $('promptImportFile');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', async function () {
        var f = importFile.files && importFile.files[0];
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) { toast('文件不能超过 8MB'); importFile.value = ''; return; }
        try {
          var text = String(await readPromptFile(f) || '').trim();
          if (!text) { toast('文件里没有可导入的文字'); importFile.value = ''; return; }
          var ta = $('promptContentInput');
          if (ta) {
            var cur = String(ta.value || '').trim();
            ta.value = cur ? (cur + '\n\n' + text) : text;
            ta.scrollTop = ta.scrollHeight;
          }
          var nameInput = $('promptNameInput');
          if (nameInput && !String(nameInput.value || '').trim()) {
            nameInput.value = String(f.name || '').replace(/\.[^.]+$/, '').slice(0, 40);
          }
          toast('已导入 ' + f.name);
        } catch (e) {
          toast((e && e.message) || '导入失败');
        }
        importFile.value = '';
      });
    }
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
