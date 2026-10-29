import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Model, model, X-Push-Token, X-Peek-Token, X-Nano-App, X-Nano-Kind, X-Admin-Token, xi-api-key',
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
// 集市也优先走 D1；只有完全没绑 D1 的自建 Worker 才回退到 KV。
// 生产 Worker 已绑 nano_db，这里不再直接读写 PUSH_KV，避免继续消耗 KV 额度。
function marketKv(env) {
  return kv(env);
}

// ===== 集市文件：Supabase 存元数据，R2 存图片/附件 =====
// 绑了 MEDIA（R2）时，发布资源会把 dataURL 上传到 R2，item 里只留 URL；
// 没绑 R2 时保持旧行为（dataURL 存在 Supabase/D1 里）。
function mediaPublicBase(env) {
  return String((env && env.MEDIA_PUBLIC_BASE) || '').trim().replace(/\/+$/, '');
}
function mediaUrl(env, request, key) {
  const base = mediaPublicBase(env);
  if (base) return base + '/' + key;
  return new URL(request.url).origin + '/market/file?key=' + encodeURIComponent(key);
}
function mediaSafeId(id) {
  return String(id || 'post').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'post';
}
function mediaExt(mime, name) {
  const m = String(mime || '').toLowerCase();
  if (/png/.test(m)) return 'png';
  if (/jpe?g/.test(m)) return 'jpg';
  if (/webp/.test(m)) return 'webp';
  if (/gif/.test(m)) return 'gif';
  if (/svg/.test(m)) return 'svg';
  if (/pdf/.test(m)) return 'pdf';
  if (/json/.test(m)) return 'json';
  if (/zip/.test(m)) return 'zip';
  const n = String(name || '');
  const dot = n.lastIndexOf('.');
  if (dot > -1 && n.length - dot <= 9) {
    const ext = n.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (ext) return ext;
  }
  return 'bin';
}
function parseDataUrl(src) {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(String(src || ''));
  if (!m) return null;
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { mime: m[1] || 'application/octet-stream', bytes: bytes };
  } catch (e) { return null; }
}
function supabaseMarketBucket(env) {
  return String((env && env.SUPABASE_MARKET_BUCKET) || 'nano-market')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'nano-market';
}
function supabaseStoragePath(key) {
  return String(key || '').split('/').map(encodeURIComponent).join('/');
}
async function putMarketBlob(env, request, key, dataUrl) {
  const p = parseDataUrl(dataUrl);
  if (!p) return '';
  // 优先 R2；没开通 R2 时用 Supabase Storage（同一个 Supabase 项目即可，不用绑卡）。
  if (env.MEDIA) {
    await env.MEDIA.put(key, p.bytes, { httpMetadata: { contentType: p.mime } });
    return mediaUrl(env, request, key);
  }
  const c = supabaseConf(env);
  if (!c) return '';
  const bucket = supabaseMarketBucket(env);
  const path = supabaseStoragePath(key);
  const resp = await fetch(c.url + '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + c.key,
      'apikey': c.key,
      'Content-Type': p.mime,
      'x-upsert': 'true'
    },
    body: p.bytes
  });
  if (!resp.ok) throw new Error('supabase storage http ' + resp.status);
  return c.url + '/storage/v1/object/public/' + encodeURIComponent(bucket) + '/' + path;
}
async function deleteSupabaseStorageObject(env, key) {
  const c = supabaseConf(env);
  if (!c) return;
  const bucket = supabaseMarketBucket(env);
  const path = supabaseStoragePath(key);
  try {
    await fetch(c.url + '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + path, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + c.key, 'apikey': c.key }
    });
  } catch (e) {}
}
async function offloadMarketItem(env, request, item, summary) {
  if (!env || !item) return item;
  if (!env.MEDIA && !supabaseConf(env)) return item;
  const id = mediaSafeId(item.id);
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  if (Array.isArray(item.images)) {
    for (let i = 0; i < item.images.length; i++) {
      const src = item.images[i];
      if (typeof src !== 'string' || !/^data:/i.test(src)) continue;
      const p = parseDataUrl(src);
      const key = 'market/' + id + '/img-' + i + '-' + stamp + '.' + mediaExt(p && p.mime, '');
      try {
        const url = await putMarketBlob(env, request, key, src);
        if (url) item.images[i] = url;
      } catch (e) { console.warn('[market] r2 image failed:', e && e.message); }
    }
  }
  if (Array.isArray(item.files)) {
    for (let i = 0; i < item.files.length; i++) {
      const f = item.files[i];
      if (!f || typeof f.data !== 'string' || !/^data:/i.test(f.data)) continue;
      const p = parseDataUrl(f.data);
      const key = 'market/' + id + '/file-' + i + '-' + stamp + '.' + mediaExt(p && p.mime, f.name);
      try {
        const url = await putMarketBlob(env, request, key, f.data);
        if (url) { f.url = url; delete f.data; }
      } catch (e) { console.warn('[market] r2 file failed:', e && e.message); }
    }
  }
  if (typeof item.avatar === 'string' && /^data:/i.test(item.avatar)) {
    const p = parseDataUrl(item.avatar);
    const key = 'market/' + id + '/avatar-' + stamp + '.' + mediaExt(p && p.mime, '');
    try {
      const url = await putMarketBlob(env, request, key, item.avatar);
      if (url) item.avatar = url;
    } catch (e) {}
  }
  let coverUrl = '';
  if (summary && typeof summary.cover === 'string' && /^data:/i.test(summary.cover)) {
    const p = parseDataUrl(summary.cover);
    const key = 'market/' + id + '/cover-' + stamp + '.' + mediaExt(p && p.mime, '');
    try {
      const url = await putMarketBlob(env, request, key, summary.cover);
      if (url) { summary.cover = url; coverUrl = url; }
    } catch (e) {}
  } else if (summary && typeof summary.cover === 'string' && summary.cover) {
    coverUrl = summary.cover;
  }
  if (!coverUrl && typeof item.cover === 'string' && /^data:/i.test(item.cover)) {
    const p = parseDataUrl(item.cover);
    const key = 'market/' + id + '/cover-' + stamp + '.' + mediaExt(p && p.mime, '');
    try {
      const url = await putMarketBlob(env, request, key, item.cover);
      if (url) { item.cover = url; coverUrl = url; }
    } catch (e) {}
  }
  if (coverUrl) {
    item.cover = coverUrl;
    if (summary && !summary.cover) summary.cover = coverUrl;
  } else if (summary && !summary.cover && Array.isArray(item.images) && item.images[0]) {
    summary.cover = item.images[0];
  }
  return item;
}
function mediaRefFromUrl(env, url) {
  const s = String(url || '');
  const base = mediaPublicBase(env);
  if (base && s.indexOf(base + '/') === 0) return { backend: 'r2', key: s.slice(base.length + 1) };
  try {
    const u = new URL(s);
    if (u.pathname === '/market/file') return { backend: 'r2', key: u.searchParams.get('key') || '' };
  } catch (e) {}
  const c = supabaseConf(env);
  if (c) {
    const bucket = supabaseMarketBucket(env);
    const marker = c.url + '/storage/v1/object/public/' + encodeURIComponent(bucket) + '/';
    if (s.indexOf(marker) === 0) {
      try { return { backend: 'supabase', key: decodeURIComponent(s.slice(marker.length)) }; } catch (e) {}
    }
  }
  return null;
}
async function deleteMarketBlobs(env, item, summary) {
  if (!env || !item) return;
  const urls = [];
  if (Array.isArray(item.images)) item.images.forEach(function (u) { if (typeof u === 'string') urls.push(u); });
  if (Array.isArray(item.files)) item.files.forEach(function (f) { if (f && typeof f.url === 'string') urls.push(f.url); });
  if (typeof item.avatar === 'string') urls.push(item.avatar);
  if (typeof item.cover === 'string') urls.push(item.cover);
  if (summary && typeof summary.cover === 'string') urls.push(summary.cover);
  const seen = {};
  for (const u of urls) {
    const ref = mediaRefFromUrl(env, u);
    if (!ref || !ref.key || seen[ref.backend + ':' + ref.key]) continue;
    seen[ref.backend + ':' + ref.key] = 1;
    if (ref.backend === 'r2') {
      if (env.MEDIA && ref.key.indexOf('market/') === 0) {
        try { await env.MEDIA.delete(ref.key); } catch (e) {}
      }
    } else if (ref.backend === 'supabase') {
      await deleteSupabaseStorageObject(env, ref.key);
    }
  }
}

