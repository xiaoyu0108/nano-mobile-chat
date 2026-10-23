// ========== 工具 ==========

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function $(id) { return document.getElementById(id); }

function blobBytes(str) {
    try { return new Blob([str]).size; } catch (e) { return str ? str.length : 0; }
}
function utf16Bytes(str) { return str ? str.length * 2 : 0; }

// ========== App 分类注册表 ==========
// 每个 App 声明自己占用的 localStorage 前缀与 IndexedDB（库/表/键前缀）。
// 未匹配到任何 App 的数据统一计入「其他」，保证所有占用都被统计。

const APP_CATEGORIES = [
    {
        id: 'chat', label: '单聊', color: '#007aff',
        ls: ['chat_messages_', 'chat_setting_', 'chat_reply_pending_', 'chat_req_', 'chat_api_result_', 'chat_cleared_', 'nano_pinned_data', 'nano_cot_presets', 'nano_moment_img_round_', 'nano_auto_pending_msgs'],
        idb: [
            { db: 'localforage', store: 'keyvaluepairs', key: ['chat_messages_', 'chat_setting_'] },
            { db: 'nano_vector_memory_db', store: 'chat_messages' },
            { db: 'nano_vector_memory_db', store: 'chat_state' }
        ]
    },
    {
        id: 'group', label: '群聊', color: '#34c759',
        ls: ['group_data_', 'group_msgs_', 'group_settings_', 'group_bg_', 'group_req_', 'group_reply_pending_', 'group_pending_changes_', 'group_api_result_', 'group_mem_tick_', 'group_summary_state_', 'group_invites', 'nano_groups_data', 'nano_group_create_count', 'nano_group_settings'],
        idb: [{ db: 'nano_groups_db' }]
    },
    {
        id: 'offline', label: '线下', color: '#ff9500',
        ls: ['offline_', 'offline-'],
        idb: [{ db: 'MeetSettingsDB' }]
    },
    {
        id: 'moments', label: '朋友圈', color: '#5856d6',
        ls: ['nano_moments_data', 'nanoMomentsCover', 'nano_moments_npcs_'],
        idb: [{ db: 'NanoMomentsDB' }, { db: 'NanoMomentsCoverDB' }]
    },
    {
        id: 'worldbook', label: '世界书', color: '#af52de',
        ls: ['nano_worldbook_data', 'peach_worldbook_data'],
        idb: [{ db: 'nano_worldbook_db' }]
    },
    {
        id: 'books', label: '图书', color: '#4a6fa5',
        ls: ['bookReaderSetting'],
        idb: [{ db: 'BookReaderDB' }]
    },

    {
        id: 'music', label: '音乐', color: '#ff2d55',
        ls: ['nano_music_', 'nano_netease_', 'nano_listen_notice_'],
        idb: [{ db: 'nano_music_db' }]
    },
    {
        id: 'ins', label: 'Ins', color: '#ff6482',
        ls: ['nano_ins_'],
        idb: [{ db: 'nano_ins_db' }]
    },
    {
        id: 'emoji', label: '表情包', color: '#ffcc00',
        ls: ['nano_emoji_data', 'peach_home_data'],
        idb: [{ db: 'nano_api_db', store: 'emoji_data' }]
    },
    {
        id: 'character', label: '角色与头像', color: '#00c7be',
        ls: ['nano_mask_data', 'nano_home_data'],
        idb: [{ db: 'nano_characters_db' }, { db: 'MaskAvatarDB' }, { db: 'nano_mask_db' }]
    },
    {
        id: 'memory', label: '记忆', color: '#30b0c7',
        ls: [],
        idb: [
            { db: 'nano_vector_memory_db', store: 'memories' },
            { db: 'nano_vector_memory_db', store: 'config' }
        ]
    },
    {
        id: 'imessage', label: 'iMessage', color: '#34c759',
        ls: ['nano_imessage_', 'chat_setting_imessageRead_'],
        idb: [{ db: 'nano_imessage_db' }]
    },
    {
        id: 'call', label: '通话', color: '#5ac8fa',
        ls: ['voice_call_seconds_', 'nano_call_active_'],
        idb: [{ db: 'voice_call_records_db' }, { dbPrefix: 'voice_call_', store: 'messages' }]
    },
    {
        id: 'wallet', label: '钱包', color: '#ffd60a',
        ls: [],
        idb: [{ db: 'nano_wallet_db' }]
    },
    {
        id: 'favorite', label: '收藏', color: '#ff9f0a',
        ls: ['nano_favorite'],
        idb: [{ db: 'nano_api_db', store: 'favorite_data' }]
    },
    {
        id: 'api', label: 'API 设置', color: '#64d2ff',
        ls: ['nano_api_'],
        idb: [{ db: 'nano_api_db', store: 'api_data' }]
    },
    {
        id: 'beautify', label: '美化', color: '#bf5af2',
        ls: ['beautify_'],
        idb: [{ db: 'BeautifyAppDB' }]
    },
    {
        id: 'market', label: '共享集市', color: '#ff9f0a',
        ls: ['market_owned', 'market_liked', 'market_user', 'nano_market_'],
        idb: [{ db: 'NanoMarketDB' }]
    },
    {
        id: 'mcp', label: 'MCP', color: '#5e5ce6',
        ls: ['nano_mcp_', 'nano_peek_', 'nano_push_'],
        idb: []
    },
    {
        id: 'fanfic', label: '同人文', color: '#8b5cf6',
        ls: ['nano_fanfic_'],
        idb: []
    },
    {
        id: 'cycle', label: '月潮', color: '#e05a7a',
        ls: ['nano_cycle_'],
        idb: []
    },
    {
        id: 'friend', label: '好友申请', color: '#2f9e8f',
        ls: ['nano_friend_requests', 'nano_meet_', 'nano_chat_inject_'],
        idb: []
    },
    {
        id: 'family', label: '亲属卡', color: '#f08a3c',
        ls: ['nano_family_cards_'],
        idb: []
    },
    {
        id: 'appstore', label: 'App Store', color: '#4a6cf7',
        ls: [],
        idb: [{ db: 'nano_appstore_db' }]
    },
    {
        id: 'mall', label: '商城', color: '#111111',
        ls: ['nano_mall_data_'],
        idb: []
    },
    {
        id: 'halo', label: 'Halo', color: '#5e5ce6',
        ls: ['nanoName', 'nanoHandle', 'nanoSignature', 'nanoCover', 'nanoAvatar', 'nanoAvatarImg', 'nanoAliases', 'nanoDark', 'nanoHaloFallback_v1', 'nanoHaloActiveAlias'],
        idb: [{ db: 'nano_halo_db' }]
    },
    {
        id: 'couple', label: '情侣空间', color: '#ff375f',
        ls: ['cs_api_'],
        idb: [{ db: 'NanoCoupleSpaceV10' }]
    },
    {
        id: 'phone', label: '手机', color: '#a2845e',
        ls: ['glass_phone_'],
        idb: [{ db: 'check_phone_db' }]
    },
    {
        id: 'user', label: '用户资料', color: '#8e8e93',
        ls: ['user_name_data', 'user_avatar_data', 'nano_contacts_data', 'nano_settings_data'],
        idb: [{ db: 'nano_user_db' }]
    },
    {
        id: 'pomodoro', label: '番茄钟', color: '#ff7a59',
        ls: ['pomodoro_', 'nano_pomodoro'],
        idb: []
    },
    {
        id: 'qa', label: 'Q&A', color: '#5ac8fa',
        ls: ['nano_qa_', 'nano_qb_', 'qb4_'],
        idb: []
    },
    {
        id: 'nano', label: '纳米', color: '#2c2c2e',
        ls: ['nano_files_', 'nano_gallery_', 'nano_assistant_', 'nano_takeover_'],
        idb: [{ db: 'nano_files_db' }]
    },
    {
        id: 'system', label: '系统与通知', color: '#aeaeb2',
        ls: ['nano_notify_', 'nano_keep_alive', 'nano_chat_activity', 'nano_unread_counts', 'nano_chat_menu', 'nano_pending_', 'nanoApiBall'],
        idb: [{ db: 'nano_chat_menu_db' }, { db: 'NanoVoiceDB' }]
    }
];

