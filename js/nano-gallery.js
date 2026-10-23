(function () {
    'use strict';
    var KEY = 'nano_gallery_v1';
    var TOMB_KEY = 'nano_gallery_deleted_v1';
    var EMOJI_PURGE_KEY = 'nano_gallery_emoji_purged_v2';

    function urlKey(u) {
        u = String(u || '');
        return u.slice(0, 120) + '#' + u.length;
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
        return false;
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
                    localStorage.setItem(KEY, JSON.stringify(cleaned.slice(0, 400)));
                    localStorage.setItem('nano_gallery_purged_count', String(removed));
                }
            }
            localStorage.setItem(EMOJI_PURGE_KEY, '1');
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
        try { localStorage.setItem(KEY, JSON.stringify((arr || []).slice(0, 400))); } catch (e) {}
    }
    function add(rec) {
        if (!rec || !rec.url || isEmojiRecord(rec)) return;
        var u = String(rec.url);
        if (!/^(data:image\/|https?:\/\/)/i.test(u)) return;
        var arr = read();
        var k = urlKey(u);
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] && urlKey(arr[i].url) === k) { untomb(k); return; }
        }
        arr.unshift({
            url: u,
            source: String(rec.source || '聊天'),
            charName: String(rec.charName || ''),
            prompt: String(rec.prompt || '').slice(0, 500),
            createdAt: Number(rec.createdAt) || Date.now()
        });
        untomb(k);
        write(arr);
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
    function allAsync() {
        var base = all();
        if (typeof localforage === 'undefined') return Promise.resolve(base);
        return Promise.all([localforage.keys(), loadCharNames()]).then(function (res) {
            var keys = res[0] || [], charNames = res[1] || {};
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
                        if (/\[(emoji|sticker|表情包|表情)\s*:/i.test(mt) || /表情包/.test(mt)) return;
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
                base.forEach(function (x) { if (x && x.url) seen[urlKey(x.url)] = 1; });
                groups.forEach(function (g) {
                    (g || []).forEach(function (x) {
                        if (!x || !x.url || isEmojiRecord(x)) return;
                        var k = urlKey(x.url);
                        if (!seen[k] && !tombs[k]) { seen[k] = 1; base.push(x); }
                    });
                });
                base.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
                return base;
            });
        }).catch(function () { return base; });
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
        var arr = read();
        var keep = arr.filter(function (x) {
            return !(x && x.url && keys[urlKey(x.url)]);
        });
        write(keep);
        try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
        return keyList.length;
    }
    function clear() {
        all().forEach(function (x) { if (x && x.url) tomb(urlKey(x.url)); });
        write([]);
        try { window.dispatchEvent(new CustomEvent('nano-gallery-updated')); } catch (e) {}
        // 聊天记录是异步读的，补一轮墓碑，确保一键清空后不会再被扫描回来
        if (typeof localforage !== 'undefined') {
            allAsync().then(function (list) {
                (list || []).forEach(function (x) { if (x && x.url) tomb(urlKey(x.url)); });
                write([]);
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
        return Promise.resolve(allAsync()).then(function (list) {
            var urls = (list || []).filter(function (x) {
                if (!x || !x.url) return false;
                if (isEmojiRecord(x)) return true;
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
