(function () {
    'use strict';
    var KEY = 'nano_gallery_v1';
    // 升到 v2：旧版可能因为 key 碰撞把照片误标成“已删除”，这里强制重新从聊天记录扫一次，
    // 把还在聊天里的照片恢复回来；扫完写入 v2 标记，之后不再每次打开都全量扫。
    var CHAT_SCAN_KEY = 'nano_gallery_chat_scan_v2';
    // v2：旧版 urlKey 只取前 120 字符 + 长度，同尺寸/同编码的 dataURL 会得到相同的 key，
    // 删一张图时会把别的图一起当成“已删除”过滤掉（用户看到的就是照片莫名其妙被销毁）。
    var TOMB_KEY = 'nano_gallery_deleted_v2';
    var EMOJI_PURGE_KEY = 'nano_gallery_emoji_purged_v3';
    var DB_NAME = 'nano_gallery_db';
    var DB_STORE = 'items';
    var _dbPromise = null;

    function urlKey(u) {
        u = String(u || '');
        // 对完整图片地址做双哈希，避免长 dataURL 前缀相同导致 key 碰撞。
        var h1 = 2166136261, h2 = 5381;
        for (var i = 0; i < u.length; i++) {
            var c = u.charCodeAt(i);
            h1 ^= c; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
            h2 = (((h2 << 5) + h2) ^ c) >>> 0;
        }
        return 'u' + u.length.toString(36) + '_' + h1.toString(36) + h2.toString(36);
    }

    // 图库记录放 IndexedDB：localStorage 只有约 5MB，几张 base64 大图就会写失败，
    // 表现就是“刚生成能看到，回到图库就没了”。IndexedDB 容量大得多。
    function openDb() {
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise(function (resolve) {
            try {
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { resolve(null); };
                req.onblocked = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
        return _dbPromise;
    }
    function dbPut(rec) {
        if (!rec || !rec.url) return Promise.resolve(false);
        return openDb().then(function (db) {
            if (!db) return false;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(DB_STORE, 'readwrite');
                    var item = Object.assign({}, rec, { key: urlKey(rec.url) });
                    tx.objectStore(DB_STORE).put(item);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { resolve(false); };
                    tx.onabort = function () { resolve(false); };
                } catch (e) { resolve(false); }
            });
        }).catch(function () { return false; });
    }
    function dbAll() {
        return openDb().then(function (db) {
            if (!db) return [];
            return new Promise(function (resolve) {
                try {
                    var req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
                    req.onsuccess = function () { resolve(Array.isArray(req.result) ? req.result : []); };
                    req.onerror = function () { resolve([]); };
                } catch (e) { resolve([]); }
            });
        }).catch(function () { return []; });
    }
    function dbDelete(keys) {
        if (!keys || !keys.length) return;
        openDb().then(function (db) {
            if (!db) return;
            try {
                var tx = db.transaction(DB_STORE, 'readwrite');
                var st = tx.objectStore(DB_STORE);
                keys.forEach(function (k) { try { st.delete(k); } catch (e) {} });
            } catch (e) {}
        }).catch(function () {});
    }
    function dbClear() {
        openDb().then(function (db) {
            if (!db) return;
            try { db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).clear(); } catch (e) {}
        }).catch(function () {});
    }
    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            try {
                var fr = new FileReader();
                fr.onload = function () { resolve(String(fr.result || '')); };
                fr.onerror = reject;
                fr.readAsDataURL(blob);
            } catch (e) { reject(e); }
        });
    }
    var _remotePending = {};
    // 生图接口常返回会过期的临时 URL。能在后台下载就转成 data URL 永久存进 IndexedDB；
    // 下载失败（CORS/网络）就保留原 URL，不影响当前显示。
    function cacheRemoteImage(rec, u) {
        var k = urlKey(u);
        if (_remotePending[k]) return;
        _remotePending[k] = 1;
        var p = (window.NanoImageCache && NanoImageCache.toDataUrl)
            ? NanoImageCache.toDataUrl(u)
            : fetch(u, { cache: 'force-cache' }).then(function (r) {
                if (!r || !r.ok) throw new Error('http ' + (r && r.status));
                return r.blob();
            }).then(blobToDataUrl);
        p.then(function (data) {
            if (!data || data.length > 8 * 1024 * 1024) return;
            var oldKey = urlKey(u);
            var arr = read().filter(function (x) { return urlKey(x && x.url) !== oldKey; });
            write(arr);
            dbDelete([oldKey]);
            var copy = Object.assign({}, rec, { url: data });
            add(copy);
        }).catch(function () {}).then(function () { delete _remotePending[k]; });
    }
    // 表情包图片本身的 URL 不一定带任何 emoji 元数据，只看记录字段会漏掉，
    // 结果就是它们被当成普通照片收进图库，而且“清理表情包”也清不掉。
    var _emojiUrlCache = { raw: null, set: null };
    function emojiUrlSet() {
        try {
            var raw = localStorage.getItem('nano_emoji_data') || localStorage.getItem('peach_home_data') || '';
            if (!raw) return _emojiUrlCache.set || null;
            if (_emojiUrlCache.raw === raw && _emojiUrlCache.set) return _emojiUrlCache.set;
            var d = JSON.parse(raw);
            var set = {};
            ((d && d.emojiGroups) || []).forEach(function (g) {
                ((g && g.emojis) || []).forEach(function (e) {
                    if (e && e.url) set[String(e.url)] = 1;
                });
            });
            _emojiUrlCache = { raw: raw, set: set };
            return set;
        } catch (e) { return _emojiUrlCache.set || null; }
    }
    function isEmojiUrl(u) {
        var set = emojiUrlSet();
        return !!(set && u && set[String(u)]);
    }
    function isEmojiRecord(x) {
        if (!x || typeof x !== 'object') return false;
        if (x.isEmoji || x.emojiName || x.emoji) return true;
        if (String(x.type || '').toLowerCase() === 'emoji') return true;
        if (String(x.kind || '').toLowerCase() === 'emoji') return true;
        if (/^\[(emoji|sticker|表情包|表情)\s*:/i.test(String(x.prompt || ''))) return true;
        var source = String(x.source || '');
        if (/表情/.test(source) || /^emoji/i.test(source)) return true;
        if (/^nano_emoji|^peach_emoji/i.test(String(x.from || x.storeKey || ''))) return true;
        if (isEmojiUrl(x.url)) return true;
        return false;
    }
    // 表情包数据主要在 IndexedDB（localStorage 只是精简镜像），清理时再异步补读一次。
    function emojiUrlSetFromDb() {
        return new Promise(function (resolve) {
            var local = emojiUrlSet();
            if (local && Object.keys(local).length) { resolve(local); return; }
            try {
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                        if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onerror = function () { resolve(local || {}); };
                req.onsuccess = function () {
                    try {
                        var db = req.result;
                        if (!db.objectStoreNames.contains('emoji_data')) { try { db.close(); } catch (e) {} resolve(local || {}); return; }
                        var r = db.transaction('emoji_data', 'readonly').objectStore('emoji_data').get('nano_emoji_data');
                        r.onsuccess = function () {
                            try {
                                var d = r.result ? r.result.value : null;
                                var set = {};
                                ((d && d.emojiGroups) || []).forEach(function (g) {
                                    ((g && g.emojis) || []).forEach(function (e) { if (e && e.url) set[String(e.url)] = 1; });
                                });
                                try { db.close(); } catch (e) {}
                                resolve(set);
                            } catch (e) { try { db.close(); } catch (e2) {} resolve(local || {}); }
                        };
                        r.onerror = function () { try { db.close(); } catch (e) {} resolve(local || {}); };
                    } catch (e) { resolve(local || {}); }
                };
                req.onblocked = function () { resolve(local || {}); };
            } catch (e) { resolve(local || {}); }
        });
    }
    function readTombs() {
        try {
            var raw = localStorage.getItem(TOMB_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    function writeTombs(arr) {
        try { localStorage.setItem(TOMB_KEY, JSON.stringify((arr || []).slice(-4000))); } catch (e) {}
    }
    function isTomb(k) { return readTombs().indexOf(k) > -1; }
    function tomb(key) {
        key = String(key || '');
        if (!key) return;
        var arr = readTombs();
        if (arr.indexOf(key) === -1) { arr.push(key); writeTombs(arr); }
    }
    function untomb(key) {
        key = String(key || '');
        if (!key) return;
        var arr = readTombs();
        var i = arr.indexOf(key);
        if (i > -1) { arr.splice(i, 1); writeTombs(arr); }
    }
    function purgeEmojiOnce() {
        try {
            if (localStorage.getItem(EMOJI_PURGE_KEY) === '1') return;
            var raw = localStorage.getItem(KEY);
            var arr = raw ? JSON.parse(raw) : [];
            if (Array.isArray(arr)) {
                var cleaned = arr.filter(function (x) { return !isEmojiRecord(x); });
                var removed = arr.length - cleaned.length;
                if (removed > 0) {
                    localStorage.setItem(KEY, JSON.stringify(cleaned));
                    localStorage.setItem('nano_gallery_purged_count', String(removed));
                }
            }
            localStorage.setItem(EMOJI_PURGE_KEY, '1');
            // 图库记录主要存在 IndexedDB：把里面混入的表情包也一并删掉。
            try {
                dbAll().then(function (items) {
                    var keys = (items || []).filter(function (x) { return x && x.url && isEmojiRecord(x); }).map(function (x) { return urlKey(x.url); });
                    if (keys.length) return dbDelete(keys);
                }).catch(function () {});
            } catch (e) {}
        } catch (e) {}
    }

    function read() {
        purgeEmojiOnce();
        try {
            var raw = localStorage.getItem(KEY);
            var arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) return [];
            return arr.filter(function (x) { return x && x.url && !isEmojiRecord(x); });
        } catch (e) { return []; }
    }
    function write(arr) {
        var list = (arr || []);
        try {
            localStorage.setItem(KEY, JSON.stringify(list));
            return true;
        } catch (e) {
            // localStorage 塞不下大图时，保留 http 图片的索引；base64 大图仍在 IndexedDB 里。
            try {
                var light = list.filter(function (x) { return !/^data:image\//i.test(String(x && x.url || '')); });
                localStorage.removeItem(KEY);
                localStorage.setItem(KEY, JSON.stringify(light));
                return true;
            } catch (e2) {
                try { localStorage.removeItem(KEY); } catch (e3) {}
                return false;
            }
        }
    }
    function add(rec) {
        if (!rec || !rec.url || isEmojiRecord(rec)) return;
        var u = String(rec.url);
        // 有些生图接口给的是 blob: 临时地址，页面一换就失效；先转成 data URL 再入库。
        if (/^blob:/i.test(u)) {
            try {
                fetch(u).then(function (r) { return r.blob(); }).then(blobToDataUrl).then(function (dataUrl) {
                    if (dataUrl) { rec.url = dataUrl; add(rec); }
                }).catch(function () {});
            } catch (e) {}
            return;
        }
        if (!/^(data:image\/|https?:\/\/)/i.test(u)) return;
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
        var k = urlKey(u);
        var item = {
            url: u,
            source: String(rec.source || '聊天'),
            charName: String(rec.charName || ''),
            prompt: String(rec.prompt || '').slice(0, 500),
            createdAt: Number(rec.createdAt) || Date.now()
        };
        // base64 大图只写 IndexedDB，不碰 5MB 的 localStorage，避免解析/写入卡顿和配额失败。
        if (/^data:image\//i.test(u)) {
            dbPut(item);
            untomb(k);
            try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
            return;
        }
        var arr = read();
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] && urlKey(arr[i].url) === k) { untomb(k); dbPut(arr[i]); return; }
        }
        dbPut(item);
        arr.unshift(item);
        untomb(k);
        write(arr);
        cacheRemoteImage(item, u);
        try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
    }
    function collectFromObject(obj, source, out, depth) {
        if (!obj || depth > 5) return;
        if (Array.isArray(obj)) {
            obj.forEach(function (x) { collectFromObject(x, source, out, depth + 1); });
            return;
        }
        if (typeof obj !== 'object') return;
        if (isEmojiRecord(obj)) return;
        var charName = obj.author || obj.user || obj.charName || obj.name || '';
        ['image', 'images', 'genImage', 'postImage', 'imageUrl', 'url'].forEach(function (k) {
            var v = obj[k];
            if (typeof v === 'string' && /^(data:image\/|https?:\/\/)/i.test(v)) {
                out.push({ url: v, source: source, charName: charName, prompt: obj.genPrompt || obj.body || obj.text || '', createdAt: obj.time ? (Date.parse(obj.time) || Date.now()) : Date.now() });
            } else if (Array.isArray(v)) {
                v.forEach(function (u) {
                    if (typeof u === 'string' && /^(data:image\/|https?:\/\/)/i.test(u)) {
                        out.push({ url: u, source: source, charName: charName, prompt: obj.genPrompt || obj.body || obj.text || '', createdAt: obj.time ? (Date.parse(obj.time) || Date.now()) : Date.now() });
                    }
                });
            }
        });
        Object.keys(obj).forEach(function (k) {
            if (['image', 'images', 'genImage', 'postImage', 'imageUrl', 'url', 'avatar', 'avatarImage'].indexOf(k) > -1) return;
            var v = obj[k];
            if (v && typeof v === 'object') collectFromObject(v, source, out, depth + 1);
        });
    }
    function scanLocal() {
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i) || '';
                if (key === KEY) continue;
                if (/emoji|表情/i.test(key)) continue;
                if (!/^ins_|^nano_ins|^nano_moments_data|^forum_/.test(key)) continue;
                var raw = localStorage.getItem(key);
                if (!raw || raw.length < 20 || raw.indexOf('data:image') < 0 && !/https?:\/\/[^"']+\.(png|jpe?g|webp|gif)/i.test(raw)) continue;
                var val;
                try { val = JSON.parse(raw); } catch (e) { continue; }
                var source = /moment/i.test(key) ? '朋友圈' : (/ins|forum/i.test(key) ? 'Ins' : '线下');
                collectFromObject(val, source, out, 0);
            }
        } catch (e) {}
        return out;
    }
    function loadCharNames() {
        return new Promise(function (resolve) {
            var out = {}, done = false;
            function finish() { if (!done) { done = true; resolve(out); } }
            function openIt() {
                try {
                    var req = indexedDB.open('nano_characters_db');
                    req.onupgradeneeded = function () {};
                    req.onsuccess = function () {
                        var db = req.result;
                        try {
                            if (!db.objectStoreNames.contains('characters')) {
                                db.close();
                                // 不要留下一个空库，否则角色库之后用同版本打开会看不到 characters store。
                                try { indexedDB.deleteDatabase('nano_characters_db'); } catch (e) {}
                                finish(); return;
                            }
                            var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
                            r.onsuccess = function () {
                                (r.result || []).forEach(function (c) {
                                    if (c && c.id) out[String(c.id)] = String(c.name || '');
                                });
                                try { db.close(); } catch (e) {}
                                finish();
                            };
                            r.onerror = function () { try { db.close(); } catch (e) {} finish(); };
                        } catch (e) { try { db.close(); } catch (e2) {} finish(); }
                    };
                    req.onerror = finish;
                    req.onblocked = finish;
                } catch (e) { finish(); }
            }
            // 先确认角色库存在，避免为了读名字反而新建一个空的 nano_characters_db。
            if (indexedDB.databases) {
                indexedDB.databases().then(function (list) {
                    var has = (list || []).some(function (d) { return d && d.name === 'nano_characters_db'; });
                    if (has) openIt(); else finish();
                }).catch(openIt);
            } else openIt();
        });
    }

    function all() {
        var out = read().slice();
        var tombs = {};
        readTombs().forEach(function (k) { tombs[k] = 1; });
        var seen = {};
        out = out.filter(function (x) {
            if (!x || !x.url) return false;
            var k = urlKey(x.url);
            if (tombs[k]) return false;
            seen[k] = 1;
            return true;
        });
        scanLocal().forEach(function (x) {
            if (!x || !x.url || isEmojiRecord(x)) return;
            var k = urlKey(x.url);
            if (seen[k] || tombs[k]) return;
            seen[k] = 1; out.push(x);
        });
        out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return out;
    }
    function mergeWithDb(base, extra) {
        var tombs = {};
        readTombs().forEach(function (k) { tombs[k] = 1; });
        var seen = {}, out = [];
        (base || []).concat(extra || []).forEach(function (x) {
            if (!x || !x.url || isEmojiRecord(x)) return;
            var k = urlKey(x.url);
            if (!k || tombs[k] || seen[k]) return;
            seen[k] = 1;
            out.push(x);
        });
        out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return out;
    }
    function allAsyncCore() {
        var base = all();
        var dbP = dbAll().catch(function () { return []; });
        if (typeof localforage === 'undefined') {
            return dbP.then(function (dbItems) { return mergeWithDb(base, dbItems); });
        }
        // 旧版图库靠扫描聊天记录迁移图片。现在生图入库时已经 add 到图库，
        // 每次打开都扫描全部聊天会把几百张大图重新 JSON.parse 一遍，导致页面卡 30 秒。
        // 只迁移一次，之后直接读图库数据库；用户手动清理后新图仍由生成流程写入。
        var needScan = true;
        try { needScan = localStorage.getItem(CHAT_SCAN_KEY) !== '1'; } catch (e) {}
        if (!needScan) {
            return dbP.then(function (dbItems) { return mergeWithDb(base, dbItems); });
        }
        return Promise.all([dbP, localforage.keys(), loadCharNames()]).then(function (res) {
            var dbItems = res[0] || [];
            base = mergeWithDb(base, dbItems);
            var keys = res[1] || [], charNames = res[2] || {};
            var chatKeys = (keys || []).filter(function (k) { return /^chat_messages_/.test(k); }).slice(0, 40);
            return Promise.all(chatKeys.map(function (k) {
                var cid = String(k).replace(/^chat_messages_/, '');
                var cname = charNames[cid] || '';
                return localforage.getItem(k).then(function (msgs) {
                    var out = [];
                    (Array.isArray(msgs) ? msgs : []).forEach(function (m) {
                        if (!m || !m.imageData || m.imageData.isEmoji || m.imageData.emojiName) return;
                        if (m.isEmoji || m.emojiName) return;
                        var mt = String(m.text || '') + ' ' + String(m.imageData.desc || m.imageData.prompt || '');
                        // 只看明确的 [emoji:...] / [表情:...] 标记；不能因为照片配文里提到“表情包”
                        // 就把正常照片排除掉（这是以前图库“照片变少”的原因之一）。
                        if (/\[(emoji|sticker|表情包|表情)\s*:/i.test(mt)) return;
                        if (isEmojiRecord(m) || isEmojiRecord(m.imageData)) return;
                        var u = m.imageData && (m.imageData.url || (m.imageData.urls && m.imageData.urls[0]));
                        if (u && /^(data:image\/|https?:\/\/)/i.test(u)) {
                            out.push({ url: u, source: '聊天', charName: cname, charId: cid, prompt: m.imageData.prompt || m.text || '', createdAt: Date.parse(m.time || '') || 0 });
                        }
                    });
                    return out;
                }).catch(function () { return []; });
            })).then(function (groups) {
                var tombs = {};
                readTombs().forEach(function (k) { tombs[k] = 1; });
                var scannedName = {};
                groups.forEach(function (g) {
                    (g || []).forEach(function (x) {
                        if (x && x.url && x.charName) scannedName[urlKey(x.url)] = x.charName;
                    });
                });
                // 旧图库里可能没有存角色名：用聊天记录里扫到的名字补上，避免显示“未知角色”。
                base.forEach(function (x) {
                    if (x && x.url && !x.charName && scannedName[urlKey(x.url)]) x.charName = scannedName[urlKey(x.url)];
                });
                var seen = {};
                var persist = [];
                base.forEach(function (x) { if (x && x.url) seen[urlKey(x.url)] = 1; });
                groups.forEach(function (g) {
                    (g || []).forEach(function (x) {
                        if (!x || !x.url || isEmojiRecord(x)) return;
                        var k = urlKey(x.url);
                        if (!seen[k] && !tombs[k]) {
                            seen[k] = 1;
                            base.push(x);
                            // 关键：扫描出来的照片必须真正写进 IndexedDB。
                            // 以前只放进内存数组，大退后下次启动就“全没了”。
                            persist.push(dbPut(x));
                        }
                    });
                });
                base.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
                return Promise.all(persist).then(function () {
                    try { localStorage.setItem(CHAT_SCAN_KEY, '1'); } catch (e) {}
                    return base;
                });
            });
        }).catch(function () { return base; });
    }
    function allAsync() {
        return Promise.resolve(allAsyncCore()).then(function (list) {
            return emojiUrlSetFromDb().then(function (set) {
                return (list || []).filter(function (x) {
                    if (!x || !x.url) return false;
                    if (isEmojiUrl(x.url)) return false;
                    if (set && set[String(x.url)]) return false;
                    return true;
                });
            });
        }).catch(function () { return all(); });
    }
    function remove(urls) {
        var list = Array.isArray(urls) ? urls : [urls];
        var keys = {};
        list.forEach(function (u) { if (u) keys[urlKey(u)] = 1; });
        var keyList = Object.keys(keys);
        if (!keyList.length) return 0;
        // 关键：不管这张图来自 nano_gallery_v1、localStorage 扫描还是聊天 IndexedDB，
        // 都先登记墓碑。以前只登记“当前同步可见”的图，聊天里异步扫出来的图删完又回来了。
        keyList.forEach(tomb);
        dbDelete(keyList);
        var arr = read();
        var keep = arr.filter(function (x) {
            return !(x && x.url && keys[urlKey(x.url)]);
        });
        write(keep);
        try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
        return keyList.length;
    }
    function clear() {
        // 先标记“已扫描过”，否则下面的 allAsync 会重新扫描聊天并把照片写回数据库，
        // 造成「点了清空，图片过一会儿又回来了」。
        try { localStorage.setItem(CHAT_SCAN_KEY, '1'); } catch (e) {}
        all().forEach(function (x) { if (x && x.url) tomb(urlKey(x.url)); });
        write([]);
        dbClear();
        try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
        // 聊天记录是异步读的，补一轮墓碑，确保一键清空后不会再被扫描回来
        if (typeof localforage !== 'undefined') {
            allAsync().then(function (list) {
                (list || []).forEach(function (x) { if (x && x.url) tomb(urlKey(x.url)); });
                write([]);
                dbClear();
                try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
            }).catch(function () {});
        }
    }
    function purgeEmoji() {
        try { localStorage.removeItem(EMOJI_PURGE_KEY); } catch (e) {}
        purgeEmojiOnce();
        try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
    }
    function removeEmoji() {
        return Promise.all([Promise.resolve(allAsyncCore()), emojiUrlSetFromDb()]).then(function (res) {
            var list = res[0] || [];
            var set = res[1] || {};
            var urls = list.filter(function (x) {
                if (!x || !x.url) return false;
                if (isEmojiRecord(x)) return true;
                if (set[String(x.url)]) return true;
                return /\[(emoji|sticker|表情包|表情)\s*:/i.test(String(x.prompt || ''));
            }).map(function (x) { return x.url; });
            if (urls.length) remove(urls);
            return urls.length;
        });
    }

    window.NanoGallery = {
        add: add, all: all, allAsync: allAsync, remove: remove, clear: clear,
        purgeEmoji: purgeEmoji, removeEmoji: removeEmoji
    };
})();
