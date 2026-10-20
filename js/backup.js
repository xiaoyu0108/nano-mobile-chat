/* =========================================================
   全局备份与恢复
   -    导出：IndexedDB + localStorage + sessionStorage（不含 CacheStorage，可再生、会让备份巨大且很慢）
   - 两种格式：JSON（文本）/ ZIP（含二进制）
   - 导入：完全覆盖当前数据后还原
   ========================================================= */

function $(id) { return document.getElementById(id); }

// ================= JSZip 按需加载（本地优先，失败回退 CDN） =================
let _jszipPromise = null;
const JSZIP_SOURCES = [
    (window.NANO_ROOT || '') + 'js/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
];
function ensureJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (_jszipPromise) return _jszipPromise;
    _jszipPromise = new Promise(function (resolve, reject) {
        let i = 0;
        (function tryNext() {
            if (i >= JSZIP_SOURCES.length) { _jszipPromise = null; reject(new Error('JSZip 加载失败：请检查网络，或改用 JSON 导出/导入（JSON 不需要 JSZip）')); return; }
            const s = document.createElement('script');
            s.src = JSZIP_SOURCES[i++];
            let done = false;
            const timer = setTimeout(function () { if (done) return; done = true; if (s.parentNode) s.parentNode.removeChild(s); tryNext(); }, 15000);
            s.onload = function () {
                if (done) return; done = true; clearTimeout(timer);
                if (window.JSZip) resolve(window.JSZip);
                else { if (s.parentNode) s.parentNode.removeChild(s); tryNext(); }
            };
            s.onerror = function () { if (done) return; done = true; clearTimeout(timer); if (s.parentNode) s.parentNode.removeChild(s); tryNext(); };
            document.head.appendChild(s);
        })();
    });
    return _jszipPromise;
}

// ================= 进度弹层 =================
let _progressEls = null;
function progressEls() {
    if (!_progressEls) _progressEls = { ov: $('progressOverlay'), title: $('progressTitle'), fill: $('progressFill'), text: $('progressText') };
    return _progressEls;
}
function showProgress(title) {
    const e = progressEls();
    if (!e.ov) return;
    if (title && e.title) e.title.textContent = title;
    if (e.fill) e.fill.style.width = '0%';
    if (e.text) e.text.textContent = '准备中…';
    e.ov.classList.add('active');
}
function setProgress(pct, text) {
    const e = progressEls();
    if (!e.ov) return;
    if (typeof pct === 'number' && isFinite(pct) && e.fill) e.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (text && e.text) e.text.textContent = text;
}
function hideProgress() {
    const e = progressEls();
    if (e.ov) e.ov.classList.remove('active');
}
// 带进度的读文件（大文件也能看到进展，不至于像卡死）
function readFileText(file, onPct) {
    return new Promise(function (resolve, reject) {
        try {
            const r = new FileReader();
            r.onprogress = function (ev) { if (ev.lengthComputable && typeof onPct === 'function') onPct((ev.loaded / ev.total) * 100); };
            r.onload = function () { resolve(String(r.result || '')); };
            r.onerror = function () { reject(new Error('读取文件失败，请重试或换个浏览器')); };
            r.readAsText(file);
        } catch (e) { reject(e); }
    });
}

function isIOSDevice() {
    try {
        return /iP(hone|ad|od)/.test(navigator.platform || '') ||
            ((navigator.userAgent || '').indexOf('Mac') >= 0 && 'ontouchend' in document);
    } catch (e) { return false; }
}

function downloadBlob(blob, filename) {
    // 只在 iOS 用系统分享：iOS 独立窗口用 <a download> 会卡在“存储到文件”页且退不回。
    // 安卓/桌面仍用普通下载，文件会正常进系统「下载」目录（用户找得到）。
    if (isIOSDevice()) {
        try {
            if (navigator.canShare && navigator.share) {
                const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
                if (navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: filename }).catch(() => {});
                    return;
                }
            }
        } catch (e) {}
        try {
            blob.text().then((t) => { try { navigator.clipboard.writeText(t); alert('已复制到剪贴板，可粘贴保存'); } catch (e2) {} });
        } catch (e2) {}
        return;
    }
    // 非 iOS：普通下载
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
        try {
            blob.text().then((t) => { try { navigator.clipboard.writeText(t); alert('已复制到剪贴板，可粘贴保存'); } catch (e2) {} });
        } catch (e2) {}
    }
}

// 导入完成后通知所有已打开页面重新读取 IDB / localStorage：
// 否则聊天页仍拿着导入前的角色列表，看起来就像“备份里没有 char”。
function notifyRestore() {
    try {
        if (window.parent && window.parent !== window) {
            ['currentMaskChanged', 'homeDataUpdated', 'contactsDataUpdated', 'groupsDataUpdated', 'nanoEmojiUpdated'].forEach(function (type) {
                try { window.parent.postMessage({ type: type }, '*'); } catch (e) {}
            });
        }
        window.dispatchEvent(new CustomEvent('nanoRestoreComplete'));
    } catch (e) {}
}

function timestampName(prefix, ext) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const s =
        d.getFullYear() +
        p(d.getMonth() + 1) +
        p(d.getDate()) +
        '-' +
        p(d.getHours()) +
        p(d.getMinutes()) +
        p(d.getSeconds());
    return `${prefix}-${s}.${ext}`;
}

function openDatabase(name, version) {
    return new Promise((resolve, reject) => {
        const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // 需要时才创建；已存在的库不会触发
        req.onupgradeneeded = () => {};
    });
}

