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
            dbGetAll(function (items) { normalizeMaskScoped(items, callback); });
        } else {
            try {
                var raw = localStorage.getItem(MOMENTS_STORAGE_KEY);
                if (raw) { normalizeMaskScoped(JSON.parse(raw), callback); return; }
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
        else {
            try {
                var raw = localStorage.getItem(MOMENTS_STORAGE_KEY);
                var arr = raw ? JSON.parse(raw) : [];
                arr = arr.filter(function (m) { return m.id !== id; });
                localStorage.setItem(MOMENTS_STORAGE_KEY, JSON.stringify(arr));
            } catch(e) {}
        }
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
        return !url || String(url).indexOf('data:image/svg+xml') === 0;
    }
    function itemAvatarSrc(item) {
        if (!item) return initialAvatar('?');
        if (normName(item.author) === normName(currentUser.name)) return avatarSrcFor(currentUser.name, currentUser.avatar);
        return isInitialAvatar(item.avatar) ? initialAvatar(item.author) : item.avatar;
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
    var NPC_ROLE_BLACKLIST = /(旅行者|游客|路人|路人甲|陌生人|新朋友|网友|客人|顾客|邻居|同事|同学|老师|医生|护士|警官|警察|司机|阿姨|叔叔|大爷|大妈|女士|先生|小姐|老板|店主|店长|店员|朋友|好友|某人|总裁|助理|前台|保安|服务生|路人角色|NPC|npc)/;

    function isGenericNpcName(name) {
        var n = String(name == null ? '' : name).trim();
        if (!n) return true;
        if (n.length < 2 || n.length > 6) return true;
        if (/^[阿小老]./.test(n)) return true;
        if (NPC_ROLE_BLACKLIST.test(n)) return true;
        return false;
    }

    function rosterKey() { return NPC_ROSTER_PREFIX + currentMaskId(); }
    function rosterSrcKey() { return NPC_ROSTER_PREFIX + 'src_' + currentMaskId(); }
    function loadNpcRoster() {
        try {
            var raw = localStorage.getItem(rosterKey());
            if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
        } catch (e) {}
        return null;
    }
    function loadNpcRosterSrc() {
        try { var raw = localStorage.getItem(rosterSrcKey()); if (raw) { var a = JSON.parse(raw); if (Array.isArray(a)) return a; } } catch (e) {}
        return null;
    }
    function saveNpcRoster(list, charIds) {
        try {
            localStorage.setItem(rosterKey(), JSON.stringify(list || []));
            localStorage.setItem(rosterSrcKey(), JSON.stringify(charIds || []));
        } catch (e) {}
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

    function loadWorldbookText(boundIds) {
        var out = [];
        try {
            var raw = localStorage.getItem('nano_worldbook_data_v5');
            if (raw) {
                var d = JSON.parse(raw); var files = (d && d.files) || [];
                files.forEach(function (f) {
                    if (!f) return;
                    var scope = f.scope || 'global';
                    if (scope === 'local') {
                        var bound = f.boundCharacters || [];
                        if (!bound.some(function (b) { return (boundIds || []).indexOf(b) > -1; })) return;
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

    function buildPersonaBlock(allChars) {
        var lines = [];
        lines.push('【可扮演的角色 / NPC · 必须严格贴人设、不得 OOC】');
        (allChars || []).forEach(function (c) {
            if (!c || !c.name) return;
            lines.push('◇ ' + c.name + (c.gender && c.gender !== '未知' ? ('（' + c.gender + '）') : ''));
            lines.push((c.setting && String(c.setting).trim()) ? String(c.setting).trim().slice(0, 600) : '（暂无详细设定，按名字与语境自然扮演）');
        });
        var ids = (allChars || []).map(function (c) { return c.id; }).filter(Boolean);
        var wb = loadWorldbookText(ids);
        if (wb) lines.push('\n【世界书】\n' + wb);
        return lines.join('\n');
    }

    // ===== API 配置读取（与 api.html 一致：IndexedDB nano_api_db/api_data） =====
    var DEFAULT_SETTINGS = {
        mainApi: '', mainKey: '', mainModel: 'gpt-3.5-turbo', mainTemperature: 0.7,
        subApi: '', subKey: '', subModel: 'gpt-3.5-turbo', subEnabled: false,
        imageApi: '', imageKey: '', imageModel: 'dall-e-3', imageEnabled: false,
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
            mainModel: mainApi.model || 'gpt-3.5-turbo',
            mainTemperature: mainApi.temperature || 0.7,
            subApi: (subApi.enabled ? subApi.url : '') || '',
            subKey: (subApi.enabled ? subApi.key : '') || '',
            subModel: subApi.model || 'gpt-3.5-turbo',
            subEnabled: subApi.enabled || false,
            imageApi: (imageApi.enabled ? imageApi.url : '') || '',
            imageKey: (imageApi.enabled ? imageApi.key : '') || '',
            imageModel: imageApi.model || 'dall-e-3',
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
                mainModel: cfg.mainModel || 'gpt-3.5-turbo',
                mainTemperature: (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : parseFloat(cfg.mainTemp)) || 0.7,
                subApi: cfg.subUrl || '',
                subKey: cfg.subKey || '',
                subModel: cfg.subModel || 'gpt-3.5-turbo',
                subEnabled: !!cfg.subToggle && !!cfg.subUrl,
                imageApi: cfg.imgUrl || '',
                imageKey: cfg.imgKey || '',
                imageModel: cfg.imgModel || 'dall-e-3',
                imageEnabled: !!(cfg.imgUrl && cfg.imgKey),
                imagePositivePrompt: pos,
                imageNegativePrompt: neg
            };
        }

        var legacy = readLegacySettings();
        return legacy || Object.assign({}, DEFAULT_SETTINGS);
    }

    var currentUser = getCurrentMask() || { id: 'm_default', name: '我', avatar: '', bindChars: [] };

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
                if (c && c.bindUser === currentUser.id && !c.nanoAssistant && !c.isNpc) binds.push(c.id);
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
            if (ch && binds.indexOf(ch.id) !== -1) result.push(ch);
        }
        return result.length ? result : dbCharsBoundList();
    }

    // 从角色库(IndexedDB)中得到“绑定/可用”的真实角色（当前 User 绑定的角色）
    function dbCharsBoundList() {
        if (!dbCharsCache || !dbCharsCache.length) return [];
        var boundOnly = dbCharsCache.filter(function(c) { return c && c.name && String(c.bindUser) === String(currentUser && currentUser.id) && !c.isNpc; });
        if (boundOnly.length) return boundOnly.slice();
        return [];
    }

    // NPC：优先用角色库 isNpc 的真实 NPC，其次用按面具生成的「关系人物花名册」
    function dbNpcs() {
        return (dbCharsCache || []).filter(function(c) {
            return c && c.name && c.isNpc && !c.nanoAssistant && !isGenericNpcName(c.name) &&
                String(c.bindUser) === String(currentUser && currentUser.id);
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

    function rosterNpcs() {
        var list = loadNpcRoster() || [];
        return list.filter(function(n) { return n && n.name && !isGenericNpcName(n.name); }).map(function(n) {
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

    function generateContextNPCs() {
        var seen = {}, out = [];
        dbNpcs().concat(rosterNpcs()).forEach(function(n) {
            if (!n || !n.name || seen[n.name]) return;
            seen[n.name] = 1;
            out.push(n);
        });
        return out.slice(0, 8);
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
        var apiUrl = settings.imageApi;
        var apiKey = settings.imageKey;
        var model = settings.imageModel || 'dall-e-3';
        var positivePrompt = settings.imagePositivePrompt || '';
        var negativePrompt = settings.imageNegativePrompt || '';

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
            if (opts && opts.charId) faceRef = charChatSetting(opts.charId, 'faceRef', '') || '';
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
                    if (fit && fit.url) return fit.url;
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
        if (data && data.data && data.data[0] && data.data[0].url) return data.data[0].url;
        if (data && data.images && data.images[0]) return data.images[0];

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
        opts = opts || {};
        var apiUrl, apiKey, model, apiLabel;
        var subReady = settings.subEnabled && settings.subApi && settings.subApi.indexOf('http') === 0;
        var useSub = subReady && opts.apiPref !== 'main';
        if (useSub) {
            apiUrl = settings.subApi;
            apiKey = settings.subKey;
            model = settings.subModel || 'gpt-3.5-turbo';
            apiLabel = '副 API';
        } else {
            apiUrl = settings.mainApi;
            apiKey = settings.mainKey;
            model = settings.mainModel || 'gpt-3.5-turbo';
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
            ? '你是一个真实的人类，正在刷朋友圈。请以第一人称发布一条简短、自然、有生活气息的朋友圈文案，像真人一样分享日常感受、心情或趣事。不超过30个字。不要加引号，不要解释，直接输出文案内容。'
            : '你是一个真实的人类，正在朋友圈评论区互动。请根据动态内容，用自然、口语化的方式发表一条简短评论，像真人一样。不超过20个字。不要加引号，不要解释，直接输出评论内容。');

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
            author.onclick = function() { openProfile(item.author, item.avatar || ''); };
            contentBox.appendChild(author);

            if (item.text) {
                var text = document.createElement('div');
                text.className = 'feed-text';
                text.textContent = item.text;
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
                            left.appendChild(document.createTextNode('：' + c.text));
                        } else {
                            left.appendChild(document.createTextNode('：' + c.text));
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
            var c = { user: currentUser.name, text: text };
            if (toUser) c.toUser = toUser;
            item.comments.push(c);
            saveOneMoment(item);
            renderFeed();
            if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId === id) openDetail(id);
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
            b.split(/\n/).forEach(function (line) {
                line = line.trim();
                if (!line) return;
                var m = line.match(/^(AUTHOR|TEXT|LOCATION|LIKES|COMMENT|MEDIA|IMAGE|作者|文案|地点|点赞|评论|图片|配图|类型)\s*[:：]\s*([\s\S]*)$/i);
                if (!m) {
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
        var key = String(name).replace(/[\s~～!！?？.。]/g, '');
        for (var i = 0; i < allChars.length; i++) {
            var c = allChars[i];
            if (!c || !c.name) continue;
            if (c.name === name || String(c.name).replace(/[\s~～!！?？.。]/g, '') === key) return c;
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

    // 从模型输出里解析点赞名单（只保留名单内的人）
    function parseLikesFromText(raw, allowedNames) {
        var m = String(raw || '').match(/^\s*(?:LIKES|点赞)\s*[:：]\s*(.+)$/im);
        if (!m) return [];
        var names = (allowedNames || []).map(function(n) { return (n && n.name) || n; }).filter(Boolean);
        var seen = {};
        return m[1].split(/[,，、;；\/]/).map(function(s) { return s.trim(); }).filter(function(n) {
            if (!n) return false;
            if (normName(n) === normName(currentUser.name)) return false;
            var hit = names.some(function(a) { return normName(a) === normName(n); });
            if (!hit) return false;
            if (seen[normName(n)]) return false;
            seen[normName(n)] = 1;
            return true;
        });
    }

    function normName(s) {
        return String(s == null ? '' : s).replace(/[\s~～!！?？.。·、,，]/g, '');
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

    // 评论者池
    // - 全部 NPC（关系人物）
    // - 用户自己发的动态：绑定的 char 都可以评论
    // - char 发的动态：只有人设里明确认识的 char 才能评论（其它 char 不越界）
    function buildCommenterPool(author, bound, npcs, isUserPost) {
        var pool = [], seen = {};
        function add(c, kind) {
            if (!c || !c.name) return;
            if (c.name === currentUser.name) return;
            if (seen[c.name]) return;
            seen[c.name] = 1;
            pool.push({ name: c.name, kind: kind });
        }
        (npcs || []).forEach(function(n) { add(n, 'npc'); });
        if (!isUserPost && author && author.name) add(author, 'char');
        (bound || []).forEach(function(c) {
            if (!c || !c.name) return;
            if (!isUserPost && author && (c.id === author.id || c.name === author.name)) return;
            if (isUserPost) add(c, 'char');
            else if (nameMentionedIn(author, c.name)) add(c, 'char');
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

    // 过滤：禁止冒充用户；丢弃花名册之外的路人甲；纠正回复对象（只能回复实际参与过的人）
    function filterCommentList(list, author, bound, npcs, isUserPost, existingUsers) {
        var npcNames = (npcs || []).map(function(c) { return c && c.name; }).filter(Boolean);
        var charNames = (bound || []).map(function(c) { return c && c.name; }).filter(Boolean);
        var rosterNames = charNames.concat(npcNames);

        // 允许的回复对象：作者、用户、已有评论者、本批次里发过评论的人
        var targets = {};
        function addTarget(n) { if (n) targets[normName(n)] = n; }
        if (author && author.name) addTarget(author.name);
        if (currentUser && currentUser.name) addTarget(currentUser.name);
        (existingUsers || []).forEach(addTarget);
        (list || []).forEach(function(c) { if (c && c.user) addTarget(c.user); });

        var kept = (list || []).filter(function(c) {
            if (!c || !c.user) return false;
            if (normName(c.user) === normName(currentUser.name)) return false; // 不允许 AI 冒充用户
            var u = normName(c.user);
            if (npcNames.some(function(n) { return normName(n) === u; })) return true;
            if (author && normName(author.name) === u) return true;
            var isChar = charNames.some(function(n) { return normName(n) === u; });
            if (isChar) {
                if (isUserPost) return true;
                return !!nameMentionedIn(author, c.user);
            }
            return false; // 不在花名册里的名字 → 路人甲，丢弃
        });

        return kept.map(function(c) {
            var text = String(c.text || '').trim();
            var to = c.toUser;
            if (!to) {
                var m = text.match(/^(?:回复|@)\s*([^\s：:，,、]{1,20})\s*[：:，,]?\s*([\s\S]+)$/);
                if (m) { to = m[1].trim(); text = m[2].trim(); }
            }
            // 文本里明确叫了某人 → 以文本为准，避免「回复错人」
            var mentionPool = rosterNames.concat((currentUser && currentUser.name) ? [currentUser.name] : []);
            var mentioned = inferAddressee(text, mentionPool);
            if (mentioned && normName(mentioned) !== normName(c.user)) {
                text = text.replace(new RegExp('^@?\\s*' + mentioned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s，,：:]?'), '');
                if (targets[normName(mentioned)]) to = mentioned;
            }
            var o = { user: c.user, text: text };
            var toAllowed = !!to && normName(to) !== normName(c.user);
            if (toAllowed) {
                if (normName(to) === normName(currentUser.name)) {
                    o.toUser = currentUser.name; // 回复用户
                } else if (charNames.some(function(n) { return normName(n) === normName(to); })) {
                    var isTarget = !!targets[normName(to)];
                    if (!isTarget) toAllowed = false;
                    if (toAllowed && !isUserPost && !(author && normName(author.name) === normName(to))) {
                        toAllowed = !!nameMentionedIn(author, to);
                    }
                    if (toAllowed) o.toUser = to;
                } else if (npcNames.some(function(n) { return normName(n) === normName(to); })) {
                    // NPC 只回复实际参与过的人（点赞的人不算）
                    if (targets[normName(to)]) o.toUser = to;
                }
            }
            return o;
        });
    }

    // ===== 生成 NPC 花名册（依据 char / user 人设、世界书推断真实关系人物） =====
    async function generateNpcRoster(chars) {
        var persona = buildPersonaBlock(chars);
        var system = '你是一个世界观设定助手，只负责根据角色人设与世界书，推断与该角色/用户有现实社会关系的具体人物（朋友、同学、同事、家人、邻居等）。必须给出真实感强的完整姓名，严禁使用「旅行者、咖啡店老板、新朋友、路人、X女士、阿明」这类通用占位称呼。';
        var userMsg = persona +
            '\n\n请列出 4~6 个与上面这些角色或用户本人真实相识的具体人物（他们可能是同事/同学/朋友/家人/邻居/合作方等），供朋友圈互动使用。\n' +
            '要求：\n' +
            '- 每个名字必须是现实中正常的完整姓名（如「李思雨」「刘媛」「陈子豪」），不要用职业或关系当名字；\n' +
            '- 必须贴合上面的世界观与人设，说明 TA 与哪个角色、什么关系；\n' +
            '- 不要与上面已有的角色重名。\n\n' +
            '严格输出 JSON 数组（不要 markdown、不要解释），格式：\n' +
            '[{"name":"李思雨","relation":"XX的大学同学","setting":"一句话性格与背景","gender":"女"}]';

        var raw = await fetchAIResponse(userMsg, false, { apiPref: 'sub', system: system, maxTokens: 700, temperature: 0.85 });
        var list = parseNpcRoster(raw, chars);
        var ids = (chars || []).map(function(c) { return String((c && (c.id || c.name)) || ''); }).filter(Boolean);
        if (list.length) saveNpcRoster(list, ids);
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
            var name = String(n.name || '').trim();
            if (isGenericNpcName(name)) return;
            if (block.some(function(b) { return normName(b) === normName(name); })) return;
            out.push({
                id: 'npc_' + normName(name),
                name: name,
                relation: String(n.relation || '').trim(),
                setting: String(n.setting || '').trim(),
                gender: String(n.gender || '').trim()
            });
        });
        return out;
    }

    // ===== 刷新单条动态评论（AI 生成，调用一次副 API，未配置则主 API） =====
    window.triggerPostRefresh = async function(id, boundOverride, npcsOverride) {
        var item = momentsData.find(function(m) { return m.id === id; });
        if (!item) return;

        showMomentsLoading('正在生成评论…');
        window.__momentsGenerating = true;
        try {
            settings = await getSettings();

            var bound = ((boundOverride && boundOverride.length) ? boundOverride : getUserBindChars())
                .filter(function(c) { return c && c.name && !c.isNpc && !c.nanoAssistant; });
            var npcs = (npcsOverride && npcsOverride.length) ? npcsOverride : generateContextNPCs();
            // 没有朋友（NPC）花名册时先生成一份，保证评论区能刷出 NPC 互动
            if (!npcs.length && !(npcsOverride && npcsOverride.length) && bound.length) {
                try { await generateNpcRoster(bound); npcs = generateContextNPCs(); } catch (e) {}
            }
            var isUserPost = normName(item.author) === normName(currentUser.name);
            var authorNpc = findNpcByName(npcs, item.author);
            var authorChar = findCharByName(bound, item.author) ||
                (authorNpc ? { id: authorNpc.id, name: authorNpc.name, setting: authorNpc.setting, relation: authorNpc.relation } : null);

            if (!isUserPost && !authorChar && npcs.length === 0) {
                showApiError({
                    type: 'text', stage: 'config',
                    reason: '没有可用角色',
                    hint: '联系人或绑定角色为空，无法生成评论。请先在主页添加角色或绑定角色。'
                });
                return;
            }

            var persona = buildPersonaBlock(bound.concat(npcs));
            var pool = buildCommenterPool(authorChar, bound, npcs, isUserPost);
            if (!pool.length) {
                showApiError({
                    type: 'text', stage: 'config',
                    reason: '没有可用角色',
                    hint: '请先绑定角色，或在刷新朋友圈时生成朋友名单，再来生成评论。'
                });
                return;
            }
            var existing = (item.comments || []).map(fmtCommentLine).join('\n');
            var userComments = (item.comments || []).filter(function(c) { return normName(c.user) === normName(currentUser.name); });
            var hasUserComment = userComments.length > 0;

            var system = '你是一个真实的人类，请同时扮演多个角色以及他们的朋友，在朋友圈评论区自然地聊天。严格贴合各自人设、关系与世界书，保持活人感，绝不 OOC，禁止 AI 腔，禁止解释，禁止出戏。';
            var charNamesForPrompt = (bound || []).map(function(c) { return c && c.name; }).filter(Boolean).join('、');
            var userMsg = persona +
                '\n\n【本动态可以出现的评论者（只能使用这些名字，不要创造新名字）】\n' + pool.map(function(c) { return '· ' + c.name; }).join('\n') +
                '\n\n【这条朋友圈】\n作者：' + (item.author || '') + '\n内容：' + (item.text || '') +
                (existing ? ('\n已有评论（可接着聊）：\n' + existing) : '') +
                (hasUserComment ? ('\n【用户本人的评论（必须有人回复 TA）】\n' + userComments.map(function(c) { return '用户：' + c.text; }).join('\n')) : '') +
                '\n\n请生成 4~5 条新的评论互动：\n' +
                '- 评论者只能从上面的名字里选，名字原样使用；\n' +
                (isUserPost && charNamesForPrompt ? ('- 这条是用户本人发的动态，所有角色都认识用户：点赞名单里必须包含全部角色（' + charNamesForPrompt + '），并且至少 2 位角色要发表评论；\n') : '') +
                (hasUserComment ? ('- 必须至少 1 条回复用户本人（回复对象写「' + (currentUser.name || '用户') + '」），自然接住 TA 说的话；\n') : '') +
                '- 回复对象必须是这条动态下真正发过言的人（动态作者或评论区里出现过的人），不要回复只点赞的人；\n' +
                '- 每条评论的内容要和「回复对象」一致，不要张冠李戴；\n' +
                '- 其余评论在角色与朋友之间互相接话、调侃、附和，符合各自人设与关系；\n' +
                '- 严禁以用户身份发言、点赞或评论；\n' +
                '- 每条不超过 25 字，口语化，像真人。\n' +
                '- 另外给出 3~6 个点赞者的名字，只能从上面的名单里选。\n\n' +
                '严格按下面格式输出（不要编号、不要解释）：\n' +
                'LIKES: 名字1,名字2\n' +
                '评论者|回复对象|内容\n' +
                '（不是回复别人时第二段留空，写成「评论者||内容」；回复他人时必须写出对方名字）';

            var raw;
            try {
                raw = await fetchAIResponse(userMsg, false, { apiPref: 'sub', system: system, maxTokens: isUserPost ? 900 : 700, temperature: 0.9 });
            } catch (err) {
                showApiError(err);
                return;
            }

            var newLikes = parseLikesFromText(raw, pool);
            var rawForComments = String(raw || '').replace(/^\s*(?:LIKES|点赞)\s*[:：].*$/gim, '');
            var parsed = filterCommentList(parseCommentLines(rawForComments), authorChar, bound, npcs, isUserPost, (item.comments || []).map(function(c) { return c.user; }));
            if (!parsed.length && !newLikes.length) {
                showApiError({
                    type: 'text', stage: 'parse',
                    reason: '没有解析到有效的评论内容',
                    responseBody: String(raw || '').slice(0, 800),
                    hint: '模型没有按「评论者|回复对象|内容」格式输出，或使用了花名册以外的名字。请重试或更换模型。'
                });
                return;
            }

            if (!item.likes) item.likes = [];
            newLikes.forEach(function(n) {
                if (!item.likes.some(function(x) { return normName(x) === normName(n); })) item.likes.push(n);
            });
            // 用户本人发的动态：所有绑定 char 都与用户认识，保证都出现在点赞里
            if (isUserPost) {
                (bound || []).forEach(function(c) {
                    if (!c || !c.name) return;
                    if (!item.likes.some(function(x) { return normName(x) === normName(c.name); })) item.likes.push(c.name);
                });
            }

            if (!item.comments) item.comments = [];
            parsed.slice(0, 6).forEach(function(c) { item.comments.push(c); });
            saveOneMoment(item);
            renderFeed();
            if (document.getElementById('viewDetail').classList.contains('active') && currentDetailId === id) openDetail(id);
        } finally {
            hideMomentsLoading();
            window.__momentsGenerating = false;
            try { if (window.parent !== window) window.parent.postMessage({ type: 'NANO_GEN_NOTIFY', title: '朋友圈已更新', body: '新动态生成完成' }, '*'); } catch (e) {}
        }
    };

    // ===== 全局刷新：先选要生成哪些 char（弹窗），再在此基础上补 NPC =====
    document.getElementById('btnRefreshGlobal').addEventListener('click', function() {
        var bound = getUserBindChars().filter(function(c) { return c && c.name && !c.isNpc; });
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
        var persona = buildPersonaBlock((chars || []).concat(npcs || []));
        var total = opts.total || (3 + Math.floor(Math.random() * 2)); // 一次生成 3~4 条
        var lines = [];
        lines.push('请一次性生成 ' + total + ' 条朋友圈动态，每条自带点赞和评论互动，像真人随手发的日常：');
        if (opts.onlyChars) {
            lines.push('- 发布者从上面的已选角色里挑，尽量不同的人各发一条，名字原样使用；');
        } else {
            lines.push('- 发布者从上面所有名字里挑 ' + total + ' 个尽量不同的人：大部分是已选角色，也可以有朋友（NPC）；不要总是同一个人发；名字原样使用；');
        }
        lines.push('- 内容是活人发的日常，别一板一眼：会有吐槽、碎碎念、吃到好吃的、遇到无语的人、和谁一起的瞬间、路边看到的风景……可以有 emoji、口语、网络用语；长度不一，有的就一句话，有的三五句，20~60 字为主；');
        lines.push('- 一部分是「配图动态」：MEDIA 写 image，并写 IMAGE 描述这张照片拍的是什么（吃的 / 风景 / 宠物 / 牵手 / 自拍等日常照）；其余是纯文字，MEDIA 写 text；这 ' + total + ' 条里至少 1 条 image、至少 1 条 text（除非只要求 1 条）；');
        lines.push('- 每条动态配 2~5 条评论，评论者只能从上面的名字里选，按各自人设与关系自然互动（说笑、抬杠、关心、接梗、互相回复都行）；');
        lines.push('- 只有明确认识、有关系的角色才会在同一条动态下互动，不要硬凑；名字必须原样使用名单里的名字；');
        lines.push('- 每条动态尽量都有人点赞：LIKES 写名字（从名单里选，不得包含用户）；');
        lines.push('- 评论者回复别人时写成「评论者|回复对象|内容」，不是回复则写成「评论者||内容」；');
        lines.push('- 严禁以用户身份发动态、点赞或评论；');
        lines.push('- 每条评论不超过 25 字。');
        return persona +
            '\n\n【最近的朋友圈（可延续话题，别重复）】\n' + (recent || '（暂无）') +
            '\n\n' + lines.join('\n') +
            '\n\n严格按下面格式输出（不要 markdown、不要编号、不要多余解释）：\n' +
            '===MOMENT===\nAUTHOR: 名字\nMEDIA: image 或 text\nIMAGE: 若 MEDIA=image，写这句照片拍的是什么（如：融化的草莓冰淇淋特写）；纯文字留空\nTEXT: 文案\nLOCATION: 地点（可留空）\nLIKES: 名字1,名字2（可留空，不得包含用户）\nCOMMENT: 评论者|回复对象|内容\nCOMMENT: 评论者||内容\n\n（下一条动态重复 ===MOMENT=== 结构）';
    }

    async function requestPosts(chars, npcs, wantNpcCount, recent, opts) {
        var system = '你是一个真实的人类，请同时扮演下面列出的角色以及他们的朋友，发布日常朋友圈并自然地互相点赞、评论互动。严格贴合各自人设、彼此关系与世界书，保持活人感与生活气息，绝不 OOC，禁止 AI 腔，禁止解释，禁止出戏。';
        var userMsg = buildPostsPrompt(chars, npcs, wantNpcCount, recent, opts);
        var raw = await fetchAIResponse(userMsg, true, { apiPref: 'main', system: system, maxTokens: 2600, temperature: 0.95 });
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

            var boundAll = getUserBindChars().filter(function(c) { return c && c.name && !c.isNpc; });
            var selected = boundAll.filter(function(c) {
                return !selectedIds || !selectedIds.length || selectedIds.indexOf(String(c.id || c.name)) !== -1;
            });
            if (!selected.length) selected = boundAll.slice();

            // NPC 花名册：没有、或所选 char 变化了就重新依据人设/世界书生成
            var npcs = generateContextNPCs();
            var srcNow = selected.map(function(c) { return String(c.id || c.name); }).sort().join('|');
            var srcOld = (loadNpcRosterSrc() || []).slice().sort().join('|');
            var needRoster = !npcs.length || (!!srcOld && srcOld !== srcNow);
            if (needRoster) {
                try { await generateNpcRoster(selected); } catch (e) { console.warn('NPC 花名册生成失败', e); }
                npcs = generateContextNPCs();
            }

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

            var npcPostCount = 1 + Math.floor(Math.random() * 2);
            var parsed;
            try {
                parsed = await requestPosts(selected, npcs, npcPostCount, recent, {});
            } catch (err) {
                showApiError(err);
                try { if (window.NanoRefresh) NanoRefresh.fail(err, { key: 'moments' }); } catch (e) {}
                return;
            }

            // 覆盖不足时补生成一次，尽量保证至少 2 位已选角色都有动态
            if (selected.length >= 2) {
                var covered = {};
                parsed.forEach(function(p) { var c = findCharByName(selected, p.author); if (c) covered[normName(c.name)] = 1; });
                if (Object.keys(covered).length < Math.min(2, selected.length)) {
                    var missing = selected.filter(function(c) { return !covered[normName(c.name)]; });
                    try {
                        var more = await requestPosts(missing, [], 0, recent, { onlyChars: true, total: Math.min(Math.max(missing.length, 1), 2) });
                        parsed = parsed.concat(more);
                    } catch (e) {}
                }
            }

            if (!parsed.length) {
                showApiError({
                    type: 'text', stage: 'parse',
                    reason: '没有解析到朋友圈动态',
                    hint: '模型没有按 ===MOMENT=== 格式输出，请重试或更换模型。'
                });
                return;
            }

            var newPosts = [];
            for (var i = 0; i < parsed.length; i++) {
                var p = parsed[i];
                if (!p.author || normName(p.author) === normName(currentUser.name)) continue;
                var ch = findCharByName(selected, p.author);
                var np = findNpcByName(npcs, p.author);
                if (!ch && !np) continue; // 丢弃花名册以外的路人甲
                var cn = ch ? ch.name : np.name;
                var ca = (ch && ch.avatar) ? ch.avatar : ((np && np.avatar) ? np.avatar : '');
                var authorObj = ch || { id: np.id, name: np.name, setting: np.setting, relation: np.relation };

                var likes = (p.likes || []).map(function(n) {
                    if (!n || normName(n) === normName(currentUser.name)) return null;
                    var lc = findCharByName(selected, n);
                    if (lc) return lc.name;
                    var ln = findNpcByName(npcs, n);
                    if (ln) return ln.name;
                    return null;
                }).filter(Boolean);

                var comments = filterCommentList(p.comments || [], authorObj, selected, npcs, false).slice(0, 6);

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
                            if (genUrl) { cp.images = [genUrl]; cp.genPrompt = promptText; cp.media = 'image'; madeCount++; needForce = false; }
                        } catch (e) {}
                    }
                }
            }

            // 兜底互动：模型偶尔只写文案不写 LIKES/COMMENT，保证刷新出来的动态不是空评论区。
            var poolNames = selected.concat(npcs).filter(function(n) { return n && n.name; }).map(function(n) { return n.name; });
            var canned = ['这条也太真实了', '哈哈哈哈', '我也想去', '注意休息呀', '好看', '下次带我'];
            newPosts.forEach(function(p, pi) {
                var others = poolNames.filter(function(n) { return n !== p.author; });
                if (!others.length) return;
                if (!p.likes || !p.likes.length) p.likes = others.slice(0, Math.min(2, others.length));
                if (!p.comments || !p.comments.length) {
                    p.comments = [{ user: others[0], toUser: '', text: canned[(pi + String(p.author || '').length) % canned.length] }];
                }
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
            try { await window.triggerPostRefresh(todo[i].id, selected, npcs); } catch (e) {}
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
                textDiv.textContent = m.text || '';
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
        if (item.text) html += '<div class="detail-text">' + item.text + '</div>';
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
                    html += '：' + c.text + '</span>';
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
                try { renderFeed(); } catch (err) {}
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
                renderFeed();
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
            try { renderFeed(); } catch (e) {}
        });

        reloadForCurrentMask();
    }

    init();
})();