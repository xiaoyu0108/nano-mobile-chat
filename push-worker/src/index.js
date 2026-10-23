import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Model, model, X-Push-Token, X-Peek-Token, X-Nano-App, X-Nano-Kind, xi-api-key',
  'Access-Control-Max-Age': '86400',
};

// ===== D1 兼容层 =====
// 绑定 D1 后，所有原来走 KV 的 get/put/delete/list 自动切到 D1 的 kv 表；
// 没绑定 D1 时继续用 KV，方便还没迁移完成的部署。
// 这样业务代码不用改 key 结构，先把免费版 KV 的读写/list 额度压力卸掉。
function d1Kv(db) {
  return {
    async get(key) {
      await d1Ready(db);
      const row = await db.prepare('SELECT value, expires_at FROM kv WHERE key = ?').bind(String(key)).first();
      if (!row) return null;
      if (row.expires_at && Number(row.expires_at) <= Date.now()) {
        try { await db.prepare('DELETE FROM kv WHERE key = ?').bind(String(key)).run(); } catch (e) {}
        return null;
      }
      return row.value;
    },
    async put(key, value, opts) {
      await d1Ready(db);
      const exp = opts && opts.expirationTtl ? Date.now() + Number(opts.expirationTtl) * 1000 : 0;
      await db.prepare(
        'INSERT INTO kv (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at'
      ).bind(String(key), String(value), exp, Date.now()).run();
    },
    async delete(key) {
      await d1Ready(db);
      await db.prepare('DELETE FROM kv WHERE key = ?').bind(String(key)).run();
    },
    async list(opts) {
      await d1Ready(db);
      const prefix = String((opts && opts.prefix) || '');
      const limit = Math.max(1, Math.min(1000, Number((opts && opts.limit) || 1000)));
      const rows = await db.prepare(
        'SELECT key FROM kv WHERE key LIKE ? AND (expires_at = 0 OR expires_at > ?) ORDER BY key LIMIT ?'
      ).bind(prefix + '%', Date.now(), limit).all();
      return { keys: (rows.results || []).map(function (r) { return { name: r.key }; }), list_complete: true };
    }
  };
}
const D1_READY = new WeakMap();
function d1Ready(db) {
  let p = D1_READY.get(db);
  if (!p) {
    p = db.prepare(
      'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)'
    ).run().catch(function () {});
    D1_READY.set(db, p);
  }
  return p;
}
function kv(env) {
  const db = env && (env.DB || env.nano_db);
  return db ? d1Kv(db) : env.PUSH_KV;
}
// 集市旧数据还在 KV 里：即使 D1 已接管，也继续从 KV 读，避免迁移后旧帖子凭空消失。
function marketKv(env) {
  return (env && env.PUSH_KV) ? env.PUSH_KV : kv(env);
}

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ===== Supabase（共享集市）=====
// 只配 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 时启用；service role key 只在服务端，
// 不能写进前端。没配置或请求失败时，下面 market 路由会自动回退到 KV。
function supabaseConf(env) {
  const url = String((env && env.SUPABASE_URL) || '').replace(/\/+$/, '');
  const key = String((env && env.SUPABASE_SERVICE_ROLE_KEY) || '');
  return (url && key) ? { url: url, key: key } : null;
}
async function supabase(env, path, opts) {
  const c = supabaseConf(env);
  if (!c) throw new Error('supabase not configured');
  const o = opts || {};
  const headers = Object.assign({
    'apikey': c.key,
    'Authorization': 'Bearer ' + c.key,
    'Content-Type': 'application/json'
  }, o.headers || {});
  const resp = await fetch(c.url + path, {
    method: o.method || 'GET',
    headers: headers,
    body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body))
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!resp.ok) {
    const msg = (data && (data.message || data.error_description || data.hint)) || ('HTTP ' + resp.status);
    const err = new Error('Supabase: ' + msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}
function marketRowToSummary(row) {
  const s = Object.assign({}, (row && row.summary) || {});
  s.id = (row && row.id) || s.id;
  s.likes = Number(row && row.likes) || 0;
  s.downloads = Number(row && row.downloads) || 0;
  s.imports = Number(row && row.imports) || 0;
  return s;
}
function marketRowToItem(row) {
  const it = Object.assign({}, (row && row.item) || {});
  it.id = (row && row.id) || it.id;
  it.likes = Number(row && row.likes) || 0;
  it.downloads = Number(row && row.downloads) || 0;
  it.imports = Number(row && row.imports) || 0;
  return it;
}

function subId(endpoint) {
  return 'sub:' + btoa(endpoint).replace(/[^a-zA-Z0-9]/g, '').slice(-48);
}
// 新订阅按 app/device/user 分层存：getSubs 只 list 当前作用域，
// 不再每次 list 全站所有订阅再逐条 get（老实现用户一多就读写爆量）。
function subKey(endpoint, appId, deviceId, userId) {
  return 'sub2:' + cleanAppId(appId) + ':' + cleanDeviceId(deviceId) + ':' + cleanUserId(userId) + ':' + subId(endpoint).slice(4);
}

// ===== 隔离维度：appId（站点/部署）+ deviceId（设备/浏览器）+ userId（人设/用户）=====
// 客户端 NanoScope/nano-push 会用「站点根目录的哈希」生成 appId，旧客户端没有 appId 时记为 legacy。
function cleanPart(v, fallback, max) {
  const s = String(v == null ? '' : v).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, max || 80);
  return s || fallback;
}
function cleanAppId(v) { return cleanPart(v, 'legacy', 48); }
function cleanDeviceId(v) { return cleanPart(v, 'default', 80); }
// userId 可能来自用户自定义面具（含中文/空格），只去掉会破坏 KV key 结构的冒号。
function cleanUserId(v) {
  const s = String(v == null ? '' : v).replace(/:/g, '_').slice(0, 80);
  return s || 'default';
}
function autoScope(appId, deviceId, userId) {
  return cleanAppId(appId) + ':' + cleanDeviceId(deviceId) + ':' + cleanUserId(userId);
}
function autoKey(kind, appId, deviceId, userId) {
  return 'auto2:' + kind + ':' + autoScope(appId, deviceId, userId);
}
function autoActiveKey(appId, deviceId) {
  return 'auto2:active:' + cleanAppId(appId) + ':' + cleanDeviceId(deviceId);
}
// ===== KV 索引 =====
// 免费版 KV 每天只有 1000 次 list。旧实现每 5 分钟 list 一次 auto2:config: 和 job:，
// 光 cron 就 576 次/天，稍微多做点事就会收到额度告警。改为用索引 key：
//   auto2:_index = ["app:device:user", ...]
//   job:_index   = ["job:时间戳:随机", ...]
// cron 只 get 索引；旧数据/索引丢失时才 list 一次重建。
const AUTO_INDEX_KEY = 'auto2:_index';
const JOB_INDEX_KEY = 'job:_index';
function autoScopeOf(appId, deviceId, userId) {
  return cleanAppId(appId) + ':' + cleanDeviceId(deviceId) + ':' + cleanUserId(userId);
}
async function readIndex(env, key) {
  try {
    const raw = await kv(env).get(key);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) { return null; }
}
async function writeIndex(env, key, arr) {
  const clean = Array.from(new Set((arr || []).filter(Boolean))).slice(-300);
  try { await kv(env).put(key, JSON.stringify(clean)); } catch (e) {}
  return clean;
}
async function addAutoScope(env, scope) {
  const arr = await readIndex(env, AUTO_INDEX_KEY);
  if (arr === null) return;              // 让 cron 用 list 建一次完整索引
  if (arr.indexOf(scope) === -1) await writeIndex(env, AUTO_INDEX_KEY, arr.concat(scope));
}
async function removeAutoScope(env, scope) {
  const arr = await readIndex(env, AUTO_INDEX_KEY);
  if (arr === null) return;
  if (arr.indexOf(scope) !== -1) await writeIndex(env, AUTO_INDEX_KEY, arr.filter(function (x) { return x !== scope; }));
}
async function getAutoScopes(env) {
  const arr = await readIndex(env, AUTO_INDEX_KEY);
  if (arr !== null) return arr;
  try {
    const { keys } = await kv(env).list({ prefix: 'auto2:config:' });
    const scopes = (keys || []).map(function (k) { return k.name.slice('auto2:config:'.length); });
    await writeIndex(env, AUTO_INDEX_KEY, scopes);
    return scopes;
  } catch (e) { return []; }
}
async function addJobId(env, id) {
  const arr = await readIndex(env, JOB_INDEX_KEY);
  if (arr === null) return;
  if (arr.indexOf(id) === -1) await writeIndex(env, JOB_INDEX_KEY, arr.concat(id));
}
// 内存缓存：/auto/pending 每次回前台都会调，不能每次都写一次 KV。
// 同一 isolate 内 10 分钟内重复请求直接跳过；跨 isolate 最坏也只是多写一次。
const ACTIVE_CACHE = new Map();
async function touchActive(env, appId, deviceId, userId, force) {
  appId = cleanAppId(appId); deviceId = cleanDeviceId(deviceId); userId = cleanUserId(userId);
  const cacheKey = appId + ':' + deviceId;
  const now = Date.now();
  const hit = ACTIVE_CACHE.get(cacheKey);
  if (!force && hit && hit.userId === userId && now - hit.checkedAt < 10 * 60 * 1000) return;
  try {
    const key = autoActiveKey(appId, deviceId);
    const raw = await kv(env).get(key);
    if (raw && !force) {
      let old = {};
      try { old = JSON.parse(raw) || {}; } catch (e) { old = {}; }
      // 同一用户且 6 小时内刚写过：只更新内存缓存，不再写 KV。
      if (String(old.userId || '') === userId && now - (Number(old.at) || 0) < 6 * 3600 * 1000) {
        ACTIVE_CACHE.set(cacheKey, { userId: userId, checkedAt: now });
        return;
      }
    }
    await kv(env).put(key, JSON.stringify({
      userId: userId, appId: appId, deviceId: deviceId, at: now
    }), { expirationTtl: 60 * 60 * 24 * 7 });
    ACTIVE_CACHE.set(cacheKey, { userId: userId, checkedAt: now });
  } catch (e) {}
}
function autoConfigSig(cfg) {
  try {
    const c = Object.assign({}, cfg || {});
    delete c.updatedAt;
    return JSON.stringify(c);
  } catch (e) { return ''; }
}
function peekBase(appId, chatId) {
  const a = cleanAppId(appId);
  const c = String(chatId || 'default');
  return a === 'legacy' ? ('peek:' + c) : ('peek2:' + a + ':' + c);
}

// ===== VAPID：优先用 secrets；没配置就自动生成一对存进 KV，用户不需要自己生成 =====
function b64urlEncode(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes || []);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? new Array(5 - (s.length % 4)).join('=') : '';
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function ensureVapid(env) {
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE) {
    return {
      subject: env.VAPID_SUBJECT || 'https://nanopush.nano315.online',
      publicKey: String(env.VAPID_PUBLIC),
      privateKey: String(env.VAPID_PRIVATE)
    };
  }
  try {
    const raw = await kv(env).get('vapid:keys');
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.publicKey && o.privateKey) {
        return {
          subject: o.subject || env.VAPID_SUBJECT || 'https://nanopush.nano315.online',
          publicKey: o.publicKey,
          privateKey: o.privateKey
        };
      }
    }
  } catch (e) {}
  try {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const x = b64urlDecode(pub.x);
    const y = b64urlDecode(pub.y);
    const point = new Uint8Array(65);
    point[0] = 4;
    point.set(x, 1);
    point.set(y, 33);
    const o = {
      subject: env.VAPID_SUBJECT || 'https://nanopush.nano315.online',
      publicKey: b64urlEncode(point),
      privateKey: String(priv.d || ''),
      createdAt: Date.now()
    };
    if (!o.privateKey) return null;
    await kv(env).put('vapid:keys', JSON.stringify(o));
    return o;
  } catch (e) {
    return null;
  }
}

function tokenOk(request, env) {
  // 如果设置了 PUSH_TOKEN secret，则 /schedule 和 /send 必须带 X-Push-Token 头
  if (!env.PUSH_TOKEN) return true;
  return request.headers.get('X-Push-Token') === env.PUSH_TOKEN;
}

// 屏幕速聊（iOS 快捷指令）令牌校验：带了 PEEK_TOKEN 就必须匹配，未设置则放行
function peekOk(request, env, body) {
  if (!env.PEEK_TOKEN) return true;
  const h = request.headers.get('X-Peek-Token');
  let q = '';
  try { q = new URL(request.url).searchParams.get('token') || ''; } catch (e) {}
  const b = body && body.token ? String(body.token) : '';
  return h === env.PEEK_TOKEN || q === env.PEEK_TOKEN || b === env.PEEK_TOKEN;
}

function modelEndpoint(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/\/v1$/i.test(s)) s += '/v1';
  return s + '/chat/completions';
}