// Safari / 部分 WebView 没有 indexedDB.databases()：用已知库名兜底，
// 否则「全站备份」会漏掉角色库、聊天记录库，导入后自然看不到 char。
const NANO_KNOWN_DBS = [
    'nano_characters_db', 'nano_api_db', 'nano_worldbook_db', 'nano_vector_memory_db',
    'nano_mask_db', 'MaskAvatarDB', 'nano_music_db', 'nano_wallet_db',
    'NanoCoupleSpaceV10', 'NanoMomentsDB', 'NanoMomentsCoverDB', 'nano_imessage_db',
    'nano_ins_db', 'NanoVoiceDB', 'BeautifyAppDB', 'MeetSettingsDB', 'nano_app_storage',
    'localforage', 'NanoMarketDB', 'nano_user_db', 'nano_appstore_db', 'nano_groups_db',
    'nano_chat_menu_db', 'BookReaderDB', 'nano_halo_db', 'voice_call_records_db',
    'NanoAvatarBarDB', 'nano_discover_db', 'check_phone_db'
];

async function listDatabases() {
    if (!indexedDB) return [];
    if (indexedDB.databases) {
        try {
            const dbs = await indexedDB.databases();
            const out = (dbs || []).map((d) => ({ name: d.name, version: d.version })).filter((d) => d.name);
            if (out.length) return out;
        } catch {}
    }
    // 没有 databases() 时逐个探测：只导出真实存在的库，避免顺手创建空库
    const found = [];
    for (const name of NANO_KNOWN_DBS) {
        const info = await probeDatabase(name);
        if (info) found.push(info);
    }
    return found;
}

function probeDatabase(name) {
    return new Promise((resolve) => {
        let created = false;
        let req;
        try { req = indexedDB.open(name); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = function () { created = true; };
        req.onsuccess = function () {
            const db = req.result;
            const version = db.version;
            try { db.close(); } catch (e) {}
            if (created) {
                try { indexedDB.deleteDatabase(name); } catch (e) {}
                resolve(null);
            } else {
                resolve({ name: name, version: version });
            }
        };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
    });
}

function getAllRecords(store) {
    return new Promise((resolve) => {
        const out = [];
        const req = store.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                out.push({ key: cursor.key, value: cursor.value });
                cursor.continue();
            } else resolve(out);
        };
        req.onerror = () => resolve([]);
    });
}

function txDone(tx) {
    return new Promise((resolve) => {
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
}

/** 判断值是否是二进制（Blob / ArrayBuffer / TypedArray） */
function isBinary(v) {
    return (
        v instanceof Blob ||
        v instanceof ArrayBuffer ||
        ArrayBuffer.isView(v)
    );
}

/** 二进制 → base64（用于 JSON 格式） */
async function binaryToBase64(v) {
    let buf;
    if (v instanceof Blob) {
        buf = await v.arrayBuffer();
    } else if (v instanceof ArrayBuffer) {
        buf = v;
    } else if (ArrayBuffer.isView(v)) {
        buf = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    } else {
        return null;
    }
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

/** base64 → ArrayBuffer */
function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

// ================= 导出 =================

/**
 * 收集全站数据。
 * opts.binary 为 true 时把二进制转成 base64 内嵌（JSON 格式使用）；
 * 为 false 时二进制放到 media 字段（ZIP 单独存储）。
 */
async function collectAllData(opts = { binary: false }) {
    const data = {
        meta: {
            type: 'full-site-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            origin: location.origin,
            binary: opts.binary
        },
        indexedDB: {},
        localStorage: {},
        sessionStorage: {},
        cacheStorage: {}
    };

    // ---------- IndexedDB ----------
    const dbs = await listDatabases();
    for (const { name, version } of dbs) {
        let db;
        try {
            db = await openDatabase(name, version);
        } catch {
            continue;
        }
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length === 0) { db.close(); continue; }

        data.indexedDB[name] = {
            version,
            schema: {},
            stores: {}
        };

        // 每个 store 单独一个只读事务：避免 await 期间事务自动提交，
        // 再次 tx.objectStore() 时抛 “The transaction finished.”。
        for (const storeName of storeNames) {
            let records = [];
            let storeSchema = { keyPath: null, autoIncrement: false };
            try {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                storeSchema = {
                    keyPath: store.keyPath === undefined ? null : store.keyPath,
                    autoIncrement: !!store.autoIncrement
                };
                records = await getAllRecords(store);
                await txDone(tx);
            } catch (e) {
                console.warn('读取 store 失败:', name, storeName, e);
                records = [];
            }
            data.indexedDB[name].schema[storeName] = storeSchema;

            const out = [];
            for (const rec of records) {
                if (isBinary(rec.value)) {
                    if (opts.binary) {
                        const b64 = await binaryToBase64(rec.value);
                        out.push({
                            key: rec.key,
                            __binary: true,
                            mime: rec.value instanceof Blob ? rec.value.type : '',
                            data: b64
                        });
                    } else {
                        // 非 binary 模式：跳过二进制，仅记录元信息
                        out.push({
                            key: rec.key,
                            __binarySkipped: true,
                            mime: rec.value instanceof Blob ? rec.value.type : ''
                        });
                    }
                } else {
                    out.push({ key: rec.key, value: rec.value });
                }
            }
            data.indexedDB[name].stores[storeName] = out;
        }
        db.close();
    }

    // ---------- localStorage ----------
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        data.localStorage[k] = localStorage.getItem(k);
    }

    // ---------- sessionStorage ----------
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            data.sessionStorage[k] = sessionStorage.getItem(k);
        }
    } catch {}

    // ---------- CacheStorage ----------
    // 不打包 Service Worker 缓存：那是可再生的静态资源（JS/CSS/图片），
    // 打进备份会让文件巨大、导出/导入都很慢，恢复时也没有意义（会自动重新缓存）。
    // 旧备份若含 cacheStorage，导入时会自动忽略。

    return data;
}

/** 导出为 JSON（二进制转 base64 内嵌，保证完整） */
async function exportJson() {
    const data = await collectAllData({ binary: true });
    const text = JSON.stringify(data);
    downloadBlob(new Blob([text], { type: 'application/json' }), timestampName('Nano', 'json'));
}