const OTHER_CATEGORY = { id: 'other', label: '其他', color: '#c7c7cc' };
const IMAGE_CATEGORY = { id: 'images', label: '图片', color: '#ff3b30' };

// ========== 图片容器（生成的图片 / 发送的图片，不含头像、背景、封面、表情） ==========

const IMAGE_LS_CONTAINERS = [
    { prefix: 'chat_messages_', owner: 'chat' },
    { prefix: 'group_msgs_', owner: 'group' },
    { exact: 'nano_moments_data', owner: 'moments' },
    { prefix: 'nano_ins_chat_', owner: 'ins' }
];

const IMAGE_IDB_CONTAINERS = [
    { db: 'localforage', store: 'keyvaluepairs', key: ['chat_messages_'], owner: 'chat' },
    { db: 'nano_vector_memory_db', store: 'chat_messages', owner: 'chat' },
    { db: 'nano_groups_db', store: 'kv', key: ['group_msgs_'], owner: 'group' },
    { db: 'NanoMomentsDB', store: 'moments', owner: 'moments' },
    { db: 'nano_ins_db', store: 'state', owner: 'ins' },
    { db: 'nano_imessage_db', store: 'chats', owner: 'imessage' },
    { db: 'MeetSettingsDB', store: 'messages', owner: 'offline' },
    { dbPrefix: 'voice_call_', store: 'messages', owner: 'call' }
];

