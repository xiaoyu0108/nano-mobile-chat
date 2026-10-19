/* ===== worldbook.js - 世界书逻辑 ===== */
(function() {
    'use strict';

    console.log('✅ worldbook.js 开始加载...');

    var STORAGE_KEY = 'nano_worldbook_data_v5';
    var WB_DB = 'nano_worldbook_db';
    var WB_VERSION = 1;
    var WB_STORE = 'worldbook_data';

    // ============================================================
    // DOCX 解析库按需加载（本地优先，失败回退 CDN）
    // ============================================================
    var MAMMOTH_SOURCES = [
        (window.NANO_ROOT || '') + 'js/mammoth.browser.min.js',
        'https://cdn.bootcdn.net/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
    ];
    var _mammothPromise = null;

    function ensureMammoth() {
        if (typeof mammoth !== 'undefined' && mammoth && mammoth.extractRawText) {
            return Promise.resolve(mammoth);
        }
        if (_mammothPromise) return _mammothPromise;
        _mammothPromise = new Promise(function(resolve, reject) {
            var idx = 0;
            (function tryNext() {
                if (idx >= MAMMOTH_SOURCES.length) {
                    _mammothPromise = null;
                    reject(new Error('DOCX 解析库加载失败'));
                    return;
                }
                var src = MAMMOTH_SOURCES[idx++];
                var s = document.createElement('script');
                s.src = src;
                var done = false;
                var timer = setTimeout(function() {
                    if (done) return;
                    done = true;
                    if (s.parentNode) s.parentNode.removeChild(s);
                    tryNext();
                }, 15000);
                s.onload = function() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (typeof mammoth !== 'undefined' && mammoth && mammoth.extractRawText) {
                        resolve(mammoth);
                    } else {
                        if (s.parentNode) s.parentNode.removeChild(s);
                        tryNext();
                    }
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
        return _mammothPromise;
    }

    // ============================================================
    // 备用：pako + 本地 ZIP 解析 DOCX（mammoth 不可用时兜底，避免乱码）
    // ============================================================
    var PAKO_SOURCES = [
        (window.NANO_ROOT || '') + 'js/pako.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js'
    ];
    var _pakoPromise = null;

    function ensurePako() {
        if (typeof pako !== 'undefined' && pako && pako.inflateRaw) {
            return Promise.resolve(pako);
        }
        if (_pakoPromise) return _pakoPromise;
        _pakoPromise = new Promise(function(resolve, reject) {
            var idx = 0;
            (function tryNext() {
                if (idx >= PAKO_SOURCES.length) {
                    _pakoPromise = null;
                    reject(new Error('解压库加载失败'));
                    return;
                }
                var src = PAKO_SOURCES[idx++];
                var s = document.createElement('script');
                s.src = src;
                var done = false;
                var timer = setTimeout(function() {
                    if (done) return;
                    done = true;
                    if (s.parentNode) s.parentNode.removeChild(s);
                    tryNext();
                }, 15000);
                s.onload = function() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (typeof pako !== 'undefined' && pako && pako.inflateRaw) {
                        resolve(pako);
                    } else {
                        if (s.parentNode) s.parentNode.removeChild(s);
                        tryNext();
                    }
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
        return _pakoPromise;
    }

    function docxInflateRaw(bytes) {
        try {
            if (typeof pako !== 'undefined' && pako.inflateRaw) return pako.inflateRaw(bytes);
        } catch (e) {}
        return null;
    }

    // 用中央目录方式解析 ZIP，取出 word/document.xml 并转成纯文本
    function extractDocxFallbackText(arrayBuffer) {
        try {
            var u8 = new Uint8Array(arrayBuffer);
            var dv = new DataView(arrayBuffer);
            var dec = new TextDecoder('utf-8');
            var eocd = -1;
            for (var i = u8.length - 22; i >= 0; i--) {
                if (dv.getUint32(i) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) return null;
            var count = dv.getUint16(eocd + 10);
            var cdOffset = dv.getUint32(eocd + 16);
            var found = null;
            var p = cdOffset;
            for (var n = 0; n < count; n++) {
                if (p + 46 > u8.length) break;
                if (dv.getUint32(p) !== 0x02014b50) break;
                var method = dv.getUint16(p + 10);
                var compSize = dv.getUint32(p + 20);
                var nameLen = dv.getUint16(p + 28);
                var extraLen = dv.getUint16(p + 30);
                var commentLen = dv.getUint16(p + 32);
                var localOffset = dv.getUint32(p + 42);
                var name = '';
                try { name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen)); } catch (e) {}
                if (name === 'word/document.xml') {
                    if (localOffset + 30 <= u8.length && dv.getUint32(localOffset) === 0x04034b50) {
                        var ln = dv.getUint16(localOffset + 26);
                        var le = dv.getUint16(localOffset + 28);
                        var dataStart = localOffset + 30 + ln + le;
                        if (dataStart + compSize <= u8.length) {
                            var comp = u8.subarray(dataStart, dataStart + compSize);
                            if (method === 0) found = comp;
                            else if (method === 8) found = docxInflateRaw(comp);
                        }
                    }
                    break;
                }
                p += 46 + nameLen + extraLen + commentLen;
            }
            if (!found) return null;
            var xml = dec.decode(found);
            var text = xml
                .replace(/<w:tab\s*\/>/gi, '\t')
                .replace(/<w:br\s*\/>/gi, '\n')
                .replace(/<\/w:p>/gi, '\n')
                .replace(/<w:tr>/gi, '\n')
                .replace(/<w:tc>/gi, '\t')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                .replace(/&#(\d+);/g, function(m, num) {
                    try { return String.fromCodePoint(parseInt(num, 10)); } catch (e) { return m; }
                });
            text = text.replace(/\n{3,}/g, '\n\n').trim();
            return text || null;
        } catch (e) {
            console.error('DOCX 本地解析失败:', e);
            return null;
        }
    }

    // 解析 doc/docx：mammoth 优先，失败后本地 ZIP 兜底
    function parseDocFileText(arrayBuffer) {
        return ensureMammoth().then(function(mammoth) {
            return mammoth.extractRawText({ arrayBuffer: arrayBuffer }).then(function(result) {
                var text = result.value || '';
                if (text && text.trim()) return text;
                return null;
            });
        }).catch(function() {
            return null;
        }).then(function(text) {
            if (text && text.trim()) return text;
            // 兜底：不依赖 mammoth 的本地解析
            return ensurePako().then(function() {
                return extractDocxFallbackText(arrayBuffer) || '';
            }).catch(function() {
                return '';
            });
        });
    }

    // ============================================================
    // 默认数据
    // ============================================================
    var defaultData = {
        groups: [
            { id: 'g1', name: '默认分组' }
        ],
        files: []
    };

    // ===== IndexedDB 操作 =====
    function openWBDb() {
        return new Promise(function(resolve, reject) {
            try {
                var req = indexedDB.open(WB_DB, WB_VERSION);
                req.onupgradeneeded = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(WB_STORE)) {
                        db.createObjectStore(WB_STORE, { keyPath: 'key' });
                    }
                };
                req.onsuccess = function(e) { resolve(e.target.result); };
                req.onerror = function(e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function wbIdbGet() {
        return openWBDb().then(function(db) {
            return new Promise(function(resolve) {
                try {
                    var r = db.transaction(WB_STORE, 'readonly').objectStore(WB_STORE).get('data');
                    r.onsuccess = function() { resolve(r.result ? r.result.value : null); };
                    r.onerror = function() { resolve(null); };
                } catch (e) { resolve(null); }
            });
        }).catch(function() { return null; });
    }

    function wbIdbPut(data) {
        return openWBDb().then(function(db) {
            return new Promise(function(resolve) {
                try {
                    var tx = db.transaction(WB_STORE, 'readwrite');
                    tx.objectStore(WB_STORE).put({ key: 'data', value: data });
                    tx.oncomplete = function() { resolve(); };
                    tx.onerror = function() { resolve(); };
                } catch (e) { resolve(); }
            });
        }).catch(function() {});
    }

    function saveData(d) {
        normalizeWorldbookFiles(d);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
        } catch (e) {}
        wbIdbPut(d);
    }

    // ============================================================
    // 数据加载
    // ============================================================
    var data = null;
    var isLoading = true;

    function loadDataSync() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && parsed.groups && parsed.files) {
                    console.log('⚡ 从 localStorage 加载，共 ' + parsed.files.length + ' 个世界书');
                    return parsed;
                }
            }
        } catch (e) {}
        return null;
    }

    // ============================================================
    // 内置世界书「性格与情绪」：加载时自动加入世界书列表（可编辑 / 可关闭）。
    // 关闭：localStorage.setItem('nano_builtin_wb_off','1')
    // ============================================================
    function ensureBuiltinWB() {
        try {
            var bi = window.NanoBuiltinWorldbook;
            if (!bi || !bi.entries) return false;
            try { if (localStorage.getItem('nano_builtin_wb_off') === '1') return false; } catch (e) {}
            if (!data || !Array.isArray(data.files)) return false;
            if (data.files.some(function (f) { return f && String(f.id) === String(bi.id); })) return false;
            var f = JSON.parse(JSON.stringify(bi));
            if (!Array.isArray(data.groups)) data.groups = [];
            if (!data.groups.some(function (g) { return g && String(g.id) === '内置'; })) data.groups.push({ id: '内置', name: '内置' });
            f.group = '内置';
            f.boundCharacters = [];
            f.size = Math.max(1, Math.ceil(JSON.stringify(f.entries).length / 1024)) + 'KB';
            f.ext = 'txt';
            data.files.unshift(f);
            return true;
        } catch (e) { return false; }
    }

    var cachedData = loadDataSync();

    if (cachedData) {
        data = cachedData;
        normalizeWorldbookFiles(data);
        if (ensureBuiltinWB()) { try { saveData(data); } catch (e) {} }
        isLoading = false;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { render(); });
        } else {
            render();
        }
        console.log('⚡ 页面秒开，共 ' + data.files.length + ' 个世界书');
        // 秒开之后再用 IndexedDB 校准一次：角色页导入的角色卡世界书是写进 IDB 的，
        // localStorage 缓存可能过期，这里静默刷新，保证“新世界书”能立刻看到。
        wbIdbGet().then(function(d) {
            if (d && d.groups && Array.isArray(d.files) && data) {
                var same = false;
                try { same = JSON.stringify(d) === JSON.stringify(data); } catch (e) {}
                if (!same) {
                    data = d;
                    normalizeWorldbookFiles(data);
                    if (ensureBuiltinWB()) { try { saveData(data); } catch (e) {} }
                    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
                    render();
                }
            }
        }).catch(function() {});
    } else {
        console.log('⏳ localStorage 为空，从 IndexedDB 加载...');
        data = JSON.parse(JSON.stringify(defaultData));
        ensureBuiltinWB();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { render(); });
        } else {
            render();
        }
        wbIdbGet().then(function(d) {
            if (d && d.groups) {
                data = d;
                normalizeWorldbookFiles(data);
                if (ensureBuiltinWB()) { try { saveData(data); } catch (e) {} }
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                    console.log('💾 已写入 localStorage 缓存，共 ' + data.files.length + ' 个世界书');
                } catch (e) {}
                isLoading = false;
                render();
            } else {
                data = JSON.parse(JSON.stringify(defaultData));
                ensureBuiltinWB();
                saveData(data);
                isLoading = false;
                render();
            }
        }).catch(function() {
            data = JSON.parse(JSON.stringify(defaultData));
            ensureBuiltinWB();
            saveData(data);
            isLoading = false;
            render();
        });
    }

    // ============================================================
    // 工具函数
    // ============================================================
    function getFileExt(filename) {
        if (!filename) return 'txt';
        var ext = filename.split('.').pop().toLowerCase();
        if (ext === 'json') return 'json';
        if (ext === 'doc' || ext === 'docx') return ext;
        return 'txt';
    }

    function getExtLabel(ext) {
        if (ext === 'json') return 'JSON';
        if (ext === 'docx') return 'DOCX';
        if (ext === 'doc') return 'DOC';
        return 'TXT';
    }

    function genId() { return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

    // 条目默认（绑定范围现在是整本的，条目不再保存 scope/boundCharacters）
    function defaultEntry() {
        return {
            id: genId(),
            enabled: true,
            title: '',
            keywords: '',
            keywordEnabled: true,
            vectorEnabled: false,
            permanent: false,
            position: 'before_char',
            scanDepth: 4,
            priority: 100,
            probability: 100,
            content: '',
            collapsed: false
        };
    }

    // ===== 状态 =====
    var multiMode = false;
    var selected = new Set();
    var view = 'all';
    var currentFileId = null;
    var entries = [];
    var allCharsForBind = [];
    var charBindLoaded = false;

    // ===== DOM 引用 =====
    var backBtn = document.getElementById('backBtn');
    var editBackBtn = document.getElementById('editBackBtn');
    var saveBtn = document.getElementById('saveBtn');
    var importBtn = document.getElementById('importBtn');
    var addBtn = document.getElementById('addBtn');
    var editModeBtn = document.getElementById('editModeBtn');
    var searchInput = document.getElementById('searchInput');
    var itemGrid = document.getElementById('itemGrid');
    var navRight = document.getElementById('navRight');
    var navTitle = document.querySelector('.navbar .title');
    var mainPage = document.getElementById('mainPage');
    var editPage = document.getElementById('editPage');
    var editTitle = document.getElementById('editTitle');
    var wbTitle = document.getElementById('wbTitle');
    var wbGroup = document.getElementById('wbGroup');
    var fileScopeRadios = document.getElementById('fileScopeRadios');
    var fileScopeHint = document.getElementById('fileScopeHint');
    var fileBoundDisplay = document.getElementById('fileBoundDisplay');
    var fileCharBind = document.getElementById('fileCharBind');
    var fileCharBindList = document.getElementById('fileCharBindList');
    var onlinePillRow = document.getElementById('onlinePillRow');
    var innerSearchInput = document.getElementById('innerSearchInput');
    var innerAddBtn = document.getElementById('innerAddBtn');
    var cardContainer = document.getElementById('cardContainer');
    var newGroupRow = document.getElementById('newGroupRow');
    var newGroupName = document.getElementById('newGroupName');
    var confirmNewGroup = document.getElementById('confirmNewGroup');
    var cancelNewGroup = document.getElementById('cancelNewGroup');
    var iosOverlay = document.getElementById('iosOverlay');
    var alertClose = document.getElementById('alertClose');
    var alertTitle = document.getElementById('alertTitle');
    var alertSub = document.getElementById('alertSub');
    var alertInput = document.getElementById('alertInput');
    var alertSelect = document.getElementById('alertSelect');
    var alertBtns = document.getElementById('alertBtns');
    var fileInput = document.getElementById('device-file-input');

    // ============================================================
    // 弹窗系统 (iOS风格)
    // ============================================================
    function showAlert(title, sub, inputPlaceholder, selectOptions, buttons, callback, inputValue) {
        if (!alertTitle || !alertSub) {
            alert(title + '\n' + sub);
            return;
        }
        alertTitle.textContent = title || '提示';
        alertSub.textContent = sub || '';
        if (alertClose) alertClose.onclick = closeAlert;

        if (inputPlaceholder && !selectOptions) {
            if (alertInput) {
                alertInput.style.display = 'block';
                alertInput.placeholder = inputPlaceholder;
                alertInput.value = inputValue || '';
                alertInput.className = 'alert-input-field';
                setTimeout(function() { alertInput.focus(); alertInput.select(); }, 150);
            }
            if (alertSelect) alertSelect.style.display = 'none';
        } else if (selectOptions && selectOptions.length > 0) {
            if (alertInput) alertInput.style.display = 'none';
            if (alertSelect) {
                alertSelect.style.display = 'block';
                alertSelect.className = 'alert-select-field';
                alertSelect.innerHTML = '';
                selectOptions.forEach(function(opt) {
                    var o = document.createElement('option');
                    o.value = opt.value;
                    o.textContent = opt.label;
                    alertSelect.appendChild(o);
                });
            }
        } else {
            if (alertInput) alertInput.style.display = 'none';
            if (alertSelect) alertSelect.style.display = 'none';
        }

        if (alertBtns) {
            alertBtns.innerHTML = '';
            buttons.forEach(function(btn, index) {
                var b = document.createElement('button');
                b.textContent = btn.label;
                b.className = 'alert-btn ' + (btn.type || 'cancel');
                if (index === buttons.length - 1 && btn.type !== 'delete') {
                    b.style.fontWeight = '600';
                }
                b.onclick = function(e) {
                    e.stopPropagation();
                    var val = alertInput && alertInput.style.display !== 'none' ? alertInput.value :
                        alertSelect && alertSelect.style.display !== 'none' ? alertSelect.value : null;
                    closeAlert();
                    if (callback) callback(btn.action, val);
                };
                alertBtns.appendChild(b);
            });
        }

        if (iosOverlay) iosOverlay.classList.add('show');
    }

    function closeAlert() {
        if (iosOverlay) iosOverlay.classList.remove('show');
    }

    if (iosOverlay) {
        iosOverlay.addEventListener('click', function(e) {
            if (e.target === this) closeAlert();
        });
    }

    // ============================================================
    // 角色绑定相关
    // ============================================================
    // ============================================================
    // 读取当前人设 id（兼容 nano_mask_data / nano_home_data / peach_home_data）
    // ============================================================
    function readCurrentMaskId() {
        var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
        for (var i = 0; i < keys.length; i++) {
            try {
                var raw = localStorage.getItem(keys[i]);
                if (!raw) continue;
                var d = JSON.parse(raw);
                if (d && Array.isArray(d.masks) && d.currentMaskId) return d.currentMaskId;
            } catch (e) {}
        }
        return null;
    }

    // 根据字符 id 比较“更晚创建”（id 尾部为时间戳）
    function charIdNewer(a, b) {
        var na = parseInt(String(a || '').replace(/^[^\d]+/, ''), 10) || 0;
        var nb = parseInt(String(b || '').replace(/^[^\d]+/, ''), 10) || 0;
        return nb >= na ? b : a;
    }

    // ⭐ 清理残留角色：未绑定任何 user 的 + 当前 user 下重名重复的角色
    // 返回需删除的 id 列表；不改动其它 user 已绑定的角色
    function collectResidualCharIds(chars, maskId) {
        var del = [];
        if (!maskId) return del;
        var bestByName = {};
        var order = [];
        chars.forEach(function(c) {
            var bindUser = c.bindUser || '';
            if (bindUser === '') { del.push(c.id); return; }
            if (bindUser !== maskId) return; // 属于其它 user 的保留
            var name = c.name || '';
            if (bestByName[name] === undefined) {
                bestByName[name] = c.id;
                order.push(name);
            } else {
                var keep = charIdNewer(bestByName[name], c.id);
                if (keep !== bestByName[name]) {
                    del.push(bestByName[name]);
                    bestByName[name] = keep;
                } else {
                    del.push(c.id);
                }
            }
        });
        return del;
    }

    function deleteCharacterIds(ids, cb) {
        if (!ids || !ids.length) { if (cb) cb(); return; }
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onupgradeneeded = function(e) {
                try {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                } catch (err) {}
            };
            req.onsuccess = function(e) {
                try {
                    var db = e.target.result;
                    var tx = db.transaction('characters', 'readwrite');
                    ids.forEach(function(id) { tx.objectStore('characters').delete(id); });
                    tx.oncomplete = function() { if (cb) cb(); };
                    tx.onerror = function() { if (cb) cb(); };
                } catch (err) { if (cb) cb(); }
            };
            req.onerror = function() { if (cb) cb(); };
        } catch (e) { if (cb) cb(); }
    }

    function loadAllCharactersForBind() {
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onupgradeneeded = function(e) {
                try {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                } catch (err) {}
            };
            req.onsuccess = function(e) {
                try {
                    var db = e.target.result;
                    var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
                    r.onsuccess = function() {
                        var rawChars = r.result || [];
                        var maskId = readCurrentMaskId();
                        // 残留角色自动清理（未绑定 user / 当前 user 下重名）
                        var toDelete = collectResidualCharIds(rawChars, maskId);
                        if (toDelete.length) {
                            deleteCharacterIds(toDelete, function() {
                                loadAllCharactersForBind();
                                return;
                            });
                            // 同时从所有世界书 boundCharacters 中清除这些 id
                            var removed = new Set(toDelete);
                            var changed = false;
                            (data.files || []).forEach(function(f) {
                                if (!Array.isArray(f.boundCharacters)) return;
                                var before = f.boundCharacters.length;
                                f.boundCharacters = f.boundCharacters.filter(function(id) { return !removed.has(id); });
                                if (f.boundCharacters.length !== before) changed = true;
                            });
                            if (changed) saveData(data);
                            return;
                        }
                        // 构建绑定用角色列表：有当前 user 时只显示该 user 的角色
                        var list = maskId
                            ? rawChars.filter(function(c) { return (c.bindUser || '') === maskId; })
                            : rawChars;
                        allCharsForBind = list.map(function(c) { return { id: c.id, name: c.name || '未命名', bindUser: c.bindUser || '' }; });
                        charBindLoaded = true;
                        pruneOrphanBindings();
                        if (editPage && editPage.classList.contains('active')) {
                            renderFileBoundArea();
                        }
                    };
                } catch (err) { charBindLoaded = true; }
            };
            req.onerror = function() { charBindLoaded = true; };
        } catch (e) { charBindLoaded = true; }
    }

    // ============================================================
    // 整本绑定（file 级）：scope / boundCharacters 属于整本，不再属于条目
    // ============================================================
    function currentFile() {
        return currentFileId ? (data.files.find(function(f) { return f.id === currentFileId; }) || null) : null;
    }

    // 数据规范化：条目上的旧 scope/boundCharacters 收敛到整本（file 级）
    function normalizeWorldbookFiles(d) {
        var target = d || data;
        if (!target || !Array.isArray(target.files)) return;
        target.files.forEach(function(f) {
            if (!Array.isArray(f.entries)) f.entries = [];
            if (f.scope === 'offline') f.scope = 'global';   // 旧的「线下」已取消，回退为全局
            if (f.scope === undefined) {
                var hasLocal = f.entries.some(function(e) { return (e.scope || 'global') === 'local'; });
                f.scope = hasLocal ? 'local' : 'global';
                var bound = [];
                f.entries.forEach(function(e) {
                    if ((e.scope || 'global') === 'local' && Array.isArray(e.boundCharacters)) {
                        e.boundCharacters.forEach(function(id) {
                            if (bound.indexOf(id) === -1) bound.push(id);
                        });
                    }
                });
                f.boundCharacters = bound;
            }
            if (!Array.isArray(f.boundCharacters)) f.boundCharacters = [];
            f.entries.forEach(function(e) {
                delete e.scope;
                delete e.boundCharacters;
            });
        });
    }

    // 清理：删除已经不存在角色的绑定 id（如旧的 1、2、22 等）
    function pruneOrphanBindings() {
        if (!charBindLoaded || !data) return;
        var changed = false;
        (data.files || []).forEach(function(f) {
            if (!Array.isArray(f.boundCharacters)) { f.boundCharacters = []; return; }
            var before = f.boundCharacters.length;
            f.boundCharacters = f.boundCharacters.filter(function(id) {
                return allCharsForBind.some(function(c) { return c.id === id; });
            });
            if (f.boundCharacters.length !== before) changed = true;
        });
        if (changed) saveData(data);
    }

    function getFileScope() {
        var f = currentFile();
        return f ? (f.scope || 'global') : 'global';
    }

    function setFileScopeRadios(scope) {
        if (!fileScopeRadios) return;
        var radios = fileScopeRadios.querySelectorAll('input');
        radios.forEach(function(r) { r.checked = r.value === scope; });
    }

    function renderFileCharChips() {
        if (!fileCharBindList) return;
        fileCharBindList.innerHTML = '';
        fileCharBindList.style.maxHeight = '';
        fileCharBindList.style.overflowY = '';
        var f = currentFile();
        var bound = (f && Array.isArray(f.boundCharacters)) ? f.boundCharacters : [];
        if (!charBindLoaded || allCharsForBind.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'char-bind-empty';
            empty.textContent = '暂无角色，请先到「角色」页面创建角色';
            fileCharBindList.appendChild(empty);
            return;
        }
        var selected = new Set(bound);
        allCharsForBind.forEach(function(c) {
            var chip = document.createElement('div');
            chip.className = 'char-chip' + (selected.has(c.id) ? ' checked' : '');
            chip.dataset.cid = c.id;
            var dot = document.createElement('span');
            dot.className = 'dot';
            chip.appendChild(dot);
            var nm = document.createElement('span');
            nm.textContent = c.name || '未命名';
            chip.appendChild(nm);
            chip.addEventListener('click', function() {
                var f2 = currentFile();
                if (!f2) return;
                var cid = this.dataset.cid;
                var idx = f2.boundCharacters.indexOf(cid);
                if (idx > -1) f2.boundCharacters.splice(idx, 1);
                else f2.boundCharacters.push(cid);
                saveData(data);
                renderFileBoundArea();
            });
            fileCharBindList.appendChild(chip);
        });
        if (allCharsForBind.length > 6) {
            fileCharBindList.style.maxHeight = '150px';
            fileCharBindList.style.overflowY = 'auto';
        }
    }

    function renderFileBoundArea() {
        var scope = getFileScope();
        var isLocal = scope === 'local';       // 单人
        var isOnline = scope === 'online';     // 线上（全选 / 指定角色）
        var showBind = isLocal || isOnline;
        var f = currentFile();
        var bound = (f && Array.isArray(f.boundCharacters)) ? f.boundCharacters : [];

        if (fileScopeHint) {
            if (isLocal) fileScopeHint.textContent = '单人：仅下方绑定的角色，线上与线下都会读取（可点选/取消角色，支持多选）';
            else if (isOnline) fileScopeHint.textContent = '线上：仅线上聊天读取；默认「全选」，也可只选指定角色';
            else fileScopeHint.textContent = '全局：不限角色，线上与线下都会读取这本世界书';
        }
        if (fileCharBind) fileCharBind.classList.toggle('show', showBind);
        if (onlinePillRow) onlinePillRow.style.display = isOnline ? '' : 'none';

        // 线上：全选 / 指定角色（用 file.onlineTarget 明确记录，避免空选时死锁）
        var isPick = false;
        if (isOnline && f) {
            if (f.onlineTarget !== 'pick' && f.onlineTarget !== 'all') f.onlineTarget = bound.length ? 'pick' : 'all';
            isPick = f.onlineTarget === 'pick';
            if (onlinePillRow) onlinePillRow.querySelectorAll('.online-pill').forEach(function (b) {
                b.classList.toggle('active', (b.getAttribute('data-target') === 'pick') === isPick);
            });
            if (fileCharBindList) fileCharBindList.style.display = isPick ? '' : 'none';
        } else if (fileCharBindList) {
            fileCharBindList.style.display = '';
        }

        // 角色已不存在时，绑定标签自动清除
        if (showBind && charBindLoaded && f) {
            var before = bound.length;
            f.boundCharacters = bound.filter(function(id) {
                return allCharsForBind.some(function(ch) { return ch.id === id; });
            });
            bound = f.boundCharacters;
            if (bound.length !== before) saveData(data);
        }

        if (fileBoundDisplay) {
            fileBoundDisplay.style.display = showBind ? 'block' : 'none';
            var names = bound.map(function(id) {
                var c = allCharsForBind.find(function(ch) { return ch.id === id; });
                return c ? c.name : null;
            }).filter(function(n) { return n; });
            if (isOnline && !names.length) fileBoundDisplay.textContent = '📌 全部角色';
            else fileBoundDisplay.textContent = names.length ? '📌 已绑定角色：' + names.join('、') : '📌 未绑定任何角色';
        }
        if (showBind) renderFileCharChips();
    }

    function syncCharactersForSavedFile(file) {
        if (!file || file.scope !== 'local') return;
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onsuccess = function(e) {
                try {
                    var db = e.target.result;
                    var tx = db.transaction('characters', 'readonly');
                    var store = tx.objectStore('characters');
                    var all = store.getAll();
                    all.onsuccess = function() {
                        var chars = all.result || [];
                        var changed = [];
                        chars.forEach(function(c) {
                            var wbs = Array.isArray(c.worldbookBindings) ? c.worldbookBindings : [];
                            var idx = wbs.findIndex(function(w) { return w.id === file.id; });
                            if (file.boundCharacters.indexOf(c.id) > -1) {
                                if (idx === -1) {
                                    wbs.push({ id: file.id, group: file.group || '' });
                                    changed.push(c);
                                }
                            } else {
                                if (idx > -1) {
                                    wbs.splice(idx, 1);
                                    changed.push(c);
                                }
                            }
                        });
                        if (changed.length) {
                            var wtx = db.transaction('characters', 'readwrite');
                            changed.forEach(function(c) { wtx.objectStore('characters').put(c); });
                        }
                    };
                } catch (err) {}
            };
            req.onerror = function() {};
        } catch (e) {}
    }

    // ============================================================
    // 文件导入（含 DOCX 支持）
    // ============================================================
    function handleFileSelected(event) {
        var file = event.target.files[0];
        if (!file) return;
        var ext = getFileExt(file.name);

        if (ext === 'txt' || ext === 'json') {
            var reader = new FileReader();
            reader.onload = function(e) {
                var content = e.target.result;
                processImportedFile(file.name, content);
                event.target.value = '';
            };
            reader.onerror = function(e) {
                showAlert('错误', '读取文件失败', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
                event.target.value = '';
            };
            reader.readAsText(file, 'UTF-8');
            return;
        }

        if (ext === 'docx' || ext === 'doc') {
            event.target.value = '';
            var reader = new FileReader();
            reader.onload = function(e) {
                var arrayBuffer = e.target.result;
                parseDocFileText(arrayBuffer).then(function(content) {
                    if (!content || content.trim() === '') {
                        showAlert('提示', '未能从文件中提取到文本，请确认是有效的 DOCX 文件', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
                        return;
                    }
                    processImportedFile(file.name, content);
                }).catch(function(err) {
                    showAlert('错误', '解析 DOC/DOCX 失败: ' + (err && err.message ? err.message : '未知错误'), null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
                });
            };
            reader.onerror = function() {
                showAlert('错误', '读取文件失败', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
            };
            reader.readAsArrayBuffer(file);
            return;
        }

        showAlert('提示', '不支持的文件格式: ' + ext, null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
        event.target.value = '';
    }

    // ============================================================
    // SillyTavern 世界书 JSON → 本项目世界书（多条条目）
    // ============================================================
    function mapStPosition(pos) {
        if (pos === 'before_char' || pos === 'before_example' || pos === 0) return 'before_char';
        if (pos === 'after_char' || pos === 1) return 'after_char';
        return 'after_chat';
    }

    function extractStKeys(e) {
        var arr = [];
        ['key', 'keys', 'keywords', 'keyword'].forEach(function(k) {
            var v = e ? e[k] : null;
            if (Array.isArray(v)) arr = arr.concat(v);
            else if (typeof v === 'string') arr = arr.concat(v.split(/[,，、;；\n\r]+/));
        });
        return arr.map(function(s) { return String(s).trim(); }).filter(Boolean);
    }

    function parseSillyTavernWorldbook(content) {
        var parsed = null;
        try { parsed = JSON.parse(content); } catch (e) { parsed = null; }
        if (!parsed) return { ok: false, entries: [] };
        var rawEntries = Array.isArray(parsed) ? parsed : (parsed.entries || null);
        if (!rawEntries || !rawEntries.length) return { ok: false, entries: [] };
        var out = [];
        rawEntries.forEach(function(e) {
            if (!e || typeof e !== 'object') return;
            var stContent = (typeof e.content === 'string' ? e.content : '');
            if (!stContent || !stContent.trim()) return;
            var keys = extractStKeys(e);
            var title = (e.comment && String(e.comment).trim()) || (e.name && String(e.name).trim()) || '';
            var entry = {
                ...defaultEntry(),
                title: title,
                content: stContent,
                enabled: e.disable !== true && e.enabled !== false,
                keywords: keys.join(','),
                keywordEnabled: e.constant !== true,
                permanent: e.constant === true,
                position: mapStPosition(e.position),
                scanDepth: typeof e.scanDepth === 'number' ? e.scanDepth : (typeof e.depth === 'number' ? e.depth : 4),
                priority: typeof e.priority === 'number' ? e.priority : (typeof e.order === 'number' ? e.order : 100),
                probability: typeof e.probability === 'number' ? e.probability : 100,
                vectorEnabled: e.vectorized === true,
                collapsed: true
            };
            out.push(entry);
        });
        return { ok: out.length > 0, name: (parsed.name && String(parsed.name).trim()) || '', entries: out };
    }

    // 整本导入：整本默认全局绑定（后续可在顶部切换为局部绑定并绑定角色）
    function processImportedFile(filename, content) {
        // 如果是在内页导入到条目内容
        if (window._importTargetId && editPage.classList.contains('active')) {
            var entry = entries.find(function(e) { return e.id === window._importTargetId; });
            if (entry) {
                entry.content = content;
                saveEntries();
                renderEntries();
            }
            window._importTargetId = null;
            fileInput.value = '';
            showAlert('导入成功', '内容已导入到当前条目', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
            return;
        }

        var ext = getFileExt(filename);
        var baseName = filename.replace(/\.[^.]+$/, '');
        var importedEntries = [];
        var bookName = baseName;

        // JSON：尝试按酒馆世界书分条目
        if (ext === 'json') {
            var st = parseSillyTavernWorldbook(content);
            if (st.ok && st.entries.length) {
                importedEntries = st.entries;
                if (st.name) bookName = st.name;
            }
        }

        // 非标准 JSON / txt / docx：整本内容放入一个条目并设为常驻（默认折叠）
        if (importedEntries.length === 0) {
            var whole = defaultEntry();
            whole.content = content;
            whole.permanent = true;
            whole.keywordEnabled = false;
            whole.title = '';
            whole.collapsed = true;
            importedEntries = [whole];
        }

        var newFile = {
            id: 'f_' + Date.now(),
            name: bookName,
            entries: importedEntries,
            group: null,
            scope: 'global',
            boundCharacters: [],
            size: Math.ceil(content.length / 1024) + 'KB',
            ext: ext
        };
        data.files.push(newFile);
        saveData(data);
        render();
        fileInput.value = '';
        showAlert('导入成功', '已导入 ' + newFile.name + '\n共 ' + importedEntries.length + ' 个条目', null, null, [{ label: '确定',
            action: 'ok', type: 'confirm' }]);
    }

    // ============================================================
    // 外页渲染
    // ============================================================
    function render() {
        if (!itemGrid) return;

        if (!data) {
            itemGrid.innerHTML = '<div class="empty-state">⏳ 加载中...</div>';
            updateNav();
            return;
        }

        var grid = itemGrid;
        var items = [];
        var groups = data.groups || [];
        var files = (data.files || []);

        var displayFiles = files;
        if (view !== 'all') {
            displayFiles = files.filter(function(f) { return f.group === view; });
        } else {
            displayFiles = files.filter(function(f) { return !f.group; });
        }

        if (view === 'all') {
            groups.forEach(function(g) {
                var count = files.filter(function(f) { return f.group === g.id; }).length;
                items.push({ type: 'folder', id: g.id, name: g.name, count: count });
            });
        }

        displayFiles.forEach(function(f) {
            var ext = f.ext || getFileExt(f.name);
            items.push({ type: 'file', id: f.id, name: f.name, size: f.size || '0KB', ext: ext });
        });

        items.sort(function(a, b) {
            if (a.type === 'folder' && b.type === 'file') return -1;
            if (a.type === 'file' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name, 'zh');
        });

        if (items.length === 0) {
            var msg = view !== 'all' ? '此分组暂无世界书' : '暂无世界书';
            grid.innerHTML = '<div class="empty-state">' + msg + '</div>';
            updateNav();
            return;
        }

        var html = '';
        items.forEach(function(item) {
            if (item.type === 'folder') {
                var sel = selected.has(item.id) ? ' selected' : '';
                html += '<div class="folder-item' + (multiMode ? ' multi' : '') + sel + '" data-id="' + item.id + '" data-type="folder">' +
                    '<div class="check"></div>' +
                    '<div class="folder-icon">' +
                    '<div class="back"></div>' +
                    '<div class="front"></div>' +
                    '</div>' +
                    '<div class="folder-name-wrap">' +
                    '<span class="folder-name">' + item.name + '</span>' +
                    '<button class="folder-more">⋮</button>' +
                    '</div>' +
                    '<div class="folder-count">' + item.count + '项</div>' +
                    '</div>';
            } else {
                var sel2 = selected.has(item.id) ? ' selected' : '';
                var extLabel = getExtLabel(item.ext);
                var extClass = item.ext === 'json' ? 'json' : (item.ext === 'docx' || item.ext === 'doc') ? 'docx' : 'txt';
                html += '<div class="file-item' + (multiMode ? ' multi' : '') + sel2 + '" data-id="' + item.id + '" data-type="file">' +
                    '<div class="check"></div>' +
                    '<div class="file-icon">' +
                    '<div class="lines"><span></span><span></span><span></span></div>' +
                    '<span class="ext-label ' + extClass + '">' + extLabel + '</span>' +
                    '</div>' +
                    '<div class="file-name">' + item.name + '</div>' +
                    '<div class="file-size">' + item.size + '</div>' +
                    '</div>';
            }
        });
        grid.innerHTML = html;

        // 文件夹事件
        grid.querySelectorAll('.folder-item').forEach(function(el) {
            var id = el.dataset.id;

            var nameEl = el.querySelector('.folder-name');
            if (nameEl) {
                nameEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (multiMode) {
                        toggleSelect(id);
                        return;
                    }
                    view = id;
                    render();
                });
            }

            var moreBtn = el.querySelector('.folder-more');
            if (moreBtn) {
                moreBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (multiMode || view !== 'all') return;
                    var folder = data.groups.find(function(g) { return g.id === id; });
                    if (!folder) return;
                    showAlert(
                        '重命名分组',
                        '输入新的分组名称',
                        '分组名称', null, [
                            { label: '取消', action: 'cancel', type: 'cancel' },
                            { label: '确定', action: 'confirm', type: 'confirm' }
                        ],
                        function(action, val) {
                            if (action === 'confirm' && val && val.trim()) {
                                folder.name = val.trim();
                                saveData(data);
                                render();
                            }
                        },
                        folder.name
                    );
                });
            }

            el.addEventListener('click', function(e) {
                if (e.target.closest('.folder-more') || e.target.closest('.folder-name')) return;
                if (multiMode) {
                    toggleSelect(id);
                    return;
                }
                view = id;
                render();
            });
        });

        // 文件点击
        grid.querySelectorAll('.file-item').forEach(function(el) {
            var id = el.dataset.id;
            el.addEventListener('click', function() {
                if (multiMode) {
                    toggleSelect(id);
                    return;
                }
                openEditPage(id);
            });
        });

        updateNav();
    }

    function toggleSelect(id) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        render();
    }

    // ============================================================
    // 导航栏
    // ============================================================
    function updateNav() {
        if (!navRight) return;

        if (navTitle) {
            if (view !== 'all') {
                var folder = data ? data.groups.find(function(g) { return g.id === view; }) : null;
                navTitle.textContent = folder ? folder.name : '世界书';
            } else {
                navTitle.textContent = '世界书';
            }
        }

        if (backBtn) {
            backBtn.onclick = function() {
                if (view !== 'all') {
                    if (multiMode) exitEditMode();
                    view = 'all';
                    render();
                    return;
                }
                try {
                    window.parent.postMessage({ type: 'closeFullscreen' }, '*');
                } catch(e) {
                    window.location.href = 'UI.html';
                }
            };
        }

        if (multiMode) {
            var count = selected.size;
            navRight.innerHTML = '';
            var delBtn = document.createElement('button');
            delBtn.textContent = count > 0 ? '删除(' + count + ')' : '删除';
            delBtn.style.color = '#FF3B30';
            delBtn.style.fontWeight = '500';
            delBtn.onclick = function() {
                if (count === 0) {
                    showAlert('提示', '请先选择要删除的项目', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
                    return;
                }
                deleteSelected();
            };
            navRight.appendChild(delBtn);
            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.color = '#007AFF';
            cancelBtn.style.fontWeight = '500';
            cancelBtn.onclick = exitEditMode;
            navRight.appendChild(cancelBtn);
            return;
        }

        navRight.innerHTML = '<button id="editModeBtn">编辑</button>';
        var newEditBtn = document.getElementById('editModeBtn');
        if (newEditBtn) {
            newEditBtn.onclick = toggleEditMode;
        }

        var bottomActions = document.getElementById('bottomActions');
        if (bottomActions) {
            bottomActions.style.display = (multiMode || editPage.classList.contains('active')) ? 'none' : 'flex';
        }
    }

    // ============================================================
    // 编辑模式
    // ============================================================
    function toggleEditMode() {
        if (multiMode) {
            exitEditMode();
        } else {
            enterEditMode();
        }
    }

    function enterEditMode() {
        var items = getCurrentItems();
        if (items.length === 0) {
            showAlert('提示', '没有可编辑的项目', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
            return;
        }
        multiMode = true;
        selected.clear();
        if (mainPage) mainPage.classList.add('edit-mode');
        render();
    }

    function exitEditMode() {
        multiMode = false;
        selected.clear();
        if (mainPage) mainPage.classList.remove('edit-mode');
        render();
    }

    function getCurrentItems() {
        var items = [];
        var groups = data.groups || [];
        var files = (data.files || []);
        var displayFiles = view !== 'all' ? files.filter(function(f) { return f.group === view; }) : files.filter(function(f) { return !f
                .group; });
        if (view === 'all') {
            groups.forEach(function(g) { items.push({ type: 'folder', id: g.id }); });
        }
        displayFiles.forEach(function(f) { items.push({ type: 'file', id: f.id }); });
        return items;
    }

    function deleteSelected() {
        if (selected.size === 0) return;
        showAlert(
            '删除确认',
            '确定删除选中的 ' + selected.size + ' 个项目吗？',
            null, null, [
                { label: '取消', action: 'cancel', type: 'cancel' },
                { label: '删除', action: 'confirm', type: 'delete' }
            ],
            function(action) {
                if (action === 'confirm') {
                    data.files = data.files.filter(function(f) { return !selected.has(f.id); });
                    if (view === 'all') {
                        data.groups = data.groups.filter(function(g) { return !selected.has(g.id); });
                    }
                    saveData(data);
                    multiMode = false;
                    selected.clear();
                    if (mainPage) mainPage.classList.remove('edit-mode');
                    view = 'all';
                    render();
                }
            }
        );
    }

    // ============================================================
    // 内页 (编辑世界书条目)
    // ============================================================
    function populateGroupSelect() {
        var sel = wbGroup;
        var currentVal = sel.value;
        sel.innerHTML = '<option value="">未分组</option>';
        // 添加"新建分组"选项
        var addOption = document.createElement('option');
        addOption.value = '__new__';
        addOption.textContent = '+ 新建分组';
        (data.groups || []).forEach(function(g) {
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            sel.appendChild(opt);
        });
        sel.appendChild(addOption);
        if (currentVal) sel.value = currentVal;

        // 监听新建分组
        sel.onchange = function() {
            if (this.value === '__new__') {
                if (newGroupRow) newGroupRow.classList.add('show');
                this.value = '';
            }
        };
    }

    function openEditPage(fileId) {
        if (!editPage) return;
        currentFileId = fileId;
        var file = data.files.find(function(f) { return f.id === fileId; });
        if (file) {
            entries = file.entries || [];
            editTitle.textContent = file.name || '世界书条目';
            wbTitle.value = file.name || '';
            wbGroup.value = file.group || '';
            file.scope = file.scope || 'global';
            if (!Array.isArray(file.boundCharacters)) file.boundCharacters = [];
        } else {
            var newFile = {
                id: 'f_' + Date.now(),
                name: '新建世界书',
                entries: [],
                group: null,
                scope: 'global',
                boundCharacters: [],
                size: '0KB',
                ext: 'txt'
            };
            data.files.push(newFile);
            saveData(data);
            currentFileId = newFile.id;
            entries = [];
            editTitle.textContent = '新建世界书';
            wbTitle.value = '';
            wbGroup.value = '';
        }
        populateGroupSelect();
        setFileScopeRadios((data.files.find(function(f) { return f.id === currentFileId; }) || {}).scope || 'global');
        renderFileBoundArea();
        renderEntries();
        editPage.classList.add('active');
        updateNav();
        loadAllCharactersForBind();
    }

    function closeEditPage() {
        var file = data.files.find(function(f) { return f.id === currentFileId; });
        if (file) {
            file.name = wbTitle.value.trim() || '未命名';
            file.group = wbGroup.value || null;
            file.entries = entries;
            file.scope = file.scope || 'global';
            if (!Array.isArray(file.boundCharacters)) file.boundCharacters = [];
            saveData(data);
            // 同步整本绑定到角色快照
            if (file.scope === 'local') {
                syncCharactersForSavedFile({ id: file.id, group: file.group, scope: file.scope, boundCharacters: file.boundCharacters });
            }
        }
        editPage.classList.remove('active');
        currentFileId = null;
        entries = [];
        updateNav();
        render();
    }

    function saveEntries() {
        var file = data.files.find(function(f) { return f.id === currentFileId; });
        if (file) {
            file.entries = entries;
            file.name = wbTitle.value.trim() || '未命名';
            file.group = wbGroup.value || null;
            saveData(data);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderEntries(filterText) {
        if (!cardContainer) return;
        filterText = filterText || innerSearchInput.value || '';

        var filtered = entries;
        if (filterText.trim()) {
            var f = filterText.trim().toLowerCase();
            filtered = entries.filter(function(e) {
                var title = (e.title || '').toLowerCase();
                var kw = (e.keywords || '').toLowerCase();
                var content = (e.content || '').toLowerCase();
                return title.indexOf(f) > -1 || kw.indexOf(f) > -1 || content.indexOf(f) > -1;
            });
        }

        if (filtered.length === 0) {
            cardContainer.innerHTML = '<div class="empty-state">没有条目，点击 + 新建</div>';
            return;
        }

        var html = '';
        filtered.forEach(function(entry) {
            var enabled = entry.enabled !== false;
            var collapsed = entry.collapsed === true;

            html += '<div class="card" data-id="' + entry.id + '">';
            html += '<div class="card-header">';
            html += '<input class="title-input" placeholder="条目标题 (不发送给AI)" value="' + escapeHtml(entry.title || '') + '" data-id="' + entry.id + '">';
            html += '<div class="actions">';
            html += '<div class="toggle ' + (enabled ? 'active' : '') + '" data-id="' + entry.id + '"><div class="thumb"></div></div>';
            html += '<svg class="delete-svg" data-id="' + entry.id + '" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            html += '<svg class="collapse-svg" data-id="' + entry.id + '" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:' + (collapsed ? 'rotate(-90deg)' : 'rotate(0deg)') + ';"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            html += '</div></div>';

            html += '<div class="card-body' + (collapsed ? ' collapsed' : '') + '">';

            // 触发方式：常驻/关键词/向量
            html += '<div class="form-row">';
            html += '<div class="form-label"><span>触发方式</span><span class="hint">三选一或组合</span></div>';
            html += '<div class="checkbox-group">';
            html += '<label><input type="checkbox" class="permanent-check" data-id="' + entry.id + '" ' + (entry.permanent ?
                'checked' : '') + '> 常驻</label>';
            html += '<label><input type="checkbox" class="keyword-check" data-id="' + entry.id + '" ' + (entry
                .keywordEnabled !== false ? 'checked' : '') + '> 关键词</label>';
            html += '<label><input type="checkbox" class="vector-check" data-id="' + entry.id + '" ' + (entry.vectorEnabled ?
                'checked' : '') + '> 向量</label>';
            html += '</div></div>';

            // 关键词输入框
            html += '<div class="form-row" id="keywordRow_' + entry.id + '" style="' + (entry.keywordEnabled !== false ? '' :
                'display:none;') + '">';
            html += '<input class="form-control keyword-input" placeholder="关键词，逗号分隔" value="' + escapeHtml(entry
                .keywords || '') + '" data-id="' + entry.id + '">';
            html += '</div>';

            // 插入位置 + 扫描深度
            html += '<div class="form-row">';
            html += '<div class="form-row-inline">';
            html += '<span class="label-sm">插入位置</span>';
            html += '<select class="form-control position-select" data-id="' + entry.id + '" style="flex:2;">';
            html += '<option value="before_char" ' + (entry.position === 'before_char' ? 'selected' : '') + '>角色描述之前</option>';
            html += '<option value="after_char" ' + (entry.position === 'after_char' ? 'selected' : '') + '>角色描述之后</option>';
            html += '<option value="after_chat" ' + (entry.position === 'after_chat' ? 'selected' : '') + '>聊天末尾</option>';
            html += '</select>';
            html += '<span class="label-sm">扫描深度</span>';
            html += '<input class="form-control scan-depth" type="number" min="1" max="20" value="' + (entry.scanDepth || 4) +
                '" data-id="' + entry.id + '" style="width:60px;">';
            html += '</div></div>';

            // 优先级 + 概率
            html += '<div class="form-row">';
            html += '<div class="form-row-inline">';
            html += '<span class="label-sm">优先级</span>';
            html += '<input class="form-control priority-input" type="number" min="0" max="999" value="' + (entry.priority ||
                100) + '" data-id="' + entry.id + '" style="width:60px;">';
            html += '<span class="label-sm">概率%</span>';
            html += '<input class="form-control prob-input" type="number" min="0" max="100" value="' + (entry.probability ||
                100) + '" data-id="' + entry.id + '" style="width:60px;">';
            html += '</div></div>';

            // 条目内容
            html += '<div class="form-row textarea-wrap">';
            html += '<div class="textarea-header">';
            html += '<span style="font-size:13px;font-weight:500;color:#1C1C1E;">条目内容</span>';
            html += '<svg class="import-svg" data-id="' + entry.id + '" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>';
            html += '</div>';
            html += '<textarea class="content-textarea" data-id="' + entry.id + '" placeholder="输入设定内容...">' + escapeHtml(
                entry.content || '') + '</textarea>';
            html += '</div>';

            html += '<div class="save-row">';
            html += '<button class="clone-btn" data-id="' + entry.id + '">复制条目</button>';
            html += '<button class="save-btn" data-id="' + entry.id + '">保存</button>';
            html += '</div>';

            html += '</div></div>';
        });

        cardContainer.innerHTML = html;

        // 关键词checkbox切换
        filtered.forEach(function(entry) {
            var kwCheck = document.querySelector('.keyword-check[data-id="' + entry.id + '"]');
            if (kwCheck) {
                kwCheck.addEventListener('change', function() {
                    entry.keywordEnabled = this.checked;
                    var row = document.getElementById('keywordRow_' + entry.id);
                    if (row) row.style.display = this.checked ? '' : 'none';
                    saveEntries();
                });
            }
        });
    }

    // ============================================================
    // 内页事件委托
    // ============================================================
    cardContainer.addEventListener('click', function(e) {
        var target = e.target.closest('[data-id]');
        if (!target) return;
        var id = target.dataset.id;
        var entry = entries.find(function(e) { return e.id === id; });
        if (!entry) return;

        // toggle开关
        if (target.classList.contains('toggle') || target.closest('.toggle')) {
            var tog = target.closest('.toggle') || target;
            entry.enabled = !entry.enabled;
            saveEntries();
            renderEntries();
            return;
        }

        // 折叠
        if (target.classList.contains('collapse-svg') || target.closest('.collapse-svg')) {
            entry.collapsed = !entry.collapsed;
            saveEntries();
            renderEntries();
            return;
        }

        // 删除
        if (target.classList.contains('delete-svg') || target.closest('.delete-svg')) {
            showAlert(
                '删除条目',
                '确定永久删除此条目吗？',
                null, null, [
                    { label: '取消', action: 'cancel', type: 'cancel' },
                    { label: '删除', action: 'confirm', type: 'delete' }
                ],
                function(action) {
                    if (action === 'confirm') {
                        entries = entries.filter(function(e) { return e.id !== id; });
                        saveEntries();
                        renderEntries();
                    }
                }
            );
            return;
        }

        // 保存（不弹“已保存”确认框）
        if (target.classList.contains('save-btn')) {
            saveEntries();
            return;
        }

        // 复制
        if (target.classList.contains('clone-btn')) {
            var clone = JSON.parse(JSON.stringify(entry));
            clone.id = genId();
            clone.title = (clone.title || '') + ' (副本)';
            entries.push(clone);
            saveEntries();
            renderEntries();
            return;
        }

        // 导入内容
        if (target.classList.contains('import-svg') || target.closest('.import-svg')) {
            window._importTargetId = id;
            fileInput.click();
            return;
        }
    });

    // 内页 input 事件
    cardContainer.addEventListener('input', function(e) {
        var target = e.target;
        if (!target.dataset.id) return;
        var id = target.dataset.id;
        var entry = entries.find(function(e) { return e.id === id; });
        if (!entry) return;

        if (target.classList.contains('title-input')) {
            entry.title = target.value;
            saveEntries();
        } else if (target.classList.contains('keyword-input')) {
            entry.keywords = target.value;
            saveEntries();
        } else if (target.classList.contains('content-textarea')) {
            entry.content = target.value;
            saveEntries();
        } else if (target.classList.contains('scan-depth')) {
            var v = parseInt(target.value, 10);
            if (!isNaN(v) && v > 0) entry.scanDepth = v;
            saveEntries();
        } else if (target.classList.contains('priority-input')) {
            var v = parseInt(target.value, 10);
            if (!isNaN(v)) entry.priority = v;
            saveEntries();
        } else if (target.classList.contains('prob-input')) {
            var v = parseInt(target.value, 10);
            if (!isNaN(v) && v >= 0 && v <= 100) entry.probability = v;
            saveEntries();
        }
    });

    // 内页 change 事件
    cardContainer.addEventListener('change', function(e) {
        var target = e.target;
        if (!target.dataset.id) return;
        var id = target.dataset.id;
        var entry = entries.find(function(e) { return e.id === id; });
        if (!entry) return;

        if (target.classList.contains('position-select')) {
            entry.position = target.value;
            saveEntries();
        } else if (target.classList.contains('permanent-check')) {
            entry.permanent = target.checked;
            if (entry.permanent) {
                entry.vectorEnabled = false;
                entry.keywordEnabled = false;
                var kwCheck = document.querySelector('.keyword-check[data-id="' + id + '"]');
                if (kwCheck) kwCheck.checked = false;
                var vecCheck = document.querySelector('.vector-check[data-id="' + id + '"]');
                if (vecCheck) vecCheck.checked = false;
                var row = document.getElementById('keywordRow_' + id);
                if (row) row.style.display = 'none';
            }
            saveEntries();
            renderEntries();
        } else if (target.classList.contains('keyword-check')) {
            entry.keywordEnabled = target.checked;
            if (entry.keywordEnabled) {
                entry.permanent = false;
                entry.vectorEnabled = false;
                var permCheck = document.querySelector('.permanent-check[data-id="' + id + '"]');
                if (permCheck) permCheck.checked = false;
                var vecCheck = document.querySelector('.vector-check[data-id="' + id + '"]');
                if (vecCheck) vecCheck.checked = false;
                var row = document.getElementById('keywordRow_' + id);
                if (row) row.style.display = '';
            } else {
                var row = document.getElementById('keywordRow_' + id);
                if (row) row.style.display = 'none';
            }
            saveEntries();
            renderEntries();
        } else if (target.classList.contains('vector-check')) {
            entry.vectorEnabled = target.checked;
            if (entry.vectorEnabled) {
                entry.permanent = false;
                entry.keywordEnabled = false;
                var permCheck = document.querySelector('.permanent-check[data-id="' + id + '"]');
                if (permCheck) permCheck.checked = false;
                var kwCheck = document.querySelector('.keyword-check[data-id="' + id + '"]');
                if (kwCheck) kwCheck.checked = false;
                var row = document.getElementById('keywordRow_' + id);
                if (row) row.style.display = 'none';
            }
            saveEntries();
            renderEntries();
        }
    });

    // ============================================================
    // 内页搜索
    // ============================================================
    innerSearchInput.addEventListener('input', function() {
        renderEntries(this.value);
    });

    // ============================================================
    // 内页新建条目
    // ============================================================
    innerAddBtn.addEventListener('click', function() {
        var newEntry = defaultEntry();
        newEntry.keywordEnabled = true;
        entries.push(newEntry);
        saveEntries();
        renderEntries();
        newEntry.collapsed = false;
        saveEntries();
        renderEntries();
    });

    // ============================================================
    // 文件导入 (外页)
    // ============================================================
    importBtn.addEventListener('click', function() {
        fileInput.click();
    });

    addBtn.addEventListener('click', function() {
        var newFile = {
            id: 'f_' + Date.now(),
            name: '新建世界书',
            entries: [],
            group: null,
            scope: 'global',
            boundCharacters: [],
            size: '0KB',
            ext: 'txt'
        };
        data.files.push(newFile);
        saveData(data);
        render();
        openEditPage(newFile.id);
    });

    // ============================================================
    // file input 事件绑定 (支持 DOCX)
    // ============================================================
    fileInput.addEventListener('change', handleFileSelected);

    // ============================================================
    // 编辑页返回 & 保存
    // ============================================================
    editBackBtn.addEventListener('click', closeEditPage);

    saveBtn.addEventListener('click', function() {
        var file = data.files.find(function(f) { return f.id === currentFileId; });
        if (file) {
            file.name = wbTitle.value.trim() || '未命名';
            file.group = wbGroup.value || null;
            file.entries = entries;
            file.scope = file.scope || 'global';
            if (!Array.isArray(file.boundCharacters)) file.boundCharacters = [];
            saveData(data);
            // 整本绑定 → 同步角色快照
            if (file.scope === 'local') {
                syncCharactersForSavedFile({ id: file.id, group: file.group, scope: file.scope, boundCharacters: file.boundCharacters });
            }
        }
        // ⭐ 保存后自动关闭编辑页，退回世界书主页面（不弹“已保存”确认框）
        closeEditPage();
    });

    // ⭐ 整本绑定范围切换
    if (fileScopeRadios) {
        fileScopeRadios.addEventListener('change', function(e) {
            if (!e.target || e.target.name !== 'fileScope') return;
            var f = currentFile();
            if (!f) return;
            f.scope = e.target.value;
            if (f.scope === 'online') { f.onlineTarget = 'all'; f.boundCharacters = []; }
            else if (f.scope !== 'local') { f.boundCharacters = []; }
            saveData(data);
            renderFileBoundArea();
        });
    }
    // ⭐ 线上：全选 / 指定角色 胶囊
    if (onlinePillRow) {
        onlinePillRow.addEventListener('click', function(e) {
            var b = e.target && e.target.closest ? e.target.closest('.online-pill') : null;
            if (!b) return;
            var f = currentFile();
            if (!f) return;
            var target = b.getAttribute('data-target');
            f.onlineTarget = target === 'pick' ? 'pick' : 'all';
            if (f.onlineTarget === 'all') f.boundCharacters = [];
            saveData(data);
            renderFileBoundArea();
        });
    }

    // ============================================================
    // 新建分组
    // ============================================================
    if (confirmNewGroup) {
        confirmNewGroup.addEventListener('click', function() {
            var name = newGroupName.value.trim();
            if (!name) {
                showAlert('提示', '请输入分组名称', null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
                return;
            }
            var newGroup = { id: 'g_' + Date.now(), name: name };
            data.groups.push(newGroup);
            saveData(data);
            populateGroupSelect();
            if (newGroupRow) newGroupRow.classList.remove('show');
            newGroupName.value = '';
            wbGroup.value = newGroup.id;
            showAlert('成功', '已创建分组: ' + name, null, null, [{ label: '确定', action: 'ok', type: 'confirm' }]);
        });
    }

    if (cancelNewGroup) {
        cancelNewGroup.addEventListener('click', function() {
            if (newGroupRow) newGroupRow.classList.remove('show');
            newGroupName.value = '';
        });
    }

    // ============================================================
    // 初始化
    // ============================================================
    loadAllCharactersForBind();

    document.addEventListener('DOMContentLoaded', function() {
        console.log('📄 DOM 加载完成');
        render();
    });

    window.closeAlert = closeAlert;
    console.log('✅ worldbook.js 加载完成');

})();