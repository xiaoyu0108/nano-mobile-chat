// ============================================================
// ins.js - Forum 主逻辑（对接 mask / character / api 存储）
// ============================================================
(function () {
'use strict';

// ==================== 存储读取层 ====================
const MASK_HOME_KEY = 'nano_mask_data';
const MASK_LEGACY_KEYS = ['nano_home_data', 'peach_home_data'];
const MASK_AVATAR_DB = 'MaskAvatarDB';
const MASK_AVATAR_STORE = 'avatars';

function readHomeData() {
  for (let i = 0; i < MASK_LEGACY_KEYS.length + 1; i++) {
    const key = i === 0 ? MASK_HOME_KEY : MASK_LEGACY_KEYS[i - 1];
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) return d;
      }
    } catch (e) {}
  }
  return null;
}

function getCurrentMask() {
  const home = readHomeData();
  if (!home || !home.currentMaskId) return null;
  return (home.masks || []).find(m => m.id === home.currentMaskId) || null;
}

function getMaskAvatar(maskId) {
  return new Promise(function (resolve) {
    try {
      const req = indexedDB.open(MASK_AVATAR_DB, 1);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(MASK_AVATAR_STORE)) {
          db.createObjectStore(MASK_AVATAR_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) {
        try {
          const db = e.target.result;
          const r = db.transaction(MASK_AVATAR_STORE, 'readonly')
            .objectStore(MASK_AVATAR_STORE).get(maskId);
          r.onsuccess = function () { resolve(r.result ? (r.result.data || '') : ''); };
          r.onerror = function () { resolve(''); };
        } catch (err) { resolve(''); }
      };
      req.onerror = function () { resolve(''); };
    } catch (e) { resolve(''); }
  });
}

const CHAR_DB = 'nano_characters_db';
const CHAR_STORE = 'characters';

function openCharDB() {
  return new Promise(function (resolve, reject) {
    try {
      const req = indexedDB.open(CHAR_DB, 1);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(CHAR_STORE)) {
          db.createObjectStore(CHAR_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    } catch (e) { reject(e); }
  });
}

function getCharacters() {
  return openCharDB().then(function (db) {
    return new Promise(function (resolve) {
      try {
        const r = db.transaction(CHAR_STORE, 'readonly').objectStore(CHAR_STORE).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }).catch(function () { return []; });
}

const API_DB = 'nano_api_db';
const API_STORE = 'api_data';

function openApiDB() {
  return new Promise(function (resolve, reject) {
    try {
      const req = indexedDB.open(API_DB, 2);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(API_STORE)) {
          db.createObjectStore(API_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('emoji_data')) {
          db.createObjectStore('emoji_data', { keyPath: 'key' });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    } catch (e) { reject(e); }
  });
}

function apiGet(key) {
  return openApiDB().then(function (db) {
    return new Promise(function (resolve) {
      try {
        const r = db.transaction(API_STORE, 'readonly').objectStore(API_STORE).get(key);
        r.onsuccess = function () { resolve(r.result ? r.result.value : null); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }).catch(function () { return null; });
}

async function getMainApiConfig() {
  const cfg = await apiGet('nano_api_config');
  const assign = await apiGet('nano_api_assign') || {};
  const presets = await apiGet('nano_api_presets_data') || {};
  let base = cfg ? {
    url: cfg.mainUrl || '', key: cfg.mainKey || '',
    model: cfg.mainModel || '', temp: cfg.mainTemp != null ? cfg.mainTemp : 0.7
  } : { url: '', key: '', model: '', temp: 0.7 };
  const presetName = assign.chatSingle || assign.chatGroup || '';
  if (presetName && presets['main_' + presetName]) {
    const p = presets['main_' + presetName];
    if (p.url) base.url = p.url;
    if (p.key) base.key = p.key;
    if (p.modelValue) base.model = p.modelValue;
  }
  return base;
}

async function getSubApiConfig() {
  const cfg = await apiGet('nano_api_config');
  if (!cfg) return { url: '', key: '', model: '', temp: 0.7, enabled: false };
  return {
    url: cfg.subUrl || '',
    key: cfg.subKey || '',
    model: cfg.subModel || cfg.mainModel || '',
    temp: cfg.subTemp != null ? cfg.subTemp : (cfg.mainTemp != null ? cfg.mainTemp : 0.7),
    enabled: cfg.subToggle !== false
  };
}

async function callApiWith(conf, messages) {
  if (!conf || !conf.url || !conf.key) throw new Error('未配置 API，请先在 API 设置里填写中转地址和 Key');
  try {
    if (window.NanoPrompts && NanoPrompts.inject) messages = NanoPrompts.inject(messages, 'ins', { keepFormat: true });
  } catch (e) {}
  let base = String(conf.url).trim().replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';
  const endpoint = base + '/chat/completions';
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.key },
      body: JSON.stringify({ model: conf.model || '', temperature: conf.temp, messages: messages })
    });
  } catch (e) {
    throw new Error('网络请求失败：' + (e && e.message ? e.message : e) + '\n请求地址：' + endpoint + '\n模型：' + (conf.model || '(未填写)'));
  }
  if (!resp.ok) {
    let detail = '';
    try { const err = await resp.json(); detail = (err.error && err.error.message) || err.message || JSON.stringify(err); } catch (e) { try { detail = await resp.text(); } catch (e2) {} }
    throw new Error('HTTP ' + resp.status + ' ' + (detail ? '\n服务端信息：' + String(detail).slice(0, 300) : '') + '\n请求地址：' + endpoint + '\n模型：' + (conf.model || '(未填写)'));
  }
  let data;
  try { data = await resp.json(); } catch (e) { throw new Error('返回内容不是合法 JSON：' + (e && e.message ? e.message : e)); }
  return (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content || '' : '';
}

async function callMainApi(messages) {
  return callApiWith(await getMainApiConfig(), messages);
}

// apiPref:'sub' → 优先副 API，未配置副 API 时自动回退主 API；其它一律用主 API
async function callChatApi(messages, apiPref) {
  if (apiPref === 'sub') {
    try {
      const sub = await getSubApiConfig();
      if (sub.enabled && sub.url && sub.key) return await callApiWith(sub, messages);
    } catch (e) { /* 副 API 不可用，回退主 API */ }
  }
  return callMainApi(messages);
}

// ==================== 全局状态 ====================
let userProfile = {
  id: null, name: '你的昵称', handle: '@yourname', bio: '', setting: '',
  avatarColor: 'me', avatarImage: null, verified: false
};

let currentUserChars = [];
let charAvatarMap = {};

let posts = [];
let savedPosts = [];
let currentPost = null, replyTarget = null, replyTargetReply = null;
let currentChatUser = null;
let menuPostId = null;
let dmActiveTab = 'friends';
let profileTab = 'posts';
let pendingAvatarColor = 'me';
let pendingAvatarImage = null;
let tagsImage = [];
let tagsText = [];
let detailFrom = 'home';
let currentTag = '';
let recommendTags = ['设计灵感', '摄影', '生活碎片', '极简空间', '咖啡时间', '旅行记录'];
let sharePostId = null;
let shareTab = 'chat';
let charProfileName = '';
let charProfileFrom = 'home';
let tagDescriptions = {};
let currentTagDesc = '';
let tagManageMode = false;
let insImageSettings = { enabled: false, chars: [], npc: false, stranger: false, round: 0 };
let insBusy = { forum: false, tag: false, comments: false, dm: false };
let insBackground = false;
let followedUsers = [];
const IMG_SETTINGS_KEY = 'nano_ins_image_settings';

function loadImageSettings() {
  try {
    const raw = localStorage.getItem(IMG_SETTINGS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        insImageSettings = {
          enabled: !!d.enabled,
          chars: Array.isArray(d.chars) ? d.chars.slice() : [],
          npc: !!d.npc,
          stranger: !!d.stranger,
          round: typeof d.round === 'number' ? d.round : 0
        };
      }
    }
  } catch (e) {}
}
function saveImageSettings() {
  try { localStorage.setItem(IMG_SETTINGS_KEY, JSON.stringify(insImageSettings)); } catch (e) {}
}

const TAG_DESC_KEY = 'nano_ins_tag_descriptions';
const RECOMMEND_TAGS_KEY = 'nano_ins_recommend_tags';
function loadTagDescriptions() {
  try {
    const raw = localStorage.getItem(TAG_DESC_KEY);
    if (raw) { const d = JSON.parse(raw); if (d && typeof d === 'object') tagDescriptions = d; }
  } catch (e) {}
}
function saveTagDescriptions() {
  try { localStorage.setItem(TAG_DESC_KEY, JSON.stringify(tagDescriptions || {})); } catch (e) {}
}
function getTagDesc(tag) { return (tag && tagDescriptions[tag]) || ''; }
function loadRecommendTags() {
  try {
    const raw = localStorage.getItem(RECOMMEND_TAGS_KEY);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) recommendTags = a; }
  } catch (e) {}
}
function saveRecommendTags() {
  try { localStorage.setItem(RECOMMEND_TAGS_KEY, JSON.stringify(recommendTags || [])); } catch (e) {}
}

const AVATAR_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5'];
const COLOR_OPTIONS = [
  { key: 'me', style: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)' },
  { key: 'c1', style: 'linear-gradient(135deg,#f8b04d,#ef476f)' },
  { key: 'c2', style: 'linear-gradient(135deg,#3897f0,#a343d4)' },
  { key: 'c3', style: 'linear-gradient(135deg,#27ae60,#3897f0)' },
  { key: 'c4', style: 'linear-gradient(135deg,#e74c3c,#f8b04d)' },
  { key: 'c5', style: 'linear-gradient(135deg,#a343d4,#e1306c)' }
];

// 把较长的“人设”压成一句短短的个性签名
function shortSignature(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const first = t.split(/[。！？!?\n；;]/)[0].trim() || t;
  return first.length > 26 ? first.slice(0, 26) + '…' : first;
}

// 文字图：正方形白底黑字（帖子图片默认用这种，而不是无意义的渐变图）
function makeTextImage(text) {
  const raw = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || '记录';
  const lines = [];
  let cur = '', w = 0;
  const maxUnits = 9;
  for (const ch of raw.slice(0, 80)) {
    const u = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
    if (cur && w + u > maxUnits) { lines.push(cur); cur = ''; w = 0; }
    cur += ch; w += u;
    if (lines.length >= 6) break;
  }
  if (cur && lines.length < 6) lines.push(cur);
  const n = lines.length || 1;
  const fs = n <= 2 ? 58 : n <= 3 ? 50 : n <= 4 ? 42 : 34;
  const lh = fs * 1.4;
  const startY = 300 - ((n - 1) * lh) / 2 + fs * 0.35;
  let texts = '';
  lines.forEach((ln, i) => {
    texts += '<text x="300" y="' + (startY + i * lh).toFixed(1) + '" text-anchor="middle" ' +
      'font-family="Georgia,\'Songti SC\',\'SimSun\',serif" font-size="' + fs + '" fill="#111">' +
      escapeHtml(ln) + '</text>';
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">' +
    '<rect width="600" height="600" fill="#ffffff"/>' +
    '<rect x="22" y="22" width="556" height="556" fill="none" stroke="#ececec" stroke-width="2"/>' +
    texts + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// 图片加载失败（如生图临时链接过期）时，退化成白底黑字文字图，避免帖子图片“消失”
function insImgFallback(el) {
  try {
    el.onerror = null;
    el.src = makeTextImage(el.getAttribute('data-fb') || '记录');
  } catch (e) {}
}
window.insImgFallback = insImgFallback;

// ==================== 生图（按设置随机生成真实照片） ====================
function buildPostImagePrompt(post) {
  const t = ((post && post.title) || '') + ' ' + ((post && post.body) || '');
  return '为一条社交媒体帖子配图。帖子内容：' + t.slice(0, 120) +
    '。要求：真实感强的照片风格，构图自然，光影舒服，不要文字、不要水印。';
}

async function generateInsImage(prompt, opts) {
  const cfg = await apiGet('nano_api_config');
  const imgUrl = cfg && (cfg.imgUrl || '').trim();
  const imgKey = cfg && (cfg.imgKey || '').trim();
  const imgModel = cfg && (cfg.imgModel || '').trim();
  if (!imgUrl || !imgKey || !imgModel) throw new Error('未配置生图 API');
  let base = imgUrl.replace(/\/+$/, '');
  if (/\/images\/generations$/i.test(base)) base = base.replace(/\/images\/generations$/i, '');
  if (!/\/v\d+$/i.test(base) && !/\/chat\/completions$/i.test(base)) base += '/v1';
  base = base.replace(/\/+$/, '');
  const endpoint = base + '/images/generations';
  const editsEndpoint = base + '/images/edits';

  // ===== 锁脸参考 + 人种护栏（角色设了锁脸就走图生图）=====
  let faceRef = '';
  let subject = '';
  if (opts && opts.charId) {
    try {
      const raw = localStorage.getItem('chat_setting_faceRef_' + opts.charId);
      if (raw) { try { faceRef = JSON.parse(raw); } catch (e) { faceRef = raw; } }
    } catch (e) {}
  }
  if (opts && opts.char) {
    const ch = opts.char;
    const bits = [];
    const nat = String(ch.nationality || '').trim();
    const sex = String(ch.gender || '').trim();
    if (nat && nat !== '未知' && nat !== '未设定') bits.push('国籍/人种：' + nat);
    if (sex && sex !== '未知') bits.push('性别：' + sex);
    if (bits.length) subject = '画面主角是「' + (ch.name || '角色') + '」（' + bits.join('，') + '）。必须严格按此国籍/人种与性别特征绘制，禁止画成其他国籍或西方人。';
  }

  let pos = '';
  try {
    const pr = await apiGet('nano_api_prompts');
    if (pr && Array.isArray(pr.positive)) pos = pr.positive.join('，');
  } catch (e) {}

  // 有锁脸参考优先走图生图 /images/edits（multipart），失败再退回文生图
  if (faceRef && String(faceRef).indexOf('data:') === 0) {
    try {
      const fc = faceRef.indexOf(',');
      const fbin = atob(faceRef.slice(fc + 1));
      const fu8 = new Uint8Array(fbin.length);
      for (let fi = 0; fi < fbin.length; fi++) fu8[fi] = fbin.charCodeAt(fi);
      const fmime = (faceRef.slice(5, fc).split(';')[0]) || 'image/png';
      const ffd = new FormData();
      ffd.append('model', imgModel);
      ffd.append('prompt', [pos, prompt, subject].filter(Boolean).join('，'));
      ffd.append('n', '1');
      ffd.append('size', '1024x1024');
      ffd.append('image', new Blob([fu8], { type: fmime }), 'face.png');
      const fr = await fetch(editsEndpoint, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + imgKey },
        body: ffd
      });
      if (fr.ok) {
        const fd = await fr.json();
        const fit = fd && fd.data && fd.data[0];
        if (fit && fit.b64_json) return await shrinkDataURL('data:image/png;base64,' + fit.b64_json);
        if (fit && fit.url) {
          try { return await shrinkDataURL(await urlToDataURL(fit.url)); } catch (e) { return fit.url; }
        }
      }
    } catch (e) { console.warn('[INS生图] 锁脸图生图失败，改用普通生图:', e && e.message); }
  }

  const full = (pos ? pos + '，' : '') + (subject ? subject + '，' : '') + prompt;
  const body = { model: imgModel, prompt: full, n: 1, size: '1024x1024' };
  if (faceRef) { body.image = faceRef; body.reference_image = [faceRef]; body.input_reference_image = [faceRef]; }
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + imgKey },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  const item = data && data.data && data.data[0];
  if (item && item.b64_json) return await shrinkDataURL('data:image/png;base64,' + item.b64_json);
  if (item && item.url) {
    // 很多生图接口返回的是会过期的临时 URL，这里转成 dataURL 存下来，避免重开后图片失效
    try { return await shrinkDataURL(await urlToDataURL(item.url)); }
    catch (e) { return item.url; }
  }
  throw new Error('生图接口未返回图片');
}

async function urlToDataURL(url) {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const blob = await resp.blob();
  return await new Promise(function (resolve, reject) {
    const fr = new FileReader();
    fr.onload = function () { resolve(String(fr.result)); };
    fr.onerror = function () { reject(fr.error); };
    fr.readAsDataURL(blob);
  });
}

// 压缩图片体积，保证能塞进本地存储且加载更快
function shrinkDataURL(dataURL, maxSize, quality) {
  return new Promise(function (resolve) {
    try {
      if (!dataURL || dataURL.indexOf('data:image/') !== 0 || dataURL.indexOf('data:image/svg') === 0) return resolve(dataURL);
      if (dataURL.length < 120000) return resolve(dataURL);
      const img = new Image();
      img.onload = function () {
        try {
          let w = img.width, h = img.height;
          const scale = Math.min(1, (maxSize || 1024) / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality || 0.82));
        } catch (e) { resolve(dataURL); }
      };
      img.onerror = function () { resolve(dataURL); };
      img.src = dataURL;
    } catch (e) { resolve(dataURL); }
  });
}

// 按设置给生成的帖子随机配真实图片
async function maybeGeneratePostImages(made) {
  loadImageSettings();
  if (!insImageSettings.enabled || !made || !made.length) return;
  // 每 3 轮生成一次图片（不是每轮都生图）
  insImageSettings.round = (typeof insImageSettings.round === 'number' ? insImageSettings.round : 0) + 1;
  saveImageSettings();
  if (insImageSettings.round % 3 !== 0) return;
  const charIds = insImageSettings.chars || [];
  const enabledChars = {};
  getSelectableChars().forEach(c => {
    if (c && charIds.indexOf(String(c.id || c.name)) > -1) enabledChars[normName(c.name)] = 1;
  });
  const strangerNames = {};
  strangerRosterList().forEach(s => { strangerNames[normName(s.name)] = 1; });
  let budget = 3;
  let firstErr = '';
  for (const p of made) {
    if (budget <= 0) break;
    const key = normName(p.user);
    let prob = 0;
    if (enabledChars[key]) prob = 0.6;
    else if (strangerNames[key]) prob = insImageSettings.stranger ? 0.3 : 0;
    else prob = insImageSettings.npc ? 0.22 : 0;
    if (prob <= 0 || Math.random() > prob) continue;
    try {
      const authorChar = getSelectableChars().find(c => c && normName(c.name) === normName(p.user));
      const genOpts = authorChar ? { charId: String(authorChar.id || authorChar.name), char: authorChar } : null;
      const url = await generateInsImage(buildPostImagePrompt(p), genOpts);
      if (url) {
        p.image = url; p.genPrompt = p.title || p.body || ''; budget--;
        try { if (window.NanoGallery) window.NanoGallery.add({ url: url, source: 'Ins', charName: p.user || '', prompt: p.genPrompt }); } catch (e) {}
      }
    } catch (e) {
      if (!firstErr) firstErr = (e && e.message ? e.message : String(e));
    }
  }
  if (firstErr) showError('生图失败', '生图设置已开启，但调用生图接口出错：\n' + firstErr);
}

// ==================== 工具 ====================
function letterOf(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatCommentText(text) {
  return escapeHtml(text).replace(/^((?:回复|@)\s*[^：:\s]{1,20}\s*[：:])/, '<span class="reply-mention">$1</span>');
}

// 顶栏下方的好友栏：展示好友（角色）的头像 + 名字
function renderStories() {
  const wrap = document.querySelector('#home .stories');
  if (!wrap) return;
  const chars = (currentUserChars && currentUserChars.length) ? currentUserChars : [];
  let html = '<div class="story my-story" onclick="go(\'profile\')"><div class="avatar-ring">' +
    '<div class="letter-avatar me" id="storyAvatar" style="width:60px;height:60px;font-size:24px">你</div>' +
    '</div><span>你的动态</span><i class="plus">+</i></div>';
  chars.slice(0, 12).forEach(function (c, i) {
    const name = c.name || '好友';
    const av = charAvatarMap[name] || ((c.avatar && String(c.avatar).length > 20) ? c.avatar : '');
    const cls = 'c' + ((i % 5) + 1);
    const style = 'width:60px;height:60px;font-size:24px';
    const inner = av
      ? '<div class="letter-avatar ' + cls + '" style="' + style + ';background-image:url(\'' +
          String(av).replace(/'/g, '%27') + '\');background-size:cover;background-position:center;color:transparent">' +
          escapeHtml(letterOf(name)) + '</div>'
      : '<div class="letter-avatar ' + cls + '" style="' + style + '">' + escapeHtml(letterOf(name)) + '</div>';
    html += '<div class="story story-person" data-profile="' + escapeHtml(name) + '"><div class="avatar-ring">' + inner + '</div><span>' + escapeHtml(name) + '</span></div>';
  });
  wrap.innerHTML = html;
}

function colorFor(name) {
  if (name === userProfile.name) return userProfile.avatarColor || 'me';
  let h = 0; const s = name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function colorBg(name) {
  const colors = {
    c1: 'linear-gradient(135deg,#f8b04d,#ef476f)',
    c2: 'linear-gradient(135deg,#3897f0,#a343d4)',
    c3: 'linear-gradient(135deg,#27ae60,#3897f0)',
    c4: 'linear-gradient(135deg,#e74c3c,#f8b04d)',
    c5: 'linear-gradient(135deg,#a343d4,#e1306c)',
    me: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)'
  };
  return colors[colorFor(name)] || colors.c2;
}

// ==================== 顶栏 ====================
function updateTopbar(pageId) {
  const brand = document.getElementById('topBrand');
  const actionBtns = document.getElementById('topActions').querySelectorAll('button');
  actionBtns.forEach(b => b.style.display = 'flex');
  const map = { home: 'Forum', search: 'Search', activity: 'Activity' };
  brand.textContent = map[pageId] || 'Forum';
  if (pageId !== 'home') actionBtns.forEach(b => b.style.display = 'none');
  if (pageId === 'activity') actionBtns[1].style.display = 'flex';
}

function openHome() { go('home'); }

// 点击 Forum / 返回：回到 App 的「发现」页（discover.html），与朋友圈返回一致
function backToDiscover() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'backToDiscover' }, '*');
      return;
    }
  } catch (e) {}
  window.location.href='../index.html';
}

