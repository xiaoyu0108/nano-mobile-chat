// ============================================================
// phone-wallet.js — 查手机 · 角色钱包
// 数据与亲属卡「他的」共用：localStorage[nano_char_wallet_<chatId>]
// ============================================================
(function () {
    'use strict';

    function q(name) {
        try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
    }
    var chatId = q('chat') || 'default';
    var charName = q('name') || '对方';
    var key = 'nano_char_wallet_' + chatId;

    var $ = function (id) { return document.getElementById(id); };
    var balanceEl = $('balance');
    var incomeEl = $('income');
    var expenseEl = $('expense');
    var cardNameEl = $('cardName');
    var cardNumberEl = $('cardNumber');
    var txList = $('txList');
    var txCount = $('txCount');
    var refreshBtn = $('refreshBtn');
    var backBtn = $('backBtn');
    var toastEl = $('toast');

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }
    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function money(n) {
        var v = round2(n);
        return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function hashDigits(seed, len) {
        var h = 2166136261 >>> 0, s = String(seed || '');
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        var out = '';
        while (out.length < len) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; out += String(h % 10); }
        return out.slice(0, len);
    }
    function formatTime(t) {
        var d = new Date(t);
        if (isNaN(d.getTime())) return '';
        var now = new Date();
        var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        var yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        var isYest = d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate();
        if (sameDay) return '今天 ' + hm;
        if (isYest) return '昨天 ' + hm;
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
    }

    function iconFor(desc, income) {
        var d = String(desc || '');
        var wrap = function (inner) {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
        };
        if (/亲属卡/.test(d)) return wrap('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M12 13v5M9.5 15.5 12 13l2.5 2.5"/>');
        if (/工资|收入|转入|退款|红包|返现|入账|奖金|稿费|结款|报销/.test(d) || income) {
            return wrap('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');
        }
        if (/超市|便利店|商场|购物|商城|淘宝|京东|拼多多|买|礼物/.test(d)) {
            return wrap('<path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>');
        }
        if (/咖啡|奶茶|茶|饮|星巴克|瑞幸/.test(d)) {
            return wrap('<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2"/><path d="M7 3v2M10 3v2M13 3v2"/>');
        }
        if (/外卖|餐|饭|火锅|烧烤|麻辣烫|甜品|蛋糕|面|粉|食/.test(d)) {
            return wrap('<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3"/><path d="M17 3c-2 3-2 6 0 8v10"/>');
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
        return wrap('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>');
    }

    function readWallet() {
        try {
            var w = JSON.parse(localStorage.getItem(key) || 'null');
            if (!w || typeof w !== 'object') return null;
            if (typeof w.balance !== 'number') w.balance = 0;
            if (!Array.isArray(w.transactions)) w.transactions = [];
            return w;
        } catch (e) { return null; }
    }
    function writeWallet(w) {
        try { localStorage.setItem(key, JSON.stringify(w)); } catch (e) {}
    }
    function ensureWallet(fallback) {
        var w = readWallet();
        if (w) return w;
        if (fallback && typeof fallback.balance === 'number') {
            w = { balance: round2(fallback.balance), transactions: Array.isArray(fallback.transactions) ? fallback.transactions : [] };
        } else {
            w = { balance: 20000, transactions: [] };
        }
        writeWallet(w);
        return w;
    }

    function toast(text) {
        if (!toastEl) return;
        toastEl.textContent = text || '';
        toastEl.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
    }

    function render(w) {
        var balance = Number(w.balance) || 0;
        var txs = Array.isArray(w.transactions) ? w.transactions.slice() : [];
        txs.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
        var income = 0, expense = 0;
        txs.forEach(function (t) {
            var amt = Math.abs(Number(t.amount) || 0);
            if (t.type === 'income') income += amt; else expense += amt;
        });
        if (balanceEl) balanceEl.textContent = '¥' + money(balance);
        if (incomeEl) incomeEl.textContent = '+¥' + money(income);
        if (expenseEl) expenseEl.textContent = '-¥' + money(expense);
        if (cardNameEl) cardNameEl.textContent = charName;
        if (cardNumberEl) cardNumberEl.textContent = '**** **** **** ' + hashDigits(chatId, 4);
        if (txCount) txCount.textContent = txs.length + ' 笔';
        if (!txList) return;
        if (!txs.length) {
            txList.innerHTML = '<div class="w-empty">还没有流水，点右上角刷新</div>';
            return;
        }
        txList.innerHTML = txs.slice(0, 120).map(function (t) {
            var isIncome = t.type === 'income';
            var amount = Math.abs(Number(t.amount) || 0);
            return '<div class="w-item">' +
                '<div class="w-item-icon">' + iconFor(t.desc, isIncome) + '</div>' +
                '<div class="w-item-main"><div class="w-item-desc">' + esc(t.desc || (isIncome ? '收入' : '支出')) + '</div>' +
                '<div class="w-item-time">' + esc(formatTime(t.time)) + '</div></div>' +
                '<div class="w-item-amount ' + (isIncome ? 'income' : 'expense') + '">' + (isIncome ? '+' : '-') + '¥' + money(amount) + '</div>' +
                '</div>';
        }).join('');
    }

    window.renderCharWallet = function (data) {
        var w = ensureWallet(data);
        render(w);
    };

    if (backBtn) backBtn.addEventListener('click', function () {
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'phoneAppClose' }, '*');
                return;
            }
        } catch (e) {}
        if (history.length > 1) history.back();
    });

    if (refreshBtn) refreshBtn.addEventListener('click', function () {
        if (refreshBtn.classList.contains('spin')) return;
        var ran = false;
        try {
            if (typeof window.__phoneRefresh === 'function') {
                window.__phoneRefresh();
                ran = true;
            } else if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'phoneAppRefresh' }, '*');
                ran = true;
            }
        } catch (e) {}
        if (!ran) { toast('请在查手机中打开钱包后刷新'); return; }
        refreshBtn.classList.add('spin');
        setTimeout(function () { refreshBtn.classList.remove('spin'); }, 30000);
    });

    // 亲属卡页面 / 其它页面修改了同一份钱包时，自动同步
    window.addEventListener('storage', function (e) {
        if (e && e.key === key) {
            var w = readWallet();
            if (w) render(w);
        }
    });

    // 由手机宿主在 iframe 加载后调用；先读取本地，没有再用宿主数据
    window.renderCharWallet(null);
})();
