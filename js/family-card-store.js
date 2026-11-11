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
        list = list || [];
        try { localStorage.setItem(key(chatId), JSON.stringify(list)); } catch (e) {}
        try { if (window.NanoIDB) NanoIDB.set(key(chatId), list).catch(function () {}); } catch (e) {}
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

    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    function newCardId() { return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

    function normalizeWallet(wd) {
        wd = (wd && typeof wd === 'object') ? wd : {};
        if (typeof wd.balance !== 'number') wd.balance = 0;
        if (!Array.isArray(wd.transactions)) wd.transactions = [];
        if (!Array.isArray(wd.cards) || !wd.cards.length) {
            wd.cards = [{
                id: newCardId(),
                bankId: wd.bankId || 'gray',
                bankName: wd.bankName || '',
                cardNumber: wd.cardNumber || '',
                balance: wd.balance
            }];
        }
        wd.cards = wd.cards.map(function (c, i) {
            c = (c && typeof c === 'object') ? c : {};
            if (!c.id) c.id = newCardId() + i;
            c.bankId = c.bankId || 'gray';
            c.bankName = c.bankName || '';
            c.cardNumber = c.cardNumber || '';
            if (typeof c.balance !== 'number') c.balance = 0;
            return c;
        });
        var active = wd.cards.filter(function (c) { return String(c.id) === String(wd.activeCardId); })[0] || wd.cards[0];
        wd.activeCardId = active.id;
        wd.balance = active.balance;
        wd.bankId = active.bankId;
        wd.bankName = active.bankName;
        wd.cardNumber = active.cardNumber;
        return wd;
    }

    function defaultWallet() {
        return normalizeWallet({ balance: 5000, cardNumber: '', bankName: '', cards: [], activeCardId: '', transactions: [] });
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
                                    resolve(normalizeWallet(v2));
                                };
                                r2.onerror = function () { resolve(defaultWallet()); };
                            } catch (e2) { resolve(defaultWallet()); }
                            return;
                        }
                        resolve(normalizeWallet(v));
                    };
                    r.onerror = function () { resolve(defaultWallet()); };
                } catch (e) { resolve(defaultWallet()); }
            });
        });
    }

    function spend(desc, amount, cardId, meta) {
        var amt = round2(amount);
        if (amt <= 0) return Promise.resolve(null);
        return readWallet().then(function (wd) {
            wd = normalizeWallet(wd);
            var card = wd.cards.filter(function (c) { return String(c.id) === String(cardId || wd.activeCardId); })[0] || wd.cards[0];
            if (!card) throw new Error('没有可用的银行卡');
            if ((Number(card.balance) || 0) < amt) throw new Error('银行卡余额不足');
            card.balance = round2((Number(card.balance) || 0) - amt);
            if (String(card.id) === String(wd.activeCardId)) wd.balance = card.balance;
            wd.transactions = Array.isArray(wd.transactions) ? wd.transactions : [];
            meta = meta || {};
            wd.transactions.unshift({
                id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                type: 'expense',
                amount: amt,
                desc: desc || '亲属卡消费',
                time: new Date().toISOString(),
                cardId: card.id,
                cardLast4: String(card.cardNumber || '').replace(/\s/g, '').slice(-4),
                bankName: card.bankName || '',
                familyId: meta.familyId || '',
                familyCardId: meta.familyCardId || '',
                charName: meta.charName || ''
            });
            if (wd.transactions.length > 500) wd.transactions = wd.transactions.slice(0, 500);
            return openWalletDb().then(function (db) {
                return new Promise(function (resolve) {
                    try {
                        var tx = db.transaction('wallet_data', 'readwrite');
                        tx.objectStore('wallet_data').put({ key: walletKey(), value: wd });
                    } catch (e) {}
                    try {
                        window.parent.postMessage({
                            type: 'walletUpdated',
                            data: { balance: wd.balance, transactions: wd.transactions, cards: wd.cards, activeCardId: wd.activeCardId }
                        }, '*');
                    } catch (e) {}
                    resolve(wd);
                });
            });
        });
    }

    function charKey(chatId) { return 'nano_char_wallet_' + (chatId || 'default'); }
    function charProfile(chatId) {
        try { if (window.NanoCharWealth) return NanoCharWealth.readProfile(chatId); } catch (e) {}
        return null;
    }
    function readCharWallet(chatId) {
        try {
            var w = JSON.parse(localStorage.getItem(charKey(chatId)) || 'null');
            if (!w || typeof w !== 'object') {
                return { balance: 5000, transactions: [], seedVersion: 2 };
            }
            if (typeof w.balance !== 'number') w.balance = 0;
            if (!Array.isArray(w.transactions)) w.transactions = [];
            return w;
        } catch (e) {
            return { balance: 5000, transactions: [], seedVersion: 2 };
        }
    }
    function writeCharWallet(chatId, w) {
        try { localStorage.setItem(charKey(chatId), JSON.stringify(w)); } catch (e) {}
        try { if (window.NanoIDB) NanoIDB.set(charKey(chatId), w).catch(function () {}); } catch (e) {}
    }
    function bumpCharTx(w, type, desc, amount) {
        var amt = round2(amount);
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

    function seedCharWallet(chatId, personaText, name) {
        try {
            var k = charKey(chatId);
            var raw = localStorage.getItem(k);
            var old = raw ? JSON.parse(raw) : null;
            var profile = null;
            try {
                if (window.NanoCharWealth) {
                    profile = NanoCharWealth.profileFor(personaText, name);
                    NanoCharWealth.saveProfile(chatId, profile);
                }
            } catch (e) {}
            if (!profile) {
                return readCharWallet(chatId);
            }
            if (old && old.seedVersion === 2 && old.wealthTier === profile.tier &&
                !!old.lowFamily === !!profile.lowFamily && !!old.veryPoor === !!profile.veryPoor &&
                typeof old.balance === 'number') {
                return readCharWallet(chatId);
            }
            var w = {
                balance: round2(profile.balance),
                transactions: [],
                wealthTier: profile.tier,
                wealthLabel: profile.label,
                lowFamily: !!profile.lowFamily,
                veryPoor: !!profile.veryPoor,
                seedVersion: 2
            };
            writeCharWallet(chatId, w);
            return w;
        } catch (e) { return readCharWallet(chatId); }
    }

    function bumpCharWallet(chatId) {
        var w = readCharWallet(chatId);
        var profile = charProfile(chatId);
        try { if (!profile && window.NanoCharWealth) profile = NanoCharWealth.profileFor('', '角色'); } catch (e) {}
        var n = 1 + Math.floor(Math.random() * 3);
        var txs = profile && window.NanoCharWealth
            ? NanoCharWealth.randomWalletTransactions(profile, n, '', { balance: w.balance })
            : [];
        if (txs.length) {
            txs.forEach(function (t) {
                w.balance = Math.max(0, round2((Number(w.balance) || 0) + (t.type === 'income' ? t.amount : -t.amount)));
                w.transactions.unshift(t);
            });
        } else {
            for (var i = 0; i < n; i++) bumpCharTx(w, 'expense', '日常支出', 20 + Math.random() * 100);
        }
        if (w.transactions.length > 500) w.transactions = w.transactions.slice(0, 500);
        writeCharWallet(chatId, w);
        return w;
    }

    // localStorage 被清理 / 写入失败时，从 IndexedDB 把亲属卡和角色银行卡补回来。
    // 不覆盖本地已有数据，避免旧 IDB 快照盖掉刚写入的新流水。
    function hydrate(chatId) {
        if (!window.NanoIDB) return Promise.resolve(false);
        return Promise.all([
            NanoIDB.get(key(chatId)),
            NanoIDB.get(charKey(chatId))
        ]).then(function (r) {
            var changed = false;
            if (Array.isArray(r[0]) && r[0].length && !read(chatId).length) {
                try { localStorage.setItem(key(chatId), JSON.stringify(r[0])); changed = true; } catch (e) {}
            }
            if (r[1] && typeof r[1] === 'object' && !localStorage.getItem(charKey(chatId))) {
                try { localStorage.setItem(charKey(chatId), JSON.stringify(r[1])); changed = true; } catch (e) {}
            }
            return changed;
        }).catch(function () { return false; });
    }

    function getCard(wd, cardId) {
        wd = normalizeWallet(wd);
        return wd.cards.filter(function (c) { return String(c.id) === String(cardId || wd.activeCardId); })[0] || wd.cards[0] || null;
    }

    window.NanoFamilyCardStore = {
        read: read,
        write: write,
        hydrate: hydrate,
        add: add,
        update: update,
        remove: remove,
        find: find,
        latestPending: latestPending,
        genId: genId,
        readWallet: readWallet,
        normalizeWallet: normalizeWallet,
        getCard: getCard,
        spend: spend,
        readCharWallet: readCharWallet,
        writeCharWallet: writeCharWallet,
        charSpend: charSpend,
        charIncome: charIncome,
        seedCharWallet: seedCharWallet,
        bumpCharWallet: bumpCharWallet
    };
})();