// 头像 / 背景 / 封面 / 表情等图片一律不纳入「图片」清理范围
const IMAGE_SKIP_KEY_RE = /avatar|cover|background|bgimage|bg_|_bg|emoji|icon|placeholder|thumb/i;

function isRealImageString(s) {
    return typeof s === 'string' && /^data:image\/(?!svg)/i.test(s);
}

function lsImageOwner(key) {
    if (typeof key !== 'string') return null;
    for (const c of IMAGE_LS_CONTAINERS) {
        if (c.exact && key === c.exact) return c.owner;
        if (c.prefix && key.indexOf(c.prefix) === 0) return c.owner;
    }
    return null;
}

function idbImageOwner(db, store, key, ignoreKey) {
    for (const c of IMAGE_IDB_CONTAINERS) {
        if (c.dbPrefix) {
            if (!db || db.indexOf(c.dbPrefix) !== 0) continue;
        } else if (c.db && db !== c.db) continue;
        if (c.store && store !== c.store) continue;
        if (!ignoreKey && c.key) {
            if (typeof key !== 'string' || !c.key.some((p) => key.indexOf(p) === 0)) continue;
        }
        return c.owner;
    }
    return null;
}

// 递归统计 / 清除值中的图片数据。encode 决定字节计量方式（localStorage 为 UTF-16）。
function sanitizeImages(value, encode, out) {
    if (isRealImageString(value)) {
        if (out) out.bytes += encode(value);
        return { value: null, changed: true };
    }
    if (typeof value === 'string') {
        const first = value.charAt(0);
        if (first === '{' || first === '[') {
            try {
                const parsed = JSON.parse(value);
                const r = sanitizeImages(parsed, encode, out);
                if (r.changed) return { value: JSON.stringify(r.value), changed: true };
            } catch (e) { /* 非 JSON，按普通字符串处理 */ }
        }
        return { value: value, changed: false };
    }
    if (Array.isArray(value)) {
        let changed = false;
        const arr = value.slice();
        for (let i = 0; i < arr.length; i++) {
            const r = sanitizeImages(arr[i], encode, out);
            if (r.changed) { arr[i] = r.value; changed = true; }
        }
        return { value: changed ? arr : value, changed: changed };
    }
    if (value && typeof value === 'object') {
        if (typeof Blob !== 'undefined' && value instanceof Blob) {
            if (/^image\//i.test(value.type || '')) {
                if (out) out.bytes += (value.size || 0);
                return { value: null, changed: true };
            }
            return { value: value, changed: false };
        }
        if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
            return { value: value, changed: false };
        }
        if (value instanceof Date) return { value: value, changed: false };
        let changed = false;
        const obj = Object.assign({}, value);
        for (const k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
            if (IMAGE_SKIP_KEY_RE.test(k)) continue;
            const r = sanitizeImages(obj[k], encode, out);
            if (r.changed) { obj[k] = r.value; changed = true; }
        }
        return { value: changed ? obj : value, changed: changed };
    }
    return { value: value, changed: false };
}

// ========== 分类匹配 ==========

function classifyLs(key) {
    if (typeof key !== 'string') return 'other';
    for (const cat of APP_CATEGORIES) {
        for (const p of cat.ls) {
            if (key === p || key.indexOf(p) === 0) return cat.id;
        }
    }
    return 'other';
}

