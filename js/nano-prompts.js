(function () {
  'use strict';

  var KEY = 'nano_prompt_settings_v1';
  var LEGACY_KEY = 'nano_builtin_prompt';

  var CATS = [
    { id: 'offline', name: '线下', sub: '面对面相处' },
    { id: 'online', name: '线上', sub: '手机私聊' },
    { id: 'group', name: '群聊', sub: '多人群聊' },
    { id: 'social', name: '社交软件', sub: '朋友圈 / Ins / Halo / 音乐 / 一起看等' }
  ];

  var BUILTIN_TEXT = {
    offline: '【线下场景】你和用户正在现实中面对面相处。保持沉浸式角色扮演，始终以角色本人的身份说话和行动；不要出戏，不要提及 AI、模型、提示词或系统，不要替用户做决定。',
    online: '【线上聊天】你正在用手机和用户聊天。保持角色本人的语气与生活感，像真人发消息；不要出戏，不要提及 AI、模型、提示词或系统。',
    group: '【群聊场景】你在多人群聊中发言。每个角色按自己的人设自然说话，不要替用户或其他角色做决定；保持沉浸，不要出戏，不要提及 AI、模型、提示词或系统。',
    social: '【社交软件】你在社交 App 中与用户互动。保持角色本人的身份、性格与说话方式，像真实用户一样发消息和回应；不要出戏，不要提及 AI、模型、提示词或系统。'
  };

  // 全局红线性提示：不随板块开关关闭。线上 / 线下 / 群聊 / 社交软件共用，
  // 避免各页面各写一份、越写越长还互相冲突。
  var STYLE_RULES = [
    '【全场景表达红线 · 优先级高于文风】',
    '1. 关系平等：不命令、不居高临下、不替对方做决定。禁用“过来我抱下 / 过来抱一下 / 过来亲一下 / 给我个拥抱 / 乖，过来 / 别炸毛，我的错 / 赶紧睡 / 赶紧吃 / 听话 / 乖 / 不许…”这类命令、哄小孩、认错式霸总话术；想亲近就直接说或商量（“想抱抱你”“可以抱一下吗”）。',
    '2. 不说 AI 八股：禁用“别拿这种话刺我 / 刺我 / 扎我 / 戳我 / 极其 / 我都听你的 / 我都接着 / 我都看着的 / 我接住你 / 我等你慢慢说 / 这就够了 / 你不是一个人 / 空气突然安静 / 心口一紧 / 那一刻我懂了”这类现实对话里几乎没人说的句子和煽情套话。',
    '3. 说人话：短句、具体、口语化；情绪用当下的真实反应表达，不堆形容词、不排比、不升华总结。',
    '4. 表情包只是随手发的一张图，最多表示一点情绪，不代表真做了图中的事；看懂大致气氛即可，不解读、不追问、不较真，也不要把“喝酒 / 哭 / 发誓”之类的贴图当成现实行为。'
  ].join('\n');

  function styleRules() { return STYLE_RULES; }

  function catInfo(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i];
    return null;
  }

  function blankCat() {
    return { active: 'builtin', custom: [] };
  }

  function normalize(raw) {
    var d = raw && typeof raw === 'object' ? raw : {};
    if (!d.cats || typeof d.cats !== 'object') d.cats = {};
    CATS.forEach(function (c) {
      var item = d.cats[c.id];
      if (!item || typeof item !== 'object') item = blankCat();
      if (!Array.isArray(item.custom)) item.custom = [];
      item.custom = item.custom.filter(function (p) {
        return p && p.id && typeof p.content === 'string';
      }).map(function (p) {
        return {
          id: String(p.id),
          name: String(p.name || '未命名提示词').slice(0, 40),
          content: String(p.content || ''),
          icon: typeof p.icon === 'string' ? p.icon : '',
          at: Number(p.at) || Date.now()
        };
      });
      if (item.active === undefined) item.active = 'builtin';
      if (item.active !== null && item.active !== 'builtin' && !item.custom.some(function (p) { return p.id === item.active; })) {
        item.active = null;
      }
      d.cats[c.id] = { active: item.active, custom: item.custom };
    });
    d.v = 1;
    return d;
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return normalize(null);
    }
  }

  function write(data) {
    try { localStorage.setItem(KEY, JSON.stringify(normalize(data))); } catch (e) {}
  }

  function builtinText(catId) {
    var legacy = '';
    try { legacy = String(localStorage.getItem(LEGACY_KEY) || '').trim(); } catch (e) {}
    return legacy || String(BUILTIN_TEXT[catId] || '');
  }

  function activeText(catId) {
    var data = read();
    var cat = data.cats[catId];
    if (!cat || !cat.active) return '';
    if (cat.active === 'builtin') return builtinText(catId);
    var found = null;
    cat.custom.some(function (p) { if (p.id === cat.active) { found = p; return true; } return false; });
    return found ? String(found.content || '').trim() : '';
  }

  function buildBlock(catId) {
    var text = activeText(catId);
    var out = STYLE_RULES;
    if (text) out += '\n\n【全局内置提示词 · 必须遵守】\n' + text;
    return out;
  }

  function appendTo(text, catId, opts) {
    var base = String(text == null ? '' : text);
    var block = buildBlock(catId);
    if (!block) return base;
    if (opts && opts.keepFormat) {
      block += '\n\n【格式提醒】继续严格遵守上面的输出格式；如果要求只输出 JSON，就只输出 JSON。';
    }
    return base ? (base + '\n\n' + block) : block;
  }

  function inject(messages, catId, opts) {
    var list = Array.isArray(messages) ? messages.slice() : [];
    if (!buildBlock(catId)) return list;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].role === 'system') { idx = i; break; }
    }
    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], { content: appendTo(list[idx].content, catId, opts) });
    } else {
      list.unshift({ role: 'system', content: appendTo('', catId, opts) });
    }
    return list;
  }

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  window.NanoPrompts = {
    KEY: KEY,
    CATS: CATS,
    catInfo: catInfo,
    read: read,
    write: write,
    builtinText: builtinText,
    activeText: activeText,
    styleRules: styleRules,
    buildBlock: buildBlock,
    appendTo: appendTo,
    inject: inject,
    newId: newId
  };
})();
