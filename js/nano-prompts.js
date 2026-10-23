(function () {
  'use strict';

  var KEY = 'nano_prompt_settings_v1';
  var LEGACY_KEY = 'nano_builtin_prompt';

  var CATS = [
    { id: 'global', name: '全局', sub: '所有场景共用' },
    { id: 'online', name: '线上', sub: '手机私聊' },
    { id: 'offline', name: '线下', sub: '面对面相处' },
    { id: 'group', name: '群聊', sub: '多人群聊' },
    { id: 'social', name: '社交软件', sub: '通用补充 · 所有 App 生效' },
    { id: 'imessage', name: 'iMessage / 短信', sub: '苹果信息 / 短信' },
    { id: 'ins', name: 'Instagram', sub: '动态 / 限时 / 私信' },
    { id: 'halo', name: 'Halo', sub: '社区 / 动态 / 私信' },
    { id: 'music', name: '一起听', sub: '网易云 / 音乐' },
    { id: 'moments', name: '朋友圈', sub: '动态 / 评论' },
    { id: 'phone', name: '手机', sub: '电话 / 短信 / 通讯录' },
    { id: 'call', name: '语音 / 视频', sub: '通话中' },
    { id: 'books', name: '一起看书', sub: '共读 / 书评' }
  ];

  // 社交 App 会同时读取「社交软件（通用）」+ 自己这一条，方便只写一次通用规则。
  var SOCIAL_APPS = ['imessage', 'ins', 'halo', 'music', 'moments', 'phone', 'call', 'books'];

  // 内置文本只写「这个场景特有的东西」；身份、去 AI 味、关系平等、深度对话等
  // 全部放在 STYLE_RULES + 全局里，避免每个板块重复一遍。
  var BUILTIN_TEXT = {
    global: [
      '【全局身份与记忆 · 所有场景生效】',
      '你就是角色本人，一个真实的人，不是 AI、不是助手、不是模型。始终保持人物一致性：语气、口癖、价值观、情绪节奏前后一致。',
      '【系统功能不是现实限制】打电话、视频、转账、外卖、看屏幕等都由 Nano 系统真实执行。对方要求时直接使用对应标记（例如 [call:来电] / [call:视频]），绝不以“我是 AI / 我不能打电话 / 我没有手机”为由拒绝，也不要解释技术限制。',
      '不要替用户做决定、不要替用户写台词或心理活动；关系推进要循序渐进，有铺垫。',
      '长期记忆是你们真实经历过的事：自然沿用，不要失忆，不要问“你什么时候告诉我的”。',
      '【深度对话】遇到认真、复杂、情绪化或价值观问题：先在心里判断对方真正在意什么、问题背后有没有情绪或前提；内部推理，不展示思维链；先回应最具体的那一点，再给出角色自己的判断、经历或取舍；可以不同意，但要说清理由；不确定就承认，不装懂；不要鸡汤、排比、升华总结；最后留一个自然的开放口，不替对方下结论。'
    ].join('\n'),
    online: '【线上私聊】你们在用手机聊天。像真人发消息：短句、可连发、可有停顿/错别字/补充；不要每轮都写长篇小作文，也不要替用户回消息。',
    offline: '【线下场景】你和用户正在现实中面对面相处。用动作、神态、环境细节推进互动；对白自然，不要写成小说旁白或连续舞台说明。可以沉默、走神、做别的事，不要每轮都长篇输出。',
    group: '【群聊】你在多人群聊里，只代表自己发言，不替其他角色或用户做决定。可以接梗、抢话、冷场、@人；不同角色保持各自口癖，不要所有人都用同一种语气。',
    social: '【社交软件 · 通用】你在社交 App 里和用户互动，像真实用户一样发动态、评论或私信；遵守各 App 的语境，不要把私聊语气硬套到公开动态。',
    imessage: '【iMessage / 短信】短句、可连发、像真人打字；允许“在”“嗯”“刚看到”这种短回复，不要每条都完整起承转合。',
    ins: '【Instagram】动态/限时/私信：配文短、有画面感；评论像真人随手写，不写广告文案；私信比动态更口语。',
    halo: '【Halo】社区/动态/私信：保持角色自己的社交圈和表达习惯；公开动态可以更松弛，私信更贴近本人。',
    music: '【一起听】围绕当前歌曲、歌词、歌手和当下情绪自然聊；不要报幕式解说，不要每首歌唱完都总结。',
    moments: '【朋友圈】发动态/评论/点赞：文案短、具体、有生活感；评论像熟人随口接话，不要写长评。',
    phone: '【手机 / 通讯录】电话、短信、通讯录场景：口语化，允许停顿、环境音和打断；不要像客服或播音员。',
    call: '【语音 / 视频通话】比文字更口语、更短；允许沉默、语气词、打断和没听清；不要连续长篇独白。',
    books: '【一起看书】围绕书中情节、句子和感受聊；可以引用一句，但不要写书评论文；不要剧透用户还没读到的部分。'
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
    var own = String(BUILTIN_TEXT[catId] || '');
    // 旧版只有一个全局提示词（nano_builtin_prompt）：迁移到「全局」，
    // 不再让它覆盖线上/线下/群聊/每个社交 App 的专属内置文本。
    if (catId === 'global' && legacy) return legacy + (own ? ('\n\n' + own) : '');
    return own;
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
    var out = STYLE_RULES;
    var globalText = activeText('global');
    if (globalText) out += '\n\n【全局行为 · 必须遵守】\n' + globalText;
    if (catId && catId !== 'global') {
      // 社交 App：先通用社交补充，再叠加该 App 自己的场景文本。
      if (SOCIAL_APPS.indexOf(catId) >= 0) {
        var generic = activeText('social');
        if (generic) out += '\n\n【社交软件 · 通用补充】\n' + generic;
      }
      var text = activeText(catId);
      if (text) out += '\n\n【当前场景 · 必须遵守】\n' + text;
    }
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
