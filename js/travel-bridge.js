/* ============================================================
   js/travel-bridge.js — 私聊里的「旅途」桥
   ------------------------------------------------------------
   在 chat_inner.html 中加载，负责：
   - 给主聊天注入「一起去邀请 / 旅途」提示块
   - 解析角色回复里的 [一起去:accept|reject] 和 [邀请一起去:...]
   - 把旅途报备卡片投递到私聊
   - 随机让角色报备旅程（受 24h 活跃 + 冷却限制）
   - 接收「旅途」App 写回的分享卡片并即时显示
   - 点击卡片打开旅途 / 一起去页面
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoTravelBridge) return;

  var qs = new URLSearchParams(location.search || '');
  var chatId = String(qs.get('chat') || '');
  var charName = String(qs.get('name') || '');
  var readyTimer = null;
  var reportBusy = false;
  var composer = null;

  function store() { return window.NanoTravelStore; }
  function api() { return window.NanoTravelAPI; }
  function chat() { return window.__chat; }
  // 生图站常给临时 URL：写进聊天卡片前先转成永久 dataURL，避免几天后卡片图失效。
  function persistentImg(src) {
    var u = String(src || '');
    if (!u || !/^https?:\/\//i.test(u) || !window.NanoImageCache || !NanoImageCache.toDataUrl) return Promise.resolve(u);
    return NanoImageCache.toDataUrl(u).then(function (d) { return d || u; }).catch(function () { return u; });
  }
  function messages() {
    var c = chat();
    return c && Array.isArray(c.messages) ? c.messages : [];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nowTime() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function newTripId() {
    return 'trip_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }
  function displayName() {
    var c = chat();
    return (c && c.displayName) || charName || 'TA';
  }
  function userName() {
    var c = chat();
    if (c && c.currentUserName) return c.currentUserName;
    var s = store();
    return s && s.getMask ? (s.getMask().name || '我') : '我';
  }
  // 只有开启了「允许生图」的 char 才允许在旅途里生成图片。
  function charAllowsImage(id) {
    try {
      var raw = localStorage.getItem('chat_setting_allowImage_' + String(id || ''));
      if (raw === null) return false;
      var v = raw;
      try { v = JSON.parse(raw); } catch (e) {}
      return v === true || v === 1 || v === 'true' || v === '1';
    } catch (e) { return false; }
  }
  function isChatOffline() {
    try { return String(localStorage.getItem('nano_chat_mode_' + chatId) || '') === 'offline'; } catch (e) { return false; }
  }
  function recentMessageAt() {
    var last = 0;
    messages().forEach(function (m) {
      if (!m || m.isCard || m.recalled) return;
      if (!(m.text || m.transcript)) return;
      var ts = Number(m.ts) || 0;
      if (!ts) ts = parseInt(String(m.id || '').split('-')[0], 10) || 0;
      if (ts > last) last = ts;
    });
    return last;
  }
  // 只让「最近 24 小时真的在聊天」的角色主动分享旅程；很久没聊的不再打扰。
  function recentlyChatting() {
    try {
      var at = store() && store().lastChatAt ? Number(store().lastChatAt(chatId) || 0) : 0;
      if (at && Date.now() - at < 24 * 3600 * 1000) return true;
    } catch (e) {}
    var last = recentMessageAt();
    return !!last && Date.now() - last < 24 * 3600 * 1000;
  }

  function whenReady(fn) {
    if (window.__chat && window.__chat.addMessage) { try { fn(); } catch (e) {} return; }
    if (readyTimer) return;
    readyTimer = setInterval(function () {
      if (window.__chat && window.__chat.addMessage) {
        clearInterval(readyTimer);
        readyTimer = null;
        try { fn(); } catch (e) {}
      }
    }, 400);
  }

  /* ---------- 卡片查找 ---------- */
  function pendingInvites() {
    return messages().filter(function (m) {
      return m && !m.recalled && m.isCard && m.cardData &&
        m.cardData.cardType === 'travelInvite' &&
        (m.cardData.direction || 'user') === 'user' &&
        (m.cardData.status || 'pending') === 'pending';
    });
  }
  function findInvite(cardId) {
    return messages().find(function (m) {
      return m && m.cardData && m.cardData.cardType === 'travelInvite' &&
        (String(m.id) === String(cardId) || String(m.cardData.inviteId || '') === String(cardId));
    }) || null;
  }

  /* ---------- 主聊天提示 ---------- */
  function promptBlock() {
    var s = store();
    var mask = s && s.getMask ? s.getMask() : { name: '用户' };
    var out = [];
    out.push('【旅途 · 一起去】');
    out.push('你和「' + (mask.name || '用户') + '」有一个叫「旅途」的 App，会保存你各自的出行、你们共同的旅程、票根和拍立得。');
    out.push('注意：聊天里出现的「一起去」邀请、「旅途分享」「旅途报备」都是 App 卡片消息，不是用户发的照片；即使卡片带拍立得图片，也要把它理解成一段旅程的记录，不要误以为对方只发了一张照片。');
    try {
      var shared = messages().filter(function (m) {
        return m && !m.recalled && m.cardData &&
          (m.cardData.cardType === 'travelShare' || m.cardData.cardType === 'travelReport');
      }).slice(-2);
      if (shared.length) {
        out.push('你们最近在私聊里同步过旅途卡片：');
        shared.forEach(function (m) {
          var c = m.cardData || {};
          out.push('- ' + (c.travelKind === 'together' ? '你们刚一起旅行回来' : (c.cardType === 'travelShare' ? '对方分享' : '你报备')) + '：' + (c.title || c.place || '一段旅程')
            + (c.thought ? ('，心得：' + String(c.thought).slice(0, 80)) : '')
            + (c.img ? '（有拍立得）' : ''));
        });
        var hasUserShare = shared.some(function (m) { return m.cardData && m.cardData.cardType === 'travelShare'; });
        var hasTogether = shared.some(function (m) { return m.cardData && m.cardData.cardType === 'travelReport' && m.cardData.travelKind === 'together'; });
        if (hasTogether) {
          out.push('你们刚一起旅行回来，这趟出行已经结束了。不要再把行程当成还没发生、不要再问“什么时候出发/要不要去”，把它当作已经共同经历过的回忆；需要时用过去时自然提起。');
        }
        out.push(hasUserShare
          ? '对方刚把这段旅程分享给你。这一轮必须自然回应这张卡片：可以惊讶、追问、评价或想起某个细节；不要无视，也不要机械复述卡片内容。'
          : '如果氛围合适，可以自然提起这段旅途；不要机械复述卡片内容。');
      }
    } catch (e) {}
    out.push('你也可以主动分享自己一个人的行程、临时出门散心、路上遇到的小事和票根（旅途报备），不用等对方问；频率要低，别每轮都发。');
    out.push('当气氛自然、你真的想和对方一起出门时，可以主动邀请，但频率要低，不要每轮都提。邀请时单独占一行输出标记（标记不会显示给对方）：');
    out.push('[邀请一起去:目的地|日期|时间|天数|一句说明]');
    out.push('例如 [邀请一起去:苏州|这周末|上午十点|2|想去平江路慢慢走一走]。日期可以写“这周末/明天/下个月”等自然说法；天数写数字。');
    var pend = pendingInvites();
    if (pend.length) {
      var p = pend[pend.length - 1];
      var cd = p.cardData || {};
      out.push('对方刚刚发来一张「一起去」邀请卡片：目的地「' + (cd.dest || '待定') + '」，日期「' + (cd.date || '待定') + '」，大约 ' + (cd.days || '1') + ' 天' + (cd.note ? ('，留言：' + cd.note) : '') + '。');
      out.push('这一轮你必须明确表态，单独占一行输出其中一个标记：');
      out.push('- [一起去:accept]：接受邀请，并自然说一两句期待或安排。');
      out.push('- [一起去:reject]：婉拒邀请，委婉说清原因，不要生硬。');
      out.push('注意：不输出标记卡片会一直停在等待回应。');
    }
    return out.join('\n');
  }

  /* ---------- 角色回复里的标记 ---------- */
  function parseInviteArgs(raw) {
    var parts = String(raw || '').split(/[|｜]/).map(function (x) { return String(x || '').trim(); });
    return {
      dest: parts[0] || '附近走走',
      date: parts[1] || today(),
      time: parts[2] || '',
      days: String(parts[3] || '1').replace(/[^\d]/g, '') || '1',
      note: parts.slice(4).join('|').trim()
    };
  }
  function settleFromReplyText(rawText) {
    var body = String(rawText || '');
    var changed = false;

    // 1) 对用户邀请表态
    var pend = pendingInvites();
    if (pend.length) {
      var target = pend[pend.length - 1];
      var m = body.match(/\[一起去\s*[:：]\s*(accept|接受|同意|好|reject|拒绝|不去|婉拒)\s*\]/i);
      var accept = null;
      if (m) {
        accept = /accept|接受|同意|好/i.test(m[1]);
        body = body.replace(m[0], '');
      } else {
        // 容错：模型没输出标记，但语气非常明确
        var flat = body.replace(/\s/g, '');
        if (/(好啊|好呀|可以啊|没问题|当然|乐意|一起去吧|那就去|走吧|答应你)/.test(flat)) accept = true;
        else if (/(不去|下次吧|改天|没空|不太想|算了|走不开|拒绝)/.test(flat)) accept = false;
      }
      if (accept !== null) {
        var tripId = newTripId();
        target.cardData.status = accept ? 'accepted' : 'rejected';
        if (accept) target.cardData.tripId = tripId;
        changed = true;
        try {
          if (chat() && chat().addSystemNotice) {
            setTimeout(function () {
              try { chat().addSystemNotice(accept ? '对方接受了一起去邀请，等你有空时点卡片出发' : '对方婉拒了一起去邀请'); } catch (e) {}
            }, 80);
          }
        } catch (e) {}
      }
    }

    // 2) 角色主动发出邀请
    var re = /\[邀请一起去\s*[:：]\s*([^\]]+)\]/ig;
    var found;
    while ((found = re.exec(body)) !== null) {
      var args = parseInviteArgs(found[1]);
      var inviteId = 'invite_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var card = {
        cardType: 'travelInvite', travelKind: 'invite', direction: 'char',
        status: 'pending', inviteId: inviteId,
        dest: args.dest, date: args.date, time: args.time, days: args.days, note: args.note,
        fromName: displayName(), toName: userName(), tripId: '', createdAt: Date.now()
      };
      try {
        (function(cardData){
          setTimeout(function(){ try { chat().addMessage('left', '', nowTime(), null, false, true, cardData); } catch (e) {} }, 60);
        })(card);
        changed = true;
      } catch (e) {}
      body = body.replace(found[0], '');
    }
    // 清掉可能残留的标记，避免显示给用户
    body = body.replace(/\[一起去\s*[:：][^\]]*\]/ig, '');
    if (changed) {
      try {
        chat().renderMessages();
        chat().saveMessages();
      } catch (e) {}
    }
    // 正常聊天后检查是否到了该角色主动报备的时间（每个 char 每 2 天最多一次）
    try {
      setTimeout(function () {
        maybeGenerateReport().catch(function () {});
      }, 5000 + Math.random() * 6000);
    } catch (e) {}
    return { body: body, changed: changed };
  }

  /* ---------- 报备投递 ---------- */
  function deliver() {
    var s = store();
    if (!s || reportBusy) return Promise.resolve(0);
    // 角色在线下：旅途卡片先留在待投递队列，退出线下后再补进线上聊天。
    if (isChatOffline()) return Promise.resolve(0);
    try {
      if (!chat() || (chat().isStorageReady && !chat().isStorageReady())) return Promise.resolve(0);
    } catch (e) { return Promise.resolve(0); }
    reportBusy = true;
    return s.load().then(function () {
      return s.takePendingReports(chatId);
    }).then(async function (list) {
      if (!Array.isArray(list) || !list.length) return 0;
      var added = 0;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r) continue;
        try {
          var img = await persistentImg(r.img);
          var thought = String(r.thought || r.note || '').trim();
          var thoughtZh = String(r.thoughtZh || '').trim();
          if (!thoughtZh && thought) {
            try {
              if (window.__chat && window.__chat.isForeignChar && window.__chat.isForeignChar()) {
                thoughtZh = await window.__chat.translateToZh(thought);
              }
            } catch (e) {}
          }
          chat().addMessage('left', '', nowTime(), null, false, true, {
            cardType: 'travelReport',
            travelKind: 'report',
            tripId: String(r.tripId || r.id || ''),
            title: r.title || r.place || '旅途报备',
            place: r.place || '',
            date: r.date || today(),
            thought: thought,
            thoughtZh: thoughtZh,
            caption: r.caption || '',
            img: img || '',
            note: '',
            fromName: displayName(),
            reportedAt: r.at || Date.now()
          });
          added++;
        } catch (e) {}
      }
      return added;
    }).catch(function () { return 0; }).then(function (n) {
      reportBusy = false;
      return n;
    });
  }

  /* ---------- 随机报备 ---------- */
  function reportLockKey() { return 'nano_travel_report_lock_' + chatId; }
  function reportGlobalKey() {
    var m = store() && store().getMask ? store().getMask() : {};
    return 'nano_travel_report_global_' + ((m && m.id) || 'default');
  }
  // 与「旅途」App 的随机拍立得共用同一把锁：两条路径合计约 3 天只分享一次。
  function sharedShareKey() {
    var m = store() && store().getMask ? store().getMask() : {};
    return 'nano_travel_share_at_' + ((m && m.id) || 'default');
  }
  var REPORT_EVERY = 72 * 3600 * 1000;   // 约 3 天由一位 char 主动分享一次旅程
  function canReport() {
    var s = store();
    if (!s) return false;
    if (isChatOffline()) return false;
    // 只对近 24 小时还在聊天的角色触发；很久没聊天的角色不再主动分享。
    if (!recentlyChatting()) return false;
    // 没有真实聊天记录时先不打扰；有聊天记录后按约 3 天的节奏主动分享。
    var hasChat = messages().some(function (m) { return m && !m.isCard && (m.text || m.transcript); }) || !!s.lastChatAt(chatId);
    if (!hasChat) return false;
    try {
      var shared = JSON.parse(localStorage.getItem(sharedShareKey()) || 'null');
      if (shared && Date.now() - Number(shared.at || 0) < REPORT_EVERY) return false;
      var globalLock = JSON.parse(localStorage.getItem(reportGlobalKey()) || 'null');
      if (globalLock && Date.now() - Number(globalLock.at || 0) < REPORT_EVERY) return false;
      var lock = JSON.parse(localStorage.getItem(reportLockKey()) || 'null');
      if (lock && Date.now() - Number(lock.at || 0) < REPORT_EVERY) return false;
    } catch (e) {}
    var cd = s.getCharData(chatId);
    if (cd && cd.lastReportAt && Date.now() - Number(cd.lastReportAt) < REPORT_EVERY) return false;
    return true;
  }
  function markReport() {
    try { localStorage.setItem(reportLockKey(), JSON.stringify({ at: Date.now() })); } catch (e) {}
    try { localStorage.setItem(reportGlobalKey(), JSON.stringify({ at: Date.now(), charId: chatId })); } catch (e) {}
    try { localStorage.setItem(sharedShareKey(), JSON.stringify({ at: Date.now(), charId: chatId })); } catch (e) {}
    var cd = store().getCharData(chatId);
    cd.lastReportAt = Date.now();
    store().save();
  }
  function reportPrompt(charData, mask) {
    var persona = (charData && charData.settings && charData.settings.persona) || '';
    var name = (charData && charData.settings && charData.settings.name) || displayName();
    var foreign = false, lang = '';
    try {
      foreign = !!(window.__chat && window.__chat.isForeignChar && window.__chat.isForeignChar());
      lang = (window.__chat && window.__chat.charLanguageName) ? window.__chat.charLanguageName() : '';
    } catch (e) {}
    var sys = '你是角色「' + name + '」。请以第一人称，生成一段你最近真实的出行记录，用作给「' + (mask.name || '用户') + '」的旅途报备。'
      + '必须严格保持人设，严禁 OOC、霸总腔、油腻情话、爹味说教；不要命令、强迫或贬低用户。'
      + (persona ? ('角色设定：' + String(persona).slice(0, 1400) + '。') : '')
      + (foreign ? ('你的母语是' + (lang || '外语') + '：thought 必须用母语写，thoughtZh 给对应的中文翻译；' ) : 'thoughtZh 留空字符串；')
      + '只输出合法 JSON，不要解释。格式：'
      + '{"place":"目的地/地点","from":"出发地","to":"到达地","type":"hsr|train|plane|taxi|bike|bus","date":"YYYY-MM-DD","time":"HH:MM","no":"车次/航班/车牌","seat":"座位/里程","price":数字,"thought":"一句真实心得","thoughtZh":"中文翻译或空","caption":"拍立得的一句话说明","photoPrompt":"用于生图的画面描述"}'
      + '。要求：像真实日常出行，不要夸张；地点符合角色所在城市/世界观；thought 不超过 40 字；photoPrompt 描述光线、地点、氛围，可以是人像，也可以只是风景、街角、食物、车票、窗边、影子或手部，不要出现文字。';
    var usr = '今天是 ' + today() + '。请生成一段你一个人出门的记录，或者你为了散心临时去的地方。';
    return { system: sys, user: usr };
  }
  function normalizeRecord(j, charData) {
    var name = (charData && charData.settings && charData.settings.name) || displayName();
    var types = { hsr: 1, train: 1, plane: 1, taxi: 1, bike: 1, bus: 1 };
    var type = types[j.type] ? j.type : 'hsr';
    var date = /^\d{4}-\d{2}-\d{2}$/.test(String(j.date || '')) ? String(j.date) : today();
    var time = /^\d{1,2}:\d{2}$/.test(String(j.time || '')) ? String(j.time) : nowTime();
    return {
      type: type,
      from: String(j.from || '住处'),
      to: String(j.to || j.place || '附近'),
      place: String(j.place || j.to || '附近'),
      date: date,
      time: time,
      no: String(j.no || ''),
      seat: String(j.seat || ''),
      price: Number(j.price) || 0,
      note: String(j.thought || j.note || '').trim(),
      thought: String(j.thought || j.note || '').trim(),
      thoughtZh: String(j.thoughtZh || '').trim(),
      caption: String(j.caption || '').trim(),
      photoPrompt: String(j.photoPrompt || '').trim(),
      owner: 'char',
      source: 'report',
      charName: name
    };
  }
  async function maybeGenerateReport() {
    if (reportBusy || inviteBusy || !store() || !api()) return false;
    if (!canReport()) return false;
    // 到期就生成；只做 1 小时失败节流，避免 API 异常时反复重试。
    try {
      var tryKey = 'nano_travel_report_try_' + chatId;
      var tried = Number(localStorage.getItem(tryKey) || 0);
      if (Date.now() - tried < 3600 * 1000) return false;
      localStorage.setItem(tryKey, String(Date.now()));
    } catch (e) {}
    reportBusy = true;
    try {
      await store().load();
      var chars = await store().loadChars();
      var c = (chars || []).find(function (x) { return String(x.id) === String(chatId); });
      var charData = store().getCharData(chatId);
      if (c) store().ensureChar(c);
      if (!charData.settings.name && charName) charData.settings.name = charName;
      var prompt = reportPrompt(charData, store().getMask());
      var j = await api().callJson({
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0.95, maxTokens: 900
      });
      var rec = normalizeRecord(j, charData);
      rec.tripId = newTripId();
      // 分享时 75% 概率生图；只有开启「允许生图」的角色才真的调用生图。
      // 画面随机：人像 / 风景 / 随机角落 / 生活细节都会出现，不再固定成一种。
      try {
        if (rec.photoPrompt && charAllowsImage(chatId) && Math.random() < 0.75 && api() && api().generateImage) {
          var roll = Math.random();
          var withChar = roll < 0.42;
          var photoPrompt = String(rec.photoPrompt).slice(0, 800);
          if (withChar) {
            photoPrompt += '。画面里出现你本人，像旅途中朋友随手拍下的人像：自然、真实、不摆拍，可以是半身、背影或侧脸，保留本人长相特征，不要影楼感。';
          } else if (roll < 0.70) {
            photoPrompt += '。只拍风景：真实的自然或城市景观，自然光，构图随手，像旅途中抬头看到的一幕，不要出现人物正脸。';
          } else if (roll < 0.88) {
            photoPrompt += '。拍一个随机的生活角落：街角、巷口、车站、窗边或路边小店，像随手捡到的一幕，不要摆拍，不要出现人物正脸。';
          } else {
            photoPrompt += '。拍旅途中的生活细节：食物、车票、杯子、影子、手部或随身小物，真实自然，不要文字水印。';
          }
          var img = await api().generateImage({
            prompt: photoPrompt,
            charId: withChar ? chatId : '',
            charName: withChar ? (rec.charName || displayName()) : ''
          });
          if (img && img.src) rec.polaroid = img.src;
        }
      } catch (e) {}
      await store().addCharTrip(chatId, rec);
      await store().addPendingReport(chatId, {
        tripId: rec.tripId, title: rec.place, place: rec.place, date: rec.date,
        thought: rec.thought, thoughtZh: rec.thoughtZh || '', caption: rec.caption, note: '',
        img: rec.polaroid || '', at: Date.now()
      });
      markReport();
      reportBusy = false;
      await deliver();
      return true;
    } catch (e) {
      return false;
    } finally {
      reportBusy = false;
    }
  }

  /* ---------- 角色随机邀请「一起去」 ---------- */
  var inviteBusy = false;
  function hasPendingInvite() {
    return messages().some(function (m) {
      return m && !m.recalled && m.cardData && m.cardData.cardType === 'travelInvite' &&
        (m.cardData.status || 'pending') === 'pending';
    });
  }
  function inviteLockKey() { return 'nano_travel_invite_lock_' + chatId; }
  function inviteTryKey() { return 'nano_travel_invite_try_' + chatId; }
  function inviteGlobalKey() {
    var m = store() && store().getMask ? store().getMask() : {};
    return 'nano_travel_invite_global_' + ((m && m.id) || 'default');
  }
  var INVITE_EVERY = 72 * 3600 * 1000;   // 每 3 天由一位 char 主动邀请一次
  function canInvite() {
    if (isChatOffline()) return false;
    if (hasPendingInvite()) return false;
    try {
      var globalLock = JSON.parse(localStorage.getItem(inviteGlobalKey()) || 'null');
      if (globalLock && Date.now() - Number(globalLock.at || 0) < INVITE_EVERY) return false;
      var lock = JSON.parse(localStorage.getItem(inviteLockKey()) || 'null');
      if (lock && Date.now() - Number(lock.at || 0) < INVITE_EVERY) return false;
      var tried = Number(localStorage.getItem(inviteTryKey()) || 0);
      if (Date.now() - tried < 3600 * 1000) return false;
    } catch (e) {}
    var cd = store() && store().getCharData ? store().getCharData(chatId) : null;
    if (cd && cd.lastInviteAt && Date.now() - Number(cd.lastInviteAt) < INVITE_EVERY) return false;
    // 至少有过一轮真实聊天，避免刚打开就弹邀请
    return messages().some(function (m) { return m && !m.isCard && (m.text || m.transcript); });
  }
  function invitePrompt(charData, mask) {
    var persona = (charData && charData.settings && charData.settings.persona) || '';
    var name = (charData && charData.settings && charData.settings.name) || displayName();
    var recent = messages().filter(function (m) { return m && !m.recalled && ((m.text && String(m.text).trim()) || m.transcript); })
      .slice(-6).map(function (m) {
        return (m.type === 'right' ? (mask.name || '用户') : name) + '：' + String(m.text || m.transcript || '').replace(/\s+/g, ' ').slice(0, 160);
      }).join('\n');
    var sys = '你是角色「' + name + '」。你想自然地向「' + (mask.name || '用户') + '」发起一次「一起去」的旅行邀请。'
      + (persona ? ('角色设定：' + String(persona).slice(0, 1400) + '。') : '')
      + '必须严格保持人设和关系阶段，严禁 OOC、严禁霸道油腻、严禁命令或强迫对方、严禁套路情话。邀请要像你本人会说的话。'
      + '只输出合法 JSON，不要解释：'
      + '{"dest":"目的地","date":"自然日期，如 这周末/明天/下个月","time":"时间，如 上午十点/傍晚","days":"3","note":"一句自然的邀请，不超过40字"}'
      + '。地点要符合你的城市、国籍、职业和生活习惯；不要每次都去同一个地方。'
      + '目的地可以很近，也可以很远（跨城、跨省、甚至跨国/长途）；天数可以是数天甚至更久，不要默认只去附近、只玩一天。';
    var usr = '最近聊天：\n' + (recent || '（刚刚开始）') + '\n\n请判断现在是否适合发出邀请，并生成邀请内容。';
    return { system: sys, user: usr };
  }
  function addInviteCard(cd) {
    var dest = String(cd.dest || '').trim() || '附近走走';
    var note = String(cd.note || '').trim();
    var card = {
      cardType: 'travelInvite', travelKind: 'invite', direction: 'char',
      status: 'pending', inviteId: 'invite_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      dest: dest,
      date: String(cd.date || today()),
      time: String(cd.time || ''),
      days: String(cd.days || '1').replace(/[^\d]/g, '') || '1',
      note: note,
      fromName: displayName(), toName: userName(), tripId: '', createdAt: Date.now()
    };
    // 邀请前先说一句，卡片才有来由，不是凭空弹出来。
    var say = note || ('想不想一起去' + dest + '？');
    chat().addMessage('left', say, nowTime(), null, false, false, null);
    chat().addMessage('left', '', nowTime(), null, false, true, card);
    try { chat().saveMessages(); } catch (e) {}
  }
  async function maybeInvite() {
    if (inviteBusy || reportBusy || !store() || !api()) return false;
    if (!canInvite()) return false;
    try { localStorage.setItem(inviteTryKey(), String(Date.now())); } catch (e) {}
    inviteBusy = true;
    try {
      await store().load();
      var chars = await store().loadChars();
      var c = (chars || []).find(function (x) { return String(x.id) === String(chatId); });
      var charData = store().getCharData(chatId);
      if (c) store().ensureChar(c);
      if (!charData.settings.name && charName) charData.settings.name = charName;
      var prompt = invitePrompt(charData, store().getMask());
      var j = await api().callJson({
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0.95, maxTokens: 500
      });
      addInviteCard(j || {});
      try { localStorage.setItem(inviteLockKey(), JSON.stringify({ at: Date.now(), dest: j && j.dest })); } catch (e) {}
      try { localStorage.setItem(inviteGlobalKey(), JSON.stringify({ at: Date.now(), charId: chatId, dest: j && j.dest })); } catch (e) {}
      try { var cd = store().getCharData(chatId); cd.lastInviteAt = Date.now(); store().save(); } catch (e) {}
      return true;
    } catch (e) {
      return false;
    } finally {
      inviteBusy = false;
    }
  }

  /* ---------- 打开页面 ---------- */
  function openFull(url, title) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'openFullscreen', url: url, title: title || '旅途', source: 'chat_inner' }, '*');
      } else {
        location.href = url;
      }
    } catch (e) {}
  }
  function openApp(cardData) {
    var cd = cardData || {};
    var params = new URLSearchParams();
    params.set('char', chatId);
    params.set('name', displayName());
    var tripId = String(cd.tripId || cd.journeyId || '');
    // 「一起去」结束后的总结卡片：回到「一起去」页面，直接看当时的那一页。
    if (tripId && cd.travelKind === 'together') {
      params.set('replay', '1');
      params.set('from', 'chat');
      params.set('trip', tripId);
      // 有的卡片 tripId 是记录 id，有的只有 journeyId（本次旅程 id）；两个都带上，
      // 回顾页任一能对上就能打开，避免「卡片在、却说没找到这段旅行」。
      if (cd.journeyId) params.set('journeyId', String(cd.journeyId));
      params.set('chatId', chatId);
      params.set('dest', String(cd.place || cd.title || ''));
      params.set('date', String(cd.date || ''));
      if (cd.title) params.set('title', String(cd.title).slice(0, 120));
      if (cd.thought) params.set('thought', String(cd.thought).slice(0, 600));
      openFull('travel-chat.html?' + params.toString(), '旅途回顾');
      return;
    }
    // 主动报备 / 分享的旅程卡片：打开「旅途」App 里的这段记录。
    if (tripId) params.set('trip', tripId);
    openFull('travel.html?' + params.toString(), '旅途');
  }
  async function openTripChat(cardData) {
    var cd = cardData || {};
    try { if (store()) await store().load(); } catch (e) {}
    var mask = store() ? store().getMask() : { id: '', name: '我' };
    var tripId = cd.tripId || newTripId();
    if (!cd.tripId) {
      cd.tripId = tripId;
      try { chat().renderMessages(); chat().saveMessages(); } catch (e) {}
    }
    var params = new URLSearchParams();
    params.set('char', chatId);
    params.set('name', displayName());
    params.set('chatId', chatId);
    params.set('userId', mask.id || '');
    params.set('tripId', tripId);
    params.set('dest', cd.dest || '');
    params.set('date', cd.date || today());
    params.set('time', cd.time || '');
    params.set('days', cd.days || '1');
    params.set('note', cd.note || '');
    openFull('travel-chat.html?' + params.toString(), '一起去');
  }
  function acceptInvite(msg) {
    if (!msg || !msg.cardData) return;
    if ((msg.cardData.status || 'pending') !== 'pending') return;
    msg.cardData.status = 'accepted';
    msg.cardData.tripId = msg.cardData.tripId || newTripId();
    try { chat().renderMessages(); chat().saveMessages(); } catch (e) {}
    try { chat().addSystemNotice('你接受了一起去邀请，出发去' + (msg.cardData.dest || '旅行')); } catch (e) {}
    openTripChat(msg.cardData);
  }
  function rejectInvite(msg) {
    if (!msg || !msg.cardData) return;
    if ((msg.cardData.status || 'pending') !== 'pending') return;
    msg.cardData.status = 'rejected';
    try { chat().renderMessages(); chat().saveMessages(); } catch (e) {}
    try { chat().addSystemNotice('你婉拒了一起去邀请'); } catch (e) {}
  }

  /* ---------- 私聊里的「一起去」发起器 ---------- */
  async function openInviteComposer() {
    if (composer) { composer.remove(); composer = null; }
    try { if (store()) await store().load(); } catch (e) {}
    var mask = store() ? store().getMask() : { name: '我' };
    var wrap = document.createElement('div');
    wrap.id = 'nanoTravelInviteComposer';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:blur(3px);';
    wrap.innerHTML =
      '<div style="width:100%;max-width:520px;background:#fff;border-radius:22px 22px 0 0;padding:18px 20px calc(22px + env(safe-area-inset-bottom,0px));box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;">' +
        '<div style="width:38px;height:4px;border-radius:4px;background:#e4e4e7;margin:0 auto 16px;"></div>' +
        '<div style="font-size:17px;font-weight:700;color:#111;margin-bottom:4px;">邀请 TA 一起去</div>' +
        '<div style="font-size:12px;color:#8c8c8c;margin-bottom:14px;">发送一张「一起去」卡片。对方回应前不会调用 API。</div>' +
        '<label style="display:block;font-size:12px;color:#8c8c8c;margin:12px 0 6px;">目的地</label>' +
        '<input id="ntvDest" type="text" placeholder="例如：苏州 · 平江路" style="width:100%;box-sizing:border-box;border:1px solid #e4e4e7;border-radius:12px;padding:11px 12px;font-size:15px;outline:none;">' +
        '<div style="display:flex;align-items:flex-end;width:100%;">' +
          '<div style="flex:1 1 0;min-width:0;overflow:hidden;margin-right:12px;"><label style="display:block;font-size:12px;color:#8c8c8c;margin:12px 0 6px;">日期</label><input id="ntvDate" type="date" style="display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;border:1px solid #e4e4e7;border-radius:12px;padding:11px 12px;font-size:15px;outline:none;-webkit-appearance:none;appearance:none;"></div>' +
          '<div style="width:92px;flex:0 0 92px;"><label style="display:block;font-size:12px;color:#8c8c8c;margin:12px 0 6px;">天数</label><input id="ntvDays" type="number" min="1" max="30" value="1" style="display:block;width:100%;max-width:100%;box-sizing:border-box;border:1px solid #e4e4e7;border-radius:12px;padding:11px 12px;font-size:15px;outline:none;"></div>' +
        '</div>' +
        '<label style="display:block;font-size:12px;color:#8c8c8c;margin:12px 0 6px;">时间（选填）</label>' +
        '<input id="ntvTime" type="text" placeholder="例如：上午十点 / 周六傍晚" style="width:100%;box-sizing:border-box;border:1px solid #e4e4e7;border-radius:12px;padding:11px 12px;font-size:15px;outline:none;">' +
        '<label style="display:block;font-size:12px;color:#8c8c8c;margin:12px 0 6px;">一句话（选填）</label>' +
        '<textarea id="ntvNote" rows="3" placeholder="想和 TA 一起做的事……" style="width:100%;box-sizing:border-box;border:1px solid #e4e4e7;border-radius:12px;padding:11px 12px;font-size:15px;outline:none;resize:none;"></textarea>' +
        '<div style="display:flex;gap:10px;margin-top:18px;">' +
          '<button id="ntvCancel" style="flex:1;height:46px;border:0;border-radius:999px;background:#f2f2f7;color:#111;font-size:15px;font-weight:600;">取消</button>' +
          '<button id="ntvSend" style="flex:2;height:46px;border:0;border-radius:999px;background:#111;color:#fff;font-size:15px;font-weight:600;">发送一起去</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    composer = wrap;
    var dateEl = wrap.querySelector('#ntvDate');
    if (dateEl) dateEl.value = today();
    function close() { wrap.remove(); composer = null; }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('#ntvCancel').addEventListener('click', close);
    wrap.querySelector('#ntvSend').addEventListener('click', function () {
      var dest = (wrap.querySelector('#ntvDest').value || '').trim();
      if (!dest) {
        try {
          if (window.__chat && window.__chat.showAlert) window.__chat.showAlert('还差一个目的地', '先写下想和 TA 一起去的地方。');
          else alert('先填写目的地');
        } catch (e) {}
        return;
      }
      var card = {
        cardType: 'travelInvite', travelKind: 'invite', direction: 'user',
        status: 'pending', inviteId: 'invite_' + Date.now().toString(36),
        dest: dest,
        date: (wrap.querySelector('#ntvDate').value || today()),
        time: (wrap.querySelector('#ntvTime').value || '').trim(),
        days: String(wrap.querySelector('#ntvDays').value || '1'),
        note: (wrap.querySelector('#ntvNote').value || '').trim(),
        fromName: mask.name || '我', toName: displayName(), tripId: '', createdAt: Date.now()
      };
      try {
        chat().addMessage('right', '', nowTime(), null, false, true, card);
        chat().saveMessages();
        close();
        try { if (window.__chat && window.__chat.showAlert) window.__chat.showAlert('已发送', '一起去邀请已发送。点「回复」或等 TA 自己回应。'); } catch (e) {}
      } catch (e) {
        try { if (window.__chat && window.__chat.showAlert) window.__chat.showAlert('发送失败', String(e && e.message || e)); } catch (err) {}
      }
    });
  }

  /* ---------- 卡片点击 / 同步 ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.card-btn[data-act^="travel-"]') : null;
    if (btn) {
      var row = btn.closest('.message-row');
      var msg = row ? messages().find(function (m) { return String(m.id) === String(row.dataset.id); }) : null;
      if (!msg || !msg.cardData) return;
      e.preventDefault();
      e.stopPropagation();
      var act = btn.dataset.act;
      if (act === 'travel-accept') acceptInvite(msg);
      else if (act === 'travel-reject') rejectInvite(msg);
      else if (act === 'travel-open') openTripChat(msg.cardData);
      return;
    }
    var card = e.target && e.target.closest ? e.target.closest('.bubble-card.travelReport, .bubble-card.travelShare, .bubble-card.travelInvite') : null;
    if (card && !e.target.closest('.card-btn')) {
      var row2 = card.closest('.message-row');
      var msg2 = row2 ? messages().find(function (m) { return String(m.id) === String(row2.dataset.id); }) : null;
      if (msg2 && msg2.cardData) {
        e.preventDefault();
        if (msg2.cardData.cardType === 'travelInvite') {
          if ((msg2.cardData.status || 'pending') === 'accepted') openTripChat(msg2.cardData);
        } else {
          openApp(msg2.cardData);
        }
      }
    }
  }, false);

  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d) return;
    if (d.type === 'nanoTravelCardAdded') {
      if (String(d.charId || '') !== chatId || !d.message) return;
      var list = messages();
      if (list.some(function (m) { return m && String(m.id) === String(d.message.id); })) return;
      list.push(d.message);
      try { chat().renderMessages(); chat().saveMessages(); chat().scrollToBottom(); } catch (err) {}
      return;
    }
    if (d.type === 'nanoTravelReportPending') {
      if (String(d.charId || '') !== chatId) return;
      deliver().catch(function () {});
      return;
    }
    if (d.type === 'nanoTravelUpdated') {
      if (String(d.charId || '') !== chatId) return;
      var hit = false;
      messages().forEach(function (m) {
        if (!m || !m.cardData) return;
        if (String(m.id) === String(d.cardId) || String(m.cardData.inviteId || '') === String(d.cardId) ||
            String(m.cardData.tripId || '') === String(d.cardId)) {
          Object.assign(m.cardData, d.patch || {});
          hit = true;
        }
      });
      if (hit) {
        try { chat().renderMessages(); chat().saveMessages(); } catch (err) {}
      }
    }
  });

  /* ---------- 启动 ---------- */
  whenReady(function () {
    try { if (store()) store().load(); } catch (e) {}
    setTimeout(function () { deliver().catch(function () {}); }, 2600);
    setTimeout(function () { maybeGenerateReport().catch(function () {}); }, 9000);
    setTimeout(function () { maybeInvite().catch(function () {}); }, 22000);
    setInterval(function () { deliver().catch(function () {}); }, 45 * 1000);
    // 到期检查：每个 char 报备 2 天一次、邀请 3 天一次，由各自的时间戳决定。
    setInterval(function () {
      maybeGenerateReport().catch(function () {});
      maybeInvite().catch(function () {});
    }, 30 * 60 * 1000);
  });

  window.NanoTravelBridge = {
    version: '1.0',
    promptBlock: promptBlock,
    settleFromReplyText: settleFromReplyText,
    deliver: deliver,
    maybeGenerateReport: maybeGenerateReport,
    openInviteComposer: openInviteComposer,
    openApp: openApp,
    openTripChat: openTripChat,
    hasPendingInvite: function () { return pendingInvites().length > 0; }
  };
})();