/** 导出为 ZIP（结构清晰，二进制单独存放，体积更小） */
async function exportZip() {
    await ensureJSZip();

    const zip = new JSZip();
    const meta = {
        type: 'full-site-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        origin: location.origin,
        format: 'zip'
    };

    // ---------- IndexedDB ----------
    const idbRoot = zip.folder('indexedDB');
    const dbs = await listDatabases();

    for (const { name, version } of dbs) {
        let db;
        try {
            db = await openDatabase(name, version);
        } catch {
            continue;
        }
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length === 0) { db.close(); continue; }

        const dbFolder = idbRoot.folder(safeName(name));
        dbFolder.file('__meta__.json', JSON.stringify({ version }));

        // schema（keyPath / autoIncrement），导入时按原样重建 store
        const schemaOut = {};

        // 每个 store 单独一个只读事务（避免事务被提前提交）
        for (const storeName of storeNames) {
            let records = [];
            try {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                schemaOut[storeName] = {
                    keyPath: store.keyPath === undefined ? null : store.keyPath,
                    autoIncrement: !!store.autoIncrement
                };
                records = await getAllRecords(store);
                await txDone(tx);
            } catch (e) {
                console.warn('读取 store 失败:', name, storeName, e);
                records = [];
            }
            const storeFolder = dbFolder.folder(safeName(storeName));

            const metaRecords = [];
            let binIndex = 0;

            for (const rec of records) {
                const keyInfo = encodeKey(rec.key);
                if (isBinary(rec.value)) {
                    const binName = `bin_${binIndex++}.bin`;
                    const mime = rec.value instanceof Blob ? rec.value.type : '';
                    let blob;
                    if (rec.value instanceof Blob) blob = rec.value;
                    else if (rec.value instanceof ArrayBuffer) blob = new Blob([rec.value]);
                    else if (ArrayBuffer.isView(rec.value)) {
                        blob = new Blob([rec.value.buffer.slice(
                            rec.value.byteOffset,
                            rec.value.byteOffset + rec.value.byteLength
                        )]);
                    }
                    storeFolder.file(binName, blob);
                    metaRecords.push({
                        key: keyInfo,
                        __binaryFile: binName,
                        mime
                    });
                } else {
                    metaRecords.push({ key: keyInfo, value: rec.value });
                }
            }
            storeFolder.file('records.json', JSON.stringify(metaRecords));
        }
        dbFolder.file('__schema__.json', JSON.stringify(schemaOut));
        db.close();
    }

    // ---------- localStorage ----------
    zip.file('localStorage.json', JSON.stringify(collectStorage(localStorage)));

    // ---------- sessionStorage ----------
    zip.file('sessionStorage.json', JSON.stringify(collectStorage(sessionStorage)));

    // ---------- CacheStorage ----------
    // 跳过 Service Worker 缓存（可再生资源），让备份更小、导出/导入更快

    zip.file('meta.json', JSON.stringify(meta));

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    downloadBlob(blob, timestampName('Nano', 'zip'));
}

function collectStorage(storage) {
    const out = {};
    try {
        for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            out[k] = storage.getItem(k);
        }
    } catch {}
    return out;
}