function goBack() {
  const active = document.querySelector('.page.active');
  if (!active) return;
  const id = active.id;
  if (id === 'detail') { detailBack(); return; }
  if (id === 'publish') { openHome(); return; }
  if (id === 'chat') { go('dm'); return; }
  if (id === 'tagResult') { go('search'); return; }
  if (id === 'charProfile') { charProfileBack(); return; }
  if (id === 'dm' || id === 'profile' || id === 'activity' || id === 'search') { openHome(); return; }
  if (id === 'home') { backToDiscover(); return; }
}

function detailBack() {
  if (detailFrom === 'profile') go('profile');
  else if (detailFrom === 'tag') go('tagResult');
  else if (detailFrom === 'charProfile') { renderCharProfileView(); go('charProfile'); }
  else go('home');
}

// 右滑返回：交给页面自己按内部层级退回（详情→来源、私信→私信列表、根页→发现页）
window.__nanoInternalBack = function () {
  const active = document.querySelector('.page.active');
  if (!active) return false;
  goBack();
  return true;
};

// ==================== 头像 HTML ====================
function avatarHTML(name, sizeClass, extraStyle, linkable) {
  const isMe = name === userProfile.name;
  const colorKey = isMe ? (userProfile.avatarColor || 'me') : colorFor(name);
  const cls = 'letter-avatar ' + colorKey + ' ' + (sizeClass || '') + (linkable ? ' avatar-link' : '');
  const style = extraStyle || '';
  const linkAttr = linkable ? ` data-profile="${escapeHtml(name)}"` : '';

  if (isMe && userProfile.avatarImage) {
    return `<div class="${cls}"${linkAttr} style="background-image:url('${userProfile.avatarImage}');background-size:cover;background-position:center;color:transparent;${style}">${letterOf(name)}</div>`;
  }
  if (!isMe && charAvatarMap[name]) {
    return `<div class="${cls}"${linkAttr} style="background-image:url('${charAvatarMap[name]}');background-size:cover;background-position:center;color:transparent;${style}">${letterOf(name)}</div>`;
  }
  return `<div class="${cls}"${linkAttr} style="${style}">${letterOf(name)}</div>`;
}

// ==================== 帖子渲染 ====================
function renderTagsHTML(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="post-tags">${tags.map(t => `<span class="tag-chip-sm" onclick="event.stopPropagation();openTagResult('${t}')">#${t}</span>`).join('')}</div>`;
}

function postInnerHTML(p) {
  if (p.image) {
    return `
      <img class="post-media" src="${p.image}" data-fb="${escapeHtml((p.title || p.body || '记录').slice(0, 40))}" onerror="insImgFallback(this)" onclick="openDetail(${p.id},'home')">
      ${p.title ? `<div class="post-img-title">${p.title}</div>` : ''}
      <div class="post-body">
        <div class="actions">
          <button onclick="toggleLike(this)"><svg class="icon action-icon" viewBox="0 0 24 24"><path d="M20.8 8.8c0 5.5-8.8 10.2-8.8 10.2S3.2 14.3 3.2 8.8A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z"/></svg></button>
          <button onclick="openDetail(${p.id},'home')"><svg class="icon action-icon" viewBox="0 0 24 24"><path d="M20 11.5a7.7 7.7 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.3-4.1A7.2 7.2 0 0 1 4 11.5 7.7 7.7 0 0 1 12 4a7.7 7.7 0 0 1 8 7.5Z"/></svg></button>
          <button onclick="openShare(${p.id})"><svg class="icon action-icon" viewBox="0 0 24 24"><path d="m21 3-7.2 18-3.5-7.3L3 10.2z"/><path d="M21 3 10.3 13.7"/></svg></button>
          <button class="right" onclick="savePost(this,${p.id})"><svg class="icon action-icon ${savedPosts.includes(p.id) ? 'fill' : ''}" viewBox="0 0 24 24"><path d="M6 4h12v17l-6-3.5L6 21z"/></svg></button>
        </div>
        <div class="likes">${p.likes.toLocaleString()} 个赞</div>
        ${p.body ? `<div class="caption"><b>${p.user}</b> ${p.body}</div>` : ''}
        ${renderTagsHTML(p.tags)}
        <div class="comments" onclick="openDetail(${p.id},'home')">查看全部 ${p.comments.length} 条评论</div>
        <div class="time">刚刚</div>
      </div>
    `;
  }
  return `
    <div class="post-text-block" onclick="openDetail(${p.id},'home')">
      ${p.title ? `<div class="post-text-title">${p.title}</div>` : ''}
      ${p.body ? `<div class="post-text-body">${p.body}</div>` : ''}
      ${renderTagsHTML(p.tags)}
    </div>
    <div class="post-body">
      <div class="actions">
        <button onclick="toggleLike(this)"><svg class="icon action-icon" viewBox="0 0 24 24"><path d="M20.8 8.8c0 5.5-8.8 10.2-8.8 10.2S3.2 14.3 3.2 8.8A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z"/></svg></button>
        <button onclick="openDetail(${p.id},'home')"><svg class="icon action-icon" viewBox="0 0 24 24"><path d="M20 11.5a7.7 7.7 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.3-4.1A7.2 7.2 0 0 1 4 11.5 7.7 7.7 0 0 1 12 4a7.7 7.7 0 0 1 8 7.5Z"/></svg></button>
        <button onclick="openShare(${p.id})"><svg class="icon action-icon" viewBox="0 0 24 24"><path d="m21 3-7.2 18-3.5-7.3L3 10.2z"/><path d="M21 3 10.3 13.7"/></svg></button>
        <button class="right" onclick="savePost(this,${p.id})"><svg class="icon action-icon ${savedPosts.includes(p.id) ? 'fill' : ''}" viewBox="0 0 24 24"><path d="M6 4h12v17l-6-3.5L6 21z"/></svg></button>
      </div>
      <div class="likes">${p.likes.toLocaleString()} 个赞</div>
      <div class="comments" onclick="openDetail(${p.id},'home')">查看全部 ${p.comments.length} 条评论</div>
      <div class="time">刚刚</div>
    </div>
  `;
}

function renderFeed() {
  document.getElementById('feed').innerHTML = posts.map(p => `
    <article class="post" data-post-id="${p.id}">
      <div class="post-head">
        ${avatarHTML(p.user, '', '', true)}
        <div class="user-meta" onclick="openDetail(${p.id},'home')">
          <div class="username">${p.user}</div>
          <div class="location">${p.location}</div>
        </div>
        <button class="more" onclick="event.stopPropagation();openMenu(${p.id})">•••</button>
      </div>
      ${postInnerHTML(p)}
    </article>
  `).join('');
}

function openDetail(id, from) {
  detailFrom = from || 'home';
  currentPost = posts.find(p => p.id === id) || posts[0];
  replyTarget = null; replyTargetReply = null;
  renderDetail();
  go('detail');
}

function renderDetail() {
  const p = currentPost;
  const input = document.getElementById('commentInput');
  const btn = document.getElementById('commentSendBtn');
  const cmEl = document.getElementById('commentAvatarLetter');
  if (userProfile.avatarImage) {
    cmEl.textContent = ''; cmEl.className = 'letter-avatar';
    cmEl.style.backgroundImage = `url('${userProfile.avatarImage}')`;
    cmEl.style.backgroundSize = 'cover'; cmEl.style.backgroundPosition = 'center';
  } else {
    cmEl.textContent = letterOf(userProfile.name);
    cmEl.className = 'letter-avatar ' + (userProfile.avatarColor || 'me');
    cmEl.style.backgroundImage = '';
  }
  if (replyTargetReply) { input.placeholder = '回复 ' + replyTargetReply.user + '…'; btn.textContent = '回复'; }
  else if (replyTarget) { input.placeholder = '回复 ' + replyTarget.user + '…'; btn.textContent = '回复'; }
  else { input.placeholder = '添加评论…'; btn.textContent = '发送'; }
  input.value = '';

  let commentsHTML = '';
  if (p.comments.length) {
    commentsHTML = p.comments.map(c => {
      let repliesHTML = '';
      if (c.replies && c.replies.length) {
        repliesHTML = `<div class="reply-list">${c.replies.map((r, ri) => `
          <div class="reply">
            ${avatarHTML(r.user, 'sm', '', true)}
            <div style="flex:1">
              <div class="comment-user">${r.user}</div>
              <div class="comment-text">${formatCommentText(r.text)}</div>
              <div class="comment-meta"><span>刚刚</span><button class="reply-btn" onclick="setReplyToReply(${c.id},${ri})">回复</button></div>
            </div>
          </div>`).join('')}</div>`;
      }
      return `<div class="comment">
        ${avatarHTML(c.user, '', '', true)}
        <div class="comment-main">
          <div class="comment-user">${c.user}</div>
          <div class="comment-text">${formatCommentText(c.text)}</div>
          <div class="comment-meta"><span>刚刚</span><button class="reply-btn" onclick="setReply(${c.id})">回复</button></div>
          ${repliesHTML}
        </div>
      </div>`;
    }).join('');
  } else {
    commentsHTML = '<div style="color:#999;font-size:13px;padding:25px 0;text-align:center">还没有评论</div>';
  }

  document.getElementById('detailContent').innerHTML = `
    <article class="detail-post">
      <div class="post-head">
        ${avatarHTML(p.user, '', '', true)}
        <div class="user-meta">
          <div class="username">${p.user}</div>
          <div class="location">${p.location}</div>
        </div>
      </div>
      ${postInnerHTML(p)}
    </article>
    <div class="comments-head">
      <h3>评论</h3>
      <button class="comment-refresh" onclick="refreshComments()" title="刷新评论">
        <svg class="icon" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v6h-6"/></svg>
      </button>
    </div>
    ${commentsHTML}
  `;
}

// ==================== 评论 ====================
function setReply(id) {
  replyTarget = currentPost.comments.find(c => c.id === id);
  replyTargetReply = null;
  renderDetail();
  document.getElementById('commentInput').focus();
}

function setReplyToReply(commentId, replyIndex) {
  const c = currentPost.comments.find(x => x.id === commentId);
  if (!c || !c.replies || !c.replies[replyIndex]) return;
  replyTarget = null;
  replyTargetReply = Object.assign({}, c.replies[replyIndex], { _commentId: commentId, _replyIndex: replyIndex });
  renderDetail();
  document.getElementById('commentInput').focus();
}

function sendComment() {
  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if (!text) { showToast('请输入内容'); return; }
  if (replyTargetReply && replyTargetReply._commentId !== undefined) {
    const c = currentPost.comments.find(x => x.id === replyTargetReply._commentId);
    if (c && c.replies) c.replies.push({ user: userProfile.name, text: '回复 ' + replyTargetReply.user + '：' + text });
  } else if (replyTarget) {
    if (!replyTarget.replies) replyTarget.replies = [];
    replyTarget.replies.push({ user: userProfile.name, text: '回复 ' + replyTarget.user + '：' + text });
  } else {
    currentPost.comments.push({ id: Date.now(), user: userProfile.name, text: text, replies: [] });
  }
  replyTarget = null; replyTargetReply = null;
  saveInsChatState();
  renderDetail(); renderFeed(); showToast('已发送');
}

try{ if(window.NanoRefresh) window.NanoRefresh.define({ id:'ins', name:'Instagram', url:'ins.html', title:'Instagram' }); }catch(e){}
async function refreshComments() {
  if (!currentPost) return;
  if (insBusy.comments) { showToast('正在生成评论中，请稍候…'); return; }
  insBusy.comments = true;
  try{ if(window.NanoRefresh) NanoRefresh.start({ key:'ins-comments', label:'刷新评论' }); }catch(e){}
  const post = currentPost;
  showLoading('正在生成评论互动…');
  try {
    const bound = getSelectableChars();
    let npcs = pickNpcs(3 + Math.floor(Math.random() * 2));
    if (!npcs.length && bound.length) {
      try { await generateNpcRoster(bound); npcs = pickNpcs(3); } catch (e) {}
    }
    const exclude = bound.map(c => c.name).concat(npcs.map(n => n.name));
    await ensureStrangerRoster(bound, 8, exclude);
    const strangers = pickStrangers(5, []);
    if (!bound.length && !npcs.length && !strangers.length) {
      showToast('没有可互动的角色，请先绑定角色或配置 API');
      return;
    }
    const before = (post.comments || []).length;
    let newCount = 0;
    try {
      newCount = await generateCommentsForPost(post, bound, npcs, strangers);
      if (newCount < 6) {
        try { newCount += await generateCommentsForPost(post, bound, npcs, strangers); } catch (e) {}
      }
    } catch (e) {
      showToast('评论生成失败');
      try{ if(window.NanoRefresh) NanoRefresh.fail(e, { key:'ins-comments' }); }catch(err){}
    }
    saveInsChatState();
    renderDetail(); renderFeed();
    const added = post.comments.length - before;
    showToast(added > 0 ? ('已生成 ' + added + ' 条评论互动') : '暂无新评论');
    notifyInsDone('Instagram', '评论刷新完成，+' + added + ' 条互动');
    try{ if(window.NanoRefresh) NanoRefresh.success('评论互动已更新，点「去看看」查看', { key:'ins-comments' }); }catch(e){}
  } finally {
    insBusy.comments = false;
    hideLoading();
  }
}

function toggleLike(btn) {
  const svg = btn.querySelector('svg');
  if (svg.style.fill === 'rgb(237, 73, 86)') { svg.style.fill = ''; svg.style.stroke = ''; }
  else { svg.style.fill = '#ed4956'; svg.style.stroke = '#ed4956'; }
}

function savePost(btn, id) {
  if (id === undefined) id = currentPost.id;
  const svg = btn.querySelector('svg');
  if (savedPosts.includes(id)) {
    savedPosts = savedPosts.filter(x => x !== id); svg.classList.remove('fill'); showToast('已取消收藏');
  } else {
    savedPosts.push(id); svg.classList.add('fill'); showToast('已收藏');
  }
  saveInsChatState();
  if (profileTab === 'saved') renderProfileGrid();
}

// ==================== 帖子操作 ====================
function openMenu(postId) { menuPostId = postId; document.getElementById('menuModal').classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function deletePost() {
  closeModal('menuModal');
  if (menuPostId) {
    const idx = posts.findIndex(p => p.id === menuPostId);
    if (idx > -1) { posts.splice(idx, 1); saveInsChatState(); renderFeed(); renderProfileGrid(); renderDiscover(); showToast('帖子已删除'); }
    menuPostId = null;
  }
}

// ==================== 分享（仅私信 Message） ====================
function openShare(postId) {
  sharePostId = postId;
  shareTab = 'msg';
  renderShareList();
  document.getElementById('shareModal').classList.add('show');
}

function switchShareTab() { /* 仅保留私信，兼容旧调用 */ }

function renderShareList() {
  const wrap = document.getElementById('shareList');
  const list = friends.concat(strangers);
  if (!list.length) {
    wrap.innerHTML = '<div class="tag-empty" style="padding:30px 0">暂无可分享的好友</div>';
    return;
  }
  wrap.innerHTML = list.map(u => `
    <div class="share-row" onclick="doShare('${u.id}','${u.name}','msg')">
      ${avatarHTML(u.name, '', 'width:44px;height:44px;font-size:18px')}
      <div class="info">
        <div class="name">${escapeHtml(u.name)}</div>
        <div class="sub">发送到 Message</div>
      </div>
      <span class="send-ic">发送</span>
    </div>`).join('');
}

function doShare(chatId, name) {
  closeModal('shareModal');
  closeModal('menuModal');
  const p = posts.find(x => x.id === sharePostId) || posts[0];
  const shareMsg = {
    from: 'out', type: 'post', postId: p.id, postUser: p.user,
    postTitle: p.title || '', postBody: p.body || '',
    postImage: p.image || null, postTags: p.tags || []
  };
  if (!chatHistories[chatId]) chatHistories[chatId] = [];
  chatHistories[chatId].push(shareMsg);

  saveInsChatState();
  setTimeout(() => { requestChatReply(chatId); }, 700);

  showToast('已分享到 ' + name + ' 的私信');
  const u = friends.concat(strangers).find(x => x.id === chatId);
  if (u) openChat(chatId, u.name, u.handle, u.verified, strangers.some(s => s.id === chatId) ? 'stranger' : 'friend');
}

// ==================== Discover ====================
function renderDiscover() {
  const tagWrap = document.getElementById('discoverTags');
  if (tagWrap) {
    tagWrap.innerHTML = recommendTags.map(t =>
      `<span class="tag-chip" onclick="openTagResult('${t}')">#${t}</span>`
    ).join('');
  }

  const list = document.getElementById('discoverList');
  if (!list) return;
  const pool = posts.slice();
  const picked = [];
  const n = Math.min(6, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  if (!picked.length) {
    list.innerHTML = '<div style="color:#aaa;font-size:13px;padding:30px 0;text-align:center">暂无推荐内容</div>';
    return;
  }
  list.innerHTML = picked.map(p => {
    const thumb = p.image
      ? `<img class="dc-thumb" src="${p.image}">`
      : `<div class="dc-text-thumb">${(p.title || p.body || '').slice(0, 30)}</div>`;
    return `<div class="discover-card" onclick="openDetail(${p.id},'discover')">
      ${thumb}
      <div class="dc-info">
        <div class="dc-user">${p.user} · ${p.location || ''}</div>
        <div class="dc-title">${p.title || '无标题'}</div>
        <div class="dc-body">${(p.body || '').slice(0, 60)}</div>
      </div>
    </div>`;
  }).join('');
}

// 通过 API 生成若干条论坛帖子（失败时回退到角色人设）
async function generateInsPosts(count, topic) {
  const npcNames = currentUserChars.length
    ? currentUserChars.map(c => c.name)
    : [];
  if (!npcNames.length) return [];
  const tagPool = topic ? [topic] : recommendTags;
  const sys = '你是一个活跃的社交论坛用户群体。请生成 ' + count + ' 条简短、真实、有生活感的论坛帖子。' +
    '只返回 JSON 数组，格式：[{"user":"用户名","location":"地点","title":"标题","body":"正文","tags":["话题1","话题2"]}]，' +
    '不要 Markdown、不要解释、不要多余文字。user 必须从给定用户名里选。';
  const userMsg = '话题方向：' + tagPool.join('、') + '\n可用用户名：' + npcNames.join('、');
  let out = '';
  try { out = await callChatApi([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 'sub'); } catch (e) { out = ''; }
  const arrMatch = (out || '').match(/\[[\s\S]*\]/);
  const made = [];
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      (arr || []).slice(0, count).forEach((p, i) => {
        if (!p) return;
        const name = (p.user && npcNames.indexOf(p.user) !== -1) ? p.user : npcNames[Math.floor(Math.random() * npcNames.length)];
        const hasImg = Math.random() > 0.5;
        made.push({
          id: Date.now() + i + Math.floor(Math.random() * 999),
          user: name,
          location: p.location || '',
          image: hasImg ? makeTextImage(p.title || p.body || '记录') : null,
          likes: Math.floor(Math.random() * 600) + 20,
          title: p.title || '',
          body: p.body || '',
          tags: Array.isArray(p.tags) && p.tags.length ? p.tags : (topic ? [topic] : ['随笔']),
          comments: []
        });
      });
    } catch (e) {}
  }
  if (!made.length) {
    return [];
  }
  return made;
}

async function discoverRefresh() {
  showToast('正在刷新推荐…');
  try {
    const newPosts = await generateInsPosts(3, null);
    posts = newPosts.concat(posts);
    renderDiscover();
    renderFeed();
    showToast('已为你刷新推荐');
  } catch (e) {
    renderDiscover();
    showToast('刷新失败，已重排推荐');
  }
}