function classifyIdb(db, store, key) {
    for (const cat of APP_CATEGORIES) {
        for (const rule of cat.idb) {
            if (rule.dbPrefix) {
                if (!db || db.indexOf(rule.dbPrefix) !== 0) continue;
            } else if (rule.db && db !== rule.db) continue;
            if (rule.store && store !== rule.store) continue;
            if (rule.key) {
                if (typeof key !== 'string' || !rule.key.some((p) => key.indexOf(p) === 0)) continue;
            }
            return cat.id;
        }
    }
    return 'other';
}

// ========== 估算 ==========

function estimateValueSize(v) {
    if (v == null) return 0;
    const t = typeof v;
    if (t === 'string') return blobBytes(v);
    if (t === 'number') return 8;
    if (t === 'boolean') return 4;
    if (typeof Blob !== 'undefined' && v instanceof Blob) return v.size || 0;
    if (typeof ArrayBuffer !== 'undefined') {
        if (v instanceof ArrayBuffer) return v.byteLength || 0;
        if (ArrayBuffer.isView(v)) return v.byteLength || 0;
    }
    try { return blobBytes(JSON.stringify(v)); } catch (e) { return 0; }
}

/** 可用配额：实际浏览器 / 网站可占用的存储空间 */
let currentQuota = 0;

async function detectQuota() {
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const est = await navigator.storage.estimate();
            if (est.quota && est.quota > 0) currentQuota = est.quota;
        } catch (e) { /* 忽略 */ }
    }
    return currentQuota;
}

// ========== IndexedDB 通用工具 ==========
function idbOpen(name, version) {
    return new Promise((resolve) => {
        try {
            const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch (e) { resolve(null); }
    });
}
function txDone(tx) {
    return new Promise((resolve) => { tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); });
}
function deleteDb(name) {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
        } catch (e) { resolve(); }
    });
}
async function listDbInfos() {
    try {
        if (indexedDB && indexedDB.databases) return await indexedDB.databases();
    } catch (e) {}
    return [];
}

function idbGetAllKeys(store) {
    return new Promise((resolve) => {
        try {
            const r = store.getAllKeys();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    });
}
function idbGet(store, key) {
    return new Promise((resolve) => {
        try {
            const r = store.get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
    });
}

// ========== 全量扫描（按 App 归类） ==========

async function scanStorage() {
    const apps = {};
    APP_CATEGORIES.forEach((c) => { apps[c.id] = 0; });
    apps[OTHER_CATEGORY.id] = 0;
    apps[IMAGE_CATEGORY.id] = 0;
    let total = 0;

    // localStorage
    const lsCount = (function () { try { return localStorage.length; } catch (e) { return 0; } })();
    for (let i = 0; i < lsCount; i++) {
        const k = localStorage.key(i);
        if (k == null) continue;
        const v = localStorage.getItem(k) || '';
        const size = (k.length + v.length) * 2;
        total += size;

        const owner = classifyLs(k);
        let img = 0;
        if (lsImageOwner(k)) {
            const out = { bytes: 0 };
            sanitizeImages(v, utf16Bytes, out);
            img = out.bytes;
        }
        apps[owner] = (apps[owner] || 0) + Math.max(0, size - img);
        apps[IMAGE_CATEGORY.id] += img;
    }

    // IndexedDB
    const dbs = await listDbInfos();
    for (const info of dbs) {
        if (!info || !info.name) continue;
        const db = await idbOpen(info.name);
        if (!db) continue;
        const stores = Array.from(db.objectStoreNames);
        for (const storeName of stores) {
            let store;
            try { store = db.transaction(storeName, 'readonly').objectStore(storeName); } catch (e) { continue; }
            const keys = await idbGetAllKeys(store);
            for (const key of keys) {
                const val = await idbGet(store, key);
                const size = estimateValueSize(val);
                total += size;

                const owner = classifyIdb(info.name, storeName, key);
                let img = 0;
                if (idbImageOwner(info.name, storeName, key)) {
                    const out = { bytes: 0 };
                    sanitizeImages(val, blobBytes, out);
                    img = out.bytes;
                }
                apps[owner] = (apps[owner] || 0) + Math.max(0, size - img);
                apps[IMAGE_CATEGORY.id] += img;
            }
        }
        db.close();
    }

    return { apps: apps, total: total };
}

// ========== 按 App 清理 ==========

async function idbDeleteWhere(predicate) {
    const dbs = await listDbInfos();
    for (const info of dbs) {
        if (!info || !info.name) continue;
        const db = await idbOpen(info.name);
        if (!db) continue;
        const stores = Array.from(db.objectStoreNames);
        if (!stores.length) { db.close(); continue; }
        const tx = db.transaction(stores, 'readwrite');
        for (const storeName of stores) {
            const store = tx.objectStore(storeName);
            const keys = await idbGetAllKeys(store);
            keys.forEach((k) => {
                if (predicate(info.name, storeName, k)) {
                    try { store.delete(k); } catch (e) {}
                }
            });
        }
        await txDone(tx);
        db.close();
    }
}

async function clearCategoryData(id) {
    if (id === IMAGE_CATEGORY.id) return clearImageData();

    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k != null && classifyLs(k) === id) keys.push(k);
    }
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });

    await idbDeleteWhere((db, store, key) => classifyIdb(db, store, key) === id);
}

