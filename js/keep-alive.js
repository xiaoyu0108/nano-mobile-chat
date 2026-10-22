/* ============================================================
   keep-alive.js — Nano 外壳统一保活 + 定时调度

   作用：让定时任务在切后台 / 锁屏后仍能继续跑。
   做法：用一段完全静音的音频占住音频会话，页面就不容易被系统挂起；
        再把心跳挂在音频的播放进度事件上（后台对 setInterval 的降权不影响它）。

   目标：切到别的页面（Nano 是「index 外壳 + iframe 子页」结构）或切后台后，
        定时任务与推送仍然继续，切页面不丢任务。

   原理：
     1. 音频保活：循环播放完全静音的音频，iOS 会为该页面维持
        音频会话，页面不被立刻挂起 → fetch / 定时生成 / 自动消息能继续跑。
     2. MediaSession：锁屏 / 灵动岛显示「Nano 保活中」，暂停按钮不生效，
        让系统认为这是一个真实播放器而更稳定。
     3. 音频 timeupdate 驱动心跳：后台 setInterval 会被降权，改由音频
        播放进度事件驱动检查（iOS 后台最可靠），另加 5s 定时兜底。
     4. 持久化调度队列（localStorage: nano_scheduled_tasks）：到期时间写入
        localStorage，任何页面在 加载 / 回前台 / 心跳 时都会补跑已到期任务，
        所以「切换页面」不会丢任务与推送。
     5. 到期执行：
        · type='notify'   → 直接弹系统通知（NanoNotify → ServiceWorker → Bark）
        · type='generate' → 广播给正在运行的聊天/朋友圈 iframe，由它调用 API 生成；
                            若无 frame 认领，则退化为一条系统通知，保证不静默丢推送。
     6. Wake Lock：前台保持屏幕常亮（不影响后台，后台靠音频保活）。

   用法：
     NanoKeepAlive.start() / stop() / enabled() / isRunning()
     NanoKeepAlive.schedule({ id, at, type, title, body, target, channel, data })
     NanoKeepAlive.scheduleNotification(title, body, delayMs, opts)
     NanoKeepAlive.cancel(id) / tasks() / runDue()

   注意：
   · 音频必须由「用户手势」解锁后才能播放，所以开启后第一次触摸页面会自动续播。
   · 子页面（iframe）调用 start() 会转发给主框架，由主框架统一播放，避免多路音频；
     子页面仍可用 schedule() 写入同一个队列，由外壳统一执行。
   · 只有顶层窗口（外壳 index.html，或单独打开的子页）运行音频与调度循环，
     避免多个 iframe 重复弹通知。
   · iOS 不保证永久后台运行：音频被系统掐断后可能被挂起，切回前台会自动恢复。
   ============================================================ */
