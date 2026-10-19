// ===== 转账功能 =====
(function() {
    const transferPopup = document.getElementById('transferPopup');
    const transferAmount = document.getElementById('transferAmount');
    const transferNote = document.getElementById('transferNote');
    const transferCancel = document.getElementById('transferCancel');
    const transferConfirm = document.getElementById('transferConfirm');
    const transferSource = document.getElementById('transferSource');

    function chatIdNow() {
        try { return new URLSearchParams(window.location.search).get('chat') || 'default'; } catch (e) { return 'default'; }
    }
    // 找一张对方出资、且已开启的亲属卡（亲密付）
    function getActiveCharCard() {
        try {
            var S = window.NanoFamilyCardStore;
            if (!S) return null;
            var cs = S.read(chatIdNow());
            for (var i = 0; i < cs.length; i++) {
                if (cs[i].issuer === 'char' && cs[i].holder === 'user' && cs[i].status === 'active') return cs[i];
            }
        } catch (e) {}
        return null;
    }

    transferCancel.addEventListener('click', function() {
        transferPopup.classList.remove('active');
    });

    // 读取钱包余额；没有记录时按初始 5000 处理
    function getWalletBalance() {
        return new Promise(function(resolve) {
            try {
                var req = indexedDB.open('nano_wallet_db', 1);
                req.onupgradeneeded = function(e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('wallet_data')) d.createObjectStore('wallet_data', { keyPath: 'key' });
                        if (!d.objectStoreNames.contains('ledger_data')) d.createObjectStore('ledger_data', { keyPath: 'key' });
                    } catch (e) {}
                };
                req.onsuccess = function(e) {
                    var db = e.target.result;
                    try {
                        var uid = 'default';
                        try { var md = JSON.parse(localStorage.getItem('nano_mask_data') || 'null'); if (md && md.currentMaskId != null && md.currentMaskId !== '') uid = String(md.currentMaskId); } catch (e2) {}
                        var tx = db.transaction('wallet_data', 'readonly');
                        var store = tx.objectStore('wallet_data');
                        var r = store.get('wallet_data__' + uid);
                        r.onsuccess = function() {
                            if (r.result && typeof r.result.value.balance === 'number') { resolve(r.result.value.balance); return; }
                            try {
                                var r2 = store.get('wallet_data');
                                r2.onsuccess = function() { resolve(r2.result && typeof r2.result.value.balance === 'number' ? r2.result.value.balance : 5000); };
                                r2.onerror = function() { resolve(5000); };
                            } catch (e3) { resolve(5000); }
                        };
                        r.onerror = function() { resolve(5000); };
                    } catch (err) { resolve(5000); }
                };
                req.onerror = function() { resolve(5000); };
            } catch (e) { resolve(5000); }
        });
    }

    transferConfirm.addEventListener('click', async function() {
        const amount = transferAmount.value.trim();
        const note = transferNote.value.trim() || '转账';
        if (!amount || parseFloat(amount) <= 0) {
            window.__chat.showAlert('提示', '请输入正确金额');
            return;
        }
        const balance = await getWalletBalance();
        if (balance <= 0) {
            window.__chat.showAlert('提示', '钱包余额为 0，无法转账');
            return;
        }
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const timeStr = h + ':' + m;
        const cardData = {
            cardType: 'transfer',
            amount: '¥' + parseFloat(amount).toFixed(2),
            title: note,
            footer: '已发送',
            status: 'pending'
        };
        // 支付方式：我的银行卡（默认）/ 亲密付（走对方亲属卡，对方会知道这笔支出）
        var source = transferSource ? transferSource.value : 'bank';
        if (source === 'family') {
            var fc = getActiveCharCard();
            if (!fc) { window.__chat.showAlert('提示', '没有可用的亲密付（对方亲属卡）'); return; }
            var S = window.NanoFamilyCardStore;
            if (S) {
                S.charSpend(chatIdNow(), '亲密付 · 转账给 ' + (window.__chat.displayName || '对方'), parseFloat(amount));
                S.update(chatIdNow(), fc.id, { spent: Number(fc.spent || 0) + parseFloat(amount) });
            }
            cardData.paidBy = 'family';
            try { window.__chat.addSystemNotice('你使用对方的亲属卡（亲密付）消费了 ¥' + parseFloat(amount).toFixed(2)); } catch (e) {}
        }
        window.__chat.addMessage('right', '', timeStr, null, false, true, cardData);
        window.__chat.saveMessages();
        transferPopup.classList.remove('active');
    });

    transferPopup.addEventListener('click', function(e) {
        if (e.target === this) transferPopup.classList.remove('active');
    });
})();