async function clearImageData() {
    // localStorage 容器
    const lsKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k != null && lsImageOwner(k)) lsKeys.push(k);
    }
    lsKeys.forEach((k) => {
        const raw = localStorage.getItem(k);
        if (raw == null) return;
        const out = { bytes: 0 };
        const r = sanitizeImages(raw, utf16Bytes, out);
        if (r.changed) {
            try { localStorage.setItem(k, typeof r.value === 'string' ? r.value : JSON.stringify(r.value)); } catch (e) {}
        }
    });

    // IndexedDB 容器
    const dbs = await listDbInfos();
    for (const info of dbs) {
        if (!info || !info.name) continue;
        const db = await idbOpen(info.name);
        if (!db) continue;
        const stores = Array.from(db.objectStoreNames);
        for (const storeName of stores) {
            if (!idbImageOwner(info.name, storeName, null, true)) continue;
            try { await sanitizeStoreImages(db, info.name, storeName); } catch (e) {}
        }
        db.close();
    }
}

async function sanitizeStoreImages(db, dbName, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keyPath = store.keyPath;
    const recs = [], keys = [];
    const readDone = txDone(tx);
    await new Promise((resolve) => {
        try {
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (cur) { recs.push(cur.value); keys.push(cur.key); cur.continue(); }
                else resolve();
            };
            req.onerror = () => resolve();
        } catch (e) { resolve(); }
    });
    await readDone;

    const changed = [];
    for (let i = 0; i < recs.length; i++) {
        if (!idbImageOwner(dbName, storeName, keys[i])) continue;
        const out = { bytes: 0 };
        const r = sanitizeImages(recs[i], blobBytes, out);
        if (r.changed) changed.push({ value: r.value, key: keys[i] });
    }
    if (changed.length) {
        const wtx = db.transaction(storeName, 'readwrite');
        const wstore = wtx.objectStore(storeName);
        changed.forEach((c) => {
            try {
                if (keyPath) wstore.put(c.value);
                else wstore.put(c.value, c.key);
            } catch (e) {}
        });
        await txDone(wtx);
    }
}

// ========== UI ==========

let lastApps = null;
let selectedIds = new Set();
let storageScanning = false;

function categoryRows(apps, includeEmpty) {
    const rows = [];
    APP_CATEGORIES.forEach((c) => {
        rows.push({ id: c.id, label: c.label, color: c.color, bytes: (apps && apps[c.id]) || 0 });
    });
    rows.push({ id: IMAGE_CATEGORY.id, label: IMAGE_CATEGORY.label, color: IMAGE_CATEGORY.color, bytes: (apps && apps[IMAGE_CATEGORY.id]) || 0 });
    rows.push({ id: OTHER_CATEGORY.id, label: OTHER_CATEGORY.label, color: OTHER_CATEGORY.color, bytes: (apps && apps[OTHER_CATEGORY.id]) || 0 });
    const out = includeEmpty ? rows : rows.filter((r) => r.bytes > 0);
    out.sort((a, b) => b.bytes - a.bytes);
    return out;
}

function categoryLabel(id) {
    if (id === IMAGE_CATEGORY.id) return IMAGE_CATEGORY.label;
    if (id === OTHER_CATEGORY.id) return OTHER_CATEGORY.label;
    const c = APP_CATEGORIES.find((x) => x.id === id);
    return c ? c.label : id;
}

