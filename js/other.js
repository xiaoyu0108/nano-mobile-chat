// other.js — 保活 / 通知 / 通知声音
(function () {
    'use strict';

    var KEEP_KEY = 'nano_keep_alive';
    var SOUND_KEY = 'nano_notify_sound';

    var keepToggle = document.getElementById('keepAliveToggle');
    var notifyToggle = document.getElementById('notifyToggle');
    var soundSelect = document.getElementById('soundSelect');
    var soundPreview = document.getElementById('soundPreview');

    var _wakeLock = null;

    function post(type, payload) {
        try { if (window.parent !== window) window.parent.postMessage(Object.assign({ type: type }, payload || {}), '*'); } catch (e) {}
    }

    var backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'nanoCloseOverlay' }, '*');
            } else if (history.length > 1) {
                history.back();
            } else {
                location.href = 'more.html';
            }
        });
    }

    function applyKeepAlive(on) {
        try { localStorage.setItem(KEEP_KEY, on ? '1' : '0'); } catch (e) {}
        post('keepAlive', { enabled: !!on });
        if (on && navigator.wakeLock && navigator.wakeLock.request) {
            navigator.wakeLock.request('screen').then(function (s) {
                _wakeLock = s;
                _wakeLock.addEventListener('release', function () { _wakeLock = null; });
            }).catch(function () {});
        } else if (_wakeLock) {
            try { _wakeLock.release(); } catch (e) {}
            _wakeLock = null;
        }
    }

    function applyNotify(on) {
        try { localStorage.setItem('nano_notify_enabled', on ? '1' : '0'); } catch (e) {}
        post('notifySetting', { enabled: !!on });
        if (on) {
            try { if (window.NanoNotify) window.NanoNotify.ensurePermission(); } catch (e) {}
        }
    }

    if (keepToggle) {
        keepToggle.checked = (localStorage.getItem(KEEP_KEY) === '1');
        if (keepToggle.checked) applyKeepAlive(true);
        keepToggle.addEventListener('change', function () {
            applyKeepAlive(this.checked);
            // 保活和 Bark 是互补的：保活让本地定时任务继续跑，Bark 负责后台/锁屏系统通知，
            // 两者可以同时开启；服务端主动消息已开启时本机定时器会自动让位，不会重复推送。
            if (this.checked && barkToggle) {
                setBarkStatus('音频保活已开启；Bark 可同时开启作为后台系统通知');
            }
        });
    }

    if (notifyToggle) {
        notifyToggle.checked = (localStorage.getItem('nano_notify_enabled') === '1');
        if (notifyToggle.checked) {
            try { if (window.NanoNotify) window.NanoNotify.ensurePermission(); } catch (e) {}
        }
        notifyToggle.addEventListener('change', function () { applyNotify(this.checked); });
    }

    // ===== Bark：iPhone 后台推送 =====
    var barkKeyInput = document.getElementById('barkKeyInput');
    var barkKeySave = document.getElementById('barkKeySave');
    var barkKeyTest = document.getElementById('barkKeyTest');
    var barkStatus = document.getElementById('barkStatus');
    function setBarkStatus(msg, isErr) {
        if (!barkStatus) return;
        barkStatus.textContent = msg;
        barkStatus.style.color = isErr ? '#d9534f' : '#8e8e93';
    }
    // Bark 推送总开关（关闭后不再向 Bark 发请求）
    var barkToggle = document.getElementById('barkToggle');
    if (barkToggle && window.NanoNotify) {
        barkToggle.checked = (NanoNotify.barkEnabled ? NanoNotify.barkEnabled() : true);
        barkToggle.addEventListener('change', function () {
            NanoNotify.setBarkEnabled(this.checked);
            setBarkStatus(this.checked ? 'Bark 推送已开启' : 'Bark 推送已关闭，不会再向 Bark 推送');
            // 不再强制关闭音频保活：两者一起用，后台定时与系统通知都更稳。
            if (this.checked && keepToggle) {
                setBarkStatus('Bark 推送已开启（音频保活可同时保留）');
            }
        });
    }
    if (barkKeyInput && window.NanoNotify) {
        barkKeyInput.value = NanoNotify.barkKey ? NanoNotify.barkKey() : '';
        // 本地 localStorage 存不下时，从 IndexedDB 兜底读回
        if (NanoNotify.barkKeyAsync) {
            NanoNotify.barkKeyAsync().then(function (k) {
                if (k && !barkKeyInput.value) barkKeyInput.value = k;
            });
        }
        if (barkKeySave) {
            barkKeySave.addEventListener('click', function () {
                var k = (barkKeyInput.value || '').trim();
                var ok = NanoNotify.setBarkKey(k);
                if (!k) { setBarkStatus('已清空 Bark 密钥'); return; }
                setBarkStatus(ok ? '已保存 Bark 密钥 ✓' : '已存到本地数据库（浏览器存储已满），可正常使用');
            });
        }
        if (barkKeyTest) {
            barkKeyTest.addEventListener('click', function () {
                var k = (barkKeyInput.value || '').trim();
                if (!k) { setBarkStatus('请先填写 Bark 密钥', true); return; }
                NanoNotify.setBarkKey(k);
                setBarkStatus('发送中…');
                NanoNotify.barkPush('测试推送', '收到就说明配置成功 ✓', { force: true }, k).then(function (r) {
                    if (r && r.ok && r.resp && Number(r.resp.code) === 200) {
                        setBarkStatus('已发送，请查看 iPhone 通知 ✓');
                    } else if (r && r.ok) {
                        setBarkStatus('已发送（未收到就检查：Bark 里本设备的通知权限、密钥是否正确）');
                    } else {
                        var detail = (r && r.resp && (r.resp.message || r.resp.code)) || (r && r.error) || '未知';
                        setBarkStatus('发送失败：' + detail + '（可把密钥直接拼成 https://api.day.app/密钥/测试/收到 在 Safari 打开自测）', true);
                    }
                });
            });
        }
    }

    // ===== 无后台 Web Push：从 Worker 取公钥并一键订阅 =====
    var webPushBtn = document.getElementById('webPushBtn');
    var webPushStatus = document.getElementById('webPushStatus');
    function getNanoPush() {
        try { return window.parent && window.parent.NanoPush ? window.parent.NanoPush : window.NanoPush; } catch (e) { return window.NanoPush; }
    }
    function setWebPushStatus(text) { if (webPushStatus) webPushStatus.textContent = text; }
    function refreshWebPushStatus() {
        var NP = getNanoPush();
        if (!NP) { setWebPushStatus('未加载推送模块（请从主界面打开）'); return; }
        NP.status().then(function (s) {
            if (s.permission === 'denied') {
                setWebPushStatus('通知权限被拒绝：请到系统/浏览器设置里允许 Nano 的通知');
                if (webPushBtn) webPushBtn.textContent = '重试';
                return;
            }
            if (s.subscribed) { setWebPushStatus('已开启 ✓ 关闭 App 也能收到'); if (webPushBtn) webPushBtn.textContent = '重新订阅'; }
            else if (s.configured) { setWebPushStatus('已配置，点右侧开启订阅'); if (webPushBtn) webPushBtn.textContent = '开启'; }
            else { setWebPushStatus('未配置：点右侧自动获取 VAPID 并开启'); if (webPushBtn) webPushBtn.textContent = '开启'; }
        }).catch(function () { setWebPushStatus('检查失败，可直接点开启'); });
    }
    if (webPushBtn) {
        webPushBtn.addEventListener('click', async function () {
            var NP = getNanoPush();
            if (!NP) { setWebPushStatus('推送模块未加载'); return; }
            // 先在点击手势里要权限：安卓上延迟到 fetch 之后会丢失用户手势
            try {
                if ('Notification' in window && Notification.permission === 'default') {
                    await Notification.requestPermission();
                }
            } catch (e) {}
            var endpoint = '';
            try { endpoint = (localStorage.getItem('nano_push_endpoint') || '').trim(); } catch (e) {}
            if (!endpoint) endpoint = 'https://nanopush.nano315.online';
            endpoint = endpoint.replace(/\/+$/, '');
            var key = '';
            try { key = (localStorage.getItem('nano_push_vapid') || '').trim(); } catch (e) {}
            var token = '';
            try { token = localStorage.getItem('nano_push_token') || localStorage.getItem('nano_peek_token') || ''; } catch (e) {}
            if (!key) {
                setWebPushStatus('正在获取服务端公钥…');
                try {
                    var r = await fetch(endpoint + '/vapid', { cache: 'no-store' });
                    var d = await r.json();
                    key = (d && d.key) || '';
                } catch (e) {}
            }
            if (!key) { setWebPushStatus('服务端暂时没返回 VAPID 公钥，请确认最新 Worker 已部署'); return; }
            NP.setup(endpoint, key, token);
            setWebPushStatus('等待通知权限…');
            try {
                if ('Notification' in window && Notification.permission !== 'granted') {
                    setWebPushStatus('通知权限未开启：请在浏览器/系统设置里允许 Nano 的通知，然后重试');
                    return;
                }
                await NP.enable(true);
                try { localStorage.setItem('nano_notify_enabled', '1'); } catch (e) {}
                setWebPushStatus('已开启 ✓ 关闭 App 也能收到');
                if (webPushBtn) webPushBtn.textContent = '重新订阅';
            } catch (e) {
                var msg = e && e.message ? e.message : '开启失败';
                var ua = String(navigator.userAgent || '');
                if (/Android/i.test(ua) && /push service|registration failed/i.test(msg)) {
                    msg += '（安卓需 Chrome/Edge + Google Play 服务；国产浏览器或无 GMS 的设备无法建立 Web Push）';
                }
                setWebPushStatus(msg);
            }
        });
    }
    refreshWebPushStatus();

    function buildSounds() {
        if (!soundSelect || !window.NanoNotify) return;
        soundSelect.innerHTML = '';
        window.NanoNotify.sounds.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            soundSelect.appendChild(opt);
        });
        var cur = localStorage.getItem(SOUND_KEY) || 'ding';
        soundSelect.value = cur;
    }
    buildSounds();

    if (soundSelect) {
        soundSelect.addEventListener('change', function () {
            try { localStorage.setItem(SOUND_KEY, this.value); } catch (e) {}
            if (window.NanoNotify) window.NanoNotify.playSound(this.value);
        });
    }
    if (soundPreview) {
        soundPreview.addEventListener('click', function () {
            if (window.NanoNotify) window.NanoNotify.playSound(soundSelect ? soundSelect.value : 'ding');
        });
    }

    // ===== 分应用提示音（私聊 / 群聊 / 一起听 / 一起看 / ins / halo / 朋友圈）=====
    function buildChannelSounds() {
        var box = document.getElementById('channelSoundList');
        if (!box || !window.NanoNotify || !NanoNotify.channels) return;
        box.innerHTML = '';
        NanoNotify.channels.forEach(function (ch) {
            var row = document.createElement('div');
            row.className = 'list-item sound-row';
            var title = document.createElement('span');
            title.className = 'item-title';
            title.textContent = ch.name;
            var ctrl = document.createElement('div');
            ctrl.className = 'sound-controls';
            var sel = document.createElement('select');
            sel.className = 'sound-select';
            var follow = document.createElement('option');
            follow.value = '';
            follow.textContent = '跟随全局';
            sel.appendChild(follow);
            NanoNotify.sounds.forEach(function (s) {
                var o = document.createElement('option');
                o.value = s.id;
                o.textContent = s.name;
                sel.appendChild(o);
            });
            sel.value = NanoNotify.channelSound(ch.id) || '';
            var btn = document.createElement('button');
            btn.className = 'preview-btn';
            btn.textContent = '试听';
            sel.addEventListener('change', function () {
                NanoNotify.setChannelSound(ch.id, this.value);
                NanoNotify.playSound(this.value || NanoNotify.currentSound());
            });
            btn.addEventListener('click', function () {
                NanoNotify.playSound(sel.value || NanoNotify.currentSound());
            });
            ctrl.appendChild(sel);
            ctrl.appendChild(btn);
            row.appendChild(title);
            row.appendChild(ctrl);
            box.appendChild(row);
        });
    }
    buildChannelSounds();

    // ===== 后台运行状态：保活心跳 + 自动消息 / 自动朋友圈倒计时 =====
    var bgStatusEl = document.getElementById('bgStatus');
    function fmtLeft(target) {
        var ms = target - Date.now();
        if (ms <= 0) return '即将生成…';
        var s = Math.round(ms / 1000);
        var m = Math.floor(s / 60);
        s = s % 60;
        return m > 0 ? (m + ' 分 ' + s + ' 秒后') : (s + ' 秒后');
    }
    function renderBgStatus() {
        if (!bgStatusEl) return;
        var parts = [];
        var ka = null, st = null;
        try { ka = JSON.parse(localStorage.getItem('nano_keep_alive_state') || 'null'); } catch (e) {}
        try { st = JSON.parse(localStorage.getItem('nano_auto_status') || 'null'); } catch (e) {}
        if (localStorage.getItem(KEEP_KEY) === '1') {
            if (ka && ka.running && (Date.now() - (ka.at || 0) < 120000)) parts.push('保活：运行中 ✓');
            else if (ka && (Date.now() - (ka.at || 0)) >= 120000) parts.push('保活：可能已被系统挂起（回前台自动恢复）');
            else parts.push('保活：已开启，点一下屏幕让音频解锁');
        } else {
            parts.push('保活：未开启（切后台会停止生成）');
        }
        if (st && st.msg) parts.push(st.msg.on ? ('自动消息：' + fmtLeft(st.msg.nextAt)) : '自动消息：关');
        if (st && st.moment) parts.push(st.moment.on ? ('自动朋友圈：' + fmtLeft(st.moment.nextAt)) : '自动朋友圈：关');
        bgStatusEl.textContent = parts.join(' · ');
    }
    renderBgStatus();
    setInterval(renderBgStatus, 1000);

    // ===== API 悬浮球设置 =====
    var BALL_KEY = 'nanoApiBall';
    var ballToggle = document.getElementById('apiBallToggle');
    var ballSize = document.getElementById('apiBallSize');
    var ballSizeVal = document.getElementById('apiBallSizeVal');
    var ballReset = document.getElementById('apiBallResetPos');
    var ballPickImage = document.getElementById('apiBallPickImage');
    var ballImageInput = document.getElementById('apiBallImageInput');
    var ballImageDesc = document.getElementById('apiBallImageDesc');
    var ballThumb = document.getElementById('apiBallThumb');
    var ballClearImage = document.getElementById('apiBallClearImage');

    function readBallSettings() {
        var s = { enabled: true, size: 52, icon: 'classic', image: null, x: null, y: null };
        try {
            var raw = localStorage.getItem(BALL_KEY);
            if (raw) Object.assign(s, JSON.parse(raw) || {});
        } catch (e) {}
        return s;
    }
    function writeBallSettings(patch) {
        var s = Object.assign(readBallSettings(), patch || {});
        try { localStorage.setItem(BALL_KEY, JSON.stringify(s)); } catch (e) {}
        try { if (window.parent !== window) window.parent.postMessage({ type: 'apiBallSettings', settings: s }, '*'); } catch (e) {}
        try { if (window.ApiBall && window.ApiBall.apply) window.ApiBall.apply(s); } catch (e) {}
        return s;
    }
    function fillSlider(el) {
        if (!el) return;
        var min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100;
        var val = parseFloat(el.value) || 0;
        var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        el.style.setProperty('--pct', pct + '%');
    }
    function renderBallAppearance(s) {
        if (ballImageDesc) ballImageDesc.textContent = s.image ? '已设置自定义图片' : '未设置 · 使用默认 iOS 圆环';
        if (ballClearImage) ballClearImage.style.display = s.image ? '' : 'none';
        if (ballThumb) {
            if (s.image) {
                ballThumb.style.backgroundImage = 'url("' + s.image + '")';
                ballThumb.classList.add('has-image');
            } else {
                ballThumb.style.backgroundImage = '';
                ballThumb.classList.remove('has-image');
            }
        }
    }
    function fileToBallImage(file) {
        return new Promise(function (resolve) {
            try {
                var reader = new FileReader();
                reader.onload = function () {
                    var img = new Image();
                    img.onload = function () {
                        try {
                            var size = 256;
                            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                            var side = Math.min(w, h);
                            var sx = (w - side) / 2, sy = (h - side) / 2;
                            var c = document.createElement('canvas');
                            c.width = size; c.height = size;
                            c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
                            resolve(c.toDataURL('image/jpeg', 0.9));
                        } catch (e) { resolve(reader.result); }
                    };
                    img.onerror = function () { resolve(reader.result); };
                    img.src = reader.result;
                };
                reader.onerror = function () { resolve(null); };
                reader.readAsDataURL(file);
            } catch (e) { resolve(null); }
        });
    }

    var bset = readBallSettings();
    if (ballToggle) {
        ballToggle.checked = bset.enabled !== false;
        ballToggle.addEventListener('change', function () { writeBallSettings({ enabled: this.checked }); });
    }
    if (ballSize) {
        ballSize.value = bset.size || 52;
        if (ballSizeVal) ballSizeVal.textContent = ballSize.value;
        fillSlider(ballSize);
        ballSize.addEventListener('input', function () {
            if (ballSizeVal) ballSizeVal.textContent = this.value;
            fillSlider(this);
        });
        ballSize.addEventListener('change', function () { writeBallSettings({ size: parseInt(this.value, 10) || 52 }); });
    }
    renderBallAppearance(bset);

    if (ballPickImage && ballImageInput) {
        ballPickImage.addEventListener('click', function () { ballImageInput.click(); });
        ballImageInput.addEventListener('change', function () {
            var file = this.files && this.files[0];
            this.value = '';
            if (!file) return;
            fileToBallImage(file).then(function (dataUrl) {
                if (!dataUrl) return;
                var s = writeBallSettings({ image: dataUrl });
                renderBallAppearance(s);
            });
        });
    }
    if (ballClearImage) {
        ballClearImage.addEventListener('click', function () {
            var s = writeBallSettings({ image: null });
            renderBallAppearance(s);
        });
    }
    if (ballReset) {
        ballReset.addEventListener('click', function () { writeBallSettings({ x: null, y: null }); });
    }

    if (window.parent !== window) {
        window.parent.postMessage({ type: 'pageLoaded', page: 'other' }, '*');
    }
})();

