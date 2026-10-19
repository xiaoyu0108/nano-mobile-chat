// ============================================================
// memory.js - 向量记忆系统（总结 + 向量独立配置）
// ============================================================
(function() {
    'use strict';

    // ===== DOM 引用 =====
    // 总结 API
    const llmUrl = document.getElementById('llmUrl');
    const llmKey = document.getElementById('llmKey');
    const llmModelSelect = document.getElementById('llmModelSelect');
    const fetchLlmModelsBtn = document.getElementById('fetchLlmModelsBtn');
    const testLlmBtn = document.getElementById('testLlmBtn');

    // 向量 API
    const embUrl = document.getElementById('embUrl');
    const embKey = document.getElementById('embKey');
    const embModelSelect = document.getElementById('embModelSelect');
    const fetchEmbModelsBtn = document.getElementById('fetchEmbModelsBtn');
    const testEmbBtn = document.getElementById('testEmbBtn');

    // 策略
    const contextLimit = document.getElementById('contextLimit');
    const autoSummaryToggle = document.getElementById('autoSummaryToggle');
    const autoThreshold = document.getElementById('autoThreshold');
    const autoThresholdRow = document.getElementById('autoThresholdRow');
    const currentUnsummed = document.getElementById('currentUnsummed');
    const totalMemories = document.getElementById('totalMemories');
    const manualSummaryBtn = document.getElementById('manualSummaryBtn');
    const memoryListContainer = document.getElementById('memoryListContainer');

    // 弹窗
    const modalTextarea = document.getElementById('modalTextarea');
    const modalDate = document.getElementById('modalDate');
    const modalMemType = document.getElementById('modalMemType');
    const modalRelatedChar = document.getElementById('modalRelatedChar');
    const modalVectorStatus = document.getElementById('modalVectorStatus');

    // Toast
    const toastOverlay = document.getElementById('toastOverlay');
    const toastText = document.getElementById('toastText');
    const toastProgressBar = document.getElementById('toastProgressBar');

    let currentEditId = null;
    let isProcessing = false;
    let unsummedCount = 0;
    let memoryListExpanded = false;

    // 后台生成：通知主框架本次总结仍在进行，返回时保活该页面（不中断生成）
    try { if (window.NanoRefresh) window.NanoRefresh.define({ id: 'memory', name: '记忆', url: 'memory.html', title: '记忆' }); } catch (e) {}
    function notifyRefresh(phase, body) {
        try {
            if (!window.NanoRefresh) return;
            if (phase === 'start') window.NanoRefresh.start({ key: 'summary', label: '总结记忆' });
            else if (phase === 'success') window.NanoRefresh.success(body || '', { key: 'summary' });
            else window.NanoRefresh.fail(body || '总结失败', { key: 'summary' });
        } catch (e) {}
    }
    // 页面是否正在前台显示（后台生成时不弹阻塞式 alert，交给主框架通知）
    function isPageVisible() {
        try {
            if (document.hidden) return false;
            const fe = window.frameElement;
            if (fe && (fe.style.display === 'none' || fe.offsetParent === null)) return false;
        } catch (e) {}
        return true;
    }

    // ============================================================
    // IndexedDB
    // ============================================================
    const DB_NAME = 'nano_vector_memory_db';
    const DB_VERSION = 5;

    const STORES = {
        MEMORIES: 'memories',
        CONFIG: 'config',
        CHAT_STATE: 'chat_state',
        CHAT_MESSAGES: 'chat_messages'
    };

    // 每次操作都打开一个全新的连接并用完即关，避免缓存连接被版本变更置为过期导致写后读不到
    function withDB(fn) {
        return new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                const tx = e.target.transaction;
                if (!db.objectStoreNames.contains(STORES.MEMORIES)) {
                    const s = db.createObjectStore(STORES.MEMORIES, { keyPath: 'id' });
                    s.createIndex('chatId', 'chatId', { unique: false });
                    s.createIndex('type', 'type', { unique: false });
                    s.createIndex('hasVector', 'hasVector', { unique: false });
                } else {
                    try {
                        const s = tx.objectStore(STORES.MEMORIES);
                        if (!s.indexNames.contains('chatId')) s.createIndex('chatId', 'chatId', { unique: false });
                        if (!s.indexNames.contains('type')) s.createIndex('type', 'type', { unique: false });
                        if (!s.indexNames.contains('hasVector')) s.createIndex('hasVector', 'hasVector', { unique: false });
                    } catch (e) {}
                }
                if (!db.objectStoreNames.contains(STORES.CONFIG)) db.createObjectStore(STORES.CONFIG, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(STORES.CHAT_STATE)) db.createObjectStore(STORES.CHAT_STATE, { keyPath: 'chatId' });
                if (!db.objectStoreNames.contains(STORES.CHAT_MESSAGES)) db.createObjectStore(STORES.CHAT_MESSAGES, { keyPath: 'chatId' });
            };
            req.onerror = () => reject(req.error);
            req.onsuccess = (e) => {
                const conn = e.target.result;
                conn.onversionchange = () => { try { conn.close(); } catch (e) {} };
                Promise.resolve()
                    .then(() => fn(conn))
                    .then((r) => { try { conn.close(); } catch (e) {} resolve(r); })
                    .catch((err) => { try { conn.close(); } catch (e) {} reject(err); });
            };
        });
    }

    function dbPut(store, data) {
        return withDB((conn) => new Promise((resolve, reject) => {
            try {
                const tx = conn.transaction(store, 'readwrite');
                tx.objectStore(store).put(data);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbGet(store, key) {
        return withDB((conn) => new Promise((resolve, reject) => {
            try {
                const req = conn.transaction(store, 'readonly').objectStore(store).get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbGetAll(store) {
        return withDB((conn) => new Promise((resolve, reject) => {
            try {
                const req = conn.transaction(store, 'readonly').objectStore(store).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbGetAllIndex(store, index, value) {
        return withDB((conn) => new Promise((resolve, reject) => {
            try {
                const req = conn.transaction(store, 'readonly').objectStore(store).index(index).getAll(value);
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }));
    }

    function dbDelete(store, key) {
        return withDB((conn) => new Promise((resolve, reject) => {
            try {
                const tx = conn.transaction(store, 'readwrite');
                tx.objectStore(store).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            } catch (e) { reject(e); }
        }));
    }

    // ============================================================
    // 记忆 CRUD（用 config 存储以 chatId 为 key 的列表，key=d val=value 可靠读写）
    // ============================================================
    function memListKey(chatId) { return 'memlist_' + chatId; }

    function getAllMemories(chatId) {
        if (!chatId) return Promise.resolve([]);
        // 群聊模式：聚合群里每个角色的 memlist_<charId>
        if (IS_GROUP && chatId === getChatId()) return getGroupAllMemories();
        // 单聊：大号 / 小号 互通，合并本人 + 名下所有小号的记忆
        if (window.NanoMemLink && window.NanoMemLink.readList) {
            return window.NanoMemLink.readList(chatId).catch(function() { return []; });
        }
        // 直接用 key 读取（与 config 的设置读取一样可靠），不再依赖 getAll+过滤
        return dbGet(STORES.CONFIG, memListKey(chatId)).then(function(r) {
            return (r && Array.isArray(r.value)) ? r.value : [];
        }).catch(function() { return []; });
    }

    function getMemory(id) {
        return getAllMemories(getChatId()).then(function(list) {
            return list.find(function(m) { return m && m.id === id; }) || null;
        });
    }

    function storeMemory(item) {
        // 读当前列表 -> 追加/替换 -> 写回（群聊模式下 item.chatId 是角色 id）
        // 单聊：小号记忆统一写进大号记忆库
        if (!IS_GROUP && item && item.chatId && window.NanoMemLink && window.NanoMemLink.originIdOf) {
            return window.NanoMemLink.originIdOf(item.chatId).then(function(origin) {
                return dbGet(STORES.CONFIG, memListKey(origin)).then(function(r) {
                    var list = (r && Array.isArray(r.value)) ? r.value : [];
                    const idx = list.findIndex(function(m) { return m && m.id === item.id; });
                    if (idx >= 0) list[idx] = item; else list.push(item);
                    return dbPut(STORES.CONFIG, { key: memListKey(origin), value: list });
                });
            });
        }
        return getAllMemories(item.chatId).then(function(list) {
            if (!Array.isArray(list)) list = [];
            const idx = list.findIndex(function(m) { return m && m.id === item.id; });
            if (idx >= 0) list[idx] = item; else list.push(item);
            return dbPut(STORES.CONFIG, { key: memListKey(item.chatId), value: list });
        });
    }

    function deleteMemoryFromDB(id) {
        if (IS_GROUP) {
            return getGroupAllMemories().then(function (all) {
                const item = (all || []).find(function (x) { return x && x.id === id; });
                const ownerId = (item && (item.groupMemberId || item.chatId)) || getChatId();
                return getAllMemories(ownerId).then(function (list) {
                    const newList = (list || []).filter(function (m) { return !(m && m.id === id); });
                    return dbPut(STORES.CONFIG, { key: memListKey(ownerId), value: newList });
                });
            });
        }
        const chatId = getChatId();
        if (window.NanoMemLink && window.NanoMemLink.originIdOf) {
            return window.NanoMemLink.originIdOf(chatId).then(function(origin) {
                const keys = (String(origin) === String(chatId)) ? [origin] : [origin, String(chatId)];
                return Promise.all(keys.map(function(k) {
                    return dbGet(STORES.CONFIG, memListKey(k)).then(function(r) {
                        const list = (r && Array.isArray(r.value)) ? r.value : [];
                        const newList = list.filter(function(m) { return !(m && m.id === id); });
                        return dbPut(STORES.CONFIG, { key: memListKey(k), value: newList });
                    });
                }));
            });
        }
        return getAllMemories(chatId).then(function(list) {
            const newList = (list || []).filter(function(m) { return !(m && m.id === id); });
            return dbPut(STORES.CONFIG, { key: memListKey(chatId), value: newList });
        });
    }

    // ============================================================
    // 配置 CRUD
    // ============================================================
    function getConfig(key) { return dbGet(STORES.CONFIG, key).then(r => r ? r.value : null); }
    function setConfig(key, value) { return dbPut(STORES.CONFIG, { key, value }); }

    // ============================================================
    // Chat 状态
    // ============================================================
    function getChatState(chatId) {
        if (IS_GROUP) return getGroupSummaryState().then(s => ({ chatId: chatId, summarizedCount: (s && s.summarizedCount) || 0 }));
        return dbGet(STORES.CHAT_STATE, chatId).then(r => r || { chatId, summarizedCount: 0 });
    }
    function setChatState(chatId, data) {
        if (IS_GROUP) return setGroupSummaryState({ summarizedCount: (data && data.summarizedCount) || 0 });
        return dbPut(STORES.CHAT_STATE, { chatId, ...data });
    }

    // ============================================================
    // 聊天消息
    // ============================================================
    function getChatMessages(chatId) {
        if (IS_GROUP) return Promise.resolve(getGroupMessages());
        return dbGet(STORES.CHAT_MESSAGES, chatId).then(r => r ? r.messages : []);
    }
    function setChatMessages(chatId, messages) {
        if (IS_GROUP) return Promise.resolve();
        return dbPut(STORES.CHAT_MESSAGES, { chatId, messages, updatedAt: Date.now() });
    }

    // ============================================================
    // 工具
    // ============================================================
    function getChatId() {
        try {
            const sp = new URLSearchParams(window.location.search);
            const c = sp.get('chat');
            if (c) return c;
        } catch (e) {}
        try {
            const info = JSON.parse(sessionStorage.getItem('last_chat_info') || 'null');
            if (info && info.chatId) return info.chatId;
        } catch (e) {}
        return 'default';
    }

    // ============================================================
    // 群聊模式：按成员读写 memlist_<charId>（用群上下文总结）
    // ============================================================
    const IS_GROUP = (function () {
        try { return new URLSearchParams(window.location.search).get('group') === '1'; } catch (e) { return false; }
    })();

    function getGroupInfo() {
        const gid = getChatId();
        let gd = null;
        try { gd = JSON.parse(localStorage.getItem('group_data_' + gid) || 'null'); } catch (e) {}
        const members = (gd && Array.isArray(gd.members) ? gd.members : [])
            .filter(function (m) { return m && m.id && m.id !== 'me'; });
        return { groupId: gid, name: (gd && gd.name) || '群聊', members: members };
    }

    function getGroupMessages() {
        try { return JSON.parse(localStorage.getItem('group_msgs_' + getChatId()) || '[]') || []; } catch (e) { return []; }
    }

    function getGroupSummaryState() {
        return getConfig('group_summary_state_' + getChatId()).then(function (v) {
            return (v && typeof v === 'object') ? v : { summarizedCount: 0 };
        });
    }
    function setGroupSummaryState(s) {
        return setConfig('group_summary_state_' + getChatId(), { summarizedCount: (s && s.summarizedCount) || 0 });
    }

    // 汇总群里每个角色各自的 memlist_<charId>
    function getGroupAllMemories() {
        const info = getGroupInfo();
        return Promise.all(info.members.map(function (m) {
            return getAllMemories(m.id).then(function (list) {
                return (list || []).filter(function (it) {
                    // 排除其他群的记忆，避免不同群/私聊记忆互相串
                    return !(it && it.groupId && it.groupId !== info.groupId);
                }).map(function (it) {
                    return Object.assign({}, it, {
                        relatedChar: it.relatedChar || m.nick || m.name || m.id,
                        groupMemberId: m.id,
                        chatId: m.id
                    });
                });
            });
        })).then(function (rows) { return [].concat.apply([], rows); });
    }

    function getCharacterInfo() {
        let charName = '角色', currentUser = '用户';
        try {
            const homeKeys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
            let data = null;
            for (let i = 0; i < homeKeys.length; i++) {
                const raw = localStorage.getItem(homeKeys[i]);
                if (raw) {
                    const d = JSON.parse(raw);
                    if (d && Array.isArray(d.masks)) { data = d; break; }
                }
            }
            if (data) {
                const masks = data.masks || [];
                const user = masks.find(m => m.id === data.currentMaskId);
                if (user) currentUser = user.name || '用户';
            }
        } catch (e) {}
        try {
            const sp = new URLSearchParams(window.location.search);
            const nm = sp.get('name');
            if (nm) charName = decodeURIComponent(nm);
        } catch (e) {}
        try {
            const info = JSON.parse(sessionStorage.getItem('last_chat_info') || 'null');
            if (info && info.chatName) charName = info.chatName;
        } catch (e) {}
        return { charName, currentUser };
    }

    function getBaseUrl(url) {
        let u = url.trim();
        if (!u) return '';
        if (!u.endsWith('/v1')) u = u.endsWith('/') ? u + 'v1' : u + '/v1';
        return u;
    }

    // 通知父页面/当前会话：记忆库发生变化，立即重载长期记忆
    function notifyMemoryUpdated() {
        try {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'NANO_MEMORY_UPDATED', chatId: getChatId() }, '*');
            }
        } catch (e) {}
    }

    // ============================================================
    // 加载/保存设置
    // ============================================================
    function ensureSelectOption(select, value) {
        if (!select || !value) return;
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === value) return;
        }
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
    }

    async function loadSettings() {
        const keys = ['llmUrl', 'llmKey', 'llmModel', 'embUrl', 'embKey', 'embModel',
            'contextLimit', 'autoSummary', 'autoThreshold', 'unsummedCount'];
        const vals = await Promise.all(keys.map(k => getConfig(k)));
        const [u1, k1, m1, u2, k2, m2, limit, auto, thresh, unsummed] = vals;

        if (u1) llmUrl.value = u1;
        if (k1) llmKey.value = k1;
        if (m1) { ensureSelectOption(llmModelSelect, m1); llmModelSelect.value = m1; }
        if (u2) embUrl.value = u2;
        if (k2) embKey.value = k2;
        if (m2) { ensureSelectOption(embModelSelect, m2); embModelSelect.value = m2; }
        if (limit) contextLimit.value = limit;
        if (auto !== null) autoSummaryToggle.checked = auto;
        if (thresh) autoThreshold.value = thresh;
        if (unsummed !== null) unsummedCount = unsummed;

        updateAutoUI();
        updateUnsummedUI();
    }

    async function saveSettings() {
        await Promise.all([
            setConfig('llmUrl', llmUrl.value),
            setConfig('llmKey', llmKey.value),
            setConfig('llmModel', llmModelSelect.value),
            setConfig('embUrl', embUrl.value),
            setConfig('embKey', embKey.value),
            setConfig('embModel', embModelSelect.value),
            setConfig('contextLimit', parseInt(contextLimit.value) || 30),
            setConfig('autoSummary', autoSummaryToggle.checked),
            setConfig('autoThreshold', parseInt(autoThreshold.value) || 20),
            setConfig('unsummedCount', unsummedCount)
        ]);
    }

    [llmUrl, llmKey, llmModelSelect, embUrl, embKey, embModelSelect,
        contextLimit, autoSummaryToggle, autoThreshold]
        .forEach(el => {
            el.addEventListener('change', saveSettings);
            el.addEventListener('input', saveSettings);
        });

    function updateAutoUI() {
        autoThresholdRow.style.display = autoSummaryToggle.checked ? 'flex' : 'none';
    }
    autoSummaryToggle.addEventListener('change', updateAutoUI);

    async function updateUnsummedUI() {
        try {
            const chatId = getChatId();
            const state = await getChatState(chatId);
            const messages = await getChatMessages(chatId);
            const summarized = state.summarizedCount || 0;
            unsummedCount = Math.max(0, messages.length - summarized);
            await setConfig('unsummedCount', unsummedCount);
            currentUnsummed.textContent = unsummedCount + ' 条';
            const all = await getAllMemories(chatId);
            totalMemories.textContent = all.length + ' 条';
        } catch (e) {
            console.error('[Memory] 刷新计数失败', e);
        }
    }

    // ============================================================
    // Toast
    // ============================================================
    function showToast(text, progress) {
        toastOverlay.classList.add('active');
        toastText.textContent = text;
        toastProgressBar.style.width = (progress !== undefined ? Math.min(100, progress) : 100) + '%';
    }
    function hideToast() { toastOverlay.classList.remove('active'); toastProgressBar.style.width = '0%'; }
    function updateToastProgress(text, progress) {
        toastText.textContent = text;
        toastProgressBar.style.width = Math.min(100, progress) + '%';
    }

    // ============================================================
    // 拉取模型列表
    // ============================================================
    async function fetchModels(urlInput, keyInput, selectEl, btn) {
        const url = urlInput.value.trim(), key = keyInput.value.trim();
        if (!url || !key) { alert('请先填写接口地址和 API Key'); return; }

        btn.textContent = '拉取中...';
        btn.disabled = true;

        try {
            const baseUrl = getBaseUrl(url);
            const allModels = [];
            let after = '';
            let page = 0;

            // 分页拉取所有模型
            while (true) {
                const query = after ? ('?after=' + encodeURIComponent(after)) : '';
                const resp = await fetch(baseUrl + '/models' + query, {
                    method: 'GET', headers: { 'Authorization': 'Bearer ' + key }
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                const models = data.data || data.models || [];
                allModels.push(...models);

                const hasMore = data.has_more;
                const lastId = data.last_id || (models.length ? (models[models.length - 1].id || models[models.length - 1]) : '');
                if (!hasMore || !lastId || page > 50) break;
                after = lastId;
                page++;
            }

            // 去重
            const seen = new Set();
            const unique = allModels.filter(m => {
                const id = (m && m.id) || m;
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            });

            selectEl.innerHTML = '<option value="">请选择模型</option>';
            unique.forEach(m => {
                const id = (m && m.id) || m;
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = id;
                selectEl.appendChild(opt);
            });
            if (unique.length > 0) selectEl.value = unique[0].id || unique[0];

            await saveSettings();
            btn.textContent = '成功 (' + unique.length + ' 个)';
            setTimeout(() => { btn.textContent = '拉取模型列表'; btn.disabled = false; }, 2000);

        } catch (err) {
            alert('拉取失败: ' + err.message);
            btn.textContent = '拉取模型列表';
            btn.disabled = false;
        }
    }

    fetchLlmModelsBtn.addEventListener('click', function() {
        fetchModels(llmUrl, llmKey, llmModelSelect, this);
    });

    fetchEmbModelsBtn.addEventListener('click', function() {
        fetchModels(embUrl, embKey, embModelSelect, this);
    });

    // ============================================================
    // 测试连接
    // ============================================================
    async function testConnection(urlInput, keyInput, btn) {
        const url = urlInput.value.trim(), key = keyInput.value.trim();
        if (!url || !key) { alert('请先填写接口地址和 API Key'); return; }

        btn.textContent = '测试中...';
        btn.disabled = true;

        try {
            const resp = await fetch(getBaseUrl(url) + '/models', {
                method: 'GET', headers: { 'Authorization': 'Bearer ' + key }
            });
            if (resp.ok) { btn.textContent = '连接成功'; btn.style.color = '#34c759'; }
            else throw new Error('HTTP ' + resp.status);
        } catch (err) {
            btn.textContent = '连接失败';
            btn.style.color = '#ff3b30';
            alert('连接失败: ' + err.message);
        }
        setTimeout(() => {
            btn.textContent = '测试连接';
            btn.style.color = '#34c759';
            btn.disabled = false;
        }, 2000);
    }

    testLlmBtn.addEventListener('click', function() { testConnection(llmUrl, llmKey, this); });
    testEmbBtn.addEventListener('click', function() { testConnection(embUrl, embKey, this); });

    // ============================================================
    // API 调用
    // ============================================================
    function getLlmConfig() {
        const url = llmUrl.value.trim(), key = llmKey.value.trim(), model = llmModelSelect.value;
        if (!url || !key || !model) throw new Error('请配置总结 API');
        return { url: getBaseUrl(url), key, model };
    }

    function getEmbConfig() {
        const url = embUrl.value.trim(), key = embKey.value.trim(), model = embModelSelect.value;
        if (!url || !key || !model) return null;
        return { url: getBaseUrl(url), key, model };
    }

    async function callLlm(messages) {
        const cfg = getLlmConfig();
        const resp = await fetch(cfg.url + '/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.model, messages, max_tokens: 4000, temperature: 0.5 })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error('LLM 失败: ' + (err.error?.message || resp.statusText));
        }
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async function getEmbedding(text) {
        const cfg = getEmbConfig();
        if (!cfg) return null;

        const resp = await fetch(cfg.url + '/embeddings', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.model, input: text, encoding_format: 'float' })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error('Embedding 失败: ' + (err.error?.message || resp.statusText));
        }
        const data = await resp.json();
        return data.data?.[0]?.embedding || null;
    }

    // ============================================================
    // 执行总结
    // ============================================================
    async function performSummary(messages, isAuto) {
        if (isProcessing) return;
        if (IS_GROUP) return performGroupSummary(messages, isAuto);
        const chatId = getChatId();

        if (!messages || messages.length === 0) {
            messages = await getChatMessages(chatId);
            const state = await getChatState(chatId);
            messages = messages.slice(state.summarizedCount || 0);
            if (messages.length === 0) {
                if (!isAuto) alert('没有需要总结的新消息');
                return;
            }
        }

        isProcessing = true;
        if (!isAuto) { manualSummaryBtn.classList.add('loading'); manualSummaryBtn.disabled = true; notifyRefresh('start'); }
        showToast('分析聊天记录...', 10);

        try {
            const { charName, currentUser } = getCharacterInfo();

            // 构建对话文本
            const chatText = messages.map(m => {
                let content = m.text || '';
                if (m.isCard && m.cardData) {
                    const cd = m.cardData;
                    if (cd.cardType === 'transfer') content = '[转账: ' + (cd.amount || '') + ']';
                    else if (cd.cardType === 'gift') content = '[礼物: ' + (cd.title || '') + ']';
                    else if (cd.cardType === 'call') content = '[通话] ' + (cd.missed ? '未接通' : cd.duration || '');
                }
                if (m.isImage) content = '[图片] ' + (m.imageData?.desc || '');
                if (m.isVoice) content = '[语音] ' + (m.voiceData?.duration || 3) + '秒';
                return (m.type === 'right' ? currentUser : charName) + '：' + content;
            }).join('\n');

            if (!chatText.trim()) {
                hideToast();
                if (!isAuto) { manualSummaryBtn.classList.remove('loading'); manualSummaryBtn.disabled = false; notifyRefresh('fail', '没有可总结的内容'); }
                isProcessing = false;
                return;
            }

            updateToastProgress('提取关键信息...', 30);

            const summary = await callLlm([
                { role: 'system', content: `你是记忆提取助手，从角色与用户的聊天记录中提取值得长期记住的信息，用于构建向量记忆库。

必须重点提取、尽量详细记录：
1. 重要事件：双方经历的大事，如约定、见面、纪念日、吵架和好、项目进展等。
2. ${currentUser}的习惯与偏好：作息、饮食、喜好、雷区、口头禅、性格特点。
3. 双方关系与情感：是异地恋、朋友还是家人；相处模式、称呼、亲昵方式。
4. 地理位置：${charName}和${currentUser}各自所在的城市/地点，尤其是异地恋时双方的位置。
5. 社交关系：双方认识的人、家人、朋友、同事等关系网。
6. 情感状态与承诺：说过的重要的话、答应过的事、情绪变化。
7. 其他值得记住的细节。

格式：每条独立一行，以【类型】开头，如：
【重要事件】${charName}和${currentUser}约定下周在长沙见面，${charName}住在岳麓区，${currentUser}住在五一广场附近。
【${currentUser}偏好】${currentUser}喜欢喝冰美式，不吃香菜，习惯凌晨一点睡。
【地理位置】${charName}在长沙，${currentUser}在上海，两人是异地恋，隔着大约900公里。

要求：
- 记忆是长期使用的，越具体越详细越好，保留名字、地点、数字，不要模糊概括。
- 每条记忆60-150字，宁可写多不要写少。
- 只输出有实质内容的记忆，不要泛泛而谈。` },
                { role: 'user', content: chatText }
            ]);

            if (!summary.trim()) throw new Error('AI 未返回内容');

            updateToastProgress('生成记忆...', 60);

            const lines = summary.split('\n').filter(l => l.trim());
            const items = [];

            // 检查是否有向量配置
            const hasVector = !!(embUrl.value.trim() && embKey.value.trim() && embModelSelect.value);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                let type = '其他', content = line;
                const match = line.match(/^【(.+?)】/);
                if (match) { type = match[1]; content = line.replace(/^【.+?】/, '').trim(); }
                if (!content) continue;

                let embedding = null;
                if (hasVector) {
                    try {
                        embedding = await getEmbedding(content);
                    } catch (e) {
                        console.warn('[Memory] 向量化失败:', e.message);
                    }
                }

                items.push({
                    id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    type, content,
                    embedding: embedding || null,
                    hasVector: !!embedding,
                    date: new Date().toISOString(),
                    relatedChar: charName,
                    chatId: chatId,
                    source: isAuto ? 'auto' : 'manual'
                });

                updateToastProgress('处理 ' + (i + 1) + '/' + lines.length,
                    60 + ((i + 1) / lines.length) * 30);
            }

            for (const item of items) await storeMemory(item);

            if (items.length === 0) {
                // 没有提取到有效记忆：不消耗未总结计数，避免消息凭空消失
                console.warn('[Memory] 本次未提取到有效记忆，未总结计数保留，chatId=', chatId);
                hideToast();
                if (!isAuto) {
                    manualSummaryBtn.classList.remove('loading');
                    manualSummaryBtn.disabled = false;
                    notifyRefresh('fail', '未提取到有效记忆');
                    if (isPageVisible()) alert('本次没有提取到有效记忆，请检查总结 API 配置后重试');
                } else {
                    showToast('未提取到记忆，稍后自动重试');
                    setTimeout(hideToast, 2000);
                }
                await renderMemoryList();
                isProcessing = false;
                return;
            }

            const state = await getChatState(chatId);
            state.summarizedCount = (state.summarizedCount || 0) + messages.length;
            await setChatState(chatId, state);

            unsummedCount = 0;
            await setConfig('unsummedCount', 0);
            await updateUnsummedUI();

            hideToast();
            if (!isAuto) {
                manualSummaryBtn.classList.remove('loading');
                manualSummaryBtn.disabled = false;
                const vectorStatus = hasVector ? '（已向量化）' : '（纯文本）';
                notifyRefresh('success', '已生成 ' + items.length + ' 条记忆');
                if (isPageVisible()) alert('总结完成，生成 ' + items.length + ' 条记忆 ' + vectorStatus);
            }
            console.log('[Memory] 总结完成 chatId=', chatId, '生成', items.length, '条记忆');
            await renderMemoryList();
            notifyMemoryUpdated();
            isProcessing = false;

        } catch (err) {
            console.error('[Memory]', err);
            hideToast();
            if (!isAuto) {
                manualSummaryBtn.classList.remove('loading');
                manualSummaryBtn.disabled = false;
                notifyRefresh('fail', err);
                if (isPageVisible()) alert('总结失败: ' + err.message);
            }
            isProcessing = false;
        }
    }

    // ============================================================
    // 群聊总结：用群上下文，逐成员生成 memlist_<charId>
    // ============================================================
    function buildGroupChatText(messages, info, currentUser) {
        const nameOf = function (id) {
            if (!id || id === 'me') return currentUser || '我';
            const m = info.members.find(function (x) { return x.id === id; });
            return m ? (m.nick || m.name || id) : '群友';
        };
        return (messages || []).map(function (m) {
            if (!m || m.recalled) return '';
            let content = m.text || '';
            if (m.isTip) return '（系统）' + content;
            if (m.isCard && m.cardData) {
                const cd = m.cardData;
                if (cd.cardType === 'redpacket') content = '[群红包: ' + (cd.amount || '') + '元]';
                else if (cd.cardType === 'chain') content = '[群接龙: ' + (cd.title || '') + ']';
                else if (cd.cardType === 'notice') content = '[群公告: ' + (cd.text || '') + ']';
                else content = '[卡片消息]';
            } else if (m.isImage) {
                content = '[图片] ' + ((m.imageData && m.imageData.desc) || '');
            } else if (m.isVoice) {
                content = '[语音] ' + (m.transcript || '');
            }
            if (!content) return '';
            return nameOf(m.senderId) + '：' + content;
        }).filter(Boolean).join('\n');
    }

    function groupMemberMemoryPrompt(info, mName, currentUser) {
        const u = currentUser || '用户';
        return '你是群聊「' + info.name + '」里的成员「' + mName + '」。下面是你所在群聊的完整聊天记录。\n' +
            '请完全以「' + mName + '」的第一人称视角，提取TA在这个群里值得长期记住的信息，用于长期记忆库。\n\n' +
            '必须重点提取、尽量详细记录：\n' +
            '1. 用户（' + u + '）的信息：说过的话、喜好、习惯、雷区、身份，以及与群里各人的关系。\n' +
            '2. ' + mName + ' 自己的信息：在群里的发言、立场、答应过的事、对某人的态度、情绪变化。\n' +
            '3. 群内发生的事件：约定、聚会、冲突、玩笑梗、红包/接龙/公告等。\n' +
            '4. 其他群成员与 ' + mName + ' 或用户之间的关系、互动。\n' +
            '5. 其他值得长期记住的细节。\n\n' +
            '格式：每条独立一行，以【类型】开头，例如：\n' +
            '【重要事件】在「' + info.name + '」里，' + u + '提议周末聚餐，' + mName + '答应了。\n' +
            '【' + u + '偏好】' + u + '喜欢喝冰美式，不吃香菜，习惯凌晨一点睡。\n\n' +
            '要求：\n' +
            '- 越具体越详细越好，保留名字、地点、数字，不要模糊概括。\n' +
            '- 每条 40~120 字，宁可写多不要写少。\n' +
            '- 只写「' + mName + '」真正会记住、在意的事，不要泛泛而谈。';
    }

    async function performGroupSummary(messages, isAuto) {
        const info = getGroupInfo();
        const chatId = getChatId();

        if (!info.members.length) {
            if (!isAuto) alert('这个群还没有可总结的角色成员');
            return;
        }

        if (!messages || messages.length === 0) {
            const all = getGroupMessages();
            const state = await getGroupSummaryState();
            messages = all.slice(state.summarizedCount || 0);
            if (messages.length === 0) {
                if (!isAuto) alert('没有需要总结的新消息');
                return;
            }
        }

        isProcessing = true;
        if (!isAuto) { manualSummaryBtn.classList.add('loading'); manualSummaryBtn.disabled = true; notifyRefresh('start'); }
        showToast('分析群聊记录...', 8);

        try {
            const { currentUser } = getCharacterInfo();
            const chatText = buildGroupChatText(messages, info, currentUser);
            if (!chatText.trim()) {
                hideToast();
                if (!isAuto) { manualSummaryBtn.classList.remove('loading'); manualSummaryBtn.disabled = false; notifyRefresh('fail', '没有可总结的内容'); }
                isProcessing = false;
                return;
            }

            const hasVector = !!(embUrl.value.trim() && embKey.value.trim() && embModelSelect.value);
            let total = 0;

            for (let mi = 0; mi < info.members.length; mi++) {
                const mem = info.members[mi];
                const mName = mem.nick || mem.name || mem.id;
                updateToastProgress('生成「' + mName + '」的记忆 (' + (mi + 1) + '/' + info.members.length + ')',
                    10 + (mi / info.members.length) * 80);

                const summary = await callLlm([
                    { role: 'system', content: groupMemberMemoryPrompt(info, mName, currentUser) },
                    { role: 'user', content: chatText }
                ]);
                if (!summary || !summary.trim()) continue;

                const lines = summary.split('\n').filter(l => l.trim());
                const items = [];
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    let type = '其他', content = line;
                    const match = line.match(/^【(.+?)】/);
                    if (match) { type = match[1]; content = line.replace(/^【.+?】/, '').trim(); }
                    if (!content) continue;

                    let embedding = null;
                    if (hasVector) {
                        try { embedding = await getEmbedding(content); } catch (e) { console.warn('[Memory] 群聊向量化失败:', e.message); }
                    }
                    items.push({
                        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                        type, content,
                        embedding: embedding || null,
                        hasVector: !!embedding,
                        date: new Date().toISOString(),
                        relatedChar: mName,
                        chatId: mem.id,
                        groupId: chatId,
                        source: isAuto ? 'auto' : 'manual'
                    });
                }

                for (const item of items) await storeMemory(item);
                total += items.length;
            }

            if (total === 0) {
                console.warn('[Memory] 群聊本次未提取到有效记忆，chatId=', chatId);
                hideToast();
                if (!isAuto) {
                    manualSummaryBtn.classList.remove('loading');
                    manualSummaryBtn.disabled = false;
                    notifyRefresh('fail', '未提取到有效记忆');
                    if (isPageVisible()) alert('本次没有提取到有效记忆，请检查总结 API 配置后重试');
                } else {
                    showToast('未提取到记忆，稍后自动重试');
                    setTimeout(hideToast, 2000);
                }
                await renderMemoryList();
                isProcessing = false;
                return;
            }

            const state = await getGroupSummaryState();
            state.summarizedCount = (state.summarizedCount || 0) + messages.length;
            await setGroupSummaryState(state);

            unsummedCount = 0;
            await setConfig('unsummedCount', 0);
            await updateUnsummedUI();

            hideToast();
            if (!isAuto) {
                manualSummaryBtn.classList.remove('loading');
                manualSummaryBtn.disabled = false;
                const vectorStatus = hasVector ? '（已向量化）' : '（纯文本）';
                notifyRefresh('success', '为 ' + info.members.length + ' 位成员共生成 ' + total + ' 条记忆');
                if (isPageVisible()) alert('群聊总结完成，为 ' + info.members.length + ' 位成员共生成 ' + total + ' 条记忆 ' + vectorStatus);
            }
            console.log('[Memory] 群聊总结完成 chatId=', chatId, '生成', total, '条记忆');
            try { if (window.parent !== window) window.parent.postMessage({ type: 'NANO_MEMORY_UPDATED', chatId: chatId }, '*'); } catch (e) {}
            await renderMemoryList();
            isProcessing = false;

        } catch (err) {
            console.error('[Memory] 群聊总结失败', err);
            hideToast();
            if (!isAuto) {
                manualSummaryBtn.classList.remove('loading');
                manualSummaryBtn.disabled = false;
                notifyRefresh('fail', err);
                if (isPageVisible()) alert('总结失败: ' + err.message);
            }
            isProcessing = false;
        }
    }

    // ============================================================
    // 自动总结检测
    // ============================================================
    async function checkAutoSummary() {
        if (!autoSummaryToggle.checked || isProcessing) return;

        const threshold = IS_GROUP ? 30 : (parseInt(autoThreshold.value) || 20);
        const chatId = getChatId();
        const messages = await getChatMessages(chatId);
        const state = await getChatState(chatId);
        const unsummed = messages.length - (state.summarizedCount || 0);

        unsummedCount = Math.max(0, unsummed);
        await setConfig('unsummedCount', unsummedCount);
        updateUnsummedUI();

        if (unsummed >= threshold) {
            console.log('[Memory] 触发自动总结 chatId=', chatId, '消息数=', messages.length, '已总结=', state.summarizedCount || 0, '未总结=', unsummed);
            await performSummary(messages.slice(state.summarizedCount || 0), true);
        }
    }

    manualSummaryBtn.addEventListener('click', () => {
        if (isProcessing) return;
        performSummary([], false);
    });

    // ============================================================
    // 顶栏：返回 / 保存配置（含本页 API 配置） / 记忆检索
    // ============================================================
    const topbarBackBtn = document.getElementById('topbarBackBtn');
    if (topbarBackBtn) {
        topbarBackBtn.addEventListener('click', function() {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'closeFullscreen' }, '*');
            } else {
                history.back();
            }
        });
    }

    const saveConfigBtn = document.getElementById('saveConfigBtn');
    if (saveConfigBtn) {
        saveConfigBtn.addEventListener('click', async function() {
            await saveSettings();
            showToast('配置已保存');
            setTimeout(hideToast, 1200);
        });
    }

    const memorySearchInput = document.getElementById('memorySearchInput');
    if (memorySearchInput) {
        memorySearchInput.addEventListener('input', function() {
            renderMemoryList();
        });
    }

    // ============================================================
    // 渲染记忆列表
    // ============================================================
    async function renderMemoryList() {
        try {
            const chatId = getChatId();
            const items = await getAllMemories(chatId);
            console.log('[Memory] 渲染记忆列表, chatId=', chatId, '找到', items ? items.length : 0, '条');
            const container = memoryListContainer;
            container.innerHTML = '';
            container.classList.remove('memory-timeline');

            // 记忆检索：按关键词过滤内容/类型/角色
            const q = (memorySearchInput ? memorySearchInput.value : '').trim().toLowerCase();
            let shown = items;
            if (q) {
                shown = (items || []).filter(item =>
                    (item.content || '').toLowerCase().includes(q) ||
                    (item.type || '').toLowerCase().includes(q) ||
                    (item.relatedChar || '').toLowerCase().includes(q)
                );
            }

            if (!items || items.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg class="empty-icon" viewBox="0 0 24 24" stroke="currentColor">
                            <path d="M12 2v4M12 22v-4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M22 12h-4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        暂无记忆<br>开始聊天后自动总结
                    </div>
                `;
                return;
            }
            if (!shown || shown.length === 0) {
                container.innerHTML = `<div class="empty-state">没有匹配「${q}」的记忆</div>`;
                totalMemories.textContent = items.length + ' 条';
                return;
            }

            const sorted = shown.sort((a, b) => new Date(b.date) - new Date(a.date));
            const typeColors = {
                '重要事件': '#ff3b30', '用户偏好': '#ff9500', '社交关系': '#af52de',
                '地理位置': '#34c759', '情感状态': '#ff2d55', '项目进展': '#007aff'
            };

            // 记忆库超过 20 条时，默认只展示最新 20 条，更早的折叠起来
            const HIDE_AFTER = 20;
            let displayList = sorted;
            let hiddenCount = 0;
            if (!memoryListExpanded && sorted.length > HIDE_AFTER) {
                displayList = sorted.slice(0, HIDE_AFTER);
                hiddenCount = sorted.length - HIDE_AFTER;
            }

            container.classList.add('memory-timeline');
            displayList.forEach(item => {
                const card = document.createElement('div');
                card.className = 'memory-card timeline-card';
                card.onclick = () => openEditModal(item.id);

                const header = document.createElement('div');
                header.className = 'memory-header';

                const date = document.createElement('span');
                date.className = 'memory-date';
                const d = new Date(item.date);
                date.textContent = d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

                const tags = document.createElement('div');
                tags.className = 'memory-tags';

                const typeTag = document.createElement('span');
                typeTag.className = 'memory-type-tag';
                typeTag.textContent = item.type || '其他';
                typeTag.style.color = typeColors[item.type] || '#8e8e93';

                const vecBadge = document.createElement('span');
                vecBadge.className = 'memory-vector-badge' + (item.hasVector ? '' : ' off');
                vecBadge.textContent = item.hasVector ? '向量' : '文本';

                tags.appendChild(typeTag);
                tags.appendChild(vecBadge);
                header.appendChild(date);
                header.appendChild(tags);

                const content = document.createElement('div');
                content.className = 'memory-content';
                content.textContent = item.content || '';

                const meta = document.createElement('div');
                meta.className = 'memory-meta';
                meta.textContent = (item.relatedChar || '未知') + ' · ' + (item.source === 'auto' ? '自动' : '手动');

                card.appendChild(header);
                card.appendChild(content);
                card.appendChild(meta);
                container.appendChild(card);
            });

            // 折叠/展开更早的记忆
            if (hiddenCount > 0 || (memoryListExpanded && sorted.length > HIDE_AFTER)) {
                const btn = document.createElement('button');
                btn.className = 'memory-expand-btn';
                btn.style.cssText = 'display:block;width:100%;margin:10px 0 4px;padding:10px 0;border:none;border-radius:12px;background:rgba(120,120,128,0.12);color:#007aff;font-size:13px;font-family:inherit;cursor:pointer;';
                btn.textContent = hiddenCount > 0 ? ('展开（' + hiddenCount + ' 条）') : '收起';
                btn.addEventListener('click', function () {
                    memoryListExpanded = !memoryListExpanded;
                    renderMemoryList();
                });
                container.appendChild(btn);
            }

            totalMemories.textContent = items.length + ' 条';

        } catch (e) {
            console.error('[Memory] 渲染失败:', e);
        }
    }

    // ============================================================
    // 编辑弹窗
    // ============================================================
    async function openEditModal(id) {
        const item = await getMemory(id);
        if (!item) return;
        currentEditId = id;
        modalTextarea.value = item.content || '';
        modalDate.textContent = new Date(item.date).toLocaleString('zh-CN');
        modalMemType.textContent = (item.type || '其他') + ' · ' + (item.source === 'auto' ? '自动' : '手动');
        modalRelatedChar.textContent = item.relatedChar || '未知';
        modalVectorStatus.textContent = item.hasVector ? '已向量化 (' + (item.embedding?.length || 0) + '维)' : '未向量化（纯文本）';
        document.getElementById('editModal').classList.add('active');
    }
    window.openEditModal = openEditModal;

    function closeEditModal() {
        document.getElementById('editModal').classList.remove('active');
        currentEditId = null;
    }
    window.closeEditModal = closeEditModal;

    async function saveMemory() {
        if (!currentEditId) return;
        const content = modalTextarea.value.trim();
        if (!content) { alert('内容不能为空'); return; }

        const item = await getMemory(currentEditId);
        if (!item) return;
        try {
            item.content = content;

            // 尝试重新向量化
            const hasVector = !!(embUrl.value.trim() && embKey.value.trim() && embModelSelect.value);
            if (hasVector) {
                try {
                    const emb = await getEmbedding(content);
                    item.embedding = emb;
                    item.hasVector = true;
                } catch (e) {
                    console.warn('[Memory] 重新向量化失败:', e.message);
                    item.hasVector = false;
                }
            } else {
                item.hasVector = false;
            }

            await storeMemory(item);
            closeEditModal();
            await renderMemoryList();
            notifyMemoryUpdated();
            alert('记忆已更新');
        } catch (err) {
            alert('更新失败: ' + err.message);
        }
    }
    window.saveMemory = saveMemory;

    async function deleteMemory() {
        if (!currentEditId) return;
        if (!confirm('确定删除？')) return;
        await deleteMemoryFromDB(currentEditId);
        closeEditModal();
        await renderMemoryList();
        notifyMemoryUpdated();
        alert('已删除');
    }
    window.deleteMemory = deleteMemory;

    // ============================================================
    // 消息同步
    // ============================================================
    async function syncChatMessages(chatId, messages) {
        await setChatMessages(chatId, messages);
        await updateUnsummedUI();
        if (autoSummaryToggle.checked) setTimeout(checkAutoSummary, 2000);
    }

    // ============================================================
    // 监听消息
    // ============================================================
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (!data) return;
        if (data.type === 'NANO_SYNC_MESSAGES') {
            syncChatMessages(data.chatId || getChatId(), data.messages);
        }
        if (data.type === 'NANO_NEW_MESSAGE') {
            const chatId = data.chatId || getChatId();
            getChatMessages(chatId).then(messages => {
                messages.push(data.message);
                setChatMessages(chatId, messages);
                updateUnsummedUI();
                if (autoSummaryToggle.checked) setTimeout(checkAutoSummary, 1000);
            });
        }
    });

    // ============================================================
    // 初始化
    // ============================================================
    document.getElementById('editModal').addEventListener('click', function(e) {
        if (e.target === this) closeEditModal();
    });
    toastOverlay.addEventListener('click', function(e) {
        if (e.target === this && !isProcessing) hideToast();
    });

    setInterval(() => {
        updateUnsummedUI();
        renderMemoryList();
        // 群聊页不会主动推送消息，这里定时检测自动总结
        if (IS_GROUP && autoSummaryToggle.checked) checkAutoSummary();
    }, 5000);

    // 回到本页时立即刷新未总结条数与记忆列表
    window.addEventListener('focus', function() {
        updateUnsummedUI();
        renderMemoryList();
    });

    // 后台自动总结完成（由 chat-inner 触发）后刷新本页展示
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (data && data.type === 'NANO_MEMORY_UPDATED') {
            updateUnsummedUI();
            renderMemoryList();
        }
    });

    async function init() {
        await loadSettings();
        await updateUnsummedUI();
        await renderMemoryList();
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'pageLoaded', page: 'memory' }, '*');
        }
        console.log('[Memory] 已启动');
    }

    init();

    // ============================================================
    // 暴露 API
    // ============================================================
    window.__memory = {
        getAllMemories, getMemory, storeMemory, deleteMemoryFromDB,
        getChatMessages, setChatMessages, syncChatMessages,
        getChatState, setChatState,
        performSummary, checkAutoSummary, getEmbedding, callLlm,
        renderMemoryList, updateUnsummedUI,
        getConfig, setConfig, saveSettings, loadSettings,
        getChatId, getCharacterInfo
    };

})();