(function () {
    'use strict';

    var KEY = 'nano_keep_alive';
    var STATE = 'nano_keep_alive_state';
    var TASKS = 'nano_scheduled_tasks';

    var TICK_MS = 2000;        // timeupdate 轮询节流：最多 2 秒检查一次
    var FALLBACK_MS = 5000;    // setInterval 兜底（PC / 无音频事件环境）
    var ACK_WAIT_MS = 1500;    // generate 任务等待 frame 认领的时间
    var MAX_TASKS = 50;        // 队列上限，防止 localStorage 被写满

    var isTop = (window.parent === window);
    var audioEl = null;
    var audioUrl = '';
    var wakeLock = null;
    var unlocked = false;
    var restarting = false;
    var mediaSet = false;
    var npActive = false;          // 是否正在用「正在播放」展示 TA 的点评（灵动岛/锁屏）
    var lastTick = 0;
    var fallbackTimer = null;
    var pendingAck = {};
    var onDueCbs = [];
    var lastTasksRaw = null;       // 队列原始字符串缓存：内容没变就跳过 JSON.parse
    var lastTasksParsed = [];
    var lastStateRunning = null;   // 心跳状态缓存：只在变化/过期时才写 localStorage
    var lastStateAt = 0;

    function enabled() {
        try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
    }
    function setFlag(on) {
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    }

    // ===== 调度队列（持久化在 localStorage，跨页面共享）=====
    function readTasks() {
        try {
            var raw = localStorage.getItem(TASKS) || '[]';
            if (raw === lastTasksRaw) return lastTasksParsed;   // 内容没变：复用缓存，跳过 parse
            lastTasksRaw = raw;
            var a = JSON.parse(raw);
            lastTasksParsed = Array.isArray(a) ? a : [];
            return lastTasksParsed;
        } catch (e) { return []; }
    }
    function writeTasks(list) {
        var arr = list || [];
        var raw = JSON.stringify(arr);
        try {
            localStorage.setItem(TASKS, raw);
            lastTasksRaw = raw;
            lastTasksParsed = arr;
        } catch (e) {}
    }
    function uid() {
        return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // 生成一段完全静音的 WAV：占住音频会话，锁屏/切后台后页面不被系统挂起。
    // 用户要求保活必须静音，因此 PCM 全部为 128（8bit 静音），不留任何可听音。
    function wavUrl() {
        if (audioUrl) return audioUrl;
        try {
            var rate = 8000, seconds = 10, n = rate * seconds;
            var buf = new ArrayBuffer(44 + n);
            var dv = new DataView(buf);
            function put(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
            put(0, 'RIFF'); dv.setUint32(4, 36 + n, true); put(8, 'WAVE');
            put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
            dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
            put(36, 'data'); dv.setUint32(40, n, true);
            var amp = 0, freq = 20;
            for (var j = 0; j < n; j++) {
                var v = 128 + Math.round(amp * Math.sin(2 * Math.PI * freq * (j / rate)));
                dv.setUint8(44 + j, Math.max(0, Math.min(255, v)));
            }
            audioUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
        } catch (e) { audioUrl = ''; }
        return audioUrl;
    }

    function ensureAudio() {
        if (audioEl) return audioEl;
        try {
            audioEl = document.createElement('audio');
            audioEl.setAttribute('playsinline', '');
            audioEl.setAttribute('webkit-playsinline', '');
            audioEl.setAttribute('aria-hidden', 'true');
            audioEl.loop = true;
            audioEl.preload = 'auto';
            audioEl.volume = 1;                 // 内容本身是静音，音量大小无所谓，也不会出现嗡嗡声
            audioEl.src = wavUrl();
            audioEl.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
            (document.body || document.documentElement).appendChild(audioEl);

            // 【核心】用音频播放进度驱动心跳：后台 setInterval 会被降权，timeupdate 不会
            audioEl.addEventListener('timeupdate', function () {
                if (!enabled() && !npActive) return;
                tick();
                // 关键修复：防止 iOS 后台播放结束前无法自动 loop，提前 0.4 秒手动倒回
                var d = audioEl.duration;
                if (d && d > 0 && (d - audioEl.currentTime) < 0.4) {
                    try { audioEl.currentTime = 0; } catch (e) {}
                    play();
                }
            });
            // 只处理「真的停了」的情况；不要监听 suspend/stalled（缓冲时也会触发，会闪）
            ['pause', 'ended'].forEach(function (ev) {
                audioEl.addEventListener(ev, function () {
                    if ((!enabled() && !npActive) || restarting) return;
                    restarting = true;
                    setTimeout(function () {
                        restarting = false;
                        if ((!enabled() && !npActive) || !audioEl.paused) return;
                        play();
                    }, 1200);
                });
            });
        } catch (e) {}
        return audioEl;
    }

    var DEFAULT_ART = [
        { src: (window.NANO_ROOT || '') + 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: (window.NANO_ROOT || '') + 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ];
    function applyMetadata(meta) {
        try {
            if (!navigator.mediaSession || typeof window.MediaMetadata !== 'function') return;
            meta = meta || {};
            var art = meta.artwork;
            if (typeof art === 'string' && art) art = [{ src: art, sizes: '512x512', type: 'image/png' }];
            if (!Array.isArray(art) || !art.length) art = DEFAULT_ART;
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: meta.title || 'Nano 保活中',
                artist: meta.artist || '定时生成 / 自动消息继续运行',
                album: meta.album || 'Nano',
                artwork: art
            });
        } catch (e) {}
    }
    function setMediaSession() {
        try {
            if (!navigator.mediaSession || typeof window.MediaMetadata !== 'function') return;
            try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
            // 锁屏 / 灵动岛上的按钮：暂停不生效，播放会立刻续上
            try { navigator.mediaSession.setActionHandler('pause', function () {}); } catch (e) {}
            try { navigator.mediaSession.setActionHandler('play', function () { play(); }); } catch (e) {}
            if (npActive || mediaSet) return;     // 正在展示点评时不覆盖；默认元数据也只设一次
            mediaSet = true;
            applyMetadata(null);
        } catch (e) {}
    }

    function requestWakeLock() {
        try {
            if (!enabled() || !navigator.wakeLock || !navigator.wakeLock.request) return;
            navigator.wakeLock.request('screen').then(function (s) {
                wakeLock = s;
                try { s.addEventListener('release', function () { wakeLock = null; }); } catch (e) {}
            }).catch(function () {});
        } catch (e) {}
    }
    function releaseWakeLock() {
        try { if (wakeLock) wakeLock.release(); } catch (e) {}
        wakeLock = null;
    }

    function play() {
        var a = ensureAudio();
        if (!a) return;
        // iOS 17+：声明为 playback 音频会话，系统更不容易把页面挂起
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
        try {
            var p = a.play();
            if (p && p.catch) p.catch(function () {});
        } catch (e) {}
    }

    // ===== 灵动岛 / 锁屏「正在播放」：用保活音频 + MediaSession 展示 TA 的最新一句点评 =====
    // 说明：这占的是系统「媒体播放器」的位置（像音乐 App），只能显示 标题/艺术家/封面 + 播放控制，
    // 不能自定义界面或放按钮；且必须让（静音）音频真的在播放，通常需要保活已开启、或用户先触摸过页面。
    // 真·自定义灵动岛仍需原生 App（ActivityKit），见 docs/ios-shortcuts.md。
    function setNowPlaying(o) {
        o = o || {};
        npActive = true;
        try { ensureAudio(); bindUnlock(); } catch (e) {}
        play();
        applyMetadata({
            title: o.title || 'TA',
            artist: o.artist || o.text || '正在看你屏幕上的内容',
            album: o.album || 'Nano',
            artwork: o.artwork
        });
        try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        return true;
    }
    function clearNowPlaying() {
        npActive = false;
        mediaSet = false;
        applyMetadata(null);
    }

    function isRunning() {
        try { return !!(audioEl && !audioEl.paused); } catch (e) { return false; }
    }

    function writeState(running) {
        // 只在播放状态变化、或距上次写入超过 30 秒时才写（读取方 other.js 的过期窗口是 120 秒）
        var now = Date.now();
        running = !!running;
        if (running === lastStateRunning && now - lastStateAt < 30000) return;
        lastStateRunning = running;
        lastStateAt = now;
        try { localStorage.setItem(STATE, JSON.stringify({ running: running, at: now })); } catch (e) {}
    }

    // ===== 心跳 & 到期执行 =====
    function tick() {
        if (!enabled()) return;
        var now = Date.now();
        if (now - lastTick < TICK_MS) return;
        lastTick = now;
        writeState(isRunning());
        try { window.dispatchEvent(new CustomEvent('systemHeartbeat')); } catch (e) {}
        runDueTasks(now);
    }

    function runDueTasks(now) {
        if (!isTop) return;                  // 只有外壳负责执行队列，避免多个 iframe 重复弹通知
        var list = readTasks();
        if (!list.length) return;
        var due = [], pending = [];
        for (var i = 0; i < list.length; i++) {
            if ((Number(list[i] && list[i].at) || 0) <= now) due.push(list[i]);
            else pending.push(list[i]);
        }
        if (!due.length) return;
        writeTasks(pending);
        for (var j = 0; j < due.length; j++) {
            try { execTask(due[j]); } catch (e) {}
        }
    }

    function notifyTask(task) {
        var title = task.title || 'Nano';
        var body = task.body || '';
        var tag = task.tag || ('nano-task-' + (task.id || Date.now()));
        var opts = { force: true, target: task.target || '', channel: task.channel || '', tag: tag };
        // 优先 NanoNotify：内部会走 ServiceWorker + Bark（后台/锁屏也能到）
        try {
            if (window.NanoNotify && window.NanoNotify.notify) { window.NanoNotify.notify(title, body, opts); return; }
        } catch (e) {}
        // 兜底：SW showNotification → new Notification
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(function (reg) {
                    try {
                        if (reg && reg.showNotification) {
                            reg.showNotification(title, { body: body, tag: tag, data: { target: opts.target } });
                            return;
                        }
                    } catch (e) {}
                    try { new Notification(title, { body: body, tag: tag }); } catch (e) {}
                }).catch(function () {});
                return;
            }
            try { new Notification(title, { body: body, tag: tag }); } catch (e) {}
        } catch (e) {}
    }

    function fireDue(task, handled) {
        try { window.dispatchEvent(new CustomEvent('nanoTaskDue', { detail: { task: task, handled: !!handled } })); } catch (e) {}
        for (var i = 0; i < onDueCbs.length; i++) {
            try { onDueCbs[i](task, !!handled); } catch (e) {}
        }
    }

    // 广播给所有 iframe（聊天/朋友圈 frame 收到后调用 API 生成，并回 ack）
    function broadcast(task) {
        var frames;
        try { frames = document.querySelectorAll('iframe'); } catch (e) { frames = []; }
        for (var i = 0; i < frames.length; i++) {
            try {
                if (frames[i].contentWindow) frames[i].contentWindow.postMessage({ type: 'nanoTaskDue', task: task }, '*');
            } catch (e) {}
        }
    }

    function execGenerate(task) {
        var id = task.id || uid();
        var frames;
        try { frames = document.querySelectorAll('iframe'); } catch (e) { frames = []; }

        // 单页环境（没有 iframe）：任务拥有者就在本窗口，由 fireDue 派发本窗口事件，无需兜底通知
        if (!frames.length) {
            fireDue(task, false);
            return;
        }

        pendingAck[id] = true;
        broadcast(task);
        setTimeout(function () {
            if (!pendingAck[id]) return;         // 已被某个 frame 认领
            delete pendingAck[id];
            // 自动朋友圈 / 自动消息：只有在某个 frame 真正调用 API 生成并写入后
            // 才算完成。没有任何 frame 认领时，绝不能谎报「有新消息/新动态」——
            // 否则就会出现「通知有内容，点进去却是空的」的假消息。改为稍后重试。
            if (task.owner === 'autoMoment' || task.owner === 'autoMsg') {
                fireDue(task, false);
                var tries = Number(task._retries) || 0;
                if (tries < 3) {
                    try {
                        var retry = Object.assign({}, task);
                        retry.id = id;
                        retry._retries = tries + 1;
                        retry.at = Date.now() + 60000;
                        schedule(retry);
                    } catch (e) {}
                }
                return;
            }
            // 其他 generate 任务：没有 frame 生成就绝不弹通知（避免假消息），只派发事件
            fireDue(task, false);
        }, ACK_WAIT_MS);
    }

    function execTask(task) {
        if (!task) return;
        if (task.type === 'generate') { execGenerate(task); return; }
        notifyTask(task);
        fireDue(task, true);
    }

    // ===== 调度循环 =====
    function ensureLoop() {
        if (!isTop) return;
        if (fallbackTimer) return;
        fallbackTimer = setInterval(tick, FALLBACK_MS);   // 兜底
        tick();                                            // 立即跑一次
    }
    function stopLoop() {
        if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    }

    // ===== 公共 API =====
    function schedule(task) {
        if (!task) return null;
        var t = Object.assign({}, task);      // 保留 chatId 等调用方字段（generate 任务靠它匹配 frame）
        t.id = task.id || uid();
        t.at = Number(task.at) || Date.now();
        t.type = task.type || 'notify';
        t.title = task.title || '';
        t.body = task.body || '';
        t.target = task.target || '';
        t.channel = task.channel || '';
        t.tag = task.tag || '';
        t.owner = task.owner || '';
        if (t.chatId === undefined || t.chatId === null) t.chatId = '';
        if (t.data === undefined) t.data = null;

        var list = readTasks().filter(function (x) { return x && x.id !== t.id; });
        list.push(t);
        if (list.length > MAX_TASKS) {        // 队列上限：保留最早到期的 MAX_TASKS 条
            list.sort(function (a, b) { return (Number(a && a.at) || 0) - (Number(b && b.at) || 0); });
            list = list.slice(0, MAX_TASKS);
        }
        writeTasks(list);
        if (enabled()) { ensureLoop(); runDueTasks(Date.now()); }
        return t;
    }
    function scheduleNotification(title, body, delayMs, opts) {
        opts = opts || {};
        return schedule({
            id: opts.id, at: Date.now() + (Number(delayMs) || 0), type: 'notify',
            title: title, body: body, target: opts.target, channel: opts.channel,
            tag: opts.tag, owner: opts.owner
        });
    }
    function cancel(id) {
        if (!id) return;
        writeTasks(readTasks().filter(function (x) { return x && x.id !== id; }));
    }
    function tasks() { return readTasks(); }
    function clear() { writeTasks([]); }
    function onDue(cb) { if (typeof cb === 'function') onDueCbs.push(cb); }

    function enableLocal() {
        setFlag(true);
        bindUnlock();
        play();
        setMediaSession();
        requestWakeLock();
        ensureLoop();
    }

    function start() {
        setFlag(true);
        if (!isTop) {
            // 子页面：交给主框架统一播放，避免多份音频
            try { window.parent.postMessage({ type: 'keepAlive', enabled: true }, '*'); } catch (e) {}
            return;
        }
        enableLocal();
    }

    function stop() {
        setFlag(false);
        npActive = false;
        stopLoop();
        releaseWakeLock();
        try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
        try { if (audioEl) audioEl.pause(); } catch (e) {}
        if (!isTop) {
            try { window.parent.postMessage({ type: 'keepAlive', enabled: false }, '*'); } catch (e) {}
        }
    }

    // iOS 要求音频由用户手势解锁：开启保活后第一次触摸自动续播
    function bindUnlock() {
        if (unlocked) return;
        unlocked = true;
        var handler = function () {
            if (enabled()) { play(); setMediaSession(); if (isTop) ensureLoop(); }
            document.removeEventListener('touchend', handler, true);
            document.removeEventListener('click', handler, true);
        };
        document.addEventListener('touchend', handler, true);
        document.addEventListener('click', handler, true);
    }

    // 只信任本应用自己的 frame 发来的回执
    function isOwnFrameSource(src) {
        if (!src) return false;
        var frames;
        try { frames = document.querySelectorAll('iframe'); } catch (e) { return false; }
        for (var i = 0; i < frames.length; i++) {
            try { if (frames[i].contentWindow === src) return true; } catch (e) {}
        }
        return false;
    }

    // frame 认领到期任务后的确认，避免外壳重复弹通知
    window.addEventListener('message', function (e) {
        if (e.origin !== location.origin) return;             // 忽略跨源消息
        var d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'nanoTaskAck' && d.id && pendingAck[d.id]) {
            if (!isOwnFrameSource(e.source)) return;          // 只接受本应用 frame 的回执
            delete pendingAck[d.id];
            fireDue(d.task || { id: d.id }, true);
        }
    });

    // 切回前台 / 切页面时：恢复播放并补跑已到期任务（这就是「切页面也不丢推送」的关键）
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !enabled() || !isTop) return;
        play();
        setMediaSession();
        requestWakeLock();
        ensureLoop();
        runDueTasks(Date.now());
    });
    window.addEventListener('pageshow', function () {
        if (!enabled() || !isTop) return;
        play();
        ensureLoop();
        runDueTasks(Date.now());
    });
    window.addEventListener('focus', function () {
        if (enabled() && isTop) runDueTasks(Date.now());
    });

    window.NanoKeepAlive = {
        enabled: enabled,
        isRunning: isRunning,
        start: start,
        stop: stop,
        schedule: schedule,
        scheduleNotification: scheduleNotification,
        cancel: cancel,
        tasks: tasks,
        clear: clear,
        runDue: function () { if (isTop) runDueTasks(Date.now()); },
        onDue: onDue,
        setNowPlaying: setNowPlaying,
        clearNowPlaying: clearNowPlaying,
        // 主框架消息处理用
        apply: function (on) { on ? enableLocal() : stop(); },
        unlockAudio: bindUnlock
    };

    // 页面加载时若已开启：主框架自动续播并补跑；并对首次触摸做解锁
    if (enabled()) {
        bindUnlock();
        if (isTop) {
            try { enableLocal(); } catch (e) {}
            try { runDueTasks(Date.now()); } catch (e) {}
        }
    }
})();
