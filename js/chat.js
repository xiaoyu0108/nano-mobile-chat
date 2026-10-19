(function() {
    const HOME_STORAGE_KEY = 'nano_mask_data';
    const LEGACY_HOME_STORAGE_KEYS = ['nano_home_data', 'peach_home_data'];
    const GROUP_STORAGE_KEY = 'nano_groups_data';

    let currentTab = 'friends';
    let selectedGroupMembers = [];
    let groupTempAvatar = '';

    // ===== 从 IndexedDB 读取角色（和 character.js 共用） =====
    function getCharacters() {
        return new Promise(function(resolve) {
            try {
                const request = indexedDB.open('nano_characters_db', 1);
                request.onupgradeneeded = function(e) {
                    try {
                        const d = e.target.result;
                        if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                    } catch (e) {}
                };
                request.onsuccess = function(e) {
                    const db = e.target.result;
                    const tx = db.transaction('characters', 'readonly');
                    const store = tx.objectStore('characters');
                    const getAll = store.getAll();
                    getAll.onsuccess = function() {
                        resolve(getAll.result || []);
                    };
                    getAll.onerror = function() {
                        resolve([]);
                    };
                };
                request.onerror = function() {
                    resolve([]);
                };
            } catch(e) {
                resolve([]);
            }
        });
    }

    // ===== 纳米助手自愈：开关开着但角色行丢了就补回来（切换页面后不会“不见了”） =====
    var NANO_ID = 'nano_ai';
    var NANO_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ecb"/><stop offset="1" stop-color="#ff4d94"/></linearGradient></defs>' +
        '<rect width="80" height="80" rx="20" fill="url(#g)"/>' +
        '<rect x="18" y="24" width="44" height="34" rx="12" fill="#fff" opacity="0.95"/>' +
        '<circle cx="32" cy="41" r="4.5" fill="#ff4d94"/><circle cx="48" cy="41" r="4.5" fill="#ff4d94"/>' +
        '<rect x="38" y="12" width="4" height="10" rx="2" fill="#fff"/><circle cx="40" cy="11" r="4" fill="#fff"/></svg>');
    var nanoHealAt = 0;
    function ensureNanoCharacterExists() {
        var now = Date.now();
        if (now - nanoHealAt < 3000) return Promise.resolve();   // 节流，避免频繁开库
        nanoHealAt = now;
        var on = false;
        try { on = localStorage.getItem('nano_assistant_enabled') === '1'; } catch (e) {}
        return new Promise(function(resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function(e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                    } catch (err) {}
                };
                req.onsuccess = function() {
                    try {
                        var db = req.result;
                        var tx = db.transaction('characters', 'readwrite');
                        var store = tx.objectStore('characters');
                        var g = store.get(NANO_ID);
                        g.onsuccess = function() {
                            var ex = g.result;
                            if (on) {
                                if (!ex) {
                                    store.put({ id: NANO_ID, name: '纳米', avatar: NANO_AVATAR, gender: '女', nationality: '中国', setting: '', bindUser: '', isNpc: true, worldbookBindings: [], nanoAssistant: true });
                                } else if (!ex.nanoAssistant) {
                                    ex.nanoAssistant = true; ex.isNpc = true; store.put(ex);
                                }
                            } else if (ex && ex.nanoAssistant) {
                                // 开关被误清空但角色仍在：反向恢复开关，避免助手“消失”
                                try { localStorage.setItem('nano_assistant_enabled', '1'); } catch (e) {}
                            }
                        };
                        tx.oncomplete = function() { db.close(); resolve(); };
                        tx.onerror = function() { db.close(); resolve(); };
                    } catch (err) { resolve(); }
                };
                req.onerror = function() { resolve(); };
            } catch (e) { resolve(); }
        });
    }

    // ===== 用户隔离迁移：把没有 bindUser 的 NPC / 小号归到当前人设名下 =====
    var orphanAt = 0;
    function migrateOrphanNpcs(maskId) {
        var now = Date.now();
        if (now - orphanAt < 8000) return Promise.resolve();
        orphanAt = now;
        if (maskId == null || maskId === '') return Promise.resolve();
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {}
                };
                req.onsuccess = function () {
                    try {
                        var db = req.result;
                        var tx = db.transaction('characters', 'readwrite');
                        var store = tx.objectStore('characters');
                        var all = store.getAll();
                        all.onsuccess = function () {
                            (all.result || []).forEach(function (c) {
                                if (c && c.isNpc && !c.nanoAssistant && (c.bindUser == null || c.bindUser === '')) {
                                    c.bindUser = String(maskId);
                                    store.put(c);
                                }
                            });
                        };
                        tx.oncomplete = function () { db.close(); resolve(); };
                        tx.onerror = function () { db.close(); resolve(); };
                    } catch (e) { resolve(); }
                };
                req.onerror = function () { resolve(); };
            } catch (e) { resolve(); }
        });
    }

    // ===== 获取某个聊天的最新消息 =====
    function getLastMessage(chatId) {
        try {
            const storageKey = 'chat_messages_' + chatId;
            let messages = [];
            // 尝试从 localStorage 读取（localForage 是异步的，这里用同步方式）
            const data = localStorage.getItem(storageKey);
            if (data) {
                messages = JSON.parse(data);
            }
            if (messages && messages.length > 0) {
                return messages[messages.length - 1];
            }
            return null;
        } catch (e) {
            console.error('[Chat] 获取最新消息失败:', e);
            return null;
        }
    }

    // ===== 获取备注名 =====
    function getRemark(chatId) {
        try {
            const remark = localStorage.getItem('chat_setting_remark_' + chatId);
            if (remark) {
                try { return JSON.parse(remark); } catch(e) { return remark; }
            }
        } catch(e) {}
        return null;
    }

    function loadGroups() {
        try {
            const raw = localStorage.getItem(GROUP_STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                return data.groups || [];
            }
        } catch(e) {}
        return [];
    }

    function saveGroups(groups) {
        localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify({ groups: groups }));
    }

    // ===== 群资料（与 groups / group-setting 共用的内部数据） =====
    const GROUP_DATA_PREFIX = 'group_data_';
    const GROUP_MSG_PREFIX = 'group_msgs_';
    const MEMBER_BG = ['#2c5fb1','#b1552c','#2c7a3e','#6d2cb1','#d96f3a','#0a84ff','#ff375f','#30d158'];

    function getGroupData(groupId) {
        try {
            const raw = localStorage.getItem(GROUP_DATA_PREFIX + groupId);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    // 群人数以内部数据 group_data 为准（registry 可能不同步），并包含用户自己
    function getGroupMemberCount(groupId, group) {
        try {
            const gd = getGroupData(groupId);
            if (gd && Array.isArray(gd.members)) return gd.members.length + 1;
        } catch (e) {}
        return (group && Array.isArray(group.members)) ? group.members.length + 1 : 0;
    }

    function getGroupLastMessage(groupId) {
        try {
            const raw = localStorage.getItem(GROUP_MSG_PREFIX + groupId);
            const messages = raw ? JSON.parse(raw) : [];
            if (messages && messages.length > 0) return messages[messages.length - 1];
            return null;
        } catch (e) { return null; }
    }

    function groupMsgPreview(lastMsg, groupId) {
        let text;
        if (lastMsg.isImage && lastMsg.imageData && (lastMsg.imageData.isEmoji || lastMsg.imageData.emojiName || lastMsg.imageData.desc === '表情包')) text = '[表情包：' + (lastMsg.imageData.emojiName || lastMsg.imageData.desc || '表情') + ']';
        else if (lastMsg.isImage) text = '图片';
        else if (lastMsg.isVoice) text = '语音';
        else if (lastMsg.isCard) text = '卡片消息';
        else text = lastMsg.text || '';
        if (text.length > 20) text = text.substring(0, 20) + '...';
        let prefix = '';
        if (lastMsg.type === 'right') {
            prefix = '我：';
        } else if (lastMsg.senderId) {
            const g = getGroupData(groupId);
            const members = g && Array.isArray(g.members) ? g.members : [];
            const who = members.find(m => m.id === lastMsg.senderId);
            if (who) prefix = (who.nick || who.name) + '：';
        }
        return prefix + text;
    }

    // ===== 聊天卡片左滑：置顶 / 删除 =====
    const PIN_STORAGE_KEY = 'nano_pinned_data';

    function getPinnedIds() {
        const user = getCurrentUser();
        if (!user) return [];
        try {
            const d = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || '{}');
            return Array.isArray(d[user.id]) ? d[user.id] : [];
        } catch (e) { return []; }
    }

    function savePinnedIds(ids) {
        const user = getCurrentUser();
        if (!user) return;
        try {
            const d = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || '{}');
            d[user.id] = ids;
            localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(d));
        } catch (e) {}
    }

    function pinRank(charId) {
        const i = getPinnedIds().indexOf(charId);
        return i === -1 ? Infinity : i;
    }

    function togglePin(charId) {
        const ids = getPinnedIds();
        const i = ids.indexOf(charId);
        if (i > -1) ids.splice(i, 1);
        else ids.unshift(charId);
        savePinnedIds(ids);
        renderAll();
    }

    function removeCharRow(charId) {
        return new Promise(function(resolve) {
            try {
                const req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function(e) {
                    try {
                        const d = e.target.result;
                        if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                    } catch (e) {}
                };
                req.onsuccess = function(e) {
                    try {
                        const db = e.target.result;
                        const tx = db.transaction('characters', 'readwrite');
                        tx.objectStore('characters').delete(charId);
                        tx.oncomplete = function() { resolve(); };
                        tx.onerror = function() { resolve(); };
                    } catch (err) { resolve(); }
                };
                req.onerror = function() { resolve(); };
            } catch (e) { resolve(); }
        });
    }

    function pruneCharFromWorldbooks(charId) {
        try {
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
                        if (!d || !Array.isArray(d.files)) return;
                        let changed = false;
                        d.files.forEach(f => {
                            if (!Array.isArray(f.boundCharacters)) return;
                            const before = f.boundCharacters.length;
                            f.boundCharacters = f.boundCharacters.filter(id => id !== charId);
                            if (f.boundCharacters.length !== before) changed = true;
                        });
                        if (changed) {
                            try {
                                localStorage.setItem('nano_worldbook_data_v5', JSON.stringify(d));
                            } catch (e) {}
                            try {
                                db.transaction('worldbook_data', 'readwrite').objectStore('worldbook_data').put({ key: 'data', value: d });
                            } catch (e) {}
                        }
                    };
                } catch (err) {}
            };
            req.onerror = function() {};
        } catch (e) {}
    }

    async function deleteChat(charId) {
        if (!window.confirm('删除该角色？其聊天记录也会一并删除。')) return;
        await removeCharRow(charId);
        const pinned = getPinnedIds().filter(id => id !== charId);
        savePinnedIds(pinned);
        pruneCharFromWorldbooks(charId);
        try { localStorage.removeItem('chat_messages_' + charId); } catch (e) {}
        try { localStorage.removeItem('chat_setting_remark_' + charId); } catch (e) {}
        if (typeof localforage !== 'undefined') {
            localforage.removeItem('chat_messages_' + charId).catch(function() {});
        }
        try {
            window.parent.postMessage({ type: 'contactsDataUpdated', data: { chars: [] } }, '*');
        } catch (e) {}
        renderAll();
    }

    function attachChatSwipe(wrap, item) {
        const front = wrap.querySelector('.chat-swipe-front');
        if (!front) return;
        let x0 = null, y0 = null, started = false;
        front.addEventListener('touchstart', function(e) {
            if (e.touches.length === 1) {
                const t = e.touches[0];
                x0 = t.clientX;
                y0 = t.clientY;
                started = false;
            }
        }, { passive: true });
        front.addEventListener('touchmove', function(e) {
            if (x0 === null) return;
            const t = e.touches[0];
            const dx = t.clientX - x0;
            const dy = t.clientY - y0;
            if (!started && Math.abs(dx) > 10) started = true;
            if (!started) return;
            if (dx < -30 && Math.abs(dy) < Math.abs(dx)) {
                document.querySelectorAll('.chat-item-wrap.swiped').forEach(w => { if (w !== wrap) w.classList.remove('swiped'); });
                wrap.classList.add('swiped');
            } else if (dx > 30 && wrap.classList.contains('swiped')) {
                wrap.classList.remove('swiped');
            }
        }, { passive: true });
        front.addEventListener('touchend', function() { x0 = null; y0 = null; }, { passive: true });
    }

    function wrapChatItem(itemDiv, item) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-item-wrap';
        try {
            if (getPinnedIds().indexOf(item.id) !== -1) wrap.classList.add('pinned');
        } catch (e) {}
        const actions = document.createElement('div');
        actions.className = 'chat-swipe-actions';
        const pin = document.createElement('button');
        pin.className = 'chat-swipe-btn pin';
        pin.textContent = '置顶';
        const del = document.createElement('button');
        del.className = 'chat-swipe-btn del';
        del.textContent = '删除';
        pin.addEventListener('click', function(e) { e.stopPropagation(); togglePin(item.id); });
        del.addEventListener('click', function(e) { e.stopPropagation(); deleteChat(item.id); });
        actions.appendChild(pin);
        actions.appendChild(del);
        const front = document.createElement('div');
        front.className = 'chat-swipe-front';
        front.appendChild(itemDiv);
        wrap.appendChild(actions);
        wrap.appendChild(front);
        attachChatSwipe(wrap, item);
        return wrap;
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.chat-swipe-actions')) {
            document.querySelectorAll('.chat-item-wrap.swiped').forEach(w => w.classList.remove('swiped'));
        }
    });

    function getHomeData() {
        // 新键名：nano_mask_data（当前项目为 nano）
        try {
            const raw = localStorage.getItem(HOME_STORAGE_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                if (d && Array.isArray(d.masks)) return d;
            }
        } catch (e) {}
        // 兼容旧键名（nano_home_data / peach_home_data）：仅当旧键里存的是人设数据才迁移
        for (let i = 0; i < LEGACY_HOME_STORAGE_KEYS.length; i++) {
            try {
                const legacyRaw = localStorage.getItem(LEGACY_HOME_STORAGE_KEYS[i]);
                if (legacyRaw) {
                    const legacy = JSON.parse(legacyRaw);
                    if (legacy && Array.isArray(legacy.masks)) {
                        try { localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(legacy)); } catch (e) {}
                        return legacy;
                    }
                }
            } catch (e) {}
        }
        return { masks: [], currentMaskId: null };
    }

    function getMasks() {
        const homeData = getHomeData();
        return homeData.masks || [];
    }

    function getCurrentUser() {
        const homeData = getHomeData();
        const masks = homeData.masks || [];
        const currentId = homeData.currentMaskId;
        if (currentId) {
            return masks.find(m => m.id === currentId) || null;
        }
        return null;
    }

    function setCurrentUser(userId) {
        const homeData = getHomeData();
        homeData.currentMaskId = userId;
        localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(homeData));
        try {
            window.parent.postMessage({ type: 'currentMaskChanged', maskId: userId }, '*');
        } catch(e) {}
        renderAll();
    }

    function compressImage(dataUrl, maxWidth, maxHeight, quality) {
        return new Promise(function(resolve) {
            const img = new Image();
            img.onload = function() {
                let w = img.width;
                let h = img.height;
                if (w > maxWidth) {
                    h = h * (maxWidth / w);
                    w = maxWidth;
                }
                if (h > maxHeight) {
                    w = w * (maxHeight / h);
                    h = maxHeight;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality || 0.6));
            };
            img.src = dataUrl;
        });
    }

    // ===== 人设头像存于 IndexedDB（与 mask.js 共用 MaskAvatarDB），此处异步读取 =====
    function getAvatarFromDB(id) {
        return new Promise(function(resolve) {
            try {
                const req = indexedDB.open('MaskAvatarDB', 1);
                req.onupgradeneeded = function(e) {
                    try {
                        const d = e.target.result;
                        if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars', { keyPath: 'id' });
                    } catch (err) {}
                };
                req.onsuccess = function(e) {
                    try {
                        const db = e.target.result;
                        const r = db.transaction('avatars', 'readonly').objectStore('avatars').get(id);
                        r.onsuccess = function() { resolve(r.result ? r.result.data : ''); };
                        r.onerror = function() { resolve(''); };
                    } catch (err) { resolve(''); }
                };
                req.onerror = function() { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }

    function updateStatusBarAvatar(user) {
        const avatarPlaceholder = document.getElementById('userAvatarPlaceholder');
        const avatarImage = document.getElementById('userAvatarImage');
        if (!avatarPlaceholder || !avatarImage) return;
        avatarImage.style.display = 'none';
        avatarImage.removeAttribute('src');
        avatarPlaceholder.style.display = 'flex';
        if (user && user.name) {
            avatarPlaceholder.textContent = user.name.charAt(0).toUpperCase();
        } else {
            avatarPlaceholder.textContent = '?';
        }
        if (!user) return;
        // 从 IndexedDB 异步加载该人设头像，保证切换 user 面具后头像同步
        getAvatarFromDB(user.id).then(function(dataUrl) {
            const cur = getCurrentUser();
            if (!cur || cur.id !== user.id) return;
            if (dataUrl && dataUrl.trim() !== '') {
                avatarImage.src = dataUrl;
                avatarImage.style.display = 'block';
                avatarPlaceholder.style.display = 'none';
            }
        });
    }

    function renderDropdown() {
        const dropdown = document.getElementById('userDropdown');
        const masks = getMasks();
        const currentUser = getCurrentUser();
        dropdown.innerHTML = '';

        if (masks.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:12px 16px;color:#aeaeb2;font-size:14px;text-align:center;';
            empty.textContent = '暂无⼈设，请先创建';
            dropdown.appendChild(empty);
            return;
        }

        const ddLabel = document.createElement('div');
        ddLabel.className = 'dd-label';
        ddLabel.textContent = '切换人设';
        dropdown.appendChild(ddLabel);

        masks.forEach(m => {
            const item = document.createElement('div');
            item.className = 'dropdown-item' + (currentUser && m.id === currentUser.id ? ' active' : '');
            const avatar = document.createElement('div');
            avatar.className = 'd-avatar';
            if (m.avatar && m.avatar.trim() !== '') {
                const img = document.createElement('img');
                img.src = m.avatar;
                avatar.appendChild(img);
            } else {
                avatar.textContent = (m.name || '?').charAt(0).toUpperCase();
            }
            item.appendChild(avatar);

            // 从 IndexedDB 读取人设头像（mask.js 把头像存在 MaskAvatarDB）
            getAvatarFromDB(m.id).then(function(dataUrl) {
                if (!dataUrl || dataUrl.trim() === '') return;
                avatar.innerHTML = '';
                const img = document.createElement('img');
                img.src = dataUrl;
                avatar.appendChild(img);
            });

            const name = document.createElement('span');
            name.className = 'd-name';
            name.textContent = m.name || '未命名';
            item.appendChild(name);

            item.addEventListener('click', function() {
                setCurrentUser(m.id);
                document.getElementById('userDropdown').classList.remove('show');
                document.getElementById('arrowIcon').classList.remove('open');
            });

            dropdown.appendChild(item);
        });

        const manage = document.createElement('div');
        manage.className = 'dd-manage';
        manage.innerHTML = '<span class="plus">+</span><span>管理人设 / 新建</span>';
        manage.addEventListener('click', function () {
            document.getElementById('userDropdown').classList.remove('show');
            document.getElementById('arrowIcon').classList.remove('open');
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'openFullscreen', url: 'mask.html', title: 'Mask', source: 'chat' }, '*');
            } else {
                window.location.href = 'mask.html';
            }
        });
        dropdown.appendChild(manage);
    }

    // 角色数量用英文单词显示（eg: seven），超出范围则退回数字
    function numWord(n) {
        n = parseInt(n, 10) || 0;
        var ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        var tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        if (n < 0 || n > 99) return String(n);
        if (n < 20) return ones[n];
        var t = Math.floor(n / 10), o = n % 10;
        return tens[t] + (o ? ' ' + ones[o] : '');
    }

    // 头像行「+」的待处理好友申请红点
    function updateMeetBadge() {
        try {
            const el = document.getElementById('avatarAddBtn');
            if (!el) return;
            let n = 0;
            try {
                const cur = getCurrentUser();
                const all = JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || [];
                n = all.filter(r => r && r.status === 'pending' && String(r.owner || '') === String(cur && cur.id || '')).length;
            } catch (e) {}
            el.classList.toggle('has-req', n > 0);
        } catch (e) {}
    }
    updateMeetBadge();
    setInterval(updateMeetBadge, 5000);

    // ===== 渲染聊天列表（改为异步） =====
    async function renderChatList() {
        const currentUser = getCurrentUser();
        await ensureNanoCharacterExists();
        if (currentUser && currentUser.id != null) {
            try { await migrateOrphanNpcs(currentUser.id); } catch (e) {}
        }
        const allChars = await getCharacters();
        const groups = loadGroups();

        const userNameDisplay = document.getElementById('userNameDisplay');
        const charCountDisplay = document.getElementById('charCountDisplay');

        if (currentUser) {
            userNameDisplay.textContent = currentUser.name || '未命名';
            updateStatusBarAvatar(currentUser);
        } else {
            userNameDisplay.innerHTML = '<span class="placeholder">选择人设</span>';
            updateStatusBarAvatar(null);
        }

        let displayChars = [];
        if (currentUser) {
            // 用户隔离：只显示绑定到当前人设的角色 + 纳米助手；不再显示别的 user 的 NPC/小号
            displayChars = allChars.filter(c => String(c.bindUser) === String(currentUser.id) || !!c.nanoAssistant);
        }
        charCountDisplay.textContent = numWord(displayChars.length);

        const chatList = document.getElementById('chatList');
        const noResult = document.getElementById('noResult');
        chatList.innerHTML = '';
        chatList.appendChild(noResult);

        if (currentTab === 'friends') {
            if (displayChars.length === 0) {
                noResult.classList.add('active');
                noResult.textContent = currentUser ? '该人设暂无绑定角色' : '请先在「人设」页面选择当前人设';
                return;
            }
            noResult.classList.remove('active');
            // 置顶优先；其余按最近活跃排序
            const pinned = getPinnedIds();
            displayChars = displayChars.slice().sort(function(a, b) {
                const pa = pinned.indexOf(a.id);
                const pb = pinned.indexOf(b.id);
                if (pa !== -1 || pb !== -1) {
                    if (pa === -1) return 1;
                    if (pb === -1) return -1;
                    return pa - pb;
                }
                const aa = window.NanoBadge ? NanoBadge.getActivity(a.id) : 0;
                const ab = window.NanoBadge ? NanoBadge.getActivity(b.id) : 0;
                return ab - aa;
            });
            displayChars.forEach(item => {
                const div = createChatItem(item);
                const wrapped = wrapChatItem(div, item);
                chatList.appendChild(wrapped);
            });
        } else {
            if (groups.length === 0) {
                noResult.classList.add('active');
                noResult.textContent = '暂无群聊';
                return;
            }
            noResult.classList.remove('active');
            const gpinned = getPinnedIds();
            groups.slice().sort(function(a, b) {
                const pa = gpinned.indexOf(a.id);
                const pb = gpinned.indexOf(b.id);
                if (pa !== -1 || pb !== -1) {
                    if (pa === -1) return 1;
                    if (pb === -1) return -1;
                    return pa - pb;
                }
                const aa = window.NanoBadge ? NanoBadge.getActivity(a.id) : 0;
                const ab = window.NanoBadge ? NanoBadge.getActivity(b.id) : 0;
                return ab - aa;
            }).forEach(group => {
                if (group && group.pending) return; // 未同意入群的邀请群不显示
                const div = createGroupItem(group);
                chatList.appendChild(div);
            });
        }
    }

    function makeUnreadBadge(chatId) {
        const n = window.NanoBadge ? NanoBadge.getUnread(chatId) : 0;
        if (!n) return null;
        const b = document.createElement('div');
        b.className = 'chat-unread';
        b.textContent = n > 99 ? '99+' : String(n);
        return b;
    }

    function createChatItem(item) {
        const div = document.createElement('div');
        div.className = 'chat-item';
        const chatId = item.id || item.name || 'default';
        div.dataset.chat = chatId;
        div.dataset.name = item.name || '未命名';
        div.dataset.avatar = item.avatar || '';
        div.dataset.type = 'single';

        const avatar = document.createElement('div');
        avatar.className = 'chat-avatar';
        if (item.avatar && item.avatar.trim() !== '') {
            const img = document.createElement('img');
            img.src = item.avatar;
            avatar.appendChild(img);
        } else {
            avatar.textContent = item.name ? item.name.charAt(0).toUpperCase() : '?';
        }
        div.appendChild(avatar);

        const info = document.createElement('div');
        info.className = 'chat-info';

        // ===== 1. 同步备注昵称，去掉点和 user 名字 =====
        const name = document.createElement('div');
        name.className = 'chat-name';
        let displayName = item.name || '未命名';
        const remark = getRemark(chatId);
        if (remark) {
            displayName = remark;
        }
        name.textContent = displayName;
        info.appendChild(name);

        // ===== 2. 显示最新一条消息 =====
        const msg = document.createElement('div');
        msg.className = 'chat-msg';
        const lastMsg = getLastMessage(chatId);
        if (lastMsg) {
            if (lastMsg.isImage && lastMsg.imageData && (lastMsg.imageData.isEmoji || lastMsg.imageData.emojiName || lastMsg.imageData.desc === '表情包')) {
                msg.textContent = '[表情包：' + (lastMsg.imageData.emojiName || lastMsg.imageData.desc || '表情') + ']';
            } else if (lastMsg.isImage) {
                msg.textContent = '图片';
            } else if (lastMsg.isCard) {
                if (lastMsg.cardData && lastMsg.cardData.cardType === 'transfer') {
                    msg.textContent = '转账';
                } else if (lastMsg.cardData && lastMsg.cardData.cardType === 'gift') {
                    msg.textContent = '礼物';
                } else if (lastMsg.cardData && lastMsg.cardData.cardType === 'call') {
                    msg.textContent = lastMsg.cardData.missed ? '未接电话' : '语音通话';
                } else {
                    msg.textContent = '卡片消息';
                }
            } else if (lastMsg.isVoice) {
                msg.textContent = '语音';
            } else {
                const text = lastMsg.text || '';
                msg.textContent = text.length > 20 ? text.substring(0, 20) + '...' : text;
            }
            // 显示发送者
            const sender = lastMsg.type === 'right' ? '我：' : '';
            msg.textContent = sender + msg.textContent;
        } else {
            msg.textContent = item.setting ? item.setting.substring(0, 20) + '...' : '点击开始对话';
        }
        info.appendChild(msg);
        div.appendChild(info);

        // ===== 3. 显示具体时间 =====
        const time = document.createElement('div');
        time.className = 'chat-time';
        if (lastMsg && lastMsg.time) {
            time.textContent = lastMsg.time;
        } else {
            time.textContent = '';
        }
        div.appendChild(time);

        const badge = makeUnreadBadge(chatId);
        if (badge) div.appendChild(badge);

        div.addEventListener('click', function() {
            const name = this.dataset.name || '聊天';
            const chatId = this.dataset.chat || 'default';
            const avatar = this.dataset.avatar || '';
            console.log('[Chat] 点击联系人, chatId:', chatId, 'name:', name);
            try { if (window.NanoBadge) NanoBadge.markRead(chatId); } catch (e) {}
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'openChat',
                    chatId: chatId,
                    chatName: name,
                    chatAvatar: avatar
                }, '*');
            }
        });

        return div;
    }

    function createGroupItem(group) {
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.dataset.chat = group.id;
        div.dataset.name = group.name;
        div.dataset.type = 'group';

        const avatar = document.createElement('div');
        avatar.className = 'chat-avatar';
        if (group.avatar && group.avatar.trim() !== '') {
            const img = document.createElement('img');
            img.src = group.avatar;
            avatar.appendChild(img);
        } else {
            avatar.textContent = group.name ? group.name.charAt(0).toUpperCase() : '群';
        }
        div.appendChild(avatar);

        const info = document.createElement('div');
        info.className = 'chat-info';
        const name = document.createElement('div');
        name.className = 'chat-name';
        name.textContent = group.name || '未命名群聊';
        const span = document.createElement('span');
        const memberCount = getGroupMemberCount(group.id, group);
        span.textContent = memberCount ? memberCount + '人' : '';
        name.appendChild(span);
        info.appendChild(name);
        const msg = document.createElement('div');
        msg.className = 'chat-msg';
        const lastGroupMsg = getGroupLastMessage(group.id);
        msg.textContent = lastGroupMsg ? groupMsgPreview(lastGroupMsg, group.id) : '点击进入群聊';
        info.appendChild(msg);
        div.appendChild(info);

        const time = document.createElement('div');
        time.className = 'chat-time';
        time.textContent = lastGroupMsg && lastGroupMsg.time ? lastGroupMsg.time : '';
        div.appendChild(time);

        const badge = makeUnreadBadge(group.id);
        if (badge) div.appendChild(badge);

        div.addEventListener('click', function() {
            const name = this.dataset.name || '群聊';
            const groupId = this.dataset.chat || 'default';
            try { if (window.NanoBadge) NanoBadge.markRead(groupId); } catch (e) {}
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'openGroupChat',
                    groupId: groupId,
                    groupName: name
                }, '*');
            }
        });

        return div;
    }

    // ===== renderAll 改为异步 =====
    async function renderAll() {
        renderDropdown();
        await renderChatList();
    }

    // ===== 状态栏 =====
    const userStatusBar = document.getElementById('userStatusBar');
    const userDropdown = document.getElementById('userDropdown');
    const arrowIcon = document.getElementById('arrowIcon');

    userStatusBar.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = userDropdown.classList.contains('show');
        userDropdown.classList.toggle('show');
        arrowIcon.classList.toggle('open');
        if (!isOpen) {
            renderDropdown();
        }
    });

    document.addEventListener('click', function() {
        userDropdown.classList.remove('show');
        arrowIcon.classList.remove('open');
    });

    // ===== 群聊创建 =====
    const groupModal = document.getElementById('groupModal');
    const groupNameInput = document.getElementById('groupNameInput');
    const groupMemberSelect = document.getElementById('groupMemberSelect');
    const groupAddMemberBtn = document.getElementById('groupAddMemberBtn');
    const groupMemberList = document.getElementById('groupMemberList');
    const groupCancel = document.getElementById('groupCancel');
    const groupConfirm = document.getElementById('groupConfirm');
    const groupAvatarPicker = document.getElementById('groupAvatarPicker');
    const groupAvatarPlaceholder = document.getElementById('groupAvatarPlaceholder');
    const groupAvatarPreview = document.getElementById('groupAvatarPreview');
    const groupSubTitle = document.getElementById('groupSubTitle');

    function openGroupModal() {
        const currentUser = getCurrentUser();
        if (!currentUser) {
            alert('请先选择一个人设');
            return;
        }
        getCharacters().then(allChars => {
            const bindChars = allChars.filter(c => c.bindUser === currentUser.id);
            if (bindChars.length === 0) {
                alert('当前人设没有绑定的角色，请先在角色库绑定');
                return;
            }

            selectedGroupMembers = [];
            groupTempAvatar = '';
            groupNameInput.value = '';
            groupAvatarPreview.style.display = 'none';
            groupAvatarPlaceholder.style.display = 'block';
            groupAvatarPlaceholder.textContent = '+';

            groupMemberSelect.innerHTML = '<option value="">选择要添加的成员...</option>';
            bindChars.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name || '未命名';
                groupMemberSelect.appendChild(opt);
            });

            renderGroupMemberList();
            groupSubTitle.textContent = '当前人设: ' + currentUser.name;
            groupModal.classList.add('active');
        });
    }

    function closeGroupModal() {
        groupModal.classList.remove('active');
        selectedGroupMembers = [];
        groupTempAvatar = '';
    }

    function renderGroupMemberList() {
        groupMemberList.innerHTML = '';
        if (selectedGroupMembers.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;padding:12px 0;color:#aeaeb2;font-size:13px;';
            empty.textContent = '暂无成员，请添加';
            groupMemberList.appendChild(empty);
            return;
        }
        getCharacters().then(allChars => {
            selectedGroupMembers.forEach(id => {
                const c = allChars.find(ch => ch.id === id);
                if (!c) return;
                const div = document.createElement('div');
                div.className = 'group-member-item';
                const avatar = document.createElement('div');
                avatar.className = 'gm-avatar';
                if (c.avatar && c.avatar.trim() !== '') {
                    const img = document.createElement('img');
                    img.src = c.avatar;
                    avatar.appendChild(img);
                } else {
                    avatar.textContent = (c.name || '?').charAt(0).toUpperCase();
                }
                div.appendChild(avatar);
                const name = document.createElement('span');
                name.className = 'gm-name';
                name.textContent = c.name || '未命名';
                div.appendChild(name);
                const remove = document.createElement('span');
                remove.className = 'gm-remove';
                remove.textContent = '✕';
                remove.addEventListener('click', function() {
                    const idx = selectedGroupMembers.indexOf(id);
                    if (idx > -1) selectedGroupMembers.splice(idx, 1);
                    renderGroupMemberList();
                });
                div.appendChild(remove);
                groupMemberList.appendChild(div);
            });
        });
    }

    groupAddMemberBtn.addEventListener('click', function() {
        const val = groupMemberSelect.value;
        if (!val) return;
        if (selectedGroupMembers.includes(val)) {
            alert('该成员已添加');
            return;
        }
        selectedGroupMembers.push(val);
        renderGroupMemberList();
        groupMemberSelect.value = '';
    });

    groupCancel.addEventListener('click', closeGroupModal);
    groupModal.addEventListener('click', function(e) {
        if (e.target === groupModal) closeGroupModal();
    });

    groupConfirm.addEventListener('click', async function() {
        const name = groupNameInput.value.trim() || '群聊';
        if (selectedGroupMembers.length === 0) {
            alert('请至少添加一个成员');
            return;
        }
        const currentUser = getCurrentUser();
        const allChars = await getCharacters();
        const memberNames = selectedGroupMembers.map(id => {
            const c = allChars.find(ch => ch.id === id);
            return c ? c.name : id;
        });

        const groups = loadGroups();
        const newGroup = {
            id: 'g' + Date.now(),
            name: name,
            avatar: groupTempAvatar || '',
            members: selectedGroupMembers,
            memberNames: memberNames,
            createdBy: currentUser ? currentUser.id : null,
            createdByName: currentUser ? currentUser.name : '未知',
            createdAt: Date.now()
        };
        groups.push(newGroup);
        saveGroups(groups);

        // 同步创建群内部数据，保证 groups / group-setting 页头像、群名、成员一致
        try {
            const memberObjects = selectedGroupMembers.map(function(id, i) {
                const c = allChars.find(ch => ch.id === id) || {};
                const nm = c.name || id;
                return {
                    id: id,
                    name: nm,
                    nick: nm,
                    initial: nm.charAt(0),
                    bg: MEMBER_BG[i % MEMBER_BG.length],
                    avatar: c.avatar || '',
                    role: '成员',
                    title: '',
                    level: 1,
                    msgCount: 0
                };
            });
            localStorage.setItem(GROUP_DATA_PREFIX + newGroup.id, JSON.stringify({
                name: name,
                notice: '',
                avatar: groupTempAvatar || '',
                ownerId: 'me',
                members: memberObjects
            }));
        } catch (e) {}

        closeGroupModal();
        renderAll();

        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'groupCreated',
                group: newGroup
            }, '*');
        }
    });

    // ===== 群头像 =====
    groupAvatarPicker.addEventListener('click', function() {
        document.getElementById('groupAvatarModal').classList.add('active');
    });

    document.getElementById('groupAvatarGallery').addEventListener('click', function() {
        document.getElementById('groupAvatarModal').classList.remove('active');
        document.getElementById('groupImageFileInput').click();
    });

    document.getElementById('groupImageFileInput').addEventListener('change', async function(e) {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function(ev) {
            try {
                const compressed = await compressImage(ev.target.result, 200, 200, 0.6);
                groupTempAvatar = compressed;
                groupAvatarPreview.src = compressed;
                groupAvatarPreview.style.display = 'block';
                groupAvatarPlaceholder.style.display = 'none';
                document.getElementById('groupImageFileInput').value = '';
            } catch(err) {
                console.error('压缩失败:', err);
            }
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('groupAvatarUrl').addEventListener('click', function() {
        document.getElementById('groupAvatarModal').classList.remove('active');
        const url = prompt('请输入图片 URL：');
        if (url && url.trim() !== '') {
            groupTempAvatar = url.trim();
            groupAvatarPreview.src = url.trim();
            groupAvatarPreview.style.display = 'block';
            groupAvatarPlaceholder.style.display = 'none';
        }
    });

    document.getElementById('groupAvatarCancel').addEventListener('click', function() {
        document.getElementById('groupAvatarModal').classList.remove('active');
    });

    // ===== 头像弹窗 =====
    const avatarItems = document.querySelectorAll('.avatar-item:not(.avatar-add)');
    const modal = document.getElementById('avatarModal');
    const modalGallery = document.getElementById('modalGallery');
    const modalUrlBtn = document.getElementById('modalUrlBtn');
    const modalCancel = document.getElementById('modalCancel');
    const urlInputArea = document.getElementById('urlInputArea');
    const urlInput = document.getElementById('urlInput');
    const urlSubmit = document.getElementById('urlSubmit');
    let currentTarget = null;

    function openModal(target) {
        currentTarget = target;
        urlInputArea.style.display = 'none';
        urlInput.value = '';
        modal.classList.add('active');
    }

    function closeModal() {
        modal.classList.remove('active');
        currentTarget = null;
    }

    // ===== 头像栏持久化 + 统一裁成方图（修「存不住 / 不适配」）=====
    // 头像图片体积大，localStorage 很容易被聊天记录占满，导致「换到第三张就存不住、
    // 前面几张又被打回旧值」。这里改用 IndexedDB 做真正的主存储，容量足够放 4 张头像；
    // localStorage 只在放得下时镜像一份，作为兼容旧数据 / 快速首屏。
    const AVATAR_BAR_KEY = 'nano_avatar_bar';
    const AVATAR_BAR_DB = 'NanoAvatarBarDB';
    const AVATAR_BAR_STORE = 'bar';
    let avatarBarCache = [];
    let avatarBarDirty = false;   // 用户本次已改过：异步回读的旧数据不再覆盖

    function readAvatarBarLocal() {
        try { const a = JSON.parse(localStorage.getItem(AVATAR_BAR_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function avatarBarOpenDB() {
        return new Promise(function (resolve, reject) {
            try {
                const req = indexedDB.open(AVATAR_BAR_DB, 1);
                req.onupgradeneeded = function (e) {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(AVATAR_BAR_STORE)) db.createObjectStore(AVATAR_BAR_STORE, { keyPath: 'id' });
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }
    function avatarBarReadIDB() {
        return avatarBarOpenDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    const g = db.transaction(AVATAR_BAR_STORE, 'readonly').objectStore(AVATAR_BAR_STORE).get('bar');
                    g.onsuccess = function () { resolve((g.result && g.result.value) || []); };
                    g.onerror = function () { resolve([]); };
                } catch (e) { resolve([]); }
            });
        }).catch(function () { return []; });
    }
    function avatarBarWriteIDB(arr) {
        return avatarBarOpenDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    const tx = db.transaction(AVATAR_BAR_STORE, 'readwrite');
                    tx.objectStore(AVATAR_BAR_STORE).put({ id: 'bar', value: arr });
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { resolve(); };
                } catch (e) { resolve(); }
            });
        }).catch(function () {});
    }
    function readAvatarBar() { return avatarBarCache; }
    function writeAvatarBar(arr) {
        avatarBarCache = Array.isArray(arr) ? arr : [];
        avatarBarDirty = true;
        try { avatarBarWriteIDB(avatarBarCache); } catch (e) {}
        try { localStorage.setItem(AVATAR_BAR_KEY, JSON.stringify(avatarBarCache)); } catch (e) {}
    }
    function renderAvatarSlot(item, value) {
        if (!item) return;
        if (!value) { item.innerHTML = ''; item.classList.remove('has-image'); return; }
        item.innerHTML = '';
        const img = document.createElement('img');
        img.src = value;
        img.onload = function () { item.classList.add('has-image'); };
        img.onerror = function () { item.classList.remove('has-image'); };
        item.appendChild(img);
        item.classList.add('has-image');
    }
    function setAvatarSlot(index, value) {
        if (isNaN(index)) return;
        const arr = readAvatarBar().slice();
        arr[index] = value;
        writeAvatarBar(arr);
        renderAvatarSlot(document.querySelector('.avatar-item[data-index="' + index + '"]'), value);
    }
    // 文件 → 居中裁成正方形的小图。
    // 用 FileReader + <img>（各手机浏览器最稳），不再依赖 createImageBitmap
    // —— 后者在部分手机端会不返回/报错，导致「选了照片没反应」。失败则退回原图。
    function cropToSquareDataURL(file, size) {
        return new Promise(function (resolve) {
            let done = false;
            function finish(v) { if (done) return; done = true; resolve(v); }
            setTimeout(function () { finish(null); }, 15000);   // 兜底：别让 UI 永远无反应
            const reader = new FileReader();
            reader.onload = function (ev) {
                const raw = ev.target.result;
                const image = new Image();
                image.onload = function () {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = size; canvas.height = size;
                        const ctx = canvas.getContext('2d');
                        const side = Math.min(image.width, image.height) || size;
                        const sx = Math.max(0, (image.width - side) / 2);
                        const sy = Math.max(0, (image.height - side) / 2);
                        ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
                        finish(canvas.toDataURL('image/jpeg', 0.88));
                    } catch (e) { finish(raw); }
                };
                image.onerror = function () { finish(raw); };
                image.src = raw;
            };
            reader.onerror = function () { finish(null); };
            try { reader.readAsDataURL(file); } catch (e) { finish(null); }
        });
    }
    // 渲染照片墙（只读内存缓存，避免异步回读时把刚换好的图覆盖回去）
    function hydrateAvatarBar() {
        document.querySelectorAll('.avatar-item:not(.avatar-add)').forEach(function (item) {
            const idx = parseInt(item.dataset.index, 10);
            if (!isNaN(idx)) renderAvatarSlot(item, avatarBarCache[idx] || '');
        });
    }
    // 先用旧版 localStorage 数据快速渲染，再以 IndexedDB 的正式数据为准
    avatarBarCache = readAvatarBarLocal();
    hydrateAvatarBar();
    avatarBarReadIDB().then(function (arr) {
        if (avatarBarDirty) return;   // 用户已经改过：以用户操作为准，别用旧数据覆盖
        if (Array.isArray(arr) && arr.length) {
            avatarBarCache = arr;
            hydrateAvatarBar();
        } else if (avatarBarCache.length) {
            avatarBarWriteIDB(avatarBarCache);   // 首次：把旧版 localStorage 数据迁移进 IndexedDB
        }
    });
    window.addEventListener('pageshow', hydrateAvatarBar);

    // 打开系统相册：常驻一个挂在 body 上的隐藏 input 复用，
    // 避免「临时创建 + 未入 DOM + 点一下」在部分手机浏览器上无效。
    const avatarPickInput = document.createElement('input');
    avatarPickInput.type = 'file';
    avatarPickInput.accept = 'image/*';
    avatarPickInput.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(avatarPickInput);
    let avatarPickTarget = null;
    avatarPickInput.addEventListener('change', async function () {
        const file = this.files && this.files[0];
        const target = avatarPickTarget;
        this.value = '';
        if (!file || !target) return;
        const dataUrl = await cropToSquareDataURL(file, 240);
        if (dataUrl) setAvatarSlot(parseInt(target.dataset.index, 10), dataUrl);
        avatarPickTarget = null;
    });
    // 点击照片墙 → 直接打开相册（不再弹窗）
    function pickForItem(target) {
        if (!target) return;
        avatarPickTarget = target;
        try { avatarPickInput.value = ''; } catch (e) {}
        avatarPickInput.click();
    }
    avatarItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            pickForItem(this);
        });
    });

    modalCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
    });

    modalGallery.addEventListener('click', function() {
        const target = currentTarget;
        closeModal();
        if (target) pickForItem(target);
    });

    modalUrlBtn.addEventListener('click', function() {
        urlInputArea.style.display = 'block';
        urlInput.focus();
    });

    urlSubmit.addEventListener('click', function() {
        const url = urlInput.value.trim();
        const target = currentTarget;
        if (url && target) {
            target.innerHTML = '';
            const img = document.createElement('img');
            img.src = url;
            img.onload = function() {
                target.classList.add('has-image');
            };
            img.onerror = function() {
                alert('图片加载失败，请检查链接');
            };
            target.appendChild(img);
            setAvatarSlot(parseInt(target.dataset.index, 10), url);
            closeModal();
        } else if (!url) {
            alert('请输入有效的图片链接');
        }
    });

    document.getElementById('avatarAddBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'openFullscreen', url: 'meet.html', title: 'Meet', showBack: true, source: 'chat' }, '*');
        } else {
            window.location.href = 'meet.html';
        }
    });

    // ===== 顶栏按钮：人设（mask）/ 角色库（character） =====
    const maskPageBtn = document.getElementById('maskPageBtn');
    const characterPageBtn = document.getElementById('characterPageBtn');

    if (maskPageBtn) {
        maskPageBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'openFullscreen', url: 'mask.html', title: 'Mask', source: 'chat' }, '*');
            } else {
                window.location.href = 'mask.html';
            }
        });
    }

    if (characterPageBtn) {
        characterPageBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (currentTab === 'friends') {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'openRoleLibrary' }, '*');
                } else {
                    window.location.href = 'character.html';
                }
            } else {
                openGroupModal();
            }
        });
    }

    // ===== 搜索 =====
    const searchInput = document.getElementById('searchInput');
    const searchIcon = document.getElementById('searchIcon');
    const searchClear = document.getElementById('searchClear');

    searchInput.addEventListener('input', function() {
        if (this.value.length > 0) {
            searchClear.classList.remove('hidden');
        } else {
            searchClear.classList.add('hidden');
        }
        filterChats(this.value);
    });

    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            filterChats(this.value);
        }
    });

    searchIcon.addEventListener('click', function() {
        filterChats(searchInput.value);
    });

    searchClear.addEventListener('click', function() {
        searchInput.value = '';
        searchClear.classList.add('hidden');
        filterChats('');
        searchInput.focus();
    });

    function filterChats(keyword) {
        const trimmed = keyword.trim().toLowerCase();
        const items = document.querySelectorAll('.chat-item');
        let hasVisible = false;
        items.forEach(item => {
            const name = (item.dataset.name || '').toLowerCase();
            const msg = (item.querySelector('.chat-msg')?.textContent || '').toLowerCase();
            const match = trimmed === '' || name.includes(trimmed) || msg.includes(trimmed);
            if (match) {
                item.classList.remove('hidden-item');
                hasVisible = true;
            } else {
                item.classList.add('hidden-item');
            }
        });
        const noResult = document.getElementById('noResult');
        if (trimmed !== '' && !hasVisible) {
            noResult.classList.add('active');
            noResult.textContent = '未找到相关结果';
        } else {
            noResult.classList.remove('active');
        }
    }

    // ===== 好友/群聊切换 =====
    const tabFriends = document.getElementById('tabFriends');
    const tabGroups = document.getElementById('tabGroups');

    tabFriends.addEventListener('click', function() {
        this.classList.add('active');
        tabGroups.classList.remove('active');
        currentTab = 'friends';
        renderChatList();
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'tabChange', tab: 'friends' }, '*');
        }
    });

    tabGroups.addEventListener('click', function() {
        this.classList.add('active');
        tabFriends.classList.remove('active');
        currentTab = 'groups';
        renderChatList();
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'tabChange', tab: 'groups' }, '*');
        }
    });

    // ===== 监听消息 =====
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (data && data.type === 'addAction') {
            if (currentTab === 'friends') {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'openRoleLibrary' }, '*');
                }
            } else {
                openGroupModal();
            }
        }
        if (data && (data.type === 'currentMaskChanged' || data.type === 'homeDataUpdated' || data.type === 'contactsDataUpdated' || data.type === 'groupsDataUpdated')) {
            renderAll();
        }
        // 从会话内页返回：立即刷新，清掉已读的红点
        if (data && (data.type === 'nanoOverlayClosed' || data.type === 'nanoOverlayOpen')) {
            renderAll();
        }
        // 角色头像/昵称实时更新：直接换掉好友区卡片的头像，无需重开页面
        if (data && data.type === 'nanoCharUpdated' && data.chatId) {
            try {
                var sel = '[data-chat="' + (window.CSS && CSS.escape ? CSS.escape(data.chatId) : data.chatId) + '"]';
                var item = document.querySelector(sel);
                if (item) {
                    if (typeof data.avatar === 'string') item.dataset.avatar = data.avatar;
                    if (data.name) item.dataset.name = data.name;
                    var av = item.querySelector('.chat-avatar');
                    if (av) {
                        av.innerHTML = '';
                        if (data.avatar) {
                            var img = document.createElement('img');
                            img.src = data.avatar;
                            av.appendChild(img);
                        } else if (typeof data.avatar === 'string') {
                            av.textContent = ((data.name || item.dataset.name || '?')).charAt(0).toUpperCase();
                        }
                    }
                }
            } catch (e) {}
            try { renderAll(); } catch (e) {}
        }
    });

    // ===== 群资料/群消息变化 → 刷新群聊卡片 =====
    window.addEventListener('storage', function(e) {
        if (!e || !e.key) return;
        if (e.key === GROUP_STORAGE_KEY || e.key.indexOf(GROUP_DATA_PREFIX) === 0 || e.key.indexOf(GROUP_MSG_PREFIX) === 0
            || e.key === 'nano_unread_counts' || e.key === 'nano_chat_activity') {
            renderAll();
        }
    });

    // ===== 通知父框架 =====
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'pageLoaded', page: 'chat' }, '*');
    }

    // ===== 初始化 =====
    renderAll();

    setInterval(function() {
        renderAll();
    }, 5000);

    window.NanoChatBridge = {
        getCurrentUser: getCurrentUser,
        getCharacters: getCharacters,
        renderAll: renderAll,
        openGroupModal: openGroupModal
    };
})();