function safeName(s) {
    return String(s).replace(/[\\/:*?"<>|]/g, '_');
}

/** 把 IDB 的 key 编码成可 JSON 化的对象 */
function encodeKey(key) {
    if (key instanceof Date) return { __type: 'Date', value: key.toISOString() };
    if (key instanceof ArrayBuffer) return { __type: 'ArrayBuffer', value: Array.from(new Uint8Array(key)) };
    if (ArrayBuffer.isView(key)) return { __type: 'TypedArray', value: Array.from(key) };
    if (Array.isArray(key)) return { __type: 'Array', value: key.map(encodeKey) };
    if (key && typeof key === 'object') return { __type: 'Object', value: JSON.parse(JSON.stringify(key)) };
    return { __type: 'Primitive', value: key };
}

function decodeKey(info) {
    if (!info || typeof info !== 'object') return info;
    switch (info.__type) {
        case 'Date': return new Date(info.value);
        case 'ArrayBuffer': return new Uint8Array(info.value).buffer;
        case 'TypedArray': return new Uint8Array(info.value);
        case 'Array': return info.value.map(decodeKey);
        case 'Object': return info.value;
        case 'Primitive': return info.value;
        default: return info;
    }
}

// ================= 导入 =================

/** 清空全站数据（只清 localStorage / sessionStorage）。
 *  不再删除 IndexedDB：删除会因其它页面/iframe 的旧连接触发 blocked → 导入卡死。
 *  IndexedDB 改为“逐 store 清空后写入”，效果等价且不会被 blocked。 */
async function clearAllData(dbNames) {
    // localStorage
    try { localStorage.clear(); } catch {}
    // sessionStorage
    try { sessionStorage.clear(); } catch {}
    // CacheStorage / IndexedDB：不动（见上）
}

/** 从 JSON 对象还原 */
async function importFromJson(data, onProgress) {
    if (!data || typeof data !== 'object') throw new Error('不是有效的备份文件');
    // 兼容旧版备份：只要有 indexedDB / localStorage / sessionStorage 就认，不强制 meta.type
    const isBackup = !!data.indexedDB || !!data.localStorage || !!data.sessionStorage || (data.meta && data.meta.type === 'full-site-backup');
    if (!isBackup) throw new Error('不是有效的全站备份文件');
    const _prog = (t, p) => { if (typeof onProgress === 'function') onProgress(t, p); };
    // 统计总记录数，用于进度条
    let totalRec = 0;
    if (data.indexedDB) {
        for (const dbName of Object.keys(data.indexedDB)) {
            const stores = (data.indexedDB[dbName] && data.indexedDB[dbName].stores) || {};
            for (const s of Object.keys(stores)) totalRec += (stores[s] || []).length;
        }
    }
    let doneRec = 0;
    const reportRec = (extra) => _prog(extra || ('写入数据 ' + doneRec + '/' + totalRec), 5 + (totalRec ? (doneRec / totalRec) * 88 : 40));

    _prog('准备导入…', 2);

    // ---------- IndexedDB ----------
    if (data.indexedDB) {
        for (const dbName of Object.keys(data.indexedDB)) {
            const dbInfo = data.indexedDB[dbName];
            const stores = dbInfo.stores || {};
            const storeNames = Object.keys(stores);
            const schemaIn = dbInfo.schema || {};

            // 依据备份里的 schema 重建；旧备份没有 schema 时按记录推断 keyPath
            const schema = {};
            for (const storeName of storeNames) {
                const sc = schemaIn[storeName];
                if (sc && (sc.keyPath !== undefined || sc.autoIncrement)) {
                    schema[storeName] = {
                        keyPath: sc.keyPath === undefined ? null : sc.keyPath,
                        autoIncrement: !!sc.autoIncrement
                    };
                } else {
                    schema[storeName] = {
                        keyPath: inferKeyPathFromRecords(stores[storeName]),
                        autoIncrement: false
                    };
                }
            }

            const db = await openDatabaseWithSchema(dbName, dbInfo.version, schema);
            if (!db) continue;

            const existingStores = Array.from(db.objectStoreNames);
            const usableStores = storeNames.filter((s) => existingStores.includes(s));
            if (usableStores.length === 0) { db.close(); continue; }

            // 每个 store 一个事务，事务内绝不 await（避免 “The transaction finished.”）
            for (const storeName of usableStores) {
                const records = stores[storeName] || [];
                const outOfLine = !schema[storeName].keyPath;
                try {
                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);
                    store.clear();   // 先清空再写入（覆盖），避免删库导致 blocked
                    for (const rec of records) {
                        let value;
                        if (rec.__binary) {
                            value = new Blob([base64ToArrayBuffer(rec.data)], { type: rec.mime || '' });
                        } else if (rec.__binarySkipped) {
                            continue;
                        } else {
                            value = rec.value;
                        }
                        try {
                            if (outOfLine) {
                                const key = decodeKey(rec.key);
                                if (key === undefined || key === null) store.put(value);
                                else store.put(value, key);
                            } else {
                                store.put(value);
                            }
                        } catch (e) {
                            console.warn('写入记录失败', dbName, storeName, e);
                        }
                        doneRec++;
                        if (doneRec % 40 === 0) reportRec();
                    }
                    await txDone(tx);
                } catch (e) {
                    console.warn('写入 store 失败', dbName, storeName, e);
                }
            }
            db.close();
        }
    }

    // ---------- localStorage ----------
    _prog('写入本地存储…', 94);
    try { localStorage.clear(); } catch (e) {}
    if (data.localStorage) {
        for (const k of Object.keys(data.localStorage)) {
            try { localStorage.setItem(k, data.localStorage[k]); } catch {}
        }
    }

    // ---------- sessionStorage ----------
    try { sessionStorage.clear(); } catch (e) {}
    if (data.sessionStorage) {
        for (const k of Object.keys(data.sessionStorage)) {
            try { sessionStorage.setItem(k, data.sessionStorage[k]); } catch {}
        }
    }

    // ---------- CacheStorage ----------
    // 忽略备份里的 Service Worker 缓存（可再生），导入更快、也不清掉当前缓存

    _prog('整理数据…', 98);
    notifyRestore();
}

/** 旧备份没有 schema 时：从记录里推断 keyPath（值里与 key 相等的字段） */
function inferKeyPathFromRecords(records) {
    for (const rec of records || []) {
        if (!rec || rec.__binary || rec.__binarySkipped) continue;
        const v = rec.value;
        const k = decodeKey(rec.key);
        if (v && typeof v === 'object' && k !== undefined && k !== null) {
            for (const prop in v) {
                if (v[prop] === k) return prop;
            }
        }
    }
    return null;
}

/** 打开数据库并确保 schema 存在（schema: { storeName: { keyPath, autoIncrement } }）
 *  不降级已存在的库：始终按“当前/新建”版本打开，缺少的 store 通过升版本补建，
 *  这样导入旧备份（版本更低）或旧库缺表都不会失败。 */
function openDatabaseWithSchema(name, version, schema) {
    return new Promise((resolve) => {
        const doOpen = (ver) => {
            let req;
            try { req = indexedDB.open(name, ver); } catch (e) { resolve(null); return; }
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                for (const storeName of Object.keys(schema || {})) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const sc = schema[storeName] || {};
                        const opts = {};
                        if (sc.keyPath !== undefined && sc.keyPath !== null) opts.keyPath = sc.keyPath;
                        if (sc.autoIncrement) opts.autoIncrement = true;
                        db.createObjectStore(storeName, opts);
                    }
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                const missing = Object.keys(schema || {}).some((s) => !db.objectStoreNames.contains(s));
                if (missing) {
                    const nv = db.version + 1;
                    try { db.close(); } catch (e) {}
                    doOpen(nv);   // 升版本补建缺失的 store
                } else {
                    resolve(db);
                }
            };
            req.onerror = () => resolve(null);
            // 旧连接未释放触发 blocked 时不要卡死：关闭自身并直接放行（跳过该库，其它库继续导）
            req.onblocked = () => { try { if (req.result) req.result.close(); } catch (e) {} resolve(null); };
        };
        // 用不指定版本打开（当前版本，或新建），彻底避免 VersionError
        doOpen();
    });
}

