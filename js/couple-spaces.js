/* ==========================================================
   Couple Space v17
   - 首次进入 = 选择页
   - 选择页有返回按钮
   - 只显示头像 + 昵称
   - 所有弹窗走 fullpage 全屏页
   - 移除全部内置 mock 数据
   ========================================================== */

/* ---------- 数据源读取层 ---------- */
const DB = {
  async getMasks() {
    try {
      const raw = localStorage.getItem('nano_mask_data')
        || localStorage.getItem('nano_home_data')
        || localStorage.getItem('peach_home_data');
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) return d.masks;
      }
    } catch (e) { console.warn('[CoupleSpace] getMasks failed', e); }
    return [];
  },
  async getCurrentMaskId() {
    try {
      const raw = localStorage.getItem('nano_mask_data')
        || localStorage.getItem('nano_home_data')
        || localStorage.getItem('peach_home_data');
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.currentMaskId) return d.currentMaskId;
      }
    } catch (e) {}
    return null;
  },
  async getMaskAvatar(maskId) {
    if (!maskId) return '';
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('MaskAvatarDB');
        req.onerror = () => resolve('');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('avatars')) { resolve(''); return; }
          try {
            const tx = db.transaction('avatars', 'readonly');
            const store = tx.objectStore('avatars');
            const getReq = store.get(maskId);
            getReq.onsuccess = () => {
              const r = getReq.result;
              if (!r) { resolve(''); return; }
              if (typeof r === 'string') { resolve(r); return; }
              resolve(r.data || r.dataURL || '');
            };
            getReq.onerror = () => resolve('');
          } catch (e) { resolve(''); }
        };
      } catch (e) { resolve(''); }
    });
  },
  async getMaskBackup() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('nano_mask_db');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('mask_data')) { resolve(null); return; }
          try {
            const tx = db.transaction('mask_data', 'readonly');
            const store = tx.objectStore('mask_data');
            const getReq = store.get('data');
            getReq.onsuccess = () => resolve(getReq.result || null);
            getReq.onerror = () => resolve(null);
          } catch (e) { resolve(null); }
        };
      } catch (e) { resolve(null); }
    });
  },
  async getCharacters() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('nano_characters_db');
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('characters')) { resolve([]); return; }
          try {
            const tx = db.transaction('characters', 'readonly');
            const store = tx.objectStore('characters');
            const allReq = store.getAll();
            allReq.onsuccess = () => resolve(allReq.result || []);
            allReq.onerror = () => resolve([]);
          } catch (e) { resolve([]); }
        };
      } catch (e) { resolve([]); }
    });
  },
  async getWorldbook() {
    try {
      const raw = localStorage.getItem('nano_worldbook_data_v5');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('nano_worldbook_db');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('worldbook_data')) { resolve(null); return; }
          try {
            const tx = db.transaction('worldbook_data', 'readonly');
            const store = tx.objectStore('worldbook_data');
            const getReq = store.get('data');
            getReq.onsuccess = () => resolve(getReq.result || null);
            getReq.onerror = () => resolve(null);
          } catch (e) { resolve(null); }
        };
      } catch (e) { resolve(null); }
    });
  },
  async getApiData() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('nano_api_db');
        req.onerror = () => resolve({});
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('api_data')) { resolve({}); return; }
          try {
            const tx = db.transaction('api_data', 'readonly');
            const store = tx.objectStore('api_data');
            const allReq = store.getAll();
            allReq.onsuccess = () => {
              const out = {};
              (allReq.result || []).forEach((r) => { out[r.key] = r.value; });
              resolve(out);
            };
            allReq.onerror = () => resolve({});
          } catch (e) { resolve({}); }
        };
      } catch (e) { resolve({}); }
    });
  },
  async getMainApiConfig() {
    const data = await this.getApiData();
    const cfg = data['nano_api_config'] || {};
    const assign = data['nano_api_assign'] || {};
    const presets = data['nano_api_presets_data'] || {};
    let mainUrl = cfg.mainUrl || '';
    let mainKey = cfg.mainKey || '';
    let mainModel = cfg.mainModel || '';
    let mainTemp = cfg.mainTemp ?? 0.8;
    if (presets.main_ && presets.main_.url) {
      mainUrl = presets.main_.url;
      mainKey = presets.main_.key || mainKey;
      mainModel = presets.main_.model || mainModel;
      mainTemp = presets.main_.temp ?? mainTemp;
    }
    return { mainUrl, mainKey, mainModel, mainTemp, assign };
  }
};

/* ---------- 内部身份 / 主 API / 世界书 ---------- */
let userProfile = { id: 'me', name: '我', avatar: '', setting: '' };
let worldbooks = [];

function readHomeData() {
  const keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
  for (let i = 0; i < keys.length; i++) {
    try {
      const raw = localStorage.getItem(keys[i]);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) {
          if (i > 0) { try { localStorage.setItem('nano_mask_data', JSON.stringify(d)); } catch (e) {} }
          return d;
        }
      }
    } catch (e) {}
  }
  return null;
}

function getCurrentMask() {
  const d = readHomeData();
  if (!d) return null;
  const masks = d.masks || [];
  if (d.currentMaskId) {
    const hit = masks.find((m) => m.id === d.currentMaskId);
    if (hit) return hit;
  }
  return masks[0] || null;
}

async function loadUserProfile() {
  const mask = getCurrentMask();
  if (!mask) { userProfile = { id: 'me', name: '我', avatar: '', setting: '' }; return userProfile; }
  let avatar = mask.avatar || '';
  if (!avatar) avatar = await DB.getMaskAvatar(mask.id);
  userProfile = {
    id: mask.id || 'me',
    name: mask.name || '我',
    avatar: avatar || '',
    setting: mask.setting || '',
    gender: mask.gender || ''
  };
  return userProfile;
}

function normalizeWorldbook(f) {
  if (!f) return null;
  const entries = Array.isArray(f.entries) ? f.entries : [];
  const content = typeof f.content === 'string' ? f.content : '';
  let list = entries.filter((e) => e && e.content && String(e.content).trim());
  if (!list.length && content && content.trim()) {
    list = [{ title: f.name || '', keywords: '', keywordEnabled: false, permanent: true, content: content }];
  }
  if (!list.length) return null;
  return {
    id: f.id,
    name: f.name || '未命名',
    scope: f.scope || 'global',
    boundCharacters: Array.isArray(f.boundCharacters) ? f.boundCharacters : [],
    entries: list
  };
}

async function loadWorldbooks() {
  let data = null;
  try {
    const raw = localStorage.getItem('nano_worldbook_data_v5');
    if (raw) data = JSON.parse(raw);
  } catch (e) {}
  if (!data || !Array.isArray(data.files)) {
    const idbData = await DB.getWorldbook();
    if (idbData && Array.isArray(idbData.files)) data = idbData;
    else if (idbData && idbData.value && Array.isArray(idbData.value.files)) data = idbData.value;
  }
  worldbooks = (data && Array.isArray(data.files) ? data.files : []).map(normalizeWorldbook).filter(Boolean);
  return worldbooks;
}

function entryKeywordHit(entry, recentText) {
  const kw = (entry.keywords || '').trim();
  if (!kw) return false;
  const lower = String(recentText || '').toLowerCase();
  return kw.split(/[,，、；\s]+/).filter(Boolean).some((k) => lower.indexOf(k.toLowerCase()) > -1);
}

function shouldIncludeEntry(entry, recentText) {
  if (entry.enabled === false) return false;
  if (!entry.content || !String(entry.content).trim()) return false;
  if (entry.permanent === true) return true;
  if (entry.keywordEnabled !== false) {
    if (!(entry.keywords || '').trim()) return true;
    return entryKeywordHit(entry, recentText);
  }
  return true;
}

function getWorldbookText(recentText) {
  const c = state && state.char ? state.char : {};
  const idCandidates = [c.id, c.name].filter(Boolean).map(String);
  const bindIds = {};
  try {
    ((c.worldbookBindings) || []).forEach((b) => { if (b && b.id) bindIds[String(b.id)] = true; });
  } catch (e) {}
  const parts = [];
  worldbooks.forEach((w) => {
    if (!w) return;
    if ((w.scope || 'global') === 'local') {
      const bound = bindIds[String(w.id)] || w.boundCharacters.some((b) => idCandidates.indexOf(String(b)) !== -1);
      if (!bound) return;
    }
    w.entries.forEach((en) => {
      if (!shouldIncludeEntry(en, recentText)) return;
      const text = (en.title ? '【' + en.title + '】\n' : '') + String(en.content || '').trim();
      if (text) parts.push(text);
    });
  });
  return parts.join('\n\n');
}

function resolveApiHost(rawUrl) {
  try {
    const s = String(rawUrl || '').trim();
    if (!s) return s;
    const u = new URL(s);
    const host = u.hostname;
    const cur = window.location.hostname;
    const isLan = cur && (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(cur) || /^10\./.test(cur) || /^192\.168\./.test(cur) || /^172\.(1[6-9]|2\d|3[01])\./.test(cur) || /\.local$/.test(cur));
    // 仅当页面也在本地/局域网时才把 localhost 换成当前主机，公网域名下保留原地址
    if ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && isLan) {
      u.hostname = cur;
    }
    return u.toString();
  } catch (e) { return rawUrl; }
}

function toV1Base(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(s)) s += '/v1';
  return s;
}

async function getApiConfig() {
  let cfg = null;
  let presets = null;
  try {
    const data = await DB.getApiData();
    cfg = data['nano_api_config'] || null;
    presets = data['nano_api_presets_data'] || null;
  } catch (e) {}
  if (!cfg) {
    try { const raw = localStorage.getItem('nano_api_config'); if (raw) cfg = JSON.parse(raw); } catch (e) {}
  }
  let mainUrl = cfg && cfg.mainUrl ? cfg.mainUrl : '';
  let mainKey = cfg && cfg.mainKey ? cfg.mainKey : '';
  let mainModel = cfg && cfg.mainModel ? cfg.mainModel : '';
  let mainTemp = cfg && cfg.mainTemp != null ? cfg.mainTemp : 0.8;
  const preset = presets && (presets.main_ || presets.main);
  if (preset && preset.url) {
    mainUrl = preset.url;
    mainKey = preset.key || mainKey;
    mainModel = preset.model || mainModel;
    if (preset.temp != null) mainTemp = preset.temp;
  }
  return { mainUrl, mainKey, mainModel, mainTemp };
}

/* ---------- API 错误说明 ---------- */
function describeHttpError(status) {
  const map = {
    400: '请求参数错误（400）：发送给模型的内容或参数格式不正确，可以缩短内容或检查题目内容后重试。',
    401: '未授权（401）：API Key 无效、缺失或已过期，请到「API」页面重新填写主模型的 Key。',
    402: '欠费（402）：API 账户余额不足，请先充值后再试。',
    403: '无权限（403）：当前 Key 没有访问该接口或该模型的权限，请更换 Key 或模型。',
    404: '接口不存在（404）：API 地址或模型名错误。请检查地址是否以 /v1 结尾、模型名是否填写正确。',
    408: '请求超时（408）：连接模型服务器超时，请检查网络后重试。',
    409: '请求冲突（409）：服务器检测到重复或冲突的请求，请稍后再试。',
    413: '内容过大（413）：本次内容超过接口限制，请减少内容后重试。',
    429: '请求过多 / 额度不足（429）：触发了速率限制或额度用尽，请稍后再试，或检查账户额度。',
    500: '服务器内部错误（500）：模型服务端出错，请稍后重试。',
    502: '网关错误（502）：中转服务器异常，请稍后重试或更换 API 地址。',
    503: '服务不可用（503）：模型服务过载或维护中，请稍后重试。',
    504: '网关超时（504）：模型生成过慢或上游无响应，请稍后重试，或换一个更快的模型。'
  };
  return map[status] || ('请求失败（' + status + '）：未知错误，请根据状态码排查 API 配置。');
}

function extractApiErrorMessage(text) {
  try {
    const d = JSON.parse(text || '{}');
    return (d && d.error && d.error.message) || (d && d.message) || '';
  } catch (e) { return ''; }
}

/* ---------- 单次请求 / 后台不中断 / 断点恢复 ---------- */
function csResultKey(token) { return 'cs_api_result_' + token; }
function csPendingGet() { try { return JSON.parse(localStorage.getItem('cs_api_pending') || 'null'); } catch (e) { return null; } }
function csPendingSet(v) { try { if (v) localStorage.setItem('cs_api_pending', JSON.stringify(v)); else localStorage.removeItem('cs_api_pending'); } catch (e) {} }
function csTakeResult(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    return JSON.parse(raw);
  } catch (e) { return null; }
}

try{ if(window.NanoRefresh) window.NanoRefresh.define({ id:'couple', name:'情侣空间', url:'couple-spaces.html', title:'Couple Spaces' }); }catch(e){}
function sendProxyRequest(payload) {
  return new Promise(function (resolve) {
    const resultKey = payload.resultKey;
    let settled = false;
    let poll = null;
    function finish(res) {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      window.removeEventListener('message', onMsg);
      resolve(res);
    }
    function take() {
      const r = csTakeResult(resultKey);
      if (r) { finish(r); return true; }
      return false;
    }
    function onMsg(e) {
      const d = e && e.data;
      if (d && d.type === 'chatApiDone' && d.token === payload.token) {
        if (!take()) finish({ ok: false, status: 0, error: '未取到结果' });
      }
    }
    if (take()) return;
    window.addEventListener('message', onMsg);
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'chatApiFetch', token: payload.token, resultKey: resultKey,
          url: payload.url, method: payload.method, headers: payload.headers, body: payload.body
        }, '*');
      } catch (e) {
        finish({ ok: false, status: 0, error: '无法发起请求' });
        return;
      }
      let tries = 0;
      poll = setInterval(function () {
        tries++;
        if (take()) return;
        if (tries > 900) finish({ ok: false, status: 0, error: '请求超时（超过 15 分钟）' });
      }, 1000);
    } else {
      fetch(payload.url, { method: payload.method, headers: payload.headers, body: payload.body })
        .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }); })
        .catch(function (err) { return { ok: false, status: 0, error: String((err && err.message) || err) }; })
        .then(finish);
    }
  });
}

