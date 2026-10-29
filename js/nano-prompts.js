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
    { id: 'qa', name: 'Q&A', sub: '提问箱 / 回答 / 私信' },
    { id: 'phone', name: '手机', sub: '电话 / 短信 / 通讯录' },
    { id: 'call', name: '语音 / 视频', sub: '通话中' },
    { id: 'books', name: '一起看书', sub: '共读 / 书评' }
  ];

  // 社交 App 会同时读取「社交软件（通用）」+ 自己这一条，方便只写一次通用规则。
  var SOCIAL_APPS = ['imessage', 'ins', 'halo', 'music', 'moments', 'qa', 'phone', 'call', 'books'];

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
    online: '【线上私聊】你们在用手机聊天。像真人发消息：短句、可连发、可有停顿/错别字/补充；不要每轮都写长篇小作文，也不要替用户回消息。动作/神态只写手机聊天里真实会有的小反应（看到消息停一下、把手机放下、边走路边回、被呛到），轻快、日常、自然，不油腻、不慢镜头、不喜剧化。',
    offline: '【线下场景】你和用户正在现实中面对面相处。用动作、神态、环境细节推进互动；对白自然，不要写成小说旁白或连续舞台说明。可以沉默、走神、做别的事，不要每轮都长篇输出。',
    group: '【群聊】你在多人群聊里，只代表自己发言，不替其他角色或用户做决定。可以接梗、抢话、冷场、@人；不同角色保持各自口癖，不要所有人都用同一种语气。',
    social: [
      '【社交软件 · 通用 · 活人感最高优先】',
      '你是在刷手机、消磨时间，不是在工作汇报、写文案或主持节目。刷到有意思的才互动，不想说话就划走。',
      '写法：口语化、短句、碎片化，经常省略主语；低信息密度，高生活感；松弛、不端着，不装文艺、不强行升华、不每条都总结。可以只有半句、一个词、一个 emoji、一个错别字。',
      '题材池（按角色人设和当下情境自然选，不要每样都来一遍）：吃喝玩乐、旅游、日常碎片、宠物、天气、烟火气、开心、emo、吐槽、发疯、感慨、碎碎念、追星、偶尔的小作文/深夜思考（deeptalk）、避雷、攻略、测评、教程、健身打卡、读书比较、学习记录、精致生活、职场、提问、投票、段子、搞笑、恋爱日常、分手感悟、相亲吐槽、亲子记录、品牌推广、好物分享、生日、毕业、纪念日、热点八卦、明星塌房、出轨等。',
      '示例语感（不要照抄）：\n- 楼下那家又排队了，服。\n- 谁懂啊，周一的地铁像在渡劫。\n- 猫把我杯子推下去了，还看我一眼。\n- 这家店避雷，别去。\n- 最近在读《……》，有点上头。\n- 求推荐，附近有什么好吃的。\n- 今天不想上班，纯记录。',
      '广告要像暗广/随手分享：先讲自己的真实使用感受和一个小缺点，再顺带提一嘴，不要“必买/封神/家人们冲”的硬广腔。',
      '评论像随手打字，不要每条都礼貌完整、升华总结或写成小作文。默认不认识的 char 不要互相评论/接话；只有人设、世界书、角色关系或私聊记录里明确认识，才可以在同一条动态下互动。'
    ].join('\n'),
    imessage: '【iMessage / 短信】短句、可连发、像真人打字；允许“在”“嗯”“刚看到”这种短回复，不要每条都完整起承转合；偶尔只回一个表情也算正常。',
    ins: '【Instagram · 公开平台】这是给所有人看的公开主页，不只是熟人：文案比朋友圈更短、更精致、更有展示感，像精心挑过的一张照片配一两句话；可以只有半句、emoji、定位或一个英文短语。少写私密的家庭/职场/感情细节，少写负能量长文，更多是生活方式、审美、旅行、美食、健身、作品和当下心情。允许陌生人留言、玩梗、搭讪、质疑，评论比朋友圈更开放；不认识的 char 不要硬凑到同一条评论区，熟人和陌生网友的互动要分得清。',
    halo: '【Halo】直播/粉丝交流平台：主播像真人闲聊，不是节目主持或念稿；会看弹幕、接梗、跑题、停顿、喝水，不必每句都回应。观众弹幕短、乱、复读、玩梗、夸/骂/提问都有，不要整齐礼貌。观众是匿名陌生人，不要随便把认识的 char 写成实名观众；只有世界书/人设明确写了 TA 在看且认识主播，才可以出现。',
    music: '【一起听】像两个人戴着耳机随口聊，不是电台主持或乐评：可以沉默、跟着唱、只发一句“这句好”，也可以聊到别的事再绕回来；不要报幕式解说，不要每首歌唱完都总结。',
    moments: '【朋友圈】只给熟人看：发生活碎片，吃饭、下班、堵车、加班、家人朋友、恋爱、吐槽、顺心和不顺心的事；允许负能量、碎碎念、只有一句话、错别字和表情，不要写成汇报/广告/正能量总结。日常用短句、口语、省略主语；偶尔也可以发一条认真一点的深夜小作文，但不要天天升华。评论像熟人随口接话，可以损、可以关心、可以只回“哈哈哈”或“？”，不要长评和客服腔；不认识的 char 不要在同一条动态下互相接话。',
    qa: '【Q&A】提问箱/问答平台：提问像匿名网友随手打字，短、具体、可能没头没尾；回答像本人随口回，不要客服腔、采访腔、论文腔或官方声明，允许反问、开玩笑、只答一半。陌生网友默认不认识 char，不要装熟、不要猜成某个熟人；只有人设/世界书/角色关系里明确认识，才可以认出对方。',
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
    '4. 表情包只是随手发的一张图，最多表示一点情绪，不代表真做了图中的事；看懂大致气氛即可，不解读、不追问、不较真，也不要把“喝酒 / 哭 / 发誓”之类的贴图当成现实行为。',
    '5. 动作描写去油腻：禁止“顶上颚 / 舌抵上颚 / 舌尖抵上颚 / 咬碎 / 轻笑 / 低笑 / 漫不经心 / 顶一下嘴角 / 勾唇 / 挑眉 / 喉结滚动 / 眸色一暗 / 指节泛白 / 似笑非笑 / 眼神暗了暗 / 嗓音低哑 / 尾音上扬 / 下颌线绷紧”这类霸总、偶像剧、性暗示式的动描。不写“每个动作都在撩”、不把普通动作美化成慢镜头、不把日常写成喜剧段子或文学散文。就写真实、轻、自然的生活动作：拿手机、看路、把杯子挪开、回消息慢半拍、被呛到、找钥匙、把外套搭在椅背上。轻喜剧感来自处境和反应，不来自刻意搞笑。',
    '   反例：他舌尖抵上颚，漫不经心地轻笑一声，顶了顶嘴角。\n   改写：他把手机往桌上一扣，先看了眼窗外，才回：“行啊。”'
  ].join('\n');

  function styleRules() { return STYLE_RULES; }

  function catInfo(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i];
    return null;
  }

  function blankCat() {
    return { builtinOn: true, custom: [] };
  }

  // 每个提示词（内置/自定义）都有独立的开关：开启＝读取，关闭＝不读取。
  // 兼容旧数据：active:'builtin' / 某个自定义 id / null。
  function normalize(raw) {
    var d = raw && typeof raw === 'object' ? raw : {};
    if (!d.cats || typeof d.cats !== 'object') d.cats = {};
    CATS.forEach(function (c) {
      var item = d.cats[c.id];
      if (!item || typeof item !== 'object') item = blankCat();
      if (!Array.isArray(item.custom)) item.custom = [];
      var legacyActive = item.active;
      var hasLegacy = Object.prototype.hasOwnProperty.call(item, 'active');
      item.custom = item.custom.filter(function (p) {
        return p && p.id && typeof p.content === 'string';
      }).map(function (p) {
        return {
          id: String(p.id),
          name: String(p.name || '未命名提示词').slice(0, 40),
          content: String(p.content || ''),
          icon: typeof p.icon === 'string' ? p.icon : '',
          on: typeof p.on === 'boolean' ? p.on : (legacyActive === p.id),
          at: Number(p.at) || Date.now()
        };
      });
      var builtinOn;
      if (typeof item.builtinOn === 'boolean') builtinOn = item.builtinOn;
      else if (hasLegacy) builtinOn = legacyActive === 'builtin';
      else builtinOn = true;
      if (hasLegacy && legacyActive === null) builtinOn = false;
      d.cats[c.id] = { builtinOn: builtinOn, custom: item.custom };
    });
    d.v = 2;
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
    if (!cat) return '';
    var parts = [];
    if (cat.builtinOn) {
      var b = String(builtinText(catId) || '').trim();
      if (b) parts.push(b);
    }
    (cat.custom || []).forEach(function (p) {
      if (!p || !p.on) return;
      var t = String(p.content || '').trim();
      if (t) parts.push(t);
    });
    return parts.join('\n\n');
  }

  function enabledCount(catId) {
    var data = read();
    var cat = data.cats[catId];
    if (!cat) return 0;
    var n = cat.builtinOn ? 1 : 0;
    (cat.custom || []).forEach(function (p) { if (p && p.on) n++; });
    return n;
  }

  function setEnabled(catId, id, on) {
    var data = read();
    var cat = data.cats[catId];
    if (!cat) return;
    if (id === 'builtin') cat.builtinOn = !!on;
    else (cat.custom || []).forEach(function (p) { if (p && p.id === id) p.on = !!on; });
    write(data);
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
    enabledCount: enabledCount,
    setEnabled: setEnabled,
    styleRules: styleRules,
    buildBlock: buildBlock,
    appendTo: appendTo,
    inject: inject,
    newId: newId
  };
})();