/** 从 ZIP 还原 */
async function importFromZip(file, onProgress) {
    await ensureJSZip();
    const _prog = (t, p) => { if (typeof onProgress === 'function') onProgress(t, p); };
    _prog('解压中…', 3);
    // 解压加超时，避免大文件/内存不足时“一直转”
    const zip = await Promise.race([
        JSZip.loadAsync(file),
        new Promise((_, rej) => setTimeout(() => rej(new Error('解压超时：文件可能过大或内存不足，建议改用 JSON 备份，或换个浏览器再试')), 90000))
    ]);

    // ---------- 解析 meta（兼容旧版备份：没有 meta.json 也照导）----------
    let meta = null;
    const metaFile = zip.file('meta.json') || zip.file('meta.js');
    if (metaFile) {
        try { meta = JSON.parse(await metaFile.async('string')); } catch (e) {}
    }
    const hasIdb = !!zip.folder('indexedDB');
    const hasLs = !!zip.file('localStorage.json');
    if (!meta && !hasIdb && !hasLs) throw new Error('ZIP 不是有效的备份文件（缺少 meta.json / indexedDB / localStorage）');
    if (meta && meta.type && meta.type !== 'full-site-backup') throw new Error('不是有效的全站备份文件');

    // ---------- IndexedDB ----------
    const idbFolder = zip.folder('indexedDB');
    if (idbFolder) {
        const dbNames = new Set();
        idbFolder.forEach((path, entry) => {
            if (entry.dir) {
                const seg = path.split('/').filter(Boolean);
                if (seg.length >= 1) dbNames.add(seg[0]);
            }
        });
        const dbNameArr = Array.from(dbNames);
        // 不再删库：逐 store 清空写入（避免其它 iframe 旧连接导致 blocked 卡死）
        let _dbi = 0;

        for (const dbName of dbNameArr) {
            if (typeof onProgress === 'function') onProgress('导入数据库 ' + (++_dbi) + '/' + dbNameArr.length + '…', 5 + (_dbi / dbNameArr.length) * 88);
            const dbFolder = idbFolder.folder(dbName);
            const dbMetaFile = dbFolder.file('__meta__.json');
            let version;
            if (dbMetaFile) {
                try {
                    const m = JSON.parse(await dbMetaFile.async('string'));
                    version = m.version;
                } catch {}
            }
            let schemaIn = {};
            const schemaFile = dbFolder.file('__schema__.json');
            if (schemaFile) {
                try { schemaIn = JSON.parse(await schemaFile.async('string')) || {}; } catch {}
            }

            // 收集 stores
            const storeNames = new Set();
            dbFolder.forEach((path, entry) => {
                if (entry.dir) {
                    const seg = path.split('/').filter(Boolean);
                    if (seg.length >= 1) storeNames.add(seg[0]);
                }
            });
            const storeList = Array.from(storeNames);
            if (storeList.length === 0) continue;

            // 第一步：先把所有记录（含二进制）读进内存，期间不持有事务
            const payload = {}; // storeName -> [{ key, value }]
            for (const storeName of storeList) {
                const storeFolder = dbFolder.folder(storeName);
                const recordsFile = storeFolder.file('records.json');
                if (!recordsFile) continue;

                const records = JSON.parse(await recordsFile.async('string'));
                const arr = [];
                for (const rec of records) {
                    const key = decodeKey(rec.key);
                    let value;
                    if (rec.__binaryFile) {
                        const binFile = storeFolder.file(rec.__binaryFile);
                        if (!binFile) continue;
                        const ab = await binFile.async('arraybuffer');
                        value = new Blob([ab], { type: rec.mime || '' });
                    } else {
                        value = rec.value;
                    }
                    arr.push({ key, value });
                }
                payload[storeName] = arr;
            }

            // 依据 schema（旧备份按记录推断）创建库
            const schema = {};
            for (const s of storeList) {
                const sc = schemaIn[s];
                if (sc && (sc.keyPath !== undefined || sc.autoIncrement)) {
                    schema[s] = {
                        keyPath: sc.keyPath === undefined ? null : sc.keyPath,
                        autoIncrement: !!sc.autoIncrement
                    };
                } else {
                    schema[s] = { keyPath: inferKeyPathFromRecords(payload[s]), autoIncrement: false };
                }
            }

            const db = await openDatabaseWithSchema(dbName, version, schema);
            if (!db) continue;

            const existing = Array.from(db.objectStoreNames);
            const usable = storeList.filter((s) => existing.includes(s) && payload[s]);
            if (usable.length === 0) { db.close(); continue; }

            // 第二步：每个 store 一个事务，事务内绝不 await
            for (const storeName of usable) {
                const outOfLine = !schema[storeName].keyPath;
                try {
                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);
                    store.clear();   // 先清空再写入：等价于覆盖，且不需要删库（避免 blocked 卡死）
                    for (const item of payload[storeName]) {
                        try {
                            if (outOfLine) {
                                if (item.key === undefined || item.key === null) store.put(item.value);
                                else store.put(item.value, item.key);
                            } else {
                                store.put(item.value);
                            }
                        } catch (e) {
                            console.warn('写入失败', dbName, storeName, e);
                        }
                    }
                    await txDone(tx);
                } catch (e) {
                    console.warn('写入 store 失败', dbName, storeName, e);
                }
            }
            db.close();
        }
    }

    // ---------- localStorage ----------
    _prog('写入本地存储…', 94);
    try { localStorage.clear(); } catch (e) {}
    const lsFile = zip.file('localStorage.json');
    if (lsFile) {
        const obj = JSON.parse(await lsFile.async('string'));
        for (const k of Object.keys(obj)) {
            try { localStorage.setItem(k, obj[k]); } catch {}
        }
    }

    // ---------- sessionStorage ----------
    try { sessionStorage.clear(); } catch (e) {}
    const ssFile = zip.file('sessionStorage.json');
    if (ssFile) {
        const obj = JSON.parse(await ssFile.async('string'));
        for (const k of Object.keys(obj)) {
            try { sessionStorage.setItem(k, obj[k]); } catch {}
        }
    }

    // ---------- CacheStorage ----------
    // 忽略备份里的 Service Worker 缓存（可再生的静态资源），导入更快、也不会清掉当前缓存

    if (typeof onProgress === 'function') onProgress('整理数据…');
    notifyRestore();
}