// 每个动作只允许一次 API 调用；请求由父页面发起，切页/切出 App 不中断
async function callMainApi(messages, opts) {
  opts = opts || {};
  if (apiInFlight) throw new Error('上一次请求还在进行中，请稍候…');
  try{ if(window.NanoRefresh) NanoRefresh.start({ key:'cs', label:'生成' }); }catch(e){}
  const inflight = csPendingGet();
  if (inflight && !csTakeResult(inflight.resultKey)) {
    throw new Error('上一次请求还在进行中，请稍候…');
  }
  const cfg = await getApiConfig();
  if (!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) {
    throw new Error('未配置主 API。请先到「API」页面填写主模型的地址、Key 和模型名，并点击保存。');
  }
  const baseUrl = toV1Base(resolveApiHost(cfg.mainUrl));
  const headers = { 'Authorization': 'Bearer ' + String(cfg.mainKey).trim(), 'Content-Type': 'application/json' };
  const model = opts.model || cfg.mainModel;
  const temp = opts.temp != null ? opts.temp : (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : (parseFloat(cfg.mainTemp) || 0.8));
  const baseMax = Math.max(400, Number(opts.maxTokens) || 900);
  const budgets = opts.retryOnLength === false ? [baseMax] : [baseMax, Math.min(12000, Math.round(baseMax * 1.8))];
  const endpoint = baseUrl + '/chat/completions';
  apiInFlight = true;
  let lastContent = '';
  try {
    for (let bi = 0; bi < budgets.length; bi++) {
      let useJson = !!opts.json;
      for (;;) {
        const token = 'csreq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const resultKey = csResultKey(token);
        const payload = {
          model: model,
          messages: messages,
          max_tokens: budgets[bi],
          temperature: temp
        };
        if (useJson) payload.response_format = { type: 'json_object' };
        csPendingSet({ kind: opts.kind || '', token: token, resultKey: resultKey, ts: Date.now() });
        let result;
        try {
          result = await sendProxyRequest({
            token: token, resultKey: resultKey,
            url: endpoint,
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
          });
        } finally {
          csPendingSet(null);
        }
        if (!result) throw new Error('请求没有返回结果，请重试。');
        if (result.error) throw new Error('网络错误：' + result.error + '\n请检查网络连接，或确认 API 地址在手机上可访问（localhost 需改成电脑局域网 IP）。');
        if (!result.ok) {
          const apiMsg = extractApiErrorMessage(result.text);
          const e = new Error(describeHttpError(result.status) + (apiMsg ? '\n\n服务端返回：' + apiMsg : '') + '\n\n请求地址：' + endpoint + '\n模型：' + model);
          e.status = result.status; e.body = String(result.text || '');
          // 兼容接口不支持 response_format 时去掉它再试一次
          if (useJson && /response_format|json_object|400|invalid|unsupported|unknown/i.test(String(apiMsg + result.text))) {
            useJson = false;
            continue;
          }
          throw e;
        }
        let data = null;
        try { data = JSON.parse(result.text || '{}'); } catch (e) { throw new Error('接口返回的内容不是合法的 JSON，可能不是兼容 OpenAI 的接口。\n\n原始返回片段：' + String(result.text || '').slice(0, 300)); }
        const choice = (data.choices && data.choices[0]) || {};
        const msg = choice.message || {};
        const content = msg.content || choice.text || msg.reasoning_content || '';
        if (!content) throw new Error('模型没有返回可用内容（choices 为空）。可能触发了内容过滤、达到长度上限或模型参数不兼容。');
        lastContent = content;
        // 被 max_tokens 截断：用更大的预算再试一次；最后一次仍截断则返回已生成内容。
        if (choice.finish_reason === 'length' && bi < budgets.length - 1) break;
        return content;
      }
    }
    return lastContent;
  } finally {
    apiInFlight = false;
  }
}

function repairJsonText(text) {
  let t = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
  t = t.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const first = t.search(/[\[{]/);
  if (first > 0) t = t.slice(first);
  let out = '', stack = [], inStr = false, esc = false, started = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; }
      else if (ch === '\\') { out += ch; esc = true; }
      else if (ch === '"') { out += ch; inStr = false; }
      else if (ch === '\n') { out += '\\n'; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\t') { out += '\\t'; }
      else out += ch;
    } else {
      if (ch === '"') { inStr = true; out += ch; }
      else if (ch === '{') { started = true; stack.push('}'); out += ch; }
      else if (ch === '[') { started = true; stack.push(']'); out += ch; }
      else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] === ch) stack.pop();
        out += ch;
        if (started && !stack.length) break;
      } else out += ch;
    }
  }
  if (inStr) { if (esc) out = out.slice(0, -1); out += '"'; }
  while (stack.length) out += stack.pop();
  return out.replace(/,\s*([}\]])/g, '$1');
}
function parseJsonLoose(text, fallback) {
  if (!text) return fallback;
  const t = String(text).trim();
  const starts = [t.indexOf('['), t.indexOf('{')].filter((i) => i > -1);
  const candidates = [t];
  if (starts.length) {
    const start = Math.min.apply(null, starts);
    const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
    if (end > start) candidates.push(t.slice(start, end + 1));
  }
  candidates.push(repairJsonText(t));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) {}
  }
  return fallback;
}

function buildCharSystem(extra, recentText) {
  const c = state && state.char ? state.char : {};
  const u = userProfile || {};
  const setting = c.setting || c.desc || c.persona || '';
  let p = '你是「' + (c.name || '角色') + '」，一个真实、有血有肉的人。你正在和「' + (u.name || '用户') + '」互动。\n';
  if (c.gender && c.gender !== '未知') p += '你的性别：' + c.gender + '。\n';
  if (c.nationality && c.nationality !== '未知') p += '你的国籍：' + c.nationality + '。\n';
  if (setting) {
    p += '\n【人物设定 · 必须严格遵守】\n以下是你唯一的完整人物设定，你的性格、说话方式、经历、三观都必须严格以此为准：\n' + setting + '\n';
  }
  const wb = getWorldbookText(recentText);
  if (wb) p += '\n【世界书 · 世界观与关系设定】\n' + wb + '\n（涉及世界观、关系、称呼、尺度时，以世界书为准。）\n';
  if (u.setting) p += '\n【对方（' + (u.name || '用户') + '）的设定】\n' + u.setting + '\n';
  const annivCtx = buildAnnivContext();
  if (annivCtx) p += '\n【你们的纪念日】\n' + annivCtx + '\n（这些日子对方很在意，可以自然地在聊天里提起。）\n';
  p += '\n【通用要求】只输出角色本人要说的话或内容本身；不要解释、不要旁白、不要输出 Markdown 代码块或思考过程。保持人物设定中的语气。';
  if (extra) p += '\n\n' + extra;
  return p;
}

/* ---------- 全局状态 ---------- */
const DB_NAME = 'NanoCoupleSpaceV10';
const DB_VER = 1;
const STORE = 'state';
let state = null;
let selectedChar = null;
let canvasCtx = null;
let drawing = false;
let letterTab = 'write';
let diaryTab = 'write';
let letterMore = false;
let diaryMore = false;
let letterSel = new Set();
let diarySel = new Set();
let maskList = [];
let currentMaskId = null;
let charList = [];
let currentMask = null;
let entered = false;
let pickMode = false;
let busy = false;
let apiInFlight = false;
let resumePoll = null;
let activePageType = null;

const defaultState = () => ({
  version: 17,
  char: null,
  survey: { round: 1, questions: null, user: [], char: [], status: 'idle', result: null },
  personality: { round: 1, questions: null, user: [], char: [], result: null, status: 'idle' },
  draw: {
    round: 1, role: 'user', word: '',
    drawing: null, guess: null, result: null,
    chat: [], status: 'idle'
  },
  judge: { case: '', user: '', char: '', verdict: null, danmu: [], status: 'idle' },
  letters: { current: { user: '', char: '', userLocked: false, charLocked: false, unlocked: false }, history: [] },
  diaries: { current: { user: '', char: '', userLocked: false, charLocked: false, unlocked: false }, history: [] },
  stats: { exchange: 0, complete: 0 },
  events: [],
  anniversaries: [],
  annivSince: '',
  annivCharId: ''
});

/* ---------- 纪念日 ---------- */
function toDateStr(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const x = isNaN(dt) ? new Date() : dt;
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
// 尝试从角色数据里找出「添加 char 的时间」
function charSinceDate(c) {
  if (!c) return null;
  const raw = c.createdAt || c.created || c.addedAt || c.time || c.ts;
  if (raw) { const d = new Date(raw); if (!isNaN(d)) return d; }
  // 新建角色的 id 形如 c + 时间戳
  const m = String(c.id || '').match(/^c(\d{10,})/);
  if (m) { const d2 = new Date(Number(m[1])); if (!isNaN(d2) && d2.getFullYear() > 2000) return d2; }
  return null;
}
// 内置的「相识纪念日」：从添加 char 那天算起，换 char 会重算
function ensureAnnivBase() {
  if (!state || !state.char) return;
  const cid = String(state.char.id || state.char.name || '');
  if (state.annivSince && state.annivCharId === cid) return;
  const d = charSinceDate(state.char) || new Date();
  state.annivCharId = cid;
  state.annivSince = toDateStr(d);
}
function daysBetween(fromStr) {
  const f = new Date(String(fromStr) + 'T00:00:00');
  if (isNaN(f)) return 0;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - f) / 86400000);
  return diff < 0 ? 0 : diff;
}
function daysToNext(dateStr) {
  const d = new Date(String(dateStr) + 'T00:00:00');
  if (isNaN(d)) return 0;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.round((next - now) / 86400000);
}
function nextUpcomingAnniv(list) {
  let best = null;
  (list || []).forEach((a) => {
    if (!a || !a.repeat) return;
    const days = daysToNext(a.date);
    if (!best || days < best.days) best = { title: a.title || '纪念日', days: days };
  });
  return best;
}
function buildAnnivContext() {
  if (!state || !state.char) return '';
  ensureAnnivBase();
  const lines = [];
  if (state.annivSince) lines.push('相识纪念日：' + state.annivSince + '（已 ' + daysBetween(state.annivSince) + ' 天）');
  (state.anniversaries || []).forEach((a) => {
    if (!a) return;
    let extra = '';
    if (a.repeat) { const n = daysToNext(a.date); extra = n === 0 ? '（就是今天）' : ('（还有 ' + n + ' 天）'); }
    lines.push((a.title || '纪念日') + '：' + a.date + extra);
  });
  return lines.join('\n');
}
function shareAnnivToChar(id) {
  if (!state || !state.char) return;
  ensureAnnivBase();
  const name = state.char.name || 'Char';
  const isBuiltin = (id === 'builtin');
  const a = isBuiltin ? null : (state.anniversaries || []).find((x) => x.id === id);
  if (!isBuiltin && !a) return;
  const title = isBuiltin ? '相识纪念日' : (a.title || '纪念日');
  const date = isBuiltin ? state.annivSince : a.date;
  const days = (isBuiltin || !a.repeat) ? daysBetween(date) : daysToNext(date);
  let summary;
  if (isBuiltin) summary = '你和 ' + name + ' 已经认识 ' + days + ' 天';
  else if (a.repeat) summary = date + ' · ' + (days === 0 ? '就是今天' : ('还有 ' + days + ' 天'));
  else summary = date + ' · 已 ' + days + ' 天';
  const detail = '【纪念日】' + title + '\n日期：' + date +
    (isBuiltin ? ('\n你们已经认识 ' + days + ' 天') : (a.repeat ? '\n每年重复' : ''));
  shareCardToChat('anniv', title, summary, detail);
}
function annivCardHTML() {
  ensureAnnivBase();
  const total = daysBetween(state.annivSince);
  const next = nextUpcomingAnniv(state.anniversaries);
  let sub = state.annivSince + ' 相识';
  if (next) sub = next.title + ' · ' + (next.days === 0 ? '就是今天' : (next.days + ' 天后'));
  return `<div class="anniv-card" onclick="openPage('anniv')">
    <div class="anniv-days"><b>${total}</b><small>天</small></div>
    <div class="anniv-info"><b>相识纪念日</b><span>${esc(sub)}</span></div>
    <div class="anniv-arrow">›</div>
  </div>`;
}

/* ---------- IndexedDB ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet() {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readonly');
    const r = t.objectStore(STORE).get('main');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(v) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(v, 'main');
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
async function save() { await dbPut(state); renderRoot(); }

/* ---------- 轻提示 / 忙碌态 ---------- */
function toast(msg, ms) {
  let el = document.getElementById('csToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'csToast';
    el.className = 'cs-toast';
    document.body.appendChild(el);
  }
  el.textContent = String(msg || '');
  el.classList.add('show');
  clearTimeout(el.__t);
  el.__t = setTimeout(() => el.classList.remove('show'), ms || 1800);
}

function setBusy(on, label) {
  busy = !!on;
  let el = document.getElementById('csWorking');
  if (on) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'csWorking';
      el.className = 'cs-working';
      el.innerHTML = '<span class="cs-spinner"></span><span id="csWorkingText"></span>';
      document.body.appendChild(el);
    }
    const t = document.getElementById('csWorkingText');
    if (t) t.textContent = label || '处理中…';
    el.classList.add('show');
  } else if (el) {
    el.classList.remove('show');
  }
}