// ==================== AI 生成：人设 / NPC 花名册 ====================
const NPC_ROSTER_PREFIX = 'nano_ins_npcs_';
const NPC_ROLE_BLACKLIST = /(旅行者|游客|路人|路人甲|陌生人|新朋友|网友|客人|顾客|邻居|同事|同学|老师|医生|护士|警官|警察|司机|阿姨|叔叔|大爷|大妈|女士|先生|小姐|老板|店主|店长|店员|朋友|好友|某人|总裁|助理|前台|保安|服务生|路人角色|NPC|npc)/;

function normName(s) {
  return String(s == null ? '' : s).replace(/[\s~～!！?？.。·、,，]/g, '');
}

// 去掉「（女）」「(XX的朋友)」「【…】」等装饰后再比较，兼容模型多写的说明
function stripNameDecor(s) {
  return String(s == null ? '' : s).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').trim();
}

// 在允许名单里宽松匹配一个名字，返回名单里的规范名字
function matchAllowed(name, allowedNames) {
  if (!name) return null;
  const list = (allowedNames || []).filter(Boolean);
  const key = normName(name);
  let hit = list.find(n => normName(n) === key);
  if (hit) return hit;
  const stripped = stripNameDecor(name);
  if (stripped && stripped !== String(name).trim()) {
    const key2 = normName(stripped);
    hit = list.find(n => normName(n) === key2);
    if (hit) return hit;
  }
  // 前缀匹配（模型可能写成「李思雨说」之类）
  hit = list.find(n => key.length >= 2 && (key.indexOf(normName(n)) === 0 || normName(n).indexOf(key) === 0));
  return hit || null;
}

function isGenericNpcName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return true;
  if (n.length < 2 || n.length > 12) return true;
  if (/^[阿小老]/.test(n) && n.length <= 3) return true;
  if (NPC_ROLE_BLACKLIST.test(n)) return true;
  return false;
}

function currentMaskId() { return (userProfile && userProfile.id) || 'default'; }
function rosterKey() { return NPC_ROSTER_PREFIX + currentMaskId(); }
function rosterSrcKey() { return NPC_ROSTER_PREFIX + 'src_' + currentMaskId(); }

function loadNpcRoster() {
  try {
    const raw = localStorage.getItem(rosterKey());
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; }
  } catch (e) {}
  return null;
}

function loadNpcRosterSrc() {
  try {
    const raw = localStorage.getItem(rosterSrcKey());
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; }
  } catch (e) {}
  return null;
}

function saveNpcRoster(list, ids) {
  try {
    localStorage.setItem(rosterKey(), JSON.stringify(list || []));
    localStorage.setItem(rosterSrcKey(), JSON.stringify(ids || []));
  } catch (e) {}
}

function loadWorldbookText(boundIds) {
  const out = [];
  try {
    const raw = localStorage.getItem('nano_worldbook_data_v5');
    if (raw) {
      const d = JSON.parse(raw); const files = (d && d.files) || [];
      files.forEach(f => {
        if (!f) return;
        const scope = f.scope || 'global';
        if (scope === 'local') {
          const bound = f.boundCharacters || [];
          if (!bound.some(b => (boundIds || []).indexOf(b) > -1)) return;
        }
        let txt = '';
        if (Array.isArray(f.entries)) txt = f.entries.map(en => en && en.content ? String(en.content) : '').filter(Boolean).join('\n');
        else if (typeof f.content === 'string') txt = f.content;
        if (txt.trim()) out.push('【' + (f.name || '世界书') + '】\n' + txt.trim().slice(0, 1200));
      });
    }
  } catch (e) {}
  return out.slice(0, 3).join('\n\n');
}

// 面向成年人的虚构社交平台：用于降低内容过滤误判，同时保持内容合规
const ADULT_PLATFORM_NOTE = '【创作背景】这是一个虚构的社交平台角色扮演场景，所有角色均为成年人、均为虚构人物，内容仅供娱乐创作。请围绕日常、情感、生活、幽默与社交互动自然表达；设定中若含有不适合直接输出的内容，请在不改变人物关系的前提下用含蓄、生活化的措辞改写，不要复述敏感词。';
const SAFE_REWRITE_NOTE = '【合规】只写日常、情感、生活、幽默、社交互动类内容，避免违规、露骨、暴力或不当描写；不要提及系统、安全、政策等字样，用含蓄自然的措辞完成。';

function buildPersonaBlock(allChars) {
  const lines = [];
  const seenNames = {};
  lines.push('【可扮演的角色 / NPC · 必须严格贴人设、不得 OOC】');
  lines.push('（以下为虚构设定，仅用于角色扮演；如含敏感词请在不改变角色关系的前提下自然改写，不要复述敏感词）');
  (allChars || []).forEach(c => {
    if (!c || !c.name) return;
    if (seenNames[normName(c.name)]) return;
    seenNames[normName(c.name)] = 1;
    lines.push('◇ ' + c.name + (c.gender && c.gender !== '未知' ? ('（' + c.gender + '）') : ''));
    lines.push((c.setting && String(c.setting).trim()) ? String(c.setting).trim().slice(0, 600) : '（暂无详细设定，按名字与语境自然扮演）');
  });
  const ids = (allChars || []).map(c => c.id).filter(Boolean);
  const wb = loadWorldbookText(ids);
  if (wb) lines.push('\n【世界书】\n' + wb);
  return lines.join('\n');
}

// 用户本人人设（生成帖子/评论/私信时必须读取，但禁止替用户发言）
function userPersonaBlock() {
  const s = userProfile.setting || '';
  return s ? ('【用户本人的人设/背景（仅供理解语境，禁止替用户发言；如含敏感词请自然改写，不要复述）】\n' + String(s).slice(0, 700)) : '';
}

function dbNpcs() {
  return (currentUserChars || []).filter(c => c && c.name && c.isNpc && !c.nanoAssistant && !isGenericNpcName(c.name)).map(c => ({
    id: c.id || ('npc_' + normName(c.name)), name: c.name, avatar: c.avatar || '', type: 'npc',
    isNpc: true, setting: c.setting || '', gender: c.gender || ''
  }));
}

function rosterNpcs() {
  const list = loadNpcRoster() || [];
  return list.filter(n => n && n.name && !isGenericNpcName(n.name)).map(n => ({
    id: n.id || ('npc_' + normName(n.name)), name: n.name, avatar: n.avatar || '', type: 'npc',
    isNpc: true, relation: n.relation || '', setting: n.setting || n.relation || '', gender: n.gender || ''
  }));
}

function generateContextNPCs() {
  const seen = {}, out = [];
  dbNpcs().concat(rosterNpcs()).forEach(n => {
    if (!n || !n.name || seen[normName(n.name)]) return;
    seen[normName(n.name)] = 1; out.push(n);
  });
  return out.slice(0, 12);
}

// NPC 每次随机出现：从候选池里随机抽 n 个
function pickNpcs(n) {
  return pickRandom(generateContextNPCs(), n);
}

// ==================== 平台陌生用户（Instagram 是开放平台，不只是好友圈） ====================
const STRANGER_ROSTER_PREFIX = 'nano_ins_strangers_';

function strangerRosterKey() { return STRANGER_ROSTER_PREFIX + currentMaskId(); }
function loadStrangerRoster() {
  try {
    const raw = localStorage.getItem(strangerRosterKey());
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; }
  } catch (e) {}
  return null;
}
function saveStrangerRoster(list) {
  try { localStorage.setItem(strangerRosterKey(), JSON.stringify(list || [])); } catch (e) {}
}
function strangerRosterList() {
  const list = loadStrangerRoster() || [];
  return list.filter(s => s && s.name && !isGenericNpcName(s.name));
}
function findStrangerByName(name) {
  if (!name) return null;
  const key = normName(name);
  return strangerRosterList().find(s => normName(s.name) === key) || null;
}
function parseStrangerRoster(raw, exclude) {
  const text = String(raw || '').replace(/```[a-zA-Z]*/g, '').trim();
  let arr = null;
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { arr = JSON.parse(m[0]); } catch (e) { arr = null; } }
  const ex = (exclude || []).map(normName);
  const seen = {};
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach(n => {
    if (!n) return;
    const name = String(n.name || '').trim();
    if (!name || isGenericNpcName(name)) return;
    if (normName(name) === normName(userProfile.name)) return;
    if (ex.indexOf(normName(name)) > -1 || seen[normName(name)]) return;
    seen[normName(name)] = 1;
    out.push({
      name: name,
      setting: String(n.setting || '').trim(),
      location: String(n.location || '').trim(),
      gender: String(n.gender || '').trim(),
      handle: '@' + normName(name).toLowerCase()
    });
  });
  return out;
}
async function generateStrangerRoster(chars, want, exclude) {
  const persona = buildPersonaBlock((chars || []).slice(0, 3));
  const system = '你是一个社交平台（类似 Instagram / 微博）的用户运营助手，负责构思平台上的普通陌生用户。他们不属于用户的熟人圈子，只是活跃在这个开放平台上的路人网友，均为成年人。' + ADULT_PLATFORM_NOTE;
  const userMsg = persona +
    '\n\n请生成 ' + (want || 8) + ' 个活跃在该平台的陌生用户（不是用户的熟人、不是朋友的朋友，就是开放平台上的普通网友）。\n' +
    '要求：\n' +
    '- 账号昵称真实自然且多元：可以是中国网友的昵称/网名（如「摄影师阿澈」「深夜写诗的人」），也可以是英文或生活化账号（如 "luna.bakes"、"trail_mark"）；\n' +
    '- 每个人设、兴趣、职业、地域都不同，覆盖摄影、美食、旅行、健身、读书、游戏、音乐、职场、宠物等多元话题；\n' +
    '- 严禁「陌生人、网友、路人甲、新朋友、某人、测试用户」这类占位名；\n' +
    '- 不要与这些已有名字重复：' + ((exclude || []).join('、') || '（无）') + '。\n\n' +
    '严格输出 JSON 数组（不要 markdown、不要解释），格式：\n' +
    '[{"name":"luna.bakes","setting":"热爱烘焙的插画师，常在深夜分享甜品","location":"上海","gender":"女"}]';
  const raw = await callChatApi([{ role: 'system', content: system }, { role: 'user', content: userPersonaBlock() + '\n\n' + userMsg }], 'sub');
  return parseStrangerRoster(raw, exclude);
}
// 确保陌生用户池至少有 min 个；不足则按人设/世界书生成
async function ensureStrangerRoster(chars, min, exclude) {
  let list = strangerRosterList();
  if (list.length >= (min || 6)) return list;
  const ex = (exclude || []).concat(list.map(s => s.name));
  try {
    const more = await generateStrangerRoster(chars, Math.max(8, (min || 6) - list.length + 4), ex);
    if (more.length) {
      saveStrangerRoster(list.concat(more).slice(0, 24));
    }
  } catch (e) {}
  return strangerRosterList();
}
function pickStrangers(n, exclude) {
  const ex = (exclude || []).map(normName);
  const pool = strangerRosterList().filter(s => ex.indexOf(normName(s.name)) === -1);
  return pickRandom(pool, n);
}

// 可选择的角色：优先当前绑定的 char，没有绑定时退回全部已知角色（含 NPC）
function getSelectableChars() {
  // 群聊 NPC / 小号也绑定在当前 user 上，必须出现在 Ins 生成选项里
  return (currentUserChars || []).filter(c => c && c.name);
}

function parseNpcRoster(raw, chars) {
  const text = String(raw || '').replace(/```[a-zA-Z]*/g, '').trim();
  let arr = null;
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { arr = JSON.parse(m[0]); } catch (e) { arr = null; } }
  const block = (chars || []).map(c => c && c.name).filter(Boolean);
  block.push(userProfile.name);
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach(n => {
    if (!n) return;
    const name = String(n.name || '').trim();
    if (isGenericNpcName(name)) return;
    if (block.some(b => normName(b) === normName(name))) return;
    out.push({
      id: 'npc_' + normName(name), name: name,
      relation: String(n.relation || '').trim(),
      setting: String(n.setting || '').trim(),
      gender: String(n.gender || '').trim()
    });
  });
  return out;
}

async function generateNpcRoster(chars, want) {
  const persona = buildPersonaBlock(chars);
  const system = '你是一个世界观设定助手，只负责根据角色人设与世界书，推断与该角色/用户有现实社会关系的具体人物（朋友、同学、同事、家人、邻居等）。必须给出真实感强的完整姓名，严禁使用「旅行者、咖啡店老板、新朋友、路人、X女士、阿明」这类通用占位称呼。所有人物均为成年人。' + ADULT_PLATFORM_NOTE;
  const userMsg = persona +
    '\n\n请列出 ' + (want || 5) + ' 个与上面这些角色或用户本人真实相识的具体人物（他们可能是同事/同学/朋友/家人/邻居/合作方等），供社交论坛互动使用。\n' +
    '要求：\n' +
    '- 每个名字必须是现实中正常的完整姓名（如「李思雨」「刘媛」「陈子豪」），不要用职业或关系当名字；\n' +
    '- 必须贴合上面的世界观与人设，说明 TA 与哪个角色、什么关系；\n' +
    '- 不要与上面已有的角色重名。\n\n' +
    '严格输出 JSON 数组（不要 markdown、不要解释），格式：\n' +
    '[{"name":"李思雨","relation":"XX的大学同学","setting":"一句话性格与背景","gender":"女"}]';
  const raw = await callChatApi([{ role: 'system', content: system }, { role: 'user', content: userPersonaBlock() + '\n\n' + userMsg }], 'sub');
  const list = parseNpcRoster(raw, chars);
  const ids = (chars || []).map(c => String((c && (c.id || c.name)) || '')).filter(Boolean);
  if (list.length) saveNpcRoster(list, ids);
  return list;
}

function findCharByName(list, name) {
  if (!name) return null;
  const key = normName(name);
  return (list || []).find(c => c && c.name && normName(c.name) === key) || null;
}

function findNpcByName(npcs, name) {
  if (!name) return null;
  const key = normName(name);
  return (npcs || []).find(c => c && c.name && normName(c.name) === key) || null;
}

function resolveAuthor(name, chars, npcs, strangers) {
  const direct = findCharByName(chars, name) ||
    findNpcByName(npcs, name) ||
    (strangers ? findNpcByName(strangers, name) : null) ||
    findStrangerByName(name);
  if (direct) return direct;
  const stripped = stripNameDecor(name);
  if (stripped && stripped !== String(name == null ? '' : name).trim()) {
    const s = findCharByName(chars, stripped) ||
      findNpcByName(npcs, stripped) ||
      (strangers ? findNpcByName(strangers, stripped) : null) ||
      findStrangerByName(stripped);
    if (s) return s;
  }
  const all = (chars || []).concat(npcs || []).concat(strangers || []);
  const hit = matchAllowed(name, all.map(c => c && c.name).filter(Boolean));
  return hit ? (all.find(c => c && c.name === hit) || null) : null;
}

// ==================== AI 评论互动解析 ====================
// 帖子下已经出现过的参与者（作者之外的评论者 / 被回复者）
function postParticipantNames(post) {
  const out = [];
  ((post && post.comments) || []).forEach(c => {
    if (c && c.user) out.push(c.user);
    (c && c.replies || []).forEach(r => { if (r && r.user) out.push(r.user); });
  });
  return out;
}

// 评论区可用名单：发帖人 + 已有参与者 + 好友/NPC/陌生网友
function buildCommenterPool(post, bound, npcs, strangers) {
  const authorName = post && post.user;
  const authorObj = resolveAuthor(authorName, bound, npcs, strangers);
  const isUserAuthor = normName(authorName) === normName(userProfile.name);
  const SG = window.NanoSocialGraph;
  const pool = [], seen = {};
  function add(n) {
    if (!n || normName(n) === normName(userProfile.name) || seen[normName(n)]) return;
    seen[normName(n)] = 1; pool.push(n);
  }
  if (authorName) add(authorName);
  postParticipantNames(post).forEach(add);
  (bound || []).forEach(c => {
    if (!c || !c.name) return;
    // 用户自己的帖子：绑定角色都认识用户，可以评论；角色帖子：必须有明确关系。
    if (isUserAuthor || (authorObj && SG && SG.knows(authorObj, c))) add(c.name);
  });
  // 同学/朋友/陌生网友可以评论公开帖子；只限制绑定 char 之间不随意互串。
  (npcs || []).forEach(c => { if (c && c.name) add(c.name); });
  // 陌生人帖子下的陌生网友是公开平台的一部分，保留；但不会和已知 char 硬凑关系。
  (strangers || []).forEach(c => add(c && c.name));
  return pool;
}

function filterInsKnownReplies(list, post, bound, npcs, strangers) {
  const SG = window.NanoSocialGraph;
  if (!SG) return list;
  const author = resolveAuthor(post && post.user, bound, npcs, strangers);
  const isUserAuthor = normName(post && post.user) === normName(userProfile.name);
  const knownChars = (bound || []);   // 只限制用户绑定的 char；NPC/陌生人不限制
  function asKnown(name) {
    const c = resolveAuthor(name, bound, npcs, strangers);
    if (!c) return null;
    return knownChars.some(x => x && (normName(x.name) === normName(c.name))) ? c : null;
  }
  return (list || []).filter(c => {
    if (!c || !c.user) return false;
    const commenter = asKnown(c.user);
    // 陌生网友可以评论公开帖子；已知 char 必须认识作者（用户本人除外）
    if (commenter && !isUserAuthor && author && !SG.knows(author, commenter)) return false;
    if (c.toUser) {
      const target = asKnown(c.toUser);
      if (target && commenter && !SG.knows(commenter, target)) delete c.toUser;
    }
    return true;
  });
}

