// ============================================================
// char-takeover.js — 「角色接管手机」
// 外壳接口（index.html 暴露 window.__nanoShell）：
//   open/close/back/readScreen/postToChat/scroll
// 每个被打开的页面 = 1 次主 API 调用，产出 1-3 条胶囊气泡，
// 并决定下一个要看的页面；每次查看的页面尽量不与以往重复。
// 用户「夺回控制」时角色会有反应；外国角色输出双语气泡。
// ============================================================
(function () {
    'use strict';

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
    function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
    try { console.log('[CharTakeover] build 40 loaded'); } catch (e) {}
    function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? (s.slice(0, n) + '…') : s; }
    function shell() { return window.__nanoShell || null; }
    function readScreen() { var s = shell(); return (s && s.readScreen) ? s.readScreen() : { app: 'unknown', text: '' }; }

    var TK = {
        active: false, abort: false, revoking: false, begun: false, info: null, cfg: null, ctx: {},
        lock: null, bar: null, stream: null, statusEl: null, progEl: null,
        log: [], startedAt: 0, total: 0, i: 0, confirmEl: null
    };

    // weight 越大越容易被随机选中；收藏 / 查手机降低权重
    var APPS = [
        { id: 'home',      name: '手机主界面', w: 3 },
        { id: 'chats',     name: '聊天列表',   w: 3, url: 'chat.html' },
        { id: 'moments',   name: '朋友圈',     w: 4, url: 'moments.html' },
        { id: 'ins',       name: 'Instagram',  w: 4, url: 'ins.html' },
        { id: 'halo',      name: 'Halo 社交',  w: 3, url: 'halo.html' },
        { id: 'books',     name: 'Books',      w: 2, url: 'books.html' },
        { id: 'imessage',  name: 'iMessage',   w: 4, url: 'imessage.html' },
        { id: 'favorite',  name: '收藏',       w: 1, url: 'favorite.html' },
        { id: 'discover',  name: '发现',       w: 2, url: 'discover.html' },
        { id: 'music',     name: '音乐',       w: 2, url: 'music.html' },
        { id: 'couple',    name: '情侣空间',   w: 3, url: 'couple-spaces.html' },
        { id: 'familycard',name: '亲属卡',     w: 2, url: 'family-card.html', selfWith: true },
        { id: 'phone',     name: '查手机',     w: 1, url: 'phone.html' }
    ];

    var SVG = {
        home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
        chats: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
        moments: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
        ins: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r="1"/>',
        halo: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.5" ry="8"/>',
        books: '<path d="M5 4h6v16H5zM13 4h6v16h-6z"/>',
        imessage: '<path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/>',
        favorite: '<path d="m12 3 2.6 5.6L20 9.5l-4 3.9 1 5.6-5-2.9-5 2.9 1-5.6-4-3.9 5.4-.9L12 3Z"/>',
        discover: '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 6-4 1 2-6 4-1Z"/>',
        music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
        couple: '<path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5C19 15.6 12 20 12 20Z"/>',
        familycard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 14h4"/>',
        phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
        chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
        group: '<circle cx="9" cy="9" r="3"/><path d="M4 19a5 5 0 0 1 10 0"/><path d="M16 8.5a3 3 0 0 1 0 5M17 19a5 5 0 0 0-2-4"/>'
    };
    function appIcon(id, kind) {
        var key = kind || id;
        var body = SVG[key] || SVG.chats;
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    }

    /* ---------------- 主 API ---------------- */
    function parseLocal() { try { var raw = localStorage.getItem('nano_api_config'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
    function getApiConfig() {
        return new Promise(function (resolve) {
            var done = false;
            var local = parseLocal();
            function finish(v) { if (done) return; done = true; resolve(v); }
            try {
                if (!('indexedDB' in window)) { finish(local); return; }
                // 不指定版本号：避免被其它页面的旧连接卡在升级（onblocked）而永远不返回
                var req = indexedDB.open('nano_api_db');
                req.onupgradeneeded = function (e) {
                    try { var db = e.target.result;
                        if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
                        if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onblocked = function () { finish(local); };
                req.onerror = function () { finish(local); };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('api_data')) { try { db.close(); } catch (err) {} finish(local); return; }
                        var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        g.onsuccess = function () { var v = (g.result && g.result.value) || local; try { db.close(); } catch (err) {} finish(v); };
                        g.onerror = function () { try { db.close(); } catch (err) {} finish(local); };
                    } catch (err) { finish(local); }
                };
            } catch (err) { finish(local); }
            setTimeout(function () { finish(local); }, 4000);
        });
    }
    function apiEndpoint(raw) {
        var s = String(raw || '').trim().replace(/\/+$/, '');
        if (!s) return '';
        if (!/\/v1$/i.test(s)) s += '/v1';
        return s + '/chat/completions';
    }
    async function callApi(messages, maxTokens) {
        var cfg = TK.cfg || {};
        var url = apiEndpoint(cfg.mainUrl);
        if (!url || !cfg.mainKey || !cfg.mainModel) throw new Error('主 API 未配置完整');
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 45000) : null;
        var resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.mainKey },
                body: JSON.stringify({
                    model: cfg.mainModel,
                    messages: messages,
                    temperature: (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : 0.85),
                    max_tokens: maxTokens || 700,
                    presence_penalty: 0.4,
                    frequency_penalty: 0.5
                }),
                signal: ctrl ? ctrl.signal : undefined
            });
        } finally { if (timer) clearTimeout(timer); }
        if (!resp.ok) {
            var msg = 'HTTP ' + resp.status;
            try { var d = await resp.json(); msg = (d.error && d.error.message) || d.message || msg; } catch (e) {}
            throw new Error(msg);
        }
        var data = await resp.json();
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        return String(content || '');
    }
    function firstJson(text) {
        var s = String(text || '');
        var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) s = fence[1];
        var start = s.indexOf('{');
        if (start === -1) return null;
        var depth = 0, inStr = false, esc = false;
        for (var i = start; i < s.length; i++) {
            var ch = s[i];
            if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
            if (ch === '"') inStr = true;
            else if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; } } }
        }
        return null;
    }
    function splitBy(text) { var p = String(text || '').split('||'); return { main: (p[0] || '').trim(), sub: (p[1] || '').trim() }; }

    /* ---------------- 目标（App / 聊天 / 群聊） ---------------- */
    function loadSeen() { try { return JSON.parse(localStorage.getItem('nano_takeover_seen') || '[]') || []; } catch (e) { return []; } }
    function saveSeen(ids) {
        try {
            var all = loadSeen().concat(ids), uniq = [];
            all.forEach(function (x) { if (uniq.indexOf(x) < 0) uniq.push(x); });
            localStorage.setItem('nano_takeover_seen', JSON.stringify(uniq.slice(-24)));
        } catch (e) {}
    }
    function buildTargets(ctx) {
        var list = [];
        APPS.forEach(function (a) { list.push({ id: a.id, name: a.name, w: a.w, url: a.url || null, selfWith: !!a.selfWith }); });
        (ctx && ctx.chats || []).slice(0, 12).forEach(function (c, i) {
            if (!c || !c.id) return;
            list.push({ id: 'chat:' + c.id, name: '聊天·' + (c.name || c.id), kind: 'chat', cid: c.id, cname: c.name || '', w: i < 5 ? 4 : 2 });
        });
        (ctx && ctx.groups || []).slice(0, 8).forEach(function (g) {
            if (!g || !g.id) return;
            list.push({ id: 'group:' + g.id, name: '群聊·' + (g.name || '群聊'), kind: 'group', gid: g.id, w: 3 });
        });
        return list;
    }
    function openTarget(t) {
        var s = shell(); if (!s) return;
        if (t.kind === 'chat') { s.open('chat_inner.html?chat=' + enc(t.cid) + '&name=' + enc(t.cname), '', 'main'); return; }
        if (t.kind === 'group') { s.open('groups.html?group=' + enc(t.gid), '', 'main'); return; }
        if (t.url) {
            var u = t.url;
            // 亲属卡等页面按角色（chatId）取数据：带上当前角色，避免落到别人的卡上
            if (t.selfWith) {
                var me = (TK.ctx && TK.ctx.self) || {};
                var id = me.id || (TK.info && TK.info.id) || '';
                var nm = me.name || (TK.info && TK.info.name) || '';
                u += (u.indexOf('?') === -1 ? '?' : '&') + 'chat=' + enc(id) + '&name=' + enc(nm);
            }
            s.open(u, t.name, 'takeover'); return;
        }
        if (s.close) s.close();
    }
    function weightedPick(pool) {
        var total = 0; pool.forEach(function (t) { total += (t.w || 3); });
        var r = Math.random() * total;
        for (var i = 0; i < pool.length; i++) { r -= (pool[i].w || 3); if (r <= 0) return pool[i]; }
        return pool[pool.length - 1];
    }
    function pickNext(targets, used, seen) {
        var notUsed = targets.filter(function (t) { return !used[t.id]; });
        if (!notUsed.length) notUsed = targets;
        var fresh = notUsed.filter(function (t) { return seen.indexOf(t.id) < 0; });
        return weightedPick(fresh.length ? fresh : notUsed);
    }
    function resolveNext(nextId, targets, used, seen, cur) {
        for (var i = 0; i < targets.length; i++) if (targets[i].id === nextId && !used[targets[i].id]) return targets[i];
        return pickNext(targets, used, seen) || cur;
    }

    /* ---------------- 提示词 ---------------- */
    function systemText() {
        var ctx = TK.ctx || {};
        var name = (TK.info && TK.info.name) || '角色';
        var lines = ['你是「' + name + '」，此刻你正在亲自翻看用户（你正在聊天的那个人）的手机（Nano 应用）。'];
        lines.push('这不是演戏、也不是旁白：你就是' + name + '本人，带着你自己的性格、口癖、身份和你们之间的真实关系，一边看一边随口反应。');
        if (ctx.persona) lines.push('\n【你的人物设定 · 最高优先级，必须严格遵守】\n' + ctx.persona);
        if (ctx.worldbook) lines.push('\n【世界书设定】\n' + ctx.worldbook);
        if (ctx.memory) lines.push('\n【你和用户共同经历 / 知道的事】\n' + ctx.memory);
        if (ctx.foreign) lines.push('\n【语言】你是外国角色：每条气泡先写你的母语原文，再紧跟中文翻译，用 || 分隔，例如 Hello, so this is your phone.||你好呀，这就是你的手机啊。');
        lines.push('\n【写反应的要求】');
        lines.push('- 先写 act：你翻看这一页时的动作、神态和态度，1 句，20~40 字，要连贯、有画面，例如「翻着聊天记录，指腹在屏幕上顿了顿，嘴角慢慢压了下去」。');
        lines.push('- 再写 1-3 条气泡：就是你在这一刻真正会随口说出口的话，短句、口语、有情绪、有指向性，紧扣你在这一页真正看到的东西。');
        lines.push('- 语气、用词、称呼、在意什么、会吃什么醋，全部服从人物设定与你们的关系；不同角色要明显不一样，不要千人一面。');
        lines.push('- 不要像报告或旁白；不要空泛；不要油腻；禁止使用「小姑娘 / 小丫头 / 丫头 / 小家伙 / 乖乖」等称呼。');
        lines.push('- 只输出一个 JSON 对象，不要解释、不要代码块：{"act":"<动作态度>","bubbles":["...","..."],"next":"<下一个页面 id>"}');
        return lines.join('\n');
    }
    function userText(cur, sc, targets, seenNames) {
        var ids = targets.map(function (t) { return t.id; });
        return '你打开了「' + cur.name + '」' + (cur.kind === 'chat' ? '（某段聊天）' : (cur.kind === 'group' ? '（一个群聊）' : '')) + '，屏幕内容：\n' +
            clip(sc.text || '（这一页没有可读文字）', 2600) + '\n\n' +
            (seenNames.length ? ('你已经看过：' + seenNames.join('、') + '。\n') : '') +
            '请先用你的人设写出此刻翻看「' + cur.name + '」的动作与态度 act（20~40 字），再写 1-3 条气泡，并挑下一个要看的页面 next（尽量挑没看过的）。\n' +
            '可选 next（填 id）：' + ids.join('、') + '\n' +
            '只输出 JSON：{"act":"<动作态度>","bubbles":["..."],"next":"<id>"}';
    }
    // 去掉模型可能带出的 "bubbles:" / "act:" / 引号 / JSON 碎片等前缀
    function cleanText(s) {
        var t = String(s == null ? '' : s).trim();
        if (!t) return '';
        t = t.replace(/^\s*["'`]?\s*(?:bubbles?|reaction|气泡|回复|内容|text)\s*["'`]?\s*[:：\-–—]\s*/i, '');
        t = t.replace(/^[\s"'`]+|[\s"'`]+$/g, '');
        t = t.replace(/^\s*[-–—•·*:：,，]\s*/, '');
        return t.trim();
    }
    function cleanAct(s) {
        var t = cleanText(s);
        t = t.replace(/^\s*["'`]?\s*(?:act|action|动作|态度)\s*["'`]?\s*[:：\-–—]\s*/i, '');
        return t.trim().slice(0, 120);
    }
    function normalizeBubbles(arr, cur) {
        var out = [];
        if (Array.isArray(arr)) {
            arr.forEach(function (b) {
                if (typeof b === 'string') { b = cleanText(b); if (b) out.push(b.slice(0, 200)); }
                else if (b && typeof b.text === 'string') { b = cleanText(b.text); if (b) out.push(b.slice(0, 200)); }
                else if (b && typeof b.content === 'string') { b = cleanText(b.content); if (b) out.push(b.slice(0, 200)); }
            });
        } else if (typeof arr === 'string' && cleanText(arr)) {
            out.push(cleanText(arr).slice(0, 200));
        }
        if (!out.length) out = ['（看了「' + ((cur && cur.name) || '这一页') + '」一会儿…）'];
        return out.slice(0, 3);
    }
    // 即使模型 JSON 不合法，也尽量从 bubbles 数组里把每条气泡抠出来，绝不把键名当内容
    function extractBubbles(s) {
        var str = String(s || '');
        var parsed = firstJson(str);
        if (parsed) {
            if (Array.isArray(parsed.bubbles)) return parsed.bubbles;
            if (typeof parsed.bubbles === 'string') return [parsed.bubbles];
            if (typeof parsed.reaction === 'string') return [parsed.reaction];
        }
        var km = /["']?bubbles["']?\s*[:：]\s*\[/i.exec(str);
        if (km) {
            var rest = str.slice(km.index + km[0].length);
            var depth = 0, inS = false, esc = false, end = rest.length, k;
            for (k = 0; k < rest.length; k++) {
                var ch = rest[k];
                if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inS = false; continue; }
                if (ch === '"') { inS = true; continue; }
                if (ch === ']') { end = k; break; }
            }
            rest = rest.slice(0, end);
            var out = [], m, re = /"((?:[^"\\]|\\.)*)"|“([^”]*)”|'((?:[^'\\]|\\.)*)'/g;
            while ((m = re.exec(rest)) !== null) {
                var v;
                if (m[1] != null) { try { v = JSON.parse('"' + m[1] + '"'); } catch (e) { v = m[1]; } }
                else v = (m[2] != null ? m[2] : m[3]);
                if (v != null && String(v).trim()) out.push(v);
            }
            if (out.length) return out;
        }
        return null;
    }
    function reactionFromContent(content, cur) {
        var s = String(content || '');
        var parsed = firstJson(s);
        var next = parsed && parsed.next ? parsed.next : null;
        var act = '';
        if (parsed) {
            if (typeof parsed.act === 'string') act = parsed.act;
            else if (typeof parsed.action === 'string') act = parsed.action;
        }
        if (!act) {
            var am = /["']?(?:act|action|动作|态度)["']?\s*[:：]\s*["“]?([^\n"”]+)/i.exec(s);
            if (am) act = am[1];
        }
        var bubbles = extractBubbles(s);
        if (!bubbles) {
            var raw = s.replace(/```[a-z]*/gi, ' ')
                .replace(/["']?(?:act|action|动作|态度)["']?\s*[:：][^\n]*/gi, ' ')
                .replace(/["']?bubbles["']?\s*[:：]/gi, ' ')
                .replace(/["']?next["']?\s*[:：]\s*[^,\n\]}]*/gi, ' ')
                .replace(/[{}[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
            bubbles = raw.split(/[\n。！？!?]+/).map(function (x) { return x.trim(); }).filter(Boolean);
        }
        return { act: cleanAct(act), bubbles: normalizeBubbles(bubbles, cur), next: next };
    }

    /* ---------------- 样式 ---------------- */
    function injectCss() {
        if (document.getElementById('tkCss')) return;
        var st = document.createElement('style');
        st.id = 'tkCss';
        st.textContent = [
            '.tk-lock{position:fixed;inset:0;z-index:100500;background:rgba(255,214,230,.10)}',
            '.tk-bar{position:fixed;left:0;right:0;bottom:0;z-index:100520;color:#5a4a52;',
            'background:linear-gradient(180deg,#fff7fb,#fffdf4);border-radius:22px 22px 0 0;',
            'box-shadow:0 -10px 34px rgba(190,140,160,.28);padding:12px 14px calc(14px + env(safe-area-inset-bottom));',
            'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif}',
            '.tk-head{display:flex;align-items:center;gap:10px}',
            '.tk-ava{width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:15px;background:#ffe1ea;color:#b23a5b;background-size:cover;background-position:center}',
            '.tk-name{font-size:15px;font-weight:700;color:#b23a5b}',
            '.tk-status{font-size:11px;color:#b08a97;margin-top:2px}',
            '.tk-prog{margin-left:auto;background:#fff3cf;color:#a4821f;font-size:11px;font-weight:700;border-radius:12px;padding:4px 10px}',
            '.tk-revoke{border:0;background:#ffe1ea;color:#b23a5b;border-radius:14px;padding:8px 12px;font-size:12px;font-weight:700}',
            '.tk-stream{margin-top:10px;max-height:38vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px}',
            '.tk-win{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;background:#ffe1ea;color:#b23a5b;',
            'border-radius:16px;padding:7px 13px;font-size:13px;font-weight:700;max-width:92%}',
            '.tk-win svg{width:16px;height:16px;flex:none}',
            '.tk-win .ex{font-weight:400;color:#c9809a;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}',
            '.tk-bub{align-self:flex-start;max-width:90%;background:#fff3cf;color:#7a5c12;border-radius:999px;',
            'padding:9px 17px;font-size:14px;line-height:1.55;white-space:pre-wrap;display:flex;flex-direction:column;gap:2px}',
            '.tk-bub .zh{font-size:11.5px;color:#b09a55}',
            '.tk-line{font-size:11px;color:#b08a97}',
            '.tk-act{align-self:center;font-size:11.5px;color:#8a6d5a;font-weight:700;text-align:center;line-height:1.7;max-width:20em;margin:2px auto;word-break:break-word}',
            '.tk-confirm{position:fixed;inset:0;z-index:100540;background:rgba(60,40,50,.4);display:grid;place-items:center;padding:24px}',
            '.tk-card{width:min(86vw,340px);background:linear-gradient(180deg,#fff7fb,#fffdf4);border-radius:22px;padding:22px 20px 14px;text-align:center;color:#5a4a52;',
            'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;box-shadow:0 20px 60px rgba(120,70,90,.28)}',
            '.tk-card .a{width:62px;height:62px;border-radius:50%;margin:0 auto 12px;background:#ffe1ea no-repeat center/cover;display:grid;place-items:center;font-size:24px;color:#b23a5b}',
            '.tk-card h3{margin:0 0 6px;font-size:17px;color:#b23a5b}',
            '.tk-card p{margin:0 0 18px;font-size:13px;color:#a98b96;line-height:1.6}',
            '.tk-actions{display:flex;gap:10px}',
            '.tk-actions button{flex:1;height:44px;border:0;border-radius:14px;font-size:15px;font-weight:700}',
            '.tk-deny{background:#f4eef0;color:#8a7078}.tk-allow{background:#ffb8cf;color:#7a1f3c}'
        ].join('');
        document.head.appendChild(st);
    }

    function confirmDialog(info, onAllow) {
        injectCss();
        var el = document.createElement('div');
        el.className = 'tk-confirm';
        el.innerHTML =
            '<div class="tk-card">' +
                '<div class="a"' + (info.avatar ? (' style="background-image:url(\'' + escHtml(info.avatar) + '\')"') : '') + '>' +
                    (info.avatar ? '' : escHtml(String(info.name || '?').slice(0, 1))) + '</div>' +
                '<h3>「' + escHtml(info.name || 'TA') + '」想看看你的手机</h3>' +
                '<p>TA 会翻看你的 App、聊天和群聊，并留下一些话。期间你无法操作，随时可以「夺回控制」。</p>' +
                '<div class="tk-actions"><button class="tk-deny">拒绝</button><button class="tk-allow">让 TA 看</button></div>' +
            '</div>';
        document.body.appendChild(el);
        TK.confirmEl = el;
        el.querySelector('.tk-deny').onclick = function () { try { el.remove(); } catch (e) {} TK.confirmEl = null; };
        el.querySelector('.tk-allow').onclick = function () { try { el.remove(); } catch (e) {} TK.confirmEl = null; console.log('[TK] allow clicked'); onAllow(); };
    }

    function buildUi(info) {
        injectCss();
        var lock = document.createElement('div');
        lock.className = 'tk-lock';
        var block = function (e) { try { e.stopPropagation(); e.preventDefault(); } catch (err) {} };
        ['touchstart', 'touchmove', 'wheel', 'mousedown', 'click'].forEach(function (ev) { lock.addEventListener(ev, block, { passive: false }); });
        document.body.appendChild(lock);

        var bar = document.createElement('div');
        bar.className = 'tk-bar';
        bar.innerHTML =
            '<div class="tk-head">' +
                '<div class="tk-ava"' + (info.avatar ? (' style="background-image:url(\'' + escHtml(info.avatar) + '\')"') : '') + '>' +
                    (info.avatar ? '' : escHtml(String(info.name || '?').slice(0, 1))) + '</div>' +
                '<div><div class="tk-name">' + escHtml(info.name || 'TA') + ' 在看你的手机</div>' +
                '<div class="tk-status">准备中… build39</div></div>' +
                '<div class="tk-prog">0/0</div>' +
                '<button class="tk-revoke">夺回控制</button>' +
            '</div>' +
            '<div class="tk-stream"></div>';
        document.body.appendChild(bar);

        TK.lock = lock; TK.bar = bar;
        TK.stream = bar.querySelector('.tk-stream');
        TK.statusEl = bar.querySelector('.tk-status');
        TK.progEl = bar.querySelector('.tk-prog');
        bar.querySelector('.tk-revoke').onclick = function () { revoke(); };
    }
    function setStatus(t) { if (TK.statusEl) TK.statusEl.textContent = String(t || ''); }
    function setProgress(i, n) { if (TK.progEl) TK.progEl.textContent = i + '/' + n; }
    function barLog(t) {
        try {
            var el = TK.stream || (TK.bar && TK.bar.querySelector('.tk-stream'));
            if (!el) return;
            var d = document.createElement('div');
            d.className = 'tk-line';
            d.textContent = String(t == null ? '' : t);
            el.appendChild(d); el.scrollTop = el.scrollHeight;
        } catch (e) {}
    }
    function addWindowCard(cur, sc) {
        if (!TK.stream) return;
        var ex = String((sc && sc.text) || '').replace(/\s+/g, ' ').trim();
        var d = document.createElement('div');
        d.className = 'tk-win';
        d.innerHTML = appIcon(cur.id, cur.kind) + '<span>' + escHtml(cur.name) + '</span>' +
            (ex ? ('<span class="ex">' + escHtml(clip(ex, 60)) + '</span>') : '');
        TK.stream.appendChild(d); TK.stream.scrollTop = TK.stream.scrollHeight;
    }
    function addBubble(text) {
        if (!TK.stream) return;
        var p = splitBy(text);
        var d = document.createElement('div');
        d.className = 'tk-bub';
        d.innerHTML = '<span>' + escHtml(p.main) + '</span>' + (p.sub ? ('<span class="zh">' + escHtml(p.sub) + '</span>') : '');
        TK.stream.appendChild(d); TK.stream.scrollTop = TK.stream.scrollHeight;
    }
    // 流式气泡：两个字两个字地往外吐，吐完一条再显示下一条
    function typeBubble(text) {
        return new Promise(function (resolve) {
            if (!TK.stream) { resolve(); return; }
            var p = splitBy(text);
            var segs = [{ text: p.main, cls: '' }];
            if (p.sub) segs.push({ text: p.sub, cls: 'zh' });
            var d = document.createElement('div');
            d.className = 'tk-bub';
            TK.stream.appendChild(d);
            var spans = segs.map(function (sg) {
                var sp = document.createElement('span');
                if (sg.cls) sp.className = sg.cls;
                d.appendChild(sp); return sp;
            });
            var si = 0, ci = 0, closed = false;
            function done() { if (closed) return; closed = true; resolve(); }
            function finishNow() {
                segs.forEach(function (sg, i) { spans[i].textContent = sg.text; });
                done();
            }
            function tick() {
                if (closed) return;
                if (!TK.active || TK.abort) { finishNow(); return; }
                if (si >= segs.length) { done(); return; }
                var seg = segs[si];
                ci += 2;
                spans[si].textContent = seg.text.slice(0, ci);
                TK.stream.scrollTop = TK.stream.scrollHeight;
                if (ci >= seg.text.length) { spans[si].textContent = seg.text; si++; ci = 0; }
                setTimeout(tick, 70);
            }
            tick();
        });
    }
    // 动作/态度：气泡前的一行居中动描
    function addActLine(text) {
        if (!TK.stream) return;
        var t = cleanAct(text);
        if (!t) return;
        var d = document.createElement('div');
        d.className = 'tk-act';
        d.textContent = t;
        TK.stream.appendChild(d); TK.stream.scrollTop = TK.stream.scrollHeight;
    }

    /* ---------------- 获取人设 / 世界书 / 记忆 ---------------- */
    function requestContext(info) {
        return new Promise(function (resolve) {
            var done = false, last = null;
            var onMsg = function (e) {
                var d = e && e.data;
                if (!d || d.type !== 'NANO_TAKEOVER_CONTEXT') return;
                last = d.context || null;
                if (last && (last.persona || last.worldbook || last.memory || last.api)) {
                    done = true; window.removeEventListener('message', onMsg); resolve(last);
                }
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
                if (tries < 10 && !done) setTimeout(ask, 500);
            };
            setTimeout(ask, 800);
            setTimeout(function () { if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(last); } }, 3500);
        });
    }

    /* ---------------- 主流程 ---------------- */
    function pageCount(total) {
        var raw = String(localStorage.getItem('nano_takeover_pages') || '5').trim();
        var max = Math.max(1, Number(total) || 5);
        // “全部”：把这次能翻的页面全看完（App + 该 user 名下的聊天与群聊）
        if (raw === 'all' || raw === '全部') return max;
        var n = parseInt(raw, 10);
        if (!n || n < 1) n = 5;
        if (n > max) n = max;
        return n;
    }

    async function begin(info) {
        console.log('[TK] begin enter', info);
        if (TK.begun) { console.log('[TK] begin ignored (already begun)'); return; }
        TK.begun = true;
        TK.active = true; TK.abort = false; TK.revoking = false;
        TK.cfg = null; TK.ctx = {};
        TK.info = info; TK.log = []; TK.startedAt = Date.now();
        buildUi(info);
        // 直接用 DOM 写第一行，绕过任何引用失效
        try {
            var barEl = TK.bar || document.querySelector('.tk-bar');
            var stEl = barEl && barEl.querySelector('.tk-status');
            if (stEl) stEl.textContent = '开始接管…';
            var sdEl = barEl && barEl.querySelector('.tk-stream');
            if (sdEl) { var ln = document.createElement('div'); ln.className = 'tk-line'; ln.textContent = '开始接管…'; sdEl.appendChild(ln); }
        } catch (e) { console.log('[TK] direct write failed', e); }
        setStatus('正在读取人设与 API…');
        console.log('[TK] ui built + first line written');
        TK.ctx = (await requestContext(info)) || {};
        if (!TK.active || TK.abort) return;
        // 主 API 配置优先由聊天内页提供（外壳自己读 IndexedDB 可能被卡住）
        if (TK.ctx.api && TK.ctx.api.url && TK.ctx.api.key && TK.ctx.api.model) {
            TK.cfg = { mainUrl: TK.ctx.api.url, mainKey: TK.ctx.api.key, mainModel: TK.ctx.api.model, mainTemp: TK.ctx.api.temp };
        }
        if (!TK.cfg) { setStatus('正在连接 API…'); TK.cfg = await getApiConfig(); }
        if (!TK.cfg || !TK.cfg.mainUrl || !TK.cfg.mainKey || !TK.cfg.mainModel) {
            barLog('没拿到主 API 配置。请在 API 页确认已填主接口 / Key / 模型。');
            setStatus('主 API 未配置');
            return;
        }
        barLog('主 API：' + (TK.cfg.mainModel || ''));
        barLog('人设/记忆：' + ((TK.ctx.persona || TK.ctx.memory) ? '已注入' : '空（不影响查看）'));
        var targets = buildTargets(TK.ctx);
        barLog('可查看页面：' + targets.length + ' 个');
        if (!targets.length) { end('empty'); return; }
        var seen = loadSeen();
        var N = pageCount(targets.length);
        TK.total = N;
        var used = {}, seenNames = [], viewedIds = [];
        var cur = pickNext(targets, used, seen);

        for (TK.i = 0; TK.i < N; TK.i++) {
            if (!TK.active || TK.abort) break;
            setProgress(TK.i + 1, N);
            setStatus('正在看「' + cur.name + '」（' + (TK.i + 1) + '/' + N + '）');
            openTarget(cur);
            // 每页多停留几秒，方便用户看清内容、随时夺回手机
            await sleep(5000);
            if (!TK.active || TK.abort) break;
            var sc = readScreen();
            addWindowCard(cur, sc);
            setStatus('「' + cur.name + '」看了一会儿…');
            await sleep(800);

            var content = '';
            try {
                content = await callApi([
                    { role: 'system', content: systemText() },
                    { role: 'user', content: userText(cur, sc, targets, seenNames) }
                ], 700);
            } catch (e) {
                barLog('这一步调用失败：' + (e && e.message ? e.message : e));
            }
            if (!TK.active || TK.abort) break;
            var r = reactionFromContent(content, cur);
            if (r.act) { addActLine(r.act); await sleep(900); }
            if (!TK.active || TK.abort) break;
            for (var bi = 0; bi < r.bubbles.length; bi++) {
                if (!TK.active || TK.abort) break;
                await typeBubble(r.bubbles[bi]);
                if (bi < r.bubbles.length - 1) await sleep(320);
            }
            TK.log.push({ app: cur.id, kind: cur.kind || '', name: cur.name, act: r.act || '', bubbles: r.bubbles });
            used[cur.id] = 1; viewedIds.push(cur.id); seenNames.push(cur.name);
            if (TK.i < N - 1) cur = resolveNext(r.next, targets, used, seen, cur);
            await sleep(1200);
        }
        if (TK.abort || !TK.active) { return; }
        saveSeen(viewedIds);
        await finishCard(info);
        end('finished');
    }

    // 用户夺回控制：立刻交还手机，角色反应随后再发
    async function revoke() {
        if (!TK.active || TK.revoking) return;
        TK.revoking = true; TK.abort = true;
        var info = TK.info;
        setStatus('你夺回了手机');
        // 先立刻撤掉遮罩、交还操作权，不等模型
        end('revoked');
        // 立刻把「被中断」的系统提示落进聊天（已有记录一并带上）
        try { await finishCard(info, { notice: '用户把手机收了回去，中断了「' + (info.name || 'TA') + '」的查看' }); } catch (e) {}
        // 角色反应在后台生成，生成了就直接发到聊天，不阻塞夺回
        try {
            var content = await callApi([
                { role: 'system', content: systemText() },
                { role: 'user', content: '用户刚刚在你翻看手机的途中，把控制权夺回去了，你被“踢”了出来。用你的人设写 1 条短反应（可以是不甘、好笑、嘴硬、委屈、撒娇、下次再来等），可带一点动作或态度。只输出 JSON：{"bubbles":["..."]}' }
            ], 220);
            // 只采用真正来自 API 的文本，绝不用内置兜底
            var parsed = firstJson(content) || {};
            var arr = extractBubbles(content);
            if (!arr) arr = Array.isArray(parsed.bubbles) ? parsed.bubbles : (parsed.bubbles ? [parsed.bubbles] : []);
            var t = cleanText(arr && arr[0] ? arr[0] : '');
            if (t && t.length <= 160) {
                var s = shell();
                if (s && s.postToChat) s.postToChat({ type: 'NANO_CHAR_SAY', chatId: String(info.id), text: t });
            }
        } catch (e) {}
    }

    function buildDetail(info) {
        var lines = ['（' + info.name + ' 查看了你的手机）'];
        TK.log.forEach(function (w) {
            lines.push('· ' + w.name);
            if (w.act) lines.push('　〔动作/态度〕' + w.act);
            (w.bubbles || []).forEach(function (b) {
                var p = splitBy(b);
                lines.push('　' + p.main + (p.sub ? ('（' + p.sub + '）') : ''));
            });
        });
        return lines.join('\n');
    }
    function countBubbles() { return TK.log.reduce(function (n, w) { return n + ((w.bubbles && w.bubbles.length) || 0); }, 0); }

    async function finishCard(info, opts) {
        opts = opts || {};
        if (!TK.log.length && !opts.notice) return;
        setStatus('正在把这次的查看放进你们的聊天…');
        var s = shell(); if (!s || !s.postToChat) return;
        s.open('chat_inner.html?chat=' + enc(info.id) + '&name=' + enc(info.name), '', 'main');
        await sleep(900);
        if (opts.charSay) {
            try { s.postToChat({ type: 'NANO_CHAR_SAY', chatId: String(info.id), text: String(opts.charSay) }); } catch (e) {}
            await sleep(350);
        }
        try {
            s.postToChat({
                type: 'NANO_TAKEOVER_CARD',
                chatId: String(info.id),
                title: info.name + ' 查看了你的手机',
                summary: '共 ' + TK.log.length + ' 个页面 · ' + countBubbles() + ' 条反应',
                detail: buildDetail(info),
                log: TK.log,
                notice: opts.notice || '',
                startedAt: TK.startedAt
            });
        } catch (e) {}
    }

    function start(info) {
        info = info || {};
        info.name = String(info.name || info.charName || 'TA');
        info.id = String(info.id || info.charId || info.name || '');
        console.log('[TK] start called', info.id, info.name);
        if (!info.id) return;
        // 纳米是助手，不允许它发起「反查 / 接管手机」
        if (info.id === 'nano_ai' || info.nanoAssistant) { console.log('[TK] refuse nano'); return; }
        // 已在进行中 / 已有确认弹窗 / 已开始 → 忽略重复触发（避免二次 buildUi 把状态重置成"准备中"）
        if (TK.active || TK.begun || TK.confirmEl) { console.log('[TK] start ignored'); return; }
        confirmDialog(info, function () {
            console.log('[TK] begin...');
            begin(info).catch(function (e) {
                try { buildMissingUiOnce(); barLog('接管出错：' + ((e && e.message) || e)); setStatus('出错'); console.log('[TK] error', e); } catch (err) {}
            });
        });
    }
    function buildMissingUiOnce() { if (!TK.bar) buildUi(TK.info); }
    function end(reason) {
        TK.abort = true;
        TK.active = false;
        TK.begun = false;
        try { if (TK.lock) TK.lock.remove(); } catch (e) {}
        try { if (TK.bar) TK.bar.remove(); } catch (e) {}
        TK.lock = null; TK.bar = null; TK.stream = null; TK.statusEl = null; TK.progEl = null;
    }

    /* ---------------- 角色主动发起 ---------------- */
    function proactiveNow() {
        try {
            var lc = JSON.parse(localStorage.getItem('nano_last_chat') || 'null');
            if (!lc || !lc.id) return false;
            if (lc.id === 'nano_ai') return false;   // 纳米不参与反查
            start({ id: lc.id, name: lc.name || 'TA', avatar: lc.avatar || '' });
            return true;
        } catch (e) { return false; }
    }
    function checkProactive() {
        try {
            if (TK.active) return;
            if (localStorage.getItem('nano_takeover_proactive') === '0') return;
            // 全天最多一名角色被反查
            var d = new Date();
            var dayKey = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
            if (localStorage.getItem('nano_takeover_day') === dayKey) return;
            var lc = JSON.parse(localStorage.getItem('nano_last_chat') || 'null');
            if (!lc || !lc.id || lc.id === 'nano_ai') return;   // 纳米不参与反查
            // 同一角色 14 天内只被反查一次
            var perChar = parseInt(localStorage.getItem('nano_takeover_char_at_' + lc.id) || '0', 10) || 0;
            if (Date.now() - perChar < 14 * 24 * 3600 * 1000) return;
            if (Math.random() > 0.35) return;
            localStorage.setItem('nano_takeover_proactive_at', String(Date.now()));
            localStorage.setItem('nano_takeover_day', dayKey);
            localStorage.setItem('nano_takeover_char_at_' + lc.id, String(Date.now()));
            start({ id: lc.id, name: lc.name || 'TA', avatar: lc.avatar || '' });
        } catch (e) {}
    }

    window.CharTakeover = {
        version: '20261003k',
        start: start,
        stop: function () { end('manual'); },
        isActive: function () { return TK.active; },
        proactiveNow: proactiveNow
    };

    window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d) return;
        if (d.type === 'startTakeover') start({ id: d.charId, name: d.charName, avatar: d.avatar });
        else if (d.type === 'takeoverProactive') proactiveNow();
    });

    try { setInterval(checkProactive, 30 * 60 * 1000); } catch (e) {}
})();