/* ---------- 同风格错误弹窗 ---------- */
function showErrorDialog(title, message, hint) {
  let ov = document.getElementById('csModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'csModal';
    ov.className = 'cs-modal';
    ov.innerHTML =
      '<div class="cs-modal-card">' +
        '<div class="cs-modal-icon">!</div>' +
        '<div class="cs-modal-title" id="csModalTitle"></div>' +
        '<div class="cs-modal-body" id="csModalBody"></div>' +
        '<div class="cs-modal-hint" id="csModalHint"></div>' +
        '<button class="cs-modal-btn" id="csModalBtn">我知道了</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov) closeErrorDialog();
    });
    const btn = document.getElementById('csModalBtn');
    if (btn) btn.addEventListener('click', closeErrorDialog);
  }
  const t = document.getElementById('csModalTitle');
  const b = document.getElementById('csModalBody');
  const h = document.getElementById('csModalHint');
  if (t) t.textContent = title || '出错了';
  if (b) b.textContent = message || '未知错误';
  if (h) { h.textContent = hint || ''; h.style.display = hint ? 'block' : 'none'; }
  ov.classList.add('show');
}
function closeErrorDialog() {
  const ov = document.getElementById('csModal');
  if (ov) ov.classList.remove('show');
}

function openChatWithChar() {
  if (!state.char) return;
  const c = state.char;
  const chatId = String(c.id || c.name || 'default');
  const payload = { type: 'openChat', chatId: chatId, chatName: c.name || '聊天', chatAvatar: c.avatar || '' };
  try {
    if (window.parent && window.parent !== window) { window.parent.postMessage(payload, '*'); return; }
  } catch (e) {}
  toast('未在 App 内打开，无法跳转到私聊');
}

function shareCardToChat(kind, title, summary, detail) {
  if (!state.char) { toast('请先选择一个 Char'); return; }
  const c = state.char;
  const chatId = String(c.id || c.name || 'default');
  const card = {
    shareId: kind + '|' + Date.now(),
    kind: kind,
    title: title || '情侣空间',
    summary: String(summary || '').slice(0, 400),
    detail: String(detail || summary || '').slice(0, 2000),
    at: new Date().toISOString()
  };
  try {
    sessionStorage.setItem('nano_pending_couple_share', JSON.stringify({
      chatId: chatId, chatName: c.name || '', card: card, ts: Date.now()
    }));
  } catch (e) {}
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'openChat', chatId: chatId, chatName: c.name || '聊天', chatAvatar: c.avatar || '' }, '*');
      setTimeout(() => {
        try { window.parent.postMessage({ type: 'NANO_COUPLE_SHARE_CARD', chatId: chatId, card: card }, '*'); } catch (e) {}
      }, 450);
      toast('已分享给 ' + (c.name || 'Char'));
      return;
    }
  } catch (e) {}
  toast('已生成分享卡片（未在 App 内，无法跳转私聊）');
}

function fallbackAvatar(name) {
  const ch = String(name || 'C').trim().slice(0, 1) || 'C';
  const safe = ch.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
    '<rect width="120" height="120" fill="#f3cfd8"/>' +
    '<text x="60" y="62" font-size="54" font-family="PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">' + safe + '</text>' +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---------- 渲染入口 ---------- */
function renderRoot() {
  if (!state.char || !entered) {
    renderCharSelect();
    return;
  }
  renderHome();
}

function renderCharSelect() {
  if (pickMode) { renderCharPicker(); return; }
  const u = userProfile || {};
  const meAv = u.avatar || fallbackAvatar(u.name || '我');
  const c = selectedChar || state.char || charList[0] || null;

  if (!c) {
    document.getElementById('root').innerHTML = `
    <main class="app selectchar">
      <div class="top">
        <button class="back-home" onclick="backToDiscover()" aria-label="返回发现">‹</button>
        <div class="me-chip">
          <img class="avatar me-avatar" src="${esc(meAv)}">
          <span class="me-name">${esc(u.name || '我')}</span>
        </div>
        <div class="eyebrow">NANO · COUPLE SPACE</div>
        <h1>邀请 TA 开通情侣空间</h1>
        <p>还没有可邀请的 Char。请先在角色库中创建或绑定一个角色。</p>
      </div>
    </main>`;
    return;
  }

  const cid = String(c.id || c.name || 'default');
  let invite = null;
  try { invite = JSON.parse(localStorage.getItem('nano_couple_invite_' + cid) || 'null'); } catch (e) {}
  const accepted = !!(invite && invite.status === 'accepted');
  const rejected = !!(invite && invite.status === 'rejected');
  const pending = !!(invite && invite.status === 'pending');

  document.getElementById('root').innerHTML = `
  <main class="app selectchar">
    <div class="top">
      <button class="back-home" onclick="backToDiscover()" aria-label="返回发现">‹</button>
      <div class="me-chip">
        <img class="avatar me-avatar" src="${esc(meAv)}">
        <span class="me-name">${esc(u.name || '我')}</span>
      </div>
      <div class="eyebrow">NANO · COUPLE SPACE</div>
      <h1>邀请 TA 开通情侣空间</h1>
      <p>情侣空间只属于你和 TA。先发一张邀请卡片到 TA 的私聊，由 TA 决定要不要和你开通，不会对其他人开放。</p>
    </div>
    <div class="charlist">
      <div class="charitem active">
        <span class="ct"><b>${esc(c.name)}</b></span>
        <img class="avatar" src="${esc(c.avatar || fallbackAvatar(c.name))}">
        <i class="radio"></i>
      </div>
    </div>
    ${accepted
      ? `<button class="btn dark enter" onclick="enterSpace()">TA 已同意 · 进入情侣空间</button>`
      : (pending
        ? `<button class="btn dark enter" onclick="openChatWithChar()">去私聊等 TA 回复</button>
           <button class="btn" style="margin-top:10px;background:#f3eeea;color:#8a8280" onclick="sendCoupleInvite()">重新发送邀请卡</button>`
        : `<button class="btn dark enter" onclick="sendCoupleInvite()">发送邀请卡给 TA</button>`)}
    ${rejected ? `<div class="hint" style="text-align:center;color:#c98b8b;font-size:12px;margin-top:12px">TA 这一次没有答应。可以再聊聊，或稍后再邀请。</div>` : ''}
    <button class="btn" style="margin-top:10px;background:#f3eeea;color:#8a8280" onclick="openCharPicker()">换一位 Char</button>
  </main>`;
}

function sendCoupleInvite() {
  const c = selectedChar || state.char || charList[0] || null;
  if (!c) { toast('没有可邀请的 Char'); return; }
  state.char = c;
  selectedChar = c;
  const cid = String(c.id || c.name || 'default');
  try { localStorage.setItem('nano_couple_invite_' + cid, JSON.stringify({ status: 'pending', at: Date.now() })); } catch (e) {}
  shareCardToChat('invite', '情侣空间邀请',
    '邀请你开通只属于我们两个人的情侣空间',
    '我想和你开通一个只属于我们两个人的「情侣空间」：在里面一起做默契调查、记住纪念日、交换情书和日记。你愿意吗？');
  renderCharSelect();
}

// 角色在私聊里同意/拒绝后，回到本页自动刷新邀请状态
window.addEventListener('storage', function (e) {
  if (e && e.key && e.key.indexOf('nano_couple_invite_') === 0) {
    if (!entered) { try { renderCharSelect(); } catch (err) {} }
  }
});
window.addEventListener('focus', function () {
  if (!entered) { try { renderCharSelect(); } catch (err) {} }
});

function openCharPicker() {
  pickMode = true;
  renderCharSelect();
}

function renderCharPicker() {
  const list = charList.length ? charList : [];
  const u = userProfile || {};
  const meAv = u.avatar || fallbackAvatar(u.name || '我');

  document.getElementById('root').innerHTML = `
  <main class="app selectchar">
    <div class="top">
      <button class="back-home" onclick="cancelCharPicker()" aria-label="返回">‹</button>
      <div class="me-chip">
        <img class="avatar me-avatar" src="${esc(meAv)}">
        <span class="me-name">${esc(u.name || '我')}</span>
      </div>
      <div class="eyebrow">NANO · COUPLE SPACE</div>
      <h1>选择要邀请的 Char</h1>
      <p>只选择你希望开通情侣空间的那一位。确认后可以随时更换。</p>
    </div>
    <div class="charlist">
      ${list.length ? list.map((c, i) => `
        <button class="charitem ${selectedChar && selectedChar.id === c.id ? 'active' : ''}" onclick="chooseCharByIndex(${i})">
          <span class="ct"><b>${esc(c.name)}</b></span>
          <img class="avatar" src="${esc(c.avatar || fallbackAvatar(c.name))}">
          <i class="radio"></i>
        </button>
      `).join('') : `<div class="hint">未读取到角色，请先在角色库中创建角色。</div>`}
    </div>
  </main>`;
}

function cancelCharPicker() {
  pickMode = false;
  renderCharSelect();
}

function backToDiscover() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'backToDiscover' }, '*');
      return;
    }
  } catch (e) {}
  window.location.href='../index.html';
}

// 右滑返回：先关全屏子页 → 回到选择页 → 根页交给主框架关闭
window.__nanoInternalBack = function () {
  try {
    const fp = document.getElementById('fullpage');
    if (fp && fp.classList.contains('show')) { closePage(); return true; }
    if (pickMode) { cancelCharPicker(); return true; }
    if (entered) { entered = false; pickMode = false; renderCharSelect(); return true; }
  } catch (e) {}
  return false;
};

function chooseCharByIndex(i) {
  const c = charList[i];
  if (!c) return;
  selectedChar = c;
  pickMode = false;
  renderCharSelect();
}

async function enterSpace() {
  if (!selectedChar) selectedChar = state.char || charList[0] || null;
  if (!selectedChar) { toast('请选择一个 Char'); return; }
  state.char = selectedChar;
  ensureAnnivBase();
  entered = true;
  try { await loadUserProfile(); } catch (e) {}
  try { await loadWorldbooks(); } catch (e) {}
  await save();
  renderRoot();
}

function switchChar() {
  selectedChar = state.char || selectedChar;
  entered = false;
  pickMode = true;
  renderCharSelect();
}

function renderHome() {
  const c = state.char;
  const u = userProfile || {};
  document.getElementById('root').innerHTML = `
  <main class="app">
    <header>
      <button class="iconbtn" onclick="switchChar()">‹</button>
      <div class="logo">Couple Space</div>
      <button class="iconbtn dotsbtn" aria-label="设置" onclick="openPage('settings')"><i></i><i></i><i></i></button>
    </header>
    <section class="hero">
      <div class="eyebrow">A SPACE TO KNOW EACH OTHER</div>
      <h1>Know each other.</h1>
      <p>通过回答、猜测、交换和重新站到对方的位置上，慢慢知道彼此真正的样子。</p>
    </section>
    <div class="charline">
      <img class="avatar" src="${esc(c.avatar || fallbackAvatar(c.name))}">
      <span class="charname"><b>${esc(c.name)}</b></span>
      <button class="switch" onclick="openChatWithChar()">私聊</button>
      <button class="switch" onclick="switchChar()">切换 Char</button>
    </div>
    <div class="meline">
      <img class="avatar" src="${esc(u.avatar || fallbackAvatar(u.name || '我'))}">
      <span class="mename">你 · <b>${esc(u.name || '我')}</b></span>
    </div>
    <section class="section">
      <div class="head"><b>纪念日</b><span>ANNIVERSARY</span></div>
      ${annivCardHTML()}
    </section>
    <section class="section">
      <div class="head"><b>现在可以一起做</b><span>ACTIVE</span></div>
      <div class="feature">
        <div class="eyebrow">10 QUESTIONS · MUTUALITY</div>
        <h2>默契调查</h2>
        <p>每一轮都会获得一套新的十题。可以随机生成，也可以由外部 API 生成题目。</p>
        <button class="btn white" onclick="openPage('survey')">进入这一轮</button>
      </div>
    </section>
    <section class="section">
      <div class="head"><b>了解彼此</b><span>DISCOVER</span></div>
      <div class="grid">
        ${tile('01', '默契调查', '每次十题，独立回答后逐题比较。', 'survey', '开始')}
        ${tile('02', '情侣人格', '从双方选择计算你们的关系倾向。', 'personality', '测评')}
        ${tile('03', '审判庭', '写下事件，Char 回应，观众实时弹幕。', 'judge', '进入')}
        ${tile('04', '你画我猜', '真实绘画、猜测、回合与结果都会保存。', 'draw', '开始')}
      </div>
    </section>
    <section class="section">
      <div class="head"><b>交换</b><span>EXCHANGE</span></div>
      <div class="grid">
        ${tile('L', '情书互换', '封存双方的文字，全部完成后同时解锁。', 'letters', '写一封')}
        ${tile('D', '日记互换', '像翻开两本日记一样，看见对方的一天。', 'diary', '写日记')}
      </div>
    </section>
    <section class="section">
      <div class="head"><b>共同进度</b><span>LOCAL · INDEXEDDB</span></div>
      <div class="stats">
        <div class="stat"><b>${state.stats.exchange}</b><span>已交换</span></div>
        <div class="stat"><b>${state.stats.complete}</b><span>共同完成</span></div>
        <div class="stat"><b>${state.events.length}</b><span>记录</span></div>
      </div>
    </section>
  </main>`;
}

function tile(n, t, p, page, b) {
  return `<div class="tile" onclick="openPage('${page}')">
    <div class="index">${n}</div>
    <h3>${t}</h3>
    <p>${p}</p>
    <button>${b} →</button>
  </div>`;
}

