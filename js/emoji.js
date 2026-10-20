/* ===== emoji.js - 表情包页面逻辑（IndexedDB 存储 + 降级） ===== */
(function() {
    'use strict';

    const DB_NAME = 'nano_api_db';
    const DB_VERSION = 2;
    const EMOJI_STORE = 'emoji_data';
    const API_STORE = 'api_data';
    const EMOJI_KEY = 'nano_emoji_data';
    const EMOJI_LEGACY_KEY = 'peach_home_data'; // 仅用于一次性迁移旧数据

    // ===== DOCX 解析库按需加载（本地优先，失败回退 CDN）→ 不影响页面加载速度 =====
    const MAMMOTH_SOURCES = [
        (window.NANO_ROOT || '') + 'js/mammoth.browser.min.js',
        'https://cdn.bootcdn.net/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
    ];
    let _mammothPromise = null;

    function ensureMammoth() {
        if (typeof mammoth !== 'undefined' && mammoth && mammoth.extractRawText) {
            return Promise.resolve(mammoth);
        }
        if (_mammothPromise) return _mammothPromise;
        _mammothPromise = new Promise(function(resolve, reject) {
            let idx = 0;
            (function tryNext() {
                if (idx >= MAMMOTH_SOURCES.length) {
                    _mammothPromise = null;
                    reject(new Error('DOCX 解析库加载失败'));
                    return;
                }
                const src = MAMMOTH_SOURCES[idx++];
                const s = document.createElement('script');
                s.src = src;
                let done = false;
                const timer = setTimeout(function() {
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
                        console.log('✅ 创建 emoji_data store');
                    }
                    if (!db.objectStoreNames.contains(API_STORE)) {
                        db.createObjectStore(API_STORE, { keyPath: 'key' });
                        console.log('✅ 创建 api_data store');
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
    // 2. 数据存取（IndexedDB + localStorage 双写）
    // ============================================================
    function normalizeEmojiData(d) {
        if (!d) return d;
        if (!d.emojiGroups) d.emojiGroups = [];
        if (!d.balance) d.balance = 0;
        if (!d.favorites) d.favorites = [];
        return d;
    }

    // 只缓存“名称 / 最近添加时间”，不含 base64 图片，避免 localStorage 被撑爆。
    // 聊天页构建提示词时同步读取这份缓存，角色才能知道用户用照片添加了哪些表情包。
    function saveEmojiNameCache(d) {
        try {
            var names = [];
            var groups = (d && d.emojiGroups) || [];
            groups.forEach(function (g) {
                (g.emojis || []).forEach(function (e) {
                    if (!e || !e.name) return;
                    names.push({ name: String(e.name), at: Number(e.addedAt) || 0, id: String(e.id || "") });
                });
            });
            names.sort(function (a, b) { return (b.at - a.at) || String(b.id).localeCompare(String(a.id)); });
            var seen = {};
            var out = [];
            names.forEach(function (x) {
                if (seen[x.name]) return;
                seen[x.name] = 1;
                out.push(x.name);
            });
            localStorage.setItem("nano_emoji_names", JSON.stringify(out));
        } catch (e) {}
    }

    function saveData(data) {
        // 先保存到 localStorage（备份）
        try {
            localStorage.setItem(EMOJI_KEY, JSON.stringify(data));
            if (localStorage.getItem(EMOJI_LEGACY_KEY) !== null) localStorage.removeItem(EMOJI_LEGACY_KEY);
        } catch(e) {}
        saveEmojiNameCache(data);
        
        // 再保存到 IndexedDB
        return idbSet(EMOJI_STORE, EMOJI_KEY, data)
            .then(function() {
                console.log('✅ 表情包数据已保存到 IndexedDB');
                try {
                    window.parent.postMessage({ type: 'homeDataUpdated', data: data }, '*');
                } catch(e) {}
                // 通知聊天页清掉表情包缓存：否则刚加（尤其"上传图片"添加）的表情包，
                // 角色在下次刷新前都看不到，也就不会用它们发给你。
                try { window.parent.postMessage({ type: 'nanoEmojiUpdated' }, '*'); } catch(e) {}
                try { window.dispatchEvent(new Event('nanoEmojiUpdated')); } catch(e) {}
                return data;
            })
            .catch(function(err) {
                console.warn('⚠️ IndexedDB 保存失败，已保存在 localStorage:', err);
                return data;
            });
    }

    function loadData() {
        return idbGet(EMOJI_STORE, EMOJI_KEY)
            .then(function(data) {
                if (data) return normalizeEmojiData(data);
                // 迁移旧键数据到 nano 键
                return idbGet(EMOJI_STORE, EMOJI_LEGACY_KEY).then(function(legacy) {
                    if (legacy) {
                        normalizeEmojiData(legacy);
                        idbSet(EMOJI_STORE, EMOJI_KEY, legacy).catch(function() {});
                        return legacy;
                    }
                    return loadFromLocalStorage();
                });
            })
            .catch(function(err) {
                console.warn('⚠️ IndexedDB 读取失败，尝试 localStorage:', err);
                return loadFromLocalStorage();
            });
    }

    function loadFromLocalStorage() {
        try {
            var localData = localStorage.getItem(EMOJI_KEY) || localStorage.getItem(EMOJI_LEGACY_KEY);
            if (localData) {
                var parsed = JSON.parse(localData);
                console.log('📦 从 localStorage 恢复数据');
                normalizeEmojiData(parsed);
                idbSet(EMOJI_STORE, EMOJI_KEY, parsed).catch(function() {});
                try { localStorage.setItem(EMOJI_KEY, JSON.stringify(parsed)); } catch(e) {}
                return parsed;
            }
        } catch(e) {
            console.warn('localStorage 读取失败:', e);
        }
        return { emojiGroups: [], balance: 0, favorites: [] };
    }

    // ============================================================
    // 3. 页面关闭/隐藏时自动保存
    // ============================================================
    function autoSave() {
        if (data) {
            try {
                localStorage.setItem(EMOJI_KEY, JSON.stringify(data));
                if (localStorage.getItem(EMOJI_LEGACY_KEY) !== null) localStorage.removeItem(EMOJI_LEGACY_KEY);
            } catch(e) {}
            saveEmojiNameCache(data);
            idbSet(EMOJI_STORE, EMOJI_KEY, data).catch(function() {});
        }
    }

    // ============================================================
    // 4. API 配置读取（优先副 API，没配置则用主 API）
    // ============================================================
    function getActiveApiConfig() {
        return idbGet(API_STORE, 'nano_api_config').then(function(config) {
            if (!config) {
                console.warn('⚠️ [AI识别] 未找到 API 配置');
                return null;
            }
            
            console.log('📡 [AI识别] 读取到配置:', config);
            
            // 优先使用副 API
            if (config.subToggle !== false && config.subUrl && config.subKey) {
                console.log('📡 [AI识别] 使用副 API');
                return {
                    label: '副 API',
                    url: config.subUrl,
                    key: config.subKey,
                    model: config.subModel || 'gpt-3.5-turbo'
                };
            }
            
            // 其次使用主 API
            if (config.mainUrl && config.mainKey) {
                console.log('📡 [AI识别] 使用主 API');
                return {
                    label: '主 API',
                    url: config.mainUrl,
                    key: config.mainKey,
                    model: config.mainModel || 'gpt-3.5-turbo'
                };
            }
            
            if (config.url && config.key) {
                return {
                    label: 'API',
                    url: config.url,
                    key: config.key,
                    model: config.model || 'gpt-3.5-turbo'
                };
            }
            
            console.warn('⚠️ [AI识别] API 配置不完整');
            return null;
        }).catch(function(err) {
            console.error('❌ [AI识别] 读取失败:', err);
            return null;
        });
    }

    // ============================================================
    // 5. 全局变量
    // ============================================================
    let data = null;
    let currentGroupId = null;
    let isEditMode = false;
    let selectedIds = new Set();
    let pendingFileContent = '';
    let parsedBatchEmojis = [];
    let renameCallback = null;

    // ============================================================
    // 6. DOM 引用
    // ============================================================
    var backBtn = document.getElementById('backBtn');
    var pageTitle = document.getElementById('pageTitle');
    var actionContainer = document.getElementById('actionContainer');
    var homeView = document.getElementById('homeView');
    var detailView = document.getElementById('detailView');
    var editActionsBar = document.getElementById('editActionsBar');
    var groupScroll = document.getElementById('groupScroll');
    var detailGrid = document.getElementById('detailGrid');

    var addModal = document.getElementById('addModal');
    var addModalCancel = document.getElementById('addModalCancel');
    var addModalConfirm = document.getElementById('addModalConfirm');
    var targetGroupSelect = document.getElementById('targetGroupSelect');
    var newGroupName = document.getElementById('newGroupName');
    var fileImportBtn = document.getElementById('fileImportBtn');
    var fileImportIcon = document.getElementById('fileImportIcon');
    var fileAiBtn = document.getElementById('fileAiBtn');
    var fileInput = document.getElementById('fileInput');
    var fileStatus = document.getElementById('fileStatus');
    var batchInput = document.getElementById('batchInput');
    var batchRecognizeBtn = document.getElementById('batchRecognizeBtn');
    var batchResult = document.getElementById('batchResult');
    var singleUploadBtn = document.getElementById('singleUploadBtn');
    var imageFileInput = document.getElementById('imageFileInput');
    var singleUrlInput = document.getElementById('singleUrlInput');
    var singleNameInput = document.getElementById('singleNameInput');
    var singleAddBtn = document.getElementById('singleAddBtn');
    var singlePreview = document.getElementById('singlePreview');
    var singlePreviewImg = document.getElementById('singlePreviewImg');
    var singlePreviewName = document.getElementById('singlePreviewName');
    var singlePreviewRemove = document.getElementById('singlePreviewRemove');

    var moveModal = document.getElementById('moveModal');
    var moveTargetSelect = document.getElementById('moveTargetSelect');
    var moveNewGroupWrap = document.getElementById('moveNewGroupWrap');
    var moveNewGroupName = document.getElementById('moveNewGroupName');
    var moveCancel = document.getElementById('moveCancel');
    var moveConfirm = document.getElementById('moveConfirm');

    var renameModal = document.getElementById('renameModal');
    var renameInput = document.getElementById('renameInput');
    var renameCancel = document.getElementById('renameCancel');
    var renameConfirm = document.getElementById('renameConfirm');

    var editEmojiModal = document.getElementById('editEmojiModal');
    var editEmojiInput = document.getElementById('editEmojiInput');
    var editEmojiCancel = document.getElementById('editEmojiCancel');
    var editEmojiConfirm = document.getElementById('editEmojiConfirm');

    var infoModal = document.getElementById('infoModal');
    var infoTitle = document.getElementById('infoTitle');
    var infoBody = document.getElementById('infoBody');
    var infoOk = document.getElementById('infoOk');

    // ============================================================
    // 7. Toast 轻提示
    // ============================================================
    function showToast(msg, duration) {
        duration = duration || 1500;
        var existing = document.querySelector('.custom-toast-emoji');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'custom-toast-emoji';
        toast.textContent = msg;
        toast.style.cssText = 
            'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);' +
            'background:rgba(0,0,0,0.75);color:#fff;padding:10px 24px;border-radius:12px;' +
            'font-size:14px;font-weight:500;backdrop-filter:blur(10px);' +
            '-webkit-backdrop-filter:blur(10px);z-index:9999;max-width:80%;' +
            'text-align:center;opacity:0;transition:opacity 0.3s ease;';
        document.body.appendChild(toast);

        setTimeout(function() { toast.style.opacity = '1'; }, 10);
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
        }, duration);
    }

    // ============================================================
    // 8. iOS 风格弹窗
    // ============================================================
    var infoActionsEl = document.getElementById('infoActions');
    var confirmActionsEl = document.getElementById('confirmActions');
    var confirmCancelBtn = document.getElementById('confirmCancelBtn');
    var confirmOkBtn = document.getElementById('confirmOkBtn');
    var _confirmCb = null;

    function closeInfoModal() {
        infoModal.classList.remove('show');
        _confirmCb = null;
    }

    function showInfo(title, body) {
        infoTitle.textContent = title || '提示';
        infoBody.textContent = body || '';
        if (infoActionsEl) infoActionsEl.style.display = 'flex';
        if (confirmActionsEl) confirmActionsEl.style.display = 'none';
        _confirmCb = null;
        infoModal.classList.add('show');
    }

    // opts: { okText, cancelText, danger }
    function showConfirm(title, message, onConfirm, opts) {
        opts = opts || {};
        infoTitle.textContent = title || '提示';
        infoBody.textContent = message || '';
        if (confirmOkBtn) {
            confirmOkBtn.textContent = opts.okText || '确定';
            confirmOkBtn.className = 'form-btn' + (opts.danger === false ? '' : ' danger');
        }
        if (confirmCancelBtn) confirmCancelBtn.textContent = opts.cancelText || '取消';
        if (infoActionsEl) infoActionsEl.style.display = 'none';
        if (confirmActionsEl) confirmActionsEl.style.display = 'flex';
        _confirmCb = onConfirm || null;
        infoModal.classList.add('show');
    }

    if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', function() {
        var cb = _confirmCb; closeInfoModal();
        if (cb) cb(false);
    });
    if (confirmOkBtn) confirmOkBtn.addEventListener('click', function() {
        var cb = _confirmCb; closeInfoModal();
        if (cb) cb(true);
    });
    infoOk.addEventListener('click', closeInfoModal);
    infoModal.addEventListener('click', function(e) {
        if (e.target === infoModal) closeInfoModal();
    });

    // ============================================================
    // 9. 渲染主页
    // ============================================================
    function renderHome() {
        groupScroll.innerHTML = '';
        var groups = data.emojiGroups;
        if (groups.length === 0) {
            groupScroll.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">◇</span>
                    <div class="empty-text">暂无表情包分组</div>
                </div>
            `;
            return;
        }
        groups.forEach(function(g) {
            var card = document.createElement('div');
            card.className = 'group-card';
            var name = document.createElement('div');
            name.className = 'g-name';
            name.textContent = g.name || '未命名';
            card.appendChild(name);

            var previews = document.createElement('div');
            previews.className = 'g-previews';
            var recent = g.emojis.slice(-3);
            for (var i = 0; i < 3; i++) {
                var item = document.createElement('div');
                item.className = 'preview-item';
                if (recent[i]) {
                    var img = document.createElement('img');
                    img.src = recent[i].url;
                    img.alt = recent[i].name || '';
                    item.appendChild(img);
                } else {
                    item.textContent = '·';
                }
                previews.appendChild(item);
            }
            card.appendChild(previews);
            var count = document.createElement('div');
            count.className = 'g-count';
            count.textContent = g.emojis.length + ' 个';
            card.appendChild(count);
            card.addEventListener('click', function() { openDetail(g.id); });
            groupScroll.appendChild(card);
        });
    }

    // ============================================================
    // 10. 详情页
    // ============================================================
    function openDetail(groupId) {
        currentGroupId = groupId;
        var group = data.emojiGroups.find(function(g) { return g.id === groupId; });
        if (!group) return;
        pageTitle.textContent = group.name || '分组';
        isEditMode = false;
        selectedIds.clear();
        homeView.style.display = 'none';
        detailView.style.display = 'block';
        renderDetail(group);
        renderActionButtons(false);
    }

    function renderDetail(group) {
        detailGrid.innerHTML = '';
        group.emojis.forEach(function(e) {
            var div = document.createElement('div');
            div.className = 'detail-item';
            if (selectedIds.has(e.id)) div.classList.add('selected');

            // 图片卡片（方形包裹器）
            var imgWrap = document.createElement('div');
            imgWrap.className = 'di-img';
            var img = document.createElement('img');
            img.src = e.url;
            img.alt = e.name || '';
            imgWrap.appendChild(img);

            var check = document.createElement('div');
            check.className = 'check-mark';
            check.textContent = '✓';
            imgWrap.appendChild(check);
            div.appendChild(imgWrap);

            // 含义标注：放在卡片下方，始终显示，点击可修改
            var label = document.createElement('div');
            label.className = 'd-label';
            label.textContent = e.name || '未命名';
            label.title = '点击修改含义';
            label.addEventListener('click', function(ev) {
                ev.stopPropagation();
                openEditEmojiModal(group.id, e.id);
            });
            div.appendChild(label);

            if (isEditMode) {
                div.addEventListener('click', function() {
                    if (selectedIds.has(e.id)) {
                        selectedIds.delete(e.id);
                        div.classList.remove('selected');
                    } else {
                        selectedIds.add(e.id);
                        div.classList.add('selected');
                    }
                });
            }
            detailGrid.appendChild(div);
        });

        var addDiv = document.createElement('div');
        addDiv.className = 'detail-item add-item';
        addDiv.textContent = '+';
        addDiv.addEventListener('click', function() {
            openAddModal(group.id);
        });
        detailGrid.appendChild(addDiv);

        if (isEditMode) {
            var deleteDiv = document.createElement('div');
            deleteDiv.className = 'detail-item add-item';
            deleteDiv.textContent = '−';
            deleteDiv.style.color = '#ff3b30';
            deleteDiv.style.borderColor = 'rgba(255,59,48,0.2)';
            deleteDiv.addEventListener('click', function() {
                if (selectedIds.size === 0) {
                    showToast('请先选择要删除的表情包');
                    return;
                }
                showConfirm('删除确认', '确定删除选中的 ' + selectedIds.size + ' 个表情包吗？', function(confirmed) {
                    if (confirmed) {
                        group.emojis = group.emojis.filter(function(e) { return !selectedIds.has(e.id); });
                        selectedIds.clear();
                        saveData(data).then(function() {
                            renderDetail(group);
                            renderHome();
                            showToast('已删除');
                        });
                    }
                });
            });
            detailGrid.appendChild(deleteDiv);
        }
    }

    // ============================================================
    // 11. 顶栏按钮渲染
    // ============================================================
    function renderActionButtons(editMode) {
        actionContainer.innerHTML = '';
        editActionsBar.innerHTML = '';

        if (!editMode) {
            editActionsBar.classList.remove('show');
            var exportBtn = document.createElement('button');
            exportBtn.className = 'nav-action';
            exportBtn.title = '导出该分组';
            exportBtn.setAttribute('aria-label', '导出该分组');
            exportBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:block;margin:0 auto;"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></svg>';
            exportBtn.addEventListener('click', function() {
                var group = data.emojiGroups.find(function(g) { return g.id === currentGroupId; });
                exportGroupEmojis(group);
            });
            actionContainer.appendChild(exportBtn);

            var editBtn = document.createElement('button');
            editBtn.className = 'nav-action';
            editBtn.textContent = '编辑';
            editBtn.addEventListener('click', function() {
                isEditMode = true;
                selectedIds.clear();
                var group = data.emojiGroups.find(function(g) { return g.id === currentGroupId; });
                if (group) {
                    renderDetail(group);
                    renderActionButtons(true);
                }
            });
            actionContainer.appendChild(editBtn);
        } else {
            var doneBtn = document.createElement('button');
            doneBtn.className = 'nav-action';
            doneBtn.textContent = '完成';
            doneBtn.addEventListener('click', function() {
                isEditMode = false;
                selectedIds.clear();
                var group = data.emojiGroups.find(function(g) { return g.id === currentGroupId; });
                if (group) {
                    renderDetail(group);
                    renderActionButtons(false);
                }
            });
            actionContainer.appendChild(doneBtn);

            var renameBtn = document.createElement('button');
            renameBtn.className = 'nav-action';
            renameBtn.textContent = '重命名';
            renameBtn.addEventListener('click', function() {
                var group = data.emojiGroups.find(function(g) { return g.id === currentGroupId; });
                if (group) openRenameModal(group.id);
            });
            editActionsBar.appendChild(renameBtn);

            var moveBtn = document.createElement('button');
            moveBtn.className = 'nav-action';
            moveBtn.textContent = '移动';
            moveBtn.addEventListener('click', function() {
                if (selectedIds.size === 0) {
                    showToast('请先选择要移动的表情包');
                    return;
                }
                openMoveModal();
            });
            editActionsBar.appendChild(moveBtn);

            var deleteGroupBtn = document.createElement('button');
            deleteGroupBtn.className = 'nav-action danger';
            deleteGroupBtn.textContent = '删除分组';
            deleteGroupBtn.addEventListener('click', function() {
                var group = data.emojiGroups.find(function(g) { return g.id === currentGroupId; });
                if (!group) return;
                showConfirm('删除分组', '确定要删除分组 "' + group.name + '" 及其所有表情包吗？', function(confirmed) {
                    if (confirmed) {
                        var idx = data.emojiGroups.findIndex(function(g) { return g.id === currentGroupId; });
                        if (idx > -1) {
                            data.emojiGroups.splice(idx, 1);
                            saveData(data).then(function() {
                                closeDetail();
                                renderHome();
                                showToast('分组已删除');
                            });
                        }
                    }
                });
            });
            editActionsBar.appendChild(deleteGroupBtn);

            editActionsBar.classList.add('show');
        }
    }

    function closeDetail() {
        pageTitle.textContent = '表情包';
        homeView.style.display = 'block';
        detailView.style.display = 'none';
        currentGroupId = null;
        isEditMode = false;
        selectedIds.clear();
        editActionsBar.classList.remove('show');
        editActionsBar.innerHTML = '';
        renderHome();
        actionContainer.innerHTML = '';
        var addBtn = document.createElement('button');
        addBtn.className = 'nav-action';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function() {
            openAddModal(null);
        });
        actionContainer.appendChild(addBtn);
    }

    // ============================================================
    // 12. 返回
    // ============================================================
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            if (detailView.style.display !== 'none') {
                closeDetail();
            } else {
                autoSave();
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'closeFullscreen', keepPage: true }, '*');
                } else {
                    window.history.back();
                }
            }
        });
    }

    // ============================================================
    // 13. 新增弹窗
    // ============================================================
    function openAddModal(groupId) {
        targetGroupSelect.innerHTML = '';
        data.emojiGroups.forEach(function(g) {
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name || '未命名';
            if (g.id === groupId || (groupId === null && data.emojiGroups[0] && data.emojiGroups[0].id)) {
                opt.selected = true;
            }
            targetGroupSelect.appendChild(opt);
        });
        newGroupName.value = '';
        batchInput.value = '';
        batchResult.textContent = '';
        batchResult.className = 'batch-result';
        fileStatus.textContent = '';
        singleUrlInput.value = '';
        singleNameInput.value = '';
        singlePreview.style.display = 'none';
        pendingFileContent = '';
        parsedBatchEmojis = [];
        addModal.classList.add('show');
    }

    function closeAddModal() {
        addModal.classList.remove('show');
    }

    addModalCancel.addEventListener('click', closeAddModal);
    addModalConfirm.addEventListener('click', function() {
        var allEmojis = [];
        var targetId = targetGroupSelect.value;

        var newName = newGroupName.value.trim();
        if (newName) {
            var newGroup = { id: 'g' + Date.now(), name: newName, emojis: [] };
            data.emojiGroups.push(newGroup);
            targetId = newGroup.id;
            saveData(data).then(function() {
                renderHome();
            });
        }

        if (parsedBatchEmojis.length > 0) {
            allEmojis = allEmojis.concat(parsedBatchEmojis);
            parsedBatchEmojis = [];
        }

        var singleUrl = singleUrlInput.value.trim();
        if (singleUrl) {
            var singleName = singleNameInput.value.trim() || '未命名';
            allEmojis.push({ name: singleName, url: singleUrl });
            singleUrlInput.value = '';
            singleNameInput.value = '';
            singlePreview.style.display = 'none';
        }

        if (allEmojis.length === 0) {
            showToast('没有可添加的表情包');
            return;
        }

        var group = data.emojiGroups.find(function(g) { return g.id === targetId; });
        if (group) {
            allEmojis.forEach(function(e) {
                // 同名表情会让角色无法用 [emoji:名称] 精确指定，自动补 2/3/4…
                var base = String(e.name || '表情').trim() || '表情';
                var nm = base, n = 2;
                while ((group.emojis || []).some(function(x) { return x && x.name === nm; })) { nm = base + n; n++; }
                group.emojis.push({ id: 'e' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), name: nm, url: e.url, addedAt: Date.now() });
            });
            saveData(data).then(function() {
                renderHome();
                if (currentGroupId && currentGroupId === targetId) {
                    var g = data.emojiGroups.find(function(grp) { return grp.id === currentGroupId; });
                    if (g) renderDetail(g);
                }
                showToast('已添加 ' + allEmojis.length + ' 个表情包');
                closeAddModal();
            });
        }
    });

    // ============================================================
    // 14. 文件导入
    // ============================================================
    if (fileImportBtn) {
        fileImportBtn.addEventListener('click', function() { fileInput.click(); });
    }
    if (fileImportIcon) {
        fileImportIcon.addEventListener('click', function() { fileInput.click(); });
    }

    // ============================================================
    // 14.5 导出表情包（在分组详情页顶栏点图标导出当前分组）
    //      统一格式：描述: 图片链接，可再次导入 / 交给 AI 识别。
    //      iOS 优先用系统分享，避免卡在“存储到文件”页面出不来。
    // ============================================================
    function emojiExportIsIOS() {
        try {
            return /iP(hone|ad|od)/.test(navigator.platform || '') ||
                ((navigator.userAgent || '').indexOf('Mac') >= 0 && 'ontouchend' in document);
        } catch (e) { return false; }
    }
    function emojiExportFallback(text, filename) {
        try {
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;';
            var card = document.createElement('div');
            card.style.cssText = 'width:100%;max-width:460px;background:#fff;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;';
            card.innerHTML = '<div style="font-size:14px;font-weight:600;color:#222;">' + filename + '（长按全选复制）</div>';
            var ta = document.createElement('textarea');
            ta.style.cssText = 'width:100%;height:240px;font-size:12px;border:1px solid #eee;border-radius:10px;padding:8px;';
            ta.value = text;
            var close = document.createElement('button');
            close.textContent = '关闭';
            close.style.cssText = 'height:40px;border:0;border-radius:10px;background:#1f1f1f;color:#fff;font-size:14px;';
            close.onclick = function () { ov.remove(); };
            card.appendChild(ta); card.appendChild(close); ov.appendChild(card);
            document.body.appendChild(ov);
            ta.focus(); ta.select();
        } catch (e) { showToast('导出失败'); }
    }
    function emojiExportSaveText(text, filename) {
        if (emojiExportIsIOS()) {
            try {
                if (navigator.canShare && navigator.share) {
                    var f = new File([text], filename, { type: 'text/plain' });
                    if (navigator.canShare({ files: [f] })) {
                        navigator.share({ files: [f], title: filename }).then(function () { showToast('已导出'); }).catch(function () { showToast('已取消导出'); });
                        return;
                    }
                }
            } catch (e) {}
            try {
                navigator.clipboard.writeText(text).then(function () { showToast('已复制到剪贴板，可粘贴保存'); }).catch(function () { emojiExportFallback(text, filename); });
                return;
            } catch (e) {}
            emojiExportFallback(text, filename);
            return;
        }
        try {
            var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a); a.click();
            setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1500);
            showToast('已导出到「下载」目录');
        } catch (e) {
            try { navigator.clipboard.writeText(text); showToast('已复制到剪贴板'); } catch (e2) { emojiExportFallback(text, filename); }
        }
    }
    // 导出某个分组（顶部图标调用）
    function exportGroupEmojis(group) {
        try {
            if (!group) { showToast('找不到分组'); return; }
            var lines = [];
            (group.emojis || []).forEach(function (e) { if (e && e.url) lines.push((e.name || '表情') + ': ' + e.url); });
            if (!lines.length) { showToast('这个分组里还没有可导出的表情包'); return; }
            var safe = String(group.name || '分组').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
            emojiExportSaveText(lines.join('\n'), 'emojis-' + safe + '.txt');
        } catch (e) { showToast('导出失败'); }
    }

    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            var file = this.files[0];
            if (!file) return;
            var lower = (file.name || '').toLowerCase();
            var isDoc = lower.indexOf('.docx') !== -1 || lower.indexOf('.doc') !== -1;

            function onLoaded(content) {
                pendingFileContent = content || '';
                fileStatus.textContent = '已加载: ' + file.name + '，点击「AI 识别」解析';
                fileStatus.style.color = '#34c759';
                fileInput.value = '';
            }

            // ===== DOC / DOCX：按需加载 mammoth 提取纯文本（不影响页面加载速度） =====
            if (isDoc) {
                ensureMammoth().then(function(mammoth) {
                    var reader = new FileReader();
                    reader.onload = function(ev) {
                        mammoth.extractRawText({ arrayBuffer: ev.target.result })
                            .then(function(result) {
                                var text = result.value || '';
                                if (!text || text.trim() === '') {
                                    pendingFileContent = '';
                                    fileStatus.textContent = '未能从 DOCX 中提取到文本内容';
                                    fileStatus.style.color = '#ff3b30';
                                    fileInput.value = '';
                                    return;
                                }
                                onLoaded(text);
                            })
                            .catch(function(err) {
                                pendingFileContent = '';
                                fileStatus.textContent = '解析 DOCX 失败: ' + (err.message || '未知错误');
                                fileStatus.style.color = '#ff3b30';
                                fileInput.value = '';
                            });
                    };
                    reader.onerror = function() {
                        pendingFileContent = '';
                        fileStatus.textContent = '读取文件失败';
                        fileStatus.style.color = '#ff3b30';
                        fileInput.value = '';
                    };
                    reader.readAsArrayBuffer(file);
                }).catch(function() {
                    pendingFileContent = '';
                    fileStatus.textContent = 'DOCX 解析库加载失败，请检查网络后重试';
                    fileStatus.style.color = '#ff3b30';
                    fileInput.value = '';
                });
                return;
            }

            // ===== TXT / JSON =====
            var reader = new FileReader();
            reader.onload = function(ev) {
                var content = ev.target.result;
                onLoaded(content);
            };
            reader.readAsText(file);
        });
    }

    // ============================================================
    // 15. 文件 AI 识别
    // ============================================================
    if (fileAiBtn) {
        fileAiBtn.addEventListener('click', function() {
            if (!pendingFileContent) {
                fileStatus.textContent = '请先选择文件';
                fileStatus.style.color = '#ff3b30';
                return;
            }
            
            // 先尝试本地解析
            var localResult = parseEmojiText(pendingFileContent);
            if (localResult.length > 0) {
                parsedBatchEmojis = parsedBatchEmojis.concat(localResult);
                pendingFileContent = '';
                fileStatus.textContent = '本地解析成功，已识别 ' + localResult.length + ' 个表情包';
                fileStatus.style.color = '#34c759';
                showToast('已识别 ' + localResult.length + ' 个表情包');
                return;
            }
            
            // 本地解析失败，调用 AI
            recognizeWithAI(pendingFileContent, function(result) {
                if (result && result.length > 0) {
                    parsedBatchEmojis = parsedBatchEmojis.concat(result);
                    pendingFileContent = '';
                    fileStatus.textContent = 'AI 识别成功，已识别 ' + result.length + ' 个表情包';
                    fileStatus.style.color = '#34c759';
                    showToast('AI 识别成功');
                } else {
                    fileStatus.textContent = 'AI 识别失败，请检查文件格式';
                    fileStatus.style.color = '#ff3b30';
                }
            }, fileStatus);
        });
    }

    // ============================================================
    // 16. 批量粘贴（纯本地解析，不调用 API）
    // ============================================================
    if (batchRecognizeBtn) {
        batchRecognizeBtn.addEventListener('click', function() {
            var text = batchInput.value.trim();
            if (!text) {
                batchResult.textContent = '请先粘贴内容';
                batchResult.className = 'batch-result error';
                return;
            }
            var parsed = parseEmojiText(text);
            if (parsed.length > 0) {
                parsedBatchEmojis = parsedBatchEmojis.concat(parsed);
                batchResult.textContent = '已识别 ' + parsed.length + ' 个表情包，点击「添加」保存';
                batchResult.className = 'batch-result';
                batchInput.value = '';
                showToast('已识别 ' + parsed.length + ' 个表情包');
            } else {
                batchResult.textContent = '未识别到有效格式，请确保格式为：描述: 图片链接 或 纯链接';
                batchResult.className = 'batch-result error';
            }
        });
    }

    // ============================================================
    // 17. AI 识别核心
    // ============================================================
    function recognizeWithAI(text, callback, statusEl) {
        function setStatus(msg, isError) {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.style.color = isError ? '#ff3b30' : '#34c759';
            statusEl.className = statusEl.className.replace(/\s*error\s*/, '') + (isError ? ' error' : '');
        }

        console.log('🔍 [AI识别] 开始，文本长度:', text.length);

        // 先本地解析：文件通常是"描述：链接"格式，本地解析最准且不扣接口费用
        var localFirst = parseEmojiText(text);
        if (localFirst.length > 0) {
            console.log('📦 [AI识别] 本地解析到', localFirst.length, '个');
            setStatus('已识别 ' + localFirst.length + ' 个表情包', false);
            callback(localFirst);
            return;
        }

        getActiveApiConfig().then(function(apiConfig) {
            if (!apiConfig) {
                setStatus('未配置 API，已使用本地解析', true);
                var result = parseEmojiText(text);
                if (result.length > 0) callback(result);
                return;
            }

            var baseUrl = apiConfig.url.trim().replace(/\/+$/, '');
            if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
                baseUrl = 'https://' + baseUrl;
            }
            var endpoint;
            if (/\/chat\/completions\/?$/i.test(baseUrl)) {
                endpoint = baseUrl;
            } else if (/\/v\d+\/?$/i.test(baseUrl)) {
                endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
            } else {
                endpoint = baseUrl + '/v1/chat/completions';
            }
            var modelName = apiConfig.model || 'gpt-3.5-turbo';

            console.log('📡 [AI识别] 使用', apiConfig.label, '地址:', endpoint);
            setStatus('正在使用 ' + apiConfig.label + ' 识别中…', false);

            var prompt = '从下面的文本中提取所有表情包信息。要求：\n1. 每条输出为一行，格式严格为：描述: 图片链接\n2. 描述要简洁（2-8个字），图片链接必须是 http(s):// 开头的完整地址\n3. 只输出表情包列表，不要任何解释、编号、markdown符号或多余内容\n4. 如果某条只有描述没有链接，或只有链接没有描述，也要尽量配对输出\n\n文本：\n' + text;

            fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + apiConfig.key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                    max_tokens: 800
                })
            })
            .then(function(res) {
                if (!res.ok) {
                    return res.text().then(function(t) {
                        throw new Error('HTTP ' + res.status);
                    });
                }
                return res.json();
            })
            .then(function(data) {
                console.log('📡 [AI识别] 响应成功');
                var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
                var result = parseEmojiText(content);
                if (result.length > 0) {
                    setStatus(apiConfig.label + ' 已识别 ' + result.length + ' 个表情包', false);
                    callback(result);
                } else {
                    setStatus('AI 未识别到内容，使用本地解析', true);
                    var localResult = parseEmojiText(text);
                    if (localResult.length > 0) callback(localResult);
                }
            })
            .catch(function(err) {
                console.error('❌ [AI识别] 调用失败:', err);
                setStatus('API 调用失败，使用本地解析', true);
                var localResult = parseEmojiText(text);
                if (localResult.length > 0) callback(localResult);
            });
        });
    }

    // ============================================================
    // 18. 单张添加
    // ============================================================
    if (singleUploadBtn) {
        singleUploadBtn.addEventListener('click', function() { imageFileInput.click(); });
    }
    if (imageFileInput) {
        imageFileInput.addEventListener('change', function(e) {
            var file = this.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                singleUrlInput.value = ev.target.result;
                // 名称留空时用文件名兜底：给每个上传的表情一个能叫得出来的名字，
                // 角色才能用 [emoji:名称] 精确发到这一张（否则一堆「未命名」无法区分）。
                if (singleNameInput && !singleNameInput.value.trim()) {
                    var fn = String(file.name || '').replace(/\.[^.]+$/, '').trim();
                    if (fn) singleNameInput.value = fn.slice(0, 12);
                }
                showSinglePreview(ev.target.result, singleNameInput.value || '未命名');
                imageFileInput.value = '';
            };
            reader.readAsDataURL(file);
        });
    }

    if (singleUrlInput) {
        singleUrlInput.addEventListener('input', function() {
            if (this.value.trim()) {
                showSinglePreview(this.value.trim(), singleNameInput.value || '未命名');
            } else {
                singlePreview.style.display = 'none';
            }
        });
    }
    if (singleNameInput) {
        singleNameInput.addEventListener('input', function() {
            if (singleUrlInput.value.trim()) {
                showSinglePreview(singleUrlInput.value.trim(), this.value || '未命名');
            }
        });
    }

    function showSinglePreview(url, name) {
        singlePreviewImg.src = url;
        singlePreviewName.textContent = name || '未命名';
        singlePreview.style.display = 'flex';
    }

    if (singlePreviewRemove) {
        singlePreviewRemove.addEventListener('click', function() {
            singlePreview.style.display = 'none';
            singleUrlInput.value = '';
            singleNameInput.value = '';
        });
    }

    if (singleAddBtn) {
        singleAddBtn.addEventListener('click', function() {
            var url = singleUrlInput.value.trim();
            if (!url) { showToast('请选择图片或输入 URL'); return; }
            var name = singleNameInput.value.trim() || '表情';
            var targetId = targetGroupSelect.value;
            var group = data.emojiGroups.find(function(g) { return g.id === targetId; });
            if (group) {
                var base = name, n = 2;
                while ((group.emojis || []).some(function(x) { return x && x.name === name; })) { name = base + n; n++; }
                group.emojis.push({ id: 'e' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), name: name, url: url, addedAt: Date.now() });
                saveData(data).then(function() {
                    renderHome();
                    if (currentGroupId && currentGroupId === targetId) {
                        var g = data.emojiGroups.find(function(grp) { return grp.id === currentGroupId; });
                        if (g) renderDetail(g);
                    }
                    singlePreview.style.display = 'none';
                    singleUrlInput.value = '';
                    singleNameInput.value = '';
                    showToast('已添加 1 个表情包');
                });
            }
        });
    }

    // ============================================================
    // 19. 移动弹窗
    // ============================================================
    function openMoveModal() {
        moveTargetSelect.innerHTML = '';
        data.emojiGroups.forEach(function(g) {
            if (g.id === currentGroupId) return;
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name || '未命名';
            moveTargetSelect.appendChild(opt);
        });
        var newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = '+ 新建分组';
        moveTargetSelect.appendChild(newOpt);

        moveNewGroupWrap.style.display = 'none';
        moveNewGroupName.value = '';

        var handler = function() {
            if (this.value === '__new__') {
                moveNewGroupWrap.style.display = 'block';
            } else {
                moveNewGroupWrap.style.display = 'none';
            }
        };
        moveTargetSelect.removeEventListener('change', handler);
        moveTargetSelect.addEventListener('change', handler);

        moveModal.classList.add('show');
    }

    moveCancel.addEventListener('click', function() {
        moveModal.classList.remove('show');
    });

    moveConfirm.addEventListener('click', function() {
        var targetId = moveTargetSelect.value;
        if (targetId === '__new__') {
            var newName = moveNewGroupName.value.trim();
            if (!newName) {
                showToast('请输入新分组名称');
                return;
            }
            var newGroup = { id: 'g' + Date.now(), name: newName, emojis: [] };
            data.emojiGroups.push(newGroup);
            saveData(data).then(function() {
                targetId = newGroup.id;
                renderHome();
            });
        }

        if (!targetId) { showToast('请选择目标分组'); return; }

        var sourceGroup = data.emojiGroups.find(function(g) { return g.id === currentGroupId; });
        var targetGroup = data.emojiGroups.find(function(g) { return g.id === targetId; });
        if (!sourceGroup || !targetGroup) return;

        var toMove = sourceGroup.emojis.filter(function(e) { return selectedIds.has(e.id); });
        if (toMove.length === 0) { showToast('没有选中的表情包'); return; }

        toMove.forEach(function(e) { targetGroup.emojis.push(e); });
        sourceGroup.emojis = sourceGroup.emojis.filter(function(e) { return !selectedIds.has(e.id); });

        selectedIds.clear();
        saveData(data).then(function() {
            renderHome();
            renderDetail(sourceGroup);
            moveModal.classList.remove('show');
            showToast('已移动 ' + toMove.length + ' 个表情包');
        });
    });

    // ============================================================
    // 20. 重命名弹窗
    // ============================================================
    function openRenameModal(groupId) {
        var group = data.emojiGroups.find(function(g) { return g.id === groupId; });
        if (!group) return;
        renameInput.value = group.name || '';
        renameModal.classList.add('show');
        renameCallback = function(newName) {
            if (newName && newName.trim() !== '') {
                group.name = newName.trim();
                saveData(data).then(function() {
                    renderDetail(group);
                    renderHome();
                    pageTitle.textContent = group.name;
                    showToast('已重命名为: ' + group.name);
                });
            }
        };
        setTimeout(function() { renameInput.focus(); }, 100);
    }

    renameCancel.addEventListener('click', function() {
        renameModal.classList.remove('show');
        renameCallback = null;
    });
    renameConfirm.addEventListener('click', function() {
        var val = renameInput.value.trim();
        if (renameCallback) { renameCallback(val); }
        renameModal.classList.remove('show');
        renameCallback = null;
    });
    if (renameInput) {
        renameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { renameConfirm.click(); }
        });
    }
    renameModal.addEventListener('click', function(e) {
        if (e.target === renameModal) {
            renameModal.classList.remove('show');
            renameCallback = null;
        }
    });

    // ============================================================
    // 20.5 修改表情含义
    // ============================================================
    var editEmojiTarget = null; // { group, emoji }
    function openEditEmojiModal(groupId, emojiId) {
        var group = data.emojiGroups.find(function(g) { return g.id === groupId; });
        if (!group) return;
        var emoji = group.emojis.find(function(e) { return e.id === emojiId; });
        if (!emoji) return;
        editEmojiTarget = { group: group, emoji: emoji };
        editEmojiInput.value = emoji.name || '';
        editEmojiModal.classList.add('show');
        setTimeout(function() { editEmojiInput.focus(); }, 100);
    }

    function closeEditEmojiModal() {
        editEmojiModal.classList.remove('show');
        editEmojiTarget = null;
    }

    if (editEmojiCancel) {
        editEmojiCancel.addEventListener('click', closeEditEmojiModal);
    }
    if (editEmojiConfirm) {
        editEmojiConfirm.addEventListener('click', function() {
            if (!editEmojiTarget) { closeEditEmojiModal(); return; }
            var val = editEmojiInput.value.trim();
            if (val === '') { showToast('含义不能为空'); return; }
            editEmojiTarget.emoji.name = val;
            saveData(data).then(function() {
                renderDetail(editEmojiTarget.group);
                showToast('含义已修改');
            });
            closeEditEmojiModal();
        });
    }
    if (editEmojiInput) {
        editEmojiInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { editEmojiConfirm.click(); }
        });
    }
    if (editEmojiModal) {
        editEmojiModal.addEventListener('click', function(e) {
            if (e.target === editEmojiModal) closeEditEmojiModal();
        });
    }

    // ============================================================
    // 21. 本地解析（支持多种格式）
    // ============================================================
    function parseEmojiText(text) {
        function cleanUrl(u) {
            return u.replace(/[，,.;;）)>\]}"'、\s]+$/, '');
        }
        var result = [];
        if (!text) return result;

        // ===== 先尝试结构化 JSON =====
        var trimmed = text.trim();
        var firstChar = trimmed.charAt(0);
        if (firstChar === '{' || firstChar === '[') {
            try {
                var parsed = JSON.parse(trimmed);
                var rawArr = Array.isArray(parsed) ? parsed : (parsed.emojis || parsed.stickers || parsed.items || parsed.list || parsed.data || parsed.results || parsed.images || parsed.pack || []);
                var flat = [];
                (function flatten(list) {
                    (list || []).forEach(function(it) {
                        if (it && typeof it === 'object' && Array.isArray(it.emojis)) flatten(it.emojis);
                        else flat.push(it);
                    });
                })(rawArr);
                flat.forEach(function(item) {
                    if (!item || typeof item !== 'object') return;
                    var u = item.url || item.src || item.image || item.img || item.link || item.file || item.href || item.path;
                    if (u) {
                        var nm = item.name || item.title || item.label || item.desc || item.meaning || item.text || item.key || item.keyword || item.tag || '表情包';
                        result.push({ name: String(nm), url: String(u) });
                    }
                });
                var obj = parsed;
                if (obj && !Array.isArray(obj)) {
                    Object.keys(obj).forEach(function(k) {
                        var v = obj[k];
                        if (typeof v === 'string' && /^(https?:\/\/|data:image\/)/.test(v)) {
                            result.push({ name: k, url: v });
                        }
                    });
                }
            } catch (e) {}
        }

        // ===== Markdown 图片 ![名称](链接) =====
        var mdRe = /!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g;
        var mdm;
        while ((mdm = mdRe.exec(text)) !== null) {
            if (/^(https?:\/\/|data:image\/)/i.test(mdm[2])) result.push({ name: (mdm[1] || '').trim() || '表情包', url: cleanUrl(mdm[2].trim()) });
        }

        // ===== HTML <img src="..."> =====
        var imgRe = /<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
        var im;
        while ((im = imgRe.exec(text)) !== null) {
            var altM = im[0].match(/\balt=["']([^"']*)["']/i);
            result.push({ name: (altM && altM[1] ? altM[1] : '表情包'), url: cleanUrl(im[1].trim()) });
        }

        // ===== 行内多组 "描述:链接" =====
        var pairRe = /([^\s，,；;:：]{1,20})\s*[:：\-\t]\s*((?:https?:\/\/|data:image\/)[^\s，,；;<>"'）)]+)/g;
        var mm;
        while ((mm = pairRe.exec(text)) !== null) {
            result.push({ name: String(mm[1]).trim(), url: cleanUrl(mm[2].trim()) });
        }

        // ===== 逐行解析 =====
        var lines = text.split('\n').filter(function(line) { return line.trim(); });
        var pendingName = null;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            line = line.replace(/^[-*•·]\s*/, '').trim();
            if (!line) continue;
            line = line.replace(/[。；;]\s*$/, '');

            var nameOnly = line.match(/^(.+?)[:：]\s*$/);
            if (nameOnly) { pendingName = nameOnly[1].trim(); continue; }
            var match = line.match(/^(.+?)[:：\-\t]\s*((?:https?:\/\/|data:image\/)[^\s]+)/);
            if (match) {
                result.push({ name: match[1].trim(), url: cleanUrl(match[2].trim()) });
                pendingName = null;
                continue;
            }
            var nameSpace = line.match(/^(.{1,20}?)\s+((?:https?:\/\/|data:image\/)[^\s]+)$/);
            if (nameSpace) {
                result.push({ name: nameSpace[1].trim(), url: cleanUrl(nameSpace[2].trim()) });
                pendingName = null;
                continue;
            }
            var urlMatch = line.match(/^((?:https?:\/\/|data:image\/)[^\s]+)$/);
            if (urlMatch) {
                var u2 = cleanUrl(urlMatch[1].trim());
                var fn2 = u2.split('/').pop() || '';
                result.push({ name: pendingName || fn2.replace(/\.[^.]+$/, '') || '表情包', url: u2 });
                pendingName = null;
                continue;
            }
            var reverseMatch = line.match(/^((?:https?:\/\/|data:image\/)[^\s]+)\s+(.+)$/);
            if (reverseMatch) {
                result.push({ name: reverseMatch[2].trim(), url: cleanUrl(reverseMatch[1].trim()) });
                pendingName = null;
                continue;
            }
        }

        // ===== 兜底：全局扫描链接 =====
        var urlRe = /((?:https?:\/\/|data:image\/)[^\s，,；;）)<>"'，。]+)/g;
        var m;
        while ((m = urlRe.exec(text)) !== null) {
            var u = cleanUrl(m[1]);
            if (result.some(function(r) { return r.url === u; })) continue;
            var seg = text.slice(Math.max(0, m.index - 60), m.index);
            var name = '';
            var cIdx = seg.lastIndexOf('：');
            if (cIdx === -1) cIdx = seg.lastIndexOf(':');
            if (cIdx !== -1) { name = seg.slice(cIdx + 1).trim().replace(/^[：:\s]+/, ''); }
            if (!name) {
                var lineStart = text.lastIndexOf('\n', m.index) + 1;
                var lineSeg = text.slice(lineStart, m.index).replace(/[\"'\s]+$/, '');
                name = lineSeg;
            }
            if (!name) {
                var fn = u.split('/').pop() || '';
                name = fn.replace(/\.[^.]+$/, '') || '表情包';
            }
            name = String(name).replace(/[：【】\[\]"]/g, '');
            if (name && u) result.push({ name: name, url: u });
        }

        // ===== 按 URL 去重 =====
        var seen = {};
        var unique = [];
        result.forEach(function(r) {
            if (r && r.url && !seen[r.url]) { seen[r.url] = true; unique.push(r); }
        });
        return unique;
    }

    // ============================================================
    // 21.5 复用时重置界面（index 不重载直接切回本页时触发，切换更快）
    // ============================================================
    window.addEventListener('message', function(e) {
        var d = e.data;
        if (!d || d.type !== 'nanoOverlayReopen') return;
        ['addModal', 'moveModal', 'editEmojiModal', 'renameModal', 'infoModal'].forEach(function(id) {
            try { var el = document.getElementById(id); if (el) el.classList.remove('show'); } catch (err) {}
        });
        try { if (infoActionsEl) infoActionsEl.style.display = 'flex'; } catch (err) {}
        try { if (confirmActionsEl) confirmActionsEl.style.display = 'none'; } catch (err) {}
        try { if (typeof currentGroupId !== 'undefined' && currentGroupId) closeDetail(); } catch (err) {}
        try { renderHome(); } catch (err) {}
    });

    // ============================================================
    // 22. 页面关闭自动保存
    // ============================================================
    window.addEventListener('beforeunload', autoSave);
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            autoSave();
        }
    });

    // ============================================================
    // 23. 初始化
    // ============================================================
    loadData().then(function(loadedData) {
        data = loadedData;
        if (data.emojiGroups.length === 0) {
            data.emojiGroups.push({ id: 'g1', name: '默认', emojis: [] });
            saveData(data);
        }
        
        try { window.parent.postMessage({ type: 'hideBottomNav' }, '*'); } catch(e) {}

        renderHome();
        actionContainer.innerHTML = '';
        var addBtn = document.createElement('button');
        addBtn.className = 'nav-action';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function() {
            openAddModal(null);
        });
        actionContainer.appendChild(addBtn);

        console.log('✅ Emoji page loaded (IndexedDB)');
        console.log('📊 当前分组数:', data.emojiGroups.length);
    }).catch(function(err) {
        console.error('❌ 加载表情包数据失败:', err);
        data = { emojiGroups: [{ id: 'g1', name: '默认', emojis: [] }], balance: 0, favorites: [] };
        saveData(data);
        renderHome();
    });

    window.__emojiCloseDetail = closeDetail;
})();