function renderProgress(rows, quota, total) {
    const bar = $('progressBar');
    if (!bar) return;
    bar.innerHTML = '';
    const denom = quota > 0 ? quota : (total > 0 ? total : 1);
    let used = 0;
    rows.forEach((r) => {
        if (r.bytes <= 0) return;
        const raw = (r.bytes / denom) * 100;
        // 配额通常远大于实际占用：给每个有数据的 App 至少 1% 宽度，保证进度条可读
        const pct = Math.min(100 - used, Math.max(raw, 1));
        if (pct <= 0) return;
        const seg = document.createElement('div');
        seg.className = 'segment';
        seg.style.width = pct + '%';
        seg.style.background = r.color;
        bar.appendChild(seg);
        used += pct;
    });
}

function renderLegend(rows) {
    const legend = $('legend');
    if (!legend) return;
    legend.innerHTML = '';
    rows.forEach((r) => {
        if (r.bytes <= 0) return;
        const item = document.createElement('div');
        item.className = 'legend-item';
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = r.color;
        item.appendChild(dot);
        item.appendChild(document.createTextNode(r.label));
        legend.appendChild(item);
    });
    const free = document.createElement('div');
    free.className = 'legend-item';
    const fdot = document.createElement('span');
    fdot.className = 'legend-dot dot-free';
    free.appendChild(fdot);
    free.appendChild(document.createTextNode('可用'));
    legend.appendChild(free);
}

async function updateStorageUI() {
    if (storageScanning) return;
    storageScanning = true;
    try {
        const quota = await detectQuota();
        const result = await scanStorage();
        const rows = categoryRows(result.apps, false);
        lastApps = result.apps;

        const usedEl = $('totalUsedAmount');
        if (usedEl) usedEl.textContent = formatBytes(result.total);
        const capEl = $('totalCapacityLabel');
        if (capEl) capEl.textContent = quota > 0 ? formatBytes(quota) : '未知';

        renderProgress(rows, quota, result.total);
        renderLegend(rows);
        if (actionSheet && actionSheet.classList.contains('active')) renderSheet();
    } catch (e) {
        console.warn('储存统计失败:', e);
    } finally {
        storageScanning = false;
    }
}

// ========== 页面交互 ==========

function goBack() {
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'closeFullscreen' }, '*');
            return;
        }
    } catch (e) {}
    window.location.href = 'more.html';
}

function refreshPage() {
    const icon = document.getElementById('refresh-icon');
    if (icon && !icon.classList.contains('spin')) {
        icon.classList.add('spin');
        setTimeout(() => icon.classList.remove('spin'), 800);
    }
    updateStorageUI();
}

// ========== 局部数据清理（按 App / 图片，多选） ==========

function openActionSheet() {
    selectedIds = new Set();
    renderSheet();
    overlay.classList.add('active');
    actionSheet.classList.add('active');
}

function closeActionSheet() {
    overlay.classList.remove('active');
    actionSheet.classList.remove('active');
    selectedIds = new Set();
}

function updateSheetConfirm() {
    const btn = $('sheetConfirm');
    if (!btn) return;
    const n = selectedIds.size;
    btn.textContent = n > 0 ? ('清空(' + n + ')') : '清空';
    btn.classList.toggle('disabled', n === 0);
}

function renderSheet() {
    const grid = $('clearSheetGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!lastApps) {
        const tip = document.createElement('div');
        tip.className = 'sheet-tip';
        tip.textContent = '正在统计存储…';
        grid.appendChild(tip);
        updateSheetConfirm();
        return;
    }

    const rows = categoryRows(lastApps, true);
    rows.forEach((r) => {
        const item = document.createElement('label');
        item.className = 'sheet-item';
        item.style.borderColor = r.color;

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'sheet-check';
        box.checked = selectedIds.has(r.id);
        box.addEventListener('change', () => {
            if (box.checked) selectedIds.add(r.id);
            else selectedIds.delete(r.id);
            item.classList.toggle('selected', box.checked);
            updateSheetConfirm();
        });

        const dot = document.createElement('span');
        dot.className = 'sheet-dot';
        dot.style.background = r.color;

        const name = document.createElement('span');
        name.className = 'sheet-name';
        name.textContent = r.label;

        const size = document.createElement('span');
        size.className = 'sheet-size';
        size.textContent = formatBytes(r.bytes);

        item.appendChild(box);
        item.appendChild(dot);
        item.appendChild(name);
        item.appendChild(size);
        item.classList.toggle('selected', box.checked);
        grid.appendChild(item);
    });

    updateSheetConfirm();
}