/* ---------- 纪念日页面 ---------- */
function annivItemHTML(a) {
  const d = new Date(String(a.date) + 'T00:00:00');
  const day = isNaN(d) ? '--' : d.getDate();
  const mon = isNaN(d) ? '--' : (d.getMonth() + 1);
  let label;
  if (a.repeat) {
    const n = daysToNext(a.date);
    label = n === 0 ? '就是今天' : (n + ' 天后');
  } else {
    label = '已 ' + daysBetween(a.date) + ' 天';
  }
  return `<div class="anniv-item">
    <div class="ai-date"><b>${day}</b><small>${mon}月</small></div>
    <div class="ai-main"><b>${esc(a.title || '纪念日')}</b><span>${esc(a.date)}${a.repeat ? ' · 每年' : ''} · ${label}</span></div>
    <div class="ai-actions">
      <button class="ai-share" onclick="shareAnnivToChar('${esc(a.id)}')">分享</button>
      <button class="ai-del" onclick="delAnniversary('${esc(a.id)}')">删除</button>
    </div>
  </div>`;
}
function anniv() {
  ensureAnnivBase();
  const name = state.char ? esc(state.char.name || 'Char') : 'Char';
  const base = state.annivSince;
  const total = daysBetween(base);
  const list = (state.anniversaries || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const bd = new Date(String(base) + 'T00:00:00');
  const bDay = isNaN(bd) ? '--' : bd.getDate();
  const bMon = isNaN(bd) ? '--' : (bd.getMonth() + 1);
  const builtin = `<div class="anniv-item">
    <div class="ai-date"><b>${bDay}</b><small>${bMon}月</small></div>
    <div class="ai-main"><b>相识纪念日</b><span>${esc(base)} · 已 ${total} 天</span></div>
    <div class="ai-actions">
      <button class="ai-share" onclick="shareAnnivToChar('builtin')">分享</button>
    </div>
  </div>`;
  return `<div class="anniv-hero">
      <div class="eyebrow">SINCE ${esc(base)}</div>
      <div class="anniv-big">${total}<small>天</small></div>
      <p>你和 ${name} 已经认识 ${total} 天</p>
    </div>
    <div class="head" style="margin-top:22px"><b>我们的纪念日</b><span>DATES</span></div>
    ${builtin}
    ${list.length ? list.map(annivItemHTML).join('') : '<div class="hint" style="text-align:center;color:#a69b96;padding:14px 0 4px">还可以把别的重要日子记下来。</div>'}
    <div class="row"><button class="btn dark" onclick="toggleAnnivForm()">添加纪念日</button></div>
    <div class="anniv-form" id="annivForm" style="display:none">
      <input type="text" id="annivTitle" placeholder="名称，例如 第一次见面" maxlength="20">
      <input type="date" id="annivDate">
      <label class="anniv-check"><input type="checkbox" id="annivRepeat" checked> 每年重复提醒</label>
      <div class="row">
        <button class="btn soft" onclick="toggleAnnivForm()">取消</button>
        <button class="btn dark" onclick="addAnniversary()">保存</button>
      </div>
    </div>`;
}
function toggleAnnivForm() {
  const f = document.getElementById('annivForm');
  if (!f) return;
  const show = f.style.display === 'none' || !f.style.display;
  f.style.display = show ? 'flex' : 'none';
  if (show) {
    const dt = document.getElementById('annivDate');
    if (dt && !dt.value) dt.value = toDateStr(new Date());
  }
}
function addAnniversary() {
  const tEl = document.getElementById('annivTitle');
  const dEl = document.getElementById('annivDate');
  const rEl = document.getElementById('annivRepeat');
  const title = String(tEl ? tEl.value : '').trim();
  const date = String(dEl ? dEl.value : '').trim();
  if (!title) { toast('请输入纪念日名称'); return; }
  if (!date) { toast('请选择日期'); return; }
  state.anniversaries = state.anniversaries || [];
  state.anniversaries.push({ id: 'a' + Date.now(), title: title, date: date, repeat: !!(rEl && rEl.checked) });
  save().then(() => { openPage('anniv'); toast('已添加'); });
}
function delAnniversary(id) {
  state.anniversaries = (state.anniversaries || []).filter((a) => a.id !== id);
  save().then(() => { openPage('anniv'); });
}

/* ---------- 页面路由（统一走 fullpage） ---------- */
function stateKey(type) {
  return type === 'diary' ? 'diaries' : type === 'letters' ? 'letters' : null;
}

function openPage(type) {
  if (type === 'letters' || type === 'diary') { openFull(type); return; }
  const h = type === 'survey' ? survey()
    : type === 'personality' ? personality()
    : type === 'draw' ? draw()
    : type === 'judge' ? judge()
    : type === 'anniv' ? anniv()
    : settings();

  const titleMap = {
    survey: '默契调查',
    personality: '情侣人格',
    draw: '你画我猜',
    judge: '审判庭',
    anniv: '纪念日',
    settings: 'Space 设置'
  };
  const title = titleMap[type] || 'Couple Space';

  const fp = document.getElementById('fullpage');
  const inner = document.getElementById('fullpageInner');
  inner.innerHTML = `
    <header>
      <div class="left"><button class="backbtn" onclick="closePage()">‹</button></div>
      <b>${title}</b>
      <div class="right"></div>
    </header>
    ${h}
  `;
  fp.classList.add('show');
  activePageType = type;
  if (type === 'draw') initCanvas();
}

function closePage() {
  document.getElementById('fullpage').classList.remove('show');
  activePageType = null;
}

// API 完成后：只有用户仍停留在该页面时才刷新页面，否则只保存并提示，避免打断切换
function renderAfterApi(type) {
  try{ if(window.NanoRefresh) NanoRefresh.success('已生成，点「去看看」查看', { key:'cs' }); }catch(e){}
  if (activePageType === type) {
    if (type === 'letters' || type === 'diary') openFull(type);
    else openPage(type);
  }
}

function openFull(type) {
  const key = stateKey(type);
  if (!key) return;
  const fp = document.getElementById('fullpage');
  const inner = document.getElementById('fullpageInner');
  const isLetter = type === 'letters';
  const title = isLetter ? '情书互换' : '日记互换';
  const tab = isLetter ? letterTab : diaryTab;
  const more = isLetter ? letterMore : diaryMore;
  const sel = isLetter ? letterSel : diarySel;

  if (!state[key]) {
    state[key] = { current: { user: '', char: '', userLocked: false, charLocked: false, unlocked: false }, history: [] };
  }
  const cur = state[key].current;
  const count = state[key].history.length;

  const header = `<header>
    <div class="left"><button class="backbtn" onclick="closePage()">‹</button></div>
    <b>${title}</b>
    <div class="right"><button class="morebtn ${more ? 'more-x' : ''}" onclick="toggleMore('${type}')">${more ? '×' : '<i></i><i></i><i></i>'}</button></div>
  </header>`;

  let body = '';
  if (!more) {
    body += `<div class="exchange-hero">
      <div class="exchange-kicker">${isLetter ? 'PRIVATE LETTERS' : 'PRIVATE DIARY'}</div>
      <h3>${isLetter ? '把想说的话，认真写下来' : '把今天留在这里'}</h3>
      <p>${isLetter ? '双方都封存之后，才会一起拆开。每一封都只属于这一刻。' : '写下今天真正想留下的东西。交换完成后，它会成为你们共同的时间胶囊。'}</p>
      <span class="exchange-count">${count} ${isLetter ? '封' : '篇'}已保存</span>
    </div>
    <div class="tabs">
      <button class="${tab === 'write' ? 'active' : ''}" onclick="switchTab('${type}','write')">${isLetter ? '写情书' : '写日记'}</button>
      <button class="${tab === 'history' ? 'active' : ''}" onclick="switchTab('${type}','history')">时间轴</button>
    </div>`;
    body += tab === 'write' ? renderWrite(type, isLetter, cur) : renderHistory(type, isLetter, state[key].history, false, sel);
  } else {
    body = renderHistory(type, isLetter, state[key].history, true, sel);
  }

  const delbar = more && tab === 'history'
    ? `<div class="delbar">
        <button class="btn gray" onclick="toggleMore('${type}')">完成</button>
        <button class="btn dark" onclick="deleteSelected('${type}')">删除${sel.size ? `（${sel.size}）` : ''}</button>
      </div>`
    : '';

  inner.innerHTML = header + body + delbar;
  fp.classList.add('show');
  activePageType = type;
}

function renderWrite(type, isLetter, cur) {
  const name = esc(state.char.name);
  const shareBtn = `<div class="exchange-actions"><button class="btn soft" onclick="shareCurrent('${type}')">分享给 ${name}</button></div>`;
  const nextBtn = `<div class="exchange-actions"><button class="btn dark" onclick="startNewExchange('${type}')">${isLetter ? '再写一封情书' : '再写一篇日记'}</button></div>`;

  if (cur.unlocked) {
    return `<div class="exchange-status"><i class="dot"></i><b>这一份已经打开</b><span>双方都已完成</span></div>
      ${isLetter ? letterCard('我写的', cur.user) : diaryCard('我写的', cur.user)}
      ${isLetter ? letterCard(name + ' 写的', cur.char) : diaryCard(name + ' 写的', cur.char)}
      <div class="share-note"><b>这一份属于你们</b><br>可以分享给 ${name}，也可以继续写下一份。</div>
      ${shareBtn}${nextBtn}`;
  }
  if (cur.userLocked) {
    return `<div class="exchange-status"><i class="dot"></i><b>已封存，等待 ${name}</b><span>等待回应</span></div>
      ${isLetter ? letterCard('我写的', cur.user) : diaryCard('我写的', cur.user)}
      <div class="hint">你的内容已经锁定。主程序会收到请求，让 Char 根据当前人格与这段内容生成回应。</div>
      ${shareBtn}
      <div class="exchange-actions"><button class="btn dark" onclick="requestExchangeAgain('${type}')">再次请求回应</button></div>`;
  }
  if (isLetter) {
    return `<div class="desc">写下你的信。封存后会发送给 ${name}，等双方都完成后才一起拆开。</div>
      <div class="letter-compose">
        <div class="compose-mail">
          <div>
            <div class="compose-envelope" aria-hidden="true">
              <div class="compose-flap"></div>
              <div class="compose-fold a"></div>
              <div class="compose-fold b"></div>
              <div class="compose-seal">C</div>
            </div>
            <div>
              <div class="compose-kicker">A LITTLE LETTER</div>
              <div class="compose-title">给 ${name} 的一封信</div>
              <div class="compose-date">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
          </div>
          <textarea id="letterText" placeholder="亲爱的……\n\n把想说的话写在这里。">${esc(cur.user)}</textarea>
          <div class="compose-foot"><span>PRIVATE · JUST FOR US</span><span>NO. ${String(Date.now()).slice(-4)}</span></div>
        </div>
      </div>
      <div class="row"><button class="btn dark" onclick="lockLetter()">封存并发送</button></div>`;
  }
  const d = new Date();
  return `<div class="desc">写下今天想留给 ${name} 的一页。交换完成后，它会成为你们共同的时间胶囊。</div>
    <div class="diary-book">
      <div class="dhead">
        <span class="date">${d.getDate()}</span>
        <span class="month">${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
        <span class="year">${d.getFullYear()}</span>
      </div>
      <div class="label">MY DIARY</div>
      <textarea id="diaryText" placeholder="今天发生了什么？或者，只是一句想对他说的话……">${esc(cur.user)}</textarea>
    </div>
    <div class="row"><button class="btn dark" onclick="lockDiary()">封存并发送</button></div>`;
}

function renderHistory(type, isLetter, list, more, sel) {
  if (!list.length) {
    return `<div class="exchange-status"><i class="dot"></i><b>这里还没有记录</b><span>写下第一份吧</span></div>
      <div class="block" style="text-align:center;padding:24px 16px">
        <div style="font-family:Georgia,serif;font-size:28px;color:#c79aa8;margin-bottom:7px">${isLetter ? 'L' : 'D'}</div>
        <p style="color:#a69b96">完成一次${isLetter ? '情书' : '日记'}交换后，它会以时间轴的方式留在这里。</p>
      </div>`;
  }
  let h = `<div class="desc">共 ${list.length} 份记录。${more ? '选择要删除的记录。' : '点开任意一方即可阅读。'}</div><div class="timeline">`;
  list.slice().reverse().forEach((item) => {
    const idx = item.id;
    const on = sel.has(idx);
    const date = new Date(item.at);
    const dateText = date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    h += `<div class="tl-item">
      <div class="tl-date">${dateText}</div>
      <div class="tl-env-row">
        <div class="tl-env" onclick="${more ? `toggleSelect('${type}','${idx}')` : `toggleRead('read-user-${type}-${idx}')`}">
          ${more ? `<div class="sel-box ${on ? 'on' : ''}">${on ? '✓' : ''}</div>` : ''}
          <div class="icon"><div class="${isLetter ? 'env-icon' : 'diary-icon'}"></div></div>
          <div class="who">我写的</div>
          <div class="preview">${esc((item.user || '').slice(0, 24))}${item.user ? '…' : ''}</div>
        </div>
        <div class="tl-env diary" onclick="${more ? `toggleSelect('${type}','${idx}')` : `toggleRead('read-char-${type}-${idx}')`}">
          ${more ? `<div class="sel-box ${on ? 'on' : ''}">${on ? '✓' : ''}</div>` : ''}
          <div class="icon"><div class="${isLetter ? 'env-icon' : 'diary-icon'}"></div></div>
          <div class="who">${esc(state.char.name)} 写的</div>
          <div class="preview">${esc((item.char || '').slice(0, 24))}${item.char ? '…' : ''}</div>
        </div>
      </div>
      <div id="read-user-${type}-${idx}" style="display:none" class="reader ${isLetter ? '' : 'diary'}">
        <h5>MY ${isLetter ? 'LETTER' : 'DIARY'} · ${dateText}</h5>${esc(item.user || '')}
      </div>
      <div id="read-char-${type}-${idx}" style="display:none" class="reader ${isLetter ? '' : 'diary'}">
        <h5>${esc(state.char.name).toUpperCase()} · ${isLetter ? 'LETTER' : 'DIARY'}</h5>${esc(item.char || '')}
      </div>
      <div class="exchange-actions"><button class="btn gray" onclick="shareRecord('${type}','${idx}')">分享给 Char</button></div>
    </div>`;
  });
  return h + '</div>';
}

function letterCard(who, text) {
  const preview = (text || '').trim();
  return `<div class="letter-mail-card">
    <div class="mail-envelope" aria-hidden="true">
      <div class="mail-flap"></div>
      <div class="mail-fold left"></div>
      <div class="mail-fold right"></div>
      <div class="mail-seal">C</div>
    </div>
    <div class="mail-info">
      <div class="mail-label">PRIVATE LETTER</div>
      <div class="mail-who">${esc(who)}</div>
      <div class="mail-preview">${esc(preview ? preview.slice(0, 42) + (preview.length > 42 ? '…' : '') : '这封信还没有写下内容。')}</div>
      <div class="mail-state"><span class="mail-dot"></span>${preview ? '已封存 · 点击下方阅读' : '等待写入'}</div>
    </div>
  </div>
  ${text ? `<div class="reader letter-reader"><div class="reader-kicker">A LETTER FOR US</div><h5>信纸 · ${esc(who)}</h5><div class="letter-text">${esc(text)}</div></div>` : ''}`;
}

function diaryCard(who, text) {
  const d = new Date();
  return `<div class="diary-book" style="margin-bottom:14px">
    <div class="dhead">
      <span class="date">${d.getDate()}</span>
      <span class="month">${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span>
      <span class="year">${d.getFullYear()}</span>
    </div>
    <div class="label">${esc(who)} · PRIVATE DIARY</div>
    <div style="font-family:'Songti SC','STSong',serif;font-size:13px;line-height:2.05;white-space:pre-wrap;color:#5a4a4a">${esc(text || '')}</div>
  </div>`;
}

function switchTab(type, t) {
  if (type === 'letters') letterTab = t; else diaryTab = t;
  if (type === 'letters') letterMore = false; else diaryMore = false;
  openFull(type);
}
function toggleMore(type) {
  if (type === 'letters') { letterMore = !letterMore; letterSel.clear(); }
  else { diaryMore = !diaryMore; diarySel.clear(); }
  openFull(type);
}
function toggleSelect(type, id) {
  const sel = type === 'letters' ? letterSel : diarySel;
  if (sel.has(id)) sel.delete(id); else sel.add(id);
  openFull(type);
}
function closeFull() { document.getElementById('fullpage').classList.remove('show'); }
function toggleRead(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function startNewExchange(type) {
  const key = stateKey(type);
  state[key].current = { user: '', char: '', userLocked: false, charLocked: false, unlocked: false };
  if (type === 'letters') { letterTab = 'write'; letterMore = false; }
  else { diaryTab = 'write'; diaryMore = false; }
  dbPut(state);
  openFull(type);
}
async function deleteSelected(type) {
  const sel = type === 'letters' ? letterSel : diarySel;
  if (!sel.size) { toast('请先勾选要删除的记录'); return; }
  if (!confirm(`确定删除选中的 ${sel.size} 条记录吗？`)) return;
  const key = stateKey(type);
  state[key].history = state[key].history.filter((item) => !sel.has(item.id));
  if (type === 'letters') { letterSel.clear(); letterMore = false; }
  else { diarySel.clear(); diaryMore = false; }
  await dbPut(state);
  openFull(type);
}
function shareCurrent(type) {
  const key = stateKey(type);
  const x = state[key];
  if (!x || !x.current) return;
  shareExchangeCard(key, x.current);
}
function shareRecord(type, id) {
  const key = stateKey(type);
  const item = state[key].history.find((i) => i.id === id);
  if (!item) return;
  shareExchangeCard(key, item);
}
function shareExchangeCard(key, item) {
  const isLetter = key === 'letters';
  const title = isLetter ? '情书互换' : '日记互换';
  const who = state.char.name || 'Char';
  const detail = `${isLetter ? '一封信' : '一篇日记'}（我写的内容）：\n"""\n${item.user || '（空）'}\n"""\n\n${who} 的回应：\n"""\n${item.char || '（对方还没有回应）'}\n"""`;
  const summary = (item.user || '').slice(0, 40) || (isLetter ? '一封情书' : '一篇日记');
  shareCardToChat(key, title, summary, detail);
}

/* ---------- 题目池（随机生成用，不预置答案） ---------- */
const baseQs = [
  ['如果突然多出一天假期，你觉得对方会？', ['待在家里', '出门走走', '临时旅行', '什么都不安排']],
  ['对方心情不好时，更希望你？', ['陪着但不追问', '主动问发生了什么', '给一点空间', '想办法逗开心']],
  ['只能选一种约会，对方会选？', ['在家看电影', '吃饭散步', '去陌生地方', '一起做新鲜的事']],
  ['对方更在意哪一种表达？', ['语言', '行动', '陪伴', '记住细节']],
  ['小矛盾出现时，对方更可能？', ['马上说清楚', '冷静后再说', '先观察你的态度', '装作没事']],
  ['收到礼物，对方更喜欢？', ['实用的东西', '纪念意义', '亲手做的', '完全意外的惊喜']],
  ['压力大时，对方更可能？', ['变安静', '变得话多', '自己消化', '寻找依靠']],
  ['一起养宠物，对方会？', ['负责照顾', '负责取名字', '疯狂拍照', '制定完整计划']],
  ['对方最容易被什么打动？', ['认真说的话', '一个小行动', '被记住', '长时间陪伴']],
  ['如果明天就是世界末日，对方想和你？', ['聊天', '看风景', '吃最后一顿饭', '什么也不做，只待一起']]
];
const basePersonQs = [
  ['发生分歧时，你更倾向？', ['先说清楚', '先冷静一下', '看情况', '让对方决定']],
  ['突然有一段空闲时间，你更想？', ['待在家里', '出门走走', '约朋友', '自己待着']],
  ['表达在乎时，你更自然的是？', ['说出来', '做出来', '陪着', '记住细节']],
  ['对方需要独处时，你会？', ['完全理解', '有点不安', '找点事做', '直接问']],
  ['计划临时变化时？', ['马上调整', '有点烦', '无所谓', '重新安排']],
  ['创造回忆时更喜欢？', ['拍照', '写下来', '一起去', '放在心里']],
  ['发生误会后？', ['马上解释', '等对方问', '写下来', '假装没事']],
  ['安全感更多来自？', ['确定感', '陪伴', '自由', '被需要']],
  ['一起做决定时？', ['商量', '各自决定', '让对方决定', '看情况']],
  ['关系里最重要的是？', ['信任', '沟通', '空间', '陪伴']],
  ['对方脆弱时？', ['接住', '给建议', '陪着', '让他自己待会']],
  ['未来规划更倾向？', ['一起计划', '走一步看一步', '各自努力', '顺其自然']]
];

function randomQuestions(pool, count) {
  const p = [...pool];
  const out = [];
  while (out.length < count && p.length) {
    out.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
  }
  return out;
}
function qSet() { return state.survey.questions || baseQs; }
function pqSet() { return state.personality.questions || basePersonQs; }

/* ---------- 主 API 请求辅助 ---------- */
function apiErr(e) {
  console.warn('[CoupleSpace] API', e);
  try{ if(window.NanoRefresh) NanoRefresh.fail(e, { key:'cs' }); }catch(err){}
  const msg = (e && e.message) ? e.message : '请求失败。请检查主 API 配置后重试。';
  showErrorDialog('生成失败', msg, '常见原因：API 未配置 / Key 失效 / 地址或模型名错误 / 网络不通 / 账户额度不足。修正后再次点击生成即可。');
}

function questionsFromApi(raw, count, fallbackPool) {
  const parsed = parseJsonLoose(raw, null);
  let arr = parsed;
  // response_format=json_object 时，模型可能返回 {"questions":[...]} 而不是裸数组。
  if (!Array.isArray(arr) && parsed && typeof parsed === 'object') {
    for (const k of ['questions', 'items', 'data', 'list', 'survey']) {
      if (Array.isArray(parsed[k])) { arr = parsed[k]; break; }
    }
    if (!Array.isArray(arr)) {
      const first = Object.keys(parsed).map((k) => parsed[k]).find((v) => Array.isArray(v));
      arr = first || null;
    }
  }
  const out = [];
  if (Array.isArray(arr)) {
    arr.forEach((it) => {
      if (out.length >= count) return;
      let q = '';
      let opts = [];
      if (Array.isArray(it)) {
        q = String(it[0] || '');
        opts = Array.isArray(it[1]) ? it[1] : [];
      } else if (it && typeof it === 'object') {
        q = String(it.q || it.question || it.title || '');
        opts = it.o || it.options || it.choices || [];
      }
      opts = (opts || []).map((x) => String(x)).filter(Boolean).slice(0, 4);
      if (q && opts.length >= 2) {
        while (opts.length < 4) opts.push('其它');
        out.push([q, opts]);
      }
    });
  }
  if (out.length < count) {
    return out.concat(randomQuestions(fallbackPool, count - out.length));
  }
  return out.slice(0, count);
}

function answersFromApi(raw, count, optionCount) {
  let arr = parseJsonLoose(raw, null);
  if (!Array.isArray(arr) && arr && typeof arr === 'object') {
    for (const k of ['answers', 'choices', 'data', 'result', 'picks']) {
      if (Array.isArray(arr[k])) { arr = arr[k]; break; }
    }
    if (!Array.isArray(arr)) {
      const first = Object.keys(arr).map((k) => arr[k]).find((v) => Array.isArray(v));
      if (first) arr = first;
    }
  }
  if (!Array.isArray(arr)) {
    const nums = String(raw || '').match(/\d+/g) || [];
    arr = nums;
  }
  const out = [];
  for (let i = 0; i < count; i++) {
    let v = parseInt(arr[i], 10);
    if (isNaN(v)) v = Math.floor(Math.random() * optionCount);
    out.push(Math.max(0, Math.min(optionCount - 1, v)));
  }
  return out;
}

/* ---------- 生成结果的应用（正常完成与断点恢复共用） ---------- */
async function applySurveyQuestions(raw) {
  state.survey.questions = questionsFromApi(raw, 10, baseQs);
  state.survey.user = []; state.survey.char = [];
  state.survey.status = 'idle'; state.survey.result = null;
  await dbPut(state);
  renderAfterApi('survey');
  toast('已生成新题目');
}

async function applySurveyAnswers(a) {
  state.survey.char = a;
  let same = 0, best = 0, diff = 0;
  for (let i = 0; i < 10; i++) {
    if (state.survey.user[i] === a[i]) { same++; best = i; } else diff = i;
  }
  state.survey.result = { same, score: same * 10, best, diff, analysis: analyzeSurvey(state.survey.user, a) };
  state.survey.status = 'complete';
  state.stats.complete++;
  state.events.push({ type: 'survey', round: state.survey.round, at: new Date().toISOString() });
  await dbPut(state);
  renderAfterApi('survey');
  toast('已获得 ' + (state.char.name || 'Char') + ' 的回答');
}

async function applyPersonalityQuestions(raw) {
  state.personality.questions = questionsFromApi(raw, 12, basePersonQs);
  state.personality.user = []; state.personality.char = [];
  state.personality.result = null; state.personality.status = 'idle';
  await dbPut(state);
  renderAfterApi('personality');
  toast('已生成新题目');
}

async function applyPersonalityAnswers(raw) {
  state.personality.char = answersFromApi(raw, 12, 4);
  state.personality.result = calcPerson(state.personality.user, state.personality.char);
  state.personality.status = 'complete';
  state.stats.complete++;
  state.events.push({ type: 'personality', at: new Date().toISOString() });
  await dbPut(state);
  renderAfterApi('personality');
  toast('测评结果已生成');
}

async function applyJudge(raw) {
  const obj = parseJsonLoose(raw, null);
  if (obj && typeof obj === 'object') {
    state.judge.char = String(obj.perspective || obj.charPerspective || '').trim() || String(raw || '').trim();
    state.judge.verdict = String(obj.verdict || '').trim();
    state.judge.danmu = normalizeDanmu(obj.danmu);
  } else {
    state.judge.char = String(raw || '').trim();
    state.judge.verdict = '';
    state.judge.danmu = [];
  }
  state.judge.status = 'complete';
  state.stats.complete++;
  state.events.push({ type: 'judge', at: new Date().toISOString() });
  await dbPut(state);
  renderAfterApi('judge');
  toast('审判结果已生成');
}

async function applyDanmu(raw, silent) {
  const arr = parseJsonLoose(raw, null);
  const more = normalizeDanmu(Array.isArray(arr) ? arr : (arr && arr.danmu));
  if (!more.length) { toast('没有生成新的弹幕'); return; }
  state.judge.danmu = (state.judge.danmu || []).concat(more);
  await dbPut(state);
  renderAfterApi('judge');
  if (!silent) toast('已生成更多弹幕');
}

async function applyDrawChat(text) {
  const t = String(text || '').trim();
  if (!t) { toast('没有收到回复'); return; }
  state.draw.chat.push({ who: state.char.name, text: t });
  await dbPut(state);
  renderAfterApi('draw');
}

/* ---------- 1. 默契调查 ---------- */
function survey() {
  if (state.survey.result) return surveyResult();
  const qs = qSet();
  let h = `<h2>默契调查 #${String(state.survey.round).padStart(2, '0')}</h2>
    <div class="desc">每一轮十题。可以随机生成，也可以调用外部 API 生成一套新题。</div>
    <div class="row">
      <button class="btn soft" onclick="generateQuestions()">随机生成十题</button>
      <button class="btn gray" onclick="requestSurveyQuestions()">调用 API 生成</button>
    </div>`;
  qs.forEach((q, i) => {
    h += `<div class="q"><label>${i + 1} / 10</label><p>${esc(q[0])}</p>
      <div class="opts">${q[1].map((x, j) => `
        <button class="opt ${state.survey.user[i] === j ? 'sel' : ''}" onclick="surveyPick(${i},${j},this)">${esc(x)}</button>
      `).join('')}</div></div>`;
  });
  h += `<div class="row">
    <button class="btn gray" onclick="save()">保存</button>
    <button class="btn dark" onclick="requestSurveyChar()">请求 ${esc(state.char.name)} 回答</button>
  </div>`;
  return h;
}
async function generateQuestions() {
  state.survey.questions = randomQuestions(baseQs, 10);
  state.survey.user = []; state.survey.char = [];
  state.survey.status = 'idle'; state.survey.result = null;
  await dbPut(state); openPage('survey');
}
async function requestSurveyQuestions() {
  if (busy) return;
  setBusy(true, '正在生成题目…');
  try {
    const sys = buildCharSystem('你正在参与「默契调查」小游戏，需要设计一套关于你和对方的选择题。题目要贴合你们的人设与关系，健康自然，不要露骨。');
    const usr = '请生成 10 道关于你们两人的选择题，只输出 JSON 数组，格式：[{"q":"题目","o":["选项1","选项2","选项3","选项4"]}, ...]，共 10 题，不要解释。';
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 3200, temp: 0.95, kind: 'survey-questions', json: true });
    await applySurveyQuestions(raw);
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}
async function surveyPick(i, j, el) {
  state.survey.user[i] = j;
  el.parentNode.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'));
  el.classList.add('sel');
  await dbPut(state);
}
async function requestSurveyChar() {
  if (state.survey.user.filter((x) => x !== undefined).length !== 10) { toast('请先完成全部 10 题'); return; }
  if (busy) return;
  const qs = qSet();
  setBusy(true, '正在请 ' + (state.char.name || 'Char') + ' 回答…');
  try {
    const list = qs.map((q, i) => `${i + 1}. ${q[0]}\n   A.${q[1][0]}  B.${q[1][1]}  C.${q[1][2]}  D.${q[1][3]}`).join('\n');
    const recent = qs.map((q, i) => `${q[0]} 我的选择：${q[1][state.survey.user[i]]}`).join('\n');
    const sys = buildCharSystem('你正在和对方一起做「默契调查」。请完全按你的性格、经历和设定真实作答，不要迎合对方。', recent);
    const usr = `请看下面 ${qs.length} 道题，按你自己会怎么选作答。只输出 JSON 数组，例如 [0,2,1,3,...]，每个元素是选项序号（0=A，1=B，2=C，3=D），共 ${qs.length} 个，不要解释。\n${list}`;
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 500, temp: 0.7, kind: 'survey-answers' });
    await applySurveyAnswers(answersFromApi(raw, 10, 4));
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}

