// js/more.js
(function() {
    'use strict';

    // ===== IndexedDB 操作 =====
    var DB_NAME = 'nano_user_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'user_data';

    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                var request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
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

    function idbSet(key, value) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.put({ key: key, value: value });
                request.onsuccess = function() { resolve(); };
                request.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    function idbGet(key) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.get(key);
                request.onsuccess = function() {
                    resolve(request.result ? request.result.value : null);
                };
                request.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    function idbDelete(key) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.delete(key);
                request.onsuccess = function() { resolve(); };
                request.onerror = function(e) { reject(e.target.error); };
                tx.oncomplete = function() { db.close(); };
            });
        });
    }

    // ===== 头像管理 =====
    var AVATAR_KEY = 'user_avatar_data';
    var NAME_KEY = 'user_name_data';

    var avatarImg = document.getElementById('avatarImage');
    var avatarSvg = document.getElementById('avatarSvg');
    var profileName = document.getElementById('profileName');
    var profileCard = document.getElementById('profileCard');

    // ===== 头像弹窗元素 =====
    var avatarModal = document.getElementById('avatarModal');
    var thumbPreview = document.getElementById('thumbPreview');
    var avatarUrlInput = document.getElementById('avatarUrlInput');
    var avatarFileInput = document.getElementById('avatarFileInput');
    var avatarResetBtn = document.getElementById('avatarResetBtn');
    var avatarCancel = document.getElementById('avatarCancel');
    var avatarSave = document.getElementById('avatarSave');

    // ===== 名字弹窗元素 =====
    var nameModal = document.getElementById('nameModal');
    var nameInput = document.getElementById('nameInput');
    var nameConfirm = document.getElementById('nameConfirm');
    var nameCancel = document.getElementById('nameCancel');

    var DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><rect width='28' height='28' rx='6' fill='%23E5E5EA' /><circle cx='14' cy='11' r='5' fill='%238E8E93' /><path d='M6 24c0-4.4 3.6-8 8-8s8 3.6 8 8' fill='%238E8E93' /></svg>";
    // 本次弹窗里刚选择的照片 dataURL（优先于缩略图 src，避免部分图片读取/压缩失败）
    var pendingAvatarDataUrl = '';

    // ===== 读取当前人设(Mask)头像，保证各页面头像一致 =====
    function currentMaskId() {
        try {
            var md = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
            if (md) return String(md.currentMaskId || (md.masks && md.masks[0] && md.masks[0].id) || '');
        } catch (e) {}
        return '';
    }
    function getMaskAvatar() {
        return new Promise(function (resolve) {
            var maskId = currentMaskId();
            if (!maskId) { resolve(''); return; }
            try {
                var req = indexedDB.open('MaskAvatarDB', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var g = db.transaction('avatars', 'readonly').objectStore('avatars').get(maskId);
                        g.onsuccess = function () { resolve((g.result && g.result.data) || ''); try { db.close(); } catch (e2) {} };
                        g.onerror = function () { resolve(''); try { db.close(); } catch (e2) {} };
                    } catch (err) { resolve(''); }
                };
                req.onerror = function () { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }
    function setMaskAvatar(dataUrl) {
        return new Promise(function (resolve) {
            var maskId = currentMaskId();
            if (!maskId) { resolve(); return; }
            try {
                var req = indexedDB.open('MaskAvatarDB', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var tx = db.transaction('avatars', 'readwrite');
                        if (dataUrl) tx.objectStore('avatars').put({ id: maskId, data: dataUrl });
                        else tx.objectStore('avatars').delete(maskId);
                        tx.oncomplete = function () { resolve(); try { db.close(); } catch (e2) {} };
                        tx.onerror = function () { resolve(); try { db.close(); } catch (e2) {} };
                    } catch (err) { resolve(); }
                };
                req.onerror = function () { resolve(); };
            } catch (e) { resolve(); }
        });
    }

    // ===== 加载用户数据（从 IndexedDB） =====
    async function loadUserData() {
        try {
            var savedAvatar = await idbGet(AVATAR_KEY);
            if (!savedAvatar || savedAvatar.trim() === '') {
                // 没单独设置时跟人设头像保持一致，避免各页头像不一致
                savedAvatar = await getMaskAvatar();
            }
            if (savedAvatar && savedAvatar.trim() !== '') {
                avatarImg.src = savedAvatar;
                avatarImg.style.display = 'block';
                avatarSvg.style.display = 'none';
            } else {
                avatarImg.style.display = 'none';
                avatarSvg.style.display = 'block';
            }

            // 名字仍然用 localStorage（很小）
            var savedName = localStorage.getItem(NAME_KEY);
            if (savedName && savedName.trim() !== '') {
                profileName.textContent = savedName;
            } else {
                profileName.textContent = '我';
            }
        } catch(e) {
            console.warn('加载用户数据失败:', e);
        }
    }

    // ===== 保存头像到 IndexedDB =====
    async function saveAvatar(dataUrl) {
        try {
            await idbSet(AVATAR_KEY, dataUrl);
            setMaskAvatar(dataUrl);   // 同步到人设头像，保持各页面一致
            avatarImg.src = dataUrl;
            avatarImg.style.display = 'block';
            avatarSvg.style.display = 'none';
            console.log('[More] 头像已保存到 IndexedDB');
        } catch(e) {
            console.warn('保存头像失败:', e);
            showToast('保存失败: ' + e.message);
        }
    }

    // ===== 保存名字 =====
    function saveName(name) {
        try {
            localStorage.setItem(NAME_KEY, name);
            profileName.textContent = name;
        } catch(e) {
            console.warn('保存名字失败:', e);
        }
    }

    // ===== 恢复默认头像 =====
    async function resetAvatar() {
        try {
            await idbDelete(AVATAR_KEY);
            setMaskAvatar('');
            avatarImg.style.display = 'none';
            avatarSvg.style.display = 'block';
            avatarImg.src = '';
            showToast('已恢复默认头像');
        } catch(e) {
            console.warn('恢复默认头像失败:', e);
        }
    }

    // ===== 压缩图片 =====
    function compressImage(dataUrl, maxWidth, maxHeight, quality, callback) {
        var img = new Image();
        var done = false;
        function finish(result) {
            if (done) return;
            done = true;
            callback(result);
        }
        img.onload = function() {
            try {
                var w = img.width;
                var h = img.height;
                if (w > maxWidth) { h = h * (maxWidth / w); w = maxWidth; }
                if (h > maxHeight) { w = w * (maxHeight / h); h = maxHeight; }
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                finish(canvas.toDataURL('image/jpeg', quality || 0.6));
            } catch (e) {
                // 无法压缩（跨域/格式特殊）时直接用原图，保证仍可当头像
                finish(dataUrl);
            }
        };
        img.onerror = function() { finish(dataUrl); };
        img.src = dataUrl;
    }

    // ===== Toast 提示 =====
    function showToast(msg) {
        var existing = document.querySelector('.custom-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'custom-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);

        setTimeout(function() { toast.style.opacity = '1'; }, 10);
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
        }, 2000);
    }

    // ===== 头像弹窗控制 =====
    async function openAvatarModal() {
        pendingAvatarDataUrl = '';
        var currentAvatar = await idbGet(AVATAR_KEY);
        if (currentAvatar && currentAvatar.trim() !== '') {
            thumbPreview.src = currentAvatar;
        } else {
            thumbPreview.src = DEFAULT_AVATAR;
        }
        avatarUrlInput.value = '';
        avatarFileInput.value = '';
        avatarModal.classList.add('active');
    }

    function closeAvatarModal() {
        avatarModal.classList.remove('active');
    }

    // ===== 名字弹窗控制 =====
    function openNameModal() {
        nameInput.value = profileName.textContent;
        nameModal.classList.add('active');
        setTimeout(function() { nameInput.focus(); }, 200);
    }

    function closeNameModal() {
        nameModal.classList.remove('active');
    }

    // ===== 点击头像卡片 =====
    profileCard.addEventListener('click', function(e) {
        var target = e.target;
        if (target.closest('.profile-avatar')) {
            openAvatarModal();
            return;
        }
        if (target.closest('.profile-info') || target.closest('.profile-name') || target.closest('.profile-desc')) {
            openNameModal();
            return;
        }
        if (target.closest('.chevron-right')) {
            openAvatarModal();
        }
    });

    // ===== 名字弹窗事件 =====
    nameConfirm.addEventListener('click', function() {
        var newName = nameInput.value.trim();
        if (!newName) {
            showToast('请输入名字');
            return;
        }
        saveName(newName);
        closeNameModal();
        showToast('名字已更新为: ' + newName);
    });

    nameCancel.addEventListener('click', closeNameModal);

    nameInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            nameConfirm.click();
        }
    });

    nameModal.addEventListener('click', function(e) {
        if (e.target === nameModal) closeNameModal();
    });

    // ===== 头像弹窗事件 =====
    avatarFileInput.addEventListener('change', function(e) {
        var file = this.files[0];
        if (!file) return;
        // 不再限制大小（与 mask/character 一致），避免大图/原图被拒
        if (file.type && file.type.indexOf('image/') !== 0) {
            showToast('请选择图片文件');
            this.value = '';
            return;
        }
        var reader = new FileReader();
        reader.onload = function(evt) {
            var raw = evt.target.result;
            pendingAvatarDataUrl = raw;
            thumbPreview.onerror = null;
            thumbPreview.src = raw;
            avatarUrlInput.value = '';
            // 压缩到 512：手机拍的原图/HEIC 体积很大，直接存会导致显示不出来（“换了没反应”）
            compressImage(raw, 512, 512, 0.85, function(out) {
                if (out) { pendingAvatarDataUrl = out; thumbPreview.src = out; }
            });
            showToast('已选择照片，点“保存”即可换头像');
        };
        reader.onerror = function() {
            showToast('读取图片失败，请重试');
        };
        reader.readAsDataURL(file);
    });

    // ⭐ 手机上部分浏览器不响应 label for 打开相册：改为让隐藏 input 覆盖整行，原生触发
    // (上传控件已直接铺满“相册”行，见 CSS)

    avatarUrlInput.addEventListener('input', function() {
        var url = this.value.trim();
        pendingAvatarDataUrl = '';
        if (url) {
            thumbPreview.src = url;
            avatarFileInput.value = '';
        } else {
            thumbPreview.src = DEFAULT_AVATAR;
        }
    });

    avatarResetBtn.addEventListener('click', function() {
        avatarUrlInput.value = '';
        avatarFileInput.value = '';
        pendingAvatarDataUrl = '';
        thumbPreview.src = DEFAULT_AVATAR;
        this.style.transform = 'scale(0.85)';
        setTimeout(function() {
            avatarResetBtn.style.transform = '';
        }, 150);
        // 异步删除 IndexedDB 中的头像
        resetAvatar();
    });

    avatarCancel.addEventListener('click', closeAvatarModal);

    avatarSave.addEventListener('click', function() {
        var src = pendingAvatarDataUrl || thumbPreview.src;
        if (!src || src === DEFAULT_AVATAR || src.indexOf('svg') !== -1) {
            showToast('请选择照片或输入图片链接');
            return;
        }
        // 与 mask/character 一致：直接保存所选图片本身，不做 canvas 重编码，
        // 避免部分格式（HEIC/特殊 PNG/SVG 等）压缩失败导致换不了头像。
        saveAvatar(src).then(function() {
            if (thumbPreview.src !== src) thumbPreview.src = src;
            closeAvatarModal();
            showToast('头像已更新');
        }).catch(function() { showToast('保存失败，请重试'); });
    });

    avatarModal.addEventListener('click', function(e) {
        if (e.target === avatarModal) closeAvatarModal();
    });

    // ===== 纳米助手开关：开启后在聊天列表出现「纳米」角色 =====
    var NANO_ID = 'nano_ai';
    var NANO_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ecb"/><stop offset="1" stop-color="#ff4d94"/></linearGradient></defs>' +
        '<rect width="80" height="80" rx="20" fill="url(#g)"/>' +
        '<rect x="18" y="24" width="44" height="34" rx="12" fill="#fff" opacity="0.95"/>' +
        '<circle cx="32" cy="41" r="4.5" fill="#ff4d94"/><circle cx="48" cy="41" r="4.5" fill="#ff4d94"/>' +
        '<rect x="38" y="12" width="4" height="10" rx="2" fill="#fff"/><circle cx="40" cy="11" r="4" fill="#fff"/></svg>');
    function openCharsDB() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            } catch (e) { reject(e); }
        });
    }
    function ensureNanoCharacter(on) {
        return openCharsDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction('characters', 'readwrite');
                    var store = tx.objectStore('characters');
                    var g = store.get(NANO_ID);
                    g.onsuccess = function () {
                        var existing = g.result;
                        if (on) {
                            if (!existing) {
                                store.put({
                                    id: NANO_ID, name: '纳米', avatar: NANO_AVATAR,
                                    gender: '女', nationality: '中国', setting: '',
                                    bindUser: '', isNpc: true, worldbookBindings: [],
                                    nanoAssistant: true
                                });
                            } else {
                                existing.name = '纳米';
                                existing.isNpc = true;
                                existing.nanoAssistant = true;
                                store.put(existing);
                            }
                        } else if (existing) {
                            store.delete(NANO_ID);
                        }
                    };
                    tx.oncomplete = function () { db.close(); resolve(true); };
                    tx.onerror = function () { db.close(); resolve(false); };
                } catch (e) { try { db.close(); } catch (err) {} resolve(false); }
            });
        }).catch(function () { return false; });
    }
    (function bindNanoToggle() {
        var t = document.getElementById('nanoToggle');
        if (!t) return;
        var on = false;
        try { on = localStorage.getItem('nano_assistant_enabled') === '1'; } catch (e) {}
        t.checked = on;
        if (on) ensureNanoCharacter(true);
        else {
            // localStorage 可能被清空/写满：从 IndexedDB 镜像恢复开关状态
            idbGet('nano_assistant_enabled').then(function (v) {
                if (v === '1') {
                    try { localStorage.setItem('nano_assistant_enabled', '1'); } catch (e) {}
                    t.checked = true;
                    ensureNanoCharacter(true);
                }
            }).catch(function () {});
        }
        var item = document.getElementById('nanoItem');
        if (item) item.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.nano-switch')) return;
            t.click();
        });
        t.addEventListener('change', async function () {
            var v = this.checked;
            // 先真正建/删角色，再落开关：避免删除过程中被聊天页的自愈逻辑又打开
            await ensureNanoCharacter(v);
            var flag = v ? '1' : '0';
            var persisted = false;
            try { localStorage.setItem('nano_assistant_enabled', flag); persisted = localStorage.getItem('nano_assistant_enabled') === flag; } catch (e) {}
            try { idbSet('nano_assistant_enabled', flag); } catch (e) {}
            if (!persisted) { try { showToast('浏览器存储已满，已用另一份存储记住设置'); } catch (e) {} }
            try { if (window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
            showToast(v ? '纳米助手已开启，去聊天列表找她' : '纳米助手已关闭');
        });
    })();


    document.querySelectorAll('.list-item').forEach(function(item) {
        item.addEventListener('click', function() {
            var page = this.dataset.page;
            if (page) {
                if (window.parent !== window) {
                    window.parent.postMessage({
                        type: 'openFullscreen',
                        url: page + '.html',
                        title: '',
                        source: 'more',
                        showBack: false
                    }, '*');
                } else {
                    window.location.href = page + '.html';
                }
            }
        });
    });

    // ===== 其他：保活 / 通知 =====
    var otherItem = document.getElementById('otherItem');
    var otherPanel = document.getElementById('otherPanel');
    var otherChevron = document.getElementById('otherChevron');
    if (otherItem) {
        otherItem.addEventListener('click', function() {
            var open = otherPanel.classList.toggle('open');
            if (otherChevron) otherChevron.classList.toggle('open', open);
        });
    }

    var KEEP_KEY = 'nano_keep_alive';
    var NOTIFY_KEY = 'nano_notify_enabled';
    var keepToggle = document.getElementById('keepAliveToggle');
    var notifyToggle = document.getElementById('notifyToggle');
    var _wakeLock = null;

    function applyKeepAlive(on) {
        try { localStorage.setItem(KEEP_KEY, on ? '1' : '0'); } catch (e) {}
        try { if (window.parent !== window) window.parent.postMessage({ type: 'keepAlive', enabled: !!on }, '*'); } catch (e) {}
        if (on && navigator.wakeLock && navigator.wakeLock.request) {
            navigator.wakeLock.request('screen').then(function(s) { _wakeLock = s; }).catch(function() {});
        } else if (_wakeLock) {
            try { _wakeLock.release(); } catch (e) {}
            _wakeLock = null;
        }
    }

    function applyNotify(on) {
        try { localStorage.setItem(NOTIFY_KEY, on ? '1' : '0'); } catch (e) {}
        try { if (window.parent !== window) window.parent.postMessage({ type: 'notifySetting', enabled: !!on }, '*'); } catch (e) {}
        if (on && 'Notification' in window && Notification.permission === 'default') {
            try { Notification.requestPermission(); } catch (e) {}
        }
    }

    if (keepToggle) {
        keepToggle.checked = (localStorage.getItem(KEEP_KEY) === '1');
        if (keepToggle.checked) applyKeepAlive(true);
        keepToggle.addEventListener('change', function() {
            applyKeepAlive(this.checked);
            showToast(this.checked ? '已开启保活' : '已关闭保活');
        });
    }
    if (notifyToggle) {
        notifyToggle.checked = (localStorage.getItem(NOTIFY_KEY) === '1');
        notifyToggle.addEventListener('change', function() {
            applyNotify(this.checked);
            showToast(this.checked ? '已开启通知' : '已关闭通知');
        });
    }

    // ===== 通知父框架 =====
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'pageLoaded', page: 'more' }, '*');
    }

    // ===== 暴露 API =====
    window.__setUserName = function(name) {
        if (name && name.trim()) {
            saveName(name.trim());
            showToast('名字已更新为: ' + name.trim());
        }
    };

    // ===== 初始化 =====
    loadUserData();

    console.log('[More] 更多页面已加载');
    console.log('[More] 头像使用 IndexedDB 存储，无大小限制');

})();