// ============================================================
// mask.js - 人设管理（使用 IndexedDB 存储头像，支持大量用户）
// ============================================================
(function() {
    'use strict';

    const STORAGE_KEY = 'nano_mask_data';
    const LEGACY_STORAGE_KEYS = ['nano_home_data', 'peach_home_data'];
    const DB_NAME = 'MaskAvatarDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'avatars';
    // 人设数据本体也存 IndexedDB（localStorage 只作缓存）
    const MASK_DB_NAME = 'nano_mask_db';
    const MASK_DB_VERSION = 1;
    const MASK_DB_STORE = 'mask_data';

    // ===== DOCX 解析库按需加载（本地优先，失败回退 CDN）→ 页面秒开不阻塞 =====
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

    // ===== IndexedDB 操作 =====
    let db = null;

    function openDB() {
        return new Promise(function(resolve, reject) {
            if (db && db.name === DB_NAME) {
                resolve(db);
                return;
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function(e) {
                const d = e.target.result;
                if (!d.objectStoreNames.contains(STORE_NAME)) {
                    d.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = function(e) {
                db = e.target.result;
                resolve(db);
            };
            request.onerror = function(e) {
                reject(e.target.error);
            };
        });
    }

    function saveAvatarToDB(id, dataUrl) {
        return openDB().then(function(d) {
            return new Promise(function(resolve, reject) {
                const tx = d.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.put({ id: id, data: dataUrl || '' });
                request.onsuccess = function() { resolve(); };
                request.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    function getAvatarFromDB(id) {
        return openDB().then(function(d) {
            return new Promise(function(resolve, reject) {
                const tx = d.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(id);
                request.onsuccess = function() {
                    resolve(request.result ? request.result.data : '');
                };
                request.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    function deleteAvatarFromDB(id) {
        return openDB().then(function(d) {
            return new Promise(function(resolve, reject) {
                const tx = d.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.delete(id);
                request.onsuccess = function() { resolve(); };
                request.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    // ===== 人设数据 IndexedDB（nano_mask_db / mask_data） =====
    function openMaskDb() {
        return new Promise(function(resolve, reject) {
            try {
                const req = indexedDB.open(MASK_DB_NAME, MASK_DB_VERSION);
                req.onupgradeneeded = function(e) {
                    try {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(MASK_DB_STORE)) db.createObjectStore(MASK_DB_STORE, { keyPath: 'key' });
                    } catch (e) {}
                };
                req.onsuccess = function(e) { resolve(e.target.result); };
                req.onerror = function(e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function maskIdbGet() {
        return openMaskDb().then(function(db) {
            return new Promise(function(resolve) {
                try {
                    const r = db.transaction(MASK_DB_STORE, 'readonly').objectStore(MASK_DB_STORE).get('data');
                    r.onsuccess = function() { resolve(r.result ? r.result.value : null); };
                    r.onerror = function() { resolve(null); };
                } catch (e) { resolve(null); }
            });
        }).catch(function() { return null; });
    }

    function maskIdbPut(value) {
        return openMaskDb().then(function(db) {
            return new Promise(function(resolve) {
                try {
                    const tx = db.transaction(MASK_DB_STORE, 'readwrite');
                    tx.objectStore(MASK_DB_STORE).put({ key: 'data', value: value });
                    tx.oncomplete = function() { resolve(); };
                    tx.onerror = function() { resolve(); };
                } catch (e) { resolve(); }
            });
        }).catch(function() {});
    }

    // ===== 数据操作 =====
    function loadData() {
        // 新键名 nano_mask_data
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (!data.masks) data.masks = [];
                if (!data.currentMaskId && data.masks.length > 0) data.currentMaskId = data.masks[0].id;
                return data;
            }
        } catch(e) {}
        // 兼容旧键名（不删除旧数据，只是迁移读取；旧键里可能放表情包数据，需区分）
        for (let i = 0; i < LEGACY_STORAGE_KEYS.length; i++) {
            try {
                const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEYS[i]);
                if (legacyRaw) {
                    const legacy = JSON.parse(legacyRaw);
                    if (legacy && Array.isArray(legacy.masks)) {
                        if (!legacy.currentMaskId && legacy.masks.length > 0) legacy.currentMaskId = legacy.masks[0].id;
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy)); } catch(e) {}
                        return legacy;
                    }
                }
            } catch(e) {}
        }
        return { masks: [], currentMaskId: null };
    }

    function saveData(data) {
        // 打上更新时间：启动时用它判断 localStorage 和 IndexedDB 哪份更新。
        try { data.updatedAt = Date.now(); } catch(e) {}
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            try {
                window.parent.postMessage({ type: 'homeDataUpdated', data: data }, '*');
            } catch(e) {}
        } catch(e) {
            // localStorage 写满时不阻断保存：IndexedDB 仍会写入，启动时以它为准恢复。
            console.error('saveData error:', e);
        }
        // 写入 IndexedDB（人设数据本体）
        maskIdbPut(data);
    }

    // ===== 头像压缩（清晰版：200x200，质量0.8） =====
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
                resolve(canvas.toDataURL('image/jpeg', quality || 0.8));
            };
            img.src = dataUrl;
        });
    }

    // ===== 应用状态 =====
    let data = loadData();
    let isEditMode = false;
    let selectedIds = new Set();
    let editingId = null;
    let tempAvatar = '';
    let clickTimer = null;

    // ===== DOM 引用 =====
    const maskList = document.getElementById('maskList');
    const emptyState = document.getElementById('emptyState');
    const backBtn = document.getElementById('backBtn');
    const pageHeader = document.getElementById('pageHeader');
    const editControls = document.getElementById('editControls');
    const addBtn = document.getElementById('addBtn');
    const editModeBtn = document.getElementById('editModeBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const editModal = document.getElementById('editModal');
    const editTitle = document.getElementById('editTitle');
    const avatarPicker = document.getElementById('avatarPicker');
    const avatarPlaceholder = document.getElementById('avatarPlaceholder');
    const avatarPreview = document.getElementById('avatarPreview');
    const inputName = document.getElementById('inputName');
    const inputWechat = document.getElementById('inputWechat');
    const inputGender = document.getElementById('inputGender');
    const inputSetting = document.getElementById('inputSetting');
    const importBtn = document.getElementById('importBtn');
    const editCancel = document.getElementById('editCancel');
    const editSave = document.getElementById('editSave');
    const useMaskBtn = document.getElementById('useMaskBtn');

    // ===== 新版头像弹窗 DOM =====
    const avatarModal = document.getElementById('avatarModal');
    const avatarFileInput = document.getElementById('avatarFileInput');
    const avatarThumbPreview = document.getElementById('avatarThumbPreview');
    const avatarUrlInput = document.getElementById('avatarUrlInput');
    const avatarResetBtn = document.getElementById('avatarResetBtn');
    const avatarCancelBtn = document.getElementById('avatarCancelBtn');
    const avatarConfirmBtn = document.getElementById('avatarConfirmBtn');

    const DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><rect width='28' height='28' rx='6' fill='%23E5E5EA' /><circle cx='14' cy='11' r='5' fill='%238E8E93' /><path d='M6 24c0-4.4 3.6-8 8-8s8 3.6 8 8' fill='%238E8E93' /></svg>";

    const infoModal = document.getElementById('infoModal');
    const infoTitle = document.getElementById('infoTitle');
    const infoBody = document.getElementById('infoBody');
    const infoOk = document.getElementById('infoOk');

    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const deleteConfirmMsg = document.getElementById('deleteConfirmMsg');
    const deleteConfirmCancel = document.getElementById('deleteConfirmCancel');
    const deleteConfirmOk = document.getElementById('deleteConfirmOk');

    const importFileInput = document.getElementById('importFileInput');

    // 旧版本/多端同步可能把同一个人设写成两条；渲染前按 id + 内容去重。
    function dedupeMasks(list, currentId) {
        const out = [];
        const seenId = {};
        const seenSig = {};
        (Array.isArray(list) ? list : []).forEach(function (m) {
            if (!m || !m.id) return;
            const id = String(m.id);
            if (seenId[id]) return;
            const sig = [m.name || '', m.wechat || '', m.gender || '', m.setting || ''].join('\u0001');
            if (seenSig[sig]) {
                if (id === currentId) {
                    const idx = out.findIndex(function (x) { return String(x.id) === String(seenSig[sig]); });
                    if (idx > -1) out[idx] = m;
                    seenSig[sig] = id;
                }
                return;
            }
            seenId[id] = 1;
            seenSig[sig] = id;
            out.push(m);
        });
        return out;
    }

    // ===== 渲染 =====
    async function renderAll() {
        const before = (data.masks || []).length;
        const deduped = dedupeMasks(data.masks, data.currentMaskId);
        if (deduped.length !== before) {
            data.masks = deduped;
            if (data.currentMaskId && !deduped.some(function (m) { return String(m.id) === String(data.currentMaskId); })) {
                data.currentMaskId = deduped.length ? deduped[0].id : null;
            }
            saveData(data);
        }
        const masks = data.masks || [];
        maskList.innerHTML = '';

        if (masks.length === 0) {
            emptyState.style.display = 'block';
            maskList.style.display = 'none';
            updateUI();
            return;
        }

        emptyState.style.display = 'none';
        maskList.style.display = 'flex';

        for (const item of masks) {
            const div = document.createElement('div');
            div.className = 'mask-item';
            if (selectedIds.has(item.id)) div.classList.add('selected');

            const isCurrent = item.id === data.currentMaskId;

            const avatar = document.createElement('div');
            avatar.className = 'mask-avatar';

            let avatarData = '';
            try {
                avatarData = await getAvatarFromDB(item.id);
            } catch(e) {
                console.warn('加载头像失败:', e);
            }

            if (avatarData && avatarData.trim() !== '') {
                const img = document.createElement('img');
                img.src = avatarData;
                avatar.appendChild(img);
            } else {
                avatar.textContent = item.name ? item.name.charAt(0).toUpperCase() : '?';
            }
            div.appendChild(avatar);

            const info = document.createElement('div');
            info.className = 'mask-info';
            const name = document.createElement('div');
            name.className = 'mask-name';
            name.textContent = item.name || '未命名';
            info.appendChild(name);
            const wechat = document.createElement('div');
            wechat.className = 'mask-wechat';
            wechat.textContent = '微信号：' + (item.wechat || '未设置');
            info.appendChild(wechat);
            div.appendChild(info);

            if (!isCurrent) {
                const useBtn = document.createElement('button');
                useBtn.className = 'mask-use-btn';
                useBtn.type = 'button';
                useBtn.setAttribute('aria-label', '切换到此 User');
                useBtn.title = '切换到此 User';
                useBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/></svg>';
                useBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    setCurrentMask(item.id);
                });
                div.appendChild(useBtn);
            }

            const dot = document.createElement('span');
            dot.className = 'dot' + (isCurrent ? '' : ' hidden');
            div.appendChild(dot);

            div.addEventListener('click', function(e) {
                e.stopPropagation();
                if (isEditMode) {
                    if (selectedIds.has(item.id)) {
                        selectedIds.delete(item.id);
                        div.classList.remove('selected');
                    } else {
                        selectedIds.add(item.id);
                        div.classList.add('selected');
                    }
                    updateUI();
                    return;
                }

                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                    setCurrentMask(item.id);   // 双击：切换面具
                    return;
                }
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    openEditModal(item.id);    // 单击：进入详情
                }, 250);
            });

            maskList.appendChild(div);
        }
        updateUI();
    }

    function updateUI() {
        if (pageHeader) pageHeader.classList.toggle('hidden', isEditMode);
        if (editControls) editControls.classList.toggle('show', isEditMode);
        if (isEditMode) {
            editModeBtn.classList.add('active');
            editModeBtn.innerHTML =
                `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
            const oldBadge = editModeBtn.querySelector('.badge');
            if (oldBadge) oldBadge.remove();
            if (selectedIds.size > 0) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = selectedIds.size;
                editModeBtn.appendChild(badge);
            }
            cancelEditBtn.classList.add('show');
        } else {
            editModeBtn.classList.remove('active');
            editModeBtn.innerHTML =
                `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
            cancelEditBtn.classList.remove('show');
        }
    }

    // ===== 切换当前人设 =====
    function setCurrentMask(id) {
        data.currentMaskId = id;
        saveData(data);
        renderAll();
        try {
            // 同时广播完整数据：聊天列表的「状态栏」/头像/名字立即同步，不用等下一次轮询。
            window.parent.postMessage({ type: 'currentMaskChanged', maskId: id, data: data }, '*');
            window.parent.postMessage({ type: 'homeDataUpdated', data: data }, '*');
        } catch(e) {}
    }

    // ===== 编辑模式 =====
    function enterEditMode() {
        if (data.masks.length === 0) {
            showInfo('提示', '没有可编辑的人设');
            return;
        }
        isEditMode = true;
        selectedIds.clear();
        renderAll();
    }

    function exitEditMode() {
        isEditMode = false;
        selectedIds.clear();
        document.querySelectorAll('.mask-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
        updateUI();
        renderAll();
    }

    // ===== 编辑弹窗 =====
    function openEditModal(id) {
        const item = id ? data.masks.find(m => m.id === id) : null;
        editingId = id || null;

        if (item) {
            editTitle.textContent = '编辑人设';
            if (useMaskBtn) useMaskBtn.style.display = (String(item.id) === String(data.currentMaskId)) ? 'none' : 'block';
            tempAvatar = '';
            inputName.value = item.name || '';
            inputWechat.value = item.wechat || '';
            inputGender.value = item.gender || '女';
            inputSetting.value = item.setting || '';
            editSave.textContent = '保存';
            getAvatarFromDB(item.id).then(function(dataUrl) {
                tempAvatar = dataUrl || '';
                updateAvatarPreview();
            }).catch(function() {
                tempAvatar = '';
                updateAvatarPreview();
            });
        } else {
            editTitle.textContent = '新增人设';
            if (useMaskBtn) useMaskBtn.style.display = 'none';
            tempAvatar = '';
            inputName.value = '';
            inputWechat.value = '';
            inputGender.value = '女';
            inputSetting.value = '';
            editSave.textContent = '添加';
            updateAvatarPreview();
        }

        editModal.classList.add('show');
    }

    function closeEditModal() {
        editModal.classList.remove('show');
        if (useMaskBtn) useMaskBtn.style.display = 'none';
        editingId = null;
    }

    function updateAvatarPreview() {
        if (tempAvatar && tempAvatar.trim() !== '') {
            avatarPreview.src = tempAvatar;
            avatarPreview.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
        } else {
            avatarPreview.style.display = 'none';
            avatarPlaceholder.style.display = 'block';
            avatarPlaceholder.textContent = '+';
        }
    }

    // ===== 新版头像弹窗逻辑 =====
    function openAvatarModal() {
        avatarUrlInput.value = '';
        avatarFileInput.value = '';
        if (tempAvatar && tempAvatar.trim() !== '') {
            avatarThumbPreview.src = tempAvatar;
        } else {
            avatarThumbPreview.src = DEFAULT_AVATAR;
        }
        avatarModal.classList.add('show');
    }

    function closeAvatarModal() {
        avatarModal.classList.remove('show');
    }

    avatarFileInput.addEventListener('change', function(e) {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            avatarThumbPreview.src = evt.target.result;
            avatarUrlInput.value = '';
        };
        reader.readAsDataURL(file);
        this.value = '';
    });

    avatarUrlInput.addEventListener('input', function() {
        const url = this.value.trim();
        if (url) {
            avatarThumbPreview.src = url;
            avatarFileInput.value = '';
        } else {
            avatarThumbPreview.src = DEFAULT_AVATAR;
        }
    });

    avatarResetBtn.addEventListener('click', function() {
        avatarUrlInput.value = '';
        avatarFileInput.value = '';
        avatarThumbPreview.src = DEFAULT_AVATAR;
        this.style.transform = 'scale(0.85)';
        setTimeout(function() { avatarResetBtn.style.transform = ''; }, 150);
    });

    avatarCancelBtn.addEventListener('click', closeAvatarModal);

    avatarConfirmBtn.addEventListener('click', function() {
        const currentSrc = avatarThumbPreview.src;
        if (currentSrc && currentSrc !== DEFAULT_AVATAR) {
            tempAvatar = currentSrc;
            updateAvatarPreview();
            closeAvatarModal();
        } else {
            tempAvatar = '';
            updateAvatarPreview();
            closeAvatarModal();
        }
    });

    avatarModal.addEventListener('click', function(e) {
        if (e.target === avatarModal) closeAvatarModal();
    });

    // ===== 保存人设 =====
    async function saveMask() {
        const name = inputName.value.trim() || '未命名';
        const wechat = inputWechat.value.trim() || '未设置';
        const gender = inputGender.value;
        const setting = inputSetting.value.trim() || '';

        let maskId = editingId;

        if (maskId) {
            const idx = data.masks.findIndex(m => m.id === maskId);
            if (idx > -1) {
                data.masks[idx] = { ...data.masks[idx], name, wechat, gender, setting };
            }
        } else {
            maskId = 'm' + Date.now();
            data.masks.push({ id: maskId, name, wechat, gender, setting });
            if (!data.currentMaskId) data.currentMaskId = maskId;
        }

        if (tempAvatar && tempAvatar.trim() !== '') {
            try {
                await saveAvatarToDB(maskId, tempAvatar);
            } catch(e) {
                console.warn('保存头像到 IndexedDB 失败:', e);
            }
        } else {
            // 未设置/点了恢复默认：清掉库里旧头像，避免“改回默认却还是旧图”
            try { await deleteAvatarFromDB(maskId); } catch(e) {}
        }

        saveData(data);
        closeEditModal();
        if (isEditMode) exitEditMode();
        renderAll();
    }

    // ===== 删除选中 =====
    async function deleteSelected() {
        const toDelete = data.masks.filter(m => selectedIds.has(m.id));
        for (const item of toDelete) {
            try {
                await deleteAvatarFromDB(item.id);
            } catch(e) {
                console.warn('删除头像失败:', e);
            }
        }
        const remaining = data.masks.filter(m => !selectedIds.has(m.id));
        data.masks = remaining;
        if (data.currentMaskId && !remaining.find(m => m.id === data.currentMaskId)) {
            data.currentMaskId = remaining.length > 0 ? remaining[0].id : null;
        }
        selectedIds.clear();
        saveData(data);
        deleteConfirmModal.classList.remove('show');

        // ===== 修复：退出编辑模式并只渲染一次 =====
        isEditMode = false;
        updateUI();
        renderAll();
    }

    // ===== 打开删除确认弹窗 =====
    function openDeleteConfirm() {
        const count = selectedIds.size;
        deleteConfirmMsg.textContent = count + ' 个人设将被永久删除，无法恢复';
        deleteConfirmModal.classList.add('show');
    }

    // ===== 显示信息 =====
    function showInfo(title, body) {
        infoTitle.textContent = title || '提示';
        infoBody.textContent = body || '';
        infoModal.classList.add('show');
    }

    // ===== 事件绑定 =====
    addBtn.onclick = function(e) {
        e.stopPropagation();
        if (isEditMode) exitEditMode();
        openEditModal(null);
    };

    editModeBtn.onclick = function() {
        if (isEditMode) {
            if (selectedIds.size === 0) {
                exitEditMode();
                return;
            }
            openDeleteConfirm();
        } else {
            enterEditMode();
        }
    };

    cancelEditBtn.onclick = exitEditMode;

    deleteConfirmCancel.onclick = function() {
        deleteConfirmModal.classList.remove('show');
    };
    deleteConfirmOk.onclick = function() {
        deleteSelected();
    };
    deleteConfirmModal.onclick = function(e) {
        if (e.target === deleteConfirmModal) deleteConfirmModal.classList.remove('show');
    };

    avatarPicker.onclick = function() {
        openAvatarModal();
    };

    importBtn.onclick = function() {
        importFileInput.click();
    };

    importFileInput.onchange = function(e) {
        const file = this.files[0];
        if (!file) return;
        importFileInput.value = '';

        // ===== DOC / DOCX：按需加载解析库提取文本 =====
        const lowerName = (file.name || '').toLowerCase();
        if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) {
            ensureMammoth().then(function(mammoth) {
                const reader = new FileReader();
                reader.onload = function(ev) {
                    mammoth.extractRawText({ arrayBuffer: ev.target.result })
                        .then(function(result) {
                            const text = result.value || '';
                            if (!text || text.trim() === '') {
                                showInfo('导入失败', '未能从 DOCX 中提取到文本内容，请确认文件是否包含文字。');
                                return;
                            }
                            inputSetting.value = text;
                            showInfo('导入成功', '设定内容已导入，共 ' + text.length + ' 个字符');
                        })
                        .catch(function(err) {
                            showInfo('导入失败', '解析 DOCX 失败: ' + (err.message || '未知错误'));
                        });
                };
                reader.onerror = function() {
                    showInfo('导入失败', '读取文件失败');
                };
                reader.readAsArrayBuffer(file);
            }).catch(function() {
                showInfo('导入失败', 'DOCX 解析库加载失败，请检查网络后重试');
            });
            return;
        }

        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                let text = ev.target.result;
                if (file.name.endsWith('.json')) {
                    const json = JSON.parse(text);
                    text = JSON.stringify(json, null, 2);
                }
                inputSetting.value = text;
                showInfo('导入成功', '设定内容已导入');
            } catch(err) {
                showInfo('导入失败', err.message);
            }
        };
        reader.readAsText(file);
    };

    editSave.onclick = saveMask;
    editCancel.onclick = closeEditModal;
    if (useMaskBtn) useMaskBtn.onclick = function () {
        if (!editingId) return;
        var id = editingId;
        closeEditModal();
        setCurrentMask(id);
    };
    editModal.onclick = function(e) {
        if (e.target === editModal) closeEditModal();
    };

    infoOk.onclick = function() {
        infoModal.classList.remove('show');
    };
    infoModal.onclick = function(e) {
        if (e.target === infoModal) infoModal.classList.remove('show');
    };

    // ===== 顶栏返回：编辑模式先退出，否则返回 chat 页面 =====
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            if (isEditMode) { exitEditMode(); return; }
            try {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'closeFullscreen' }, '*');
                } else {
                    window.history.back();
                }
            } catch (e) {}
        });
    }

    // ===== 父页面通信 =====
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (data && data.type === 'closeFullscreen') {
            // 由父页面控制
        }
    });

    try {
        window.parent.postMessage({ type: 'pageLoaded', page: 'mask' }, '*');
    } catch(e) {}

    // ===== 启动 =====
    renderAll();

    // ===== 人设数据本体同步到 IndexedDB / 从 IndexedDB 恢复（不清除现有数据） =====
    // 注意：不能先把 localStorage 里的旧数据写进 IndexedDB 再读，
    // 否则 localStorage 写满导致新用户没存进去时，会把 IndexedDB 里正确的新数据覆盖掉，
    // 表现就是“刚添加的人设一刷新就没了”。
    maskIdbGet().then(function(idbData) {
        const localMasks = (data && Array.isArray(data.masks)) ? data.masks : [];
        const idbMasks = (idbData && Array.isArray(idbData.masks)) ? idbData.masks : [];
        const localTs = Number(data && data.updatedAt) || 0;
        const idbTs = Number(idbData && idbData.updatedAt) || 0;

        if (!idbData || !idbMasks.length) {
            if (localMasks.length > 0) maskIdbPut(data);
            return;
        }

        // 按 id 合并两边，而不是整份覆盖：
        //  · 页面刚打开、IndexedDB 还没读完时，用户可能已经新增了人设；
        //  · 如果直接拿 IDB 覆盖，会把刚加的人设冲掉（看起来又“加不上”）。
        // 同 id 时，更新时间较新的一边优先。
        const mergedMap = {};
        const order = [];
        function addMask(m) {
            if (!m || !m.id) return;
            if (!mergedMap[m.id]) order.push(m.id);
            mergedMap[m.id] = m;
        }
        if (idbTs >= localTs) {
            localMasks.forEach(addMask);
            idbMasks.forEach(addMask);
        } else {
            idbMasks.forEach(addMask);
            localMasks.forEach(addMask);
        }
        const merged = order.map(function (id) { return mergedMap[id]; });
        if (!merged.length) return;

        let current = '';
        if (data && data.currentMaskId && mergedMap[data.currentMaskId]) current = data.currentMaskId;
        else if (idbData.currentMaskId && mergedMap[idbData.currentMaskId]) current = idbData.currentMaskId;
        else current = merged[0].id;

        const cleaned = dedupeMasks(merged, current);
        if (cleaned.length !== merged.length) {
            merged.length = 0;
            cleaned.forEach(function (m) { merged.push(m); });
            if (!merged.some(function (m) { return String(m.id) === String(current); })) {
                current = merged.length ? merged[0].id : '';
            }
        }

        function sig(list) {
            try {
                return JSON.stringify(list.slice().sort(function (a, b) {
                    return String(a && a.id || '').localeCompare(String(b && b.id || ''));
                }));
            } catch (e) { return ''; }
        }
        const changed = merged.length !== localMasks.length ||
            merged.length !== idbMasks.length ||
            current !== (data && data.currentMaskId) ||
            sig(localMasks) !== sig(merged);

        if (changed) {
            // 以较新的一边为底，避免其它字段被旧数据覆盖。
            data = Object.assign({}, (idbTs > localTs ? idbData : data));
            data.masks = merged;
            data.currentMaskId = current;
            saveData(data);
            renderAll();
        } else {
            maskIdbPut(data);
        }
    });
})();