function analyzeSurvey(u, c) {
  const same = u.filter((v, i) => v === c[i]).length;
  if (same >= 8) return { tone: '高度默契', text: '你们的答案重合度很高，说明在这十件小事上，你们的直觉和偏好非常接近。这不是“完全一样”，而是你们自然地对很多事有相似的判断。可以继续在“不同的地方”做小实验，看看彼此的边界在哪。' };
  if (same >= 5) return { tone: '温和默契', text: '你们有一半左右的答案一致，另外一半呈现差异。差异不代表不合，更多是说明你们在靠近、表达、节奏上各有习惯。可以把不同的题目当作聊天入口，而不是考核。' };
  return { tone: '差异明显', text: '你们在这十题上呈现出比较明显的差异。这通常意味着你们对“关心、陪伴、边界”的理解不太一样。建议把不一致的题当作地图，一起标记出彼此真正在意的是什么。' };
}
function surveyResult() {
  const r = state.survey.result;
  const qs = qSet();
  const a = r.analysis || analyzeSurvey(state.survey.user, state.survey.char);
  return `<h2>默契调查 #${String(state.survey.round).padStart(2, '0')}</h2>
    <div class="desc">Char 已经回答了同一套题。下面是逐题对比与默契分析。</div>
    <div class="result"><div class="code">SCORE</div><h3>${r.score}%</h3><p>${r.same} / 10 个答案一致<br>最有默契：第 ${r.best + 1} 题<br>最值得聊聊：第 ${r.diff + 1} 题</p></div>
    <div class="meter"><i style="width:${r.score}%"></i></div>
    <div class="verdict"><b style="font-size:9px;letter-spacing:1px;color:#a06e7c">${a.tone}</b><br>${esc(a.text)}</div>
    <div style="margin:14px 0 6px;font-size:10px;color:#aaa;letter-spacing:1px">逐题对比</div>
    ${qs.map((q, i) => `<div class="compare">
      <span class="n">${i + 1}</span>
      <span class="answers">${esc(q[1][state.survey.user[i]])} / ${esc(q[1][state.survey.char[i]])}</span>
      <span class="${state.survey.user[i] === state.survey.char[i] ? 'same' : 'different'}">${state.survey.user[i] === state.survey.char[i] ? '一致' : '不同'}</span>
    </div>`).join('')}
    <div class="share-note"><b>分享给 Char</b><br>把这次默契分析发送给 Char 查看。</div>
    <div class="row"><button class="btn gray" onclick="shareToChar('survey')">分享给 Char</button></div>
    <div class="row"><button class="btn dark" onclick="newSurvey()">生成下一轮</button></div>`;
}
function shareToChar(type) {
  if (type === 'survey' && state.survey.result) {
    const r = state.survey.result;
    const qs = qSet();
    const lines = qs.map((q, i) => `${i + 1}. ${q[0]}\n   我：${q[1][state.survey.user[i]]} ／ ${state.char.name}：${q[1][state.survey.char[i]]} ${state.survey.user[i] === state.survey.char[i] ? '（一致）' : '（不同）'}`).join('\n');
    const detail = `【默契调查 · 第 ${state.survey.round} 轮】\n默契度：${r.score}%（${r.same}/10 一致）\n${r.analysis ? r.analysis.tone : ''}：${r.analysis ? r.analysis.text : ''}\n\n逐题对比：\n${lines}`;
    shareCardToChat('survey', '默契调查', `默契度 ${r.score}% · ${r.same}/10 一致`, detail);
  } else if (type === 'personality' && state.personality.result) {
    const r = state.personality.result;
    const dims = (r.dims || []).map((d) => `${d.k}：${d.v}`).join('，');
    const detail = `【情侣人格测评 · 第 ${state.personality.round} 轮】\n类型：${r.code} ${r.name}\n倾向：${r.desc}\n维度：${dims}\n\n解读：${r.longDesc}\n\n相处建议：${r.advice}`;
    shareCardToChat('personality', '情侣人格', `${r.name} · ${r.desc}`, detail);
  } else if (type === 'judge') {
    const j = state.judge;
    const danmu = (j.danmu || []).map((d) => `${d.who}：${d.text}`).join('\n');
    const detail = `【审判庭】\n事件：${j.case}\n如果是我我会怎么做：${j.user}\n${state.char.name} 的视角：${j.char || '（暂无）'}\n${j.verdict ? '裁决：' + j.verdict + '\n' : ''}${danmu ? '弹幕：\n' + danmu : ''}`;
    shareCardToChat('judge', '审判庭', j.case ? j.case.slice(0, 40) : '一次事件审理', detail);
  } else if (type === 'draw' && state.draw) {
    const d = state.draw;
    const chat = (d.chat || []).map((m) => (m.who === 'user' ? '我：' : state.char.name + '：') + m.text).join('\n');
    const detail = `【你画我猜 · 第 ${d.round} 回合】\n我画的题目：${d.word}\n${state.char.name} 猜的：${d.guess || '（未猜出）'}\n${chat ? '之后聊了：\n' + chat : ''}`;
    shareCardToChat('draw', '你画我猜', `第 ${d.round} 回合 · 猜测：${d.guess || '…'}`, detail);
  } else {
    toast('暂无可分享的结果');
  }
}
async function newSurvey() {
  state.survey = {
    round: state.survey.round + 1,
    questions: randomQuestions(baseQs, 10),
    user: [], char: [], status: 'idle', result: null
  };
  await dbPut(state);
  openPage('survey');
}

