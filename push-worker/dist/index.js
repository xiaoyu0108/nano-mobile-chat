var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
var arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
__name(isType, "isType");
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
__name(isUint8Array, "isUint8Array");
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
__name(isArrayBuffer, "isArrayBuffer");
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
__name(isUint8ArrayOrArrayBuffer, "isUint8ArrayOrArrayBuffer");
function toUint8ArrayIfArrayBuffer(value) {
  return isArrayBuffer(value) ? new Uint8Array(value) : value;
}
__name(toUint8ArrayIfArrayBuffer, "toUint8ArrayIfArrayBuffer");
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
__name(assertUint8ArrayOrArrayBuffer, "assertUint8ArrayOrArrayBuffer");
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
__name(toUint8Array, "toUint8Array");
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.byteLength, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (let array of arrays) {
    assertUint8ArrayOrArrayBuffer(array);
    array = toUint8ArrayIfArrayBuffer(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
__name(concatUint8Arrays, "concatUint8Arrays");
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
__name(assertString, "assertString");
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
__name(stringToUint8Array, "stringToUint8Array");
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
__name(base64ToBase64Url, "base64ToBase64Url");
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
__name(base64UrlToBase64, "base64UrlToBase64");
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8ArrayOrArrayBuffer(array);
  array = toUint8ArrayIfArrayBuffer(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
__name(uint8ArrayToBase64, "uint8ArrayToBase64");
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
__name(base64ToUint8Array, "base64ToUint8Array");
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
__name(encodeRecordSize, "encodeRecordSize");
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
__name(invariant, "invariant");

// node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}
__name(deriveClientKeys, "deriveClientKeys");

// node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: /* @__PURE__ */ __name(async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }, "hash")
  };
}
__name(createHMAC, "createHMAC");
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: /* @__PURE__ */ __name(async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }, "extract")
  };
}
__name(hkdf, "hkdf");

// node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
__name(createKeyInfo, "createKeyInfo");
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
__name(createInfo, "createInfo");

// node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
__name(generateLocalKeys, "generateLocalKeys");

// node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}
__name(getSalt, "getSalt");

// node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}
__name(encryptNotification, "encryptNotification");

// node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
__name(encodeBase64Url, "encodeBase64Url");
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
__name(objectToBase64Url, "objectToBase64Url");

// node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}
__name(sign, "sign");

// node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}
__name(vapidHeaders, "vapidHeaders");

// node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}
__name(buildPushPayload, "buildPushPayload");

