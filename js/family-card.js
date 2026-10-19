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
    var editingId = null;

    // 开卡银行选择（决定亲属卡颜色）
    var inviteBanks = $('inviteBanks');
    var _bankId = (window.NanoBank && NanoBank.DEFAULT) || 'gray';
    (function renderBankPicker() {
        if (!inviteBanks || !window.NanoBank) return;
        inviteBanks.innerHTML = NanoBank.list.map(function (b) {
            return '<button type="button" class="fc-bank' + (b.id === _bankId ? ' sel' : '') + '" data-bank="' + b.id + '">' +
                '<span class="sw" style="background:' + b.bg + '"></span><span class="nm">' + b.name + '</span></button>';
        }).join('');
        Array.prototype.forEach.call(inviteBanks.querySelectorAll('.fc-bank'), function (btn) {
            btn.addEventListener('click', function () {
                _bankId = btn.getAttribute('data-bank');
                Array.prototype.forEach.call(inviteBanks.querySelectorAll('.fc-bank'), function (b) { b.classList.toggle('sel', b === btn); });
            });
        });
    })();

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
            var used = Number(c.spent || 0);
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

    function renderFlow(txs) {
        if (!txs || !txs.length) {
            fcFlow.innerHTML = '<div class="fc-flow-empty">暂无流水</div>';
            return;
        }
        var icon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v3H2V6a1 1 0 0 1 1-1zM2 11h20v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7zm3 3v2h6v-2H5z"/></svg>';
        fcFlow.innerHTML = txs.slice(0, 100).map(function (t) {
            var expense = t.type === 'expense';
            return '<div class="fc-flow-item">' +
                '<div class="fc-flow-icon">' + icon + '</div>' +
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
        // 我的 = 我出资的卡；他的 = 对方出资的卡
        var cards = all.filter(function (c) { return (c.issuer === 'user') === mine; });
        var total = 0, used = 0;
        cards.forEach(function (c) {
            if (c.status === 'active') { total += Number(c.limit || 0); used += Number(c.spent || 0); }
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
                renderFlow(wd.transactions || []);
            });
        } else {
            var w = S.readCharWallet(chatId);
            fcBalance.textContent = moneyCompact(w.balance);
            renderFlow(w.transactions || []);
        }
    }

    // ===== 操作 =====
    function invite(limit) {
        if (!S) return;
        var lim = Math.max(0, Math.round((parseFloat(limit) || 0) * 100) / 100);
        if (lim > 1e9) lim = 1e9; // 上限十亿（以亿为单位）
        if (lim <= 0) { toast('请输入正确的额度'); return; }
        var bank = (window.NanoBank && NanoBank.get(_bankId)) || { id: 'gray', name: '储蓄卡' };
        S.add(chatId, { issuer: 'user', holder: 'char', limit: lim, spent: 0, status: 'pending', note: '', bankId: bank.id, bankName: bank.name });
        postToParent({ type: 'NANO_FAMILY_CARD_SUBMIT', chatId: chatId, name: contactName, limit: lim, bankId: bank.id, bankName: bank.name });
        toast('邀请已发出，等待对方回应');
        refresh();
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
        var remain = Math.max(0, Number(c.limit || 0) - Number(c.spent || 0));
        if (remain <= 0) { toast('额度已用完'); return; }
        var input = window.prompt('输入消费金额（剩余 ' + money(remain) + '）', '');
        if (input == null) return;
        var amt = Math.round((parseFloat(input) || 0) * 100) / 100;
        if (amt <= 0) { toast('金额无效'); return; }
        if (amt > remain) { toast('超出剩余额度'); return; }
        var mine = c.issuer === 'user';
        // 出资方决定扣谁的钱：我出资 → 扣我的银行卡；对方出资 → 扣对方的银行卡，并让对方知道
        var pay = mine
            ? S.spend('亲属卡消费 · ' + contactName, amt)
            : S.charSpend(chatId, '亲属卡消费 · 你支付', amt);
        (pay || Promise.resolve()).then(function () {
            var latest = S.find(chatId, id);
            S.update(chatId, id, { spent: Number((latest && latest.spent) || 0) + amt });
            if (!mine) {
                // 花的是对方的钱：通知对方（偶尔提及即可，由角色自行决定）
                postToParent({ type: 'NANO_FAMILY_SPEND_NOTICE', chatId: chatId, amount: amt, cardId: id, issuer: 'char' });
            }
            toast('消费成功');
            refresh();
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
            $('limitDesc').textContent = '当前已用 ' + money(c.spent || 0) + '，调整后立即生效。';
            limitModal.classList.add('active');
            setTimeout(function () { limitInput.focus(); }, 100);
        }
    });

    $('inviteBtn').addEventListener('click', function () {
        inviteLimit.value = '';
        inviteModal.classList.add('active');
        setTimeout(function () { inviteLimit.focus(); }, 100);
    });
    $('inviteCancel').addEventListener('click', function () { inviteModal.classList.remove('active'); });
    $('inviteConfirm').addEventListener('click', function () {
        invite(inviteLimit.value);
        inviteModal.classList.remove('active');
    });
    inviteModal.addEventListener('click', function (e) { if (e.target === inviteModal) inviteModal.classList.remove('active'); });

    $('limitCancel').addEventListener('click', function () { limitModal.classList.remove('active'); });
    $('limitConfirm').addEventListener('click', function () {
        if (!S || !editingId) { limitModal.classList.remove('active'); return; }
        var lim = Math.max(0, Math.round((parseFloat(limitInput.value) || 0) * 100) / 100);
        if (lim > 1e9) lim = 1e9; // 上限十亿（以亿为单位）
        if (lim <= 0) { toast('请输入正确的额度'); return; }
        S.update(chatId, editingId, { limit: lim });
        limitModal.classList.remove('active');
        toast('额度已更新');
        refresh();
    });
    limitModal.addEventListener('click', function (e) { if (e.target === limitModal) limitModal.classList.remove('active'); });

    var refreshBtn = $('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
        if (!S) return;
        S.bumpCharWallet(chatId);
        if (currentTab !== 'other') {
            currentTab = 'other';
            var tabs2 = $('fcTabs');
            if (tabs2) Array.prototype.forEach.call(tabs2.querySelectorAll('.fc-tab'), function (x) {
                x.classList.toggle('active', x.getAttribute('data-tab') === 'other');
            });
        }
        toast('已刷新对方银行卡流水');
        refresh();
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
        var persona = contactName;
        if (ch) {
            try { persona = JSON.stringify(ch).slice(0, 6000); } catch (e) { persona = contactName; }
        }
        if (S) S.seedCharWallet(chatId, persona);
        refresh();
    });
})();
