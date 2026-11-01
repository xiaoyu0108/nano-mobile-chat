// ============================================================
// nano-card-template.js — 纳米助手「制卡模板」
// ------------------------------------------------------------
// · 选择 / 新建角色卡，编辑基础信息、设定、多条开场白
// · 让纳米根据设定 + 世界书生成酒馆式开场白
// · 保存回角色库；打印 Nano 票根 PNG（内嵌完整数据）
// · 也可以查看并打印「我的人设」票根
// ============================================================
(function () {
  'use strict';
  if (window.__nanoCardTemplateLoaded) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    tab: 'char',
    chars: [],
    masks: [],
    currentChar: null,
    currentMask: null,
    avatar: '',
    openings: [],
    userAvatar: ''
  };

  // ---------- 通用 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  var toastTimer = null;
  function showToast(msg) {
    var el = $('nctToast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }
  function showAlert(title, body) {
    var ov = $('nctAlert');
    if (!ov) { try { alert((title ? title + '\n' : '') + (body || '')); } catch (e) {} return; }
    $('nctAlertTitle').textContent = title || '提示';
    $('nctAlertBody').textContent = body || '';
    ov.hidden = false;
  }
  function hideAlert() {
    var ov = $('nctAlert');
    if (ov) ov.hidden = true;
  }

  function withTimeout(promise, fallback, ms) {
    return Promise.race([
      promise,
      new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms || 1600); })
    ]);
  }
  function openDb(name, version, store, keyPath) {
    var p = new Promise(function (resolve) {
      try {
        var req = version ? indexedDB.open(name, version) : indexedDB.open(name);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: keyPath || 'id' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return withTimeout(p, null, 2200);
  }
  function idbAll(db, store) {
    if (!db) return Promise.resolve([]);
    var p = new Promise(function (resolve) {
      try {
        var r = db.transaction(store, 'readonly').objectStore(store).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
    return withTimeout(p, [], 1600);
  }
  function idbGet(db, store, key) {
    if (!db) return Promise.resolve(null);
    var p = new Promise(function (resolve) {
      try {
        var r = db.transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return withTimeout(p, null, 1600);
  }
  function idbPut(db, store, value) {
    if (!db) return Promise.resolve(false);
    var p = new Promise(function (resolve) {
      try {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
    return withTimeout(p, false, 2500);
  }

  // ---------- 数据 ----------
  async function loadCharacters() {
    var db = await openDb('nano_characters_db', null, 'characters', 'id');
    state.chars = (await idbAll(db, 'characters')).filter(function (c) { return c && c.id && !c.nanoAssistant; });
    state.chars.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    });
    try { db.close(); } catch (e) {}
  }
  async function saveCharacterItem(item) {
    var db = await openDb('nano_characters_db', null, 'characters', 'id');
    var ok = await idbPut(db, 'characters', item);
    try { db.close(); } catch (e) {}
    return ok;
  }

  function masksFromLocal() {
    try {
      var raw = localStorage.getItem('nano_mask_data');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) return { masks: d.masks, currentId: d.currentMaskId || '' };
      }
    } catch (e) {}
    return { masks: [], currentId: '' };
  }
  async function loadMasks() {
    var local = masksFromLocal();
    if (local.masks.length) {
      state.masks = local.masks;
      return;
    }
    var db = await openDb('nano_mask_db', 1, 'mask_data', 'key');
    var rec = await idbGet(db, 'mask_data', 'data');
    try { db.close(); } catch (e) {}
    state.masks = (rec && rec.value && Array.isArray(rec.value.masks)) ? rec.value.masks : [];
  }
  async function loadMaskAvatar(id) {
    var db = await openDb('MaskAvatarDB', 1, 'avatars', 'id');
    var rec = await idbGet(db, 'avatars', id);
    try { db.close(); } catch (e) {}
    return (rec && (rec.data || rec.value)) || '';
  }
  function currentUserId() {
    try {
      var local = masksFromLocal();
      if (local.currentId) return local.currentId;
      var dbRaw = null;
      return dbRaw || (local.masks[0] && local.masks[0].id) || '';
    } catch (e) { return ''; }
  }

  function notifyContacts() {
    try {
      window.parent.postMessage({ type: 'contactsDataUpdated', data: { chars: state.chars } }, '*');
    } catch (e) {}
    try {
      if (state.currentChar) {
        window.parent.postMessage({
          type: 'nanoCharUpdated',
          chatId: state.currentChar.id,
          name: state.currentChar.name,
          avatar: state.currentChar.avatar || ''
        }, '*');
      }
    } catch (e) {}
  }

  // ---------- 角色列表 / 表单 ----------
  function renderCharSelect() {
    var sel = $('charSelect');
    if (!sel) return;
    var html = '<option value="__new__">＋ 新建空白卡</option>';
    state.chars.forEach(function (c) {
      html += '<option value="' + esc(c.id) + '">' + esc(c.name || '未命名') + '</option>';
    });
    sel.innerHTML = html;
    if (state.currentChar && state.currentChar.id) sel.value = state.currentChar.id;
    else sel.value = '__new__';
  }

  function setAvatarPreview(src) {
    state.avatar = src || '';
    var img = $('charAvatarImg');
    var ph = $('charAvatarPlaceholder');
    if (!img || !ph) return;
    if (state.avatar) {
      img.src = state.avatar;
      img.hidden = false;
      ph.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      ph.hidden = false;
    }
  }

  function fillCharForm(item) {
    state.currentChar = item || null;
    state.avatar = (item && item.avatar) || '';
    state.openings = (item && Array.isArray(item.greetings)) ? item.greetings.slice() : [];
    $('charName').value = (item && item.name) || '';
    $('charGender').value = (item && item.gender) || '男';
    $('charNationality').value = (item && item.nationality) || '中国';
    $('charSetting').value = (item && item.setting) || '';
    $('charAvatarTitle').textContent = (item && item.name) ? (item.name + ' 的头像') : '角色头像';
    setAvatarPreview(state.avatar);
    renderOpenings();
    renderCharSelect();
  }

  function blankChar(focus) {
    fillCharForm(null);
    if (focus) { try { $('charName').focus(); } catch (e) {} }
  }

  function renderOpenings() {
    var wrap = $('openingsList');
    if (!wrap) return;
    if (!state.openings.length) {
      wrap.innerHTML = '<div class="nct-empty-openings">还没有开场白。可以手写，也可以让纳米根据设定生成。</div>';
      return;
    }
    wrap.innerHTML = state.openings.map(function (text, idx) {
      return '<div class="nct-opening" data-idx="' + idx + '">' +
        '<div class="nct-opening-head"><span class="nct-opening-no">OPENING ' + (idx + 1) + '</span>' +
        '<button class="nct-opening-del" type="button" data-remove="' + idx + '">删除</button></div>' +
        '<textarea data-opening="' + idx + '" placeholder="写一段可以直接进入剧情的开场白…">' + esc(text) + '</textarea>' +
        '</div>';
    }).join('');
    wrap.querySelectorAll('[data-opening]').forEach(function (ta) {
      ta.addEventListener('input', function () {
        state.openings[parseInt(ta.getAttribute('data-opening'), 10)] = ta.value;
      });
    });
    wrap.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.openings.splice(parseInt(btn.getAttribute('data-remove'), 10), 1);
        renderOpenings();
      });
    });
  }

  function addOpening(text) {
    state.openings.push(text || '');
    renderOpenings();
    var list = $('openingsList');
    var tas = list ? list.querySelectorAll('textarea') : [];
    if (tas.length) {
      var last = tas[tas.length - 1];
      try { last.focus(); last.setSelectionRange(last.value.length, last.value.length); } catch (e) {}
    }
  }

  async function handleCharAvatar(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 360;
        var w = img.width, h = img.height;
        if (w > max) { h = h * (max / w); w = max; }
        if (h > max) { w = w * (max / h); h = max; }
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w));
        canvas.height = Math.max(1, Math.round(h));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        setAvatarPreview(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = function () { showToast('头像读取失败'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- 用户人设 ----------
  function renderUserSelect() {
    var sel = $('userSelect');
    if (!sel) return;
    if (!state.masks.length) {
      sel.innerHTML = '<option value="">还没有人设</option>';
      return;
    }
    sel.innerHTML = state.masks.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.name || '未命名') + '</option>';
    }).join('');
    if (state.currentMask && state.currentMask.id) sel.value = state.currentMask.id;
  }

  async function fillUser(mask) {
    state.currentMask = mask || null;
    var img = $('userAvatarImg');
    var ph = $('userAvatarPlaceholder');
    $('userName').textContent = (mask && mask.name) || '未选择人设';
    $('userMeta').textContent = mask ? ([mask.gender || '未填写', mask.nationality || '中国'].join(' · ')) : '—';
    $('userSetting').textContent = (mask && mask.setting) ? mask.setting : '选择一个人设后，这里会显示完整设定。';
    state.userAvatar = '';
    if (mask) {
      var avatar = mask.avatar || await loadMaskAvatar(mask.id);
      state.userAvatar = avatar || '';
    }
    if (state.userAvatar) {
      img.src = state.userAvatar;
      img.hidden = false;
      ph.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      ph.hidden = false;
      ph.textContent = '';
    }
    renderUserSelect();
  }

  // ---------- 标签切换 ----------
  function switchTab(tab) {
    state.tab = tab === 'user' ? 'user' : 'char';
    document.querySelectorAll('.nct-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === state.tab);
    });
    $('charPane').hidden = state.tab !== 'char';
    $('userPane').hidden = state.tab !== 'user';
    if (state.tab === 'user' && !state.currentMask && state.masks.length) fillUser(state.masks[0]);
  }

  // ---------- API 配置 / 生成开场白 ----------
  async function readApiConfig() {
    try {
      var db = await openDb('nano_api_db', 2, 'api_data', 'key');
      var rec = await idbGet(db, 'api_data', 'nano_api_config');
      try { db.close(); } catch (e) {}
      if (rec && rec.value && rec.value.mainUrl) return rec.value;
    } catch (e) {}
    try {
      var raw = localStorage.getItem('nano_api_config');
      if (raw) {
        var cfg = JSON.parse(raw);
        if (cfg && cfg.mainUrl) return cfg;
      }
    } catch (e) {}
    return null;
  }

  function readOpeningCount(def) {
    var el = $('openingCount');
    var n = parseInt(el && el.value, 10);
    if (!isFinite(n)) n = def || 3;
    return Math.max(1, Math.min(10, n));
  }

  function extractContent(data) {
    try {
      var c = data.choices && data.choices[0] && (data.choices[0].message ? data.choices[0].message.content : data.choices[0].text);
      if (Array.isArray(c)) c = c.map(function (p) { return (p && (p.text || p.content)) || ''; }).join('\n');
      if (typeof c === 'string' && c.trim()) return c.trim();
      if (Array.isArray(data.content)) return data.content.map(function (p) { return (p && p.text) || ''; }).join('\n').trim();
      if (typeof data.completion === 'string') return data.completion.trim();
      if (typeof data.output_text === 'string') return data.output_text.trim();
    } catch (e) {}
    return '';
  }

  async function callMainAPI(cfg, system, user, maxTokens) {
    var url = String(cfg.mainUrl || '').trim().replace(/\/+$/, '');
    if (!/\/v1$/i.test(url)) url += '/v1';
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.mainKey) headers.Authorization = 'Bearer ' + String(cfg.mainKey).trim();
    var body = {
      model: cfg.mainModel || '',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.92,
      max_tokens: Math.max(1200, Number(maxTokens) || 2400)
    };
    var res = await fetch(url + '/chat/completions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var errText = '';
      try { errText = (await res.text()).slice(0, 360); } catch (e) {}
      throw new Error('主 API 返回 ' + res.status + (errText ? ('：' + errText) : ''));
    }
    var data = await res.json();
    var content = extractContent(data);
    if (!content) throw new Error('模型没有返回文字内容');
    return content;
  }

  function splitOpenings(text) {
    var t = String(text || '').replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '').trim();
    if (!t) return [];
    var parts = t.split(/\n\s*-{3,}\s*\n/);
    if (parts.length < 2) parts = t.split(/\n\s*={3,}\s*\n/);
    if (parts.length < 2) {
      var numbered = t.split(/(?:^|\n)\s*(?:(?:\d{1,2}|[一二三四五六七八九十])[.、)]|开场白\s*[\d一二三四五六七八九十]+[：:])\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (numbered.length >= 2) parts = numbered;
    }
    if (parts.length < 2) {
      // 没分隔符时，按空行切，但每段至少 40 字
      var blocks = t.split(/\n{2,}/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 40; });
      if (blocks.length >= 2) parts = blocks;
      else parts = [t];
    }
    return parts.map(function (s) {
      return String(s || '')
        .replace(/^(?:好的|当然|以下是|这是|下面是)[^\n]{0,48}\n+/, '')
        .replace(/^开场白\s*\d+\s*[：:]\s*/i, '')
        .replace(/^\d{1,2}[.、)]\s*/, '')
        .replace(/^["“]|["”]$/g, '')
        .trim();
    }).filter(function (s) { return s.length >= 20; });
  }

  async function generateOpenings() {
    var name = $('charName').value.trim();
    var setting = $('charSetting').value.trim();
    if (!name) { showAlert('还差一个名字', '先给角色起一个名字，纳米才知道在写谁。'); return; }
    if (!setting) { showAlert('还没有设定', '先写一点角色设定，哪怕只有几句话，纳米才能写出贴合的开场白。'); return; }
    if (state.openingsBusy) return;
    var count = readOpeningCount(3);
    var countWord = String(count);
    var btn = $('generateOpeningsBtn');
    var label = btn ? btn.querySelector('span') : null;
    var oldLabel = label ? label.textContent : '';
    state.openingsBusy = true;
    if (btn) btn.classList.add('busy');
    if (label) label.textContent = '纳米正在写开场白…';

    try {
      var books = state.currentChar ? await NanoCardTicket.loadWorldbooksForCharacter(state.currentChar) : [];
      var wbLines = [];
      books.slice(0, 4).forEach(function (b) {
        (b.entries || []).slice(0, 8).forEach(function (e) {
          var title = e.title || e.comment || e.name || '';
          var content = String(e.content || '').replace(/\s+/g, ' ').slice(0, 160);
          if (content) wbLines.push('· ' + (b.name || '世界书') + ' / ' + (title || '条目') + '：' + content);
        });
      });
      var existing = state.openings.map(function (s) { return String(s || '').trim(); }).filter(Boolean).join('\n---\n').slice(0, 1200);
      var system = [
        '你是角色卡的「开场白」写手，熟悉酒馆（SillyTavern）角色卡的开场白写法。',
        '请根据角色设定与世界观，写 ' + countWord + ' 条可以直接进入剧情的开场白。',
        '要求：',
        '1. 每条 150~300 字，是完整的场景片段，有环境、动作、对白或心理，能自然把用户带进剧情。',
        '2. ' + countWord + ' 条分别从不同场景 / 时间 / 关系阶段切入，不要重复同一个画面或同一句话。',
        '3. 完全贴合角色的人设、说话方式、国籍与世界观；不要 OOC。',
        '4. 不要替用户说话、不要写用户的动作和心理、不要替用户做决定。',
        '5. 不要写“开场白1/2/3”之类的标题，不要解释，不要编号。',
        '6. 每条之间用单独一行 --- 分隔。',
        '7. 语言要自然、克制，不要 AI 八股、不要无病呻吟、不要三连排比、不要“不是…而是…”。'
      ].join('\n');
      var user = [
        '角色名：' + name,
        '性别：' + ($('charGender').value || '未填写'),
        '国籍：' + ($('charNationality').value.trim() || '未填写'),
        '角色设定：\n' + setting.slice(0, 6000),
        wbLines.length ? ('\n世界书摘要（只作为背景，不要照抄）：\n' + wbLines.join('\n').slice(0, 3000)) : '',
        existing ? ('\n已有开场白（避免重复）：\n' + existing) : '',
        '\n请直接输出 ' + countWord + ' 条开场白，用 --- 分隔。'
      ].filter(Boolean).join('\n');

      var cfg = await readApiConfig();
      if (!cfg) throw new Error('还没有配置主 API。请先到「API 设置」里填好主接口、密钥和模型。');
      var text = await callMainAPI(cfg, system, user, Math.min(6000, 1200 + count * 520));
      var items = splitOpenings(text);
      if (!items.length) throw new Error('模型没有返回可用的开场白，请再试一次。');
      var added = 0;
      items.slice(0, count).forEach(function (t) {
        if (state.openings.indexOf(t) === -1) { state.openings.push(t); added++; }
      });
      renderOpenings();
      showToast('已生成 ' + added + ' 条开场白，可以继续修改');
    } catch (e) {
      showAlert('生成失败', (e && e.message) || '开场白生成失败，请检查 API 配置后重试。');
    } finally {
      state.openingsBusy = false;
      if (btn) btn.classList.remove('busy');
      if (label) label.textContent = oldLabel || ('让纳米写 ' + count + ' 条开场白');
    }
  }

  // ---------- 让 Nano 一次完成整张卡 ----------
  function parseJsonObject(text) {
    var t = String(text || '')
      .replace(/```[a-zA-Z0-9_-]*\s*/g, '')
      .replace(/```/g, '')
      .trim();
    var a = t.indexOf('{');
    var b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    var attempts = [t, t.replace(/,\s*([}\]])/g, '$1')];
    for (var i = 0; i < attempts.length; i++) {
      try {
        var o = JSON.parse(attempts[i]);
        if (o && typeof o === 'object') return o;
      } catch (e) {}
    }
    return null;
  }

  async function worldbookBrief() {
    try {
      var books = state.currentChar ? await NanoCardTicket.loadWorldbooksForCharacter(state.currentChar) : [];
      var lines = [];
      books.slice(0, 4).forEach(function (b) {
        (b.entries || []).slice(0, 8).forEach(function (e) {
          var title = e.title || e.comment || e.name || '';
          var content = String(e.content || '').replace(/\s+/g, ' ').slice(0, 160);
          if (content) lines.push('· ' + (b.name || '世界书') + ' / ' + (title || '条目') + '：' + content);
        });
      });
      return lines.join('\n').slice(0, 3000);
    } catch (e) { return ''; }
  }

  async function generateFullCard() {
    var brief = $('nanoBrief').value.trim();
    var existingName = $('charName').value.trim();
    var existingSetting = $('charSetting').value.trim();
    if (!brief && !existingName && !existingSetting) {
      showAlert('还差一点想法', '写一句你想要的角色，或者先填名字 / 设定，Nano 再帮你补全。');
      return;
    }
    if (state.fullCardBusy) return;
    var count = readOpeningCount(3);
    var countWord = String(count);
    var btn = $('nanoFullCardBtn');
    var label = btn ? btn.querySelector('span') : null;
    var oldLabel = label ? label.textContent : '';
    state.fullCardBusy = true;
    if (btn) btn.classList.add('busy');
    if (label) label.textContent = 'Nano 正在完成整张卡…';

    try {
      var wbText = await worldbookBrief();
      var system = [
        '你是 Nano 的制卡助手。根据用户的想法，直接产出一张完整的中文角色卡，只输出一个 JSON 对象。',
        '不要 markdown，不要代码围栏，不要解释，不要问候。',
        'JSON 结构必须是：',
        '{"name":"角色名","gender":"男或女或其他","nationality":"国籍","setting":"完整角色设定","greetings":["开场白1","开场白2","开场白3"]}',
        '要求：',
        '1. setting 写 600~1200 字，自然连贯，包含外貌、性格、经历、说话方式、与用户的关系；不要写成条目式大纲。',
        '2. greetings 写 ' + countWord + ' 条，每条 150~300 字，分别从不同场景 / 时间 / 关系阶段切入，能直接进入剧情。',
        '3. 不要替用户说话、不要写用户的动作和心理、不要替用户做决定。',
        '4. 不要 AI 八股、不要无病呻吟、不要三连排比、不要“不是…而是…”、不要把普通动作夸大成“理智的弦崩了”之类。',
        '5. 角色名、性别、国籍要与设定一致；如果用户已经给了名字或设定，就在此基础上补全，不要推翻。',
        '6. 所有字符串使用双引号，输出必须是合法 JSON。'
      ].join('\n');
      var user = [
        '用户的一句话想法：' + (brief || '（没有额外想法，按已有信息补全）'),
        '已有角色名：' + (existingName || '未填写'),
        '已有性别：' + ($('charGender').value || '未填写'),
        '已有国籍：' + ($('charNationality').value.trim() || '未填写'),
        '已有设定：' + (existingSetting ? ('\n' + existingSetting.slice(0, 6000)) : '未填写'),
        wbText ? ('\n世界书摘要（只作为背景，不要照抄）：\n' + wbText) : '',
        '\n请直接输出完整 JSON。'
      ].filter(Boolean).join('\n');

      var cfg = await readApiConfig();
      if (!cfg) throw new Error('还没有配置主 API。请先到「API 设置」里填好主接口、密钥和模型。');
      var text = await callMainAPI(cfg, system, user, Math.min(8000, 2400 + count * 520));
      var obj = parseJsonObject(text);
      if (!obj) throw new Error('模型返回的卡片格式不对，请再试一次。');
      var name = String(obj.name || obj.characterName || existingName || '').trim();
      if (!name) throw new Error('模型没有给出角色名，请再试一次。');
      var rawGender = String(obj.gender || '').trim();
      var gender = '其他';
      if (/男/.test(rawGender)) gender = '男';
      else if (/女/.test(rawGender)) gender = '女';
      var nationality = String(obj.nationality || obj.country || $('charNationality').value.trim() || '中国').trim();
      var setting = obj.setting || obj.description || obj.persona || existingSetting || '';
      if (typeof setting !== 'string') setting = JSON.stringify(setting, null, 2);
      var rawGreetings = obj.greetings || obj.openings || [];
      if (!Array.isArray(rawGreetings) && typeof rawGreetings === 'string') rawGreetings = [rawGreetings];
      var greetings = [];
      rawGreetings.forEach(function (g) {
        splitOpenings(String(g || '')).forEach(function (t) { if (t) greetings.push(t); });
      });
      if (obj.first_mes) {
        splitOpenings(String(obj.first_mes)).forEach(function (t) { if (t) greetings.unshift(t); });
      }
      if (Array.isArray(obj.alternate_greetings)) {
        obj.alternate_greetings.forEach(function (g) {
          splitOpenings(String(g || '')).forEach(function (t) { if (t && greetings.indexOf(t) === -1) greetings.push(t); });
        });
      }
      if (!greetings.length) greetings = splitOpenings(text);
      var seen = {};
      greetings = greetings.filter(function (g) { if (!g || seen[g]) return false; seen[g] = 1; return true; }).slice(0, count);
      if (!greetings.length) throw new Error('模型没有给出开场白，请再试一次。');

      $('charName').value = name;
      $('charGender').value = gender;
      $('charNationality').value = nationality;
      $('charSetting').value = String(setting).trim();
      state.openings = greetings;
      $('charAvatarTitle').textContent = name + ' 的头像';
      renderOpenings();
      showToast('Nano 已完成整张卡，检查后点「保存到角色库」');
    } catch (e) {
      showAlert('生成失败', (e && e.message) || '整卡生成失败，请检查 API 配置后重试。');
    } finally {
      state.fullCardBusy = false;
      if (btn) btn.classList.remove('busy');
      if (label) label.textContent = oldLabel || '让 Nano 完成整张卡';
    }
  }

  // ---------- 保存 / 导出 ----------
  async function saveCurrentCharacter() {
    if (state.tab === 'user') {
      showToast('用户人设请到 Mask 页面修改');
      return;
    }
    var name = $('charName').value.trim();
    if (!name) { showAlert('还没填名字', '给角色起一个名字再保存。'); return; }
    var existing = state.currentChar;
    var item = Object.assign({}, existing || {}, {
      id: existing ? existing.id : ('c' + Date.now()),
      name: name,
      avatar: state.avatar || (existing && existing.avatar) || '',
      gender: $('charGender').value,
      nationality: $('charNationality').value.trim() || '中国',
      setting: $('charSetting').value.trim(),
      bindUser: (existing && existing.bindUser) ? existing.bindUser : currentUserId(),
      isNpc: existing ? !!existing.isNpc : false,
      nanoAssistant: existing ? !!existing.nanoAssistant : false,
      greetings: state.openings.map(function (s) { return String(s || '').trim(); }).filter(Boolean),
      worldbookBindings: existing && Array.isArray(existing.worldbookBindings) ? existing.worldbookBindings : []
    });
    var ok = await saveCharacterItem(item);
    if (!ok) { showAlert('保存失败', '写入角色库失败，请检查浏览器存储空间。'); return; }
    var idx = state.chars.findIndex(function (c) { return String(c.id) === String(item.id); });
    if (idx > -1) state.chars[idx] = item; else state.chars.unshift(item);
    state.currentChar = item;
    renderCharSelect();
    notifyContacts();
    showToast(item.greetings.length ? '已保存到角色库，进入线下即可选择开场白' : '已保存到角色库');
  }

  async function printCharacter() {
    var name = $('charName').value.trim();
    if (!name) { showAlert('还没填名字', '先填写名字，再打印票根。'); return; }
    var existing = state.currentChar;
    var item = Object.assign({}, existing || {}, {
      id: existing ? existing.id : ('draft_' + Date.now()),
      name: name,
      avatar: state.avatar || (existing && existing.avatar) || '',
      gender: $('charGender').value,
      nationality: $('charNationality').value.trim() || '中国',
      setting: $('charSetting').value.trim(),
      greetings: state.openings.map(function (s) { return String(s || '').trim(); }).filter(Boolean),
      worldbookBindings: existing && Array.isArray(existing.worldbookBindings) ? existing.worldbookBindings : []
    });
    var btn = $('charPrintBtn');
    var old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '正在排版票根…'; }
    try {
      var books = await NanoCardTicket.loadWorldbooksForCharacter(item);
      await NanoCardTicket.printPayload(NanoCardTicket.fromCharacter(item, books));
    } catch (e) {
      showAlert('打印失败', (e && e.message) || '票根生成失败，请重试。');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }
  }

  async function printUser() {
    if (!state.currentMask) { showAlert('还没有人设', '先选择一个人设，再打印票根。'); return; }
    var btn = $('userPrintBtn');
    var old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '正在排版票根…'; }
    try {
      var payload = NanoCardTicket.fromUser(state.currentMask, { avatar: state.userAvatar });
      await NanoCardTicket.printPayload(payload);
    } catch (e) {
      showAlert('打印失败', (e && e.message) || '票根生成失败，请重试。');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }
  }

  // ---------- 事件 ----------
  function bind() {
    $('backBtn').addEventListener('click', function () {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'closeFullscreen' }, '*');
          return;
        }
      } catch (e) {}
      try { history.back(); } catch (e) {}
    });

    document.querySelectorAll('.nct-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });

    $('saveCardBtn').addEventListener('click', saveCurrentCharacter);
    $('newCharBtn').addEventListener('click', function () { blankChar(true); });

    $('charSelect').addEventListener('change', function () {
      var id = this.value;
      if (id === '__new__') { blankChar(true); return; }
      var item = state.chars.find(function (c) { return String(c.id) === String(id); }) || null;
      fillCharForm(item);
    });

    $('charAvatarBtn').addEventListener('click', function () { $('charAvatarFile').click(); });
    $('charAvatarFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) handleCharAvatar(f);
    });

    $('addOpeningBtn').addEventListener('click', function () { addOpening(''); });
    var countInput = $('openingCount');
    if (countInput) {
      countInput.addEventListener('input', function () {
        if (state.openingsBusy) return;
        var n = readOpeningCount(3);
        var label = $('generateOpeningsBtn') ? $('generateOpeningsBtn').querySelector('span') : null;
        if (label) label.textContent = '让纳米写 ' + n + ' 条开场白';
      });
    }
    $('generateOpeningsBtn').addEventListener('click', generateOpenings);
    $('nanoFullCardBtn').addEventListener('click', generateFullCard);
    $('charPrintBtn').addEventListener('click', printCharacter);

    $('userSelect').addEventListener('change', function () {
      var item = state.masks.find(function (m) { return String(m.id) === String(this.value); }.bind(this)) || null;
      fillUser(item);
    });
    $('userPrintBtn').addEventListener('click', printUser);

    $('nctAlertOk').addEventListener('click', hideAlert);
    $('nctAlert').addEventListener('click', function (e) { if (e.target === this) hideAlert(); });

    // 草稿自动同步到当前角色对象（不写库，保存时才持久化）
    ['charName', 'charGender', 'charNationality', 'charSetting'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (id === 'charName') {
          $('charAvatarTitle').textContent = el.value.trim() ? (el.value.trim() + ' 的头像') : '角色头像';
        }
      });
    });
  }

  async function init() {
    bind();
    await Promise.all([loadCharacters(), loadMasks()]);
    renderCharSelect();
    if (state.chars.length) {
      // 默认打开最近编辑的角色（按 id 时间戳倒序），否则新建
      var latest = state.chars.slice().sort(function (a, b) {
        return String(b.id).localeCompare(String(a.id));
      })[0];
      fillCharForm(latest || null);
    } else {
      blankChar(false);
    }
    renderUserSelect();
    if (state.masks.length) fillUser(state.masks[0]);
    switchTab('char');
    try { $('nctApp').classList.add('ready'); } catch (e) {}
  }

  window.__nanoCardTemplateLoaded = true;
  window.NanoCardTemplate = {
    state: state,
    reload: init
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