/* ---------- 2. 情侣人格 ---------- */
function personality() {
  if (state.personality.result) {
    const r = state.personality.result;
    return `<h2>情侣人格</h2>
      <div class="desc">人格不是固定标签，而是这一轮回答呈现出的关系倾向。换一套问题、换一次回答，结果都可能改变。</div>
      <div class="result"><div class="code">${r.code}</div><h3>${r.name}</h3><p>${r.desc}</p></div>
      <div style="margin:14px 0 6px;font-size:10px;color:#aaa;letter-spacing:1px">维度得分</div>
      <div class="q">${r.dims.map((d) => `<div class="person-dim">
        <span class="k">${d.k}</span>
        <div class="bar"><i style="width:${d.p}%"></i></div>
        <span class="v">${d.v}</span>
      </div>`).join('')}</div>
      <div style="margin:14px 0 6px;font-size:10px;color:#aaa;letter-spacing:1px">人格解读</div>
      <div class="verdict">${esc(r.longDesc)}</div>
      <div style="margin:14px 0 6px;font-size:10px;color:#aaa;letter-spacing:1px">相处建议</div>
      <div class="block"><p>${esc(r.advice)}</p></div>
      <div class="share-note"><b>分享给 Char</b><br>把这次人格测评结果发送给 Char 查看。</div>
      <div class="row"><button class="btn gray" onclick="shareToChar('personality')">分享给 Char</button></div>
      <div class="row"><button class="btn dark" onclick="newPersonality()">重新测评</button></div>`;
  }
  const qs = pqSet();
  let h = `<h2>情侣人格测评 #${String(state.personality.round).padStart(2, '0')}</h2>
    <div class="desc">12 题。观察靠近、留白、稳定、探索四个关系维度。可以随机生成，也可以调用 API。</div>
    <div class="row">
      <button class="btn soft" onclick="generatePersonQs()">随机生成十二题</button>
      <button class="btn gray" onclick="requestPersonQs()">调用 API 生成</button>
    </div>`;
  qs.forEach((q, i) => {
    h += `<div class="q"><label>${i + 1} / 12</label><p>${esc(q[0])}</p>
      <div class="opts">${q[1].map((x, j) => `
        <button class="opt ${state.personality.user[i] === j ? 'sel' : ''}" onclick="personPick(${i},${j},this)">${esc(x)}</button>
      `).join('')}</div></div>`;
  });
  h += `<div class="row"><button class="btn dark" onclick="requestPersonality()">保存并请求 Char</button></div>`;
  return h;
}
async function generatePersonQs() {
  state.personality.questions = randomQuestions(basePersonQs, 12);
  state.personality.user = []; state.personality.char = [];
  state.personality.result = null; state.personality.status = 'idle';
  await dbPut(state); openPage('personality');
}
async function requestPersonQs() {
  if (busy) return;
  setBusy(true, '正在生成题目…');
  try {
    const sys = buildCharSystem('你正在参与「情侣人格测评」，需要设计一套关于关系倾向的选择题。题目要贴合你们的人设与关系，健康自然，不要露骨。');
    const usr = '请生成 12 道关于关系倾向的选择题（靠近、留白、稳定、探索四个维度各 3 题）。只输出 JSON 数组，格式：[{"q":"题目","o":["选项1","选项2","选项3","选项4"]}, ...]，共 12 题，不要解释。';
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 3200, temp: 0.95, kind: 'personality-questions', json: true });
    await applyPersonalityQuestions(raw);
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}
async function personPick(i, j, el) {
  state.personality.user[i] = j;
  el.parentNode.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'));
  el.classList.add('sel');
  await dbPut(state);
}
async function requestPersonality() {
  if (state.personality.user.filter((x) => x !== undefined).length !== 12) { toast('请完成 12 题'); return; }
  if (busy) return;
  const qs = pqSet();
  setBusy(true, '正在请 ' + (state.char.name || 'Char') + ' 作答…');
  try {
    const list = qs.map((q, i) => `${i + 1}. ${q[0]}\n   A.${q[1][0]}  B.${q[1][1]}  C.${q[1][2]}  D.${q[1][3]}`).join('\n');
    const recent = qs.map((q, i) => `${q[0]} 我的选择：${q[1][state.personality.user[i]]}`).join('\n');
    const sys = buildCharSystem('你正在和对方一起做「情侣人格测评」。请完全按你的性格与设定真实作答，不要迎合对方。', recent);
    const usr = `请看下面 ${qs.length} 道题，按你自己会怎么选作答。只输出 JSON 数组，例如 [0,2,1,3,...]，每个元素是选项序号（0=A，1=B，2=C，3=D），共 ${qs.length} 个，不要解释。\n${list}`;
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 500, temp: 0.7, kind: 'personality-answers' });
    await applyPersonalityAnswers(raw);
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}
function calcPerson(a, b) {
  const keys = ['靠近', '留白', '稳定', '探索'];
  const s = [0, 0, 0, 0];
  a.forEach((v, i) => { const x = b[i] ?? 0; s[i % 4] += 4 - Math.abs(v - x); });
  const idx = s.indexOf(Math.max(...s));
  const t = [
    ['TIDE · 01', '潮汐型伴侣', '你们会在靠近与留白之间调整距离，亲密感来自“知道什么时候靠近”。', '靠近 / 留白 / 稳定'],
    ['RESONANCE · 02', '共振型伴侣', '你们容易捕捉彼此的情绪与节奏，共同体验会成为关系里的重要语言。', '共情 / 陪伴 / 表达'],
    ['EXPLORER · 03', '探索型伴侣', '新鲜体验会让你们更容易建立连接，一起学习新事物本身就是亲密。', '探索 / 好奇 / 行动'],
    ['HARBOR · 04', '栖息型伴侣', '稳定、日常与细节会成为你们关系的支点，熟悉感本身就是一种靠近。', '稳定 / 照顾 / 日常']
  ][idx];
  const max = Math.max(...s, 1);
  const dims = keys.map((k, i) => ({ k, v: s[i], p: Math.round(s[i] / max * 100) }));
  const longDesc = [
    '潮汐型伴侣：你们的关系像潮水，有时更靠近，有时各自退后。你们并不害怕距离，因为你们知道距离是节奏的一部分。真正让关系稳定的，不是一直黏在一起，而是能安心地说“我现在需要一点自己的时间”。',
    '共振型伴侣：你们很容易捕捉到彼此的情绪与节奏，一个眼神就能知道对方今天状态如何。共同体验是你们的语言，一起做过的事比说过的话更能留下痕迹。要小心的是，太容易共振时，也容易把对方的情绪当成自己的。',
    '探索型伴侣：你们通过“一起做没做过的事”来建立连接。新鲜感不是关系的敌人，而是你们的养分。只是当生活进入平淡期时，需要刻意制造一点探索，否则容易误以为关系变淡了。',
    '栖息型伴侣：你们把稳定、日常、细节当作关系的支点。记住对方的口味、习惯、小动作，对你们来说就是爱的表达。偶尔可以试着跳出熟悉，制造一点小意外，让稳定里也有一点惊喜。'
  ][idx];
  const advice = [
    '试着每周留出一次“不需要说话”的共处时间，也留出一次“认真聊聊感受”的时间。',
    '当情绪共振太强时，先确认“这是我的感受，还是我接住了对方的感受”。',
    '每月安排一件两人都没做过的小事，不需要大，只要新。',
    '在稳定的日常里，偶尔为对方准备一个没有理由的小惊喜。'
  ][idx];
  const ranked = [...dims].sort((x, y) => y.p - x.p);
  const blend = ranked[0].k + ' × ' + ranked[1].k;
  return { code: t[0], name: t[1], desc: t[2], dim: t[3], dims, longDesc, advice, index: idx, blend };
}
async function newPersonality() {
  state.personality = {
    round: state.personality.round + 1,
    questions: randomQuestions(basePersonQs, 12),
    user: [], char: [], result: null, status: 'idle'
  };
  await dbPut(state);
  openPage('personality');
}