async function peekTurns(env, chatId, appId) {
  try {
    const raw = await kv(env).get(peekBase(appId, chatId));
    if (raw) return JSON.parse(raw);
    // 兼容旧键：只在没有 appId 时才回退，避免新站点读到旧 Nano 的暂存轮次
    if (cleanAppId(appId) !== 'legacy') return [];
    return [];
  } catch (e) { return []; }
}
async function peekSave(env, chatId, turns, appId) {
  try { await kv(env).put(peekBase(appId, chatId), JSON.stringify(turns.slice(-40)), { expirationTtl: 60 * 60 * 24 * 7 }); } catch (e) {}
}
// 屏幕速聊复用主 API：优先读 /peek/persona 同步上来的这份，再读 /auto/config 里的 api。
// 这样 PEEK_API_* 只是可选项，不再因为漏配 secret 导致「弹窗有了但模型没被调用」。
async function peekApiConfig(env, appId, chatId, body, owner) {
  const cleanApi = function (v) {
    if (!v || typeof v !== 'object') return null;
    const url = String(v.url || '').trim();
    const key = String(v.key || '').trim();
    const model = String(v.model || '').trim();
    return (url && key && model) ? { url: url, key: key, model: model } : null;
  };
  const deviceId = cleanDeviceId((owner && owner.deviceId) || (body && body.deviceId) || 'default');
  let userId = cleanUserId((owner && owner.userId) || (body && body.userId) || '');
  if (!userId || userId === 'default') {
    try {
      const rawActive = await kv(env).get(autoActiveKey(appId, deviceId));
      if (rawActive) {
        const active = JSON.parse(rawActive);
        if (active && active.userId) userId = cleanUserId(active.userId);
      }
    } catch (e) {}
  }
  if (!userId) userId = 'default';
  // 1) 优先用聊天同步上来的最新主 API
  try {
    const raw = await kv(env).get(autoKey('config', appId, deviceId, userId));
    if (raw) {
      const cfg = JSON.parse(raw);
      const api = cleanApi(cfg && cfg.api);
      if (api) return api;
    }
  } catch (e) {}
  // 2) 没有 auto config 时，再用窥屏页保存的那份
  try {
    const raw = await kv(env).get(peekBase(appId, 'api:' + chatId));
    if (raw) {
      const own = cleanApi(JSON.parse(raw));
      if (own) return own;
    }
    const rawLatest = await kv(env).get(peekBase(appId, 'api:latest'));
    if (rawLatest) {
      const latest = cleanApi(JSON.parse(rawLatest));
      if (latest) return latest;
    }
  } catch (e) {}
  return null;
}

