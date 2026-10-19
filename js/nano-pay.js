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
        return { balance: 5000, cardNumber: '', bankName: '', transactions: [] };
    }

    function normalize(w) {
        w = (w && typeof w === 'object') ? w : defaultWallet();
        if (typeof w.balance !== 'number') w.balance = 0;
        if (!Array.isArray(w.transactions)) w.transactions = [];
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

    function hashPassword(pwd) {
        var s = 'nano-pay::' + String(pwd || '');
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

    function getSettings() {
        return readWallet().then(settingsOf);
    }

    function updateSettings(opts) {
        opts = opts || {};
        return readWallet().then(function (wd) {
            if (opts.clearPassword) {
                delete wd.payPasswordHash;
            } else if (opts.password) {
                var pwd = String(opts.password);
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

    function pay(amount, desc, opts) {
        opts = opts || {};
        var amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
        if (amt <= 0) return Promise.reject(new Error('支付金额无效'));
        return readWallet().then(function (wd) {
            // 以钱包真实设置为准：有密码且未开免密时必须验证
            if (wd.payPasswordHash && !wd.freePay) {
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
            if (Number(wd.balance) < amt) throw new Error('银行卡余额不足');
            wd.balance = Math.round((Number(wd.balance) - amt) * 100) / 100;
            wd.transactions.unshift({
                id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                type: 'expense',
                amount: amt,
                desc: desc || '商城消费',
                time: new Date().toISOString()
            });
            if (wd.transactions.length > 500) wd.transactions = wd.transactions.slice(0, 500);
            return writeWallet(wd);
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
        pay: pay
    };
})();
