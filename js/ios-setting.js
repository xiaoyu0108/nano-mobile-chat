// ============================================================
// ios-setting.js — iOS「快捷指令 · 窥屏」图形化配置
// 读取角色库 + 主 API（无需单独配置），生成可直接粘贴进
// 「快捷指令」的接口、令牌、请求体 JSON 与完整步骤。
// 换角色时自动更新角色 ID 和 JSON。
// 原理与灵动岛做法见 docs/ios-shortcuts.md
// ============================================================
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function setText(id, v) { var el = $(id); if (el) el.textContent = String(v == null ? '' : v); }

    function appId() {
        var s = '';
        try {
            var root = window.NANO_ROOT || new URL('./', location.href).href;
            var u = new URL(root, location.href);
            s = u.origin + u.pathname.replace(/\/+$/, '');
        } catch (e) { s = String(location.origin || '') + String(location.pathname || ''); }
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return 'app_' + h.toString(36);
    }
    function deviceId() {
        var id = '';
        try { id = localStorage.getItem('nano_device_id') || ''; } catch (e) {}
        if (!id) {
            id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            try { localStorage.setItem('nano_device_id', id); } catch (e) {}
        }
        return id || 'default';
    }
    function currentUserId() {
        try {
            var hd = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
            if (hd && hd.currentMaskId) return String(hd.currentMaskId);
            if (hd && Array.isArray(hd.masks) && hd.masks[0] && hd.masks[0].id) return String(hd.masks[0].id);
        } catch (e) {}
        return 'default';
    }

    var toastEl = $('isToast'), toastTimer = null;
    function toast(msg) {
        if (!toastEl) return;
        toastEl.textContent = String(msg || '');
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1700);
    }
    function copy(text) {
        text = String(text || '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });
        } else fallbackCopy(text);
    }
    function fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
            toast('已复制');
        } catch (e) { toast('复制失败，请长按选择'); }
    }

    /* ---------------- 数据读取 ---------------- */
    function idbGetAll(dbName, store) {
        return new Promise(function (resolve) {
            var done = false;
            function fin(v) { if (!done) { done = true; resolve(v); } }
            try {
                if (!('indexedDB' in window)) { fin([]); return; }
                var req = indexedDB.open(dbName);
                req.onerror = function () { fin([]); };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(store)) { try { db.close(); } catch (x) {} fin([]); return; }
                        var r = db.transaction(store, 'readonly').objectStore(store).getAll();
                        r.onsuccess = function () { var v = r.result || []; try { db.close(); } catch (x) {} fin(v); };
                        r.onerror = function () { try { db.close(); } catch (x) {} fin([]); };
                    } catch (err) { fin([]); }
                };
            } catch (e) { fin([]); }
            setTimeout(function () { fin([]); }, 2500);
        });
    }
    function idbGetOne(dbName, store, key) {
        return new Promise(function (resolve) {
            var done = false;
            function fin(v) { if (!done) { done = true; resolve(v); } }
            try {
                if (!('indexedDB' in window)) { fin(null); return; }
                var req = indexedDB.open(dbName);
                req.onerror = function () { fin(null); };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(store)) { try { db.close(); } catch (x) {} fin(null); return; }
                        var r = db.transaction(store, 'readonly').objectStore(store).get(key);
                        r.onsuccess = function () { var v = r.result ? r.result.value : null; try { db.close(); } catch (x) {} fin(v); };
                        r.onerror = function () { try { db.close(); } catch (x) {} fin(null); };
                    } catch (err) { fin(null); }
                };
            } catch (e) { fin(null); }
            setTimeout(function () { fin(null); }, 2500);
        });
    }
    function readApiConfig() {
        return idbGetOne('nano_api_db', 'api_data', 'nano_api_config').then(function (cfg) {
            if (cfg && (cfg.mainUrl || cfg.mainKey || cfg.mainModel)) return cfg;
            try { var raw = localStorage.getItem('nano_api_config'); if (raw) return JSON.parse(raw); } catch (e) {}
            return cfg || null;
        });
    }

    /* ---------------- 屏幕速聊（快捷指令 + 服务端） ---------------- */
    var PEEK_URL_KEY = 'nano_peek_url', PEEK_TOKEN_KEY = 'nano_peek_token', PEEK_CHAT_KEY = 'nano_peek_chat', PEEK_CHATS_KEY = 'nano_peek_chats';
    var PEEK_INIT_TOKEN_KEY = 'nano_peek_token_initial';
    var PEEK_DEFAULT_URL = 'https://nanopush.nano315.online';

    function getPeekUrl() {
        var url = '';
        try { url = localStorage.getItem(PEEK_URL_KEY) || ''; } catch (e) {}
        return String(url || PEEK_DEFAULT_URL).trim();
    }
    function peekBase(url) {
        var base = String(url || '').trim().replace(/\/+$/, '');
        if (/\/peek$/i.test(base)) base = base.replace(/\/peek$/i, '');
        return base;
    }
    function newPeekToken() {
        return 'pk_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    }
    function getPeekToken() {
        var t = '';
        try { t = localStorage.getItem(PEEK_TOKEN_KEY) || ''; } catch (e) {}
        if (!t) {
            // 第一次生成时记下这个站点/浏览器的初始令牌，仅用于旧数据迁移。
            try { t = localStorage.getItem(PEEK_INIT_TOKEN_KEY) || ''; } catch (e) {}
            if (!t) t = newPeekToken();
            try { localStorage.setItem(PEEK_TOKEN_KEY, t); } catch (e) {}
        }
        // 老版本已有令牌的用户：补记初始令牌，避免 localStorage 被清后换掉旧数据分区。
        try {
            if (!localStorage.getItem(PEEK_INIT_TOKEN_KEY)) localStorage.setItem(PEEK_INIT_TOKEN_KEY, t);
        } catch (e) {}
        return t;
    }
    function resetPeekConfig() {
        // 每次还原都换一枚新 pk：旧快捷指令/旧 PEEK_TOKEN 立即失效，避免“还原了但看起来没变”。
        var tok = newPeekToken();
        try {
            localStorage.setItem(PEEK_INIT_TOKEN_KEY, tok);
            localStorage.setItem(PEEK_TOKEN_KEY, tok);
            localStorage.setItem(PEEK_URL_KEY, PEEK_DEFAULT_URL);
            // Web Push 和窥屏共用同一个 Worker，地址一起还原
            localStorage.setItem('nano_push_endpoint', PEEK_DEFAULT_URL);
            localStorage.removeItem('nano_push_vapid');
            // 清掉人设同步缓存，下一次会用新令牌重新同步
            clearPeekSyncCache();
        } catch (e) {}
        var urlInput = $('isPeekUrl');
        if (urlInput) urlInput.value = PEEK_DEFAULT_URL;
        rememberChat(selectedId);
        refresh();
        toast('已还原地址并生成新的 pk');
    }
    function rememberChat(id) {
        id = String(id || '');
        if (!id) return;
        try { localStorage.setItem(PEEK_CHAT_KEY, id); } catch (e) {}
        try {
            var ids = JSON.parse(localStorage.getItem(PEEK_CHATS_KEY) || '[]');
            if (!Array.isArray(ids)) ids = [];
            ids = ids.map(String);
            if (ids.indexOf(id) === -1) ids.push(id);
            localStorage.setItem(PEEK_CHATS_KEY, JSON.stringify(ids.slice(-10)));
        } catch (e) {}
    }

    function peekBody(kind) {
        var body = { chatId: String(selectedId || ''), appId: appId(), token: getPeekToken() };
        if (kind === 'image') body.image = 'data:image/jpeg;base64,<把上一步的 Base64 结果插到这里>';
        else body.text = '<把「要求输入」拿到的文字插到这里>';
        return JSON.stringify(body);
    }

    function endpoint(raw) {
        var s = String(raw || '').trim().replace(/\/+$/, '');
        if (!s) return '';
        if (!/\/v1$/i.test(s)) s += '/v1';
        return s + '/chat/completions';
    }

    /* ---------------- 状态 ---------------- */
    var chars = [], apiCfg = null, selectedId = '', base = '';

    function currentChar() { for (var i = 0; i < chars.length; i++) if (String(chars[i].id) === String(selectedId)) return chars[i]; return null; }
    function charName() { var c = currentChar(); return c ? (c.name || c.id) : '角色'; }
    function persona() { var c = currentChar(); return c ? String(c.setting || c.desc || c.persona || '') : ''; }

    function recentFromArray(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.filter(function (m) {
            return m && m.text && !m.isCard && !m.recalled && (m.type === 'left' || m.type === 'right');
        }).slice(-12).map(function (m) {
            return { role: m.type === 'right' ? 'user' : 'assistant', content: String(m.text).slice(0, 900) };
        });
    }
    function recentContext() {
        // chat-core 在 IndexedDB 保存消息时同步维护了轻量镜像；优先读它，否则窥屏人设里
        // 永远看不到你们刚聊过什么（旧 localStorage 副本在有 IndexedDB 时不会写）。
        try {
            var mirror = localStorage.getItem('nano_recent_text_' + selectedId);
            if (mirror) {
                var list = JSON.parse(mirror);
                if (Array.isArray(list) && list.length) {
                    return list.slice(-12).map(function (m) {
                        return { role: m.who === 'user' ? 'user' : 'assistant', content: String(m.text || '').slice(0, 900) };
                    }).filter(function (m) { return m.content; });
                }
            }
        } catch (e) {}
        try {
            var arr = JSON.parse(localStorage.getItem('chat_messages_' + selectedId) || '[]');
            return recentFromArray(arr);
        } catch (e) { return []; }
    }
    async function recentContextAsync() {
        var got = recentContext();
        if (got.length) return got;
        try {
            if (typeof localforage === 'undefined' || !localforage.getItem) return got;
            return recentFromArray(await localforage.getItem('chat_messages_' + selectedId));
        } catch (e) { return got; }
    }

    // 和私聊同一套人设 / 世界规则 / 最近上下文，不再只是「人设原文 + 一句点评」。
    function fullPeekSystem(ctxOverride) {
        var c = currentChar();
        var name = charName();
        var p = '你是「' + name + '」，一个真实的人，不是 AI、不是助手、不是模型。\n';
        if (c) {
            if (c.gender && c.gender !== '未知') p += '性别：' + c.gender + '\n';
            if (c.nationality && c.nationality !== '未知') p += '国籍：' + c.nationality + '\n';
        }
        p += persona() || '';
        try {
            if (window.NanoPrompts && NanoPrompts.appendTo) p = NanoPrompts.appendTo(p, 'online');
        } catch (e) {}
        var ctx = Array.isArray(ctxOverride) ? ctxOverride : recentContext();
        if (ctx.length) {
            p += '\n【你们最近的聊天】\n' + ctx.map(function (m) {
                return (m.role === 'user' ? '对方：' : name + '：') + m.content;
            }).join('\n').slice(0, 3500) + '\n';
        }
        p += '\n保持人设，绝不 OOC，不要 AI 助手腔，不要替对方说话。';
        p += '\n现在你看到了对方手机屏幕上的画面/文字。用你的人设自然点评 2~3 句，像真人随口说，不要像 AI 助手汇报。';
        return p;
    }

    // 把私聊里的世界书 / 长期记忆也带上。只有一句人设时，快捷指令最容易 OOC。
    function readWalletBalance() {
        return new Promise(function (resolve) {
            try {
                var uid = 'm_default';
                try {
                    var h = JSON.parse(localStorage.getItem('nano_mask_data') || 'null') ||
                        JSON.parse(localStorage.getItem('nano_home_data') || 'null') || null;
                    uid = String((h && (h.currentMaskId || (h.masks && h.masks[0] && h.masks[0].id))) || 'm_default');
                } catch (e) {}
                var req = indexedDB.open('nano_wallet_db', 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('wallet_data')) d.createObjectStore('wallet_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var store = e.target.result.transaction('wallet_data', 'readonly').objectStore('wallet_data');
                        var r = store.get('wallet_data__' + uid);
                        r.onsuccess = function () {
                            var v = r.result && r.result.value;
                            if (!v) {
                                var r2 = store.get('wallet_data');
                                r2.onsuccess = function () {
                                    var v2 = r2.result && r2.result.value;
                                    resolve(v2 ? Number(v2.balance) || 0 : 5000);
                                };
                                r2.onerror = function () { resolve(5000); };
                                return;
                            }
                            if (Array.isArray(v.cards) && v.cards.length) {
                                resolve(v.cards.reduce(function (s, c) { return s + (Number(c && c.balance) || 0); }, 0));
                            } else resolve(Number(v.balance) || 0);
                        };
                        r.onerror = function () { resolve(5000); };
                    } catch (err) { resolve(5000); }
                };
                req.onerror = function () { resolve(5000); };
            } catch (e) { resolve(5000); }
        });
    }

    async function fullPeekSystemAsync() {
        var recentList = await recentContextAsync();
        var p = fullPeekSystem(recentList);
        try {
            var bal = await readWalletBalance();
            p += '\n【用户真实经济状况】用户钱包当前余额约 ¥' + (Number(bal) || 0).toFixed(2) +
                '。这是系统里的真实数据，不要凭空说用户没钱、欠钱、吃不起饭或暗示用户很穷；提到钱时以这个余额和你看到的具体情境为准。\n';
        } catch (e) {}
        var c = currentChar();
        var ctx = recentList.map(function (m) { return m.content; }).join('\n');
        try {
            if (window.QABridge && QABridge.getWorldbookText && c) {
                var wb = await QABridge.getWorldbookText(c, ctx);
                if (wb && String(wb).trim()) p += '\n【世界书 · 必须遵守】\n' + String(wb).slice(0, 2600);
            }
        } catch (e) {}
        try {
            if (window.QABridge && QABridge.getMemoryText && selectedId) {
                var mem = await QABridge.getMemoryText(selectedId, 8);
                if (mem && String(mem).trim()) p += '\n【长期记忆】\n' + String(mem).slice(0, 1600);
            }
        } catch (e) {}
        try {
            if (c && QABridge && QABridge.inferLang && QABridge.inferLang(c) && QABridge.inferLang(c) !== '中文') {
                p += '\n说台词时用你的母语，并在括号里附中文翻译；旁白、动作和描写用中文。';
            }
        } catch (e) {}
        return p;
    }

    function renderCharSelect() {
        var sel = $('isChar');
        if (!sel) return;
        sel.innerHTML = '';
        if (!chars.length) {
            var o = document.createElement('option');
            o.value = ''; o.textContent = '（还没有角色，请先创建）';
            sel.appendChild(o); return;
        }
        chars.forEach(function (c) {
            var op = document.createElement('option');
            op.value = String(c.id); op.textContent = (c.name || c.id);
            sel.appendChild(op);
        });
        sel.value = selectedId;
    }

    function renderInfo() {
        var id = selectedId || '';
        var name = charName();
        var tok = getPeekToken();
        var baseUrl = peekBase(getPeekUrl());
        var ep = baseUrl ? (baseUrl + '/peek') : '（先填服务端地址）';

        setText('isPeekCharName', currentChar() ? name : '（先创建角色）');
        setText('isPeekCharId', id || '—');
        setText('isPeekEndpointMain', ep);
        setText('isPeekAppId', appId());
        setText('isPeekTokenMain', tok);
        setText('isPeekBodyImage', peekBody('image'));
        setText('isPeekBodyText', peekBody('text'));
        renderGuide(ep, tok, id, name);
    }

    function renderGuide(ep, tok, id, name) {
        var el = $('isGuide');
        if (!el) return;
        var imgBody = peekBody('image');
        var txtBody = peekBody('text');
        el.innerHTML = ''
            + '<h4>最简版（先照这个配，能跑通再加功能）</h4>'
            + '<ol>'
            + '<li>快捷指令 App → <b>+</b> 新建，命名「窥屏」。</li>'
            + '<li>加动作：<code>截屏</code> → <code>Base64 编码</code>（关闭换行）。</li>'
            + '<li>加 <code>获取 URL 内容</code>：<br>'
            + '地址 <code>' + esc(ep || '（先填服务端地址）') + '</code><br>'
            + '方法 <code>POST</code>；头部 <code>X-Peek-Token</code> = <code>' + esc(tok || '（令牌）') + '</code><br>'
            + '请求体选 <b>文件</b>，引用一个文本动作，内容：'
            + '<pre class="sk-guide-json">' + esc('{"chatId":"' + (id || '角色ID') + '","appId":"' + appId() + '","token":"' + tok + '","image":"data:image/jpeg;base64,<Base64结果>"}') + '</pre>'
            + '把 <code>&lt;Base64结果&gt;</code> 换成第 2 步的 Base64 变量。</li>'
            + '<li>加 <code>获取字典值</code>，键 <code>reply</code>。</li>'
            + '<li>加 <code>显示提醒</code>，内容放 <code>reply</code>。运行一次能弹点评就成功了。</li>'
            + '</ol>'
            + '<h4>连续聊（它自己反复执行）</h4>'
            + '<ol>'
            + '<li>在「显示提醒」后加 <code>要求输入</code>（提示：你想说什么）。</li>'
            + '<li>再加 <code>获取 URL 内容</code>：地址/头部同上，请求体选 <b>文件</b> → 文本动作：'
            + '<pre class="sk-guide-json">' + esc('{"chatId":"' + (id || '角色ID') + '","appId":"' + appId() + '","token":"' + tok + '","text":"<要求输入的变量>"}') + '</pre>'
            + '把 <code>&lt;要求输入的变量&gt;</code> 换成「要求输入」的结果。</li>'
            + '<li>再接 <code>获取字典值</code> → <code>显示提醒</code>，然后把这四步放进 <code>重复</code>（50 或 100 次）。</li>'
            + '<li>在「要求输入」后加 <code>如果</code>：输入 <code>退出</code> → <code>停止此快捷指令</code>。</li>'
            + '<li>第一轮带 image，之后只发 text；chatId 不变，所有轮次都会进同一个私聊。</li>'
            + '</ol>'
            + '<h4>完整版（可选：缩放/压缩/识图兜底）</h4>'
            + '<ol>'
            + '<li>打开「快捷指令」App，右上角 <b>+</b> 新建，命名「窥屏」。</li>'
            + '<li>添加动作 <code>截屏</code>。</li>'
            + '<li>添加动作 <code>调整图像大小</code>：宽度填 <b>900</b>，高度留空（自动）。原图直接 Base64 经常会导致请求超时。</li>'
            + '<li>添加动作 <code>转换图像</code>：格式选 <b>JPEG</b>，质量 <b>0.7</b>。不转换就一定要把下面 image 前缀改成 <code>data:image/png;base64,</code>。</li>'
            + '<li>添加动作 <code>Base64 编码</code>，关闭「行长度换行」。</li>'
            + '<li>添加动作 <code>获取 URL 内容</code>：<br>'
            + '地址：<code>' + esc(ep || '（先填服务端地址）') + '</code><br>'
            + '方法：<code>POST</code><br>'
            + '头部：添加 <code>X-Peek-Token</code>，值填 <code>' + esc(tok || '（令牌）') + '</code><br>'
            + '请求体选 <b>JSON</b>，添加这三个字段：<br>'
            + '· <code>chatId</code> = <code>' + esc(id || '（角色 ID）') + '</code><br>'
            + '· <code>appId</code> = <code>' + esc(appId()) + '</code><br>'
            + '· <code>image</code> = 先输入 <code>data:image/jpeg;base64,</code>，后面紧跟蓝色的 <b>Base64 已编码</b> 变量（中间不要有空格或换行）。</li>'
            + '<li><b>不要</b>再用「文本」动作手拼 JSON：图片 Base64 很长，手动拼很容易多出换行或引号，Worker 会直接解析失败。<br>'
            + '如果你已经用文本 JSON，也可以继续用下面这段自动生成的版本：<pre class="sk-guide-json">' + esc(imgBody) + '</pre>'
            + '把 <code>&lt;把上一步的 Base64 结果插到这里&gt;</code> 替换成 Base64 变量。</li>'
            + '<li><b>模型不支持识图时的兜底：</b>再加一个 <code>从图像中提取文本</code>，然后在 JSON 里增加 <code>text</code> 字段放识别结果；Worker 会同时把截图和文字交给模型，至少不会完全看不到内容。</li>'
            + '<li>添加动作 <code>获取字典值</code>，键填 <code>reply</code>。</li>'
            + '<li>添加动作 <code>显示提醒</code>，内容用上一步的 <code>reply</code>。运行一次，应该能弹出 TA 的点评，并且能说出图里的具体内容。</li>'
            + '<li>回到 Nano，打开角色「' + esc(name) + '」（ID <code>' + esc(id || '—') + '</code>）的私聊，这轮对话会自动补进来。</li>'
            + '</ol>'
            + '<div class="warn">如果 TA 能回复但看不到图片：确认 <b>image</b> 字段是 <code>data:image/jpeg;base64,</code> + Base64 变量，且主 API 的模型支持识图；先在「API 页」用支持图片输入的模型测试一次。旧版教程里的纯文字/OCR 只识别文字，不会让模型看见画面。</div>'
            + '<h4>继续聊（可选）</h4>'
            + '<ol>'
            + '<li>在「显示提醒」后面加 <code>要求输入</code>，拿到你打的字。</li>'
            + '<li>再加一个 <code>获取 URL 内容</code>，地址和方法同上；请求体选 <b>JSON</b>，字段用 <code>chatId</code>、<code>appId</code>、<code>text</code>，</li>'
            + '<li><code>text</code> 的值直接插入上一步「要求输入」的变量。用 JSON 字段时 Shortcuts 会自动处理引号和换行，不会把 JSON 拼坏。</li>'
            + '<li>再接 <code>获取字典值</code> → <code>显示提醒</code>，就可以一轮一轮聊下去。</li>'
            + '</ol>'
            + '<h4>连续聊：让它自己反复执行</h4>'
            + '<ol>'
            + '<li>在「显示提醒」后面加 <code>重复</code>，次数填 <b>50</b> 或 <b>100</b>。</li>'
            + '<li>把 <code>要求输入</code> → <code>获取 URL 内容</code> → <code>获取字典值</code> → <code>显示提醒</code> 放进「重复」里面。</li>'
            + '<li>请求体继续用 JSON：<code>{"chatId":"' + esc(id || '角色ID') + '","text":"&lt;要求输入的变量&gt;"}</code>。<br>'
            + '第一轮可以带 image；从第二轮开始把 image 换成 text，这样同一角色会一直接上文。</li>'
            + '<li>在「要求输入」后面加 <code>如果</code>：如果输入是 <code>退出</code>，就 <code>停止此快捷指令</code>，避免无限循环。</li>'
            + '<li>也可以不用「重复」，每次运行快捷指令只聊一轮；只要 chatId 不变，回到 Nano 后所有轮次都会按顺序进同一个私聊。</li>'
            + '</ol>'
            + '<h4>更顺手的触发</h4>'
            + '<ol>'
            + '<li><b>轻点背面</b>：设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选「窥屏」。</li>'
            + '<li><b>辅助触控</b>：设置 → 辅助功能 → 触控 → 辅助触控 → 轻点两下 → 选「窥屏」。</li>'
            + '</ol>'
            + '<div class="warn">换角色时，角色 ID 和两段 JSON 会自动更新。请重新复制一次 JSON；旧的快捷指令仍然指向旧 ID。</div>';
    }

    function guideText() {
        var id = String(selectedId || '');
        var name = charName();
        var baseUrl = peekBase(getPeekUrl());
        var ep = baseUrl ? (baseUrl + '/peek') : '（先填服务端地址）';
        var tok = getPeekToken();
        return [
            '窥屏 · 手机版（屏幕速聊）',
            '',
            '角色：' + name,
            '角色 ID：' + id,
            '接口地址：' + ep,
            '令牌：' + tok,
            '',
            '截图请求体 JSON：',
            peekBody('image'),
            '',
            '回话请求体 JSON：',
            peekBody('text'),
            '',
            '最简版（先照这个配）：',
            '1. 新建快捷指令「窥屏」→ 截屏 → Base64 编码（关闭换行）。',
            '2. 获取 URL 内容：POST 上面的接口地址；头部 X-Peek-Token = 上面的令牌；请求体选「文件」引用文本：',
            '   {"chatId":"' + id + '","appId":"' + appId() + '","token":"' + tok + '","image":"data:image/jpeg;base64,<Base64结果>"}',
            '   把 <Base64结果> 换成 Base64 变量。',
            '3. 获取字典值 reply → 显示提醒。运行一次能弹点评就成功。',
            '连续聊：显示提醒后加「要求输入」→ 再发一次 URL 请求（请求体换成 {"chatId":"' + id + '","text":"<要求输入的变量>"}）→ reply → 显示提醒；把这四步放进「重复」50/100 次。输入“退出”时用「如果」停止。',
            '',
            '完整版步骤：',
            '1. 打开「快捷指令」App，右上角 + 新建，命名「窥屏」。',
            '2. 添加动作：截屏 → 调整图像大小（宽 900，高留空）→ 转换图像（JPEG 0.7）→ Base64 编码（关闭行长度换行）。',
            '   原图直接 Base64 很容易请求超时；一定要先缩放和压成 JPEG。',
            '3. 添加「获取 URL 内容」：地址填上面的接口地址，方法 POST。',
            '   头部：X-Peek-Token = 上面的令牌。',
            '   请求体选 JSON，字段：chatId = 角色 ID；appId = ' + appId() + '；image = data:image/jpeg;base64, 后面紧跟 Base64 变量。',
            '   不要用「文本」动作手拼 JSON；Base64 很长，手动拼很容易多出换行/引号导致解析失败。',
            '   可选兜底：加「从图像中提取文本」，并在 JSON 里加 text 字段放 OCR 结果；模型不支持识图时也能读文字。',
            '4. 添加「获取字典值」：reply → 显示提醒。',
            '5. 先测纯文字：把 image 字段换成 text: "测试"，确认能收到 reply；再加图片，便于区分是网络超时还是图片/模型问题。',
            '6. 运行。TA 的回复会弹出，并且能说出图里的具体内容；回到 Nano 打开这个角色的私聊，消息会自动补进来。',
            '   如果只能收到“看不到图片”，检查主 API 模型是否支持识图，以及 image 字段是否以 data:image/jpeg;base64, 开头。',
            '',
            '想连续聊：再加「要求输入」拿到文字，用 chatId / appId / text 三个 JSON 字段再发一轮。',
            '连续自动聊：把「要求输入 → 获取URL内容 → 获取字典值 → 显示提醒」放进「重复」50/100 次；输入“退出”时用「如果」停止快捷指令。',
            '第一轮可以带 image，之后每轮只发 text；chatId 不变，所有轮次都会进同一个私聊。',
            '想更快：设置 → 辅助功能 → 触控 → 轻点背面 → 双击 → 选这个快捷指令。'
        ].join('\n');
    }

    function renderMissing() {
        var el = $('skMissing');
        if (!el) return;
        var ok = !!(apiCfg && apiCfg.mainUrl && apiCfg.mainKey && apiCfg.mainModel);
        if (ok) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.innerHTML = '还没有配置主 API。请先到 <b>API 页</b>填好 接口地址 / Key / 模型，再回到这里。';
    }

    function startRealShare() {
        var info = { id: String(selectedId || ''), name: charName(), avatar: (currentChar() && currentChar().avatar) || '' };
        if (!info.id) { toast('先选一个角色'); return; }
        try {
            var t = window.parent;
            if (t && t !== window) {
                t.postMessage({ type: 'startScreenShare', charId: info.id, charName: info.name, avatar: info.avatar }, '*');
                return;
            }
        } catch (e) {}
        if (window.ScreenShare && typeof window.ScreenShare.start === 'function') {
            window.ScreenShare.start(info);
            return;
        }
        toast('请从 App 里的「查手机 → 设置」打开窥屏');
    }

    function refresh() {
        renderMissing();
        renderInfo();
        pushPersona();
    }

    function clearPeekSyncCache() {
        try {
            var stale = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && (k.indexOf('nano_peek_page_sig_') === 0 || k.indexOf('nano_peek_page_at_') === 0)) stale.push(k);
            }
            stale.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        } catch (e) {}
    }

    // 把当前所选角色的人设同步到服务端，快捷指令就不需要内置人设（切角色后即时生效）
    async function pushPersona() {
        try {
            var c = currentChar();
            if (!c || !selectedId) return;
            rememberChat(selectedId);
            var baseUrl = peekBase(getPeekUrl());
            if (!baseUrl) return;
            var sys = await fullPeekSystemAsync();
            var api = (apiCfg && apiCfg.mainUrl && apiCfg.mainKey && apiCfg.mainModel)
                ? { url: apiCfg.mainUrl, key: apiCfg.mainKey, model: apiCfg.mainModel }
                : null;
            var hist = await recentContextAsync();
            // 签名必须带上服务端地址 / 令牌 / appId：只换 Worker 时人设没变，
            // 旧逻辑会误判“已经同步过”而跳过，导致新 Worker 的分区里一直没有 API。
            var sig = baseUrl + '|' + getPeekToken() + '|' + appId() + '|' + String(selectedId || '')
                + '|' + deviceId() + '|' + currentUserId() + '|' + sys
                + '|' + (api ? (api.url + '|' + api.model + '|' + String(api.key).slice(-6)) : '');
            var sigKey = 'nano_peek_page_sig_' + String(selectedId || 'latest');
            var atKey = 'nano_peek_page_at_' + String(selectedId || 'latest');
            try {
                if (localStorage.getItem(sigKey) === sig && Date.now() - (parseInt(localStorage.getItem(atKey) || '0', 10) || 0) < 6 * 3600 * 1000) return;
            } catch (e) {}
            var payload = {
                token: getPeekToken(), appId: appId(), deviceId: deviceId(), userId: currentUserId(),
                chatId: String(selectedId || ''), system: sys, api: api
            };
            if (hist.length) payload.history = hist;
            fetch(baseUrl + '/peek/persona', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (r) {
                if (!r || !r.ok) return;
                try { localStorage.setItem(sigKey, sig); localStorage.setItem(atKey, String(Date.now())); } catch (e) {}
            }).catch(function () {});
        } catch (e) {}
    }

    /* ---------------- 事件 ---------------- */
    function bind() {
        var backBtn = document.querySelector('[data-back]');
        if (backBtn) backBtn.addEventListener('click', function () {
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeFullscreen' }, '*');
                    window.parent.postMessage({ type: 'screenSetupClose' }, '*');
                    return;
                }
                if (history.length > 1) history.back(); else location.href = 'chat.html';
            } catch (e) {}
        });
        var sel = $('isChar');
        if (sel) sel.addEventListener('change', function () {
            selectedId = this.value;
            rememberChat(selectedId);
            refresh();
        });
        var startBtn = $('isStartShare');
        if (startBtn) startBtn.addEventListener('click', startRealShare);
        var guideBtn = $('isCopyGuide');
        if (guideBtn) guideBtn.addEventListener('click', function () { copy(guideText()); });
        var peekRestore = $('isPeekRestore');
        if (peekRestore) peekRestore.addEventListener('click', function () {
            if (confirm('还原成默认服务端地址，并生成新的 pk？当前快捷指令里的旧地址/令牌会失效，需要重新复制；如果 Worker 设了 PEEK_TOKEN，也要同步改成新 pk。')) resetPeekConfig();
        });
        var peekSave = $('isPeekSave');
        if (peekSave) peekSave.addEventListener('click', function () {
            var u = $('isPeekUrl');
            var next = peekBase((u && u.value) || '');
            var old = '';
            try { old = peekBase(localStorage.getItem(PEEK_URL_KEY) || localStorage.getItem('nano_push_endpoint') || ''); } catch (e) {}
            try {
                localStorage.setItem(PEEK_URL_KEY, next);
                // Web Push 和窥屏用同一个 Worker：保存一次，两边都生效
                localStorage.setItem('nano_push_endpoint', next);
                // 换了 Worker，旧的 VAPID 公钥 / 旧订阅 / 人设同步缓存都不能用
                if (old && next && old !== next) {
                    localStorage.removeItem('nano_push_vapid');
                    clearPeekSyncCache();
                }
            } catch (e) {}
            var pt = $('isPushToken');
            try {
                var ptv = String((pt && pt.value) || '').trim();
                if (ptv) localStorage.setItem('nano_push_token', ptv);
                else localStorage.removeItem('nano_push_token');
            } catch (e) {}
            rememberChat(selectedId);
            refresh();
            toast('配置已保存');
        });
        var peekUrl = $('isPeekUrl');
        if (peekUrl) peekUrl.addEventListener('change', function () {
            var next = peekBase(peekUrl.value || '');
            var old = '';
            try { old = peekBase(localStorage.getItem(PEEK_URL_KEY) || localStorage.getItem('nano_push_endpoint') || ''); } catch (e) {}
            try {
                localStorage.setItem(PEEK_URL_KEY, next);
                localStorage.setItem('nano_push_endpoint', next);
                if (old && next && old !== next) {
                    localStorage.removeItem('nano_push_vapid');
                    clearPeekSyncCache();
                }
            } catch (e) {}
            renderInfo();
        });
        document.querySelectorAll('[data-copy]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var el = $(btn.getAttribute('data-copy'));
                if (el) copy(el.textContent);
            });
        });
    }

    /* ---------------- 启动 ---------------- */
    async function init() {
        try { base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, ''); } catch (e) { base = './'; }
        // 单文件源码链接用当前站点地址生成，不在前端写死任何 GitHub 仓库地址。
        try {
            var rawEl = $('isDeployRaw');
            if (rawEl) rawEl.textContent = new URL('../push-worker/dist/index.js', location.href).href;
        } catch (e) {}
        var sp = null;
        try { sp = new URLSearchParams(location.search); } catch (e) {}
        var wantChat = sp ? (sp.get('chat') || '') : '';
        var wantName = sp ? (sp.get('name') || '') : '';

        var results = await Promise.all([idbGetAll('nano_characters_db', 'characters'), readApiConfig()]);
        var all = results[0] || [];
        apiCfg = results[1] || null;
        chars = all.filter(function (c) { return c && c.id && !c.nanoAssistant; });

        function hasChar(id) { return chars.some(function (c) { return String(c.id) === String(id); }); }
        if (wantChat && hasChar(wantChat)) selectedId = String(wantChat);
        else {
            var saved = '';
            try { saved = localStorage.getItem(PEEK_CHAT_KEY) || ''; } catch (e) {}
            if (saved && hasChar(saved)) selectedId = saved;
        }
        if (!selectedId && wantName) {
            for (var i = 0; i < chars.length; i++) if (String(chars[i].name) === wantName) { selectedId = String(chars[i].id); break; }
        }
        if (!selectedId && chars.length) selectedId = String(chars[0].id);

        var urlInput = $('isPeekUrl');
        if (urlInput) urlInput.value = getPeekUrl();
        var pushTokenInput = $('isPushToken');
        if (pushTokenInput) {
            try { pushTokenInput.value = localStorage.getItem('nano_push_token') || ''; } catch (e) {}
        }
        renderCharSelect();
        bind();
        rememberChat(selectedId);
        refresh();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