// ===== 无后台主动消息 / 朋友圈 =====
// 客户端把「人设 + 设置 + 模型配置」同步上来，Worker 的 cron 到点生成内容并推送；
// 内容先暂存在 KV，App 回到前台后拉取合并，所以不需要网页一直开着。
function autoOk(request, env, body) {
  const tokens = [env.PUSH_TOKEN, env.PEEK_TOKEN].filter(Boolean);
  if (!tokens.length) return true;
  let h = '';
  try { h = request.headers.get('X-Push-Token') || request.headers.get('X-Peek-Token') || ''; } catch (e) {}
  let q = '';
  try { q = new URL(request.url).searchParams.get('token') || ''; } catch (e) {}
  const b = body && body.token ? String(body.token) : '';
  return tokens.indexOf(h) >= 0 || tokens.indexOf(q) >= 0 || tokens.indexOf(b) >= 0;
}
function clampNum(n, min, max, dflt) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) n = dflt;
  return Math.max(min, Math.min(max, n));
}
function sanitizeAutoConfig(body) {
  body = body || {};
  const chars = Array.isArray(body.chars) ? body.chars.slice(0, 30).map(function (c) {
    const av = String((c && c.avatar) || '');
    return {
      id: String((c && c.id) || '').slice(0, 80),
      name: String((c && c.name) || '').slice(0, 40),
      // 头像只在不是超长 dataURL 时保存，避免把配置撑大
      avatar: av.length > 4000 ? '' : av,
      setting: String((c && c.setting) || '').slice(0, 6000),
      isNpc: !!(c && c.isNpc),
      nationality: String((c && c.nationality) || '').slice(0, 40),
      language: String((c && c.language) || '').slice(0, 40),
      foreign: !!(c && c.foreign),
      forceTranslate: !!(c && c.forceTranslate),
      forceLang: String((c && c.forceLang) || '').slice(0, 40),
      // 最近聊天上下文：后台生成必须接得上你们刚聊过的话题，不能凭空发口水话
      recent: (Array.isArray(c && c.recent) ? c.recent.slice(-6) : []).map(function (r) {
        return {
          who: (r && r.who === 'user') ? 'user' : 'char',
          text: String((r && r.text) || '').replace(/\s+/g, ' ').trim().slice(0, 160)
        };
      }).filter(function (r) { return r.text; }),
      // 月潮：只有用户开放权限的角色才会带这份数据
      cycle: (function () {
        const cy = c && c.cycle;
        if (!cy || !/^\d{4}-\d{2}-\d{2}$/.test(String(cy.lastStart || ''))) return null;
        return {
          lastStart: String(cy.lastStart),
          nextStart: /^\d{4}-\d{2}-\d{2}$/.test(String(cy.nextStart || '')) ? String(cy.nextStart) : '',
          cycleLength: Math.max(18, Math.min(60, parseInt(cy.cycleLength, 10) || 28)),
          periodLength: Math.max(2, Math.min(14, parseInt(cy.periodLength, 10) || 5)),
          remindDays: Math.max(0, Math.min(14, parseInt(cy.remindDays, 10) || 0))
        };
      })()
    };
  }).filter(function (c) { return c.id && c.name; }) : [];
  const api = body.api && typeof body.api === 'object' ? {
    url: String(body.api.url || '').slice(0, 500),
    key: String(body.api.key || '').slice(0, 500),
    model: String(body.api.model || '').slice(0, 120)
  } : null;
  return {
    enabled: !!(body.enabled || body.msgEnabled || body.momentEnabled),
    msgEnabled: !!body.msgEnabled,
    momentEnabled: !!body.momentEnabled,
    // 客户端设置里最小是 1 小时；这里再兜底，防止旧缓存把 8 当成分钟导致每 8 分钟发一次
    intervalMinutes: clampNum(body.intervalMinutes, 30, 1440, 480),
    momentIntervalHours: clampNum(body.momentIntervalHours, 0.5, 720, 24),
    user: {
      id: String((body.user && body.user.id) || 'default').slice(0, 80),
      name: String((body.user && body.user.name) || '我').slice(0, 40)
    },
    chars: chars,
    api: api,
    // iPhone：Bark 密钥由 App 同步上来，Worker 在后台生成内容后可直接发系统通知，
    // 不再依赖网页还活着（Web Push 订阅失败/无 GMS 时也能收到）。
    barkKey: String(body.barkKey || '').slice(0, 500),
    updatedAt: Date.now()
  };
}
async function autoChat(env, cfg, messages, maxTokens, temperature) {
  const url = modelEndpoint(env.AUTO_API_URL || env.PEEK_API_URL || (cfg.api && cfg.api.url) || '');
  const key = env.AUTO_API_KEY || env.PEEK_API_KEY || (cfg.api && cfg.api.key) || '';
  const model = env.AUTO_MODEL || env.PEEK_MODEL || (cfg.api && cfg.api.model) || '';
  if (!url || !key || !model) return null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens || 500,
        temperature: (typeof temperature === 'number' ? temperature : 0.95)
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return c ? String(c).trim() : null;
  } catch (e) { return null; }
}
function pickRandom(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i]; copy[i] = copy[j]; copy[j] = t;
  }
  return copy.slice(0, n);
}
function splitAutoBubbles(text) {
  return String(text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 3);
}
function cleanBubble(s) {
  return String(s == null ? '' : s)
    .replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
    .replace(/^\s*(?:你|角色|消息|气泡)\s*[:：]\s*/, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}
function ensureBubbles(raw, max) {
  let list = [];
  if (Array.isArray(raw)) list = raw.map(cleanBubble).filter(Boolean);
  else if (typeof raw === 'string') list = splitAutoBubbles(raw).map(cleanBubble).filter(Boolean);
  max = max || 3;
  // 模型只给一整段时，按句子拆成 2~3 个气泡；外文/翻译格式含 || 时不拆，避免拆坏原文
  if (list.length === 1 && list[0].indexOf('||') < 0 && list[0].length > 16) {
    const parts = list[0].split(/(?<=[。！？!?…])/).map(cleanBubble).filter(Boolean);
    if (parts.length > 1) list = parts;
  }
  // 去掉重复和空句，最多 3 条
  const out = [];
  list.forEach(function (s) {
    s = cleanBubble(s).slice(0, 240);
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out.slice(0, max);
}
function parseHeart(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const subject = String(raw.subject || raw.impression || '').trim();
    const thought = String(raw.thought || raw.text || raw.inner || '').trim();
    return (subject || thought) ? { subject: subject, thought: thought || subject } : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const sep = s.indexOf('||');
  return sep > -1
    ? { subject: s.slice(0, sep).trim(), thought: s.slice(sep + 2).trim() }
    : { subject: '', thought: s };
}
// 一次调用返回：思维链 + 心声 + 2~3 条气泡（兼容模型不按 JSON 输出的情况）
function parseAutoReply(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;
  text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  let think = '', heart = null, bubbles = [];
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a > -1 && b > a) {
    try {
      const obj = JSON.parse(text.slice(a, b + 1));
      if (obj && typeof obj === 'object') {
        think = String(obj.think || obj.cot || obj.reasoning || '').trim();
        heart = parseHeart(obj.heart || obj.inner || obj.thoughtVoice);
        bubbles = ensureBubbles(obj.bubbles || obj.lines || obj.messages || obj.body, 3);
      }
    } catch (e) {}
  }
  if (!bubbles.length) {
    // 非 JSON：提取 [think]...[/think] 与 [heart:...]
    const tm = text.match(/\[(?:think(?:ing)?|thought|reasoning|cot|思考|思维链)\s*\]([\s\S]*?)\[\s*\/\s*(?:think(?:ing)?|thought|reasoning|cot|思考|思维链)\s*\]/i);
    if (tm) { think = think || String(tm[1] || '').trim(); text = text.replace(tm[0], ' '); }
    const hm = text.match(/\[(?:heart|心声)\s*[:：]\s*([\s\S]*?)\]/i);
    if (hm) { heart = heart || parseHeart(hm[1]); text = text.replace(hm[0], ' '); }
    text = text.replace(/\[\s*\/?\s*(?:think(?:ing)?|thought|reasoning|analysis|cot|思考|思维链)\s*\]/gi, ' ');
    bubbles = ensureBubbles(text, 3);
  }
  if (!bubbles.length) return null;
  return { think: think, heart: heart, bubbles: bubbles };
}
function recentBlock(c) {
  const r = (c && Array.isArray(c.recent)) ? c.recent : [];
  if (!r.length) return '';
  return '\n\n【你们最近的聊天 · 从旧到新（必须接住这些内容）】\n' +
    r.map(function (x) { return (x.who === 'user' ? '用户：' : '你：') + x.text; }).join('\n') +
    '\n【强相关要求】这轮主动消息必须自然接住上面最后的话题、情绪或还没说完的事；不要另起无关话题。';
}
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function addDaysMs(ms, n) { return ms + n * 86400000; }
function fmtCn(ms) {
  const d = new Date(ms);
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
}
function autoLangName(c) {
  if (!c) return '';
  if (c.forceTranslate && c.forceLang) return String(c.forceLang).trim();
  const given = String(c.language || '').trim();
  // 外国人即使语言字段是「中文」，主动消息也强制用国籍对应的母语
  if (given && !/中文|汉语|漢語|chinese/i.test(given)) return given;
  const nat = String(c.nationality || '');
  const map = {
    '美国': '英文', '英国': '英文', '澳大利亚': '英文', '加拿大': '英文', '新西兰': '英文', '印度': '英文', '新加坡': '英文',
    '法国': '法文', '德国': '德文', '奥地利': '德文', '西班牙': '西班牙文', '墨西哥': '西班牙文', '阿根廷': '西班牙文',
    '巴西': '葡萄牙文', '葡萄牙': '葡萄牙文', '意大利': '意大利文', '日本': '日文', '韩国': '韩文', '俄罗斯': '俄文',
    '泰国': '泰文', '越南': '越南文', '荷兰': '荷兰文', '瑞典': '瑞典文', '挪威': '挪威文', '丹麦': '丹麦文',
    '芬兰': '芬兰文', '波兰': '波兰文', '土耳其': '土耳其文', '沙特阿拉伯': '阿拉伯文', '阿联酋': '阿拉伯文', '埃及': '阿拉伯文'
  };
  for (const k of Object.keys(map)) if (nat.indexOf(k) > -1) return map[k];
  return '英文';
}
function autoIsForeign(c) {
  if (!c) return false;
  if (c.forceTranslate) return true;
  if (c.foreign) return true;
  const nat = String(c.nationality || '').trim();
  return !!(nat && nat !== '未知' && nat !== '未设定' && !/(中国|中國|china|chinese|香港|澳门|澳門|台湾|台灣)/i.test(nat));
}
function autoLangBlock(c) {
  if (!autoIsForeign(c)) return '';
  const lang = autoLangName(c);
  const trans = /粤语|粵語|cantonese/i.test(lang) ? '普通话' : '中文';
  return '【语言 · 最高优先级】你是' + (c.nationality || '外国') + '人，母语是' + lang + '。'
    + '本轮主动消息的正文必须只用' + lang + '写，绝不能用中文当正文；即使人设或上面的说明是中文，也不要改变。'
    + '每行一条气泡，严格按「' + lang + '原文||' + trans + '翻译」的格式输出，用 || 分隔；' + trans + '只能出现在 || 右边作为翻译，翻译要自然口语化。\n';
}
function cycleBlock(c) {
  const cy = c && c.cycle;
  if (!cy || !cy.lastStart) return '';
  const todayMs = parseYmd(beijingToday());
  let last = parseYmd(cy.lastStart);
  if (!last) return '';
  let next = addDaysMs(last, cy.cycleLength);
  let guard = 0;
  while (next <= todayMs && guard < 400) {
    last = next;
    next = addDaysMs(last, cy.cycleLength);
    guard++;
  }
  const daysUntil = Math.max(0, Math.round((next - todayMs) / 86400000));
  const periodEnd = addDaysMs(last, cy.periodLength - 1);
  const inPeriod = todayMs >= last && todayMs <= periodEnd;
  const periodDay = inPeriod ? Math.round((todayMs - last) / 86400000) + 1 : 0;
  const ovulation = addDaysMs(next, -14 * 86400000);
  const fertileStart = addDaysMs(ovulation, -5 * 86400000);
  const fertileEnd = addDaysMs(ovulation, 86400000);
  let s = '\n\n【月潮 · 她的经期（她只对你开放了这份记录）】\n';
  if (inPeriod) s += '她现在正在经期，今天是第 ' + periodDay + ' 天（预计持续约 ' + cy.periodLength + ' 天）。\n';
  s += '预计下次经期：' + fmtCn(next) + '（还有 ' + daysUntil + ' 天），预计持续 ' + cy.periodLength + ' 天。\n';
  s += '预计排卵日：' + fmtCn(ovulation) + '；排卵期：' + fmtCn(fertileStart) + '–' + fmtCn(fertileEnd) + '。\n';
  s += '这是她自己的私密记录，推算不一定完全准确。你知道就好，不要生硬播报日期或“系统推算”。\n';
  if (cy.remindDays > 0 && daysUntil <= cy.remindDays) {
    s += '【本轮提醒时机】她预计 ' + (daysUntil === 0 ? '今天' : (daysUntil + ' 天后')) + ' 来经期。这一轮必须自然关心她，提醒她注意休息、别太累、备好用品；语气像你本人，不要像提醒机器人，也不要提“记录/推算/提醒设置”。\n';
  }
  return s;
}
async function generateAutoMessages(env, cfg, busyChatId, avoidId) {
  const pool = cfg.chars.filter(function (c) { return c.id !== busyChatId && !c.isNpc; });
  let source = pool.length >= 2 ? pool : cfg.chars.filter(function (c) { return c.id !== busyChatId; });
  // 尽量不连续两轮都让同一个角色发，减少「怎么又是 TA」的重复感
  if (avoidId) {
    const fresh = source.filter(function (c) { return String(c.id) !== String(avoidId); });
    if (fresh.length) source = fresh;
  }
  if (!source.length) return [];
  // 每个周期只让 1 个角色发消息：避免一次生成多条、成倍消耗 API，也避免刷屏
  const picked = pickRandom(source, 1);
  const out = [];
  const now = Date.now();
  for (const c of picked) {
    const system = '你是「' + c.name + '」，现在主动给「' + cfg.user.name + '」发消息。\n'
      + (c.setting ? ('【你的人设】\n' + c.setting + '\n\n') : '')
      + '现在是 ' + new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') + '（北京时间）。\n'
      + autoLangBlock(c)
      + cycleBlock(c)
      + recentBlock(c)
      + '\n【硬性要求】\n'
      + '- 只发这一次，不要连续追问、不要复读、不要一次写一大段。\n'
      + '- 必须和上面的最近聊天强相关：接住话题/情绪/约定，或分享一件刚好发生、能接得住的小事。\n'
      + '- 严禁口水话：禁止“在吗/在干嘛/吃了吗/睡了吗/忙不忙”“想你了”却没有下文；禁止无关的日常流水账；禁止括号旁白；禁止提系统/推送/AI。\n'
      + '- 一次 API 调用同时产出：思维链 think、心声 heart、正文 bubbles。\n'
      + '- bubbles 必须是 2~3 条各自独立的气泡（每条 1 句，口语自然），不要把多条塞进同一条。\n'
      + '- heart 格式固定为「此刻印象||心声独白」，心声 60~120 字，平实、不要煽情。\n'
      + '- 外国人 / 粤语角色仍按上面的语言规则输出「原文||中文翻译」。\n'
      + '只输出 JSON，不要任何多余文字：\n'
      + '{"think":"这一轮的思考，40~100字","heart":"此刻印象||心声独白","bubbles":["第一条","第二条","第三条"]}';
    const text = await autoChat(env, cfg, [
      { role: 'system', content: system },
      { role: 'user', content: '发 2~3 条强相关的主动消息。' }
    ], 1000, 1.0);
    const parsed = parseAutoReply(text);
    if (!parsed || !parsed.bubbles.length) continue;
    out.push({
      id: 'm_' + now + '_' + c.id,
      chatId: c.id, charId: c.id, name: c.name, avatar: c.avatar || '',
      text: parsed.bubbles.join('\n'), bubbles: parsed.bubbles,
      think: parsed.think || '', heart: parsed.heart || null,
      ts: now
    });
  }
  return out;
}
async function generateAutoMoments(env, cfg, busyChatId, maxChars) {
  const pool = cfg.chars.filter(function (c) { return c.id !== busyChatId && !c.isNpc; });
  const source = pool.length ? pool : cfg.chars.filter(function (c) { return c.id !== busyChatId; });
  if (!source.length) return [];
  // 后台一次最多让 3 个角色出现；和主动消息合计也由 runAutoPush 控制在 3 个以内
  const count = Math.max(1, Math.min(Number(maxChars) || 2, 3, source.length));
  const picked = pickRandom(source, count);
  const names = picked.map(function (c) { return c.name; });
  const profiles = picked.map(function (c) {
    const recent = (c.recent || []).slice(-3).map(function (r) {
      return (r.who === 'user' ? '用户：' : 'TA：') + r.text;
    }).join('；');
    return '· ' + c.name + '：' + String(c.setting || '').slice(0, 500)
      + (recent ? ('\n  最近聊天：' + recent) : '');
  }).join('\n');
  const sys = '你们是彼此认识的朋友，在同一个朋友圈里。请让以下角色各发一条朋友圈动态：' + names.join('、') + '。\n'
    + '【角色人设与最近聊天】\n' + profiles + '\n'
    + '要求：像真人随手发的日常，具体、有细节，最好和 TA 最近聊过的事有一点关联；不要流水账，不要对任何人说话，不要提问，禁止 AI 腔。\n'
    + '每人只发 1 条，不要重复作者；最多 ' + count + ' 条。\n'
    + '每条动态都要带 1~3 个点赞和 1~3 条评论；点赞/评论者只能从这些名字里选：' + names.join('、') + '，不能是动态作者本人，也不能出现「' + cfg.user.name + '」。\n'
    + '只输出 JSON 数组：[{"author":"名字","text":"动态文案","location":"地点或空","likes":["名字"],"comments":[{"user":"名字","toUser":"","text":"评论"}]}]';
  const content = await autoChat(env, cfg, [
    { role: 'system', content: sys },
    { role: 'user', content: '生成 ' + picked.length + ' 条朋友圈动态。' }
  ], 1400, 1.0);
  if (!content) return [];
  let arr = null;
  const a = content.indexOf('['), b = content.lastIndexOf(']');
  if (a > -1 && b > a) { try { arr = JSON.parse(content.slice(a, b + 1)); } catch (e) {} }
  if (!Array.isArray(arr)) return [];
  const nameSet = {};
  names.forEach(function (n) { nameSet[n] = true; });
  const pickName = function (raw) {
    const n = String(raw == null ? '' : raw).trim();
    if (!n) return '';
    if (nameSet[n]) return n;
    return names.find(function (x) { return x && (x.indexOf(n) > -1 || n.indexOf(x) > -1); }) || '';
  };
  const out = [];
  const now = Date.now();
  const canned = ['这条也太真实了', '哈哈哈哈', '我也想去', '注意休息呀', '好看', '下次带我'];
  const usedAuthors = {};
  arr.slice(0, count).forEach(function (o, i) {
    if (!o || !o.text) return;
    const au = pickName(o.author) || names[Math.min(i, names.length - 1)];
    if (!au || usedAuthors[au]) return;
    usedAuthors[au] = true;
    const likes = [];
    (Array.isArray(o.likes) ? o.likes : []).forEach(function (raw) {
      const n = pickName(raw);
      if (n && n !== au && likes.indexOf(n) < 0) likes.push(n);
    });
    if (!likes.length) names.forEach(function (n) { if (n !== au && likes.length < 2) likes.push(n); });
    const comments = [];
    (Array.isArray(o.comments) ? o.comments : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      const u = pickName(c.user || c.name || c.author);
      const txt = String(c.text || c.content || '').trim();
      if (!u || !txt) return;
      comments.push({ user: u, toUser: pickName(c.toUser || c.replyTo || c.to), text: txt.slice(0, 120) });
    });
    // 模型漏写评论时也要有互动，不能只发一条光秃秃的动态。
    if (!comments.length) {
      const other = names.find(function (n) { return n !== au; });
      if (other) comments.push({ user: other, toUser: '', text: canned[(i + au.length) % canned.length] });
    }
    const char = picked.find(function (c) { return c.name === au; }) || {};
    out.push({
      id: 'srv_' + now + '_' + i + '_' + Math.random().toString(36).slice(2, 5),
      author: au, avatar: char.avatar || '', text: String(o.text).slice(0, 500),
      images: [], time: new Date(now - (arr.length - 1 - i) * 1800 * 1000).toISOString(),
      location: String(o.location || '').slice(0, 60), likes: likes, comments: comments.slice(0, 8),
      maskId: cfg.user.id
    });
  });
  return out;
}
function pushText(v, fallback) {
  let s = '';
  if (v && typeof v === 'object') s = v.body || v.text || v.message || v.content || v.title || '';
  else s = (v == null ? '' : v);
  // 外语气泡是「原文||中文翻译」：推送里两段都保留，别把翻译直接丢掉。
  s = String(s || '').replace(/\s*\|\|\s*/g, ' / ').trim();
  return s || String(fallback || '');
}
async function sendBarkKey(env, key, payload) {
  key = String(key || '').trim();
  if (!key) return false;
  // 允许直接粘贴完整 Bark 地址（可能自带 ?group=...）。先把路径截出来，
  // 否则会在查询串后面继续拼 /标题/正文，Bark 只当成了未知参数，最终显示默认文案。
  let base = '';
  if (key.indexOf('http') === 0) {
    try {
      const u = new URL(key);
      base = u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) {
      base = key.replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
  } else {
    base = 'https://api.day.app/' + encodeURIComponent(key);
  }
  // 标题优先用角色昵称，正文用真实气泡内容；避免只推 "Nano / 你有一条新消息"。
  const title = pushText(payload.name || payload.title, 'Nano');
  let body = '';
  if (Array.isArray(payload.bubbles) && payload.bubbles.length) {
    body = payload.bubbles.map(function (b) { return pushText(b, ''); }).filter(Boolean).join('\n');
  }
  body = pushText(body || payload.body || payload.text || payload.preview, '').slice(0, 300);
  // 没有真实内容就不发：宁可交给 Web Push，也不要用通用占位文案刷屏。
  if (!body) return false;
  let url = base + '/' + encodeURIComponent(title) + '/' + encodeURIComponent(body);
  // active 才会在锁屏/后台弹横幅；sound=none 关掉提示音（避免保活时又响又震）
  const q = [
    'group=' + encodeURIComponent(payload.name || payload.title || payload.channel || 'Nano'),
    'level=active',
    'sound=none'
  ];
  if (payload.target) {
    const app = String(env.APP_URL || 'https://xiaoyu0108.github.io/nano-mobile-chat/').replace(/\/+$/, '');
    q.push('url=' + encodeURIComponent(app + '/index.html?open=' + encodeURIComponent(payload.target)));
  }
  url += '?' + q.join('&');
  try {
    const resp = await fetch(url);
    if (!resp || !resp.ok) return false;
    // Bark 正常返回 { code: 200 }；非 200 视为失败，交给 Web Push 兜底。
    try {
      const data = await resp.json();
      if (data && data.code != null && Number(data.code) !== 200) return false;
    } catch (e) {}
    return true;
  } catch (e) { return false; }
}

// 后台推送：用户填了 Bark 就优先走 Bark（iPhone 上不依赖 Web Push / GMS，也更省电），
// Bark 明确失败时再用 Web Push 兜底；没填 Bark 则只走 Web Push。
// 之前是 Web Push 优先：只要有一个「能返回 200 但实际不显示」的旧订阅，Bark 就永远不会发。
async function autoNotify(env, cfg, subs, payload) {
  const key = String((cfg && cfg.barkKey) || '').trim();
  if (key) {
    const ok = await sendBarkKey(env, key, payload);
    if (ok) return 1;
  }
  if (subs && subs.length) {
    try { return await pushAll(subs, payload, env); } catch (e) { return 0; }
  }
  return 0;
}

async function runAutoPush(env, appId, deviceId, userId) {
  appId = cleanAppId(appId);
  deviceId = cleanDeviceId(deviceId);
  userId = cleanUserId(userId);
  const raw = await kv(env).get(autoKey('config', appId, deviceId, userId));
  if (!raw) return;
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { return; }
  if (!cfg || !cfg.enabled) return;
  let state = {};
  try { const s = await kv(env).get(autoKey('state', appId, deviceId, userId)); state = s ? JSON.parse(s) : {}; } catch (e) { state = {}; }
  const now = Date.now();
  const msgDue = !!(cfg.msgEnabled && now >= (Number(state.nextMsgAt) || 0));
  const momentDue = !!(cfg.momentEnabled && now >= (Number(state.nextMomentAt) || 0));
  // 没到点就只花「配置+state」两次读，不再读 active / call / 订阅。
  if (!msgDue && !momentDue) return;
  // 同一台设备可能切换了面具：只跑当前活跃用户，避免 A 的推送弹到 B 当前页面。
  try {
    const activeRaw = await kv(env).get(autoActiveKey(appId, deviceId));
    if (activeRaw) {
      let active = '';
      try { active = String((JSON.parse(activeRaw) || {}).userId || ''); } catch (e) { active = ''; }
      if (active && active !== userId) return;
    }
  } catch (e) {}
  // 订阅只在真的要发消息/朋友圈时才查：cron 每 5 分钟跑一次，
  // 如果每轮都 list 一次订阅，用户一多就会把 KV 的「list 次数」额度打满。
  let subsCache = null;
  async function subsOnce() {
    if (subsCache) return subsCache;
    subsCache = await getSubs(env, userId, deviceId, appId);
    return subsCache;
  }
  let busyChatId = '';
  try { busyChatId = String(await kv(env).get('auto2:call:' + cleanAppId(appId) + ':' + userId) || ''); } catch (e) {}
  let dirty = false;
  let usedChars = 0;
  if (msgDue) {
    // 先把下一次时间推进：即使模型超时/失败，也不会每 5 分钟重试一次造成刷屏
    state.nextMsgAt = now + cfg.intervalMinutes * 60 * 1000;
    state.msgMins = cfg.intervalMinutes;
    dirty = true;
    let msgs = [];
    try { msgs = await generateAutoMessages(env, cfg, busyChatId, state.lastMsgChar); } catch (e) { msgs = []; }
    if (msgs.length) {
      state.lastMsgChar = String(msgs[0].chatId || '');
      const key = autoKey('msg', appId, deviceId, userId);
      let list = [];
      try { const old = await kv(env).get(key); list = old ? JSON.parse(old) : []; } catch (e) { list = []; }
      list = list.concat(msgs).slice(-20);
      await kv(env).put(key, JSON.stringify(list));
      usedChars += msgs.length;
      const subs = await subsOnce();
      for (const m of msgs) {
        const icon = /^https?:\/\//i.test(String(m.avatar || '')) ? String(m.avatar) : '';
        await autoNotify(env, cfg, subs, {
          title: pushText(m.name, 'TA'),
          body: pushText(m.bubbles && m.bubbles[0] || m.text, '你有一条新消息'),
          bubbles: Array.isArray(m.bubbles) ? m.bubbles : null,
          target: 'chat:' + m.chatId,
          tag: 'auto-' + m.chatId,
          renotify: false,
          icon: icon,
          name: m.name,
          channel: 'chat',
          appId: appId
        });
      }
    }
  }
  if (momentDue) {
    state.nextMomentAt = now + cfg.momentIntervalHours * 3600 * 1000;
    state.momentHours = cfg.momentIntervalHours;
    dirty = true;
    // 主动消息 + 朋友圈合计最多 3 个角色
    const remain = Math.max(0, 3 - usedChars);
    if (remain > 0) {
      let posts = [];
      try { posts = await generateAutoMoments(env, cfg, busyChatId, remain); } catch (e) { posts = []; }
      if (posts.length) {
        const key = autoKey('moments', appId, deviceId, userId);
        let list = [];
        try { const old = await kv(env).get(key); list = old ? JSON.parse(old) : []; } catch (e) { list = []; }
        list = list.concat(posts).slice(-30);
        await kv(env).put(key, JSON.stringify(list));
        const subs = await subsOnce();
        await autoNotify(env, cfg, subs, {
          title: '朋友圈',
          body: pushText(posts[0] && (posts[0].author + ' 发了新动态'), '朋友圈有新动态'),
          target: 'moments',
          tag: 'auto-moments',
          renotify: false,
          channel: 'moment',
          appId: appId
        });
      }
    }
  }
  if (dirty) await kv(env).put(autoKey('state', appId, deviceId, userId), JSON.stringify(state));
}

// 用服务端保存的 key 调主模型（Key 不出服务器），支持纯文本与「截图 + 文本」。
// 优先用 PEEK_* 专用配置；没有时复用 App 同步上来的主 API（cfg.api），
// 这样用户不用再额外配一套 PEEK_API_URL / PEEK_API_KEY / PEEK_MODEL。
async function peekModel(env, system, text, image, history, apiCfg, context) {
  const url = modelEndpoint(env.PEEK_API_URL || (apiCfg && apiCfg.url) || '');
  const key = env.PEEK_API_KEY || (apiCfg && apiCfg.key) || '';
  const model = env.PEEK_MODEL || (apiCfg && apiCfg.model) || '';
  if (!url || !key || !model) return null;
  let content;
  if (image) {
    content = [
      { type: 'text', text: text || '看看我现在屏幕上是什么，用你的人设随口说一句。' },
      { type: 'image_url', image_url: { url: image } }
    ];
  } else {
    content = text || '用你的人设随口说一句。';
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  // App 同步过来的最近聊天上下文：让 TA 接得上你们刚聊过的话题，而不是像陌生人。
  (context || []).forEach(function (m) {
    if (!m || !m.content) return;
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1200) });
  });
  (history || []).forEach(function (t) {
    if (t.user) messages.push({ role: 'user', content: String(t.user) });
    if (t.char) messages.push({ role: 'assistant', content: String(t.char) });
  });
  messages.push({ role: 'user', content });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model, messages, max_tokens: 900, temperature: 0.9 })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return c ? String(c).trim() : null;
}

