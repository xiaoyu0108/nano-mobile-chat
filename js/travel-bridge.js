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
  // 「一起去邀请」必须由用户在私聊设置里手动开启；默认关闭。
  function charAllowsInvite(id) {
    try {
      var raw = localStorage.getItem('chat_setting_allowTravelInvite_' + String(id || ''));
      if (raw === null) return false;
      var v = raw;
      try { v = JSON.parse(raw); } catch (e) {}
      return v === true || v === 1 || v === 'true' || v === '1';
    } catch (e) { return false; }
  }
  // 只统计真实聊天气泡：卡片、系统提示、表情/图片都不算「熟」。
  function realChatStats() {
    var total = 0, user = 0, char = 0;
    messages().forEach(function (m) {
      if (!m || m.recalled || m.isCard) return;
      if (m.cardData && m.cardData.systemNotice) return;
      var txt = String(m.text || m.transcript || '').trim();
      if (!txt) return;
      if (m.type === 'right') user++;
      else if (m.type === 'left') char++;
      else return;
      total++;
    });
    return { total: total, user: user, char: char };
  }
  function msgTs(m) {
    if (!m) return 0;
    var ts = Number(m.ts) || 0;
    if (!ts) ts = parseInt(String(m.id || '').split('-')[0], 10) || 0;
    return ts;
  }
  function realMessageList() {
    return messages().filter(function (m) {
      return m && !m.recalled && !m.isCard &&
        (m.type === 'left' || m.type === 'right') &&
        !(m.cardData && m.cardData.systemNotice) &&
        String(m.text || m.transcript || '').trim();
    });
  }
  function recentRealCount(days) {
    var cutoff = Date.now() - days * 86400000;
    return realMessageList().filter(function (m) { return msgTs(m) >= cutoff; }).length;
  }
  function recentChatText(limit) {
    return realMessageList().slice(-(limit || 60)).map(function (m) {
      return String(m.text || m.transcript || '').replace(/\s+/g, ' ');
    }).join('\n');
  }
  // 认识多久：避免同一天猛聊几十句就被当成「很熟」。
  function relationshipAgeDays() {
    var first = 0;
    realMessageList().forEach(function (m) {
      var t = msgTs(m);
      if (t && (!first || t < first)) first = t;
    });
    return first ? (Date.now() - first) / 86400000 : 999;
  }
  // 很久没聊（≥7 天）后再重新聊：从重新开口的第一条算起，至少聊满 2 天才允许邀请。
  function resumeAfterLongGap() {
    var list = realMessageList().slice().sort(function (a, b) { return msgTs(a) - msgTs(b); });
    var resumeAt = 0;
    for (var i = 1; i < list.length; i++) {
      var prev = msgTs(list[i - 1]);
      var cur = msgTs(list[i]);
      if (prev && cur && cur - prev >= 7 * 86400000) resumeAt = cur;
    }
    return resumeAt;
  }
  function resumedLongEnough() {
    var at = resumeAfterLongGap();
    if (!at) return true;
    if (Date.now() - at < 2 * 86400000) return false;
    // 重新聊之后，至少跨两个不同日期都有真实消息，才算「重新聊了 2 天」。
    var days = {};
    realMessageList().forEach(function (m) {
      var t = msgTs(m);
      if (!t || t < at) return;
      var d = new Date(t);
      days[d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()] = true;
    });
    return Object.keys(days).length >= 2;
  }
  function characterProfileText() {
    var parts = [];
    var c = charRecord() || {};
    ['setting', 'persona', 'desc', 'description', 'profile', 'bio', 'background', 'relationship'].forEach(function (k) {
      var v = c[k];
      if (typeof v === 'string' && v.trim()) parts.push(v);
    });
    try {
      var s = (store().getCharData(chatId).settings) || {};
      ['persona', 'setting', 'desc', 'description', 'relationship'].forEach(function (k) {
        var v = s[k];
        if (typeof v === 'string' && v.trim()) parts.push(v);
      });
    } catch (e) {}
    return parts.join('\n');
  }
  function relationshipSignals() {
    var profile = characterProfileText();
    var chat = recentChatText(80);
    var list = messages();
    var lover = /(恋人|情侣|爱人|老公|老婆|男友|女友|男朋友|女朋友|伴侣|未婚妻|未婚夫)/.test(profile);
    var closeFriend = /(青梅竹马|挚友|闺蜜|死党|最好的朋友|最亲近的人|家人)/.test(profile);
    var affection = /(喜欢你|爱你|想你|舍不得你|想见你|在一起|宝贝|亲爱的|抱抱|亲亲|约会|牵手|老婆|老公|男朋友|女朋友|亲一下)/.test(chat);
    var couple = false, family = false;
    list.forEach(function (m) {
      if (!m || !m.cardData) return;
      if (m.cardData.cardType === 'couple' && m.cardData.coupleKind === 'invite' && String(m.cardData.status || '') === 'accepted') couple = true;
      if (m.cardData.cardType === 'familycard') {
        var st = String(m.cardData.status || '');
        if (m.cardData.response === true || st === 'accepted' || st === 'active' || st === 'approved') family = true;
      }
    });
    return {
      lover: lover || couple,
      closeFriend: closeFriend,
      affection: affection || lover || couple,
      family: family
    };
  }
  // 关系分级：熟人（可报备）→ 亲近（可同城/同国邀请）→ 亲密（才可能异国长途邀请）。
  function chatCloseness() {
    var st = realChatStats();
    var recent30 = recentRealCount(30);
    var recent7 = recentRealCount(7);
    var ageDays = relationshipAgeDays();
    var sig = relationshipSignals();
    var affinity = !!(sig.lover || sig.family || sig.affection);
    var bond = affinity || sig.closeFriend;
    // 报备：至少 200 条真实消息、双方各 60 条、认识 2 天以上。
    var familiar = st.total >= 200 && st.user >= 60 && st.char >= 60 && ageDays >= 2;
    // 邀请：至少 500 条真实消息、双方各 150 条、认识 2 天以上。
    var inviteReady = st.total >= 500 && st.user >= 150 && st.char >= 150 && ageDays >= 2;
    var close = inviteReady;
    // 异地/异国还要求明确的感情浓度；800 条以上视为足够亲密。
    var intimate = inviteReady && (affinity || st.total >= 800);
    return {
      stats: st, recent30: recent30, recent7: recent7, ageDays: ageDays, sig: sig,
      affinity: affinity, bond: bond, familiar: familiar, close: close, intimate: intimate
    };
  }
  function isFamiliar() { return chatCloseness().familiar; }
  function remoteFlagKey() { return 'nano_travel_remote_' + chatId; }
  // 同国但异地：用户明确说过“异地/不在一个城市/离得很远”时记住 120 天。
  function isRemoteRelationship() {
    if (isCrossCountry()) return true;
    try {
      var flag = JSON.parse(localStorage.getItem(remoteFlagKey()) || 'null');
      if (flag && Date.now() - Number(flag.at || 0) < 120 * 86400000) return true;
    } catch (e) {}
    var txt = messages().filter(function (m) {
      return m && !m.recalled && !m.isCard && m.type === 'right' &&
        !(m.cardData && m.cardData.systemNotice) && String(m.text || '').trim();
    }).slice(-30).map(function (m) { return String(m.text || ''); }).join('\n');
    var hit = /(异地|不在同一个城市|不在一个城市|两个城市|相隔(很|太)?远|距离(很|太)远|离得(很|太)远|见一面(很|太)难|聚少离多)/.test(txt);
    if (hit) {
      try { localStorage.setItem(remoteFlagKey(), JSON.stringify({ at: Date.now() })); } catch (e) {}
    }
    return hit;
  }
  // same_country=同国（可能同城），remote=同国异地，cross_country=异国。
  function distanceClass() {
    if (isCrossCountry()) return 'cross_country';
    if (isRemoteRelationship()) return 'remote';
    return 'same_country';
  }
  // 同城/同国：关系亲近就能邀请；异地/异国：必须到「亲密」才可能偶尔邀请一次长途旅行。
  function inviteTierAllowed(tier) {
    tier = tier || chatCloseness();
    var d = distanceClass();
    return d === 'same_country' ? tier.close : tier.intimate;
  }
  function inviteCooldownMs() {
    var d = distanceClass();
    return d === 'cross_country' ? 12 * 86400000 : (d === 'remote' ? 10 * 86400000 : 7 * 86400000);
  }
  function rejectCooldownMs() {
    // 被婉拒后：同城/同国、异地、异国一律 14 天。
    return 14 * 86400000;
  }
  function lastCharInviteAt() {
    var last = 0;
    try {
      var cd = store().getCharData(chatId);
      last = Math.max(last, Number(cd.lastInviteAt || 0));
    } catch (e) {}
    try {
      var lock = JSON.parse(localStorage.getItem(inviteLockKey()) || 'null');
      if (lock) last = Math.max(last, Number(lock.at || 0));
    } catch (e) {}
    return last;
  }
  function lastCharRejectAt() {
    try { return Number((store().getCharData(chatId).lastInviteRejectedAt) || 0); } catch (e) { return 0; }
  }
  function charRecord() {
    try {
      if (window.__chat && window.__chat.getCharacterData) {
        var c = window.__chat.getCharacterData();
        if (c) return c;
      }
    } catch (e) {}
    try {
      var cd = store() && store().getCharData ? store().getCharData(chatId) : null;
      var s = (cd && cd.settings) || {};
      return { name: s.name || displayName(), nationality: s.nationality || '', setting: s.persona || '' };
    } catch (e) { return null; }
  }
  function normCountry(v) {
    return String(v || '').replace(/国$/, '').replace(/\s+/g, '').trim();
  }
  function charNationality() {
    var c = charRecord() || {};
    return String(c.nationality || c.country || '').trim();
  }
  function userNationality() {
    try {
      var s = store();
      var m = s && s.getMask ? s.getMask() : null;
      return String((m && m.nationality) || '').trim();
    } catch (e) { return ''; }
  }
  function isCrossCountry() {
    var a = normCountry(charNationality());
    var b = normCountry(userNationality());
    if (a && b) return a !== b;
    // 国籍字段缺失时，用「外国人」标记兜底：外国人角色默认不做当天往返的周末邀请。
    try {
      if (window.__chat && window.__chat.isForeignChar && window.__chat.isForeignChar()) return true;
    } catch (e) {}
    return false;
  }
  // 已经同意过一次「一起去」，且之后还没结束这趟旅程：不要再反复发新邀请。
  function hasUpcomingAcceptedTrip() {
    var lastTogetherAt = 0;
    messages().forEach(function (m) {
      if (!m || !m.cardData) return;
      if (m.cardData.cardType === 'travelReport' && m.cardData.travelKind === 'together') {
        lastTogetherAt = Math.max(lastTogetherAt, Number(m.ts || m.cardData.reportedAt || 0));
      }
    });
    return messages().some(function (m) {
      if (!m || !m.cardData || m.cardData.cardType !== 'travelInvite') return false;
      if (String(m.cardData.status || '') !== 'accepted') return false;
      var at = Number(m.createdAt || m.ts || 0);
      if (at && Date.now() - at > 60 * 86400000) return false;
      return at > lastTogetherAt;
    });
  }
  // 最近聊天里已经约好「以后某个时间见面/我去找你」：不要再反复发新的邀请。
  function hasTextMeetingAgreement() {
    var txt = messages().filter(function (m) {
      return m && !m.recalled && !m.isCard && (m.type === 'left' || m.type === 'right') &&
        !(m.cardData && m.cardData.systemNotice) && String(m.text || '').trim();
    }).slice(-24).map(function (m) { return String(m.text || ''); }).join('\n');
    return /(约好|约了|说好|商量好|定了|等我|等你|下次|以后|到时候|放假|假期|攒钱|机票|签证)[^。！？\n]{0,40}(去找你|去找他|来找我|来找你|见面|过去|飞|去你|来我|找你|找他)/.test(txt);
  }
  // 用户已经多次说过异地/周末来不了时，跨国的角色不要再自动发周末邀请。
  function distanceFlagKey() { return 'nano_travel_no_weekend_' + chatId; }
  function userRepeatedDistanceComplaint() {
    if (distanceClass() === 'same_country') return false;
    // 一旦说过距离/周末来不了，记住 60 天；即使后面又聊了很多，也不会忘了这件事。
    try {
      var flag = JSON.parse(localStorage.getItem(distanceFlagKey()) || 'null');
      if (flag && Date.now() - Number(flag.at || 0) < 60 * 86400000) return true;
    } catch (e) {}
    var txt = messages().filter(function (m) {
      return m && !m.recalled && !m.isCard && m.type === 'right' &&
        !(m.cardData && m.cardData.systemNotice) && String(m.text || '').trim();
    }).slice(-20).map(function (m) { return String(m.text || ''); }).join('\n');
    var hit = /(周末|周六|周日)[^。！？\n]{0,18}(找不了|来不了|去不了|见不了|没法|没办法|不能|太远|怎么.{0,6}(找你|见你|过去|去))|我在(中国|北京|上海|广州|深圳|杭州|成都|重庆)|你在(日本|东京|大阪|美国|纽约|英国|伦敦|韩国|首尔|法国|巴黎|德国|澳洲|加拿大)/.test(txt);
    if (hit) {
      try { localStorage.setItem(distanceFlagKey(), JSON.stringify({ at: Date.now() })); } catch (e) {}
    }
    return hit;
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
  // 必须近 12 小时真的聊过天（只算真实气泡，不算卡片/系统提示）。
  function recentlyChatting(hours) {
    var h = Number(hours) || 12;
    var cutoff = Date.now() - h * 3600 * 1000;
    return realMessageList().some(function (m) { return msgTs(m) >= cutoff; });
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
            + (c.caption ? ('，画面：' + String(c.caption).slice(0, 80)) : '')
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
        out.push('注意：卡片里的「心得/感悟/心声」是 App 里的记录，不要在聊天气泡里复述、扩写或另发一遍。');
      }
    } catch (e) {}
    // 旅途报备由系统卡片承载；聊天正文不要再写行程小作文或「感悟」气泡。
    out.push('旅途报备由系统生成的卡片承载。聊天气泡里不要主动写行程小作文，也不要把「感悟/心得/心声」当作气泡发出来；只有对方问起你在哪、在做什么时，才用一两句具体、自然的话回答。');
    var inviteOn = charAllowsInvite(chatId);
    var tier = chatCloseness();
    var inviteByTier = inviteTierAllowed(tier);
    var inviteBlocked = hasUpcomingAcceptedTrip() || hasTextMeetingAgreement() || userRepeatedDistanceComplaint();
    var rejectedAt = lastCharRejectAt();
    var rejectedRecently = !!(rejectedAt && Date.now() - rejectedAt < rejectCooldownMs());
    var lastInvite = lastCharInviteAt();
    var coolingDown = !!(lastInvite && Date.now() - lastInvite < inviteCooldownMs());
    var chattedRecently = recentlyChatting(12);
    var resumedEnough = resumedLongEnough();
    if (inviteOn && inviteByTier && !inviteBlocked && !rejectedRecently && !coolingDown && chattedRecently && resumedEnough) {
      out.push('当气氛自然、你们关系已经到位时，才可以主动邀请对方一起出行，频率要低。邀请时单独占一行输出标记（标记不会显示给对方）：');
      out.push('[邀请一起去:目的地|日期|时间|天数|一句说明]');
      out.push('例如 [邀请一起去:苏州|下个月15号|上午十点|2|想去平江路慢慢走一走]。日期写具体日期或对方方便的时间，不要默认写“这周末”。');
      out.push('邀请前必须先考虑现实条件：');
      var __d = distanceClass();
      if (__d === 'cross_country') {
        out.push('- 你们是异国（对方在' + (userNationality() || '中国') + '，你在' + (charNationality() || '国外') + '）。不要用“这周末/周六/周日/明天/今天”这种当天就能见面的说法，也不要忽略距离。');
        out.push('- 这种长途邀请 12 天内最多主动发一次；要像认真计划一次旅行，写清日期、天数、路程/假期。');
        out.push('- 如果对方已经说过周末来不了、距离太远，或者你们已经约好以后某个时间见面，就不要再发新的邀请，等那个约定。');
      } else if (__d === 'remote') {
        out.push('- 你们是异地（不在同一座城市）：不要默认周末，也不要默认当天往返；这种邀请 10 天内最多一次。');
        out.push('- 如果对方最近说过没空、太远、或者你们已经约好某个时间，就不要再反复邀请，等那个约定。');
      } else {
        out.push('- 你们在同一国家（可能同城，也可能不同城市）：不要默认每个周末都约，日期要看对方最近的时间安排；这种邀请 7 天内最多一次。');
        out.push('- 如果对方最近说过没空、或者你们已经约好某个时间，就不要再反复邀请，等那个约定。');
      }
      out.push('- 刚认识、没聊几句、对方最近没怎么回你时，不要邀请。');
    } else if (!inviteOn) {
      out.push('现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：用户没有为这个角色开启「一起去邀请」。');
    } else if (!tier.familiar) {
      out.push('现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：你们还不够熟，先正常聊天。');
    } else if (!inviteByTier) {
      var __dd = distanceClass();
      out.push(__dd === 'cross_country'
        ? '现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：你们是异国，关系虽然不错，但还没到可以主动约长途旅行的程度。'
        : (__dd === 'remote'
          ? '现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：你们是异地，关系虽然不错，但还没到可以主动约对方跑一趟的程度。'
          : '现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：关系还没亲近到可以约一起出去玩的程度。'));
    } else if (!chattedRecently) {
      out.push('现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：你们最近 12 小时没有真实聊天，不要突然邀约。');
    } else if (!resumedEnough) {
      out.push('现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：你们很久没聊了，重新聊还不到 2 天，先恢复日常聊天。');
    } else if (inviteBlocked) {
      out.push('现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：你们已经约好以后见面的时间，或者对方已经说过距离太远/周末来不了，先守住那个约定。');
    } else {
      out.push('现在不要主动邀请对方一起出行，也不要输出 [邀请一起去:...] 标记：上次邀请之后还在冷却期（同城/同国 7 天、异地 10 天、异国 12 天；被婉拒后一律 14 天），不要反复催。');
    }
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

    // 2) 角色主动发出邀请：开关开启 + 关系/距离/冷却都满足。
    var inviteAllowed = charAllowsInvite(chatId) && inviteTierAllowed(chatCloseness()) &&
      recentlyChatting(12) && resumedLongEnough();
    if (inviteAllowed) {
      body = body.replace(/\[邀请一起去\s*[:：]\s*([^\]]+)\]/ig, function (m, raw) {
        if (addInviteCard(parseInviteArgs(raw))) changed = true;
        return '';
      });
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
    // 关闭开关后，把角色之前发出的待回应邀请作废。
    try { expireCharInvitesIfDisabled(); } catch (e) {}
    // 刚点开、还没真正聊过的角色不投递任何旅途卡片，避免一进来就被卡片打扰。
    if (!isFamiliar()) return Promise.resolve(0);
    // 很久没聊天的角色也不补发报备卡；必须近 12 小时有真实聊天。
    if (!recentlyChatting(12)) return Promise.resolve(0);
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
          // 聊天里的报备卡片只放地点/日期/画面说明；「心得/感悟」留在旅途 App 里，
          // 不再作为气泡或卡片正文发到私聊。
          var caption = String(r.caption || '').trim();
          chat().addMessage('left', '', nowTime(), null, false, true, {
            cardType: 'travelReport',
            travelKind: 'report',
            tripId: String(r.tripId || r.id || ''),
            title: r.title || r.place || '旅途报备',
            place: r.place || '',
            date: r.date || today(),
            thought: '',
            thoughtZh: '',
            caption: caption,
            img: img || '',
            note: caption,
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
  // 与「旅途」App 的随机拍立得共用同一把锁：两条路径合计约 5 天只分享一次。
  function sharedShareKey() {
    var m = store() && store().getMask ? store().getMask() : {};
    return 'nano_travel_share_at_' + ((m && m.id) || 'default');
  }
  var REPORT_EVERY = 5 * 86400000;   // 约 5 天由一位 char 主动报备一次旅程
  function canReport() {
    var s = store();
    if (!s) return false;
    if (isChatOffline()) return false;
    // 只对近 12 小时还在聊天的角色触发；很久没聊天的角色不再主动分享。
    if (!recentlyChatting(12)) return false;
    // 必须是已经聊得很熟的角色；刚点开、没聊过或只有系统提示时不报备。
    if (!isFamiliar()) return false;
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
      + '{"place":"目的地/地点","from":"出发地","to":"到达地","type":"hsr|train|plane|taxi|bike|bus","date":"YYYY-MM-DD","time":"HH:MM","no":"车次/航班/车牌","seat":"座位/里程","price":数字,"thought":"一句真实心得","thoughtZh":"中文翻译或空","caption":"对拍立得画面的一句客观说明，不要写心得/感悟，24字以内","photoPrompt":"用于生图的画面描述"}'
      + '。要求：像真实日常出行，不要夸张；地点符合角色所在城市/世界观；thought 不超过 40 字；photoPrompt 描述光线、地点、氛围，可以是人像，也可以只是风景、街角、食物、车票、窗边、影子或手部，不要出现文字。'
      + 'photoPrompt 开头必须写 `人物：...`；这是你一个人的出行记录，通常写「人物：我一人」或「人物：无人（只拍场景）」，不要出现用户。';
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
  var INVITE_GLOBAL_EVERY = 7 * 86400000;   // 全局：任何角色 7 天内最多主动邀请一次
  function canInvite() {
    // 必须在私聊设置里手动开启；默认关闭，不给任何自动邀请。
    if (!charAllowsInvite(chatId)) return false;
    // 关系要到位：熟人才能报备；亲近才能同国邀请；异国必须到亲密，而且只偶尔一次。
    var tier = chatCloseness();
    if (!tier.familiar) return false;
    if (!inviteTierAllowed(tier)) return false;
    if (!recentlyChatting(12)) return false;
    if (!resumedLongEnough()) return false;
    if (isChatOffline()) return false;
    if (hasPendingInvite()) return false;
    // 已经约好一次「一起去」且还没结束：不要再发新邀请。
    if (hasUpcomingAcceptedTrip()) return false;
    // 聊天里已经约好以后某个时间见面：不要再发新邀请。
    if (hasTextMeetingAgreement()) return false;
    // 跨国角色已经听用户说过周末来不了：不要再自动发周末邀请。
    if (userRepeatedDistanceComplaint()) return false;
    // 被婉拒后一律冷却 14 天，不能隔几天又提。
    var rejected = lastCharRejectAt();
    if (rejected && Date.now() - rejected < rejectCooldownMs()) return false;
    try {
      var globalLock = JSON.parse(localStorage.getItem(inviteGlobalKey()) || 'null');
      if (globalLock && Date.now() - Number(globalLock.at || 0) < INVITE_GLOBAL_EVERY) return false;
      var tried = Number(localStorage.getItem(inviteTryKey()) || 0);
      if (Date.now() - tried < 3600 * 1000) return false;
    } catch (e) {}
    // 同一个角色的邀请间隔：同城/同国 7 天、异地 10 天、异国 12 天。
    var last = lastCharInviteAt();
    if (last && Date.now() - last < inviteCooldownMs()) return false;
    return true;
  }
  function invitePrompt(charData, mask, charInfo) {
    var persona = (charData && charData.settings && charData.settings.persona) || '';
    var name = (charData && charData.settings && charData.settings.name) || displayName();
    var recent = messages().filter(function (m) { return m && !m.recalled && !m.isCard && ((m.text && String(m.text).trim()) || m.transcript); })
      .slice(-16).map(function (m) {
        return (m.type === 'right' ? (mask.name || '用户') : name) + '：' + String(m.text || m.transcript || '').replace(/\s+/g, ' ').slice(0, 160);
      }).join('\n');
    var cn = String((charInfo && (charInfo.nationality || charInfo.country)) ||
      (charData && charData.settings && charData.settings.nationality) || '').trim();
    var un = String((mask && mask.nationality) || '').trim();
    var tier = chatCloseness();
    var d = distanceClass();
    var distanceRule = d === 'cross_country'
      ? ('你们是异国：用户是' + (un || '中国人') + '，你在' + (cn || '国外') + '。12 天内最多主动邀请一次；不要用“这周末/周六/周日/明天/今天”这种当天见面的说法，也不要忽略距离。必须像认真计划的长途旅行，写清日期、路程、天数和为什么值得去；如果对方已经说过周末来不了或拒绝过，就不要再提。')
      : (d === 'remote'
        ? '你们是异地（不在同一座城市）。10 天内最多主动邀请一次；不要默认写“这周末”或当天往返，日期要具体，并说明路程/时间安排。'
        : '你们在同一国家（可能同城，也可能不同城市）。7 天内最多主动邀请一次；不要默认每个周末都约，日期要看对方最近的时间安排。');
    var relationRule = tier.intimate
      ? '你们关系已经很亲密，但邀请仍然要克制，不能把一起出去玩当成理所当然。'
      : '你们关系比较亲近，但还没到可以频繁邀约的程度；只在气氛真的合适时偶尔提一次。';
    var sys = '你是角色「' + name + '」。你想自然地向「' + (mask.name || '用户') + '」发起一次「一起去」的旅行邀请。'
      + (persona ? ('角色设定：' + String(persona).slice(0, 1400) + '。') : '')
      + '必须严格保持人设和关系阶段，严禁 OOC、严禁霸道油腻、严禁命令或强迫对方、严禁套路情话。邀请要像你本人会说的话。'
      + '只输出合法 JSON，不要解释：'
      + '{"dest":"目的地","date":"具体日期，如 下个月15号/下下周六/明天","time":"时间，如 上午十点/傍晚","days":"3","note":"一句自然的邀请，不超过40字"}'
      + '。地点要符合你的城市、国籍、职业和生活习惯；不要每次都去同一个地方。'
      + '目的地可以很近，也可以很远（跨城、跨省、甚至跨国/长途）；天数可以是数天甚至更久，不要默认只去附近、只玩一天。'
      + distanceRule + relationRule
      + '如果最近聊天里对方拒绝过、说过太远/没空，或者你们已经约好以后某个时间见面，就不要再发新的邀请，等那个约定；日期不要默认写“这周末”。';
    var usr = '最近聊天：\n' + (recent || '（刚刚开始）') + '\n\n请判断现在是否适合发出邀请，并生成邀请内容。如果对方已经说过距离太远或已经约好时间，请只输出 {}。';
    return { system: sys, user: usr };
  }
  function addInviteCard(cd) {
    if (!cd || !charAllowsInvite(chatId)) return false;
    var tier = chatCloseness();
    if (!tier.familiar || !inviteTierAllowed(tier)) return false;
    if (!recentlyChatting(12) || !resumedLongEnough()) return false;
    // 已经约好、或对方已经明确说过距离/周末来不了：不再出新的邀请卡片。
    if (hasUpcomingAcceptedTrip() || hasTextMeetingAgreement() || userRepeatedDistanceComplaint()) return false;
    var rejected = lastCharRejectAt();
    if (rejected && Date.now() - rejected < rejectCooldownMs()) return false;
    var last = lastCharInviteAt();
    if (last && Date.now() - last < inviteCooldownMs()) return false;
    try {
      var globalLock = JSON.parse(localStorage.getItem(inviteGlobalKey()) || 'null');
      if (globalLock && Date.now() - Number(globalLock.at || 0) < INVITE_GLOBAL_EVERY) return false;
    } catch (e) {}
    var dest = String(cd.dest || '').trim() || '附近走走';
    var note = String(cd.note || '').trim();
    var when = String(cd.date || '') + ' ' + String(cd.time || '') + ' ' + note;
    // 硬性拦截：异地/异国角色不能再用“这周末/明天”这类当天见面的邀请；
    // 除非邀请里明确提到路程/机票/假期等长途安排。
    if (distanceClass() !== 'same_country' && /(这?周末|周六|周日|明天|今天|后天)/.test(when) &&
        !/(我去找你|飞过去|机票|航班|车票|高铁|签证|长假|假期|过去找你|来你这边|路程|长途)/.test(when)) {
      return false;
    }
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
    // 立刻记下这次邀请：同一条回复里即使模型写了多个邀请标记，也不会重复出卡。
    try {
      var cdata = store().getCharData(chatId);
      cdata.lastInviteAt = Date.now();
      store().save();
    } catch (e) {}
    try { localStorage.setItem(inviteLockKey(), JSON.stringify({ at: Date.now(), dest: dest })); } catch (e) {}
    try { localStorage.setItem(inviteGlobalKey(), JSON.stringify({ at: Date.now(), charId: chatId, dest: dest })); } catch (e) {}
    return true;
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
      var prompt = invitePrompt(charData, store().getMask(), c);
      var j = await api().callJson({
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        temperature: 0.95, maxTokens: 500
      });
      // 模型判断现在不适合邀请时会返回空对象；不要凭空造一个「附近走走」的邀请。
      if (!j || !String(j.dest || '').trim()) return false;
      if (!addInviteCard(j)) return false;
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
    // 被婉拒后一律冷却 14 天，避免隔几天又提。
    try {
      var cd = store().getCharData(chatId);
      cd.lastInviteRejectedAt = Date.now();
      store().save();
    } catch (e) {}
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

  /* ---------- 关闭开关时，作废角色已发出的待回应邀请 ---------- */
  function expireCharInvitesIfDisabled() {
    if (charAllowsInvite(chatId)) return;
    var changed = false;
    messages().forEach(function (m) {
      if (!m || !m.cardData || m.cardData.cardType !== 'travelInvite') return;
      if ((m.cardData.direction || 'user') !== 'char') return;
      if ((m.cardData.status || 'pending') !== 'pending') return;
      m.cardData.status = 'expired';
      changed = true;
    });
    if (changed) {
      try { chat().renderMessages(); chat().saveMessages(); } catch (e) {}
    }
  }
  try {
    window.addEventListener('storage', function (e) {
      if (!e || e.key !== 'chat_setting_allowTravelInvite_' + chatId) return;
      expireCharInvitesIfDisabled();
    });
  } catch (e) {}

  /* ---------- 启动 ---------- */
  whenReady(function () {
    try { if (store()) store().load(); } catch (e) {}
    setTimeout(function () { expireCharInvitesIfDisabled(); }, 1200);
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