// ================= 页面交互 =================

function goBack() {
    // 在 iframe 中：关闭全屏遮罩（回到 more 页面）
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'closeFullscreen' }, '*');
            return;
        }
    } catch (e) {}
    window.location.href = 'more.html';
}

function refreshPage(btn) {
    const icon = document.getElementById('refresh-icon');
    if (!icon || icon.classList.contains('spin')) return;
    icon.classList.add('spin');
    setTimeout(() => icon.classList.remove('spin'), 800);
}

// 弹窗
const alertOverlay = $('iosAlert');
const alertTitle = $('alertTitle');
const alertMessage = $('alertMessage');
const alertConfirmBtn = $('alertConfirmBtn');
let currentAction = null;
let pendingFile = null;

function openAlert(actionType, extra = null) {
    currentAction = actionType;
    alertConfirmBtn.classList.remove('danger');

    if (actionType === 'exportJson') {
        alertTitle.textContent = '导出为 JSON';
        alertMessage.textContent = '将打包全站数据（含二进制，base64 内嵌）。文件可能较大，是否继续？';
    } else if (actionType === 'exportZip') {
        alertTitle.textContent = '导出为 ZIP';
        alertMessage.textContent = '将打包全站数据，二进制单独存放，体积更小。是否继续？';
    } else if (actionType === 'importConfirm') {
        alertTitle.textContent = '导入并覆盖';
        alertMessage.textContent = `即将导入「${extra}」。\n警告：当前所有数据将被清空并覆盖，且不可恢复！`;
        alertConfirmBtn.classList.add('danger');
    }

    alertOverlay.classList.add('active');
}

function closeAlert() {
    alertOverlay.classList.remove('active');
    currentAction = null;
}

async function executeAction() {
    const action = currentAction;
    closeAlert();

    try {
        if (action === 'exportJson') {
            await withLoading('btnExportJson', '导出中', exportJson);
        } else if (action === 'exportZip') {
            await withLoading('btnExportZip', '导出中', exportZip);
        } else if (action === 'importConfirm' && pendingFile) {
            showProgress('正在导入备份');
            try {
                await withLoading('btnImport', '导入中', async () => {
                    const name = pendingFile.name.toLowerCase();
                    const onP = (t, pct) => { setProgress(pct, t); setLoadingText('btnImport', t); };
                    if (name.endsWith('.zip')) {
                        setProgress(2, '读取 ZIP…');
                        try {
                            await importFromZip(pendingFile, onP);
                        } catch (ze) {
                            // 有些“备份”其实是 JSON 但被命名成 .zip；或旧版 zip 结构不同 → 回退按文本导入
                            setProgress(18, '按备份文件重试…');
                            const text = await readFileText(pendingFile, (p) => setProgress(18 + p * 0.2, '读取文件 ' + Math.round(p) + '%'));
                            let data;
                            try { data = JSON.parse(text); } catch (e) { throw ze; }
                            await importFromJson(data, onP);
                        }
                    } else {
                        setProgress(1, '读取文件…');
                        const text = await readFileText(pendingFile, (p) => setProgress(p * 0.35, '读取文件 ' + Math.round(p) + '%'));
                        setProgress(38, '解析 JSON…');
                        let data;
                        try { data = JSON.parse(text); }
                        catch (pe) { throw new Error('JSON 解析失败：文件可能损坏或过大（可改用 ZIP 备份）'); }
                        await importFromJson(data, onP);
                    }
                    setProgress(100, '完成');
                });
            } finally {
                setTimeout(hideProgress, 700);
            }
        }
        pendingFile = null;
        try { fileInput.value = ''; } catch (e) {}
    } catch (e) {
        pendingFile = null;
        try { fileInput.value = ''; } catch (e2) {}
        setTimeout(() => alert('操作失败：' + (e.message || e)), 100);
    }
}

function setLoadingText(btnId, text) {
    const btn = $(btnId);
    if (!btn) return;
    const status = btn.querySelector('.item-text-status');
    if (status) status.textContent = text;
}

async function withLoading(btnId, loadingText, task) {
    const btn = $(btnId);
    if (!btn) return task();
    const status = btn.querySelector('.item-text-status');
    const original = status ? status.textContent : '';
    btn.classList.add('loading');
    if (status) status.textContent = loadingText;
    try {
        await task();
        if (status) status.textContent = '完成';
        setTimeout(() => {
            if (status) status.textContent = original;
            btn.classList.remove('loading');
        }, 1200);
    } catch (e) {
        btn.classList.remove('loading');
        if (status) status.textContent = original;
        throw e;
    }
}

// 文件选择
const fileInput = $('fileInput');

function triggerFileInput() {
    fileInput.accept = '.json,.zip';
    fileInput.click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    pendingFile = file;
    openAlert('importConfirm', file.name);
    // 注意：这里不要清空 event.target.value。
    // iOS 上清空后 File 句柄会失效，后续 JSZip.loadAsync / file.text() 会一直挂起（一直转）。
    // 统一在导入结束后（executeAction）再清空。
}

// ================= 单个角色 导出 / 导入 =================
const CHAR_BACKUP_TYPE = 'nano-single-char-backup';

function charLocalStorageKeys(charId) {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (
                k === 'chat_messages_' + charId ||
                k === 'chat_reply_pending_' + charId ||
                k === 'chat_req_' + charId ||
                k === 'chat_cleared_' + charId ||
                k === 'nano_moment_img_round_' + charId ||
                k === 'voice_call_seconds_' + charId
            ) { out.push(k); continue; }
            if (k.indexOf('chat_setting_') === 0 && k.slice(-(charId.length + 1)) === '_' + charId) out.push(k);
        }
    } catch (e) {}
    return out;
}

