// ============================================================
// ios-setting.js — iOS「快捷指令 · 窥屏」图形化配置
// 读取角色库 + 主 API（无需单独配置），生成可直接粘贴进
// 「快捷指令」的深链、接口地址与请求体 JSON，并给出完整步骤。
// 原理与灵动岛做法见 docs/ios-shortcuts.md
// ============================================================
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
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
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function maskKey(k) {
        k = String(k || '');
        if (k.length <= 10) return k ? '••••••' : '';
        return k.slice(0, 5) + '••••••' + k.slice(-4);
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
                // 不指定版本号：用数据库当前版本打开，避免比实际版本低而抛 VersionError
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
                // 同上：不指定版本号
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
    var PEEK_URL_KEY = 'nano_peek_url', PEEK_TOKEN_KEY = 'nano_peek_token', PEEK_CHAT_KEY = 'nano_peek_chat';
    var PEEK_DEFAULT_URL = 'https://nanopush.nano315.online';
    function getPeekToken() {
        var t = '';
        try { t = localStorage.getItem(PEEK_TOKEN_KEY) || ''; } catch (e) {}
        if (!t) {
            t = 'pk_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
            try { localStorage.setItem(PEEK_TOKEN_KEY, t); } catch (e) {}
        }
        return t;
    }
    function renderPeek() {
        var url = '';
        try { url = localStorage.getItem(PEEK_URL_KEY) || ''; } catch (e) {}
        if (!url) url = PEEK_DEFAULT_URL;
        if ($('isPeekUrl')) $('isPeekUrl').value = url;
        var token = getPeekToken();
        var base = String(url).trim().replace(/\/+$/, '');
        if (/\/peek$/i.test(base)) base = base.replace(/\/peek$/i, '');
        var ep = base ? (base + '/peek') : '（先填服务端地址）';
        if ($('isPeekToken')) $('isPeekToken').textContent = token;
        if ($('isPeekEndpoint')) $('isPeekEndpoint').textContent = ep;
        if ($('isPeekTokenMain')) $('isPeekTokenMain').textContent = token;
        if ($('isPeekEndpointMain')) $('isPeekEndpointMain').textContent = ep;
        if ($('isPeekSystem')) {
            var c = currentChar();
            $('isPeekSystem').textContent = c ? ('你是「' + charName() + '」。' + (persona() || '')) : '（先创建角色）';
        }
    }
    function savePeek() {
        try { localStorage.setItem(PEEK_URL_KEY, String($('isPeekUrl').value || '').trim()); } catch (e) {}
        try { localStorage.setItem(PEEK_TOKEN_KEY, getPeekToken()); } catch (e) {}
        try { localStorage.setItem(PEEK_CHAT_KEY, String(selectedId || '')); } catch (e) {}
        renderPeek();
        toast('配置已保存');
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
    function persona() { var c = currentChar(); return String($('isPrompt').value || '').trim() || (c ? String(c.setting || c.desc || c.persona || '') : ''); }

    function renderCharSelect() {
        var sel = $('isChar');
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

    function renderGenerated() {
        var id = selectedId || '', name = charName();
        var model = (apiCfg && apiCfg.mainModel) || '你的模型';
        var sys = persona();
        var root = window.NANO_ROOT || base;

        $('isLinkA').textContent = root + 'index.html?nanoScreen={{识别文本}}&nanoChat=' + enc(id) + '&nanoName=' + enc(name);
        $('isUrl2').textContent = endpoint((apiCfg && apiCfg.mainUrl) || '') || '（主 API 未配置）';

        var __k = (apiCfg && apiCfg.mainKey) || '';
        var __kEl = $('isApiKey');
        if (__kEl) {
            __kEl.dataset.raw = __k;
            __kEl.dataset.shown = '';
            __kEl.textContent = __k ? maskKey(__k) : '（主 API 未配置）';
            var __rv = $('isApiKeyReveal'); if (__rv) __rv.textContent = '显示';
        }

        var body = {
            model: model,
            messages: [
                { role: 'system', content: sys || ('你是「' + name + '」。') },
                { role: 'user', content: '这是用户手机屏幕上的一段内容，用你的人设随口点评 2~3 句：\n{{屏幕文本}}' }
            ],
            max_tokens: 800,
            temperature: 0.9
        };
        $('isBody').textContent = JSON.stringify(body, null, 2);
        $('isLinkB').textContent = root + 'index.html?nanoScreenReply={{模型回复}}&nanoChat=' + enc(id) + '&nanoName=' + enc(name);
    }

    function renderGuide() {
        var name = charName();
        var url = endpoint((apiCfg && apiCfg.mainUrl) || '');
        $('isGuide').innerHTML = ''
            + '<h4>方式 A · 让 Nano 点评</h4>'
            + '<ol>'
            + '<li>打开「快捷指令」App，右上角 <b>+</b> 新建。</li>'
            + '<li>加动作 <code>截图</code>。</li>'
            + '<li>加动作 <code>从图像中提取文本</code>。</li>'
            + '<li>加动作 <code>打开 URL</code>：粘贴上面的深链，把 <code>{{识别文本}}</code> 删掉，改插入第 3 步的结果。</li>'
            + '<li>运行：' + esc(name) + ' 会点评你屏幕上的内容，并写进聊天。</li>'
            + '</ol>'
            + '<h4>方式 B · 直连 API</h4>'
            + '<ol>'
            + '<li>前三步同上（截图 → 提取文本）。</li>'
            + '<li>加 <code>获取 URL 内容</code>：网址填 <code>' + esc(url || '（先配置主 API）') + '</code>，方法 <b>POST</b>，头部加 <code>Authorization: Bearer 你的Key</code>、<code>Content-Type: application/json</code>。</li>'
            + '<li>请求体选 <b>文件</b>，引用一个 <code>文本</code> 动作，内容用上面的 JSON，把 <code>{{屏幕文本}}</code> 换成提取的文本。</li>'
            + '<li>加 <code>获取字典值</code>：<code>choices</code> → 第 1 项 → <code>message</code> → <code>content</code>。</li>'
            + '<li>加 <code>打开 URL</code> 用「回传深链」写进聊天，或用 <code>显示通知</code> 先弹出来。</li>'
            + '</ol>'
            + '<h4>更顺手的触发</h4>'
            + '<ol>'
            + '<li><b>轻点背面</b>：设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选这个快捷指令。</li>'
            + '<li><b>个人自动化</b>：快捷指令 → 自动化 → 新建（打开某 App / 特定时间）→ 运行快捷指令。</li>'
            + '</ol>'
            + '<h4>灵动岛 / 锁屏</h4>'
            + '<div>真·自定义灵动岛需要原生 App（ActivityKit），见 <code>docs/ios-shortcuts.md</code>。开启「保活」后，TA 的点评也会出现在系统的媒体播放器（锁屏 / 灵动岛）里。</div>';
    }

    function renderMissing() {
        var el = $('skMissing');
        var ok = !!(apiCfg && apiCfg.mainUrl && apiCfg.mainKey && apiCfg.mainModel);
        if (ok) { el.hidden = true; el.innerHTML = ''; return; }
        el.hidden = false;
        el.innerHTML = '还没有配置主 API。请先到 <b>API 页</b>填好 接口地址 / Key / 模型，再回到这里。';
    }

    function peekLink() {
        var id = selectedId || '', name = charName();
        var root = window.NANO_ROOT || base;
        return root + 'index.html?nanoScreen={{识别文本}}&nanoChat=' + enc(id) + '&nanoName=' + enc(name);
    }

    function guideText() {
        var ep = ($('isPeekEndpointMain') && $('isPeekEndpointMain').textContent) || '';
        var tk = ($('isPeekTokenMain') && $('isPeekTokenMain').textContent) || '';
        var id = String(selectedId || '');
        return [
            '窥屏 · 手机版（屏幕速聊）',
            '',
            '1. 打开「快捷指令」App，右上角 + 新建。',
            '2. 添加动作：截图 → Base64 编码（关闭换行）。',
            '3. 添加「获取 URL 内容」：',
            '   地址：' + ep,
            '   方法：POST',
            '   头部：X-Peek-Token = ' + tk,
            '   请求体：选「文件」，引用下面这段文本（把 Base64 结果插进去）',
            '',
            '{"chatId":"' + id + '","image":"data:image/jpeg;base64,<Base64结果>"}',
            '',
            '4. 添加「获取字典值」：reply → 显示提醒。',
            '5. 运行。TA 的回复会弹在系统通知里；回到 Nano 后会自动进聊天。',
            '',
            '想连续聊：再加「要求输入」拿到文字，把请求体里的 image 换成 text 再发一轮。',
            '想更快：设置 → 辅助功能 → 触控 → 轻点背面 → 双击 → 选这个快捷指令。'
        ].join('\n');
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
        renderGenerated();
        renderGuide();
        renderPeek();
        pushPersona();
    }

    // 把当前所选角色的人设同步到服务端，快捷指令就不需要内置人设（切角色后即时生效）
    function pushPersona() {
        try {
            var c = currentChar();
            if (!c) return;
            var url = '';
            try { url = localStorage.getItem(PEEK_URL_KEY) || ''; } catch (e) {}
            if (!url) url = PEEK_DEFAULT_URL;
            var base = String(url).trim().replace(/\/+$/, '');
            if (/\/peek$/i.test(base)) base = base.replace(/\/peek$/i, '');
            if (!base) return;
            var sys = '你是「' + charName() + '」。' + (persona() || '');
            fetch(base + '/peek/persona', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: getPeekToken(), appId: appId(), deviceId: deviceId(), userId: currentUserId(), chatId: String(selectedId || ''), system: sys })
            }).catch(function () {});
        } catch (e) {}
    }

    /* ---------------- 事件 ---------------- */
    function bind() {
        var backBtn = document.querySelector('[data-back]');
        if (backBtn) backBtn.addEventListener('click', function () {
            try {
                if (window.parent && window.parent !== window) {
                    // 由外壳以全屏浮层打开 → 收起整层（回到 Discover 等来源页）
                    window.parent.postMessage({ type: 'closeFullscreen' }, '*');
                    // 由「查手机」内嵌打开 → 回到查手机的「设置」
                    window.parent.postMessage({ type: 'screenSetupClose' }, '*');
                    return;
                }
                if (history.length > 1) history.back(); else location.href = 'chat.html';
            } catch (e) {}
        });
        $('isChar').addEventListener('change', function () {
            selectedId = this.value;
            var c = currentChar();
            $('isPrompt').value = c ? String(c.setting || c.desc || c.persona || '') : '';
            refresh();
        });
        $('isPrompt').addEventListener('input', refresh);
        var startBtn = $('isStartShare');
        if (startBtn) startBtn.addEventListener('click', startRealShare);
        var guideBtn = $('isCopyGuide');
        if (guideBtn) guideBtn.addEventListener('click', function () { copy(guideText()); });
        var peekSave = $('isPeekSave');
        if (peekSave) peekSave.addEventListener('click', savePeek);
        var peekUrl = $('isPeekUrl');
        if (peekUrl) peekUrl.addEventListener('change', function () { try { localStorage.setItem(PEEK_URL_KEY, String(peekUrl.value || '').trim()); } catch (e) {} renderPeek(); });
        document.querySelectorAll('[data-copy]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var el = $(btn.getAttribute('data-copy'));
                if (el) copy((el.dataset && el.dataset.raw) ? el.dataset.raw : el.textContent);
            });
        });
        var reveal = $('isApiKeyReveal');
        if (reveal) reveal.addEventListener('click', function () {
            var el = $('isApiKey');
            if (!el) return;
            var raw = el.dataset.raw || '';
            var shown = el.dataset.shown === '1';
            if (!raw) return;
            el.textContent = shown ? maskKey(raw) : raw;
            el.dataset.shown = shown ? '' : '1';
            reveal.textContent = shown ? '显示' : '隐藏';
        });
    }

    /* ---------------- 启动 ---------------- */
    async function init() {
        try { base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, ''); } catch (e) { base = './'; }
        var sp = null;
        try { sp = new URLSearchParams(location.search); } catch (e) {}
        var wantChat = sp ? (sp.get('chat') || '') : '';
        var wantName = sp ? (sp.get('name') || '') : '';

        var results = await Promise.all([idbGetAll('nano_characters_db', 'characters'), readApiConfig()]);
        var all = results[0] || [];
        apiCfg = results[1] || null;
        chars = all.filter(function (c) { return c && c.id && !c.nanoAssistant; });

        if (wantChat) selectedId = wantChat;
        else if (chars.length) selectedId = String(chars[0].id);
        if (wantName && !currentChar()) {
            for (var i = 0; i < chars.length; i++) if (String(chars[i].name) === wantName) { selectedId = String(chars[i].id); break; }
        }
        if (!currentChar() && chars.length) selectedId = String(chars[0].id);

        renderCharSelect();
        var c = currentChar();
        $('isPrompt').value = c ? String(c.setting || c.desc || c.persona || '') : '';
        bind();
        refresh();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
