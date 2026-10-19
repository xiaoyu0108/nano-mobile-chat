// ============================================================
// wallet.js — 银行卡（与 chat-inner 互通）+ 记账（独立）
// 数据存储：IndexedDB（nano_wallet_db）
// ============================================================
(function() {
    'use strict';

    // ===== 常量 =====
    var DB_NAME = 'nano_wallet_db';
    var DB_VERSION = 1;
    var WALLET_STORE = 'wallet_data';
    var LEDGER_STORE = 'ledger_data';

    // ===== DOM 引用 =====
    var balanceEl = document.getElementById('balanceAmount');
    var cardNumberEl = document.getElementById('cardNumber');
    var bankNameEl = document.getElementById('bankName');
    var walletTxList = document.getElementById('walletTxList');
    var walletTxCount = document.getElementById('walletTxCount');

    var entryListEl = document.getElementById('entryList');
    var entryCountEl = document.getElementById('entryCount');
    var totalIncomeEl = document.getElementById('totalIncome');
    var totalExpenseEl = document.getElementById('totalExpense');
    var totalBalanceEl = document.getElementById('totalBalance');

    var toastEl = document.getElementById('toast');
    var navTitle = document.getElementById('navTitle');

    // ===== 弹窗元素 =====
    var entryModal = document.getElementById('entryModal');
    var entryType = document.getElementById('entryType');
    var entryAmount = document.getElementById('entryAmount');
    var entryDesc = document.getElementById('entryDesc');
    var entryCancel = document.getElementById('entryCancel');
    var entryConfirm = document.getElementById('entryConfirm');

    var editModal = document.getElementById('editModal');
    var editType = document.getElementById('editType');
    var editAmount = document.getElementById('editAmount');
    var editDesc = document.getElementById('editDesc');
    var editCancel = document.getElementById('editCancel');
    var editConfirm = document.getElementById('editConfirm');

    var rechargeModal = document.getElementById('rechargeModal');
    var rechargeAmount = document.getElementById('rechargeAmount');
    var rechargeCancel = document.getElementById('rechargeCancel');
    var rechargeConfirm = document.getElementById('rechargeConfirm');

    // ===== 按钮 =====
    var backBtn = document.getElementById('backBtn');
    var addBtn = document.getElementById('addBtn');
    var rechargeBtn = document.getElementById('rechargeBtn');
    var tabBtns = document.querySelectorAll('.tab-btn');
    var pageWallet = document.getElementById('pageWallet');
    var pageLedger = document.getElementById('pageLedger');

    // ===== 状态 =====
    var editingId = null;
    var currentTab = 'wallet';
    var _walletCache = null;
    var _ledgerCache = null;

    // ============================================================
    // IndexedDB 操作
    // ============================================================
    function openDB() {
        return new Promise(function(resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = function(e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(WALLET_STORE)) {
                        db.createObjectStore(WALLET_STORE, { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains(LEDGER_STORE)) {
                        db.createObjectStore(LEDGER_STORE, { keyPath: 'key' });
                    }
                };
                req.onsuccess = function(e) { resolve(e.target.result); };
                req.onerror = function(e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function idbGet(storeName, key) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                try {
                    var tx = db.transaction(storeName, 'readonly');
                    var store = tx.objectStore(storeName);
                    var req = store.get(key);
                    req.onsuccess = function() { resolve(req.result ? req.result.value : null); };
                    req.onerror = function() { reject(req.error); };
                    tx.oncomplete = function() { db.close(); };
                } catch (e) { reject(e); }
            });
        });
    }

    function idbPut(storeName, key, value) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                try {
                    var tx = db.transaction(storeName, 'readwrite');
                    var store = tx.objectStore(storeName);
                    var req = store.put({ key: key, value: value });
                    req.onsuccess = function() { resolve(); };
                    req.onerror = function() { reject(req.error); };
                    tx.oncomplete = function() { db.close(); };
                } catch (e) { reject(e); }
            });
        });
    }

    // ============================================================
    // 银行卡数据（与 chat-inner 互通）— 按当前用户（人设/马甲）隔离
    // ============================================================
    function nanoUid() {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
            if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
        } catch (e) {}
        return 'default';
    }
    var WALLET_KEY = 'wallet_data__' + nanoUid();
    var LEDGER_KEY = 'ledger_data__' + nanoUid();
    var LEGACY_WALLET_KEY = 'wallet_data';
    var LEGACY_LEDGER_KEY = 'ledger_data';
    var LEGACY_WALLET_OWNER = 'nano_wallet_legacy_owner';
    var LEGACY_LEDGER_OWNER = 'nano_ledger_legacy_owner';

    function getDefaultWallet() {
        return {
            balance: 5000,
            cardNumber: '',
            bankName: '',
            transactions: []
        };
    }

    function normalizeWallet(data) {
        data.balance = typeof data.balance === 'number' ? data.balance : 0;
        data.cardNumber = data.cardNumber || '';
        data.bankName = data.bankName || '';
        data.transactions = Array.isArray(data.transactions) ? data.transactions : [];
        return data;
    }

    function getWalletData() {
        return idbGet(WALLET_STORE, WALLET_KEY).then(function(data) {
            if (data) {
                data = normalizeWallet(data);
                _walletCache = data;
                return data;
            }
            var uid = nanoUid();
            var owner = '';
            try { owner = localStorage.getItem(LEGACY_WALLET_OWNER) || ''; } catch (e) {}
            // 旧版全局钱包只迁移给第一个打开的用户（其他人从新钱包开始）
            if (owner && owner !== uid) {
                var d0 = getDefaultWallet();
                return idbPut(WALLET_STORE, WALLET_KEY, d0).then(function () { _walletCache = d0; return d0; });
            }
            return idbGet(WALLET_STORE, LEGACY_WALLET_KEY).then(function(legacy) {
                var def = (legacy && typeof legacy === 'object') ? normalizeWallet(legacy) : getDefaultWallet();
                try { localStorage.setItem(LEGACY_WALLET_OWNER, uid); } catch (e) {}
                return idbPut(WALLET_STORE, WALLET_KEY, def).then(function () { _walletCache = def; return def; });
            });
        });
    }

    function saveWalletData(data) {
        _walletCache = data;
        return idbPut(WALLET_STORE, WALLET_KEY, data);
    }

    // ============================================================
    // 记账数据（独立）— 同样按用户隔离
    // ============================================================
    function getDefaultLedger() {
        return { entries: [] };
    }

    function getLedgerData() {
        return idbGet(LEDGER_STORE, LEDGER_KEY).then(function(data) {
            if (data) {
                data.entries = Array.isArray(data.entries) ? data.entries : [];
                _ledgerCache = data;
                return data;
            }
            var uid = nanoUid();
            var owner = '';
            try { owner = localStorage.getItem(LEGACY_LEDGER_OWNER) || ''; } catch (e) {}
            if (owner && owner !== uid) {
                var d0 = getDefaultLedger();
                return idbPut(LEDGER_STORE, LEDGER_KEY, d0).then(function () { _ledgerCache = d0; return d0; });
            }
            return idbGet(LEDGER_STORE, LEGACY_LEDGER_KEY).then(function(legacy) {
                var def = (legacy && typeof legacy === 'object') ? legacy : getDefaultLedger();
                def.entries = Array.isArray(def.entries) ? def.entries : [];
                try { localStorage.setItem(LEGACY_LEDGER_OWNER, uid); } catch (e) {}
                return idbPut(LEDGER_STORE, LEDGER_KEY, def).then(function () { _ledgerCache = def; return def; });
            });
        });
    }

    function saveLedgerData(data) {
        _ledgerCache = data;
        return idbPut(LEDGER_STORE, LEDGER_KEY, data);
    }

    // ============================================================
    // 工具函数
    // ============================================================
    function formatMoney(num) {
        return '¥' + Number(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatMoneyRaw(num) {
        return Number(num).toFixed(2);
    }

    function formatTime(iso) {
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            var h = String(d.getHours()).padStart(2, '0');
            var m = String(d.getMinutes()).padStart(2, '0');
            var month = String(d.getMonth() + 1).padStart(2, '0');
            var day = String(d.getDate()).padStart(2, '0');
            return month + '/' + day + ' ' + h + ':' + m;
        } catch (e) { return iso; }
    }

    function generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ============================================================
    // 左滑删除组件
    // ============================================================
    function setupSwipeDelete(container, onDelete) {
        var startX = 0;
        var isDragging = false;
        var targetWrap = null;
        var threshold = 40;

        container.addEventListener('touchstart', function(e) {
            var item = e.target.closest('.entry-item');
            if (!item) return;
            var wrap = item.closest('.entry-item-wrap');
            if (!wrap) return;
            if (wrap.classList.contains('swiped-out')) return;

            container.querySelectorAll('.entry-item-wrap.swiped').forEach(function(w) {
                if (w !== wrap) w.classList.remove('swiped');
            });

            targetWrap = wrap;
            var touch = e.touches[0];
            startX = touch.clientX;
            isDragging = true;
            wrap.style.transition = 'none';
        }, { passive: true });

        container.addEventListener('touchmove', function(e) {
            if (!isDragging || !targetWrap) return;
            var touch = e.touches[0];
            var deltaX = touch.clientX - startX;
            if (deltaX > 0) deltaX = 0;
            var item = targetWrap.querySelector('.entry-item');
            if (item) {
                var translate = Math.max(deltaX, -80);
                item.style.transform = 'translateX(' + translate + 'px)';
            }
        }, { passive: true });

        container.addEventListener('touchend', function(e) {
            if (!isDragging || !targetWrap) {
                isDragging = false;
                return;
            }
            isDragging = false;
            var item = targetWrap.querySelector('.entry-item');
            if (!item) { targetWrap = null; return; }

            var computedStyle = window.getComputedStyle(item);
            var matrix = computedStyle.transform;
            var translateX = 0;
            if (matrix && matrix !== 'none') {
                var values = matrix.match(/matrix.*\((.+)\)/);
                if (values) {
                    var nums = values[1].split(', ');
                    translateX = parseFloat(nums[4] || 0);
                }
            }

            targetWrap.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)';

            if (translateX < -threshold) {
                targetWrap.classList.add('swiped');
                item.style.transform = 'translateX(-80px)';
            } else {
                targetWrap.classList.remove('swiped');
                item.style.transform = 'translateX(0)';
            }
            targetWrap = null;
        }, { passive: true });

        container.addEventListener('click', function(e) {
            var deleteBtn = e.target.closest('.entry-delete-btn');
            if (deleteBtn) {
                var wrap = deleteBtn.closest('.entry-item-wrap');
                if (wrap) {
                    var id = wrap.dataset.id;
                    if (id && onDelete) {
                        wrap.classList.add('swiped-out');
                        setTimeout(function() {
                            onDelete(id);
                        }, 350);
                    }
                }
                return;
            }

            var item = e.target.closest('.entry-item');
            if (!item) return;
            var wrap = item.closest('.entry-item-wrap');
            if (!wrap) return;
            if (wrap.classList.contains('swiped')) {
                wrap.classList.remove('swiped');
                item.style.transform = 'translateX(0)';
                return;
            }
            var id = wrap.dataset.id;
            if (id && window._onEditEntry) {
                window._onEditEntry(id);
            }
        });
    }

    // ============================================================
    // 记账操作（独立）
    // ============================================================
    function addLedgerEntry(type, amount, desc) {
        return getLedgerData().then(function(data) {
            var entry = {
                id: generateId(),
                type: type,
                amount: Math.round(amount * 100) / 100,
                desc: desc || '',
                time: new Date().toISOString()
            };
            data.entries.unshift(entry);
            if (data.entries.length > 500) data.entries = data.entries.slice(0, 500);
            return saveLedgerData(data).then(function() {
                renderLedger();
                return entry;
            });
        });
    }

    function deleteLedgerEntry(id) {
        return getLedgerData().then(function(data) {
            data.entries = data.entries.filter(function(e) { return e.id !== id; });
            return saveLedgerData(data).then(function() {
                renderLedger();
                showToast('已删除');
            });
        });
    }

    function updateLedgerEntry(id, type, amount, desc) {
        return getLedgerData().then(function(data) {
            var entry = data.entries.find(function(e) { return e.id === id; });
            if (!entry) return;
            entry.type = type;
            entry.amount = Math.round(amount * 100) / 100;
            entry.desc = desc || '';
            return saveLedgerData(data).then(function() {
                renderLedger();
                showToast('已更新');
            });
        });
    }

    function getLedgerEntry(id) {
        return getLedgerData().then(function(data) {
            return data.entries.find(function(e) { return e.id === id; }) || null;
        });
    }

    function calcLedgerStats(entries) {
        var income = 0,
            expense = 0;
        entries.forEach(function(e) {
            if (e.type === 'income') income += e.amount;
            else expense += e.amount;
        });
        return { income: income, expense: expense, balance: income - expense };
    }

    // ============================================================
    // 银行卡操作（与 chat-inner 互通）
    // ============================================================
    function addWalletTransaction(type, amount, desc) {
        return getWalletData().then(function(data) {
            var tx = {
                id: generateId(),
                type: type,
                amount: Math.round(amount * 100) / 100,
                desc: desc || '',
                time: new Date().toISOString()
            };
            data.transactions = data.transactions || [];
            data.transactions.unshift(tx);
            if (data.transactions.length > 500) data.transactions = data.transactions.slice(0, 500);
            return saveWalletData(data).then(function() {
                renderWallet();
                return tx;
            });
        });
    }

    function updateWalletBalance(delta, desc) {
        return getWalletData().then(function(data) {
            data.balance = Math.round((data.balance + delta) * 100) / 100;
            var type = delta >= 0 ? 'income' : 'expense';
            var tx = {
                id: generateId(),
                type: type,
                amount: Math.abs(delta),
                desc: desc || (delta >= 0 ? '充值' : '支出'),
                time: new Date().toISOString()
            };
            data.transactions = data.transactions || [];
            data.transactions.unshift(tx);
            if (data.transactions.length > 500) data.transactions = data.transactions.slice(0, 500);
            return saveWalletData(data).then(function() {
                renderWallet();
            });
        });
    }

    function deleteWalletTransaction(id) {
        return getWalletData().then(function(data) {
            data.transactions = data.transactions.filter(function(t) { return t.id !== id; });
            return saveWalletData(data).then(function() {
                renderWallet();
                showToast('已删除');
            });
        });
    }

    // ============================================================
    // 渲染
    // ============================================================
    // ===== 银行卡堆叠（自己的卡 + 亲属卡；上下滑动切换，选中的展开，未选中的露一半）=====
    var bankStackEl = document.getElementById('bankStack');
    var _cards = [];
    var _activeCard = 0;

    function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
    function escHtmlSafe(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function money2(n) { return Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

    function loadFamilyCards() {
        var uid = nanoUid();
        var prefix = 'nano_family_cards__' + uid + '_';
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf(prefix) !== 0) continue;
                var chatId = k.slice(prefix.length);
                var arr = [];
                try { arr = JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { arr = []; }
                arr.forEach(function (c) { if (c) { var cc = Object.assign({}, c); cc._chatId = chatId; out.push(cc); } });
            }
        } catch (e) {}
        return out;
    }

    // 查角色昵称（亲属卡的绑定人）
    function getCharName(chatId) {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
                req.onsuccess = function (e) {
                    var db = e.target.result;
                    try {
                        var g = db.transaction('characters', 'readonly').objectStore('characters').get(chatId);
                        g.onsuccess = function () { var c = g.result; try { db.close(); } catch (e2) {} resolve((c && (c.name || c.nickname)) || ''); };
                        g.onerror = function () { try { db.close(); } catch (e2) {} resolve(''); };
                    } catch (err) { try { db.close(); } catch (e2) {} resolve(''); }
                };
                req.onerror = function () { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }

    var LINK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12z"/><path d="M8 13h8v-2H8v2z"/><path d="M17 7h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/></svg>';

    function bankOf(id) { try { return (window.NanoBank && NanoBank.get(id)) || null; } catch (e) { return null; } }

    function renderBankStack() {
        if (!bankStackEl) return;
        var n = _cards.length;
        if (!n) { bankStackEl.innerHTML = ''; bankStackEl.style.height = '0px'; return; }
        // 选中的放最上面，其余依次叠在下面（Apple 钱包：下一张只露一条边）
        var order = [];
        for (var k = 0; k < n; k++) order.push({ c: _cards[(_activeCard + k) % n], idx: (_activeCard + k) % n });
        var CARD_H = 200, OFFSET = 60;
        var html = '';
        order.forEach(function (o, k) {
            var c = o.c, i = o.idx, isTop = (k === 0);
            var topPx = k * OFFSET;
            var scale = Math.max(0.8, 1 - k * 0.05);
            var z = 200 - k;
            var isFamily = (c.kind === 'family');
            var bank = bankOf(isFamily ? (c.raw && c.raw.bankId) : c.bankId) || bankOf('gray');
            var bg = isFamily ? 'linear-gradient(135deg,#fff5f9,#ffedf4)' : (bank ? bank.bg : 'linear-gradient(135deg,#3d434a,#22262b)');
            var tone = isFamily ? ' on-light' : ((bank && bank.id === 'gold') ? ' on-gold' : '');
            var chipHtml = '<div class="card-chip" style="background:linear-gradient(135deg,#f2d06b,#d4af37)"></div>';
            var inner = '';
            if (c.kind === 'family') {
                var f = c.raw || {};
                var remain = Math.max(0, (Number(f.limit) || 0) - (Number(f.spent) || 0));
                var person = c._charName ? escHtmlSafe(c._charName) : '对方';
                var bankName = (bankOf(f.bankId) || bankOf('gray')).name;
                inner = '<div class="card-top"><span class="card-bank-name"><span class="fc-badge">亲属卡 · ' + escHtmlSafe(bankName) + '</span><span class="fc-link">' + LINK_SVG + '</span><span class="fc-bound">' + person + '</span></span>' + chipHtml + '</div>'
                    + (isTop ? '<div class="card-balance"><span class="balance-label">剩余额度</span><span class="balance-amount"><span class="currency">¥</span>' + money2(remain) + '</span></div>' : '')
                    + '<div class="card-bottom"><span class="card-number">' + (f.issuer === 'user' ? '我出资 · 对方使用' : '对方出资 · 我使用') + '</span><span class="card-holder">' + (f.status === 'active' ? '使用中' : (f.status === 'pending' ? '待确认' : '已停用')) + '</span></div>';
            } else {
                var rawNum = String(c.cardNumber || '').replace(/\s/g, '');
                var masked = rawNum.length >= 4 ? '**** **** **** ' + rawNum.slice(-4) : '**** **** **** ****';
                var bn = (bankOf(c.bankId) || bankOf('gray')).name;
                inner = '<div class="card-top"><span class="card-bank-name">' + escHtmlSafe(c.bankName || bn) + '</span>' + chipHtml + '</div>'
                    + (isTop ? '<div class="card-balance"><span class="balance-label">余额</span><span class="balance-amount"><span class="currency">¥</span>' + money2(c.balance) + '</span></div>' : '')
                    + '<div class="card-bottom"><span class="card-number">' + masked.replace(/(.{4})/g, '$1 ').trim() + '</span><span class="card-holder">' + escHtmlSafe(bn) + '</span></div>';
            }
            html += '<div class="bank-card stacked' + (isTop ? ' top' : ' peek') + tone + '" data-idx="' + i + '" data-chatid="' + escAttr(c._chatId || '') + '" style="top:' + topPx + 'px;transform:scale(' + scale + ');z-index:' + z + ';background:' + bg + '">' + inner + '</div>';
        });
        bankStackEl.style.height = (CARD_H + Math.max(0, n - 1) * OFFSET) + 'px';
        bankStackEl.innerHTML = html;
        // 绑定人昵称异步补齐
        _cards.forEach(function (c) {
            if (c.kind !== 'family' || c._charName || !c._chatId || c._namePending) return;
            c._namePending = true;
            getCharName(c._chatId).then(function (nm) {
                c._charName = nm || '对方';
                var esc = (window.CSS && CSS.escape) ? CSS.escape(c._chatId) : c._chatId;
                var el = bankStackEl.querySelector('.bank-card[data-chatid="' + esc + '"] .fc-bound');
                if (el) el.textContent = c._charName;
            });
        });
        // 点某张卡 → 选中它
        Array.prototype.forEach.call(bankStackEl.querySelectorAll('.bank-card'), function (el) {
            el.addEventListener('click', function () {
                if (_justSwiped) { _justSwiped = false; return; }
                var idx = Number(el.getAttribute('data-idx'));
                if (idx === _activeCard) return;
                _activeCard = idx;
                renderBankStack();
                renderWalletTx();
                syncRechargeBtn();
            });
        });
        syncRechargeBtn();
    }

    function syncRechargeBtn() {
        var rb = document.getElementById('rechargeBtn');
        if (rb) rb.style.display = ((_cards[_activeCard] || {}).kind === 'family') ? 'none' : '';
        var eb = document.getElementById('editCardBtn');
        if (eb) eb.style.display = ((_cards[_activeCard] || {}).kind === 'family') ? 'none' : '';
    }

    // ===== 更换银行卡：选择归属银行（决定颜色）+ 卡号 =====
    function openBankEditor() {
        var own = _cards[0];
        if (!own) return;
        var banks = (window.NanoBank && NanoBank.list) || [];
        var cur = own.bankId || 'gray';
        var curNum = own.cardNumber || '';
        var ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
        ov.innerHTML =
            '<div style="width:100%;max-width:520px;background:#fff;border-radius:20px 20px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));box-sizing:border-box;max-height:82vh;overflow:auto">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><b style="font-size:16px">更换银行卡</b><button id="bkX" style="border:0;background:none;font-size:22px;line-height:1;color:#999;cursor:pointer">&times;</button></div>' +
            '<div style="font-size:12px;color:#8a8f98;margin-bottom:8px">选择银行（决定卡面颜色）</div>' +
            '<div id="bkGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
            banks.map(function (b) {
                return '<button class="bk-opt" data-bank="' + b.id + '" style="border:2px solid ' + (b.id === cur ? '#007aff' : 'transparent') + ';border-radius:12px;padding:8px 4px;background:none;cursor:pointer;box-sizing:border-box">' +
                    '<span style="display:block;height:38px;border-radius:8px;background:' + b.bg + ';margin-bottom:6px"></span>' +
                    '<span style="font-size:11px;color:#333">' + b.name + '</span></button>';
            }).join('') +
            '</div>' +
            '<div style="margin-top:16px"><div style="font-size:12px;color:#8a8f98;margin-bottom:6px">卡号（可选，仅显示后四位）</div>' +
            '<input id="bkNum" value="' + escAttr(curNum) + '" placeholder="请输入银行卡号" style="width:100%;height:44px;border:1px solid #e5e5ea;border-radius:10px;padding:0 12px;box-sizing:border-box;font-size:15px;outline:none"></div>' +
            '<button id="bkSave" style="width:100%;height:48px;margin-top:18px;border:0;border-radius:12px;background:#007aff;color:#fff;font-size:16px;font-weight:600;cursor:pointer">保存</button>' +
            '</div>';
        document.body.appendChild(ov);
        var sel = cur;
        Array.prototype.forEach.call(ov.querySelectorAll('.bk-opt'), function (btn) {
            btn.addEventListener('click', function () {
                sel = btn.getAttribute('data-bank');
                Array.prototype.forEach.call(ov.querySelectorAll('.bk-opt'), function (b) {
                    b.style.borderColor = (b === btn) ? '#007aff' : 'transparent';
                });
            });
        });
        function close() { try { ov.remove(); } catch (e) {} }
        ov.querySelector('#bkX').addEventListener('click', close);
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        ov.querySelector('#bkSave').addEventListener('click', function () {
            var num = (ov.querySelector('#bkNum').value || '').replace(/\s/g, '').trim();
            getWalletData().then(function (data) {
                data.bankId = sel;
                data.bankName = (window.NanoBank && NanoBank.get(sel).name) || '我的银行卡';
                data.cardNumber = num;
                return saveWalletData(data);
            }).then(function () { close(); renderWallet(); showToast('银行卡已更新'); });
        });
    }
    var editCardBtn = document.getElementById('editCardBtn');
    if (editCardBtn) editCardBtn.addEventListener('click', function (e) { e.stopPropagation(); openBankEditor(); });

    // 上下滑动切换银行卡
    var _swipeStartY = 0;
    var _justSwiped = false;
    if (bankStackEl) {
        bankStackEl.addEventListener('touchstart', function (e) { try { _swipeStartY = e.touches[0].clientY; } catch (err) {} }, { passive: true });
        bankStackEl.addEventListener('touchend', function (e) {
            if (_cards.length <= 1) return;
            var dy = (e.changedTouches && e.changedTouches[0]) ? (e.changedTouches[0].clientY - _swipeStartY) : 0;
            if (Math.abs(dy) < 30) return;
            _justSwiped = true;
            setTimeout(function () { _justSwiped = false; }, 350);
            _activeCard = (_activeCard + (dy < 0 ? 1 : -1) + _cards.length) % _cards.length;
            renderBankStack();
            renderWalletTx();
        }, { passive: true });
    }

    function renderWallet() {
        getWalletData().then(function (data) {
            var own = { kind: 'own', balance: data.balance, bankId: data.bankId, bankName: data.bankName, cardNumber: data.cardNumber, txs: data.transactions || [] };
            var fams = loadFamilyCards().map(function (c) { return { kind: 'family', raw: c, _chatId: c._chatId }; });
            _cards = [own].concat(fams);
            if (_activeCard >= _cards.length) _activeCard = 0;
            renderBankStack();
            renderWalletTx();
        });
    }

    function renderWalletTx() {
        var c = _cards[_activeCard];
        var isFamily = !!(c && c.kind === 'family');
        var txs = [];
        if (isFamily) {
            var f = c.raw || {};
            if (f.issuer === 'char') {
                // 对方出资的亲属卡：消费实际记在对方的银行卡上
                try {
                    var cw = (window.NanoFamilyCardStore && NanoFamilyCardStore.readCharWallet) ? NanoFamilyCardStore.readCharWallet(c._chatId) : { transactions: [] };
                    txs = (cw.transactions || []).filter(function (t) {
                        var d = (t && t.desc) || '';
                        return d.indexOf('亲属卡') >= 0;
                    });
                } catch (e) { txs = []; }
            } else {
                // 我出资、对方使用的亲属卡：消费记在我的银行卡上
                var own = _cards[0] || { txs: [] };
                var nm = f.name || '';
                txs = (own.txs || []).filter(function (t) {
                    var d = (t && t.desc) || '';
                    return d.indexOf('亲属卡') >= 0 && (!nm || d.indexOf(nm) >= 0);
                });
            }
        } else {
            txs = (c && c.txs) || [];
        }
            walletTxCount.textContent = txs.length + ' 笔';
            if (txs.length === 0) {
                walletTxList.innerHTML =
                    '<div class="empty-entries"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/></svg><div>暂无交易记录</div></div>';
                return;
            }
            var html = '';
            txs.forEach(function(tx) {
                var isIncome = tx.type === 'income';
                var iconClass = isIncome ? 'income' : 'expense';
                var amountClass = isIncome ? 'income' : 'expense';
                var sign = isIncome ? '+' : '-';
                var iconSvg = isIncome ?
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12l4 4 4-4"/></svg>' :
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16V8"/><path d="M8 12l4-4 4 4"/></svg>';
                html +=
                    '<div class="entry-item-wrap" data-id="' + tx.id + '">' +
                    '<div class="entry-item">' +
                    '<div class="entry-icon ' + iconClass + '">' + iconSvg + '</div>' +
                    '<div class="entry-info">' +
                    '<div class="entry-desc">' + escHtml(tx.desc || (isIncome ? '收入' : '支出')) + '</div>' +
                    '<div class="entry-time">' + formatTime(tx.time) + '</div>' +
                    '</div>' +
                    '<div class="entry-amount ' + amountClass + '">' + sign + formatMoneyRaw(tx.amount) + '</div>' +
                    '</div>' +
                    (isFamily ? '' : '<button class="entry-delete-btn"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>删除</button>') +
                    '</div>';
            });
            walletTxList.innerHTML = html;
            if (!isFamily) {
                setupSwipeDelete(walletTxList, function(id) {
                    deleteWalletTransaction(id);
                });
            }
    }

    function renderLedger() {
        getLedgerData().then(function(data) {
            var entries = data.entries || [];
            var stats = calcLedgerStats(entries);

            totalIncomeEl.textContent = formatMoney(stats.income);
            totalExpenseEl.textContent = formatMoney(stats.expense);
            totalBalanceEl.textContent = formatMoney(stats.balance);
            entryCountEl.textContent = entries.length + ' 笔';

            if (entries.length === 0) {
                entryListEl.innerHTML =
                    '<div class="empty-entries"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/></svg><div>还没有记账记录<br>点击右上角 + 开始记账</div></div>';
                return;
            }

            var html = '';
            entries.forEach(function(e) {
                var isIncome = e.type === 'income';
                var iconClass = isIncome ? 'income' : 'expense';
                var amountClass = isIncome ? 'income' : 'expense';
                var sign = isIncome ? '+' : '-';
                var iconSvg = isIncome ?
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12l4 4 4-4"/></svg>' :
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16V8"/><path d="M8 12l4-4 4 4"/></svg>';
                var desc = e.desc || (isIncome ? '收入' : '支出');
                html +=
                    '<div class="entry-item-wrap" data-id="' + e.id + '">' +
                    '<div class="entry-item">' +
                    '<div class="entry-icon ' + iconClass + '">' + iconSvg + '</div>' +
                    '<div class="entry-info">' +
                    '<div class="entry-desc">' + escHtml(desc) + '</div>' +
                    '<div class="entry-time">' + formatTime(e.time) + '</div>' +
                    '</div>' +
                    '<div class="entry-amount ' + amountClass + '">' + sign + formatMoneyRaw(e.amount) + '</div>' +
                    '</div>' +
                    '<button class="entry-delete-btn"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>删除</button>' +
                    '</div>';
            });
            entryListEl.innerHTML = html;

            window._onEditEntry = function(id) {
                openEditModal(id);
            };

            setupSwipeDelete(entryListEl, function(id) {
                deleteLedgerEntry(id);
            });
        });
    }

    function renderAll() {
        renderWallet();
        renderLedger();
    }

    // ============================================================
    // Toast
    // ============================================================
    var toastTimer = null;

    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function() {
            toastEl.classList.remove('show');
        }, 2000);
    }

    // ============================================================
    // 弹窗工具
    // ============================================================
    function openModal(el) { el.classList.add('active'); }

    function closeModal(el) { el.classList.remove('active'); }

    // ============================================================
    // 新增记账（独立）
    // ============================================================
    function openAddModal() {
        entryType.value = 'income';
        entryAmount.value = '';
        entryDesc.value = '';
        document.getElementById('modalTitle').textContent = '记一笔';
        document.getElementById('modalSub').textContent = '记录你的收支';
        openModal(entryModal);
        setTimeout(function() { entryAmount.focus(); }, 200);
    }

    function handleAddSubmit() {
        var type = entryType.value;
        var amount = parseFloat(entryAmount.value);
        var desc = entryDesc.value.trim();
        if (!amount || amount <= 0) { showToast('请输入有效的金额'); return; }
        if (amount > 99999999) { showToast('金额太大，请检查'); return; }
        addLedgerEntry(type, amount, desc || (type === 'income' ? '收入' : '支出')).then(function() {
            closeModal(entryModal);
            showToast(type === 'income' ? '收入已记录 ✓' : '支出已记录 ✓');
        });
    }

    // ============================================================
    // 修改记账（独立）
    // ============================================================
    function openEditModal(id) {
        getLedgerEntry(id).then(function(entry) {
            if (!entry) { showToast('记录不存在'); return; }
            editingId = id;
            editType.value = entry.type;
            editAmount.value = entry.amount;
            editDesc.value = entry.desc || '';
            openModal(editModal);
            setTimeout(function() { editAmount.focus(); }, 200);
        });
    }

    function handleEditSubmit() {
        if (!editingId) return;
        var type = editType.value;
        var amount = parseFloat(editAmount.value);
        var desc = editDesc.value.trim();
        if (!amount || amount <= 0) { showToast('请输入有效的金额'); return; }
        updateLedgerEntry(editingId, type, amount, desc || (type === 'income' ? '收入' : '支出')).then(function() {
            closeModal(editModal);
            editingId = null;
        });
    }

    // ============================================================
    // 充值（银行卡）
    // ============================================================
    function handleRecharge() {
        var val = parseFloat(rechargeAmount.value);
        if (!val || val <= 0) { showToast('请输入有效的充值金额'); return; }
        if (val > 100000) { showToast('单次充值不能超过 100,000 元'); return; }
        updateWalletBalance(val, '充值 ' + formatMoneyRaw(val) + ' 元').then(function() {
            closeModal(rechargeModal);
            rechargeAmount.value = '';
            showToast('充值成功！');
            if (window.parent !== window) {
                try {
                    getWalletData().then(function(data) {
                        window.parent.postMessage({ type: 'walletUpdated', data: data }, '*');
                    });
                } catch (e) {}
            }
        });
    }

    // ============================================================
    // 切换页面
    // ============================================================
    function switchTab(tab) {
        currentTab = tab;
        tabBtns.forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        pageWallet.classList.toggle('active', tab === 'wallet');
        pageLedger.classList.toggle('active', tab === 'ledger');
        navTitle.textContent = tab === 'wallet' ? '钱包' : '记账';
        addBtn.classList.toggle('hidden', tab === 'wallet');
    }

    // ============================================================
    // 返回
    // ============================================================
    function goBack() {
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'closeFullscreen' }, '*');
        } else {
            history.back();
        }
    }

    // ============================================================
    // 接收来自父页面（chat-inner）的消息
    // ============================================================
    window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data) return;

        if (data.type === 'NANO_TRANSFER_SUBMIT' || data.type === 'walletSyncResponse' || data.type ===
            'walletUpdated') {
            if (data.data) {
                getWalletData().then(function(wd) {
                    if (data.data.balance !== undefined) wd.balance = data.data.balance;
                    if (data.data.transactions) wd.transactions = data.data.transactions;
                    saveWalletData(wd).then(function() { renderWallet(); });
                });
            }
        }

        if (data.type === 'NANO_TRANSFER_CARD') {
            if (data.amount && data.amount > 0) {
                updateWalletBalance(data.amount, '收到转账 ' + formatMoneyRaw(data.amount) + ' 元');
            }
        }

        if (data.type === 'walletRefresh') {
            renderWallet();
        }

        if (data.type === 'walletSyncRequest') {
            getWalletData().then(function(data) {
                try {
                    window.parent.postMessage({ type: 'walletSyncResponse', data: data }, '*');
                } catch (e) {}
            });
        }
    });

    // ============================================================
    // 暴露 API
    // ============================================================
    window.__wallet = {
        getWalletData: getWalletData,
        getLedgerData: getLedgerData,
        addLedgerEntry: addLedgerEntry,
        deleteLedgerEntry: deleteLedgerEntry,
        updateLedgerEntry: updateLedgerEntry,
        updateWalletBalance: updateWalletBalance,
        render: renderAll,
        showToast: showToast,
        switchTab: switchTab
    };

    // ============================================================
    // 事件绑定
    // ============================================================
    backBtn.addEventListener('click', goBack);

    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });

    addBtn.addEventListener('click', openAddModal);

    entryCancel.addEventListener('click', function() { closeModal(entryModal); });
    entryConfirm.addEventListener('click', handleAddSubmit);
    entryAmount.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault();
            entryDesc.focus(); }
    });
    entryDesc.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault();
            entryConfirm.click(); }
    });

    editCancel.addEventListener('click', function() { closeModal(editModal);
        editingId = null; });
    editConfirm.addEventListener('click', handleEditSubmit);
    editAmount.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault();
            editDesc.focus(); }
    });
    editDesc.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault();
            editConfirm.click(); }
    });

    rechargeBtn.addEventListener('click', function() {
        rechargeAmount.value = '';
        openModal(rechargeModal);
        setTimeout(function() { rechargeAmount.focus(); }, 200);
    });
    rechargeCancel.addEventListener('click', function() { closeModal(rechargeModal);
        rechargeAmount.value = ''; });
    rechargeConfirm.addEventListener('click', handleRecharge);
    rechargeAmount.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault();
            rechargeConfirm.click(); }
    });

    document.querySelectorAll('.modal-overlay').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal(this);
                if (this.id === 'rechargeModal') rechargeAmount.value = '';
                if (this.id === 'editModal') { editingId = null; }
            }
        });
    });

    // ============================================================
    // 初始化
    // ============================================================
    renderAll();
    switchTab('wallet');

    if (window.parent !== window) {
        try {
            window.parent.postMessage({ type: 'pageLoaded', page: 'wallet' }, '*');
            window.parent.postMessage({ type: 'walletSyncRequest' }, '*');
        } catch (e) {}
    }

})();