// D1 不会像 KV 那样自动清理过期键；每天分批删一次，避免 500MB 免费库被旧
// 窥屏/persona/会话撑满。不要给 kv.expires_at 建二级索引：每次 put 都会多算 1 行写，
// 而清理一天只跑一次，全表扫一次完全承受得起。
async function cleanupExpiredD1(env) {
  const db = env && (env.DB || env.nano_db);
  if (!db) return;
  const now = Date.now();
  let last = 0;
  try { last = Number(await kv(env).get('meta:cleanup_at') || 0) || 0; } catch (e) {}
  if (last && now - last < 24 * 3600 * 1000) return;
  try {
    await db.prepare(
      'DELETE FROM kv WHERE key IN (' +
      'SELECT key FROM kv WHERE expires_at > 0 AND expires_at <= ? ORDER BY expires_at LIMIT 800' +
      ')'
    ).bind(now).run();
    await kv(env).put('meta:cleanup_at', String(now));
  } catch (e) {}
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
async function removeJobId(env, id) {
  try {
    const arr = await readIndex(env, JOB_INDEX_KEY);
    const next = arr.filter(function (x) { return String(x) !== String(id); });
    if (next.length !== arr.length) await writeIndex(env, JOB_INDEX_KEY, next);
  } catch (e) {}
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

// 屏幕速聊（iOS 快捷指令）令牌校验
// · 普通模式：带了 PEEK_TOKEN 就必须匹配，未设置则放行。
// · 公用模式（PEEK_PUBLIC=1）：接受任意长度足够的令牌，并把令牌哈希进数据分区，
//   这样同一个站点上不同用户的窥屏记录 / 人设 / API 互不可见。
function peekPublic(env) {
  const v = String(env.PEEK_PUBLIC || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
function peekTokenValue(request, body) {
  let h = '';
  try { h = request.headers.get('X-Peek-Token') || ''; } catch (e) {}
  let q = '';
  try { q = new URL(request.url).searchParams.get('token') || ''; } catch (e) {}
  const b = body && body.token ? String(body.token) : '';
  return String(h || q || b || '').trim();
}
function peekTokenHash(token) {
  const s = String(token || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0).toString(36);
}
function peekScope(env, appId, token) {
  const a = cleanAppId(appId);
  if (!peekPublic(env)) return a;
  return a + '.' + peekTokenHash(token || 'anon');
}
// 令牌 → 站点 appId 的索引。快捷指令经常只带 token / chatId，不带 appId；
// 没有这个索引时服务端会把请求当成 legacy 分区，于是「同步过 API 却查不到」，
// 表现为一直报没有模型、上游 API 站也完全没有调用记录。
function peekAppIndexKey(env, token) {
  if (!peekPublic(env)) return 'peek2:appid:local';
  return 'peek2:appid:' + peekTokenHash(token || 'anon');
}
async function peekRememberApp(env, token, appId) {
  const a = cleanAppId(appId);
  if (!a || a === 'legacy') return;
  try { await kv(env).put(peekAppIndexKey(env, token), a, { expirationTtl: 60 * 60 * 24 * 90 }); } catch (e) {}
}
async function peekResolveApp(env, token) {
  try {
    const raw = await kv(env).get(peekAppIndexKey(env, token));
    return raw ? cleanAppId(raw) : '';
  } catch (e) { return ''; }
}
function peekOwnerKey(env, token, chatId) {
  chatId = String(chatId || 'default');
  if (!peekPublic(env)) return 'peek2:owner:' + chatId;
  return 'peek2:owner:' + peekTokenHash(token || 'anon') + ':' + chatId;
}
function peekOk(request, env, body) {
  const t = peekTokenValue(request, body);
  if (peekPublic(env)) return t.length >= 8;
  if (!env.PEEK_TOKEN) return true;
  return t === env.PEEK_TOKEN;
}
// 从同步过来的人设里取角色名：'你是「小柒」，...' → 小柒
function peekCharName(system) {
  const m = String(system || '').match(/你是[「"]([^」"]{1,40})[」"]/);
  return m ? String(m[1]).trim() : '';
}

// 只做去掉首尾空白的处理，绝不内置、替换或改写模型名。
// 模型始终来自 App 当前主 API 配置（地址 / Key / 模型一起实时同步）。
function normalizeModelName(raw) {
  return String(raw == null ? '' : raw).trim();
}

function modelEndpoint(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  // 用户可能填的是完整接口地址，也可能只填到 /v1，不能重复拼路径
  if (/\/chat\/completions$/i.test(s)) return s;
  if (/\/responses$/i.test(s)) return s;
  if (/\/openai$/i.test(s)) return s + '/chat/completions';
  if (/\/v1$/i.test(s)) return s + '/chat/completions';
  if (/\/v1\//i.test(s)) return s;
  return s + '/v1/chat/completions';
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
async function peekApiConfig(env, appId, chatId, body, owner, realAppId) {
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
      const rawActive = await kv(env).get(autoActiveKey(realAppId || appId, deviceId));
      if (rawActive) {
        const active = JSON.parse(rawActive);
        if (active && active.userId) userId = cleanUserId(active.userId);
      }
    } catch (e) {}
  }
  if (!userId) userId = 'default';
  // 1) 优先用「窥屏/API 页」实时同步上来的那份：只要用户在 API 页改了模型，
  //    这里就会立刻跟着变，Worker 不再自己保存/固定任何模型名。
  //    先读 latest：API 配置是全局的，latest 永远是最新一次同步，避免旧 chat 分区的模型覆盖新配置。
  try {
    const rawLatest = await kv(env).get(peekBase(appId, 'api:latest'));
    if (rawLatest) {
      const latest = cleanApi(JSON.parse(rawLatest));
      if (latest) return latest;
    }
    const raw = await kv(env).get(peekBase(appId, 'api:' + chatId));
    if (raw) {
      const own = cleanApi(JSON.parse(raw));
      if (own) return own;
    }
  } catch (e) {}
  // 2) 窥屏专用配置还没写过时，用聊天同步上来的最新主 API。
  //    公用模式直接跳过这一步：那是按站点/设备存的，绝不能把站长的 Key 给陌生人用。
  if (!peekPublic(env)) {
    try {
      const raw = await kv(env).get(autoKey('config', realAppId || appId, deviceId, userId));
      if (raw) {
        const cfg = JSON.parse(raw);
        const api = cleanApi(cfg && cfg.api);
        if (api) return api;
      }
    } catch (e) {}
  }
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
      // 每个角色自己的主动消息 / 朋友圈开关。老版本没有这两个字段时默认允许，
      // 避免升级后所有角色都收不到；新版本会显式传 true / false。
      msgOn: c && c.msgOn === false ? false : true,
      momentOn: c && c.momentOn === false ? false : true,
      // 最近聊天上下文：后台生成必须接得上你们刚聊过的话题，不能凭空发口水话
      recent: (Array.isArray(c && c.recent) ? c.recent.slice(-20) : []).map(function (r) {
        return {
          who: (r && r.who === 'user') ? 'user' : 'char',
          text: String((r && r.text) || '').replace(/\s+/g, ' ').trim().slice(0, 400)
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
    walletBalance: Math.max(0, Number(body.walletBalance) || 0),
    updatedAt: Date.now()
  };
}
async function autoChat(env, cfg, messages, maxTokens, temperature) {
  // 只使用 App 实时同步上来的主 API（地址 / Key / 模型一字不改）。
  // 不内置任何模型名，也不回退到 AUTO_MODEL / PEEK_MODEL，避免“固定模型”和重复扣费。
  const url = modelEndpoint((cfg.api && cfg.api.url) || '');
  const key = (cfg.api && cfg.api.key) || '';
  const model = normalizeModelName((cfg.api && cfg.api.model) || '');
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

// 国籍 → 角色当地时间（与前端 js/nano-holiday.js 保持一致）：
// 主动消息也必须按角色所在国家的当地时间判断早晚，不能一律用北京时间。
const AUTO_TZ_BY_NAT = {
  '美国': 'America/New_York', 'usa': 'America/New_York', 'united states': 'America/New_York',
  '英国': 'Europe/London', 'uk': 'Europe/London', 'england': 'Europe/London',
  '加拿大': 'America/Toronto', 'canada': 'America/Toronto',
  '澳大利亚': 'Australia/Sydney', '澳洲': 'Australia/Sydney', 'australia': 'Australia/Sydney',
  '新西兰': 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
  '法国': 'Europe/Paris', 'france': 'Europe/Paris',
  '德国': 'Europe/Berlin', 'germany': 'Europe/Berlin', '奥地利': 'Europe/Vienna',
  '意大利': 'Europe/Rome', 'italy': 'Europe/Rome',
  '西班牙': 'Europe/Madrid', 'spain': 'Europe/Madrid',
  '葡萄牙': 'Europe/Lisbon', '荷兰': 'Europe/Amsterdam', '比利时': 'Europe/Brussels',
  '瑞士': 'Europe/Zurich', '瑞典': 'Europe/Stockholm', '挪威': 'Europe/Oslo',
  '丹麦': 'Europe/Copenhagen', '芬兰': 'Europe/Helsinki', '波兰': 'Europe/Warsaw',
  '希腊': 'Europe/Athens', '爱尔兰': 'Europe/Dublin', '俄罗斯': 'Europe/Moscow',
  '乌克兰': 'Europe/Kyiv', '土耳其': 'Europe/Istanbul',
  '日本': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
  '韩国': 'Asia/Seoul', '南韩': 'Asia/Seoul', 'korea': 'Asia/Seoul',
  '新加坡': 'Asia/Singapore', '马来西亚': 'Asia/Kuala_Lumpur', '泰国': 'Asia/Bangkok',
  '越南': 'Asia/Ho_Chi_Minh', '菲律宾': 'Asia/Manila', '印度尼西亚': 'Asia/Jakarta',
  '印尼': 'Asia/Jakarta', '印度': 'Asia/Kolkata', '巴基斯坦': 'Asia/Karachi',
  '孟加拉': 'Asia/Dhaka', '尼泊尔': 'Asia/Kathmandu', '斯里兰卡': 'Asia/Colombo',
  '沙特阿拉伯': 'Asia/Riyadh', '沙特': 'Asia/Riyadh', '阿联酋': 'Asia/Dubai', '迪拜': 'Asia/Dubai',
  '以色列': 'Asia/Jerusalem', '伊朗': 'Asia/Tehran',
  '墨西哥': 'America/Mexico_City', '巴西': 'America/Sao_Paulo',
  '阿根廷': 'America/Argentina/Buenos_Aires', '智利': 'America/Santiago',
  '哥伦比亚': 'America/Bogota', '秘鲁': 'America/Lima', '委内瑞拉': 'America/Caracas',
  '古巴': 'America/Havana', '埃及': 'Africa/Cairo', '南非': 'Africa/Johannesburg'
};
function autoTz(c) {
  const n = String((c && c.nationality) || '').trim();
  if (!n || n === '未知' || n === '未设定') return 'Asia/Shanghai';
  if (/香港|hong\s*kong/i.test(n)) return 'Asia/Hong_Kong';
  if (/澳门|澳門|macau|macao/i.test(n)) return 'Asia/Macau';
  if (/台湾|台灣|taiwan/i.test(n)) return 'Asia/Taipei';
  if (/中国|中國|china|chinese/i.test(n)) return 'Asia/Shanghai';
  const low = n.toLowerCase();
  for (const k of Object.keys(AUTO_TZ_BY_NAT)) {
    if (n.indexOf(k) > -1 || low.indexOf(k.toLowerCase()) > -1) return AUTO_TZ_BY_NAT[k];
  }
  return 'Asia/Shanghai';
}
function autoNowText(c, ms) {
  const d = new Date(Number(ms) || Date.now());
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: autoTz(c), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(d);
    const m = {};
    parts.forEach(function (p) { m[p.type] = p.value; });
    return m.year + '-' + m.month + '-' + m.day + ' ' + (m.weekday || '') + ' ' + m.hour + ':' + m.minute;
  } catch (e) {
    return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }
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
  // 只从「自己开启了主动消息」的角色里挑；关闭了某个角色就绝不能再让 TA 发。
  const allowed = cfg.chars.filter(function (c) { return c && c.msgOn !== false; });
  const pool = allowed.filter(function (c) { return c.id !== busyChatId && !c.isNpc; });
  let source = pool.length >= 2 ? pool : allowed.filter(function (c) { return c.id !== busyChatId; });
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
      + '现在是 ' + autoNowText(c, now) + '（你所在地的当地时间）。\n'
      + (typeof cfg.walletBalance === 'number' ? ('【用户真实经济状况】用户钱包当前余额约 ¥' + Number(cfg.walletBalance).toFixed(2) + '。这是真实数据，不要凭空说用户没钱、欠钱或吃不起饭。\n') : '')
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
  // 同样只从「自己开启了自动朋友圈」的角色里挑，不能把已关闭的角色动态也发出来。
  const allowed = cfg.chars.filter(function (c) { return c && c.momentOn !== false; });
  const pool = allowed.filter(function (c) { return c.id !== busyChatId && !c.isNpc; });
  const source = pool.length ? pool : allowed.filter(function (c) { return c.id !== busyChatId; });
  if (!source.length) return [];
  // 后台一次最多让 3 个角色出现；和主动消息合计也由 runAutoPush 控制在 3 个以内
  const count = Math.max(1, Math.min(Number(maxChars) || 2, 3, source.length));
  const picked = pickRandom(source, count);
  const names = picked.map(function (c) { return c.name; });
  const profiles = picked.map(function (c) {
    const recent = (c.recent || []).slice(-8).map(function (r) {
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
// 后台推送只走 Web Push。Bark 已彻底移除。
async function autoNotify(env, cfg, subs, payload) {
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
          renotify: true,
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
          renotify: true,
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
function peekModelText(data) {
  if (!data) return '';
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  let c = msg && msg.content;
  if (Array.isArray(c)) {
    c = c.map(function (x) {
      if (typeof x === 'string') return x;
      return (x && (x.text || x.content)) || '';
    }).join('');
  }
  if (typeof c === 'string' && c.trim()) return c.trim();
  const alt = data.choices && data.choices[0] && data.choices[0].text;
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data.output)) {
    const parts = [];
    data.output.forEach(function (o) {
      (o && Array.isArray(o.content) ? o.content : []).forEach(function (p) {
        if (p && typeof p.text === 'string') parts.push(p.text);
      });
    });
    if (parts.join('').trim()) return parts.join('').trim();
  }
  if (Array.isArray(data.content)) {
    const parts = data.content.map(function (x) {
      if (typeof x === 'string') return x;
      return (x && (x.text || x.content)) || '';
    }).join('');
    if (parts.trim()) return parts.trim();
  }
  const cand = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  if (Array.isArray(cand)) {
    const parts = cand.map(function (x) { return (x && x.text) || ''; }).join('');
    if (parts.trim()) return parts.trim();
  }
  return '';
}

function peekProvider(raw) {
  const s = String(raw || '');
  // 先认 OpenAI 兼容路径（Gemini 的 /v1beta/openai、各种聚合网关都走这里）
  if (/\/chat\/completions$/i.test(s) || /\/responses$/i.test(s) || /\/openai(\/|$)/i.test(s)) return 'openai';
  let host = '';
  try { host = new URL(s).hostname.toLowerCase(); } catch (e) {}
  if (/(^|\.)api\.anthropic\.com$/.test(host) || /\/messages$/i.test(s)) return 'anthropic';
  if (/(^|\.)generativelanguage\.googleapis\.com$/.test(host) || /:generateContent/i.test(s)) return 'gemini';
  return 'openai';
}

function peekAnthropicEndpoint(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (/\/messages$/i.test(s)) return s;
  if (/\/v1$/i.test(s)) return s + '/messages';
  return s + '/v1/messages';
}

function peekGeminiEndpoint(raw, model) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (/:generateContent/i.test(s)) return s;
  if (/\/models\//i.test(s)) return s + ':generateContent';
  if (/\/v1beta$/i.test(s) || /\/v1$/i.test(s)) return s + '/models/' + encodeURIComponent(model) + ':generateContent';
  return s + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
}

function peekImageUrl(image) {
  let s = String(image || '').trim();
  if (!s) return '';
  // dataURL 里的 Base64 不能带换行/空格：部分网关会直接当成坏图或返回「看不到图片」。
  if (/^data:image\//i.test(s)) return s.replace(/\s+/g, '');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 100) {
    return 'data:image/jpeg;base64,' + s.replace(/\s+/g, '');
  }
  return s;
}

function peekDataUrl(image) {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(String(image || ''));
  return m ? { mime: m[1] || 'image/jpeg', data: m[2].replace(/\s+/g, '') } : null;
}

function peekBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

// 只使用 App 实时同步上来的主 API：地址、Key、模型全部照当前 API 配置原样使用。
// 不内置模型名，也不自动换 PEEK_MODEL / AUTO_MODEL 重试（那会改模型并重复扣费）。
async function peekModel(env, system, text, image, history, apiCfg, context) {
  if (!apiCfg || !apiCfg.url || !apiCfg.key || !apiCfg.model) return null;
  return peekModelOnce(env, system, text, image, history, apiCfg, context, {
    url: apiCfg.url,
    key: apiCfg.key,
    model: apiCfg.model
  });
}

// 只有「请求格式不兼容」才值得换一种 body 再试。额度不足、Key 错误、模型不存在
// 这类错误再重试只会重复预扣费，必须立即停止。
function peekErrorRetryable(err) {
  const s = String(err || '');
  if (!s) return false;
  if (/(insufficient|quota|额度|余额|预扣费|billing|payment|402|403|401|unauthorized|invalid[_\s-]?api[_\s-]?key|permission|model_not_found|no available channel|invalid\s*model)/i.test(s)) return false;
  return /(temperature|max_tokens|max_completion_tokens|unsupported|invalid|reasoning|image_url|content|format|parameter)/i.test(s);
}

async function peekModelOnce(env, system, text, image, history, apiCfg, context, forcedCfg) {
  const rawUrl = (forcedCfg && forcedCfg.url) || '';
  const key = (forcedCfg && forcedCfg.key) || '';
  const model = normalizeModelName((forcedCfg && forcedCfg.model) || '');
  if (!rawUrl || !key || !model) return null;

  const provider = peekProvider(rawUrl);
  const url = provider === 'anthropic'
    ? peekAnthropicEndpoint(rawUrl)
    : provider === 'gemini'
      ? peekGeminiEndpoint(rawUrl, model)
      : modelEndpoint(rawUrl);
  const isResponses = provider === 'openai' && /\/responses$/i.test(url);
  const imageUrl = peekImageUrl(image);
  const imagePrompt = '这是用户刚刚发给你的实时截图。先用一两句话具体说出画面里真实存在的内容（界面/人物/文字/场景），再以你的人设随口点评。不要假装看不到图，也不要泛泛而谈。';
  // 同时支持「截图」和「截图 + OCR 文本」：模型不支持识图时，至少还能读 OCR 文本。
  const textPrompt = [String(text || '').trim(), imageUrl ? imagePrompt : ''].filter(Boolean).join('\n\n') ||
    '看看我现在屏幕上是什么，用你的人设随口说一句。';

  const baseMessages = [];
  (context || []).forEach(function (m) {
    if (!m || !m.content) return;
    baseMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1200) });
  });
  (history || []).forEach(function (t) {
    if (t.user) baseMessages.push({ role: 'user', content: String(t.user) });
    if (t.char) baseMessages.push({ role: 'assistant', content: String(t.char) });
  });

  async function send(payload, headers) {
    try {
      // 部分中转站会按 User-Agent / Accept 做风控：Worker 默认请求没有浏览器头，
      // 会被 Cloudflare 直接返回 HTML 403。补上常见浏览器头，纯 API 网关不受影响。
      const hdrs = new Headers(Object.assign(
        { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        headers || {}
      ));
      try { hdrs.set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'); } catch (e) {}
      const resp = await fetch(url, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 240); } catch (e) {}
        const looksHtml = /<!doctype|<html|cloudflare|attention required|access denied|just a moment/i.test(detail);
        return { text: '', error: 'HTTP ' + resp.status + (looksHtml ? ' [上游返回网页/风控页] ' : ' ') + detail };
      }
      const data = await resp.json();
      return { text: peekModelText(data), error: '' };
    } catch (e) {
      return { text: '', error: String((e && e.message) || e || '') };
    }
  }

  function openAIContent(useImage, imageMode, imageFirst) {
    if (!useImage || !imageUrl) return textPrompt;
    let u = imageUrl;
    if (imageMode === 'raw') {
      const d = peekDataUrl(imageUrl);
      u = d ? d.data : imageUrl;
    }
    const part = imageMode === 'string'
      ? { type: 'image_url', image_url: u }
      : { type: 'image_url', image_url: { url: u } };
    const textPart = { type: 'text', text: textPrompt };
    return imageFirst ? [part, textPart] : [textPart, part];
  }

  async function callOpenAI(useImage, tokenField, imageMode, opts) {
    opts = opts || {};
    if (isResponses) {
      let input = textPrompt;
      if (useImage && imageUrl) {
        input = [{
          role: 'user',
          content: [
            { type: 'input_text', text: textPrompt },
            { type: 'input_image', image_url: imageUrl }
          ]
        }];
      }
      return send({ model: model, input: input, max_output_tokens: 1200 }, { 'Authorization': 'Bearer ' + key });
    }
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    if (!opts.minimal) {
      baseMessages.forEach(function (m) { messages.push({ role: m.role, content: m.content }); });
    }
    messages.push({ role: 'user', content: openAIContent(useImage, imageMode, opts.imageFirst) });
    const body = { model: model, messages: messages, stream: false };
    if (opts.temperature !== false) body.temperature = 0.9;
    body[tokenField || 'max_tokens'] = 1200;
    return send(body, { 'Authorization': 'Bearer ' + key });
  }

  async function callAnthropic(useImage) {
    const messages = baseMessages.map(function (m) {
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
    });
    let content = textPrompt;
    if (useImage && imageUrl) {
      const parts = [{ type: 'text', text: textPrompt }];
      const d = peekDataUrl(imageUrl);
      if (d) {
        parts.push({ type: 'image', source: { type: 'base64', media_type: d.mime, data: d.data } });
      } else if (/^https?:\/\//i.test(imageUrl)) {
        parts.push({ type: 'image', source: { type: 'url', url: imageUrl } });
      }
      content = parts;
    }
    messages.push({ role: 'user', content: content });
    const body = { model: model, max_tokens: 1200, temperature: 0.9, messages: messages };
    if (system) body.system = system;
    return send(body, {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Authorization': 'Bearer ' + key
    });
  }

  async function callGemini(useImage) {
    const contents = baseMessages.map(function (m) {
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
    });
    const parts = [{ text: textPrompt }];
    if (useImage && imageUrl) {
      let d = peekDataUrl(imageUrl);
      if (!d && /^https?:\/\//i.test(imageUrl)) {
        try {
          const ir = await fetch(imageUrl);
          if (ir.ok) {
            d = {
              mime: ir.headers.get('content-type') || 'image/jpeg',
              data: peekBase64(await ir.arrayBuffer())
            };
          }
        } catch (e) {}
      }
      if (d) parts.push({ inlineData: { mimeType: d.mime, data: d.data } });
    }
    contents.push({ role: 'user', parts: parts });
    const body = { contents: contents, generationConfig: { temperature: 0.9, maxOutputTokens: 1200 } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return send(body, { 'x-goog-api-key': key, 'Authorization': 'Bearer ' + key });
  }

  let r;
  if (provider === 'anthropic') {
    r = await callAnthropic(!!imageUrl);
  } else if (provider === 'gemini') {
    r = await callGemini(!!imageUrl);
  } else {
    r = await callOpenAI(!!imageUrl, 'max_tokens', 'object', { imageFirst: true });
    // 注意：每次重试都是一次新的上游请求，可能重复预扣额度。
    // 只有确认是格式/参数不兼容时才换一种 body；额度不足、Key 错误、模型不存在立即停止。
    if (!r.text && peekErrorRetryable(r.error)) {
      r = await callOpenAI(!!imageUrl, 'max_tokens', 'object', { temperature: false });
    }
    // 有些网关只接受字符串形式的 image_url，换一种格式再试
    if (!r.text && imageUrl && peekErrorRetryable(r.error)) {
      r = await callOpenAI(true, 'max_tokens', 'string', { temperature: false });
    }
    if (!r.text && imageUrl && peekErrorRetryable(r.error)) {
      r = await callOpenAI(true, 'max_tokens', 'raw', { temperature: false });
    }
    // 再退一步：不带历史，只发当前这一条图文，排查中转站对长上下文/多 system 的限制
    if (!r.text && imageUrl && peekErrorRetryable(r.error)) {
      r = await callOpenAI(true, 'max_tokens', 'object', { temperature: false, minimal: true, imageFirst: true });
    }
    // 新模型只接受 max_completion_tokens 时再试
    if (!r.text && peekErrorRetryable(r.error) && /max_tokens|max_completion_tokens|unsupported|invalid|reasoning|temperature/i.test(r.error || '')) {
      r = await callOpenAI(!!imageUrl, 'max_completion_tokens', 'object', { temperature: false });
    }
  }
  return { text: r.text ? String(r.text).trim() : '', error: r.error || '' };
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
  // 小红书会把 CDN 图片再包一层：https://ci.xiaohongshu.com/http://sns-webpic...
  try {
    const nested = u.match(/^https?:\/\/[^/]+\/(.+)$/i);
    if (nested) {
      let inner = nested[1];
      try { inner = decodeURIComponent(inner); } catch (e) {}
      if (/^https?:\/\//i.test(inner)) u = inner;
    }
  } catch (e) {}
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
      const out = Object.assign({ url: u.href, via: 'jina' }, data);
      // 小红书正文能抓到、但封面常常被 Jina 的 markdown 过滤掉。再要一份 HTML，
      // 从 og:image / imageList 里补封面，避免卡片只剩红底白字。
      if ((!out.images || !out.images.length) && /xiaohongshu|xhslink/i.test(u.hostname)) {
        try {
          const jh = await fetchTextWithTimeout('https://r.jina.ai/' + u.href, {
            'User-Agent': mobileUA,
            'X-Return-Format': 'html',
            'Accept': 'text/html, application/xhtml+xml, */*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9'
          }, 15000);
          if (jh && jh.text) {
            const hd = parseLinkPage(jh.text);
            if (hd.images && hd.images.length) out.images = hd.images.slice(0, 6);
            if (!out.title && hd.title) out.title = hd.title;
            if (!out.desc && hd.desc) out.desc = hd.desc;
          }
        } catch (e) {}
      }
      return out;
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

// ===== 账号 / 设备会话 / 导入卡密 =====
// 复用同一份 KV/D1：绑定了 D1 就写 D1 的 kv 表，否则回退 KV。
const ACC_SESSION_TTL = 30 * 24 * 60 * 60;
const ACC_MAX_DEVICES = 3;
const ACC_PBKDF2_ITER = 30000;
const ACC_TOKEN_PREFIX = 'acct:tok:';
const ACC_SESS_PREFIX = 'acct:sess:';
const ACC_USER_PREFIX = 'acct:user:';

function accNormName(v) {
  return String(v == null ? '' : v).trim();
}
function accLowerName(v) {
  return accNormName(v).toLowerCase();
}
function accUserKey(name) {
  return ACC_USER_PREFIX + accLowerName(name);
}
function accSessKey(name) {
  return ACC_SESS_PREFIX + accLowerName(name);
}
function accB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function accUnb64(str) {
  const bin = atob(String(str || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function accRandomHex(bytes) {
  const b = new Uint8Array(bytes || 16);
  crypto.getRandomValues(b);
  return Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
}
async function accHash(password, saltB64) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: accUnb64(saltB64),
    iterations: ACC_PBKDF2_ITER,
    hash: 'SHA-256'
  }, key, 256);
  return accB64(bits);
}
function accCleanSessions(list) {
  const now = Date.now();
  return (Array.isArray(list) ? list : []).filter(function (s) {
    return s && s.token && (!s.exp || Number(s.exp) > now);
  });
}
function accPublicSessions(list, currentSid) {
  return (Array.isArray(list) ? list : []).map(function (s) {
    return {
      sid: s.sid,
      deviceId: s.deviceId || '',
      deviceName: s.deviceName || '未知设备',
      at: s.at || 0,
      lastSeen: s.lastSeen || s.at || 0,
      current: !!currentSid && s.sid === currentSid
    };
  }).sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });
}
async function accReadUser(env, name) {
  const raw = await kv(env).get(accUserKey(name));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
async function accReadSessions(env, name) {
  const raw = await kv(env).get(accSessKey(name));
  if (!raw) return [];
  try { return accCleanSessions(JSON.parse(raw)); } catch (e) { return []; }
}
async function accSaveSessions(env, name, list) {
  await kv(env).put(accSessKey(name), JSON.stringify(accCleanSessions(list)));
}
async function accDropSession(env, name, sess) {
  if (!sess) return;
  try { await kv(env).delete(ACC_TOKEN_PREFIX + sess.token); } catch (e) {}
}
async function accIssueSession(env, user, body) {
  const now = Date.now();
  const deviceId = String((body && body.deviceId) || '').slice(0, 80) || accRandomHex(8);
  const deviceName = String((body && body.deviceName) || '').slice(0, 80) || '未知设备';
  const ua = String((body && body.ua) || '').slice(0, 300);
  let list = await accReadSessions(env, user.u);
  // 同一设备重新登录：替换旧会话，不占新的设备名额。
  list = list.filter(function (s) { return !(deviceId && s.deviceId === deviceId); });
  const evicted = [];
  // 设备轮流更替：第 4 台登录时自动顶掉最久没活动的一台。
  while (list.length >= ACC_MAX_DEVICES) {
    list.sort(function (a, b) { return (a.lastSeen || a.at || 0) - (b.lastSeen || b.at || 0); });
    const old = list.shift();
    if (old) {
      evicted.push({ deviceName: old.deviceName || '未知设备', deviceId: old.deviceId || '' });
      await accDropSession(env, user.u, old);
    }
  }
  const sid = accRandomHex(6);
  const token = accRandomHex(32);
  const sess = {
    sid: sid,
    token: token,
    deviceId: deviceId,
    deviceName: deviceName,
    ua: ua,
    at: now,
    lastSeen: now,
    exp: now + ACC_SESSION_TTL * 1000
  };
  list.push(sess);
  await accSaveSessions(env, user.u, list);
  await kv(env).put(ACC_TOKEN_PREFIX + token, JSON.stringify({
    u: user.u,
    sid: sid,
    exp: sess.exp
  }), { expirationTtl: ACC_SESSION_TTL });
  return { session: sess, sessions: list, evicted: evicted };
}
async function accAuth(env, token) {
  token = String(token || '').trim();
  if (!token) return null;
  const raw = await kv(env).get(ACC_TOKEN_PREFIX + token);
  if (!raw) return null;
  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) { return null; }
  if (!rec || !rec.u || (rec.exp && Number(rec.exp) <= Date.now())) return null;
  const user = await accReadUser(env, rec.u);
  if (!user) return null;
  const list = await accReadSessions(env, user.u);
  const sess = list.find(function (s) { return s.token === token; });
  if (!sess) return null;
  return { user: user, session: sess, sessions: list, token: token };
}
function accAdminOk(request, env, body) {
  const need = String((env && env.ACCOUNT_ADMIN_TOKEN) || '');
  if (!need) return { ok: false, error: '服务端未配置 ACCOUNT_ADMIN_TOKEN' };
  const got = String(request.headers.get('X-Admin-Token') || (body && body.adminToken) || '');
  if (!got || got.length !== need.length) return { ok: false, error: '管理员密钥错误' };
  let diff = 0;
  for (let i = 0; i < need.length; i++) diff |= got.charCodeAt(i) ^ need.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, error: '管理员密钥错误' };
}
function accValidName(name) {
  return /^[a-zA-Z0-9_\u4e00-\u9fa5.-]{2,24}$/.test(name);
}
function accRole(user) {
  return user && user.role === 'admin' ? 'admin' : 'user';
}
async function accReadPolicy(env) {
  const defaults = { allowUserImport: false, allowRegister: true, allowMarketUpload: true };
  const raw = await kv(env).get('acct:policy');
  if (!raw) return defaults;
  try {
    const p = JSON.parse(raw) || {};
    return {
      allowUserImport: p.allowUserImport === true,
      // 旧策略没有这两个字段时保持「允许」，避免升级后突然关闭注册/集市上传。
      allowRegister: p.allowRegister !== false,
      allowMarketUpload: p.allowMarketUpload !== false
    };
  } catch (e) {
    return defaults;
  }
}
async function accAdminAccess(request, env, body, auth) {
  if (auth && accRole(auth.user) === 'admin') return { ok: true, by: 'role' };
  return accAdminOk(request, env, body);
}
function accCode(prefix, groups) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = String(prefix || 'NANO').toUpperCase();
  for (let g = 0; g < (groups || 3); g++) {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    let part = '';
    for (let i = 0; i < 4; i++) part += alphabet[b[i] % alphabet.length];
    out += '-' + part;
  }
  return out;
}
function accDeviceKey(user, deviceId) {
  return 'acct:dev:' + accLowerName(user.u) + ':' + String(deviceId || '');
}
async function accReadDevice(env, user, deviceId) {
  if (!user || !deviceId) return null;
  const raw = await kv(env).get(accDeviceKey(user, deviceId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function accPublicDevice(dev) {
  if (!dev) return null;
  return {
    deviceId: dev.deviceId || '',
    deviceName: dev.deviceName || '未知设备',
    deviceCode: dev.deviceCode || '',
    activated: dev.activated === true,
    at: dev.at || 0,
    lastSeen: dev.lastSeen || dev.at || 0
  };
}
function accAdminDevice(dev, user) {
  if (!dev) return null;
  return Object.assign(accPublicDevice(dev), {
    username: user ? user.u : '',
    activationCode: dev.activationCode || '',
    activationAt: dev.activationAt || 0
  });
}
async function accReadDeviceByCode(env, code) {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!c) return null;
  const raw = await kv(env).get('acct:devcode:' + c);
  if (!raw) return null;
  try {
    const idx = JSON.parse(raw);
    const user = await accReadUser(env, idx.u);
    if (!user) return null;
    const dev = await accReadDevice(env, user, idx.deviceId);
    return dev ? { user, dev, code: c } : null;
  } catch (e) { return null; }
}
async function accNewActivationCode(env, user, deviceId) {
  for (let i = 0; i < 10; i++) {
    const code = accCode('ACT', 2);
    const exists = await kv(env).get('acct:actcode:' + code);
    if (!exists) {
      await kv(env).put('acct:actcode:' + code, JSON.stringify({ u: user.u, deviceId: deviceId }));
      return code;
    }
  }
  return accCode('ACT', 3);
}

async function accEnsureDevice(env, user, deviceId, deviceName) {
  if (!user || !deviceId) return null;
  const now = Date.now();
  let dev = await accReadDevice(env, user, deviceId);
  if (!dev) {
    let deviceCode = accCode('DEV', 2);
    let tries = 0;
    while (tries < 6 && await kv(env).get('acct:devcode:' + deviceCode)) {
      deviceCode = accCode('DEV', 2);
      tries++;
    }
    dev = {
      deviceId: deviceId,
      deviceName: deviceName || '未知设备',
      deviceCode: deviceCode,
      activated: false,
      activationCode: '',
      at: now,
      lastSeen: now
    };
    await kv(env).put(accDeviceKey(user, deviceId), JSON.stringify(dev));
    await kv(env).put('acct:devcode:' + deviceCode, JSON.stringify({ u: user.u, deviceId: deviceId }));
    return dev;
  }
  let changed = false;
  if (deviceName && dev.deviceName !== deviceName) { dev.deviceName = deviceName; changed = true; }
  if (now - Number(dev.lastSeen || 0) > 60 * 60 * 1000) { dev.lastSeen = now; changed = true; }
  if (changed) await kv(env).put(accDeviceKey(user, deviceId), JSON.stringify(dev));
  return dev;
}

async function accHandle(request, env, pathname) {
  if (!pathname.startsWith('/account/') && !pathname.startsWith('/gate/')) return null;
  const method = request.method;
  const body = (method === 'POST') ? await request.json().catch(function () { return {}; }) : {};

  // ---- 注册 ----
  if (pathname === '/account/register' && method === 'POST') {
    const policy = await accReadPolicy(env);
    if (policy.allowRegister === false) return json({ ok: false, error: '注册已关闭，只能登录已有账号' }, 403);
    const name = accNormName(body.username);
    const password = String(body.password || '');
    if (!accValidName(name)) return json({ ok: false, error: '用户名需 2-24 位，可用中英文、数字、下划线、点和横线' }, 400);
    if (password.length < 6 || password.length > 128) return json({ ok: false, error: '密码需 6-128 位' }, 400);
    // 邀请码只存在 Worker（secret / vars），不下发到前端；未配置时使用默认码。
    // 开源/分享 Worker 源码前，删掉这里的默认码，改用 wrangler secret。
    const inviteNeed = String(env.ACCOUNT_REGISTER_CODE || 'NANO-VIP-8899');
    if (inviteNeed && String(body.invite || '') !== inviteNeed) return json({ ok: false, error: '注册邀请码不正确' }, 403);
    if (await accReadUser(env, name)) return json({ ok: false, error: '这个用户名已经被注册' }, 409);
    const salt = accB64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await accHash(password, salt);
    const regDeviceId = String(body.deviceId || '').trim() || accRandomHex(8);
    const user = { u: name, salt: salt, hash: hash, at: Date.now(), role: 'user', lastLoginAt: Date.now(), lastDeviceName: body.deviceName || '' };
    await kv(env).put(accUserKey(name), JSON.stringify(user));
    const dev = await accEnsureDevice(env, user, regDeviceId, body.deviceName);
    const issued = await accIssueSession(env, user, Object.assign({}, body, { deviceId: regDeviceId }));
    return json({
      ok: true,
      token: issued.session.token,
      username: user.u,
      role: accRole(user),
      sid: issued.session.sid,
      sessions: accPublicSessions(issued.sessions, issued.session.sid),
      evicted: issued.evicted,
      device: accPublicDevice(dev),
      needsActivation: true
    });
  }

  // ---- 登录 ----
  if (pathname === '/account/login' && method === 'POST') {
    const name = accNormName(body.username);
    const password = String(body.password || '');
    if (!name || !password) return json({ ok: false, error: '请输入账号和密码' }, 400);
    const user = await accReadUser(env, name);
    if (!user) return json({ ok: false, error: '账号或密码不正确' }, 401);
    const hash = await accHash(password, user.salt);
    if (hash !== user.hash) return json({ ok: false, error: '账号或密码不正确' }, 401);
    if (user.banned === true) return json({ ok: false, error: '该账号已被停用，请联系管理员' }, 403);
    const loginDeviceId = String(body.deviceId || '').trim() || accRandomHex(8);
    user.lastLoginAt = Date.now();
    user.lastDeviceName = body.deviceName || '';
    user.lastDeviceId = loginDeviceId;
    await kv(env).put(accUserKey(user.u), JSON.stringify(user));
    const dev = await accEnsureDevice(env, user, loginDeviceId, body.deviceName);
    const issued = await accIssueSession(env, user, Object.assign({}, body, { deviceId: loginDeviceId }));
    const isAdmin = accRole(user) === 'admin';
    return json({
      ok: true,
      token: issued.session.token,
      username: user.u,
      role: accRole(user),
      sid: issued.session.sid,
      sessions: accPublicSessions(issued.sessions, issued.session.sid),
      evicted: issued.evicted,
      device: accPublicDevice(dev),
      needsActivation: !isAdmin && !(dev && dev.activated === true)
    });
  }

  // ---- 会话列表 / 续期 ----
  if (pathname === '/account/sessions' && (method === 'GET' || method === 'POST')) {
    const token = method === 'GET'
      ? new URL(request.url).searchParams.get('token')
      : body.token;
    const auth = await accAuth(env, token);
    if (!auth) return json({ ok: false, error: '登录已失效，请重新登录' }, 401);
    // 只有查看设备列表时才更新 lastSeen，而且 1 小时内不重复写库，省 D1 写额度。
    const list = await accReadSessions(env, auth.user.u);
    const now = Date.now();
    let changed = false;
    list.forEach(function (s) {
      if (s.sid === auth.session.sid && now - (s.lastSeen || 0) > 60 * 60 * 1000) {
        s.lastSeen = now;
        changed = true;
      }
    });
    if (changed) await accSaveSessions(env, auth.user.u, list);
    const policy = await accReadPolicy(env);
    const deviceId = auth.session.deviceId || '';
    const dev = await accEnsureDevice(env, auth.user, deviceId, auth.session.deviceName);
    const isAdmin = accRole(auth.user) === 'admin';
    return json({
      ok: true,
      username: auth.user.u,
      role: accRole(auth.user),
      sid: auth.session.sid,
      sessions: accPublicSessions(list, auth.session.sid),
      maxDevices: ACC_MAX_DEVICES,
      policy: policy,
      device: accPublicDevice(dev),
      needsActivation: !isAdmin && !(dev && dev.activated === true)
    });
  }

  // ---- 退出当前设备 ----
  // ---- 激活本机：输入管理员生成的激活码 ----
  if (pathname === '/account/activate-device' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: false, error: '请先登录账号' }, 401);
    if (auth.user.banned === true) return json({ ok: false, error: '该账号已被停用' }, 403);
    const deviceId = auth.session.deviceId || '';
    if (!deviceId) return json({ ok: false, error: '本机没有设备标识，请退出后重新登录' }, 400);
    let dev = await accReadDevice(env, auth.user, deviceId);
    if (!dev) dev = await accEnsureDevice(env, auth.user, deviceId, auth.session.deviceName);
    if (dev.activated === true) return json({ ok: true, device: accPublicDevice(dev), needsActivation: false });
    if (!dev.activationCode) {
      return json({ ok: false, error: '本机还没有生成激活码。请把设备码发给管理员，由管理员生成。' }, 403);
    }
    const code = String(body.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!code || code !== String(dev.activationCode || '').toUpperCase()) {
      return json({ ok: false, error: '激活码不正确，请向管理员确认' }, 403);
    }
    dev.activated = true;
    dev.activationAt = Date.now();
    dev.lastSeen = Date.now();
    await kv(env).put(accDeviceKey(auth.user, deviceId), JSON.stringify(dev));
    return json({ ok: true, device: accPublicDevice(dev), needsActivation: false });
  }

  if (pathname === '/account/logout' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: true });
    const list = (await accReadSessions(env, auth.user.u)).filter(function (s) { return s.sid !== auth.session.sid; });
    await accDropSession(env, auth.user.u, auth.session);
    await accSaveSessions(env, auth.user.u, list);
    return json({ ok: true });
  }

  // ---- 下线指定设备 ----
  if (pathname === '/account/logout-device' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: false, error: '登录已失效，请重新登录' }, 401);
    const sid = String(body.sid || '');
    if (!sid) return json({ ok: false, error: '缺少设备 ID' }, 400);
    const target = auth.sessions.find(function (s) { return s.sid === sid; });
    if (!target) return json({ ok: false, error: '设备不存在或已下线' }, 404);
    if (target.sid === auth.session.sid) return json({ ok: false, error: '当前设备不能在这里下线，请用「退出登录」' }, 400);
    const list = auth.sessions.filter(function (s) { return s.sid !== sid; });
    await accDropSession(env, auth.user.u, target);
    await accSaveSessions(env, auth.user.u, list);
    return json({ ok: true, sessions: accPublicSessions(list, auth.session.sid) });
  }

  // ---- 下线其他所有设备 ----
  if (pathname === '/account/logout-others' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: false, error: '登录已失效，请重新登录' }, 401);
    const keep = auth.sessions.find(function (s) { return s.sid === auth.session.sid; });
    for (const s of auth.sessions) {
      if (!keep || s.sid !== keep.sid) await accDropSession(env, auth.user.u, s);
    }
    const list = keep ? [keep] : [];
    await accSaveSessions(env, auth.user.u, list);
    return json({ ok: true, sessions: accPublicSessions(list, auth.session.sid) });
  }

  // ---- 管理员：用管理员密钥把自己的账号升级为管理员 ----
  // ---- 管理员：设备列表 / 生成激活码 / 撤销 ----
  if (pathname === '/account/admin/devices' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const listed = await kv(env).list({ prefix: 'acct:devcode:', limit: 300 });
    const out = [];
    for (const k of (listed.keys || [])) {
      try {
        const idx = JSON.parse(await kv(env).get(k.name) || 'null');
        if (!idx || !idx.u || !idx.deviceId) continue;
        const user = await accReadUser(env, idx.u);
        if (!user) continue;
        const dev = await accReadDevice(env, user, idx.deviceId);
        if (!dev) continue;
        out.push(accAdminDevice(dev, user));
      } catch (e) {}
    }
    out.sort(function (a, b) { return (b.lastSeen || b.at || 0) - (a.lastSeen || a.at || 0); });
    return json({ ok: true, devices: out.slice(0, 200) });
  }

  if (pathname === '/account/admin/device-key' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const hit = await accReadDeviceByCode(env, body.deviceCode);
    if (!hit) return json({ ok: false, error: '没有找到这个设备码，让用户刷新账号页后重试' }, 404);
    let dev = hit.dev;
    let needNew = !dev.activationCode || body.force === true;
    if (!needNew && dev.activationCode) {
      const rawIdx = await kv(env).get('acct:actcode:' + dev.activationCode);
      if (!rawIdx) {
        await kv(env).put('acct:actcode:' + dev.activationCode, JSON.stringify({ u: hit.user.u, deviceId: dev.deviceId }));
      } else {
        try {
          const idx = JSON.parse(rawIdx);
          if (!idx || idx.u !== hit.user.u || idx.deviceId !== dev.deviceId) needNew = true;
        } catch (e) { needNew = true; }
      }
    }
    if (needNew) {
      if (dev.activationCode) await kv(env).delete('acct:actcode:' + dev.activationCode);
      dev.activationCode = await accNewActivationCode(env, hit.user, dev.deviceId);
      dev.activated = false;
      dev.activationAt = 0;
      await kv(env).put(accDeviceKey(hit.user, dev.deviceId), JSON.stringify(dev));
    }
    return json({ ok: true, username: hit.user.u, device: accAdminDevice(dev, hit.user) });
  }

  if (pathname === '/account/admin/device-revoke' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const hit = await accReadDeviceByCode(env, body.deviceCode);
    if (!hit) return json({ ok: false, error: '设备不存在' }, 404);
    hit.dev.activated = false;
    hit.dev.activationAt = 0;
    await kv(env).put(accDeviceKey(hit.user, hit.dev.deviceId), JSON.stringify(hit.dev));
    return json({ ok: true, username: hit.user.u, device: accAdminDevice(hit.dev, hit.user) });
  }

  // ---- 管理员：用户列表 / 踢下线 / 封禁 ----
  if (pathname === '/account/admin/users' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const listed = await kv(env).list({ prefix: 'acct:user:', limit: 1000 });
    const out = [];
    for (const k of (listed.keys || [])) {
      try {
        const user = JSON.parse(await kv(env).get(k.name) || 'null');
        if (!user || !user.u) continue;
        const sessions = await accReadSessions(env, user.u);
        out.push({
          username: user.u,
          role: accRole(user),
          banned: user.banned === true,
          at: user.at || 0,
          lastLoginAt: user.lastLoginAt || 0,
          lastDeviceName: user.lastDeviceName || '',
          sessions: sessions.length
        });
      } catch (e) {}
    }
    out.sort(function (a, b) { return (b.lastLoginAt || b.at || 0) - (a.lastLoginAt || a.at || 0); });
    return json({ ok: true, users: out.slice(0, 200) });
  }

  if (pathname === '/account/admin/kick' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const user = await accReadUser(env, body.username);
    if (!user) return json({ ok: false, error: '账号不存在' }, 404);
    const sessions = await accReadSessions(env, user.u);
    for (const s of sessions) await accDropSession(env, user.u, s);
    await kv(env).delete(accSessKey(user.u));
    return json({ ok: true, username: user.u, removed: sessions.length });
  }

  if (pathname === '/account/admin/ban' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const user = await accReadUser(env, body.username);
    if (!user) return json({ ok: false, error: '账号不存在' }, 404);
    user.banned = body.banned === true;
    await kv(env).put(accUserKey(user.u), JSON.stringify(user));
    if (user.banned) {
      const sessions = await accReadSessions(env, user.u);
      for (const s of sessions) await accDropSession(env, user.u, s);
      await kv(env).delete(accSessKey(user.u));
    }
    return json({ ok: true, username: user.u, banned: user.banned });
  }

  // ---- 管理员：退出管理员模式 ----
  if (pathname === '/account/admin-exit' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: false, error: '请先登录账号' }, 401);
    const user = auth.user;
    if (accRole(user) === 'admin') {
      user.role = 'user';
      await kv(env).put(accUserKey(user.u), JSON.stringify(user));
    }
    return json({ ok: true, username: user.u, role: 'user' });
  }

  if (pathname === '/account/admin-claim' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: false, error: '请先登录账号' }, 401);
    const admin = accAdminOk(request, env, body);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const user = auth.user;
    user.role = 'admin';
    await kv(env).put(accUserKey(user.u), JSON.stringify(user));
    return json({ ok: true, username: user.u, role: 'admin' });
  }

  // ---- 管理员：设置导入 / 注册 / 集市上传策略 ----
  if (pathname === '/account/admin/policy' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const cur = await accReadPolicy(env);
    const policy = {
      allowUserImport: typeof body.allowUserImport === 'boolean' ? body.allowUserImport : cur.allowUserImport,
      allowRegister: typeof body.allowRegister === 'boolean' ? body.allowRegister : cur.allowRegister,
      allowMarketUpload: typeof body.allowMarketUpload === 'boolean' ? body.allowMarketUpload : cur.allowMarketUpload,
      updatedAt: Date.now()
    };
    await kv(env).put('acct:policy', JSON.stringify(policy));
    return json({ ok: true, policy: policy });
  }

  // ---- 管理员：删除账号（忘记密码时重置）----
  if (pathname === '/account/admin-reset' && method === 'POST') {
    const auth = await accAuth(env, body.token);
    const admin = await accAdminAccess(request, env, body, auth);
    if (!admin.ok) return json({ ok: false, error: admin.error }, 403);
    const name = accNormName(body.username);
    if (!name) return json({ ok: false, error: '缺少账号名' }, 400);
    const user = await accReadUser(env, name);
    if (!user) return json({ ok: false, error: '账号不存在' }, 404);
    const sessions = await accReadSessions(env, user.u);
    for (const s of sessions) await accDropSession(env, user.u, s);
    const devPrefix = 'acct:dev:' + accLowerName(user.u) + ':';
    try {
      const devList = await kv(env).list({ prefix: devPrefix, limit: 1000 });
      for (const d of (devList.keys || [])) {
        try {
          const dv = JSON.parse(await kv(env).get(d.name) || 'null');
          if (dv && dv.deviceCode) await kv(env).delete('acct:devcode:' + dv.deviceCode);
          if (dv && dv.activationCode) await kv(env).delete('acct:actcode:' + dv.activationCode);
        } catch (e) {}
        await kv(env).delete(d.name);
      }
    } catch (e) {}
    await kv(env).delete(accSessKey(user.u));
    await kv(env).delete(accUserKey(user.u));
    return json({ ok: true, username: user.u, removedSessions: sessions.length });
  }


  // ---- 导入权限检查：默认仅管理员可导入；管理员可一键放开给所有登录用户 ----
  if ((pathname === '/gate/check' || pathname === '/gate/import') && method === 'POST') {
    const auth = await accAuth(env, body.token);
    if (!auth) return json({ ok: false, error: '请先登录账号' }, 401);
    if (auth.user.banned === true) {
      return json({ ok: false, error: '该账号已被停用', code: 'ACCOUNT_BANNED' }, 403);
    }
    const deviceId = auth.session.deviceId || '';
    let dev = await accReadDevice(env, auth.user, deviceId);
    const role = accRole(auth.user);
    // 仅当客户端明确要求时校验设备激活（PNG 导入）。TXT / DOC / DOCX / JSON 不强制激活。
    const needActivation = body.needActivation === true;
    if (role !== 'admin' && needActivation && (!dev || dev.activated !== true)) {
      return json({
        ok: false,
        error: '本机还没有获得 PNG 导入授权。请把设备码发给管理员，拿到激活码后在「账号与设备」输入。',
        code: 'DEVICE_LOCKED',
        needsActivation: true,
        device: accPublicDevice(dev)
      }, 403);
    }
    const policy = await accReadPolicy(env);
    const allowed = role === 'admin' || policy.allowUserImport === true;
    if (!allowed) {
      return json({
        ok: false,
        error: '当前账号没有导入权限。角色卡、世界书、规则等导入仅限管理员。',
        code: 'IMPORT_FORBIDDEN',
        role: role,
        policy: policy
      }, 403);
    }
    return json({
      ok: true,
      role: role,
      policy: policy,
      mode: role === 'admin' ? 'admin' : 'policy',
      needsActivation: role !== 'admin' && (!dev || dev.activated !== true),
      device: accPublicDevice(dev)
    });
  }

  return json({ ok: false, error: 'not found' }, 404);
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

    // 账号、设备会话与导入卡密
    const accResp = await accHandle(request, env, pathname);
    if (accResp) return accResp;

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

    // 图片代理：GET /image?url=https://sns-webpic-qc.xhscdn.com/...
    // 小红书/抖音图片有防盗链，直接交给模型中转站下载会 404/403，整轮请求变 500。
    if (pathname === '/image' && request.method === 'GET') {
      if (!autoOk(request, env, null)) return json({ ok: false, error: 'unauthorized' }, 401);
      let target = '';
      try { target = new URL(request.url).searchParams.get('url') || ''; } catch (e) {}
      let iu = null;
      try {
        iu = new URL(target);
        if (iu.protocol === 'http:') iu.protocol = 'https:';
      } catch (e) {}
      if (!iu || iu.protocol !== 'https:') return json({ ok: false, error: 'bad url' }, 400);
      const host = String(iu.hostname || '').toLowerCase();
      const allowed = /(^|\.)(xhscdn\.com|xiaohongshu\.com|douyinpic\.com|byteimg\.com|iesdouyin\.com|alicdn\.com|taobao\.com|tmall\.com|hdslb\.com|bilibili\.com|sinaimg\.cn|weibo\.cn)$/i.test(host);
      if (!allowed) return json({ ok: false, error: 'host not allowed' }, 403);
      const ref = /xiaohongshu|xhscdn/i.test(host) ? 'https://www.xiaohongshu.com/' :
        (/douyin|byteimg/i.test(host) ? 'https://www.douyin.com/' :
          (/alicdn|taobao|tmall/i.test(host) ? 'https://www.taobao.com/' : 'https://www.bilibili.com/'));
      let resp = null;
      try {
        resp = await fetch(iu.href, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Referer': ref
          }
        });
      } catch (e) {}
      if (!resp || !resp.ok) return json({ ok: false, error: 'download failed' }, 502);
      // 跟随跳转后再确认一次，避免被 302 到非白名单站点。
      try {
        const finalHost = String(new URL(resp.url || iu.href).hostname || '').toLowerCase();
        if (!/(^|\.)(xhscdn\.com|xiaohongshu\.com|douyinpic\.com|byteimg\.com|iesdouyin\.com|alicdn\.com|taobao\.com|tmall\.com|hdslb\.com|bilibili\.com|sinaimg\.cn|weibo\.cn)$/i.test(finalHost)) {
          return json({ ok: false, error: 'redirect host not allowed' }, 403);
        }
      } catch (e) {}
      const buf = await resp.arrayBuffer();
      if (!buf || buf.byteLength > 3 * 1024 * 1024) return json({ ok: false, error: 'too large' }, 413);
      return new Response(buf, {
        headers: Object.assign({}, CORS, {
          'Content-Type': resp.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400'
        })
      });
    }

    // 免费翻译：GET/POST /translate?text=...&to=zh-CN
    // 走 Cloudflare 出口请求免费接口，绕开浏览器 CORS／部分地区被墙；不消耗模型 API。
    if (pathname === '/translate' && (request.method === 'GET' || request.method === 'POST')) {
      if (!autoOk(request, env, null)) return json({ ok: false, error: 'unauthorized' }, 401);
      let text = '', to = 'zh-CN';
      try {
        if (request.method === 'GET') {
          const u = new URL(request.url);
          text = u.searchParams.get('text') || u.searchParams.get('q') || '';
          to = u.searchParams.get('to') || 'zh-CN';
        } else {
          const b = await request.json().catch(function () { return {}; });
          text = b.text || b.q || '';
          to = b.to || 'zh-CN';
        }
      } catch (e) {}
      text = String(text || '').slice(0, 4000);
      if (!text.trim()) return json({ ok: false, error: 'empty' }, 400);
      const target = /^zh/i.test(String(to)) ? 'zh-CN' : (String(to).replace(/[^a-zA-Z-]/g, '').slice(0, 20) || 'zh-CN');
      let out = '';
      try {
        const gu = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
          encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
        const gr = await fetch(gu, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (gr && gr.ok) {
          const gj = await gr.json();
          if (Array.isArray(gj) && Array.isArray(gj[0])) {
            out = gj[0].map(function (x) { return (x && x[0]) || ''; }).join('').trim();
          }
        }
      } catch (e) {}
      if (!out) {
        try {
          const src = /[\u3040-\u30ff]/.test(text) ? 'ja' :
            (/[\uac00-\ud7af]/.test(text) ? 'ko' :
              (/[\u0400-\u04ff]/.test(text) ? 'ru' :
                (/[\u0600-\u06ff]/.test(text) ? 'ar' : 'en')));
          const mu = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.slice(0, 500)) +
            '&langpair=' + encodeURIComponent(src + '|' + target);
          const mr = await fetch(mu, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (mr && mr.ok) {
            const mj = await mr.json();
            if (mj && !mj.quotaFinished && Number(mj.responseStatus) === 200) {
              out = String((mj.responseData && mj.responseData.translatedText) || '').trim();
            }
          }
        } catch (e) {}
      }
      return json({ ok: !!out, text: out, via: 'worker' });
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
      const ids = [];
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
        ids.push(id);
        count++;
      }
      return json({ ok: true, count: count, ids: ids });
    }
    // 取消预约：番茄钟暂停/重置/提前结束时撤掉还没触发的后台提醒
    if (pathname === '/schedule/cancel' && request.method === 'POST') {
      if (!tokenOk(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      const body = await request.json().catch(function () { return {}; });
      const list = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
      let count = 0;
      for (const id of list) {
        try { await kv(env).delete(String(id)); } catch (e) {}
        await removeJobId(env, id);
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

    // 图片转存代理：生图接口返回的临时 URL 经常因为 CORS / 国内网络而无法在浏览器里
    // 转成 base64，几个小时后 URL 过期就变成问号。这里由 Worker 代取图片并回传，
    // 手机只要能连上 Worker 就能把图片永久存进 IndexedDB。
    if (pathname === '/img' && request.method === 'GET') {
      // 图片代理只需要一个非空令牌做最基础的防滥用，不参与私用/公用模式的鉴权，
      // 否则私用 Worker 的 PEEK_TOKEN 和 App 里的 pk 不同，图片就永远转存不了。
      if (String(peekTokenValue(request, {}) || '').length < 8) {
        return new Response('forbidden', { status: 403, headers: CORS });
      }
      let target = '';
      try { target = new URL(request.url).searchParams.get('url') || ''; } catch (e) {}
      let u = null;
      try { u = new URL(target); } catch (e) {}
      if (!u || !/^https?:$/i.test(u.protocol) || u.username || u.password) {
        return new Response('bad url', { status: 400, headers: CORS });
      }
      const host = String(u.hostname || '').toLowerCase();
      const blocked = !host
        || host === 'localhost' || host === '::1' || /\.local$/i.test(host)
        || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
        || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        || host.indexOf(':') !== -1;
      if (blocked) return new Response('blocked', { status: 400, headers: CORS });
      const withTimeout = async function (url) {
        const ctrl = new AbortController();
        const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 15000);
        try {
          return await fetch(url, {
            signal: ctrl.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NanoImageProxy/1.0)', 'Accept': 'image/*' }
          });
        } finally { clearTimeout(timer); }
      };
      const candidates = [
        'https://wsrv.nl/?url=' + encodeURIComponent(u.href) + '&w=1400&output=jpg&q=85',
        u.href
      ];
      try {
        for (const src of candidates) {
          const r = await withTimeout(src);
          if (!r || !r.ok) continue;
          const ct = String(r.headers.get('content-type') || '').toLowerCase();
          if (ct && !/^image\//.test(ct)) continue;
          const len = Number(r.headers.get('content-length') || 0);
          if (len && len > 12 * 1024 * 1024) continue;
          const buf = await r.arrayBuffer();
          if (!buf || buf.byteLength < 64 || buf.byteLength > 12 * 1024 * 1024) continue;
          return new Response(buf, {
            headers: Object.assign({}, CORS, {
              'Content-Type': ct || 'image/jpeg',
              'Cache-Control': 'public, max-age=86400'
            })
          });
        }
      } catch (e) {}
      return new Response('fetch failed', { status: 502, headers: CORS });
    }

    // 5) 屏幕速聊（iOS 快捷指令）：截图/文本 → 服务端用保存的 key 调模型 → 返回角色回复，并暂存轮次供 App 合并
    // GET /peek 或 /peek/health：浏览器里直接看配置，避免「能打开根地址」被误认为 /peek 正常。
    if ((pathname === '/peek' || pathname === '/peek/health') && request.method === 'GET') {
      const publicMode = peekPublic(env);
      return json({
        ok: true,
        service: 'nano-peek',
        build: '2026-10-29-wafua',
        method: 'POST /peek',
        publicMode: publicMode,
        tokenConfigured: !!env.PEEK_TOKEN,
        tokenRequired: !publicMode && !!env.PEEK_TOKEN,
        kvBound: !!env.PUSH_KV,
        d1Bound: !!(env.DB || env.nano_db),
        store: (env.DB || env.nano_db) ? 'd1' : (env.PUSH_KV ? 'kv' : 'none'),
        envApiConfigured: !!(env.PEEK_API_URL && env.PEEK_API_KEY && env.PEEK_MODEL),
        note: publicMode
          ? '公用模式：快捷指令 token 至少 8 位；模型 API 由 Nano 同步，没同步会 502。'
          : '私用模式：快捷指令 token 必须和 Worker 的 PEEK_TOKEN 完全一致。'
      });
    }
    if (pathname === '/peek' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) {
        return json({
          ok: false, error: 'unauthorized',
          reply: peekPublic(env)
            ? '令牌太短或为空：请从窥屏页重新复制令牌 / JSON。'
            : '令牌不一致：请把 Worker 的 PEEK_TOKEN 和窥屏页里生成的令牌改成同一个。'
        }, 401);
      }
      const token = peekTokenValue(request, body);
      const requestedChatId = String(body.chatId || '').trim();
      // 速聊也要限定到「哪个站点的哪台设备/哪个用户」，否则旧 Nano 也会收到纳米的窥屏回复。
      // 公用模式再叠加令牌哈希，避免同一个站点上不同用户互相串消息。
      let owner = {};
      try {
        const rawOwner = await kv(env).get(peekOwnerKey(env, token, requestedChatId || 'latest'));
        if (rawOwner) owner = JSON.parse(rawOwner) || {};
      } catch (e) { owner = {}; }
      let ownerLatest = {};
      if (!owner.appId && requestedChatId && requestedChatId !== 'latest') {
        try {
          const rawOwner2 = await kv(env).get(peekOwnerKey(env, token, 'latest'));
          if (rawOwner2) ownerLatest = JSON.parse(rawOwner2) || {};
        } catch (e) {}
      }
      // 快捷指令可以不传 appId。依次用：请求体 → 该聊天的 owner → 最近一次同步的 owner
      // → 令牌索引。绝不能直接落到 legacy，否则同步在 app_xxx 分区里的 API 永远读不到。
      let realAppId = cleanAppId(body.appId || owner.appId || ownerLatest.appId || 'legacy');
      let indexedApp = '';
      try { indexedApp = await peekResolveApp(env, token); } catch (e) {}
      if (!body.appId && !owner.appId && !ownerLatest.appId && indexedApp) realAppId = indexedApp;
      // 旧快捷指令里可能还写着换域名前的 appId：该分区没有 API、令牌索引里却有，
      // 这时自动切到索引分区，避免「明明同步过模型却一直报没有模型」。
      if (indexedApp && indexedApp !== realAppId) {
        try {
          const ownApi = await kv(env).get(peekBase(peekScope(env, realAppId, token), 'api:latest'));
          if (!ownApi) {
            const idxApi = await kv(env).get(peekBase(peekScope(env, indexedApp, token), 'api:latest'));
            if (idxApi) realAppId = indexedApp;
          }
        } catch (e) {}
      }
      if (ownerLatest.appId) owner = Object.assign({}, ownerLatest, owner);
      const appId = peekScope(env, realAppId, token);
      // 快捷指令可以不传 chatId：App 每次打开聊天 / 保存窥屏配置都会把最近角色写进 chat:latest。
      let chatId = requestedChatId;
      if (!chatId) {
        try { chatId = String(await kv(env).get(peekBase(appId, 'chat:latest')) || '').trim(); } catch (e) {}
      }
      if (!chatId) chatId = 'default';
      if (!owner.appId) {
        try {
          const rawOwner2 = await kv(env).get(peekOwnerKey(env, token, chatId));
          if (rawOwner2) owner = JSON.parse(rawOwner2) || {};
        } catch (e) {}
      }
      if (!owner.appId && peekPublic(env)) {
        // 兼容旧键：老快捷指令 / 老页面没有写新 owner 键
        try {
          const rawOld = await kv(env).get('peek2:owner:' + chatId);
          if (rawOld) owner = JSON.parse(rawOld) || {};
        } catch (e) {}
      }
      // 优先用 App 当前选中的角色人设（含完整规则 / 最近上下文），避免快捷指令里
      // 旧的内置 system 覆盖掉人设；只有没同步过时才回退到请求体里的 system。
      let system = '';
      try {
        system = (await kv(env).get(peekBase(appId, 'persona:' + chatId)))
          || (await kv(env).get(peekBase(appId, 'persona:latest')))
          || '';
      } catch (e) {}
      if (!system) system = String(body.system || '');
      // 用最近一次同步的钱包余额覆盖/补充，避免角色凭空说用户没钱。
      try {
        const wDev = cleanDeviceId((owner && owner.deviceId) || body.deviceId || deviceId);
        let wUser = cleanUserId((owner && owner.userId) || body.userId || userId);
        if (!wUser || wUser === 'default') {
          const rawAct = await kv(env).get(autoActiveKey(realAppId, wDev));
          if (rawAct) { try { const a = JSON.parse(rawAct); if (a && a.userId) wUser = cleanUserId(a.userId); } catch (e) {} }
        }
        const rawW = await kv(env).get(autoKey('config', realAppId, wDev, wUser));
        if (rawW) {
          const pcfg = JSON.parse(rawW);
          if (pcfg && typeof pcfg.walletBalance === 'number') {
            system += '\n【用户真实经济状况】用户钱包当前余额约 ¥' + Number(pcfg.walletBalance).toFixed(2) +
              '。这是系统里的真实数据，不要凭空说用户没钱、欠钱、吃不起饭或暗示用户很穷。\n';
          }
        }
      } catch (e) {}
      const charName = peekCharName(system);
      // 再兜底：从 /auto/config 同步的角色卡里找这条聊天的人设
      // 公用模式跳过：那是站点/设备维度的数据，不能把站长的角色卡给陌生人。
      if (!system && !peekPublic(env)) {
        try {
          const deviceId = cleanDeviceId((owner && owner.deviceId) || body.deviceId);
          let userId = cleanUserId((owner && owner.userId) || body.userId);
          if (!userId || userId === 'default') {
            const rawActive = await kv(env).get(autoActiveKey(realAppId, deviceId));
            if (rawActive) {
              const active = JSON.parse(rawActive);
              if (active && active.userId) userId = cleanUserId(active.userId);
            }
          }
          const rawCfg = await kv(env).get(autoKey('config', realAppId, deviceId, userId));
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
      // 兼容不同版本的快捷指令：image / screenshot / image_url / imageData 都可能出现，
      // 也兼容对象形式和 images 数组，避免「发了图但 Worker 收到空字符串」。
      function peekImageInput(v) {
        if (!v) return '';
        if (Array.isArray(v)) return peekImageInput(v[0]);
        if (typeof v === 'object') return peekImageInput(v.data || v.dataUrl || v.base64 || v.url || v.image || '');
        return String(v).trim();
      }
      const image = peekImageInput(body.image || body.screenshot || body.image_url || body.imageData || body.images);
      if (!text && !image) {
        return json({ ok: false, error: 'empty', reply: '没有收到屏幕内容：请在快捷指令里传入截图或文字。' }, 400);
      }
      const history = await peekTurns(env, chatId, appId);
      const apiCfg = await peekApiConfig(env, appId, chatId, body, owner, realAppId);
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
      let peekErr = '';
      try {
        const out = await peekModel(env, system, text, image, history, apiCfg, context);
        if (out) {
          reply = out.text || null;
          peekErr = out.error || '';
          // 上游偶尔把限流/额度错误当成正文返回；不要把这句当成角色说的话。
          if (reply && /(余额不足|额度不足|欠费|insufficient.?quota|exceeded.*quota|API.*(余额|额度)|account.*balance)/i.test(reply)) {
            peekErr = reply;
            reply = null;
          }
        }
      } catch (e) { peekErr = String((e && e.message) || e || ''); }
      if (!reply) {
        const errDetail = String(peekErr || '').replace(/\s+/g, ' ').slice(0, 180);
        const upstreamLimit = /quota|insufficient|balance|余额|额度|402|429|rate.?limit|too many/i.test(errDetail);
        // 403 + HTML 基本不是模型回复，而是中转站 / Cloudflare 的风控或地区拦截页。
        // 这时提示“模型不支持图片”会误导，直接指出是上游站点拦截。
        const upstreamBlockedPage = /403/.test(errDetail) && /<!doctype|<html|cloudflare|attention required|access denied|just a moment/i.test(errDetail);
        // 区分「没找到你这个令牌分区的 API」和「API 找到了但模型没返回」，不要再混成一句话。
        if (!apiCfg) {
          return json({
            ok: false,
            error: 'no_api',
            reply: peekPublic(env)
              ? '没有在这个令牌分区找到模型 API。请先在自己的 Nano 里配置主 API，然后在窥屏页选择角色、填好服务端地址并点一次「保存配置」，让页面把当前主 API 同步到当前 pk 的分区。'
              : '服务端还没有当前主 API：请在 Nano 的 API 页配置好地址 / Key / 模型，并打开一次聊天或窥屏设置页完成同步。'
          }, 502);
        }
        return json({
          ok: false,
          error: 'model',
          reply: peekPublic(env)
            ? (upstreamBlockedPage
              ? '这次请求被上游 API 站点拦截了：HTTP 403 返回的是网页 / Cloudflare 风控页，不是模型回复。常见原因是中转站开启了 Cloudflare 防护、Bot Fight Mode 或地区限制，也可能是 Key / 余额异常。请到 API 站查看日志，或在电脑上用 curl 请求同一个地址测试；也可以换一个允许 Cloudflare Worker 访问的接口。'
              : (upstreamLimit
                ? '这次识图接口没有返回内容（上游限流/额度或临时错误）。稍后再试，或检查当前主 API 的额度。'
                : ('这次识图接口没有返回内容' + (errDetail ? '（上游：' + errDetail + '）' : '') + '。请检查当前主 API 的模型是否支持图片输入、接口地址和 Key 是否对应。')))
            : (upstreamBlockedPage
              ? '当前主 API 被上游站点拦截了（HTTP 403 返回网页 / Cloudflare 风控页，不是模型回复）。请检查中转站的 Cloudflare 防护 / 地区限制 / Key 与余额，或换一个允许 Worker 访问的接口。'
              : (upstreamLimit
                ? '当前主 API 这次没有返回内容（上游限流/额度或临时错误）；稍后再试或检查额度。'
                : ('当前主 API 没有返回内容' + (errDetail ? '（上游：' + errDetail + '）' : '') + '：请检查主 API 的模型是否支持识图，以及地址 / Key 是否正确。'))),
          detail: errDetail
        }, 502);
      }
      // 截图也存进这一轮，App 拉取后会把截图和 TA 的评论一起放进私聊。
      // D1 单行上限 2MB（KV 是 25MB），而这里最多会保留 2 张截图：
      // D1 模式下单张压到 480KB，两张 + 文本也远低于 2MB；更大的图仍然会送给模型识别，
      // 只是不在聊天里回显（imageOmitted）。要保留原图请把截图放 R2。
      const MAX_IMAGE_CHARS = (env.DB || env.nano_db) ? 480 * 1024 : 4 * 1024 * 1024;
      const imageStore = (image && image.length <= MAX_IMAGE_CHARS) ? image : '';
      history.push({
        user: text || (image ? '' : '[图片]'),
        char: reply,
        image: imageStore,
        imageOmitted: !!(image && !imageStore),
        ts: Date.now()
      });
      let __imgKeep = 0;
      for (let __i = history.length - 1; __i >= 0; __i--) {
        if (history[__i] && history[__i].image) {
          __imgKeep++;
          if (__imgKeep > 2) delete history[__i].image;
        }
      }
      await peekSave(env, chatId, history, appId);
      // 只推给这条聊天所属的 App / 设备 / 用户；找不到归属就不广播，避免串到别的 Nano。
      try {
        const targetUser = owner.userId || body.userId || '';
        const targetDevice = owner.deviceId || body.deviceId || '';
        const subs = (targetUser || targetDevice)
          ? await getSubs(env, targetUser || null, targetDevice || null, realAppId)
          : [];
        if (subs.length) {
          await pushAll(subs, { title: charName || '窥屏', body: String(reply).slice(0, 120), target: 'chat:' + chatId, tag: 'peek-' + chatId, appId: realAppId }, env);
        }
      } catch (e) {}
      return json({
        ok: true,
        // 快捷指令的「显示提醒」直接取 reply，所以在前面带上角色名；聊天里仍用干净的 text。
        reply: charName ? ('「' + charName + '」\n' + reply) : reply,
        text: reply,
        name: charName
      });
    }

    // 5.5) 人设同步：App 切换人设 / 发消息时上传当前角色人设，快捷指令就无需内置人设
    if (pathname === '/peek/persona' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const system = String(body.system || '').trim();
      if (!system) return json({ ok: false, error: 'empty' }, 400);
      const chatId = String(body.chatId || 'latest');
      const token = peekTokenValue(request, body);
      const realAppId = cleanAppId(body.appId);
      const appId = peekScope(env, realAppId, token);
      await peekRememberApp(env, token, realAppId);
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
        const ownerRecord = JSON.stringify({
          appId: realAppId,
          deviceId: cleanDeviceId(body.deviceId),
          userId: cleanUserId(body.userId),
          at: Date.now()
        });
        await kv(env).put(peekOwnerKey(env, token, chatId), ownerRecord, { expirationTtl: ttl });
        // 记住这个令牌最近一次打开的角色（快捷指令不传 chatId 时使用）
        if (chatId && chatId !== 'latest') {
          await kv(env).put(peekBase(appId, 'chat:latest'), chatId, { expirationTtl: ttl });
        }
        await kv(env).put(peekOwnerKey(env, token, 'latest'), ownerRecord, { expirationTtl: ttl });
      } catch (e) {}
      return json({ ok: true });
    }

    // 只同步主 API（地址 / Key / 模型）：API 页保存后立即调用，保证 /peek 用的永远是
    // 当前主 API 的实时配置，而不是某个内置/旧模型。
    if (pathname === '/peek/api' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const api = body.api && typeof body.api === 'object' ? {
        url: String(body.api.url || '').trim(),
        key: String(body.api.key || '').trim(),
        model: String(body.api.model || '').trim()
      } : null;
      if (!api || !api.url || !api.key || !api.model) return json({ ok: false, error: 'empty' }, 400);
      const token = peekTokenValue(request, body);
      const realAppId = cleanAppId(body.appId);
      const appId = peekScope(env, realAppId, token);
      await peekRememberApp(env, token, realAppId);
      const chatId = String(body.chatId || 'latest') || 'latest';
      const ttl = 60 * 60 * 24 * 30;
      try {
        await kv(env).put(peekBase(appId, 'api:' + chatId), JSON.stringify(api), { expirationTtl: ttl });
        await kv(env).put(peekBase(appId, 'api:latest'), JSON.stringify(api), { expirationTtl: ttl });
        const ownerRecord = JSON.stringify({
          appId: realAppId,
          deviceId: cleanDeviceId(body.deviceId),
          userId: cleanUserId(body.userId),
          at: Date.now()
        });
        await kv(env).put(peekOwnerKey(env, token, chatId), ownerRecord, { expirationTtl: ttl });
        await kv(env).put(peekOwnerKey(env, token, 'latest'), ownerRecord, { expirationTtl: ttl });
        if (chatId !== 'latest') {
          await kv(env).put(peekBase(appId, 'chat:latest'), chatId, { expirationTtl: ttl });
        }
      } catch (e) {}
      return json({ ok: true });
    }

    // 6) App 拉取「屏幕速聊」暂存轮次（回到前台后合并进唯一聊天）
    // 5.6) 私聊消息同步：只更新最近上下文，不重复写 persona/API，省 KV 写入。
    if (pathname === '/peek/context' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const token = peekTokenValue(request, body);
      const realAppId = cleanAppId(body.appId);
      const scope = peekScope(env, realAppId, token);
      const chatId = String(body.chatId || '').trim();
      if (!chatId) return json({ ok: false, error: 'no chatId' }, 400);
      const history = Array.isArray(body.history) ? body.history.slice(-12).map(function (m) {
        return {
          role: m && m.role === 'assistant' ? 'assistant' : 'user',
          content: String((m && m.content) || '').slice(0, 1200)
        };
      }).filter(function (m) { return m.content; }) : [];
      const ttl = 60 * 60 * 24 * 30;
      try {
        await kv(env).put(peekBase(scope, 'context:' + chatId), JSON.stringify(history), { expirationTtl: ttl });
        await kv(env).put(peekBase(scope, 'context:latest'), JSON.stringify(history), { expirationTtl: ttl });
      } catch (e) {}
      return json({ ok: true });
    }

    if (pathname === '/peek/pending' && (request.method === 'GET' || request.method === 'POST')) {
      let body = {};
      if (request.method === 'POST') { try { body = await request.json(); } catch (e) {} }
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      let chatId = String((body && body.chatId) || '');
      let appId = String((body && body.appId) || '');
      if (!chatId) { try { chatId = new URL(request.url).searchParams.get('chatId') || ''; } catch (e) {} }
      if (!appId) { try { appId = new URL(request.url).searchParams.get('appId') || ''; } catch (e) {} }
      if (!chatId) return json({ ok: false, error: 'no chatId' }, 400);
      const token = peekTokenValue(request, body);
      const scope = peekScope(env, appId, token);
      let turns = await peekTurns(env, chatId, scope);
      // 兼容：App 和快捷指令的 appId 不一致时，用 owner 记录里保存的 appId 再找一次。
      if (!turns.length) {
        try {
          const rawOwner = await kv(env).get(peekOwnerKey(env, token, chatId));
          if (rawOwner) {
            const o = JSON.parse(rawOwner);
            if (o && o.appId) {
              const os = peekScope(env, o.appId, token);
              if (os !== scope) turns = await peekTurns(env, chatId, os);
            }
          }
        } catch (e) {}
      }
      // 兼容旧数据：老快捷指令没有带 appId 时，/peek 可能把轮次存在 legacy 分区
      if (!turns.length) {
        const legacyScope = peekScope(env, 'legacy', token);
        if (legacyScope !== scope) turns = await peekTurns(env, chatId, legacyScope);
      }
      return json({ ok: true, turns: turns });
    }

    // 7) App 合并完成后清空暂存
    if (pathname === '/peek/ack' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      if (!peekOk(request, env, body)) return json({ ok: false, error: 'unauthorized' }, 401);
      const chatId = String(body.chatId || '');
      if (chatId) {
        const token = peekTokenValue(request, body);
        const scope = peekScope(env, body.appId, token);
        await peekSave(env, chatId, [], scope);
        // 同时清掉 owner 记录对应的分区，避免 appId 不一致时轮次重复出现。
        try {
          const rawOwner = await kv(env).get(peekOwnerKey(env, token, chatId));
          if (rawOwner) {
            const o = JSON.parse(rawOwner);
            if (o && o.appId) {
              const os = peekScope(env, o.appId, token);
              if (os !== scope) await peekSave(env, chatId, [], os);
            }
          }
        } catch (e) {}
        const legacyScope = peekScope(env, 'legacy', token);
        if (legacyScope !== scope) await peekSave(env, chatId, [], legacyScope);
      }
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
    // GET /auto/status  给设置页看的后台推送自检：配置到底有没有同步上来、
    // 有没有订阅、下一次主动消息/朋友圈是什么时候。解决「显示已开启但从不推送」无从排查的问题。
    if (pathname === '/auto/status' && request.method === 'GET') {
      if (!autoOk(request, env, null)) return json({ ok: false, error: 'unauthorized' }, 401);
      const sp = new URL(request.url).searchParams;
      const appId = cleanAppId(sp.get('appId'));
      const deviceId = cleanDeviceId(sp.get('deviceId'));
      const userId = cleanUserId(sp.get('userId'));
      let cfg = null, state = {};
      try { const raw = await kv(env).get(autoKey('config', appId, deviceId, userId)); cfg = raw ? JSON.parse(raw) : null; } catch (e) {}
      try { const raw = await kv(env).get(autoKey('state', appId, deviceId, userId)); state = raw ? JSON.parse(raw) : {}; } catch (e) {}
      let subs = [];
      try { subs = await getSubs(env, userId, deviceId, appId); } catch (e) {}
      return json({
        ok: true,
        serverNow: Date.now(),
        appId: appId,
        deviceId: deviceId,
        userId: userId,
        configured: !!cfg,
        enabled: !!(cfg && cfg.enabled),
        msgEnabled: !!(cfg && cfg.msgEnabled),
        momentEnabled: !!(cfg && cfg.momentEnabled),
        chars: cfg && Array.isArray(cfg.chars) ? cfg.chars.length : 0,
        nextMsgAt: Number(state.nextMsgAt) || 0,
        nextMomentAt: Number(state.nextMomentAt) || 0,
        subs: subs.length
      });
    }

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

    // GET /market/file?key=market/...   从 R2 读集市图片/附件（没配 MEDIA_PUBLIC_BASE 时的代理）
    if (pathname === '/market/file' && request.method === 'GET') {
      if (!env.MEDIA) return json({ ok: false, error: 'no media' }, 404);
      const key = new URL(request.url).searchParams.get('key') || '';
      if (!/^market\/[A-Za-z0-9_-]+\//.test(key)) return json({ ok: false, error: 'bad key' }, 400);
      const obj = await env.MEDIA.get(key);
      if (!obj) return new Response('not found', { status: 404, headers: CORS });
      const headers = new Headers(CORS);
      headers.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      if (obj.size) headers.set('Content-Length', String(obj.size));
      return new Response(obj.body, { headers: headers });
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
      // 管理员可随时关闭「上传」；列出/下载/计数不受影响，额度重置后再打开即可。
      const policy = await accReadPolicy(env);
      if (policy.allowMarketUpload === false) return json({ ok: false, error: '集市上传已关闭，本月额度用完后会在下月重新开放' }, 403);
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const item = body.item, summary = body.summary, token = String(body.token || '');
      if (!item || !item.id) return json({ ok: false, error: 'no item' }, 400);
      // 绑了 R2 就搬到 R2；没 R2 但配了 Supabase 就搬到 Supabase Storage。
      // 两者都没有时保持旧行为（dataURL 存在 Supabase/D1 里）。
      if (env.MEDIA || supabaseConf(env)) {
        try { await offloadMarketItem(env, request, item, summary); } catch (e) { console.warn('[market] storage offload failed:', e && e.message); }
      }
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
          const rows = await supabase(env, '/rest/v1/market_items?id=eq.' + encodeURIComponent(id) + '&select=token,item,summary&limit=1');
          if (Array.isArray(rows) && rows[0]) {
            if (rows[0].token && rows[0].token !== token) return json({ ok: false, error: 'forbidden' }, 403);
            if (env.MEDIA || supabaseConf(env)) { try { await deleteMarketBlobs(env, rows[0].item, rows[0].summary); } catch (e) {} }
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
      if (env.MEDIA || supabaseConf(env)) { try { await deleteMarketBlobs(env, rec.item); } catch (e) {} }
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

    return json({ ok: true, info: 'nano-push alive', build: '2026-10-26-social' });
  },

  // 每 5 分钟触发：处理 KV 里的预约任务 + 无后台主动消息 / 朋友圈
  async scheduled(event, env, ctx) {
    try { await cleanupExpiredD1(env); } catch (e) {}
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
      const subs = await jobSubs(job);
      if (subs.length) { try { await pushAll(subs, jobPayload, env); } catch (e) {} }
    }
  }
};

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
      // 但升级前的老订阅没有 appId，只按设备/用户匹配，不能因为缺字段就永远收不到。
      const subApp = cleanAppId(s.appId);
      if (wantApp && s.appId && subApp !== wantApp) continue;
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