function idbReadAll(dbName, storeName) {
    return openDatabase(dbName).then((db) => new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
            const tx = db.transaction(storeName, 'readonly');
            getAllRecords(tx.objectStore(storeName)).then((rows) => { db.close(); resolve(rows || []); });
        } catch (e) { try { db.close(); } catch (e2) {} resolve([]); }
    })).catch(() => []);
}

function idbPutRecord(dbName, storeName, key, value) {
    return openDatabase(dbName).then((db) => new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(false); return; }
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            if (store.keyPath) store.put(value); else store.put(value, key);
            txDone(tx).then(() => { db.close(); resolve(true); });
        } catch (e) { try { db.close(); } catch (e2) {} resolve(false); }
    })).catch(() => false);
}

// localforage 默认库：库名 localforage、存储 keyvaluepairs（无 keyPath）。
// 新设备上该库可能还不存在，需要按 localforage 的结构补建，否则聊天记录写不进去。
function idbPutLocalforage(rows) {
    if (!rows || !rows.length) return Promise.resolve();
    return new Promise((resolve) => {
        const write = (db) => {
            try {
                const tx = db.transaction('keyvaluepairs', 'readwrite');
                const store = tx.objectStore('keyvaluepairs');
                rows.forEach((r) => { try { store.put(r.value, r.key); } catch (e) {} });
                tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(); };
                tx.onerror = () => { try { db.close(); } catch (e) {} resolve(); };
                tx.onabort = () => { try { db.close(); } catch (e) {} resolve(); };
            } catch (e) { try { db.close(); } catch (e2) {} resolve(); }
        };
        const req = indexedDB.open('localforage');
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('keyvaluepairs')) db.createObjectStore('keyvaluepairs');
        };
        req.onsuccess = () => {
            let db = req.result;
            if (db.objectStoreNames.contains('keyvaluepairs')) { write(db); return; }
            const v = (db.version || 1) + 1;
            db.close();
            const req2 = indexedDB.open('localforage', v);
            req2.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('keyvaluepairs')) d.createObjectStore('keyvaluepairs');
            };
            req2.onsuccess = () => write(req2.result);
            req2.onerror = () => resolve();
        };
        req.onerror = () => resolve();
    });
}

async function listCharactersForBackup() {
    const rows = await idbReadAll('nano_characters_db', 'characters');
    return rows.map((r) => r.value).filter((v) => v && v.id);
}

async function collectCharBackup(charId) {
    const character = (await listCharactersForBackup()).find((c) => c.id === charId) || null;

    const localStorageData = {};
    charLocalStorageKeys(charId).forEach((k) => { try { localStorageData[k] = localStorage.getItem(k); } catch (e) {} });

    const indexedDBData = {};

    const chars = await idbReadAll('nano_characters_db', 'characters');
    const charRow = chars.find((r) => (r.value && r.value.id === charId) || r.key === charId);
    if (charRow) indexedDBData['nano_characters_db'] = { characters: [charRow] };

    const vmem = {};
    const configRows = (await idbReadAll('nano_vector_memory_db', 'config')).filter((r) =>
        ['memlist_' + charId, 'auxchat_' + charId, 'auxmeta_' + charId, 'auxstate_' + charId].indexOf(r.key) !== -1);
    if (configRows.length) vmem.config = configRows;
    const stateRows = (await idbReadAll('nano_vector_memory_db', 'chat_state')).filter((r) =>
        r.key === charId || (r.value && r.value.chatId === charId));
    if (stateRows.length) vmem.chat_state = stateRows;
    const cmRows = (await idbReadAll('nano_vector_memory_db', 'chat_messages')).filter((r) =>
        r.key === charId || (r.value && r.value.chatId === charId));
    if (cmRows.length) vmem.chat_messages = cmRows;
    const memRows = (await idbReadAll('nano_vector_memory_db', 'memories')).filter((r) =>
        r.value && r.value.chatId === charId);
    if (memRows.length) vmem.memories = memRows;
    if (Object.keys(vmem).length) indexedDBData['nano_vector_memory_db'] = vmem;

    const phoneRows = (await idbReadAll('check_phone_db', 'app_data')).filter((r) =>
        typeof r.key === 'string' && (r.key === 'wallpaper_' + charId || r.key.indexOf('icon_' + charId + '_') === 0));
    if (phoneRows.length) indexedDBData['check_phone_db'] = { app_data: phoneRows };

    const vcRows = await idbReadAll('voice_call_' + charId, 'messages');
    if (vcRows.length) indexedDBData['voice_call_' + charId] = { messages: vcRows };

    // localforage 默认库：这里存着完整聊天记录（chat_messages_<id>）等，之前漏了这一块导致导入后没有历史
    const lfRows = (await idbReadAll('localforage', 'keyvaluepairs')).filter((r) =>
        r && r.key && String(r.key).indexOf(charId) !== -1);
    if (lfRows.length) indexedDBData['localforage'] = { keyvaluepairs: lfRows };

    let mask = null, maskAvatar = null;
    const bindUser = character && character.bindUser;
    if (bindUser) {
        const maskRows = await idbReadAll('nano_mask_db', 'mask_data');
        // mask_data 存的是 {key:'data', value:{masks,...}}，需要多取一层 value
        const maskRec = maskRows.find((r) => r.value && r.value.value && Array.isArray(r.value.value.masks));
        if (maskRec) mask = maskRec.value.value.masks.find((m) => m.id === bindUser) || null;
        if (!mask) {
            try {
                const raw = localStorage.getItem('nano_mask_data');
                const d = raw ? JSON.parse(raw) : null;
                if (d && Array.isArray(d.masks)) mask = d.masks.find((m) => m.id === bindUser) || null;
            } catch (e) {}
        }
        const avRows = await idbReadAll('MaskAvatarDB', 'avatars');
        const avRow = avRows.find((r) => r.key === bindUser || (r.value && r.value.id === bindUser));
        if (avRow) maskAvatar = avRow.value;
    }

    let worldbookFiles = [];
    const wbRows = await idbReadAll('nano_worldbook_db', 'worldbook_data');
    // worldbook_data 同样包了一层 {key:'data', value:{files,...}}
    const wbRec = wbRows.find((r) => r.value && r.value.value && Array.isArray(r.value.value.files));
    if (wbRec) {
        worldbookFiles = wbRec.value.value.files.filter((f) =>
            f && Array.isArray(f.boundCharacters) && f.boundCharacters.indexOf(charId) !== -1);
    }

    return {
        meta: { type: CHAR_BACKUP_TYPE, version: 1, charId: charId, name: (character && character.name) || '', exportedAt: new Date().toISOString() },
        character: character,
        localStorage: localStorageData,
        indexedDB: indexedDBData,
        mask: mask,
        maskAvatar: maskAvatar,
        worldbookFiles: worldbookFiles
    };
}