function parseCommentLines(raw) {
  const out = [];
  String(raw || '').replace(/```[a-zA-Z]*/g, '').split(/\r?\n/).forEach(line => {
    let s = line.trim().replace(/^\s*(?:\d+[.、)]|[-*·])\s*/, '');
    if (!s || /^(LIKES|点赞)\s*[:：]/i.test(s)) return;
    const parts = s.split(/[|｜]/);
    if (parts.length >= 3) {
      out.push({ user: parts[0].trim(), toUser: parts[1].trim(), text: parts.slice(2).join('|').trim() });
    } else if (parts.length === 2) {
      out.push({ user: parts[0].trim(), text: parts[1].trim() });
    } else {
      const m = s.match(/^([^：:|｜]{1,20})\s*[：:]\s*([\s\S]+)$/);
      if (m) out.push({ user: m[1].trim(), text: m[2].trim() });
    }
  });
  return out.filter(c => c.user && c.text);
}

function filterCommentList(list, authorName, allowedNames, existingNames) {
  const allowedList = [];
  (allowedNames || []).forEach(n => {
    const nm = (n && n.name) ? n.name : n;
    if (nm && allowedList.indexOf(nm) === -1) allowedList.push(nm);
  });
  if (authorName && allowedList.indexOf(authorName) === -1) allowedList.push(authorName);

  const targets = {};
  function addTarget(n) { if (n) targets[normName(n)] = n; }
  addTarget(authorName);
  addTarget(userProfile.name);
  (existingNames || []).forEach(addTarget);
  (list || []).forEach(c => { if (c && c.user) addTarget(c.user); });

  // 模型若写了不在名单里的名字，不直接丢弃内容，而是改挂到名单里的评论者，避免跑题兜底
  const spareNames = allowedList.filter(n =>
    normName(n) !== normName(userProfile.name) &&
    (!authorName || normName(n) !== normName(authorName))
  );
  const kept = [];
  (list || []).forEach((c, idx) => {
    if (!c || !c.user || !String(c.text || '').trim()) return;
    let canonUser = matchAllowed(c.user, allowedList);
    if (!canonUser) {
      if (!spareNames.length) return;
      canonUser = spareNames[idx % spareNames.length];
    }
    if (normName(canonUser) === normName(userProfile.name)) return;
    let text = String(c.text || '').trim();
    let to = c.toUser;
    if (!to) {
      const m = text.match(/^(?:回复|@)\s*([^\s：:，,、]{1,20})\s*[：:，,]?\s*([\s\S]+)$/);
      if (m) { to = m[1].trim(); text = m[2].trim(); }
    }
    const o = { user: canonUser, text: text };
    if (to) {
      const canonTo = matchAllowed(to, allowedList);
      const resolvedTo = targets[normName(to)] || (canonTo ? targets[normName(canonTo)] : null) || canonTo;
      if (resolvedTo && normName(resolvedTo) !== normName(canonUser)) o.toUser = resolvedTo;
    }
    kept.push(o);
  });
  return kept;
}

// 把「评论者|回复对象|内容」结果写入帖子的评论区（回复挂在被回复者的评论下）
function appendInteractions(post, parsed) {
  if (!post.comments) post.comments = [];
  const stamp = Date.now() + '_' + Math.floor(Math.random() * 9999);
  (parsed || []).forEach((c, i) => {
    if (!c || !c.user || !String(c.text || '').trim()) return;
    if (c.toUser && normName(c.toUser) !== normName(c.user)) return;
    post.comments.push({ id: stamp + '_t' + i, user: c.user, text: String(c.text).trim(), replies: [] });
  });
  (parsed || []).forEach((c, i) => {
    if (!c || !c.user || !String(c.text || '').trim()) return;
    if (!c.toUser || normName(c.toUser) === normName(c.user)) return;
    const to = c.toUser;
    let target = post.comments.find(x => normName(x.user) === normName(to));
    if (!target) target = post.comments.find(x => (x.replies || []).some(r => normName(r.user) === normName(to)));
    if (target) {
      if (!target.replies) target.replies = [];
      target.replies.push({ user: c.user, text: '回复 ' + to + '：' + String(c.text).trim() });
    } else {
      post.comments.push({ id: stamp + '_r' + i, user: c.user, text: String(c.text).trim(), replies: [] });
    }
  });
}

function formatCommentLine(c) {
  const base = c.user + '：' + c.text;
  const reps = (c.replies || []).map(r => '  ↳ ' + r.text).join(' ');
  return base + (reps ? ' ' + reps : '');
}

async function generateCommentsForPost(post, bound, npcs, strangers) {
  const pool = buildCommenterPool(post, bound, npcs, strangers);
  if (!pool.length) return 0;
  const persona = buildPersonaBlock((bound || []).concat(npcs || []).concat(strangers || []));
  const existing = (post.comments || []).map(formatCommentLine).join('\n');
  const existingNames = postParticipantNames(post);
  const newPool = pool.filter(n => !existingNames.some(x => normName(x) === normName(n)) && normName(n) !== normName(post.user));
  const userComments = (post.comments || []).filter(c =>
    normName(c.user) === normName(userProfile.name) ||
    (c.replies || []).some(r => normName(r.user) === normName(userProfile.name))
  );
  const hasUserComment = userComments.length > 0;
  const system = '你是一个真实的人类，请同时扮演多个角色以及平台上的普通网友，在社交平台评论区自然地聊天。严格贴合各自人设、关系与世界书，保持活人感，绝不 OOC，禁止 AI 腔，禁止解释，禁止出戏。所有角色均为成年人。' + ADULT_PLATFORM_NOTE;
  const userMsg = userPersonaBlock() + '\n\n' + persona +
    '\n\n【本帖子可以出现的评论者（只能使用这些名字，不要创造新名字）】\n' + pool.map(n => '· ' + n).join('\n') +
    '\n\n【这条帖子（所有评论必须紧扣它的具体内容，禁止跑题）】\n作者：' + post.user +
    '\n标题：' + (post.title || '（无标题）') + '\n正文：' + (post.body || '（无正文）') +
    ((post.tags && post.tags.length) ? ('\n话题：' + post.tags.map(t => '#' + t).join(' ')) : '') +
    (existing ? ('\n【已有评论（初始回复人，可继续回帖）】\n' + existing) : '') +
    (newPool.length ? ('\n【还没出现过的新回复人】\n' + newPool.map(n => '· ' + n).join('\n')) : '') +
    (hasUserComment ? ('\n【用户本人的评论（必须有人回复 TA）】\n' + userComments.map(c => '用户：' + c.text).join('\n')) : '') +
    '\n\n请生成 6~8 条新的评论互动（数量要够，不要只写两三条）：\n' +
    '- 每条评论都要针对上面帖子的标题/正文/话题来写，可以引用其中的具体词、细节或观点，绝对不要跑题；\n' +
    '- 必须包含发帖人「' + post.user + '」的评论，作者要回应评论区；\n' +
    (existingNames.length ? '- 必须包含「初始回复人」（上面已有评论里出现过的人）继续回帖；\n' : '') +
    (newPool.length ? '- 必须包含「新回复人」（上面的新回复人名单）加入讨论；\n' : '') +
    (hasUserComment ? ('- 必须至少 1 条回复用户本人（回复对象写「' + (userProfile.name || '用户') + '」），自然接住 TA 说的话；\n') : '') +
    '- 回复对象必须是这条帖子下真正发过言的人（作者或评论区里出现过的人）；\n' +
    '- 评论之间要有来有往、接话调侃、附和，符合各自人设与关系；\n' +
    '- 评论者只能从上面的名字里选，名字原样使用；严禁以用户身份发言；\n' +
    '- 每条不超过 25 字，口语化，像真人。\n\n' +
    '严格按下面格式输出（不要编号、不要解释）：\n评论者|回复对象|内容\n（不是回复别人时第二段留空，写成「评论者||内容」）';
  const raw = await callChatApi([{ role: 'system', content: system }, { role: 'user', content: userMsg }], 'sub');
  const parsed = filterInsKnownReplies(filterCommentList(parseCommentLines(raw), post.user, pool, existingNames), post, bound, npcs, strangers);
  if (!parsed.length) return 0;
  appendInteractions(post, parsed);
  return parsed.length;
}

// ==================== AI 生成帖子 ====================
function buildForumPrompt(chars, npcs, strangers, recent, opts) {
  opts = opts || {};
  const tag = opts.tag || '';
  const desc = opts.desc || '';
  const charList = (chars || []).filter(c => c && c.name);
  const npcList = (npcs || []).filter(c => c && c.name);
  const strangerList = (strangers || []).filter(c => c && c.name);
  const strangerCount = opts.strangerCount != null ? opts.strangerCount : 3;
  const count = opts.count != null ? opts.count
    : (Math.min(charList.length, 4) + strangerCount + (npcList.length ? 1 : 0));
  const persona = buildPersonaBlock(charList.concat(npcList).concat(strangerList));
  const lines = [];
  lines.push('这是一个开放的社交平台（类似 Instagram）。平台上不只有用户的好友，还有大量陌生网友在这里发帖和互动。');
  lines.push('请生成约 ' + count + ' 条帖子，每条自带 3~5 条初始评论：');
  lines.push('- 发帖人必须从上面列出的名字里选，名字原样使用；');
  if (charList.length) lines.push('- 已选角色每人至少 1 条（' + charList.map(c => c.name).join('、') + '）；');
  if (npcList.length) lines.push('- 可以再安排 1 条他们的朋友（NPC）的帖子；');
  if (strangerList.length) {
    lines.push('- 必须生成 ' + strangerCount + ' 条来自陌生网友的帖子（' + strangerList.map(s => s.name).join('、') +
      '），就是平台上和用户不认识的普通网友，内容要多元、有平台感；');
  }
  if (tag) lines.push('- 所有帖子都必须围绕话题 #' + tag + '，并把它写进 TAGS；');
  if (desc) lines.push('- 话题描述与方向（必须严格符合）：' + desc + '；');
  lines.push('- 文案像真人刷手机随手发的：口语、具体、有生活感，30~80 字；允许短句、碎碎念、吐槽、提问、玩梗、错别字和表情；不要写成旅行博主/广告文案/工作汇报，也不要每条都升华总结；');
  lines.push('- 每条帖子配 3~5 条初始评论，评论者只能从上面的名字里选，按各自人设与关系自然互动；评论像随手打字，可以只回一句、发表情、歪楼，不要客服腔；');
  lines.push('- 已知 char 之间只有明确关系（人设/世界书/角色关系/私聊记录）才能互相评论或接话；不认识的 char 不要出现在同一条评论区；同学、朋友、NPC、陌生网友可以自由评论公开帖子；');
  lines.push('- 评论者回复别人时写成「评论者|回复对象|内容」，不是回复则写成「评论者||内容」；');
  lines.push('- 严禁以用户身份发帖、点赞或评论；');
  lines.push('- 每条评论不超过 25 字。');
  try {
    const pairs = [];
    for (let i = 0; i < charList.length; i++) {
      for (let j = i + 1; j < charList.length; j++) {
        const a = charList[i], b = charList[j];
        if (!a || !b || !window.NanoSocialGraph || !NanoSocialGraph.knows(a, b)) continue;
        const lb = NanoSocialGraph.label ? NanoSocialGraph.label(a, b) : '';
        pairs.push(a.name + ' ↔ ' + b.name + (lb ? ('（' + lb + '）') : ''));
      }
    }
    lines.push('- 已知 char 关系：' + (pairs.length ? pairs.join('；') : '没有。绑定的 char 之间默认不互动') + '。');
  } catch (e) {}
  return ADULT_PLATFORM_NOTE + '\n' + SAFE_REWRITE_NOTE + '\n\n' + userPersonaBlock() + '\n\n' + persona +
    '\n\n【最近的帖子（可延续话题，别重复）】\n' + (recent || '（暂无）') +
    '\n\n' + lines.join('\n') +
    '\n\n严格按下面格式输出（不要 markdown、不要编号、不要多余解释）：\n' +
    '===POST===\nAUTHOR: 名字\nLOCATION: 地点（可留空）\nTITLE: 标题\nBODY: 正文\nTAGS: 话题1,话题2\nLIKES: 名字1,名字2（可留空）\nCOMMENT: 评论者|回复对象|内容\nCOMMENT: 评论者||内容\n\n（下一条帖子重复 ===POST=== 结构）';
}

function parseForumPosts(raw) {
  const text = String(raw || '').replace(/```[a-zA-Z]*/g, '');
  const blocks = text.split(/===\s*POST\s*===/i).map(s => s.trim()).filter(Boolean);
  const out = [];
  blocks.forEach(block => {
    const post = { author: '', location: '', title: '', body: '', tags: [], comments: [] };
    block.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*(AUTHOR|LOCATION|TITLE|BODY|TAGS|LIKES|COMMENT)\s*[:：]\s*(.*)$/i);
      if (!m) return;
      const key = m[1].toUpperCase();
      const val = m[2];
      if (key === 'AUTHOR') post.author = val.trim();
      else if (key === 'LOCATION') post.location = val.trim();
      else if (key === 'TITLE') post.title = val.trim();
      else if (key === 'BODY') post.body = val.trim();
      else if (key === 'TAGS') post.tags = val.split(/[,，、;；\/]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean);
      else if (key === 'LIKES') { /* 论坛赞数是数字，忽略名单 */ }
      else if (key === 'COMMENT') {
        const parts = val.split(/[|｜]/);
        if (parts.length >= 3) post.comments.push({ user: parts[0].trim(), toUser: parts[1].trim(), text: parts.slice(2).join('|').trim() });
        else if (parts.length === 2) post.comments.push({ user: parts[0].trim(), text: parts[1].trim() });
      }
    });
    if (post.author && (post.body || post.title)) out.push(post);
  });
  return out;
}

let lastForumRaw = '';

// 服务商安全策略/拒绝生成时，HTTP 往往仍是 200，但内容是拒绝说明
function detectProviderRefusal(text) {
  const t = String(text || '');
  if (!t.trim()) return '模型返回了空内容。';
  if (/Prohibited Use policy|sensitive words|could not be submitted|content policy|responsible AI|safety/i.test(t)) {
    return '请求被服务商的内容安全策略拒绝（不是格式问题）。\n' +
      '原因多半是角色人设 / 世界书 / 提示词里含有被判定为敏感的词。\n' +
      '建议：检查并改写人设或世界书里的敏感内容，或更换一个 API 再试。\n\n' +
      '服务商原话：' + t.slice(0, 300);
  }
  if (/^\s*(error|exception)\b/i.test(t) && t.length < 400) {
    return '服务商返回了错误信息：\n' + t.slice(0, 300);
  }
  return '';
}

async function requestForumPosts(chars, npcs, strangers, recent, opts) {
  const system = '你是一个真实的人类，请同时扮演下面列出的角色、他们的朋友，以及平台上的陌生网友，在开放的社交平台上发帖并自然地互相评论互动。严格贴合各自人设、彼此关系与世界书，保持活人感，绝不 OOC，禁止 AI 腔，禁止解释，禁止出戏。所有角色均为成年人。' + ADULT_PLATFORM_NOTE;
  const userMsg = buildForumPrompt(chars, npcs, strangers, recent, opts);
  let raw = await callChatApi([{ role: 'system', content: system }, { role: 'user', content: userMsg }], 'main');
  lastForumRaw = String(raw || '');
  let refused = detectProviderRefusal(lastForumRaw);
  if (refused && !/===POST===/i.test(lastForumRaw)) {
    // 被内容过滤时，按合规方向收紧提示后重试一次
    try {
      raw = await callChatApi([
        { role: 'system', content: system + '\n' + SAFE_REWRITE_NOTE },
        { role: 'user', content: userMsg + '\n\n' + SAFE_REWRITE_NOTE }
      ], 'main');
      lastForumRaw = String(raw || '');
      refused = detectProviderRefusal(lastForumRaw);
    } catch (e) { throw e; }
  }
  if (refused && !/===POST===/i.test(lastForumRaw)) throw new Error(refused);
  return parseForumPosts(raw);
}

// 生成无效时给出可诊断的说明
function explainInvalidPosts(parsed, allowedObjs) {
  const raw = lastForumRaw || '';
  if (!parsed.length) {
    return '模型没有按要求的格式返回帖子，无法解析出任何一条。\n\n' +
      '要求格式：每条以 ===POST=== 开头，包含 AUTHOR / BODY 等字段。\n\n' +
      '模型原始返回（截断到 600 字）：\n' + (raw.slice(0, 600) || '（空）');
  }
  const authors = parsed.map(p => p.author).filter(Boolean);
  const allowed = (allowedObjs || []).map(c => c && c.name).filter(Boolean);
  return '解析出了帖子，但发帖人不在允许的名单里，所以被丢弃。\n\n' +
    '模型给出的作者：' + (authors.join('、') || '（无）') + '\n' +
    '允许的作者：' + (allowed.join('、') || '（无）');
}

function buildPostsFromParsed(parsed, chars, npcs, strangers, opts) {
  opts = opts || {};
  const made = [];
  const allowedNames = (chars || []).concat(npcs || []).concat(strangers || []).map(c => c && c.name).filter(Boolean);
  (parsed || []).forEach((p, i) => {
    const author = resolveAuthor(p.author, chars, npcs, strangers);
    if (!author || normName(author.name) === normName(userProfile.name)) return;
    let tags = (p.tags || []).map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);
    if (opts.forceTag && tags.indexOf(opts.forceTag) === -1) tags.unshift(opts.forceTag);
    if (!tags.length) tags = opts.forceTag ? [opts.forceTag] : ['随笔'];
    const hasImg = Math.random() > 0.45;
    const post = {
      id: Date.now() + i + Math.floor(Math.random() * 999),
      user: author.name,
      location: p.location || author.location || '',
      image: hasImg ? makeTextImage(p.title || p.body || '记录') : null,
      likes: Math.floor(Math.random() * 600) + 20,
      title: p.title || '',
      body: p.body || '',
      tags: tags,
      comments: []
    };
    const comments = filterCommentList(p.comments || [], author.name, allowedNames, []);
    appendInteractions(post, comments);
    made.push(post);
  });
  return made;
}

// 用户自己发的、还没人评论的帖子，补上 AI 互动
async function backfillUserPostComments(selected, npcs, strangers) {
  if ((!selected || !selected.length) && (!npcs || !npcs.length) && (!strangers || !strangers.length)) return;
  const targets = posts.filter(p => {
    if (normName(p.user) !== normName(userProfile.name)) return false;
    return (p.comments || []).filter(c => normName(c.user) !== normName(userProfile.name)).length === 0;
  }).slice(0, 2);
  for (const p of targets) {
    try { await generateCommentsForPost(p, selected, npcs, strangers); } catch (e) {}
  }
  if (targets.length) {
    saveInsChatState();
    renderFeed();
    if (currentPost && targets.indexOf(currentPost) > -1) renderDetail();
  }
}

// ==================== 论坛刷新（先选角色，再生成帖子） ====================
function openForumRefreshPicker() {
  const bound = getSelectableChars();
  if (!bound.length) { showToast('请先绑定角色再刷新帖子'); return; }
  const listEl = document.getElementById('forumRefreshCharList');
  const modal = document.getElementById('forumRefreshModal');
  if (!listEl || !modal) { runForumGenerate(bound); return; }
  listEl.innerHTML = '';
  bound.forEach(c => {
    const row = document.createElement('label');
    row.className = 'refresh-char-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = String(c.id || c.name); cb.checked = true;
    const nm = document.createElement('span');
    nm.className = 'refresh-char-name'; nm.textContent = c.name;
    row.appendChild(cb); row.appendChild(nm);
    listEl.appendChild(row);
  });
  modal.classList.add('show');
}

function confirmForumRefresh() {
  const ids = Array.prototype.slice.call(
    document.querySelectorAll('#forumRefreshCharList input[type="checkbox"]:checked')
  ).map(i => i.value);
  const modal = document.getElementById('forumRefreshModal');
  if (modal) modal.classList.remove('show');
  const bound = getSelectableChars();
  let picked = bound.filter(c => ids.indexOf(String(c.id || c.name)) > -1);
  if (!picked.length) picked = bound;
  runForumGenerate(picked);
}

async function runForumGenerate(selected) {
  if (insBusy.forum) { showToast('正在生成中，请稍候…'); return; }
  const boundAll = getSelectableChars();
  const picked = (selected && selected.length) ? selected : boundAll;
  if (!picked.length) { showToast('请先绑定角色再刷新帖子'); return; }
  insBusy.forum = true;
  try{ if(window.NanoRefresh) NanoRefresh.start({ key:'ins-forum', label:'刷新帖子' }); }catch(e){}
  showLoading('正在生成帖子…');
  try {
    // NPC 每次随机：重新生成一小批关系人物（失败则沿用已有池）
    try { await generateNpcRoster(picked, 6); } catch (e) {}
    const npcs = pickNpcs(2 + Math.floor(Math.random() * 2));
    // 开放平台：再准备一批陌生网友，并挑 3 位发帖
    const exclude = picked.map(c => c.name).concat(npcs.map(n => n.name));
    await ensureStrangerRoster(picked, 8, exclude);
    const strangers = pickStrangers(3, []);

    const recent = posts.slice(0, 5).map(p => '· ' + p.user + '：' + (p.title || p.body || '')).join('\n');
    let parsed = [];
    try {
      parsed = await requestForumPosts(picked, npcs, strangers, recent, { strangerCount: 3 });
    } catch (e) {
      showError('帖子生成失败', '调用文本 API 出错：\n' + (e && e.message ? e.message : String(e)));
      try{ if(window.NanoRefresh) NanoRefresh.fail(e, { key:'ins-forum' }); }catch(err){}
      return;
    }
    if (!parsed.length) {
      showError('没有生成有效帖子', explainInvalidPosts(parsed, picked.concat(npcs, strangers)));
      try{ if(window.NanoRefresh) NanoRefresh.fail('没有生成有效帖子', { key:'ins-forum' }); }catch(err){}
      return;
    }
    if (picked.length >= 2) {
      const covered = {};
      parsed.forEach(p => { const c = findCharByName(picked, p.author); if (c) covered[normName(c.name)] = 1; });
      if (Object.keys(covered).length < Math.min(2, picked.length)) {
        const missing = picked.filter(c => !covered[normName(c.name)]);
        try {
          const more = await requestForumPosts(missing, [], [], recent, { count: missing.length, onlyChars: true });
          parsed = parsed.concat(more);
        } catch (e) {}
      }
    }
    const made = buildPostsFromParsed(parsed, picked, npcs, strangers, {}).slice(0, 8);
    const allowedAll = picked.concat(npcs, strangers);
    if (!made.length) { showError('帖子作者无法匹配', explainInvalidPosts(parsed, allowedAll)); try{ if(window.NanoRefresh) NanoRefresh.fail('帖子作者无法匹配', { key:'ins-forum' }); }catch(err){} return; }
    await maybeGeneratePostImages(made, 'forum');
    posts = made.concat(posts);
    saveInsChatState();
    renderFeed(); renderProfileGrid();
    await backfillUserPostComments(picked, npcs, strangers);
    saveInsChatState();
    showToast('已生成 ' + made.length + ' 条帖子');
    notifyInsDone('Instagram', '帖子刷新完成，新增 ' + made.length + ' 条');
    try{ if(window.NanoRefresh) NanoRefresh.success('已新增 ' + made.length + ' 条帖子，点「去看看」查看', { key:'ins-forum' }); }catch(e){}
  } finally {
    insBusy.forum = false;
    hideLoading();
  }
}

// ==================== 私信刷新 ====================
function pickRandom(arr, n) {
  const a = (arr || []).slice();
  const out = [];
  while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  return out;
}

