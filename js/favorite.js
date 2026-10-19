/* ===== favorite.js - 收藏页面逻辑（IndexedDB 存储） ===== */
(function() {
    'use strict';

    const DB_NAME = 'nano_api_db';
    const DB_VERSION = 2;
    const FAVORITE_STORE = 'favorite_data';
    // 收藏按当前用户（人设/马甲）隔离：一个 user 一套收藏
    function nanoUid() {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
            if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
        } catch (e) {}
        return 'default';
    }
    const FAVORITE_LEGACY_KEY = 'nano_favorite';
    const FAVORITE_KEY = 'nano_favorite__' + nanoUid();

    // ============================================================
    // 1. IndexedDB 操作
    // ============================================================
    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                var request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(FAVORITE_STORE)) {
                        db.createObjectStore(FAVORITE_STORE, { keyPath: 'key' });
                        console.log('✅ 创建 favorite_data store');
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

    function idbSet(store, key, value) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                try {
                    var tx = db.transaction(store, 'readwrite');
                    var objectStore = tx.objectStore(store);
                    var request = objectStore.put({ key: key, value: value });
                    request.onsuccess = function() { resolve(); };
                    request.onerror = function(e) { reject(e.target.error); };
                    tx.oncomplete = function() { db.close(); };
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    function idbGet(store, key) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                try {
                    var tx = db.transaction(store, 'readonly');
                    var objectStore = tx.objectStore(store);
                    var request = objectStore.get(key);
                    request.onsuccess = function() {
                        resolve(request.result ? request.result.value : null);
                    };
                    request.onerror = function(e) { reject(e.target.error); };
                    tx.oncomplete = function() { db.close(); };
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    // ============================================================
    // 2. 数据操作（IndexedDB + localStorage 双写降级）
    // ============================================================
    function loadLocalNs() {
        try {
            var raw = localStorage.getItem(FAVORITE_KEY);
            if (raw) { var d = JSON.parse(raw); if (d && Array.isArray(d.favorites)) return d; }
        } catch (e) {}
        return null;
    }
    // 合并两份收藏（按 id / 内容去重），保证不会丢
    function favMerge(a, b) {
        var out = [], seen = {};
        (a || []).concat(b || []).forEach(function (f) {
            if (!f) return;
            var k = f.id || ((f.content || '') + '|' + (f.chatId || ''));
            if (seen[k]) return;
            seen[k] = 1; out.push(f);
        });
        return out;
    }

    function loadData() {
        return idbGet(FAVORITE_STORE, FAVORITE_KEY).catch(function () { return null; }).then(function (idbVal) {
            var list = (idbVal && Array.isArray(idbVal.favorites)) ? idbVal.favorites.slice() : [];
            var local = loadLocalNs();
            if (local) list = favMerge(list, local.favorites);
            if (list.length) {
                var merged = { favorites: list };
                console.log('📦 收藏数据（合并 IDB + 本地）：', list.length, '条');
                idbSet(FAVORITE_STORE, FAVORITE_KEY, merged).catch(function () {});
                try { localStorage.setItem(FAVORITE_KEY, JSON.stringify(merged)); } catch (e) {}
                return merged;
            }
            // 旧版全局收藏只迁移给「第一个打开的用户」，其他 user 从空收藏开始，绝不再共享
            var uid = nanoUid();
            var owner = '';
            try { owner = localStorage.getItem('nano_favorite_legacy_owner') || ''; } catch (e) {}
            if (owner && owner !== uid) return { favorites: [] };
            return idbGet(FAVORITE_STORE, FAVORITE_LEGACY_KEY).catch(function () { return null; }).then(function (legacy) {
                try { localStorage.setItem('nano_favorite_legacy_owner', uid); } catch (e) {}
                if (legacy && Array.isArray(legacy.favorites) && legacy.favorites.length) {
                    idbSet(FAVORITE_STORE, FAVORITE_KEY, legacy).catch(function () {});
                    try { localStorage.setItem(FAVORITE_KEY, JSON.stringify(legacy)); } catch (e) {}
                    return legacy;
                }
                return loadFromLocalStorage();
            });
        }).catch(function (err) {
            console.warn('⚠️ 读取收藏失败，尝试 localStorage:', err);
            return loadFromLocalStorage();
        });
    }

    function loadFromLocalStorage() {
        try {
            var raw = localStorage.getItem(FAVORITE_KEY) || localStorage.getItem(FAVORITE_LEGACY_KEY);
            if (raw) {
                var data = JSON.parse(raw);
                if (!data.favorites) data.favorites = [];
                console.log('📦 从 localStorage 恢复收藏数据，共', data.favorites.length, '条');
                // 异步同步到 IndexedDB
                idbSet(FAVORITE_STORE, FAVORITE_KEY, data).catch(function() {});
                return data;
            }
        } catch(e) {}
        return { favorites: [] };
    }

    function saveData(data) {
        // 先保存到 localStorage（备份）
        try {
            localStorage.setItem(FAVORITE_KEY, JSON.stringify(data));
        } catch(e) {}
        
        // 再保存到 IndexedDB
        return idbSet(FAVORITE_STORE, FAVORITE_KEY, data).then(function() {
            console.log('✅ 收藏数据已保存到 IndexedDB，共', data.favorites.length, '条');
            try {
                window.parent.postMessage({ type: 'favoritesUpdated', data: data }, '*');
            } catch(e) {}
            return data;
        }).catch(function(err) {
            console.warn('⚠️ IndexedDB 保存失败，已保存在 localStorage:', err);
            return data;
        });
    }

    // ============================================================
    // 3. 页面关闭自动保存
    // ============================================================
    function autoSave() {
        if (data) {
            try {
                localStorage.setItem(FAVORITE_KEY, JSON.stringify(data));
            } catch(e) {}
            idbSet(FAVORITE_STORE, FAVORITE_KEY, data).catch(function() {});
        }
    }

    window.addEventListener('beforeunload', autoSave);
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            autoSave();
        }
    });

    // ============================================================
    // 4. 全局变量
    // ============================================================
    var data = null;
    var favExpanded = false;
    var FAV_PAGE = 20;

    // ============================================================
    // 5. DOM 引用
    // ============================================================
    var backBtn = document.getElementById('backBtn');
    var favoritesList = document.getElementById('favoritesList');

    var confirmModal = document.getElementById('confirmModal');
    var confirmTitle = document.getElementById('confirmTitle');
    var confirmBody = document.getElementById('confirmBody');
    var confirmCancel = document.getElementById('confirmCancel');
    var confirmOk = document.getElementById('confirmOk');
    var pendingDeleteId = null;

    var infoModal = document.getElementById('infoModal');
    var infoTitle = document.getElementById('infoTitle');
    var infoBody = document.getElementById('infoBody');
    var infoOk = document.getElementById('infoOk');

    var detailModal = document.getElementById('detailModal');
    var detailSender = document.getElementById('detailSender');
    var detailTime = document.getElementById('detailTime');
    var detailContent = document.getElementById('detailContent');
    var detailClose = document.getElementById('detailClose');

    // ============================================================
    // 6. 工具函数
    // ============================================================
    function getInitial(name) {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    }

    function getAvatarType(senderType) {
        if (senderType === 'user') return 'type-user';
        if (senderType === 'char') return 'type-char';
        if (senderType === 'npc') return 'type-npc';
        return 'type-default';
    }

    function getSenderClass(senderType) {
        if (senderType === 'user') return 'user';
        if (senderType === 'char') return 'char';
        if (senderType === 'npc') return 'npc';
        return '';
    }

    // ============================================================
    // 7. 渲染
    // ============================================================
    function renderFavorites() {
        favoritesList.innerHTML = '';

        if (!data.favorites || data.favorites.length === 0) {
            favoritesList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">♡</span>
                    <div class="empty-text">暂无收藏</div>
                    <div class="empty-hint">在聊天中双击消息，或在线下消息的「⋮」菜单里收藏</div>
                </div>
            `;
            return;
        }

        var sorted = [...data.favorites].reverse();
        var total = sorted.length;
        var shown = favExpanded ? sorted : sorted.slice(0, FAV_PAGE);

        shown.forEach(function(item) {
            var wrapper = document.createElement('div');
            wrapper.className = 'favorite-wrapper';
            wrapper.dataset.id = item.id;

            // 左滑删除按钮
            var actions = document.createElement('div');
            actions.className = 'favorite-actions';
            var delLabel = document.createElement('span');
            delLabel.textContent = '删除';
            actions.appendChild(delLabel);
            wrapper.appendChild(actions);

            // 主内容
            var div = document.createElement('div');
            div.className = 'favorite-item';

            // 头像（带发光特效）
            var avatar = document.createElement('div');
            avatar.className = 'fav-avatar ' + getAvatarType(item.senderType);
            var inner = document.createElement('div');
            inner.className = 'avatar-inner';
            if (item.avatar && item.avatar.trim() !== '') {
                var img = document.createElement('img');
                img.src = item.avatar;
                inner.appendChild(img);
            } else {
                inner.textContent = getInitial(item.sender);
            }
            avatar.appendChild(inner);
            div.appendChild(avatar);

            // 内容区
            var info = document.createElement('div');
            info.className = 'fav-info';

            var content = document.createElement('div');
            content.className = 'fav-content';
            content.textContent = item.content || '（空消息）';
            info.appendChild(content);

            var footer = document.createElement('div');
            footer.className = 'fav-footer';

            var sender = document.createElement('span');
            sender.className = 'fav-sender ' + getSenderClass(item.senderType);
            sender.textContent = item.sender || '未知';
            footer.appendChild(sender);

            var time = document.createElement('span');
            time.className = 'fav-time';
            time.textContent = item.time || '';
            footer.appendChild(time);

            info.appendChild(footer);
            div.appendChild(info);

            wrapper.appendChild(div);
            favoritesList.appendChild(wrapper);

            // ===== 左滑手势 =====
            var startX = 0;
            var currentX = 0;
            var isDragging = false;
            var moved = false;
            var SWIPE_THRESHOLD = 40;

            function onStart(e) {
                var touch = e.touches ? e.touches[0] : e;
                startX = touch.clientX;
                currentX = startX;
                isDragging = true;
                moved = false;
                wrapper.classList.remove('swiped');
            }

            function onMove(e) {
                if (!isDragging) return;
                var touch = e.touches ? e.touches[0] : e;
                currentX = touch.clientX;
                var diff = startX - currentX;
                if (diff > 8) moved = true;
                if (diff > 10) {
                    e.preventDefault();
                    var translate = Math.min(diff, 80);
                    div.style.transform = 'translateX(-' + translate + 'px)';
                }
            }

            function onEnd() {
                if (!isDragging) return;
                isDragging = false;
                var diff = startX - currentX;
                if (diff > SWIPE_THRESHOLD) {
                    wrapper.classList.add('swiped');
                    div.style.transform = '';
                } else {
                    wrapper.classList.remove('swiped');
                    div.style.transform = '';
                }
                startX = 0;
                currentX = 0;
            }

            div.addEventListener('mousedown', onStart);
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);

            div.addEventListener('touchstart', onStart, { passive: true });
            div.addEventListener('touchmove', onMove, { passive: false });
            div.addEventListener('touchend', onEnd, { passive: true });

            // 点击卡片：查看全文（左滑或拖动后不触发）
            div.addEventListener('click', function(e) {
                if (moved) { moved = false; return; }
                if (wrapper.classList.contains('swiped')) {
                    wrapper.classList.remove('swiped');
                    return;
                }
                openDetail(item);
            });

            // 点击删除按钮（左滑后的删除）
            actions.addEventListener('click', function(e) {
                e.stopPropagation();
                pendingDeleteId = item.id;
                confirmTitle.textContent = '删除收藏';
                confirmBody.textContent = '确定要删除这条收藏吗？\n\n"' + (item.content || '') + '"';
                confirmModal.classList.add('show');
            });

            // 清理事件
            wrapper._cleanup = function() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
            };
        });

        // 超过 20 条折叠，点一下展开/收起
        if (total > FAV_PAGE) {
            var toggle = document.createElement('button');
            toggle.className = 'fav-toggle';
            toggle.textContent = favExpanded ? '收起' : ('展开全部（共 ' + total + ' 条）');
            toggle.addEventListener('click', function () {
                favExpanded = !favExpanded;
                renderFavorites();
            });
            favoritesList.appendChild(toggle);
        }
    }

    // ============================================================
    // 7.5 查看收藏全文
    // ============================================================
    function openDetail(item) {
        if (!item) return;
        detailSender.textContent = item.sender || '未知';
        detailTime.textContent = item.time || '';
        detailContent.textContent = item.content || '（空消息）';
        detailModal.classList.add('show');
        try { detailContent.scrollTop = 0; } catch (e) {}
    }
    function closeDetail() {
        detailModal.classList.remove('show');
    }
    if (detailClose) detailClose.addEventListener('click', closeDetail);
    if (detailModal) {
        detailModal.addEventListener('click', function(e) {
            if (e.target === detailModal) closeDetail();
        });
    }

    // ============================================================
    // 8. 删除确认
    // ============================================================
    confirmCancel.addEventListener('click', function() {
        confirmModal.classList.remove('show');
        pendingDeleteId = null;
    });

    confirmOk.addEventListener('click', function() {
        if (pendingDeleteId !== null) {
            var index = data.favorites.findIndex(function(f) { return f.id === pendingDeleteId; });
            if (index > -1) {
                data.favorites.splice(index, 1);
                saveData(data).then(function() {
                    renderFavorites();
                });
            }
            pendingDeleteId = null;
        }
        confirmModal.classList.remove('show');
    });

    confirmModal.addEventListener('click', function(e) {
        if (e.target === confirmModal) {
            confirmModal.classList.remove('show');
            pendingDeleteId = null;
        }
    });

    // ============================================================
    // 9. 返回（返回 more 页面）
    // ============================================================
    backBtn.addEventListener('click', function() {
        autoSave();
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'closeFullscreen', keepPage: true }, '*');
        } else {
            window.history.back();
        }
    });

    // ============================================================
    // 10. 信息弹窗
    // ============================================================
    function showInfo(title, body) {
        infoTitle.textContent = title || '提示';
        infoBody.textContent = body || '';
        infoModal.classList.add('show');
    }

    infoOk.addEventListener('click', function() {
        infoModal.classList.remove('show');
    });
    infoModal.addEventListener('click', function(e) {
        if (e.target === infoModal) infoModal.classList.remove('show');
    });

    // ============================================================
    // 11. 监听外部消息（收藏互通 - 从 chat-core 接收）
    // ============================================================
    window.addEventListener('message', function(event) {
        var msg = event.data;
        if (!msg) return;

        if (msg.type === 'addFavorite') {
            var newFav = {
                id: 'f' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                content: msg.content || '',
                sender: msg.sender || '未知',
                senderType: msg.senderType || 'user',
                time: msg.time || new Date().toLocaleString('zh-CN'),
                chatId: msg.chatId || '',
                avatar: msg.avatar || ''
            };
            // 避免重复收藏（同一 chatId 下相同内容）
            var exists = data.favorites.some(function(f) {
                return f.content === newFav.content && f.chatId === newFav.chatId;
            });
            if (!exists) {
                data.favorites.push(newFav);
                saveData(data).then(function() {
                    renderFavorites();
                    showInfo('收藏成功', '已收藏该消息');
                });
            } else {
                showInfo('提示', '该消息已收藏');
            }
        }

        if (msg.type === 'refreshFavorites') {
            loadData().then(function(loadedData) {
                data = loadedData;
                renderFavorites();
            });
        }
    });

    // ============================================================
    // 12. 初始化
    // ============================================================
    loadData().then(function(loadedData) {
        data = loadedData;
        renderFavorites();
        console.log('[Favorite] 页面已加载，收藏数:', data.favorites.length);
    }).catch(function(err) {
        console.error('[Favorite] 加载失败:', err);
        data = { favorites: [] };
        renderFavorites();
    });

    // 页面卸载时清理事件
    window.addEventListener('beforeunload', function() {
        document.querySelectorAll('.favorite-wrapper').forEach(function(w) {
            if (w._cleanup) w._cleanup();
        });
    });

    // 隐藏底部导航
    try {
        window.parent.postMessage({ type: 'hideBottomNav' }, '*');
    } catch(e) {}

    // 暴露 API
    window.__favorite = {
        data: function() { return data; },
        render: renderFavorites,
        save: saveData,
        reload: function() {
            loadData().then(function(loadedData) {
                data = loadedData;
                renderFavorites();
            });
        }
    };
})();