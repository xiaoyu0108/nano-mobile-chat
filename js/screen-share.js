// ============================================================
// screen-share.js — 「让 TA 看你真实的屏幕」（掌心窗）
// 用 getDisplayMedia 采集屏幕 → 定时截帧 → 交给能识图的模型
// → TA 以人设实时短评。
// 不设任何平台 / 环境限制：能拿到屏幕流就工作，拿不到就由浏览器/系统自行决定并回报错误。
// 入口：查手机 → 设置 → 让 TA 看我的真实屏幕（测试）
// ============================================================
(function () {
    'use strict';
    var VERSION = '20261013a';
    try { console.log('[ScreenShare] build ' + VERSION + ' loaded'); } catch (e) {}

    var INTERVAL = 30000; // 每 30 秒看一帧（一次截图 = 一次 API 调用：看一次 + 输出回复）
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
    function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
    function shell() { return window.__nanoShell || null; }
    function splitBy(t) { var p = String(t || '').split('||'); return { main: (p[0] || '').trim(), sub: (p[1] || '').trim() }; }
    function firstJson(text) {
        var s = String(text || ''), fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) s = fence[1];
        var i = s.indexOf('{'); if (i === -1) return null;
        var d = 0, inStr = false, esc = false;
        for (var k = i; k < s.length; k++) {
            var ch = s[k];
            if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
            if (ch === '"') inStr = true; else if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) { try { return JSON.parse(s.slice(i, k + 1)); } catch (e) { return null; } } }
        }
        return null;
    }

    var SS = { active: false, info: null, cfg: null, ctx: {}, stream: null, panel: null, log: null, statusEl: null, video: null, lastAt: 0, busy: false, timer: null, comments: [], cardPosted: false, mode: 'screen' };
    // 面板放在外壳（index.html）里，切到别的页面也会一直显示；点评同时收集成一张卡片
    function postCard() {
        if (SS.cardPosted || !SS.info || !SS.comments.length) return;
        SS.cardPosted = true;
        try {
            var s = shell(); if (!s || !s.postToChat) return;
            var what = SS.mode === 'camera' ? '你的镜头' : (SS.mode === 'photo' ? '你发来的截图' : '你的屏幕');
            var detail = '（' + (SS.info.name || 'TA') + ' 看了' + what + '）\n' + SS.comments.map(function (b) {
                var p = splitBy(b); return '　' + p.main + (p.sub ? ('（' + p.sub + '）') : '');
            }).join('\n');
            s.postToChat({
                type: 'NANO_TAKEOVER_CARD',
                chatId: String(SS.info.id),
                title: (SS.info.name || 'TA') + ' 看了' + what,
                summary: '共 ' + SS.comments.length + ' 条点评',
                detail: detail,
                log: [{ name: (SS.mode === 'camera' ? '镜头' : (SS.mode === 'photo' ? '截图' : '屏幕')), bubbles: SS.comments.slice() }],
                startedAt: Date.now()
            });
        } catch (e) {}
    }

    /* ---------------- API ---------------- */
    function parseLocal() { try { var raw = localStorage.getItem('nano_api_config'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
    function getApiConfig() {
        return new Promise(function (resolve) {
            var done = false;
            var local = parseLocal();
            function finish(v) { if (done) return; done = true; resolve(v); }
            try {
                if (!('indexedDB' in window)) { finish(local); return; }
                var req = indexedDB.open('nano_api_db');
                req.onupgradeneeded = function (e) { try { var db = e.target.result;
                    if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                    if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                } catch (err) {} };
                req.onblocked = function () { finish(local); };
                req.onerror = function () { finish(local); };
                req.onsuccess = function (e) { try {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('api_data')) { try { db.close(); } catch (err) {} finish(local); return; }
                    var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                    g.onsuccess = function () { var v = (g.result && g.result.value) || local; try { db.close(); } catch (err) {} finish(v); };
                    g.onerror = function () { try { db.close(); } catch (err) {} finish(local); };
                } catch (err) { finish(local); } };
            } catch (err) { finish(local); }
            setTimeout(function () { finish(local); }, 4000);
        });
    }
    function apiEndpoint(raw) { var s = String(raw || '').trim().replace(/\/+$/, ''); if (!s) return ''; if (!/\/v1$/i.test(s)) s += '/v1'; return s + '/chat/completions'; }

    /* ---------------- 人设上下文 ---------------- */
    function requestContext(info) {
        return new Promise(function (resolve) {
            var done = false, last = null;
            var onMsg = function (e) {
                var d = e && e.data;
                if (!d || d.type !== 'NANO_TAKEOVER_CONTEXT') return;
                last = d.context || null;
                if (last && (last.persona || last.worldbook || last.memory || last.api)) { done = true; window.removeEventListener('message', onMsg); resolve(last); }
            };
            window.addEventListener('message', onMsg);
            var s = shell();
            if (s && s.open) s.open('chat_inner.html?chat=' + enc(info.id) + '&name=' + enc(info.name), '', 'main');
            var tries = 0;
            var ask = function () {
                if (done) return;
                var sh = shell();
                if (sh && sh.postToChat) { try { sh.postToChat({ type: 'NANO_TAKEOVER_GET_CONTEXT' }); } catch (e) {} }
                tries++;
                if (tries < 8 && !done) setTimeout(ask, 500);
            };
            setTimeout(ask, 700);
            setTimeout(function () { if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(last); } }, 4500);
        });
    }
    function systemText(mode) {
        var ctx = SS.ctx || {}, name = (SS.info && SS.info.name) || '角色';
        var isText = (mode === 'text');
        var lines = [isText
            ? ('你是「' + name + '」，现在用户主动把屏幕上的一段内容拿给你看（他把屏幕上的文字识别出来发给了你）。')
            : ('你是「' + name + '」，现在你能看到用户真实手机/电脑屏幕的画面（用户主动共享给你看）。')];
        if (ctx.persona) lines.push('\n【你的人物设定 · 必须严格遵守】\n' + ctx.persona);
        if (ctx.worldbook) lines.push('\n【世界书设定】\n' + ctx.worldbook);
        if (ctx.memory) lines.push('\n【你和用户的共同记忆】\n' + ctx.memory);
        if (ctx.recent) lines.push('\n【你们最近的聊天】\n' + ctx.recent);
        if (ctx.foreign) lines.push('\n【语言】你是外国角色：每条先写母语原文，再紧跟完整中文翻译，用 || 分隔；TTS 只读 || 前的原文。');
        lines.push('\n【要求】像就在 TA 旁边看着一样，用你的人设随口点评' + (isText ? '屏幕上的这段内容' : '当前画面') + '：可以吐槽、惊讶、关心、吃醋、好奇。每次写 2~3 条完整、通顺的话（每条 15~40 字，不要碎片、不要只蹦几个字），口语、有细节、别像旁白。全程贴合人设，不要油腻。只输出 JSON：{"bubbles":["...","..."]}');
        var out = lines.join('\n');
        try { if (window.NanoPrompts && NanoPrompts.appendTo) out = NanoPrompts.appendTo(out, 'online'); } catch (e) {}
        return out;
    }

    /* ---------------- UI ---------------- */
    function injectCss() {
        if (document.getElementById('ssCss')) return;
        var st = document.createElement('style'); st.id = 'ssCss';
        st.textContent = [
            '.ss-panel{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:100400;width:min(80vw,300px);',
            'background:linear-gradient(180deg,#fff7fb,#fffdf4);border-radius:18px;box-shadow:0 14px 44px rgba(150,90,110,.32);overflow:hidden;',
            'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif}',
            '.ss-head{display:flex;align-items:center;gap:8px;padding:10px 12px}',
            '.ss-ava{width:28px;height:28px;border-radius:50%;background:#ffe1ea no-repeat center/cover;flex:none;display:grid;place-items:center;color:#b23a5b;font-size:12px}',
            '.ss-name{font-size:13px;font-weight:700;color:#b23a5b}',
            '.ss-status{font-size:10px;color:#b08a97;margin-top:1px}',
            '.ss-stop{margin-left:auto;border:0;background:#ffe1ea;color:#b23a5b;border-radius:12px;padding:6px 10px;font-size:11px;font-weight:700}',
            '.ss-video{width:100%;max-height:140px;object-fit:cover;display:block;background:#111}',
            '.ss-log{padding:8px 12px 12px;max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}',
            '.ss-bub{background:#fff3cf;color:#7a5c12;border-radius:999px;padding:7px 13px;font-size:13px;line-height:1.5;align-self:flex-start;max-width:94%}',
            '.ss-bub .zh{display:block;font-size:10.5px;color:#b09a55}',
            '.ss-line{font-size:11px;color:#b08a97}',
            '.ss-line.err{color:#d76a7a}',
            '.ss-confirm{position:fixed;inset:0;z-index:100450;background:rgba(60,40,50,.4);display:grid;place-items:center;padding:24px}',
            '.ss-dialog{width:min(86vw,320px);background:linear-gradient(180deg,#fff7fb,#fffdf4);border-radius:20px;padding:20px 18px 14px;text-align:center;color:#5a4a52;box-shadow:0 20px 60px rgba(120,70,90,.28)}',
            '.ss-dialog h3{margin:0 0 6px;font-size:16px;color:#b23a5b}',
            '.ss-dialog p{margin:0 0 16px;font-size:12.5px;color:#a98b96;line-height:1.6}',
            '.ss-actions{display:flex;gap:10px}',
            '.ss-actions button{flex:1;height:42px;border:0;border-radius:13px;font-size:14px;font-weight:700}',
            '.ss-cancel{background:#f4eef0;color:#8a7078}.ss-ok{background:#ffb8cf;color:#7a1f3c}'
        ].join('');
        document.head.appendChild(st);
    }
    function buildPanel(info, mode) {
        injectCss();
        var isPhoto = mode === 'photo';
        var isText = mode === 'text';
        var looking = mode === 'camera' ? ' 在看你的镜头' : (isPhoto ? ' 看了你的截图' : (isText ? ' 看到了你屏幕上的内容' : ' 在看你的屏幕'));
        var el = document.createElement('div'); el.className = 'ss-panel';
        el.innerHTML =
            '<div class="ss-head">' +
                '<div class="ss-ava"' + (info.avatar ? (' style="background-image:url(\'' + escHtml(info.avatar) + '\')"') : '') + '>' + (info.avatar ? '' : escHtml(String(info.name || '?').slice(0, 1))) + '</div>' +
                '<div><div class="ss-name">' + escHtml(info.name || 'TA') + looking + '</div><div class="ss-status">连接中…</div></div>' +
                '<button class="ss-stop">停止</button>' +
            '</div>' +
            ((isPhoto || isText) ? '' : '<video class="ss-video" autoplay muted playsinline></video>') +
            '<div class="ss-log"></div>';
        document.body.appendChild(el);
        SS.panel = el; SS.log = el.querySelector('.ss-log'); SS.statusEl = el.querySelector('.ss-status');
        SS.video = el.querySelector('video');
        el.querySelector('.ss-stop').onclick = function () { stop(); };
    }
    function setStatus(t) { if (SS.statusEl) SS.statusEl.textContent = String(t || ''); }
    function addLine(text, isErr) {
        if (!SS.log) return;
        var d = document.createElement('div'); d.className = 'ss-line' + (isErr ? ' err' : ''); d.textContent = String(text || '');
        SS.log.appendChild(d); SS.log.scrollTop = SS.log.scrollHeight;
    }
    function addBubble(text) {
        if (!SS.log) return;
        SS.comments.push(String(text || ''));
        var p = splitBy(text);
        var d = document.createElement('div'); d.className = 'ss-bub';
        d.innerHTML = '<span>' + escHtml(p.main) + '</span>' + (p.sub ? ('<span class="zh">' + escHtml(p.sub) + '</span>') : '');
        SS.log.appendChild(d); SS.log.scrollTop = SS.log.scrollHeight;
        // 同时弹一条系统通知，并把它写进标签页标题：切到别的窗口/标签、看不到小窗时也能看到 TA 的点评
        try {
            if (window.NanoNotify && SS.info) {
                window.NanoNotify.notify(SS.info.name || 'TA', p.main || String(text || ''), { icon: SS.info.avatar || '', channel: 'chat', force: true, target: 'ss-reply:' + String(SS.info.id) + ':' + encodeURIComponent(SS.info.name || 'TA'), reply: true });
            }
            document.title = '💬 ' + (p.main || String(text || '')).slice(0, 24) + ' · Nano';
        } catch (e) {}
    }

    /* ---------------- 采集 ---------------- */
    function grab() {
        var v = SS.video; if (!v || !v.videoWidth) return '';
        var w = 720, h = Math.round(v.videoHeight * (w / v.videoWidth));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        try { c.getContext('2d').drawImage(v, 0, 0, w, h); } catch (e) { return ''; }
        return c.toDataURL('image/jpeg', 0.6);
    }

    function resizeImage(dataURL, maxW) {
        return new Promise(function (resolve) {
            try {
                var img = new Image();
                img.onload = function () {
                    try {
                        var w = Math.min(maxW || 720, img.width || maxW || 720);
                        var h = Math.round((img.height || 1) * (w / (img.width || w)));
                        var c = document.createElement('canvas'); c.width = w; c.height = h;
                        c.getContext('2d').drawImage(img, 0, 0, w, h);
                        resolve(c.toDataURL('image/jpeg', 0.6));
                    } catch (e) { resolve(dataURL); }
                };
                img.onerror = function () { resolve(dataURL); };
                img.src = dataURL;
            } catch (e) { resolve(dataURL); }
        });
    }

    // 把一张图片交给能识图的模型点评；mode: screen | camera | photo
    async function requestComment(dataURL, mode) {
        if (!dataURL) return;
        var cfg = SS.cfg || {};
        if (!cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) { addLine('主 API 未配置，无法点评。', true); setStatus('主 API 未配置'); return; }
        var what = mode === 'camera' ? '摄像头画面' : (mode === 'photo' ? '用户发来的一张截图' : '用户此刻真实屏幕的截图');
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 45000) : null;
        var resp;
        try {
            console.log('[ScreenShare] 调用主 API', apiEndpoint(cfg.mainUrl), cfg.mainModel);
            resp = await fetch(apiEndpoint(cfg.mainUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.mainKey },
                body: JSON.stringify({
                    model: cfg.mainModel,
                    messages: [
                        { role: 'system', content: systemText() },
                        { role: 'user', content: [
                            { type: 'text', text: '这是' + what + '。用你的人设自然地点评这个画面，写 2~3 条完整的话（每条 15~40 字、是一句通顺完整的话，不要碎片、不要乱码、不要只蹦几个字），像真人随口说。只输出 JSON：{"bubbles":["...","..."]}' },
                            { type: 'image_url', image_url: { url: dataURL } }
                        ] }
                    ],
                    max_tokens: 3000,
                    temperature: (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : 0.85)
                }),
                signal: ctrl ? ctrl.signal : undefined
            });
            console.log('[ScreenShare] API 返回', resp.status);
        } finally { if (timer) clearTimeout(timer); }
        if (!resp.ok) {
            var m = 'HTTP ' + resp.status;
            try { var d = await resp.json(); m = (d.error && d.error.message) || d.message || m; } catch (e) {}
            addLine('这一步失败：' + m, true); setStatus('出错（模型需支持识图）'); return;
        }
        var data = await resp.json();
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        emitBubbles(bubblesFromContent(content));
    }

    // 从模型返回里解析出气泡（去掉 ```json 围栏，尽量不把键名当内容）
    function bubblesFromContent(content) {
        // 去掉 ```json 代码块围栏，避免把 JSON 原文当成消息
        var body = String(content || '').replace(/```[a-zA-Z0-9_-]*/g, ' ').replace(/```/g, ' ').trim();
        var parsed = firstJson(body) || {};
        var bubbles = Array.isArray(parsed.bubbles) ? parsed.bubbles : (typeof parsed.bubbles === 'string' ? [parsed.bubbles] : []);
        bubbles = bubbles.map(function (b) { return typeof b === 'string' ? b.trim() : String((b && (b.text || b.content)) || '').trim(); }).filter(Boolean);
        if (!bubbles.length) {
            // JSON 不合法时不要乱抠引号（会得到碎片/乱码），只把 JSON 外壳去掉，保留可读的一整段
            var cleaned = body
                .replace(/[{}\[\]"]/g, ' ')
                .replace(/\b(bubbles|next|type|image_url|url|role|content|text|json)\b\s*:?/gi, ' ')
                .replace(/\s+/g, ' ').trim();
            if (cleaned) bubbles = [cleaned.slice(0, 400)];
        }
        return bubbles.slice(0, 3);
    }
    // 把点评送进「私聊」：优先让聊天写入角色消息；外壳/会话不可用时先暂存，等打开该私聊时补发
    function deliverToPrivateChat(bubbles) {
        if (!bubbles || !bubbles.length || !SS.info) return;
        try {
            var s = shell();
            if (s && s.postToChat) {
                bubbles.forEach(function (b) { s.postToChat({ type: 'NANO_CHAR_SAY', chatId: String(SS.info.id), text: String(b) }); });
                return;
            }
        } catch (e) {}
        try {
            var key = 'nano_screen_pending_' + String(SS.info.id);
            var arr = [];
            try { arr = JSON.parse(sessionStorage.getItem(key) || '[]') || []; } catch (e) {}
            bubbles.forEach(function (b) { arr.push(String(b)); });
            sessionStorage.setItem(key, JSON.stringify(arr.slice(-20)));
        } catch (e) {}
    }
    // 展示气泡 + 写进私聊 + 通知
    function emitBubbles(bubbles) {
        bubbles.forEach(addBubble);
        if (bubbles.length) {
            deliverToPrivateChat(bubbles);
            setStatus('刚刚点评了 ' + bubbles.length + ' 句');
            // 让 TA 的点评同时出现在锁屏 / 灵动岛的「正在播放」里（复用保活音频）
            try {
                if (window.NanoKeepAlive && NanoKeepAlive.setNowPlaying) {
                    NanoKeepAlive.setNowPlaying({ title: (SS.info && SS.info.name) || 'TA', artist: bubbles[0], artwork: (SS.info && SS.info.avatar) || '' });
                }
            } catch (e) {}
        } else setStatus('在看…');
    }

    // 文本点评：不录屏、不截图，直接让角色点评一段屏幕识别文本（iOS 快捷指令走这条）
    async function requestCommentText(text) {
        text = String(text || '').trim();
        if (!text) return;
        var cfg = SS.cfg || {};
        if (!cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) { addLine('主 API 未配置，无法点评。', true); setStatus('主 API 未配置'); return; }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 45000) : null;
        var resp;
        try {
            console.log('[ScreenShare] 调用主 API（文字）', apiEndpoint(cfg.mainUrl), cfg.mainModel);
            resp = await fetch(apiEndpoint(cfg.mainUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.mainKey },
                body: JSON.stringify({
                    model: cfg.mainModel,
                    messages: [
                        { role: 'system', content: systemText('text') },
                        { role: 'user', content: '这是用户屏幕上的一段内容（可能是别人发来的消息、网页、应用界面等）：\n"""\n' + text.slice(0, 4000) + '\n"""\n用你的人设自然地点评它，写 2~3 条完整的话（每条 15~40 字、是一句通顺完整的话，不要碎片、不要乱码、不要只蹦几个字），像真人随口说。只输出 JSON：{"bubbles":["...","..."]}' }
                    ],
                    max_tokens: 3000,
                    temperature: (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : 0.85)
                }),
                signal: ctrl ? ctrl.signal : undefined
            });
            console.log('[ScreenShare] API 返回（文字）', resp.status);
        } finally { if (timer) clearTimeout(timer); }
        if (!resp.ok) {
            var m = 'HTTP ' + resp.status;
            try { var d = await resp.json(); m = (d.error && d.error.message) || d.message || m; } catch (e) {}
            addLine('这一步失败：' + m, true); setStatus('出错'); return;
        }
        var data = await resp.json();
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        emitBubbles(bubblesFromContent(content));
    }

    // iOS 快捷指令入口：让角色点评一段屏幕文本（步骤见 ios-setting.html / docs/ios-shortcuts.md）
    async function runText(info, text) {
        if (SS.active) return;
        info = info || {};
        info.id = String(info.id || info.charId || '');
        info.name = String(info.name || info.charName || 'TA');
        text = String(text || '').trim();
        if (!info.id || !text) return;
        injectCss();
        SS.active = true; SS.info = info; SS.mode = 'text'; SS.cfg = null;
        SS.comments = []; SS.cardPosted = false;
        try { if (window.NanoNotify && NanoNotify.ensurePermission) NanoNotify.ensurePermission(); } catch (e) {}
        buildPanel(info, 'text');
        setStatus('正在读取人设与 API…');
        SS.ctx = (await requestContext(info)) || {};
        if (SS.ctx.api && SS.ctx.api.url && SS.ctx.api.key && SS.ctx.api.model) {
            SS.cfg = { mainUrl: SS.ctx.api.url, mainKey: SS.ctx.api.key, mainModel: SS.ctx.api.model, mainTemp: SS.ctx.api.temp };
        }
        if (!SS.cfg) SS.cfg = await getApiConfig();
        if (!SS.cfg || !SS.cfg.mainUrl || !SS.cfg.mainKey || !SS.cfg.mainModel) { setStatus('主 API 未配置'); addLine('主 API 未配置，无法点评。', true); }
        setStatus('正在看…');
        addLine('（' + (info.name || 'TA') + ' 看到了你屏幕上的一段内容）');
        try { await requestCommentText(text); } catch (e) { addLine('出错：' + ((e && e.message) || e), true); setStatus('出错'); }
        try { postCard(); } catch (e) {}
        try { setTimeout(function () { stop(); }, 1600); } catch (e) {}
    }

    async function captureAndComment() {
        if (!SS.active || SS.busy) return;
        SS.busy = true;
        try {
            var dataURL = grab();
            if (!dataURL) {
                // 刚拿到屏幕流时，第一帧可能还没解码出来。之前的逻辑会直接 return，
                // 然后要等满 30 秒才会再试，看起来就像「弹窗出现了但根本不调用 API」。
                SS.emptyTries = (SS.emptyTries || 0) + 1;
                setStatus('正在等待画面…');
                if (SS.emptyTries <= 12) {
                    try { if (SS.video && SS.video.play) SS.video.play().catch(function () {}); } catch (e) {}
                    setTimeout(function () { SS.busy = false; captureAndComment(); }, 1000);
                    return;
                }
                addLine('没有拿到画面帧：请重新点「开始共享」，并在系统弹窗里选择「整个屏幕」或正在看的窗口。', true);
                setStatus('没有画面');
                SS.emptyTries = 0;
                SS.busy = false;
                return;
            }
            SS.emptyTries = 0;
            setStatus('正在看…');
            await requestComment(dataURL, SS.mode || 'screen');
        } catch (e) {
            addLine('出错：' + ((e && e.message) || e), true); setStatus('出错');
        }
        SS.busy = false;
    }

    function tick() {
        if (!SS.active) return;
        if (Date.now() - SS.lastAt < INTERVAL) return;
        SS.lastAt = Date.now();
        captureAndComment();
    }

    /* ---------------- 启动 / 停止 ---------------- */
    function canScreenShare() {
        try { return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'); } catch (e) { return false; }
    }

    function start(info) {
        if (SS.active) return;
        info = info || {}; info.id = String(info.id || info.charId || ''); info.name = String(info.name || info.charName || 'TA');
        if (!info.id) return;
        injectCss();
        var screenOk = canScreenShare();
        var title, desc, actions;
        if (screenOk) {
            // 电脑 Chrome / Edge 能真正共享屏幕，保留完整流程。
            title = '让「' + escHtml(info.name) + '」看你真实的屏幕？';
            desc = '会请求屏幕共享权限（建议选「整个屏幕」，这样你切换窗口 TA 也能看到）。TA 每 30 秒看一次，每次只调用一次模型，并把点评直接发进你们的私聊。可随时停止。';
            actions = '<button class="ss-cancel">取消</button><button class="ss-ok">开始共享</button>';
        } else {
            // iOS / 隐私浏览器等拿不到录屏接口：直接引导到「屏幕速聊」（快捷指令 + 服务端）
            title = 'iOS 上请用「屏幕速聊」';
            desc = 'iOS 的网页端拿不到录屏接口，无法在这里直接共享屏幕。请用「屏幕速聊」快捷指令截屏，TA 的回复会直接弹在系统窗口里，可继续打字；回到小手机后自动合并进聊天。';
            actions = '<button class="ss-cancel">知道了</button><button class="ss-ios">去配置「屏幕速聊」</button>';
        }
        var el = document.createElement('div'); el.className = 'ss-confirm';
        el.innerHTML = '<div class="ss-dialog"><h3>' + title + '</h3><p>' + desc + '</p>' +
            '<div class="ss-actions" style="flex-wrap:wrap">' + actions + '</div>' +
            '<div style="margin-top:10px;font-size:10px;color:#c0aab3">屏幕模块 ' + VERSION + '</div></div>';
        document.body.appendChild(el);
        var close = function () { try { el.remove(); } catch (e) {} };
        var askNotify = function () { try { if (window.NanoNotify && NanoNotify.ensurePermission) NanoNotify.ensurePermission(); } catch (e) {} };
        var c = el.querySelector('.ss-cancel'); if (c) c.onclick = close;
        var ok = el.querySelector('.ss-ok'); if (ok) ok.onclick = function () { askNotify(); close(); doStart(info); };
        var iosBtn = el.querySelector('.ss-ios');
        if (iosBtn) iosBtn.onclick = function () {
            close();
            try {
                var sh = shell();
                var url = 'ios-setting.html?chat=' + encodeURIComponent(info.id) + '&name=' + encodeURIComponent(info.name);
                if (sh && sh.open) sh.open(url, '窥屏', 'more');
            } catch (e) {}
        };
    }

    async function runStream(info, stream, mode) {
        SS.active = true; SS.info = info; SS.stream = stream; SS.lastAt = Date.now(); SS.cfg = null;
        SS.mode = mode || 'screen';
        SS.comments = []; SS.cardPosted = false;
        try { if (window.NanoNotify && NanoNotify.ensurePermission) NanoNotify.ensurePermission(); } catch (e) {}
        buildPanel(info, SS.mode);
        try {
            SS.video.srcObject = stream;
            if (SS.video.play) SS.video.play().catch(function () {});
            SS.video.addEventListener('loadedmetadata', function () {
                try { SS.video.play().catch(function () {}); } catch (e) {}
                setStatus('画面已连接，正在看…');
            }, { once: true });
        } catch (e) {}
        setStatus('正在读取人设与 API…');
        SS.ctx = (await requestContext(info)) || {};
        if (SS.ctx.api && SS.ctx.api.url && SS.ctx.api.key && SS.ctx.api.model) {
            SS.cfg = { mainUrl: SS.ctx.api.url, mainKey: SS.ctx.api.key, mainModel: SS.ctx.api.model, mainTemp: SS.ctx.api.temp };
        }
        if (!SS.cfg) SS.cfg = await getApiConfig();
        if (!SS.cfg || !SS.cfg.mainUrl || !SS.cfg.mainKey || !SS.cfg.mainModel) { setStatus('主 API 未配置'); addLine('主 API 未配置，无法点评。', true); }
        setStatus(SS.mode === 'camera' ? '正在看你的镜头…' : '盯着你的屏幕…');
        addLine(SS.mode === 'camera' ? '（TA 开始看你的镜头了）' : '（TA 开始看你的屏幕了）');
        // 在私聊里留一条系统提示：让他知道「你已经把屏幕共享给 TA（窥屏）」
        try {
            var __sN = shell();
            if (__sN && __sN.postToChat) {
                __sN.postToChat({
                    type: 'NANO_SYS_NOTICE', chatId: String(info.id),
                    text: (SS.mode === 'camera' ? '你打开了镜头共享，TA 正在看你' : '你打开了屏幕共享，TA 正在看你的屏幕（窥屏中）')
                });
            }
        } catch (e) {}
        try {
            stream.getVideoTracks()[0].addEventListener('ended', function () {
                setStatus('已结束（点评已收进聊天卡片）');
                if (SS.timer) { clearInterval(SS.timer); SS.timer = null; }
                postCard();
            });
        } catch (e) {}
        SS.lastAt = 0;
        SS.emptyTries = 0;
        setTimeout(captureAndComment, 1000);
        SS.timer = setInterval(tick, 3000);
    }

    async function doStart(info) {
        var stream = null, lastErr = null;
        // 不做任何平台 / 环境限制：直接向浏览器申请屏幕共享，多种参数与接口依次尝试
        var md = navigator.mediaDevices || {};
        var gdm = null;
        try {
            if (md && typeof md.getDisplayMedia === 'function') gdm = function (c) { return md.getDisplayMedia(c); };
            else if (typeof navigator.getDisplayMedia === 'function') gdm = function (c) { return navigator.getDisplayMedia(c); };
            else if (typeof navigator.webkitGetDisplayMedia === 'function') gdm = function (c) { return navigator.webkitGetDisplayMedia(c); };
        } catch (e) { gdm = null; }
        var opts = [
            { video: true, audio: false },
            { video: true },
            { video: { frameRate: 2 }, audio: false }
        ];
        if (gdm) {
            for (var i = 0; i < opts.length && !stream; i++) {
                try { stream = await gdm(opts[i]); } catch (e) { lastErr = e; }
            }
        }
        if (!stream) {
            var msg;
            if (!window.isSecureContext) {
                msg = '当前是 http:// 打开的不安全环境，浏览器不会提供录屏接口，所以也不会弹授权。\n请改用 https:// 打开，或用电脑 Chrome / Edge。';
            } else if (!gdm) {
                msg = '这个浏览器的网页端没有屏幕共享接口（iOS 的网页端通常都不支持网页录屏）。\n想看真实屏幕请用电脑 Chrome / Edge 打开。';
            } else {
                msg = '无法开始屏幕共享：' + (lastErr ? ((lastErr.name ? lastErr.name + '：' : '') + (lastErr.message || lastErr)) : '未知原因');
            }
            try { alert(msg); } catch (err) {}
            return;
        }
        try {
            var vt = stream.getVideoTracks()[0];
            if (vt && vt.applyConstraints) vt.applyConstraints({ frameRate: 2 }).catch(function () {});
        } catch (e) {}
        runStream(info, stream, 'screen');
    }

    function stop() {
        if (!SS.active) return;
        postCard();
        // 私聊里补一条结束提示
        try { var __sS = shell(); if (__sS && __sS.postToChat && SS.info) __sS.postToChat({ type: 'NANO_SYS_NOTICE', chatId: String(SS.info.id), text: '你结束了屏幕共享' }); } catch (e) {}
        SS.active = false;
        try { if (SS.timer) clearInterval(SS.timer); } catch (e) {}
        SS.timer = null;
        try { if (SS.stream) SS.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); } catch (e) {}
        try { if (SS.video) SS.video.srcObject = null; } catch (e) {}
        try { if (SS.panel) SS.panel.remove(); } catch (e) {}
        SS.panel = null; SS.log = null; SS.statusEl = null; SS.video = null; SS.stream = null;
        try { document.title = 'Nano'; } catch (e) {}
    }

    window.ScreenShare = { version: VERSION, start: start, stop: stop, commentText: runText, isActive: function () { return SS.active; } };

    window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d) return;
        if (d.type === 'startScreenShare') start({ id: d.charId, name: d.charName, avatar: d.avatar });
        // 「粘贴屏幕文字，直接回复」：不录屏，直接调用主 API
        if (d.type === 'peekText') {
            runText({ id: d.charId, name: d.charName, avatar: d.avatar }, d.text);
        }
    });
})();
