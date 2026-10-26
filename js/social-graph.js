/* =========================================================
   Nano 社交关系网
   - 判断两个角色是否“明确认识”，供朋友圈 / Ins / Halo / Q&A 过滤互动
   - 依据：
     1) 角色关系设置 nano_char_rel_<id>.relationIds（私聊/角色关系里勾选过）
     2) char↔char 私聊记录 nano_char_secret_chats
     3) 人设 / 世界书文本里明确出现对方名字
     4) 角色对象上的 relations / knownChars / relationIds 等显式字段
   - 不把“都属于同一个用户绑定”当成认识。
   ========================================================= */
(function () {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
  }
  function idOf(c) {
    if (!c) return '';
    return String(c.id || c.charId || c.uid || c.name || '').trim();
  }
  function namesOf(c) {
    if (!c) return [];
    var out = [c.name, c.nickname, c.nickName, c.displayName, c.handle, c.remark];
    ['aliases', 'otherNames', 'altNames', 'knownAs'].forEach(function (k) {
      if (Array.isArray(c[k])) out = out.concat(c[k]);
    });
    return out.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  }
  function textOf(c) {
    if (!c) return '';
    var parts = [];
    ['setting', 'desc', 'description', 'persona', 'profile', 'bio', 'background', 'note',
      'relationship', 'relationships', 'relations', 'relation', 'worldbook', 'worldBook',
      'memory', 'knownChars', 'relationIds', 'relatedIds'].forEach(function (k) {
      var v = c[k];
      if (v == null) return;
      if (typeof v === 'string') parts.push(v);
      else {
        try { parts.push(JSON.stringify(v)); } catch (e) {}
      }
    });
    return parts.join('\n');
  }
  function textMentions(c, name) {
    var n = String(name || '').trim();
    if (!n || n.length < 2) return false;
    var text = textOf(c);
    if (!text) return false;
    return text.indexOf(n) > -1;
  }
  function idListHas(c, otherId) {
    if (!c || !otherId) return false;
    var keys = ['relationIds', 'relatedIds', 'knownIds', 'charIds', 'friends'];
    for (var i = 0; i < keys.length; i++) {
      var v = c[keys[i]];
      if (Array.isArray(v) && v.map(String).indexOf(String(otherId)) > -1) return true;
    }
    return false;
  }
  function currentMaskId() {
    try {
      var h = JSON.parse(localStorage.getItem('nano_mask_data') || 'null') ||
        JSON.parse(localStorage.getItem('nano_home_data') || 'null') ||
        JSON.parse(localStorage.getItem('peach_home_data') || 'null') || null;
      var id = h && h.currentMaskId;
      if (!id && h && Array.isArray(h.masks) && h.masks.length) id = h.masks[0] && h.masks[0].id;
      return String(id || 'm_default');
    } catch (e) { return 'm_default'; }
  }
  function readRel(id) {
    try {
      var raw = localStorage.getItem('nano_char_rel_' + currentMaskId() + '_' + id) ||
        localStorage.getItem('nano_char_rel_' + id);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : null;
    } catch (e) { return null; }
  }
  function label(a, b) {
    if (!a || !b) return '';
    try {
      var ar = readRel(idOf(a)), br = readRel(idOf(b));
      var lb = String((ar && ar.labels && ar.labels[String(idOf(b))]) ||
        (br && br.labels && br.labels[String(idOf(a))]) || '');
      if (lb) return lb;
      if (relPair(a, b)) return '朋友';
      return '';
    } catch (e) { return ''; }
  }
  function relPair(a, b) {
    var aid = idOf(a), bid = idOf(b);
    if (!aid || !bid) return false;
    var ar = readRel(aid), br = readRel(bid);
    return !!((ar && Array.isArray(ar.relationIds) && ar.relationIds.map(String).indexOf(bid) > -1) ||
      (br && Array.isArray(br.relationIds) && br.relationIds.map(String).indexOf(aid) > -1));
  }
  function secretPair(a, b) {
    var aid = idOf(a), bid = idOf(b);
    if (!aid || !bid) return false;
    try {
      var list = JSON.parse(localStorage.getItem('nano_char_secret_chats') || '[]');
      if (!Array.isArray(list)) return false;
      return list.some(function (r) {
        if (!r || !r.a || !r.b) return false;
        var x = String(r.a.id), y = String(r.b.id);
        return (x === aid && y === bid) || (x === bid && y === aid);
      });
    } catch (e) { return false; }
  }
  function knows(a, b) {
    if (!a || !b) return false;
    var aid = idOf(a), bid = idOf(b);
    if (aid && bid && aid === bid) return false;
    var an = norm(a.name || a.nickname), bn = norm(b.name || b.nickname);
    if (an && bn && an === bn) return false;
    if (relPair(a, b) || secretPair(a, b)) return true;
    if (idListHas(a, bid) || idListHas(b, aid)) return true;
    // 只要一方的人设/世界书明确写到对方，就视为认识（单边明确即可）
    if (textMentions(a, b.name) || textMentions(b, a.name)) return true;
    var aNames = namesOf(a), bNames = namesOf(b);
    for (var i = 0; i < aNames.length; i++) if (textMentions(b, aNames[i])) return true;
    for (var j = 0; j < bNames.length; j++) if (textMentions(a, bNames[j])) return true;
    return false;
  }
  function filterKnown(author, candidates) {
    return (candidates || []).filter(function (c) {
      if (!c) return false;
      return knows(author, c);
    });
  }
  function findByName(list, name) {
    var n = norm(name);
    if (!n) return null;
    for (var i = 0; i < (list || []).length; i++) {
      var c = list[i];
      if (!c) continue;
      if (norm(c.name) === n) return c;
      var ns = namesOf(c);
      for (var j = 0; j < ns.length; j++) if (norm(ns[j]) === n) return c;
    }
    return null;
  }

  window.NanoSocialGraph = {
    version: '20261026a',
    norm: norm,
    idOf: idOf,
    namesOf: namesOf,
    knows: knows,
    label: label,
    filterKnown: filterKnown,
    findByName: findByName
  };
})();
