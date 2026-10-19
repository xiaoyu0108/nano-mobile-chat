// ============================================================
// 表情包功能（点击表情按钮弹出底部表情面板）
// 从 IndexedDB 读取 emoji 数据
// ============================================================
(function() {
    'use strict';

    const DB_NAME = 'nano_api_db';
    const DB_VERSION = 2;
    const EMOJI_STORE = 'emoji_data';
    const EMOJI_KEY = 'nano_emoji_data';
    const EMOJI_LEGACY_KEY = 'peach_home_data'; // 旧键，仅兼容读取

    let currentData = null;
    let currentGroupId = null;
    let isPanelOpen = false;

    // ============================================================
    // 1. IndexedDB 操作
    // ============================================================
    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                var request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(EMOJI_STORE)) {
                        db.createObjectStore(EMOJI_STORE, { keyPath: 'key' });
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
    // 2. 加载表情数据
    // ============================================================
    function readLocalEmoji() {
        try {
            var localData = localStorage.getItem(EMOJI_KEY) || localStorage.getItem(EMOJI_LEGACY_KEY);
            if (localData) {
                var parsed = JSON.parse(localData);
                if (parsed && parsed.emojiGroups && parsed.emojiGroups.length > 0) return parsed;
            }
        } catch(e) {}
        return null;
    }

    function loadEmojiData() {
        return idbGet(EMOJI_STORE, EMOJI_KEY).then(function(data) {
            if (data && data.emojiGroups && data.emojiGroups.length > 0) {
                return data;
            }
            // 兼容旧键
            return idbGet(EMOJI_STORE, EMOJI_LEGACY_KEY).then(function(legacy) {
                if (legacy && legacy.emojiGroups && legacy.emojiGroups.length > 0) return legacy;
                return readLocalEmoji();
            });
        }).catch(function() {
            return readLocalEmoji();
        });
    }

    // ============================================================
    // 3. DOM 引用
    // ============================================================
    var overlay = document.getElementById('emojiSheetOverlay');
    var sheet = document.getElementById('emojiSheet');
    var tabBar = document.getElementById('emojiTabBar');
    var grid = document.getElementById('emojiGrid');
    var closeBtn = document.getElementById('emojiSheetClose');

    var insertCallback = null; // 插入表情的回调

    // ============================================================
    // 4. 渲染分组标签
    // ============================================================
    function renderTabs(groups) {
        tabBar.innerHTML = '';
        if (!groups || groups.length === 0) {
            tabBar.innerHTML = '<span style="color:#8e8e93;font-size:13px;padding:4px 0;">暂无表情包分组</span>';
            return;
        }
        groups.forEach(function(g, index) {
            var btn = document.createElement('button');
            btn.className = 'emoji-tab-btn' + (index === 0 ? ' active' : '');
            btn.textContent = g.name || '未命名';
            btn.dataset.groupId = g.id;
            btn.addEventListener('click', function() {
                switchTab(g.id);
            });
            tabBar.appendChild(btn);
        });
    }

    // ============================================================
    // 5. 切换分组
    // ============================================================
    function switchTab(groupId) {
        currentGroupId = groupId;
        // 更新标签高亮
        var tabs = tabBar.querySelectorAll('.emoji-tab-btn');
        tabs.forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.groupId === groupId);
        });
        // 渲染对应分组的表情
        var group = currentData.emojiGroups.find(function(g) { return g.id === groupId; });
        if (group) {
            renderEmojis(group.emojis);
        } else {
            renderEmojis([]);
        }
    }

    // ============================================================
    // 6. 渲染表情网格
    // ============================================================
    function renderEmojis(emojis) {
        grid.innerHTML = '';
        if (!emojis || emojis.length === 0) {
            grid.innerHTML = '<div class="emoji-empty">这个分组还没有表情包</div>';
            return;
        }
        emojis.forEach(function(e) {
            var item = document.createElement('div');
            item.className = 'emoji-item';
            
            var img = document.createElement('img');
            img.src = e.url;
            img.alt = e.name || '';
            img.loading = 'lazy';
            item.appendChild(img);
            
            if (e.name) {
                var label = document.createElement('div');
                label.className = 'emoji-item-name';
                label.textContent = e.name;
                item.appendChild(label);
            }
            
            item.addEventListener('click', function() {
                insertEmoji(e);
            });
            
            grid.appendChild(item);
        });
    }

    // ============================================================
    // 7. 插入表情到输入框
    // ============================================================
    function insertEmoji(emoji) {
        if (insertCallback) {
            insertCallback(emoji.url, emoji.name);
        }
        // 插入后关闭面板（或保持打开，取决于用户体验）
        // closePanel();
    }

    // ============================================================
    // 8. 打开/关闭面板
    // ============================================================
    function openPanel(callback) {
        if (isPanelOpen) {
            closePanel();
            return;
        }
        
        insertCallback = callback || null;
        
        loadEmojiData().then(function(data) {
            if (!data || !data.emojiGroups || data.emojiGroups.length === 0) {
                grid.innerHTML = '<div class="emoji-empty">暂无表情包，请先在「更多 → 表情包」中添加</div>';
                tabBar.innerHTML = '';
                overlay.classList.add('active');
                isPanelOpen = true;
                return;
            }
            
            currentData = data;
            renderTabs(data.emojiGroups);
            
            // 默认选中第一个分组
            var firstGroup = data.emojiGroups[0];
            currentGroupId = firstGroup.id;
            renderEmojis(firstGroup.emojis);
            
            overlay.classList.add('active');
            isPanelOpen = true;
        }).catch(function(err) {
            console.warn('[表情面板] 加载数据失败:', err);
            grid.innerHTML = '<div class="emoji-empty">加载失败，请稍后重试</div>';
            overlay.classList.add('active');
            isPanelOpen = true;
        });
    }

    function closePanel() {
        overlay.classList.remove('active');
        isPanelOpen = false;
        insertCallback = null;
    }

    // ============================================================
    // 9. 事件绑定
    // ============================================================
    if (closeBtn) {
        closeBtn.addEventListener('click', closePanel);
    }
    if (overlay) {
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closePanel();
            }
        });
    }

    // ============================================================
    // 10. 暴露全局 API
    // ============================================================
    window.__emojiPanel = {
        open: openPanel,
        close: closePanel,
        isOpen: function() { return isPanelOpen; },
        insert: insertEmoji
    };

    console.log('[表情面板] 模块已加载');
})();