/* ---------- 3. 审判庭 ---------- */
function judge() {
  if (state.judge.char || state.judge.danmu.length) {
    const items = state.judge.danmu.map((d) => `<div class="msg"><span class="who">${esc(d.who)}</span><span class="txt">${esc(d.text)}</span></div>`).join('');
    return `<h2>审判庭</h2>
      <div class="block"><b>事件</b><p>${esc(state.judge.case)}</p></div>
      <div class="block"><b>如果是我，我会怎么做</b><p>${esc(state.judge.user)}</p></div>
      <div class="block"><b>${esc(state.char.name)} 的视角</b><p>${esc(state.judge.char)}</p></div>
      ${state.judge.verdict ? `<div class="verdict">${esc(state.judge.verdict)}</div>` : ''}
      <div style="margin-top:14px">
        <div class="head"><b>实时弹幕</b><span>LIVE</span></div>
        <div class="danmu-wrap"><div class="danmu-track">${items}${items}</div></div>
      </div>
      <div class="share-note"><b>分享给 Char</b><br>把这次审判结果与弹幕发送给 Char 查看。</div>
      <div class="row"><button class="btn gray" onclick="shareToChar('judge')">分享给 Char</button></div>
      <div class="row"><button class="btn dark" onclick="requestDanmu()">生成更多弹幕</button></div>
      <div class="row"><button class="btn gray" onclick="resetJudge()">重新审理</button></div>`;
  }
  return `<h2>审判庭</h2>
    <div class="desc">写下发生了什么，以及“如果是我，我会怎么做”。${esc(state.char.name)} 会从自己的视角回应，观众会以实时弹幕的方式评论。</div>
    <div class="q"><label>发生了什么</label><textarea id="jcase" placeholder="只写事实……">${esc(state.judge.case)}</textarea></div>
    <div class="q"><label>如果是我，我会怎么做</label><textarea id="juser" placeholder="如果换成我，我会……">${esc(state.judge.user)}</textarea></div>
    <div class="row"><button class="btn dark" onclick="submitJudge()">提交审判</button></div>
    <div class="hint">外部 API 读取事件后，让 Char 给出真实视角，并生成第三方整理与实时弹幕。</div>`;
}
async function submitJudge() {
  state.judge.case = document.getElementById('jcase').value;
  state.judge.user = document.getElementById('juser').value;
  if (!state.judge.case.trim()) { toast('先写下发生了什么'); return; }
  if (busy) return;
  setBusy(true, '正在审理…');
  try {
    const name = state.char.name || '角色';
    const recent = state.judge.case + '\n' + state.judge.user;
    const sys = buildCharSystem('你正在参与「审判庭」：对方描述了一件两人之间发生的事，并写下“如果是我，我会怎么做”。你要以你本人的视角真实回应，不要一味迎合，也不要攻击。', recent);
    const usr = `事件：${state.judge.case}\n对方说“如果是我，我会怎么做”：${state.judge.user || '（未填写）'}\n\n请只输出 JSON：\n{"perspective":"以${name}的视角回应这件事，第一人称，80-200字","verdict":"客观的第三方整理与点评，60-150字","danmu":[{"who":"网友昵称","text":"一句弹幕评论"}, ...]}\ndanmu 给 6 条，昵称要多样、像真实网友，评论要口语化、有立场、可不一致。不要输出 JSON 以外的内容。`;
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 2600, temp: 0.95, kind: 'judge', json: true });
    await applyJudge(raw);
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}

function normalizeDanmu(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((d) => {
    if (out.length >= 20) return;
    if (typeof d === 'string') { if (d.trim()) out.push({ who: '观众', text: d.trim() }); return; }
    if (d && (d.text || d.content)) {
      out.push({ who: String(d.who || d.name || '观众'), text: String(d.text || d.content) });
    }
  });
  return out;
}

async function requestDanmu() {
  if (busy) return;
  setBusy(true, '正在生成弹幕…');
  try {
    const name = state.char.name || '角色';
    const sys = buildCharSystem('你正在为「审判庭」生成观众弹幕。弹幕是围观的第三方网友评论，不是角色本人的话。', state.judge.case);
    const usr = `事件：${state.judge.case}\n${name} 的视角：${state.judge.char}\n\n请生成 8 条新的观众弹幕，只输出 JSON 数组：[{"who":"网友昵称","text":"一句评论"}, ...]，昵称多样、评论口语化有立场，不要和已有弹幕重复。\n已有弹幕：${(state.judge.danmu || []).map((d) => d.text).join(' / ') || '（无）'}`;
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 1600, temp: 1, kind: 'judge-danmu', json: true });
    await applyDanmu(raw);
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}
async function resetJudge() {
  state.judge = { case: '', user: '', char: '', verdict: null, danmu: [], status: 'idle' };
  await dbPut(state);
  openPage('judge');
}

/* ---------- 4. 情书 / 日记 封存 ---------- */
async function lockLetter() {
  const v = document.getElementById('letterText').value.trim();
  if (!v) { toast('先写一点内容'); return; }
  const cur = state.letters.current;
  cur.user = v; cur.userLocked = true;
  cur.char = ''; cur.charLocked = false; cur.unlocked = false;
  await dbPut(state);
  letterTab = 'write'; letterMore = false;
  openFull('letters');
  await generateExchangeReply('letters');
}
async function lockDiary() {
  const v = document.getElementById('diaryText').value.trim();
  if (!v) { toast('先写一点内容'); return; }
  const cur = state.diaries.current;
  cur.user = v; cur.userLocked = true;
  cur.char = ''; cur.charLocked = false; cur.unlocked = false;
  await dbPut(state);
  diaryTab = 'write'; diaryMore = false;
  openFull('diary');
  await generateExchangeReply('diary');
}
async function requestExchangeAgain(type) {
  const key = stateKey(type);
  const cur = state[key].current;
  if (!cur.userLocked) return;
  await generateExchangeReply(type === 'diary' ? 'diary' : 'letters');
}

async function generateExchangeReply(kind) {
  if (busy) return;
  const key = stateKey(kind);
  const cur = state[key] && state[key].current;
  if (!cur || !cur.user.trim()) return;
  const isLetter = kind === 'letters';
  const name = state.char.name || '角色';
  setBusy(true, isLetter ? '正在等 ' + name + ' 回信…' : '正在等 ' + name + ' 回应…');
  try {
    const recent = cur.user;
    let extra, usr;
    if (isLetter) {
      extra = '对方把一封写给你的信封存进了「情书互换」，现在请你认真读完，并写一封回信。要贴合你的性格、经历和你们的关系。';
      usr = `对方写给你的信：\n"""\n${cur.user}\n"""\n\n请以你的身份写下回信。直接输出信的内容本身（可以有称呼和落款），不要解释、不要加引号。`;
    } else {
      extra = '对方把一篇日记封存进了「日记互换」，想让你也看看并写下你的这一天。请认真读完后写一篇你自己的日记回应。';
      usr = `对方的日记：\n"""\n${cur.user}\n"""\n\n请写下你自己的一天作为交换，可以自然提到对方日记里的内容。直接输出日记内容本身，不要解释。`;
    }
    const sys = buildCharSystem(extra, recent);
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 2600, temp: 0.9, kind: isLetter ? 'exchange-letters' : 'exchange-diary' });
    await applyExchangeReply(kind, (raw || '').trim());
  } catch (e) {
    apiErr(e);
  } finally { setBusy(false); }
}

async function applyExchangeReply(kind, text) {
  const key = stateKey(kind);
  if (!state[key]) state[key] = { current: { user: '', char: '', userLocked: false, charLocked: false, unlocked: false }, history: [] };
  const cur = state[key].current;
  cur.char = String(text || '').trim();
  cur.charLocked = true;
  if (cur.userLocked && !cur.unlocked) {
    cur.unlocked = true;
    state[key].history.push({
      id: (kind === 'letters' ? 'L' : 'D') + Date.now(),
      user: cur.user,
      char: cur.char,
      at: new Date().toISOString()
    });
    state.stats.exchange++;
    state.events.push({ type: key, at: new Date().toISOString() });
  }
  await dbPut(state);
  renderAfterApi(kind === 'diary' ? 'diary' : 'letters');
  toast((kind === 'letters' ? '回信' : '回应') + '已到达');
}