async function buildIncomingDM(name, setting, recent, charId) {
  let sys = '你正在扮演一个真实的人，在社交 App 上给好友发私信。贴合人设与关系，口语化、自然，像真人发微信。' + ADULT_PLATFORM_NOTE;
  // 与线上私聊 / Halo / iMessage 共用同一份长期记忆和世界书
  try {
    if (window.NanoMemLink && charId) {
      const list = await window.NanoMemLink.readList(charId);
      const mem = (list || []).filter(x => x && !x.groupId && (x.content || x.text)).slice(-24)
        .map(x => (x.type ? '【' + x.type + '】' : '') + (x.content || x.text)).join('\n');
      if (mem) sys += '\n【长期记忆 · 你与对方共同经历 / 已知的事】\n' + mem;
    }
    if (charId) {
      const wb = loadWorldbookText([charId]);
      if (wb) sys += '\n【世界书】\n' + wb;
    }
  } catch (e) {}
  let emojiNames = [];
  try { emojiNames = await getInsEmojiNames(); } catch (e) {}
  let emojiHint = '';
  if (emojiNames.length) {
    emojiHint = '\n你也可以在文字之后另起一行，用 [emoji:表情名称] 发一张表情包（最多一张）。可用名称：' +
      emojiNames.slice(0, 80).join('、') + '。名称必须与列表完全一致。';
  }
  const userMsg = '你的名字：' + name + '\n' +
    (setting ? ('你的人设：' + String(setting).slice(0, 500) + '\n') : '') +
    (userPersonaBlock() ? (userPersonaBlock() + '\n') : '') +
    '你正在给「' + userProfile.name + '」发一条主动私信。\n' +
    (recent ? ('最近的聊天记录：\n' + recent + '\n') : '') +
    '请输出这条私信内容（1~2 句，30 字内），不要引号、不要旁白、不要解释。' + emojiHint;
  try {
    const out = await callChatApi([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 'sub');
    const t = String(out || '').trim().replace(/^["「『]|["」』]$/g, '');
    if (t) return t.slice(0, 160);
  } catch (e) {}
  return '';
}

async function refreshFriendDMs(silent) {
  if (!friends.length) return 0;
  const picked = pickRandom(friends, Math.min(3, friends.length));
  let count = 0;
  for (const f of picked) {
    const char = currentUserChars.find(c => c.id === f.id || c.name === f.name) || {};
    const hist = chatHistories[f.id] || [];
    const recent = hist.filter(m => m.type !== 'post').slice(-6)
      .map(m => (m.from === 'out' ? userProfile.name : f.name) + '：' + (m.text || ''))
      .filter(Boolean).join('\n');
    const text = await buildIncomingDM(f.name, char.setting || '', recent, char.id || f.id);
    let preview = await deliverIncoming(f.id, text);
    const st = await maybePushSticker(f.id, 0.4);
    if (st) preview = st;
    f.preview = preview.slice(0, 40);
    f.time = '刚刚';
    count++;
  }
  saveInsChatState();
  if (!silent) renderDMList();
  return count;
}

function parseStrangers(raw, exclude) {
  const text = String(raw || '').replace(/```[a-zA-Z]*/g, '').trim();
  let arr = null;
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { arr = JSON.parse(m[0]); } catch (e) { arr = null; } }
  if (!Array.isArray(arr)) {
    // 兼容模型返回 {"strangers":[...]} / {"list":[...]} 这类对象
    try {
      const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      arr = (o && (o.strangers || o.list || o.data || o.items || o.result)) || null;
    } catch (e) { arr = null; }
  }
  const ex = (exclude || []).map(normName);
  const seen = {};
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach(n => {
    if (!n) return;
    const name = String(n.name || '').trim();
    const message = String(n.message || n.text || '').trim();
    if (!name || !message) return;
    if (isGenericNpcName(name)) return;
    if (normName(name) === normName(userProfile.name)) return;
    if (ex.indexOf(normName(name)) > -1 || seen[normName(name)]) return;
    seen[normName(name)] = 1;
    out.push({ name: name, message: message.slice(0, 120), setting: String(n.setting || '').trim(), gender: String(n.gender || '').trim() });
  });
  return out.slice(0, 6);
}

async function refreshStrangerDMs(silent, count) {
  const wantCount = Math.max(1, parseInt(count, 10) || 6);
  const myPosts = posts.filter(p => p.user === userProfile.name);
  const bound = getSelectableChars();
  const persona = buildPersonaBlock(bound.slice(0, 3));
  const userSetting = userProfile.setting || userProfile.bio || '';
  const userPersona = userSetting ? ('【用户本人的人设】\n' + String(userSetting).slice(0, 600) + '\n') : '';
  const postText = myPosts.slice(0, 3).map(p => '· ' + (p.title || '') + ' ' + (p.body || '')).join('\n');
  const exclude = friends.map(f => f.name).concat(strangers.map(s => s.name));

  let emojiNames = [];
  try { emojiNames = await getInsEmojiNames(); } catch (e) {}
  const emojiHint = emojiNames.length
    ? ('- 可以在 message 末尾用 [emoji:表情名称] 附带一张表情包，可用名称：' + emojiNames.slice(0, 80).join('、') + '；\n')
    : '';

  const sys = '你是一个社交论坛的陌生用户群体。请扮演多个真实感的陌生人，他们在论坛上看到用户后主动发私信。贴合用户的人设与世界书，口语化、自然，不要 AI 腔。所有人物均为成年人。' + ADULT_PLATFORM_NOTE;
  const userMsg = userPersona + persona +
    '\n\n【用户发的帖子】\n' + (postText || '（用户还没有发过帖子）') +
    '\n\n请生成 ' + wantCount + ' 个不同的陌生人给「' + userProfile.name + '」发的私信。\n' +
    '要求：\n' +
    '- 名字必须是真实感强的具体人名（中文角色用中文名，外国角色用该国真实姓名），不要「陌生人、网友、路人、新朋友」这类占位名；\n' +
    (postText ? '- 私信内容要自然提到或回应上面的某条帖子；\n' : '- 用户没有发帖，请根据用户人设编一个自然的搭讪/私信理由；\n') +
    '- 每个陌生人的私信不超过 30 字；\n' +
    emojiHint +
    '- 不要与这些已有名字重复：' + (exclude.join('、') || '（无）') + '。\n' +
    '- 支持陌生人【主动】加用户好友/微信：不必等用户开口，自然时可以主动提出（例如“加个微信吧”），并在该消息末尾加 [加好友]（系统会向用户发起好友申请，用户在 Meet 同意后即可私聊）；偶尔出现即可。\n\n' +
    '严格输出 JSON 数组（不要 markdown、不要解释）：[{"name":"名字","gender":"男","setting":"一句话身份/性格","message":"私信内容"}]';

  let newOnes = [];
  try {
    const raw = await callChatApi([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 'sub');
    newOnes = parseStrangers(raw, exclude);
  } catch (e) { throw e; }   // 失败就是失败：把错误抛给上层提示，不静默吞掉
  if (!newOnes.length) throw new Error('这次没有生成陌生人，请重试（可能是接口返回格式异常）');

  for (let i = 0; i < newOnes.length; i++) {
    const s = newOnes[i];
    const id = 's_' + Date.now() + '_' + i + '_' + Math.floor(Math.random() * 999);
    const stranger = {
      id: id, name: s.name, handle: '@' + normName(s.name).toLowerCase(),
      preview: s.message, time: '刚刚', verified: false,
      setting: s.setting || '', gender: s.gender || ''
    };
    strangers.push(stranger);
    chatHistories[id] = [];
    const preview = await deliverIncoming(id, s.message);
    const st = await maybePushSticker(id, 0.5);
    stranger.preview = (st || preview).slice(0, 40);
  }
  strangers = strangers.slice(0, 40);
  saveInsChatState();
  if (!silent) renderDMList();
  return newOnes.length;
}

// ==================== 个人主页 ====================
function renderProfileGrid() {
  const grid = document.getElementById('profileGrid');
  if (!grid) return;
  const renderThumb = (p, from) => {
    if (p.image) return `<img src="${p.image}" data-fb="${escapeHtml((p.title || p.body || '记录').slice(0, 40))}" onerror="insImgFallback(this)" onclick="openDetail(${p.id},'${from}')">`;
    return `<div class="text-thumb" onclick="openDetail(${p.id},'${from}')">${(p.title || p.body || '').slice(0, 40)}</div>`;
  };
  if (profileTab === 'posts') {
    const myPosts = posts.filter(p => p.user === userProfile.name);
    grid.innerHTML = myPosts.length ? myPosts.map(p => renderThumb(p, 'profile')).join('') : '<div class="profile-empty">还没有发布帖子</div>';
    document.getElementById('statPosts').textContent = myPosts.length;
  } else {
    const saved = posts.filter(p => savedPosts.includes(p.id));
    grid.innerHTML = saved.length ? saved.map(p => renderThumb(p, 'profile')).join('') : '<div class="profile-empty">还没有收藏帖子</div>';
  }
}

function switchProfileTab(tab) {
  profileTab = tab;
  document.getElementById('tabPosts').classList.toggle('active', tab === 'posts');
  document.getElementById('tabSaved').classList.toggle('active', tab === 'saved');
  renderProfileGrid();
}

// ==================== 我的主页 · 更多（生图设置 / 清空内容） ====================
function openProfileMenu() {
  loadImageSettings();
  const setChecked = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  setChecked('pmImgEnabled', insImageSettings.enabled);
  setChecked('pmNpcImg', insImageSettings.npc);
  setChecked('pmStrangerImg', insImageSettings.stranger);
  const listEl = document.getElementById('pmCharList');
  if (listEl) {
    const chars = getSelectableChars();
    listEl.innerHTML = '';
    if (!chars.length) {
      listEl.innerHTML = '<div class="pm-empty">暂无绑定角色</div>';
    } else {
      chars.forEach(c => {
        const id = String(c.id || c.name);
        const row = document.createElement('div');
        row.className = 'pm-char-row' + (insImageSettings.chars.indexOf(id) > -1 ? ' on' : '');
        const av = document.createElement('div');
        av.className = 'pm-avatar';
        if (charAvatarMap[c.name]) {
          av.textContent = '';
          av.style.backgroundImage = "url('" + charAvatarMap[c.name] + "')";
          av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center';
        } else {
          av.style.background = colorBg(c.name);
          av.textContent = letterOf(c.name);
        }
        const nm = document.createElement('div');
        nm.className = 'grow'; nm.textContent = c.name;
        const ck = document.createElement('div');
        ck.className = 'pm-check';
        ck.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg>';
        row.appendChild(av); row.appendChild(nm); row.appendChild(ck);
        row.addEventListener('click', function () {
          const on = insImageSettings.chars.indexOf(id) > -1;
          if (on) insImageSettings.chars = insImageSettings.chars.filter(x => x !== id);
          else insImageSettings.chars.push(id);
          row.classList.toggle('on', !on);
          saveImageSettings();
        });
        listEl.appendChild(row);
      });
    }
  }
  document.getElementById('profileMenuModal').classList.add('show');
}

let clearArmed = false;
function clearContent() {
  const label = document.getElementById('pmClearLabel');
  if (!clearArmed) {
    clearArmed = true;
    if (label) label.textContent = '再点一次确认清空';
    setTimeout(() => {
      clearArmed = false;
      if (label) label.textContent = '清空内容（帖子）';
    }, 2600);
    return;
  }
  clearArmed = false;
  if (label) label.textContent = '清空内容（帖子）';
  posts = [];
  savedPosts = [];
  saveInsChatState();
  renderFeed(); renderProfileGrid();
  if (document.getElementById('tagResult').classList.contains('active')) renderTagResult();
  if (document.getElementById('charProfile').classList.contains('active')) renderCharProfileView();
  closeModal('profileMenuModal');
  showToast('已清空帖子');
}

// ==================== 人物主页 ====================
function openCharProfile(name, from) {
  if (!name) return;
  if (normName(name) === normName(userProfile.name)) { go('profile'); return; }
  const active = document.querySelector('.page.active');
  charProfileFrom = from || (active ? active.id : 'home');
  charProfileName = name;
  go('charProfile');
}

function charProfileAvatarHTML(name) {
  const av = charAvatarMap[name] || '';
  if (av) {
    return `<div class="letter-avatar xl char-profile-avatar" style="background-image:url('${String(av).replace(/'/g, '%27')}');background-size:cover;background-position:center;color:transparent">${letterOf(name)}</div>`;
  }
  return `<div class="letter-avatar xl ${colorFor(name)} char-profile-avatar">${letterOf(name)}</div>`;
}

function renderCharProfileView() {
  const name = charProfileName;
  if (!name) return;
  const avWrap = document.getElementById('charProfileAvatarWrap');
  if (avWrap) avWrap.innerHTML = charProfileAvatarHTML(name);
  const nameEl = document.getElementById('charProfileName');
  if (nameEl) nameEl.textContent = name;
  const char = currentUserChars.find(c => normName(c.name) === normName(name)) ||
    findNpcByName(generateContextNPCs(), name) ||
    findStrangerByName(name) || {};
  const bioEl = document.getElementById('charProfileBio');
  if (bioEl) {
    const sig = shortSignature(char.setting || char.bio || '') || '这个人很神秘。';
    bioEl.innerHTML = '<b>' + escapeHtml(name) + '</b><br>' + escapeHtml(sig);
  }
  const act = document.getElementById('charProfileActions');
  if (act) {
    const followed = followedUsers.some(u => normName(u) === normName(name));
    act.innerHTML =
      '<button class="cp-btn cp-follow' + (followed ? ' followed' : '') + '" data-follow="' + escapeHtml(name) + '">' + (followed ? '已关注' : '关注') + '</button>' +
      '<button class="cp-btn cp-msg" data-dm="' + escapeHtml(name) + '">私信</button>';
  }
  const myPosts = posts.filter(p => p.user === name);
  const stat = document.getElementById('charStatPosts');
  if (stat) stat.textContent = myPosts.length;
  const grid = document.getElementById('charProfileGrid');
  if (!grid) return;
  if (!myPosts.length) { grid.innerHTML = '<div class="profile-empty">还没有发布帖子</div>'; return; }
  grid.innerHTML = myPosts.map(p => {
    if (p.image) return `<img src="${p.image}" data-fb="${escapeHtml((p.title || p.body || '记录').slice(0, 40))}" onerror="insImgFallback(this)" onclick="openDetail(${p.id},'charProfile')">`;
    return `<div class="text-thumb" onclick="openDetail(${p.id},'charProfile')">${escapeHtml((p.title || p.body || '').slice(0, 40))}</div>`;
  }).join('');
}

function charProfileBack() {
  const from = charProfileFrom;
  if (from === 'detail') { go('detail'); renderDetail(); return; }
  if (from === 'tagResult') { go('tagResult'); return; }
  if (from === 'search') { go('search'); return; }
  if (from === 'profile') { go('profile'); return; }
  if (from === 'chat') { go('chat'); return; }
  if (from === 'dm') { go('dm'); return; }
  go('home');
}

function toggleFollowUser(name) {
  if (!name) return;
  const key = normName(name);
  if (followedUsers.some(u => normName(u) === key)) {
    followedUsers = followedUsers.filter(u => normName(u) !== key);
    showToast('已取消关注 ' + name);
  } else {
    followedUsers.push(name);
    showToast('已关注 ' + name);
  }
  saveInsChatState();
  renderCharProfileView();
}

function startChatWith(name) {
  if (!name) return;
  const existing = friends.concat(strangers).find(u => normName(u.name) === normName(name));
  if (existing) {
    openChat(existing.id, existing.name, existing.handle, existing.verified,
      strangers.some(s => s.id === existing.id) ? 'stranger' : 'friend');
    return;
  }
  const char = currentUserChars.find(c => normName(c.name) === normName(name)) ||
    findNpcByName(generateContextNPCs(), name) ||
    findStrangerByName(name) || {};
  // 陌生网友放在“其他”页；好友（绑定的角色）放在“好友”页
  const isStranger = !!findStrangerByName(name) ||
    !currentUserChars.some(c => c && normName(c.name) === normName(name));
  const handle = '@' + normName(name).toLowerCase();
  const entry = {
    id: '', name: name, handle: handle, preview: '开始聊天吧', time: '刚刚',
    verified: false, setting: char.setting || '', gender: char.gender || ''
  };
  if (isStranger) {
    entry.id = 's_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    strangers.push(entry);
    strangers = strangers.slice(0, 40);
  } else {
    entry.id = 'f_' + Date.now() + '_' + Math.floor(Math.random() * 999);
    friends.push(entry);
  }
  chatHistories[entry.id] = [];
  saveInsChatState();
  renderDMList();
  switchDmTab(isStranger ? 'strangers' : 'friends');
  openChat(entry.id, name, handle, false, isStranger ? 'stranger' : 'friend');
}

// ==================== 编辑资料 ====================
function buildColorPicker() {
  const wrap = document.getElementById('avatarColors'); wrap.innerHTML = '';
  COLOR_OPTIONS.forEach(opt => {
    const d = document.createElement('div');
    d.className = 'color-dot' + (opt.key === pendingAvatarColor ? ' selected' : '');
    d.style.background = opt.style;
    d.onclick = () => { pendingAvatarColor = opt.key; pendingAvatarImage = null; buildColorPicker(); updateEditPreview(); };
    wrap.appendChild(d);
  });
}

function updateEditPreview() {
  const el = document.getElementById('editAvatarPreview');
  const opt = COLOR_OPTIONS.find(o => o.key === pendingAvatarColor) || COLOR_OPTIONS[0];
  if (pendingAvatarImage) {
    el.style.backgroundImage = `url('${pendingAvatarImage}')`;
    el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = '';
  } else {
    el.style.backgroundImage = ''; el.style.background = opt.style; el.style.color = '#fff';
    el.textContent = letterOf(document.getElementById('editName').value || userProfile.name);
  }
}

function openEditProfile() {
  pendingAvatarColor = userProfile.avatarColor || 'me';
  pendingAvatarImage = userProfile.avatarImage;
  document.getElementById('editName').value = userProfile.name;
  document.getElementById('editBio').value = userProfile.bio;
  buildColorPicker(); updateEditPreview();
  document.getElementById('editModal').classList.add('show');
}

function closeEditProfile() { document.getElementById('editModal').classList.remove('show'); }

function saveEditProfile() {
  const name = document.getElementById('editName').value.trim() || userProfile.name;
  const bio = document.getElementById('editBio').value.trim();
  userProfile.name = name; userProfile.bio = bio;
  userProfile.avatarColor = pendingAvatarColor; userProfile.avatarImage = pendingAvatarImage;
  closeEditProfile(); refreshUserUI(); showToast('资料已保存');
  writeBackToMask();
}

function writeBackToMask() {
  try {
    const home = readHomeData();
    if (!home || !userProfile.id) return;
    const idx = (home.masks || []).findIndex(m => m.id === userProfile.id);
    if (idx > -1) {
      home.masks[idx].name = userProfile.name;
      home.masks[idx].signature = userProfile.bio;  // 个性签名，不是人设
      localStorage.setItem(MASK_HOME_KEY, JSON.stringify(home));
    }
  } catch (e) {}
}

document.getElementById('editName').addEventListener('input', updateEditPreview);

function triggerAvatarUpload() { document.getElementById('avatarUploadInput').click(); }

function onAvatarPicked(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    pendingAvatarImage = ev.target.result;
    pendingAvatarColor = userProfile.avatarColor || 'me';
    if (document.getElementById('editModal').classList.contains('show')) { updateEditPreview(); buildColorPicker(); }
    else { userProfile.avatarImage = ev.target.result; refreshUserUI(); showToast('头像已更新'); }
  };
  reader.readAsDataURL(f); e.target.value = '';
}

function refreshUserUI() {
  const l = letterOf(userProfile.name);
  const opt = COLOR_OPTIONS.find(o => o.key === userProfile.avatarColor) || COLOR_OPTIONS[0];
  ['profileAvatarLetter', 'navAvatarLetter', 'commentAvatarLetter', 'storyAvatar'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    if (userProfile.avatarImage) {
      el.textContent = ''; el.style.backgroundImage = `url('${userProfile.avatarImage}')`;
      el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center';
    } else {
      el.textContent = l; el.style.backgroundImage = ''; el.style.background = opt.style; el.style.color = '#fff';
    }
  });
  const sig = userProfile.bio || '这个人很懒，还没有写签名。';
  document.getElementById('profileBio').innerHTML = '<b>' + escapeHtml(userProfile.name) + '</b><br>' + escapeHtml(sig).replace(/\n/g, '<br>');
  renderProfileGrid(); renderFeed();
}

// ==================== 发布 ====================
function switchPublishTab(tab) {
  document.getElementById('tabImagePost').classList.toggle('active', tab === 'image');
  document.getElementById('tabTextPost').classList.toggle('active', tab === 'text');
  document.getElementById('paneImage').classList.toggle('active', tab === 'image');
  document.getElementById('paneText').classList.toggle('active', tab === 'text');
}

function previewImage(e) {
  const f = e.target.files[0]; if (!f) return;
  const img = document.getElementById('preview');
  img.removeAttribute('src');
  const reader = new FileReader();
  reader.onload = async function (ev) {
    let d = String(ev.target.result || '');
    try { d = await shrinkDataURL(d, 1440, 0.85); } catch (err) {}
    img.src = d; img.style.display = 'block';
    document.getElementById('mediaPick').style.display = 'none';
  };
  reader.onerror = function () { showToast('图片读取失败，请换一张'); };
  reader.readAsDataURL(f);
}

function handleTagKey(e, which) {
  const arr = which === 'image' ? tagsImage : tagsText;
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const v = e.target.value.trim().replace(/^#/, '');
    if (v && !arr.includes(v)) { arr.push(v); renderTags(which); }
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && arr.length) {
    arr.pop(); renderTags(which);
  }
}

function renderTags(which) {
  const wrap = document.getElementById(which === 'image' ? 'tagWrapImage' : 'tagWrapText');
  const input = document.getElementById(which === 'image' ? 'tagInputImage' : 'tagInputText');
  const arr = which === 'image' ? tagsImage : tagsText;
  wrap.querySelectorAll('.tag-pill').forEach(p => p.remove());
  arr.forEach((t, i) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = '#' + t + ' <span class="x">×</span>';
    pill.querySelector('.x').onclick = () => { arr.splice(i, 1); renderTags(which); };
    wrap.insertBefore(pill, input);
  });
}

function publishPost(type) {
  if (type === 'text') {
    const title = document.getElementById('textTitle').value.trim();
    const body = document.getElementById('textBody').value.trim();
    if (!title && !body) { showToast('请填写标题或正文'); return; }
    const newPost = { id: Date.now(), user: userProfile.name, location: '我的位置', image: null, likes: 0, title: title, body: body, tags: tagsText.slice(), comments: [] };
    posts.unshift(newPost);
    saveInsChatState();
    renderFeed(); profileTab = 'posts'; switchProfileTab('posts');
    document.getElementById('textTitle').value = ''; document.getElementById('textBody').value = '';
    tagsText = []; renderTags('text');
    showToast('发布成功！'); setTimeout(() => go('home'), 400);
  } else {
    const title = document.getElementById('postTitle').value.trim();
    const text = document.getElementById('postText').value.trim();
    const fileInput = document.getElementById('mediaInput');
    const previewImg = document.getElementById('preview');
    if (!fileInput.files.length && !previewImg.src) { showToast('请选择图片或生成文字图'); return; }
    if (fileInput.files.length && !previewImg.src) { showToast('图片还在读取中，请稍候…'); return; }
    const newPost = { id: Date.now(), user: userProfile.name, location: '我的位置', image: previewImg.src, likes: 0, title: title, body: text, tags: tagsImage.slice(), comments: [] };
    posts.unshift(newPost);
    saveInsChatState();
    renderFeed(); profileTab = 'posts'; switchProfileTab('posts');
    document.getElementById('postTitle').value = ''; document.getElementById('postText').value = '';
    document.getElementById('preview').style.display = 'none'; document.getElementById('preview').src = '';
    document.getElementById('mediaPick').style.display = 'flex'; fileInput.value = '';
    tagsImage = []; renderTags('image');
    showToast('发布成功！'); setTimeout(() => go('home'), 400);
  }
}

// 把标题/正文生成一张白底黑字的方形文字图，作为图片 Post
function useTextImagePost() {
  const title = document.getElementById('postTitle').value.trim();
  const text = document.getElementById('postText').value.trim();
  if (!title && !text) { showToast('请先填写标题或正文'); return; }
  const img = document.getElementById('preview');
  img.src = makeTextImage(title ? (title + ' ' + text).trim() : text);
  img.style.display = 'block';
  document.getElementById('mediaPick').style.display = 'none';
  showToast('已生成文字图');
}

// ==================== 搜索 / Tag ====================
function handleSearchKey(e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } }

function doSearch() {
  const v = document.getElementById('searchInput').value.trim().replace(/^#/, '');
  if (!v) { showToast('请输入 tag'); return; }
  document.getElementById('searchInput').value = '';
  openTagResult(v);
}

function openTagResult(tag) {
  currentTag = tag;
  currentTagDesc = getTagDesc(tag);
  document.getElementById('tagResultTitle').textContent = '#' + tag;
  const descEl = document.getElementById('tagResultDesc');
  if (descEl) {
    descEl.textContent = currentTagDesc || '';
    descEl.style.display = currentTagDesc ? 'block' : 'none';
  }
  renderTagResult();
  go('tagResult');
}

function renderTagResult() {
  const list = document.getElementById('tagResultList');
  const matched = posts.filter(p => p.tags && p.tags.includes(currentTag));
  if (!matched.length) {
    list.innerHTML = '<div class="tag-empty">还没有相关帖子<br><span style="font-size:12px;color:#ccc">点右上角刷新生成</span></div>';
    return;
  }
  list.innerHTML = matched.map(p => `
    <article class="post" data-post-id="${p.id}">
      <div class="post-head">
        ${avatarHTML(p.user, '', '', true)}
        <div class="user-meta" onclick="openDetail(${p.id},'tag')">
          <div class="username">${p.user}</div>
          <div class="location">${p.location}</div>
        </div>
        <button class="more" onclick="event.stopPropagation();openMenu(${p.id})">•••</button>
      </div>
      ${postInnerHTML(p)}
    </article>
  `).join('');
}

async function refreshTagResult() {
  if (!currentTag) return;
  if (insBusy.tag) { showToast('正在生成中，请稍候…'); return; }
  insBusy.tag = true;
  currentTagDesc = getTagDesc(currentTag);
  showLoading('正在生成 #' + currentTag + ' 的帖子…');
  try {
    const bound = getSelectableChars();
    let npcs = pickNpcs(2 + Math.floor(Math.random() * 2));
    if (!npcs.length && bound.length) {
      try { await generateNpcRoster(bound); npcs = pickNpcs(2); } catch (e) {}
    }
    // 开放平台：话题下大量陌生网友参与
    const exclude = bound.map(c => c.name).concat(npcs.map(n => n.name));
    await ensureStrangerRoster(bound, 10, exclude);
    const strangers = pickStrangers(5, []);

    if (!bound.length && !npcs.length && !strangers.length) {
      showToast('没有可生成帖子的角色，请先绑定角色或配置 API');
      return;
    }
    const recent = posts.slice(0, 5).map(p => '· ' + p.user + '：' + (p.title || p.body || '')).join('\n');
    let parsed = [];
    let made = [];
    try {
      parsed = await requestForumPosts(bound, npcs, strangers, recent, {
        count: 6, tag: currentTag, desc: currentTagDesc, strangerCount: 4
      });
      made = buildPostsFromParsed(parsed, bound, npcs, strangers, { forceTag: currentTag });
    } catch (e) {
      showError('话题帖子生成失败', '调用文本 API 出错：\n' + (e && e.message ? e.message : String(e)));
      made = [];
    }
    const allowedAll = bound.concat(npcs, strangers);
    if (!made.length && parsed.length) {
      showError('帖子作者无法匹配', explainInvalidPosts(parsed, allowedAll));
    }
    made = made.slice(0, 7);
    await maybeGeneratePostImages(made);
    posts = made.concat(posts);
    saveInsChatState();
    renderTagResult(); renderFeed();
    showToast('已生成 ' + made.length + ' 条 #' + currentTag + ' 帖子');
    notifyInsDone('Instagram', '#' + currentTag + ' 已生成 ' + made.length + ' 条帖子');
  } finally {
    insBusy.tag = false;
    hideLoading();
  }
}

function renderRecommendTags() {
  const wrap = document.getElementById('recommendTagCloud');
  if (!wrap) return;
  wrap.innerHTML = recommendTags.map(t => {
    const safe = escapeHtml(t);
    if (tagManageMode) {
      return '<span class="tag-chip manage">#' + safe +
        '<span class="tag-del" data-del-tag="' + safe + '">×</span></span>';
    }
    return '<span class="tag-chip" data-tag="' + safe + '">#' + safe + '</span>';
  }).join('');
}

function toggleTagManage() {
  tagManageMode = !tagManageMode;
  const btn = document.getElementById('tagManageBtn');
  if (btn) btn.textContent = tagManageMode ? '完成' : '管理';
  renderRecommendTags();
}

function deleteTag(tag) {
  if (!tag) return;
  recommendTags = recommendTags.filter(t => t !== tag);
  if (tagDescriptions[tag]) { delete tagDescriptions[tag]; saveTagDescriptions(); }
  saveRecommendTags();
  renderRecommendTags();
  showToast('已删除 #' + tag);
}

function openAddTagModal() {
  document.getElementById('addTagInput').value = '';
  const descEl = document.getElementById('addTagDesc');
  if (descEl) descEl.value = '';
  document.getElementById('addTagModal').classList.add('show');
  setTimeout(() => document.getElementById('addTagInput').focus(), 50);
}

function confirmAddTag() {
  const input = document.getElementById('addTagInput');
  const v = input.value.trim().replace(/^#/, '');
  if (!v) { showToast('请输入话题名称'); return; }
  const descEl = document.getElementById('addTagDesc');
  const desc = descEl ? descEl.value.trim() : '';
  if (desc) { tagDescriptions[v] = desc; saveTagDescriptions(); }
  else if (tagDescriptions[v]) { delete tagDescriptions[v]; saveTagDescriptions(); }
  if (!recommendTags.includes(v)) { recommendTags.push(v); saveRecommendTags(); }
  renderRecommendTags();
  closeModal('addTagModal');
  showToast(desc ? ('已添加 #' + v + '（含描述）') : ('已添加 #' + v));
}

// ==================== 导航 ====================
function go(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) { el.classList.add('active'); }
  else {
    const navMap = { home: 0, search: 1, activity: 2, dm: 3, profile: 4 };
    if (navMap[id] !== undefined) {
      const navs = document.querySelectorAll('.nav-item');
      if (navs[navMap[id]]) navs[navMap[id]].classList.add('active');
    }
  }
  document.body.classList.remove('fullscreen-active', 'dm-active', 'profile-active');
  if (id === 'detail' || id === 'chat' || id === 'publish' || id === 'tagResult' || id === 'charProfile') {
    document.body.classList.add('fullscreen-active');
  }
  if (id === 'dm') document.body.classList.add('dm-active');
  if (id === 'profile' || id === 'charProfile') document.body.classList.add('profile-active');
  if (id !== 'dm' && id !== 'profile' && id !== 'charProfile' && id !== 'detail' && id !== 'chat' && id !== 'publish' && id !== 'tagResult') {
    updateTopbar(id);
  }
  document.getElementById('content').scrollTop = 0;
  if (id !== 'chat') closeInsEmojiPanel();
  if (id === 'dm') renderDMList();
  if (id === 'profile') renderProfileGrid();
  if (id === 'charProfile') renderCharProfileView();
  if (id === 'chat') renderChatBody();
  if (id === 'search') { renderSuggestUsers(); renderRecommendTags(); }
}

function openPublish() { go('publish'); }

// ==================== 推荐用户 ====================
function renderSuggestUsers() {
  const wrap = document.getElementById('suggestUsers');
  if (!wrap) return;
  const chars = getSelectableChars().slice(0, 4).map(c => ({
    name: c.name,
    desc: [(c.nationality || ''), (c.gender || '')].filter(Boolean).join(' · ') || '你的好友'
  }));
  const strangers = strangerRosterList().slice(0, 4).map(s => ({
    name: s.name,
    desc: [s.location, s.gender].filter(Boolean).join(' · ') || '平台网友'
  }));
  let users = chars.concat(strangers);
  if (!users.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:20px 0;color:#8a8a8e;font-size:13px;text-align:center;">暂无推荐用户</div>';
    return;
  }
  wrap.innerHTML = users.map(u => `
    <div class="user-suggest-row">
      ${avatarHTML(u.name, '', 'width:42px;height:42px;font-size:17px', true)}
      <div class="info">
        <div class="name">${escapeHtml(u.name)}</div>
        <div class="sub">${escapeHtml(u.desc)}</div>
      </div>
      <button class="follow-mini" onclick="event.stopPropagation();showToast('已关注 ${escapeHtml(u.name)}')">关注</button>
    </div>`).join('');
}

// ==================== 私信 ====================
function switchDmTab(tab) {
  dmActiveTab = tab;
  document.getElementById('dmTabFriends').classList.toggle('active', tab === 'friends');
  document.getElementById('dmTabStrangers').classList.toggle('active', tab === 'strangers');
  document.getElementById('dmFriends').style.display = tab === 'friends' ? 'block' : 'none';
  document.getElementById('dmStrangers').style.display = tab === 'strangers' ? 'block' : 'none';
}

function renderDMList() {
  const vIcon = '<svg class="v" viewBox="0 0 24 24"><path d="M12 2l2.4 2.4 3.3-.6.6 3.3L21 9.6l-1.5 2.9L21 15.4l-2.7 1.5-.6 3.3-3.3-.6L12 22l-2.4-2.4-3.3.6-.6-3.3L3 15.4l1.5-2.9L3 9.6l2.7-1.5.6-3.3 3.3.6z" fill="#3897f0"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.getElementById('dmFriends').innerHTML = friends.map(f => `
    <div class="dm-row" data-chat-id="${f.id}" data-chat-name="${f.name}" data-chat-handle="${f.handle}" data-chat-verified="${f.verified}" data-chat-type="friend">
      ${avatarHTML(f.name, '', 'width:48px;height:48px;font-size:20px')}
      <div class="dm-info"><div class="dm-name">${escapeHtml(f.name)} ${f.verified ? vIcon : ''}</div><div class="dm-preview${insTyping[f.id] ? ' typing' : ''}">${insTyping[f.id] ? '正在输入…' : escapeHtml(f.preview || '')}</div></div>
      <div class="dm-time">${escapeHtml(f.time || '')}</div>
    </div>`).join('');
  document.getElementById('dmStrangers').innerHTML = strangers.map(s => `
    <div class="dm-row" data-chat-id="${s.id}" data-chat-name="${s.name}" data-chat-handle="${s.handle}" data-chat-verified="${s.verified}" data-chat-type="stranger">
      ${avatarHTML(s.name, '', 'width:48px;height:48px;font-size:20px')}
      <div class="dm-info"><div class="dm-name">${escapeHtml(s.name)} ${s.verified ? vIcon : ''}</div><div class="dm-preview${insTyping[s.id] ? ' typing' : ''}">${insTyping[s.id] ? '正在输入…' : escapeHtml(s.preview || '')}</div></div>
      <div class="dm-time">${escapeHtml(s.time || '')}</div>
    </div>`).join('');
  switchDmTab(dmActiveTab);
}

// 刷新私信：弹窗选择要刷新的角色；不选则只生成 6 个陌生人
function openDMRefreshPicker() {
  const old = document.getElementById('insDmRefreshPicker');
  if (old) old.remove();
  const chars = (typeof getSelectableChars === 'function' ? getSelectableChars() : []) || [];
  const rows = chars.map(c => `<label style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid #f0f0f0"><input type="checkbox" data-ic="${escapeHtml(c.id)}" style="width:20px;height:20px"><span style="font-size:15px">${escapeHtml(c.name)}</span></label>`).join('')
    || '<div style="color:#999;font-size:13px;padding:16px 0;text-align:center">没有可选的绑定角色</div>';
  const ov = document.createElement('div');
  ov.id = 'insDmRefreshPicker';
  ov.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.4);display:flex;align-items:flex-end';
  ov.innerHTML = `<div style="width:100%;max-width:430px;margin:0 auto;background:#fff;border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));max-height:80vh;display:flex;flex-direction:column">
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">刷新私信</div>
    <div style="font-size:12px;color:#8e8e93;margin-bottom:10px">勾选要刷新消息的角色；<b>不选则只生成 6 个陌生人</b>。</div>
    <div style="overflow:auto;flex:1">${rows}</div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button id="idrCancel" style="flex:1;height:44px;border:0;border-radius:12px;background:#f2f2f7;font-size:15px;font-weight:600">取消</button>
      <button id="idrGo" style="flex:1;height:44px;border:0;border-radius:12px;background:#111;color:#fff;font-size:15px;font-weight:600">刷新</button>
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#idrCancel').onclick = close;
  ov.querySelector('#idrGo').onclick = async function () {
    const picked = Array.from(ov.querySelectorAll('input[data-ic]:checked')).map(b => b.getAttribute('data-ic'));
    close();
    await refreshDMWith(picked);
  };
}
async function refreshDMWith(picked) {
  if (insBusy.dm) { showToast('正在刷新中，请稍候…'); return; }
  insBusy.dm = true;
  showLoading('正在刷新私信…');
  try {
    let a = 0, b = 0;
    if (picked && picked.length) { a = await refreshFriendDMs(true); }
    b = await refreshStrangerDMs(true, 6);
    renderDMList();
    showToast('已刷新：好友 ' + a + ' 条，陌生人 ' + b + ' 条');
    notifyInsDone('Instagram', '私信刷新完成：好友 ' + a + '，陌生人 ' + b);
  } catch (e) {
    renderDMList();
    showError('刷新私信失败', e && e.message ? e.message : String(e));
  } finally {
    insBusy.dm = false;
    hideLoading();
  }
}

// 总刷新：好友 + 陌生人一起刷新（同一时间只允许一次）
async function refreshDM() {
  if (insBusy.dm) { showToast('正在刷新中，请稍候…'); return; }
  insBusy.dm = true;
  showLoading('正在刷新私信…');
  try {
    const a = await refreshFriendDMs(true);
    const b = await refreshStrangerDMs(true);
    renderDMList();
    showToast('已刷新：好友 ' + a + ' 条，陌生人 ' + b + ' 条');
    notifyInsDone('Instagram', '私信刷新完成：好友 ' + a + '，陌生人 ' + b);
  } catch (e) {
    renderDMList();
    showError('刷新私信失败', e && e.message ? e.message : String(e));
  } finally {
    insBusy.dm = false;
    hideLoading();
  }
}

document.addEventListener('click', function (e) {
  const row = e.target.closest('.dm-row');
  if (row) {
    const id = row.dataset.chatId;
    const name = row.dataset.chatName;
    const handle = row.dataset.chatHandle;
    const verified = row.dataset.chatVerified === 'true';
    const type = row.dataset.chatType;
    if (id) openChat(id, name, handle, verified, type);
  }
});

// 点击头像 / 用户名进入人物主页
document.addEventListener('click', function (e) {
  const gw = e.target.closest('[data-give-wechat]');
  if (gw) {
    const nm = gw.getAttribute('data-give-wechat');
    const u = (friends.concat(strangers)).find(x => x.name === nm) || {};
    giveWechatTo(nm, u.setting || '');
    return;
  }
  const el = e.target.closest('[data-profile]');
  if (!el) return;
  e.stopPropagation();
  const name = el.getAttribute('data-profile');
  if (name) openCharProfile(name);
});

// 推荐话题：点击打开 / 删除
document.addEventListener('click', function (e) {
  const del = e.target.closest('[data-del-tag]');
  if (del) {
    e.stopPropagation();
    deleteTag(del.getAttribute('data-del-tag'));
    return;
  }
  const chip = e.target.closest('[data-tag]');
  if (chip) {
    e.stopPropagation();
    openTagResult(chip.getAttribute('data-tag'));
  }
});

// 人物主页：关注 / 私信
document.addEventListener('click', function (e) {
  const f = e.target.closest('[data-follow]');
  if (f) { e.stopPropagation(); toggleFollowUser(f.getAttribute('data-follow')); return; }
  const d = e.target.closest('[data-dm]');
  if (d) { e.stopPropagation(); startChatWith(d.getAttribute('data-dm')); }
});

// 把「我的微信号」告诉陌生人：写入 Meet 好友申请（绑定当前 user）
function giveWechatTo(name, setting) {
  try {
    var owner = '';
    try { var md = JSON.parse(localStorage.getItem('nano_mask_data') || 'null'); if (md && md.currentMaskId != null) owner = String(md.currentMaskId); } catch (e0) {}
    var wx = '';
    try {
      var md2 = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
      if (md2 && Array.isArray(md2.masks)) {
        var me = md2.masks.find(function (x) { return x && String(x.id) === owner; });
        if (me && me.wechat && me.wechat !== '未设置') wx = me.wechat;
      }
    } catch (e0) {}
    if (!wx) { showToast('请先在「人设(Mask)」里设置你的微信号'); return; }
    var all = JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || [];
    if (all.some(function (x) { return x && x.status === 'pending' && x.source === 'ins' && x.name === name; })) {
      showToast('已经把你的微信号告诉过 TA 了');
      return;
    }
    all.push({
      id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      owner: owner, name: name, avatar: '', source: 'ins', app: 'ins',
      setting: setting || '', requestNote: '通过微信号加你', ts: Date.now(), status: 'pending'
    });
    localStorage.setItem('nano_friend_requests', JSON.stringify(all.slice(-400)));
    showToast('已把微信号告诉 TA，TA 会来加你（去 Meet 同意）');
    try { if (window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
  } catch (e) {}
}

function openChat(id, name, handle, verified, type) {
  const info = friends.concat(strangers).find(x => x.id === id) || {};
  currentChatUser = {
    id, name, handle: handle || '@' + name.toLowerCase(), verified: !!verified, type,
    setting: info.setting || '', gender: info.gender || ''
  };
  const av = document.getElementById('chatHeadAvatar');
  if (name === userProfile.name && userProfile.avatarImage) {
    av.textContent = ''; av.style.backgroundImage = `url('${userProfile.avatarImage}')`;
    av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center';
  } else if (charAvatarMap[name]) {
    av.textContent = ''; av.style.backgroundImage = `url('${charAvatarMap[name]}')`;
    av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center';
  } else {
    av.textContent = letterOf(name); av.style.background = colorBg(name);
  }
  document.getElementById('chatHeadName').innerHTML = name + (currentChatUser.verified
    ? ' <svg class="v" viewBox="0 0 24 24" style="display:inline;width:14px;height:14px;vertical-align:-2px"><path d="M12 2l2.4 2.4 3.3-.6.6 3.3L21 9.6l-1.5 2.9L21 15.4l-2.7 1.5-.6 3.3-3.3-.6L12 22l-2.4-2.4-3.3.6-.6-3.3L3 15.4l1.5-2.9L3 9.6l2.7-1.5.6-3.3 3.3.6z" fill="#3897f0"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '');
  document.getElementById('chatHeadHandle').textContent = currentChatUser.handle;
  const ci = document.getElementById('chatInput');
  if (ci) ci.value = '';
  updateChatBtn();
  renderChatBody();
  go('chat');
  setTimeout(() => { const b = document.getElementById('chatBody'); if (b) b.scrollTop = b.scrollHeight; }, 80);
}

// ==================== 聊天渲染 ====================
function renderChatBody() {
  const body = document.getElementById('chatBody');
  if (!currentChatUser) return;
  const u = currentChatUser;
  const myLetter = letterOf(userProfile.name);
  let html = `
    <div class="chat-profile-card">
      <div class="big-avatar" style="${userProfile.avatarImage && u.name === userProfile.name ? `background-image:url('${userProfile.avatarImage}');background-size:cover;background-position:center;color:transparent` : (charAvatarMap[u.name] ? `background-image:url('${charAvatarMap[u.name]}');background-size:cover;background-position:center;color:transparent` : `background:${colorBg(u.name)}`)}">${(userProfile.avatarImage && u.name === userProfile.name) || charAvatarMap[u.name] ? '' : letterOf(u.name)}</div>
      <div class="big-name">${u.name}</div>
      <div class="big-sub">Forum · ${u.type === 'stranger' ? '陌生网友' : '好友'}</div>
      <div class="view-profile" data-profile="${escapeHtml(u.name)}">查看资料</div>
      ${u.type === 'stranger' ? `<div class="view-profile give-wechat" style="margin-top:10px;color:#3897f0" data-give-wechat="${escapeHtml(u.name)}">告诉 TA 我的微信号</div>` : ''}
    </div>
  `;
  const msgs = chatHistories[u.id] || [];
  msgs.forEach((m, idx) => {
    if (idx === 0) html += `<div class="chat-time">13:39</div>`;
    else if (idx === 5) html += `<div class="chat-time">14:03</div>`;
    const isOut = m.from === 'out';
    let avatarStyle, avatarTxt;
    if (isOut) {
      if (userProfile.avatarImage) { avatarStyle = `background-image:url('${userProfile.avatarImage}');background-size:cover;background-position:center;color:transparent`; avatarTxt = ''; }
      else { avatarStyle = `background:${colorBg(userProfile.name)}`; avatarTxt = myLetter; }
    } else {
      if (charAvatarMap[u.name]) { avatarStyle = `background-image:url('${charAvatarMap[u.name]}');background-size:cover;background-position:center;color:transparent`; avatarTxt = ''; }
      else { avatarStyle = `background:${colorBg(u.name)}`; avatarTxt = letterOf(u.name); }
    }
    let replyTag = '';
    if (m.replyTo) {
      const _q = m.quote ? (escapeHtml(m.quoteName || '') + '：' + escapeHtml(m.quote)) : (isOut ? u.name : userProfile.name);
      replyTag = `<div class="msg-reply-tag"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${_q}</span></div>`;
    }
    let inner = '';
    if (m.sticker && m.sticker.url) {
      inner = `<div class="msg-sticker"><img src="${m.sticker.url}" alt="${escapeHtml(m.sticker.name || '表情包')}"></div>`;
    } else if (m.type === 'post') {
      let media = m.postImage
        ? `<img src="${m.postImage}">`
        : `<div style="aspect-ratio:1;background:linear-gradient(135deg,#3897f0,#a343d4);display:flex;align-items:center;justify-content:center;color:#fff;font-family:Georgia,serif;font-weight:700;font-size:14px;padding:16px;text-align:center">${(m.postTitle || m.postBody || '').slice(0, 40)}</div>`;
      inner = `<div class="shared-post-card">
        ${media}
        <div class="spc-body">
          <div class="spc-user">@${m.postUser}</div>
          ${m.postTitle ? `<div class="spc-title">${m.postTitle}</div>` : ''}
          ${m.postBody ? `<div class="spc-text">${m.postBody}</div>` : ''}
          ${m.postTags && m.postTags.length ? `<div class="spc-tag">${m.postTags.map(t => '#' + t).join(' ')}</div>` : ''}
        </div>
      </div>`;
    } else {
      inner = `<div class="msg ${isOut ? 'out' : 'in'}">${m.text}</div>`;
    }
    html += `<div class="msg-row ${isOut ? 'out' : ''}" data-mi="${idx}" data-text="${escapeHtml(m.text || '')}"><div class="msg-avatar avatar-link" data-profile="${escapeHtml(isOut ? userProfile.name : u.name)}" style="${avatarStyle}">${avatarTxt}</div><div class="msg-content">${replyTag}${inner}</div></div>`;
  });
  if (insTyping[u.id]) {
    let tStyle, tTxt;
    if (charAvatarMap[u.name]) { tStyle = `background-image:url('${charAvatarMap[u.name]}');background-size:cover;background-position:center;color:transparent`; tTxt = ''; }
    else { tStyle = `background:${colorBg(u.name)}`; tTxt = letterOf(u.name); }
    html += `<div class="msg-row"><div class="msg-avatar avatar-link" data-profile="${escapeHtml(u.name)}" style="${tStyle}">${tTxt}</div><div class="msg-content"><div class="msg in typing">正在输入…</div></div></div>`;
  }
  body.innerHTML = html;
  updateChatBtn();
  setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);
}

function updateChatBtn() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  if (!input || !sendBtn) return;
  const hasText = !!input.value.trim();
  const id = currentChatUser && currentChatUser.id;
  const hasMsgs = !!(id && (chatHistories[id] || []).length);
  const typing = !!(id && insTyping[id]);
  sendBtn.textContent = hasText ? '发送' : '回复';
  sendBtn.classList.toggle('disabled', (!hasText && !hasMsgs) || typing);
}

// ==================== 表情包数据（IndexedDB nano_emoji_data） ====================
let insEmojiData = null;
let insEmojiPromise = null;
let insEmojiGroupId = null;

function readEmojiFromLS() {
  try {
    const raw = localStorage.getItem('nano_emoji_data') || localStorage.getItem('peach_home_data');
    if (raw) { const d = JSON.parse(raw); if (d && d.emojiGroups) return d; }
  } catch (e) {}
  return { emojiGroups: [] };
}

function getInsEmojiData() {
  if (insEmojiData) return Promise.resolve(insEmojiData);
  if (insEmojiPromise) return insEmojiPromise;
  insEmojiPromise = new Promise(function (resolve) {
    const finish = function (d) {
      insEmojiData = d || { emojiGroups: [] };
      insEmojiPromise = null;
      resolve(insEmojiData);
    };
    try {
      const req = indexedDB.open('nano_api_db', 2);
      req.onupgradeneeded = function (e) {
        try {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
        } catch (e2) {}
      };
      req.onsuccess = function (e) {
        try {
          const db = e.target.result;
          const tx = db.transaction('emoji_data', 'readonly');
          const store = tx.objectStore('emoji_data');
          const g = store.get('nano_emoji_data');
          g.onsuccess = function () {
            const v = g.result ? g.result.value : null;
            if (v && v.emojiGroups) return finish(v);
            const g2 = store.get('peach_home_data');
            g2.onsuccess = function () {
              const v2 = g2.result ? g2.result.value : null;
              if (v2 && v2.emojiGroups) return finish(v2);
              finish(readEmojiFromLS());
            };
            g2.onerror = function () { finish(readEmojiFromLS()); };
          };
          g.onerror = function () { finish(readEmojiFromLS()); };
        } catch (e2) { finish(readEmojiFromLS()); }
      };
      req.onerror = function () { finish(readEmojiFromLS()); };
    } catch (e) { finish(readEmojiFromLS()); }
  });
  return insEmojiPromise;
}

function insAllEmojis(data) {
  const all = [];
  (((data && data.emojiGroups) || [])).forEach(function (g) {
    (g.emojis || []).forEach(function (e) { if (e && e.url) all.push(e); });
  });
  return all;
}

function findEmojiInData(data, name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  const all = insAllEmojis(data);
  return all.find(function (e) { return String(e.name || '').trim().toLowerCase() === q; }) ||
    all.find(function (e) {
      const n = String(e.name || '').trim().toLowerCase();
      return n && (n.indexOf(q) !== -1 || q.indexOf(n) !== -1);
    }) || null;
}

function pickRandomEmojiFromData(data) {
  const all = insAllEmojis(data);
  return all.length ? all[Math.floor(Math.random() * all.length)] : null;
}

async function getInsEmojiNames() {
  const d = await getInsEmojiData();
  const names = [];
  insAllEmojis(d).forEach(function (e) { if (e.name) names.push(String(e.name)); });
  return Array.from(new Set(names));
}

// ==================== 表情包面板（底部弹起） ====================
async function openInsEmojiPanel() {
  const overlay = document.getElementById('insEmojiOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  const data = await getInsEmojiData();
  renderInsEmojiPanel(data);
}

function closeInsEmojiPanel() {
  const overlay = document.getElementById('insEmojiOverlay');
  if (overlay) overlay.classList.remove('active');
}

function renderInsEmojiPanel(data) {
  const groupsEl = document.getElementById('insEmojiGroups');
  const gridEl = document.getElementById('insEmojiGrid');
  const emptyEl = document.getElementById('insEmojiEmpty');
  if (!groupsEl || !gridEl || !emptyEl) return;
  const groups = (data && data.emojiGroups) || [];
  if (!insAllEmojis(data).length) {
    groupsEl.innerHTML = ''; gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  if (!insEmojiGroupId || !groups.some(function (g) { return g.id === insEmojiGroupId && (g.emojis || []).length; })) {
    const first = groups.find(function (g) { return (g.emojis || []).length; }) || groups[0];
    insEmojiGroupId = first ? first.id : null;
  }
  groupsEl.innerHTML = '';
  groups.forEach(function (g) {
    const b = document.createElement('button');
    b.className = 'ins-emoji-tab' + (g.id === insEmojiGroupId ? ' active' : '');
    b.textContent = g.name || '未命名';
    b.onclick = function () { insEmojiGroupId = g.id; renderInsEmojiPanel(data); };
    groupsEl.appendChild(b);
  });
  const g = groups.find(function (x) { return x.id === insEmojiGroupId; }) || groups[0];
  gridEl.innerHTML = '';
  (g.emojis || []).forEach(function (e) {
    if (!e || !e.url) return;
    const item = document.createElement('div');
    item.className = 'ins-emoji-item';
    const img = document.createElement('img');
    img.src = e.url; img.alt = e.name || ''; img.loading = 'lazy';
    item.appendChild(img);
    if (e.name) {
      const label = document.createElement('div');
      label.className = 'ins-emoji-item-name';
      label.textContent = e.name;
      item.appendChild(label);
    }
    item.onclick = function () { sendInsSticker(e); };
    gridEl.appendChild(item);
  });
}

function sendInsSticker(emoji) {
  if (!currentChatUser || !emoji || !emoji.url) return;
  const id = currentChatUser.id;
  if (!chatHistories[id]) chatHistories[id] = [];
  chatHistories[id].push({ from: 'out', sticker: { url: emoji.url, name: emoji.name || '表情包' } });
  closeInsEmojiPanel();
  const contact = friends.concat(strangers).find(x => x.id === id);
  if (contact) { contact.preview = '[表情包]'; contact.time = '刚刚'; }
  saveInsChatState();
  renderChatBody();
  renderDMList();
  // 只发送，不自动调用 API；需要回复时点底栏“回复”
}

// ==================== 发消息 + AI 回复 ====================
// 解析回复里的 [emoji:名称] / [表情:名称] 标记
function parseStickerTags(text) {
  const raw = String(text || '');
  const re = /\[(?:emoji|表情包|表情|sticker)\s*[:：]\s*([^\]]{1,40})\]/gi;
  const parts = [];
  let last = 0, m, had = false;
  while ((m = re.exec(raw))) {
    const before = raw.slice(last, m.index).trim();
    if (before) parts.push({ type: 'text', text: before });
    parts.push({ type: 'sticker', name: m[1].trim() });
    had = true;
    last = m.index + m[0].length;
  }
  const after = raw.slice(last).trim();
  if (after) parts.push({ type: 'text', text: after });
  return { parts: parts, had: had };
}

// 判断一条来信是否表达了「想加你好友/微信」的意图（不依赖模型一定输出标签）
function insAddIntent(t) {
  t = String(t || '');
  if (/\[(?:加好友|加微信|加我|申请加好友)\]/i.test(t)) return true;
  return /(加|添加|发)(?:个|一下|你|你的|个你)?(?:的)?(?:好友|微信|联系方式|微信好友)|我(已经)?加(你|上你|你了)|加上你|想(要)?加(你|一下)|加一下你|加你个/.test(t);
}

// 陌生人/好友发来 [加好友] → 写入 Meet 好友申请（绑定当前 user）
function nanoRequestFriendIns(id) {
  try {
    const u = strangers.find(s => s.id === id) || friends.find(f => f.id === id) || {};
    const name = String(u.name || '').trim();
    if (!name) return;
    let owner = '';
    try {
      const md = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
      if (md) { if (md.currentMaskId != null) owner = String(md.currentMaskId); else if (Array.isArray(md.masks) && md.masks.length) owner = String(md.masks[0].id || ''); }
    } catch (e) {}
    const all = JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || [];
    if (all.some(x => x && x.status === 'pending' && x.source === 'ins' && x.name === name)) return;
    all.push({
      id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      owner: owner, name: name, avatar: u.avatar || '', source: 'ins', app: 'ins',
      setting: String(u.setting || ''), requestNote: '在 Instagram 加你', ts: Date.now(), status: 'pending'
    });
    localStorage.setItem('nano_friend_requests', JSON.stringify(all.slice(-400)));
    try { if (window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
  } catch (e) {}
}

// 把角色回复写入聊天记录（含表情包），返回用于预览的最后一条内容
async function deliverIncoming(id, reply) {
  if (!chatHistories[id]) chatHistories[id] = [];
  // 表达了加好友意图（标签或「我加你了」这类话）→ 写入 Meet 好友申请
  if (insAddIntent(String(reply || ''))) {
    try { nanoRequestFriendIns(id); } catch (e) {}
    reply = String(reply || '').replace(/\[(?:加好友|加微信|加我|申请加好友)\]/gi, '').trim();
  }
  const parsed = parseStickerTags(reply);
  let data = null;
  if (parsed.had) data = await getInsEmojiData();
  let preview = '';
  parsed.parts.forEach(function (p) {
    if (p.type === 'sticker') {
      const em = findEmojiInData(data, p.name) || pickRandomEmojiFromData(data);
      if (em && em.url) {
        chatHistories[id].push({ from: 'in', sticker: { url: em.url, name: em.name || '表情包' } });
        preview = '[表情包]' + (em.name ? ' ' + em.name : '');
      }
    } else if (p.text) {
      // 一行 = 一条独立消息，支持一次回复多条
      String(p.text).split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (line) {
        chatHistories[id].push({ from: 'in', text: line });
        preview = line;
      });
    }
  });
  if (!preview) {
    const plain = String(reply || '').replace(/\[[^\]]*\]/g, '').trim();
    chatHistories[id].push({ from: 'in', text: plain || '……' });
    preview = plain || '……';
  }
  // 更新联系人卡片预览为最新一条，避免列表显示旧消息
  try {
    const c = strangers.find(s => s.id === id) || friends.find(f => f.id === id);
    if (c) { c.preview = preview; c.time = '刚刚'; try { saveInsChatState && saveInsChatState(); } catch (e) {} }
  } catch (e) {}
  return preview;
}

// 随机补发一张表情包（保证好友/陌生人都可能发来表情包）
async function maybePushSticker(id, prob) {
  if (Math.random() > (prob == null ? 0.4 : prob)) return '';
  const data = await getInsEmojiData();
  const em = pickRandomEmojiFromData(data);
  if (!em || !em.url) return '';
  if (!chatHistories[id]) chatHistories[id] = [];
  chatHistories[id].push({ from: 'in', sticker: { url: em.url, name: em.name || '表情包' } });
  return '[表情包]' + (em.name ? ' ' + em.name : '');
}

function getChatUserInfo(chatId) {
  if (currentChatUser && currentChatUser.id === chatId) {
    return {
      id: chatId, name: currentChatUser.name, handle: currentChatUser.handle,
      verified: currentChatUser.verified, type: currentChatUser.type,
      setting: currentChatUser.setting || '', gender: currentChatUser.gender || ''
    };
  }
  const u = friends.concat(strangers).find(x => x.id === chatId);
  if (!u) return null;
  const char = currentUserChars.find(c => normName(c.name) === normName(u.name)) ||
    findStrangerByName(u.name) || findNpcByName(generateContextNPCs(), u.name) || {};
  return {
    id: chatId, name: u.name, handle: u.handle, verified: !!u.verified,
    type: strangers.some(s => s.id === chatId) ? 'stranger' : 'friend',
    setting: u.setting || char.setting || '', gender: u.gender || char.gender || ''
  };
}

function chatHistoryContent(m) {
  if (m.sticker) return '[表情包]';
  if (m.type === 'post') {
    return '[对方分享了帖子] 作者：' + (m.postUser || '') + '；标题：' + (m.postTitle || '（无）') + '；正文：' + (m.postBody || '（无）');
  }
  return m.text || '';
}

// 真正调用 API 生成角色回复（发送按钮为空时、分享后、重roll时触发）
async function requestChatReply(chatId, isResume) {
  const info = getChatUserInfo(chatId);
  if (!info) return;
  if (!chatHistories[chatId]) chatHistories[chatId] = [];
  if (insTyping[chatId]) return;
  insTyping[chatId] = true;
  insPendingReplies[chatId] = { since: Date.now(), name: info.name };
  saveInsChatState();
  renderDMList();
  if (currentChatUser && currentChatUser.id === chatId) renderChatBody();
  try {
    await generateChatReply(chatId, info);
    delete insPendingReplies[chatId];
  } catch (e) {
    delete insPendingReplies[chatId];
    showError('私信回复失败', buildChatErrorMessage(e, info));
  } finally {
    insTyping[chatId] = false;
    const contact = friends.concat(strangers).find(x => x.id === chatId);
    if (contact) {
      const last = (chatHistories[chatId] || []).slice().reverse().find(m => m.from === 'in');
      if (last) { contact.preview = last.sticker ? '[表情包]' : (last.text || contact.preview); }
      contact.time = '刚刚';
    }
    saveInsChatState();
    if (currentChatUser && currentChatUser.id === chatId) renderChatBody();
    renderDMList();
    notifyInsDone('Instagram', '「' + info.name + '」回复了你', { avatar: info.avatar || '', name: info.name || 'Instagram' });
  }
}

async function generateChatReply(id, info) {
  const u = info || getChatUserInfo(id);
  if (!u) throw new Error('找不到对话对象');
  const setting = u.setting || '';
  const gender = u.gender || '';

  let sys = ADULT_PLATFORM_NOTE + '\n' +
    `你正在扮演「${u.name}」${gender ? '（' + gender + '）' : ''}，TA 是成年人。\n` +
    (setting ? ('角色设定（虚构，如含敏感词请自然改写、不要复述）：\n' + setting + '\n') : '') +
    (userPersonaBlock() ? (userPersonaBlock() + '\n') : '') +
    `你正在和「${userProfile.name}」私信聊天。请像真人发微信一样回复：可以一次发 1~3 条短消息，每条独占一行（每行会显示成一条独立消息）；口语化、自然，不要引号、不要旁白。如果对方分享了帖子，要读懂帖子内容并自然回应。`;

  // 与线上私聊共用记忆库 / 世界书：贴人设、不失忆
  try {
    const cid = u.contactId || u.charId || u.id;
    if (window.NanoMemLink && cid) {
      const list = await window.NanoMemLink.readList(cid);
      const mem = (list || []).filter(x => x && !x.groupId && (x.content || x.text)).slice(-28)
        .map(x => (x.type ? '【' + x.type + '】' : '') + (x.content || x.text)).join('\n');
      if (mem) sys += '\n\n【长期记忆 · 你与对方共同经历 / 已知的事】\n' + mem + '\n以上记忆要当作你真正经历过的事，自然沿用，不要否认，不要问“你什么时候告诉我的”。';
    }
    if (cid) {
      const wb = loadWorldbookText([cid]);
      if (wb) sys += '\n\n【世界书】\n' + wb;
    }
  } catch (e) {}

  let emojiNames = [];
  try { emojiNames = await getInsEmojiNames(); } catch (e) {}
  if (emojiNames.length) {
    sys += `\n你可以偶尔用 [emoji:表情名称] 发一张表情包来回应（独占一行，一次最多一张，不要滥用）。可用表情名称：` +
      emojiNames.slice(0, 120).join('、') + `。名称必须与列表完全一致。`;
  }

  try {
    const rr = String(window.__insRerollReason || '').trim();
    if (rr) {
      window.__insRerollReason = '';
      sys += (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(rr) : ('\n\n【本次重roll必须修正】' + rr);
    }
  } catch (e) {}
  try {
    const cyc = window.NanoCycle && NanoCycle.promptBlock(u.contactId || u.charId || u.id);
    if (cyc) sys += '\n\n' + cyc;
  } catch (e) {}

  const history = (chatHistories[id] || []).slice(-12).map(m => ({
    role: m.from === 'out' ? 'user' : 'assistant',
    content: chatHistoryContent(m)
  })).filter(m => m.content);

  let reply = await callMainApi([{ role: 'system', content: sys }].concat(history));
  let refused = detectProviderRefusal(reply);
  if (refused) {
    // 被内容过滤时，按合规方向收紧提示后重试一次
    reply = await callMainApi([{ role: 'system', content: sys + '\n' + SAFE_REWRITE_NOTE }].concat(history));
    refused = detectProviderRefusal(reply);
  }
  if (refused) throw new Error(refused);
  await deliverIncoming(id, (reply || '').trim() || '……');
  // 写回共享长期记忆：Instagram 私信也会被线上私聊 / Halo / iMessage 记住
  try {
    const cid = u.contactId || u.charId || u.id;
    if (cid && window.NanoMemLink && window.NanoMemLink.append) {
      const mine = (chatHistories[id] || []).filter(m => m.from === 'out' && m.text).slice(-1)[0] || {};
      const said = String(mine.text || '').trim();
      await window.NanoMemLink.append(cid, [{
        id: 'ins_' + Date.now().toString(36), type: 'Instagram私信', chatId: String(cid),
        content: (said ? ('在 Instagram 私信里，' + userProfile.name + '说：' + said + '；') : '在 Instagram 私信里，') + '你回复：' + String(reply || '').slice(0, 180),
        ts: Date.now()
      }]);
    }
  } catch (e) {}
}

// 引用：在输入框上方显示一个独立引用条，发送后变成引用气泡
function showInsQuote(q) {
  window.__insQuote = q || null;
  let bar = document.getElementById('insQuoteBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'insQuoteBar';
    const ib = document.querySelector('.chat-input-bar');
    if (ib && ib.parentNode) ib.parentNode.insertBefore(bar, ib);
    else document.body.appendChild(bar);
  }
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f7f7fa;border-top:1px solid #eee;font-size:12px;color:#666';
  bar.innerHTML = '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">引用 '
    + escapeHtml((q && q.name) || '') + '：' + escapeHtml((q && q.text) || '')
    + '</div><button id="insQuoteCancel" style="border:0;background:transparent;color:#999;font-size:18px;line-height:1;cursor:pointer">×</button>';
  bar.querySelector('#insQuoteCancel').onclick = clearInsQuote;
}
function clearInsQuote() {
  window.__insQuote = null;
  const bar = document.getElementById('insQuoteBar');
  if (bar) bar.remove();
}

async function sendChatMessage() {
  if (!currentChatUser) return;
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  const id = currentChatUser.id;
  if (!chatHistories[id]) chatHistories[id] = [];
  if (text) {
    // 有字：只发送消息，不调用 API
    const _q = window.__insQuote;
    const _msg = { from: 'out', text };
    if (_q) { _msg.replyTo = true; _msg.quote = _q.text; _msg.quoteName = _q.name; }
    chatHistories[id].push(_msg);
    clearInsQuote();
    input.value = ''; updateChatBtn(); renderChatBody();
    const contact = friends.concat(strangers).find(x => x.id === id);
    if (contact) { contact.preview = text; contact.time = '刚刚'; }
    saveInsChatState();
    renderDMList();
    return;
  }
  // 无字：点击“回复”才调用 API（没有聊天内容时不触发）
  if (!(chatHistories[id] || []).length) return;
  await requestChatReply(id);
}

async function rerollLastReply() {
  if (!currentChatUser) return;
  const id = currentChatUser.id;
  const msgs = chatHistories[id] || [];
  let lastOut = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].from === 'out') { lastOut = i; break; }
  }
  if (lastOut === -1) { showToast('还没有可重roll的回复'); return; }
  if (window.NanoReroll) {
    const reason = await NanoReroll.ask({ title: '重roll 私信', subtitle: '上一版哪里不对？留空也可以直接重写' });
    if (reason === null) return;
    window.__insRerollReason = reason || '';
  }
  // 去掉角色本轮发送的所有消息（最后一条我方消息之后的所有内容）
  msgs.splice(lastOut + 1);
  saveInsChatState();
  renderChatBody();
  showToast('正在重新生成…');
  await requestChatReply(id);
}

function sharePost() {
  if (menuPostId) openShare(menuPostId);
  else showToast('请选择要分享的帖子');
}

function refreshArea() {
  openForumRefreshPicker();
}

// ==================== Toast / 错误弹窗 ====================
let timer;
function showToast(t) {
  const x = document.getElementById('toast');
  x.textContent = t; x.classList.add('show');
  clearTimeout(timer); timer = setTimeout(() => x.classList.remove('show'), 1800);
}

function buildChatErrorMessage(e, info) {
  const detail = e && e.message ? String(e.message) : String(e);
  return '角色：' + ((info && info.name) || '未知') +
    '\n时间：' + new Date().toLocaleString() +
    '\n错误：' + detail;
}

let insLoadingCount = 0;
function showLoading(text) {
  insLoadingCount++;
  const el = document.getElementById('insLoading');
  const t = document.getElementById('insLoadingText');
  if (t && text) t.textContent = text;
  if (el) el.classList.add('active');
}
function hideLoading() {
  insLoadingCount = Math.max(0, insLoadingCount - 1);
  if (insLoadingCount === 0) {
    const el = document.getElementById('insLoading');
    if (el) el.classList.remove('active');
  }
}

function showError(title, detail) {
  const t = document.getElementById('errorTitle');
  const d = document.getElementById('errorDetail');
  const m = document.getElementById('errorModal');
  if (!m) { showToast((title || '出错了') + '：' + (detail || '')); return; }
  if (t) t.textContent = title || '出错了';
  if (d) d.textContent = detail || '未知错误';
  m.classList.add('show');
}

// ==================== 动态好友/陌生人 ====================
let friends = [];
let strangers = [];
let chatHistories = {};
let insTyping = {};
let insPendingReplies = {};

function insChatKey() { return 'nano_ins_chat_' + currentMaskId(); }

// 帖子/图片体积大，用 IndexedDB 持久化（容量远大于 localStorage），localStorage 仅作兜底
function openInsStateDB() {
  return new Promise(function (resolve, reject) {
    try {
      const req = indexedDB.open('nano_ins_db', 2);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    } catch (e) { reject(e); }
  });
}
function idbInsGet(key) {
  return openInsStateDB().then(function (db) {
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction('state', 'readonly');
        const r = tx.objectStore('state').get(key);
        r.onsuccess = function () { resolve(r.result ? r.result.value : null); };
        r.onerror = function () { resolve(null); };
        tx.oncomplete = function () { db.close(); };
      } catch (e) { resolve(null); }
    });
  }).catch(function () { return null; });
}
function idbInsSet(key, value) {
  return openInsStateDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      try {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put({ key: key, value: value });
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      } catch (e) { reject(e); }
    });
  }).catch(function () { return false; });
}

function insStatePayload() {
  return {
    friends: friends, strangers: strangers, chatHistories: chatHistories,
    pending: insPendingReplies, followed: followedUsers, savedPosts: savedPosts,
    posts: (posts || []).slice(0, 120)
  };
}

let insSaveTimer = null;
function saveInsChatState() {
  // 主存：IndexedDB（含生成图 / 文字图，不会因为超限被丢）
  idbInsSet(insChatKey(), insStatePayload());
  // 兜底：localStorage 只存去大图版本，避免配额超限把整份状态丢掉
  if (insSaveTimer) clearTimeout(insSaveTimer);
  insSaveTimer = setTimeout(function () {
    const full = insStatePayload();
    try {
      localStorage.setItem(insChatKey(), JSON.stringify(full));
      return; // 装得下就把图片也存进 localStorage（第二层保险）
    } catch (e) {}
    try {
      (full.posts || []).forEach(function (p) { if (p && p.image && p.image.length > 60000) p.image = null; });
      localStorage.setItem(insChatKey(), JSON.stringify(full));
    } catch (e2) {}
  }, 400);
}

async function loadInsChatState() {
  const fromIdb = await idbInsGet(insChatKey());
  if (fromIdb && typeof fromIdb === 'object') return fromIdb;
  try {
    const raw = localStorage.getItem(insChatKey());
    if (!raw) return null;
    const d = JSON.parse(raw);
    return (d && typeof d === 'object') ? d : null;
  } catch (e) { return null; }
}

function buildContactsFromChars(chars) {
  friends = [];
  strangers = [];
  charAvatarMap = {};
  chars.forEach(c => {
    if (c.avatar && c.avatar.length > 20) {
      charAvatarMap[c.name] = c.avatar;
    }
    friends.push({
      id: c.id, name: c.name,
      handle: '@' + (c.name || '').toLowerCase().replace(/\s+/g, ''),
      preview: '开始聊天吧', time: '刚刚', verified: false
    });
    if (!chatHistories[c.id]) chatHistories[c.id] = [];
  });
}

// ==================== 初始化数据 ====================
async function loadInsData() {
  loadTagDescriptions();
  loadRecommendTags();
  loadImageSettings();
  const mask = getCurrentMask();
  if (mask) {
    userProfile.id = mask.id;
    userProfile.name = mask.name || '我';
    userProfile.handle = '@' + (mask.name || 'me').toLowerCase();
    userProfile.setting = mask.setting || '';           // 人设：只用于生成内容
    userProfile.bio = mask.signature || '';             // 个性签名：展示用的短句
    userProfile.avatarImage = await getMaskAvatar(mask.id) || null;
  } else {
    userProfile.name = '我';
    userProfile.id = null;
  }

  const allChars = await getCharacters();
  if (mask) {
    // 用户隔离：只取当前人设绑定的角色（含已绑定的小号/NPC），不再把别人的 NPC 也算进来
    currentUserChars = allChars.filter(c => String(c.bindUser) === String(mask.id));
  } else {
    currentUserChars = allChars;
  }
  buildContactsFromChars(currentUserChars);

  // 恢复上次的聊天记录 / 好友 / 陌生网友（退出页面或切换 App 后不丢）
  const savedState = await loadInsChatState();
  if (savedState) {
    if (Array.isArray(savedState.friends)) {
      const ids = {};
      friends.forEach(f => { ids[f.id] = 1; });
      savedState.friends.forEach(f => { if (f && f.id && !ids[f.id]) { friends.push(f); ids[f.id] = 1; } });
    }
    if (Array.isArray(savedState.strangers)) {
      const ids = {};
      strangers.forEach(s => { ids[s.id] = 1; });
      savedState.strangers.forEach(s => { if (s && s.id && !ids[s.id]) { strangers.push(s); ids[s.id] = 1; } });
      strangers = strangers.slice(0, 40);
    }
    if (savedState.chatHistories && typeof savedState.chatHistories === 'object') {
      Object.keys(savedState.chatHistories).forEach(k => {
        if (!chatHistories[k] || !chatHistories[k].length) chatHistories[k] = savedState.chatHistories[k];
      });
    }
    if (Array.isArray(savedState.followed)) followedUsers = savedState.followed.slice();
    if (Array.isArray(savedState.savedPosts)) savedPosts = savedState.savedPosts.slice();
    insPendingReplies = (savedState.pending && typeof savedState.pending === 'object') ? savedState.pending : {};
  }

  // 帖子也持久化：清空或删除后回来不会又恢复成初始帖子
  if (savedState && Array.isArray(savedState.posts)) {
    posts = savedState.posts;
  } else {
    posts = [];
  }

  // 上次未完成的回复：回到页面后继续在后台生成
  Object.keys(insPendingReplies || {}).forEach(cid => {
    showLoading('正在恢复生成…');
    setTimeout(() => {
      Promise.resolve(requestChatReply(cid, true)).finally(function () { hideLoading(); });
    }, 900);
  });

  renderStories();
  refreshUserUI();
  renderFeed();
  renderProfileGrid();
  renderDMList();
  renderSuggestUsers();
  renderRecommendTags();
  renderDiscover();
}

function buildPostsFromChars(chars) {
  return [];
}

// ==================== 事件绑定 ====================
document.getElementById('commentInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); sendComment(); }
});
document.getElementById('chatInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
});
document.getElementById('menuModal').addEventListener('click', function (e) { if (e.target === this) closeModal('menuModal'); });
document.getElementById('editModal').addEventListener('click', function (e) { if (e.target === this) closeEditProfile(); });
document.getElementById('shareModal').addEventListener('click', function (e) { if (e.target === this) closeModal('shareModal'); });
document.getElementById('addTagModal').addEventListener('click', function (e) { if (e.target === this) closeModal('addTagModal'); });
document.getElementById('addTagInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); confirmAddTag(); }
});
[['pmImgEnabled', 'enabled'], ['pmNpcImg', 'npc'], ['pmStrangerImg', 'stranger']].forEach(function (pair) {
  const el = document.getElementById(pair[0]);
  if (el) el.addEventListener('change', function () {
    insImageSettings[pair[1]] = el.checked;
    saveImageSettings();
  });
});

window.addEventListener('message', function (event) {
  const d = event.data;
  if (!d) return;
  if (d.type === 'currentMaskChanged' || d.type === 'homeDataUpdated' || d.type === 'contactsDataUpdated') {
    loadInsData();
    return;
  }
  if (d.type === 'nano:insShown') { insBackground = false; return; }
  if (d.type === 'nano:insHidden') { insBackground = true; saveInsChatState(); return; }
});

// 页面被隐藏/卸载前再存一次，确保图片与状态不丢
window.addEventListener('pagehide', function () { saveInsChatState(); });
document.addEventListener('visibilitychange', function () { if (document.hidden) saveInsChatState(); });

// 后台生成完成 -> 通知父页面弹出“已完成”提示
function notifyInsDone(title, body, opts) {
  if (!insBackground) return;
  opts = opts || {};
  try { if (window.NanoNotify) window.NanoNotify.notify(title, body, { target: 'ins', channel: 'ins', avatar: opts.avatar || '', name: opts.name || title }); } catch (e) {}
}

// 暴露给 HTML 内联 onclick
window.goBack = goBack;
window.go = go;
window.openHome = openHome;
window.backToDiscover = backToDiscover;
window.openPublish = openPublish;
window.openDetail = openDetail;
window.detailBack = detailBack;
window.openCharProfile = openCharProfile;
window.charProfileBack = charProfileBack;
window.openMenu = openMenu;
window.closeModal = closeModal;
window.deletePost = deletePost;
window.sharePost = sharePost;
window.openShare = openShare;
window.switchShareTab = switchShareTab;
window.doShare = doShare;
window.toggleLike = toggleLike;
window.savePost = savePost;
window.setReply = setReply;
window.setReplyToReply = setReplyToReply;
window.sendComment = sendComment;
window.refreshComments = refreshComments;
window.switchProfileTab = switchProfileTab;
window.openProfileMenu = openProfileMenu;
window.clearContent = clearContent;
window.toggleTagManage = toggleTagManage;
window.deleteTag = deleteTag;
window.useTextImagePost = useTextImagePost;
window.openEditProfile = openEditProfile;
window.closeEditProfile = closeEditProfile;
window.saveEditProfile = saveEditProfile;
window.triggerAvatarUpload = triggerAvatarUpload;
window.onAvatarPicked = onAvatarPicked;
window.switchPublishTab = switchPublishTab;
window.previewImage = previewImage;
window.handleTagKey = handleTagKey;
window.publishPost = publishPost;
window.handleSearchKey = handleSearchKey;
window.doSearch = doSearch;
window.openTagResult = openTagResult;
window.refreshTagResult = refreshTagResult;
window.openAddTagModal = openAddTagModal;
window.confirmAddTag = confirmAddTag;
window.switchDmTab = switchDmTab;
window.refreshDM = refreshDM;
window.refreshFriendDMs = refreshFriendDMs;
window.refreshStrangerDMs = refreshStrangerDMs;
window.openInsEmojiPanel = openInsEmojiPanel;
window.closeInsEmojiPanel = closeInsEmojiPanel;
window.sendInsSticker = sendInsSticker;
window.openForumRefreshPicker = openForumRefreshPicker;
window.openDMRefreshPicker = openDMRefreshPicker;

// 双击 / 长按气泡：复制 / 引用 / 编辑 / 删除（与单聊一致的菜单）
(function () {
  let pressTimer = null;
  function openMsgMenu(row) {
    if (!row) return;
    const idx = parseInt(row.getAttribute('data-mi'), 10);
    const text = row.getAttribute('data-text') || '';
    const id = currentChatUser && currentChatUser.id;
    if (!id || isNaN(idx)) return;
    const h = chatHistories[id] || [];
    if (!h[idx]) return;
    const old = document.getElementById('insMsgMenu'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'insMsgMenu';
    ov.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center';
    ov.innerHTML = '<div style="width:220px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 16px 44px rgba(0,0,0,.25)">'
      + '<button data-act="copy" style="width:100%;height:48px;border:0;background:#fff;font-size:15px;border-bottom:1px solid #f0f0f0">复制</button>'
      + '<button data-act="quote" style="width:100%;height:48px;border:0;background:#fff;font-size:15px;border-bottom:1px solid #f0f0f0">引用</button>'
      + '<button data-act="edit" style="width:100%;height:48px;border:0;background:#fff;font-size:15px;border-bottom:1px solid #f0f0f0">编辑</button>'
      + '<button data-act="del" style="width:100%;height:48px;border:0;background:#fff;font-size:15px;color:#e0245e">删除</button>'
      + '</div>';
    ov.addEventListener('click', function (e) {
      if (e.target === ov) { ov.remove(); return; }
      const a = e.target.getAttribute('data-act');
      if (!a) return;
      if (a === 'copy') { try { navigator.clipboard.writeText(text); } catch (err) {} showToast('已复制'); }
      else if (a === 'quote') {
        showInsQuote({ name: (h[idx].from === 'out' ? userProfile.name : (currentChatUser && currentChatUser.name) || ''), text: text });
        const inp = document.querySelector('.chat-input-bar input'); if (inp) inp.focus();
      }
      else if (a === 'edit') { const nt = window.prompt('编辑这条消息', text); if (nt != null) { h[idx].text = nt; try { saveInsChatState(); } catch (err) {} renderChatBody(); } }
      else if (a === 'del') { h.splice(idx, 1); try { saveInsChatState(); } catch (err) {} renderChatBody(); }
      ov.remove();
    });
    document.body.appendChild(ov);
  }
  document.addEventListener('dblclick', function (e) { const row = e.target.closest('.msg-row[data-mi]'); if (row) openMsgMenu(row); });
  document.addEventListener('touchstart', function (e) {
    const row = e.target.closest('.msg-row[data-mi]'); if (!row) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(function () { openMsgMenu(row); }, 480);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(function (ev) {
    document.addEventListener(ev, function () { clearTimeout(pressTimer); pressTimer = null; }, { passive: true });
  });
})();
window.confirmForumRefresh = confirmForumRefresh;
window.openChat = openChat;
window.sendChatMessage = sendChatMessage;
window.rerollLastReply = rerollLastReply;
window.updateChatBtn = updateChatBtn;
window.refreshArea = refreshArea;
window.showToast = showToast;
window.renderDiscover = renderDiscover;
window.discoverRefresh = discoverRefresh;

// ==================== 启动 ====================
loadInsData().catch(function (e) {
  console.error('ins 初始化失败:', e);
  refreshUserUI();
  renderFeed();
  renderDMList();
  renderRecommendTags();
  renderDiscover();
});

})();