// src/index.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Model, model, X-Push-Token, X-Peek-Token, X-Nano-App, X-Nano-Kind, xi-api-key",
  "Access-Control-Max-Age": "86400"
};
function d1Kv(db) {
  return {
    async get(key) {
      await d1Ready(db);
      const row = await db.prepare("SELECT value, expires_at FROM kv WHERE key = ?").bind(String(key)).first();
      if (!row) return null;
      if (row.expires_at && Number(row.expires_at) <= Date.now()) {
        try {
          await db.prepare("DELETE FROM kv WHERE key = ?").bind(String(key)).run();
        } catch (e) {
        }
        return null;
      }
      return row.value;
    },
    async put(key, value, opts) {
      await d1Ready(db);
      const exp = opts && opts.expirationTtl ? Date.now() + Number(opts.expirationTtl) * 1e3 : 0;
      await db.prepare(
        "INSERT INTO kv (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at"
      ).bind(String(key), String(value), exp, Date.now()).run();
    },
    async delete(key) {
      await d1Ready(db);
      await db.prepare("DELETE FROM kv WHERE key = ?").bind(String(key)).run();
    },
    async list(opts) {
      await d1Ready(db);
      const prefix = String(opts && opts.prefix || "");
      const limit = Math.max(1, Math.min(1e3, Number(opts && opts.limit || 1e3)));
      const rows = await db.prepare(
        "SELECT key FROM kv WHERE key LIKE ? AND (expires_at = 0 OR expires_at > ?) ORDER BY key LIMIT ?"
      ).bind(prefix + "%", Date.now(), limit).all();
      return { keys: (rows.results || []).map(function(r) {
        return { name: r.key };
      }), list_complete: true };
    }
  };
}
__name(d1Kv, "d1Kv");
var D1_READY = /* @__PURE__ */ new WeakMap();
function d1Ready(db) {
  let p = D1_READY.get(db);
  if (!p) {
    p = db.prepare(
      "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)"
    ).run().catch(function() {
    });
    D1_READY.set(db, p);
  }
  return p;
}
__name(d1Ready, "d1Ready");
function kv(env) {
  const db = env && (env.DB || env.nano_db);
  return db ? d1Kv(db) : env.PUSH_KV;
}
__name(kv, "kv");
function marketKv(env) {
  return env && env.PUSH_KV ? env.PUSH_KV : kv(env);
}
__name(marketKv, "marketKv");
var json = /* @__PURE__ */ __name((o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }), "json");
function supabaseConf(env) {
  const url = String(env && env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env && env.SUPABASE_SERVICE_ROLE_KEY || "");
  return url && key ? { url, key } : null;
}
__name(supabaseConf, "supabaseConf");
async function supabase(env, path, opts) {
  const c = supabaseConf(env);
  if (!c) throw new Error("supabase not configured");
  const o = opts || {};
  const headers = Object.assign({
    "apikey": c.key,
    "Authorization": "Bearer " + c.key,
    "Content-Type": "application/json"
  }, o.headers || {});
  const resp = await fetch(c.url + path, {
    method: o.method || "GET",
    headers,
    body: o.body === void 0 ? void 0 : typeof o.body === "string" ? o.body : JSON.stringify(o.body)
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!resp.ok) {
    const msg = data && (data.message || data.error_description || data.hint) || "HTTP " + resp.status;
    const err = new Error("Supabase: " + msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}
__name(supabase, "supabase");
function marketRowToSummary(row) {
  const s = Object.assign({}, row && row.summary || {});
  s.id = row && row.id || s.id;
  s.likes = Number(row && row.likes) || 0;
  s.downloads = Number(row && row.downloads) || 0;
  s.imports = Number(row && row.imports) || 0;
  return s;
}
__name(marketRowToSummary, "marketRowToSummary");
function marketRowToItem(row) {
  const it = Object.assign({}, row && row.item || {});
  it.id = row && row.id || it.id;
  it.likes = Number(row && row.likes) || 0;
  it.downloads = Number(row && row.downloads) || 0;
  it.imports = Number(row && row.imports) || 0;
  return it;
}
__name(marketRowToItem, "marketRowToItem");
function subId(endpoint) {
  return "sub:" + btoa(endpoint).replace(/[^a-zA-Z0-9]/g, "").slice(-48);
}
__name(subId, "subId");
function subKey(endpoint, appId, deviceId, userId) {
  return "sub2:" + cleanAppId(appId) + ":" + cleanDeviceId(deviceId) + ":" + cleanUserId(userId) + ":" + subId(endpoint).slice(4);
}
__name(subKey, "subKey");
function cleanPart(v, fallback, max) {
  const s = String(v == null ? "" : v).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, max || 80);
  return s || fallback;
}
__name(cleanPart, "cleanPart");
function cleanAppId(v) {
  return cleanPart(v, "legacy", 48);
}
__name(cleanAppId, "cleanAppId");
function cleanDeviceId(v) {
  return cleanPart(v, "default", 80);
}
__name(cleanDeviceId, "cleanDeviceId");
function cleanUserId(v) {
  const s = String(v == null ? "" : v).replace(/:/g, "_").slice(0, 80);
  return s || "default";
}
__name(cleanUserId, "cleanUserId");
function autoScope(appId, deviceId, userId) {
  return cleanAppId(appId) + ":" + cleanDeviceId(deviceId) + ":" + cleanUserId(userId);
}
__name(autoScope, "autoScope");
function autoKey(kind, appId, deviceId, userId) {
  return "auto2:" + kind + ":" + autoScope(appId, deviceId, userId);
}
__name(autoKey, "autoKey");
function autoActiveKey(appId, deviceId) {
  return "auto2:active:" + cleanAppId(appId) + ":" + cleanDeviceId(deviceId);
}
__name(autoActiveKey, "autoActiveKey");
var AUTO_INDEX_KEY = "auto2:_index";
var JOB_INDEX_KEY = "job:_index";
function autoScopeOf(appId, deviceId, userId) {
  return cleanAppId(appId) + ":" + cleanDeviceId(deviceId) + ":" + cleanUserId(userId);
}
__name(autoScopeOf, "autoScopeOf");
async function readIndex(env, key) {
  try {
    const raw = await kv(env).get(key);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) {
    return null;
  }
}
__name(readIndex, "readIndex");
async function writeIndex(env, key, arr) {
  const clean = Array.from(new Set((arr || []).filter(Boolean))).slice(-300);
  try {
    await kv(env).put(key, JSON.stringify(clean));
  } catch (e) {
  }
  return clean;
}
__name(writeIndex, "writeIndex");
async function addAutoScope(env, scope) {
  const arr = await readIndex(env, AUTO_INDEX_KEY);
  if (arr === null) return;
  if (arr.indexOf(scope) === -1) await writeIndex(env, AUTO_INDEX_KEY, arr.concat(scope));
}
__name(addAutoScope, "addAutoScope");
async function removeAutoScope(env, scope) {
  const arr = await readIndex(env, AUTO_INDEX_KEY);
  if (arr === null) return;
  if (arr.indexOf(scope) !== -1) await writeIndex(env, AUTO_INDEX_KEY, arr.filter(function(x) {
    return x !== scope;
  }));
}
__name(removeAutoScope, "removeAutoScope");
async function getAutoScopes(env) {
  const arr = await readIndex(env, AUTO_INDEX_KEY);
  if (arr !== null) return arr;
  try {
    const { keys } = await kv(env).list({ prefix: "auto2:config:" });
    const scopes = (keys || []).map(function(k) {
      return k.name.slice("auto2:config:".length);
    });
    await writeIndex(env, AUTO_INDEX_KEY, scopes);
    return scopes;
  } catch (e) {
    return [];
  }
}
__name(getAutoScopes, "getAutoScopes");
async function addJobId(env, id) {
  const arr = await readIndex(env, JOB_INDEX_KEY);
  if (arr === null) return;
  if (arr.indexOf(id) === -1) await writeIndex(env, JOB_INDEX_KEY, arr.concat(id));
}
__name(addJobId, "addJobId");
var ACTIVE_CACHE = /* @__PURE__ */ new Map();
async function touchActive(env, appId, deviceId, userId, force) {
  appId = cleanAppId(appId);
  deviceId = cleanDeviceId(deviceId);
  userId = cleanUserId(userId);
  const cacheKey = appId + ":" + deviceId;
  const now = Date.now();
  const hit = ACTIVE_CACHE.get(cacheKey);
  if (!force && hit && hit.userId === userId && now - hit.checkedAt < 10 * 60 * 1e3) return;
  try {
    const key = autoActiveKey(appId, deviceId);
    const raw = await kv(env).get(key);
    if (raw && !force) {
      let old = {};
      try {
        old = JSON.parse(raw) || {};
      } catch (e) {
        old = {};
      }
      if (String(old.userId || "") === userId && now - (Number(old.at) || 0) < 6 * 3600 * 1e3) {
        ACTIVE_CACHE.set(cacheKey, { userId, checkedAt: now });
        return;
      }
    }
    await kv(env).put(key, JSON.stringify({
      userId,
      appId,
      deviceId,
      at: now
    }), { expirationTtl: 60 * 60 * 24 * 7 });
    ACTIVE_CACHE.set(cacheKey, { userId, checkedAt: now });
  } catch (e) {
  }
}
__name(touchActive, "touchActive");
function autoConfigSig(cfg) {
  try {
    const c = Object.assign({}, cfg || {});
    delete c.updatedAt;
    return JSON.stringify(c);
  } catch (e) {
    return "";
  }
}
__name(autoConfigSig, "autoConfigSig");
function peekBase(appId, chatId) {
  const a = cleanAppId(appId);
  const c = String(chatId || "default");
  return a === "legacy" ? "peek:" + c : "peek2:" + a + ":" + c;
}
__name(peekBase, "peekBase");
function b64urlEncode(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes || []);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(b64urlEncode, "b64urlEncode");
function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? new Array(5 - s.length % 4).join("=") : "";
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
__name(b64urlDecode, "b64urlDecode");
async function ensureVapid(env) {
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE) {
    return {
      subject: env.VAPID_SUBJECT || "https://nanopush.nano315.online",
      publicKey: String(env.VAPID_PUBLIC),
      privateKey: String(env.VAPID_PRIVATE)
    };
  }
  try {
    const raw = await kv(env).get("vapid:keys");
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.publicKey && o.privateKey) {
        return {
          subject: o.subject || env.VAPID_SUBJECT || "https://nanopush.nano315.online",
          publicKey: o.publicKey,
          privateKey: o.privateKey
        };
      }
    }
  } catch (e) {
  }
  try {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const x = b64urlDecode(pub.x);
    const y = b64urlDecode(pub.y);
    const point = new Uint8Array(65);
    point[0] = 4;
    point.set(x, 1);
    point.set(y, 33);
    const o = {
      subject: env.VAPID_SUBJECT || "https://nanopush.nano315.online",
      publicKey: b64urlEncode(point),
      privateKey: String(priv.d || ""),
      createdAt: Date.now()
    };
    if (!o.privateKey) return null;
    await kv(env).put("vapid:keys", JSON.stringify(o));
    return o;
  } catch (e) {
    return null;
  }
}
__name(ensureVapid, "ensureVapid");
function tokenOk(request, env) {
  if (!env.PUSH_TOKEN) return true;
  return request.headers.get("X-Push-Token") === env.PUSH_TOKEN;
}
__name(tokenOk, "tokenOk");
function peekPublic(env) {
  const v = String(env.PEEK_PUBLIC || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
__name(peekPublic, "peekPublic");
function peekTokenValue(request, body) {
  let h = "";
  try {
    h = request.headers.get("X-Peek-Token") || "";
  } catch (e) {
  }
  let q = "";
  try {
    q = new URL(request.url).searchParams.get("token") || "";
  } catch (e) {
  }
  const b = body && body.token ? String(body.token) : "";
  return String(h || q || b || "").trim();
}
__name(peekTokenValue, "peekTokenValue");
function peekTokenHash(token) {
  const s = String(token || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return (h >>> 0).toString(36);
}
__name(peekTokenHash, "peekTokenHash");
function peekScope(env, appId, token) {
  const a = cleanAppId(appId);
  if (!peekPublic(env)) return a;
  return a + "." + peekTokenHash(token || "anon");
}
__name(peekScope, "peekScope");
function peekOwnerKey(env, token, chatId) {
  chatId = String(chatId || "default");
  if (!peekPublic(env)) return "peek2:owner:" + chatId;
  return "peek2:owner:" + peekTokenHash(token || "anon") + ":" + chatId;
}
__name(peekOwnerKey, "peekOwnerKey");
function peekOk(request, env, body) {
  const t = peekTokenValue(request, body);
  if (peekPublic(env)) return t.length >= 8;
  if (!env.PEEK_TOKEN) return true;
  return t === env.PEEK_TOKEN;
}
__name(peekOk, "peekOk");
function peekCharName(system) {
  const m = String(system || "").match(/你是[「"]([^」"]{1,40})[」"]/);
  return m ? String(m[1]).trim() : "";
}
__name(peekCharName, "peekCharName");
function modelEndpoint(raw) {
  let s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/\/v1$/i.test(s)) s += "/v1";
  return s + "/chat/completions";
}
__name(modelEndpoint, "modelEndpoint");
async function peekTurns(env, chatId, appId) {
  try {
    const raw = await kv(env).get(peekBase(appId, chatId));
    if (raw) return JSON.parse(raw);
    if (cleanAppId(appId) !== "legacy") return [];
    return [];
  } catch (e) {
    return [];
  }
}
__name(peekTurns, "peekTurns");
async function peekSave(env, chatId, turns, appId) {
  try {
    await kv(env).put(peekBase(appId, chatId), JSON.stringify(turns.slice(-40)), { expirationTtl: 60 * 60 * 24 * 7 });
  } catch (e) {
  }
}
__name(peekSave, "peekSave");
async function peekApiConfig(env, appId, chatId, body, owner, realAppId) {
  const cleanApi = /* @__PURE__ */ __name(function(v) {
    if (!v || typeof v !== "object") return null;
    const url = String(v.url || "").trim();
    const key = String(v.key || "").trim();
    const model = String(v.model || "").trim();
    return url && key && model ? { url, key, model } : null;
  }, "cleanApi");
  const deviceId = cleanDeviceId(owner && owner.deviceId || body && body.deviceId || "default");
  let userId = cleanUserId(owner && owner.userId || body && body.userId || "");
  if (!userId || userId === "default") {
    try {
      const rawActive = await kv(env).get(autoActiveKey(realAppId || appId, deviceId));
      if (rawActive) {
        const active = JSON.parse(rawActive);
        if (active && active.userId) userId = cleanUserId(active.userId);
      }
    } catch (e) {
    }
  }
  if (!userId) userId = "default";
  if (!peekPublic(env)) {
    try {
      const raw = await kv(env).get(autoKey("config", realAppId || appId, deviceId, userId));
      if (raw) {
        const cfg = JSON.parse(raw);
        const api = cleanApi(cfg && cfg.api);
        if (api) return api;
      }
    } catch (e) {
    }
  }
  try {
    const raw = await kv(env).get(peekBase(appId, "api:" + chatId));
    if (raw) {
      const own = cleanApi(JSON.parse(raw));
      if (own) return own;
    }
    const rawLatest = await kv(env).get(peekBase(appId, "api:latest"));
    if (rawLatest) {
      const latest = cleanApi(JSON.parse(rawLatest));
      if (latest) return latest;
    }
  } catch (e) {
  }
  return null;
}
__name(peekApiConfig, "peekApiConfig");
function autoOk(request, env, body) {
  const tokens = [env.PUSH_TOKEN, env.PEEK_TOKEN].filter(Boolean);
  if (!tokens.length) return true;
  let h = "";
  try {
    h = request.headers.get("X-Push-Token") || request.headers.get("X-Peek-Token") || "";
  } catch (e) {
  }
  let q = "";
  try {
    q = new URL(request.url).searchParams.get("token") || "";
  } catch (e) {
  }
  const b = body && body.token ? String(body.token) : "";
  return tokens.indexOf(h) >= 0 || tokens.indexOf(q) >= 0 || tokens.indexOf(b) >= 0;
}
__name(autoOk, "autoOk");
function clampNum(n, min, max, dflt) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) n = dflt;
  return Math.max(min, Math.min(max, n));
}
__name(clampNum, "clampNum");
function sanitizeAutoConfig(body) {
  body = body || {};
  const chars = Array.isArray(body.chars) ? body.chars.slice(0, 30).map(function(c) {
    const av = String(c && c.avatar || "");
    return {
      id: String(c && c.id || "").slice(0, 80),
      name: String(c && c.name || "").slice(0, 40),
      // 头像只在不是超长 dataURL 时保存，避免把配置撑大
      avatar: av.length > 4e3 ? "" : av,
      setting: String(c && c.setting || "").slice(0, 6e3),
      isNpc: !!(c && c.isNpc),
      nationality: String(c && c.nationality || "").slice(0, 40),
      language: String(c && c.language || "").slice(0, 40),
      foreign: !!(c && c.foreign),
      forceTranslate: !!(c && c.forceTranslate),
      forceLang: String(c && c.forceLang || "").slice(0, 40),
      // 最近聊天上下文：后台生成必须接得上你们刚聊过的话题，不能凭空发口水话
      recent: (Array.isArray(c && c.recent) ? c.recent.slice(-6) : []).map(function(r) {
        return {
          who: r && r.who === "user" ? "user" : "char",
          text: String(r && r.text || "").replace(/\s+/g, " ").trim().slice(0, 160)
        };
      }).filter(function(r) {
        return r.text;
      }),
      // 月潮：只有用户开放权限的角色才会带这份数据
      cycle: (function() {
        const cy = c && c.cycle;
        if (!cy || !/^\d{4}-\d{2}-\d{2}$/.test(String(cy.lastStart || ""))) return null;
        return {
          lastStart: String(cy.lastStart),
          nextStart: /^\d{4}-\d{2}-\d{2}$/.test(String(cy.nextStart || "")) ? String(cy.nextStart) : "",
          cycleLength: Math.max(18, Math.min(60, parseInt(cy.cycleLength, 10) || 28)),
          periodLength: Math.max(2, Math.min(14, parseInt(cy.periodLength, 10) || 5)),
          remindDays: Math.max(0, Math.min(14, parseInt(cy.remindDays, 10) || 0))
        };
      })()
    };
  }).filter(function(c) {
    return c.id && c.name;
  }) : [];
  const api = body.api && typeof body.api === "object" ? {
    url: String(body.api.url || "").slice(0, 500),
    key: String(body.api.key || "").slice(0, 500),
    model: String(body.api.model || "").slice(0, 120)
  } : null;
  return {
    enabled: !!(body.enabled || body.msgEnabled || body.momentEnabled),
    msgEnabled: !!body.msgEnabled,
    momentEnabled: !!body.momentEnabled,
    // 客户端设置里最小是 1 小时；这里再兜底，防止旧缓存把 8 当成分钟导致每 8 分钟发一次
    intervalMinutes: clampNum(body.intervalMinutes, 30, 1440, 480),
    momentIntervalHours: clampNum(body.momentIntervalHours, 0.5, 720, 24),
    user: {
      id: String(body.user && body.user.id || "default").slice(0, 80),
      name: String(body.user && body.user.name || "\u6211").slice(0, 40)
    },
    chars,
    api,
    // iPhone：Bark 密钥由 App 同步上来，Worker 在后台生成内容后可直接发系统通知，
    // 不再依赖网页还活着（Web Push 订阅失败/无 GMS 时也能收到）。
    barkKey: String(body.barkKey || "").slice(0, 500),
    updatedAt: Date.now()
  };
}
__name(sanitizeAutoConfig, "sanitizeAutoConfig");
async function autoChat(env, cfg, messages, maxTokens, temperature) {
  const url = modelEndpoint(env.AUTO_API_URL || env.PEEK_API_URL || cfg.api && cfg.api.url || "");
  const key = env.AUTO_API_KEY || env.PEEK_API_KEY || cfg.api && cfg.api.key || "";
  const model = env.AUTO_MODEL || env.PEEK_MODEL || cfg.api && cfg.api.model || "";
  if (!url || !key || !model) return null;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens || 500,
        temperature: typeof temperature === "number" ? temperature : 0.95
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return c ? String(c).trim() : null;
  } catch (e) {
    return null;
  }
}
__name(autoChat, "autoChat");
function pickRandom(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i];
    copy[i] = copy[j];
    copy[j] = t;
  }
  return copy.slice(0, n);
}
__name(pickRandom, "pickRandom");
function splitAutoBubbles(text) {
  return String(text || "").split(/\n+/).map(function(s) {
    return s.trim();
  }).filter(Boolean).slice(0, 3);
}
__name(splitAutoBubbles, "splitAutoBubbles");
function cleanBubble(s) {
  return String(s == null ? "" : s).replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").replace(/^\s*(?:你|角色|消息|气泡)\s*[:：]\s*/, "").replace(/^["'“”]+|["'“”]+$/g, "").trim();
}
__name(cleanBubble, "cleanBubble");
function ensureBubbles(raw, max) {
  let list = [];
  if (Array.isArray(raw)) list = raw.map(cleanBubble).filter(Boolean);
  else if (typeof raw === "string") list = splitAutoBubbles(raw).map(cleanBubble).filter(Boolean);
  max = max || 3;
  if (list.length === 1 && list[0].indexOf("||") < 0 && list[0].length > 16) {
    const parts = list[0].split(/(?<=[。！？!?…])/).map(cleanBubble).filter(Boolean);
    if (parts.length > 1) list = parts;
  }
  const out = [];
  list.forEach(function(s) {
    s = cleanBubble(s).slice(0, 240);
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out.slice(0, max);
}
__name(ensureBubbles, "ensureBubbles");
function parseHeart(raw) {
  if (!raw) return null;
  if (typeof raw === "object") {
    const subject = String(raw.subject || raw.impression || "").trim();
    const thought = String(raw.thought || raw.text || raw.inner || "").trim();
    return subject || thought ? { subject, thought: thought || subject } : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const sep = s.indexOf("||");
  return sep > -1 ? { subject: s.slice(0, sep).trim(), thought: s.slice(sep + 2).trim() } : { subject: "", thought: s };
}
__name(parseHeart, "parseHeart");
function parseAutoReply(raw) {
  let text = String(raw || "").trim();
  if (!text) return null;
  text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  let think = "", heart = null, bubbles = [];
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a > -1 && b > a) {
    try {
      const obj = JSON.parse(text.slice(a, b + 1));
      if (obj && typeof obj === "object") {
        think = String(obj.think || obj.cot || obj.reasoning || "").trim();
        heart = parseHeart(obj.heart || obj.inner || obj.thoughtVoice);
        bubbles = ensureBubbles(obj.bubbles || obj.lines || obj.messages || obj.body, 3);
      }
    } catch (e) {
    }
  }
  if (!bubbles.length) {
    const tm = text.match(/\[(?:think(?:ing)?|thought|reasoning|cot|思考|思维链)\s*\]([\s\S]*?)\[\s*\/\s*(?:think(?:ing)?|thought|reasoning|cot|思考|思维链)\s*\]/i);
    if (tm) {
      think = think || String(tm[1] || "").trim();
      text = text.replace(tm[0], " ");
    }
    const hm = text.match(/\[(?:heart|心声)\s*[:：]\s*([\s\S]*?)\]/i);
    if (hm) {
      heart = heart || parseHeart(hm[1]);
      text = text.replace(hm[0], " ");
    }
    text = text.replace(/\[\s*\/?\s*(?:think(?:ing)?|thought|reasoning|analysis|cot|思考|思维链)\s*\]/gi, " ");
    bubbles = ensureBubbles(text, 3);
  }
  if (!bubbles.length) return null;
  return { think, heart, bubbles };
}
__name(parseAutoReply, "parseAutoReply");
function recentBlock(c) {
  const r = c && Array.isArray(c.recent) ? c.recent : [];
  if (!r.length) return "";
  return "\n\n\u3010\u4F60\u4EEC\u6700\u8FD1\u7684\u804A\u5929 \xB7 \u4ECE\u65E7\u5230\u65B0\uFF08\u5FC5\u987B\u63A5\u4F4F\u8FD9\u4E9B\u5185\u5BB9\uFF09\u3011\n" + r.map(function(x) {
    return (x.who === "user" ? "\u7528\u6237\uFF1A" : "\u4F60\uFF1A") + x.text;
  }).join("\n") + "\n\u3010\u5F3A\u76F8\u5173\u8981\u6C42\u3011\u8FD9\u8F6E\u4E3B\u52A8\u6D88\u606F\u5FC5\u987B\u81EA\u7136\u63A5\u4F4F\u4E0A\u9762\u6700\u540E\u7684\u8BDD\u9898\u3001\u60C5\u7EEA\u6216\u8FD8\u6CA1\u8BF4\u5B8C\u7684\u4E8B\uFF1B\u4E0D\u8981\u53E6\u8D77\u65E0\u5173\u8BDD\u9898\u3002";
}
__name(recentBlock, "recentBlock");
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1e3).toISOString().slice(0, 10);
}
__name(beijingToday, "beijingToday");
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
__name(parseYmd, "parseYmd");
function addDaysMs(ms, n) {
  return ms + n * 864e5;
}
__name(addDaysMs, "addDaysMs");
function fmtCn(ms) {
  const d = new Date(ms);
  return d.getUTCMonth() + 1 + "\u6708" + d.getUTCDate() + "\u65E5";
}
__name(fmtCn, "fmtCn");
function autoLangName(c) {
  if (!c) return "";
  if (c.forceTranslate && c.forceLang) return String(c.forceLang).trim();
  const given = String(c.language || "").trim();
  if (given && !/中文|汉语|漢語|chinese/i.test(given)) return given;
  const nat = String(c.nationality || "");
  const map = {
    "\u7F8E\u56FD": "\u82F1\u6587",
    "\u82F1\u56FD": "\u82F1\u6587",
    "\u6FB3\u5927\u5229\u4E9A": "\u82F1\u6587",
    "\u52A0\u62FF\u5927": "\u82F1\u6587",
    "\u65B0\u897F\u5170": "\u82F1\u6587",
    "\u5370\u5EA6": "\u82F1\u6587",
    "\u65B0\u52A0\u5761": "\u82F1\u6587",
    "\u6CD5\u56FD": "\u6CD5\u6587",
    "\u5FB7\u56FD": "\u5FB7\u6587",
    "\u5965\u5730\u5229": "\u5FB7\u6587",
    "\u897F\u73ED\u7259": "\u897F\u73ED\u7259\u6587",
    "\u58A8\u897F\u54E5": "\u897F\u73ED\u7259\u6587",
    "\u963F\u6839\u5EF7": "\u897F\u73ED\u7259\u6587",
    "\u5DF4\u897F": "\u8461\u8404\u7259\u6587",
    "\u8461\u8404\u7259": "\u8461\u8404\u7259\u6587",
    "\u610F\u5927\u5229": "\u610F\u5927\u5229\u6587",
    "\u65E5\u672C": "\u65E5\u6587",
    "\u97E9\u56FD": "\u97E9\u6587",
    "\u4FC4\u7F57\u65AF": "\u4FC4\u6587",
    "\u6CF0\u56FD": "\u6CF0\u6587",
    "\u8D8A\u5357": "\u8D8A\u5357\u6587",
    "\u8377\u5170": "\u8377\u5170\u6587",
    "\u745E\u5178": "\u745E\u5178\u6587",
    "\u632A\u5A01": "\u632A\u5A01\u6587",
    "\u4E39\u9EA6": "\u4E39\u9EA6\u6587",
    "\u82AC\u5170": "\u82AC\u5170\u6587",
    "\u6CE2\u5170": "\u6CE2\u5170\u6587",
    "\u571F\u8033\u5176": "\u571F\u8033\u5176\u6587",
    "\u6C99\u7279\u963F\u62C9\u4F2F": "\u963F\u62C9\u4F2F\u6587",
    "\u963F\u8054\u914B": "\u963F\u62C9\u4F2F\u6587",
    "\u57C3\u53CA": "\u963F\u62C9\u4F2F\u6587"
  };
  for (const k of Object.keys(map)) if (nat.indexOf(k) > -1) return map[k];
  return "\u82F1\u6587";
}
__name(autoLangName, "autoLangName");
function autoIsForeign(c) {
  if (!c) return false;
  if (c.forceTranslate) return true;
  if (c.foreign) return true;
  const nat = String(c.nationality || "").trim();
  return !!(nat && nat !== "\u672A\u77E5" && nat !== "\u672A\u8BBE\u5B9A" && !/(中国|中國|china|chinese|香港|澳门|澳門|台湾|台灣)/i.test(nat));
}
__name(autoIsForeign, "autoIsForeign");
function autoLangBlock(c) {
  if (!autoIsForeign(c)) return "";
  const lang = autoLangName(c);
  const trans = /粤语|粵語|cantonese/i.test(lang) ? "\u666E\u901A\u8BDD" : "\u4E2D\u6587";
  return "\u3010\u8BED\u8A00 \xB7 \u6700\u9AD8\u4F18\u5148\u7EA7\u3011\u4F60\u662F" + (c.nationality || "\u5916\u56FD") + "\u4EBA\uFF0C\u6BCD\u8BED\u662F" + lang + "\u3002\u672C\u8F6E\u4E3B\u52A8\u6D88\u606F\u7684\u6B63\u6587\u5FC5\u987B\u53EA\u7528" + lang + "\u5199\uFF0C\u7EDD\u4E0D\u80FD\u7528\u4E2D\u6587\u5F53\u6B63\u6587\uFF1B\u5373\u4F7F\u4EBA\u8BBE\u6216\u4E0A\u9762\u7684\u8BF4\u660E\u662F\u4E2D\u6587\uFF0C\u4E5F\u4E0D\u8981\u6539\u53D8\u3002\u6BCF\u884C\u4E00\u6761\u6C14\u6CE1\uFF0C\u4E25\u683C\u6309\u300C" + lang + "\u539F\u6587||" + trans + "\u7FFB\u8BD1\u300D\u7684\u683C\u5F0F\u8F93\u51FA\uFF0C\u7528 || \u5206\u9694\uFF1B" + trans + "\u53EA\u80FD\u51FA\u73B0\u5728 || \u53F3\u8FB9\u4F5C\u4E3A\u7FFB\u8BD1\uFF0C\u7FFB\u8BD1\u8981\u81EA\u7136\u53E3\u8BED\u5316\u3002\n";
}
__name(autoLangBlock, "autoLangBlock");
function cycleBlock(c) {
  const cy = c && c.cycle;
  if (!cy || !cy.lastStart) return "";
  const todayMs = parseYmd(beijingToday());
  let last = parseYmd(cy.lastStart);
  if (!last) return "";
  let next = addDaysMs(last, cy.cycleLength);
  let guard = 0;
  while (next <= todayMs && guard < 400) {
    last = next;
    next = addDaysMs(last, cy.cycleLength);
    guard++;
  }
  const daysUntil = Math.max(0, Math.round((next - todayMs) / 864e5));
  const periodEnd = addDaysMs(last, cy.periodLength - 1);
  const inPeriod = todayMs >= last && todayMs <= periodEnd;
  const periodDay = inPeriod ? Math.round((todayMs - last) / 864e5) + 1 : 0;
  const ovulation = addDaysMs(next, -14 * 864e5);
  const fertileStart = addDaysMs(ovulation, -5 * 864e5);
  const fertileEnd = addDaysMs(ovulation, 864e5);
  let s = "\n\n\u3010\u6708\u6F6E \xB7 \u5979\u7684\u7ECF\u671F\uFF08\u5979\u53EA\u5BF9\u4F60\u5F00\u653E\u4E86\u8FD9\u4EFD\u8BB0\u5F55\uFF09\u3011\n";
  if (inPeriod) s += "\u5979\u73B0\u5728\u6B63\u5728\u7ECF\u671F\uFF0C\u4ECA\u5929\u662F\u7B2C " + periodDay + " \u5929\uFF08\u9884\u8BA1\u6301\u7EED\u7EA6 " + cy.periodLength + " \u5929\uFF09\u3002\n";
  s += "\u9884\u8BA1\u4E0B\u6B21\u7ECF\u671F\uFF1A" + fmtCn(next) + "\uFF08\u8FD8\u6709 " + daysUntil + " \u5929\uFF09\uFF0C\u9884\u8BA1\u6301\u7EED " + cy.periodLength + " \u5929\u3002\n";
  s += "\u9884\u8BA1\u6392\u5375\u65E5\uFF1A" + fmtCn(ovulation) + "\uFF1B\u6392\u5375\u671F\uFF1A" + fmtCn(fertileStart) + "\u2013" + fmtCn(fertileEnd) + "\u3002\n";
  s += "\u8FD9\u662F\u5979\u81EA\u5DF1\u7684\u79C1\u5BC6\u8BB0\u5F55\uFF0C\u63A8\u7B97\u4E0D\u4E00\u5B9A\u5B8C\u5168\u51C6\u786E\u3002\u4F60\u77E5\u9053\u5C31\u597D\uFF0C\u4E0D\u8981\u751F\u786C\u64AD\u62A5\u65E5\u671F\u6216\u201C\u7CFB\u7EDF\u63A8\u7B97\u201D\u3002\n";
  if (cy.remindDays > 0 && daysUntil <= cy.remindDays) {
    s += "\u3010\u672C\u8F6E\u63D0\u9192\u65F6\u673A\u3011\u5979\u9884\u8BA1 " + (daysUntil === 0 ? "\u4ECA\u5929" : daysUntil + " \u5929\u540E") + " \u6765\u7ECF\u671F\u3002\u8FD9\u4E00\u8F6E\u5FC5\u987B\u81EA\u7136\u5173\u5FC3\u5979\uFF0C\u63D0\u9192\u5979\u6CE8\u610F\u4F11\u606F\u3001\u522B\u592A\u7D2F\u3001\u5907\u597D\u7528\u54C1\uFF1B\u8BED\u6C14\u50CF\u4F60\u672C\u4EBA\uFF0C\u4E0D\u8981\u50CF\u63D0\u9192\u673A\u5668\u4EBA\uFF0C\u4E5F\u4E0D\u8981\u63D0\u201C\u8BB0\u5F55/\u63A8\u7B97/\u63D0\u9192\u8BBE\u7F6E\u201D\u3002\n";
  }
  return s;
}
__name(cycleBlock, "cycleBlock");
async function generateAutoMessages(env, cfg, busyChatId, avoidId) {
  const pool = cfg.chars.filter(function(c) {
    return c.id !== busyChatId && !c.isNpc;
  });
  let source = pool.length >= 2 ? pool : cfg.chars.filter(function(c) {
    return c.id !== busyChatId;
  });
  if (avoidId) {
    const fresh = source.filter(function(c) {
      return String(c.id) !== String(avoidId);
    });
    if (fresh.length) source = fresh;
  }
  if (!source.length) return [];
  const picked = pickRandom(source, 1);
  const out = [];
  const now = Date.now();
  for (const c of picked) {
    const system = "\u4F60\u662F\u300C" + c.name + "\u300D\uFF0C\u73B0\u5728\u4E3B\u52A8\u7ED9\u300C" + cfg.user.name + "\u300D\u53D1\u6D88\u606F\u3002\n" + (c.setting ? "\u3010\u4F60\u7684\u4EBA\u8BBE\u3011\n" + c.setting + "\n\n" : "") + "\u73B0\u5728\u662F " + new Date(now + 8 * 3600 * 1e3).toISOString().slice(0, 16).replace("T", " ") + "\uFF08\u5317\u4EAC\u65F6\u95F4\uFF09\u3002\n" + autoLangBlock(c) + cycleBlock(c) + recentBlock(c) + '\n\u3010\u786C\u6027\u8981\u6C42\u3011\n- \u53EA\u53D1\u8FD9\u4E00\u6B21\uFF0C\u4E0D\u8981\u8FDE\u7EED\u8FFD\u95EE\u3001\u4E0D\u8981\u590D\u8BFB\u3001\u4E0D\u8981\u4E00\u6B21\u5199\u4E00\u5927\u6BB5\u3002\n- \u5FC5\u987B\u548C\u4E0A\u9762\u7684\u6700\u8FD1\u804A\u5929\u5F3A\u76F8\u5173\uFF1A\u63A5\u4F4F\u8BDD\u9898/\u60C5\u7EEA/\u7EA6\u5B9A\uFF0C\u6216\u5206\u4EAB\u4E00\u4EF6\u521A\u597D\u53D1\u751F\u3001\u80FD\u63A5\u5F97\u4F4F\u7684\u5C0F\u4E8B\u3002\n- \u4E25\u7981\u53E3\u6C34\u8BDD\uFF1A\u7981\u6B62\u201C\u5728\u5417/\u5728\u5E72\u561B/\u5403\u4E86\u5417/\u7761\u4E86\u5417/\u5FD9\u4E0D\u5FD9\u201D\u201C\u60F3\u4F60\u4E86\u201D\u5374\u6CA1\u6709\u4E0B\u6587\uFF1B\u7981\u6B62\u65E0\u5173\u7684\u65E5\u5E38\u6D41\u6C34\u8D26\uFF1B\u7981\u6B62\u62EC\u53F7\u65C1\u767D\uFF1B\u7981\u6B62\u63D0\u7CFB\u7EDF/\u63A8\u9001/AI\u3002\n- \u4E00\u6B21 API \u8C03\u7528\u540C\u65F6\u4EA7\u51FA\uFF1A\u601D\u7EF4\u94FE think\u3001\u5FC3\u58F0 heart\u3001\u6B63\u6587 bubbles\u3002\n- bubbles \u5FC5\u987B\u662F 2~3 \u6761\u5404\u81EA\u72EC\u7ACB\u7684\u6C14\u6CE1\uFF08\u6BCF\u6761 1 \u53E5\uFF0C\u53E3\u8BED\u81EA\u7136\uFF09\uFF0C\u4E0D\u8981\u628A\u591A\u6761\u585E\u8FDB\u540C\u4E00\u6761\u3002\n- heart \u683C\u5F0F\u56FA\u5B9A\u4E3A\u300C\u6B64\u523B\u5370\u8C61||\u5FC3\u58F0\u72EC\u767D\u300D\uFF0C\u5FC3\u58F0 60~120 \u5B57\uFF0C\u5E73\u5B9E\u3001\u4E0D\u8981\u717D\u60C5\u3002\n- \u5916\u56FD\u4EBA / \u7CA4\u8BED\u89D2\u8272\u4ECD\u6309\u4E0A\u9762\u7684\u8BED\u8A00\u89C4\u5219\u8F93\u51FA\u300C\u539F\u6587||\u4E2D\u6587\u7FFB\u8BD1\u300D\u3002\n\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4EFB\u4F55\u591A\u4F59\u6587\u5B57\uFF1A\n{"think":"\u8FD9\u4E00\u8F6E\u7684\u601D\u8003\uFF0C40~100\u5B57","heart":"\u6B64\u523B\u5370\u8C61||\u5FC3\u58F0\u72EC\u767D","bubbles":["\u7B2C\u4E00\u6761","\u7B2C\u4E8C\u6761","\u7B2C\u4E09\u6761"]}';
    const text = await autoChat(env, cfg, [
      { role: "system", content: system },
      { role: "user", content: "\u53D1 2~3 \u6761\u5F3A\u76F8\u5173\u7684\u4E3B\u52A8\u6D88\u606F\u3002" }
    ], 1e3, 1);
    const parsed = parseAutoReply(text);
    if (!parsed || !parsed.bubbles.length) continue;
    out.push({
      id: "m_" + now + "_" + c.id,
      chatId: c.id,
      charId: c.id,
      name: c.name,
      avatar: c.avatar || "",
      text: parsed.bubbles.join("\n"),
      bubbles: parsed.bubbles,
      think: parsed.think || "",
      heart: parsed.heart || null,
      ts: now
    });
  }
  return out;
}
__name(generateAutoMessages, "generateAutoMessages");
async function generateAutoMoments(env, cfg, busyChatId, maxChars) {
  const pool = cfg.chars.filter(function(c) {
    return c.id !== busyChatId && !c.isNpc;
  });
  const source = pool.length ? pool : cfg.chars.filter(function(c) {
    return c.id !== busyChatId;
  });
  if (!source.length) return [];
  const count = Math.max(1, Math.min(Number(maxChars) || 2, 3, source.length));
  const picked = pickRandom(source, count);
  const names = picked.map(function(c) {
    return c.name;
  });
  const profiles = picked.map(function(c) {
    const recent = (c.recent || []).slice(-3).map(function(r) {
      return (r.who === "user" ? "\u7528\u6237\uFF1A" : "TA\uFF1A") + r.text;
    }).join("\uFF1B");
    return "\xB7 " + c.name + "\uFF1A" + String(c.setting || "").slice(0, 500) + (recent ? "\n  \u6700\u8FD1\u804A\u5929\uFF1A" + recent : "");
  }).join("\n");
  const sys = "\u4F60\u4EEC\u662F\u5F7C\u6B64\u8BA4\u8BC6\u7684\u670B\u53CB\uFF0C\u5728\u540C\u4E00\u4E2A\u670B\u53CB\u5708\u91CC\u3002\u8BF7\u8BA9\u4EE5\u4E0B\u89D2\u8272\u5404\u53D1\u4E00\u6761\u670B\u53CB\u5708\u52A8\u6001\uFF1A" + names.join("\u3001") + "\u3002\n\u3010\u89D2\u8272\u4EBA\u8BBE\u4E0E\u6700\u8FD1\u804A\u5929\u3011\n" + profiles + "\n\u8981\u6C42\uFF1A\u50CF\u771F\u4EBA\u968F\u624B\u53D1\u7684\u65E5\u5E38\uFF0C\u5177\u4F53\u3001\u6709\u7EC6\u8282\uFF0C\u6700\u597D\u548C TA \u6700\u8FD1\u804A\u8FC7\u7684\u4E8B\u6709\u4E00\u70B9\u5173\u8054\uFF1B\u4E0D\u8981\u6D41\u6C34\u8D26\uFF0C\u4E0D\u8981\u5BF9\u4EFB\u4F55\u4EBA\u8BF4\u8BDD\uFF0C\u4E0D\u8981\u63D0\u95EE\uFF0C\u7981\u6B62 AI \u8154\u3002\n\u6BCF\u4EBA\u53EA\u53D1 1 \u6761\uFF0C\u4E0D\u8981\u91CD\u590D\u4F5C\u8005\uFF1B\u6700\u591A " + count + " \u6761\u3002\n\u6BCF\u6761\u52A8\u6001\u90FD\u8981\u5E26 1~3 \u4E2A\u70B9\u8D5E\u548C 1~3 \u6761\u8BC4\u8BBA\uFF1B\u70B9\u8D5E/\u8BC4\u8BBA\u8005\u53EA\u80FD\u4ECE\u8FD9\u4E9B\u540D\u5B57\u91CC\u9009\uFF1A" + names.join("\u3001") + "\uFF0C\u4E0D\u80FD\u662F\u52A8\u6001\u4F5C\u8005\u672C\u4EBA\uFF0C\u4E5F\u4E0D\u80FD\u51FA\u73B0\u300C" + cfg.user.name + '\u300D\u3002\n\u53EA\u8F93\u51FA JSON \u6570\u7EC4\uFF1A[{"author":"\u540D\u5B57","text":"\u52A8\u6001\u6587\u6848","location":"\u5730\u70B9\u6216\u7A7A","likes":["\u540D\u5B57"],"comments":[{"user":"\u540D\u5B57","toUser":"","text":"\u8BC4\u8BBA"}]}]';
  const content = await autoChat(env, cfg, [
    { role: "system", content: sys },
    { role: "user", content: "\u751F\u6210 " + picked.length + " \u6761\u670B\u53CB\u5708\u52A8\u6001\u3002" }
  ], 1400, 1);
  if (!content) return [];
  let arr = null;
  const a = content.indexOf("["), b = content.lastIndexOf("]");
  if (a > -1 && b > a) {
    try {
      arr = JSON.parse(content.slice(a, b + 1));
    } catch (e) {
    }
  }
  if (!Array.isArray(arr)) return [];
  const nameSet = {};
  names.forEach(function(n) {
    nameSet[n] = true;
  });
  const pickName = /* @__PURE__ */ __name(function(raw) {
    const n = String(raw == null ? "" : raw).trim();
    if (!n) return "";
    if (nameSet[n]) return n;
    return names.find(function(x) {
      return x && (x.indexOf(n) > -1 || n.indexOf(x) > -1);
    }) || "";
  }, "pickName");
  const out = [];
  const now = Date.now();
  const canned = ["\u8FD9\u6761\u4E5F\u592A\u771F\u5B9E\u4E86", "\u54C8\u54C8\u54C8\u54C8", "\u6211\u4E5F\u60F3\u53BB", "\u6CE8\u610F\u4F11\u606F\u5440", "\u597D\u770B", "\u4E0B\u6B21\u5E26\u6211"];
  const usedAuthors = {};
  arr.slice(0, count).forEach(function(o, i) {
    if (!o || !o.text) return;
    const au = pickName(o.author) || names[Math.min(i, names.length - 1)];
    if (!au || usedAuthors[au]) return;
    usedAuthors[au] = true;
    const likes = [];
    (Array.isArray(o.likes) ? o.likes : []).forEach(function(raw) {
      const n = pickName(raw);
      if (n && n !== au && likes.indexOf(n) < 0) likes.push(n);
    });
    if (!likes.length) names.forEach(function(n) {
      if (n !== au && likes.length < 2) likes.push(n);
    });
    const comments = [];
    (Array.isArray(o.comments) ? o.comments : []).forEach(function(c) {
      if (!c || typeof c !== "object") return;
      const u = pickName(c.user || c.name || c.author);
      const txt = String(c.text || c.content || "").trim();
      if (!u || !txt) return;
      comments.push({ user: u, toUser: pickName(c.toUser || c.replyTo || c.to), text: txt.slice(0, 120) });
    });
    if (!comments.length) {
      const other = names.find(function(n) {
        return n !== au;
      });
      if (other) comments.push({ user: other, toUser: "", text: canned[(i + au.length) % canned.length] });
    }
    const char = picked.find(function(c) {
      return c.name === au;
    }) || {};
    out.push({
      id: "srv_" + now + "_" + i + "_" + Math.random().toString(36).slice(2, 5),
      author: au,
      avatar: char.avatar || "",
      text: String(o.text).slice(0, 500),
      images: [],
      time: new Date(now - (arr.length - 1 - i) * 1800 * 1e3).toISOString(),
      location: String(o.location || "").slice(0, 60),
      likes,
      comments: comments.slice(0, 8),
      maskId: cfg.user.id
    });
  });
  return out;
}
__name(generateAutoMoments, "generateAutoMoments");
function pushText(v, fallback) {
  let s = "";
  if (v && typeof v === "object") s = v.body || v.text || v.message || v.content || v.title || "";
  else s = v == null ? "" : v;
  s = String(s || "").replace(/\s*\|\|\s*/g, " / ").trim();
  return s || String(fallback || "");
}
__name(pushText, "pushText");
async function sendBarkKey(env, key, payload) {
  key = String(key || "").trim();
  if (!key) return false;
  let base = "";
  if (key.indexOf("http") === 0) {
    try {
      const u = new URL(key);
      base = u.origin + u.pathname.replace(/\/+$/, "");
    } catch (e) {
      base = key.replace(/[?#].*$/, "").replace(/\/+$/, "");
    }
  } else {
    base = "https://api.day.app/" + encodeURIComponent(key);
  }
  const title = pushText(payload.name || payload.title, "Nano");
  let body = "";
  if (Array.isArray(payload.bubbles) && payload.bubbles.length) {
    body = payload.bubbles.map(function(b) {
      return pushText(b, "");
    }).filter(Boolean).join("\n");
  }
  body = pushText(body || payload.body || payload.text || payload.preview, "").slice(0, 300);
  if (!body) return false;
  let url = base + "/" + encodeURIComponent(title) + "/" + encodeURIComponent(body);
  const q = [
    "group=" + encodeURIComponent(payload.name || payload.title || payload.channel || "Nano"),
    "level=active",
    "sound=none"
  ];
  if (payload.target) {
    const app = String(env.APP_URL || "https://xiaoyu0108.github.io/nano-mobile-chat/").replace(/\/+$/, "");
    q.push("url=" + encodeURIComponent(app + "/index.html?open=" + encodeURIComponent(payload.target)));
  }
  url += "?" + q.join("&");
  try {
    const resp = await fetch(url);
    if (!resp || !resp.ok) return false;
    try {
      const data = await resp.json();
      if (data && data.code != null && Number(data.code) !== 200) return false;
    } catch (e) {
    }
    return true;
  } catch (e) {
    return false;
  }
}
__name(sendBarkKey, "sendBarkKey");
async function autoNotify(env, cfg, subs, payload) {
  const key = String(cfg && cfg.barkKey || "").trim();
  if (key) {
    const ok = await sendBarkKey(env, key, payload);
    if (ok) return 1;
  }
  if (subs && subs.length) {
    try {
      return await pushAll(subs, payload, env);
    } catch (e) {
      return 0;
    }
  }
  return 0;
}
__name(autoNotify, "autoNotify");
async function runAutoPush(env, appId, deviceId, userId) {
  appId = cleanAppId(appId);
  deviceId = cleanDeviceId(deviceId);
  userId = cleanUserId(userId);
  const raw = await kv(env).get(autoKey("config", appId, deviceId, userId));
  if (!raw) return;
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!cfg || !cfg.enabled) return;
  let state = {};
  try {
    const s = await kv(env).get(autoKey("state", appId, deviceId, userId));
    state = s ? JSON.parse(s) : {};
  } catch (e) {
    state = {};
  }
  const now = Date.now();
  const msgDue = !!(cfg.msgEnabled && now >= (Number(state.nextMsgAt) || 0));
  const momentDue = !!(cfg.momentEnabled && now >= (Number(state.nextMomentAt) || 0));
  if (!msgDue && !momentDue) return;
  try {
    const activeRaw = await kv(env).get(autoActiveKey(appId, deviceId));
    if (activeRaw) {
      let active = "";
      try {
        active = String((JSON.parse(activeRaw) || {}).userId || "");
      } catch (e) {
        active = "";
      }
      if (active && active !== userId) return;
    }
  } catch (e) {
  }
  let subsCache = null;
  async function subsOnce() {
    if (subsCache) return subsCache;
    subsCache = await getSubs(env, userId, deviceId, appId);
    return subsCache;
  }
  __name(subsOnce, "subsOnce");
  let busyChatId = "";
  try {
    busyChatId = String(await kv(env).get("auto2:call:" + cleanAppId(appId) + ":" + userId) || "");
  } catch (e) {
  }
  let dirty = false;
  let usedChars = 0;
  if (msgDue) {
    state.nextMsgAt = now + cfg.intervalMinutes * 60 * 1e3;
    state.msgMins = cfg.intervalMinutes;
    dirty = true;
    let msgs = [];
    try {
      msgs = await generateAutoMessages(env, cfg, busyChatId, state.lastMsgChar);
    } catch (e) {
      msgs = [];
    }
    if (msgs.length) {
      state.lastMsgChar = String(msgs[0].chatId || "");
      const key = autoKey("msg", appId, deviceId, userId);
      let list = [];
      try {
        const old = await kv(env).get(key);
        list = old ? JSON.parse(old) : [];
      } catch (e) {
        list = [];
      }
      list = list.concat(msgs).slice(-20);
      await kv(env).put(key, JSON.stringify(list));
      usedChars += msgs.length;
      const subs = await subsOnce();
      for (const m of msgs) {
        const icon = /^https?:\/\//i.test(String(m.avatar || "")) ? String(m.avatar) : "";
        await autoNotify(env, cfg, subs, {
          title: pushText(m.name, "TA"),
          body: pushText(m.bubbles && m.bubbles[0] || m.text, "\u4F60\u6709\u4E00\u6761\u65B0\u6D88\u606F"),
          bubbles: Array.isArray(m.bubbles) ? m.bubbles : null,
          target: "chat:" + m.chatId,
          tag: "auto-" + m.chatId,
          renotify: false,
          icon,
          name: m.name,
          channel: "chat",
          appId
        });
      }
    }
  }
  if (momentDue) {
    state.nextMomentAt = now + cfg.momentIntervalHours * 3600 * 1e3;
    state.momentHours = cfg.momentIntervalHours;
    dirty = true;
    const remain = Math.max(0, 3 - usedChars);
    if (remain > 0) {
      let posts = [];
      try {
        posts = await generateAutoMoments(env, cfg, busyChatId, remain);
      } catch (e) {
        posts = [];
      }
      if (posts.length) {
        const key = autoKey("moments", appId, deviceId, userId);
        let list = [];
        try {
          const old = await kv(env).get(key);
          list = old ? JSON.parse(old) : [];
        } catch (e) {
          list = [];
        }
        list = list.concat(posts).slice(-30);
        await kv(env).put(key, JSON.stringify(list));
        const subs = await subsOnce();
        await autoNotify(env, cfg, subs, {
          title: "\u670B\u53CB\u5708",
          body: pushText(posts[0] && posts[0].author + " \u53D1\u4E86\u65B0\u52A8\u6001", "\u670B\u53CB\u5708\u6709\u65B0\u52A8\u6001"),
          target: "moments",
          tag: "auto-moments",
          renotify: false,
          channel: "moment",
          appId
        });
      }
    }
  }
  if (dirty) await kv(env).put(autoKey("state", appId, deviceId, userId), JSON.stringify(state));
}
__name(runAutoPush, "runAutoPush");
async function peekModel(env, system, text, image, history, apiCfg, context) {
  const allowEnvApi = !peekPublic(env);
  const url = modelEndpoint((allowEnvApi ? env.PEEK_API_URL : "") || apiCfg && apiCfg.url || "");
  const key = (allowEnvApi ? env.PEEK_API_KEY : "") || apiCfg && apiCfg.key || "";
  const model = (allowEnvApi ? env.PEEK_MODEL : "") || apiCfg && apiCfg.model || "";
  if (!url || !key || !model) return null;
  let content;
  if (image) {
    content = [
      { type: "text", text: text || "\u770B\u770B\u6211\u73B0\u5728\u5C4F\u5E55\u4E0A\u662F\u4EC0\u4E48\uFF0C\u7528\u4F60\u7684\u4EBA\u8BBE\u968F\u53E3\u8BF4\u4E00\u53E5\u3002" },
      { type: "image_url", image_url: { url: image } }
    ];
  } else {
    content = text || "\u7528\u4F60\u7684\u4EBA\u8BBE\u968F\u53E3\u8BF4\u4E00\u53E5\u3002";
  }
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  (context || []).forEach(function(m) {
    if (!m || !m.content) return;
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1200) });
  });
  (history || []).forEach(function(t) {
    if (t.user) messages.push({ role: "user", content: String(t.user) });
    if (t.char) messages.push({ role: "assistant", content: String(t.char) });
  });
  messages.push({ role: "user", content });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model, messages, max_tokens: 900, temperature: 0.9 })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return c ? String(c).trim() : null;
}
__name(peekModel, "peekModel");
var LINK_HOST_RE = /(^|\.)(xiaohongshu\.com|xhslink\.[a-z.]+|xhs\.cn|douyin\.com|iesdouyin\.com|taobao\.com|tmall\.com|tb\.cn|jd\.com|3\.cn|bilibili\.com|b23\.tv|weibo\.com|weibo\.cn)$/i;
function linkHostAllowed(host) {
  return LINK_HOST_RE.test(String(host || "").toLowerCase());
}
__name(linkHostAllowed, "linkHostAllowed");
function linkDecodeHtml(s) {
  return String(s || "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\\u([\dA-Fa-f]{4})/g, function(_, h) {
    try {
      return String.fromCharCode(parseInt(h, 16));
    } catch (e) {
      return "";
    }
  }).replace(/\s+/g, " ").trim();
}
__name(linkDecodeHtml, "linkDecodeHtml");
function linkAbsImg(u) {
  u = linkDecodeHtml(String(u || "")).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (!u) return "";
  if (u.indexOf("//") === 0) u = "https:" + u;
  if (/^http:\/\//i.test(u)) u = "https://" + u.slice(7);
  if (!/^https?:\/\//i.test(u)) return "";
  return u;
}
__name(linkAbsImg, "linkAbsImg");
function linkCleanText(s) {
  return String(s || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
__name(linkCleanText, "linkCleanText");
function parseLinkPage(html) {
  html = String(html || "").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  function pick(re2) {
    const m2 = html.match(re2);
    return m2 ? m2[1] : "";
  }
  __name(pick, "pick");
  function jsonField(name) {
    const m2 = html.match(new RegExp('"' + name + '"\\s*:\\s*"([^"]{2,})"', "i"));
    return m2 ? linkDecodeHtml(String(m2[1]).replace(/\\n/g, " ")) : "";
  }
  __name(jsonField, "jsonField");
  const docTitle = pick(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*content=["']([\s\S]*?)["']/i) || pick(/<meta[^>]+content=["']([\s\S]*?)["'][^>]*(?:property|name)=["'](?:og:title|twitter:title)["']/i) || pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const jsonTitle = jsonField("title") || jsonField("noteTitle") || jsonField("displayTitle");
  let title = docTitle;
  if (!title || /^(小红书|抖音|快手|微博|哔哩哔哩|B站)/i.test(linkDecodeHtml(title))) {
    title = jsonTitle || title;
  }
  let desc = pick(/<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*content=["']([\s\S]*?)["']/i) || pick(/<meta[^>]+content=["']([\s\S]*?)["'][^>]*(?:property|name)=["'](?:og:description|description|twitter:description)["']/i) || jsonField("desc") || jsonField("description");
  const imgs = [];
  const seen = {};
  function addImg(u) {
    u = linkAbsImg(u);
    if (!u || seen[u]) return;
    if (/logo|favicon|sprite|qrcode|qr_|share[_-]?icon|app[_-]?icon|\/icon\//i.test(u)) return;
    seen[u] = 1;
    if (imgs.length < 6) imgs.push(u);
  }
  __name(addImg, "addImg");
  let re = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/gi, m;
  while (m = re.exec(html)) addImg(m[1]);
  re = /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/gi;
  while (m = re.exec(html)) addImg(m[1]);
  re = /"imageScene"\s*:\s*"H5_DTL"[\s\S]{0,240}?"url"\s*:\s*"([^"]+)"/gi;
  while (m = re.exec(html)) addImg(m[1]);
  re = /"(?:picUrl|imageUrl|image|img|pic|pics|images)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while (m = re.exec(html)) addImg(m[1]);
  re = /"(?:cover|origin_cover|dynamic_cover|cover_url|video_cover)"\s*:\s*\{[\s\S]{0,300}?"url_list"\s*:\s*\[\s*"([^"]+)"/gi;
  while (m = re.exec(html)) addImg(m[1]);
  re = /"(?:urlDefault|urlPre|url)"\s*:\s*"((?:https?:)?\/\/[^"]*(?:sns-webpic|xhscdn|xiaohongshu)[^"]*)"/gi;
  while (m = re.exec(html)) addImg(m[1]);
  re = /"(?:picUrl|pic_url|mainPic|main_pic|imageUrl|images|imageList)"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/gi;
  while (m = re.exec(html)) addImg(m[1] || m[2]);
  re = /(https?:)?\/\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s]*)?/gi;
  while (m = re.exec(html)) {
    const u8 = m[0];
    if (/(alicdn|taobao|tmall|douyin|byteimg|xiaohongshu|xhscdn)/i.test(u8)) addImg(u8);
  }
  const visible = linkCleanText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  let price = "";
  const pm = html.match(/"(?:price|priceText|priceShow|salePrice|promotionPrice)"\s*:\s*"?\s*[¥￥]?\s*([\d.]+)/i) || html.match(/[¥￥]\s*([\d.]+)/);
  if (pm && pm[1]) price = pm[1];
  title = linkDecodeHtml(title).slice(0, 120);
  desc = linkDecodeHtml(desc).replace(/\s+/g, " ").slice(0, 180);
  const body = [jsonTitle, jsonField("desc"), jsonField("share_title"), jsonField("description"), desc, visible].filter(Boolean).join("\n").slice(0, 7e3);
  return { title, desc, content: body, images: imgs, price };
}
__name(parseLinkPage, "parseLinkPage");
function linkLooksBlocked(finalUrl, data) {
  if (/website-login|captcha|verify|\/login|signin/i.test(String(finalUrl || ""))) return true;
  const title = String(data && data.title || "");
  const content = String(data && data.content || "");
  if (/^(小红书|抖音|快手|微博|哔哩哔哩|B站|淘宝|天猫|京东)\s*$/i.test(title) && content.replace(/\s+/g, "").length < 50 && !(data && data.images && data.images.length)) return true;
  if (/滑动验证|请登录|安全验证|访问异常|captcha|想了解些什么|登录后|扫码登录|登录小红书|亲，请登录|扫码查看|商品不存在|商品已下架|您查看的宝贝不存在|页面不存在/i.test(content)) return true;
  return false;
}
__name(linkLooksBlocked, "linkLooksBlocked");
function xhsDirectUrls(finalUrl) {
  const out = [];
  try {
    const fu = new URL(String(finalUrl || ""));
    const rp = fu.searchParams.get("redirectPath") || "";
    if (!rp) return out;
    const direct = new URL(rp.replace(/^http:/i, "https:"));
    const m = direct.pathname.match(/\/(?:item|explore)\/([0-9a-f]+)/i);
    if (!m) return out;
    const id = m[1];
    const token = direct.searchParams.get("xsec_token") || fu.searchParams.get("xsec_token") || "";
    const q = token ? "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=app_share" : "";
    out.push("https://www.xiaohongshu.com/explore/" + id + q);
    out.push("https://www.xiaohongshu.com/discovery/item/" + id + q);
  } catch (e) {
  }
  return out;
}
__name(xhsDirectUrls, "xhsDirectUrls");
function parseJinaText(raw) {
  raw = String(raw || "");
  const tm = raw.match(/^\s*Title\s*:\s*(.+)$/im);
  const dm = raw.match(/^\s*(?:Description|Summary)\s*:\s*([\s\S]*?)(?=^\s*(?:URL Source|Published Time|Markdown Content|Content)\s*:|$)/im);
  let body = raw.replace(/^(?:Title|URL Source|Published Time|Description|Summary|Markdown Content|Content):.*$/gim, "").trim();
  const imgs = [], seen = {};
  const ire = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
  let m;
  while (m = ire.exec(raw)) {
    const u = linkAbsImg(m[1]);
    if (u && !seen[u]) {
      seen[u] = 1;
      imgs.push(u);
      if (imgs.length >= 6) break;
    }
  }
  return {
    title: linkDecodeHtml(tm && tm[1] || "").slice(0, 120),
    desc: linkDecodeHtml(dm && dm[1] || "").replace(/\s+/g, " ").slice(0, 180),
    content: body.slice(0, 7e3),
    images: imgs,
    price: ""
  };
}
__name(parseJinaText, "parseJinaText");
async function fetchTextWithTimeout(target, headers, ms) {
  const controller = new AbortController();
  const timer = setTimeout(function() {
    try {
      controller.abort();
    } catch (e) {
    }
  }, ms);
  try {
    const resp = await fetch(target, { redirect: "follow", signal: controller.signal, headers });
    if (!resp || !resp.ok) return null;
    return { resp, text: await resp.text() };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
__name(fetchTextWithTimeout, "fetchTextWithTimeout");
async function fetchLinkPreview(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch (e) {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || !linkHostAllowed(u.hostname)) return null;
  const mobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const refHost = /douyin|iesdouyin/i.test(u.hostname) ? "https://www.douyin.com/" : /taobao|tb\.cn|tmall/i.test(u.hostname) ? "https://m.tb.cn/" : "";
  const first = await fetchTextWithTimeout(u.href, {
    "User-Agent": mobileUA,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    ...refHost ? { "Referer": refHost } : {}
  }, 1e4);
  let firstOk = false;
  if (first && first.text) {
    const data = parseLinkPage(first.text);
    const ok = (data.title || data.content) && !linkLooksBlocked(first.resp.url || u.href, data);
    if (ok) {
      return Object.assign({ url: first.resp.url || u.href }, data);
    }
    firstOk = false;
  }
  if (!firstOk && /douyin|iesdouyin|taobao|tb\.cn|tmall/i.test(u.hostname)) {
    const desk = await fetchTextWithTimeout(u.href, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Referer": /taobao|tb\.cn|tmall/i.test(u.hostname) ? "https://www.taobao.com/" : "https://www.douyin.com/"
    }, 1e4);
    if (desk && desk.text) {
      const d2 = parseLinkPage(desk.text);
      if ((d2.title || d2.content || d2.images && d2.images.length) && !linkLooksBlocked(desk.resp.url || u.href, d2)) {
        return Object.assign({ url: desk.resp.url || u.href, via: "desktop" }, d2);
      }
    }
  }
  const directUrls = xhsDirectUrls(first && first.resp ? first.resp.url : u.href);
  for (const direct of directUrls) {
    const r = await fetchTextWithTimeout(direct, {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Referer": "https://www.xiaohongshu.com/"
    }, 1e4);
    if (r && r.text) {
      const data = parseLinkPage(r.text);
      if ((data.title || data.content) && !linkLooksBlocked(r.resp.url || direct, data)) {
        return Object.assign({ url: r.resp.url || direct, via: "xhs-direct" }, data);
      }
    }
  }
  if (/douyin|iesdouyin/i.test(u.hostname)) {
    const finalUrl = String(first && first.resp && first.resp.url || u.href);
    const vm = finalUrl.match(/\/(?:video|note|slides)\/(\d{8,})/) || (first && first.text ? first.text.match(/"aweme_id"\s*:\s*"(\d{8,})"/) : null);
    if (vm && vm[1]) {
      const a = await fetchTextWithTimeout("https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=" + vm[1], {
        "User-Agent": mobileUA,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.iesdouyin.com/"
      }, 1e4);
      if (a && a.text) {
        try {
          const aj = JSON.parse(a.text);
          const item = aj && aj.item_list && aj.item_list[0];
          if (item) {
            const desc = String(item.desc || "").replace(/\s+/g, " ").trim();
            const cover = item.video && item.video.cover && item.video.cover.url_list && item.video.cover.url_list[0] || item.video && item.video.dynamic_cover && item.video.dynamic_cover.url_list && item.video.dynamic_cover.url_list[0] || "";
            if (desc || cover) {
              return {
                url: finalUrl,
                via: "douyin-api",
                title: (desc || "\u6296\u97F3\u89C6\u9891").slice(0, 120),
                desc: desc.slice(0, 180),
                content: [desc, item.author && item.author.nickname ? "\u4F5C\u8005\uFF1A" + item.author.nickname : ""].filter(Boolean).join("\n").slice(0, 7e3),
                images: cover ? [linkAbsImg(cover)] : [],
                price: ""
              };
            }
          }
        } catch (e) {
        }
      }
    }
  }
  if (/taobao|tmall/i.test(u.hostname)) {
    const taobaoSource = String(first && first.resp && first.resp.url || u.href);
    const tm = taobaoSource.match(/[?&](?:id|itemId)=(\d{6,})/) || u.href.match(/[?&](?:id|itemId)=(\d{6,})/);
    if (tm && tm[1]) {
      const tb = await fetchTextWithTimeout("https://h5.m.taobao.com/awp/core/detail.htm?id=" + tm[1], {
        "User-Agent": mobileUA,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://m.tb.cn/"
      }, 1e4);
      if (tb && tb.text) {
        const td = parseLinkPage(tb.text);
        if ((td.title || td.content || td.images && td.images.length) && !linkLooksBlocked(tb.resp.url || taobaoSource, td)) {
          return Object.assign({ url: tb.resp.url || taobaoSource, via: "taobao-h5" }, td);
        }
      }
    }
  }
  const j = await fetchTextWithTimeout("https://r.jina.ai/" + u.href, {
    "User-Agent": mobileUA,
    "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9"
  }, 15e3);
  if (j && j.text) {
    const data = parseJinaText(j.text);
    if ((data.title || data.content) && !linkLooksBlocked("", data)) {
      return Object.assign({ url: u.href, via: "jina" }, data);
    }
  }
  return null;
}
__name(fetchLinkPreview, "fetchLinkPreview");
var HOT_LABEL = { weibo: "\u5FAE\u535A", douyin: "\u6296\u97F3", baidu: "\u767E\u5EA6", toutiao: "\u4ECA\u65E5\u5934\u6761", bilibili: "B\u7AD9" };
var HOT_DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var HOT_MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
function hotItem(title, hot, url) {
  title = String(title || "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  return { title: title.slice(0, 160), hot: Number(hot) || 0, url: String(url || "") };
}
__name(hotItem, "hotItem");
async function hotWeibo() {
  const r = await fetchTextWithTimeout("https://weibo.com/ajax/statuses/hot_band", {
    "User-Agent": HOT_DESKTOP_UA,
    "Referer": "https://weibo.com/",
    "Accept": "application/json, text/plain, */*"
  }, 7e3);
  if (!r) return [];
  const j = JSON.parse(r.text);
  const list = j.data && j.data.band_list || [];
  return list.map(function(x) {
    return hotItem(x.word || x.note, x.num, "https://s.weibo.com/weibo?q=" + encodeURIComponent(x.word_scheme || x.word || ""));
  }).filter(Boolean).slice(0, 20);
}
__name(hotWeibo, "hotWeibo");
async function hotDouyin() {
  const r = await fetchTextWithTimeout("https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/", {
    "User-Agent": HOT_MOBILE_UA,
    "Referer": "https://www.douyin.com/",
    "Accept": "application/json, text/plain, */*"
  }, 7e3);
  if (!r) return [];
  const j = JSON.parse(r.text);
  return (j.word_list || []).map(function(x) {
    return hotItem(x.word, x.hot_value, "https://www.douyin.com/search/" + encodeURIComponent(x.word || ""));
  }).filter(Boolean).slice(0, 20);
}
__name(hotDouyin, "hotDouyin");
async function hotBaidu() {
  const r = await fetchTextWithTimeout("https://top.baidu.com/api/board?platform=wise&tab=realtime", {
    "User-Agent": HOT_MOBILE_UA,
    "Referer": "https://top.baidu.com/",
    "Accept": "application/json, text/plain, */*"
  }, 7e3);
  if (!r) return [];
  const j = JSON.parse(r.text);
  const out = [], seen = {};
  (/* @__PURE__ */ __name((function walk(o) {
    if (!o || out.length >= 20) return;
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (typeof o !== "object") return;
    if (typeof o.word === "string" && o.word.trim() && !seen[o.word]) {
      seen[o.word] = 1;
      out.push(hotItem(o.word, o.hotScore || o.hot || 0, o.url || "https://www.baidu.com/s?wd=" + encodeURIComponent(o.word)));
    }
    Object.keys(o).forEach(function(k) {
      walk(o[k]);
    });
  }), "walk"))(j);
  return out.filter(Boolean).slice(0, 20);
}
__name(hotBaidu, "hotBaidu");
async function hotToutiao() {
  const r = await fetchTextWithTimeout("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", {
    "User-Agent": HOT_DESKTOP_UA,
    "Referer": "https://www.toutiao.com/",
    "Accept": "application/json, text/plain, */*"
  }, 7e3);
  if (!r) return [];
  const j = JSON.parse(r.text);
  return (j.data || []).map(function(x) {
    return hotItem(x.Title, x.HotValue, x.Url);
  }).filter(Boolean).slice(0, 20);
}
__name(hotToutiao, "hotToutiao");
async function hotBilibili() {
  const r = await fetchTextWithTimeout("https://s.search.bilibili.com/main/hotword", {
    "User-Agent": HOT_DESKTOP_UA,
    "Referer": "https://www.bilibili.com/",
    "Accept": "application/json, text/plain, */*"
  }, 7e3);
  if (!r) return [];
  const j = JSON.parse(r.text);
  return (j.list || []).map(function(x) {
    const word = x.show_name || x.keyword || "";
    return hotItem(word, x.heat_score, "https://search.bilibili.com/all?keyword=" + encodeURIComponent(word));
  }).filter(Boolean).slice(0, 20);
}
__name(hotBilibili, "hotBilibili");
var HOT_SOURCES = { weibo: hotWeibo, douyin: hotDouyin, baidu: hotBaidu, toutiao: hotToutiao, bilibili: hotBilibili };
async function getHotTopics(source) {
  source = String(source || "").trim().toLowerCase();
  const keys = source && HOT_SOURCES[source] ? [source] : Object.keys(HOT_SOURCES);
  return await Promise.all(keys.map(async function(key) {
    try {
      const items = await HOT_SOURCES[key]();
      return { source: key, label: HOT_LABEL[key] || key, items: items || [] };
    } catch (e) {
      return { source: key, label: HOT_LABEL[key] || key, items: [], error: true };
    }
  }));
}
__name(getHotTopics, "getHotTopics");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const __reqUrl = new URL(request.url);
    if (__reqUrl.hostname === "music.nano315.online") {
      const origin = String(env.MUSIC_ORIGIN || "").replace(/\/+$/, "");
      if (!origin) return new Response("MUSIC_ORIGIN \u672A\u8BBE\u7F6E", { status: 500, headers: CORS });
      const target = origin + __reqUrl.pathname + __reqUrl.search;
      const fwd = new Headers(request.headers);
      fwd.delete("host");
      fwd.delete("content-length");
      try {
        const resp = await fetch(target, {
          method: request.method,
          headers: fwd,
          body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
          redirect: "manual"
        });
        const out = new Headers(resp.headers);
        out.set("Access-Control-Allow-Origin", "*");
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return new Response("proxy error: " + (e && e.message ? e.message : e), { status: 502, headers: CORS });
      }
    }
    if (__reqUrl.pathname === "/font") {
      const target = __reqUrl.searchParams.get("url") || "";
      let tu;
      try {
        tu = new URL(target);
      } catch (e) {
        return new Response("bad font url", { status: 400, headers: CORS });
      }
      if (!/^https?:$/.test(tu.protocol)) return new Response("bad protocol", { status: 400, headers: CORS });
      if (!/\.(woff2?|ttf|otf)$/i.test(tu.pathname)) return new Response("only font files", { status: 400, headers: CORS });
      const host = tu.hostname.toLowerCase();
      if (host === "localhost" || host === "0.0.0.0" || host === "[::1]" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        return new Response("bad host", { status: 400, headers: CORS });
      }
      const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
      const cacheKey = new Request(__reqUrl.origin + "/font?url=" + encodeURIComponent(tu.href), { method: "GET" });
      if (cache) {
        try {
          const hit = await cache.match(cacheKey);
          if (hit) return hit;
        } catch (e) {
        }
      }
      try {
        const resp = await fetch(tu.href, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; NanoFontProxy/1.0)" },
          cf: { cacheEverything: true, cacheTtl: 31536e3 }
        });
        if (!resp.ok) return new Response("font fetch failed: " + resp.status, { status: 502, headers: CORS });
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        const isFont = /font/.test(ct) || /octet-stream/.test(ct) || /\.(woff2?|ttf|otf)$/i.test(tu.pathname);
        if (!isFont) return new Response("not a font", { status: 415, headers: CORS });
        const buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength > 8 * 1024 * 1024) {
          return new Response("font too large", { status: 413, headers: CORS });
        }
        const out = new Headers(CORS);
        out.set("Content-Type", ct && /font|octet-stream/.test(ct) ? ct : "application/octet-stream");
        out.set("Cache-Control", "public, max-age=31536000, immutable");
        out.set("X-Content-Type-Options", "nosniff");
        const res = new Response(buf, { status: 200, headers: out });
        if (cache) {
          try {
            await cache.put(cacheKey, res.clone());
          } catch (e) {
          }
        }
        return res;
      } catch (e) {
        return new Response("font proxy error: " + (e && e.message ? e.message : e), { status: 502, headers: CORS });
      }
    }
    if (/\/fish-tts$/.test(__reqUrl.pathname) && request.method === "POST") {
      const fishOrigin = String(env.FISH_API_ORIGIN || "https://api.fish.audio").replace(/\/+$/, "");
      const fwd = new Headers(request.headers);
      fwd.delete("host");
      fwd.delete("content-length");
      fwd.delete("origin");
      fwd.delete("referer");
      try {
        const resp = await fetch(fishOrigin + "/v1/tts", {
          method: "POST",
          headers: fwd,
          body: request.body
        });
        const out = new Headers(resp.headers);
        out.set("Access-Control-Allow-Origin", "*");
        out.set("Access-Control-Allow-Headers", "*");
        out.set("Cache-Control", "no-store");
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return new Response(JSON.stringify({ message: "fish proxy error: " + (e && e.message ? e.message : e) }), {
          status: 502,
          headers: Object.assign({}, CORS, { "Content-Type": "application/json" })
        });
      }
    }
    if ((/\/fish-models$/.test(__reqUrl.pathname) || /\/fish-model$/.test(__reqUrl.pathname) || /\/fish-model\//.test(__reqUrl.pathname)) && request.method === "GET") {
      const fishOrigin = String(env.FISH_API_ORIGIN || "https://api.fish.audio").replace(/\/+$/, "");
      const isList = /\/fish-models$/.test(__reqUrl.pathname);
      let fishPath = "/model?page_size=100";
      if (!isList) {
        const id = __reqUrl.searchParams.get("id") || (__reqUrl.pathname.split("/fish-model/")[1] || "");
        if (!id) return json({ ok: false, error: "no id" }, 400);
        fishPath = "/model/" + encodeURIComponent(id);
      }
      try {
        const resp = await fetch(fishOrigin + fishPath, {
          headers: {
            "Authorization": request.headers.get("Authorization") || "",
            "Accept": "application/json"
          }
        });
        const text = await resp.text();
        return new Response(text, {
          status: resp.status,
          headers: Object.assign({}, CORS, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
        });
      } catch (e) {
        return json({ ok: false, error: "fish proxy error: " + (e && e.message ? e.message : e) }, 502);
      }
    }
    if (/\/ext-proxy$/.test(__reqUrl.pathname)) {
      const raw = __reqUrl.searchParams.get("url") || "";
      let target = null;
      try {
        target = new URL(raw);
      } catch (e) {
      }
      const allowed = ["api.elevenlabs.io", "api.minimax.io", "api.minimaxi.com", "api.minimax.chat", "api.novelai.net", "image.novelai.net"];
      if (!target || allowed.indexOf(target.hostname) === -1) return json({ ok: false, error: "host not allowed" }, 403);
      const fwd = new Headers();
      ["authorization", "xi-api-key", "content-type", "accept"].forEach(function(h) {
        const v = request.headers.get(h);
        if (v) fwd.set(h, v);
      });
      try {
        const resp = await fetch(target.href, {
          method: request.method,
          headers: fwd,
          body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body
        });
        const out = new Headers();
        out.set("Access-Control-Allow-Origin", "*");
        out.set("Access-Control-Allow-Headers", "*");
        out.set("Cache-Control", "no-store");
        const ct = resp.headers.get("content-type");
        if (ct) out.set("Content-Type", ct);
        return new Response(resp.body, { status: resp.status, headers: out });
      } catch (e) {
        return json({ ok: false, error: "ext proxy error: " + (e && e.message ? e.message : e) }, 502);
      }
    }
    let pathname = __reqUrl.pathname;
    if (pathname.indexOf("/nanoapi") === 0) pathname = pathname.slice("/nanoapi".length) || "/";
    if (pathname === "/link/preview" && request.method === "GET") {
      if (!autoOk(request, env, null)) return json({ ok: false, error: "unauthorized" }, 401);
      const target = new URL(request.url).searchParams.get("url") || "";
      const data = await fetchLinkPreview(target);
      if (!data) return json({ ok: false, error: "blocked" }, 200);
      return json(Object.assign({ ok: true }, data));
    }
    if (pathname === "/hot" && request.method === "GET") {
      const source = new URL(request.url).searchParams.get("source") || "";
      const sources = await getHotTopics(source);
      return json({ ok: true, updatedAt: Date.now(), sources });
    }
    if (pathname === "/vapid" && request.method === "GET") {
      const v = await ensureVapid(env);
      return json({ ok: !!v, key: v ? v.publicKey : "" });
    }
    if (pathname === "/subscribe" && request.method === "POST") {
      const body = await request.json().catch(function() {
        return {};
      });
      const subscription = body.subscription;
      if (!subscription || !subscription.endpoint) return json({ ok: false, error: "no subscription" }, 400);
      subscription.userId = cleanUserId(body.userId);
      subscription.deviceId = cleanDeviceId(body.deviceId);
      subscription.appId = cleanAppId(body.appId);
      subscription.ua = String(body.ua || "");
      subscription.platform = String(body.platform || "");
      await kv(env).put(subKey(subscription.endpoint, subscription.appId, subscription.deviceId, subscription.userId), JSON.stringify(subscription));
      try {
        await kv(env).delete(subId(subscription.endpoint));
      } catch (e) {
      }
      return json({ ok: true });
    }
    if (pathname === "/schedule" && request.method === "POST") {
      if (!tokenOk(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
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
        const id = "job:" + Number(job.at) + ":" + Math.random().toString(36).slice(2, 8);
        await kv(env).put(id, JSON.stringify(job));
        try {
          await addJobId(env, id);
        } catch (e) {
        }
        count++;
      }
      return json({ ok: true, count });
    }
    if (pathname === "/unsubscribe" && request.method === "POST") {
      const { endpoint } = await request.json();
      if (endpoint) await kv(env).delete(subId(endpoint));
      return json({ ok: true });
    }
    if (pathname === "/send" && request.method === "POST") {
      if (!tokenOk(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      const count = await sendAll(env, { title: "Nano", body: "\u6D4B\u8BD5\u63A8\u9001\uFF1A\u6536\u5230\u5C31\u6210\u529F\u4E86", target: "" });
      return json({ ok: true, count });
    }
    if (pathname === "/peek" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!peekOk(request, env, body)) {
        return json({
          ok: false,
          error: "unauthorized",
          reply: peekPublic(env) ? "\u4EE4\u724C\u592A\u77ED\u6216\u4E3A\u7A7A\uFF1A\u8BF7\u4ECE\u7AA5\u5C4F\u9875\u91CD\u65B0\u590D\u5236\u4EE4\u724C / JSON\u3002" : "\u4EE4\u724C\u4E0D\u4E00\u81F4\uFF1A\u8BF7\u628A Worker \u7684 PEEK_TOKEN \u548C\u7AA5\u5C4F\u9875\u91CC\u751F\u6210\u7684\u4EE4\u724C\u6539\u6210\u540C\u4E00\u4E2A\u3002"
        }, 401);
      }
      const token = peekTokenValue(request, body);
      const requestedChatId = String(body.chatId || "").trim();
      let owner = {};
      try {
        const rawOwner = await kv(env).get(peekOwnerKey(env, token, requestedChatId || "latest"));
        if (rawOwner) owner = JSON.parse(rawOwner) || {};
      } catch (e) {
        owner = {};
      }
      const realAppId = cleanAppId(body.appId || owner.appId || "legacy");
      const appId = peekScope(env, realAppId, token);
      let chatId = requestedChatId;
      if (!chatId) {
        try {
          chatId = String(await kv(env).get(peekBase(appId, "chat:latest")) || "").trim();
        } catch (e) {
        }
      }
      if (!chatId) chatId = "default";
      if (!owner.appId) {
        try {
          const rawOwner2 = await kv(env).get(peekOwnerKey(env, token, chatId));
          if (rawOwner2) owner = JSON.parse(rawOwner2) || {};
        } catch (e) {
        }
      }
      if (!owner.appId && peekPublic(env)) {
        try {
          const rawOld = await kv(env).get("peek2:owner:" + chatId);
          if (rawOld) owner = JSON.parse(rawOld) || {};
        } catch (e) {
        }
      }
      let system = "";
      try {
        system = await kv(env).get(peekBase(appId, "persona:" + chatId)) || await kv(env).get(peekBase(appId, "persona:latest")) || "";
      } catch (e) {
      }
      if (!system) system = String(body.system || "");
      const charName = peekCharName(system);
      if (!system && !peekPublic(env)) {
        try {
          const deviceId = cleanDeviceId(owner && owner.deviceId || body.deviceId);
          let userId = cleanUserId(owner && owner.userId || body.userId);
          if (!userId || userId === "default") {
            const rawActive = await kv(env).get(autoActiveKey(realAppId, deviceId));
            if (rawActive) {
              const active = JSON.parse(rawActive);
              if (active && active.userId) userId = cleanUserId(active.userId);
            }
          }
          const rawCfg = await kv(env).get(autoKey("config", realAppId, deviceId, userId));
          if (rawCfg) {
            const cfg = JSON.parse(rawCfg);
            const c = (cfg && Array.isArray(cfg.chars) ? cfg.chars : []).find(function(x) {
              return x && String(x.id) === String(chatId);
            });
            if (c) system = "\u4F60\u662F\u300C" + (c.name || "TA") + "\u300D\u3002" + String(c.setting || "");
          }
        } catch (e) {
        }
      }
      const text = String(body.text || "").trim();
      const image = String(body.image || "").trim();
      if (!text && !image) {
        return json({ ok: false, error: "empty", reply: "\u6CA1\u6709\u6536\u5230\u5C4F\u5E55\u5185\u5BB9\uFF1A\u8BF7\u5728\u5FEB\u6377\u6307\u4EE4\u91CC\u4F20\u5165\u622A\u56FE\u6216\u6587\u5B57\u3002" }, 400);
      }
      const history = await peekTurns(env, chatId, appId);
      const apiCfg = await peekApiConfig(env, appId, chatId, body, owner, realAppId);
      let context = [];
      try {
        const rawCtx = await kv(env).get(peekBase(appId, "context:" + chatId)) || await kv(env).get(peekBase(appId, "context:latest"));
        if (rawCtx) {
          const parsed = JSON.parse(rawCtx);
          if (Array.isArray(parsed)) context = parsed;
        }
      } catch (e) {
      }
      let reply = null;
      try {
        reply = await peekModel(env, system, text, image, history, apiCfg, context);
      } catch (e) {
      }
      if (!reply) {
        const hasEnvApi = !peekPublic(env) && !!(env.PEEK_API_URL && env.PEEK_API_KEY && env.PEEK_MODEL);
        return json({
          ok: false,
          error: "model",
          reply: peekPublic(env) ? "\u516C\u7528\u7AA5\u5C4F\u4E0D\u4F1A\u4F7F\u7528\u7AD9\u957F\u7684 API\uFF1A\u8BF7\u5728\u4F60\u81EA\u5DF1\u7684 Nano \u91CC\u914D\u7F6E\u4E3B API\uFF08\u6700\u597D\u652F\u6301\u8BC6\u56FE\uFF09\uFF0C\u5E76\u6253\u5F00\u4E00\u6B21\u804A\u5929\u6216\u7AA5\u5C4F\u9875\u4FDD\u5B58\u914D\u7F6E\uFF0C\u628A Key \u540C\u6B65\u5230\u4F60\u81EA\u5DF1\u7684\u4EE4\u724C\u5206\u533A\u3002\u5982\u679C\u5DF2\u7ECF\u914D\u7F6E\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u662F\u5426\u652F\u6301\u56FE\u7247\u3002" : hasEnvApi ? "\u6A21\u578B\u6CA1\u6709\u8FD4\u56DE\u5185\u5BB9\uFF1A\u8BF7\u68C0\u67E5 PEEK_API_URL / PEEK_API_KEY / PEEK_MODEL \u6216\u6A21\u578B\u662F\u5426\u652F\u6301\u8BC6\u56FE\u3002" : "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u6A21\u578B API\uFF1A\u8BF7\u5728 Nano \u91CC\u6253\u5F00\u4E00\u6B21\u804A\u5929\u540C\u6B65\u4E3B API\uFF0C\u6216\u5728 Worker \u914D\u7F6E PEEK_API_URL / PEEK_API_KEY / PEEK_MODEL\u3002"
        }, 502);
      }
      const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
      const imageStore = image && image.length <= MAX_IMAGE_CHARS ? image : "";
      history.push({
        user: text || (image ? "" : "[\u56FE\u7247]"),
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
      try {
        const targetUser = owner.userId || body.userId || "";
        const targetDevice = owner.deviceId || body.deviceId || "";
        const subs = targetUser || targetDevice ? await getSubs(env, targetUser || null, targetDevice || null, realAppId) : [];
        if (subs.length) {
          await pushAll(subs, { title: charName || "\u7AA5\u5C4F", body: String(reply).slice(0, 120), target: "chat:" + chatId, tag: "peek-" + chatId, appId: realAppId }, env);
        }
      } catch (e) {
      }
      return json({
        ok: true,
        // 快捷指令的「显示提醒」直接取 reply，所以在前面带上角色名；聊天里仍用干净的 text。
        reply: charName ? "\u300C" + charName + "\u300D\n" + reply : reply,
        text: reply,
        name: charName
      });
    }
    if (pathname === "/peek/persona" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!peekOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      const system = String(body.system || "").trim();
      if (!system) return json({ ok: false, error: "empty" }, 400);
      const chatId = String(body.chatId || "latest");
      const token = peekTokenValue(request, body);
      const realAppId = cleanAppId(body.appId);
      const appId = peekScope(env, realAppId, token);
      const ttl = 60 * 60 * 24 * 30;
      try {
        await kv(env).put(peekBase(appId, "persona:" + chatId), system, { expirationTtl: ttl });
        await kv(env).put(peekBase(appId, "persona:latest"), system, { expirationTtl: ttl });
        const api = body.api && typeof body.api === "object" ? {
          url: String(body.api.url || "").trim(),
          key: String(body.api.key || "").trim(),
          model: String(body.api.model || "").trim()
        } : null;
        if (api && api.url && api.key && api.model) {
          await kv(env).put(peekBase(appId, "api:" + chatId), JSON.stringify(api), { expirationTtl: ttl });
          await kv(env).put(peekBase(appId, "api:latest"), JSON.stringify(api), { expirationTtl: ttl });
        }
        if (Array.isArray(body.history)) {
          const history = body.history.slice(-12).map(function(m) {
            return {
              role: m && m.role === "assistant" ? "assistant" : "user",
              content: String(m && m.content || "").slice(0, 1200)
            };
          }).filter(function(m) {
            return m.content;
          });
          await kv(env).put(peekBase(appId, "context:" + chatId), JSON.stringify(history), { expirationTtl: ttl });
          await kv(env).put(peekBase(appId, "context:latest"), JSON.stringify(history), { expirationTtl: ttl });
        }
        const ownerRecord = JSON.stringify({
          appId: realAppId,
          deviceId: cleanDeviceId(body.deviceId),
          userId: cleanUserId(body.userId),
          at: Date.now()
        });
        await kv(env).put(peekOwnerKey(env, token, chatId), ownerRecord, { expirationTtl: ttl });
        if (chatId && chatId !== "latest") {
          await kv(env).put(peekBase(appId, "chat:latest"), chatId, { expirationTtl: ttl });
        }
        await kv(env).put(peekOwnerKey(env, token, "latest"), ownerRecord, { expirationTtl: ttl });
      } catch (e) {
      }
      return json({ ok: true });
    }
    if (pathname === "/peek/pending" && (request.method === "GET" || request.method === "POST")) {
      let body = {};
      if (request.method === "POST") {
        try {
          body = await request.json();
        } catch (e) {
        }
      }
      if (!peekOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      let chatId = String(body && body.chatId || "");
      let appId = String(body && body.appId || "");
      if (!chatId) {
        try {
          chatId = new URL(request.url).searchParams.get("chatId") || "";
        } catch (e) {
        }
      }
      if (!appId) {
        try {
          appId = new URL(request.url).searchParams.get("appId") || "";
        } catch (e) {
        }
      }
      if (!chatId) return json({ ok: false, error: "no chatId" }, 400);
      const token = peekTokenValue(request, body);
      const scope = peekScope(env, appId, token);
      let turns = await peekTurns(env, chatId, scope);
      if (!turns.length) {
        const legacyScope = peekScope(env, "legacy", token);
        if (legacyScope !== scope) turns = await peekTurns(env, chatId, legacyScope);
      }
      return json({ ok: true, turns });
    }
    if (pathname === "/peek/ack" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!peekOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      const chatId = String(body.chatId || "");
      if (chatId) {
        const token = peekTokenValue(request, body);
        const scope = peekScope(env, body.appId, token);
        await peekSave(env, chatId, [], scope);
        const legacyScope = peekScope(env, "legacy", token);
        if (legacyScope !== scope) await peekSave(env, chatId, [], legacyScope);
      }
      return json({ ok: true });
    }
    if (pathname === "/auto/config" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!autoOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      const cfg = sanitizeAutoConfig(body);
      const appId = cleanAppId(body.appId);
      const deviceId = cleanDeviceId(body.deviceId);
      const userId = cleanUserId(cfg.user.id || body.userId);
      const cfgKey = autoKey("config", appId, deviceId, userId);
      let oldCfgRaw = "";
      try {
        oldCfgRaw = await kv(env).get(cfgKey);
      } catch (e) {
        oldCfgRaw = "";
      }
      let cfgChanged = true;
      let oldCfg = null;
      if (oldCfgRaw) {
        try {
          oldCfg = JSON.parse(oldCfgRaw);
        } catch (e) {
          oldCfg = null;
        }
        if (oldCfg && oldCfg.barkKey && !cfg.barkKey) cfg.barkKey = oldCfg.barkKey;
        try {
          cfgChanged = autoConfigSig(oldCfg) !== autoConfigSig(cfg);
        } catch (e) {
          cfgChanged = true;
        }
      }
      if (cfgChanged) await kv(env).put(cfgKey, JSON.stringify(cfg));
      try {
        const scope = autoScopeOf(appId, deviceId, userId);
        if (cfg.enabled) await addAutoScope(env, scope);
        else await removeAutoScope(env, scope);
      } catch (e) {
      }
      try {
        await touchActive(env, appId, deviceId, userId, false);
      } catch (e) {
      }
      const now = Date.now();
      const stateKey = autoKey("state", appId, deviceId, userId);
      let state = {};
      let stateRaw = "";
      try {
        stateRaw = await kv(env).get(stateKey);
        state = stateRaw ? JSON.parse(stateRaw) : {};
      } catch (e) {
        state = {};
        stateRaw = "";
      }
      const reset = !!body.reset;
      if (cfg.msgEnabled) {
        const intervalMs = cfg.intervalMinutes * 60 * 1e3;
        if (!state.nextMsgAt || reset) {
          state.nextMsgAt = now + intervalMs;
        } else if (state.msgMins && state.msgMins !== cfg.intervalMinutes) {
          state.nextMsgAt = Math.min(Number(state.nextMsgAt) || 0, now + intervalMs);
          if (state.nextMsgAt < now + 60 * 1e3) state.nextMsgAt = now + 60 * 1e3;
        }
        state.msgMins = cfg.intervalMinutes;
      } else {
        state.nextMsgAt = 0;
        state.msgMins = cfg.intervalMinutes;
      }
      if (cfg.momentEnabled) {
        const intervalMs = cfg.momentIntervalHours * 3600 * 1e3;
        if (!state.nextMomentAt || reset) {
          state.nextMomentAt = now + intervalMs;
        } else if (state.momentHours && state.momentHours !== cfg.momentIntervalHours) {
          state.nextMomentAt = Math.min(Number(state.nextMomentAt) || 0, now + intervalMs);
          if (state.nextMomentAt < now + 60 * 1e3) state.nextMomentAt = now + 60 * 1e3;
        }
        state.momentHours = cfg.momentIntervalHours;
      } else {
        state.nextMomentAt = 0;
        state.momentHours = cfg.momentIntervalHours;
      }
      let stateChanged = true;
      if (stateRaw) {
        try {
          stateChanged = JSON.stringify(JSON.parse(stateRaw)) !== JSON.stringify(state);
        } catch (e) {
          stateChanged = true;
        }
      }
      if (stateChanged) await kv(env).put(stateKey, JSON.stringify(state));
      return json({ ok: true, enabled: cfg.enabled, appId, deviceId, userId, nextMsgAt: state.nextMsgAt || 0, nextMomentAt: state.nextMomentAt || 0 });
    }
    if (pathname === "/auto/cycle" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!autoOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const cycles = body.cycles && typeof body.cycles === "object" ? body.cycles : {};
        const scopePrefix = autoKey("config", body.appId, body.deviceId, body.userId);
        const { keys } = await kv(env).list({ prefix: scopePrefix });
        for (const k of keys) {
          const raw = await kv(env).get(k.name);
          if (!raw) continue;
          const cfg = JSON.parse(raw);
          (cfg.chars || []).forEach(function(c) {
            const cy = cycles[c.id];
            c.cycle = cy && /^\d{4}-\d{2}-\d{2}$/.test(String(cy.lastStart || "")) ? {
              lastStart: String(cy.lastStart),
              nextStart: /^\d{4}-\d{2}-\d{2}$/.test(String(cy.nextStart || "")) ? String(cy.nextStart) : "",
              cycleLength: Math.max(18, Math.min(60, parseInt(cy.cycleLength, 10) || 28)),
              periodLength: Math.max(2, Math.min(14, parseInt(cy.periodLength, 10) || 5)),
              remindDays: Math.max(0, Math.min(14, parseInt(cy.remindDays, 10) || 0))
            } : null;
          });
          await kv(env).put(k.name, JSON.stringify(cfg));
        }
      } catch (e) {
      }
      return json({ ok: true });
    }
    if (pathname === "/auto/call" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!autoOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      const appId = cleanAppId(body.appId);
      const userId = cleanUserId(body.userId);
      const chatId = String(body.chatId || "");
      const active = !!body.active && !!chatId;
      const key = "auto2:call:" + appId + ":" + userId;
      try {
        if (active) await kv(env).put(key, chatId, { expirationTtl: 60 * 60 * 3 });
        else await kv(env).delete(key);
      } catch (e) {
      }
      return json({ ok: true });
    }
    if (pathname === "/auto/pending") {
      if (!autoOk(request, env, null)) return json({ ok: false, error: "unauthorized" }, 401);
      const sp = new URL(request.url).searchParams;
      const appId = cleanAppId(sp.get("appId"));
      const userId = cleanUserId(sp.get("userId"));
      const deviceId = cleanDeviceId(sp.get("deviceId"));
      try {
        await touchActive(env, appId, deviceId, userId, false);
      } catch (e) {
      }
      let messages = [], moments = [];
      try {
        const raw = await kv(env).get(autoKey("msg", appId, deviceId, userId));
        messages = raw ? JSON.parse(raw) : [];
      } catch (e) {
      }
      try {
        const raw = await kv(env).get(autoKey("moments", appId, deviceId, userId));
        moments = raw ? JSON.parse(raw) : [];
      } catch (e) {
      }
      return json({ ok: true, appId, messages, moments });
    }
    if (pathname === "/auto/ack" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (!autoOk(request, env, body)) return json({ ok: false, error: "unauthorized" }, 401);
      const appId = cleanAppId(body.appId);
      const userId = cleanUserId(body.userId);
      const deviceId = cleanDeviceId(body.deviceId);
      const mIds = Array.isArray(body.messageIds) ? body.messageIds : [];
      const pIds = Array.isArray(body.momentIds) ? body.momentIds : [];
      if (mIds.length) {
        try {
          const key = autoKey("msg", appId, deviceId, userId);
          const raw = await kv(env).get(key);
          const list = raw ? JSON.parse(raw) : [];
          await kv(env).put(key, JSON.stringify(list.filter(function(x) {
            return x && mIds.indexOf(x.id) < 0;
          })));
        } catch (e) {
        }
      }
      if (pIds.length) {
        try {
          const key = autoKey("moments", appId, deviceId, userId);
          const raw = await kv(env).get(key);
          const list = raw ? JSON.parse(raw) : [];
          await kv(env).put(key, JSON.stringify(list.filter(function(x) {
            return x && pIds.indexOf(x.id) < 0;
          })));
        } catch (e) {
        }
      }
      return json({ ok: true });
    }
    async function readMarketCounts() {
      try {
        const raw = await marketKv(env).get("market:counts");
        return raw ? JSON.parse(raw) || {} : {};
      } catch (e) {
        return {};
      }
    }
    __name(readMarketCounts, "readMarketCounts");
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
    __name(mergeMarketCounts, "mergeMarketCounts");
    if (pathname === "/market/list" && request.method === "GET") {
      if (supabaseConf(env)) {
        try {
          const rows = await supabase(env, "/rest/v1/market_items?select=id,summary,likes,downloads,imports&order=created_at.desc&limit=500");
          let items2 = Array.isArray(rows) ? rows.map(marketRowToSummary) : [];
          let legacy = [];
          try {
            const raw = await marketKv(env).get("market:index");
            legacy = raw ? JSON.parse(raw) : [];
          } catch (e) {
            legacy = [];
          }
          if (Array.isArray(legacy) && legacy.length && String(env.INCLUDE_LEGACY_MARKET || "1") !== "0") {
            const seen = {};
            items2.forEach(function(x) {
              if (x && x.id) seen[x.id] = 1;
            });
            const counts2 = await readMarketCounts();
            legacy.forEach(function(x) {
              if (x && x.id && !seen[x.id]) items2.push(mergeMarketCounts(Object.assign({}, x), counts2));
            });
          }
          return json({ ok: true, items: items2 });
        } catch (e) {
          console.warn("[market] supabase list failed, fallback KV:", e && e.message);
        }
      }
      let items = [];
      try {
        const raw = await marketKv(env).get("market:index");
        items = raw ? JSON.parse(raw) : [];
      } catch (e) {
        items = [];
      }
      const counts = await readMarketCounts();
      items = (Array.isArray(items) ? items : []).map(function(x) {
        return mergeMarketCounts(x, counts);
      });
      return json({ ok: true, items });
    }
    if (pathname === "/market/item" && request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id") || "";
      if (!id) return json({ ok: false, error: "no id" }, 400);
      if (supabaseConf(env)) {
        try {
          const rows = await supabase(env, "/rest/v1/market_items?id=eq." + encodeURIComponent(id) + "&select=id,item,likes,downloads,imports&limit=1");
          if (Array.isArray(rows) && rows[0]) return json({ ok: true, item: marketRowToItem(rows[0]) });
        } catch (e) {
          console.warn("[market] supabase item failed, fallback KV:", e && e.message);
        }
      }
      const raw = await marketKv(env).get("market:post:" + id);
      if (!raw) return json({ ok: false, error: "not found" }, 404);
      let rec;
      try {
        rec = JSON.parse(raw);
      } catch (e) {
        return json({ ok: false }, 500);
      }
      const counts = await readMarketCounts();
      return json({ ok: true, item: mergeMarketCounts(rec.item, counts) });
    }
    if (pathname === "/market/post" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      const item = body.item, summary = body.summary, token = String(body.token || "");
      if (!item || !item.id) return json({ ok: false, error: "no item" }, 400);
      const payload = JSON.stringify({ item, tok: token });
      if (payload.length > 24 * 1024 * 1024) return json({ ok: false, error: "too large" }, 413);
      if (supabaseConf(env)) {
        try {
          await supabase(env, "/rest/v1/market_items?on_conflict=id", {
            method: "POST",
            headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
            body: {
              id: String(item.id),
              summary: summary || {},
              item,
              token,
              likes: Number(item.likes) || 0,
              downloads: Number(item.downloads) || 0,
              imports: Number(item.imports) || 0,
              updated_at: (/* @__PURE__ */ new Date()).toISOString()
            }
          });
          return json({ ok: true, id: item.id });
        } catch (e) {
          console.warn("[market] supabase post failed, fallback KV:", e && e.message);
        }
      }
      await marketKv(env).put("market:post:" + item.id, payload);
      let items = [];
      try {
        const raw = await marketKv(env).get("market:index");
        items = raw ? JSON.parse(raw) : [];
      } catch (e) {
        items = [];
      }
      items = items.filter((x) => x && x.id !== item.id);
      if (summary) items.unshift(summary);
      if (items.length > 500) items = items.slice(0, 500);
      await marketKv(env).put("market:index", JSON.stringify(items));
      return json({ ok: true, id: item.id });
    }
    if (pathname === "/market/count" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      const id = String(body.id || ""), field = String(body.field || ""), delta = Number(body.delta) || 0;
      if (!id || ["likes", "downloads", "imports"].indexOf(field) < 0) return json({ ok: false, error: "bad" }, 400);
      if (supabaseConf(env)) {
        try {
          const value = await supabase(env, "/rest/v1/rpc/market_increment", {
            method: "POST",
            body: { p_id: id, p_field: field, p_delta: delta }
          });
          let v = value;
          if (v && typeof v === "object") v = v.market_increment != null ? v.market_increment : Object.values(v)[0];
          if (Number(v) > 0) return json({ ok: true, value: Number(v) || 0 });
        } catch (e) {
          console.warn("[market] supabase count failed, fallback KV:", e && e.message);
        }
      }
      const key = "market:post:" + id;
      const raw = await marketKv(env).get(key);
      if (!raw) return json({ ok: false, error: "not found" }, 404);
      let rec;
      try {
        rec = JSON.parse(raw);
      } catch (e) {
        return json({ ok: false }, 500);
      }
      const counts = await readMarketCounts();
      const cur = counts[id] || {
        likes: Number(rec.item.likes) || 0,
        downloads: Number(rec.item.downloads) || 0,
        imports: Number(rec.item.imports) || 0
      };
      cur[field] = Math.max(0, (Number(cur[field]) || 0) + delta);
      counts[id] = cur;
      await marketKv(env).put("market:counts", JSON.stringify(counts));
      return json({ ok: true, value: cur[field] });
    }
    if (pathname === "/market/delete" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      const id = String(body.id || ""), token = String(body.token || "");
      if (supabaseConf(env)) {
        try {
          const rows = await supabase(env, "/rest/v1/market_items?id=eq." + encodeURIComponent(id) + "&select=token&limit=1");
          if (Array.isArray(rows) && rows[0]) {
            if (rows[0].token && rows[0].token !== token) return json({ ok: false, error: "forbidden" }, 403);
            await supabase(env, "/rest/v1/market_items?id=eq." + encodeURIComponent(id), { method: "DELETE" });
            return json({ ok: true });
          }
        } catch (e) {
          console.warn("[market] supabase delete failed, fallback KV:", e && e.message);
        }
      }
      const key = "market:post:" + id;
      const raw = await marketKv(env).get(key);
      if (!raw) return json({ ok: false, error: "not found" }, 404);
      let rec;
      try {
        rec = JSON.parse(raw);
      } catch (e) {
        return json({ ok: false }, 500);
      }
      if (rec.tok && rec.tok !== token) return json({ ok: false, error: "forbidden" }, 403);
      await marketKv(env).delete(key);
      let items = [];
      try {
        const rawIdx = await marketKv(env).get("market:index");
        items = rawIdx ? JSON.parse(rawIdx) : [];
      } catch (e) {
        items = [];
      }
      items = items.filter((x) => x && x.id !== id);
      await marketKv(env).put("market:index", JSON.stringify(items));
      return json({ ok: true });
    }
    if (pathname === "/mcp/proxy" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
      }
      if (env.MCP_TOKEN && request.headers.get("X-Mcp-Token") !== env.MCP_TOKEN) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const target = String(body.url || "");
      if (!/^https:\/\//i.test(target)) return json({ ok: false, error: "bad url" }, 400);
      const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
      if (body.token) headers["Authorization"] = "Bearer " + String(body.token);
      if (body.sessionId) headers["Mcp-Session-Id"] = String(body.sessionId);
      if (body.headers && typeof body.headers === "object") {
        for (const k in body.headers) {
          if (/^[A-Za-z0-9-]+$/.test(k)) headers[k] = String(body.headers[k]);
        }
      }
      try {
        const resp = await fetch(target, {
          method: body.method || "POST",
          headers,
          body: body.body ? JSON.stringify(body.body) : void 0
        });
        const text = await resp.text();
        return json({
          ok: true,
          status: resp.status,
          contentType: resp.headers.get("content-type") || "",
          sessionId: resp.headers.get("mcp-session-id") || "",
          text
        });
      } catch (e) {
        return json({ ok: false, error: "fetch failed: " + (e && e.message ? e.message : e) }, 502);
      }
    }
    return json({ ok: true, info: "nano-push alive" });
  },
  // 每 5 分钟触发：到点给 Bark 发提醒 + 处理 KV 里的预约任务
  async scheduled(event, env, ctx) {
    try {
      await sendBarkReminder(env);
    } catch (e) {
    }
    try {
      const scopes = await getAutoScopes(env);
      for (const scope of scopes) {
        const parts = String(scope || "").split(":");
        const appId = parts[0] || "legacy";
        const deviceId = parts[1] || "default";
        const userId = parts[2] || "default";
        try {
          await runAutoPush(env, appId, deviceId, userId);
        } catch (e) {
        }
      }
    } catch (e) {
    }
    const now = Date.now();
    let jobIds = await readIndex(env, JOB_INDEX_KEY);
    if (jobIds === null) {
      try {
        const { keys } = await kv(env).list({ prefix: "job:" });
        jobIds = (keys || []).map(function(k) {
          return k.name;
        }).filter(function(id) {
          return id !== JOB_INDEX_KEY;
        });
        await writeIndex(env, JOB_INDEX_KEY, jobIds);
      } catch (e) {
        jobIds = [];
      }
    }
    const dueIds = [];
    const keepIds = [];
    for (const id of jobIds) {
      const at = parseInt(String(id).split(":")[1], 10) || 0;
      if (at && at <= now) dueIds.push(id);
      else keepIds.push(id);
    }
    if (!dueIds.length) return;
    await writeIndex(env, JOB_INDEX_KEY, keepIds);
    const subsCache = {};
    async function jobSubs(job) {
      const jobApp = job.appId ? cleanAppId(job.appId) : "legacy";
      const k = jobApp + "|" + cleanDeviceId(job.deviceId) + "|" + cleanUserId(job.userId);
      if (!subsCache[k]) subsCache[k] = await getSubs(env, job.userId || null, job.deviceId || null, jobApp);
      return subsCache[k];
    }
    __name(jobSubs, "jobSubs");
    for (const id of dueIds) {
      let raw = "";
      try {
        raw = await kv(env).get(id);
      } catch (e) {
        raw = "";
      }
      try {
        await kv(env).delete(id);
      } catch (e) {
      }
      if (!raw) continue;
      let job;
      try {
        job = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      const jobPayload = { title: job.title || "Nano", body: job.body || "", target: job.target || "", appId: cleanAppId(job.appId) };
      let sent = 0;
      if (job.barkKey) {
        try {
          if (await sendBarkKey(env, job.barkKey, jobPayload)) sent = 1;
        } catch (e) {
          sent = 0;
        }
      }
      if (!sent) {
        let subs = await jobSubs(job);
        if (subs.length) {
          try {
            sent = await pushAll(subs, jobPayload, env);
          } catch (e) {
            sent = 0;
          }
        }
      }
      if (!sent && !job.barkKey && !job.appId && env.BARK_KEY) {
        try {
          await sendBarkKey(env, env.BARK_KEY, jobPayload);
        } catch (e) {
        }
      }
    }
  }
};
async function sendBarkReminder(env) {
  const key = env.BARK_KEY;
  if (!key) return;
  const times = String(env.REMIND_TIMES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const text = String(env.REMIND_TEXT || "").trim();
  if (!times.length || !text) return;
  if (text === "\u6709\u4EBA\u60F3\u4F60\u4E86\uFF0C\u70B9\u5F00\u770B\u770B\uFF5E") return;
  const bj = new Date(Date.now() + 8 * 3600 * 1e3);
  const cur = String(bj.getUTCHours()).padStart(2, "0") + ":" + String(bj.getUTCMinutes()).padStart(2, "0");
  if (!times.includes(cur)) return;
  const base = String(key).indexOf("http") === 0 ? String(key).replace(/\/+$/, "") : "https://api.day.app/" + encodeURIComponent(key);
  const url = base + "/" + encodeURIComponent("Nano \u63D0\u9192") + "/" + encodeURIComponent(text) + "?group=Nano&level=passive";
  try {
    await fetch(url);
  } catch (e) {
  }
}
__name(sendBarkReminder, "sendBarkReminder");
async function getSubs(env, userId, deviceId, appId) {
  const out = [];
  const seen = {};
  const wantApp = appId ? cleanAppId(appId) : "";
  const wantUser = userId ? cleanUserId(userId) : "";
  const wantDevice = deviceId ? cleanDeviceId(deviceId) : "";
  let keys = [];
  try {
    let prefix = "sub2:";
    if (wantApp && wantDevice && wantUser) prefix = "sub2:" + wantApp + ":" + wantDevice + ":" + wantUser + ":";
    else if (wantApp && wantDevice) prefix = "sub2:" + wantApp + ":" + wantDevice + ":";
    else if (wantApp) prefix = "sub2:" + wantApp + ":";
    const r = await kv(env).list({ prefix });
    keys = r.keys || [];
    if (!keys.length) {
      const legacy = await kv(env).list({ prefix: "sub:" });
      keys = legacy.keys || [];
    }
  } catch (e) {
    return out;
  }
  for (const k of keys) {
    const v = await kv(env).get(k.name);
    if (!v) continue;
    try {
      const s = JSON.parse(v);
      if (!s || !s.endpoint) continue;
      const subApp = cleanAppId(s.appId);
      if (wantApp && subApp !== wantApp) continue;
      if (wantDevice && cleanDeviceId(s.deviceId) !== wantDevice) continue;
      if (wantUser && cleanUserId(s.userId) !== wantUser) continue;
      if (seen[s.endpoint]) continue;
      seen[s.endpoint] = 1;
      out.push(s);
    } catch (e) {
    }
  }
  return out;
}
__name(getSubs, "getSubs");
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
      if (resp && (resp.status === 404 || resp.status === 410)) {
        try {
          await kv(env).delete(subKey(sub.endpoint, sub.appId, sub.deviceId, sub.userId));
        } catch (e) {
        }
        try {
          await kv(env).delete(subId(sub.endpoint));
        } catch (e) {
        }
      }
    } catch (e) {
    }
  }
  return sent;
}
__name(pushAll, "pushAll");
async function sendAll(env, payload) {
  const subs = await getSubs(env);
  await pushAll(subs, payload, env);
  return subs.length;
}
__name(sendAll, "sendAll");
export {
  index_default as default
};