// ===== 全局底栏位置调节（作用于所有页面的底栏） =====
(function () {
    'use strict';
    var STEP = 4, MIN = -160, MAX = 200;
    var INSET_DEFAULT = 48;
    var INSET_ENABLED_KEY = 'nano_top_inset_enabled';
    var KEYS = { top: 'nanoTopShift', bottom: 'nanoBottomShift', inset: 'nano_top_inset' };
    var VAL_ID = { top: 'topShiftVal', bottom: 'bottomShiftVal', inset: 'insetShiftVal' };
    function read(k) {
        try {
            var v = localStorage.getItem(k);
            if (v === null || v === '') return k === KEYS.inset ? INSET_DEFAULT : 0;
            return parseInt(v, 10) || 0;
        } catch (e) { return k === KEYS.inset ? INSET_DEFAULT : 0; }
    }
    function readInsetEnabled() {
        try {
            var v = localStorage.getItem(INSET_ENABLED_KEY);
            if (v === '1') return true;
            if (v === '0') return false;
        } catch (e) {}
        // 未设置过：iPhone / 安卓全面屏默认开启；如果顶栏多出空白可以手动关闭
        try { return /iPhone|Android/i.test(navigator.userAgent); } catch (e) { return false; }
    }
    function postInset(enabled, value) {
        if (window.parent === window) return;
        try { window.parent.postMessage({ type: 'nanoTopInset', enabled: enabled, value: value }, '*'); } catch (e) {}
    }
    function render(target, n) {
        var el = document.getElementById(VAL_ID[target]);
        if (el) el.textContent = (n > 0 ? '+' : '') + n;
    }
    function apply(target, n) {
        n = parseInt(n, 10) || 0;
        if (target === 'inset') n = Math.max(0, Math.min(220, n));
        else n = Math.max(MIN, Math.min(MAX, n));
        var key = KEYS[target];
        try { localStorage.setItem(key, String(n)); } catch (e) {}
        render(target, n);
        if (target === 'inset') {
            // 顶部安全区：通知主框架重新测量并下发
            postInset(readInsetEnabled(), n);
            return;
        }
        var msg = { type: target === 'top' ? 'nanoTopShift' : 'nanoBottomShift', value: n };
        if (window.__nanoAppearance) { try { window.__nanoAppearance.applyMessage(msg); } catch (e) {} }
        if (window.parent !== window) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }
    }
    document.querySelectorAll('.nudge-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var target = this.getAttribute('data-target');
            var dir = parseInt(this.getAttribute('data-dir'), 10) || 0;
            if (!target) return;
            if (target === 'inset') {
                if (dir === 0) {   // 恢复默认：清掉自定义，回到 48
                    try { localStorage.removeItem(KEYS.inset); } catch (e) {}
                    render('inset', INSET_DEFAULT);
                    postInset(readInsetEnabled(), null);
                    return;
                }
                apply('inset', read(KEYS.inset) + dir * 2);
                return;
            }
            apply(target, dir === 0 ? 0 : read(KEYS[target]) + dir * STEP);
        });
    });

    // 灵动岛安全区开关：关闭后顶部安全区按 0 处理（安卓默认关闭，避免顶栏空白 / 线下美化串位）
    var insetToggle = document.getElementById('insetToggle');
    var insetNudgeRow = document.getElementById('insetNudgeRow');
    function syncInsetUI() {
        var on = readInsetEnabled();
        if (insetToggle) insetToggle.checked = on;
        if (insetNudgeRow) insetNudgeRow.style.display = on ? '' : 'none';
    }
    if (insetToggle) {
        insetToggle.addEventListener('change', function () {
            var on = this.checked;
            try { localStorage.setItem(INSET_ENABLED_KEY, on ? '1' : '0'); } catch (e) {}
            syncInsetUI();
            postInset(on, on ? read(KEYS.inset) : null);
        });
    }
    render('top', read(KEYS.top));
    render('bottom', read(KEYS.bottom));
    render('inset', read(KEYS.inset));
    syncInsetUI();
})();