function confirmSelectedClear() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const labels = ids.map(categoryLabel);
    const hasImages = ids.indexOf(IMAGE_CATEGORY.id) !== -1;
    let desc = '将清空：' + labels.join('、') + '。<br>不影响未选中的应用，此操作不可恢复，是否继续？';
    if (hasImages) desc = '「图片」仅清理聊天 / 群聊 / 朋友圈 / 线下 / Ins / 通话中生成与发送的图片（不含头像、背景与表情）。<br>' + desc;

    closeActionSheet();
    setTimeout(() => {
        openiOSAlert(
            '清空局部数据',
            desc,
            '确认清空',
            async () => {
                showBusy();
                for (const id of ids) {
                    try { await clearCategoryData(id); } catch (e) { console.warn('清理失败:', e); }
                }
                hideBusy();
                await updateStorageUI();
                setTimeout(() => alert('已清空：' + labels.join('、')), 120);
            },
            true
        );
    }, 200);
}

const overlay = document.getElementById('overlay');
const actionSheet = document.getElementById('actionSheet');

// ========== iOS Alert（通用确认框） ==========
const alertOverlay = document.getElementById('iosAlert');
let currentConfirmFn = null;

function openiOSAlert(title, message, confirmText, onConfirm, danger) {
    const titleEl = document.getElementById('iosAlertTitle');
    const msgEl = document.getElementById('iosAlertMessage');
    const btn = document.getElementById('iosAlertConfirm');
    if (titleEl) titleEl.textContent = title || '提示';
    if (msgEl) msgEl.innerHTML = message || '';
    if (btn) {
        btn.textContent = confirmText || '确认';
        btn.classList.toggle('text-red', !!danger);
    }
    currentConfirmFn = onConfirm || null;
    alertOverlay.classList.add('active');
}
function closeiOSAlert() {
    alertOverlay.classList.remove('active');
    currentConfirmFn = null;
}
function confirmAlert() {
    const fn = currentConfirmFn;
    closeiOSAlert();
    if (typeof fn === 'function') setTimeout(fn, 150);
}

// ========== 忙碌遮罩 ==========
let _busyCount = 0;
function showBusy() { _busyCount++; overlay.classList.add('active'); }
function hideBusy() { _busyCount = Math.max(0, _busyCount - 1); if (_busyCount === 0) overlay.classList.remove('active'); }

// ========== 图片压缩（真实压缩 IndexedDB / localStorage 中的图片） ==========
let compressBusy = false;

function approxBytes(str) { return Math.round(str.length * 0.75); }

