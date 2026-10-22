// ============================================================
// 更多菜单（底部 + 号菜单）- 使用 IndexedDB
// ============================================================
(function() {
    'use strict';

    const moreBtn = document.getElementById('moreBtn');
    const moreOverlay = document.getElementById('moreOverlay');
    const IS_NANO = (function () { try { return new URLSearchParams(location.search).get('chat') === 'nano_ai'; } catch (e) { return false; } })();

    // ===== 默认菜单配置（viewBox 0 0 24 24，stroke-width 2.5） =====
    const DEFAULT_MENU_ITEMS = [
        {
            id: 'reroll',
            label: '重roll',
            icon: '<path d="M21 12a9 9 0 1 1-9-9m0 0v6m0-6h-6"/>',
            color: '#007AFF'
        },
        {
            id: 'transfer',
            label: '转账',
            icon: '<path d="M17 3l4 4-4 4"/><path d="M21 7H7"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h14"/>',
            color: '#34C759'
        },
        {
            id: 'image',
            label: '图片',
            icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-5 5-3-3-5 5"/>',
            color: '#FF9500'
        },
        {
            id: 'gift',
            label: '礼物',
            icon: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
            color: '#FF2D55'
        },
        {
            id: 'voicecall',
            label: '语音电话',
            icon: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
            color: '#5856D6'
        },
        {
            id: 'videocall',
            label: '视频通话',
            icon: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
            color: '#0A84FF'
        },
        {
            id: 'memory',
            label: '记忆',
            fa: 'fa-brain',
            icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
            color: '#00B8A9'
        },
        {
            id: 'offline',
            label: '线下',
            fa: 'fa-map-marker-alt',
            icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
            color: '#5B6CFF'
        },
        {
            id: 'familycard',
            label: '亲属卡',
            icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
            color: '#AF52DE'
        },
        {
            id: 'takeout',
            label: '外卖',
            icon: '<path d="M3 11h18"/><path d="M12 3a8 8 0 0 0-8 8h16a8 8 0 0 0-8-8z"/><path d="M4 15h16l-1 5H5z"/>',
            color: '#FF8A00'
        },
        {
            id: 'location',
            label: '定位',
            icon: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
            color: '#32ADE6'
        },
        {
            id: 'takeover',
            label: '接管手机',
            icon: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
            color: '#FF3B30'
        },
    ];

    // 「接管手机」重新放回聊天加号菜单；
    // 「看屏幕 / 屏幕共享」只在电脑端可用，保留在「查手机 → 设置」里，不进加号菜单，这里过滤掉。
    const REMOVED_MENU_IDS = ['listen-accept', 'listen-end', 'screenshare'];

    // ===== IndexedDB 操作 =====
    const DB_NAME = 'nano_chat_menu_db';
    const STORE_NAME = 'menu_items';
    const DB_VERSION = 1;

    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = function(e) {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    }
                };
                request.onsuccess = function(e) {
                    resolve(e.target.result);
                };
                request.onerror = function(e) {
                    reject(e.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    function saveMenuItems(items) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const clearReq = store.clear();
                clearReq.onsuccess = function() {
                    items.forEach(function(item) {
                        store.put(item);
                    });
                    resolve();
                };
                clearReq.onerror = function(e) {
                    reject(e.target.error);
                };
                tx.oncomplete = function() {
                    db.close();
                };
                tx.onerror = function(e) {
                    reject(e.target.error);
                };
            });
        });
    }

    function loadMenuItems() {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const getAll = store.getAll();
                getAll.onsuccess = function() {
                    let items = getAll.result;
                    db.close();
                    if (items && items.length > 0) {
                        // 移除已废弃的菜单项
                        items = items.filter(function(it) {
                            return REMOVED_MENU_IDS.indexOf(it && it.id) === -1;
                        });
                        // 迁移：内置的“记忆/线下”统一使用群聊同款图标
                        items = items.map(function(it) {
                            const d = DEFAULT_MENU_ITEMS.find(function(x) { return x.id === it.id; });
                            if (d && d.fa) { it.fa = d.fa; it.icon = d.icon; it.color = d.color; }
                            return it;
                        });
                        // 补齐新增的内置菜单项（如一起听），保证老用户也能看到
                        const have = {};
                        items.forEach(function(it) { have[it.id] = true; });
                        DEFAULT_MENU_ITEMS.forEach(function(d) {
                            if (!have[d.id]) items.push(d);
                        });
                        saveMenuItems(items).catch(function() {});
                        resolve(items);
                    } else {
                        saveMenuItems(DEFAULT_MENU_ITEMS).then(function() {
                            resolve(DEFAULT_MENU_ITEMS);
                        }).catch(function() {
                            resolve(DEFAULT_MENU_ITEMS);
                        });
                    }
                };
                getAll.onerror = function(e) {
                    db.close();
                    resolve(DEFAULT_MENU_ITEMS);
                };
            });
        }).catch(function() {
            return DEFAULT_MENU_ITEMS;
        });
    }

    // ===== 渲染菜单 =====
    function renderMenu(items) {
        moreOverlay.innerHTML = '';
        // 重roll 始终排第一个
        items = (items || []).slice().sort(function(a, b) {
            if (a && a.id === 'reroll') return -1;
            if (b && b.id === 'reroll') return 1;
            return 0;
        });
        // 纳米助手：加号菜单精简为「重roll / 发实体照片 / 发文件 / 美化清空」
        if (IS_NANO) {
            items = [
                { id: 'reroll', label: '重roll', icon: '<path d="M21 12a9 9 0 1 1-9-9m0 0v6m0-6h-6"/>', color: '#007AFF' },
                { id: 'image', label: '图片', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-5 5-3-3-5 5"/>', color: '#FF9500' },
                { id: 'file', label: '文件', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>', color: '#FF4D94' },
                { id: 'clearlive', label: '清空线上', icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>', color: '#007AFF' },
                { id: 'clearoffline', label: '清空线下', icon: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>', color: '#34C759' },
                { id: 'clearheart', label: '清空心声', icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/>', color: '#FF2D55' }
            ];
        }
        items.forEach(function(item) {
            const btn = document.createElement('button');
            btn.className = 'more-item';
            btn.dataset.action = item.id;
            const iconHTML = item.fa
                ? `<i class="fas ${item.fa}"></i>`
                : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        ${item.icon}
                    </svg>`;
            btn.innerHTML = `
                <span class="mi-icon" style="background:${item.color};color:#fff;">
                    ${iconHTML}
                </span>
                <span class="mi-label">${item.label}</span>
            `;
            btn.addEventListener('click', function(e) {
                handleAction(item.id);
            });
            moreOverlay.appendChild(btn);
        });
    }

    // ===== 纳米助手：发送文件 =====
    function loadMammothForNano() {
        return new Promise(function (res) {
            if (window.mammoth) return res(true);
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
            s.onload = function () { res(!!window.mammoth); };
            s.onerror = function () { res(false); };
            document.head.appendChild(s);
        });
    }
    function readNanoFile(file) {
        var lower = file.name.toLowerCase();
        if (lower.endsWith('.docx')) {
            return loadMammothForNano().then(function (ok) {
                if (!ok) throw new Error('docx 解析库加载失败');
                return file.arrayBuffer().then(function (buf) { return window.mammoth.extractRawText({ arrayBuffer: buf }); })
                    .then(function (r) { return (r && r.value) || ''; });
            });
        }
        return file.text();
    }
    function pickFileForNano() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.json,.docx,.md,.csv';
        input.style.display = 'none';
        input.addEventListener('change', async function () {
            var f = input.files[0];
            if (!f) { input.remove(); return; }
            try {
                var text = await readNanoFile(f);
                if (window.__chat && window.__chat.sendFileContent) window.__chat.sendFileContent(f.name, text);
            } catch (e) {
                try { window.__chat.showAlert('读取失败', String((e && e.message) || e)); } catch (err) {}
            }
            input.remove();
        });
        document.body.appendChild(input);
        input.click();
    }

    // 触发外壳的「接管手机 / 看屏幕」：优先直接调用（比 postMessage 可靠），不行再发消息
    function fireHost(kind) {
        const info = chatCharInfo();
        const type = kind === 'screenshare' ? 'startScreenShare' : 'startTakeover';
        const targets = [];
        try { if (window.parent) targets.push(window.parent); } catch (e) {}
        try { if (window.top && window.top !== window.parent) targets.push(window.top); } catch (e) {}
        let sawStale = false;
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i]; if (!t) continue;
            try {
                if (kind === 'screenshare' && t.ScreenShare && t.ScreenShare.start) {
                    if (!t.ScreenShare.version) { sawStale = true; continue; }
                    t.ScreenShare.start(info); return;
                }
                if (kind === 'takeover' && t.CharTakeover && t.CharTakeover.start) {
                    if (!t.CharTakeover.version) { sawStale = true; continue; }
                    t.CharTakeover.start(info); return;
                }
            } catch (e) {}
        }
        if (sawStale) {
            try { if (window.__chat && window.__chat.showAlert) window.__chat.showAlert('需要更新', '外壳里的接管模块还是旧版。请完全关闭 Nano 再重新打开（或清除一次站点数据）后重试。'); } catch (e) {}
            return;
        }
        let posted = false;
        for (let j = 0; j < targets.length; j++) {
            try { targets[j].postMessage({ type: type, charId: info.id, charName: info.name, avatar: info.avatar }, '*'); posted = true; } catch (e) {}
        }
        if (!posted) {
            try { if (window.__chat && window.__chat.showAlert) window.__chat.showAlert('用不了', '接管模块没连上，请刷新 Nano 后重试。'); } catch (e) {}
        }
    }

    function notifyCleared(msg) {
        try { if (window.parent !== window) window.parent.postMessage({ type: 'alert', message: msg }, '*'); } catch (e) {}
    }
    // 单聊/群聊线上美化
    function clearLiveBeautify() {
        try { localStorage.removeItem('beautify_chat'); localStorage.removeItem('beautify_chat_v2'); localStorage.removeItem('beautify_groups'); localStorage.removeItem('beautify_groups_v2'); } catch (e) {}
        // 同步清掉美化 App 里「已应用」的记录，避免兜底逻辑把已清空的样式又恢复回来
        try {
            var req = indexedDB.open('BeautifyAppDB', 1);
            req.onsuccess = function (ev) {
                try {
                    var db = ev.target.result;
                    var tx = db.transaction('settings', 'readwrite');
                    var st = tx.objectStore('settings');
                    st.put({ key: 'applied_chat', value: '' });
                    st.put({ key: 'applied_groups', value: '' });
                } catch (e2) {}
            };
        } catch (e) {}
        notifyCleared('已清空线上美化，恢复默认样式');
    }
    // 心声美化
    function clearHeartBeautify() {
        try { localStorage.removeItem('nano_voice_applied_css'); } catch (e) {}
        notifyCleared('已清空心声美化，恢复默认样式');
    }
    // 线下美化
    function clearOfflineBeautify() {
        try {
            var req = indexedDB.open('MeetSettingsDB');
            req.onsuccess = function () {
                try {
                    var db = req.result;
                    if (!db.objectStoreNames.contains('settings')) { db.close(); return; }
                    var tx = db.transaction('settings', 'readwrite');
                    var st = tx.objectStore('settings');
                    var g = st.getAll();
                    g.onsuccess = function () {
                        (g.result || []).forEach(function (rec) {
                            if (rec && rec.customCSS !== undefined) { rec.customCSS = ''; st.put(rec); }
                        });
                    };
                    tx.oncomplete = function () { db.close(); };
                    tx.onerror = function () { db.close(); };
                } catch (e) {}
            };
        } catch (e) {}
        notifyCleared('已清空线下美化，恢复默认样式');
    }

    // 当前聊天角色信息（供接管手机 / 看屏幕用）
    function chatCharInfo() {
        const info = { id: '', name: '', avatar: '' };
        try { const sp = new URLSearchParams(window.location.search); info.id = sp.get('chat') || ''; info.name = decodeURIComponent(sp.get('name') || ''); } catch (e) {}
        try { if (window.__chat && window.__chat.displayName) info.name = window.__chat.displayName; } catch (e) {}
        try { const av = document.getElementById('avatarImage'); if (av && av.src && av.src.indexOf('data:') === 0) info.avatar = av.src; } catch (e) {}
        return info;
    }

    // ===== 处理动作 =====
    function handleAction(action) {
        moreOverlay.classList.remove('active');

        switch (action) {
            case 'reroll':
                handleReroll();
                break;
            case 'file':
                pickFileForNano();
                break;
            case 'clearlive':
                clearLiveBeautify();
                break;
            case 'clearoffline':
                clearOfflineBeautify();
                break;
            case 'clearheart':
                clearHeartBeautify();
                break;
            case 'takeover':
                fireHost('takeover');
                break;
            case 'screenshare':
                fireHost('screenshare');
                break;
            case 'transfer':
                document.getElementById('transferAmount').value = '';
                document.getElementById('transferNote').value = '';
                (function () { var ts = document.getElementById('transferSource'); if (ts) ts.value = 'bank'; })();
                document.getElementById('transferPopup').classList.add('active');
                setTimeout(function() {
                    document.getElementById('transferAmount').focus();
                }, 100);
                break;
            case 'gift':
                document.getElementById('giftNameInput').value = '';
                document.getElementById('giftNoteInput').value = '';
                (function () { var ga = document.getElementById('giftAmount'); if (ga) ga.value = ''; })();
                document.getElementById('giftPopup').classList.add('active');
                setTimeout(function() {
                    document.getElementById('giftNameInput').focus();
                }, 100);
                break;
            case 'image':
                document.getElementById('imagePreviewBox').style.display = 'none';
                document.getElementById('imagePreview').src = '';
                document.getElementById('imageTextInput').value = '';
                document.getElementById('imageFileInput').value = '';
                (function () { var th = document.getElementById('imageThumbs'); if (th) th.innerHTML = ''; })();
                (function () { var t = document.getElementById('imgTabText'); if (t) t.click(); })();
                document.getElementById('imagePopup').classList.add('active');
                break;
            case 'voicecall':
            case 'videocall': {
                const page = action === 'videocall' ? 'video-call.html' : 'voice-call.html';
                const title = action === 'videocall' ? '视频通话' : '语音电话';
                if (window.parent !== window) {
                    // 带上当前 chat 的信息，确保人设/头像/记忆同步
                    let qs = '';
                    try {
                        const sp = new URLSearchParams(window.location.search);
                        const cid = sp.get('chat');
                        const nm = sp.get('name');
                        if (cid) qs += 'chat=' + encodeURIComponent(cid);
                        if (nm) qs += (qs ? '&' : '') + 'name=' + encodeURIComponent(nm);
                    } catch (e) {}
                    window.parent.postMessage({
                        type: 'openFullscreen',
                        url: page + (qs ? '?' + qs : ''),
                        title: title,
                        source: 'chat_inner'
                    }, '*');
                }
                break;
            }
            case 'memory':
                if (window.parent !== window) {
                    let qs = '';
                    try {
                        const sp = new URLSearchParams(window.location.search);
                        const cid = sp.get('chat');
                        const nm = sp.get('name');
                        if (cid) qs += 'chat=' + encodeURIComponent(cid);
                        if (nm) qs += (qs ? '&' : '') + 'name=' + encodeURIComponent(nm);
                    } catch (e) {}
                    window.parent.postMessage({
                        type: 'openFullscreen',
                        url: 'memory.html' + (qs ? '?' + qs : ''),
                        title: '记忆',
                        source: 'chat_inner'
                    }, '*');
                }
                break;
            case 'offline':
                if (window.parent !== window) {
                    let qs2 = '';
                    try {
                        const sp = new URLSearchParams(window.location.search);
                        const cid = sp.get('chat');
                        const nm = sp.get('name');
                        if (cid) qs2 += 'chat=' + encodeURIComponent(cid);
                        if (nm) qs2 += (qs2 ? '&' : '') + 'name=' + encodeURIComponent(nm);
                    } catch (e) {}
                    window.parent.postMessage({
                        type: 'openFullscreen',
                        url: 'offline.html' + (qs2 ? '?' + qs2 : ''),
                        title: '线下',
                        source: 'chat_inner'
                    }, '*');
                } else {
                    window.location.href = 'offline.html';
                }
                break;
            case 'familycard':
                if (window.parent !== window) {
                    let qsFc = '';
                    try {
                        const sp = new URLSearchParams(window.location.search);
                        const cid = sp.get('chat');
                        const nm = sp.get('name');
                        if (cid) qsFc += 'chat=' + encodeURIComponent(cid);
                        if (nm) qsFc += (qsFc ? '&' : '') + 'name=' + encodeURIComponent(nm);
                    } catch (e) {}
                    window.parent.postMessage({
                        type: 'openFullscreen',
                        url: 'family-card.html' + (qsFc ? '?' + qsFc : ''),
                        title: '亲属卡',
                        source: 'chat_inner'
                    }, '*');
                } else {
                    window.location.href = 'family-card.html';
                }
                break;
            case 'takeout':
                document.getElementById('takeoutFood').value = '';
                document.getElementById('takeoutShop').value = '';
                document.getElementById('takeoutPrice').value = '';
                document.getElementById('takeoutNote').value = '';
                document.getElementById('takeoutPopup').classList.add('active');
                setTimeout(function() { document.getElementById('takeoutFood').focus(); }, 100);
                break;
            case 'location':
                (function () {
                    var p = document.getElementById('locationPlace'); if (p) p.value = '';
                    var d = document.getElementById('locationDistance'); if (d) d.value = '';
                    var d2 = document.getElementById('locationRealDistance'); if (d2) d2.value = '';
                    var s = document.getElementById('locationStatus'); if (s) s.textContent = '未定位';
                    var l = document.getElementById('locMapLabel'); if (l) l.textContent = '未选择地点';
                    var vt = document.querySelector('#locationPopup .vs-tab[data-loc="virtual"]'); if (vt) vt.click();
                })();
                document.getElementById('locationPopup').classList.add('active');
                setTimeout(function() {
                    var p = document.getElementById('locationPlace'); if (p) p.focus();
                }, 100);
                break;
            case 'heart':
                window.__chat.showAlert('提示', '心声功能开发中...');
                break;
            case 'emoji':
                if (window.parent !== window) {
                    window.parent.postMessage({
                        type: 'openBottomSheet',
                        url: 'emoji.html'
                    }, '*');
                }
                break;
            case 'recorder':
                window.__chat.showAlert('提示', '语音录制功能开发中...');
                break;
            default:
                console.warn('[More] 未知动作:', action);
        }
    }

    // ===== 重roll =====
    // 统一走 chat-core 的实现：它会先停掉正在生成的请求，再删除上一轮用户消息之后的
    // 全部角色内容（气泡/语音/图片/卡片），最后重新生成。这里不再保留一份容易分叉的逻辑。
    async function handleReroll() {
        const chat = window.__chat;
        try {
            if (chat && typeof chat.handleReroll === 'function') return await chat.handleReroll();
        } catch (e) {
            console.warn('[More] 重roll 失败', e);
        }
        chat.showAlert('提示', '重roll 未完成，请重试');
    }

    // ===== 事件绑定 =====
    moreBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        moreOverlay.classList.toggle('active');
    });

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.more-overlay') && !e.target.closest('.more-btn')) {
            moreOverlay.classList.remove('active');
        }
    });

    moreOverlay.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    // ===== 启动：从 IndexedDB 加载菜单 =====
    loadMenuItems().then(function(items) {
        renderMenu(items);
        console.log('[More] 菜单已加载，共 ' + items.length + ' 项');
    }).catch(function(err) {
        console.error('[More] 加载菜单失败:', err);
        renderMenu(DEFAULT_MENU_ITEMS);
    });

    // ===== 暴露 API =====
    window.__moreMenu = {
        loadMenuItems: loadMenuItems,
        saveMenuItems: saveMenuItems,
        renderMenu: renderMenu,
        DEFAULT_MENU_ITEMS: DEFAULT_MENU_ITEMS
    };

})();

// ============================================================
// 任意弹窗/浮层打开时，隐藏底部输入栏（避免被底部弹窗遮挡）
// 只监听这些浮层自身的 class 变化，开销很小。
// ============================================================
(function () {
    var IDS = [
        'moreOverlay', 'giftPopup', 'imagePopup', 'transferPopup', 'takeoutPopup',
        'locationPopup', 'editPopup', 'iosAlert', 'callSheetOverlay',
        'emojiPanelOverlay', 'emojiPanel', 'voiceSheetOverlay', 'nanoVoiceLayer'
    ];
    function isOpen(el) {
        if (!el) return false;
        var c = el.classList;
        return c.contains('active') || c.contains('show') || c.contains('open');
    }
    var wasOpen = false;
    function sync() {
        var open = false;
        for (var i = 0; i < IDS.length; i++) {
            if (isOpen(document.getElementById(IDS[i]))) { open = true; break; }
        }
        if (open && !wasOpen) {
            // 弹窗打开时收起键盘，避免键盘和底部弹窗打架
            try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
        }
        wasOpen = open;
        document.body.classList.toggle('popup-open', open);
    }
    function boot() {
        var mo = new MutationObserver(sync);
        IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
        sync();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();