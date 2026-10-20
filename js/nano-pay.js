// ============================================================
// nano-pay.js — 钱包支付密码 / 免密支付 / 银行卡扣款
// 与 wallet.js 共用 nano_wallet_db / wallet_data，不改变原有结构
// ============================================================
(function () {
    'use strict';

    var DB_NAME = 'nano_wallet_db';
    var STORE = 'wallet_data';

    function uid() {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
            if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
        } catch (e) {}
        return 'default';
    }
    function walletKey() { return 'wallet_data__' + uid(); }

    function openDB() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
                        if (!db.objectStoreNames.contains('ledger_data')) db.createObjectStore('ledger_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function readRaw(db, key) {
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(STORE, 'readonly');
                var r = tx.objectStore(STORE).get(key);
                r.onsuccess = function () { resolve(r.result ? r.result.value : null); };
                r.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function defaultWallet() {
        return { balance: 5000, cardNumber: '', bankName: '', cards: [], activeCardId: '', transactions: [] };
    }

    function newCardId() {
        return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    function normalize(w) {
        w = (w && typeof w === 'object') ? w : defaultWallet();
        if (typeof w.balance !== 'number') w.balance = 0;
        if (!Array.isArray(w.transactions)) w.transactions = [];
        if (!Array.isArray(w.cards) || !w.cards.length) {
            w.cards = [{
                id: newCardId(),
                bankId: w.bankId || 'gray',
                bankName: w.bankName || '',
                cardNumber: w.cardNumber || '',
                balance: w.balance
            }];
        }
        w.cards = w.cards.map(function (c, i) {
            c = (c && typeof c === 'object') ? c : {};
            if (!c.id) c.id = newCardId() + i;
            if (typeof c.balance !== 'number') c.balance = 0;
            c.bankId = c.bankId || 'gray';
            c.bankName = c.bankName || '';
            c.cardNumber = c.cardNumber || '';
            return c;
        });
        var active = w.cards.filter(function (c) { return String(c.id) === String(w.activeCardId); })[0] || w.cards[0];
        w.activeCardId = active.id;
        w.balance = active.balance;
        w.bankId = active.bankId;
        w.bankName = active.bankName;
        w.cardNumber = active.cardNumber;
        return w;
    }

    function syncActiveFields(w) {
        var active = w.cards.filter(function (c) { return String(c.id) === String(w.activeCardId); })[0] || w.cards[0];
        if (!active) return w;
        w.activeCardId = active.id;
        w.balance = active.balance;
        w.bankId = active.bankId;
        w.bankName = active.bankName;
        w.cardNumber = active.cardNumber;
        return w;
    }

    function readWallet() {
        return openDB().then(function (db) {
            return readRaw(db, walletKey()).then(function (v) {
                if (v && typeof v === 'object') return normalize(v);
                return readRaw(db, 'wallet_data').then(function (legacy) {
                    return normalize(legacy);
                });
            });
        }).catch(function () { return defaultWallet(); });
    }

    function writeWallet(wd) {
        wd = normalize(syncActiveFields(wd));
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put({ key: walletKey(), value: wd });
                    tx.oncomplete = function () {
                        try {
                            window.parent.postMessage({
                                type: 'walletUpdated',
                                data: { balance: wd.balance, transactions: wd.transactions }
                            }, '*');
                        } catch (e) {}
                        try { window.parent.postMessage({ type: 'walletRefresh' }, '*'); } catch (e) {}
                        resolve(wd);
                    };
                    tx.onerror = function () { reject(tx.error); };
                } catch (e) { reject(e); }
            });
        });
    }

    function normalizePassword(v) {
        // 中文输入法可能输入全角数字，iOS 也可能带空格/不可见字符；统一成 6 位半角数字
        return String(v == null ? '' : v)
            .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
            .replace(/[^0-9]/g, '')
            .slice(0, 6);
    }

    function hashPassword(pwd) {
        var s = 'nano-pay::' + normalizePassword(pwd);
        var h = 2166136261 >>> 0;
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return 'v1:' + h.toString(16);
    }

    function settingsOf(wd) {
        return {
            hasPassword: !!wd.payPasswordHash,
            freePay: !!wd.freePay
        };
    }

    function getCards() {
        return readWallet().then(function (wd) {
            return { cards: wd.cards.slice(), activeCardId: wd.activeCardId };
        });
    }

    function addCard(opts) {
        opts = opts || {};
        return readWallet().then(function (wd) {
            var card = {
                id: newCardId(),
                bankId: opts.bankId || 'gray',
                bankName: opts.bankName || '',
                cardNumber: String(opts.cardNumber || '').replace(/\s/g, ''),
                balance: Number(opts.balance) || 0
            };
            wd.cards.push(card);
            wd.activeCardId = card.id;
            return writeWallet(wd).then(function () { return card; });
        });
    }

    function updateCard(id, patch) {
        patch = patch || {};
        return readWallet().then(function (wd) {
            var card = wd.cards.filter(function (c) { return String(c.id) === String(id); })[0];
            if (!card) throw new Error('银行卡不存在');
            if (patch.bankId != null) card.bankId = patch.bankId;
            if (patch.bankName != null) card.bankName = patch.bankName;
            if (patch.cardNumber != null) card.cardNumber = String(patch.cardNumber || '').replace(/\s/g, '');
            if (patch.balance != null) card.balance = Math.round((Number(patch.balance) || 0) * 100) / 100;
            return writeWallet(wd).then(function () { return card; });
        });
    }

    function removeCard(id) {
        return readWallet().then(function (wd) {
            if (wd.cards.length <= 1) throw new Error('至少保留一张银行卡');
            wd.cards = wd.cards.filter(function (c) { return String(c.id) !== String(id); });
            if (String(wd.activeCardId) === String(id)) wd.activeCardId = wd.cards[0].id;
            return writeWallet(wd);
        });
    }

    function setActiveCard(id) {
        return readWallet().then(function (wd) {
            if (!wd.cards.some(function (c) { return String(c.id) === String(id); })) throw new Error('银行卡不存在');
            wd.activeCardId = String(id);
            return writeWallet(wd);
        });
    }

    function getSettings() {
        return readWallet().then(settingsOf);
    }

    function updateSettings(opts) {
        opts = opts || {};
        return readWallet().then(function (wd) {
            if (opts.clearPassword) {
                delete wd.payPasswordHash;
            } else if (opts.password) {
                var pwd = normalizePassword(opts.password);
                if (!/^\d{6}$/.test(pwd)) throw new Error('支付密码必须是 6 位数字');
                wd.payPasswordHash = hashPassword(pwd);
            }
            wd.freePay = !!opts.freePay;
            return writeWallet(wd);
        });
    }

    function verifyPassword(pwd) {
        return readWallet().then(function (wd) {
            if (!wd.payPasswordHash) return true;
            return wd.payPasswordHash === hashPassword(pwd);
        });
    }

    function pickCard(wd, cardId) {
        return wd.cards.filter(function (c) { return String(c.id) === String(cardId || wd.activeCardId); })[0] || wd.cards[0];
    }

    // 只校验密码 / 余额并返回选中的卡，不扣款（转账等“对方收下才入账”的场景用）
    function authorize(amount, opts) {
        // payInteractively 会按 (amount, desc, opts) 调用；兼容旧的 (amount, opts) 用法
        if (typeof opts === 'string') opts = arguments[2] || {};
        opts = opts || {};
        var amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
        if (amt <= 0) return Promise.reject(new Error('支付金额无效'));
        return readWallet().then(function (wd) {
            if (wd.payPasswordHash && !wd.freePay) {
                opts.password = normalizePassword(opts.password);
                if (!opts.password) {
                    var e1 = new Error('请输入支付密码');
                    e1.code = 'NEED_PASSWORD';
                    throw e1;
                }
                if (wd.payPasswordHash !== hashPassword(opts.password)) {
                    var e2 = new Error('支付密码不正确');
                    e2.code = 'BAD_PASSWORD';
                    throw e2;
                }
            }
            var card = pickCard(wd, opts.cardId);
            if (!card) throw new Error('没有可用的银行卡');
            if (Number(card.balance) < amt) throw new Error('银行卡余额不足');
            return { amount: amt, cardId: card.id, card: card, wallet: wd };
        });
    }

    function pay(amount, desc, opts) {
        opts = opts || {};
        return authorize(amount, opts).then(function (auth) {
            var wd = auth.wallet;
            var card = pickCard(wd, auth.cardId);
            card.balance = Math.round((Number(card.balance) - auth.amount) * 100) / 100;
            wd.activeCardId = card.id;
            wd.transactions.unshift({
                id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                type: 'expense',
                amount: auth.amount,
                desc: desc || '商城消费',
                cardId: card.id,
                cardLast4: String(card.cardNumber || '').slice(-4),
                bankName: card.bankName || '',
                time: new Date().toISOString()
            });
            if (wd.transactions.length > 500) wd.transactions = wd.transactions.slice(0, 500);
            return writeWallet(wd).then(function () { return auth; });
        });
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // 亲属卡 / 外部支付渠道：只验证支付密码，不选银行卡
    function ensurePassword(title) {
        return readWallet().then(function (wd) {
            if (!wd.payPasswordHash || wd.freePay) return true;
            return new Promise(function (resolve) {
                var old = document.getElementById('nanoPayPassword');
                if (old) old.remove();
                var ov = document.createElement('div');
                ov.id = 'nanoPayPassword';
                ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';
                ov.innerHTML = '<div style="width:100%;max-width:340px;background:#fff;border-radius:18px;padding:20px;box-sizing:border-box">' +
                    '<div style="font-size:17px;font-weight:700;margin-bottom:12px">' + esc(title || '支付密码') + '</div>' +
                    '<input id="npOnlyPwd" type="text" inputmode="numeric" maxlength="6" autocomplete="off" style="width:100%;height:46px;border:1px solid #e5e5ea;border-radius:12px;padding:0 14px;box-sizing:border-box;font-size:17px;letter-spacing:6px;outline:none">' +
                    '<div id="npOnlyErr" style="min-height:18px;color:#ff3b30;font-size:12px;margin-top:6px"></div>' +
                    '<div style="display:flex;gap:10px;margin-top:8px"><button id="npOnlyCancel" style="flex:1;height:44px;border:0;border-radius:12px;background:#f2f2f7;color:#333;font-weight:600">取消</button>' +
                    '<button id="npOnlyOk" style="flex:1;height:44px;border:0;border-radius:12px;background:#007aff;color:#fff;font-weight:700">确认</button></div></div>';
                document.body.appendChild(ov);
                var input = ov.querySelector('#npOnlyPwd');
                input.addEventListener('input', function () { input.value = normalizePassword(input.value); });
                setTimeout(function () { input.focus(); }, 100);
                function done(v) { try { ov.remove(); } catch (e) {} resolve(v); }
                ov.querySelector('#npOnlyCancel').addEventListener('click', function () { done(false); });
                ov.addEventListener('click', function (e) { if (e.target === ov) done(false); });
                ov.querySelector('#npOnlyOk').addEventListener('click', function () {
                    var pwd = normalizePassword(input.value);
                    if (!/^\d{6}$/.test(pwd)) { ov.querySelector('#npOnlyErr').textContent = '请输入 6 位数字密码'; return; }
                    verifyPassword(pwd).then(function (ok) {
                        if (ok) done(true);
                        else { ov.querySelector('#npOnlyErr').textContent = '密码不正确'; input.value = ''; input.focus(); }
                    });
                });
            });
        });
    }

    // 转账 / 红包等场景共用的支付弹窗：选银行卡 + 可选支付密码
    function payInteractively(amount, desc, opts) {
        opts = opts || {};
        var amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
        if (amt <= 0) return Promise.resolve(null);
        return readWallet().then(function (wd) {
            var settings = settingsOf(wd);
            return new Promise(function (resolve) {
                var old = document.getElementById('nanoPayModal');
                if (old) old.remove();
                var ov = document.createElement('div');
                ov.id = 'nanoPayModal';
                ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.42);display:flex;align-items:flex-end;justify-content:center;';
                var cardHtml = wd.cards.map(function (c, i) {
                    var last = String(c.cardNumber || '').slice(-4);
                    return '<label style="display:flex;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid #f0f0f0;cursor:pointer">' +
                        '<input type="radio" name="nanoPayCard" value="' + esc(c.id) + '"' + (String(c.id) === String(wd.activeCardId) ? ' checked' : '') + ' style="width:18px;height:18px">' +
                        '<span style="flex:1;min-width:0"><b style="font-size:14px">' + esc(c.bankName || '银行卡') + '</b>' +
                        '<span style="display:block;font-size:11px;color:#8a8f98">' + (last ? ('尾号 ' + esc(last)) : '未填写卡号') + '</span></span>' +
                        '<span style="font-size:13px;color:#333">¥' + Number(c.balance || 0).toFixed(2) + '</span></label>';
                }).join('');
                ov.innerHTML = '<div style="width:100%;max-width:520px;background:#fff;border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-sizing:border-box;max-height:86vh;overflow:auto">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><b style="font-size:17px">' + esc(opts.title || '确认支付') + '</b>' +
                    '<button id="npCancelX" style="border:0;background:none;font-size:24px;line-height:1;color:#999;cursor:pointer">&times;</button></div>' +
                    '<div style="font-size:13px;color:#8a8f98;margin-bottom:10px">' + esc(desc || '') + ' · ¥' + amt.toFixed(2) + '</div>' +
                    '<div style="font-size:12px;color:#8a8f98;margin:8px 0 4px">付款银行卡</div>' +
                    '<div id="npCards">' + cardHtml + '</div>' +
                    ((wd.payPasswordHash && !wd.freePay)
                        ? '<div style="font-size:12px;color:#8a8f98;margin:14px 0 6px">支付密码</div><input id="npPwd" type="text" inputmode="numeric" maxlength="6" autocomplete="off" style="width:100%;height:46px;border:1px solid #e5e5ea;border-radius:12px;padding:0 14px;box-sizing:border-box;font-size:17px;letter-spacing:6px;outline:none">'
                        : '<div style="font-size:12px;color:#34c759;margin:12px 0 0">免密支付，无需输入密码</div>') +
                    '<div id="npErr" style="min-height:18px;color:#ff3b30;font-size:12px;margin-top:6px"></div>' +
                    '<div style="display:flex;gap:10px;margin-top:8px"><button id="npCancel" style="flex:1;height:46px;border:0;border-radius:12px;background:#f2f2f7;color:#333;font-size:15px;font-weight:600">取消</button>' +
                    '<button id="npConfirm" style="flex:1;height:46px;border:0;border-radius:12px;background:#007aff;color:#fff;font-size:15px;font-weight:700">确认支付</button></div></div>';
                document.body.appendChild(ov);
                function close(result) { try { ov.remove(); } catch (e) {} resolve(result || null); }
                function err(msg) { var e = document.getElementById('npErr'); if (e) e.textContent = msg || ''; }
                function selectedCard() {
                    var r = ov.querySelector('input[name="nanoPayCard"]:checked');
                    return r ? r.value : (wd.cards[0] && wd.cards[0].id);
                }
                ov.querySelector('#npCancel').addEventListener('click', function () { close(null); });
                ov.querySelector('#npCancelX').addEventListener('click', function () { close(null); });
                ov.addEventListener('click', function (e) { if (e.target === ov) close(null); });
                var pwdEl = ov.querySelector('#npPwd');
                if (pwdEl) {
                    pwdEl.addEventListener('input', function () { pwdEl.value = normalizePassword(pwdEl.value); });
                    setTimeout(function () { pwdEl.focus(); }, 100);
                }
                ov.querySelector('#npConfirm').addEventListener('click', function () {
                    var pwd = pwdEl ? normalizePassword(pwdEl.value) : '';
                    if (pwdEl && !/^\d{6}$/.test(pwd)) { err('请输入 6 位数字支付密码'); return; }
                    err('');
                    var fn = opts.authorizeOnly
                        ? function (a, d, o) { return authorize(a, o); }
                        : pay;
                    fn(amt, desc, { cardId: selectedCard(), password: pwd }).then(function (res) {
                        close(res);
                    }).catch(function (e) {
                        if (e && e.code === 'BAD_PASSWORD') { err('支付密码不正确'); if (pwdEl) { pwdEl.value = ''; pwdEl.focus(); } return; }
                        if (e && e.code === 'NEED_PASSWORD') { err('请输入支付密码'); return; }
                        err((e && e.message) || '支付失败');
                    });
                });
            });
        }).catch(function (e) {
            try { if (window.__chat && window.__chat.showAlert) window.__chat.showAlert('无法支付', (e && e.message) || '支付失败'); } catch (err) {}
            return null;
        });
    }

    window.NanoPay = {
        uid: uid,
        walletKey: walletKey,
        readWallet: readWallet,
        writeWallet: writeWallet,
        getSettings: getSettings,
        updateSettings: updateSettings,
        verifyPassword: verifyPassword,
        getCards: getCards,
        addCard: addCard,
        updateCard: updateCard,
        removeCard: removeCard,
        setActiveCard: setActiveCard,
        authorize: authorize,
        ensurePassword: ensurePassword,
        pay: pay,
        payInteractively: payInteractively
    };
})();