async function exportSelectedChar() {
    const sel = $('charSelect');
    const charId = sel && sel.value;
    if (!charId) { alert('请先选择一个角色'); return; }
    const data = await collectCharBackup(charId);
    const name = (data.meta && data.meta.name) || charId;
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), timestampName('Nano-Char-' + name, 'json'));
}

async function mergeWorldbookFiles(files) {
    if (!files || !files.length) return;
    const rows = await idbReadAll('nano_worldbook_db', 'worldbook_data');
    const rec = rows.find((r) => r.value && r.value.value && Array.isArray(r.value.value.files));
    const data = rec ? rec.value.value : { groups: [], files: [] };
    data.groups = Array.isArray(data.groups) ? data.groups : [];
    data.files = Array.isArray(data.files) ? data.files : [];
    files.forEach((f) => {
        if (!f) return;
        const idx = data.files.findIndex((x) => x && x.id === f.id);
        if (idx >= 0) data.files[idx] = f; else data.files.push(f);
    });
    await idbPutRecord('nano_worldbook_db', 'worldbook_data', 'data', { key: 'data', value: data });
    try { localStorage.setItem('nano_worldbook_data_v5', JSON.stringify(data)); } catch (e) {}
}

async function mergeMask(mask, avatar) {
    if (mask) {
        const rows = await idbReadAll('nano_mask_db', 'mask_data');
        const rec = rows.find((r) => r.value && r.value.value && Array.isArray(r.value.value.masks));
        let data = rec ? rec.value.value : null;
        if (!data) {
            // 没有 IDB 记录时以 localStorage 为底，避免覆盖掉其他人设
            try {
                const raw = localStorage.getItem('nano_mask_data');
                const d = raw ? JSON.parse(raw) : null;
                if (d && Array.isArray(d.masks)) data = d;
            } catch (e) {}
        }
        if (!data || !Array.isArray(data.masks)) data = { masks: [], currentMaskId: mask.id };
        data.masks = Array.isArray(data.masks) ? data.masks : [];
        const idx = data.masks.findIndex((m) => m && m.id === mask.id);
        const isNewMask = idx < 0;
        if (idx >= 0) data.masks[idx] = mask; else data.masks.push(mask);
        // 新导入的人设直接设为当前，导入的角色才能立刻显示/切换
        if (!data.currentMaskId || isNewMask) data.currentMaskId = mask.id;
        await idbPutRecord('nano_mask_db', 'mask_data', 'data', { key: 'data', value: data });
        try { localStorage.setItem('nano_mask_data', JSON.stringify(data)); } catch (e) {}
    }
    if (avatar && avatar.id) {
        await idbPutRecord('MaskAvatarDB', 'avatars', avatar.id, avatar);
    }
}

async function refreshCharSelect() {
    const sel = $('charSelect');
    if (!sel) return;
    const prev = sel.value;
    const chars = await listCharactersForBackup();
    sel.innerHTML = '';
    chars.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name || c.id;
        sel.appendChild(opt);
    });
    if (prev) { try { sel.value = prev; } catch (e) {} }
}

async function importCharBackup(data) {
    if (!data || !data.meta || data.meta.type !== CHAR_BACKUP_TYPE) throw new Error('不是「单个角色」备份文件');
    const ls = data.localStorage || {};
    Object.keys(ls).forEach((k) => { try { localStorage.setItem(k, ls[k]); } catch (e) {} });
    const idb = data.indexedDB || {};
    for (const dbName in idb) {
        if (dbName === 'localforage') {
            // 特殊处理：补建 localforage 结构后写入完整聊天记录
            try { await idbPutLocalforage((idb[dbName] && idb[dbName].keyvaluepairs) || []); } catch (e) {}
            continue;
        }
        for (const storeName in idb[dbName]) {
            const rows = idb[dbName][storeName] || [];
            for (const row of rows) {
                try { await idbPutRecord(dbName, storeName, row.key, row.value); } catch (e) {}
            }
        }
    }
    await mergeWorldbookFiles(data.worldbookFiles);
    await mergeMask(data.mask, data.maskAvatar);
    await refreshCharSelect();
    return data.meta;
}

function triggerCharImport() {
    const inp = $('charFileInput');
    if (inp) inp.click();
}

async function handleCharImportFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const meta = await importCharBackup(data);
        // 通知已打开的页面刷新（人设/角色/联系人）
        try { if (window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
        try { if (window.parent !== window) window.parent.postMessage({ type: 'currentMaskChanged' }, '*'); } catch (e) {}
        alert('已导入角色「' + ((meta && meta.name) || (meta && meta.charId) || '') + '」的数据');
    } catch (e) {
        alert('导入失败：' + (e && e.message ? e.message : e));
    }
}

// ================= 初始化 =================
document.addEventListener('DOMContentLoaded', () => {
    refreshCharSelect();
});