function compressDataUrl(dataUrl, maxDim, quality) {
    return new Promise((resolve) => {
        if (!/^data:image\/(png|jpe?g|webp|bmp)/i.test(dataUrl)) { resolve(null); return; }
        const img = new Image();
        img.onload = () => {
            try {
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                if (!w || !h) { resolve(null); return; }
                const scale = Math.min(1, maxDim / Math.max(w, h));
                const cw = Math.max(1, Math.round(w * scale));
                const ch = Math.max(1, Math.round(h * scale));
                const canvas = document.createElement('canvas');
                canvas.width = cw; canvas.height = ch;
                canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

async function compressInPlace(str, maxDim, quality) {
    const out = await compressDataUrl(str, maxDim, quality);
    if (!out) return { value: str, changed: false, saved: 0 };
    const saved = approxBytes(str) - approxBytes(out);
    if (saved > 512) return { value: out, changed: true, saved };
    return { value: str, changed: false, saved: 0 };
}

async function transformValueImages(v) {
    if (typeof v === 'string') {
        if (v.indexOf('data:image/') === 0) return await compressInPlace(v, 1024, 0.72);
        return { value: v, changed: false, saved: 0 };
    }
    if (!v || typeof v !== 'object') return { value: v, changed: false, saved: 0 };
    if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof Date) {
        return { value: v, changed: false, saved: 0 };
    }
    if (Array.isArray(v)) {
        let changed = false, saved = 0;
        const arr = new Array(v.length);
        for (let i = 0; i < v.length; i++) {
            const r = await transformValueImages(v[i]);
            arr[i] = r.value; changed = changed || r.changed; saved += r.saved;
        }
        return { value: changed ? arr : v, changed, saved };
    }
    let changed = false, saved = 0, out = v, clone = null;
    for (const k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        const r = await transformValueImages(v[k]);
        if (r.changed) {
            if (!clone) { clone = Object.assign({}, v); out = clone; }
            out[k] = r.value; changed = true; saved += r.saved;
        }
    }
    return { value: out, changed, saved };
}

async function compressStoreImages(db, storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keyPath = store.keyPath;
    const recs = [], keys = [];
    const readDone = txDone(tx);
    await new Promise((resolve) => {
        try {
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (cur) { recs.push(cur.value); keys.push(cur.key); cur.continue(); }
                else resolve();
            };
            req.onerror = () => resolve();
        } catch (e) { resolve(); }
    });
    await readDone;

    let savedTotal = 0;
    const changed = [];
    for (let i = 0; i < recs.length; i++) {
        const r = await transformValueImages(recs[i]);
        if (r.changed) { changed.push({ value: r.value, key: keys[i] }); savedTotal += r.saved; }
    }
    if (changed.length) {
        const wtx = db.transaction(storeName, 'readwrite');
        const wstore = wtx.objectStore(storeName);
        changed.forEach((c) => {
            try {
                if (keyPath) wstore.put(c.value);
                else wstore.put(c.value, c.key);
            } catch (e) {}
        });
        await txDone(wtx);
    }
    return savedTotal;
}

async function compressImagesDeep() {
    let saved = 0;

    // localStorage
    const lsKeys = [];
    for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i));
    for (const k of lsKeys) {
        const v = localStorage.getItem(k);
        if (typeof v === 'string' && v.indexOf('data:image/') === 0) {
            const r = await compressInPlace(v, 1024, 0.72);
            if (r.changed) { try { localStorage.setItem(k, r.value); saved += r.saved; } catch (e) {} }
        }
    }

    // IndexedDB
    const dbs = await listDbInfos();
    for (const info of dbs) {
        if (!info || !info.name) continue;
        const db = await idbOpen(info.name);
        if (!db) continue;
        const stores = Array.from(db.objectStoreNames);
        for (const s of stores) {
            try { saved += await compressStoreImages(db, s); } catch (e) {}
        }
        db.close();
    }
    return saved;
}

async function handleCompressImages() {
    if (compressBusy) return;
    compressBusy = true;
    showBusy();
    try {
        const saved = await compressImagesDeep();
        await updateStorageUI();
        setTimeout(() => {
            alert(saved > 0 ? ('图片压缩完成，释放约 ' + formatBytes(saved)) : '没有可压缩的图片（已是最优，或均为矢量图/动图）');
        }, 120);
    } catch (e) {
        console.warn('压缩失败:', e);
        setTimeout(() => alert('压缩失败：' + (e.message || e)), 120);
    } finally {
        hideBusy();
        compressBusy = false;
    }
}

// ========== 全局清理 ==========

function openGlobalClearAlert() {
    openiOSAlert(
        '清空全局数据',
        '此操作将清除所有的应用缓存及聊天记录，且不可恢复。<br>是否继续？',
        '确认清空',
        executeGlobalClear,
        true
    );
}

function executeGlobalClear() {
    closeiOSAlert();
    setTimeout(async () => {
        showBusy();
        try {
            try { localStorage.clear(); } catch (e) {}
            try { sessionStorage.clear(); } catch (e) {}
            const dbs = await listDbInfos();
            await Promise.all(dbs.map((info) => (info.name ? deleteDb(info.name) : Promise.resolve())));
        } finally {
            hideBusy();
            await updateStorageUI();
            setTimeout(() => alert('全局数据已清空。'), 120);
        }
    }, 300);
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    updateStorageUI();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') updateStorageUI();
    });
    // 页面被复用/重新打开、导入资源、字体或美化变化后，都重新统计最新占用。
    window.addEventListener('focus', updateStorageUI);
    window.addEventListener('pageshow', updateStorageUI);
    window.addEventListener('message', (e) => {
        const t = e && e.data && e.data.type;
        if (!t) return;
        if (['nanoOverlayReopen', 'nano:pageShown', 'beautify:apply', 'beautify:font',
             'marketResourceImported', 'momentsDataUpdated', 'contactsDataUpdated'].indexOf(t) !== -1) {
            updateStorageUI();
        }
    });
});