// ===== 顶部分段导航：一次只显示一个面板 =====
(function () {
    'use strict';
    var bar = document.getElementById('segBar');
    if (!bar) return;
    var panels = document.querySelectorAll('.seg-panel');
    function show(seg) {
        Array.prototype.forEach.call(bar.querySelectorAll('.seg-btn'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-seg') === seg);
        });
        Array.prototype.forEach.call(panels, function (p) {
            p.classList.toggle('active', p.getAttribute('data-seg') === seg);
        });
        // 切换 tab 时回到顶部，避免停留在上一屏的滚动位置
        try { var c = document.querySelector('.container'); if (c) c.scrollTop = 0; } catch (e) {}
    }
    Array.prototype.forEach.call(bar.querySelectorAll('.seg-btn'), function (b) {
        b.addEventListener('click', function () { show(this.getAttribute('data-seg')); });
    });
    var first = bar.querySelector('.seg-btn.active') || bar.querySelector('.seg-btn');
    if (first) show(first.getAttribute('data-seg'));
})();

// ===== 纳米助手开关（放在「其他 → 助手」）=====
(function () {
    'use strict';
    var t = document.getElementById('nanoToggle');
    if (!t) return;
    var NANO_ID = 'nano_ai';
    var NANO_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ecb"/><stop offset="1" stop-color="#ff4d94"/></linearGradient></defs>' +
        '<rect width="80" height="80" rx="20" fill="url(#g)"/>' +
        '<rect x="18" y="24" width="44" height="34" rx="12" fill="#fff" opacity="0.95"/>' +
        '<circle cx="32" cy="41" r="4.5" fill="#ff4d94"/><circle cx="48" cy="41" r="4.5" fill="#ff4d94"/>' +
        '<rect x="38" y="12" width="4" height="10" rx="2" fill="#fff"/><circle cx="40" cy="11" r="4" fill="#fff"/></svg>');

    function openCharsDb() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {}
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }
    function ensureNanoCharacter(on) {
        return openCharsDb().then(function (db) {
            if (!db) return false;
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction('characters', 'readwrite');
                    var st = tx.objectStore('characters');
                    var g = st.get(NANO_ID);
                    g.onsuccess = function () {
                        var ex = g.result;
                        if (on) {
                            if (!ex) {
                                st.put({ id: NANO_ID, name: '纳米', avatar: NANO_AVATAR, gender: '女', nationality: '中国', setting: '', bindUser: '', isNpc: true, worldbookBindings: [], nanoAssistant: true });
                            } else {
                                ex.name = ex.name || '纳米'; ex.isNpc = true; ex.nanoAssistant = true; st.put(ex);
                            }
                        } else if (ex) {
                            st.delete(NANO_ID);
                        }
                    };
                    tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(true); };
                    tx.onerror = function () { try { db.close(); } catch (e) {} resolve(false); };
                } catch (e) { resolve(false); }
            });
        });
    }

    var on = false;
    try { on = localStorage.getItem('nano_assistant_enabled') === '1'; } catch (e) {}
    t.checked = on;
    if (on) ensureNanoCharacter(true);
    t.addEventListener('change', async function () {
        var v = this.checked;
        await ensureNanoCharacter(v);
        var flag = v ? '1' : '0';
        try { localStorage.setItem('nano_assistant_enabled', flag); } catch (e) {}
        try { if (window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
    });

    var settingRow = document.getElementById('nanoSettingRow');
    if (settingRow) {
        settingRow.addEventListener('click', function () {
            try {
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'openFullscreen', url: 'nano-setting.html', title: '纳米设置', showBack: true, source: 'other' }, '*');
                } else {
                    location.href = 'nano-setting.html';
                }
            } catch (e) {}
        });
    }
})();