/* ---------- 5. 你画我猜 ---------- */
function draw() {
  const d = state.draw;
  if (d.status === 'chat') return drawChat();
  if (d.status === 'waiting') {
    return `<h2>你画我猜</h2>
      <div class="exchange-status"><i class="dot"></i><b>正在让 ${esc(state.char.name)} 看你的画…</b><span>稍后给出猜测</span></div>
      ${d.drawing ? `<div class="draw-board">
        <div class="board-head"><span class="board-title">你的画</span><span class="board-tip">已提交</span></div>
        <img src="${d.drawing}" style="display:block;width:100%;height:260px;object-fit:contain;background:#fffdfb;border-radius:17px">
      </div>` : ''}
      <div class="hint">生成过程不会因为切换页面或切出 App 而中断，完成后会在这里显示结果。</div>`;
  }
  if (d.result) {
    return `<h2>你画我猜</h2>
      <div class="desc">第 ${d.round} 回合完成。</div>
      ${d.drawing ? `<div class="draw-board">
        <div class="board-head"><span class="board-title">你的画</span><span class="board-tip">这一回合的作品</span></div>
        <img src="${d.drawing}" style="display:block;width:100%;height:260px;object-fit:contain;background:#fffdfb;border-radius:17px">
      </div>` : ''}
      <div class="block"><b>Char 的猜测</b><p>${esc(d.guess || '')}</p></div>
      <div class="verdict">${esc(d.result)}</div>
      <div class="share-note"><b>分享给 Char</b><br>把这一回合的画与猜测发送给 Char。</div>
      <div class="row"><button class="btn gray" onclick="shareToChar('draw')">分享给 Char</button></div>
      <div class="row"><button class="btn dark" onclick="nextDraw()">下一回合</button></div>`;
  }
  if (!d.word) d.word = randomDrawWord();
  return `<h2>你画我猜</h2>
    <div class="desc">这一局由你来画，${esc(state.char.name)}来猜。题目只给你看。</div>
    <div class="q"><label>本回合词语</label><p style="font-size:13px;font-weight:700;color:#75616a;margin:5px 0">${esc(d.word)}</p></div>
    <div class="draw-board">
      <div class="board-head"><span class="board-title">画画区域</span><span class="board-tip">用手指直接在这里画</span></div>
      <canvas id="paint" width="760" height="450"></canvas>
      <div class="draw-tools">
        <button class="btn gray" onclick="clearCanvas()">清空画布</button>
        <button class="btn soft" onclick="undoCanvas()">撤销一笔</button>
      </div>
      <div class="draw-finish"><button class="btn dark" onclick="finishDraw()">画好了，让 ${esc(state.char.name)} 猜</button></div>
    </div>`;
}
function drawChat() {
  const d = state.draw;
  return `<h2>对话 · 第 ${d.round} 回合</h2>
    <div class="desc">你画的是「${esc(d.word)}」，${esc(state.char.name)}猜的是「${esc(d.guess)}」。可以继续聊两句，再进入下一回合。</div>
    <div class="draw-chat-card">
      <div class="chat-title">AFTER THE GUESS</div>
      <div class="draw-chat-list">
        ${d.chat.map((m) => `<div class="draw-msg ${m.who === 'user' ? 'me' : ''}">
          ${m.who !== 'user' ? `<span class="who">${esc(state.char.name)}</span>` : ''}
          <div class="bubble">${esc(m.text)}</div>
          ${m.who === 'user' ? `<span class="who">你</span>` : ''}
        </div>`).join('')}
      </div>
      <div class="draw-inputbar">
        <input id="chatInput" autocomplete="off" placeholder="说点什么……" onkeydown="if(event.key==='Enter')sendChat()">
        <button class="draw-send" onclick="sendChat()">发送</button>
      </div>
    </div>
    <div class="draw-actions">
      <button class="btn gray" onclick="nextDraw()">下一回合</button>
      <button class="btn dark" onclick="requestChatReply()">让 ${esc(state.char.name)} 回复</button>
    </div>`;
}
async function sendChat() {
  const inp = document.getElementById('chatInput');
  const v = inp?.value.trim();
  if (!v) return;
  state.draw.chat.push({ who: 'user', text: v });
  inp.value = '';
  await dbPut(state);
  openPage('draw');
}
async function requestChatReply() {
  if (busy) return;
  const d = state.draw;
  const name = state.char.name || '角色';
  const history = (d.chat || []).map((m) => (m.who === 'user' ? '我：' : name + '：') + m.text).join('\n');
  setBusy(true, '正在等 ' + name + ' 回复…');
  try {
    const sys = buildCharSystem('你们刚玩完一局「你画我猜」，正在轻松地聊天。请以你的性格自然回应，短句为主。', (d.word || '') + history);
    const usr = `这一局我画的题目是「${d.word}」，你猜的是「${d.guess || ''}」。\n最近的聊天：\n${history || '（暂无）'}\n\n请你说一句话继续聊（1-2 句，不要解释规则，不要暴露这是游戏）。`;
    const raw = await callMainApi([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 600, temp: 0.95, kind: 'draw-chat' });
    await applyDrawChat(raw);
  } catch (e) { apiErr(e); } finally { setBusy(false); }
}
let canvasHistory = [];
function initCanvas() {
  const c = document.getElementById('paint');
  if (!c) return;
  canvasCtx = c.getContext('2d');
  canvasHistory = [];
  const rect = () => c.getBoundingClientRect();
  canvasCtx.lineWidth = 5;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';
  canvasCtx.strokeStyle = '#8b6873';
  c.onpointerdown = (e) => {
    drawing = true;
    canvasHistory.push(canvasCtx.getImageData(0, 0, c.width, c.height));
    const r = rect();
    canvasCtx.beginPath();
    canvasCtx.moveTo((e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height);
    c.setPointerCapture?.(e.pointerId);
  };
  c.onpointermove = (e) => {
    if (!drawing) return;
    const r = rect();
    canvasCtx.lineTo((e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height);
    canvasCtx.stroke();
  };
  c.onpointerup = () => drawing = false;
  c.onpointercancel = () => drawing = false;
  c.onpointerleave = () => drawing = false;
}
function undoCanvas() {
  if (!canvasCtx || !canvasHistory.length) return;
  canvasCtx.putImageData(canvasHistory.pop(), 0, 0);
}
function clearCanvas() {
  if (canvasCtx) { canvasCtx.clearRect(0, 0, 760, 450); canvasHistory = []; }
}
async function finishDraw() {
  const c = document.getElementById('paint');
  state.draw.drawing = c.toDataURL('image/png');
  state.draw.guess = '';
  state.draw.result = '';
  state.draw.status = 'waiting';
  state.draw.chat = [];
  await dbPut(state);
  openPage('draw');
  if (busy) return;
  const name = state.char.name || '角色';
  const sys = buildCharSystem('你在玩「你画我猜」。对方画了一幅画，你要看着画猜出画的是什么，并用你的性格说一句话。', state.draw.word);
  const usr = '对方画了一幅画，请根据画面猜一个答案。只输出 JSON：{"guess":"你猜的答案（词语，尽量简短）","reply":"你想说的一句话（20字以内，符合你的性格）"}，不要输出 JSON 以外的内容。';
  setBusy(true, '正在让 ' + name + ' 猜…');
  try {
    const raw = await callMainApi([
      { role: 'system', content: sys },
      { role: 'user', content: [{ type: 'text', text: usr }, { type: 'image_url', image_url: { url: state.draw.drawing } }] }
    ], { maxTokens: 600, temp: 0.9, kind: 'draw-guess' });
    await applyDrawGuess(raw);
  } catch (e) {
    apiErr(e);
    state.draw.status = 'idle';
    await dbPut(state);
    renderAfterApi('draw');
  } finally { setBusy(false); }
}

async function applyDrawGuess(raw) {
  const obj = parseJsonLoose(raw, null);
  let guess = '', reply = '';
  if (obj && typeof obj === 'object') {
    guess = String(obj.guess || '').trim();
    reply = String(obj.reply || '').trim();
  }
  if (!guess) guess = String(raw || '').replace(/[{}"\n]/g, ' ').trim().slice(0, 20);
  if (!reply) reply = guess ? ('我猜是「' + guess + '」') : '（歪头看着画）……你画的是什么？';
  state.draw.guess = guess || '（没猜出来）';
  state.draw.result = reply;
  state.draw.status = 'chat';
  state.draw.chat = [{ who: state.char.name, text: reply }];
  state.events.push({ type: 'draw', at: new Date().toISOString() });
  await dbPut(state);
  renderAfterApi('draw');
  toast('已收到 ' + (state.char.name || 'Char') + ' 的猜测');
}
function randomDrawWord() {
  const words = [
    '一起看日落', '雨天撑伞', '偷偷准备礼物', '窗边睡着的猫', '一起旅行',
    '吃冰淇淋', '放风筝', '看星星', '在厨房做饭', '一起看电影',
    '下雪天牵手', '周末赖床', '夜晚散步', '分享耳机', '拍一张合照', '准备纪念日礼物'
  ];
  return words[Math.floor(Math.random() * words.length)];
}
async function nextDraw() {
  const word = randomDrawWord();
  state.draw = {
    round: state.draw.round + 1,
    role: 'user',
    word,
    drawing: null, guess: null, result: null,
    chat: [], status: 'idle'
  };
  await dbPut(state);
  openPage('draw');
}

/* ---------- 设置 ---------- */
function settings() {
  return `<h2>Space 设置</h2>
    <div class="desc">Couple Space 直接使用主 API，并在互动时读取人物设定、世界书（全局/局部绑定）与你的身份设定。</div>
    <div class="q"><label>存储</label><p>IndexedDB · ${DB_NAME} · state/main</p></div>
    <div class="q"><label>当前身份</label><p>${esc(userProfile.name || '我')}</p></div>
    <div class="q"><label>当前 Char</label><p>${esc(state.char.name)}</p></div>
    <div class="q"><label>数据源</label><p>人设（mask）/ 角色库（character）/ 世界书（worldbook）/ 主 API（api）</p></div>
    <div class="row"><button class="btn gray" onclick="exportState()">导出 JSON</button></div>
    <div class="row"><button class="btn soft" onclick="resetData()">清空本地 Couple Space</button></div>
    <div class="row"><button class="btn gray" onclick="closePage()">返回</button></div>`;
}
function exportState() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = 'couple-space-indexeddb-export.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function resetData() {
  if (confirm('确定清空 Couple Space 的 IndexedDB 数据吗？')) {
    const d = await idb();
    d.close();
    await new Promise((res, rej) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = res;
      r.onerror = () => rej(r.error);
    });
    location.reload();
  }
}

/* ---------- 桥接 ---------- */
function bridge(payload) {
  window.dispatchEvent(new CustomEvent('couple-space-request', { detail: payload }));
  if (window.CoupleSpaceAPI && typeof window.CoupleSpaceAPI.request === 'function') {
    window.CoupleSpaceAPI.request(payload);
  }
}

window.CoupleSpace = {
  getState: () => structuredClone(state),

  // 兼容外部注入：直接复用本地生成结果的应用逻辑（避免重复保存/重复渲染）
  receiveSurveyQuestions(data) {
    if (!Array.isArray(data.questions) || data.questions.length !== 10) return;
    applySurveyQuestions(data.questions);
  },
  receiveSurveyAnswers(data) {
    const a = data.answers;
    if (!Array.isArray(a) || a.length !== 10) return;
    applySurveyAnswers(a);
  },
  receivePersonalityQuestions(data) {
    if (!Array.isArray(data.questions) || data.questions.length !== 12) return;
    applyPersonalityQuestions(data.questions);
  },
  receivePersonality(data) {
    if (!Array.isArray(data.answers) || data.answers.length !== 12) return;
    applyPersonalityAnswers(data.answers);
  },
  receiveDrawGuess(data) {
    applyDrawGuess(JSON.stringify({ guess: data.guess || '', reply: data.result || data.guess || '' }));
  },
  receiveChatReply(data) {
    applyDrawChat(data.text || '……');
  },
  receiveJudge(data) {
    applyJudge(JSON.stringify({ perspective: data.charPerspective || '', verdict: data.verdict || '', danmu: data.danmu || [] }));
  },
  receiveDanmu(data) {
    applyDanmu(JSON.stringify({ danmu: data.danmu || [] }), true);
  },
  receiveExchange(key, data) {
    applyExchangeReply(key === 'diary' ? 'diary' : 'letters', data.text || '');
  }
};

/* ---------- 断点恢复：请求由父页面发起，切页/切出 App 后回来继续取结果 ---------- */
function resumeApply(kind, content) {
  if (kind === 'survey-questions') return applySurveyQuestions(content);
  if (kind === 'survey-answers') return applySurveyAnswers(answersFromApi(content, 10, 4));
  if (kind === 'personality-questions') return applyPersonalityQuestions(content);
  if (kind === 'personality-answers') return applyPersonalityAnswers(content);
  if (kind === 'judge') return applyJudge(content);
  if (kind === 'judge-danmu') return applyDanmu(content, true);
  if (kind === 'draw-guess') return applyDrawGuess(content);
  if (kind === 'draw-chat') return applyDrawChat(content);
  if (kind === 'exchange-letters') return applyExchangeReply('letters', String(content || '').trim());
  if (kind === 'exchange-diary') return applyExchangeReply('diary', String(content || '').trim());
  return null;
}

function finishResume(p, result) {
  csPendingSet(null);
  if (!result) return;
  if (result.error) {
    try{ if(window.NanoRefresh) NanoRefresh.fail(result.error, { key:'cs' }); }catch(e){}
    showErrorDialog('生成失败', '网络错误：' + result.error, '请求在后台执行时连接失败。请检查网络，或确认 API 地址在手机上可访问（localhost 需改成电脑局域网 IP）。');
    return;
  }
  if (!result.ok) {
    const apiMsg = extractApiErrorMessage(result.text);
    showErrorDialog('生成失败', describeHttpError(result.status) + (apiMsg ? '\n\n服务端返回：' + apiMsg : ''), '请根据上面的状态码检查 API 配置后重试。');
    return;
  }
  let content = '';
  try {
    const d = JSON.parse(result.text || '{}');
    content = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  } catch (e) {}
  if (!content) {
    showErrorDialog('生成失败', '模型没有返回可用内容（choices 为空）。可能触发了内容过滤、达到长度上限或模型参数不兼容。', '请重试，或更换模型后再试。');
    return;
  }
  const done = resumeApply(p.kind, content);
  if (done && typeof done.then === 'function') {
    done.then(() => toast('已恢复上一次生成')).catch((e) => showErrorDialog('生成失败', String((e && e.message) || e)));
  }
}

function resumePendingApi() {
  const p = csPendingGet();
  if (!p || !p.kind) return;
  if (Date.now() - (p.ts || 0) > 15 * 60 * 1000) { csPendingSet(null); return; }
  const r = csTakeResult(p.resultKey);
  if (r) { finishResume(p, r); return; }
  // 父页面仍在后台请求：显示不遮挡返回按钮的提示并轮询结果
  setBusy(true, '正在恢复上一次生成…');
  let tries = 0;
  if (resumePoll) clearInterval(resumePoll);
  resumePoll = setInterval(() => {
    tries++;
    const rr = csTakeResult(p.resultKey);
    if (rr) {
      clearInterval(resumePoll); resumePoll = null; setBusy(false);
      finishResume(p, rr);
      return;
    }
    if (tries > 180) {
      clearInterval(resumePoll); resumePoll = null; setBusy(false);
      csPendingSet(null);
      showErrorDialog('生成失败', '上一次生成等待超时，未能取回结果。\n\n可能原因：网络中断、API 地址不可达、服务端长时间无响应，或请求已超过 15 分钟。', '请返回后重新点击生成。');
    }
  }, 1000);
}

/* ---------- 初始化 ---------- */
(async function init() {
  maskList = await DB.getMasks();
  currentMaskId = await DB.getCurrentMaskId();
  currentMask = maskList.find((m) => m.id === currentMaskId) || maskList[0] || null;
  try { await loadUserProfile(); } catch (e) {}
  try { await loadWorldbooks(); } catch (e) {}

  const allChars = await DB.getCharacters();
  charList = allChars.filter((c) => {
    if (!c) return false;
    if (c.nanoAssistant === true) return false;   // 纳米是助手，不是可互动角色
    if (c.isNpc === true) return true;
    if (currentMask && c.bindUser === currentMask.id) return true;
    return false;
  }).map((c) => ({
    id: c.id,
    name: c.name || '未命名',
    avatar: c.avatar || '',
    desc: c.setting || '',
    gender: c.gender,
    nationality: c.nationality,
    setting: c.setting,
    bindUser: c.bindUser,
    isNpc: c.isNpc,
    worldbookBindings: c.worldbookBindings,
    createdAt: c.createdAt || c.created || c.addedAt || c.time || c.ts || ''
  }));

  state = await dbGet();
  if (!state) {
    state = defaultState();
    if (charList.length) state.char = charList[0];
    await dbPut(state);
  } else {
    if (!state.letters || !state.letters.current) {
      state.letters = { current: { user: '', char: '', userLocked: false, charLocked: false, unlocked: false }, history: [] };
    }
    if (!state.diaries || !state.diaries.current) {
      state.diaries = { current: { user: '', char: '', userLocked: false, charLocked: false, unlocked: false }, history: [] };
    }
    if (!state.letters.history) state.letters.history = [];
    if (!state.diaries.history) state.diaries.history = [];
    if (state.char && charList.length && !charList.find((c) => c.id === state.char.id)) {
      state.char = charList[0];
    }
    await dbPut(state);
  }

  if (!Array.isArray(state.anniversaries)) state.anniversaries = [];
  ensureAnnivBase();
  await dbPut(state);

  selectedChar = state.char;
  renderRoot();
  try { resumePendingApi(); } catch (e) {}
})();

window.addEventListener('resize', () => {
  document.documentElement.style.setProperty('--vw-safe', Math.min(window.innerWidth, 430) + 'px');
});