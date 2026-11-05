(function() {
    'use strict';

    // ===== 存储 keys =====
    var MASK_STORAGE_KEY = 'nano_mask_data';
    var HOME_STORAGE_KEY = 'nano_home_data';
    var CONTACT_STORAGE_KEY = 'nano_contacts_data';
    var SETTINGS_STORAGE_KEY = 'nano_settings_data';
    var MOMENTS_STORAGE_KEY = 'nano_moments_data';

    // ===== IndexedDB 封装 =====
    var DB_NAME = 'NanoMomentsDB';
    var DB_VERSION = 1;
    var STORE_NAME = 'moments';
    var db = null;

    function openDB(callback) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(e) {
            var d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_NAME)) {
                d.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = function(e) { db = e.target.result; callback(db); };
        req.onerror = function(e) { console.error('[IndexedDB] 打开失败', e); callback(null); };
    }

    function dbGetAll(callback) {
        if (!db) { callback([]); return; }
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function() { callback(req.result || []); };
        req.onerror = function() { callback([]); };
    }

    function dbPut(item, callback) {
        if (!db) { if (callback) callback(false); return; }
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.put(item);
        tx.oncomplete = function() { if (callback) callback(true); };
        tx.onerror = function() { if (callback) callback(false); };
    }

    function dbPutMany(items, callback) {
        if (!db) { if (callback) callback(false); return; }
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        items.forEach(function(item) { store.put(item); });
        tx.oncomplete = function() { if (callback) callback(true); };
        tx.onerror = function() { if (callback) callback(false); };
    }

    function dbDelete(id, callback) {
        if (!db) { if (callback) callback(false); return; }
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = function() { if (callback) callback(true); };
        tx.onerror = function() { if (callback) callback(false); };
    }

    function currentMaskId() { return String((currentUser && currentUser.id) || 'default'); }

    function normalizeMaskScoped(items, cb) {
        var mid = currentMaskId();
        var mine = [];
        var changed = false;
        (items || []).forEach(function (it) {
            if (!it || !it.id) return;
            if (!it.maskId) { it.maskId = mid; changed = true; mine.push(it); return; }
            if (String(it.maskId) === mid) mine.push(it);
        });
        mine.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
        if (changed && db) { dbPutMany(mine, function () {}); }
        cb(mine);
    }

    function loadMomentsData(callback) {
        if (db) {
            dbGetAll(function (items) {
                // 后台推送暂存的朋友圈会先写 localStorage；这里合并 srv_ 开头的条目，
                // 避免「通知说发了动态，打开朋友圈却没有」。
                try {
                    var raw = localStorage.getItem(MOMENTS_STORAGE_KEY);
                    var local = raw ? JSON.parse(raw) : [];
                    if (Array.isArray(local) && local.length) {
                        var seen = {};
                        (items || []).forEach(function (x) { if (x && x.id) seen[x.id] = 1; });
                        local.forEach(function (x) {
                            if (x && x.id && String(x.id).indexOf('srv_') === 0 && !seen[x.id]) items.push(x);
                        });
                    }
                } catch (e) {}
                normalizeMaskScoped(items, callback);
            });
        } else {
            try {
                var raw2 = localStorage.getItem(MOMENTS_STORAGE_KEY);
                if (raw2) { normalizeMaskScoped(JSON.parse(raw2), callback); return; }
            } catch (e) {}
            normalizeMaskScoped([], callback);
        }
    }

    function saveMomentsData(data) {
        var mid = currentMaskId();
        (data || []).forEach(function (it) { if (it) it.maskId = mid; });
        if (db) { dbPutMany(data, function () {}); }
        else {
            try {
                var raw = localStorage.getItem(MOMENTS_STORAGE_KEY);
                var all = raw ? JSON.parse(raw) : [];
                all = (all || []).filter(function (m) { return m && m.maskId !== mid; });
                localStorage.setItem(MOMENTS_STORAGE_KEY, JSON.stringify(all.concat(data || [])));
            } catch (e) {}
        }
    }

    function saveOneMoment(item) {
        if (item) item.maskId = currentMaskId();
        if (db) { dbPut(item, function () {}); }
        else {
            try {
                var raw = localStorage.getItem(MOMENTS_STORAGE_KEY);
                var arr = raw ? JSON.parse(raw) : [];
                var idx = arr.findIndex(function (m) { return m.id === item.id; });
                if (idx > -1) arr[idx] = item; else arr.unshift(item);
                localStorage.setItem(MOMENTS_STORAGE_KEY, JSON.stringify(arr));
            } catch(e) {}
        }
    }

    function removeMoment(id) {
        if (db) { dbDelete(id, function () {}); }
        try {
            var raw = localStorage.getItem(MOMENTS_STORAGE_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            arr = (arr || []).filter(function (m) { return m && m.id !== id; });
            localStorage.setItem(MOMENTS_STORAGE_KEY, JSON.stringify(arr));
        } catch(e) {}
    }

    // ===== 读取用户/角色数据（人设面具优先 nano_mask_data） =====
    function loadHomeData() {
        var keys = [MASK_STORAGE_KEY, HOME_STORAGE_KEY, 'peach_home_data'];
        for (var i = 0; i < keys.length; i++) {
            try {
                var raw = localStorage.getItem(keys[i]);
                if (raw) {
                    var d = JSON.parse(raw);
                    if (d && Array.isArray(d.masks)) return d;
                }
            } catch (e) {}
        }
        return null;
    }
    function loadContactsData() {
        try {
            var raw = localStorage.getItem(CONTACT_STORAGE_KEY);
            if (raw) {
                var d = JSON.parse(raw);
                if (d && d.chars && Array.isArray(d.chars)) return d.chars;
                if (Array.isArray(d)) return d;
                return [];
            }
        } catch(e) { console.error('加载联系人失败:', e); }
        return [];
    }

    // ===== 当前 User 面具（每个面具 = 一个用户，对应自己的几个 char 与朋友圈） =====
    function getCurrentMask() {
        var h = loadHomeData();
        if (h && h.masks && h.masks.length) {
            var id = h.currentMaskId;
            if (id) { var f = h.masks.find(function (m) { return m.id === id; }); if (f) return f; }
            return h.masks[0];
        }
        return null;
    }

    function refreshCurrentUserFromMask() {
        var m = getCurrentMask();
        if (m) currentUser = m;
        applyUserHeader();
        if (currentUser && currentUser.id) {
            loadMaskAvatar(currentUser.id).then(function (av) {
                if (av) {
                    currentUser.avatar = av;
                    applyUserHeader();
                    try { renderFeed(); } catch (e) {}
                    try {
                        if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId) openDetail(currentDetailId);
                    } catch (e) {}
                }
            });
        }
        try { hydrateCover(); } catch (e) {}
    }

    // 面具头像存在 IndexedDB：MaskAvatarDB / avatars（key = 面具 id）
    var MASK_AVATAR_DB = 'MaskAvatarDB';
    var MASK_AVATAR_STORE = 'avatars';
    function loadMaskAvatar(maskId) {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open(MASK_AVATAR_DB, 1);
                req.onupgradeneeded = function (e) {
                    try { var d = e.target.result; if (!d.objectStoreNames.contains(MASK_AVATAR_STORE)) d.createObjectStore(MASK_AVATAR_STORE, { keyPath: 'id' }); } catch (e2) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains(MASK_AVATAR_STORE)) { d.close(); resolve(''); return; }
                        var r = d.transaction(MASK_AVATAR_STORE, 'readonly').objectStore(MASK_AVATAR_STORE).get(maskId);
                        r.onsuccess = function () { var v = r.result ? r.result.data : ''; try { d.close(); } catch (e2) {} resolve(v || ''); };
                        r.onerror = function () { try { d.close(); } catch (e2) {} resolve(''); };
                    } catch (e2) { resolve(''); }
                };
                req.onerror = function () { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }

    // 动态头像：用户自己的动态始终用当前面具头像；其它人没有头像则用「灰底首字」（方形）
    function isInitialAvatar(url) {
        if (!url) return true;
        var s = String(url);
        // 内置生成的 SVG 头像（包括旧版彩色 NPC 头像）统一按灰色占位处理
        if (s.indexOf('data:image/svg+xml') === 0) return true;
        return false;
    }
    function itemAvatarSrc(item) {
        if (!item) return initialAvatar('?');
        if (normName(item.author) === normName(currentUser.name)) return avatarSrcFor(currentUser.name, currentUser.avatar);
        var av = item.avatar;
        if (!av || isInitialAvatar(av)) {
            var known = findCharAvatar(item.author);
            if (known) av = known;
        }
        return (av && !isInitialAvatar(av)) ? av : initialAvatar(item.author);
    }
    function findCharAvatar(name) {
        var n = normName(name);
        if (!n) return '';
        try {
            var hit = (allAvailableChars || []).find(function (x) {
                return x && normName(x.name) === n && x.avatar;
            });
            if (hit) return hit.avatar;
        } catch (e) {}
        return '';
    }

    // ===== 头像：没有头像时用「灰底 + 姓名首字」 =====
    function escapeXmlText(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function initialAvatar(name) {
        var ch = String(name || '?').trim().charAt(0) || '?';
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
            '<rect width="120" height="120" fill="#c7c7cc"/>' +
            '<text x="60" y="60" dy="0.36em" text-anchor="middle" font-size="52" fill="#ffffff" ' +
            'font-family="-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif">' + escapeXmlText(ch) + '</text></svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
    // NPC 没有真实头像时统一用灰底首字，不再按名字生成彩色头像
    function generatedAvatar(name) {
        return initialAvatar(name);
    }
    function avatarSrcFor(name, avatar) {
        return (avatar && String(avatar).trim()) ? avatar : initialAvatar(name);
    }

    function applyUserHeader() {
        var nameEl = document.getElementById('userName');
        var avEl = document.getElementById('userAvatar');
        if (nameEl) nameEl.textContent = (currentUser && currentUser.name) || '我';
        if (avEl) avEl.src = avatarSrcFor((currentUser && currentUser.name) || '我', currentUser && currentUser.avatar);
    }

    // ===== NPC 花名册（按面具缓存；必须是符合设定的现实关系人物，禁止路人甲） =====
    var NPC_ROSTER_PREFIX = 'nano_moments_npcs_';
    var NPC_ROLE_BLACKLIST = /(旅行者|游客|路人|路人甲|陌生人|神秘人|神秘|未知|某人|那位|这位|新朋友|网友|客人|顾客|邻居|同事|同学|老师|医生|护士|警官|警察|司机|阿姨|叔叔|大爷|大妈|女士|先生|小姐|老板|店主|店长|店员|朋友|好友|总裁|助理|前台|保安|服务生|路人角色|NPC|npc)/;
    var NPC_ROLE_EN = /(^|\s)(boss|manager|owner|shopkeeper|stranger|traveler|traveller|mystery|friend|neighbor|neighbour|colleague|classmate|npc|unknown|someone)(\s|$)/i;

    // 「李思雨（大学同学）」→ 真实姓名 + 备注。备注可以显示，但名字必须是真名。
    function splitNpcDisplayName(raw) {
        var s = String(raw == null ? '' : raw).trim().replace(/^@+/, '').trim();
        var m = s.match(/^([^（(【\[]+?)\s*(?:[（(【\[]\s*([^）)】\]]+?)\s*[）)】\]])\s*$/);
        if (m) return { name: String(m[1] || '').trim(), note: String(m[2] || '').trim() };
        return { name: s, note: '' };
    }

    function isGenericNpcName(name) {
        var n = String(splitNpcDisplayName(name).name || '').trim();
        if (!n) return true;
        // 非中文姓名（英/日/韩/俄/阿拉伯等）允许更长的完整姓名
        if (/[\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F]/.test(n)) {
            if (n.length < 2 || n.length > 12) return true;
        } else if (/[A-Za-z\u00C0-\u024F]/.test(n)) {
            if (n.length < 2 || n.length > 40) return true;
            if (n.replace(/[^A-Za-z\u00C0-\u024F]/g, '').length < 2) return true;
            if (NPC_ROLE_EN.test(n)) return true;
        } else {
            if (n.length < 2 || n.length > 6) return true;
        }
        if (/^[阿小老]./.test(n)) return true;
        if (NPC_ROLE_BLACKLIST.test(n)) return true;
        // 「王姐」「李哥」「张叔」这类只有姓+称呼的假名
        if (/^[\u4e00-\u9fa5]{1,2}(姐|哥|叔|姨|婶|爷|奶|婆|嫂|总|董|老师|医生|老板|店主|店长|店员|先生|女士|小姐)$/.test(n)) return true;
        return false;
    }

    // 花名册按「作者角色」隔离：charA 的熟人只出现在 charA 的动态下，不和 charB 共用。
    function rosterScopeToken(scope) {
        return String(scope || 'global').replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    function rosterKey(scope) { return NPC_ROSTER_PREFIX + currentMaskId() + '_' + rosterScopeToken(scope); }
    function rosterSrcKey(scope) { return NPC_ROSTER_PREFIX + 'src_' + currentMaskId() + '_' + rosterScopeToken(scope); }
    function readRoster(key) {
        try {
            var raw = localStorage.getItem(key);
            if (raw) {
                var arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    // 旧版存的是彩色 NPC 头像：加载时统一换成灰底首字
                    return arr.map(function (n) {
                        if (n && /nano-generated-avatar/.test(String(n.avatar || ''))) n.avatar = generatedAvatar(n.name);
                        return n;
                    });
                }
            }
        } catch (e) {}
        return null;
    }
    function loadNpcRoster(scope) {
        if (scope) return readRoster(rosterKey(scope));
        // 不指定 scope：合并该 mask 下所有作者的花名册（只用于头像/资料回查）
        var out = [], seen = {};
        try {
            var prefix = NPC_ROSTER_PREFIX + currentMaskId() + '_';
            var srcPrefix = NPC_ROSTER_PREFIX + 'src_' + currentMaskId() + '_';
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(prefix) !== 0 || k.indexOf(srcPrefix) === 0) continue;
                (readRoster(k) || []).forEach(function (n) {
                    if (!n || !n.name || seen[n.name]) return;
                    seen[n.name] = 1; out.push(n);
                });
            }
        } catch (e) {}
        return out;
    }
    function loadNpcRosterSrc(scope) {
        try { var raw = localStorage.getItem(rosterSrcKey(scope)); if (raw) { var a = JSON.parse(raw); if (Array.isArray(a)) return a; } } catch (e) {}
        return null;
    }
    function saveNpcRoster(list, charIds, scope) {
        try {
            localStorage.setItem(rosterKey(scope), JSON.stringify(list || []));
            localStorage.setItem(rosterSrcKey(scope), JSON.stringify(charIds || []));
        } catch (e) {}
    }

    // 清理历史数据：两个 char 的花名册里如果有同名 NPC，只保留给第一个 char，避免重复出现。
    function dedupeCharRosters() {
        try {
            var owners = charRosterNameOwners();
            var prefix = NPC_ROSTER_PREFIX + currentMaskId() + '_';
            var srcPrefix = NPC_ROSTER_PREFIX + 'src_' + currentMaskId() + '_';
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            keys.forEach(function (k) {
                if (!k || k.indexOf(prefix) !== 0 || k.indexOf(srcPrefix) === 0) return;
                var token = k.slice(prefix.length);
                if (token.indexOf('char_') !== 0) return;
                var list = readRoster(k) || [];
                var filtered = list.filter(function (n) { return n && n.name && owners[normName(n.name)] === token; });
                if (filtered.length !== list.length) {
                    try { localStorage.setItem(k, JSON.stringify(filtered)); } catch (e) {}
                }
            });
        } catch (e) {}
    }

    // 每个 NPC 名字只归属一个 char 花名册（先到先得），用来清理历史数据里跨角色重复的 NPC。
    function charRosterNameOwners() {
        var out = {};
        try {
            var prefix = NPC_ROSTER_PREFIX + currentMaskId() + '_';
            var srcPrefix = NPC_ROSTER_PREFIX + 'src_' + currentMaskId() + '_';
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(prefix) !== 0 || k.indexOf(srcPrefix) === 0) continue;
                var token = k.slice(prefix.length);
                if (token.indexOf('char_') !== 0) continue;
                (readRoster(k) || []).forEach(function(n) {
                    if (!n || !n.name) return;
                    var key = normName(n.name);
                    if (key && !out[key]) out[key] = token;
                });
            }
        } catch (e) {}
        return out;
    }

    // 旧版本在 AI 失败时会塞入固定名字（周予安 / 林知夏 / 沈叙白…），
    // 导致每次生成都是同一批人。现在不再内置任何角色：NPC 必须由 AI 根据
    // 人设、世界书、记忆库自己想名字；失败时宁可暂时没有 NPC 评论。
    var LEGACY_FALLBACK_NPC_NAMES = { '周予安': 1, '林知夏': 1, '沈叙白': 1, '陈晚晴': 1, '许知远': 1, '顾清和': 1 };
    function isLegacyFallbackNpc(name) {
        return !!LEGACY_FALLBACK_NPC_NAMES[String(name == null ? '' : name).trim()];
    }
    function fallbackNpcRoster() {
        return [];
    }

    // ===== 顶部生成中提示 =====
    function showMomentsLoading(text) {
        var el = document.getElementById('momentsLoading');
        if (!el) return;
        var t = document.getElementById('momentsLoadingText');
        if (t) t.textContent = text || '正在生成…';
        el.classList.add('show');
    }
    function hideMomentsLoading() {
        var el = document.getElementById('momentsLoading');
        if (el) el.classList.remove('show');
    }

    // ===== 从角色库(IndexedDB)读取角色（含人设），朋友圈需要真实角色数据 =====
    function loadCharsFromDB() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (e2) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var d = e.target.result;
                        var r = d.transaction('characters', 'readonly').objectStore('characters').getAll();
                        r.onsuccess = function () { resolve(r.result || []); };
                        r.onerror = function () { resolve([]); };
                    } catch (e2) { resolve([]); }
                };
                req.onerror = function () { resolve([]); };
            } catch (e) { resolve([]); }
        });
    }

    function loadWorldbookText(boundIds, chars) {
        var out = [];
        try {
            var raw = localStorage.getItem('nano_worldbook_data_v5');
            if (raw) {
                var d = JSON.parse(raw); var files = (d && d.files) || [];
                // 角色编辑页里挂的「单本世界书」写在 char.worldbookBindings，
                // 不一定同步到 file.boundCharacters；以角色身上的绑定为准。
                var bindIds = {};
                (chars || []).forEach(function (c) {
                    ((c && c.worldbookBindings) || []).forEach(function (b) { if (b && b.id) bindIds[String(b.id)] = true; });
                });
                files.forEach(function (f) {
                    if (!f) return;
                    var scope = f.scope || 'global';
                    var boundHit = !!bindIds[String(f.id)] ||
                        (f.boundCharacters || []).some(function (b) { return (boundIds || []).indexOf(b) > -1; });
                    if (scope === 'local') {
                        if (!boundHit) return;
                    } else if (scope === 'online' && f.onlineTarget === 'pick') {
                        if ((f.boundCharacters || []).length && !boundHit) return;
                    }
                    var txt = '';
                    if (Array.isArray(f.entries)) txt = f.entries.map(function (en) { return en && en.content ? String(en.content) : ''; }).filter(Boolean).join('\n');
                    else if (typeof f.content === 'string') txt = f.content;
                    if (txt.trim()) out.push('【' + (f.name || '世界书') + '】\n' + txt.trim().slice(0, 1200));
                });
            }
        } catch (e) {}
        return out.slice(0, 3).join('\n\n');
    }

    // 读取角色长期记忆，供 AI 推断「记忆里真实出现过的人」，避免凭空造人
    function loadCharMemoryText(chars) {
        var ids = (chars || []).map(function(c) { return c && c.id; }).filter(Boolean);
        if (!ids.length) return Promise.resolve('');
        return new Promise(function(resolve) {
            try {
                var req = indexedDB.open('nano_vector_memory_db', 5);
                req.onupgradeneeded = function(e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
                    } catch (e2) {}
                };
                req.onsuccess = function(e) {
                    try {
                        var db = e.target.result;
                        var tx = db.transaction('config', 'readonly');
                        var store = tx.objectStore('config');
                        var out = [], pending = ids.length;
                        ids.forEach(function(id) {
                            var r = store.get('memlist_' + id);
                            r.onsuccess = function() {
                                var list = (r.result && Array.isArray(r.result.value)) ? r.result.value : [];
                                var txt = list.slice(-12).map(function(m) {
                                    return String((m && (m.content || m.text)) || '').trim();
                                }).filter(Boolean).join('\n');
                                if (txt) out.push('【' + ((chars || []).find(function(c) { return String(c.id) === String(id); }) || {}).name + ' 的记忆】\n' + txt);
                                if (--pending <= 0) { try { db.close(); } catch (e3) {} resolve(out.join('\n\n')); }
                            };
                            r.onerror = function() { if (--pending <= 0) { try { db.close(); } catch (e3) {} resolve(out.join('\n\n')); } };
                        });
                    } catch (e2) { resolve(''); }
                };
                req.onerror = function() { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }

    var MOMENT_LANG_BY_NAT = {
        '美国': '英文', '英国': '英文', '澳大利亚': '英文', '加拿大': '英文', '新西兰': '英文', '爱尔兰': '英文',
        '法国': '法文', '德国': '德文', '奥地利': '德文', '瑞士': '德文', '意大利': '意大利文', '西班牙': '西班牙文',
        '葡萄牙': '葡萄牙文', '俄罗斯': '俄文', '乌克兰': '乌克兰文', '日本': '日文', '韩国': '韩文', '朝鲜': '韩文',
        '泰国': '泰文', '越南': '越南文', '印度': '印地文', '阿拉伯': '阿拉伯文', '土耳其': '土耳其文', '荷兰': '荷兰文',
        '瑞典': '瑞典文', '挪威': '挪威文', '丹麦': '丹麦文', '芬兰': '芬兰文', '波兰': '波兰文', '巴西': '葡萄牙文',
        '墨西哥': '西班牙文', '阿根廷': '西班牙文', '埃及': '阿拉伯文', '伊朗': '波斯文', '以色列': '希伯来文'
    };
    function charLanguageName(c) {
        c = c || {};
        var lang = String(c.language || '').trim();
        if (lang && lang !== '未知' && lang !== '未设定') return lang;
        var nat = String(c.nationality || c.country || '').trim();
        for (var k in MOMENT_LANG_BY_NAT) {
            if (nat.indexOf(k) > -1) return MOMENT_LANG_BY_NAT[k];
        }
        return '英文';
    }
    function charForeignInfo(c) {
        c = c || {};
        var nat = String(c.nationality || c.country || '').trim();
        var lang = String(c.language || '').trim();
        var chinese = /(中国|中國|china|chinese|台湾|香港|澳门|澳門)/i.test(nat);
        var nonChineseLang = !!lang && !/中文|汉语|漢語|普通话|國語|chinese|mandarin|粤语|粵語|cantonese/i.test(lang);
        if (c.foreign === true) return { foreign: true, nat: nat || '外国', lang: charLanguageName(c) };
        if (nat && nat !== '未知' && nat !== '未设定' && !chinese) return { foreign: true, nat: nat, lang: charLanguageName(c) };
        if (nonChineseLang) return { foreign: true, nat: (nat && nat !== '未知' && nat !== '未设定' && !chinese) ? nat : '外国', lang: lang };
        return { foreign: false, nat: nat, lang: '中文' };
    }
    function looksForeignMomentText(text) {
        var first = String(text || '').split(/\n/)[0] || '';
        var han = (first.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
        var foreign = (first.match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F]/g) || []).length;
        return foreign >= 2 && han <= 2;
    }

    function buildPersonaBlock(allChars) {
        var lines = [];
        lines.push('【可扮演的角色 / NPC · 必须严格贴人设、不得 OOC】');
        (allChars || []).forEach(function (c) {
            if (!c || !c.name) return;
            lines.push('◇ ' + c.name + (c.gender && c.gender !== '未知' ? ('（' + c.gender + '）') : ''));
            var nat = String(c.nationality || c.country || '').trim();
            if (nat && nat !== '未知' && nat !== '未设定') lines.push('国籍/文化背景：' + nat);
            lines.push((c.setting && String(c.setting).trim()) ? String(c.setting).trim().slice(0, 600) : '（暂无详细设定，按名字与语境自然扮演）');
        });
        var ids = (allChars || []).map(function (c) { return c.id; }).filter(Boolean);
        var wb = loadWorldbookText(ids, allChars);
        if (wb) lines.push('\n【世界书】\n' + wb);
        return lines.join('\n');
    }

    // 生成朋友圈用的人设：char 与 NPC 必须分区；char 之间绝对、任何情况下都不互动。
    function buildMomentsPersona(chars, npcs) {
        var out = '【已选角色（char）】\n';
        (chars || []).forEach(function (c) {
            if (!c || !c.name) return;
            out += '◇ ' + c.name + (c.gender && c.gender !== '未知' ? ('（' + c.gender + '）') : '') + '\n';
            var fi = charForeignInfo(c);
            if (fi.foreign) out += '国籍：' + (fi.nat || '外国') + '；母语：' + fi.lang + '\n';
            out += ((c.setting && String(c.setting).trim()) ? String(c.setting).trim().slice(0, 600) : '（暂无详细设定，按名字与语境自然扮演）') + '\n';
        });
        var ids = (chars || []).map(function (c) { return c.id; }).filter(Boolean);
        var wb = loadWorldbookText(ids, chars);
        if (wb) out += '\n【世界书】\n' + wb + '\n';
        out += '\n【强制规则】普通 char 之间绝对不允许互相评论、回复、点赞或接话，即使人设/世界书写了认识也不行。char 可以和用户、作者认识的 NPC 互动；作者可以回复评论区里真正发过言的人，不能回复没在评论区留言的人。\n';
        out += '【外语格式】外国角色的动态文案必须先写母语原文，再换行用括号附中文翻译，例如：do you like me？\n（你爱我吗？）。评论区也要「外语原文（中文翻译）」，例如：do you love me？（爱我吗？）。\n';
        out += '\n【NPC / 朋友圈朋友名单】\n';
        (npcs || []).forEach(function (n) {
            if (!n || !n.name) return;
            out += '◇ ' + n.name + (n.relation ? ('（' + n.relation + '）') : '') + '\n';
            out += ((n.setting && String(n.setting).trim()) ? String(n.setting).trim().slice(0, 400) : '（普通朋友，按语境自然评论）') + '\n';
        });
        return out;
    }


    var DEFAULT_SETTINGS = {
        mainApi: '', mainKey: '', mainModel: '', mainTemperature: 0.7,
        subApi: '', subKey: '', subModel: '', subEnabled: false,
        imageApi: '', imageKey: '', imageModel: '', imageEnabled: false,
        imagePositivePrompt: '', imageNegativePrompt: ''
    };

    var API_DB_NAME = 'nano_api_db';
    var API_DB_VERSION = 2;
    var API_STORE = 'api_data';
    var API_CONFIG_KEY = 'nano_api_config';
    var PROMPTS_KEY = 'nano_api_prompts';

    function idbOpenApi() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open(API_DB_NAME, API_DB_VERSION);
                req.onupgradeneeded = function (e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains(API_STORE)) d.createObjectStore(API_STORE, { keyPath: 'key' });
                        if (!d.objectStoreNames.contains('emoji_data')) d.createObjectStore('emoji_data', { keyPath: 'key' });
                    } catch (e2) {}
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function idbReadKey(storeName, key) {
        return idbOpenApi().then(function (db) {
            if (!db || !db.objectStoreNames.contains(storeName)) return null;
            return new Promise(function (resolve) {
                try {
                    var r = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
                    r.onsuccess = function () {
                        var v = r.result ? r.result.value : null;
                        try { db.close(); } catch (e) {}
                        resolve(v);
                    };
                    r.onerror = function () { try { db.close(); } catch (e) {} resolve(null); };
                } catch (e) { resolve(null); }
            });
        });
    }

    function readJsonLS(key) {
        try { var raw = localStorage.getItem(key); if (raw) return JSON.parse(raw); } catch (e) {}
        return null;
    }

    // 兼容旧的 nano_settings_data（若存在则优先使用其字段）
    function readLegacySettings() {
        var s = readJsonLS(SETTINGS_STORAGE_KEY);
        if (!s || (!s.mainApi && !s.subApi && !s.imageApi)) return null;
        var mainApi = s.mainApi || {};
        var subApi = s.subApi || {};
        var imageApi = s.imageApi || {};
        return {
            mainApi: mainApi.url || '',
            mainKey: mainApi.key || '',
            mainModel: mainApi.model || '',
            mainTemperature: mainApi.temperature || 0.7,
            subApi: (subApi.enabled ? subApi.url : '') || '',
            subKey: (subApi.enabled ? subApi.key : '') || '',
            subModel: subApi.model || mainApi.model || '',
            subEnabled: subApi.enabled || false,
            imageApi: (imageApi.enabled ? imageApi.url : '') || '',
            imageKey: (imageApi.enabled ? imageApi.key : '') || '',
            imageModel: imageApi.model || '',
            imageEnabled: imageApi.enabled || false,
            imagePositivePrompt: imageApi.positivePrompt || '',
            imageNegativePrompt: imageApi.negativePrompt || ''
        };
    }

    async function getSettings() {
        var cfg = null;
        try { cfg = await idbReadKey(API_STORE, API_CONFIG_KEY); } catch (e) {}
        if (!cfg) cfg = readJsonLS('nano_api_config');

        if (cfg && (cfg.mainUrl || cfg.mainKey || cfg.mainModel)) {
            var prompts = null;
            try { prompts = await idbReadKey(API_STORE, PROMPTS_KEY); } catch (e) {}
            if (!prompts) prompts = readJsonLS(PROMPTS_KEY);
            var pos = (prompts && Array.isArray(prompts.positive)) ? prompts.positive.join('，') : '';
            var neg = (prompts && Array.isArray(prompts.negative)) ? prompts.negative.join('，') : '';

            return {
                mainApi: cfg.mainUrl || '',
                mainKey: cfg.mainKey || '',
                mainModel: cfg.mainModel || '',
                mainTemperature: (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : parseFloat(cfg.mainTemp)) || 0.7,
                subApi: cfg.subUrl || '',
                subKey: cfg.subKey || '',
                subModel: cfg.subModel || cfg.mainModel || '',
                subEnabled: !!cfg.subToggle && !!cfg.subUrl,
                imageApi: cfg.imgUrl || '',
                imageKey: cfg.imgKey || '',
                imageModel: cfg.imgModel || '',
                imageEnabled: !!(cfg.imgUrl && cfg.imgKey),
                imagePositivePrompt: pos,
                imageNegativePrompt: neg
            };
        }

        var legacy = readLegacySettings();
        return legacy || Object.assign({}, DEFAULT_SETTINGS);
    }

    var currentUser = getCurrentMask() || { id: 'm_default', name: '我', avatar: '', bindChars: [] };

    // 可发朋友圈的角色：当前 user 绑定的普通角色、NPC、小号都可以出现在生成选择里。
    // 纯 NPC 仍然主要是评论者，但用户手动选中时也可以作为发帖人。
    function isPostableChar(c) {
        return !!(c && c.name && !c.nanoAssistant);
    }

    // 当前 user 可用：绑定当前 user 的普通角色 / NPC / 小号；小号可沿大号归属。
    function belongsToCurrentUser(c, all) {
        if (!c || c.nanoAssistant) return false;
        var uid = String((currentUser && currentUser.id) || '');
        if (!uid) return true;
        if (c.bindUser != null && String(c.bindUser) !== '') return String(c.bindUser) === uid;
        if (c.isAltProbe) {
            if (c.altOriginId) {
                var origin = (all || dbCharsCache || []).find(function (x) { return x && String(x.id) === String(c.altOriginId); });
                if (origin && origin.bindUser != null && String(origin.bindUser) !== '') return String(origin.bindUser) === uid;
            }
            return String(c.altOriginId || '') === uid;
        }
        return true;
    }

    function getUserBindChars() {
        var binds = [];
        var homeData = loadHomeData();
        var contactsData = loadContactsData();
        if (homeData && homeData.masks) {
            var user = homeData.masks.find(function(m) { return m.id === currentUser.id; });
            if (user && user.bindChars && user.bindChars.length > 0) binds = user.bindChars.slice();
        }
        if (binds.length === 0 && contactsData && contactsData.length > 0) {
            for (var i = 0; i < contactsData.length; i++) {
                var c = contactsData[i];
                if (isPostableChar(c) && c.bindUser === currentUser.id) binds.push(c.id);
            }
            if (binds.length > 0 && homeData) {
                var u = homeData.masks.find(function(m) { return m.id === currentUser.id; });
                if (u) { u.bindChars = binds.slice(); localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(homeData)); }
            }
        }
        if (!contactsData || contactsData.length === 0) return (dbCharsBoundList());
        var result = [];
        for (var j = 0; j < contactsData.length; j++) {
            var ch = contactsData[j];
            if (ch && binds.indexOf(ch.id) !== -1 && isPostableChar(ch) && belongsToCurrentUser(ch, contactsData)) result.push(ch);
        }
        // 小号可能没写进 mask.bindChars，但同样属于当前用户，必须出现在选择弹窗里。
        (dbCharsCache || []).forEach(function(c) {
            if (!isPostableChar(c)) return;
            if (!belongsToCurrentUser(c, dbCharsCache)) return;
            if (!result.some(function(x) { return String(x.id || x.name) === String(c.id || c.name); })) result.push(c);
        });
        return result.length ? result : dbCharsBoundList();
    }

    // 从角色库(IndexedDB)中得到“绑定/可用”的真实角色（当前 User 绑定的角色）
    function dbCharsBoundList() {
        if (!dbCharsCache || !dbCharsCache.length) return [];
        var boundOnly = dbCharsCache.filter(function(c) { return isPostableChar(c) && belongsToCurrentUser(c, dbCharsCache); });
        if (boundOnly.length) return boundOnly.slice();
        return [];
    }

    // NPC：优先用角色库 isNpc 的真实 NPC，其次用按面具生成的「关系人物花名册」
    function dbNpcs() {
        return (dbCharsCache || []).filter(function(c) {
            return c && c.name && c.isNpc && !c.isAltProbe && !c.nanoAssistant && !isGenericNpcName(c.name) &&
                belongsToCurrentUser(c, dbCharsCache);
        }).map(function(c) {
            return {
                id: c.id || ('npc_' + c.name),
                name: c.name,
                avatar: c.avatar || '',
                type: 'npc',
                isContext: true,
                isNpc: true,
                setting: c.setting || '',
                gender: c.gender || ''
            };
        });
    }

    function rosterNpcs(scope) {
        var list = loadNpcRoster(scope) || [];
        return list.filter(function(n) { return n && n.name && !isGenericNpcName(n.name) && !isLegacyFallbackNpc(n.name); }).map(function(n) {
            return {
                id: n.id || ('npc_' + n.name),
                name: n.name,
                avatar: n.avatar || '',
                type: 'npc',
                isContext: true,
                isNpc: true,
                relation: n.relation || '',
                setting: n.setting || n.relation || '',
                gender: n.gender || ''
            };
        });
    }

    function generateContextNPCs(scope) {
        var seen = {}, out = [];
        dbNpcs().concat(rosterNpcs(scope)).forEach(function(n) {
            if (!n || !n.name || seen[n.name]) return;
            seen[n.name] = 1;
            out.push(n);
        });
        return out.slice(0, 8);
    }

    // 只取「这条动态的作者可能认识」的人：
    // 作者专属花名册 + 用户库里确实与作者有关系的 NPC/小号；不再把所有角色混在一起用。
    function authorNpcPool(authorObj, isUserAuthor, scope) {
        var seen = {}, out = [];
        function add(n, fromAuthorRoster) {
            if (!n || !n.name) return;
            var k = normName(n.name);
            if (!k || seen[k]) return;
            seen[k] = 1;
            if (fromAuthorRoster) n.__authorRoster = true;
            out.push(n);
        }
        dbNpcs().forEach(function(n) {
            if (isUserAuthor || plausibleForAuthor(n, authorObj, false, false)) add(n, false);
        });
        rosterNpcs(scope).forEach(function(n) { add(n, true); });
        return out;
    }

    // 用户库里「确实与作者有关」的 NPC/小号（不含作者专属花名册），用来判断旧评论者是否还能出现。
    function knownNpcPeople(authorObj, isUserAuthor, bound) {
        var out = [], seen = {};
        function add(n) {
            if (!n || !n.name) return;
            var k = normName(n.name);
            if (!k || seen[k]) return;
            seen[k] = 1;
            var item = Object.assign({}, n, { id: n.id || ('npc_' + k), name: n.name, avatar: n.avatar || '', type: 'npc', isNpc: true, setting: n.setting || '', relation: n.relation || '', gender: n.gender || '' });
            item.__authorRoster = true;
            out.push(item);
        }
        dbNpcs().forEach(function(n) {
            if (isUserAuthor || plausibleForAuthor(n, authorObj, false, false)) add(n);
        });
        (bound || []).forEach(function(n) {
            if (!n || !(n.isNpc || n.isAltProbe)) return;
            if (isUserAuthor || plausibleForAuthor(n, authorObj, false, false)) add(n);
        });
        return out;
    }

    var boundChars = getUserBindChars();
    var contextNPCs = generateContextNPCs();
    var allAvailableChars = boundChars.concat(contextNPCs);

    var settings = Object.assign({}, DEFAULT_SETTINGS);
    var momentsData = [];
    var dbCharsCache = [];
    var pendingImages = [], currentPostLocation = '', currentVisibility = [], currentAtUsers = [], currentDeletingId = null, currentDetailId = null;

    // ===== API 错误弹窗（详细版） =====
    function escapeHtml(s) {
        if (s === undefined || s === null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showApiError(err) {
        var logEl = document.getElementById('apiErrorLog');
        if (!logEl) return;

        if (typeof err === 'string') {
            var t = err;
            var d = arguments[1];
            err = { type: 'unknown', reason: t, detail: d };
        }
        err = err || {};

        var typeLabel = '未知错误';
        var typeClass = '';
        if (err.type === 'text') { typeLabel = '文本 API'; typeClass = 'text'; }
        else if (err.type === 'image') { typeLabel = '生图 API'; typeClass = 'image'; }

        var reason = '';
        var stage = err.stage || '';
        if (stage === 'config') {
            reason = '配置错误：' + (err.reason || 'API 未正确配置');
        } else if (stage === 'network') {
            reason = '网络错误：' + (err.reason || '请求无法发出');
        } else if (stage === 'http') {
            reason = '接口返回错误：HTTP ' + (err.status || '?') + ' ' + (err.statusText || '');
        } else if (stage === 'parse') {
            reason = '响应解析错误：' + (err.reason || '返回内容不是合法 JSON');
        } else if (stage === 'format') {
            reason = '响应格式错误：' + (err.reason || '返回结构不符合预期');
        } else {
            reason = err.reason || err.error || err.message || '未知原因';
        }

        var html = '';

        html += '<div class="api-err-reason">' + escapeHtml(reason) + '</div>';

        html += '<div class="api-err-block">';
        html += '<div class="api-err-label">调用信息</div>';
        html += '<div class="api-err-value">';
        html += '<span class="api-err-badge ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>';
        if (err.apiLabel) html += '<span class="api-err-badge">' + escapeHtml(err.apiLabel) + '</span>';
        if (err.stage) html += '<span class="api-err-badge">阶段: ' + escapeHtml(err.stage) + '</span>';
        html += '</div>';
        html += '</div>';

        if (err.endpoint) {
            html += '<div class="api-err-block">';
            html += '<div class="api-err-label">请求地址</div>';
            html += '<div class="api-err-value mono">' + escapeHtml(err.endpoint) + '</div>';
            html += '</div>';
        }

        if (err.model) {
            html += '<div class="api-err-block">';
            html += '<div class="api-err-label">使用模型</div>';
            html += '<div class="api-err-value">' + escapeHtml(err.model) + '</div>';
            html += '</div>';
        }

        if (err.status) {
            html += '<div class="api-err-block">';
            html += '<div class="api-err-label">HTTP 状态码</div>';
            html += '<div class="api-err-value">' + escapeHtml(err.status) + ' ' + escapeHtml(err.statusText || '') + '</div>';
            html += '</div>';
        }

        if (err.responseBody) {
            html += '<div class="api-err-block">';
            html += '<div class="api-err-label">服务端返回内容</div>';
            html += '<div class="api-err-value mono">' + escapeHtml(String(err.responseBody).slice(0, 2000)) + '</div>';
            html += '</div>';
        }

        if (err.stack) {
            html += '<div class="api-err-block">';
            html += '<div class="api-err-label">错误堆栈</div>';
            html += '<div class="api-err-value mono">' + escapeHtml(String(err.stack).slice(0, 1500)) + '</div>';
            html += '</div>';
        }

        if (err.hint) {
            html += '<div class="api-err-block">';
            html += '<div class="api-err-label">处理建议</div>';
            html += '<div class="api-err-hint">' + escapeHtml(err.hint) + '</div>';
            html += '</div>';
        }

        html += '<div class="api-err-block">';
        html += '<div class="api-err-label">发生时间</div>';
        html += '<div class="api-err-value">' + escapeHtml(new Date().toLocaleString()) + '</div>';
        html += '</div>';

        logEl.innerHTML = html;
        document.getElementById('apiErrorModal').classList.add('show');
    }

    document.getElementById('btnCloseApiError').addEventListener('click', function() {
        document.getElementById('apiErrorModal').classList.remove('show');
    });

    // ===== 工具 =====
    function compressImage(dataUrl, maxSize, cb) {
        var img = new Image();
        img.onload = function() {
            var w = img.width, h = img.height, max = maxSize || 200;
            if (w > h) { if (w > max) { h = Math.round(h * max / w); w = max; } } else { if (h > max) { w = Math.round(w * max / h); h = max; } }
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            try { cb(canvas.toDataURL('image/jpeg', 0.7)); } catch(e) { cb(dataUrl); }
        };
        img.onerror = function() { cb(dataUrl); };
        img.src = dataUrl;
    }

    function getTimeLabel(timeStr) {
        if (!timeStr) return '刚刚';
        var now = new Date();
        var t = new Date(timeStr);
        var diff = Math.floor((now - t) / (1000 * 60 * 60 * 24));
        if (diff === 0) return '今天';
        if (diff === 1) return '昨天';
        if (diff === 2) return '前天';
        if (diff < 7) return diff + '天前';
        return (t.getMonth() + 1) + '月' + t.getDate() + '日';
    }

    function coverKey() { return 'nanoMomentsCover_' + currentMaskId(); }
    // 不再使用内置占位图；未设置封面时返回透明像素
    var TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    var COVER_DB = 'NanoMomentsCoverDB';
    var COVER_STORE = 'covers';
    function openCoverDB(cb) {
        try {
            var req = indexedDB.open(COVER_DB, 1);
            req.onupgradeneeded = function(e) {
                var d = e.target.result;
                if (!d.objectStoreNames.contains(COVER_STORE)) d.createObjectStore(COVER_STORE, { keyPath: 'maskId' });
            };
            req.onsuccess = function() { cb(req.result); };
            req.onerror = function() { cb(null); };
        } catch (e) { cb(null); }
    }
    function coverDbKey() { return currentMaskId() || 'global'; }
    function saveCoverToDB(url) {
        var key = coverDbKey();
        openCoverDB(function(d) {
            if (!d) return;
            try {
                var tx = d.transaction(COVER_STORE, 'readwrite');
                tx.objectStore(COVER_STORE).put({ maskId: key, url: String(url || ''), updatedAt: Date.now() });
                tx.oncomplete = function() { try { d.close(); } catch (e) {} };
            } catch (e) { try { d.close(); } catch (e2) {} }
        });
    }
    function getCoverFromDB(cb) {
        var key = coverDbKey();
        openCoverDB(function(d) {
            if (!d) { cb(''); return; }
            try {
                var tx = d.transaction(COVER_STORE, 'readonly');
                var r = tx.objectStore(COVER_STORE).get(key);
                r.onsuccess = function() { try { d.close(); } catch (e) {} cb(r.result ? String(r.result.url || '') : ''); };
                r.onerror = function() { try { d.close(); } catch (e) {} cb(''); };
            } catch (e) { try { d.close(); } catch (e2) {} cb(''); }
        });
    }
    function getCoverUrl() {
        try {
            // 有 User 面具时只读该面具自己的封面，避免不同 user 之间串图。
            var raw = currentMaskId() ? localStorage.getItem(coverKey()) : localStorage.getItem('nanoMomentsCover');
            if (raw && raw.trim() !== '') return raw.trim();
        } catch(e) {}
        return TRANSPARENT_PX;
    }
    function applyCoverToDom(url) {
        if (!url) return;
        try {
            var a = document.getElementById('coverImg');
            var b = document.getElementById('profileCoverImg');
            if (a) a.src = url;
            if (b) b.src = url;
        } catch (e) {}
    }
    function hydrateCover() {
        // localStorage 可能写满或清空；封面另存一份 IndexedDB，切换面具/重开后异步补回来。
        getCoverFromDB(function(url) {
            if (!url) return;
            try { localStorage.setItem(coverKey(), url); } catch (e) {}
            applyCoverToDom(url);
        });
    }
    function migrateLegacyCover() {
        try {
            var g = localStorage.getItem('nanoMomentsCover');
            if (g && currentMaskId() && !localStorage.getItem(coverKey())) {
                localStorage.setItem(coverKey(), g);
                saveCoverToDB(g);
                localStorage.removeItem('nanoMomentsCover');
            }
        } catch (e) {}
    }
    var profileMaskIsSelf = true;
    function syncProfileCover() {
        try {
            var b = document.getElementById('profileCoverImg');
            // 只有「我」的主页用我的朋友圈封面；看别的 char 主页时不能串用我的封面。
            if (b) b.src = profileMaskIsSelf ? getCoverUrl() : TRANSPARENT_PX;
        } catch (e) {}
        if (profileMaskIsSelf) hydrateCover();
    }
    function saveCover(url) {
        var v = String(url || '').trim();
        if (!v) return;
        try { localStorage.setItem(coverKey(), v); } catch (e) {}
        // 旧版本只有全局键；保留它，方便首次升级时迁移到当前面具。
        try { if (!currentMaskId()) localStorage.setItem('nanoMomentsCover', v); } catch (e) {}
        saveCoverToDB(v);
        applyCoverToDom(v);
    }

    function randomPick(arr) {
        if (!arr || arr.length === 0) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ===== 生图 API（失败抛详细错误） =====
    async function generateImage(promptText, opts) {
        // 每次生图都重新读当前 API 配置，切换模型/Key/地址后立刻生效。
        try { settings = await getSettings(); } catch (e) {}
        var apiUrl = settings.imageApi;
        var apiKey = settings.imageKey;
        var model = settings.imageModel || '';
        var positivePrompt = settings.imagePositivePrompt || '';
        var negativePrompt = settings.imageNegativePrompt || '';
        var persist = async function (u) {
            try {
                if (u && window.NanoImageCache && /^https?:\/\//i.test(u)) {
                    var d = await NanoImageCache.toDataUrl(u);
                    if (d) return d;
                }
            } catch (e) {}
            return u;
        };

        if (!settings.imageEnabled) {
            throw {
                type: 'image', stage: 'config',
                reason: '生图 API 未启用',
                hint: '请进入设置页面，找到「生图 API」并打开启用开关。',
                model: model
            };
        }
        if (!apiUrl || apiUrl.trim() === '') {
            throw {
                type: 'image', stage: 'config',
                reason: '生图 API 地址为空',
                hint: '请在设置中填写生图 API 的完整 URL，例如 https://api.openai.com/v1/images/generations',
                model: model
            };
        }
        if (apiUrl.indexOf('http://') !== 0 && apiUrl.indexOf('https://') !== 0) {
            throw {
                type: 'image', stage: 'config',
                reason: '生图 API 地址格式不正确：' + apiUrl,
                hint: '地址必须以 http:// 或 https:// 开头。',
                endpoint: apiUrl, model: model
            };
        }
        if (!apiKey || apiKey.trim() === '') {
            throw {
                type: 'image', stage: 'config',
                reason: '生图 API Key 为空',
                hint: '请在设置中填写生图 API 的密钥。',
                endpoint: apiUrl, model: model
            };
        }

        // ===== 锁脸参考 + 人种护栏（角色在「聊天设置」里设了锁脸就走图生图） =====
        var faceRef = '';
        var subject = '';
        try {
            if (opts && opts.charId) {
                if (window.NanoFaceRef && NanoFaceRef.get) faceRef = await NanoFaceRef.get(opts.charId);
                else faceRef = charChatSetting(opts.charId, 'faceRef', '') || '';
            }
            var ch = opts && opts.char;
            if (ch) {
                var bits = [];
                var nat = String(ch.nationality || '').trim();
                var sex = String(ch.gender || '').trim();
                if (nat && nat !== '未知' && nat !== '未设定') bits.push('国籍/人种：' + nat);
                if (sex && sex !== '未知') bits.push('性别：' + sex);
                if (bits.length) subject = '画面主角是「' + (ch.name || '角色') + '」（' + bits.join('，') + '）。必须严格按此国籍/人种与性别特征绘制，禁止画成其他国籍或西方人。';
            }
        } catch (e) {}

        var trimmedUrl = String(apiUrl).replace(/\/+$/, '');
        var baseUrl = trimmedUrl;
        var genEndpoint = apiUrl;
        if (/\/images\/generations$/i.test(trimmedUrl)) {
            baseUrl = trimmedUrl.replace(/\/images\/generations$/i, '');
        } else if (/\/v\d+$/i.test(trimmedUrl)) {
            baseUrl = trimmedUrl;
            genEndpoint = trimmedUrl + '/images/generations';
        }
        var editsEndpoint = baseUrl + '/images/edits';

        // 有锁脸参考优先走图生图 /images/edits（multipart），失败再退回文生图
        if (faceRef && faceRef.indexOf('data:') === 0) {
            try {
                var fc = faceRef.indexOf(',');
                var fbin = atob(faceRef.slice(fc + 1));
                var fu8 = new Uint8Array(fbin.length);
                for (var fi = 0; fi < fbin.length; fi++) fu8[fi] = fbin.charCodeAt(fi);
                var fmime = (faceRef.slice(5, fc).split(';')[0]) || 'image/png';
                var ffd = new FormData();
                ffd.append('model', model);
                ffd.append('prompt', ([positivePrompt, promptText, subject, negativePrompt ? ('避免：' + negativePrompt) : ''].filter(Boolean)).join('，'));
                ffd.append('n', '1');
                ffd.append('size', '1024x1024');
                ffd.append('image', new Blob([fu8], { type: fmime }), 'face.png');
                var fedits = await fetch(editsEndpoint, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + apiKey },
                    body: ffd
                });
                if (fedits.ok) {
                    var fdata = await fedits.json();
                    var fit = fdata && fdata.data && fdata.data[0];
                    if (fit && fit.url) return await persist(fit.url);
                    if (fit && fit.b64_json) return 'data:image/png;base64,' + fit.b64_json;
                }
            } catch (fe) { console.warn('[朋友圈生图] 锁脸图生图失败，改用普通生图:', fe && fe.message); }
        }

        var fullPrompt = promptText;
        if (positivePrompt) fullPrompt = positivePrompt + '，' + fullPrompt;
        if (subject) fullPrompt = subject + '，' + fullPrompt;
        if (negativePrompt) fullPrompt = fullPrompt + '，避免：' + negativePrompt;

        var genBody = { model: model, prompt: fullPrompt, n: 1, size: '1024x1024' };
        if (faceRef) { genBody.image = faceRef; genBody.reference_image = [faceRef]; genBody.input_reference_image = [faceRef]; }

        var res;
        try {
            res = await fetch(genEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                body: JSON.stringify(genBody)
            });
        } catch (e) {
            throw {
                type: 'image', stage: 'network',
                endpoint: apiUrl, model: model,
                reason: '请求无法发出：' + (e.message || '未知网络错误'),
                stack: e.stack,
                hint: '可能原因：① 网络断开 ② API 地址不可访问 ③ 被浏览器 CORS 拦截 ④ 目标服务器未启动。请检查网络连接，或在浏览器控制台查看 CORS 报错。'
            };
        }

        if (!res.ok) {
            var errBody = '';
            try { errBody = await res.text(); } catch (e) { errBody = '(无法读取响应内容)'; }
            var hint = '常见原因：';
            if (res.status === 401) hint = 'API Key 无效或已过期，请重新填写。';
            else if (res.status === 403) hint = 'API Key 没有生图权限，或该模型未对当前账户开放。';
            else if (res.status === 404) hint = 'API 地址或模型名不存在，请检查 URL 是否为图像生成端点、模型名是否正确。';
            else if (res.status === 429) hint = '请求过于频繁或账户额度不足，请稍后再试或充值。';
            else if (res.status >= 500) hint = '服务端错误，可能是模型服务商暂时不可用，请稍后重试。';
            else hint = '请检查 API 地址、Key、模型名和请求格式是否与服务商要求一致。';
            throw {
                type: 'image', stage: 'http',
                endpoint: apiUrl, model: model,
                status: res.status, statusText: res.statusText,
                responseBody: errBody,
                reason: 'HTTP ' + res.status + ' ' + res.statusText,
                hint: hint
            };
        }

        var data;
        try {
            data = await res.json();
        } catch (e) {
            var raw = '';
            try { raw = await res.text(); } catch (e2) {}
            throw {
                type: 'image', stage: 'parse',
                endpoint: apiUrl, model: model,
                status: res.status,
                responseBody: raw || '(空响应)',
                reason: '响应不是合法 JSON：' + (e.message || ''),
                hint: '接口返回的不是 JSON 格式。可能是代理/网关返回了 HTML 错误页，或该接口不是图像生成接口。'
            };
        }

        if (data && data.error) {
            throw {
                type: 'image', stage: 'format',
                endpoint: apiUrl, model: model,
                status: res.status,
                responseBody: JSON.stringify(data).slice(0, 2000),
                reason: '服务端返回错误：' + (data.error.message || data.error.code || JSON.stringify(data.error)),
                hint: '服务端明确返回了 error 字段，请根据上面内容排查（可能是 prompt 被拒、模型不存在、参数不合法等）。'
            };
        }
        if (data && data.data && data.data[0] && data.data[0].url) return await persist(data.data[0].url);
        if (data && data.images && data.images[0]) return await persist(data.images[0]);

        throw {
            type: 'image', stage: 'format',
            endpoint: apiUrl, model: model,
            status: res.status,
            responseBody: JSON.stringify(data).slice(0, 2000),
            reason: '响应中未找到图片 URL（期望 data[0].url 或 images[0]）',
            hint: '接口返回结构不符合预期。请确认使用的是 OpenAI 兼容的图像生成接口，返回格式应为 { data: [{ url: "..." }] }。'
        };
    }

    // ===== 主 API 调用（opts.apiPref: main 用主 API；sub/auto 优先副 API，未配置则主 API） =====
    async function fetchAIResponse(promptText, isContext, opts) {
        // 每次请求都重新读当前 API 配置，保证跟随 API 页/悬浮球的实时切换。
        try { settings = await getSettings(); } catch (e) {}
        opts = opts || {};
        var apiUrl, apiKey, model, apiLabel;
        var subReady = settings.subEnabled && settings.subApi && settings.subApi.indexOf('http') === 0;
        var useSub = subReady && opts.apiPref !== 'main';
        if (useSub) {
            apiUrl = settings.subApi;
            apiKey = settings.subKey;
            model = settings.subModel || settings.mainModel || '';
            apiLabel = '副 API';
        } else {
            apiUrl = settings.mainApi;
            apiKey = settings.mainKey;
            model = settings.mainModel || '';
            apiLabel = '主 API';
        }

        if (!apiUrl || apiUrl.trim() === '') {
            throw {
                type: 'text', stage: 'config',
                apiLabel: apiLabel, model: model,
                reason: apiLabel + '地址为空',
                hint: '请进入设置页面，填写' + apiLabel + '的完整 URL。' + (apiLabel === '主 API' ? '（若已启用副 API，请确认副 API 地址是否正确）' : '')
            };
        }
        if (apiUrl.indexOf('http://') !== 0 && apiUrl.indexOf('https://') !== 0) {
            throw {
                type: 'text', stage: 'config',
                apiLabel: apiLabel, endpoint: apiUrl, model: model,
                reason: apiLabel + '地址格式不正确：' + apiUrl,
                hint: '地址必须以 http:// 或 https:// 开头。'
            };
        }
        if (!apiKey || apiKey.trim() === '') {
            throw {
                type: 'text', stage: 'config',
                apiLabel: apiLabel, endpoint: apiUrl, model: model,
                reason: apiLabel + ' Key 为空',
                hint: '请在设置中填写' + apiLabel + '的密钥。'
            };
        }

        var endpoint = apiUrl.trim().replace(/\/+$/, '');
        if (!endpoint.includes('/chat/completions')) {
            if (endpoint.endsWith('/v1')) endpoint = endpoint + '/chat/completions';
            else endpoint = endpoint + '/v1/chat/completions';
        }

        var systemContent = opts.system || (isContext
            ? '你是一个真实的人类，正在刷朋友圈。像随手发动态一样：口语、生活化、松弛不端着。写具体的日常/情绪/吐槽/小事，大多数写 3~6 句、约 80~220 字，把一件事或一个情绪讲完整、带具体细节和有意思的表达，不要每次都只说一句话；偶尔可以很短（半句、一个词、一个 emoji），每 8 条左右要有 1~2 条 300~600 字的长文——追星/演唱会 repo、好物分享、情感经历、求助/避雷、深夜碎碎念等，要有具体细节、真实情绪和口语感，不要 AI 腔、营销号腔。长度完全跟着角色当下的情绪、事情大小和人设走，不要每条都固定长度。不要写成汇报、硬广、旅行博主腔或正能量总结。广告只能是隐晦暗广。不要加引号，不要解释，直接输出文案内容。'
            : '你是一个真实的人类，正在朋友圈评论区互动。像熟人随手打字：可以只回一句、一个表情、损一句或问一句，不要客服腔、不要总结、不要小作文。不超过20个字。不要加引号，不要解释，直接输出评论内容。');
        try {
            if (window.NanoPrompts && NanoPrompts.appendTo) systemContent = NanoPrompts.appendTo(systemContent, 'moments', { keepFormat: true });
        } catch (e) {}

        var res;
        try {
            res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemContent },
                        { role: 'user', content: promptText }
                    ],
                    temperature: (typeof opts.temperature === 'number') ? opts.temperature : (settings.mainTemperature || 0.8),
                    max_tokens: opts.maxTokens || 100
                })
            });
        } catch (e) {
            throw {
                type: 'text', stage: 'network',
                apiLabel: apiLabel, endpoint: endpoint, model: model,
                reason: '请求无法发出：' + (e.message || '未知网络错误'),
                stack: e.stack,
                hint: '可能原因：① 网络断开 ② API 地址不可访问 ③ 被浏览器 CORS 拦截 ④ 目标服务器未启动。请检查网络连接，或在浏览器控制台查看 CORS 报错。'
            };
        }

        if (!res.ok) {
            var errBody = '';
            try { errBody = await res.text(); } catch (e) { errBody = '(无法读取响应内容)'; }
            var hint = '常见原因：';
            if (res.status === 401) hint = 'API Key 无效或已过期，请重新填写。';
            else if (res.status === 403) hint = 'API Key 没有该模型权限，或账户被限制。';
            else if (res.status === 404) hint = 'API 地址或模型名不存在，请检查 URL 是否正确、模型名是否拼写正确。';
            else if (res.status === 429) hint = '请求过于频繁或额度不足，请稍后再试或充值。';
            else if (res.status >= 500) hint = '服务端错误，可能是模型服务商暂时不可用，请稍后重试。';
            else hint = '请检查 API 地址、Key、模型名和请求格式是否与服务商要求一致。';
            throw {
                type: 'text', stage: 'http',
                apiLabel: apiLabel, endpoint: endpoint, model: model,
                status: res.status, statusText: res.statusText,
                responseBody: errBody,
                reason: 'HTTP ' + res.status + ' ' + res.statusText,
                hint: hint
            };
        }

        var data;
        try {
            data = await res.json();
        } catch (e) {
            var raw = '';
            try { raw = await res.text(); } catch (e2) {}
            throw {
                type: 'text', stage: 'parse',
                apiLabel: apiLabel, endpoint: endpoint, model: model,
                status: res.status,
                responseBody: raw || '(空响应)',
                reason: '响应不是合法 JSON：' + (e.message || ''),
                hint: '接口返回的不是 JSON 格式。可能是代理/网关返回了 HTML 错误页。'
            };
        }

        if (data && data.error) {
            throw {
                type: 'text', stage: 'format',
                apiLabel: apiLabel, endpoint: endpoint, model: model,
                status: res.status,
                responseBody: JSON.stringify(data).slice(0, 2000),
                reason: '服务端返回错误：' + (data.error.message || data.error.code || JSON.stringify(data.error)),
                hint: '服务端明确返回了 error 字段，请根据上面内容排查。'
            };
        }
        if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
            return data.choices[0].message.content.trim();
        }

        throw {
            type: 'text', stage: 'format',
            apiLabel: apiLabel, endpoint: endpoint, model: model,
            status: res.status,
            responseBody: JSON.stringify(data).slice(0, 2000),
            reason: '响应中未找到 choices[0].message.content',
            hint: '接口返回结构不符合预期。请确认使用的是 OpenAI 兼容的 Chat Completions 接口，返回格式应为 { choices: [{ message: { content: "..." } }] }。'
        };
    }

    // ===== 长按删除 =====
    var longPressTimer = null;
    var isLongPress = false;
    var pendingDeleteComment = null;

    function setupLongPress(ciDiv, itemId, ci) {
        var startX = 0, startY = 0, moved = false;
        function onStart(e) {
            isLongPress = false;
            moved = false;
            var t = (e.touches && e.touches[0]) || e;
            startX = t.clientX || 0;
            startY = t.clientY || 0;
            longPressTimer = setTimeout(function() {
                isLongPress = true;
                pendingDeleteComment = { id: itemId, ci: ci };
                document.getElementById('deleteCommentModal').classList.add('show');
            }, 600);
        }
        function onMove(e) {
            // 只要手指/鼠标移动超过阈值，就当成滑动/滚动，取消长按并且不触发回复
            clearTimeout(longPressTimer);
            var t = (e.touches && e.touches[0]) || e;
            var dx = (t.clientX || 0) - startX;
            var dy = (t.clientY || 0) - startY;
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
        }
        function onEnd(e) {
            clearTimeout(longPressTimer);
            if (moved || isLongPress) return; // 滑动/滚动不触发回复弹窗
            var item = momentsData.find(function(m) { return m.id === itemId; });
            if (item && item.comments && item.comments[ci]) {
                promptReply(itemId, item.comments[ci].user);
            }
        }
        function onCancel() { clearTimeout(longPressTimer); moved = true; }
        ciDiv.addEventListener('mousedown', onStart);
        ciDiv.addEventListener('mouseup', onEnd);
        ciDiv.addEventListener('mouseleave', onCancel);
        ciDiv.addEventListener('touchstart', onStart, { passive: true });
        ciDiv.addEventListener('touchend', onEnd, { passive: true });
        ciDiv.addEventListener('touchmove', onMove, { passive: true });
        ciDiv.addEventListener('touchcancel', onCancel, { passive: true });
    }

    // ===== 渲染 =====
    function renderFeed() {
        var container = document.getElementById('feedList');
        container.innerHTML = '';
        if (momentsData.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px 0;color:#b2b2b2;font-size:14px;">暂无朋友圈</div>';
            return;
        }
        momentsData.forEach(function(item) {
            var el = document.createElement('div');
            el.className = 'feed-item';
            el.dataset.id = item.id;

            var avatar = document.createElement('img');
            avatar.className = 'feed-avatar';
            avatar.src = itemAvatarSrc(item);
            avatar.onclick = function() { openProfile(item.author, itemAvatarSrc(item)); };
            el.appendChild(avatar);

            var contentBox = document.createElement('div');
            contentBox.className = 'feed-content-box';

            var author = document.createElement('div');
            author.className = 'feed-author';
            author.textContent = item.author || '未知';
            author.onclick = function() { openProfile(item.author, itemAvatarSrc(item)); };
            contentBox.appendChild(author);

            if (item.text) {
                var text = document.createElement('div');
                text.className = 'feed-text';
                text.textContent = formatMomentText(item.text);
                text.onclick = function() { openDetail(item.id); };
                contentBox.appendChild(text);
            }

            if (item.images && item.images.length > 0) {
                var len = item.images.length;
                var gridClass = 'grid-3';
                if (len === 1) gridClass = 'grid-1';
                else if (len === 2) gridClass = 'grid-2';
                else if (len === 4) gridClass = 'grid-4';
                var grid = document.createElement('div');
                grid.className = 'grid-photos ' + gridClass;
                item.images.forEach(function(img, ii) {
                    var imgEl = document.createElement('img');
                    imgEl.src = img;
                    imgEl.onclick = function(e) { e.stopPropagation(); openImageViewer(item.id, ii); };
                    grid.appendChild(imgEl);
                });
                contentBox.appendChild(grid);
            } else if (item.imageText) {
                var tpEl = document.createElement('div');
                tpEl.className = 'mm-text-photo';
                tpEl.textContent = item.imageText;
                tpEl.onclick = function(e) { e.stopPropagation(); openImageViewer(item.id, 0); };
                contentBox.appendChild(tpEl);
            }

            var meta = document.createElement('div');
            meta.className = 'feed-meta';
            var timeLoc = document.createElement('span');
            timeLoc.className = 'feed-time-location';
            var timeText = getTimeLabel(item.time) || '刚刚';
            if (item.location) timeText += ' · ' + item.location;
            timeLoc.textContent = timeText;
            meta.appendChild(timeLoc);

            var actionWrapper = document.createElement('div');
            actionWrapper.style.position = 'relative';
            var moreBtn = document.createElement('button');
            moreBtn.className = 'more-action-btn';
            moreBtn.innerHTML = '··';
            moreBtn.onclick = function(e) { e.stopPropagation(); togglePopover(item.id); };
            actionWrapper.appendChild(moreBtn);

            var popover = document.createElement('div');
            popover.className = 'action-popover';
            popover.id = 'popover-' + item.id;
            popover.innerHTML =
                '<button class="pop-item" data-action="like" data-id="' + item.id + '"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>赞</button>' +
                '<button class="pop-item" data-action="comment" data-id="' + item.id + '"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>评论</button>' +
                '<button class="pop-item" data-action="refresh" data-id="' + item.id + '"><svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>刷新</button>';
            actionWrapper.appendChild(popover);
            meta.appendChild(actionWrapper);
            contentBox.appendChild(meta);

            if ((item.likes && item.likes.length > 0) || (item.comments && item.comments.length > 0)) {
                var ib = document.createElement('div');
                ib.className = 'interaction-box';
                if (item.likes && item.likes.length > 0) {
                    var ll = document.createElement('div');
                    ll.className = 'likes-line';
                    ll.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ' + item.likes.join('，');
                    ib.appendChild(ll);
                }
                if (item.comments && item.comments.length > 0) {
                    var ca = document.createElement('div');
                    ca.className = 'comments-area';
                    var cl = document.createElement('div');
                    cl.className = 'comments-list';
                    item.comments.forEach(function(c, ci) {
                        var ciDiv = document.createElement('div');
                        ciDiv.className = 'comment-item';
                        var left = document.createElement('span');
                        var userSpan = document.createElement('span');
                        userSpan.className = 'comment-user';
                        userSpan.textContent = c.user;
                        left.appendChild(userSpan);
                        if (c.toUser) {
                            var replySpan = document.createElement('span');
                            replySpan.textContent = ' 回复 ';
                            left.appendChild(replySpan);
                            var toUserSpan = document.createElement('span');
                            toUserSpan.className = 'comment-user';
                            toUserSpan.textContent = c.toUser;
                            left.appendChild(toUserSpan);
                            left.appendChild(document.createTextNode('：' + formatMomentInline(c.text)));
                        } else {
                            left.appendChild(document.createTextNode('：' + formatMomentInline(c.text)));
                        }
                        ciDiv.appendChild(left);
                        if (c.user === currentUser.name) {
                            var delBtn = document.createElement('span');
                            delBtn.className = 'comment-del';
                            delBtn.textContent = '×';
                            delBtn.onclick = function(e) { e.stopPropagation(); deleteComment(item.id, ci); };
                            ciDiv.appendChild(delBtn);
                        }
                        setupLongPress(ciDiv, item.id, ci);
                        cl.appendChild(ciDiv);
                    });
                    ca.appendChild(cl);
                    ib.appendChild(ca);
                }
                contentBox.appendChild(ib);
            }

            el.appendChild(contentBox);
            container.appendChild(el);
        });

        document.querySelectorAll('.pop-item').forEach(function(btn) {
            btn.onclick = function(e) {
                e.stopPropagation();
                var id = this.dataset.id, action = this.dataset.action;
                if (action === 'like') handleLike(id);
                else if (action === 'comment') promptComment(id);
                else if (action === 'refresh') triggerPostRefresh(id);
                document.querySelectorAll('.action-popover').forEach(function(p) { p.classList.remove('show'); });
            };
        });
    }

    // ===== 交互 =====
    function togglePopover(id) {
        document.querySelectorAll('.action-popover').forEach(function(el) { if (el.id !== 'popover-' + id) el.classList.remove('show'); });
        var pop = document.getElementById('popover-' + id);
        if (pop) pop.classList.toggle('show');
    }

    function handleLike(id) {
        var item = momentsData.find(function(m) { return m.id === id; });
        if (!item) return;
        var idx = item.likes.indexOf(currentUser.name);
        if (idx > -1) item.likes.splice(idx, 1);
        else item.likes.push(currentUser.name);
        saveOneMoment(item);
        renderFeed();
        if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId === id) openDetail(id);
    }

    // ===== 评论/回复弹窗 =====
    var commentModalContext = null;

    function openCommentModal(id, toUser) {
        commentModalContext = { id: id, toUser: toUser || null };
        var titleEl = document.getElementById('commentModalTitle');
        var inputEl = document.getElementById('commentModalInput');
        titleEl.textContent = toUser ? ('回复 ' + toUser) : '评论';
        inputEl.value = '';
        inputEl.placeholder = toUser ? ('回复 ' + toUser + '...') : '友善评论，说点什么...';
        document.getElementById('commentModal').classList.add('show');
        setTimeout(function() { inputEl.focus(); }, 150);
    }

    function submitCommentModal() {
        if (!commentModalContext) return;
        var text = document.getElementById('commentModalInput').value.trim();
        document.getElementById('commentModal').classList.remove('show');
        if (!text) { commentModalContext = null; return; }
        var id = commentModalContext.id, toUser = commentModalContext.toUser;
        var item = momentsData.find(function(m) { return m.id === id; });
        if (item) {
            var c = { user: currentUser.name, text: text, fromUser: true };
            if (toUser) c.toUser = toUser;
            item.comments.push(c);
            saveOneMoment(item);
            renderFeed();
            if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId === id) openDetail(id);
            // 只保存用户评论，不主动调用 API；等用户点击评论区的「刷新」再生成互动。
        }
        commentModalContext = null;
    }

    document.getElementById('btnConfirmComment').addEventListener('click', submitCommentModal);
    document.getElementById('btnCancelComment').addEventListener('click', function() {
        commentModalContext = null;
        document.getElementById('commentModal').classList.remove('show');
    });
    document.getElementById('commentModalInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitCommentModal();
    });

    document.getElementById('btnConfirmDeleteComment').addEventListener('click', function() {
        if (pendingDeleteComment) {
            deleteComment(pendingDeleteComment.id, pendingDeleteComment.ci);
            pendingDeleteComment = null;
        }
        document.getElementById('deleteCommentModal').classList.remove('show');
    });
    document.getElementById('btnCancelDeleteComment').addEventListener('click', function() {
        pendingDeleteComment = null;
        document.getElementById('deleteCommentModal').classList.remove('show');
    });

    function promptComment(id) { openCommentModal(id, null); }

    function promptReply(id, targetUser) {
        if (targetUser === currentUser.name) return;
        openCommentModal(id, targetUser);
    }

    function deleteComment(id, ci) {
        var item = momentsData.find(function(m) { return m.id === id; });
        if (item && item.comments && item.comments[ci]) {
            item.comments.splice(ci, 1);
            saveOneMoment(item);
            renderFeed();
            if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId === id) openDetail(id);
        }
    }

    // ===== 解析：评论行「评论者|回复对象|内容」/「评论者|内容」/「评论者：内容」 =====
    function parseCommentLines(text) {
        var out = [];
        String(text || '').replace(/```[a-zA-Z]*/g, '').split(/\n+/).forEach(function (line) {
            line = line.replace(/^[\s\-\*\d.、）)]+/, '').trim();
            if (!line) return;
            var name = '', toUser = '', content = '';
            var pipes = line.split(/[|｜]/);
            if (pipes.length >= 2) {
                name = pipes[0].trim();
                if (pipes.length >= 3) { toUser = pipes[1].trim(); content = pipes.slice(2).join('|').trim(); }
                else { content = pipes.slice(1).join('|').trim(); }
            } else {
                var mr = line.match(/^([^：:]{1,20})\s*(?:回复|@)\s*([^：:]{1,20})\s*[：:]\s*([\s\S]+)$/);
                if (mr) { name = mr[1].trim(); toUser = mr[2].trim(); content = mr[3].trim(); }
                else {
                    var mm = line.match(/^([^：:]{1,20})\s*[：:]\s*([\s\S]+)$/);
                    if (mm) { name = mm[1].trim(); content = mm[2].trim(); }
                    else {
                        var m2 = line.match(/^(.{1,20}?)\s*[-—–]\s*([\s\S]+)$/);
                        if (!m2) return;
                        name = m2[1].trim(); content = m2[2].trim();
                    }
                }
            }
            content = content.replace(/^["“”']+|["“”']+$/g, '').trim();
            if (name && content) {
                var o = { user: name, text: content };
                if (toUser && toUser !== name) o.toUser = toUser;
                out.push(o);
            }
        });
        return out;
    }

    // ===== 解析：多条动态（===MOMENT=== 分段） =====
    function parseMomentBlocks(text) {
        var blocks = String(text || '').replace(/```[a-zA-Z]*/g, '').split(/===+\s*MOMENT\s*===+/i).map(function (s) { return s.trim(); }).filter(Boolean);
        var out = [];
        blocks.forEach(function (b) {
            var post = { author: '', text: '', location: '', likes: [], comments: [], media: '', image: '' };
            var lastKey = '';
            b.split(/\n/).forEach(function (line) {
                line = line.trim();
                if (!line) return;
                var m = line.match(/^(AUTHOR|TEXT|LOCATION|LIKES|COMMENT|MEDIA|IMAGE|作者|文案|地点|点赞|评论|图片|配图|类型)\s*[:：]\s*([\s\S]*)$/i);
                if (!m) {
                    // 外国角色文案是「外文原文」换行「（中文翻译）」，翻译行要接在 TEXT 后面，不能丢。
                    var looksComment = /[|｜]/.test(line) || /(?:回复|@)/.test(line) || /^(?:COMMENT|评论)\s*[:：]?/i.test(line) || /^[^：:|｜]{1,20}\s*[：:]/.test(line);
                    if (lastKey === 'TEXT' && !looksComment) {
                        post.text += (post.text ? '\n' : '') + line;
                        return;
                    }
                    var rawLine = line.replace(/^(?:COMMENT|评论)\s*[:：]?\s*/i, '');
                    var c2 = rawLine.match(/^([^：:|｜]{1,20})\s*(?:回复|@)\s*([^：:|｜]{1,20})\s*[：:]\s*([\s\S]+)$/);
                    if (c2) post.comments.push({ user: c2[1].trim(), toUser: c2[2].trim(), text: c2[3].trim() });
                    else {
                        var cPipe = rawLine.split(/[|｜]/);
                        if (cPipe.length >= 3) post.comments.push({ user: cPipe[0].trim(), toUser: cPipe[1].trim(), text: cPipe.slice(2).join('|').trim() });
                        else if (cPipe.length === 2) post.comments.push({ user: cPipe[0].trim(), text: cPipe[1].trim() });
                    }
                    return;
                }
                var rawKey = m[1], key = m[1].toUpperCase(), val = m[2].trim();
                lastKey = key;
                if (key === 'AUTHOR' || rawKey === '作者') post.author = val;
                else if (key === 'TEXT' || rawKey === '文案') post.text = val;
                else if (key === 'LOCATION' || rawKey === '地点') post.location = val;
                else if (key === 'MEDIA' || rawKey === '类型') post.media = /image|photo|图|照片|图片|配图/i.test(val) ? 'image' : 'text';
                else if (key === 'IMAGE' || rawKey === '图片' || rawKey === '配图') { post.image = val; if (val) post.media = 'image'; }
                else if (key === 'LIKES' || rawKey === '点赞') post.likes = val.split(/[,，、;；\/]/).map(function (s) { return s.trim(); }).filter(Boolean);
                else if (key === 'COMMENT' || rawKey === '评论') {
                    var ci = val.split(/[|｜]/);
                    if (ci.length >= 3) {
                        post.comments.push({ user: ci[0].trim(), toUser: ci[1].trim(), text: ci.slice(2).join('|').trim() });
                    } else if (ci.length === 2) {
                        post.comments.push({ user: ci[0].trim(), text: ci[1].trim() });
                    } else {
                        var c3 = val.match(/^([^：:|｜]{1,20})\s*(?:回复|@)\s*([^：:|｜]{1,20})\s*[：:]\s*([\s\S]+)$/);
                        if (c3) post.comments.push({ user: c3[1].trim(), toUser: c3[2].trim(), text: c3[3].trim() });
                        else {
                            var c4 = val.match(/^([^：:|｜]{1,20})\s*[：:]\s*([\s\S]+)$/);
                            if (c4) post.comments.push({ user: c4[1].trim(), text: c4[2].trim() });
                        }
                    }
                }
            });
            if (post.author && (post.text || post.image)) out.push(post);
        });
        return out;
    }

    function findCharByName(allChars, name) {
        if (!name) return null;
        var key = normName(name);
        for (var i = 0; i < allChars.length; i++) {
            var c = allChars[i];
            if (c && c.name && normName(c.name) === key) return c;
        }
        return null;
    }

    function findNpcByName(npcs, name) {
        if (!name) return null;
        var key = normName(name);
        for (var i = 0; i < (npcs || []).length; i++) {
            var c = npcs[i];
            if (c && c.name && normName(c.name) === key) return c;
        }
        return null;
    }

    // 评论展示/上下文行：A 回复 B：内容
    function fmtCommentLine(c) {
        if (!c) return '';
        return c.toUser ? (c.user + ' 回复 ' + c.toUser + '：' + c.text) : (c.user + '：' + c.text);
    }

    // 兼容旧数据/主动消息的「外文||中文」格式，统一显示成用户要求的样子。
    function formatMomentText(text) {
        var s = String(text == null ? '' : text);
        if (s.indexOf('||') > -1 && !/[（(]/.test(s)) {
            var parts = s.split(/\s*\|\|\s*/);
            if (parts.length >= 2) return parts[0].trim() + '\n（' + parts.slice(1).join('；').trim() + '）';
        }
        return s;
    }
    function formatMomentInline(text) {
        var s = String(text == null ? '' : text);
        if (s.indexOf('||') > -1 && !/[（(]/.test(s)) {
            var parts = s.split(/\s*\|\|\s*/);
            if (parts.length >= 2) return parts[0].trim() + '（' + parts.slice(1).join('；').trim() + '）';
        }
        return s;
    }

    // 从模型输出里解析点赞名单（只保留名单内的人）
    function parseLikesFromText(raw, allowedNames) {
        var m = String(raw || '').match(/^\s*(?:LIKES|点赞)\s*[:：]\s*(.+)$/im);
        if (!m) return [];
        var names = (allowedNames || []).map(function(n) { return (n && n.name) || n; }).filter(Boolean);
        var seen = {};
        return m[1].split(/[,，、;；\/]/).map(function(s) {
            var n = String(s == null ? '' : s).trim();
            if (!n) return '';
            if (normName(n) === normName(currentUser.name)) return '';
            var hit = names.find(function(a) { return normName(a) === normName(n); });
            if (!hit) return '';
            var k = normName(hit);
            if (seen[k]) return '';
            seen[k] = 1;
            return hit;
        }).filter(Boolean);
    }

    function normName(s) {
        return String(s == null ? '' : s)
            .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
            .replace(/[\s~～!！?？.。·、,，]/g, '');
    }

    // 作者人设/世界书里是否明确提到某个角色（用于判断两人是否认识）
    function nameMentionedIn(ch, name) {
        if (!ch || !name) return false;
        var st = String(ch.setting || '') + ' ' + String(ch.desc || '') + ' ' + String(ch.worldbook || '');
        return st.indexOf(name) !== -1;
    }

    // NPC 的人设/关系里是否提到某个 char
    function npcMentionsChar(npc, charName) {
        if (!npc || !charName) return false;
        var st = String(npc.relation || '') + ' ' + String(npc.setting || '') + ' ' + String(npc.desc || '');
        return st.indexOf(charName) !== -1;
    }

    // 两个人物是否可能在现实中认识：显式关系/悄悄话优先，其次人设/世界书里提到名字。
    function personKnowsPerson(a, b) {
        if (!a || !b) return false;
        if (a.name && b.name && normName(a.name) === normName(b.name)) return true;
        try {
            if (window.NanoSocialGraph && NanoSocialGraph.knows && NanoSocialGraph.knows(a, b)) return true;
        } catch (e) {}
        if (a.name && nameMentionedIn(b, a.name)) return true;
        if (b.name && nameMentionedIn(a, b.name)) return true;
        if (a.name && npcMentionsChar(b, a.name)) return true;
        if (b.name && npcMentionsChar(a, b.name)) return true;
        return false;
    }

    // 评论者/点赞者能否出现在某条动态下：
    // - 用户本人发的动态：当前 user 的熟人都算认识；
    // - 角色发的动态：只允许确实可能认识作者的人（NPC/小号也不能跨角色乱入）；
    // - 作者专属花名册里的人默认认识作者。
    function plausibleForAuthor(person, author, isUserPost, fromAuthorRoster) {
        if (!person || !author) return false;
        if (normName(person.name) === normName(author.name)) return true;
        if (isUserPost) return true;
        if (fromAuthorRoster) return true;
        return personKnowsPerson(person, author);
    }

    // 清理历史数据里已经生成的 char↔char 互动。规则是绝对的：
    // 1) char 发的动态下，其他 char 的评论/回复/点赞全部删除；
    // 2) 用户动态下允许 char 评论用户，但 char 回复 char 一律删除；
    // 3) char 作者可以回复评论区里真正发过言的人（用户/NPC），但不能与其他普通 char 互动。
    function sanitizeCharInteractions() {
        var allBound = getUserBindChars().filter(function (c) { return c && c.name; });
        var chars = allBound.filter(function (c) { return !c.isNpc && !c.isAltProbe; });
        var npcChars = allBound.filter(function (c) { return c.isNpc || c.isAltProbe; });
        var byName = {}, npcByName = {};
        chars.forEach(function (c) { if (c && c.name) byName[normName(c.name)] = c; });
        npcChars.forEach(function (c) { if (c && c.name) npcByName[normName(c.name)] = c; });
        if (!Object.keys(byName).length && !Object.keys(npcByName).length) return;
        // 先把重复的 NPC 从花名册里清掉，再做评论区清理。
        try { dedupeCharRosters(); } catch (e) {}
        var changed = false;
        var rosterOwners = charRosterNameOwners();
        function drop(c) { if (c && !c.__drop) { c.__drop = true; changed = true; } }
        (momentsData || []).forEach(function (m) {
            if (!m) return;
            var authorName = m.author || '';
            var authorIsUser = normName(authorName) === normName(currentUser.name);
            var authorIsChar = !!byName[normName(authorName)];
            var authorIsAnyChar = authorIsChar || !!npcByName[normName(authorName)];
            var authorObj = byName[normName(authorName)] || npcByName[normName(authorName)] || { name: authorName };
            var authorToken = authorIsAnyChar ? rosterScopeToken('char_' + String(authorObj.id || authorObj.name)) : '';
            // 只有评论区真正发过言的人才能成为回复对象。
            var commenterKeys = {};
            (m.comments || []).forEach(function (c) { if (c && c.user) commenterKeys[normName(c.user)] = 1; });
            (m.comments || []).forEach(function (c) {
                if (!c) return;
                var cu = normName(c.user);
                var commenterIsChar = !!(c.user && byName[cu]);
                var commenterNpcChar = c.user ? npcByName[cu] : null;
                var isAuthor = authorName && normName(c.user) === normName(authorName);
                // 清理旧数据/后台生成的假名：「王姐」「李哥」「店老板」「神秘人」等。
                if (!isAuthor && cu !== normName(currentUser.name) && !byName[cu] && !npcByName[cu] && isGenericNpcName(c.user)) drop(c);
                // 同一个 NPC 已经被别的 char 花名册占用 → 不能出现在这个 char 的评论区。
                if (!authorIsUser && !isAuthor && !byName[cu] && !npcByName[cu] && authorToken && rosterOwners[cu] && rosterOwners[cu] !== authorToken) drop(c);
                if (isAuthor) {
                    var tKey = normName(c.toUser || '');
                    // 作者可以回复评论区里的用户/NPC，但不能回复没留言的人或自己。
                    if (!authorIsUser) {
                        if (!tKey || tKey === normName(authorName) || !commenterKeys[tKey]) drop(c);
                        else if (byName[tKey] && tKey !== normName(currentUser.name)) drop(c); // 不与其他普通 char 互动
                    }
                } else if (commenterIsChar) {
                    // 角色动态下任何其他 char 都不允许出现；用户动态下 char 不能回复 char
                    if (authorIsAnyChar) drop(c);
                    else if (c.toUser && byName[normName(c.toUser)]) drop(c);
                } else if (commenterNpcChar && !authorIsUser) {
                    // NPC / 小号也是角色：不认识作者就不能出现在作者评论区
                    if (!plausibleForAuthor(commenterNpcChar, authorObj, false, false)) drop(c);
                }
                // 「回复xxx」必须是 xxx 真的在评论区发过评论；否则退化成普通评论，别显示错误的回复对象。
                if (!isAuthor && c.toUser) {
                    var toK = normName(c.toUser);
                    if (toK === cu || !commenterKeys[toK]) { delete c.toUser; changed = true; }
                }
                (c.replies || []).forEach(function (r) {
                    if (!r) return;
                    var replyIsChar = !!(r.user && byName[normName(r.user)]);
                    var replyIsNpcChar = !!(r.user && npcByName[normName(r.user)]);
                    if (replyIsChar && (authorIsAnyChar || (r.toUser && byName[normName(r.toUser)]))) drop(r);
                    else if (replyIsNpcChar && !authorIsUser && !plausibleForAuthor(npcByName[normName(r.user)], authorObj, false, false)) drop(r);
                });
                if (c.replies) c.replies = c.replies.filter(function (r) { return r && !r.__drop; });
            });
            var before = (m.comments || []).length;
            m.comments = (m.comments || []).filter(function (c) { return c && !c.__drop; });
            if (m.comments.length !== before) changed = true;
            // 再检查一次：被回复的人必须仍然留在评论区里，否则清掉「回复xxx」。
            if (m.comments.length) {
                var keptKeys = {};
                m.comments.forEach(function (c) { if (c && c.user) keptKeys[normName(c.user)] = 1; });
                m.comments.forEach(function (c) {
                    if (!c || !c.toUser) return;
                    var tk = normName(c.toUser);
                    if (tk && tk !== normName(c.user) && keptKeys[tk]) return;
                    if (normName(c.user) === normName(authorName)) drop(c);
                    else { delete c.toUser; changed = true; }
                });
                m.comments = m.comments.filter(function (c) { return c && !c.__drop; });
            }
            // 点赞里也不允许出现「王姐」「李哥」「店老板」这类假名。
            if (Array.isArray(m.likes)) {
                var lb0 = m.likes.length;
                m.likes = m.likes.filter(function (n) {
                    var k = normName(n);
                    if (k === normName(currentUser.name) || k === normName(authorName)) return true;
                    if (byName[k] || npcByName[k]) return true;
                    return !isGenericNpcName(n);
                });
                if (m.likes.length !== lb0) changed = true;
            }
            if (!authorIsUser && Array.isArray(m.likes)) {
                var lb = m.likes.length;
                m.likes = m.likes.filter(function (n) {
                    var k = normName(n);
                    if (byName[k]) return false;
                    var nc = npcByName[k];
                    if (nc && !plausibleForAuthor(nc, authorObj, false, false)) return false;
                    if (!nc && authorToken && rosterOwners[k] && rosterOwners[k] !== authorToken) return false;
                    return true;
                });
                if (m.likes.length !== lb) changed = true;
            }
        });
        // 同一个 NPC（花名册/虚构的熟人）只能归属一个作者：先出现的动态保留，其他角色下的同名互动清掉。
        var npcAuthorOwner = {};
        (momentsData || []).forEach(function (m) {
            if (!m) return;
            var ownerKey = normName(m.author);
            (m.comments || []).forEach(function (c) {
                if (!c || !c.user) return;
                var k = normName(c.user);
                if (!k || k === normName(currentUser.name) || k === ownerKey || byName[k] || npcByName[k]) return;
                if (!npcAuthorOwner[k]) npcAuthorOwner[k] = ownerKey;
                else if (npcAuthorOwner[k] !== ownerKey) drop(c);
            });
            if (Array.isArray(m.likes)) {
                m.likes = m.likes.filter(function (n) {
                    var k = normName(n);
                    if (!k || k === normName(currentUser.name) || k === ownerKey || byName[k] || npcByName[k]) return true;
                    if (!npcAuthorOwner[k]) { npcAuthorOwner[k] = ownerKey; return true; }
                    return npcAuthorOwner[k] === ownerKey;
                });
            }
            m.comments = (m.comments || []).filter(function (c) { return c && !c.__drop; });
        });
        // 去重后再次清理「回复xxx」：目标已经不在了就不要再显示。
        (momentsData || []).forEach(function (m) {
            if (!m || !m.comments || !m.comments.length) return;
            var kept = {};
            m.comments.forEach(function (c) { if (c && c.user) kept[normName(c.user)] = 1; });
            m.comments.forEach(function (c) {
                if (!c || !c.toUser) return;
                if (normName(c.toUser) !== normName(c.user) && kept[normName(c.toUser)]) return;
                if (normName(c.user) === normName(m.author)) drop(c);
                else { delete c.toUser; changed = true; }
            });
            m.comments = m.comments.filter(function (c) { return c && !c.__drop; });
        });
        if (changed) { try { saveMomentsData(momentsData); } catch (e) {} }
    }

    // 评论者池
    // - 用户动态：所有绑定 char 都可以评论用户，但绝不能回复其他 char；
    // - 角色动态：只允许作者可能认识的 NPC/小号评论，其他角色（包括 NPC/小号）不能跨角色乱入；
    // - 作者本人可以回复评论区里真正发过言的人（用户或 NPC）。
    function buildCommenterPool(author, bound, npcs, isUserPost) {
        var pool = [], seen = {};
        function add(c, kind) {
            if (!c || !c.name) return;
            if (normName(c.name) === normName(currentUser.name)) return;
            if (seen[normName(c.name)]) return;
            seen[normName(c.name)] = 1;
            pool.push({ name: c.name, kind: kind, isAuthor: kind === 'author' });
        }
        var authorName = author && author.name;
        (npcs || []).forEach(function(n) {
            if (!n || !n.name) return;
            if (authorName && normName(n.name) === normName(authorName)) return;
            if (!plausibleForAuthor(n, author, isUserPost, !!n.__authorRoster)) return;
            add(n, 'npc');
        });
        // char 动态的作者本人必须出现在池里：用户评论后要由 TA 来回复用户。
        if (!isUserPost && authorName) add(author, 'author');
        (bound || []).forEach(function(c) {
            if (!c || !c.name) return;
            if (authorName && normName(c.name) === normName(authorName)) return;
            if (c.isNpc || c.isAltProbe) {
                if (!plausibleForAuthor(c, author, isUserPost, false)) return;
                add(c, 'npc');
            } else if (isUserPost) add(c, 'char');
        });
        return pool;
    }

    // 从文本开头推断被回复的人（如「A你们好搞笑」「@A 哈哈」）
    function inferAddressee(text, names) {
        var t = String(text || '').trim().replace(/^@\s*/, '');
        var sorted = (names || []).filter(Boolean).slice().sort(function(a, b) { return String(b).length - String(a).length; });
        for (var i = 0; i < sorted.length; i++) {
            var n = sorted[i];
            if (!n || t.indexOf(n) !== 0) continue;
            var rest = t.slice(String(n).length);
            if (/^[\s，,：:！!？?、~～]/.test(rest) ||
                /^(你|你们|咱|别|也|真|太|怎么|好|哈|笑|快|记得|谢谢|辛苦|冲|加|绝|牛|厉|可|这|那|要不要|来|走)/.test(rest)) {
                return n;
            }
        }
        return null;
    }

    // 过滤：禁止冒充用户；丢弃花名册之外的路人甲；char 之间绝对不互动。
    // 唯一例外：char 动态的作者可以回复评论区里真正发过言的人（用户/NPC）。
    function filterCommentList(list, author, bound, npcs, isUserPost, existingUsers) {
        var boundNpcNames = (bound || []).filter(function(c) { return c && c.isNpc; }).map(function(c) { return c.name; });
        var npcNames = (npcs || []).map(function(c) { return c && c.name; }).filter(Boolean).concat(boundNpcNames);
        var charNames = (bound || []).filter(function(c) { return c && c.name && !c.isNpc; }).map(function(c) { return c.name; });
        var rosterNames = charNames.concat(npcNames);

        // 允许的回复对象：评论区里真正发过言的人（作者/用户没留言就不能被回复）。
        var targets = {};
        function addTarget(n) { if (n) targets[normName(n)] = n; }
        (existingUsers || []).forEach(addTarget);
        (list || []).forEach(function(c) { if (c && c.user) addTarget(c.user); });

        var kept = (list || []).filter(function(c) {
            if (!c || !c.user) return false;
            var u = normName(c.user);
            if (u === normName(currentUser.name)) return false; // 不允许 AI 冒充用户
            var isAuthor = !!(author && author.name && normName(author.name) === u);
            // 作者专属花名册/本批生成的 NPC：默认就是作者可能认识的人；
            // 从全局花名册混进来的 NPC 仍要经过关系判断，避免 A 的熟人跑到 B 的评论区。
            var commenterRosterNpc = (npcs || []).find(function(n) { return n && normName(n.name) === u; });
            if (commenterRosterNpc) {
                // 本批生成的 NPC 带 __owners：只在本批里出现过 TA 的作者动态下出现。
                if (commenterRosterNpc.__owners && !isUserPost) {
                    if (!commenterRosterNpc.__owners[normName(author && author.name)]) return false;
                }
                if (isUserPost || commenterRosterNpc.__authorRoster) return true;
                return plausibleForAuthor(commenterRosterNpc, author, false, false);
            }
            // 绑定的 NPC / 小号也是角色：只有确实可能认识作者时才允许出现。
            var commenterBoundNpc = (bound || []).find(function(x) { return x && (x.isNpc || x.isAltProbe) && normName(x.name) === u; });
            if (commenterBoundNpc) return isUserPost || plausibleForAuthor(commenterBoundNpc, author, false, false);
            var commenterChar = (bound || []).find(function(x) { return x && !x.isNpc && !x.isAltProbe && normName(x.name) === u; });
            if (!commenterChar) return false; // 不在花名册里的名字 → 路人甲，丢弃
            if (isAuthor) return !isUserPost;  // 作者只能在自己的动态里出现（后续回复对象还需是真实评论者）
            // 用户动态：char 可以评论用户，但不能回复其他 char；char 动态：其他 char 一律不出现。
            if (!isUserPost) return false;
            return true;
        });

        return kept.map(function(c) {
            var text = String(c.text || '').trim();
            var u = normName(c.user);
            var to = c.toUser;
            var isAuthor = !!(author && author.name && normName(author.name) === u);
            var commenterIsChar = charNames.some(function(n) { return normName(n) === u; });
            if (!to) {
                var m = text.match(/^(?:回复|@)\s*([^\s：:，,、]{1,20})\s*[：:，,]?\s*([\s\S]+)$/);
                if (m) { to = m[1].trim(); text = m[2].trim(); }
            }
            // 文本里明确叫了某人 → 以文本为准，避免「回复错人」
            var mentionPool = rosterNames.concat((currentUser && currentUser.name) ? [currentUser.name] : []);
            var mentioned = inferAddressee(text, mentionPool);
            if (mentioned && normName(mentioned) !== normName(c.user)) {
                var mentionedIsChar = charNames.some(function(n) { return normName(n) === normName(mentioned); });
                // char 点名 char：绝对不建立回复关系，直接清掉称呼
                if (commenterIsChar && mentionedIsChar) {
                    text = text.replace(new RegExp('^@?\\s*' + mentioned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s，,：:]?'), '');
                } else if (targets[normName(mentioned)]) {
                    to = mentioned;
                }
            }
            // 统一成名单里的规范名字，避免模型写成「李思雨（同学）」时显示不一致。
            var displayUser = c.user;
            var matchNpc = (npcs || []).find(function(n) { return n && normName(n.name) === u; });
            var matchBoundNpc = (bound || []).find(function(x) { return x && (x.isNpc || x.isAltProbe) && normName(x.name) === u; });
            var matchChar = (bound || []).find(function(x) { return x && !x.isNpc && !x.isAltProbe && normName(x.name) === u; });
            if (isAuthor && author && author.name) displayUser = author.name;
            else if (matchNpc) displayUser = matchNpc.name;
            else if (matchBoundNpc) displayUser = matchBoundNpc.name;
            else if (matchChar) displayUser = matchChar.name;
            var o = { user: displayUser, text: text };
            var toAllowed = !!to && normName(to) !== normName(displayUser);
            if (toAllowed) {
                if (normName(to) === normName(currentUser.name)) {
                    o.toUser = currentUser.name; // 回复用户
                } else if (charNames.some(function(n) { return normName(n) === normName(to); })) {
                    // char↔char 任何情况下都不允许；只有 NPC 可以回复 char
                    if (commenterIsChar) toAllowed = false;
                    else if (!targets[normName(to)]) toAllowed = false;
                    if (toAllowed) o.toUser = targets[normName(to)] || to;
                } else if (npcNames.some(function(n) { return normName(n) === normName(to); })) {
                    if (targets[normName(to)]) o.toUser = targets[normName(to)] || to;
                }
            }
            // 作者可以回复评论区里真正发过言的人（用户或 NPC），但不能回复没留言的人。
            if (isAuthor) {
                var at = normName(o.toUser || '');
                if (!at || at === normName(displayUser) || !targets[at]) return null;
                // char↔char 仍然禁止：作者不能回复其他普通 char（作者自己除外）
                if (at !== normName(currentUser.name) &&
                    at !== normName(author && author.name) &&
                    charNames.some(function(n) { return normName(n) === at; })) return null;
            }
            return o;
        }).filter(Boolean);
    }

    // ===== 生成 NPC 花名册（依据 char / user 人设、世界书推断真实关系人物） =====
    async function generateNpcRoster(chars, scope, replace, excludeNames) {
        var persona = buildPersonaBlock(chars);
        var memText = await loadCharMemoryText(chars).catch(function() { return ''; });
        if (memText) persona += '\n\n【角色长期记忆（优先从这里提到的真实人物取材）】\n' + memText.slice(0, 2400);
        var userExtra = currentUser && (currentUser.persona || currentUser.desc || currentUser.bio || currentUser.setting);
        if (currentUser && currentUser.name) {
            persona += '\n\n【用户本人】' + currentUser.name + (userExtra ? ('：' + String(userExtra).slice(0, 600)) : '');
        }
        var exclude = (excludeNames || []).map(function(n) { return String(n || '').trim(); }).filter(Boolean);
        // 同一个 NPC 不能在两个角色的朋友圈里重复出现：排除其他作者花名册里已有的名字。
        try {
            var prefix = NPC_ROSTER_PREFIX + currentMaskId() + '_';
            var srcPrefix = NPC_ROSTER_PREFIX + 'src_' + currentMaskId() + '_';
            for (var ri = 0; ri < localStorage.length; ri++) {
                var rk = localStorage.key(ri);
                if (!rk || rk.indexOf(prefix) !== 0 || rk.indexOf(srcPrefix) === 0) continue;
                (readRoster(rk) || []).forEach(function(n) {
                    if (n && n.name) exclude.push(n.name);
                });
            }
        } catch (e) {}
        // 绑定角色的名字也绝不能拿来当 NPC。
        try {
            getUserBindChars().forEach(function(c) {
                if (c && c.name) exclude.push(c.name);
            });
        } catch (e) {}
        var foreignInfo = (chars || []).map(function(c) { return { name: c && c.name, info: charForeignInfo(c) }; }).filter(function(x) { return x.name && x.info && x.info.foreign; });
        var system = '你是一个世界观设定助手，只负责根据角色人设、世界书与长期记忆，推断与该角色/用户有现实社会关系的具体人物（朋友、同学、同事、家人、邻居等）。必须给出真实感强的完整姓名，严禁使用「旅行者、神秘人、路人、新朋友、王姐、李哥、张老板、店老板、X女士、阿明」这类通用占位称呼。';
        var userMsg = persona +
            '\n\n请列出 4~6 个与上面这些角色或用户本人真实相识的具体人物（他们可能是同事/同学/朋友/家人/邻居/合作方等），供朋友圈互动使用。\n' +
            '要求：\n' +
            '- 每个名字必须是现实中正常的完整姓名（如「李思雨」「刘媛」「陈子豪」），不要用职业、称呼或关系当名字；可以在真名后用括号补充身份备注，如「李思雨（咖啡店老板）」；\n' +
            '- 严禁「王姐 / 李哥 / 张叔 / 王老板 / 店老板 / 神秘人 / 旅行者 / 路人」这类假名或泛称；\n' +
            '- 必须贴合上面的世界观、人设与记忆，优先使用记忆/世界书里已经出现过的人；全新人物也要说明 TA 与哪个角色、什么关系；\n' +
            (foreignInfo.length
                ? ('- 外国角色（' + foreignInfo.map(function(x) { return x.name + '：' + (x.info.nat || '外国') + '，母语 ' + x.info.lang; }).join('；') + '）的朋友要大多来自 TA 自己的国家/文化圈，使用该国常见的真实姓名（可用外文原名），不要全是中国朋友；\n')
                : '') +
            '- 不要与上面已有的角色重名。' + (exclude.length ? ('\n- 这次请换一批新面孔，避开这些已经出现过的人名：' + exclude.slice(0, 24).join('、') + '。') : '') + '\n\n' +
            '严格输出 JSON 数组（不要 markdown、不要解释），格式：\n' +
            '[{"name":"李思雨","relation":"XX的大学同学","setting":"一句话性格与背景","gender":"女"}]';

        var raw = await fetchAIResponse(userMsg, false, { apiPref: 'sub', system: system, maxTokens: 700, temperature: 0.85 });
        var list = parseNpcRoster(raw, chars);
        if (exclude.length) {
            var exMap = {};
            exclude.forEach(function(n) { var k = normName(n); if (k) exMap[k] = 1; });
            list = list.filter(function(n) { return n && !exMap[normName(n.name)]; });
        }
        var ids = (chars || []).map(function(c) { return String((c && (c.id || c.name)) || ''); }).filter(Boolean);
        // 只有真的生成出新名单才替换；生成失败时保留旧名单，避免刷新后一个熟人都没有。
        if (list.length) {
            var old = replace ? [] : (loadNpcRoster(scope) || []);
            var merged = old.concat(list);
            var seen = {};
            merged = merged.filter(function(n) {
                if (!n || !n.name) return false;
                var k = normName(n.name);
                if (seen[k]) return false;
                seen[k] = 1; return true;
            });
            saveNpcRoster(merged.slice(0, 24), ids, scope);
        }
        return list;
    }

    function parseNpcRoster(raw, chars) {
        var text = String(raw || '').replace(/```[a-zA-Z]*/g, '').trim();
        var arr = null;
        var m = text.match(/\[[\s\S]*\]/);
        if (m) { try { arr = JSON.parse(m[0]); } catch (e) { arr = null; } }
        var block = (chars || []).map(function(c) { return c && c.name; }).filter(Boolean);
        block.push(currentUser && currentUser.name);
        var out = [];
        (Array.isArray(arr) ? arr : []).forEach(function(n) {
            if (!n) return;
            var sp = splitNpcDisplayName(n.name);
            var name = sp.name;
            if (isGenericNpcName(name)) return;
            if (block.some(function(b) { return normName(b) === normName(name); })) return;
            var relation = String(n.relation || '').trim();
            if (sp.note) relation = sp.note + (relation && relation.indexOf(sp.note) < 0 ? ('；' + relation) : '');
            out.push({
                id: 'npc_' + normName(name),
                name: name,
                avatar: generatedAvatar(name, String(n.gender || '').trim()),
                relation: relation,
                setting: String(n.setting || '').trim(),
                gender: String(n.gender || '').trim()
            });
        });
        return out;
    }

    // 用户评论/回复后，保证至少有一条来自「被回复的人」或作者的回应。
    // 先尝试让 AI 写一句，失败时给一句自然的兜底，绝不让用户评论石沉大海。
    async function ensureUserReply(item, parsed, authorChar, bound, npcs, isUserPost, persona, authorForeign) {
        var userComments = (item.comments || []).filter(function(c) {
            return c && normName(c.user) === normName(currentUser.name);
        });
        if (!userComments.length) return parsed;

        var npcNames = (npcs || []).filter(function(n) { return n && n.name; }).map(function(n) { return n.name; })
            .concat((bound || []).filter(function(c) { return c && c.isNpc; }).map(function(c) { return c.name; }));
        var plainCharNames = (bound || []).filter(function(c) { return c && c.name && !c.isNpc; }).map(function(c) { return c.name; });
        var expected = '';
        for (var i = userComments.length - 1; i >= 0; i--) {
            var t = userComments[i].toUser;
            if (t && normName(t) !== normName(currentUser.name)) { expected = t; break; }
        }
        // char 动态下其他 char 不能出现，被回复的 char 一律改由作者本人回应
        if (!isUserPost && authorChar && authorChar.name) {
            if (!expected || plainCharNames.some(function(n) { return normName(n) === normName(expected); })) expected = authorChar.name;
        }
        if (expected && !npcNames.some(function(n) { return normName(n) === normName(expected); }) &&
            !plainCharNames.some(function(n) { return normName(n) === normName(expected); }) &&
            !(authorChar && normName(authorChar.name) === normName(expected))) {
            expected = '';
        }
        if (!expected) {
            var npc = npcNames.find(function(n) { return normName(n) !== normName(item.author); });
            if (npc) expected = npc;
        }
        if (!expected && isUserPost) {
            var ch = plainCharNames.find(function(n) { return normName(n) !== normName(item.author); });
            if (ch) expected = ch;
        }
        if (!expected && !isUserPost && authorChar && authorChar.name) expected = authorChar.name;
        // 必须是被回复的那个人回应；只有作者兜底时也一样。
        var hasReplyFromExpected = (parsed || []).some(function(c) {
            return c && normName(c.toUser || '') === normName(currentUser.name) &&
                (!expected || normName(c.user || '') === normName(expected));
        });
        if (hasReplyFromExpected) return parsed;
        if (!expected) return parsed;

        var userLine = userComments.slice().reverse().find(function(c) {
            return c && expected && normName(c.toUser || '') === normName(expected);
        }) || userComments[userComments.length - 1];
        var tryText = '';
        try {
            var sys = '你正在扮演朋友圈里的「' + expected + '」。请只回一句对「' + (currentUser.name || '用户') + '」评论的自然回复，不超过 25 字，口语、短促、像随手打字；不要解释、不要加名字前缀、不要输出引号。' +
                (authorForeign && authorForeign.foreign ? (' 这条朋友圈的作者是' + (authorForeign.nat || '外国') + '人，请先用' + authorForeign.lang + '写，再用括号附中文翻译，例如：thank you（谢谢）。') : '');
            var usr = persona + '\n\n动态内容：' + (item.text || '') +
                '\n用户对你说：' + String(userLine.text || '') +
                '\n请只输出回复内容本身。';
            var raw = await fetchAIResponse(usr, false, { apiPref: 'sub', system: sys, maxTokens: 120, temperature: 0.9 });
            tryText = String(raw || '').replace(/```[a-zA-Z]*/g, '').replace(/^["“”'\s]+|["“”'\s]+$/g, '').split(/\n/)[0].trim();
        } catch (e) { tryText = ''; }
        var fallbackText = (authorForeign && authorForeign.foreign) ? 'ok（看到了）' : '看到了';
        var reply = filterCommentList(
            [{ user: expected, toUser: currentUser.name, text: tryText || fallbackText }],
            authorChar, bound, npcs, isUserPost, [currentUser.name]
        );
        if (reply.length) return (parsed || []).concat(reply.slice(0, 1));
        if (!isUserPost && expected === (authorChar && authorChar.name)) {
            return (parsed || []).concat([{ user: expected, toUser: currentUser.name, text: tryText || ((authorForeign && authorForeign.foreign) ? 'ok（刚看到，我想想怎么回你）' : '刚看到，我想想怎么回你') }]);
        }
        return parsed;
    }

    // ===== 刷新单条动态评论（AI 生成，调用一次副 API，未配置则主 API） =====
    window.triggerPostRefresh = async function(id, boundOverride, npcsOverride, silent) {
        var item = momentsData.find(function(m) { return m.id === id; });
        if (!item) return;
        if (window.__momentsGenerating) return;

        // 刷新评论不会清除之前的评论：旧评论全部保留，本次只在后面追加新互动。
        if (!Array.isArray(item.comments)) item.comments = [];
        var authorKey = normName(item.author);
        var userKey = normName(currentUser.name);
        var userReplyNames = {};
        (item.comments || []).forEach(function (c) {
            if (!c || !c.user) return;
            if (normName(c.user) !== userKey) return;
            var t = String(c.toUser || '').trim();
            if (!t) return;
            var tk = normName(t);
            if (!tk || tk === userKey || tk === authorKey) return;
            userReplyNames[tk] = t;
        });

        if (!silent) showMomentsLoading('正在生成评论…');
        window.__momentsGenerating = true;
        try {
            settings = await getSettings();

            var bound = ((boundOverride && boundOverride.length) ? boundOverride : getUserBindChars())
                .filter(isPostableChar);
            // NPC 只属于这条动态的作者：每次刷新评论都按作者现场生成/筛选，
            // 不再读所有人共用的花名册，避免 A 的熟人跑进 B 的评论区。
            var isUserAuthor = normName(item.author) === normName(currentUser.name);
            var authorCharForScope = findCharByName(bound, item.author) || null;
            var rosterScope = authorCharForScope
                ? ('char_' + String(authorCharForScope.id || authorCharForScope.name))
                : (isUserAuthor ? 'user' : ('post_' + normName(item.author)));
            var authorObj = authorCharForScope || { name: item.author };
            var npcs = (npcsOverride && npcsOverride.length) ? npcsOverride.slice() : [];
            if (!npcs.length) {
                var knownNpcs = knownNpcPeople(authorObj, isUserAuthor, bound);
                var oldRoster = rosterNpcs(rosterScope);
                var generatedNpcs = [];
                var rosterChars = authorCharForScope ? [authorCharForScope] : (isUserAuthor ? bound : [authorObj]);
                if (rosterChars.length) {
                    // 每次都换一批新面孔：排除当前评论/点赞里已经出现的人和旧花名册。
                    var excludeOld = [];
                    (item.comments || []).forEach(function (c) { if (c && c.user) excludeOld.push(c.user); });
                    (item.likes || []).forEach(function (n) { if (n) excludeOld.push(n); });
                    oldRoster.forEach(function (n) { if (n && n.name) excludeOld.push(n.name); });
                    try { generatedNpcs = (await generateNpcRoster(rosterChars, rosterScope, true, excludeOld)) || []; } catch (e) { generatedNpcs = []; }
                }
                if (generatedNpcs.length) {
                    generatedNpcs.forEach(function (n) { if (n) n.__authorRoster = true; });
                    npcs = knownNpcs.concat(generatedNpcs);
                } else {
                    // 生成失败：保留旧花名册，至少还有熟人能评论、能回应用户。
                    oldRoster.forEach(function (n) { if (n) n.__authorRoster = true; });
                    npcs = knownNpcs.concat(oldRoster);
                }
            }
            // 保留作者，并把用户刚回复过的人收编进名单，保证 TA 能被识别、能回复用户。
            (function absorbPostNpcs() {
                var seen = {};
                npcs.forEach(function(n) { if (n && n.name) seen[normName(n.name)] = 1; });
                function add(name) {
                    name = String(name || '').trim();
                    if (!name) return;
                    var k = normName(name);
                    if (!k || k === userKey || seen[k]) return;
                    seen[k] = 1;
                    if (findCharByName(bound, name)) return;
                    if (isGenericNpcName(name)) return;
                    npcs.push({
                        id: 'npc_' + k, name: name, avatar: generatedAvatar(name, ''),
                        type: 'npc', isContext: true, isNpc: true,
                        relation: '朋友圈里可能认识的人', setting: '',
                        __authorRoster: true
                    });
                }
                add(item.author);
                Object.keys(userReplyNames).forEach(function (k) { add(userReplyNames[k]); });
                // 旧评论全部保留，所以旧的评论者/被回复者也要收编进本次名单，
                // 否则模型让 TA 继续接话时会被当成「名单外的人」丢掉。
                // 只收编最近一部分，避免评论区越滚越大时提示词无限膨胀。
                (item.comments || []).slice(-20).forEach(function (c) {
                    if (!c) return;
                    if (c.user) add(c.user);
                    if (c.toUser) add(c.toUser);
                });
            })();
            // 花名册里如果碰巧出现和绑定角色同名的 NPC，也不能绕过「角色之间不互动」的规则。
            var plainBoundKeys = {};
            bound.forEach(function (c) {
                if (c && c.name && !c.isNpc && !c.isAltProbe) plainBoundKeys[normName(c.name)] = 1;
            });
            npcs = npcs.filter(function (n) { return !n || !n.name || !plainBoundKeys[normName(n.name)]; });
            var isUserPost = normName(item.author) === normName(currentUser.name);
            var authorNpc = findNpcByName(npcs, item.author);
            var authorChar = findCharByName(bound, item.author) ||
                (authorNpc ? { id: authorNpc.id, name: authorNpc.name, setting: authorNpc.setting, relation: authorNpc.relation } : null) ||
                authorObj;
            // 外国作者：评论必须是「外语原文（中文翻译）」，NPC 也大多来自 TA 的国家。
            var authorForeign = charForeignInfo(authorChar);
            if (!authorForeign.foreign && looksForeignMomentText(item.text)) {
                authorForeign = { foreign: true, nat: '外国', lang: '作者母语' };
            }

            if (!isUserPost && !authorChar && npcs.length === 0) {
                if (silent) return;
                showApiError({
                    type: 'text', stage: 'config',
                    reason: '没有可用角色',
                    hint: '联系人或绑定角色为空，无法生成评论。请先在主页添加角色或绑定角色。'
                });
                return;
            }

            var persona = buildMomentsPersona(bound, npcs);
            var pool = buildCommenterPool(authorChar, bound, npcs, isUserPost);
            if (!pool.length) {
                if (silent) return;
                showApiError({
                    type: 'text', stage: 'config',
                    reason: '没有可用评论者',
                    hint: '请先绑定角色，或在刷新朋友圈时生成朋友名单，再来生成评论。'
                });
                return;
            }
            // 评论区全部保留给用户看，但只把最近的一部分喂给模型，避免上下文无限膨胀。
            var existing = (item.comments || []).slice(-30).map(fmtCommentLine).join('\n');
            var userComments = (item.comments || []).filter(function(c) { return normName(c.user) === normName(currentUser.name); }).slice(-10);
            var hasUserComment = userComments.length > 0;

            var system = '你是朋友圈里的真实人类。评论区只能使用给定名单里的名字，名单里的人都已按「是否可能认识作者」筛选过。最重要：普通 char 之间绝对不允许互相评论、回复、点赞或接话；char 发的动态下评论区只能出现作者真正可能认识的 NPC/小号（不认识的人绝对不能出现）。作者本人可以回复评论区里的 NPC 或用户，NPC 之间、NPC 与作者之间也可以互相回复；但只有真正发过评论的人才能被「回复」，作者没留言时不能被回复。绝不能替用户发言。' +
                (authorForeign.foreign
                    ? ('这条动态的作者是' + (authorForeign.nat || '外国') + '人，母语是' + authorForeign.lang + '。所有评论都必须先用' + authorForeign.lang + '写一句，再用括号附中文翻译，例如：do you love me？（爱我吗？）；NPC 也大多是作者国家的朋友。')
                    : '') +
                '评论要短、口语、碎片化，像随手打字：可以只回“哈哈哈”“？”“好家伙”“这家我知道”，可以损、可以关心、可以只发一个表情；不要长评、客服腔、升华总结。';
            var charNamesForPrompt = (bound || []).map(function(c) { return c && c.name; }).filter(Boolean).join('、');
            var userCommentLines = userComments.map(function(c) {
                return '用户' + (c.toUser ? (' 回复 ' + c.toUser) : '') + '：' + c.text;
            }).join('\n');
            var userReplyTargets = userComments.map(function(c) { return c && c.toUser; }).filter(function(n) { return n && normName(n) !== normName(currentUser.name); });
            var userMsg = persona +
                '\n\n【本动态可以出现的评论者（只能使用这些名字，不要创造新名字）】\n' + pool.map(function(c) { return '· ' + c.name + (c.kind === 'author' ? '（本动态作者）' : ''); }).join('\n') +
                '\n\n【这条朋友圈】\n作者：' + (item.author || '') + '\n内容：' + (item.text || '') +
                (existing ? ('\n已有评论（可接着聊）：\n' + existing) : '') +
                (hasUserComment ? ('\n【用户本人的评论（必须回复）】\n' + userCommentLines) : '') +
                '\n\n请生成 7~10 条新的评论互动（数量要够，不要只写两三条；既要回复已有评论，也要有新的人加入）：\n' +
                '- 评论者只能从上面的名字里选，名字原样使用；名单里的人都可能认识作者，名单外的人一个都不许出现；\n' +
                '- 不能只有作者/用户一个人说话，至少 4 条评论要来自 NPC/小号或其他角色；\n' +
                (isUserPost && charNamesForPrompt ? ('- 这条是用户本人发的动态：点赞名单里必须包含全部角色（' + charNamesForPrompt + '），并且至少 2 位角色要发表评论；\n') : '') +
                (hasUserComment
                    ? ('- 必须至少 2 条回复用户本人（回复对象写「' + (currentUser.name || '用户') + '」），自然接住 TA 说的话；' +
                       (userReplyTargets.length ? ('用户刚才回复了「' + userReplyTargets.join('、') + '」，被回复的人必须回复用户；') : '') +
                       '作者本人和其他 NPC 也都要有人回复用户/互相接话；同时至少 2 条是全新的评论者首次出现；\n')
                    : '- 至少 2 条必须是此前没在这条评论区出现过的新评论者；\n') +
                '- 回复对象必须是这条动态的评论区里真正发过评论的人；作者本人在评论区没留言时，绝对不能写「回复作者」；不要回复只点赞的人；\n' +
                '- 每条评论的内容要和「回复对象」一致，不要张冠李戴；\n' +
                '- 普通 char 之间严禁互相回复/评论/点赞；作者本人可以回复评论区里的 NPC 或用户，NPC 也可以回复作者或其他 NPC；\n' +
                (isUserPost
                    ? '- 这条是用户动态：角色可以评论用户，NPC 可以评论任何人；\n'
                    : '- 这条是 char 动态：评论者优先是 NPC 名单里的人；其他普通 char 一个都不许出现；用户评论后，作者本人和其他 NPC 都可以回复用户；\n') +
                (authorForeign.foreign
                    ? ('- 外语格式：每条评论都要写成「' + authorForeign.lang + '原文（中文翻译）」，例：do you love me？（爱我吗？）；不能只写中文。\n')
                    : '') +
                '- 严禁以用户身份发言、点赞或评论；\n' +
                '- 每条不超过 25 字，口语化，像真人。\n' +
                '- 另外给出 3~6 个点赞者的名字，只能从上面的名单里选；char 动态的点赞者只能是 NPC。\n\n' +
                '严格按下面格式输出（不要编号、不要解释）：\n' +
                'LIKES: 名字1,名字2\n' +
                '评论者|回复对象|内容\n' +
                '（不是回复别人时第二段留空，写成「评论者||内容」；回复他人时必须写出对方名字）';

            var raw;
            try {
                raw = await fetchAIResponse(userMsg, false, { apiPref: 'sub', system: system, maxTokens: isUserPost ? 1400 : 1200, temperature: 0.9 });
            } catch (err) {
                if (!silent) showApiError(err);
                return;
            }

            var newLikes = parseLikesFromText(raw, pool);
            var rawForComments = String(raw || '').replace(/^\s*(?:LIKES|点赞)\s*[:：].*$/gim, '');
            var existingUsers = (item.comments || []).map(function(c) { return c.user; });
            var parsed = filterCommentList(parseCommentLines(rawForComments), authorChar, bound, npcs, isUserPost, existingUsers);
            // 单独刷新评论时至少 7 条：不够就再补一次，单次最多追加 10 条。
            if (parsed.length < 7) {
                try {
                    var raw2 = await fetchAIResponse(userMsg + '\n\n上次只生成了 ' + parsed.length + ' 条，请再补齐到 7~10 条；不要重复已有评论。', false, { apiPref: 'sub', system: system, maxTokens: isUserPost ? 1400 : 1200, temperature: 0.92 });
                    var parsed2 = filterCommentList(
                        parseCommentLines(String(raw2 || '').replace(/^\s*(?:LIKES|点赞)\s*[:：].*$/gim, '')),
                        authorChar, bound, npcs, isUserPost, existingUsers.concat(parsed.map(function(c) { return c.user; }))
                    );
                    if (parsed2.length) parsed = parsed.concat(parsed2);
                } catch (e) {}
            }
            // 关键兜底：用户评论后必须有人回复用户；被回复的人优先，否则作者本人。
            parsed = parsed.slice(0, 10);
            parsed = await ensureUserReply(item, parsed, authorChar, bound, npcs, isUserPost, persona, authorForeign);
            // 模型完全没按格式输出时，用作者可能认识的人补两条短评，别让「刷新」看起来毫无反应。
            if (!parsed.length) {
                var fbTexts = authorForeign.foreign
                    ? (/英文/i.test(authorForeign.lang) ? ['nice（不错）', 'haha（哈哈）'] : [])
                    : ['哈哈哈哈哈', '这个我懂', '好看', '下次带我一个'];
                for (var fbi = 0; fbi < npcs.length && parsed.length < 2 && fbTexts.length; fbi++) {
                    var fbName = npcs[fbi] && npcs[fbi].name;
                    if (!fbName || normName(fbName) === normName(item.author)) continue;
                    if (parsed.some(function (c) { return normName(c.user) === normName(fbName); })) continue;
                    parsed.push({ user: fbName, text: fbTexts[parsed.length % fbTexts.length] });
                }
            }
            if (!parsed.length && !newLikes.length) {
                if (!silent) {
                    showApiError({
                        type: 'text', stage: 'parse',
                        reason: '没有解析到有效的评论内容',
                        responseBody: String(raw || '').slice(0, 800),
                        hint: '模型没有按「评论者|回复对象|内容」格式输出，或使用了花名册以外的名字。请重试或更换模型。'
                    });
                }
                return;
            }

            var userLiked = (item.likes || []).some(function (n) { return normName(n) === normName(currentUser.name); });
            if (!item.likes) item.likes = [];
            newLikes = (newLikes || []).filter(function (n) {
                if (!n) return false;
                if (normName(n) === normName(item.author)) return false; // 作者不给自己点赞
                var c = (bound || []).find(function (x) { return x && normName(x.name) === normName(n); });
                if (!c) return true;        // 花名册 NPC 点赞
                if (c.isNpc || c.isAltProbe) return isUserPost || plausibleForAuthor(c, authorChar, false, false);
                // 普通 char 之间绝对不互相点赞：只有用户动态允许 char 点赞（赞的是用户）
                return !!isUserPost;
            });
            // 刷新评论时也换一批点赞名字：保留用户自己的赞，其余用新一批替换。
            item.likes = [];
            newLikes.forEach(function(n) {
                if (!item.likes.some(function(x) { return normName(x) === normName(n); })) item.likes.push(n);
            });
            if (userLiked) item.likes.push(currentUser.name);
            // 用户本人发的动态：所有绑定 char 都与用户认识，保证都出现在点赞里
            if (isUserPost) {
                (bound || []).forEach(function(c) {
                    if (!c || !c.name) return;
                    if (!item.likes.some(function(x) { return normName(x) === normName(c.name); })) item.likes.push(c.name);
                });
            } else {
                // 模型没给点赞时，从作者可能认识的人里随机补，保证至少有 3 个赞。
                var likeCandidates = npcs.filter(function (n) { return n && n.name && normName(n.name) !== normName(item.author); });
                for (var lj = likeCandidates.length - 1; lj > 0; lj--) {
                    var lk2 = Math.floor(Math.random() * (lj + 1));
                    var ltmp = likeCandidates[lj]; likeCandidates[lj] = likeCandidates[lk2]; likeCandidates[lk2] = ltmp;
                }
                for (var lk = 0; lk < likeCandidates.length && item.likes.length < 3; lk++) {
                    var ln = likeCandidates[lk].name;
                    if (!item.likes.some(function(x) { return normName(x) === normName(ln); })) item.likes.push(ln);
                }
            }
            item.likes = item.likes.slice(0, 6);

            if (!item.comments) item.comments = [];
            if (parsed.length) {
                parsed.forEach(function(c) { item.comments.push(c); });
                saveOneMoment(item);
                renderFeed();
                if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId === id) openDetail(id);
            }
        } finally {
            // 旧评论不删除，生成失败也不影响已有评论区。
            if (!silent) hideMomentsLoading();
            window.__momentsGenerating = false;
            if (!silent) {
                try { if (window.parent !== window) window.parent.postMessage({ type: 'NANO_GEN_NOTIFY', title: '朋友圈已更新', body: '新动态生成完成', target: 'moments', avatar: (item && item.avatar) || '', name: (item && item.name) || '朋友圈' }, '*'); } catch (e) {}
            }
        }
    };

    // ===== 主动生成的朋友圈（后台/Worker）只有文案没有互动时，自动补一批点赞和评论 =====
    var interactionBackfillBusy = false;
    async function backfillMissingInteractions(limit) {
        if (interactionBackfillBusy || window.__momentsGenerating) return;
        // 等角色库加载完再补互动，否则生成出来的熟人名单会缺人设/关系。
        if (!dbCharsCache || !dbCharsCache.length) return;
        var now = Date.now();
        var targets = (momentsData || []).filter(function (m) {
            if (!m || !m.id || !String(m.text || '').trim()) return false;
            var hasComments = !!(m.comments && m.comments.length);
            var hasLikes = !!(m.likes && m.likes.length);
            // 只补「完全没有任何互动」的动态，避免把已有评论的帖子也整批换掉。
            if (hasComments || hasLikes) return false;
            var at = 0;
            try { at = Number(localStorage.getItem('nano_moments_inter_try_' + m.id) || 0); } catch (e) {}
            // 同一个失败过的动态 6 小时内不再自动重试，避免反复消耗 API。
            return !at || now - at > 6 * 3600 * 1000;
        }).slice(0, limit || 2);
        if (!targets.length) return;
        interactionBackfillBusy = true;
        try {
            for (var i = 0; i < targets.length; i++) {
                var tid = targets[i].id;
                try { localStorage.setItem('nano_moments_inter_try_' + tid, String(Date.now())); } catch (e) {}
                try { await window.triggerPostRefresh(tid, null, null, true); } catch (e) {}
            }
        } finally {
            interactionBackfillBusy = false;
        }
    }
    window.__backfillMomentsInteractions = backfillMissingInteractions;

    // ===== 全局刷新：先选要生成哪些 char（弹窗），再在此基础上补 NPC =====
    document.getElementById('btnRefreshGlobal').addEventListener('click', function() {
        var bound = getUserBindChars().filter(isPostableChar);
        if (!bound.length) {
            runGlobalGenerate([]);
            return;
        }
        openRefreshCharPicker(bound);
    });

    function openRefreshCharPicker(bound) {
        var listEl = document.getElementById('refreshCharList');
        var modal = document.getElementById('refreshCharModal');
        if (!listEl || !modal) {
            runGlobalGenerate(bound.map(function(c) { return String(c.id || c.name); }));
            return;
        }
        listEl.innerHTML = '';
        bound.forEach(function(c) {
            var id = String(c.id || c.name);
            var row = document.createElement('label');
            row.className = 'refresh-char-row';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = id;
            cb.checked = true;
            var nm = document.createElement('span');
            nm.className = 'refresh-char-name';
            nm.textContent = c.name;
            row.appendChild(cb);
            row.appendChild(nm);
            listEl.appendChild(row);
        });
        modal.classList.add('show');
    }

    document.getElementById('btnConfirmRefreshChars').addEventListener('click', function() {
        var ids = Array.prototype.slice.call(
            document.querySelectorAll('#refreshCharList input[type="checkbox"]:checked')
        ).map(function(i) { return i.value; });
        document.getElementById('refreshCharModal').classList.remove('show');
        runGlobalGenerate(ids);
    });
    document.getElementById('btnCancelRefreshChars').addEventListener('click', function() {
        document.getElementById('refreshCharModal').classList.remove('show');
    });

    function buildPostsPrompt(chars, npcs, wantNpcCount, recent, opts) {
        opts = opts || {};
        var persona = buildMomentsPersona(chars, npcs);
        var total = opts.total || (3 + Math.floor(Math.random() * 3)); // 一次生成 3~5 条
        var npcNames = (npcs || []).map(function (n) { return n && n.name; }).filter(Boolean);
        var charNames = (chars || []).map(function (c) { return c && c.name; }).filter(Boolean);
        var charQuota = Math.min(charNames.length, total);
        var npcFill = Math.max(0, total - charQuota);
        var lines = [];
        lines.push('请一次性生成 ' + total + ' 条朋友圈动态，每条自带点赞和评论互动，像真人随手发的日常：');
        if (opts.onlyChars) {
            lines.push('- 发布者只能从已选角色里挑，尽量不同的人各发一条，名字原样使用；');
        } else {
            if (charQuota > 0) {
                lines.push('- 【发帖人优先级】先让已选角色发帖：' + charNames.slice(0, charQuota).join('、') + ' 每人至少 1 条，作者不要重复；');
            }
            if (npcFill > 0) {
                lines.push('- 已选角色不足 ' + total + ' 条，剩下的 ' + npcFill + ' 条必须由 NPC 名单里的人发帖补足（' + (npcNames.slice(0, Math.max(npcFill, 1)).join('、') || 'NPC') + '），不要空着，也不要重复作者；');
            } else {
                lines.push('- 已选角色数量足够，' + total + ' 条全部由已选角色发，挑 ' + total + ' 位不同的人，作者不要重复；');
            }
        }
        lines.push('- 内容是活人发的日常，别一板一眼：会有吐槽、碎碎念、吃到好吃的、遇到无语的人、和谁一起的瞬间、路边看到的风景……可以有 emoji、口语、网络用语；');
        lines.push('- 【文案长度】这一批约一半写短帖（100 字以下，2~4 句，也要有意思，不要每次都只写一句话），一半写中等长度（100~220 字，把一件事/情绪讲完整，有细节和画面）；偶尔（约每 2~3 批一次）挑 1 条写成 300~500 字长文——追星/演唱会 repo、好物分享、情感经历、求助/避雷、深夜碎碎念等，要有具体细节、真实情绪和起承转合，不要 AI 腔。不要每条都长，也不要为了凑字硬写；');
        lines.push('- 禁止写成汇报/硬广/正能量总结；长文只能是少数，不要每条都长；允许错别字、重复词、没头没尾的情绪；朋友圈是给熟人看的，不是公开发言；');
        lines.push('- 评论像熟人随口接话：可以损、可以关心、可以只发“哈哈哈”“？”或一个表情，不要每条都礼貌完整、不要总结对方的话；');
        lines.push('- 一部分是「配图动态」：MEDIA 写 image，并写 IMAGE 描述这张照片拍的是什么（吃的 / 风景 / 宠物 / 牵手 / 自拍等日常照）；其余是纯文字，MEDIA 写 text；这 ' + total + ' 条里至少 1 条 image、至少 1 条 text（除非只要求 1 条）；');
        lines.push('- 每条动态必须配 2~4 个点赞（LIKES 写 2~4 个名字）和 4 条左右评论（3~4 条 COMMENT）；不要只写点赞不写评论，也不要只写评论不写点赞；');
        lines.push('- 每条动态的评论区除作者本人外，至少 2 条评论要来自 NPC/小号，不能只有作者自己评论；');
        lines.push(npcNames.length
            ? ('- 评论者/点赞者只能从上面的名字里选；可用评论者/NPC：' + npcNames.join('、') + '；')
            : '- 本批没有预生成 NPC 名单：请自行虚构 4~6 个与作者可能认识的 NPC（必须是真实完整姓名），评论和点赞只能使用这些名字；');
        lines.push('- 【最高优先级】普通 char 之间绝对不允许互相评论、回复、点赞或接话，即使人设/世界书写了认识也不行。char 可以和用户、作者认识的 NPC 互动。');
        lines.push('- char 发的动态：评论者和点赞者只能来自 NPC 名单；其他 char 的名字一个都不许写。没有 NPC 名单时请虚构 NPC，不要用 char 互相接话。');
        lines.push('- 用户本人发的动态（如果出现）：所有 char 都可以评论用户；char 不能回复 char，NPC 可以正常参与。');
        lines.push('- NPC 是真实的朋友/同学/同事/家人，评论要符合各自关系；NPC 可以回复 NPC，也可以回复作者。');
        lines.push('- 【回复对象】只有真正在评论区发过评论的人才能被「回复」；作者本人没在评论区留言时，NPC 不能写「回复作者」。');
        lines.push('- 【NPC 归属】每个 NPC 只属于与自己真实有关系的作者：A 的熟人只能出现在 A 的动态下，绝对不要写到 B/C 的点赞或评论区里；不认识作者的人一个都不许出现；同一个 NPC 也不要出现在两个不同角色的动态里。');
        lines.push('- 【名字】NPC 必须是真实完整姓名，禁止「王姐 / 李哥 / 张叔 / 王老板 / 店老板 / 神秘人 / 旅行者 / 路人」这类假名；身份备注只能放在真实姓名后的括号里，如「李思雨（咖啡店老板）」。');
        var foreignAuthors = (chars || []).filter(function (c) { return c && c.name && charForeignInfo(c).foreign; });
        if (foreignAuthors.length) {
            lines.push('- 【外语发帖】' + foreignAuthors.map(function (c) { var fi = charForeignInfo(c); return c.name + '（' + (fi.nat || '外国') + '，母语 ' + fi.lang + '）'; }).join('、') + '：TA 们的动态文案必须先写母语原文，再换行用括号附中文翻译，例如：do you like me？\n（你爱我吗？）；评论也要「外语原文（中文翻译）」，例如：do you love me？（爱我吗？）；TA 的 NPC 朋友大多要是 TA 自己国家的人。');
        }
        lines.push('- 每条动态的 LIKES 都不能为空：char 的动态 LIKES 只能写 NPC 名字；不得包含用户或任何 char；');
        lines.push('- 评论者回复别人时写成「评论者|回复对象|内容」，不是回复则写成「评论者||内容」；');
        lines.push('- 严禁以用户身份发动态、点赞或评论；');
        lines.push('- 每条评论不超过 25 字。');
        return persona +
            '\n\n【最近的朋友圈（可延续话题，别重复）】\n' + (recent || '（暂无）') +
            '\n\n' + lines.join('\n') +
            '\n\n严格按下面格式输出（不要 markdown、不要编号、不要多余解释）：\n' +
            '===MOMENT===\nAUTHOR: 名字\nMEDIA: image 或 text\nIMAGE: 若 MEDIA=image，写这句照片拍的是什么（如：融化的草莓冰淇淋特写）；纯文字留空\nTEXT: 文案\nLOCATION: 地点（可留空）\nLIKES: 名字1,名字2（必须 2~4 个，不得包含用户）\nCOMMENT: 评论者|回复对象|内容\nCOMMENT: 评论者||内容\n（每条动态必须写 3~4 条 COMMENT）\n\n（下一条动态重复 ===MOMENT=== 结构）';
    }

    async function requestPosts(chars, npcs, wantNpcCount, recent, opts) {
        var system = '你是朋友圈里的真实人类。请一次性发布日常动态，并让 NPC 朋友在评论区接话。普通 char 之间绝对不允许互相评论、回复、点赞或接话；char 发的动态下评论区只能出现作者认识的 NPC。只有真正在评论区发过评论的人才能被回复。外国角色的动态和评论都要「外语原文 + 中文翻译」。严格贴合各自人设、NPC 关系与世界书，保持活人感，绝不 OOC，禁止 AI 腔、解释和出戏。';
        var userMsg = buildPostsPrompt(chars, npcs, wantNpcCount, recent, opts);
        var raw = await fetchAIResponse(userMsg, true, { apiPref: 'main', system: system, maxTokens: 3400, temperature: 0.95 });
        return parseMomentBlocks(raw);
    }

    // ===== 朋友圈生图频率（按角色）：高=每条都生；中=2~3条一次；低=6~8条一次 =====
    var MOMENT_IMG_FREQ = { high: [1, 1], medium: [2, 3], low: [6, 8] };
    function charChatSetting(charId, key, defVal) {
        try {
            var raw = localStorage.getItem('chat_setting_' + key + '_' + charId);
            if (raw === null) return defVal;
            try { return JSON.parse(raw); } catch (e) { return raw; }
        } catch (e) { return defVal; }
    }
    function charMomentImageAllowed(charId) {
        return !!charChatSetting(charId, 'allowMomentImage', false);
    }
    // 每经过一次该角色的动态即为“一轮”，到点返回 true
    function momentImageRoundDue(charId) {
        var freq = charChatSetting(charId, 'momentImageFreq', 'medium');
        var range = MOMENT_IMG_FREQ[freq] || MOMENT_IMG_FREQ.medium;
        var key = 'nano_moment_img_round_' + charId;
        var n = 0;
        try { n = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) {}
        n -= 1;
        var due = n <= 0;
        if (due) n = range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
        try { localStorage.setItem(key, String(n)); } catch (e) {}
        return due;
    }

    try { if (window.NanoRefresh) window.NanoRefresh.define({ id: 'moments', name: '朋友圈', url: 'moments.html', title: '朋友圈' }); } catch (e) {}
    async function runGlobalGenerate(selectedIds) {
        showMomentsLoading('正在生成朋友圈…');
        try { if (window.NanoRefresh) NanoRefresh.start({ key: 'moments', label: '刷新朋友圈' }); } catch (e) {}
        try {
            settings = await getSettings();

            var boundAll = getUserBindChars().filter(isPostableChar);
            var selected = boundAll.filter(function(c) {
                return !selectedIds || !selectedIds.length || selectedIds.indexOf(String(c.id || c.name)) !== -1;
            });
            if (!selected.length) selected = boundAll.slice();

            // 只取已选角色自己的熟人池；不要把其他未选角色的熟人拿来发帖/评论。
            var npcs = [];
            var npcSeen = {};
            function addNpcForFill(n) {
                if (!n || !n.name) return;
                var k = normName(n.name);
                if (!k || npcSeen[k]) return;
                npcSeen[k] = 1; npcs.push(n);
            }
            selected.forEach(function(c) {
                authorNpcPool(c, false, 'char_' + String(c.id || c.name)).forEach(addNpcForFill);
            });

            var allChars = selected.concat(npcs);
            if (allChars.length === 0) {
                showApiError({
                    type: 'text', stage: 'config',
                    reason: '没有可用角色',
                    hint: '联系人或绑定角色为空，无法生成朋友圈。请先在主页添加角色或绑定角色。'
                });
                return;
            }

            var recent = momentsData.slice(0, 5).map(function(m) {
                var cs = (m.comments || []).filter(function(c) { return normName(c.user) !== normName(currentUser.name); }).slice(-3).map(fmtCommentLine).join('；');
                return '· ' + (m.author || '') + '：' + (m.text || '') + (cs ? ('\n  评论：' + cs) : '');
            }).join('\n');

            // 默认 4 个作者：已选角色不足 4 个由可能认识的 NPC 补足；>=4 时只让已选角色发帖。
            var total = Math.max(4, selected.length);
            var npcFill = Math.max(0, total - Math.min(selected.length, total));
            var parsed;
            try {
                parsed = await requestPosts(selected, npcs, npcFill, recent, { total: total, npcFill: npcFill });
                parsed = (parsed || []).slice(0, total);
            } catch (err) {
                showApiError(err);
                try { if (window.NanoRefresh) NanoRefresh.fail(err, { key: 'moments' }); } catch (e) {}
                return;
            }

            if (!parsed.length) {
                showApiError({
                    type: 'text', stage: 'parse',
                    reason: '没有解析到朋友圈动态',
                    hint: '模型没有按 ===MOMENT=== 格式输出，请重试或更换模型。'
                });
                return;
            }

            // 如果花名册生成失败，模型会在正文里自行虚构 NPC。把这些名字收编成
            // 本批 NPC，保证点赞/评论不会被当成「路人甲」全部过滤掉。
            (function absorbAdhocNpcs() {
                var added = [];
                function consider(name, owner) {
                    name = String(name || '').trim();
                    if (!name) return;
                    if (normName(name) === normName(currentUser.name)) return;
                    // 记录这个 NPC 是在谁的动态里出现的，后面只允许 TA 出现在同一位作者下面。
                    // 一个 NPC 只归第一个出现的作者，避免同一个名字跑到两个角色的评论区。
                    var exists = findNpcByName(npcs, name);
                    if (exists) return;
                    if (findCharByName(selected, name)) return;
                    // 未选中的普通 char 不能被当成 NPC 补位发帖；NPC/小号可以。
                    if (boundAll.some(function(c) { return c && !c.isNpc && !c.isAltProbe && normName(c.name) === normName(name); })) return;
                    if (isGenericNpcName(name) || isLegacyFallbackNpc(name)) return;
                    var item = {
                        id: 'npc_' + normName(name), name: name, avatar: generatedAvatar(name, ''),
                        type: 'npc', isContext: true, isNpc: true,
                        relation: '朋友圈里可能认识的人', setting: '',
                        __authorRoster: true, __owners: {}
                    };
                    if (owner) item.__owners[normName(owner)] = 1;
                    npcs.push(item); added.push(item);
                }
                parsed.forEach(function(p) {
                    consider(p.author, p.author);
                    (p.likes || []).forEach(function(n) { consider(n, p.author); });
                    (p.comments || []).forEach(function(c) {
                        if (!c) return;
                        consider(c.user, p.author);
                        if (c.toUser) consider(c.toUser, p.author);
                    });
                });
                if (added.length) {
                    var ids = selected.map(function(c) { return String((c && (c.id || c.name)) || ''); }).filter(Boolean);
                    try { saveNpcRoster(npcs.slice(0, 12), ids, 'forum_batch'); } catch (e) {}
                }
            })();
            // 仍然没有任何 NPC 时再补一次花名册，避免整批动态没有点赞/评论。
            // 用独立的批次 scope，不覆盖各角色自己的花名册。
            if (!npcs.length && selected.length) {
                try { await generateNpcRoster(selected, 'forum_batch', true); npcs = generateContextNPCs('forum_batch'); } catch (e) {}
            }
            // 已选手动角色（含 NPC）不能同时作为「NPC 名单」重复出现；
            // 任何绑定角色的名字也都不能伪装成 NPC 出现在别的角色评论区。
            npcs = npcs.filter(function(n) {
                if (!n) return false;
                if (selected.some(function(c) { return c && normName(c.name) === normName(n.name); })) return false;
                if (boundAll.some(function(c) { return c && !c.isNpc && !c.isAltProbe && normName(c.name) === normName(n.name); })) return false;
                return true;
            });

            var newPosts = [];
            for (var i = 0; i < parsed.length; i++) {
                var p = parsed[i];
                if (!p.author || normName(p.author) === normName(currentUser.name)) continue;
                var ch = findCharByName(selected, p.author);
                var np = findNpcByName(npcs, p.author);
                if (!ch && !np) continue; // 丢弃花名册以外的路人甲
                // 已选角色 >=4 时只让这些角色发帖，NPC 不能顶替。
                if (selected.length >= 4 && !ch) continue;
                var cn = ch ? ch.name : np.name;
                var ca = (ch && ch.avatar) ? ch.avatar : ((np && np.avatar) ? np.avatar : generatedAvatar(ch ? ch.name : (np ? np.name : p.author), (ch && ch.gender) || (np && np.gender) || ''));
                var authorObj = ch || { id: np.id, name: np.name, setting: np.setting, relation: np.relation };

                var likes = (p.likes || []).map(function(n) {
                    if (!n || normName(n) === normName(currentUser.name)) return null;
                    var lc = findCharByName(selected, n);
                    if (lc) return lc.name;
                    var ln = findNpcByName(npcs, n);
                    if (ln) return ln.name;
                    return null;
                }).filter(function(n) {
                    if (!n) return false;
                    if (normName(n) === normName(cn)) return false; // 作者不给自己点赞
                    var ownerNpc = findNpcByName(npcs, n);
                    if (ownerNpc && ownerNpc.__owners && !ownerNpc.__owners[normName(cn)]) return false; // 同一个 NPC 不跨角色
                    var lc2 = findCharByName(selected, n);
                    // NPC/小号也要是作者可能认识的人；普通 char 只在用户动态下点赞（赞的是用户）
                    if (lc2) {
                        if (lc2.isNpc || lc2.isAltProbe) return plausibleForAuthor(lc2, authorObj, false, false);
                        return false;
                    }
                    return true;
                }).slice(0, 4);

                var comments = filterCommentList(p.comments || [], authorObj, selected, npcs, false).slice(0, 4);

                newPosts.push({
                    id: 'gen_' + Date.now() + '_' + i,
                    author: cn,
                    avatar: ca,
                    text: p.text,
                    media: p.media || '',
                    image: p.image || '',
                    images: [],
                    time: new Date().toISOString(),
                    location: p.location || '',
                    likes: likes,
                    comments: comments
                });
            }

            if (!newPosts.length) {
                showApiError({
                    type: 'text', stage: 'parse',
                    reason: '没有生成有效动态',
                    hint: '模型输出的作者不在角色/朋友名单里，请重试。'
                });
                return;
            }

            // 生图：仅「允许朋友圈生图」的 char 参与，且按各自频率（高/中/低）决定本轮到点；
            // 到点的角色里随机选，不固定同一个人；模型标为配图的动态优先，并保证本轮至少出一张图。
            if (settings.imageEnabled) {
                var dueMap = {};   // 本轮到点、可生图的角色：normName -> charId
                selected.forEach(function(c) {
                    var cid = String(c.id || c.name);
                    if (!charMomentImageAllowed(cid)) return;
                    if (momentImageRoundDue(cid)) dueMap[normName(c.name)] = cid;
                });

                var duePosts = newPosts.filter(function(p) { return dueMap[normName(p.author)]; });
                if (duePosts.length) {
                    // 打乱，避免每次都让同一个人/同一条先出图
                    for (var si = duePosts.length - 1; si > 0; si--) {
                        var sj = Math.floor(Math.random() * (si + 1));
                        var tmp = duePosts[si]; duePosts[si] = duePosts[sj]; duePosts[sj] = tmp;
                    }
                    // 模型标了 image 的排前面
                    duePosts.sort(function(a, b) { return (b.media === 'image' ? 1 : 0) - (a.media === 'image' ? 1 : 0); });

                    var madeCount = 0, maxImages = 1;
                    var needForce = (duePosts.length > 0); // 有到点角色 → 至少出一张
                    for (var ci = 0; ci < duePosts.length && madeCount < maxImages; ci++) {
                        var cp = duePosts[ci];
                        var wantImg = (cp.media === 'image') || (madeCount === 0 && needForce);
                        if (!wantImg) continue;
                        var gch = findCharByName(selected, cp.author);
                        if (!gch) continue;
                        var gid = dueMap[normName(cp.author)];
                        var promptText = cp.image || cp.text;
                        try {
                            var genUrl = await generateImage(promptText, { charId: gid, char: gch });
                            if (genUrl) {
                                cp.images = [genUrl]; cp.genPrompt = promptText; cp.media = 'image'; madeCount++; needForce = false;
                                try { if (window.NanoGallery) window.NanoGallery.add({ url: genUrl, source: '朋友圈', charName: (gch && gch.name) || cp.author || '', prompt: promptText, generated: true }); } catch (e) {}
                            }
                        } catch (e) {}
                    }
                }
            }

            // 兜底互动：模型偶尔只写文案不写 LIKES/COMMENT，保证每条动态都有 2~4 个赞和 2~4 条评论。
            // 每个作者只用「作者可能认识的人」，不把 A 的熟人塞进 B 的评论区。
            var boundNpcs = selected.filter(function(c) { return c && (c.isNpc || c.isAltProbe); });
            var canned = ['这条也太真实了', '哈哈哈哈', '我也想去', '注意休息呀', '好看', '下次带我'];
            function addUnique(list, name) {
                if (!name) return false;
                if (normName(name) === normName(currentUser.name)) return false;
                if (list.some(function(x) { return normName(x) === normName(name); })) return false;
                list.push(name);
                return true;
            }
            function fallbackPeopleFor(authorObj, isUserAuthor, scope) {
                var out = [], seen = {};
                var plainKeys = {};
                (boundAll || []).forEach(function (c) {
                    if (c && c.name && !c.isNpc && !c.isAltProbe) plainKeys[normName(c.name)] = 1;
                });
                function add(n) {
                    if (!n || !n.name) return;
                    var k = normName(n.name);
                    var ak = normName(authorObj && authorObj.name);
                    if (!k || k === ak || k === normName(currentUser.name) || plainKeys[k] || seen[k]) return;
                    seen[k] = 1;
                    out.push(n.name);
                }
                authorNpcPool(authorObj, isUserAuthor, scope).forEach(add);
                if (isUserAuthor) {
                    selected.concat(npcs).forEach(add);
                } else {
                    npcs.forEach(function(n) {
                        if (n && n.__owners && !n.__owners[normName(authorObj && authorObj.name)]) return;
                        if (plausibleForAuthor(n, authorObj, false, !!n.__authorRoster)) add(n);
                    });
                    boundNpcs.forEach(function(n) {
                        if (plausibleForAuthor(n, authorObj, false, false)) add(n);
                    });
                }
                return out;
            }
            newPosts.forEach(function(p, pi) {
                var authorCharObj = findCharByName(selected, p.author);
                var authorNpcObj = findNpcByName(npcs, p.author);
                var authorObj = authorCharObj || authorNpcObj || { name: p.author };
                var isUserAuthor = normName(p.author) === normName(currentUser.name);
                var scope = authorCharObj ? ('char_' + String(authorCharObj.id || authorCharObj.name)) : (isUserAuthor ? 'user' : ('post_' + normName(p.author)));
                var authorFi = charForeignInfo(authorObj);
                if (!authorFi.foreign && looksForeignMomentText(p.text)) authorFi = { foreign: true, nat: '外国', lang: '作者母语' };
                var postCanned = authorFi.foreign ? (/英文/i.test(authorFi.lang) ? ['nice（不错）', 'haha（哈哈）'] : []) : canned;
                var fallbackNames = fallbackPeopleFor(authorObj, isUserAuthor, scope);
                var likePool = fallbackNames;
                var commentPool = fallbackNames;
                if (!p.likes) p.likes = [];
                var seenLikes = {};
                p.likes = p.likes.filter(function(n) {
                    var k = normName(n);
                    if (!k || k === normName(p.author) || seenLikes[k]) return false;
                    seenLikes[k] = 1;
                    return true;
                });
                for (var li = 0; li < likePool.length && p.likes.length < 2; li++) addUnique(p.likes, likePool[li]);
                p.likes = p.likes.slice(0, 4);
                if (!p.comments) p.comments = [];
                for (var ci2 = 0; ci2 < commentPool.length && p.comments.length < 4 && postCanned.length; ci2++) {
                    var who = commentPool[(pi + ci2) % commentPool.length];
                    if (p.comments.some(function(c) { return normName(c.user) === normName(who); })) continue;
                    p.comments.push({ user: who, toUser: '', text: postCanned[(pi + ci2 + String(p.author || '').length) % postCanned.length] });
                }
                p.comments = p.comments.slice(0, 4);
            });

            momentsData = newPosts.concat(momentsData);
            saveMomentsData(momentsData);
            renderFeed();

            // 让所有绑定的 char / 朋友去评论用户自己最近发的、还没人评论的动态
            await backfillUserPostComments(boundAll, npcs);
            try { if (window.NanoRefresh) NanoRefresh.success('朋友圈已更新，点「去看看」查看', { key: 'moments' }); } catch (e) {}
        } finally {
            hideMomentsLoading();
        }
    }

    async function backfillUserPostComments(selected, npcs) {
        if ((!selected || !selected.length) && (!npcs || !npcs.length)) return;
        var userPosts = momentsData.filter(function(m) {
            if (normName(m.author) !== normName(currentUser.name)) return false;
            var others = (m.comments || []).filter(function(c) { return normName(c.user) !== normName(currentUser.name); });
            return others.length === 0;
        });
        if (!userPosts.length) return;
        var todo = userPosts.slice(0, 2);
        for (var i = 0; i < todo.length; i++) {
            // 不传共享 NPC：让 triggerPostRefresh 按这条动态的作者现场生成，避免跨角色共用。
            try { await window.triggerPostRefresh(todo[i].id, selected); } catch (e) {}
        }
    }

    // ===== 个人主页 =====
    function openProfile(authorName, avatarSrc) {
        profileMaskIsSelf = normName(authorName) === normName(currentUser.name);
        if (profileMaskIsSelf) avatarSrc = currentUser.avatar || avatarSrc;
        document.getElementById('profileUserName').textContent = authorName;
        document.getElementById('profileUserAvatar').src = avatarSrcFor(authorName, avatarSrc);
        // 个人主页封面始终跟朋友圈顶部封面共用同一份数据，打开时强制重取一次。
        syncProfileCover();
        var tl = document.getElementById('profileTimeline');
        var userPosts = momentsData.filter(function(m) { return m.author === authorName; });
        if (userPosts.length === 0) {
            tl.innerHTML = '<div style="text-align:center;color:#b2b2b2;padding:20px 0;font-size:14px;">暂无动态</div>';
        } else {
            tl.innerHTML = '';
            userPosts.forEach(function(m) {
                var row = document.createElement('div');
                row.className = 'timeline-row';
                row.onclick = function() { openDetail(m.id); };
                var dateDiv = document.createElement('div');
                dateDiv.className = 'timeline-date';
                var day = document.createElement('div');
                day.className = 'timeline-day';
                day.textContent = getTimeLabel(m.time);
                dateDiv.appendChild(day);
                row.appendChild(dateDiv);
                var contentDiv = document.createElement('div');
                contentDiv.className = 'timeline-content';
                if (m.images && m.images.length > 0) {
                    var imgBox = document.createElement('div');
                    imgBox.className = 'timeline-img-box';
                    var img = document.createElement('img');
                    img.src = m.images[0];
                    imgBox.appendChild(img);
                    contentDiv.appendChild(imgBox);
                }
                var textDiv = document.createElement('div');
                textDiv.className = 'timeline-text';
                textDiv.textContent = formatMomentText(m.text || '');
                contentDiv.appendChild(textDiv);
                row.appendChild(contentDiv);
                tl.appendChild(row);
            });
        }
        switchView('viewProfile');
    }

    // ===== 朋友圈图片大图查看 =====
    var mmViewerState = { postId: null, idx: 0 };
    function ensureImageViewer() {
        var v = document.getElementById('mmImageViewer');
        if (v) return v;
        v = document.createElement('div');
        v.id = 'mmImageViewer';
        v.className = 'mm-viewer';
        v.innerHTML =
            '<div class="mm-viewer-stage"><img id="mmViewerImg" alt=""><div id="mmViewerText" class="mm-viewer-text"></div></div>' +
            '<div class="mm-viewer-bar">' +
                '<button class="mm-vbtn" data-mm="cancel" title="取消"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg><span>取消</span></button>' +
                '<button class="mm-vbtn" data-mm="regen" title="重新生成（可改提示词）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span>重roll</span></button>' +
                '<button class="mm-vbtn" data-mm="download" title="保存到相册"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg><span>保存</span></button>' +
            '</div>' +
            '<div class="mm-sheet" id="mmRerollSheet"><div class="mm-sheet-card">' +
                '<div class="mm-sheet-head"><div class="mm-sheet-title">重新生成图片</div><button class="mm-sheet-x" data-mmx="reroll-close" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
                '<div class="mm-sheet-desc">可以修改提示词后再重roll，也可以不改直接重roll。</div>' +
                '<textarea class="mm-sheet-input" id="mmRerollInput" spellcheck="false" placeholder="描述这张图……"></textarea>' +
                '<div class="mm-sheet-actions"><button class="mm-sheet-btn" data-mmx="reroll-cancel">取消</button><button class="mm-sheet-btn primary" data-mmx="reroll-go">重roll</button></div>' +
            '</div></div>' +
            '<div class="mm-sheet" id="mmSaveSheet"><div class="mm-sheet-card">' +
                '<div class="mm-sheet-head"><div class="mm-sheet-title">保存图片</div><button class="mm-sheet-x" data-mmx="save-close" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
                '<div class="mm-sheet-desc">长按下面这张图片，选择「存储到照片 / 保存图片」即可存进相册。</div>' +
                '<div class="mm-sheet-imgwrap"><img id="mmSaveImg" alt=""></div>' +
                '<div class="mm-sheet-actions"><button class="mm-sheet-btn" data-mmx="save-cancel">取消</button></div>' +
            '</div></div>';
        document.body.appendChild(v);
        v.addEventListener('click', function(e) {
            var mb = e.target.closest('[data-mmx]');
            if (mb) {
                var mx = mb.dataset.mmx;
                if (mx === 'reroll-go') doRegenViewerImage();
                else if (mx === 'reroll-cancel' || mx === 'reroll-close') hideMmSheet('mmRerollSheet');
                else if (mx === 'save-cancel' || mx === 'save-close') hideMmSheet('mmSaveSheet');
                return;
            }
            var btn = e.target.closest('[data-mm]');
            if (btn) {
                var act = btn.dataset.mm;
                if (act === 'cancel') closeImageViewer();
                else if (act === 'regen') showRerollSheet();
                else if (act === 'download') downloadViewerImage();
                return;
            }
            if (e.target === v) closeImageViewer();
        });
        ['mmRerollSheet', 'mmSaveSheet'].forEach(function (id) {
            var s = v.querySelector('#' + id);
            if (s) s.addEventListener('click', function (e) { if (e.target === s) s.classList.remove('show'); });
        });
        return v;
    }
    function hideMmSheet(id) { var s = document.getElementById(id); if (s) s.classList.remove('show'); }
    function showRerollSheet() {
        var item = momentsData.find(function(m) { return m.id === mmViewerState.postId; });
        if (!item) return;
        var inp = document.getElementById('mmRerollInput');
        if (inp) inp.value = item.genPrompt || item.imageText || item.text || '';
        var s = document.getElementById('mmRerollSheet');
        if (s) s.classList.add('show');
    }
    // 保存：优先系统分享（iOS 分享面板可「存储图像」直接进相册），否则下载；都不行退回半屏长按保存
    function saveImageToAlbum(url, fallback) {
        fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
            if (blob && navigator.canShare) {
                try {
                    var type = blob.type || 'image/png';
                    var ext = (type.indexOf('jpeg') > -1 || type.indexOf('jpg') > -1) ? 'jpg' : 'png';
                    var file = new File([blob], 'nano_' + Date.now() + '.' + ext, { type: type });
                    if (navigator.canShare({ files: [file] })) {
                        navigator.share({ files: [file] }).catch(function(e) { if (!(e && e.name === 'AbortError')) fallback(); });
                        return;
                    }
                } catch (e) {}
            }
            if (blob) {
                try {
                    var u = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = u; a.download = 'nano_' + Date.now() + '.png';
                    document.body.appendChild(a); a.click();
                    setTimeout(function() { try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 1000);
                    return;
                } catch (e) {}
            }
            fallback();
        }).catch(function() { fallback(); });
    }
    function openImageViewer(postId, idx) {
        var item = momentsData.find(function(m) { return m.id === postId; });
        if (!item) return;
        mmViewerState.postId = postId;
        mmViewerState.idx = idx || 0;
        var v = ensureImageViewer();
        var img = document.getElementById('mmViewerImg');
        var txt = document.getElementById('mmViewerText');
        var url = (item.images && item.images.length) ? item.images[mmViewerState.idx] : '';
        if (url) {
            img.src = url; img.style.display = 'block';
            txt.style.display = 'none'; txt.textContent = '';
        } else {
            img.style.display = 'none'; img.removeAttribute('src');
            txt.style.display = 'flex'; txt.textContent = item.imageText || item.text || '';
        }
        v.classList.add('show');
    }
    function closeImageViewer() {
        var v = document.getElementById('mmImageViewer');
        if (v) v.classList.remove('show');
    }
    // 重roll：弹底部半屏，展示并可修改当前生图提示词（不改也能直接重roll）
    async function doRegenViewerImage() {
        var item = momentsData.find(function(m) { return m.id === mmViewerState.postId; });
        if (!item) return;
        var inp = document.getElementById('mmRerollInput');
        var val = inp ? String(inp.value).trim() : '';
        if (!val) val = item.genPrompt || item.imageText || item.text || '';
        if (!val) { alert('没有可用的生图描述'); return; }
        hideMmSheet('mmRerollSheet');
        var v = document.getElementById('mmImageViewer');
        if (v) v.classList.add('loading');
        try {
            var url = await generateImage(val);
            if (url) {
                item.images = [url];
                item.genPrompt = val;
                delete item.imageText;
                try { if (window.NanoGallery) window.NanoGallery.add({ url: url, source: '朋友圈', charName: item.author || '', prompt: val, generated: true }); } catch (e) {}
                saveMomentsData(momentsData);
                renderFeed();
                openImageViewer(item.id, 0);
            } else {
                alert('生图失败');
            }
        } catch (e) {
            alert('生图失败：' + (e && e.message ? e.message : e));
        } finally { if (v) v.classList.remove('loading'); }
    }
    function downloadViewerImage() {
        var item = momentsData.find(function(m) { return m.id === mmViewerState.postId; });
        if (!item) return;
        var url = (item.images && item.images.length) ? item.images[mmViewerState.idx] : '';
        if (!url) { alert('没有可下载的图片'); return; }
        saveImageToAlbum(url, function() {
            var si = document.getElementById('mmSaveImg');
            if (si) si.src = url;
            var s = document.getElementById('mmSaveSheet');
            if (s) s.classList.add('show');
        });
    }

    // ===== 详情页 =====
    function openDetail(id) {
        var item = momentsData.find(function(m) { return m.id === id; });
        if (!item) { alert('找不到该动态'); return; }
        currentDetailId = id;
        var container = document.getElementById('detailContent');
        var html = '';
        html += '<div class="detail-author">';
        html += '<img src="' + itemAvatarSrc(item) + '" alt="头像">';
        html += '<div class="d-name">' + item.author + '</div>';
        html += '</div>';
        if (item.text) html += '<div class="detail-text">' + formatMomentText(item.text) + '</div>';
        if (item.images && item.images.length > 0) {
            html += '<div class="detail-images" style="grid-template-columns:' + (item.images.length === 1 ? '1fr' : 'repeat(2,1fr)') + ';">';
            item.images.forEach(function(img, ii) { html += '<img src="' + img + '" style="' + (item.images.length === 1 ? 'max-height:300px;cursor:zoom-in;' : 'cursor:zoom-in;') + '" onclick="openImageViewer(\'' + item.id + '\',' + ii + ')">'; });
            html += '</div>';
        } else if (item.imageText) {
            html += '<div class="mm-text-photo detail" onclick="openImageViewer(\'' + item.id + '\',0)">' + item.imageText + '</div>';
        }

        html += '<div class="feed-meta" style="margin-bottom: 12px; margin-top: 10px;">';
        html += '<span class="feed-time-location">' + (getTimeLabel(item.time) || '刚刚') + (item.location ? ' · ' + item.location : '') + '</span>';
        html += '<div style="position:relative;">';
        html += '<button class="more-action-btn" id="detailMoreActionsBtn" onclick="toggleDetailPopover()">··</button>';
        html += '<div class="detail-action-popover" id="detailActionPopover">';
        html += '<button class="pop-item" onclick="handleLikeDetail()"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>赞</button>';
        html += '<button class="pop-item" onclick="promptCommentDetail()"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>评论</button>';
        html += '<button class="pop-item" onclick="triggerPostRefreshDetail()"><svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>刷新</button>';
        html += '</div></div></div>';

        if ((item.likes && item.likes.length > 0) || (item.comments && item.comments.length > 0)) {
            html += '<div class="interaction-box">';
            if (item.likes && item.likes.length > 0) {
                html += '<div class="likes-line"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ' + item.likes.join('，') + '</div>';
            }
            if (item.comments && item.comments.length > 0) {
                html += '<div class="comments-area">';
                html += '<svg class="comments-icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
                html += '<div class="comments-list">';
                item.comments.forEach(function(c, ci) {
                    html += '<div class="comment-item" id="detail-comment-' + ci + '">';
                    html += '<span><span class="comment-user">' + c.user + '</span>';
                    if (c.toUser) html += ' 回复 <span class="comment-user">' + c.toUser + '</span>';
                    html += '：' + formatMomentInline(c.text) + '</span>';
                    if (c.user === currentUser.name) {
                        html += '<span class="comment-del" onclick="window.deleteComment && window.deleteComment(\'' + item.id + '\',' + ci + ')">×</span>';
                    }
                    html += '</div>';
                });
                html += '</div></div>';
            }
            html += '</div>';
        }

        container.innerHTML = html;
        switchView('viewDetail');

        var detailComments = container.querySelectorAll('.comment-item');
        detailComments.forEach(function(el, idx) {
            if (item.comments && item.comments[idx] && item.comments[idx].user === currentUser.name) {
                setupLongPress(el, item.id, idx);
            }
        });

        window.handleLikeDetail = function() { handleLike(id); };
        window.promptCommentDetail = function() { openCommentModal(id, null); };
        window.triggerPostRefreshDetail = function() { triggerPostRefresh(id); };
        window.deleteComment = deleteComment;
        window.toggleDetailPopover = function() {
            var pop = document.getElementById('detailActionPopover');
            if (pop) pop.classList.toggle('show');
        };
    }

    // ===== 视图切换 =====
    function switchView(vid) {
        document.querySelectorAll('.page-view').forEach(function(e) { e.classList.remove('active'); });
        var target = document.getElementById(vid);
        if (target) target.classList.add('active');
        if (vid === 'viewProfile') syncProfileCover();
        document.getElementById('detailMoreMenu').classList.remove('show');
        var pop = document.getElementById('detailActionPopover');
        if (pop) pop.classList.remove('show');
    }

    // ===== 发布 =====
    function renderUploadGrid() {
        var grid = document.getElementById('uploadGrid');
        grid.innerHTML = '';
        pendingImages.forEach(function(src, i) {
            var item = document.createElement('div');
            item.className = 'upload-item';
            var img = document.createElement('img');
            img.src = src;
            item.appendChild(img);
            var removeBtn = document.createElement('button');
            removeBtn.className = 'remove-img';
            removeBtn.textContent = '×';
            removeBtn.onclick = function(e) { e.stopPropagation(); pendingImages.splice(i, 1); renderUploadGrid(); };
            item.appendChild(removeBtn);
            grid.appendChild(item);
        });
        if (pendingImages.length < 9) {
            var addItem = document.createElement('div');
            addItem.className = 'upload-item';
            addItem.innerHTML = '<span class="upload-add-icon">+</span>';
            addItem.onclick = function() { document.getElementById('postFileInput').click(); };
            grid.appendChild(addItem);
        }
    }

    document.getElementById('btnOpenPost').addEventListener('click', function() {
        pendingImages = []; currentPostLocation = ''; currentVisibility = []; currentAtUsers = [];
        document.getElementById('postTextInput').value = '';
        document.getElementById('labelLocation').textContent = '所在位置';
        document.getElementById('locationValue').textContent = '>';
        document.getElementById('labelVisibility').textContent = '谁可以看';
        document.getElementById('visibilityValue').textContent = '公开 >';
        document.getElementById('labelAt').textContent = '提醒谁看';
        document.getElementById('atValue').textContent = '>';
        renderUploadGrid();
        switchView('viewPost');
    });

    document.getElementById('btnCancelPost').addEventListener('click', function() { switchView('viewFeed'); });

    document.getElementById('postFileInput').addEventListener('change', function(e) {
        var files = e.target.files;
        for (var i = 0; i < files.length; i++) {
            (function(f) {
                var reader = new FileReader();
                reader.onload = function(ev) { compressImage(ev.target.result, 300, function(compressed) { pendingImages.push(compressed); renderUploadGrid(); }); };
                reader.readAsDataURL(f);
            })(files[i]);
        }
        this.value = '';
    });

    document.getElementById('btnLocation').addEventListener('click', function() { document.getElementById('locationModal').classList.add('show'); });
    document.getElementById('btnConfirmLocation').addEventListener('click', function() {
        var val = document.getElementById('inputLocation').value.trim();
        if (val) { currentPostLocation = val; document.getElementById('labelLocation').textContent = val; document.getElementById('locationValue').textContent = val; }
        document.getElementById('locationModal').classList.remove('show');
    });
    document.getElementById('btnCloseLocationModal').addEventListener('click', function() { document.getElementById('locationModal').classList.remove('show'); });

    document.getElementById('btnVisibility').addEventListener('click', function() {
        var box = document.getElementById('charCheckboxList');
        box.innerHTML = '';
        var bound = getUserBindChars();
        if (bound.length === 0) bound = [{ name: '好友', id: 'friend' }];
        bound.forEach(function(c) {
            var label = document.createElement('label');
            label.className = 'checkbox-row';
            var span = document.createElement('span');
            span.textContent = c.name || '未命名';
            label.appendChild(span);
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.value = c.name || c.id;
            input.checked = currentVisibility.indexOf(c.name || c.id) > -1;
            label.appendChild(input);
            box.appendChild(label);
        });
        document.getElementById('visibilityModalTitle').textContent = '选择可见角色';
        document.getElementById('visibilityModal').classList.add('show');
    });
    document.getElementById('btnConfirmVisibility').addEventListener('click', function() {
        var checked = document.querySelectorAll('#charCheckboxList input:checked');
        currentVisibility = Array.from(checked).map(function(el) { return el.value; });
        if (currentVisibility.length > 0) {
            document.getElementById('labelVisibility').textContent = '部分可见(' + currentVisibility.length + ')';
            document.getElementById('visibilityValue').textContent = '部分可见 >';
        } else {
            document.getElementById('labelVisibility').textContent = '谁可以看';
            document.getElementById('visibilityValue').textContent = '公开 >';
        }
        document.getElementById('visibilityModal').classList.remove('show');
    });

    document.getElementById('btnAt').addEventListener('click', function() {
        var box = document.getElementById('atCheckboxList');
        box.innerHTML = '';
        var bound = getUserBindChars();
        if (bound.length === 0) bound = [{ name: '好友', id: 'friend' }];
        bound.forEach(function(c) {
            var label = document.createElement('label');
            label.className = 'checkbox-row';
            var span = document.createElement('span');
            span.textContent = c.name || '未命名';
            label.appendChild(span);
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.value = c.name || c.id;
            input.checked = currentAtUsers.indexOf(c.name || c.id) > -1;
            label.appendChild(input);
            box.appendChild(label);
        });
        document.getElementById('atModal').classList.add('show');
    });
    document.getElementById('btnConfirmAt').addEventListener('click', function() {
        var checked = document.querySelectorAll('#atCheckboxList input:checked');
        currentAtUsers = Array.from(checked).map(function(el) { return el.value; });
        if (currentAtUsers.length > 0) {
            document.getElementById('labelAt').textContent = '提醒 ' + currentAtUsers.length + ' 人';
            document.getElementById('atValue').textContent = '已选' + currentAtUsers.length + '人 >';
        } else {
            document.getElementById('labelAt').textContent = '提醒谁看';
            document.getElementById('atValue').textContent = '>';
        }
        document.getElementById('atModal').classList.remove('show');
    });

    document.getElementById('btnSubmitPost').addEventListener('click', function() {
        var editId = this.dataset.editId;
        var text = document.getElementById('postTextInput').value.trim();
        if (!text && pendingImages.length === 0) { alert('请输入内容或添加图片'); return; }
        var newPost = {
            id: editId || ('p_' + Date.now()),
            author: currentUser.name,
            avatar: currentUser.avatar || '',
            text: text || '分享图片',
            images: pendingImages.slice(),
            time: new Date().toISOString(),
            location: currentPostLocation || '',
            likes: [],
            comments: []
        };
        if (editId) {
            var old = momentsData.find(function(m) { return m.id === editId; });
            if (old) { newPost.likes = old.likes || []; newPost.comments = old.comments || []; }
            momentsData = momentsData.filter(function(m) { return m.id !== editId; });
            momentsData.unshift(newPost);
            delete this.dataset.editId;
            this.textContent = '发表';
        } else {
            momentsData.unshift(newPost);
        }
        saveMomentsData(momentsData);
        renderFeed();
        switchView('viewFeed');
    });

    // ===== 背景 =====
    document.getElementById('coverImg').addEventListener('click', function() { document.getElementById('coverModal').classList.add('show'); });
    document.getElementById('btnSelectFromGallery').addEventListener('click', function() {
        document.getElementById('coverModal').classList.remove('show');
        document.getElementById('coverFileInput').click();
    });
    document.getElementById('btnInputCoverUrl').addEventListener('click', function() {
        document.getElementById('coverModal').classList.remove('show');
        var url = prompt('请输入新背景图的 URL：');
        if (url && url.trim() !== '') {
            var img = new Image();
            img.onload = function() { saveCover(url.trim()); document.getElementById('coverModal').classList.remove('show'); };
            img.onerror = function() { alert('图片加载失败'); };
            img.src = url.trim();
        }
    });
    document.getElementById('btnCloseCoverModal').addEventListener('click', function() { document.getElementById('coverModal').classList.remove('show'); });
    document.getElementById('coverFileInput').addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            compressImage(ev.target.result, 400, function(compressed) {
                saveCover(compressed);
                document.getElementById('coverModal').classList.remove('show');
            });
        };
        reader.readAsDataURL(file);
        this.value = '';
    });

    // ===== 三点菜单 =====
    document.getElementById('btnDetailMore').addEventListener('click', function(e) {
        e.stopPropagation();
        document.getElementById('detailMoreMenu').classList.toggle('show');
    });
    document.addEventListener('click', function() { document.getElementById('detailMoreMenu').classList.remove('show'); });

    document.getElementById('detailEditBtn').addEventListener('click', function() {
        document.getElementById('detailMoreMenu').classList.remove('show');
        var item = momentsData.find(function(m) { return m.id === currentDetailId; });
        if (!item) return;
        document.getElementById('postTextInput').value = item.text || '';
        pendingImages = item.images || [];
        currentPostLocation = item.location || '';
        renderUploadGrid();
        if (currentPostLocation) {
            document.getElementById('labelLocation').textContent = currentPostLocation;
            document.getElementById('locationValue').textContent = currentPostLocation;
        }
        momentsData = momentsData.filter(function(m) { return m.id !== currentDetailId; });
        saveMomentsData(momentsData);
        switchView('viewPost');
        document.getElementById('btnSubmitPost').dataset.editId = currentDetailId;
        document.getElementById('btnSubmitPost').textContent = '保存';
    });

    document.getElementById('detailDeleteBtn').addEventListener('click', function() {
        document.getElementById('detailMoreMenu').classList.remove('show');
        currentDeletingId = currentDetailId;
        document.getElementById('deleteConfirmModal').classList.add('show');
    });

    // ===== 删除确认 =====
    document.getElementById('btnConfirmDelete').addEventListener('click', function() {
        if (currentDeletingId) {
            removeMoment(currentDeletingId);
            momentsData = momentsData.filter(function(m) { return m.id !== currentDeletingId; });
            renderFeed();
            currentDeletingId = null;
            document.getElementById('deleteConfirmModal').classList.remove('show');
            if (document.getElementById('viewDetail').classList.contains('active')) switchView('viewFeed');
            if (document.getElementById('viewPost').classList.contains('active')) switchView('viewFeed');
        }
    });
    document.getElementById('btnCancelDelete').addEventListener('click', function() { currentDeletingId = null; document.getElementById('deleteConfirmModal').classList.remove('show'); });

    // ===== 导航 =====
    document.getElementById('btnBackFromProfile').addEventListener('click', function() { switchView('viewFeed'); });
    document.getElementById('btnBackFromDetail').addEventListener('click', function() { switchView('viewFeed'); });

    // ===== 返回（优先 history.back，保证 chat 页状态完整） =====
    document.getElementById('btnBackToChat').addEventListener('click', function() {
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'nano:closeMoments' }, '*');
                return;
            }
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = 'chat.html';
            }
        } catch(e) {
            window.location.href = 'chat.html';
        }
    });

    // ===== 头像点击 =====
    document.getElementById('userAvatar').addEventListener('click', function() { openProfile(currentUser.name, currentUser.avatar); });
    document.getElementById('userName').addEventListener('click', function() { openProfile(currentUser.name, currentUser.avatar); });

    // ===== 关闭浮层 =====
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.detail-action-popover') && !e.target.closest('#detailMoreActionsBtn')) {
            var pop = document.getElementById('detailActionPopover');
            if (pop) pop.classList.remove('show');
        }
        if (!e.target.closest('.action-popover') && !e.target.closest('.more-action-btn')) {
            document.querySelectorAll('.action-popover').forEach(function(el) { el.classList.remove('show'); });
        }
    });

    document.querySelectorAll('.modal-mask').forEach(function(mask) {
        mask.addEventListener('click', function(e) { if (e.target === mask) mask.classList.remove('show'); });
    });

    // ===== Storage 监听 =====
    window.addEventListener('storage', function(e) {
        if (e.key === MASK_STORAGE_KEY || e.key === HOME_STORAGE_KEY) {
            // 切换了 User 面具：朋友圈按面具隔离，重新加载该面具的内容
            reloadForCurrentMask();
        }
        if (e.key === CONTACT_STORAGE_KEY) {
            boundChars = getUserBindChars();
            contextNPCs = generateContextNPCs();
            allAvailableChars = boundChars.concat(contextNPCs);
        }
        if (e.key && e.key.indexOf('nanoMomentsCover') === 0) { document.getElementById('coverImg').src = getCoverUrl(); syncProfileCover(); hydrateCover(); }
    });

    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'nano:momentsShown') {
            // 每次打开朋友圈：同步当前 User 面具（含 MaskAvatarDB 里的头像）
            refreshCurrentUserFromMask();
            return;
        }
        if (e.data && e.data.type === 'momentsDataUpdated') {
            // 角色在后台自动发了朋友圈：重新拉取数据并刷新列表
            loadMomentsData(function(items) {
                momentsData = items || [];
                try { sanitizeCharInteractions(); } catch (e) {}
                try { renderFeed(); } catch (err) {}
                // 后台/Worker 的主动朋友圈如果只有文案，自动补点赞和评论。
                setTimeout(function () { backfillMissingInteractions(2); }, 1200);
            });
            return;
        }
        if (e.data && e.data.type === 'settingsUpdated') {
            getSettings().then(function (s) {
                settings = s;
                console.log('[设置] 已更新:', settings);
            });
        }
        if (e.data && e.data.type === 'currentMaskChanged') {
            reloadForCurrentMask();
            return;
        }
        if (e.data && (e.data.type === 'contactsDataUpdated' || e.data.type === 'nano:refreshMomentsChars')) {
            loadCharsFromDB().then(function(chars) {
                dbCharsCache = (chars || []).filter(function(c) { return c && c.name; });
                boundChars = getUserBindChars();
                contextNPCs = generateContextNPCs();
                allAvailableChars = boundChars.concat(contextNPCs);
                try { renderFeed(); } catch (err) {}
            });
        }
    });

    // ===== 对外暴露 =====
    window.__generateImage = generateImage;
    window.__getSettings = getSettings;

    window.togglePopover = togglePopover;
    window.handleLike = handleLike;
    window.promptComment = promptComment;
    window.promptReply = promptReply;
    window.triggerPostRefresh = triggerPostRefresh;
    window.openImageViewer = openImageViewer;
    window.openProfile = openProfile;
    window.openDetail = openDetail;
    window.switchView = switchView;
    window.deleteComment = deleteComment;
    window.toggleDetailPopover = function() {
        var pop = document.getElementById('detailActionPopover');
        if (pop) pop.classList.toggle('show');
    };

    // ===== 初始化 / 切换面具后重新加载 =====
    function reloadForCurrentMask() {
        refreshCurrentUserFromMask();
        try { switchView('viewFeed'); } catch (e) {}
        migrateLegacyCover();
        document.getElementById('coverImg').src = getCoverUrl();
        syncProfileCover();
        openDB(function() {
            loadMomentsData(function(items) {
                momentsData = items || [];
                try { sanitizeCharInteractions(); } catch (e) {}
                renderFeed();
                // 首次打开时，给「只有文案、没有任何互动」的动态补上点赞和评论。
                setTimeout(function () { backfillMissingInteractions(3); }, 1800);
            });
        });
    }

    function init() {
        refreshCurrentUserFromMask();
        migrateLegacyCover();
        document.getElementById('coverImg').src = getCoverUrl();
        syncProfileCover();

        getSettings().then(function (s) {
            settings = s;
            console.log('[初始化] 当前设置:', settings);
        });

        // 从角色库加载真实角色（含人设/世界书），供发朋友圈与评论使用
        loadCharsFromDB().then(function(chars) {
            dbCharsCache = (chars || []).filter(function(c) { return c && c.name; });
            boundChars = getUserBindChars();
            contextNPCs = generateContextNPCs();
            allAvailableChars = boundChars.concat(contextNPCs);
            console.log('[Moments] 角色库加载', dbCharsCache.length, '可用角色', allAvailableChars.length);
            try { sanitizeCharInteractions(); } catch (e) {}
            try { renderFeed(); } catch (e) {}
            setTimeout(function () { backfillMissingInteractions(3); }, 1200);
        });

        reloadForCurrentMask();
    }

    init();
})();