// ============================================================
// family-card-store.js — 亲属卡共享存储（user <-> char）
// 一张卡 = 一方出资（issuer）、另一方消费（holder）。
// 数据存 localStorage：nano_family_cards_<chatId>
// 与钱包的联动：消费直接读写 nano_wallet_db 的 wallet_data（余额 + 流水），
// 不改动钱包原有数据结构。
// ============================================================
(function () {
    'use strict';

    // 按当前用户（人设/马甲）隔离：一个 user 一套亲属卡与钱包
    function nanoUid() {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
            if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
        } catch (e) {}
        return 'default';
    }
    function walletKey() { return 'wallet_data__' + nanoUid(); }

    function key(chatId) { return 'nano_family_cards__' + nanoUid() + '_' + (chatId || 'default'); }

    function read(chatId) {
        try {
            var a = JSON.parse(localStorage.getItem(key(chatId)) || '[]');
            return Array.isArray(a) ? a : [];
        } catch (e) { return []; }
    }

    function write(chatId, list) {
        try { localStorage.setItem(key(chatId), JSON.stringify(list || [])); } catch (e) {}
    }

    function genId() { return 'fc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

    function add(chatId, card) {
        var list = read(chatId);
        card = card || {};
        card.id = card.id || genId();
        card.createdAt = card.createdAt || new Date().toISOString();
        card.updatedAt = card.updatedAt || card.createdAt;
        list.unshift(card);
        write(chatId, list);
        return card;
    }

    function update(chatId, id, patch) {
        var list = read(chatId), hit = null;
        list = list.map(function (c) {
            if (c.id !== id) return c;
            hit = Object.assign({}, c, patch, { updatedAt: new Date().toISOString() });
            return hit;
        });
        write(chatId, list);
        return hit;
    }

    function remove(chatId, id) {
        write(chatId, read(chatId).filter(function (c) { return c.id !== id; }));
    }

    function find(chatId, id) {
        var l = read(chatId);
        for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; }
        return null;
    }

    function latestPending(chatId, issuer) {
        var l = read(chatId);
        for (var i = 0; i < l.length; i++) {
            var c = l[i];
            if (c.status === 'pending' && (!issuer || c.issuer === issuer)) return c;
        }
        return null;
    }

    // ---- 钱包（nano_wallet_db，结构不变）----
    function openWalletDb() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_wallet_db', 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('wallet_data')) d.createObjectStore('wallet_data', { keyPath: 'key' });
                        if (!d.objectStoreNames.contains('ledger_data')) d.createObjectStore('ledger_data', { keyPath: 'key' });
                    } catch (err) {}
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function defaultWallet() {
        return { balance: 5000, cardNumber: '', bankName: '', transactions: [] };
    }

    function readWallet() {
        return openWalletDb().then(function (db) {
            return new Promise(function (resolve) {
                if (!db) { resolve(defaultWallet()); return; }
                try {
                    var tx = db.transaction('wallet_data', 'readonly');
                    var store = tx.objectStore('wallet_data');
                    var r = store.get(walletKey());
                    r.onsuccess = function () {
                        var v = r.result && r.result.value;
                        if (!v || typeof v !== 'object') {
                            // 兼容旧版全局钱包
                            try {
                                var r2 = store.get('wallet_data');
                                r2.onsuccess = function () {
                                    var v2 = r2.result && r2.result.value;
                                    if (!v2 || typeof v2 !== 'object') { resolve(defaultWallet()); return; }
                                    if (typeof v2.balance !== 'number') v2.balance = 0;
                                    if (!Array.isArray(v2.transactions)) v2.transactions = [];
                                    resolve(v2);
                                };
                                r2.onerror = function () { resolve(defaultWallet()); };
                            } catch (e2) { resolve(defaultWallet()); }
                            return;
                        }
                        if (typeof v.balance !== 'number') v.balance = 0;
                        if (!Array.isArray(v.transactions)) v.transactions = [];
                        resolve(v);
                    };
                    r.onerror = function () { resolve(defaultWallet()); };
                } catch (e) { resolve(defaultWallet()); }
            });
        });
    }

    // 记一笔支出：扣余额 + 写流水（desc 里带「亲属卡」便于区分）
    function spend(desc, amount) {
        var amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
        if (amt <= 0) return Promise.resolve(null);
        return readWallet().then(function (wd) {
            wd.balance = Math.max(0, (Number(wd.balance) || 0) - amt);
            wd.transactions = Array.isArray(wd.transactions) ? wd.transactions : [];
            wd.transactions.unshift({
                id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                type: 'expense',
                amount: amt,
                desc: desc || '亲属卡消费',
                time: new Date().toISOString()
            });
            if (wd.transactions.length > 500) wd.transactions = wd.transactions.slice(0, 500);
            return openWalletDb().then(function (db) {
                return new Promise(function (resolve) {
                    try {
                        var tx = db.transaction('wallet_data', 'readwrite');
                        tx.objectStore('wallet_data').put({ key: walletKey(), value: wd });
                    } catch (e) {}
                    try { window.parent.postMessage({ type: 'walletUpdated', data: { balance: wd.balance, transactions: wd.transactions } }, '*'); } catch (e) {}
                    resolve(wd);
                });
            });
        });
    }

    // ---- 对方的银行卡（亲属卡的出资方可能是对方）----
    // 存在 localStorage：nano_char_wallet_<chatId>，默认给一个初始余额，独立于用户银行卡
    function charKey(chatId) { return 'nano_char_wallet_' + (chatId || 'default'); }
    function readCharWallet(chatId) {
        try {
            var w = JSON.parse(localStorage.getItem(charKey(chatId)) || 'null');
            if (!w || typeof w !== 'object') return { balance: 20000, transactions: [] };
            if (typeof w.balance !== 'number') w.balance = 0;
            if (!Array.isArray(w.transactions)) w.transactions = [];
            return w;
        } catch (e) { return { balance: 20000, transactions: [] }; }
    }
    function writeCharWallet(chatId, w) {
        try { localStorage.setItem(charKey(chatId), JSON.stringify(w)); } catch (e) {}
    }
    function bumpCharTx(w, type, desc, amount) {
        var amt = Math.round((parseFloat(amount) || 0) * 100) / 100;
        if (amt <= 0) return false;
        w.balance = Math.max(0, (Number(w.balance) || 0) + (type === 'income' ? amt : -amt));
        w.transactions.unshift({
            id: 'ctx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: type, amount: amt, desc: desc || (type === 'income' ? '收入' : '支出'), time: new Date().toISOString()
        });
        if (w.transactions.length > 500) w.transactions = w.transactions.slice(0, 500);
        return true;
    }
    function charSpend(chatId, desc, amount) {
        var w = readCharWallet(chatId);
        if (bumpCharTx(w, 'expense', desc || '对方消费', amount)) writeCharWallet(chatId, w);
        return Promise.resolve(w);
    }
    function charIncome(chatId, desc, amount) {
        var w = readCharWallet(chatId);
        if (bumpCharTx(w, 'income', desc || '收入', amount)) writeCharWallet(chatId, w);
        return Promise.resolve(w);
    }

    // 首次进入时读取人设，据此确定对方的初始银行卡余额（无上限，人设越“多金”越高）
    function seedCharWallet(chatId, personaText) {
        try {
            var k = charKey(chatId);
            if (localStorage.getItem(k)) return readCharWallet(chatId);
            var s = String(personaText || 'char');
            // FNV-1a 哈希，保证同一个人设每次结果一致
            var h = 2166136261 >>> 0;
            for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
            var w = { balance: Math.round(20000 + (h % 3000000)), transactions: [] };
            writeCharWallet(chatId, w);
            return w;
        } catch (e) { return readCharWallet(chatId); }
    }

    // 刷新：随机产生 1~3 笔对方的收入/支出，模拟对方银行卡的动态
    var CHAR_DESC_IN = ['兼职收入', '红包收入', '报销到账', '项目结款', '卖闲置收入', '稿费'];
    var CHAR_DESC_OUT = ['咖啡', '外卖', '打车', '买书', '电影票', '超市采购', '奶茶', '话费充值'];
    function bumpCharWallet(chatId) {
        var w = readCharWallet(chatId);
        var n = 1 + Math.floor(Math.random() * 3);
        for (var i = 0; i < n; i++) {
            var income = Math.random() < 0.45;
            var amt = Math.round((income ? (200 + Math.random() * 5000) : (20 + Math.random() * 1500)) * 100) / 100;
            w.balance = Math.max(0, (Number(w.balance) || 0) + (income ? amt : -amt));
            var pool = income ? CHAR_DESC_IN : CHAR_DESC_OUT;
            w.transactions.unshift({
                id: 'ctx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                type: income ? 'income' : 'expense',
                amount: amt,
                desc: pool[Math.floor(Math.random() * pool.length)],
                time: new Date().toISOString()
            });
        }
        if (w.transactions.length > 500) w.transactions = w.transactions.slice(0, 500);
        writeCharWallet(chatId, w);
        return w;
    }

    window.NanoFamilyCardStore = {
        read: read,
        write: write,
        add: add,
        update: update,
        remove: remove,
        find: find,
        latestPending: latestPending,
        genId: genId,
        readWallet: readWallet,
        spend: spend,
        readCharWallet: readCharWallet,
        writeCharWallet: writeCharWallet,
        charSpend: charSpend,
        charIncome: charIncome,
        seedCharWallet: seedCharWallet,
        bumpCharWallet: bumpCharWallet
    };
})();
