/* =========================================================
   角色聊天记录页（chat → 主页 → 图库下面的卡片）
   - 灰白黑
   - 手动生成通过外壳模块（index 里的 NanoSecretChat）调用 API
   - 记录可反复查看、分享成卡片到某个 char 的私聊
   ========================================================= */
(function () {
    'use strict';

    var CFG_PREFIX = 'nano_char_rel_';
    var RECORDS_KEY = 'nano_char_secret_chats';
    var $ = function (id) { return document.getElementById(id); };

    var bound = [];
    var chars = [];
    var records = [];
    var currentRecord = null;
    var toastTimer = null;
    var busy = false;
    var translating = false;

    function toast(msg, ms) {
        var el = $('ccToast');
        if (!el) return;
        el.textContent = String(msg || '');
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function parseJson(raw, fallback) {
        try { var v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function homeMask() {
        // 外壳/聊天页把当前 user 存在 nano_mask_data；nano_home_data 只是旧键名
        var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
        for (var i = 0; i < keys.length; i++) {
            var h = parseJson(localStorage.getItem(keys[i]), null);
            if (h && Array.isArray(h.masks) && h.masks.length) {
                var id = h.currentMaskId;
                if (id) {
                    var m = h.masks.find(function (x) { return x && String(x.id) === String(id); });
                    if (m) return m;
                }
                return h.masks[0];
            }
        }
        return { id: 'm_default', name: '我', bindChars: [] };
    }
    function idbChars() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) {
                    try {
                        var g = e.target.result.transaction('characters', 'readonly').objectStore('characters').getAll();
                        g.onsuccess = function () { resolve(g.result || []); };
                        g.onerror = function () { resolve([]); };
                    } catch (err) { resolve([]); }
                };
                req.onerror = function () { resolve([]); };
            } catch (e) { resolve([]); }
        });
    }
    async function getBoundChars() {
        var all = await idbChars();
        var mask = homeMask();
        var mid = String(mask.id || '');
        // 和聊天列表保持一致：优先取 bindUser === 当前 user 的全部角色（含 NPC / 小号）
        var out = mid ? all.filter(function (c) {
            return c && String(c.bindUser) === mid && !c.nanoAssistant;
        }) : [];
        if (!out.length) {
            var binds = Array.isArray(mask.bindChars) ? mask.bindChars.map(String) : [];
            if (binds.length) {
                out = all.filter(function (c) {
                    if (!c || c.nanoAssistant) return false;
                    return binds.indexOf(String(c.id)) > -1 || binds.indexOf(String(c.name)) > -1;
                });
            }
        }
        if (!out.length) {
            var contacts = parseJson(localStorage.getItem('nano_contacts_data'), []);
            if (Array.isArray(contacts)) {
                out = contacts.filter(function (c) {
                    return c && String(c.bindUser) === mid && !c.nanoAssistant;
                });
            }
        }
        return { all: all, bound: out, mask: mask };
    }

    function getConfig(id) {
        var v = parseJson(localStorage.getItem(CFG_PREFIX + id), null) || {};
        return {
            privateEnabled: !!v.privateEnabled,
            shareEnabled: !!v.shareEnabled,
            rounds: Math.max(1, Math.min(10, parseInt(v.rounds, 10) || 3)),
            relationIds: (Array.isArray(v.relationIds) ? v.relationIds : []).map(String).filter(Boolean),
            lastAutoAt: Number(v.lastAutoAt) || 0,
            lastManualAt: Number(v.lastManualAt) || 0
        };
    }

    function loadRecords() {
        var arr = parseJson(localStorage.getItem(RECORDS_KEY), []);
        var mask = homeMask();
        var boundIds = {};
        bound.forEach(function (c) { boundIds[String(c.id)] = 1; });
        return (Array.isArray(arr) ? arr : []).filter(function (r) {
            if (!r || !r.a || !r.b || !Array.isArray(r.lines) || !r.lines.length) return false;
            if (r.maskId && String(r.maskId) !== String(mask.id)) return false;
            return boundIds[String(r.a.id)] && boundIds[String(r.b.id)];
        }).sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
    }

    function fmtTime(ts) {
        var d = new Date(ts || Date.now());
        var p = function (n) { return String(n).padStart(2, '0'); };
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function charById(id) {
        return bound.find(function (c) { return String(c.id) === String(id); }) ||
            chars.find(function (c) { return String(c.id) === String(id); }) || null;
    }
    function charName(id) {
        var c = charById(id);
        return (c && c.name) || ('角色' + String(id).slice(-4));
    }

    function fillSelects() {
        // 单边开启：这里列出当前 user 的全部绑定角色；只要任意一方开启并勾选对方就能生成
        var candidates = bound.slice();
        var a = $('ccA'), b = $('ccB');
        if (!a || !b) return;
        var opts = candidates.map(function (c) {
            return '<option value="' + esc(c.id) + '">' + esc(c.name || '未命名') + '</option>';
        }).join('');
        var prevA = a.value, prevB = b.value;
        a.innerHTML = opts || '<option value="">当前 user 没有绑定角色</option>';
        b.innerHTML = opts || '<option value="">当前 user 没有绑定角色</option>';
        if (prevA) a.value = prevA;
        if (prevB) b.value = prevB;
        if (a.value && b.value && a.value === b.value) {
            var other = candidates.find(function (c) { return String(c.id) !== a.value; });
            if (other) b.value = String(other.id);
        }
        var enough = candidates.length >= 2;
        var btn = $('ccGenerate');
        if (btn) btn.disabled = !enough || busy;
        var hint = $('ccGenerateHint');
        if (hint) {
            hint.textContent = enough
                ? '任意一方开启并勾选对方即可，另一方会自动同步。1 次 API 生成约 2 轮，2 次约 3~4 轮。'
                : '当前 user 至少需要 2 个绑定角色。';
        }
        // 分享选择：所有绑定角色
        var share = $('ccShareChar');
        if (share) {
            var prevS = share.value;
            share.innerHTML = bound.map(function (c) {
                return '<option value="' + esc(c.id) + '">发给 ' + esc(c.name || '未命名') + '</option>';
            }).join('');
            if (prevS) {
                var hit = bound.some(function (c) { return String(c.id) === String(prevS); });
                if (hit) share.value = prevS;
            }
        }
    }

    function renderAutoNote() {
        var el = $('ccAutoNote');
        if (!el) return;
        if (bound.length < 2) {
            el.textContent = '当前 user 还没有两个绑定角色。';
            return;
        }
        var enabled = bound.filter(function (c) { return getConfig(c.id).privateEnabled; });
        if (!enabled.length) {
            el.textContent = '还没有角色开启私下聊天。任意一方开启并勾选对方后即可自动/手动生成。';
            return;
        }
        var last = 0;
        enabled.forEach(function (c) {
            var cf = getConfig(c.id);
            last = Math.max(last, cf.lastAutoAt || 0, cf.lastManualAt || 0);
        });
        if (!last) el.textContent = '已开启。打开 App 后会自动检查，约 3 天生成一次。';
        else el.textContent = '上次刷新：' + new Date(last).toLocaleString('zh-CN') + '。约 3 天自动检查一次。';
    }

    function renderList() {
        var box = $('ccList');
        if (!box) return;
        if (!records.length) {
            box.innerHTML = '<div class="cc-empty">还没有私下聊天记录</div>';
            return;
        }
        box.innerHTML = records.map(function (r, idx) {
            var first = (r.lines[0] && (r.lines[0].translation || r.lines[0].text)) || '';
            var src = r.source === 'auto' ? '自动' : '手动';
            return '<div class="cc-card" data-idx="' + idx + '">' +
                '<div class="cc-card-head"><div class="cc-card-title">' + esc((r.a.name || 'A') + ' × ' + (r.b.name || 'B')) + '</div>' +
                '<span class="cc-card-badge">' + esc(src) + '</span></div>' +
                '<div class="cc-card-meta">' + esc(fmtTime(r.at) + ' · ' + (r.calls || 1) + ' 次 API · ' + r.lines.length + ' 句') + '</div>' +
                '<div class="cc-card-preview">' + esc(first) + '</div>' +
                '<div class="cc-card-actions">' +
                '<button class="cc-mini dark" data-act="view" data-idx="' + idx + '" type="button">查看</button>' +
                '<button class="cc-mini" data-act="share" data-idx="' + idx + '" type="button">分享给角色</button>' +
                '<button class="cc-mini danger" data-act="del" data-idx="' + idx + '" type="button">删除</button>' +
                '</div></div>';
        }).join('');
        box.querySelectorAll('[data-act]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var idx = parseInt(btn.getAttribute('data-idx'), 10);
                var rec = records[idx];
                if (!rec) return;
                var act = btn.getAttribute('data-act');
                if (act === 'view') openViewer(rec);
                else if (act === 'share') openViewer(rec, true);
                else if (act === 'del') deleteRecord(rec);
            });
        });
        box.querySelectorAll('.cc-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var idx = parseInt(card.getAttribute('data-idx'), 10);
                if (records[idx]) openViewer(records[idx]);
            });
        });
    }

    function openViewer(rec, focusShare) {
        currentRecord = rec;
        var modal = $('ccModal');
        var title = $('ccModalTitle');
        var body = $('ccTranscript');
        if (!modal || !title || !body) return;
        title.textContent = (rec.a.name || 'A') + ' × ' + (rec.b.name || 'B') + ' · ' + fmtTime(rec.at);
        body.innerHTML = rec.lines.map(function (l) {
            var who = l.who === 'b' ? 'b' : 'a';
            return '<div class="cc-bubble ' + who + '"><div class="cc-bubble-name">' + esc(l.name || '') + '</div>' +
                esc(l.text || '') +
                (l.translation ? '<div class="cc-bubble-trans">中文：' + esc(l.translation) + '</div>' : '') +
                '</div>';
        }).join('');
        modal.classList.add('open');
        if (focusShare) {
            var share = $('ccShareChar');
            if (share) setTimeout(function () { try { share.focus(); } catch (e) {} }, 200);
        }
    }
    function closeViewer() {
        var modal = $('ccModal');
        if (modal) modal.classList.remove('open');
        currentRecord = null;
    }

    function deleteRecord(rec) {
        if (!confirm('删除这条私下聊天记录？（已经写进角色记忆的内容不会删除）')) return;
        var all = parseJson(localStorage.getItem(RECORDS_KEY), []);
        all = (Array.isArray(all) ? all : []).filter(function (x) { return x && String(x.id) !== String(rec.id); });
        try { localStorage.setItem(RECORDS_KEY, JSON.stringify(all)); } catch (e) {}
        records = loadRecords();
        renderList();
        toast('已删除记录');
    }

    async function shareToChar(rec, charId) {
        if (!rec || !charId) return;
        if (!window.localforage) { toast('存储模块未加载，请刷新后重试'); return; }
        var c = charById(charId);
        if (!c) { toast('角色不存在'); return; }
        var now = new Date();
        var p = function (n) { return String(n).padStart(2, '0'); };
        var card = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: 'right',
            text: '',
            time: p(now.getHours()) + ':' + p(now.getMinutes()),
            status: 'read',
            recalled: false,
            isCard: true,
            cardData: {
                cardType: 'charSecretChat',
                title: (rec.a.name || 'A') + ' × ' + (rec.b.name || 'B') + ' 的悄悄话',
                sub: '点击查看完整对话',
                secretRecordId: rec.id,
                secretAt: rec.at,
                secretLines: rec.lines.map(function (l) {
                    return { who: l.who, name: l.name, text: String(l.text || '').slice(0, 800), translation: String(l.translation || '').slice(0, 800) };
                })
            }
        };
        try {
            var key = 'chat_messages_' + charId;
            var arr = await localforage.getItem(key);
            arr = Array.isArray(arr) ? arr : [];
            if (!arr.some(function (m) { return m && m.id === card.id; })) arr.push(card);
            await localforage.setItem(key, arr);
            try { localStorage.setItem(key, JSON.stringify(arr.slice(-200))); } catch (e) {}
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'nanoSecretRouteCard', chatId: String(charId), card: card }, '*');
            }
            toast('已打包成卡片，发到 ' + (c.name || '角色') + ' 的私聊');
        } catch (e) {
            toast('发送失败：' + ((e && e.message) || e), 3200);
        }
    }

    function generate() {
        if (busy) return;
        var a = $('ccA') ? $('ccA').value : '';
        var b = $('ccB') ? $('ccB').value : '';
        var calls = $('ccCalls') ? parseInt($('ccCalls').value, 10) || 1 : 1;
        if (!a || !b || a === b) { toast('请选择两个不同的角色'); return; }
        if (window.parent === window) { toast('请从 App 内打开这个页面'); return; }
        busy = true;
        var btn = $('ccGenerate');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="cc-busy"></span>正在生成…'; }
        var requestId = 'req_' + Date.now();
        window.__ccRequestId = requestId;
        try {
            window.parent.postMessage({
                type: 'nanoSecretGenerate',
                aId: a, bId: b, calls: calls, requestId: requestId,
                maskId: String((homeMask() || {}).id || ''), allowUnbound: true
            }, '*');
        } catch (e) {
            busy = false;
            if (btn) { btn.disabled = false; btn.textContent = '让他们聊聊'; }
            toast('无法发起生成');
        }
    }

    function onMessage(e) {
        var d = e && e.data;
        if (!d || !d.type) return;
        if (d.type === 'nanoSecretChatUpdated') {
            var wasBusy = busy;
            busy = false;
            var btn = $('ccGenerate');
            if (btn) { btn.disabled = false; btn.textContent = '让他们聊聊'; }
            var regenBtn = $('ccRegenerate');
            if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = '再聊一段（1 次 API）'; }
            var trBtn = $('ccTranslate');
            if (trBtn) { trBtn.disabled = false; translating = false; trBtn.textContent = '翻译这段（1 次 API）'; }
            records = loadRecords();
            renderList();
            renderAutoNote();
            fillSelects();
            if (wasBusy) toast('生成成功，已写进双方记忆');
            // 如果弹窗正开着，刷新成最新
            if (d.record && $('ccModal') && $('ccModal').classList.contains('open')) openViewer(d.record);
            return;
        }
        if (d.type === 'nanoSecretError') {
            busy = false;
            var b2 = $('ccGenerate');
            if (b2) { b2.disabled = false; b2.textContent = '让他们聊聊'; }
            var r2 = $('ccRegenerate');
            if (r2) { r2.disabled = false; r2.textContent = '再聊一段（1 次 API）'; }
            var t2 = $('ccTranslate');
            if (t2) { t2.disabled = false; translating = false; t2.textContent = '翻译这段（1 次 API）'; }
            toast('生成失败：' + (d.message || '未知错误'), 4200);
        }
    }

    function bind() {
        var back = $('ccBack');
        if (back) back.addEventListener('click', function () {
            if (window.parent !== window) {
                try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } catch (e) {}
            }
            history.back();
        });
        var gen = $('ccGenerate');
        if (gen) gen.addEventListener('click', generate);
        var close = $('ccModalClose');
        if (close) close.addEventListener('click', closeViewer);
        var modal = $('ccModal');
        if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeViewer(); });
        var share = $('ccShareBtn');
        if (share) share.addEventListener('click', function () {
            if (!currentRecord) return;
            var id = $('ccShareChar') ? $('ccShareChar').value : '';
            if (!id) { toast('请选择要发送的角色'); return; }
            shareToChar(currentRecord, id);
        });
        var regen = $('ccRegenerate');
        if (regen) regen.addEventListener('click', function () {
            if (!currentRecord || busy) return;
            if (window.parent === window) { toast('请从 App 内打开这个页面'); return; }
            var aId = currentRecord.a && currentRecord.a.id;
            var bId = currentRecord.b && currentRecord.b.id;
            if (!aId || !bId) { toast('记录缺少角色信息'); return; }
            busy = true;
            if (regen) { regen.disabled = true; regen.innerHTML = '<span class="cc-busy"></span>续聊中…'; }
            try {
                window.parent.postMessage({ type: 'nanoSecretGenerate', aId: aId, bId: bId, calls: 1, requestId: 'regen_' + Date.now(), maskId: String((homeMask() || {}).id || ''), allowUnbound: true }, '*');
                toast('已开始续聊，不会遮挡其它操作');
            } catch (e) {
                busy = false;
                if (regen) { regen.disabled = false; regen.textContent = '再聊一段（1 次 API）'; }
                toast('无法发起生成');
            }
        });
        var trans = $('ccTranslate');
        if (trans) trans.addEventListener('click', function () {
            if (!currentRecord || translating) return;
            if (window.parent === window) { toast('请从 App 内打开这个页面'); return; }
            translating = true;
            if (trans) { trans.disabled = true; trans.innerHTML = '<span class="cc-busy"></span>翻译中…'; }
            try {
                window.parent.postMessage({ type: 'nanoSecretTranslate', recordId: currentRecord.id }, '*');
                toast('正在翻译这段对话…');
            } catch (e) {
                translating = false;
                if (trans) { trans.disabled = false; trans.textContent = '翻译这段（1 次 API）'; }
                toast('无法发起翻译');
            }
        });
        var a = $('ccA'), b = $('ccB');
        if (a) a.addEventListener('change', fillSelects);
        if (b) b.addEventListener('change', fillSelects);
    }

    async function init() {
        bind();
        window.addEventListener('message', onMessage);
        var data = await getBoundChars();
        chars = data.all;
        bound = data.bound;
        records = loadRecords();
        fillSelects();
        renderAutoNote();
        renderList();
        // 进入页面时让外壳检查一次（不阻塞）
        if (window.parent !== window) {
            try { window.parent.postMessage({ type: 'nanoSecretAutoCheck' }, '*'); } catch (e) {}
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
