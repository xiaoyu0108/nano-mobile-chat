(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  var APPS = [
    { id: 'chat', name: '聊天' }, { id: 'api', name: 'API' }, { id: 'couple', name: '情侣空间' },
    { id: 'halo', name: 'Halo' }, { id: 'instagram', name: 'Instagram' }, { id: 'together', name: '一起看' },
    { id: 'music', name: '音乐' }, { id: 'memory', name: '记忆宫殿' }, { id: 'imessage', name: 'iMessage' },
    { id: 'peek', name: '窥屏' }, { id: 'market', name: '共享集市' }, { id: 'shop', name: '商城' },
    { id: 'schedule', name: '日程' }, { id: 'mcp', name: 'MCP' }, { id: 'tide', name: '月潮' },
    { id: 'fanfic', name: '同人文' }, { id: 'store', name: '应用商店' }, { id: 'book', name: '世界书' },
    { id: 'beauty', name: '美化' }, { id: 'phone', name: '查手机' }, { id: 'settings', name: '设置' }
  ];
  var IDB_BG = 'nano_desktop_bg';
  var IDB_CUSTOM = 'nano_app_custom';
  var IDB_PRESETS = 'nano_desktop_presets';
  var IDB_LAYOUT = 'nano_widget_layout_v1';
  var IDB_IMGS = 'nano_widget_images_v1';
  var toastTimer = null;
  var bg = null;
  var custom = {};
  var presets = [];
  var pendingIcon = '';
  var editingApp = '';

  var NN = null;
  try { NN = window.parent && window.parent.NanoNotify ? window.parent.NanoNotify : window.NanoNotify; } catch (e) {}
  var NP = null;
  try { NP = window.parent && window.parent.NanoPush ? window.parent.NanoPush : window.NanoPush; } catch (e) {}

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function post(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function openPage(url, title) {
    if (!post({ type: 'openFullscreen', url: url, title: title || '', showBack: true, source: 'settings' })) {
      try { location.href = url; } catch (e) {}
    }
  }

  function notifyHome(layout) {
    post({ type: 'nanoDesktopChanged', layout: !!layout });
  }

  function openSheet(title, html) {
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = html;
    $('modal').classList.add('show');
  }

  function closeSheet() {
    $('modal').classList.remove('show');
    $('sheetBody').innerHTML = '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMB(n) {
    if (!isFinite(n) || n <= 0) return '0 MB';
    if (n > 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function idbOpen(name, version, stores) {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(name, version);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          (stores || []).forEach(function (s) {
            if (!db.objectStoreNames.contains(s.name)) {
              db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
            }
          });
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }

  function idbGet(name, version, store, key, stores) {
    return idbOpen(name, version, stores).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(store, 'readonly').objectStore(store).get(key);
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  function loadMask() {
    try {
      var raw = localStorage.getItem('nano_mask_data');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) return Promise.resolve(d);
      }
    } catch (e) {}
    return idbGet('nano_mask_db', 1, 'mask_data', 'data', [{ name: 'mask_data', keyPath: 'key' }]).then(function (row) {
      return row && row.value && Array.isArray(row.value.masks) ? row.value : { masks: [], currentMaskId: null };
    });
  }

  function currentMask(data) {
    if (!data || !data.masks || !data.masks.length) return null;
    return data.masks.find(function (m) { return String(m.id) === String(data.currentMaskId); }) || data.masks[0];
  }

  function getMaskAvatar(id) {
    return idbGet('MaskAvatarDB', 1, 'avatars', id, [{ name: 'avatars', keyPath: 'id' }]).then(function (row) {
      return row && row.data ? row.data : '';
    });
  }

  function resizeImage(file, max, type, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取失败')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片无法解析')); };
        img.onload = function () {
          var w = img.width, h = img.height, scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          try { resolve(canvas.toDataURL(type || 'image/jpeg', quality || .86)); }
          catch (e) { reject(e); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function loadAll() {
    return Promise.all([
      NanoIDB.get(IDB_BG),
      NanoIDB.get(IDB_CUSTOM),
      NanoIDB.get(IDB_PRESETS),
      loadMask()
    ]).then(function (r) {
      bg = r[0] || null;
      custom = r[1] && typeof r[1] === 'object' ? r[1] : {};
      presets = Array.isArray(r[2]) ? r[2] : [];
      var data = r[3];
      var m = currentMask(data);
      renderInfo(m, data);
    }).catch(function () {
      renderInfo(null, { masks: [] });
    });
  }

  function renderInfo(m, data) {
    var av = $('idAvatar'), nm = $('idName'), sub = $('idSub');
    if (!av || !nm || !sub) return;
    var name = m && m.name ? m.name : '纳米用户';
    nm.textContent = name;
    sub.textContent = '纳米 ID · 本地账号' + (data && data.masks ? ' · ' + data.masks.length + ' 个面具' : '');
    av.textContent = String(name).charAt(0).toUpperCase();
    av.style.backgroundImage = '';
    if (m && m.id) {
      getMaskAvatar(m.id).then(function (url) {
        if (!url) return;
        av.style.backgroundImage = 'url("' + String(url).replace(/"/g, '\\"') + '")';
        av.textContent = '';
      });
    }
  }

  function renderValues() {
    var bgv = $('bgValue');
    if (bgv) bgv.textContent = bg && bg.type === 'image' ? '自定义图片' : (bg && bg.type === 'color' ? '纯色' : '默认');
    var av = $('appsValue');
    if (av) {
      var n = Object.keys(custom || {}).length;
      av.textContent = n ? n + ' 个已自定义' : '默认';
    }
    var pv = $('presetsValue');
    if (pv) pv.textContent = presets.length + ' 个';
    var size = $('ballSize');
    var sizeVal = $('ballSizeValue');
    var settings = readBall();
    if (size) size.value = String(settings.size || 52);
    if (sizeVal) sizeVal.textContent = String(settings.size || 52);
    var bt = $('ballToggle');
    if (bt) bt.checked = settings.enabled !== false;
    refreshStorage();
    refreshNotify();
  }

  function readBall() {
    try {
      var raw = localStorage.getItem('nanoApiBall');
      var s = raw ? JSON.parse(raw) : {};
      return Object.assign({ enabled: true, size: 52, icon: 'classic', x: null, y: null }, s || {});
    } catch (e) {
      return { enabled: true, size: 52, icon: 'classic', x: null, y: null };
    }
  }

  function writeBall(settings) {
    try { localStorage.setItem('nanoApiBall', JSON.stringify(settings)); } catch (e) {}
    post({ type: 'apiBallSettings', settings: settings });
    var sizeVal = $('ballSizeValue');
    if (sizeVal) sizeVal.textContent = String(settings.size || 52);
  }

  function refreshStorage() {
    var el = $('storageUsage');
    if (!el) return;
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (e) {
        el.textContent = fmtMB(e.usage || 0) + ' / ' + fmtMB(e.quota || 0);
      }).catch(function () { el.textContent = '不可用'; });
    } else {
      el.textContent = '不可用';
    }
  }

  function refreshNotify() {
    var keep = $('keepToggle');
    if (keep) keep.checked = localStorage.getItem('nano_keep_alive') === '1';
    var notify = $('notifyToggle');
    if (notify) notify.checked = localStorage.getItem('nano_notify_enabled') === '1';
    var bark = $('barkToggle');
    if (bark && NN) bark.checked = NN.barkEnabled ? !!NN.barkEnabled() : true;
    var keyInput = $('barkKeyInput');
    if (keyInput && NN && NN.barkKey) {
      keyInput.value = NN.barkKey() || '';
      if (!keyInput.value && NN.barkKeyAsync) NN.barkKeyAsync().then(function (k) { if (k && !keyInput.value) keyInput.value = k; });
    }
    var row = $('barkKeyRow');
    if (row) row.classList.toggle('show', !!(bark && bark.checked));
    fillSounds();
    refreshPush();
  }

  function fillSounds() {
    var sel = $('soundSelect');
    if (!sel || !NN || !NN.sounds) return;
    if (sel.options.length) return;
    var cur = localStorage.getItem('nano_notify_sound') || 'ding';
    NN.sounds.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id || s.key || s.name;
      o.textContent = s.name || s.label || s.id || '提示音';
      if (o.value === cur) o.selected = true;
      sel.appendChild(o);
    });
  }

  function refreshPush() {
    var status = $('webPushStatus');
    var btn = $('webPushBtn');
    if (!status) return;
    if (!NP) { status.textContent = '未加载'; if (btn) btn.textContent = '不可用'; return; }
    Promise.resolve(NP.status ? NP.status() : null).then(function (s) {
      if (!s) { status.textContent = '可开启'; if (btn) btn.textContent = '开启'; return; }
      if (s.permission === 'denied') { status.textContent = '权限被拒绝'; if (btn) btn.textContent = '重试'; }
      else if (s.subscribed) { status.textContent = '已开启'; if (btn) btn.textContent = '重新订阅'; }
      else if (s.configured) { status.textContent = '已配置'; if (btn) btn.textContent = '开启'; }
      else { status.textContent = '未配置'; if (btn) btn.textContent = '开启'; }
    }).catch(function () { status.textContent = '检查失败'; });
  }

  function setBg(next) {
    bg = next;
    renderValues();
    var p = next ? NanoIDB.set(IDB_BG, next) : NanoIDB.del(IDB_BG);
    Promise.resolve(p).then(function () { notifyHome(false); });
  }

  function openBgSheet() {
    openSheet('桌面背景',
      '<button class="sheet-btn" id="pickBg">选择图片</button>' +
      '<div class="swatches">' +
        '<button class="swatch" data-color="#ffffff" style="background:#fff" aria-label="白色"></button>' +
        '<button class="swatch" data-color="#f2f2f7" style="background:#f2f2f7" aria-label="浅灰"></button>' +
        '<button class="swatch" data-color="#d1d1d6" style="background:#d1d1d6" aria-label="灰色"></button>' +
        '<button class="swatch" data-color="#8e8e93" style="background:#8e8e93" aria-label="深灰"></button>' +
        '<button class="swatch" data-color="#111111" style="background:#111" aria-label="黑色"></button>' +
      '</div>' +
      '<button class="sheet-btn grey" id="resetBg">恢复默认背景</button>'
    );
    var pick = $('pickBg');
    if (pick) pick.addEventListener('click', function () { $('bgFile').click(); });
    var reset = $('resetBg');
    if (reset) reset.addEventListener('click', function () { setBg(null); closeSheet(); toast('已恢复默认背景'); });
    $('sheetBody').querySelectorAll('.swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        setBg({ type: 'color', value: b.dataset.color, at: Date.now() });
        closeSheet();
        toast('桌面背景已更新');
      });
    });
  }

  function openAppsSheet() {
    var rows = APPS.map(function (a) {
      var c = custom[a.id] || {};
      var name = c.name || a.name;
      var preview = c.icon ? '<span class="app-preview"><img src="' + esc(c.icon) + '" alt=""></span>' : '<span class="app-preview">' + esc(String(name).charAt(0)) + '</span>';
      return '<button class="list-row" data-app="' + a.id + '">' + preview +
        '<span class="list-main"><span class="list-name">' + esc(name) + '</span><span class="list-sub">' + esc(c.name || c.icon ? '已自定义' : '默认') + '</span></span>' +
        '<span class="chev">›</span></button>';
    }).join('');
    openSheet('App 图标与名称', rows);
    $('sheetBody').querySelectorAll('[data-app]').forEach(function (row) {
      row.addEventListener('click', function () { openAppEditor(row.dataset.app); });
    });
  }

  function openAppEditor(id) {
    var a = APPS.find(function (x) { return x.id === id; });
    if (!a) return;
    editingApp = id;
    pendingIcon = (custom[id] && custom[id].icon) || '';
    var name = (custom[id] && custom[id].name) || a.name;
    openSheet('编辑 ' + a.name,
      '<div class="edit-preview"><span class="app-preview" id="editPreview">' + (pendingIcon ? '<img src="' + esc(pendingIcon) + '" alt="">' : esc(String(name).charAt(0))) + '</span>' +
      '<button class="mini-btn" id="pickIcon">选择图标</button></div>' +
      '<input class="edit-name" id="editName" maxlength="12" value="' + esc(name) + '" placeholder="App 名称">' +
      '<button class="sheet-btn" id="saveApp">保存</button>' +
      '<button class="sheet-btn grey" id="resetApp">恢复默认</button>'
    );
    var pick = $('pickIcon');
    if (pick) pick.addEventListener('click', function () { $('iconFile').click(); });
    var save = $('saveApp');
    if (save) save.addEventListener('click', function () {
      var v = ($('editName').value || '').trim() || a.name;
      var patch = {};
      if (v !== a.name) patch.name = v;
      if (pendingIcon) patch.icon = pendingIcon;
      if (Object.keys(patch).length) custom[id] = patch; else delete custom[id];
      NanoIDB.set(IDB_CUSTOM, custom).then(function () { notifyHome(false); });
      renderValues();
      closeSheet();
      toast('已保存');
    });
    var reset = $('resetApp');
    if (reset) reset.addEventListener('click', function () {
      delete custom[id];
      NanoIDB.set(IDB_CUSTOM, custom).then(function () { notifyHome(false); });
      renderValues();
      closeSheet();
      toast('已恢复默认');
    });
  }

  function openPresetsSheet() {
    var html = '<button class="sheet-btn" id="savePreset">保存当前桌面为预设</button>';
    if (presets.length) {
      html += presets.map(function (p) {
        return '<div class="list-row" data-preset="' + esc(p.id) + '">' +
          '<span class="list-main"><span class="list-name">' + esc(p.name || '未命名预设') + '</span>' +
          '<span class="list-sub">' + new Date(p.at || Date.now()).toLocaleString() + '</span></span>' +
          '<span class="preset-actions">' +
            '<button class="mini-btn dark" data-act="apply">切换</button>' +
            '<button class="mini-btn" data-act="overwrite">覆盖</button>' +
            '<button class="mini-btn" data-act="delete">删除</button>' +
          '</span></div>';
      }).join('');
    } else {
      html += '<div class="note">还没有预设。保存后会出现在这里，可以随时切换、覆盖或删除。</div>';
    }
    openSheet('桌面装饰预设', html);
    var save = $('savePreset');
    if (save) save.addEventListener('click', savePreset);
    $('sheetBody').querySelectorAll('[data-preset]').forEach(function (row) {
      var id = row.dataset.preset;
      row.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var act = b.dataset.act;
          if (act === 'apply') applyPreset(id);
          else if (act === 'overwrite') overwritePreset(id);
          else if (act === 'delete') deletePreset(id);
        });
      });
    });
  }

  async function savePreset() {
    var name = prompt('预设名称', '桌面 ' + (presets.length + 1));
    if (name == null) return;
    name = String(name).trim() || '未命名预设';
    var layout = await NanoIDB.get(IDB_LAYOUT);
    var imgs = await NanoIDB.get(IDB_IMGS);
    presets.push({ id: 'p' + Date.now(), name: name, at: Date.now(), bg: bg, apps: custom, layout: layout || null, imgs: imgs || null });
    await NanoIDB.set(IDB_PRESETS, presets);
    renderValues();
    openPresetsSheet();
    toast('预设已保存');
  }

  async function applyPreset(id) {
    var p = presets.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    bg = p.bg || null;
    custom = p.apps && typeof p.apps === 'object' ? p.apps : {};
    if (bg) await NanoIDB.set(IDB_BG, bg); else await NanoIDB.del(IDB_BG);
    await NanoIDB.set(IDB_CUSTOM, custom);
    if (p.layout) await NanoIDB.set(IDB_LAYOUT, p.layout);
    else await NanoIDB.del(IDB_LAYOUT);
    if (p.imgs) await NanoIDB.set(IDB_IMGS, p.imgs);
    else await NanoIDB.del(IDB_IMGS);
    renderValues();
    notifyHome(true);
    closeSheet();
    toast('已切换到「' + (p.name || '预设') + '」');
  }

  async function overwritePreset(id) {
    var p = presets.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;
    var layout = await NanoIDB.get(IDB_LAYOUT);
    var imgs = await NanoIDB.get(IDB_IMGS);
    p.bg = bg;
    p.apps = custom;
    p.layout = layout || null;
    p.imgs = imgs || null;
    p.at = Date.now();
    await NanoIDB.set(IDB_PRESETS, presets);
    openPresetsSheet();
    toast('预设已更新');
  }

  async function deletePreset(id) {
    if (!confirm('删除这个预设？')) return;
    presets = presets.filter(function (x) { return String(x.id) !== String(id); });
    await NanoIDB.set(IDB_PRESETS, presets);
    renderValues();
    openPresetsSheet();
    toast('预设已删除');
  }

  function exportDesktop() {
    Promise.all([NanoIDB.get(IDB_LAYOUT), NanoIDB.get(IDB_IMGS)]).then(function (r) {
      var data = {
        version: 1,
        kind: 'nano-desktop-decoration',
        exportedAt: new Date().toISOString(),
        bg: bg,
        apps: custom,
        layout: r[0] || null,
        imgs: r[1] || null,
        presets: presets
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '纳米桌面装饰-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('已导出桌面装饰');
    });
  }

  function importDesktop(file) {
    var reader = new FileReader();
    reader.onload = async function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d || d.kind !== 'nano-desktop-decoration') throw new Error('不是桌面装饰文件');
        bg = d.bg || null;
        custom = d.apps && typeof d.apps === 'object' ? d.apps : {};
        var jobs = [];
        jobs.push(bg ? NanoIDB.set(IDB_BG, bg) : NanoIDB.del(IDB_BG));
        jobs.push(NanoIDB.set(IDB_CUSTOM, custom));
        jobs.push(d.layout ? NanoIDB.set(IDB_LAYOUT, d.layout) : NanoIDB.del(IDB_LAYOUT));
        jobs.push(d.imgs ? NanoIDB.set(IDB_IMGS, d.imgs) : NanoIDB.del(IDB_IMGS));
        if (Array.isArray(d.presets) && d.presets.length) {
          var ids = new Set(presets.map(function (p) { return String(p.id); }));
          d.presets.forEach(function (p) { if (p && p.id && !ids.has(String(p.id))) presets.push(p); });
          jobs.push(NanoIDB.set(IDB_PRESETS, presets));
        }
        await Promise.all(jobs);
        renderValues();
        notifyHome(true);
        toast('桌面装饰已导入');
      } catch (e) {
        toast(e && e.message ? e.message : '导入失败');
      }
    };
    reader.readAsText(file);
  }

  async function resetDesktop() {
    if (!confirm('还原默认桌面？背景、App 图标/名称和布局会恢复默认，预设会保留。')) return;
    bg = null;
    custom = {};
    await Promise.all([NanoIDB.del(IDB_BG), NanoIDB.del(IDB_CUSTOM), NanoIDB.del(IDB_LAYOUT), NanoIDB.del(IDB_IMGS)]);
    try { localStorage.removeItem('mpLayout4'); localStorage.removeItem('mpImgs3'); } catch (e) {}
    renderValues();
    notifyHome(true);
    toast('已还原默认桌面');
  }

  async function enablePush() {
    if (!NP) { toast('推送模块未加载'); return; }
    var endpoint = '';
    try { endpoint = (localStorage.getItem('nano_push_endpoint') || '').trim(); } catch (e) {}
    if (!endpoint) endpoint = 'https://nanopush.nano315.online';
    var key = '';
    try { key = (localStorage.getItem('nano_push_vapid') || '').trim(); } catch (e) {}
    var token = '';
    try { token = localStorage.getItem('nano_push_token') || localStorage.getItem('nano_peek_token') || ''; } catch (e) {}
    if (!key) {
      try {
        var r = await fetch(endpoint.replace(/\/+$/, '') + '/vapid', { credentials: 'omit' });
        var j = await r.json();
        key = (j && (j.publicKey || j.vapid || j.key)) || '';
      } catch (e) {}
    }
    if (!key) { toast('服务端未返回 VAPID 公钥'); return; }
    try {
      NP.setup(endpoint, key, token);
      await NP.enable();
      localStorage.setItem('nano_notify_enabled', '1');
      refreshNotify();
      toast('Web Push 已开启');
    } catch (e) {
      toast(e && e.message ? e.message : '开启失败');
    }
  }

  function bind() {
    on('backBtn', 'click', function () {
      if (!post({ type: 'closeFullscreen' })) { try { history.back(); } catch (e) {} }
    });

    on('rowBg', 'click', openBgSheet);
    on('rowApps', 'click', openAppsSheet);
    on('rowPresets', 'click', openPresetsSheet);
    on('rowImport', 'click', function () { var f = $('importFile'); if (f) f.click(); });
    on('rowExport', 'click', exportDesktop);
    on('rowReset', 'click', resetDesktop);

    on('bgFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      resizeImage(f, 1800, 'image/jpeg', .88).then(function (url) {
        setBg({ type: 'image', value: url, at: Date.now() });
        closeSheet();
        toast('桌面背景已更新');
      }).catch(function () { toast('图片处理失败'); });
      e.target.value = '';
    });

    on('iconFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      resizeImage(f, 320, 'image/png').then(function (url) {
        pendingIcon = url;
        var p = $('editPreview');
        if (p) p.innerHTML = '<img src="' + esc(url) + '" alt="">';
      }).catch(function () { toast('图标处理失败'); });
      e.target.value = '';
    });

    on('importFile', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importDesktop(f);
      e.target.value = '';
    });

    on('sheetClose', 'click', closeSheet);
    on('modal', 'click', function (e) { if (e.target === $('modal')) closeSheet(); });

    on('keepToggle', 'change', function () {
      var on = this.checked;
      try { localStorage.setItem('nano_keep_alive', on ? '1' : '0'); } catch (e) {}
      post({ type: 'keepAlive', enabled: on });
      if (on && navigator.wakeLock) { navigator.wakeLock.request('screen').catch(function () {}); }
    });

    on('notifyToggle', 'change', function () {
      var on = this.checked;
      try { localStorage.setItem('nano_notify_enabled', on ? '1' : '0'); } catch (e) {}
      post({ type: 'notifySetting', enabled: on });
      if (on && NN && NN.ensurePermission) { try { NN.ensurePermission(); } catch (e) {} }
    });

    on('barkToggle', 'change', function () {
      var on = this.checked;
      if (NN && NN.setBarkEnabled) NN.setBarkEnabled(on);
      var row = $('barkKeyRow');
      if (row) row.classList.toggle('show', on);
      var st = $('barkStatus');
      if (st) st.textContent = on ? 'Bark 推送已开启' : 'Bark 推送已关闭';
    });

    on('barkKeySave', 'click', function () {
      if (!NN || !NN.setBarkKey) { toast('通知模块未加载'); return; }
      var k = ($('barkKeyInput').value || '').trim();
      NN.setBarkKey(k);
      var st = $('barkStatus');
      if (st) st.textContent = k ? 'Bark 密钥已保存' : '已清空 Bark 密钥';
      toast('已保存');
    });

    on('barkKeyTest', 'click', function () {
      if (!NN || !NN.barkPush) { toast('通知模块未加载'); return; }
      var k = ($('barkKeyInput').value || '').trim();
      if (!k) { toast('请先填写 Bark 密钥'); return; }
      NN.setBarkKey(k);
      var st = $('barkStatus');
      if (st) st.textContent = '发送中…';
      NN.barkPush('测试推送', '收到就说明配置成功', { force: true }, k).then(function () {
        if (st) st.textContent = '已发送，请查看系统通知';
        toast('已发送');
      }).catch(function () {
        if (st) st.textContent = '发送失败，请检查密钥';
        toast('发送失败');
      });
    });

    on('webPushBtn', 'click', enablePush);

    on('soundSelect', 'change', function () {
      try { localStorage.setItem('nano_notify_sound', this.value); } catch (e) {}
    });
    on('soundPreview', 'click', function () {
      if (NN && NN.playSound) { try { NN.playSound($('soundSelect').value); } catch (e) {} }
    });

    on('clearCache', 'click', function () {
      if (!window.caches) { toast('当前环境不支持'); return; }
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).then(function () { toast('缓存已清理'); refreshStorage(); });
    });
    on('storagePage', 'click', function () { openPage('storage.html', '储存'); });

    on('ballToggle', 'change', function () {
      var s = readBall();
      s.enabled = this.checked;
      writeBall(s);
    });
    on('ballSize', 'input', function () {
      var s = readBall();
      s.size = Number(this.value) || 52;
      var v = $('ballSizeValue');
      if (v) v.textContent = String(s.size);
      writeBall(s);
    });

    on('interfaceSettings', 'click', function () { openPage('beautify.html', '美化'); });
    on('assistantSettings', 'click', function () { openPage('nano-setting.html', '纳米设置'); });
    on('otherSettings', 'click', function () { openPage('other.html', '其他'); });
    on('backupPage', 'click', function () { openPage('backup.html', '备份与恢复'); });
  }

  function init() {
    bind();
    loadAll().then(function () {
      renderValues();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
