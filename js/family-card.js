// ============================================================
// family-card.js — 亲属卡页面逻辑
// 与 chat_inner 通过 postMessage 协作：
//   NANO_FAMILY_CARD_SUBMIT { chatId, name, limit }  我邀请对方开卡（对方 AI 决定）
//   NANO_FAMILY_CARD_RESULT { chatId, familyId, status } 我接受/拒绝对方邀请
// 银行卡流水直接读写 nano_wallet_db（经 NanoFamilyCardStore）。
// ============================================================
(function () {
    'use strict';

    var S = window.NanoFamilyCardStore;

    function getQuery(name) {
        try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
    }

    var chatId = getQuery('chat');
    var contactName = getQuery('name');
    var focusCardId = getQuery('card') || '';
    if (!chatId || !contactName) {
        try {
            var info = JSON.parse(sessionStorage.getItem('inner_setting_info') || 'null') ||
                       JSON.parse(sessionStorage.getItem('last_chat_info') || 'null');
            if (info) {
                if (!chatId) chatId = info.chatId || info.id;
                if (!contactName) contactName = info.name || info.chatName;
            }
        } catch (e) {}
    }
    chatId = chatId || 'default';
    contactName = contactName || '对方';

    // 读取角色人设（用于确定对方初始银行卡余额）
    function loadPersona(cb) {
        try {
            var req = indexedDB.open('nano_characters_db', 1);
            req.onupgradeneeded = function (e) {
                try {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' });
                } catch (err) {}
            };
            req.onsuccess = function () {
                var db = req.result;
                try {
                    var r = db.transaction('characters', 'readonly').objectStore('characters').get(chatId);
                    r.onsuccess = function () { cb(r.result || null); };
                    r.onerror = function () { cb(null); };
                } catch (e) { cb(null); }
            };
            req.onerror = function () { cb(null); };
        } catch (e) { cb(null); }
    }

    var $ = function (id) { return document.getElementById(id); };
    var fcList = $('fcList');
    var fcFlow = $('fcFlow');
    var fcTotal = $('fcTotal');
    var fcUsed = $('fcUsed');
    var fcBalance = $('fcBalance');
    var inviteModal = $('inviteModal');
    var inviteLimit = $('inviteLimit');
    var limitModal = $('limitModal');
    var limitInput = $('limitInput');
    var refreshModal = $('refreshModal');
    var refreshStatus = $('refreshStatus');
    var refreshApiBtn = $('refreshApiBtn');
    var refreshRandomBtn = $('refreshRandomBtn');
    var refreshCancel = $('refreshCancel');
    var editingId = null;
    var charData = null;
    var refreshRun = 0;

    // 开卡银行选择：只列用户真实持有的银行卡，额度不能超过该卡余额
    var inviteBanks = $('inviteBanks');
    var inviteCards = [];
    var _fundingCardId = '';
    function cardTheme(card) {
        try { return (window.NanoBank && NanoBank.get(card.bankId)) || { bg: 'linear-gradient(135deg,#3d434a,#22262b)' }; } catch (e) { return { bg: 'linear-gradient(135deg,#3d434a,#22262b)' }; }
    }
    function last4(card) {
        var n = String((card && card.cardNumber) || '').replace(/\s/g, '');
        return n ? n.slice(-4) : '0000';
    }
    function renderInviteBanks() {
        if (!inviteBanks) return;
        if (!inviteCards.length) {
            inviteBanks.innerHTML = '<div class="fc-banks-empty">还没有银行卡，请先到钱包添加</div>';
            return;
        }
        inviteBanks.innerHTML = inviteCards.map(function (c) {
            var bank = cardTheme(c);
            var name = c.bankName || ((window.NanoBank && NanoBank.get(c.bankId).name) || '银行卡');
            return '<button type="button" class="fc-bank' + (c.id === _fundingCardId ? ' sel' : '') + '" data-card="' + esc(c.id) + '">' +
                '<span class="sw" style="background:' + bank.bg + '"></span><span class="nm">' + esc(name) + '</span>' +
                '<span class="sub">尾号 ' + esc(last4(c)) + ' · ' + moneyCompact(c.balance) + '</span></button>';
        }).join('');
    }
    function loadInviteBanks() {
        if (!S) return Promise.resolve([]);
        return S.readWallet().then(function (wd) {
            wd = S.normalizeWallet(wd);
            inviteCards = (wd.cards || []).map(function (c) {
                return { id: c.id, bankId: c.bankId, bankName: c.bankName, cardNumber: c.cardNumber, balance: Number(c.balance) || 0, active: String(c.id) === String(wd.activeCardId) };
            });
            if (!_fundingCardId || !inviteCards.some(function (c) { return c.id === _fundingCardId; })) {
                var active = inviteCards.filter(function (c) { return c.active; })[0] || inviteCards[0];
                _fundingCardId = active ? active.id : '';
            }
            renderInviteBanks();
            return inviteCards;
        }).catch(function () { renderInviteBanks(); return []; });
    }
    if (inviteBanks) {
        inviteBanks.addEventListener('click', function (e) {
            var btn = e.target.closest('.fc-bank');
            if (!btn) return;
            _fundingCardId = btn.getAttribute('data-card') || '';
            Array.prototype.forEach.call(inviteBanks.querySelectorAll('.fc-bank'), function (b) {
                b.classList.toggle('sel', b === btn);
            });
        });
    }

    function money(n) {
        n = Number(n) || 0;
        return '¥' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    // 概览数字用紧凑写法，避免大额被截断（万/亿）
    function moneyCompact(n) {
        n = Number(n) || 0;
        var abs = Math.abs(n);
        if (abs >= 1e8) return '¥' + (n / 1e8).toFixed(2) + '亿';
        if (abs >= 1e4) return '¥' + (n / 1e4).toFixed(2) + '万';
        return '¥' + n.toFixed(2);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c;
        });
    }
    function formatTime(iso) {
        try {
            var d = new Date(iso);
            var p = function (x) { return String(x).padStart(2, '0'); };
            return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
        } catch (e) { return ''; }
    }
    function toast(msg) {
        var t = $('fcToast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(function () { t.classList.remove('show'); }, 1800);
    }
    function postToParent(data) {
        try { if (window.parent && window.parent !== window) window.parent.postMessage(data, '*'); } catch (e) {}
    }

    // ===== 渲染 =====
    function renderCards(cards) {
        if (!cards.length) {
            fcList.innerHTML = '<div class="fc-empty">还没有亲属卡，点右上角「邀请开卡」开始吧</div>';
            return;
        }
        fcList.innerHTML = cards.map(function (c) {
            var active = c.status === 'active';
            var pending = c.status === 'pending';
            var rejected = c.status === 'rejected';
            var mine = c.issuer === 'user';          // 我出资、对方使用
            var cls = 'fc-card' + (!mine ? ' received' : '') + (pending ? ' pending' : '') + (rejected ? ' rejected' : '');
            var typeLabel = mine ? ('我开给 ' + contactName) : (contactName + ' 开给我');
            var badge = active ? '使用中' : (pending ? '待处理' : '已拒绝');
            var used = Number(c.monthlySpent != null ? c.monthlySpent : (c.spent || 0));
            var remain = Math.max(0, Number(c.limit || 0) - used);
            var actions = '';
            if (pending && !mine) {
                actions = '<div class="fc-card-actions">' +
                    '<button class="fc-card-btn solid" data-act="accept" data-id="' + esc(c.id) + '">接受</button>' +
                    '<button class="fc-card-btn danger" data-act="reject" data-id="' + esc(c.id) + '">拒绝</button>' +
                    '</div>';
            } else if (active) {
                actions = '<div class="fc-card-actions">' +
                    '<button class="fc-card-btn" data-act="adjust" data-id="' + esc(c.id) + '">调整额度</button>' +
                    '<button class="fc-card-btn solid" data-act="spend" data-id="' + esc(c.id) + '">消费</button>' +
                    '<button class="fc-card-btn danger" data-act="remove" data-id="' + esc(c.id) + '">解绑</button>' +
                    '</div>';
            } else if (pending && mine) {
                actions = '<div class="fc-card-actions">' +
                    '<button class="fc-card-btn danger" data-act="remove" data-id="' + esc(c.id) + '">撤销邀请</button>' +
                    '</div>';
            } else if (rejected) {
                actions = '<div class="fc-card-actions">' +
                    '<button class="fc-card-btn danger" data-act="remove" data-id="' + esc(c.id) + '">删除</button>' +
                    '</div>';
            }
            var bank = (window.NanoBank && NanoBank.get(c.bankId)) || null;
            var bankName = c.bankName || (bank ? bank.name : '');
            return '<div class="' + cls + '">' +
                '<div class="fc-card-top"><span class="fc-card-type">' + esc(typeLabel) + '</span>' +
                '<span class="fc-badge">' + badge + '</span></div>' +
                (bankName ? '<div class="fc-bank-name">' + esc(bankName) + '</div>' : '') +
                '<div class="fc-card-limit">' + moneyCompact(c.limit) + '</div>' +
                '<div class="fc-card-meta">已用 ' + moneyCompact(used) + ' · 剩余 ' + moneyCompact(remain) + '</div>' +
                actions +
                '</div>';
        }).join('');
    }

    function flowIcon(desc, isIncome) {
        var d = String(desc || '');
        var wrap = function (inner) {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
        };
        if (/亲属卡/.test(d)) {
            return wrap('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M12 13v5M9.5 15.5 12 13l2.5 2.5"/>');
        }
        if (/工资|收入|转入|退款|红包|返现|入账|奖金/.test(d)) {
            return wrap('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');
        }
        if (/超市|便利店|商场|购物|商城|淘宝|京东|拼多多|买|礼物/.test(d)) {
            return wrap('<path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>');
        }
        if (/咖啡|奶茶|茶|饮|星巴克|瑞幸/.test(d)) {
            return wrap('<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2"/><path d="M7 3v2M10 3v2M13 3v2"/>');
        }
        if (/外卖|餐|饭|火锅|烧烤|麻辣烫|甜品|蛋糕|面|粉|食/.test(d)) {
            return wrap('<path d="M7 3v7"/><path d="M4.5 3v4a2.5 2.5 0 0 0 5 0V3"/><path d="M7 10v11"/><path d="M16.5 3c-1.6 2.2-2.4 4.7-2.4 7.5h4.8c0-2.8-.8-5.3-2.4-7.5Z"/><path d="M16.5 10.5V21"/>');
        }
        if (/地铁|公交|打车|滴滴|出行|机票|火车|高铁|加油|停车|车/.test(d)) {
            return wrap('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 17l-2 4M15 17l2 4"/><path d="M8.5 13.5h.01M15.5 13.5h.01"/>');
        }
        if (/房租|水电|缴费|物业|话费|宽带|账单|电费|水费/.test(d)) {
            return wrap('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>');
        }
        if (/电影|游戏|娱乐|KTV|演出|门票|会员/.test(d)) {
            return wrap('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>');
        }
        if (/医院|药|诊所|体检|挂号/.test(d)) {
            return wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>');
        }
        if (/宠物|猫|狗|粮/.test(d)) {
            return wrap('<circle cx="7" cy="8" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="17" cy="8" r="1.6"/><path d="M7 15c0-3 2.2-5 5-5s5 2 5 5c0 2-1.5 3-3 3-1 0-1.5-.5-2-.5s-1 .5-2 .5c-1.5 0-3-1-3-3Z"/>');
        }
        if (isIncome) {
            return wrap('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');
        }
        return wrap('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>');
    }

    function renderFlow(txs) {
        if (!txs || !txs.length) {
            fcFlow.innerHTML = '<div class="fc-flow-empty">暂无流水</div>';
            return;
        }
        txs = txs.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
        fcFlow.innerHTML = txs.slice(0, 100).map(function (t) {
            var expense = t.type === 'expense';
            return '<div class="fc-flow-item">' +
                '<div class="fc-flow-icon">' + flowIcon(t.desc, !expense) + '</div>' +
                '<div class="fc-flow-main"><div class="fc-flow-desc">' + esc(t.desc || (expense ? '支出' : '收入')) + '</div>' +
                '<div class="fc-flow-time">' + esc(formatTime(t.time)) + '</div></div>' +
                '<div class="fc-flow-amount ' + (expense ? 'expense' : 'income') + '">' + (expense ? '-' : '+') + money(t.amount) + '</div>' +
                '</div>';
        }).join('');
    }

    var currentTab = 'mine';
    function refresh() {
        var all = S ? S.read(chatId) : [];
        var mine = currentTab === 'mine';
        var monthKey = new Date().toISOString().slice(0, 7);
        all.forEach(function (c) {
            if (c && c.status === 'active' && c.monthKey !== monthKey) {
                c.monthKey = monthKey;
                c.monthlySpent = 0;
                if (S) S.update(chatId, c.id, { monthKey: monthKey, monthlySpent: 0 });
            }
        });
        // 我的 = 我出资的卡；他的 = 对方出资的卡
        var cards = all.filter(function (c) { return (c.issuer === 'user') === mine; });
        var total = 0, used = 0;
        cards.forEach(function (c) {
            if (c.status === 'active') {
                total += Number(c.limit || 0);
                used += Number(c.monthlySpent != null ? c.monthlySpent : (c.spent || 0));
            }
        });
        fcTotal.textContent = moneyCompact(total);
        fcUsed.textContent = moneyCompact(used);
        renderCards(cards);
        var inv = $('inviteBtn');
        if (inv) inv.style.display = mine ? '' : 'none';
        if (!S) { fcBalance.textContent = moneyCompact(0); renderFlow([]); return; }
        if (mine) {
            S.readWallet().then(function (wd) {
                fcBalance.textContent = moneyCompact(wd.balance);
                var txs = wd.transactions || [];
                if (focusCardId) {
                    var hit = txs.filter(function (t) { return t && (String(t.familyCardId || '') === String(focusCardId) || String(t.familyId || '') === String(focusCardId)); });
                    if (hit.length) txs = hit;
                }
                renderFlow(txs);
            });
        } else {
            var w = S.readCharWallet(chatId);
            fcBalance.textContent = moneyCompact(w.balance);
            renderFlow(w.transactions || []);
        }
    }

    // ===== 刷新对方银行卡 =====
    function switchToOther() {
        if (currentTab === 'other') return;
        currentTab = 'other';
        var tabs = $('fcTabs');
        if (tabs) Array.prototype.forEach.call(tabs.querySelectorAll('.fc-tab'), function (x) {
            x.classList.toggle('active', x.getAttribute('data-tab') === 'other');
        });
    }

    function readApiConfig() {
        var local = null;
        try { local = JSON.parse(localStorage.getItem('nano_api_config') || 'null'); } catch (e) {}
        return new Promise(function (resolve) {
            if (!window.indexedDB) { resolve(local); return; }
            var done = false;
            function finish(v) { if (done) return; done = true; resolve(v || local); }
            try {
                var req = indexedDB.open('nano_api_db');
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
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

    function isBlocked(s) {
        return /内容被拦截|FAILED_PRECONDITION|content[\s_-]*(block|policy|filter)|safety/i.test(String(s || ''));
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
            if (inStr) {
                if (esc) esc = false;
                else if (ch === '\\') esc = true;
                else if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') inStr = true;
            else if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; }
                }
            }
        }
        return null;
    }

    async function callMainApi(system, user, maxTokens) {
        var cfg = await readApiConfig();
        if (!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) throw new Error('主 API 未配置完整');
        var url = apiEndpoint(cfg.mainUrl);
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 60000) : null;
        var resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.mainKey },
                body: JSON.stringify({
                    model: cfg.mainModel,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                    temperature: (typeof cfg.mainTemp === 'number' ? cfg.mainTemp : 0.9),
                    max_tokens: maxTokens || 4096,
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

    function normalizeTransactions(raw, limit) {
        var out = [];
        (Array.isArray(raw) ? raw : []).slice(0, limit || 12).forEach(function (t) {
            if (!t || typeof t !== 'object') return;
            var type = (t.type === 'income' || t.income === true) ? 'income' : 'expense';
            var amount = Math.round((parseFloat(t.amount) || 0) * 100) / 100;
            if (!(amount > 0)) return;
            var desc = String(t.desc || t.description || t.name || '').trim() || (type === 'income' ? '收入' : '支出');
            var time = t.time || t.date || new Date().toISOString();
            var d = new Date(time);
            if (isNaN(d.getTime())) time = new Date().toISOString();
            out.push({
                id: 'ctx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                type: type,
                amount: amount,
                desc: desc,
                time: time
            });
        });
        out.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
        return out;
    }

    function applyTransactions(txs) {
        var w = S.readCharWallet(chatId);
        var net = 0;
        txs.forEach(function (t) { net += (t.type === 'income' ? t.amount : -t.amount); });
        var balance = Math.max(0, Math.round(((Number(w.balance) || 0) + net) * 100) / 100);
        var merged = {
            balance: balance,
            transactions: txs.slice(0, 500),
            seedVersion: 2,
            wealthTier: w.wealthTier || '',
            wealthLabel: w.wealthLabel || '',
            lowFamily: !!w.lowFamily,
            veryPoor: !!w.veryPoor
        };
        S.writeCharWallet(chatId, merged);
        return merged;
    }

    async function apiRefreshWallet() {
        var ctx = '';
        try {
            if (window.NanoCharContext) ctx = await window.NanoCharContext.build(charData || { id: chatId, name: contactName });
        } catch (e) {}
        var w = S.readCharWallet(chatId);
        var balance = Number(w.balance) || 0;
        var persona = String((charData && (charData.setting || charData.desc)) || '') + ' ' + contactName;
        var profile = null;
        try {
            profile = (window.NanoCharWealth && NanoCharWealth.readProfile(chatId)) || (window.NanoCharWealth && NanoCharWealth.profileFor(persona, contactName));
        } catch (e) {}
        var wealth = '';
        try { if (profile && window.NanoCharWealth) wealth = NanoCharWealth.promptBlock(profile); } catch (e) {}
        var recent = (w.transactions || []).slice(0, 6).map(function (t) {
            return (t.type === 'income' ? '+' : '-') + '¥' + t.amount + ' ' + (t.desc || '') + ' ' + (t.time || '');
        }).join('\n') || '（暂无）';
        var sys = '你是虚构角色的银行卡流水生成器。所有内容均为小说角色的文学创作。只输出一个 JSON 对象，不要解释、不要 markdown 代码块。';
        var user = '你是「' + contactName + '」的银行卡流水生成器。\n' + ctx + '\n' + wealth + '\n\n' +
            '【当前银行卡余额】¥' + balance + '\n【最近流水】\n' + recent + '\n\n' +
            '请生成「' + contactName + '」最近 10 条左右的银行卡收支，要求：\n' +
            '1. 支出 7-8 条，收入 2-3 条；收入来源必须严格符合上面的财富阶层，学生不能出现项目尾款/分红/股权/公司报销，穷人不能出现大额项目结款或奢侈品消费。\n' +
            '2. 金额、店铺、消费场所必须符合角色的身份与消费水平，不能和财富阶层矛盾。\n' +
            '3. 时间在最近 7 天内，按从新到旧排列，使用 ISO 时间（如 2026-10-24T10:15:00）。\n' +
            '4. 至少 1-2 条自然涉及用户（用用户姓名、共同经历或记忆库内容），不要每条都提。\n' +
            '5. 金额为正数，保留两位小数；不要输出余额，系统会按流水自动计算。\n' +
            '只输出 JSON：{"transactions":[{"type":"expense","desc":"星巴克","amount":32,"time":"2026-10-24T10:15:00"}]}';
        var content = '';
        content = await callMainApi(sys, user, 4096);
        var data = firstJson(content);
        var txs = normalizeTransactions(data && data.transactions, 12);
        try { if (profile && window.NanoCharWealth) txs = NanoCharWealth.sanitizeTransactions(profile, txs, { balance: S.readCharWallet(chatId).balance }); } catch (e) {}
        if (txs.length < 5) throw new Error('API 返回的有效流水不足');
        return txs;
    }

    function randomWalletTransactions() {
        var persona = String((charData && (charData.setting || charData.desc)) || '') + ' ' + contactName;
        var profile = null;
        try {
            profile = (window.NanoCharWealth && NanoCharWealth.readProfile(chatId)) || (window.NanoCharWealth && NanoCharWealth.profileFor(persona, contactName));
        } catch (e) {}
        if (window.NanoCharWealth && profile) {
            var wallet = S.readCharWallet(chatId);
            return NanoCharWealth.randomWalletTransactions(profile, 10, contactName, { balance: wallet.balance });
        }
        return [
            { id: 'ctx_' + Date.now() + '_1', type: 'income', amount: 1200, desc: '兼职收入', time: new Date().toISOString() },
            { id: 'ctx_' + Date.now() + '_2', type: 'expense', amount: 25, desc: '食堂', time: new Date().toISOString() }
        ];
    }

    function setRefreshBusy(busy) {
        if (refreshApiBtn) refreshApiBtn.disabled = !!busy;
        if (refreshRandomBtn) refreshRandomBtn.disabled = !!busy;
    }
    function openRefreshModal() {
        if (!refreshModal) return;
        refreshRun++;
        if (refreshStatus) {
            refreshStatus.className = 'fc-refresh-status';
            refreshStatus.textContent = '';
        }
        setRefreshBusy(false);
        refreshModal.classList.add('active');
    }
    function finishRefresh(txs, how) {
        applyTransactions(txs);
        switchToOther();
        refresh();
        if (refreshModal) refreshModal.classList.remove('active');
        toast('已刷新 ' + txs.length + ' 条流水（' + how + '）');
    }

    // ===== 操作 =====
    function invite(limit) {
        if (!S) return false;
        var lim = Math.max(0, Math.round((parseFloat(limit) || 0) * 100) / 100);
        if (lim > 1e9) lim = 1e9;
        if (lim <= 0) { toast('请输入正确的额度'); return false; }
        var card = inviteCards.filter(function (c) { return String(c.id) === String(_fundingCardId); })[0];
        if (!card) { toast('请先选择一张开卡银行卡'); return false; }
        if (lim > Number(card.balance || 0)) { toast('额度不能超过这张银行卡的余额 ' + money(card.balance)); return false; }
        var bank = (window.NanoBank && NanoBank.get(card.bankId)) || { id: 'gray', name: '储蓄卡' };
        var bankName = card.bankName || bank.name;
        var created = S.add(chatId, {
            issuer: 'user', holder: 'char', limit: lim, spent: 0, monthlySpent: 0,
            monthKey: new Date().toISOString().slice(0, 7), status: 'pending', note: '',
            bankId: card.bankId, bankName: bankName, fundingCardId: card.id,
            cardLast4: last4(card)
        });
        postToParent({
            type: 'NANO_FAMILY_CARD_SUBMIT', chatId: chatId, name: contactName, limit: lim,
            bankId: card.bankId, bankName: bankName, fundingCardId: card.id, cardLast4: last4(card),
            familyId: created.id
        });
        toast('邀请已发出，等待对方回应');
        refresh();
        return true;
    }

    function accept(id) {
        if (!S) return;
        S.update(chatId, id, { status: 'active' });
        postToParent({ type: 'NANO_FAMILY_CARD_RESULT', chatId: chatId, familyId: id, status: 'active' });
        toast('已接受亲属卡');
        refresh();
    }
    function reject(id) {
        if (!S) return;
        S.update(chatId, id, { status: 'rejected' });
        postToParent({ type: 'NANO_FAMILY_CARD_RESULT', chatId: chatId, familyId: id, status: 'rejected' });
        toast('已拒绝');
        refresh();
    }
    function removeCard(id) {
        if (!S) return;
        if (!window.confirm('确定要删除/撤销这张亲属卡吗？')) return;
        S.remove(chatId, id);
        toast('已删除');
        refresh();
    }
    function spend(id) {
        if (!S) return;
        var c = S.find(chatId, id);
        if (!c) return;
        var used = Number(c.monthlySpent != null ? c.monthlySpent : (c.spent || 0));
        var remain = Math.max(0, Number(c.limit || 0) - used);
        if (remain <= 0) { toast('本月额度已用完'); return; }
        var input = window.prompt('输入消费金额（本月剩余 ' + money(remain) + '）', '');
        if (input == null) return;
        var amt = Math.round((parseFloat(input) || 0) * 100) / 100;
        if (amt <= 0) { toast('金额无效'); return; }
        if (amt > remain) { toast('超出本月剩余额度'); return; }
        var mine = c.issuer === 'user';
        var pay = mine
            ? S.spend('亲属卡消费 · ' + contactName, amt, c.fundingCardId, { familyId: id, familyCardId: id, charName: contactName })
            : S.charSpend(chatId, '亲属卡消费 · 你支付', amt);
        (pay || Promise.resolve()).then(function () {
            var latest = S.find(chatId, id);
            var monthKey = new Date().toISOString().slice(0, 7);
            var base = latest && latest.monthKey === monthKey ? Number(latest.monthlySpent || 0) : 0;
            var baseAll = Number((latest && latest.spent) || 0);
            S.update(chatId, id, { spent: baseAll + amt, monthlySpent: base + amt, monthKey: monthKey });
            if (!mine) {
                postToParent({ type: 'NANO_FAMILY_SPEND_NOTICE', chatId: chatId, amount: amt, cardId: id, issuer: 'char' });
            }
            var after = S.find(chatId, id);
            if (after && Number(after.monthlySpent || 0) >= Number(after.limit || 0)) {
                postToParent({
                    type: 'NANO_FAMILY_LIMIT_REACHED', chatId: chatId, cardId: id,
                    limit: Number(after.limit || 0), spent: Number(after.monthlySpent || 0)
                });
            }
            toast('消费成功');
            refresh();
        }).catch(function (e) {
            toast((e && e.message) || '消费失败');
        });
    }

    // ===== 事件 =====
    fcList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        if (act === 'accept') accept(id);
        else if (act === 'reject') reject(id);
        else if (act === 'remove') removeCard(id);
        else if (act === 'spend') spend(id);
        else if (act === 'adjust') {
            var c = S.find(chatId, id);
            if (!c) return;
            editingId = id;
            limitInput.value = c.limit || '';
            $('limitDesc').textContent = '本月已用 ' + money(c.monthlySpent != null ? c.monthlySpent : (c.spent || 0)) + '，调整后立即生效。';
            limitModal.classList.add('active');
            setTimeout(function () { limitInput.focus(); }, 100);
        }
    });

    $('inviteBtn').addEventListener('click', function () {
        inviteLimit.value = '';
        inviteModal.classList.add('active');
        loadInviteBanks().then(function () {
            var card = inviteCards.filter(function (c) { return String(c.id) === String(_fundingCardId); })[0];
            inviteLimit.placeholder = card ? ('额度，最高 ' + money(card.balance)) : '额度，例如 2000';
            setTimeout(function () { inviteLimit.focus(); }, 100);
        });
    });
    $('inviteCancel').addEventListener('click', function () { inviteModal.classList.remove('active'); });
    $('inviteConfirm').addEventListener('click', function () {
        if (invite(inviteLimit.value)) inviteModal.classList.remove('active');
    });
    inviteModal.addEventListener('click', function (e) { if (e.target === inviteModal) inviteModal.classList.remove('active'); });

    $('limitCancel').addEventListener('click', function () { limitModal.classList.remove('active'); });
    $('limitConfirm').addEventListener('click', function () {
        if (!S || !editingId) { limitModal.classList.remove('active'); return; }
        var lim = Math.max(0, Math.round((parseFloat(limitInput.value) || 0) * 100) / 100);
        if (lim > 1e9) lim = 1e9;
        if (lim <= 0) { toast('请输入正确的额度'); return; }
        var card = S.find(chatId, editingId);
        if (card && card.issuer === 'user' && card.fundingCardId) {
            var hit = inviteCards.filter(function (c) { return String(c.id) === String(card.fundingCardId); })[0];
            if (!hit) {
                S.readWallet().then(function (wd) {
                    var c2 = S.getCard(wd, card.fundingCardId);
                    if (c2 && lim > Number(c2.balance || 0)) { toast('额度不能超过这张银行卡的余额 ' + money(c2.balance)); return; }
                    S.update(chatId, editingId, { limit: lim });
                    limitModal.classList.remove('active');
                    toast('额度已更新');
                    refresh();
                });
                return;
            }
            if (lim > Number(hit.balance || 0)) { toast('额度不能超过这张银行卡的余额 ' + money(hit.balance)); return; }
        }
        S.update(chatId, editingId, { limit: lim });
        limitModal.classList.remove('active');
        toast('额度已更新');
        refresh();
    });
    limitModal.addEventListener('click', function (e) { if (e.target === limitModal) limitModal.classList.remove('active'); });

    var refreshBtn = $('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
        if (!S) return;
        openRefreshModal();
    });
    if (refreshCancel) refreshCancel.addEventListener('click', function () {
        refreshRun++;
        refreshModal.classList.remove('active');
    });
    if (refreshModal) refreshModal.addEventListener('click', function (e) {
        if (e.target === refreshModal && !refreshApiBtn.disabled) {
            refreshRun++;
            refreshModal.classList.remove('active');
        }
    });
    if (refreshApiBtn) refreshApiBtn.addEventListener('click', async function () {
        if (refreshApiBtn.disabled) return;
        var run = ++refreshRun;
        setRefreshBusy(true);
        if (refreshStatus) {
            refreshStatus.className = 'fc-refresh-status';
            refreshStatus.innerHTML = '<span class="fc-spin"></span>正在按人设生成流水…';
        }
        try {
            var txs = await apiRefreshWallet();
            if (run !== refreshRun) return;
            finishRefresh(txs, '智能刷新');
        } catch (e) {
            if (run !== refreshRun) return;
            setRefreshBusy(false);
            if (refreshStatus) {
                refreshStatus.className = 'fc-refresh-status err';
                refreshStatus.textContent = '刷新失败：' + ((e && e.message) || e);
            }
        }
    });
    if (refreshRandomBtn) refreshRandomBtn.addEventListener('click', function () {
        if (refreshRandomBtn.disabled) return;
        var txs = randomWalletTransactions();
        finishRefresh(txs, '随机刷新');
    });

    var fcTabs = $('fcTabs');
    if (fcTabs) {
        fcTabs.addEventListener('click', function (e) {
            var b = e.target.closest('.fc-tab');
            if (!b) return;
            var t = b.getAttribute('data-tab');
            if (t === currentTab) return;
            currentTab = t;
            Array.prototype.forEach.call(fcTabs.querySelectorAll('.fc-tab'), function (x) {
                x.classList.toggle('active', x === b);
            });
            refresh();
        });
    }

    $('backBtn').addEventListener('click', function () {
        if (window.parent && window.parent !== window) {
            postToParent({ type: 'nanoCloseOverlay' });
        } else {
            history.back();
        }
    });

    loadPersona(function (ch) {
        charData = ch || null;
        var persona = contactName;
        if (ch) {
            try { persona = JSON.stringify(ch).slice(0, 6000); } catch (e) { persona = contactName; }
        }
        var done = function () {
            if (S) S.seedCharWallet(chatId, persona, contactName || (ch && ch.name) || '');
            refresh();
        };
        if (S && S.hydrate) S.hydrate(chatId).then(done, done);
        else done();
    });
})();
