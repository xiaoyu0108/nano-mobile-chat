// ============================================================
// inner-setting.js - 聊天设置页面逻辑
// ============================================================
(function() {
    'use strict';

    function getQueryParam(name) {
        var urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    var chatId = getQueryParam('chat');
    var chatName = getQueryParam('name');
    var chatAvatar = getQueryParam('avatar');


    if (!chatId || !chatName || !chatAvatar) {
        try {
            var info = JSON.parse(sessionStorage.getItem('inner_setting_info') || 'null');
            if (info) {
                if (!chatId) chatId = info.chatId;
                if (!chatName) chatName = info.name;
                if (!chatAvatar) chatAvatar = info.avatar;
            }
        } catch(e) {}
    }
    chatId = chatId || 'default';
    chatName = chatName || '聊天';
    chatAvatar = chatAvatar || '';

    function getStorageKey(suffix) {
        return 'chat_setting_' + suffix + '_' + chatId;
    }

    function getSetting(key, defaultVal) {
        try {
            var val = localStorage.getItem(getStorageKey(key));
            if (val === null) return defaultVal;
            try { return JSON.parse(val); } catch(e) { return val; }
        } catch(e) { return defaultVal; }
    }

    function setSetting(key, val) {
        try {
            localStorage.setItem(getStorageKey(key), JSON.stringify(val));
        } catch(e) {}
        if (typeof localforage !== 'undefined') {
            localforage.setItem(getStorageKey(key), val).catch(function(err) {});
        }
    }

    // 读取锁脸参考：localStorage 优先，其次回退到 IndexedDB（旧的大图只写进了 IDB）
    function getFaceRefAsync(keyName) {
        keyName = keyName || 'faceRef';
        var local = getSetting(keyName, '');
        if (local) return Promise.resolve(local);
        if (typeof localforage === 'undefined') return Promise.resolve('');
        return localforage.getItem(getStorageKey(keyName)).then(function(v) {
            return v || '';
        }).catch(function() { return ''; });
    }

    // 把参考图压缩到合理尺寸，避免整张手机照片（数 MB）撑爆 localStorage 配额导致保存静默失败
    function compressImageFile(file, maxSize, quality) {
        return new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function(ev) {
                var img = new Image();
                img.onload = function() {
                    try {
                        var w = img.width, h = img.height;
                        var scale = Math.min(1, (maxSize || 640) / Math.max(w, h));
                        var cw = Math.max(1, Math.round(w * scale));
                        var ch = Math.max(1, Math.round(h * scale));
                        var canvas = document.createElement('canvas');
                        canvas.width = cw; canvas.height = ch;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, cw, ch);
                        resolve(canvas.toDataURL('image/jpeg', quality || 0.82));
                    } catch (e) { resolve(ev.target.result); }
                };
                img.onerror = function() { resolve(ev.target.result); };
                img.src = ev.target.result;
            };
            reader.onerror = function() { resolve(null); };
            reader.readAsDataURL(file);
        });
    }

    var faceModalTarget = 'faceRef';
    function applyFacePreview(url, target) {
        target = target || 'faceRef';
        var statusEl = target === 'coupleFaceUser' ? document.getElementById('coupleUserFaceStatus')
            : (target === 'coupleFaceChar' ? document.getElementById('coupleCharFaceStatus') : faceStatus);
        if (url) {
            if (statusEl) statusEl.textContent = '已设置';
            facePreviewBox.style.backgroundImage = 'url(' + url + ')';
            facePreviewBox.style.backgroundSize = 'cover';
            facePreviewBox.style.backgroundPosition = 'center';
            facePreviewBox.textContent = '';
        } else {
            if (statusEl) statusEl.textContent = '未设置';
            facePreviewBox.style.backgroundImage = 'none';
            facePreviewBox.textContent = '未上传参考图';
        }
    }

    // ===== DOM 引用 =====
    var displayNickname = document.getElementById('displayNickname');
    var displayUserId = document.getElementById('displayUserId');
    var avatarPlaceholder = document.getElementById('avatarPlaceholder');
    var avatarImage = document.getElementById('avatarImage');

    // ===== 点击信息栏头像 → 从相册换头像，并同步到聊天列表 / 聊天内页 =====
    (function setupAvatarChange() {
        var avatarEl = document.getElementById('profileAvatar');
        if (!avatarEl) return;
        var picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/*';
        picker.style.display = 'none';
        document.body.appendChild(picker);
        avatarEl.style.cursor = 'pointer';
        avatarEl.addEventListener('click', function () { picker.value = ''; picker.click(); });
        picker.addEventListener('change', function () {
            var file = this.files && this.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                compressTo(ev.target.result, 512, 0.85, function (dataUrl) { saveCharacterAvatar(dataUrl); });
            };
            reader.readAsDataURL(file);
        });
        function compressTo(dataUrl, max, q, cb) {
            var img = new Image();
            img.onload = function () {
                try {
                    var w = img.width, h = img.height;
                    if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
                    else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
                    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                    cv.getContext('2d').drawImage(img, 0, 0, w, h);
                    cb(cv.toDataURL('image/jpeg', q));
                } catch (e) { cb(dataUrl); }
            };
            img.onerror = function () { cb(dataUrl); };
            img.src = dataUrl;
        }
        function saveCharacterAvatar(dataUrl) {
            // 同步当前 UI
            chatAvatar = dataUrl;
            avatarImage.src = dataUrl;
            avatarImage.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
            // 写入角色库
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var tx = db.transaction('characters', 'readwrite');
                        var st = tx.objectStore('characters');
                        var g = st.get(chatId);
                        g.onsuccess = function () {
                            var c = g.result || { id: chatId, name: chatName || '角色' };
                            c.avatar = dataUrl;
                            st.put(c);
                        };
                        tx.oncomplete = function () { try { db.close(); } catch (e2) {} };
                    } catch (err) { try { db.close(); } catch (e2) {} }
                };
            } catch (e) {}
            // 通知外壳：聊天列表与聊天内页实时换头像
            try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'nanoCharUpdated', chatId: chatId, name: chatName, avatar: dataUrl }, '*'); } catch (e) {}
        }
    })();

    // ===== 信息栏头像下方的「微信号」：显示角色的微信号，可点击修改 =====
    var chatWechat = '';
    function defaultWechat(id) {
        var h = 0, s = String(id || '');
        for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
        return 'wxid_' + h.toString(36);
    }
    function loadCharWechat(cb) {
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
            req.onsuccess = function (e) {
                var db = e.target.result;
                try {
                    var g = db.transaction('characters', 'readonly').objectStore('characters').get(chatId);
                    g.onsuccess = function () { cb && cb((g.result && g.result.wechat) || ''); try { db.close(); } catch (e2) {} };
                    g.onerror = function () { cb && cb(''); try { db.close(); } catch (e2) {} };
                } catch (err) { cb && cb(''); try { db.close(); } catch (e2) {} }
            };
            req.onerror = function () { cb && cb(''); };
        } catch (e) { cb && cb(''); }
    }
    function saveCharWechat(v) {
        v = String(v || '').trim().slice(0, 40);
        if (!v) return;
        chatWechat = v;
        if (displayUserId) { displayUserId.textContent = '微信号：' + v; displayUserId.dataset.wechat = v; }
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
            req.onsuccess = function (e) {
                var db = e.target.result;
                try {
                    var tx = db.transaction('characters', 'readwrite');
                    var st = tx.objectStore('characters');
                    var g = st.get(chatId);
                    g.onsuccess = function () { var c = g.result || { id: chatId, name: chatName || '角色' }; c.wechat = v; st.put(c); };
                    tx.oncomplete = function () { try { db.close(); } catch (e2) {} };
                } catch (err) { try { db.close(); } catch (e2) {} }
            };
        } catch (e) {}
        try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'nanoCharUpdated', chatId: chatId, name: chatName, wechat: v }, '*'); } catch (e) {}
    }
    (function setupWechatEdit() {
        var el = document.getElementById('displayUserId');
        if (!el) return;
        el.style.cursor = 'pointer';
        el.title = '点一下可修改 TA 的微信号';
        el.addEventListener('click', function () {
            var cur = el.dataset.wechat || chatWechat || '';
            var v = window.prompt('修改 TA 的微信号（角色自己也可能改）', cur);
            if (v === null) return;
            v = String(v).trim().slice(0, 40);
            if (v) saveCharWechat(v);
        });
    })();

    var remarkPreview = document.getElementById('remarkPreview');
    var remarkInput = document.getElementById('remarkInput');
    var remarkModal = document.getElementById('remarkModal');
    var remarkCancel = document.getElementById('remarkCancel');
    var remarkConfirm = document.getElementById('remarkConfirm');

    var cotPreview = document.getElementById('cotPreview');
    var cotInput = document.getElementById('cotInput');
    var cotModal = document.getElementById('cotModal');
    var cotCancel = document.getElementById('cotCancel');
    var cotConfirm = document.getElementById('cotConfirm');

    var bgDisplay = document.getElementById('bgDisplay');
    var bgPreviewBox = document.getElementById('bgPreviewBox');
    var bgModal = document.getElementById('bgModal');
    var bgUpload = document.getElementById('bgUpload');
    var bgCancel = document.getElementById('bgCancel');
    var bgConfirm = document.getElementById('bgConfirm');
    var bgReset = document.getElementById('bgReset');

    var timeToggle = document.getElementById('timeToggle');
    var timeStatus = document.getElementById('timeStatus');

    var voicePreview = document.getElementById('voicePreview');
    var voiceModal = document.getElementById('voiceModal');
    var voicePresetSelect = document.getElementById('voicePresetSelect');
    var voiceConfirm = document.getElementById('voiceConfirm');
    var voiceCancel = document.getElementById('voiceCancel');
    var ttsEnableToggle = document.getElementById('ttsEnableToggle');
    var ttsEnableStatus = document.getElementById('ttsEnableStatus');

    var searchInput = document.getElementById('searchInput');
    var searchResults = document.getElementById('searchResults');
    var searchModal = document.getElementById('searchModal');
    var searchClose = document.getElementById('searchClose');

    var promptStatus = document.getElementById('promptStatus');
    var promptInput = document.getElementById('promptInput');
    var promptModal = document.getElementById('promptModal');
    var promptCancel = document.getElementById('promptCancel');
    var promptConfirm = document.getElementById('promptConfirm');

    var faceStatus = document.getElementById('faceStatus');
    var facePreviewBox = document.getElementById('facePreviewBox');
    var faceModal = document.getElementById('faceModal');
    var faceUpload = document.getElementById('faceUpload');
    var faceCancel = document.getElementById('faceCancel');
    var faceConfirm = document.getElementById('faceConfirm');

    var clearModal = document.getElementById('clearModal');
    var clearCancel = document.getElementById('clearCancel');
    var clearConfirm = document.getElementById('clearConfirm');

    // ===== 主动功能 =====
    var autoMsgToggle = document.getElementById('autoMsgToggle');
    var autoMsgStatus = document.getElementById('autoMsgStatus');
    var autoMsgIntervalItem = document.getElementById('autoMsgIntervalItem');
    var autoMsgInterval = document.getElementById('autoMsgInterval');

    var autoMomentToggle = document.getElementById('autoMomentToggle');
    var autoMomentStatus = document.getElementById('autoMomentStatus');
    var autoMomentIntervalItem = document.getElementById('autoMomentIntervalItem');
    var autoMomentInterval = document.getElementById('autoMomentInterval');

    var allowImageToggle = document.getElementById('allowImageToggle');
    var allowImageStatus = document.getElementById('allowImageStatus');

    var allowMomentImageToggle = document.getElementById('allowMomentImageToggle');
    var allowMomentImageStatus = document.getElementById('allowMomentImageStatus');
    var momentImageFreqItem = document.getElementById('momentImageFreqItem');
    var momentImageFreq = document.getElementById('momentImageFreq');
    var voiceFreq = document.getElementById('voiceFreq');
    var actionNarrationToggle = document.getElementById('actionNarrationToggle');
    var actionNarrationStatus = document.getElementById('actionNarrationStatus');
    var cotToggle = document.getElementById('cotToggle');
    var cotToggleStatus = document.getElementById('cotToggleStatus');
    var cotItemEl = document.getElementById('cotItem');
    var forceTranslateToggle = document.getElementById('forceTranslateToggle');
    var forceTranslateStatus = document.getElementById('forceTranslateStatus');
    var forceTranslateLangItem = document.getElementById('forceTranslateLangItem');
    var forceTranslateLang = document.getElementById('forceTranslateLang');
    function applyCotItemState(on) {
        if (!cotItemEl) return;
        cotItemEl.style.opacity = on ? '' : '0.45';
        cotItemEl.style.pointerEvents = on ? '' : 'none';
    }
    var altProbeToggle = document.getElementById('altProbeToggle');
    var altProbeStatus = document.getElementById('altProbeStatus');
    var autoSocialToggle = document.getElementById('autoSocialToggle');
    var autoSocialStatus = document.getElementById('autoSocialStatus');

    // ===== 加载信息 =====
    function loadInfo() {
        var remark = getSetting('remark', '');
        if (remark) {
            displayNickname.textContent = remark;
            remarkPreview.textContent = remark;
        } else {
            displayNickname.textContent = chatName || '未知';
            remarkPreview.textContent = '未设置';
        }

        var initWx = chatWechat || defaultWechat(chatId);
        displayUserId.textContent = '微信号：' + initWx;
        displayUserId.dataset.wechat = initWx;
        loadCharWechat(function (wx) {
            if (wx) {
                chatWechat = wx;
                displayUserId.textContent = '微信号：' + wx;
                displayUserId.dataset.wechat = wx;
            }
        });

        var cotVal = getSetting('cotPrompt', '');
        cotPreview.textContent = cotVal ? (cotVal.length > 8 ? cotVal.slice(0, 8) + '…' : cotVal) : '未设置';

        if (chatAvatar && chatAvatar.trim() !== '') {
            avatarImage.src = chatAvatar;
            avatarImage.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
        } else {
            avatarImage.style.display = 'none';
            avatarPlaceholder.style.display = 'flex';
            avatarPlaceholder.textContent = chatName ? chatName.charAt(0).toUpperCase() : '?';
        }

        var timeAware = getSetting('timeAware', true);
        timeToggle.checked = timeAware;
        timeStatus.textContent = timeAware ? '开启' : '关闭';

        var voiceSaved = getSetting('ttsPreset', '');
        if (voicePreview) voicePreview.textContent = voiceSaved ? voiceSaved : '跟随全局';
        var ttsOn = getSetting('ttsEnabled', false) !== false;
        if (ttsEnableToggle) ttsEnableToggle.checked = ttsOn;
        if (ttsEnableStatus) ttsEnableStatus.textContent = ttsOn ? '开启' : '关闭';
        (function () {
            var vi = document.getElementById('voiceItem');
            if (vi) vi.style.opacity = ttsOn ? '' : '0.55';
        })();

        loadBackground();

        var prompt = getSetting('imagePrompt', '');
        promptStatus.textContent = prompt ? shortPromptText(prompt) : '未设置';

        getFaceRefAsync().then(function(label) {
            applyFacePreview(label);
        });
        getFaceRefAsync('coupleFaceUser').then(function (u) {
            var el = document.getElementById('coupleUserFaceStatus');
            if (el) el.textContent = u ? '已设置' : '未设置';
        });
        getFaceRefAsync('coupleFaceChar').then(function (c) {
            var el = document.getElementById('coupleCharFaceStatus');
            if (el) el.textContent = c ? '已设置' : '未设置';
        });
        var coupleFaceModeEl = document.getElementById('coupleFaceMode');
        if (coupleFaceModeEl) {
            coupleFaceModeEl.value = String(getSetting('coupleFaceMode', 'none') || 'none');
            coupleFaceModeEl.addEventListener('change', function () {
                setSetting('coupleFaceMode', this.value || 'none');
            });
        }

        var rmt = document.getElementById('replyMaxTokens');
        if (rmt) {
            var rmtVal = parseInt(getSetting('replyMaxTokens', 0), 10) || 0;
            rmt.value = rmtVal > 0 ? rmtVal : '';
            rmt.addEventListener('change', function() {
                var v = parseInt(rmt.value, 10);
                setSetting('replyMaxTokens', (v > 0 ? v : 0));
            });
        }

        var autoMsg = getSetting('autoMsg', false);
        autoMsgToggle.checked = autoMsg;
        autoMsgStatus.textContent = autoMsg ? '开启' : '关闭';
        autoMsgIntervalItem.style.display = autoMsg ? 'flex' : 'none';
        var autoMsgIntervalVal = getSetting('autoMsgInterval', 8);
        autoMsgInterval.value = autoMsgIntervalVal;

        var autoMoment = getSetting('autoMoment', false);
        autoMomentToggle.checked = autoMoment;
        autoMomentStatus.textContent = autoMoment ? '开启' : '关闭';
        autoMomentIntervalItem.style.display = autoMoment ? 'flex' : 'none';
        var autoMomentIntervalVal = getSetting('autoMomentInterval', 12);
        autoMomentInterval.value = autoMomentIntervalVal;

        var allowImage = getSetting('allowImage', false);
        allowImageToggle.checked = allowImage;
        allowImageStatus.textContent = allowImage ? '开启' : '关闭';

        var allowMomentImage = getSetting('allowMomentImage', false);
        if (allowMomentImageToggle) {
            allowMomentImageToggle.checked = allowMomentImage;
            allowMomentImageStatus.textContent = allowMomentImage ? '开启' : '关闭';
        }
        if (momentImageFreq) momentImageFreq.value = getSetting('momentImageFreq', 'medium');
        if (momentImageFreqItem) momentImageFreqItem.style.display = allowMomentImage ? 'flex' : 'none';

        if (voiceFreq) voiceFreq.value = getSetting('voiceFreq', 'medium');
        var actionNarration = getSetting('actionNarration', false);
        if (actionNarrationToggle) {
            actionNarrationToggle.checked = actionNarration;
            actionNarrationStatus.textContent = actionNarration ? '开启' : '关闭';
        }
        // 思维链开关：兼容旧设置（以前只要填了预设就等于开启）
        var cotSaved = getSetting('cotEnabled', null);
        var cotEnabled = (cotSaved === null || cotSaved === undefined) ? !!getSetting('cotPrompt', '') : !!cotSaved;
        if (cotToggle) {
            cotToggle.checked = cotEnabled;
            if (cotToggleStatus) cotToggleStatus.textContent = cotEnabled ? '开启' : '关闭';
        }
        applyCotItemState(cotEnabled);
        var altProbe = getSetting('altProbe', false);
        if (altProbeToggle) {
            altProbeToggle.checked = altProbe;
            altProbeStatus.textContent = altProbe ? '开启' : '关闭';
        }
        var autoSocial = getSetting('autoSocial', false);
        if (autoSocialToggle) {
            autoSocialToggle.checked = autoSocial;
            autoSocialStatus.textContent = autoSocial ? '开启' : '关闭';
        }
    }

    function loadBackground() {
        var bgType = getSetting('bgType', 'color');
        var bgColor = getSetting('bgColor', '#ffffff');
        var bgImage = getSetting('bgImage', '');

        function renderBg(img) {
            if (bgType === 'image' && img) {
                bgDisplay.textContent = '自定义图片';
                bgPreviewBox.style.backgroundImage = 'url(' + img + ')';
                bgPreviewBox.style.backgroundSize = 'cover';
                bgPreviewBox.style.backgroundPosition = 'center';
                bgPreviewBox.textContent = '';
            } else {
                bgDisplay.textContent = bgColor === '#ffffff' ? '默认' : '颜色';
                bgPreviewBox.style.backgroundImage = 'none';
                bgPreviewBox.style.backgroundColor = bgColor || '#ffffff';
                bgPreviewBox.textContent = '无预览';
            }
        }

        if (!bgImage && typeof localforage !== 'undefined') {
            localforage.getItem(getStorageKey('bgImage')).then(function(img) {
                renderBg(img || bgImage);
            }).catch(function() { renderBg(bgImage); });
        } else {
            renderBg(bgImage);
        }
    }

    // ===== 思维链预设（COT） =====
    var COT_PRESETS_KEY = 'nano_cot_presets';
    var cotPresetSelect = document.getElementById('cotPresetSelect');
    var cotPresetName = document.getElementById('cotPresetName');
    var cotPresetSave = document.getElementById('cotPresetSave');
    var cotPresetUpdate = document.getElementById('cotPresetUpdate');
    var cotPresetDelete = document.getElementById('cotPresetDelete');
    var cotImportFile = document.getElementById('cotImportFile');
    var cotImportName = document.getElementById('cotImportName');

    function readCotPresets() {
        try {
            var raw = localStorage.getItem(COT_PRESETS_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.filter(function(p){ return p && p.name; }) : [];
        } catch(e) { return []; }
    }
    function writeCotPresets(arr) {
        try { localStorage.setItem(COT_PRESETS_KEY, JSON.stringify((arr || []).slice(0, 200))); } catch(e) {}
    }
    function populateCotPresets() {
        if (!cotPresetSelect) return;
        var presets = readCotPresets();
        cotPresetSelect.innerHTML = '<option value="">-- 选择预设 --</option>' +
            presets.map(function(p, i){ return '<option value="' + i + '">' + String(p.name).replace(/</g,'&lt;') + '</option>'; }).join('');
    }
    function applyPreview(val) {
        cotPreview.textContent = val ? (val.length > 8 ? val.slice(0, 8) + '…' : val) : '未设置';
    }
    function updateCotPreview() { applyPreview(getSetting('cotPrompt', '')); }

    function openCotModal() {
        cotInput.value = getSetting('cotPrompt', '') || '';
        populateCotPresets();
        cotPresetName.value = '';
        if (cotImportName) cotImportName.textContent = '';
        cotModal.classList.add('active');
        setTimeout(function() { cotInput.focus(); }, 150);
    }

    function saveCot() {
        var val = cotInput.value.trim();
        setSetting('cotPrompt', val);
        applyPreview(val);
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'cotChanged', chatId: chatId, cotPrompt: val }, '*');
        }
        cotModal.classList.remove('active');
    }

    if (cotPresetSave) {
        cotPresetSave.addEventListener('click', function() {
            var name = cotPresetName.value.trim();
            if (!name) { alert('请输入预设名称'); return; }
            var arr = readCotPresets();
            arr.push({ name: name, content: cotInput.value.trim() });
            writeCotPresets(arr);
            populateCotPresets();
            cotPresetSelect.value = String(arr.length - 1);
            alert('预设已保存');
        });
    }
    if (cotPresetUpdate) {
        cotPresetUpdate.addEventListener('click', function() {
            var idx = cotPresetSelect.value;
            if (idx === '') { alert('请先选择一个预设'); return; }
            var name = cotPresetName.value.trim();
            if (!name) { alert('请输入预设名称'); return; }
            var arr = readCotPresets();
            arr[parseInt(idx)] = { name: name, content: cotInput.value.trim() };
            writeCotPresets(arr);
            populateCotPresets();
            cotPresetSelect.value = idx;
            alert('预设已更新');
        });
    }
    if (cotPresetDelete) {
        cotPresetDelete.addEventListener('click', function() {
            var idx = cotPresetSelect.value;
            if (idx === '') { alert('请先选择一个预设'); return; }
            if (!confirm('删除此思维链预设？')) return;
            var arr = readCotPresets();
            arr.splice(parseInt(idx), 1);
            writeCotPresets(arr);
            populateCotPresets();
            cotPresetName.value = '';
            alert('已删除');
        });
    }
    if (cotPresetSelect) {
        cotPresetSelect.addEventListener('change', function() {
            var idx = this.value;
            if (idx === '') { cotPresetName.value = ''; return; }
            var p = readCotPresets()[parseInt(idx)];
            if (!p) return;
            cotInput.value = p.content || '';
            cotPresetName.value = p.name || '';
        });
    }
    function loadMammoth() {
        if (window.mammoth) return Promise.resolve();
        return new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    if (cotImportFile) {
        cotImportFile.addEventListener('change', async function(e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            var name = (file.name || '').toLowerCase();
            try {
                if (name.endsWith('.json')) {
                    var txt = await file.text();
                    var data = null;
                    try { data = JSON.parse(txt); } catch(err) { alert('JSON 解析失败'); return; }
                    var incoming = [];
                    if (Array.isArray(data)) incoming = data;
                    else if (data && Array.isArray(data.presets)) incoming = data.presets;
                    else if (data && data.content) incoming = [data];
                    var arr = readCotPresets();
                    var added = 0;
                    incoming.forEach(function(p) {
                        if (!p) return;
                        var nm = String(p.name || p.title || '').trim();
                        var ct = String(p.content || p.prompt || p.text || '').trim();
                        if (!ct) return;
                        if (!nm) nm = '导入预设 ' + (arr.length + 1);
                        arr.push({ name: nm, content: ct });
                        added++;
                    });
                    writeCotPresets(arr);
                    populateCotPresets();
                    if (added) { cotPresetSelect.value = String(arr.length - 1); cotInput.value = arr[arr.length - 1].content; cotPresetName.value = arr[arr.length - 1].name; }
                    if (cotImportName) cotImportName.textContent = file.name + '（' + added + ' 条）';
                } else if (name.endsWith('.txt')) {
                    var text = await file.text();
                    cotInput.value = text;
                    if (cotImportName) cotImportName.textContent = file.name;
                } else if (name.endsWith('.docx')) {
                    await loadMammoth();
                    var buf = await file.arrayBuffer();
                    var result = await window.mammoth.extractRawText({ arrayBuffer: buf });
                    cotInput.value = (result && result.value) || '';
                    if (cotImportName) cotImportName.textContent = file.name;
                } else {
                    alert('不支持的文件类型');
                }
            } catch (err) {
                console.error(err);
                alert('导入失败');
            }
            cotImportFile.value = '';
        });
    }

    // ===== 备注 =====
    function openRemarkModal() {
        var current = getSetting('remark', '');
        remarkInput.value = current || '';
        remarkModal.classList.add('active');
        setTimeout(function() { remarkInput.focus(); }, 150);
    }

    function saveRemark() {
        var val = remarkInput.value.trim();
        setSetting('remark', val);
        if (val) {
            remarkPreview.textContent = val;
            displayNickname.textContent = val;
        } else {
            remarkPreview.textContent = '未设置';
            displayNickname.textContent = chatName || '未知';
        }
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'remarkChanged',
                chatId: chatId,
                remark: val
            }, '*');
        }
        remarkModal.classList.remove('active');
    }

    // ===== 背景 =====
    function openBgModal() {
        bgModal.classList.add('active');
        // 加载当前背景到预览
        var bgImage = getSetting('bgImage', '');
        var bgColor = getSetting('bgColor', '#ffffff');
        var bgType = getSetting('bgType', 'color');
        if (bgType === 'image' && bgImage) {
            bgPreviewBox.style.backgroundImage = 'url(' + bgImage + ')';
            bgPreviewBox.style.backgroundSize = 'cover';
            bgPreviewBox.style.backgroundPosition = 'center';
            bgPreviewBox.textContent = '';
        } else {
            bgPreviewBox.style.backgroundImage = 'none';
            bgPreviewBox.style.backgroundColor = bgColor || '#ffffff';
            bgPreviewBox.textContent = '无预览';
        }
    }

    function saveBackground() {
        var bgImage = bgPreviewBox.style.backgroundImage;
        if (bgImage && bgImage !== 'none' && bgImage !== '') {
            var url = bgImage.replace(/url\(["']?([^"')]+)["']?\)/, '$1');
            if (url && url.startsWith('data:image')) {
                setSetting('bgType', 'image');
                setSetting('bgImage', url);
                bgDisplay.textContent = '自定义图片';
            }
        } else {
            var color = bgPreviewBox.style.backgroundColor || '#ffffff';
            setSetting('bgType', 'color');
            setSetting('bgColor', color);
            if (typeof localforage !== 'undefined') {
                localforage.removeItem(getStorageKey('bgImage')).catch(function(err) {});
            }
            bgDisplay.textContent = color === '#ffffff' ? '默认' : '颜色';
        }
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'backgroundChanged',
                chatId: chatId,
                bgType: getSetting('bgType', 'color'),
                bgColor: getSetting('bgColor', '#ffffff'),
                bgImage: getSetting('bgImage', '')
            }, '*');
        }
        bgModal.classList.remove('active');
    }

    function resetBackground() {
        setSetting('bgType', 'color');
        setSetting('bgColor', '#ffffff');
        if (typeof localforage !== 'undefined') {
            localforage.removeItem(getStorageKey('bgImage')).catch(function(err) {});
        }
        bgDisplay.textContent = '默认';
        bgPreviewBox.style.backgroundImage = 'none';
        bgPreviewBox.style.backgroundColor = '#ffffff';
        bgPreviewBox.textContent = '无预览';
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'backgroundChanged',
                chatId: chatId,
                bgType: 'color',
                bgColor: '#ffffff',
                bgImage: ''
            }, '*');
        }
        bgModal.classList.remove('active');
    }

    // ===== 搜索 =====
    function openSearchModal() {
        searchInput.value = '';
        searchResults.innerHTML = '输入关键词以搜索';
        searchModal.classList.add('active');
        setTimeout(function() { searchInput.focus(); }, 150);
    }

    var searchTimer = null;
    function performSearch() {
        var val = searchInput.value.trim();
        clearTimeout(searchTimer);
        if (!val) {
            searchResults.innerHTML = '输入关键词以搜索';
            return;
        }
        searchTimer = setTimeout(function() {
            try {
                var key = 'chat_messages_' + chatId;
                var messages = [];
                var data = localStorage.getItem(key);
                if (data) {
                    messages = JSON.parse(data);
                }
                if (typeof localforage !== 'undefined') {
                    localforage.getItem(key).then(function(data) {
                        if (data && Array.isArray(data)) {
                            renderSearchResults(data, val);
                        } else if (messages.length > 0) {
                            renderSearchResults(messages, val);
                        } else {
                            searchResults.innerHTML = '没有找到聊天记录';
                        }
                    }).catch(function() {
                        if (messages.length > 0) {
                            renderSearchResults(messages, val);
                        } else {
                            searchResults.innerHTML = '没有找到聊天记录';
                        }
                    });
                } else if (messages.length > 0) {
                    renderSearchResults(messages, val);
                } else {
                    searchResults.innerHTML = '没有找到聊天记录';
                }
            } catch(e) {
                searchResults.innerHTML = '搜索失败，请重试';
            }
        }, 300);
    }

    function renderSearchResults(messages, keyword) {
        var results = messages.filter(function(m) {
            return m.text && m.text.toLowerCase().includes(keyword.toLowerCase());
        });

        if (results.length === 0) {
            searchResults.innerHTML = '没有找到匹配的消息';
            return;
        }

        var html = '';
        results.slice(0, 20).forEach(function(m) {
            var highlighted = m.text.replace(
                new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                function(match) { return '<strong style="color:#007AFF;">' + match + '</strong>'; }
            );
            var sender = m.type === 'left' ? '对方' : '我';
            html += '<div style="padding:10px;border-bottom:0.5px solid #E5E5EA;text-align:left;font-size:14px;cursor:pointer;" data-msgid="' + m.id + '">' +
                sender + '：' + highlighted +
                '<div style="font-size:11px;color:#8E8E93;margin-top:2px;">' + (m.time || '') + '</div>' +
                '</div>';
        });
        searchResults.innerHTML = html;

        searchResults.querySelectorAll('[data-msgid]').forEach(function(el) {
            el.addEventListener('click', function() {
                var msgId = this.dataset.msgid;
                if (window.parent !== window) {
                    window.parent.postMessage({
                        type: 'jumpToMessage',
                        chatId: chatId,
                        msgId: msgId
                    }, '*');
                }
                searchModal.classList.remove('active');
            });
        });
    }

    // ===== 清空 =====
    function openClearModal() {
        clearModal.classList.add('active');
    }

    // 清空记录时，连同该聊天的记忆一起清掉，避免“记录没了记忆还在”
    function clearChatMemories(cid) {
        try {
            if (!('indexedDB' in window)) return;
            var req = indexedDB.open('nano_vector_memory_db', 5);
            req.onupgradeneeded = function(e) {
                try { var d = e.target.result; if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' }); } catch(err) {}
            };
            req.onsuccess = function(e) {
                try {
                    var db = e.target.result;
                    db.transaction('config', 'readwrite').objectStore('config').put({ key: 'memlist_' + cid, value: [] });
                } catch(err) {}
            };
        } catch(e) {}
    }

    function confirmClear() {
        var key = 'chat_messages_' + chatId;
        try { localStorage.setItem('chat_cleared_' + chatId, '1'); } catch(e) {}
        clearChatMemories(chatId);
        if (typeof localforage !== 'undefined') {
            localforage.setItem(key, []).then(function() {
                if (window.parent !== window) {
                    window.parent.postMessage({
                        type: 'messagesCleared',
                        chatId: chatId
                    }, '*');
                }
            }).catch(function() {});
        } else {
            localStorage.setItem(key, JSON.stringify([]));
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'messagesCleared',
                    chatId: chatId
                }, '*');
            }
        }
        clearModal.classList.remove('active');
    }

    // ===== 生图提示词 =====
    function shortPromptText(s) {
        s = String(s || '').replace(/\s+/g, ' ').trim();
        return s.length > 8 ? (s.slice(0, 8) + '…') : s;
    }
    function openPromptModal() {
        var current = getSetting('imagePrompt', '');
        promptInput.value = current || '';
        promptModal.classList.add('active');
        setTimeout(function() { promptInput.focus(); }, 150);
    }

    function savePrompt() {
        var val = promptInput.value.trim();
        setSetting('imagePrompt', val);
        promptStatus.textContent = val ? shortPromptText(val) : '未设置';
        promptModal.classList.remove('active');
    }

    // ===== 锁脸 =====
    function openFaceModal(target) {
        faceModalTarget = target || 'faceRef';
        var title = document.querySelector('#faceModal .modal-title');
        if (title) title.textContent = faceModalTarget === 'coupleFaceUser' ? '上传我的合照参考' :
            (faceModalTarget === 'coupleFaceChar' ? '上传 TA 的合照参考' : '上传锁脸参考');
        // 每次打开都从存储里回填，避免页面上预览为空时误把已保存的参考图清掉
        getFaceRefAsync(faceModalTarget).then(function(url) {
            applyFacePreview(url, faceModalTarget);
            faceModal.classList.add('active');
        });
    }

    function saveFace() {
        var bgImage = facePreviewBox.style.backgroundImage;
        if (bgImage && bgImage !== 'none' && bgImage !== '') {
            var url = bgImage.replace(/url\(["']?([^"')]+)["']?\)/, '$1');
            if (url && url.startsWith('data:image')) {
                setSetting(faceModalTarget, url);
                applyFacePreview(url, faceModalTarget);
            }
        } else {
            // 预览为空不代表要删除：可能只是还没回填，保持原值不动
            getFaceRefAsync(faceModalTarget).then(function(existing) {
                applyFacePreview(existing, faceModalTarget);
            });
        }
        faceModal.classList.remove('active');
    }

    // ===== 主动发消息 =====
    function toggleAutoMsg() {
        var enabled = autoMsgToggle.checked;
        setSetting('autoMsg', enabled);
        autoMsgStatus.textContent = enabled ? '开启' : '关闭';
        autoMsgIntervalItem.style.display = enabled ? 'flex' : 'none';
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'autoMsgChanged',
                chatId: chatId,
                enabled: enabled,
                interval: parseInt(autoMsgInterval.value)
            }, '*');
        }
    }

    function changeAutoMsgInterval() {
        var val = parseInt(autoMsgInterval.value);
        setSetting('autoMsgInterval', val);
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'autoMsgIntervalChanged',
                chatId: chatId,
                interval: val
            }, '*');
        }
    }

    // ===== 主动发朋友圈 =====
    function toggleAutoMoment() {
        var enabled = autoMomentToggle.checked;
        setSetting('autoMoment', enabled);
        autoMomentStatus.textContent = enabled ? '开启' : '关闭';
        autoMomentIntervalItem.style.display = enabled ? 'flex' : 'none';
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'autoMomentChanged',
                chatId: chatId,
                enabled: enabled,
                interval: parseInt(autoMomentInterval.value)
            }, '*');
        }
    }

    function changeAutoMomentInterval() {
        var val = parseInt(autoMomentInterval.value);
        setSetting('autoMomentInterval', val);
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'autoMomentIntervalChanged',
                chatId: chatId,
                interval: val
            }, '*');
        }
    }

    // ===== 允许生图 =====
    function toggleAllowImage() {
        var enabled = allowImageToggle.checked;
        setSetting('allowImage', enabled);
        allowImageStatus.textContent = enabled ? '开启' : '关闭';
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'allowImageChanged',
                chatId: chatId,
                enabled: enabled
            }, '*');
        }
    }

    // ===== 允许朋友圈生图 =====
    function toggleAllowMomentImage() {
        if (!allowMomentImageToggle) return;
        var enabled = allowMomentImageToggle.checked;
        setSetting('allowMomentImage', enabled);
        allowMomentImageStatus.textContent = enabled ? '开启' : '关闭';
        if (momentImageFreqItem) momentImageFreqItem.style.display = enabled ? 'flex' : 'none';
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'allowMomentImageChanged',
                chatId: chatId,
                enabled: enabled
            }, '*');
        }
    }

    // ===== 拉黑 / 取消拉黑（用户拉黑角色；角色也能拉黑用户）=====
    var blockItem = document.getElementById('blockItem');
    var unblockItem = document.getElementById('unblockItem');
    var blockStatus = document.getElementById('blockStatus');
    var unblockStatus = document.getElementById('unblockStatus');
    var charBlockItem = document.getElementById('charBlockItem');
    var lastCharRec = null;
    function postToParent(type, extra) {
        var m = { type: type, chatId: chatId };
        if (extra) { for (var k in extra) { m[k] = extra[k]; } }
        try { if (window.parent !== window) window.parent.postMessage(m, '*'); } catch (e) {}
    }
    function applyBlockState() {
        var blocked = !!getSetting('blocked', false);
        var charBlocked = !!getSetting('charBlocked', false);
        if (blockStatus) blockStatus.textContent = blocked ? '已拉黑' : '未拉黑';
        if (unblockStatus) unblockStatus.textContent = blocked ? '点此恢复' : '';
        if (unblockItem) unblockItem.style.opacity = blocked ? '1' : '.45';
        if (charBlockItem) charBlockItem.style.display = charBlocked ? 'flex' : 'none';
    }
    function doBlock() {
        if (getSetting('blocked', false)) return;
        setSetting('blocked', true);
        if (autoMsgToggle && autoMsgToggle.checked) { autoMsgToggle.checked = false; toggleAutoMsg(); }
        applyBlockState();
        postToParent('nanoBlockChanged', { blocked: true, text: '你已拉黑 TA' });
        showCenterToast('已拉黑 TA');
        contactCharViaIMessage();
    }
    function doUnblock() {
        setSetting('blocked', false);
        try { localStorage.removeItem('chat_setting_blockedContacted_' + chatId); } catch (e) {}
        applyBlockState();
        postToParent('nanoBlockChanged', { blocked: false, text: '已加回好友' });
        appendIMessageSystem('已加回好友');
        showCenterToast('已加回好友');
    }
    // 打开/读取 iMessage 独立消息库
    function openIMDB() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_imessage_db');
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'id' }); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); } catch (err) {} };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { resolve(null); };
                req.onblocked = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }
    // 同步一份到 localStorage，和 iMessage 应用的兜底镜像保持一致（切页不丢消息）
    function mirrorIMChat(c) {
        try {
            localStorage.setItem('nano_imessage_chat_' + c.id, JSON.stringify(c));
            var idx = [];
            try { idx = JSON.parse(localStorage.getItem('nano_imessage_chat_index') || '[]') || []; } catch (e) {}
            if (idx.indexOf(c.id) === -1) { idx.push(c.id); localStorage.setItem('nano_imessage_chat_index', JSON.stringify(idx)); }
        } catch (e) {}
    }
    // 把角色通过 iMessage 发来的消息写进 iMessage 卡片的聊天记录
    function appendIMessage(rec, msgs) {
        if (!msgs || !msgs.length) return Promise.resolve();
        return openIMDB().then(function (db) {
            if (!db) return;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction('chats', 'readwrite');
                    var store = tx.objectStore('chats');
                    var g = store.get('c:' + chatId);
                    g.onsuccess = function () {
                        var c = g.result;
                        if (!c) {
                            c = {
                                id: 'c:' + chatId, kind: 'char', charId: chatId,
                                name: (rec && rec.name) || chatName || '角色',
                                avatar: (rec && rec.avatar) || chatAvatar || '',
                                setting: (rec && (rec.setting || rec.desc || rec.persona)) || '',
                                history: [], preview: '', lastTime: '', sortTime: 0, unread: 0
                            };
                        }
                        c.history = (c.history || []).concat(msgs);
                        var last = c.history[c.history.length - 1];
                        if (last) { c.preview = last.text || ''; c.lastTime = last.time || ''; c.sortTime = last.ts || Date.now(); }
                        c.unread = (c.unread || 0) + msgs.length;
                        store.put(c);
                        mirrorIMChat(c);
                    };
                    tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
                    tx.onerror = function () { try { db.close(); } catch (e) {} resolve(); };
                } catch (e) { try { db.close(); } catch (e2) {} resolve(); }
            });
        });
    }
    function readApiConfig() {
        return new Promise(function(resolve){
            try {
                var req = indexedDB.open('nano_api_db');
                req.onupgradeneeded = function(e){ try{ var d=e.target.result; if(!d.objectStoreNames.contains('api_data')) d.createObjectStore('api_data', { keyPath: 'key' }); }catch(err){} };
                req.onsuccess = function(){
                    try {
                        var db=req.result;
                        var g=db.transaction('api_data','readonly').objectStore('api_data').get('nano_api_config');
                        g.onsuccess=function(){ var rec=g.result; var v=(rec&&rec.value!==undefined)?rec.value:rec; try{db.close();}catch(e){} resolve(v||null); };
                        g.onerror=function(){ try{db.close();}catch(e){} resolve(null); };
                    } catch(e){ resolve(null); }
                };
                req.onerror=function(){ resolve(null); };
            } catch(e){ resolve(null); }
        }).then(function(cfg){
            if(cfg) return cfg;
            try { return JSON.parse(localStorage.getItem('nano_api_config')||'null'); } catch(e){ return null; }
        });
    }
    function readCharRec() {
        return new Promise(function(resolve){
            try {
                var req = indexedDB.open('nano_characters_db',1);
                req.onupgradeneeded=function(e){ try{ var d=e.target.result; if(!d.objectStoreNames.contains('characters')) d.createObjectStore('characters',{keyPath:'id'}); }catch(err){} };
                req.onsuccess=function(){
                    try{
                        var db=req.result;
                        var g=db.transaction('characters','readonly').objectStore('characters').get(chatId);
                        g.onsuccess=function(){ var v=g.result||null; try{db.close();}catch(e){} resolve(v); };
                        g.onerror=function(){ try{db.close();}catch(e){} resolve(null); };
                    }catch(e){ resolve(null); }
                };
                req.onerror=function(){ resolve(null); };
            }catch(e){ resolve(null); }
        });
    }
    function readUserName(){
        try{
            var keys=['nano_mask_data','nano_home_data','peach_home_data'];
            for(var i=0;i<keys.length;i++){
                var raw=localStorage.getItem(keys[i]);
                if(raw){ var d=JSON.parse(raw); if(d&&d.masks){ var m=(d.masks||[]).filter(function(x){return x.id===d.currentMaskId;})[0]; if(m&&m.name) return m.name; } }
            }
        }catch(e){}
        return '用户';
    }
    // 通过外壳代理请求（和线上一致，优于 iframe 内直接 fetch）
    function imPendingAdd(token){
        try{ var l=JSON.parse(localStorage.getItem('nano_imessage_pending')||'[]'); l.push({token:token,kind:'blocking',ts:Date.now()}); localStorage.setItem('nano_imessage_pending',JSON.stringify(l)); }catch(e){}
    }
    function imPendingRemove(token){
        try{ var l=JSON.parse(localStorage.getItem('nano_imessage_pending')||'[]').filter(function(p){return p.token!==token;}); localStorage.setItem('nano_imessage_pending',JSON.stringify(l)); }catch(e){}
    }
    function timeNow(){ var d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
    function showCenterToast(text){
        try{
            var el=document.getElementById('_blockToast');
            if(!el){
                el=document.createElement('div'); el.id='_blockToast';
                el.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:rgba(0,0,0,.78);color:#fff;font-size:14px;line-height:1;padding:12px 18px;border-radius:12px;pointer-events:none;opacity:0;transition:opacity .18s;';
                document.body.appendChild(el);
            }
            el.textContent=text; el.style.opacity='1';
            clearTimeout(el._t); el._t=setTimeout(function(){ el.style.opacity='0'; },1400);
        }catch(e){}
    }
    // 在 iMessage 卡片里插入一条居中系统提示
    function appendIMessageSystem(text){
        return openIMDB().then(function(db){
            if(!db) return;
            return new Promise(function(resolve){
                try{
                    var tx=db.transaction('chats','readwrite'); var store=tx.objectStore('chats');
                    var g=store.get('c:'+chatId);
                    g.onsuccess=function(){
                        var c=g.result;
                        if(!c){ c={id:'c:'+chatId,kind:'char',charId:chatId,name:chatName||'角色',avatar:chatAvatar||'',setting:'',history:[],preview:'',lastTime:'',sortTime:0,unread:0}; }
                        c.history=c.history||[];
                        c.history.push({id:'sys_'+Date.now(),type:'system',text:text,time:timeNow(),ts:Date.now()});
                        c.sortTime=Date.now();
                        store.put(c);
                        mirrorIMChat(c);
                    };
                    tx.oncomplete=function(){try{db.close();}catch(e){}resolve();};
                    tx.onerror=function(){try{db.close();}catch(e){}resolve();};
                }catch(e){try{db.close();}catch(e2){}resolve();}
            });
        });
    }
    function proxyFetch(payload, tokenOverride){
        return new Promise(function(resolve){
            var token=tokenOverride||('blk'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
            var resultKey='chat_api_result_'+token;
            var done=false;
            function finish(d){ if(done)return; done=true; try{localStorage.removeItem(resultKey);}catch(e){} window.removeEventListener('storage',onStorage); window.removeEventListener('message',onMsg); resolve(d); }
            function onStorage(e){ if(e&&e.key===resultKey&&e.newValue){ var o=null; try{o=JSON.parse(e.newValue);}catch(err){} finish(o); } }
            function onMsg(e){ var d=e.data; if(d&&d.type==='chatApiDone'&&d.token===token){ var v=null; try{v=localStorage.getItem(resultKey);}catch(err){} finish(v?JSON.parse(v):null); } }
            window.addEventListener('storage',onStorage); window.addEventListener('message',onMsg);
            if(window.parent!==window){
                try{ window.parent.postMessage({type:'chatApiFetch',token:token,resultKey:resultKey,url:payload.url,method:'POST',headers:payload.headers,body:payload.body},'*'); }
                catch(e){ finish(null); return; }
            } else {
                fetch(payload.url,{method:'POST',headers:payload.headers,body:payload.body}).then(function(r){return r.json();}).then(finish).catch(function(){finish(null);});
                return;
            }
            var n=0; var iv=setInterval(function(){ n++; var v=null; try{v=localStorage.getItem(resultKey);}catch(e){} if(v){ clearInterval(iv); var o=null; try{o=JSON.parse(v);}catch(err){} finish(o); } else if(n>120){ clearInterval(iv); finish(null); } },250);
        });
    }
    function pickContent(d){
        var o=d;
        if(o&&typeof o.text==='string'){ try{o=JSON.parse(o.text);}catch(e){o=null;} }
        return (o&&o.choices&&o.choices[0]&&o.choices[0].message&&o.choices[0].message.content)||'';
    }
    var blockContacting=false;
    // 拉黑后自动调用一次 API，让角色以 iMessage 短信联系用户（写进 iMessage 独立卡片）
    function contactCharViaIMessage(){
        var last=0;
        try{ last=parseInt(localStorage.getItem('chat_setting_blockedContacted_'+chatId)||'0',10)||0; }catch(e){}
        if(blockContacting || Date.now()-last < 60000) return;
        blockContacting=true;
        Promise.all([readApiConfig(), readCharRec()]).then(function(arr){
            var cfg=arr[0], rec=arr[1];
            lastCharRec=rec||lastCharRec;
            if(!cfg||!cfg.mainUrl||!cfg.mainKey||!cfg.mainModel){ blockContacting=false; console.warn('[block] 未配置主 API，无法通过 iMessage 联系'); return; }
            var base=String(cfg.mainUrl).trim();
            if(base.slice(-3)!=='/v1') base=base+(base.slice(-1)==='/'?'v1':'/v1');
            var cName=(rec&&rec.name)||chatName||'角色';
            var setting=(rec&&(rec.setting||rec.desc||rec.persona))||'';
            var user=readUserName();
            var nat=(rec&&rec.nationality)||'';
            var isForeign=nat&&!/中国|中國|china|chinese|华|華|汉|漢|未知|unknown/i.test(nat);
            var sys='你是「'+cName+'」。用户「'+user+'」刚刚在线上聊天里把你拉黑了，你现在无法再在线上给TA发消息，只能通过 iMessage 短信联系TA。'
                +'请以角色本人的性格，给TA发 2 到 4 条很短的 iMessage 消息（每条不超过22字，每条独立一行）。'
                +'内容必须围绕“你被TA拉黑了 / 被冷落了”这件事展开：可以是委屈、质问、解释、挽留或故作镇定，让TA明确感觉到你在意这件事。'
                +'可以提到被拉黑 / 被冷落，但不要说“系统”“AI”“API”等词。'
                +(isForeign?'\n你是外国人：每条消息用「母语||中文翻译」格式，先母语再中文翻译，两边都写完整。':'')
                +(setting?('\n【你本人的人设】\n'+String(setting).slice(0,4000)):'');
            var payload={
                url:base+'/chat/completions',
                headers:{'Authorization':'Bearer '+String(cfg.mainKey).trim(),'Content-Type':'application/json'},
                body:JSON.stringify({model:cfg.mainModel,messages:[{role:'system',content:sys},{role:'user',content:'（给TA发条短信）'}],max_tokens:260,temperature:Number(cfg.mainTemp)||0.85})
            };
            var blkToken='blk'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
            imPendingAdd(blkToken);
            var handled=false;
            function handleContactResult(d){
                if(handled) return; handled=true;
                blockContacting=false;
                imPendingRemove(blkToken);
                var t=pickContent(d);
                var lines=String(t).replace(/\[[^\]]*\]/g,'').split(/\n+/).map(function(s){return s.trim().replace(/^[-*•\d.、\s]+/,'');}).filter(Boolean).slice(0,4);
                if(!lines.length){ console.warn('[block] 角色未生成 iMessage 内容'); return; }
                var now=new Date();
                var time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
                var msgs=lines.map(function(line,i){
                    var tx=String(line||'').trim(), tr='';
                    var di=tx.indexOf('||');
                    if(di!==-1){ tr=tx.slice(di+2).trim(); tx=tx.slice(0,di).trim(); }
                    var m={id:'im_'+Date.now()+'_'+i, type:'left', text:tx, time:time, ts:Date.now()+i, via:'imessage'};
                    if(tr) m.trans=tr;
                    return m;
                });
                appendIMessage(rec, msgs).then(function(){
                    try{ localStorage.setItem('chat_setting_blockedContacted_'+chatId, String(Date.now())); }catch(e){}
                    notifyIMessageRefresh();
                    try{ if(window.parent!==window) window.parent.postMessage({type:'appNotify',title:(rec&&rec.name)||chatName||'角色',body:(msgs[0]&&msgs[0].text)||'',app:'imessage',avatar:(rec&&rec.avatar)||'',name:(rec&&rec.name)||chatName||'角色'},'*'); }catch(e){}
                });
            }
            proxyFetch(payload, blkToken).then(function(d){
                if(d){ handleContactResult(d); return; }
                // 代理失败时直接用 fetch 兜底
                fetch(payload.url,{method:'POST',headers:payload.headers,body:payload.body})
                    .then(function(r){return r.json();}).then(handleContactResult)
                    .catch(function(){ handleContactResult(null); });
            });
        }).catch(function(){ blockContacting=false; });
    }
    function notifyIMessageRefresh(){
        try{ if(window.parent!==window) window.parent.postMessage({type:'nanoIMessageUpdated',chatId:chatId},'*'); }catch(e){}
    }
    if(blockItem) blockItem.addEventListener('click', doBlock);
    if(unblockItem) unblockItem.addEventListener('click', doUnblock);
    applyBlockState();

    // ===== 事件绑定 =====
    // ===== 语音音色（TTS 预设绑定） =====
    function openVoiceModal() {
        if (!voiceModal || !voicePresetSelect) return;
        var current = getSetting('ttsPreset', '');
        voicePresetSelect.innerHTML = '';
        var optGlobal = document.createElement('option');
        optGlobal.value = '';
        optGlobal.textContent = '跟随全局（API → TTS 当前配置）';
        voicePresetSelect.appendChild(optGlobal);
        var fill = function (names) {
            (names || []).forEach(function (n) {
                var o = document.createElement('option');
                o.value = n; o.textContent = n;
                voicePresetSelect.appendChild(o);
            });
            voicePresetSelect.value = current || '';
            if (voicePresetSelect.value !== (current || '')) voicePresetSelect.value = '';
        };
        if (window.NanoTTS && window.NanoTTS.listPresets) {
            window.NanoTTS.listPresets().then(fill, function () { fill([]); });
        } else {
            fill([]);
        }
        voiceModal.classList.add('active');
    }
    function saveVoice() {
        var val = (voicePresetSelect && voicePresetSelect.value) || '';
        setSetting('ttsPreset', val);
        if (voicePreview) voicePreview.textContent = val ? val : '跟随全局';
        if (window.parent !== window) {
            try { window.parent.postMessage({ type: 'ttsVoiceChanged', chatId: chatId, ttsPreset: val }, '*'); } catch (e) {}
            try {
                var cf = window.parent.document.getElementById('chatInnerFrame');
                if (cf && cf.contentWindow) cf.contentWindow.postMessage({ type: 'ttsVoiceChanged', chatId: chatId, ttsPreset: val }, '*');
            } catch (e) {}
        }
        if (voiceModal) voiceModal.classList.remove('active');
    }
    var voiceItemEl = document.getElementById('voiceItem');
    if (voiceItemEl) voiceItemEl.addEventListener('click', openVoiceModal);
    if (ttsEnableToggle) {
        ttsEnableToggle.addEventListener('change', function () {
            var on = !!this.checked;
            setSetting('ttsEnabled', on);
            if (ttsEnableStatus) ttsEnableStatus.textContent = on ? '开启' : '关闭';
            if (voiceItemEl) voiceItemEl.style.opacity = on ? '' : '0.55';
            if (!on) { try { if (window.NanoTTS) window.NanoTTS.stop(); } catch (e) {} }
            if (window.parent !== window) {
                try { window.parent.postMessage({ type: 'ttsEnabledChanged', chatId: chatId, enabled: on }, '*'); } catch (e) {}
            }
            try {
                var f = window.parent && window.parent.document.getElementById('chatInnerFrame');
                if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'ttsEnabledChanged', chatId: chatId, enabled: on }, '*');
            } catch (e) {}
        });
    }
    if (voiceConfirm) voiceConfirm.addEventListener('click', saveVoice);
    if (voiceCancel) voiceCancel.addEventListener('click', function() { if (voiceModal) voiceModal.classList.remove('active'); });

    document.getElementById('remarkItem').addEventListener('click', openRemarkModal);
    remarkCancel.addEventListener('click', function() { remarkModal.classList.remove('active'); });
    remarkConfirm.addEventListener('click', saveRemark);
    remarkInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') saveRemark(); });

    document.getElementById('cotItem').addEventListener('click', openCotModal);
    cotCancel.addEventListener('click', function() { cotModal.classList.remove('active'); });
    cotConfirm.addEventListener('click', saveCot);

    document.getElementById('bgItem').addEventListener('click', openBgModal);
    bgCancel.addEventListener('click', function() { bgModal.classList.remove('active'); });
    bgConfirm.addEventListener('click', saveBackground);
    bgReset.addEventListener('click', resetBackground);
    bgUpload.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (file) {
            var reader = new FileReader();
            reader.onload = function(ev) {
                bgPreviewBox.style.backgroundImage = 'url(' + ev.target.result + ')';
                bgPreviewBox.style.backgroundSize = 'cover';
                bgPreviewBox.style.backgroundPosition = 'center';
                bgPreviewBox.textContent = '';
            };
            reader.readAsDataURL(file);
        }
        this.value = '';
    });

    // ===== 通话设置（从聊天设置直接调节） =====
    (function bindCallSettings() {
        var item = document.getElementById('callSettingItem');
        var modal = document.getElementById('callSettingModal');
        if (!item || !modal) return;
        var firstBox = document.getElementById('callFirstSpeaker');
        var bgUpload = document.getElementById('callBgUpload');
        var bgReset = document.getElementById('callBgReset');
        var previewBox = document.getElementById('callBgPreview');
        var previewVideo = document.getElementById('callBgPreviewVideo');
        var previewText = document.getElementById('callBgPreviewText');
        var previewUrl = '';

        function firstKey() { return 'nano_call_first_' + chatId; }
        function applyFirstSpeaker() {
            var cur = 'char';
            try { cur = localStorage.getItem(firstKey()) === 'me' ? 'me' : 'char'; } catch (e) {}
            if (firstBox) {
                Array.prototype.forEach.call(firstBox.querySelectorAll('[data-call-first]'), function (btn) {
                    btn.classList.toggle('active', btn.getAttribute('data-call-first') === cur);
                });
            }
        }
        if (firstBox) {
            firstBox.addEventListener('click', function (e) {
                var btn = e.target && e.target.closest ? e.target.closest('[data-call-first]') : null;
                if (!btn) return;
                var val = btn.getAttribute('data-call-first') === 'me' ? 'me' : 'char';
                try { localStorage.setItem(firstKey(), val); } catch (err) {}
                applyFirstSpeaker();
            });
        }

        function renderPreview() {
            if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} previewUrl = ''; }
            if (previewVideo) {
                try { previewVideo.pause(); previewVideo.removeAttribute('src'); previewVideo.load(); } catch (e) {}
                previewVideo.style.display = 'none';
            }
            if (!previewBox) return;
            previewBox.style.backgroundImage = 'none';
            previewBox.style.backgroundColor = '#111';
            if (previewText) previewText.style.display = '';
            if (!window.NanoCallBg) return;
            window.NanoCallBg.load(chatId).then(function (bg) {
                if (!bg) {
                    if (previewText) previewText.textContent = '默认（角色头像）';
                    return;
                }
                if (bg.kind === 'video' && bg.blob && previewVideo) {
                    try {
                        previewUrl = URL.createObjectURL(bg.blob);
                        previewVideo.src = previewUrl;
                        previewVideo.style.display = 'block';
                        previewVideo.play().catch(function () {});
                    } catch (e) {}
                    if (previewText) previewText.textContent = '已选择：Live 视频';
                } else if (bg.kind === 'image' && bg.value) {
                    previewBox.style.backgroundImage = 'url(' + bg.value + ')';
                    previewBox.style.backgroundSize = 'cover';
                    previewBox.style.backgroundPosition = 'center';
                    if (previewText) previewText.textContent = '已选择：图片 / 动图';
                }
            }).catch(function () {});
        }

        item.addEventListener('click', function () {
            modal.classList.add('active');
            applyFirstSpeaker();
            renderPreview();
        });
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.classList.remove('active');
        });
        var done = document.getElementById('callSettingDone');
        if (done) done.addEventListener('click', function () { modal.classList.remove('active'); });

        if (bgUpload) bgUpload.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file || !window.NanoCallBg) return;
            var isVideo = /^video\//i.test(file.type || '') || /\.(mp4|mov|m4v|webm)$/i.test(file.name || '');
            if (isVideo) {
                window.NanoCallBg.setVideo(file, file.name, chatId).then(renderPreview);
                return;
            }
            var reader = new FileReader();
            reader.onload = function (ev) {
                window.NanoCallBg.setImage(String(ev.target.result || ''), chatId).then(renderPreview);
            };
            reader.readAsDataURL(file);
        });
        if (bgReset) bgReset.addEventListener('click', function () {
            if (window.NanoCallBg) window.NanoCallBg.clear(chatId).then(renderPreview);
        });
        applyFirstSpeaker();
    })();

    timeToggle.addEventListener('change', function(e) {
        var enabled = e.target.checked;
        timeStatus.textContent = enabled ? '开启' : '关闭';
        setSetting('timeAware', enabled);
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'timeAwareChanged',
                chatId: chatId,
                enabled: enabled
            }, '*');
        }
    });

    // 译文模式：独立气泡 / 与原文同一气泡
    var transToggle = document.getElementById('transSeparateToggle');
    var transStatus = document.getElementById('transStatus');
    function applyTransMode() {
        var sep = true;
        try { sep = localStorage.getItem('nano_trans_separate') !== '0'; } catch (e) {}
        if (transToggle) transToggle.checked = sep;
        if (transStatus) transStatus.textContent = sep ? '分开' : '同一气泡';
    }
    applyTransMode();
    function applyForceTranslate() {
        var on = !!getSetting('forceTranslate', false);
        if (forceTranslateToggle) forceTranslateToggle.checked = on;
        if (forceTranslateStatus) forceTranslateStatus.textContent = on ? '强制开启' : '跟随人设';
        if (forceTranslateLang) forceTranslateLang.value = getSetting('forceTranslateLang', '英文') || '英文';
        if (forceTranslateLangItem) forceTranslateLangItem.style.display = on ? 'flex' : 'none';
    }
    applyForceTranslate();
    if (forceTranslateToggle) {
        forceTranslateToggle.addEventListener('change', function () {
            var on = !!this.checked;
            setSetting('forceTranslate', on);
            if (on && !getSetting('forceTranslateLang', '')) setSetting('forceTranslateLang', '英文');
            if (forceTranslateStatus) forceTranslateStatus.textContent = on ? '强制开启' : '跟随人设';
            if (forceTranslateLangItem) forceTranslateLangItem.style.display = on ? 'flex' : 'none';
            var lang = forceTranslateLang ? (forceTranslateLang.value || '英文') : '英文';
            if (window.parent !== window) {
                try { window.parent.postMessage({ type: 'nanoForceTranslate', chatId: chatId, enabled: on, lang: lang }, '*'); } catch (e) {}
            }
        });
    }
    if (forceTranslateLang) {
        forceTranslateLang.addEventListener('change', function () {
            var lang = this.value || '英文';
            setSetting('forceTranslateLang', lang);
            if (window.parent !== window) {
                try { window.parent.postMessage({ type: 'nanoForceTranslate', chatId: chatId, enabled: !!getSetting('forceTranslate', false), lang: lang }, '*'); } catch (e) {}
            }
        });
    }
    if (transToggle) {
        transToggle.addEventListener('change', function (e) {
            var sep = e.target.checked;
            try { localStorage.setItem('nano_trans_separate', sep ? '1' : '0'); } catch (err) {}
            if (transStatus) transStatus.textContent = sep ? '分开' : '同一气泡';
            // 通知父页面转发给当前会话，立即重渲染
            if (window.parent !== window) {
                try { window.parent.postMessage({ type: 'nanoTransMode', chatId: chatId, separate: sep }, '*'); } catch (err) {}
            }
        });
    }

    document.getElementById('searchItem').addEventListener('click', openSearchModal);
    searchInput.addEventListener('input', performSearch);
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); performSearch(); }
    });
    searchClose.addEventListener('click', function() { searchModal.classList.remove('active'); });

    document.getElementById('clearItem').addEventListener('click', openClearModal);
    clearCancel.addEventListener('click', function() { clearModal.classList.remove('active'); });
    clearConfirm.addEventListener('click', confirmClear);

    document.getElementById('promptItem').addEventListener('click', openPromptModal);
    promptCancel.addEventListener('click', function() { promptModal.classList.remove('active'); });
    promptConfirm.addEventListener('click', savePrompt);

    document.getElementById('faceItem').addEventListener('click', function () { openFaceModal('faceRef'); });
    var coupleUserItem = document.getElementById('coupleUserFaceItem');
    if (coupleUserItem) coupleUserItem.addEventListener('click', function () { openFaceModal('coupleFaceUser'); });
    var coupleCharItem = document.getElementById('coupleCharFaceItem');
    if (coupleCharItem) coupleCharItem.addEventListener('click', function () { openFaceModal('coupleFaceChar'); });
    faceCancel.addEventListener('click', function() { faceModal.classList.remove('active'); });
    faceConfirm.addEventListener('click', saveFace);
    faceUpload.addEventListener('change', function(e) {
        var file = e.target.files[0];
        var input = this;
        if (file) {
            compressImageFile(file, 640, 0.82).then(function(dataUrl) {
                if (dataUrl) {
                    facePreviewBox.style.backgroundImage = 'url(' + dataUrl + ')';
                    facePreviewBox.style.backgroundSize = 'cover';
                    facePreviewBox.style.backgroundPosition = 'center';
                    facePreviewBox.textContent = '';
                }
                input.value = '';
            });
        } else {
            this.value = '';
        }
    });

    // ===== 主动功能事件绑定 =====
    autoMsgToggle.addEventListener('change', toggleAutoMsg);
    autoMsgInterval.addEventListener('change', changeAutoMsgInterval);

    autoMomentToggle.addEventListener('change', toggleAutoMoment);
    autoMomentInterval.addEventListener('change', changeAutoMomentInterval);

    allowImageToggle.addEventListener('change', toggleAllowImage);
    if (allowMomentImageToggle) allowMomentImageToggle.addEventListener('change', toggleAllowMomentImage);
    if (momentImageFreq) momentImageFreq.addEventListener('change', function() {
        setSetting('momentImageFreq', this.value);
    });
    if (voiceFreq) voiceFreq.addEventListener('change', function() {
        setSetting('voiceFreq', this.value);
    });
    if (actionNarrationToggle) actionNarrationToggle.addEventListener('change', function() {
        setSetting('actionNarration', this.checked);
        actionNarrationStatus.textContent = this.checked ? '开启' : '关闭';
    });
    if (cotToggle) cotToggle.addEventListener('change', function() {
        setSetting('cotEnabled', this.checked);
        if (cotToggleStatus) cotToggleStatus.textContent = this.checked ? '开启' : '关闭';
        applyCotItemState(this.checked);
        try { if (window.parent) window.parent.postMessage({ type: 'cotChanged', chatId: chatId, cotEnabled: this.checked }, '*'); } catch (e) {}
    });
    if (altProbeToggle) altProbeToggle.addEventListener('change', function() {
        setSetting('altProbe', this.checked);
        altProbeStatus.textContent = this.checked ? '开启' : '关闭';
    });
    if (autoSocialToggle) autoSocialToggle.addEventListener('change', function() {
        setSetting('autoSocial', this.checked);
        autoSocialStatus.textContent = this.checked ? '开启' : '关闭';
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'autoSocialChanged', chatId: chatId, enabled: this.checked, interval: parseInt(autoMomentInterval.value) }, '*');
        }
    });

    window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data) return;
        if (data.type === 'searchResults' && data.chatId === chatId && data.results) {
            renderSearchResults(data.results, data.keyword);
        }
    });

    // 当前楼层：统计线上 / 线下各自已聊的条数
    function countOnlineMessages() {
        return new Promise(function (resolve) {
            var key = 'chat_messages_' + chatId;
            function fromLocal() {
                try { resolve((JSON.parse(localStorage.getItem(key) || '[]') || []).length); }
                catch (e) { resolve(0); }
            }
            if (typeof localforage !== 'undefined') {
                localforage.getItem(key).then(function (data) {
                    if (Array.isArray(data)) resolve(data.length);
                    else fromLocal();
                }).catch(fromLocal);
            } else {
                fromLocal();
            }
        });
    }
    function countOfflineMessages() {
        return new Promise(function (resolve) {
            if (!('indexedDB' in window)) { resolve(0); return; }
            try {
                // 不指定版本：只读统计，绝不抢先建库/建表，避免破坏 offline.js 的表结构
                var req = indexedDB.open('MeetSettingsDB');
                req.onupgradeneeded = function () {};
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('messages')) { resolve(0); try { db.close(); } catch (err) {} return; }
                        var r = db.transaction('messages', 'readonly').objectStore('messages').openCursor();
                        var n = 0;
                        r.onsuccess = function (ev) {
                            var cur = ev.target.result;
                            if (cur) {
                                if ((cur.value && (cur.value.chatId || '')) === chatId) n++;
                                cur.continue();
                            } else {
                                resolve(n);
                                try { db.close(); } catch (err) {}
                            }
                        };
                        r.onerror = function () { resolve(n); try { db.close(); } catch (err) {} };
                    } catch (err) { resolve(0); }
                };
                req.onerror = function () { resolve(0); };
            } catch (e) { resolve(0); }
        });
    }
    function loadFloorCounts() {
        var el = document.getElementById('floorCountText');
        if (!el) return;
        var online = 0, offline = 0;
        function render() { el.textContent = '线上 ' + online + ' · 线下 ' + offline; }
        countOnlineMessages().then(function (n) { online = n; render(); });
        countOfflineMessages().then(function (n) { offline = n; render(); });
    }

    // ===== Token 占用（按字符估算）：线上/线下/记忆库/世界书/社交软件 =====
    var TOKEN_KEYS = { content: 1, text: 1, desc: 1, description: 1, summary: 1, setting: 1, persona: 1, prompt: 1, remark: 1, bio: 1, title: 1, message: 1, memory: 1, detail: 1, keys: 1, foreign: 1, speech: 1, narration: 1 };
    function estimateTokens(s) {
        s = String(s || '');
        if (!s) return 0;
        var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
        var other = s.length - cjk;
        return Math.ceil(cjk + other / 4);
    }
    function tokenTextFrom(obj, depth) {
        depth = depth || 0;
        if (obj == null || depth > 8) return '';
        if (typeof obj === 'string') return (obj.length < 4000 && obj.indexOf('data:') !== 0) ? obj + '\n' : '';
        var out = '';
        if (Array.isArray(obj)) {
            for (var i = 0; i < obj.length && i < 4000; i++) out += tokenTextFrom(obj[i], depth + 1);
            return out;
        }
        if (typeof obj === 'object') {
            for (var k in obj) {
                var v = obj[k];
                if (typeof v === 'string') {
                    if (TOKEN_KEYS[k] && v && v.length < 4000 && v.indexOf('data:') !== 0) out += v + '\n';
                } else if (v && typeof v === 'object') {
                    out += tokenTextFrom(v, depth + 1);
                }
            }
        }
        return out;
    }
    function dbExists(name) {
        return new Promise(function (resolve) {
            if (!indexedDB.databases) { resolve(true); return; }
            try {
                indexedDB.databases().then(function (list) {
                    resolve(!!list && list.some(function (d) { return d && d.name === name; }));
                }).catch(function () { resolve(true); });
            } catch (e) { resolve(true); }
        });
    }
    function idbReadStore(dbName, storeName, filterFn) {
        return dbExists(dbName).then(function (exists) {
            if (!exists) return [];
            return new Promise(function (resolve) {
                if (!('indexedDB' in window)) { resolve([]); return; }
                try {
                    // 不指定版本：只读，绝不抢先建库/建表
                    var req = indexedDB.open(dbName);
                    req.onupgradeneeded = function () {};
                    req.onsuccess = function (e) {
                        var db = e.target.result, out = [];
                        try {
                            if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
                            var r = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
                            r.onsuccess = function (ev) {
                                var cur = ev.target.result;
                                if (cur) {
                                    try { if (!filterFn || filterFn(cur.value, cur.key)) out.push({ key: cur.key, value: cur.value }); } catch (err) {}
                                    cur.continue();
                                } else { resolve(out); try { db.close(); } catch (err) {} }
                            };
                            r.onerror = function () { resolve(out); try { db.close(); } catch (err) {} };
                        } catch (err) { resolve([]); try { db.close(); } catch (e2) {} }
                    };
                    req.onerror = function () { resolve([]); };
                } catch (e) { resolve([]); }
            });
        });
    }
    function lfGet(key) {
        return new Promise(function (resolve) {
            if (typeof localforage !== 'undefined') {
                localforage.getItem(key).then(function (v) { resolve(v); }).catch(function () { resolve(null); });
            } else {
                try { resolve(JSON.parse(localStorage.getItem(key) || 'null')); } catch (e) { resolve(null); }
            }
        });
    }
    function matchCharText(obj) {
        var s = '';
        try { s = JSON.stringify(obj); } catch (e) { return false; }
        if (!s) return false;
        if (chatId && s.indexOf(chatId) !== -1) return true;
        if (chatName && s.indexOf(chatName) !== -1) return true;
        return false;
    }
    async function gatherTokenStats() {
        var stats = { online: 0, offline: 0, memory: 0, worldbook: 0, social: 0 };
        try { stats.online = estimateTokens(tokenTextFrom(await lfGet('chat_messages_' + chatId))); } catch (e) {}
        try {
            var off = await idbReadStore('MeetSettingsDB', 'messages', function (v) { return v && (v.chatId || '') === chatId; });
            stats.offline = estimateTokens(tokenTextFrom(off));
        } catch (e) {}
        try {
            var mem = await idbReadStore('nano_vector_memory_db', 'config', function (v, k) { return k === 'memlist_' + chatId || k === 'auxchat_' + chatId; });
            var mem2 = await idbReadStore('nano_vector_memory_db', 'chat_messages', function (v, k) { return k === chatId || (v && v.chatId === chatId); });
            stats.memory = estimateTokens(tokenTextFrom(mem) + tokenTextFrom(mem2));
        } catch (e) {}
        try {
            var wbRows = await idbReadStore('nano_worldbook_db', 'worldbook_data', null);
            var files = [];
            wbRows.forEach(function (row) {
                var val = row.value;
                if (val && val.value && Array.isArray(val.value.files)) val = val.value;
                if (val && Array.isArray(val.files)) {
                    val.files.forEach(function (f) {
                        if (!f) return;
                        var bound = Array.isArray(f.boundCharacters) ? f.boundCharacters : [];
                        if (bound.length === 0 || bound.indexOf(chatId) !== -1) files.push(f);
                    });
                }
            });
            stats.worldbook = estimateTokens(tokenTextFrom(files));
        } catch (e) {}
        try {
            var socialText = '';
            // 朋友圈
            try {
                var mo = JSON.parse(localStorage.getItem('nano_moments_data') || '[]');
                if (Array.isArray(mo)) socialText += tokenTextFrom(mo.filter(matchCharText));
            } catch (e) {}
            // Halo（按角色名匹配聊天记录）
            try {
                var halo = await idbReadStore('nano_halo_db', 'halo_state', null);
                halo.forEach(function (row) {
                    var rec = row.value;
                    var S = rec && rec.value ? rec.value : rec;
                    var log = S && S.chatLog && chatName && S.chatLog[chatName];
                    if (log) socialText += tokenTextFrom(log);
                });
            } catch (e) {}
            // Instagram（匹配到角色的会话）
            try {
                var insRows = await idbReadStore('nano_ins_db', 'state', function (v, k) { return typeof k === 'string' && k.indexOf('nano_ins_chat_') === 0; });
                insRows.forEach(function (row) {
                    var rec = row.value;
                    var st = rec && rec.value ? rec.value : rec;
                    var hist = st && st.chatHistories;
                    if (!hist || typeof hist !== 'object') return;
                    Object.keys(hist).forEach(function (uid) {
                        if (matchCharText(hist[uid])) socialText += tokenTextFrom(hist[uid]);
                    });
                });
            } catch (e) {}
            stats.social = estimateTokens(socialText);
        } catch (e) {}
        return stats;
    }
    function renderTokenChart(stats) {
        var labels = { online: '线上记录', offline: '线下记录', memory: '记忆库', worldbook: '世界书', social: '社交软件' };
        var colors = { online: '#007aff', offline: '#34c759', memory: '#ff9500', worldbook: '#af52de', social: '#ff2d55' };
        var entries = Object.keys(labels).map(function (k) {
            return { k: k, label: labels[k], v: stats[k] || 0, color: colors[k] };
        }).filter(function (e) { return e.v > 0; }).sort(function (a, b) { return b.v - a.v; });
        var total = entries.reduce(function (a, e) { return a + e.v; }, 0);
        var totalEl = document.getElementById('tokenTotal');
        var ring = document.getElementById('tokenRing');
        var legend = document.getElementById('tokenLegend');
        if (totalEl) totalEl.textContent = total ? ('≈' + total.toLocaleString() + ' tokens') : '暂无数据';
        if (ring) {
            var C = 2 * Math.PI * 40;
            var off = 0;
            var html = '<circle cx="50" cy="50" r="40" fill="none" stroke="#eef0f3" stroke-width="12"></circle>';
            if (total) {
                entries.forEach(function (e) {
                    var len = e.v / total * C;
                    html += '<circle cx="50" cy="50" r="40" fill="none" stroke="' + e.color + '" stroke-width="12" stroke-linecap="butt"'
                        + ' stroke-dasharray="' + len.toFixed(3) + ' ' + (C - len).toFixed(3) + '"'
                        + ' stroke-dashoffset="' + (-off).toFixed(3) + '" transform="rotate(-90 50 50)"></circle>';
                    off += len;
                });
                html += '<text x="50" y="47" text-anchor="middle" font-size="13" font-weight="600" fill="#1c1c1e">' + Math.round(total / 1000) + 'k</text>';
                html += '<text x="50" y="60" text-anchor="middle" font-size="7" fill="#8e8e93">tokens</text>';
            }
            ring.innerHTML = html;
        }
        if (legend) {
            legend.innerHTML = total ? entries.map(function (e) {
                return '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;">'
                    + '<span style="width:8px;height:8px;border-radius:50%;flex:none;background:' + e.color + ';"></span>'
                    + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + e.label + '</span>'
                    + '<span style="color:#8e8e93;flex:none;">' + e.v.toLocaleString() + ' · ' + Math.round(e.v / total * 100) + '%</span>'
                    + '</div>';
            }).join('') : '<div style="color:#8e8e93;">暂无数据</div>';
        }
    }
    function loadTokenChart() {
        gatherTokenStats().then(renderTokenChart).catch(function () { });
    }

    // 自己的返回按钮：收起本页，回到聊天详情页（由主框架恢复 chat_inner）
    var navBackBtn = document.getElementById('navBack');
    if (navBackBtn) {
        navBackBtn.addEventListener('click', function () {
            try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); } catch (e) {}
        });
    }

    if (window.parent !== window) {
        window.parent.postMessage({ type: 'pageLoaded', page: 'inner_setting' }, '*');
        window.parent.postMessage({ type: 'setTitle', title: '聊天设置' }, '*');
    }

    loadInfo();
    loadFloorCounts();
    loadTokenChart();
    // Token 占用：默认收起，点击展开小卡片
    (function bindTokenToggle() {
        var item = document.getElementById('tokenItem');
        var details = document.getElementById('tokenDetails');
        var chevron = document.getElementById('tokenChevron');
        if (!item || !details) return;
        item.addEventListener('click', function () {
            var open = details.style.display !== 'none';
            details.style.display = open ? 'none' : 'block';
            if (chevron) chevron.style.transform = open ? '' : 'rotate(90deg)';
            if (!open) loadTokenChart();
        });
    })();
    console.log('[Setting] 聊天设置页面已加载，chatId:', chatId);
})();