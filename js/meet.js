/* meet.js — Meet 好友申请中心（微信号取自人设 Mask） */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var NF = window.NanoFriend;

    function toast(msg) {
        var el = $('ktToast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el.__t);
        el.__t = setTimeout(function () { el.classList.remove('show'); }, 1700);
    }

    var SRC_LABEL = { alt: '小号试探', groupnpc: '群聊好友', ins: 'Instagram', halo: 'Halo', other: '好友申请' };

    function renderWechat() {
        var el = $('ktWechat');
        if (!el) return;
        var wx = NF ? NF.wechat() : '';
        if (wx) { el.textContent = wx; el.classList.remove('empty'); }
        else { el.textContent = '未设置'; el.classList.add('empty'); }
    }

    function renderList() {
        var box = $('ktList');
        if (!box || !NF) return;
        var list = NF.list();
        var count = $('ktCount');
        if (count) count.textContent = String(list.length);
        box.innerHTML = '';
        if (!list.length) {
            var empty = document.createElement('div');
            empty.className = 'kt-empty';
            empty.textContent = '暂时没有新的好友申请';
            box.appendChild(empty);
            return;
        }
        list.forEach(function (r) {
            var row = document.createElement('div');
            row.className = 'kt-req';

            var av = document.createElement('div');
            av.className = 'kt-req-avatar';
            if (r.avatar) {
                var img = document.createElement('img');
                img.src = r.avatar; img.alt = '';
                av.appendChild(img);
            } else {
                av.textContent = String(r.name || '?').charAt(0);
            }
            row.appendChild(av);

            var main = document.createElement('div');
            main.className = 'kt-req-main';
            var nm = document.createElement('div');
            nm.className = 'kt-req-name';
            nm.textContent = r.name || '陌生人';
            var src = document.createElement('div');
            src.className = 'kt-req-src';
            src.textContent = '来自 ' + (SRC_LABEL[r.source] || '好友申请') + (r.requestNote ? (' · ' + r.requestNote) : '');
            main.appendChild(nm);
            main.appendChild(src);
            if (r.setting) {
                var note = document.createElement('div');
                note.className = 'kt-req-note';
                note.textContent = String(r.setting).replace(/\n+/g, ' ');
                main.appendChild(note);
            }
            row.appendChild(main);

            var acts = document.createElement('div');
            acts.className = 'kt-req-actions';
            var ok = document.createElement('button');
            ok.className = 'kt-accept'; ok.textContent = '同意';
            var no = document.createElement('button');
            no.className = 'kt-reject'; no.textContent = '拒绝';
            ok.addEventListener('click', function () {
                ok.disabled = true; ok.textContent = '…';
                // 被拉黑的角色主动加回：同意 = 解除拉黑 + 把 TA 那句招呼放进私聊，而不是新建一个角色
                if (r.unblockCharId) {
                    unblockChar(r.unblockCharId);
                    NF.setStatus(r.id, 'accepted');
                    queueChatInject(r.unblockCharId, [{ type: 'left', text: r.setting || '在吗？' }]);
                    toast('已同意「' + (r.name || '') + '」');
                    renderList();
                    return;
                }
                NF.accept(r.id).then(function (c) {
                    toast(c ? ('已添加「' + (r.name || '') + '」') : '添加失败');
                    renderList();
                });
            });
            no.addEventListener('click', function () {
                NF.reject(r.id);
                toast('已拒绝');
                renderList();
            });
            acts.appendChild(ok);
            acts.appendChild(no);
            row.appendChild(acts);

            box.appendChild(row);
        });
    }

    var back = $('ktBack');
    if (back) {
        back.addEventListener('click', function () {
            if (window.parent !== window) window.parent.postMessage({ type: 'nanoCloseOverlay' }, '*');
            else if (history.length > 1) history.back();
            else location.href = 'chat.html';
        });
    }

    var edit = $('ktEditWechat');
    if (edit) {
        edit.addEventListener('click', function () {
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'openFullscreen', url: 'mask.html', title: 'Mask', showBack: true }, '*');
            } else {
                location.href = 'mask.html';
            }
        });
    }

    // ============================================================
    // 搜索微信号 → 重新加回好友 / 角色主动加回
    // ============================================================
    function defaultWechat(id) {
        var h = 0, s = String(id || '');
        for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
        return 'wxid_' + h.toString(36);
    }
    function charWechat(c) { return (c && c.wechat) || defaultWechat(c && c.id); }
    function openCharDB() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }
    function allChars() {
        return openCharDB().then(function (db) {
            return new Promise(function (resolve) {
                if (!db) { resolve([]); return; }
                try {
                    var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
                    r.onsuccess = function () { resolve(r.result || []); try { db.close(); } catch (e) {} };
                    r.onerror = function () { resolve([]); try { db.close(); } catch (e) {} };
                } catch (e) { resolve([]); try { db.close(); } catch (e2) {} }
            });
        });
    }

    var charCache = [];
    allChars().then(function (list) {
        charCache = list || [];
        // 打开 Meet 时就让“被拉黑的角色”主动来加回（角色一定会出现，话由 API 生成）
        try { surfaceBlockedReadds(); } catch (e) {}
    });

    var searchEl = $('ktSearch');
    var resultsEl = $('ktSearchResults');

    function renderSearch() {
        if (!searchEl || !resultsEl) return;
        var kw = (searchEl.value || '').trim().toLowerCase();
        resultsEl.innerHTML = '';
        if (!kw) return;
        var hits = charCache.filter(function (c) {
            if (!c) return false;
            return String(c.name || '').toLowerCase().indexOf(kw) >= 0 || charWechat(c).toLowerCase().indexOf(kw) >= 0;
        }).slice(0, 8);
        if (!hits.length) {
            var empty = document.createElement('div');
            empty.className = 'kt-empty';
            empty.textContent = '没有找到这个微信号对应的好友';
            resultsEl.appendChild(empty);
            return;
        }
        hits.forEach(function (c) {
            var row = document.createElement('div');
            row.className = 'kt-search-item';
            var av = document.createElement('div');
            av.className = 'kt-req-avatar';
            if (c.avatar) { var im = document.createElement('img'); im.src = c.avatar; im.alt = ''; av.appendChild(im); }
            else { av.textContent = String(c.name || '?').charAt(0); }
            row.appendChild(av);
            var main = document.createElement('div');
            main.className = 'kt-si-main';
            var nm = document.createElement('div');
            nm.className = 'kt-si-name'; nm.textContent = c.name || '好友';
            var wx = document.createElement('div');
            wx.className = 'kt-si-wx'; wx.textContent = '微信号：' + charWechat(c);
            main.appendChild(nm); main.appendChild(wx);
            row.appendChild(main);
            var btn = document.createElement('button');
            btn.className = 'kt-accept'; btn.textContent = '添加';
            btn.addEventListener('click', function () { openGreet(c); });
            row.appendChild(btn);
            resultsEl.appendChild(row);
        });
    }
    if (searchEl) searchEl.addEventListener('input', renderSearch);

    // ---------- 打招呼栏（可对话 / 可重复添加） ----------
    var modal = $('ktModal');
    var modalTitle = $('ktModalTitle');
    var modalSub = $('ktModalSub');
    var modalInput = $('ktModalInput');
    var modalOk = $('ktModalOk');
    var modalCancel = $('ktModalCancel');
    var chatListEl = $('ktChatList');
    var modalMode = 'chat';
    var modalChat = { char: null, msgs: [], okToChat: false };

    function renderChatMsgs() {
        if (!chatListEl) return;
        chatListEl.innerHTML = '';
        modalChat.msgs.forEach(function (m) {
            var d = document.createElement('div');
            d.className = 'kt-chat-msg ' + (m.who === 'user' ? 'me' : (m.who === 'sys' ? 'sys' : 'ta'));
            d.textContent = m.text;
            chatListEl.appendChild(d);
        });
        chatListEl.scrollTop = chatListEl.scrollHeight;
    }
    function openGreet(c) {
        if (!modal) return;
        modalMode = 'chat';
        modalChat = { char: c, msgs: [], okToChat: false };
        modalTitle.textContent = '加「' + (c.name || '好友') + '」为好友';
        modalSub.textContent = '发一句打招呼的话，TA 会看到；点右上角刷新查看 TA 的回复。';
        if (chatListEl) chatListEl.classList.add('show');
        renderChatMsgs();
        modalInput.style.display = 'block';
        modalInput.value = '';
        modalOk.textContent = '发送';
        modal.classList.add('open');
        setTimeout(function () { try { modalInput.focus(); } catch (e) {} }, 60);
    }
    function openResult(title, sub, okText) {
        if (!modal) return;
        modalMode = 'result';
        modalTitle.textContent = title || '';
        modalSub.textContent = sub || '';
        if (chatListEl) chatListEl.classList.remove('show');
        modalInput.style.display = 'none';
        modalOk.textContent = okText || '知道了';
        modal.classList.add('open');
    }
    if (modal) {
        modalCancel.addEventListener('click', function () { modal.classList.remove('open'); });
        modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('open'); });
        modalOk.addEventListener('click', function () {
            if (modalMode !== 'chat') { modal.classList.remove('open'); return; }
            if (modalChat.okToChat) { openChat(modalChat.char.id, modalChat.char.name, modalChat.char.avatar); modal.classList.remove('open'); return; }
            var text = (modalInput.value || '').trim();
            if (!text || !modalChat.char) return;
            var c = modalChat.char;
            var prior = modalChat.msgs.filter(function (m) { return m.who !== 'sys'; }).map(function (m) {
                return (m.who === 'user' ? '用户' : (c.name || 'TA')) + '：' + m.text;
            }).join('\n');
            modalChat.msgs.push({ who: 'user', text: text });
            renderChatMsgs();
            modalInput.value = '';
            modalOk.disabled = true;
            var oldLabel = modalOk.textContent; modalOk.textContent = '…';
            decideAdd(c, text, prior).then(function (res) {
                modalOk.disabled = false; modalOk.textContent = '发送';
                if (res.action === 'accept') {
                    unblockChar(c.id);
                    queueChatInject(c.id, [{ type: 'right', text: text }, { type: 'left', text: res.say || '你好呀' }]);
                    modalChat.msgs.push({ who: 'ta', text: res.say || '你好呀，通过啦。' });
                    modalChat.msgs.push({ who: 'sys', text: '对方通过了你的好友申请，已加入私聊。' });
                    modalChat.okToChat = true;
                    modalOk.textContent = '去聊天';
                } else if (res.action === 'error') {
                    modalChat.msgs.push({ who: 'sys', text: res.say || '网络暂时不通，稍后再试。' });
                } else {
                    modalChat.msgs.push({ who: 'ta', text: res.say || '不好意思。' });
                    modalChat.msgs.push({ who: 'sys', text: '对方拒绝了，你可以再说一句继续加 TA。' });
                }
                renderChatMsgs();
            }).catch(function () { modalOk.disabled = false; modalOk.textContent = '发送'; });
        });
    }

    // ---------- 待发送申请队列 ----------
    var OUT_KEY = 'nano_meet_outgoing';
    function readOut() { try { return JSON.parse(localStorage.getItem(OUT_KEY) || '[]') || []; } catch (e) { return []; } }
    function writeOut(a) { try { localStorage.setItem(OUT_KEY, JSON.stringify((a || []).slice(-100))); } catch (e) {} }
    function readReqs() { try { return JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || []; } catch (e) { return []; } }
    function sendAddRequest(c, greeting) {
        if (!c) return;
        var out = readOut();
        out.push({ id: 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), charId: c.id, name: c.name || '', avatar: c.avatar || '', wechat: charWechat(c), greeting: greeting, ts: Date.now(), status: 'pending' });
        writeOut(out);
    }

    // ---------- 与角色 API ----------
    function readApiConfig() {
        return new Promise(function (resolve) {
            try {
                var ls = localStorage.getItem('nano_api_config');
                if (ls) { try { resolve(JSON.parse(ls)); return; } catch (e) {} }
            } catch (e) {}
            try {
                var req = indexedDB.open('nano_api_db', 2);
                req.onupgradeneeded = function (e) { var db = e.target.result; if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' }); };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
                        g.onsuccess = function () { resolve(g.result ? g.result.value : null); try { db.close(); } catch (e2) {} };
                        g.onerror = function () { resolve(null); };
                    } catch (e) { resolve(null); }
                };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }
    // 手机端：把 localhost/127.0.0.1 自动改写成本机所在局域网地址（与线上/线下同一套逻辑）
    function resolveMeetHost(url) {
        var s = String(url || '').trim();
        try {
            var u = new URL(s);
            var h = u.hostname.replace(/^\[|\]$/g, '');
            if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
                u.hostname = location.hostname;
                s = u.toString();
            }
        } catch (e) {}
        return s;
    }
    function callApi(cfg, messages, maxTokens) {
        var base = resolveMeetHost(cfg.mainUrl).replace(/\/+$/, '');
        if (!/\/v1$/i.test(base)) base += '/v1';
        return fetch(base + '/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + String(cfg.mainKey || '').trim(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: cfg.mainModel, messages: messages, max_tokens: maxTokens || 200, temperature: 0.9, stream: false })
        }).then(function (r) { return r.json(); }).then(function (d) {
            return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
        });
    }
    // 让角色决定是否通过好友申请 / 继续对话，并说一句话（一次 API 调用）
    function decideAdd(charRec, greeting, priorText) {
        return readApiConfig().then(function (cfg) {
            if (!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) return { action: 'error', say: '（还没有配置 API，TA 暂时没法回复）' };
            var persona = String((charRec && charRec.setting) || '').slice(0, 1200);
            var sys = '你是「' + ((charRec && charRec.name) || '角色') + '」。' + (persona ? ('你的设定：' + persona + '\n') : '')
                + (priorText ? ('以下是你们刚才在好友申请里的对话：\n' + priorText + '\n') : '')
                + '有人通过微信号「' + charWechat(charRec) + '」加你好友 / 继续跟你说话，TA 说：「' + String(greeting || '') + '」。'
                + '请像真人一样，按你的性格与此刻心情决定是否通过好友申请，并回一句自然的话（无论通过还是拒绝都要说话，像微信打招呼；如果已经通过，就正常聊下去，action 仍填 accept）。'
                + '只输出 JSON：{"action":"accept 或 reject","say":"一句自然的话"}。';
            return callApi(cfg, [{ role: 'system', content: sys }, { role: 'user', content: '（处理这条好友申请 / 消息）' }], 220).then(function (t) {
                var m = String(t || '').match(/\{[\s\S]*\}/);
                var o = null; try { o = m ? JSON.parse(m[0]) : null; } catch (e) {}
                if (!o) return { action: 'reject', say: '（对方没有回应）' };
                return { action: (String(o.action || '').toLowerCase().indexOf('accept') >= 0 || String(o.action) === '同意') ? 'accept' : 'reject', say: String(o.say || '').slice(0, 60) };
            }).catch(function () { return { action: 'error', say: '（网络暂时不通，稍后点刷新再试）' }; });
        });
    }

    function unblockChar(id) {
        try { localStorage.removeItem('chat_setting_blocked_' + id); localStorage.removeItem('chat_setting_blockedContacted_' + id); } catch (e) {}
        try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoBlockChanged', chatId: id, blocked: false, text: '已加回好友' }, '*'); } catch (e) {}
    }
    function queueChatInject(charId, msgs) {
        if (!charId || !msgs || !msgs.length) return;
        var key = 'nano_chat_inject_' + charId;
        var arr = [];
        try { arr = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) {}
        msgs.forEach(function (m) { if (m && m.text) arr.push({ type: m.type === 'left' ? 'left' : 'right', text: String(m.text) }); });
        try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    }
    function openChat(id, name, avatar) {
        try {
            if (window.parent !== window) window.parent.postMessage({ type: 'openChat', chatId: id, chatName: name || '', chatAvatar: avatar || '' }, '*');
            else location.href = 'chat_inner.html?chat=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name || '');
        } catch (e) {}
    }

    // 处理待发送的加好友申请（刷新时触发）
    var procBusy = false;
    function processOutgoing() {
        if (procBusy) return Promise.resolve();
        var pending = readOut().filter(function (x) { return x && x.status === 'pending'; });
        if (!pending.length) return Promise.resolve();
        procBusy = true;
        var chain = Promise.resolve();
        pending.forEach(function (req) {
            chain = chain.then(function () {
                var c = charCache.find(function (x) { return x && String(x.id) === String(req.charId); }) || { id: req.charId, name: req.name, setting: '', avatar: req.avatar };
                var isOpen = modal && modal.classList.contains('open') && modalChat.char && String(modalChat.char.id) === String(req.charId);
                var prior = isOpen
                    ? modalChat.msgs.filter(function (m) { return m.who !== 'sys'; }).map(function (m) { return (m.who === 'user' ? '用户' : (c.name || 'TA')) + '：' + m.text; }).join('\n')
                    : '';
                return decideAdd(c, req.greeting, prior).then(function (res) {
                    var all = readOut();
                    all.forEach(function (x) { if (x.id === req.id) { x.status = res.action; x.say = res.say; x.at = Date.now(); } });
                    writeOut(all);
                    if (res.action === 'accept') {
                        unblockChar(req.charId);
                        queueChatInject(req.charId, [{ type: 'right', text: req.greeting }, { type: 'left', text: res.say || '你好呀，通过啦。' }]);
                        if (isOpen) {
                            modalChat.msgs.push({ who: 'ta', text: res.say || '你好呀，通过啦。' });
                            modalChat.msgs.push({ who: 'sys', text: '对方通过了你的好友申请，已加入私聊。' });
                            modalChat.okToChat = true;
                            renderChatMsgs();
                            modalOk.textContent = '去聊天';
                        } else {
                            openResult('对方通过了你的好友申请', '「' + (req.name || '') + '」：' + (res.say || '你好呀'), '去聊天');
                        }
                    } else if (res.action === 'error') {
                        if (isOpen) { modalChat.msgs.push({ who: 'sys', text: res.say || '网络暂时不通，稍后点刷新再试。' }); renderChatMsgs(); }
                        else openResult('暂时没能送达', res.say || '网络暂时不通，稍后点刷新再试。', '知道了');
                    } else {
                        if (isOpen) {
                            modalChat.msgs.push({ who: 'ta', text: res.say || '不好意思。' });
                            modalChat.msgs.push({ who: 'sys', text: '对方拒绝了，你可以再说一句继续加 TA。' });
                            renderChatMsgs();
                        } else {
                            openResult('对方拒绝了你的好友申请', '「' + (req.name || '') + '」：' + (res.say || '不好意思'), '知道了');
                        }
                    }
                });
            });
        });
        return chain.catch(function () {}).then(function () { procBusy = false; });
    }

    // 被拉黑的角色：刷新时可能主动加回你（一次 API 调用，生成一句招呼）
    function surfaceBlockedReadds() {
        if (!charCache.length) return Promise.resolve();
        var hits = charCache.filter(function (c) {
            try { return localStorage.getItem('chat_setting_blocked_' + c.id) === 'true'; } catch (e) { return false; }
        });
        if (!hits.length) return Promise.resolve();
        // 已被挂起加回申请的，不重复
        var existing = [];
        try { existing = JSON.parse(localStorage.getItem('nano_friend_requests') || '[]') || []; } catch (e) {}
        hits = hits.filter(function (c) {
            return !existing.some(function (r) { return r && r.status === 'pending' && String(r.unblockCharId) === String(c.id); });
        });
        if (!hits.length) return Promise.resolve();
        var c = hits[Math.floor(Math.random() * hits.length)];
        function pushReadd(say) {
            var KEY = 'nano_friend_requests';
            var all = readReqs();
            if (all.some(function (r) { return r && r.status === 'pending' && String(r.unblockCharId) === String(c.id); })) return;
            var owner = NF ? NF.ownerNs() : 'default';
            all.push({
                id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
                owner: owner, name: c.name || '角色', avatar: c.avatar || '',
                source: 'other', setting: String(say || '在吗？我想把你加回来。'), originId: '', altOriginId: '',
                requestNote: '想把你加回来', unblockCharId: c.id, ts: Date.now(), status: 'pending'
            });
            try { localStorage.setItem(KEY, JSON.stringify(all.slice(-400))); } catch (e) {}
            try { window.dispatchEvent(new CustomEvent('nanoFriendRequestsChanged')); } catch (e) {}
        }
        // 角色一定会来加你（话由 API 生成，失败则用默认招呼），保证“拉黑后能在 Meet 里加回”
        return decideAdd(c, '（你之前被对方拉黑了，你现在想主动把 TA 加回来。）').then(function (res) {
            pushReadd(res && res.action !== 'error' && res.say ? res.say : '在吗？我想把你加回来。');
        }).catch(function () { pushReadd('在吗？我想把你加回来。'); });
    }

    // ---------- 刷新按钮 ----------
    var refreshBtn = $('ktRefresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            if (refreshBtn.classList.contains('spin')) return;
            refreshBtn.classList.add('spin');
            allChars().then(function (list) { charCache = list || []; })
                .then(function () { return processOutgoing(); })
                .then(function () { return surfaceBlockedReadds(); })
                .then(function () {
                    refreshBtn.classList.remove('spin');
                    renderList(); renderSearch(); toast('已刷新');
                })
                .catch(function () { refreshBtn.classList.remove('spin'); });
        });
    }

    window.addEventListener('nanoFriendRequestsChanged', renderList);
    renderWechat();
    renderList();
    try { if (window.parent !== window) window.parent.postMessage({ type: 'pageLoaded', page: 'meet' }, '*'); } catch (e) {}
})();
