// ============================================================
// character.js - 角色库管理（IndexedDB 存储）
// ============================================================
(function() {
    'use strict';

    const DB_NAME = 'nano_characters_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'characters';

    // ===== 人设数据键名（当前项目为 nano；兼容旧键，避免丢数据） =====
    const HOME_KEY = 'nano_mask_data';
    const LEGACY_HOME_KEYS = ['nano_home_data', 'peach_home_data'];

    // ===== 世界书数据键名（与 worldbook.js v5 保持一致） =====
    const WB_CACHE_KEY = 'nano_worldbook_data_v5';
    const LEGACY_WB_KEY = 'peach_worldbook_data';
    const WB_DB = 'nano_worldbook_db';
    const WB_STORE = 'worldbook_data';

    // ===== 解析库按需加载（本地优先，失败回退 CDN）→ 页面秒开不阻塞 =====
    const MAMMOTH_SOURCES = [
        (window.NANO_ROOT || '') + 'js/mammoth.browser.min.js',
        'https://cdn.bootcdn.net/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
    ];
    const PAKO_SOURCES = [
        (window.NANO_ROOT || '') + 'js/pako.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js'
    ];
    let _libPromises = {};

    function loadScriptLazy(sources) {
        const key = sources[0];
        if (_libPromises[key]) return _libPromises[key];
        _libPromises[key] = new Promise(function(resolve, reject) {
            let idx = 0;
            (function tryNext() {
                if (idx >= sources.length) { _libPromises[key] = null; reject(new Error('解析库加载失败')); return; }
                const src = sources[idx++];
                const s = document.createElement('script');
                s.src = src;
                let done = false;
                const timer = setTimeout(function() {
                    if (done) return;
                    done = true;
                    if (s.parentNode) s.parentNode.removeChild(s);
                    tryNext();
                }, 15000);
                s.onload = function() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve();
                };
                s.onerror = function() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (s.parentNode) s.parentNode.removeChild(s);
                    tryNext();
                };
                document.head.appendChild(s);
            })();
        });
        return _libPromises[key];
    }

    function ensureMammoth() {
        if (typeof mammoth !== 'undefined' && mammoth && mammoth.extractRawText) {
            return Promise.resolve(mammoth);
        }
        return loadScriptLazy(MAMMOTH_SOURCES).then(function() {
            if (typeof mammoth === 'undefined' || !mammoth.extractRawText) {
                throw new Error('DOCX 解析库加载失败');
            }
            return mammoth;
        });
    }

    function ensurePako() {
        if (typeof pako !== 'undefined' && pako && pako.inflate) return Promise.resolve(pako);
        return loadScriptLazy(PAKO_SOURCES).then(function() {
            if (typeof pako === 'undefined' || !pako.inflate) {
                throw new Error('PNG 解压库加载失败');
            }
            return pako;
        });
    }

    // ===== 清理残留角色（未绑定 user 的 + 当前 user 下重名重复的） =====
    function charIdNewer(a, b) {
        const na = parseInt(String(a || '').replace(/^[^\d]+/, ''), 10) || 0;
        const nb = parseInt(String(b || '').replace(/^[^\d]+/, ''), 10) || 0;
        return nb >= na ? b : a;
    }

    async function cleanupResidualCharacters() {
        try {
            const user = getCurrentUser();
            if (!user) return;
            const chars = await idbGetAll();
            if (!chars || !chars.length) return;
            const maskId = user.id;
            const del = [];
            const toBind = [];
            const bestByName = {};
            chars.forEach(c => {
                const bindUser = c.bindUser || '';
                // 没有 bindUser 的角色统一归到当前人设名下：
                // 旧逻辑会直接删除「未绑定的普通角色」，导致新建的角色（尤其先建角色、后建人设）
                // 下次打开角色页就消失，看起来像“添加不了”。
                // 纳米助手不参与（它用 nanoAssistant 标记、bindUser 留空）。
                if (bindUser === '') {
                    if (c.nanoAssistant) return;
                    toBind.push(c);
                    return;
                }
                if (bindUser !== maskId) return;
                const name = c.name || '';
                if (bestByName[name] === undefined) {
                    bestByName[name] = c.id;
                } else {
                    const keep = charIdNewer(bestByName[name], c.id);
                    if (keep !== bestByName[name]) { del.push(bestByName[name]); bestByName[name] = keep; }
                    else { del.push(c.id); }
                }
            });
            // 先把无主的 NPC / 小号绑定到当前人设
            for (const c of toBind) {
                try {
                    c.bindUser = maskId;
                    await idbPut(c);
                    const inMem = (data.chars || []).find(x => x && x.id === c.id);
                    if (inMem) inMem.bindUser = maskId;
                } catch (e) {}
            }
            if (toBind.length) renderAll();
            if (!del.length) return;
            const delSet = new Set(del);
            await idbDelete(del);
            data.chars = data.chars.filter(c => !delSet.has(c.id));
            // 同步清理世界书 boundCharacters
            try {
                const wbData = await readWorldbookData();
                if (wbData && Array.isArray(wbData.files)) {
                    let changed = false;
                    wbData.files.forEach(f => {
                        if (!Array.isArray(f.boundCharacters)) return;
                        const before = f.boundCharacters.length;
                        f.boundCharacters = f.boundCharacters.filter(id => !delSet.has(id));
                        if (f.boundCharacters.length !== before) changed = true;
                    });
                    if (changed) writeWorldbookData(wbData);
                }
            } catch (e) {}
            renderAll();
        } catch (e) {}
    }

    // ===== 读取人设（新键 nano_mask_data，兼容旧键 nano_home_data / peach_home_data） =====
    function readHomeData() {
        for (let i = 0; i < LEGACY_HOME_KEYS.length + 1; i++) {
            const key = i === 0 ? HOME_KEY : LEGACY_HOME_KEYS[i - 1];
            try {
                const raw = localStorage.getItem(key);
                if (raw) {
                    const d = JSON.parse(raw);
                    if (d && Array.isArray(d.masks)) {
                        if (i > 0) {
                            try { localStorage.setItem(HOME_KEY, JSON.stringify(d)); } catch (e) {}
                        }
                        return d;
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    // ===== 读写世界书数据（localStorage + IndexedDB 双写） =====
    // 读取世界书：以 IndexedDB 为准（避免 localStorage 缓存过期/写满导致“新世界书看不到”）
    function readWorldbookData() {
        return new Promise(function(resolve) {
            var fromLocal = function() {
                try {
                    const raw = localStorage.getItem(WB_CACHE_KEY);
                    if (raw) { const d = JSON.parse(raw); if (d && d.files) { resolve(d); return; } }
                } catch (e) {}
                resolve(null);
            };
            try {
                if (typeof indexedDB === 'undefined') { fromLocal(); return; }
                const req = indexedDB.open(WB_DB, 1);
                req.onupgradeneeded = function(e) {
                    try {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(WB_STORE)) db.createObjectStore(WB_STORE, { keyPath: 'key' });
                    } catch (e) {}
                };
                req.onsuccess = function(e) {
                    try {
                        const db = e.target.result;
                        const r = db.transaction(WB_STORE, 'readonly').objectStore(WB_STORE).get('data');
                        r.onsuccess = function() {
                            const d = r.result ? r.result.value : null;
                            if (d && Array.isArray(d.files)) {
                                try { localStorage.setItem(WB_CACHE_KEY, JSON.stringify(d)); } catch (e) {}
                                resolve(d);
                            } else { fromLocal(); }
                        };
                        r.onerror = function() { fromLocal(); };
                    } catch (e) { fromLocal(); }
                };
                req.onerror = function() { fromLocal(); };
            } catch (e) { fromLocal(); }
        });
    }

    // 写入世界书：IDB 为准（返回 Promise），localStorage 仅作缓存（写满也不影响）
    function writeWorldbookData(d) {
        if (!d) return Promise.resolve();
        return new Promise(function(resolve) {
            try {
                if (typeof indexedDB === 'undefined') {
                    try { localStorage.setItem(WB_CACHE_KEY, JSON.stringify(d)); } catch (e) {}
                    resolve(); return;
                }
                const req = indexedDB.open(WB_DB, 1);
                req.onupgradeneeded = function(e) {
                    try {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(WB_STORE)) db.createObjectStore(WB_STORE, { keyPath: 'key' });
                    } catch (e) {}
                };
                req.onsuccess = function(e) {
                    try {
                        const db = e.target.result;
                        const tx = db.transaction(WB_STORE, 'readwrite');
                        tx.objectStore(WB_STORE).put({ key: 'data', value: d });
                        tx.oncomplete = function() {
                            try { localStorage.setItem(WB_CACHE_KEY, JSON.stringify(d)); } catch (e) {}
                            resolve();
                        };
                        tx.onerror = function() { resolve(); };
                        tx.onabort = function() { resolve(); };
                    } catch (e) { resolve(); }
                };
                req.onerror = function() { resolve(); };
            } catch (e) { resolve(); }
        });
    }

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { reject(new Error('当前环境不支持 IndexedDB')); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function(e) {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(e.target.error || new Error('IndexedDB 打开失败')); };
        });
        return dbPromise;
    }

    function idbGetAll() {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        }));
    }

    function idbPut(item) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        }));
    }

    function idbDelete(ids) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            ids.forEach(id => store.delete(id));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        }));
    }

    // ===== 工具函数 =====
    function getMasks() {
        const homeData = readHomeData();
        return homeData ? (homeData.masks || []) : [];
    }

    function getCurrentUser() {
        const homeData = readHomeData();
        if (!homeData) return null;
        const masks = homeData.masks || [];
        if (homeData.currentMaskId) {
            const cur = masks.find(m => m.id === homeData.currentMaskId);
            if (cur) return cur;
        }
        // 旧数据可能只有 masks、没有 currentMaskId：回退到第一个人设，
        // 否则新建角色时拿不到 bindUser，保存后会看不到。
        return masks[0] || null;
    }

    // 世界书：从 nano_worldbook_db IndexedDB 读取真实条目（与 worldbook.js 一致）
    let allWorldbooks = [];

       function loadWorldbooks() {
        try {
            const raw = localStorage.getItem(WB_CACHE_KEY) || localStorage.getItem(LEGACY_WB_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                const files = (d.files || []);
                allWorldbooks = files.map(f => ({ id: f.id, name: f.name, group: f.group || '', scope: f.scope || 'global' }));
            }
        } catch(e) {}
        try {
            if (typeof indexedDB === 'undefined') return;
            const req = indexedDB.open('nano_worldbook_db', 1);
            req.onupgradeneeded = function(e) {
                try {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data', { keyPath: 'key' });
                } catch (e) {}
            };
            req.onsuccess = function(e) {
                try {
                    const db = e.target.result;
                    const r = db.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
                    r.onsuccess = function() {
                        const d = r.result ? r.result.value : null;
                        if (d && d.files) {
                            allWorldbooks = d.files.map(f => ({ id: f.id, name: f.name, group: f.group || '', scope: f.scope || 'global' }));
                            populateWorldbookSelect();
                            populateGroupSelectForBind();
                        }
                    };
                    r.onerror = function() {};
                } catch (e) {}
            };
            req.onerror = function() {};
        } catch(e) {}
    }
    loadWorldbooks();

    // ===== 压缩图片 =====
    function compressImage(dataUrl, maxWidth, maxHeight, quality) {
        return new Promise(function(resolve) {
            const img = new Image();
            img.onload = function() {
                // 头像一律裁成正方形（取中心 4:4 区域），避免 9:16 竖图在圆头像里被压扁/露半张脸
                let sx = 0, sy = 0, sw = img.width, sh = img.height;
                let outW, outH;
                if (maxWidth === maxHeight) {
                    const side = Math.min(img.width, img.height);
                    sx = (img.width - side) / 2;
                    sy = (img.height - side) / 2;
                    sw = sh = side;
                    outW = outH = Math.min(maxWidth, side) || side;
                } else {
                    outW = sw; outH = sh;
                    if (outW > maxWidth) { outH = outH * (maxWidth / outW); outW = maxWidth; }
                    if (outH > maxHeight) { outW = outW * (maxHeight / outH); outH = maxHeight; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(outW));
                canvas.height = Math.max(1, Math.round(outH));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality || 0.7));
            };
            img.src = dataUrl;
        });
    }

    // ===== 酒馆 PNG 解析 =====
    function inflateBytes(bytes) {
        try {
            if (typeof pako === 'undefined') return null;
            return pako.inflate(bytes);
        } catch(e) {
            console.error('zlib 解压失败:', e);
            return null;
        }
    }

    function readPNGTextChunks(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
            throw new Error("不是有效的 PNG 文件");
        }
        let offset = 8;
        const rawChunks = [];
        while (offset < arrayBuffer.byteLength) {
            if (offset + 8 > arrayBuffer.byteLength) break;
            const length = view.getUint32(offset);
            let type = "";
            for (let i = 0; i < 4; i++) {
                type += String.fromCharCode(view.getUint8(offset + 4 + i));
            }
            const dataStart = offset + 8;
            if (dataStart + length > arrayBuffer.byteLength) break;
            try {
                if (type === 'tEXt') {
                    let sep = -1;
                    for (let i = 0; i < length; i++) {
                        if (view.getUint8(dataStart + i) === 0) { sep = i; break; }
                    }
                    if (sep !== -1) {
                        const keyword = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer, dataStart, sep));
                        const value = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer, dataStart + sep + 1, length - sep - 1));
                        rawChunks.push({ keyword, value });
                    }
                } else if (type === 'zTXt') {
                    let sep = -1;
                    for (let i = 0; i < length; i++) {
                        if (view.getUint8(dataStart + i) === 0) { sep = i; break; }
                    }
                    if (sep !== -1) {
                        const keyword = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer, dataStart, sep));
                        const compressedBytes = new Uint8Array(arrayBuffer, dataStart + sep + 2, length - sep - 2);
                        const inflated = inflateBytes(compressedBytes);
                        if (inflated) {
                            const value = new TextDecoder('utf-8').decode(inflated);
                            rawChunks.push({ keyword, value });
                        }
                    }
                } else if (type === 'iTXt') {
                    let pos = 0;
                    const u8 = new Uint8Array(arrayBuffer, dataStart, length);
                    while (pos < length && u8[pos] !== 0) pos++;
                    const keyword = new TextDecoder('utf-8').decode(u8.subarray(0, pos));
                    pos++;
                    const compFlag = u8[pos++];
                    const compMethod = u8[pos++];
                    while (pos < length && u8[pos] !== 0) pos++; pos++;
                    while (pos < length && u8[pos] !== 0) pos++; pos++;
                    if (compFlag === 0) {
                        const value = new TextDecoder('utf-8').decode(u8.subarray(pos));
                        rawChunks.push({ keyword, value });
                    } else {
                        const inflated = inflateBytes(u8.subarray(pos));
                        if (inflated) {
                            const value = new TextDecoder('utf-8').decode(inflated);
                            rawChunks.push({ keyword, value });
                        }
                    }
                }
            } catch(chunkErr) {
                console.error('解析 chunk 出错:', type, chunkErr);
            }
            offset += 12 + length;
        }
        const chunks = {};
        rawChunks.forEach(({ keyword, value }) => {
            chunks[keyword] = (chunks[keyword] ? chunks[keyword] : '') + value;
        });
        return chunks;
    }

    function utf8Base64Decode(str) {
        let clean = String(str).replace(/[\r\n\s]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        const pad = clean.length % 4;
        if (pad) clean += '='.repeat(4 - pad);
        let bytes;
        try {
            bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
        } catch(e) {
            return '';
        }
        try {
            return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        } catch(e) {
            try { return atob(clean); } catch(e2) { return ''; }
        }
    }

    // 判断一个对象是否像角色卡（尽量覆盖各家字段命名）
    function looksLikeCard(o) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
        return !!(o.name || o.nickname || o.char_name || o.character_name || o.characterName ||
            o.description || o.desc || o.personality || o.first_mes || o.firstMessage || o.first_message ||
            o.scenario || o.mes_example || o.mesExample || o.data || o.entries || o.spec);
    }

    // 把各种外层结构（V2/V3 的 {spec,data}、数组、characters[]）拆成真正的角色卡对象
    function unwrapCard(o) {
        if (!o || typeof o !== 'object') return null;
        if (Array.isArray(o)) {
            for (const it of o) { const r = unwrapCard(it); if (r) return r; }
            return null;
        }
        if (o.data && typeof o.data === 'object' && looksLikeCard(o.data)) {
            if (!o.data.name && o.name) o.data.name = o.name;
            if (!o.data.tags && o.tags) o.data.tags = o.tags;
            return o.data;
        }
        if (Array.isArray(o.characters)) return unwrapCard(o.characters[0]);
        if (looksLikeCard(o)) return o;
        return null;
    }

    // 宽松解析：直接 JSON / base64 / base64url / data-uri / URL 编码 / 双层 base64 都试一遍
    function parseLooseJson(rawStr) {
        if (!rawStr) return null;
        let s = String(rawStr).replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim();
        if (!s) return null;
        const attempts = [s];
        const di = s.match(/^data:[^,]*;base64,([\s\S]*)$/);
        if (di) attempts.push(di[1]);
        const compact = s.replace(/[\r\n\s]+/g, '');
        if (/^[A-Za-z0-9+/=_-]{16,}$/.test(compact)) attempts.push(compact);
        if (/%22|%7B|%5B|%7D|%3A/.test(s)) { try { attempts.push(decodeURIComponent(s)); } catch(e) {} }
        for (const a of attempts) {
            try {
                const o = JSON.parse(String(a).trim());
                if (o && typeof o === 'object') {
                    const u = unwrapCard(o);
                    if (u) return u;
                    if (o.data) return o;
                }
            } catch(e) {}
            try {
                const d = utf8Base64Decode(a);
                if (d) {
                    const o = JSON.parse(d.trim());
                    if (o && typeof o === 'object') {
                        const u = unwrapCard(o);
                        if (u) return u;
                        if (o.data) return o;
                    }
                }
            } catch(e) {}
        }
        return null;
    }

    function cardGreetingScore(parsed) {
        try {
            const data = (parsed && parsed.data) ? parsed.data : parsed;
            if (!data || typeof data !== 'object') return -1;
            const first = data.first_mes || data.first_message || data.firstMessage || data.greeting || '';
            const alt = data.alternate_greetings || data.alternateGreetings || data.greetings || [];
            const altLen = Array.isArray(alt) ? alt.length : 0;
            return (first ? 10 : 0) + altLen * 3 + (data.name ? 2 : 0) + (data.description || data.personality ? 1 : 0);
        } catch (e) { return -1; }
    }

    function parseCardDataFromChunks(chunks) {
        const priorityKeys = ['ccv3', 'character_card_v3', 'chara', 'character', 'card', 'data', 'json', 'chub', 'character_card'];
        const candidates = [];
        priorityKeys.forEach(k => { if (chunks[k]) candidates.push(chunks[k]); });
        Object.keys(chunks).forEach(k => {
            if (!priorityKeys.includes(k) && chunks[k] && chunks[k].length > 20) candidates.push(chunks[k]);
        });
        // 多个候选（如同时有 V2 的 chara 与 V3 的 ccv3）时，取信息最全、开场白最多的那一份
        let best = null, bestScore = -1;
        for (const rawStr of candidates) {
            const parsed = parseLooseJson(rawStr);
            if (!parsed) continue;
            const score = cardGreetingScore(parsed);
            if (score > bestScore) { bestScore = score; best = parsed; }
        }
        return best;
    }

    function parseCardData(json) {
        let name = '', gender = '男', nationality = '未知', setting = '';
        let matchedWorldbooks = [];
        let embeddedWorldbook = null;
        let greetings = [];
        try {
            const dataObj = json.data || json;
            name = dataObj.name || dataObj.nickname || dataObj.char_name || dataObj.character_name || dataObj.characterName || json.name || json.nickname || '';
            gender = dataObj.gender || dataObj.sex || json.gender || '男';
            nationality = dataObj.nationality || dataObj.country || json.nationality || '中国';
            const desc = dataObj.description || dataObj.desc || dataObj.persona || '';
            const personality = dataObj.personality || '';
            const scenario = dataObj.scenario || dataObj.world || '';
            const firstMsg = dataObj.first_mes || dataObj.first_message || dataObj.firstMessage || dataObj.greeting || dataObj.char_greeting || dataObj.firstGreeting || '';
            const altRaw = dataObj.alternate_greetings || dataObj.alternateGreetings || dataObj.alternate_greeting || dataObj.alternateGreeting || dataObj.greetings || dataObj.greeting_list || [];
            (Array.isArray(firstMsg) ? firstMsg : [firstMsg])
                .concat(Array.isArray(altRaw) ? altRaw : (typeof altRaw === 'string' ? [altRaw] : []))
                .forEach(function(g) {
                    const t = (typeof g === 'string') ? g.trim() : '';
                    if (t && greetings.indexOf(t) === -1) greetings.push(t);
                });
            const mesExample = dataObj.mes_example || dataObj.mesExample || dataObj.example_dialogue || dataObj.exampleMessage || '';
            let settingParts = [];
            if (desc) settingParts.push("【外貌与基本设定】\n" + desc);
            if (personality) settingParts.push("【性格特征】\n" + personality);
            if (scenario) settingParts.push("【开场背景】\n" + scenario);
            if (firstMsg) settingParts.push("【首条消息】\n" + firstMsg);
            if (mesExample) settingParts.push("【对话示例】\n" + mesExample);
            setting = settingParts.join("\n\n") || json.setting || '';

            // ⭐ 角色卡自带世界书（character_book / extensions.world）
            const bookSrc = (dataObj.character_book && dataObj.character_book.entries && dataObj.character_book.entries.length)
                ? dataObj.character_book
                : (dataObj.extensions && dataObj.extensions.world && dataObj.extensions.world.entries && dataObj.extensions.world.entries.length
                    ? dataObj.extensions.world : null);
            if (bookSrc) {
                embeddedWorldbook = { name: (bookSrc.name || dataObj.name || '').trim(), entries: bookSrc.entries || [] };
            }

            if (!embeddedWorldbook && dataObj.character_book && dataObj.character_book.entries) {
                dataObj.character_book.entries.forEach(e => {
                    if (e.comment) {
                        const book = allWorldbooks.find(b => b.name.includes(e.comment) || e.comment.includes(b.name));
                        if (book && !matchedWorldbooks.some(w => w.id === book.id)) {
                            matchedWorldbooks.push({ id: book.id, group: book.group });
                        }
                    }
                });
            }
            if (!embeddedWorldbook && (json.tags || dataObj.tags)) {
                const tags = json.tags || dataObj.tags;
                if (Array.isArray(tags)) {
                    tags.forEach(tag => {
                        const book = allWorldbooks.find(b => b.name.includes(tag) || tag.includes(b.name));
                        if (book && !matchedWorldbooks.some(w => w.id === book.id)) {
                            matchedWorldbooks.push({ id: book.id, group: book.group });
                        }
                    });
                }
            }
            if (!embeddedWorldbook && setting) {
                allWorldbooks.forEach(book => {
                    if (setting.includes(book.name) && !matchedWorldbooks.some(w => w.id === book.id)) {
                        matchedWorldbooks.push({ id: book.id, group: book.group });
                    }
                });
            }
        } catch(e) {
            console.error('Parse error:', e);
        }
        return { name, gender, nationality, setting, greetings, matchedWorldbooks, embeddedWorldbook };
    }

    // ===== 酒馆世界书 entries → 本项目 v5 世界书条目 =====
    function extractStKeys(e) {
        const arr = [];
        ['key', 'keys', 'keywords', 'keyword'].forEach(k => {
            const v = e ? e[k] : null;
            if (Array.isArray(v)) arr.push(...v);
            else if (typeof v === 'string') arr.push(...v.split(/[,，、;；\n\r]+/));
        });
        return arr.map(s => String(s).trim()).filter(Boolean);
    }

    function mapStEntriesToV5(entriesArray) {
        const out = [];
        (entriesArray || []).forEach(function(e) {
            if (!e || typeof e !== 'object') return;
            const content = typeof e.content === 'string' ? e.content : '';
            if (!content || !content.trim()) return;
            const keys = extractStKeys(e);
            const title = (e.comment && String(e.comment).trim()) || (e.name && String(e.name).trim()) || '';
            const pos = (e.position === 'before_char' || e.position === 'before_example' || e.position === 0)
                ? 'before_char' : (e.position === 'after_char' || e.position === 1 ? 'after_char' : 'after_chat');
            const constant = e.constant === true || e.permanent === true;
            const depthNum = typeof e.scanDepth === 'number' ? e.scanDepth
                : (typeof e.depth === 'number' ? e.depth
                : (typeof e.scan_depth === 'number' ? e.scan_depth : 4));
            out.push({
                id: 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                enabled: e.disable !== true && e.enabled !== false,
                title: title,
                keywords: keys.join(','),
                // 常驻条目 → 不按关键词；按卡片的 scanDepth / position / priority / probability
                keywordEnabled: !constant,
                vectorEnabled: e.vectorized === true,
                permanent: constant,
                position: pos,
                scanDepth: depthNum,
                priority: typeof e.priority === 'number' ? e.priority
                    : (typeof e.order === 'number' ? e.order
                    : (typeof e.insertion_order === 'number' ? e.insertion_order : 100)),
                probability: typeof e.probability === 'number' ? e.probability : 100,
                content: content,
                collapsed: true
            });
        });
        return out;
    }

    // ===== 把角色卡自带世界书导入 nano_worldbook_data_v5，并作为局部世界书返回 =====
    async function importEmbeddedWorldbook(embedded) {
        try {
            let wbData = await readWorldbookData();
            if (!wbData) wbData = { groups: [], files: [] };
            if (!Array.isArray(wbData.files)) wbData.files = [];
            const entries = mapStEntriesToV5(embedded.entries || []);
            if (!entries.length) return null;
            const rawName = (embedded.name || '').trim();
            const fname = rawName || (inputName.value && inputName.value.trim() ? inputName.value.trim() : '角色世界书');
            let existing = wbData.files.find(f => f.name === fname);
            if (!existing) {
                existing = {
                    id: 'f_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                    name: fname,
                    scope: 'local',
                    boundCharacters: editingId ? [editingId] : [],
                    entries: entries,
                    group: null,
                    ext: 'json',
                    size: Math.ceil(entries.reduce((s, e) => s + (e.content ? e.content.length : 0), 0) / 1024) + 'KB'
                };
                wbData.files.push(existing);
                await writeWorldbookData(wbData);
            } else {
                if ((!Array.isArray(existing.entries) || existing.entries.length === 0) && entries.length) {
                    existing.entries = entries;
                    existing.scope = 'local';
                    if (editingId) {
                        if (!Array.isArray(existing.boundCharacters)) existing.boundCharacters = [];
                        if (existing.boundCharacters.indexOf(editingId) === -1) existing.boundCharacters.push(editingId);
                    }
                    await writeWorldbookData(wbData);
                }
            }
            // 刷新选项列表，保证后续保存 / 界面一致
            allWorldbooks = wbData.files.map(f => ({ id: f.id, name: f.name, group: f.group || '', scope: f.scope || 'global' }));
            return existing;
        } catch(e) {
            console.error('导入角色卡世界书失败:', e);
            return null;
        }
    }

    // ===== 应用状态 =====
    let data = { chars: [] };
    let isEditMode = false;
    let selectedIds = new Set();
    let editingId = null;
    let tempAvatar = '';
    let tempGreetings = [];
    let worldbookBindings = [];

    // ===== DOM 引用 =====
    const cardGrid = document.getElementById('cardGrid');
    const emptyState = document.getElementById('emptyState');
    const addBtn = document.getElementById('addBtn');
    const editModeBtn = document.getElementById('editModeBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const editControls = document.getElementById('editControls');
    const pageHeader = document.getElementById('pageHeader');
    const backBtn = document.getElementById('backBtn');
    const storageWarning = document.getElementById('storageWarning');

    const editModal = document.getElementById('editModal');
    const editTitle = document.getElementById('editTitle');
    const avatarPicker = document.getElementById('avatarPicker');
    const avatarPlaceholder = document.getElementById('avatarPlaceholder');
    const avatarPreview = document.getElementById('avatarPreview');
    const inputName = document.getElementById('inputName');
    const inputGender = document.getElementById('inputGender');
    const inputNationality = document.getElementById('inputNationality');
    const inputSetting = document.getElementById('inputSetting');
    const inputBindUser = document.getElementById('inputBindUser');
    const worldbookList = document.getElementById('worldbookList');
    const worldbookSelect = document.getElementById('worldbookSelect');
    const worldbookGroupSelect = document.getElementById('worldbookGroupSelect');
    const addWorldbookBtn = document.getElementById('addWorldbookBtn');
    const selectAllWorldbookBtn = document.getElementById('selectAllWorldbookBtn');
    const editCancel = document.getElementById('editCancel');
    const editSave = document.getElementById('editSave');
    const importBtn = document.getElementById('importBtn');
    const importPngBtn = document.getElementById('importPngBtn');
    const importPngFileInput = document.getElementById('importPngFileInput');

    // ===== 头像弹窗 DOM =====
    const avatarModal = document.getElementById('avatarModal');
    const avatarFileInput = document.getElementById('avatarFileInput');
    const avatarThumbPreview = document.getElementById('avatarThumbPreview');
    const avatarUrlInput = document.getElementById('avatarUrlInput');
    const avatarResetBtn = document.getElementById('avatarResetBtn');
    const avatarCancelBtn = document.getElementById('avatarCancelBtn');
    const avatarConfirmBtn = document.getElementById('avatarConfirmBtn');

    const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><rect width='28' height='28' rx='6' fill='%23E5E5EA' /><circle cx='14' cy='11' r='5' fill='%238E8E93' /><path d='M6 24c0-4.4 3.6-8 8-8s8 3.6 8 8' fill='%238E8E93' /></svg>";

    const infoModal = document.getElementById('infoModal');
    const infoTitle = document.getElementById('infoTitle');
    const infoBody = document.getElementById('infoBody');
    const infoOk = document.getElementById('infoOk');

    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const deleteConfirmMsg = document.getElementById('deleteConfirmMsg');
    const deleteConfirmCancel = document.getElementById('deleteConfirmCancel');
    const deleteConfirmOk = document.getElementById('deleteConfirmOk');

    const fileInput = document.getElementById('fileInput');

    // ===== 渲染 =====
    async function renderAll() {
        const currentUser = getCurrentUser();
        let chars = data.chars || [];
        
        // ===== 修复：如果有当前 User，显示绑定的角色；群聊里添加的 NPC 也显示 =====
        if (currentUser) {
            chars = chars.filter(c => String(c.bindUser) === String(currentUser.id));
        }
        // 如果没有当前 User，显示所有角色（让用户能看到）
        
        cardGrid.innerHTML = '';

        if (chars.length === 0) {
            emptyState.style.display = 'block';
            cardGrid.style.display = 'none';
            updateUI();
            return;
        }

        emptyState.style.display = 'none';
        cardGrid.style.display = 'grid';

        chars.forEach(item => {
            const card = document.createElement('div');
            card.className = 'character-card';
            if (selectedIds.has(item.id)) card.classList.add('selected');

            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'card-avatar';
            if (item.avatar && item.avatar.length > 50) {
                const img = document.createElement('img');
                img.src = item.avatar;
                img.onerror = function() { this.style.display = 'none'; avatarDiv.textContent = (item.name || '?').charAt(0).toUpperCase(); };
                avatarDiv.appendChild(img);
            } else {
                avatarDiv.textContent = (item.name || '?').charAt(0).toUpperCase();
            }
            card.appendChild(avatarDiv);

            const nameDiv = document.createElement('div');
            nameDiv.className = 'card-name';
            nameDiv.textContent = item.name || '未命名';
            card.appendChild(nameDiv);

            if (currentUser && item.bindUser === currentUser.id) {
                const badge = document.createElement('span');
                badge.className = 'card-badge';
                badge.textContent = '当前';
                card.appendChild(badge);
            }

            const check = document.createElement('div');
            check.className = 'card-check';
            check.textContent = '✓';
            card.appendChild(check);

            card.addEventListener('click', function(e) {
                e.stopPropagation();
                if (isEditMode) {
                    if (selectedIds.has(item.id)) { selectedIds.delete(item.id); card.classList.remove('selected'); } 
                    else { selectedIds.add(item.id); card.classList.add('selected'); }
                    updateUI();
                } else {
                    openEditModal(item.id);
                }
            });

            cardGrid.appendChild(card);
        });
        updateUI();
        checkStorage();
    }

    function checkStorage() {
        if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then(function(est) {
                if (est.quota && est.usage) {
                    const ratio = est.usage / est.quota;
                    storageWarning.style.display = ratio > 0.9 ? 'flex' : 'none';
                }
            }).catch(function() {});
        }
    }

    function updateUI() {
        if (pageHeader) pageHeader.classList.toggle('hidden', isEditMode);
        if (isEditMode) {
            editControls.classList.add('show');
            editModeBtn.classList.add('active');
            editModeBtn.innerHTML =
                `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        } else {
            editControls.classList.remove('show');
            editModeBtn.classList.remove('active');
            editModeBtn.innerHTML =
                `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        }
    }

    function enterEditMode() {
        if (data.chars.length === 0) { showInfo('提示', '没有可编辑的角色'); return; }
        isEditMode = true;
        selectedIds.clear();
        renderAll();
    }

    function exitEditMode() {
        isEditMode = false;
        selectedIds.clear();
        renderAll();
    }

    // 右滑返回：编辑模式下先退出编辑（此时顶栏返回按钮被隐藏）
    window.__nanoInternalBack = function () {
        if (isEditMode) { exitEditMode(); return true; }
        return false;
    };

    // ===== 编辑弹窗 =====
    function openEditModal(id) {
        const item = id ? data.chars.find(c => c.id === id) : null;
        editingId = id || null;
        populateBindUser();
        populateWorldbookSelect();
        populateGroupSelectForBind();        

        if (item) {
            editTitle.textContent = '编辑角色';
            tempAvatar = item.avatar || '';
            inputName.value = item.name || '';
            inputGender.value = item.gender || '男';
            inputNationality.value = item.nationality || '中国';
            inputSetting.value = item.setting || '';
            inputBindUser.value = item.bindUser || '';
            worldbookBindings = (item.worldbookBindings || []).map(w => ({ ...w }));
            tempGreetings = Array.isArray(item.greetings) ? item.greetings.slice() : [];
            editSave.textContent = '保存';
        } else {
            editTitle.textContent = '新增角色';
            tempAvatar = '';
            inputName.value = '';
            inputGender.value = '男';
            inputNationality.value = '中国';
            inputSetting.value = '';
            // ⭐ 新角色默认绑定当前人设（否则角色页/聊天页因 bindUser 不匹配而不显示）
            const curUser = getCurrentUser();
            inputBindUser.value = curUser ? curUser.id : '';
            worldbookBindings = [];
            tempGreetings = [];
            editSave.textContent = '添加';
        }
        updateAvatarPreview();
        renderWorldbookList();
        editModal.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
        editingId = null;
    }

    function updateAvatarPreview() {
        if (tempAvatar && tempAvatar.trim() !== '') {
            avatarPreview.src = tempAvatar;
            avatarPreview.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
        } else {
            avatarPreview.style.display = 'none';
            avatarPlaceholder.style.display = 'block';
            avatarPlaceholder.textContent = '+';
        }
    }

    function populateBindUser() {
        const masks = getMasks();
        inputBindUser.innerHTML = '<option value="">未绑定</option>';
        const currentUser = getCurrentUser();
        masks.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name || '未命名';
            if (currentUser && m.id === currentUser.id) opt.textContent += ' (当前)';
            inputBindUser.appendChild(opt);
        });
    }

    function populateWorldbookSelect() {
        if (!worldbookSelect) return;
        worldbookSelect.innerHTML = '<option value="">选择世界书...</option>';
        // 显示所有「非全局」的世界书（单人 / 线上），方便绑定到具体角色
        const localBooks = allWorldbooks.filter(w => (w.scope || 'global') !== 'global');
        if (localBooks.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '暂无可绑定的世界书（全局世界书无需绑定）';
            opt.disabled = true;
            worldbookSelect.appendChild(opt);
        } else {
            localBooks.forEach(w => {
                const opt = document.createElement('option');
                opt.value = w.id;
                opt.textContent = w.name + (w.group ? ' (' + w.group + ')' : '');
                worldbookSelect.appendChild(opt);
            });
        }
    }

    // ===== 填充分组下拉（用于一键绑定） =====
    function populateGroupSelectForBind() {
        const groupSelect = document.getElementById('worldbookGroupSelect');
        if (!groupSelect) return;
        const groups = {};
        allWorldbooks.forEach(w => {
            if (w.group && (w.scope || 'global') !== 'global') {
                if (!groups[w.group]) groups[w.group] = [];
                groups[w.group].push(w);
            }
        });
        groupSelect.innerHTML = '<option value="">选择分组...</option>';
        Object.keys(groups).forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g + ' (' + groups[g].length + '本)';
            groupSelect.appendChild(opt);
        });
        if (Object.keys(groups).length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '暂无分组';
            opt.disabled = true;
            groupSelect.appendChild(opt);
        }
    }

    // 双向绑定：把当前角色写进世界书的 boundCharacters（nano_worldbook_db）
    async function syncWorldbookToChar(worldbookId, charId, add) {
        try {
            const data = await readWorldbookData();
            if (!data || !Array.isArray(data.files)) return;
            const file = data.files.find(f => f.id === worldbookId);
            if (!file || (file.scope || 'global') === 'global') return;
            if (!Array.isArray(file.boundCharacters)) file.boundCharacters = [];
            if (add) {
                if (!file.boundCharacters.includes(charId)) file.boundCharacters.push(charId);
            } else {
                file.boundCharacters = file.boundCharacters.filter(id => id !== charId);
            }
            writeWorldbookData(data);
        } catch(e) {}
    }

    function renderWorldbookList() {
        if (!worldbookList) return;
        worldbookList.innerHTML = '';
        if (worldbookBindings.length === 0) {
            const empty = document.createElement('span');
            empty.style.cssText = 'font-size:12px;color:#8e8e93;padding:4px 0;';
            empty.textContent = '未绑定任何世界书';
            worldbookList.appendChild(empty);
            return;
        }
        worldbookBindings.forEach((wb, idx) => {
            const div = document.createElement('div');
            div.className = 'worldbook-tag';
            const book = allWorldbooks.find(b => b.id === wb.id);
            if (wb.group) {
                const group = document.createElement('span');
                group.className = 'wb-group';
                group.textContent = wb.group;
                div.appendChild(group);
            }
            const name = document.createElement('span');
            name.textContent = book ? book.name : wb.id;
            const remove = document.createElement('button');
            remove.className = 'wb-remove';
            remove.textContent = '×';
            remove.addEventListener('click', function() {
                worldbookBindings.splice(idx, 1);
                renderWorldbookList();
            });
            div.appendChild(name);
            div.appendChild(remove);
            worldbookList.appendChild(div);
        });
    }

    // ===== 保存角色 =====
    async function handleSave() {
        const name = inputName.value.trim() || '未命名';
        const gender = inputGender.value;
        const nationality = inputNationality.value.trim() || '中国';
        const setting = inputSetting.value.trim() || '';
        const avatar = tempAvatar || '';
        // 新建角色时如果没选人设，自动绑定当前人设，避免保存后因 bindUser 为空
        // 被角色页过滤掉（表现为“点了添加但列表里没有”）。
        const curUser = getCurrentUser();
        const bindUser = inputBindUser.value || (curUser ? curUser.id : '');

        const existingItem = editingId ? (data.chars || []).find(c => c.id === editingId) : null;
        const newItem = {
            id: editingId || 'c' + Date.now(),
            name,
            avatar,
            gender,
            nationality,
            setting,
            bindUser,
            isNpc: existingItem ? !!existingItem.isNpc : false,
            nanoAssistant: existingItem ? !!existingItem.nanoAssistant : false,
            greetings: tempGreetings.slice(),
            worldbookBindings: worldbookBindings.map(w => ({ ...w }))
        };

        // 双向绑定同步：把该角色写入所绑定的局部世界书 boundCharacters
        const charId = newItem.id;
        try {
            const wbData = await readWorldbookData();
            if (wbData && Array.isArray(wbData.files)) {
                let changed = false;
                wbData.files.forEach(f => {
                    if (!Array.isArray(f.boundCharacters)) f.boundCharacters = [];
                    // 全局世界书对所有角色生效，无需记录到 boundCharacters；非全局（单人/线上）才记录
                    const isBindable = (f.scope || 'global') !== 'global';
                    const shouldBind = isBindable && worldbookBindings.some(w => w.id === f.id);
                    const idx = f.boundCharacters.indexOf(charId);
                    if (shouldBind) {
                        if (idx === -1) { f.boundCharacters.push(charId); changed = true; }
                    } else {
                        if (idx > -1) { f.boundCharacters.splice(idx, 1); changed = true; }
                    }
                });
                if (changed) writeWorldbookData(wbData);
            }
        } catch(e) {}

        try {
            await idbPut(newItem);
            if (editingId) {
                const idx = data.chars.findIndex(c => c.id === editingId);
                if (idx > -1) data.chars[idx] = newItem;
                else data.chars.push(newItem);
            } else {
                data.chars.push(newItem);
            }
            closeEditModal();
            if (isEditMode) exitEditMode();
            renderAll();
            // ===== 通知父页面数据更新（同步给 chat） =====
            window.parent.postMessage({ 
                type: 'contactsDataUpdated', 
                data: { chars: data.chars } 
            }, '*');
            // 角色头像/昵称实时同步：聊天列表卡片 + 聊天内页头像
            try {
                window.parent.postMessage({ type: 'nanoCharUpdated', chatId: newItem.id, name: newItem.name, avatar: newItem.avatar }, '*');
            } catch (e) {}
        } catch(e) {
            console.error('保存失败:', e);
            showInfo('保存失败', e.message || '未知错误');
        }
    }

    // ===== 删除选中 =====
    async function deleteSelected() {
        const ids = Array.from(selectedIds);
        try {
            await idbDelete(ids);
            // 同步从世界书 boundCharacters 中移除被删除角色
            try {
                const wbData = await readWorldbookData();
                if (wbData && Array.isArray(wbData.files)) {
                    let changed = false;
                    wbData.files.forEach(f => {
                        if (!Array.isArray(f.boundCharacters)) return;
                        const before = f.boundCharacters.length;
                        f.boundCharacters = f.boundCharacters.filter(id => !selectedIds.has(id));
                        if (f.boundCharacters.length !== before) changed = true;
                    });
                    if (changed) writeWorldbookData(wbData);
                }
            } catch(e) {}
            data.chars = data.chars.filter(c => !selectedIds.has(c.id));
            selectedIds.clear();
            deleteConfirmModal.classList.remove('show');
            isEditMode = false;
            updateUI();
            renderAll();
            // ===== 通知父页面数据更新 =====
            window.parent.postMessage({ 
                type: 'contactsDataUpdated', 
                data: { chars: data.chars } 
            }, '*');
        } catch(e) {
            console.error('删除失败:', e);
            showInfo('删除失败', e.message || '未知错误');
        }
    }

    // ===== 打开删除确认 =====
    function openDeleteConfirm() {
        const count = selectedIds.size;
        deleteConfirmMsg.textContent = count + ' 个角色将被永久删除，无法恢复';
        deleteConfirmModal.classList.add('show');
    }

    // ===== 显示信息 =====
    function showInfo(title, body) {
        infoTitle.textContent = title || '提示';
        infoBody.textContent = body || '';
        infoModal.classList.add('show');
    }

    // ===== 头像弹窗逻辑 =====
    function openAvatarModal() {
        avatarUrlInput.value = '';
        avatarFileInput.value = '';
        if (tempAvatar && tempAvatar.trim() !== '') {
            avatarThumbPreview.src = tempAvatar;
        } else {
            avatarThumbPreview.src = DEFAULT_AVATAR;
        }
        avatarModal.classList.add('show');
    }

    function closeAvatarModal() {
        avatarModal.classList.remove('show');
    }

    fileInput.addEventListener('change', async function(e) {
        const file = this.files[0];
        if (!file) return;

        // 只有 PNG 角色卡导入需要设备激活；TXT / DOC / DOCX 不限制。
        // 直接导入 .json 角色卡已关闭，只允许 PNG 角色卡。
        const lowerName = (file.name || '').toLowerCase();
        if (lowerName.endsWith('.json')) {
            fileInput.value = '';
            showInfo('不支持 JSON', '角色导入只接受 PNG 角色卡、TXT / DOC / DOCX 文本，不再直接导入 JSON 文件。');
            return;
        }
        // ===== 处理 DOC / DOCX 文件（按需加载解析库，不影响页面加载速度） =====
        if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) {
            fileInput.value = '';
            ensureMammoth().then(function(mammoth) {
                const reader = new FileReader();
                reader.onload = function(ev) {
                    const arrayBuffer = ev.target.result;
                    mammoth.extractRawText({ arrayBuffer: arrayBuffer })
                        .then(function(result) {
                            const text = result.value || '';
                            if (!text || text.trim() === '') {
                                showInfo('提示', '未能从 DOCX 中提取到文本内容，请确认文件是否包含文字。');
                                return;
                            }
                            inputSetting.value = text;
                            showInfo('✅ 导入成功', '已从 DOCX 提取文本，共 ' + text.length + ' 个字符');
                        })
                        .catch(function(err) {
                            console.error('DOCX 解析失败:', err);
                            showInfo('错误', '解析 DOCX 失败: ' + (err.message || '未知错误'));
                        });
                };
                reader.onerror = function() {
                    showInfo('错误', '读取文件失败');
                };
                reader.readAsArrayBuffer(file);
            }).catch(function() {
                showInfo('提示', 'DOCX 解析库加载失败，请检查网络后重试');
            });
            return;
        }
        
        // ===== 处理 TXT =====
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                let text = ev.target.result;
                inputSetting.value = text;
                fileInput.value = '';
            } catch(err) {
                showInfo('错误', '读取设定文本失败');
                fileInput.value = '';
            }
        };
        reader.readAsText(file);
    });

    avatarUrlInput.addEventListener('input', function() {
        const url = this.value.trim();
        if (url) {
            avatarThumbPreview.src = url;
            avatarFileInput.value = '';
        } else {
            avatarThumbPreview.src = DEFAULT_AVATAR;
        }
    });

    // 选择照片后先进入 1:1 裁剪（竖图也可拖动取景），确认后压缩并预览
    avatarFileInput.addEventListener('change', async function() {
        const file = this.files && this.files[0];
        this.value = '';
        if (!file) return;
        if (file.type && file.type.indexOf('image/') !== 0) {
            showInfo('提示', '请选择图片文件');
            return;
        }
        try {
            if (window.NanoAvatarCrop) {
                const cropped = await NanoAvatarCrop.open(file, { outputSize: 320, aspect: 1, quality: 0.9, title: '裁剪头像' });
                if (!cropped) return;
                avatarThumbPreview.src = cropped;
                avatarUrlInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = async function(ev) {
                const compressed = await compressImage(ev.target.result, 240, 240, 0.82);
                avatarThumbPreview.src = compressed;
                avatarUrlInput.value = '';
            };
            reader.onerror = function() { showInfo('错误', '图片读取失败'); };
            reader.readAsDataURL(file);
        } catch (e) {
            showInfo('错误', '图片读取失败：' + (e.message || e));
        }
    });

    avatarResetBtn.addEventListener('click', function() {
        avatarUrlInput.value = '';
        avatarFileInput.value = '';
        avatarThumbPreview.src = DEFAULT_AVATAR;
        this.style.transform = 'scale(0.85)';
        setTimeout(function() { avatarResetBtn.style.transform = ''; }, 150);
    });

    avatarCancelBtn.addEventListener('click', closeAvatarModal);

    avatarConfirmBtn.addEventListener('click', function() {
        const currentSrc = avatarThumbPreview.src;
        if (currentSrc && currentSrc !== DEFAULT_AVATAR) {
            tempAvatar = currentSrc;
            updateAvatarPreview();
            closeAvatarModal();
        } else {
            tempAvatar = '';
            updateAvatarPreview();
            closeAvatarModal();
        }
    });

    avatarModal.addEventListener('click', function(e) {
        if (e.target === avatarModal) closeAvatarModal();
    });

    // ===== 事件绑定 =====
    addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isEditMode) exitEditMode();
        openEditModal(null);
    });

    editModeBtn.addEventListener('click', function() {
        if (isEditMode) {
            if (selectedIds.size === 0) {
                exitEditMode();
                return;
            }
            openDeleteConfirm();
        } else {
            enterEditMode();
        }
    });

    cancelBtn.addEventListener('click', exitEditMode);

    // ===== 顶栏返回：编辑模式先退出，否则返回 chat 页面 =====
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            if (isEditMode) { exitEditMode(); return; }
            try {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'closeFullscreen' }, '*');
                } else {
                    window.history.back();
                }
            } catch (e) {}
        });
    }

    deleteBtn.addEventListener('click', function() {
        if (selectedIds.size === 0) { showInfo('提示', '请先选择要删除的角色'); return; }
        openDeleteConfirm();
    });

    deleteConfirmCancel.addEventListener('click', function() {
        deleteConfirmModal.classList.remove('show');
    });

    deleteConfirmOk.addEventListener('click', deleteSelected);

    deleteConfirmModal.addEventListener('click', function(e) {
        if (e.target === deleteConfirmModal) deleteConfirmModal.classList.remove('show');
    });

    avatarPicker.addEventListener('click', openAvatarModal);

    importBtn.addEventListener('click', async function() {
        fileInput.click();
    });

    importPngBtn.addEventListener('click', async function() {
        // 点击导入按钮就先检查设备激活；未激活直接弹激活窗，不打开文件选择
        let gate = null;
        try { gate = (window.parent && window.parent.NanoImportGate) || window.NanoImportGate; } catch (e) { gate = window.NanoImportGate; }
        if (gate && gate.ensure) {
            let ok = false;
            try { ok = await gate.ensure({ needActivation: true }); } catch (e2) { ok = false; }
            if (!ok) return;
        }
        importPngFileInput.click();
    });

    importPngFileInput.addEventListener('change', async function(e) {
        const file = this.files[0];
        if (!file) return;
        importPngFileInput.value = '';
        if (/\.json$/i.test(file.name || '') || file.type === 'application/json') {
            showInfo('不支持 JSON', '角色导入只接受 PNG 角色卡。请导入酒馆 PNG，或把设定作为 TXT / DOCX 文本导入。');
            return;
        }
        // ⭐ pako 按需加载（原为 <head> 阻塞脚本，现改为用到时再加载）
        ensurePako().then(function() {
            const reader = new FileReader();
            reader.onload = async function(ev) {
                try {
                    const arrayBuffer = ev.target.result;
                    const chunks = readPNGTextChunks(arrayBuffer);
                    const cardData = parseCardDataFromChunks(chunks);
                    if (!cardData) {
                        showInfo('导入失败', '无法解析此 PNG 图片的数据。请确保它是标准的酒馆角色卡。');
                        return;
                    }
                    const parsed = parseCardData(cardData);
                    const blob = new Blob([arrayBuffer], { type: file.type });
                    const tempImgUrl = URL.createObjectURL(blob);
                    const compressedAvatar = await compressImage(tempImgUrl, 180, 180, 0.7);
                    URL.revokeObjectURL(tempImgUrl);

                    if (isEditMode) exitEditMode();
                    openEditModal(null);
                    if (parsed.name) inputName.value = parsed.name;
                    if (parsed.gender) inputGender.value = parsed.gender;
                    if (parsed.nationality) inputNationality.value = parsed.nationality;
                    if (parsed.setting) inputSetting.value = parsed.setting;
                    tempGreetings = Array.isArray(parsed.greetings) ? parsed.greetings.slice() : [];
                    tempAvatar = compressedAvatar;
                    updateAvatarPreview();

                    // ⭐ 角色卡自带世界书：自动导入世界书页 + 绑定到当前角色
                    if (parsed.embeddedWorldbook && parsed.embeddedWorldbook.entries && parsed.embeddedWorldbook.entries.length) {
                        const wb = await importEmbeddedWorldbook(parsed.embeddedWorldbook);
                        if (wb && !worldbookBindings.some(w => w.id === wb.id)) {
                            worldbookBindings.push({ id: wb.id, group: wb.group || '' });
                        }
                        renderWorldbookList();
                    } else if (parsed.matchedWorldbooks && parsed.matchedWorldbooks.length > 0) {
                        parsed.matchedWorldbooks.forEach(wb => {
                            if (!worldbookBindings.some(w => w.id === wb.id)) {
                                worldbookBindings.push({ id: wb.id, group: wb.group });
                            }
                        });
                        renderWorldbookList();
                    }
                } catch(err) {
                    console.error('PNG导入失败:', err);
                    showInfo('导入失败', '解析 PNG 遇到错误: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }).catch(function() {
            showInfo('导入失败', 'PNG 解压库加载失败，无法导入酒馆 PNG');
        });
    });

    if (addWorldbookBtn) {
        addWorldbookBtn.addEventListener('click', function() {
            const val = worldbookSelect.value;
            const group = worldbookGroupSelect ? worldbookGroupSelect.value : '';
            if (!val) return;
            if (worldbookBindings.some(w => w.id === val)) return;
            const book = allWorldbooks.find(b => b.id === val);
            worldbookBindings.push({ id: val, group: group || (book ? book.group : '') });
            renderWorldbookList();
        });
    }

    if (selectAllWorldbookBtn) {
        selectAllWorldbookBtn.addEventListener('click', function() {
            const group = worldbookGroupSelect ? worldbookGroupSelect.value : '';
            if (!group) { showInfo('提示', '请先选择分组'); return; }
            const groupBooks = allWorldbooks.filter(w => w.group === group);
            groupBooks.forEach(wb => {
                if (!worldbookBindings.some(w => w.id === wb.id)) {
                    worldbookBindings.push({ id: wb.id, group: group });
                }
            });
            renderWorldbookList();
        });
    }
    // ===== 一键绑定分组 =====
    const bindGroupBtn = document.getElementById('bindGroupBtn');
    if (bindGroupBtn) {
        bindGroupBtn.addEventListener('click', function() {
            const groupSelect = document.getElementById('worldbookGroupSelect');
            const group = groupSelect ? groupSelect.value : '';
            if (!group) {
                showInfo('提示', '请先选择分组');
                return;
            }
            // 找到该分组下所有非全局的世界书（单人 / 线上）
            const books = allWorldbooks.filter(w => w.group === group && (w.scope || 'global') !== 'global');
            if (books.length === 0) {
                showInfo('提示', '该分组下没有可绑定的世界书');
                return;
            }
            let added = 0;
            books.forEach(w => {
                if (!worldbookBindings.some(b => b.id === w.id)) {
                    worldbookBindings.push({ id: w.id, group: w.group || '' });
                    added++;
                }
            });
            if (added === 0) {
                showInfo('提示', '该分组下的世界书已全部绑定');
            } else {
                renderWorldbookList();
                showInfo('✅ 绑定成功', '已绑定 ' + added + ' 本世界书');
            }
        });
    }

    editSave.addEventListener('click', handleSave);
    editCancel.addEventListener('click', closeEditModal);
    editModal.addEventListener('click', function(e) {
        if (e.target === editModal) closeEditModal();
    });

    infoOk.addEventListener('click', function() { infoModal.classList.remove('show'); });
    infoModal.addEventListener('click', function(e) {
        if (e.target === infoModal) infoModal.classList.remove('show');
    });

    // ===== 父页面通信 =====
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (data && data.type === 'addAction') {
            if (isEditMode) exitEditMode();
            openEditModal(null);
        }
        if (data && data.type === 'openRoleLibrary') { renderAll(); }
        if (data && data.type === 'currentMaskChanged') { 
            renderAll(); 
            cleanupResidualCharacters();
        }
        if (data && data.type === 'updateWorldbooks') {
            loadWorldbooks();
            populateWorldbookSelect();
            }
    });

    try { window.parent.postMessage({ type: 'pageLoaded', page: 'character' }, '*'); } catch(e) {}

    // ===== 启动 =====
    (async function init() {
        try {
            const chars = await idbGetAll();
            data.chars = chars || [];
            renderAll();
            // 清理残留角色（只在有人设时执行）
            cleanupResidualCharacters();
        } catch(e) {
            console.error('初始化失败:', e);
            data.chars = [];
            renderAll();
        }
    })();
})();