// ===== 分享链接解析（服务端抓取，绕开浏览器 CORS；只允许常见分享站点，避免变成开放代理） =====
const LINK_HOST_RE = /(^|\.)(xiaohongshu\.com|xhslink\.[a-z.]+|xhs\.cn|douyin\.com|iesdouyin\.com|taobao\.com|tmall\.com|tb\.cn|jd\.com|3\.cn|bilibili\.com|b23\.tv|weibo\.com|weibo\.cn)$/i;
function linkHostAllowed(host) {
  return LINK_HOST_RE.test(String(host || '').toLowerCase());
}
function linkDecodeHtml(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\\u([\dA-Fa-f]{4})/g, function (_, h) { try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return ''; } })
    .replace(/\s+/g, ' ').trim();
}
function linkAbsImg(u) {
  u = linkDecodeHtml(String(u || '')).replace(/\\\//g, '/').replace(/&amp;/g, '&');
  if (!u) return '';
  if (u.indexOf('//') === 0) u = 'https:' + u;
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}
function linkCleanText(s) {
  return String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
function parseLinkPage(html) {
  html = String(html || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  function pick(re) { const m = html.match(re); return m ? m[1] : ''; }
  function jsonField(name) {
    const m = html.match(new RegExp('"' + name + '"\\s*:\\s*"([^"]{2,})"', 'i'));
    return m ? linkDecodeHtml(String(m[1]).replace(/\\n/g, ' ')) : '';
  }
  const docTitle = pick(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*content=["']([\s\S]*?)["']/i)
    || pick(/<meta[^>]+content=["']([\s\S]*?)["'][^>]*(?:property|name)=["'](?:og:title|twitter:title)["']/i)
    || pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const jsonTitle = jsonField('title') || jsonField('noteTitle') || jsonField('displayTitle');
  // 小红书/抖音的 <title> 往往只是站点名（如「小红书」），真正标题在页面 JSON 的 title 里。
  let title = docTitle;
  if (!title || /^(小红书|抖音|快手|微博|哔哩哔哩|B站)/i.test(linkDecodeHtml(title))) {
    title = jsonTitle || title;
  }
  let desc = pick(/<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*content=["']([\s\S]*?)["']/i)
    || pick(/<meta[^>]+content=["']([\s\S]*?)["'][^>]*(?:property|name)=["'](?:og:description|description|twitter:description)["']/i)
    || jsonField('desc')
    || jsonField('description');
  const imgs = [];
  const seen = {};
  function addImg(u) {
    u = linkAbsImg(u);
    if (!u || seen[u]) return;
    // 卡片封面不要用网站 logo / favicon / 分享图标，否则抖音淘宝卡片只剩软件图标。
    if (/logo|favicon|sprite|qrcode|qr_|share[_-]?icon|app[_-]?icon|\/icon\//i.test(u)) return;
    seen[u] = 1;
    if (imgs.length < 6) imgs.push(u);
  }
  let re = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/gi, m;
  while ((m = re.exec(html))) addImg(m[1]);
  re = /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/gi;
  while ((m = re.exec(html))) addImg(m[1]);
  // 小红书笔记图：imageList 里 H5_DTL 的 url（比作者头像更适合做卡片缩略图）
  re = /"imageScene"\s*:\s*"H5_DTL"[\s\S]{0,240}?"url"\s*:\s*"([^"]+)"/gi;
  while ((m = re.exec(html))) addImg(m[1]);
  re = /"(?:picUrl|imageUrl|image|img|pic|pics|images)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((m = re.exec(html))) addImg(m[1]);
  // 抖音：封面/首帧在 cover / origin_cover / dynamic_cover 的 url_list 里，og:image 经常为空。
  re = /"(?:cover|origin_cover|dynamic_cover|cover_url|video_cover)"\s*:\s*\{[\s\S]{0,300}?"url_list"\s*:\s*\[\s*"([^"]+)"/gi;
  while ((m = re.exec(html))) addImg(m[1]);
  // 小红书当前页面结构：imageList → urlDefault / urlPre；CDN 域名通常是 sns-webpic。
  re = /"(?:urlDefault|urlPre|url)"\s*:\s*"((?:https?:)?\/\/[^"]*(?:sns-webpic|xhscdn|xiaohongshu)[^"]*)"/gi;
  while ((m = re.exec(html))) addImg(m[1]);
  // 淘宝/天猫：商品主图常见字段。
  re = /"(?:picUrl|pic_url|mainPic|main_pic|imageUrl|images|imageList)"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/gi;
  while ((m = re.exec(html))) addImg(m[1] || m[2]);
  // 兜底：从 CDN 图片 URL 里捞（阿里/抖音/小红书）。
  re = /(https?:)?\/\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s]*)?/gi;
  while ((m = re.exec(html))) {
    const u8 = m[0];
    if (/(alicdn|taobao|tmall|douyin|byteimg|xiaohongshu|xhscdn)/i.test(u8)) addImg(u8);
  }
  const visible = linkCleanText(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  let price = '';
  const pm = html.match(/"(?:price|priceText|priceShow|salePrice|promotionPrice)"\s*:\s*"?\s*[¥￥]?\s*([\d.]+)/i)
    || html.match(/[¥￥]\s*([\d.]+)/);
  if (pm && pm[1]) price = pm[1];
  title = linkDecodeHtml(title).slice(0, 120);
  desc = linkDecodeHtml(desc).replace(/\s+/g, ' ').slice(0, 180);
  const body = [jsonTitle, jsonField('desc'), jsonField('share_title'), jsonField('description'), desc, visible].filter(Boolean).join('\n').slice(0, 7000);
  return { title: title, desc: desc, content: body, images: imgs, price: price };
}
function linkLooksBlocked(finalUrl, data) {
  if (/website-login|captcha|verify|\/login|signin/i.test(String(finalUrl || ''))) return true;
  const title = String((data && data.title) || '');
  const content = String((data && data.content) || '');
  if (/^(小红书|抖音|快手|微博|哔哩哔哩|B站|淘宝|天猫|京东)\s*$/i.test(title) && content.replace(/\s+/g, '').length < 50 && !(data && data.images && data.images.length)) return true;
  if (/滑动验证|请登录|安全验证|访问异常|captcha|想了解些什么|登录后|扫码登录|登录小红书|亲，请登录|扫码查看|商品不存在|商品已下架|您查看的宝贝不存在|页面不存在/i.test(content)) return true;
  return false;
}
// 小红书短链被跳到登录/滑块页时，redirectPath 里仍然带着笔记 id 和 xsec_token。
// 用 /explore/<id> 再试一次，部分机房 IP 能直接拿到公开笔记页。
function xhsDirectUrls(finalUrl) {
  const out = [];
  try {
    const fu = new URL(String(finalUrl || ''));
    const rp = fu.searchParams.get('redirectPath') || '';
    if (!rp) return out;
    const direct = new URL(rp.replace(/^http:/i, 'https:'));
    const m = direct.pathname.match(/\/(?:item|explore)\/([0-9a-f]+)/i);
    if (!m) return out;
    const id = m[1];
    const token = direct.searchParams.get('xsec_token') || fu.searchParams.get('xsec_token') || '';
    const q = token ? ('?xsec_token=' + encodeURIComponent(token) + '&xsec_source=app_share') : '';
    out.push('https://www.xiaohongshu.com/explore/' + id + q);
    out.push('https://www.xiaohongshu.com/discovery/item/' + id + q);
  } catch (e) {}
  return out;
}
function parseJinaText(raw) {
  raw = String(raw || '');
  const tm = raw.match(/^\s*Title\s*:\s*(.+)$/im);
  const dm = raw.match(/^\s*(?:Description|Summary)\s*:\s*([\s\S]*?)(?=^\s*(?:URL Source|Published Time|Markdown Content|Content)\s*:|$)/im);
  let body = raw.replace(/^(?:Title|URL Source|Published Time|Description|Summary|Markdown Content|Content):.*$/gim, '').trim();
  const imgs = [], seen = {};
  const ire = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
  let m;
  while ((m = ire.exec(raw))) {
    const u = linkAbsImg(m[1]);
    if (u && !seen[u]) { seen[u] = 1; imgs.push(u); if (imgs.length >= 6) break; }
  }
  return {
    title: linkDecodeHtml((tm && tm[1]) || '').slice(0, 120),
    desc: linkDecodeHtml((dm && dm[1]) || '').replace(/\s+/g, ' ').slice(0, 180),
    content: body.slice(0, 7000),
    images: imgs,
    price: ''
  };
}
async function fetchTextWithTimeout(target, headers, ms) {
  const controller = new AbortController();
  const timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, ms);
  try {
    const resp = await fetch(target, { redirect: 'follow', signal: controller.signal, headers: headers });
    if (!resp || !resp.ok) return null;
    return { resp: resp, text: await resp.text() };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchLinkPreview(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return null; }
  // 分享链接经常是 http://（尤其抖音/淘宝的复制口令），Worker 里先自动升级成 https，
  // 否则会被下面的 https 检查直接拒绝，表现为「小红书能解析，抖音/淘宝只有卡片」。
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:' || !linkHostAllowed(u.hostname)) return null;
  const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const refHost = /douyin|iesdouyin/i.test(u.hostname) ? 'https://www.douyin.com/' :
    (/taobao|tb\.cn|tmall/i.test(u.hostname) ? 'https://m.tb.cn/' : '');
  const first = await fetchTextWithTimeout(u.href, {
    'User-Agent': mobileUA,
    'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(refHost ? { 'Referer': refHost } : {})
  }, 10000);
  let firstOk = false;
  if (first && first.text) {
    const data = parseLinkPage(first.text);
    const ok = (data.title || data.content) && !linkLooksBlocked(first.resp.url || u.href, data);
    if (ok) {
      return Object.assign({ url: first.resp.url || u.href }, data);
    }
    firstOk = false;
  }
  // 抖音/淘宝移动页经常只给登录弹窗；再用桌面 UA 抓一次，很多商品/视频详情
  // 在桌面页的 JSON 里仍然带封面和标题。
  if (!firstOk && /douyin|iesdouyin|taobao|tb\.cn|tmall/i.test(u.hostname)) {
    const desk = await fetchTextWithTimeout(u.href, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': /taobao|tb\.cn|tmall/i.test(u.hostname) ? 'https://www.taobao.com/' : 'https://www.douyin.com/'
    }, 10000);
    if (desk && desk.text) {
      const d2 = parseLinkPage(desk.text);
      if ((d2.title || d2.content || (d2.images && d2.images.length)) && !linkLooksBlocked(desk.resp.url || u.href, d2)) {
        return Object.assign({ url: desk.resp.url || u.href, via: 'desktop' }, d2);
      }
    }
  }
  // 小红书被跳到登录/滑块页：用 redirectPath 里的笔记 id + xsec_token 换 /explore 地址再试。
  const directUrls = xhsDirectUrls(first && first.resp ? first.resp.url : u.href);
  for (const direct of directUrls) {
    const r = await fetchTextWithTimeout(direct, {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://www.xiaohongshu.com/'
    }, 10000);
    if (r && r.text) {
      const data = parseLinkPage(r.text);
      if ((data.title || data.content) && !linkLooksBlocked(r.resp.url || direct, data)) {
        return Object.assign({ url: r.resp.url || direct, via: 'xhs-direct' }, data);
      }
    }
  }
  // 抖音：短链跳转后的页面经常被跳登录页。用视频 id 走公开的 iteminfo 接口，
  // 通常能拿到文案、作者和封面；失败再继续走 Jina。
  if (/douyin|iesdouyin/i.test(u.hostname)) {
    const finalUrl = String((first && first.resp && first.resp.url) || u.href);
    const vm = finalUrl.match(/\/(?:video|note|slides)\/(\d{8,})/) ||
      (first && first.text ? first.text.match(/"aweme_id"\s*:\s*"(\d{8,})"/) : null);
    if (vm && vm[1]) {
      const a = await fetchTextWithTimeout('https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=' + vm[1], {
        'User-Agent': mobileUA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.iesdouyin.com/'
      }, 10000);
      if (a && a.text) {
        try {
          const aj = JSON.parse(a.text);
          const item = aj && aj.item_list && aj.item_list[0];
          if (item) {
            const desc = String(item.desc || '').replace(/\s+/g, ' ').trim();
            const cover = item.video && item.video.cover && item.video.cover.url_list && item.video.cover.url_list[0] ||
              (item.video && item.video.dynamic_cover && item.video.dynamic_cover.url_list && item.video.dynamic_cover.url_list[0]) || '';
            if (desc || cover) {
              return {
                url: finalUrl,
                via: 'douyin-api',
                title: (desc || '抖音视频').slice(0, 120),
                desc: desc.slice(0, 180),
                content: [desc, item.author && item.author.nickname ? ('作者：' + item.author.nickname) : ''].filter(Boolean).join('\n').slice(0, 7000),
                images: cover ? [linkAbsImg(cover)] : [],
                price: ''
              };
            }
          }
        } catch (e) {}
      }
    }
  }

  // 淘宝/天猫：用商品 id 换 H5 详情页，桌面页被登录弹窗挡住时 H5 有时仍带标题和主图。
  if (/taobao|tmall/i.test(u.hostname)) {
    const taobaoSource = String((first && first.resp && first.resp.url) || u.href);
    const tm = taobaoSource.match(/[?&](?:id|itemId)=(\d{6,})/) || u.href.match(/[?&](?:id|itemId)=(\d{6,})/);
    if (tm && tm[1]) {
      const tb = await fetchTextWithTimeout('https://h5.m.taobao.com/awp/core/detail.htm?id=' + tm[1], {
        'User-Agent': mobileUA,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://m.tb.cn/'
      }, 10000);
      if (tb && tb.text) {
        const td = parseLinkPage(tb.text);
        if ((td.title || td.content || (td.images && td.images.length)) && !linkLooksBlocked(tb.resp.url || taobaoSource, td)) {
          return Object.assign({ url: tb.resp.url || taobaoSource, via: 'taobao-h5' }, td);
        }
      }
    }
  }

  // Cloudflare 的数据中心 IP 经常被小红书跳到登录/滑块验证页；此时换 r.jina.ai 服务端读取。
  const j = await fetchTextWithTimeout('https://r.jina.ai/' + u.href, {
    'User-Agent': mobileUA,
    'Accept': 'text/plain, text/markdown;q=0.9, */*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  }, 15000);
  if (j && j.text) {
    const data = parseJinaText(j.text);
    if ((data.title || data.content) && !linkLooksBlocked('', data)) {
      return Object.assign({ url: u.href, via: 'jina' }, data);
    }
  }
  return null;
}

// ===== 实时热点（公开数据，不写 KV；给 MCP 的 get_hot_topics 用） =====
const HOT_LABEL = { weibo: '微博', douyin: '抖音', baidu: '百度', toutiao: '今日头条', bilibili: 'B站' };
const HOT_DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOT_MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
function hotItem(title, hot, url) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return { title: title.slice(0, 160), hot: Number(hot) || 0, url: String(url || '') };
}
async function hotWeibo() {
  const r = await fetchTextWithTimeout('https://weibo.com/ajax/statuses/hot_band', {
    'User-Agent': HOT_DESKTOP_UA, 'Referer': 'https://weibo.com/', 'Accept': 'application/json, text/plain, */*'
  }, 7000);
  if (!r) return [];
  const j = JSON.parse(r.text);
  const list = (j.data && j.data.band_list) || [];
  return list.map(function (x) {
    return hotItem(x.word || x.note, x.num, 'https://s.weibo.com/weibo?q=' + encodeURIComponent(x.word_scheme || x.word || ''));
  }).filter(Boolean).slice(0, 20);
}
async function hotDouyin() {
  const r = await fetchTextWithTimeout('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', {
    'User-Agent': HOT_MOBILE_UA, 'Referer': 'https://www.douyin.com/', 'Accept': 'application/json, text/plain, */*'
  }, 7000);
  if (!r) return [];
  const j = JSON.parse(r.text);
  return ((j.word_list) || []).map(function (x) {
    return hotItem(x.word, x.hot_value, 'https://www.douyin.com/search/' + encodeURIComponent(x.word || ''));
  }).filter(Boolean).slice(0, 20);
}
async function hotBaidu() {
  const r = await fetchTextWithTimeout('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
    'User-Agent': HOT_MOBILE_UA, 'Referer': 'https://top.baidu.com/', 'Accept': 'application/json, text/plain, */*'
  }, 7000);
  if (!r) return [];
  const j = JSON.parse(r.text);
  const out = [], seen = {};
  (function walk(o) {
    if (!o || out.length >= 20) return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o !== 'object') return;
    if (typeof o.word === 'string' && o.word.trim() && !seen[o.word]) {
      seen[o.word] = 1;
      out.push(hotItem(o.word, o.hotScore || o.hot || 0, o.url || ('https://www.baidu.com/s?wd=' + encodeURIComponent(o.word))));
    }
    Object.keys(o).forEach(function (k) { walk(o[k]); });
  })(j);
  return out.filter(Boolean).slice(0, 20);
}
async function hotToutiao() {
  const r = await fetchTextWithTimeout('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
    'User-Agent': HOT_DESKTOP_UA, 'Referer': 'https://www.toutiao.com/', 'Accept': 'application/json, text/plain, */*'
  }, 7000);
  if (!r) return [];
  const j = JSON.parse(r.text);
  return ((j.data) || []).map(function (x) {
    return hotItem(x.Title, x.HotValue, x.Url);
  }).filter(Boolean).slice(0, 20);
}
async function hotBilibili() {
  const r = await fetchTextWithTimeout('https://s.search.bilibili.com/main/hotword', {
    'User-Agent': HOT_DESKTOP_UA, 'Referer': 'https://www.bilibili.com/', 'Accept': 'application/json, text/plain, */*'
  }, 7000);
  if (!r) return [];
  const j = JSON.parse(r.text);
  return ((j.list) || []).map(function (x) {
    const word = x.show_name || x.keyword || '';
    return hotItem(word, x.heat_score, 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(word));
  }).filter(Boolean).slice(0, 20);
}
const HOT_SOURCES = { weibo: hotWeibo, douyin: hotDouyin, baidu: hotBaidu, toutiao: hotToutiao, bilibili: hotBilibili };
async function getHotTopics(source) {
  source = String(source || '').trim().toLowerCase();
  const keys = (source && HOT_SOURCES[source]) ? [source] : Object.keys(HOT_SOURCES);
  return await Promise.all(keys.map(async function (key) {
    try {
      const items = await HOT_SOURCES[key]();
      return { source: key, label: HOT_LABEL[key] || key, items: items || [] };
    } catch (e) {
      return { source: key, label: HOT_LABEL[key] || key, items: [], error: true };
    }
  }));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ===== 反向代理：把国内可访问的自定义域名转到你的 Vercel 服务（如网易云音乐）=====
    // 需在 Worker 里设置 MUSIC_ORIGIN（例如 https://your-app.vercel.app）
    const __reqUrl = new URL(request.url);
    if (__reqUrl.hostname === 'music.nano315.online') {
      const origin = String(env.MUSIC_ORIGIN || '').replace(/\/+$/, '');
      if (!origin) return new Response('MUSIC_ORIGIN 未设置', { status: 500, headers: CORS });
      const target = origin + __reqUrl.pathname + __reqUrl.search;
      const fwd = new Headers(request.headers);
      fwd.delete('host'); fwd.delete('content-length');
      try {
        const resp = await fetch(target, {
          method: request.method,
          headers: fwd,
          body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
          redirect: 'manual'
        });
        const out = new Headers(resp.headers);
        out.set('Access-Control-Allow-Origin', '*');
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return new Response('proxy error: ' + (e && e.message ? e.message : e), { status: 502, headers: CORS });
      }
    }

    // ===== 字体代理：/font?url=https://files.catbox.moe/xxx.woff2 =====
    // 只代理字体文件（woff/woff2/ttf/otf），限制大小，避免变成通用开放代理。
    if (__reqUrl.pathname === '/font') {
      const target = __reqUrl.searchParams.get('url') || '';
      let tu;
      try { tu = new URL(target); } catch (e) { return new Response('bad font url', { status: 400, headers: CORS }); }
      if (!/^https?:$/.test(tu.protocol)) return new Response('bad protocol', { status: 400, headers: CORS });
      if (!/\.(woff2?|ttf|otf)$/i.test(tu.pathname)) return new Response('only font files', { status: 400, headers: CORS });
      const host = tu.hostname.toLowerCase();
      if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]' ||
          /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        return new Response('bad host', { status: 400, headers: CORS });
      }
      const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
      const cacheKey = new Request(__reqUrl.origin + '/font?url=' + encodeURIComponent(tu.href), { method: 'GET' });
      if (cache) {
        try { const hit = await cache.match(cacheKey); if (hit) return hit; } catch (e) {}
      }
      try {
        const resp = await fetch(tu.href, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NanoFontProxy/1.0)' },
          cf: { cacheEverything: true, cacheTtl: 31536000 }
        });
        if (!resp.ok) return new Response('font fetch failed: ' + resp.status, { status: 502, headers: CORS });
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        const isFont = /font/.test(ct) || /octet-stream/.test(ct) || /\.(woff2?|ttf|otf)$/i.test(tu.pathname);
        if (!isFont) return new Response('not a font', { status: 415, headers: CORS });
        const buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength > 8 * 1024 * 1024) {
          return new Response('font too large', { status: 413, headers: CORS });
        }
        const out = new Headers(CORS);
        out.set('Content-Type', ct && /font|octet-stream/.test(ct) ? ct : 'application/octet-stream');
        out.set('Cache-Control', 'public, max-age=31536000, immutable');
        out.set('X-Content-Type-Options', 'nosniff');
        const res = new Response(buf, { status: 200, headers: out });
        if (cache) { try { await cache.put(cacheKey, res.clone()); } catch (e) {} }
        return res;
      } catch (e) {
        return new Response('font proxy error: ' + (e && e.message ? e.message : e), { status: 502, headers: CORS });
      }
    }

    // ===== Fish Audio TTS 反向代理 =====
    // 浏览器的 CORS 预检有时会在到达 Fish 之前就被网络/代理拦掉（HTTP 0 / Load failed）。
    // 前端在直连失败时会自动改走这里：POST /fish-tts，body 与 /v1/tts 完全一致。
    if (/\/fish-tts$/.test(__reqUrl.pathname) && request.method === 'POST') {
      const fishOrigin = String(env.FISH_API_ORIGIN || 'https://api.fish.audio').replace(/\/+$/, '');
      const fwd = new Headers(request.headers);
      fwd.delete('host');
      fwd.delete('content-length');
      fwd.delete('origin');
      fwd.delete('referer');
      try {
        const resp = await fetch(fishOrigin + '/v1/tts', {
          method: 'POST',
          headers: fwd,
          body: request.body
        });
        const out = new Headers(resp.headers);
        out.set('Access-Control-Allow-Origin', '*');
        out.set('Access-Control-Allow-Headers', '*');
        out.set('Cache-Control', 'no-store');
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return new Response(JSON.stringify({ message: 'fish proxy error: ' + (e && e.message ? e.message : e) }), {
          status: 502,
          headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
        });
      }
    }

    // Fish Audio 音色 / 模型列表代理：api.fish.audio/model 在国内经常直连超时，
    // 和 TTS 一样由 Cloudflare 去拉，前端只走 Worker。
    if ((/\/fish-models$/.test(__reqUrl.pathname) || /\/fish-model$/.test(__reqUrl.pathname) || /\/fish-model\//.test(__reqUrl.pathname)) && request.method === 'GET') {
      const fishOrigin = String(env.FISH_API_ORIGIN || 'https://api.fish.audio').replace(/\/+$/, '');
      const isList = /\/fish-models$/.test(__reqUrl.pathname);
      let fishPath = '/model?page_size=100';
      if (!isList) {
        const id = __reqUrl.searchParams.get('id') || (__reqUrl.pathname.split('/fish-model/')[1] || '');
        if (!id) return json({ ok: false, error: 'no id' }, 400);
        fishPath = '/model/' + encodeURIComponent(id);
      }
      try {
        const resp = await fetch(fishOrigin + fishPath, {
          headers: {
            'Authorization': request.headers.get('Authorization') || '',
            'Accept': 'application/json'
          }
        });
        const text = await resp.text();
        return new Response(text, {
          status: resp.status,
          headers: Object.assign({}, CORS, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        });
      } catch (e) {
        return json({ ok: false, error: 'fish proxy error: ' + (e && e.message ? e.message : e) }, 502);
      }
    }

    // ===== 通用外部 API 反向代理（ElevenLabs / MiniMax 海外版 / NovelAI）=====
    // 只允许固定白名单域名，避免变成公开 SSRF 代理。
    if (/\/ext-proxy$/.test(__reqUrl.pathname)) {
      const raw = __reqUrl.searchParams.get('url') || '';
      let target = null;
      try { target = new URL(raw); } catch (e) {}
      const allowed = ['api.elevenlabs.io', 'api.minimax.io', 'api.minimaxi.com', 'api.minimax.chat', 'api.novelai.net', 'image.novelai.net'];
      if (!target || allowed.indexOf(target.hostname) === -1) return json({ ok: false, error: 'host not allowed' }, 403);
      const fwd = new Headers();
      ['authorization', 'xi-api-key', 'content-type', 'accept'].forEach(function (h) {
        const v = request.headers.get(h);
        if (v) fwd.set(h, v);
      });
      try {
        const resp = await fetch(target.href, {
          method: request.method,
          headers: fwd,
          body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
        });
        const out = new Headers();
        out.set('Access-Control-Allow-Origin', '*');
        out.set('Access-Control-Allow-Headers', '*');
        out.set('Cache-Control', 'no-store');
        const ct = resp.headers.get('content-type');
        if (ct) out.set('Content-Type', ct);
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return json({ ok: false, error: 'ext proxy error: ' + (e && e.message ? e.message : e) }, 502);
      }
    }


    let pathname = __reqUrl.pathname;
    if (pathname.indexOf('/nanoapi') === 0) pathname = pathname.slice('/nanoapi'.length) || '/';

    // 分享链接解析：GET /link/preview?url=https://xhslink.cn/...
    // 只抓白名单站点，结果不写 KV，避免占用 KV 写入额度。
    if (pathname === '/link/preview' && request.method === 'GET') {
      if (!autoOk(request, env, null)) return json({ ok: false, error: 'unauthorized' }, 401);
      const target = new URL(request.url).searchParams.get('url') || '';
      const data = await fetchLinkPreview(target);
      // 反爬/登录页属于预期情况，用 200 + ok:false 返回，避免前端控制台出现一堆 502。
      if (!data) return json({ ok: false, error: 'blocked' }, 200);
      return json(Object.assign({ ok: true }, data));
    }

    // 实时热点：GET /hot?source=weibo|douyin|baidu|toutiao|bilibili
    // 不写 KV，给 MCP 的 get_hot_topics 工具用。
    if (pathname === '/hot' && request.method === 'GET') {
      const source = new URL(request.url).searchParams.get('source') || '';
      const sources = await getHotTopics(source);
      return json({ ok: true, updatedAt: Date.now(), sources: sources });
    }

    // 公开的 VAPID 公钥：App 里一键开启 Web Push 时读取（私钥永远不返回）
    // 没配置 VAPID_* secrets 时自动生成并存入 KV，用户不需要手动生成。
    if (pathname === '/vapid' && request.method === 'GET') {
      const v = await ensureVapid(env);
      return json({ ok: !!v, key: v ? v.publicKey : '' });
    }

    // 1) 客户端订阅上报
    if (pathname === '/subscribe' && request.method === 'POST') {
      const body = await request.json().catch(function () { return {}; });
      const subscription = body.subscription;
      if (!subscription || !subscription.endpoint) return json({ ok: false, error: 'no subscription' }, 400);
      // 记下这个订阅属于哪个用户/面具，避免 A 的推送弹到 B 的设备上
      subscription.userId = cleanUserId(body.userId);
      subscription.deviceId = cleanDeviceId(body.deviceId);
      // 旧客户端没有 appId：标记为 legacy，新站点不会再把推送发给它
      subscription.appId = cleanAppId(body.appId);
      subscription.ua = String(body.ua || '');
      subscription.platform = String(body.platform || '');
      await kv(env).put(subKey(subscription.endpoint, subscription.appId, subscription.deviceId, subscription.userId), JSON.stringify(subscription));
      // 删除旧的全局订阅 key，避免升级后同一设备收到两遍推送。
      try { await kv(env).delete(subId(subscription.endpoint)); } catch (e) {}
      return json({ ok: true });
    }

    // 2) 客户端预约提醒（到点后由 cron 推送）
    if (pathname === '/schedule' && request.method === 'POST') {
      if (!tokenOk(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      const body = await request.json();
      const items = Array.isArray(body.items) ? body.items : [];
      const appId = cleanAppId(body.appId);
      const deviceId = cleanDeviceId(body.deviceId);
      const userId = cleanUserId(body.userId);
      let count = 0;
      for (const it of items) {
        if (!it || !it.at) continue;
        const job = Object.assign({}, it, {
          appId: cleanAppId(it.appId || appId),
          deviceId: cleanDeviceId(it.deviceId || deviceId),
          userId: cleanUserId(it.userId || userId)
        });
        const id = 'job:' + Number(job.at) + ':' + Math.random().toString(36).slice(2, 8);
        await kv(env).put(id, JSON.stringify(job));
        try { await addJobId(env, id); } catch (e) {}
        count++;
      }
      return json({ ok: true, count: count });
    }

    // 3) 取消订阅
    if (pathname === '/unsubscribe' && request.method === 'POST') {
      const { endpoint } = await request.json();
      if (endpoint) await kv(env).delete(subId(endpoint));
      return json({ ok: true });
    }

    // 4) 手动测试：给所有订阅者发一条
    if (pathname === '/send' && request.method === 'POST') {
      if (!tokenOk(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      const count = await sendAll(env, { title: 'Nano', body: '测试推送：收到就成功了', target: '' });
      return json({ ok: true, count });
    }

    // 5) 屏幕速聊（iOS 快捷指令）：截图/文本 → 服务端用保存的 key 调模型 → 返回角色回复，并暂存轮次供 App 合并
    if (pathname === '/peek' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) {
        return json({ ok: false, error: 'unauthorized', reply: '令牌不一致：请把 Worker 的 PEEK_TOKEN 和窥屏页里生成的令牌改成同一个。' }, 401);
      }
      const chatId = String(body.chatId || 'default');
      // 速聊也要限定到「哪个站点的哪台设备/哪个用户」，否则旧 Nano 也会收到纳米的窥屏回复。
      let owner = {};
      try {
        const rawOwner = await kv(env).get('peek2:owner:' + chatId);
        if (rawOwner) owner = JSON.parse(rawOwner) || {};
      } catch (e) { owner = {}; }
      const appId = cleanAppId(body.appId || owner.appId || 'legacy');
      // 优先用 App 当前选中的角色人设（含完整规则 / 最近上下文），避免快捷指令里
      // 旧的内置 system 覆盖掉人设；只有没同步过时才回退到请求体里的 system。
      let system = '';
      try {
        system = (await kv(env).get(peekBase(appId, 'persona:' + chatId)))
          || (await kv(env).get(peekBase(appId, 'persona:latest')))
          || '';
      } catch (e) {}
      if (!system) system = String(body.system || '');
      // 再兜底：从 /auto/config 同步的角色卡里找这条聊天的人设
      if (!system) {
        try {
          const deviceId = cleanDeviceId((owner && owner.deviceId) || body.deviceId);
          let userId = cleanUserId((owner && owner.userId) || body.userId);
          if (!userId || userId === 'default') {
            const rawActive = await kv(env).get(autoActiveKey(appId, deviceId));
            if (rawActive) {
              const active = JSON.parse(rawActive);
              if (active && active.userId) userId = cleanUserId(active.userId);
            }
          }
          const rawCfg = await kv(env).get(autoKey('config', appId, deviceId, userId));
          if (rawCfg) {
            const cfg = JSON.parse(rawCfg);
            const c = (cfg && Array.isArray(cfg.chars) ? cfg.chars : []).find(function (x) {
              return x && String(x.id) === String(chatId);
            });
            if (c) system = '你是「' + (c.name || 'TA') + '」。' + String(c.setting || '');
          }
        } catch (e) {}
      }
      const text = String(body.text || '').trim();
      const image = String(body.image || '').trim();
      if (!text && !image) {
        return json({ ok: false, error: 'empty', reply: '没有收到屏幕内容：请在快捷指令里传入截图或文字。' }, 400);
      }
      const history = await peekTurns(env, chatId, appId);
      const apiCfg = await peekApiConfig(env, appId, chatId, body, owner);
      let context = [];
      try {
        const rawCtx = (await kv(env).get(peekBase(appId, 'context:' + chatId)))
          || (await kv(env).get(peekBase(appId, 'context:latest')));
        if (rawCtx) {
          const parsed = JSON.parse(rawCtx);
          if (Array.isArray(parsed)) context = parsed;
        }
      } catch (e) {}
      let reply = null;
      try { reply = await peekModel(env, system, text, image, history, apiCfg, context); } catch (e) {}
      if (!reply) {
        const hasEnvApi = !!(env.PEEK_API_URL && env.PEEK_API_KEY && env.PEEK_MODEL);
        return json({
          ok: false,
          error: 'model',
          reply: hasEnvApi
            ? '模型没有返回内容：请检查 PEEK_API_URL / PEEK_API_KEY / PEEK_MODEL 或模型是否支持识图。'
            : '服务端还没有模型 API：请在 Nano 里打开一次聊天同步主 API，或在 Worker 配置 PEEK_API_URL / PEEK_API_KEY / PEEK_MODEL。'
        }, 502);
      }
      history.push({ user: text || '[图片]', char: reply, ts: Date.now() });
      await peekSave(env, chatId, history, appId);
      // 只推给这条聊天所属的 App / 设备 / 用户；找不到归属就不广播，避免串到别的 Nano。
      try {
        const targetUser = owner.userId || body.userId || '';
        const targetDevice = owner.deviceId || body.deviceId || '';
        const subs = (targetUser || targetDevice)
          ? await getSubs(env, targetUser || null, targetDevice || null, appId)
          : [];
        if (subs.length) {
          await pushAll(subs, { title: '窥屏', body: String(reply).slice(0, 120), target: 'chat:' + chatId, tag: 'peek-' + chatId, appId: appId }, env);
        }
      } catch (e) {}
      return json({ ok: true, reply: reply });
    }

    // 5.5) 人设同步：App 切换人设 / 发消息时上传当前角色人设，快捷指令就无需内置人设
    if (pathname === '/peek/persona' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const system = String(body.system || '').trim();
      if (!system) return json({ ok: false, error: 'empty' }, 400);
      const chatId = String(body.chatId || 'latest');
      const appId = cleanAppId(body.appId);
      const ttl = 60 * 60 * 24 * 30;
      try {
        await kv(env).put(peekBase(appId, 'persona:' + chatId), system, { expirationTtl: ttl });
        await kv(env).put(peekBase(appId, 'persona:latest'), system, { expirationTtl: ttl });
        // 主 API 也一起同步：快捷指令只发截图/文字，服务端直接用这里的 Key 调模型。
        const api = body.api && typeof body.api === 'object' ? {
          url: String(body.api.url || '').trim(),
          key: String(body.api.key || '').trim(),
          model: String(body.api.model || '').trim()
        } : null;
        if (api && api.url && api.key && api.model) {
          await kv(env).put(peekBase(appId, 'api:' + chatId), JSON.stringify(api), { expirationTtl: ttl });
          await kv(env).put(peekBase(appId, 'api:latest'), JSON.stringify(api), { expirationTtl: ttl });
        }
        // 最近的聊天上下文也一起同步：快捷指令只发截图/文字，服务端仍能接上你们的话题。
        if (Array.isArray(body.history)) {
          const history = body.history.slice(-12).map(function (m) {
            return {
              role: m && m.role === 'assistant' ? 'assistant' : 'user',
              content: String((m && m.content) || '').slice(0, 1200)
            };
          }).filter(function (m) { return m.content; });
          await kv(env).put(peekBase(appId, 'context:' + chatId), JSON.stringify(history), { expirationTtl: ttl });
          await kv(env).put(peekBase(appId, 'context:latest'), JSON.stringify(history), { expirationTtl: ttl });
        }
        // 记住这条聊天属于哪台设备/哪个用户，/peek 推送时只发给它
        await kv(env).put('peek2:owner:' + chatId, JSON.stringify({
          appId: appId,
          deviceId: cleanDeviceId(body.deviceId),
          userId: cleanUserId(body.userId),
          at: Date.now()
        }), { expirationTtl: ttl });
      } catch (e) {}
      return json({ ok: true });
    }

    // 6) App 拉取「屏幕速聊」暂存轮次（回到前台后合并进唯一聊天）
    if (pathname === '/peek/pending' && (request.method === 'GET' || request.method === 'POST')) {
      let body = {};
      if (request.method === 'POST') { try { body = await request.json(); } catch (e) {} }
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      let chatId = String((body && body.chatId) || '');
      let appId = String((body && body.appId) || '');
      if (!chatId) { try { chatId = new URL(request.url).searchParams.get('chatId') || ''; } catch (e) {} }
      if (!appId) { try { appId = new URL(request.url).searchParams.get('appId') || ''; } catch (e) {} }
      if (!chatId) return json({ ok: false, error: 'no chatId' }, 400);
      const turns = await peekTurns(env, chatId, appId);
      return json({ ok: true, turns: turns });
    }

    // 7) App 合并完成后清空暂存
    if (pathname === '/peek/ack' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const chatId = String(body.chatId || '');
      if (chatId) await peekSave(env, chatId, [], body.appId);
      return json({ ok: true });
    }

    // ============ 无后台主动消息 / 朋友圈 ============
    // POST /auto/config  同步开关、间隔、角色人设、模型配置
    if (pathname === '/auto/config' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!autoOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const cfg = sanitizeAutoConfig(body);
      // 每台设备 + 每个用户（面具）独立配置：手机和电脑、同一设备的多个用户互不影响
      const appId = cleanAppId(body.appId);
      const deviceId = cleanDeviceId(body.deviceId);
      const userId = cleanUserId(cfg.user.id || body.userId);
      const cfgKey = autoKey('config', appId, deviceId, userId);
      // 配置没变就不写 KV：客户端 10 分钟同步一次，每次都写会很快打满免费额度。
      let oldCfgRaw = '';
      try { oldCfgRaw = await kv(env).get(cfgKey); } catch (e) { oldCfgRaw = ''; }
      let cfgChanged = true;
      let oldCfg = null;
      if (oldCfgRaw) {
        try { oldCfg = JSON.parse(oldCfgRaw); } catch (e) { oldCfg = null; }
        // 客户端偶尔读不到 Bark key（localforage 还没加载完）时会传空字符串。
        // 空值不要覆盖服务端已有的 key，否则后台推送会突然全部消失。
        if (oldCfg && oldCfg.barkKey && !cfg.barkKey) cfg.barkKey = oldCfg.barkKey;
        try { cfgChanged = autoConfigSig(oldCfg) !== autoConfigSig(cfg); } catch (e) { cfgChanged = true; }
      }
      if (cfgChanged) await kv(env).put(cfgKey, JSON.stringify(cfg));
      // 维护 auto2:_index，cron 不再每 5 分钟 list 全部配置。
      try {
        const scope = autoScopeOf(appId, deviceId, userId);
        if (cfg.enabled) await addAutoScope(env, scope);
        else await removeAutoScope(env, scope);
      } catch (e) {}
      // active 只在切换用户/超过 6 小时时才写，不在每次同步时重复写。
      try { await touchActive(env, appId, deviceId, userId, false); } catch (e) {}
      const now = Date.now();
      const stateKey = autoKey('state', appId, deviceId, userId);
      let state = {};
      let stateRaw = '';
      try { stateRaw = await kv(env).get(stateKey); state = stateRaw ? JSON.parse(stateRaw) : {}; } catch (e) { state = {}; stateRaw = ''; }
      const reset = !!body.reset;
      if (cfg.msgEnabled) {
        const intervalMs = cfg.intervalMinutes * 60 * 1000;
        if (!state.nextMsgAt || reset) {
          state.nextMsgAt = now + intervalMs;
        } else if (state.msgMins && state.msgMins !== cfg.intervalMinutes) {
          // 改间隔时只把下一次时间「收短」到新间隔内，绝不因为切聊天/重复同步而无限顺延。
          state.nextMsgAt = Math.min(Number(state.nextMsgAt) || 0, now + intervalMs);
          if (state.nextMsgAt < now + 60 * 1000) state.nextMsgAt = now + 60 * 1000;
        }
        state.msgMins = cfg.intervalMinutes;
      } else {
        state.nextMsgAt = 0;
        state.msgMins = cfg.intervalMinutes;
      }
      if (cfg.momentEnabled) {
        const intervalMs = cfg.momentIntervalHours * 3600 * 1000;
        if (!state.nextMomentAt || reset) {
          state.nextMomentAt = now + intervalMs;
        } else if (state.momentHours && state.momentHours !== cfg.momentIntervalHours) {
          state.nextMomentAt = Math.min(Number(state.nextMomentAt) || 0, now + intervalMs);
          if (state.nextMomentAt < now + 60 * 1000) state.nextMomentAt = now + 60 * 1000;
        }
        state.momentHours = cfg.momentIntervalHours;
      } else {
        state.nextMomentAt = 0;
        state.momentHours = cfg.momentIntervalHours;
      }
      let stateChanged = true;
      if (stateRaw) {
        try { stateChanged = JSON.stringify(JSON.parse(stateRaw)) !== JSON.stringify(state); } catch (e) { stateChanged = true; }
      }
      if (stateChanged) await kv(env).put(stateKey, JSON.stringify(state));
      return json({ ok: true, enabled: cfg.enabled, appId: appId, deviceId: deviceId, userId: userId, nextMsgAt: state.nextMsgAt || 0, nextMomentAt: state.nextMomentAt || 0 });
    }

    // POST /auto/cycle  只更新角色的月潮权限数据，不动其它主动消息配置
    if (pathname === '/auto/cycle' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!autoOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      try {
        const cycles = body.cycles && typeof body.cycles === 'object' ? body.cycles : {};
        // 只更新当前站点/设备/用户的配置，避免改月潮时把别人配置一起改掉。
        const scopePrefix = autoKey('config', body.appId, body.deviceId, body.userId);
        const { keys } = await kv(env).list({ prefix: scopePrefix });
        for (const k of keys) {
          const raw = await kv(env).get(k.name);
          if (!raw) continue;
          const cfg = JSON.parse(raw);
          (cfg.chars || []).forEach(function (c) {
            const cy = cycles[c.id];
            c.cycle = (cy && /^\d{4}-\d{2}-\d{2}$/.test(String(cy.lastStart || ''))) ? {
              lastStart: String(cy.lastStart),
              nextStart: /^\d{4}-\d{2}-\d{2}$/.test(String(cy.nextStart || '')) ? String(cy.nextStart) : '',
              cycleLength: Math.max(18, Math.min(60, parseInt(cy.cycleLength, 10) || 28)),
              periodLength: Math.max(2, Math.min(14, parseInt(cy.periodLength, 10) || 5)),
              remindDays: Math.max(0, Math.min(14, parseInt(cy.remindDays, 10) || 0))
            } : null;
          });
          await kv(env).put(k.name, JSON.stringify(cfg));
        }
      } catch (e) {}
      return json({ ok: true });
    }

    // POST /auto/call  正在和某个角色通话时，跳过 TA 的主动消息/朋友圈
    if (pathname === '/auto/call' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!autoOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const appId = cleanAppId(body.appId);
      const userId = cleanUserId(body.userId);
      const chatId = String(body.chatId || '');
      const active = !!body.active && !!chatId;
      const key = 'auto2:call:' + appId + ':' + userId;
      try {
        if (active) await kv(env).put(key, chatId, { expirationTtl: 60 * 60 * 3 });
        else await kv(env).delete(key);
      } catch (e) {}
      return json({ ok: true });
    }

    // GET /auto/pending?userId=  拉取服务端生成、还没合并进 App 的消息/朋友圈
    if (pathname === '/auto/pending') {
      if (!autoOk(request, env, null)) return json({ ok: false, error: 'unauthorized' }, 401);
      const sp = new URL(request.url).searchParams;
      const appId = cleanAppId(sp.get('appId'));
      const userId = cleanUserId(sp.get('userId'));
      const deviceId = cleanDeviceId(sp.get('deviceId'));
      // 标记这台设备当前活跃的是哪个用户，服务端只给活跃用户生成/推送。
      // 注意：这里原来每轮拉取都写一次 KV（客户端约 1 分钟一次 = 每天 1440 次写），
      // 是免费额度被打满的主要原因；现在同一用户 6 小时内最多写一次。
      try { await touchActive(env, appId, deviceId, userId, false); } catch (e) {}
      let messages = [], moments = [];
      try { const raw = await kv(env).get(autoKey('msg', appId, deviceId, userId)); messages = raw ? JSON.parse(raw) : []; } catch (e) {}
      try { const raw = await kv(env).get(autoKey('moments', appId, deviceId, userId)); moments = raw ? JSON.parse(raw) : []; } catch (e) {}
      return json({ ok: true, appId: appId, messages: messages, moments: moments });
    }

    // POST /auto/ack  合并完成后删除已拉取的条目
    if (pathname === '/auto/ack' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!autoOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const appId = cleanAppId(body.appId);
      const userId = cleanUserId(body.userId);
      const deviceId = cleanDeviceId(body.deviceId);
      const mIds = Array.isArray(body.messageIds) ? body.messageIds : [];
      const pIds = Array.isArray(body.momentIds) ? body.momentIds : [];
      if (mIds.length) {
        try {
          const key = autoKey('msg', appId, deviceId, userId);
          const raw = await kv(env).get(key);
          const list = raw ? JSON.parse(raw) : [];
          await kv(env).put(key, JSON.stringify(list.filter(function (x) { return x && mIds.indexOf(x.id) < 0; })));
        } catch (e) {}
      }
      if (pIds.length) {
        try {
          const key = autoKey('moments', appId, deviceId, userId);
          const raw = await kv(env).get(key);
          const list = raw ? JSON.parse(raw) : [];
          await kv(env).put(key, JSON.stringify(list.filter(function (x) { return x && pIds.indexOf(x.id) < 0; })));
        } catch (e) {}
      }
      return json({ ok: true });
    }

    // ============ 共享集市（所有用户互相可见） ============
    // 计数单独放一个 key：之前每点一次赞都要重写 post + 整个 500 条 index（2 次写），
    // 集市稍微活跃一点就会把免费 KV 写额度打满。现在点赞只写 counts（1 次写）。
    async function readMarketCounts() {
      try {
        const raw = await marketKv(env).get('market:counts');
        return raw ? (JSON.parse(raw) || {}) : {};
      } catch (e) { return {}; }
    }
    function mergeMarketCounts(item, counts) {
      if (!item || !item.id) return item;
      const c = counts && counts[item.id];
      if (c) {
        if (c.likes != null) item.likes = Number(c.likes) || 0;
        if (c.downloads != null) item.downloads = Number(c.downloads) || 0;
        if (c.imports != null) item.imports = Number(c.imports) || 0;
      }
      return item;
    }

    // GET  /market/list          列出全部资源摘要
    if (pathname === '/market/list' && request.method === 'GET') {
      if (supabaseConf(env)) {
        try {
          const rows = await supabase(env, '/rest/v1/market_items?select=id,summary,likes,downloads,imports&order=created_at.desc&limit=500');
          let items = Array.isArray(rows) ? rows.map(marketRowToSummary) : [];
          // 兼容迁移前还留在 KV 里的旧帖子：Supabase 没有的 id 继续展示。
          let legacy = [];
          try {
            const raw = await marketKv(env).get('market:index');
            legacy = raw ? JSON.parse(raw) : [];
          } catch (e) { legacy = []; }
          if (Array.isArray(legacy) && legacy.length && String(env.INCLUDE_LEGACY_MARKET || '1') !== '0') {
            const seen = {};
            items.forEach(function (x) { if (x && x.id) seen[x.id] = 1; });
            const counts = await readMarketCounts();
            legacy.forEach(function (x) {
              if (x && x.id && !seen[x.id]) items.push(mergeMarketCounts(Object.assign({}, x), counts));
            });
          }
          return json({ ok: true, items: items });
        } catch (e) {
          console.warn('[market] supabase list failed, fallback KV:', e && e.message);
        }
      }
      let items = [];
      try { const raw = await marketKv(env).get('market:index'); items = raw ? JSON.parse(raw) : []; } catch (e) { items = []; }
      const counts = await readMarketCounts();
      items = (Array.isArray(items) ? items : []).map(function (x) { return mergeMarketCounts(x, counts); });
      return json({ ok: true, items: items });
    }

    // GET  /market/item?id=xxx   取单条完整资源（含图片/文件 dataURL）
    if (pathname === '/market/item' && request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!id) return json({ ok: false, error: 'no id' }, 400);
      if (supabaseConf(env)) {
        try {
          const rows = await supabase(env, '/rest/v1/market_items?id=eq.' + encodeURIComponent(id) + '&select=id,item,likes,downloads,imports&limit=1');
          if (Array.isArray(rows) && rows[0]) return json({ ok: true, item: marketRowToItem(rows[0]) });
        } catch (e) {
          console.warn('[market] supabase item failed, fallback KV:', e && e.message);
        }
      }
      const raw = await marketKv(env).get('market:post:' + id);
      if (!raw) return json({ ok: false, error: 'not found' }, 404);
      let rec; try { rec = JSON.parse(raw); } catch (e) { return json({ ok: false }, 500); }
      const counts = await readMarketCounts();
      return json({ ok: true, item: mergeMarketCounts(rec.item, counts) });
    }

    // POST /market/post          发布：{ item, summary, token }
    if (pathname === '/market/post' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const item = body.item, summary = body.summary, token = String(body.token || '');
      if (!item || !item.id) return json({ ok: false, error: 'no item' }, 400);
      const payload = JSON.stringify({ item: item, tok: token });
      if (payload.length > 24 * 1024 * 1024) return json({ ok: false, error: 'too large' }, 413);
      if (supabaseConf(env)) {
        try {
          await supabase(env, '/rest/v1/market_items?on_conflict=id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: {
              id: String(item.id),
              summary: summary || {},
              item: item,
              token: token,
              likes: Number(item.likes) || 0,
              downloads: Number(item.downloads) || 0,
              imports: Number(item.imports) || 0,
              updated_at: new Date().toISOString()
            }
          });
          return json({ ok: true, id: item.id });
        } catch (e) {
          console.warn('[market] supabase post failed, fallback KV:', e && e.message);
        }
      }
      await marketKv(env).put('market:post:' + item.id, payload);
      let items = [];
      try { const raw = await marketKv(env).get('market:index'); items = raw ? JSON.parse(raw) : []; } catch (e) { items = []; }
      items = items.filter((x) => x && x.id !== item.id);
      if (summary) items.unshift(summary);
      if (items.length > 500) items = items.slice(0, 500);
      await marketKv(env).put('market:index', JSON.stringify(items));
      return json({ ok: true, id: item.id });
    }

    // POST /market/count         计数：{ id, field, delta }
    if (pathname === '/market/count' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const id = String(body.id || ''), field = String(body.field || ''), delta = Number(body.delta) || 0;
      if (!id || ['likes', 'downloads', 'imports'].indexOf(field) < 0) return json({ ok: false, error: 'bad' }, 400);
      if (supabaseConf(env)) {
        try {
          const value = await supabase(env, '/rest/v1/rpc/market_increment', {
            method: 'POST',
            body: { p_id: id, p_field: field, p_delta: delta }
          });
          let v = value;
          if (v && typeof v === 'object') v = v.market_increment != null ? v.market_increment : Object.values(v)[0];
          // 返回 0 可能是「旧帖子还在 KV 里，Supabase 没有这条」：继续走下面的 KV 回退。
          if (Number(v) > 0) return json({ ok: true, value: Number(v) || 0 });
        } catch (e) {
          console.warn('[market] supabase count failed, fallback KV:', e && e.message);
        }
      }
      const key = 'market:post:' + id;
      const raw = await marketKv(env).get(key);
      if (!raw) return json({ ok: false, error: 'not found' }, 404);
      let rec; try { rec = JSON.parse(raw); } catch (e) { return json({ ok: false }, 500); }
      const counts = await readMarketCounts();
      const cur = counts[id] || {
        likes: Number(rec.item.likes) || 0,
        downloads: Number(rec.item.downloads) || 0,
        imports: Number(rec.item.imports) || 0
      };
      cur[field] = Math.max(0, (Number(cur[field]) || 0) + delta);
      counts[id] = cur;
      await marketKv(env).put('market:counts', JSON.stringify(counts));
      return json({ ok: true, value: cur[field] });
    }

    // POST /market/delete        删除：{ id, token }
    if (pathname === '/market/delete' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const id = String(body.id || ''), token = String(body.token || '');
      if (supabaseConf(env)) {
        try {
          const rows = await supabase(env, '/rest/v1/market_items?id=eq.' + encodeURIComponent(id) + '&select=token&limit=1');
          if (Array.isArray(rows) && rows[0]) {
            if (rows[0].token && rows[0].token !== token) return json({ ok: false, error: 'forbidden' }, 403);
            await supabase(env, '/rest/v1/market_items?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
            return json({ ok: true });
          }
        } catch (e) {
          console.warn('[market] supabase delete failed, fallback KV:', e && e.message);
        }
      }
      const key = 'market:post:' + id;
      const raw = await marketKv(env).get(key);
      if (!raw) return json({ ok: false, error: 'not found' }, 404);
      let rec; try { rec = JSON.parse(raw); } catch (e) { return json({ ok: false }, 500); }
      if (rec.tok && rec.tok !== token) return json({ ok: false, error: 'forbidden' }, 403);
      await marketKv(env).delete(key);
      let items = [];
      try { const rawIdx = await marketKv(env).get('market:index'); items = rawIdx ? JSON.parse(rawIdx) : []; } catch (e) { items = []; }
      items = items.filter((x) => x && x.id !== id);
      await marketKv(env).put('market:index', JSON.stringify(items));
      return json({ ok: true });
    }

    // ============ MCP 代理（绕开跨域，给 Nano 的 MCP app 用） ============
    // POST /mcp/proxy  { url, token?, sessionId?, headers?, method?, body }
    if (pathname === '/mcp/proxy' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (env.MCP_TOKEN && request.headers.get('X-Mcp-Token') !== env.MCP_TOKEN) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const target = String(body.url || '');
      if (!/^https:\/\//i.test(target)) return json({ ok: false, error: 'bad url' }, 400);
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
      if (body.token) headers['Authorization'] = 'Bearer ' + String(body.token);
      if (body.sessionId) headers['Mcp-Session-Id'] = String(body.sessionId);
      if (body.headers && typeof body.headers === 'object') {
        for (const k in body.headers) { if (/^[A-Za-z0-9-]+$/.test(k)) headers[k] = String(body.headers[k]); }
      }
      try {
        const resp = await fetch(target, {
          method: body.method || 'POST',
          headers: headers,
          body: body.body ? JSON.stringify(body.body) : undefined
        });
        const text = await resp.text();
        return json({
          ok: true, status: resp.status,
          contentType: resp.headers.get('content-type') || '',
          sessionId: resp.headers.get('mcp-session-id') || '',
          text: text
        });
      } catch (e) {
        return json({ ok: false, error: 'fetch failed: ' + (e && e.message ? e.message : e) }, 502);
      }
    }

    return json({ ok: true, info: 'nano-push alive' });
  },

  // 每 5 分钟触发：到点给 Bark 发提醒 + 处理 KV 里的预约任务
  async scheduled(event, env, ctx) {
    try { await sendBarkReminder(env); } catch (e) {}
    // 无后台主动消息 / 朋友圈：每台设备 + 每个用户单独跑自己的配置。
    // 旧前缀 auto:config: 不再执行，避免旧 Nano 和新纳米同时给同一台手机发消息。
    // 通过 auto2:_index 读取作用域，避免每 5 分钟 list 一次（免费版 list 额度只有 1000/天）。
    try {
      const scopes = await getAutoScopes(env);
      for (const scope of scopes) {
        const parts = String(scope || '').split(':');
        const appId = parts[0] || 'legacy';
        const deviceId = parts[1] || 'default';
        const userId = parts[2] || 'default';
        try { await runAutoPush(env, appId, deviceId, userId); } catch (e) {}
      }
    } catch (e) {}

    const now = Date.now();
    // ===== 预约任务：只读索引里到点的任务，不再每 5 分钟 list 全部 job: =====
    let jobIds = await readIndex(env, JOB_INDEX_KEY);
    if (jobIds === null) {
      try {
        const { keys } = await kv(env).list({ prefix: 'job:' });
        jobIds = (keys || []).map(function (k) { return k.name; }).filter(function (id) { return id !== JOB_INDEX_KEY; });
        await writeIndex(env, JOB_INDEX_KEY, jobIds);
      } catch (e) { jobIds = []; }
    }
    const dueIds = [];
    const keepIds = [];
    for (const id of jobIds) {
      const at = parseInt(String(id).split(':')[1], 10) || 0;
      if (at && at <= now) dueIds.push(id); else keepIds.push(id);
    }
    if (!dueIds.length) return;
    // 先摘掉到点的索引，任务执行失败也不会每 5 分钟重复推送。
    await writeIndex(env, JOB_INDEX_KEY, keepIds);
    const subsCache = {};
    async function jobSubs(job) {
      // 旧客户端预约的任务没有 appId：只允许投给 legacy 订阅，绝不广播到新纳米。
      const jobApp = job.appId ? cleanAppId(job.appId) : 'legacy';
      const k = jobApp + '|' + cleanDeviceId(job.deviceId) + '|' + cleanUserId(job.userId);
      if (!subsCache[k]) subsCache[k] = await getSubs(env, job.userId || null, job.deviceId || null, jobApp);
      return subsCache[k];
    }
    for (const id of dueIds) {
      let raw = '';
      try { raw = await kv(env).get(id); } catch (e) { raw = ''; }
      try { await kv(env).delete(id); } catch (e) {}
      if (!raw) continue;
      let job;
      try { job = JSON.parse(raw); } catch (e) { continue; }
      const jobPayload = { title: job.title || 'Nano', body: job.body || '', target: job.target || '', appId: cleanAppId(job.appId) };
      let sent = 0;
      // 用户明确留了 Bark 密钥：优先走 Bark，失败再用 Web Push 兜底。
      if (job.barkKey) {
        try { if (await sendBarkKey(env, job.barkKey, jobPayload)) sent = 1; } catch (e) { sent = 0; }
      }
      if (!sent) {
        let subs = await jobSubs(job);
        if (subs.length) { try { sent = await pushAll(subs, jobPayload, env); } catch (e) { sent = 0; } }
      }
      // 旧任务没有 appId 时才使用全局 BARK_KEY，避免旧配置把消息发到别人手机。
      if (!sent && !job.barkKey && !job.appId && env.BARK_KEY) {
        try { await sendBarkKey(env, env.BARK_KEY, jobPayload); } catch (e) {}
      }
    }
  }
};

// 到点给 Bark 发一条 iPhone 系统通知（BARK_KEY 未配置则跳过）
async function sendBarkReminder(env) {
  const key = env.BARK_KEY;
  if (!key) return;
  const times = String(env.REMIND_TIMES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const text = String(env.REMIND_TEXT || '').trim();
  // 没有再配置自定义提醒文案时不要发「有人想你了」这类通用占位通知：
  // 真实的主动消息 / 朋友圈会带角色昵称和具体内容，混在一起会让 Bark 看起来只有 title/body。
  if (!times.length || !text) return;
  // 旧版默认文案即使还留在 Cloudflare 环境变量里，也不再发送。
  if (text === '有人想你了，点开看看～') return;
  // 换算北京时间
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const cur = String(bj.getUTCHours()).padStart(2, '0') + ':' + String(bj.getUTCMinutes()).padStart(2, '0');
  if (!times.includes(cur)) return;
  const base = String(key).indexOf('http') === 0 ? String(key).replace(/\/+$/, '') : ('https://api.day.app/' + encodeURIComponent(key));
  const url = base + '/' + encodeURIComponent('Nano 提醒') + '/' + encodeURIComponent(text) + '?group=Nano&level=passive';
  try { await fetch(url); } catch (e) {}
}

async function getSubs(env, userId, deviceId, appId) {
  const out = [];
  const seen = {};
  const wantApp = appId ? cleanAppId(appId) : '';
  const wantUser = userId ? cleanUserId(userId) : '';
  const wantDevice = deviceId ? cleanDeviceId(deviceId) : '';
  let keys = [];
  try {
    let prefix = 'sub2:';
    if (wantApp && wantDevice && wantUser) prefix = 'sub2:' + wantApp + ':' + wantDevice + ':' + wantUser + ':';
    else if (wantApp && wantDevice) prefix = 'sub2:' + wantApp + ':' + wantDevice + ':';
    else if (wantApp) prefix = 'sub2:' + wantApp + ':';
    const r = await kv(env).list({ prefix: prefix });
    keys = r.keys || [];
    // 新 key 没有命中时，兼容升级前写入的全局 sub: key（用户打开 App 重新订阅后会自动迁移）。
    if (!keys.length) {
      const legacy = await kv(env).list({ prefix: 'sub:' });
      keys = legacy.keys || [];
    }
  } catch (e) { return out; }
  for (const k of keys) {
    const v = await kv(env).get(k.name);
    if (!v) continue;
    try {
      const s = JSON.parse(v);
      if (!s || !s.endpoint) continue;
      // 站点隔离：纳米 / 旧 Nano / 其它部署绝不互相收推送。
      const subApp = cleanAppId(s.appId);
      if (wantApp && subApp !== wantApp) continue;
      // 设备隔离：电脑和手机各推各的 char，绝不串设备。
      if (wantDevice && cleanDeviceId(s.deviceId) !== wantDevice) continue;
      // 用户隔离：只推给完全相同的 userId（不再把 default 当万能匹配）。
      if (wantUser && cleanUserId(s.userId) !== wantUser) continue;
      if (seen[s.endpoint]) continue;
      seen[s.endpoint] = 1;
      out.push(s);
    } catch (e) {}
  }
  return out;
}

async function pushAll(subs, payload, env) {
  const vapid = await ensureVapid(env);
  if (!vapid) return 0;
  let sent = 0;
  for (const sub of subs) {
    if (!sub || !sub.endpoint) continue;
    try {
      const init = await buildPushPayload(
        { data: JSON.stringify(payload), options: { ttl: 3600 } },
        sub,
        { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }
      );
      const resp = await fetch(sub.endpoint, init);
      if (resp && resp.ok) sent++;
      // 订阅已失效（卸载/清数据/换浏览器）：删除，避免每次都失败
      if (resp && (resp.status === 404 || resp.status === 410)) {
        try { await kv(env).delete(subKey(sub.endpoint, sub.appId, sub.deviceId, sub.userId)); } catch (e) {}
        try { await kv(env).delete(subId(sub.endpoint)); } catch (e) {}
      }
    } catch (e) { /* 单个失败不影响其他 */ }
  }
  return sent;
}

async function sendAll(env, payload) {
  const subs = await getSubs(env);
  await pushAll(subs, payload, env);
  return subs.length;
}
