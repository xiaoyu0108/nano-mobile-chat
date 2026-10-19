// nano-assistant-tools.js — 「纳米」共享工具（chat_inner 内使用）
// 只做覆盖（美化/世界书等存储），不改源码。chat-core 在纳米会话里调用它。
(function () {
  'use strict';
  var KB = window.NANO_ASSISTANT_KB || { about: [], scopes: [], pages: [], storage: {}, commands: [], worldbookEntryFields: [] };
  var NANO_ID = 'nano_ai';

  function isNano(chatId) { return String(chatId || '') === NANO_ID; }

  function systemPrompt() {
    var lines = [];
    lines.push('你是「纳米」，Nano 应用内置的美化 / 装修助手，是一个女生 AI。你善解人意、有耐心，但非常干练：不寒暄、不废话，通常直接给结论和可执行结果，用中文回答。');
    lines.push('你精通前端与 Nano 的全部结构，能直接帮用户改好样式、世界书、人设并输出 <action>。写长 CSS / 代码时要一次性给全，不要因为篇幅长就省略关键部分、也不要说"以下省略"——输出会被截断时，尽量精简措辞，把完整代码放进去。');
    lines.push('');
    lines.push('【最重要的规则】');
    lines.push('1. Nano 是纯前端 PWA。你只能"覆盖"样式和写入存储，不能修改部署后的源码文件。');
    lines.push('2. 用户在每个美化页点"恢复默认"即可撤销你的覆盖，因为覆盖只存在浏览器存储里。');
    lines.push('3. 你可以读取源码来回答"我应该怎么改/改哪个文件"，并给出清晰步骤。');
    lines.push('4. 你不能新增页面或改后端逻辑；这类需求要告诉用户需要开发者改源码并重新部署。');
    lines.push('5. 回复尽量简短：先给结论，再给必要步骤。除非用户要求，不要长篇大论。');
    lines.push('6. 做美化/世界书这类修改时【不要读源码】：知识库里已有足够的选择器，直接用即可，并输出 <action> 块。只有用户明确问"这个功能在哪个文件、源码怎么改"时，才 use read_file。');
    lines.push('7. 需要修改时必须真的输出 <action> 块：只有输出了 <action>，界面才会出现「复制 / 立即执行」按钮。绝不要只说"点击下方按钮 / 已为你改好"却不给 action。如果暂时不确定选择器，就先问清楚，不要假装已经改好。');
    lines.push('8. 用户发来"表情包 / 图片清单"（一般是「名字：图片链接」的形式）并要求加入表情包时，必须用 add_emoji，绝对不要用 add_worldbook。只有用户明确说要"世界书/设定"时才用 add_worldbook。');
    lines.push('9. 每次 apply_beautify 都会自动存成一个「可切换的预设」（在对应美化页里能选），所以 name 要起一个简短好认的名字，方便用户之后切换。若用户说「改我那个叫 XX 的预设」，就把 name 填成 XX —— 同名会直接更新那个预设，不会再多出一个。');
    lines.push('10. 用户让你「用我刚发的图当头像/换成我发的这张」时，用 set_avatar（args:{"useLast":true}），不要用 apply_beautify 硬套图片地址（iOS 上本地图片地址塞进 CSS/JSON 会失效）。');
    lines.push('11. 只回答用户当前问的这一个问题，问什么就答什么；**不要反复回答之前已经回答过的问题**，不要每轮都把上一条结论再复述一遍，也不要把无关的旧内容重新倒出来。');
    lines.push('');
    lines.push('【不限于美化 · 你还能做的装修】');
    lines.push('· 线下美化：apply_beautify（scope:"offline"），写入线下 customCSS，重新打开线下即生效。');
    lines.push('· 线下菜单 JS 插件：add_menu_plugin（args:{name,js}），给线下输入框头像菜单加自定义按钮，js 里用 api.addItem({label,icon,run}) 注册，可用 api.toast/getMessages/scrollToFloor/reroll 等。');
    lines.push('· 给线下「规则 / 文风 / 思维链 / 美化」加预设：add_offline_rule（规则，可指定已有组名或新建组）；save_preset（scope:"offline-style|offline-cot|offline-css"，name+content）。');
    lines.push('· 读取/修改用户已存的预设：先用 list_presets / read_preset 读取（系统会把结果读给你，你再继续），再用 save_preset 覆盖、delete_preset 删除。scope：global/chat/chat-avatar/offline/heart/offline-style/offline-cot/offline-css/offline-rules/menu-plugin。');
    lines.push('');
    lines.push('【执行动作的方式】');
    lines.push('需要真正修改时，在回复里输出代码块（用户会看到确认按钮，确认后才生效）：');
    lines.push('<action>{"tool":"apply_beautify","args":{"scope":"heart","name":"粉红心声","css":"..."}}</action>');
    lines.push('可用动作：');
    (KB.commands || []).forEach(function (c) { lines.push('- ' + c.tool + ' 参数 ' + JSON.stringify(c.args) + '：' + (c.note || '')); });
    lines.push('');
    lines.push('【可覆盖的范围 scope】');
    (KB.scopes || []).forEach(function (s) {
      lines.push('· ' + s.id + '（' + s.name + '）：' + s.desc);
      lines.push('  存储：' + s.storage);
      if (s.selectors) lines.push('  常用选择器：' + s.selectors.join('  '));
    });
    lines.push('');
    lines.push('【源码文件（需要时可 read_file 读取，注意每轮最多读一次）】');
    (KB.pages || []).forEach(function (p) { lines.push('· ' + p.file + '（' + p.name + (p.note ? '：' + p.note : '') + '）'); });
    lines.push('');
    lines.push('【存储位置】');
    Object.keys(KB.storage || {}).forEach(function (k) { lines.push('· ' + k + ' = ' + KB.storage[k]); });
    lines.push('');
    lines.push('【世界书条目字段】' + (KB.worldbookEntryFields || []).join(', '));
    lines.push('');
    lines.push('【已有世界书】（用户说「填进某本 / 加到某本 / 追加到某本」时，把 add_worldbook 的 worldbook 填成这本书名）');
    var books = worldbookNamesForPrompt();
    if (books.length) books.forEach(function (b) { lines.push('· ' + b.name + '（' + b.count + ' 条）'); });
    else lines.push('· （暂无世界书，用户要生成时直接新建一本即可）');
    lines.push('');
    lines.push('【文件 / 长文本 → 世界书】');
    lines.push('用户发来「文件」卡片时，卡片后面会附带完整文件内容。当用户要把它做成/填入世界书：');
    lines.push('1. 把内容拆成多条独立设定，每条一个主题（人物、地点、物品、组织、事件、规则/设定等），不要把整篇塞进一条。');
    lines.push('2. 每条给：title（3~8 字标题）、keywords（触发关键词，2~6 个，逗号分隔）、content（忠实原文的设定正文，不编造；过长可精简但不丢关键信息）。');
    lines.push('3. 用 add_worldbook 输出动作：新建一本填 name；加进已有世界书把 worldbook 填成已有书名（书名见上）。');
    lines.push('4. 条目多时分批输出多个 <action>，每批不超过 15 条，所有批次的 name / worldbook 保持一致。');
    lines.push('5. 世界书请求只用 add_worldbook，不要用 apply_beautify；也不要用 add_emoji。');
    lines.push('6. 先简要说明你分了几条、每条标题，再输出动作。');
    lines.push('');
    lines.push('写 CSS 时直接给完整可用的 CSS（用上面的选择器即可，不要为了美化去读源码）。css 字段里可以带换行，直接写多行 CSS 即可。');
    lines.push('每次要修改样式，都必须：①用一两句话说明你要改什么；②输出一个 <action> 块，css 字段放完整可复制的代码。');
    lines.push('用户说“换背景”时：优先用 set_chat_background（有图片用 args.image，只有颜色用 args.color）；需要更复杂的背景样式时才用 scope=chat 的 CSS（改 .chat-container / .message-scroll / body）。');
    try {
      var extra = (localStorage.getItem('nano_builtin_prompt') || '').trim();
      if (extra) lines.push('\n【用户自定义内置要求（必须遵守）】\n' + extra);
    } catch (e) {}
    try {
      var _briefRaw = localStorage.getItem('chat_setting_nanoBrief_nano_ai');
      var _briefOn = _briefRaw === 'true' || _briefRaw === '"true"' || _briefRaw === '1';
      if (_briefOn) {
        lines.push('');
        lines.push('【简洁模式 · 已开启】不要复述用户的话、不要解释原理和背景，先给一句话结论，随后直接输出 <action> 块；除非用户追问，不要写长段落，CSS 只给必要部分。');
      }
    } catch (e) {}
    return lines.join('\n');
  }

  // 模型经常把 CSS 里的换行直接写进 JSON 字符串（非法 JSON），这里做容错修复
  function repairJson(s) {
    s = String(s || '');
    var out = '', inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr) {
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { continue; }
        if (ch === '\t') { out += '\\t'; continue; }
      }
      out += ch;
    }
    return out.replace(/,\s*([}\]])/g, '$1');
  }
  function firstJsonObject(s) {
    s = String(s || '');
    var start = s.indexOf('{');
    if (start < 0) return null;
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
    }
    return s.slice(start);
  }
  function normalizeAction(o) {
    if (!o || typeof o !== 'object') return null;
    var tool = o.tool || o.action || o.name;
    if (!tool) return null;
    var args = o.args;
    if (!args || typeof args !== 'object') {
      args = {};
      var skip = { tool: 1, action: 1, name: 1, args: 1 };
      Object.keys(o).forEach(function (k) { if (!skip[k]) args[k] = o[k]; });
    }
    return { tool: String(tool), args: args };
  }
  function parseActionJson(json) {
    var raw = String(json || '').trim()
      .replace(/^```(?:json|xml|javascript)?/i, '').replace(/```$/, '').trim();
    var candidates = [raw, repairJson(raw)];
    var obj = firstJsonObject(raw);
    if (obj) { candidates.push(obj); candidates.push(repairJson(obj)); }
    for (var i = 0; i < candidates.length; i++) {
      try {
        var o = JSON.parse(candidates[i]);
        var n = normalizeAction(o);
        if (n) return n;
      } catch (e) {}
    }
    return null;
  }
  function parseActions(text) {
    var actions = [];
    function push(json) { var o = parseActionJson(json); if (o) actions.push(o); }
    var clean = String(text || '').replace(/<action>([\s\S]*?)<\/action>/g, function (_, json) { push(json); return ''; });
    // 兼容模型用 ```json {...} ``` / ``` {...} ``` 包裹动作的情况
    clean = clean.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, function (_, block) {
      if (!/"tool"|'tool'|"action"|'action'/.test(block)) return _;
      var obj = firstJsonObject(block);
      if (obj) { push(obj); return ''; }
      return _;
    });
    return { clean: clean.trim(), actions: actions };
  }

  async function fetchSource(path) {
    try {
      var r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) return '';
      var t = await r.text();
      if (t.length > 14000) t = t.slice(0, 14000) + '\n…（已截断）';
      return t;
    } catch (e) { return ''; }
  }

  /* ---------- 存储工具 ---------- */
  function idbOpen(name) {
    return new Promise(function (res, rej) {
      try { var r = indexedDB.open(name); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }
      catch (e) { rej(e); }
    });
  }
  function idbGet(dbName, store, key) {
    return idbOpen(dbName).then(function (db) {
      return new Promise(function (res) {
        try {
          if (!db.objectStoreNames.contains(store)) { db.close(); res(null); return; }
          var rq = db.transaction(store, 'readonly').objectStore(store).get(key);
          rq.onsuccess = function () { res(rq.result); db.close(); };
          rq.onerror = function () { res(null); db.close(); };
        } catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  function broadcast(target, css) {
    try { window.parent.postMessage({ type: 'beautify:apply', target: target, css: css }, '*'); } catch (e) {}
  }
  // 同名预设直接覆盖（更新），不存在才新建 —— 这样用户说「改我的某个预设」时，
  // 纳米是修改那一个预设，而不是每问一次就多出一个新预设。
  function savePreset(category, name, code) {
    try {
      var req = indexedDB.open('BeautifyAppDB', 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        // 和 beautify.js 保持一致，两个 store 都要建，否则先由纳米创建库时美化页会缺 settings
        if (!d.objectStoreNames.contains('presets')) d.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          if (!db.objectStoreNames.contains('presets')) { db.close(); return; }
          var tx = db.transaction('presets', 'readwrite');
          var store = tx.objectStore('presets');
          var name2 = name || '纳米预设';
          var all = store.getAll();
          all.onsuccess = function () {
            var list = all.result || [];
            var found = null;
            for (var i = 0; i < list.length; i++) {
              if (list[i] && list[i].category === category && list[i].name === name2) { found = list[i]; break; }
            }
            if (found) { found.code = code; found.updatedAt = Date.now(); store.put(found); }
            else store.put({ category: category, name: name2, code: code, createdAt: Date.now() });
          };
          tx.oncomplete = function () { db.close(); };
          tx.onerror = function () { db.close(); };
        } catch (e) { try { db.close(); } catch (err) {} }
      };
    } catch (e) {}
  }

  // 心声预设存在它自己的库（NanoVoiceDB/templates），必须写这里，心声面板下拉才会出现该预设。
  // 之前 apply_beautify(scope:'heart') 只写 BeautifyAppDB，所以用户「加了预设却看不到」。
  function saveHeartTemplate(name, css) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('NanoVoiceDB', 1);
        req.onupgradeneeded = function (e) {
          var d = e.target.result;
          if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id' });
        };
        req.onsuccess = function () {
          var db = req.result;
          try {
            var tx = db.transaction('templates', 'readwrite');
            var store = tx.objectStore('templates');
            var key = 'nano_' + String(name || '纳米预设');
            var g = store.get(key);
            g.onsuccess = function () {
              store.put({ id: key, name: String(name || '纳米预设'), css: css });
            };
            tx.oncomplete = function () { db.close(); resolve(true); };
            tx.onerror = function () { db.close(); resolve(false); };
          } catch (e) { try { db.close(); } catch (err) {} resolve(false); }
        };
        req.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }
  function dbExists(name) {
    return new Promise(function (res) {
      if (!indexedDB.databases) { res(true); return; }
      indexedDB.databases().then(function (l) { res(!!l && l.some(function (d) { return d && d.name === name; })); }).catch(function () { res(true); });
    });
  }
  async function setOfflineCss(css) {
    if (!(await dbExists('MeetSettingsDB'))) throw new Error('线下设置库还不存在，先打开一次线下模式');
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('MeetSettingsDB');
      req.onsuccess = function () {
        var db = req.result;
        try {
          if (!db.objectStoreNames.contains('settings')) { db.close(); reject(new Error('settings 表不存在')); return; }
          var tx = db.transaction('settings', 'readwrite');
          var store = tx.objectStore('settings');
          var g = store.get('main_settings');
          g.onsuccess = function () { var rec = g.result || { id: 'main_settings' }; rec.id = 'main_settings'; rec.customCSS = css; store.put(rec); };
          tx.oncomplete = function () { db.close(); resolve(true); };
          tx.onerror = function () { db.close(); reject(new Error('写入失败')); };
        } catch (e) { try { db.close(); } catch (err) {} reject(e); }
      };
      req.onerror = function () { reject(new Error('打开库失败')); };
    });
  }
  /* ---------- 表情包：写入 nano_api_db / emoji_data / nano_emoji_data ---------- */
  function openEmojiDB() {
    return new Promise(function (res, rej) {
      try {
        var req = indexedDB.open('nano_api_db', 2);
        req.onupgradeneeded = function (e) {
          var d = e.target.result;
          if (!d.objectStoreNames.contains('api_data')) d.createObjectStore('api_data', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('emoji_data')) d.createObjectStore('emoji_data', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('favorite_data')) d.createObjectStore('favorite_data', { keyPath: 'key' });
        };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      } catch (e) { rej(e); }
    });
  }
  function getEmojiDataRaw() {
    return openEmojiDB().then(function (db) {
      return new Promise(function (res) {
        try {
          if (!db.objectStoreNames.contains('emoji_data')) { db.close(); res(null); return; }
          var rq = db.transaction('emoji_data', 'readonly').objectStore('emoji_data').get('nano_emoji_data');
          rq.onsuccess = function () { db.close(); res(rq.result ? rq.result.value : null); };
          rq.onerror = function () { db.close(); res(null); };
        } catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  function saveEmojiDataRaw(data) {
    try { localStorage.setItem('nano_emoji_data', JSON.stringify(data)); } catch (e) {}
    return openEmojiDB().then(function (db) {
      return new Promise(function (res) {
        try {
          var tx = db.transaction('emoji_data', 'readwrite');
          tx.objectStore('emoji_data').put({ key: 'nano_emoji_data', value: data });
          tx.oncomplete = function () { db.close(); res(true); };
          tx.onerror = function () { db.close(); res(false); };
        } catch (e) { res(false); }
      });
    }).catch(function () { return false; });
  }
  async function addEmoji(groupName, emojis) {
    var data = await getEmojiDataRaw();
    if (!data || !Array.isArray(data.emojiGroups)) data = { emojiGroups: [], balance: 0, favorites: [] };
    var list = (emojis || []).map(function (e) {
      return { name: String((e && e.name) || '').trim(), url: String((e && (e.url || e.src || e.image)) || '').trim() };
    }).filter(function (e) { return e.url; });
    if (!list.length) throw new Error('没有可添加的表情（缺少图片地址）');
    var name = String(groupName || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24) || '纳米表情';
    var group = data.emojiGroups.find(function (g) { return g && g.name === name; });
    if (!group) {
      group = { id: 'g' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: name, emojis: [] };
      data.emojiGroups.push(group);
    }
    if (!Array.isArray(group.emojis)) group.emojis = [];
    var seen = {};
    group.emojis.forEach(function (e) { if (e && e.url) seen[e.url] = 1; });
    list.forEach(function (e) {
      if (seen[e.url]) return;
      seen[e.url] = 1;
      group.emojis.push({ id: genId('e'), name: e.name || '', url: e.url });
    });
    await saveEmojiDataRaw(data);
    try { window.dispatchEvent(new CustomEvent('nanoEmojiUpdated')); } catch (e) {}
    try { window.parent.postMessage({ type: 'nanoEmojiUpdated' }, '*'); } catch (e) {}
    return group;
  }

  function genId(p) { return p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }
  function normalizeEntry(e) {
    e = e || {};
    return {
      id: genId('e'), enabled: true,
      title: e.title || '', keywords: e.keywords || e.keys || '',
      keywordEnabled: e.keywordEnabled !== false, vectorEnabled: !!e.vectorEnabled,
      permanent: !!e.permanent, position: e.position || 'before_char',
      scanDepth: e.scanDepth || 4, priority: e.priority || 100,
      probability: e.probability || 100, content: e.content || e.text || '',
      collapsed: false
    };
  }
  async function getWorldbookData() {
    var rec = await idbGet('nano_worldbook_db', 'worldbook_data', 'data');
    var v = (rec && rec.value && typeof rec.value === 'object') ? rec.value : rec;
    if (!v || !Array.isArray(v.files)) v = { groups: [{ id: 'g1', name: '默认分组' }], files: [] };
    if (!Array.isArray(v.groups)) v.groups = [{ id: 'g1', name: '默认分组' }];
    return v;
  }
  async function saveWorldbookData(data) {
    await new Promise(function (resolve) {
      var req = indexedDB.open('nano_worldbook_db', 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('worldbook_data')) d.createObjectStore('worldbook_data', { keyPath: 'key' });
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction('worldbook_data', 'readwrite');
          tx.objectStore('worldbook_data').put({ key: 'data', value: data });
          tx.oncomplete = function () { db.close(); resolve(true); };
          tx.onerror = function () { db.close(); resolve(false); };
        } catch (e) { try { db.close(); } catch (err) {} resolve(false); }
      };
      req.onerror = function () { resolve(false); };
    });
    try { localStorage.setItem('nano_worldbook_data_v5', JSON.stringify(data)); } catch (e) {}
  }
  // 同步读取已有世界书（localStorage 镜像，与 worldbook.js / saveWorldbookData 保持一致），
  // 供 systemPrompt 列出书名，模型才能把条目「填入」到指定世界书。
  function worldbookNamesForPrompt() {
    try {
      var raw = localStorage.getItem('nano_worldbook_data_v5');
      if (!raw) return [];
      var d = JSON.parse(raw);
      var files = (d && Array.isArray(d.files)) ? d.files : [];
      return files.map(function (f) {
        return { name: String((f && f.name) || '未命名'), count: (f && Array.isArray(f.entries)) ? f.entries.length : 0 };
      });
    } catch (e) { return []; }
  }
  function ensureGroup(data, groupName) {
    var gname = String(groupName || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 30);
    if (!gname) return null;
    if (!Array.isArray(data.groups)) data.groups = [];
    var g = data.groups.find(function (x) { return x && x.name === gname; });
    if (!g) { g = { id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: gname }; data.groups.push(g); }
    return g.id;
  }
  // 新建世界书，或把条目追加进已有世界书（args.worldbook 填书名或 id）。
  async function addWorldbook(name, entries, target, group) {
    var data = await getWorldbookData();
    var list = (entries || []).map(normalizeEntry);
    if (!list.length) throw new Error('没有可写入的条目（entries 为空）');
    var targetName = String(target || '').trim();
    var file = null;
    if (targetName) {
      file = (data.files || []).find(function (f) {
        return f && (f.id === targetName || f.name === targetName);
      });
    }
    if (file) {
      if (!Array.isArray(file.entries)) file.entries = [];
      list.forEach(function (e) { file.entries.push(e); });
      if (group) { var gid = ensureGroup(data, group); if (gid) file.group = gid; }
      file.size = Math.ceil(JSON.stringify(file.entries).length / 1024) + 'KB';
      file.ext = file.ext || 'json';
      await saveWorldbookData(data);
      return { file: file, created: false, added: list.length };
    }
    var gid = group ? ensureGroup(data, group) : null;
    file = {
      id: 'f_' + Date.now(), name: name || '纳米世界书', entries: list,
      group: gid, scope: 'global', boundCharacters: [], size: Math.ceil(JSON.stringify(list).length / 1024) + 'KB', ext: 'json'
    };
    if (!Array.isArray(data.files)) data.files = [];
    data.files.push(file);
    await saveWorldbookData(data);
    return { file: file, created: true, added: list.length };
  }
  // 把当前聊天角色（chat_inner?chat=角色id）的头像写进角色库，真正做到「换头像」。
  // 之前没有这个能力，所以 iOS 上发图给纳米后它只能说「做了」却执行不出效果。
  function getChatId() {
    try { return new URLSearchParams(location.search).get('chat') || NANO_ID; } catch (e) { return NANO_ID; }
  }
  function setCharacterAvatar(chatId, url) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('缺少头像地址（没找到可用的图片）')); return; }
      try {
        var req = indexedDB.open('nano_characters_db');
        req.onupgradeneeded = function (e) {
          var d = e.target.result;
          if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
        };
        req.onsuccess = function () {
          var db = req.result;
          try {
            var tx = db.transaction('characters', 'readwrite');
            var store = tx.objectStore('characters');
            var g = store.get(chatId);
            g.onsuccess = function () {
              var rec = g.result;
              if (!rec) { db.close(); reject(new Error('没找到当前角色（这可能不是角色私聊）')); return; }
              rec.avatar = url;
              store.put(rec);
            };
            g.onerror = function () { db.close(); reject(new Error('读取角色失败')); };
            tx.oncomplete = function () { db.close(); resolve(true); };
            tx.onerror = function () { db.close(); reject(new Error('写入角色失败')); };
          } catch (e) { try { db.close(); } catch (err) {} reject(e); }
        };
        req.onerror = function () { reject(new Error('打开角色库失败')); };
      } catch (e) { reject(e); }
    });
  }
  async function setAvatar(args) {
    args = args || {};
    var url = String(args.url || '').trim();
    if (!url && args.useLast) url = String(window.__nanoLastImage || '').trim();
    if (!url && args.useLast) {
      // 兜底：从最近一条用户发来的图片消息里找
      try {
        var st = JSON.parse(localStorage.getItem('chat_messages_' + getChatId()) || '[]');
        for (var i = st.length - 1; i >= 0; i--) {
          var m = st[i];
          if (m && m.type === 'right' && m.isImage && m.imageData && m.imageData.url) { url = m.imageData.url; break; }
        }
      } catch (e) {}
    }
    await setCharacterAvatar(getChatId(), url);
    // 同页立即预览：顶栏头像 / 正在输入头像先换掉（消息头像会在重新打开聊天时全部刷新）
    try {
      var img = document.getElementById('avatarImage');
      var ph = document.getElementById('avatarPlaceholder');
      if (img && url) { img.src = url; img.style.display = 'block'; if (ph) ph.style.display = 'none'; }
      var typing = document.getElementById('typingAvatar');
      if (typing && url) { typing.innerHTML = '<img src="' + url.replace(/"/g, '') + '" alt="">'; }
    } catch (e) {}
    return true;
  }

  async function applyBeautify(scope, name, css) {
    css = String(css || '');
    name = String(name || '').trim() || '纳米预设';
    if (scope === 'global') {
      localStorage.setItem('beautify_global_v2', css); localStorage.setItem('beautify_global', css);
      savePreset('global', name, css); broadcast('global', css);
    } else if (scope === 'chat') {
      localStorage.setItem('beautify_chat_v2', css); localStorage.setItem('beautify_chat', css);
      savePreset('chat', name, css); broadcast('chat', css);
    } else if (scope === 'chat-avatar') {
      localStorage.setItem('beautify_chat_avatar', css);
      // 顺带把头像框地址写进 nano_avatar_frame，实时聊天才会插入真实叠加元素
      try {
        var fm = css.match(/url\(["']?([^"')]+)["']?\)/i);
        if (fm && fm[1]) {
          var sc = css.match(/top\s*:\s*(-?\d+)%/i) || css.match(/left\s*:\s*(-?\d+)%/i);
          localStorage.setItem('nano_avatar_frame', JSON.stringify({ url: fm[1], scale: sc ? Math.abs(parseInt(sc[1], 10)) : 16 }));
        } else {
          localStorage.removeItem('nano_avatar_frame');
        }
      } catch (e) {}
      savePreset('chat-avatar', name, css); broadcast('chat-avatar', css);
    } else if (scope === 'heart') {
      localStorage.setItem('nano_voice_applied_css', css);
      // 写进心声自己的模板库，心声面板下拉里就能看到并切换
      await saveHeartTemplate(name, css);
      try { window.parent.postMessage({ type: 'nanoVoiceCss', css: css, name: name }, '*'); } catch (e) {}
    } else if (scope === 'offline') {
      await setOfflineCss(css);
      savePreset('offline', name, css);
      // 通知已打开的线下页立即重读设置并套用（不用退出重进）
      try { window.parent.postMessage({ type: 'offlineSettingsChanged' }, '*'); } catch (e) {}
    } else {
      throw new Error('未知 scope：' + scope);
    }
  }
  function openPage(url) {
    if (!url) throw new Error('缺少 url');
    try { window.parent.postMessage({ type: 'openFullscreen', url: url, title: '', source: 'more', showBack: false }, '*'); }
    catch (e) { window.location.href = url; }
  }
  // 直接更换当前聊天背景（等同聊天设置里的「换背景」）
  async function setChatBackground(color, imageUrl) {
    var chatId = NANO_ID;
    try { chatId = new URLSearchParams(location.search).get('chat') || NANO_ID; } catch (e) {}
    var key = function (s) { return 'chat_setting_' + s + '_' + chatId; };
    color = String(color || '').trim();
    imageUrl = String(imageUrl || '').trim();
    if (imageUrl) {
      try { localStorage.setItem(key('bgType'), JSON.stringify('image')); } catch (e) {}
      try { if (typeof localforage !== 'undefined') await localforage.setItem(key('bgImage'), imageUrl); } catch (e) {}
    } else {
      try { localStorage.setItem(key('bgType'), JSON.stringify('color')); } catch (e) {}
      try { localStorage.setItem(key('bgColor'), JSON.stringify(color || '#ffffff')); } catch (e) {}
      try { if (typeof localforage !== 'undefined') await localforage.removeItem(key('bgImage')); } catch (e) {}
    }
    try {
      window.parent.postMessage({
        type: 'backgroundChanged', chatId: chatId,
        bgType: imageUrl ? 'image' : 'color',
        bgColor: color || '#ffffff',
        bgImage: imageUrl || ''
      }, '*');
    } catch (e) {}
    return true;
  }
  /* ---------- 纳米扩展权限：清空美化 / 改人设 / 人设历史版本 ---------- */
  function openCharsDb() {
    return new Promise(function (res) {
      try {
        var r = indexedDB.open('nano_characters_db', 1);
        r.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (x) {} };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function findCharacter(key) {
    return openCharsDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var tx = db.transaction('characters', 'readonly');
          var g = tx.objectStore('characters').getAll();
          g.onsuccess = function () {
            var list = g.result || [];
            var c = list.find(function (x) { return x && (String(x.id) === String(key) || x.name === key); });
            db.close(); res(c || null);
          };
          g.onerror = function () { db.close(); res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function putCharacter(rec) {
    return openCharsDb().then(function (db) {
      if (!db) return false;
      return new Promise(function (res) {
        try {
          var tx = db.transaction('characters', 'readwrite');
          tx.objectStore('characters').put(rec);
          tx.oncomplete = function () { db.close(); res(true); };
          tx.onerror = function () { db.close(); res(false); };
        } catch (e) { res(false); }
      });
    });
  }
  function pvKey(id) { return 'nano_persona_versions_' + id; }
  function getVersions(id) { try { return JSON.parse(localStorage.getItem(pvKey(id)) || '[]') || []; } catch (e) { return []; } }
  function pushVersion(id, name, setting) {
    try {
      var list = getVersions(id);
      list.unshift({ ts: Date.now(), name: name || '', setting: String(setting || '') });
      if (list.length > 30) list = list.slice(0, 30);
      localStorage.setItem(pvKey(id), JSON.stringify(list));
    } catch (e) {}
  }
  function clearAppliedKeysInIDB(keys) {
    try {
      var req = indexedDB.open('BeautifyAppDB', 1);
      req.onsuccess = function (ev) {
        try {
          var db = ev.target.result;
          var tx = db.transaction('settings', 'readwrite');
          var st = tx.objectStore('settings');
          (keys || []).forEach(function (k) { st.put({ key: k, value: '' }); });
        } catch (e) {}
      };
    } catch (e) {}
  }
  function clearBeautifyScope(scope) {
    scope = String(scope || '').trim();
    if (scope === 'chat') { try { localStorage.removeItem('beautify_chat'); localStorage.removeItem('beautify_chat_v2'); } catch (e) {} clearAppliedKeysInIDB(['applied_chat']); broadcast('chat', ''); }
    else if (scope === 'groups') { try { localStorage.removeItem('beautify_groups'); localStorage.removeItem('beautify_groups_v2'); } catch (e) {} clearAppliedKeysInIDB(['applied_groups']); broadcast('groups', ''); }
    else if (scope === 'heart') { try { localStorage.removeItem('nano_voice_applied_css'); } catch (e) {} try { window.parent.postMessage({ type: 'nanoVoiceCss', css: '', name: '' }, '*'); } catch (e) {} }
    else if (scope === 'global') { try { localStorage.removeItem('beautify_global'); localStorage.removeItem('beautify_global_v2'); } catch (e) {} clearAppliedKeysInIDB(['applied_global']); broadcast('global', ''); }
    else if (scope === 'offline') { return setOfflineCss('').then(function () { try { window.parent.postMessage({ type: 'offlineSettingsChanged' }, '*'); } catch (e) {} }); }
    else throw new Error('未知 scope：' + scope);
  }
  async function editPersona(key, setting) {
    var c = await findCharacter(key);
    if (!c) throw new Error('找不到角色：' + key);
    pushVersion(c.id, c.name, c.setting || '');
    c.setting = String(setting || '');
    await putCharacter(c);
    try { if (window.parent !== window) window.parent.postMessage({ type: 'contactsDataUpdated' }, '*'); } catch (e) {}
    return true;
  }
  async function savePersonaVersion(key) {
    var c = await findCharacter(key);
    if (!c) throw new Error('找不到角色：' + key);
    pushVersion(c.id, c.name, c.setting || '');
    return getVersions(c.id).length;
  }
  async function listPersonaVersions(key) {
    var c = await findCharacter(key);
    if (!c) throw new Error('找不到角色：' + key);
    var list = getVersions(c.id);
    var text = list.map(function (v, i) { return '#' + (i + 1) + ' ' + new Date(v.ts).toLocaleString() + '：' + String(v.setting || '').slice(0, 40); }).join('\n');
    try { window.parent.postMessage({ type: 'alert', message: '人设历史版本：\n' + (text || '（暂无）') }, '*'); } catch (e) {}
    return text || '（暂无历史版本）';
  }
  async function restorePersonaVersion(key, index) {
    var c = await findCharacter(key);
    if (!c) throw new Error('找不到角色：' + key);
    var list = getVersions(c.id);
    var i = parseInt(index, 10) - 1;
    if (!(i >= 0 && i < list.length)) throw new Error('版本号不存在：' + index);
    pushVersion(c.id, c.name, c.setting || '');       // 回退前先存当前，便于再回退
    c.setting = list[i].setting || '';
    await putCharacter(c);
    try { if (window.parent !== window) window.parent.postMessage({ type: 'contactsDataUpdated' }, '*'); } catch (e) {}
    return true;
  }

  /* ---------- 预设：读取 / 新增 / 修改 / 删除 ---------- */
  // 统一 scope：
  //   global | chat | chat-avatar | offline | font   → BeautifyAppDB/presets（category 同名）
  //   heart                                          → NanoVoiceDB/templates
  //   offline-style | offline-cot | offline-css       → MeetSettingsDB/{stylePresets,cotPresets,cssPresets}
  //   offline-rules                                  → MeetSettingsDB/rules
  //   menu-plugin                                    → localStorage.offline_menu_plugins
  var OFFLINE_SIMPLE = {
    'offline-style': { store: 'stylePresets', id: 'style_presets' },
    'offline-cot': { store: 'cotPresets', id: 'cot_presets' },
    'offline-css': { store: 'cssPresets', id: 'css_presets' }
  };
  var MENU_PLUGIN_KEY = 'offline_menu_plugins';

  function openVersionedDB(name, version, setup) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(name, version);
        req.onupgradeneeded = function (e) { try { setup(e.target.result); } catch (x) {} };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function ensureBeautifyStores(db) {
    if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
  }
  function ensureMeetStores(db) {
    ['settings', 'rules', 'stylePresets', 'cssPresets', 'cotPresets', 'messages'].forEach(function (s) {
      if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    });
  }
  function idbAll(db, store) {
    return new Promise(function (res) {
      try {
        if (!db || !db.objectStoreNames.contains(store)) { res([]); return; }
        var rq = db.transaction(store, 'readonly').objectStore(store).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { res([]); };
      } catch (e) { res([]); }
    });
  }
  function idbPut(db, store, rec) {
    return new Promise(function (res) {
      try {
        if (!db || !db.objectStoreNames.contains(store)) { res(false); return; }
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(rec);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }
  function idbDelete(db, store, key) {
    return new Promise(function (res) {
      try {
        if (!db || !db.objectStoreNames.contains(store)) { res(false); return; }
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }

  function menuPluginList() { try { return JSON.parse(localStorage.getItem(MENU_PLUGIN_KEY) || '[]') || []; } catch (e) { return []; } }
  function menuPluginWrite(list) { try { localStorage.setItem(MENU_PLUGIN_KEY, JSON.stringify((list || []).slice(0, 40))); } catch (e) {} }

  // 列出某范围已有的预设，返回 [{name, content}]（content 可能为空串）
  async function presetList(scope) {
    scope = String(scope || '').trim();
    if (OFFLINE_SIMPLE[scope]) {
      var cfg = OFFLINE_SIMPLE[scope];
      var mdb = await openVersionedDB('MeetSettingsDB', 2, ensureMeetStores);
      var recs = await idbAll(mdb, cfg.store);
      if (mdb) mdb.close();
      var rec = recs.find(function (r) { return r && r.id === cfg.id; });
      return (rec && Array.isArray(rec.presets)) ? rec.presets.map(function (p) { return { name: p.name, content: p.content || '' }; }) : [];
    }
    if (scope === 'offline-rules') {
      var mdb2 = await openVersionedDB('MeetSettingsDB', 2, ensureMeetStores);
      var rrec = (await idbAll(mdb2, 'rules')).find(function (r) { return r && r.id === 'main_rules'; });
      if (mdb2) mdb2.close();
      var out = [];
      ((rrec && rrec.groups) || []).forEach(function (g) { (g.rules || []).forEach(function (r) { out.push({ name: (g.name || '') + ' / ' + (r.name || ''), content: r.content || '' }); }); });
      return out;
    }
    if (scope === 'menu-plugin') {
      return menuPluginList().map(function (p) { return { name: p.name || '', content: String(p.js || '').slice(0, 200) }; });
    }
    if (scope === 'heart') {
      var vdb = await openVersionedDB('NanoVoiceDB', 1, function (db) { if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' }); });
      var list = await idbAll(vdb, 'templates');
      if (vdb) vdb.close();
      return list.map(function (t) { return { name: t.name || t.id, content: t.css || '' }; });
    }
    if (scope === 'font') {
      // 字体预设不在 BeautifyAppDB；仅提示
      return [];
    }
    if (scope === 'global' || scope === 'chat' || scope === 'chat-avatar' || scope === 'offline') {
      var bdb = await openVersionedDB('BeautifyAppDB', 1, ensureBeautifyStores);
      var all = await idbAll(bdb, 'presets');
      if (bdb) bdb.close();
      return all.filter(function (p) { return p && p.category === scope; }).map(function (p) { return { name: p.name || '', content: p.code || '' }; });
    }
    throw new Error('不支持的 scope：' + scope);
  }

  async function presetRead(scope, name) {
    var list = await presetList(scope);
    name = String(name || '').trim();
    var hit = list.find(function (p) { return p.name === name; });
    if (!hit) throw new Error('没有找到预设「' + name + '」（scope=' + scope + '）');
    if (scope === 'menu-plugin') {
      var p = menuPluginList().find(function (x) { return (x.name || '') === name; });
      return (p && p.js) || '';
    }
    return hit.content || '';
  }

  async function presetSave(scope, name, content) {
    scope = String(scope || '').trim();
    name = String(name || '').trim();
    content = String(content || '');
    if (!name) throw new Error('缺少预设名 name');
    if (OFFLINE_SIMPLE[scope]) {
      var cfg = OFFLINE_SIMPLE[scope];
      var mdb = await openVersionedDB('MeetSettingsDB', 2, ensureMeetStores);
      var recs = await idbAll(mdb, cfg.store);
      var rec = recs.find(function (r) { return r && r.id === cfg.id; }) || { id: cfg.id, presets: [] };
      if (!Array.isArray(rec.presets)) rec.presets = [];
      var found = rec.presets.find(function (p) { return p && p.name === name; });
      if (found) { found.content = content; } else { rec.presets.push({ name: name, content: content }); }
      await idbPut(mdb, cfg.store, rec);
      if (mdb) mdb.close();
      return true;
    }
    if (scope === 'heart') {
      var vdb = await openVersionedDB('NanoVoiceDB', 1, function (db) { if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' }); });
      var list = await idbAll(vdb, 'templates');
      var key = 'nano_' + name;
      var hit = list.find(function (t) { return t && (t.name === name || t.id === key); });
      var rid = hit ? hit.id : key;
      await idbPut(vdb, 'templates', { id: rid, name: name, css: content });
      if (vdb) vdb.close();
      return true;
    }
    if (scope === 'menu-plugin') {
      var arr = menuPluginList();
      var f = arr.find(function (p) { return (p.name || '') === name; });
      if (f) { f.js = content; } else { arr.push({ name: name, js: content }); }
      menuPluginWrite(arr);
      try { window.parent.postMessage({ type: 'offlineMenuPluginsChanged' }, '*'); } catch (e) {}
      return true;
    }
    if (scope === 'global' || scope === 'chat' || scope === 'chat-avatar' || scope === 'offline') {
      var bdb = await openVersionedDB('BeautifyAppDB', 1, ensureBeautifyStores);
      var all = await idbAll(bdb, 'presets');
      var ex = all.find(function (p) { return p && p.category === scope && p.name === name; });
      if (ex) { ex.code = content; ex.updatedAt = Date.now(); await idbPut(bdb, 'presets', ex); }
      else { await idbPut(bdb, 'presets', { category: scope, name: name, code: content, createdAt: Date.now() }); }
      if (bdb) bdb.close();
      return true;
    }
    throw new Error('不支持的 scope：' + scope);
  }

  async function presetDelete(scope, name) {
    scope = String(scope || '').trim();
    name = String(name || '').trim();
    var removed = false;
    if (OFFLINE_SIMPLE[scope]) {
      var cfg = OFFLINE_SIMPLE[scope];
      var mdb = await openVersionedDB('MeetSettingsDB', 2, ensureMeetStores);
      var recs = await idbAll(mdb, cfg.store);
      var rec = recs.find(function (r) { return r && r.id === cfg.id; });
      if (rec && Array.isArray(rec.presets)) {
        var before = rec.presets.length;
        rec.presets = rec.presets.filter(function (p) { return !(p && p.name === name); });
        removed = rec.presets.length < before;
        await idbPut(mdb, cfg.store, rec);
      }
      if (mdb) mdb.close();
    } else if (scope === 'offline-rules') {
      var mdb2 = await openVersionedDB('MeetSettingsDB', 2, ensureMeetStores);
      var rrec = (await idbAll(mdb2, 'rules')).find(function (r) { return r && r.id === 'main_rules'; });
      if (rrec && Array.isArray(rrec.groups)) {
        rrec.groups.forEach(function (g) {
          var before = (g.rules || []).length;
          g.rules = (g.rules || []).filter(function (r) { return !(r && (((g.name || '') + ' / ' + (r.name || '')) === name || r.name === name)); });
          if (g.rules.length < before) removed = true;
        });
        await idbPut(mdb2, 'rules', rrec);
      }
      if (mdb2) mdb2.close();
    } else if (scope === 'menu-plugin') {
      var arr = menuPluginList();
      var before2 = arr.length;
      var next = arr.filter(function (p) { return (p.name || '') !== name; });
      removed = next.length < before2;
      menuPluginWrite(next);
      try { window.parent.postMessage({ type: 'offlineMenuPluginsChanged' }, '*'); } catch (e) {}
    } else if (scope === 'heart') {
      var vdb = await openVersionedDB('NanoVoiceDB', 1, function (db) { if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' }); });
      var list = await idbAll(vdb, 'templates');
      var hit = list.find(function (t) { return t && (t.name === name || t.id === ('nano_' + name)); });
      if (hit) { await idbDelete(vdb, 'templates', hit.id); removed = true; }
      if (vdb) vdb.close();
    } else if (scope === 'global' || scope === 'chat' || scope === 'chat-avatar' || scope === 'offline') {
      var bdb = await openVersionedDB('BeautifyAppDB', 1, ensureBeautifyStores);
      var all = await idbAll(bdb, 'presets');
      var hit2 = all.filter(function (p) { return p && p.category === scope && p.name === name; });
      for (var i = 0; i < hit2.length; i++) { await idbDelete(bdb, 'presets', hit2[i].id); removed = true; }
      if (bdb) bdb.close();
    } else {
      throw new Error('不支持的 scope：' + scope);
    }
    if (!removed) throw new Error('没有找到要删除的预设「' + name + '」');
    return true;
  }

  // 给线下规则新增一条规则（追加到已有规则组；组不存在则新建）
  async function addOfflineRule(groupName, ruleName, content) {
    if (!(await dbExists('MeetSettingsDB'))) throw new Error('线下规则库还没初始化，请先打开一次线下设置/线下模式');
    var db = await openVersionedDB('MeetSettingsDB', 2, ensureMeetStores);
    var recs = await idbAll(db, 'rules');
    var rec = recs.find(function (r) { return r && r.id === 'main_rules'; });
    if (!rec) throw new Error('线下规则库还没初始化（未找到 main_rules），请先打开一次线下设置');
    if (!Array.isArray(rec.groups)) rec.groups = [];
    var gname = String(groupName || '').trim() || '纳米新增规则';
    var g = rec.groups.find(function (x) { return x && x.name === gname; });
    if (!g) { g = { id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: gname, enabled: true, expanded: false, rules: [] }; rec.groups.push(g); }
    if (!Array.isArray(g.rules)) g.rules = [];
    g.rules.push({ id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: String(ruleName || '新规则').slice(0, 40), content: String(content || ''), enabled: true });
    await idbPut(db, 'rules', rec);
    if (db) db.close();
    try { window.parent.postMessage({ type: 'offlineSettingsChanged' }, '*'); } catch (e) {}
    return { group: gname, added: 1 };
  }

  // 给线下头像菜单添加一个 JS 插件
  function addMenuPlugin(name, js) {
    js = String(js || '').trim();
    if (!js) throw new Error('插件 js 为空');
    var arr = menuPluginList();
    var nm = String(name || ('纳米插件 ' + (arr.length + 1))).trim().slice(0, 30);
    var f = arr.find(function (p) { return (p.name || '') === nm; });
    if (f) { f.js = js; } else { arr.push({ name: nm, js: js }); }
    menuPluginWrite(arr);
    try { window.parent.postMessage({ type: 'offlineMenuPluginsChanged' }, '*'); } catch (e) {}
    return { name: nm, total: arr.length };
  }

  function scopeLabel(scope) {
    var map = {
      'global': '全局美化', 'chat': '聊天美化', 'chat-avatar': '聊天头像', 'offline': '线下美化', 'font': '字体',
      'heart': '心声美化', 'offline-style': '线下文风', 'offline-cot': '线下思维链', 'offline-css': '线下美化预设',
      'offline-rules': '线下规则', 'menu-plugin': '线下菜单插件'
    };
    return map[scope] || scope;
  }

  // 只读：把某范围的预设连同内容拼成文本（供模型读取后继续处理）
  async function presetsToText(scope, name) {
    scope = String(scope || '').trim();
    if (name) {
      var content = await presetRead(scope, name);
      return '【' + scopeLabel(scope) + '·预设「' + name + '」】\n' + content;
    }
    var list = await presetList(scope);
    if (!list.length) return '【' + scopeLabel(scope) + '】当前没有已保存的预设。';
    return '【' + scopeLabel(scope) + '·共 ' + list.length + ' 个预设】\n' + list.map(function (p) {
      return '· ' + p.name + (p.content ? ('：' + String(p.content).replace(/\s+/g, ' ').slice(0, 80)) : '');
    }).join('\n');
  }

  async function execAction(a) {
    if (!a || !a.tool) throw new Error('空动作');
    var args = a.args || {};
    if (a.tool === 'clear_beautify') return clearBeautifyScope(args.scope);
    if (a.tool === 'edit_persona') return editPersona(args.name || args.id || args.char, args.setting);
    if (a.tool === 'save_persona_version') return savePersonaVersion(args.name || args.id || args.char);
    if (a.tool === 'list_persona_versions') return listPersonaVersions(args.name || args.id || args.char);
    if (a.tool === 'restore_persona_version') return restorePersonaVersion(args.name || args.id || args.char, args.index);
    if (a.tool === 'apply_beautify') return applyBeautify(args.scope, args.name, args.css);
    if (a.tool === 'add_worldbook') return addWorldbook(args.name, args.entries, args.worldbook || args.target, args.group);
    if (a.tool === 'add_emoji') return addEmoji(args.group || args.name, args.emojis || args.items);
    if (a.tool === 'set_chat_background') return setChatBackground(args.color, args.image);
    if (a.tool === 'set_avatar') return setAvatar(args);
    if (a.tool === 'open_page') return openPage(args.url);
    if (a.tool === 'save_preset') return presetSave(args.scope, args.name, args.content != null ? args.content : args.code);
    if (a.tool === 'delete_preset') return presetDelete(args.scope, args.name);
    if (a.tool === 'add_offline_rule') return addOfflineRule(args.group, args.name, args.content);
    if (a.tool === 'add_menu_plugin') return addMenuPlugin(args.name, args.js);
    if (a.tool === 'list_presets' || a.tool === 'read_preset') return null;  // 只读，由 chat-core 读取结果后喂回模型继续
    if (a.tool === 'read_file') return null;
    throw new Error('未知动作 ' + a.tool);
  }
  function actionTitle(a) {
    if (a.tool === 'clear_beautify') return '清空美化，恢复默认：' + (a.args.scope || '');
    if (a.tool === 'edit_persona') return '修改人设：' + (a.args.name || a.args.id || '');
    if (a.tool === 'save_persona_version') return '保存人设历史版本：' + (a.args.name || a.args.id || '');
    if (a.tool === 'list_persona_versions') return '查看人设历史版本：' + (a.args.name || a.args.id || '');
    if (a.tool === 'restore_persona_version') return '回退人设到版本 #' + (a.args.index || '') + '：' + (a.args.name || a.args.id || '');
    if (a.tool === 'apply_beautify') return '覆盖「' + (a.args.scope || '') + '」美化：' + (a.args.name || '未命名');
    if (a.tool === 'add_worldbook') {
      var wbTarget = a.args.worldbook || a.args.target;
      var wbCount = (a.args.entries || []).length;
      return wbTarget
        ? '向世界书「' + wbTarget + '」填入 ' + wbCount + ' 条'
        : '新增世界书：' + (a.args.name || '') + '（' + wbCount + ' 条）';
    }
    if (a.tool === 'add_emoji') return '新增表情包分组：' + (a.args.group || a.args.name || '纳米表情') + '（' + (((a.args.emojis || a.args.items || []).length)) + ' 个）';
    if (a.tool === 'set_chat_background') return '更换聊天背景：' + (a.args.image ? '图片' : (a.args.color || '默认'));
    if (a.tool === 'set_avatar') return '更换角色头像：' + (a.args.url ? '指定图片' : '用刚发送的图片');
    if (a.tool === 'open_page') return '打开页面：' + (a.args.url || '');
    if (a.tool === 'save_preset') return '保存预设：' + (a.args.name || '') + '（' + scopeLabel(a.args.scope) + '）';
    if (a.tool === 'delete_preset') return '删除预设：' + (a.args.name || '') + '（' + scopeLabel(a.args.scope) + '）';
    if (a.tool === 'add_offline_rule') return '新增线下规则：' + (a.args.name || '') + '（规则组：' + (a.args.group || '纳米新增规则') + '）';
    if (a.tool === 'add_menu_plugin') return '新增线下菜单插件：' + (a.args.name || '');
    if (a.tool === 'list_presets') return '查看预设列表：' + scopeLabel(a.args.scope);
    if (a.tool === 'read_preset') return '读取预设：' + (a.args.name || '') + '（' + scopeLabel(a.args.scope) + '）';
    return a.tool;
  }

  window.NanoAssistant = {
    id: NANO_ID,
    isNano: isNano,
    systemPrompt: systemPrompt,
    parseActions: parseActions,
    fetchSource: fetchSource,
    execAction: execAction,
    actionTitle: actionTitle,
    // 只读预设（供 chat-core 读取后喂回模型继续处理）
    listPresets: function (scope) { return presetsToText(scope, null); },
    readPreset: function (scope, name) { return presetsToText(scope, name); },
    // 供外部面板/调试使用
    presetList: presetList,
    presetRead: presetRead,
    presetSave: presetSave,
    presetDelete: presetDelete
  };
})();
